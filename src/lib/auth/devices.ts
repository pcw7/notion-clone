/**
 * 로그인한 기기 — 목록 · 하나씩 로그아웃 · 다른 모든 기기에서 로그아웃 · 새 기기 알림 · "내가 아니에요" (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] · DDL 의 user_session(A8 — 유효 세션 = revoked_at IS NULL AND expires_at > now())
 *       14-auth-accounts.md F-14-08 *"특정 기기 옆 Log out 으로 그 세션만 종료 · Log out of all devices → 현재 세션은 유지되고 나머지 전부
 *       종료 · 새 기기에서 로그인하면 계정 이메일로 알림 · This was not me"*
 *
 *   · 목록 · 끊기는 **자기 세션만**(`user_id = ctx.userId` — 남의 세션 id 는 없는 것과 같은 `not_found`) · 위임 · API 토큰 컨텍스트는 목록까지
 *     `session_required`(세션에 매인 명령 · API-1 ②). 재인증은 묻지 않는다 — 끊기는 새 접근을 주지 않는다(⑦ 은 주소의 일).
 *   · 이 세션은 하나씩 끊지 못한다(`current_session` — 로그아웃 단추가 쿠키까지 치운다). 다른 모든 기기는 이 세션만 남긴다 · API 토큰은
 *     그대로(⑫ · 14 엣지 "통합을 끊으면 자동화가 전부 죽는다").
 *   · 폐기는 `revoked_at` 을 쓴다 — 세션 해석이 요청마다 DB 를 읽으므로 그 세션의 다음 요청이 401 이고, 0016 의 트리거가 협업 서버 · 표
 *     변경 허브에 `user:<id>` 를 울려 열린 연결을 닫는다(새 신호를 만들지 않는다).
 *   · **아는 기기**(`isKnownDevice`) — 그 사람의 세션 중 같은 기기 표시 · 마지막 활동이 30일 안 · 살아 있거나 그 기기가 스스로 끝낸 것.
 *     다른 곳에서 끊은 세션은 보증하지 않는다(끊은 기기가 다시 들어오면 다시 알린다).
 *   · **"내가 아니에요"** — 서명 링크(`device-identity.ts`) · 화면의 단추(POST)가 그 사람의 모든 세션을 폐기한다(`user_reported`) · 한 번만.
 */

import { recordAuditIn } from '../audit/audit.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { sendAccountNotice } from './account-mailer.ts'
import { KNOWN_DEVICE_DAYS } from './constants.ts'
import { checkDeviceReport, deviceReportKey, deviceReportUrl, signDeviceReport } from './device-identity.ts'
import { isLoginSession, type SessionContext } from './session-context.ts'
import { deviceLabel, parseUserAgent, placeLabel, type DeviceForm } from './user-agent.ts'

/** 그 기기가 스스로 끝낸 세션의 폐기 이유 — 이런 세션은 그 기기를 "아는 기기"로 보증한다(정본 [AC-3]). 나머지는 다른 곳에서 끊었다. */
export const SELF_ENDED_REASONS = ['user_logout', 'user_logout_all', 'superseded'] as const

/** 목록이 싣는 세션의 상한 — 사람의 기기는 몇 개다. 쌓인 시험 세션에 화면이 묻히지 않게. */
const LIST_LIMIT = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DeviceRow = {
  /** 세션 id — 토큰이 아니다(끊을 때 이것을 보낸다). */
  readonly id: string
  /** "Chrome · Windows" — `deviceLabel`. */
  readonly label: string
  readonly form: DeviceForm
  /** 대략 위치(`placeLabel` — 가린 IP) · 모르면 null. */
  readonly place: string | null
  readonly signedInAt: string
  readonly lastActiveAt: string
  /** 이 세션인가 — "이 기기". */
  readonly current: boolean
  /** 30일 안에 이 세션으로 새 기기 알림을 보냈는가 — 앱 안의 "새 기기" 표지(정본 [AC-3] — 받은편지함 알림은 만들지 않는다). */
  readonly newDevice: boolean
}

