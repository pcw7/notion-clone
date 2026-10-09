/**
 * POST   /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/trash — 휴지통으로 (live → trashed)
 * DELETE /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/trash — 복원 (trashed → live)
 * PUT    /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/trash — 영구 삭제 (trashed → purged)
 *
 * 잔여 묶음 8e-3a (F-04-23). 메서드 배정은 페이지의 휴지통 라우트와 **같다** — 휴지통 창이 종류에 따라 주소만 바꿔 같은 동작을 보낸다
 * (`DELETE` 가 영구 삭제가 아니다 — 되돌릴 수 없는 쪽을 흔한 메서드에 두지 않는다).
 *
 * 응답의 `message` 는 휴지통 창 · 데이터 소스 창이 그대로 보여 준다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  purgeDataSource,
  restoreDataSource,
  trashDataSource,
  type DataSourceFailure,
} from '@/lib/database/data-source'
import { dataSourceFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/trash'>

const MESSAGES: Readonly<Record<DataSourceFailure, string>> = {
  not_found: '데이터 소스를 찾을 수 없습니다. 그사이 바뀌었을 수 있습니다.',
  forbidden: '이 데이터베이스를 고칠 권한이 없습니다.',
  locked: '잠긴 데이터베이스입니다. 잠금을 풀어야 합니다.',
  last_source: '마지막 데이터 소스는 휴지통에 넣을 수 없습니다.',
  invalid_name: '이름을 확인하세요.',
  // 연결된 소스(2l-1) — 휴지통 길에서는 나오지 않지만 사유 표는 빠짐없어야 한다
  invalid_target: '붙일 수 없는 데이터 소스입니다.',
  already_attached: '이미 붙어 있는 데이터 소스입니다.',
  owned_source: '이 데이터베이스의 소스는 떼지 않고 휴지통에 넣습니다.',
}

async function resolve(ctx: Ctx) {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return { ok: false as const, response: session.response }
  if (!isUuid(dataSourceId)) {
    return { ok: false as const, response: Response.json({ error: 'not_found', message: MESSAGES.not_found }, { status: 404 }) }
  }
  return { ok: true as const, session: session.ctx, dataSourceId }
}

function failure(reason: DataSourceFailure): Response {
  return Response.json({ error: reason, message: MESSAGES[reason] }, { status: dataSourceFailureStatus(reason) })
}

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(ctx)
  if (!r.ok) return r.response
  const result = await trashDataSource(r.session, r.dataSourceId)
  if (!result.ok) return failure(result.reason)
  return Response.json({
    ok: true,
    dataSourceId: result.value.dataSourceId,
    trashedRows: result.value.trashedRows,
    purgeAfter: result.value.purgeAfter.toISOString(),
  })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(ctx)
  if (!r.ok) return r.response
  const result = await restoreDataSource(r.session, r.dataSourceId)
  if (!result.ok) return failure(result.reason)
  return Response.json({ ok: true, ...result.value })
}

export async function PUT(_request: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(ctx)
  if (!r.ok) return r.response
  const result = await purgeDataSource(r.session, r.dataSourceId)
  if (!result.ok) return failure(result.reason)
  return Response.json({ ok: true, ...result.value })
}
