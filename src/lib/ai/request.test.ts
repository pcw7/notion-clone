/**
 * AI 응답 요청의 모양 · 거부의 HTTP 상태 — AI-1 (DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AI_MAX_MESSAGES, aiFailureStatus, aiProviderFailureError, aiProviderFailureStatus, parseAiCompleteBody } from './request.ts'

const PAGE = '0b6f4f9e-8a2c-4c1d-9e57-3f1a2b3c4d5e'

test('★ ① prompt 는 user 메시지 하나 · messages 는 system · user 만 · pageId 는 uuid', () => {
  assert.deepEqual(parseAiCompleteBody({ feature: 'ask', prompt: '안녕' }, 100), {
    ok: true,
    value: { feature: 'ask', messages: [{ role: 'user', content: '안녕' }], pageId: null },
  })
  assert.deepEqual(
    parseAiCompleteBody({ feature: 'edit', messages: [{ role: 'system', content: '고쳐라' }, { role: 'user', content: '글' }], pageId: PAGE.toUpperCase() }, 100),
    { ok: true, value: { feature: 'edit', messages: [{ role: 'system', content: '고쳐라' }, { role: 'user', content: '글' }], pageId: PAGE } },
  )
})

test('② 거부 — 모르는 기능 · 빈 글 · assistant · user 없음 · 둘 다 · 너무 많은 메시지 · uuid 아닌 페이지 · 긴 글', () => {
  const bad = [
    null,
    [],
    'ask',
    { feature: 'summarize', prompt: 'x' },
    { feature: 'ask' },
    { feature: 'ask', prompt: '   ' },
    { feature: 'ask', prompt: 3 },
    { feature: 'ask', prompt: 'x', messages: [{ role: 'user', content: 'y' }] },
    { feature: 'ask', messages: [] },
    { feature: 'ask', messages: [{ role: 'assistant', content: '꾸민 답' }, { role: 'user', content: 'x' }] },
    { feature: 'ask', messages: [{ role: 'system', content: '지시만' }] },
    { feature: 'ask', messages: Array.from({ length: AI_MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) },
    { feature: 'ask', prompt: 'x', pageId: 'not-a-uuid' },
    { feature: 'ask', prompt: 'x', pageId: 7 },
  ]
  for (const body of bad) assert.deepEqual(parseAiCompleteBody(body, 100), { ok: false, error: 'invalid_input' }, JSON.stringify(body))
  assert.deepEqual(parseAiCompleteBody({ feature: 'ask', prompt: 'x'.repeat(101) }, 100), { ok: false, error: 'input_too_long' })
  assert.equal(parseAiCompleteBody({ feature: 'ask', prompt: 'x'.repeat(100) }, 100).ok, true, '상한 그대로는 된다')
  assert.deepEqual(
    parseAiCompleteBody({ feature: 'ask', messages: [{ role: 'system', content: 'x'.repeat(60) }, { role: 'user', content: 'y'.repeat(41) }] }, 100),
    { ok: false, error: 'input_too_long' },
    '메시지의 글자 합',
  )
})

test('③ 상태 — 한도 429 · 꺼짐 · 권한 403 · 없는 페이지 404 · 공급자 없음 503 · 공급자 실패 502 · 공급자의 429 는 503 ai_busy', () => {
  assert.deepEqual(
    ['ai_limit_reached', 'ai_disabled', 'forbidden', 'not_found', 'ai_unavailable', 'invalid_input', 'input_too_long'].map(aiFailureStatus),
    [429, 403, 403, 404, 503, 400, 400],
  )
  assert.deepEqual(['rate_limited', 'provider_error', 'timeout', 'network'].map(aiProviderFailureStatus), [503, 502, 502, 502])
  assert.deepEqual(['rate_limited', 'provider_error', 'timeout'].map(aiProviderFailureError), ['ai_busy', 'ai_provider_failed', 'ai_provider_failed'])
})