export type DevicesFailure =
  /** 로그인 세션이 아니다 — 위임 · API 토큰(세션에 매인 명령). */
  | 'session_required'
  /** 이 사람의 살아 있는 세션이 아니다(남의 세션 · 없는 세션 · 이미 끝난 세션 — 같은 답). */
  | 'not_found'
  /** 이 세션은 목록에서 끊지 않는다 — 로그아웃 단추로. */
  | 'current_session'

export type DevicesResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: DevicesFailure }

const fail = (reason: DevicesFailure) => ({ ok: false, reason }) as const

// ── 목록 ───────────────────────────────────────────────────────────────

/** 이 사람의 살아 있는 세션 — 이 세션이 맨 위, 그다음 마지막 활동 순. */
export async function listDevices(ctx: SessionContext): Promise<DevicesResult<readonly DeviceRow[]>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  const rows = await withReadTransaction((tx) =>
    tx.query<{
      id: string
      device_label: string | null
      ip: string | null
      approx_location: string | null
      created_at: Date
      last_seen_at: Date
      new_device: boolean
    }>(
      `SELECT s.id, s.device_label, host(s.ip) AS ip, s.approx_location, s.created_at, s.last_seen_at,
              EXISTS (SELECT 1 FROM auth_event e
                       WHERE e.user_id = s.user_id AND e.kind = 'new_device_login'
                         AND e.at > now() - make_interval(days => $3)
                         AND e.meta ->> 'session_id' = s.id::text) AS new_device
         FROM user_session s
        WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        ORDER BY (s.id = $2) DESC, s.last_seen_at DESC, s.created_at DESC
        LIMIT ${LIST_LIMIT}`,
      [ctx.userId, ctx.sessionId, KNOWN_DEVICE_DAYS],
    ),
  )
  return {
    ok: true,
    value: rows.map((row) => {
      const agent = parseUserAgent(row.device_label)
      return {
        id: row.id,
        label: deviceLabel(agent),
        form: agent.form,
        place: placeLabel(row.approx_location, row.ip),
        signedInAt: row.created_at.toISOString(),
        lastActiveAt: row.last_seen_at.toISOString(),
        current: row.id === ctx.sessionId,
        newDevice: row.new_device,
      }
    }),
  }
}

// ── 끊기 ───────────────────────────────────────────────────────────────

async function recordRevocation(tx: Tx, ctx: SessionContext, change: 'device_signed_out' | 'other_devices_signed_out', revoked: readonly string[]) {
  await tx.query(`INSERT INTO auth_event (at, user_id, kind, meta) VALUES (now(), $1, 'session_revoked', $2)`, [
    ctx.userId,
    JSON.stringify({ session_id: ctx.sessionId, scope: change === 'device_signed_out' ? 'one' : 'others', revoked_sessions: revoked.length, revoked }),
  ])
  // 감사 로그(F-11-12 · 계정 범위) — 끊은 세션의 수만(기기 이름 · IP 는 싣지 않는다)
  await recordAuditIn(tx, {
    type: 'account.security_changed',
    workspaceId: null,
    actorUserId: ctx.userId,
    sessionId: ctx.sessionId,
    metadata: { change, revokedSessions: revoked.length },
  })
}

/** 목록의 기기 하나를 로그아웃시킨다 — 이 사람의 다른 살아 있는 세션만. */
export async function signOutDevice(ctx: SessionContext, input: { readonly sessionId: unknown }): Promise<DevicesResult<null>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  const target = typeof input.sessionId === 'string' && UUID.test(input.sessionId) ? input.sessionId.toLowerCase() : null
  if (target === null) return fail('not_found')
  if (target === ctx.sessionId) return fail('current_session')
  return withCommandTransaction(async (tx) => {
    // 사람을 함께 건다 — 남의 세션 id 를 알아도 끊지 못한다(없는 세션과 같은 답)
    const row = await tx.queryMaybe<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'device_signed_out'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()
        RETURNING id`,
      [target, ctx.userId],
    )
    if (row === null) return fail('not_found')
    await recordRevocation(tx, ctx, 'device_signed_out', [row.id])
    return { ok: true, value: null } as const
  })
}

/** 이 세션을 뺀 모든 기기를 로그아웃시킨다 — API 토큰은 그대로. `revokedSessions` 는 끊은 세션 수(0 이어도 성공). */
export async function signOutOtherDevices(ctx: SessionContext): Promise<DevicesResult<{ readonly revokedSessions: number }>> {
  if (!isLoginSession(ctx)) return fail('session_required')
  return withCommandTransaction(async (tx) => {
    const revoked = await tx.query<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'other_devices_signed_out'
        WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL AND expires_at > now()
        RETURNING id`,
      [ctx.userId, ctx.sessionId],
    )
    await recordRevocation(tx, ctx, 'other_devices_signed_out', revoked.map((r) => r.id))
    return { ok: true, value: { revokedSessions: revoked.length } } as const
  })
}

