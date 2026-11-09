/**
 * 공개 보드의 열 짓기 — 순수 (공개 화면의 뷰 PV-1 · F-06-08)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ②
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { boardKeyOf, buildBoardColumns, isBoardGroupType, type BoardSpec } from './public-board.ts'

const options = [
  { id: 'o1', name: '할 일', color: 'red' },
  { id: 'o2', name: '진행', color: 'blue' },
  { id: 'o3', name: '끝', color: 'green' },
]
const select: BoardSpec = { type: 'select', options, hidden: [], hideEmpty: false }
type R = { id: string; key: string }
const keyOf = (r: R): string => r.key

describe('★ 그룹 기준의 타입', () => {
  test('선택 · 상태 · 체크박스만 보드가 된다', () => {
    for (const ok of ['select', 'status', 'checkbox']) assert.equal(isBoardGroupType(ok), true, ok)
    for (const no of ['date', 'number', 'rich_text', 'multi_select', 'person']) assert.equal(isBoardGroupType(no), false, no)
  })
})

describe('boardKeyOf', () => {
  test('옵션 id · 빈 값 · 지운 옵션', () => {
    assert.equal(boardKeyOf(select, { type: 'select', select: { id: 'o2' } }), 'o2')
    assert.equal(boardKeyOf(select, undefined), '')
    assert.equal(boardKeyOf(select, { type: 'select', select: { id: 'gone' } }), '', '지운 옵션은 값 없음')
    assert.equal(boardKeyOf({ type: 'status', options }, { type: 'status', status: { id: 'o1' } }), 'o1')
  })
  test('체크박스는 셀이 없으면 false', () => {
    const spec = { type: 'checkbox' as const, options: [] }
    assert.equal(boardKeyOf(spec, { checkbox: true }), 'true')
    assert.equal(boardKeyOf(spec, { checkbox: false }), 'false')
    assert.equal(boardKeyOf(spec, undefined), 'false')
  })
})

describe('buildBoardColumns', () => {
  const rows: R[] = [
    { id: 'a', key: 'o3' },
    { id: 'b', key: '' },
    { id: 'c', key: 'o1' },
    { id: 'd', key: 'o3' },
  ]

  test('★ 열은 옵션 순서 · 없음 열이 맨 앞 · 카드는 들어온 행 순서', () => {
    const cols = buildBoardColumns(select, rows, keyOf)
    assert.deepEqual(cols.map((c) => [c.key, c.name]), [['', '없음'], ['o1', '할 일'], ['o2', '진행'], ['o3', '끝']])
    assert.deepEqual(cols.map((c) => c.rows.map((r) => r.id)), [['b'], ['c'], [], ['a', 'd']])
  })

  test('숨긴 그룹은 뺀다 · 빈 열 숨김', () => {
    const hidden = buildBoardColumns({ ...select, hidden: ['', 'o3'] }, rows, keyOf)
    assert.deepEqual(hidden.map((c) => c.key), ['o1', 'o2'])
    const noEmpty = buildBoardColumns({ ...select, hideEmpty: true }, rows, keyOf)
    assert.deepEqual(noEmpty.map((c) => c.key), ['', 'o1', 'o3'])
  })

  test('체크박스는 체크 안 함 → 체크', () => {
    const spec: BoardSpec = { type: 'checkbox', options: [], hidden: [], hideEmpty: false }
    const cols = buildBoardColumns(spec, [{ id: 'x', key: 'true' }, { id: 'y', key: 'false' }], keyOf)
    assert.deepEqual(cols.map((c) => [c.name, c.rows.map((r) => r.id)]), [['체크 안 함', ['y']], ['체크', ['x']]])
  })

  test('행이 없어도 열은 선다', () => {
    assert.equal(buildBoardColumns(select, [], keyOf).length, 4)
  })
})
