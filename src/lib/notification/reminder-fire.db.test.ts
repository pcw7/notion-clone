/**
 * 리마인더 울리기 — 히스토리 · 활동 4c-2 (F-11-10, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 울린다 — 때가 된 리마인더가 받는 사람의 알림(`reminder` · 묶음 `reminder:{id}`)과 활동 이벤트(`reminder.fired` · id 만)가 된다 · 인박스에
 *      울린 날짜 속성의 지금 이름 · 두 번 돌아도 한 번 · 때가 안 된 것은 그대로
 *   ② 울리지 않는 것 — 페이지가 휴지통(되살려도 지난 것은 울리지 않는다) · 날짜 속성을 지웠다 · 받는 사람이 떠났다
 *   ③ 한 번만 — 다른 워커가 먼저 선점한 것을 집으면 진다(선점을 기다린 뒤 다시 보고 물러난다) · 두 판이 동시에 돌아도 알림은 하나
 *   ④ 페이지를 볼 수 있는가는 인박스가 읽을 때 — 알림은 만들어지고, 볼 수 없게 된 사람의 인박스에는 서지 않는다
 *   ⑤ 한 판의 상한
 *
 * 검사는 자기 워크스페이스만 울린다(`workspaces`) · 시각은 실행기가 정한다(리마인더는 2030년).
 *
 * 반사실(HANDOFF §3.3): 선점을 조건 없이 하면 ③, 페이지를 보지 않으면 ②, 멤버를 거르지 않으면 ②, 속성을 보지 않으면 ② 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty, deleteProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { setDateReminder } from '../database/reminder.ts'
import { restorePage, trashPage } from '../block/trash.ts'
import { asBlockId } from '../ids.ts'
import { listInbox } from './inbox.ts'
import { reminderGroupKey, runReminderFire } from './reminder-fire.ts'

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
  mate = await joinAs(fx.workspaceId, await createUser('리마인더를 받는 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 2030-05-01 09:00 UTC 에 울리는 리마인더(날짜만 · UTC · 그날). */
const AT = new Date('2030-05-01T09:00:00Z')
const after1m = new Date(AT.getTime() + 60_000)
const fire = (now: Date, batch?: number) => runReminderFire(now, { workspaces: [fx.workspaceId], ...(batch === undefined ? {} : { batch }) })
/** 이 워크스페이스의 다른 때가 된 리마인더를 미리 울려 둔다 — 검사마다 결과의 수가 그 검사의 것만이 되게. */
const settle = async (now: Date) => {
  while ((await fire(now)).more) {
    // 꽉 찼으면 다시
  }
}

/** 표 하나 · 날짜 속성 · 행 — 그 행에 `who` 가 리마인더를 건다. */
async function armed(name: string, who: Actor = fx.owner) {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const due = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
  const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
  unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: due, value: { type: 'date', date: { start: '2030-05-01' } } }] }))
  unwrap(await setDateReminder(who.ctx, row, due, { leadMinutes: 0, timeZone: 'UTC' }))
  const { id } = await queryOne<{ id: string }>(`SELECT id FROM reminder WHERE page_id = $1 AND property_id = $2`, [row, due])
  return { db, due, row, reminderId: id }
}

const notificationsOf = (reminderId: string) =>
  query<{ recipient_id: string; kind: string; page_id: string }>(`SELECT recipient_id, kind, page_id FROM notification WHERE group_key = $1`, [
    reminderGroupKey(reminderId),
  ])
const firedAt = async (reminderId: string) =>
  (await queryOne<{ fired_at: Date | null }>(`SELECT fired_at FROM reminder WHERE id = $1`, [reminderId])).fired_at

describe('① 울린다', () => {
  test('★ 받는 사람의 알림과 활동 이벤트가 된다 · 인박스에 속성 이름 · 두 번 돌아도 한 번 · 때가 안 된 것은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await settle(after1m)
    const a = await armed('울리기')

    const early = await fire(new Date(AT.getTime() - 60_000))
    assert.deepEqual([early.fired, early.suppressed], [0, 0], '때가 안 됐다')

    const result = await fire(after1m)
    assert.deepEqual([result.fired, result.suppressed, result.notifications, result.more], [1, 0, 1, false])
    assert.deepEqual(await notificationsOf(a.reminderId), [{ recipient_id: fx.owner.userId, kind: 'reminder', page_id: a.row }])
    assert.equal((await firedAt(a.reminderId))?.getTime(), after1m.getTime(), '선점이 실행기의 시각을 적는다')
    const event = await queryOne<{ type: string; payload: Record<string, string>; actor_id: string }>(
      `SELECT type, payload, actor_id FROM activity_event WHERE page_id = $1 AND type = 'reminder.fired'`,
      [a.row],
    )
    assert.deepEqual([event.type, event.payload, event.actor_id], ['reminder.fired', { reminder_id: a.reminderId, property_id: a.due }, fx.owner.userId])

    const inbox = await listInbox(fx.owner.ctx)
    const item = inbox.find((i) => i.groupKey === reminderGroupKey(a.reminderId))
    assert.deepEqual([item?.kind, item?.reminder], ['reminder', { propertyName: '마감' }], '인박스에 울린 날짜 속성의 지금 이름')

    const again = await fire(new Date(AT.getTime() + 120_000))
    assert.deepEqual([again.fired, (await notificationsOf(a.reminderId)).length], [0, 1], '두 번 돌아도 한 번')
  })
})

