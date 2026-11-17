/**
 * GET · POST /v1/comments — 공개 API: 열린 코멘트 읽기(쪽 나누기) · 새 스레드 · 답글 (API-5 · F-09-07 · F-09-04)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑩. 문은 `lib/api/v1.ts`, 일은 `lib/api/comments.ts` — 앱의 코멘트 명령
 * (`comment/discussion.ts`)을 지난다. 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { createApiComment, listApiComments } from '@/lib/api/comments'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(listApiComments)
export const POST = v1Route(createApiComment)
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
