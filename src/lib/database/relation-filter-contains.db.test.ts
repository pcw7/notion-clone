/**
 * relation 으로 거르기 — 포함 · 포함하지 않음 — §7 정리 10n-45 (F-04-09 · F-03-10)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-45] · 0114
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 포함 — 그 행으로 이어진 행만 · 포함하지 않음 — 그 반대(아무것도 안 이어진 행 포함)
 *   ② ★ 휴지통의 행으로는 포함이 아니다 — 칸이 보여 주지 않는다 · 되살리면 다시 맞는다
 *   ③ 값의 검사 — 저장 경로는 uuid 만 받는다 · 읽기 경로는 uuid 가 아닌 값에 깨지지 않고 아무 행도 맞지 않는다
 *   ④ ★ 값 고르개의 후보 — 행이 없는 자리 · 이어진 것을 빼지 않는다 · 휴지통 · 템플릿 없음 · 제목으로 찾는다
 *   ⑤ ★ 후보의 권한 — 표를 못 보면 not_found · 대상 표를 못 보면 빈 목록 · relation 이 아니면 unknown_property
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { createRow, trashRow } from './row.ts'
import { createTemplate } from './template.ts'
import { addRelationProperty, linkRows, searchFilterCandidates } from './relation.ts'
import { queryRows } from './query.ts'
import { compileFilter, ParamBag, validateFilter, type FilterNode } from './filter.ts'
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

/**
 * 프로젝트 넷 — 가(→ 엑스) · 나(→ 엑스 · 와이) · 다(→ 제트 — 휴지통) · 라(없음). 작업에는 템플릿 하나(후보에 없어야 한다).
 * 멤버 하나는 두 표를 처음엔 다 본다.
 */
