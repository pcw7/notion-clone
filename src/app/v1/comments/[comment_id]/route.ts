/**
 * GET · PATCH · DELETE /v1/comments/{comment_id} — 공개 API: 코멘트 하나 읽기 · 내 코멘트 고치기 · 지우기 (API-5 · F-09-07)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ ⑩. 문은 `lib/api/v1.ts`, 일은 `lib/api/comments.ts`(`editComment` · `deleteComment`
 * — 작성자만). 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { deleteApiComment, retrieveApiComment, updateApiComment } from '@/lib/api/comments'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveApiComment)
export const PATCH = v1Route(updateApiComment)
export const DELETE = v1Route(deleteApiComment)
export const POST = unknownUrl
export const PUT = unknownUrl
