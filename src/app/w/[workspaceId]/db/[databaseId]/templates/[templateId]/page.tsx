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
import { getView, listViews } from '@/lib/database/view'
import { listColumns } from '@/lib/database/list-layout'
import { loadRelationLabels, relationIdsIn } from '@/lib/database/relation'
import { EMPTY_ROLLUP_PAGE } from '@/lib/database/rollup'
import { rowJson } from '@/lib/database/http'
import { readLiveTemplate } from '@/lib/database/template'
import { withReadTransaction } from '@/lib/db/tx'
import { loadPageRefTitles } from '@/lib/block/save-page-body'
import { loadDocState, pageAccess } from '@/lib/collab/doc-store'
import { collabServerUrl } from '@/lib/collab/collab-url'
import { loadMentionLabels, mentionIdsOf } from '@/lib/block/mention-candidates'
import { readBodyYDoc } from '@/lib/collab/ydoc'
import { BodyEditor } from '../../../../[pageId]/body-editor'
import { DatabaseTable } from '../../database-table'
import { TemplateTitle } from './template-title'

const UNTITLED = '제목 없음'

export default async function TemplatePage({
  params,
}: PageProps<'/w/[workspaceId]/db/[databaseId]/templates/[templateId]'>) {
  const { workspaceId, databaseId, templateId } = await params

  const ctx = await requirePageSession(workspaceId)
  if (!isUuid(databaseId) || !isUuid(templateId)) notFound()

  // 볼 수 없는 표는 없는 표와 같다(§3.3-31).
  const database = await getDatabase(ctx, databaseId)
  if (!database.ok) notFound()

  const views = await listViews(ctx, databaseId)
  if (!views.ok || views.value.length === 0) notFound()
  // 컬럼 · 옵션은 뷰가 들고 있다. 템플릿은 뷰에 속하지 않으므로 **기본 뷰**의 컬럼으로 그린다 —
  // 속성을 숨긴 뷰를 따라가면 그 뷰에서 숨긴 속성을 템플릿에서 채울 길이 없어진다.
  const view = await getView(ctx, views.value[0].id)
  if (!view.ok) notFound()

  // "이 표의 살아 있는 템플릿인가"를 묻는 곳은 한 함수다(`template.ts`) — 권한은 위에서 이미 봤다.
  const template = await withReadTransaction((tx) => readLiveTemplate(tx, ctx, view.value.dataSourceId, templateId))
  if (template === null) notFound()

  const columns = listColumns('record', view.value.columns)
  const row = rowJson(template)

  const [state, pageRefTitles, access] = await Promise.all([
    loadDocState(ctx, template.id),
    loadPageRefTitles(ctx, asBlockId(template.id)),
    pageAccess(ctx, template.id),
  ])
  if (!state.ok || pageRefTitles === null) notFound()

  const relationPropertyIds = columns.filter((c) => c.type === 'relation').map((c) => c.propertyId)
  const [relationLabels, mentionLabels] = await Promise.all([
    relationPropertyIds.length === 0
      ? Promise.resolve({})
      : loadRelationLabels(ctx, relationIdsIn([template], relationPropertyIds)),
    loadMentionLabels(ctx, mentionIdsOf(readBodyYDoc(state.value.ydoc, template.id).doc)),
  ])

  const titlePropertyId = view.value.columns.find((c) => c.type === 'title')?.propertyId ?? null

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <nav aria-label="상위 경로" className="flex flex-wrap items-center gap-1 text-sm text-neutral-500">
        <Link href={`/w/${workspaceId}`} className="hover:underline underline-offset-4">
          워크스페이스
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/w/${workspaceId}/db/${databaseId}`} className="hover:underline underline-offset-4">
          {database.value.name || UNTITLED}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-neutral-400">템플릿</span>
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

      <TemplateTitle
        workspaceId={workspaceId}
        templateId={template.id}
        titlePropertyId={titlePropertyId}
        initialTitle={template.title}
        canEdit={database.value.access.canEditContent}
      />

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
            tableName={database.value.name}
            variant="record"
            columns={columns}
            rows={[row]}
            hasMore={false}
            nextCursor={null}
            relationLabels={relationLabels}
            // 템플릿 행의 rollup 은 서버가 계산하지 않는다 — `listColumns('record', …)` 가 그 컬럼을 아예 뺀다.
            rollupValues={EMPTY_ROLLUP_PAGE}
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
        initialPageRefTitles={pageRefTitles}
        initialMentionLabels={mentionLabels}
      />
    </main>
  )
}
