/**
 * 종속 관계 켜기 · 끄기 — POST · DELETE `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/dependencies` (2b-3조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 종속 관계 / 03-database-core.md F-03-18
 *
 * 켜면 같은 표를 가리키는 relation 짝("선행 작업" · "후행 작업")이 생기고, 끄면 그 짝이 일반 relation 으로 남는다. 둘 다 **두 번
 * 불러도 같은 결과**다(이미 켜져 있으면 그 짝을 돌려준다). 권한은 스키마를 고치는 것이다(`edit_structure`).
 * 본문(선택): `{ expectedVersion }`.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { disableDependencies, enableDependencies } from '@/lib/database/dependencies'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/dependencies'>

/** 본문은 선택이다 — 비었으면 버전 검사 없이, 있으면 `{ expectedVersion }` 을 읽는다. JSON 이 아니면 400. */
async function expectedVersionOf(request: Request): Promise<{ ok: true; value: string | undefined } | { ok: false; response: Response }> {
  const text = await request.text()
  if (text.trim() === '') return { ok: true, value: undefined }
  try {
    const body = JSON.parse(text) as { expectedVersion?: unknown } | null
    return { ok: true, value: typeof body?.expectedVersion === 'string' ? body.expectedVersion : undefined }
  } catch {
    return { ok: false, response: Response.json({ error: 'invalid_body' }, { status: 400 }) }
  }
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const version = await expectedVersionOf(request)
  if (!version.ok) return version.response
  const enabled = await enableDependencies(session.ctx, dataSourceId, version.value === undefined ? {} : { expectedVersion: version.value })
  if (!enabled.ok) return failureResponse(propertyFailureStatus(enabled.reason), enabled)
  const { schema, blockedByPropertyId, blockingPropertyId } = enabled.value
  return Response.json({ ok: true, schema, blockedByPropertyId, blockingPropertyId })
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const version = await expectedVersionOf(request)
  if (!version.ok) return version.response
  const disabled = await disableDependencies(session.ctx, dataSourceId, version.value === undefined ? {} : { expectedVersion: version.value })
  if (!disabled.ok) return failureResponse(propertyFailureStatus(disabled.reason), disabled)
  return Response.json({ ok: true, schema: disabled.value })
}
