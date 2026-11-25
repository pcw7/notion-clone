/**
 * 남이 바꾼 칸 (DB 실시간 동기화 RT-4조각 · F-05-16)
 *
 *   ① 칸마다 — 값이 바뀐 칸만(행의 판이 아니라) · 키 차례는 보지 않는다 · 고를 수 있는 칸 안에서만
 *   ② 칠하지 않는 것 — 새로 들어온 행 · 빠진 행 · 이 탭이 쓴 칸(칸 · 행 전체) · 대량
 *   ③ 이 탭의 장부 — 시간이 지나면 남의 것 · 다시 적으면 다시 센다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { RowJson } from './http.ts'
import { changedCells, createOwnWrites, remoteChanges, sameValueJson, OWN_WRITE_MS, REMOTE_FLASH_MAX_ROWS } from './remote-cells.ts'

const row = (id: string, properties: Record<string, unknown>, version = '1'): RowJson =>
  ({
    id,
    title: id,
    icon: null,
    properties,
    uniqueSeq: null,
    createdAt: '2026-11-26T00:00:00Z',
    createdBy: null,
    lastEditedAt: '2026-11-26T00:00:00Z',
    lastEditedBy: null,
    version,
  }) as unknown as RowJson
const num = (n: number) => ({ type: 'number', number: n })
const text = (s: string) => ({ type: 'rich_text', rich_text: [{ type: 'text', text: { content: s } }] })
const nobody = () => false

describe('① 칸마다', () => {
  test('★ 값이 바뀐 칸만 — 같은 행의 다른 칸 · 고를 수 없는 칸은 아니다', () => {
    const before = row('r', { qty: num(1), memo: text('a'), formula: num(2) })
    const after = row('r', { qty: num(5), memo: text('a'), formula: num(9) }, '2')
    assert.deepEqual(changedCells(before, after, ['qty', 'memo']), ['qty'])
  })

  test('키 차례가 달라도 같은 값 · 없던 칸이 생기고 · 있던 칸이 비면 바뀐 것', () => {
    assert.equal(sameValueJson({ type: 'number', number: 1 }, { number: 1, type: 'number' }), true)
    assert.equal(sameValueJson({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), false)
    assert.equal(sameValueJson({ a: 1, b: undefined }, { a: 1 }), true)
    assert.equal(sameValueJson([1, 2], { 0: 1, 1: 2 }), false)
    assert.deepEqual(changedCells(row('r', {}), row('r', { qty: num(1) }), ['qty']), ['qty'])
    assert.deepEqual(changedCells(row('r', { qty: num(1) }), row('r', {}), ['qty']), ['qty'])
  })
})

describe('② 칠하지 않는 것', () => {
  test('★ 화면에 있던 행만 — 새로 들어온 행 · 빠진 행은 아니다 · 같은 객체면 보지 않는다', () => {
    const a = row('a', { qty: num(1) })
    const found = remoteChanges({
      previous: [a, row('gone', { qty: num(1) })],
      next: [a, row('new', { qty: num(3) })],
      propertyIds: ['qty'],
      isOwn: nobody,
    })
    assert.deepEqual([...found], [])
  })

  test('★ 남이 바꾼 칸은 그 행 · 그 칸으로', () => {
    const found = remoteChanges({
      previous: [row('a', { qty: num(1), memo: text('x') }), row('b', { qty: num(2) })],
      next: [row('a', { qty: num(1), memo: text('y') }, '2'), row('b', { qty: num(2) })],
      propertyIds: ['qty', 'memo'],
      isOwn: nobody,
    })
    assert.deepEqual([...found], [['a', ['memo']]])
  })

  test('★ 이 탭이 쓴 칸은 빼고 · 행 전체로 적은 행은 모두 뺀다', () => {
    const own = createOwnWrites(() => 1000)
    own.note('a', 'memo')
    own.note('b')
    const found = remoteChanges({
      previous: [row('a', { qty: num(1), memo: text('x') }), row('b', { qty: num(1) })],
      next: [row('a', { qty: num(2), memo: text('y') }, '2'), row('b', { qty: num(2) }, '2')],
      propertyIds: ['qty', 'memo'],
      isOwn: own.isOwn,
    })
    assert.deepEqual([...found], [['a', ['qty']]])
  })

  test('★ 한 번에 너무 많은 행이 바뀌면(대량) 아무것도 칠하지 않는다', () => {
    const many = REMOTE_FLASH_MAX_ROWS + 1
    const previous = Array.from({ length: many }, (_, i) => row(`r${i}`, { qty: num(0) }))
    const next = previous.map((r) => row(r.id, { qty: num(1) }, '2'))
    assert.equal(remoteChanges({ previous, next, propertyIds: ['qty'], isOwn: nobody }).size, 0)
    assert.equal(remoteChanges({ previous: previous.slice(1), next: next.slice(1), propertyIds: ['qty'], isOwn: nobody }).size, REMOTE_FLASH_MAX_ROWS)
  })

  test('고를 칸이 없으면 없다', () => {
    assert.equal(remoteChanges({ previous: [row('a', { q: num(1) })], next: [row('a', { q: num(2) })], propertyIds: [], isOwn: nobody }).size, 0)
  })
})

describe('③ 이 탭의 장부', () => {
  test('★ 적은 뒤 시간이 지나면 남의 것 · 다시 적으면 그때부터 다시 센다', () => {
    let now = 0
    const own = createOwnWrites(() => now)
    own.note('a', 'qty')
    assert.equal(own.isOwn('a', 'qty'), true)
    assert.equal(own.isOwn('a', 'memo'), false, '다른 칸은 아니다')
    now = OWN_WRITE_MS - 1
    own.note('a', 'qty') // 답을 받았다
    now = OWN_WRITE_MS + 100
    assert.equal(own.isOwn('a', 'qty'), true)
    now = 2 * OWN_WRITE_MS
    assert.equal(own.isOwn('a', 'qty'), false)
  })

  test('오래된 것은 쌓이지 않는다(많이 적어도 지난 것은 비운다)', () => {
    let now = 0
    const own = createOwnWrites(() => now, 10)
    for (let i = 0; i < 600; i += 1) own.note(`r${i}`, 'q')
    now = 100
    own.note('last', 'q')
    assert.equal(own.isOwn('r0', 'q'), false)
    assert.equal(own.isOwn('last', 'q'), true)
  })
})
