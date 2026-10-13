/**
 * 폼의 응답 상한 · 마감 시각 — 인접 제품 7b-2 (F-13-02 · F-17-10 계층 7 · 순수)
 *
 * 이 파일이 지키는 것(정본 §3.6 끝 [보강] 폼 ⑩).
 *
 *   ① ★ 닫힘 판정 — 마감 시각이 먼저 · 시각이 지났거나 꼭 그 시각이면 닫힘 · 상한에 닿으면(같아도) 닫힘 · 둘 다 없으면 열림
 *   ② 받는 값 — 상한은 1~100,000 의 정수(null 은 없음) · 마감 시각은 시간대가 붙은 ISO(null 은 없음 · ISO Z 로 맞춘다)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_RESPONSES_LIMIT, formClosedReason, parseClosesAt, parseMaxResponses } from './form-limits.ts'

const NOW = Date.parse('2026-10-13T12:00:00Z')

describe('① ★ 닫힘 판정', () => {
  test('마감 시각이 먼저 · 꼭 그 시각이면 닫힘 · 상한은 같아도 닫힘 · 둘 다 없으면 열림', () => {
    const open = { maxResponses: null, closesAt: null }
    assert.equal(formClosedReason(open, 99, NOW), null)
    assert.equal(formClosedReason({ maxResponses: 3, closesAt: null }, 2, NOW), null)
    assert.equal(formClosedReason({ maxResponses: 3, closesAt: null }, 3, NOW), 'limit')
    assert.equal(formClosedReason({ maxResponses: null, closesAt: '2026-10-13T12:00:00.000Z' }, 0, NOW), 'time', '꼭 그 시각')
    assert.equal(formClosedReason({ maxResponses: null, closesAt: '2026-10-13T12:00:01.000Z' }, 0, NOW), null)
    assert.equal(formClosedReason({ maxResponses: 1, closesAt: '2026-10-13T11:00:00.000Z' }, 5, NOW), 'time', '둘 다 넘으면 시각이 까닭이다')
  })
})

describe('② 받는 값', () => {
  test('상한 — 1~100,000 의 정수 · null 은 없음', () => {
    assert.equal(parseMaxResponses(null), null)
    assert.equal(parseMaxResponses(1), 1)
    assert.equal(parseMaxResponses(MAX_RESPONSES_LIMIT), MAX_RESPONSES_LIMIT)
    for (const bad of [0, -1, 1.5, MAX_RESPONSES_LIMIT + 1, '3', NaN, undefined]) assert.equal(parseMaxResponses(bad), undefined, String(bad))
  })

  test('마감 시각 — 시간대가 붙은 ISO 만 · ISO Z 로 맞춘다 · null 은 없음', () => {
    assert.equal(parseClosesAt(null), null)
    assert.equal(parseClosesAt('2026-11-01T09:00+09:00'), '2026-11-01T00:00:00.000Z')
    assert.equal(parseClosesAt('2026-11-01T00:00:00Z'), '2026-11-01T00:00:00.000Z')
    for (const bad of ['2026-11-01T09:00', '2026-11-01', 'tomorrow', 7, '2026-13-01T00:00Z', 'x'.repeat(41)]) {
      assert.equal(parseClosesAt(bad), undefined, String(bad))
    }
  })
})
