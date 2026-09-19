/**
 * 활동 이벤트 · 구독 · 인박스 — 코멘트가 알림이 되어 도착한다 (F-11-07 · F-11-08 · F-11-09 · 코멘트 3조각 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **누가 받는가** — 스레드에 낀 사람(직접 트리거)과 그 페이지를 `all_comments` 로 따르는 사람. 나 자신은 빼고
 *   ② **불변식 N1** — 명시적 `none` 은 암묵 구독을 이긴다. "뮤트했는데 편집하면 다시 켜지는" 버그를 막는 규칙이다
 *   ③ **불변식 N2** — 저장은 알림 하나에 행 하나, 병합은 **조회 시점**이다(`group_key`)
 *   ④ **불변식 N3** — 알림도 이벤트도 사람이 쓴 글을 복제하지 않는다. 지운 코멘트는 인박스에서도 사라진다(D3)
 *   ⑤ **배달 파이프라인 ②** — 권한 재검사가 조회 쿼리 안에 있다. 볼 수 없게 되면 이미 만든 알림도 목록에서 빠진다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, renamePage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import {
  createDiscussion,
  deleteComment,
  listDiscussions,
  replyToDiscussion,
} from '../comment/discussion.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { listInbox, markNotifications, unreadCount } from './inbox.ts'
import { setSubscription, subscriptionOf } from './subscription.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const says = (text: string) => [textRun(text)]

async function workspace(): Promise<{ owner: Actor; member: Actor; other: Actor }> {
  const workspaceId = await createBareWorkspace('알림')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const other = await joinAs(workspaceId, await createUser('다른멤버'), 'member')
  return { owner, member, other }
}

/** 본문이 있는 최상위 페이지. 만든 사람은 `auto_created` 로 구독된다. */
async function pageBy(actor: Actor, title = '페이지'): Promise<string> {
  const page = await createPage(actor.ctx, { parentPageId: null, title: titleFromPlainText(title) })
  const saved = await savePageBody(actor.ctx, page.id as never, { blocks: [para('본문')] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page.id
}

async function openThread(actor: Actor, pageId: string, text: string): Promise<string> {
  const made = await createDiscussion(actor.ctx, { pageId, richText: says(text) })
  assert.equal(made.ok, true, JSON.stringify(made))
  return made.ok ? made.discussionId : ''
}

async function reply(actor: Actor, discussionId: string, text: string): Promise<void> {
  const done = await replyToDiscussion(actor.ctx, discussionId, says(text))
  assert.equal(done.ok, true, JSON.stringify(done))
}

async function restrict(owner: Actor, member: Actor, pageId: string, level: Level | null): Promise<void> {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  if (level !== null) {
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, level)).ok, true)
  }
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

const kindsOf = (items: readonly { kind: string }[]) => items.map((i) => i.kind)

// ── ① 누가 받는가 ────────────────────────────────────────────────────

describe('누가 받는가', () => {
  test('★ 스레드에 낀 사람은 답글을, 페이지를 만든 사람은 모든 코멘트를 받는다 — 나 자신은 빼고', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageBy(owner)

    const discussionId = await openThread(member, pageId, '여기 이상합니다')
    assert.deepEqual(kindsOf(await listInbox(owner.ctx)), ['comment'], '만든 사람은 구독으로 받는다')
    assert.deepEqual(await listInbox(member.ctx), [], '내가 쓴 글이 나에게 오지 않는다')

    await reply(other, discussionId, '제가 보겠습니다')
    assert.deepEqual(kindsOf(await listInbox(member.ctx)), ['comment_reply'], '스레드에 낀 사람은 답글을 받는다')
    assert.deepEqual(await listInbox(other.ctx), [], '답글을 쓴 사람은 받지 않는다')

    const [forOwner] = await listInbox(owner.ctx)
    assert.equal(forOwner.count, 2, '구독자는 첫 글과 답글을 다 받았다')
    assert.equal(forOwner.kind, 'comment', '구독으로 받는 쪽은 comment 다')
  })

  test('스레드에 끼지 않고 구독도 없으면 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageBy(owner)
    await openThread(member, pageId, '혼잣말')
    assert.deepEqual(await listInbox(other.ctx), [])
    assert.equal(await unreadCount(other.ctx), 0)
  })

  test('★ 뮤트는 암묵 구독을 이긴다 (N1) — 스레드에 껴 있어도 오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageBy(owner)
    const discussionId = await openThread(member, pageId, '여기 이상합니다')

    // 멤버는 코멘트를 쓰며 auto_edited 로 구독됐다. 그것을 명시적으로 끈다.
    assert.equal((await subscriptionOf(member.ctx, pageId)).source, 'auto_edited')
    const muted = await setSubscription(member.ctx, pageId, 'none')
    assert.equal(muted.ok, true, JSON.stringify(muted))

    // **뮤트한 뒤에 다시 글을 쓴다** — 자동 구독이 그 값을 덮으면 "뮤트했는데 편집하면 다시 켜지는" 버그다(N1).
    await reply(member, discussionId, '제가 고치겠습니다')
    assert.equal((await subscriptionOf(member.ctx, pageId)).level, 'none', '자동 구독이 뮤트를 덮지 않았다')
    assert.equal((await subscriptionOf(member.ctx, pageId)).source, 'explicit')

    await reply(other, discussionId, '제가 보겠습니다')
    assert.deepEqual(await listInbox(member.ctx), [], '뮤트한 사람에게는 답글도 가지 않는다')
    assert.deepEqual(kindsOf(await listInbox(owner.ctx)), ['comment'], '다른 사람은 그대로 받는다')
  })
})

