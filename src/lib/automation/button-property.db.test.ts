/**
 * 버튼 속성 · 자동화 엔진 (자동화 5a-1 · F-03-15 · F-08-07, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] 자동화 엔진 · 버튼 속성).
 *
 *   ① 더하기 — automation 이 함께(액션 0개) · 셀이 없다 · 설정을 받지 않는다 · 타입 바꾸기로 들어오거나 나가지 못한다
 *   ② 고치기 — 그 표의 `edit_structure` 만 · 그 표에 맞지 않는 액션은 까닭 · 몇 번째와 함께 거절한다
 *   ③ 누르기 — 그 행의 셀이 바뀐다(`filled_by = 'automation'`) · 실행 기록 하나 · 활동의 행위자는 누른 사람
 *   ④ 권한 · 잠금 — 볼 수만 있으면 403 · 못 보면 404 · 잠긴 행이면 그 액션만 건너뛰고 partial
 *   ⑤ 실패 — 액션 하나가 실패하면 앞의 액션까지 되돌리고 실패 기록만 남는다
 *   ⑥ 연타 — 같은 키는 한 번 · 다른 버튼의 키 · 모양이 틀린 키는 거절
 *   ⑦ 지운 버튼 · 꺼진 버튼 — 지우면 404 · 되살리면 다시 · 꺼지면 409
 *   ⑧ 실행 기록은 automation 마다 최근 N건
 *
 * 반사실(HANDOFF §3.3): 권한 문을 낮추면 ② ④, 건너뛰기를 실패로 바꾸면 ④, 세이브포인트 대신 계속하면 ⑤, 멱등 키를 빼면 ⑥ 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty, deleteProperty, restoreProperty } from '../database/property.ts'
import { convertProperty } from '../database/property-convert.ts'
import { createRow, updateCells } from '../database/row.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { runDataRetention } from '../notification/retention.ts'
import { pressButton, readButtonActions, setButtonActions } from './button-property.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let editor: Actor // 고친다(edit) — 데이터베이스에 `edit_content` 만 주는 부여는 아직 무시된다(effective.ts · §7)
let viewer: Actor // 보기만
let outsider: Actor // 그 표를 못 본다

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  editor = await joinAs(fx.workspaceId, await createUser('고치는 사람'), 'member')
  viewer = await joinAs(fx.workspaceId, await createUser('보기만 하는 사람'), 'member')
  outsider = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
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

/** 표 하나 — 수량(숫자) · 완료(체크) · 끝내기(버튼) · 행 하나. 소유자는 전체 권한 · 고치는 사람 · 보기만 하는 사람. */
async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const done = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '완료', type: 'checkbox' })).properties, '완료')
  const button = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '끝내기', type: 'button' })).properties, '끝내기')
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  assert.equal((await stopInheriting(fx.owner.ctx, db.id)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone' })
  assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: editor.userId }, 'edit')).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: viewer.userId }, 'view')).ok, true)
  return { databaseId: db.id, ds, qty, done, button, row }
}

