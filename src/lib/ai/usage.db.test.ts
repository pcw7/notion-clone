/**
 * AI 게이트 · 원장 · 스위치 · 보충 — AI-1 (F-10-12 · F-10-25 · DB · 공급자를 부르지 않는다)
 *
 *   ① 스위치 — 기본 끔 · 꺼져 있으면 예약하지 않는다 · 소유자만 · 바뀔 때만 감사 한 줄
 *   ② 셈 — 예약이 곧 셈 · completed(토큰) · failed(빠진다 · 하루 카운터를 돌려준다) · stopped(든다) · 끝나지 않은 예약도 센다 · 두 번 닫지 않는다
 *   ③ 동시 예약 — 남은 수 N-1 에 N 개가 함께 와도 N-1 개만 · 하루 상한도 워크스페이스를 넘어 함께
 *   ④ 앱 전체 하루 상한 — 워크스페이스를 넘어 · 다음 UTC 날 · 실패는 자리를 돌려준다
 *   ⑤ 보충 — 요금제 몫 다음 · 만료가 이른 것부터 · 만료된 것은 쓰지 않는다 · 실패는 보충을 쓰지 않는다 · 명령의 거부
 *   ⑥ 요금제 몫 — Business 의 창 · 월 · 풀리는 시각 · 엔타이틀먼트 시드
 *   ⑦ 사람 · 맥락 — 게스트 · 볼 수 없는 페이지 · 공급자 없음 · 설정 화면의 요약
 *
 * 시각은 넘긴다 — 하루 카운터는 앱 전체의 것이라 시험마다 겹치지 않는 먼 날을 쓴다(다른 시험 · 지난 판의 수가 섞이지 않게).
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { query } from '../db/pool.ts'
import type { WorkspaceId } from '../ids.ts'
import { createBareWorkspace, createUser, joinAs, makeFixture, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { FAKE_AI_KEY, FAKE_AI_MODEL } from '../testing/fake-ai-provider.ts'
import type { AiConfig } from './config.ts'
import {
  aiQuotaViewFor,
  aiSettingsSummary,
  finishAiResponse,
  grantAiResponses,
  reserveAiResponse,
  setAiEnabled,
  type AiReserveResult,
} from './usage.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

// 공급자는 부르지 않는다 — 그래도 환경은 가짜를 가리킨다(.env 의 진짜 키가 어디서도 쓰이지 않게)
const FAKE_BASE = 'http://127.0.0.1:9/v1'
process.env.AI_BASE_URL = FAKE_BASE
process.env.AI_API_KEY = FAKE_AI_KEY
process.env.AI_MODEL = FAKE_AI_MODEL

const CONFIG: AiConfig = {
  baseUrl: FAKE_BASE,
  apiKey: FAKE_AI_KEY,
  model: FAKE_AI_MODEL,
  maxOutputTokens: 64,
  maxInputChars: 1000,
  dailyCap: 1_000_000,
  timeoutMs: 5000,
  streamUsage: true,
  reasoningEffort: null,
}

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 겹치지 않는 먼 UTC 날의 10:00 — 하루 카운터를 이 시험만 쓴다. */
const farDay = (): Date =>
  new Date(Date.UTC(2200 + Math.floor(Math.random() * 700), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 10))
const dayOf = (now: Date) => now.toISOString().slice(0, 10)
const dailyOf = async (now: Date) =>
  (await query<{ responses: number }>(`SELECT responses FROM ai_daily_usage WHERE day = $1::date`, [dayOf(now)]))[0]?.responses ?? 0

/** AI 를 켠 워크스페이스와 소유자. */
async function aiWorkspace(plan: 'free' | 'business' = 'free'): Promise<{ ws: WorkspaceId; owner: Actor }> {
  const fx = await makeFixture()
  if (plan !== 'free') await setWorkspacePlan(fx.workspaceId, plan)
  assert.deepEqual(await setAiEnabled(fx.owner.ctx, true), { ok: true, value: { enabled: true } })
  return { ws: fx.workspaceId, owner: fx.owner }
}

/** 원장에 미리 n 줄 — 이미 쓴 것을 꾸민다. */
async function seedUsage(ws: string, userId: string, quota: 'plan' | 'trial', n: number, at: Date, status = 'completed'): Promise<void> {
  await query(
    `INSERT INTO ai_usage (id, workspace_id, user_id, feature, status, quota, model, created_at, finished_at)
     SELECT gen_random_uuid(), $1, $2, 'ask', $3::text, $4, 'seed', $5::timestamptz + (g * interval '1 second'),
            CASE WHEN $3::text = 'reserved' THEN NULL ELSE $5::timestamptz + (g * interval '1 second') END
       FROM generate_series(0, $6::int - 1) AS g`,
    [ws, userId, status, quota, at, n],
  )
}

