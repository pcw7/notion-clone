/**
 * 계정의 이메일 여러 개 — AC-1 (F-14-07 · F-14-15)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ① ~ ⑩
 *
 * 이 파일이 지키는 것.
 *
 *   ① 더하기 — 코드를 맞힌 순간 검증된 별칭(대표 아님) · 대표 주소로 알린다 · 그 별칭으로 로그인 코드 · 비밀번호 로그인이 **같은 계정**
 *   ② **확인 전의 주소는 로그인도 공유 수신도 못 한다** — 로그인 코드는 그 계정이 아니라 가입 길 · 그 주소로 온 초대는 수락할 수 없다가
 *      확인한 뒤 그 계정이 이어받는다
 *   ③ **열거 방지** — 다른 계정의 주소도 같은 결과 · 대기 행이 똑같이 선다 · 코드 대신 그 주소로 안내 · 어떤 코드도 맞지 않는다
 *   ④ **최근 재인증** — 오래된 세션은 더하기 · 대표로 · 빼기가 막힌다(비밀번호가 없으면 reauth_required · 있으면 지금 비밀번호)
 *   ⑤ **위임 · API 토큰 컨텍스트는 넷 다 거부**
 *   ⑥ 대기는 그 요청을 낸 계정만 맞힌다 · 다섯 번 틀리면 끝 · 그새 다른 계정이 가지면 unavailable
 *   ⑦ 다섯까지 · 이미 내 주소면 already_yours
 *   ⑧ 대표로 — 자기 행만 · 옛 대표 주소로 알린다 · 빼기 — 대표는 못 뺀다 · 다른 세션 폐기 · 뺀 주소는 풀린다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'
process.env.MAIL_TRANSPORT ??= 'console'

import { probeDatabase, makeFixture, createUser, createBareWorkspace, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query, queryOne } from '../db/pool.ts'
import type { SessionContext } from './session-context.ts'
import { consoleOutbox } from './account-mailer.ts'
import {
  emailsStatus,
  makePrimaryEmail,
  removeEmail,
  requestEmailVerification,
  verifyEmail,
} from './account-email.ts'
import { requestLoginCode, verifyLoginCode } from './login-code.ts'
import { findPasswordLogin, setPassword } from './password.ts'

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

let ipCounter = 0
/** 시험마다 다른 IP(로그인 코드의 IP 상한 — login-code.db.test 와 같은 까닭) · TEST-NET-2 대역. */
const req = () => {
  ipCounter += 1
  return { ip: `198.51.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`, userAgent: 'node:test' }
}
const fresh = (tag = 'alias') => `ac1-${tag}-${randomUUID().slice(0, 8)}@example.com`
/** 이 워크스페이스의 새 사람 — 방금 로그인 코드로 들어온 세션(픽스처). */
const person = async (name = '이메일의 사람') => joinAs(fx.workspaceId, await createUser(name), 'member')
/** 그 세션을 한 시간 전의 것으로 — 10분 안에 로그인한 세션이 아니다. */
const age = (who: Actor) => query(`UPDATE user_session SET created_at = now() - interval '1 hour' WHERE id = $1`, [who.ctx.sessionId])
const rowsOf = (userId: string) =>
  query<{ id: string; email: string; is_primary: boolean; verified: boolean }>(
    `SELECT id, email::text AS email, is_primary, verified_at IS NOT NULL AS verified FROM user_email WHERE user_id = $1 ORDER BY added_at`,
    [userId],
  )
const noticesTo = (to: string) => consoleOutbox().filter((n) => n.to.toLowerCase() === to.toLowerCase())

/** 별칭 하나를 더한다(코드 요청 → 맞히기). */
async function addAlias(who: Actor, email = fresh()): Promise<{ id: string; email: string }> {
  const asked = await requestEmailVerification(who.ctx, { email }, req())
  assert.ok(asked.ok && asked.value.devCode, `코드 요청 실패: ${JSON.stringify(asked)}`)
  const verified = await verifyEmail(who.ctx, { email, code: asked.value.devCode }, req())
  assert.ok(verified.ok, `확인 실패: ${JSON.stringify(verified)}`)
  return { id: verified.value.id, email }
}

