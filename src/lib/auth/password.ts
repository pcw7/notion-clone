/**
 * 비밀번호 — 정하기 · 바꾸기 · 지우기 · 로그인 (잔여 묶음 8i-1a · F-14-03)
 *
 * 정본: 00-canonical-data-model.md §3.2 `credential` · 불변식 A5 · [보강] 비밀번호 ③ ~ ⑥
 *       14-auth-accounts.md F-14-03 *"선택적으로 붙일 수 있는 영구 자격증명. 없는 것이 기본 상태이며, 설정 후에도 제거할 수 있다"*
 *
 * 비밀번호는 `credential(kind='password')` 한 줄이다(0~1 — `ux_credential_one_password`). 이 모듈이 그 줄을 쓰는 유일한 곳이다.
 *
 *   · 정하기 — 비밀번호가 없을 때. 지금 비밀번호를 묻지 않는다
 *   · 바꾸기 · 지우기 — **지금 비밀번호를 묻는다.** 단 10분 안에 로그인 코드로 들어온 세션은 묻지 않는다(그것이 재설정이다 — 정본 ⑥)
 *   · 바꾸면 이 세션을 뺀 모든 세션을 폐기한다(`password_change`) — 탈취된 세션이 살아남지 않게(14 의 엣지 케이스)
 *   · 2단계 인증이 켜져 있으면 지우지 못한다(14 *"2FA 는 비밀번호를 전제로 한다"* — 8i-2)
 *   · 로그인 — 실패는 모두 같은 말이고 같은 시간이다(없는 이메일 · 비밀번호 없는 계정 · 틀린 비밀번호). 15분에 10번 틀린 이메일은 맞아도 막는다
 *
 * 해시는 트랜잭션 밖에서 만든다(argon2 가 수십 ms 를 쓴다 — 그동안 사용자 행 잠금을 쥐지 않게). 검증은 잠금 안에서 한다(바뀌는 중인 값으로
 * 묻지 않게).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from './session-context.ts'
import { query, queryMaybe } from '../db/pool.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isAcceptablePassword } from './password-policy.ts'
import { decoyHash, hashPassword, needsRehash, verifyPassword } from './password-hash.ts'

/** 이 시간 안에 로그인 코드로 들어온 세션은 지금 비밀번호 없이 바꾼다 — 재설정(정본 ⑥). */
export const FRESH_CODE_SESSION_MINUTES = 10
/** 이 창 안에 이만큼 틀린 이메일은 맞아도 막는다(정본 ⑤). 마지막 성공 이후만 센다. */
export const PASSWORD_FAILURE_LIMIT = 10
export const PASSWORD_FAILURE_WINDOW_MINUTES = 15

export type PasswordStatus = {
  readonly hasPassword: boolean
  /** 바꾸기 · 지우기에 지금 비밀번호가 필요한가 — 비밀번호가 있고 이 세션이 10분 안의 코드 세션이 아닐 때. */
  readonly currentRequired: boolean
}

export type PasswordFailure =
  /** 정책을 지키지 않는다(`password-policy.ts`). */
  | 'weak_password'
  /** 지금 비밀번호가 필요한데 오지 않았다. */
  | 'current_required'
  /** 지금 비밀번호가 틀렸다. */
  | 'wrong_password'
  /** 지울 비밀번호가 없다. */
  | 'no_password'
  /** 2단계 인증이 켜져 있어 지울 수 없다(8i-2). */
  | 'mfa_enabled'

export type PasswordResult<T = { readonly revokedSessions: number }> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: PasswordFailure }

const fail = (reason: PasswordFailure) => ({ ok: false, reason }) as const

async function storedHash(tx: Tx, userId: string): Promise<string | null> {
  const row = await tx.queryMaybe<{ password_hash: string }>(
    `SELECT password_hash FROM credential WHERE user_id = $1 AND kind = 'password'`,
    [userId],
  )
  return row?.password_hash ?? null
}

