/**
 * 계정의 이메일 여러 개 — 더하기(코드 요청 · 확인) · 대표로 · 빼기 · 목록 (AC-1 · F-14-07 · F-14-15 의 이메일 바꾸기)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ① ~ ⑩ · DDL 의 user_email(A1 ~ A3) · otp_challenge
 *       14-auth-accounts.md F-14-07 *"주소 입력 → Send verification code → 코드 입력 → 별칭 추가 완료 · Make primary · Remove"*
 *
 *   · `user_email` 에는 **검증된 주소만** 산다(CHECK) — 확인 대기는 `otp_challenge(purpose='email_verify', user_id, email)` 에만 있고 코드를
 *     맞힌 순간 행이 생긴다. 남의 주소를 미검증으로 걸어 선점하지 못한다(①).
 *   · 한 계정에 다섯까지(대표 포함 · ②) — 사람 행을 잠그고 센다.
 *   · 다른 계정의 주소를 더하려 해도 **응답 · 대기 행이 비어 있는 주소와 같다**(코드만 보내지 않고 그 주소로 안내를 보낸다 — ③ 열거 방지).
 *   · 더하기(코드 요청) · 대표로 · 빼기는 **최근 재인증** — 10분 안에 로그인한 세션이거나 지금 비밀번호(⑦). 위임 · API 토큰 컨텍스트는 거부.
 *   · 대표는 빼지 못한다 · 바꾸면 **옛 대표 주소로** 알린다 · 빼면 다른 세션을 폐기한다(⑥ ⑧ ⑨).
 *
 * 메일은 트랜잭션이 끝난 뒤에 보낸다 — 코드 메일은 실패하면 요청이 실패하고, 알림은 실패해도 명령을 되돌리지 않는다(⑧).
 */

import { randomUUID } from 'node:crypto'

import { recordAuditIn } from '../audit/audit.ts'
import { queryMaybe } from '../db/pool.ts'
import { withCommandTransaction, withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { consume } from '../rate-limit.ts'
import { sendAccountNotice, type AccountNotice } from './account-mailer.ts'
import { CODE_REQUEST_PER_EMAIL, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_SECONDS, MAX_EMAILS_PER_ACCOUNT } from './constants.ts'
import { generateOtpCode, hashOtpCode, otpCodeMatches, recordAuthEvent, type RequestContext } from './login-code.ts'
import { sendEmailVerifyCode } from './mailer.ts'
import { verifyPassword } from './password-hash.ts'
import { isLoginSession, type SessionContext } from './session-context.ts'

/** 이 시간 안에 로그인한 세션은 지금 비밀번호 없이 주소를 바꾼다(정본 ⑦ — 2단계 인증의 게이트를 이미 지났다). */
export const EMAIL_REAUTH_MINUTES = 10
/** 코드 요청 — 사람마다 한 시간에 10번(정본 ⑩). 주소마다는 로그인 코드와 같은 값(`CODE_REQUEST_PER_EMAIL`) · 다른 칸. */
export const EMAIL_VERIFY_PER_USER = { limit: 10, windowSeconds: 60 * 60 } as const
/** 재인증의 지금 비밀번호 확인 — 사람마다 15분에 10번(훔친 세션으로 비밀번호를 맞혀 보지 못하게). */
export const EMAIL_REAUTH_PASSWORD_PER_USER = { limit: 10, windowSeconds: 15 * 60 } as const

export type AccountEmail = {
  readonly id: string
  readonly email: string
  readonly isPrimary: boolean
}

/** 확인 대기 — 코드를 보낸 주소(다른 계정의 주소여도 똑같이 선다 — ③). */
export type PendingEmail = {
  readonly email: string
  readonly expiresAt: string
}

export type EmailsStatus = {
  readonly emails: readonly AccountEmail[]
  readonly pending: readonly PendingEmail[]
  readonly max: number
  readonly hasPassword: boolean
  /** 더하기 · 대표로 · 빼기에 재인증이 필요한가 — 10분 안에 로그인한 세션이 아니다(비밀번호가 있으면 지금 비밀번호로 · 없으면 다시 로그인). */
  readonly reauthRequired: boolean
}

export type EmailFailure =
  /** 로그인 세션이 아니다 — 위임 · API 토큰(세션에 매인 명령 · API-1 ②). */
  | 'session_required'
  | 'invalid_email'
  /** 10분 안에 로그인한 세션이 아니고 지금 비밀번호가 오지 않았다(비밀번호가 없으면 다시 로그인해야 한다). */
  | 'reauth_required'
  | 'wrong_password'
  /** 이미 이 계정의 주소다. */
  | 'already_yours'
  /** 주소가 다섯이다. */
  | 'limit_reached'
  | 'rate_limited'
  /** 코드가 맞지 않거나 대기가 없다. */
  | 'invalid'
  | 'expired'
  | 'too_many_attempts'
  /** 코드를 맞혔지만 그새 다른 계정이 그 주소를 가졌다(코드를 가진 사람 = 그 메일함의 주인에게만 보인다). */
  | 'unavailable'
  | 'not_found'
  /** 대표 주소는 빼지 못한다 — 먼저 다른 주소를 대표로. */
  | 'primary_locked'
  | 'already_primary'

export type EmailResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: EmailFailure }

