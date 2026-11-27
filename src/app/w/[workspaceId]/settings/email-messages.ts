/**
 * 이메일 주소 패널의 문구 — AC-1 (F-14-07 · DOM · DB 없음)
 *
 * 거부 코드의 말 · 해낸 뒤의 말을 한 곳에 둔다. 판정은 서버다(`auth/account-email.ts`). 다른 계정의 주소를 더하려 해도 서버는 비어 있는
 * 주소와 같은 응답을 주므로(정본 §3.2 [보강 AC-0] ③) "코드를 보냈습니다"도 같은 말이다 — 여기서 "이미 쓰인 주소"를 말할 길이 없다.
 */

export function emailFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'invalid_email':
      return '이메일 주소를 확인하세요.'
    case 'reauth_required':
      return '보안을 위해 지금 비밀번호를 넣거나, 다시 로그인한 뒤 10분 안에 해 주세요.'
    case 'wrong_password':
      return '지금 비밀번호가 맞지 않습니다.'
    case 'already_yours':
      return '이미 이 계정의 주소입니다.'
    case 'limit_reached':
      return '주소는 다섯 개까지입니다. 하나를 뺀 뒤 더하세요.'
    case 'rate_limited':
      return '요청이 너무 많습니다. 잠시 뒤 다시 해 주세요.'
    case 'invalid':
      return '코드가 맞지 않습니다.'
    case 'expired':
      return '코드가 만료됐습니다. 코드를 다시 보내세요.'
    case 'too_many_attempts':
      return '여러 번 틀렸습니다. 코드를 다시 보내세요.'
    case 'unavailable':
      return '이 주소는 더할 수 없습니다.'
    case 'not_found':
      return '이 계정의 주소가 아닙니다. 화면을 새로 고쳐 보세요.'
    case 'primary_locked':
      return '대표 주소는 뺄 수 없습니다. 먼저 다른 주소를 대표로 바꾸세요.'
    case 'already_primary':
      return '이미 대표 주소입니다.'
    case 'session_required':
      return '이 세션으로는 바꿀 수 없습니다.'
  }
  return '저장하지 못했습니다.'
}

export const EMAIL_OFFLINE = '연결에 실패했습니다. 바뀐 내용이 저장되지 않았습니다.'

export type EmailDone =
  | { readonly kind: 'requested'; readonly email: string }
  | { readonly kind: 'added'; readonly email: string }
  | { readonly kind: 'primary'; readonly email: string }
  | { readonly kind: 'removed'; readonly email: string; readonly revokedSessions: number }

export function emailDoneMessage(done: EmailDone): string {
  switch (done.kind) {
    case 'requested':
      return `${done.email} 로 확인 코드를 보냈습니다. 메일함의 6자리 코드를 넣으세요(10분).`
    case 'added':
      return `${done.email} 를 더했습니다. 이 주소로도 들어오고 공유를 받을 수 있습니다.`
    case 'primary':
      return `대표 주소를 ${done.email} 로 바꿨습니다. 옛 대표 주소로 알림을 보냈습니다.`
    case 'removed':
      return done.revokedSessions > 0
        ? `${done.email} 를 뺐습니다. 다른 기기 ${done.revokedSessions}곳에서 로그아웃했습니다.`
        : `${done.email} 를 뺐습니다.`
  }
}
