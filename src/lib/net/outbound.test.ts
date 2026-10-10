/**
 * 바깥 요청 — SSRF 방어 (히스토리 · 활동 4e-1 · F-11-19)
 *
 *   ① 막힌 대역 — 사설 · 루프백 · 메타데이터 · 매핑 · NAT64 · ULA · 6to4 · Teredo … 는 막고 공인 주소는 둔다
 *   ② 모양 — https · 기본 포트 · 사용자 정보 없음 · 안쪽 이름 · 꼴을 바꾼 루프백(`0177.0.0.1` · `2130706433`)
 *   ③ 이름이 막힌 주소로 풀리면 연결하지 않는다 — 하나라도(섞여 있어도)
 *   ④ 연결은 검사한 주소로(이름이 실제로는 풀리지 않는 `hook.test` 로 받는 서버에 닿는다) · 리다이렉트를 따라가지 않는다 · 오류 · 시간 초과
 *
 * 반사실(HANDOFF §3.3): 대역 하나를 빼면 ①, 섞인 답의 첫 주소만 보면 ③, 고정을 빼면 ④ 가 실패한다.
 */

import { test, describe, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { checkOutboundUrl, isBlockedAddress, postJson, type Resolver } from './outbound.ts'

describe('① 막힌 대역', () => {
  test('★ 안쪽 · 특수 주소는 막는다', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10', '203.0.113.5',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1',
      '2001:db8::1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '3fff::1',
      '주소 아님', '',
    ]) {
      assert.equal(isBlockedAddress(address), true, address)
    }
  })

  test('공인 주소는 둔다', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2606:4700:4700::1111', '2a00:1450:4001::1']) {
      assert.equal(isBlockedAddress(address), false, address)
    }
  })
})

describe('② 모양', () => {
  test('★ https · 기본 포트 · 바깥 이름만 받는다', () => {
    assert.equal(checkOutboundUrl('https://hooks.slack.com/services/T000/B000/xyz').ok, true)
    assert.equal(checkOutboundUrl('https://example.com:443/hook?a=1').ok, true)
    const problem = (raw: string) => {
      const checked = checkOutboundUrl(raw)
      return checked.ok ? 'ok' : checked.problem
    }
    assert.equal(problem('http://hooks.slack.com/x'), 'not_https')
    assert.equal(problem('ftp://example.com/x'), 'not_https')
    assert.equal(problem('https://user:pass@hooks.slack.com/x'), 'credentials')
    assert.equal(problem('https://hooks.slack.com:8443/x'), 'port')
    assert.equal(problem('nope'), 'invalid')
    assert.equal(problem(`https://example.com/${'a'.repeat(2048)}`), 'too_long')
    for (const raw of [
      'https://127.0.0.1/x', 'https://0177.0.0.1/x', 'https://2130706433/x', 'https://0x7f.1/x', 'https://[::1]/x', 'https://[::ffff:7f00:1]/x',
      'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://api.localhost/x', 'https://printer.local/x',
      'https://metadata.google.internal/x', 'https://intranet/x', 'https://router.home.arpa/x',
    ]) {
      assert.equal(problem(raw), 'private_host', raw)
    }
  })
})

describe('③ 이름 풀이', () => {
  const answer = (...addresses: string[]): Resolver => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

  test('★ 막힌 주소로 풀리면 보내지 않는다 — 섞여 있어도', async () => {
    for (const resolve of [answer('10.0.0.5'), answer('169.254.169.254'), answer('8.8.8.8', '127.0.0.1'), answer('::1')]) {
      const sent = await postJson('https://hooks.example.com/x', { a: 1 }, { resolve })
      assert.equal(sent.ok, false)
      if (!sent.ok) assert.equal(sent.reason, 'blocked_address')
    }
  })

  test('풀리지 않으면 dns · 모양이 틀리면 연결하지 않는다', async () => {
    const dns = await postJson('https://hooks.example.com/x', {}, { resolve: async () => { throw new Error('ENOTFOUND') } })
    assert.deepEqual(dns.ok ? null : dns.reason, 'dns')
    const empty = await postJson('https://hooks.example.com/x', {}, { resolve: answer() })
    assert.deepEqual(empty.ok ? null : empty.reason, 'dns')
    let asked = false
    const shape = await postJson('http://hooks.example.com/x', {}, { resolve: async () => ((asked = true), []) })
    assert.deepEqual([shape.ok ? null : shape.reason, asked], ['blocked_url', false])
  })
})

