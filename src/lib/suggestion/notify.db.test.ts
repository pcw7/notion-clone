/**
 * 제안 알림 (SG-4 · F-11-16 · 정본 [보강 SG-1] ⑥ · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 새 sid 를 처음 본 투영이 sid 마다 활동 `suggestion.created` 를 남기고, 페이지를 `all_comments` 로 따르는 멤버에게 알린다.
 *      `replies_and_mentions` · `none` · 제안한 사람 자신 · 나간 멤버는 받지 않는다. 한 번에 여러 sid 가 생겨도 받는 사람마다 한 줄이다
 *   ② 같은 sid 를 다시 투영해도 · stale → open 으로 되살려도 다시 알리지 않는다
 *   ③ 수락은 제안한 사람에게 한 번(`suggestion.accepted`) — 누른 사람 자신 · 거절 · 멤버가 아닌 제안자는 받지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import { appendDocUpdate } from '../block/body-write.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { loadDocState } from '../collab/doc-store.ts'
import type { EditorChange } from '../collab/body-edit.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { blockSchema, SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import { listInbox } from '../notification/inbox.ts'
import { setSubscription, type PageSubscriptionLevel } from '../notification/subscription.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { resolveSuggestions } from './resolve.ts'

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

const ins = (sid: string, author: string): Mark => blockSchema.marks[SUGGESTION_INSERT_MARK]!.create({ sid, author_id: author })
const textStart = (doc: PmNode, blockId: string): number => findBlock(doc, blockId).pos + 2

type Setup = {
  readonly owner: Actor
  readonly all: Actor
  readonly replies: Actor
  readonly muted: Actor
  readonly workspaceId: string
  readonly pageId: string
  readonly blockId: string
}

async function setup(): Promise<Setup> {
  const workspaceId = await createBareWorkspace('제안 알림')
  const owner = await joinAs(workspaceId, await createUser('제안하는 사람'), 'owner')
  const all = await joinAs(workspaceId, await createUser('모든 코멘트'), 'member')
  const replies = await joinAs(workspaceId, await createUser('답글만'), 'member')
  const muted = await joinAs(workspaceId, await createUser('끔'), 'member')
  const blockId = randomUUID()
  const pageId = (await createPage(owner.ctx, { title: titleFromPlainText('알림 페이지') })).id
  const saved = await savePageBody(owner.ctx, pageId as never, { blocks: [{ id: blockId, type: 'paragraph', title: [textRun('원래글')] }] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const levels: [Actor, PageSubscriptionLevel][] = [[all, 'all_comments'], [replies, 'replies_and_mentions'], [muted, 'none']]
  for (const [actor, level] of levels) assert.equal((await setSubscription(actor.ctx, pageId, level)).ok, true)
  return { owner, all, replies, muted, workspaceId, pageId, blockId }
}

let nextClient = 7500

/** 참여자 편집을 보내고 곧바로 투영한다. */
async function send(actor: Actor, pageId: string, change: EditorChange): Promise<void> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  const base = state.value.ydoc
  const client = peer(base, (nextClient += 1))
  edit(client, change)
  const result = await appendDocUpdate(actor.ctx, pageId, changesSince(client, base), { origin: 'editor', projection: 'now' })
  assert.ok(result.ok && result.appended, JSON.stringify(result))
}

/** 글 앞에 넣자는 글을 sid 마다 하나씩. */
const suggest = (blockId: string, items: readonly { sid: string; author: string; text: string }[]): EditorChange =>
  (tr, doc) => {
    for (const [i, it] of items.entries()) tr.insert(textStart(doc, blockId) + i, blockSchema.text(it.text, [ins(it.sid, it.author)]))
  }

/** 지울 수 있게 마크만 떼는 편집 — 같은 sid 마크가 사라지게(stale). */
const removeText = (blockId: string, length: number): EditorChange => (tr, doc) => {
  const at = textStart(doc, blockId)
  tr.delete(at, at + length)
}

const notificationsOf = async (userId: string, pageId: string): Promise<{ kind: string; event_ids: string[] }[]> =>
  query(`SELECT kind, event_ids FROM notification WHERE recipient_id = $1 AND page_id = $2 AND kind = 'suggestion'`, [userId, pageId])

const eventsOf = async (pageId: string, type: string): Promise<{ id: string; actor_id: string }[]> =>
  query(`SELECT id, actor_id FROM activity_event WHERE page_id = $1 AND type = $2`, [pageId, type])

// ── ① 만들 때 ─────────────────────────────────────────────────────────

