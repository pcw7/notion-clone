// 지금 보는 사람의 순수 부분(AW-2 · F-05-03 · 정본 §3.7 presence [보강 AW-2]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { presenceKey, viewersOf } from './presence-registry.ts'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'

describe('viewersOf — awareness 에서 사람마다 보이는 탭이 있는지', () => {
  test('★ 같은 사람의 탭 중 하나라도 보이면 보는 사람 · 숨은 탭뿐이면 아니다', () => {
    const states = new Map<number, unknown>([
      [1, { user: { user_id: A, name: '가' }, visible: false }],
      [2, { user: { user_id: A, name: '가' }, visible: true }],
      [3, { user: { user_id: B, name: '나' }, visible: false }],
    ])
    assert.deepEqual([...viewersOf(states)], [[A, true], [B, false]])
  })

  test('서버가 채운 사람이 없는 상태는 버린다 · 보이는지 모르면 보지 않는 것', () => {
    const states = new Map<number, unknown>([
      [1, null],
      [2, { cursor: null }],
      [3, { user: { name: '이름만' }, visible: true }],
      [4, { user: { user_id: A, name: '가' } }],
    ])
    assert.deepEqual([...viewersOf(states)], [[A, false]])
  })

  test('키는 페이지마다', () => {
    assert.equal(presenceKey(A), `presence:${A}`)
  })
})
