/**
 * 로그인한 기기 — 목록 · 하나씩 · 다른 모든 기기 · 새 기기 알림 · "내가 아니에요" (AC-3 · F-14-08 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3]
 *
 * 이 파일이 지키는 것.
 *
 *   ① 목록 · 끊기는 **자기 세션만** — 남의 세션 id 는 없는 것과 같은 `not_found` 이고 그 세션은 그대로 산다
 *   ② 끊은 세션의 **다음 해석이 실패한다**(캐시 없음) · 그 사람의 연결을 다시 보라는 신호(0016 · `user:<id>`)가 나간다
 *   ③ 다른 모든 기기 — 이 세션만 남는다 · API 토큰 · 남의 세션은 그대로
 *   ④ 새 기기 — 처음 보는 기기면 알림이 **한 번** · 같은 기기는 다시 알리지 않는다 · 스스로 끝낸 세션은 보증하고 다른 곳에서 끊은 세션은
 *      보증하지 않는다 · 가입은 알리지 않는다
 *   ⑤ "내가 아니에요" — 그 사람의 모든 세션 폐기(`user_reported`) · 한 번만 · 미리보기는 바꾸지 않는다 · 고친 토큰은 거부
 *   ⑥ 위임 · API 토큰 컨텍스트는 셋 다 `session_required`
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { createApiToken } from '../api/api-token.ts'
import { openChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import type { WorkspaceId } from '../ids.ts'
import { consoleOutbox } from './account-mailer.ts'
import { deviceIdFor, newDeviceKey } from './device-identity.ts'
import { listDevices, previewDeviceReport, reportNewDevice, signOutDevice, signOutOtherDevices } from './devices.ts'
import { establishLogin } from './establish-login.ts'
import { revokeSession } from './session.ts'
import { resolveSessionContext, type SessionContext } from './session-context.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let workspaceId: WorkspaceId

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  workspaceId = await createBareWorkspace()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

const person = async (name = '기기의 사람') => joinAs(workspaceId, await createUser(name), 'member')

/** 그 사람으로 실제 로그인 길(`establishLogin`)을 지나 세션을 하나 더 연다 — 기기 열쇠 · User-Agent · IP 를 준다. */
async function loginAs(who: Actor, opts: { deviceKey?: string | null; userAgent?: string; ip?: string | null } = {}) {
  const login = await establishLogin({
    email: who.email,
    existingUserId: who.userId,
    authMethod: 'login_code',
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? CHROME,
    deviceKey: opts.deviceKey === undefined ? newDeviceKey() : opts.deviceKey,
    appUrl: 'http://localhost:3000',
  })
  const resolved = await resolveSessionContext(login.session.token, workspaceId)
  if (!resolved.ok) throw new Error(`로그인한 세션이 풀리지 않는다: ${resolved.reason}`)
  return { token: login.session.token, ctx: resolved.context, sessionId: login.session.sessionId }
}

const alertsTo = (email: string) => consoleOutbox().filter((n) => n.kind === 'new_device_login' && n.to.toLowerCase() === email.toLowerCase())
const reasonOf = async (sessionId: string) =>
  (await queryOne<{ revoked_reason: string | null }>(`SELECT revoked_reason FROM user_session WHERE id = $1`, [sessionId])).revoked_reason
const resolves = async (token: string) => (await resolveSessionContext(token, workspaceId)).ok

