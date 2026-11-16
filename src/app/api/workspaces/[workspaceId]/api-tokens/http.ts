/**
 * API 토큰 라우트들이 같이 쓰는 것 — 거부 코드의 HTTP 상태 (API-1 · F-09-02)
 *
 *   invalid_name · invalid_expiry  400  이름 · 만료가 맞지 않는다
 *   forbidden                      403  게스트(만들기) · 로그인 세션이 아니다
 *   not_found                      404  내 (살아 있는) 토큰이 아니다
 *   limit_reached                  409  살아 있는 토큰이 이미 20개다
 */

import type { ApiTokenFailure } from '@/lib/api/api-token'

const STATUS: Readonly<Record<ApiTokenFailure, number>> = {
  invalid_name: 400,
  invalid_expiry: 400,
  forbidden: 403,
  not_found: 404,
  limit_reached: 409,
}

export const apiTokenFailure = (reason: ApiTokenFailure): Response => Response.json({ ok: false, error: reason }, { status: STATUS[reason] })
