/**
 * AI 게이트 · 원장 · 스위치 · 보충 — AI-1 (F-10-12 · F-10-25 · CLAUDE.md 절대 제약 2)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ③ ④ ⑤ ⑦ · 마이그레이션 0146
 *
 * **호출 전에 · 한 트랜잭션에서 예약한다**(`reserveAiResponse`) — 스위치 → 그 사람(게스트 아님 · 로그인 세션) · 그 맥락(페이지를 볼 수
 * 있는가 · 고치기(AI-3) · AI 블록(AI-5)이면 고칠 수 있는가) → 앱 전체 하루 → 6시간 창 → 월 → 체험 → 보충. 모자라면 거부한다(`ai_limit_reached` + 어느 한도 · 언제 풀리는지 — 셈은
 * `quota.ts`). 통과하면 `ai_usage` 를 `reserved` 로 넣는 것이 곧 셈이다.
 *
 *   · 잠금의 차례는 늘 같다 — 워크스페이스의 AI 줄(`workspace_ai_setting`) → 그날의 전체 카운터(`ai_daily_usage`). 같은 워크스페이스의
 *     예약은 첫 잠금에서 줄을 서므로 같은 잔량을 두 번 쓰지 못하고, 다른 워크스페이스끼리는 하루 카운터에서 줄을 선다
 *   · 끝(`finishAiResponse`)은 예약만 바꾼다 — `completed`(토큰 기록) · `stopped`(셈에 든다) · `failed`(셈에서 빠진다 · 그 예약의 날의
 *     전체 카운터를 하나 돌려준다). 두 번 끝내지 않는다(이미 끝난 줄은 그대로)
 *   · 끝나지 않은 `reserved` 도 센다 — 서버가 도중에 죽으면 그 응답은 쓴 것으로 남는다(닫힌 쪽으로 실패한다)
 *   · **자동 충전 · 초과 과금 · 나중 청구는 없다** — 보충은 운영자 명령(`grantAiResponses` · `npm run ai:grant`)으로만 들어온다
 *
 * 게스트는 AI 를 쓰지 않는다(노션도 AI 는 멤버의 것이다 — 워크스페이스의 몫을 받은 페이지 하나의 손님이 쓰지 않게). 위임(자동화) · API
 * 토큰 컨텍스트도 아니다 — AI 는 앱 화면에서만 부른다.
 */

import { randomUUID } from 'node:crypto'

