/**
 * GET /v1/file_uploads/[file_upload_id] — 공개 API: 업로드 하나 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪. 내 것만(남의 것은 404). 받지 않는 메서드는 400 `invalid_request_url`.
 */

import { retrieveApiFileUpload } from '@/lib/api/file-uploads'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(retrieveApiFileUpload)
export const POST = unknownUrl
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
