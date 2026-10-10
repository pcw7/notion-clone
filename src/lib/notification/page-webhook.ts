/**
 * 페이지 웹훅 — 걸고 · 보고 · 멈추고 · 지우기 (히스토리 · 활동 4e-1 · F-11-19)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ② ③ ④ · 마이그레이션 0075
 *
 * 그 페이지의 활동을 바깥 URL 로 보내는 연결이다(보내기는 4e-2). 이 파일은 연결을 다룬다.
 *
 *   - **전체 권한**(`manage_perm`)만 — 페이지 글이 바깥으로 나가는 길이라 공유와 같은 무게다. 볼 수 없으면 `not_found`, 볼 수 있지만
 *     전체 권한이 없으면 `forbidden`. 목록도 같다 — 힌트라도 볼 수 있는 사람이 거는 사람과 같아야 한다.
 *   - 데이터베이스 행에는 걸지 않는다(`row_page`) — 행의 공유는 데이터베이스가 정한다.
 *   - URL 은 모양을 보고(`checkOutboundUrl` — 이름 풀이는 보낼 때) 봉인해 둔다. 화면에는 힌트만 · 원문을 다시 주지 않는다.
 *   - 페이지마다 5개 — 페이지 행을 잠그고 센다(동시에 걸어도 넘지 않는다).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { checkOutboundUrl, type OutboundUrlProblem } from '../net/outbound.ts'
import { sealWebhookUrl, webhookUrlHint } from '../net/url-seal.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'

/** 페이지마다 이만큼까지(정본 ④ — 08 *"automation 당 최대 5개"* 와 같은 수). */
export const MAX_WEBHOOKS_PER_PAGE = 5

export type WebhookPauseReason = 'failures' | 'manual'

export type PageWebhook = {
  readonly id: string
  /** 호스트와 끝 4자 — 원문은 주지 않는다. */
  readonly urlHint: string
  readonly createdAt: Date
  /** 건 사람의 지금 이름. 탈퇴했으면 빈 글이다. */
  readonly createdBy: { readonly id: string; readonly name: string }
  readonly paused: { readonly at: Date; readonly reason: WebhookPauseReason } | null
}

export type WebhookFailure = 'not_found' | 'forbidden' | 'row_page' | 'invalid_url' | 'too_many'

export type WebhookResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: WebhookFailure; readonly problem?: OutboundUrlProblem }

const fail = (reason: WebhookFailure, problem?: OutboundUrlProblem) =>
  ({ ok: false, reason, ...(problem === undefined ? {} : { problem }) }) as const

/** 문 — 살아 있는 페이지 · 볼 수 있음 · 전체 권한 · 행이 아님. 바꾸는 명령은 페이지 행을 잠근다(상한을 세는 줄을 세운다). */
async function gate(tx: Tx, ctx: SessionContext, pageId: string, lock: boolean): Promise<WebhookFailure | null> {
  if (!isUuid(pageId)) return 'not_found'
  const page = await tx.queryMaybe<{ parent_type: string }>(
    `SELECT parent_type FROM block
      WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
      ${lock ? 'FOR UPDATE' : ''}`,
    [pageId, ctx.workspaceId],
  )
  if (page === null) return 'not_found'
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (!can(caps, 'view')) return 'not_found'
  if (!can(caps, 'manage_perm')) return 'forbidden'
  if (page.parent_type === 'data_source') return 'row_page'
  return null
}

type Row = {
  id: string
  url_hint: string
  created_at: Date
  created_by: string
  creator_name: string | null
  creator_deleted: boolean | null
  paused_at: Date | null
  pause_reason: WebhookPauseReason | null
}

const SELECT = `SELECT w.id, w.url_hint, w.created_at, w.created_by, w.paused_at, w.pause_reason,
                       u.name AS creator_name, u.deleted_at IS NOT NULL AS creator_deleted
                  FROM page_webhook w
                  LEFT JOIN "user" u ON u.id = w.created_by`

