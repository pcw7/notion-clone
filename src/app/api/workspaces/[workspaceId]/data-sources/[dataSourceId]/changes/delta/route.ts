/**
 * 표의 델타 — GET `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/changes/delta?after=&view=&q=` (RT-1조각 · F-05-16 · F-05-06)
 *
 * 정본: 00-canonical-data-model.md §3.7 `data_source_change` · [보강] X-5 의 단계 — 1단계(RT-1)
 *
 * 변경 알림(`…/changes` · SSE)이 `ready` · `changed` 에 커서를 싣는다. 화면은 자기가 가진 커서(`after`)를 들고 여기서 **바뀐 행만** 받는다:
 *
 *   { cursor, reset, behind, schemaChanged, viewChanged, orderChanged, personalChanged,
 *     rows: [{ kind: 'row_upsert', inView, ...표의 다시 읽기와 같은 행 } | { id, kind: 'row_delete', inView: false }] }
 *
 *   personalChanged  **묻는 사람의** 이 뷰 개인 필터 · 정렬이 커서 뒤로 바뀌었다(RT-3 — 다른 탭 · 기기 · 놓친 신호). 화면은 도구줄까지 새로
 *                    그린다
 *
 *   reset   델타를 줄 수 없다(커서 없음 · 이 DB 의 것이 아님 · 24시간 창 밖 · 바뀐 행이 상한 초과) — 처음부터 다시 읽고 `cursor` 부터
 *   behind  더 오래된 쓰기 트랜잭션이 끝나지 않아 그 뒤의 커밋을 아직 줄 수 없다 — 곧 다시 물어라
 *
 * 권한은 변경 알림과 같다(표를 열 수 있다 — "만들기만" 포함 · 못 열면 404) + 뷰를 열 수 있다 + 행마다 행 질의의 술어. 볼 수 없는 행은
 * id 도 싣지 않는다. `q` 는 화면의 뷰 검색어(표의 다시 읽기와 같다 · `inView` 가 그것으로 거른다).
 *
 * 화면의 합치기(RT-2)가 함께 묻는 것:
 *   place=1   뷰에 서는 행마다 `place: { before, after, beyond }`(그 뷰의 차례로 바로 앞 · 바로 뒤 행) + `placed`(줄 수 있었는가)
 *   page=     화면이 "더 보기"로 이어 읽을 커서 — `beyond`(아직 읽지 않은 범위인가)를 그것으로 판정한다
 *   calc=1    바뀐 행이 있으면 `calculations`(열 집계 — 행 읽기의 첫 페이지와 같다)
 *
 * 그룹 화면(보드 · 그룹 표 · 목록 — RT-5)이 함께 묻는 것:
 *   group=1   뷰에 서는 행마다 `group: { key, before, after, beyond }`(그 그룹 안의 이웃) + `groupPlaced` + `groups`(그룹 머리) —
 *             `calc=1` 이면 `groupCalculations`(덩이마다 열 집계)
 *   pages=    `{"그룹 키": "더 보기 커서"}` JSON — 그룹마다 `beyond` 를 판정한다(50개까지 · 넘거나 모양이 틀리면 `groupPlaced: false`)
 *   covers=1  뷰에 서는 바뀐 행의 카드 미리보기(갤러리)
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { MAX_GROUP_PAGES } from '@/lib/database/grouped-delta-merge'
import { readRowDelta } from '@/lib/database/row-delta'
import { readViewerToday } from '@/lib/settings/time-zone-cookie'

/** `pages=` — 그룹 키 → 커서(문자열만 · 상한까지). 없으면 undefined · 틀리면 null. */
function parsePages(raw: string | null): Readonly<Record<string, string>> | null | undefined {
  if (raw === null || raw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (entries.length > MAX_GROUP_PAGES || entries.some(([, v]) => typeof v !== 'string')) return null
    return Object.fromEntries(entries) as Record<string, string>
  } catch {
    return null
  }
}

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/changes/delta'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })
  const params = new URL(request.url).searchParams
  const viewId = params.get('view')
  if (viewId === null || !isUuid(viewId)) return Response.json({ error: 'invalid_value' }, { status: 400 })

  const delta = await readRowDelta(session.ctx, dataSourceId, viewId, params.get('after'), {
    search: params.get('q'),
    // 보는 사람의 오늘(R-1) — 상대 날짜 필터의 `inView` 가 표의 다시 읽기와 같은 날로 거른다
    today: await readViewerToday(),
    place: params.get('place') === '1',
    page: params.get('page'),
    calculations: params.get('calc') === '1',
    group: params.get('group') === '1',
    pages: parsePages(params.get('pages')),
    covers: params.get('covers') === '1',
  })
  if (!delta.ok) return Response.json({ error: delta.reason }, { status: delta.reason === 'forbidden' ? 403 : 404 })
  return Response.json({ ok: true, ...delta.value }, { headers: { 'cache-control': 'no-store' } })
}
