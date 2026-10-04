/**
 * 워크스페이스 밖의 사람 — 접근 요청 전용 신원 (7g-2 · F-06-15)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 접근 요청의 길 ⑩ (a) · (c)
 *
 * 로그인했지만 이 워크스페이스에 멤버십이 없거나 떠난(`removed`) 사람. 그 사람은 이 워크스페이스에서 아무것도 보지 못하므로
 * `SessionContext` 가 없다 — 0단계를 지나지 않았다(A9). 그런데도 할 수 있는 일이 하나 있다: 주소를 가진 페이지의 **접근 요청**.
 * 이 타입은 그 한 가지를 위한 신원이다.
 *
 * ⚠ **권한을 묻는 함수에 넣지 마라.** 이것은 "이 사람은 이 워크스페이스의 사람이 **아니다**"의 증명이다 — 무엇을 볼 수 있다는
 * 증명이 아니다. `SessionContext` 처럼 브랜디드라 리터럴로 만들 수 없고, `resolveOutsiderContext()` 만 발급한다.
 *
 * 멈춘(`suspended`) · 초대만 받은(`invited`) 사람은 밖의 사람이 아니다 — 멈춘 사람이 요청으로 돌아오면 멈춤을 우회한다. 워크스페이스가
 * 있는지는 묻지 않는다 — 없는 워크스페이스에도 멤버십이 없으므로 둘을 가르면 존재가 샌다. 요청할 페이지를 찾는 쪽이 가른다.
 */

import type { UserId, WorkspaceId } from '../ids.ts'
import { asUserId, asWorkspaceId } from '../ids.ts'
import { queryMaybe } from '../db/pool.ts'
import { hashSessionToken } from './session-context.ts'

declare const outsiderContextBrand: unique symbol

/** 이 값을 갖고 있다 = 이 사용자는 로그인했고, 이 워크스페이스의 사람이 아니다(머리말). */
export type OutsiderContext = {
  readonly [outsiderContextBrand]: true
  readonly userId: UserId
  readonly workspaceId: WorkspaceId
}

/**
 * 세션 토큰과 워크스페이스로 밖의 사람의 신원을 만든다 — 아니면 null(세션이 없다 · 만료 · 폐기 · 계정이 살아 있지 않다 · 이미 이
 * 워크스페이스의 사람이다 · 멈췄다 · 초대만 받았다).
 *
 * 세션과 멤버십을 한 번에 읽는다 — `resolveSessionContext` 와 같은 까닭(나눠 읽으면 다른 시점의 사실을 섞는다).
 */
export async function resolveOutsiderContext(
  token: string | null | undefined,
  workspaceId: WorkspaceId,
): Promise<OutsiderContext | null> {
  if (!token) return null
  const row = await queryMaybe<{ user_id: string }>(
    `SELECT s.user_id
       FROM user_session s
       JOIN "user" u ON u.id = s.user_id AND u.status = 'active' AND u.deleted_at IS NULL
       LEFT JOIN workspace_member m ON m.user_id = s.user_id AND m.workspace_id = $2
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND (m.user_id IS NULL OR m.status = 'removed')
        -- 2단계 인증을 켠 사람은 둘째 단계를 거친 세션이어야 한다(8i-2a · 정본 §3.2 [보강] 2단계 인증 ④)
        AND (s.mfa_satisfied OR NOT EXISTS (SELECT 1 FROM mfa_method mm WHERE mm.user_id = s.user_id AND mm.confirmed_at IS NOT NULL))`,
    [hashSessionToken(token), workspaceId],
  )
  if (row === null) return null
  return { userId: asUserId(row.user_id), workspaceId: asWorkspaceId(workspaceId) } as OutsiderContext
}
