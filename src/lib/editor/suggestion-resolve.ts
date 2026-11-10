/**
 * 제안 수락 · 거절 — 마크를 떼거나 그 글을 지운다 (SG-3 · F-05-12 · 판결 U-2 · 불변식 S9)
 *
 * 정본: 00-canonical-data-model.md [보강 SG-1] ⑤ · 제안 편집 (U-2)
 *
 *   - 수락: insert 마크를 뗀다(글은 남는다) · delete 마크 글을 지운다 · format 은 마크만 뗀다(서식 제안은 SG-5)
 *   - 거절: insert 마크 글을 지운다 · delete 마크를 뗀다 · format 은 마크만 뗀다
 *
 * **한 번의 트랜잭션**이다(S9) — 편집기가 보내면 y-prosemirror 가 Y.transact 한 번 · update 하나로 옮긴다. 되돌리기 한 번에 함께 돌아오고,
 * 다른 참여자도 한꺼번에 본다. 커밋 주체는 누른 사람의 연결이다(수락자). 모두 수락 · 모두 거절도 sid 여럿을 한 트랜잭션에.
 * 표지(`SUGGESTION_RESOLVE_META`)가 제안 모드의 다시 쓰기를 비켜 간다 — 켜 둔 채 수락해도 마크 떼기가 "서식" 으로 막히지 않는다.
 */

import type { Mark, Node as PmNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

import { SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from './schema.ts'
import type { SuggestionKind } from './suggestion-original.ts'
import { SUGGESTION_RESOLVE_META } from './suggestion-mode.ts'

export type ResolveAction = 'accept' | 'reject'

const KIND_OF: Readonly<Record<string, SuggestionKind>> = {
  [SUGGESTION_INSERT_MARK]: 'insert',
  [SUGGESTION_DELETE_MARK]: 'delete',
  [SUGGESTION_FORMAT_MARK]: 'format',
}

/** 이 동작에서 그 종류의 글이 사라지는가 — 수락은 delete 글 · 거절은 insert 글. */
const drops = (kind: SuggestionKind, action: ResolveAction): boolean => kind === (action === 'accept' ? 'delete' : 'insert')

/** 문서 안의 제안 하나 — sid 마다 처음 본 종류 · 사람 · 글(문서 차례) · 처음 글자부터 마지막 글자까지의 자리. */
export type DocSuggestion = {
  readonly sid: string
  readonly kind: SuggestionKind
  readonly authorId: string
  readonly text: string
  readonly from: number
  readonly to: number
}

/** 문서의 제안들 — 처음 나온 차례. 목록(패널)이 쓴다. */
export function docSuggestions(doc: PmNode): DocSuggestion[] {
  const found = new Map<string, { kind: SuggestionKind; authorId: string; text: string; from: number; to: number }>()
  doc.descendants((node, pos) => {
    if (!node.isInline) return true
    for (const mark of node.marks) {
      const kind = KIND_OF[mark.type.name]
      if (kind === undefined) continue
      const sid = String(mark.attrs.sid)
      const text = node.isText ? (node.text ?? '') : node.textContent
      const seen = found.get(sid)
      if (seen === undefined) found.set(sid, { kind, authorId: String(mark.attrs.author_id), text, from: pos, to: pos + node.nodeSize })
      else {
        seen.text += text
        seen.to = pos + node.nodeSize
      }
    }
    return false
  })
  return [...found].map(([sid, s]) => ({ sid, ...s }))
}

/**
 * 이 sid 들을 수락 · 거절하는 단계를 `tr` 에 쌓는다 — `doc` 은 `tr` 이 시작한 문서다. 바꾼 것이 있으면 true.
 *
 * 마크 떼기를 먼저(자리가 밀리지 않는다) · 지우기는 뒤에서부터. 글자 하나에 두 제안이 함께 서 있으면(남이 넣자는 글을 지우자고 했다)
 * 그 글이 사라지는 쪽이 이긴다 — 사라질 글의 마크는 떼지 않는다.
 */
export function resolveSuggestionsIn(tr: Transaction, doc: PmNode, sids: ReadonlySet<string>, action: ResolveAction): boolean {
  const unmark: { from: number; to: number; mark: Mark }[] = []
  const remove: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isInline) return true
    const ours = node.marks.filter((m) => KIND_OF[m.type.name] !== undefined && sids.has(String(m.attrs.sid)))
    if (ours.length === 0) return false
    const range = { from: pos, to: pos + node.nodeSize }
    if (ours.some((m) => drops(KIND_OF[m.type.name]!, action))) remove.push(range)
    else for (const mark of ours) unmark.push({ ...range, mark })
    return false
  })
  for (const { from, to, mark } of unmark) tr.removeMark(from, to, mark)
  // 붙은 범위는 하나로 — 글 조각마다 지우면 단계만 는다
  const merged: { from: number; to: number }[] = []
  for (const range of remove) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.to === range.from) last.to = range.to
    else merged.push({ ...range })
  }
  for (let i = merged.length - 1; i >= 0; i -= 1) tr.delete(merged[i]!.from, merged[i]!.to)
  return unmark.length > 0 || merged.length > 0
}

/** 편집기가 보낼 트랜잭션 — 이 sid 들이 문서에 없으면 null(남이 먼저 정했다). */
export function resolveSuggestionTransaction(state: EditorState, sids: ReadonlySet<string>, action: ResolveAction): Transaction | null {
  const tr = state.tr
  if (!resolveSuggestionsIn(tr, state.doc, sids, action)) return null
  return tr.setMeta(SUGGESTION_RESOLVE_META, action)
}
