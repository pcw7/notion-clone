/**
 * 콜아웃 아이콘 — 디자인 트랙 4c (정본 §3.4 [보강] 콜아웃 아이콘 · F-01-02 · DOM · DB 없음)
 *
 * 자리는 콜아웃 블록의 `properties.icon` 이다 — 본문(Y.Doc)이 정본이고 행은 투영이다. 페이지 아이콘(`format.page_icon` — 페이지 행의 것)과
 * 다른 자리다. v1 은 이모지 하나(`{type:'emoji', emoji}` — 페이지 아이콘과 같은 "이모지 한 글자" 규칙 · 다른 키 없음). 없으면 **키가 없고**
 * 화면은 💡 를 그린다(저장하지 않는 기본값 — 노션의 새 콜아웃과 같은 모습).
 */

import { isSingleEmoji } from '../contracts/emoji.ts'
import { isPlainRecord } from '../contracts/json-safe.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'

export const CALLOUT_TYPE = 'callout' as const
export const CALLOUT_ICON_KEY = 'icon'
/** 아이콘이 없는 콜아웃이 그리는 것 — 저장하지 않는다. */
export const DEFAULT_CALLOUT_EMOJI = '💡'

export type CalloutIcon = { readonly type: 'emoji'; readonly emoji: string }

/** 저장 모양이 맞는 아이콘인가 — 객체 · `type: 'emoji'` · `emoji` 는 이모지 한 글자 · 다른 키 없음. */
export function isCalloutIcon(value: unknown): value is CalloutIcon {
  if (!isPlainRecord(value)) return false
  return Object.keys(value).length === 2 && value.type === 'emoji' && typeof value.emoji === 'string' && isSingleEmoji(value.emoji)
}

/** 저장된 아이콘의 이모지 — 없거나 모양이 틀리면 `null`(화면은 기본 💡). */
export function calloutEmojiOf(props: unknown): string | null {
  if (!isPlainRecord(props)) return null
  const icon = props[CALLOUT_ICON_KEY]
  return isCalloutIcon(icon) ? icon.emoji : null
}

/** 그릴 이모지 — 저장된 것, 없으면 💡. */
export function calloutGlyph(props: unknown): string {
  return calloutEmojiOf(props) ?? DEFAULT_CALLOUT_EMOJI
}

/**
 * 아이콘을 바꾼 속성 — `emoji` 가 `null` 이면 키를 지운다(💡 로 돌아간다). 이모지 한 글자가 아니면 던진다(부르는 쪽은 고르개에서 고른
 * 것만 넘긴다). 바뀐 것이 없으면 **같은 객체**를 돌려준다 — 부르는 쪽이 쓰지 않을 수 있게.
 */
export function withCalloutIcon(props: Readonly<Record<string, unknown>>, emoji: string | null): Readonly<Record<string, unknown>> {
  if (emoji !== null && !isSingleEmoji(emoji)) throw new Error(`콜아웃 아이콘은 이모지 한 글자여야 합니다: ${JSON.stringify(emoji)}`)
  const current = calloutEmojiOf(props)
  const stored = Object.hasOwn(props, CALLOUT_ICON_KEY)
  if (emoji === null) {
    if (!stored) return props
    const rest = { ...props }
    delete rest[CALLOUT_ICON_KEY]
    return rest
  }
  if (current === emoji) return props
  return { ...props, [CALLOUT_ICON_KEY]: { type: 'emoji', emoji } }
}

/** 본문 저장의 검증(`validateDoc`) — `icon` 이 있으면 모양이 맞아야 한다. */
export function validateCalloutProperties(props: unknown, path: string): { path: string; message: string }[] {
  if (!isPlainRecord(props) || !Object.hasOwn(props, CALLOUT_ICON_KEY)) return []
  return isCalloutIcon(props[CALLOUT_ICON_KEY])
    ? []
    : [{ path: `${path}.${CALLOUT_ICON_KEY}`, message: '콜아웃 아이콘은 {"type":"emoji","emoji":"이모지 한 글자"} 여야 합니다' }]
}

/**
 * 마크다운의 `<aside>` 첫 줄에서 아이콘을 떼어 낸다(가져오기 — 노션의 내보내기는 첫 줄 앞에 이모지와 공백을 쓴다). 이모지 한 글자 +
 * 공백으로 시작하거나 줄 전체가 이모지 한 글자일 때만(글이 빈 콜아웃) — 아니면 `null`.
 */
export function splitLeadingEmoji(line: string): { emoji: string; rest: string } | null {
  if (isSingleEmoji(line)) return { emoji: line, rest: '' }
  const space = line.indexOf(' ')
  if (space <= 0) return null
  const head = line.slice(0, space)
  return isSingleEmoji(head) ? { emoji: head, rest: line.slice(space + 1) } : null
}

/**
 * 콜아웃 제목의 첫 런에서 아이콘을 떼어 낸다(가져오기). 첫 런이 링크 없는 글이고 `splitLeadingEmoji` 가 맞을 때만 — 남은 글이 없으면
 * 그 런을 뺀다. 아니면 제목을 그대로 돌려준다.
 */
export function liftCalloutIcon(title: readonly RichTextRun[]): { emoji: string | null; title: RichTextRun[] } {
  const first = title[0]
  if (first === undefined || first.type !== 'text' || !first.text || first.text.link !== null) return { emoji: null, title: [...title] }
  const split = splitLeadingEmoji(first.text.content)
  if (split === null) return { emoji: null, title: [...title] }
  const rest = title.slice(1)
  if (split.rest === '') return { emoji: split.emoji, title: rest }
  return { emoji: split.emoji, title: [{ ...first, plain_text: split.rest, text: { ...first.text, content: split.rest } }, ...rest] }
}
