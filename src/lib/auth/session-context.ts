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
 *   · `resolveSessionContext()` — 로그인 세션. 0단계 게이트를 지난다. **공개 API 의 개인 토큰도 이 함수가 받는다**(API-1 · 정본
 *     §3.1 [보강 API-1] ②) — 워크스페이스는 토큰 행에서 오고, 같은 게이트(`passGate` — 지운 워크스페이스 · 멤버십 · SSO)를 지난다.
 *     `apiToken` 을 싣고 `sessionId` 자리에 토큰 id 를 둔다.
 *   · `resolveDelegatedContext()` — DB automation 을 **만든 사람**으로 실행하는 위임(세션 없는 워커가 부른다). 발급 전에 그 사람이
 *     지금도 지워지지 않았고 그 워크스페이스의 활성 멤버인지 본다. SSO · 2단계 인증은 로그인의 문이라 묻지 않는다. `delegation` 을
 *     싣고 `sessionId` 자리에 automation id 를 둔다.
 *
 * 위임 · API 토큰의 컨텍스트는 세션 표를 가리키지 않는다 — **세션에 매인 명령**(비밀번호 · 2단계 인증 · 토큰 관리 · 멤버 · 워크스페이스
 * 삭제 · 감사 로그)은 `isLoginSession()` 이 거짓이면 거부한다. 감사의 IP 처럼 세션 행을 읽는 곳은 `loginSessionIdOf()` 를 쓴다.
 *
 * 셋째 발급자를 만들지 않는다(CLAUDE.md "권한 코드 규칙").
 *
 * 둘 다 **지운 워크스페이스**(AD-1 · 정본 §3.1 [보강 AD-1] ③)에는 내주지 않는다(`workspace_deleted`) — 이 한 조건이 앱 화면 · API ·
 * 협업 서버 · 위임 자동화를 한꺼번에 닫는다. 세션 없는 길(공개 게시 · 폼 · 워커의 고르기)은 각자 같은 조건을 묻는다.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

import type { SessionId, UserId, WorkspaceId } from '../ids.ts'
import { asSessionId, asUserId, asWorkspaceId } from '../ids.ts'
import { query, queryMaybe } from '../db/pool.ts'

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

/** 컨텍스트가 온 길 — 로그인의 방법이거나 자동화의 위임(`automation`) · 공개 API 의 개인 토큰(`api_token`). 뒤의 둘은 세션이 없다. */
export type ContextAuthMethod = AuthMethod | 'automation' | 'api_token'

/**
 * 이 값을 갖고 있다 = 이 사용자가 이 워크스페이스에 들어올 수 있음이 확인됨.
 * 직접 만들 수 없다. resolveSessionContext() · resolveDelegatedContext() 만 발급한다.
 */
export type SessionContext = {
  readonly [sessionContextBrand]: true
  /** 로그인 세션의 id. 위임이면 automation id · API 토큰이면 토큰 id 다(세션 표를 가리키지 않는다 — `loginSessionIdOf`). */
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly workspaceId: WorkspaceId
  readonly authMethod: ContextAuthMethod
  readonly mfaSatisfied: boolean
  readonly role: WorkspaceRole
  /** 자동화의 위임이면 그 automation — 로그인 세션이면 없다. */
  readonly delegation?: { readonly automationId: string }
  /** 공개 API 의 개인 토큰이면 그 토큰(API-1) — 로그인 세션이면 없다. */
  readonly apiToken?: { readonly tokenId: string }
}

/**
 * 로그인 세션에서 온 컨텍스트인가 — 위임(`delegation`)도 API 토큰(`apiToken`)도 아니다. **세션에 매인 명령**(비밀번호 · 2단계 인증 ·
 * 토큰 관리 · 멤버 · 워크스페이스 삭제 · 감사 로그)은 이것이 거짓이면 거부한다(정본 [보강 API-1] ②).
 */
export function isLoginSession(ctx: SessionContext): boolean {
  return ctx.delegation === undefined && ctx.apiToken === undefined
}

/** 세션 표의 id — 로그인 세션일 때만(감사의 IP · 세션 폐기의 "이 세션"). 위임 · API 토큰이면 null. */
export function loginSessionIdOf(ctx: SessionContext): SessionId | null {
  return isLoginSession(ctx) ? ctx.sessionId : null
}

export type SessionDenialReason =
  | 'no_session' // 토큰이 없거나 일치하는 세션이 없음
  | 'expired' // expires_at 경과
  | 'revoked' // revoked_at 설정됨
  | 'not_a_member' // 이 워크스페이스의 멤버가 아님
  | 'member_inactive' // invited / suspended / removed
  | 'sso_required' // <14 R-11> SSO 강제인데 saml 로 로그인하지 않음
  | 'mfa_required' // 2단계 인증을 켠 사람의 세션이 아직 둘째 단계를 거치지 않았다(8i-2a · 정본 §3.2 [보강] 2단계 인증 ④)
  | 'workspace_deleted' // 지운 워크스페이스(AD-1 · 정본 §3.1 [보강 AD-1] ③) — 없는 워크스페이스와 같은 답(404). 밖의 사람의 길로도 보내지 않는다

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
 * API 토큰(`api_token`)은 SAML 로그인이 아니다 — SSO 를 강제한 워크스페이스에서는 owner 의 토큰만 지난다.
 */
