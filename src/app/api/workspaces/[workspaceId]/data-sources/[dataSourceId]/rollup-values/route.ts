/**
 * rollup 칸의 값 — POST `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/rollup-values` (rollup 5c-1조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 / 03-database-core.md F-03-11
 *
 * rollup 은 저장되지 않는다 — 행(`properties_cache`)에 없고, **읽을 때 계산한다.** 화면은 행을 받은 뒤 그 id 들로 이것을
 * **한 번** 부른다(`relation-labels` 와 같은 모양). 읽기인데 POST 인 이유도 같다: id 목록이 길다.
 *
 * 본문: `{ rowIds: string[] }`(최대 500). 답: `{ columns, values }` — `columns` 는 rollup 프로퍼티별 상태(설정이 끊겼는지 ·
 * 적용한 함수 · 대상 타입), `values[rowId][propertyId]` 는 그 칸의 결과와 **볼 수 없어서 뺀 개수**(`hidden`).
 * 결과는 **묻는 사람마다 다르다** — 공유 캐시에 넣지 않는다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { computeRollups } from '@/lib/database/rollup'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/rollup-values'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const rowIds = (parsed.body as { rowIds?: unknown } | null)?.rowIds
  if (!Array.isArray(rowIds)) return Response.json({ error: 'invalid_value' }, { status: 400 })

  const computed = await computeRollups(session.ctx, dataSourceId, rowIds as string[])
  if (!computed.ok) {
    return Response.json({ error: computed.reason }, { status: computed.reason === 'not_found' ? 404 : 400 })
  }
  return Response.json({ ok: true, ...computed.value })
}
