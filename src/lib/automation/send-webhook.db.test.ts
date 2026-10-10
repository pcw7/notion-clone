/**
 * send_webhook — 정의 · 쌓기 (자동화 5c-1 · F-08-13, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑫).
 *
 *   ① 봉인 — URL · 헤더 값은 평문으로 저장되지 않고 화면 · API 에 돌아오지 않는다(힌트 · 헤더 이름 · ref 만)
 *   ② 옮기기 — 고칠 때 URL 없이 keep 으로 · 헤더 값을 비우면 같은 이름의 값을 옮긴다 · 다른 automation 의 ref · 없는 이름은 unknown_ref
 *   ③ 검사 — 보낼 속성은 그 표의 셀 속성(버튼 · 없는 속성은 unknown_property) · 요금제(Free 는 plan_required)
 *   ④ 쌓기 — 누르면 배달 한 줄(pending · 그때의 값 · 속성 이름으로 · 선택지는 옵션 이름까지 · run_id · 그때의 봉인) · 단계는 done + deliveryId ·
 *      실행이 되돌려지면 배달도 없다
 *   ⑤ 실행 때 다시 — 요금제를 내리면 건너뛴다(plan · partial) · DB automation 도 같은 길
 *   ⑥ 실행하는 사람의 권한으로 — 그 행을 볼 수 없으면 값을 싣지 않는다(건너뛴다)
 *
 * 반사실(HANDOFF §3.3): 봉인하지 않으면 ①, keep 을 다른 automation 에서도 옮기면 ②, 요금제를 보지 않으면 ③ ⑤, 쌓기를 트랜잭션 밖에서 하면
 * ④ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty, addSelectOption } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { unsealWebhookUrl } from '../net/url-seal.ts'
import { pressButton, readButtonActions, setButtonActions } from './button-property.ts'
import { createDbAutomation, listDbAutomations } from './db-automation.ts'
import { runAutomationDispatch } from './dispatch.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

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
const URL_B = 'https://hooks.example.org/in/secret-b'

type Table = { ds: string; qty: string; note: string; button: string; row: string }

async function table(name: string): Promise<Table> {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = db.dataSourceId
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '수량', type: 'number' })).properties, '수량')
  const note = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '메모', type: 'rich_text' })).properties, '메모')
  const button = idOf(unwrap(await addProperty(fx.owner.ctx, ds, { name: '보내기', type: 'button' })).properties, '보내기')
  const row = unwrap(await createRow(fx.owner.ctx, ds)).id
  return { ds, qty, note, button, row }
}

const hook = (config: Record<string, unknown>) => ({ type: 'send_webhook', config: { v: 1, ...config } })
const setActions = (tb: Table, actions: unknown[]) => setButtonActions(fx.owner.ctx, tb.ds, tb.button, actions)
const storedConfigs = (automationId: string) =>
  query<{ id: string; config: Record<string, unknown> }>(
    `SELECT id, config FROM automation_action WHERE automation_id = $1 AND type = 'send_webhook' ORDER BY order_idx`,
    [automationId],
  )
const deliveriesOf = (automationId: string) =>
  query<{ id: string; run_id: string; status: string; url_sealed: Buffer; url_hint: string; headers: { name: string; valueSealed: string }[]; payload: Record<string, unknown> }>(
    `SELECT id, run_id, status, url_sealed, url_hint, headers, payload FROM automation_delivery WHERE automation_id = $1 ORDER BY created_at, id`,
    [automationId],
  )
const unseal = (b64: string) => unsealWebhookUrl(Buffer.from(b64, 'base64'))

describe('① 봉인', () => {
  test('★ URL · 헤더 값은 평문으로 저장되지 않고 돌아오지 않는다 — 힌트 · 헤더 이름 · ref 만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('봉인 표')
    const saved = unwrap(await setActions(tb, [hook({ url: URL_A, headers: [{ name: 'X-Token', value: 'tok-123' }], properties: [tb.qty] })]))
    const [row] = await storedConfigs(saved.automationId)
    const text = JSON.stringify(row.config)
    assert.equal(text.includes('secret-a') || text.includes('tok-123'), false, '평문이 저장에 없다')
    assert.equal(unseal(row.config.urlSealed as string), URL_A)
    assert.equal(unseal((row.config.headers as { valueSealed: string }[])[0].valueSealed), 'tok-123')
    for (const actions of [saved.actions, unwrap(await readButtonActions(fx.owner.ctx, tb.ds, tb.button)).actions]) {
      assert.deepEqual(actions, [
        { type: 'send_webhook', config: { v: 1, ref: row.id, urlHint: 'hooks.example.com/…et-a', headers: [{ name: 'x-token' }], properties: [tb.qty] } },
      ])
    }
  })
})

describe('② 옮기기', () => {
  test('★ 고칠 때 URL 없이 keep 으로 · 헤더 값을 비우면 옮긴다 — 다른 automation 의 ref · 없는 이름은 unknown_ref', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('옮기기 표')
    const first = unwrap(await setActions(tb, [hook({ url: URL_A, headers: [{ name: 'x-token', value: 'tok-1' }, { name: 'x-other', value: 'o-1' }] })]))
    const ref = (first.actions[0].config as { ref: string }).ref
    // URL 을 다시 넣지 않고 · x-token 은 비우고(옮긴다) · x-other 는 새 값
    unwrap(await setActions(tb, [hook({ keep: ref, headers: [{ name: 'x-token' }, { name: 'x-other', value: 'o-2' }], properties: [tb.note] })]))
    const [after] = await storedConfigs(first.automationId)
    assert.equal(unseal(after.config.urlSealed as string), URL_A, 'URL 을 옮겼다')
    const headers = after.config.headers as { name: string; valueSealed: string }[]
    assert.deepEqual(headers.map((h) => [h.name, unseal(h.valueSealed)]), [['x-token', 'tok-1'], ['x-other', 'o-2']])
    // 새 URL 을 주면 그것으로
    const ref2 = after.id
    unwrap(await setActions(tb, [hook({ url: URL_B, keep: ref2, headers: [{ name: 'x-token' }] })]))
    const [third] = await storedConfigs(first.automationId)
    assert.equal(unseal(third.config.urlSealed as string), URL_B)

    // 다른 automation 의 ref 는 옮기지 못한다
    const other = await table('남의 표')
    const theirs = unwrap(await setButtonActions(fx.owner.ctx, other.ds, other.button, [hook({ url: URL_B, headers: [{ name: 'x-token', value: 'theirs' }] })]))
    const theirRef = (theirs.actions[0].config as { ref: string }).ref
    assert.deepEqual(await setActions(tb, [hook({ keep: theirRef })]), { ok: false, reason: 'invalid_action', problem: 'unknown_ref', index: 0 })
    assert.deepEqual(await setActions(tb, [hook({ keep: randomUUID() })]), { ok: false, reason: 'invalid_action', problem: 'unknown_ref', index: 0 })
    assert.deepEqual(await setActions(tb, [hook({ url: URL_A, headers: [{ name: 'x-new' }] })]), { ok: false, reason: 'invalid_action', problem: 'unknown_ref', index: 0 }, '옮길 헤더 값이 없다')
  })
})

describe('③ 검사', () => {
  test('★ 보낼 속성은 그 표의 셀 속성 · Free 요금제는 plan_required', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('검사 표')
    assert.deepEqual(await setActions(tb, [hook({ url: URL_A, properties: [tb.button] })]), { ok: false, reason: 'invalid_action', problem: 'unknown_property', index: 0 }, '버튼은 보낼 수 없다')
    assert.deepEqual(await setActions(tb, [hook({ url: URL_A, properties: ['nope'] })]), { ok: false, reason: 'invalid_action', problem: 'unknown_property', index: 0 })
    assert.deepEqual(await setActions(tb, [hook({ url: 'http://hooks.example.com/x' })]), { ok: false, reason: 'invalid_action', problem: 'invalid_url', index: 0 })
    await setWorkspacePlan(fx.workspaceId, 'free')
    try {
      assert.deepEqual(
        await setActions(tb, [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: tb.qty, value: { type: 'number', number: 1 } }] } }, hook({ url: URL_A })]),
        { ok: false, reason: 'invalid_action', problem: 'plan_required', index: 1 },
      )
      assert.equal((await setActions(tb, [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: tb.qty, value: { type: 'number', number: 1 } }] } }])).ok, true, '웹훅이 없으면 Free 도 된다')
    } finally {
      await setWorkspacePlan(fx.workspaceId, 'plus')
    }
  })
})

describe('④ 쌓기', () => {
  test('★ 누르면 배달 한 줄 — pending · 그때의 값 · 속성 이름으로 · run_id · 그때의 봉인 · 단계는 done + deliveryId', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('쌓기 표')
    const stage = unwrap(await addProperty(fx.owner.ctx, tb.ds, { name: '단계', type: 'select' })).properties.find((p) => p.name === '단계')!.id
    const done = unwrap(await addSelectOption(fx.owner.ctx, tb.ds, stage, { name: '완료' })).option.id
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [
      { propertyId: tb.qty, value: { type: 'number', number: 7 } },
      { propertyId: stage, value: { type: 'select', select: { id: done } } },
    ] }))
    const saved = unwrap(await setActions(tb, [hook({ url: URL_A, headers: [{ name: 'x-token', value: 'tok' }], properties: [tb.qty, tb.note, stage] })]))
    const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
    assert.equal(run.status, 'success')
    const [delivery, ...rest] = await deliveriesOf(saved.automationId)
    assert.equal(rest.length, 0)
    assert.deepEqual(run.steps, [{ index: 0, type: 'send_webhook', status: 'done', deliveryId: delivery.id }])
    assert.equal(delivery.status, 'pending')
    assert.equal(delivery.run_id, run.runId)
    assert.equal(unsealWebhookUrl(delivery.url_sealed), URL_A)
    assert.equal(unseal(delivery.headers[0].valueSealed), 'tok')
    // 선택지는 옵션 이름까지 — 셀은 id 만 담는다
    assert.deepEqual(delivery.payload.properties, { 수량: { type: 'number', number: 7 }, 메모: null, 단계: { type: 'select', select: { id: done, name: '완료' } } })
    assert.equal(delivery.payload.run_id, run.runId)
    assert.equal((delivery.payload.page as { id: string }).id, tb.row)
    // 나중에 고쳐도 쌓인 배달은 그때의 것
    unwrap(await setActions(tb, [hook({ url: URL_B })]))
    assert.equal(unsealWebhookUrl((await deliveriesOf(saved.automationId))[0].url_sealed), URL_A)
  })

  test('★ 실행이 되돌려지면 배달도 없다 — 웹훅 뒤의 액션이 실패', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('되돌리기 표')
    const doomed = unwrap(await addProperty(fx.owner.ctx, tb.ds, { name: '사라질 칸', type: 'number' })).properties.find((p) => p.name === '사라질 칸')!.id
    const saved = unwrap(await setActions(tb, [
      hook({ url: URL_A, properties: [tb.qty] }),
      { type: 'edit_property', config: { v: 1, cells: [{ propertyId: doomed, value: { type: 'number', number: 1 } }] } },
    ]))
    await query(`UPDATE property SET deleted_at = now() WHERE id = $1`, [doomed])
    const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
    assert.equal(run.status, 'failed')
    assert.deepEqual(await deliveriesOf(saved.automationId), [], '되돌린 실행은 바깥으로 나갈 것을 남기지 않는다')
  })
})

describe('⑤ 실행 때 다시', () => {
  test('★ 요금제를 내리면 건너뛴다(plan · partial) — DB automation 도 같은 길', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('요금제 표')
    const saved = unwrap(await setActions(tb, [hook({ url: URL_A, properties: [tb.qty] })]))
    await setWorkspacePlan(fx.workspaceId, 'free')
    try {
      const run = unwrap(await pressButton(fx.owner.ctx, tb.row, tb.button, randomUUID()))
      assert.equal(run.status, 'partial')
      assert.deepEqual(run.steps, [{ index: 0, type: 'send_webhook', status: 'skipped', reason: 'plan' }])
      assert.deepEqual(await deliveriesOf(saved.automationId), [])
    } finally {
      await setWorkspacePlan(fx.workspaceId, 'plus')
    }

    const auto = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, {
      name: '바뀌면 알림',
      triggers: [{ type: 'property_edited', propertyId: tb.qty }],
      actions: [hook({ url: URL_B, properties: [tb.qty] })],
    }))
    const listed = unwrap(await listDbAutomations(fx.owner.ctx, tb.ds))
    assert.equal(JSON.stringify(listed).includes('secret-b'), false, '목록에도 평문이 없다')
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.qty, value: { type: 'number', number: 3 } }] }))
    await runAutomationDispatch(new Date(Date.now() + 10_000), { workspaces: [fx.workspaceId] })
    const [delivery] = await deliveriesOf(auto.id)
    assert.equal(delivery?.status, 'pending')
    assert.deepEqual(delivery.payload.properties, { 수량: { type: 'number', number: 3 } })
    assert.equal(unsealWebhookUrl(delivery.url_sealed), URL_B)
  })
})

describe('⑥ 실행하는 사람의 권한으로', () => {
  test('★ 그 행을 볼 수 없는 사람이 누르면 값을 싣지 않는다 — 건너뛴다(not_found) · 배달 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { createUser, joinAs } = await import('../testing/db-fixtures.ts')
    const { grantAccess, revokeAccess, stopInheriting } = await import('../permissions/acl.ts')
    const mate = await joinAs(fx.workspaceId, await createUser('행을 못 보는 사람'), 'member')
    const tb = await table('가린 행 표')
    const saved = unwrap(await setActions(tb, [hook({ url: URL_A, properties: [tb.qty] })]))
    // 그 행만 상속을 끊고 소유자만 남긴다 — 동료는 표는 고칠 수 있지만 그 행은 못 본다
    assert.equal((await stopInheriting(fx.owner.ctx, tb.row)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, tb.row, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    await revokeAccess(fx.owner.ctx, tb.row, { type: 'workspace_everyone' })
    const run = unwrap(await pressButton(mate.ctx, tb.row, tb.button, randomUUID()))
    assert.deepEqual(run.steps, [{ index: 0, type: 'send_webhook', status: 'skipped', reason: 'not_found' }])
    assert.deepEqual(await deliveriesOf(saved.automationId), [])
  })
})
