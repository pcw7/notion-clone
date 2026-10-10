/**
 * 웹훅 보내기 — 모으기 · 권한 범위 · 워커 · 실패 (히스토리 · 활동 4e-2 · F-11-19, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.8 [보강] 페이지 웹훅 ⑤ ~ ⑧ · 보내기 ⓐ ~ ⓖ).
 *
 *   ⓐ 그 페이지 · 아래 페이지의 활동이 웹훅마다 한 묶음에 모인다 · 아래에 따로 건 웹훅이 있으면 그것만 · 멈춘 웹훅 · 목록 밖의 종류는 모이지 않는다
 *   ⓑ 권한 범위가 다른 아래 페이지의 활동은 위의 웹훅으로 가지 않는다
 *   ⓒ 창이 끝나야 보낸다 · 한 번만 · 보내는 동안의 이벤트는 새 묶음으로 · 임대 중인 것은 다시 잡지 않는다
 *   ⓓ 걸린 페이지가 휴지통이거나 웹훅이 멈췄으면 보내지 않고 버린다
 *   ⓔ 실패 — 1 · 2 · 4분 뒤 다시 · 네 번째도 실패면 끝내고 웹훅을 멈춘다 · 멈춘 동안의 활동은 모이지 않는다
 *   ⓕ 진짜로 보낸다 — 봉인을 풀어 바깥 요청의 길로
 *   ⓖ 끝난 묶음은 7일 뒤 지운다
 *
 * 반사실(HANDOFF §3.3): 범위를 보지 않으면 ⓑ, 가장 가까운 것을 고르지 않으면 ⓐ, 잡을 때 collecting 을 떠나지 않으면 ⓒ, 다시 보기를
 * 빼면 ⓓ, 실패 상한을 빼면 ⓔ 가 실패한다.
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { asBlockId, type BlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import type { OutboundResult } from '../net/outbound.ts'
import { recordActivity, type ActivityType } from './activity.ts'
import { addPageWebhook, setPageWebhookPaused } from './page-webhook.ts'
import { runDataRetention } from './retention.ts'
import { runWebhookDelivery, type Sender } from './webhook-delivery.ts'
import type { WebhookPayload } from './webhook-payload.ts'

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
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const minutes = (n: number) => new Date(Date.now() + n * 60_000)
const page = async (title: string, parent: string | null = null) =>
  (await createPage(fx.owner.ctx, { parentPageId: parent === null ? null : asBlockId(parent), title: titleFromPlainText(title) })).id
const record = (pageId: string, type: ActivityType = 'block.updated') =>
  withTransaction((tx) => recordActivity(tx, fx.owner.ctx, { pageId, type }))
/** 웹훅을 건다 — URL 은 웹훅마다 다르다(받는 쪽 흉내가 URL 로 가른다). `/fail` 이 들어가면 늘 실패한다. */
async function hookOn(pageId: string, kind: 'ok' | 'fail' = 'ok'): Promise<{ id: string; url: string }> {
  const url = `https://hooks.example.com/${kind}/${randomUUID()}`
  const added = await addPageWebhook(fx.owner.ctx, pageId, url)
  assert.ok(added.ok, JSON.stringify(added))
  return { id: added.value.id, url }
}
type Delivery = { id: string; status: string; event_ids: string[]; attempts: number; next_attempt_at: Date | null; last_error: string | null; window_end: Date }
const deliveriesOf = (webhookId: string) =>
  query<Delivery>(
    `SELECT id, status, event_ids, attempts, next_attempt_at, last_error, window_end FROM webhook_delivery WHERE webhook_id = $1 ORDER BY created_at, id`,
    [webhookId],
  )
const collectingOf = async (webhookId: string) => (await deliveriesOf(webhookId)).find((d) => d.status === 'collecting')?.event_ids ?? []

/** 받는 쪽 흉내 — URL 에 `/fail` 이 있으면 500. 보낸 것을 모은다. `during` 은 보내는 동안 할 일. */
function receiver(during?: () => Promise<void>): { send: Sender; calls: { url: string; payload: WebhookPayload }[] } {
  const calls: { url: string; payload: WebhookPayload }[] = []
  return {
    calls,
    send: async (url, payload): Promise<OutboundResult> => {
      calls.push({ url, payload })
      if (during !== undefined) await during()
      return url.includes('/fail/') ? { ok: false, reason: 'http_error', status: 500, detail: 'HTTP 500' } : { ok: true, status: 200 }
    },
  }
}
const run = (now: Date, send: Sender) => runWebhookDelivery(now, { workspaces: [fx.workspaceId], send })

