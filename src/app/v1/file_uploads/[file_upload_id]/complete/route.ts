/**
 * POST /v1/file_uploads/[file_upload_id]/complete — 공개 API: 여러 조각 업로드 마감 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪. `single_part` 만 받으므로 늘 400(보내면 끝이다 · 내 것이 아니면 404). 주소를 열어 두는
 * 까닭 — 없는 주소(400 `invalid_request_url`)가 아니라 "왜 안 되는지" 를 말한다.
 */

import { completeApiFileUpload } from '@/lib/api/file-uploads'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = unknownUrl
export const POST = v1Route(completeApiFileUpload)
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
