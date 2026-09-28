/**
 * 게스트 관리 API 의 HTTP 경계 — 거부 코드 매핑 (7d-3 · F-06-09)
 *
 *   forbidden     → 403   게스트를 다룰 역할이 아니다(owner · membership_admin 만)
 *   not_found     → 404   이 워크스페이스의 들어와 있는 게스트가 아니다
 *   would_orphan  → 409   빼면 관리할 사람이 남지 않는 페이지가 생긴다
 */

import type { GuestManageFailure } from './guest.ts'

const STATUS: Readonly<Record<GuestManageFailure, number>> = {
  forbidden: 403,
  not_found: 404,
  would_orphan: 409,
}

export function guestManageResponse(failure: { readonly reason: GuestManageFailure }): Response {
  return Response.json({ error: failure.reason }, { status: STATUS[failure.reason] })
}