describe('ⓐ 모으기', () => {
  test('★ 그 페이지와 아래 페이지의 활동이 한 묶음에 — 창은 지금부터 5분', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('위')
    const hook = await hookOn(top)
    const e1 = await record(top)
    const child = await page('아래', top) // page.created 가 그 아래에서 난다
    const e3 = await record(child)
    const [d] = await deliveriesOf(hook.id)
    assert.equal(d.status, 'collecting')
    assert.equal(d.event_ids.length, 3)
    assert.equal(d.event_ids[0], e1.id)
    assert.equal(d.event_ids[2], e3.id)
    const span = d.window_end.getTime() - Date.now()
    assert.ok(span > 4 * 60_000 && span <= 5 * 60_000 + 5_000, `창: ${span}`)
  })

  test('★ 아래에 따로 건 웹훅이 있으면 가장 가까운 것만 — 그 웹훅이 멈췄어도 위로 가지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('맨 위')
    const middle = await page('가운데', top)
    const leaf = await page('맨 아래', middle)
    const upper = await hookOn(top)
    const lower = await hookOn(middle)
    const event = await record(leaf)
    assert.ok((await collectingOf(lower.id)).includes(event.id))
    assert.ok(!(await collectingOf(upper.id)).includes(event.id), '위의 웹훅으로는 가지 않는다')

    assert.equal((await setPageWebhookPaused(fx.owner.ctx, middle, lower.id, true)).ok, true)
    const later = await record(leaf)
    assert.ok(!(await collectingOf(upper.id)).includes(later.id), '가장 가까운 웹훅이 멈췄어도 위로 올라가지 않는다')
    assert.ok(!(await collectingOf(lower.id)).includes(later.id), '멈춘 웹훅은 모으지 않는다')
  })

  test('목록 밖의 종류는 모이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('멘션')
    const hook = await hookOn(target)
    await record(target, 'user.mentioned')
    await record(target, 'access.requested')
    assert.deepEqual(await deliveriesOf(hook.id), [])
  })
})

describe('ⓑ 권한 범위', () => {
  test('★ 권한을 따로 정한 아래 페이지의 활동은 위의 웹훅으로 가지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('모두가 보는 위')
    const hook = await hookOn(top)
    const secret = await page('나만 보는 아래', top)
    assert.equal((await stopInheriting(fx.owner.ctx, secret)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, secret, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    await revokeAccess(fx.owner.ctx, secret, { type: 'workspace_everyone' })
    const inside = await page('그 아래', secret)
    const hidden = [await record(secret), await record(inside)]
    const collected = await collectingOf(hook.id)
    for (const e of hidden) assert.ok(!collected.includes(e.id), '범위가 다른 페이지 · 그 아래')
  })
})

describe('ⓒ 보내기', () => {
  test('★ 창이 끝나야 보낸다 · 본문 · 한 번만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('보낼 글')
    const hook = await hookOn(target)
    const event = await record(target)
    const early = receiver()
    await run(minutes(1), early.send)
    assert.equal(early.calls.filter((c) => c.url === hook.url).length, 0, '창이 끝나기 전에는 보내지 않는다')

    const due = receiver()
    await run(minutes(6), due.send)
    const mine = due.calls.filter((c) => c.url === hook.url)
    assert.equal(mine.length, 1)
    const [d] = await deliveriesOf(hook.id)
    assert.deepEqual([d.status, d.attempts], ['sent', 1])
    const payload = mine[0].payload
    assert.equal(payload.notion_clone.delivery_id, d.id, '배달 id 가 멱등 키다')
    assert.deepEqual(payload.notion_clone.events.map((e) => e.id), [event.id])
    assert.ok(payload.text.includes('‘보낼 글’') && payload.text.includes('편집 1'), payload.text)

    const again = receiver()
    await run(minutes(7), again.send)
    assert.equal(again.calls.filter((c) => c.url === hook.url).length, 0, '한 번만')
  })

  test('★ 보내는 동안의 이벤트는 새 묶음으로 간다 — 본문에 끼지 않고 사라지지도 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('바쁜 글')
    const hook = await hookOn(target)
    const first = await record(target)
    let during = ''
    const r = receiver(async () => {
      if (during === '') during = (await record(target)).id
    })
    await run(minutes(6), r.send)
    const sent = r.calls.find((c) => c.url === hook.url)
    assert.ok(sent)
    assert.deepEqual(sent.payload.notion_clone.events.map((e) => e.id), [first.id])
    assert.deepEqual(await collectingOf(hook.id), [during], '새 묶음에 있다')
  })

  test('임대 중인 묶음은 다시 잡지 않는다 — 임대가 지나면 잡는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('임대')
    const hook = await hookOn(target)
    await record(target)
    await query(
      `UPDATE webhook_delivery SET status = 'pending', next_attempt_at = now() - interval '1 minute', locked_until = $2 WHERE webhook_id = $1`,
      [hook.id, minutes(30)],
    )
    const held = receiver()
    await run(minutes(6), held.send)
    assert.equal(held.calls.filter((c) => c.url === hook.url).length, 0)
    const expired = receiver()
    await run(minutes(31), expired.send)
    assert.equal(expired.calls.filter((c) => c.url === hook.url).length, 1)
  })
})

