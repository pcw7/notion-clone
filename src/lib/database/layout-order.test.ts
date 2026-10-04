/**
 * 속성 묶음의 순서 — 잔여 묶음 8f-2 (F-16-03), DOM · DB 없음
 *
 * 이 파일이 지키는 것.
 *
 *   ① 같은 순서면 아무것도 쓰지 않는다
 *   ② **옮긴 것만 쓴다** — 하나를 옮기면 한 행 · 뒤집으면 하나만 남기고
 *   ③ 받지 않은 속성(제목 · rollup · 남이 더한 속성)은 **제자리**다 — 받은 것들이 차지한 자리만 다시 채운다
 *   ④ 모르는 id · 겹친 id 는 건너뛴다
 *   ⑤ 같은 키가 둘이어도 결과는 엄격히 오른다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { planOrder, type KeyedProperty } from './layout-order.ts'

/** 키를 적용한 뒤의 순서 — 서버가 `ORDER BY order_idx, id` 로 읽는 것과 같다. */
const after = (current: readonly KeyedProperty[], moves: readonly KeyedProperty[]): string[] => {
  const next = new Map(moves.map((m) => [m.id, m.key]))
  return current
    .map((p) => ({ id: p.id, key: next.get(p.id) ?? p.key }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1))
    .map((p) => p.id)
}

const strictlyIncreasing = (current: readonly KeyedProperty[], moves: readonly KeyedProperty[]): boolean => {
  const next = new Map(moves.map((m) => [m.id, m.key]))
  const keys = after(current, moves).map((id) => next.get(id) ?? current.find((p) => p.id === id)!.key)
  return keys.every((k, i) => i === 0 || keys[i - 1]! < k)
}

// 이름(제목) · A · B · C · D — 키는 a0 ~ a4.
const schema: KeyedProperty[] = ['이름', 'A', 'B', 'C', 'D'].map((id, i) => ({ id, key: `a${i}` }))

describe('planOrder', () => {
  test('① 같은 순서면 아무것도 쓰지 않는다 — 일부만 받아도', () => {
    assert.deepEqual(planOrder(schema, ['A', 'B', 'C', 'D']), [])
    assert.deepEqual(planOrder(schema, ['B', 'D']), [])
    assert.deepEqual(planOrder(schema, []), [])
  })

  test('★ ② 하나를 옮기면 한 행만 쓴다', () => {
    const moves = planOrder(schema, ['D', 'A', 'B', 'C'])
    assert.deepEqual(moves.map((m) => m.id), ['D'])
    assert.deepEqual(after(schema, moves), ['이름', 'D', 'A', 'B', 'C'])
  })

  test('② 뒤집으면 하나만 남기고 나머지를 쓴다', () => {
    const moves = planOrder(schema, ['D', 'C', 'B', 'A'])
    assert.equal(moves.length, 3)
    assert.deepEqual(after(schema, moves), ['이름', 'D', 'C', 'B', 'A'])
    assert.ok(strictlyIncreasing(schema, moves))
  })

  test('★ ③ 받지 않은 속성은 제자리다 — 받은 것들의 자리만 다시 채운다', () => {
    // 제목은 받지 않았다 — 맨 앞에 남는다. B 는 받지 않았다 — 셋째 자리에 남는다.
    const moves = planOrder(schema, ['D', 'C', 'A'])
    assert.deepEqual(after(schema, moves), ['이름', 'D', 'B', 'C', 'A'])
    assert.ok(!moves.some((m) => m.id === '이름' || m.id === 'B'), JSON.stringify(moves))
  })

  test('④ 모르는 id(그사이 지워진 속성) · 겹친 id 는 건너뛴다', () => {
    const moves = planOrder(schema, ['없음', 'C', 'A', 'C', 'B', 'D'])
    assert.deepEqual(after(schema, moves), ['이름', 'C', 'A', 'B', 'D'])
  })

  test('⑤ 같은 키가 둘이어도 결과는 엄격히 오른다', () => {
    const tied: KeyedProperty[] = [
      { id: 'A', key: 'a1' },
      { id: 'B', key: 'a1' },
      { id: 'C', key: 'a2' },
    ]
    const moves = planOrder(tied, ['B', 'A', 'C'])
    assert.deepEqual(after(tied, moves), ['B', 'A', 'C'])
    assert.ok(strictlyIncreasing(tied, moves))
  })

  test('맨 끝 · 맨 앞으로 옮겨도 경계 밖의 키를 만든다', () => {
    const toEnd = planOrder(schema, ['B', 'C', 'D', 'A'])
    assert.deepEqual(toEnd.map((m) => m.id), ['A'])
    assert.ok(toEnd[0]!.key > 'a4')
    assert.deepEqual(after(schema, toEnd), ['이름', 'B', 'C', 'D', 'A'])
    // 제목까지 받으면 제목도 옮길 수 있다(함수는 종류를 모른다 — 무엇을 보낼지는 화면이 정한다).
    const toFront = planOrder(schema, ['D', '이름', 'A', 'B', 'C'])
    assert.deepEqual(after(schema, toFront), ['D', '이름', 'A', 'B', 'C'])
    assert.ok(toFront[0]!.key < 'a0')
  })
})
