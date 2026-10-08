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
import { databaseLockState } from '@/lib/permissions/lock'
import { getView, listViews } from '@/lib/database/view'
import { isFilterableColumn, nestsSubItems, subItemPairOf } from '@/lib/database/view-columns'
import { queryRows } from '@/lib/database/query'
import { computeCalculations } from '@/lib/database/calculate'
import { normalizeSearch } from '@/lib/database/search'
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
import { listTeamspaceDestinations } from '@/lib/block/move-page'
import { MovePageControl } from '../../[pageId]/move-page-control'
import { LockButton } from '../../[pageId]/lock-button'
import { PageIconControl } from '../../[pageId]/page-icon-control'
import { PageIconView } from '../../page-icon-view'
import { ViewTabs } from './view-tabs'
import { ViewToolbar, type BoardSettings } from './view-toolbar'
import { SearchEmpty } from './view-search'
import { TemplatePanel } from './template-panel'
import { DataSourcePanel } from './data-source-panel'

const UNTITLED = '제목 없음'

export default async function DatabasePage({
  params,
  searchParams,
}: PageProps<'/w/[workspaceId]/db/[databaseId]'>) {
  const { workspaceId, databaseId } = await params
  const { v, q } = await searchParams
  // 뷰 검색어(2e · F-04-27) — 주소의 `q`. 뷰에 저장하지 않는다. 서버가 다듬는다(빈 글 · 상한).
  const search = normalizeSearch(Array.isArray(q) ? q[0] : q)

  const ctx = await requirePageSession(workspaceId)
  // uuid 가 아니면 질의가 pg 형식 오류로 죽는다. "없다"와 구분할 이유가 없다.
  if (!isUuid(databaseId)) notFound()

  // 볼 수 없는 표는 없는 표와 같다(HANDOFF §3.3-31).
  const database = await getDatabase(ctx, databaseId)
  if (!database.ok) notFound()

  // 옮길 수 있는 teamspace 최상위(7c-8) — 페이지 화면과 같은 목록이다. 페이지 대상은 주지 않는다: 풀페이지 표는
  // 최상위 사이에서만 옮긴다(본문 참조가 없다 · move-page.ts).
  const moveTeamspaces = await listTeamspaceDestinations(ctx)

  const views = await listViews(ctx, databaseId)
  if (!views.ok || views.value.length === 0) notFound()
  const current = views.value.find((view) => view.id === v) ?? views.value[0]

  const view = await getView(ctx, current.id)
  if (!view.ok) notFound()

  const isBoard = view.value.type === 'board'
  // 하위 항목이 켜진 표 · 목록은 최상위 행만 먼저 읽는다 — 자식은 토글을 펼 때 읽는다(2b-2 · 행 라우트와 같은 규칙).
  // 검색 중에는 트리를 펴지 않는다 — 맞는 행을 평평하게(2e-1 · 행 라우트와 같은 규칙).
  const subItems = nestsSubItems(view.value.type) && search === null ? subItemPairOf(view.value.columns) : null
  const [tablePage, catalog, board] = await Promise.all([
    isBoard
      ? null
      : queryRows(ctx, view.value.dataSourceId, {
          filter: view.value.filter,
          sorts: view.value.sorts,
          limit: view.value.loadLimit,
          ...(subItems === null ? {} : { tree: { parentPropertyId: subItems.parentPropertyId, under: null } }),
          search,
        }),
    // 필터 패널의 연산자 드롭다운이 이것을 그린다 — 코드에 박지 않는다(F-03-17).
    readOperatorCatalog(),
    isBoard ? queryGroups(ctx, view.value.id, { search }) : null,
  ])
  if (tablePage !== null && !tablePage.ok) notFound()
  // 그룹 프로퍼티가 지워진 보드(`not_grouped`)는 아래에서 "그룹 기준을 고르라"로 그린다. 다른 실패는 못 보는 것과 같다.
  if (board !== null && !board.ok && board.reason !== 'not_grouped') notFound()

  const { name, icon, access: granted } = database.value

  // ── 데이터 소스(8e-2 · F-04-23) ──
  // 이 뷰가 보는 소스. 소스가 둘 이상이면 그 이름이 탭 줄 위에 서고(노션: *"you'll see the data source's name above the horizontal bar of
  // views"*), 표의 이름(관계형의 반대쪽 이름 기본값 · 표의 접근성 이름)도 소스의 것이다. 하나면 데이터베이스 이름이 그 자리다(정본 ③).
  const sources = database.value.dataSources
  const multiSource = sources.length > 1
  const currentSource = sources.find((source) => source.id === view.value.dataSourceId) ?? null
  const tableName = multiSource && currentSource !== null ? currentSource.name : name
  // 데이터베이스 잠금(7f-2) — 구조를 고칠 수 있어도 잠겨 있으면 구조 화면(속성 · 뷰 · 템플릿 · 이름)을 닫는다. 서버도 `locked` 로
  // 거부한다. 행 · 셀은 그대로다(`canEditContent` · `canCreateRows` 는 건드리지 않는다).
  const lock = await databaseLockState(ctx, databaseId)
  const access = lock?.locked ? { ...granted, canEditStructure: false } : granted
  const columns = view.value.columns
  // 지워진 속성의 정렬 키를 뺀다. 그대로 두면 다른 키를 고친 저장까지 서버가 거부한다
  // (`filter-draft.ts` 머리말).
  // 거를 수 있는 컬럼으로 묻는다 — 셀 컬럼으로만 물으면 고유 ID 의 정렬 키가 도구줄에서 사라진다(서버는 그 키로 정렬하는데).
  const sorts = liveSorts(view.value.sorts, new Map(columns.filter(isFilterableColumn).map((c) => [c.propertyId, c.type])))

  // ── 보드 ──
  const groupBy = view.value.groupBy
  const groupColumn = groupBy === null ? undefined : columns.find((c) => c.propertyId === groupBy.property_id)
  const groupProperty: GroupProperty | null =
    groupColumn !== undefined && isGroupableType(groupColumn.type)
      ? { id: groupColumn.propertyId, name: groupColumn.name, type: groupColumn.type }
      : null
  const groups: BoardGroupJson[] =
    board !== null && board.ok ? board.value.groups.map((g) => ({ ...g, rows: g.rows.map(rowJson) })) : []
  // 그룹 머리의 계산(2d-3) — 서버가 살아 있다고 본 것만(`liveGroupCalculation`). 이름은 숨긴 컬럼에서도 찾는다.
  const liveCalculation = board !== null && board.ok ? board.value.calculation : null
  const groupCalculation =
    liveCalculation === null
      ? null
      : {
          propertyId: liveCalculation.property_id,
          propertyName: columns.find((c) => c.propertyId === liveCalculation.property_id)?.name ?? '',
          fn: liveCalculation.function,
        }
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
  // 고유 ID 의 접두사도 넣는다(2a-2) — 표는 컬럼을 자기 상태로 들고 있어서, 기준에 없으면 접두사를 바꿔도 옛 접두사를 그린다.
  //   빠뜨린 채 처음 만들었고 e2e 가 잡았다.
  const contentKey = JSON.stringify([
    view.value.id,
    view.value.type,
    view.value.filter,
    view.value.sorts,
    groupBy,
    // 타입도 넣는다(2c-2) — 표는 컬럼을 자기 상태로 들고 있어서, 타입을 바꾼 뒤에도 옛 타입으로 칸을 그린다.
    // 집계 함수도(2d-2) — 바꾸면 표가 새 값으로 다시 선다(값은 서버 렌더가 준다).
    columns.map((c) => [c.propertyId, c.name, c.visible, c.type, c.type === 'unique_id' ? c.uniqueId.prefix : null, c.calculation ?? null]),
    // 하위 항목을 켜고 끄면 같은 뷰가 트리 ↔ 평평한 표로 바뀐다(2b-2) — 읽은 행(최상위만 ↔ 전부)이 무효다. 이름 · 보임은 그대로라
    // 이것이 없으면 끈 뒤에도 최상위 행만 남는다(e2e 가 잡았다).
    subItems?.parentPropertyId ?? null,
    // 검색어(2e-2) — 바뀌면 읽은 행 · 커서가 무효다(필터와 같은 이유).
    search,
  ])
  const visibleColumns = columns.filter((column) => column.visible)
  const variant = variantOf(view.value.type)

  // ── relation 칸의 제목 ──
  // 캐시의 id 는 걸러지지 않았다(마이그레이션 0024). 제목은 권한 · 휴지통을 거르는 한 곳(`loadRelationLabels`)에서 받아
  // 첫 화면과 함께 내려준다 — 마운트 뒤에 받으면 칩이 빈 채로 한 번 그려졌다가 채워진다. 그 뒤에 온 행("더 보기")의 것은
  // 화면이 `POST /relation-labels` 로 받는다.
  const relationPropertyIds = visibleColumns.filter((c) => c.type === 'relation').map((c) => c.propertyId)
  const firstRows = tablePage !== null ? tablePage.value.rows : groups.flatMap((g) => g.rows)
  const relation =
    relationPropertyIds.length === 0
      ? { labels: {}, icons: {} }
      : await loadRelationLabels(ctx, relationIdsIn(firstRows, relationPropertyIds))

  // ── rollup 칸의 값 ──
  // 값은 행에 없다 — 어디에도 저장하지 않고 **읽을 때 계산한다**(정본 §3.5 [보강] rollup v1 · 보는 사람마다 다르다).
  // 제목 맵과 같은 자리에서 첫 화면 것을 함께 계산한다. 그 뒤에 온 행("더 보기" · 새 행)의 것은 화면이
  // `POST /rollup-values` 로 받는다(`use-rollup-values.ts`). 보드는 아직 rollup 배지를 그리지 않는다(§7).
  const computed =
    tablePage === null || !visibleColumns.some((c) => c.type === 'rollup')
      ? null
      : await computeRollups(ctx, view.value.dataSourceId, firstRows.map((row) => row.id))
  const rollupValues = computed !== null && computed.ok ? computed.value : EMPTY_ROLLUP_PAGE

  // ── 열 집계(2d-2 · F-04-16) ── 필터를 지난 행 전부로 계산한다(첫 페이지와 무관 · `calculate.ts`). 표 모양만 그린다.
  const calculations =
    tablePage === null || variant !== 'table'
      ? {}
      : await computeCalculations(ctx, view.value.dataSourceId, view.value.filter, view.value.columns, search)

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
          <span className="text-neutral-400">
            <PageIconView icon={icon} className="mr-1" />
            {name || UNTITLED}
          </span>
        </nav>
        <div className="flex items-center gap-2">
          <LockButton
            lockUrl={`/api/workspaces/${workspaceId}/databases/${databaseId}/lock`}
            locked={lock?.locked ?? false}
            canToggle={lock?.canToggle ?? false}
            reloadOnUnlock={false}
            hint="잠긴 데이터베이스 — 속성 · 뷰 · 템플릿 · 이름을 고칠 수 없습니다(행과 값은 고칩니다)"
          />
          <MovePageControl
            workspaceId={workspaceId}
            pageId={databaseId}
            currentParentId={null}
            currentTeamspaceId={database.value.teamspaceId}
            currentPrivate={database.value.ownerUserId !== null && database.value.ownerUserId === ctx.userId}
            targets={[]}
            teamspaces={moveTeamspaces}
          />
          {/* 풀페이지 표는 워크스페이스 직속이라 페이지 내보내기로는 닿지 않는다(`lib/export/download.ts`). */}
          <ExportButton workspaceId={workspaceId} rootId={databaseId} />
        </div>
      </div>

      {/* 아이콘(8c-3b)은 이름 위에 선다 — 페이지 머리와 같다. 고치는 사람은 이름과 같다(구조 · 잠금이면 닫힌다 — `access` 가 이미 담는다). */}
      <div className="group/header flex flex-col gap-2">
        <PageIconControl
          workspaceId={workspaceId}
          pageId={databaseId}
          kind="database"
          initialIcon={icon}
          readOnly={!access.canEditStructure}
        />
        <DatabaseTitle
          workspaceId={workspaceId}
          databaseId={databaseId}
          initialName={name}
          canEdit={access.canEditStructure}
        />
      </div>

      <div className="flex flex-col gap-1">
        {multiSource && currentSource !== null && (
          <p className="px-1 text-sm font-medium text-neutral-600 dark:text-neutral-300" data-testid="db-source-name">
            {currentSource.name}
          </p>
        )}
        <ViewTabs
          workspaceId={workspaceId}
          databaseId={databaseId}
          views={views.value}
          currentId={current.id}
          canEdit={access.canEditStructure}
          sources={sources.map((source) => ({ id: source.id, name: source.name }))}
        />
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <ViewToolbar
            workspaceId={workspaceId}
            viewId={view.value.id}
            dataSourceId={view.value.dataSourceId}
            columns={[...columns]}
            filter={view.value.filter}
            sorts={sorts}
            catalog={catalog}
            canEdit={access.canEditStructure}
            board={boardSettings}
            search={search}
          />
        </div>
        {/* 데이터 소스(8e-2)는 데이터베이스의 구조다 — 고칠 수 있는 사람에게만 선다(잠기면 `access` 가 이미 닫는다). */}
        {access.canEditStructure && (
          <DataSourcePanel
            workspaceId={workspaceId}
            databaseId={databaseId}
            databaseName={name}
            sources={sources.map((source) => ({
              id: source.id,
              name: source.name,
              firstViewId: views.value.find((v) => v.dataSourceId === source.id)?.id ?? null,
            }))}
            currentSourceId={view.value.dataSourceId}
          />
        )}
        {/* 템플릿은 뷰가 아니라 **표**의 것이다(`page.data_source_id`) — 뷰 설정 옆에 두되 같은 패널에 넣지 않는다. */}
        <TemplatePanel
          workspaceId={workspaceId}
          databaseId={databaseId}
          dataSourceId={view.value.dataSourceId}
          canEdit={access.canEditStructure}
        />
      </div>

      {/* 보드는 열을 남긴다 — 맞는 카드가 하나도 없으면 위에 안내를 둔다(2e-2 · 04 *"빈 테이블만 보이면 필터 버그로 오인"*). */}
      {isBoard && search !== null && board !== null && board.ok && board.value.groups.every((g) => g.count === 0) && (
        <SearchEmpty search={search} />
      )}
      {isBoard ? (
        groupBy !== null && groupProperty !== null && board !== null && board.ok ? (
          <DatabaseBoard
            key={contentKey}
            workspaceId={workspaceId}
            viewId={view.value.id}
            dataSourceId={view.value.dataSourceId}
            tableName={tableName}
            columns={visibleColumns}
            property={groupProperty}
            groupBy={groupBy}
            manualOrder={board.value.manualOrder}
            groups={groups}
            relationLabels={relation.labels}
            relationIcons={relation.icons}
            access={access}
            defaultTemplate={defaultTemplate}
            calculation={groupCalculation}
            search={search}
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
            tableName={tableName}
            variant={variant}
            columns={listColumns(variant, visibleColumns)}
            rows={tablePage.value.rows.map(rowJson)}
            hasMore={tablePage.value.hasMore}
            nextCursor={tablePage.value.nextCursor}
            relationLabels={relation.labels}
            relationIcons={relation.icons}
            rollupValues={rollupValues}
            access={access}
            sorts={sorts}
            defaultTemplate={defaultTemplate}
            subItems={subItems}
            calculations={calculations}
            search={search}
          />
        )
      )}
    </main>
  )
}
