/**
 * 페이지의 몸 — 행 화면과 데이터베이스 화면의 피크가 함께 쓴다 (8n-1 · F-02-20)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 페이지 열기 모드 ②
 *
 * 경로 · 머리 단추 · 아이콘 · 제목 · 속성 묶음 · 백링크 · 본문(협업 편집기) · 하위 페이지. 다른 것은 틀(`frame`)뿐이다 — 페이지는 화면
 * 전체, 피크는 패널. 볼 수 없거나 없는 페이지는 페이지면 404 · 접근 요청 화면 그대로, **피크면 패널 안에서** 그렇다고 말한다(데이터베이스
 * 화면 전체를 404 로 만들지 않는다). 세션 · 워크스페이스 밖의 사람 · id 해석은 부르는 쪽(`page.tsx` · 데이터베이스 화면)이 한다.
 */

import Link from '@/app/link'
import { notFound } from 'next/navigation'

import * as Y from 'yjs'

import type { BlockId } from '@/lib/ids'
import type { SessionContext } from '@/lib/auth/session-context'
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
import { noAccessState } from '@/lib/permissions/access-request'
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
import { PageMenu, PageMenuDivider } from './page-menu'
import { PageHistoryButton } from './page-history'
import { PageUpdatesButton } from './page-updates'
import { canViewPageHistory } from '@/lib/history/version'
import { readRowPage } from '@/lib/database/row-page'
import { listColumns } from '@/lib/database/list-layout'
import { loadRelationLabels, relationIdsIn } from '@/lib/database/relation'
import { loadPeopleNames, peopleIdsOf } from '@/lib/database/people'
import { EMPTY_ROLLUP_PAGE } from '@/lib/database/rollup'
import { formulaPlanOf } from '@/lib/database/formula-plan'
import { rowJson } from '@/lib/database/http'
import { RowTitle } from '../db/[databaseId]/row-title'
import type { feedClock } from '@/lib/database/row-feed'
import { RowProperties } from './row-properties'
import { SCREEN_TITLES, contentTitle } from '@/lib/nav/screen-title'
import { DocumentTitle } from '../document-title'

/** 제목 없는 페이지의 표시 문구. 저장된 값은 빈 배열이다. */
const UNTITLED = '제목 없음'

/** 페이지 화면 전체 · 데이터베이스 화면의 피크 패널. */
export type PageFrame = 'page' | 'peek'

/** 볼 수 없거나 없는 페이지 — 페이지면 404, 피크면 패널 안의 한 줄(정본 [보강] 페이지 열기 모드 ②). */
function missing(frame: PageFrame) {
  if (frame === 'page') notFound()
  return (
    <p data-testid="peek-missing" className="px-8 py-6 text-sm text-neutral-500">
      이 페이지를 열 수 없습니다 — 지워졌거나 볼 권한이 없습니다.
    </p>
  )
}

