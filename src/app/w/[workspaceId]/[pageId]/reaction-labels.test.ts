/**
 * 코멘트 반응의 글자 — 인접 제품 7c-3d-1 (F-05-08 · 순수)
 *
 * 이 파일이 지키는 것(정본 §3.9 [보강] 반응 화면 ①②).
 *
 *   ① 칩의 title — 누른 순 · 나는 "나" · 모르는 사람은 "알 수 없는 사용자"
 *   ② 칩의 읽는 이름 — 이모지 · 수 · 내가 눌렀는가
 *   ③ 빠른 고르개는 여덟 · 겹치지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { QUICK_REACTIONS, reactionLabel, reactionTitle } from './reaction-labels.ts'

test('① 칩의 title — 누른 순 · 나는 나 · 모르는 사람', () => {
  const names: Record<string, string> = { u1: '박동료' }
  const nameOf = (id: string) => names[id] ?? null
  assert.equal(reactionTitle(['u1', 'me', 'ghost'], 'me', nameOf), '박동료 · 나 · 알 수 없는 사용자')
  assert.equal(reactionTitle([], 'me', nameOf), '')
})

test('② 칩의 읽는 이름 — 내가 눌렀는가까지', () => {
  assert.equal(reactionLabel('👍', 2, true), '👍 반응 2명, 나도 눌렀습니다')
  assert.equal(reactionLabel('🎉', 1, false), '🎉 반응 1명')
})

test('③ 빠른 고르개는 여덟 · 겹치지 않는다', () => {
  assert.equal(QUICK_REACTIONS.length, 8)
  assert.equal(new Set(QUICK_REACTIONS).size, 8)
})
