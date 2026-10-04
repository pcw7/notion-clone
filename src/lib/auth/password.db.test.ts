/**
 * 비밀번호 — 잔여 묶음 8i-1a (F-14-03)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 정하기 — 없을 때는 지금 비밀번호 없이 · 한 줄 · argon2id · 정책을 지키지 않으면 아무것도 쓰지 않는다
 *   ② **바꾸기 · 지우기는 지금 비밀번호를 묻는다** — 단 10분 안에 로그인 코드로 들어온 세션은 묻지 않는다(재설정)
 *   ③ **바꾸면 이 세션을 뺀 모든 세션이 폐기된다**
 *   ④ 지우기 — 2단계 인증이 켜져 있으면 못 지운다 · 없으면 no_password
 *   ⑤ 로그인 — 맞으면 그 사람 · 실패는 모두 같은 말(없는 이메일 · 비밀번호 없는 계정 · 틀린 비밀번호) · 15분에 10번 틀리면 맞아도 막는다 ·
 *      성공 뒤에는 다시 센다
 *   ⑥ 옛 매개변수로 만든 해시는 로그인에 성공할 때 새로 만든다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { argon2Sync, randomBytes, randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { resolveSessionContext } from './session-context.ts'
import { PASSWORD_FAILURE_LIMIT, findPasswordLogin, passwordStatus, removePassword, setPassword } from './password.ts'

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

const GOOD = 'correct horse 1'
const NEXT = 'battery staple 2'

/** 이 워크스페이스의 새 사람 — 방금 로그인 코드로 들어온 세션(픽스처). */
const person = async (name = '비밀번호의 사람') => joinAs(fx.workspaceId, await createUser(name), 'member')
/** 그 세션을 한 시간 전의 것으로 — 10분 안의 코드 세션이 아니다. */
const age = (who: Actor) => query(`UPDATE user_session SET created_at = now() - interval '1 hour' WHERE id = $1`, [who.ctx.sessionId])
const passwordRows = (userId: string) =>
  query<{ password_hash: string }>(`SELECT password_hash FROM credential WHERE user_id = $1 AND kind = 'password'`, [userId])
const login = (email: string, password: string) => findPasswordLogin({ email, password, ip: null, userAgent: 'node:test' })

describe('① 정하기', () => {
  test('★ 없을 때는 지금 비밀번호 없이 — 한 줄 · argon2id · 상태가 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    await age(who) // 오래된 세션이어도 처음 정하는 데는 지금 비밀번호가 없다
    assert.deepEqual(await passwordStatus(who.ctx), { hasPassword: false, currentRequired: false })
    assert.deepEqual(await setPassword(who.ctx, { newPassword: GOOD }), { ok: true, value: { revokedSessions: 0 } })
    const rows = await passwordRows(who.userId)
    assert.equal(rows.length, 1)
    assert.match(rows[0]!.password_hash, /^\$argon2id\$v=19\$/)
    assert.ok(!rows[0]!.password_hash.includes(GOOD), '평문이 저장됐다')
    assert.deepEqual(await passwordStatus(who.ctx), { hasPassword: true, currentRequired: true })
  })

  test('정책을 지키지 않으면 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    for (const bad of ['short1', 'aaaa1111', 'abcdefghijklmn', undefined, 42]) {
      assert.deepEqual(await setPassword(who.ctx, { newPassword: bad }), { ok: false, reason: 'weak_password' }, JSON.stringify(bad))
    }
    assert.equal((await passwordRows(who.userId)).length, 0)
  })
})

