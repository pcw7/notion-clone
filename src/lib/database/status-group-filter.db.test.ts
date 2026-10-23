/**
 * status 의 그룹 단위 필터 — §7 정리 10n-23 (F-03-05 · F-03-17)
 *
 * 정본: 00-canonical-data-model.md §3.5 status 절 [보강 10n-23] · 마이그레이션 0110
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹이 같음 — 셀의 옵션이 그 그룹에 드는 행
 *   ② ★ 그룹이 같지 않음 — 빈 셀도 든다(NOT EXISTS)
 *   ③ ★ 옵션을 옮기거나 그 그룹에 새 옵션을 만들면 필터가 따라온다 — 펴서 저장하지 않는다
 *   ④ 읽기 경로 — 모르는 값은 0행(예외가 아니다)
 *   ⑤ 쓰기 경로 — 뷰의 필터 · DB automation 의 조건이 그룹을 받고, 옵션 id · 모르는 말은 거부한다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema, updateSelectOption } from './property.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import { updateView } from './view.ts'
import { createDbAutomation } from '../automation/db-automation.ts'
import type { FilterNode } from './filter.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)

/** 표 하나 — 진행(status) · 행 다섯: 시작 전 · 진행 중 · 검토(진행 중 그룹) · 완료 · 빈 칸. */
async function table() {
  const ws = await createBareWorkspace('그룹 필터')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `그룹 필터 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  const progress = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === '진행')!
  const review = unwrap(await addSelectOption(boss.ctx, ds, progress.id, { name: '검토', group: 'in_progress' })).option.id
  const opt = (name: string) => progress.options!.find((o) => o.name === name)!.id
  const mk = async (optionId: string | null) =>
    unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: progress.id, value: { type: 'status', status: optionId === null ? null : { id: optionId } } }] })).id
  const rows = {
    waiting: await mk(opt('시작 전')),
    doing: await mk(opt('진행 중')),
    review: await mk(review),
    done: await mk(opt('완료')),
    empty: await mk(null),
  }
  const name = new Map(Object.entries(rows).map(([k, id]) => [id, k]))
  /** 그 필터로 읽은 행의 이름 — 차례 없이(정렬해서). */
  const pick = async (filter: FilterNode) =>
    unwrap(await queryRows(boss.ctx, ds, { filter })).rows.map((r) => name.get(r.id) ?? r.id).sort()
  const group = (operator: string, value: unknown): FilterNode => ({ property_id: progress.id, operator, value }) as FilterNode
  return { boss, db, ds, progress: progress.id, review, rows, name, pick, group }
}

describe('status 의 그룹 단위 필터 (10n-23)', () => {
  test('★ ① 그룹이 같음 — 셀의 옵션이 그 그룹에 드는 행', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    assert.deepEqual(await tb.pick(tb.group('group_is', 'in_progress')), ['doing', 'review'])
    assert.deepEqual(await tb.pick(tb.group('group_is', 'complete')), ['done'])
    assert.deepEqual(await tb.pick(tb.group('group_is', 'todo')), ['waiting'])
  })

  test('★ ② 그룹이 같지 않음 — 빈 칸도 든다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    assert.deepEqual(await tb.pick(tb.group('group_is_not', 'complete')), ['doing', 'empty', 'review', 'waiting'])
  })

  test('★ ③ 옵션을 옮기거나 그 그룹에 새 옵션을 만들면 필터가 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    unwrap(await updateSelectOption(tb.boss.ctx, tb.ds, tb.progress, tb.review, { group: 'complete' }))
    assert.deepEqual(await tb.pick(tb.group('group_is', 'complete')), ['done', 'review'], '옮긴 옵션의 행이 따라온다')
    assert.deepEqual(await tb.pick(tb.group('group_is', 'in_progress')), ['doing'])

    const held = unwrap(await addSelectOption(tb.boss.ctx, tb.ds, tb.progress, { name: '보류', group: 'complete' })).option.id
    const late = unwrap(await createRow(tb.boss.ctx, tb.ds, { cells: [{ propertyId: tb.progress, value: { type: 'status', status: { id: held } } }] })).id
    tb.name.set(late, 'late')
    assert.deepEqual(await tb.pick(tb.group('group_is', 'complete')), ['done', 'late', 'review'], '새 옵션의 행도')
  })

  test('④ 읽기 경로 — 모르는 값은 0행이다(예외가 아니다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    assert.deepEqual(await tb.pick(tb.group('group_is', 'done')), [])
    assert.deepEqual(await tb.pick(tb.group('group_is_not', 'done')).then((r) => r.length), 5, '같지 않음은 전부')
  })

  test('★ ⑤ 쓰기 경로 — 뷰의 필터 · 자동화의 조건이 그룹을 받고, 옵션 id · 모르는 말은 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const view = tb.db.defaultViewId
    const saved = unwrap(await updateView(tb.boss.ctx, view, { filter: tb.group('group_is', 'complete') }))
    assert.deepEqual(saved.filter, tb.group('group_is', 'complete'))
    assert.notEqual(reasonOf(await updateView(tb.boss.ctx, view, { filter: tb.group('group_is', 'done') })), 'ok', '모르는 말')
    assert.notEqual(reasonOf(await updateView(tb.boss.ctx, view, { filter: tb.group('group_is', tb.review) })), 'ok', '옵션 id')

    const automation = (condition: FilterNode) => ({
      name: '완료되면',
      triggers: [{ type: 'property_edited', propertyId: tb.progress, condition }],
      actions: [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: tb.progress, value: { type: 'status', status: null } }] } }],
    })
    assert.equal(reasonOf(await createDbAutomation(tb.boss.ctx, tb.ds, automation(tb.group('group_is', 'complete')))), 'ok', '자동화 — "완료 그룹에 들면"')
    const refused = await createDbAutomation(tb.boss.ctx, tb.ds, automation(tb.group('group_is', 'done')))
    assert.equal(reasonOf(refused), 'invalid_trigger')
    assert.equal((refused as { problem?: string }).problem, 'invalid_condition', '조건이 그 속성의 필터가 아니다')
  })
})
