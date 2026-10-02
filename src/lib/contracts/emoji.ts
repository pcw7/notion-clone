/**
 * "이모지 한 글자" — teamspace 아이콘(7c-14)과 페이지 아이콘(8c-1 · F-02-05)이 같은 규칙을 쓴다 (DOM · DB 없음)
 *
 * "한 글자"는 **grapheme** 으로 센다 — ZWJ 로 이은 가족 이모지 · 피부색 · 깃발 · 키캡은 코드포인트가 여럿이어도 한 글자다
 * (코드포인트로 세면 그것들을 거부한다 — 7c-14 의 반사실 i3). 글자 하나가 이모지인지는 Unicode 속성으로 본다:
 *   · `Extended_Pictographic` — 거의 모든 이모지(아직 배정되지 않은 그림 문자 구역까지 — 새 버전의 이모지도 받는다)
 *   · `Regional_Indicator` — 깃발(두 글자가 한 grapheme)
 *   · 키캡 — `[0-9#*]` + (FE0F) + U+20E3. 앞의 둘 어느 것에도 들지 않는다 — 7c-14 의 규칙은 `1️⃣` 를 거부했다(8c-1 이 고쳤다)
 *
 * DB 는 grapheme 을 셀 수 없다 — 코드포인트 상한(`MAX_EMOJI_CODE_POINTS`) · 공백 없음만 CHECK 으로 막는다(0032 · 0037). 상한은
 * 가장 긴 표준 이모지 시퀀스(ZWJ 가족 · 깃발 하위 구역 — 코드포인트 10개 안팎)를 넉넉히 받는 값이다.
 */

/** 이모지 한 글자의 코드포인트 상한 — DB 의 CHECK(0032 · 0037)와 같은 값이다. */
export const MAX_EMOJI_CODE_POINTS = 16

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const KEYCAP = /^[0-9#*]️?⃣$/u

/** `text` 가 (앞뒤 공백 없이) 이모지 한 글자인가. */
export function isSingleEmoji(text: string): boolean {
  if (text === '' || [...text].length > MAX_EMOJI_CODE_POINTS) return false
  if ([...graphemes.segment(text)].length !== 1) return false
  return PICTOGRAPHIC.test(text) || KEYCAP.test(text)
}
