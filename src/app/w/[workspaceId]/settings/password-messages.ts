/**
 * 비밀번호 패널의 문구 — 잔여 묶음 8i-1b (F-14-03 · DOM · DB 없음)
 *
 * 규칙의 이름 · 거부 코드의 말 · 저장한 뒤의 말을 한 곳에 둔다. 판정은 서버다(`auth/password.ts`) — 체크리스트는 서버와 같은 함수
 * (`passwordRules`)의 결과를 이 이름으로 그린다.
 */

import type { PasswordRule, PasswordRuleId } from '@/lib/auth/password-policy'

export const PASSWORD_RULE_LABEL: Readonly<Record<PasswordRuleId, string>> = {
  length: '8자 이상',
  unique: '서로 다른 글자 4개 이상',
  letter_and_digit: '글자와 숫자를 하나씩',
  max_length: '256자까지',
}

/**
 * 체크리스트에 세울 규칙 — 256자 상한은 넘었을 때만 선다. "글자와 숫자"는 15자부터 걸리지 않으므로 지운 줄로 "15자부터는 필요 없습니다"를
 * 말한다(14 F-14-03 *"15자 넘으면 문자+숫자 항목이 회색으로 소거된다"*).
 */
export function checklistOf(rules: readonly PasswordRule[]): { readonly id: PasswordRuleId; readonly label: string; readonly state: 'met' | 'unmet' | 'waived' }[] {
  return rules
    .filter((rule) => rule.id !== 'max_length' || !rule.met)
    .map((rule) => ({
      id: rule.id,
      label: rule.id === 'letter_and_digit' && !rule.applies ? `${PASSWORD_RULE_LABEL[rule.id]} — 15자부터는 필요 없습니다` : PASSWORD_RULE_LABEL[rule.id],
      state: !rule.applies ? 'waived' : rule.met ? 'met' : 'unmet',
    }))
}

export function passwordFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'weak_password':
      return '비밀번호 규칙을 확인하세요.'
    case 'current_required':
      return '지금 비밀번호를 넣어 주세요.'
    case 'wrong_password':
      return '지금 비밀번호가 맞지 않습니다.'
    case 'no_password':
      return '지울 비밀번호가 없습니다.'
    case 'mfa_enabled':
      return '2단계 인증이 켜져 있어 비밀번호를 지울 수 없습니다. 2단계 인증을 먼저 끄세요.'
  }
  return '저장하지 못했습니다.'
}

export const PASSWORD_OFFLINE = '연결에 실패했습니다. 바뀐 내용이 저장되지 않았습니다.'

/** 저장한 뒤 — 바꿨으면 다른 기기에서 로그아웃한 수를 함께 말한다. */
export function passwordSavedMessage(kind: 'set' | 'changed' | 'removed', revokedSessions = 0): string {
  if (kind === 'set') return '비밀번호를 정했습니다. 이제 이메일과 비밀번호로도 들어올 수 있습니다.'
  if (kind === 'removed') return '비밀번호를 지웠습니다. 이제 로그인 코드로 들어옵니다.'
  return revokedSessions > 0 ? `비밀번호를 바꿨습니다. 다른 기기 ${revokedSessions}곳에서 로그아웃했습니다.` : '비밀번호를 바꿨습니다.'
}
