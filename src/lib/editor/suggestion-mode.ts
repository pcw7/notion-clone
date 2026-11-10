/**
 * 제안 모드 — 편집을 제안 마크로 바꾼다 (SG-1 · F-05-12 · 판결 U-2 · 불변식 S10)
 *
 * 정본: 00-canonical-data-model.md [보강 SG-1] ①②③ · 제안 편집 (U-2)
 *
 * 켜면(보는 사람의 화면 상태 · 저장하지 않는다 — 켜는 것은 화면이 `setSuggestionMode` 로):
 *   - 넣은 글은 `suggestion_insert{sid, author_id}` 를 단다. 같은 블록에서 내 insert 범위에 붙여 치면 그 sid 를 잇는다
 *   - 지우면 글을 지우지 않고 `suggestion_delete{sid, author_id}` 를 단다(캐럿은 그 너머로). 내 insert 글은 그냥 지운다 — 내 제안 고치기
 *   - 블록 나누기 · 합치기 · 옮기기 · 바꾸기 · 지우기 · 속성 · 서식은 제안이 아니라 막는다(S10 — 까닭을 알린다)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 어디서 바꾸는가 — 결과 트랜잭션 한 곳
 * ──────────────────────────────────────────────────────────────────────
 *
 * 입력의 길은 많다(키 · 브라우저의 글자 지우기 · IME · 붙여넣기 · 끌기 · 메뉴 명령). 길마다 막지 않고 편집기의 dispatch
 * (`create-editor.ts`)가 **결과 트랜잭션**을 이것에 넘긴다(`suggestTransaction`). 원래 문서와 바뀐 문서의 차이(findDiff)로 지운
 * 범위와 넣은 인라인을 찾아 제안으로 다시 쓴다. 다른 참여자 · 되돌리기가 Y.Doc 에서 가져온 것은 바꾸지 않는다(`isRemote`).
 * 브라우저가 이미 지운 DOM 은 ProseMirror 가 상태에서 다시 그린다(관찰자가 더럽힌 자리).
 *
 * ──────────────────────────────────────────────────────────────────────
 * IME — 저장 마크
 * ──────────────────────────────────────────────────────────────────────
 *
 * 조합 중에 문서가 마크를 새로 달면 조합이 깨진다. 그래서 캐럿이 놓일 때마다 저장 마크(storedMarks)에 내 insert 마크를 둔다 —
 * ProseMirror 가 조합을 그 마크 안에서 시작하고(markCursor), 조합의 트랜잭션은 이미 제안 모양이라 다시 쓰지 않고 지나간다
 * (다시 쓴 문서가 원래 문서와 같으면 원래 트랜잭션을 그대로 쓴다). 입력 규칙(`# ` · `**굵게**`)은 켜진 동안 돌지 않는다 —
 * 글자는 글자로 제안된다(`handleTextInput` 이 먼저 받는다).
 */

