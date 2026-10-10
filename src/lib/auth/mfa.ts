/**
 * 2단계 인증 — 등록 · 확정 · 끄기 · 백업 코드 · 로그인의 둘째 단계 (잔여 묶음 8i-2a · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 `mfa_method` · `mfa_backup_code` · 불변식 A7 · [보강] 2단계 인증 ① ~ ⑥
 *       14-auth-accounts.md F-14-05
 *
 * 2단계 인증의 표(`mfa_method` · `mfa_backup_code`)를 쓰는 곳은 이 파일 하나다. 켜져 있는가 = 확정된(`confirmed_at`) TOTP 줄이 있는가.
 *
 *   · 켜려면 비밀번호가 있어야 한다 · TOTP 는 둘까지(A7)
 *   · 등록은 두 걸음 — 시작(봉인한 비밀값 · QR 주소를 한 번 보인다) → 앱의 코드로 확정. 30분 안에 확정하지 않은 줄은 없는 것이다
 *   · 처음으로 확정하는 순간 백업 코드 6개가 생기고 그 한 번만 보인다 · 그 세션은 둘째 단계를 통과한 것이 된다
 *   · 끄기 · 백업 코드 새로 받기는 지금 코드(어느 수단의 TOTP 또는 백업 코드)로 · 마지막 수단을 지우면 백업 코드도 지운다
 *   · 로그인의 둘째 단계(`verifySecondFactor`)는 세션 토큰으로 — 그 세션은 진입 게이트에서 막혀 있으므로 SessionContext 가 없다
 *   · TOTP 는 쓴 창과 그 앞을 다시 받지 않는다 — 수단의 `last_used_at` 을 그 창의 시작 시각으로 적어 둔다
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from './session-context.ts'
import { recordAuditIn } from '../audit/audit.ts'
import { hashSessionToken } from './session-context.ts'
import { queryMaybe } from '../db/pool.ts'
import { withCommandTransaction, withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { sealTotpSecret, unsealTotpSecret } from './mfa-seal.ts'
import {
  TOTP_PERIOD_SECONDS,
  base32Encode,
  hashBackupCode,
  matchTotp,
  newBackupCodes,
  newTotpSecret,
  normalizeBackupCode,
  otpauthUri,
} from './totp.ts'

/** A7 — TOTP 수단은 사람마다 둘까지. */
export const MAX_TOTP_METHODS = 2
/** 이 시간 안에 확정하지 않은 등록은 없는 것으로 본다. */
export const ENROLLMENT_TTL_MINUTES = 30
/** 노션과 같은 수(14 F-14-05 *"최초 설정 시 백업 코드 6개"*). */
export const BACKUP_CODE_COUNT = 6
/** 둘째 단계의 실패 — 마지막 성공 이후 15분에 10번이면 막는다. */
export const MFA_FAILURE_LIMIT = 10
export const MFA_FAILURE_WINDOW_MINUTES = 15

export type MfaMethodSummary = {
  readonly id: string
  readonly label: string
  readonly createdAt: string
  readonly lastUsedAt: string | null
}

export type MfaStatus = {
  readonly enabled: boolean
  readonly methods: readonly MfaMethodSummary[]
  /** 아직 쓰지 않은 백업 코드 수. */
  readonly backupCodesLeft: number
  /** 켜려면 비밀번호가 있어야 한다. */
  readonly hasPassword: boolean
}

export type MfaFailure =
  /** 비밀번호가 없다 — 먼저 정해야 한다. */
  | 'password_required'
  /** TOTP 가 이미 둘이다(A7). */
  | 'too_many_methods'
  /** 그런 수단 · 등록이 없다(또는 남의 것 · 30분이 지났다 · 2단계 인증이 꺼져 있다). */
  | 'not_found'
  /** 코드가 맞지 않는다. */
  | 'invalid_code'
  /** 이름이 비었거나 길다. */
  | 'invalid_label'

export type MfaResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: MfaFailure }

const fail = (reason: MfaFailure) => ({ ok: false, reason }) as const

type MethodRow = { id: string; totp_secret: Buffer; last_step: number | null }

/** 확정된 TOTP 수단 — 비밀값과 마지막으로 쓴 창. */
async function confirmedMethods(tx: Tx, userId: string): Promise<MethodRow[]> {
  return tx.query<MethodRow>(
    `SELECT id, totp_secret,
            floor(extract(epoch FROM last_used_at) / ${TOTP_PERIOD_SECONDS})::bigint::int AS last_step
       FROM mfa_method
      WHERE user_id = $1 AND kind = 'totp' AND confirmed_at IS NOT NULL
      ORDER BY created_at, id`,
    [userId],
  )
}

