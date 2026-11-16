/**
 * 공개 API `/v1` 의 규약 — 헤더 · 오류 모양 · 제한의 셈 (API-1 · F-09-05 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  API_MAX_BODY_BYTES,
  API_RATE_RULE,
  NOTION_VERSION,
  apiErrorBody,
  bearerToken,
  checkNotionVersion,
  retryAfterSeconds,
} from './v1-protocol.ts'

test('★ Bearer — 방식 이름은 대소문자 무관 · 다른 방식 · 빈 값 · 토큰 안의 공백은 null', () => {
  assert.equal(bearerToken('Bearer ntn_abc'), 'ntn_abc')
  assert.equal(bearerToken('bearer   ntn_abc  '), 'ntn_abc')
  assert.equal(bearerToken('BEARER ntn_abc'), 'ntn_abc')
  for (const bad of [null, undefined, '', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', 'Bearer a b', 'ntn_abc', 'Token ntn_abc', ' Bearer ntn_abc']) {
    assert.equal(bearerToken(bad), null, String(bad))
  }
})

test('★ Notion-Version — 없으면 missing_version · 다른 판은 invalid_request(받는 판을 말한다) · 2025-09-03 만', () => {
  assert.deepEqual(checkNotionVersion(NOTION_VERSION), { ok: true })
  assert.deepEqual(checkNotionVersion(` ${NOTION_VERSION} `), { ok: true })
  for (const missing of [null, undefined, '', '  ']) {
    const r = checkNotionVersion(missing)
    assert.ok(!r.ok && r.code === 'missing_version', String(missing))
  }
  const old = checkNotionVersion('2022-06-28')
  assert.ok(!old.ok && old.code === 'invalid_request' && old.message.includes(NOTION_VERSION) && old.message.includes('2022-06-28'))
  const long = checkNotionVersion('x'.repeat(500))
  assert.ok(!long.ok && long.message.length < 200, '받은 값을 다 되풀이하지 않는다')
})

test('★ 오류 모양 — 노션의 다섯 칸 그대로', () => {
  assert.deepEqual(apiErrorBody(404, 'object_not_found', 'Could not find.', 'req-1'), {
    object: 'error',
    status: 404,
    code: 'object_not_found',
    message: 'Could not find.',
    request_id: 'req-1',
  })
  assert.deepEqual(Object.keys(apiErrorBody(401, 'unauthorized', 'x', 'r')), ['object', 'status', 'code', 'message', 'request_id'])
})

test('★ 제한의 셈 — 평균 초당 3번 · 몰림은 한 창 안에서 · Retry-After 는 1초 이상의 정수 · 본문 500KB', () => {
  assert.equal(API_RATE_RULE.limit / API_RATE_RULE.windowSeconds, 3)
  assert.ok(API_RATE_RULE.limit > 3, '짧은 몰림을 받는다')
  assert.equal(retryAfterSeconds(4), 4)
  assert.equal(retryAfterSeconds(2.2), 3)
  assert.equal(retryAfterSeconds(0), 1)
  assert.equal(retryAfterSeconds(-2), 1)
  assert.equal(retryAfterSeconds(Number.NaN), API_RATE_RULE.windowSeconds)
  assert.equal(API_MAX_BODY_BYTES, 500 * 1024)
})
