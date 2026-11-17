/**
 * GET /v1/users — 공개 API: 이 워크스페이스의 활동 중인 멤버(노션의 person 사용자 객체 · 쪽 나누기) (API-5 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑩. 문은 `lib/api/v1.ts`, 일은 `lib/api/users.ts` — 앱의 멤버 목록(`listMembers`)과
 * 같은 규칙. 받지 않는 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { listApiUsers } from '@/lib/api/users'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(listApiUsers)
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
