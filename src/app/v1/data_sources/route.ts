/**
 * POST /v1/data_sources — 공개 API: 데이터 소스 만들기 (API-4b · F-09-01 · F-09-16)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑨. 문은 `lib/api/v1.ts`, 일은 `lib/api/schema-writes.ts`(앱의 "데이터 소스 더하기" 와
 * 속성들 — 한 트랜잭션). 다른 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { createApiDataSource } from '@/lib/api/schema-writes'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(createApiDataSource)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
