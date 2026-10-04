/**
 * 페이지 화면 — `/w/{workspaceId}/{pageId}`
 *
 * 경로 · 머리 단추 · 아이콘 · 제목 · 백링크 · 본문(협업 편집기) · 하위 페이지 목록.
 *
 * **데이터베이스 행도 여기서 연다**(8f-1 · F-16-07) — 행은 페이지다(C-3). 다른 것은 셋이다:
 *   · 경로는 조상 대신 그 행의 데이터베이스(`rowTrail`)
 *   · 제목의 정본은 제목 **셀**이다(`RowTitle` — `renamePage` 는 행을 거부한다)
 *   · 본문 위에 **속성 묶음** — 스키마 순서의 모든 속성을 세로로(`DatabaseTable variant="record"` — 템플릿 화면과 같은 모양 · 같은 함수).
 *     모듈 배치(어떤 속성을 어디에)는 데이터 소스의 것이고 본문은 행의 것이다(F-16-07). 숨기기 · 순서는 레이아웃(8f-2)
 * 행에 맞지 않는 머리 단추(공유 · 옮기기 · 내보내기 · 복제)는 세우지 않는다 — 행의 권한 · 자리는 데이터베이스가 정한다(§7).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import * as Y from 'yjs'

import { asBlockId } from '@/lib/ids'
import { requirePageVisitor } from '@/lib/auth/page-session'
import { getPage, listAncestors, listChildPages } from '@/lib/block/page'
import { breadcrumbTrail, rowTrail } from '@/lib/block/breadcrumb'
import { loadPageRefLabels } from '@/lib/block/save-page-body'
import { loadDocState, pageAccess } from '@/lib/collab/doc-store'
import { collabServerUrl } from '@/lib/collab/collab-url'
import { listMovableTargets, listTeamspaceDestinations } from '@/lib/block/move-page'
import { listDiscussions } from '@/lib/comment/discussion'
import { listBacklinks } from '@/lib/block/link-edges'
import { loadMentionLabels, mentionIdsOf } from '@/lib/block/mention-candidates'
import { readBodyYDoc } from '@/lib/collab/ydoc'
import { withReadTransaction } from '@/lib/db/tx'
import { isFavorite, recordVisit } from '@/lib/nav/recent'
import { noAccessState, outsiderNoAccessState } from '@/lib/permissions/access-request'
import { pageLockState } from '@/lib/permissions/lock'
import { getTeamspace } from '@/lib/workspace/teamspace'
import { NewPageButton } from '../new-page-button'
import { ExportButton } from '../export-button'
import { PageTitle } from './page-title'
import { PageIconControl } from './page-icon-control'
import { PageIconView } from '../page-icon-view'
import { BodyEditor } from './body-editor'
import { MovePageControl } from './move-page-control'
import { SharePanel } from './share-panel'
import { CommentPanel } from './comment-panel'
import { FavoriteButton } from './favorite-button'
import { DuplicatePageButton } from './duplicate-page-button'
import { DeletePageButton } from './delete-page-button'
import { NoAccess } from './no-access'
import { LockButton } from './lock-button'
import { PageHistoryButton } from './page-history'
import { canViewPageHistory } from '@/lib/history/version'
import { readRowPage } from '@/lib/database/row-page'
import { listColumns } from '@/lib/database/list-layout'
import { loadRelationLabels, relationIdsIn } from '@/lib/database/relation'
import { EMPTY_ROLLUP_PAGE } from '@/lib/database/rollup'
import { rowJson } from '@/lib/database/http'
import { RowTitle } from '../db/[databaseId]/row-title'
import { RowProperties } from './row-properties'

/** 제목 없는 페이지의 표시 문구. 저장된 값은 빈 배열이다. */
const UNTITLED = '제목 없음'

