/**
 * 필터가 걸린 뷰에서 만든 행의 relation — 포함 조건이면 그 행에 잇는다 — §7 정리 10n-47 (F-04-09 · F-03-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 필터가 걸린 뷰에서 만든 행 ⑧ · [보강 10n-47]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 포함 — 새 행이 그 행에 이어지고 그 필터를 지난다(만든 사람의 화면에서 사라지지 않는다)
 *   ② 같은 칸의 포함 둘 · 다른 칸의 포함 — 모두 잇는다 · 양방향이면 대상 행에 거울상
 *   ③ ★ 이을 수 없는 칸만 빠진다 — 휴지통의 행 · 하나만 제한에 둘 · 만들기만 있는 사람. 행은 생기고 다른 칸은 이어진다
 *   ④ 채우지 않는 것 — 포함하지 않음 · 비어 있음 · 자식이 둘인 OR
 *   ⑤ 하위 항목으로 만들 때도 — 상위 항목은 요청이 정하고 다른 relation 은 필터가 잇는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { createRow, readRow, trashRow } from './row.ts'
import { addRelationProperty } from './relation.ts'
import { queryRows } from './query.ts'
import { readRelationValue } from './property-types.ts'
import { createRowInView } from './view-row.ts'
import { createSubItem } from './sub-item-rows.ts'
import { enableSubItems } from './sub-items.ts'
import type { FilterNode } from './filter.ts'
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

/** 프로젝트 → 작업(단방향 "작업들" · 하나만 "담당 작업" · 양방향 "묶음"↔"프로젝트들"). 작업 엑스 · 와이 · 제트(휴지통). */
async function world() {
  const ws = await createBareWorkspace('뷰에서 만든 행의 relation')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const maker: Actor = await joinAs(ws, await createUser('만들기만'), 'member')
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const rel = async (name: string, extra: { limit?: 'one'; twoWay?: { name: string } } = {}) =>
    unwrap(await addRelationProperty(boss.ctx, projects.dataSourceId, { name, targetDataSourceId: tasks.dataSourceId, ...extra }))
  const toTasks = (await rel('작업들')).propertyId
  const owned = (await rel('담당 작업', { limit: 'one' })).propertyId
  const bundle = await rel('묶음', { twoWay: { name: '프로젝트들' } })
  const task = async () => unwrap(await createRow(boss.ctx, tasks.dataSourceId, {})).id
  const [x, y, z] = [await task(), await task(), await task()]
  unwrap(await trashRow(boss.ctx, z))
  const make = async (viewFilter: FilterNode, who: Actor = boss) => unwrap(await createRowInView(who.ctx, projects.dataSourceId, { viewFilter }))
  const linked = (row: { properties: Readonly<Record<string, unknown>> }, propertyId: string) =>
    readRelationValue(row.properties[propertyId]).relation.map((r) => r.id).sort()
  const passes = async (rowId: string, filter: FilterNode) =>
    unwrap(await queryRows(boss.ctx, projects.dataSourceId, { filter, limit: 50 })).rows.some((r) => r.id === rowId)
  return { ws, boss, maker, projects, tasks, toTasks, owned, bundle, x, y, z, make, linked, passes }
}

const contains = (property_id: string, value: string): FilterNode => ({ property_id, operator: 'contains', value })
const and = (...children: FilterNode[]): FilterNode => ({ op: 'and', children }) as FilterNode

