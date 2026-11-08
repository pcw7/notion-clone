/**
 * 행 검증 — PUT(검증 · 다시 검증) · DELETE(해제) `/api/workspaces/[workspaceId]/rows/[rowId]/verification`
 * (검증 속성 VF-1 · F-03-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 VF-1] ③ ④ ⑨ — 검증 칸을 쓰는 유일한 길(일반 칸 쓰기는 받지 않는다).
 *
 * PUT 본문 `{ propertyId, expiresAt }` — `expiresAt` 은 시각 글자(ISO 8601) 또는 null(무기한). 답은 `{ ok, cell }`(만료 여부 포함).
 * DELETE 는 `propertyId` 를 쿼리(`?propertyId=`) 또는 본문으로 받는다.
 *
 *   not_found         404  행이 없거나 볼 수 없다
 *   forbidden         403  볼 수만 있다(`edit_content` 가 없다)
 *   plan_required     403  요금제가 검증을 허락하지 않는다(PUT 만 — 해제는 묻지 않는다)
 *   unknown_property  400  그 표의 검증 속성이 아니다
 *   invalid_value     400  만료가 지난 시각이거나 시각이 아니다
 *   locked            409  행 페이지가 잠겼다
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { unverifyRow, verificationFailureStatus, verifyRow } from '@/lib/database/verification'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]/verification'>

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(rowId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { propertyId?: unknown; expiresAt?: unknown }
  if (typeof body.propertyId !== 'string' || (body.expiresAt !== null && typeof body.expiresAt !== 'string')) {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }

  const done = await verifyRow(session.ctx, rowId, body.propertyId, body.expiresAt)
  if (!done.ok) return Response.json({ error: done.reason }, { status: verificationFailureStatus(done.reason) })
  return Response.json({ ok: true, cell: done.value })
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(rowId)) return Response.json({ error: 'not_found' }, { status: 404 })

  let propertyId = new URL(request.url).searchParams.get('propertyId')
  if (propertyId === null) {
    const parsed = await readJsonBody(request)
    if (parsed.ok && typeof parsed.body === 'object' && parsed.body !== null) {
      const fromBody = (parsed.body as { propertyId?: unknown }).propertyId
      if (typeof fromBody === 'string') propertyId = fromBody
    }
  }
  if (propertyId === null) return Response.json({ error: 'invalid_value' }, { status: 400 })

  const done = await unverifyRow(session.ctx, rowId, propertyId)
  if (!done.ok) return Response.json({ error: done.reason }, { status: verificationFailureStatus(done.reason) })
  return Response.json({ ok: true })
}