export async function PageContent({
  ctx,
  workspaceId,
  pageId,
  shareOpen,
  renderedAt,
  frame,
}: {
  ctx: SessionContext
  workspaceId: string
  pageId: BlockId
  /** 공유 패널을 연 채로(`?share=1` — 인박스의 접근 요청 줄 · 7e-1). 피크는 늘 닫힌 채. */
  shareOpen: boolean
  /** 읽기 전의 시각 — 행 페이지의 속성 묶음이 구독할 때 들고 가 그 사이의 레이아웃 변경을 메운다(#250). */
  renderedAt: ReturnType<typeof feedClock>
  frame: PageFrame
}) {
  const page = await getPage(ctx, pageId)
  if (!page) {
    // 볼 수 없는 **살아 있는** 페이지면 접근 요청 화면이다(7e-1 · F-06-15) — 그 주소의 페이지가 있다는 것만 알리고 제목은
    // 싣지 않는다(정본 §3.3 [보강] 접근 요청 ②). 없는 페이지 · 휴지통 · 다른 워크스페이스는 여전히 404 다 — getPage 가
    // workspace_id 를 술어에 넣으므로 다른 워크스페이스의 페이지도 여기로 온다.
    const noAccess = await noAccessState(ctx, pageId)
    if (noAccess === null) return missing(frame)
    return (
      <>
        {/* 탭 제목(10d-7b) — 이름을 싣지 않는다. 피크는 탭을 바꾸지 않는다 */}
        {frame === 'page' && <DocumentTitle title={SCREEN_TITLES.noAccess} />}
        <NoAccess workspaceId={workspaceId} pageId={pageId} requested={noAccess.requested} />
      </>
    )
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
  if (!state.ok || pageRefs === null) return missing(frame)

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
          // 못 여는 데이터베이스는 경로에 세우지 않는다(6f-2b-2)
          database: rowPage.databaseOpenable ? { id: rowPage.databaseId, name: rowPage.databaseName, icon: rowPage.databaseIcon } : null,
          row: { id: page.id, title: rowPage.row.title, icon: page.icon },
        })
      : breadcrumbTrail({
          workspaceId,
          teamspace: teamspace?.ok ? { id: teamspace.value.id, name: teamspace.value.name, icon: teamspace.value.icon } : null,
          ancestors,
          page,
        })

  // ── 행의 속성 묶음(8f-1 · 8f-2) ──
  // 셀을 고칠 수 있는가 — **이 행의** 편집이고(6f-2b-1 — 셀 쓰기는 그 행의 권한으로 묻는다 · 만든 사람 규칙으로 자기 행만 고치는 사람도)
  // **이 행 페이지가 잠기지 않았다**(7f-2 — `access` 가 잠김을 이미 담는다). 구조(옵션 만들기 · 레이아웃)는 데이터베이스의 것이다 —
  // 데이터베이스가 잠기거나 못 열면 `readRowPage` 가 닫아서 준다. 행 페이지의 잠금은 레이아웃을 막지 않는다. 서버가 다시 묻는다.
  const rowColumns = rowPage === null ? [] : listColumns('record', rowPage.columns)
  const rowAccess = rowPage === null ? null : { ...rowPage.access, canEditContent: access === 'edit' }
  const rowRelationIds = rowColumns.filter((c) => c.type === 'relation').map((c) => c.propertyId)
  // 행 페이지의 페이지 설정(3b-2 · F-16-09 · F-16-10) — 레이아웃의 것이다(데이터베이스의 모든 행에 같다 · 정본 [보강] 페이지 설정 ③).
  // 일반 페이지는 null — 지금의 모양(좁게 · 접은 백링크 · 코멘트 단추 · 칠한 코멘트)이 그대로다.
  const settings = rowPage?.settings ?? null
  const rowRelation =
    rowPage === null || rowRelationIds.length === 0
      ? { labels: {}, icons: {} }
      : await loadRelationLabels(ctx, relationIdsIn([rowPage.row], rowRelationIds))
  // 사람 칸의 이름(6g-2) — 이 행에 든 사람만
  const rowPeopleIds = rowColumns.filter((c) => c.type === 'people').map((c) => c.propertyId)
  const rowPeopleNames =
    rowPage === null || rowPeopleIds.length === 0
      ? {}
      : await loadPeopleNames(ctx, peopleIdsOf(rowPeopleIds.map((id) => rowPage.row.properties[id])))

  // 틀만 다르다 — 페이지는 화면 전체(`main`) · 피크는 데이터베이스 화면의 패널 안(`div`)
  const Frame = frame === 'page' ? 'main' : 'div'
  return (
    <Frame
      // 페이지는 상단 바(본문 칸 밖 · 디자인-2a) + 본문 칸 · 피크는 패널 안에 그대로(본문 칸이 `contents` 라 머리와 같은 줄에 선다)
      className={frame === 'page' ? 'flex min-h-screen flex-col' : 'flex flex-col gap-6 px-8 py-6'}
      data-testid={frame === 'peek' ? 'peek-page' : undefined}
      data-full-width={settings?.fullWidth ? 'true' : undefined}
      data-inline-comments={settings?.inlineComments}
    >
      {/* 탭 제목(10d-7b) — 그 페이지의 평문 제목(행 페이지도). 피크는 탭을 바꾸지 않는다(화면은 데이터베이스다) */}
      {frame === 'page' && <DocumentTitle title={contentTitle(page.plainTitle)} />}
      {/*
        상단 바(디자인-2a · 노션 실측: 높이 44px · 배경과 같은 바탕 · 아래 선 없음) — 왼쪽 경로 · 오른쪽 머리 단추. 페이지는 본문 칸 밖에서
        위에 고정한다(스크롤해도 남는다). 좁은 화면(md 미만 · 10j-1)에서는 감는다 — 한 줄이면 폰에서 문서 폭이 715px 로 늘었다.
      */}
      <div
        data-testid="page-topbar"
        className={
          frame === 'page'
            ? 'sticky top-0 z-30 flex min-h-11 flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-[var(--background)] px-3 py-1'
            : 'flex flex-wrap items-center justify-between gap-2'
        }
      >
        <nav
          aria-label="상위 경로"
          className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm text-[rgb(44,44,43)] dark:text-neutral-200"
        >
          {trail.map((item, i) => (
            <span key={`${item.kind}:${item.id}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="text-neutral-300 dark:text-neutral-600">/</span>}
              {item.href === null ? (
                <span className="rounded-md px-1.5 py-0.5 text-neutral-400">
                  <PageIconView icon={item.icon} className="mr-1" />
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  data-testid={item.kind === 'teamspace' ? 'breadcrumb-teamspace' : undefined}
                  className="rounded-md px-1.5 py-0.5 hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
                >
                  <PageIconView icon={item.icon} className="mr-1" />
                  {item.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-0.5 md:flex-none md:flex-nowrap">
          {/* 잠김 표시는 상단 바에 · 잠그기 단추는 페이지 메뉴에(디자인-2b) */}
          <LockButton
            lockUrl={`/api/workspaces/${workspaceId}/pages/${page.id}/lock`}
            locked={lock?.locked ?? false}
            canToggle={lock?.canToggle ?? false}
            reloadOnUnlock
            hint="잠긴 페이지 — 본문과 제목을 고칠 수 없습니다"
            part="badge"
          />
          <CommentPanel
            workspaceId={workspaceId}
            pageId={page.id}
            initialOpenCount={openThreads.ok ? openThreads.discussions.length : 0}
            showToggle={settings?.showDiscussions ?? true}
          />
          {/* 행의 권한 · 자리는 데이터베이스가 정한다 — 공유 · 옮기기 · 내보내기 · 복제는 행에 세우지 않는다(8f-1 · §7). */}
          {rowPage === null && <SharePanel workspaceId={workspaceId} pageId={page.id} initialOpen={shareOpen} />}
          <FavoriteButton workspaceId={workspaceId} pageId={page.id} initial={favorite} />
          {/*
            페이지 메뉴(디자인-2b · 노션: 복제 · 옮기기 · 버전 기록 · 잠금 · 휴지통은 "···" 안) — 안의 부품은 메뉴 줄 모양이 되고 패널은
            카드 자리에 연다(`page-menu.tsx`).
          */}
          <PageMenu>
            <LockButton
              lockUrl={`/api/workspaces/${workspaceId}/pages/${page.id}/lock`}
              locked={lock?.locked ?? false}
              canToggle={lock?.canToggle ?? false}
              reloadOnUnlock
              hint="잠긴 페이지 — 본문과 제목을 고칠 수 없습니다"
              part="toggle"
            />
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
            {/* 복제는 원본을 고치지 않는다 — 볼 수만 있는 사람도 누를 수 있다(자리가 없으면 서버가 거부한다). */}
            {rowPage === null && <DuplicatePageButton workspaceId={workspaceId} pageId={page.id} />}
            {history && <PageHistoryButton workspaceId={workspaceId} pageId={page.id} />}
            {/* 업데이트(4d-3 · F-11-04) — 볼 수 있는 사람 모두 · 행도 */}
            <PageUpdatesButton workspaceId={workspaceId} pageId={page.id} />
            {rowPage === null && <ExportButton workspaceId={workspaceId} rootId={page.id} />}
            <PageMenuDivider />
            <DeletePageButton
              workspaceId={workspaceId}
              pageId={page.id}
              childCount={children.length}
              parentPageId={page.parentPageId}
              // 행을 지우면 그 표로 돌아간다(행에는 부모 페이지가 없다).
              returnHref={rowPage === null || !rowPage.databaseOpenable ? undefined : `/w/${workspaceId}/db/${rowPage.databaseId}`}
            />
          </PageMenu>
        </div>
      </div>

      {/* 본문 칸 — 페이지는 가운데 720px(전체 폭이면 넓게) · 피크는 패널의 줄 그대로(`contents`) */}
      <div
        className={
          frame === 'page'
            ? `mx-auto flex w-full ${settings?.fullWidth ? 'max-w-none' : 'max-w-3xl'} flex-1 flex-col gap-6 px-6 pb-12 pt-12`
            : 'contents'
        }
      >
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
        여기서 뺀다. 남는 속성이 없으면 그리지 않는다(F-16-03 *"잔여 0개 … 읽기 모드에서는 렌더 생략"*). 숨긴 속성 · 레이아웃 편집은
        묶음 안에서 갈린다(8f-2 · `row-property-group.tsx`).
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
            layoutVersion={rowPage.layoutVersion}
            layoutUndo={rowPage.layoutUndo}
            pinned={rowPage.pinned}
            main={rowPage.main}
            panel={rowPage.panel}
            settings={rowPage.settings}
            showPropertyIcons={rowPage.settings.showPropertyIcons}
            canEditLayout={rowAccess.canEditStructure}
            rows={[rowJson(rowPage.row)]}
            hasMore={false}
            nextCursor={null}
            relationLabels={rowRelation.labels}
            peopleNames={rowPeopleNames}
            relationIcons={rowRelation.icons}
            // rollup 은 레코드 모양에서 빠진다(`listColumns('record', …)` — 템플릿 화면과 같다 · §7).
            rollupValues={EMPTY_ROLLUP_PAGE}
            // 수식은 그 행의 칸으로 화면이 계산한다(2i-3a) — 계획은 표의 속성 전부로(제목 · 숨긴 속성도 수식은 읽는다).
            formulaPlan={formulaPlanOf(rowPage.columns, new Date())}
            access={rowAccess}
            sorts={[]}
            renderedAt={renderedAt}
          />
        </section>
      )}

      {/*
        백링크 — F-07-09 "제목 아래 `{#} backlinks`, 접힌 채로". 볼 수 없는 페이지는 개수에도 없다. 행 페이지는 레이아웃이 정한다(3b-2 ·
        F-16-09) — 늘 펼침 · 접어 둠(기본 — 16 의 "호버할 때만"을 누르면 펼치는 것으로 · 터치 화면에도 같은 길) · 보이지 않음.
      */}
      {backlinks.length > 0 && settings?.backlinks !== 'off' && (
        <details
          aria-label="백링크"
          data-testid="page-backlinks"
          open={settings?.backlinks === 'always'}
          className="text-sm text-neutral-500"
        >
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
      </div>
    </Frame>
  )
}
