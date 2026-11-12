/**
 * 공개 표 · 공개 행의 속성 — 게시된 데이터베이스를 읽기 전용으로 (게시 · 공유 6a-2c-1 · F-06-08 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 ⑫ · [보강] 공개 화면 ⑩
 *       마스터 §5.3 *"공개 렌더러는 앱 렌더러와 분리된 읽기 전용 SSR. 내부 조회 함수 재사용 금지"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자기 질의 · 순수 부품만 함께 쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 앱의 행 질의(`queryRows`)는 `SessionContext` 로 권한을 묻는다 — 공개 방문자는 그것이 없다. 이 파일은 판정(`resolvePublicPageIn`)을
 * 지난 뒤 자기 질의로 읽는다. 필터 · 정렬의 SQL 은 순수 컴파일러(`compileFilter` · `compileSorts`)를 앱과 함께 쓴다 — 같은 뷰가 앱과
 * 공개 화면에서 같은 행을 같은 순서로 보인다.
 *
 * **무엇을 보이나** — 그 데이터베이스가 소유한 data source 의 첫 뷰(탭 순서)의 **공유** 필터 · 정렬(개인 것은 방문자에게 없다) ·
 * 보이는 열. 행은 공개 경로가 여는 것만(정본 ③ — `live` · 템플릿 아님 · 막는 모더레이션 없음 · 상속이 끊기지 않음). 처음
 * `PUBLIC_TABLE_MAX_ROWS` 줄까지(넘으면 `truncated`). 하위 항목은 펴지 않고 평평하게 둔다.
 *
 * **열은 값이 행에 있는 타입만** — 제목 · 글 · 숫자 · 선택 · 상태 · 체크박스 · 날짜 · 고유 ID · 검증(배지만 — 검증한 사람 · 시각은 싣지 않는다 · VF-2b). 관계형(대상이 공개인지를 따로 물어야
 * 한다) · 롤업 · 수식(읽을 때 계산 — 보는 사람의 권한이 든다) · 버튼(누를 수 없다)은 그리지 않는다. 수식으로 거르는 뷰는 그 캐시가
 * 낡을 수 있다(공개 경로는 캐시를 채우지 않는다 — 앱에서 누군가 그 표를 열면 채워진다).
 */

import { readTitle } from '../block/page.ts'
import { pageIconOfFormat, type PageIcon } from '../block/page-icon.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import {
  compileFilter,
  compileManualOrder,
  compileSorts,
  formulaTypeKey,
  noViewer,
  ParamBag,
  type FilterNode,
  type SortKey,
} from '../database/filter.ts'
import { toVerificationCell } from '../database/verification-cell.ts'
import type { Tx } from '../db/tx.ts'
import { readGalleryLayout, type GallerySize } from '../database/gallery.ts'
import { cellDays, readCalendarLayout, shiftMonth, type CalendarWeekStart } from '../database/calendar.ts'
import { readTimelineLayout, type TimelineZoom } from '../database/timeline.ts'
import { shiftWindow, type TimelineWindow } from '../database/timeline-geometry.ts'
import { isCalculation, type Calculation, type CalculationResult } from '../database/calculations.ts'
import { readChartLayout, type ChartKind } from '../database/chart.ts'
import { MAX_MAP_PINS, readMapLayout, resolveMapBy, selectPins } from '../database/map.ts'
import type { PublicTarget } from './public-access.ts'
import { boardKeyOf, isBoardGroupType, type BoardSpec } from './public-board.ts'
import { publicFilesValue } from './public-files.ts'
import { publicPlaceValue } from './public-places.ts'
import { buildChartGroups, chartCalculationSupported, chartResultOf, type ChartStatRow, type PublicChartGroup } from './public-chart.ts'
import {
  calendarMonth,
  monthSpan,
  overlapsWindow,
  pickView,
  publicToday,
  PUBLIC_WINDOW_MAX_ROWS,
  timelineWindow,
  type WindowQuery,
} from './public-window.ts'

/** 공개 화면이 그리는 열의 타입 — 값이 행(`properties_cache`)에 있는 것. */
// 만든 · 마지막 편집 **시각**(PT-3)도 그린다 — 값은 행 페이지 블록의 열이라 읽을 때 끼운다(`pick`). **사람 둘(created_by · last_edited_by)은 넣지
// 않는다** — 회원의 신원이다(사람 속성을 그리지 않는 것과 같은 까닭 · [보강 PT-1] ⑦ ⑩)
export const PUBLIC_CELL_TYPES = ['title', 'rich_text', 'number', 'select', 'status', 'multi_select', 'url', 'email', 'phone_number', 'files', 'place', 'created_time', 'last_edited_time', 'checkbox', 'date', 'unique_id', 'verification'] as const
export type PublicCellType = (typeof PUBLIC_CELL_TYPES)[number]

/** 공개 표의 줄 상한 — 넘으면 `truncated`(공개 화면은 페이지를 넘기지 않는다 · v1). */
export const PUBLIC_TABLE_MAX_ROWS = 100

export type PublicOption = { readonly id: string; readonly name: string; readonly color: string }

