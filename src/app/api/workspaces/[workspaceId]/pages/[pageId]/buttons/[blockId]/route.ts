/**
 * /api/workspaces/[workspaceId]/pages/[pageId]/buttons/[blockId] — 버튼 블록의 액션 (자동화 5e-1 · F-08-06)
 *
 *   GET   — 액션 · 켜짐 · 꺼진 까닭(그 페이지를 볼 수 있으면). 저장한 적이 없으면 `automationId: null` · 액션 없음.
 *   PUT   — `{ "actions": [...] }` 로 통째로 바꾼다(그 페이지의 `edit_content` · 잠기면 409). 일하는 행이 없다 — 값 바꾸기 · 행의 속성 ·
 *           보낼 속성은 400 `invalid_action`(+ `problem` · `index`).
 *   PATCH — `{ "enabled": true | false }` 켜고 끈다(켜면 꺼진 까닭이 지워진다). 문은 PUT 과 같다.
 *
 * 블록은 그 페이지의 본문에 있어야 한다. 판정은 `automation/button-block.ts` 가 한다(정본 §3.10 [보강] 자동화 엔진 ⑰).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  buttonBlockFailureStatus,
  readButtonBlock,
  setButtonBlockActions,
  setButtonBlockEnabled,
  type ButtonBlockResult,
} from '@/lib/automation/button-block'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/buttons/[blockId]'>

function failure(result: Exclude<ButtonBlockResult<unknown>, { ok: true }>): Response {
  const { ok: _ok, ...body } = result
  void _ok
  return Response.json({ ...body, error: result.reason }, { status: buttonBlockFailureStatus(result.reason) })
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const read = await readButtonBlock(session.ctx, pageId, blockId)
  if (!read.ok) return failure(read)
  return Response.json({ ok: true, ...read.value })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const actions = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { actions?: unknown }).actions : undefined
  const saved = await setButtonBlockActions(session.ctx, pageId, blockId, actions)
  if (!saved.ok) return failure(saved)
  return Response.json({ ok: true, ...saved.value })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const enabled = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { enabled?: unknown }).enabled : undefined
  const saved = await setButtonBlockEnabled(session.ctx, pageId, blockId, enabled)
  if (!saved.ok) return failure(saved)
  return Response.json({ ok: true, ...saved.value })
}