import { Fragment, type Mark, type MarkType, type Node as PmNode, type Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { AddMarkStep, AddNodeMarkStep, RemoveMarkStep, RemoveNodeMarkStep, ReplaceStep } from '@tiptap/pm/transform'

import { blockSchema, SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from './schema.ts'

const INSERT: MarkType = blockSchema.marks[SUGGESTION_INSERT_MARK]!
const DELETE: MarkType = blockSchema.marks[SUGGESTION_DELETE_MARK]!
const FORMAT: MarkType = blockSchema.marks[SUGGESTION_FORMAT_MARK]!

/** 켠 사람 — null 이면 꺼졌다. */
type ModeState = { readonly authorId: string | null }

const OFF: ModeState = { authorId: null }

export const suggestionModeKey = new PluginKey<ModeState>('suggestion-mode')

/** 수락 · 거절의 트랜잭션 표지(SG-3 · `suggestion-resolve.ts`) — 마크를 떼고 글을 지우지만 제안으로 다시 쓰지 않는다. */
export const SUGGESTION_RESOLVE_META = 'suggestion-resolve'

/** 제안의 id — 서버 `suggestion.id`(uuid)가 된다(SG-2). */
const randomSid = (): string => globalThis.crypto.randomUUID()

/** 켜고 끄는 메타 — 끄면 저장 마크의 제안 마크를 거둔다(남기면 끈 뒤 친 첫 글자가 제안이 된다). */
export function setSuggestionMode(tr: Transaction, authorId: string | null): Transaction {
  tr.setMeta(suggestionModeKey, { authorId } satisfies ModeState)
  if (authorId === null && tr.storedMarks?.some(isSuggestionMark)) tr.setStoredMarks(tr.storedMarks.filter((m) => !isSuggestionMark(m)))
  return tr
}

/** 제안 모드를 켠 사람 — 꺼졌으면 null. */
export function suggestingAuthor(state: EditorState): string | null {
  return suggestionModeKey.getState(state)?.authorId ?? null
}

export const isSuggestionMark = (mark: Mark): boolean => mark.type === INSERT || mark.type === DELETE || mark.type === FORMAT

// ── 순수 판정 ─────────────────────────────────────────────────────────

/** 이 사람이 단 그 종류의 제안 마크 — 없으면 null. */
export function ownSuggestion(marks: readonly Mark[], type: MarkType, authorId: string): Mark | null {
  return marks.find((m) => m.type === type && m.attrs.author_id === authorId) ?? null
}

/** 범위 [from, to) 의 바로 앞 · 바로 뒤 글자(같은 블록)가 이 사람의 그 종류 제안이면 그 sid — 이어 친 것은 같은 제안이다. */
export function adjacentSid(doc: PmNode, from: number, to: number, type: MarkType, authorId: string): string | null {
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  for (const node of [$from.parent.inlineContent ? $from.nodeBefore : null, $to.parent.inlineContent ? $to.nodeAfter : null]) {
    const mark = node === null ? null : ownSuggestion(node.marks, type, authorId)
    if (mark !== null) return String(mark.attrs.sid)
  }
  return null
}

/** 범위 안에 이 사람의 그 종류 제안이 있으면 그 sid. */
function ownSidIn(doc: PmNode, from: number, to: number, type: MarkType, authorId: string): string | null {
  const found: string[] = []
  doc.nodesBetween(from, to, (node) => {
    const mark = found.length === 0 && node.isInline ? ownSuggestion(node.marks, type, authorId) : null
    if (mark !== null) found.push(String(mark.attrs.sid))
    return found.length === 0
  })
  return found[0] ?? null
}

/**
 * 지운 범위의 인라인 조각마다 무엇을 하는가 — 이 사람의 insert 글은 진짜 지운다(`remove` · 내 제안 고치기) · 이미 delete 마크가
 * 있는 글은 그대로 둔다(`keep` · 남의 제안을 덮지 않는다) · 나머지는 delete 마크를 단다(`mark`).
 */
export type DeletePiece = { readonly from: number; readonly to: number; readonly kind: 'remove' | 'keep' | 'mark' }

export function deletionPieces(doc: PmNode, from: number, to: number, authorId: string): DeletePiece[] {
  const pieces: DeletePiece[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    if (start < end) {
      const kind = ownSuggestion(node.marks, INSERT, authorId) !== null ? 'remove' : DELETE.isInSet(node.marks) ? 'keep' : 'mark'
      pieces.push({ from: start, to: end, kind })
    }
    return false
  })
  return pieces
}

/** 바꿀 글 — 원래 문서의 [from, to) 를 지우고 그 자리에 인라인 `inserted` 를 넣은 것과 같다. */
export type TextChange = { readonly from: number; readonly to: number; readonly inserted: Fragment }

/** 막는 까닭. */
export type SuggestBlock = 'structure' | 'format' | 'plain_text'

export const SUGGEST_BLOCK_MESSAGE: Readonly<Record<SuggestBlock, string>> = {
  structure: '제안 모드에서는 블록을 나누거나 합치거나 옮기거나 바꿀 수 없습니다 — 글자만 제안할 수 있습니다.',
  format: '제안 모드에서는 서식을 바꿀 수 없습니다 — 글자만 제안할 수 있습니다.',
  plain_text: '코드 블록에는 제안을 달 수 없습니다.',
}

export type ChangeShape =
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly change: TextChange }
  | { readonly kind: 'blocked'; readonly reason: SuggestBlock }