const toWebhook = (r: Row): PageWebhook => ({
  id: r.id,
  urlHint: r.url_hint,
  createdAt: r.created_at,
  createdBy: { id: r.created_by, name: r.creator_deleted ? '' : (r.creator_name ?? '') },
  paused: r.paused_at === null || r.pause_reason === null ? null : { at: r.paused_at, reason: r.pause_reason },
})

/** 그 페이지의 웹훅 — 건 순서대로. */
export async function listPageWebhooks(ctx: SessionContext, pageId: string): Promise<WebhookResult<readonly PageWebhook[]>> {
  return withReadTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, false)
    if (denied !== null) return fail(denied)
    const rows = await tx.query<Row>(`${SELECT} WHERE w.page_id = $1 AND w.workspace_id = $2 ORDER BY w.created_at, w.id`, [
      pageId,
      ctx.workspaceId,
    ])
    return { ok: true, value: rows.map(toWebhook) } as const
  })
}

/** 웹훅을 건다 — URL 의 모양을 보고 봉인해 둔다. 페이지마다 5개까지. */
export async function addPageWebhook(ctx: SessionContext, pageId: string, rawUrl: unknown): Promise<WebhookResult<PageWebhook>> {
  if (typeof rawUrl !== 'string') return fail('invalid_url', 'invalid')
  const checked = checkOutboundUrl(rawUrl)
  return withTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, true)
    if (denied !== null) return fail(denied)
    if (!checked.ok) return fail('invalid_url', checked.problem)
    const count = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM page_webhook WHERE page_id = $1`, [pageId])
    if (count.n >= MAX_WEBHOOKS_PER_PAGE) return fail('too_many')
    const id = randomUUID()
    await tx.query(
      `INSERT INTO page_webhook (id, workspace_id, page_id, url_sealed, url_hint, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ctx.workspaceId, pageId, sealWebhookUrl(checked.url.href), webhookUrlHint(checked.url), ctx.userId],
    )
    const row = await tx.queryOne<Row>(`${SELECT} WHERE w.id = $1`, [id])
    return { ok: true, value: toWebhook(row) } as const
  })
}

/** 멈추거나(`manual`) 다시 켠다 — 실패로 멈춘 것도 다시 켠다(정본 ⑦ — 사람이 다시 켠다). */
export async function setPageWebhookPaused(
  ctx: SessionContext,
  pageId: string,
  webhookId: string,
  paused: boolean,
): Promise<WebhookResult<PageWebhook>> {
  return withTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, true)
    if (denied !== null) return fail(denied)
    if (!isUuid(webhookId)) return fail('not_found')
    const updated = await tx.query<{ id: string }>(
      `UPDATE page_webhook
          SET paused_at = CASE WHEN $3::boolean THEN coalesce(paused_at, now()) ELSE NULL END,
              pause_reason = CASE WHEN $3::boolean THEN coalesce(pause_reason, 'manual') ELSE NULL END
        WHERE id = $1 AND page_id = $2
        RETURNING id`,
      [webhookId, pageId, paused],
    )
    if (updated.length === 0) return fail('not_found')
    return { ok: true, value: toWebhook(await tx.queryOne<Row>(`${SELECT} WHERE w.id = $1`, [webhookId])) } as const
  })
}

/** 지운다. */
export async function removePageWebhook(ctx: SessionContext, pageId: string, webhookId: string): Promise<WebhookResult<null>> {
  return withTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, true)
    if (denied !== null) return fail(denied)
    if (!isUuid(webhookId)) return fail('not_found')
    const removed = await tx.query<{ id: string }>(`DELETE FROM page_webhook WHERE id = $1 AND page_id = $2 RETURNING id`, [webhookId, pageId])
    return removed.length === 0 ? fail('not_found') : ({ ok: true, value: null } as const)
  })
}

/** 실패를 HTTP 로 — 없음 404 · 권한 403 · 행 · URL · 상한 400. */
export function webhookFailureStatus(reason: WebhookFailure): number {
  return reason === 'not_found' ? 404 : reason === 'forbidden' ? 403 : 400
}
