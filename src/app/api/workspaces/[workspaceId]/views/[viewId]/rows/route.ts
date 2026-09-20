/**
 * 뷰의 행 — GET/POST `/api/workspaces/[workspaceId]/views/[viewId]/rows`
 *
 * 정본: 00-canonical-data-model.md §3.5 불변식 R1 · 03-database-core.md F-03-17
 *
 * ──────────────────────────────────────────────────────────────────────
 * 필터·정렬을 **요청에서 받지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 *
 * 뷰에 저장된 것을 쓴다. 클라이언트가 AST 를 보내게 두면 같은 링크를 연 두 사람이
 * 다른 행 집합을 보게 되고, F-03-17 이 *"뷰 설정은 공유 상태다"* 라고 한 전제가
 * 깨진다. 필터를 바꾸려면 `PATCH /views/[viewId]` 다 — 그쪽은 `edit_structure` 를
 * 묻는다.
 *
 * 받는 것은 페이지네이션뿐이다: `cursor` · `limit`.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 행 추가도 **뷰의 주소**로 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 행은 data_source 에 속하지만, 노션은 필터가 걸린 뷰에서 행을 추가하면 그 필터를
 * 만족하는 값을 미리 채워 새 행이 화면에서 사라지지 않게 한다. 그 동작은 "어느
 * 뷰에서 만들었는가" 를 알아야 가능하다. 지금은 미리 채우지 않지만, 주소를
 * data_source 로 두면 나중에 그것을 붙일 자리가 없다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { getView } from '@/lib/database/view'
import { queryRows } from '@/lib/database/query'
import { createRow } from '@/lib/database/row'
import { createRowFromTemplate } from '@/lib/database/template'
import {
  failureResponse,
  parseCells,
  rowFailureStatus,
  rowJson,
  templateFailureStatus,
} from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/rows'>

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  // uuid 가 아니면 질의가 pg 형식 오류(500)로 죽는다. "없다"와 구분할 이유가 없다.
  if (!isUuid(viewId)) return notFound()

  const view = await getView(session.ctx, viewId)
  if (!view.ok) {
    return Response.json({ error: view.reason }, { status: view.reason === 'forbidden' ? 403 : 404 })
  }

  const params = new URL(request.url).searchParams
  const rawLimit = Number(params.get('limit'))

  const page = await queryRows(session.ctx, view.value.dataSourceId, {
    filter: view.value.filter,
    sorts: view.value.sorts,
    // 뷰의 `load_limit` 이 기본값이다. 요청이 더 작은 값을 주면 그것을 쓴다 —
    // F-03-17 의 권고("page_size 를 낮추면 빨라진다")와 같은 방향이다.
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : view.value.loadLimit,
    cursor: params.get('cursor'),
  })

  if (!page.ok) {
    return Response.json({ error: page.reason }, { status: page.reason === 'forbidden' ? 403 : 404 })
  }

  return Response.json({
    ok: true,
    // 화면이 컬럼 머리를 그리려면 스키마가 필요하다. 한 번에 준다 —
    // 표를 열 때마다 왕복이 둘이면 첫 화면이 느리다.
    columns: view.value.columns,
    rows: page.value.rows.map(rowJson),
    hasMore: page.value.hasMore,
    nextCursor: page.value.nextCursor,
    complete: page.value.complete,
  })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()

  // 본문은 선택이다 — 빈 행 추가("+ 새로 만들기")가 가장 흔한 요청이다.
  const body = (await request.json().catch(() => ({}))) as { cells?: unknown; templateId?: unknown }
  const cells = parseCells(body?.cells)
  if (cells === null) return Response.json({ error: 'invalid_value' }, { status: 400 })
  if (body?.templateId !== undefined && typeof body.templateId !== 'string') {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }

  const view = await getView(session.ctx, viewId)
  if (!view.ok) {
    return Response.json({ error: view.reason }, { status: view.reason === 'forbidden' ? 403 : 404 })
  }

  // 템플릿을 주면 그 행을 복제한다(F-08-02). 안 주면 빈 행이다 — 같은 주소인 이유는 **같은 동작**이어서다:
  // `New ▾` 의 목록에서 무엇을 고르든 사용자에게는 "여기에 새 항목"이고, 응답도 표가 그대로 끼워 넣는 행 하나다.
  if (typeof body.templateId === 'string') {
    const made = await createRowFromTemplate(session.ctx, view.value.dataSourceId, body.templateId, { cells })
    if (!made.ok) return failureResponse(templateFailureStatus(made.reason), made)
    // 빠진 것은 **말한다**(§3.3-174) — 조용히 성공하면 사용자는 본문에 무엇이 없는지 모른다.
    return Response.json(
      {
        ok: true,
        row: rowJson(made.value.row),
        skippedPages: made.value.skippedPages,
        skippedLinks: made.value.skippedLinks,
      },
      { status: 201 },
    )
  }

  const created = await createRow(session.ctx, view.value.dataSourceId, { cells })
  if (!created.ok) return failureResponse(rowFailureStatus(created.reason), created)
  return Response.json({ ok: true, row: rowJson(created.value) }, { status: 201 })
}
