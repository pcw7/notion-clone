/**
 * 오프라인 내려받기의 서버 쪽 — 데이터베이스 하나의 첫 뷰를 처음 50행까지 (OF-4 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑤)
 *
 * 내려받은 데이터베이스는 **첫 뷰의 처음 50행을 읽기 전용으로**(노션과 같은 상한) 기기에 둔다. 마이그레이션이 없다 — 읽기 길 하나다.
 *
 *   - **첫 뷰** — 탭(`owner_kind='database_view'` · `listViews`)의 차례대로, 원본을 볼 수 없는 소스의 뷰를 건너뛴 첫 뷰(데이터베이스 화면의
 *     기본 뷰와 같다)에서 **행을 그리지 않는 뷰**(폼 · 대시보드 · 차트)를 더 건너뛴다. 그런 뷰가 없으면 열 · 행이 빈 답이다
 *   - **행은 화면과 같은 질의로** — `queryRows`(권한이 필터보다 먼저 · 행 단위 제한 `restrictedRowsSql` · 템플릿 아님)에 그 뷰의 이 사람이
 *     보는 필터 · 정렬(개인 것이 공유 것을 대체한다) · 수동 순서 · 하위 항목 규칙(데이터베이스 화면의 첫 페이지와 같은 입력)을 넘기고
 *     50행만 받는다. 더 있으면 `truncated`
 *   - **칸은 보이는 글자로** — 그 뷰의 보이는 열(뷰 순서 · 버튼은 값이 없어 뺀다)을 CSV 내보내기와 같은 함수(`cellPlainText`)로 바꾼다.
 *     id · 파일 주소는 나가지 않는다(선택은 옵션 이름 · 사람은 이름 · 파일은 이름). 셀이 아닌 칸은 화면과 같은 곳에서 읽어 내보내기의 모양으로
 *     끼운다 — relation 은 볼 수 있는 제목과 볼 수 없는 개수(`loadRelationLabels`) · rollup 은 이 사람의 권한으로 계산(`computeRollups`) · 수식은
 *     화면과 같은 계산기 · 만든 · 고친 사람은 이름표(`loadAutoMetaLabels`)
 *   - **권한은 데이터베이스를 보는 것과 같다**(`getDatabase` — "만들기만"이면 자기가 열 수 있는 행만 온다) · **내보내기 정책을 따른다**
 *     (`mayDownloadOffline` — OF-2 와 같은 게이트 · 데이터베이스를 읽기 전에 막는다). 없는 · 볼 수 없는 · 휴지통의 데이터베이스는 가르지 않는다
 *   - `savedVersion` 은 서버가 읽은 때다 — 다시 붙으면(OF-3) 판을 견주지 않고 늘 다시 받는다(작다 · 칸의 글자는 다른 표의 제목 · 사람의 이름에도
 *     달려 있어 값싼 판이 없다)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { autoMetaPersonText } from '../database/cell-format.ts'
import { getDatabase } from '../database/database.ts'
import { formulaEvaluator, formulaPlanOf } from '../database/formula-plan.ts'
import { loadAutoMetaLabels, loadPeopleNames, peopleIdsOf } from '../database/people.ts'
import { isAutoMetaTimeType, isAutoMetaType, readRelationValue } from '../database/property-types.ts'
import { queryRows, type QueriedRow } from '../database/query.ts'
import { loadRelationLabels, relationIdsIn } from '../database/relation.ts'
import { computeRollups } from '../database/rollup.ts'
import { formatUniqueId } from '../database/unique-id-format.ts'
import { getView, listViews, type ViewColumn, type ViewDetail, type ViewSummary } from '../database/view.ts'
import { cardParentsOnlyPair, nestsSubItems, showsParentsOnly, subItemPairOf } from '../database/view-columns.ts'
import { cellPlainText, type CsvColumn, type ExportRelationCell, type ExportRollupCell } from '../export/csv.ts'
import { isUuid } from '../ids.ts'
import { mayDownloadOffline } from './offline-page.ts'
import type { OfflineDatabaseColumn, OfflineDatabasePayload, OfflineDatabaseRow } from './offline-store.ts'
import { OFFLINE_DATABASE_ROWS } from './offline-table.ts'

export type OfflineDatabaseResult =
  | { readonly ok: true; readonly value: OfflineDatabasePayload }
  | { readonly ok: false; readonly reason: 'not_found' | 'policy_disabled' }

/** 행을 그리지 않는 뷰 — 폼(편집 화면) · 대시보드(위젯의 배치) · 차트(그룹의 요약). */
const NO_ROW_VIEWS: ReadonlySet<string> = new Set(['form', 'dashboard', 'chart'])

