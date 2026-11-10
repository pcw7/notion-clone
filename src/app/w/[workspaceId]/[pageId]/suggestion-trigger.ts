/**
 * 제안 카드를 띄울 자리 · 본문의 제안 수 (SG-3 · F-05-12 · 정본 [보강 SG-1] ⑤)
 *
 * 페이지의 첫 JS 에 드는 작은 부분이다 — 카드 · 목록 · 수락 · 거절은 지연 로드한다(`body-popups-lazy.tsx`). 여기는 무엇을 띄울지만 안다:
 * 마우스가 올라간 제안 span(`data-sid` · 마크의 `toDOM` — `schema.ts`)과 캐럿 바로 뒤 글자의 제안 마크.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState } from '@tiptap/pm/state'

import type { SuggestionKind } from '@/lib/editor/suggestion-original'

/** 카드에 보일 제안 하나. */
export type CardSuggestion = { readonly sid: string; readonly kind: SuggestionKind; readonly authorId: string }

/** 카드 — 그 자리의 제안들(안쪽부터) · 프레임 좌표 · 무엇이 열었나(마우스 · 캐럿). */
export type SuggestionCardAt = {
  readonly items: readonly CardSuggestion[]
  readonly top: number
  readonly left: number
  readonly via: 'hover' | 'caret'
}

const PREFIX = 'suggestion_'
const KINDS: ReadonlySet<string> = new Set(['insert', 'delete', 'format'])

/** 요소에서 위로 — `root`(편집기) 안의 제안 span 들(안쪽부터 · sid 마다 한 번)과 맨 바깥 span. 없으면 null. */
export function suggestionSpansAt(root: HTMLElement, target: EventTarget | null): { items: CardSuggestion[]; outer: HTMLElement } | null {
  if (!(target instanceof Element)) return null
  const items: CardSuggestion[] = []
  let outer: HTMLElement | null = null
  for (let el = target.closest<HTMLElement>('[data-sid]'); el !== null && root.contains(el); el = el.parentElement?.closest<HTMLElement>('[data-sid]') ?? null) {
    const { sid, suggestion, author } = el.dataset
    if (sid === undefined || suggestion === undefined || !KINDS.has(suggestion)) continue
    if (!items.some((i) => i.sid === sid)) items.push({ sid, kind: suggestion as SuggestionKind, authorId: author ?? '' })
    outer = el
  }
  return outer === null ? null : { items, outer }
}

/** 빈 캐럿 바로 뒤 글자의 제안 마크 — 화살표로 제안 안에 들어오면 카드가 선다(키보드). */
export function suggestionsAtCaret(state: EditorState): CardSuggestion[] {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$from.parent.inlineContent) return []
  const node = selection.$from.nodeAfter
  if (node === null) return []
  return node.marks
    .filter((m) => m.type.name.startsWith(PREFIX) && KINDS.has(m.type.name.slice(PREFIX.length)))
    .map((m) => ({ sid: String(m.attrs.sid), kind: m.type.name.slice(PREFIX.length) as SuggestionKind, authorId: String(m.attrs.author_id) }))
}

/** 본문의 제안 수(sid) — 메뉴의 "제안 n개". */
export function countSuggestions(doc: PmNode): number {
  const sids = new Set<string>()
  doc.descendants((node) => {
    if (!node.isInline) return true
    for (const mark of node.marks) if (mark.type.name.startsWith(PREFIX)) sids.add(String(mark.attrs.sid))
    return false
  })
  return sids.size
}
