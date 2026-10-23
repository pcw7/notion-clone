/**
 * 뷰 탭 순서 바꾸기 — §7 정리 10n-18 (F-04-01)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 탭 순서 바꾸기
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 이 뷰를 저 뷰 앞에 · 맨 뒤로 — 탭 목록(`listViews`)이 그 차례로 읽힌다
 *   ② 이미 그 자리면 쓰지 않는다(`updated_at` 이 그대로 — 키는 다시 내도 우연히 같을 수 있어 가르지 못한다)
 *   ③ ★ 거부 — 자기 자신 · 다른 데이터베이스의 뷰 · 없는 뷰를 `before` 로
 *   ④ ★ 권한 — 볼 수만 있는 사람은 못 옮긴다 · 잠긴 데이터베이스는 막는다
 *   ⑤ 여럿이 같은 자리로 동시에 옮겨도 키가 겹치지 않는다(탭 여덟 — 둘이면 실제로는 차례로 돌아 잠금 없이도 통과했다)
 *   ⑥ 새 탭을 동시에 여럿 만들어도 맨 뒤 키가 겹치지 않는다(같은 잠금)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { createDatabase } from './database.ts'
import { createView, listViews, moveView } from './view.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let viewer: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  viewer = await joinAs(fx.workspaceId, await createUser('보기만'), 'member')
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
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)

/** 탭 셋(가 · 나 · 다)을 가진 데이터베이스. */
async function threeTabs(name: string) {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const a = db.defaultViewId
  const b = unwrap(await createView(fx.owner.ctx, db.id, { name: '나', type: 'table' })).id
  const c = unwrap(await createView(fx.owner.ctx, db.id, { name: '다', type: 'list' })).id
  const order = async () => unwrap(await listViews(fx.owner.ctx, db.id)).map((v) => v.id)
  return { db, a, b, c, order }
}

const keyOf = async (viewId: string) => (await query<{ order_idx: string }>(`SELECT order_idx FROM view WHERE id = $1`, [viewId]))[0]!.order_idx
const touchedAt = async (viewId: string) =>
  (await query<{ t: string }>(`SELECT updated_at::text AS t FROM view WHERE id = $1`, [viewId]))[0]!.t

describe('뷰 탭 순서 바꾸기 (10n-18)', () => {
  test('★ ① 이 뷰를 저 뷰 앞에 · 맨 뒤로 — 탭 목록이 그 차례로 읽힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { a, b, c, order } = await threeTabs('탭 순서')
    assert.deepEqual(await order(), [a, b, c], '전제 — 만든 차례')

    assert.deepEqual(unwrap(await moveView(fx.owner.ctx, c, a)), [c, a, b], '답은 옮긴 뒤의 차례')
    assert.deepEqual(await order(), [c, a, b], '다를 가 앞으로')
    unwrap(await moveView(fx.owner.ctx, c, null))
    assert.deepEqual(await order(), [a, b, c], '맨 뒤로')
    unwrap(await moveView(fx.owner.ctx, a, c))
    assert.deepEqual(await order(), [b, a, c], '가를 다 앞으로(한 칸 오른쪽)')
  })

  test('② 이미 그 자리면 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { a, b, c, order } = await threeTabs('제자리')
    const before = await touchedAt(b)
    assert.deepEqual(unwrap(await moveView(fx.owner.ctx, b, c)), [a, b, c])
    assert.equal(await touchedAt(b), before, '쓰지 않았다(updated_at 그대로)')
    unwrap(await moveView(fx.owner.ctx, c, null))
    assert.deepEqual(await order(), [a, b, c])
  })

  test('★ ③ 거부 — 자기 자신 · 다른 데이터베이스의 뷰 · 없는 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { a, b } = await threeTabs('거부')
    const other = await threeTabs('다른 표')
    assert.equal(reasonOf(await moveView(fx.owner.ctx, a, a)), 'invalid_position')
    assert.equal(reasonOf(await moveView(fx.owner.ctx, a, other.a)), 'invalid_position')
    assert.equal(reasonOf(await moveView(fx.owner.ctx, a, randomUUID())), 'invalid_position')
    assert.equal(reasonOf(await moveView(fx.owner.ctx, randomUUID(), b)), 'not_found')
  })

  test('★ ④ 권한 — 볼 수만 있는 사람은 못 옮긴다 · 잠긴 데이터베이스는 막는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { db, a, c, order } = await threeTabs('권한')
    assert.ok((await stopInheriting(fx.owner.ctx, db.id)).ok)
    assert.ok((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
    assert.ok((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: viewer.userId }, 'view')).ok)
    assert.ok((await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone', id: null })).ok)
    assert.equal(reasonOf(await moveView(viewer.ctx, c, a)), 'forbidden')

    assert.ok((await setDatabaseLock(fx.owner.ctx, db.id, true)).ok)
    assert.equal(reasonOf(await moveView(fx.owner.ctx, c, a)), 'locked')
    assert.ok((await setDatabaseLock(fx.owner.ctx, db.id, false)).ok)
    unwrap(await moveView(fx.owner.ctx, c, a))
    assert.equal((await order())[0], c, '풀면 옮긴다')
  })

  test('⑤ 여럿이 같은 자리로 동시에 옮겨도 키가 겹치지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { db, a, b, c } = await threeTabs('동시')
    const more: string[] = []
    for (let i = 0; i < 5; i += 1) more.push(unwrap(await createView(fx.owner.ctx, db.id, { name: `탭${i}`, type: 'table' })).id)
    const movers = [b, c, ...more]
    const results = await Promise.all(movers.map((id) => moveView(fx.owner.ctx, id, a)))
    assert.ok(results.every((r) => r.ok), '모두 옮겨졌다')
    const keys = await Promise.all([a, ...movers].map(keyOf))
    assert.equal(new Set(keys).size, keys.length, `키가 모두 다르다: ${keys.join(',')}`)
    assert.equal(unwrap(await listViews(fx.owner.ctx, db.id)).at(-1)?.id, a, '가는 맨 뒤 — 모두 그 앞으로 갔다')
  })

  test('⑥ 새 탭을 동시에 여럿 만들어도 맨 뒤 키가 겹치지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '동시 만들기' }))
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => createView(fx.owner.ctx, db.id, { name: `새${i}`, type: 'table' })))
    assert.ok(made.every((r) => r.ok), '모두 만들어졌다')
    const ids = [db.defaultViewId, ...made.map((r) => (r.ok ? r.value.id : ''))]
    const keys = await Promise.all(ids.map(keyOf))
    assert.equal(new Set(keys).size, keys.length, `키가 모두 다르다: ${keys.join(',')}`)
  })
})
