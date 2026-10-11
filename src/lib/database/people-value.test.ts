/**
 * 사람 속성의 값 — 게시 · 공유 6g-1조각 (F-03-07 · 순수)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강] 사람 속성).
 *
 *   ① 값의 모양 — 배열 · uuid · 같은 사람 두 번 없음 · 50명까지 · 빈 값 · 비었는가
 *   ② 사이드카는 사람 id 의 이음(비면 NULL) · 칸의 글은 이름(모르는 id 는 "떠난 사용자") · CSV 도 이름(수식 막기 대상)
 *   ③ v1 의 범위 — 정렬 키가 아니다 · 집계는 세기만 · 롤업 대상 · 자동화 칸 · 바꿀 수 있는 타입이 아니다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { LEFT_USER, cellText } from './cell-format.ts'
import { calculationsFor } from './calculations.ts'
import { validateSorts } from './filter.ts'
import { MAX_PEOPLE, deriveSidecars, emptyValue, isAutomationCellType, isEmptyValue, validateCellValue, type CellValue } from './property-types.ts'
import { isRollupTargetType } from './rollup-functions.ts'
import { isConvertibleType } from './type-conversion.ts'
import { cellPlainText, tableToCsv } from '../export/csv.ts'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const people = (...ids: string[]): CellValue => ({ type: 'people', people: ids.map((id) => ({ id })) })

describe('① 값의 모양', () => {
  test('★ 배열 · uuid · 같은 사람 두 번 없음 · 50명까지', () => {
    assert.deepEqual(validateCellValue('people', people(A, B)), [])
    assert.deepEqual(validateCellValue('people', people()), [])
    assert.equal(validateCellValue('people', { type: 'people', people: 'x' }).length, 1)
    assert.equal(validateCellValue('people', { type: 'people', people: [{ id: 'nope' }] })[0]?.message, '사람 id(uuid)가 필요합니다')
    assert.equal(validateCellValue('people', people(A, A))[0]?.message, '같은 사람이 두 번 있습니다')
    const many = Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    assert.equal(validateCellValue('people', people(...many))[0]?.message, `사람은 ${MAX_PEOPLE}명까지입니다`)
    assert.equal(validateCellValue('people', { type: 'select', select: null }).length, 1, '봉투의 타입이 다르면 거부')
  })

  test('빈 값 · 비었는가', () => {
    assert.deepEqual(emptyValue('people'), { type: 'people', people: [] })
    assert.equal(isEmptyValue(people()), true)
    assert.equal(isEmptyValue(people(A)), false)
  })
})

describe('② 사이드카 · 글', () => {
  test('사이드카는 사람 id 의 이음 · 비면 NULL', () => {
    assert.equal(deriveSidecars(people(A, B)).text, `${A} ${B}`)
    assert.equal(deriveSidecars(people()).text, null)
  })

  test('★ 칸의 글은 이름 — 모르는 id 는 "떠난 사용자" · CSV 도 이름 · 이름은 수식 막기 대상', () => {
    const names = new Map([[A, '김가'], [B, '=SUM(1)']])
    assert.equal(cellText(people(A, B), [], names), '김가, =SUM(1)')
    assert.equal(cellText(people(A, '00000000-0000-4000-8000-0000000000ff'), [], names), `김가, ${LEFT_USER}`)
    const column = { propertyId: 'p', name: '담당', type: 'people' as const, names }
    assert.equal(cellPlainText(column, people(A, B)), '김가, =SUM(1)')
    const { csv, guardedFormulas } = tableToCsv([column], [{ cells: { p: people(B) } }])
    assert.ok(csv.includes("'=SUM(1)"), '이름이 수식처럼 시작하면 막는다')
    assert.equal(guardedFormulas, 1)
  })
})

describe('③ v1 의 범위', () => {
  test('정렬 키가 아니다 · 집계는 세기만 · 롤업 대상 · 자동화 칸 · 바꿀 수 있는 타입이 아니다', () => {
    const types = new Map([['p', 'people']])
    assert.equal(validateSorts([{ property_id: 'p', direction: 'asc' }], types)[0]?.message, '사람으로는 정렬할 수 없습니다')
    assert.deepEqual(calculationsFor('people'), ['count_all', 'count_values', 'count_empty', 'percent_empty', 'percent_not_empty'])
    assert.equal(isRollupTargetType('people'), false)
    assert.equal(isAutomationCellType('people'), false)
    assert.equal(isAutomationCellType('date'), true)
    assert.equal(isConvertibleType('people'), false)
  })
})