const blocked = (reason: SuggestBlock): ChangeShape => ({ kind: 'blocked', reason })

/** 열린 슬라이스를 인라인으로 — 한 줄짜리 사슬(문단 하나 · 컨테이너 하나 안의 문단 하나)이면 그 안의 인라인, 아니면 null. */
function inlineOfSlice(slice: Slice): Fragment | null {
  if (slice.openStart !== slice.openEnd) return null
  let content = slice.content
  for (let depth = 0; depth < slice.openStart; depth += 1) {
    if (content.childCount !== 1) return null
    content = content.firstChild!.content
  }
  let inline = true
  content.forEach((node) => {
    if (!node.isInline) inline = false
  })
  return inline ? content : null
}

/** 범위의 글을 담은 블록이 모두 제안 마크를 받는가(코드 블록은 마크를 받지 않는다 — `schema.ts` 의 `marks: ''`). */
function marksAllowed(doc: PmNode, from: number, to: number): boolean {
  let allowed = doc.resolve(from).parent.type.allowsMarkType(INSERT) && doc.resolve(to).parent.type.allowsMarkType(INSERT)
  doc.nodesBetween(from, to, (node) => {
    if (node.inlineContent && !node.type.allowsMarkType(DELETE)) allowed = false
    return allowed && !node.isInline
  })
  return allowed
}

function hasInline(doc: PmNode, from: number, to: number): boolean {
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (node.isInline) found = true
    return !found
  })
  return found
}

/**
 * 트랜잭션이 바꾼 것의 모양 — 글(한 블록 안 · 또는 블록을 건너 고른 글을 지우거나 덮어 친 한 단계)이면 그 범위, 아니면 막는 까닭.
 *
 * 차이는 문서 전체의 findDiff 로 잰다 — 단계가 여럿이어도(멘션 넣기: `@쿼리` 지우기 + 원자 + 빈칸) 한 범위다. 같은 글자가 이어지면
 * ("aa" → "aaa") 끝 비교가 시작을 지나친다 — ProseMirror 의 DOM 읽기(`findDiff`)처럼 바뀐 자리(캐럿) 쪽으로 맞춘다.
 */
export function textChangeOf(state: EditorState, tr: Transaction): ChangeShape {
  for (const step of tr.steps) {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep || step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep) {
      return blocked('format')
    }
    if (!(step instanceof ReplaceStep)) return blocked('structure')
  }
  const before = tr.before
  let start = before.content.findDiffStart(tr.doc.content)
  if (start === null) return { kind: 'none' }
  let { a: endA, b: endB } = before.content.findDiffEnd(tr.doc.content)!
  const preferred = Math.min(state.selection.from, tr.selection.from)
  if (endA < start && before.content.size < tr.doc.content.size) {
    start -= preferred <= start && preferred >= endA ? start - preferred : 0
    endB = start + (endB - endA)
    endA = start
  } else if (endB < start) {
    start -= preferred <= start && preferred >= endB ? start - preferred : 0
    endA = start + (endA - endB)
    endB = start
  }

  const $start = before.resolve(start)
  const $endA = before.resolve(endA)
  const $startB = tr.doc.resolve(start)
  const $endB = tr.doc.resolve(endB)
  if ($start.parent.inlineContent && $start.sameParent($endA) && $startB.parent.inlineContent && $startB.sameParent($endB)) {
    if (!marksAllowed(before, start, endA)) return blocked('plain_text')
    return { kind: 'text', change: { from: start, to: endA, inserted: tr.doc.slice(start, endB).content } }
  }

  // 블록을 건너 고른 글을 지우거나 덮어 친다 — 원래 편집은 블록을 합치지만 제안은 글에만 줄을 긋는다(블록은 그대로)
  const only = tr.steps.length === 1 ? (tr.steps[0] as ReplaceStep) : null
  if (only !== null) {
    const $from = before.resolve(only.from)
    const $to = before.resolve(only.to)
    const inserted = inlineOfSlice(only.slice)
    if (inserted !== null && $from.parent.inlineContent && $to.parent.inlineContent && hasInline(before, only.from, only.to)) {
      if (!marksAllowed(before, only.from, only.to)) return blocked('plain_text')
      return { kind: 'text', change: { from: only.from, to: only.to, inserted } }
    }
  }
  // 블록 나누기 · 합치기(지울 글 없이 블록 경계만) · 블록 지우기 · 옮기기 · 바꾸기 · 여러 블록 붙여넣기
  return blocked('structure')
}

