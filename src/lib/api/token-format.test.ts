/**
 * 공개 API 개인 토큰의 모양 — 값 · 엔트로피 · 해시 · 이름 · 만료 (API-1 · F-09-02 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① — `ntn_` · 저장은 해시만
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hashSessionToken } from '../auth/session-context.ts'
import {
  API_TOKEN_BODY_LENGTH,
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  API_TOKEN_PREFIX,
  apiTokenLast4,
  isApiTokenShape,
  newApiToken,
  normalizeTokenName,
  parseExpiryDays,
  randomBase62,
} from './token-format.ts'

test('★ 값 — ntn_ + base62 46자(40자 이상) · 모양 검사를 지난다', () => {
  const token = newApiToken()
  assert.ok(token.startsWith(API_TOKEN_PREFIX))
  assert.equal(token.length, API_TOKEN_PREFIX.length + API_TOKEN_BODY_LENGTH)
  assert.ok(API_TOKEN_BODY_LENGTH >= 40)
  assert.match(token.slice(API_TOKEN_PREFIX.length), /^[0-9A-Za-z]+$/)
  assert.ok(isApiTokenShape(token))
})

test('★ 엔트로피 — 46자 × log2(62) ≥ 256비트 · 1000개가 모두 다르다 · 62글자가 고르게 나온다', () => {
  assert.ok(API_TOKEN_BODY_LENGTH * Math.log2(62) >= 256)
  const many = new Set(Array.from({ length: 1000 }, () => newApiToken()))
  assert.equal(many.size, 1000)
  // 글자 분포 — 62 × 1000 개를 뽑으면 글자마다 평균 1000 번. 나머지 치우침(256 % 62)이 있으면 앞 8글자가 눈에 띄게 많다
  const counts = new Map<string, number>()
  for (const ch of randomBase62(62_000)) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  assert.equal(counts.size, 62)
  for (const [ch, n] of counts) assert.ok(n > 800 && n < 1200, `${ch}: ${n}`)
})

test('모양 검사 — 접두 · 길이 · 글자가 틀리면 거짓', () => {
  const body = 'a'.repeat(API_TOKEN_BODY_LENGTH)
  assert.ok(isApiTokenShape(`ntn_${body}`))
  for (const bad of ['', 'ntn_', `secret_${body}`, `ntn_${body}x`, `ntn_${body.slice(1)}`, `ntn_${body.slice(1)}-`, ` ntn_${body}`, `NTN_${body}`]) {
    assert.ok(!isApiTokenShape(bad), bad)
  }
})

test('★ 해시 — 세션 토큰과 같은 sha256 hex(64자) · 같은 값은 같은 해시 · 평문을 담지 않는다', () => {
  const token = newApiToken()
  const hash = hashSessionToken(token)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hashSessionToken(token), hash)
  assert.notEqual(hashSessionToken(newApiToken()), hash)
  assert.ok(!hash.includes(token.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + 8)))
  assert.equal(apiTokenLast4(token), token.slice(-4))
})

test('이름 — 공백을 접고 자른다 · 비었거나 100자 넘으면 null', () => {
  assert.equal(normalizeTokenName('  배포\n 스크립트  '), '배포 스크립트')
  assert.equal(normalizeTokenName('가'.repeat(100)), '가'.repeat(100))
  assert.equal(normalizeTokenName('가'.repeat(101)), null)
  assert.equal(normalizeTokenName('   '), null)
  assert.equal(normalizeTokenName(3), null)
})

test('만료 — 빠지면 1년 · null 은 없음 · 고를 수 있는 일수만', () => {
  assert.equal(parseExpiryDays(undefined), API_TOKEN_DEFAULT_EXPIRY_DAYS)
  assert.equal(parseExpiryDays(null), null)
  assert.equal(parseExpiryDays(30), 30)
  for (const bad of [0, 1, 366, '30', 30.5, -7]) assert.equal(parseExpiryDays(bad), 'invalid', String(bad))
})