describe('② · ③ 바꾸기', () => {
  test('★ 오래된 세션은 지금 비밀번호를 묻는다 — 없으면 current_required · 틀리면 wrong_password · 맞으면 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    assert.equal((await setPassword(who.ctx, { newPassword: GOOD })).ok, true)
    const before = (await passwordRows(who.userId))[0]!.password_hash
    await age(who)

    assert.deepEqual(await setPassword(who.ctx, { newPassword: NEXT }), { ok: false, reason: 'current_required' })
    assert.deepEqual(await setPassword(who.ctx, { newPassword: NEXT, currentPassword: 'wrong pass 9' }), { ok: false, reason: 'wrong_password' })
    assert.equal((await passwordRows(who.userId))[0]!.password_hash, before, '거부됐는데 바뀌었다')

    assert.equal((await setPassword(who.ctx, { newPassword: NEXT, currentPassword: GOOD })).ok, true)
    assert.equal((await login(who.email, NEXT)).ok, true)
    assert.equal((await login(who.email, GOOD)).ok, false, '옛 비밀번호로 들어온다')
  })

  test('★ 10분 안에 로그인 코드로 들어온 세션은 묻지 않는다 — 재설정', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    assert.equal((await setPassword(who.ctx, { newPassword: GOOD })).ok, true)
    assert.deepEqual(await passwordStatus(who.ctx), { hasPassword: true, currentRequired: false })
    assert.equal((await setPassword(who.ctx, { newPassword: NEXT })).ok, true)
    assert.equal((await login(who.email, NEXT)).ok, true)
  })

  test('★ 바꾸면 이 세션을 뺀 모든 세션이 폐기된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const user = await createUser('세션이 여럿인 사람')
    const here = await joinAs(fx.workspaceId, user, 'member')
    const phone = await joinAs(fx.workspaceId, user, 'member')
    const laptop = await joinAs(fx.workspaceId, user, 'member')
    assert.equal((await setPassword(here.ctx, { newPassword: GOOD })).ok, true)
    assert.deepEqual(await setPassword(here.ctx, { newPassword: NEXT }), { ok: true, value: { revokedSessions: 2 } })
    assert.equal((await resolveSessionContext(here.token, fx.workspaceId)).ok, true, '바꾼 세션이 폐기됐다')
    for (const other of [phone, laptop]) {
      assert.deepEqual(await resolveSessionContext(other.token, fx.workspaceId), { ok: false, reason: 'revoked' })
    }
    const reasons = await query<{ revoked_reason: string }>(
      `SELECT DISTINCT revoked_reason FROM user_session WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.userId],
    )
    assert.deepEqual(reasons, [{ revoked_reason: 'password_change' }])
  })
})

describe('④ 지우기', () => {
  test('★ 2단계 인증이 켜져 있으면 못 지운다 · 지금 비밀번호를 묻는다 · 지우면 비밀번호로 못 들어온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    assert.deepEqual(await removePassword(who.ctx, {}), { ok: false, reason: 'no_password' })
    assert.equal((await setPassword(who.ctx, { newPassword: GOOD })).ok, true)
    await age(who)

    const mfa = randomUUID()
    await query(`INSERT INTO mfa_method (id, user_id, kind, label, confirmed_at, created_at) VALUES ($1, $2, 'totp', '앱', now(), now())`, [mfa, who.userId])
    assert.deepEqual(await removePassword(who.ctx, { currentPassword: GOOD }), { ok: false, reason: 'mfa_enabled' })
    await query(`DELETE FROM mfa_method WHERE id = $1`, [mfa])

    assert.deepEqual(await removePassword(who.ctx, {}), { ok: false, reason: 'current_required' })
    assert.deepEqual(await removePassword(who.ctx, { currentPassword: 'wrong pass 9' }), { ok: false, reason: 'wrong_password' })
    assert.equal((await passwordRows(who.userId)).length, 1)
    assert.deepEqual(await removePassword(who.ctx, { currentPassword: GOOD }), { ok: true, value: null })
    assert.equal((await passwordRows(who.userId)).length, 0)
    assert.deepEqual(await login(who.email, GOOD), { ok: false, reason: 'invalid_credentials' })
  })
})

describe('⑤ 로그인', () => {
  test('★ 맞으면 그 사람 · 실패는 모두 같은 말 — 없는 이메일 · 비밀번호 없는 계정 · 틀린 비밀번호', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const without = await person('비밀번호 없는 사람')
    assert.equal((await setPassword(who.ctx, { newPassword: GOOD })).ok, true)

    assert.deepEqual(await login(who.email, GOOD), { ok: true, value: { userId: who.userId, email: who.email } })
    const invalid = { ok: false, reason: 'invalid_credentials' }
    assert.deepEqual(await login(who.email, 'wrong pass 9'), invalid)
    assert.deepEqual(await login(`nobody-${randomUUID()}@example.com`, GOOD), invalid)
    assert.deepEqual(await login(without.email, GOOD), invalid)
    assert.deepEqual(await login('', ''), invalid)
    const failed = await query<{ n: number }>(`SELECT count(*)::int AS n FROM auth_event WHERE email = $1 AND kind = 'password_failed'`, [who.email])
    assert.equal(failed[0]!.n, 1, '실패가 남지 않았다')
  })

  test('★ 15분에 10번 틀리면 맞아도 막는다 — 성공 뒤에는 다시 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    assert.equal((await setPassword(who.ctx, { newPassword: GOOD })).ok, true)
    for (let i = 0; i < PASSWORD_FAILURE_LIMIT; i += 1) assert.equal((await login(who.email, `wrong pass ${i}`)).ok, false)
    assert.deepEqual(await login(who.email, GOOD), { ok: false, reason: 'too_many_attempts' })

    // 다른 길(로그인 코드)로 들어오면 그 뒤의 실패만 센다
    await query(`INSERT INTO auth_event (at, email, user_id, kind) VALUES (now(), $1, $2, 'login_succeeded')`, [who.email, who.userId])
    assert.equal((await login(who.email, GOOD)).ok, true)

    // 15분이 지난 실패는 세지 않는다
    const other = await person()
    assert.equal((await setPassword(other.ctx, { newPassword: GOOD })).ok, true)
    for (let i = 0; i < PASSWORD_FAILURE_LIMIT; i += 1) await login(other.email, `wrong pass ${i}`)
    await query(`UPDATE auth_event SET at = at - interval '16 minutes' WHERE email = $1 AND kind = 'password_failed'`, [other.email])
    assert.equal((await login(other.email, GOOD)).ok, true)
  })

  test('⑥ 옛 매개변수로 만든 해시는 로그인에 성공할 때 새로 만든다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const salt = randomBytes(16)
    const tag = argon2Sync('argon2id', { message: Buffer.from(GOOD), nonce: salt, parallelism: 1, tagLength: 32, memory: 8192, passes: 1 })
    const b64 = (x: Buffer) => x.toString('base64').replace(/=+$/, '')
    await query(`INSERT INTO credential (id, user_id, kind, password_hash, created_at) VALUES ($1, $2, 'password', $3, now())`, [
      randomUUID(),
      who.userId,
      `$argon2id$v=19$m=8192,t=1,p=1$${b64(salt)}$${b64(tag)}`,
    ])
    assert.equal((await login(who.email, GOOD)).ok, true)
    assert.match((await passwordRows(who.userId))[0]!.password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    assert.equal((await login(who.email, GOOD)).ok, true, '새 해시로 들어오지 못한다')
  })
})