describe('① 새 제안이 all_comments 구독자에게 간다', () => {
  test('★ 새 sid 마다 활동 하나 · all_comments 만 받는다 · 한 번에 여러 sid 여도 한 줄 · 제안한 사람은 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, all, replies, muted, pageId, blockId } = await setup()
    // 제안한 사람도 all_comments 로 따른다 — 그래도 자기 제안은 받지 않는다
    assert.equal((await setSubscription(owner.ctx, pageId, 'all_comments')).ok, true)
    const [a, b] = [randomUUID(), randomUUID()]
    await send(owner, pageId, suggest(blockId, [{ sid: a, author: owner.userId, text: '하나' }, { sid: b, author: owner.userId, text: '둘' }]))

    const events = await eventsOf(pageId, 'suggestion.created')
    assert.equal(events.length, 2)
    assert.ok(events.every((e) => e.actor_id === owner.userId))
    const got = await notificationsOf(all.userId, pageId)
    assert.equal(got.length, 1, '받는 사람마다 한 줄')
    assert.equal(got[0]?.event_ids.length, 2)
    assert.equal((await notificationsOf(replies.userId, pageId)).length, 0, 'replies_and_mentions 는 받지 않는다')
    assert.equal((await notificationsOf(muted.userId, pageId)).length, 0, 'none 은 받지 않는다')
    assert.equal((await notificationsOf(owner.userId, pageId)).length, 0, '제안한 사람은 받지 않는다')

    // 인박스 — 한 줄 · 미리보기는 처음 sid 의 글
    const item = (await listInbox(all.ctx)).find((i) => i.kind === 'suggestion')
    assert.ok(item !== undefined && item.suggestion?.accepted === false)
    assert.ok(item.preview === '하나' || item.preview === '둘', String(item.preview))
  })

  test('★ 같은 sid 를 다시 투영해도 · stale 에서 되살려도 다시 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, all, pageId, blockId } = await setup()
    const sid = randomUUID()
    await send(owner, pageId, suggest(blockId, [{ sid, author: owner.userId, text: '글' }]))
    assert.equal((await notificationsOf(all.userId, pageId)).length, 1)

    // 같은 sid 가 남은 채 다른 편집 → 다시 투영
    await send(owner, pageId, (tr, doc) => void tr.insert(textStart(doc, blockId) + 3, blockSchema.text('덧')))
    assert.equal((await notificationsOf(all.userId, pageId)).length, 1)

    // 마크가 사라져 stale → 같은 sid 가 다시 서서 open
    await send(owner, pageId, removeText(blockId, 1))
    assert.equal((await query<{ state: string }>(`SELECT state FROM suggestion WHERE id = $1`, [sid]))[0]?.state, 'stale')
    await send(owner, pageId, suggest(blockId, [{ sid, author: owner.userId, text: '글' }]))
    assert.equal((await query<{ state: string }>(`SELECT state FROM suggestion WHERE id = $1`, [sid]))[0]?.state, 'open')
    assert.equal((await notificationsOf(all.userId, pageId)).length, 1, '되살림은 알리지 않는다')
    assert.equal((await eventsOf(pageId, 'suggestion.created')).length, 1)
  })

  test('멤버가 아닌 제안자의 마크는 표에도 알림에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, all, pageId, blockId } = await setup()
    const outsider = await createUser('밖의 사람')
    await send(owner, pageId, suggest(blockId, [{ sid: randomUUID(), author: outsider.userId, text: '글' }]))
    assert.equal((await notificationsOf(all.userId, pageId)).length, 0)
    assert.equal((await eventsOf(pageId, 'suggestion.created')).length, 0)
  })
})

// ── ③ 수락할 때 ───────────────────────────────────────────────────────

describe('③ 수락은 제안한 사람에게 한 번', () => {
  test('★ 수락하면 제안한 사람마다 한 번 · 누른 사람 자신은 받지 않는다 · 거절은 보내지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, all, workspaceId, pageId, blockId } = await setup()
    void workspaceId
    // all 이 둘, owner 가 하나 제안한다
    const [s1, s2, s3, s4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    await send(all, pageId, suggest(blockId, [{ sid: s1, author: all.userId, text: '가' }, { sid: s2, author: all.userId, text: '나' }]))
    await send(owner, pageId, suggest(blockId, [{ sid: s3, author: owner.userId, text: '다' }, { sid: s4, author: owner.userId, text: '라' }]))
    const accepted = (userId: string) =>
      query<{ event_ids: string[] }>(
        `SELECT n.event_ids FROM notification n JOIN activity_event e ON e.id = n.event_ids[1]
          WHERE n.recipient_id = $1 AND n.page_id = $2 AND e.type = 'suggestion.accepted'`,
        [userId, pageId],
      )

    // 거절 — 알림 없음
    assert.deepEqual((await resolveSuggestions(owner.ctx, pageId, [s1], 'reject')).ok, true)
    assert.equal((await accepted(all.userId)).length, 0)

    // 수락 — 두 사람의 제안을 함께: all 에게 한 번 · owner(누른 사람)에게는 없다
    const res = await resolveSuggestions(owner.ctx, pageId, [s2, s3], 'accept')
    assert.deepEqual(res.ok && [...res.resolved].sort(), [s2, s3].sort())
    assert.equal((await accepted(all.userId)).length, 1)
    assert.equal((await accepted(owner.userId)).length, 0, '스스로 수락은 알리지 않는다')
    assert.equal((await eventsOf(pageId, 'suggestion.accepted')).length, 1)

    // 다시 수락해도(이미 정한 행) 더 알리지 않는다
    assert.deepEqual(await resolveSuggestions(owner.ctx, pageId, [s2], 'accept'), { ok: true, resolved: [] })
    assert.equal((await accepted(all.userId)).length, 1)

    const item = (await listInbox(all.ctx)).find((i) => i.suggestion?.accepted === true)
    assert.ok(item !== undefined, '인박스에 수락 알림')
    assert.equal(item.preview, '나')
  })
})
