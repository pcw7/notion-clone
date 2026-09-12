/**
 * 페이지 본문 문서 계약 — F-01-01 / F-01-22 / 판결 X-1
 *
 * 정본: 00-canonical-data-model.md §3.4 (B6·B7), 판결 X-1
 *       01-block-editor.md F-01-01 "블록 트리 데이터 모델"
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이것이 "저장 포맷"이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §5.1 이 Phase 0 의 CRDT 를 자르면서 단 조건:
 *   "1인용으로 6주를 번다. **단 저장 포맷을 나중에 바꾸면 재작성.**"
 *
 * 그래서 여기서 정의하는 `EditorDoc` 은 임시 자료구조가 아니라 계약이다.
 * Phase 1 에서 Y.Doc 이 들어와도 **이 모양이 Y.Doc 의 내용이 된다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 판결 X-1 이 이 파일에서 의미하는 것
 * ──────────────────────────────────────────────────────────────────────
 *
 * X-1: *"본문 순서의 정본은 Y.Doc, `block.order_key` 는 파생"* 이고
 * `block.order_key` 주석은 *"프로젝터가 유일한 쓰기자"* 라고 못박는다.
 *
 * Phase 0 에는 Y.Doc 이 없다. 그러면 파생의 상류가 무엇인가 — **이 문서다.**
 * 즉 `EditorDoc` → `block` 행 변환이 **프로젝터**이고, Phase 0 에서는
 * 페이지 저장 요청이 그 프로젝터를 돌린다. Phase 1 에서는 같은 함수의 상류가
 * Y.Doc 으로 바뀔 뿐 하류(이 파일의 `projectDocument`)는 그대로다.
 *
 * 그래서 `order_key` 를 **문서 위치의 순수 함수**로 만들었다
 * (`siblingKeys()`). 같은 문서를 두 번 저장하면 같은 키가 나오고, 따라서
 * 아무것도 바뀌지 않은 저장은 **쓰기가 0건**이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 문서에 없는 것
 * ──────────────────────────────────────────────────────────────────────
 *
 * **접힘 상태(`collapsed`)를 저장하지 않는다.** F-01-13 의 판단:
 *   "문서 데이터로 저장하면 상대 화면이 멋대로 접힘 → **로컬 저장 권장**"
 * 접힘은 분할·병합 규칙의 입력이지만(`block-rules.ts`) 뷰어별 상태이므로
 * 에디터가 로컬에 들고 규칙 함수에 따로 넣는다. 문서 포맷에는 자리가 없다.
 *
 * **캐럿 위치도 저장하지 않는다** (F-01-19 "캐럿 위치 자체는 저장하지 않는다").
 */

import {
  isKnownBlockType,
  normalizeFormat,
  specOf,
  wrapUnsupported,
  MAX_TREE_DEPTH,
  PAGE_TYPE,
  UNSUPPORTED_TYPE,
  type BlockFormat,
  type BlockType,
} from '../block/types.ts'
import { IMAGE_TYPE, validateImageProperties } from '../block/image.ts'
import { isUuid } from '../ids.ts'
import { orderKeysBetween } from '../block/order-key.ts'
import { validateRichText, type RichTextRun } from '../contracts/rich-text.ts'
import { canonicalizeRuns } from './rich-text-ops.ts'

// ── 계약 ──────────────────────────────────────────────────────────────

export type EditorBlock = {
  /** uuid v4. **클라이언트가 만든다** (정본 §3.4 `block.id` 주석). */
  readonly id: string
  readonly type: BlockType
  /** `properties.title`. 텍스트를 담지 않는 타입이면 빈 배열. */
  readonly title: readonly RichTextRun[]
  /** title 을 제외한 properties (`checked`, `url`, unsupported 원본 등). */
  readonly properties?: Readonly<Record<string, unknown>>
  readonly format?: BlockFormat
  readonly children?: readonly EditorBlock[]
}

export type EditorDoc = {
  readonly blocks: readonly EditorBlock[]
}

// ── 검증 ──────────────────────────────────────────────────────────────

export type DocIssue = { readonly path: string; readonly message: string }