const finish = (t: Table) => [
  { type: 'edit_property', config: { v: 1, cells: [{ propertyId: t.qty, value: { type: 'number', number: 7 } }] } },
  { type: 'edit_property', config: { v: 1, cells: [{ propertyId: t.done, value: { type: 'checkbox', checkbox: true } }] } },
]
const cellOf = async (row: string, property: string) =>
  (await query<{ value: Record<string, unknown>; filled_by: string | null }>(
    `SELECT value, filled_by FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
    [row, property],
  ))[0] ?? null
const runsOf = (automationId: string) =>
  query<{ status: string }>(`SELECT status FROM automation_run WHERE automation_id = $1`, [automationId])

describe('① 더하기', () => {
  test('★ 버튼을 더하면 automation 이 함께(액션 0개) — 셀 · 설정 · 타입 바꾸기는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('버튼 표')
    const read = unwrap(await readButtonActions(fx.owner.ctx, tb.ds, tb.button))
    assert.deepEqual([read.enabled, read.actions], [true, []])
    assert.deepEqual(
      await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.button, value: { type: 'checkbox', checkbox: true } }] }),
      { ok: false, reason: 'unknown_property' },
      '버튼에는 셀이 없다',
    )
    const withConfig = await addProperty(fx.owner.ctx, tb.ds, { name: '다른 버튼', type: 'button', config: {} })
    assert.deepEqual(withConfig.ok ? null : withConfig.reason, 'invalid_config')
    for (const [from, to] of [[tb.button, 'number'], [tb.qty, 'button']] as const) {
      const converted = await convertProperty(fx.owner.ctx, tb.ds, from, { type: to })
      assert.deepEqual(converted.ok ? null : converted.reason, 'unsupported_type')
    }
  })
})

describe('② 고치기', () => {
  test('★ 그 표의 edit_structure 만 — 보기만 하면 403 · 못 보면 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('고치기 표')
    assert.deepEqual(await setButtonActions(viewer.ctx, tb.ds, tb.button, finish(tb)), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setButtonActions(outsider.ctx, tb.ds, tb.button, finish(tb)), { ok: false, reason: 'not_found' })
    const saved = unwrap(await setButtonActions(editor.ctx, tb.ds, tb.button, finish(tb)))
    assert.equal(saved.actions.length, 2)
    assert.deepEqual(unwrap(await readButtonActions(viewer.ctx, tb.ds, tb.button)).actions, saved.actions, '볼 수 있으면 읽는다')
  })

  test('★ 그 표에 맞지 않는 액션은 까닭 · 몇 번째와 함께 거절한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('틀린 액션 표')
    const other = await table('다른 표')
    const edit = (cells: unknown[]) => ({ type: 'edit_property', config: { v: 1, cells } })
    const ok = edit([{ propertyId: tb.qty, value: { type: 'number', number: 1 } }])
    const cases: [unknown, string, number | undefined][] = [
      [[ok, edit([{ propertyId: other.qty, value: { type: 'number', number: 1 } }])], 'unknown_property', 1],
      [[edit([{ propertyId: tb.button, value: { type: 'checkbox', checkbox: true } }])], 'unknown_property', 0],
      [[edit([{ propertyId: tb.qty, value: { type: 'checkbox', checkbox: true } }])], 'invalid_value', 0],
      [[{ type: 'insert_blocks', config: { v: 1 } }], 'unsupported_action', 0],
      [[edit([])], 'empty_cells', 0],
      ['액션 아님', 'invalid', undefined],
    ]
    for (const [actions, problem, index] of cases) {
      const r = await setButtonActions(fx.owner.ctx, tb.ds, tb.button, actions)
      assert.deepEqual(r, { ok: false, reason: 'invalid_action', problem, ...(index === undefined ? {} : { index }) }, problem)
    }
    await query(`UPDATE property SET writable = 'readonly' WHERE id = $1`, [tb.done])
    const readonly = await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([{ propertyId: tb.done, value: { type: 'checkbox', checkbox: true } }])])
    assert.deepEqual(readonly.ok ? null : readonly.problem, 'readonly_property')
    assert.deepEqual(unwrap(await readButtonActions(fx.owner.ctx, tb.ds, tb.button)).actions, [], '하나도 저장되지 않았다')
  })
})

describe('③ 누르기', () => {
  test('★ 그 행의 셀이 바뀐다(자동화가 채움) · 실행 기록 하나 · 활동의 행위자는 누른 사람', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('누르기 표')
    const saved = unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, finish(tb)))
    const run = unwrap(await pressButton(editor.ctx, tb.row, tb.button, randomUUID()))
    assert.deepEqual([run.status, run.duplicate, run.steps.map((s) => s.status)], ['success', false, ['done', 'done']])
    assert.deepEqual(await cellOf(tb.row, tb.qty), { value: { type: 'number', number: 7 }, filled_by: 'automation' })
    assert.deepEqual((await cellOf(tb.row, tb.done))?.value, { type: 'checkbox', checkbox: true })
    assert.deepEqual((await runsOf(saved.automationId)).map((r) => r.status), ['success'])
    const [stored] = await query<{ actor_id: string; origin: string; trigger_page_id: string }>(
      `SELECT actor_id, origin, trigger_page_id FROM automation_run WHERE id = $1`,
      [run.runId],
    )
    assert.deepEqual(stored, { actor_id: editor.userId, origin: 'user', trigger_page_id: tb.row })
    const [activity] = await query<{ actor_id: string }>(
      `SELECT actor_id FROM activity_event WHERE page_id = $1 AND type = 'property.updated' ORDER BY created_at DESC LIMIT 1`,
      [tb.row],
    )
    assert.equal(activity?.actor_id, editor.userId)
  })
})

describe('④ 권한 · 잠금', () => {
  test('★ 볼 수만 있으면 403 · 못 보면 404 · 잠긴 행이면 그 액션만 건너뛰고 partial', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('잠금 표')
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, finish(tb)))
    assert.deepEqual(await pressButton(viewer.ctx, tb.row, tb.button, randomUUID()), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await pressButton(outsider.ctx, tb.row, tb.button, randomUUID()), { ok: false, reason: 'not_found' })

    unwrap(await setPageLock(fx.owner.ctx, tb.row, true))
    const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
    assert.deepEqual([run.status, run.steps.map((s) => [s.status, s.reason ?? null])], ['partial', [['skipped', 'locked'], ['skipped', 'locked']]])
    assert.equal(await cellOf(tb.row, tb.qty), null, '잠긴 행은 그대로')
  })
})

describe('⑤ 실패', () => {
  test('★ 액션 하나가 실패하면 앞의 액션까지 되돌리고 실패 기록만 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('실패 표')
    const saved = unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, finish(tb)))
    unwrap(await deleteProperty(fx.owner.ctx, tb.ds, tb.done)) // 두 번째 액션의 속성이 사라졌다
    const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
    assert.deepEqual([run.status, run.steps.map((s) => [s.status, s.reason ?? null])], ['failed', [['done', null], ['failed', 'unknown_property']]])
    assert.equal(await cellOf(tb.row, tb.qty), null, '앞의 액션도 되돌렸다')
    assert.deepEqual((await runsOf(saved.automationId)).map((r) => r.status), ['failed'])
  })
})

describe('⑥ 연타', () => {
  test('★ 같은 키는 한 번 — 처음 결과를 돌려준다 · 다른 버튼의 키 · 틀린 키는 거절', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('연타 표')
    const saved = unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, finish(tb)))
    const key = randomUUID()
    const first = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, key))
    const again = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, key))
    assert.deepEqual([again.runId, again.duplicate, again.status], [first.runId, true, 'success'])
    assert.equal((await runsOf(saved.automationId)).length, 1)

    const other = await table('다른 연타 표')
    unwrap(await setButtonActions(fx.owner.ctx, other.ds, other.button, finish(other)))
    assert.deepEqual(await pressButton(fx.owner.ctx, other.row, other.button, key), { ok: false, reason: 'invalid_key' })
    assert.deepEqual(await pressButton(fx.owner.ctx, tb.row, tb.button, '키 아님'), { ok: false, reason: 'invalid_key' })
  })
})

describe('⑦ 지운 버튼 · 꺼진 버튼', () => {
  test('★ 지우면 404 · 되살리면 액션과 함께 다시 · 꺼지면 409', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('지우기 표')
    const saved = unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, finish(tb)))
    unwrap(await deleteProperty(fx.owner.ctx, tb.ds, tb.button))
    assert.deepEqual(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()), { ok: false, reason: 'not_found' })
    unwrap(await restoreProperty(fx.owner.ctx, tb.ds, tb.button))
    assert.equal(unwrap(await readButtonActions(fx.owner.ctx, tb.ds, tb.button)).actions.length, 2, '액션이 함께 돌아온다')
    await query(`UPDATE automation SET enabled = false WHERE id = $1`, [saved.automationId])
    assert.deepEqual(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()), { ok: false, reason: 'disabled' })
  })
})

describe('⑧ 실행 기록의 수', () => {
  test('★ automation 마다 최근 N건만 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('기록 표')
    const saved = unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, finish(tb)))
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID())).runId)
    await runDataRetention(new Date(), { workspaces: [fx.workspaceId], partitions: false, runCap: 3 })
    const left = await query<{ id: string }>(`SELECT id FROM automation_run WHERE automation_id = $1`, [saved.automationId])
    assert.deepEqual(left.map((r) => r.id).sort(), ids.slice(2).sort(), '가장 최근 셋')
  })
})
