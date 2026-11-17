/**
 * AI 한도의 셈 — 차례 · 풀리는 시각 · UTC 경계 · 보충 (AI-1 · F-10-12 · DB 없음)
 *
 *   ① 차례 — 하루 → 창 · 월(요금제 몫) → 체험 → 보충 · 하루 상한은 보충도 넘지 못한다
 *   ② 풀리는 시각 — 창은 오래된 것이 벗어날 때 · 월은 다음 UTC 달 · 하루는 다음 UTC 날 · 둘 다 막히면 늦은 쪽 · 체험은 null
 *   ③ UTC 경계 — 날 · 달의 시작(서울 시각이 아니다) · 12월 → 1월
 *   ④ 보충 — 만료가 이른 것부터 · 만료 · 다 쓴 것은 건너뛴다
 *   ⑤ 화면의 모양 — 남은 수 · 무제한
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  aiQuotaView,
  decideAiQuota,
  isAiFeature,
  nextUtcDay,
  nextUtcMonthStart,
  pickGrant,
  utcDayOf,
  utcMonthStart,
  windowResetAt,
  type AiCounts,
  type AiGrantLeft,
  type AiLimits,
} from './quota.ts'

const T = (iso: string) => new Date(iso)
const NOW = T('2031-03-15T10:00:00Z')
const BUSINESS: AiLimits = { trial: 0, monthly: 1000, window: 100 }
const FREE: AiLimits = { trial: 20, monthly: 0, window: 0 }
const counts = (over: Partial<AiCounts> = {}): AiCounts => ({ trial: 0, month: 0, windowTimes: [], ...over })
const DAILY = { used: 0, cap: 900 }
const times = (n: number, from = T('2031-03-15T05:00:00Z'), stepMs = 60_000) => Array.from({ length: n }, (_, i) => new Date(from.getTime() + i * stepMs))
const grant = (id: string, left: number, expiresAt: string | null, grantedAt = '2031-03-01T00:00:00Z'): AiGrantLeft => ({
  id,
  left,
  grantedAt: T(grantedAt),
  expiresAt: expiresAt === null ? null : T(expiresAt),
})

test('★ ① 차례 — 요금제 몫 → 체험 → 보충 · 하루 상한이 가장 먼저(보충도 넘지 못한다)', () => {
  assert.deepEqual(decideAiQuota(NOW, BUSINESS, counts(), [], DAILY), { ok: true, quota: 'plan' })
  assert.deepEqual(decideAiQuota(NOW, FREE, counts(), [], DAILY), { ok: true, quota: 'trial' }, 'Free 는 월 몫이 없다 — 창 0 이 막지 않는다')
  assert.deepEqual(decideAiQuota(NOW, FREE, counts({ trial: 20 }), [grant('g', 1, null)], DAILY), { ok: true, quota: 'grant', grantId: 'g' })
  assert.deepEqual(decideAiQuota(NOW, BUSINESS, counts({ month: 1000 }), [grant('g', 1, null)], DAILY), { ok: true, quota: 'grant', grantId: 'g' })
  // 하루 상한 — 보충이 있어도
  assert.deepEqual(decideAiQuota(NOW, BUSINESS, counts(), [grant('g', 5, null)], { used: 900, cap: 900 }), {
    ok: false,
    limit: 'daily',
    resetsAt: T('2031-03-16T00:00:00Z'),
  })
  assert.equal(decideAiQuota(NOW, BUSINESS, counts(), [], { used: 0, cap: 0 }).ok, false, '상한 0 은 닫는다')
  // 체험을 다 쓴 Free · 보충 없음
  assert.deepEqual(decideAiQuota(NOW, FREE, counts({ trial: 20 }), [], DAILY), { ok: false, limit: 'trial', resetsAt: null })
  // 무제한(null)
  assert.deepEqual(decideAiQuota(NOW, { trial: 0, monthly: null, window: null }, counts({ month: 10 ** 6 }), [], DAILY), { ok: true, quota: 'plan' })
  // 몫이 하나도 없는 요금제 — 체험으로 거부(보충이 필요하다)
  assert.deepEqual(decideAiQuota(NOW, { trial: 0, monthly: 0, window: 0 }, counts(), [], DAILY), { ok: false, limit: 'trial', resetsAt: null })
})

test('★ ② 풀리는 시각 — 창 · 월 · 둘 다면 늦은 쪽', () => {
  // 창 100 이 찼다 — 가장 오래된 것(05:00)이 벗어나는 11:00
  const full = times(100)
  assert.deepEqual(decideAiQuota(NOW, BUSINESS, counts({ month: 100, windowTimes: full }), [], DAILY), {
    ok: false,
    limit: 'window',
    resetsAt: T('2031-03-15T11:00:00Z'),
  })
  // 한도를 셋 넘었다(한도가 줄었다) — 넷이 벗어나야 한다 → 넷째(05:03) + 6시간
  assert.deepEqual(windowResetAt(times(103), 100), T('2031-03-15T11:03:00Z'))
  assert.equal(windowResetAt(times(99), 100), null, '한도 아래')
  assert.equal(windowResetAt(times(3), 0), null, '한도 0 은 풀리지 않는다')
  // 월이 찼다 — 다음 UTC 달
  assert.deepEqual(decideAiQuota(NOW, BUSINESS, counts({ month: 1000, windowTimes: times(5) }), [], DAILY), {
    ok: false,
    limit: 'month',
    resetsAt: T('2031-04-01T00:00:00Z'),
  })
  // 둘 다 — 달의 끝 23:00 · 창은 20:00 부터 차 있다 → 월은 자정에, 창은 02:00 에 풀린다 → 늦은 창
  const lateNow = T('2031-03-31T23:00:00Z')
  const lateWindow = times(100, T('2031-03-31T20:00:00Z'), 1000)
  assert.deepEqual(decideAiQuota(lateNow, BUSINESS, counts({ month: 1000, windowTimes: lateWindow }), [], DAILY), {
    ok: false,
    limit: 'window',
    resetsAt: T('2031-04-01T02:00:00Z'),
  })
  // 둘 다 — 창이 일찍 풀리면 월
  assert.equal((decideAiQuota(NOW, BUSINESS, counts({ month: 1000, windowTimes: full }), [], DAILY) as { limit: string }).limit, 'month')
})

test('★ ③ UTC 경계 — 날 · 달은 UTC(서울 자정이 아니다) · 12월 다음은 1월', () => {
  const seoulMidnight = T('2031-03-14T15:00:00Z') // 서울 3월 15일 00:00
  assert.equal(utcDayOf(seoulMidnight), '2031-03-14')
  assert.deepEqual(nextUtcDay(seoulMidnight), T('2031-03-15T00:00:00Z'))
  assert.equal(utcDayOf(T('2031-03-14T23:59:59.999Z')), '2031-03-14')
  assert.equal(utcDayOf(T('2031-03-15T00:00:00Z')), '2031-03-15')
  assert.deepEqual(utcMonthStart(T('2031-03-31T23:59:59Z')), T('2031-03-01T00:00:00Z'))
  assert.deepEqual(nextUtcMonthStart(T('2031-12-31T23:00:00Z')), T('2032-01-01T00:00:00Z'))
  assert.deepEqual(nextUtcDay(T('2032-02-28T12:00:00Z')), T('2032-02-29T00:00:00Z'), '윤년')
})

test('★ ④ 보충 — 만료가 이른 것부터 · 만료 · 다 쓴 것은 건너뛴다 · 같으면 먼저 준 것', () => {
  const gs = [
    grant('forever', 5, null),
    grant('late', 5, '2031-05-01T00:00:00Z'),
    grant('soon', 5, '2031-03-20T00:00:00Z'),
    grant('expired', 5, '2031-03-15T10:00:00Z'), // 지금 만료 — 쓰지 않는다
    grant('empty', 0, '2031-03-16T00:00:00Z'),
  ]
  assert.equal(pickGrant(gs, NOW)?.id, 'soon')
  assert.equal(pickGrant([grant('b', 1, null, '2031-03-02T00:00:00Z'), grant('a', 1, null, '2031-03-01T00:00:00Z')], NOW)?.id, 'a')
  assert.equal(pickGrant([grant('x', 3, '2031-03-15T09:59:59Z')], NOW), null)
})

test('⑤ 화면의 모양 — 몫 · 남은 수 · 무제한 · 보충의 가장 이른 만료', () => {
  const free = aiQuotaView(NOW, FREE, counts({ trial: 3 }), [grant('g', 2, '2031-04-01T00:00:00Z')])
  assert.equal(free.kind, 'trial')
  assert.equal(free.window, null)
  assert.equal(free.month, null)
  assert.deepEqual(free.trial, { used: 3, limit: 20 })
  assert.equal(free.grantsLeft, 2)
  assert.equal(free.grantsExpireAt, '2031-04-01T00:00:00.000Z')
  assert.equal(free.remaining, 17 + 2)

  const biz = aiQuotaView(NOW, BUSINESS, counts({ month: 950, windowTimes: times(10) }), [])
  assert.equal(biz.kind, 'plan')
  assert.deepEqual(biz.window, { used: 10, limit: 100, resetsAt: null })
  assert.deepEqual(biz.month, { used: 950, limit: 1000, resetsAt: '2031-04-01T00:00:00.000Z' })
  assert.equal(biz.trial, null, 'Business 는 체험이 없다')
  assert.equal(biz.remaining, 50, '창 90 · 월 50 — 작은 쪽')

  const unlimited = aiQuotaView(NOW, { trial: 0, monthly: null, window: null }, counts(), [])
  assert.equal(unlimited.remaining, null)
  const none = aiQuotaView(NOW, { trial: 0, monthly: 0, window: 0 }, counts(), [])
  assert.equal(none.kind, 'none')
  assert.equal(none.remaining, 0)
})

test('기능의 닫힌 목록', () => {
  assert.ok(isAiFeature('ask'))
  assert.ok(isAiFeature('chat'))
  assert.ok(!isAiFeature('summarize'))
  assert.ok(!isAiFeature(1))
})