export default async function PageView({ params, searchParams }: PageProps<'/w/[workspaceId]/[pageId]'>) {
  const { workspaceId, pageId: rawPageId } = await params
  // 인박스의 접근 요청 줄은 공유 패널을 연 채로 온다(`?share=1` · 7e-1).
  const { share } = await searchParams

  const visitor = await requirePageVisitor(workspaceId)

  let pageId
  try {
    pageId = asBlockId(rawPageId)
  } catch {
    notFound()
  }

  // 워크스페이스 밖의 사람(7g-2) — 요청할 수 있는 페이지면(정책이 허락하고 · 살아 있는 페이지) 요청 화면, 아니면 404. 그 사람에게는
  // 이 워크스페이스의 아무것도 읽지 않는다(정본 §3.3 [보강] 접근 요청 ⑩ (b)).
  if ('outsider' in visitor) {
    const outsiderState = await outsiderNoAccessState(visitor.outsider, pageId)
    if (outsiderState === null) notFound()
    return <NoAccess workspaceId={workspaceId} pageId={pageId} requested={outsiderState.requested} outsider />
  }
  const ctx = visitor.member

  const page = await getPage(ctx, pageId)
  if (!page) {
    // 볼 수 없는 **살아 있는** 페이지면 접근 요청 화면이다(7e-1 · F-06-15) — 그 주소의 페이지가 있다는 것만 알리고 제목은
    // 싣지 않는다(정본 §3.3 [보강] 접근 요청 ②). 없는 페이지 · 휴지통 · 다른 워크스페이스는 여전히 404 다 — getPage 가
    // workspace_id 를 술어에 넣으므로 다른 워크스페이스의 페이지도 여기로 온다.
    const noAccess = await noAccessState(ctx, pageId)
    if (noAccess === null) notFound()
    return <NoAccess workspaceId={workspaceId} pageId={pageId} requested={noAccess.requested} />
  }

  // 본문은 Y.Doc 이 정본이다(판결 X-1 · CRDT 6d) — 협업 편집기가 그 상태로 시작하고 협업 서버에 붙는다. 행으로 만든 문서는
  // 더 이상 화면이 읽지 않고, 참조 제목만 따로 받는다(참조 노드는 제목을 싣지 않는다 — §3.2-22).
  const [ancestors, children, state, pageRefs, access, moveTargets, moveTeamspaces, favorite, openThreads, lock, history, rowPage] = await Promise.all([
    listAncestors(ctx, page),
    listChildPages(ctx, page.id),
    loadDocState(ctx, page.id),
    loadPageRefLabels(ctx, page.id),
    pageAccess(ctx, page.id),
    listMovableTargets(ctx, page.id),
    listTeamspaceDestinations(ctx),
    isFavorite(ctx, page.id),
    // 버튼에 띄울 수만 먼저 읽는다 — 패널을 열기 전에 목록을 한 번 더 부르지 않으려고.
    listDiscussions(ctx, page.id, { resolved: false }),
    // 잠금(7f-1) — 본문 · 제목의 편집 여부는 `access` 가 이미 담는다(잠긴 페이지는 view). 이것은 "잠김" 표시와 버튼용이다.
    pageLockState(ctx, page.id),
    // 기록(8d-2) — 고칠 수 있는 사람에게만 단추를 세운다(잠긴 페이지도 기록은 본다 · 라우트가 다시 묻는다).
    canViewPageHistory(ctx, page.id),
    // 데이터베이스 행이면 속성 묶음 · 제목 셀 · 그 데이터베이스(8f-1). 보통 페이지면 null.
    readRowPage(ctx, page.id),
  ])

  // 방문 기록(F-07-04). **`getPage` 를 통과한 뒤**에 남긴다 — 볼 수 없는 페이지를
  // 열어본 흔적이 남으면 그 자체가 존재를 알려주는 신호가 된다.
  // 실패해도 던지지 않는다(`recordVisit` 머리말): 기록이 빠지는 것이 화면이
  // 안 열리는 것보다 낫다.
  await recordVisit(ctx, page.id)
  // getPage 가 통과했으므로 여기서 실패하면 그 사이에 지워진 것이다.
  if (!state.ok || pageRefs === null) notFound()

  // 멘션 노드에는 id 뿐이다 — 이름 · 제목은 권한으로 거른 맵으로 준다(참조 제목과 같은 규칙 · §3.2-22). 백링크는
  // 역인덱스(`link_edge`)에서, 볼 수 있는 페이지만(F-07-09).
  // breadcrumb 의 teamspace(7c-2) — 루트 페이지의 부모다. 루트가 보이지 않으면(따로 공유받은 하위 페이지) 모른다. 이름은
  // **멤버에게만** 세운다 — 그 링크(teamspace 화면)는 멤버가 아니면 404 다(`getTeamspace`).
  const rootTeamspaceId = page.teamspaceId ?? ancestors[0]?.teamspaceId ?? null
  const [mentionLabels, backlinks, teamspace] = await Promise.all([
    loadMentionLabels(ctx, mentionIdsOf(readBodyYDoc(state.value.ydoc, page.id).doc)),
    withReadTransaction((tx) => listBacklinks(tx, ctx, page.id)),
    rootTeamspaceId === null ? null : getTeamspace(ctx, rootTeamspaceId),
  ])

  // 경로 — 머리와 본문의 breadcrumb 블록(8b-2)이 같은 줄을 그린다(`block/breadcrumb.ts` — 볼 수 있는 조상만 · teamspace 는 멤버에게만).
  // 행이면 조상 대신 그 행의 데이터베이스다(8f-1).
  const trail =
    rowPage !== null
      ? rowTrail({
          workspaceId,
          database: { id: rowPage.databaseId, name: rowPage.databaseName, icon: rowPage.databaseIcon },
          row: { id: page.id, title: rowPage.row.title, icon: page.icon },
        })
      : breadcrumbTrail({
          workspaceId,
          teamspace: teamspace?.ok ? { id: teamspace.value.id, name: teamspace.value.name, icon: teamspace.value.icon } : null,
          ancestors,
          page,
        })

  // ── 행의 속성 묶음(8f-1) ──
  // 셀을 고칠 수 있는가 — 데이터베이스의 `edit_content` 이고 **이 행 페이지가 잠기지 않았다**(7f-2 — 행의 값을 쓰는 길은 그 행의 잠금을
  // 묻는다 · `access` 가 잠김을 이미 담는다). 서버가 다시 묻는다.
  const rowColumns = rowPage === null ? [] : listColumns('record', rowPage.columns)
  const rowAccess = rowPage === null ? null : { ...rowPage.access, canEditContent: rowPage.access.canEditContent && access === 'edit' }
  const rowRelationIds = rowColumns.filter((c) => c.type === 'relation').map((c) => c.propertyId)
  const rowRelation =
    rowPage === null || rowRelationIds.length === 0
      ? { labels: {}, icons: {} }
      : await loadRelationLabels(ctx, relationIdsIn([rowPage.row], rowRelationIds))

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex items-start justify-between gap-3">
        <nav
          aria-label="상위 경로"
          className="flex flex-wrap items-center gap-1 text-sm text-neutral-500"
        >
          {trail.map((item, i) => (
            <span key={`${item.kind}:${item.id}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {item.href === null ? (
                <span className="text-neutral-400">
                  <PageIconView icon={item.icon} className="mr-1" />
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  data-testid={item.kind === 'teamspace' ? 'breadcrumb-teamspace' : undefined}
                  className="hover:underline underline-offset-4"
                >
                  <PageIconView icon={item.icon} className="mr-1" />
                  {item.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="flex flex-none items-start gap-2">
          <LockButton
            lockUrl={`/api/workspaces/${workspaceId}/pages/${page.id}/lock`}
            locked={lock?.locked ?? false}
            canToggle={lock?.canToggle ?? false}
            reloadOnUnlock
            hint="잠긴 페이지 — 본문과 제목을 고칠 수 없습니다"
          />
          <FavoriteButton workspaceId={workspaceId} pageId={page.id} initial={favorite} />
          <CommentPanel
            workspaceId={workspaceId}
            pageId={page.id}
            initialOpenCount={openThreads.ok ? openThreads.discussions.length : 0}
          />
          {/* 행의 권한 · 자리는 데이터베이스가 정한다 — 공유 · 옮기기 · 내보내기 · 복제는 행에 세우지 않는다(8f-1 · §7). */}
          {rowPage === null && <SharePanel workspaceId={workspaceId} pageId={page.id} initialOpen={share === '1'} />}
          {rowPage === null && (
          <MovePageControl
            workspaceId={workspaceId}
            pageId={page.id}
            currentParentId={page.parentPageId}
            currentTeamspaceId={page.teamspaceId}
            currentPrivate={page.ownerUserId !== null && page.ownerUserId === ctx.userId}
            targets={moveTargets.map((t) => ({
              id: t.id,
              title: t.title,
              icon: t.icon,
              path: [...t.path],
            }))}
            teamspaces={moveTeamspaces}
          />
          )}
          {history && <PageHistoryButton workspaceId={workspaceId} pageId={page.id} />}
          {rowPage === null && <ExportButton workspaceId={workspaceId} rootId={page.id} />}
          {/* 복제는 원본을 고치지 않는다 — 볼 수만 있는 사람도 누를 수 있다(자리가 없으면 서버가 거부한다). */}
          {rowPage === null && <DuplicatePageButton workspaceId={workspaceId} pageId={page.id} />}
          <DeletePageButton
            workspaceId={workspaceId}
            pageId={page.id}
            childCount={children.length}
            parentPageId={page.parentPageId}
            // 행을 지우면 그 표로 돌아간다(행에는 부모 페이지가 없다).
            returnHref={rowPage === null ? undefined : `/w/${workspaceId}/db/${rowPage.databaseId}`}
          />
        </div>
      </div>

      {/* 아이콘(8c-1)은 제목 위에 선다 — "아이콘 추가"는 이 머리에 마우스를 올리면 보인다(`group/header`). */}
      <div className="group/header flex flex-col gap-2">
        <PageIconControl workspaceId={workspaceId} pageId={page.id} initialIcon={page.icon} readOnly={access !== 'edit'} />
        {rowPage !== null && rowAccess !== null ? (
          <RowTitle
            workspaceId={workspaceId}
            rowId={page.id}
            titlePropertyId={rowPage.titlePropertyId}
            initialTitle={rowPage.row.title}
            canEdit={rowAccess.canEditContent}
            label="제목"
            testId="row-title"
          />
        ) : (
          <PageTitle workspaceId={workspaceId} pageId={page.id} initialTitle={page.plainTitle} readOnly={access !== 'edit'} />
        )}
      </div>

      {/*
        행의 속성 묶음(8f-1 · F-16-03) — 본문 위에 선다(F-16-07 *"제목 아래 … 모듈들 → 자유 본문 블록 순"*). 제목은 위의 제목 칸이라
        여기서 뺀다. 남는 속성이 없으면 그리지 않는다(F-16-03 *"잔여 0개 … 읽기 모드에서는 렌더 생략"*).
      */}
      {rowPage !== null && rowAccess !== null && rowColumns.length > 0 && (
        <section aria-label="속성" data-testid="row-properties" className="flex flex-col gap-2">
          <RowProperties
            workspaceId={workspaceId}
            viewId={rowPage.viewId}
            dataSourceId={rowPage.dataSourceId}
            tableName={rowPage.tableName}
            variant="record"
            columns={rowColumns}
            rows={[rowJson(rowPage.row)]}
            hasMore={false}
            nextCursor={null}
            relationLabels={rowRelation.labels}
            relationIcons={rowRelation.icons}
            // rollup 은 레코드 모양에서 빠진다(`listColumns('record', …)` — 템플릿 화면과 같다 · §7).
            rollupValues={EMPTY_ROLLUP_PAGE}
            access={rowAccess}
            sorts={[]}
          />
        </section>
      )}

      {/* 백링크 — F-07-09 "제목 아래 `{#} backlinks`, 접힌 채로". 볼 수 없는 페이지는 개수에도 없다. */}
      {backlinks.length > 0 && (
        <details aria-label="백링크" className="text-sm text-neutral-500">
          <summary className="cursor-pointer select-none">이 페이지를 멘션한 페이지 {backlinks.length}</summary>
          <ul className="mt-1 flex flex-col gap-1 pl-4">
            {backlinks.map((b) => (
              <li key={b.pageId}>
                <Link href={`/w/${workspaceId}/${b.pageId}`} className="hover:underline underline-offset-4">
                  <PageIconView icon={b.icon} fallback className="mr-1.5 align-[-0.125em]" />
                  {b.title || UNTITLED}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <BodyEditor
        workspaceId={workspaceId}
        pageId={page.id}
        userId={ctx.userId}
        collabUrl={collabServerUrl()}
        initialState={Buffer.from(Y.encodeStateAsUpdate(state.value.ydoc)).toString('base64')}
        canEdit={access === 'edit'}
        locked={lock?.locked ?? false}
        initialPageRefTitles={pageRefs.titles}
        initialMentionLabels={mentionLabels}
        // 하위 페이지 참조 · 멘션의 아이콘(8c-2) — 둘 다 권한으로 거른 맵에서 왔다(볼 수 있고 아이콘이 있는 것만).
        initialPageIcons={{ ...pageRefs.icons, ...mentionLabels.pageIcons }}
        breadcrumb={trail}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">
          하위 페이지 {children.length > 0 && children.length}
        </h2>
        {children.length > 0 && (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/w/${workspaceId}/${c.id}`}
                  className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <PageIconView icon={c.icon} fallback />
                  {c.plainTitle || UNTITLED}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <NewPageButton workspaceId={workspaceId} parentPageId={page.id} label="하위 페이지" />
      </section>
    </main>
  )
}
