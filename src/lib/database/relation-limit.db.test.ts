/**
 * relation 의 "하나만" 제한 바꾸기 — §7 정리 10n-42 (F-03-10)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-42] 제한 바꾸기
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 켠다 — 설정에 `limit: one` · 판이 오른다 · 이미 여럿인 칸은 그대로 · 그 뒤에 더하면 그것으로 바뀐다
 *   ② ★ 끈다 — 둘 이상 이을 수 있다 · 다른 설정(대상 · 짝)은 그대로
 *   ③ 이미 그 값이면 쓰지 않는다(판 그대로)
 *   ④ 거부 — 모르는 값 · relation 이 아닌 속성 · 하위 항목의 짝 · 구조를 못 고치는 사람
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { createRow } from './row.ts'
import { addRelationProperty, linkRows, setRelationLimit } from './relation.ts'
import { addProperty, getSchema } from './property.ts'
import { enableSubItems } from './sub-items.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { withReadTransaction } from '../db/tx.ts'

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

/** 프로젝트 ↔ 작업(양방향 "작업들" / "프로젝트"). 프로젝트 하나에 작업 둘이 이어져 있다. */
async function world() {
  const ws = await createBareWorkspace('relation 제한')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const mate: Actor = await joinAs(ws, await createUser('동료'), 'member')
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const toTasks = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '작업들', targetDataSourceId: tasks.dataSourceId, twoWay: { name: '프로젝트' } }))
  const project = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  const task = async () => unwrap(await createRow(boss.ctx, tasks.dataSourceId, {})).id
  const [t1, t2] = [await task(), await task()]
  unwrap(await linkRows(boss.ctx, project, toTasks.propertyId, { add: [t1, t2] }))
  const config = async () =>
    withReadTransaction(async (tx) => (await tx.queryOne<{ config: Record<string, unknown> }>(`SELECT config FROM property WHERE id = $1`, [toTasks.propertyId])).config)
  const version = async () => unwrap(await getSchema(boss.ctx, projects.dataSourceId)).schemaVersion
  const edges = (from: string) =>
    withReadTransaction(async (tx) =>
      (await tx.query<{ to_page_id: string }>(`SELECT to_page_id FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`, [toTasks.propertyId, from])).map((r) => r.to_page_id).sort(),
    )
  return { boss, mate, projects, tasks, toTasks, project, task, t1, t2, config, version, edges }
}

describe('relation 제한 바꾸기 (10n-42)', () => {
  test('★ ① 켠다 — limit one · 판이 오른다 · 이미 여럿인 칸은 그대로 · 그 뒤에 더하면 그것으로 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const before = await w.version()
    unwrap(await setRelationLimit(w.boss.ctx, w.projects.dataSourceId, w.toTasks.propertyId, { limit: 'one' }))
    assert.equal((await w.config()).limit, 'one')
    assert.notEqual(await w.version(), before)
    assert.deepEqual(await w.edges(w.project), [w.t1, w.t2].sort(), '있던 연결은 그대로(F-03-10)')
    const t3 = await w.task()
    unwrap(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { add: [t3] }))
    assert.deepEqual(await w.edges(w.project), [t3], '더하면 그것으로 바뀐다')
  })

  test('★ ② 끈다 — 둘 이상 이을 수 있다 · 대상 · 짝은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    unwrap(await setRelationLimit(w.boss.ctx, w.projects.dataSourceId, w.toTasks.propertyId, { limit: 'one' }))
    unwrap(await setRelationLimit(w.boss.ctx, w.projects.dataSourceId, w.toTasks.propertyId, { limit: 'none' }))
    const config = await w.config()
    assert.equal(config.limit, undefined)
    assert.equal(config.target_data_source_id, w.tasks.dataSourceId)
    assert.equal(config.synced_property_id, w.toTasks.syncedPropertyId)
    const fresh = unwrap(await createRow(w.boss.ctx, w.projects.dataSourceId, {})).id
    unwrap(await linkRows(w.boss.ctx, fresh, w.toTasks.propertyId, { add: [w.t1, w.t2] }))
    assert.equal((await w.edges(fresh)).length, 2)
  })

  test('③ 이미 그 값이면 쓰지 않는다 — 판 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const before = await w.version()
    unwrap(await setRelationLimit(w.boss.ctx, w.projects.dataSourceId, w.toTasks.propertyId, { limit: 'none' }))
    assert.equal(await w.version(), before)
  })

  test('④ 거부 — 모르는 값 · relation 이 아닌 속성 · 하위 항목의 짝 · 구조를 못 고치는 사람', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await setRelationLimit(w.boss.ctx, w.projects.dataSourceId, w.toTasks.propertyId, { limit: 'many' })), 'invalid_config')
    unwrap(await addProperty(w.boss.ctx, w.projects.dataSourceId, { name: '메모', type: 'rich_text' }))
    const memo = unwrap(await getSchema(w.boss.ctx, w.projects.dataSourceId)).properties.find((p) => p.name === '메모')!.id
    assert.equal(reasonOf(await setRelationLimit(w.boss.ctx, w.projects.dataSourceId, memo, { limit: 'one' })), 'not_found')
    const pair = unwrap(await enableSubItems(w.boss.ctx, w.tasks.dataSourceId))
    assert.equal(reasonOf(await setRelationLimit(w.boss.ctx, w.tasks.dataSourceId, pair.childrenPropertyId, { limit: 'one' })), 'invalid_config', '하위 항목의 짝')
    // 프로젝트 표를 동료에게는 내용 고치기까지만
    assert.equal((await stopInheriting(w.boss.ctx, w.projects.id)).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.projects.id, { type: 'user', id: w.boss.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(w.boss.ctx, w.projects.id, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.projects.id, { type: 'user', id: w.mate.userId }, 'edit_content')).ok, true)
    assert.equal(reasonOf(await setRelationLimit(w.mate.ctx, w.projects.dataSourceId, w.toTasks.propertyId, { limit: 'one' })), 'forbidden')
    assert.equal((await w.config()).limit, undefined, '그대로')
  })
})
