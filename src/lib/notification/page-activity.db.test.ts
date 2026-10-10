/**
 * 페이지 활동 읽기 — Updates 패널 (히스토리 · 활동 4d-3 · F-11-04, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.8 [보강] Updates 패널).
 *
 *   ① 문 — 볼 수 있는 사람만 · 살아 있는 페이지만 · 아니면 없는 페이지와 같은 답
 *   ② 허용 목록 — 멘션 · 접근 요청 · 리마인더는 보이지 않는다
 *   ③ 최신순 · 커서 — 같은 시각(한 트랜잭션)의 이벤트도 빠지거나 겹치지 않는다 · 깨진 커서는 거부
 *   ④ 행위자 — 지금의 이름 · 탈퇴하면 이름을 싣지 않는다 · 없으면 null
 *   ⑤ 옮기기의 목적지 — 읽는 사람이 볼 수 있는 살아 있는 페이지일 때만 제목
 *
 * 반사실(HANDOFF §3.3): 문을 열면 ①, 허용 목록을 풀면 ②, 동률 분해를 빼면 ③, 목적지의 권한을 빼면 ⑤ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { encodeCursor } from '../contracts/pagination.ts'
import { recordActivity, type ActivityType } from './activity.ts'
import { listPageActivity, PAGE_ACTIVITY_PAGE_SIZE, type PageActivityItem } from './page-activity.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let mate: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  mate = await joinAs(fx.workspaceId, await createUser('함께 보는 사람'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const page = async (title: string) => (await createPage(fx.owner.ctx, { parentPageId: null, title: titleFromPlainText(title) })).id
const record = (who: Actor, pageId: string, type: ActivityType, payload?: Record<string, string>) =>
  withTransaction((tx) => recordActivity(tx, who.ctx, { pageId, type, payload }))
const items = async (who: Actor, pageId: string): Promise<readonly PageActivityItem[]> => {
  const listed = await listPageActivity(who.ctx, pageId)
  assert.ok(listed.ok, JSON.stringify(listed))
  return listed.items
}
/** 소유자만 보게 — 상속을 끊고 워크스페이스 전체를 거둔다. */
async function restrict(pageId: string): Promise<void> {
  assert.equal((await stopInheriting(fx.owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, pageId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

describe('① 문', () => {
  test('★ 볼 수 있는 사람만 — 볼 수 없거나 휴지통의 페이지 · 모르는 id 는 없는 페이지와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const open = await page('함께 보는 글')
    assert.deepEqual((await items(mate, open)).map((i) => i.type), ['page.created'])

    const closed = await page('나만 보는 글')
    await restrict(closed)
    assert.deepEqual(await listPageActivity(mate.ctx, closed), { ok: false, reason: 'not_found' })
    assert.equal((await listPageActivity(fx.owner.ctx, closed)).ok, true)

    await trashPage(fx.owner.ctx, asBlockId(open))
    assert.deepEqual(await listPageActivity(fx.owner.ctx, open), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listPageActivity(fx.owner.ctx, randomUUID()), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listPageActivity(fx.owner.ctx, '아님'), { ok: false, reason: 'not_found' })
  })
})

describe('② 허용 목록', () => {
  test('★ 멘션 · 접근 요청 · 리마인더는 보이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('여러 일이 있었던 글')
    for (const type of ['user.mentioned', 'access.requested', 'access.granted', 'reminder.fired'] as const) {
      await record(fx.owner, target, type)
    }
    await record(fx.owner, target, 'comment.created', { discussion_id: randomUUID(), comment_id: randomUUID() })
    await record(mate, target, 'block.updated')
    assert.deepEqual(
      (await items(fx.owner, target)).map((i) => i.type),
      ['block.updated', 'comment.created', 'page.created'],
    )
  })
})

describe('③ 최신순 · 커서', () => {
  test('★ 같은 시각의 이벤트 35개 — 30 · 6 으로 나뉘고 빠지거나 겹치지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('바쁜 글')
    // 한 트랜잭션 — `created_at` 이 모두 같다(now()). 동률은 id 로 가른다.
    await withTransaction(async (tx) => {
      for (let i = 0; i < 35; i++) await recordActivity(tx, fx.owner.ctx, { pageId: target, type: 'block.updated' })
    })
    const first = await listPageActivity(fx.owner.ctx, target)
    assert.ok(first.ok && first.nextCursor !== null)
    assert.equal(first.items.length, PAGE_ACTIVITY_PAGE_SIZE)
    const second = await listPageActivity(fx.owner.ctx, target, { cursor: first.nextCursor })
    assert.ok(second.ok, JSON.stringify(second))
    assert.equal(second.nextCursor, null)
    const all = [...first.items, ...second.items]
    assert.equal(all.length, 36)
    assert.equal(new Set(all.map((i) => i.id)).size, 36, '겹치지 않는다')
    assert.equal(all.at(-1)?.type, 'page.created', '가장 오래된 것이 마지막')
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at.getTime() >= all[i].at.getTime(), '최신순')
  })

  test('깨진 커서는 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('커서')
    for (const cursor of ['%%%', encodeCursor({ sortKey: '12x', id: randomUUID() }), encodeCursor({ sortKey: '1', id: '아님' })]) {
      assert.deepEqual(await listPageActivity(fx.owner.ctx, target, { cursor }), { ok: false, reason: 'invalid_cursor' })
    }
  })
})

describe('④ 행위자', () => {
  test('★ 지금의 이름 · 탈퇴하면 이름을 싣지 않는다 · 없으면 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('사람들')
    const leaver = await joinAs(fx.workspaceId, await createUser('떠날 사람'), 'member')
    await record(leaver, target, 'block.updated')
    await query(`INSERT INTO activity_event (id, workspace_id, page_id, actor_id, type) VALUES ($1, $2, $3, NULL, 'property.updated')`, [
      randomUUID(),
      fx.workspaceId,
      target,
    ])
    await query(`UPDATE "user" SET name = '바꾼 이름' WHERE id = $1`, [leaver.userId])
    const byType = async () => new Map((await items(fx.owner, target)).map((i) => [i.type, i.actor]))
    assert.deepEqual((await byType()).get('block.updated'), { id: leaver.userId, name: '바꾼 이름', deleted: false }, '지금의 이름')
    assert.equal((await byType()).get('property.updated'), null, '행위자가 없으면 null')

    await query(`UPDATE "user" SET deleted_at = now() WHERE id = $1`, [leaver.userId])
    assert.deepEqual((await byType()).get('block.updated'), { id: leaver.userId, name: '', deleted: true })
  })
})

describe('⑤ 옮기기의 목적지', () => {
  test('★ 볼 수 있는 살아 있는 페이지만 제목 — 볼 수 없거나 페이지가 아니면 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const moved = await page('옮겨 다닌 글')
    const shown = await page('보이는 곳')
    const hidden = await page('숨은 곳')
    await restrict(hidden)
    const gone = await page('사라진 곳')
    await trashPage(fx.owner.ctx, asBlockId(gone))
    for (const to of [shown, hidden, gone, randomUUID()]) await record(fx.owner, moved, 'page.moved', { from: moved, to })

    const destinations = async (who: Actor) =>
      (await items(who, moved)).filter((i) => i.type === 'page.moved').map((i) => i.movedTo?.title ?? null).reverse()
    assert.deepEqual(await destinations(mate), ['보이는 곳', null, null, null], '볼 수 없는 곳의 제목이 새지 않는다')
    assert.deepEqual(await destinations(fx.owner), ['보이는 곳', '숨은 곳', null, null])
  })
})
