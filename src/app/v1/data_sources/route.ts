/**
 * POST /v1/data_sources — 데이터 소스 만들기 (API-4 — 이 조각에 없다)
 *
 * 구조 고치기는 공개 API 로 하지 않는다 — 400 `validation_error`(앱에서 만든다 · `lib/api/data-sources.ts` 머리말). 다른 메서드는 노션처럼
 * 400 `invalid_request_url`.
 */

import { unsupportedSchemaWrite } from '@/lib/api/data-sources'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(unsupportedSchemaWrite)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
