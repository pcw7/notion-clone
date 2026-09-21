/**
 * 그룹 API 의 HTTP 경계 — 거부 코드 매핑 (7a조각 · F-06-03)
 *
 * `database/http.ts` 와 같은 이유로 한 곳에 둔다 — 라우트가 넷이고, 한 라우트만 `not_found` 를 403 으로 줘도
 * 그 라우트만 다른 워크스페이스 그룹의 존재를 흘린다.
 *
 *   not_found                      → 404   없는 · 지운 · 다른 워크스페이스의 그룹
 *   forbidden                      → 403   그룹을 고칠 역할이 아니다 · 게스트
 *   duplicate_name · would_orphan  → 409   입력은 맞는데 지금 상태가 허락하지 않는다
 *   invalid_name · invalid_member  → 400
 */

import type { UserGroupFailure } from './group.ts'

export function userGroupFailureStatus(reason: UserGroupFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'duplicate_name':
    case 'would_orphan':
      return 409
    case 'invalid_name':
    case 'invalid_member':
      return 400
  }
}

export function userGroupFailureResponse(failure: {
  readonly reason: UserGroupFailure
  readonly nodes?: number
}): Response {
  return Response.json(
    { error: failure.reason, ...(failure.nodes !== undefined ? { nodes: failure.nodes } : {}) },
    { status: userGroupFailureStatus(failure.reason) },
  )
}
