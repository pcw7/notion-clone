/**
 * 담당 알림 — 게시 · 공유 6h조각 (F-11-08 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.8 [보강] 담당 알림).
 *
 *   ① ★ 새로 든 사람만 — 새 행의 사람 칸 · 셀 쓰기에서 쓰기 전에 없던 사람이 받는다 · 쓴 사람 자신 · 이미 든 사람 · 뺀 사람은 받지
 *      않는다 · 같은 값을 다시 써도 없다 · 활동 이벤트 `person.assigned`(속성 id 만) · 묶음 `assign:{행}:{속성}`
 *   ② 템플릿 행은 만들지 않는다(R1) — 템플릿으로 만든 행에 든 사람은 받는다
 *   ③ 끌 수 없다 — 그 행을 뮤트(`none`)해도 받는다 · 인박스 줄은 속성의 지금 이름(지우면 null)
 *   ④ ★ 배달 시점 권한 — 그 행을 못 보면 인박스 · 배지에 없다 · 사람 규칙이 그 사람에게 행을 열면 곧바로 보인다(스코프에 없어도 —
 *      행 단위 접근 규칙 ⑤ 의 예외) · 칸에서 빠져 규칙이 닫으면 다시 사라진다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createDatabase } from '../database/database.ts'
import { addProperty, deleteProperty, getSchema } from '../database/property.ts'
import type { CellValue } from '../database/property-types.ts'
import { createRow, updateCells } from '../database/row.ts'
import { createRowFromTemplate, createTemplate } from '../database/template.ts'
import { query } from '../db/pool.ts'
import { setAccessRule } from '../permissions/access-rule.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { assignGroupKey } from './fanout.ts'
import { listInbox, unreadCount } from './inbox.ts'
import { setSubscription } from './subscription.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const people = (...ids: string[]): CellValue => ({ type: 'people', people: ids.map((id) => ({ id })) })

/** 대표 · 동료 · 셋째 · 담당(사람) 속성이 있는 표. `privateTop` 이면 대표만 본다. */
async function team(privateTop = false) {
  const ws = await createBareWorkspace('담당 알림')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const third = await joinAs(ws, await createUser('셋째'), 'member')
  const db = unwrap(await createDatabase(boss.ctx, { name: '할 일', privateTop }))
  unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '담당', type: 'people' }))
  const owner = unwrap(await getSchema(boss.ctx, db.dataSourceId)).properties.find((p) => p.name === '담당')!.id
  return { ws, boss, mate, third, db, owner }
}

/** 그 사람이 그 행에 받은 담당 알림(인박스의 권한 거르기 없이 — 저장된 것). */
const stored = async (who: Actor, rowId: string) =>
  query<{ kind: string; group_key: string; event_ids: string[] }>(
    `SELECT kind, group_key, event_ids FROM notification WHERE recipient_id = $1 AND page_id = $2 AND kind = 'person_property_assigned'`,
    [who.userId, rowId],
  )

const assign = async (who: Actor, rowId: string, propertyId: string, value: CellValue) =>
  unwrap(await updateCells(who.ctx, rowId, { cells: [{ propertyId, value }] }))

// ── ① 새로 든 사람만 ───────────────────────────────────────────────────

describe('① ★ 새로 든 사람만', () => {
  test('새 행 · 넣기 · 같은 값 · 빼기 · 자기 자신 — 쓰기 전에 없던 사람만 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, third, db, owner } = await team()
    const row = unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(mate.userId, boss.userId) }] })).id

    const first = await stored(mate, row)
    assert.equal(first.length, 1, '새 행의 칸에 든 사람이 받는다')
    assert.equal(first[0]!.group_key, assignGroupKey(row, owner))
    assert.equal((await stored(boss, row)).length, 0, '쓴 사람 자신은 받지 않는다')
    const events = await query<{ type: string; payload: unknown; actor_id: string }>(
      `SELECT type, payload, actor_id FROM activity_event WHERE id = $1`,
      [first[0]!.event_ids[0]],
    )
    assert.deepEqual(events.map((e) => [e.type, e.payload, e.actor_id]), [['person.assigned', { property_id: owner }, boss.userId]], '속성 id 만')

    await assign(boss, row, owner, people(mate.userId, third.userId))
    assert.equal((await stored(third, row)).length, 1, '새로 든 사람')
    assert.equal((await stored(mate, row)).length, 1, '이미 든 사람은 다시 받지 않는다')

    await assign(boss, row, owner, people(mate.userId, third.userId))
    await assign(boss, row, owner, people(third.userId))
    assert.deepEqual([(await stored(mate, row)).length, (await stored(third, row)).length], [1, 1], '같은 값 · 빼기는 알림이 없다')

    await assign(mate, row, owner, people(third.userId, mate.userId))
    assert.equal((await stored(mate, row)).length, 1, '자기를 넣은 사람은 받지 않는다')
    await assign(boss, row, owner, people())
    await assign(boss, row, owner, people(mate.userId))
    assert.equal((await stored(mate, row)).length, 2, '빠졌다가 다시 들면 다시 받는다(조회 때 한 묶음으로 접힌다)')
  })
})

