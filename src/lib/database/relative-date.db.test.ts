/**
 * 상대 날짜로 거르기 — 상대 날짜 필터 트랙 R-1 (04 F-04-09 · 03 F-03-17)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 R-1] 상대 날짜로 거르기 · 0116
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 연산자 일곱이 보는 사람의 오늘에서 편 범위의 행만 — 양 끝 포함 · 날짜 없는 행은 어디에도 없다
 *   ② ★ 오늘은 컨텍스트의 것 — 같은 필터도 오늘이 하루 다르면 다른 행 · 열 집계도 같은 행을 센다 · 넘기지 않으면 UTC 의 오늘
 *   ③ ★ 자동화의 조건도 상대 날짜를 받는다(A-1 — 저장한 사람의 시간대로 · 판정은 automation-relative.db.test.ts)
 *   ④ 카탈로그 — 날짜의 일곱 · 값 없음 · 비어 있지 않음 뒤에
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { queryRows } from './query.ts'
import { computeCalculations } from './calculate.ts'
import { validateFilter, type FilterNode } from './filter.ts'
import { readOperatorCatalog } from './operator-catalog.ts'
import { RELATIVE_DATE_OPERATORS, type RelativeDateOperator } from './relative-date.ts'
import { todayIn } from './date-group.ts'
import { createDbAutomation } from '../automation/db-automation.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const TODAY = '2026-03-18' // 수요일

/** 이름 → 날짜. 오늘(2026-03-18 수)에서 각 범위의 경계 안팎 · 날짜 없는 행 하나. */
const DATED: readonly (readonly [string, string | null])[] = [
  ['일년하루전', '2025-03-17'],
  ['일년전', '2025-03-18'],
  ['한달하루전', '2026-02-17'],
  ['한달전', '2026-02-18'],
  ['여드레전', '2026-03-10'],
  ['이레전', '2026-03-11'],
  ['이번월', '2026-03-16'],
  ['오늘', '2026-03-18'],
  ['이번일', '2026-03-22'],
  ['다음월', '2026-03-23'],
  ['이레뒤', '2026-03-25'],
  ['여드레뒤', '2026-03-26'],
  ['한달뒤', '2026-04-18'],
  ['한달하루뒤', '2026-04-19'],
  ['일년뒤', '2027-03-18'],
  ['일년하루뒤', '2027-03-19'],
  ['날짜없음', null],
]

async function world() {
  const made = unwrap(await createDatabase(fx.owner.ctx, { name: `상대 날짜 ${Date.now()}` }))
  const ds = made.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const due = unwrap(await addProperty(fx.owner.ctx, ds, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
  for (const [title, date] of DATED) {
    unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(date === null ? [] : [{ propertyId: due, value: { type: 'date' as const, date: { start: date } } }]),
        ],
      }),
    )
  }
  const titles = async (operator: RelativeDateOperator, today: string | null) => {
    const page = unwrap(await queryRows(fx.owner.ctx, ds, { filter: { property_id: due, operator }, limit: 100, ...(today === null ? {} : { today }) }))
    return page.rows.map((r) => r.title).sort()
  }
  return { ds, titleId, due, titles }
}

const sorted = (names: readonly string[]) => [...names].sort()

describe('① 연산자 일곱', () => {
  test('★ 보는 사람의 오늘(2026-03-18 수)에서 편 범위의 행만 — 양 끝 포함 · 날짜 없는 행은 어디에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const expected: Record<RelativeDateOperator, readonly string[]> = {
      past_week: ['이레전', '이번월', '오늘'],
      past_month: ['한달전', '여드레전', '이레전', '이번월', '오늘'],
      past_year: ['일년전', '한달하루전', '한달전', '여드레전', '이레전', '이번월', '오늘'],
      this_week: ['이번월', '오늘', '이번일'],
      next_week: ['오늘', '이번일', '다음월', '이레뒤'],
      next_month: ['오늘', '이번일', '다음월', '이레뒤', '여드레뒤', '한달뒤'],
      next_year: ['오늘', '이번일', '다음월', '이레뒤', '여드레뒤', '한달뒤', '한달하루뒤', '일년뒤'],
    }
    for (const operator of RELATIVE_DATE_OPERATORS) {
      assert.deepEqual(await w.titles(operator, TODAY), sorted(expected[operator]), operator)
    }
  })
})

