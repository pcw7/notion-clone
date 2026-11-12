/**
 * 장소 찾기 (MP-1 · 정본 §3.5 [보강 MP-1] ②)
 *
 * 찾기는 앱 서버가 대신 묻는다 — 브라우저가 외부에 직접 묻지 않는다. 묻는 곳은 `PLACE_SEARCH_URL`(Nominatim 호환 `/search?format=jsonv2` ·
 * 기본 `https://nominatim.openstreetmap.org` · `off` 면 끈다). 외부 요청은 `net/outbound.ts` 의 검사를 지난다(SSRF) · 헤더에 사용자 정보를
 * 싣지 않는다(고정된 일반 User-Agent) · 사람마다 초당 1번 · 결과 5개.
 *
 * 좌표(`37.5665, 126.978`)로 쓴 글은 외부에 묻지 않고 그 자리를 돌려준다 — 속도 제한에도 세지 않는다. 묻는 사람의 권한은 보지 않는다(멤버
 * 확인은 라우트가 했다) — 외부의 공개 지도 정보이고 `SessionContext` 는 속도 제한의 열쇠다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { getJson, type JsonResult } from '../net/outbound.ts'
import { consume, type RateLimitRule } from '../rate-limit.ts'
import { mapNominatim, normalizePlaceQuery, parseCoordinates, placeSearchBase, placeSearchUrl } from './place.ts'
import type { PlaceRef } from './property-types.ts'

/** 사람마다 초당 1번(Nominatim 의 이용 규칙). */
export const PLACE_SEARCH_RATE: RateLimitRule = { limit: 1, windowSeconds: 1 }

export type PlaceSearchResult =
  | { readonly ok: true; readonly source: 'coordinates' | 'search'; readonly places: readonly PlaceRef[] }
  | { readonly ok: false; readonly reason: 'invalid_query' | 'disabled' | 'rate_limited' | 'failed' }

export async function searchPlaces(
  ctx: SessionContext,
  rawQuery: unknown,
  options: {
    /** 환경 변수 대신 넣는 `PLACE_SEARCH_URL` (검사) */
    readonly searchUrl?: string | undefined
    readonly rate?: RateLimitRule
    readonly fetcher?: (url: string) => Promise<JsonResult>
  } = {},
): Promise<PlaceSearchResult> {
  const query = normalizePlaceQuery(rawQuery)
  if (query === null) return { ok: false, reason: 'invalid_query' }

  // 좌표는 외부에 묻지 않는다
  const typed = parseCoordinates(query)
  if (typed !== null) return { ok: true, source: 'coordinates', places: [typed] }

  const base = placeSearchBase('searchUrl' in options ? options.searchUrl : process.env.PLACE_SEARCH_URL)
  if (base === null) return { ok: false, reason: 'disabled' }

  if (!(await consume('place-search:user', ctx.userId, options.rate ?? PLACE_SEARCH_RATE)).allowed) return { ok: false, reason: 'rate_limited' }

  const fetched = await (options.fetcher ?? ((u: string) => getJson(u)))(placeSearchUrl(base, query))
  if (!fetched.ok) return { ok: false, reason: 'failed' }
  return { ok: true, source: 'search', places: mapNominatim(fetched.body) }
}
