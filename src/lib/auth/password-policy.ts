/**
 * 비밀번호 정책 — 잔여 묶음 8i-1a (F-14-03, DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 비밀번호 ③ · 14-auth-accounts.md F-14-03
 *       *"최소 8자, 고유 문자 4자 이상. 8~14자면 문자 1개 + 숫자 1개 이상 필수, 15자 이상이면 그 요구가 해제된다"*
 *
 * 서버가 판정하고(`password.ts`) 화면은 **같은 함수로** 체크리스트를 그린다(8i-1b — 길이에 따라 "글자와 숫자" 줄이 사라진다). 강도 미터가
 * 아니라 규칙이다. 256자 상한은 노션의 규칙이 아니라 해시 비용의 상한이다(받아 줄 수 있는 입력의 끝).
 */

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 256
/** 이 길이부터 "글자와 숫자" 요구가 풀린다(passphrase 를 막지 않는다). */
export const PASSWORD_RELAXED_LENGTH = 15
export const PASSWORD_MIN_UNIQUE = 4

export type PasswordRuleId = 'length' | 'unique' | 'letter_and_digit' | 'max_length'

export type PasswordRule = {
  readonly id: PasswordRuleId
  /** 지금 이 비밀번호에 걸리는 규칙인가 — 15자가 넘으면 "글자와 숫자"는 걸리지 않는다. */
  readonly applies: boolean
  readonly met: boolean
}

/** 글자 수는 코드 포인트로 센다(이모지 · 한글 조합이 둘로 세지지 않게). */
const codePoints = (password: string): string[] => [...password]

/** 규칙마다 걸리는지 · 지키는지. 화면의 체크리스트와 서버의 판정이 같은 결과를 본다. */
export function passwordRules(password: string): PasswordRule[] {
  const chars = codePoints(password)
  const length = chars.length
  const unique = new Set(chars).size
  const relaxed = length >= PASSWORD_RELAXED_LENGTH
  const hasLetter = /\p{L}/u.test(password)
  const hasDigit = /\p{Nd}/u.test(password)
  return [
    { id: 'length', applies: true, met: length >= PASSWORD_MIN_LENGTH },
    { id: 'unique', applies: true, met: unique >= PASSWORD_MIN_UNIQUE },
    { id: 'letter_and_digit', applies: !relaxed, met: relaxed || (hasLetter && hasDigit) },
    { id: 'max_length', applies: true, met: length <= PASSWORD_MAX_LENGTH },
  ]
}

/** 정책을 지키는가 — 걸리는 규칙을 모두 지킨다. 글자가 아니면 false. */
export function isAcceptablePassword(password: unknown): password is string {
  return typeof password === 'string' && passwordRules(password).every((rule) => !rule.applies || rule.met)
}
