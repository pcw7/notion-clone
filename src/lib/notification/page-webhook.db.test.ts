/**
 * 페이지 웹훅 — 걸고 · 보고 · 멈추고 · 지우기 (히스토리 · 활동 4e-1 · F-11-19, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.8 [보강] 페이지 웹훅 ② ③ ④ ⑦).
 *
 *   ① 문 — 전체 권한만(편집만 받았으면 403 · 볼 수 없으면 404) · 목록도 같다 · 데이터베이스 행 · 휴지통의 페이지는 안 된다
 *   ② URL 의 모양 — http · 안쪽 주소 · 사용자 정보는 거절하고 까닭을 말한다
 *   ③ 봉인 — DB 에 원문이 없고 풀면 원문 · 목록에는 힌트만
 *   ④ 상한 — 페이지마다 5개
 *   ⑤ 멈추기 · 다시 켜기(실패로 멈춘 것도) · 지우기 — 다른 페이지의 id 로는 닿지 않는다
 *
 * 반사실(HANDOFF §3.3): 전체 권한 대신 편집을 보면 ①, 모양을 보지 않으면 ②, 원문을 그대로 두면 ③, 상한을 빼면 ④ 가 실패한다.
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'
import { unsealWebhookUrl } from '../net/url-seal.ts'
import {
  addPageWebhook,
  listPageWebhooks,
  MAX_WEBHOOKS_PER_PAGE,
  removePageWebhook,
  setPageWebhookPaused,
  type PageWebhook,
} from './page-webhook.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
const SLACK = 'https://hooks.slack.com/services/T0000/B0000/secretToken9z1y'

let skipReason = ''
let fx: Fixture
let mate: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  mate = await joinAs(fx.workspaceId, await createUser('편집만 받은 사람'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const page = async (title: string) => (await createPage(fx.owner.ctx, { parentPageId: null, title: titleFromPlainText(title) })).id
const added = async (pageId: string, url = SLACK): Promise<PageWebhook> => {
  const r = await addPageWebhook(fx.owner.ctx, pageId, url)
  assert.ok(r.ok, JSON.stringify(r))
  return r.value
}
/** 소유자만 전체 권한 — 같이 쓰는 사람은 `level` 만(없으면 못 본다). */
async function restrict(pageId: string, level: 'edit' | null): Promise<void> {
  assert.equal((await stopInheriting(fx.owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, pageId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
  if (level !== null) assert.equal((await grantAccess(fx.owner.ctx, pageId, { type: 'user', id: mate.userId }, level)).ok, true)
}

describe('① 문', () => {
  test('★ 전체 권한만 건다 · 본다 — 편집만 받았으면 403, 볼 수 없으면 404', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const editable = await page('편집만 되는 글')
    await restrict(editable, 'edit')
    await added(editable)
    assert.deepEqual(await addPageWebhook(mate.ctx, editable, SLACK), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await listPageWebhooks(mate.ctx, editable), { ok: false, reason: 'forbidden' }, '힌트도 보지 못한다')

    const hidden = await page('못 보는 글')
    await restrict(hidden, null)
    assert.deepEqual(await addPageWebhook(mate.ctx, hidden, SLACK), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listPageWebhooks(mate.ctx, hidden), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listPageWebhooks(fx.owner.ctx, randomUUID()), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listPageWebhooks(fx.owner.ctx, '아님'), { ok: false, reason: 'not_found' })
  })

  test('데이터베이스 행 · 휴지통의 페이지에는 걸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await createDatabase(fx.owner.ctx, { name: '웹훅 표' })
    assert.ok(db.ok)
    const row = await createRow(fx.owner.ctx, db.value.dataSourceId)
    assert.ok(row.ok)
    assert.deepEqual(await addPageWebhook(fx.owner.ctx, row.value.id, SLACK), { ok: false, reason: 'row_page' })

    const gone = await page('버린 글')
    await trashPage(fx.owner.ctx, asBlockId(gone))
    assert.deepEqual(await addPageWebhook(fx.owner.ctx, gone, SLACK), { ok: false, reason: 'not_found' })
  })
})

describe('② URL 의 모양', () => {
  test('★ http · 안쪽 주소 · 사용자 정보는 거절하고 까닭을 말한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('모양')
    for (const [url, problem] of [
      ['http://hooks.slack.com/x', 'not_https'],
      ['https://127.0.0.1/x', 'private_host'],
      ['https://169.254.169.254/latest', 'private_host'],
      ['https://localhost/x', 'private_host'],
      ['https://me:pw@hooks.slack.com/x', 'credentials'],
      ['https://hooks.slack.com:8443/x', 'port'],
      ['아무거나', 'invalid'],
    ] as const) {
      assert.deepEqual(await addPageWebhook(fx.owner.ctx, target, url), { ok: false, reason: 'invalid_url', problem }, url)
    }
    assert.deepEqual(await addPageWebhook(fx.owner.ctx, target, 42), { ok: false, reason: 'invalid_url', problem: 'invalid' })
    const listed = await listPageWebhooks(fx.owner.ctx, target)
    assert.deepEqual(listed.ok ? listed.value : null, [], '하나도 걸리지 않았다')
  })
})

