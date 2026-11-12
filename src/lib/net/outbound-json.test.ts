// 바깥 GET JSON(MP-1 장소 찾기 · 정본 §3.5 [보강 MP-1] ②) — 고정 연결 · 일반 User-Agent · 리다이렉트 안 따름 · JSON 만 · 본문 상한 · 시간.
import { test, describe, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { getJson, type Resolver } from './outbound.ts'

describe('getJson', () => {
  let server: Server
  let port = 0
  const seen: { url: string; headers: Record<string, string | string[] | undefined> }[] = []
  const saved = process.env.OUTBOUND_ALLOW_HOSTS
  const toLocal: Resolver = async () => [{ address: '127.0.0.1', family: 4 }]

  before(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? '', headers: req.headers })
      if (req.url?.startsWith('/search')) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ lat: '1', lon: '2' }]))
      else if (req.url === '/moved') res.writeHead(302, { location: '/search' }).end()
      else if (req.url === '/text') res.writeHead(200, { 'content-type': 'text/plain' }).end('JSON 아님')
      else if (req.url === '/big') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(['x'.repeat(4096)]))
      else if (req.url === '/broken') res.writeHead(500).end('아이고')
      // '/slow' 는 답하지 않는다
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
    process.env.OUTBOUND_ALLOW_HOSTS = `geo.test:${port}`
  })
  after(async () => {
    if (saved === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
    else process.env.OUTBOUND_ALLOW_HOSTS = saved
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  })

  test('★ 검사한 주소로 연결해 JSON 을 읽는다 · 헤더에 사용자 정보가 없다(고정된 일반 User-Agent)', async () => {
    const got = await getJson(`http://geo.test:${port}/search?q=a`, { resolve: toLocal })
    assert.ok(got.ok, JSON.stringify(got))
    assert.deepEqual(got.body, [{ lat: '1', lon: '2' }])
    const headers = seen.at(-1)!.headers
    assert.equal(headers['user-agent'], 'notion-clone (self-hosted)')
    assert.equal(headers.cookie, undefined)
    assert.equal(headers.authorization, undefined)
  })

  test('리다이렉트는 따라가지 않는다 · JSON 이 아니거나 상한을 넘으면 not_json · 오류 · 시간 초과 · 허용 밖의 http 는 거절', async () => {
    const moved = await getJson(`http://geo.test:${port}/moved`, { resolve: toLocal })
    assert.equal(moved.ok ? null : moved.reason, 'redirect')
    const text = await getJson(`http://geo.test:${port}/text`, { resolve: toLocal })
    assert.equal(text.ok ? null : text.reason, 'not_json')
    const big = await getJson(`http://geo.test:${port}/big`, { resolve: toLocal, maxBytes: 1024 })
    assert.equal(big.ok ? null : big.reason, 'not_json')
    const broken = await getJson(`http://geo.test:${port}/broken`, { resolve: toLocal })
    assert.deepEqual(broken.ok ? null : [broken.reason, broken.status], ['http_error', 500])
    const slow = await getJson(`http://geo.test:${port}/slow`, { resolve: toLocal, timeoutMs: 300 })
    assert.equal(slow.ok ? null : slow.reason, 'timeout')
    const plain = await getJson('http://example.com/search')
    assert.deepEqual(plain.ok ? null : [plain.reason, plain.detail], ['blocked_url', 'not_https'])
  })

  test('★ 안쪽 주소로 풀리는 이름은 막는다(허용 목록 밖)', async () => {
    const blocked = await getJson('https://geo.example.com/search', { resolve: toLocal })
    assert.equal(blocked.ok ? null : blocked.reason, 'blocked_address')
    const metadata = await getJson('https://169.254.169.254/latest/meta-data/')
    assert.equal(metadata.ok ? null : metadata.reason, 'blocked_url')
  })
})