// ── ② 템플릿 ──────────────────────────────────────────────────────────

describe('② 템플릿 행은 만들지 않는다', () => {
  test('템플릿의 칸에 넣어도 없다 · 그 템플릿으로 만든 행에 든 사람은 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await team()
    const template = unwrap(await createTemplate(boss.ctx, db.dataSourceId, { title: '담당 양식' }))
    await assign(boss, template.id, owner, people(mate.userId))
    assert.equal((await stored(mate, template.id)).length, 0, '템플릿은 항목이 아니다(R1)')

    const made = unwrap(await createRowFromTemplate(boss.ctx, db.dataSourceId, template.id))
    assert.equal((await stored(mate, made.row.id)).length, 1, '템플릿으로 만든 행 — 그 행이 생긴 순간 든 것이다')
  })
})

// ── ③ 끌 수 없다 · 인박스 줄 ─────────────────────────────────────────

describe('③ 끌 수 없다 · 인박스 줄', () => {
  test('뮤트해도 받는다 · 인박스 줄은 속성의 지금 이름 · 지우면 이름이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await team()
    const row = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
    unwrap(await setSubscription(mate.ctx, row, 'none'))
    await assign(boss, row, owner, people(mate.userId))
    assert.equal((await stored(mate, row)).length, 1, '11 "개별 사용자가 이 알림을 끌 수 없다"')

    const items = (await listInbox(mate.ctx)).filter((i) => i.pageId === row)
    assert.deepEqual(
      items.map((i) => [i.kind, i.assignment, i.reminder, i.actorId]),
      [['person_property_assigned', { propertyName: '담당' }, null, boss.userId]],
    )
    unwrap(await deleteProperty(boss.ctx, db.dataSourceId, owner))
    const after = (await listInbox(mate.ctx)).filter((i) => i.pageId === row)
    assert.deepEqual(after.map((i) => i.assignment), [{ propertyName: null }], '지운 속성 — 이름 없이(복제하지 않는다)')
  })
})

// ── ④ 배달 시점 권한 ───────────────────────────────────────────────────

describe('④ ★ 배달 시점 권한', () => {
  test('못 보면 없다 · 사람 규칙이 열면 보인다(스코프 밖이라도) · 칸에서 빠지면 다시 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await team(true)
    const row = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
    const seen = async () => (await listInbox(mate.ctx)).filter((i) => i.pageId === row).length
    const badge = () => unreadCount(mate.ctx)

    await assign(boss, row, owner, people(mate.userId))
    assert.equal((await stored(mate, row)).length, 1, '만들기는 한다 — 받는 사람의 세션이 없어 판정할 수 없다')
    assert.deepEqual([await seen(), await badge()], [0, 0], '그 행을 못 보면 인박스 · 배지에 없다')

    unwrap(await setAccessRule(boss.ctx, db.id, { dataSourceId: db.dataSourceId, source: 'person_property', propertyId: owner, level: 'edit' }))
    assert.deepEqual([await seen(), await badge()], [1, 1], '★ 사람 규칙이 그 행을 열면 곧바로 보인다(스코프에 없어도)')

    await assign(boss, row, owner, people(boss.userId))
    assert.deepEqual([await seen(), await badge()], [0, 0], '칸에서 빠지면 규칙이 닫는다 — 다시 없다(지우지는 않는다)')
    assert.equal((await stored(mate, row)).length, 1)
  })
})