import { recordForContextIn } from '../audit/audit.ts'
import { isLoginSession, type SessionContext } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { withCommandTransaction, withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'
import { aiProviderHost, type AiConfig } from './config.ts'
import {
  aiQuotaView,
  decideAiQuota,
  utcDayOf,
  utcMonthStart,
  windowStart,
  type AiCounts,
  type AiFeature,
  type AiGrantLeft,
  type AiLimitKind,
  type AiLimits,
  type AiQuota,
  type AiQuotaView,
} from './quota.ts'
import type { TokenUsage } from './sse.ts'

type Reader = Pick<Tx, 'query' | 'queryMaybe'>

// ── 누가 ──────────────────────────────────────────────────────────────

/** 이 워크스페이스에서 AI 를 부를 수 있는 사람인가 — 게스트가 아니고 로그인 세션이다(머리말). */
export function canUseAi(ctx: SessionContext): boolean {
  return ctx.role !== 'guest' && isLoginSession(ctx)
}

/** 스위치를 바꿀 수 있는가 — 소유자 · 로그인 세션(정본 ⑤). */
export function canManageAi(ctx: SessionContext): boolean {
  return ctx.role === 'owner' && isLoginSession(ctx)
}

/** 설정의 AI 절을 보는가 — 게스트가 아닌 사람(쓴 양 · 공급자 · 스위치의 상태). 바꾸는 것은 `canManageAi`. */
export function canSeeAiSettings(ctx: Pick<SessionContext, 'role'>): boolean {
  return ctx.role !== 'guest'
}

// ── 읽기 ──────────────────────────────────────────────────────────────

async function aiEnabledIn(db: Reader, workspaceId: string): Promise<boolean> {
  return (await db.queryMaybe<{ enabled: boolean }>(`SELECT enabled FROM workspace_ai_setting WHERE workspace_id = $1`, [workspaceId]))?.enabled ?? false
}

async function aiLimitsIn(db: Reader, workspaceId: string): Promise<AiLimits> {
  return {
    trial: await entitlement(workspaceId, 'ai.trial_responses', db),
    monthly: await entitlement(workspaceId, 'ai.monthly_responses', db),
    window: await entitlement(workspaceId, 'ai.window_responses', db),
  }
}

/** 몫마다 쓴 양 — 실패는 세지 않는다 · 끝나지 않은 예약은 센다. */
async function aiCountsIn(db: Reader, workspaceId: string, now: Date): Promise<AiCounts> {
  const row = await db.queryMaybe<{ trial: string; month: string }>(
    `SELECT count(*) FILTER (WHERE quota = 'trial') AS trial,
            count(*) FILTER (WHERE quota = 'plan' AND created_at >= $2) AS month
       FROM ai_usage
      WHERE workspace_id = $1 AND status <> 'failed'`,
    [workspaceId, utcMonthStart(now)],
  )
  const times = await db.query<{ created_at: Date }>(
    `SELECT created_at FROM ai_usage
      WHERE workspace_id = $1 AND status <> 'failed' AND quota = 'plan' AND created_at > $2
      ORDER BY created_at, id`,
    [workspaceId, windowStart(now)],
  )
  return { trial: Number(row?.trial ?? 0), month: Number(row?.month ?? 0), windowTimes: times.map((r) => r.created_at) }
}

/** 만료 전이고 남은 것이 있는 보충 — 남은 수는 줄 수 - 그 보충에서 센 것. */
async function aiGrantsIn(db: Reader, workspaceId: string, now: Date): Promise<AiGrantLeft[]> {
  const rows = await db.query<{ id: string; remaining: number; granted_at: Date; expires_at: Date | null }>(
    `SELECT g.id, (g.responses - count(u.id))::int AS remaining, g.granted_at, g.expires_at
       FROM ai_grant g
       LEFT JOIN ai_usage u ON u.grant_id = g.id AND u.status <> 'failed'
      WHERE g.workspace_id = $1 AND (g.expires_at IS NULL OR g.expires_at > $2)
      GROUP BY g.id
     HAVING g.responses - count(u.id) > 0`,
    [workspaceId, now],
  )
  return rows.map((r) => ({ id: r.id, left: r.remaining, grantedAt: r.granted_at, expiresAt: r.expires_at }))
}

/** 지금의 쓴 양 · 남은 양 — 응답의 끝 사건과 설정 화면. */
export async function aiQuotaViewFor(workspaceId: string, now: Date = new Date()): Promise<AiQuotaView> {
  return withReadTransaction(async (tx) =>
    aiQuotaView(now, await aiLimitsIn(tx, workspaceId), await aiCountsIn(tx, workspaceId, now), await aiGrantsIn(tx, workspaceId, now)),
  )
}

/**
 * 편집기의 AI 입구(AI-2) — 빈 줄의 안내 · 스페이스는 `ready` 일 때만, `/ai` 는 늘 열리고 다른 상태면 까닭을 말한다. 화면 표시용이다 — 판정은
 * 부를 때 게이트(`reserveAiResponse`)가 다시 한다.
 */
export type AiEntryState = 'ready' | 'disabled' | 'unavailable' | 'forbidden'
export type AiEntry = { readonly state: AiEntryState; readonly canManage: boolean }

export async function aiEntryFor(ctx: SessionContext, config: AiConfig | null): Promise<AiEntry> {
  const canManage = canManageAi(ctx)
  if (config === null) return { state: 'unavailable', canManage }
  if (!canUseAi(ctx)) return { state: 'forbidden', canManage }
  const enabled = await withReadTransaction((tx) => aiEnabledIn(tx, ctx.workspaceId))
  return { state: enabled ? 'ready' : 'disabled', canManage }
}

export type AiSettingsSummary = {
  readonly enabled: boolean
  /** 스위치를 바꿀 수 있는가(소유자). */
  readonly canManage: boolean
  /** 운영자가 공급자를 설정했는가(주소 · 키 · 모델). */
  readonly available: boolean
  /** 글이 보내지는 곳 — 주소의 host. 설정이 없으면 null. */
  readonly providerHost: string | null
  readonly model: string | null
  readonly quota: AiQuotaView
}

/** 설정 → AI 절 — 게스트면 null(절이 서지 않는다). */
export async function aiSettingsSummary(
  ctx: SessionContext,
  options: { readonly config: AiConfig | null; readonly now?: Date },
): Promise<AiSettingsSummary | null> {
  if (!canSeeAiSettings(ctx)) return null
  const now = options.now ?? new Date()
  const ws = ctx.workspaceId
  return withReadTransaction(async (tx) => ({
    enabled: await aiEnabledIn(tx, ws),
    canManage: canManageAi(ctx),
    available: options.config !== null,
    providerHost: options.config === null ? null : aiProviderHost(options.config),
    model: options.config?.model ?? null,
    quota: aiQuotaView(now, await aiLimitsIn(tx, ws), await aiCountsIn(tx, ws, now), await aiGrantsIn(tx, ws, now)),
  }))
}

// ── 게이트 ────────────────────────────────────────────────────────────

export type AiReservation = {
  readonly id: string
  readonly workspaceId: string
  readonly quota: AiQuota
  readonly grantId: string | null
}

export type AiGateRefusal =
  | { readonly ok: false; readonly reason: 'ai_unavailable' | 'ai_disabled' | 'forbidden' | 'not_found' | 'cannot_edit' }
  | { readonly ok: false; readonly reason: 'ai_limit_reached'; readonly limit: AiLimitKind; readonly resetsAt: string | null }

export type AiReserveResult = { readonly ok: true; readonly reservation: AiReservation } | AiGateRefusal

/**
 * 응답 하나를 예약한다 — 공급자를 부르기 **전에**. 거부면 아무것도 쓰지 않는다.
 *
 * @param options.config 공급자 설정(없으면 `ai_unavailable`) — 하루 상한 · 모델을 여기서 읽는다
 * @param options.now 지금(시험이 시각을 정한다) — 창 · 달 · 날의 경계가 이것을 본다
 */
export async function reserveAiResponse(
  ctx: SessionContext,
  input: { readonly feature: AiFeature; readonly pageId?: string | null },
  options: { readonly config: AiConfig | null; readonly now?: Date },
): Promise<AiReserveResult> {
  const config = options.config
  if (config === null) return { ok: false, reason: 'ai_unavailable' }
  const now = options.now ?? new Date()
  const pageId = input.pageId ?? null
  if (pageId !== null && !isUuid(pageId)) return { ok: false, reason: 'not_found' }

  return withCommandTransaction(async (tx): Promise<AiReserveResult> => {
    // ① 스위치 — 이 줄을 잠가 이 워크스페이스의 예약을 줄 세운다(줄이 없으면 꺼짐 — 꺼진 곳은 셀 것도 없다)
    const setting = await tx.queryMaybe<{ enabled: boolean }>(
      `SELECT enabled FROM workspace_ai_setting WHERE workspace_id = $1 FOR UPDATE`,
      [ctx.workspaceId],
    )
    if (setting === null || !setting.enabled) return { ok: false, reason: 'ai_disabled' }

    // ② 그 사람 · 그 맥락(볼 수 있는 페이지만 — 볼 수 없으면 없는 것과 같다)
    if (!canUseAi(ctx)) return { ok: false, reason: 'forbidden' }
    const caps = pageId === null ? null : await effectiveCaps(tx, ctx, pageId)
    if (caps !== null && !can(caps, 'view')) return { ok: false, reason: 'not_found' }
    // 고치기(AI-3) · AI 블록(AI-5) — 답이 그 페이지에 든다: 살아 있는 페이지 · 본문을 고칠 수 있다(`edit_content`) · 잠기지 않았다. 보기 ·
    // 코멘트 · 제안만 쓸 수 있는 사람은 거부한다(`cannot_edit` — 협업 연결의 `edit` 판정과 같다 · `doc-store.ts` accessOf)
    if (input.feature === 'edit' || input.feature === 'block') {
      if (pageId === null || caps === null) return { ok: false, reason: 'not_found' }
      const live = await tx.queryMaybe<{ one: number }>(
        `SELECT 1 AS one FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
        [pageId, ctx.workspaceId],
      )
      if (live === null) return { ok: false, reason: 'not_found' }
      if (!can(caps, 'edit_content') || (await isLocked(tx, pageId))) return { ok: false, reason: 'cannot_edit' }
    }

    // ③ 앱 전체의 그날 — 줄을 만들고 잠근다(워크스페이스 줄 다음 — 늘 같은 차례)
    const day = utcDayOf(now)
    await tx.query(`INSERT INTO ai_daily_usage (day, responses) VALUES ($1::date, 0) ON CONFLICT (day) DO NOTHING`, [day])
    const daily = await tx.queryOne<{ responses: number }>(`SELECT responses FROM ai_daily_usage WHERE day = $1::date FOR UPDATE`, [day])

    // ④ 창 · 월 · 체험 · 보충 — 이 트랜잭션의 한 시점에서
    const decision = decideAiQuota(
      now,
      await aiLimitsIn(tx, ctx.workspaceId),
      await aiCountsIn(tx, ctx.workspaceId, now),
      await aiGrantsIn(tx, ctx.workspaceId, now),
      { used: daily.responses, cap: config.dailyCap },
    )
    if (!decision.ok) {
      return { ok: false, reason: 'ai_limit_reached', limit: decision.limit, resetsAt: decision.resetsAt?.toISOString() ?? null }
    }

    // ⑤ 넣는 것이 곧 셈이다
    const id = randomUUID()
    const grantId = decision.quota === 'grant' ? decision.grantId : null
    await tx.query(
      `INSERT INTO ai_usage (id, workspace_id, user_id, feature, status, quota, grant_id, model, page_id, created_at)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9)`,
      [id, ctx.workspaceId, ctx.userId, input.feature, decision.quota, grantId, config.model, pageId, now],
    )
    await tx.query(`UPDATE ai_daily_usage SET responses = responses + 1 WHERE day = $1::date`, [day])
    return { ok: true, reservation: { id, workspaceId: ctx.workspaceId, quota: decision.quota, grantId } }
  })
}

export type AiOutcome = 'completed' | 'stopped' | 'failed'

const tokens = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, 2_000_000_000) : null)

/**
 * 예약을 닫는다 — 예약인 줄만 바꾼다(두 번 닫지 않는다 · 닫았으면 true). `failed` 면 그 예약의 날(UTC)의 전체 카운터를 하나 돌려준다.
 */
export async function finishAiResponse(reservationId: string, outcome: AiOutcome, usage: TokenUsage | null, now: Date = new Date()): Promise<boolean> {
  return withTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ created_at: Date }>(
      `UPDATE ai_usage
          SET status = $2, input_tokens = $3, output_tokens = $4, finished_at = GREATEST($5::timestamptz, created_at)
        WHERE id = $1 AND status = 'reserved'
        RETURNING created_at`,
      [reservationId, outcome, tokens(usage?.inputTokens), tokens(usage?.outputTokens), now],
    )
    if (row === null) return false
    if (outcome === 'failed') {
      await tx.query(
        `UPDATE ai_daily_usage SET responses = responses - 1
          WHERE day = ($1::timestamptz AT TIME ZONE 'UTC')::date AND responses > 0`,
        [row.created_at],
      )
    }
    return true
  })
}

// ── 스위치 ────────────────────────────────────────────────────────────

export type AiSwitchResult =
  | { readonly ok: true; readonly value: { readonly enabled: boolean } }
  | { readonly ok: false; readonly reason: 'forbidden' | 'invalid_value' }

/** 스위치를 켜고 끈다 — 소유자만 · 바뀌었을 때만 감사(`workspace.setting_changed` · 키 `ai.enabled`). */
export async function setAiEnabled(ctx: SessionContext, raw: unknown): Promise<AiSwitchResult> {
  if (!canManageAi(ctx)) return { ok: false, reason: 'forbidden' }
  if (typeof raw !== 'boolean') return { ok: false, reason: 'invalid_value' }
  return withCommandTransaction(async (tx): Promise<AiSwitchResult> => {
    // 워크스페이스를 줄 세운다 — 처음 켜는 두 요청이 함께 "줄 없음" 을 읽고 감사를 두 번 쓰지 않게
    await tx.query(`SELECT 1 FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    const before = await aiEnabledIn(tx, ctx.workspaceId)
    if (before === raw) return { ok: true, value: { enabled: raw } }
    await tx.query(
      `INSERT INTO workspace_ai_setting (workspace_id, enabled, changed_by, changed_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, changed_by = EXCLUDED.changed_by, changed_at = EXCLUDED.changed_at`,
      [ctx.workspaceId, raw, ctx.userId],
    )
    await recordForContextIn(tx, ctx, 'workspace.setting_changed', {
      target: { type: 'setting', id: 'ai.enabled' },
      setting: { key: 'ai.enabled', before, after: raw },
    })
    return { ok: true, value: { enabled: raw } }
  })
}

// ── 운영자 보충 ───────────────────────────────────────────────────────

export const AI_GRANT_MAX = 1_000_000
export const AI_GRANT_MAX_DAYS = 3650
export const AI_GRANT_DEFAULT_REASON = '운영자 보충'

export type AiGrantResult =
  | { readonly ok: true; readonly value: { readonly grantId: string; readonly expiresAt: string | null; readonly balance: number } }
  | { readonly ok: false; readonly reason: 'not_found' | 'invalid_responses' | 'invalid_days' | 'invalid_reason' }

const wholeIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

/**
 * 보충을 준다 — 운영자 명령(`npm run ai:grant` · 서버 셸에서만 · HTTP 로 열지 않는다). 요금제 몫을 다 쓴 뒤에 쓴다. 결제는 없다.
 * 같은 것을 두 번 부르면 두 번 준다(멱등이 아니다 — 명령이 남은 수를 찍는다).
 *
 * @returns 만든 보충 · 만료 전 보충의 남은 수 합(`balance`)
 */
export async function grantAiResponses(
  workspaceId: string,
  input: { readonly responses: unknown; readonly days?: unknown; readonly reason?: unknown; readonly now?: Date },
): Promise<AiGrantResult> {
  if (!isUuid(workspaceId)) return { ok: false, reason: 'not_found' }
  const responses = wholeIn(input.responses, 1, AI_GRANT_MAX)
  if (responses === null) return { ok: false, reason: 'invalid_responses' }
  const days = input.days === undefined || input.days === null ? null : wholeIn(input.days, 1, AI_GRANT_MAX_DAYS)
  if (input.days !== undefined && input.days !== null && days === null) return { ok: false, reason: 'invalid_days' }
  const reason = input.reason === undefined || input.reason === null ? AI_GRANT_DEFAULT_REASON : typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < 1 || reason.length > 200) return { ok: false, reason: 'invalid_reason' }
  const now = input.now ?? new Date()
  const expiresAt = days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  return withCommandTransaction(async (tx): Promise<AiGrantResult> => {
    const ws = await tx.queryMaybe<{ id: string }>(`SELECT id FROM workspace WHERE id = $1 AND deleted_at IS NULL`, [workspaceId])
    if (ws === null) return { ok: false, reason: 'not_found' }
    const grantId = randomUUID()
    await tx.query(
      `INSERT INTO ai_grant (id, workspace_id, responses, reason, granted_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [grantId, workspaceId, responses, reason, now, expiresAt],
    )
    const balance = (await aiGrantsIn(tx, workspaceId, now)).reduce((sum, g) => sum + g.left, 0)
    return { ok: true, value: { grantId, expiresAt: expiresAt?.toISOString() ?? null, balance } }
  })
}
