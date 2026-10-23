/**
 * 상태와 오가는 타입 변환 — §7 정리 10n-24 (F-03-05 · F-03-14)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 프로퍼티 타입 바꾸기 ⑧
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 선택 → 상태 — 같은 옵션 id 가 모두 할 일에 · 칸은 봉투만 바뀐다 · 그룹 셋 · 기본은 첫 옵션 · 손실 없음
 *   ② ★ 상태 → 선택 — 그룹이 비고 그룹 행이 사라진다 · 같은 옵션 id · 기본이 사라져 새 행은 빈 값
 *   ③ 글 → 상태 — 이름마다 할 일의 옵션 · 옵션이 하나도 없으면 기본 셋
 *   ④ ★ 필터 — 선택 ↔ 상태는 두 타입에 다 있는 연산자의 규칙을 남기고 그룹 단위만 지운다 · 글 → 상태는 모두 지운다(⑤)
 *   ⑤ 되돌아와도 SG3 — 상태 → 선택 → 상태면 옵션이 다시 모두 할 일(그룹 없는 status 옵션이 없다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { convertProperty } from './property-convert.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import { getView, updateView } from './view.ts'
import type { FilterNode } from './filter.ts'

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

async function setup() {
  const ws = await createBareWorkspace('상태 변환')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `상태 변환 ${Date.now()}` }))
  const ds = db.dataSourceId
  const prop = async (name: string) => unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === name)!
  const add = async (name: string, type: 'select' | 'status' | 'rich_text') => {
    unwrap(await addProperty(boss.ctx, ds, { name, type }))
    return (await prop(name)).id
  }
  /** 그 속성의 옵션 — `이름:그룹` 차례대로. */
  const options = async (name: string) => ((await prop(name)).options ?? []).map((o) => `${o.name}:${o.group ?? '-'}`)
  const groupRows = async (propertyId: string) => Number((await query<{ n: string }>(`SELECT count(*) AS n FROM status_group WHERE property_id = $1`, [propertyId]))[0]!.n)
  const config = async (propertyId: string) => (await query<{ config: Record<string, unknown> | null }>(`SELECT config FROM property WHERE id = $1`, [propertyId]))[0]!.config
  const cellOf = async (rowId: string, propertyId: string) =>
    (unwrap(await queryRows(boss.ctx, ds, {})).rows.find((r) => r.id === rowId)!.properties[propertyId] ?? null) as Record<string, unknown> | null
  const setFilter = async (filter: FilterNode) => unwrap(await updateView(boss.ctx, db.defaultViewId, { filter }))
  const filterOf = async () => unwrap(await getView(boss.ctx, db.defaultViewId)).filter
  return { boss, db, ds, prop, add, options, groupRows, config, cellOf, setFilter, filterOf }
}

