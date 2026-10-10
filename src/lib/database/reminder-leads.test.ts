/**
 * 리마인더의 리드 — 4c-3 (DOM · DB 없음)
 *
 *   ① 값의 모양마다 목록이 다르다 — 날짜만은 그날 · 하루 · 이틀 · 일주일 전, 시각은 그 시각 ~ 하루 전
 *   ② 사람의 말 — 날짜만이면 "… 오전 9시", 시각이면 "30분 전" · "2시간 전" · "하루 전"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DATE_ONLY_LEADS, DATE_TIME_LEADS, isDateOnlyStart, leadLabel, leadsFor } from './reminder-leads.ts'

test('① 값의 모양마다 목록이 다르다', () => {
  assert.equal(isDateOnlyStart('2030-05-01'), true)
  assert.equal(isDateOnlyStart('2030-05-01T09:00:00+09:00'), false)
  assert.deepEqual(leadsFor('2030-05-01'), DATE_ONLY_LEADS)
  assert.deepEqual(leadsFor('2030-05-01T09:00'), DATE_TIME_LEADS)
})

test('★ ② 사람의 말 — 날짜만은 오전 9시 · 시각은 분 · 시간 · 하루', () => {
  assert.deepEqual(
    DATE_ONLY_LEADS.map((l) => leadLabel(l, true)),
    ['그날 오전 9시', '하루 전 오전 9시', '이틀 전 오전 9시', '일주일 전 오전 9시'],
  )
  assert.deepEqual(
    DATE_TIME_LEADS.map((l) => leadLabel(l, false)),
    ['그 시각', '5분 전', '10분 전', '15분 전', '30분 전', '1시간 전', '2시간 전', '하루 전'],
  )
  assert.equal(new Set(DATE_TIME_LEADS.map((l) => leadLabel(l, false))).size, DATE_TIME_LEADS.length, '말이 겹치지 않는다')
})
