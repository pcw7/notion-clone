/**
 * 자동화 액션 `add_page_to` — 그 표에 행을 하나 (자동화 5a-2 · F-08-07, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] 자동화 엔진 ⑨).
 *
 *   ① 다른 표에 행을 더한다 — 셀 · `filled_by = 'automation'` · 단계에 만든 행의 id · 활동의 행위자는 누른 사람
 *   ② 대상 표에 행을 만들 권한이 없으면 그 액션만 건너뛴다(partial) — 앞의 액션은 남는다
 *   ③ 템플릿을 고르면 템플릿 값이 버튼 값을 덮는다 — 템플릿이 정하지 않은 칸은 버튼 값 · 보드의 길(준 값이 이긴다)은 그대로
 *   ④ 저장할 때 — 못 보는 표 · 대상 표에 없는 속성 · 그 표의 것이 아닌 템플릿은 거절
 *   ⑤ 실행 때 템플릿이 사라졌으면 실패 — 앞의 액션까지 되돌린다
 *
 * 반사실(HANDOFF §3.3): 우선순위를 뒤집으면 ③, 대상 표 대신 이 표의 스키마로 보면 ④, 권한 거절을 실패로 바꾸면 ② 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { createRowFromTemplate, createTemplate, deleteTemplate } from '../database/template.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { pressButton, setButtonActions } from './button-property.ts'

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
  mate = await joinAs(fx.workspaceId, await createUser('함께 누르는 사람'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${JSON.stringify(r)}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

type Table = { databaseId: string; ds: string; qty: string; done: string; button: string; row: string }

/** 표 하나 — 수량(숫자) · 완료(체크) · 버튼 · 행 하나. 워크스페이스 모두가 고친다. */
async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const done = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '완료', type: 'checkbox' })).properties, '완료')
  const button = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '더하기', type: 'button' })).properties, '더하기')
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  return { databaseId: db.id, ds, qty, done, button, row }
}
const addTo = (target: Table, cells: unknown[], templateId: string | null = null) => ({
  type: 'add_page_to',
  config: { v: 1, dataSourceId: target.ds, cells, templateId },
})
const num = (propertyId: string, n: number) => ({ propertyId, value: { type: 'number', number: n } })
const check = (propertyId: string) => ({ propertyId, value: { type: 'checkbox', checkbox: true } })
const cellsOf = async (row: string) =>
  new Map(
    (await query<{ property_id: string; value: Record<string, unknown>; filled_by: string | null }>(
      `SELECT property_id, value, filled_by FROM page_property_value WHERE page_id = $1`,
      [row],
    )).map((r) => [r.property_id, r]),
  )
const rowsOf = async (ds: string) =>
  (await query<{ id: string }>(`SELECT id FROM page WHERE data_source_id = $1 AND is_template = false ORDER BY id`, [ds])).map((r) => r.id)