const rowOf = async (id: string) =>
  (await query<{ status: string; quota: string; input_tokens: number | null; output_tokens: number | null; finished: boolean; page_id: string | null; grant_id: string | null }>(
    `SELECT status, quota, input_tokens, output_tokens, finished_at IS NOT NULL AS finished, page_id, grant_id FROM ai_usage WHERE id = $1`,
    [id],
  ))[0]

const reserve = (who: Actor, now: Date, config: AiConfig = CONFIG, pageId: string | null = null) =>
  reserveAiResponse(who.ctx, { feature: 'ask', pageId }, { config, now })
const okId = (r: AiReserveResult): string => {
  assert.ok(r.ok, JSON.stringify(r))
  return r.reservation.id
}

describe('① 스위치', () => {
  test('★ 기본 끔 · 꺼져 있으면 예약하지 않는다 · 소유자만 · 바뀔 때만 감사 한 줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await makeFixture()
    const admin = await joinAs(fx.workspaceId, await createUser('AI 의 멤버 관리자'), 'membership_admin')
    const member = await joinAs(fx.workspaceId, await createUser('AI 의 멤버'), 'member')
    const now = farDay()

    assert.equal((await aiSettingsSummary(fx.owner.ctx, { config: CONFIG }))?.enabled, false, '기본은 끔')
    assert.deepEqual(await reserve(fx.owner, now), { ok: false, reason: 'ai_disabled' })
    assert.equal(await dailyOf(now), 0, '꺼진 곳의 거부는 하루 카운터를 건드리지 않는다')

    assert.deepEqual(await setAiEnabled(member.ctx, true), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setAiEnabled(admin.ctx, true), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setAiEnabled(fx.owner.ctx, 'true'), { ok: false, reason: 'invalid_value' })
    assert.deepEqual(await setAiEnabled(fx.owner.ctx, true), { ok: true, value: { enabled: true } })
    assert.deepEqual(await setAiEnabled(fx.owner.ctx, true), { ok: true, value: { enabled: true } }, '같은 값')

    const audits = () =>
      query<{ setting_key: string; value_before: unknown; value_after: unknown; actor_user_id: string }>(
        `SELECT setting_key, value_before, value_after, actor_user_id FROM audit_event
          WHERE workspace_id = $1 AND event_type = 'workspace.setting_changed' AND setting_key = 'ai.enabled' ORDER BY occurred_at`,
        [fx.workspaceId],
      )
    assert.deepEqual(await audits(), [{ setting_key: 'ai.enabled', value_before: false, value_after: true, actor_user_id: fx.owner.userId }])
    assert.equal((await aiSettingsSummary(member.ctx, { config: CONFIG }))?.enabled, true, '멤버도 상태를 본다')
    assert.equal((await aiSettingsSummary(member.ctx, { config: CONFIG }))?.canManage, false)

    assert.ok((await reserve(member, now)).ok, '켜면 멤버도 쓴다')
    assert.deepEqual(await setAiEnabled(fx.owner.ctx, false), { ok: true, value: { enabled: false } })
    assert.deepEqual(await reserve(member, now), { ok: false, reason: 'ai_disabled' })
    assert.equal((await audits()).length, 2)
  })
})