const fail = (reason: EmailFailure) => ({ ok: false, reason }) as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 주소 모양만 본다(로그인 코드의 입구와 같은 정도 — 지나친 정규식은 정상 주소를 막는다). 맞지 않으면 null. */
export function normalizeAccountEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim()
  if (email.length < 3 || email.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

// ── 재인증 ─────────────────────────────────────────────────────────────

/** 최근 재인증의 문 — 통과하면 null(정본 ⑦). 10분 안에 로그인한 세션이면 묻지 않고, 아니면 지금 비밀번호(있을 때만)를 본다. */
async function reauthFailure(tx: Tx, ctx: SessionContext, currentPassword: unknown): Promise<EmailFailure | null> {
  const session = await tx.queryMaybe<{ fresh: boolean }>(
    `SELECT created_at > now() - make_interval(mins => $2) AS fresh FROM user_session WHERE id = $1 AND user_id = $3`,
    [ctx.sessionId, EMAIL_REAUTH_MINUTES, ctx.userId],
  )
  if (session?.fresh === true) return null
  const stored = await tx.queryMaybe<{ password_hash: string }>(
    `SELECT password_hash FROM credential WHERE user_id = $1 AND kind = 'password'`,
    [ctx.userId],
  )
  if (stored === null || typeof currentPassword !== 'string' || currentPassword.length === 0) return 'reauth_required'
  const attempt = await consume('email_reauth_pw', ctx.userId, EMAIL_REAUTH_PASSWORD_PER_USER)
  if (!attempt.allowed) return 'rate_limited'
  return (await verifyPassword(currentPassword, stored.password_hash)) ? null : 'wrong_password'
}

async function isFreshSession(tx: Tx, ctx: SessionContext): Promise<boolean> {
  const row = await tx.queryMaybe<{ fresh: boolean }>(
    `SELECT created_at > now() - make_interval(mins => $2) AS fresh FROM user_session WHERE id = $1`,
    [ctx.sessionId, EMAIL_REAUTH_MINUTES],
  )
  return row?.fresh === true
}

const recordChange = async (tx: Tx, ctx: SessionContext, kind: 'email_added' | 'email_removed' | 'email_primary_changed', email: string, meta: object = {}) => {
  await tx.query(`INSERT INTO auth_event (at, email, user_id, kind, meta) VALUES (now(), $1, $2, $3, $4)`, [
    email,
    ctx.userId,
    kind,
    JSON.stringify({ session_id: ctx.sessionId, ...meta }),
  ])
  // 감사 로그(F-11-12 · 계정 범위) — 주소는 싣지 않는다(정본 ⑩)
  await recordAuditIn(tx, { type: 'account.security_changed', workspaceId: null, actorUserId: ctx.userId, sessionId: ctx.sessionId, metadata: { change: kind } })
}

const primaryOf = async (tx: Tx, userId: string): Promise<{ id: string; email: string } | null> =>
  tx.queryMaybe<{ id: string; email: string }>(
    `SELECT e.id, e.email::text AS email FROM "user" u JOIN user_email e ON e.id = u.primary_email_id WHERE u.id = $1`,
    [userId],
  )

// ── 읽기 ───────────────────────────────────────────────────────────────

/** 설정 화면이 그리는 상태 — 주소(대표 먼저) · 확인 대기 · 재인증이 필요한가. */
export async function emailsStatus(ctx: SessionContext): Promise<EmailsStatus> {
  return withReadTransaction(async (tx) => {
    const emails = await tx.query<{ id: string; email: string; is_primary: boolean }>(
      `SELECT id, email::text AS email, is_primary FROM user_email WHERE user_id = $1 ORDER BY is_primary DESC, added_at, email`,
      [ctx.userId],
    )
    // 다른 계정의 주소로 요청해도 대기는 똑같이 선다 — 목록이 "이미 쓰인 주소"를 알리지 않는다(③)
    const pending = await tx.query<{ email: string; expires_at: Date }>(
      `SELECT DISTINCT ON (c.email) c.email::text AS email, c.expires_at
         FROM otp_challenge c
        WHERE c.purpose = 'email_verify' AND c.user_id = $1 AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < $2
          AND NOT EXISTS (SELECT 1 FROM user_email e WHERE e.user_id = $1 AND e.email = c.email)
        ORDER BY c.email, c.created_at DESC`,
      [ctx.userId, LOGIN_CODE_MAX_ATTEMPTS],
    )
    const hasPassword = (await tx.queryMaybe(`SELECT 1 FROM credential WHERE user_id = $1 AND kind = 'password'`, [ctx.userId])) !== null
    return {
      emails: emails.map((row) => ({ id: row.id, email: row.email, isPrimary: row.is_primary })),
      pending: pending.map((row) => ({ email: row.email, expiresAt: row.expires_at.toISOString() })),
      max: MAX_EMAILS_PER_ACCOUNT,
      hasPassword,
      reauthRequired: !(await isFreshSession(tx, ctx)),
    }
  })
}

// ── 더하기 1 — 코드 요청 ───────────────────────────────────────────────

/**
 * 이 주소로 확인 코드를 보낸다(정본 ③). 다른 계정의 주소이면 응답 · 대기 행은 같고 코드 대신 그 주소로 안내가 간다.
 * `devCode` 는 개발 transport 에서만 — **HTTP 응답에 넣지 않는다**(다른 계정의 주소면 없으므로 응답이 갈라진다).
 */
export async function requestEmailVerification(
  ctx: SessionContext,
  input: { readonly email: unknown; readonly currentPassword?: unknown },
  request: RequestContext,
): Promise<EmailResult<{ readonly devCode?: string }>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  const email = normalizeAccountEmail(input.email)
  if (email === null) return fail('invalid_email')

  // 사람마다의 상한이 먼저다 — 재인증의 비밀번호 확인 · 주소 맞혀 보기 모두 이 안에서 센다
  const byUser = await consume('email_verify_user', ctx.userId, EMAIL_VERIFY_PER_USER)
  if (!byUser.allowed) return fail('rate_limited')

  const gate = await withReadTransaction(async (tx) => {
    const denied = await reauthFailure(tx, ctx, input.currentPassword)
    if (denied !== null) return { denied } as const
    const owner = await tx.queryMaybe<{ user_id: string }>(`SELECT user_id FROM user_email WHERE email = $1`, [email])
    if (owner?.user_id === ctx.userId) return { denied: 'already_yours' } as const
    const count = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM user_email WHERE user_id = $1`, [ctx.userId])
    if (count.n >= MAX_EMAILS_PER_ACCOUNT) return { denied: 'limit_reached' } as const
    return { denied: null, taken: owner !== null } as const
  })
  if (gate.denied !== null) return fail(gate.denied)

  const byTarget = await consume('email_verify_target', email.toLowerCase(), CODE_REQUEST_PER_EMAIL)
  if (!byTarget.allowed) return fail('rate_limited')

  // 코드는 늘 만든다 — 다른 계정의 주소여도 대기 행이 똑같이 선다(보내지 않을 뿐 · 그 코드는 아무도 모른다)
  const code = generateOtpCode()
  const challengeId = await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE otp_challenge SET consumed_at = now()
        WHERE purpose = 'email_verify' AND user_id = $1 AND email = $2 AND consumed_at IS NULL`,
      [ctx.userId, email],
    )
    const id = randomUUID()
    await tx.query(
      `INSERT INTO otp_challenge (id, purpose, email, user_id, code_hash, expires_at, request_ip, request_ua, created_at)
       VALUES ($1, 'email_verify', $2, $3, $4, now() + make_interval(secs => $5), $6, $7, now())`,
      [id, email, ctx.userId, hashOtpCode(code, id), LOGIN_CODE_TTL_SECONDS, request.ip, request.userAgent],
    )
    return id
  })
  await recordAuthEvent('email_verify_requested', { email, userId: ctx.userId, ctx: request, meta: { taken: gate.taken, session_id: ctx.sessionId } })

  if (gate.taken) {
    await sendAccountNotice({ to: email, kind: 'email_taken', address: email })
    return { ok: true, value: {} }
  }
  const devCode = await sendEmailVerifyCode({ to: email, code, challengeId })
  return { ok: true, value: devCode === undefined ? {} : { devCode } }
}

