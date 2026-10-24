/**
 * rollup 의 나머지 함수 11종 — §7 정리 10n-32 (F-03-11)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 — [보강 10n-32] 나머지 함수 11종
 *
 * 함수의 값 자체는 `rollup-functions.test.ts` 가 DB 없이 본다. 여기는 **실제 경로**다 — 만들기 · 고치기의 검사가 새 함수를 받고(타입이
 * 맞을 때만), 읽기(`computeRollups`)가 연결 행의 칸을 모아 새 함수로 집계하는가.
 *
 *   ① ★ 숫자 — 중앙값으로 만들고 범위로 고친다
 *   ② ★ 글 — 고유 값 보기 · 고유 값 개수 · 빈 칸 비율(빈 칸이 있는 연결도 센다)
 *   ③ ★ 날짜 범위 · 체크 안 된 비율
 *   ④ 타입에 맞지 않으면 만들기도 고치기도 거부한다 — 날짜 범위 × 숫자 · 중앙값 × 글
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { addRollupProperty, computeRollups, updateRollupProperty } from './rollup.ts'
import type { RollupFunction } from './rollup-functions.ts'
import type { CellValue } from './property-types.ts'
import { textRun } from '../contracts/rich-text.ts'

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

const num = (n: number | null): CellValue => ({ type: 'number', number: n })
const box = (b: boolean): CellValue => ({ type: 'checkbox', checkbox: b })
const day = (start: string | null): CellValue => ({ type: 'date', date: start === null ? null : { start } })
const text = (s: string): CellValue => ({ type: 'rich_text', rich_text: s === '' ? [] : [textRun(s)] })

/** 프로젝트 ← 작업 넷(시간 · 메모 · 마감 · 끝남). 프로젝트의 rollup 은 "작업들" 을 타고 작업의 칸을 모은다. */
async function world() {
  const ws = await createBareWorkspace('롤업 나머지 함수')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const tasks = unwrap(await createDatabase(boss.ctx, { name: `작업 ${Date.now()}` }))
  const projects = unwrap(await createDatabase(boss.ctx, { name: `프로젝트 ${Date.now()}` }))
  const prop = async (name: string, type: 'number' | 'checkbox' | 'rich_text' | 'date') => {
    unwrap(await addProperty(boss.ctx, tasks.dataSourceId, { name, type }))
    return unwrap(await getSchema(boss.ctx, tasks.dataSourceId)).properties.find((p) => p.name === name)!.id
  }
  const hours = await prop('시간', 'number')
  const memo = await prop('메모', 'rich_text')
  const due = await prop('마감', 'date')
  const done = await prop('끝남', 'checkbox')
  const made = unwrap(await addRelationProperty(boss.ctx, tasks.dataSourceId, { name: '프로젝트', targetDataSourceId: projects.dataSourceId, twoWay: { name: '작업들' } }))
  const project = unwrap(await createRow(boss.ctx, projects.dataSourceId, {})).id
  const rows: readonly (readonly [CellValue, CellValue, CellValue, CellValue])[] = [
    [num(1), text('가'), day('2026-01-05'), box(true)],
    [num(10), text('나'), day('2026-01-25'), box(false)],
    [num(null), text('가'), day(null), box(false)],
    [num(2), text(''), day('2026-01-15'), box(true)],
  ]
  for (const [h, m, d, b] of rows) {
    const task = unwrap(await createRow(boss.ctx, tasks.dataSourceId, { cells: [
      { propertyId: hours, value: h },
      { propertyId: memo, value: m },
      { propertyId: due, value: d },
      { propertyId: done, value: b },
    ] })).id
    unwrap(await linkRows(boss.ctx, task, made.propertyId, { add: [project] }))
  }
  const add = (targetPropertyId: string, fn: RollupFunction | string) =>
    addRollupProperty(boss.ctx, projects.dataSourceId, {
      name: `${fn} ${Math.random()}`, relationPropertyId: made.syncedPropertyId!, targetPropertyId, function: fn as RollupFunction,
    })
  const result = async (rollup: string) => {
    const cell = unwrap(await computeRollups(boss.ctx, projects.dataSourceId, [project])).values[project]?.[rollup]
    return cell?.state === 'ok' ? cell.result : cell
  }
  const update = (rollup: string, input: Parameters<typeof updateRollupProperty>[3]) => updateRollupProperty(boss.ctx, projects.dataSourceId, rollup, input)
  return { hours, memo, due, done, add, result, update }
}

describe('rollup 의 나머지 함수 (10n-32)', () => {
  test('★ ① 숫자 — 중앙값으로 만들고 범위로 고친다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const rollup = unwrap(await w.add(w.hours, 'median')).propertyId
    assert.deepEqual(await w.result(rollup), { kind: 'number', number: 2 }, '1 · 2 · 10 의 가운데(빈 칸은 무시)')
    unwrap(await w.update(rollup, { function: 'range' }))
    assert.deepEqual(await w.result(rollup), { kind: 'number', number: 9 }, '10 − 1')
  })

  test('★ ② 글 — 고유 값 보기 · 고유 값 개수 · 빈 칸 비율', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const shown = await w.result(unwrap(await w.add(w.memo, 'show_unique')).propertyId)
    assert.deepEqual(shown, { kind: 'values', values: [text('가'), text('나')], count: 2 }, '처음 나온 순서 · 두 번째 "가" 와 빈 칸은 빠진다')
    assert.deepEqual(await w.result(unwrap(await w.add(w.memo, 'unique')).propertyId), { kind: 'number', number: 2 })
    assert.deepEqual(await w.result(unwrap(await w.add(w.memo, 'percent_empty')).propertyId), { kind: 'percent', percent: 0.25 }, '넷 중 하나가 빈 칸')
  })

  test('★ ③ 날짜 범위 · 체크 안 된 비율', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.result(unwrap(await w.add(w.due, 'date_range')).propertyId), { kind: 'days', days: 20 }, '01-05 ~ 01-25')
    assert.deepEqual(await w.result(unwrap(await w.add(w.done, 'percent_unchecked')).propertyId), { kind: 'percent', percent: 0.5 })
  })

  test('④ 타입에 맞지 않으면 만들기도 고치기도 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.equal(reasonOf(await w.add(w.hours, 'date_range')), 'invalid_config', '날짜 범위 × 숫자')
    assert.equal(reasonOf(await w.add(w.memo, 'median')), 'invalid_config', '중앙값 × 글')
    const rollup = unwrap(await w.add(w.memo, 'count')).propertyId
    assert.equal(reasonOf(await w.update(rollup, { function: 'percent_unchecked' })), 'invalid_config', '체크 안 된 비율 × 글')
    assert.deepEqual(await w.result(rollup), { kind: 'number', number: 4 }, '그대로')
  })
})
