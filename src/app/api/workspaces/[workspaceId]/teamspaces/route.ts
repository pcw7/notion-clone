/**
 * teamspace — GET(내 것 · 둘러보기) · POST(만들기) `/api/workspaces/[workspaceId]/teamspaces` (7c-1 · 7c-5조각 · F-06-04)
 *
 * 만든 사람이 owner 가 된다. `?scope=browse` 는 **둘러보기** 다 — 내가 멤버가 아닌 open · closed 까지 온다(7c-5). 기본은
 * 내 것이다: 사이드바가 쓰는 목록이라 모르는 `scope` 를 넓게 읽어 주면 안 된다(모르는 값은 기본으로 떨어진다).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createTeamspace, listBrowsableTeamspaces, listMyTeamspaces } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const browse = new URL(request.url).searchParams.get('scope') === 'browse'
  const teamspaces = browse ? await listBrowsableTeamspaces(session.ctx) : await listMyTeamspaces(session.ctx)
  return Response.json({ teamspaces })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; visibility?: unknown }

  const created = await createTeamspace(session.ctx, { name: body.name, visibility: body.visibility })
  if (!created.ok) return teamspaceFailureResponse(created)
  return Response.json({ teamspace: created.value }, { status: 201 })
}
