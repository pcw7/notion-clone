/**
 * 풀페이지 데이터베이스 — `/w/{workspaceId}/db/{databaseId}`
 *
 * 정본: 04-database-views.md F-04-14(풀페이지) · F-04-01(뷰 컨테이너) · F-04-02(Table) · F-04-03(Board)
 *       03-database-core.md F-03-16(셀 편집) · F-03-17(페이지네이션)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 첫 화면은 서버가 한 번에 읽는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 표 · 뷰 탭 · 컬럼 · 첫 페이지 행을 여기서 읽어 내려준다. 클라이언트가 마운트 뒤에
 * `GET /rows` 를 부르면 빈 표가 한 번 그려졌다가 채워진다. 그 뒤의 쓰기와 "더 보기"는
 * 클라이언트가 API 로 한다.
 *
 * `GET /api/.../views/[viewId]/rows` 와 **같은 함수를 같은 순서로** 부른다
 * (`getView` → `queryRows`). 보드는 `GET /groups` 와 같은 `queryGroups` 다. 필터·정렬·그룹은
 * 뷰에 저장된 것을 쓰고 URL 에서 받지 않는다 — 같은 링크를 연 두 사람이 같은 행을 본다
 * (F-03-17: "뷰 설정은 공유 상태다").
 *
 * ──────────────────────────────────────────────────────────────────────
 * 뷰 종류가 화면을 고른다 (보드 4b조각)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `view.type === 'board'` 면 보드, 그 외(table · list)는 표 컴포넌트다 — list 는 **같은 컴포넌트의 다른 모양**
 * (`variant="list"` · F-04-04 · `lib/database/list-layout.ts`)이고 제목을 맨 앞에 세운다.
 * 보드인데 그룹 프로퍼티가 지워졌으면(`groupBy: null` · `not_grouped`) "그룹 기준을 고르라"는
 * 상태를 보여준다. 자동으로 다른 속성을 고르지 않는다(HANDOFF §3.2-26).
 *
 * ──────────────────────────────────────────────────────────────────────
 * `?v=` 가 없는 뷰를 가리키면 기본 뷰를 보여준다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-01: *"삭제된 뷰의 `?v=` 딥링크로 접근 → 기본 뷰로 리다이렉트 + 토스트.
 * 404 로 떨어뜨리지 않는다."* 링크를 저장해 둔 사람이 표 자체에 못 들어오면 안 된다.
 * 토스트는 아직 없다.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { isUuid } from '@/lib/ids'
import { requirePageSession } from '@/lib/auth/page-session'
import { getDatabase } from '@/lib/database/database'
import { getView, listViews } from '@/lib/database/view'
import { isCellColumn } from '@/lib/database/view-columns'
import { queryRows } from '@/lib/database/query'
import { queryGroups } from '@/lib/database/group'
import { loadRelationLabels, relationIdsIn } from '@/lib/database/relation'
import { computeRollups, EMPTY_ROLLUP_PAGE } from '@/lib/database/rollup'
import { groupLabel } from '@/lib/database/board-drag'
import { listColumns, variantOf } from '@/lib/database/list-layout'
import { isGroupableType } from '@/lib/database/property-types'
import { rowJson } from '@/lib/database/http'
import { readOperatorCatalog } from '@/lib/database/operator-catalog'
import { liveSorts } from '@/lib/database/filter-draft'
import { readLiveTemplate } from '@/lib/database/template'
import { withReadTransaction } from '@/lib/db/tx'
import { ExportButton } from '../../export-button'
import { DatabaseTitle } from './database-title'
import { DatabaseTable } from './database-table'
import { DatabaseBoard, type BoardGroupJson, type GroupProperty } from './database-board'
import { ViewTabs } from './view-tabs'
import { ViewToolbar, type BoardSettings } from './view-toolbar'
import { TemplatePanel } from './template-panel'

const UNTITLED = '제목 없음'

export default async function DatabasePage({
  params,
  searchParams,
}: PageProps<'/w/[workspaceId]/db/[databaseId]'>) {
  const { workspaceId, databaseId } = await params
  const { v } = await searchParams

  const ctx = await requirePageSession(workspaceId)
  // uuid 가 아니면 질의가 pg 형식 오류로 죽는다. "없다"와 구분할 이유가 없다.
  if (!isUuid(databaseId)) notFound()

  // 볼 수 없는 표는 없는 표와 같다(HANDOFF §3.3-31).
  const database = await getDatabase(ctx, databaseId)
  if (!database.ok) notFound()

  const views = await listViews(ctx, databaseId)
  if (!views.ok || views.value.length === 0) notFound()
  const current = views.value.find((view) => view.id === v) ?? views.value[0]

  const view = await getView(ctx, current.id)
  if (!view.ok) notFound()

  const isBoard = view.value.type === 'board'
  const [tablePage, catalog, board] = await Promise.all([
    isBoard
      ? null
      : queryRows(ctx, view.value.dataSourceId, {
          filter: view.value.filter,
          sorts: view.value.sorts,
          limit: view.value.loadLimit,
        }),
    // 필터 패널의 연산자 드롭다운이 이것을 그린다 — 코드에 박지 않는다(F-03-17).
    readOperatorCatalog(),
    isBoard ? queryGroups(ctx, view.value.id) : null,
  ])
  if (tablePage !== null && !tablePage.ok) notFound()
  // 그룹 프로퍼티가 지워진 보드(`not_grouped`)는 아래에서 "그룹 기준을 고르라"로 그린다. 다른 실패는 못 보는 것과 같다.
  if (board !== null && !board.ok && board.reason !== 'not_grouped') notFound()

  const { name, access } = database.value
  const columns = view.value.columns
  // 지워진 속성의 정렬 키를 뺀다. 그대로 두면 다른 키를 고친 저장까지 서버가 거부한다
  // (`filter-draft.ts` 머리말).
  const sorts = liveSorts(view.value.sorts, new Map(columns.filter(isCellColumn).map((c) => [c.propertyId, c.type])))

  // ── 보드 ──
  const groupBy = view.value.groupBy
  const groupColumn = groupBy === null ? undefined : columns.find((c) => c.propertyId === groupBy.property_id)
  const groupProperty: GroupProperty | null =
    groupColumn !== undefined && isGroupableType(groupColumn.type)
      ? { id: groupColumn.propertyId, name: groupColumn.name, type: groupColumn.type }
      : null
  const groups: BoardGroupJson[] =
    board !== null && board.ok ? board.value.groups.map((g) => ({ ...g, rows: g.rows.map(rowJson) })) : []
  const boardSettings: BoardSettings | undefined = isBoard
    ? {
        groupBy,
        groups:
          groupProperty === null
            ? []
            : groups.map((g) => ({
                key: g.key,
                label: groupLabel(groupProperty.type, groupProperty.name, g),
                count: g.count,
                hidden: g.hidden,
              })),
      }
    : undefined

  // 표 · 보드를 새로 마운트하는 기준. 뷰 · 종류 · 필터 · 정렬 · 그룹 · 컬럼(이름 · 보임)이 바뀌면
  // 불러온 행과 커서가 무효다(F-04-15) — 옛 커서로 이어 붙이면 순서가 섞인다.
  const contentKey = JSON.stringify([
    view.value.id,
    view.value.type,
    view.value.filter,
    view.value.sorts,
    groupBy,
    columns.map((c) => [c.propertyId, c.name, c.visible]),
  ])
  const visibleColumns = columns.filter((column) => column.visible)
  const variant = variantOf(view.value.type)

  // ── relation 칸의 제목 ──
  // 캐시의 id 는 걸러지지 않았다(마이그레이션 0024). 제목은 권한 · 휴지통을 거르는 한 곳(`loadRelationLabels`)에서 받아
  // 첫 화면과 함께 내려준다 — 마운트 뒤에 받으면 칩이 빈 채로 한 번 그려졌다가 채워진다. 그 뒤에 온 행("더 보기")의 것은
  // 화면이 `POST /relation-labels` 로 받는다.
  const relationPropertyIds = visibleColumns.filter((c) => c.type === 'relation').map((c) => c.propertyId)
  const firstRows = tablePage !== null ? tablePage.value.rows : groups.flatMap((g) => g.rows)
  const relationLabels =
    relationPropertyIds.length === 0 ? {} : await loadRelationLabels(ctx, relationIdsIn(firstRows, relationPropertyIds))

  // ── rollup 칸의 값 ──
  // 값은 행에 없다 — 어디에도 저장하지 않고 **읽을 때 계산한다**(정본 §3.5 [보강] rollup v1 · 보는 사람마다 다르다).
  // 제목 맵과 같은 자리에서 첫 화면 것을 함께 계산한다. 그 뒤에 온 행("더 보기" · 새 행)의 것은 화면이
  // `POST /rollup-values` 로 받는다(`use-rollup-values.ts`). 보드는 아직 rollup 배지를 그리지 않는다(§7).
  const computed =
    tablePage === null || !visibleColumns.some((c) => c.type === 'rollup')
      ? null
      : await computeRollups(ctx, view.value.dataSourceId, firstRows.map((row) => row.id))
  const rollupValues = computed !== null && computed.ok ? computed.value : EMPTY_ROLLUP_PAGE

  // ── 기본 템플릿(F-08-03) ──
  // 뷰는 **살아 있는 템플릿일 때만** id 를 준다(`readView` · §3.3-176). 버튼이 그 이름을 말하므로 이름까지 읽는다 —
  // "이 표의 살아 있는 템플릿인가"를 묻는 곳은 한 함수다(`readLiveTemplate`).
  const defaultTemplateId = view.value.defaultTemplateId
  const defaultRow =
    defaultTemplateId === null
      ? null
      : await withReadTransaction((tx) => readLiveTemplate(tx, ctx, view.value.dataSourceId, defaultTemplateId))
  const defaultTemplate = defaultRow === null ? null : { id: defaultRow.id, title: defaultRow.title }

  return (
    <main className="flex min-h-screen min-w-0 flex-col gap-6 px-10 py-12">
      <div className="flex items-start justify-between gap-3">
        <nav aria-label="상위 경로" className="flex flex-wrap items-center gap-1 text-sm text-neutral-500">
          <Link href={`/w/${workspaceId}`} className="hover:underline underline-offset-4">
            워크스페이스
          </Link>
          <span aria-hidden>/</span>
          <span className="text-neutral-400">{name || UNTITLED}</span>
        </nav>
        {/* 풀페이지 표는 워크스페이스 직속이라 페이지 내보내기로는 닿지 않는다(`lib/export/download.ts`). */}
        <ExportButton workspaceId={workspaceId} rootId={databaseId} />
      </div>

      <DatabaseTitle
        workspaceId={workspaceId}
        databaseId={databaseId}
        initialName={name}
        canEdit={access.canEditStructure}
      />

      <ViewTabs
        workspaceId={workspaceId}
        databaseId={databaseId}
        views={views.value}
        currentId={current.id}
        canEdit={access.canEditStructure}
      />

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <ViewToolbar
            workspaceId={workspaceId}
            viewId={view.value.id}
            columns={[...columns]}
            filter={view.value.filter}
            sorts={sorts}
            catalog={catalog}
            canEdit={access.canEditStructure}
            board={boardSettings}
          />
        </div>
        {/* 템플릿은 뷰가 아니라 **표**의 것이다(`page.data_source_id`) — 뷰 설정 옆에 두되 같은 패널에 넣지 않는다. */}
        <TemplatePanel
          workspaceId={workspaceId}
          databaseId={databaseId}
          dataSourceId={view.value.dataSourceId}
          canEdit={access.canEditStructure}
        />
      </div>

      {isBoard ? (
        groupBy !== null && groupProperty !== null && board !== null && board.ok ? (
          <DatabaseBoard
            key={contentKey}
            workspaceId={workspaceId}
            viewId={view.value.id}
            dataSourceId={view.value.dataSourceId}
            tableName={name}
            columns={visibleColumns}
            property={groupProperty}
            groupBy={groupBy}
            manualOrder={board.value.manualOrder}
            groups={groups}
            relationLabels={relationLabels}
            access={access}
            defaultTemplate={defaultTemplate}
          />
        ) : (
          <p className="px-2 text-sm text-neutral-500" data-testid="db-board-needs-group">
            이 보드의 그룹 속성이 지워졌습니다.{' '}
            {access.canEditStructure
              ? '도구줄의 "그룹"에서 그룹 기준을 다시 고르세요.'
              : '고칠 수 있는 사람이 그룹 기준을 다시 골라야 합니다.'}
          </p>
        )
      ) : (
        tablePage !== null && (
          <DatabaseTable
            // 뷰 · 필터 · 정렬 · 컬럼이 바뀌면 표의 상태(선택 · 편집 · 불러온 행)를 버린다.
            // 다른 목록에 옛 커서로 이어 붙이지 않는다.
            key={contentKey}
            workspaceId={workspaceId}
            viewId={view.value.id}
            dataSourceId={view.value.dataSourceId}
            tableName={name}
            variant={variant}
            columns={listColumns(variant, visibleColumns)}
            rows={tablePage.value.rows.map(rowJson)}
            hasMore={tablePage.value.hasMore}
            nextCursor={tablePage.value.nextCursor}
            relationLabels={relationLabels}
            rollupValues={rollupValues}
            access={access}
            sorts={sorts}
            defaultTemplate={defaultTemplate}
          />
        )
      )}
    </main>
  )
}
