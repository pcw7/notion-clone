/**
 * relation 칸에서 새 행을 만들며 잇는다 — §7 정리 10n-41 (F-03-10 *"셀에서 + 새 페이지"*)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-41] 만들며 잇기
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 대상 표에 그 제목으로 행을 만들고 잇는다 — 양방향이면 거울상도
 *   ② ★ 제한 `one` 이면 있던 연결을 새 행으로 바꾼다
 *   ③ ★ 대상 표에 만들 수 없으면 아무것도 남지 않는다 — 행도 연결도(한 트랜잭션)
 *   ④ 거부 — 빈 제목 · 글자가 아닌 제목 · relation 이 아닌 속성 · 볼 수 없는 표
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { createRow } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { createLinkedRow } from './relation-create.ts'
import { addProperty, getSchema } from './property.ts'
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

/** 프로젝트 → 작업(양방향 "작업들" / "프로젝트") · 프로젝트 → 담당(단방향 · 하나만). */
async function world() {
  const ws = await createBareWorkspace('만들며 잇기')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const mate: Actor = await joinAs(ws, await createUser('동료'), 'member')
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const owners = unwrap(await createDatabase(boss.ctx, { name: `담당 ${Date.now()}` }))
  const toTasks = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '작업들', targetDataSourceId: tasks.dataSourceId, twoWay: { name: '프로젝트' } }))
  const toOwner = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '담당', targetDataSourceId: owners.dataSourceId, limit: 'one' })).propertyId
  unwrap(await addProperty(boss.ctx, projects.dataSourceId, { name: '메모', type: 'rich_text' }))
  const memo = unwrap(await getSchema(boss.ctx, projects.dataSourceId)).properties.find((p) => p.name === '메모')!.id
  const project = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  /** 그 표의 살아 있는 행의 제목들(템플릿 제외). */
  const titles = (dataSourceId: string) =>
    withReadTransaction(async (tx) =>
      (await tx.query<{ t: string }>(
        `SELECT coalesce(b.properties->'title'->0->>'plain_text', '') AS t FROM page p JOIN block b ON b.id = p.id
          WHERE p.data_source_id = $1 AND b.lifecycle = 'live' AND p.is_template = false ORDER BY t`,
        [dataSourceId],
      )).map((r) => r.t),
    )
  const edges = (propertyId: string, from: string) =>
    withReadTransaction(async (tx) =>
      (await tx.query<{ to_page_id: string }>(`SELECT to_page_id FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`, [propertyId, from])).map((r) => r.to_page_id),
    )
  return { boss, mate, projects, tasks, owners, toTasks, toOwner, memo, project, titles, edges }
}

describe('만들며 잇기 (10n-41)', () => {
  test('★ ① 대상 표에 그 제목으로 행을 만들고 잇는다 — 양방향이면 거울상도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const made = unwrap(await createLinkedRow(w.boss.ctx, w.project, w.toTasks.propertyId, { title: '  설계   도면 ' }))
    assert.equal(made.created.title, '설계 도면', '공백은 접는다')
    assert.deepEqual(await w.titles(w.tasks.dataSourceId), ['설계 도면'])
    assert.deepEqual(await w.edges(w.toTasks.propertyId, w.project), [made.created.id])
    assert.deepEqual(await w.edges(w.toTasks.syncedPropertyId!, made.created.id), [w.project], '작업 쪽 거울상')
    const cache = made.row.properties[w.toTasks.propertyId] as { relation?: { id: string }[] } | undefined
    assert.deepEqual(cache?.relation?.map((r) => r.id), [made.created.id], '돌려준 행의 칸에 새 연결')
  })

  test('★ ② 제한 one 이면 있던 연결을 새 행으로 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const before = unwrap(await createRow(w.boss.ctx, w.owners.dataSourceId, {})).id
    unwrap(await linkRows(w.boss.ctx, w.project, w.toOwner, { add: [before] }))
    const made = unwrap(await createLinkedRow(w.boss.ctx, w.project, w.toOwner, { title: '새 담당' }))
    assert.deepEqual(await w.edges(w.toOwner, w.project), [made.created.id])
  })

  test('★ ③ 대상 표에 만들 수 없으면 아무것도 남지 않는다 — 행도 연결도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    // 작업 표를 동료에게는 보기만 — 볼 수는 있어 열리지만 만들 수 없다
    assert.equal((await stopInheriting(w.boss.ctx, w.tasks.id)).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.tasks.id, { type: 'user', id: w.boss.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(w.boss.ctx, w.tasks.id, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.tasks.id, { type: 'user', id: w.mate.userId }, 'view')).ok, true)
    assert.equal(reasonOf(await createLinkedRow(w.mate.ctx, w.project, w.toTasks.propertyId, { title: '몰래' })), 'forbidden')
    assert.deepEqual(await w.titles(w.tasks.dataSourceId), [], '행이 남지 않았다')
    assert.deepEqual(await w.edges(w.toTasks.propertyId, w.project), [], '연결도')
  })

  test('④ 거부 — 빈 제목 · 글자가 아닌 제목 · relation 이 아닌 속성 · 볼 수 없는 표', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await createLinkedRow(w.boss.ctx, w.project, w.toTasks.propertyId, { title: '   ' })), 'invalid_value')
    assert.equal(reasonOf(await createLinkedRow(w.boss.ctx, w.project, w.toTasks.propertyId, { title: 7 })), 'invalid_value')
    assert.equal(reasonOf(await createLinkedRow(w.boss.ctx, w.project, w.memo, { title: '가' })), 'unknown_property')
    assert.equal((await stopInheriting(w.boss.ctx, w.owners.id)).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.owners.id, { type: 'user', id: w.boss.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(w.boss.ctx, w.owners.id, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal(reasonOf(await createLinkedRow(w.mate.ctx, w.project, w.toOwner, { title: '가' })), 'invalid_value', '동료는 담당 표를 못 본다')
    assert.deepEqual(await w.titles(w.owners.dataSourceId), [])
  })
})
