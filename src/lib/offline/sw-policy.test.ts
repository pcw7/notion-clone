/**
 * 서비스 워커의 규칙 — OF-1 (F-12-04 · 정본 §3.7 [보강 OF-1] ①)
 *
 *   ① 요청의 갈래 — 정적 파일은 먼저 캐시 · 페이지 이동은 네트워크만(닿지 않으면 껍데기) · API · RSC · 다른 출처 · GET 이 아닌 것은 손대지 않는다
 *   ② 캐시에 넣어도 되는 응답 — 온전한 200 · 같은 출처 · 쿠키 없음 · `private` · `no-store` 가 아니다
 *   ③ 껍데기가 부르는 정적 파일 — HTML · RSC 실림의 `/_next/static/…` · 겹치면 한 번
 *   ④ `public/sw.js` 가 이 모듈과 같다 — 파일을 그대로 돌려 같은 상수 · 같은 답(옮겨 적은 것이 어긋나면 실패)
 *   ⑤ 워커의 동작(가짜 캐시 · 네트워크) — 설치는 껍데기와 그 정적 파일만 · 요청 때 그린 껍데기는 설치 실패 · 넘겨받을 때 옛 판만 지운다 ·
 *     로그인한 화면 · API 는 캐시에 넣지 않는다 · 네트워크가 없으면 껍데기 · 정적 캐시의 상한
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import {
  API_PREFIX,
  CACHE_PREFIX,
  OFFLINE_URL,
  SHELL_CACHE,
  STATIC_CACHE,
  STATIC_CACHE_LIMIT,
  STATIC_PREFIX,
  SW_VERSION,
  classifyRequest,
  isCacheableResponse,
  shellAssets,
  type RequestFacts,
  type RequestKind,
  type ResponseFacts,
} from './sw-policy.ts'

const ORIGIN = 'http://localhost:3000'
const SW_SOURCE = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8')

const req = (path: string, over: Partial<RequestFacts> = {}): RequestFacts => ({
  method: 'GET', url: path.startsWith('http') ? path : `${ORIGIN}${path}`, origin: ORIGIN, mode: 'navigate', range: false, ...over,
})

const REQUESTS: readonly (readonly [string, RequestFacts, RequestKind])[] = [
  ['스크립트', req('/_next/static/chunks/0a1b2c.js', { mode: 'no-cors' }), 'cache-first'],
  ['스타일', req('/_next/static/chunks/9f8e.css', { mode: 'no-cors' }), 'cache-first'],
  ['cors 로 부른 정적 파일', req('/_next/static/media/x.woff2', { mode: 'cors' }), 'cache-first'],
  ['빌드 판의 매니페스트', req('/_next/static/abc123/_buildManifest.js', { mode: 'no-cors' }), 'cache-first'],
  ['워크스페이스 페이지로 이동', req('/w/1/2'), 'offline-fallback'],
  ['첫 화면으로 이동', req('/'), 'offline-fallback'],
  ['껍데기로 이동', req(OFFLINE_URL), 'offline-fallback'],
  ['공개 페이지로 이동', req('/p/token'), 'offline-fallback'],
  ['api 와 이름만 비슷한 주소로 이동', req('/apix/1'), 'offline-fallback'],
  ['API 로 이동(내려받기)', req('/api/files/1'), 'bypass'],
  ['API 의 뿌리', req('/api'), 'bypass'],
  ['API 요청', req('/api/workspaces/1/pages', { mode: 'cors' }), 'bypass'],
  ['RSC 요청', req('/w/1/2?_rsc=abc', { mode: 'cors' }), 'bypass'],
  ['POST 이동(폼)', req('/w/1/2', { method: 'POST' }), 'bypass'],
  ['POST 정적 주소', req('/_next/static/chunks/a.js', { method: 'POST', mode: 'cors' }), 'bypass'],
  ['HEAD 정적 주소', req('/_next/static/chunks/a.js', { method: 'HEAD', mode: 'cors' }), 'bypass'],
  ['다른 출처의 정적 주소', req('https://cdn.example.com/_next/static/chunks/a.js', { mode: 'no-cors' }), 'bypass'],
  ['다른 출처로 이동', req('https://example.com/'), 'bypass'],
  ['범위 요청(미디어)', req('/_next/static/media/clip.mp4', { mode: 'no-cors', range: true }), 'bypass'],
  ['이미지 최적화', req('/_next/image?url=%2Fa.png&w=64&q=75', { mode: 'no-cors' }), 'bypass'],
  ['정적 머리와 비슷한 주소', req('/_next/staticx/a.js', { mode: 'no-cors' }), 'bypass'],
  ['매니페스트', req('/manifest.webmanifest', { mode: 'cors' }), 'bypass'],
  ['워커 자신', req('/sw.js', { mode: 'same-origin' }), 'bypass'],
]

test('① 요청의 갈래', () => {
  for (const [name, facts, kind] of REQUESTS) assert.equal(classifyRequest(facts), kind, name)
})

const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null })
const res = (status: number, type: string, h: Record<string, string> = {}): ResponseFacts => ({ status, type, headers: headers(h) })

const RESPONSES: readonly (readonly [string, ResponseFacts, boolean])[] = [
  ['정적 파일(immutable)', res(200, 'basic', { 'cache-control': 'public, max-age=31536000, immutable' }), true],
  ['머리 없음', res(200, 'basic'), true],
  ['빌드 때 그린 화면(s-maxage)', res(200, 'basic', { 'cache-control': 's-maxage=31536000' }), true],
  ['요청 때 그린 화면', res(200, 'basic', { 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' }), false],
  ['no-store', res(200, 'basic', { 'cache-control': 'no-store' }), false],
  ['붙여 쓴 no-store', res(200, 'basic', { 'cache-control': 'public,no-store' }), false],
  ['대문자 Private', res(200, 'basic', { 'cache-control': 'Private' }), false],
  ['private="set-cookie"', res(200, 'basic', { 'cache-control': 'private="set-cookie"' }), false],
  ['쿠키를 심는다', res(200, 'basic', { 'set-cookie': 'nc_session=x; Path=/' }), false],
  ['부분 응답', res(206, 'basic'), false],
  ['없다', res(404, 'basic'), false],
  ['옮겨 감', res(308, 'basic'), false],
  ['다른 출처(opaque)', res(0, 'opaque'), false],
  ['다른 출처(cors)', res(200, 'cors'), false],
]

test('② 캐시에 넣어도 되는 응답', () => {
  for (const [name, facts, ok] of RESPONSES) assert.equal(isCacheableResponse(facts), ok, name)
})

const SHELL_HTML = [
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/chunks/a1.css" data-precedence="next"/>',
  '<script src="/_next/static/chunks/b2.js" async=""></script><script src="/_next/static/chunks/b2.js" async=""></script>',
  '</head><body><h1>오프라인입니다</h1>',
  '<script>self.__next_f.push([1,"1:I[\\"/_next/static/chunks/c3.js\\",[]]\\n"])</script>',
  '<style>@font-face{src:url(/_next/static/media/d4.woff2)}</style></body></html>',
].join('')

test('③ 껍데기가 부르는 정적 파일', () => {
  assert.deepEqual(shellAssets(SHELL_HTML), [
    '/_next/static/chunks/a1.css',
    '/_next/static/chunks/b2.js',
    '/_next/static/chunks/c3.js',
    '/_next/static/media/d4.woff2',
  ])
  assert.deepEqual(shellAssets('<html><body>정적 파일 없음 /api/x</body></html>'), [])
})

// ── 워커를 그대로 돌린다(가짜 캐시 · 네트워크) ──

type FakeResponse = {
  readonly status: number
  readonly type: string
  readonly headers: Headers
  readonly body: string
  clone(): FakeResponse
  text(): Promise<string>
}
const fake = (body: string, init: { status?: number; type?: string; headers?: Record<string, string> } = {}): FakeResponse => {
  const r: FakeResponse = {
    status: init.status ?? 200, type: init.type ?? 'basic', headers: new Headers(init.headers), body,
    clone: () => r, text: async () => body,
  }
  return r
}
type Keyish = string | { readonly url: string }
type Waiter = { waitUntil(p: Promise<unknown>): void }
type FetchEvent = Waiter & {
  readonly request: { readonly method: string; readonly url: string; readonly mode: string; readonly headers: Headers }
  respondWith(p: Promise<FakeResponse>): void
}
type Listener = (event: Waiter | FetchEvent) => void

/** 워커 한 벌 — `network` 가 주소마다 응답(던지면 네트워크가 없다). */
function worker(network: (path: string) => FakeResponse) {
  const stores = new Map<string, Map<string, FakeResponse>>()
  const puts: string[] = []
  const href = (key: Keyish) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        put: async (key: Keyish, value: FakeResponse) => {
          puts.push(`${name} ${new URL(href(key)).pathname}`)
          store.set(href(key), value)
        },
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (key: Keyish) => store.delete(href(key)),
      }
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: Keyish, options: { cacheName?: string } = {}) => {
      for (const [name, store] of stores) {
        if (options.cacheName !== undefined && options.cacheName !== name) continue
        const hit = store.get(href(key))
        if (hit) return hit
      }
      return undefined
    },
  }
  const fetches: string[] = []
  const fetchFn = async (key: Keyish) => {
    const path = new URL(href(key)).pathname
    fetches.push(path)
    return network(path)
  }
  const listeners = new Map<string, Listener>()
  const state = { skipped: false, claimed: false }
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    location: { origin: ORIGIN },
    skipWaiting: async () => { state.skipped = true },
    clients: { claim: async () => { state.claimed = true } },
  }
  const context = vm.createContext({ self, caches, fetch: fetchFn, URL, Response: { error: () => fake('', { status: 0, type: 'error' }) } })
  vm.runInContext(SW_SOURCE, context, { filename: 'public/sw.js' })

  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = []
    listeners.get(type)!({ waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  /** 요청 하나 — 워커가 맡지 않으면 null. 뒤에서 하는 넣기까지 기다린다. */
  const request = async (facts: RequestFacts): Promise<FakeResponse | null> => {
    let responded: Promise<FakeResponse> | null = null
    const waits: Promise<unknown>[] = []
    const event: FetchEvent = {
      request: { method: facts.method, url: facts.url, mode: facts.mode, headers: new Headers(facts.range ? { range: 'bytes=0-1' } : {}) },
      respondWith: (p) => { responded = p },
      waitUntil: (p) => waits.push(p),
    }
    listeners.get('fetch')!(event)
    const pending = responded as Promise<FakeResponse> | null
    const out = pending === null ? null : await pending
    await Promise.all(waits)
    return out
  }
  return { context, caches, listeners, stores, puts, fetches, state, lifecycle, request }
}

const IMMUTABLE = { 'cache-control': 'public, max-age=31536000, immutable' }
const PRIVATE = { 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' }
/** 온라인 서버 — 껍데기는 빌드 때 그린 화면 · 정적 파일은 immutable · 나머지는 요청 때 그린 화면(private). */
const online = (path: string) =>
  path === OFFLINE_URL ? fake(SHELL_HTML, { headers: { 'cache-control': 's-maxage=31536000' } })
    : path.startsWith(STATIC_PREFIX) ? fake(`/* ${path} */`, { headers: IMMUTABLE })
      : fake(`<html>로그인한 화면 ${path}</html>`, { headers: PRIVATE })
const offline = (): FakeResponse => { throw new TypeError('Failed to fetch') }

test('④ public/sw.js 가 이 모듈과 같다 — 같은 상수 · 같은 답', () => {
  const { context, listeners } = worker(online)
  assert.deepEqual([...listeners.keys()].sort(), ['activate', 'fetch', 'install'])
  const constants = JSON.parse(vm.runInContext(
    'JSON.stringify({ VERSION, CACHE_PREFIX, STATIC_CACHE, SHELL_CACHE, STATIC_CACHE_LIMIT, OFFLINE_URL, STATIC_PREFIX, API_PREFIX })', context,
  ) as string)
  assert.deepEqual(constants, {
    VERSION: SW_VERSION, CACHE_PREFIX, STATIC_CACHE, SHELL_CACHE, STATIC_CACHE_LIMIT, OFFLINE_URL, STATIC_PREFIX, API_PREFIX,
  })
  const sw = context as unknown as { classifyRequest(r: RequestFacts): string; isCacheableResponse(r: ResponseFacts): boolean; shellAssets(h: string): string[] }
  for (const [name, facts] of REQUESTS) assert.equal(sw.classifyRequest(facts), classifyRequest(facts), name)
  for (const [name, facts] of RESPONSES) assert.equal(sw.isCacheableResponse(facts), isCacheableResponse(facts), name)
  assert.deepEqual([...sw.shellAssets(SHELL_HTML)], shellAssets(SHELL_HTML))
})

test('⑤ 설치 — 껍데기와 그것이 부르는 정적 파일만 · 곧바로 넘겨받는다', async () => {
  const w = worker(online)
  await w.lifecycle('install')
  assert.deepEqual([...w.puts].sort(), [
    `${SHELL_CACHE} /_next/static/chunks/a1.css`,
    `${SHELL_CACHE} /_next/static/chunks/b2.js`,
    `${SHELL_CACHE} /_next/static/chunks/c3.js`,
    `${SHELL_CACHE} /_next/static/media/d4.woff2`,
    `${SHELL_CACHE} ${OFFLINE_URL}`,
  ])
  assert.ok(w.state.skipped)
})

test('⑤ 설치 — 껍데기가 요청 때 그린 화면(private)이면 실패한다(로그인 정보가 든 화면을 남기지 않는다)', async () => {
  const w = worker((path) => (path === OFFLINE_URL ? fake('<html>누군가의 화면</html>', { headers: PRIVATE }) : online(path)))
  await assert.rejects(w.lifecycle('install'))
  assert.deepEqual(w.puts, [])
})

test('⑤ 설치 — 껍데기의 정적 파일 하나를 못 받아도 껍데기는 선다', async () => {
  const w = worker((path) => (path.endsWith('b2.js') ? offline() : online(path)))
  await w.lifecycle('install')
  assert.ok(w.puts.includes(`${SHELL_CACHE} ${OFFLINE_URL}`))
  assert.ok(!w.puts.some((p) => p.endsWith('b2.js')))
})

test('⑤ 넘겨받기 — 이 워커의 옛 판 캐시만 지우고 화면을 맡는다', async () => {
  const w = worker(online)
  for (const name of [`${CACHE_PREFIX}static-v0`, `${CACHE_PREFIX}shell-v0`, STATIC_CACHE, SHELL_CACHE, 'someone-else']) await w.caches.open(name)
  await w.lifecycle('activate')
  assert.deepEqual([...w.stores.keys()].sort(), [SHELL_CACHE, STATIC_CACHE, 'someone-else'].sort())
  assert.ok(w.state.claimed)
})

test('⑤ 로그인한 화면 · API 는 캐시에 넣지 않는다 — 이동은 네트워크의 응답 그대로 · API 는 손대지 않는다', async () => {
  const w = worker(online)
  await w.lifecycle('install')
  w.puts.length = 0
  const page = await w.request(req('/w/1/2'))
  assert.equal(page?.body, '<html>로그인한 화면 /w/1/2</html>')
  assert.equal(await w.request(req('/api/workspaces/1', { mode: 'cors' })), null)
  assert.equal(await w.request(req('/w/1/2?_rsc=x', { mode: 'cors' })), null)
  assert.equal(await w.request(req('/w/1/2', { method: 'POST' })), null)
  assert.deepEqual(w.puts, [])
})

test('⑤ 네트워크가 없으면 페이지 이동은 껍데기 — 껍데기가 없으면 네트워크 오류', async () => {
  let up = false
  const w = worker((path) => (up ? online(path) : offline()))
  assert.equal((await w.request(req('/w/1/2')))?.status, 0, '설치 전 — 껍데기가 없다')
  up = true
  await w.lifecycle('install')
  up = false
  const shell = await w.request(req('/w/1/3'))
  assert.equal(shell?.body, SHELL_HTML)
})

test('⑤ 정적 파일 — 먼저 캐시(두 번째는 네트워크에 가지 않는다) · private 이면 넣지 않는다', async () => {
  const w = worker((path) => (path.endsWith('p.js') ? fake('private', { headers: PRIVATE }) : online(path)))
  const first = await w.request(req('/_next/static/chunks/z.js', { mode: 'no-cors' }))
  const second = await w.request(req('/_next/static/chunks/z.js', { mode: 'no-cors' }))
  assert.equal(first?.body, second?.body)
  assert.deepEqual(w.fetches, ['/_next/static/chunks/z.js'])
  assert.deepEqual(w.puts, [`${STATIC_CACHE} /_next/static/chunks/z.js`])
  await w.request(req('/_next/static/chunks/p.js', { mode: 'no-cors' }))
  assert.deepEqual(w.puts, [`${STATIC_CACHE} /_next/static/chunks/z.js`])
})

test('⑤ 정적 캐시의 상한 — 넘으면 먼저 넣은 것부터 지운다', async () => {
  const w = worker(online)
  for (let i = 0; i <= STATIC_CACHE_LIMIT + 1; i += 1) await w.request(req(`/_next/static/chunks/${i}.js`, { mode: 'no-cors' }))
  const kept = [...w.stores.get(STATIC_CACHE)!.keys()].map((u) => new URL(u).pathname)
  assert.equal(kept.length, STATIC_CACHE_LIMIT)
  assert.ok(!kept.includes('/_next/static/chunks/0.js') && !kept.includes('/_next/static/chunks/1.js'))
  assert.ok(kept.includes(`/_next/static/chunks/${STATIC_CACHE_LIMIT + 1}.js`))
})
