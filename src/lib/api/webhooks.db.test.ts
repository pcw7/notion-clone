/**
 * 공개 API 웹훅 — 구독 · 확인 · 서명 · 배달 · 다시 보내기 · 멈춤 · 권한 · 상한 · 비밀 (API-8 · F-09-09 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · 마이그레이션 0151
 *
 *   ① ★ 만들기 → 받는 서버가 확인 토큰을 받는다 → 틀린 토큰은 거부 · 맞는 토큰이면 켜짐 → 테스트 이벤트가 서명과 함께 간다(진짜 http 서버)
 *   ② ★ 500 → 백오프로 다시(시도 번호가 오른다) · 여덟 번째도 실패면 `failed` · 세 이벤트가 잇달아 실패하면 꺼진다 · 다시 켜기
 *   ③ ★ 아웃박스(API-9 의 길) — 고른 종류 · 켜진 구독에만 · 대상마다 차례 · 볼 수 없는 대상은 건너뜀
 *   ④ ★ 토큰 폐기 · 만료 · 사람이 빠지면 보내지 않는다(건너뜀) — 발급자는 그대로 둘(`resolveSessionContext({ apiTokenId })`)
 *   ⑤ ★ 남의 구독은 보이지도 바뀌지도 않는다 · 토큰 · 게스트는 못 만든다
 *   ⑥ ★ 상한 · 모양 · 스위치
 *   ⑦ ★ 비밀은 읽기 · 감사 어디에도 없다 · 다시 보내기의 간격 · 지우기 · 끝난 줄 지우기 · 토큰이 폐기 · 만료된 지 30일 뒤 구독 지우기(API-10)
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders } from 'node:http'

import { resolveSessionContext, type SessionContext } from '../auth/session-context.ts'
import { createPage } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import type { OutboundResult } from '../net/outbound.ts'
import { sealWebhookSecret, sealWebhookUrl } from '../net/url-seal.ts'
import { runDataRetention } from '../notification/retention.ts'
import { WEBHOOKS_SETTING_KEY } from '../notification/webhook-switch.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { removeMember } from '../workspace/member.ts'
import { createApiToken, revokeApiToken } from './api-token.ts'
import { runApiWebhookDelivery } from './webhook-deliver.ts'
import { NOMINAL_RETRY_DELAYS_MS, signWebhookBody, verifyWebhookSignature } from './webhook-format.ts'
import { emitApiWebhookEventIn } from './webhook-outbox.ts'
import {
  createApiWebhook,
  getApiWebhook,
  listApiWebhooks,
  removeApiWebhook,
  resendApiWebhookVerification,
  sendApiWebhookTest,
  setApiWebhookPaused,
  verifyApiWebhook,
  type ApiWebhookSender,
} from './webhooks.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

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
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

const HOOK = 'https://hooks.example.com/notion/abcd'
const MIN = 60_000

type Got = { url: string; json: string; headers: Readonly<Record<string, string>> }

/** 받는 쪽 흉내 — 답은 바꿔 낄 수 있다. */
function receiver(answer: () => OutboundResult = () => ({ ok: true, status: 200 })): { send: ApiWebhookSender; got: Got[]; setAnswer: (a: () => OutboundResult) => void } {
  const got: Got[] = []
  let current = answer
  return {
    got,
    setAnswer: (a) => (current = a),
    send: async (url, json, headers) => {
      got.push({ url, json, headers })
      return current()
    },
  }
}
const http500 = (): OutboundResult => ({ ok: false, reason: 'http_error', status: 500, detail: 'HTTP 500' })

async function team(name: string) {
  const ws = await createBareWorkspace(name)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  return { ws, boss, mate }
}

async function mint(who: Actor, name = '웹훅 스크립트'): Promise<string> {
  const made = await createApiToken(who.ctx, { name })
  if (!made.ok) throw new Error(`토큰을 만들지 못했다: ${made.reason}`)
  return made.value.summary.id
}

/** 확인까지 마친 구독 — 확인 토큰(서명의 비밀)과 함께. */
async function activeHook(who: Actor, tokenId: string, eventTypes: string[] = ['page.created']): Promise<{ id: string; secret: string }> {
  const r = receiver()
  const made = await createApiWebhook(who.ctx, tokenId, { url: HOOK, eventTypes }, { send: r.send })
  if (!made.ok) throw new Error(`구독을 만들지 못했다: ${made.reason}`)
  const secret = (JSON.parse(r.got[0]!.json) as { verification_token: string }).verification_token
  const verified = await verifyApiWebhook(who.ctx, tokenId, made.value.id, secret)
  if (!verified.ok) throw new Error(`확인하지 못했다: ${verified.reason}`)
  return { id: made.value.id, secret }
}

