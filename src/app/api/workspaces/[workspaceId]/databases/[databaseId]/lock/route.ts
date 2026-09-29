/**
 * PUT / DELETE /api/workspaces/[workspaceId]/databases/[databaseId]/lock — 데이터베이스의 구조를 잠그고 푼다 (7f-2 · F-06-16)
 *
 * 몸체 없음. 구조를 고칠 수 있는 사람만(`edit_structure`). 이미 그 상태면 `changed: false`. 잠기면 속성 · 뷰 · 템플릿 · 이름을
 * 고치는 요청이 409 `locked` 를 받는다 — 행과 셀 값은 그대로다.
 *
 *   not_found → 404   볼 수 없거나 없는 데이터베이스(없는 것과 같다)
 *   forbidden → 403   볼 수는 있지만 구조를 고칠 수 없다
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { setDatabaseLock, type LockFailure } from '@/lib/permissions/lock'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/lock'>

const STATUS: Readonly<Record<LockFailure, number>> = { not_found: 404, forbidden: 403 }

async function toggle(ctx: Ctx, locked: boolean): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const result = await setDatabaseLock(session.ctx, databaseId, locked)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, locked, changed: result.value.changed })
}

export async function PUT(_request: Request, ctx: Ctx): Promise<Response> {
  return toggle(ctx, true)
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  return toggle(ctx, false)
}