describe('② 울리지 않는 것', () => {
  test('★ 페이지가 휴지통(되살려도 지난 것은 울리지 않는다) · 날짜 속성을 지웠다 · 받는 사람이 떠났다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await settle(after1m)
    const trashed = await armed('휴지통의 리마인더')
    await trashPage(fx.owner.ctx, asBlockId(trashed.row))
    const dropped = await armed('지운 속성의 리마인더')
    unwrap(await deleteProperty(fx.owner.ctx, dropped.db.dataSourceId, dropped.due))
    const left = await armed('떠난 사람의 리마인더', mate)
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [fx.workspaceId, mate.userId])
    try {
      const result = await fire(after1m)
      assert.deepEqual([result.fired, result.suppressed, result.notifications], [0, 3, 0])
      for (const r of [trashed, dropped, left]) {
        assert.deepEqual(await notificationsOf(r.reminderId), [], '알림이 없다')
        assert.ok((await firedAt(r.reminderId)) instanceof Date, '선점은 남는다 — "지남"')
      }
      await restorePage(fx.owner.ctx, asBlockId(trashed.row))
      assert.equal((await fire(new Date(AT.getTime() + 120_000))).fired, 0, '되살려도 지난 것은 울리지 않는다')
    } finally {
      await query(`UPDATE workspace_member SET status = 'active' WHERE workspace_id = $1 AND user_id = $2`, [fx.workspaceId, mate.userId])
    }
  })
})

describe('③ 한 번만', () => {
  test('★ 다른 워커가 먼저 선점한 것을 집으면 진다 — 선점을 기다린 뒤 다시 보고 물러난다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await settle(after1m)
    const a = await armed('먼저 선점됨')
    // 다른 워커 — 선점(fired_at)을 적고 커밋하지 않은 채 머문다. 이 판은 후보로 그것을 고르고(커밋 전이라 보이지 않는다) 그 행을 기다린다
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let claimed: () => void = () => undefined
    const holding = new Promise<void>((resolve) => (claimed = resolve))
    const other = withTransaction(async (tx) => {
      await tx.query(`UPDATE reminder SET fired_at = $2 WHERE id = $1`, [a.reminderId, after1m])
      claimed()
      await gate
    })
    await holding
    const running = fire(after1m)
    try {
      // 이 판이 그 행의 잠금을 기다릴 때까지(후보를 고른 뒤다)
      for (let i = 0; i < 100; i += 1) {
        const waiting = await queryOne<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE reminder SET fired_at = $2%'`,
        )
        if (waiting.n > 0) break
        await new Promise((r) => setTimeout(r, 50))
      }
    } finally {
      release()
      await other
    }
    const result = await running
    assert.deepEqual([result.fired, result.suppressed], [0, 0], '먼저 선점한 쪽이 이긴다 — 이 판은 물러난다')
    assert.deepEqual(await notificationsOf(a.reminderId), [], '두 번 울리지 않는다')
  })

  test('두 판이 동시에 돌아도 알림은 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await settle(after1m)
    const a = await armed('동시에')
    const [x, y] = await Promise.all([fire(after1m), fire(after1m)])
    assert.equal(x.fired + y.fired, 1)
    assert.equal((await notificationsOf(a.reminderId)).length, 1)
  })
})

describe('④ 권한은 인박스가 읽을 때', () => {
  test('★ 알림은 만들어지고 · 볼 수 없게 된 사람의 인박스에는 서지 않는다 · 다시 보면 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await settle(after1m)
    // 데이터베이스를 닫는다 — 상속을 끊고 소유자와 멤버(고칠 수 있음)에게만 준다
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '닫힌 표' }))
    assert.equal((await stopInheriting(fx.owner.ctx, db.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: mate.userId }, 'edit')).ok, true)
    const due = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
    const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
    unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: due, value: { type: 'date', date: { start: '2030-05-01' } } }] }))
    unwrap(await setDateReminder(mate.ctx, row, due, { leadMinutes: 0, timeZone: 'UTC' }))
    const { id } = await queryOne<{ id: string }>(`SELECT id FROM reminder WHERE page_id = $1`, [row])

    assert.equal((await revokeAccess(fx.owner.ctx, db.id, { type: 'user', id: mate.userId })).ok, true)
    const result = await fire(after1m)
    assert.deepEqual([result.fired, result.notifications], [1, 1], '알림은 만들어진다 — 울리는 시점에는 세션이 없다')
    const inInbox = async () => (await listInbox(mate.ctx)).some((i) => i.groupKey === reminderGroupKey(id))
    assert.equal(await inInbox(), false, '볼 수 없게 된 사람의 인박스에는 서지 않는다')
    assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: mate.userId }, 'view')).ok, true)
    assert.equal(await inInbox(), true, '다시 볼 수 있으면 선다')
  })
})

describe('⑤ 한 판의 상한', () => {
  test('꽉 차면 more — 다음 판이 나머지를 울린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await settle(after1m)
    for (const name of ['하나', '둘', '셋']) await armed(`상한 ${name}`)
    const first = await fire(after1m, 2)
    assert.deepEqual([first.fired, first.more], [2, true])
    const second = await fire(after1m, 2)
    assert.deepEqual([second.fired, second.more], [1, false])
  })
})
