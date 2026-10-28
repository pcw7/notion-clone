/**
 * 뷰 검색의 relation 제목 — 뷰 검색의 나머지 트랙 V-2 (F-04-27)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 검색 ⑥
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 이어진 대상 행의 제목으로 찾는다 — 부분 · 대소문자 무시 · 자기 칸의 글과 OR
 *   ② ★ 칸이 보여 주는 것과 같다 — 휴지통 · 템플릿인 대상은 아니다
 *   ③ ★ 보는 사람이 읽을 수 없는 대상의 제목으로는 찾지 않는다(제목이 새지 않는다) · 열 집계도 같은 행
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { createRow, trashRow } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { queryRows } from './query.ts'
import { computeCalculations } from './calculate.ts'

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

/** 프로젝트(가 → 엑스 작업 · 나 → 와이 · 다 → 휴지통의 엑스 둘 · 라 → 없음) · 작업. 멤버는 처음엔 두 표를 다 본다. */
async function world() {
  const ws = await createBareWorkspace('relation 검색')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const member: Actor = await joinAs(ws, await createUser('멤버'), 'member')
  const table = async (name: string) => {
    const made = unwrap(await createDatabase(boss.ctx, { name: `${name} ${Date.now()}` }))
    const titleId = unwrap(await getSchema(boss.ctx, made.dataSourceId)).properties.find((p) => p.type === 'title')!.id
    const row = async (title: string) =>
      unwrap(await createRow(boss.ctx, made.dataSourceId, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
    return { ...made, titleId, row }
  }
  const projects = await table('프로젝트')
  const tasks = await table('작업')
  const toTasks = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '작업들', targetDataSourceId: tasks.dataSourceId })).propertyId
  const [x, y, gone] = [await tasks.row('엑스 작업'), await tasks.row('와이'), await tasks.row('엑스 둘')]
  const [ga, na, da] = [await projects.row('가'), await projects.row('나'), await projects.row('다')]
  await projects.row('라')
  unwrap(await linkRows(boss.ctx, ga, toTasks, { add: [x] }))
  unwrap(await linkRows(boss.ctx, na, toTasks, { add: [y] }))
  unwrap(await linkRows(boss.ctx, da, toTasks, { add: [gone] }))
  unwrap(await trashRow(boss.ctx, gone))
  const titles = async (actor: Actor, search: string) =>
    unwrap(await queryRows(actor.ctx, projects.dataSourceId, { search })).rows.map((r) => r.title).sort()
  return { boss, member, projects, tasks, toTasks, titles }
}

describe('① 대상의 제목', () => {
  test('★ 이어진 대상 행의 제목으로 — 부분 · 대소문자 무시 · 자기 제목과 OR', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.titles(w.boss, '엑스'), ['가'], '엑스 작업으로 이어진 가 — 휴지통의 엑스 둘로 이어진 다는 아니다')
    assert.deepEqual(await w.titles(w.boss, '와이'), ['나'])
    assert.deepEqual(await w.titles(w.boss, '라'), ['라'], '자기 제목은 그대로')
  })
})

describe('② 칸이 보여 주는 것과 같다', () => {
  test('★ 휴지통의 대상은 아니다(칸이 그 연결을 보여 주지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.titles(w.boss, '둘'), [], '휴지통의 엑스 둘')
  })
})

describe('③ 읽을 수 없는 대상', () => {
  test('★ 읽을 수 없는 대상의 제목으로는 찾지 않는다 — 열 집계도 같은 수', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.titles(w.member, '엑스'), ['가'], '처음엔 멤버도 본다')
    // 작업 표를 멤버에게서 닫는다 — 프로젝트는 그대로 본다
    assert.equal((await stopInheriting(w.boss.ctx, w.tasks.id)).ok, true)
    assert.equal((await grantAccess(w.boss.ctx, w.tasks.id, { type: 'user', id: w.boss.userId }, 'full_access')).ok, true)
    await revokeAccess(w.boss.ctx, w.tasks.id, { type: 'workspace_everyone' })
    assert.deepEqual(await w.titles(w.member, '엑스'), [], '읽을 수 없는 엑스 작업의 제목으로는 아니다')
    assert.deepEqual(await w.titles(w.boss, '엑스'), ['가'], '대표는 그대로')
    const counted = await computeCalculations(w.member.ctx, w.projects.dataSourceId, null, [{ propertyId: w.projects.titleId, type: 'title', calculation: 'count_all' }], '엑스')
    assert.deepEqual(counted[w.projects.titleId], { kind: 'count', value: 0 }, '열 집계도 같은 행')
  })
})