/** 이 세션이 10분 안에 로그인 코드로 들어온 세션인가 — 그러면 이메일 소유를 방금 증명했다. */
async function isFreshCodeSession(tx: Tx, ctx: SessionContext): Promise<boolean> {
  if (ctx.authMethod !== 'login_code') return false
  const row = await tx.queryMaybe<{ fresh: boolean }>(
    `SELECT created_at > now() - make_interval(mins => $2) AS fresh FROM user_session WHERE id = $1`,
    [ctx.sessionId, FRESH_CODE_SESSION_MINUTES],
  )
  return row?.fresh === true
}

/** 바꾸기 · 지우기의 문 — 통과하면 null. */
async function checkCurrent(tx: Tx, ctx: SessionContext, stored: string, current: unknown): Promise<PasswordFailure | null> {
  if (await isFreshCodeSession(tx, ctx)) return null
  if (typeof current !== 'string' || current.length === 0) return 'current_required'
  return (await verifyPassword(current, stored)) ? null : 'wrong_password'
}

const recordEvent = (tx: Tx, ctx: SessionContext, kind: string) =>
  tx.query(`INSERT INTO auth_event (at, user_id, kind, meta) VALUES (now(), $1, $2, $3)`, [
    ctx.userId,
    kind,
    JSON.stringify({ session_id: ctx.sessionId }),
  ])

/** 설정 화면이 그리는 상태. */
export async function passwordStatus(ctx: SessionContext): Promise<PasswordStatus> {
  return withReadTransaction(async (tx) => {
    const hasPassword = (await storedHash(tx, ctx.userId)) !== null
    return { hasPassword, currentRequired: hasPassword && !(await isFreshCodeSession(tx, ctx)) }
  })
}

/**
 * 비밀번호를 정하거나 바꾼다. 없으면 정하고(지금 비밀번호를 묻지 않는다), 있으면 바꾼다(지금 비밀번호 · 이 세션을 뺀 세션 폐기).
 * `revokedSessions` 는 폐기한 세션 수다.
 */
export async function setPassword(
  ctx: SessionContext,
  input: { readonly newPassword: unknown; readonly currentPassword?: unknown },
): Promise<PasswordResult> {
  if (!isAcceptablePassword(input.newPassword)) return fail('weak_password')
  const newHash = await hashPassword(input.newPassword)

  return withCommandTransaction(async (tx) => {
    // 같은 사람의 동시 변경(두 탭)을 줄 세운다.
    await tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE`, [ctx.userId])
    const stored = await storedHash(tx, ctx.userId)
    if (stored === null) {
      await tx.query(
        `INSERT INTO credential (id, user_id, kind, password_hash, created_at) VALUES ($1, $2, 'password', $3, now())`,
        [randomUUID(), ctx.userId, newHash],
      )
      await recordEvent(tx, ctx, 'password_set')
      return { ok: true, value: { revokedSessions: 0 } } as const
    }

    const denied = await checkCurrent(tx, ctx, stored, input.currentPassword)
    if (denied !== null) return fail(denied)
    await tx.query(`UPDATE credential SET password_hash = $2 WHERE user_id = $1 AND kind = 'password'`, [ctx.userId, newHash])
    const revoked = await tx.query<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'password_change'
        WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
        RETURNING id`,
      [ctx.userId, ctx.sessionId],
    )
    await recordEvent(tx, ctx, 'password_changed')
    return { ok: true, value: { revokedSessions: revoked.length } } as const
  })
}

