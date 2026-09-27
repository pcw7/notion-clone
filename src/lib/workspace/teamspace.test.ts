/**
 * teamspace 의 순수 규칙 — 7c-14조각 (DB 없음)
 *
 * 아이콘은 **이모지 한 글자**다(grapheme 하나). DB 의 CHECK(0032)는 길이 · 공백만 막으므로 "한 글자 · 이모지"는 이 함수가
 * 지키는 전부다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_TEAMSPACE_ICON_CODE_POINTS, normalizeTeamspaceIcon } from './teamspace.ts'

test('★ 이모지 한 글자는 받는다 — 여러 코드포인트로 된 한 글자(가족 · 피부색 · 깃발 · 변이 선택자)도', () => {
  for (const icon of ['🚀', '⭐', '👨‍👩‍👧‍👦', '👍🏽', '🇰🇷', '🛠️', '❤']) {
    assert.equal(normalizeTeamspaceIcon(icon), icon, icon)
  }
  assert.equal(normalizeTeamspaceIcon('  🚀 '), '🚀', '앞뒤 공백은 벗긴다')
})

test('없음 — null · 빈 글 · 공백뿐인 글은 아이콘을 지운다', () => {
  for (const raw of [null, '', '   ']) assert.equal(normalizeTeamspaceIcon(raw), null, JSON.stringify(raw))
})

test('★ 모양이 아니면 undefined — 두 글자 · 글자 · 숫자 · 섞인 것 · 너무 긴 것 · 문자열이 아닌 것', () => {
  const tooLong = '👨‍👩‍👧‍👦'.repeat(3) // 한 글자씩 보면 이모지지만 셋이고 코드포인트도 넘는다
  assert.ok([...tooLong].length > MAX_TEAMSPACE_ICON_CODE_POINTS)
  for (const raw of ['🚀🚀', 'a', 'ab', '1', 'a🚀', '🚀 x', tooLong, 123, {}, undefined]) {
    assert.equal(normalizeTeamspaceIcon(raw), undefined, JSON.stringify(raw))
  }
})
