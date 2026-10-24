/**
 * 인박스의 쪽 넘기기 — 무한 스크롤의 커서 (§7 정리 10n-69 · F-11-07 · HANDOFF §3.2-302 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 쪽을 이어 붙이면 한 번에 읽은 것과 같다 — 빠지거나 겹치는 줄이 없다 · 마지막 쪽의 `next` 는 null
 *   ② **같은 밀리초 안의 줄** — 커서가 시각을 마이크로초까지 싣는다(`Date` 로 실으면 건너뛴다)
 *   ③ **시각이 같은 줄** — `group_key` · `page_id` 가 가른다(가르지 않으면 겹치거나 빠진다)
 *   ④ 묶음(N2)은 쪽을 넘어서도 한 줄 · 필터(안 읽음)도 같은 커서로 넘긴다
 *   ⑤ 남은 줄이 쪽 크기와 꼭 같으면 `next` 가 null — 빈 쪽을 한 번 더 부르지 않는다
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { decodeInboxCursor } from './inbox-cursor.ts'
import { listInbox, listInboxPage, type InboxFilter } from './inbox.ts'

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

async function me(): Promise<{ owner: Actor; pageId: string }> {
  const workspaceId = await createBareWorkspace('인박스 쪽')
  const owner = await joinAs(workspaceId, await createUser('받는 사람'), 'owner')
  const page = await createPage(owner.ctx, { parentPageId: null, title: titleFromPlainText('알림 페이지') })
  return { owner, pageId: page.id }
}

/** 알림 한 줄을 바로 넣는다 — 시각을 마이크로초까지 정하려고(팬아웃을 거치면 now() 다). */
async function notify(owner: Actor, pageId: string, groupKey: string, at: string, read = false): Promise<void> {
  await query(
    `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, read_at, created_at)
     VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'page_update', $6, $7, $8::timestamptz)`,
    [randomUUID(), owner.userId, owner.ctx.workspaceId, pageId, randomUUID(), groupKey, read ? at : null, at],
  )
}

/** 쪽을 끝까지 넘긴다 — 쪽마다의 줄 열쇠와 마지막 `next`. */
async function walk(owner: Actor, limit: number, filter: InboxFilter = 'all'): Promise<{ pages: string[][]; last: string | null }> {
  const pages: string[][] = []
  let after: string | undefined
  for (let i = 0; i < 50; i += 1) {
    const page = await listInboxPage(owner.ctx, { filter, limit, after })
    pages.push(page.items.map((item) => item.groupKey))
    if (page.next === null) return { pages, last: null }
    assert.notEqual(decodeInboxCursor(page.next), null, '다음 커서가 되읽힌다')
    after = page.next
  }
  throw new Error('쪽이 끝나지 않는다')
}

test('★ ① 쪽을 이어 붙이면 한 번에 읽은 것과 같다 — 빠지거나 겹치지 않는다 · 끝의 next 는 null', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { owner, pageId } = await me()
  for (let i = 1; i <= 7; i += 1) await notify(owner, pageId, `g${i}`, `2026-10-25 06:00:0${i}+00`)
  const { pages } = await walk(owner, 3)
  assert.deepEqual(pages, [['g7', 'g6', 'g5'], ['g4', 'g3', 'g2'], ['g1']])
  assert.deepEqual(pages.flat(), (await listInbox(owner.ctx, { limit: 100 })).map((i) => i.groupKey), '한 번에 읽은 차례와 같다')
})

test('★ ② 같은 밀리초 안의 줄도 건너뛰지 않는다 — 커서가 마이크로초까지 싣는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { owner, pageId } = await me()
  await notify(owner, pageId, 'early', '2026-10-25 06:00:00.123100+00')
  await notify(owner, pageId, 'middle', '2026-10-25 06:00:00.123200+00')
  await notify(owner, pageId, 'late', '2026-10-25 06:00:00.123300+00')
  const { pages } = await walk(owner, 1)
  assert.deepEqual(pages.flat(), ['late', 'middle', 'early'])
})

test('★ ③ 시각이 같은 줄은 묶음 열쇠 · 페이지가 가른다 — 한 줄씩 넘겨도 셋 다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { owner, pageId } = await me()
  const other = (await createPage(owner.ctx, { parentPageId: null, title: titleFromPlainText('다른 페이지') })).id
  const at = '2026-10-25 06:00:00.5+00'
  await notify(owner, pageId, 'b', at)
  await notify(owner, pageId, 'a', at)
  await notify(owner, other, 'a', at)
  const { pages } = await walk(owner, 1)
  assert.equal(pages.flat().length, 3, JSON.stringify(pages))
  assert.equal(pages.flat()[0], 'b', '같은 시각에서는 묶음 열쇠가 큰 것이 먼저')
  assert.deepEqual(pages.flat().slice(1).sort(), ['a', 'a'], '열쇠가 같으면 페이지가 가른다')
})

test('④ 묶음은 쪽을 넘어서도 한 줄 · 안 읽음 필터도 같은 커서로 넘긴다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { owner, pageId } = await me()
  await notify(owner, pageId, 'thread', '2026-10-25 06:00:01+00')
  await notify(owner, pageId, 'thread', '2026-10-25 06:00:05+00')
  await notify(owner, pageId, 'solo', '2026-10-25 06:00:03+00')
  await notify(owner, pageId, 'seen', '2026-10-25 06:00:04+00', true)
  assert.deepEqual((await walk(owner, 1)).pages.flat(), ['thread', 'seen', 'solo'], '묶음은 마지막 시각(5초)의 자리에 한 번')
  assert.deepEqual((await walk(owner, 1, 'unread')).pages.flat(), ['thread', 'solo'], '읽은 줄은 안 읽음 쪽에 없다')
})

test('⑤ 남은 줄이 쪽 크기와 꼭 같으면 next 가 null — 빈 쪽을 부르지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { owner, pageId } = await me()
  for (let i = 1; i <= 4; i += 1) await notify(owner, pageId, `g${i}`, `2026-10-25 06:00:0${i}+00`)
  const { pages } = await walk(owner, 2)
  assert.deepEqual(pages, [['g4', 'g3'], ['g2', 'g1']], '셋째 쪽(빈 쪽)이 없다')
  const empty = await listInboxPage(owner.ctx, { limit: 2 })
  assert.equal(empty.items.length, 2)
  assert.notEqual(empty.next, null, '더 있으면 next 가 있다')
})
