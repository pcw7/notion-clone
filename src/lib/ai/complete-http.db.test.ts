/**
 * AI 응답 라우트의 몸 — 게이트 → 가짜 공급자 → SSE (AI-1 · F-10-09 · F-10-12 · DB · 진짜 공급자를 부르지 않는다)
 *
 *   ① 스트리밍 — 글 조각이 차례대로 · 끝 사건에 사용량 · 남은 수 · 원장은 completed(토큰)
 *   ② 거부 — 꺼짐 403 · 게스트 403 · 볼 수 없는 페이지 404 · 모양 400 · 한도 429(어느 한도 · Retry-After) · 키 없음 503(환경에서)
 *   ③ 공급자 실패 — 429 는 503 ai_busy + retryAfter · 500 은 502 · 도중의 오류는 error 사건 · 모두 failed(셈에서 빠진다) · 공급자의 말이 새지 않는다
 *   ④ 출력 상한 — 받은 데까지 남기고 끊는다(truncated · completed)
 *   ⑤ 멈추기 — 연결을 닫으면 공급자 연결도 닫히고 stopped(셈에 든다)
 *
 * 환경(AI_BASE_URL · AI_API_KEY · AI_MODEL)은 가짜 공급자를 가리킨다 — `.env` 에 진짜 키가 있어도 닿지 않는다.
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { query } from '../db/pool.ts'
import type { WorkspaceId } from '../ids.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL, FAKE_AI_SECRET_BODY, fakeAnswer, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import { aiCompleteResponse } from './complete-http.ts'
import { readAiConfig, type AiConfig } from './config.ts'
import { createSseParser, type SseEvent } from './sse.ts'
import { setAiEnabled } from './usage.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fake: FakeAiProvider
let config: AiConfig

before(async () => {
  fake = await startFakeAiProvider()
  process.env.AI_BASE_URL = fake.baseUrl
  process.env.AI_API_KEY = FAKE_AI_KEY
  process.env.AI_MODEL = FAKE_AI_MODEL
  process.env.AI_DAILY_CAP = '10000000'
  config = readAiConfig()!
  assert.equal(config.baseUrl, fake.baseUrl, '환경이 가짜 공급자를 가리킨다')
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  await fake.close()
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 겹치지 않는 먼 UTC 날 — 하루 카운터를 이 시험만 쓴다. */
const farDay = (): Date =>
  new Date(Date.UTC(2200 + Math.floor(Math.random() * 700), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 10))

async function aiWorkspace(): Promise<{ ws: WorkspaceId; owner: Actor }> {
  const fx = await makeFixture()
  assert.ok((await setAiEnabled(fx.owner.ctx, true)).ok)
  return { ws: fx.workspaceId, owner: fx.owner }
}

const call = (who: Actor, body: unknown, options: { signal?: AbortSignal; now?: Date; config?: AiConfig | null } = {}) => {
  const now = options.now ?? farDay()
  return aiCompleteResponse(who.ctx, body, options.signal ?? new AbortController().signal, {
    ...(options.config === undefined ? { config } : { config: options.config }),
    now: () => now,
  })
}

async function events(res: Response): Promise<SseEvent[]> {
  const parser = createSseParser()
  return [...parser.push(await res.text()), ...parser.end()]
}
const deltas = (es: SseEvent[]) => es.filter((e) => e.event === 'delta').map((e) => (JSON.parse(e.data) as { text: string }).text)
const last = async (ws: string) =>
  (await query<{ status: string; input_tokens: number | null; output_tokens: number | null }>(
    `SELECT status, input_tokens, output_tokens FROM ai_usage WHERE workspace_id = $1 ORDER BY created_at DESC, finished_at DESC NULLS FIRST LIMIT 1`,
    [ws],
  ))[0]
const counted = async (ws: string) => Number((await query<{ n: string }>(`SELECT count(*) AS n FROM ai_usage WHERE workspace_id = $1 AND status <> 'failed'`, [ws]))[0]?.n)

