/**
 * GET /v1/data_sources/{data_source_id} — 공개 API: 데이터 소스 객체(속성 스키마) 읽기 (API-4 · F-09-16 · F-09-17)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑧. 문은 `lib/api/v1.ts`, 일은 `lib/api/data-sources.ts`.
 * 고치기(`PATCH` — 스키마)는 이 조각에 없다 — 400 `validation_error`(앱에서 고친다). 다른 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { retrieveDataSource, unsupportedSchemaWrite } from '@/lib/api/data-sources'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveDataSource)
export const PATCH = v1Route(unsupportedSchemaWrite)
export const POST = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
