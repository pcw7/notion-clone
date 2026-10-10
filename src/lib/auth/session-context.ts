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
 *
 * ──────────────────────────────────────────────────────────────────────
 * 발급자는 둘이다 (자동화 5b-1 · 정본 §3.10 [보강] DB automation ①)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   · `resolveSessionContext()` — 로그인 세션. 0단계 게이트를 지난다.
 *   · `resolveDelegatedContext()` — DB automation 을 **만든 사람**으로 실행하는 위임(세션 없는 워커가 부른다). 발급 전에 그 사람이
 *     지금도 지워지지 않았고 그 워크스페이스의 활성 멤버인지 본다. SSO · 2단계 인증은 로그인의 문이라 묻지 않는다. `delegation` 을
 *     싣고 `sessionId` 자리에 automation id 를 둔다 — 세션 표를 가리키지 않으므로 세션에 매인 명령(비밀번호 · 2단계 인증)에 넘기지 않는다.
 *
 * 셋째 발급자를 만들지 않는다(CLAUDE.md "권한 코드 규칙").
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

/** 컨텍스트가 온 길 — 로그인의 방법이거나 자동화의 위임(`automation` — 세션이 없다). */
export type ContextAuthMethod = AuthMethod | 'automation'

/**
 * 이 값을 갖고 있다 = 이 사용자가 이 워크스페이스에 들어올 수 있음이 확인됨.
 * 직접 만들 수 없다. resolveSessionContext() · resolveDelegatedContext() 만 발급한다.
 */
export type SessionContext = {
  readonly [sessionContextBrand]: true
  /** 로그인 세션의 id. 위임이면 automation id 다(세션 표를 가리키지 않는다). */
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly workspaceId: WorkspaceId
  readonly authMethod: ContextAuthMethod
  readonly mfaSatisfied: boolean
  readonly role: WorkspaceRole
  /** 자동화의 위임이면 그 automation — 로그인 세션이면 없다. */
  readonly delegation?: { readonly automationId: string }
}

export type SessionDenialReason =
  | 'no_session' // 토큰이 없거나 일치하는 세션이 없음
  | 'expired' // expires_at 경과
  | 'revoked' // revoked_at 설정됨
  | 'not_a_member' // 이 워크스페이스의 멤버가 아님
  | 'member_inactive' // invited / suspended / removed
  | 'sso_required' // <14 R-11> SSO 강제인데 saml 로 로그인하지 않음
  | 'mfa_required' // 2단계 인증을 켠 사람의 세션이 아직 둘째 단계를 거치지 않았다(8i-2a · 정본 §3.2 [보강] 2단계 인증 ④)

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
  mfa_enabled: boolean
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
           EXISTS (SELECT 1 FROM mfa_method mm
                    WHERE mm.user_id = s.user_id AND mm.confirmed_at IS NOT NULL) AS mfa_enabled,
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
  // 2단계 인증 — 켠 사람의 세션은 둘째 단계를 거칠 때까지 아무 데도 들어오지 못한다(정본 ④). 멤버십보다 먼저 묻는다 — 신원이 아직
  // 증명되지 않았다.
  if (row.mfa_enabled && !row.mfa_satisfied) return { ok: false, reason: 'mfa_required' }
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

export type DelegationDenialReason =
  | 'not_found' // 이 워크스페이스의 automation 이 아니다
  | 'creator_left' // 만든 사람이 지워졌거나 이 워크스페이스의 활성 멤버가 아니다

export type DelegationResolution =
  | { readonly ok: true; readonly context: SessionContext }
  | { readonly ok: false; readonly reason: DelegationDenialReason }

/**
 * DB automation 을 **만든 사람**으로 실행하는 컨텍스트 — 세션 없는 워커가 부른다(자동화 5b-1 · 정본 §3.10 [보강] DB automation ①).
 *
 * 한 번의 질의로 automation · 사람 · 멤버십을 읽는다(`resolveSessionContext` 와 같은 까닭 — 다른 시점의 사실을 섞지 않는다). 그 사람이
 * **지금** 지워지지 않았고 활성 멤버여야 한다. 권한(무엇을 할 수 있나)은 여기서 보지 않는다 — 액션이 부르는 명령이 이 컨텍스트로 묻는다.
 */
export async function resolveDelegatedContext(workspaceId: WorkspaceId, automationId: string): Promise<DelegationResolution> {
  const row = await queryMaybe<{ created_by: string; user_deleted: boolean; role: string | null; member_status: string | null }>(
    `SELECT a.created_by, u.deleted_at IS NOT NULL AS user_deleted, m.role, m.status AS member_status
       FROM automation a
       JOIN "user" u ON u.id = a.created_by
       LEFT JOIN workspace_member m ON m.user_id = a.created_by AND m.workspace_id = a.workspace_id
      WHERE a.id = $1 AND a.workspace_id = $2`,
    [automationId, workspaceId],
  )
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.user_deleted || row.role === null || row.member_status !== 'active') return { ok: false, reason: 'creator_left' }
  return {
    ok: true,
    context: {
      sessionId: asSessionId(automationId),
      userId: asUserId(row.created_by),
      workspaceId: asWorkspaceId(workspaceId),
      authMethod: 'automation',
      mfaSatisfied: false,
      role: row.role as WorkspaceRole,
      delegation: { automationId },
    } as SessionContext,
  }
}
