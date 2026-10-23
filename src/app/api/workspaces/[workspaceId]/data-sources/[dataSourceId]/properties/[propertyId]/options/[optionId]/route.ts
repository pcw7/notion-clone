/**
 * 옵션 하나 — GET(쓰는 행 수) · PATCH(이름 · 색) · DELETE
 * `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/options/[optionId]`
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 옵션 고치기 · 지우기 · 03-database-core.md F-03-04 시나리오 4
 *
 * 셀 고르개의 옵션 줄 `···` 가 부른다. 지우기는 그 옵션을 쓰던 셀을 같은 트랜잭션에서 비운다 — 그래서 화면은 먼저 GET 으로 쓰는 행
 * 수를 받아 "N개 행에서 이 값이 빠집니다" 라고 한 번 더 묻는다. 셋 다 스키마를 고칠 수 있는 사람(`edit_structure`)만.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { countOptionUsage, deleteSelectOption, updateSelectOption } from '@/lib/database/property'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/options/[optionId]'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId, optionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const usage = await countOptionUsage(session.ctx, dataSourceId, propertyId, optionId)
  if (!usage.ok) return failureResponse(propertyFailureStatus(usage.reason), usage)
  return Response.json({ ok: true, rows: usage.value.rows })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId, optionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; color?: unknown; group?: unknown }

  // 값 검사는 라이브러리가 한다(`invalid_name` · `invalid_color`).
  // 그룹(10n-20)은 status 옵션만 — 틀린 값 · select 는 라이브러리가 `invalid_group` 으로 거부한다
  const updated = await updateSelectOption(session.ctx, dataSourceId, propertyId, optionId, { name: body.name, color: body.color, group: body.group })
  if (!updated.ok) return failureResponse(propertyFailureStatus(updated.reason), updated)
  return Response.json({ ok: true, option: updated.value.option, schemaVersion: updated.value.schemaVersion })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId, optionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const deleted = await deleteSelectOption(session.ctx, dataSourceId, propertyId, optionId)
  if (!deleted.ok) return failureResponse(propertyFailureStatus(deleted.reason), deleted)
  return Response.json({ ok: true, ...deleted.value })
}
