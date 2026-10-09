/**
 * 템플릿 편집 화면 — `/w/{workspaceId}/db/{databaseId}/templates/{templateId}` (템플릿 6c-3조각 · F-08-02)
 *
 * 정본: 08-templates-automation.md F-08-02
 *   *"열린 템플릿 페이지에서 제목(= 템플릿 이름) 입력, Priority=P1, PM=Fig 같은 property 를 미리 채움,
 *    본문에 체크리스트/이미지/서브페이지 작성 → 닫기."*
 *   *"템플릿 편집 화면 상단에 '템플릿 편집 중' 배너."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 페이지 화면을 쓰지 않는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 템플릿은 행이고 행은 페이지다 — `/w/{ws}/{pageId}` 가 열리기는 한다. 그런데 그 화면은 **페이지의 화면**이다:
 * 제목을 `renamePage` 로 저장하고(행은 거부된다 — 제목의 정본이 셀이다), 이동 피커 · breadcrumb 이 행을 모르며
 * (§7), 휴지통 · 복제 · 공유 버튼이 템플릿에는 뜻이 다르다. 반쯤 맞는 화면을 재사용하는 대신 **템플릿이 필요한
 * 것만** 세웠다: 이름 · 속성 · 본문 · 돌아가기.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 속성은 표를 세로로 펼친 것이다 — `variant="record"`
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-04 가 List 에 대해 적은 것(*"별도 컴포넌트 트리를 만들면 셀 에디터를 두 벌 유지하게 된다"*)이 여기에도
 * 그대로 적용된다. 그래서 속성 목록은 `DatabaseTable` 의 세 번째 모양이다 — 행 하나를 세로로 펼치고 칸마다
 * 속성 이름을 왼쪽에 세운다. 선택 · 편집 · 키보드 · 저장 · select · relation 편집기가 전부 표와 한 벌이다.
 *
 * 무엇을 그리는지는 `lib/database/list-layout.ts` 의 `listColumns` 가 정한다(제목과 rollup 을 뺀다 · 거기 머리말).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 본문은 페이지와 같은 길이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 템플릿의 본문도 Y.Doc 이고(판결 X-1) 협업 서버에 붙는다 — `BodyEditor` 를 그대로 쓴다. 그래서 템플릿 본문에
 * 하위 페이지 · 이미지 · 멘션을 넣을 수 있고, 그것이 6c-2 의 복제 엔진을 타고 새 행으로 따라간다.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import * as Y from 'yjs'

import { asBlockId, isUuid } from '@/lib/ids'
import { requirePageSession } from '@/lib/auth/page-session'
import { getDatabase } from '@/lib/database/database'
import { getView, listViews, readRecordColumns } from '@/lib/database/view'
import { listColumns } from '@/lib/database/list-layout'
import { loadRelationLabels, relationIdsIn } from '@/lib/database/relation'
import { EMPTY_ROLLUP_PAGE } from '@/lib/database/rollup'
import { rowJson } from '@/lib/database/http'
import { readLiveTemplate } from '@/lib/database/template'
import { withReadTransaction } from '@/lib/db/tx'
import { loadPageRefLabels } from '@/lib/block/save-page-body'
import { loadDocState, pageAccess } from '@/lib/collab/doc-store'
import { collabServerUrl } from '@/lib/collab/collab-url'
import { loadMentionLabels, mentionIdsOf } from '@/lib/block/mention-candidates'
import { readBodyYDoc } from '@/lib/collab/ydoc'
import { templateTrail } from '@/lib/block/breadcrumb'
import { BodyEditor } from '../../../../[pageId]/body-editor'
import { DatabaseTable } from '../../database-table'
import { formulaPlanOf } from '@/lib/database/formula-plan'
import { RowTitle } from '../../row-title'
import { PageIconControl } from '../../../../[pageId]/page-icon-control'
import { PageIconView } from '../../../../page-icon-view'

export default async function TemplatePage({
  params,
}: PageProps<'/w/[workspaceId]/db/[databaseId]/templates/[templateId]'>) {
  const { workspaceId, databaseId, templateId } = await params

  const ctx = await requirePageSession(workspaceId)
  if (!isUuid(databaseId) || !isUuid(templateId)) notFound()

  // 볼 수 없는 표는 없는 표와 같다(§3.3-31).
  const database = await getDatabase(ctx, databaseId)
  if (!database.ok) notFound()

  // 템플릿은 **data source** 의 것이다(`page.data_source_id`). 데이터베이스가 data source 를 여럿 가지면(8e-1) 첫 뷰의 것이 아닐 수 있다 —
  // 템플릿 자신의 data source 를 읽고, 그것이 이 데이터베이스에 붙어 있어야 한다(다른 표의 템플릿 id 를 이 주소에 넣어도 열리지 않는다).
  const source = await withReadTransaction((tx) =>
    tx.queryMaybe<{ data_source_id: string }>(`SELECT data_source_id FROM page WHERE id = $1`, [templateId]),
  )
  if (source === null || !database.value.dataSources.some((ds) => ds.id === source.data_source_id)) notFound()
  const dataSourceId = source.data_source_id

  // "이 표의 살아 있는 템플릿인가"를 묻는 곳은 한 함수다(`template.ts`) — 권한은 위에서 이미 봤다.
  const template = await withReadTransaction((tx) => readLiveTemplate(tx, ctx, dataSourceId, templateId))
  if (template === null) notFound()

  const views = await listViews(ctx, databaseId)
  if (!views.ok) notFound()
  // 표(`DatabaseTable`)는 뷰 하나를 받는다 — 그 data source 의 첫 뷰다(소스마다 적어도 하나 · `deleteView`). 속성 목록은 그 뷰의 것이
  // 아니다: 행 페이지와 같은 함수로 **스키마 순서 · 모두 보임**이다(8f-1 — 뷰에서 숨긴 속성도 템플릿에서 채울 수 있어야 한다).
  const first = views.value.find((v) => v.dataSourceId === dataSourceId)
  if (first === undefined) notFound()
  const view = await getView(ctx, first.id)
  if (!view.ok) notFound()

  const recordColumns = await withReadTransaction((tx) => readRecordColumns(tx, dataSourceId))
  const columns = listColumns('record', recordColumns)
  // 표의 이름 — 소스가 둘 이상이면 이 템플릿의 소스 이름이다(8e-2 · 데이터베이스 화면과 같은 규칙).
  const sources = database.value.dataSources
  const tableName =
    sources.length > 1 ? (sources.find((ds) => ds.id === dataSourceId)?.name ?? database.value.name) : database.value.name
  const row = rowJson(template)

  const [state, pageRefs, access] = await Promise.all([
    loadDocState(ctx, template.id),
    loadPageRefLabels(ctx, asBlockId(template.id)),
    pageAccess(ctx, template.id),
  ])
  if (!state.ok || pageRefs === null) notFound()

  const relationPropertyIds = columns.filter((c) => c.type === 'relation').map((c) => c.propertyId)
  const [relation, mentionLabels] = await Promise.all([
    relationPropertyIds.length === 0
      ? Promise.resolve({ labels: {}, icons: {} })
      : loadRelationLabels(ctx, relationIdsIn([template], relationPropertyIds)),
    loadMentionLabels(ctx, mentionIdsOf(readBodyYDoc(state.value.ydoc, template.id).doc)),
  ])

  const titlePropertyId = recordColumns.find((c) => c.type === 'title')?.propertyId ?? null

  // 경로 — 머리와 본문의 breadcrumb 블록(8b-2)이 같은 줄을 그린다(`block/breadcrumb.ts`).
  const trail = templateTrail({
    workspaceId,
    database: { id: databaseId, name: database.value.name, icon: database.value.icon },
    templateId: template.id,
  })

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <nav aria-label="상위 경로" className="flex flex-wrap items-center gap-1 text-sm text-neutral-500">
        {trail.map((item, i) => (
          <span key={`${item.kind}:${item.id}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href === null ? (
              <span className="text-neutral-400">{item.label}</span>
            ) : (
              <Link href={item.href} className="hover:underline underline-offset-4">
                {/* 표의 아이콘(8c-3b) — 경로는 글자의 줄이라 있을 때만 그린다(머리의 경로와 같다). */}
                <PageIconView icon={item.icon} className="mr-1" />
                {item.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/*
        08 의 "템플릿 편집 중" 배너. 화면이 표와 거의 같게 생겼는데 고치는 것은 **행이 아니라 템플릿**이므로,
        여기서 한 편집이 기존 행에 소급되지 않는다는 것도 함께 말한다(08: "템플릿 변경은 기존 행에 소급되지 않는다").
      */}
      <p
        role="status"
        data-testid="template-banner"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <strong className="font-medium">템플릿을 편집하고 있습니다.</strong> 여기서 채운 속성과 본문은 이 템플릿으로
        만드는 <em>새 항목</em>에 실립니다. 이미 만든 항목은 바뀌지 않습니다.
      </p>

      {/* 템플릿의 아이콘(8c-3a) — 이 템플릿으로 만드는 새 항목이 물려받는다(복제가 `format` 을 옮긴다). 제목 위에 선다. */}
      <div className="group/header flex flex-col gap-2">
        <PageIconControl
          workspaceId={workspaceId}
          pageId={template.id}
          initialIcon={template.icon}
          readOnly={!database.value.access.canEditContent}
        />
      <RowTitle
        workspaceId={workspaceId}
        rowId={template.id}
        titlePropertyId={titlePropertyId}
        initialTitle={template.title}
        canEdit={database.value.access.canEditContent}
        label="템플릿 이름"
        testId="template-title"
      />
      </div>

      <section className="flex flex-col gap-2" aria-label="템플릿 속성">
        {columns.length === 0 ? (
          <p className="text-sm text-neutral-500" data-testid="template-no-properties">
            이 표에는 미리 채울 속성이 없습니다. 표에서 속성을 만들면 여기에 나타납니다.
          </p>
        ) : (
          <DatabaseTable
            workspaceId={workspaceId}
            viewId={view.value.id}
            dataSourceId={view.value.dataSourceId}
            tableName={tableName}
            variant="record"
            columns={columns}
            rows={[row]}
            hasMore={false}
            nextCursor={null}
            relationLabels={relation.labels}
            relationIcons={relation.icons}
            // 템플릿 행의 rollup 은 서버가 계산하지 않는다 — `listColumns('record', …)` 가 그 컬럼을 아예 뺀다.
            rollupValues={EMPTY_ROLLUP_PAGE}
            // 수식은 템플릿에 채운 칸으로 계산해 보인다(2i-3a — 같은 행만 읽는다). 계획은 표의 속성 전부로.
            formulaPlan={formulaPlanOf(recordColumns, new Date())}
            access={database.value.access}
            sorts={[]}
          />
        )}
      </section>

      <BodyEditor
        workspaceId={workspaceId}
        pageId={template.id}
        userId={ctx.userId}
        collabUrl={collabServerUrl()}
        initialState={Buffer.from(Y.encodeStateAsUpdate(state.value.ydoc)).toString('base64')}
        canEdit={access === 'edit'}
        initialPageRefTitles={pageRefs.titles}
        initialMentionLabels={mentionLabels}
        initialPageIcons={{ ...pageRefs.icons, ...mentionLabels.pageIcons }}
        breadcrumb={trail}
      />
    </main>
  )
}
