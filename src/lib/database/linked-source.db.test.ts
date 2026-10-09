/**
 * 연결된 데이터베이스 — 다른 데이터베이스의 소스 붙이기 · 떼기 (2l-1 · F-04-13, DB 필요)
 *
 *   ① 붙이면 부착 행(소유 아님)과 원본의 컬럼으로 된 뷰가 생긴다 — 원본의 행이 보이고, 원본에 더한 속성은 그 뷰에도 선다(스키마는 전역)
 *   ② 권한 — 원본을 볼 수 없으면 붙일 수 없고(없는 것과 같은 답) 붙은 소스의 이름 · 원본 id 도 받지 못한다 · 붙인 데이터베이스의 구조 권한이
 *      필요하다(원본 id 는 화면의 "원본으로 가기" — 2l-3)
 *   ③ 링크로 권한이 오르지 않는다 — 행은 원본의 권한 · 뷰(필터 · 정렬)는 붙인 곳의 권한
 *   ④ 떼면 부착 행과 그 뷰가 사라진다 — 원본은 그대로 · 소유한 소스는 떼지 않는다 · 마지막 살아 있는 소스는 떼지 않는다
 *   ⑤ 이미 붙었다 · 제 것이다 · 원본의 소스가 휴지통이면 붙인 쪽에서도 빠진다
 *   ⑥ 원본을 못 보면 붙인 뷰가 열리지 않는다(2l-2) — 뷰 읽기 · 보드 · 캘린더 · 개인 필터 · 뷰 고치기 · 그 소스로 뷰 만들기가 모두 없는 것과
 *      같은 답이다(뷰는 그릇의 것이지만 컬럼 · 행은 원본의 내용이다) · 그릇의 제 뷰는 그대로 · 떼기는 된다
 *
 * 반사실(HANDOFF §3.3): 원본의 권한을 안 보면 ② 가, 이름을 가리지 않으면 ② 의 이름이, 소유를 안 가리면 ④ 가 실패한다.
 * 뷰 게이트(`openView`) · 보드 게이트(`openBoard`) · 뷰 만들기에서 원본을 안 보면 ⑥ 의 각 줄이 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase, getDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { queryRows } from './query.ts'
import { createView, getView, setPersonalView, updateView } from './view.ts'
import { moveRow, queryGroupCalculations, queryGroups } from './group.ts'
import { queryCalendar } from './calendar-query.ts'
import { attachLinkedDataSource, detachLinkedDataSource, listDataSources, trashDataSource, addDataSource } from './data-source.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
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

async function table(name: string, actor: Actor = fx.owner) {
  const created = unwrap(await createDatabase(actor.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(actor.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const row = async (title: string) =>
    unwrap(await createRow(actor.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
  return { id: created.id, ds, titleId, row, viewId: created.defaultViewId }
}

/** 이 데이터베이스를 소유자만 보게(필요하면 동료에게 한 등급). */
const restrict = async (databaseId: string, level?: 'view' | 'edit' | 'full_access') => {
  assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
  if (level !== undefined) assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok, true)
}

describe('① 붙이기', () => {
  test('★ 부착 행(소유 아님)과 원본의 컬럼으로 된 뷰 — 원본의 행이 보이고 원본에 더한 속성도 그 뷰에 선다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const original = await table('원본')
    await original.row('가')
    const container = await table('대시보드')

    const added = unwrap(await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: original.ds }))
    assert.deepEqual(
      [added.dataSource.id, added.dataSource.owned, added.dataSource.name, added.dataSource.ownerDatabaseId],
      [original.ds, false, '원본', original.id],
    )
    const sources = unwrap(await listDataSources(fx.owner.ctx, container.id))
    assert.deepEqual(sources.map((s) => [s.owned, s.readable, s.ownerDatabaseId]), [
      [true, true, container.id],
      [false, true, original.id],
    ])

    const view = unwrap(await getView(fx.owner.ctx, added.viewId))
    assert.equal(view.dataSourceId, original.ds)
    assert.deepEqual(view.columns.map((c) => c.propertyId), [original.titleId])
    assert.deepEqual(unwrap(await queryRows(fx.owner.ctx, original.ds)).rows.map((r) => r.title), ['가'])

    // 스키마는 원본의 것 — 원본에 더한 속성이 붙인 뷰에도 선다
    await addProperty(fx.owner.ctx, original.ds, { name: '수량', type: 'number' })
    const after = unwrap(await getView(fx.owner.ctx, added.viewId))
    assert.ok(after.columns.some((c) => c.name === '수량'))
  })
})

