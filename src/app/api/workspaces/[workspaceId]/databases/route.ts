/**
 * 데이터베이스 생성 — POST `/api/workspaces/[workspaceId]/databases`
 *
 * 정본: 00-canonical-data-model.md §3.5 · 03-database-core.md F-03-01
 *
 * 표를 만들면 `database` · `data_source` · 제목 프로퍼티 · 기본 뷰가 **한
 * 트랜잭션에서** 함께 생긴다(`createDatabase`). 그중 하나라도 빠진 상태를 화면이
 * 보게 두지 않는 것이 그 함수의 일이다.
 *
 * `{ name?, teamspaceId? }` — `teamspaceId` 면 그 teamspace 의 최상위에 만든다(7c-4). 멤버가 아니면 없는 teamspace 와 같은 404 다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { createDatabase, listDatabases } from '@/lib/database/database'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/databases'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; teamspaceId?: unknown }
  if (body.teamspaceId != null && (typeof body.teamspaceId !== 'string' || !isUuid(body.teamspaceId))) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  const created = await createDatabase(session.ctx, {
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.teamspaceId === 'string' ? { teamspaceId: body.teamspaceId } : {}),
  })

  if (!created.ok) {
    const status = created.reason === 'forbidden' ? 403 : created.reason === 'not_found' ? 404 : 400
    return Response.json({ error: created.reason }, { status })
  }
  return Response.json({ ok: true, database: created.value }, { status: 201 })
}

/**
 * 볼 수 있는 데이터베이스 목록 — relation 프로퍼티의 대상을 고를 때 읽는다(relation 5b-2 · F-03-10 시나리오 1).
 * 볼 수 없는 표는 목록에 없다(`listDatabases` — 권한이 쿼리 안에 있다).
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/databases'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return Response.json({ ok: true, databases: await listDatabases(session.ctx) })
}
