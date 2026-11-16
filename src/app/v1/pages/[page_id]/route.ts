/**
 * GET · PATCH /v1/pages/{page_id} — 공개 API: 페이지 객체 읽기 · 속성 · 아이콘 · 커버 · 휴지통 (API-2 · F-09-01 · F-09-17)
 *
 * 정본: 00-canonical-data-model.md §3.1 공개 API 투영 규칙 · [보강 API-1] ③ ⑤. 문은 `lib/api/v1.ts`, 일은 `lib/api/pages.ts`.
 * 받지 않는 메서드는 노션처럼 400 `invalid_request_url`(지우기는 `PATCH { in_trash: true }` 다).
 */

import { retrievePage, updateApiPage } from '@/lib/api/pages'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrievePage)
export const PATCH = v1Route(updateApiPage)
export const POST = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
