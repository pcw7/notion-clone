/**
 * POST /v1/search — 공개 API: 제목으로 페이지 · 데이터 소스 찾기 (API-5 · F-09-06 · F-09-04)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑩. 문은 `lib/api/v1.ts`, 일은 `lib/api/search.ts` — 앱의 검색(`searchPages` — 권한
 * 스코프가 `WHERE` 안)을 지난다. 다른 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { searchApi } from '@/lib/api/search'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(searchApi)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
