/**
 * 복제의 id 재매핑 규칙 — 복제 6a조각 (F-02-09 · F-08-01 · DOM · DB 없음)
 *
 * 정본: 02-page-workspace.md F-02-09 · 08-templates-automation.md F-08-01
 *       마스터 문서 §5.2-6(*"id 재매핑 규칙(서브트리 내부 참조 → 사본 / 외부 참조 → 원본 유지)을 여기서 고정한다"*)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 안쪽은 사본을, 바깥은 원본을 가리킨다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 복제되는 서브트리 **안**을 가리키던 참조는 사본 안으로 옮겨 붙이고, **밖**을 가리키던 참조는 원본을 그대로 가리킨다.
 *
 * F-02-09 는 이것이 노션과 다를 수 있다고 적는다 — *"우세 가설: 노션은 재매핑하지 않는다(사본 A' 의 링크가 여전히
 * 원본 B 를 가리킨다)"*. 그럼에도 재매핑을 고르는 이유는 템플릿이다: "기획 템플릿"을 복제했는데 사본의 목차가 **원본**
 * 템플릿의 문서를 가리키면, 사본을 고칠수록 링크가 엉뚱한 곳을 가리킨다. 02 문서의 결론(*"의도적으로 원본보다 나은
 * 동작을 택하는 지점"*)을 그대로 따른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 참조인가
 * ──────────────────────────────────────────────────────────────────────
 *
 *   하위 페이지 참조   `type: 'page'` 블록. 그 **블록 id 가 곧 하위 페이지의 id** 다(`page-refs.ts`)
 *   페이지 멘션        rich text 의 `mention: { type: 'page', page: { id } }`(`contracts/rich-text.ts`)
 *
 * 사람 멘션(`user`)은 재매핑하지 않는다 — 복제해도 같은 사람이다. 수식 · 링크 URL 도 그대로다.
 *
 * rich text 가 들어가는 자리는 `title` 과 `properties.caption` 둘이다(정본에서 caption 은 RichText[] 다). 둘 다 훑는다 —
 * 새 블록 타입이 rich text 를 **다른 이름**의 프로퍼티에 담게 되면 여기에 더해야 한다(`RICH_TEXT_PROPERTIES`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 블록 id 는 전부 새로 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 사본의 블록은 새 행이다. 원본의 id 를 물려주면 `block.id` 가 부딪힌다. 다만 **하위 페이지 참조만은 예외**다 — 그 id 는
 * 블록 id 이기 전에 **그 페이지의 id** 이므로, 새로 만든 사본 페이지의 id 를 받아야 한다. 복제하지 않은 하위 페이지의
 * 참조(볼 수 없어서 · 상한에 걸려서)는 **뺀다**: 사본이 남의 페이지를 자기 본문에 매달 수는 없다.
 */