// ── 새 기기 알림 ───────────────────────────────────────────────────────

/**
 * 이 사람이 이 기기 표시를 아는가 — 지난 30일 안에 활동한 세션 중 같은 표시이고, 살아 있거나 그 기기가 스스로 끝낸 것(정본 [AC-3]).
 * 새 세션을 넣기 **전에** 묻는다(새 세션이 스스로를 보증하지 않게). `ix_user_session_device`(0158)를 탄다.
 */
export async function isKnownDevice(tx: Tx, userId: string, deviceId: string): Promise<boolean> {
  const row = await tx.queryMaybe(
    `SELECT 1 FROM user_session
      WHERE user_id = $1 AND device_id = $2
        AND last_seen_at > now() - make_interval(days => $3)
        AND (revoked_at IS NULL OR revoked_reason = ANY($4::text[]))
      LIMIT 1`,
    [userId, deviceId, KNOWN_DEVICE_DAYS, [...SELF_ENDED_REASONS]],
  )
  return row !== null
}

/** 새 기기 로그인 — 트랜잭션 안에서 적고(`auth_event`), 커밋 뒤에 알린다(`sendNewDeviceNotice`). */
export type NewDeviceLogin = {
  readonly to: string
  readonly sessionId: string
  readonly device: string
  readonly place: string | null
  readonly at: string
}

/** 새 기기 로그인을 적는다 — 로그인 트랜잭션 안에서. 알릴 대표 주소가 없으면(있을 수 없다 — A1) null. */
export async function recordNewDeviceLogin(
  tx: Tx,
  input: { readonly userId: string; readonly sessionId: string; readonly userAgent: string | null; readonly ip: string | null },
): Promise<NewDeviceLogin | null> {
  const primary = await tx.queryMaybe<{ email: string; at: Date }>(
    `SELECT ue.email::text AS email, now() AS at
       FROM "user" u
       JOIN user_email ue ON ue.id = u.primary_email_id
      WHERE u.id = $1`,
    [input.userId],
  )
  await tx.query(`INSERT INTO auth_event (at, user_id, kind, ip, user_agent, meta) VALUES (now(), $1, 'new_device_login', $2, $3, $4)`, [
    input.userId,
    input.ip,
    input.userAgent,
    JSON.stringify({ session_id: input.sessionId }),
  ])
  if (primary === null) return null
  return {
    to: primary.email,
    sessionId: input.sessionId,
    device: deviceLabel(parseUserAgent(input.userAgent)),
    place: placeLabel(null, input.ip),
    at: primary.at.toISOString(),
  }
}

/** 새 기기 알림을 보낸다 — 커밋 뒤에. 링크에 서명하지 못해도 알림은 간다(정본 ⑧ — 알림은 로그인을 되돌리지 않는다). */
export async function sendNewDeviceNotice(login: NewDeviceLogin, appUrl: string): Promise<void> {
  let reportUrl: string | null = null
  try {
    reportUrl = deviceReportUrl(appUrl, signDeviceReport(deviceReportKey(), login.sessionId, new Date()))
  } catch (e) {
    console.error('[devices] "내가 아니에요" 링크를 만들지 못했다:', (e as Error).message)
  }
  await sendAccountNotice({ to: login.to, kind: 'new_device_login', device: login.device, place: login.place, at: login.at, reportUrl })
}

// ── "내가 아니에요" ────────────────────────────────────────────────────

export type DeviceReportFailure =
  /** 모양 · 서명이 틀렸거나 그 세션이 없다(어느 쪽인지 말하지 않는다). */
  | 'invalid'
  | 'expired'
  /** 이 링크로 이미 알렸다 — 한 번만. */
  | 'already_used'