describe('① 스트리밍', () => {
  test('★ 글 조각이 차례대로 · 끝 사건에 사용량 · 남은 수 · 원장은 completed(토큰)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const res = await call(owner, { feature: 'ask', prompt: '노션처럼 요약해 줘' })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/)
    const es = await events(res)
    assert.ok(deltas(es).length >= 2, '여러 조각')
    assert.equal(deltas(es).join(''), fakeAnswer('노션처럼 요약해 줘'))
    const done = es.at(-1)!
    assert.equal(done.event, 'done')
    const d = JSON.parse(done.data) as { status: string; truncated: boolean; usage: unknown; remaining: number; quota: { trial: { used: number } } }
    assert.deepEqual([d.status, d.truncated, d.usage, d.remaining, d.quota.trial.used], ['completed', false, { inputTokens: 3, outputTokens: 3 }, 19, 1])
    assert.deepEqual(await last(ws), { status: 'completed', input_tokens: 3, output_tokens: 3 })
    assert.equal(fake.requests.at(-1)!.body.max_tokens, config.maxOutputTokens)
  })
})

describe('② 거부', () => {
  test('★ 꺼짐 403 · 게스트 403 · 볼 수 없는 페이지 404 · 모양 400 · 긴 글 400 — 어느 것도 공급자를 부르지 않고 세지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const off = await makeFixture()
    const { ws, owner } = await aiWorkspace()
    const guest = await joinAs(ws, await createUser('AI 라우트의 손님'), 'guest')
    const member = await joinAs(ws, await createUser('AI 라우트의 멤버'), 'member')
    const secret = (await createPage(owner.ctx, { privateTop: true, title: titleFromPlainText('라우트의 비밀') })).id
    const before = fake.requests.length

    const expect = async (res: Response, status: number, error: string) => {
      assert.equal(res.status, status, error)
      assert.equal(((await res.json()) as { error: string }).error, error)
    }
    await expect(await call(off.owner, { feature: 'ask', prompt: 'x' }), 403, 'ai_disabled')
    await expect(await call(guest, { feature: 'ask', prompt: 'x' }), 403, 'forbidden')
    await expect(await call(member, { feature: 'ask', prompt: 'x', pageId: secret }), 404, 'not_found')
    await expect(await call(owner, { feature: 'summarize', prompt: 'x' }), 400, 'invalid_input')
    await expect(await call(owner, { feature: 'ask', prompt: 'x'.repeat(config.maxInputChars + 1) }), 400, 'input_too_long')
    assert.equal(fake.requests.length, before, '공급자를 부르지 않았다')
    assert.equal(await counted(ws), 0)
  })

  test('★ 한도 429 — 체험(풀리지 않는다 · Retry-After 없음) · 창(Retry-After)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const now = farDay()
    await query(
      `INSERT INTO ai_usage (id, workspace_id, user_id, feature, status, quota, model, created_at, finished_at)
       SELECT gen_random_uuid(), $1, $2, 'ask', 'completed', 'trial', 'seed', $3, $3 FROM generate_series(1, 20)`,
      [ws, owner.userId, new Date(now.getTime() - 60_000)],
    )
    const trial = await call(owner, { feature: 'ask', prompt: 'x' }, { now })
    assert.equal(trial.status, 429)
    assert.equal(trial.headers.get('retry-after'), null)
    assert.deepEqual(await trial.json(), { ok: false, error: 'ai_limit_reached', limit: 'trial', resetsAt: null })

    await setWorkspacePlan(ws, 'business')
    await query(
      `INSERT INTO ai_usage (id, workspace_id, user_id, feature, status, quota, model, created_at, finished_at)
       SELECT gen_random_uuid(), $1, $2, 'ask', 'completed', 'plan', 'seed', $3, $3 FROM generate_series(1, 100)`,
      [ws, owner.userId, new Date(now.getTime() - 60 * 60 * 1000)],
    )
    const win = await call(owner, { feature: 'ask', prompt: 'x' }, { now })
    assert.equal(win.status, 429)
    assert.equal(win.headers.get('retry-after'), String(5 * 60 * 60), '한 시간 전에 찼다 — 5시간 뒤')
    assert.equal(((await win.json()) as { limit: string }).limit, 'window')
  })

  test('★ 키가 없으면 503 ai_unavailable — 환경에서 읽는다(.env 가 아니라 이 시험이 비운다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await aiWorkspace()
    const saved = process.env.AI_API_KEY
    process.env.AI_API_KEY = ''
    try {
      const res = await aiCompleteResponse(owner.ctx, { feature: 'ask', prompt: 'x' }, new AbortController().signal)
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), { ok: false, error: 'ai_unavailable' })
    } finally {
      process.env.AI_API_KEY = saved
    }
    const unset = await call(owner, { feature: 'ask', prompt: 'x' }, { config: null })
    assert.equal(unset.status, 503)
  })
})