describe('③ 봉인', () => {
  test('★ DB 에 원문이 없고 풀면 원문 · 목록에는 힌트만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('비밀')
    const hook = await added(target)
    assert.equal(hook.urlHint, 'hooks.slack.com/…9z1y')
    assert.deepEqual(hook.createdBy.id, fx.owner.userId)
    assert.equal(hook.paused, null)
    const [stored] = await query<{ url_sealed: Buffer; url_hint: string }>(`SELECT url_sealed, url_hint FROM page_webhook WHERE id = $1`, [hook.id])
    assert.ok(!stored.url_sealed.toString('latin1').includes('secretToken'), 'DB 에 원문이 없다')
    assert.equal(unsealWebhookUrl(stored.url_sealed), SLACK)
    const listed = await listPageWebhooks(fx.owner.ctx, target)
    assert.ok(listed.ok)
    assert.ok(!JSON.stringify(listed.value).includes('secretToken'), '목록에 원문이 없다')
  })
})

describe('④ 상한', () => {
  test('★ 페이지마다 5개', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('많이')
    for (let i = 0; i < MAX_WEBHOOKS_PER_PAGE; i++) await added(target, `https://example.com/hook/${i}`)
    assert.deepEqual(await addPageWebhook(fx.owner.ctx, target, SLACK), { ok: false, reason: 'too_many' })
    const other = await page('다른 페이지')
    await added(other)
  })
})

describe('⑤ 멈추기 · 다시 켜기 · 지우기', () => {
  test('★ 사람이 멈추고 다시 켠다 — 실패로 멈춘 것도 다시 켠다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('멈춤')
    const hook = await added(target)
    const paused = await setPageWebhookPaused(fx.owner.ctx, target, hook.id, true)
    assert.equal(paused.ok && paused.value.paused?.reason, 'manual')
    const resumed = await setPageWebhookPaused(fx.owner.ctx, target, hook.id, false)
    assert.equal(resumed.ok && resumed.value.paused, null)

    await query(`UPDATE page_webhook SET paused_at = now(), pause_reason = 'failures' WHERE id = $1`, [hook.id])
    const still = await setPageWebhookPaused(fx.owner.ctx, target, hook.id, true)
    assert.equal(still.ok && still.value.paused?.reason, 'failures', '이미 실패로 멈췄으면 까닭을 바꾸지 않는다')
    const back = await setPageWebhookPaused(fx.owner.ctx, target, hook.id, false)
    assert.equal(back.ok && back.value.paused, null)
  })

  test('★ 지운다 — 다른 페이지의 id 로는 닿지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('지울 것')
    const elsewhere = await page('남의 페이지')
    const hook = await added(target)
    assert.deepEqual(await removePageWebhook(fx.owner.ctx, elsewhere, hook.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await setPageWebhookPaused(fx.owner.ctx, elsewhere, hook.id, true), { ok: false, reason: 'not_found' })
    assert.deepEqual(await removePageWebhook(fx.owner.ctx, target, hook.id), { ok: true, value: null })
    assert.deepEqual(await removePageWebhook(fx.owner.ctx, target, hook.id), { ok: false, reason: 'not_found' })
    const listed = await listPageWebhooks(fx.owner.ctx, target)
    assert.deepEqual(listed.ok ? listed.value : null, [])
  })
})