describe('① 더하기 · 별칭으로 로그인', () => {
  test('★ 코드를 맞히면 검증된 별칭(대표 아님) · 대표 주소로 알린다 · 상태에 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = fresh()
    const asked = await requestEmailVerification(who.ctx, { email: alias }, req())
    assert.ok(asked.ok && asked.value.devCode)
    assert.equal((await rowsOf(who.userId)).length, 1, '코드를 맞히기 전에는 user_email 에 행이 없다(①)')
    assert.deepEqual((await emailsStatus(who.ctx)).pending.map((p) => p.email), [alias])

    const verified = await verifyEmail(who.ctx, { email: alias, code: asked.value.devCode }, req())
    assert.ok(verified.ok)
    const rows = await rowsOf(who.userId)
    assert.deepEqual(rows.map((r) => [r.email, r.is_primary, r.verified]), [[who.email, true, true], [alias, false, true]])
    const status = await emailsStatus(who.ctx)
    assert.deepEqual(status.emails.map((e) => e.email), [who.email, alias], '대표 먼저')
    assert.deepEqual(status.pending, [], '맞힌 대기는 목록에서 빠진다')
    assert.ok(noticesTo(who.email).some((n) => n.kind === 'email_added' && n.address === alias), '대표 주소로 알렸다')
  })

  test('★ 별칭으로 로그인 코드 · 비밀번호 로그인 — 같은 계정이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const { email: alias } = await addAlias(who)
    const code = await requestLoginCode(alias, req())
    assert.ok(code.devCode)
    const verified = await verifyLoginCode(alias, code.devCode, req())
    assert.ok(verified.ok)
    assert.equal(verified.userId, who.userId, '별칭의 로그인 코드는 그 계정으로 들어온다')

    assert.ok((await setPassword(who.ctx, { newPassword: 'correct horse 77' })).ok)
    const login = await findPasswordLogin({ email: alias.toUpperCase(), password: 'correct horse 77', ip: null, userAgent: 'node:test' })
    assert.ok(login.ok)
    assert.equal(login.value.userId, who.userId, '별칭(대소문자 무관) + 비밀번호도 같은 계정')
  })
})

