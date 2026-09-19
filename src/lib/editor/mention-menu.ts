/**
 * `@` 멘션 메뉴 — F-07-08 (코멘트 5b조각)
 *
 * 슬래시 메뉴(`slash-menu.ts`)와 같은 뼈대다 — 트리거 조건 · 종료 조건이 이 파일의 요점이고, 후보 조회 · 팝업 · 키 조작은
 * 화면(`body-editor.tsx`)이 한다. 이 파일은 DOM 도 네트워크도 모른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 트리거 — `@` 앞이 줄 시작 또는 공백일 때만
 * ──────────────────────────────────────────────────────────────────────
 *
 * 07 F-07-08 엣지 표: *"`@` 뒤에 공백 → 팝업 닫힘. **이메일 주소 입력을 방해하면 안 됨**"*. `a@b.com` 을 칠 때 `@` 앞에
 * 글자가 있으므로 열리지 않는다. 슬래시 메뉴가 `https://` 를 막는 것과 같은 한 줄이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 후보가 0건이어도 닫지 않는다 — 슬래시 메뉴와 다른 점
 * ──────────────────────────────────────────────────────────────────────
 *
 * 같은 엣지 표: *"후보 0건 → '새 페이지 만들기'만 남김. **팝업을 닫아버리면 안 됨**"*. 후보는 서버에 물어 늦게 오므로
 * 이 플러그인은 후보를 모른다 — 닫는 조건은 공백 · Esc · 캐럿이 벗어남 · 쿼리가 너무 길어짐뿐이다.
 *
 * **붙여넣기로 들어온 `@` 는 열지 않는다**(같은 표: "키 입력에만 반응"). 방금 바뀐 것이 글자 하나(`@`)일 때만 연다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 넣는 것은 id 뿐이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 멘션 노드에 이름 · 제목을 싣지 않는다(정본 §3.9 `link_edge` 절 · `contracts/rich-text.ts` 멘션 절). 그리는 쪽이
 * 권한으로 거른 맵에서 읽는다(`node-views.ts` `mentionLabel`). 역인덱스는 여기서 쓰지 않는다 — 프로젝터가 쓴다(L1).
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

import { MENTION_NODE } from './schema.ts'

export type MentionMenuState = {
  readonly active: boolean
  /** `@` 문자의 위치. 넣을 때 여기부터 캐럿까지를 바꾼다. */
  readonly from: number
  /** `@` 뒤에 입력된 문자열. */
  readonly query: string
}

/** 이보다 긴 쿼리는 멘션이 아니라 그냥 글이다 — 닫는다. */
export const MAX_MENTION_QUERY = 40

const INACTIVE: MentionMenuState = { active: false, from: -1, query: '' }

export const mentionMenuKey = new PluginKey<MentionMenuState>('mentionMenu')

/** 명시적으로 닫는다(Esc, 넣은 뒤). */
export function closeMentionMenu(tr: Transaction): Transaction {
  return tr.setMeta(mentionMenuKey, { close: true })
}

function isTriggerPosition(state: EditorState, atPos: number): boolean {
  const $at = state.doc.resolve(atPos)
  if (!$at.parent.isTextblock) return false
  if ($at.parentOffset === 0) return true
  const before = $at.parent.textBetween($at.parentOffset - 1, $at.parentOffset)
  return /\s/.test(before)
}

/** 이 트랜잭션이 넣은 글자가 정확히 한 글자인가 — 붙여넣기(여러 글자)와 키 입력을 가른다. */
function insertedExactlyOneChar(tr: Transaction): boolean {
  let inserted = 0
  for (const step of tr.steps) {
    const json = step.toJSON() as { stepType?: string; slice?: { content?: { text?: string }[] } }
    if (json.stepType !== 'replace') return false
    for (const node of json.slice?.content ?? []) inserted += node.text?.length ?? 1
  }
  return inserted === 1
}

function computeState(prev: MentionMenuState, tr: Transaction, next: EditorState): MentionMenuState {
  const meta = tr.getMeta(mentionMenuKey) as { close?: boolean } | undefined
  if (meta?.close) return INACTIVE

  const { $from, empty } = next.selection
  if (!empty || !$from.parent.isTextblock) return INACTIVE

  if (prev.active) {
    const from = tr.mapping.map(prev.from)
    const head = next.selection.head
    if (head <= from) return INACTIVE
    const $at = next.doc.resolve(from)
    if ($at.parent !== $from.parent) return INACTIVE
    if (next.doc.textBetween(from, from + 1) !== '@') return INACTIVE

    const query = next.doc.textBetween(from + 1, head)
    if (/\s/.test(query)) return INACTIVE
    if (query.length > MAX_MENTION_QUERY) return INACTIVE
    return { active: true, from, query }
  }

  if (!tr.docChanged || !insertedExactlyOneChar(tr)) return INACTIVE
  const head = next.selection.head
  if (head < 1) return INACTIVE
  if (next.doc.textBetween(head - 1, head) !== '@') return INACTIVE
  if (!isTriggerPosition(next, head - 1)) return INACTIVE
  return { active: true, from: head - 1, query: '' }
}

export function mentionMenuPlugin(): Plugin<MentionMenuState> {
  return new Plugin<MentionMenuState>({
    key: mentionMenuKey,
    state: {
      init: () => INACTIVE,
      apply: (tr, value, _old, next) => computeState(value, tr, next),
    },
  })
}

export function mentionMenuState(state: EditorState): MentionMenuState {
  return mentionMenuKey.getState(state) ?? INACTIVE
}

// ── 넣기 ──────────────────────────────────────────────────────────────

export type MentionPick = { readonly kind: 'user' | 'page'; readonly id: string }

/**
 * `@쿼리` 를 멘션 노드로 바꾼다 — 한 트랜잭션이다(Cmd+Z 한 번에 돌아온다).
 *
 * 07 F-07-08 시나리오 3: *"트리거 문자와 입력한 검색어가 **모두 삭제되고** 그 자리에 mention 노드가 삽입된다."*
 * 뒤에 공백 하나를 붙인다 — 원자 바로 뒤에서 이어 치면 글자가 원자에 붙어 보인다.
 */
export function insertMention(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pick: MentionPick,
): boolean {
  const menu = mentionMenuState(state)
  if (!menu.active) return false
  const node = state.schema.nodes[MENTION_NODE]?.create({
    mention: pick.kind === 'user' ? { type: 'user', user: { id: pick.id } } : { type: 'page', page: { id: pick.id } },
    plainText: '',
  })
  if (node === undefined) return false
  if (dispatch === undefined) return true
  const tr = state.tr.replaceWith(menu.from, state.selection.head, [node, state.schema.text(' ')])
  dispatch(closeMentionMenu(tr))
  return true
}