/**
 * 바꿀 글을 제안으로 다시 쓴다 — 원래 문서(`state`)에서 새로 짓는다.
 *
 *   ① 지운 범위: 뒤에서부터(앞 자리가 밀리지 않게) 내 insert 글은 지우고 나머지는 delete 마크(앞뒤 · 안의 내 delete 의 sid 를 잇는다)
 *   ② 넣은 인라인: 줄 그은 글 뒤에 — 내 insert 마크가 이미 있으면 그대로(저장 마크 · 조합), 없으면 단다(남의 insert 는 내 것으로
 *      바뀐다 · delete 는 뗀다)
 *   ③ 캐럿: 넣었으면 넣은 글 뒤 · Backspace(빈 캐럿이 지운 범위 끝)면 줄 그은 글 앞(다음 Backspace 가 그 앞 글자) · 나머지는 줄 그은 글 뒤
 */
export function rewriteAsSuggestion(
  state: EditorState,
  tr: Transaction,
  change: TextChange,
  authorId: string,
  newId: () => string = randomSid,
): Transaction {
  const { from, to, inserted } = change
  const out = state.tr

  const pieces = deletionPieces(state.doc, from, to, authorId)
  let deleteSid: string | null = null
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i]!
    if (piece.kind === 'remove') {
      out.delete(piece.from, piece.to)
    } else if (piece.kind === 'mark') {
      deleteSid ??= adjacentSid(state.doc, from, to, DELETE, authorId) ?? ownSidIn(state.doc, from, to, DELETE, authorId) ?? newId()
      out.addMark(piece.from, piece.to, DELETE.create({ sid: deleteSid, author_id: authorId }))
    }
  }

  const at = out.mapping.map(to)
  let caret: number
  if (inserted.size > 0) {
    const children: PmNode[] = []
    inserted.forEach((node) => children.push(node))
    const carried = children.map((node) => ownSuggestion(node.marks, INSERT, authorId)).find((m) => m !== null)
    const sid = carried ? String(carried.attrs.sid) : (adjacentSid(out.doc, at, at, INSERT, authorId) ?? newId())
    const mark = INSERT.create({ sid, author_id: authorId })
    const nodes = children.map((node) => {
      const base = node.marks.filter((m) => m.type !== DELETE)
      return node.mark(ownSuggestion(node.marks, INSERT, authorId) !== null ? base : mark.addToSet(base))
    })
    out.insert(at, Fragment.fromArray(nodes))
    caret = at + inserted.size
  } else if (state.selection.empty && state.selection.head === to && from < to) {
    caret = out.mapping.map(from, -1)
  } else {
    caret = at
  }
  out.setSelection(TextSelection.create(out.doc, caret))

  // 원래 트랜잭션의 메타를 옮긴다(메뉴 닫기 · 붙여넣기 표지 …) — 공개 API 로 열거할 수 없어 내부 칸을 읽는다
  const meta = (tr as unknown as { meta?: Record<string, unknown> }).meta ?? {}
  for (const key of Object.keys(meta)) out.setMeta(key, meta[key])
  if (tr.scrolledIntoView) out.scrollIntoView()
  return out
}

export type SuggestOutcome = { readonly tr: Transaction } | { readonly blocked: SuggestBlock }

