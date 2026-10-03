/**
 * 버전의 보관 기간 — 잔여 묶음 8d-1 (F-11-01 · 순수)
 *
 * F-11-01 *"Free 7일 / Plus 30일 / Business 90일 / Enterprise Any number of days"* · 모르는 요금제는 가장 짧은 값.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { versionRetentionDays } from './retention.ts'

test('요금제마다 — Free 7 · Plus 30 · Business 90 · Enterprise 무제한(null) · 모르는 요금제는 Free 와 같다', () => {
  assert.deepEqual(
    ['free', 'plus', 'business', 'enterprise', 'team', '', 'constructor', 'toString'].map(versionRetentionDays),
    [7, 30, 90, null, 7, 7, 7, 7],
  )
})
