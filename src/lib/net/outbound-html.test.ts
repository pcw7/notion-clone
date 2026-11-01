// 바깥 GET HTML(F-4a · 정본 §3.4 [보강 F-4] ②) — 고정 연결 · 리다이렉트는 hop 마다 다시 검사 · HTML 만 · 본문 상한 · 시간.
import { test, describe, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { getHtml, type Resolver } from './outbound.ts'

describe('getHtml', () => {
  let server: Server
  let port = 0
  const hits: string[] = []
  const saved = process.env.OUTBOUND_ALLOW_HOSTS
  // `hook.test` 는 실제로는 풀리지 않는다 — 닿았다면 고정한 주소로 연결한 것이다
  const toLocal: Resolver = async () => [{ address: '127.0.0.1', family: 4 }]

  before(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? '')
      if (req.url === '/page') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<head><title>제목</title></head>')
      else if (req.url === '/moved') res.writeHead(302, { location: '/page' }).end()
      else if (req.url === '/to-metadata') res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' }).end()
      else if (req.url === '/loop') res.writeHead(302, { location: '/loop' }).end()
      else if (req.url === '/text') res.writeHead(200, { 'content-type': 'text/plain' }).end('글')
      else if (req.url === '/big') res.writeHead(200, { 'content-type': 'text/html' }).end(`<head><title>큰</title></head>${'x'.repeat(100 * 1024)}`)
      else if (req.url === '/broken') res.writeHead(500).end('아이고')
      // '/slow' 는 답하지 않는다
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

  test('★ 검사한 주소로 연결해 HTML 을 읽는다', async () => {
    const got = await getHtml(`http://hook.test:${port}/page`, { resolve: toLocal })
    assert.ok(got.ok, JSON.stringify(got))
    assert.equal(got.html, '<head><title>제목</title></head>')
    assert.equal(got.finalUrl, `http://hook.test:${port}/page`)
  })

  test('★ 리다이렉트를 따라가고 최종 주소를 준다 · 막힌 곳으로 보내면 그 hop 의 검사에서 멈춘다', async () => {
    const moved = await getHtml(`http://hook.test:${port}/moved`, { resolve: toLocal })
    assert.ok(moved.ok, JSON.stringify(moved))
    assert.equal(moved.finalUrl, `http://hook.test:${port}/page`)
    const blocked = await getHtml(`http://hook.test:${port}/to-metadata`, { resolve: toLocal })
    assert.deepEqual(blocked.ok ? null : [blocked.reason, blocked.detail], ['blocked_url', 'private_host'])
    const loop = await getHtml(`http://hook.test:${port}/loop`, { resolve: toLocal, maxRedirects: 2 })
    assert.equal(loop.ok ? null : loop.reason, 'too_many_redirects')
  })

  test('HTML 이 아니면 not_html · 본문은 상한까지만 · 오류 · 시간 초과 · 허용 밖의 http 는 거절', async () => {
    const text = await getHtml(`http://hook.test:${port}/text`, { resolve: toLocal })
    assert.equal(text.ok ? null : text.reason, 'not_html')
    const big = await getHtml(`http://hook.test:${port}/big`, { resolve: toLocal, maxBytes: 1024 })
    assert.ok(big.ok)
    assert.equal(big.truncated, true)
    assert.equal(Buffer.byteLength(big.html), 1024)
    assert.ok(big.html.includes('<title>큰</title>'))
    const broken = await getHtml(`http://hook.test:${port}/broken`, { resolve: toLocal })
    assert.deepEqual(broken.ok ? null : [broken.reason, broken.status], ['http_error', 500])
    const slow = await getHtml(`http://hook.test:${port}/slow`, { resolve: toLocal, timeoutMs: 300 })
    assert.equal(slow.ok ? null : slow.reason, 'timeout')
    const plain = await getHtml('http://example.com/')
    assert.deepEqual(plain.ok ? null : [plain.reason, plain.detail], ['blocked_url', 'not_https'])
  })

  test('★ 이름이 막힌 주소로 풀리면 연결하지 않는다', async () => {
    const before = hits.length
    const got = await getHtml('https://looks-public.example/', { resolve: async () => [{ address: '10.0.0.5', family: 4 }] })
    assert.deepEqual(got.ok ? null : got.reason, 'blocked_address')
    assert.equal(hits.length, before)
  })
})
