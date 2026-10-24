/**
 * 열 집계 · 그룹 머리의 완료 비율 — §7 정리 10n-30 (F-04-16 · F-03-05)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 열 집계 ① [보강 10n-30] · 마이그레이션 0112
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 표 아래 — 상태 열의 완료 비율(빈 상태도 분모) · 뷰의 열에 저장할 수 있다(CHECK 이 받는다)
 *   ② ★ 옵션을 완료 그룹으로 옮기면 비율이 따라온다
 *   ③ ★ 보드 머리 — 그룹마다 그 그룹 카드의 완료 비율
 *   ④ 상태가 아닌 열에는 고를 수 없다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema, updateSelectOption } from './property.ts'
import { createRow } from './row.ts'
import { createView, getView, setViewColumn } from './view.ts'
import { computeCalculations } from './calculate.ts'
import { queryGroups } from './group.ts'

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

/** 표 하나 — 진행(status · 검토는 진행 중 그룹) · 단계(select · 가 · 나) · 행 넷: 완료/가 · 진행 중/가 · 검토/나 · 빈 상태/나. */
async function setup() {
  const ws = await createBareWorkspace('완료 비율 집계')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `완료 비율 집계 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const progress = props.find((p) => p.name === '진행')!.id
  const stage = props.find((p) => p.name === '단계')!.id
  const review = unwrap(await addSelectOption(boss.ctx, ds, progress, { name: '검토', group: 'in_progress' })).option.id
  const ga = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '가' })).option.id
  const na = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '나' })).option.id
  const opt = (name: string) => props.find((p) => p.id === progress)!.options!.find((o) => o.name === name)!.id
  const mk = async (status: string | null, sel: string) =>
    unwrap(await createRow(boss.ctx, ds, { cells: [
      { propertyId: progress, value: { type: 'status', status: status === null ? null : { id: status } } },
      { propertyId: stage, value: { type: 'select', select: { id: sel } } },
    ] }))
  await mk(opt('완료'), ga)
  await mk(opt('진행 중'), ga)
  await mk(review, na)
  await mk(null, na)
  const footer = async () =>
    (await computeCalculations(boss.ctx, ds, null, [{ propertyId: progress, type: 'status', calculation: 'percent_complete' }]))[progress]
  return { boss, db, ds, progress, stage, review, ga, na, opt, footer }
}

describe('열 집계 · 그룹 머리의 완료 비율 (10n-30)', () => {
  test('★ ① 표 아래 — 상태 열의 완료 비율 · 뷰의 열에 저장할 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.deepEqual(await s.footer(), { kind: 'percent', value: 25 }, '넷 중 완료 하나 — 빈 상태도 분모')
    unwrap(await setViewColumn(s.boss.ctx, s.db.defaultViewId, s.progress, { calculation: 'percent_complete' }))
    const view = unwrap(await getView(s.boss.ctx, s.db.defaultViewId))
    assert.equal(view.columns.find((c) => c.propertyId === s.progress)?.calculation, 'percent_complete', '저장된다(CHECK 이 받는다)')
  })

  test('★ ② 옵션을 완료 그룹으로 옮기면 비율이 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    unwrap(await updateSelectOption(s.boss.ctx, s.ds, s.progress, s.review, { group: 'complete' }))
    assert.deepEqual(await s.footer(), { kind: 'percent', value: 50 })
  })

  test('★ ③ 보드 머리 — 그룹마다 그 그룹 카드의 완료 비율', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const board = unwrap(await createView(s.boss.ctx, s.db.id, {
      type: 'board',
      groupBy: { property_id: s.stage, calculation: { property_id: s.progress, function: 'percent_complete' } },
    })).id
    const page = unwrap(await queryGroups(s.boss.ctx, board))
    const of = (key: string) => page.groups.find((g) => g.key === key)?.calculation
    assert.deepEqual(of(s.ga), { kind: 'percent', value: 50 }, '가 — 완료 · 진행 중')
    assert.deepEqual(of(s.na), { kind: 'percent', value: 0 }, '나 — 검토 · 빈 상태')
    assert.deepEqual(of(''), { kind: 'percent', value: null }, '빈 그룹 — 빈 값')
  })

  test('④ 상태가 아닌 열에는 고를 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.notEqual(reasonOf(await setViewColumn(s.boss.ctx, s.db.defaultViewId, s.stage, { calculation: 'percent_complete' })), 'ok')
  })
})
