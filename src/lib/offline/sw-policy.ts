/**
 * 서비스 워커의 규칙 — 요청을 어떻게 다루는가 · 어떤 응답을 캐시에 넣는가 (OF-1 · F-12-04 · 정본 §3.7 [보강 OF-1] ①)
 *
 * 워커(`public/sw.js`)는 손으로 쓴 한 파일이라 이 모듈을 불러오지 못한다 — 같은 규칙을 그 파일에 옮겨 적었다. `sw-policy.test.ts` 가
 * `public/sw.js` 를 그대로 돌려 같은 입력에 같은 답 · 같은 상수를 내는지 본다(한쪽만 고치면 실패한다).
 *
 * - `/_next/static/*` — 먼저 캐시(`cache-first`). 이름에 해시가 있어 같은 주소는 같은 내용이다.
 * - 페이지 이동 — 네트워크만, 닿지 않으면 캐시해 둔 `/offline` 껍데기(`offline-fallback`).
 * - 그 밖(API · RSC · 이미지 · 다른 출처 · GET 이 아닌 것 · 범위 요청) — 손대지 않는다(`bypass` — 워커 없이 곧바로 네트워크로).
 *
 * **로그인한 화면(HTML) · API 응답은 캐시하지 않는다** — 공용 컴퓨터에서 남의 화면이 남는다. 캐시에 넣는 것은 정적 파일과 껍데기뿐이고,
 * 넣기 전에 응답도 다시 본다(`isCacheableResponse`).
 */

/** 워커의 판 — 캐시 이름에 붙는다. 껍데기 · 규칙을 바꾸면 올린다(앱 배포만으로는 워커가 바뀌지 않는다 — `public/sw.js` 머리). */
export const SW_VERSION = 'v1'
/** 이 워커의 캐시 이름의 머리 — 넘겨받을 때 이 머리의 옛 판만 지운다. */
export const CACHE_PREFIX = 'nc-'
export const STATIC_CACHE = `${CACHE_PREFIX}static-${SW_VERSION}`
export const SHELL_CACHE = `${CACHE_PREFIX}shell-${SW_VERSION}`
/** 정적 캐시의 상한(항목 수) — 배포마다 해시가 바뀌어 옛 파일이 쌓인다. 넘으면 먼저 넣은 것부터 지운다(한 빌드의 정적 파일은 200여 개). */
export const STATIC_CACHE_LIMIT = 400

export const OFFLINE_URL = '/offline'
export const STATIC_PREFIX = '/_next/static/'
export const API_PREFIX = '/api/'

export type RequestKind = 'cache-first' | 'offline-fallback' | 'bypass'

export type RequestFacts = {
  readonly method: string
  readonly url: string
  /** 워커의 출처(`self.location.origin`). */
  readonly origin: string
  /** `Request.mode` — 페이지 이동은 `navigate`. */
  readonly mode: string
  /** `Range` 머리가 있는가 — 부분 응답(206)은 캐시하지 않는다. */
  readonly range: boolean
}

export function classifyRequest(req: RequestFacts): RequestKind {
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

export type ResponseFacts = {
  readonly status: number
  /** `Response.type` — 같은 출처는 `basic`. */
  readonly type: string
  readonly headers: { get(name: string): string | null }
}

/**
 * 캐시에 넣어도 되는 응답인가 — 온전한 200 · 같은 출처 · 쿠키를 심지 않는다 · `Cache-Control` 이 `no-store` · `private` 가 아니다.
 *
 * 브라우저는 `Set-Cookie` 를 fetch 응답에서 숨긴다(금지된 응답 머리) — 그 검사는 숨기지 않는 환경을 위한 겹 방어다. 진짜 막는 것은 넣는
 * 길이 둘뿐인 것(정적 파일 · 껍데기)과 `private` · `no-store` 다 — 요청 때 그린 화면(쿠키를 읽는다)은 Next 가 `private, no-store` 로 낸다.
 */
export function isCacheableResponse(res: ResponseFacts): boolean {
  if (res.status !== 200 || res.type !== 'basic') return false
  if (res.headers.get('set-cookie') !== null) return false
  const cacheControl = (res.headers.get('cache-control') ?? '').toLowerCase()
  return !/(^|[\s,])(no-store|private)([\s,=]|$)/.test(cacheControl)
}

/** 껍데기 HTML 이 부르는 정적 파일 — 설치 때 껍데기와 함께 받아 둔다(오프라인에서 껍데기가 제 모양으로 서게). 겹치면 한 번. */
export function shellAssets(html: string): string[] {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s\\<>)]+/g) ?? [])]
}
