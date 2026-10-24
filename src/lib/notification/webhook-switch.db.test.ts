/**
 * 워크스페이스의 웹훅 스위치 (§7 정리 10n-70 · F-08-13 · F-11-19 · DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.8 [보강] 페이지 웹훅 ⑩ · DB automation ⑫ ⑬ · HANDOFF §3.2-303).
 *
 *   ① 설정 — 기본은 켜짐 · 소유자가 끄고 켠다 · 판정(`webhooksAllowedIn`)이 그 값을 곧바로 읽는다
 *   ② 페이지 웹훅 — 꺼지면 걸 수 없다(`webhooks_disabled`) · 멈추기 · 지우기는 된다
 *   ③ 페이지 웹훅 — 꺼진 동안의 활동은 쌓이지 않는다 · 끄기 전에 쌓인 것은 보낼 때 버린다 · 다시 켜면 그 뒤의 활동부터
 *   ④ 자동화 — 꺼지면 `send_webhook` 이 든 액션을 저장할 수 없다 · 누르면 쌓지 않고 건너뛴다 · 끄기 전에 쌓인 배달은 보낼 때 버린다
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createUser, joinAs, probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow } from '../database/row.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import type { OutboundResult } from '../net/outbound.ts'
import { readSettings, updateSetting } from '../settings/settings.ts'
import { pressButton, setButtonActions } from '../automation/button-property.ts'
import { runAutomationWebhooks } from '../automation/webhook-send.ts'
import { recordActivity } from './activity.ts'
import { addPageWebhook, removePageWebhook, setPageWebhookPaused } from './page-webhook.ts'
import { runWebhookDelivery } from './webhook-delivery.ts'
import { webhooksAllowedIn, WEBHOOKS_SETTING_KEY } from './webhook-switch.ts'

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
  assert.equal((await setWorkspacePlan(fx.workspaceId, 'plus')).ok, true, '자동화 웹훅은 유료 요금제')
})

after(async () => {
  if (!skipReason) {
    // 다음 검사가 같은 워크스페이스를 쓰지 않지만 — 켜 두고 끝낸다
    await updateSetting(fx.owner.ctx, WEBHOOKS_SETTING_KEY, true)
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${JSON.stringify(r)}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}
const turn = async (on: boolean) => assert.equal((await updateSetting(fx.owner.ctx, WEBHOOKS_SETTING_KEY, on)).ok, true)
const allowed = () => webhooksAllowedIn({ query }, fx.workspaceId)
const page = async (title: string) => (await createPage(fx.owner.ctx, { parentPageId: null, title: titleFromPlainText(title) })).id
const record = (pageId: string) => withTransaction((tx) => recordActivity(tx, fx.owner.ctx, { pageId, type: 'block.updated' }))
const hookDeliveries = (webhookId: string) =>
  query<{ status: string; last_error: string | null; event_ids: string[] }>(
    `SELECT status, last_error, event_ids FROM webhook_delivery WHERE webhook_id = $1 ORDER BY created_at, id`,
    [webhookId],
  )
const OK: OutboundResult = { ok: true, status: 200 }

describe('① 설정', () => {
  test('★ 기본은 켜짐 · 소유자가 끄고 켜면 판정이 곧바로 따른다 · 멤버는 고칠 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const shown = async () => (await readSettings(fx.owner.ctx)).find((i) => i.key === WEBHOOKS_SETTING_KEY)?.value
    assert.equal(await allowed(), true, '행이 없으면 켜짐')
    assert.equal(await shown(), true, '설정 화면도 켜짐으로 그린다 — 판정과 기본값이 같다')
    await turn(false)
    assert.equal(await allowed(), false)
    assert.equal(await shown(), false)
    await turn(true)
    assert.equal(await allowed(), true)
    const member = await joinAs(fx.workspaceId, await createUser('멤버'), 'member')
    const byMember = await updateSetting(member.ctx, WEBHOOKS_SETTING_KEY, false)
    assert.equal(byMember.ok, false, '멤버가 껐다')
    assert.equal(await allowed(), true)
  })
})

describe('② 페이지 웹훅 걸기', () => {
  test('★ 꺼지면 걸 수 없다(webhooks_disabled) — 이미 건 것은 멈추고 · 다시 켜고 · 지울 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('걸기')
    const hook = unwrap(await addPageWebhook(fx.owner.ctx, top, `https://hooks.example.com/ok/${randomUUID()}`))
    await turn(false)
    try {
      const refused = await addPageWebhook(fx.owner.ctx, top, `https://hooks.example.com/ok/${randomUUID()}`)
      assert.deepEqual(refused, { ok: false, reason: 'webhooks_disabled' })
      unwrap(await setPageWebhookPaused(fx.owner.ctx, top, hook.id, true))
      unwrap(await setPageWebhookPaused(fx.owner.ctx, top, hook.id, false))
      unwrap(await removePageWebhook(fx.owner.ctx, top, hook.id))
    } finally {
      await turn(true)
    }
    unwrap(await addPageWebhook(fx.owner.ctx, top, `https://hooks.example.com/ok/${randomUUID()}`))
  })
})

describe('③ 페이지 웹훅 보내기', () => {
  test('★ 꺼진 동안의 활동은 쌓이지 않는다 · 다시 켜면 그 뒤의 활동부터', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('쌓기')
    const hook = unwrap(await addPageWebhook(fx.owner.ctx, top, `https://hooks.example.com/ok/${randomUUID()}`))
    await turn(false)
    try {
      await record(top)
      assert.deepEqual(await hookDeliveries(hook.id), [], '꺼진 동안 쌓였다')
    } finally {
      await turn(true)
    }
    const after = await record(top)
    const [d] = await hookDeliveries(hook.id)
    assert.deepEqual([d?.status, d?.event_ids], ['collecting', [after.id]], '켠 뒤의 활동만')
  })

  test('★ 끄기 전에 쌓인 묶음은 보낼 때 버린다(webhooks_disabled) — 받는 쪽에 아무것도 가지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('버리기')
    const hook = unwrap(await addPageWebhook(fx.owner.ctx, top, `https://hooks.example.com/ok/${randomUUID()}`))
    await record(top)
    const calls: string[] = []
    await turn(false)
    try {
      const outcome = await runWebhookDelivery(new Date(Date.now() + 6 * 60_000), {
        workspaces: [fx.workspaceId],
        send: async (url) => {
          calls.push(url)
          return OK
        },
      })
      assert.ok(outcome.dropped >= 1, JSON.stringify(outcome)) // 앞 검사가 켠 뒤에 쌓은 묶음도 함께 버린다
    } finally {
      await turn(true)
    }
    assert.deepEqual(calls, [], '꺼졌는데 보냈다')
    const [d] = await hookDeliveries(hook.id)
    assert.deepEqual([d.status, d.last_error], ['dropped', 'webhooks_disabled'])
  })
})

describe('④ 자동화의 send_webhook', () => {
  /** 표 하나 · 행 하나 · 그 행을 보내는 버튼(켜져 있을 때 저장). */
  async function button(name: string) {
    const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
    const ds = db.dataSourceId
    const props = unwrap(await addProperty(fx.owner.ctx, ds, { name: '보내기', type: 'button' })).properties
    const buttonId = props.find((p) => p.name === '보내기')!.id
    const row = unwrap(await createRow(fx.owner.ctx, ds)).id
    const saved = unwrap(await setButtonActions(fx.owner.ctx, ds, buttonId, [
      { type: 'send_webhook', config: { v: 1, url: `https://hooks.example.com/ok/${randomUUID()}`, headers: [], properties: [] } },
    ]))
    return { ds, buttonId, row, automationId: saved.automationId }
  }
  const automationDeliveries = (automationId: string) =>
    query<{ status: string; last_error: string | null }>(`SELECT status, last_error FROM automation_delivery WHERE automation_id = $1 ORDER BY created_at, id`, [automationId])

  test('★ 꺼지면 저장할 수 없다(webhooks_disabled) · 누르면 쌓지 않고 건너뛴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await button('저장 · 누르기')
    await turn(false)
    try {
      const refused = await setButtonActions(fx.owner.ctx, b.ds, b.buttonId, [
        { type: 'send_webhook', config: { v: 1, url: `https://hooks.example.com/ok/${randomUUID()}`, headers: [], properties: [] } },
      ])
      assert.equal(refused.ok, false)
      assert.equal((refused as { problem?: string }).problem, 'webhooks_disabled', JSON.stringify(refused))
      const run = unwrap(await pressButton(fx.owner.ctx, b.row, b.buttonId, randomUUID()))
      assert.deepEqual(run.steps.map((s) => [s.status, (s as { reason?: string }).reason]), [['skipped', 'webhooks_disabled']])
      assert.deepEqual(await automationDeliveries(b.automationId), [], '꺼졌는데 쌓였다')
    } finally {
      await turn(true)
    }
  })

  test('★ 끄기 전에 쌓인 배달은 보낼 때 버린다(webhooks_disabled)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await button('버리기 표')
    unwrap(await pressButton(fx.owner.ctx, b.row, b.buttonId, randomUUID()))
    const calls: string[] = []
    await turn(false)
    try {
      const outcome = await runAutomationWebhooks(new Date(Date.now() + 1000), {
        workspaces: [fx.workspaceId],
        send: async (url) => {
          calls.push(url)
          return OK
        },
      })
      assert.equal(outcome.dropped, 1)
    } finally {
      await turn(true)
    }
    assert.deepEqual(calls, [], '꺼졌는데 보냈다')
    assert.deepEqual(await automationDeliveries(b.automationId), [{ status: 'dropped', last_error: 'webhooks_disabled' }])
  })
})
