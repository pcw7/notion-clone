/**
 * 2단계 인증 — 잔여 묶음 8i-2a (F-14-05)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 켜기 — 비밀번호가 먼저 · 시작하면 봉인한 비밀값 · 틀린 코드는 거부 · 맞으면 백업 코드 6개(처음 한 번) · 이 세션은 통과
 *   ② **진입 게이트** — 켠 사람의 다른 세션은 둘째 단계를 거칠 때까지 워크스페이스 · 밖의 사람 신원 어느 쪽으로도 들어오지 못한다
 *   ③ **재사용 막기** — 쓴 TOTP 창과 그 앞은 다시 받지 않는다 · 쓴 백업 코드도
 *   ④ 실패는 남고 15분에 10번이면 맞아도 막는다
 *   ⑤ TOTP 는 둘까지 · 둘째부터는 백업 코드가 새로 생기지 않는다 · 30분이 지난 등록은 없다
 *   ⑥ 끄기 — 지금 코드로 · 마지막 수단이면 백업 코드도 지우고 게이트가 풀린다 · 그러면 비밀번호를 지울 수 있다
 *   ⑦ 백업 코드 새로 받기 — 옛 묶음은 못 쓴다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createBareWorkspace, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createSession } from './session.ts'
import { resolveSessionContext } from './session-context.ts'
import { resolveOutsiderContext } from './outsider-context.ts'
import { removePassword, setPassword } from './password.ts'
import { base32Decode, totpAt, totpStepAt } from './totp.ts'
import {
  MFA_FAILURE_LIMIT,
  confirmTotpEnrollment,
  mfaStatus,
  regenerateBackupCodes,
  removeMfaMethod,
  startTotpEnrollment,
  verifySecondFactor,
} from './mfa.ts'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 비밀번호를 정한 새 사람. */
const person = async (name = '2단계 인증의 사람') => {
  const user = await createUser(name)
  const who = await joinAs(fx.workspaceId, user, 'member')
  unwrap(await setPassword(who.ctx, { newPassword: 'correct horse 1' }))
  return { user, who }
}

/** 등록한 수단의 비밀값으로 이 창(지금 + offset)의 코드. */
const codeOf = (secret: string, offset = 0) => totpAt(base32Decode(secret)!, totpStepAt(Date.now()) + offset)

/** 켠다 — 시작 · 확정. 비밀값과 백업 코드. */
const enable = async (who: Actor, label?: string) => {
  const started = unwrap(await startTotpEnrollment(who.ctx, { label }))
  const confirmed = unwrap(await confirmTotpEnrollment(who.ctx, started.methodId, codeOf(started.secret)))
  return { ...started, backupCodes: confirmed.backupCodes }
}

const second = (who: { readonly token: string }, code: string) =>
  verifySecondFactor({ token: who.token, code, ip: null, userAgent: 'node:test' })

/**
 * 같은 사람의 다른 기기 — 첫 단계만 거친 세션의 토큰. 픽스처(`joinAs`)는 세션을 만든 뒤 SessionContext 를 받으려 해 게이트에 막힌다
 * (그것이 이 파일이 지키는 것이다) — 토큰만 만든다.
 */
const pendingSession = async (userId: string) => ({
  token: (
    await withTransaction((tx) =>
      createSession(tx, { userId, authMethod: 'password', mfaSatisfied: false, ip: null, userAgent: 'node:test' }),
    )
  ).token,
})

