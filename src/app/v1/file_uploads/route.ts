/**
 * GET · POST /v1/file_uploads — 공개 API: 내 업로드 목록 · 업로드 만들기 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪. 문은 `lib/api/v1.ts`, 일은 `lib/api/file-uploads.ts`. 받지 않는 메서드는 노션처럼
 * 400 `invalid_request_url`.
 */

import { createApiFileUpload, listApiFileUploads } from '@/lib/api/file-uploads'
import { v1InvalidUrl, v1Route } from '@/lib/api/v1'

const unknownUrl = v1Route(v1InvalidUrl)

export const GET = v1Route(listApiFileUploads)
export const POST = v1Route(createApiFileUpload)
export const PATCH = unknownUrl
export const PUT = unknownUrl
export const DELETE = unknownUrl
