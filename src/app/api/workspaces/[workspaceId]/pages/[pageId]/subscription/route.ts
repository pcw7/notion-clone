/**
 * 알림 받기 — GET · PUT `/api/workspaces/[workspaceId]/pages/[pageId]/subscription` (NM-1 · F-05-17 · F-11-09)
 *
 * 정본: 00-canonical-data-model.md [보강 NM-1] ③ — 볼 수 있으면 읽고 정할 수 있다(`view`). 볼 수 없거나 없는 페이지는 404.
 *
 *   GET → { ok, level, source }   `source` 가 null 이면 행이 없어 기본값(`replies_and_mentions`)
 *   PUT { level } → { ok, level }  고르면 `source='explicit'` — 그 뒤 어떤 자동 구독도 덮지 않는다(N1)
 *
 *   not_found → 404   invalid_level → 400 (몸체가 JSON 이 아니어도 400)
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { PAGE_LEVELS, readSubscription, setSubscription, type PageSubscriptionLevel, type SubscriptionFailure } from '@/lib/notification/subscription'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/subscription'>

const STATUS: Readonly<Record<SubscriptionFailure, number>> = { not_found: 404, invalid_level: 400 }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const result = await readSubscription(session.ctx, pageId)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, level: result.level, source: result.source })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const level = (parsed.body as { level?: unknown } | null)?.level
  if (typeof level !== 'string' || !PAGE_LEVELS.includes(level as PageSubscriptionLevel)) {
    return Response.json({ error: 'invalid_level' }, { status: 400 })
  }

  const result = await setSubscription(session.ctx, pageId, level as PageSubscriptionLevel)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, level: result.level })
}