// ── 더하기 2 — 코드 확인 ───────────────────────────────────────────────

/**
 * 코드를 맞히면 그 주소가 이 계정의 별칭이 된다(대표 아님). 대기는 **이 계정이 낸 것만** 맞힌다. 틀린 횟수는 남는다(거부해도 쓴다 —
 * 로그인 코드와 같다). 맞힌 뒤 다섯이 찼거나 그새 다른 계정이 가졌으면 쓰지 않는다.
 */
export async function verifyEmail(
  ctx: SessionContext,
  input: { readonly email: unknown; readonly code: unknown },
  request: RequestContext,
): Promise<EmailResult<AccountEmail>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  const email = normalizeAccountEmail(input.email)
  if (email === null) return fail('invalid_email')
  const code = typeof input.code === 'string' ? input.code.trim() : ''

  const challenge = await queryMaybe<{ id: string; code_hash: string; attempts: number; is_expired: boolean }>(
    `SELECT id, code_hash, attempts, (expires_at <= now()) AS is_expired
       FROM otp_challenge
      WHERE purpose = 'email_verify' AND user_id = $1 AND email = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [ctx.userId, email],
  )
  if (challenge === null) return fail('invalid')
  if (challenge.is_expired) return fail('expired')
  if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    await queryMaybe(`UPDATE otp_challenge SET consumed_at = now() WHERE id = $1 RETURNING id`, [challenge.id])
    return fail('too_many_attempts')
  }
  if (!/^\d{6}$/.test(code) || !otpCodeMatches(code, challenge.id, challenge.code_hash)) {
    const after = await queryMaybe<{ attempts: number }>(
      `UPDATE otp_challenge SET attempts = attempts + 1,
              consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
        WHERE id = $1 RETURNING attempts`,
      [challenge.id, LOGIN_CODE_MAX_ATTEMPTS],
    )
    await recordAuthEvent('email_verify_failed', { email, userId: ctx.userId, ctx: request, meta: { attempts: after?.attempts ?? null } })
    return fail((after?.attempts ?? LOGIN_CODE_MAX_ATTEMPTS) >= LOGIN_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid')
  }
  // 원자적 소비 — 같은 코드로 두 번 더하지 않는다
  const consumed = await queryMaybe(`UPDATE otp_challenge SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [challenge.id])
  if (consumed === null) return fail('invalid')

  const added = await withCommandTransaction(async (tx): Promise<EmailResult<AccountEmail>> => {
    await tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE`, [ctx.userId])
    const owner = await tx.queryMaybe<{ user_id: string }>(`SELECT user_id FROM user_email WHERE email = $1`, [email])
    if (owner?.user_id === ctx.userId) return fail('already_yours')
    if (owner !== null) return fail('unavailable')
    const count = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM user_email WHERE user_id = $1`, [ctx.userId])
    if (count.n >= MAX_EMAILS_PER_ACCOUNT) return fail('limit_reached')
    // 다른 트랜잭션이 그새 같은 주소를 넣었으면 전역 UNIQUE 가 막는다 — 오류 대신 "없음"으로 받는다
    const row = await tx.queryMaybe<{ id: string }>(
      `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
       VALUES ($1, $2, $3, now(), false, now())
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [randomUUID(), ctx.userId, email],
    )
    if (row === null) return fail('unavailable')
    await recordChange(tx, ctx, 'email_added', email)
    return { ok: true, value: { id: row.id, email, isPrimary: false } }
  })
  if (!added.ok) return added

  const primary = await queryMaybe<{ email: string }>(
    `SELECT e.email::text AS email FROM "user" u JOIN user_email e ON e.id = u.primary_email_id WHERE u.id = $1`,
    [ctx.userId],
  )
  if (primary !== null) await sendAccountNotice({ to: primary.email, kind: 'email_added', address: email })
  return added
}

// ── 대표로 · 빼기 ──────────────────────────────────────────────────────

/** 자기 별칭 하나를 대표로(정본 ⑥). 옛 대표를 먼저 내린다 · 알림은 **옛 대표 주소로**(⑧). */
export async function makePrimaryEmail(
  ctx: SessionContext,
  input: { readonly emailId: unknown; readonly currentPassword?: unknown },
): Promise<EmailResult<AccountEmail>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  if (typeof input.emailId !== 'string' || !UUID.test(input.emailId)) return fail('not_found')
  const emailId = input.emailId

  // 커밋한 뒤에 보낼 알림 — 트랜잭션 안에서 정한다(그릇이라 TS 가 null 로 좁히지 않는다)
  const after: { notice: AccountNotice | null } = { notice: null }
  const result = await withCommandTransaction(async (tx): Promise<EmailResult<AccountEmail>> => {
    await tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE`, [ctx.userId])
    const target = await tx.queryMaybe<{ email: string; is_primary: boolean }>(
      `SELECT email::text AS email, is_primary FROM user_email WHERE id = $1 AND user_id = $2`,
      [emailId, ctx.userId],
    )
    if (target === null) return fail('not_found')
    if (target.is_primary) return fail('already_primary')
    const denied = await reauthFailure(tx, ctx, input.currentPassword)
    if (denied !== null) return fail(denied)
    const old = await primaryOf(tx, ctx.userId)
    // 부분 UNIQUE(ux_user_primary_email)를 지나도록 옛 대표를 먼저 내린다
    await tx.query(`UPDATE user_email SET is_primary = false WHERE user_id = $1 AND is_primary`, [ctx.userId])
    await tx.query(`UPDATE user_email SET is_primary = true WHERE id = $1`, [emailId])
    await tx.query(`UPDATE "user" SET primary_email_id = $2 WHERE id = $1`, [ctx.userId, emailId])
    await recordChange(tx, ctx, 'email_primary_changed', target.email, { previous_email_id: old?.id ?? null })
    if (old !== null) after.notice = { to: old.email, kind: 'email_primary_changed', address: target.email }
    return { ok: true, value: { id: emailId, email: target.email, isPrimary: true } }
  })
  if (result.ok && after.notice !== null) await sendAccountNotice(after.notice)
  return result
}

