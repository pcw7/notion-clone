/**
 * AI 공급자 클라이언트 — 가짜 OpenAI 호환 서버로 (AI-1 · DB 없음 · 진짜 공급자를 부르지 않는다)
 *
 *   ① 스트리밍 — 조각이 차례대로 · 사용량 · 끝난 까닭 · 키는 Bearer · 본문의 모양(stream · max_tokens · stream_options)
 *   ② 실패 — 429 rate_limited · 500 · 키가 틀림 provider_error · 도중의 오류 · 공급자의 본문은 어디에도 실리지 않는다
 *   ③ 멈추기 — 부른 쪽의 신호 → aborted · 공급자 연결이 닫힌다 · 시간 상한 → timeout · 연결 실패 → network
 *   ④ 사용량 없이 · [DONE] 없이 닫혀도 받은 데까지
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { FAKE_AI_KEY, FAKE_AI_MODEL, FAKE_AI_SECRET_BODY, fakeAnswer, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import type { AiConfig } from './config.ts'
import { AiProviderError, openChatStream, parseProviderDuration, retryAfterSeconds, type ChatStreamEvent } from './provider.ts'

let fake: FakeAiProvider
let config: AiConfig

before(async () => {
  fake = await startFakeAiProvider()
  // 진짜 공급자의 설정(.env)이 어디서도 쓰이지 않게 — 환경도 가짜를 가리킨다
  process.env.AI_BASE_URL = fake.baseUrl
  process.env.AI_API_KEY = FAKE_AI_KEY
  process.env.AI_MODEL = FAKE_AI_MODEL
  config = { baseUrl: fake.baseUrl, apiKey: FAKE_AI_KEY, model: FAKE_AI_MODEL, maxOutputTokens: 64, maxInputChars: 1000, dailyCap: 10, timeoutMs: 10_000, streamUsage: true }
})

after(async () => {
  await fake.close()
})

const user = (content: string) => [{ role: 'user' as const, content }]

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

async function failure(p: Promise<unknown>): Promise<AiProviderError> {
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof AiProviderError, String(e))
    return e
  }
  assert.fail('실패해야 한다')
}

test('★ ① 스트리밍 — 조각이 차례대로 · 사용량 · 끝난 까닭 · Bearer · 본문의 모양', async () => {
  const events = await collect(await openChatStream(config, user('안녕하세요'), new AbortController().signal))
  const text = events.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('')
  assert.equal(text, fakeAnswer('안녕하세요'))
  assert.ok(events.filter((e) => e.type === 'delta').length >= 2, '여러 조각으로 왔다')
  assert.deepEqual(events.at(-1), { type: 'end', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3 } })
  const req = fake.requests.at(-1)!
  assert.equal(req.authorization, `Bearer ${FAKE_AI_KEY}`)
  assert.deepEqual(
    { model: req.body.model, stream: req.body.stream, max_tokens: req.body.max_tokens, stream_options: req.body.stream_options },
    { model: FAKE_AI_MODEL, stream: true, max_tokens: 64, stream_options: { include_usage: true } },
  )
})

test('★ ② 실패 — 429 · 500 · 틀린 키 · 도중의 오류 · 공급자의 말이 실리지 않는다', async () => {
  const signal = new AbortController().signal
  const limited = await failure(openChatStream(config, user('[429]'), signal))
  assert.deepEqual([limited.reason, limited.status, limited.retryAfterSeconds], ['rate_limited', 429, 7], 'Retry-After 가 먼저')
  const bucket = await failure(openChatStream(config, user('[429reset]'), signal))
  assert.deepEqual([bucket.reason, bucket.retryAfterSeconds], ['rate_limited', 8], 'Retry-After 가 없으면 reset 중 이른 것(7.66초 → 8)')
  const broken = await failure(openChatStream(config, user('[500]'), signal))
  assert.deepEqual([broken.reason, broken.status], ['provider_error', 500])
  const wrongKey = await failure(openChatStream({ ...config, apiKey: 'wrong' }, user('x'), signal))
  assert.deepEqual([wrongKey.reason, wrongKey.status], ['provider_error', 401])
  const mid = await failure(collect(await openChatStream(config, user('[midfail]'), signal)))
  assert.equal(mid.reason, 'provider_error')
  assert.equal(broken.retryAfterSeconds, null)
  for (const e of [limited, bucket, broken, wrongKey, mid]) {
    assert.ok(!e.message.includes(FAKE_AI_SECRET_BODY) && !e.message.includes('sk-live'), e.message)
    assert.ok(!e.message.includes(FAKE_AI_KEY), '키가 실렸다')
  }
})

test('★ ③ 멈추기 · 시간 상한 · 연결 실패', async () => {
  const stop = new AbortController()
  const events = await openChatStream(config, user('[slow]'), stop.signal)
  const first = await events.next()
  assert.equal(first.done, false)
  stop.abort()
  const stopped = await failure(collect(events))
  assert.equal(stopped.reason, 'aborted')
  const slowReq = fake.requests.at(-1)!
  for (let i = 0; i < 50 && !slowReq.closedEarly; i += 1) await new Promise((r) => setTimeout(r, 20))
  assert.ok(slowReq.closedEarly, '멈추면 공급자 연결도 닫힌다')

  const late = await failure(collect(await openChatStream({ ...config, timeoutMs: 300 }, user('[slow]'), new AbortController().signal)))
  assert.equal(late.reason, 'timeout')

  const nowhere = await failure(openChatStream({ ...config, baseUrl: 'http://127.0.0.1:9/v1' }, user('x'), new AbortController().signal))
  assert.equal(nowhere.reason, 'network')

  const already = new AbortController()
  already.abort()
  assert.equal((await failure(openChatStream(config, user('x'), already.signal))).reason, 'aborted')
})

test('★ ⑤ 429 의 "몇 초 뒤" — Groq 의 기간 글 · Retry-After(초 · 날짜) · 1초 ~ 1시간', () => {
  assert.deepEqual(['1m26.4s', '7.66s', '120ms', '2h3m', '30', '0.5', 'abc', '5x', ''].map(parseProviderDuration), [86.4, 7.66, 0.12, 7380, 30, 0.5, null, null, null])
  const h = (o: Record<string, string>) => new Headers(o)
  assert.equal(retryAfterSeconds(h({ 'retry-after': '12' })), 12)
  assert.equal(retryAfterSeconds(h({ 'retry-after': 'Thu, 01 Jan 2032 00:00:30 GMT' }), new Date('2032-01-01T00:00:00Z')), 30)
  assert.equal(retryAfterSeconds(h({ 'x-ratelimit-reset-requests': '1m26.4s' })), 87)
  assert.equal(retryAfterSeconds(h({ 'x-ratelimit-reset-requests': '120ms' })), 1, '1초보다 짧으면 1초')
  assert.equal(retryAfterSeconds(h({ 'retry-after': '99999' })), 3600, '1시간까지')
  assert.equal(retryAfterSeconds(h({})), null)
})

test('④ 사용량을 달라고 하지 않으면 null · [DONE] 없이 닫혀도 받은 데까지 · 도중에 그만두면 연결을 닫는다', async () => {
  const quiet = await collect(await openChatStream({ ...config, streamUsage: false }, user('조용히'), new AbortController().signal))
  assert.deepEqual(quiet.at(-1), { type: 'end', finishReason: 'stop', usage: null })
  assert.equal(fake.requests.at(-1)!.body.stream_options, undefined)

  const noDone = await collect(await openChatStream(config, user('[nodone] 끝'), new AbortController().signal))
  assert.equal(noDone.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join(''), fakeAnswer('[nodone] 끝'))
  assert.equal(noDone.at(-1)?.type, 'end')

  // 도중에 그만둔다(출력 상한) — 생성기를 닫으면 공급자 연결이 닫힌다
  const events = await openChatStream(config, user('[slow]'), new AbortController().signal)
  await events.next()
  await events.return()
  const req = fake.requests.at(-1)!
  for (let i = 0; i < 50 && !req.closedEarly; i += 1) await new Promise((r) => setTimeout(r, 20))
  assert.ok(req.closedEarly)
})