const events = (subscriptionId: string) =>
  query<{ type: string; status: string; attempts: number; skip_reason: string | null; last_http_status: number | null; entity_id: string }>(
    `SELECT type, status, attempts, skip_reason, last_http_status, entity_id FROM api_webhook_event WHERE subscription_id = $1 ORDER BY seq`,
    [subscriptionId],
  )

describe('① 만들기 · 확인 · 서명', () => {
  test('★ 받는 서버가 확인 토큰을 받는다 → 틀리면 거부 · 맞으면 켜짐 → 테스트 이벤트가 서명과 함께 간다(진짜 http)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 끝에서 끝')
    const tokenId = await mint(mate)
    const received: { path: string; headers: IncomingHttpHeaders; body: string }[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString('utf8')))
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body })
        res.writeHead(200).end('ok')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const saved = process.env.OUTBOUND_ALLOW_HOSTS
    process.env.OUTBOUND_ALLOW_HOSTS = `127.0.0.1:${port}`
    try {
      const made = await createApiWebhook(mate.ctx, tokenId, { url: `http://127.0.0.1:${port}/hook/x1`, eventTypes: ['comment.created', 'page.created'] })
      assert.ok(made.ok, JSON.stringify(made))
      assert.equal(made.value.status, 'pending_verification')
      assert.deepEqual(made.value.eventTypes, ['page.created', 'comment.created'], '카탈로그 차례')
      assert.equal(made.value.verification.httpStatus, 200)
      assert.equal(made.value.urlHint, `127.0.0.1:${port}/…k/x1`)
      assert.equal(received.length, 1)
      const verification = JSON.parse(received[0]!.body) as { verification_token: string }
      assert.match(verification.verification_token, /^secret_/)
      assert.equal(received[0]!.headers['x-notion-signature'], undefined, '확인 요청은 서명하지 않는다(노션)')
      assert.equal(received[0]!.headers['user-agent'], 'notion-clone-webhook/1', '앱의 이름만 — 사람의 정보가 없다')

      assert.deepEqual(await sendApiWebhookTest(mate.ctx, tokenId, made.value.id), { ok: false, reason: 'invalid_state' }, '확인 전에는 테스트를 넣지 않는다')
      assert.deepEqual(await verifyApiWebhook(mate.ctx, tokenId, made.value.id, 'secret_wrong'), { ok: false, reason: 'wrong_token' })
      const verified = await verifyApiWebhook(mate.ctx, tokenId, made.value.id, ` ${verification.verification_token}\n`)
      assert.ok(verified.ok && verified.value.status === 'active' && verified.value.verifiedAt !== null)
      assert.deepEqual(await verifyApiWebhook(mate.ctx, tokenId, made.value.id, verification.verification_token), { ok: false, reason: 'not_pending' })

      const now = new Date()
      const tested = await sendApiWebhookTest(mate.ctx, tokenId, made.value.id, { now })
      assert.ok(tested.ok)
      const pass = await runApiWebhookDelivery(new Date(now.getTime() + 1000), { workspaces: [ws] })
      assert.deepEqual([pass.delivered, pass.retried, pass.skipped], [1, 0, 0], JSON.stringify(pass))
      const hit = received[1]!
      assert.equal(hit.path, '/hook/x1')
      assert.equal(hit.headers['content-type'], 'application/json; charset=utf-8')
      assert.ok(verifyWebhookSignature(hit.body, hit.headers['x-notion-signature'], verification.verification_token), '★ 본문 그대로의 HMAC')
      assert.equal(hit.headers['x-notion-signature'], signWebhookBody(hit.body, verification.verification_token))
      const envelope = JSON.parse(hit.body) as Record<string, unknown>
      assert.deepEqual(
        { ...envelope, timestamp: typeof envelope.timestamp },
        {
          id: tested.value.eventId,
          timestamp: 'string',
          workspace_id: ws,
          workspace_name: '웹훅 끝에서 끝',
          subscription_id: made.value.id,
          integration_id: tokenId,
          type: 'test',
          authors: [{ id: mate.userId, type: 'person' }],
          attempt_number: 1,
          entity: { id: made.value.id, type: 'webhook_subscription' },
          data: {},
        },
      )
      assert.equal(envelope.timestamp, now.toISOString())

      const detail = await getApiWebhook(mate.ctx, tokenId, made.value.id)
      assert.ok(detail.ok)
      assert.equal(detail.value.deliveries[0]?.status, 'delivered')
      assert.equal(detail.value.deliveries[0]?.httpStatus, 200)
      assert.equal(detail.value.webhook.lastDelivery?.status, 'delivered')
    } finally {
      if (saved === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
      else process.env.OUTBOUND_ALLOW_HOSTS = saved
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  test('받는 서버가 확인 요청에 500 이면 결과를 적는다 — 구독은 확인을 기다린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('확인 실패')
    const tokenId = await mint(mate)
    const r = receiver(http500)
    const made = await createApiWebhook(mate.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }, { send: r.send })
    assert.ok(made.ok)
    assert.deepEqual(made.value.verification.httpStatus, 500)
    assert.equal(made.value.verification.error, 'http_error: HTTP 500')
    assert.equal(made.value.status, 'pending_verification')
  })
})

