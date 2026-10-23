/**
 * 보드의 status 범주(그룹) 단위 열 — §7 정리 10n-27 (F-03-05 · F-04-11)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] `view.group_by` — status 의 범주(그룹) 단위 열
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 열은 '' · 할 일 · 진행 중 · 완료 — 카운트 · 카드가 옵션의 그룹으로 모인다 · 열마다 받을 옵션(기본이 그 범주면 그것, 아니면 첫 옵션)
 *   ② ★ 범주 열로 옮기면 그 옵션을 받는다 — 기본 옵션이 그 범주면 그것 · 이미 그 범주면 셀을 건드리지 않는다 · '' 열은 빈 값
 *   ③ ★ 옵션이 없는 범주 — 열은 서고(받을 옵션 없음) 놓을 수 없다(`invalid_value`)
 *   ④ 자리 — 열 안 순서는 그룹 kind 를 키로 `row_position` 에 남는다
 *   ⑤ 검증 — status 가 아닌 속성 · 'group' 이 아닌 값은 거부 · 단위를 빼면 옵션 열로 돌아온다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteSelectOption, getSchema, updateProperty } from './property.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import { createView, updateView } from './view.ts'
import { moveRow, queryGroups } from './group.ts'

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

/** 표 하나 — 진행(status · 시작 전 · 진행 중 · 검토(진행 중) · 완료 · 보류(완료)) · 카드 다섯 · 범주 단위 보드. */
async function setup() {
  const ws = await createBareWorkspace('범주 보드')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `범주 보드 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '진행', type: 'status' }))
  const progress = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === '진행')!.id
  unwrap(await addSelectOption(boss.ctx, ds, progress, { name: '검토', group: 'in_progress' }))
  unwrap(await addSelectOption(boss.ctx, ds, progress, { name: '보류', group: 'complete' }))
  const options = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === progress)!.options!
  const opt = (name: string) => options.find((o) => o.name === name)!.id
  const mk = async (name: string | null) =>
    unwrap(await createRow(boss.ctx, ds, { cells: [{ propertyId: progress, value: { type: 'status', status: name === null ? null : { id: opt(name) } } }] })).id
  const rows = { a: await mk('시작 전'), b: await mk('진행 중'), c: await mk('검토'), d: await mk('완료'), e: await mk(null) }
  const nameOf = new Map(Object.entries(rows).map(([k, v]) => [v, k]))
  const board = unwrap(await createView(boss.ctx, db.id, { type: 'board', groupBy: { property_id: progress, status_by: 'group' } as never })).id
  const groups = async () => unwrap(await queryGroups(boss.ctx, board))
  /** 열마다 `키:카드들` — 카드는 이름 순. */
  const columns = async () =>
    (await groups()).groups.map((g) => `${g.key || '없음'}:${g.rows.map((r) => nameOf.get(r.id) ?? '?').sort().join('')}`).join(' · ')
  const cellOf = async (rowId: string) => {
    const row = unwrap(await queryRows(boss.ctx, ds, {})).rows.find((r) => r.id === rowId)!
    return ((row.properties[progress] as { status?: { id?: string } | null } | undefined)?.status?.id ?? null)
  }
  const versionOf = async (rowId: string) => (await query<{ v: string }>(`SELECT version::text AS v FROM block WHERE id = $1`, [rowId]))[0]!.v
  return { boss, db, ds, progress, opt, rows, board, groups, columns, cellOf, versionOf }
}

describe('보드의 status 범주 단위 열 (10n-27)', () => {
  test('★ ① 열은 없음 · 할 일 · 진행 중 · 완료 — 카드가 옵션의 그룹으로 모인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const page = await s.groups()
    assert.equal(page.statusBy, 'group')
    assert.equal(await s.columns(), '없음:e · todo:a · in_progress:bc · complete:d')
    assert.deepEqual(page.groups.map((g) => [g.key, g.statusGroup, g.count]), [['', null, 1], ['todo', 'todo', 1], ['in_progress', 'in_progress', 2], ['complete', 'complete', 1]])
    assert.deepEqual(page.groups.map((g) => g.fillOptionId), [null, s.opt('시작 전'), s.opt('진행 중'), s.opt('완료')], '받을 옵션 — 기본(시작 전)이 할 일 · 나머지는 첫 옵션')
  })

  test('★ ② 범주 열로 옮기면 그 옵션을 받는다 — 기본이 그 범주면 기본 · 이미 그 범주면 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const moved = unwrap(await moveRow(s.boss.ctx, s.board, { rowId: s.rows.a, groupKey: 'complete' }))
    assert.equal(moved.groupKey, 'complete')
    assert.equal(await s.cellOf(s.rows.a), s.opt('완료'), '첫 옵션(기본은 할 일이라)')

    unwrap(await updateProperty(s.boss.ctx, s.ds, s.progress, { defaultOptionId: s.opt('보류') }))
    unwrap(await moveRow(s.boss.ctx, s.board, { rowId: s.rows.b, groupKey: 'complete' }))
    assert.equal(await s.cellOf(s.rows.b), s.opt('보류'), '기본이 그 범주면 기본')

    const before = await s.versionOf(s.rows.c)
    unwrap(await moveRow(s.boss.ctx, s.board, { rowId: s.rows.c, groupKey: 'in_progress' }))
    assert.equal(await s.cellOf(s.rows.c), s.opt('검토'), '이미 그 범주 — 같은 범주의 다른 옵션으로 바꾸지 않는다')
    assert.equal(await s.versionOf(s.rows.c), before, '셀을 건드리지 않는다')

    unwrap(await moveRow(s.boss.ctx, s.board, { rowId: s.rows.d, groupKey: '' }))
    assert.equal(await s.cellOf(s.rows.d), null, '없음 열은 빈 값')
    assert.equal(await s.columns(), '없음:de · todo: · in_progress:c · complete:ab')
  })

  test('★ ③ 옵션이 없는 범주 — 열은 서고 놓을 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    unwrap(await deleteSelectOption(s.boss.ctx, s.ds, s.progress, s.opt('완료')))
    unwrap(await deleteSelectOption(s.boss.ctx, s.ds, s.progress, s.opt('보류')))
    const complete = (await s.groups()).groups.find((g) => g.key === 'complete')!
    assert.deepEqual([complete.count, complete.fillOptionId], [0, null], '열은 서고 받을 옵션이 없다')
    assert.equal(reasonOf(await moveRow(s.boss.ctx, s.board, { rowId: s.rows.a, groupKey: 'complete' })), 'invalid_value')
    assert.equal(await s.cellOf(s.rows.a), s.opt('시작 전'), '그대로')
  })

  test('④ 자리 — 열 안 순서가 그룹 kind 를 키로 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    unwrap(await moveRow(s.boss.ctx, s.board, { rowId: s.rows.c, groupKey: 'in_progress', beforeRowId: s.rows.b }))
    const order = (await s.groups()).groups.find((g) => g.key === 'in_progress')!.rows.map((r) => r.id)
    assert.deepEqual(order, [s.rows.c, s.rows.b], '검토가 진행 중 앞으로')
    const keys = await query<{ group_key: string }>(`SELECT DISTINCT group_key FROM row_position WHERE view_id = $1`, [s.board])
    assert.deepEqual(keys.map((k) => k.group_key), ['in_progress'])
  })

  test('⑤ 검증 — status 가 아닌 속성 · 다른 값은 거부 · 단위를 빼면 옵션 열', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    unwrap(await addProperty(s.boss.ctx, s.ds, { name: '단계', type: 'select' }))
    const stage = unwrap(await getSchema(s.boss.ctx, s.ds)).properties.find((p) => p.name === '단계')!.id
    assert.notEqual(reasonOf(await updateView(s.boss.ctx, s.board, { groupBy: { property_id: stage, status_by: 'group' } as never })), 'ok', 'select 속성')
    assert.notEqual(reasonOf(await updateView(s.boss.ctx, s.board, { groupBy: { property_id: s.progress, status_by: 'option' } as never })), 'ok', "'group' 이 아닌 값")

    unwrap(await updateView(s.boss.ctx, s.board, { groupBy: { property_id: s.progress } }))
    const page = await s.groups()
    assert.equal(page.statusBy, 'option')
    assert.deepEqual(page.groups.map((g) => g.key), ['', s.opt('시작 전'), s.opt('진행 중'), s.opt('검토'), s.opt('완료'), s.opt('보류')], '옵션 열로 돌아온다')
    assert.ok(page.groups.every((g) => g.statusGroup === null))
  })
})