export type DeviceReportResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: DeviceReportFailure }

const failReport = (reason: DeviceReportFailure) => ({ ok: false, reason }) as const

type ReportTarget = { readonly sessionId: string; readonly userId: string; readonly deviceLabel: string | null; readonly createdAt: Date }

async function reportTarget(tx: Tx, token: unknown, now: Date): Promise<DeviceReportResult<ReportTarget>> {
  const check = checkDeviceReport(deviceReportKey(), token, now)
  if (!check.ok) return failReport(check.reason)
  const row = await tx.queryMaybe<{ user_id: string; device_label: string | null; created_at: Date }>(
    `SELECT user_id, device_label, created_at FROM user_session WHERE id = $1`,
    [check.sessionId],
  )
  if (row === null) return failReport('invalid')
  return { ok: true, value: { sessionId: check.sessionId, userId: row.user_id, deviceLabel: row.device_label, createdAt: row.created_at } }
}

const alreadyReported = async (tx: Tx, target: ReportTarget): Promise<boolean> =>
  (await tx.queryMaybe(
    `SELECT 1 FROM auth_event WHERE user_id = $1 AND kind = 'new_device_reported' AND meta ->> 'session_id' = $2 LIMIT 1`,
    [target.userId, target.sessionId],
  )) !== null

/** "내가 아니에요" 화면이 그리는 것 — 아무것도 바꾸지 않는다(GET · 메일의 링크 미리보기가 눌러도 그대로). */
export async function previewDeviceReport(
  token: unknown,
  now = new Date(),
): Promise<DeviceReportResult<{ readonly device: string; readonly signedInAt: string }>> {
  return withReadTransaction(async (tx) => {
    const target = await reportTarget(tx, token, now)
    if (!target.ok) return target
    if (await alreadyReported(tx, target.value)) return failReport('already_used')
    return { ok: true, value: { device: deviceLabel(parseUserAgent(target.value.deviceLabel)), signedInAt: target.value.createdAt.toISOString() } } as const
  })
}

/**
 * "내가 아니에요" — 그 사람의 **모든** 세션을 폐기한다(`user_reported` · 정본 ⑭). 세션이 없어도 된다(메일을 연 기기가 로그인해 있지 않을 수
 * 있다) — 서명 링크가 증명이다. 한 번만(그 세션의 `new_device_reported` 가 있으면 `already_used`). API 토큰은 그대로.
 * `hasPassword` 는 화면의 안내(비밀번호를 바꾸라 · 없으면 메일함을 지키라)에 쓴다.
 */
export async function reportNewDevice(
  token: unknown,
  now = new Date(),
): Promise<DeviceReportResult<{ readonly revokedSessions: number; readonly hasPassword: boolean }>> {
  return withCommandTransaction(async (tx) => {
    const target = await reportTarget(tx, token, now)
    if (!target.ok) return target
    // 같은 링크를 두 번 누른 것을 줄 세운다 — 둘째는 첫째의 기록을 본다
    await tx.query(`SELECT 1 FROM "user" WHERE id = $1 FOR NO KEY UPDATE`, [target.value.userId])
    if (await alreadyReported(tx, target.value)) return failReport('already_used')
    const revoked = await tx.query<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'user_reported'
        WHERE user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [target.value.userId],
    )
    const password = await tx.queryMaybe(`SELECT 1 FROM credential WHERE user_id = $1 AND kind = 'password'`, [target.value.userId])
    await tx.query(`INSERT INTO auth_event (at, user_id, kind, meta) VALUES (now(), $1, 'new_device_reported', $2)`, [
      target.value.userId,
      JSON.stringify({ session_id: target.value.sessionId, revoked_sessions: revoked.length }),
    ])
    await recordAuditIn(tx, {
      type: 'account.security_changed',
      workspaceId: null,
      actorUserId: target.value.userId,
      sessionId: null,
      metadata: { change: 'new_device_reported', revokedSessions: revoked.length },
    })
    return { ok: true, value: { revokedSessions: revoked.length, hasPassword: password !== null } } as const
  })
}