describe('② 다시 보내기 · 실패 · 끄기', () => {
  test('★ 500 → 백오프로 다시(시도 번호 1→8) · 여덟 번째면 failed · 셋이 잇달아 실패하면 꺼지고 남은 줄은 건너뜀 · 다시 켜면 0 부터', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 실패')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const r = receiver(http500)
    const T0 = new Date('2030-01-01T00:00:00Z')
    for (let i = 0; i < 4; i += 1) assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: new Date(T0.getTime() + i) })).ok)
    const run = (at: number) => runApiWebhookDelivery(new Date(T0.getTime() + at), { workspaces: [ws], send: r.send, random: () => 0.5 })

    const first = await run(1000)
    assert.deepEqual([first.retried, first.delivered], [1, 0], '같은 대상(구독 자신)의 뒤 줄은 앞 줄을 기다린다 — 한 판에 하나')
    assert.equal(JSON.parse(r.got[0]!.json).attempt_number, 1)
    assert.equal((await run(1000 + MIN)).retried, 0, '★ 간격(11.25분) 전에는 보내지 않는다')
    assert.equal((await run(1000 + NOMINAL_RETRY_DELAYS_MS[0]!)).retried, 1)
    assert.equal(JSON.parse(r.got[1]!.json).attempt_number, 2, '★ 시도 번호가 오른다')
    assert.equal(JSON.parse(r.got[1]!.json).id, JSON.parse(r.got[0]!.json).id, '같은 이벤트 id(받는 쪽의 멱등 키)')

    const detail = await getApiWebhook(mate.ctx, tokenId, hook.id)
    assert.ok(detail.ok)
    const head = detail.value.deliveries.at(-1)!
    assert.deepEqual([head.status, head.attempts, head.httpStatus, head.error], ['pending', 2, 500, 'http_error: HTTP 500'])
    assert.ok(head.nextAttemptAt !== null)

    // 남은 시도를 모두 — 13시간씩 앞으로(가장 긴 간격 12시간보다 길게)
    let at = 1000 + NOMINAL_RETRY_DELAYS_MS[0]!
    let disabledAt = -1
    for (let i = 0; i < 40 && disabledAt < 0; i += 1) {
      at += 13 * 60 * MIN
      const pass = await run(at)
      if (pass.disabled > 0) disabledAt = i
    }
    assert.ok(disabledAt >= 0, '세 이벤트가 끝내 실패하면 꺼진다')
    const rows = await events(hook.id)
    assert.deepEqual(
      rows.map((e) => [e.status, e.attempts, e.skip_reason]),
      [
        ['failed', 8, null],
        ['failed', 8, null],
        ['failed', 8, null],
        ['skipped', 0, 'disabled'],
      ],
    )
    const attemptNumbers = r.got.map((g) => (JSON.parse(g.json) as { attempt_number: number }).attempt_number)
    assert.deepEqual(attemptNumbers, [...[1, 2, 3, 4, 5, 6, 7, 8], ...[1, 2, 3, 4, 5, 6, 7, 8], ...[1, 2, 3, 4, 5, 6, 7, 8]])
    const sub = await queryOne<{ status: string; disabled_reason: string; consecutive_failures: number }>(
      `SELECT status, disabled_reason, consecutive_failures FROM api_webhook_subscription WHERE id = $1`,
      [hook.id],
    )
    assert.deepEqual(sub, { status: 'disabled', disabled_reason: 'failures', consecutive_failures: 3 })
    assert.deepEqual(await sendApiWebhookTest(mate.ctx, tokenId, hook.id), { ok: false, reason: 'invalid_state' })

    const resumed = await setApiWebhookPaused(mate.ctx, tokenId, hook.id, false)
    assert.ok(resumed.ok && resumed.value.status === 'active' && resumed.value.disabledReason === null)
    assert.equal((await queryOne<{ n: number }>(`SELECT consecutive_failures AS n FROM api_webhook_subscription WHERE id = $1`, [hook.id])).n, 0)
  })

  test('★ 2xx 면 잇단 실패 수가 0 으로 · 멈추면 기다리던 줄은 건너뜀 · 멈춘 구독에는 보내지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 멈춤')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    await query(`UPDATE api_webhook_subscription SET consecutive_failures = 2 WHERE id = $1`, [hook.id])
    const r = receiver()
    const T0 = new Date('2030-02-01T00:00:00Z')
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    assert.equal((await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: r.send })).delivered, 1)
    assert.equal((await queryOne<{ n: number }>(`SELECT consecutive_failures AS n FROM api_webhook_subscription WHERE id = $1`, [hook.id])).n, 0)

    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    const paused = await setApiWebhookPaused(mate.ctx, tokenId, hook.id, true)
    assert.ok(paused.ok && paused.value.status === 'paused')
    assert.deepEqual((await events(hook.id)).map((e) => [e.status, e.skip_reason]), [['delivered', null], ['skipped', 'paused']])
    assert.deepEqual(await sendApiWebhookTest(mate.ctx, tokenId, hook.id), { ok: false, reason: 'invalid_state' })
    // 멈춘 사이 끼어든 줄(경합)도 워커가 다시 보고 건너뛴다
    await query(
      `INSERT INTO api_webhook_event (id, subscription_id, workspace_id, event_id, type, entity_id, entity_type, occurred_at, status, next_attempt_at)
       VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 'test', $1, 'webhook_subscription', $3, 'pending', $3)`,
      [hook.id, ws, T0],
    )
    const pass = await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: r.send })
    assert.deepEqual([pass.delivered, pass.skipped], [0, 1])
    assert.equal(r.got.length, 1, '멈춘 뒤에는 아무것도 나가지 않았다')
    assert.deepEqual(await setApiWebhookPaused(mate.ctx, tokenId, hook.id, 'yes'), { ok: false, reason: 'invalid_state' })
  })
})

describe('③ 아웃박스 — API-9 의 길', () => {
  test('★ 고른 종류 · 켜진 구독에만 쓴다 · 대상마다 차례(앞 줄이 기다리면 뒤 줄도) · 다른 대상은 막히지 않는다 · 볼 수 없는 대상은 건너뜀', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 아웃박스')
    // 페이지는 구독보다 먼저 만든다 — 만들기가 진짜 page.created 를 낸다(API-9). 이 절은 아웃박스 쓰기를 직접 본다
    const a = await createPage(mate.ctx, { title: [textRun('가')], privateTop: true })
    const b = await createPage(mate.ctx, { title: [textRun('나')], privateTop: true })
    const secret = await createPage(boss.ctx, { title: [textRun('대표만')], privateTop: true })
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId, ['page.created', 'page.content_updated'])
    const pending = await createApiWebhook(mate.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }, { send: receiver().send })
    assert.ok(pending.ok)
    const T0 = new Date('2030-03-01T00:00:00Z')
    const emit = (type: string, entityId: string, offset: number) =>
      withTransaction((tx) =>
        emitApiWebhookEventIn(tx, { workspaceId: ws, type, entity: { id: entityId, type: 'page' }, authors: [mate.userId], occurredAt: new Date(T0.getTime() + offset) }),
      )
    assert.equal((await emit('page.created', a.id, 0)).queued, 1, '확인을 기다리는 구독에는 쓰지 않는다')
    assert.equal((await emit('page.content_updated', a.id, 1)).queued, 1)
    assert.equal((await emit('page.created', b.id, 2)).queued, 1)
    assert.equal((await emit('page.moved', b.id, 3)).queued, 0, '고르지 않은 종류')
    assert.equal((await emit('page.created', secret.id, 4)).queued, 1)
    await assert.rejects(emit('page.exploded', a.id, 5), /모르는 웹훅 이벤트/)

    // a 의 첫 줄만 실패 — a 의 둘째 줄은 기다리고 b 는 간다
    const r = receiver()
    r.setAnswer(() => {
      const last = JSON.parse(r.got.at(-1)!.json) as { entity: { id: string }; type: string }
      return last.entity.id === a.id && last.type === 'page.created' ? http500() : { ok: true, status: 204 }
    })
    const pass = await runApiWebhookDelivery(new Date(T0.getTime() + 10), { workspaces: [ws], send: r.send })
    const sent = r.got.map((g) => {
      const e = JSON.parse(g.json) as { type: string; entity: { id: string }; data: unknown; authors: unknown }
      return `${e.entity.id === a.id ? 'a' : e.entity.id === b.id ? 'b' : '?'}:${e.type}`
    })
    assert.deepEqual(sent, ['a:page.created', 'b:page.created'], '★ a 의 둘째 줄은 앞 줄을 기다린다 · 대표만의 페이지는 보내지 않는다')
    assert.deepEqual([pass.retried, pass.delivered, pass.skipped], [1, 1, 1])
    const rows = await events(hook.id)
    assert.deepEqual(
      rows.map((e) => [e.entity_id === a.id ? 'a' : e.entity_id === b.id ? 'b' : 'secret', e.type, e.status, e.skip_reason]),
      [
        ['a', 'page.created', 'pending', null],
        ['a', 'page.content_updated', 'pending', null],
        ['b', 'page.created', 'delivered', null],
        ['secret', 'page.created', 'skipped', 'entity_not_visible'],
      ],
    )
    for (const g of r.got) assert.ok(verifyWebhookSignature(g.json, g.headers['X-Notion-Signature'], hook.secret))

    // 앞 줄이 끝나면 뒤 줄이 간다(차례대로)
    r.setAnswer(() => ({ ok: true, status: 200 }))
    await runApiWebhookDelivery(new Date(T0.getTime() + 10 + NOMINAL_RETRY_DELAYS_MS[0]! * 1.2), { workspaces: [ws], send: r.send })
    assert.deepEqual(r.got.slice(2).map((g) => (JSON.parse(g.json) as { type: string }).type), ['page.created', 'page.content_updated'])

    // 멈춘 구독에는 쓰지 않는다
    assert.ok((await setApiWebhookPaused(mate.ctx, tokenId, hook.id, true)).ok)
    assert.equal((await emit('page.created', a.id, 20)).queued, 0)
  })
})

