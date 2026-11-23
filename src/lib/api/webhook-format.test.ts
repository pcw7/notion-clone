/**
 * 공개 API 웹훅의 모양 — 서명 · 확인 토큰 · 다시 보내기 표 · 봉투 · 받는 주소 (API-8 · F-09-09 · 단위)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_DISABLE_AFTER_FAILED_EVENTS,
  buildWebhookEnvelope,
  checkWebhookUrl,
  MAX_WEBHOOK_ATTEMPTS,
  MAX_WEBHOOKS_PER_TOKEN,
  MAX_WEBHOOKS_PER_WORKSPACE,
  newVerificationToken,
  NOMINAL_RETRY_DELAYS_MS,
  shortFailure,
  signWebhookBody,
  verificationTokenMatches,
  verifyWebhookSignature,
  webhookRetryDelayMs,
} from './webhook-format.ts'

test('★ 서명 — HMAC-SHA256 의 알려진 벡터(RFC 4231 시험 2) · `sha256=<hex>` 모양', () => {
  assert.equal(
    signWebhookBody('what do ya want for nothing?', 'Jefe'),
    'sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  )
})

test('★ 받는 쪽의 검사 — 같은 본문 · 비밀만 맞다(한 글자라도 다르면 · 비밀이 다르면 · 머리가 없으면 거짓)', () => {
  const body = JSON.stringify({ id: 'e1', type: 'test', data: { 한글: '값' } })
  const header = signWebhookBody(body, 'secret_abc')
  assert.equal(verifyWebhookSignature(body, header, 'secret_abc'), true)
  assert.equal(verifyWebhookSignature(body, ` ${header} `, 'secret_abc'), true, '앞뒤 공백은 뗀다')
  assert.equal(verifyWebhookSignature(`${body} `, header, 'secret_abc'), false)
  assert.equal(verifyWebhookSignature(body, header, 'secret_abd'), false)
  assert.equal(verifyWebhookSignature(body, undefined, 'secret_abc'), false)
  assert.equal(verifyWebhookSignature(body, header.toUpperCase(), 'secret_abc'), false)
  assert.equal(verifyWebhookSignature(body, 'sha256=00', 'secret_abc'), false, '길이가 달라도 던지지 않는다')
})

test('★ 확인 토큰 — 노션의 `secret_…` 모양 · 매번 다르다 · 견주기는 앞뒤 공백을 떼고 · 문자열만', () => {
  const a = newVerificationToken()
  const b = newVerificationToken()
  assert.match(a, /^secret_[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
  assert.equal(verificationTokenMatches(a, a), true)
  assert.equal(verificationTokenMatches(`  ${a}\n`, a), true)
  assert.equal(verificationTokenMatches(b, a), false)
  assert.equal(verificationTokenMatches(a.slice(0, -1), a), false)
  assert.equal(verificationTokenMatches(null, a), false)
  assert.equal(verificationTokenMatches('x'.repeat(1001), a), false)
})

test('★ 다시 보내기 표 — 여덟 번 · 일곱 간격이 두 배씩 · 합이 약 24시간 · ±10% 흔들기', () => {
  assert.equal(MAX_WEBHOOK_ATTEMPTS, 8)
  assert.deepEqual(
    NOMINAL_RETRY_DELAYS_MS.map((ms) => ms / 60_000),
    [11.25, 22.5, 45, 90, 180, 360, 720],
  )
  const total = NOMINAL_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
  assert.ok(total > 23 * 3_600_000 && total < 25 * 3_600_000, `${total / 3_600_000}시간`)
  for (let n = 1; n <= 7; n += 1) {
    assert.equal(webhookRetryDelayMs(n, () => 0.5), NOMINAL_RETRY_DELAYS_MS[n - 1], `${n} 번째 — 가운데`)
    assert.equal(webhookRetryDelayMs(n, () => 0), Math.round(NOMINAL_RETRY_DELAYS_MS[n - 1]! * 0.9))
    assert.ok(webhookRetryDelayMs(n, () => 0.999999) <= Math.round(NOMINAL_RETRY_DELAYS_MS[n - 1]! * 1.1))
  }
  assert.equal(webhookRetryDelayMs(0, () => 0.5), NOMINAL_RETRY_DELAYS_MS[0], '범위 밖은 붙든다')
  assert.equal(webhookRetryDelayMs(99, () => 0.5), NOMINAL_RETRY_DELAYS_MS[6])
  assert.equal(webhookRetryDelayMs(3, () => 5), Math.round(NOMINAL_RETRY_DELAYS_MS[2]! * 1.1), '흔들기 값도 붙든다')
})

test('상한 — 토큰마다 5 · 워크스페이스마다 50 · 잇단 실패 셋이면 끈다', () => {
  assert.deepEqual([MAX_WEBHOOKS_PER_TOKEN, MAX_WEBHOOKS_PER_WORKSPACE, AUTO_DISABLE_AFTER_FAILED_EVENTS], [5, 50, 3])
})

test('★ 봉투 — 노션의 칸 · 시각은 ISO · 저자는 사람만(모양이 틀린 것은 뺀다) · data 는 객체만 · accessible_by 는 없다', () => {
  const envelope = buildWebhookEnvelope({
    eventId: 'e-1',
    occurredAt: new Date('2026-11-23T01:02:03.004Z'),
    workspaceId: 'w-1',
    workspaceName: '팀',
    subscriptionId: 's-1',
    tokenId: 't-1',
    type: 'test',
    authors: [{ id: 'u-1', type: 'bot' }, { nope: true }, 'u-2', null],
    attemptNumber: 3,
    entity: { id: 's-1', type: 'webhook_subscription' },
    data: ['not', 'object'],
  })
  assert.deepEqual(envelope, {
    id: 'e-1',
    timestamp: '2026-11-23T01:02:03.004Z',
    workspace_id: 'w-1',
    workspace_name: '팀',
    subscription_id: 's-1',
    integration_id: 't-1',
    type: 'test',
    authors: [{ id: 'u-1', type: 'person' }],
    attempt_number: 3,
    entity: { id: 's-1', type: 'webhook_subscription' },
    data: {},
  })
  assert.ok(!('accessible_by' in envelope))
  assert.deepEqual(buildWebhookEnvelope({ ...base(), data: { parent: { id: 'p' } } }).data, { parent: { id: 'p' } })
  assert.deepEqual(buildWebhookEnvelope({ ...base(), authors: 'x' }).authors, [])
})

function base() {
  return {
    eventId: 'e',
    occurredAt: new Date(0),
    workspaceId: 'w',
    workspaceName: 'n',
    subscriptionId: 's',
    tokenId: 't',
    type: 'page.created',
    authors: [],
    attemptNumber: 1,
    entity: { id: 'p', type: 'page' },
    data: {},
  }
}

test('★ 받는 주소 — 바깥 요청의 한 길과 같은 규칙: https · 기본 포트 · 사설 · 내부 이름 금지 · http 는 OUTBOUND_ALLOW_HOSTS 의 host:port 만', () => {
  const saved = process.env.OUTBOUND_ALLOW_HOSTS
  delete process.env.OUTBOUND_ALLOW_HOSTS
  try {
    const problem = (raw: unknown) => {
      const r = checkWebhookUrl(raw)
      return r.ok ? 'ok' : r.problem
    }
    assert.equal(problem('https://hooks.example.com/notion'), 'ok')
    assert.equal(problem('  https://hooks.example.com/notion  '), 'ok', '앞뒤 공백은 뗀다')
    assert.equal(problem('http://hooks.example.com/notion'), 'not_https')
    assert.equal(problem('https://hooks.example.com:8443/x'), 'port')
    assert.equal(problem('https://user:pw@hooks.example.com/x'), 'credentials')
    assert.equal(problem('https://10.1.2.3/x'), 'private_host')
    assert.equal(problem('https://169.254.169.254/latest'), 'private_host')
    assert.equal(problem('https://[::1]/x'), 'private_host')
    assert.equal(problem('https://localhost/x'), 'private_host')
    assert.equal(problem('https://intranet/x'), 'private_host')
    assert.equal(problem('http://127.0.0.1:3999/hook'), 'not_https', '허용 목록이 없으면 루프백 http 도 막힌다')
    assert.equal(problem(''), 'invalid')
    assert.equal(problem(42), 'invalid')
    assert.equal(problem(`https://example.com/${'a'.repeat(2100)}`), 'too_long')

    process.env.OUTBOUND_ALLOW_HOSTS = '127.0.0.1:3999'
    assert.equal(problem('http://127.0.0.1:3999/hook'), 'ok', 'e2e · 개발의 받는 서버만')
    assert.equal(problem('http://127.0.0.1:4000/hook'), 'not_https', '다른 포트는 그대로 막힌다')
  } finally {
    if (saved === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
    else process.env.OUTBOUND_ALLOW_HOSTS = saved
  }
})

test('짧은 까닭 — `까닭: 자세히` · 200자까지', () => {
  assert.equal(shortFailure({ ok: false, reason: 'http_error', status: 500, detail: 'HTTP 500' }), 'http_error: HTTP 500')
  assert.equal(shortFailure({ ok: false, reason: 'network', status: null, detail: 'x'.repeat(500) }).length, 200)
})