describe('② 셈', () => {
  test('★ 예약이 곧 셈 · completed(토큰) · failed(빠진다 · 하루를 돌려준다) · stopped(든다) · 끝나지 않은 예약도 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace('free')
    const now = farDay()

    const a = okId(await reserve(owner, now))
    assert.deepEqual(await rowOf(a), { status: 'reserved', quota: 'trial', input_tokens: null, output_tokens: null, finished: false, page_id: null, grant_id: null })
    assert.equal(await dailyOf(now), 1)
    assert.equal((await aiQuotaViewFor(ws, now)).trial?.used, 1, '예약만으로 센다')

    assert.equal(await finishAiResponse(a, 'completed', { inputTokens: 12, outputTokens: 34 }, now), true)
    assert.deepEqual(await rowOf(a), { status: 'completed', quota: 'trial', input_tokens: 12, output_tokens: 34, finished: true, page_id: null, grant_id: null })
    assert.equal(await finishAiResponse(a, 'failed', null, now), false, '두 번 닫지 않는다')
    assert.equal((await rowOf(a))?.status, 'completed')
    assert.equal(await dailyOf(now), 1, '닫힌 줄의 실패는 하루를 돌려주지 않는다')

    const b = okId(await reserve(owner, now))
    assert.equal(await dailyOf(now), 2)
    await finishAiResponse(b, 'failed', null, now)
    assert.equal((await rowOf(b))?.status, 'failed')
    assert.equal(await dailyOf(now), 1, '실패는 그날의 자리를 돌려준다')

    const c = okId(await reserve(owner, now))
    await finishAiResponse(c, 'stopped', { inputTokens: 5, outputTokens: null }, now)
    assert.deepEqual([(await rowOf(c))?.status, (await rowOf(c))?.input_tokens], ['stopped', 5])

    okId(await reserve(owner, now)) // 끝나지 않은 예약
    const view = await aiQuotaViewFor(ws, now)
    assert.deepEqual(view.trial, { used: 3, limit: 20 }, 'completed · stopped · reserved 는 세고 failed 는 빼다')
    assert.equal(view.remaining, 17)
    assert.equal(await dailyOf(now), 3)

    // 어제 예약한 것이 오늘 실패하면 어제의 자리를 돌려준다
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const d = okId(await reserve(owner, yesterday))
    assert.equal(await dailyOf(yesterday), 1)
    await finishAiResponse(d, 'failed', null, now)
    assert.deepEqual([await dailyOf(yesterday), await dailyOf(now)], [0, 3])
  })
})

describe('③ 동시 예약', () => {
  test('★ 남은 수가 N-1 일 때 N 개가 함께 와도 N-1 개만 — 같은 잔량을 두 번 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace('free')
    const now = farDay()
    await seedUsage(ws, owner.userId, 'trial', 15, new Date(now.getTime() - 60_000)) // 체험 20 중 15 — 남은 5
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve(owner, now)))
    const passed = results.filter((r) => r.ok).length
    const refused = results.filter((r) => !r.ok)
    assert.equal(passed, 5, JSON.stringify(results))
    assert.deepEqual(refused, [{ ok: false, reason: 'ai_limit_reached', limit: 'trial', resetsAt: null }])
    assert.equal((await aiQuotaViewFor(ws, now)).trial?.used, 20)
    assert.equal(await dailyOf(now), 5)
  })

  test('★ 하루 상한도 워크스페이스를 넘어 함께 — 상한 3 에 넷이 함께 오면 셋만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const one = await aiWorkspace('free')
    const two = await aiWorkspace('free')
    const now = farDay()
    const capped = { ...CONFIG, dailyCap: (await dailyOf(now)) + 3 }
    const results = await Promise.all([one.owner, two.owner, one.owner, two.owner].map((who) => reserve(who, now, capped)))
    assert.equal(results.filter((r) => r.ok).length, 3, JSON.stringify(results))
    assert.equal(results.filter((r) => !r.ok && r.reason === 'ai_limit_reached' && r.limit === 'daily').length, 1)
  })
})

describe('④ 앱 전체 하루 상한', () => {
  test('★ 워크스페이스를 넘어 센다 · 다음 UTC 날에 풀린다 · 실패가 자리를 돌려준다 · 다음 날은 새로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const one = await aiWorkspace('free')
    const two = await aiWorkspace('free')
    const now = farDay()
    const capped = { ...CONFIG, dailyCap: 2 }
    const first = okId(await reserve(one.owner, now, capped))
    okId(await reserve(one.owner, now, capped))
    const refused = await reserve(two.owner, now, capped)
    const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
    assert.deepEqual(refused, { ok: false, reason: 'ai_limit_reached', limit: 'daily', resetsAt: nextDay })
    await finishAiResponse(first, 'failed', null, now)
    assert.ok((await reserve(two.owner, now, capped)).ok, '실패가 돌려준 자리')
    assert.equal((await reserve(two.owner, now, capped)).ok, false)
    assert.ok((await reserve(two.owner, new Date(nextDay), capped)).ok, '다음 UTC 날')
  })
})

