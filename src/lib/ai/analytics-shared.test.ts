/**
 * AI 사용량 분석 — UTC 날 묶기 · 기능마다 쌓기 · 활동 기록의 커서 (AI-7 · F-10-25 · 순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AI_USAGE_DAYS, dailySeries, decodeLogCursor, encodeLogCursor, shortDay, stackDay, utcDaysEnding } from './analytics-shared.ts'

test('★ UTC 날 — 오늘이 끝인 30일 · 보는 곳의 자정이 아니라 UTC 자정에서 넘어간다 · 달 · 해의 경계', () => {
  // 서울 2026-12-01 08:30 = UTC 2026-11-30 23:30 — UTC 날은 아직 11-30
  const days = utcDaysEnding(new Date('2026-11-30T23:30:00Z'))
  assert.equal(days.length, AI_USAGE_DAYS)
  assert.equal(days.at(-1), '2026-11-30')
  assert.equal(days[0], '2026-11-01')
  assert.deepEqual(utcDaysEnding(new Date('2027-01-02T00:00:00Z'), 4), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  assert.deepEqual(utcDaysEnding(new Date('2028-03-01T12:00:00Z'), 3), ['2028-02-28', '2028-02-29', '2028-03-01'], '윤일')
  assert.equal(shortDay('2026-01-05'), '1/5')
})

test('★ 날 · 기능마다 묶음 → 쌓을 열 — 범위 밖 · 모르는 기능 · 0 이하는 버리고 같은 칸은 더한다 · 날마다 합', () => {
  const now = new Date('2026-11-22T10:00:00Z')
  const s = dailySeries(
    [
      { day: '2026-11-22', feature: 'chat', responses: 2 },
      { day: '2026-11-22', feature: 'ask', responses: 3 },
      { day: '2026-11-22', feature: 'chat', responses: 1 },
      { day: '2026-11-20', feature: 'translate', responses: 4 },
      { day: '2026-10-23', feature: 'edit', responses: 1 },
      { day: '2026-10-22', feature: 'edit', responses: 9 },
      { day: '2026-11-23', feature: 'edit', responses: 9 },
      { day: '2026-11-21', feature: 'summarize', responses: 9 },
      { day: '2026-11-21', feature: 'block', responses: 0 },
    ],
    now,
  )
  assert.equal(s.days.length, 30)
  assert.equal(s.days[0], '2026-10-24')
  assert.deepEqual(s.byFeature.chat.slice(-1), [3])
  assert.deepEqual(s.byFeature.ask.slice(-1), [3])
  assert.equal(s.byFeature.translate[27], 4)
  assert.equal(s.byFeature.edit.reduce((a, b) => a + b, 0), 0, '30일 밖(10-22 · 10-23)과 내일은 버린다')
  assert.equal(s.byFeature.block.reduce((a, b) => a + b, 0), 0)
  assert.equal(s.totals.at(-1), 6)
  assert.equal(s.totals.reduce((a, b) => a + b, 0), 10)

  // 쌓기 — 기능 차례(묻기 → … → 채팅) · 0 인 기능은 뺀다 · 조각이 이어진다
  assert.deepEqual(stackDay(s, 29), [
    { feature: 'ask', value: 3, from: 0, to: 3 },
    { feature: 'chat', value: 3, from: 3, to: 6 },
  ])
  assert.deepEqual(stackDay(s, 0), [])
})

test('★ 커서 — 마이크로초 · id 를 그대로 되돌린다 · 모양이 틀리면 null', () => {
  const id = '0f6d4c62-5a8e-4f7b-9c1d-2e3f4a5b6c7d'
  const c = encodeLogCursor('1763811234567891', id.toUpperCase())
  assert.equal(c, `1763811234567891_${id}`)
  assert.deepEqual(decodeLogCursor(c), { micros: '1763811234567891', id })
  for (const bad of [null, 3, '', 'x', `abc_${id}`, `1763811234567891_${id.slice(1)}`, `1763811234567891-${id}`, `${'9'.repeat(18)}_${id}`, `-1_${id}`]) {
    assert.equal(decodeLogCursor(bad), null, String(bad))
  }
})
