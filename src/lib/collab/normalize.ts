/**
 * 본문 트리 정규화 — 동시 편집이 만든 구조 위반을 결정론적으로 고친다 (F-05-01)
 *
 * 정본: 05-collaboration-sync.md F-05-01 엣지 케이스 · 판결 X-1
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 필요한가 — Yjs 는 트리 제약을 모른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 따로 보면 스키마에 맞는 편집 두 개가, 합치면 스키마(`schema.ts`)를 어긴다. Y.Doc 에는 그 위반이
 * 그대로 쌓인다. `ydoc.ts` 의 읽기가 Y 요소를 **검사하지 않고** ProseMirror 노드로 옮겨 이 함수에 넘긴다 —
 * y-prosemirror 의 변환은 `createChecked` 로 만들다 던지면 그 Y 요소를 지우므로 쓰지 않는다(`ydoc.ts`
 * 머리말). 고치지 않고 `pmToDoc` 에 넣으면 내용 노드 자리에서 그룹을 읽는다.
 *
 *   동시 편집                                   합친 결과                  고치는 법
 *   ─────────────────────────────────────────  ────────────────────────  ─────────────────────────────
 *   둘이 같은 블록의 타입을 바꾼다               내용 노드 둘              Y 순서의 첫째만 남긴다 ①
 *   둘이 한 그룹의 남은 자식을 하나씩 지운다     빈 그룹                   그룹을 뗀다
 *   둘이 같은 블록 밑으로 처음 들여쓴다          그룹 둘                   순서대로 합친다
 *   둘이 순서를 바꾼다(y-prosemirror 는 옮기지   같은 blockId 둘           문서 순서의 첫째가 갖고
 *     않고 요소를 고쳐 쓴다 — attr 이 LWW)                                 나머지는 결정론적 새 id ②
 *   토글을 제목으로 바꾸는 동안 자식을 넣는다    자식을 못 갖는 타입에 자식  자식을 바로 뒤 형제로 올린다
 *   둘이 빈 페이지를 동시에 처음 채운다          루트 그룹 둘              합친다
 *   하위 페이지 참조를 깊은 곳으로 옮긴다 ③      그 서브트리가 상한을 넘음  들어갈 수 있는 깊이까지 뒤 형제로 올린다
 *   둘이 같은 하위 페이지 참조를 옮긴다 ③        참조 둘(둘째는 새 id)     본문에 둘 수 없는 참조를 뺀다
 *   컬럼 경계 너머로 블록을 옮긴다 ④            컬럼 목록 안의 맨 블록 ·  이웃 컬럼으로 옮긴다 · 컬럼 하나면 푼다 ·
 *                                              컬럼이 하나 · 빈 컬럼     빈 컬럼은 빈 문단으로 채운다
 *   한 사람이 열을 더하는 동안 다른 사람이     셀 수가 다른 행 ·          가장 긴 행에 맞춰 빈 셀로 채운다 · 행이 없으면
 *     행을 더한다 · 마지막 행을 둘이 지운다 ⑤   행 없는 표                빈 셀 하나의 행 하나
 *
 *   ① 타입은 병합할 수 없다(F-05-01 시나리오 4: "한쪽 값만 남는다"). 어느 쪽이 남는지는 Yjs 의
 *      동시 삽입 순서(client id)가 정한다 — "늦게 한 쪽이 이긴다"가 아니다
 *   ② 새 id 는 무작위가 아니다. 무작위면 프로젝터가 읽을 때마다 새 `block` 행을 만든다
 *   ④ 컬럼(Phase 2 1c) — 컬럼 목록의 자식은 컬럼뿐(레지스트리 `childTypes`) · 컬럼은 컬럼 목록 안에만(`parentTypes`) · 컬럼 바로 안의
 *      컬럼 목록은 없다(`excludedChildTypes` — 펼친다) · 컬럼은 둘 이상(`MIN_COLUMNS`) · 빈 컬럼은 캐럿을 둘 곳이 없어 빈 문단을 넣는다.
 *      들여쓰기 · 내어쓰기는 경계를 넘지 않지만(`commands.ts`) 동시 편집 · 붙여넣기 · 끌기가 넘을 수 있다
 *   ⑤ 표(Phase 2 1d) — 행은 표의 내용 노드 안에 산다(컨테이너가 아니다). 행이 아닌 것 · 셀이 아닌 것은 버리고, 셀의 인라인은 텍스트
 *      블록과 같은 청소, 셀의 병합 칸(colspan · rowspan · colwidth)은 1 · null(병합은 저장 모양에 자리가 없다), 행 id 는 블록 id 와
 *      같은 규칙(같은 이름 공간이다). 열을 버리지 않는다 — 모자란 행을 채운다
 *   ③ 동시 편집이 아니어도 생긴다(휴지통 · 다른 본문으로 간 페이지를 가리키는 낡은 참조). 서브트리의 높이와 페이지가 어디
 *      사는지는 문서 밖(DB)에 있어 받았을 때만 본다(`pageRefDepth` · `pageRefs`) — 투영과 그 수선이 넘긴다(HANDOFF §3.2-23 · §3.2-24)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 세 가지 성질
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - **전체 함수** — 어떤 입력에도 던지지 않고 스키마에 맞는 문서를 낸다
 *   - **결정론** — 같은 문서면 같은 결과. 수렴한 두 참여자는 같은 문서를 본다
 *   - **가능하면 잃지 않는다** — 버리는 것은 타입 충돌에서 진 내용 노드와 스키마 자리에 올 수 없는
 *     노드(그룹 자리의 글자 같은 것)뿐이다. 자식은 올리지 버리지 않는다
 */