// ── ② 병합은 조회 시점 ───────────────────────────────────────────────

describe('병합은 조회 시점이다 (N2)', () => {
  test('★ 같은 스레드의 알림은 한 줄로 접히고, 저장은 개별 행이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageBy(owner)
    const discussionId = await openThread(member, pageId, '첫 글')
    await reply(other, discussionId, '두 번째')
    await reply(other, discussionId, '세 번째')

    const rows = await query<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE recipient_id = $1 AND group_key = $2`,
      [owner.userId, `discussion:${discussionId}`],
    )
    assert.equal(rows[0].n, '3', '저장은 개별이다 — 조회 시점 병합을 위해 행을 합치지 않는다')

    const inbox = await listInbox(owner.ctx)
    assert.equal(inbox.length, 1, '조회는 한 줄로 접는다')
    assert.equal(inbox[0].count, 3)
    assert.equal(inbox[0].unreadCount, 3)
    assert.equal(inbox[0].notificationIds.length, 3, '읽음은 접힌 행 전부에 건다')
    assert.equal(inbox[0].discussionId, discussionId)
    assert.equal(inbox[0].preview, '세 번째', '미리보기는 마지막 글이다')
  })

  test('스레드가 둘이면 줄도 둘이다 — 최근 것이 위다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner)
    await openThread(member, pageId, '먼저 연 스레드')
    await openThread(member, pageId, '나중에 연 스레드')

    const inbox = await listInbox(owner.ctx)
    assert.equal(inbox.length, 2)
    assert.deepEqual(
      inbox.map((i) => i.preview),
      ['나중에 연 스레드', '먼저 연 스레드'],
    )
  })
})

// ── ③ 보여줄 글은 지금 읽는다 ────────────────────────────────────────

describe('알림은 글을 복제하지 않는다 (N3)', () => {
  test('★ 지운 코멘트의 글은 인박스에 남지 않는다 — 이벤트 payload 에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner)
    const discussionId = await openThread(member, pageId, '지울 비밀')
    assert.equal((await listInbox(owner.ctx))[0].preview, '지울 비밀')

    const listed = await listDiscussions(member.ctx, pageId)
    assert.equal(listed.ok, true, JSON.stringify(listed))
    const commentId = listed.ok ? listed.discussions[0].comments[0].id : ''
    // 스레드가 통째로 사라지지 않도록 답글을 하나 남겨 둔다.
    await reply(owner, discussionId, '봤습니다')
    assert.equal((await deleteComment(member.ctx, commentId)).ok, true)

    const events = await query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM activity_event WHERE page_id = $1`,
      [pageId],
    )
    assert.ok(events.length >= 1)
    for (const e of events) {
      assert.deepEqual(Object.keys(e.payload).sort(), ['comment_id', 'discussion_id'], 'payload 는 id 만 담는다')
    }

    const [forMember] = await listInbox(member.ctx)
    assert.equal(forMember.preview, '봤습니다', '남은 글이 보인다')

    // 지운 글을 마지막으로 갖는 알림은 미리보기가 비어야 한다.
    const forOwner = await listInbox(owner.ctx)
    assert.equal(forOwner.length, 1)
    assert.equal(forOwner[0].count, 1, '소유자는 첫 글 하나만 받았다(자기 답글은 자기에게 오지 않는다)')
    assert.equal(forOwner[0].preview, null, '지운 글은 보여주지 않는다')
    assert.equal(forOwner[0].deleted, true)
  })

  test('페이지 제목을 바꾸면 인박스의 제목도 바뀐다 — 복사해 두지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner, '옛 제목')
    await openThread(member, pageId, '코멘트')
    assert.equal((await listInbox(owner.ctx))[0].pageTitle, '옛 제목')

    await renamePage(owner.ctx, pageId as never, titleFromPlainText('새 제목'))
    assert.equal((await listInbox(owner.ctx))[0].pageTitle, '새 제목')
  })
})

// ── ④ 권한 재검사는 조회 안에 ────────────────────────────────────────

