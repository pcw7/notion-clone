/**
 * 계정의 2단계 인증 라우트들이 같이 쓰는 것 — 거부 코드의 HTTP 상태 (잔여 묶음 8i-2a · F-14-05)
 *
 *   invalid_code · invalid_label          400  입력이 맞지 않는다
 *   not_found                             404  그런 수단 · 등록이 없다(남의 것 · 30분이 지났다 · 꺼져 있다)
 *   password_required · too_many_methods  409  지금 상태가 허락하지 않는다(비밀번호를 먼저 · TOTP 는 둘까지)
 */

import type { MfaFailure } from '@/lib/auth/mfa'

export const MFA_STATUS: Readonly<Record<MfaFailure, number>> = {
  invalid_code: 400,
  invalid_label: 400,
  not_found: 404,
  password_required: 409,
  too_many_methods: 409,
}

export const mfaFailure = (reason: MfaFailure): Response => Response.json({ error: reason }, { status: MFA_STATUS[reason] })

/** JSON 본문의 한 칸 — 본문이 객체가 아니면 undefined. */
export const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined
