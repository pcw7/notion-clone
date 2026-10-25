/**
 * 다시 읽은 행을 화면의 목록에 맞춘다 (2k-2조각 · F-04-24)
 *
 *   ① 다시 읽은 것으로 바꾼다 — 새 행이 서고 빠진 행은 빠진다 · 값이 바뀐 행은 새 값
 *   ② 펼쳐 둔 행의 자식이 다시 선다(펼침이 풀리지 않는다) · 사라진 행의 펼침은 빠진다
 *   ③ 내가 고친 행이 결과에 없으면 옛 자리에 남기고 알린다 · 다른 사람이 고쳐 나간 행은 빠진다
 *   ④ 늦게 온 옛 결과는 화면의 새 행(더 새 버전)을 덮지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { RowJson } from './http.ts'
import { mergeReloaded } from './live-rows.ts'

const row = (id: string, title = id): RowJson => ({ id, title, icon: null, properties: {}, uniqueSeq: null, lastEditedAt: '2026-10-10T00:00:00Z', version: '1' })
const ids = (rows: readonly RowJson[]) => rows.map((r) => r.id)
const none = new Set<string>()
const flat = (previous: RowJson[], top: RowJson[], touched: Set<string> = none) =>
  mergeReloaded({ previous, depthOf: new Map(), top, childrenOf: new Map(), expanded: none, touched })

describe('① 바꾼다', () => {
  test('★ 새 행이 서고 · 빠진 행은 빠지고 · 값이 바뀐 행은 새 값', () => {
    const merged = flat([row('a'), row('b'), row('c')], [row('a', 'A!'), row('c'), row('d')])
    assert.deepEqual(ids(merged.rows), ['a', 'c', 'd'])
    assert.equal(merged.rows[0]!.title, 'A!')
    assert.deepEqual([...merged.outside], [])
  })
})

describe('② 트리', () => {
  test('★ 펼쳐 둔 행의 자식이 다시 선다 · 깊이 · 사라진 행의 펼침은 빠진다', () => {
    const merged = mergeReloaded({
      previous: [row('p'), row('c1'), row('q')],
      depthOf: new Map([['c1', 1]]),
      top: [row('p'), row('r')],
      childrenOf: new Map([['p', [row('c1'), row('c2')]], ['c2', [row('g')]]]),
      expanded: new Set(['p', 'c2', 'q']),
      touched: none,
    })
    assert.deepEqual(ids(merged.rows), ['p', 'c1', 'c2', 'g', 'r'])
    assert.deepEqual(['p', 'c1', 'c2', 'g', 'r'].map((id) => merged.depthOf.get(id)), [0, 1, 1, 2, 0])
    assert.deepEqual([...merged.expanded].sort(), ['c2', 'p'], '사라진 q 의 펼침은 빠진다')
  })

  test('한 행이 두 자리에 서지 않는다', () => {
    const merged = mergeReloaded({
      previous: [],
      depthOf: new Map(),
      top: [row('p'), row('x')],
      childrenOf: new Map([['p', [row('x')]]]),
      expanded: new Set(['p']),
      touched: none,
    })
    assert.deepEqual(ids(merged.rows), ['p', 'x'])
  })
})

describe('③ 내가 고친 행', () => {
  test('★ 결과에 없으면 옛 자리(바로 앞의 남은 행 뒤)에 남기고 알린다 · 다른 사람이 고쳐 나간 행은 빠진다', () => {
    const merged = flat([row('a'), row('mine'), row('b'), row('theirs')], [row('a'), row('b')], new Set(['mine']))
    assert.deepEqual(ids(merged.rows), ['a', 'mine', 'b'])
    assert.deepEqual([...merged.outside], ['mine'])
  })

  test('맨 앞이었으면 맨 앞에', () => {
    const merged = flat([row('mine'), row('a')], [row('a')], new Set(['mine']))
    assert.deepEqual(ids(merged.rows), ['mine', 'a'])
  })

  test('결과에 있으면 알리지 않는다(내가 고쳤어도 조건에 맞는다)', () => {
    const merged = flat([row('mine')], [row('mine', '고침')], new Set(['mine']))
    assert.deepEqual([...merged.outside], [])
    assert.equal(merged.rows[0]!.title, '고침')
  })
})

describe('④ 늦게 온 옛 결과', () => {
  const at = (id: string, title: string, version: string): RowJson => ({ ...row(id, title), version })

  test('★ 화면의 행이 더 새 버전이면 지킨다 — 저장 응답이 먼저 왔고 저장 전에 읽은 결과가 늦게 왔다', () => {
    const merged = flat([at('a', '새 제목', '5'), at('b', 'B', '1')], [at('a', '옛 제목', '4'), at('b', 'B!', '2')], new Set(['a']))
    assert.deepEqual(merged.rows.map((r) => [r.id, r.title, r.version]), [['a', '새 제목', '5'], ['b', 'B!', '2']])
  })

  test('같은 버전이거나 다시 읽은 것이 더 새면 다시 읽은 것 · 읽을 수 없는 버전도 다시 읽은 것', () => {
    assert.equal(flat([at('a', '화면', '3')], [at('a', '서버', '3')]).rows[0]!.title, '서버')
    assert.equal(flat([at('a', '화면', '3')], [at('a', '서버', '7')]).rows[0]!.title, '서버')
    assert.equal(flat([at('a', '화면', 'x')], [at('a', '서버', '1')]).rows[0]!.title, '서버')
  })

  test('펼쳐 둔 자식에도 같다', () => {
    const merged = mergeReloaded({
      previous: [at('p', 'P', '1'), at('c', '새 자식', '9')],
      depthOf: new Map([['p', 0], ['c', 1]]),
      top: [at('p', 'P', '1')],
      childrenOf: new Map([['p', [at('c', '옛 자식', '8')]]]),
      expanded: new Set(['p']),
      touched: none,
    })
    assert.deepEqual(merged.rows.map((r) => r.title), ['P', '새 자식'])
  })
})
