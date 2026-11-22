/**
 * /api/workspaces/[workspaceId]/ai/instructions — 내 AI 지시 (AI-6 · F-10-22)
 *
 *   GET  — `{ ok, instructions: { pageId, title, state: none|ok|unavailable, otherEditors } }`
 *   PUT  — `{ pageId: uuid | null }` 고르기 · 해제(볼 수 있는 살아 있는 페이지만 — 아니면 404)
 *   POST — 새 개인 페이지 "내 AI 지시"(짧은 틀)를 만들어 가리킨다 · 201
 *
 * 그 사람 자신의 설정이다(워크스페이스마다 하나). AI 를 쓸 수 없는 사람(게스트)은 403. 판정은 `lib/ai/chat-store.ts`.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiInstructionsViewFor, createAiInstructionsPage, setAiInstructionsPage, type AiInstructionsResult } from '@/lib/ai/chat-store'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/instructions'>

const STATUS = { forbidden: 403, not_found: 404, invalid_input: 400 } as const

const reply = (result: AiInstructionsResult, created = false) =>
  result.ok
    ? Response.json({ ok: true, instructions: result.value }, { status: created ? 201 : 200 })
    : Response.json({ ok: false, error: result.reason }, { status: STATUS[result.reason] })

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const view = await aiInstructionsViewFor(session.ctx)
  return view === null ? Response.json({ ok: false, error: 'forbidden' }, { status: 403 }) : Response.json({ ok: true, instructions: view })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  if (typeof body !== 'object' || body === null || !('pageId' in body)) return Response.json({ ok: false, error: 'invalid_input' }, { status: 400 })
  return reply(await setAiInstructionsPage(session.ctx, (body as { pageId: unknown }).pageId))
}

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return reply(await createAiInstructionsPage(session.ctx), true)
}
