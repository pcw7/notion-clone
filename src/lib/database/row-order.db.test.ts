/**
 * 묶지 않는 뷰의 행 차례 바꾸기 — §7 정리 10n-59 (F-04-01)
 *
 * 정본: 00-canonical-data-model.md §3.6 `row_position` [보강 10n-59]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ `before` 앞으로 · null 이면 맨 뒤 — 표의 행 질의가 그 차례(자리 있는 행 → 자리 없는 행의 트리 순서) · 새 행은 맨 뒤
 *   ② ★ 커서가 자리 있는 행과 없는 행의 경계를 넘어도 행을 빠뜨리거나 겹치지 않는다
 *   ③ ★ 보드의 "값 없음" 열('')과 섞이지 않는다 — 표 ↔ 보드로 바꿔도 양쪽 순서가 남는다
 *   ④ 살아 있는 정렬이 있으면 거부(`sorted`) — 개인 정렬도 · 지워진 속성의 정렬은 살아 있지 않다(그때는 수동 순서로 읽는다)
 *   ⑤ 표 · 목록 · 갤러리만 · 자기 앞은 invalid_value · 다른 소스 · 휴지통의 행은 not_found
 *   ⑥ 권한 — 볼 수만 있으면 forbidden · 못 보면 not_found
 *   ⑦ ★ 같은 뷰의 옮기기는 줄을 선다(뷰의 행을 잠근다 — 다른 쪽이 잡고 있으면 기다린다) · 동시에 옮겨도 자리를 겹쳐 주지 않는다
 *   ⑧ 공개 화면의 표도 같은 차례
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { readPublicTableIn } from '../publish/public-database.ts'
import type { PublicTarget } from '../publish/public-access.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema } from './property.ts'
import { createRow, trashRow } from './row.ts'
import { createView, setPersonalView, updateView } from './view.ts'
import { queryRows } from './query.ts'
import { moveRow, queryGroupRows } from './group.ts'
import { moveViewRow } from './row-order.ts'

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
  mate = await joinAs(fx.workspaceId, await createUser('동료'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 행 가 · 나 · 다 · 라(이 차례로 만든다 — 트리 순서)가 있는 데이터베이스와 그 기본 표 뷰. */
async function world(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const names = new Map<string, string>()
  const row = async (title: string) => {
    const made = unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] }))
    names.set(made.id, title)
    return made.id
  }
  const [ga, na, da, ra] = [await row('가'), await row('나'), await row('다'), await row('라')]
  const viewId = created.defaultViewId
  /** 이 뷰의 차례 — 행 질의 그대로(정렬은 이 사람이 실제로 보는 것). */
  const order = async (view = viewId, sorts: readonly { property_id: string; direction: 'asc' | 'desc' }[] = [], limit = 100) => {
    const page = unwrap(await queryRows(fx.owner.ctx, ds, { sorts, manualOrderViewId: view, limit }))
    return page.rows.map((r) => names.get(r.id) ?? '?').join('')
  }
  return { created, ds, titleId, viewId, ga, na, da, ra, row, names, order }
}

