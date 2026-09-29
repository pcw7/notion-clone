/**
 * PUT / DELETE /api/workspaces/[workspaceId]/pages/[pageId]/lock — 페이지를 잠그고 푼다 (7f-1 · F-06-16)
 *
 * 몸체 없음. 그 페이지를 고칠 수 있는 사람만(`edit_content` — 잠근 사람도 잠긴 채로 푼다). 이미 그 상태면 `changed: false`.
 *
 *   not_found → 404   볼 수 없거나 없는 페이지(없는 것과 같다)
 *   forbidden → 403   볼 수는 있지만 고칠 수 없다
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { setPageLock, type LockFailure } from '@/lib/permissions/lock'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/lock'>

const STATUS: Readonly<Record<LockFailure, number>> = { not_found: 404, forbidden: 403 }

async function toggle(ctx: Ctx, locked: boolean): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const result = await setPageLock(session.ctx, pageId, locked)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, locked, changed: result.value.changed })
}

export async function PUT(_request: Request, ctx: Ctx): Promise<Response> {
  return toggle(ctx, true)
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  return toggle(ctx, false)
}