/** 이 TOTP 코드가 맞은 창을 그 수단에 적는다 — 그 창과 앞의 창은 다시 받지 않는다. */
const markStep = (tx: Tx, methodId: string, step: number) =>
  tx.query(`UPDATE mfa_method SET last_used_at = to_timestamp($2::bigint * ${TOTP_PERIOD_SECONDS}) WHERE id = $1`, [methodId, step])

/**
 * 이 사람의 지금 코드인가 — 확정된 수단의 TOTP(쓴 창 이후만) 또는 쓰지 않은 백업 코드. 맞으면 그 사실을 적는다(창 · `used_at`).
 * 무엇으로 맞았는지 준다(감사 이벤트에 남긴다).
 */
async function consumeCode(tx: Tx, userId: string, code: unknown): Promise<'totp' | 'backup' | null> {
  const now = Date.now()
  for (const method of await confirmedMethods(tx, userId)) {
    const secret = unsealTotpSecret(method.totp_secret)
    if (secret === null) continue
    const step = matchTotp(secret, code, now, method.last_step)
    if (step !== null) {
      await markStep(tx, method.id, step)
      return 'totp'
    }
  }
  const backup = normalizeBackupCode(code)
  if (backup === null) return null
  const used = await tx.query<{ code_hash: string }>(
    `UPDATE mfa_backup_code SET used_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
      RETURNING code_hash`,
    [userId, hashBackupCode(backup)],
  )
  return used.length > 0 ? 'backup' : null
}

/** 새 백업 코드 묶음 — 옛 것은 지운다. 평문은 이 한 번만 돌려준다. */
async function replaceBackupCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = newBackupCodes(BACKUP_CODE_COUNT)
  const batch = randomUUID()
  await tx.query(`DELETE FROM mfa_backup_code WHERE user_id = $1`, [userId])
  await tx.query(
    `INSERT INTO mfa_backup_code (user_id, code_hash, batch_id) SELECT $1, h, $2 FROM unnest($3::text[]) AS h`,
    [userId, batch, codes.map((c) => hashBackupCode(normalizeBackupCode(c)!))],
  )
  return codes
}

/** 감사 로그(F-11-12 · 계정 범위 — 6d-1) — 2단계 인증의 설정 · 해제 · 백업 코드. */
const auditSecurity = (tx: Tx, ctx: SessionContext, change: string) =>
  recordAuditIn(tx, { type: 'account.security_changed', workspaceId: null, actorUserId: ctx.userId, sessionId: ctx.sessionId, metadata: { change } })

const recordEvent = (tx: Tx, userId: string, kind: string, meta: Record<string, unknown> = {}) =>
  tx.query(`INSERT INTO auth_event (at, user_id, kind, meta) VALUES (now(), $1, $2, $3)`, [userId, kind, JSON.stringify(meta)])

const lockUser = (tx: Tx, userId: string) => tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE`, [userId])

/** 설정 화면이 그리는 상태. */
export async function mfaStatus(ctx: SessionContext): Promise<MfaStatus> {
  return withReadTransaction(async (tx) => {
    const methods = await tx.query<{ id: string; label: string; created_at: Date; last_used_at: Date | null }>(
      `SELECT id, label, created_at, last_used_at FROM mfa_method
        WHERE user_id = $1 AND kind = 'totp' AND confirmed_at IS NOT NULL ORDER BY created_at, id`,
      [ctx.userId],
    )
    const left = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM mfa_backup_code WHERE user_id = $1 AND used_at IS NULL`,
      [ctx.userId],
    )
    const password = await tx.queryMaybe(`SELECT 1 FROM credential WHERE user_id = $1 AND kind = 'password'`, [ctx.userId])
    return {
      enabled: methods.length > 0,
      methods: methods.map((m) => ({
        id: m.id,
        label: m.label,
        createdAt: m.created_at.toISOString(),
        lastUsedAt: m.last_used_at?.toISOString() ?? null,
      })),
      backupCodesLeft: left.n,
      hasPassword: password !== null,
    }
  })
}

/** 인증 앱 이름 — 앞뒤 공백을 떼고 1~40자. 없으면 "인증 앱". */
function normalizeLabel(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '인증 앱'
  if (typeof raw !== 'string') return null
  const label = raw.trim().replace(/\s+/g, ' ')
  return label.length === 0 || label.length > 40 ? null : label
}

