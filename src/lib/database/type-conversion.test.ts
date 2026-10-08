/**
 * 프로퍼티 타입 바꾸기의 규칙 — 칸 하나 (DB 심화 2c-1조각 · F-03-14 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 글로 읽기 — 글 · 숫자 · 선택(옵션 이름) · 체크박스(`Yes` 또는 빈 글) · 날짜(ISO · 범위는 `→`)
 *   ② ★ 글에서 읽기 — 숫자는 읽히는 것만(천 단위 쉼표) · 날짜는 달력에 있는 날만 · 범위가 거꾸로면 받지 않는다 · 체크박스는 `Yes` · `true` ·
 *        `1` 이면 체크
 *   ③ ★ 손실 = 값이 있던 칸이 비게 되는 것 — 빈 칸은 손실이 아니다 · 체크박스가 받지 못한 글은 손실이다
 *   ④ ★ 오가기 — 선택 → 글 → 선택은 같은 이름의 같은 옵션 · 날짜 범위 → 글 → 날짜는 같은 범위 · 체크박스 → 글 → 체크박스는 같은 값
 *   ⑤ 바꿀 수 있는 쌍 — 다섯 타입 사이 · 제목 · 상태는 아니다 · 같은 타입은 바꾸는 것이 아니다
 *   ⑥ 필터에서 그 속성의 규칙 빼기 — 빈 묶음은 접고 남는 것이 없으면 null
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import type { CellValue } from './property-types.ts'
import { canConvert, cellToText, convertCell, parseDateText, parseNumber, textToCell } from './type-conversion.ts'
import { withoutProperty } from './filter.ts'

const names = new Map([['o1', '진행 중']])
const optionName = (id: string) => names.get(id) ?? null
const ids = new Map<string, string>()
const optionIdFor = (name: string) => {
  if (!ids.has(name)) ids.set(name, `opt:${name}`)
  return ids.get(name)!
}

describe('① 글로 읽기', () => {
  test('타입마다 — 선택은 옵션 이름 · 체크박스는 Yes 또는 빈 글 · 날짜 범위는 →', () => {
    const cases: [CellValue, string][] = [
      [{ type: 'rich_text', rich_text: [textRun('메모')] }, '메모'],
      [{ type: 'number', number: 1.5 }, '1.5'],
      [{ type: 'number', number: null }, ''],
      [{ type: 'select', select: { id: 'o1' } }, '진행 중'],
      [{ type: 'select', select: { id: '지워진' } }, ''],
      [{ type: 'checkbox', checkbox: true }, 'Yes'],
      [{ type: 'checkbox', checkbox: false }, ''],
      [{ type: 'date', date: { start: '2026-03-01' } }, '2026-03-01'],
      [{ type: 'date', date: { start: '2026-03-01', end: '2026-03-05' } }, '2026-03-01 → 2026-03-05'],
    ]
    for (const [value, text] of cases) assert.equal(cellToText(value, optionName), text, JSON.stringify(value))
  })
})

describe('② 글에서 읽기', () => {
  test('★ 숫자는 읽히는 것만 — 천 단위 쉼표는 뗀다', () => {
    assert.equal(parseNumber('1,234'), 1234)
    assert.equal(parseNumber('-3.5'), -3.5)
    assert.equal(parseNumber('1e3'), 1000)
    for (const bad of ['약 3', '3개', '', '1,23', 'Infinity', '--1']) assert.equal(parseNumber(bad), null, bad)
  })

  test('★ 날짜는 달력에 있는 날만 · 범위가 거꾸로면 받지 않는다', () => {
    assert.deepEqual(parseDateText('2026-03-01'), { start: '2026-03-01' })
    assert.deepEqual(parseDateText('2026-03-01T09:30'), { start: '2026-03-01T09:30' })
    assert.deepEqual(parseDateText('2026-03-01 → 2026-03-05'), { start: '2026-03-01', end: '2026-03-05' })
    for (const bad of ['2026-02-30', '어제', '2026/03/01', '2026-03-05 → 2026-03-01', '2026-03-01 → 2026-03-02 → 2026-03-03']) {
      assert.equal(parseDateText(bad), null, bad)
    }
  })

  test('체크박스 — Yes · true · 1 이면 체크, No · false · 0 · 빈 글이면 체크 안 함(칸 없음)', () => {
    for (const yes of ['Yes', 'true', '1', 'YES']) assert.deepEqual(textToCell(yes, 'checkbox', optionIdFor).value, { type: 'checkbox', checkbox: true }, yes)
    for (const no of ['No', 'false', '0', '']) assert.deepEqual(textToCell(no, 'checkbox', optionIdFor), { value: null, lost: false }, no)
  })

  test('선택 — 이름이 곧 옵션 · 공백은 접는다 · 빈 글은 칸 없음', () => {
    assert.deepEqual(textToCell('  긴급   건 ', 'select', optionIdFor).value, { type: 'select', select: { id: 'opt:긴급 건' } })
    assert.deepEqual(textToCell('', 'select', optionIdFor), { value: null, lost: false })
  })
})

describe('③ 손실', () => {
  test('★ 값이 있던 칸이 비게 되면 손실 — 빈 칸은 손실이 아니다', () => {
    assert.deepEqual(textToCell('약 3', 'number', optionIdFor), { value: null, lost: true })
    assert.deepEqual(textToCell('', 'number', optionIdFor), { value: null, lost: false })
    assert.deepEqual(textToCell('어제', 'date', optionIdFor), { value: null, lost: true })
    assert.deepEqual(textToCell('abc', 'checkbox', optionIdFor), { value: null, lost: true }, '체크박스가 받지 못한 글은 손실')
  })
})

describe('④ 오가기', () => {
  const opts = { optionName, optionIdFor }
  test('★ 선택 → 글 → 선택은 같은 이름의 옵션 · 날짜 범위 · 체크박스는 같은 값', () => {
    const asText = convertCell({ type: 'select', select: { id: 'o1' } }, 'rich_text', opts).value!
    assert.deepEqual(convertCell(asText, 'select', opts).value, { type: 'select', select: { id: optionIdFor('진행 중') } })

    const range: CellValue = { type: 'date', date: { start: '2026-03-01', end: '2026-03-05' } }
    assert.deepEqual(convertCell(convertCell(range, 'rich_text', opts).value!, 'date', opts).value, range)

    const checked: CellValue = { type: 'checkbox', checkbox: true }
    assert.deepEqual(convertCell(convertCell(checked, 'rich_text', opts).value!, 'checkbox', opts).value, checked)

    assert.deepEqual(convertCell({ type: 'number', number: 42 }, 'rich_text', opts).value, { type: 'rich_text', rich_text: [textRun('42')] })
  })
})

describe('⑤ 바꿀 수 있는 쌍', () => {
  test('다섯 타입 사이 — 제목 · 상태는 아니다 · 같은 타입은 아니다', () => {
    assert.equal(canConvert('rich_text', 'number'), true)
    assert.equal(canConvert('select', 'checkbox'), true)
    assert.equal(canConvert('title', 'rich_text'), false)
    assert.equal(canConvert('rich_text', 'title'), false)
    assert.equal(canConvert('select', 'status'), false)
    assert.equal(canConvert('relation', 'number'), false)
    assert.equal(canConvert('number', 'number'), false)
  })
})

describe('⑥ 필터에서 그 속성의 규칙 빼기', () => {
  test('빈 묶음은 접고 남는 것이 없으면 null · 뺀 수를 센다', () => {
    const filter = {
      op: 'and' as const,
      children: [
        { property_id: 'p', operator: 'equals', value: 1 },
        { op: 'or' as const, children: [{ property_id: 'p', operator: 'is_empty' }] },
        { property_id: 'q', operator: 'equals', value: 2 },
      ],
    }
    assert.deepEqual(withoutProperty(filter, 'p'), { filter: { op: 'and', children: [{ property_id: 'q', operator: 'equals', value: 2 }] }, removed: 2 })
    assert.deepEqual(withoutProperty({ property_id: 'p', operator: 'equals', value: 1 }, 'p'), { filter: null, removed: 1 })
    assert.equal(withoutProperty(filter, 'z').filter, filter, '안 바뀌면 같은 것을 준다')
    assert.deepEqual(withoutProperty(null, 'p'), { filter: null, removed: 0 })
  })
})
