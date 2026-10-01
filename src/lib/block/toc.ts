/**
 * 목차 — 페이지의 헤딩에서 그릴 때 계산한다 (잔여 묶음 8b-1 · F-01-16 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 목차(`type='table_of_contents'`)
 *       01-block-editor.md F-01-16 *"저장된 콘텐츠가 아니라 페이지 구조로부터 렌더 시점에 계산되는 블록"*
 *
 * 편집기(`editor/toc-plugin.ts` — ProseMirror 문서에서)와 Markdown 내보내기(`export/markdown.ts` — 블록 트리에서)가 **같은 규칙**을
 * 쓴다. 헤딩을 모으는 걸음만 둘이고(문서의 모양이 다르다) 고르기 · 들여쓰기는 여기 한 곳이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 규칙 — F-01-16 이 `[확인필요]` 로 남긴 수집 범위를 정했다(HANDOFF §3.2)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   ① 이 페이지 본문의 **모든 헤딩**(제목 1~3) — 깊이와 상관없이(토글 · 목록 · 콜아웃 안도) 문서 순서로. 접힌 토글 안도 넣는다 —
 *      접힘은 보는 사람의 상태이고(F-01-13), 누르면 조상을 펼친다(F-01-16 *"목차 자신이 접힌 토글 안에 있어도 전체 헤딩"*).
 *      하위 페이지의 본문은 아니다(참조 블록은 자식이 없다)
 *   ② **글자가 없는 헤딩은 뺀다** — 누를 이름이 없다. 멘션 · 수식만 있는 헤딩은 글자가 있는 것이다(이름은 그릴 때 찾는다)
 *   ③ 들여쓰기는 **쓰인 수준의 순위**다 — 제목 1 없이 제목 3 만 있으면 제목 3 이 맨 왼쪽(F-01-16 *"최상위 레벨로 평탄화"*).
 *      제목 1 · 3 만 있으면 3 은 한 칸
 *   ④ 항목의 자리는 **블록 id** 다 — 같은 제목이 여럿이어도 갈린다(F-01-16)
 */

import type { RichTextRun } from '../contracts/rich-text.ts'

/** 목차의 블록 타입 이름(`block.type` · 공개 API 와 같다). */
export const TOC_TYPE = 'table_of_contents'

export type HeadingLevel = 1 | 2 | 3

/** 페이지의 헤딩 하나 — 문서 순서로 모은 것. */
export type TocHeading = {
  readonly id: string
  readonly level: HeadingLevel
  readonly title: readonly RichTextRun[]
}

/** 목차의 한 줄 — 헤딩과 들여쓰기 칸 수(0 부터). */
export type TocEntry = TocHeading & { readonly depth: number }

const LEVEL_OF: ReadonlyMap<string, HeadingLevel> = new Map<string, HeadingLevel>([
  ['heading_1', 1],
  ['heading_2', 2],
  ['heading_3', 3],
])

/** 블록 타입 → 헤딩 수준. 헤딩이 아니면 null. */
export function headingLevelOf(type: string): HeadingLevel | null {
  return LEVEL_OF.get(type) ?? null
}

/** 누를 이름이 있는가(규칙 ②) — 공백이 아닌 글자가 있거나 멘션 · 수식이 있다. */
export function hasTocLabel(title: readonly RichTextRun[]): boolean {
  return title.some((run) => run.type !== 'text' || (run.plain_text ?? '').trim() !== '')
}

/** 모은 헤딩 → 목차의 줄. 이름 없는 헤딩을 빼고(②) 쓰인 수준의 순위로 들여 쓴다(③). */
export function tocEntries(headings: readonly TocHeading[]): TocEntry[] {
  const kept = headings.filter((h) => hasTocLabel(h.title))
  const levels = [...new Set(kept.map((h) => h.level))].sort((a, b) => a - b)
  return kept.map((h) => ({ ...h, depth: levels.indexOf(h.level) }))
}

/** 블록 트리 — 본문 문서(`EditorDoc`)와 같은 모양에서 필요한 칸만. */
type BlockLike = {
  readonly id: string
  readonly type: string
  readonly title?: readonly RichTextRun[]
  readonly children?: readonly BlockLike[]
}

/** 블록 트리의 헤딩을 문서 순서로(규칙 ①) — 내보내기가 쓴다. 편집기는 ProseMirror 문서를 같은 순서로 걷는다(`toc-plugin.ts`). */
export function headingsOfBlocks(blocks: readonly BlockLike[]): TocHeading[] {
  const out: TocHeading[] = []
  const walk = (siblings: readonly BlockLike[]): void => {
    for (const block of siblings) {
      const level = headingLevelOf(block.type)
      if (level !== null) out.push({ id: block.id, level, title: block.title ?? [] })
      walk(block.children ?? [])
    }
  }
  walk(blocks)
  return out
}
