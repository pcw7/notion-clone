/**
 * AI 의 문구 — 설정 → AI · 한도 거부 (AI-1 · DOM · DB 없음)
 *
 *   ① 알림은 host 를 말한다 · 시각은 UTC 로
 *   ② 쓴 양의 줄 — 체험(Free) · 창 · 달(Business) · 보충 · 몫 없음
 *   ③ 한도 거부 — 어느 한도 · 언제 · 체험은 보충을 말한다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { AiQuotaView } from '../../../../lib/ai/quota.ts'
import { aiBusyMessage, aiDisclosure, aiLimitMessage, aiSwitchFailureMessage, aiUsageLines, formatUtc, AI_OWNER_ONLY } from './ai-messages.ts'

const view = (over: Partial<AiQuotaView>): AiQuotaView => ({
  kind: 'trial',
  window: null,
  month: null,
  trial: null,
  grantsLeft: 0,
  grantsExpireAt: null,
  remaining: 0,
  ...over,
})

test('★ ① 알림은 글이 가는 곳(host)과 무료 등급의 정책을 말한다 · 시각은 UTC', () => {
  const text = aiDisclosure('api.groq.com')
  assert.ok(text.includes('api.groq.com') && text.includes('페이지의 글') && text.includes('무료 등급'))
  assert.equal(formatUtc('2031-04-01T00:00:00.000Z'), '4월 1일 00:00 (UTC)')
  assert.equal(formatUtc('2031-03-15T11:03:00Z'), '3월 15일 11:03 (UTC)')
  assert.equal(formatUtc('아님'), '아님')
})

test('★ ② 쓴 양 — 체험 · 창(찼으면 풀리는 때) · 달 · 보충 · 몫 없음', () => {
  assert.deepEqual(aiUsageLines(view({ trial: { used: 1, limit: 20 } })), [{ key: 'trial', text: '체험 1 / 20회 (다시 채워지지 않습니다)' }])
  const biz = aiUsageLines(
    view({
      kind: 'plan',
      window: { used: 100, limit: 100, resetsAt: '2031-03-15T11:00:00Z' },
      month: { used: 1200, limit: 1000, resetsAt: '2031-04-01T00:00:00Z' },
      grantsLeft: 1500,
      grantsExpireAt: '2031-05-01T00:00:00Z',
    }),
  )
  assert.deepEqual(biz.map((l) => l.text), [
    '지난 6시간 100 / 100회 · 3월 15일 11:00 (UTC)부터 다시 쓸 수 있습니다',
    '이번 달 1,200 / 1,000회 · 4월 1일 00:00 (UTC)에 새로 채워집니다',
    '운영자 보충 1,500회 남음 · 가장 이른 만료 5월 1일 00:00 (UTC)',
  ])
  assert.deepEqual(
    aiUsageLines(view({ kind: 'plan', window: { used: 3, limit: null, resetsAt: null }, month: { used: 3, limit: null, resetsAt: '2031-04-01T00:00:00Z' } })).map((l) => l.text),
    ['지난 6시간 3회 (제한 없음)', '이번 달 3회 (무제한)'],
  )
  assert.deepEqual(aiUsageLines(view({ kind: 'none' })).map((l) => l.key), ['none'])
})

test('③ 한도 거부 · 스위치 거부', () => {
  assert.equal(aiLimitMessage('window', '2031-03-15T11:00:00Z'), '6시간 한도에 닿았습니다. 3월 15일 11:00 (UTC)부터 다시 쓸 수 있습니다.')
  assert.equal(aiLimitMessage('month', '2031-04-01T00:00:00Z'), '이번 달 한도에 닿았습니다. 4월 1일 00:00 (UTC)부터 다시 쓸 수 있습니다.')
  assert.ok(aiLimitMessage('daily', '2031-03-16T00:00:00Z').startsWith('오늘 이 앱의 AI 사용량이'))
  assert.equal(aiLimitMessage('trial', null), '체험 응답을 모두 썼습니다. 운영자에게 보충을 요청하세요.')
  assert.equal(aiBusyMessage(7), 'AI 서비스가 잠시 바쁩니다 — 7초 뒤 다시 시도하세요.')
  assert.equal(aiBusyMessage(null), 'AI 서비스가 잠시 바쁩니다 — 잠시 뒤 다시 시도하세요.')
  assert.equal(aiSwitchFailureMessage('forbidden'), AI_OWNER_ONLY)
  assert.equal(aiSwitchFailureMessage(undefined), '저장하지 못했습니다.')
})
