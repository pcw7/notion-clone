/**
 * GET · PATCH /v1/blocks/{block_id}/children — 공개 API: 자식 블록 읽기(쪽 나누기) · 붙이기 (API-3 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤. 문은 `lib/api/v1.ts`, 일은 `lib/api/blocks.ts`.
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { appendBlockChildren, retrieveBlockChildren } from '@/lib/api/blocks'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveBlockChildren)
export const PATCH = v1Route(appendBlockChildren)
export const POST = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