export function canEnterWorkspace(input: {
  ssoEnforced: boolean
  authMethod: ContextAuthMethod
  role: WorkspaceRole
}): boolean {
  if (!input.ssoEnforced) return true
  if (input.authMethod === 'saml') return true
  return input.role === 'owner' || input.role === 'guest'
}

/** 0단계 게이트가 읽는 멤버십 · 워크스페이스의 사실 — 세션 · API 토큰의 질의가 같은 이름으로 읽는다. */
type GateRow = {
  role: string | null
  member_status: string | null
  sso_enforced: boolean | null
  workspace_deleted: boolean
}

/**
 * 0단계 게이트의 몸 — 지운 워크스페이스 · 멤버십 · SSO(정본 §3.11). **세션과 API 토큰이 이 하나를 지난다**(API-1 ②) — 둘로 베끼면
 * 한쪽만 고쳐지는 날이 온다. 통과하면 역할.
 */
function passGate(
  row: GateRow,
  authMethod: ContextAuthMethod,
): { readonly ok: true; readonly role: WorkspaceRole } | { readonly ok: false; readonly reason: SessionDenialReason } {
  // 지운 워크스페이스(AD-1 ③) — 멤버십보다 먼저 묻는다. 멤버든 아니든 같은 답이다(없는 워크스페이스처럼 404). 로그인 전의 답(401)은
  // 부르는 쪽에서 이미 갈렸다 — 없는 워크스페이스도 로그인 전에는 401 이다.
  if (row.workspace_deleted) return { ok: false, reason: 'workspace_deleted' }
  if (row.role === null) return { ok: false, reason: 'not_a_member' }
  if (row.member_status !== 'active') return { ok: false, reason: 'member_inactive' }
  const role = row.role as WorkspaceRole
  if (!canEnterWorkspace({ ssoEnforced: row.sso_enforced ?? false, authMethod, role })) return { ok: false, reason: 'sso_required' }
  return { ok: true, role }
}

type SessionRow = GateRow & {
  session_id: string
  user_id: string
  auth_method: string
  mfa_satisfied: boolean
  mfa_enabled: boolean
  is_expired: boolean
  is_revoked: boolean
}

/** 공개 API 의 개인 토큰 — 쿠키 대신 이것을 내면 워크스페이스는 토큰 행에서 온다(API-1). */
export type ApiTokenCredential = { readonly apiToken: string }

/** `last_used_at` 을 이만큼 지나야 다시 쓴다 — 요청마다 쓰지 않는다(정본 [보강 API-1] · 0145 ③). */
export const API_TOKEN_TOUCH_SECONDS = 60

/**
 * 세션 토큰과 워크스페이스로부터 컨텍스트를 만든다.
 *
 * 한 번의 쿼리로 세션 · 멤버십 · SSO 설정을 모두 읽는다. 세 번 나눠 읽으면
 * 그 사이에 권한이 바뀌어 서로 다른 시점의 사실을 섞게 된다.
 *
 * `{ apiToken }` 을 내면 공개 API 의 개인 토큰으로 묻는다(API-1 ② — 발급자는 그대로 둘이다). 워크스페이스는 토큰 행의 것이다.
 */
export async function resolveSessionContext(token: string | null | undefined, workspaceId: WorkspaceId): Promise<SessionResolution>
export async function resolveSessionContext(credential: ApiTokenCredential): Promise<SessionResolution>
export async function resolveSessionContext(
  token: string | null | undefined | ApiTokenCredential,
  workspaceId?: WorkspaceId,
): Promise<SessionResolution> {
  if (typeof token === 'object' && token !== null) return resolveApiTokenCredential(token.apiToken)
  if (!token || workspaceId === undefined) return { ok: false, reason: 'no_session' }

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
           COALESCE(sc.enforced, false)  AS sso_enforced,
           COALESCE(w.deleted_at IS NOT NULL, false) AS workspace_deleted
      FROM user_session s
      LEFT JOIN workspace_member m
             ON m.user_id = s.user_id AND m.workspace_id = $2
      LEFT JOIN sso_config sc
             ON sc.workspace_id = $2
      LEFT JOIN workspace w
             ON w.id = $2
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

  const authMethod = row.auth_method as AuthMethod
  const gate = passGate(row, authMethod)
  if (!gate.ok) return gate

  return {
    ok: true,
    context: {
      sessionId: asSessionId(row.session_id),
      userId: asUserId(row.user_id),
      workspaceId: asWorkspaceId(workspaceId),
      authMethod,
      mfaSatisfied: row.mfa_satisfied,
      role: gate.role,
    } as SessionContext,
  }
}

