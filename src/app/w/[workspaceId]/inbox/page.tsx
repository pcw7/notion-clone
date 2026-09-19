/**
 * 인박스 화면 — `/w/{workspaceId}/inbox` (F-11-07 · 코멘트 4조각)
 *
 * 첫 목록은 서버가 그려서 준다(권한 재검사가 그 쿼리 안에 있다 — §3.3-131). 그 뒤의 필터 · 읽음 · 보관은
 * 클라이언트가 라우트로 부른다.
 *
 * 진입 게이트가 레이아웃과 여기 양쪽에서 돈다. 중복으로 보이지만 레이아웃만 믿는 구조는 위험하다 — 레이아웃 밖에
 * 라우트가 하나 생기면 그 라우트만 통째로 무방비가 된다(레이아웃 머리말과 같은 규칙).
 */

import { requirePageSession } from '@/lib/auth/page-session'
import { listInbox, unreadCount } from '@/lib/notification/inbox'
import { InboxList, type InboxRow } from './inbox-list'

export default async function InboxView({ params }: PageProps<'/w/[workspaceId]/inbox'>) {
  const { workspaceId } = await params
  const ctx = await requirePageSession(workspaceId)

  const [items, unread] = await Promise.all([listInbox(ctx), unreadCount(ctx)])

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">인박스</h1>
      <InboxList
        workspaceId={workspaceId}
        initialItems={items.map(toRow)}
        initialUnread={unread}
      />
    </main>
  )
}

function toRow(item: Awaited<ReturnType<typeof listInbox>>[number]): InboxRow {
  return {
    groupKey: item.groupKey,
    kind: item.kind,
    pageId: item.pageId,
    pageTitle: item.pageTitle,
    notificationIds: [...item.notificationIds],
    count: item.count,
    unreadCount: item.unreadCount,
    lastAt: item.lastAt.toISOString(),
    preview: item.preview,
    deleted: item.deleted,
  }
}