export type PublicColumn = {
  readonly id: string
  readonly name: string
  readonly type: PublicCellType
  /** 선택 · 상태의 옵션(순서대로). 다른 타입은 빈 배열. */
  readonly options: readonly PublicOption[]
  /** 고유 ID 의 접두사(그 data source 의 것). */
  readonly prefix: string | null
}

export type PublicRow = {
  readonly id: string
  readonly title: readonly RichTextRun[]
  readonly icon: PageIcon | null
  /** 셀 값 — 속성 id → 값(`properties_cache` 그대로 · 보이는 공개 열의 것만). */
  readonly cells: Readonly<Record<string, unknown>>
  readonly uniqueSeq: number | null
  /** 보드의 열 키(`public-board.ts`) — 보드가 아니면 null. 그룹 기준 속성이 안 보이는 열이어도 서버가 정한다. */
  readonly groupKey: string | null
  /** 캘린더 · 타임라인의 날짜(날짜 글자 · 양끝 포함) — 그 모양이 아니면 null. */
  readonly span: { readonly start: string; readonly end: string } | null
  /** 타임라인 막대의 색(옵션 색 이름) — `color_by` 가 없으면 'default'. */
  readonly barColor: string
}

/** 공개 화면이 그리는 모양 — 첫 뷰의 레이아웃 중 그릴 수 있는 것. 나머지(폼 · 못 그리는 보드 · 차트 · 날짜 속성 없는 캘린더)는 표. */
export type PublicLayout = 'table' | 'list' | 'gallery' | 'board' | 'calendar' | 'timeline' | 'chart' | 'map'

/** 지도의 핀(MP-3) — 이름 · 좌표만. 주소는 싣지 않는다(공개 칸은 이름만 · MP-1 ⑤). 행은 모두 공개로 열리는 행이라 말풍선이 늘 행으로 간다. */
export type PublicMapPin = { readonly rowId: string; readonly title: string; readonly name: string; readonly lat: number; readonly lng: number }

/** 지도의 재료(MP-3) — 이때 `rows` 는 비어 있다(그림은 핀에서 나온다). */
export type PublicMap = { readonly pins: readonly PublicMapPin[]; readonly height: number }

/** 차트의 재료(PV-3) — 공개 경로의 자기 집계 결과. 숫자 종류(`number`)는 `groups` 가 비고 `total` 이 값이다. */
export type PublicChart = {
  readonly kind: ChartKind
  readonly dataLabels: boolean
  readonly cumulative: boolean
  /** X축(그룹)의 정렬 — 누적을 그릴 수 있나 가를 때만 쓴다. */
  readonly groupSort: string | null
  /** 살아 있는 Y 계산(없으면 개수) — 숫자 종류의 이름줄에 쓴다. */
  readonly calculation: { readonly function: Calculation; readonly propertyName: string | null } | null
  readonly groups: readonly PublicChartGroup[]
  /** 숫자 종류의 값 — 범위 안의 모든 행에 계산 한 번. 다른 종류는 null. */
  readonly total: CalculationResult | null
}

/** 캘린더 · 타임라인의 창 — 주소의 값(또는 오늘)으로 정한다. `prev` · `next` 는 주소에 실을 값(`?m=` 의 달 · `?from=` 의 날짜). */
export type PublicWindow = {
  readonly kind: 'calendar' | 'timeline'
  readonly from: string
  readonly to: string
  readonly month: string | null
  readonly zoom: TimelineZoom
  readonly weekStart: CalendarWeekStart
  readonly showWeekends: boolean
  readonly prev: string
  readonly next: string
  /** 이전 · 다음 링크를 그리나 — 연 페이지 자신의 표일 때만(본문 안의 인라인 데이터베이스는 주소의 창을 따르지 않는다). */
  readonly nav: boolean
}

/** 보드의 재료 — 그룹 기준의 이름 · 열을 짓는 명세(옵션은 스키마 순서). */
export type PublicBoard = { readonly propertyName: string; readonly spec: BoardSpec }

/** 뷰 탭(PV-4) — 폼 뷰를 뺀 뷰의 탭 차례. `name` 이 비면 화면이 레이아웃 이름으로 채운다. */
export type PublicViewTab = { readonly id: string; readonly name: string; readonly type: string }

export type PublicTable = {
  /** 고른 뷰의 id(PV-4). */
  readonly viewId: string
  /** 뷰 탭(PV-4) — 하나뿐이면 화면이 탭을 그리지 않는다. */
  readonly tabs: readonly PublicViewTab[]
  /** 그리는 모양(실제로 그릴 것 — 보드인데 그룹이 못 그리는 타입이면 'table'). */
  readonly layout: PublicLayout
  /** 뷰에 저장된 레이아웃 그대로(`view.type`). */
  readonly viewType: string
  /** 보드일 때만. */
  readonly board: PublicBoard | null
  /** 차트일 때만(PV-3) — 이때 `rows` 는 비어 있다(그림은 집계에서 나온다). */
  readonly chart: PublicChart | null
  /** 지도일 때만(MP-3) — 이때 `rows` 는 비어 있다. */
  readonly map: PublicMap | null
  /** 갤러리 카드 크기(뷰의 설정 · 갤러리가 아니면 기본값). */
  readonly cardSize: GallerySize
  /** 캘린더 · 타임라인일 때만. */
  readonly window: PublicWindow | null
  readonly viewName: string
  readonly columns: readonly PublicColumn[]
  readonly rows: readonly PublicRow[]
  /** 줄 상한에 걸려 더 있다. */
  readonly truncated: boolean
}