/** 내려받을 뷰 — 볼 수 있는 소스의 뷰 가운데 행을 그리는 첫 탭. 없으면 null. */
export function firstRowView(views: readonly ViewSummary[], hiddenSources: ReadonlySet<string>): ViewSummary | null {
  return views.find((view) => !hiddenSources.has(view.dataSourceId) && !NO_ROW_VIEWS.has(view.type)) ?? null
}

export async function readOfflineDatabase(
  ctx: SessionContext,
  databaseId: string,
  /** 보는 사람의 오늘(상대 날짜 필터 · R-1) — 라우트가 쿠키에서 읽어 준다. 없으면 UTC 의 오늘. */
  options: { readonly today?: string | null } = {},
): Promise<OfflineDatabaseResult> {
  if (!(await mayDownloadOffline(ctx))) return { ok: false, reason: 'policy_disabled' }
  if (!isUuid(databaseId)) return { ok: false, reason: 'not_found' }
  const database = await getDatabase(ctx, databaseId)
  if (!database.ok) return { ok: false, reason: 'not_found' }
  const views = await listViews(ctx, databaseId)
  if (!views.ok) return { ok: false, reason: 'not_found' }

  const now = new Date()
  const base = { databaseId: database.value.id, name: database.value.name, icon: database.value.icon, savedVersion: now.toISOString() }
  const hidden = new Set(database.value.dataSources.filter((s) => !s.readable).map((s) => s.id))
  const first = firstRowView(views.value, hidden)
  if (first === null) return { ok: true, value: { ...base, viewName: '', columns: [], rows: [], truncated: false } }
  const view = await getView(ctx, first.id)
  // 탭 목록을 읽은 뒤에 지워졌거나 볼 수 없게 됐다
  if (!view.ok) return { ok: false, reason: 'not_found' }

  const page = await queryRows(ctx, view.value.dataSourceId, rowQueryOf(view.value, options.today ?? null))
  if (!page.ok) return { ok: false, reason: 'not_found' }

  const columns = view.value.columns.filter((c) => c.visible && c.type !== 'button')
  const rows = await displayRows(ctx, view.value, columns, page.value.rows, now)
  return {
    ok: true,
    value: {
      ...base,
      viewName: view.value.name,
      columns: columns.map((c): OfflineDatabaseColumn => ({ id: c.propertyId, name: c.name, type: c.type })),
      rows,
      truncated: page.value.hasMore,
    },
  }
}

/** 데이터베이스 화면의 첫 페이지와 같은 입력(`db/[databaseId]/page.tsx` 의 `queryRows`) — 검색어 없이 50행. */
function rowQueryOf(view: ViewDetail, today: string | null): Parameters<typeof queryRows>[2] {
  const subItemPair = nestsSubItems(view.type) ? subItemPairOf(view.columns) : null
  const subItems = subItemPair !== null && view.subItemDisplay === 'nested' ? subItemPair : null
  const flatSubItems = subItemPair !== null && subItems === null ? subItemPair : null
  const parentsOnly = showsParentsOnly(view.type) ? cardParentsOnlyPair(view.columns, view.subItemDisplay) : null
  return {
    filter: view.effectiveFilter,
    sorts: view.effectiveSorts,
    manualOrderViewId: view.id,
    limit: OFFLINE_DATABASE_ROWS,
    ...(subItems === null ? {} : { tree: { parentPropertyId: subItems.parentPropertyId, under: null } }),
    ...(subItems === null ? {} : { treeScope: { parentPropertyId: subItems.parentPropertyId, scope: view.subItemFilterScope } }),
    ...(flatSubItems === null ? {} : { flatScope: { parentPropertyId: flatSubItems.parentPropertyId, scope: view.subItemFilterScope } }),
    ...(parentsOnly === null ? {} : { tree: { parentPropertyId: parentsOnly.parentPropertyId, under: null } }),
    today,
  }
}

