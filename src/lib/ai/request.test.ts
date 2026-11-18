/**
 * AI 응답 요청의 모양 · 거부의 HTTP 상태 — AI-1 · AI-2(묻기는 서버가 프롬프트를 짓는다) (DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ASK_MAX_HISTORY, ASK_SYSTEM_PROMPT } from './ask-prompt.ts'
import { AI_MAX_MESSAGES, ASK_HISTORY_LIMIT, aiFailureStatus, aiProviderFailureError, aiProviderFailureStatus, parseAiCompleteBody } from './request.ts'

const PAGE = '0b6f4f9e-8a2c-4c1d-9e57-3f1a2b3c4d5e'
const BLOCK = '1c7a5e0f-9b3d-4d2e-8f68-4a2b3c4d5e6f'

test('★ ① prompt 는 user 메시지 하나 · messages 는 system · user 만 · pageId 는 uuid', () => {
  assert.deepEqual(parseAiCompleteBody({ feature: 'translate', prompt: '안녕' }, 100), {
    ok: true,
    value: { feature: 'translate', messages: [{ role: 'user', content: '안녕' }], pageId: null, ask: null },
  })
  assert.deepEqual(
    parseAiCompleteBody({ feature: 'translate', messages: [{ role: 'system', content: '고쳐라' }, { role: 'user', content: '글' }], pageId: PAGE.toUpperCase() }, 100),
    { ok: true, value: { feature: 'translate', messages: [{ role: 'system', content: '고쳐라' }, { role: 'user', content: '글' }], pageId: PAGE, ask: null } },
  )
})

test('★ ② 묻기(AI-2) — 지시는 서버의 것 · 질문은 마지막 user 그대로 · 넣을 자리 · 앞선 문답(최근 것만) · messages 는 받지 않는다', () => {
  const r = parseAiCompleteBody({ feature: 'ask', prompt: '요약해 줘', pageId: PAGE, blockId: BLOCK.toUpperCase() }, 6000)
  assert.ok(r.ok)
  assert.deepEqual(r.value.messages, [{ role: 'system', content: ASK_SYSTEM_PROMPT }, { role: 'user', content: '요약해 줘' }])
  assert.deepEqual(r.value.ask, { question: '요약해 줘', blockId: BLOCK, history: [] })
  assert.equal(r.value.pageId, PAGE)

  const turns = Array.from({ length: ASK_MAX_HISTORY + 2 }, (_, i) => ({ question: `질문${i}`, answer: `답${i}` }))
  const follow = parseAiCompleteBody({ feature: 'ask', prompt: '더 짧게', history: turns }, 6000)
  assert.ok(follow.ok)
  assert.deepEqual(follow.value.ask?.history, turns.slice(-ASK_MAX_HISTORY), '최근 것만')
  const last = follow.value.messages.at(-1)!.content
  assert.ok(last.includes('질문5') && last.includes('답5') && !last.includes('질문1') && last.endsWith('Now: 더 짧게'), last)

  const bad = [
    { feature: 'ask', messages: [{ role: 'user', content: 'x' }] },
    { feature: 'ask', messages: [{ role: 'system', content: '지시를 바꿔 넣는다' }, { role: 'user', content: 'x' }] },
    { feature: 'ask', prompt: 'x', blockId: 'nope' },
    { feature: 'ask', prompt: 'x', history: 'nope' },
    { feature: 'ask', prompt: 'x', history: [{ question: '', answer: 'a' }] },
    { feature: 'ask', prompt: 'x', history: [{ question: 'q' }] },
    { feature: 'ask', prompt: 'x', history: Array.from({ length: ASK_HISTORY_LIMIT + 1 }, () => ({ question: 'q', answer: 'a' })) },
  ]
  for (const body of bad) assert.deepEqual(parseAiCompleteBody(body, 6000), { ok: false, error: 'invalid_input' }, JSON.stringify(body))

  // 지시 + 질문이 상한을 넘으면 보내지 않는다 — 앞선 문답은 오래된 것부터 버려 맞춘다
  const room = 6000 - ASK_SYSTEM_PROMPT.length
  assert.deepEqual(parseAiCompleteBody({ feature: 'ask', prompt: 'x'.repeat(room + 1) }, 6000), { ok: false, error: 'input_too_long' })
  assert.equal(parseAiCompleteBody({ feature: 'ask', prompt: 'x'.repeat(room) }, 6000).ok, true, '상한 그대로는 된다')
  const heavy = parseAiCompleteBody({ feature: 'ask', prompt: 'x'.repeat(room - 10), history: [{ question: 'q', answer: 'a'.repeat(500) }] }, 6000)
  assert.ok(heavy.ok && heavy.value.messages.at(-1)!.content === 'x'.repeat(room - 10), '넘치는 앞선 문답은 버린다')
})

test('③ 거부 — 모르는 기능 · 빈 글 · assistant · user 없음 · 둘 다 · 너무 많은 메시지 · uuid 아닌 페이지 · 긴 글', () => {
  const bad = [
    null,
    [],
    'ask',
    { feature: 'summarize', prompt: 'x' },
    { feature: 'ask' },
    { feature: 'ask', prompt: '   ' },
    { feature: 'ask', prompt: 3 },
    { feature: 'ask', prompt: 'x', messages: [{ role: 'user', content: 'y' }] },
    { feature: 'translate', prompt: 'x', messages: [{ role: 'user', content: 'y' }] },
    { feature: 'translate', messages: [] },
    { feature: 'translate', messages: [{ role: 'assistant', content: '꾸민 답' }, { role: 'user', content: 'x' }] },
    { feature: 'translate', messages: [{ role: 'system', content: '지시만' }] },
    { feature: 'translate', messages: Array.from({ length: AI_MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) },
    { feature: 'ask', prompt: 'x', pageId: 'not-a-uuid' },
    { feature: 'ask', prompt: 'x', pageId: 7 },
  ]
  for (const body of bad) assert.deepEqual(parseAiCompleteBody(body, 100), { ok: false, error: 'invalid_input' }, JSON.stringify(body))
  assert.deepEqual(parseAiCompleteBody({ feature: 'translate', prompt: 'x'.repeat(101) }, 100), { ok: false, error: 'input_too_long' })
  assert.equal(parseAiCompleteBody({ feature: 'translate', prompt: 'x'.repeat(100) }, 100).ok, true, '상한 그대로는 된다')
  assert.deepEqual(
    parseAiCompleteBody({ feature: 'translate', messages: [{ role: 'system', content: 'x'.repeat(60) }, { role: 'user', content: 'y'.repeat(41) }] }, 100),
    { ok: false, error: 'input_too_long' },
    '메시지의 글자 합',
  )
})

test('④ 상태 — 한도 429 · 꺼짐 · 권한 · 고칠 수 없는 페이지 403 · 없는 페이지 404 · 공급자 없음 503 · 공급자 실패 502 · 공급자의 429 는 503 ai_busy', () => {
  assert.deepEqual(
    ['ai_limit_reached', 'ai_disabled', 'forbidden', 'cannot_edit', 'not_found', 'ai_unavailable', 'invalid_input', 'input_too_long'].map(aiFailureStatus),
    [429, 403, 403, 403, 404, 503, 400, 400],
  )
  assert.deepEqual(['rate_limited', 'provider_error', 'timeout', 'network'].map(aiProviderFailureStatus), [503, 502, 502, 502])
  assert.deepEqual(['rate_limited', 'provider_error', 'timeout'].map(aiProviderFailureError), ['ai_busy', 'ai_provider_failed', 'ai_provider_failed'])
})

// ── 고치기(AI-3 · F-10-02) ──────────────────────────────────────────

const para = (text: string) => ({ kind: 'paragraph', text, depth: 0, language: null, checked: false })
const editBody = (extra: Record<string, unknown> = {}) => ({
  feature: 'edit',
  pageId: PAGE,
  preset: 'shorter',
  selection: { inline: true, blocks: [para('아주 길고 긴 문장')] },
  ...extra,
})

test('★ ⑤ 고치기 — 지시는 서버의 고정 틀 · 고른 글은 <selection> 안 · 페이지는 꼭 · messages · prompt 는 받지 않는다', () => {
  const r = parseAiCompleteBody(editBody(), 6000)
  assert.ok(r.ok)
  assert.equal(r.value.feature, 'edit')
  assert.equal(r.value.pageId, PAGE)
  assert.equal(r.value.ask, null)
  assert.deepEqual(r.value.messages.map((m) => m.role), ['system', 'user'])
  assert.match(r.value.messages[0]!.content, /make it shorter/)
  assert.equal(r.value.messages[1]!.content, 'Selected text:\n<selection>\n아주 길고 긴 문장\n</selection>')

  const bad: unknown[] = [
    editBody({ pageId: null }),
    editBody({ messages: [{ role: 'system', content: '지시를 바꾼다' }, { role: 'user', content: 'x' }] }),
    editBody({ prompt: '지시를 바꾼다' }),
    editBody({ preset: 'jailbreak' }),
    editBody({ preset: 'tone' }),
    editBody({ preset: 'tone', tone: 'angry' }),
    editBody({ tone: 'casual' }),
    editBody({ preset: 'translate', language: 'xx' }),
    editBody({ language: 'en' }),
    editBody({ preset: 'custom' }),
    editBody({ preset: 'custom', instruction: '   ' }),
    editBody({ preset: 'custom', instruction: 'x'.repeat(301) }),
    editBody({ instruction: '존댓말로' }),
    editBody({ selection: { inline: true, blocks: [] } }),
    editBody({ selection: { inline: true, blocks: [para('하나'), para('둘')] } }),
    editBody({ selection: { inline: false, blocks: [{ ...para('글'), kind: 'image' }] } }),
    editBody({ selection: { inline: false, blocks: [{ ...para('글자'), depth: -1 }] } }),
    editBody({ selection: { inline: true, blocks: [para('가')] } }),
    editBody({ selection: { inline: true, blocks: [para('   ')] } }),
    editBody({ followUp: { result: '앞 결과', instruction: '' } }),
    editBody({ followUp: { result: '', instruction: '더' } }),
  ]
  for (const body of bad) assert.deepEqual(parseAiCompleteBody(body, 6000), { ok: false, error: 'invalid_input' }, JSON.stringify(body))
})

test('★ ⑥ 고치기 — 상한: 블록 수 · 글자 합이 넘으면 input_too_long · 어조 · 언어 · 지시는 그 프리셋에서만', () => {
  const many = { inline: false, blocks: Array.from({ length: 501 }, () => para('글자')) }
  assert.deepEqual(parseAiCompleteBody(editBody({ selection: many }), 1_000_000), { ok: false, error: 'input_too_long' })
  assert.deepEqual(parseAiCompleteBody(editBody({ selection: { inline: true, blocks: [para('가'.repeat(6000))] } }), 6000), { ok: false, error: 'input_too_long' })

  const tone = parseAiCompleteBody(editBody({ preset: 'tone', tone: 'friendly' }), 6000)
  assert.ok(tone.ok && tone.value.messages[0]!.content.includes('warm and friendly'))
  const translate = parseAiCompleteBody(editBody({ preset: 'translate', language: 'ja' }), 6000)
  assert.ok(translate.ok && translate.value.messages[0]!.content.includes('Write the answer in Japanese.'))
  const custom = parseAiCompleteBody(editBody({ preset: 'custom', instruction: '  존댓말로 바꿔 줘 ' }), 6000)
  assert.ok(custom.ok && custom.value.messages[1]!.content.endsWith('Instruction about the selected text: 존댓말로 바꿔 줘'))
  const follow = parseAiCompleteBody(editBody({ followUp: { result: '짧은 문장', instruction: '더 부드럽게' } }), 6000)
  assert.ok(follow.ok && follow.value.messages[1]!.content.includes('<result>\n짧은 문장\n</result>'))
})