import type { Node as PmNode } from '@tiptap/pm/model'

import { sanitizeBlockAttrs } from '../block/props.ts'
import { MAX_TREE_DEPTH, MIN_COLUMNS, PAGE_TYPE, specOf, type BlockFormat, type BlockType } from '../block/types.ts'
import { isPlainRecord, jsonSafe, sameJsonValue, withoutNul } from '../contracts/json-safe.ts'
import { isUuid } from '../ids.ts'
import { ATOM_MARKS_ATTR, atomMarksAttr, INLINE_ATOM_NODES } from '../editor/atom-marks.ts'
import {
  blockSchema,
  blockTypeOfNode,
  EQUATION_NODE,
  isPlainTextNode,
  PAGE_REF_NODE,
  TABLE_CELL_NODE,
  TABLE_NODE,
  TABLE_ROW_NODE,
} from '../editor/schema.ts'
import { TABLE_CELLS_KEY } from '../block/table.ts'

export type NormalizeFix =
  /** 루트에 그룹이 없다. */
  | 'root_group_missing'
  /** 그룹이 둘 이상이다(루트 또는 한 컨테이너 안). */
  | 'groups_merged'
  /** 그룹 안에 그룹이 바로 들어 있다. */
  | 'nested_group_flattened'
  /** 컨테이너 없이 내용 노드가 그룹 자리에 있다 — 새 컨테이너로 감쌌다. */
  | 'content_wrapped'
  /** 그룹 자리에 올 수 없는 노드(글자 · 인라인)를 버렸다. */
  | 'stray_dropped'
  /** 컨테이너에 내용 노드가 없다 — 그 자식을 그 자리로 올렸다. */
  | 'empty_container_lifted'
  /** 컨테이너에 내용 노드가 둘 이상이다 — 첫째만 남겼다. */
  | 'type_conflict_resolved'
  /** 자식이 하나도 남지 않은 그룹을 뗐다. */
  | 'empty_group_removed'
  /** 자식을 못 갖는 타입(또는 깊이 상한)의 자식을 뒤 형제로 올렸다. */
  | 'children_lifted'
  /** 하위 페이지 참조가 받은 깊이(`NormalizeOptions.pageRefDepth`)보다 깊다 — 들어갈 수 있는 깊이까지 뒤 형제로 올렸다. */
  | 'page_ref_lifted'
  /** 본문에 둘 수 있는 하위 페이지(`NormalizeOptions.pageRefs`)가 아닌 참조를 뺐다. */
  | 'page_ref_dropped'
  /** 텍스트 블록 안의 블록 노드 · 원자 블록 안의 자식을 버렸다. */
  | 'invalid_content_dropped'
  /** `props` · `format` 이 평범한 객체가 아니어서(배열 · 공유 타입 · 바이트 배열 …) 빈 객체로 바꿨다. */
  | 'invalid_attrs_reset'
  /**
   * 평문 본문(코드 블록 · 8a-1)에 서식 · 인라인 원자가 섞였다 — 서식을 떼고 수식은 식의 글자로 폈다(멘션은 보이는 글자를
   * 저장하지 않으므로 뺐다). 동시 편집(한 사람이 굵게 · 다른 사람이 코드로 바꾸기)에서 생긴다.
   */
  | 'plain_text_flattened'
  /**
   * 속성 모양이 틀렸다 — JSON 으로 나타낼 수 없는 값(bigint …)이 있다 · 캡션의 런이 계약을 어겼거나 배열이 아니다 · 코드의 언어가
   * 문자열이 아니거나 64자를 넘는다 · format 에 타입이 받지 않는 값(색 · `code_wrap`)이 있다. 고쳐서 남긴다(`block/props.ts` · 8a-2 ·
   * 정본 §3.4 [보강] 코드 블록 ⑧ — 모양이 틀린 캡션 하나가 그 페이지의 투영 · 색인 · 복제를 영구히 멈췄다).
   */
  | 'invalid_props_dropped'
  /**
   * 인라인 원자의 속성 모양이 틀렸다 — 식이 문자열이 아닌 수식 · 대상이 평범한 객체가 아닌 멘션은 뺐고, 멘션의 보이는 글자가
   * 문자열이 아니면 비웠고, JSON 으로 나타낼 수 없는 값은 뺐고, 서식의 거울(`marks`)을 되살린 마크에서 다시 만들었다(8a-2 · 정본 ⑧
   * — 어댑터의 `String()` · 투영의 직렬화 · 편집기의 마크 비교가 던졌고, 공유 타입이 든 `marks` 는 수선의 비교가 스택을 넘겼다).
   */
  | 'invalid_inline_fixed'
  /** 글자의 U+0000 을 U+FFFD 로 바꿨다 — jsonb 가 받지 않아 투영이 영구히 멈췄다(8a-2 리뷰 · 정본 ⑧). */
  | 'nul_replaced'
  /** blockId 가 비었거나 uuid 가 아니다 — 새 id. */
  | 'blank_id'
  /** blockId 가 문서에 두 번 이상 나온다 — 첫째 뒤의 것은 새 id. */
  | 'duplicate_id'
  /** 남은 블록이 없다 — 빈 문단 하나를 넣었다(`ydoc.ts` 머리말). */
  | 'empty_root_filled'
  /** 컬럼 목록 밖의 컬럼 — 풀어 자식을 그 자리에 올렸다(Phase 2 1c). */
  | 'column_unwrapped'
  /** 컬럼 바로 안의 컬럼 목록 — 펼쳤다(중첩 금지). */
  | 'nested_columns_flattened'
  /** 컬럼 목록 안의 컬럼이 아닌 블록 — 이웃 컬럼으로 옮겼다(앞 컬럼의 끝 · 앞이 없으면 뒤 컬럼의 처음). */
  | 'column_misplaced_moved'
  /** 컬럼이 하나뿐 — 풀어 자식을 그 자리에 올렸다. 하나도 없으면 컬럼 목록을 뺐다. */
  | 'single_column_unwrapped'
  /** 빈 컬럼 — 빈 문단을 넣었다(캐럿을 둘 곳). */
  | 'empty_column_filled'
  /** 행이 없는 표 — 빈 셀 하나의 행 하나를 넣었다(Phase 2 1d). */
  | 'table_filled'
  /** 셀 수가 모자란 행 — 가장 긴 행에 맞춰 빈 셀로 채웠다. */
  | 'table_cells_padded'
  /** 셀의 병합 칸(colspan · rowspan · colwidth)을 1 · null 로 되돌렸다 — 병합은 저장 모양에 자리가 없다. */
  | 'table_cell_reset'