describe('⑤ 보충', () => {
  test('★ 체험을 다 쓴 뒤에 · 만료가 이른 것부터 · 만료된 것은 쓰지 않는다 · 실패는 보충을 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace('free')
    const now = farDay()
    const day = 24 * 60 * 60 * 1000
    const expired = await grantAiResponses(ws, { responses: 5, days: 1, reason: '지난 보충', now: new Date(now.getTime() - 2 * day) })
    const late = await grantAiResponses(ws, { responses: 1, now: new Date(now.getTime() - 1000) })
    const soon = await grantAiResponses(ws, { responses: 2, days: 3, reason: '  시험 보충  ', now: new Date(now.getTime() - 1000) })
    assert.ok(expired.ok && late.ok && soon.ok)
    assert.equal(soon.value.balance, 3, '만료된 5 는 남은 수에 들지 않는다')
    assert.equal((await query<{ reason: string }>(`SELECT reason FROM ai_grant WHERE id = $1`, [soon.value.grantId]))[0]?.reason, '시험 보충')

    const first = okId(await reserve(owner, now))
    assert.equal((await rowOf(first))?.quota, 'trial', '체험이 먼저')
    await seedUsage(ws, owner.userId, 'trial', 19, new Date(now.getTime() - 60_000)) // 체험 20 을 다 썼다

    const g1 = okId(await reserve(owner, now))
    assert.deepEqual([(await rowOf(g1))?.quota, (await rowOf(g1))?.grant_id], ['grant', soon.value.grantId], '만료가 이른 것')
    const failed = okId(await reserve(owner, now))
    await finishAiResponse(failed, 'failed', null, now)
    const g2 = okId(await reserve(owner, now))
    assert.equal((await rowOf(g2))?.grant_id, soon.value.grantId, '실패한 것은 보충을 쓰지 않았다')
    const g3 = okId(await reserve(owner, now))
    assert.equal((await rowOf(g3))?.grant_id, late.value.grantId, '만료 없음은 끝')
    assert.deepEqual(await reserve(owner, now), { ok: false, reason: 'ai_limit_reached', limit: 'trial', resetsAt: null }, '만료된 보충은 쓰지 않는다')
    const view = await aiQuotaViewFor(ws, now)
    assert.deepEqual([view.grantsLeft, view.remaining], [0, 0])
  })

  test('명령의 거부 — 없는 · 지운 워크스페이스 · 응답 수 · 일수 · 까닭 · 남은 수를 돌려준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('보충 거부')
    assert.deepEqual(await grantAiResponses('00000000-0000-4000-8000-000000000000', { responses: 1 }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await grantAiResponses('아님', { responses: 1 }), { ok: false, reason: 'not_found' })
    for (const responses of [0, -1, 1.5, '많이', 1_000_001]) {
      assert.deepEqual(await grantAiResponses(ws, { responses }), { ok: false, reason: 'invalid_responses' }, String(responses))
    }
    for (const days of [0, '0', 'x', 3651]) assert.deepEqual(await grantAiResponses(ws, { responses: 1, days }), { ok: false, reason: 'invalid_days' }, String(days))
    assert.deepEqual(await grantAiResponses(ws, { responses: 1, reason: '   ' }), { ok: false, reason: 'invalid_reason' })
    assert.deepEqual(await grantAiResponses(ws, { responses: 1, reason: '가'.repeat(201) }), { ok: false, reason: 'invalid_reason' })
    const a = await grantAiResponses(ws, { responses: '7', days: '30' })
    assert.ok(a.ok)
    assert.equal(a.value.balance, 7)
    assert.ok(a.value.expiresAt !== null)
    assert.equal((await query<{ reason: string }>(`SELECT reason FROM ai_grant WHERE id = $1`, [a.value.grantId]))[0]?.reason, '운영자 보충')
    const b = await grantAiResponses(ws, { responses: 3 })
    assert.ok(b.ok && b.value.balance === 10 && b.value.expiresAt === null, '멱등이 아니다 — 두 번 주면 두 번')
    await query(`UPDATE workspace SET deleted_at = now() WHERE id = $1`, [ws])
    assert.deepEqual(await grantAiResponses(ws, { responses: 1 }), { ok: false, reason: 'not_found' })
  })
})

