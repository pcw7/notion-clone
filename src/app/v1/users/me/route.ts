/**
 * GET /v1/users/me — 공개 API: 토큰을 만든 사람(노션의 person 사용자 객체) (API-1 · F-09-02)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③. 문(토큰 · 판 · 게이트 · 제한 · 오류 모양)은 `lib/api/v1.ts` 하나다 — 여기에 베끼지 않는다.
 * 쿠키는 보지 않는다(`Authorization: Bearer` 만).
 */

import { usersMe } from '@/lib/api/users'
import { v1Route } from '@/lib/api/v1'

export const GET = v1Route(usersMe)
