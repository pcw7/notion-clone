/**
 * `:` 커스텀 이모지 메뉴 — 인접 제품 7c-3b (F-13-16)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ⑧
 *
 * `@` 멘션 메뉴(`mention-menu.ts`)와 같은 뼈대다 — 트리거 · 종료 조건이 이 파일의 요점이고, 후보 · 팝업 · 키 조작은 화면
 * (`body-editor.tsx`)이 한다. 이 파일은 DOM 도 네트워크도 모른다.
 *
 *   · 트리거 — 줄 시작 · 공백 뒤의 `:` 를 **키로 쳤을 때만**(`isTriggerPosition` · `insertedExactlyOneChar` — `@` 와 같은 함수). 글자 뒤의
 *     `:` 는 열지 않는다(`10:30` · `https://` · `이름:값`)
 *   · 쿼리 — `:` 뒤의 **이름 글자만**(영문 · 숫자 · `_` · `-`). 다른 글자(공백 · 한글 · 문장 부호)가 들어오면 닫는다 — `참고: 이것` 처럼
 *     `:` 뒤에 말을 이어 쓰는 글을 붙잡지 않게. 40자(이름의 최대)를 넘으면 닫는다
 *   · 넣기 — `:쿼리` 를 커스텀 이모지 멘션 노드로 바꾼다(한 트랜잭션). 뒤에 공백을 붙이지 않는다 — 이모지는 글자처럼 붙여 쓴다
 *     (사람 · 페이지 멘션과 다르다)
 *
 * 후보가 0건일 때 팝업을 세우지 않는 것은 화면의 몫이다(목록이 로컬이라 곧바로 안다 — 슬래시 메뉴와 같다). 이 플러그인은 0건에도
 * 열린 채다 — 닫는 `:` 의 꼭 맞는 이름(`:party:`)을 화면이 알아보려면 쿼리를 계속 따라가야 한다.
 *
 * **닫는 `:`** — 쿼리 뒤에 `:` 를 한 글자 치면 메뉴는 닫히고, 상태에 `colon`(자리 · 이름)을 싣는다(다음에 문서를 바꾸는 트랜잭션까지 —
 * 아래 `computeState`). 이름이 꼭 맞는
 * 이모지가 있는지는 화면이 목록에서 보고 그 자리를 바꾼다(`replaceColonEmoji`). keydown 에서 `:` 를 잡지 않는다 — IME · 모바일 ·
 * 자동화의 입력은 keydown 없이 글자만 들어온다(e2e 가 잡았다 · 정본 ⑧).
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

import { MAX_EMOJI_NAME_LENGTH } from '../emoji/custom-emoji-rules.ts'
import { insertedExactlyOneChar, isTriggerPosition } from './mention-menu.ts'
import { isPlainTextNode, MENTION_NODE } from './schema.ts'

export type EmojiMenuState = {
  readonly active: boolean
  /** `:` 문자의 위치. 넣을 때 여기부터 캐럿까지를 바꾼다. */
  readonly from: number
  /** `:` 뒤에 입력된 이름 글자. */
  readonly query: string
  /**
   * 방금 닫는 `:` 로 닫혔다 — `:이름:` 의 자리(`from` 은 여는 `:` · `to` 는 닫는 `:` 뒤)와 이름. 다음에 문서를 바꾸는 트랜잭션이면
   * 사라진다(문서를 안 바꾸는 · 덧붙은 트랜잭션은 위치만 옮겨 남긴다). 닫힌 상태(`active: false`)에서만 온다.
   */
  readonly colon?: { readonly from: number; readonly to: number; readonly name: string }
}

/** 쿼리가 될 수 있는 글자 — 이름의 글자(대소문자는 찾기가 무시한다). */
const QUERY_PATTERN = /^[A-Za-z0-9_-]*$/

const INACTIVE: EmojiMenuState = { active: false, from: -1, query: '' }

export const emojiMenuKey = new PluginKey<EmojiMenuState>('emojiMenu')

/** 명시적으로 닫는다(Esc, 넣은 뒤). */
export function closeEmojiMenu(tr: Transaction): Transaction {
  return tr.setMeta(emojiMenuKey, { close: true })
}