describe('상태와 오가는 타입 변환 (10n-24)', () => {
  test('★ ① 선택 → 상태 — 같은 옵션이 모두 할 일에 · 칸은 봉투만 · 기본은 첫 옵션', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const stage = await s.add('단계', 'select')
    const ids = [] as string[]
    for (const name of ['가', '나', '다']) ids.push(unwrap(await addSelectOption(s.boss.ctx, s.ds, stage, { name })).option.id)
    const r1 = unwrap(await createRow(s.boss.ctx, s.ds, { cells: [{ propertyId: stage, value: { type: 'select', select: { id: ids[1]! } } }] })).id

    const done = unwrap(await convertProperty(s.boss.ctx, s.ds, stage, { type: 'status' }))
    assert.deepEqual([done.converted, done.lost], [1, 0], '손실 없음')
    assert.equal((await s.prop('단계')).type, 'status')
    assert.deepEqual(await s.options('단계'), ['가:todo', '나:todo', '다:todo'], '모두 할 일 — 차례 그대로')
    assert.deepEqual(((await s.prop('단계')).options ?? []).map((o) => o.id), ids, '같은 옵션 id')
    assert.equal(await s.groupRows(stage), 3, '그룹 셋')
    assert.deepEqual(await s.cellOf(r1, stage), { type: 'status', status: { id: ids[1] } }, '봉투만 바뀐다')
    assert.deepEqual(await s.config(stage), { default_option_id: ids[0] }, '기본은 첫 옵션')
  })

  test('★ ② 상태 → 선택 — 그룹이 비고 그룹 행이 사라진다 · 기본이 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const progress = await s.add('진행', 'status')
    const doing = ((await s.prop('진행')).options ?? []).find((o) => o.name === '진행 중')!.id
    const r1 = unwrap(await createRow(s.boss.ctx, s.ds, { cells: [{ propertyId: progress, value: { type: 'status', status: { id: doing } } }] })).id

    unwrap(await convertProperty(s.boss.ctx, s.ds, progress, { type: 'select' }))
    assert.deepEqual(await s.options('진행'), ['시작 전:-', '진행 중:-', '완료:-'], '그룹이 빈다 — 옵션은 남는다')
    assert.equal(await s.groupRows(progress), 0, '그룹 행이 사라진다')
    assert.deepEqual(await s.cellOf(r1, progress), { type: 'select', select: { id: doing } })
    assert.deepEqual(await s.config(progress), {}, '기본이 사라진다')
    const fresh = unwrap(await createRow(s.boss.ctx, s.ds, {})).id
    assert.equal(await s.cellOf(fresh, progress), null, '새 행은 빈 값')
  })

  test('③ 글 → 상태 — 이름마다 할 일의 옵션 · 옵션이 없으면 기본 셋', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const memo = await s.add('메모', 'rich_text')
    const blank = await s.add('빈칸', 'rich_text')
    for (const text of ['검토', '보류', '검토']) {
      unwrap(await createRow(s.boss.ctx, s.ds, { cells: [{ propertyId: memo, value: { type: 'rich_text', rich_text: [textRun(text)] } }] }))
    }
    unwrap(await convertProperty(s.boss.ctx, s.ds, memo, { type: 'status' }))
    assert.deepEqual(await s.options('메모'), ['검토:todo', '보류:todo'])
    const first = ((await s.prop('메모')).options ?? [])[0]!.id
    assert.deepEqual(await s.config(memo), { default_option_id: first })

    unwrap(await convertProperty(s.boss.ctx, s.ds, blank, { type: 'status' }))
    assert.deepEqual(await s.options('빈칸'), ['시작 전:todo', '진행 중:in_progress', '완료:complete'], '옵션이 없으면 새 상태 속성처럼')
  })

  test('★ ④ 필터 — 선택 ↔ 상태는 두 타입에 다 있는 규칙을 남기고 그룹 단위만 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const stage = await s.add('단계', 'select')
    const a = unwrap(await addSelectOption(s.boss.ctx, s.ds, stage, { name: '가' })).option.id
    const memo = await s.add('메모', 'rich_text')
    await s.setFilter({ op: 'and', children: [
      { property_id: stage, operator: 'equals', value: a },
      { property_id: stage, operator: 'is_not_empty' },
      { property_id: memo, operator: 'contains', value: '검' },
    ] } as FilterNode)

    const toStatus = unwrap(await convertProperty(s.boss.ctx, s.ds, stage, { type: 'status' }))
    assert.equal(toStatus.filtersRemoved, 0, '선택 → 상태 — 다 남는다')

    const both = await s.filterOf()
    await s.setFilter({ op: 'and', children: [...((both as { children: FilterNode[] }).children), { property_id: stage, operator: 'group_is', value: 'todo' }] } as FilterNode)
    const toSelect = unwrap(await convertProperty(s.boss.ctx, s.ds, stage, { type: 'select' }))
    assert.equal(toSelect.filtersRemoved, 1, '상태 → 선택 — 그룹 단위만 지운다')
    const left = ((await s.filterOf()) as { children: { property_id: string; operator: string }[] }).children
    assert.deepEqual(left.map((l) => l.operator), ['equals', 'is_not_empty', 'contains'])

    const memoToStatus = unwrap(await convertProperty(s.boss.ctx, s.ds, memo, { type: 'status' }))
    assert.equal(memoToStatus.filtersRemoved, 1, '글 → 상태 — 그 속성의 규칙은 지운다(⑤)')
  })

  test('⑤ 되돌아와도 SG3 — 상태 → 선택 → 상태면 옵션이 다시 모두 할 일', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const progress = await s.add('진행', 'status')
    const ids = ((await s.prop('진행')).options ?? []).map((o) => o.id)
    unwrap(await convertProperty(s.boss.ctx, s.ds, progress, { type: 'select' }))
    unwrap(await convertProperty(s.boss.ctx, s.ds, progress, { type: 'status' }))
    assert.deepEqual(await s.options('진행'), ['시작 전:todo', '진행 중:todo', '완료:todo'], '그룹을 기억하지 않는다')
    assert.deepEqual(((await s.prop('진행')).options ?? []).map((o) => o.id), ids, '같은 옵션 id')
    const loose = await query<{ n: string }>(`SELECT count(*) AS n FROM select_option WHERE property_id = $1 AND group_id IS NULL`, [progress])
    assert.equal(Number(loose[0]!.n), 0, '그룹 없는 status 옵션이 없다')
    assert.equal(await s.groupRows(progress), 3)
  })
})
