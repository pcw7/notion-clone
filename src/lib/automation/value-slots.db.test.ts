/**
 * 값 슬롯 — 고정 값 · 동적 값 (자동화 5d-1 · F-08-11, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑯).
 *
 *   ① 저장 검사 — "지금"은 날짜 속성에만 · 일하는 행의 속성은 같은 타입(선택지 · 상태 제외) · 원본은 그 automation 의 표(다른 표에 행 추가여도)
 *   ② 실행 — 지금은 실행한 시각 · 일하는 행의 속성은 그때의 값 · 비었으면 빈 값 · 다른 표에 행 추가도
 *   ③ 깨진 정의 — 원본 속성이 사라졌으면 실패하고 아무것도 바뀌지 않는다
 *   ④ 권한 — 일하는 행을 볼 수 없는 사람이 누르면 그 값을 읽지 않는다(건너뛴다)
 *
 * 반사실(HANDOFF §3.3): 타입을 보지 않으면 ①, 원본을 그 automation 의 표에서 찾지 않으면 ①, 동적 값을 풀지 않으면 ②, 원본이 사라진 것을
 * 빈 값으로 덮으면 ③, 행을 볼 수 있는지 묻지 않으면 ④ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { pressButton, setButtonActions } from './button-property.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
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

type Table = { ds: string; p: Record<string, string>; button: string; row: string }

/** 표 하나 — 수량 · 사본(숫자) · 마감(날짜) · 메모(글) · 단계(선택) · 버튼 · 행 하나. */
async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const p: Record<string, string> = {}
  for (const [n, type] of [['수량', 'number'], ['사본', 'number'], ['마감', 'date'], ['메모', 'rich_text'], ['단계', 'select']] as const) {
    p[n] = unwrap(await addProperty(fx.owner.ctx, ds, { name: n, type })).properties.find((x) => x.name === n)!.id
  }
  const button = unwrap(await addProperty(fx.owner.ctx, ds, { name: '버튼', type: 'button' })).properties.find((x) => x.name === '버튼')!.id
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  return { ds, p, button, row }
}

const edit = (cells: unknown[]) => ({ type: 'edit_property', config: { v: 1, cells } })
const now = (propertyId: string) => ({ propertyId, from: { kind: 'now' } })
const copy = (propertyId: string, from: string) => ({ propertyId, from: { kind: 'row_property', propertyId: from } })
const cellOf = async (row: string, property: string) =>
  (await query<{ value: Record<string, unknown> }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [row, property]))[0]?.value ?? null

describe('① 저장 검사', () => {
  test('★ 지금은 날짜에만 · 같은 타입끼리 · 선택지는 못 옮긴다 · 원본은 그 automation 의 표', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('검사 표')
    const other = await table('다른 표')
    const bad = (problem: string) => ({ ok: false, reason: 'invalid_action', problem, index: 0 })
    assert.deepEqual(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([now(tb.p.수량)])]), bad('invalid_dynamic'), '숫자에 지금')
    assert.deepEqual(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([copy(tb.p.메모, tb.p.수량)])]), bad('invalid_dynamic'), '숫자를 글에')
    assert.deepEqual(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([copy(tb.p.단계, tb.p.단계)])]), bad('invalid_dynamic'), '선택지')
    assert.deepEqual(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([copy(tb.p.사본, 'nope')])]), bad('invalid_dynamic'), '없는 원본')
    assert.ok((await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([now(tb.p.마감), copy(tb.p.사본, tb.p.수량)])])).ok)
    // 다른 표에 행 추가 — 받는 속성은 그 표의 것, 원본은 이 표의 것
    const addTo = (cells: unknown[]) => [{ type: 'add_page_to', config: { v: 1, dataSourceId: other.ds, cells } }]
    assert.ok((await setButtonActions(fx.owner.ctx, tb.ds, tb.button, addTo([copy(other.p.수량, tb.p.수량)]))).ok)
    assert.deepEqual(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, addTo([copy(other.p.수량, other.p.사본)])), bad('invalid_dynamic'), '원본이 받는 표의 것')
  })
})