describe('① 켜기', () => {
  test('★ 비밀번호가 먼저 · 비밀값은 봉인된다 · 틀린 코드는 거부 · 맞으면 백업 코드 6개 · 이 세션은 통과', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const bare = await joinAs(fx.workspaceId, await createUser('비밀번호 없는 사람'), 'member')
    assert.deepEqual(await startTotpEnrollment(bare.ctx, {}), { ok: false, reason: 'password_required' })

    const { who } = await person()
    const started = unwrap(await startTotpEnrollment(who.ctx, { label: ' 내 휴대폰 ' }))
    const row = await query<{ totp_secret: Buffer; label: string; confirmed_at: Date | null }>(
      `SELECT totp_secret, label, confirmed_at FROM mfa_method WHERE id = $1`,
      [started.methodId],
    )
    assert.equal(row[0]!.label, '내 휴대폰')
    assert.equal(row[0]!.confirmed_at, null)
    assert.ok(!row[0]!.totp_secret.includes(base32Decode(started.secret)!), '비밀값이 봉인되지 않았다')
    assert.match(started.uri, /^otpauth:\/\/totp\//)
    assert.equal((await mfaStatus(who.ctx)).enabled, false, '확정 전인데 켜졌다')

    assert.deepEqual(await confirmTotpEnrollment(who.ctx, started.methodId, '000000'), { ok: false, reason: 'invalid_code' })
    const confirmed = unwrap(await confirmTotpEnrollment(who.ctx, started.methodId, codeOf(started.secret)))
    assert.equal(confirmed.backupCodes?.length, 6)
    const status = await mfaStatus(who.ctx)
    assert.equal(status.enabled, true)
    assert.equal(status.backupCodesLeft, 6)
    assert.deepEqual(status.methods.map((m) => m.label), ['내 휴대폰'])
    assert.equal((await resolveSessionContext(who.token, fx.workspaceId)).ok, true, '켠 세션이 막혔다')
  })
})

describe('② 진입 게이트', () => {
  test('★ 켠 사람의 다른 세션은 둘째 단계 전에는 어디로도 들어오지 못한다 — 통과하면 들어온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { user, who } = await person()
    const { secret } = await enable(who)
    const other = await pendingSession(user.userId)
    assert.deepEqual(await resolveSessionContext(other.token, fx.workspaceId), { ok: false, reason: 'mfa_required' })
    // 밖의 사람의 신원(멤버가 아닌 워크스페이스)도 막힌다
    const elsewhere = await createBareWorkspace('2단계 인증의 다른 곳')
    assert.equal(await resolveOutsiderContext(other.token, elsewhere), null)

    assert.deepEqual(await second(other, codeOf(secret, 1)), { ok: true, value: { via: 'totp' } })
    assert.equal((await resolveSessionContext(other.token, fx.workspaceId)).ok, true)
    assert.notEqual(await resolveOutsiderContext(other.token, elsewhere), null)
    // 이미 통과한 세션 · 꺼진 사람은 할 일이 없다
    assert.deepEqual(await second(other, 'whatever'), { ok: true, value: { via: 'already' } })
    assert.deepEqual(await second({ ...other, token: 'no-such-token' }, '123456'), { ok: false, reason: 'no_session' })
  })

  test('2단계 인증이 없는 사람의 세션은 그대로 들어온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { who } = await person()
    assert.equal((await resolveSessionContext(who.token, fx.workspaceId)).ok, true)
  })
})

describe('③ 재사용 막기', () => {
  test('★ 쓴 TOTP 창과 그 앞은 다시 받지 않는다 · 쓴 백업 코드도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { user, who } = await person()
    const { secret, backupCodes } = await enable(who)
    const other = await pendingSession(user.userId)
    // 확정에 쓴 창(지금)과 그 앞은 거부된다
    assert.deepEqual(await second(other, codeOf(secret, 0)), { ok: false, reason: 'invalid_code' })
    assert.deepEqual(await second(other, codeOf(secret, -1)), { ok: false, reason: 'invalid_code' })

    const code = backupCodes![0]!
    assert.deepEqual(await second(other, code.toUpperCase()), { ok: true, value: { via: 'backup' } })
    const third = await pendingSession(user.userId)
    assert.deepEqual(await second(third, code), { ok: false, reason: 'invalid_code' }, '쓴 백업 코드를 다시 받았다')
    assert.equal((await mfaStatus(who.ctx)).backupCodesLeft, 5)
  })
})