/** 등록을 시작한다 — 확정되지 않은 줄 하나와 봉인한 비밀값. QR 주소 · base32 비밀값은 이 응답에서 한 번만 보인다. */
export async function startTotpEnrollment(
  ctx: SessionContext,
  input: { readonly label?: unknown },
): Promise<MfaResult<{ readonly methodId: string; readonly secret: string; readonly uri: string }>> {
  const label = normalizeLabel(input.label)
  if (label === null) return fail('invalid_label')
  return withCommandTransaction(async (tx) => {
    await lockUser(tx, ctx.userId)
    const password = await tx.queryMaybe(`SELECT 1 FROM credential WHERE user_id = $1 AND kind = 'password'`, [ctx.userId])
    if (password === null) return fail('password_required')
    if ((await confirmedMethods(tx, ctx.userId)).length >= MAX_TOTP_METHODS) return fail('too_many_methods')
    // 오래된 미확정 등록은 치운다 — 이미 없는 것으로 보지만 쌓이지 않게.
    await tx.query(
      `DELETE FROM mfa_method WHERE user_id = $1 AND confirmed_at IS NULL AND created_at <= now() - make_interval(mins => $2)`,
      [ctx.userId, ENROLLMENT_TTL_MINUTES],
    )
    const email = await tx.queryMaybe<{ email: string }>(
      `SELECT e.email::text AS email FROM "user" u JOIN user_email e ON e.id = u.primary_email_id WHERE u.id = $1`,
      [ctx.userId],
    )
    const secret = newTotpSecret()
    const methodId = randomUUID()
    await tx.query(
      `INSERT INTO mfa_method (id, user_id, kind, label, totp_secret, created_at) VALUES ($1, $2, 'totp', $3, $4, now())`,
      [methodId, ctx.userId, label, sealTotpSecret(secret)],
    )
    return {
      ok: true,
      value: { methodId, secret: base32Encode(secret), uri: otpauthUri(secret, email?.email ?? ctx.userId) },
    } as const
  })
}

/**
 * 등록을 확정한다 — 그 수단의 지금 코드로. 처음으로 켜는 것이면 백업 코드 6개를 만들어 돌려준다(아니면 null). 이 세션은 둘째 단계를
 * 통과한 것이 된다(소유를 방금 증명했다).
 */
export async function confirmTotpEnrollment(
  ctx: SessionContext,
  methodId: string,
  code: unknown,
): Promise<MfaResult<{ readonly backupCodes: readonly string[] | null }>> {
  return withCommandTransaction(async (tx) => {
    await lockUser(tx, ctx.userId)
    const pending = await tx.queryMaybe<{ totp_secret: Buffer }>(
      `SELECT totp_secret FROM mfa_method
        WHERE id = $1 AND user_id = $2 AND kind = 'totp' AND confirmed_at IS NULL
          AND created_at > now() - make_interval(mins => $3)`,
      [methodId, ctx.userId, ENROLLMENT_TTL_MINUTES],
    )
    if (pending === null) return fail('not_found')
    const before = await confirmedMethods(tx, ctx.userId)
    if (before.length >= MAX_TOTP_METHODS) return fail('too_many_methods')
    const secret = unsealTotpSecret(pending.totp_secret)
    const step = secret === null ? null : matchTotp(secret, code, Date.now(), null)
    if (step === null) return fail('invalid_code')

    await tx.query(`UPDATE mfa_method SET confirmed_at = now() WHERE id = $1`, [methodId])
    await markStep(tx, methodId, step)
    await tx.query(`UPDATE user_session SET mfa_satisfied = true WHERE id = $1`, [ctx.sessionId])
    const backupCodes = before.length === 0 ? await replaceBackupCodes(tx, ctx.userId) : null
    await recordEvent(tx, ctx.userId, before.length === 0 ? 'mfa_enabled' : 'mfa_method_added', { method_id: methodId })
    await auditSecurity(tx, ctx, before.length === 0 ? 'mfa_enabled' : 'mfa_method_added')
    return { ok: true, value: { backupCodes } } as const
  })
}

/** 수단 하나를 지운다 — 지금 코드로. 마지막 수단이면 백업 코드도 지운다(2단계 인증이 꺼진다). */
export async function removeMfaMethod(
  ctx: SessionContext,
  methodId: string,
  code: unknown,
): Promise<MfaResult<{ readonly disabled: boolean }>> {
  return withCommandTransaction(async (tx) => {
    await lockUser(tx, ctx.userId)
    const methods = await confirmedMethods(tx, ctx.userId)
    if (!methods.some((m) => m.id === methodId)) return fail('not_found')
    if ((await consumeCode(tx, ctx.userId, code)) === null) return fail('invalid_code')
    await tx.query(`DELETE FROM mfa_method WHERE id = $1 AND user_id = $2`, [methodId, ctx.userId])
    const disabled = methods.length === 1
    if (disabled) await tx.query(`DELETE FROM mfa_backup_code WHERE user_id = $1`, [ctx.userId])
    await recordEvent(tx, ctx.userId, disabled ? 'mfa_disabled' : 'mfa_method_removed', { method_id: methodId })
    await auditSecurity(tx, ctx, disabled ? 'mfa_disabled' : 'mfa_method_removed')
    return { ok: true, value: { disabled } } as const
  })
}