describe('② 권한', () => {
  test('★ 원본을 볼 수 없으면 붙일 수 없다(없는 것과 같은 답) · 붙인 데이터베이스의 구조 권한이 필요하다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const secret = await table('기밀 원본')
    await restrict(secret.id)
    const mine = await table('내 대시보드', other)
    const denied = await attachLinkedDataSource(other.ctx, mine.id, { dataSourceId: secret.ds })
    assert.equal(denied.ok === false && denied.reason, 'not_found')

    const open = await table('열린 원본')
    const viewOnly = await table('볼 수만 있는 그릇')
    await restrict(viewOnly.id, 'view')
    const forbidden = await attachLinkedDataSource(other.ctx, viewOnly.id, { dataSourceId: open.ds })
    assert.equal(forbidden.ok === false && forbidden.reason, 'forbidden')
  })

  test('★ 원본을 볼 수 없게 되면 붙은 소스의 이름을 받지 못한다(readable: false)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const original = await table('나중에 숨는 원본')
    const container = await table('함께 쓰는 그릇')
    unwrap(await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: original.ds }))
    await restrict(original.id)
    const seen = unwrap(await listDataSources(other.ctx, container.id))
    const linked = seen.find((s) => !s.owned)!
    assert.deepEqual([linked.readable, linked.name, linked.ownerDatabaseId], [false, '', null])
    assert.ok(!JSON.stringify(seen).includes('나중에 숨는 원본'))
    const db = unwrap(await getDatabase(other.ctx, container.id))
    assert.ok(!JSON.stringify(db.dataSources).includes('나중에 숨는 원본'), '데이터베이스 읽기도 가린다')
  })
})

describe('③ 링크로 권한이 오르지 않는다', () => {
  test('★ 행은 원본의 권한 · 뷰는 붙인 곳의 권한', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const original = await table('볼 수만 있는 원본')
    const row = await original.row('가')
    await restrict(original.id, 'view') // 동료는 원본을 볼 수만 있다
    const container = await table('동료의 그릇', other) // 동료는 그릇의 주인이다
    const added = unwrap(await attachLinkedDataSource(other.ctx, container.id, { dataSourceId: original.ds }))

    // 행 — 원본의 권한(볼 수만 있다): 읽을 수는 있고 쓸 수 없다
    assert.deepEqual(unwrap(await queryRows(other.ctx, original.ds)).rows.map((r) => r.id), [row])
    const write = await updateCells(other.ctx, row, { cells: [{ propertyId: original.titleId, value: { type: 'title', title: [textRun('바꿈')] } }] })
    assert.equal(write.ok, false, '링크로 쓰기 권한이 생기지 않는다')
    // 뷰 — 붙인 곳의 권한(주인): 필터를 걸 수 있다
    unwrap(await updateView(other.ctx, added.viewId, { filter: { property_id: original.titleId, operator: 'is_not_empty' } }))
  })
})

describe('④ 떼기', () => {
  test('★ 부착 행과 그 뷰가 사라진다 — 원본은 그대로 · 소유한 소스는 떼지 않는다 · 마지막 살아 있는 소스는 떼지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const original = await table('떼일 원본')
    await original.row('가')
    const container = await table('뗄 그릇')
    const added = unwrap(await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: original.ds }))

    const owned = await detachLinkedDataSource(fx.owner.ctx, container.id, container.ds)
    assert.equal(owned.ok === false && owned.reason, 'owned_source')

    unwrap(await detachLinkedDataSource(fx.owner.ctx, container.id, original.ds))
    assert.deepEqual(unwrap(await listDataSources(fx.owner.ctx, container.id)).map((s) => s.id), [container.ds])
    assert.equal((await getView(fx.owner.ctx, added.viewId)).ok, false, '그 소스를 보던 뷰도 사라졌다')
    assert.deepEqual(unwrap(await queryRows(fx.owner.ctx, original.ds)).rows.map((r) => r.title), ['가'], '원본은 그대로')
    const views = await withReadTransaction((tx) => tx.query(`SELECT 1 FROM view WHERE data_source_id = $1 AND database_id = $2`, [original.ds, original.id]))
    assert.equal(views.length, 1, '원본의 뷰도 그대로')

    // 마지막 살아 있는 소스 — 제 소스를 휴지통에 넣어 붙인 소스만 남긴 그릇
    const solo = await table('붙인 것만 남을 그릇')
    unwrap(await attachLinkedDataSource(fx.owner.ctx, solo.id, { dataSourceId: original.ds }))
    unwrap(await trashDataSource(fx.owner.ctx, solo.ds)) // 붙인 소스가 살아 있으니 마지막이 아니다
    assert.deepEqual(unwrap(await listDataSources(fx.owner.ctx, solo.id)).map((x) => x.id), [original.ds])
    const last = await detachLinkedDataSource(fx.owner.ctx, solo.id, original.ds)
    assert.equal(last.ok === false && last.reason, 'last_source')
  })
})