describe('③ 공급자 실패', () => {
  test('★ 429 → 503 ai_busy + retryAfter · 500 → 502 · 도중의 오류 → error 사건 · 모두 failed · 하루 카운터를 돌려준다 · 공급자의 말이 새지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const now = farDay()
    const day = now.toISOString().slice(0, 10)
    const daily = async () => (await query<{ responses: number }>(`SELECT responses FROM ai_daily_usage WHERE day = $1::date`, [day]))[0]?.responses ?? 0

    const busy = await call(owner, { feature: 'ask', prompt: '[429]' }, { now })
    assert.equal(busy.status, 503)
    assert.equal(busy.headers.get('retry-after'), '7')
    const busyText = await busy.text()
    assert.deepEqual(JSON.parse(busyText), { ok: false, error: 'ai_busy', retryAfter: 7 })
    assert.equal((await last(ws))?.status, 'failed')
    assert.equal(await daily(), 0, '받은 답이 없다 — 하루 카운터를 돌려준다')

    const broken = await call(owner, { feature: 'ask', prompt: '[500]' }, { now })
    assert.equal(broken.status, 502)
    const brokenText = await broken.text()
    assert.deepEqual(JSON.parse(brokenText), { ok: false, error: 'ai_provider_failed', reason: 'provider_error' })

    const mid = await call(owner, { feature: 'ask', prompt: '[midfail]' }, { now })
    assert.equal(mid.status, 200)
    const es = await events(mid)
    assert.equal(deltas(es).length, 2, '실패 전의 조각은 왔다')
    assert.deepEqual(JSON.parse(es.at(-1)!.data), { error: 'ai_provider_failed', reason: 'provider_error', retryAfter: null })
    assert.equal(es.at(-1)!.event, 'error')
    assert.equal((await last(ws))?.status, 'failed')

    for (const text of [busyText, brokenText, JSON.stringify(es)]) {
      assert.ok(!text.includes(FAKE_AI_SECRET_BODY) && !text.includes(FAKE_AI_KEY), text)
    }
    assert.equal(await counted(ws), 0, '실패는 셈에 들지 않는다')
    assert.equal(await daily(), 0)
  })
})

describe('④ 출력 상한', () => {
  test('★ 상한에 닿으면 받은 데까지 남기고 끊는다 — truncated · completed', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const small = { ...config, maxOutputTokens: 100 } // 글자 안전망 400
    const res = await call(owner, { feature: 'ask', prompt: '[long]' }, { config: small })
    const es = await events(res)
    assert.equal(deltas(es).join('').length, 400)
    assert.deepEqual(JSON.parse(es.at(-1)!.data).truncated, true)
    assert.equal((await last(ws))?.status, 'completed')
  })
})

describe('⑤ 멈추기', () => {
  test('★ 연결을 닫으면 공급자 연결도 닫히고 stopped — 셈에 든다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace()
    const stop = new AbortController()
    const res = await call(owner, { feature: 'ask', prompt: '[slow]' }, { signal: stop.signal })
    assert.equal(res.status, 200)
    const reader = res.body!.getReader()
    const first = await reader.read()
    assert.ok(new TextDecoder().decode(first.value).includes('event: delta'))
    const providerReq = fake.requests.at(-1)!
    stop.abort() // 요청의 신호(사람이 멈췄다)
    await reader.cancel()
    let status = ''
    for (let i = 0; i < 100 && status !== 'stopped'; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      status = (await last(ws))?.status ?? ''
    }
    assert.equal(status, 'stopped')
    for (let i = 0; i < 50 && !providerReq.closedEarly; i += 1) await new Promise((r) => setTimeout(r, 20))
    assert.ok(providerReq.closedEarly, '공급자 연결도 닫혔다')
    assert.equal(await counted(ws), 1, '멈춘 것은 센다')
  })
})
