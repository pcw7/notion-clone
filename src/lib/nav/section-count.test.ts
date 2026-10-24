/**
 * 사이드바 섹션의 표시 개수 — §7 정리 10n-68 (F-07-16 · F-07-04)
 *
 *   ① ★ 고르지 않으면 지금 그대로(즐겨찾기 모두 · 최근 7) · 고르면 그것 · null 은 모두
 *   ② 저장된 값은 아는 섹션 · 고를 수 있는 개수만 읽는다
 *   ③ 그릴 줄 수 · 말
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { readSectionCounts, sectionCount, sectionCountLabel, visibleRowCount } from './section-count.ts'

describe('사이드바 섹션의 표시 개수 (10n-68)', () => {
  test('★ ① 기본은 지금 그대로 · 고르면 그것', () => {
    assert.equal(sectionCount({}, 'favorites'), null)
    assert.equal(sectionCount({}, 'recent'), 7)
    assert.equal(sectionCount({ favorites: 5 }, 'favorites'), 5)
    assert.equal(sectionCount({ recent: null }, 'recent'), null, '최근의 모두')
  })

  test('② 저장된 값 — 아는 섹션 · 고를 수 있는 개수만', () => {
    assert.deepEqual(readSectionCounts({ favorites: 10, recent: null, other: 5 }), { favorites: 10, recent: null })
    assert.deepEqual(readSectionCounts({ favorites: 7, recent: '5' }), {}, '고를 수 없는 7 · 글자 5')
    assert.deepEqual(readSectionCounts(null), {})
    assert.deepEqual(readSectionCounts('x'), {})
  })

  test('③ 그릴 줄 수 · 말', () => {
    assert.equal(visibleRowCount(12, 5), 5)
    assert.equal(visibleRowCount(3, 5), 3)
    assert.equal(visibleRowCount(12, null), 12)
    assert.equal(sectionCountLabel(10), '10개')
    assert.equal(sectionCountLabel(null), '모두')
  })
})