export type NormalizeResult = {
  /** 스키마에 맞는 문서. 고칠 것이 없었어도 새로 조립한 노드다 — 입력과는 `eq` 로 비교한다. */
  readonly doc: PmNode
  /** 고친 것. 비었으면 입력이 이미 올발랐다. 같은 종류가 여러 번 나올 수 있다. */
  readonly fixes: readonly NormalizeFix[]
}

export type NormalizeOptions = {
  /**
   * 새 id 의 씨앗 — 페이지 id 를 넣는다. 빈 id 는 **위치**로 새 id 를 만드는데 위치는 페이지마다
   * 겹친다. 씨앗이 없으면 두 페이지의 같은 자리 블록이 같은 id(= 같은 `block` 행)를 받는다.
   */
  readonly seed: string
  /**
   * 하위 페이지 참조가 놓일 수 있는 가장 깊은 본문 깊이(최상위 블록 = 1) — 참조하는 페이지 id → 깊이. 더 깊은 참조는 부모의
   * 바로 뒤 형제로, 들어갈 때까지 한 단씩 올린다(`page_ref_lifted`). 없는 참조는 보지 않는다.
   *
   * 그 페이지 서브트리의 높이는 DB 에만 있으므로 문서만 보고는 알 수 없다 — 참여자 경로의 투영과 그 수선만 넘긴다
   * (`block/body-write.ts` `pageRefDepthLimits`). 둘이 같은 값을 넘기므로 수선된 Y.Doc 은 이것 없이 읽어도 같은 문서다.
   */
  readonly pageRefDepth?: ReadonlyMap<string, number>
  /**
   * 이 본문에 둘 수 있는 하위 페이지 — 이 본문 범위의 **살아 있는** 페이지 id. 다른 id 의 참조는 뺀다(`page_ref_dropped`). 없으면
   * 보지 않는다.
   *
   * 페이지가 있는지 · 어디 사는지 · 휴지통에 갔는지는 행이 정한다 — 문서의 참조가 페이지를 만들거나 옮기거나 되살리지 않는다.
   * 같은 참조를 둘이 동시에 옮기면 둘째가 새 id 를 받고(위의 id 규칙) 그 id 는 어떤 페이지도 아니다. 투영과 그 수선만
   * 넘긴다(`block/body-write.ts`) — 뺀 Y.Doc 은 이것 없이 읽어도 같은 문서다.
   */
  readonly pageRefs?: ReadonlySet<string>
}

