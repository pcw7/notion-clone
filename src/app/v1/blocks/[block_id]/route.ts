/**
 * GET · PATCH · DELETE /v1/blocks/{block_id} — 공개 API: 블록 하나 읽기 · 고치기 · 휴지통 (API-3 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ · 공개 API 투영 규칙. 문은 `lib/api/v1.ts`, 일은 `lib/api/blocks.ts`.
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { deleteApiBlock, retrieveBlock, updateApiBlock } from '@/lib/api/blocks'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveBlock)
export const PATCH = v1Route(updateApiBlock)
export const DELETE = v1Route(deleteApiBlock)
export const POST = unknownUrl
export const PUT = unknownUrl
