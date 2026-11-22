/**
 * AI 사용량 분석 · 활동 기록 — 원장(`ai_usage`)만 읽는다 (AI-7 · F-10-25 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫ · 마이그레이션 0149(인덱스 둘)
 *
 * 소유자 · 멤버 관리자는 워크스페이스 전체를, 다른 멤버는 **자기 것만** 본다(게스트는 null — 절이 없다). 질문 · 답의 글은 원장에 없다 —
 * 메타데이터(시각 · 사람 · 기능 · 모델 · 상태 · 토큰 · 페이지)만이다. 페이지는 **보는 사람이 지금 볼 수 있을 때만** 제목을 준다.
 *
 *   · "응답" = 실패를 뺀 것(셈과 같다 — 끝나지 않은 예약은 든다) · 토큰은 받은 것의 합(실패는 토큰이 없다)
 *   · 이번 달 = UTC 달력 달(셈의 달) · 30일 = UTC 날 30개(오늘이 끝)
 *   · 기록은 최근 것부터 · 커서는 `(created_at 의 epoch 마이크로초, id)`(키셋 — 같은 시각의 줄도 빠지거나 겹치지 않는다)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { withReadTransaction } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import {
  AI_LOG_PAGE,
  dailySeries,
  decodeLogCursor,
  encodeLogCursor,
  utcDaysEnding,
  type AiUsageLogEntry,
  type AiUsageLogPage,
  type AiUsageOverview,
  type AiUsageStatus,
} from './analytics-shared.ts'
import { viewablePagesIn } from './chat-store.ts'
import { isAiFeature, utcMonthStart, type AiFeature } from './quota.ts'
import { aiQuotaViewFor, canSeeAiSettings } from './usage.ts'

/** 워크스페이스 전체를 보는가 — 소유자 · 멤버 관리자. 다른 멤버는 자기 것만. */
export function canSeeAllAiUsage(ctx: Pick<SessionContext, 'role'>): boolean {
  return ctx.role === 'owner' || ctx.role === 'membership_admin'
}

const num = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))

/** 사용량 개요 — 이번 기간의 한도 · 이번 달 합 · 30일 · 사람 · 기능 · 모델. 게스트면 null. */
export async function aiUsageOverviewFor(ctx: SessionContext, options: { readonly now?: Date } = {}): Promise<AiUsageOverview | null> {
  if (!canSeeAiSettings(ctx)) return null
  const now = options.now ?? new Date()
  const all = canSeeAllAiUsage(ctx)
  const user = all ? null : ctx.userId
  const ws = ctx.workspaceId
  const monthStart = utcMonthStart(now)
  const days = utcDaysEnding(now)
  const from = new Date(`${days[0]}T00:00:00Z`)
  const until = new Date(Date.parse(`${days.at(-1)}T00:00:00Z`) + 24 * 60 * 60 * 1000)
  const quota = await aiQuotaViewFor(ws, now)

  return withReadTransaction(async (tx) => {
    const month = await tx.queryOne<{ responses: number; failed: number; input_tokens: string; output_tokens: string }>(
      `SELECT count(*) FILTER (WHERE status <> 'failed')::int AS responses,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(sum(output_tokens), 0)::bigint AS output_tokens
         FROM ai_usage
        WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $4 AND ($3::uuid IS NULL OR user_id = $3)`,
      [ws, monthStart, user, until],
    )
    const daily = await tx.query<{ day: string; feature: string; responses: number }>(
      `SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, feature, count(*)::int AS responses
         FROM ai_usage
        WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $4 AND status <> 'failed' AND ($3::uuid IS NULL OR user_id = $3)
        GROUP BY 1, 2`,
      [ws, from, user, until],
    )
    const members = await tx.query<{ user_id: string; name: string; responses: number; input_tokens: string; output_tokens: string; last_used: Date | null }>(
      `SELECT a.user_id, u.name,
              count(*) FILTER (WHERE a.status <> 'failed')::int AS responses,
              COALESCE(sum(a.input_tokens), 0)::bigint AS input_tokens,
              COALESCE(sum(a.output_tokens), 0)::bigint AS output_tokens,
              max(a.created_at) FILTER (WHERE a.status <> 'failed') AS last_used
         FROM ai_usage a JOIN "user" u ON u.id = a.user_id
        WHERE a.workspace_id = $1 AND a.created_at >= $2 AND a.created_at < $4 AND ($3::uuid IS NULL OR a.user_id = $3)
        GROUP BY a.user_id, u.name
        ORDER BY responses DESC, u.name, a.user_id`,
      [ws, monthStart, user, until],
    )
    const byKey = async (column: 'feature' | 'model') =>
      tx.query<{ key: string; responses: number; input_tokens: string; output_tokens: string }>(
        `SELECT ${column} AS key,
                count(*) FILTER (WHERE status <> 'failed')::int AS responses,
                COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(sum(output_tokens), 0)::bigint AS output_tokens
           FROM ai_usage
          WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $4 AND ($3::uuid IS NULL OR user_id = $3)
          GROUP BY ${column}
          ORDER BY responses DESC, ${column}`,
        [ws, monthStart, user, until],
      )
    const features = await byKey('feature')
    const models = await byKey('model')
    const people = await tx.query<{ id: string; name: string }>(
      `SELECT u.id, u.name FROM "user" u
        WHERE EXISTS (SELECT 1 FROM ai_usage a WHERE a.workspace_id = $1 AND a.user_id = u.id) AND ($2::uuid IS NULL OR u.id = $2)
        ORDER BY u.name, u.id LIMIT 500`,
      [ws, user],
    )
    return {
      scope: all ? 'workspace' : 'self',
      monthStart: monthStart.toISOString(),
      quota,
      month: { responses: month.responses, failed: month.failed, inputTokens: num(month.input_tokens), outputTokens: num(month.output_tokens) },
      daily: dailySeries(daily, now),
      members: members.map((r) => ({
        userId: r.user_id,
        name: r.name,
        responses: r.responses,
        inputTokens: num(r.input_tokens),
        outputTokens: num(r.output_tokens),
        lastUsedAt: r.last_used?.toISOString() ?? null,
      })),
      features: features
        .filter((r) => isAiFeature(r.key))
        .map((r) => ({ feature: r.key as AiFeature, responses: r.responses, inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens) })),
      models: models.map((r) => ({ model: r.key, responses: r.responses, inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens) })),
      people: people.map((p) => ({ id: p.id, name: p.name })),
    }
  })
}