describe('④ 토큰 · 사람 — 보낼 때마다 다시 본다', () => {
  test('★ 발급자는 둘 — 행 id 로 물어도 같은 컨텍스트 · 마지막 사용은 쓰지 않는다 · 모양이 아니면 no_session', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('행 id 의 게이트')
    const made = await createApiToken(mate.ctx, { name: '토큰' })
    assert.ok(made.ok)
    const byId = await resolveSessionContext({ apiTokenId: made.value.summary.id })
    assert.ok(byId.ok)
    const ctx: SessionContext = byId.context
    assert.deepEqual([ctx.userId, ctx.workspaceId, ctx.authMethod, ctx.apiToken?.tokenId], [mate.userId, mate.ctx.workspaceId, 'api_token', made.value.summary.id])
    const used = await queryOne<{ last_used_at: Date | null }>(`SELECT last_used_at FROM api_token WHERE id = $1`, [made.value.summary.id])
    assert.equal(used.last_used_at, null, '배달은 그 사람의 사용이 아니다')
    assert.deepEqual(await resolveSessionContext({ apiTokenId: 'nope' }), { ok: false, reason: 'no_session' })
    assert.deepEqual(await resolveSessionContext({ apiTokenId: '00000000-0000-0000-0000-000000000000' }), { ok: false, reason: 'no_session' })
  })

  test('★ 토큰을 폐기하면 구독이 꺼지고(token_revoked) 기다리던 줄은 건너뛴다 — 아무것도 나가지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('폐기한 토큰')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const T0 = new Date('2030-04-01T00:00:00Z')
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    assert.ok((await revokeApiToken(mate.ctx, tokenId)).ok)
    const r = receiver()
    await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: r.send })
    assert.equal(r.got.length, 0)
    assert.deepEqual((await events(hook.id)).map((e) => [e.status, e.skip_reason]), [['skipped', 'token_revoked']])
    assert.deepEqual(
      await queryOne(`SELECT status, disabled_reason FROM api_webhook_subscription WHERE id = $1`, [hook.id]),
      { status: 'disabled', disabled_reason: 'token_revoked' },
    )
    assert.deepEqual(await listApiWebhooks(mate.ctx, tokenId), { ok: false, reason: 'not_found' }, '폐기한 토큰은 목록도 없다')
  })

  test('★ 토큰이 만료하면 보내지 않는다(token_expired) · 목록에는 "토큰 만료" · 테스트 · 만들기는 token_inactive', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('만료한 토큰')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const T0 = new Date('2030-05-01T00:00:00Z')
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    await query(`UPDATE api_token SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1`, [tokenId])
    const r = receiver()
    const pass = await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: r.send })
    assert.deepEqual([r.got.length, pass.skipped], [0, 1])
    assert.deepEqual((await events(hook.id)).map((e) => e.skip_reason), ['token_expired'])
    const listed = await listApiWebhooks(mate.ctx, tokenId)
    assert.ok(listed.ok && listed.value[0]?.tokenExpired === true && listed.value[0].status === 'active')
    assert.deepEqual(await sendApiWebhookTest(mate.ctx, tokenId, hook.id), { ok: false, reason: 'token_inactive' })
    assert.deepEqual(await createApiWebhook(mate.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }, { send: r.send }), { ok: false, reason: 'token_inactive' })
  })

  test('★ 사람이 워크스페이스에서 빠지면 보내지 않는다(access_lost) — 구독은 그대로(꺼지지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('빠진 사람')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const T0 = new Date('2030-06-01T00:00:00Z')
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    assert.ok((await removeMember(boss.ctx, mate.userId)).ok)
    const r = receiver()
    await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: r.send })
    assert.equal(r.got.length, 0)
    assert.deepEqual((await events(hook.id)).map((e) => [e.status, e.skip_reason]), [['skipped', 'access_lost']])
    assert.equal((await queryOne<{ status: string }>(`SELECT status FROM api_webhook_subscription WHERE id = $1`, [hook.id])).status, 'active')
  })
})

