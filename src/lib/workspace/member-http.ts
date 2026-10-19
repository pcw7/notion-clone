/**
 * 멤버 관리 API 의 HTTP 경계 — 거부 코드 매핑 (10o-1 · F-06-02)
 *
 *   forbidden             → 403   멤버를 다룰 역할이 아니거나, owner 만 할 수 있는 일이다(관리 역할)
 *   not_found             → 404   이 워크스페이스의 활성 · 게스트 아닌 사람이 아니다
 *   invalid_role          → 400   멤버급 넷이 아닌 역할
 *   last_owner            → 409   남는 활성 owner 가 없다
 *   self                  → 409   자기 자신을 내보낸다
 *   teamspace_last_owner  → 409   그 사람이 마지막 owner 인 teamspace 가 있다 — `teamspaces` 가 그 이름들이다
 */

import type { MemberManageFailure } from './member.ts'

const STATUS: Readonly<Record<MemberManageFailure, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid_role: 400,
  last_owner: 409,
  self: 409,
  teamspace_last_owner: 409,
}

export function memberManageResponse(failure: { readonly reason: MemberManageFailure; readonly teamspaces?: readonly string[] }): Response {
  return Response.json(
    { error: failure.reason, ...(failure.teamspaces === undefined ? {} : { teamspaces: failure.teamspaces }) },
    { status: STATUS[failure.reason] },
  )
}