import { mentionTarget, pageMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { PAGE_TYPE } from './types.ts'

/** 원본 페이지 id → 사본 페이지 id. 이 맵에 있는 것이 "서브트리 안"이다. */
export type PageIdMap = ReadonlyMap<string, string>

/** rich text 를 담는 프로퍼티 이름(머리말). `title` 은 블록의 1급 필드라 여기 없다. */
export const RICH_TEXT_PROPERTIES: readonly string[] = ['caption']

/** 런 하나의 페이지 멘션을 사본으로 옮긴다. 대상이 맵에 없으면(서브트리 밖) 그대로다. */
function remapRun(run: RichTextRun, pages: PageIdMap): RichTextRun {
  const target = mentionTarget(run)
  if (target === null || target.kind !== 'page') return run
  const copy = pages.get(target.id)
  if (copy === undefined) return run
  // 서식(annotations)은 지키고 대상만 바꾼다 — 굵게 쓴 멘션은 사본에서도 굵다.
  return pageMentionRun(copy, run.annotations)
}

const remapRuns = (runs: readonly RichTextRun[], pages: PageIdMap): RichTextRun[] =>
  runs.map((run) => remapRun(run, pages))

/** rich text 를 담는 프로퍼티만 훑는다. 나머지(`source` · `checked` · 보존된 원본)는 그대로 옮긴다. */
function remapProperties(
  properties: Readonly<Record<string, unknown>> | undefined,
  pages: PageIdMap,
): Readonly<Record<string, unknown>> | undefined {
  if (properties === undefined) return undefined
  let next: Record<string, unknown> | null = null
  for (const key of RICH_TEXT_PROPERTIES) {
    const value = properties[key]
    if (!Array.isArray(value)) continue
    next ??= { ...properties }
    next[key] = remapRuns(value as RichTextRun[], pages)
  }
  return next ?? properties
}

/**
 * 사본의 본문을 만든다 — 머리말의 규칙 전부가 여기 모인다.
 *
 * @param pages   원본 페이지 id → 사본 페이지 id. **복제 대상 서브트리 전체**가 들어 있어야 한다(자기 자신 포함).
 * @param newBlockId 새 블록 id 를 만드는 함수. 호출자가 주는 이유는 이 모듈이 순수해야 해서다(검사가 결정론적으로 돈다).
 */
export function remapBody(doc: EditorDoc, pages: PageIdMap, newBlockId: () => string): EditorDoc {
  return { blocks: remapBlocks(doc.blocks, pages, newBlockId) }
}

function remapBlocks(
  blocks: readonly EditorBlock[],
  pages: PageIdMap,
  newBlockId: () => string,
): EditorBlock[] {
  const out: EditorBlock[] = []
  for (const block of blocks) {
    if (block.type === PAGE_TYPE) {
      // 하위 페이지 참조. 복제한 것만 남기고, 그 자리는 **사본의 id** 를 받는다.
      const copy = pages.get(block.id)
      if (copy !== undefined) out.push({ ...block, id: copy })
      continue
    }
    out.push({
      ...block,
      id: newBlockId(),
      title: remapRuns(block.title, pages),
      ...(block.properties === undefined ? {} : { properties: remapProperties(block.properties, pages) }),
      ...(block.children === undefined ? {} : { children: remapBlocks(block.children, pages, newBlockId) }),
    })
  }
  return out
}

/** 사본 제목의 꼬리표. 02 F-02-09 의 *"'Untitled (1)' 형태의 사본"*. */
export const COPY_SUFFIX = ' (1)'

/**
 * 사본의 제목 — 원본 뒤에 꼬리표를 붙인다.
 *
 * 마지막 런에 이어 붙인다(새 런을 더하면 서식이 끊겨 "제목" + 기본 서식 " (1)" 로 보인다). 빈 제목이면 꼬리표만 남는다 —
 * 화면이 "제목 없음"을 그리던 자리가 " (1)" 이 되는 것이 맞다: 사본임을 말해 주는 유일한 자리다.
 *
 * **몇 번째 사본인지는 세지 않는다.** `(2)` 를 붙이려면 형제의 제목을 전부 읽어 맞춰야 하고, 그러는 사이 남이 같은 이름을
 * 만들면 어차피 어긋난다. 이름이 겹쳐도 되는 제품이다(같은 이름의 페이지를 막지 않는다).
 */
export function duplicateTitle(title: readonly RichTextRun[]): RichTextRun[] {
  const last = title[title.length - 1]
  if (last === undefined || last.type !== 'text' || last.text === undefined) {
    return [...title, { ...pageSuffixRun() }]
  }
  const content = `${last.text.content}${COPY_SUFFIX}`
  return [...title.slice(0, -1), { ...last, text: { ...last.text, content }, plain_text: content }]
}

function pageSuffixRun(): RichTextRun {
  // 서식 없는 꼬리표 하나. `textRun` 을 쓰지 않는 이유는 이 모듈이 계약 모듈에 값으로 기대는 것을 하나로 줄이려는 것뿐이다.
  return {
    type: 'text',
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    plain_text: COPY_SUFFIX,
    href: null,
    text: { content: COPY_SUFFIX, link: null },
  }
}