describe('⑥ 요금제 몫', () => {
  test('★ Business — 창이 차면 window(가장 오래된 것 + 6시간) · 월이 차면 month(다음 UTC 달) · 그 뒤 보충', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace('business')
    const now = new Date(Date.UTC(2400 + Math.floor(Math.random() * 400), 2, 15, 10))
    const first = okId(await reserve(owner, now))
    assert.equal((await rowOf(first))?.quota, 'plan')

    // 창 100 — 05:00:00 부터 1초마다 99개를 더 넣었다(첫 예약 10:00 과 함께 100)
    const at5 = new Date(now.getTime() - 5 * 60 * 60 * 1000)
    await seedUsage(ws, owner.userId, 'plan', 99, at5)
    const byWindow = await reserve(owner, now)
    assert.deepEqual(byWindow, { ok: false, reason: 'ai_limit_reached', limit: 'window', resetsAt: new Date(at5.getTime() + 6 * 60 * 60 * 1000).toISOString() })
    // 실패한 것 · 6시간보다 오래된 것은 창에 들지 않는다
    assert.equal((await aiQuotaViewFor(ws, now)).window?.used, 100)

    // 이번 달의 앞날에 900개(창 밖) — 월 1,000 이 찬다
    await seedUsage(ws, owner.userId, 'plan', 900, new Date(Date.UTC(now.getUTCFullYear(), 2, 2)))
    const later = new Date(now.getTime() + 7 * 60 * 60 * 1000) // 창은 풀렸다 — 월이 막는다
    assert.deepEqual(await reserve(owner, later), {
      ok: false,
      reason: 'ai_limit_reached',
      limit: 'month',
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), 3, 1)).toISOString(),
    })
    const grant = await grantAiResponses(ws, { responses: 1, now: later })
    assert.ok(grant.ok)
    const viaGrant = okId(await reserve(owner, later))
    assert.equal((await rowOf(viaGrant))?.quota, 'grant', '요금제 몫을 다 쓴 뒤 보충')
    // 다음 달 — 월이 새로 차고 보충은 남지 않았다
    assert.equal((await rowOf(okId(await reserve(owner, new Date(Date.UTC(now.getUTCFullYear(), 3, 1, 0, 0, 1))))))?.quota, 'plan')
  })

  test('엔타이틀먼트 시드 — Free · Plus 체험 20 · Business 월 1,000 창 100 · Enterprise 월 3,000 창 300', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const rows = await query<{ code: string; key: string; value: number }>(
      `SELECT p.code, e.key, e.value FROM plan_entitlement e JOIN plan p ON p.id = e.plan_id WHERE e.key LIKE 'ai.%' AND e.kind = 'limit' ORDER BY e.key, p.price_monthly NULLS LAST`,
    )
    const by = (key: string) => rows.filter((r) => r.key === key).map((r) => [r.code, r.value])
    assert.deepEqual(by('ai.trial_responses'), [['free', 20], ['plus', 20], ['business', 0], ['enterprise', 0]])
    assert.deepEqual(by('ai.monthly_responses'), [['free', 0], ['plus', 0], ['business', 1000], ['enterprise', 3000]])
    assert.deepEqual(by('ai.window_responses'), [['free', 0], ['plus', 0], ['business', 100], ['enterprise', 300]])
  })
})

describe('⑦ 사람 · 맥락', () => {
  test('★ 게스트는 쓰지 않는다 · 볼 수 없는 페이지는 없는 것 · 볼 수 있으면 원장에 페이지 · 공급자 없음 · 설정 요약', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner } = await aiWorkspace('free')
    const member = await joinAs(ws, await createUser('AI 의 맥락 멤버'), 'member')
    const guest = await joinAs(ws, await createUser('AI 의 손님'), 'guest')
    const now = farDay()

    assert.deepEqual(await reserve(guest, now), { ok: false, reason: 'forbidden' })
    assert.equal(await aiSettingsSummary(guest.ctx, { config: CONFIG }), null, '게스트에게는 AI 절이 없다')

    const secret = (await createPage(owner.ctx, { privateTop: true, title: titleFromPlainText('AI 의 비밀 문서') })).id
    assert.deepEqual(await reserve(member, now, CONFIG, secret), { ok: false, reason: 'not_found' })
    assert.deepEqual(await reserve(member, now, CONFIG, 'x'), { ok: false, reason: 'not_found' })
    const mine = okId(await reserve(owner, now, CONFIG, secret))
    assert.equal((await rowOf(mine))?.page_id, secret)

    assert.deepEqual(await reserveAiResponse(owner.ctx, { feature: 'ask' }, { config: null, now }), { ok: false, reason: 'ai_unavailable' })
    const summary = await aiSettingsSummary(owner.ctx, { config: CONFIG, now })
    assert.deepEqual(
      summary && { enabled: summary.enabled, canManage: summary.canManage, available: summary.available, host: summary.providerHost, model: summary.model, used: summary.quota.trial?.used },
      { enabled: true, canManage: true, available: true, host: '127.0.0.1:9', model: FAKE_AI_MODEL, used: 1 },
    )
    const unconfigured = await aiSettingsSummary(member.ctx, { config: null })
    assert.deepEqual([unconfigured?.available, unconfigured?.providerHost, unconfigured?.canManage], [false, null, false])
  })
})
