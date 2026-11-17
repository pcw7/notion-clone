/**
 * GET /v1/users/{user_id} — 공개 API: 이 워크스페이스의 사람 하나(노션의 person 사용자 객체) (API-5 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑩. 문은 `lib/api/v1.ts`, 일은 `lib/api/users.ts`. `users/me` 는 정적인 이웃 주소가
 * 먼저 받는다. 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { retrieveApiUser } from '@/lib/api/users'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveApiUser)
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