/** 행마다 보이는 열의 글자. 셀이 아닌 칸은 화면이 읽는 곳에서 읽어 내보내기의 모양으로 끼운 뒤 같은 함수로 바꾼다(머리말). */
async function displayRows(
  ctx: SessionContext,
  view: ViewDetail,
  columns: readonly ViewColumn[],
  rows: readonly QueriedRow[],
  now: Date,
): Promise<OfflineDatabaseRow[]> {
  const idsOf = (type: string) => columns.filter((c) => c.type === type).map((c) => c.propertyId)
  const peopleColumns = idsOf('people')
  const relationColumns = idsOf('relation')
  const peopleIds = peopleIdsOf(rows.flatMap((row) => peopleColumns.map((id) => row.properties[id])))
  const metaIds = columns.some((c) => c.type === 'created_by' || c.type === 'last_edited_by')
    ? rows.flatMap((row) => [row.createdBy, row.lastEditedBy]).filter((id): id is string => id !== null)
    : []
  const none: Record<string, string> = {}
  const [names, metaLabels, relation, rollups] = await Promise.all([
    peopleIds.length === 0 ? none : loadPeopleNames(ctx, peopleIds),
    metaIds.length === 0 ? none : loadAutoMetaLabels(ctx, metaIds),
    relationColumns.length === 0 ? null : loadRelationLabels(ctx, relationIdsIn(rows, relationColumns)),
    rows.length === 0 || !columns.some((c) => c.type === 'rollup') ? null : computeRollups(ctx, view.dataSourceId, rows.map((row) => row.id)),
  ])
  const peopleNames = new Map(Object.entries(names))
  const rolled = rollups !== null && rollups.ok ? rollups.value : null
  // 수식은 표의 속성 전부(숨긴 것도)로 계산한다 — 화면과 같은 계산기(`formula-plan.ts`)
  const evaluator = columns.some((c) => c.type === 'formula') ? formulaEvaluator(formulaPlanOf(view.columns, now)) : null

  const relationCell = (raw: unknown): ExportRelationCell => {
    const titles: string[] = []
    let hiddenCount = 0
    for (const ref of readRelationValue(raw).relation) {
      const label = relation?.labels[ref.id]
      // 키가 없으면 휴지통 · 없는 행 — 그리지 않는다(표 화면과 같다)
      if (label === undefined) continue
      if (label === null) hiddenCount += 1
      else titles.push(label)
    }
    return { type: 'relation_titles', titles, hidden: hiddenCount }
  }

  const textOf = (column: ViewColumn, row: QueriedRow, formulas: Readonly<Record<string, unknown>>): string => {
    const csv: CsvColumn = {
      propertyId: column.propertyId,
      name: column.name,
      type: column.type === 'button' ? 'rich_text' : column.type,
      options: column.options,
      names: peopleNames,
    }
    switch (column.type) {
      case 'title':
        return row.title
      case 'unique_id':
        return formatUniqueId(column.uniqueId.prefix, row.uniqueSeq)
      case 'formula':
        return cellPlainText(csv, formulas[column.propertyId] ?? null)
      case 'relation':
        return cellPlainText(csv, relationCell(row.properties[column.propertyId]))
      case 'rollup': {
        const info = rolled?.columns[column.propertyId]
        const cell = rolled?.values[row.id]?.[column.propertyId]
        if (info?.state !== 'ok' || cell === undefined) return ''
        const exported: ExportRollupCell = { type: 'rollup_export', cell, targetType: info.targetType, targetOptions: info.targetOptions }
        return cellPlainText(csv, exported)
      }
    }
    if (isAutoMetaType(column.type)) {
      // 내보내기와 같은 글 — 시각은 UTC ISO · 사람은 이름표(게스트에게는 "멤버")
      if (isAutoMetaTimeType(column.type)) return (column.type === 'created_time' ? row.createdAt : row.lastEditedAt).toISOString()
      return autoMetaPersonText(column.type === 'created_by' ? row.createdBy : row.lastEditedBy, metaLabels)
    }
    return cellPlainText(csv, row.properties[column.propertyId])
  }

  return rows.map((row) => {
    const formulas = evaluator === null ? {} : evaluator.valuesOf(row.properties)
    return {
      id: row.id,
      title: row.title,
      cells: Object.fromEntries(columns.map((column) => [column.propertyId, textOf(column, row, formulas)])),
    }
  })
}
