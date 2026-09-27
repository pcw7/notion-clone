/**
 * 기본 teamspace — PUT(켜기) · DELETE(끄기) `…/teamspaces/[teamspaceId]/default` (7c-11조각 · F-06-04)
 *
 * 켜면 워크스페이스의 활성 owner · membership_admin · member 전원이 멤버로 들어오고, 이후 가입자도 저절로 들어온다. 끄면
 * 앞으로의 자동 추가만 멈춘다(`setDefaultTeamspace` 머리말). 워크스페이스 owner 이면서 그 teamspace 의 owner 만 — 아니면
 * 403, 멤버가 아니면 404. 켠 결과로 몇 명이 들어왔는지 준다(`added`).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { setDefaultTeamspace } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/default'>

async function set(ctx: Ctx, on: boolean): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const done = await setDefaultTeamspace(session.ctx, teamspaceId, on)
  if (!done.ok) return teamspaceFailureResponse(done)
  return Response.json({ ok: true, added: done.value.added })
}

export async function PUT(_request: Request, ctx: Ctx): Promise<Response> {
  return set(ctx, true)
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  return set(ctx, false)
}
