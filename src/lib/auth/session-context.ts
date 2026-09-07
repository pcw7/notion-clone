/**
 * 세션 컨텍스트 — 권한 판정의 유일한 입력.
 *
 * 정본 불변식 A9 (00-canonical-data-model.md §3.2):
 *
 *   effective() 의 입력은 user_id 가 아니라
 *   (user_id, workspace_id, auth_method, mfa_satisfied, session_id) 다.
 *   **SSO 강제는 이 컨텍스트가 없으면 UI 장식이다.**
 *
 * 이 파일의 목적은 그 문장을 타입으로 만드는 것이다. `SessionContext` 는
 * 브랜디드 타입이라 리터럴로 만들 수 없고, `resolveSessionContext()` 만이
 * 발급한다. 그리고 그 함수는 발급 전에 0단계 게이트
 * (can_enter_workspace — 정본 §3.11)를 통과시킨다.
 *
 * 결과적으로 **SessionContext 를 손에 쥐고 있다는 것 자체가 "이 사용자는 이
 * 워크스페이스에 들어올 수 있다"는 증명**이 된다. 권한 함수가 userId 만 받는
 * 실수를 저지를 수 없다.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

import type { SessionId, UserId, WorkspaceId } from '../ids.ts'
import { asSessionId, asUserId, asWorkspaceId } from '../ids.ts'
import { queryMaybe } from '../db/pool.ts'

export const AUTH_METHODS = [
  'login_code',
  'password',
  'passkey',
  'google',
  'apple',
  'microsoft',
  'saml',
] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

export const WORKSPACE_ROLES = [
  'owner',
  'membership_admin',
  'member',
  'restricted_member',
  'guest',
] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

declare const sessionContextBrand: unique symbol

/**
 * 이 값을 갖고 있다 = 이 사용자가 이 워크스페이스에 들어올 수 있음이 확인됨.
 * 직접 만들 수 없다. resolveSessionContext() 만 발급한다.
 */
export type SessionContext = {
  readonly [sessionContextBrand]: true
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly workspaceId: WorkspaceId
  readonly authMethod: AuthMethod
  readonly mfaSatisfied: boolean
  readonly role: WorkspaceRole
}

export type SessionDenialReason =
  | 'no_session' // 토큰이 없거나 일치하는 세션이 없음
  | 'expired' // expires_at 경과
  | 'revoked' // revoked_at 설정됨
  | 'not_a_member' // 이 워크스페이스의 멤버가 아님
  | 'member_inactive' // invited / suspended / removed
  | 'sso_required' // <14 R-11> SSO 강제인데 saml 로 로그인하지 않음

export type SessionResolution =
  | { readonly ok: true; readonly context: SessionContext }
  | { readonly ok: false; readonly reason: SessionDenialReason }

/**
 * 세션 토큰 해시.
 *
 * 토큰은 고엔트로피 난수이므로 argon2 같은 느린 KDF 가 필요 없다
 * (사전 공격 대상이 아니다). 비밀번호와 혼동하지 말 것 — 비밀번호는 argon2id 다.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** 해시 비교는 상수 시간으로. 길이가 다르면 즉시 false. */
export function sessionTokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashSessionToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * 0단계 게이트 — 정본 §3.11.
 *
 *   can_enter_workspace(session, ws) =
 *     NOT sso_config.enforced OR session.auth_method='saml' OR member.role IN ('owner','guest')
 *
 * DB 없이 단위 테스트할 수 있도록 순수 함수로 분리한다.
 * owner 예외는 SSO 설정을 잘못해서 자기 워크스페이스에서 잠기는 것을 막고,
 * guest 예외는 외부인이 조직 IdP 계정을 가질 수 없기 때문이다.
 */
export function canEnterWorkspace(input: {
  ssoEnforced: boolean
  authMethod: AuthMethod
  role: WorkspaceRole
}): boolean {
  if (!input.ssoEnforced) return true
  if (input.authMethod === 'saml') return true
  return input.role === 'owner' || input.role === 'guest'
}

type SessionRow = {
  session_id: string
  user_id: string
  auth_method: string
  mfa_satisfied: boolean
  is_expired: boolean
  is_revoked: boolean
  role: string | null
  member_status: string | null
  sso_enforced: boolean | null
}

/**
 * 세션 토큰과 워크스페이스로부터 컨텍스트를 만든다.
 *
 * 한 번의 쿼리로 세션 · 멤버십 · SSO 설정을 모두 읽는다. 세 번 나눠 읽으면
 * 그 사이에 권한이 바뀌어 서로 다른 시점의 사실을 섞게 된다.
 */
export async function resolveSessionContext(
  token: string | null | undefined,
  workspaceId: WorkspaceId,
): Promise<SessionResolution> {
  if (!token) return { ok: false, reason: 'no_session' }

  const row = await queryMaybe<SessionRow>(
    `
    SELECT s.id                          AS session_id,
           s.user_id                     AS user_id,
           s.auth_method                 AS auth_method,
           s.mfa_satisfied               AS mfa_satisfied,
           (s.expires_at <= now())       AS is_expired,
           (s.revoked_at IS NOT NULL)    AS is_revoked,
           m.role                        AS role,
           m.status                      AS member_status,
           COALESCE(sc.enforced, false)  AS sso_enforced
      FROM user_session s
      LEFT JOIN workspace_member m
             ON m.user_id = s.user_id AND m.workspace_id = $2
      LEFT JOIN sso_config sc
             ON sc.workspace_id = $2
     WHERE s.token_hash = $1
    `,
    [hashSessionToken(token), workspaceId],
  )

  if (!row) return { ok: false, reason: 'no_session' }
  if (row.is_revoked) return { ok: false, reason: 'revoked' }
  if (row.is_expired) return { ok: false, reason: 'expired' }
  if (row.role === null) return { ok: false, reason: 'not_a_member' }
  if (row.member_status !== 'active') return { ok: false, reason: 'member_inactive' }

  const authMethod = row.auth_method as AuthMethod
  const role = row.role as WorkspaceRole

  if (!canEnterWorkspace({ ssoEnforced: row.sso_enforced ?? false, authMethod, role })) {
    return { ok: false, reason: 'sso_required' }
  }

  return {
    ok: true,
    context: {
      sessionId: asSessionId(row.session_id),
      userId: asUserId(row.user_id),
      workspaceId: asWorkspaceId(workspaceId),
      authMethod,
      mfaSatisfied: row.mfa_satisfied,
      role,
    } as SessionContext,
  }
}
