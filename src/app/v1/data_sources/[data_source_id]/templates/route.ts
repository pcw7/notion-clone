/**
 * GET /v1/data_sources/{data_source_id}/templates — 공개 API: 데이터 소스의 템플릿 목록 (API-10 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ②. 문은 `lib/api/v1.ts`, 일은 `lib/api/templates.ts`(앱의 `listTemplates`).
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`(템플릿은 앱에서 만든다).
 */

import { listApiTemplates } from '@/lib/api/templates'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(listApiTemplates)
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
