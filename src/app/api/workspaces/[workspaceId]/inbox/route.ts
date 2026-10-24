/**
 * 인박스 — GET/PATCH `/api/workspaces/[workspaceId]/inbox` (F-11-07 · 코멘트 4조각)
 *
 * 권한 재검사는 쿼리 안에 있다(`notification/inbox.ts` 머리말 · §3.3-131) — 이 파일이 따로 거르지 않는다.
 * 밖에서 거르면 페이지네이션이 깨지고, 무엇보다 한 곳만 잊으면 유출이다.
 *
 * GET 은 쪽 단위다(10n-69 · HANDOFF §3.2-302) — `after` 는 지난 쪽이 준 `next`(모양이 틀리면 400 `invalid_cursor`), `limit` 은 줄 수
 * (읽음 · 보관 뒤의 다시 읽기가 지금까지 펼친 만큼을 받는다 — `INBOX_MAX_LIMIT` 까지). 답의 `next` 가 null 이면 더 없다.
 *
 * PATCH 는 **접힌 묶음 전체**의 id 를 받는다. 병합은 조회 시점이라(N2) 화면이 보는 한 줄이 행 여럿이고, 읽음은 그
 * 전부에 걸어야 한다 — 목록이 준 `notificationIds` 를 그대로 되돌려 보내면 된다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { decodeInboxCursor } from '@/lib/notification/inbox-cursor'
import { INBOX_FILTERS, listInboxPage, markNotifications, unreadCount, type InboxFilter } from '@/lib/notification/inbox'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/inbox'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const params = new URL(request.url).searchParams
  const raw = params.get('filter') ?? 'all'
  const filter: InboxFilter = INBOX_FILTERS.includes(raw as InboxFilter) ? (raw as InboxFilter) : 'all'
  const after = params.get('after') ?? undefined
  if (after !== undefined && decodeInboxCursor(after) === null) return Response.json({ error: 'invalid_cursor' }, { status: 400 })
  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? undefined : Number.parseInt(rawLimit, 10)
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit >= 1)) return Response.json({ error: 'invalid_limit' }, { status: 400 })

  const [page, unread] = await Promise.all([listInboxPage(session.ctx, { filter, after, limit }), unreadCount(session.ctx)])
  return Response.json({ ok: true, filter, items: page.items, next: page.next, unread })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body as { ids?: unknown; read?: unknown; archived?: unknown }

  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (typeof body.read !== 'boolean' && typeof body.archived !== 'boolean') {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const changed = await markNotifications(session.ctx, body.ids as string[], {
    read: typeof body.read === 'boolean' ? body.read : undefined,
    archived: typeof body.archived === 'boolean' ? body.archived : undefined,
  })
  return Response.json({ ok: true, changed, unread: await unreadCount(session.ctx) })
}
