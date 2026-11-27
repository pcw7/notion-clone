/**
 * 계정 이메일 라우트의 공용 — 거부 코드의 HTTP 상태 · 본문 읽기 (AC-1 · F-14-07)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ③ ⑦
 *
 *   invalid_email · invalid · expired             400   입력 · 코드가 맞지 않는다
 *   session_required · reauth_required ·
 *   wrong_password                                403   이 세션으로는 못 한다(위임 · API 토큰 · 재인증)
 *   not_found                                     404   이 계정의 주소가 아니다
 *   already_yours · limit_reached · unavailable ·
 *   primary_locked · already_primary              409   지금 상태가 허락하지 않는다
 *   rate_limited · too_many_attempts              429
 *
 * 다른 계정의 주소를 더하려 한 요청은 거부가 아니다 — 비어 있는 주소와 같은 200 이다(③ 열거 방지).
 */

import type { EmailFailure } from '@/lib/auth/account-email'

export const EMAIL_STATUS: Readonly<Record<EmailFailure, number>> = {
  invalid_email: 400,
  invalid: 400,
  expired: 400,
  session_required: 403,
  reauth_required: 403,
  wrong_password: 403,
  not_found: 404,
  already_yours: 409,
  limit_reached: 409,
  unavailable: 409,
  primary_locked: 409,
  already_primary: 409,
  rate_limited: 429,
  too_many_attempts: 429,
}

export const emailFailure = (reason: EmailFailure): Response => Response.json({ error: reason }, { status: EMAIL_STATUS[reason] })

/** JSON 객체의 칸 — 객체가 아니면 빈 것. */
export const fieldsOf = (parsed: unknown): Record<string, unknown> =>
  typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
