/**
 * GET /v1/custom_emojis — 공개 API: 사용자 지정 이모지 목록 (API-10 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ②. 문은 `lib/api/v1.ts`, 일은 `lib/api/custom-emojis.ts`(앱의 `listCustomEmoji`).
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`(이모지는 앱에서 올린다).
 */

import { listApiCustomEmojis } from '@/lib/api/custom-emojis'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(listApiCustomEmojis)
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