const { doc: DOC, blockGroup: GROUP, blockContainer: CONTAINER, paragraph: PARAGRAPH } = blockSchema.nodes
const { [TABLE_ROW_NODE]: TABLE_ROW, [TABLE_CELL_NODE]: TABLE_CELL } = blockSchema.nodes

/** 컨테이너의 블록 타입. */
const typeOfContainer = (container: PmNode): BlockType | null =>
  container.firstChild === null ? null : blockTypeOfNode(container.firstChild.type.name)

/** 컨테이너의 자식 컨테이너들. */
const childContainers = (container: PmNode): PmNode[] => (container.childCount > 1 ? childrenOf(container.child(1)) : [])

function childrenOf(node: PmNode): PmNode[] {
  const out: PmNode[] = []
  node.forEach((child) => out.push(child))
  return out
}

function isBlockContent(node: PmNode): boolean {
  return (node.type.spec.group ?? '').split(' ').includes('blockContent')
}

/**
 * 텍스트 블록 안의 인라인 노드 하나 — 고칠 것이 없으면 같은 노드, 뺄 것이면 null(8a-2 · 정본 §3.4 [보강] 코드 블록 ⑧).
 *
 *   · 글자: U+0000 을 U+FFFD 로(jsonb 가 받지 않는다). 글자의 마크 attr 은 어댑터가 모양을 확인하고 읽으므로(색 · 링크) 보지 않는다
 *   · 원자(수식 · 멘션): 투영이 읽는 attr(식 · 대상 · 보이는 글자)과 서식의 거울(`marks`). 거울은 **되살린 마크에서 다시 만든다** —
 *     읽기(`ydoc.ts`)가 원본 Y 의 값을 그대로 싣기 때문이다(공유 타입 · 하위 문서 · bigint). 멀쩡한 원자의 거울은 그대로다
 *     (`createInlineAtom` 이 쓴 모양이 곧 정규형이다)
 */
function cleanInline(child: PmNode): PmNode | null {
  if (child.isText) {
    const text = child.text ?? ''
    const safe = withoutNul(text)
    return safe === text ? child : blockSchema.text(safe, child.marks)
  }
  if (!INLINE_ATOM_NODES.has(child.type.name)) return child
  let attrs: Record<string, unknown> = child.attrs
  const set = (key: string, value: unknown): void => {
    if (attrs === child.attrs) attrs = { ...child.attrs }
    attrs[key] = value
  }
  const marks = atomMarksAttr(child.marks)
  if (!sameJsonValue(child.attrs[ATOM_MARKS_ATTR] ?? null, marks)) set(ATOM_MARKS_ATTR, marks)
  if (child.type.name === EQUATION_NODE) {
    const expression: unknown = child.attrs.expression
    if (typeof expression !== 'string') return null
    if (withoutNul(expression) !== expression) set('expression', withoutNul(expression))
  } else {
    const mention = jsonSafe(child.attrs.mention)
    if (!isPlainRecord(mention)) return null
    if (mention !== child.attrs.mention) set('mention', mention)
    const plainText = typeof child.attrs.plainText === 'string' ? withoutNul(child.attrs.plainText) : ''
    if (plainText !== child.attrs.plainText) set('plainText', plainText)
  }
  return attrs === child.attrs ? child : child.type.create(attrs, null, child.marks)
}