function computeState(prev: EmojiMenuState, tr: Transaction, next: EditorState): EmojiMenuState {
  const meta = tr.getMeta(emojiMenuKey) as { close?: boolean } | undefined
  if (meta?.close) return INACTIVE

  // 닫는 `:` 의 자리는 **다음에 문서를 바꾸는 트랜잭션까지** 남긴다(위치만 옮긴다). 지우면 화면이 못 본다 — 덧붙은 트랜잭션
  // (`appendTransaction` — 정규화 · 협업)과, 디스패치 도중 플러그인 뷰가 따로 보내는 메타 트랜잭션이 그 자리를 덮고, 화면은 늘 마지막
  // 상태만 읽는다(e2e 가 잡았다 — 단위 검사의 `type()` 에는 둘 다 없었다). 오래 남아도 해가 없다 — 바꾸기는 그 자리가 아직 `:이름:`
  // 일 때만 한다(`replaceColonEmoji`).
  if (prev.colon !== undefined && (tr.getMeta('appendedTransaction') !== undefined || !tr.docChanged)) {
    return { ...INACTIVE, colon: { from: tr.mapping.map(prev.colon.from), to: tr.mapping.map(prev.colon.to), name: prev.colon.name } }
  }

  const { $from, empty } = next.selection
  if (!empty || !$from.parent.isTextblock || isPlainTextNode($from.parent)) return INACTIVE

  if (prev.active) {
    const from = tr.mapping.map(prev.from)
    const head = next.selection.head
    if (head <= from) return INACTIVE
    const $at = next.doc.resolve(from)
    if ($at.parent !== $from.parent) return INACTIVE
    if (next.doc.textBetween(from, from + 1) !== ':') return INACTIVE

    const query = next.doc.textBetween(from + 1, head)
    // 닫는 `:` — 이름 글자 뒤에 `:` 한 글자를 쳤다. 닫되 자리와 이름을 싣는다(화면이 꼭 맞는 이모지면 바꾼다).
    if (query.endsWith(':') && query.length > 1 && insertedExactlyOneChar(tr)) {
      const name = query.slice(0, -1)
      if (QUERY_PATTERN.test(name) && name.length <= MAX_EMOJI_NAME_LENGTH) return { ...INACTIVE, colon: { from, to: head, name } }
    }
    if (!QUERY_PATTERN.test(query)) return INACTIVE
    if (query.length > MAX_EMOJI_NAME_LENGTH) return INACTIVE
    return { active: true, from, query }
  }

  if (!tr.docChanged || !insertedExactlyOneChar(tr)) return INACTIVE
  const head = next.selection.head
  if (head < 1) return INACTIVE
  if (next.doc.textBetween(head - 1, head) !== ':') return INACTIVE
  if (!isTriggerPosition(next, head - 1)) return INACTIVE
  return { active: true, from: head - 1, query: '' }
}

export function emojiMenuPlugin(): Plugin<EmojiMenuState> {
  return new Plugin<EmojiMenuState>({
    key: emojiMenuKey,
    state: {
      init: () => INACTIVE,
      apply: (tr, value, _old, next) => computeState(value, tr, next),
    },
  })
}

export function emojiMenuState(state: EditorState): EmojiMenuState {
  return emojiMenuKey.getState(state) ?? INACTIVE
}

/**
 * `:쿼리` 를 커스텀 이모지 멘션 노드로 바꾼다 — 한 트랜잭션이다(Cmd+Z 한 번에 돌아온다). 노드에는 id 만(정본 ⑦). 뒤에 공백을 붙이지
 * 않는다.
 */
export function insertCustomEmoji(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, emojiId: string): boolean {
  const menu = emojiMenuState(state)
  if (!menu.active) return false
  const node = state.schema.nodes[MENTION_NODE]?.create({
    mention: { type: 'custom_emoji', custom_emoji: { id: emojiId.toLowerCase() } },
    plainText: '',
  })
  if (node === undefined) return false
  if (dispatch === undefined) return true
  const tr = state.tr.replaceWith(menu.from, state.selection.head, node)
  dispatch(closeEmojiMenu(tr))
  return true
}

/**
 * 닫는 `:` 로 닫힌 `:이름:` 을 커스텀 이모지 멘션 노드로 바꾼다 — 화면이 이름이 꼭 맞는 이모지를 찾았을 때. 그 자리가 아직
 * `:이름:` 그대로인지 다시 본다(그 사이 다른 트랜잭션이 들어왔을 수 있다). 바꾸면 true.
 */
export function replaceColonEmoji(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  colon: { readonly from: number; readonly to: number; readonly name: string },
  emojiId: string,
): boolean {
  if (colon.to > state.doc.content.size || state.doc.textBetween(colon.from, colon.to) !== `:${colon.name}:`) return false
  const node = state.schema.nodes[MENTION_NODE]?.create({
    mention: { type: 'custom_emoji', custom_emoji: { id: emojiId.toLowerCase() } },
    plainText: '',
  })
  if (node === undefined) return false
  if (dispatch !== undefined) dispatch(state.tr.replaceWith(colon.from, colon.to, node))
  return true
}
