/**
 * 공개 API 의 파일 업로드 객체 · 요청 — 노션의 `file_upload` (API-7 · F-09-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪ · §3.10 `api_file_upload` · 09-api-integrations.md F-09-08
 *
 *   · 상태 — 저장은 `pending` · `uploaded` 둘. `expired` 는 읽을 때(붙지 않았고 만료가 지났다) · `failed` 는 생기지 않는다
 *   · 만들기 — `single_part` 만(`multi_part` · `external_url` 은 까닭과 함께 거부) · `filename` 900바이트 · `content_type` 은 MIME 의 모양
 *     (매개변수는 뗀다 · 없으면 파일 이름의 확장자)
 *   · 보내기 — 형식은 만들 때 말한 것 → 보낸 부분의 것 → 이름의 확장자 → `octet-stream` 차례 · 이미지 · 비디오라 말하면 바이트가 그것이어야 한다
 *
 * 오류 글은 영어(노션의 말투) — 부르는 쪽이 `body failed validation: ` 을 붙인다.
 */

import { isAllowedMime, isVideoMime, MAX_FILENAME_BYTES, MAX_UPLOAD_BYTES, OCTET_STREAM, sniffImageMime, sniffVideoMime } from '../file/limits.ts'
import { shownValue } from './v1-protocol.ts'

/** 붙지 않은 업로드의 수명 — 노션의 1시간. */
export const FILE_UPLOAD_TTL_SECONDS = 60 * 60

export const FILE_UPLOAD_STATUSES = ['pending', 'uploaded', 'expired', 'failed'] as const
export type FileUploadStatus = (typeof FILE_UPLOAD_STATUSES)[number]

/** 표의 한 줄(`api_file_upload`). */
export type FileUploadRow = {
  readonly id: string
  readonly user_id: string
  readonly status: 'pending' | 'uploaded'
  readonly filename: string | null
  readonly content_type: string | null
  readonly content_length: string | number | null
  readonly created_at: Date
  readonly last_edited_at: Date
  readonly expires_at: Date | null
  readonly attached_at: Date | null
}

/** 노션의 상태 — 붙은 것은 늘 `uploaded` · 붙지 않았고 만료가 지났으면 `expired`. */
export function fileUploadStatus(row: Pick<FileUploadRow, 'status' | 'expires_at' | 'attached_at'>, now: Date): FileUploadStatus {
  if (row.attached_at === null && row.expires_at !== null && row.expires_at.getTime() <= now.getTime()) return 'expired'
  return row.status
}

/** 노션의 `file_upload` 객체. 보내기 주소(`upload_url`)는 보낼 수 있을 때(`pending`)만. */
export function fileUploadToApi(row: FileUploadRow, now: Date, origin: string, requestId: string): Record<string, unknown> {
  const status = fileUploadStatus(row, now)
  return {
    object: 'file_upload',
    id: row.id,
    created_time: row.created_at.toISOString(),
    last_edited_time: row.last_edited_at.toISOString(),
    expiry_time: row.expires_at === null ? null : row.expires_at.toISOString(),
    ...(status === 'pending' ? { upload_url: `${origin}/v1/file_uploads/${row.id}/send` } : {}),
    archived: false,
    in_trash: false,
    status,
    filename: row.filename,
    content_type: row.content_type,
    content_length: row.content_length === null ? null : Number(row.content_length),
    created_by: { id: row.user_id, type: 'person' },
    request_id: requestId,
  }
}

/** MIME 의 모양 — 표의 CHECK 과 같은 식(소문자 · 매개변수 없이). */
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/** `Image/PNG; charset=x` → `image/png` · 모양이 아니면 null. */
export function normalizeContentType(raw: string): string | null {
  const bare = raw.split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_SHAPE.test(bare) ? bare : null
}

const BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
}

/** 파일 이름의 확장자로 — 아는 것만(이미지 4 · 비디오 2 · pdf · txt). 모르면 null. */
export function contentTypeFromName(name: string | null): string | null {
  const m = name === null ? null : /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())
  return m === null ? null : (BY_EXTENSION[m[1]!.toLowerCase()] ?? null)
}

export type CreateFileUpload = { readonly filename: string | null; readonly contentType: string | null }
export type CreateParse = { readonly ok: true; readonly value: CreateFileUpload } | { readonly ok: false; readonly message: string }

const CREATE_KEYS = ['mode', 'filename', 'content_type', 'number_of_parts', 'external_url']
const MB = MAX_UPLOAD_BYTES / 1024 / 1024

