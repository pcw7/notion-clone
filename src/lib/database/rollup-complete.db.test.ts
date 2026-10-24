/**
 * rollup 의 완료 비율 — §7 정리 10n-29 (F-03-05 · F-03-11)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 — 함수 12종(`percent_complete`)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 연결된 작업 중 상태가 완료 그룹인 것의 비율 — 빈 상태도 분모에 든다 · 연결 0개면 없음
 *   ② ★ 옵션을 완료 그룹으로 옮기면 비율이 따라온다(그룹은 읽을 때 옵션에서 본다)
 *   ③ 만들 때 — status 가 아닌 대상에는 고를 수 없다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema, updateSelectOption } from './property.ts'
import { createRow } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { addRollupProperty, computeRollups, type RollupCell } from './rollup.ts'

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

/** 프로젝트 ← 작업. 작업에 진행(status) · 검토(진행 중 그룹) 옵션 · 프로젝트에 "작업들" 을 타는 완료 비율. */
async function world() {
  const ws = await createBareWorkspace('완료 비율')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  unwrap(await addProperty(boss.ctx, tasks.dataSourceId, { name: '진행', type: 'status' }))
  unwrap(await addProperty(boss.ctx, tasks.dataSourceId, { name: '단계', type: 'select' }))
  const props = unwrap(await getSchema(boss.ctx, tasks.dataSourceId)).properties
  const progress = props.find((p) => p.name === '진행')!.id
  const stage = props.find((p) => p.name === '단계')!.id
  const review = unwrap(await addSelectOption(boss.ctx, tasks.dataSourceId, progress, { name: '검토', group: 'in_progress' })).option.id
  const opt = (name: string) => props.find((p) => p.id === progress)!.options!.find((o) => o.name === name)!.id
  const made = unwrap(await addRelationProperty(boss.ctx, tasks.dataSourceId, { name: '프로젝트', targetDataSourceId: projects.dataSourceId, twoWay: { name: '작업들' } }))
  const percent = unwrap(await addRollupProperty(boss.ctx, projects.dataSourceId, {
    name: '진행률',
    relationPropertyId: made.syncedPropertyId!,
    targetPropertyId: progress,
    function: 'percent_complete',
  })).propertyId
  const project = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  const empty = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  const task = async (optionId: string | null) => {
    const id = unwrap(await createRow(boss.ctx, tasks.dataSourceId, { cells: [{ propertyId: progress, value: { type: 'status', status: optionId === null ? null : { id: optionId } } }] })).id
    unwrap(await linkRows(boss.ctx, id, made.propertyId, { add: [project] }))
    return id
  }
  const cell = async (rowId: string): Promise<RollupCell | undefined> =>
    unwrap(await computeRollups(boss.ctx, projects.dataSourceId, [rowId])).values[rowId]?.[percent]
  return { boss, tasks, projects, progress, stage, review, opt, made, project, empty, task, cell }
}

describe('rollup 의 완료 비율 (10n-29)', () => {
  test('★ ① 완료 그룹에 든 연결의 비율 — 빈 상태도 분모 · 연결 0개면 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    await w.task(w.opt('완료'))
    await w.task(w.opt('진행 중'))
    await w.task(w.review)
    await w.task(null)
    assert.deepEqual(await w.cell(w.project), { state: 'ok', result: { kind: 'percent', percent: 0.25 }, hidden: 0 })
    assert.deepEqual(await w.cell(w.empty), { state: 'ok', result: { kind: 'percent', percent: null }, hidden: 0 }, '연결 0개 — 없음')
  })

  test('★ ② 옵션을 완료 그룹으로 옮기면 비율이 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    await w.task(w.opt('완료'))
    await w.task(w.review)
    const before = await w.cell(w.project)
    assert.equal(before?.state === 'ok' && before.result.kind === 'percent' ? before.result.percent : 'x', 0.5)
    unwrap(await updateSelectOption(w.boss.ctx, w.tasks.dataSourceId, w.progress, w.review, { group: 'complete' }))
    const after = await w.cell(w.project)
    assert.equal(after?.state === 'ok' && after.result.kind === 'percent' ? after.result.percent : 'x', 1, '검토가 완료 그룹 — 둘 다 완료')
  })

  test('③ status 가 아닌 대상에는 고를 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const refused = await addRollupProperty(w.boss.ctx, w.projects.dataSourceId, {
      name: '잘못',
      relationPropertyId: w.made.syncedPropertyId!,
      targetPropertyId: w.stage,
      function: 'percent_complete',
    })
    assert.notEqual(reasonOf(refused), 'ok', 'select 대상')
  })
})
