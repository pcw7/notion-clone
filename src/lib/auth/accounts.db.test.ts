/**
 * 한 브라우저에 로그인한 계정들 — 세션의 상태 · 폐기 · 화면 요약 (잔여 묶음 8j-2 · F-14-09)
 *
 *   ① 상태 — 살아 있음 · 만료 · 폐기 · 계정이 active 가 아님 · 둘째 단계 전(확정된 수단이 있을 때만 — 시작만 한 수단은 아니다) · 없는 토큰은
 *     빠진다 · 순서를 지킨다
 *   ② 폐기 — 정한 세션만 · 이미 폐기된 것은 그대로(이유를 덮지 않는다)
 *   ③ 화면 요약 — 이름 · 이메일 · 상태 · 토큰은 싣지 않는다
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, createUser } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createSession } from './session.ts'
import { hashSessionToken } from './session-context.ts'
import { describeTokens, revokeTokens, signedInAccounts } from './accounts.ts'

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

const sessionFor = async (userId: string, mfaSatisfied = false) =>
  (
    await withTransaction((tx) =>
      createSession(tx, { userId, authMethod: 'login_code', mfaSatisfied, ip: null, userAgent: 'node:test' }),
    )
  ).token

const confirmMethod = (userId: string) =>
  query(
    `INSERT INTO mfa_method (id, user_id, kind, label, created_at, confirmed_at) VALUES (gen_random_uuid(), $1, 'totp', '시험', now(), now())`,
    [userId],
  )

test('★ ① 상태 — 살아 있음 · 만료 · 폐기 · 계정이 꺼짐 · 둘째 단계 전 · 없는 토큰 · 순서', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const a = await createUser('계정 묶음 A')
  const b = await createUser('계정 묶음 B')
  const c = await createUser('계정 묶음 C')
  const d = await createUser('계정 묶음 D')
  const e = await createUser('계정 묶음 E')
  const live = await sessionFor(a.userId)
  const expired = await sessionFor(a.userId)
  const revoked = await sessionFor(b.userId)
  const suspended = await sessionFor(c.userId)
  const pending = await sessionFor(d.userId)
  const passed = await sessionFor(d.userId, true)
  const unconfirmed = await sessionFor(e.userId)
  await query(`UPDATE user_session SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [hashSessionToken(expired)])
  await revokeTokens([revoked], 'test')
  await query(`UPDATE "user" SET status = 'suspended' WHERE id = $1`, [c.userId])
  await confirmMethod(d.userId)
  // 등록을 시작만 한 수단(확정 전)은 게이트가 세지 않는다 — 둘째 단계 전이 아니다
  await query(`INSERT INTO mfa_method (id, user_id, kind, label, created_at) VALUES (gen_random_uuid(), $1, 'totp', '시작만', now())`, [e.userId])

  const unknown = 'x'.repeat(43)
  const got = await describeTokens([passed, unknown, pending, unconfirmed, suspended, revoked, expired, live])
  assert.deepEqual(
    got.map((i) => [i.token, i.userId, i.live, i.mfaPending]),
    [
      [passed, d.userId, true, false],
      [pending, d.userId, true, true],
      [unconfirmed, e.userId, true, false],
      [suspended, c.userId, false, false],
      [revoked, b.userId, false, false],
      [expired, a.userId, false, false],
      [live, a.userId, true, false],
    ],
  )
  assert.ok(got.every((i) => i.expiresAt instanceof Date))
  // 확정된 수단이 없으면 둘째 단계 전이 아니다
  assert.equal((await describeTokens([live]))[0]?.mfaPending, false)
  assert.deepEqual(await describeTokens([]), [])
})

test('② 폐기 — 정한 세션만 · 이미 폐기된 것은 이유를 덮지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const u = await createUser('폐기의 사람')
  const one = await sessionFor(u.userId)
  const two = await sessionFor(u.userId)
  await revokeTokens([one], 'first')
  await revokeTokens([one, two], 'second')
  const reasons = await query<{ revoked_reason: string }>(
    `SELECT revoked_reason FROM user_session WHERE user_id = $1 ORDER BY created_at`,
    [u.userId],
  )
  assert.deepEqual(reasons.map((r) => r.revoked_reason), ['first', 'second'])
  await revokeTokens([], 'none')
})

test('★ ③ 화면 요약 — 이름 · 이메일 · 상태 · 토큰은 없다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const a = await createUser('요약의 A')
  const b = await createUser('요약의 B')
  const c = await createUser('요약의 C')
  const active = await sessionFor(a.userId)
  const gone = await sessionFor(b.userId)
  const waiting = await sessionFor(c.userId)
  await revokeTokens([gone], 'test')
  await confirmMethod(c.userId)
  const [ia, ib, ic] = await describeTokens([active, gone, waiting])
  const view = await signedInAccounts(ia!, [ib!, ic!])
  assert.deepEqual(view, {
    current: { userId: a.userId, name: '요약의 A', email: a.email, state: 'signed_in' },
    others: [
      { userId: b.userId, name: '요약의 B', email: b.email, state: 'signed_out' },
      { userId: c.userId, name: '요약의 C', email: c.email, state: 'mfa_required' },
    ],
  })
  assert.ok(!JSON.stringify(view).includes(active))
  assert.deepEqual(await signedInAccounts(null, []), { current: null, others: [] })
})