/**
 * 개인 토큰의 길(API-1 ②) — 한 번의 질의로 토큰 · 사람 · 멤버십 · SSO 를 읽고 `passGate` 를 지난다. 그 앞에서 토큰만의 것을 묻는다:
 * 폐기 · 만료 · 사람이 지워졌거나 멈췄다(`user.status`) · 게스트로 내려갔다(만들 때와 같은 판정 — 토큰은 멤버 이상의 것). 2단계 인증은
 * 묻지 않는다 — 토큰은 그 단계를 지난 세션이 만들었다. 통과하면 `last_used_at` 을 1분에 한 번만 쓴다.
 */
async function resolveApiTokenCredential(token: string): Promise<SessionResolution> {
  if (token === '') return { ok: false, reason: 'no_session' }
  const row = await queryMaybe<
    GateRow & {
      token_id: string
      user_id: string
      workspace_id: string
      is_revoked: boolean
      is_expired: boolean
      user_gone: boolean
      touch_due: boolean
    }
  >(
    `SELECT t.id                                                AS token_id,
            t.user_id                                           AS user_id,
            t.workspace_id                                      AS workspace_id,
            (t.revoked_at IS NOT NULL)                          AS is_revoked,
            (t.expires_at IS NOT NULL AND t.expires_at <= now()) AS is_expired,
            (u.deleted_at IS NOT NULL OR u.status <> 'active')  AS user_gone,
            (t.last_used_at IS NULL OR t.last_used_at <= now() - make_interval(secs => $2)) AS touch_due,
            m.role                                              AS role,
            m.status                                            AS member_status,
            COALESCE(sc.enforced, false)                        AS sso_enforced,
            (w.deleted_at IS NOT NULL)                          AS workspace_deleted
       FROM api_token t
       JOIN "user" u ON u.id = t.user_id
       JOIN workspace w ON w.id = t.workspace_id
       LEFT JOIN workspace_member m ON m.user_id = t.user_id AND m.workspace_id = t.workspace_id
       LEFT JOIN sso_config sc ON sc.workspace_id = t.workspace_id
      WHERE t.token_hash = $1`,
    [hashSessionToken(token), API_TOKEN_TOUCH_SECONDS],
  )
  if (!row) return { ok: false, reason: 'no_session' }
  if (row.is_revoked) return { ok: false, reason: 'revoked' }
  if (row.is_expired) return { ok: false, reason: 'expired' }
  // 지워졌거나 멈춘 사람의 토큰은 없는 토큰과 같다
  if (row.user_gone) return { ok: false, reason: 'no_session' }
  const gate = passGate(row, 'api_token')
  if (!gate.ok) return gate
  if (gate.role === 'guest') return { ok: false, reason: 'not_a_member' }

  if (row.touch_due) {
    // 조건을 다시 건다 — 같은 순간의 두 요청이 둘 다 쓰지 않게
    await query(
      `UPDATE api_token SET last_used_at = now()
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at <= now() - make_interval(secs => $2))`,
      [row.token_id, API_TOKEN_TOUCH_SECONDS],
    )
  }

  return {
    ok: true,
    context: {
      sessionId: asSessionId(row.token_id),
      userId: asUserId(row.user_id),
      workspaceId: asWorkspaceId(row.workspace_id),
      authMethod: 'api_token',
      mfaSatisfied: false,
      role: gate.role,
      apiToken: { tokenId: row.token_id },
    } as SessionContext,
  }
}

export type DelegationDenialReason =
  | 'not_found' // 이 워크스페이스의 automation 이 아니다
  | 'creator_left' // 만든 사람이 지워졌거나 이 워크스페이스의 활성 멤버가 아니다
  | 'workspace_deleted' // 지운 워크스페이스(AD-1 ③) — 자동화를 끄지 않는다(되살리면 그대로 돈다)

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
  const row = await queryMaybe<{
    created_by: string
    user_deleted: boolean
    workspace_deleted: boolean
    role: string | null
    member_status: string | null
  }>(
    `SELECT a.created_by, u.deleted_at IS NOT NULL AS user_deleted, w.deleted_at IS NOT NULL AS workspace_deleted,
            m.role, m.status AS member_status
       FROM automation a
       JOIN "user" u ON u.id = a.created_by
       JOIN workspace w ON w.id = a.workspace_id
       LEFT JOIN workspace_member m ON m.user_id = a.created_by AND m.workspace_id = a.workspace_id
      WHERE a.id = $1 AND a.workspace_id = $2`,
    [automationId, workspaceId],
  )
  if (!row) return { ok: false, reason: 'not_found' }
  // 지운 워크스페이스(AD-1 ③) — 만든 사람을 묻기 전에. `creator_left` 로 답하면 부르는 쪽이 자동화를 꺼 버린다
  if (row.workspace_deleted) return { ok: false, reason: 'workspace_deleted' }
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