/** 공개 행의 속성 묶음 — 스키마 순서 · 행 레이아웃이 숨긴 것 빼고 · 제목 빼고(제목은 머리다). */
export type PublicRowProperties = {
  readonly columns: readonly PublicColumn[]
  readonly cells: Readonly<Record<string, unknown>>
  readonly uniqueSeq: number | null
}

const PUBLIC_SET: ReadonlySet<string> = new Set(PUBLIC_CELL_TYPES)
const isPublicType = (type: string): type is PublicCellType => PUBLIC_SET.has(type)

type ColumnRow = { property_id: string; name: string; type: string; unique_id_prefix: string | null }

/**
 * 데이터베이스를 여는 공개 화면의 표 — 게시 루트인 데이터베이스(6a-2c-2) · 게시된 페이지 안의 인라인 데이터베이스(I-4b). 연 것이
 * 데이터베이스가 아니면 null. 부르는 쪽이 같은 트랜잭션에서 판정(`resolvePublicPageIn`)을 지났다.
 */
export async function readPublicTableIn(tx: Tx, target: PublicTarget, win: WindowQuery | null = null, chosen: readonly string[] = []): Promise<PublicTable | null> {
  const node = await tx.queryMaybe<{ type: string }>(`SELECT type FROM block WHERE id = $1`, [target.pageId])
  if (node?.type !== 'database') return null
  // 소유한 소스가 없는 그릇(본문 안의 연결된 데이터베이스 — 정본 [보강 L-1] ④)을 직접 열면 빈 표
  return (
    (await publicTableOf(tx, target.pageId, win, chosen)) ?? {
      viewId: '', tabs: [], layout: 'table', viewType: 'table', board: null, chart: null, map: null, cardSize: 'medium', window: null, viewName: '', columns: [], rows: [], truncated: false,
    }
  )
}

/**
 * 데이터베이스 하나의 공개 표. 부르는 쪽이 그 데이터베이스가 열린다는 것을 같은 트랜잭션에서 확인했다(`resolvePublicPageIn` ·
 * `openablePagesIn` — 공개 본문의 인라인 데이터베이스 · I-4b). 이 함수는 판정을 다시 하지 않고 **행마다의 공개 조건**만 건다.
 *
 * `win` — 연 페이지 자신의 표일 때 주소의 창 값(PV-2). 없으면(인라인) 오늘이 든 창이고 이전 · 다음 링크가 없다.
 * `chosen` — 주소의 `?v=` 전부(PV-4). 이 데이터베이스의 탭이 아닌 값은 무시한다.
 */
