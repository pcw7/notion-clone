/**
 * 멘션의 역인덱스와 멘션 알림 — 프로젝터가 쓴다 (F-07-09 · F-05-09 · 코멘트 5a조각 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **프로젝터가 쓴다**(정본 L1) — 본문 저장도, 참여자 update 도 같은 자리에서 `link_edge` 가 갱신된다
 *   ② **멘션을 넣은 참여자 update 는 미루지 않는다** — 그래서 알림의 행위자가 그 참여자다. 밀린 투영은 창의 마지막
 *      사람 세션으로 돌기 때문에 미루면 행위자가 바뀐다(§3.3-141)
 *   ③ **차분이다**(L3) — 이미 멘션돼 있던 사람을 한 블록 더 멘션해도 다시 알리지 않고, 다 지웠다 다시 멘션하면 알린다
 *   ④ 알림은 **살아 있는 멤버**에게만, 나 자신은 빼고, 뮤트(N1)는 이긴다. edge 는 그래도 남는다
 *   ⑤ 백링크는 볼 수 있는 페이지만 세고, 자기 자신은 뺀다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type * as Y from 'yjs'

import { loadDocState } from '../collab/doc-store.ts'
import { pageMentionRun, textRun, userMentionRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { listInbox } from '../notification/inbox.ts'
import { setSubscription } from '../notification/subscription.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { appendDocUpdate } from './body-write.ts'
import { listBacklinks } from './link-edges.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'

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

const para = (title: EditorBlock['title'], id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title })

async function workspace(): Promise<{ owner: Actor; member: Actor; other: Actor }> {
  const workspaceId = await createBareWorkspace('멘션')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const other = await joinAs(workspaceId, await createUser('다른멤버'), 'member')
  return { owner, member, other }
}

const mk = async (actor: Actor, title: string): Promise<string> =>
  (await createPage(actor.ctx, { parentPageId: null, title: titleFromPlainText(title) })).id

async function save(actor: Actor, pageId: string, doc: EditorDoc): Promise<void> {
  const saved = await savePageBody(actor.ctx, pageId as never, doc)
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

type Edge = { source_block_id: string; target_kind: string; target_id: string }
const edgesOf = (pageId: string) =>
  query<Edge>(
    `SELECT source_block_id, target_kind, target_id FROM link_edge WHERE source_page_id = $1 ORDER BY target_kind, target_id`,
    [pageId],
  )
const mentionNotifications = (userId: string, pageId: string) =>
  queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM notification WHERE recipient_id = $1 AND page_id = $2 AND kind = 'mention'`,
    [userId, pageId],
  )

async function restrict(owner: Actor, member: Actor, pageId: string): Promise<void> {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
  void member
}

// ── ① · ④ 저장 경로 ──────────────────────────────────────────────────

describe('본문 저장이 멘션을 투영한다', () => {
  test('★ 사람 멘션 → link_edge 한 행 + 그 사람의 인박스에 멘션 알림, 미리보기는 그 블록의 글', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await mk(owner, '회의록')
    const blockId = randomUUID()
    await save(owner, pageId, { blocks: [para([textRun('담당: '), userMentionRun(member.userId), textRun(' 확인 바랍니다')], blockId)] })

    assert.deepEqual(await edgesOf(pageId), [{ source_block_id: blockId, target_kind: 'user', target_id: member.userId }])

    const inbox = await listInbox(member.ctx)
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].kind, 'mention')
    assert.equal(inbox[0].pageId, pageId)
    assert.equal(inbox[0].actorId, owner.userId)
    assert.equal(inbox[0].preview, '담당:  확인 바랍니다', '멘션 노드는 글자를 싣지 않는다 — 그 블록의 지금 글만 보인다')

    const events = await query<{ type: string; payload: Record<string, unknown> }>(
      `SELECT type, payload FROM activity_event WHERE page_id = $1`,
      [pageId],
    )
    assert.deepEqual(events, [{ type: 'user.mentioned', payload: { block_id: blockId } }], 'payload 는 id 만 담는다')
  })

  test('나 자신을 멘션하면 edge 는 남고 알림은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await mk(owner, '메모')
    await save(owner, pageId, { blocks: [para([userMentionRun(owner.userId)])] })
    assert.equal((await edgesOf(pageId)).length, 1)
    assert.equal((await mentionNotifications(owner.userId, pageId)).n, '0')
  })

  test('워크스페이스 멤버가 아닌 uuid · 뮤트한 사람 — edge 는 남고 알림은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await mk(owner, '메모')
    assert.equal((await setSubscription(member.ctx, pageId, 'none')).ok, true)
    const stranger = randomUUID()
    await save(owner, pageId, { blocks: [para([userMentionRun(stranger), userMentionRun(member.userId)])] })

    assert.equal((await edgesOf(pageId)).length, 2, '노드가 남으니 edge 도 남는다 — 알림만 없다')
    assert.equal((await mentionNotifications(member.userId, pageId)).n, '0', '뮤트가 이긴다 (N1)')
    assert.equal(
      (await queryOne<{ n: string }>(`SELECT count(*) AS n FROM notification WHERE recipient_id = $1`, [stranger])).n,
      '0',
      '멤버가 아닌 uuid 에는 아무것도 만들지 않는다',
    )
  })
})

// ── ② 참여자 경로 ────────────────────────────────────────────────────

describe('참여자 update 가 멘션을 넣으면', () => {
  test('★ 미루지 않고 곧바로 투영한다 — 알림의 행위자가 그 참여자다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await mk(owner, '회의록')
    const blockId = randomUUID()
    await save(owner, pageId, { blocks: [para([textRun('본문')], blockId)] })
    const base = await ydocOf(other, pageId)

    // `other` 가 멘션을 넣는다 — 협업 서버가 쌓는 그 경로로(projection: 'deferred').
    const client = peer(base, 77)
    edit(client, (tr: Transaction, doc: PmNode) => {
      const schema = doc.type.schema
      tr.insert(
        findBlock(doc, blockId).pos + 2,
        schema.nodes.mention.create({ mention: { type: 'user', user: { id: member.userId } }, plainText: '' }),
      )
    })
    const appended = await appendDocUpdate(other.ctx, pageId, changesSince(client, base), {
      origin: 'editor',
      projection: 'deferred',
    })
    assert.equal(appended.ok, true, JSON.stringify(appended))

    // 밀린 투영을 돌리지 않았는데도 edge 가 있다 — 미루지 않았다는 뜻이다.
    assert.deepEqual(await edgesOf(pageId), [{ source_block_id: blockId, target_kind: 'user', target_id: member.userId }])
    const event = await queryOne<{ actor_id: string }>(
      `SELECT actor_id FROM activity_event WHERE page_id = $1 AND type = 'user.mentioned'`,
      [pageId],
    )
    assert.equal(event.actor_id, other.userId, '행위자는 멘션을 넣은 참여자다 — 페이지 소유자가 아니다')
    assert.equal((await mentionNotifications(member.userId, pageId)).n, '1')
  })

  test('글자만 친 update 는 여전히 미룬다 — 멘션이 있어도 건드리지 않았으면', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await mk(owner, '회의록')
    const blockId = randomUUID()
    await save(owner, pageId, { blocks: [para([userMentionRun(member.userId), textRun(' 확인')], blockId)] })
    const before = await queryOne<{ projected_seq: string }>(`SELECT projected_seq FROM doc_snapshot WHERE page_id = $1`, [pageId])
    const base = await ydocOf(owner, pageId)

    const client = peer(base, 78)
    edit(client, (tr: Transaction, doc: PmNode) => {
      tr.insertText(' 부탁드립니다', findBlock(doc, blockId).pos + 2 + 4)
    })
    const appended = await appendDocUpdate(owner.ctx, pageId, changesSince(client, base), { origin: 'editor', projection: 'deferred' })
    assert.equal(appended.ok, true)
    const after = await queryOne<{ projected_seq: string }>(`SELECT projected_seq FROM doc_snapshot WHERE page_id = $1`, [pageId])
    assert.equal(after.projected_seq, before.projected_seq, '투영이 미뤄졌다 — projected_seq 가 그대로다')
  })
})

// ── ③ 차분 ───────────────────────────────────────────────────────────

describe('차분으로 쓴다 (L3)', () => {
  test('★ 같은 사람을 한 블록 더 멘션해도 다시 알리지 않고, 다 지웠다 다시 멘션하면 알린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await mk(owner, '회의록')
    const a = randomUUID()
    const b = randomUUID()
    await save(owner, pageId, { blocks: [para([userMentionRun(member.userId)], a)] })
    assert.equal((await mentionNotifications(member.userId, pageId)).n, '1')

    // 둘째 블록에서 한 번 더 — edge 는 둘, 알림은 그대로 하나.
    await save(owner, pageId, { blocks: [para([userMentionRun(member.userId)], a), para([userMentionRun(member.userId)], b)] })
    assert.equal((await edgesOf(pageId)).length, 2)
    assert.equal((await mentionNotifications(member.userId, pageId)).n, '1', '이미 멘션돼 있던 사람이다')

    // 하나를 지우면 edge 하나만 빠진다 — 통째로 갈아 끼우지 않는다.
    await save(owner, pageId, { blocks: [para([userMentionRun(member.userId)], a), para([textRun('이제 없음')], b)] })
    assert.deepEqual(await edgesOf(pageId), [{ source_block_id: a, target_kind: 'user', target_id: member.userId }])

    // 전부 지웠다가 다시 멘션하면 새로 생긴 것이다.
    await save(owner, pageId, { blocks: [para([textRun('없음')], a)] })
    assert.deepEqual(await edgesOf(pageId), [])
    await save(owner, pageId, { blocks: [para([userMentionRun(member.userId)], a)] })
    assert.equal((await mentionNotifications(member.userId, pageId)).n, '2')
  })
})

// ── ⑤ 백링크 ─────────────────────────────────────────────────────────

describe('백링크 (F-07-09)', () => {
  test('★ 나를 멘션한 페이지 중 볼 수 있는 것만 — 자기 자신은 빼고, 여러 번 멘션해도 한 줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const target = await mk(owner, '대상 페이지')
    const open = await mk(owner, '공개 문서')
    const secret = await mk(owner, '비밀 문서')
    await save(owner, open, { blocks: [para([pageMentionRun(target)]), para([pageMentionRun(target)])] })
    await save(owner, secret, { blocks: [para([pageMentionRun(target)])] })
    await save(owner, target, { blocks: [para([pageMentionRun(target)])] })
    await restrict(owner, member, secret)

    const forOwner = await withReadTransaction((tx) => listBacklinks(tx, owner.ctx, target))
    assert.deepEqual(
      forOwner.map((b) => b.title).sort(),
      ['공개 문서', '비밀 문서'],
      '자기 자신은 빠지고, 두 번 멘션한 페이지도 한 줄이다',
    )
    const forMember = await withReadTransaction((tx) => listBacklinks(tx, member.ctx, target))
    assert.deepEqual(forMember.map((b) => b.title), ['공개 문서'], '볼 수 없는 페이지는 개수에도 들어가지 않는다')

    assert.deepEqual(
      (await edgesOf(open)).map((e) => e.target_kind),
      ['page', 'page'],
      'edge 는 (블록, 대상) 단위라 둘이다 — 백링크가 한 줄로 접는 것이지 edge 가 하나인 것이 아니다',
    )
  })
})
