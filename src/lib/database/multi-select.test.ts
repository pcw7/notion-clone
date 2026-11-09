/**
 * 다중 선택 속성 — 값 계약 · 필터 · 정렬 · 글자 · 집계 (순수) — PT-1조각 (F-03-03 · F-03-04 · F-03-08)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 PT-1] ① ③ ④
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 값 검증 — 고른 차례의 `{id}` 배열 · 같은 옵션 두 번 · 101개 · 모양이 틀린 값은 거부한다
 *   ② ★ 필터 — 포함은 값의 jsonb 포함 연산 · 포함하지 않음은 `NOT EXISTS`(칸이 없는 행도 맞는다) · 값은 옵션 id(uuid)
 *   ③ ★ 정렬 — 칸의 옵션 가운데 순서가 가장 앞인 것으로 · 빈 칸은 맨 뒤(내림차순도)
 *   ④ ★ 글자 — 옵션 이름을 `, ` 로 · CSV 도 같다 · 지운 옵션은 뺀다
 *   ⑤ 값 세기는 칩 수의 합이다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { cellText } from './cell-format.ts'
import { calculationResult, calculationsFor, type ColumnStats } from './calculations.ts'
import { ParamBag, compileFilter, compileSorts, noViewer, operatorArity, operatorsFor, validateFilter, validateSorts } from './filter.ts'
import { MAX_MULTI_SELECT, deriveSidecars, emptyValue, isEmptyValue, validateCellValue, type SelectOption } from './property-types.ts'
import { cellPlainText } from '../export/csv.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const valid = (v: unknown): boolean => validateCellValue('multi_select', v).length === 0
const cell = (...ids: string[]) => ({ type: 'multi_select', multi_select: ids.map((id) => ({ id })) })

describe('값 검증', () => {
  test('★ 고른 차례의 {id} 배열 · 빈 배열이 통과', () => {
    assert.ok(valid(cell(B, A)))
    assert.ok(valid(cell()))
  })

  test('★ 같은 옵션 두 번은 거부 (대소문자만 다른 id 도)', () => {
    assert.equal(valid(cell(A, A)), false)
    assert.equal(valid(cell(A, A.toUpperCase())), false)
  })

  test('★ 100개는 통과 · 101개는 거부', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    assert.ok(valid(cell(...ids(MAX_MULTI_SELECT))))
    assert.equal(valid(cell(...ids(MAX_MULTI_SELECT + 1))), false)
  })

  test('★ 모양이 틀린 값은 거부 — 배열이 아님 · 이름 글자 · id 없음 · uuid 아님 · 봉투 타입 다름', () => {
    assert.equal(valid({ type: 'multi_select', multi_select: { id: A } }), false)
    assert.equal(valid({ type: 'multi_select', multi_select: null }), false)
    assert.equal(valid({ type: 'multi_select', multi_select: ['A'] }), false)
    assert.equal(valid({ type: 'multi_select', multi_select: [{}] }), false)
    assert.equal(valid({ type: 'multi_select', multi_select: [{ id: 'abc' }] }), false)
    assert.equal(valid({ type: 'select', select: { id: A } }), false)
  })

  test('빈 값 · 사이드카(옵션 id 를 공백으로 · 빈 배열은 NULL)', () => {
    const empty = emptyValue('multi_select')
    assert.equal(isEmptyValue(empty), true)
    assert.equal(deriveSidecars(empty).text, null)
    const two = { type: 'multi_select' as const, multi_select: [{ id: B }, { id: A }] }
    assert.equal(isEmptyValue(two), false)
    assert.equal(deriveSidecars(two).text, `${B} ${A}`)
  })
})

const TYPES = new Map<string, string>([['pMulti', 'multi_select']])

describe('필터', () => {
  test('★ 연산자 — 포함 · 포함하지 않음 · 비어 있음 · 비어 있지 않음', () => {
    assert.deepEqual(operatorsFor('multi_select'), ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'])
    assert.equal(operatorArity('multi_select', 'contains'), 1)
    assert.equal(operatorArity('multi_select', 'is_empty'), 0)
    assert.equal(operatorArity('multi_select', 'equals'), null)
  })

  test('★ contains — 값의 jsonb 포함 연산 · 옵션 id 는 바인딩', () => {
    const params = new ParamBag(1)
    const sql = compileFilter({ property_id: 'pMulti', operator: 'contains', value: A }, TYPES, params, noViewer())!
    assert.match(sql, /^EXISTS \(/)
    assert.ok(sql.includes(`v.value -> 'multi_select' @> jsonb_build_array(jsonb_build_object('id', $2::text))`), sql)
    assert.deepEqual(params.values, ['pMulti', A])
    assert.equal(sql.includes(A), false, '값은 SQL 글자에 들어가지 않는다')
  })

  test('★ does_not_contain — NOT EXISTS (칸이 없는 행도 맞는다)', () => {
    const sql = compileFilter({ property_id: 'pMulti', operator: 'does_not_contain', value: A }, TYPES, new ParamBag(1), noViewer())!
    assert.match(sql, /^NOT EXISTS \(/)
  })

  test('is_empty · is_not_empty — 사이드카 축', () => {
    const empty = compileFilter({ property_id: 'pMulti', operator: 'is_empty' }, TYPES, new ParamBag(1), noViewer())!
    assert.match(empty, /^NOT EXISTS \(.*v\.text_value IS NOT NULL/s)
    const filled = compileFilter({ property_id: 'pMulti', operator: 'is_not_empty' }, TYPES, new ParamBag(1), noViewer())!
    assert.match(filled, /^EXISTS \(.*v\.text_value IS NOT NULL/s)
  })

  test('★ 저장 검증 — 값은 옵션 id(uuid) 하나', () => {
    assert.deepEqual(validateFilter({ property_id: 'pMulti', operator: 'contains', value: A }, TYPES), [])
    assert.equal(validateFilter({ property_id: 'pMulti', operator: 'contains', value: 'A' }, TYPES).length, 1)
    assert.equal(validateFilter({ property_id: 'pMulti', operator: 'contains' }, TYPES).length, 1)
    assert.equal(validateFilter({ property_id: 'pMulti', operator: 'equals', value: A }, TYPES).length, 1)
    assert.deepEqual(validateFilter({ property_id: 'pMulti', operator: 'is_empty' }, TYPES), [])
  })
})

describe('정렬', () => {
  test('★ 정렬 키 — 칸의 옵션 가운데 order_idx 가 가장 작은 것 · 빈 칸은 NULLS LAST(내림차순도)', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const params = new ParamBag(1)
      const sorted = compileSorts([{ property_id: 'pMulti', direction }], TYPES, params)
      assert.ok(sorted.keys[0].expr.includes('min(o.order_idx COLLATE "C")'), sorted.keys[0].expr)
      assert.ok(sorted.orderBy.startsWith(`${sorted.keys[0].expr} ${direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`))
      assert.equal(sorted.keys[0].cast, '::text')
    }
  })

  test('정렬 저장 검증 — 다중 선택은 정렬 키가 된다', () => {
    assert.deepEqual(validateSorts([{ property_id: 'pMulti', direction: 'asc' }], TYPES), [])
  })
})

describe('글자 · 집계', () => {
  const options: SelectOption[] = [
    { id: A, name: 'A', color: 'red' },
    { id: B, name: 'B', color: 'blue' },
  ]

  test('★ 칸의 글자 — 고른 차례의 옵션 이름을 ", " 로 · 지운 옵션은 뺀다', () => {
    assert.equal(cellText({ type: 'multi_select', multi_select: [{ id: B }, { id: A }] }, options), 'B, A')
    assert.equal(cellText({ type: 'multi_select', multi_select: [{ id: A }, { id: '33333333-3333-4333-8333-333333333333' }] }, options), 'A')
    assert.equal(cellText(emptyValue('multi_select'), options), '')
  })

  test('★ CSV · Markdown 의 칸 글자 — 옵션 이름을 ", " 로', () => {
    const column = { propertyId: 'pMulti', name: '태그', type: 'multi_select', options } as const
    assert.equal(cellPlainText(column, { type: 'multi_select', multi_select: [{ id: A }, { id: B }] }), 'A, B')
    assert.equal(cellPlainText(column, undefined), '')
  })

  test('열 집계 — 세기만 · 값 세기는 칩 수의 합', () => {
    assert.deepEqual(calculationsFor('multi_select'), ['count_all', 'count_values', 'count_empty', 'percent_empty', 'percent_not_empty'])
    const stats: ColumnStats = {
      total: 3, filled: 2, distinct: 2, sum: null, avg: null, median: null, min: null, max: null, dateMin: null, dateMax: null,
      checked: 0, complete: 0, values: 5,
    }
    assert.deepEqual(calculationResult('count_values', stats), { kind: 'count', value: 5 })
    assert.deepEqual(calculationResult('count_empty', stats), { kind: 'count', value: 1 })
    // 다중 선택이 아닌 열은 `values` 가 0 이라 값 있는 칸 수 그대로다
    assert.deepEqual(calculationResult('count_values', { ...stats, values: 0 }), { kind: 'count', value: 2 })
  })
})
