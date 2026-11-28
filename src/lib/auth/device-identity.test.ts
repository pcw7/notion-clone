/**
 * 기기 표시 · "내가 아니에요" 링크의 서명 (AC-3 · F-14-08) — 정본 §3.2 [보강 AC-0] ⑭ [AC-3] · DB 없음
 *
 *   · 기기 표시는 열쇠 원문이 아니다 · 판 8 UUID(0158 의 CHECK 이 받는 모양) · 사람마다 다르다 · 같은 입력이면 같다
 *   · 링크는 서명 · 만료를 본다 — 고친 토큰 · 다른 키 · 지난 만료 · 틀린 모양은 통과하지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

import { DEVICE_REPORT_TTL_DAYS } from './constants.ts'
import { checkDeviceReport, deviceIdFor, deviceReportKey, deviceReportUrl, isDeviceKey, newDeviceKey, signDeviceReport } from './device-identity.ts'

const V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('기기 열쇠 — 43자 base64url · 모양이 아니면 받지 않는다', () => {
  const key = newDeviceKey()
  assert.ok(isDeviceKey(key))
  assert.notEqual(newDeviceKey(), key)
  for (const bad of [undefined, null, '', 'short', `${key}x`, `${key.slice(0, 42)}!`, 42]) assert.equal(isDeviceKey(bad), false, String(bad))
})

test('★ 기기 표시 — 판 8 UUID · 열쇠 원문이 아니다 · 사람마다 다르다 · 같은 입력이면 같다', () => {
  const key = newDeviceKey()
  const alice = randomUUID()
  const bob = randomUUID()
  const id = deviceIdFor(alice, key)
  assert.match(id, V8)
  assert.equal(deviceIdFor(alice, key), id, '같은 사람 · 같은 열쇠')
  assert.equal(deviceIdFor(alice.toUpperCase(), key), id, '사람 id 의 대소문자는 같다')
  assert.notEqual(deviceIdFor(bob, key), id, '한 브라우저의 두 계정이 DB 에서 이어지지 않는다')
  assert.notEqual(deviceIdFor(alice, newDeviceKey()), id, '다른 브라우저')
  assert.ok(!id.replace(/-/g, '').includes(Buffer.from(key, 'base64url').toString('hex').slice(0, 16)), '열쇠의 바이트가 그대로 남지 않는다')
})

test('★ 링크 — 서명 · 만료를 본다 · 고친 토큰 · 다른 키 · 틀린 모양은 invalid', () => {
  const key = randomBytes(32)
  const session = randomUUID()
  const now = new Date('2026-11-28T00:00:00Z')
  const token = signDeviceReport(key, session, now)
  assert.deepEqual(checkDeviceReport(key, token, now), { ok: true, sessionId: session })
  assert.deepEqual(checkDeviceReport(key, token, new Date(now.getTime() + (DEVICE_REPORT_TTL_DAYS * 86400 - 1) * 1000)), { ok: true, sessionId: session })
  assert.deepEqual(checkDeviceReport(key, token, new Date(now.getTime() + DEVICE_REPORT_TTL_DAYS * 86400 * 1000)), { ok: false, reason: 'expired' })

  const [id, expires, signature] = token.split('.') as [string, string, string]
  const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
  for (const bad of [
    `${randomUUID()}.${expires}.${signature}`, // 다른 세션
    `${id}.${Number(expires) + 86400}.${signature}`, // 만료를 늘렸다
    `${id}.${expires}.${flipped}`,
    `${id}.${expires}`,
    `${token}.extra`,
    '',
    null,
    42,
    'x'.repeat(500),
  ]) {
    assert.deepEqual(checkDeviceReport(key, bad, now), { ok: false, reason: 'invalid' }, String(bad))
  }
  assert.deepEqual(checkDeviceReport(randomBytes(32), token, now), { ok: false, reason: 'invalid' }, '다른 키')
})

test('키는 AUTH_SECRET 에서 — 없으면 던진다 · 주소는 화면의 경로', () => {
  const saved = process.env.AUTH_SECRET
  try {
    delete process.env.AUTH_SECRET
    assert.throws(() => deviceReportKey(), /AUTH_SECRET/)
    process.env.AUTH_SECRET = 'test-secret-only-for-unit-tests'
    const one = deviceReportKey()
    assert.equal(one.length, 32)
    process.env.AUTH_SECRET = 'another-secret'
    assert.notDeepEqual(deviceReportKey(), one)
  } finally {
    if (saved === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = saved
  }
  assert.equal(deviceReportUrl('http://localhost:3000/', 'a.b.c'), 'http://localhost:3000/account/not-me?t=a.b.c')
})
