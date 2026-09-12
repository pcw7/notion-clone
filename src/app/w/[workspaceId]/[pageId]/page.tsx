/**
 * 페이지 화면 — `/w/{workspaceId}/{pageId}`
 *
 * W4 1단계. **본문 에디터는 아직 없다** — 여기에 Tiptap 이 들어온다.
 * 지금 있는 것은 breadcrumb · 제목 · 하위 페이지 목록이고, 이것들은
 * 에디터가 붙은 뒤에도 그대로 남는다(에디터는 본문 영역만 차지한다).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { asBlockId } from '@/lib/ids'
import { requirePageSession } from '@/lib/auth/page-session'
import { getPage, listAncestors, listChildPages } from '@/lib/block/page'
import { loadPageBody } from '@/lib/block/save-page-body'
import { listMovableTargets } from '@/lib/block/move-page'
import { isFavorite, recordVisit } from '@/lib/nav/recent'
import { NewPageButton } from '../new-page-button'
import { PageTitle } from './page-title'
import { BodyEditor } from './body-editor'
import { MovePageControl } from './move-page-control'
import { SharePanel } from './share-panel'
import { FavoriteButton } from './favorite-button'
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

  const [ancestors, children, body, moveTargets, favorite] = await Promise.all([
    listAncestors(ctx, page),
    listChildPages(ctx, page.id),
    loadPageBody(ctx, page.id),
    listMovableTargets(ctx, page.id),
    isFavorite(ctx, page.id),
  ])

  // 방문 기록(F-07-04). **`getPage` 를 통과한 뒤**에 남긴다 — 볼 수 없는 페이지를
  // 열어본 흔적이 남으면 그 자체가 존재를 알려주는 신호가 된다.
  // 실패해도 던지지 않는다(`recordVisit` 머리말): 기록이 빠지는 것이 화면이
  // 안 열리는 것보다 낫다.
  await recordVisit(ctx, page.id)
  // getPage 가 통과했으므로 여기서 null 이면 그 사이에 지워진 것이다.
  if (!body) notFound()

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
          <SharePanel workspaceId={workspaceId} pageId={page.id} />
          <MovePageControl
            workspaceId={workspaceId}
            pageId={page.id}
            currentParentId={page.parentPageId}
            targets={moveTargets.map((t) => ({
              id: t.id,
              title: t.title,
              ancestors: [...t.ancestors],
            }))}
          />
          <DeletePageButton
            workspaceId={workspaceId}
            pageId={page.id}
            childCount={children.length}
            parentPageId={page.parentPageId}
          />
        </div>
      </div>

      <PageTitle workspaceId={workspaceId} pageId={page.id} initialTitle={page.plainTitle} />

      <BodyEditor
        workspaceId={workspaceId}
        pageId={page.id}
        initialDoc={body.doc}
        initialVersion={body.version}
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