/** 백업 코드를 새로 받는다 — 지금 코드로. 옛 묶음은 지운다. */
export async function regenerateBackupCodes(ctx: SessionContext, code: unknown): Promise<MfaResult<{ readonly backupCodes: readonly string[] }>> {
  return withCommandTransaction(async (tx) => {
    await lockUser(tx, ctx.userId)
    if ((await confirmedMethods(tx, ctx.userId)).length === 0) return fail('not_found')
    if ((await consumeCode(tx, ctx.userId, code)) === null) return fail('invalid_code')
    const backupCodes = await replaceBackupCodes(tx, ctx.userId)
    await recordEvent(tx, ctx.userId, 'mfa_backup_codes_regenerated')
    await auditSecurity(tx, ctx, 'mfa_backup_codes_regenerated')
    return { ok: true, value: { backupCodes } } as const
  })
}

export type SecondFactorResult =
  | { readonly ok: true; readonly value: { readonly via: 'totp' | 'backup' | 'already' } }
  | { readonly ok: false; readonly reason: 'no_session' | 'invalid_code' | 'too_many_attempts' }

/**
 * 로그인의 둘째 단계 — 첫 단계(코드 · 비밀번호)로 받은 세션의 토큰과 코드 하나. 맞으면 그 세션의 `mfa_satisfied` 를 켠다. 이미 켜져
 * 있거나 2단계 인증이 꺼진 사람이면 할 일이 없다(`already`). 실패는 `auth_event('mfa_failed')` 로 남고, 마지막 성공 이후 15분에
 * 10번이면 막는다.
 */
export async function verifySecondFactor(input: {
  readonly token: string | null | undefined
  readonly code: unknown
  readonly ip: string | null
  readonly userAgent: string | null
}): Promise<SecondFactorResult> {
  const token = input.token
  if (!token) return { ok: false, reason: 'no_session' }
  return withTransaction(async (tx) => {
    const session = await tx.queryMaybe<{ id: string; user_id: string; mfa_satisfied: boolean }>(
      `SELECT id, user_id, mfa_satisfied FROM user_session
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [hashSessionToken(token)],
    )
    if (session === null) return { ok: false, reason: 'no_session' } as const
    await lockUser(tx, session.user_id)
    if (session.mfa_satisfied || (await confirmedMethods(tx, session.user_id)).length === 0) {
      return { ok: true, value: { via: 'already' } } as const
    }
    const failures = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_event
        WHERE user_id = $1 AND kind = 'mfa_failed' AND at > now() - make_interval(mins => $2)
          AND at > coalesce((SELECT max(at) FROM auth_event WHERE user_id = $1 AND kind = 'mfa_succeeded'), '-infinity')`,
      [session.user_id, MFA_FAILURE_WINDOW_MINUTES],
    )
    if (failures.n >= MFA_FAILURE_LIMIT) return { ok: false, reason: 'too_many_attempts' } as const

    const via = await consumeCode(tx, session.user_id, input.code)
    if (via === null) {
      // 실패는 남아야 한다 — 이 트랜잭션은 거부해도 커밋한다(`withTransaction`).
      await tx.query(`INSERT INTO auth_event (at, user_id, kind, ip, user_agent) VALUES (now(), $1, 'mfa_failed', $2, $3)`, [
        session.user_id,
        input.ip,
        input.userAgent,
      ])
      return { ok: false, reason: 'invalid_code' } as const
    }
    await tx.query(`UPDATE user_session SET mfa_satisfied = true WHERE id = $1`, [session.id])
    await tx.query(`INSERT INTO auth_event (at, user_id, kind, ip, user_agent, meta) VALUES (now(), $1, 'mfa_succeeded', $2, $3, $4)`, [
      session.user_id,
      input.ip,
      input.userAgent,
      JSON.stringify({ via, session_id: session.id }),
    ])
    return { ok: true, value: { via } } as const
  })
}

/** 이 사람이 2단계 인증을 켰는가 — 첫 단계의 응답이 "둘째 단계가 필요하다"를 말하는 데 쓴다. */
export async function mfaEnabledFor(userId: string): Promise<boolean> {
  const row = await queryMaybe(`SELECT 1 FROM mfa_method WHERE user_id = $1 AND confirmed_at IS NOT NULL LIMIT 1`, [userId])
  return row !== null
}
