/**
 * 공개 링크의 만료 — §7 정리 10n-50 (F-06-08 · F-06-07)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 ⑬ [보강 10n-50] · 0115
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 요금제 — Free 는 정하기가 `plan_required`(지우기는 된다) · 상태가 `expiryAllowed` 로 미리 말한다
 *   ② ★ Plus — 정하면 상태에 실리고 그때까지 열린다 · 지나면 열리지 않고(만료) 게시 상태는 그대로 · 지우면 같은 주소로 다시 열린다
 *   ③ 값의 검사 — 지금보다 앞 · 1년 넘게 · 시각이 아닌 값은 `invalid_input` · 게시 안 됨 · 전체 권한 없음
 *   ④ 게시 해제 · 다시 게시는 만료를 건드리지 않는다(주소와 같은 결)
 *   ⑤ 요금제를 내려도 남은 만료는 듣고, 지울 수 있다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { query } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { resolvePublicPage } from './public-access.ts'
import { MAX_LINK_EXPIRY_MS, publishPage, readPublishState, unpublishPage, updatePublicLink } from './public-link.ts'

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
  }
})

function value<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)

const DAY = 24 * 60 * 60 * 1000
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/** 게시된 개인 페이지 하나 — 요금제를 고른다. */
async function world(plan: 'free' | 'plus') {
  const ws = await createBareWorkspace('공개 링크 만료')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const member: Actor = await joinAs(ws, await createUser('멤버'), 'member')
  if (plan !== 'free') value(await setWorkspacePlan(ws, plan))
  const doc: BlockId = (await createPage(boss.ctx, { privateTop: true, title: titleFromPlainText('만료 문서') })).id
  const token = value(await publishPage(boss.ctx, doc)).token!
  const opens = async () => {
    const access = await resolvePublicPage(token)
    return access.ok ? 'open' : access.reason
  }
  return { ws, boss, member, doc, token, opens }
}

describe('공개 링크의 만료 (10n-50)', () => {
  test('★ ① Free — 정하기는 plan_required · 상태가 미리 말한다 · 지우기는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('free')
    assert.equal(value(await readPublishState(w.boss.ctx, w.doc)).expiryAllowed, false)
    assert.equal(reasonOf(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: inDays(7) })), 'plan_required')
    assert.equal(reasonOf(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: null })), 'ok', '지우기는 요금제와 무관')
  })

  test('★ ② Plus — 정하면 그때까지 열리고 · 지나면 만료(게시는 그대로) · 지우면 같은 주소로 다시 열린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('plus')
    const state = value(await readPublishState(w.boss.ctx, w.doc))
    assert.equal(state.expiryAllowed, true)
    const at = inDays(7)
    const set = value(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: at }))
    assert.equal(set.expiresAt, at)
    assert.equal(await w.opens(), 'open', '그때까지는 열린다')

    // 시간이 흘렀다 — 만료 시각을 지난 것으로 옮긴다(명령은 지난 시각을 받지 않는다)
    await query(`UPDATE public_link SET expires_at = now() - interval '1 minute' WHERE node_id = $1`, [w.doc])
    assert.equal(await w.opens(), 'expired')
    const after = value(await readPublishState(w.boss.ctx, w.doc))
    assert.equal(after.published, true, '게시 상태는 그대로 — 만료됨을 화면이 말한다')
    assert.ok(after.expiresAt !== null && Date.parse(after.expiresAt) < Date.now())

    assert.equal(value(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: null })).expiresAt, null)
    assert.equal(await w.opens(), 'open', '지우면 같은 주소로 다시 열린다')
    assert.equal(value(await readPublishState(w.boss.ctx, w.doc)).token, w.token)
  })

  test('③ 값의 검사 — 지난 시각 · 1년 넘게 · 시각이 아닌 값 · 게시 안 됨 · 전체 권한 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('plus')
    for (const expiresAt of [inDays(-1), new Date(Date.now() + MAX_LINK_EXPIRY_MS + DAY).toISOString(), '2027-01-01', 42, 'not-a-date']) {
      assert.equal(reasonOf(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt })), 'invalid_input', String(expiresAt))
    }
    assert.equal(reasonOf(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: inDays(360) })), 'ok', '1년 안')
    assert.equal(reasonOf(await updatePublicLink(w.member.ctx, w.doc, { expiresAt: inDays(7) })), 'not_found', '볼 수 없는 개인 페이지')
    value(await unpublishPage(w.boss.ctx, w.doc))
    assert.equal(reasonOf(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: inDays(7) })), 'not_published')
  })

  test('④ 게시 해제 · 다시 게시는 만료를 건드리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('plus')
    const at = inDays(30)
    value(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: at }))
    value(await unpublishPage(w.boss.ctx, w.doc))
    assert.equal(value(await publishPage(w.boss.ctx, w.doc)).expiresAt, at)
  })

  test('⑤ 요금제를 내려도 남은 만료는 듣고 · 지울 수 있다 · 다시 정하는 것은 막힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = await world('plus')
    const at = inDays(30)
    value(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: at }))
    value(await setWorkspacePlan(w.ws, 'free'))
    const state = value(await readPublishState(w.boss.ctx, w.doc))
    assert.equal(state.expiresAt, at, '남은 만료는 그대로다 — 좁히는 쪽이다')
    assert.equal(state.expiryAllowed, false)
    assert.equal(reasonOf(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: inDays(60) })), 'plan_required')
    assert.equal(value(await updatePublicLink(w.boss.ctx, w.doc, { expiresAt: null })).expiresAt, null)
  })
})
