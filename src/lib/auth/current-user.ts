/**
 * 현재 로그인한 사용자 — **신원 조회 전용.**
 *
 * ⚠ **권한 판정에 쓰지 마라.**
 *
 * 정본 불변식 A9 에 따라 권한을 묻는 모든 함수는 `SessionContext` 를 받아야
 * 한다. 이 함수가 돌려주는 것은 워크스페이스 컨텍스트가 없는 신원일 뿐이며,
 * SSO 강제 게이트도 통과하지 않았다.
 *
 * 이 함수가 필요한 이유: 신규 계정은 **워크스페이스가 0개인 상태로 존재할 수
 * 있다**(F-14-01). 그런 사용자에게는 `SessionContext` 를 만들 수 없지만,
 * "로그인은 되어 있다"는 사실은 보여줘야 한다. 워크스페이스 선택·생성 화면이
 * 이 상태에서 그려진다.
 *
 * 워크스페이스가 정해진 뒤에는 반드시 `resolveSessionContext()` 로 넘어간다.
 */

import { queryMaybe } from '../db/pool.ts'
import { hashSessionToken } from './session-context.ts'
import { readSessionToken } from './session-cookie.ts'

export type CurrentUser = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  /** 이 사용자가 속한 활성 워크스페이스 수. 0이면 온보딩이 필요하다. */
  readonly workspaceCount: number
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await readSessionToken()
  if (!token) return null

  const row = await queryMaybe<{
    user_id: string
    name: string
    email: string | null
    workspace_count: string
  }>(
    `SELECT u.id   AS user_id,
            u.name AS name,
            ue.email::text AS email,
            (SELECT count(*)
               FROM workspace_member m
              WHERE m.user_id = u.id AND m.status = 'active') AS workspace_count
       FROM user_session s
       JOIN "user" u ON u.id = s.user_id
       LEFT JOIN user_email ue ON ue.id = u.primary_email_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'`,
    [hashSessionToken(token)],
  )

  if (!row) return null

  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    workspaceCount: Number(row.workspace_count),
  }
}