/** 내용 노드가 자식 블록을 가질 수 있는가. 하위 페이지 참조 밑은 그 페이지의 문서라 안 된다. */
function canNest(content: PmNode): boolean {
  if (content.type.name === PAGE_REF_NODE) return false
  // 노드 이름은 타입 이름이 아닐 수 있다(`code_block` → `code`) — 이름을 그대로 `specOf` 에 넣으면 undefined 다(8a-1).
  const type = blockTypeOfNode(content.type.name)
  // 표의 행은 내용 노드 안에 산다(Phase 2 1d) — 컨테이너의 자식 그룹이 아니다. 그룹에 온 자식은 뒤 형제로 올린다.
  return specOf(type).canHaveChildren && !specOf(type).childrenInContent && type !== PAGE_TYPE
}

export function normalizeBody(input: PmNode, options: NormalizeOptions): NormalizeResult {
  const fixes: NormalizeFix[] = []
  /** 이미 누군가 가진 id — 진짜 id 와 새로 만든 id 모두. */
  const claimed = new Set<string>()
  const occurrences = new Map<string, number>()

  const newId = (seed: string): string => {
    let id = derivedBlockId(`${options.seed}|${seed}`)
    for (let i = 1; claimed.has(id); i += 1) id = derivedBlockId(`${options.seed}|${seed}|${i}`)
    claimed.add(id)
    return id
  }

  // 전위 순회 순서로 부른다 — "문서 순서의 첫째가 id 를 갖는다"가 이 호출 순서다.
  const claimId = (raw: unknown, path: string): string => {
    const id = typeof raw === 'string' && isUuid(raw) ? raw : ''
    if (id === '') {
      fixes.push('blank_id')
      return newId(`blank:${path}`)
    }
    const seen = occurrences.get(id) ?? 0
    occurrences.set(id, seen + 1)
    if (seen === 0 && !claimed.has(id)) {
      claimed.add(id)
      return id
    }
    fixes.push('duplicate_id')
    return newId(`${id}:${seen}`)
  }

  /** 텍스트 블록(셀 포함)의 인라인 자식들 — 블록 노드는 버리고 원자 · 글자는 `cleanInline`. */
  const cleanInlineChildren = (node: PmNode): { nodes: PmNode[]; changed: boolean } => {
    const nodes: PmNode[] = []
    let changed = false
    node.forEach((child) => {
      if (!child.isInline) {
        changed = true
        fixes.push('invalid_content_dropped')
        return
      }
      const clean = cleanInline(child)
      if (clean !== child) {
        changed = true
        fixes.push(child.isText ? 'nul_replaced' : 'invalid_inline_fixed')
      }
      if (clean !== null) nodes.push(clean)
    })
    return { nodes, changed }
  }

  /**
   * 표의 행들(⑤ · Phase 2 1d) — 행이 아닌 것 · 셀이 아닌 것은 버리고 셀의 인라인을 청소한다 · 병합 칸은 1 · null · 행 id 는 블록 id 의
   * 규칙 · 셀 밖의 행 속성은 평범한 객체(셀 키는 뺀다) · 모자란 행은 가장 긴 행에 맞춰 빈 셀로 · 행이 없으면 빈 셀 하나의 행 하나.
   */
  const cleanTableRows = (table: PmNode, path: string): { rows: PmNode[]; changed: boolean } => {
    type Row = { id: string; props: Record<string, unknown>; cells: PmNode[]; changed: boolean; node: PmNode | null }
    const rows: Row[] = []
    let dropped = false
    table.forEach((row, _offset, r) => {
      if (row.type !== TABLE_ROW) {
        dropped = true
        fixes.push('invalid_content_dropped')
        return
      }
      let rowChanged = false
      const cells: PmNode[] = []
      row.forEach((cell) => {
        if (cell.type !== TABLE_CELL) {
          rowChanged = true
          fixes.push('invalid_content_dropped')
          return
        }
        const inline = cleanInlineChildren(cell)
        const spanned = cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1 || cell.attrs.colwidth !== null
        if (spanned) fixes.push('table_cell_reset')
        if (inline.changed || spanned) {
          rowChanged = true
          cells.push(TABLE_CELL!.create(null, inline.nodes))
        } else cells.push(cell)
      })
      const id = claimId(row.attrs.rowId, `${path}.row${r}`)
      if (id !== row.attrs.rowId) rowChanged = true
      const safe = jsonSafe(row.attrs.props)
      let props: Record<string, unknown> = isPlainRecord(safe) ? safe : {}
      if (props !== row.attrs.props) {
        rowChanged = true
        fixes.push('invalid_attrs_reset')
      }
      if (Object.hasOwn(props, TABLE_CELLS_KEY)) {
        props = { ...props }
        delete props[TABLE_CELLS_KEY]
        rowChanged = true
        fixes.push('invalid_props_dropped')
      }
      rows.push({ id, props, cells, changed: rowChanged, node: row })
    })
    if (rows.length === 0) {
      fixes.push('table_filled')
      rows.push({ id: newId(`table:${path}`), props: {}, cells: [], changed: true, node: null })
    }
    const width = Math.max(1, ...rows.map((row) => row.cells.length))
    for (const row of rows) {
      if (row.cells.length >= width) continue
      fixes.push('table_cells_padded')
      row.cells.push(...Array.from({ length: width - row.cells.length }, () => TABLE_CELL!.create()))
      row.changed = true
    }
    const nodes = rows.map((row) =>
      row.changed || row.node === null ? TABLE_ROW!.create({ rowId: row.id, props: row.props }, row.cells) : row.node,
    )
    return { rows: nodes, changed: dropped || rows.some((row) => row.changed) }
  }

  const cleanContent = (content: PmNode, path: string): PmNode => {
    let changed = false
    const attrs: Record<string, unknown> = { ...content.attrs }
    for (const key of ['props', 'format']) {
      if (key in attrs && !isPlainRecord(attrs[key])) {
        attrs[key] = {}
        changed = true
        fixes.push('invalid_attrs_reset')
      }
    }
    // 알려진 타입의 속성을 정화한다(8a-2) — 모양이 틀린 캡션 · 언어 · format. 하위 페이지 참조 · unsupported 는 건드리지 않는다.
    const sanitized = sanitizeBlockAttrs(
      blockTypeOfNode(content.type.name),
      (attrs.props ?? {}) as Record<string, unknown>,
      (attrs.format ?? {}) as BlockFormat,
    )
    if (sanitized.changed) {
      attrs.props = sanitized.props
      attrs.format = sanitized.format
      changed = true
      fixes.push('invalid_props_dropped')
    }
    const inline: PmNode[] = []
    if (isPlainTextNode(content)) {
      // 평문 본문은 글자만 — 서식을 떼고, 수식은 식의 글자로 편다(멘션은 보이는 글자가 없으니 뺀다). 스키마(`text*` · 마크 없음)가
      // 받지 않는 것을 남기면 편집기의 다음 변환(`createChecked`)이 그 요소를 지운다(`ydoc.ts` 머리말).
      let flattened = false
      content.forEach((child) => {
        if (!child.isInline) {
          changed = true
          fixes.push('invalid_content_dropped')
          return
        }
        // 수식 원자의 식은 attr 이다 — 협업 참여자가 무엇이든 쓸 수 있으므로 문자열일 때만 읽는다(String() 은 던질 수 있다).
        const expression = child.attrs.expression
        const raw = child.isText ? (child.text ?? '') : typeof expression === 'string' ? expression : ''
        if (!child.isText || child.marks.length > 0) flattened = true
        // jsonb 가 받지 않는 U+0000 은 바꾼다(8a-2 · `nul_replaced`).
        const text = withoutNul(raw)
        if (text !== raw) {
          changed = true
          fixes.push('nul_replaced')
        }
        if (text !== '') inline.push(blockSchema.text(text))
      })
      if (flattened) {
        changed = true
        fixes.push('plain_text_flattened')
      }
    } else if (content.type.isTextblock) {
      const cleaned = cleanInlineChildren(content)
      if (cleaned.changed) changed = true
      inline.push(...cleaned.nodes)
    } else if (content.type.name === TABLE_NODE) {
      const cleaned = cleanTableRows(content, path)
      if (cleaned.changed) changed = true
      inline.push(...cleaned.rows)
    } else if (content.childCount > 0) {
      changed = true
      fixes.push('invalid_content_dropped')
    }
    return changed ? content.type.create(attrs, inline, content.marks) : content
  }

  /** 그룹 자리에 온 노드들 → 올바른 컨테이너들. `parent` 는 그 그룹을 가진 블록의 타입(최상위면 null) — 컬럼 규칙이 본다. */
  const containersOf = (nodes: readonly PmNode[], path: string, depth: number, parent: BlockType | null): PmNode[] => {
    const out: PmNode[] = []
    nodes.forEach((node, i) => {
      const here = `${path}.${i}`
      if (node.type === CONTAINER) {
        out.push(...containerOf(node, here, depth, parent))
      } else if (node.type === GROUP) {
        fixes.push('nested_group_flattened')
        out.push(...containersOf(childrenOf(node), here, depth, parent))
      } else if (isBlockContent(node)) {
        fixes.push('content_wrapped')
        const blockId = newId(`wrap:${here}`)
        out.push(CONTAINER.create({ blockId }, [cleanContent(node, here)]))
      } else {
        fixes.push('stray_dropped')
      }
    })
    return out
  }

  /**
   * 컬럼 목록의 자식들 → 컬럼들. 컬럼이 아닌 블록은 앞 컬럼의 끝으로(앞이 없으면 뒤 컬럼의 처음으로) 옮긴다 — 옮긴 것이 컬럼 목록이면
   * 펼친다(컬럼 바로 안이 된다). 컬럼이 하나도 없으면 그 블록들을 `orphans` 로 돌려준다.
   */
  const regroupColumns = (children: readonly PmNode[]): { columns: PmNode[]; orphans: PmNode[] } => {
    const columns: { node: PmNode; before: PmNode[]; after: PmNode[] }[] = []
    let pending: PmNode[] = []
    const flattenNested = (child: PmNode): PmNode[] => {
      if (typeOfContainer(child) !== 'column_list') return [child]
      fixes.push('nested_columns_flattened')
      return childContainers(child).flatMap(childContainers)
    }
    for (const child of children) {
      if (typeOfContainer(child) === 'column') {
        columns.push({ node: child, before: pending, after: [] })
        pending = []
      } else if (columns.length > 0) {
        columns[columns.length - 1]!.after.push(...flattenNested(child))
      } else {
        pending.push(...flattenNested(child))
      }
    }
    if (columns.length === 0) return { columns: [], orphans: pending }
    return {
      columns: columns.map(({ node, before, after }) => {
        if (before.length === 0 && after.length === 0) return node
        fixes.push('column_misplaced_moved')
        return CONTAINER.create(node.attrs, [node.firstChild!, GROUP.create(null, [...before, ...childContainers(node), ...after])])
      }),
      orphans: [],
    }
  }

  /** 컨테이너 하나 → 0개(내용이 없어 자식을 올림) · 1개 · 여러 개(자식을 뒤 형제로 올림). */
  const containerOf = (node: PmNode, path: string, depth: number, parent: BlockType | null): PmNode[] => {
    const contents: PmNode[] = []
    const inner: PmNode[] = []
    let groups = 0
    node.forEach((child) => {
      if (isBlockContent(child)) contents.push(child)
      else if (child.type === GROUP) {
        groups += 1
        inner.push(...childrenOf(child))
      } else inner.push(child)
    })
    if (groups > 1) fixes.push('groups_merged')

    if (contents.length === 0) {
      fixes.push('empty_container_lifted')
      return containersOf(inner, path, depth, parent)
    }
    if (contents.length > 1) fixes.push('type_conflict_resolved')

    // id 를 먼저 받는다 — 표의 행 id(⑤)가 같은 규칙으로 뒤따른다(문서 순서의 첫째가 갖는다).
    const blockId = claimId(node.attrs.blockId, path)
    const content = cleanContent(contents[0], path)
    const type = blockTypeOfNode(content.type.name)
    // ── 컬럼(④) — 설 수 없는 자리의 틀은 풀어 자식을 그 자리에 올린다. ──
    const allowedParents = specOf(type).parentTypes
    if (allowedParents !== undefined && (parent === null || !allowedParents.includes(parent))) {
      fixes.push('column_unwrapped')
      return containersOf(inner, path, depth, parent)
    }
    if (parent !== null && specOf(parent).excludedChildTypes?.includes(type)) {
      fixes.push('nested_columns_flattened')
      return containersOf(inner, path, depth, parent)
    }
    const nestable = canNest(content) && depth < MAX_TREE_DEPTH
    let children = containersOf(inner, path, nestable ? depth + 1 : depth, nestable ? type : parent)
    if (groups > 0 && children.length === 0) fixes.push('empty_group_removed')
    if (nestable && specOf(type).childTypes?.includes('column')) {
      const { columns, orphans } = regroupColumns(children)
      if (columns.length < MIN_COLUMNS) {
        fixes.push('single_column_unwrapped')
        return columns.length === 0 ? orphans : childContainers(columns[0]!)
      }
      children = columns
    }
    if (nestable && type === 'column' && children.length === 0) {
      fixes.push('empty_column_filled')
      children = [CONTAINER.create({ blockId: newId(`column:${path}`) }, [PARAGRAPH.create({ props: {}, format: {} })])]
    }

    // 둘 수 없는 참조는 컨테이너째 뺀다. 참조는 자식을 갖지 못하므로 자식은 이미 이 깊이로 올라와 있다 — 잃지 않는다.
    if (content.type.name === PAGE_REF_NODE && options.pageRefs !== undefined && !options.pageRefs.has(blockId)) {
      fixes.push('page_ref_dropped')
      return children
    }

    if (children.length === 0) return [CONTAINER.create({ blockId }, [content])]
    if (!nestable) {
      fixes.push('children_lifted')
      return [CONTAINER.create({ blockId }, [content]), ...children]
    }
    // 자식 자리(depth + 1)에 들어가지 못하는 참조는 이 컨테이너 뒤로 뺀다. 이 컨테이너를 받은 쪽이 한 단 위에서 다시 본다 —
    // 올라갈 때마다 한 단씩이다. 최상위(깊이 1)보다 위는 없다.
    const lifted = children.filter((child) => deeperThanAllowed(child, depth + 1))
    if (lifted.length === 0) return [CONTAINER.create({ blockId }, [content, GROUP.create(null, children)])]
    fixes.push('page_ref_lifted')
    const kept = children.filter((child) => !lifted.includes(child))
    return [
      CONTAINER.create({ blockId }, kept.length === 0 ? [content] : [content, GROUP.create(null, kept)]),
      ...lifted,
    ]
  }

  /** 이 컨테이너가 `depth` 에 놓이면 받은 깊이를 넘는 하위 페이지 참조인가. */
  const deeperThanAllowed = (container: PmNode, depth: number): boolean => {
    const limit = options.pageRefDepth?.get(String(container.attrs.blockId))
    return limit !== undefined && depth > limit && container.firstChild?.type.name === PAGE_REF_NODE
  }

  const top: PmNode[] = []
  let rootGroups = 0
  input.forEach((child) => {
    if (child.type === GROUP) {
      rootGroups += 1
      top.push(...childrenOf(child))
    } else top.push(child)
  })
  if (rootGroups === 0) fixes.push('root_group_missing')
  else if (rootGroups > 1) fixes.push('groups_merged')

  let containers = containersOf(top, 'r', 1, null)
  if (containers.length === 0) {
    fixes.push('empty_root_filled')
    containers = [CONTAINER.create({ blockId: newId('fill') }, [PARAGRAPH.create({ props: {}, format: {} })])]
  }

  return { doc: DOC.create(null, [GROUP.create(null, containers)]), fixes }
}

// ── 결정론적 id ───────────────────────────────────────────────────────

/**
 * 씨앗 문자열 → uuid 모양의 id. 같은 씨앗이면 같은 id 다.
 *
 * 암호학적 해시가 아니다. 필요한 것은 "우연히 겹치지 않는다"뿐이고, 브라우저 에디터도 같은 함수를
 * **동기로** 불러야 한다(Web Crypto 는 비동기다). cyrb53(퍼블릭 도메인, bryc) 을 씨앗 셋으로 돌려
 * 이어 붙인다.
 */
export function derivedBlockId(seed: string): string {
  const hex = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map((s) => cyrb53(seed, s).toString(16).padStart(14, '0')).join('')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