describe('⑤ 내 것만', () => {
  test('★ 남의 토큰 · 구독은 없는 것과 같다(not_found) · 토큰 컨텍스트 · 게스트는 forbidden', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('남의 웹훅')
    const pal = await joinAs(ws, await createUser('옆자리'), 'member')
    const tokenId = await mint(mate)
    const palToken = await mint(pal)
    const hook = await activeHook(mate, tokenId)
    const nf = { ok: false, reason: 'not_found' }
    assert.deepEqual(await listApiWebhooks(pal.ctx, tokenId), nf)
    assert.deepEqual(await getApiWebhook(pal.ctx, tokenId, hook.id), nf)
    assert.deepEqual(await getApiWebhook(pal.ctx, palToken, hook.id), nf, '내 토큰 아래로 남의 구독을 물어도')
    assert.deepEqual(await setApiWebhookPaused(pal.ctx, palToken, hook.id, true), nf)
    assert.deepEqual(await removeApiWebhook(pal.ctx, palToken, hook.id), nf)
    assert.deepEqual(await sendApiWebhookTest(pal.ctx, palToken, hook.id), nf)
    assert.deepEqual(await verifyApiWebhook(pal.ctx, tokenId, hook.id, hook.secret), nf)
    assert.deepEqual(await createApiWebhook(pal.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }, { send: receiver().send }), nf)
    assert.deepEqual(await listApiWebhooks(mate.ctx, 'not-a-uuid'), nf)

    const raw = await createApiToken(mate.ctx, { name: '값' })
    assert.ok(raw.ok)
    const asToken = await resolveSessionContext({ apiToken: raw.value.token })
    assert.ok(asToken.ok)
    assert.deepEqual(await listApiWebhooks(asToken.context, tokenId), { ok: false, reason: 'forbidden' }, '토큰이 웹훅을 다루지 못한다')
    assert.deepEqual(await createApiWebhook(asToken.context, tokenId, { url: HOOK, eventTypes: ['page.created'] }), { ok: false, reason: 'forbidden' })
    const guest = await joinAs(ws, await createUser('손님'), 'guest')
    assert.deepEqual(await createApiWebhook(guest.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }), { ok: false, reason: 'forbidden' })
    const mine = await listApiWebhooks(mate.ctx, tokenId)
    assert.ok(mine.ok && mine.value.length === 1 && mine.value[0]!.status === 'active', '내 것은 그대로')
  })
})