export async function publicTableOf(tx: Tx, databaseId: string, win: WindowQuery | null = null, chosen: readonly string[] = []): Promise<PublicTable | null> {

  // 소유한 data source 의 뷰들(탭 순서) — 붙인 소스(linked)는 다른 데이터베이스의 행이다(그 데이터베이스는 게시되지 않았다)
  const views = await tx.query<{
    id: string
    name: string | null
    type: string
    data_source_id: string
    filter: unknown
    sorts: unknown
    group_by: unknown
    configuration: unknown
  }>(
    `SELECT v.id, v.name, v.type::text AS type, v.data_source_id, v.filter, v.sorts, v.group_by, v.configuration
       FROM view v
       JOIN data_source ds ON ds.id = v.data_source_id
      WHERE v.database_id = $1 AND v.owner_kind = 'database_view' AND ds.owner_database_id = $1 AND ds.lifecycle = 'live'
      ORDER BY v.order_idx, v.id`,
    [databaseId],
  )
  // 소유한 살아 있는 소스가 없다(붙인 소스만 가진 그릇 · 정본 [보강 L-1] ④) — 그릴 공개 표가 없다
  if (views.length === 0) return null
  // 탭(PV-4) — 폼 뷰는 뺀다(자기 공개 링크가 있다). 주소의 `?v=` 중 이 데이터베이스의 탭인 첫 값이 뷰 · 없으면 첫 탭(탭이 없으면 첫 뷰 — 폼은 표로)
  const tabs: PublicViewTab[] = views.filter((v) => v.type !== 'form').map((v) => ({ id: v.id, name: v.name ?? '', type: v.type }))
  const pickedId = pickView(chosen, tabs.map((t) => t.id))
  const view = views.find((v) => v.id === (pickedId ?? tabs[0]?.id)) ?? views[0]!
  const head = { viewId: view.id, tabs }

  const columns = await publicColumns(
    tx,
    await tx.query<ColumnRow>(
      `SELECT vp.property_id, p.name, p.type::text AS type, ds.unique_id_prefix
         FROM view_property vp
         JOIN property p ON p.id = vp.property_id
         JOIN data_source ds ON ds.id = p.data_source_id
        WHERE vp.view_id = $1 AND vp.visible AND p.deleted_at IS NULL
        ORDER BY vp.order_idx, vp.property_id`,
      [view.id],
    ),
  )

  const types = await propertyTypes(tx, view.data_source_id)
  // 차트(PV-3) — 그릴 수 있으면 행 대신 자기 집계. 아니면(null) 아래의 표로
  const chart = await readChart(tx, view, types)
  if (chart !== null) {
    return {
      ...head, layout: 'chart', viewType: view.type, board: null, chart, map: null, cardSize: 'medium', window: null, viewName: view.name ?? '',
      columns: [], rows: [], truncated: false,
    }
  }
  // 지도(MP-3) — 장소 속성이 있으면 자기 질의의 핀. 없으면(null) 아래의 표로
  const mapped = await readMap(tx, view, types, columns)
  if (mapped !== null) {
    return {
      ...head, layout: 'map', viewType: view.type, board: null, chart: null, map: mapped.map, cardSize: 'medium', window: null, viewName: view.name ?? '',
      columns: [], rows: [], truncated: mapped.truncated,
    }
  }
  // `$1` 은 data source — 2번부터 발급한다
  const params = new ParamBag(2)
  // 공개 화면은 보는 사람이 없다 — "나"(6g-2c)는 아무도 아니다(포함은 0행 · 포함하지 않음은 모든 행)
  // 보는 사람이 없다(익명) — 오늘도 UTC 의 것(R-1 · 쿠키를 읽으면 같은 게시 페이지가 보는 사람마다 달라진다)
  const filterSql = compileFilter((view.filter as FilterNode | null) ?? null, types, params, noViewer())
  const byKeys = compileSorts(Array.isArray(view.sorts) ? (view.sorts as SortKey[]) : [], types, params)
  // 정렬이 없으면 그 뷰의 수동 순서(10n-59 — 편집 화면과 같은 차례)
  const sorted = byKeys.keys.length === 0 ? compileManualOrder(params.bind(view.id)) : byKeys
  // 캘린더 · 타임라인(PV-2) — 날짜 속성이 살아 있는 날짜 속성일 때만. 아니면 표(viewType 은 그대로)
  const dated = await readDatedWindow(tx, view, types, win)
  const cap = dated === null ? PUBLIC_TABLE_MAX_ROWS : PUBLIC_WINDOW_MAX_ROWS
  const limit = params.bind(cap + 1)
  // 창에 걸친 행만 — 앱(`queryWindow`)과 같은 규칙: 시작 < 끝날 + 1 이고 coalesce(끝, 시작) ≥ 첫날 − 1(양끝을 하루씩 넓힌다 ·
  // 시각이 있는 값은 시간대에 따라 UTC 날짜가 하루 어긋난다 — 칸에 놓는 것은 아래에서 칸 값의 날짜 글자로 다시 가른다)
  let joinSql = ''
  let windowSql = ''
  let orderBy = sorted.orderBy
  if (dated !== null) {
    const dateParam = params.bind(dated.datePropertyId)
    const fromParam = params.bind(dated.window.from)
    const toParam = params.bind(dated.window.to)
    joinSql = `JOIN page_property_value dv ON dv.page_id = p.id AND dv.property_id = ${dateParam} AND dv.date_start IS NOT NULL`
    windowSql = ` AND dv.date_start < ((${toParam}::date + 2)::timestamp AT TIME ZONE 'UTC')
        AND coalesce(dv.date_end, dv.date_start) >= ((${fromParam}::date - 1)::timestamp AT TIME ZONE 'UTC')`
    orderBy = `dv.date_start, ${sorted.orderBy}`
  }
  const rows = await tx.query<{
    id: string
    properties: Record<string, unknown> | null
    format: Record<string, unknown> | null
    properties_cache: Record<string, unknown> | null
    unique_seq: string | null
    created_at: Date
    last_edited_at: Date
  }>(
    `SELECT b.id, b.properties, b.format, p.properties_cache, p.unique_seq, b.created_at, b.last_edited_at
       FROM page p
       JOIN block b ON b.id = p.id
       ${joinSql}
      WHERE p.data_source_id = $1 AND ${OPENABLE_ROW}${filterSql === null ? '' : ` AND ${filterSql}`}${windowSql}
      ORDER BY ${orderBy}
      LIMIT ${limit}`,
    [view.data_source_id, ...params.values],
  )

  const shown = rows.slice(0, cap)
  const board = view.type === 'board' ? await readBoard(tx, view.data_source_id, view.group_by) : null
  const groupId = board === null ? null : (view.group_by as { property_id: string }).property_id
  const layout: PublicLayout = dated !== null ? dated.window.kind : board !== null ? 'board' : view.type === 'list' || view.type === 'gallery' ? view.type : 'table'
  const spanOf = (cache: Record<string, unknown> | null) => (dated === null ? null : cellDays(cache?.[dated.datePropertyId]))
  const colorOf = (cache: Record<string, unknown> | null): string => {
    if (dated === null || dated.colorBy === null) return 'default'
    const v = cache?.[dated.colorBy.propertyId] as { select?: { id?: string } | null; status?: { id?: string } | null } | undefined
    const ref = v?.select ?? v?.status ?? null
    return dated.colorBy.options.find((o) => o.id === ref?.id)?.color ?? 'default'
  }
  const kept = shown
    .map((row) => ({ row, span: spanOf(row.properties_cache) }))
    // 창 밖(넓혀 물은 가장자리) · 칸 값에서 날짜 글자를 못 읽는 행은 뺀다
    .filter(({ span }) => dated === null || (span !== null && overlapsWindow(span.start, span.end, dated.window)))
  return {
    ...head,
    layout,
    viewType: view.type,
    board,
    chart: null,
    map: null,
    cardSize: readGalleryLayout(view.configuration).cover_size,
    window: dated === null ? null : dated.window,
    viewName: view.name ?? '',
    columns,
    rows: kept.map(({ row, span }) => ({
      id: row.id,
      title: readTitle(row.properties),
      icon: pageIconOfFormat(row.format),
      cells: pick(row.properties_cache, columns, row),
      uniqueSeq: row.unique_seq === null ? null : Number(row.unique_seq),
      groupKey: board === null || groupId === null ? null : boardKeyOf(board.spec, row.properties_cache?.[groupId]),
      span,
      barColor: colorOf(row.properties_cache),
    })),
    truncated: rows.length > cap,
  }
}