export type AiUsageLogResult =
  | { readonly ok: true; readonly value: AiUsageLogPage }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' | 'invalid_input' }

/**
 * AI 활동 기록 — 최근 것부터 `limit`(기본 50) · 커서 다음부터 · 사람 · 기능으로 거른다. 자기 것만 보는 멤버가 남을 거르면 `forbidden`.
 * 게스트는 `not_found`.
 */
export async function aiUsageLogFor(
  ctx: SessionContext,
  options: { readonly cursor?: string | null; readonly member?: string | null; readonly feature?: string | null; readonly limit?: number } = {},
): Promise<AiUsageLogResult> {
  if (!canSeeAiSettings(ctx)) return { ok: false, reason: 'not_found' }
  const all = canSeeAllAiUsage(ctx)
  const member = options.member ?? null
  if (member !== null && !isUuid(member)) return { ok: false, reason: 'invalid_input' }
  if (!all && member !== null && member.toLowerCase() !== ctx.userId) return { ok: false, reason: 'forbidden' }
  const feature = options.feature ?? null
  if (feature !== null && !isAiFeature(feature)) return { ok: false, reason: 'invalid_input' }
  const rawCursor = options.cursor ?? null
  const cursor = rawCursor === null ? null : decodeLogCursor(rawCursor)
  if (rawCursor !== null && cursor === null) return { ok: false, reason: 'invalid_input' }
  const limit = Math.min(Math.max(Math.floor(options.limit ?? AI_LOG_PAGE), 1), 200)
  const user = all ? (member === null ? null : member.toLowerCase()) : ctx.userId

  return withReadTransaction(async (tx): Promise<AiUsageLogResult> => {
    const rows = await tx.query<{
      id: string
      micros: string
      created_at: Date
      user_id: string
      name: string
      feature: AiFeature
      model: string
      status: AiUsageStatus
      input_tokens: number | null
      output_tokens: number | null
      page_id: string | null
    }>(
      // 커서의 시각은 정수 마이크로초에서 되살린다(초 · 나머지 — 부동소수점을 거치지 않는다)
      `SELECT a.id, (extract(epoch FROM a.created_at) * 1000000)::bigint::text AS micros, a.created_at, a.user_id, u.name,
              a.feature, a.model, a.status, a.input_tokens, a.output_tokens, a.page_id
         FROM ai_usage a JOIN "user" u ON u.id = a.user_id
        WHERE a.workspace_id = $1
          AND ($2::uuid IS NULL OR a.user_id = $2)
          AND ($3::text IS NULL OR a.feature = $3)
          AND ($4::bigint IS NULL OR (a.created_at, a.id) <
               (to_timestamp(($4::bigint / 1000000)::double precision) + ($4::bigint % 1000000) * interval '1 microsecond', $5::uuid))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $6`,
      [ctx.workspaceId, user, feature, cursor?.micros ?? null, cursor?.id ?? null, limit + 1],
    )
    const page = rows.slice(0, limit)
    const pageIds = [...new Set(page.flatMap((r) => (r.page_id === null ? [] : [r.page_id])))]
    const viewable = await viewablePagesIn(tx, ctx, pageIds)
    const titles = new Map<string, string>()
    if (viewable.size > 0) {
      const found = await tx.query<{ id: string; properties: { title?: unknown } | null }>(`SELECT id, properties FROM block WHERE id = ANY($1::uuid[])`, [[...viewable]])
      for (const f of found) titles.set(f.id, plainTitleOf(f.properties))
    }
    const entries: AiUsageLogEntry[] = page.map((r) => ({
      id: r.id,
      at: r.created_at.toISOString(),
      user: { id: r.user_id, name: r.name },
      feature: r.feature,
      model: r.model,
      status: r.status,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      page: r.page_id === null ? null : viewable.has(r.page_id) ? { kind: 'page', id: r.page_id, title: titles.get(r.page_id) ?? '' } : { kind: 'hidden' },
    }))
    const last = page.at(-1)
    const nextCursor = rows.length > limit && last !== undefined ? encodeLogCursor(last.micros, last.id) : null
    return { ok: true, value: { entries, nextCursor } }
  })
}
