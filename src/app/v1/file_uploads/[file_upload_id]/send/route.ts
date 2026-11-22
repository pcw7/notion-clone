/**
 * POST /v1/file_uploads/[file_upload_id]/send — 공개 API: 파일 보내기 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪. 본문은 `multipart/form-data` 의 `file` 하나 — 상한은 500KB 가 아니라 파일의 상한 +
 * 64KB(`v1Route` 의 `{ body: 'multipart' }`). 받지 않는 메서드는 400 `invalid_request_url`.
 */

import { sendApiFileUpload } from '@/lib/api/file-uploads'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = unknownUrl
export const POST = v1Route(sendApiFileUpload, { body: 'multipart' })
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
