/**
 * 설정 하나 — PUT `/api/workspaces/[workspaceId]/settings/[key]` (설정 정보구조 8g-1 · F-17-12)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 정보구조 ④
 *
 * 본문 `{ value }`. 무엇이 있고 누가 고치며 값이 맞는가는 레지스트리가 정한다(`settings/settings.ts` `updateSetting`).
 *
 *   not_found      404  모르는 키
 *   forbidden      403  보이지 않거나 고칠 수 없다 — 설정의 키는 코드에 있어 존재를 숨길 것이 없다
 *   invalid_value  400  컨트롤의 규칙에 맞지 않는다
 *
 * 계정 범위(`account.*`)도 이 워크스페이스의 세션으로 바꾼다 — `SessionContext` 가 그 사람이라는 증명이다. 바뀐 값은 모든
 * 워크스페이스에서 같다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { updateSetting, type SettingFailure } from '@/lib/settings/settings'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/settings/[key]'>

const STATUS: Readonly<Record<SettingFailure, number>> = { not_found: 404, forbidden: 403, invalid_value: 400 }

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, key } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { value?: unknown }

  const updated = await updateSetting(session.ctx, key, body.value)
  if (!updated.ok) return Response.json({ error: updated.reason }, { status: STATUS[updated.reason] })
  return Response.json({ ok: true, value: updated.value })
}
