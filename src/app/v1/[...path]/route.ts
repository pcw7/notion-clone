/**
 * /v1/* 의 나머지 — 아직 없는 주소 (API-1 · F-09-05)
 *
 * 노션처럼 400 `invalid_request_url` 을 노션의 오류 모양으로 준다(앱의 HTML 404 를 API 에 내지 않는다). 문(토큰 · 판 · 제한)은 같은
 * `v1Route` 를 지난다 — 토큰 없이 주소를 더듬는 것도 401 이다. 페이지 · 블록 · 데이터 소스 · 검색 · 코멘트 · 사용자는 각자의 라우트가
 * 연다(API-2~5) — 정적인 주소가 이 잡이보다 먼저다.
 */

import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = unknownUrl
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