/**
 * dispatch 가 부른다 — 꺼졌거나 · 문서를 바꾸지 않거나 · Y.Doc 에서 온 것이거나 · 수락 · 거절(SG-3)이면 받은 그대로. 켜졌으면 제안으로
 * 다시 쓴 것(이미 제안 모양이면 받은 그대로) 또는 막는 까닭.
 */
export function suggestTransaction(
  state: EditorState,
  tr: Transaction,
  isRemote?: (tr: Transaction) => boolean,
  newId: () => string = randomSid,
): SuggestOutcome {
  const authorId = suggestingAuthor(state)
  if (authorId === null || !tr.docChanged || tr.before !== state.doc || isRemote?.(tr) === true) return { tr }
  if (tr.getMeta(SUGGESTION_RESOLVE_META) !== undefined) return { tr }
  const shape = textChangeOf(state, tr)
  if (shape.kind === 'none') return { tr }
  if (shape.kind === 'blocked') return { blocked: shape.reason }
  const out = rewriteAsSuggestion(state, tr, shape.change, authorId, newId)
  return { tr: out.doc.eq(tr.doc) ? tr : out }
}

/**
 * 캐럿에 둘 저장 마크 — 캐럿 자리의 마크(제안 마크는 빼고)에 내 insert 마크(붙은 내 insert 의 sid · 아니면 새 sid). 이미 내 insert
 * 가 있거나 · 빈 캐럿이 아니거나 · 그 블록이 마크를 받지 않으면 null.
 */
export function caretMarks(state: EditorState, authorId: string, newId: () => string = randomSid): readonly Mark[] | null {
  const { selection } = state
  const $cursor = selection instanceof TextSelection ? selection.$cursor : null
  if ($cursor === null || !$cursor.parent.inlineContent || !$cursor.parent.type.allowsMarkType(INSERT)) return null
  const current = state.storedMarks
  if (current !== null && ownSuggestion(current, INSERT, authorId) !== null) return null
  const base = (current ?? $cursor.marks()).filter((m) => !isSuggestionMark(m))
  const sid = adjacentSid(state.doc, $cursor.pos, $cursor.pos, INSERT, authorId) ?? newId()
  return INSERT.create({ sid, author_id: authorId }).addToSet(base)
}

/**
 * 제안 모드 플러그인 — 켠 사람(상태) · 편집기 뿌리의 `data-suggesting` · 입력 규칙보다 먼저 받는 글자 입력 · 캐럿의 저장 마크.
 * 다시 쓰기 · 막기는 dispatch 가 `suggestTransaction` 으로 한다(머리말). **편집 플러그인 목록의 맨 앞**에 둔다 — `handleTextInput`
 * 은 먼저 등록된 플러그인이 이긴다.
 */
export function suggestionModePlugin(newId: () => string = randomSid): Plugin<ModeState> {
  return new Plugin<ModeState>({
    key: suggestionModeKey,
    state: {
      init: () => OFF,
      apply: (tr, value) => (tr.getMeta(suggestionModeKey) as ModeState | undefined) ?? value,
    },
    props: {
      attributes: (state): Record<string, string> => (suggestingAuthor(state) === null ? {} : { 'data-suggesting': 'true' }),
      // 입력 규칙(`# ` → 제목 · `**굵게**`)보다 먼저 — 켜진 동안 친 글은 글로 제안한다. 조합 중이면 ProseMirror 에 맡긴다.
      handleTextInput(view, _from, _to, _text, deflt) {
        if (suggestingAuthor(view.state) === null || view.composing) return false
        view.dispatch(deflt())
        return true
      },
    },
    appendTransaction(trs, _old, state) {
      const authorId = suggestingAuthor(state)
      if (authorId === null || !trs.some((tr) => tr.docChanged || tr.selectionSet || tr.getMeta(suggestionModeKey) !== undefined)) return null
      const marks = caretMarks(state, authorId, newId)
      return marks === null ? null : state.tr.setStoredMarks(marks)
    },
  })
}
