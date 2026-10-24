import assert from 'node:assert/strict'
import { test } from 'node:test'

import { overlayVisits, pushVisit, VISIT_MEMORY } from './recent-overlay.ts'

const row = (id: string) => ({ id, title: id.toUpperCase() })
const known = new Map(['a', 'b', 'c', 'x', 'y', 'z'].map((id) => [id, row(id)]))
const find = (id: string) => known.get(id) ?? null

test('★ ① 연 차례대로 맨 앞 — 서버 목록에 있으면 옮기고 없으면 아는 줄을 넣는다', () => {
  const server = [row('x'), row('y'), row('z')]
  assert.deepEqual(overlayVisits(server, ['y'], find, 20).map((r) => r.id), ['y', 'x', 'z'], '있으면 맨 앞으로 옮긴다')
  assert.deepEqual(overlayVisits(server, ['b', 'a'], find, 20).map((r) => r.id), ['b', 'a', 'x', 'y', 'z'], '없으면 넣는다 · 새 것이 맨 앞')
  assert.deepEqual(overlayVisits(server, [], find, 20).map((r) => r.id), ['x', 'y', 'z'], '방문이 없으면 그대로')
})

test('② 모르는 페이지는 건너뛴다 · 길이는 상한까지 · 서버의 줄이 이긴다(제목이 더 새것)', () => {
  const server = [row('x'), { id: 'y', title: '서버 제목' }]
  assert.deepEqual(overlayVisits(server, ['settings', 'y', '없는'], find, 20).map((r) => r.id), ['y', 'x'])
  assert.equal(overlayVisits(server, ['y'], find, 20)[0].title, '서버 제목')
  assert.deepEqual(overlayVisits(server, ['a', 'b', 'c'], find, 3).map((r) => r.id), ['a', 'b', 'c'])
})

test('③ 방문 더하기 — 새 것이 앞 · 같은 페이지는 한 번 · 같으면 같은 배열 · 기억은 상한까지', () => {
  assert.deepEqual(pushVisit(['a', 'b'], 'b'), ['b', 'a'])
  const same = ['a', 'b'] as const
  assert.equal(pushVisit(same, 'a'), same, '맨 앞이 그대로면 바꾸지 않는다')
  const many = Array.from({ length: VISIT_MEMORY }, (_, i) => `p${i}`)
  const pushed = pushVisit(many, 'new')
  assert.equal(pushed.length, VISIT_MEMORY)
  assert.equal(pushed[0], 'new')
})