describe('배달 파이프라인 ② — 권한 재검사는 조회 안에 있다', () => {
  test('★ 볼 수 없게 되면 이미 만들어진 알림도 목록에서 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageBy(owner, '가려질 페이지')
    // 멤버가 계속 볼 수 있는 페이지를 하나 둔다 — 그렇지 않으면 "볼 수 있는 스코프가 하나도 없다"는 다른 이유로
    // 목록이 비어 반사실을 가려내지 못한다(§3.3-134).
    const openPage = await pageBy(owner, '계속 보이는 페이지')
    const hidden = await openThread(member, pageId, '여기 이상합니다')
    const shown = await openThread(member, openPage, '다른 페이지 스레드')
    await reply(other, hidden, '제가 보겠습니다')
    await reply(other, shown, '이쪽도요')
    assert.equal((await listInbox(member.ctx)).length, 2)
    assert.equal(await unreadCount(member.ctx), 2)

    await restrict(owner, member, pageId, null)

    assert.deepEqual(
      (await listInbox(member.ctx)).map((i) => i.pageId),
      [openPage],
      '볼 수 없는 페이지의 알림만 빠진다',
    )
    assert.equal(await unreadCount(member.ctx), 1)
    const rows = await query<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE recipient_id = $1 AND page_id = $2`,
      [member.userId, pageId],
    )
    assert.equal(rows[0].n, '1', '행은 지우지 않는다 — 다시 받으면 다시 보인다')

    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, 'view')).ok, true)
    assert.equal((await listInbox(member.ctx)).length, 2, '다시 볼 수 있게 되면 다시 보인다')
  })

  test('휴지통에 간 페이지의 알림은 보이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner)
    await openThread(member, pageId, '코멘트')
    assert.equal((await listInbox(owner.ctx)).length, 1)

    const { trashPage } = await import('../block/trash.ts')
    await trashPage(owner.ctx, pageId as never)
    assert.deepEqual(await listInbox(owner.ctx), [])
  })
})

// ── ⑤ 읽음 · 보관 ────────────────────────────────────────────────────

describe('읽음과 보관은 따로다', () => {
  test('필터 넷이 각각 다른 것을 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner)
    await openThread(member, pageId, '읽을 것')
    await openThread(member, pageId, '보관할 것')

    const [toArchive, toRead] = await listInbox(owner.ctx)
    assert.equal(toArchive.preview, '보관할 것')
    assert.equal(await markNotifications(owner.ctx, toRead.notificationIds, { read: true }), 1)
    assert.equal(await markNotifications(owner.ctx, toArchive.notificationIds, { archived: true }), 1)

    assert.deepEqual((await listInbox(owner.ctx, { filter: 'all' })).map((i) => i.preview), ['읽을 것'])
    assert.deepEqual((await listInbox(owner.ctx, { filter: 'unread' })).map((i) => i.preview), [])
    assert.deepEqual((await listInbox(owner.ctx, { filter: 'read' })).map((i) => i.preview), ['읽을 것'])
    assert.deepEqual(
      (await listInbox(owner.ctx, { filter: 'archived' })).map((i) => i.preview),
      ['보관할 것'],
      '보관한 것은 읽지 않았어도 보관 목록에 있다',
    )
    assert.equal(await unreadCount(owner.ctx), 0, '보관한 안 읽은 알림은 배지에서 빠진다')
  })

  test('이미 그 상태면 다시 찍지 않고, 남의 알림은 바꿀 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner)
    await openThread(member, pageId, '코멘트')
    const [item] = await listInbox(owner.ctx)

    assert.equal(await markNotifications(owner.ctx, item.notificationIds, { read: true }), 1)
    assert.equal(await markNotifications(owner.ctx, item.notificationIds, { read: true }), 0, '두 번째는 아무것도 바꾸지 않는다')
    assert.equal(await markNotifications(member.ctx, item.notificationIds, { read: false }), 0, '남의 알림은 못 건드린다')
    assert.equal(await markNotifications(owner.ctx, item.notificationIds, { read: false }), 1, '다시 안 읽음으로 되돌린다')
  })
})

// ── ⑥ 이벤트는 단일 소스 ─────────────────────────────────────────────

describe('활동 이벤트', () => {
  test('아무도 받지 않아도 이벤트는 남는다 — 알림·피드·웹훅의 단일 소스다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await pageBy(owner)
    await openThread(owner, pageId, '나 혼자 쓰는 메모')

    const notifications = await query<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE page_id = $1`,
      [pageId],
    )
    assert.equal(notifications[0].n, '0', '자기 자신에게는 알리지 않는다')

    const events = await query<{ type: string; actor_id: string; block_id: string | null }>(
      `SELECT type, actor_id, block_id FROM activity_event WHERE page_id = $1`,
      [pageId],
    )
    assert.deepEqual(events.map((e) => e.type), ['comment.created'])
    assert.equal(events[0].actor_id, owner.userId)
  })
})
