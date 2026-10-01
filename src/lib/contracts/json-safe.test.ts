/**
 * JSON 안전 거르기 — 잔여 묶음 8a-2 (정본 §3.4 [보강] 코드 블록 ⑧ · DOM · DB 없음)
 *
 *   ① ★ 멀쩡하면 같은 객체 — 정규화가 읽을 때마다 부른다
 *   ② ★ 나타낼 수 없는 값은 뺀다 — 객체면 그 키, 배열이면 그 원소. 값 자체면 undefined. 던지지 않는다
 *   ③ 깊이 상한 · 프로토타입이 바뀐 객체
 *   ④ ★ U+0000 은 U+FFFD 로 — 문자열 · 키(jsonb 가 거부한다) · 깊이 검사(저장 API 가 거부한다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as Y from 'yjs'

import { exceedsJsonDepth, isPlainRecord, jsonSafe, MAX_JSON_DEPTH, sameJsonValue, withoutNul } from './json-safe.ts'

test('★ ① 멀쩡하면 같은 객체', () => {
  const value = { a: [1, 'x', null, true, { b: [] }], c: { d: -0.5 } }
  assert.equal(jsonSafe(value), value)
  const list = [{ a: 1 }, null]
  assert.equal(jsonSafe(list), list)
  for (const primitive of [null, 'x', 0, false]) assert.equal(jsonSafe(primitive), primitive)
})

test('★ ② 나타낼 수 없는 값 — 키 · 원소를 빼고 · 값 자체면 undefined · 던지지 않는다', () => {
  const nested = { keep: 1, big: 10n, bytes: new Uint8Array([1]), type: new Y.Map(), nan: Number.NaN, inf: Infinity, list: [1, 2n, undefined, 'x'] }
  const out = jsonSafe({ outer: nested, fine: { a: 1 } }) as Record<string, unknown>
  assert.deepEqual(out, { outer: { keep: 1, list: [1, 'x'] }, fine: { a: 1 } })
  // 바뀌지 않은 가지는 같은 객체다.
  const fine = { a: 1 }
  assert.equal((jsonSafe({ x: 1n, fine }) as { fine: unknown }).fine, fine)
  for (const bad of [1n, undefined, new Uint8Array(), new Y.Doc(), () => 1, Symbol('s'), Number.NaN]) {
    assert.equal(jsonSafe(bad), undefined, String(typeof bad))
  }
  assert.doesNotThrow(() => JSON.stringify(jsonSafe({ x: [{ y: 5n }] })))
})

test('③ 깊이 상한을 넘는 가지는 빠진다 · 프로토타입이 바뀐 객체는 빠진다', () => {
  let deep: unknown = 'bottom'
  for (let i = 0; i < MAX_JSON_DEPTH + 5; i += 1) deep = [deep]
  let cut: unknown
  assert.doesNotThrow(() => {
    cut = jsonSafe(deep)
  })
  assert.notEqual(cut, deep, '상한을 넘는 가지를 남겼다')
  assert.equal(exceedsJsonDepth(cut), false, '거른 값이 여전히 상한보다 깊다')
  // 같음 비교도 상한에서 멈춘다 — 같은 모양이어도 상한보다 깊으면 같다고 하지 않는다(쓰기 쪽 가드가 그런 값을 쓰지 않는다).
  assert.equal(sameJsonValue(deep, JSON.parse(JSON.stringify(deep))), false)
  const shallow = { a: { b: 1 } }
  assert.equal(jsonSafe(shallow), shallow)

  const polluted = Object.create({ language: 'x' }) as Record<string, unknown>
  polluted.own = 1
  assert.deepEqual(jsonSafe({ polluted, ok: 1 }), { ok: 1 })
  assert.equal(isPlainRecord(polluted), false)
  assert.equal(isPlainRecord(Object.create(null)), true)
  assert.equal(isPlainRecord(new Uint8Array()), false)
  assert.equal(isPlainRecord([]), false)
})

test('★ ④ U+0000 은 U+FFFD 로 — 문자열 · 키 · 멀쩡하면 같은 객체', () => {
  assert.equal(withoutNul('a\u0000b\u0000'), 'a\uFFFDb\uFFFD')
  const fine = 'no nul'
  assert.equal(withoutNul(fine), fine)
  assert.deepEqual(jsonSafe({ caption: ['x\u0000y'], ['k\u0000']: 1 }), { caption: ['x\uFFFDy'], ['k\uFFFD']: 1 })
  const clean = { a: ['b'] }
  assert.equal(jsonSafe(clean), clean)
  assert.equal(JSON.stringify(jsonSafe({ t: '\u0000' })).includes('\\u0000'), false, 'jsonb 가 거부하는 글자가 남았다')
})

test('④ 깊이 검사 — 읽기가 잘라 낼 만큼 깊은가 · 같음 비교는 null 과 없음 · 배열과 객체를 가른다', () => {
  let deep: unknown = 1
  for (let i = 0; i < MAX_JSON_DEPTH; i += 1) deep = { d: deep }
  assert.equal(exceedsJsonDepth(deep), false, '상한 안쪽을 거부했다')
  assert.equal(exceedsJsonDepth({ d: deep }), true)
  assert.equal(exceedsJsonDepth('text'), false)
  assert.equal(sameJsonValue({ a: null }, {}), false)
  assert.equal(sameJsonValue([], {}), false)
  assert.equal(sameJsonValue({ a: [1, { b: 2n }] }, { a: [1, { b: 2n }] }), true)
})
