/**
 * GET /v1/databases/{database_id} — 공개 API: 데이터베이스 객체 읽기 (API-4 · F-09-01 · F-09-16)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑧ · 공개 API 투영 규칙. 문은 `lib/api/v1.ts`, 일은 `lib/api/data-sources.ts`.
 * 고치기(`PATCH`)는 이 조각에 없다 — 400 `validation_error`(앱에서 고친다). 다른 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { retrieveDatabase, unsupportedSchemaWrite } from '@/lib/api/data-sources'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveDatabase)
export const PATCH = v1Route(unsupportedSchemaWrite)
export const POST = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
