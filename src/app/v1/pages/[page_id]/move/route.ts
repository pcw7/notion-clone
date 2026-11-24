/**
 * POST /v1/pages/{page_id}/move — 공개 API: 페이지 옮기기 (API-10 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ①. 문은 `lib/api/v1.ts`, 일은 `lib/api/page-move.ts`(앱의 `movePage`).
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { moveApiPage } from '@/lib/api/page-move'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(moveApiPage)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