/**
 * 캘린더 · 타임라인의 창 — 첫 뷰가 그 레이아웃이고 날짜 속성이 살아 있는 날짜 속성일 때. 아니면 null(표로 그린다).
 * 창은 주소의 값(`?m=` · `?from=`)이고 틀리면 오늘이 든 창이다.
 */
async function readDatedWindow(
  tx: Tx,
  view: { type: string; data_source_id: string; configuration: unknown },
  types: ReadonlyMap<string, string>,
  win: WindowQuery | null,
): Promise<{
  datePropertyId: string
  window: PublicWindow
  colorBy: { propertyId: string; options: readonly PublicOption[] } | null
} | null> {
  if (view.type !== 'calendar' && view.type !== 'timeline') return null
  const today = publicToday()
  const nav = win !== null
  if (view.type === 'calendar') {
    const layout = readCalendarLayout(view.configuration)
    if (layout.date_property_id === null || types.get(layout.date_property_id) !== 'date') return null
    const month = calendarMonth(win?.m, today)
    const span = monthSpan(month)
    return {
      datePropertyId: layout.date_property_id,
      window: {
        kind: 'calendar', ...span, month, zoom: 'week', weekStart: layout.week_start, showWeekends: layout.show_weekends,
        prev: shiftMonth(month, -1), next: shiftMonth(month, 1), nav,
      },
      colorBy: null,
    }
  }
  const layout = readTimelineLayout(view.configuration)
  if (layout.date_property_id === null || types.get(layout.date_property_id) !== 'date') return null
  const range: TimelineWindow = timelineWindow(win?.from, layout.zoom, today)
  const colorType = layout.color_by === null ? undefined : types.get(layout.color_by)
  const colorBy =
    layout.color_by !== null && (colorType === 'select' || colorType === 'status')
      ? {
          propertyId: layout.color_by,
          options: await tx.query<PublicOption>(
            `SELECT id, name, color::text AS color FROM select_option WHERE property_id = $1 ORDER BY order_idx, id`,
            [layout.color_by],
          ),
        }
      : null
  return {
    datePropertyId: layout.date_property_id,
    window: {
      kind: 'timeline', from: range.from, to: range.to, month: null, zoom: layout.zoom, weekStart: 'sunday', showWeekends: true,
      prev: shiftWindow(range, layout.zoom, -1).from, next: shiftWindow(range, layout.zoom, 1).from, nav,
    },
    colorBy,
  }
}

/**
 * 지도(MP-3) — 첫 뷰가 지도일 때 **자기 질의**로 핀을 만든다. 행 집합은 표와 같다(공유 필터 · 공개로 열리는 행 · 수동 순서) + "장소 칸이 비지 않음".
 * 장소 칸은 저장된 `map_by` 가 이 뷰의 보이는 장소 열이면 그것, 아니면 첫 장소 열(앱의 `resolveMapBy` 와 같다). 보이는 장소 열이 하나도 없으면
 * null(표 — viewType 은 `map` 그대로). 100개 상한 · 모양이 틀린 값은 건너뛴다(`selectPins`). 주소는 싣지 않는다.
 */
