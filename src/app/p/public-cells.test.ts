/**
 * 공개 표의 칸 — 6a-2c-2 (F-06-08 · 순수)
 *
 *   ① 타입마다 값 → 재료 · 고유 ID 는 행의 번호와 접두사
 *   ② 모양이 틀린 값 · 지운 옵션은 빈 칸(던지지 않는다 · 이름을 지어내지 않는다) · 체크박스의 빈 값은 "안 됨"
 *   ③ 날짜 · 숫자의 글
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { PublicColumn } from '../../lib/publish/public-database.ts'
import { checkboxLabel, dateText, numberText, publicCell } from './public-cells.ts'

const col = (type: PublicColumn['type'], extra: Partial<PublicColumn> = {}): PublicColumn => ({
  id: 'p1',
  name: '칸',
  type,
  options: [],
  prefix: null,
  ...extra,
})
const run = { type: 'text', text: { content: '안녕' } } as const

describe('① 타입마다', () => {
  test('글 · 숫자 · 선택 · 상태 · 체크박스 · 날짜 · 고유 ID', () => {
    assert.deepEqual(publicCell(col('title'), { type: 'title', title: [run] }, null), { kind: 'runs', runs: [run] })
    assert.deepEqual(publicCell(col('rich_text'), { type: 'rich_text', rich_text: [run] }, null), { kind: 'runs', runs: [run] })
    assert.deepEqual(publicCell(col('number'), { type: 'number', number: 12345.5 }, null), { kind: 'text', text: '12,345.5' })
    const options = [{ id: 'o1', name: '할 일', color: 'blue' }]
    assert.deepEqual(publicCell(col('select', { options }), { type: 'select', select: { id: 'o1' } }, null), { kind: 'option', option: options[0] })
    assert.deepEqual(publicCell(col('status', { options }), { type: 'status', status: { id: 'o1' } }, null), { kind: 'option', option: options[0] })
    assert.deepEqual(publicCell(col('checkbox'), { type: 'checkbox', checkbox: true }, null), { kind: 'checkbox', checked: true })
    assert.deepEqual(publicCell(col('date'), { type: 'date', date: { start: '2026-03-10' } }, null), { kind: 'text', text: '2026-03-10' })
    assert.deepEqual(publicCell(col('unique_id', { prefix: 'TASK' }), undefined, 7), { kind: 'text', text: 'TASK-7' })
    assert.deepEqual(publicCell(col('unique_id'), undefined, null), { kind: 'empty' })
  })
})

describe('② 빈 칸', () => {
  test('★ 모양이 틀린 값 · 지운 옵션은 빈 칸 · 체크박스의 빈 값은 "안 됨"', () => {
    assert.deepEqual(publicCell(col('title'), { type: 'title', title: [] }, null), { kind: 'empty' })
    assert.deepEqual(publicCell(col('number'), { type: 'number', number: null }, null), { kind: 'empty' })
    assert.deepEqual(publicCell(col('number'), 'x', null), { kind: 'empty' })
    assert.deepEqual(publicCell(col('select', { options: [] }), { type: 'select', select: { id: 'gone' } }, null), { kind: 'empty' })
    assert.deepEqual(publicCell(col('date'), { type: 'date', date: { start: 'nope' } }, null), { kind: 'empty' })
    assert.deepEqual(publicCell(col('checkbox'), undefined, null), { kind: 'checkbox', checked: false })
    assert.equal(checkboxLabel(true), '체크됨')
    assert.equal(checkboxLabel(false), '체크 안 됨')
  })
})

describe('③ 날짜 · 숫자', () => {
  test('시각이 있으면 시:분 · 끝이 있으면 → · 숫자는 쉼표', () => {
    assert.equal(dateText({ start: '2026-03-10T09:30:00.000Z' }), '2026-03-10 09:30')
    assert.equal(dateText({ start: '2026-03-10', end: '2026-03-12' }), '2026-03-10 → 2026-03-12')
    assert.equal(dateText({ start: 3 }), null)
    assert.equal(numberText(1000000), '1,000,000')
  })
})