describe('ⓓ 다시 보기', () => {
  test('★ 걸린 페이지가 휴지통이거나 웹훅이 멈췄으면 보내지 않고 버린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const gone = await page('버릴 글')
    const goneHook = await hookOn(gone)
    await record(gone)
    await trashPage(fx.owner.ctx, asBlockId(gone) as BlockId)

    const quiet = await page('멈출 글')
    const quietHook = await hookOn(quiet)
    await record(quiet)
    assert.equal((await setPageWebhookPaused(fx.owner.ctx, quiet, quietHook.id, true)).ok, true)

    const r = receiver()
    await run(minutes(6), r.send)
    assert.equal(r.calls.filter((c) => c.url === goneHook.url || c.url === quietHook.url).length, 0)
    assert.deepEqual((await deliveriesOf(goneHook.id)).map((d) => [d.status, d.last_error]), [['dropped', 'page_not_live']])
    assert.deepEqual((await deliveriesOf(quietHook.id)).map((d) => [d.status, d.last_error]), [['dropped', 'paused']])
  })
})

describe('ⓔ 실패', () => {
  test('★ 1 · 2 · 4분 뒤 다시 — 네 번째도 실패면 끝내고 웹훅을 멈춘다 · 그 뒤의 활동은 모이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('닿지 않는 곳')
    const hook = await hookOn(target, 'fail')
    await record(target)
    const T0 = minutes(6)
    const at = (m: number) => new Date(T0.getTime() + m * 60_000)
    const r = receiver()
    const state = async () => {
      const [d] = await deliveriesOf(hook.id)
      return [d.status, d.attempts, d.next_attempt_at === null ? null : Math.round((d.next_attempt_at.getTime() - T0.getTime()) / 60_000)]
    }
    await run(T0, r.send)
    assert.deepEqual(await state(), ['pending', 1, 1])
    await run(at(0.5), r.send)
    assert.deepEqual(await state(), ['pending', 1, 1], '때가 되기 전에는 다시 보내지 않는다')
    await run(at(1), r.send)
    assert.deepEqual(await state(), ['pending', 2, 3])
    await run(at(3), r.send)
    assert.deepEqual(await state(), ['pending', 3, 7])
    await run(at(7), r.send)
    assert.deepEqual(await state(), ['failed', 4, null])
    assert.equal(r.calls.filter((c) => c.url === hook.url).length, 4)
    const [w] = await query<{ pause_reason: string | null }>(`SELECT pause_reason FROM page_webhook WHERE id = $1`, [hook.id])
    assert.equal(w.pause_reason, 'failures')

    await record(target)
    assert.equal((await deliveriesOf(hook.id)).length, 1, '멈춘 동안의 활동은 모이지 않는다')
    assert.equal((await setPageWebhookPaused(fx.owner.ctx, target, hook.id, false)).ok, true)
    await record(target)
    assert.equal((await collectingOf(hook.id)).length, 1, '다시 켜면 모인다')
  })
})

describe('ⓕ 진짜로 보낸다', () => {
  test('★ 봉인을 풀어 바깥 요청의 길로 — 받는 서버가 JSON 을 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const got: { type: string | undefined; body: string }[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        got.push({ type: req.headers['content-type'], body })
        res.writeHead(200).end('ok')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const saved = process.env.OUTBOUND_ALLOW_HOSTS
    process.env.OUTBOUND_ALLOW_HOSTS = `127.0.0.1:${port}`
    try {
      const target = await page('진짜로')
      const added = await addPageWebhook(fx.owner.ctx, target, `http://127.0.0.1:${port}/hook`)
      assert.ok(added.ok, JSON.stringify(added))
      const event = await record(target)
      const outcome = await runWebhookDelivery(minutes(6), { workspaces: [fx.workspaceId] })
      assert.ok(outcome.sent >= 1, JSON.stringify(outcome))
      const mine = got.map((g) => JSON.parse(g.body) as WebhookPayload).find((p) => p.notion_clone.events.some((e) => e.id === event.id))
      assert.ok(mine, '받는 서버에 닿았다')
      assert.ok(mine.text.includes('‘진짜로’'))
      assert.deepEqual((await deliveriesOf(added.value.id)).map((d) => d.status), ['sent'])
    } finally {
      if (saved === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
      else process.env.OUTBOUND_ALLOW_HOSTS = saved
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

describe('ⓖ 끝난 묶음의 수명', () => {
  test('★ 끝난 지 7일이 지나면 지운다 — 모으는 것 · 최근 것은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('오래된 배달')
    const hook = await hookOn(target)
    await record(target)
    const [collecting] = await deliveriesOf(hook.id)
    const put = async (daysAgo: number) => {
      const id = randomUUID()
      await query(
        `INSERT INTO webhook_delivery (id, webhook_id, event_ids, window_end, status, finished_at)
         VALUES ($1, $2, $3::uuid[], now(), 'sent', now() - make_interval(days => $4))`,
        [id, hook.id, collecting.event_ids, daysAgo],
      )
      return id
    }
    const old = await put(8)
    const recent = await put(6)
    await runDataRetention(new Date(), { workspaces: [fx.workspaceId], partitions: false })
    const left = (await deliveriesOf(hook.id)).map((d) => d.id)
    assert.ok(!left.includes(old))
    assert.ok(left.includes(recent) && left.includes(collecting.id))
  })
})