async function readMap(
  tx: Tx,
  view: { id: string; type: string; data_source_id: string; filter: unknown; sorts: unknown; configuration: unknown },
  types: ReadonlyMap<string, string>,
  columns: readonly PublicColumn[],
): Promise<{ map: PublicMap; truncated: boolean } | null> {
  if (view.type !== 'map') return null
  const layout = readMapLayout(view.configuration)
  const mapBy = resolveMapBy(layout.map_by, columns.filter((c) => c.type === 'place').map((c) => c.id))
  if (mapBy === null) return null

  const params = new ParamBag(2)
  const hasValue: FilterNode = { property_id: mapBy, operator: 'is_not_empty' }
  const stored = (view.filter as FilterNode | null) ?? null
  const filterSql = compileFilter(stored === null ? hasValue : { op: 'and', children: [stored, hasValue] }, types, params, noViewer())
  // 처음 100개는 표와 같은 차례로 고른다 — 뷰의 정렬, 없으면 그 뷰의 수동 순서(앱의 지도와 같은 100개)
  const byKeys = compileSorts(Array.isArray(view.sorts) ? (view.sorts as SortKey[]) : [], types, params)
  const sorted = byKeys.keys.length === 0 ? compileManualOrder(params.bind(view.id)) : byKeys
  const limit = params.bind(MAX_MAP_PINS + 1)
  const rows = await tx.query<{ id: string; properties: Record<string, unknown> | null; properties_cache: Record<string, unknown> | null }>(
    `SELECT b.id, b.properties, p.properties_cache
       FROM page p
       JOIN block b ON b.id = p.id
      WHERE p.data_source_id = $1 AND ${OPENABLE_ROW}${filterSql === null ? '' : ` AND ${filterSql}`}
      ORDER BY ${sorted.orderBy}
      LIMIT ${limit}`,
    [view.data_source_id, ...params.values],
  )
  const picked = selectPins(
    rows.map((r) => ({
      id: r.id,
      title: readTitle(r.properties).map((run) => run.plain_text).join(''),
      properties: r.properties_cache ?? {},
    })),
    mapBy,
  )
  return {
    map: { pins: picked.pins.map(({ rowId, title, name, lat, lng }) => ({ rowId, title, name, lat, lng })), height: layout.height },
    truncated: picked.truncated,
  }
}

/**
 * 차트(PV-3) — 첫 뷰가 차트일 때 **자기 집계 질의**(그룹마다 행 수 · 숫자 속성의 통계)로 그린다. 행 집합은 표와 같다(공유 필터 · 공개로 열리는 행 ·
 * 줄 상한은 없다 — 합계는 처음 100줄의 합이 아니다). 그릴 수 없으면 null(표 — viewType 은 `chart` 그대로):
 *   · X축(`group_by`)이 선택 · 상태(옵션 단위) · 체크박스가 아니다 — 날짜 · 숫자 · 글 · 범주는 공개 경로에 버킷 계산을 두지 않는다(보드와 같다)
 *   · Y 계산이 개수 · 숫자 속성의 통계가 아니다(수식 · 롤업 · 다른 타입의 칸 세기 — 값이 행에 없다)
 * 쌓기(`sub_group_by`)는 읽지 않는다 — 막대는 하위 그룹으로 나누지 않은 그룹 합계다. 숫자 종류는 X축을 읽지 않고 모든 행에 계산 한 번.
 */