/** 소유자만 볼 수 있게 — 상속을 끊고 워크스페이스 전체를 거둔다. */
async function restrict(t: Table): Promise<void> {
  assert.equal((await stopInheriting(fx.owner.ctx, t.databaseId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, t.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  await revokeAccess(fx.owner.ctx, t.databaseId, { type: 'workspace_everyone' })
}

describe('① 다른 표에 행을 더한다', () => {
  test('★ 셀 · 자동화가 채움 · 단계에 만든 행의 id · 활동의 행위자는 누른 사람', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const here = await table('버튼이 있는 표')
    const there = await table('행이 생길 표')
    unwrap(await setButtonActions(fx.owner.ctx, here.ds, here.button, [addTo(there, [num(there.qty, 3), check(there.done)])]))
    const before = await rowsOf(there.ds)
    const run = unwrap(await pressButton(mate.ctx, here.row, here.button, randomUUID()))
    const made = (await rowsOf(there.ds)).filter((id) => !before.includes(id))
    assert.equal(made.length, 1)
    assert.deepEqual([run.status, run.steps], ['success', [{ index: 0, type: 'add_page_to', status: 'done', pageId: made[0] }]])
    const cells = await cellsOf(made[0])
    assert.deepEqual([cells.get(there.qty)?.value, cells.get(there.qty)?.filled_by], [{ type: 'number', number: 3 }, 'automation'])
    assert.deepEqual(cells.get(there.done)?.value, { type: 'checkbox', checkbox: true })
    const [activity] = await query<{ actor_id: string }>(`SELECT actor_id FROM activity_event WHERE page_id = $1 AND type = 'page.created'`, [made[0]])
    assert.equal(activity?.actor_id, mate.userId)

    // 셀 없이 — 빈 행
    unwrap(await setButtonActions(fx.owner.ctx, here.ds, here.button, [addTo(there, [])]))
    const blank = unwrap(await pressButton(mate.ctx, here.row, here.button, randomUUID()))
    assert.equal(blank.status, 'success')
  })
})

describe('② 권한', () => {
  test('★ 대상 표에 행을 만들 수 없으면 그 액션만 건너뛴다 — 앞의 액션은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const here = await table('누르는 표')
    const secret = await table('못 보는 표')
    const edit = { type: 'edit_property', config: { v: 1, cells: [num(here.qty, 9)] } }
    unwrap(await setButtonActions(fx.owner.ctx, here.ds, here.button, [edit, addTo(secret, [num(secret.qty, 1)])]))
    await restrict(secret)
    const before = await rowsOf(secret.ds)
    const run = unwrap(await pressButton(mate.ctx, here.row, here.button, randomUUID()))
    assert.deepEqual([run.status, run.steps.map((s) => [s.status, s.reason ?? null])], ['partial', [['done', null], ['skipped', 'not_found']]])
    assert.deepEqual(await rowsOf(secret.ds), before, '못 보는 표에는 행이 생기지 않았다')
    assert.deepEqual((await cellsOf(here.row)).get(here.qty)?.value, { type: 'number', number: 9 }, '앞의 액션은 남는다')
  })
})

describe('③ 템플릿', () => {
  test('★ 템플릿 값이 버튼 값을 덮는다 — 템플릿이 정하지 않은 칸은 버튼 값', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const here = await table('템플릿 버튼 표')
    const there = await table('템플릿이 있는 표')
    const template = unwrap(await createTemplate(fx.owner.ctx, there.ds, { title: '틀' })).id
    unwrap(await updateCells(fx.owner.ctx, template, { cells: [num(there.qty, 5)] }))
    unwrap(await setButtonActions(fx.owner.ctx, here.ds, here.button, [addTo(there, [num(there.qty, 1), check(there.done)], template)]))
    const run = unwrap(await pressButton(fx.owner.ctx, here.row, here.button, randomUUID()))
    const made = run.steps[0].pageId
    assert.ok(made !== undefined, JSON.stringify(run))
    const cells = await cellsOf(made)
    assert.deepEqual(cells.get(there.qty)?.value, { type: 'number', number: 5 }, '템플릿 값이 이긴다')
    assert.deepEqual(cells.get(there.done)?.value, { type: 'checkbox', checkbox: true }, '템플릿이 정하지 않은 칸은 버튼 값')

    // 보드의 길(준 값이 템플릿을 덮는다)은 그대로다
    const board = unwrap(await createRowFromTemplate(fx.owner.ctx, there.ds, template, { cells: [num(there.qty, 1)] }))
    assert.deepEqual((await cellsOf(board.row.id)).get(there.qty)?.value, { type: 'number', number: 1 })
  })
})

describe('④ 저장할 때', () => {
  test('★ 못 보는 표 · 대상 표에 없는 속성 · 그 표의 것이 아닌 템플릿은 거절', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const here = await table('저장 표')
    const there = await table('대상 표')
    const elsewhere = await table('다른 템플릿의 표')
    const foreignTemplate = unwrap(await createTemplate(fx.owner.ctx, elsewhere.ds, { title: '남의 틀' })).id
    const cases: [unknown, string][] = [
      [addTo(there, [num(here.qty, 1)]), 'unknown_property'],
      [addTo(there, [], foreignTemplate), 'unknown_template'],
      [addTo(there, [], randomUUID()), 'unknown_template'],
    ]
    for (const [action, problem] of cases) {
      assert.deepEqual(await setButtonActions(fx.owner.ctx, here.ds, here.button, [action]), { ok: false, reason: 'invalid_action', problem, index: 0 }, problem)
    }
    const secret = await table('저장하는 사람이 못 보는 표')
    await restrict(secret)
    const mateHere = await table('같이 고치는 표')
    assert.deepEqual(await setButtonActions(mate.ctx, mateHere.ds, mateHere.button, [addTo(secret, [])]), {
      ok: false,
      reason: 'invalid_action',
      problem: 'unknown_data_source',
      index: 0,
    })
    assert.equal((await setButtonActions(fx.owner.ctx, here.ds, here.button, [addTo(there, [num(there.qty, 1)])])).ok, true, '대상 표의 속성이면 된다')
  })
})

describe('⑤ 실행 때 템플릿이 사라졌으면', () => {
  test('★ 실패 — 앞의 액션까지 되돌린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const here = await table('사라진 템플릿 표')
    const there = await table('템플릿을 버린 표')
    const template = unwrap(await createTemplate(fx.owner.ctx, there.ds, { title: '버릴 틀' })).id
    const edit = { type: 'edit_property', config: { v: 1, cells: [num(here.qty, 4)] } }
    unwrap(await setButtonActions(fx.owner.ctx, here.ds, here.button, [edit, addTo(there, [], template)]))
    unwrap(await deleteTemplate(fx.owner.ctx, template))
    const before = await rowsOf(there.ds)
    const run = unwrap(await pressButton(fx.owner.ctx, here.row, here.button, randomUUID()))
    assert.deepEqual([run.status, run.steps.map((s) => [s.status, s.reason ?? null])], ['failed', [['done', null], ['failed', 'unknown_template']]])
    assert.equal((await cellsOf(here.row)).get(here.qty), undefined, '앞의 액션도 되돌렸다')
    assert.deepEqual(await rowsOf(there.ds), before)
  })
})
