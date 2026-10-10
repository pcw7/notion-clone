/**
 * /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/actions — 버튼 속성의 액션 (자동화 5a-1 · F-03-15)
 *
 *   GET — 액션 목록(그 표를 볼 수 있으면).
 *   PUT — `{ "actions": [{ "type": "edit_property", "config": { "v": 1, "cells": [{ "propertyId", "value" }] } }] }` 로 통째로 바꾼다.
 *         그 표의 `edit_structure` — 잠긴 데이터베이스면 409. 그 표에 맞지 않으면 400 `invalid_action`(+ `problem` · `index`).
 *   PATCH — `{ "enabled": true | false }` 켜고 끈다(5c-3b — 웹훅이 실패로 멈춘 버튼을 다시 켠다 · 켜면 꺼진 까닭이 지워진다). 문은 PUT 과 같다.
 *
 * 판정은 `automation/button-property.ts` 가 한다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { buttonFailureStatus, readButtonActions, setButtonActions, setButtonEnabled, type ButtonResult } from '@/lib/automation/button-property'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/actions'>

function failure(result: Exclude<ButtonResult<unknown>, { ok: true }>): Response {
  const { ok: _ok, ...body } = result
  void _ok
  return Response.json({ ...body, error: result.reason }, { status: buttonFailureStatus(result.reason) })
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const read = await readButtonActions(session.ctx, dataSourceId, propertyId)
  if (!read.ok) return failure(read)
  return Response.json({ ok: true, ...read.value })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const actions = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { actions?: unknown }).actions : undefined
  const saved = await setButtonActions(session.ctx, dataSourceId, propertyId, actions)
  if (!saved.ok) return failure(saved)
  return Response.json({ ok: true, ...saved.value })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const enabled = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { enabled?: unknown }).enabled : undefined
  const saved = await setButtonEnabled(session.ctx, dataSourceId, propertyId, enabled)
  if (!saved.ok) return failure(saved)
  return Response.json({ ok: true, ...saved.value })
}