describe('⑥ 상한 · 모양 · 스위치', () => {
  test('★ 토큰마다 5 · 워크스페이스마다 50 · 주소 · 이벤트 · 꺼진 워크스페이스', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 상한')
    const r = receiver()
    const tokenId = await mint(mate)
    for (let i = 0; i < 5; i += 1) assert.ok((await createApiWebhook(mate.ctx, tokenId, { url: `${HOOK}/${i}`, eventTypes: ['page.created'] }, { send: r.send })).ok)
    assert.deepEqual(await createApiWebhook(mate.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }, { send: r.send }), { ok: false, reason: 'too_many' })

    // 워크스페이스 — 다른 토큰들에 44개를 더 깔아 49개로 둔 뒤
    const sealedUrl = sealWebhookUrl(HOOK)
    const sealedSecret = sealWebhookSecret('secret_x')
    for (let k = 0; k < 9; k += 1) {
      const other = await mint(mate, `상한 ${k}`)
      const n = k < 8 ? 5 : 4
      for (let i = 0; i < n; i += 1) {
        await query(
          `INSERT INTO api_webhook_subscription (id, workspace_id, api_token_id, user_id, url_sealed, url_hint, secret_sealed, event_types, status)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'hooks.example.com', $5, ARRAY['page.created'], 'pending_verification')`,
          [ws, other, mate.userId, sealedUrl, sealedSecret],
        )
      }
    }
    const bossToken = await mint(boss)
    assert.ok((await createApiWebhook(boss.ctx, bossToken, { url: HOOK, eventTypes: ['page.created'] }, { send: r.send })).ok, '50번째')
    assert.deepEqual(await createApiWebhook(boss.ctx, bossToken, { url: HOOK, eventTypes: ['page.created'] }, { send: r.send }), { ok: false, reason: 'workspace_limit' })
    assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_webhook_subscription WHERE workspace_id = $1`, [ws])).n, 50)
  })

  test('주소 · 이벤트의 모양 · 소유자가 웹훅을 끄면 만들지 못한다(멈추기 · 지우기는 된다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate } = await team('웹훅 모양')
    const r = receiver()
    const tokenId = await mint(mate)
    const make = (url: unknown, eventTypes: unknown) => createApiWebhook(mate.ctx, tokenId, { url, eventTypes }, { send: r.send })
    assert.deepEqual(await make('http://hooks.example.com/x', ['page.created']), { ok: false, reason: 'invalid_url', problem: 'not_https' })
    assert.deepEqual(await make('https://192.168.0.10/x', ['page.created']), { ok: false, reason: 'invalid_url', problem: 'private_host' })
    assert.deepEqual(await make(HOOK, []), { ok: false, reason: 'invalid_events' })
    assert.deepEqual(await make(HOOK, ['test']), { ok: false, reason: 'invalid_events' })
    assert.equal(r.got.length, 0, '거부하면 아무것도 보내지 않는다')

    const hook = await activeHook(mate, tokenId)
    assert.equal((await updateSetting(boss.ctx, WEBHOOKS_SETTING_KEY, false)).ok, true)
    assert.deepEqual(await make(HOOK, ['page.created']), { ok: false, reason: 'webhooks_disabled' })
    assert.deepEqual(await sendApiWebhookTest(mate.ctx, tokenId, hook.id), { ok: false, reason: 'webhooks_disabled' })
    assert.ok((await setApiWebhookPaused(mate.ctx, tokenId, hook.id, true)).ok)
    assert.ok((await removeApiWebhook(mate.ctx, tokenId, hook.id)).ok)
  })

  test('★ 스위치를 끄면 이미 쌓인 줄도 나가지 않는다(webhooks_disabled)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 스위치')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const T0 = new Date('2030-07-01T00:00:00Z')
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    assert.equal((await updateSetting(boss.ctx, WEBHOOKS_SETTING_KEY, false)).ok, true)
    const r = receiver()
    await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: r.send })
    assert.equal(r.got.length, 0)
    assert.deepEqual((await events(hook.id)).map((e) => e.skip_reason), ['webhooks_disabled'])
  })
})

describe('⑦ 비밀 · 다시 보내기 · 지우기', () => {
  test('★ 확인 토큰 · 원래 주소는 읽기 · 감사 어디에도 없다 · 평문 칸이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 비밀')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const listed = await listApiWebhooks(mate.ctx, tokenId)
    const detail = await getApiWebhook(mate.ctx, tokenId, hook.id)
    const shown = JSON.stringify([listed, detail])
    assert.ok(!shown.includes(hook.secret) && !shown.includes(hook.secret.slice(7, 30)), '읽기에 확인 토큰이 없다')
    assert.ok(!shown.includes('/notion/abcd'), '원래 주소가 없다(힌트만)')
    assert.ok(shown.includes('hooks.example.com/…abcd'))
    const audit = await query<{ metadata: unknown }>(`SELECT metadata FROM audit_event WHERE workspace_id = $1 AND event_type = 'account.security_changed'`, [ws])
    const changes = audit.map((a) => (a.metadata as { change: string }).change)
    assert.ok(changes.includes('api_webhook_created') && changes.includes('api_webhook_verified'), changes.join(','))
    assert.ok(!JSON.stringify(audit).includes(hook.secret.slice(7, 30)), '감사에 확인 토큰이 없다')
    const row = await queryOne<Record<string, unknown>>(`SELECT * FROM api_webhook_subscription WHERE id = $1`, [hook.id])
    for (const [column, value] of Object.entries(row)) {
      const text = Buffer.isBuffer(value) ? value.toString('latin1') : JSON.stringify(value)
      assert.ok(!text.includes(hook.secret.slice(7, 30)), `${column} 에 평문이 있다`)
      assert.ok(!text.includes('/notion/abcd'), `${column} 에 원래 주소가 있다`)
    }
  })

  test('★ 다시 보내기 — 확인을 기다릴 때만 · 10초에 한 번 · 같은 확인 토큰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('다시 보내기')
    const tokenId = await mint(mate)
    const r = receiver()
    const made = await createApiWebhook(mate.ctx, tokenId, { url: HOOK, eventTypes: ['page.created'] }, { send: r.send })
    assert.ok(made.ok)
    assert.deepEqual(await resendApiWebhookVerification(mate.ctx, tokenId, made.value.id, { send: r.send }), { ok: false, reason: 'too_soon' })
    await query(`UPDATE api_webhook_subscription SET verification_sent_at = now() - interval '11 seconds' WHERE id = $1`, [made.value.id])
    const again = await resendApiWebhookVerification(mate.ctx, tokenId, made.value.id, { send: r.send })
    assert.ok(again.ok && again.value.verification.httpStatus === 200)
    assert.equal(r.got.length, 2)
    assert.equal(r.got[1]!.json, r.got[0]!.json, '같은 확인 토큰')
    const secret = (JSON.parse(r.got[0]!.json) as { verification_token: string }).verification_token
    assert.ok((await verifyApiWebhook(mate.ctx, tokenId, made.value.id, secret)).ok)
    assert.deepEqual(await resendApiWebhookVerification(mate.ctx, tokenId, made.value.id, { send: r.send }), { ok: false, reason: 'not_pending' })
  })

  test('★ 지우면 기다리던 줄 · 기록도 사라진다 · 감사 · 끝난 줄은 7일 뒤 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 지우기')
    const tokenId = await mint(mate)
    const hook = await activeHook(mate, tokenId)
    const T0 = new Date('2030-08-01T00:00:00Z')
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    await runApiWebhookDelivery(new Date(T0.getTime() + 1), { workspaces: [ws], send: receiver().send })
    assert.ok((await sendApiWebhookTest(mate.ctx, tokenId, hook.id, { now: T0 })).ok)
    assert.deepEqual((await events(hook.id)).map((e) => e.status), ['delivered', 'pending'])

    // 끝난 줄 지우기 — 7일 전에는 그대로 · 지나면 지운다(기다리는 줄은 남는다)
    await query(`UPDATE api_webhook_event SET finished_at = now() - interval '6 days' WHERE subscription_id = $1 AND status = 'delivered'`, [hook.id])
    assert.equal((await runDataRetention(new Date(), { workspaces: [ws], partitions: false })).apiWebhookEvents, 0)
    await query(`UPDATE api_webhook_event SET finished_at = now() - interval '8 days' WHERE subscription_id = $1 AND status = 'delivered'`, [hook.id])
    assert.equal((await runDataRetention(new Date(), { workspaces: [ws], partitions: false })).apiWebhookEvents, 1)
    assert.deepEqual((await events(hook.id)).map((e) => e.status), ['pending'])

    assert.ok((await removeApiWebhook(mate.ctx, tokenId, hook.id)).ok)
    assert.equal((await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_webhook_event WHERE subscription_id = $1`, [hook.id])).n, 0)
    assert.deepEqual(await removeApiWebhook(mate.ctx, tokenId, hook.id), { ok: false, reason: 'not_found' })
    const deleted = await query(`SELECT 1 FROM audit_event WHERE workspace_id = $1 AND metadata->>'change' = 'api_webhook_deleted'`, [ws])
    assert.equal(deleted.length, 1)
  })

  test('★ 토큰이 폐기 · 만료된 지 30일이 지난 구독은 이벤트째 지운다 — 그 전 · 살아 있는 토큰의 구독은 남고 토큰 행도 남는다(API-10 · ⑭ ③)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 정리')
    const revokedId = await mint(mate, '폐기할 토큰')
    const expiringId = await mint(mate, '만료될 토큰')
    const liveId = await mint(mate, '살아 있는 토큰')
    const revokedHook = await activeHook(mate, revokedId)
    const expiringHook = await activeHook(mate, expiringId)
    const liveHook = await activeHook(mate, liveId)
    // 만료될 토큰의 구독에 기다리는 줄 하나 — 끝나지 않은 줄이라 ⑩ 이 아니라 구독째 지울 때(CASCADE)만 사라진다
    assert.ok((await sendApiWebhookTest(mate.ctx, expiringId, expiringHook.id)).ok)
    assert.ok((await revokeApiToken(mate.ctx, revokedId)).ok)
    await query(`UPDATE api_token SET expires_at = created_at + interval '1 second' WHERE id = $1`, [expiringId])
    const run = (days: number) => runDataRetention(new Date(Date.now() + days * 86_400_000), { workspaces: [ws], partitions: false })

    assert.equal((await run(29)).apiWebhookSubscriptions, 0)
    assert.deepEqual((await events(expiringHook.id)).map((e) => e.status), ['pending'])
    assert.equal((await run(31)).apiWebhookSubscriptions, 2)
    const left = await query<{ id: string }>(`SELECT id FROM api_webhook_subscription WHERE workspace_id = $1`, [ws])
    assert.deepEqual(left.map((r) => r.id), [liveHook.id])
    assert.equal((await events(expiringHook.id)).length, 0)
    assert.equal((await events(revokedHook.id)).length, 0)
    assert.equal((await query(`SELECT 1 FROM api_token WHERE id = ANY($1::uuid[])`, [[revokedId, expiringId]])).length, 2)
  })
})
