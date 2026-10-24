/**
 * rollup 고치기 — §7 정리 10n-31 (F-03-11)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 — 고치기
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 계산만 바꾼다 — 같은 id · 값이 새 계산으로 · 스키마 판이 오른다
 *   ② ★ 대상과 계산을 함께 바꾼다 — 대상만 바꾸고 계산이 맞지 않으면 `invalid_config`
 *   ③ ★ 관계를 바꾼다 — 대상을 그대로 두면 새 표에 없어 `invalid_target` · 새 표의 대상과 함께면 된다
 *   ④ 거부 — 모르는 계산 · 롤업이 아닌 속성(`not_found`)
 *   ⑤ 이미 그 값이면 쓰지 않는다(스키마 판 그대로)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { addRollupProperty, computeRollups, updateRollupProperty } from './rollup.ts'

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

/** 프로젝트 ← 작업(시간 · 끝남) · 프로젝트 → 메모(글자 수). 프로젝트의 롤업 "합" 은 작업들의 시간 합. */
async function world() {
  const ws = await createBareWorkspace('롤업 고치기')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const notes = unwrap(await createDatabase(boss.ctx, { name: `메모 ${Date.now()}` }))
  const prop = async (ds: string, name: string, type: 'number' | 'checkbox') => {
    unwrap(await addProperty(boss.ctx, ds, { name, type }))
    return unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === name)!.id
  }
  const hours = await prop(tasks.dataSourceId, '시간', 'number')
  const done = await prop(tasks.dataSourceId, '끝남', 'checkbox')
  const size = await prop(notes.dataSourceId, '크기', 'number')
  const toProject = unwrap(await addRelationProperty(boss.ctx, tasks.dataSourceId, { name: '프로젝트', targetDataSourceId: projects.dataSourceId, twoWay: { name: '작업들' } }))
  const toNotes = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '메모들', targetDataSourceId: notes.dataSourceId })).propertyId
  const rollup = unwrap(await addRollupProperty(boss.ctx, projects.dataSourceId, {
    name: '합', relationPropertyId: toProject.syncedPropertyId!, targetPropertyId: hours, function: 'sum',
  })).propertyId
  const project = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  for (const [h, d] of [[2, true], [4, false]] as const) {
    const task = unwrap(await createRow(boss.ctx, tasks.dataSourceId, { cells: [
      { propertyId: hours, value: { type: 'number', number: h } },
      { propertyId: done, value: { type: 'checkbox', checkbox: d } },
    ] })).id
    unwrap(await linkRows(boss.ctx, task, toProject.propertyId, { add: [project] }))
  }
  const note = unwrap(await createRow(boss.ctx, notes.dataSourceId, { cells: [{ propertyId: size, value: { type: 'number', number: 10 } }] })).id
  unwrap(await linkRows(boss.ctx, project, toNotes, { add: [note] }))
  const result = async () => {
    const cell = unwrap(await computeRollups(boss.ctx, projects.dataSourceId, [project])).values[project]?.[rollup]
    return cell?.state === 'ok' ? cell.result : cell
  }
  const version = async () => unwrap(await getSchema(boss.ctx, projects.dataSourceId)).schemaVersion
  const config = async () => unwrap(await getSchema(boss.ctx, projects.dataSourceId)).properties.find((p) => p.id === rollup)?.config
  return { boss, projects, hours, done, size, toNotes, rollup, result, version, config }
}

describe('rollup 고치기 (10n-31)', () => {
  test('★ ① 계산만 바꾼다 — 같은 id · 값이 새 계산으로 · 스키마 판이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.result(), { kind: 'number', number: 6 })
    const before = await w.version()
    unwrap(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { function: 'average' }))
    assert.deepEqual(await w.result(), { kind: 'number', number: 3 }, '평균')
    assert.notEqual(await w.version(), before)
    assert.equal((await w.config() as { function?: string })?.function, 'average')
  })

  test('★ ② 대상과 계산을 함께 — 대상만 바꾸고 계산이 맞지 않으면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { targetPropertyId: w.done })), 'invalid_config', '체크박스에 합')
    unwrap(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { targetPropertyId: w.done, function: 'percent_checked' }))
    assert.deepEqual(await w.result(), { kind: 'percent', percent: 0.5 })
  })

  test('★ ③ 관계를 바꾼다 — 대상을 그대로 두면 새 표에 없다 · 새 표의 대상과 함께면 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { relationPropertyId: w.toNotes })), 'invalid_target')
    unwrap(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { relationPropertyId: w.toNotes, targetPropertyId: w.size }))
    assert.deepEqual(await w.result(), { kind: 'number', number: 10 }, '메모의 크기 합')
  })

  test('④ 거부 — 모르는 계산 · 롤업이 아닌 속성', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { function: 'p99' })), 'invalid_config')
    assert.equal(reasonOf(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.toNotes, { function: 'count' })), 'not_found', 'relation 속성')
    assert.deepEqual(await w.result(), { kind: 'number', number: 6 }, '그대로')
  })

  test('⑤ 이미 그 값이면 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const before = await w.version()
    unwrap(await updateRollupProperty(w.boss.ctx, w.projects.dataSourceId, w.rollup, { function: 'sum' }))
    assert.equal(await w.version(), before, '스키마 판 그대로')
  })
})