/**
 * 클라이언트가 보낸 문서를 검증한다.
 *
 * **관대하게 고치는 것과 거부하는 것을 구분한다.** 모르는 블록 타입은
 * `unsupported` 로 감싸 보존하고(F-01-02: 버리면 구버전 클라이언트가 페이지를
 * 열었다 닫는 것만으로 데이터가 사라진다), 구조가 성립하지 않는 것은 거부한다.
 *
 * 거부 대상:
 *   - id 가 uuid 가 아니거나 중복
 *   - `properties.title` 이 RichText[] 계약 위반
 *   - 자식을 가질 수 없는 타입에 자식이 붙어 있음
 *   - `type='page'` 노드에 자식이 붙어 있음 — 자식 페이지의 본문은 **그 페이지의
 *     문서**에 속한다. 여기서 받아주면 두 문서가 같은 블록을 소유하게 된다
 *   - 깊이가 `MAX_TREE_DEPTH` 초과
 */
export function validateDoc(doc: EditorDoc): DocIssue[] {
  const issues: DocIssue[] = []
  const seen = new Set<string>()

  const walk = (blocks: readonly EditorBlock[], path: string, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) {
      issues.push({ path, message: `깊이가 상한(${MAX_TREE_DEPTH})을 넘습니다` })
      return
    }

    blocks.forEach((block, i) => {
      const p = `${path}[${i}]`

      if (typeof block?.id !== 'string' || !isUuid(block.id)) {
        issues.push({ path: `${p}.id`, message: 'uuid 여야 합니다' })
      } else if (seen.has(block.id)) {
        issues.push({ path: `${p}.id`, message: `문서에 두 번 나타납니다: ${block.id}` })
      } else {
        seen.add(block.id)
      }

      if (typeof block?.type !== 'string') {
        issues.push({ path: `${p}.type`, message: '문자열이어야 합니다' })
        return
      }

      // 모르는 타입은 오류가 아니다 — unsupported 로 감싸 보존한다.
      const known = isKnownBlockType(block.type)

      if (block.title !== undefined) {
        const titleIssues = validateRichText(block.title, `${p}.title`)
        issues.push(...titleIssues)
      }

      // 이미지의 `source` 는 화면에서 `<img src>` 와 "원본 열기" 링크에 그대로
      // 들어간다. 화면에서만 막으면 API 로 직접 저장하는 경로가 열려 있다.
      if (block.type === IMAGE_TYPE) {
        issues.push(...validateImageProperties(block.properties, `${p}.properties`))
      }

      const children = block.children ?? []
      if (children.length > 0) {
        if (block.type === PAGE_TYPE) {
          issues.push({
            path: `${p}.children`,
            message:
              '자식 페이지의 본문은 그 페이지의 문서에 속합니다. 여기에 넣으면 두 문서가 같은 블록을 소유합니다.',
          })
          return
        }
        if (known && !specOf(block.type).canHaveChildren) {
          issues.push({
            path: `${p}.children`,
            message: `${block.type} 은 자식 블록을 가질 수 없습니다`,
          })
          return
        }
        walk(children, `${p}.children`, depth + 1)
      }
    })
  }

  if (!Array.isArray(doc?.blocks)) {
    return [{ path: 'blocks', message: '배열이어야 합니다' }]
  }
  walk(doc.blocks, 'blocks', 1)
  return issues
}

// ── DB 행 → 문서 ──────────────────────────────────────────────────────

/** 프로젝터가 읽고 쓰는 행의 모양. `block` 테이블의 부분집합이다. */
export type BodyRow = {
  readonly id: string
  readonly type: string
  readonly parent_id: string
  readonly order_key: string
  readonly properties: Record<string, unknown> | null
  readonly format: Record<string, unknown> | null
}

/**
 * 평평한 행 목록을 중첩 문서로 만든다.
 *
 * 정렬은 B7 이 정한 `order_key, id` 다. DB 에서 이미 그 순서로 읽어 오지만
 * 여기서 한 번 더 정렬한다 — 이 함수는 순수 함수여야 테스트할 수 있고,
 * 호출자가 정렬을 빠뜨린 경우를 조용히 넘기면 순서 버그가 여기서 새 나간다.
 *
 * `pageId` 의 직접 자식부터 시작한다. `type='page'` 자식은 **참조 노드**로
 * 문서에 들어가지만 그 자손은 따라가지 않는다(그건 그 페이지의 문서다).
 */
