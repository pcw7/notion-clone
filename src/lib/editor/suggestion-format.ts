/**
 * 서식 제안 — `suggestion_format` 의 added · removed 읽기 · 되돌리기 (SG-5a · F-05-12 · 판결 U-2)
 *
 * 정본: 00-canonical-data-model.md [보강 SG-1] ⑧
 *
 * 제안 모드에서 서식을 바꾸면 서식은 바로 걸리고 그 범위에 `suggestion_format{sid, author_id, added, removed}` 가 달린다
 * (`suggestion-mode.ts`). 원문(`suggestion-original.ts`) · 거절(`suggestion-resolve.ts`)은 **제안 전 서식** — added 를 떼고 removed 를
 * 다시 건 것 — 을 쓴다. 마크 attr 은 협업 참여자가 Y.Doc 에 쓴 값이라(읽기는 attr 을 검사하지 않는다) 여기서 모양을 다시 보고 아닌 칸은
 * 건너뛴다 — 서식 제안이 다루는 마크(`FORMAT_SUGGESTION_MARKS`)가 아니면 링크든 제안 마크든 되살리지 않는다.
 */

import type { Mark, MarkType } from '@tiptap/pm/model'

import { blockSchema, FORMAT_SUGGESTION_MARKS, isFormatEntry, type FormatEntry } from './schema.ts'

/** 서식 제안이 다루는 마크인가 — 글자 서식 다섯 · 색. */
export const isFormatMark = (mark: Mark): boolean => FORMAT_SUGGESTION_MARKS.includes(mark.type.name)

/** 마크 → attr 에 싣는 모양(프로토타입 없는 attr 객체를 보통 객체로). */
export const formatEntry = (mark: Mark): FormatEntry => ({ type: mark.type.name, attrs: { ...mark.attrs } })

function marksOf(value: unknown): Mark[] {
  if (!Array.isArray(value)) return []
  const out: Mark[] = []
  for (const entry of value) {
    if (!isFormatEntry(entry)) continue
    try {
      out.push(blockSchema.marks[entry.type]!.create(entry.attrs))
    } catch {
      // 필수 attr 이 없는 칸(색 없는 color) — 건너뛴다
    }
  }
  return out
}

/** 서식 제안이 바꾼 것 — 더한 마크 · 뺀 마크. */
export type FormatChange = { readonly added: readonly Mark[]; readonly removed: readonly Mark[] }

export const formatChangeOf = (mark: Mark): FormatChange => ({ added: marksOf(mark.attrs.added), removed: marksOf(mark.attrs.removed) })

/** 제안 전 서식 — added 를 떼고 removed 를 다시 건다(색은 하나뿐이라 갈아 끼운다). `allows` 가 받지 않는 마크는 걸지 않는다. */
export function undoFormat(marks: readonly Mark[], change: FormatChange, allows: (type: MarkType) => boolean = () => true): readonly Mark[] {
  let out = marks
  for (const mark of change.added) out = mark.removeFromSet(out)
  for (const mark of change.removed) if (allows(mark.type)) out = mark.addToSet(out)
  return out
}