describe('② 오늘은 컨텍스트의 것', () => {
  test('★ 오늘이 하루 다르면 다른 행 — 2026-03-19 의 지난 1주는 이레전(3/11)을 뺀다 · 이번 주는 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    assert.deepEqual(await w.titles('past_week', '2026-03-19'), sorted(['이번월', '오늘']))
    assert.deepEqual(await w.titles('this_week', '2026-03-22'), sorted(['이번월', '오늘', '이번일']), '일요일도 그 주')
    assert.deepEqual(await w.titles('this_week', '2026-03-23'), sorted(['다음월', '이레뒤', '여드레뒤']), '다음 월요일이면 다음 주(3/23 ~ 3/29)')
  })

  test('★ 열 집계도 같은 오늘로 센다 — 표에 보이는 행과 같은 수', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const filter: FilterNode = { property_id: w.due, operator: 'next_week' }
    const count = async (today: string) =>
      (await computeCalculations(fx.owner.ctx, w.ds, filter, [{ propertyId: w.titleId, type: 'title', calculation: 'count_all' }], null, today))[w.titleId]
    assert.deepEqual(await count(TODAY), { kind: 'count', value: 4 })
    assert.deepEqual(await count('2026-03-26'), { kind: 'count', value: 1 }, '3/26 ~ 4/2 — 여드레뒤 하나')
  })

  test('넘기지 않으면 UTC 의 오늘 — 오늘 쓴 행은 지난 1주 안에 든다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const made = unwrap(await createDatabase(fx.owner.ctx, { name: `상대 날짜 UTC ${Date.now()}` }))
    const titleId = unwrap(await getSchema(fx.owner.ctx, made.dataSourceId)).properties.find((p) => p.type === 'title')!.id
    const due = unwrap(await addProperty(fx.owner.ctx, made.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
    unwrap(
      await createRow(fx.owner.ctx, made.dataSourceId, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun('지금')] } },
          { propertyId: due, value: { type: 'date', date: { start: todayIn('UTC') } } },
        ],
      }),
    )
    const page = unwrap(await queryRows(fx.owner.ctx, made.dataSourceId, { filter: { property_id: due, operator: 'past_week' } }))
    assert.deepEqual(page.rows.map((r) => r.title), ['지금'])
  })
})

describe('③ 자동화의 조건', () => {
  test('★ 상대 날짜도 받는다(A-1) — 저장한 사람의 시간대로 판정한다(처음엔 받지 않았다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world()
    const condition = { property_id: w.due, operator: 'next_week' }
    assert.deepEqual(validateFilter(condition, new Map([[w.due, 'date']])), [], '보기의 필터로는 맞다 — 값이 없는 연산자')
    const r = await createDbAutomation(fx.owner.ctx, w.ds, {
      name: '다음 주 마감',
      triggers: [{ type: 'property_edited', propertyId: w.due, condition }],
      actions: [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: w.titleId, value: { type: 'title', title: [textRun('곧')] } }] } }],
      timeZone: 'Asia/Seoul',
    })
    assert.equal(r.ok, true, JSON.stringify(r))
  })
})

describe('④ 카탈로그', () => {
  test('날짜의 일곱 — 값 없음 · 비어 있지 않음 뒤에 · 화면의 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const date = (await readOperatorCatalog()).filter((e) => e.propertyType === 'date')
    assert.deepEqual(
      date.slice(-8).map((e) => [e.operator, e.arity, e.label]),
      [
        ['is_not_empty', 0, '비어 있지 않음'],
        ['past_week', 0, '지난 1주 안'],
        ['past_month', 0, '지난 1개월 안'],
        ['past_year', 0, '지난 1년 안'],
        ['this_week', 0, '이번 주'],
        ['next_week', 0, '다음 1주 안'],
        ['next_month', 0, '다음 1개월 안'],
        ['next_year', 0, '다음 1년 안'],
      ],
    )
  })
})