/** 자기 별칭 하나를 뺀다(정본 ⑥ ⑨) — 대표는 못 뺀다 · 이 세션을 뺀 세션을 폐기한다 · 대표 주소로 알린다. */
export async function removeEmail(
  ctx: SessionContext,
  input: { readonly emailId: unknown; readonly currentPassword?: unknown },
): Promise<EmailResult<{ readonly revokedSessions: number }>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  if (typeof input.emailId !== 'string' || !UUID.test(input.emailId)) return fail('not_found')
  const emailId = input.emailId

  const after: { notice: AccountNotice | null } = { notice: null }
  const result = await withCommandTransaction(async (tx): Promise<EmailResult<{ readonly revokedSessions: number }>> => {
    await tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE`, [ctx.userId])
    const target = await tx.queryMaybe<{ email: string; is_primary: boolean }>(
      `SELECT email::text AS email, is_primary FROM user_email WHERE id = $1 AND user_id = $2`,
      [emailId, ctx.userId],
    )
    if (target === null) return fail('not_found')
    if (target.is_primary) return fail('primary_locked')
    const denied = await reauthFailure(tx, ctx, input.currentPassword)
    if (denied !== null) return fail(denied)
    await tx.query(`DELETE FROM user_email WHERE id = $1 AND user_id = $2`, [emailId, ctx.userId])
    const revoked = await tx.query<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'email_removed'
        WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
        RETURNING id`,
      [ctx.userId, ctx.sessionId],
    )
    await recordChange(tx, ctx, 'email_removed', target.email, { revoked_sessions: revoked.length })
    const primary = await primaryOf(tx, ctx.userId)
    if (primary !== null) after.notice = { to: primary.email, kind: 'email_removed', address: target.email }
    return { ok: true, value: { revokedSessions: revoked.length } }
  })
  if (result.ok && after.notice !== null) await sendAccountNotice(after.notice)
  return result
}
