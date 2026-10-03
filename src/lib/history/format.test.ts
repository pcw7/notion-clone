/**
 * 버전 기록 화면의 글자 — 잔여 묶음 8d-2 (F-11-01 · 순수)
 *
 *   ① 시각 — 오늘 · 올해 · 다른 해(그 시간대의 날짜로 가른다)
 *   ② 고친 사람 — 셋까지 이름 · 넘으면 "외 N명" · 없으면 빈 글
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatEditors, formatVersionTime } from './format.ts'

const SEOUL = 'Asia/Seoul'

test('① 시각 — 오늘 · 올해 · 다른 해 · 날짜는 그 시간대로 가른다', () => {
  const now = new Date('2026-10-03T06:00:00Z') // 서울 10월 3일 15:00
  assert.equal(formatVersionTime('2026-10-03T05:12:00Z', now, SEOUL), '오늘 오후 2:12')
  assert.equal(formatVersionTime('2026-10-02T14:59:00Z', now, SEOUL), '10월 2일 오후 11:59')
  assert.equal(formatVersionTime('2026-10-02T15:01:00Z', now, SEOUL), '오늘 오전 12:01', 'UTC 로는 어제지만 서울로는 오늘이다')
  assert.equal(formatVersionTime('2025-12-31T01:00:00Z', now, SEOUL), '2025년 12월 31일 오전 10:00')
})

test('② 고친 사람 — 셋까지 이름 · 넘으면 외 N명 · 없으면 빈 글 · 이름이 비면 "이름 없음"', () => {
  const people = (...names: string[]) => names.map((name) => ({ name }))
  assert.equal(formatEditors([]), '')
  assert.equal(formatEditors(people('가', '나')), '가 · 나')
  assert.equal(formatEditors(people('가', '나', '다')), '가 · 나 · 다')
  assert.equal(formatEditors(people('가', '나', '다', '라', '마')), '가 · 나 · 다 외 2명')
  assert.equal(formatEditors(people('')), '이름 없음')
})
