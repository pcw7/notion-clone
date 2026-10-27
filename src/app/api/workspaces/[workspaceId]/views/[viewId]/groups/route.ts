/**
 * 보드의 그룹 — GET/POST `/api/workspaces/[workspaceId]/views/[viewId]/groups` (보드 4a조각)
 *
 * 정본: 00-canonical-data-model.md §3.6 · 04-database-views.md F-04-11 · F-04-03
 *
 *   GET                       그룹 전부(카운트 · 숨김) + 보이는 그룹의 첫 페이지 행
 *   GET ?group=<key>&cursor=  한 그룹의 다음 페이지 — 그룹별 독립 커서(F-04-15). 하위 그룹이 있는 보드면 `sub=<가로줄 키>` 로 그 칸(B-4a). 첫 페이지(커서 없음)는 표 뷰면 그 그룹의 열 집계를
 *                             함께 싣는다(`calculations` — 덩이의 집계 줄 · G-2d · 평평한 표의 행 라우트와 같은 모양). 갤러리면 그 페이지
 *                             카드의 미리보기를 싣는다(`covers` — 본문의 첫 이미지일 때 · G-3a)
 *   GET ?calculations=1       그룹 머리의 계산만(2d-3 · F-04-16) — 카드를 옮기거나 만든 뒤. 행은 읽지 않는다
 *
 *   셋 다 `q`(뷰 검색어 · 2e-1 · F-04-27)를 받는다 — 카드 · 개수 · 머리 값이 같이 좁혀진다. 뷰에 저장하지 않는다.
 *   POST { action: 'move', rowId, groupKey, beforeRowId?, within? }
 *                             카드 이동. 셀 값 + 열 안 자리를 **한 트랜잭션**으로(마스터 문서 §5.2 4번). `within` 이면 덩이 안의
 *                             차례만(표의 그룹 G-2b) — 그 행이 지금 그 그룹이 아니면 셀을 쓰지 않고 not_found
 *
 * `rows` 라우트처럼 필터 · 정렬 · 그룹은 요청에서 받지 않는다 — 뷰에 저장된 것을 쓴다. 그룹을 바꾸는 것은
 * `PATCH /views/[viewId]` 의 `groupBy` 이고 그쪽은 `edit_structure` 를 묻는다. 이동은 `edit_content` 다
 * (F-04-03: 카드 드래그 = 데이터 편집).
 *
 * `group` 이 있으면 `''` 도 유효한 키다("No X" 그룹) — `searchParams.get` 이 빈 문자열을 그대로 준다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { moveRow, queryGroupCalculations, queryGroupColumnCalculations, queryGroupRows, queryGroups } from '@/lib/database/group'
import { getView } from '@/lib/database/view'
import { readCardCovers } from '@/lib/database/gallery-covers'
import { readViewerToday } from '@/lib/settings/time-zone-cookie'
import { failureResponse, groupFailureStatus, rowJson } from '@/lib/database/http'
import { normalizeSearch } from '@/lib/database/search'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/groups'>

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })
const invalid = () => Response.json({ error: 'invalid_value' }, { status: 400 })

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()

  const params = new URL(request.url).searchParams
  const group = params.get('group')
  const search = normalizeSearch(params.get('q'))
  // 상대 날짜 그룹(B-3)의 오늘 — 보는 사람의 시간대(쿠키)
  const today = await readViewerToday()

  if (params.get('calculations') === '1') {
    const calculated = await queryGroupCalculations(session.ctx, viewId, { search, today })
    if (!calculated.ok) return failureResponse(groupFailureStatus(calculated.reason), calculated)
    return Response.json({ ok: true, calculation: calculated.value.calculation, values: calculated.value.values })
  }

  if (group !== null) {
    const rawLimit = Number(params.get('limit'))
    const page = await queryGroupRows(session.ctx, viewId, group, {
      cursor: params.get('cursor'),
      ...(Number.isFinite(rawLimit) && rawLimit > 0 ? { limit: rawLimit } : {}),
      search,
      today,
      // 하위 그룹(B-4a)의 칸 — `sub` 가 있으면 그 가로줄만(`''` 도 키다)
      ...(params.get('sub') !== null ? { subKey: params.get('sub') ?? '' } : {}),
    })
    if (!page.ok) return failureResponse(groupFailureStatus(page.reason), page)
    // 뷰의 모양에 따라 함께 싣는 것 — 표면 첫 페이지에 덩이의 열 집계(G-2d · 대상은 그 그룹의 행 전부라 페이지마다 같다) · 갤러리면 그
    // 페이지 카드의 미리보기(G-3a ②). 목록 · 보드는 싣지 않는다
    const view = await getView(session.ctx, viewId)
    let calculations: Readonly<Record<string, unknown>> | undefined
    if (view.ok && view.value.type === 'table' && params.get('cursor') === null) {
      const calculated = await queryGroupColumnCalculations(session.ctx, viewId, view.value.columns, { search, groupKey: group, today })
      if (calculated.ok) calculations = calculated.value[group] ?? {}
    }
    const covers =
      view.ok && view.value.type === 'gallery' && view.value.gallery.cover === 'page_content'
        ? await readCardCovers(session.ctx, page.value.rows.map((r) => r.id))
        : undefined
    return Response.json({
      ok: true,
      rows: page.value.rows.map(rowJson),
      hasMore: page.value.hasMore,
      nextCursor: page.value.nextCursor,
      ...(calculations === undefined ? {} : { calculations }),
      ...(covers === undefined ? {} : { covers }),
    })
  }

  const groups = await queryGroups(session.ctx, viewId, { search, today })
  if (!groups.ok) return failureResponse(groupFailureStatus(groups.reason), groups)
  const { value } = groups
  return Response.json({
    ok: true,
    propertyId: value.propertyId,
    propertyType: value.propertyType,
    manualOrder: value.manualOrder,
    calculation: value.calculation,
    statusBy: value.statusBy,
    groups: value.groups.map((g) => ({ ...g, rows: g.rows.map(rowJson) })),
  })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as {
    action?: unknown
    rowId?: unknown
    groupKey?: unknown
    beforeRowId?: unknown
    search?: unknown
    within?: unknown
    subGroupKey?: unknown
  }
  if (body.action !== 'move') return invalid()
  if (typeof body.rowId !== 'string' || !isUuid(body.rowId)) return invalid()
  if (typeof body.groupKey !== 'string') return invalid()
  if (body.subGroupKey !== undefined && typeof body.subGroupKey !== 'string') return invalid()
  if (body.beforeRowId !== undefined && body.beforeRowId !== null) {
    if (typeof body.beforeRowId !== 'string' || !isUuid(body.beforeRowId)) return invalid()
  }

  const moved = await moveRow(session.ctx, viewId, {
    rowId: body.rowId,
    groupKey: body.groupKey,
    beforeRowId: (body.beforeRowId as string | null | undefined) ?? null,
    // 화면이 쓰는 뷰 검색어(10n-15) — "아직 이 보드에 서는가" 에만 쓰인다. 문자열이 아니면 없는 것으로
    search: typeof body.search === 'string' ? body.search : null,
    // 참일 때만 — 보드는 보내지 않는다(다른 열로 옮기는 것이 셀을 바꾸는 일이다)
    within: body.within === true,
    // 하위 그룹(B-4a) — 놓을 가로줄. 주지 않으면 그 행의 지금 가로줄에 남는다
    ...(typeof body.subGroupKey === 'string' ? { subGroupKey: body.subGroupKey } : {}),
    // 상대 날짜 그룹(B-3)의 오늘 — 보는 사람의 시간대(쿠키)
    today: await readViewerToday(),
  })
  if (!moved.ok) return failureResponse(groupFailureStatus(moved.reason), moved)
  return Response.json({
    ok: true,
    row: rowJson(moved.value.row),
    groupKey: moved.value.groupKey,
    subGroupKey: moved.value.subGroupKey,
    positioned: moved.value.positioned,
    inView: moved.value.inView,
  })
}
