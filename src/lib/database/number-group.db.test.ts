/**
 * 숫자 구간으로 묶기 — 서버 (그룹 버킷 트랙 B-2 · F-04-11, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] `view.group_by` 의 [보강 B-2]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹 목록은 데이터에서 — 행이 든 구간들 · **숫자 오름차순**(글자 순이 아니다) · 값 없음이 맨 앞 · 기본 크기 10 · 결과가 크기를 싣는다
 *   ② 소수 크기 — 키가 trim_scale 의 글자(22.5 · 25 · -5)
 *   ③ ★ 옮기면 구간 차이만큼 더한다 — 값이 없던 행은 아래 끝 · 값 없음 그룹은 비운다 · 빈 구간에도 놓는다 · 구간 키가 아니면 거부
 *   ④ 크기는 숫자 속성에만 · 0 보다 커야 한다
 *
 * ⚠ skip 은 테스트마다 `t.skip` 으로 건다(HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { createView, updateView } from './view.ts'
import { moveRow, queryGroups, type GroupsPage } from './group.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 점수(숫자) · 마감(날짜)이 있는 표와 그 표의 표 뷰(점수로 묶는다). `rows` 는 [제목, 점수] — null 이면 값 없음. */
async function table(rows: readonly (readonly [string, number | null])[]) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `숫자 그룹 ${Date.now()}` }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '점수', type: 'number' }))
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '마감', type: 'date' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const score = schema.properties.find((p) => p.name === '점수')!.id
  const due = schema.properties.find((p) => p.name === '마감')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const ids: Record<string, string> = {}
  for (const [title, n] of rows) {
    ids[title] = unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(n === null ? [] : [{ propertyId: score, value: { type: 'number' as const, number: n } }]),
        ],
      }),
    ).id
  }
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'table' }))
  unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: score } }))
  return { viewId: view.id, score, due, ids }
}

const shape = (page: GroupsPage) => page.groups.map((g) => [g.key, g.count, g.rows.map((r) => r.title).join('')])

describe('① 그룹 목록은 데이터에서', () => {
  test('★ 행이 든 구간들 — 숫자 오름차순 · 값 없음이 맨 앞 · 기본 크기 10 · 결과가 크기를 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', 23],
      ['나', 27],
      ['다', -5],
      ['라', null],
      ['마', 105],
    ])
    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.equal(page.propertyType, 'number')
    assert.equal(page.numberSize, 10)
    assert.equal(page.dateUnit, null)
    assert.deepEqual(shape(page), [
      ['', 1, '라'],
      ['-10', 1, '다'],
      ['20', 2, '가나'],
      ['100', 1, '마'],
    ], '글자 순(-10 · 100 · 20)이 아니라 숫자 순')
  })
})

describe('② 소수 크기', () => {
  test('키가 trim_scale 의 글자', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', 23],
      ['나', 25],
      ['다', -5],
    ])
    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.score, number_size: 2.5 } }))
    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.equal(page.numberSize, 2.5)
    assert.deepEqual(page.groups.map((x) => [x.key, x.count]), [['', 0], ['-5', 1], ['22.5', 1], ['25', 1]])
  })
})

describe('③ 옮기기', () => {
  test('★ 구간 차이만큼 더한다 · 값이 없던 행 · 값 없음 그룹 · 빈 구간 · 구간 키가 아니면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', 23],
      ['나', null],
    ])
    const numberOf = (r: { properties: Record<string, unknown> }) => (r.properties[g.score] as { number: number | null }).number

    const a = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['가']!, groupKey: '50' }))
    assert.equal(numberOf(a.row), 53, '구간 안의 자리(3)를 지킨다')
    const b = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '-30' }))
    assert.equal(numberOf(b.row), -30, '값이 없던 행은 아래 끝 — 행이 없는 구간에도 놓는다')
    const cleared = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['가']!, groupKey: '' }))
    assert.equal(numberOf(cleared.row), null, '값 없음 그룹은 비운다')
    assert.deepEqual(shape(unwrap(await queryGroups(fx.owner.ctx, g.viewId))), [
      ['', 1, '가'],
      ['-30', 1, '나'],
    ])

    const bad = await Promise.all([
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '25' }),
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '20.0' }),
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '스물' }),
    ])
    assert.deepEqual(bad.map((r) => (r.ok ? 'ok' : r.reason)), ['invalid_value', 'invalid_value', 'invalid_value'], '그 크기의 구간 키가 아니다')
  })
})

describe('④ 크기는 숫자 속성에만', () => {
  test('숫자가 아닌 속성 · 0 · 음수는 거부 · 저장하면 크기가 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([['가', 1]])
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, number_size: 5 } })).ok, false)
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.score, number_size: 0 } })).ok, false)
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.score, number_size: -5 } })).ok, false)
    const saved = unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.score, number_size: 0.5 } }))
    assert.deepEqual(saved.groupBy, { property_id: g.score, number_size: 0.5 })
  })
})
