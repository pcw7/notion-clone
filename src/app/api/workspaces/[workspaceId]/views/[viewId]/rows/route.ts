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
 * 받는 것은 페이지네이션뿐이다: `cursor` · `limit`. 그리고 **뷰 검색어** `q`(2e-1 · F-04-27) — 필터와 AND 로 붙는 임시 조건이고 뷰에
 * 저장하지 않는다(04 *"검색은 임시 상태"*). 공유 상태(필터)를 바꾸지 않으므로 위의 원칙과 부딪히지 않는다. 검색 중에는 하위 항목
 * 트리를 펴지 않고 **맞는 행을 평평하게** 준다 — 자식만 맞으면 트리로는 보일 자리가 없다(04 F-04-27 의 중첩 엣지 · §7).
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
import { nestsSubItems, showsParentsOnly, subItemPairOf } from '@/lib/database/view-columns'
import { queryRows } from '@/lib/database/query'
import { computeCalculations } from '@/lib/database/calculate'
import { normalizeSearch } from '@/lib/database/search'
import { readCardCovers } from '@/lib/database/gallery-covers'
import { createRow } from '@/lib/database/row'
import { createRowFromTemplate } from '@/lib/database/template'
import { createSubItem } from '@/lib/database/sub-item-rows'
import {
  failureResponse,
  parseCells,
  relationFailureStatus,
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

  // 하위 항목이 켜진 표 · 목록은 트리로 읽는다(2b-2) — `parent` 가 없으면 최상위 행, 있으면 그 행의 자식. 트리가 아닌 뷰에
  // `parent` 를 주면 거부한다(조용히 모든 행을 주면 화면이 자식 자리에 표 전체를 끼운다).
  const parent = params.get('parent')
  if (parent !== null && !isUuid(parent)) return Response.json({ error: 'invalid_value' }, { status: 400 })
  const search = normalizeSearch(params.get('q'))
  const pair = nestsSubItems(view.value.type) && search === null ? subItemPairOf(view.value.columns) : null
  if (parent !== null && pair === null) return Response.json({ error: 'invalid_value' }, { status: 400 })
  // 갤러리는 부모만(2f-1) — 트리를 펴지 않고 최상위 행만 읽는다. 검색 중에도 그렇다.
  const parentsOnly = showsParentsOnly(view.value.type) ? subItemPairOf(view.value.columns) : null

  const page = await queryRows(session.ctx, view.value.dataSourceId, {
    filter: view.value.filter,
    sorts: view.value.sorts,
    // 뷰의 `load_limit` 이 기본값이다. 요청이 더 작은 값을 주면 그것을 쓴다 —
    // F-03-17 의 권고("page_size 를 낮추면 빨라진다")와 같은 방향이다.
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : view.value.loadLimit,
    cursor: params.get('cursor'),
    ...(pair === null ? {} : { tree: { parentPropertyId: pair.parentPropertyId, under: parent } }),
    ...(parentsOnly === null ? {} : { tree: { parentPropertyId: parentsOnly.parentPropertyId, under: null } }),
    search,
  })

  if (!page.ok) {
    return Response.json({ error: page.reason }, { status: page.reason === 'forbidden' ? 403 : 404 })
  }

  // 열 집계(2d-1 · F-04-16) — 첫 페이지에만 함께 싣는다(04 *"행 쿼리 응답에 aggregates 를 함께 담아 1회 왕복"*). 다음 페이지 · 자식 행
  // 읽기에는 다시 계산하지 않는다 — 대상은 필터를 지난 행 전부라 페이지마다 같다.
  const first = params.get('cursor') === null && parent === null
  const calculations = first
    ? await computeCalculations(session.ctx, view.value.dataSourceId, view.value.filter, view.value.columns, search)
    : undefined

  // 갤러리의 카드 미리보기(2f-2) — 이 페이지의 행마다 본문의 첫 이미지. 미리보기를 끈 갤러리 · 다른 뷰에는 싣지 않는다.
  const covers =
    view.value.type === 'gallery' && view.value.gallery.cover === 'page_content'
      ? await readCardCovers(session.ctx, page.value.rows.map((r) => r.id))
      : undefined

  return Response.json({
    ...(calculations === undefined ? {} : { calculations }),
    ...(covers === undefined ? {} : { covers }),
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
  const body = (await request.json().catch(() => ({}))) as { cells?: unknown; templateId?: unknown; parent?: unknown }
  const cells = parseCells(body?.cells)
  if (cells === null) return Response.json({ error: 'invalid_value' }, { status: 400 })
  if (body?.templateId !== undefined && typeof body.templateId !== 'string') {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }
  // `parent` — 그 행 밑에 하위 항목으로 만든다(2b-2b). 템플릿과 함께는 받지 않는다(템플릿으로 하위 항목 만들기는 아직 없다 · §7).
  if (body?.parent !== undefined && (typeof body.parent !== 'string' || body.templateId !== undefined)) {
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

  if (typeof body.parent === 'string') {
    const child = await createSubItem(session.ctx, view.value.dataSourceId, body.parent, { cells })
    if (!child.ok) return failureResponse(relationFailureStatus(child.reason), child)
    return Response.json({ ok: true, row: rowJson(child.value) }, { status: 201 })
  }

  const created = await createRow(session.ctx, view.value.dataSourceId, { cells })
  if (!created.ok) return failureResponse(rowFailureStatus(created.reason), created)
  return Response.json({ ok: true, row: rowJson(created.value) }, { status: 201 })
}
