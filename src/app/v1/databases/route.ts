/**
 * POST /v1/databases — 공개 API: 데이터베이스 만들기 (API-4b · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑨. 문은 `lib/api/v1.ts`, 일은 `lib/api/schema-writes.ts`(페이지 본문 안의 인라인
 * 데이터베이스와 첫 데이터 소스의 속성들 — 앱의 명령으로 한 트랜잭션). 다른 메서드는 노션처럼 400 `invalid_request_url`.
 */

import { createApiDatabase } from '@/lib/api/schema-writes'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const POST = v1Route(createApiDatabase)
export const GET = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
