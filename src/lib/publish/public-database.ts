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
import type { PublicTarget } from './public-access.ts'
import { boardKeyOf, isBoardGroupType, type BoardSpec } from './public-board.ts'
import {
  calendarMonth,
  monthSpan,
  overlapsWindow,
  publicToday,
  PUBLIC_WINDOW_MAX_ROWS,
  timelineWindow,
  type WindowQuery,
} from './public-window.ts'

/** 공개 화면이 그리는 열의 타입 — 값이 행(`properties_cache`)에 있는 것. */
export const PUBLIC_CELL_TYPES = ['title', 'rich_text', 'number', 'select', 'status', 'checkbox', 'date', 'unique_id', 'verification'] as const
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

/** 공개 화면이 그리는 모양 — 첫 뷰의 레이아웃 중 그릴 수 있는 것. 나머지(차트 · 폼 · 못 그리는 보드 · 날짜 속성 없는 캘린더)는 표. */
export type PublicLayout = 'table' | 'list' | 'gallery' | 'board' | 'calendar' | 'timeline'

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

export type PublicTable = {
  /** 그리는 모양(실제로 그릴 것 — 보드인데 그룹이 못 그리는 타입이면 'table'). */
  readonly layout: PublicLayout
  /** 뷰에 저장된 레이아웃 그대로(`view.type`). */
  readonly viewType: string
  /** 보드일 때만. */
  readonly board: PublicBoard | null
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
export async function readPublicTableIn(tx: Tx, target: PublicTarget, win: WindowQuery | null = null): Promise<PublicTable | null> {
  const node = await tx.queryMaybe<{ type: string }>(`SELECT type FROM block WHERE id = $1`, [target.pageId])
  if (node?.type !== 'database') return null
  // 소유한 소스가 없는 그릇(본문 안의 연결된 데이터베이스 — 정본 [보강 L-1] ④)을 직접 열면 빈 표
  return (
    (await publicTableOf(tx, target.pageId, win)) ?? {
      layout: 'table', viewType: 'table', board: null, cardSize: 'medium', window: null, viewName: '', columns: [], rows: [], truncated: false,
    }
  )
}

/**
 * 데이터베이스 하나의 공개 표. 부르는 쪽이 그 데이터베이스가 열린다는 것을 같은 트랜잭션에서 확인했다(`resolvePublicPageIn` ·
 * `openablePagesIn` — 공개 본문의 인라인 데이터베이스 · I-4b). 이 함수는 판정을 다시 하지 않고 **행마다의 공개 조건**만 건다.
 *
 * `win` — 연 페이지 자신의 표일 때 주소의 창 값(PV-2). 없으면(인라인) 오늘이 든 창이고 이전 · 다음 링크가 없다.
 */
export async function publicTableOf(tx: Tx, databaseId: string, win: WindowQuery | null = null): Promise<PublicTable | null> {

  // 소유한 data source 의 첫 뷰 — 붙인 소스(linked)는 다른 데이터베이스의 행이다(그 데이터베이스는 게시되지 않았다)
  const view = await tx.queryMaybe<{
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
      ORDER BY v.order_idx, v.id
      LIMIT 1`,
    [databaseId],
  )
  // 소유한 살아 있는 소스가 없다(붙인 소스만 가진 그릇 · 정본 [보강 L-1] ④) — 그릴 공개 표가 없다
  if (view === null) return null

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
  }>(
    `SELECT b.id, b.properties, b.format, p.properties_cache, p.unique_seq
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
    layout,
    viewType: view.type,
    board,
    cardSize: readGalleryLayout(view.configuration).cover_size,
    window: dated === null ? null : dated.window,
    viewName: view.name ?? '',
    columns,
    rows: kept.map(({ row, span }) => ({
      id: row.id,
      title: readTitle(row.properties),
      icon: pageIconOfFormat(row.format),
      cells: pick(row.properties_cache, columns),
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
  const row = await tx.queryMaybe<{ data_source_id: string; properties_cache: Record<string, unknown> | null; unique_seq: string | null }>(
    `SELECT data_source_id, properties_cache, unique_seq FROM page WHERE id = $1`,
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
  return { columns, cells: pick(row.properties_cache, columns), uniqueSeq: row.unique_seq === null ? null : Number(row.unique_seq) }
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
  const optionIds = kept.filter((r) => r.type === 'select' || r.type === 'status').map((r) => r.property_id)
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

/** 보이는 공개 열의 값만 — 캐시의 다른 칸(숨긴 열 · 그리지 않는 타입)은 싣지 않는다. */
function pick(cache: Record<string, unknown> | null, columns: readonly PublicColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) {
    const value = cache?.[column.id]
    if (value === undefined) continue
    // 검증 — 배지에 필요한 것만(상태 · 만료 시각 · 만료 여부). 검증한 사람 · 시각은 공개 방문자에게 가지 않는다(회원의 신원)
    if (column.type === 'verification') {
      const cell = toVerificationCell(value, new Date())
      if (cell !== null) out[column.id] = { type: 'verification', state: cell.state, expires_at: cell.expires_at, expired: cell.expired }
      continue
    }
    out[column.id] = value
  }
  return out
}
