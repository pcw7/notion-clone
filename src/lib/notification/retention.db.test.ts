/**
 * 알림 · 활동 데이터 수명 — 히스토리 · 활동 4d-1 (F-11-18, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 읽었거나 보관한 알림은 그 뒤 180일이 지나면 지운다 — 늦은 쪽의 시각으로 · 최근에 읽은 것 · 안 읽은 것은 나이와 상관없이 남는다
 *   ② 안 읽은 알림은 사람마다(워크스페이스마다) 상한을 넘은 오래된 것만 — 상한 안의 사람은 그대로
 *   ③ 활동 이벤트는 90일 — 남은 알림이 가리키는 것은 남는다 · 이 판에 지운 알림이 가리키던 것은 함께 지운다(알림이 먼저)
 *   ④ 최근 방문은 사람마다 최근 N개만
 *   ⑤ 파티션 — 워커가 고르는 해(올해 · 다음 해). 함수 자체(만든다 · 그대로 · DEFAULT 에 행이 있으면 만들지 않는다)는 verify-schema [54]
 *   ⑥ 다른 워크스페이스는 건드리지 않는다(검사의 범위) · 한 판의 상한
 *
 * 반사실(HANDOFF §3.3): 안 읽은 것도 나이로 지우면 ①, 남은 알림이 가리키는 이벤트를 지우면 ③, 이벤트를 먼저 지우면 ③, 상한을 사람마다
 * 가르지 않으면 ② 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { partitionYears, runDataRetention } from './retention.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let page = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('수명') })).id
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const DAY = 86_400_000
const NOW = new Date()
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const run = (extra: { unreadCap?: number; visitCap?: number; batch?: number } = {}) =>
  runDataRetention(NOW, { workspaces: [fx.workspaceId], partitions: false, ...extra })

const someone = async (name: string): Promise<Actor> => joinAs(fx.workspaceId, await createUser(name), 'member')

async function putEvent(createdAt: Date, workspaceId = fx.workspaceId, pageId = page): Promise<string> {
  const id = randomUUID()
  await query(
    `INSERT INTO activity_event (id, workspace_id, page_id, actor_id, type, payload, created_at)
     VALUES ($1, $2, $3, $4, 'page.created', '{}'::jsonb, $5)`,
    [id, workspaceId, pageId, fx.owner.userId, createdAt],
  )
  return id
}

async function putNotification(input: {
  recipient: string
  created: Date
  read?: Date | null
  archived?: Date | null
  events?: string[]
  workspaceId?: string
  pageId?: string
}): Promise<string> {
  const id = randomUUID()
  await query(
    `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, read_at, archived_at, created_at)
     VALUES ($1, $2, $3, $4, $5::uuid[], 'mention', $6, $7, $8, $9)`,
    [
      id,
      input.recipient,
      input.workspaceId ?? fx.workspaceId,
      input.pageId ?? page,
      input.events ?? [randomUUID()],
      `test:${id}`,
      input.read ?? null,
      input.archived ?? null,
      input.created,
    ],
  )
  return id
}

const alive = async (table: 'notification' | 'activity_event', ids: readonly string[]) =>
  (await query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])).map((r) => r.id).sort()

describe('① 읽었거나 보관한 알림', () => {
  test('★ 그 뒤 180일이 지나면 지운다 — 늦은 쪽의 시각 · 최근에 읽은 것 · 안 읽은 것은 나이와 상관없이 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await someone('읽은 알림의 주인')
    const oldRead = await putNotification({ recipient: who.userId, created: ago(400), read: ago(200) })
    const oldArchived = await putNotification({ recipient: who.userId, created: ago(400), archived: ago(200) })
    const readLongAgoArchivedLately = await putNotification({ recipient: who.userId, created: ago(400), read: ago(300), archived: ago(10) })
    const recentRead = await putNotification({ recipient: who.userId, created: ago(400), read: ago(10) })
    const oldUnread = await putNotification({ recipient: who.userId, created: ago(900) })

    const result = await run()
    assert.equal(result.processedNotifications, 2)
    assert.deepEqual(
      await alive('notification', [oldRead, oldArchived, readLongAgoArchivedLately, recentRead, oldUnread]),
      [readLongAgoArchivedLately, recentRead, oldUnread].sort(),
      '늦은 쪽(보관) 이 최근이면 남는다 · 안 읽은 것은 나이로 지우지 않는다',
    )
  })
})

describe('② 안 읽은 알림의 상한', () => {
  test('★ 사람마다 상한을 넘은 오래된 것만 — 상한 안의 사람은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const heavy = await someone('안 읽은 알림이 많은 사람')
    const light = await someone('안 읽은 알림이 적은 사람')
    const mine = [] as string[]
    for (let i = 4; i >= 1; i -= 1) mine.push(await putNotification({ recipient: heavy.userId, created: ago(i) }))
    const readOne = await putNotification({ recipient: heavy.userId, created: ago(0), read: ago(0) })
    const theirs = [await putNotification({ recipient: light.userId, created: ago(5) }), await putNotification({ recipient: light.userId, created: ago(6) })]

    const result = await run({ unreadCap: 2 })
    assert.equal(result.unreadOverCap, 2)
    assert.deepEqual(await alive('notification', mine), mine.slice(2).sort(), '가장 최근 둘이 남는다(가장 오래된 둘이 빠진다)')
    assert.deepEqual(await alive('notification', [readOne, ...theirs]), [readOne, ...theirs].sort(), '읽은 것 · 상한 안의 사람은 그대로')
  })
})

describe('③ 활동 이벤트', () => {
  test('★ 90일 — 남은 알림이 가리키는 것은 남고, 이 판에 지운 알림이 가리키던 것은 함께 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await someone('이벤트를 받은 사람')
    const lonely = await putEvent(ago(100))
    const kept = await putEvent(ago(100))
    const fresh = await putEvent(ago(10))
    const orphaned = await putEvent(ago(100))
    await putNotification({ recipient: who.userId, created: ago(100), events: [kept] }) // 안 읽음 — 남는다
    const goes = await putNotification({ recipient: who.userId, created: ago(300), read: ago(250), events: [orphaned] }) // 이 판에 지워진다

    const result = await run()
    assert.deepEqual(await alive('notification', [goes]), [], '전제 — 그 알림은 지워졌다')
    assert.deepEqual(await alive('activity_event', [lonely, kept, fresh, orphaned]), [kept, fresh].sort())
    assert.ok(result.events >= 2)
  })
})

describe('④ 최근 방문', () => {
  test('★ 사람마다 최근 N개만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pages = [] as string[]
    for (let i = 0; i < 4; i += 1) pages.push((await createPage(fx.owner.ctx, { title: titleFromPlainText(`방문 ${i}`) })).id)
    const other = await someone('방문이 적은 사람')
    for (const [i, id] of pages.entries()) {
      await query(
        `INSERT INTO recent_visit (user_id, workspace_id, block_id, last_visited_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, block_id) DO UPDATE SET last_visited_at = EXCLUDED.last_visited_at`,
        [fx.owner.userId, fx.workspaceId, id, ago(10 - i)],
      )
    }
    await query(`INSERT INTO recent_visit (user_id, workspace_id, block_id, last_visited_at) VALUES ($1, $2, $3, $4)`, [
      other.userId,
      fx.workspaceId,
      pages[0],
      ago(50),
    ])
    // 이 사람의 다른 방문(앞선 검사가 남긴 것)이 섞이지 않게 — 이 네 개만 세운다
    await query(`DELETE FROM recent_visit WHERE user_id = $1 AND workspace_id = $2 AND NOT (block_id = ANY($3::uuid[]))`, [
      fx.owner.userId,
      fx.workspaceId,
      pages,
    ])

    await run({ visitCap: 2 })
    const left = await query<{ block_id: string }>(`SELECT block_id FROM recent_visit WHERE user_id = $1 AND workspace_id = $2`, [
      fx.owner.userId,
      fx.workspaceId,
    ])
    assert.deepEqual(left.map((r) => r.block_id).sort(), pages.slice(2).sort(), '가장 최근 둘')
    assert.equal((await query(`SELECT 1 FROM recent_visit WHERE user_id = $1`, [other.userId])).length, 1, '상한 안의 사람은 그대로')
  })
})

describe('⑤ 파티션', () => {
  // 파티션을 만드는 함수(DDL)는 여기서 부르지 않는다 — 부모 표를 잠가 병렬로 도는 검사와 교착한다(실제로 버전 되돌리기 검사가 교착으로
  // 떨어졌다). 함수의 created · exists · blocked 는 verify-schema 의 [54] 가 롤백 트랜잭션 안에서 본다. 여기는 워커가 고르는 해만.
  test('워커가 미리 만드는 해는 올해 · 다음 해(UTC) — 해가 바뀌는 순간에도 UTC 로', () => {
    assert.deepEqual(partitionYears(new Date('2026-10-10T00:00:00Z')), [2026, 2027])
    assert.deepEqual(partitionYears(new Date('2027-12-31T23:59:59Z')), [2027, 2028])
    assert.deepEqual(partitionYears(new Date('2028-01-01T00:00:00Z')), [2028, 2029])
  })
})

describe('⑥ 범위 · 상한', () => {
  test('다른 워크스페이스는 건드리지 않는다 · 꽉 차면 more', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const elsewhere = await makeFixture()
    const otherPage = (await createPage(elsewhere.owner.ctx, { title: titleFromPlainText('밖') })).id
    const outside = await putNotification({
      recipient: elsewhere.owner.userId,
      created: ago(400),
      read: ago(300),
      workspaceId: elsewhere.workspaceId,
      pageId: otherPage,
    })
    const who = await someone('상한의 주인')
    for (let i = 0; i < 3; i += 1) await putNotification({ recipient: who.userId, created: ago(400), read: ago(300) })

    const first = await run({ batch: 2 })
    assert.deepEqual([first.processedNotifications, first.more], [2, true])
    const second = await run({ batch: 2 })
    assert.deepEqual([second.processedNotifications, second.more], [1, false])
    assert.deepEqual(await alive('notification', [outside]), [outside], '다른 워크스페이스는 그대로')
  })
})