describe('⑤ 이미 붙었다 · 제 것 · 원본의 휴지통', () => {
  test('이미 붙었다 · 제 것이다 · 원본의 소스가 휴지통이면 붙인 쪽에서도 빠진다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const original = await table('두 번 붙일 원본')
    const container = await table('그릇')
    unwrap(await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: original.ds }))
    const twice = await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: original.ds })
    assert.equal(twice.ok === false && twice.reason, 'already_attached')
    const self = await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: container.ds })
    assert.equal(self.ok === false && self.reason, 'invalid_target')
    const nonsense = await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: 'not-a-uuid' })
    assert.equal(nonsense.ok === false && nonsense.reason, 'not_found')

    // 원본의 소스가 휴지통이면 붙인 쪽에서도 빠진다(살아 있는 소스만 읽는다 · 데이터베이스 블록에는 수명이 없다 — X-3)
    unwrap(await addDataSource(fx.owner.ctx, original.id, { name: '원본 둘째' })) // 마지막 소스는 휴지통에 넣을 수 없다
    unwrap(await trashDataSource(fx.owner.ctx, original.ds))
    assert.ok(!unwrap(await listDataSources(fx.owner.ctx, container.id)).some((x) => x.id === original.ds))
  })
})

describe('⑥ 원본을 못 보면 붙인 뷰가 열리지 않는다 (2l-2)', () => {
  test('★ 뷰 읽기 · 보드 · 캘린더 · 개인 필터 · 뷰 고치기 · 뷰 만들기 — 모두 없는 것과 같은 답 · 그릇의 제 뷰는 그대로 · 떼기는 된다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const original = await table('숨을 원본')
    const row = await original.row('기밀 행')
    unwrap(await addProperty(fx.owner.ctx, original.ds, { name: '기밀 상태', type: 'select' }))
    unwrap(await addProperty(fx.owner.ctx, original.ds, { name: '기밀 날짜', type: 'date' }))
    const container = await table('함께 보는 그릇')
    const added = unwrap(await attachLinkedDataSource(fx.owner.ctx, container.id, { dataSourceId: original.ds }))
    const board = unwrap(await createView(fx.owner.ctx, container.id, { type: 'board', dataSourceId: original.ds }))
    const calendar = unwrap(await createView(fx.owner.ctx, container.id, { type: 'calendar', dataSourceId: original.ds }))
    const month = { from: '2026-01-01', to: '2026-01-31' }

    // 볼 수 있을 때는 열린다 — 아래의 거부가 다른 까닭이 아님을 먼저 보인다
    assert.ok(JSON.stringify(unwrap(await getView(other.ctx, added.viewId)).columns).includes('기밀 상태'))
    assert.equal((await queryGroups(other.ctx, board.id)).ok, true)
    assert.equal((await queryCalendar(other.ctx, calendar.id, month)).ok, true)

    await restrict(original.id) // 동료는 이제 원본을 볼 수 없다 — 그릇은 그대로 보고 고칠 수 있다
    const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)
    assert.equal(reason(await getView(other.ctx, added.viewId)), 'not_found', '뷰 읽기 — 컬럼은 원본의 스키마다')
    assert.equal(reason(await queryGroups(other.ctx, board.id)), 'not_found', '보드의 카드는 원본의 행이다')
    assert.equal(reason(await queryGroupCalculations(other.ctx, board.id)), 'not_found', '보드의 그룹 계산')
    assert.equal(reason(await moveRow(other.ctx, board.id, { rowId: row, groupKey: '' })), 'not_found', '카드 옮기기')
    assert.equal(reason(await queryCalendar(other.ctx, calendar.id, month)), 'not_found', '캘린더의 행')
    assert.equal(reason(await setPersonalView(other.ctx, added.viewId, { sorts: [] })), 'not_found', '개인 정렬')
    assert.equal(reason(await updateView(other.ctx, added.viewId, { name: '바꾼 이름' })), 'not_found', '뷰 고치기도 컬럼째 돌려준다')
    assert.equal(reason(await createView(other.ctx, container.id, { dataSourceId: original.ds })), 'not_found', '그 소스로 뷰 만들기')

    // 그릇의 제 뷰는 그대로 열린다 · 떼기는 된다(그릇의 일이다 — 원본을 못 보게 된 사람이 그 탭을 치우는 길)
    assert.equal((await getView(other.ctx, container.viewId)).ok, true)
    unwrap(await detachLinkedDataSource(other.ctx, container.id, original.ds))
    assert.deepEqual(unwrap(await listDataSources(other.ctx, container.id)).map((s) => s.id), [container.ds])
  })
})
