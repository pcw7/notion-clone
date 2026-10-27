/**
 * 글자로 묶기 — 버킷 규칙 (그룹 버킷 트랙 B-2b · 정본 §3.6 [보강] `view.group_by` 의 [보강 B-2b] · 04 F-04-11, DOM 없음)
 *
 * 04 F-04-11 *"text — `exact`(값 그대로) 또는 `alphabet_prefix`(첫 글자)"*.
 *
 * - **글(rich_text) 속성만** — 제목은 묶지 않는다. 덩이 사이로 옮기면 그 그룹의 값이 되는데, 제목이면 페이지 이름이 바뀐다.
 * - **글 그대로(`exact`)** — 키는 서식을 뺀 글(사이드카 `text_value`) 그대로 · 빈 글은 `''`. 다른 덩이로 옮기면 그 글이 된다(서식은 남지
 *   않는다 — 키는 순수 글자다) · 새로 만들면 그 글. 그룹 순서는 한국어 순서(`localeCompare('ko')`).
 * - **첫 글자(`first`)** — 키는 첫 글자(앞의 공백은 건너뛴다)의 머리: 한글은 **초성**(된소리는 예사소리로 — ㄲ → ㄱ, 휴대폰 주소록처럼),
 *   로마자는 대문자, 그 밖(숫자 · 기호 · 다른 문자)은 `#`. 그룹 순서는 ㄱ ~ ㅎ · A ~ Z · `#`. 첫 글자만 정할 수는 없어 **다른 덩이로 옮기거나
 *   그 덩이에 새로 만들 수 없다**(덩이 안의 차례는 바꾼다).
 * - 서버의 키 식(`group.ts` `keyExprOf` — SQL 로 같은 규칙)과 화면의 이름 · 받을 수 있는 덩이가 이 규칙 하나를 쓴다.
 */

export const TEXT_MODES = ['exact', 'first'] as const
export type TextMode = (typeof TEXT_MODES)[number]

export const DEFAULT_TEXT_MODE: TextMode = 'exact'

export const TEXT_MODE_LABEL: Readonly<Record<TextMode, string>> = { exact: '글 그대로', first: '첫 글자' }

export function isTextMode(v: unknown): v is TextMode {
  return typeof v === 'string' && (TEXT_MODES as readonly string[]).includes(v)
}

/** 한글 음절의 초성 19개를 예사소리로 접은 것(ㄲ → ㄱ · ㄸ → ㄷ · ㅃ → ㅂ · ㅆ → ㅅ · ㅉ → ㅈ). 서버의 SQL 도 이 글자열을 쓴다. */
export const FOLDED_CHOSEONG = 'ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ'
/** 첫 글자 키의 순서 — 초성 · 로마자 · 그 밖. */
const INITIAL_ORDER = [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']
/** 그 밖(숫자 · 기호 · 다른 문자)의 키. */
export const OTHER_INITIAL = '#'

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
/** 한 초성이 차지하는 음절 수(중성 21 × 종성 28). */
const PER_CHOSEONG = 588

/** 첫 글자의 머리 — 빈 글이면 `''`. */
export function initialOf(text: string): string {
  const first = /\S/u.exec(text)?.[0]
  if (first === undefined) return ''
  const code = first.codePointAt(0) ?? 0
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) return FOLDED_CHOSEONG[Math.floor((code - HANGUL_FIRST) / PER_CHOSEONG)]!
  if (/^[A-Za-z]$/.test(first)) return first.toUpperCase()
  return OTHER_INITIAL
}

/** 첫 글자 키인가(`''` 는 아니다 — 값 없음은 부르는 쪽이 따로 본다). */
export function isInitialKey(key: string): boolean {
  return INITIAL_ORDER.includes(key)
}

/** 그룹 순서 — 글 그대로는 한국어 순서, 첫 글자는 ㄱ ~ ㅎ · A ~ Z · `#`. */
export function compareTextKeys(a: string, b: string, mode: TextMode): number {
  if (mode === 'first') return INITIAL_ORDER.indexOf(a) - INITIAL_ORDER.indexOf(b)
  return a.localeCompare(b, 'ko')
}

/** 그룹 머리의 이름 — 글 그대로는 그 글, 첫 글자는 그 머리(`#` 는 "그 밖"). */
export function textGroupLabel(key: string, mode: TextMode): string {
  return mode === 'first' && key === OTHER_INITIAL ? '그 밖' : key
}