/** 파일 이름 — 비지 않은 글 · 900바이트 · 제어 문자 없음. 틀리면 오류 글. */
export function filenameIssue(name: string, at: string): string | null {
  if (name.trim() === '') return `${at} should be a non-empty string, instead was ${shownValue(name)}.`
  if (Buffer.byteLength(name, 'utf8') > MAX_FILENAME_BYTES) {
    return `${at} should be at most ${MAX_FILENAME_BYTES} bytes, instead was ${Buffer.byteLength(name, 'utf8')} bytes.`
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) return `${at} should not contain control characters.`
  return null
}

/** `POST /v1/file_uploads` 의 본문 — 없으면 빈 객체와 같다(`single_part` · 이름 · 형식 없음). */
export function parseCreateFileUpload(body: unknown): CreateParse {
  const fail = (message: string): CreateParse => ({ ok: false, message })
  const input = body === undefined ? {} : body
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail(`body should be an object, instead was ${shownValue(input)}.`)
  const raw = input as Record<string, unknown>
  const extra = Object.keys(raw).find((k) => !CREATE_KEYS.includes(k))
  if (extra !== undefined) return fail(`body.${extra} should be not present, instead was ${shownValue(raw[extra])}.`)

  const mode = raw.mode ?? 'single_part'
  if (mode === 'multi_part') {
    return fail(`body.mode "multi_part" is not supported — a file can be at most ${MB}MB here, so send it in one part ("single_part").`)
  }
  if (mode === 'external_url') {
    return fail('body.mode "external_url" is not supported — this API does not download files from other sites. Link them with {"type":"external","external":{"url":…}} instead.')
  }
  if (mode !== 'single_part') return fail(`body.mode should be "single_part", instead was ${shownValue(mode)}.`)
  if (raw.number_of_parts !== undefined) return fail('body.number_of_parts should be not present — it is only for "multi_part" uploads, which are not supported.')
  if (raw.external_url !== undefined) return fail('body.external_url should be not present — it is only for "external_url" uploads, which are not supported.')

  let filename: string | null = null
  if (raw.filename !== undefined && raw.filename !== null) {
    if (typeof raw.filename !== 'string') return fail(`body.filename should be a string, instead was ${shownValue(raw.filename)}.`)
    const issue = filenameIssue(raw.filename, 'body.filename')
    if (issue !== null) return fail(issue)
    filename = raw.filename.trim()
  }
  let contentType: string | null = null
  if (raw.content_type !== undefined && raw.content_type !== null) {
    if (typeof raw.content_type !== 'string') return fail(`body.content_type should be a string, instead was ${shownValue(raw.content_type)}.`)
    contentType = normalizeContentType(raw.content_type)
    if (contentType === null) return fail(`body.content_type should be a MIME type like "image/png", instead was ${shownValue(raw.content_type)}.`)
  }
  return { ok: true, value: { filename, contentType: contentType ?? contentTypeFromName(filename) } }
}

/** `GET /v1/file_uploads?status=` — 없으면 undefined · 모르는 값은 null(400). */
export function parseListStatus(raw: string | null): FileUploadStatus | undefined | null {
  if (raw === null || raw === '') return undefined
  return (FILE_UPLOAD_STATUSES as readonly string[]).includes(raw) ? (raw as FileUploadStatus) : null
}

/**
 * 보내기의 형식 · 이름 — 만들 때 말한 것이 먼저, 없으면 보낸 부분의 것(브라우저 · SDK 의 Blob 은 이름이 `blob` 이고 형식이 빌 수 있다 — 없는 것과
 * 같다) → 이름의 확장자 → `octet-stream`.
 */
export function resolveSendInput(input: {
  readonly declaredType: string | null
  readonly declaredName: string | null
  readonly partType: string
  readonly partName: string
}): { readonly mime: string; readonly originalName: string | null } {
  const partName = input.partName.trim() === '' || input.partName === 'blob' ? null : input.partName
  const originalName = input.declaredName ?? partName
  const partType = normalizeContentType(input.partType)
  const mime = input.declaredType ?? (partType === OCTET_STREAM ? null : partType) ?? contentTypeFromName(originalName) ?? OCTET_STREAM
  return { mime, originalName }
}

/** 이미지 · 비디오라 말했는데 바이트가 그것이 아니다 — 앱의 파일 길은 조용히 `octet-stream` 으로 낮추지만 API 는 말한다(정본 ⑪). */
export function contentMismatch(mime: string, bytes: Uint8Array): boolean {
  if (isAllowedMime(mime)) return sniffImageMime(bytes) !== mime
  if (isVideoMime(mime)) return sniffVideoMime(bytes) !== mime
  return false
}