async function readChart(
  tx: Tx,
  view: { type: string; data_source_id: string; filter: unknown; group_by: unknown; configuration: unknown },
  types: ReadonlyMap<string, string>,
): Promise<PublicChart | null> {
  if (view.type !== 'chart') return null
  const layout = readChartLayout(view.configuration)
  const g = typeof view.group_by === 'object' && view.group_by !== null ? (view.group_by as { calculation?: unknown; sort?: unknown }) : null
  const raw = typeof g?.calculation === 'object' && g.calculation !== null ? (g.calculation as { property_id?: unknown; function?: unknown }) : null
  const calcId = typeof raw?.property_id === 'string' ? raw.property_id : null
  const calcType = calcId === null ? undefined : types.get(calcId)
  // 지운 속성의 계산은 버리고 개수로(앱의 `liveGroupCalculation` 과 같다) — 있는데 못 집계하면 표
  const rawFn = raw?.function
  let fn: Calculation | null = calcId !== null && calcType !== undefined && isCalculation(rawFn) ? rawFn : null
  if (fn !== null && !chartCalculationSupported(fn, calcType)) return null
  // `count_all` 은 속성 없이 행 수 — 통계 열은 숫자 속성일 때만 읽는다
  const numId = fn !== null && calcType === 'number' ? calcId : null
  if (fn === 'count_all') fn = null

  const total = layout.kind === 'number'
  const board = total ? null : await readBoard(tx, view.data_source_id, view.group_by)
  if (!total && board === null) return null
  const groupId = board === null ? null : (view.group_by as { property_id: string }).property_id

  // `$1` 은 data source — 2번부터 발급한다. 보는 사람이 없다(익명) — 표와 같은 필터 컴파일
  const params = new ParamBag(2)
  const filterSql = compileFilter((view.filter as FilterNode | null) ?? null, types, params, noViewer())
  let keySql = `''`
  if (board !== null && groupId !== null) {
    const prop = `${params.bind(groupId)}::text`
    if (board.spec.type === 'checkbox') {
      keySql = `CASE WHEN (p.properties_cache -> ${prop} ->> 'checkbox') = 'true' THEN 'true' ELSE 'false' END`
    } else {
      // 모르는(지운) 옵션은 값 없음 — `boardKeyOf` 와 같다. 형은 허용 목록(select · status)의 상수
      const id = `(p.properties_cache -> ${prop} -> '${board.spec.type}' ->> 'id')`
      keySql = `CASE WHEN ${id} = ANY(${params.bind(board.spec.options.map((o) => o.id))}::text[]) THEN ${id} ELSE '' END`
    }
  }
  const numSql =
    numId === null
      ? `NULL::numeric`
      : (() => {
          const cell = `p.properties_cache -> ${params.bind(numId)}::text`
          return `CASE WHEN jsonb_typeof(${cell} -> 'number') = 'number' THEN (${cell} ->> 'number')::numeric END`
        })()
  const stats = await tx.query<{
    key: string; n: number; filled: number; uniq: number
    sum: number | null; avg: number | null; median: number | null; min: number | null; max: number | null
  }>(
    `SELECT ${total ? `''::text` : 'x.k'} AS key, count(*)::int AS n, count(x.num)::int AS filled, count(DISTINCT x.num)::int AS uniq,
            sum(x.num)::float8 AS sum, avg(x.num)::float8 AS avg, min(x.num)::float8 AS min, max(x.num)::float8 AS max,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY x.num::float8) AS median
       FROM (SELECT ${keySql} AS k, ${numSql} AS num
               FROM page p
               JOIN block b ON b.id = p.id
              WHERE p.data_source_id = $1 AND ${OPENABLE_ROW}${filterSql === null ? '' : ` AND ${filterSql}`}) x
      ${total ? '' : 'GROUP BY x.k'}`,
    [view.data_source_id, ...params.values],
  )
  const rows: ChartStatRow[] = stats.map(({ uniq, ...s }) => ({ ...s, distinct: uniq }))

  const calcName =
    numId === null ? null : ((await tx.queryMaybe<{ name: string }>(`SELECT name FROM property WHERE id = $1`, [numId]))?.name ?? null)
  return {
    kind: layout.kind,
    dataLabels: layout.data_labels,
    cumulative: layout.cumulative,
    groupSort: typeof g?.sort === 'string' ? g.sort : null,
    calculation: fn === null ? null : { function: fn, propertyName: calcName },
    groups: board === null ? [] : buildChartGroups(board.spec, rows, fn),
    total: total ? chartResultOf(fn ?? 'count_all', rows[0] ?? { n: 0, filled: 0, distinct: 0, sum: null, avg: null, median: null, min: null, max: null }) : null,
  }
}

/**
 * 보드의 그룹 기준 — 살아 있는 선택 · 상태(옵션 단위) · 체크박스일 때만. 아니면 null(표로 그린다 — 날짜 · 숫자 · 글 · 범주로 묶은 상태는 공개 경로에
 * 버킷 계산을 두지 않는다 · 정본 [보강 PV-1] ②).
 */
