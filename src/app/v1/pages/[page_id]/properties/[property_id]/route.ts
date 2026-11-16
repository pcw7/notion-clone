/**
 * GET /v1/pages/{page_id}/properties/{property_id} — 공개 API: property item (API-2 · F-09-17)
 *
 * 정본: 09-api-integrations.md F-09-17 — 제목 · 글 · relation · 사람은 쪽으로 나눈 목록(`page_size` ≤ 100 · `start_cursor`), 나머지는 항목 하나.
 * 문은 `lib/api/v1.ts`, 일은 `lib/api/pages.ts`. 받지 않는 메서드는 400 `invalid_request_url`.
 */

import { retrievePageProperty } from '@/lib/api/pages'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrievePageProperty)
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
