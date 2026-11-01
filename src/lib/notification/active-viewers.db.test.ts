/**
 * 지금 보는 사람에게는 알림을 띄우지 않는다 — 배달 3단 ③ (33번 트랙 AW-2 · F-05-03 · 정본 §3.7 presence [보강 AW-2] · §3.8 · DB · Valkey)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 그 페이지를 **보이는 탭으로** 보고 있는 사람의 알림은 읽음으로 만든다 — 인박스에는 남고 읽지 않은 수에는 서지 않는다
 *   ② 숨은 탭뿐인 사람 · 그 페이지에 없는 사람은 그대로 읽지 않음
 *   ③ 코멘트만이 아니다 — 멘션도 같다(받는 사람마다 따로)
 *   ④ 협업 서버의 기록(`valkeyPresenceStore`)은 통째로 다시 쓴다 — 나간 사람은 지워지고 키에는 TTL 30초 · 아무도 없으면 키가 없다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { PRESENCE_TTL_SECONDS, presenceKey, valkeyPresenceStore } from '../collab/presence-registry.ts'
import { createDiscussion, replyToDiscussion } from '../comment/discussion.ts'
import { textRun, userMentionRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { getValkey } from '../valkey.ts'
import { listInbox, unreadCount } from './inbox.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) skipReason = problem
  else {
    try {
      await getValkey().ping()
    } catch (error) {
      skipReason = `Valkey 에 닿지 않는다: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (skipReason && REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
})

after(async () => {
  const { closeValkey } = await import('../valkey.ts')
  await closeValkey().catch(() => {})
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const says = (text: string) => [textRun(text)]
const para = (title: EditorBlock['title'], id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title })
const store = valkeyPresenceStore()

/** 협업 서버가 적은 것처럼 — 적기는 기다리지 않으므로, 같은 연결의 다음 명령(PING)이 돌아오면 앞의 MULTI 도 끝났다. */
async function viewing(pageId: string, viewers: Record<string, boolean>): Promise<void> {
  store.record(pageId, new Map(Object.entries(viewers)))
  await getValkey().ping()
}

async function workspace(): Promise<{ owner: Actor; member: Actor; other: Actor }> {
  const workspaceId = await createBareWorkspace('지금 보는 사람')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const other = await joinAs(workspaceId, await createUser('다른멤버'), 'member')
  return { owner, member, other }
}

/** 만든 사람은 `auto_created` 로 구독된다 — 그 페이지의 모든 코멘트를 받는다. */
async function pageBy(actor: Actor): Promise<string> {
  const page = await createPage(actor.ctx, { parentPageId: null, title: titleFromPlainText('보는 중') })
  const saved = await savePageBody(actor.ctx, page.id as never, { blocks: [para(says('본문'))] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page.id
}

describe('배달 3단 ③ — 지금 보는 사람', () => {
  test('★ 보이는 탭으로 보는 동안 온 코멘트는 읽음으로 — 숨은 탭 · 나간 뒤에는 읽지 않음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageBy(owner)

    await viewing(pageId, { [owner.userId]: true })
    const made = await createDiscussion(member.ctx, { pageId, richText: says('보고 계시죠') })
    assert.equal(made.ok, true, JSON.stringify(made))
    const discussionId = made.ok ? made.discussionId : ''
    let [item] = await listInbox(owner.ctx)
    assert.equal(item?.count, 1, '알림은 만들어진다 — 인박스에 남는다')
    assert.equal(item?.unreadCount, 0, '보는 동안 온 것은 읽음')
    assert.equal(await unreadCount(owner.ctx), 0)

    await viewing(pageId, { [owner.userId]: false })
    assert.equal((await replyToDiscussion(member.ctx, discussionId, says('숨은 탭'))).ok, true)
    ;[item] = await listInbox(owner.ctx)
    assert.equal(item?.unreadCount, 1, '숨은 탭뿐이면 보는 사람이 아니다')

    await viewing(pageId, {})
    assert.equal((await replyToDiscussion(member.ctx, discussionId, says('나간 뒤'))).ok, true)
    ;[item] = await listInbox(owner.ctx)
    assert.deepEqual([item?.count, item?.unreadCount], [3, 2], '나간 뒤에도 읽지 않음')
  })

  test('★ 멘션도 같다 — 받는 사람마다 따로(보는 사람만 읽음)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageBy(owner)

    await viewing(pageId, { [member.userId]: true, [other.userId]: false })
    const saved = await savePageBody(owner.ctx, pageId as never, {
      blocks: [para([textRun('확인: '), userMentionRun(member.userId), textRun(' · '), userMentionRun(other.userId)])],
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    const [forMember] = await listInbox(member.ctx)
    const [forOther] = await listInbox(other.ctx)
    assert.deepEqual([forMember?.kind, forMember?.unreadCount], ['mention', 0], '보고 있던 사람은 읽음')
    assert.deepEqual([forOther?.kind, forOther?.unreadCount], ['mention', 1], '숨은 탭뿐인 사람은 읽지 않음')
  })
})

describe('협업 서버의 기록', () => {
  test('통째로 다시 쓴다 — 나간 사람은 지워지고 TTL 30초 · 아무도 없으면 키가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = randomUUID()
    const [a, b] = [randomUUID(), randomUUID()]
    const key = presenceKey(pageId)

    await viewing(pageId, { [a]: true, [b]: false })
    assert.deepEqual(await getValkey().hgetall(key), { [a]: '1', [b]: '0' })
    const ttl = await getValkey().ttl(key)
    assert.ok(ttl > 0 && ttl <= PRESENCE_TTL_SECONDS, `TTL ${ttl}`)

    await viewing(pageId, { [a]: true })
    assert.deepEqual(await getValkey().hgetall(key), { [a]: '1' }, '나간 사람은 지워진다')

    await viewing(pageId, {})
    assert.equal(await getValkey().exists(key), 0, '아무도 없으면 키가 없다')
  })
})