/** 비밀번호를 지운다 — 지금 비밀번호(또는 10분 안의 코드 세션) · 2단계 인증이 꺼져 있어야 한다. 그 뒤로는 로그인 코드로 들어온다. */
export async function removePassword(
  ctx: SessionContext,
  input: { readonly currentPassword?: unknown },
): Promise<PasswordResult<null>> {
  return withCommandTransaction(async (tx) => {
    await tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE`, [ctx.userId])
    const stored = await storedHash(tx, ctx.userId)
    if (stored === null) return fail('no_password')
    const mfa = await tx.queryMaybe(`SELECT 1 FROM mfa_method WHERE user_id = $1 AND confirmed_at IS NOT NULL LIMIT 1`, [ctx.userId])
    if (mfa !== null) return fail('mfa_enabled')
    const denied = await checkCurrent(tx, ctx, stored, input.currentPassword)
    if (denied !== null) return fail(denied)
    await tx.query(`DELETE FROM credential WHERE user_id = $1 AND kind = 'password'`, [ctx.userId])
    await recordEvent(tx, ctx, 'password_removed')
    return { ok: true, value: null } as const
  })
}

export type PasswordLoginResult =
  | { readonly ok: true; readonly value: { readonly userId: string; readonly email: string } }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'too_many_attempts' }

/**
 * 이메일 + 비밀번호로 들어올 사람을 찾는다 — 세션은 부르는 쪽이 만든다(`establishLogin` · 로그인 코드와 같은 길).
 *
 * 실패는 모두 `invalid_credentials` 다(열거 방지). 비밀번호가 없는 쪽도 가짜 해시를 비교해 시간을 맞춘다. 실패는
 * `auth_event('password_failed')` 로 남고, 마지막 성공 이후 15분 안에 10번 틀린 이메일은 맞아도 `too_many_attempts` 다(로그인 코드로는 들어올
 * 수 있다).
 */
export async function findPasswordLogin(input: {
  readonly email: unknown
  readonly password: unknown
  readonly ip: string | null
  readonly userAgent: string | null
}): Promise<PasswordLoginResult> {
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''

  const failures = await queryMaybe<{ n: number }>(
    `SELECT count(*)::int AS n FROM auth_event
      WHERE email = $1 AND kind = 'password_failed' AND at > now() - make_interval(mins => $2)
        AND at > coalesce((SELECT max(at) FROM auth_event WHERE email = $1 AND kind = 'login_succeeded'), '-infinity')`,
    [email, PASSWORD_FAILURE_WINDOW_MINUTES],
  )
  if ((failures?.n ?? 0) >= PASSWORD_FAILURE_LIMIT) return { ok: false, reason: 'too_many_attempts' }

  const row =
    email === ''
      ? null
      : await queryMaybe<{ user_id: string; email: string; password_hash: string | null }>(
          `SELECT u.id AS user_id, e.email::text AS email, c.password_hash
             FROM user_email e
             JOIN "user" u ON u.id = e.user_id AND u.status = 'active'
             LEFT JOIN credential c ON c.user_id = u.id AND c.kind = 'password'
            WHERE e.email = $1 AND e.verified_at IS NOT NULL`,
          [email],
        )
  const stored = row?.password_hash ?? null
  const matched = (await verifyPassword(password, stored ?? (await decoyHash()))) && stored !== null && row !== null

  if (!matched || row === null) {
    await query(`INSERT INTO auth_event (at, email, user_id, kind, ip, user_agent) VALUES (now(), $1, $2, 'password_failed', $3, $4)`, [
      email === '' ? null : email,
      row?.user_id ?? null,
      input.ip,
      input.userAgent,
    ])
    return { ok: false, reason: 'invalid_credentials' }
  }

  // 옛 매개변수로 만든 해시면 이 비밀번호로 새로 만든다(정본 ① — 값 안의 매개변수를 올리는 길).
  const upgraded = stored !== null && needsRehash(stored) ? await hashPassword(password) : null
  await query(
    `UPDATE credential SET last_used_at = now(), password_hash = coalesce($2, password_hash) WHERE user_id = $1 AND kind = 'password'`,
    [row.user_id, upgraded],
  )
  return { ok: true, value: { userId: row.user_id, email: row.email } }
}
