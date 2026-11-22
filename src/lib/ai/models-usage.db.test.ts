/**
 * AI 모델 고르기 · 사용량 분석 — 설정 · 게이트 · 채팅 · 편집기의 기본 · 원장 · 집계 · 활동 기록 (AI-7 · F-10-26 · F-10-25 · DB · 진짜 공급자를
 * 부르지 않는다 — 가짜 서버)
 *
 *   ① 모델 설정 — 소유자만(멤버는 forbidden · 바뀌지 않는다) · 바뀔 때만 감사 한 줄(`ai.models` · 전/후) · 공급자 목록 밖의 새 모델은 거부 ·
 *      설정 화면의 요약(소유자만 공급자의 목록)
 *   ② 채팅 — 고른 모델이 대화에 남고 공급자 · 원장 · 사건이 그 모델 · 본문에 없으면 대화의 것 · 허용 밖은 400(예약 · 셈 · 공급자 · 대화 모두 없음) ·
 *      회수되면 다음 턴은 기본(대화는 자동으로) · 모델을 바꿔도 앞선 턴이 실린다 · 다시 열면 답마다 그 모델
 *   ③ 편집기의 기능은 워크스페이스 기본 — 묻기 · 게이트(고치기)
 *   ④ 사용량 개요 — 이번 달 합 · 30일(UTC 날 · 기능마다) · 사람 · 기능 · 모델이 꾸민 원장과 맞다 · 멤버는 자기 것만
 *   ⑤ 활동 기록 — 볼 수 없는 페이지는 제목 없이 · 멤버는 자기 것만(남을 거르면 forbidden) · 키셋 커서는 같은 시각의 줄도 빠짐 · 겹침이 없다 ·
 *      사람 · 기능으로 거른다 · 틀린 커서는 invalid_input
 */

import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query } from '../db/pool.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE, startFakeAiProvider, type FakeAiProvider } from '../testing/fake-ai-provider.ts'
import { aiUsageLogFor, aiUsageOverviewFor } from './analytics.ts'
import { getChatSession } from './chat-store.ts'
import { aiChatResponse } from './chat-http.ts'
import { aiCompleteResponse } from './complete-http.ts'
import { readAiConfig, type AiConfig } from './config.ts'
import { aiModelChoicesFor, aiModelSettingsFor, setAiModels } from './model-setting.ts'
import { clearModelListCache } from './models.ts'
import { createSseParser, type SseEvent } from './sse.ts'
import { reserveAiResponse, setAiEnabled } from './usage.ts'

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

beforeEach(() => clearModelListCache())

const farDay = (): Date =>
  new Date(Date.UTC(2200 + Math.floor(Math.random() * 700), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 10))
/** 먼 날에서 1초씩 가는 시계 — 원장의 차례가 부른 차례와 같다. */
let clock = farDay().getTime()
const tick = () => new Date((clock += 1000))

async function events(res: Response): Promise<SseEvent[]> {
  const parser = createSseParser()
  return [...parser.push(await res.text()), ...parser.end()]
}
const dataOf = (es: SseEvent[], name: string) => {
  const e = es.find((x) => x.event === name)
  return e === undefined ? null : (JSON.parse(e.data) as Record<string, unknown>)
}
const chat = (who: Actor, body: unknown) => {
  const now = tick()
  return aiChatResponse(who.ctx, body, new AbortController().signal, { config, now: () => now })
}
const lastSentModel = () => fake.requests.at(-1)?.body.model

async function aiWorkspace() {
  const fx = await makeFixture()
  assert.ok((await setAiEnabled(fx.owner.ctx, true)).ok)
  const member = await joinAs(fx.workspaceId, await createUser('모델의 멤버'), 'member')
  return { ws: fx.workspaceId, owner: fx.owner, member }
}

