/**
 * POST /v1/pages — 공개 API: 페이지 · 데이터베이스 행 만들기 (API-2 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤. 문(토큰 · 판 · 게이트 · 제한 · 오류 모양)은 `lib/api/v1.ts`, 일은 `lib/api/pages.ts`.
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { createApiPage } from '@/lib/api/pages'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(createApiPage)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