describe('② 실행', () => {
  test('★ 지금은 실행한 시각 · 일하는 행의 속성은 그때의 값 · 비었으면 빈 값 · 다른 표에 행 추가도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('실행 표')
    const other = await table('행이 설 표')
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.p.수량, value: { type: 'number', number: 7 } }] }))
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [
      edit([now(tb.p.마감), copy(tb.p.사본, tb.p.수량)]),
      { type: 'add_page_to', config: { v: 1, dataSourceId: other.ds, cells: [copy(other.p.수량, tb.p.수량), copy(other.p.사본, tb.p.사본)] } },
    ]))
    const before = Date.now()
    const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
    const after = Date.now()
    assert.equal(run.status, 'success', JSON.stringify(run))
    const due = (await cellOf(tb.row, tb.p.마감)) as { date: { start: string } } | null
    const at = Date.parse(due?.date.start ?? '')
    assert.ok(at >= before - 1000 && at <= after + 1000, `지금 — ${due?.date.start}`)
    assert.deepEqual(await cellOf(tb.row, tb.p.사본), { type: 'number', number: 7 })
    const made = run.steps[1].pageId!
    assert.deepEqual(await cellOf(made, other.p.수량), { type: 'number', number: 7 }, '다른 표의 새 행에도')
    // 사본은 같은 트랜잭션의 앞 액션이 막 쓴 값(7)을 읽는다 — 그때의 값
    assert.deepEqual(await cellOf(made, other.p.사본), { type: 'number', number: 7 })

    // 비었으면 빈 값 — 수량을 비우고 다시 누르면 사본이 빈다
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.p.수량, value: { type: 'number', number: null } }] }))
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([copy(tb.p.사본, tb.p.수량)])]))
    assert.equal(unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID())).status, 'success')
    const emptied = await cellOf(tb.row, tb.p.사본)
    assert.ok(emptied === null || (emptied as { number: unknown }).number === null, JSON.stringify(emptied))
  })
})

describe('③ 깨진 정의', () => {
  test('★ 원본 속성이 사라졌으면 실패 — 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('깨진 표')
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [edit([now(tb.p.마감)]), edit([copy(tb.p.사본, tb.p.수량)])]))
    await query(`UPDATE property SET deleted_at = now() WHERE id = $1`, [tb.p.수량])
    const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
    assert.equal(run.status, 'failed')
    assert.deepEqual(run.steps.at(-1), { index: 1, type: 'edit_property', status: 'failed', reason: 'unknown_property' })
    assert.equal(await cellOf(tb.row, tb.p.마감), null, '앞 액션도 되돌렸다')
  })
})

describe('④ 권한', () => {
  test('★ 일하는 행을 볼 수 없는 사람이 누르면 그 값을 읽지 않는다 — 건너뛴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mate = await joinAs(fx.workspaceId, await createUser('행을 못 보는 동료'), 'member')
    const tb = await table('가린 행 표')
    const other = await table('누구나 쓰는 표')
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.p.수량, value: { type: 'number', number: 42 } }] }))
    unwrap(await setButtonActions(fx.owner.ctx, tb.ds, tb.button, [
      { type: 'add_page_to', config: { v: 1, dataSourceId: other.ds, cells: [copy(other.p.수량, tb.p.수량)] } },
    ]))
    assert.equal((await stopInheriting(fx.owner.ctx, tb.row)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, tb.row, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    await revokeAccess(fx.owner.ctx, tb.row, { type: 'workspace_everyone' })
    const run = unwrap(await pressButton(mate.ctx, tb.row, tb.button, randomUUID()))
    assert.deepEqual(run.steps, [{ index: 0, type: 'add_page_to', status: 'skipped', reason: 'not_found' }])
    const leaked = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM page_property_value v JOIN page p ON p.id = v.page_id WHERE p.data_source_id = $1 AND v.property_id = $2`,
      [other.ds, other.p.수량],
    )
    assert.equal(leaked[0].n, 0, '가린 행의 값이 다른 표로 새지 않았다')
  })
})
