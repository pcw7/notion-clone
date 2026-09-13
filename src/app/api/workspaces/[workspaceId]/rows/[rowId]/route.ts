/**
 * 행 하나 — PATCH(셀 쓰기) · DELETE(휴지통) `/api/workspaces/[workspaceId]/rows/[rowId]`
 *
 * 정본: 00-canonical-data-model.md §3.5 · 판결 C-3 · X-4(셀은 CRDT 밖)
 *       03-database-core.md F-03-16
 *
 * 주소에 표(data_source)가 없다. 행 id 가 곧 블록 id 이고(C-3) 어느 표의 행인지는
 * `page.data_source_id` 가 안다 — 주소에 표를 넣으면 "주소의 표"와 "실제 표"가
 * 다른 요청이 가능해지고, 서버는 그 둘 중 무엇을 믿을지 정해야 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 셀 여러 개를 한 요청으로 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 붙여넣기(F-03-16 P1)가 한 행의 셀 여러 개를 한꺼번에 채우고, 그것이 한
 * 트랜잭션이어야 반쯤 붙은 행이 남지 않는다. 불변식 V1("단일 행 UPDATE")과
 * 충돌하지 않는다 — V1 은 **뷰 설정 배열**의 LWW 이야기이고, 셀은
 * `(page_id, property_id)` 행마다 따로 upsert 되므로 두 사람이 다른 셀을 고친
 * 것이 서로를 지우지 않는다.
 *
 * `expectedVersion` 을 생략하면 LWW 다(F-03-16: "셀 단위 잠금 없이 LWW").
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { trashRow, updateCells } from '@/lib/database/row'
import {
  failureResponse,
  parseCells,
  rowFailureStatus,
  rowJson,
} from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(rowId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { cells?: unknown; expectedVersion?: unknown }

  const cells = parseCells(body.cells)
  // 고칠 셀이 없는 요청은 400 이다. 조용히 200 을 주면 클라이언트가 "보냈는데 안
  // 먹었다"를 성공으로 읽는다(컬럼 라우트와 같은 규칙).
  if (cells === null || cells.length === 0) {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }
  if (body.expectedVersion !== undefined && typeof body.expectedVersion !== 'string') {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }

  const updated = await updateCells(session.ctx, rowId, {
    cells,
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!updated.ok) return failureResponse(rowFailureStatus(updated.reason), updated)
  return Response.json({ ok: true, row: rowJson(updated.value) })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(rowId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const removed = await trashRow(session.ctx, rowId)
  if (!removed.ok) return failureResponse(rowFailureStatus(removed.reason), removed)
  return Response.json({ ok: true })
}
