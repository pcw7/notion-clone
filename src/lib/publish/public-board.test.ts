/**
 * 공개 보드의 열 짓기 — 순수 (공개 화면의 뷰 PV-1 · F-06-08)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ②
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { groupLabel } from '../database/board-drag.ts'
import { readDataBucket } from '../database/group-bucket.ts'
import { boardKeyOf, bucketHeadsOf, buildBoardColumns, isBoardGroupType, isBucketGroupType, type BoardSpec } from './public-board.ts'

const options = [
  { id: 'o1', name: '할 일', color: 'red' },
  { id: 'o2', name: '진행', color: 'blue' },
  { id: 'o3', name: '끝', color: 'green' },
]
const select: BoardSpec = { type: 'select', options, hidden: [], hideEmpty: false }
type R = { id: string; key: string }
const keyOf = (r: R): string => r.key

describe('★ 그룹 기준의 타입', () => {
  test('선택 · 상태 · 체크박스 · 날짜 · 숫자 · 글(PV-6)이 보드가 된다 — 다중 선택 · 수식 · 제목은 표', () => {
    for (const ok of ['select', 'status', 'checkbox', 'date', 'number', 'rich_text']) assert.equal(isBoardGroupType(ok), true, ok)
    for (const no of ['multi_select', 'person', 'formula', 'rollup', 'title']) assert.equal(isBoardGroupType(no), false, no)
    for (const bucket of ['date', 'number', 'rich_text']) assert.equal(isBucketGroupType(bucket), true, bucket)
    for (const option of ['select', 'status', 'checkbox']) assert.equal(isBucketGroupType(option), false, option)
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

describe('★ 데이터 버킷의 열 (PV-6)', () => {
  const TODAY = '2026-11-12'

  test('날짜(월) — 값 없음이 맨 앞 · 버킷은 날짜 차례 · 이름은 앱의 머리 그대로 · 같은 키는 한 번', () => {
    const bucket = readDataBucket({}, 'date', TODAY)
    const heads = bucketHeadsOf('date', '기한', bucket, ['2026-10-01', '', '2025-03-01', '2026-10-01'])
    assert.deepEqual(heads.map((h) => [h.key, h.name, h.color]), [
      ['', '기한 없음', null], ['2025-03-01', '2025년 3월', null], ['2026-10-01', '2026년 10월', null],
    ])
    for (const h of heads) assert.equal(h.name, groupLabel('date', '기한', { key: h.key, option: null }, bucket), '앱의 groupLabel 과 같다')
  })

  test('상대 날짜 · 숫자(크기 5 · 내림) · 첫 글자', () => {
    const relative = bucketHeadsOf('date', '기한', readDataBucket({ date_unit: 'relative' }, 'date', TODAY), ['later', 'today', 'last_7'])
    assert.deepEqual(relative.map((h) => h.name), ['기한 없음', '지난 7일', '오늘', '그 뒤'])
    const number = bucketHeadsOf('number', '점수', readDataBucket({ number_size: 5, sort: 'descending' }, 'number', TODAY), ['0', '15', '-5'])
    assert.deepEqual(number.map((h) => h.name), ['점수 없음', '15 ~ 20', '0 ~ 5', '-5 ~ 0'], '내림이어도 값 없음은 맨 앞')
    const first = bucketHeadsOf('rich_text', '메모', readDataBucket({ text_by: 'first' }, 'rich_text', TODAY), ['#', 'A', 'ㄱ'])
    assert.deepEqual(first.map((h) => [h.key, h.name]), [['', '메모 없음'], ['ㄱ', 'ㄱ'], ['A', 'A'], ['#', '그 밖']])
  })

  test('★ 명세에 머리가 있으면 그 차례 · 이름의 열 — 숨긴 그룹 · 빈 열 숨김은 옵션과 같다', () => {
    const buckets = bucketHeadsOf('number', '점수', readDataBucket({}, 'number', TODAY), ['20', '0'])
    const spec: BoardSpec = { type: 'number', options: [], buckets, hidden: [], hideEmpty: false }
    const rows: R[] = [{ id: 'a', key: '20' }, { id: 'b', key: '0' }, { id: 'c', key: '20' }]
    assert.deepEqual(buildBoardColumns(spec, rows, keyOf).map((c) => [c.key, c.name, c.rows.map((r) => r.id)]), [
      ['', '점수 없음', []], ['0', '0 ~ 10', ['b']], ['20', '20 ~ 30', ['a', 'c']],
    ])
    assert.deepEqual(buildBoardColumns({ ...spec, hidden: ['0'] }, rows, keyOf).map((c) => c.key), ['', '20'])
    assert.deepEqual(buildBoardColumns({ ...spec, hideEmpty: true }, rows, keyOf).map((c) => c.key), ['0', '20'], '값 없음 열도 비면 빠진다')
  })
})
