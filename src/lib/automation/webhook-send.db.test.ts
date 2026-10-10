/**
 * send_webhook — 보내기 (자동화 5c-2 · F-08-13, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑬).
 *
 *   ① 보낸다 — 봉인을 풀어(URL · 헤더) 쌓을 때의 몸 그대로 · 성공이면 sent
 *   ② 실패 — 1 · 2 · 4분 뒤 다시 · 네 번째도 실패면 failed 로 끝내고 automation 을 멈춘다(webhook_failed) · 버튼은 꺼진다 · 멈춘 automation 의
 *      남은 배달은 보내지 않고 버린다(paused)
 *   ③ 임대 — 잡혀 있는 배달은 다른 판이 보내지 않는다 · 임대가 지나면 다시 보낸다
 *   ④ 진짜로 — 바깥 요청의 길로 받는 서버가 JSON 과 헤더를 받는다
 *   ⑤ 끝난 배달은 7일 뒤 지운다(보낼 차례인 것은 남는다)
 *
 * 반사실(HANDOFF §3.3): 실패 상한을 빼면 ②, 꺼진 automation 을 보지 않으면 ②, 임대를 보지 않으면 ③, 헤더를 싣지 않으면 ① ④, 보관을
 * 빼면 ⑤ 가 실패한다.
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import type { OutboundResult } from '../net/outbound.ts'
import { runDataRetention } from '../notification/retention.ts'
import { pressButton, setButtonActions } from './button-property.ts'
import { runAutomationWebhooks, type WebhookSender } from './webhook-send.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  assert.equal((await setWorkspacePlan(fx.workspaceId, 'plus')).ok, true)
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${JSON.stringify(r)}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const URL_A = 'https://hooks.example.com/services/T0/B0/secret-a'
const MIN = 60_000

type Button = { ds: string; qty: string; button: string; row: string; automationId: string }

/** 표 하나 · 수량 7 인 행 · 그 행의 수량을 보내는 버튼. */
async function button(name: string, url = URL_A): Promise<Button> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const buttonId = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '보내기', type: 'button' })).properties, '보내기')
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: qty, value: { type: 'number', number: 7 } }] }))
  const saved = unwrap(await setButtonActions(fx.owner.ctx, ds, buttonId, [
    { type: 'send_webhook', config: { v: 1, url, headers: [{ name: 'X-Token', value: 'tok-1' }], properties: [qty] } },
  ]))
  return { ds, qty, button: buttonId, row, automationId: saved.automationId }
}

const press = async (b: Button) => unwrap(await pressButton(fx.owner.ctx, b.row, b.button, randomUUID()))
const deliveriesOf = (automationId: string) =>
  query<{ id: string; status: string; attempts: number; next_attempt_at: Date | null; last_error: string | null; finished_at: Date | null }>(
    `SELECT id, status, attempts, next_attempt_at, last_error, finished_at FROM automation_delivery WHERE automation_id = $1 ORDER BY created_at, id`,
    [automationId],
  )
const automationOf = async (id: string) =>
  (await query<{ enabled: boolean; disabled_reason: string | null }>(`SELECT enabled, disabled_reason FROM automation WHERE id = $1`, [id]))[0]

type Got = { url: string; payload: Record<string, unknown>; headers: Readonly<Record<string, string>> }
/** 받는 쪽 흉내 — 받은 것을 모으고 정한 답을 준다. */
function sender(answer: () => OutboundResult): { readonly send: WebhookSender; readonly got: Got[] } {
  const got: Got[] = []
  return {
    got,
    send: async (url, payload, headers) => {
      got.push({ url, payload: payload as Record<string, unknown>, headers })
      return answer()
    },
  }
}
const OK: OutboundResult = { ok: true, status: 200 }
const FAIL: OutboundResult = { ok: false, reason: 'status', status: 500, detail: '500' }
const pass = (at: number, send: WebhookSender, batch?: number) =>
  runAutomationWebhooks(new Date(at), { workspaces: [fx.workspaceId], send, ...(batch === undefined ? {} : { batch }) })

describe('① 보낸다', () => {
  test('★ 봉인을 풀어 — URL · 헤더 · 쌓을 때의 몸 그대로 · 성공이면 sent', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await button('보내는 표')
    const run = await press(b)
    const { send, got } = sender(() => OK)
    const outcome = await pass(Date.now() + 1000, send)
    assert.equal(outcome.sent, 1)
    assert.equal(got.length, 1)
    assert.equal(got[0].url, URL_A)
    assert.deepEqual(got[0].headers, { 'x-token': 'tok-1' })
    assert.equal(got[0].payload.run_id, run.runId)
    assert.deepEqual(got[0].payload.properties, { 수량: { type: 'number', number: 7 } })
    const [d] = await deliveriesOf(b.automationId)
    assert.equal(d.status, 'sent')
    assert.equal(d.attempts, 1)
    assert.ok(d.finished_at !== null)
    assert.equal((await pass(Date.now() + 2000, send)).sent, 0, '한 번만')
  })
})