const usageOf = async (ws: string) =>
  query<{ id: string; model: string; feature: string; user_id: string }>(`SELECT id, model, feature, user_id FROM ai_usage WHERE workspace_id = $1 ORDER BY created_at, id`, [ws])

describe('AI 모델 고르기 · 사용량 분석 (AI-7)', () => {
  test('★ ① 모델 설정 — 소유자만 · 바뀔 때만 감사 · 목록 밖의 새 모델 거부 · 소유자만 공급자의 목록을 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await aiWorkspace()

    const memberView = await aiModelSettingsFor(member.ctx, { config })
    assert.deepEqual(memberView, { autoModel: FAKE_AI_MODEL, allowed: [], defaultModel: null, canManage: false, available: null, source: null })
    const calls = fake.modelListCalls()
    const ownerView = await aiModelSettingsFor(owner.ctx, { config })
    assert.deepEqual(ownerView?.available, [FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE], '거를 것(받아쓰기 · 말하기 · 안전 · 임베딩 · 내린 것)은 없다')
    assert.equal(ownerView?.source, 'provider')
    assert.equal(fake.modelListCalls(), calls + 1, '소유자가 볼 때만 묻는다')

    assert.deepEqual(await setAiModels(member.ctx, { allowed: [FAKE_AI_MODEL_LARGE], default: FAKE_AI_MODEL_LARGE }, { config }), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setAiModels(owner.ctx, { allowed: ['not-listed'], default: null }, { config }), { ok: false, reason: 'unknown_model' })
    assert.deepEqual(await setAiModels(owner.ctx, { allowed: ['whisper-large-v3'], default: null }, { config }), { ok: false, reason: 'unknown_model' }, '걸러진 모델')
    assert.deepEqual(await setAiModels(owner.ctx, { allowed: [], default: FAKE_AI_MODEL_LARGE }, { config }), { ok: false, reason: 'default_not_allowed' })
    assert.deepEqual(await setAiModels(owner.ctx, { allowed: [FAKE_AI_MODEL_LARGE] }, { config: null }), { ok: false, reason: 'ai_unavailable' })

    const setAudits = async () =>
      query<{ value_before: unknown; value_after: unknown; actor_user_id: string }>(
        `SELECT value_before, value_after, actor_user_id FROM audit_event WHERE workspace_id = $1 AND setting_key = 'ai.models' ORDER BY occurred_at, id`,
        [ws],
      )
    assert.equal((await setAudits()).length, 0, '거부는 감사하지 않는다')

    assert.deepEqual(await setAiModels(owner.ctx, { allowed: [FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL], default: FAKE_AI_MODEL_LARGE }, { config }), {
      ok: true,
      value: { allowed: [FAKE_AI_MODEL_LARGE], defaultModel: FAKE_AI_MODEL_LARGE },
    })
    const row = (await query<{ allowed_models: string[]; default_model: string | null; enabled: boolean }>(
      `SELECT allowed_models, default_model, enabled FROM workspace_ai_setting WHERE workspace_id = $1`,
      [ws],
    ))[0]
    assert.deepEqual(row, { allowed_models: [FAKE_AI_MODEL_LARGE], default_model: FAKE_AI_MODEL_LARGE, enabled: true }, '스위치는 그대로')
    // 같은 것을 다시 — 감사 없음
    assert.ok((await setAiModels(owner.ctx, { allowed: [FAKE_AI_MODEL_LARGE], default: FAKE_AI_MODEL_LARGE }, { config })).ok)
    const audits = await setAudits()
    assert.equal(audits.length, 1, '바뀔 때만 한 줄')
    assert.deepEqual(audits[0], {
      value_before: { allowed: [], default: null },
      value_after: { allowed: [FAKE_AI_MODEL_LARGE], default: FAKE_AI_MODEL_LARGE },
      actor_user_id: owner.userId,
    })
    assert.deepEqual(await aiModelChoicesFor(member.ctx, config), { defaultModel: FAKE_AI_MODEL_LARGE, allowed: [FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE] })
    assert.equal(await aiModelChoicesFor(member.ctx, null), null, '공급자 없음 — 고르개 없음')

    // 스위치 줄이 없는 워크스페이스 — 꺼진 채로 만든다
    const bare = await makeFixture()
    assert.ok((await setAiModels(bare.owner.ctx, { allowed: [FAKE_AI_MODEL_LARGE], default: null }, { config })).ok)
    const made = (await query<{ enabled: boolean; allowed_models: string[] }>(`SELECT enabled, allowed_models FROM workspace_ai_setting WHERE workspace_id = $1`, [bare.workspaceId]))[0]
    assert.deepEqual(made, { enabled: false, allowed_models: [FAKE_AI_MODEL_LARGE] })
  })

  test('★ ② 채팅 — 고른 모델이 대화 · 공급자 · 원장 · 사건에 · 허용 밖은 400(아무것도 없음) · 회수되면 기본으로 · 문맥은 이어진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await aiWorkspace()
    assert.ok((await setAiModels(owner.ctx, { allowed: [FAKE_AI_MODEL_LARGE], default: null }, { config })).ok)

    // 첫 턴 — 큰 모델을 고른다
    const first = await events(await chat(member, { message: '첫 질문', model: FAKE_AI_MODEL_LARGE }))
    const opened = dataOf(first, 'session')!
    const sessionId = String(opened.sessionId)
    assert.equal(opened.model, FAKE_AI_MODEL_LARGE)
    assert.equal(dataOf(first, 'done')?.model, FAKE_AI_MODEL_LARGE)
    assert.equal(lastSentModel(), FAKE_AI_MODEL_LARGE, '공급자가 받은 모델')
    const stored = async () => (await query<{ model: string | null }>(`SELECT model FROM ai_chat_session WHERE id = $1`, [sessionId]))[0]?.model
    assert.equal(await stored(), FAKE_AI_MODEL_LARGE, '대화에 남는다')
    assert.deepEqual((await usageOf(ws)).map((u) => u.model), [FAKE_AI_MODEL_LARGE], '원장 = 실제 모델')

    // 본문에 모델이 없으면 — 대화의 것
    await events(await chat(member, { sessionId, message: '이어서' }))
    assert.equal(lastSentModel(), FAKE_AI_MODEL_LARGE)

    // 허용 밖 — 400 · 예약 · 셈 · 공급자 · 대화의 메시지 모두 없다
    const before = { usage: (await usageOf(ws)).length, calls: fake.requests.length, messages: (await query(`SELECT 1 FROM ai_chat_message WHERE session_id = $1`, [sessionId])).length }
    const refused = await chat(member, { sessionId, message: '안 되는 모델', model: 'whisper-large-v3' })
    assert.equal(refused.status, 400)
    assert.deepEqual(await refused.json(), { ok: false, error: 'model_not_allowed' })
    const refusedNew = await chat(member, { message: '새 대화도', model: 'nope' })
    assert.equal(refusedNew.status, 400)
    await refusedNew.body?.cancel()
    assert.deepEqual(
      { usage: (await usageOf(ws)).length, calls: fake.requests.length, messages: (await query(`SELECT 1 FROM ai_chat_message WHERE session_id = $1`, [sessionId])).length },
      before,
      '아무것도 쓰지 않았다',
    )
    assert.equal(await stored(), FAKE_AI_MODEL_LARGE, '대화의 모델도 그대로')

    // 자동(null) — 워크스페이스 기본(정하지 않았으니 AI_MODEL) · 대화는 자동으로 · 앞선 턴이 그대로 실린다(모델을 바꿔도 문맥 유지)
    await events(await chat(member, { sessionId, message: '[echo] 자동으로', model: null }))
    assert.equal(lastSentModel(), FAKE_AI_MODEL)
    assert.equal(await stored(), null)
    const sent = (fake.requests.at(-1)!.body.messages as { role: string; content: string }[]).map((m) => m.content).join('\n')
    assert.ok(sent.includes('첫 질문') && sent.includes('이어서'), '앞선 턴이 실린다')

    // 다시 큰 모델 → 소유자가 회수 → 본문에 모델 없는 다음 턴은 기본 · 대화는 자동으로
    await events(await chat(member, { sessionId, message: '다시 큰 것', model: FAKE_AI_MODEL_LARGE }))
    assert.ok((await setAiModels(owner.ctx, { allowed: [], default: null }, { config })).ok)
    const after = await events(await chat(member, { sessionId, message: '회수 뒤' }))
    assert.equal(dataOf(after, 'done')?.model, FAKE_AI_MODEL)
    assert.equal(lastSentModel(), FAKE_AI_MODEL)
    assert.equal(await stored(), null, '회수된 모델은 자동으로 바뀐다')
    // 회수된 모델을 본문에 대면 — 거부
    const revoked = await chat(member, { sessionId, message: 'x', model: FAKE_AI_MODEL_LARGE })
    assert.equal(revoked.status, 400)
    await revoked.body?.cancel()

    // 다시 열면 — 답마다 그 답을 쓴 모델(원장의 것)
    const view = await getChatSession(member.ctx, sessionId)
    assert.deepEqual(
      view?.messages.filter((m) => m.role === 'assistant').map((m) => m.model),
      [FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL],
    )
    assert.equal(view?.model, null)
    assert.deepEqual((await usageOf(ws)).map((u) => u.model), [FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL, FAKE_AI_MODEL_LARGE, FAKE_AI_MODEL])
  })

  test('★ ③ 편집기의 기능은 워크스페이스 기본 — 묻기는 공급자 · 원장이 기본 모델 · 고치기의 게이트도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await aiWorkspace()
    const ask = async () => {
      const now = tick()
      const res = await aiCompleteResponse(member.ctx, { feature: 'ask', prompt: '요약해 줘' }, new AbortController().signal, { config, now: () => now })
      assert.equal(res.status, 200)
      await res.text()
    }
    await ask()
    assert.equal(lastSentModel(), FAKE_AI_MODEL, '정하지 않았으면 자동')
    assert.ok((await setAiModels(owner.ctx, { allowed: [FAKE_AI_MODEL_LARGE], default: FAKE_AI_MODEL_LARGE }, { config })).ok)
    await ask()
    assert.equal(lastSentModel(), FAKE_AI_MODEL_LARGE)
    assert.deepEqual((await usageOf(ws)).map((u) => [u.feature, u.model]), [['ask', FAKE_AI_MODEL], ['ask', FAKE_AI_MODEL_LARGE]])
    const page = (await createPage(member.ctx, { title: titleFromPlainText('고칠 글') })).id
    const reserved = await reserveAiResponse(member.ctx, { feature: 'edit', pageId: page }, { config, now: tick() })
    assert.ok(reserved.ok && reserved.reservation.model === FAKE_AI_MODEL_LARGE, JSON.stringify(reserved))
    // 게이트에 직접 허용 밖을 대면 — 예약하지 않는다
    const n = (await usageOf(ws)).length
    assert.deepEqual(await reserveAiResponse(member.ctx, { feature: 'chat', model: 'nope' }, { config, now: tick() }), { ok: false, reason: 'model_not_allowed' })
    assert.equal((await usageOf(ws)).length, n)
  })

  describe('사용량 개요 · 활동 기록', () => {
    const NOW = new Date('2031-05-20T12:00:00Z')
    let fx: Awaited<ReturnType<typeof aiWorkspace>>
    let admin: Actor
    let sharedPage: string
    let memberPrivate: string

    /** 원장에 한 줄 — 시각 · 사람 · 기능 · 모델 · 상태 · 토큰 · 페이지(워크스페이스는 기본이 이 묶음의 것). */
    const seed = async (
      who: Actor,
      o: { at: string; feature?: string; model?: string; status?: string; inT?: number | null; outT?: number | null; page?: string | null },
      ws: string = fx.ws,
    ) => {
      const status = o.status ?? 'completed'
      const id = randomUUID()
      await query(
        `INSERT INTO ai_usage (id, workspace_id, user_id, feature, status, quota, model, input_tokens, output_tokens, page_id, created_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, 'trial', $6, $7, $8, $9, $10::timestamptz, CASE WHEN $5 = 'reserved' THEN NULL ELSE $10::timestamptz END)`,
        [
          id,
          ws,
          who.userId,
          o.feature ?? 'chat',
          status,
          o.model ?? FAKE_AI_MODEL,
          // 실패는 토큰이 없다 · null 을 준 칸은 null 그대로(?? 를 쓰면 기본값이 된다)
          status === 'failed' ? null : o.inT === undefined ? 10 : o.inT,
          status === 'failed' ? null : o.outT === undefined ? 5 : o.outT,
          o.page ?? null,
          o.at,
        ],
      )
      return id
    }

    before(async () => {
      if (skipReason) return
      fx = await aiWorkspace()
      admin = await joinAs(fx.ws, await createUser('모델의 관리자'), 'membership_admin')
      sharedPage = (await createPage(fx.owner.ctx, { title: titleFromPlainText('함께 보는 계획') })).id
      memberPrivate = (await createPage(fx.member.ctx, { privateTop: true, title: titleFromPlainText('멤버만의 메모') })).id
      // 이번 달(5월) — 소유자: 채팅 2(큰 모델 1) · 묻기 1 · 실패 1 / 멤버: 번역 3(하나는 멤버만의 페이지) · 멈춤 1 · 진행 중 1
      await seed(fx.owner, { at: '2031-05-20T09:00:00Z', feature: 'chat', model: FAKE_AI_MODEL_LARGE, inT: 100, outT: 40, page: sharedPage })
      await seed(fx.owner, { at: '2031-05-19T23:59:59Z', feature: 'chat' })
      await seed(fx.owner, { at: '2031-05-02T00:00:00Z', feature: 'ask', inT: 7, outT: 3 })
      await seed(fx.owner, { at: '2031-05-10T10:00:00Z', feature: 'ask', status: 'failed' })
      await seed(fx.member, { at: '2031-05-20T00:00:00Z', feature: 'translate', page: memberPrivate })
      await seed(fx.member, { at: '2031-05-18T12:00:00Z', feature: 'translate' })
      await seed(fx.member, { at: '2031-05-18T13:00:00Z', feature: 'translate' })
      await seed(fx.member, { at: '2031-05-15T08:00:00Z', feature: 'block', status: 'stopped', inT: 1, outT: 1 })
      await seed(fx.member, { at: '2031-05-20T11:00:00Z', feature: 'edit', status: 'reserved', inT: null, outT: null })
      // 지난달 — 30일 막대에는 들고(4/21 이후) 이번 달 합에는 없다 · 4/20 은 30일 밖
      await seed(fx.owner, { at: '2031-04-25T05:00:00Z', feature: 'block', model: FAKE_AI_MODEL_LARGE })
      await seed(fx.owner, { at: '2031-04-20T05:00:00Z', feature: 'block' })
    })

    test('★ ④ 개요 — 이번 달 합 · 30일(UTC 날 · 기능마다) · 사람 · 기능 · 모델이 원장과 맞다 · 멤버는 자기 것만', async (t) => {
      if (skipReason) return t.skip(skipReason)
      const all = await aiUsageOverviewFor(fx.owner.ctx, { now: NOW })
      assert.ok(all !== null)
      assert.equal(all.scope, 'workspace')
      assert.equal(all.monthStart, '2031-05-01T00:00:00.000Z')
      // 응답 = 실패를 뺀 것(진행 중 · 멈춤은 든다) — 소유자 3 + 멤버 5 = 8 · 실패 1
      assert.deepEqual(all.month, { responses: 8, failed: 1, inputTokens: 100 + 10 + 7 + 10 + 10 + 10 + 1, outputTokens: 40 + 5 + 3 + 5 + 5 + 5 + 1 })
      // 30일 — 4/21 ~ 5/20 · 날은 UTC(5/19 23:59:59 는 5/19)
      assert.equal(all.daily.days[0], '2031-04-21')
      assert.equal(all.daily.days.at(-1), '2031-05-20')
      const day = (d: string) => all.daily.days.indexOf(d)
      assert.equal(all.daily.byFeature.chat[day('2031-05-20')], 1)
      assert.equal(all.daily.byFeature.chat[day('2031-05-19')], 1)
      assert.equal(all.daily.byFeature.translate[day('2031-05-20')], 1)
      assert.equal(all.daily.byFeature.edit[day('2031-05-20')], 1, '진행 중도 든다')
      assert.equal(all.daily.totals[day('2031-05-20')], 3)
      assert.equal(all.daily.byFeature.translate[day('2031-05-18')], 2)
      assert.equal(all.daily.byFeature.ask[day('2031-05-10')], 0, '실패는 막대에 없다')
      assert.equal(all.daily.byFeature.block[day('2031-04-25')], 1, '지난달이어도 30일 안')
      assert.equal(all.daily.totals.reduce((a, b) => a + b, 0), 9, '4/20 은 30일 밖')
      // 사람마다(이번 달) — 응답이 많은 차례
      assert.deepEqual(
        all.members.map((m) => [m.userId, m.responses, m.inputTokens, m.outputTokens]),
        [
          [fx.member.userId, 5, 31, 16],
          [fx.owner.userId, 3, 117, 48],
        ],
      )
      assert.equal(all.members[0]?.lastUsedAt, '2031-05-20T11:00:00.000Z')
      assert.deepEqual(all.features.map((f) => [f.feature, f.responses]), [['translate', 3], ['chat', 2], ['ask', 1], ['block', 1], ['edit', 1]])
      assert.deepEqual(all.models.map((m) => [m.model, m.responses]), [[FAKE_AI_MODEL, 7], [FAKE_AI_MODEL_LARGE, 1]])
      assert.deepEqual(all.people.map((p) => p.id).sort(), [fx.owner.userId, fx.member.userId].sort())
      // 멤버 관리자도 전체
      assert.equal((await aiUsageOverviewFor(admin.ctx, { now: NOW }))?.scope, 'workspace')

      // 멤버 — 자기 것만
      const own = await aiUsageOverviewFor(fx.member.ctx, { now: NOW })
      assert.ok(own !== null)
      assert.equal(own.scope, 'self')
      assert.deepEqual(own.month, { responses: 5, failed: 0, inputTokens: 31, outputTokens: 16 })
      assert.deepEqual(own.members.map((m) => m.userId), [fx.member.userId])
      assert.deepEqual(own.people.map((p) => p.id), [fx.member.userId])
      assert.equal(own.daily.byFeature.chat.reduce((a, b) => a + b, 0), 0, '소유자의 채팅은 보이지 않는다')
      assert.deepEqual(own.models.map((m) => [m.model, m.responses]), [[FAKE_AI_MODEL, 5]])
      assert.equal(own.quota.trial?.limit, 20, '한도는 워크스페이스의 것(AI-1 의 뷰)')
    })

    test('★ ⑤ 활동 기록 — 볼 수 없는 페이지 · 멤버는 자기 것만 · 키셋 커서(같은 시각도) · 거르기 · 틀린 커서', async (t) => {
      if (skipReason) return t.skip(skipReason)
      const first = await aiUsageLogFor(fx.owner.ctx)
      assert.ok(first.ok)
      const entries = first.value.entries
      assert.equal(entries.length, 11)
      assert.equal(first.value.nextCursor, null)
      assert.deepEqual(entries.slice(0, 3).map((e) => [e.feature, e.status]), [['edit', 'reserved'], ['chat', 'completed'], ['translate', 'completed']], '최근 것부터')
      const top = entries[1]!
      assert.deepEqual([top.model, top.inputTokens, top.outputTokens, top.user.id, top.page], [FAKE_AI_MODEL_LARGE, 100, 40, fx.owner.userId, { kind: 'page', id: sharedPage, title: '함께 보는 계획' }])
      assert.deepEqual(entries[2]?.page, { kind: 'hidden' }, '소유자도 멤버의 개인 페이지는 볼 수 없다 — 제목 없이')
      assert.equal(entries.find((e) => e.status === 'failed')?.inputTokens, null)
      // 멤버 — 자기 것만 · 자기 페이지는 제목이 보인다
      const mine = await aiUsageLogFor(fx.member.ctx)
      assert.ok(mine.ok)
      assert.equal(mine.value.entries.length, 5)
      assert.ok(mine.value.entries.every((e) => e.user.id === fx.member.userId))
      assert.deepEqual(mine.value.entries.find((e) => e.page !== null)?.page, { kind: 'page', id: memberPrivate, title: '멤버만의 메모' })
      assert.deepEqual(await aiUsageLogFor(fx.member.ctx, { member: fx.owner.userId }), { ok: false, reason: 'forbidden' })
      assert.ok((await aiUsageLogFor(fx.member.ctx, { member: fx.member.userId })).ok)
      // 거르기
      const translated = await aiUsageLogFor(fx.owner.ctx, { feature: 'translate' })
      assert.ok(translated.ok && translated.value.entries.length === 3 && translated.value.entries.every((e) => e.feature === 'translate'))
      const ownerOnly = await aiUsageLogFor(admin.ctx, { member: fx.owner.userId })
      assert.ok(ownerOnly.ok && ownerOnly.value.entries.length === 6 && ownerOnly.value.entries.every((e) => e.user.id === fx.owner.userId))
      for (const bad of [{ cursor: 'nope' }, { member: 'x' }, { feature: 'summarize' }]) {
        assert.deepEqual(await aiUsageLogFor(fx.owner.ctx, bad), { ok: false, reason: 'invalid_input' }, JSON.stringify(bad))
      }

      // 키셋 — 같은 마이크로초의 줄 다섯 + 1µs 씩 다른 줄 셋을 세 개씩 넘긴다 — 빠짐 · 겹침 없이 (시각 desc, id desc)
      const clash = await aiWorkspace()
      const same = '2031-05-20T08:00:00.123456Z'
      const ids: string[] = []
      for (let i = 0; i < 5; i += 1) ids.push(await seed(clash.member, { at: same }, clash.ws))
      for (const iso of ['2031-05-20T08:00:00.123457Z', '2031-05-20T08:00:00.123455Z', '2031-05-20T08:00:00.123458Z']) ids.push(await seed(clash.member, { at: iso }, clash.ws))
      const seen: string[] = []
      let cursor: string | null = null
      for (let pageNo = 0; pageNo < 10; pageNo += 1) {
        const got = await aiUsageLogFor(clash.owner.ctx, { cursor, limit: 3 })
        assert.ok(got.ok)
        seen.push(...got.value.entries.map((e) => e.id))
        cursor = got.value.nextCursor
        if (cursor === null) break
      }
      assert.equal(seen.length, 8, '빠짐 없이')
      assert.equal(new Set(seen).size, 8, '겹침 없이')
      const expected = (await query<{ id: string }>(`SELECT id FROM ai_usage WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC`, [clash.ws])).map((r) => r.id)
      assert.deepEqual(seen, expected)
      assert.deepEqual(new Set(seen), new Set(ids))
    })
  })
})
