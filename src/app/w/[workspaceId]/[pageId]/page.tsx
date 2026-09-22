/**
 * 페이지 화면 — `/w/{workspaceId}/{pageId}`
 *
 * W4 1단계. **본문 에디터는 아직 없다** — 여기에 Tiptap 이 들어온다.
 * 지금 있는 것은 breadcrumb · 제목 · 하위 페이지 목록이고, 이것들은
 * 에디터가 붙은 뒤에도 그대로 남는다(에디터는 본문 영역만 차지한다).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import * as Y from 'yjs'

import { asBlockId } from '@/lib/ids'
import { requirePageSession } from '@/lib/auth/page-session'
import { getPage, listAncestors, listChildPages } from '@/lib/block/page'
import { loadPageRefTitles } from '@/lib/block/save-page-body'
import { loadDocState, pageAccess } from '@/lib/collab/doc-store'
import { collabServerUrl } from '@/lib/collab/collab-url'
import { listMovableTargets } from '@/lib/block/move-page'
import { listDiscussions } from '@/lib/comment/discussion'
import { listBacklinks } from '@/lib/block/link-edges'
import { loadMentionLabels, mentionIdsOf } from '@/lib/block/mention-candidates'
import { readBodyYDoc } from '@/lib/collab/ydoc'
import { withReadTransaction } from '@/lib/db/tx'
import { isFavorite, recordVisit } from '@/lib/nav/recent'
import { getTeamspace } from '@/lib/workspace/teamspace'
import { NewPageButton } from '../new-page-button'
import { ExportButton } from '../export-button'
import { PageTitle } from './page-title'
import { BodyEditor } from './body-editor'
import { MovePageControl } from './move-page-control'
import { SharePanel } from './share-panel'
import { CommentPanel } from './comment-panel'
import { FavoriteButton } from './favorite-button'
import { DuplicatePageButton } from './duplicate-page-button'
import { DeletePageButton } from './delete-page-button'

/** 제목 없는 페이지의 표시 문구. 저장된 값은 빈 배열이다. */
const UNTITLED = '제목 없음'

export default async function PageView({ params }: PageProps<'/w/[workspaceId]/[pageId]'>) {
  const { workspaceId, pageId: rawPageId } = await params

  const ctx = await requirePageSession(workspaceId)

  let pageId
  try {
    pageId = asBlockId(rawPageId)
  } catch {
    notFound()
  }

  const page = await getPage(ctx, pageId)
  // 다른 워크스페이스의 페이지도 여기로 온다 — getPage 가 workspace_id 를
  // 술어에 넣으므로 null 이 되고, 404 는 "없다"와 "볼 수 없다"를 구분하지 않는다.
  if (!page) notFound()

  // 본문은 Y.Doc 이 정본이다(판결 X-1 · CRDT 6d) — 협업 편집기가 그 상태로 시작하고 협업 서버에 붙는다. 행으로 만든 문서는
  // 더 이상 화면이 읽지 않고, 참조 제목만 따로 받는다(참조 노드는 제목을 싣지 않는다 — §3.2-22).
  const [ancestors, children, state, pageRefTitles, access, moveTargets, favorite, openThreads] = await Promise.all([
    listAncestors(ctx, page),
    listChildPages(ctx, page.id),
    loadDocState(ctx, page.id),
    loadPageRefTitles(ctx, page.id),
    pageAccess(ctx, page.id),
    listMovableTargets(ctx, page.id),
    isFavorite(ctx, page.id),
    // 버튼에 띄울 수만 먼저 읽는다 — 패널을 열기 전에 목록을 한 번 더 부르지 않으려고.
    listDiscussions(ctx, page.id, { resolved: false }),
  ])

  // 방문 기록(F-07-04). **`getPage` 를 통과한 뒤**에 남긴다 — 볼 수 없는 페이지를
  // 열어본 흔적이 남으면 그 자체가 존재를 알려주는 신호가 된다.
  // 실패해도 던지지 않는다(`recordVisit` 머리말): 기록이 빠지는 것이 화면이
  // 안 열리는 것보다 낫다.
  await recordVisit(ctx, page.id)
  // getPage 가 통과했으므로 여기서 실패하면 그 사이에 지워진 것이다.
  if (!state.ok || pageRefTitles === null) notFound()

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

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex items-start justify-between gap-3">
        <nav
          aria-label="상위 경로"
          className="flex flex-wrap items-center gap-1 text-sm text-neutral-500"
        >
          <Link href={`/w/${workspaceId}`} className="hover:underline underline-offset-4">
            워크스페이스
          </Link>
          {teamspace?.ok && (
            <span className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <Link
                href={`/w/${workspaceId}/teamspaces/${teamspace.value.id}`}
                data-testid="breadcrumb-teamspace"
                className="hover:underline underline-offset-4"
              >
                {teamspace.value.name}
              </Link>
            </span>
          )}
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <Link href={`/w/${workspaceId}/${a.id}`} className="hover:underline underline-offset-4">
                {a.plainTitle || UNTITLED}
              </Link>
            </span>
          ))}
          <span aria-hidden>/</span>
          <span className="text-neutral-400">{page.plainTitle || UNTITLED}</span>
        </nav>

        <div className="flex flex-none items-start gap-2">
          <FavoriteButton workspaceId={workspaceId} pageId={page.id} initial={favorite} />
          <CommentPanel
            workspaceId={workspaceId}
            pageId={page.id}
            initialOpenCount={openThreads.ok ? openThreads.discussions.length : 0}
          />
          <SharePanel workspaceId={workspaceId} pageId={page.id} />
          <MovePageControl
            workspaceId={workspaceId}
            pageId={page.id}
            currentParentId={page.parentPageId}
            targets={moveTargets.map((t) => ({
              id: t.id,
              title: t.title,
              path: [...t.path],
            }))}
          />
          <ExportButton workspaceId={workspaceId} rootId={page.id} />
          {/* 복제는 원본을 고치지 않는다 — 볼 수만 있는 사람도 누를 수 있다(자리가 없으면 서버가 거부한다). */}
          <DuplicatePageButton workspaceId={workspaceId} pageId={page.id} />
          <DeletePageButton
            workspaceId={workspaceId}
            pageId={page.id}
            childCount={children.length}
            parentPageId={page.parentPageId}
          />
        </div>
      </div>

      <PageTitle workspaceId={workspaceId} pageId={page.id} initialTitle={page.plainTitle} />

      {/* 백링크 — F-07-09 "제목 아래 `{#} backlinks`, 접힌 채로". 볼 수 없는 페이지는 개수에도 없다. */}
      {backlinks.length > 0 && (
        <details aria-label="백링크" className="text-sm text-neutral-500">
          <summary className="cursor-pointer select-none">이 페이지를 멘션한 페이지 {backlinks.length}</summary>
          <ul className="mt-1 flex flex-col gap-1 pl-4">
            {backlinks.map((b) => (
              <li key={b.pageId}>
                <Link href={`/w/${workspaceId}/${b.pageId}`} className="hover:underline underline-offset-4">
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
        initialPageRefTitles={pageRefTitles}
        initialMentionLabels={mentionLabels}
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
                  className="block px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
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