describe('② 실패', () => {
  test('★ 1 · 2 · 4분 뒤 다시 — 네 번째도 실패면 끝내고 automation 을 멈춘다 · 남은 배달은 버린다 · 버튼은 꺼진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await button('실패 표')
    await press(b)
    await press(b)
    const { send, got } = sender(() => FAIL)
    const t0 = Date.now() + 1000
    assert.equal((await pass(t0, send)).retried, 2)
    let ds = await deliveriesOf(b.automationId)
    assert.deepEqual(ds.map((d) => [d.status, d.attempts]), [['pending', 1], ['pending', 1]])
    assert.ok(Math.abs(ds[0].next_attempt_at!.getTime() - (t0 + MIN)) < 1000, '1분 뒤')
    assert.equal((await pass(t0 + 30_000, send)).retried, 0, '때가 되기 전에는 다시 보내지 않는다')
    await pass(t0 + MIN, send) // 두 번째 — 2분 뒤로
    await pass(t0 + 3 * MIN, send) // 세 번째 — 4분 뒤로
    ds = await deliveriesOf(b.automationId)
    assert.deepEqual(ds.map((d) => [d.status, d.attempts]), [['pending', 3], ['pending', 3]])
    // 네 번째 — 하나만 잡는다(한 판 1개): 실패로 끝나고 automation 이 멈춘다
    const fourth = await pass(t0 + 7 * MIN, send, 1)
    assert.equal(fourth.failed, 1)
    assert.deepEqual(await automationOf(b.automationId), { enabled: false, disabled_reason: 'webhook_failed' })
    // 남은 하나는 보내지 않고 버린다
    const sentBefore = got.length
    const after = await pass(t0 + 7 * MIN, send)
    assert.equal(after.dropped, 1)
    assert.equal(got.length, sentBefore, '멈춘 automation 의 배달은 나가지 않는다')
    ds = await deliveriesOf(b.automationId)
    assert.deepEqual(ds.map((d) => d.status).sort(), ['dropped', 'failed'])
    assert.equal(ds.find((d) => d.status === 'dropped')?.last_error, 'paused')
    assert.deepEqual(await pressButton(fx.owner.ctx, b.row, b.button, randomUUID()), { ok: false, reason: 'disabled' }, '버튼이 꺼졌다')
  })
})

describe('③ 임대', () => {
  test('★ 잡혀 있는 배달은 다른 판이 보내지 않는다 — 임대가 지나면 다시 보낸다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await button('임대 표')
    await press(b)
    const t0 = Date.now() + 1000
    await query(`UPDATE automation_delivery SET locked_until = $2 WHERE automation_id = $1`, [b.automationId, new Date(t0 + MIN)])
    const { send, got } = sender(() => OK)
    assert.equal((await pass(t0, send)).sent, 0, '다른 워커가 잡고 있다')
    assert.equal(got.length, 0)
    assert.equal((await pass(t0 + 2 * MIN, send)).sent, 1, '임대가 지나면(죽은 워커) 다시 보낸다')
  })
})

describe('④ 진짜로', () => {
  test('★ 바깥 요청의 길로 — 받는 서버가 JSON 과 헤더를 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const received: { headers: IncomingHttpHeaders; body: string }[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ headers: req.headers, body })
        res.writeHead(200).end('ok')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const saved = process.env.OUTBOUND_ALLOW_HOSTS
    process.env.OUTBOUND_ALLOW_HOSTS = `127.0.0.1:${port}`
    try {
      const b = await button('진짜 표', `http://127.0.0.1:${port}/hook`)
      const run = await press(b)
      const outcome = await runAutomationWebhooks(new Date(Date.now() + 1000), { workspaces: [fx.workspaceId] })
      assert.equal(outcome.sent, 1, JSON.stringify(outcome))
      const mine = received.find((r) => (JSON.parse(r.body) as { run_id?: string }).run_id === run.runId)
      assert.ok(mine, '받는 서버에 닿았다')
      assert.equal(mine.headers['x-token'], 'tok-1')
      assert.match(String(mine.headers['content-type']), /application\/json/)
      assert.deepEqual((JSON.parse(mine.body) as { properties: unknown }).properties, { 수량: { type: 'number', number: 7 } })
    } finally {
      if (saved === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
      else process.env.OUTBOUND_ALLOW_HOSTS = saved
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

describe('⑤ 보관', () => {
  test('★ 끝난 배달은 7일 뒤 지운다 — 보낼 차례인 것은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await button('보관 표')
    await press(b)
    await pass(Date.now() + 1000, sender(() => OK).send)
    await press(b) // 보낼 차례로 남는다
    const kept = await runDataRetention(new Date(Date.now() + 6 * 86_400_000), { workspaces: [fx.workspaceId], partitions: false })
    assert.equal(kept.automationDeliveries, 0, '7일이 안 됐다')
    const purged = await runDataRetention(new Date(Date.now() + 8 * 86_400_000), { workspaces: [fx.workspaceId], partitions: false })
    assert.ok(purged.automationDeliveries >= 1)
    assert.deepEqual((await deliveriesOf(b.automationId)).map((d) => d.status), ['pending'])
  })
})
