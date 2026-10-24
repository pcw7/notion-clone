/**
 * relation 으로 거르기 — 비어 있음 · 비어 있지 않음 — §7 정리 10n-44 (F-04-09 · F-03-10)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-44] relation 으로 거르기 · 0113
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 비어 있지 않음 — 살아 있는 대상 행이 하나라도 이어진 행 · 비어 있음 — 그 반대(아무것도 안 이어진 행 포함)
 *   ② ★ 휴지통의 행만 이어진 칸은 비어 있다 — 칸이 보여 주는 것과 같다 · 되살리면 다시 비어 있지 않다
 *   ③ 다른 relation 의 연결은 섞이지 않는다(그 속성의 엣지만)
 *   ④ 정렬 키로는 받지 않는다 — 저장 경로는 거부하고 컴파일은 건너뛴다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { createRow, trashRow } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { queryRows } from './query.ts'
import { compileSorts, ParamBag, validateSorts, type FilterNode } from './filter.ts'
import { restorePage } from '../block/trash.ts'
import { asBlockId } from '../ids.ts'

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

/** 프로젝트 셋 — 작업과 이어진 것 · 아무것도 없는 것 · 휴지통의 작업과만 이어진 것. 메모 relation 은 따로다. */
async function world() {
  const ws = await createBareWorkspace('relation 거르기')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const notes = unwrap(await createDatabase(boss.ctx, { name: `메모 ${Date.now()}` }))
  const toTasks = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '작업들', targetDataSourceId: tasks.dataSourceId })).propertyId
  const toNotes = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '메모들', targetDataSourceId: notes.dataSourceId })).propertyId
  const project = async () => unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  const [busy, idle, ghost] = [await project(), await project(), await project()]
  const task = async () => unwrap(await createRow(boss.ctx, tasks.dataSourceId, {})).id
  const [live, dropped] = [await task(), await task()]
  unwrap(await linkRows(boss.ctx, busy, toTasks, { add: [live] }))
  unwrap(await linkRows(boss.ctx, ghost, toTasks, { add: [dropped] }))
  unwrap(await trashRow(boss.ctx, dropped))
  // 메모는 idle 에만 — 작업들 칸과 섞이지 않아야 한다
  const note = unwrap(await createRow(boss.ctx, notes.dataSourceId, {})).id
  unwrap(await linkRows(boss.ctx, idle, toNotes, { add: [note] }))
  const ids = async (filter: FilterNode) =>
    unwrap(await queryRows(boss.ctx, projects.dataSourceId, { filter, limit: 50 })).rows.map((r) => r.id).sort()
  return { boss, projects, toTasks, toNotes, busy, idle, ghost, dropped, ids }
}

describe('relation 으로 거르기 (10n-44)', () => {
  test('★ ① 비어 있지 않음 · 비어 있음 — 아무것도 안 이어진 행은 비어 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'is_not_empty' }), [w.busy])
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'is_empty' }), [w.idle, w.ghost].sort())
  })

  test('★ ② 휴지통의 행만 이어진 칸은 비어 있다 — 되살리면 다시 비어 있지 않다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.ok((await w.ids({ property_id: w.toTasks, operator: 'is_empty' })).includes(w.ghost))
    await restorePage(w.boss.ctx, asBlockId(w.dropped))
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'is_not_empty' }), [w.busy, w.ghost].sort())
  })

  test('③ 다른 relation 의 연결은 섞이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.ids({ property_id: w.toNotes, operator: 'is_not_empty' }), [w.idle])
    assert.ok((await w.ids({ property_id: w.toTasks, operator: 'is_empty' })).includes(w.idle), '메모가 있어도 작업들은 비었다')
  })

  test('④ 정렬 키로는 받지 않는다 — 저장 경로는 거부 · 컴파일은 건너뛴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const types = new Map([[w.toTasks, 'relation']])
    const issues = validateSorts([{ property_id: w.toTasks, direction: 'asc' }], types)
    assert.equal(issues.length, 1)
    assert.match(issues[0].message, /정렬할 수 없습니다/)
    const compiled = compileSorts([{ property_id: w.toTasks, direction: 'asc' }], types, new ParamBag(1))
    assert.ok(!compiled.orderBy.includes('relation'), '정렬 조각이 없다(타이브레이커만)')
    assert.equal(compiled.keys.length, 0)
  })
})
