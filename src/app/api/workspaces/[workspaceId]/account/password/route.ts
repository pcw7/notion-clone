/**
 * 내 비밀번호 — PUT(정하기 · 바꾸기) · DELETE(지우기) `/api/workspaces/[workspaceId]/account/password` (잔여 묶음 8i-1a · F-14-03)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 비밀번호 ③ · ④
 *
 * 계정의 것이지만 이 워크스페이스의 세션으로 쓴다 — `SessionContext` 가 그 사람이라는 증명이고, 바꿀 때 폐기하지 않을 "이 세션"을 안다
 * (설정의 계정 범위와 같은 길 · 8g-1).
 *
 *   PUT    { newPassword, currentPassword? }  → { ok, revokedSessions }
 *   DELETE { currentPassword? }               → { ok }
 *
 *   weak_password · current_required  400   입력이 정책 · 문에 맞지 않는다
 *   wrong_password                    403   지금 비밀번호가 틀렸다
 *   no_password · mfa_enabled         409   지금 상태가 허락하지 않는다
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { removePassword, setPassword, type PasswordFailure } from '@/lib/auth/password'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/password'>

const STATUS: Readonly<Record<PasswordFailure, number>> = {
  weak_password: 400,
  current_required: 400,
  wrong_password: 403,
  no_password: 409,
  mfa_enabled: 409,
}

const bodyOf = (parsed: unknown) =>
  (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { newPassword?: unknown; currentPassword?: unknown }

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = bodyOf(parsed.body)

  const result = await setPassword(session.ctx, { newPassword: body.newPassword, currentPassword: body.currentPassword })
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, revokedSessions: result.value.revokedSessions })
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const result = await removePassword(session.ctx, { currentPassword: bodyOf(parsed.body).currentPassword })
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true })
}
