/**
 * 서비스 워커 — 정적 파일과 오프라인 껍데기만 캐시한다 (OF-1 · F-12-04 · 정본 §3.7 [보강 OF-1] ①)
 *
 * 손으로 쓴 한 파일이다(라이브러리 없음). 규칙의 정본은 `src/lib/offline/sw-policy.ts` — 아래의 상수 · `classifyRequest` ·
 * `isCacheableResponse` · `shellAssets` 는 그것을 옮겨 적은 것이고, `sw-policy.test.ts` 가 이 파일을 그대로 돌려 같은 답을 내는지 본다.
 * 규칙을 고치면 둘 다 고친다.
 *
 * - `/_next/static/*` — 먼저 캐시. 이름에 해시가 있어 같은 주소는 같은 내용이다.
 * - 페이지 이동 — 네트워크만. 닿지 않으면 설치 때 받아 둔 `/offline` 을 보인다(주소는 그대로).
 * - 그 밖(API · RSC · 이미지 · 다른 출처 · GET 이 아닌 것) — 손대지 않는다(respondWith 를 부르지 않는다 — 브라우저가 곧바로 네트워크로).
 * - **로그인한 화면(HTML) · API 응답은 캐시하지 않는다** — 공용 컴퓨터에서 남의 화면이 남는다. 캐시에 넣는 길은 위의 둘뿐이다.
 *
 * 갱신 — 이 파일의 바이트가 바뀌면 브라우저가 새 워커를 설치한다(등록이 `updateViaCache: 'none'` — HTTP 캐시를 거치지 않고 묻는다).
 * 새 워커는 기다리지 않고 곧바로 넘겨받는다(skipWaiting · clients.claim) — 페이지와 주고받는 약속이 없고 정적 파일은 주소(해시)로만
 * 찾으므로 옛 빌드의 화면도 새 워커 아래에서 같게 돈다. 넘겨받을 때 옛 판(VERSION)의 캐시를 지운다. 앱을 배포해도 이 파일은 그대로라
 * 워커 · 껍데기도 그대로다(껍데기는 자기가 부르는 정적 파일을 함께 들고 있어 그대로 선다) — 껍데기 · 규칙을 바꾸면 VERSION 을 올린다.
 */
'use strict'

const VERSION = 'v1'
const CACHE_PREFIX = 'nc-'
const STATIC_CACHE = CACHE_PREFIX + 'static-' + VERSION
const SHELL_CACHE = CACHE_PREFIX + 'shell-' + VERSION
const STATIC_CACHE_LIMIT = 400
const OFFLINE_URL = '/offline'
const STATIC_PREFIX = '/_next/static/'
const API_PREFIX = '/api/'

/** 요청을 어떻게 다루는가 — 'cache-first' | 'offline-fallback' | 'bypass'. */
function classifyRequest(req) {
  if (req.method !== 'GET') return 'bypass'
  const url = new URL(req.url)
  if (url.origin !== req.origin) return 'bypass'
  // API 는 이동(내려받기 · 메일의 링크)이라도 손대지 않는다
  if (url.pathname === '/api' || url.pathname.startsWith(API_PREFIX)) return 'bypass'
  if (req.mode === 'navigate') return 'offline-fallback'
  if (req.range) return 'bypass'
  if (url.pathname.startsWith(STATIC_PREFIX)) return 'cache-first'
  return 'bypass'
}

/** 캐시에 넣어도 되는 응답인가 — 온전한 200 · 같은 출처 · 쿠키를 심지 않는다 · `no-store` · `private` 가 아니다. */
function isCacheableResponse(res) {
  if (res.status !== 200 || res.type !== 'basic') return false
  if (res.headers.get('set-cookie') !== null) return false
  const cacheControl = (res.headers.get('cache-control') || '').toLowerCase()
  return !/(^|[\s,])(no-store|private)([\s,=]|$)/.test(cacheControl)
}

/** 껍데기 HTML 이 부르는 정적 파일 — 겹치면 한 번. */
function shellAssets(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s\\<>)]+/g) || [])]
}

// 설치 — 껍데기와 그것이 부르는 정적 파일을 받아 둔다. 껍데기는 쿠키 없이 받는다(누구의 것도 아니다 · 서버도 빌드 때 그린 정적 화면).
// 껍데기를 캐시할 수 없으면(요청 때 그린 화면이 됐다 — private · no-store) 설치를 실패시킨다: 로그인 정보가 든 화면을 남기지 않는다.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch(OFFLINE_URL, { credentials: 'omit', cache: 'reload' })
      if (!isCacheableResponse(res)) throw new Error('오프라인 껍데기를 캐시할 수 없다 — ' + res.status)
      const html = await res.clone().text()
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(OFFLINE_URL, res)
      await Promise.all(
        shellAssets(html).map(async (path) => {
          try {
            const asset = await fetch(path, { credentials: 'omit' })
            if (isCacheableResponse(asset)) await cache.put(path, asset)
          } catch {
            // 하나를 못 받아도 껍데기는 선다 — 그 파일은 앱이 부를 때 정적 캐시에 들어간다
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

// 넘겨받기 — 이 워커의 옛 판 캐시를 지우고 열려 있는 화면을 곧바로 맡는다
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC_CACHE, SHELL_CACHE]
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && !keep.includes(name)) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const kind = classifyRequest({
    method: request.method,
    url: request.url,
    origin: self.location.origin,
    mode: request.mode,
    range: request.headers.has('range'),
  })
  if (kind === 'cache-first') event.respondWith(cacheFirst(event))
  else if (kind === 'offline-fallback') event.respondWith(networkOrShell(event))
  // 'bypass' — 손대지 않는다
})

/** 정적 파일 — 캐시에 있으면 그것, 없으면 받아서 넣는다(넣기는 응답을 늦추지 않게 뒤에서). 내용은 주소(해시)가 정하므로 Vary 는 보지 않는다. */
async function cacheFirst(event) {
  const hit = await caches.match(event.request, { ignoreVary: true })
  if (hit) return hit
  const res = await fetch(event.request)
  if (isCacheableResponse(res)) {
    const copy = res.clone()
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((cache) => cache.put(event.request, copy))
        .then(trimStatic)
        .catch(() => undefined),
    )
  }
  return res
}

/** 정적 캐시가 끝없이 자라지 않게 — 상한을 넘으면 먼저 넣은 것부터 지운다(배포마다 해시가 바뀌어 옛 파일이 쌓인다). */
async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - STATIC_CACHE_LIMIT; i += 1) await cache.delete(keys[i])
}

/** 페이지 이동 — 네트워크만(캐시에 넣지 않는다). 닿지 않으면 껍데기. */
async function networkOrShell(event) {
  try {
    return await fetch(event.request)
  } catch {
    const shell = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE, ignoreVary: true })
    return shell || Response.error()
  }
}