async function world() {
  const ws = await createBareWorkspace('relation 포함')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const member: Actor = await joinAs(ws, await createUser('멤버'), 'member')
  const table = async (name: string) => {
    const made = unwrap(await createDatabase(boss.ctx, { name: `${name} ${Date.now()}` }))
    const titleId = unwrap(await getSchema(boss.ctx, made.dataSourceId)).properties.find((p) => p.type === 'title')!.id
    const row = async (title: string) =>
      unwrap(
        await createRow(boss.ctx, made.dataSourceId, {
          cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }],
        }),
      ).id
    const template = async (title: string) => unwrap(await createTemplate(boss.ctx, made.dataSourceId, { title })).id
    return { ...made, titleId, row, template }
  }
  const projects = await table('프로젝트')
  const tasks = await table('작업')
  const toTasks = unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name: '작업들', targetDataSourceId: tasks.dataSourceId })).propertyId
  const [x, y, z] = [await tasks.row('엑스'), await tasks.row('와이'), await tasks.row('제트')]
  const [ga, na, da, ra] = [await projects.row('가'), await projects.row('나'), await projects.row('다'), await projects.row('라')]
  unwrap(await linkRows(boss.ctx, ga, toTasks, { add: [x] }))
  unwrap(await linkRows(boss.ctx, na, toTasks, { add: [x, y] }))
  unwrap(await linkRows(boss.ctx, da, toTasks, { add: [z] }))
  unwrap(await trashRow(boss.ctx, z))
  const ids = async (filter: FilterNode) =>
    unwrap(await queryRows(boss.ctx, projects.dataSourceId, { filter, limit: 50 })).rows.map((r) => r.id).sort()
  const makePrivate = async (databaseId: string) => {
    assert.equal((await stopInheriting(boss.ctx, databaseId)).ok, true)
    assert.equal((await grantAccess(boss.ctx, databaseId, { type: 'user', id: boss.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(boss.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
  }
  return { boss, member, projects, tasks, toTasks, x, y, z, ga, na, da, ra, ids, makePrivate }
}

describe('relation 으로 거르기 — 포함 · 포함하지 않음 (10n-45)', () => {
  test('★ ① 포함 — 그 행으로 이어진 행만 · 포함하지 않음 — 아무것도 안 이어진 행도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'contains', value: w.x }), [w.ga, w.na].sort())
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'contains', value: w.y }), [w.na])
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'does_not_contain', value: w.x }), [w.da, w.ra].sort())
  })

  test('★ ② 휴지통의 행으로는 포함이 아니다 — 되살리면 다시 맞는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'contains', value: w.z }), [])
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'does_not_contain', value: w.z }), [w.ga, w.na, w.da, w.ra].sort())
    await restorePage(w.boss.ctx, asBlockId(w.z))
    assert.deepEqual(await w.ids({ property_id: w.toTasks, operator: 'contains', value: w.z }), [w.da])
  })

  test('③ 값의 검사 — 저장은 uuid 만 · 읽기는 uuid 가 아닌 값에 깨지지 않고 아무 행도 맞지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const types = new Map([[w.toTasks, 'relation']])
    for (const value of ['엑스', 42, undefined]) {
      const issues = validateFilter({ property_id: w.toTasks, operator: 'contains', value } as FilterNode, types)
      assert.equal(issues.length, 1, String(value))
    }
    assert.deepEqual(validateFilter({ property_id: w.toTasks, operator: 'contains', value: w.x }, types), [])
    // 읽기 경로 — 저장된 뷰의 필터는 다시 검사하지 않는다(카탈로그를 줄여도 뷰가 열려야 한다)
    const run = async (operator: string) => {
      const params = new ParamBag(2) // $1 은 표 id
      const predicate = compileFilter({ property_id: w.toTasks, operator, value: 'not-a-uuid' }, types, params, { me: null, today: '2026-01-01' })
      return withReadTransaction(async (tx) =>
        (await tx.query<{ id: string }>(`SELECT p.id FROM page p WHERE p.data_source_id = $1 AND ${predicate}`, [w.projects.dataSourceId, ...params.values]))
          .map((r) => r.id)
          .sort(),
      )
    }
    assert.deepEqual(await run('contains'), [])
    assert.deepEqual(await run('does_not_contain'), [w.ga, w.na, w.da, w.ra].sort())
  })

  test('★ ④ 값 고르개의 후보 — 이어진 것을 빼지 않는다 · 휴지통 · 템플릿은 없다 · 제목으로 찾는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    await w.tasks.template('와이 틀')
    const all = unwrap(await searchFilterCandidates(w.member.ctx, w.projects.dataSourceId, w.toTasks, ''))
    assert.deepEqual(all.items.map((r) => r.title), ['엑스', '와이'], '이어진 엑스 · 와이도 · 휴지통의 제트와 템플릿은 없다')
    const found = unwrap(await searchFilterCandidates(w.member.ctx, w.projects.dataSourceId, w.toTasks, '와'))
    assert.deepEqual(found.items.map((r) => r.id), [w.y])
  })

  test('★ ⑤ 후보의 권한 — 대상 표를 못 보면 빈 목록 · 표를 못 보면 not_found · relation 이 아니면 unknown_property', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const notRelation = await searchFilterCandidates(w.boss.ctx, w.projects.dataSourceId, w.projects.titleId, '')
    assert.equal(notRelation.ok === false && notRelation.reason, 'unknown_property')
    const garbage = await searchFilterCandidates(w.boss.ctx, 'not-a-uuid', w.toTasks, '')
    assert.equal(garbage.ok === false && garbage.reason, 'not_found')

    await w.makePrivate(w.tasks.id)
    assert.deepEqual(unwrap(await searchFilterCandidates(w.member.ctx, w.projects.dataSourceId, w.toTasks, '')).items, [])
    assert.equal(unwrap(await searchFilterCandidates(w.boss.ctx, w.projects.dataSourceId, w.toTasks, '')).items.length, 2, '만든 사람은 본다')
    await w.makePrivate(w.projects.id)
    const unseen = await searchFilterCandidates(w.member.ctx, w.projects.dataSourceId, w.toTasks, '')
    assert.equal(unseen.ok === false && unseen.reason, 'not_found')
  })
})