describe('로그인한 기기 (AC-3 · F-14-08)', () => {
  test('★ ① 목록은 자기 세션만 — 이 세션이 맨 위("이 기기") · 기기 이름 · 가린 IP · 남의 세션은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const other = await person('남')
    const phone = await loginAs(who, { userAgent: IPHONE, ip: '203.0.113.77' })
    await loginAs(other)

    const listed = await listDevices(phone.ctx)
    assert.ok(listed.ok)
    const ids = listed.value.map((d) => d.id)
    assert.deepEqual(new Set(ids), new Set([who.ctx.sessionId, phone.sessionId]), '그 사람의 살아 있는 세션 둘만')
    assert.equal(listed.value[0]?.id, phone.sessionId, '이 세션이 맨 위')
    assert.deepEqual(listed.value.map((d) => d.current), [true, false])
    const top = listed.value[0]!
    assert.equal(top.label, 'Safari · iOS')
    assert.equal(top.form, 'phone')
    assert.equal(top.place, '203.0.113.* 네트워크', '가린 IP — 온전한 IP 는 화면에 가지 않는다')
    assert.ok(!JSON.stringify(listed.value).includes('203.0.113.77'))
    assert.equal(listed.value[1]?.label, '알 수 없는 기기', '시험 도우미의 세션(node:test)')
  })

  test('★ ② 하나씩 — 그 세션의 다음 해석이 실패한다 · 이 세션은 산다 · 그 사람의 연결을 다시 보라는 신호가 나간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const laptop = await loginAs(who)

    const signals: CollabSignal[] = []
    const feed = await openChangeFeed({ onSignal: (s) => signals.push(s), onResync: () => {} })
    t.after(() => feed.close())

    assert.deepEqual(await signOutDevice(who.ctx, { sessionId: laptop.sessionId }), { ok: true, value: null })
    assert.deepEqual(await resolveSessionContext(laptop.token, workspaceId), { ok: false, reason: 'revoked' }, '끊은 세션의 다음 요청은 401')
    assert.equal(await resolves(who.token), true, '이 세션은 그대로')
    assert.equal(await reasonOf(laptop.sessionId), 'device_signed_out')

    const deadline = Date.now() + 10_000
    while (!signals.some((s) => s.kind === 'session' && s.userId === who.userId) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    assert.ok(signals.some((s) => s.kind === 'session' && s.userId === who.userId), '협업 서버 · 표 변경 허브가 듣는 user:<id> 신호(0016)')

    assert.deepEqual(await signOutDevice(who.ctx, { sessionId: laptop.sessionId }), { ok: false, reason: 'not_found' }, '이미 끝난 세션')
    assert.deepEqual(await signOutDevice(who.ctx, { sessionId: who.ctx.sessionId }), { ok: false, reason: 'current_session' })
    assert.deepEqual(await signOutDevice(who.ctx, { sessionId: 'nope' }), { ok: false, reason: 'not_found' })
    const audit = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event WHERE actor_user_id = $1 AND event_type = 'account.security_changed' AND metadata ->> 'change' = 'device_signed_out'`,
      [who.userId],
    )
    assert.equal(audit.n, 1, '감사 한 줄(끊은 수만)')
  })

  test('★ ① 남의 세션 id 를 알아도 끊지 못한다 — 없는 세션과 같은 not_found · 그 세션은 산다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const victim = await person('남')
    assert.deepEqual(await signOutDevice(who.ctx, { sessionId: victim.ctx.sessionId }), { ok: false, reason: 'not_found' })
    assert.equal(await resolves(victim.token), true)
    assert.equal(await reasonOf(victim.ctx.sessionId), null)
  })

  test('★ ③ 다른 모든 기기 — 이 세션만 남는다 · API 토큰 · 남의 세션은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const other = await person('남')
    const second = await loginAs(who)
    const third = await loginAs(who)
    const token = await createApiToken(who.ctx, { name: '배포 스크립트' })
    assert.ok(token.ok)

    const result = await signOutOtherDevices(second.ctx)
    assert.deepEqual(result, { ok: true, value: { revokedSessions: 2 } })
    assert.equal(await resolves(second.token), true, '이 세션은 산다')
    assert.equal(await resolves(who.token), false)
    assert.equal(await resolves(third.token), false)
    assert.equal(await reasonOf(third.sessionId), 'other_devices_signed_out')
    assert.equal(await resolves(other.token), true, '남의 세션은 그대로')
    assert.equal((await resolveSessionContext({ apiToken: token.value.token })).ok, true, 'API 토큰은 그대로(정본 ⑫)')
    assert.deepEqual(await signOutOtherDevices(second.ctx), { ok: true, value: { revokedSessions: 0 } }, '남은 다른 기기가 없어도 성공')
    const listed = await listDevices(second.ctx)
    assert.ok(listed.ok && listed.value.length === 1 && listed.value[0]?.current === true)
  })

  test('★ ④ 새 기기 — 알림은 한 번 · 같은 기기는 다시 알리지 않는다 · 기기 표시는 열쇠의 해시', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const key = newDeviceKey()
    const before = alertsTo(who.email).length

    const first = await loginAs(who, { deviceKey: key, ip: '198.51.100.20' })
    const alerts = alertsTo(who.email).slice(before)
    assert.equal(alerts.length, 1, '처음 보는 기기 — 대표 주소로 한 번')
    const alert = alerts[0]!
    assert.ok(alert.kind === 'new_device_login')
    assert.equal(alert.device, 'Chrome · Windows')
    assert.equal(alert.place, '198.51.100.* 네트워크')
    assert.match(String(alert.reportUrl), /^http:\/\/localhost:3000\/account\/not-me\?t=/)
    const stored = await queryOne<{ device_id: string }>(`SELECT device_id FROM user_session WHERE id = $1`, [first.sessionId])
    assert.equal(stored.device_id, deviceIdFor(who.userId, key), '열쇠 원문이 아니라 해시')
    const listed = await listDevices(first.ctx)
    assert.ok(listed.ok && listed.value.find((d) => d.id === first.sessionId)?.newDevice === true, '앱 안의 "새 기기" 표지')

    await loginAs(who, { deviceKey: key })
    assert.equal(alertsTo(who.email).length - before, 1, '같은 기기 — 다시 알리지 않는다')

    // 그 기기가 스스로 끝낸 세션도 보증한다 — 로그아웃 뒤 다시 들어와도 알리지 않는다
    await query(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'user_logout' WHERE user_id = $1 AND device_id = $2`, [who.userId, stored.device_id])
    await loginAs(who, { deviceKey: key })
    assert.equal(alertsTo(who.email).length - before, 1, '로그아웃했던 같은 기기')

    await loginAs(who)
    assert.equal(alertsTo(who.email).length - before, 2, '다른 기기 — 또 한 번')
  })

  test('★ ④ 다른 곳에서 끊은 기기 · 30일 넘게 안 쓴 기기는 보증하지 않는다 · 가입은 알리지 않는다 · 열쇠가 없으면 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const key = newDeviceKey()
    const stolen = await loginAs(who, { deviceKey: key })
    const before = alertsTo(who.email).length
    assert.ok((await signOutDevice(who.ctx, { sessionId: stolen.sessionId })).ok)
    const back = await loginAs(who, { deviceKey: key })
    assert.equal(alertsTo(who.email).length - before, 1, '끊은 기기가 다시 들어오면 다시 알린다')

    await query(`UPDATE user_session SET last_seen_at = now() - interval '31 days' WHERE id = $1`, [back.sessionId])
    await loginAs(who, { deviceKey: key })
    assert.equal(alertsTo(who.email).length - before, 2, '30일 넘게 안 쓴 기기')

    await loginAs(who, { deviceKey: null })
    assert.equal(alertsTo(who.email).length - before, 2, '열쇠가 없으면(내부 호출) 알리지 않는다')

    const email = `ac3-signup-${randomUUID().slice(0, 8)}@example.com`
    const signup = await establishLogin({ email, existingUserId: null, authMethod: 'login_code', ip: null, userAgent: CHROME, deviceKey: newDeviceKey() })
    assert.equal(signup.created, true)
    assert.equal(alertsTo(email).length, 0, '가입(첫 세션)은 알리지 않는다')
  })

  test('★ ⑤ "내가 아니에요" — 그 사람의 모든 세션 폐기 · 한 번만 · 미리보기는 바꾸지 않는다 · 고친 토큰 · 지난 링크는 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const other = await person('남')
    const before = alertsTo(who.email).length
    const intruder = await loginAs(who, { userAgent: IPHONE })
    const mine = await loginAs(who)
    const reportUrl = alertsTo(who.email).slice(before).at(0)
    assert.ok(reportUrl?.kind === 'new_device_login' && reportUrl.reportUrl !== null)
    const token = new URL(reportUrl.reportUrl).searchParams.get('t')

    const preview = await previewDeviceReport(token)
    assert.deepEqual(preview.ok && preview.value.device, 'Safari · iOS')
    assert.equal(await resolves(intruder.token), true, '미리보기(GET)는 아무것도 바꾸지 않는다')

    assert.deepEqual(await reportNewDevice(`${token}x`), { ok: false, reason: 'invalid' })
    assert.deepEqual(await reportNewDevice(token, new Date(Date.now() + 8 * 86400 * 1000)), { ok: false, reason: 'expired' })
    assert.equal(await resolves(intruder.token), true)

    const reported = await reportNewDevice(token)
    assert.deepEqual(reported, { ok: true, value: { revokedSessions: 3, hasPassword: false } }, '그 사람의 세션 셋 모두')
    for (const s of [intruder, mine]) {
      assert.equal(await resolves(s.token), false)
      assert.equal(await reasonOf(s.sessionId), 'user_reported')
    }
    assert.equal(await resolves(who.token), false)
    assert.equal(await resolves(other.token), true, '남은 그대로')

    assert.deepEqual(await reportNewDevice(token), { ok: false, reason: 'already_used' }, '한 번만')
    assert.deepEqual(await previewDeviceReport(token), { ok: false, reason: 'already_used' })

    // 신고한 기기는 보증하지 않는다 — 그 열쇠로 다시 들어와도 알린다(세션이 user_reported 로 끝났다)
    const intruderDevice = await queryOne<{ device_id: string }>(`SELECT device_id FROM user_session WHERE id = $1`, [intruder.sessionId])
    const known = await withTransaction(async (tx) => (await import('./devices.ts')).isKnownDevice(tx, who.userId, intruderDevice.device_id))
    assert.equal(known, false)
  })

  test('★ ⑥ 위임 · API 토큰 컨텍스트는 목록 · 하나씩 · 다른 모두 셋 다 session_required', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const laptop = await loginAs(who)
    const contexts = [
      { ...who.ctx, apiToken: { tokenId: randomUUID() } },
      { ...who.ctx, delegation: { automationId: randomUUID() } },
    ] as SessionContext[]
    for (const ctx of contexts) {
      assert.deepEqual(await listDevices(ctx), { ok: false, reason: 'session_required' })
      assert.deepEqual(await signOutDevice(ctx, { sessionId: laptop.sessionId }), { ok: false, reason: 'session_required' })
      assert.deepEqual(await signOutOtherDevices(ctx), { ok: false, reason: 'session_required' })
    }
    assert.equal(await resolves(laptop.token), true, '아무것도 끊지 않았다')
  })

  test('마지막 활동 — 해석이 5분에 한 번만 쓴다 · 끊긴 세션은 건드리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await person()
    const seen = async () => (await queryOne<{ at: Date }>(`SELECT last_seen_at AS at FROM user_session WHERE id = $1`, [who.ctx.sessionId])).at.getTime()
    await query(`UPDATE user_session SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, [who.ctx.sessionId])
    const stale = await seen()
    await resolveSessionContext(who.token, workspaceId)
    const touched = await seen()
    assert.ok(touched - stale > 50 * 60 * 1000, '한 시간 묵은 마지막 활동을 지금으로')
    await query(`UPDATE user_session SET last_seen_at = last_seen_at - interval '1 minute' WHERE id = $1`, [who.ctx.sessionId])
    const minuteAgo = await seen()
    await resolveSessionContext(who.token, workspaceId)
    assert.equal(await seen(), minuteAgo, '5분 안이면 쓰지 않는다')

    await query(`UPDATE user_session SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, [who.ctx.sessionId])
    await revokeSession(who.token)
    const revokedAt = await seen()
    await resolveSessionContext(who.token, workspaceId)
    assert.equal(await seen(), revokedAt, '끊긴 세션은 해석이 실패하고 쓰지 않는다')
  })
})
