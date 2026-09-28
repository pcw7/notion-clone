/**
 * 접근 요청 API 의 HTTP 경계 — 거부 코드 매핑 (7e-1 · F-06-15)
 *
 *   not_found          → 404   요청할 · 처리할 대상이 없다(볼 수 없으면 없는 것과 같다 — 공유 설정과 같은 규칙)
 *   forbidden          → 403   볼 수는 있지만 공유할 수 없다
 *   has_access         → 409   이미 볼 수 있다 — 요청할 것이 없다
 *   decided            → 409   이미 누군가 처리했다
 *   invalid_principal  → 409   요청한 사람이 이제 이 워크스페이스에 없다(입력은 맞는데 지금 상태가 허락하지 않는다)
 *   invalid_level · guest_level → 400
 */

import type { AccessDecisionFailure, AccessRequestFailure } from './access-request.ts'

const STATUS: Readonly<Record<AccessRequestFailure | AccessDecisionFailure, number>> = {
  not_found: 404,
  forbidden: 403,
  has_access: 409,
  decided: 409,
  invalid_principal: 409,
  invalid_level: 400,
  guest_level: 400,
}

export function accessRequestResponse(failure: { readonly reason: AccessRequestFailure | AccessDecisionFailure }): Response {
  return Response.json({ error: failure.reason }, { status: STATUS[failure.reason] })
}