async function readBoard(tx: Tx, dataSourceId: string, raw: unknown): Promise<PublicBoard | null> {
  const g = typeof raw === 'object' && raw !== null ? (raw as { property_id?: unknown; hidden?: unknown; hide_empty?: unknown; status_by?: unknown }) : null
  if (g === null || typeof g.property_id !== 'string' || g.status_by !== undefined) return null
  const prop = await tx.queryMaybe<{ name: string; type: string }>(
    `SELECT name, type::text AS type FROM property WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
    [g.property_id, dataSourceId],
  )
  if (prop === null || !isBoardGroupType(prop.type)) return null
  const options =
    prop.type === 'checkbox'
      ? []
      : await tx.query<{ id: string; name: string; color: string }>(
          `SELECT id, name, color::text AS color FROM select_option WHERE property_id = $1 ORDER BY order_idx, id`,
          [g.property_id],
        )
  return {
    propertyName: prop.name,
    spec: {
      type: prop.type,
      options,
      hidden: Array.isArray(g.hidden) ? g.hidden.filter((k): k is string => typeof k === 'string') : [],
      hideEmpty: g.hide_empty === true,
    },
  }
}

/**
 * 공개로 연 페이지가 데이터베이스의 행이면 그 속성 묶음. 아니면 null. 판정은 부르는 쪽이 지났다(템플릿 · 휴지통의 행은 판정이 이미
 * 닫는다 — `chainOpens`).
 */
export async function readPublicRowPropertiesIn(tx: Tx, target: PublicTarget): Promise<PublicRowProperties | null> {
  const row = await tx.queryMaybe<{
    data_source_id: string
    properties_cache: Record<string, unknown> | null
    unique_seq: string | null
    created_at: Date
    last_edited_at: Date
  }>(
    `SELECT p.data_source_id, p.properties_cache, p.unique_seq, b.created_at, b.last_edited_at FROM page p JOIN block b ON b.id = p.id WHERE p.id = $1`,
    [target.pageId],
  )
  if (row === null) return null
  // 행 레이아웃이 숨긴 속성(8f-2) — 앱의 행 화면과 같다
  const columns = await publicColumns(
    tx,
    await tx.query<ColumnRow>(
      `SELECT p.id AS property_id, p.name, p.type::text AS type, ds.unique_id_prefix
         FROM property p
         JOIN data_source ds ON ds.id = p.data_source_id
        WHERE p.data_source_id = $1 AND p.deleted_at IS NULL AND p.type::text <> 'title'
          AND NOT EXISTS (SELECT 1 FROM layout_module m JOIN layout_tab t ON t.id = m.tab_id AND t.kind = 'content'
                           WHERE m.data_source_id = p.data_source_id AND m.kind = 'property' AND m.property_id = p.id AND m.visible = false)
        ORDER BY p.order_idx, p.id`,
      [row.data_source_id],
    ),
  )
  return { columns, cells: pick(row.properties_cache, columns, row), uniqueSeq: row.unique_seq === null ? null : Number(row.unique_seq) }
}

/**
 * 공개 경로가 여는 행 — 정본 [정정] 웹 게시 ③ 의 사슬 조건을 행 하나에 건 것(데이터베이스 루트의 조건은 판정이 이미 봤다). `chainOpens` 와
 * 같은 답이어야 한다 — 표에 선 행을 누르면 열려야 하고, 열리지 않는 행이 표에 서면 안 된다.
 */
const OPENABLE_ROW = `p.is_template = false
        AND b.lifecycle = 'live'
        AND b.moderation_state NOT IN ('restricted', 'taken_down')
        AND NOT EXISTS (SELECT 1 FROM block_acl_meta m WHERE m.node_id = b.id AND m.inherits_from_parent = false)`

/** 공개 타입의 열만 · 선택 · 상태의 옵션을 붙여. */
async function publicColumns(tx: Tx, rows: readonly ColumnRow[]): Promise<PublicColumn[]> {
  const kept = rows.filter((r) => isPublicType(r.type))
  const optionIds = kept.filter((r) => r.type === 'select' || r.type === 'status' || r.type === 'multi_select').map((r) => r.property_id)
  const options =
    optionIds.length === 0
      ? []
      : await tx.query<{ property_id: string; id: string; name: string; color: string }>(
          `SELECT property_id, id, name, color::text AS color FROM select_option WHERE property_id = ANY($1::text[]) ORDER BY property_id, order_idx, id`,
          [optionIds],
        )
  return kept.map((r) => ({
    id: r.property_id,
    name: r.name,
    type: r.type as PublicCellType,
    options: options.filter((o) => o.property_id === r.property_id).map((o) => ({ id: o.id, name: o.name, color: o.color })),
    prefix: r.type === 'unique_id' ? r.unique_id_prefix : null,
  }))
}

/** 필터 · 정렬 컴파일러의 입력 — 속성 id → 타입(수식은 결과 타입과 함께 · 앱의 `readPropertyTypes` 와 같은 모양). */
async function propertyTypes(tx: Tx, dataSourceId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await tx.query<{ id: string; type: string; result_type: string | null }>(
    `SELECT id, type::text AS type, config ->> 'result_type' AS result_type FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`,
    [dataSourceId],
  )
  return new Map(rows.map((r) => [r.id, r.type === 'formula' ? formulaTypeKey(r.result_type ?? '') : r.type]))
}

/** 행 페이지 블록의 시각 — 만든 · 마지막 편집 시각 열이 읽는다(PT-3). */
type RowTimes = { readonly created_at: Date; readonly last_edited_at: Date }

/** 보이는 공개 열의 값만 — 캐시의 다른 칸(숨긴 열 · 그리지 않는 타입)은 싣지 않는다. */
function pick(cache: Record<string, unknown> | null, columns: readonly PublicColumn[], times: RowTimes): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) {
    // 만든 · 마지막 편집 시각(PT-3) — 칸이 없다. 행 페이지 블록의 열을 ISO 로 끼운다
    if (column.type === 'created_time' || column.type === 'last_edited_time') {
      const at = column.type === 'created_time' ? times.created_at : times.last_edited_at
      out[column.id] = { type: column.type, [column.type]: at.toISOString() }
      continue
    }
    const value = cache?.[column.id]
    if (value === undefined) continue
    // 검증 — 배지에 필요한 것만(상태 · 만료 시각 · 만료 여부). 검증한 사람 · 시각은 공개 방문자에게 가지 않는다(회원의 신원)
    if (column.type === 'verification') {
      const cell = toVerificationCell(value, new Date())
      if (cell !== null) out[column.id] = { type: 'verification', state: cell.state, expires_at: cell.expires_at, expired: cell.expired }
      continue
    }
    // 파일과 미디어(PT-4) — 이름만. 파일 id 는 싣지 않는다(공개 파일 길은 블록 단위라 칸의 파일은 열 수 없다)
    if (column.type === 'files') {
      out[column.id] = publicFilesValue(value)
      continue
    }
    // 장소(MP-1) — 이름만. 주소 · 좌표는 싣지 않는다
    if (column.type === 'place') {
      out[column.id] = publicPlaceValue(value)
      continue
    }
    out[column.id] = value
  }
  return out
}