describe('묶지 않는 뷰의 행 차례 바꾸기 (10n-59)', () => {
  test('★ ① before 앞으로 · null 이면 맨 뒤 — 자리 있는 행 → 자리 없는 행의 트리 순서 · 새 행은 맨 뒤', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ①')
    assert.equal(await w.order(), '가나다라', '전제 — 트리 순서')
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.da, beforeRowId: w.na }))
    assert.equal(await w.order(), '가다나라')
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ga, beforeRowId: null }))
    assert.equal(await w.order(), '다나라가', '맨 뒤 — 자리 없는 행(라)에 먼저 자리를 준다')
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ra, beforeRowId: w.da }))
    assert.equal(await w.order(), '라다나가')
    await w.row('마')
    assert.equal(await w.order(), '라다나가마', '새 행은 자리가 없다 — 맨 뒤')
    // 다른 뷰는 제 차례 — 자리는 뷰의 것이다
    const other = unwrap(await createView(fx.owner.ctx, w.created.id, { type: 'table' }))
    assert.equal(await w.order(other.id), '가나다라마')
  })

  test('★ ② 커서가 자리 있는 행과 없는 행의 경계를 넘어도 빠뜨리거나 겹치지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ②')
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ra, beforeRowId: w.na })) // 가 라 | 나 다(자리 없음)
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i += 1) {
      const page = unwrap(await queryRows(fx.owner.ctx, w.ds, { manualOrderViewId: w.viewId, limit: 1, cursor }))
      seen.push(...page.rows.map((r) => w.names.get(r.id) ?? '?'))
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    assert.equal(seen.join(''), '가라나다')
  })

  test('★ ③ 보드의 값 없음 열과 섞이지 않는다 — 표 ↔ 보드로 바꿔도 양쪽 순서가 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ③')
    unwrap(await addProperty(fx.owner.ctx, w.ds, { name: '상태', type: 'select' }))
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ra, beforeRowId: w.ga }))
    assert.equal(await w.order(), '라가나다')
    // 보드로 — 모두 값 없음 열('')이다. 표의 자리는 그 열의 차례가 아니다(트리 순서)
    unwrap(await updateView(fx.owner.ctx, w.viewId, { type: 'board' }))
    const column = async () =>
      unwrap(await queryGroupRows(fx.owner.ctx, w.viewId, '', { limit: 100 })).rows.map((r) => w.names.get(r.id) ?? '?').join('')
    assert.equal(await column(), '가나다라', '표의 자리(*)를 값 없음 열이 읽지 않는다')
    unwrap(await moveRow(fx.owner.ctx, w.viewId, { rowId: w.na, groupKey: '', beforeRowId: w.ga }))
    assert.equal(await column(), '나가다라')
    // 표로 되돌린다 — 보드의 값 없음 열 자리('')가 표의 차례를 흔들지 않는다
    unwrap(await updateView(fx.owner.ctx, w.viewId, { type: 'table' }))
    assert.equal(await w.order(), '라가나다', '표의 차례가 그대로 돌아온다')
  })

  test('④ 살아 있는 정렬이 있으면 sorted — 개인 정렬도 · 지워진 속성의 정렬은 살아 있지 않다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ④')
    const prop = unwrap(await addProperty(fx.owner.ctx, w.ds, { name: '점수', type: 'number' })).properties.find((p) => p.name === '점수')!
    const sorts = [{ property_id: prop.id, direction: 'asc' as const }]
    unwrap(await updateView(fx.owner.ctx, w.viewId, { sorts }))
    assert.deepEqual(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.da, beforeRowId: w.ga }), { ok: false, reason: 'sorted' })
    unwrap(await updateView(fx.owner.ctx, w.viewId, { sorts: [] }))
    // 개인 정렬 — 이 사람이 실제로 보는 것은 정렬된 표다
    unwrap(await setPersonalView(mate.ctx, w.viewId, { sorts }))
    assert.deepEqual(await moveViewRow(mate.ctx, w.viewId, { rowId: w.da, beforeRowId: w.ga }), { ok: false, reason: 'sorted' })
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.da, beforeRowId: w.ga }))
    // 정렬 키의 속성이 지워졌다 — 살아 있는 정렬이 아니다. 옮길 수 있고 수동 순서로 읽는다
    unwrap(await updateView(fx.owner.ctx, w.viewId, { sorts }))
    unwrap(await deleteProperty(fx.owner.ctx, w.ds, prop.id))
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ra, beforeRowId: w.da }))
    assert.equal(await w.order(w.viewId, sorts), '라다가나')
  })

  test('⑤ 표 · 목록 · 갤러리만 · 자기 앞은 invalid_value · 다른 소스 · 휴지통의 행은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ⑤')
    for (const type of ['list', 'gallery'] as const) {
      const v = unwrap(await createView(fx.owner.ctx, w.created.id, { type }))
      unwrap(await moveViewRow(fx.owner.ctx, v.id, { rowId: w.ra, beforeRowId: w.ga }))
      assert.equal(await w.order(v.id), '라가나다', type)
    }
    unwrap(await addProperty(fx.owner.ctx, w.ds, { name: '날짜', type: 'date' }))
    const calendar = unwrap(await createView(fx.owner.ctx, w.created.id, { type: 'calendar' }))
    assert.deepEqual(await moveViewRow(fx.owner.ctx, calendar.id, { rowId: w.ra, beforeRowId: null }), { ok: false, reason: 'invalid_value' })
    assert.deepEqual(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ra, beforeRowId: w.ra }), { ok: false, reason: 'invalid_value' })
    const elsewhere = await world('차례 ⑤ 남의 소스')
    assert.deepEqual(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: elsewhere.ga, beforeRowId: null }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ga, beforeRowId: elsewhere.ga }), { ok: false, reason: 'not_found' })
    unwrap(await trashRow(fx.owner.ctx, w.na))
    assert.deepEqual(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ga, beforeRowId: w.na }), { ok: false, reason: 'not_found' })
    assert.equal(await w.order(), '가다라', '아무것도 바뀌지 않았다')
  })

  test('⑥ 권한 — 볼 수만 있으면 forbidden · 못 보면 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ⑥')
    const db = asBlockId(w.created.id)
    assert.ok((await stopInheriting(fx.owner.ctx, db)).ok)
    assert.ok((await grantAccess(fx.owner.ctx, db, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(fx.owner.ctx, db, { type: 'workspace_everyone', id: null })).ok)
    assert.deepEqual(await moveViewRow(mate.ctx, w.viewId, { rowId: w.da, beforeRowId: w.ga }), { ok: false, reason: 'not_found' })
    assert.ok((await grantAccess(fx.owner.ctx, db, { type: 'user', id: mate.userId }, 'view')).ok)
    assert.deepEqual(await moveViewRow(mate.ctx, w.viewId, { rowId: w.da, beforeRowId: w.ga }), { ok: false, reason: 'forbidden' })
    assert.equal(await w.order(), '가나다라')
  })

  test('★ ⑦ 같은 뷰의 옮기기는 줄을 선다 — 다른 쪽이 뷰를 잡고 있으면 기다린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ⑦ 잠금')
    // 다른 옮기기가 도는 중인 것처럼 뷰의 행을 잡아 둔다 — 한 프로세스의 동시 호출로는 경합이 늘 나지 않는다(반사실이 살아남았다)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let taken!: () => void
    const lockTaken = new Promise<void>((resolve) => (taken = resolve))
    const holder = withTransaction(async (tx) => {
      await tx.query(`SELECT 1 FROM view WHERE id = $1 FOR NO KEY UPDATE`, [w.viewId])
      taken()
      await held
    })
    await lockTaken
    let done = false
    const move = moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ga, beforeRowId: null }).then((r) => ((done = true), r))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const waited = !done
    // 실패해도 잡은 것은 푼다 — 안 풀면 판이 끝나지 않는다(반사실에서 멈췄다)
    release()
    await holder
    assert.equal(waited, true, '잡혀 있는 동안 기다린다')
    unwrap(await move)
    assert.equal(await w.order(), '나다라가')
  })

  test('★ ⑦ 같은 뷰에서 동시에 옮겨도 자리를 겹쳐 주지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ⑦')
    // 둘 다 맨 뒤로 — 둘 다 자리 없는 행 전부에 자리를 주려 한다
    const results = await Promise.all([
      moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.ga, beforeRowId: null }),
      moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.na, beforeRowId: null }),
    ])
    assert.deepEqual(results.map((r) => r.ok), [true, true])
    const order = await w.order()
    assert.ok(order === '다라가나' || order === '다라나가', order)
  })

  test('⑧ 공개 화면의 표도 같은 차례', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('차례 ⑧')
    unwrap(await moveViewRow(fx.owner.ctx, w.viewId, { rowId: w.da, beforeRowId: w.ga }))
    const target = { workspaceId: fx.workspaceId, rootId: w.created.id, pageId: w.created.id, chain: [w.created.id] } as unknown as PublicTarget
    const table = await withReadTransaction((tx) => readPublicTableIn(tx, target))
    assert.equal(table?.rows.map((r) => w.names.get(r.id) ?? '?').join(''), '다가나라')
  })
})
