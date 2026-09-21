/**
 * teamspace API 의 HTTP 경계 — 거부 코드 매핑 · 주체 읽기 (7c-1조각 · F-06-04)
 *
 *   not_found                                   → 404   없는 · 보관된 · 남의 teamspace, 또는 그 멤버가 아니다
 *   forbidden                                   → 403   멤버이지만 그 역할이 아니다
 *   last_owner                                  → 409   입력은 맞는데 지금 상태가 허락하지 않는다
 *   invalid_name · invalid_visibility · invalid_role · invalid_member → 400
 */

import { isUuid } from '../ids.ts'
import type { TeamspaceFailure, TeamspacePrincipal } from './teamspace.ts'

export function teamspaceFailureStatus(reason: TeamspaceFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'last_owner':
      return 409
    case 'invalid_name':
    case 'invalid_visibility':
    case 'invalid_role':
    case 'invalid_member':
      return 400
  }
}

export function teamspaceFailureResponse(failure: { readonly reason: TeamspaceFailure }): Response {
  return Response.json({ error: failure.reason }, { status: teamspaceFailureStatus(failure.reason) })
}

/** 요청의 주체 — 사람 또는 그룹, id 는 uuid. 모양이 아니면 null(→ 400 invalid_member). */
export function readTeamspacePrincipal(type: unknown, id: unknown): TeamspacePrincipal | null {
  if ((type !== 'user' && type !== 'group') || typeof id !== 'string' || !isUuid(id)) return null
  return { type, id }
}
