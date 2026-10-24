/**
 * relation 칸 비우기 — §7 정리 10n-38 (F-03-10 · 표의 `Delete`)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-38] 비우기
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 보이는 연결을 모두 뺀다 — 양방향의 거울상도 · 행의 버전이 오른다
 *   ② ★ 볼 수 없는 표의 연결은 남는다 — 보지 못한 것은 지우지 않는다
 *   ③ ★ 휴지통의 연결도 남는다 — 되살리면 칸에 돌아온다
 *   ④ 거부 — 더하기와 함께 · 참거짓이 아닌 값 · 고칠 수 없는 사람
 *   ⑤ 비울 것이 없으면 아무것도 바꾸지 않는다(버전 그대로)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { createRow, trashRow } from './row.ts'
import { addRelationProperty, linkRows, readRelation } from './relation.ts'
import { restorePage } from '../block/trash.ts'
import { asBlockId } from '../ids.ts'
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

/** 프로젝트 ↔ 작업(양방향) · 프로젝트 → 비밀(단방향). 프로젝트 하나에 작업 둘 · 비밀 하나가 이어져 있다. */
async function world() {
  const ws = await createBareWorkspace('relation 비우기')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const mate: Actor = await joinAs(ws, await createUser('동료'), 'member')
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const secrets = unwrap(await createDatabase(boss.ctx, { name: `비밀 ${Date.now()}` }))
  const toTasks = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '작업들', targetDataSourceId: tasks.dataSourceId, twoWay: { name: '프로젝트' } }))
  const toSecrets = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '비밀들', targetDataSourceId: secrets.dataSourceId })).propertyId
  const project = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  const [t1, t2] = [unwrap(await createRow(boss.ctx, tasks.dataSourceId, {})).id, unwrap(await createRow(boss.ctx, tasks.dataSourceId, {})).id]
  const secret = unwrap(await createRow(boss.ctx, secrets.dataSourceId, {})).id
  unwrap(await linkRows(boss.ctx, project, toTasks.propertyId, { add: [t1, t2] }))
  unwrap(await linkRows(boss.ctx, project, toSecrets, { add: [secret] }))
  /** 이 칸의 엣지 수 — 권한 · 휴지통을 거르지 않은 날것. */
  const edges = (propertyId: string, from: string) =>
    withReadTransaction(async (tx) =>
      (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`, [propertyId, from])).n,
    )
  const version = () =>
    withReadTransaction(async (tx) => (await tx.queryOne<{ version: string }>(`SELECT version::text FROM block WHERE id = $1`, [project])).version)
  return { boss, mate, secrets, toTasks, toSecrets, project, t1, t2, secret, edges, version }
}

describe('relation 칸 비우기 (10n-38)', () => {
  test('★ ① 보이는 연결을 모두 뺀다 — 거울상도 · 버전이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const before = await w.version()
    unwrap(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { clear: true }))
    assert.equal(await w.edges(w.toTasks.propertyId, w.project), 0)
    assert.equal(await w.edges(w.toTasks.syncedPropertyId!, w.t1), 0, '작업 쪽 거울상도 빠진다')
    assert.equal(await w.edges(w.toTasks.syncedPropertyId!, w.t2), 0)
    assert.notEqual(await w.version(), before)
    assert.equal(await w.edges(w.toSecrets, w.project), 1, '다른 칸은 그대로')
  })

  test('★ ② 볼 수 없는 표의 연결은 남는다 — 보지 못한 것은 지우지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal((await stopInheriting(w.boss.ctx, w.secrets.id)).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.secrets.id, { type: 'user', id: w.boss.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(w.boss.ctx, w.secrets.id, { type: 'workspace_everyone', id: null })).ok, true)
    unwrap(await linkRows(w.mate.ctx, w.project, w.toSecrets, { clear: true }))
    assert.equal(await w.edges(w.toSecrets, w.project), 1, '동료는 비밀 표를 못 본다')
    unwrap(await linkRows(w.boss.ctx, w.project, w.toSecrets, { clear: true }))
    assert.equal(await w.edges(w.toSecrets, w.project), 0, '대표는 본다')
  })

  test('★ ③ 휴지통의 연결도 남는다 — 되살리면 칸에 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    unwrap(await trashRow(w.boss.ctx, w.t2))
    unwrap(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { clear: true }))
    assert.equal(await w.edges(w.toTasks.propertyId, w.project), 1, '휴지통의 작업과의 연결')
    assert.equal(unwrap(await readRelation(w.boss.ctx, w.project, w.toTasks.propertyId)).items.length, 0, '칸에는 보이지 않는다')
    await restorePage(w.boss.ctx, asBlockId(w.t2))
    assert.deepEqual(unwrap(await readRelation(w.boss.ctx, w.project, w.toTasks.propertyId)).items.map((i) => i.id), [w.t2])
  })

  test('④ 거부 — 더하기와 함께 · 참거짓이 아닌 값 · 고칠 수 없는 사람', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { clear: true, add: [w.t1] })), 'invalid_value')
    assert.equal(reasonOf(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { clear: 'yes' as never })), 'invalid_value')
    const guest: Actor = await joinAs(w.boss.ctx.workspaceId, await createUser('구경꾼'), 'member')
    // 프로젝트 표를 보기만 하게
    const projectsDb = unwrap(await withReadTransaction(async (tx) => ({ ok: true as const, value: (await tx.queryOne<{ id: string }>(
      `SELECT ds.owner_database_id AS id FROM page p JOIN data_source ds ON ds.id = p.data_source_id WHERE p.id = $1`, [w.project])).id })))
    assert.equal((await stopInheriting(w.boss.ctx, projectsDb)).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, projectsDb, { type: 'user', id: w.boss.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(w.boss.ctx, projectsDb, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, projectsDb, { type: 'user', id: guest.userId }, 'view')).ok, true)
    assert.equal(reasonOf(await linkRows(guest.ctx, w.project, w.toTasks.propertyId, { clear: true })), 'forbidden')
    assert.equal(await w.edges(w.toTasks.propertyId, w.project), 2, '그대로')
  })

  test('⑤ 비울 것이 없으면 아무것도 바꾸지 않는다 — 버전 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    unwrap(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { clear: true }))
    const before = await w.version()
    unwrap(await linkRows(w.boss.ctx, w.project, w.toTasks.propertyId, { clear: true }))
    assert.equal(await w.version(), before)
  })
})
