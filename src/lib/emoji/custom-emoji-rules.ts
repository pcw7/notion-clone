/**
 * 커스텀 이모지의 규칙 — 서버 명령과 화면이 함께 쓴다 (인접 제품 7c-1 · 7c-2b · F-13-16 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ① · ⑥
 *
 * 화면이 **파일을 올리기 전에** 같은 규칙으로 먼저 거르려고 명령(`custom-emoji.ts` — DB 를 쓴다)에서 떼어 냈다. 올리기는 두 번의
 * 요청(파일 → 이모지)이라, 이름이 틀린 것을 이모지 단계에서야 알면 올린 파일이 참조 0 으로 남는다(⑥).
 */

/** 이름의 모양 — 0096 의 CHECK 과 같다. */
export const EMOJI_NAME_PATTERN = /^[a-z0-9_-]{1,40}$/
/** 이름의 최대 길이 — 위 모양의 40. */
export const MAX_EMOJI_NAME_LENGTH = 40
/** 워크스페이스마다 살아 있는 이모지 수(13 *"최대 500개"*). */
export const MAX_CUSTOM_EMOJI = 500
/** 이모지 이미지의 크기 — 아이콘보다 작게(13 *"대용량/애니메이션 파일 — 크기 제한 필요"*). */
export const MAX_EMOJI_BYTES = 1024 * 1024

/** 이름을 받는 모양으로 — 앞뒤 공백과 양 끝의 `:` 를 걷고 소문자로. 받을 수 없으면 null. */
export function normalizeEmojiName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/^:+|:+$/g, '').toLowerCase()
  return EMOJI_NAME_PATTERN.test(name) ? name : null
}

/**
 * 파일 이름에서 이모지 이름을 제안한다(⑥) — 확장자를 떼고 소문자로 · 받을 수 없는 글자의 덩어리는 하이픈 하나 · 양 끝의 하이픈은
 * 걷고 40자로 자른다. 남는 것이 없으면(한글만인 이름 등) `emoji`. 늘 `normalizeEmojiName` 이 받는 모양이다.
 */
export function suggestEmojiName(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '').toLowerCase()
  const name = base
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_EMOJI_NAME_LENGTH)
    .replace(/-+$/g, '')
  return name === '' ? 'emoji' : name
}

/**
 * 이름으로 찾는다(고르개의 커스텀 탭 · ⑥) — 부분 일치 · 양 끝의 `:` 와 대소문자 · 앞뒤 공백을 무시한다. 빈 검색어면 그대로(이름 순은
 * 목록이 이미 지킨다). 앞에서 맞는 것을 먼저 세운다(`par` → `party` 가 `sparkle` 보다 앞).
 */
export function searchCustomEmoji<T extends { readonly name: string }>(list: readonly T[], query: string): T[] {
  const q = query.trim().replace(/^:+|:+$/g, '').toLowerCase()
  if (q === '') return [...list]
  const prefix = list.filter((e) => e.name.startsWith(q))
  const inner = list.filter((e) => !e.name.startsWith(q) && e.name.includes(q))
  return [...prefix, ...inner]
}

/** 반응의 커스텀 이모지 키 — `custom_emoji:{uuid}`(소문자 · 0098 의 CHECK 과 같은 모양 · 정본 [보강] 커스텀 이모지 ⑩). */
const REACTION_KEY = /^custom_emoji:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** 커스텀 이모지 반응의 키(7c-3d-2) — 아이콘의 가리키는 글자(`pageIconKey`)와 같은 모양. */
export function customEmojiReactionKey(emojiId: string): string {
  return `custom_emoji:${emojiId.toLowerCase()}`
}

/** 반응 키가 커스텀 이모지면 그 id(소문자) — 아니면 null(유니코드 이모지 · 모양이 틀린 키). */
export function customEmojiIdOfReaction(key: string): string | null {
  const match = REACTION_KEY.exec(key)
  return match === null ? null : match[1]!.toLowerCase()
}
