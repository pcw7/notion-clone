/**
 * AI 모델 — 목록 거르기 · 캐시 · 설정 읽기 · 이번 응답의 모델 (AI-7 · F-10-26 · 순수 · 공급자를 부르지 않는다 — fetch 를 넘긴다)
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL_LIST } from '../testing/fake-ai-provider.ts'
import {
  AI_ALLOWED_MODELS_MAX,
  allowedModelsOf,
  chatModelIdsOf,
  clearModelListCache,
  defaultModelOf,
  isChatModelId,
  listProviderModels,
  MODEL_LIST_FAILURE_TTL_MS,
  MODEL_LIST_TTL_MS,
  parseModelSetting,
  pickModel,
  readModelField,
  sameModelSetting,
  NO_MODEL_SETTING,
} from './models.ts'

beforeEach(() => clearModelListCache())

const CONFIG = { baseUrl: 'http://fake.invalid/v1', apiKey: 'k', model: FAKE_AI_MODEL }

test('★ 채팅 모델만 — 받아쓰기 · 말하기 · 안전 분류 · 임베딩 · 그림 · 재순위 · 내린 모델은 뺀다', () => {
  for (const id of ['whisper-large-v3', 'distil-whisper-large-v3-en', 'playai-tts', 'gpt-4o-mini-tts', 'meta-llama/llama-guard-4-12b', 'meta-llama/llama-prompt-guard-2-86m',
    'text-embedding-3-small', 'nomic-embed-text', 'omni-moderation-latest', 'dall-e-3', 'canopylabs/orpheus-v1-english', 'gpt-4o-transcribe', 'rerank-v3', 'speech-01',
    'openai/gpt-oss-safeguard-20b']) {
    assert.equal(isChatModelId(id), false, id)
  }
  for (const id of ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'groq/compound', 'moonshotai/kimi-k2-instruct', 'gemini-2.5-flash', 'qwen/qwen3-32b']) {
    assert.equal(isChatModelId(id), true, id)
  }
  // 가짜 공급자의 목록 — 채팅 모델 둘만 · id 차례
  assert.deepEqual(chatModelIdsOf({ object: 'list', data: FAKE_AI_MODEL_LIST }), [FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE])
  // 모양 — data 가 없으면 null · id 가 글이 아니거나 비었거나 공백이 붙었으면 그 줄만 버린다 · 겹침은 하나
  assert.equal(chatModelIdsOf({}), null)
  assert.equal(chatModelIdsOf(null), null)
  assert.deepEqual(chatModelIdsOf({ data: [{ id: 3 }, { id: '' }, { id: ' a' }, { id: 'b' }, { id: 'b' }, 'x', { id: 'm'.repeat(201) }] }), ['b'])
  assert.equal(chatModelIdsOf({ data: Array.from({ length: 250 }, (_, i) => ({ id: `m${String(i).padStart(3, '0')}` })) })?.length, 200, '200개까지')
})

test('★ 목록 캐시 — 1시간 한 번 · 같은 순간의 요청은 하나 · 실패는 자동 하나(fallback)이고 1분 뒤 다시 묻는다', async () => {
  let calls = 0
  let fail = false
  let clock = 1_000_000
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls += 1
    assert.equal(url, 'http://fake.invalid/v1/models')
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer k')
    if (fail) return new Response('secret detail', { status: 500 })
    return Response.json({ data: FAKE_AI_MODEL_LIST })
  }
  const now = () => clock
  const [a, b] = await Promise.all([listProviderModels(CONFIG, { fetchImpl, now }), listProviderModels(CONFIG, { fetchImpl, now })])
  assert.deepEqual(a, { models: [FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE], source: 'provider' })
  assert.deepEqual(b, a)
  assert.equal(calls, 1, '같은 순간 둘 — 한 번만 묻는다')
  clock += MODEL_LIST_TTL_MS - 1
  await listProviderModels(CONFIG, { fetchImpl, now })
  assert.equal(calls, 1, '한 시간 안 — 캐시')
  clock += 1
  fail = true
  const fallen = await listProviderModels(CONFIG, { fetchImpl, now })
  assert.deepEqual(fallen, { models: [FAKE_AI_MODEL], source: 'fallback' }, '실패 — 자동 하나')
  assert.equal(calls, 2)
  clock += MODEL_LIST_FAILURE_TTL_MS - 1
  await listProviderModels(CONFIG, { fetchImpl, now })
  assert.equal(calls, 2, '실패도 잠시 둔다(공급자를 두드리지 않는다)')
  clock += 1
  fail = false
  assert.equal((await listProviderModels(CONFIG, { fetchImpl, now })).source, 'provider')
  assert.equal(calls, 3)
  // 연결 실패 · 모양이 틀린 답도 fallback — 자동은 목록에 없어도 든다
  clearModelListCache()
  assert.deepEqual(await listProviderModels(CONFIG, { fetchImpl: async () => { throw new Error('down') }, now }), { models: [FAKE_AI_MODEL], source: 'fallback' })
  clearModelListCache()
  assert.deepEqual(await listProviderModels(CONFIG, { fetchImpl: async () => Response.json({ nope: 1 }), now }), { models: [FAKE_AI_MODEL], source: 'fallback' })
  clearModelListCache()
  assert.deepEqual(await listProviderModels(CONFIG, { fetchImpl: async () => Response.json({ data: [{ id: 'other' }] }), now }), { models: [FAKE_AI_MODEL, 'other'].sort(), source: 'provider' })
})

test('★ 설정 읽기 — 자동은 뺀다 · 겹침 · 차례 · 새 모델은 공급자의 목록에 · 기본은 더한 것 안(자동이면 null)', () => {
  const input = { autoModel: FAKE_AI_MODEL, available: [FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE, 'z-model'], current: NO_MODEL_SETTING }
  assert.deepEqual(parseModelSetting({ allowed: ['z-model', FAKE_AI_MODEL, ' fake-model-large ', 'z-model'], default: FAKE_AI_MODEL_LARGE }, input), {
    ok: true,
    value: { allowed: [FAKE_AI_MODEL_LARGE, 'z-model'], defaultModel: FAKE_AI_MODEL_LARGE },
  })
  assert.deepEqual(parseModelSetting({ allowed: [FAKE_AI_MODEL_LARGE], default: FAKE_AI_MODEL }, input), { ok: true, value: { allowed: [FAKE_AI_MODEL_LARGE], defaultModel: null } }, '기본 = 자동 → null')
  assert.deepEqual(parseModelSetting({ allowed: [] }, input), { ok: true, value: { allowed: [], defaultModel: null } }, '기본이 없으면 자동')
  assert.deepEqual(parseModelSetting({ allowed: ['nope'], default: null }, input), { ok: false, reason: 'unknown_model' })
  assert.deepEqual(parseModelSetting({ allowed: [FAKE_AI_MODEL_LARGE], default: 'z-model' }, input), { ok: false, reason: 'default_not_allowed' })
  // 이미 허용한 것은 목록을 받지 못해도(목록에 없어도) 남긴다 · 새로 더하는 것은 안 된다
  const kept = { ...input, available: [FAKE_AI_MODEL], current: { allowed: ['old-model'], defaultModel: 'old-model' } }
  assert.deepEqual(parseModelSetting({ allowed: ['old-model'], default: 'old-model' }, kept), { ok: true, value: { allowed: ['old-model'], defaultModel: 'old-model' } })
  assert.deepEqual(parseModelSetting({ allowed: ['old-model', FAKE_AI_MODEL_LARGE], default: null }, kept), { ok: false, reason: 'unknown_model' })
  const many = Array.from({ length: AI_ALLOWED_MODELS_MAX + 1 }, (_, i) => `m${i}`)
  assert.deepEqual(parseModelSetting({ allowed: many }, { ...input, available: many }), { ok: false, reason: 'too_many_models' })
  for (const bad of [null, [], 'x', {}, { allowed: 'a' }, { allowed: [3] }, { allowed: [''] }, { allowed: [null] }, { allowed: [], default: 5 }, { allowed: [], extra: 1 }]) {
    assert.deepEqual(parseModelSetting(bad, input), { ok: false, reason: 'invalid_value' }, JSON.stringify(bad))
  }
  assert.ok(sameModelSetting({ allowed: ['a'], defaultModel: null }, { allowed: ['a'], defaultModel: null }))
  assert.ok(!sameModelSetting({ allowed: ['a'], defaultModel: null }, { allowed: ['a'], defaultModel: 'a' }))
  assert.ok(!sameModelSetting({ allowed: ['a'], defaultModel: null }, { allowed: ['a', 'b'], defaultModel: null }))
})

test('★ 이번 응답의 모델 — null 은 기본 · 허용 안은 그대로 · 밖은 거부(회수된 대화의 것이면 기본으로)', () => {
  const setting = { allowed: [FAKE_AI_MODEL_LARGE], defaultModel: FAKE_AI_MODEL_LARGE }
  assert.deepEqual(allowedModelsOf(FAKE_AI_MODEL, setting), [FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE], '자동이 먼저')
  assert.equal(defaultModelOf(FAKE_AI_MODEL, setting), FAKE_AI_MODEL_LARGE)
  assert.equal(defaultModelOf(FAKE_AI_MODEL, NO_MODEL_SETTING), FAKE_AI_MODEL, '정하지 않았으면 자동')
  assert.equal(defaultModelOf(FAKE_AI_MODEL, { allowed: [], defaultModel: 'gone' }), FAKE_AI_MODEL, '허용 밖의 기본은 자동')
  assert.deepEqual(pickModel(FAKE_AI_MODEL, setting, null), { ok: true, model: FAKE_AI_MODEL_LARGE })
  assert.deepEqual(pickModel(FAKE_AI_MODEL, setting, FAKE_AI_MODEL), { ok: true, model: FAKE_AI_MODEL }, '자동 모델은 늘 된다')
  assert.deepEqual(pickModel(FAKE_AI_MODEL, setting, 'nope'), { ok: false })
  assert.deepEqual(pickModel(FAKE_AI_MODEL, setting, 'nope', true), { ok: true, model: FAKE_AI_MODEL_LARGE }, '회수 — 기본으로')
  assert.deepEqual(pickModel(FAKE_AI_MODEL, NO_MODEL_SETTING, FAKE_AI_MODEL_LARGE), { ok: false }, '더하지 않은 모델')
  assert.deepEqual([undefined, null, ' m ', '', 3, 'm'.repeat(201)].map(readModelField), [undefined, null, 'm', 'invalid', 'invalid', 'invalid'])
})
