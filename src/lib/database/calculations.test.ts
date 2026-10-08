/**
 * 열 집계의 함수 — 목록 · 타입별 허용 · 결과 · 글자 (DB 심화 2d-1조각 · F-04-16 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 타입마다 고를 수 있는 함수 — 숫자는 합 · 평균 …, 날짜는 이른 날 …, 체크박스는 세기 계열 대신 체크 계열
 *   ② ★ 0 과 빈 값을 가른다 — 세기 · 합은 0, 평균 · 중앙값 · 최소 · 최대 · 날짜는 빈 값, 비율은 행이 0개면 빈 값
 *   ③ 비율 · 범위 · 기간 · 빈 칸 세기가 통계에서 맞게 나온다
 *   ④ 글자 — 빈 값은 `—` · 비율은 % · 기간은 일
 *   ⑤ 저장 CHECK(0054 · 0055 의 `is_calculation_name`)과 같은 목록
 *   ⑥ 고를 수 있는가(`canCalculate` — 셀 타입이 아니면 아무것도) · 그룹 머리에서 속성을 고르면 붙는 함수(2d-3)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CALCULATIONS,
  calculationResult,
  calculationsFor,
  canCalculate,
  defaultCalculationFor,
  formatCalculation,
  type ColumnStats,
} from './calculations.ts'
import { MVP_PROPERTY_TYPES } from './property-types.ts'

const stats = (over: Partial<ColumnStats>): ColumnStats => ({
  total: 0, filled: 0, distinct: 0, sum: null, avg: null, median: null, min: null, max: null, dateMin: null, dateMax: null, checked: 0,
  ...over,
})

describe('① 타입마다', () => {
  test('숫자 · 날짜 · 체크박스 · 그 밖', () => {
    assert.ok(calculationsFor('number').includes('sum') && calculationsFor('number').includes('median'))
    assert.ok(!calculationsFor('rich_text').includes('sum'))
    assert.ok(calculationsFor('date').includes('date_range') && !calculationsFor('date').includes('sum'))
    assert.deepEqual(calculationsFor('checkbox'), ['count_all', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'])
    assert.ok(calculationsFor('select').includes('count_unique'))
  })
})

describe('② 0 과 빈 값', () => {
  test('★ 행이 0개 — 세기 · 합은 0, 평균 · 최소 · 날짜는 빈 값, 비율은 빈 값', () => {
    const empty = stats({})
    assert.deepEqual(calculationResult('count_all', empty), { kind: 'count', value: 0 })
    assert.deepEqual(calculationResult('sum', empty), { kind: 'number', value: 0 })
    assert.deepEqual(calculationResult('average', empty), { kind: 'number', value: null })
    assert.deepEqual(calculationResult('min', empty), { kind: 'number', value: null })
    assert.deepEqual(calculationResult('range', empty), { kind: 'number', value: null })
    assert.deepEqual(calculationResult('earliest_date', empty), { kind: 'date', value: null })
    assert.deepEqual(calculationResult('percent_not_empty', empty), { kind: 'percent', value: null })
    assert.deepEqual(calculationResult('percent_checked', empty), { kind: 'percent', value: null })
  })

  test('값이 전부 비어 있으면 평균은 0 이 아니라 빈 값', () => {
    assert.deepEqual(calculationResult('average', stats({ total: 3 })), { kind: 'number', value: null })
  })
})

describe('③ 통계에서', () => {
  test('비율 · 범위 · 기간 · 빈 칸 세기 · 체크 안 됨', () => {
    const s = stats({ total: 4, filled: 3, min: 10, max: 30, checked: 1, dateMin: '2026-03-01T00:00:00.000Z', dateMax: '2026-03-11T00:00:00.000Z' })
    assert.deepEqual(calculationResult('count_empty', s), { kind: 'count', value: 1 })
    assert.deepEqual(calculationResult('percent_empty', s), { kind: 'percent', value: 25 })
    assert.deepEqual(calculationResult('range', s), { kind: 'number', value: 20 })
    assert.deepEqual(calculationResult('date_range', s), { kind: 'days', value: 10 })
    assert.deepEqual(calculationResult('unchecked', s), { kind: 'count', value: 3 })
  })
})

describe('④ 글자', () => {
  test('빈 값은 — · 비율은 % · 기간은 일 · 날짜는 날만', () => {
    assert.equal(formatCalculation({ kind: 'number', value: null }), '—')
    assert.equal(formatCalculation({ kind: 'count', value: 1234 }), '1,234')
    assert.equal(formatCalculation({ kind: 'percent', value: 33.333 }), '33.3%')
    assert.equal(formatCalculation({ kind: 'days', value: 10 }), '10일')
    assert.equal(formatCalculation({ kind: 'date', value: '2026-03-01T00:00:00.000Z' }), '2026-03-01')
    assert.equal(formatCalculation({ kind: 'number', value: 1.23456 }), '1.23')
  })
})

describe('⑤ 저장 CHECK 과 같은 목록', () => {
  test('마이그레이션 0054 의 이름들과 같다', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0054_view_calculation.sql', import.meta.url), 'utf8')
    const inSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    assert.deepEqual([...inSql].sort(), [...CALCULATIONS].sort())
  })

  test('0055 의 `is_calculation_name` 의 이름들과 같다 — 지금 두 CHECK 이 보는 목록', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0055_group_calculation.sql', import.meta.url), 'utf8')
    const body = sql.slice(sql.indexOf('CREATE FUNCTION is_calculation_name'), sql.indexOf('$$;'))
    const inSql = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    assert.deepEqual([...inSql].sort(), [...CALCULATIONS].sort())
  })
})

describe('⑥ 고를 수 있는가 · 기본 함수', () => {
  test('canCalculate — 타입의 목록 안에서만 · 셀 타입이 아니면 아무것도', () => {
    assert.equal(canCalculate('number', 'sum'), true)
    assert.equal(canCalculate('select', 'sum'), false)
    assert.equal(canCalculate('checkbox', 'count_values'), false, '체크박스에는 빈 값이 없다')
    assert.equal(canCalculate('relation', 'count_all'), false)
    assert.equal(canCalculate('unique_id', 'count_all'), false)
  })

  test('defaultCalculationFor — 카드 수와 다른 것 · 그 타입이 고를 수 있는 것', () => {
    assert.equal(defaultCalculationFor('number'), 'sum')
    assert.equal(defaultCalculationFor('date'), 'latest_date')
    assert.equal(defaultCalculationFor('checkbox'), 'percent_checked')
    assert.equal(defaultCalculationFor('select'), 'count_values')
    for (const type of MVP_PROPERTY_TYPES) {
      const fn = defaultCalculationFor(type)
      assert.ok(canCalculate(type, fn), `${type} → ${fn}`)
      assert.notEqual(fn, 'count_all', `${type} 의 기본이 카드 수와 같다`)
    }
  })
})
