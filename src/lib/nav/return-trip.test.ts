/**
 * 되돌아간 자리 — 렌더 표지 · 스크롤 자리 (NV-2 · F-07-12 · 정본 §3.9 [보강 NV-0] ⑦ [NV-2 고침] · ⑨ [NV-2])
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createRenderMarks, createScrollMemory, restoreTarget, restoreY } from './return-trip.ts'

describe('렌더 표지 — 받아 둔 렌더를 다시 그렸는가', () => {
  test('★ 처음 붙는 표지는 서버가 이미 남겼다 · 같은 표지를 다시 붙이면 다시 그린 것(뒤로 · 앞으로) — 다시 그릴 때마다', () => {
    const marks = createRenderMarks()
    assert.equal(marks.firstMount('r1'), true)
    assert.equal(marks.firstMount('r1'), false)
    assert.equal(marks.firstMount('r1'), false)
    // 새 서버 렌더(새로 열기 · 다시 묻기)는 새 표지다
    assert.equal(marks.firstMount('r2'), true)
  })

  test('가장 먼저 본 것부터 버린다 — 버린 표지를 다시 그리면 처음으로 센다(방문이 빠지지 않고 한 번 덜 셀 뿐)', () => {
    const marks = createRenderMarks(2)
    marks.firstMount('a')
    marks.firstMount('b')
    marks.firstMount('c')
    assert.equal(marks.firstMount('a'), true)
    assert.equal(marks.firstMount('c'), false)
  })
})

describe('스크롤 자리 — 항목마다', () => {
  const P = '/w/ws/page'

  test('★ 항목마다 따로 · 다시 적으면 바뀐다', () => {
    const memory = createScrollMemory()
    memory.remember('e1', { y: 1200, path: P })
    memory.remember('e2', { y: 300, path: P })
    memory.remember('e1', { y: 1500, path: P })
    assert.equal(memory.recall('e1')?.y, 1500)
    assert.equal(memory.recall('e2')?.y, 300)
    assert.equal(memory.recall('e3'), undefined)
  })

  test('가장 오래 손대지 않은 항목부터 버린다', () => {
    const memory = createScrollMemory(2)
    memory.remember('a', { y: 1, path: P })
    memory.remember('b', { y: 2, path: P })
    memory.remember('a', { y: 3, path: P }) // a 가 다시 최근
    memory.remember('c', { y: 4, path: P })
    assert.equal(memory.recall('b'), undefined)
    assert.equal(memory.recall('a')?.y, 3)
    assert.equal(memory.recall('c')?.y, 4)
  })

  test('★ 복원할 곳 — 적어 둔 자리가 있고 · 같은 경로이고 · 맨 위가 아니고 · 블록 해시가 없을 때만', () => {
    assert.equal(restoreTarget({ y: 1200, path: P }, P, ''), 1200)
    assert.equal(restoreTarget(undefined, P, ''), null) // 처음 온 항목(새로 연 것)
    assert.equal(restoreTarget({ y: 0, path: P }, P, ''), null)
    assert.equal(restoreTarget({ y: 1200, path: P }, P, '#block-1'), null) // 블록으로 가기가 이긴다
    // 항목 자리를 다른 화면이 바꿔 썼다(replace — key 가 같다) — 그 화면의 자리가 아니다
    assert.equal(restoreTarget({ y: 1200, path: P }, '/w/ws/other', ''), null)
  })

  test('★ 문서가 아직 짧으면 갈 수 있는 끝까지 — 자라면 그 자리', () => {
    assert.equal(restoreY(3000, 1500, 800), 700)
    assert.equal(restoreY(3000, 5000, 800), 3000)
    assert.equal(restoreY(3000, 600, 800), 0)
  })
})
