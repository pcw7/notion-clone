// 접속자 표시의 순수 함수(AW-1 · F-05-03 · 정본 §3.7 presence [보강 AW-1]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { MAX_PRESENCE_SELECTION, presenceColor, presenceInitial, presencePeers, sameLocalPresence, sanitizePresence } from './presence.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ME = { user_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: '나' }
const NOW = 1_800_000_000_000

describe('sanitizePresence — 서버의 다듬기', () => {
  test('★ user 는 인증된 사람으로 덮어쓴다 — 클라이언트가 보낸 이름 · id 는 버린다 · 모르는 칸도 버린다', () => {
    const out = sanitizePresence({ user: { user_id: 'evil', name: '사칭' }, cursor: { block_id: A }, mode: 'edit', ts: NOW - 5, extra: 'x'.repeat(1000) }, ME, NOW)
    assert.deepEqual(out, { user: ME, cursor: { block_id: A }, block_selection: [], mode: 'edit', ts: NOW - 5 })
    assert.equal('extra' in out, false)
  })

  test('모양이 틀린 칸은 빈 값 — uuid 가 아닌 블록 · 모르는 모드 · 앞날의 ts', () => {
    assert.deepEqual(sanitizePresence({ cursor: { block_id: 'nope' }, block_selection: ['x', B], mode: 'admin', ts: NOW + 999_999 }, ME, NOW), {
      user: ME,
      cursor: null,
      block_selection: [B],
      mode: 'view',
      ts: NOW,
    })
    assert.deepEqual(sanitizePresence(null, ME, NOW).cursor, null)
  })

  test('불변식 S7 — 커서와 고른 블록이 함께 오면 커서만 · 고른 블록은 상한까지', () => {
    assert.deepEqual(sanitizePresence({ cursor: { block_id: A }, block_selection: [B] }, ME, NOW).block_selection, [])
    const many = Array.from({ length: MAX_PRESENCE_SELECTION + 10 }, () => B)
    assert.equal(sanitizePresence({ block_selection: many }, ME, NOW).block_selection.length, MAX_PRESENCE_SELECTION)
  })
})

describe('presencePeers — 화면의 동료 목록', () => {
  const state = (userId: string, name: string, blockId: string | null, ts: number) => ({
    user: { user_id: userId, name },
    cursor: blockId === null ? null : { block_id: blockId },
    block_selection: [],
    mode: 'edit',
    ts,
  })

  test('★ 자기 연결 · 자기 사람(다른 탭)은 빼고 같은 사람의 여러 탭은 가장 최근 하나 · 이름 차례', () => {
    const states = new Map<number, unknown>([
      [1, state(ME.user_id, '나', A, 10)],
      [2, state(ME.user_id, '나', B, 20)],
      [3, state('u-b', '보라', A, 5)],
      [4, state('u-b', '보라', B, 9)],
      [5, state('u-a', '가람', null, 1)],
      [6, { cursor: null }],
    ])
    const peers = presencePeers(states, 1, ME.user_id)
    assert.deepEqual(peers.map((p) => [p.name, p.blockId]), [['가람', null], ['보라', B]])
    assert.equal(peers[1]?.color, presenceColor('u-b'))
  })

  test('고른 블록만 있으면 그 첫째가 자리', () => {
    const states = new Map<number, unknown>([[9, { user: { user_id: 'u', name: '이' }, cursor: null, block_selection: [B, A], mode: 'view', ts: 1 }]])
    assert.equal(presencePeers(states, 1, null)[0]?.blockId, B)
  })
})

describe('색 · 글자 · 같은 상태', () => {
  test('같은 사람은 늘 같은 색 · 첫 글자', () => {
    assert.equal(presenceColor('abc'), presenceColor('abc'))
    assert.match(presenceColor('abc'), /^#[0-9a-f]{6}$/)
    assert.equal(presenceInitial('  보라 '), '보')
    assert.equal(presenceInitial('alice'), 'A')
    assert.equal(presenceInitial(''), '?')
  })

  test('같은 블록 안에서 움직이면 같은 상태다 — 다시 보내지 않는다', () => {
    const a = { cursor: { block_id: A }, block_selection: [], mode: 'edit' } as const
    assert.equal(sameLocalPresence(a, { cursor: { block_id: A }, block_selection: [], mode: 'edit' }), true)
    assert.equal(sameLocalPresence(a, { cursor: { block_id: B }, block_selection: [], mode: 'edit' }), false)
    assert.equal(sameLocalPresence(null, null), true)
    assert.equal(sameLocalPresence(a, null), false)
  })
})