describe('② 확인 전의 주소', () => {
  test('★ 확인 전의 주소로는 그 계정에 들어오지 못한다 — 로그인 코드는 가입 길이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = fresh()
    assert.ok((await requestEmailVerification(who.ctx, { email: alias }, req())).ok)
    const code = await requestLoginCode(alias, req())
    assert.ok(code.devCode, '아직 누구의 주소도 아니다 — 그 메일함의 주인은 코드를 받는다(선점 없음)')
    const verified = await verifyLoginCode(alias, code.devCode, req())
    assert.ok(verified.ok)
    assert.equal(verified.userId, null, '그 계정이 아니라 새 계정의 길이어야 한다')
    const login = await findPasswordLogin({ email: alias, password: 'whatever 12345', ip: null, userAgent: 'node:test' })
    assert.equal(login.ok, false)
  })

  test('★ 확인 전의 주소로 온 초대는 수락하지 못한다 — 확인하면 그 계정이 이어받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const inv = await import('../workspace/invite.ts')
    const other = await createBareWorkspace('AC-1 초대')
    const boss = await joinAs(other, await createUser('초대하는 사람'), 'owner')
    const who = await person()
    const alias = fresh()
    const asked = await requestEmailVerification(who.ctx, { email: alias }, req())
    assert.ok(asked.ok && asked.value.devCode)

    const invited = await inv.createEmailInvite({ workspaceId: other, inviterUserId: boss.userId, inviterRole: 'owner', email: alias, role: 'member' })
    assert.ok(invited.ok)
    const early = await inv.acceptInvite(invited.token, who.userId)
    assert.equal((early as { reason?: string }).reason, 'email_mismatch', '확인 전에는 그 주소의 초대가 이 계정의 것이 아니다')

    assert.ok((await verifyEmail(who.ctx, { email: alias, code: asked.value.devCode }, req())).ok)
    const late = await inv.acceptInvite(invited.token, who.userId)
    assert.ok(late.ok, `확인한 뒤에는 이어받는다: ${JSON.stringify(late)}`)
    const member = await query(`SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [other, who.userId])
    assert.equal(member.length, 1)
  })
})

describe('③ 열거 방지', () => {
  test('★ 다른 계정의 주소도 같은 결과 · 같은 대기 — 코드 대신 그 주소로 안내 · 어떤 코드도 맞지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const owner = await person('주소의 주인')
    const free = fresh('free')

    const takenAsk = await requestEmailVerification(who.ctx, { email: owner.email }, req())
    const freeAsk = await requestEmailVerification(who.ctx, { email: free }, req())
    assert.equal(takenAsk.ok, true)
    assert.equal(freeAsk.ok, true)
    assert.deepEqual(Object.keys(takenAsk.ok ? takenAsk.value : {}), [], '다른 계정의 주소 — 코드가 없다(라우트의 응답은 늘 { ok: true })')

    const pending = (await emailsStatus(who.ctx)).pending.map((p) => p.email).sort()
    assert.deepEqual(pending, [owner.email, free].sort(), '대기 목록이 "이미 쓰인 주소"를 가르지 않는다')
    const challenges = await query<{ email: string }>(
      `SELECT email::text AS email FROM otp_challenge WHERE purpose = 'email_verify' AND user_id = $1 AND consumed_at IS NULL`,
      [who.userId],
    )
    assert.equal(challenges.length, 2, '대기 행도 똑같이 선다')
    assert.ok(noticesTo(owner.email).some((n) => n.kind === 'email_taken'), '그 주소의 주인에게만 안내가 간다')
    assert.ok(!noticesTo(who.email).some((n) => n.kind === 'email_taken'), '요청한 사람에게는 아무것도 가지 않는다')

    for (const guess of ['000000', '123456']) {
      const tried = await verifyEmail(who.ctx, { email: owner.email, code: guess }, req())
      assert.deepEqual(tried, { ok: false, reason: 'invalid' })
    }
    assert.deepEqual((await rowsOf(owner.userId)).map((r) => r.email), [owner.email], '주인의 주소는 그대로')
  })
})

describe('④ 최근 재인증', () => {
  test('★ 오래된 세션 — 비밀번호가 없으면 셋 다 reauth_required', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = await addAlias(who)
    await age(who)
    assert.equal((await emailsStatus(who.ctx)).reauthRequired, true)
    assert.deepEqual(await requestEmailVerification(who.ctx, { email: fresh() }, req()), { ok: false, reason: 'reauth_required' })
    assert.deepEqual(await makePrimaryEmail(who.ctx, { emailId: alias.id }), { ok: false, reason: 'reauth_required' })
    assert.deepEqual(await removeEmail(who.ctx, { emailId: alias.id }), { ok: false, reason: 'reauth_required' })
    assert.equal((await rowsOf(who.userId)).length, 2, '아무것도 바뀌지 않았다')
  })

  test('★ 오래된 세션 — 비밀번호가 있으면 지금 비밀번호로 · 틀리면 wrong_password', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = await addAlias(who)
    assert.ok((await setPassword(who.ctx, { newPassword: 'correct horse 88' })).ok)
    await age(who)
    assert.deepEqual(await makePrimaryEmail(who.ctx, { emailId: alias.id }), { ok: false, reason: 'reauth_required' })
    assert.deepEqual(await makePrimaryEmail(who.ctx, { emailId: alias.id, currentPassword: 'wrong horse 88' }), { ok: false, reason: 'wrong_password' })
    const done = await makePrimaryEmail(who.ctx, { emailId: alias.id, currentPassword: 'correct horse 88' })
    assert.ok(done.ok)
    const asked = await requestEmailVerification(who.ctx, { email: fresh(), currentPassword: 'correct horse 88' }, req())
    assert.ok(asked.ok && asked.value.devCode)
  })
})

describe('⑤ 세션이 아닌 컨텍스트', () => {
  test('★ 위임 · API 토큰 컨텍스트는 넷 다 session_required', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = await addAlias(who)
    const contexts: SessionContext[] = [
      { ...who.ctx, apiToken: { tokenId: randomUUID() } },
      { ...who.ctx, delegation: { automationId: randomUUID() } },
    ]
    for (const ctx of contexts) {
      assert.deepEqual(await requestEmailVerification(ctx, { email: fresh() }, req()), { ok: false, reason: 'session_required' })
      assert.deepEqual(await verifyEmail(ctx, { email: fresh(), code: '000000' }, req()), { ok: false, reason: 'session_required' })
      assert.deepEqual(await makePrimaryEmail(ctx, { emailId: alias.id }), { ok: false, reason: 'session_required' })
      assert.deepEqual(await removeEmail(ctx, { emailId: alias.id }), { ok: false, reason: 'session_required' })
    }
    assert.equal((await rowsOf(who.userId)).length, 2)
  })
})

describe('⑥ 대기 · 코드', () => {
  test('★ 대기는 그 요청을 낸 계정만 맞힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const thief = await person('남의 코드를 쓰려는 사람')
    const alias = fresh()
    const asked = await requestEmailVerification(who.ctx, { email: alias }, req())
    assert.ok(asked.ok && asked.value.devCode)
    assert.deepEqual(await verifyEmail(thief.ctx, { email: alias, code: asked.value.devCode }, req()), { ok: false, reason: 'invalid' })
    assert.equal((await rowsOf(thief.userId)).length, 1)
    assert.ok((await verifyEmail(who.ctx, { email: alias, code: asked.value.devCode }, req())).ok, '요청한 계정은 그대로 맞힌다')
  })

  test('다섯 번 틀리면 끝 — 맞는 코드도 늦다 · 다시 요청하면 옛 코드는 닫힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = fresh()
    const first = await requestEmailVerification(who.ctx, { email: alias }, req())
    const second = await requestEmailVerification(who.ctx, { email: alias }, req())
    assert.ok(first.ok && first.value.devCode && second.ok && second.value.devCode)
    if (first.value.devCode !== second.value.devCode) {
      assert.deepEqual(await verifyEmail(who.ctx, { email: alias, code: first.value.devCode }, req()), { ok: false, reason: 'invalid' }, '옛 코드는 닫혔다')
    }
    // 옛 코드를 넣어 본 것도 지금 대기의 틀린 한 번이다 — 다섯째 틀림에서 끝나고 그 뒤로는 대기가 없다(invalid)
    const wrong = second.value.devCode === '999999' ? '999998' : '999999'
    const results: { reason?: string }[] = []
    for (let i = 0; i < 5; i += 1) results.push((await verifyEmail(who.ctx, { email: alias, code: wrong }, req())) as { reason?: string })
    assert.ok(results.some((r) => r.reason === 'too_many_attempts'), JSON.stringify(results))
    assert.equal((await verifyEmail(who.ctx, { email: alias, code: second.value.devCode }, req())).ok, false, '맞는 코드도 늦다')
    assert.equal((await rowsOf(who.userId)).length, 1)
  })

  test('맞혔지만 그새 다른 계정이 가졌으면 unavailable — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = fresh()
    const asked = await requestEmailVerification(who.ctx, { email: alias }, req())
    assert.ok(asked.ok && asked.value.devCode)
    const other = await createUser('먼저 가진 사람')
    await query(`INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at) VALUES ($1, $2, $3, now(), false, now())`, [randomUUID(), other.userId, alias])
    assert.deepEqual(await verifyEmail(who.ctx, { email: alias, code: asked.value.devCode }, req()), { ok: false, reason: 'unavailable' })
    assert.equal((await rowsOf(who.userId)).length, 1)
  })
})

describe('⑦ 개수 · 내 주소', () => {
  test('다섯까지 — 여섯째는 limit_reached · 내 주소는 already_yours', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    for (let i = 0; i < 4; i += 1) await addAlias(who)
    assert.equal((await rowsOf(who.userId)).length, 5)
    assert.deepEqual(await requestEmailVerification(who.ctx, { email: fresh() }, req()), { ok: false, reason: 'limit_reached' })
    assert.deepEqual(await requestEmailVerification(who.ctx, { email: who.email.toUpperCase() }, req()), { ok: false, reason: 'already_yours' })
    assert.deepEqual(await requestEmailVerification(who.ctx, { email: 'not-an-email' }, req()), { ok: false, reason: 'invalid_email' })
  })
})

describe('⑧ 대표로 · 빼기', () => {
  test('★ 대표로 — 자기 행만 · user.primary_email_id 가 따라온다 · 옛 대표 주소로 알린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const stranger = await person('남')
    const alias = await addAlias(who)
    const strangerRow = await queryOne<{ id: string }>(`SELECT id FROM user_email WHERE user_id = $1`, [stranger.userId])
    assert.deepEqual(await makePrimaryEmail(who.ctx, { emailId: strangerRow.id }), { ok: false, reason: 'not_found' }, '남의 주소는 없는 것')
    assert.deepEqual(await makePrimaryEmail(who.ctx, { emailId: 'not-a-uuid' }), { ok: false, reason: 'not_found' })

    const done = await makePrimaryEmail(who.ctx, { emailId: alias.id })
    assert.ok(done.ok)
    const user = await queryOne<{ primary_email_id: string }>(`SELECT primary_email_id FROM "user" WHERE id = $1`, [who.userId])
    assert.equal(user.primary_email_id, alias.id)
    assert.deepEqual((await rowsOf(who.userId)).filter((r) => r.is_primary).map((r) => r.email), [alias.email], '대표는 하나')
    assert.ok(noticesTo(who.email).some((n) => n.kind === 'email_primary_changed' && n.address === alias.email), '옛 대표 주소로 알렸다')
    assert.deepEqual(await makePrimaryEmail(who.ctx, { emailId: alias.id }), { ok: false, reason: 'already_primary' })
  })

  test('★ 빼기 — 대표는 못 뺀다 · 별칭을 빼면 다른 세션이 폐기되고 그 주소는 풀린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const alias = await addAlias(who)
    const primaryId = (await rowsOf(who.userId)).find((r) => r.is_primary)!.id
    assert.deepEqual(await removeEmail(who.ctx, { emailId: primaryId }), { ok: false, reason: 'primary_locked' })

    const elsewhere = await joinAs(fx.workspaceId, { userId: who.userId }, 'member') // 다른 기기의 세션
    const removed = await removeEmail(who.ctx, { emailId: alias.id })
    assert.ok(removed.ok)
    assert.ok(removed.value.revokedSessions >= 1)
    const sessions = await query<{ id: string; revoked_reason: string | null }>(`SELECT id, revoked_reason FROM user_session WHERE id = ANY($1::uuid[])`, [
      [who.ctx.sessionId, elsewhere.ctx.sessionId],
    ])
    assert.equal(sessions.find((s) => s.id === who.ctx.sessionId)?.revoked_reason, null, '이 세션은 남는다')
    assert.equal(sessions.find((s) => s.id === elsewhere.ctx.sessionId)?.revoked_reason, 'email_removed')
    assert.deepEqual((await rowsOf(who.userId)).map((r) => r.email), [who.email])
    assert.ok(noticesTo(who.email).some((n) => n.kind === 'email_removed' && n.address === alias.email))

    const code = await requestLoginCode(alias.email, req())
    assert.ok(code.devCode)
    const verified = await verifyLoginCode(alias.email, code.devCode, req())
    assert.ok(verified.ok)
    assert.equal(verified.userId, null, '뺀 주소는 풀렸다 — 더는 이 계정으로 들어오지 않는다')
  })
})
