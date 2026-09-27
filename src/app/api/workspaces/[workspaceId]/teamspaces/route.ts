/**
 * teamspace — GET(내 것 · 둘러보기) · POST(만들기) `/api/workspaces/[workspaceId]/teamspaces` (7c-1 · 7c-5조각 · F-06-04)
 *
 * 만든 사람이 owner 가 된다. `scope` 는 셋이다 — 기본(내가 멤버인 것 · 사이드바가 쓴다) · `browse`(둘러보기 — 내가 멤버가
 * 아닌 open · closed 까지 · 7c-5) · `archived`(보관된 것 중 **내가 owner 인 것** · 7c-6) · `all`(비공개 · 보관 포함 **전부** —
 * 워크스페이스 owner 에게만, 다른 역할은 빈 목록 · 7c-10). 모르는 값은 기본으로 떨어진다 —
 * 사이드바가 쓰는 목록이라 넓게 읽어 주면 안 된다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  createTeamspace,
  listAllTeamspaces,
  listArchivedTeamspaces,
  listBrowsableTeamspaces,
  listMyTeamspaces,
} from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const scope = new URL(request.url).searchParams.get('scope')
  const teamspaces =
    scope === 'browse'
      ? await listBrowsableTeamspaces(session.ctx)
      : scope === 'archived'
        ? await listArchivedTeamspaces(session.ctx)
        : scope === 'all'
          ? await listAllTeamspaces(session.ctx)
          : await listMyTeamspaces(session.ctx)
  return Response.json({ teamspaces })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; visibility?: unknown; icon?: unknown }

  const created = await createTeamspace(session.ctx, { name: body.name, visibility: body.visibility, icon: body.icon })
  if (!created.ok) return teamspaceFailureResponse(created)
  return Response.json({ teamspace: created.value }, { status: 201 })
}