describe('필터가 걸린 뷰에서 만든 행의 relation (10n-47)', () => {
  test('★ ① 포함 — 새 행이 그 행에 이어지고 그 필터를 지난다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const filter = contains(w.toTasks, w.x)
    const row = await w.make(filter)
    assert.deepEqual(w.linked(row, w.toTasks), [w.x], '답의 행에 연결이 실렸다')
    assert.equal(await w.passes(row.id, filter), true, '만든 사람의 화면에서 사라지지 않는다')
  })

  test('② 같은 칸의 포함 둘 · 다른 칸 — 모두 잇는다 · 양방향이면 대상 행에 거울상', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const row = await w.make(and(contains(w.toTasks, w.x), contains(w.toTasks, w.y), contains(w.bundle.propertyId, w.y)))
    assert.deepEqual(w.linked(row, w.toTasks), [w.x, w.y].sort())
    assert.deepEqual(w.linked(row, w.bundle.propertyId), [w.y])
    const mirror = await withReadTransaction((tx) => readRow(tx, w.y))
    assert.ok(mirror !== null && w.linked(mirror, w.bundle.syncedPropertyId!).includes(row.id), '와이의 "프로젝트들" 에 새 행')
  })

  test('★ ③ 이을 수 없는 칸만 빠진다 — 휴지통의 행 · 하나만 제한에 둘. 행은 생기고 다른 칸은 이어진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const row = await w.make(and(contains(w.toTasks, w.z), contains(w.owned, w.x), contains(w.owned, w.y), contains(w.bundle.propertyId, w.x)))
    assert.deepEqual(w.linked(row, w.toTasks), [], '휴지통의 제트 — 빠진다')
    assert.deepEqual(w.linked(row, w.owned), [], '하나만인 칸에 둘 — 만족할 수 없다')
    assert.deepEqual(w.linked(row, w.bundle.propertyId), [w.x], '다른 칸은 이어진다')
  })

  test('★ ③ 만들기만 있는 사람 — 행은 생기고 연결은 빠진다(연결하기는 내용 고치기를 묻는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.ok((await stopInheriting(w.boss.ctx, w.projects.id)).ok)
    assert.ok((await grantAccess(w.boss.ctx, w.projects.id, { type: 'user', id: w.boss.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(w.boss.ctx, w.projects.id, { type: 'workspace_everyone', id: null })).ok)
    assert.ok((await grantAccess(w.boss.ctx, w.projects.id, { type: 'user', id: w.maker.userId }, 'create')).ok)
    const row = await w.make(contains(w.toTasks, w.x), w.maker)
    assert.deepEqual(w.linked(row, w.toTasks), [])
    const stored = await withReadTransaction((tx) => readRow(tx, row.id))
    assert.ok(stored !== null, '행은 생겼다')
  })

  test('④ 채우지 않는 것 — 포함하지 않음 · 비어 있음 · 자식이 둘인 OR', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const none = await w.make(
      and(
        { property_id: w.toTasks, operator: 'does_not_contain', value: w.x },
        { property_id: w.owned, operator: 'is_empty' },
        { op: 'or', children: [contains(w.bundle.propertyId, w.x), contains(w.bundle.propertyId, w.y)] } as FilterNode,
      ),
    )
    for (const p of [w.toTasks, w.owned, w.bundle.propertyId]) assert.deepEqual(w.linked(none, p), [], p)
  })

  test('⑤ 하위 항목으로 만들 때도 — 상위 항목은 요청이 · 다른 relation 은 필터가', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const pair = unwrap(await enableSubItems(w.boss.ctx, w.projects.dataSourceId))
    const parent = unwrap(await createRow(w.boss.ctx, w.projects.dataSourceId, {})).id
    const other = unwrap(await createRow(w.boss.ctx, w.projects.dataSourceId, {})).id
    // 하위 항목 칸의 "포함" 을 이으면 다른 행이 새 행 밑으로 옮겨 온다 — 짝은 이 요청(상위 항목 = parent)이 정하므로 잇지 않는다
    const child = unwrap(
      await createSubItem(w.boss.ctx, w.projects.dataSourceId, parent, {
        viewFilter: and(contains(w.toTasks, w.y), contains(pair.childrenPropertyId, other)),
      }),
    )
    assert.deepEqual(w.linked(child, w.toTasks), [w.y], '필터의 relation')
    assert.deepEqual(w.linked(child, pair.parentPropertyId), [parent], '상위 항목은 요청이 정한다')
    assert.deepEqual(w.linked(child, pair.childrenPropertyId), [], '하위 항목 짝의 조건은 잇지 않는다 — 다른 행을 옮겨 오지 않는다')
  })
})