export function rowsToDoc(pageId: string, rows: readonly BodyRow[]): EditorDoc {
  const byParent = new Map<string, BodyRow[]>()
  for (const row of rows) {
    const list = byParent.get(row.parent_id)
    if (list) list.push(row)
    else byParent.set(row.parent_id, [row])
  }
  for (const list of byParent.values()) {
    list.sort((a, b) =>
      a.order_key < b.order_key ? -1
      : a.order_key > b.order_key ? 1
      : a.id < b.id ? -1
      : a.id > b.id ? 1
      : 0,
    )
  }

  const build = (parentId: string): EditorBlock[] =>
    (byParent.get(parentId) ?? []).map((row) => {
      const { title, ...rest } = (row.properties ?? {}) as Record<string, unknown>
      const type = (isKnownBlockType(row.type) ? row.type : UNSUPPORTED_TYPE) as BlockType

      return {
        id: row.id,
        type,
        title: Array.isArray(title) ? (title as RichTextRun[]) : [],
        properties: rest,
        format: (row.format ?? {}) as BlockFormat,
        // 자식 페이지의 본문은 따라가지 않는다.
        children: type === PAGE_TYPE ? [] : build(row.id),
      }
    })

  return { blocks: build(pageId) }
}

// ── 문서 → DB 행 ──────────────────────────────────────────────────────

export type ProjectedBlock = {
  readonly id: string
  readonly type: BlockType
  readonly parentId: string
  readonly orderKey: string
  readonly ancestorPath: readonly string[]
  readonly properties: Record<string, unknown>
  readonly format: BlockFormat
  /** 트리 순서상 몇 번째인가. 쓰기 순서를 결정론적으로 만든다. */
  readonly position: number
}

export type Projection = {
  readonly blocks: readonly ProjectedBlock[]
  /** 문서에 나타난 `type='page'` 참조 노드들. 프로젝터는 순서만 건드린다. */
  readonly pageRefIds: readonly string[]
}

/**
 * 형제 n개의 `order_key`.
 *
 * `orderKeysBetween(null, null, n)` 은 **결정론적**이다 — 같은 n 이면 항상
 * 같은 배열(a0, a1, …)이 나온다. 그래서 `order_key` 가 문서 위치의 순수 함수가
 * 되고, 판결 X-1 의 "파생"이 문자 그대로 성립한다.
 *
 * 부수효과 하나가 공짜로 따라온다: **문서가 안 바뀌면 키도 안 바뀌므로
 * 저장이 UPDATE 0건이다.** 매번 전체를 다시 쓰는 프로젝터의 쓰기 증폭
 * (마스터 문서 §9-Q1)이 "실제로 순서가 바뀐 형제 그룹"으로 한정된다.
 */
function siblingKeys(count: number): string[] {
  return orderKeysBetween(null, null, count)
}

/**
 * 문서를 `block` 행으로 투영한다. **프로젝터의 순수 부분.**
 *
 * 모르는 타입은 `wrapUnsupported()` 로 감싼다 — 원본 타입과 페이로드를 통째로
 * 보존해야 라운드트립 손실이 없다(F-01-02).
 *
 * @param pageId 이 문서를 소유한 페이지. 최상위 블록들의 `parent_id`.
 * @param pageAncestorPath 페이지 자신의 `ancestor_path`. 본문 블록의 경로는
 *   여기에 페이지 id 를 이어 시작한다 [X-7].
 */
export function projectDocument(
  pageId: string,
  pageAncestorPath: readonly string[],
  doc: EditorDoc,
): Projection {
  const blocks: ProjectedBlock[] = []
  const pageRefIds: string[] = []
  let position = 0

  const walk = (
    siblings: readonly EditorBlock[],
    parentId: string,
    ancestorPath: readonly string[],
  ): void => {
    const keys = siblingKeys(siblings.length)

    siblings.forEach((block, i) => {
      const wrapped = wrapUnsupported(block.type, block.properties, block.format)
      const type = (wrapped?.type ?? block.type) as BlockType

      const properties: Record<string, unknown> = wrapped
        ? { ...wrapped.properties }
        : { ...(block.properties ?? {}) }

      // title 은 properties 안에 산다(정본 §3.4). 계약 정규형으로 넣는다.
      if (specOf(type).hasRichText) {
        properties.title = canonicalizeRuns(block.title ?? [])
      } else {
        delete properties.title
      }

      const projected: ProjectedBlock = {
        id: block.id,
        type,
        parentId,
        orderKey: keys[i],
        ancestorPath,
        properties,
        format: normalizeFormat(type, block.format),
        position: position++,
      }
      blocks.push(projected)

      if (type === PAGE_TYPE) {
        pageRefIds.push(block.id)
        return // 자식 페이지의 본문은 이 문서의 것이 아니다
      }

      const children = block.children ?? []
      if (children.length > 0) {
        walk(children, block.id, [...ancestorPath, block.id])
      }
    })
  }

  walk(doc.blocks, pageId, [...pageAncestorPath, pageId])
  return { blocks, pageRefIds }
}
