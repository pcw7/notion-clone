/**
 * 2단계 인증 패널의 문구 — 잔여 묶음 8i-2b (F-14-05 · DOM · DB 없음)
 *
 * 거부 코드(`auth/mfa.ts` `MfaFailure`)의 말 · 저장한 뒤의 말 · 비밀값을 읽기 좋게 끊는 것을 한 곳에 둔다.
 */

export function mfaFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'invalid_code':
      return '코드가 맞지 않습니다. 인증 앱의 지금 코드나 백업 코드를 넣어 주세요.'
    case 'password_required':
      return '2단계 인증을 켜려면 먼저 비밀번호를 정하세요.'
    case 'too_many_methods':
      return '인증 앱은 둘까지 더할 수 있습니다.'
    case 'not_found':
      return '등록이 끝났거나 30분이 지났습니다. 처음부터 다시 하세요.'
    case 'invalid_label':
      return '이름은 40자까지 적을 수 있습니다.'
  }
  return '저장하지 못했습니다.'
}

export const MFA_OFFLINE = '연결에 실패했습니다. 바뀐 내용이 저장되지 않았습니다.'

/** base32 비밀값을 넷씩 끊는다 — 손으로 옮겨 적을 때 읽기 좋게(인증 앱은 공백을 무시한다). */
export const groupSecret = (secret: string): string => secret.replace(/(.{4})/g, '$1 ').trim()

/** 백업 코드 파일 — 한 줄에 하나. */
export const backupCodesFile = (codes: readonly string[]): string =>
  ['notion-clone 백업 코드 — 하나씩 한 번만 쓸 수 있습니다.', '', ...codes, ''].join('\n')
