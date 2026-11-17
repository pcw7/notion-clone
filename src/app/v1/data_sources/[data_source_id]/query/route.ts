/**
 * POST /v1/data_sources/{data_source_id}/query — 공개 API: 행 질의(필터 · 정렬 · 커서 · 10,000 상한) (API-4 · F-09-04 · F-09-16)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑧. 문은 `lib/api/v1.ts`, 일은 `lib/api/data-sources.ts` — 행은 앱의 행 질의
 * (`queryRows` — 권한 술어가 필터보다 먼저)를 지난다. 다른 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { queryDataSource } from '@/lib/api/data-sources'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(queryDataSource)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