describe('④ 실패 제한', () => {
  test('★ 실패는 남고 15분에 10번이면 맞아도 막는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { user, who } = await person()
    const { backupCodes } = await enable(who)
    const other = await pendingSession(user.userId)
    for (let i = 0; i < MFA_FAILURE_LIMIT; i += 1) assert.equal((await second(other, '000000')).ok, false)
    const failed = await query<{ n: number }>(`SELECT count(*)::int AS n FROM auth_event WHERE user_id = $1 AND kind = 'mfa_failed'`, [user.userId])
    assert.equal(failed[0]!.n, MFA_FAILURE_LIMIT)
    assert.deepEqual(await second(other, backupCodes![0]!), { ok: false, reason: 'too_many_attempts' })
    assert.deepEqual(await resolveSessionContext(other.token, fx.workspaceId), { ok: false, reason: 'mfa_required' })
  })
})

describe('⑤ 수단의 수 · 등록의 수명', () => {
  test('TOTP 는 둘까지 · 둘째는 백업 코드를 새로 만들지 않는다 · 30분이 지난 등록은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { who } = await person()
    const first = await enable(who, '휴대폰')
    const started = unwrap(await startTotpEnrollment(who.ctx, { label: '태블릿' }))
    const confirmed = unwrap(await confirmTotpEnrollment(who.ctx, started.methodId, codeOf(started.secret)))
    assert.equal(confirmed.backupCodes, null, '둘째 수단이 백업 코드를 새로 만들었다')
    assert.equal(first.backupCodes?.length, 6)
    assert.deepEqual(await startTotpEnrollment(who.ctx, {}), { ok: false, reason: 'too_many_methods' })

    const { who: late } = await person()
    const pending = unwrap(await startTotpEnrollment(late.ctx, {}))
    await query(`UPDATE mfa_method SET created_at = now() - interval '31 minutes' WHERE id = $1`, [pending.methodId])
    assert.deepEqual(await confirmTotpEnrollment(late.ctx, pending.methodId, codeOf(pending.secret)), { ok: false, reason: 'not_found' })
    assert.deepEqual(await startTotpEnrollment(late.ctx, { label: 'x'.repeat(41) }), { ok: false, reason: 'invalid_label' })
  })
})

describe('⑥ 끄기', () => {
  test('★ 지금 코드로 지운다 · 마지막이면 백업 코드도 지우고 게이트가 풀린다 · 그러면 비밀번호를 지울 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { user, who } = await person()
    const { methodId, backupCodes } = await enable(who)
    assert.deepEqual(await removePassword(who.ctx, { currentPassword: 'correct horse 1' }), { ok: false, reason: 'mfa_enabled' })
    assert.deepEqual(await removeMfaMethod(who.ctx, methodId, '000000'), { ok: false, reason: 'invalid_code' })
    assert.deepEqual(await removeMfaMethod(who.ctx, methodId, backupCodes![1]!), { ok: true, value: { disabled: true } })
    const status = await mfaStatus(who.ctx)
    assert.deepEqual([status.enabled, status.backupCodesLeft], [false, 0])
    const other = await joinAs(fx.workspaceId, user, 'member')
    assert.equal((await resolveSessionContext(other.token, fx.workspaceId)).ok, true, '꺼졌는데 게이트가 남았다')
    assert.deepEqual(await removePassword(who.ctx, { currentPassword: 'correct horse 1' }), { ok: true, value: null })
  })
})

describe('⑦ 백업 코드 새로 받기', () => {
  test('옛 묶음은 못 쓰고 새 묶음은 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { user, who } = await person()
    const { backupCodes: oldCodes } = await enable(who)
    const fresh = unwrap(await regenerateBackupCodes(who.ctx, oldCodes![0]!)).backupCodes
    assert.equal(fresh.length, 6)
    const other = await pendingSession(user.userId)
    assert.deepEqual(await second(other, oldCodes![1]!), { ok: false, reason: 'invalid_code' })
    assert.deepEqual(await second(other, fresh[0]!), { ok: true, value: { via: 'backup' } })
  })
})