describe('④ 보내기 — 받는 서버', () => {
  let server: Server
  let port = 0
  const hits: { path: string; type: string | undefined; body: string }[] = []
  const saved = process.env.OUTBOUND_ALLOW_HOSTS
  // `hook.test` 는 실제로는 풀리지 않는다 — 닿았다면 고정한 주소로 연결한 것이다
  const toLocal: Resolver = async () => [{ address: '127.0.0.1', family: 4 }]

  before(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        hits.push({ path: req.url ?? '', type: req.headers['content-type'], body })
        if (req.url === '/ok') res.writeHead(204).end()
        else if (req.url === '/moved') res.writeHead(302, { location: '/ok' }).end()
        else if (req.url === '/broken') res.writeHead(500).end('아이고')
        else if (req.url === '/big') res.writeHead(200).end('x'.repeat(200 * 1024))
        // '/slow' 는 답하지 않는다
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
    process.env.OUTBOUND_ALLOW_HOSTS = `hook.test:${port}`
  })
  after(async () => {
    if (saved === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
    else process.env.OUTBOUND_ALLOW_HOSTS = saved
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  })

  test('★ 검사한 주소로 연결해 JSON 을 보낸다', async () => {
    const sent = await postJson(`http://hook.test:${port}/ok`, { text: '안녕' }, { resolve: toLocal })
    assert.deepEqual(sent, { ok: true, status: 204 })
    const hit = hits.find((h) => h.path === '/ok')
    assert.ok(hit)
    assert.equal(hit.type, 'application/json; charset=utf-8')
    assert.deepEqual(JSON.parse(hit.body), { text: '안녕' })
  })

  test('★ 리다이렉트를 따라가지 않는다', async () => {
    const before = hits.filter((h) => h.path === '/ok').length
    const sent = await postJson(`http://hook.test:${port}/moved`, {}, { resolve: toLocal })
    assert.deepEqual(sent.ok ? null : [sent.reason, sent.status], ['redirect', 302])
    assert.equal(hits.filter((h) => h.path === '/ok').length, before, '옮겨 간 곳에 닿지 않았다')
  })

  test('오류 · 큰 응답 · 시간 초과', async () => {
    const broken = await postJson(`http://hook.test:${port}/broken`, {}, { resolve: toLocal })
    assert.deepEqual(broken.ok ? null : [broken.reason, broken.status], ['http_error', 500])
    assert.deepEqual(await postJson(`http://hook.test:${port}/big`, {}, { resolve: toLocal }), { ok: true, status: 200 })
    const slow = await postJson(`http://hook.test:${port}/slow`, {}, { resolve: toLocal, timeoutMs: 300 })
    assert.deepEqual(slow.ok ? null : slow.reason, 'timeout')
  })

  test('★ 비켜 가는 목록은 그 host:port 하나뿐이다', async () => {
    const other = await postJson(`http://hook.test:${port + 1}/ok`, {}, { resolve: toLocal })
    assert.deepEqual(other.ok ? null : other.reason, 'blocked_url', '다른 포트는 http 를 받지 않는다')
    const literal = await postJson(`http://127.0.0.1:${port}/ok`, {})
    assert.deepEqual(literal.ok ? null : literal.reason, 'blocked_url', '주소 글자는 목록에 없다')
  })
})
