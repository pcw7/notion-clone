/**
 * 공개 API 의 파일 올리기 — `POST /v1/file_uploads` · `…/{id}/send` · `…/{id}/complete` · `GET …/{id}` · `GET /v1/file_uploads`
 * (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪ · §3.10 `api_file_upload` · 모양 · 해석은 `file-upload-object.ts`(순수)
 *
 *   · 세션의 주인은 토큰의 사람 — 남의 것 · 다른 워크스페이스의 것은 404(있는지 새지 않는다)
 *   · 보내기는 앱의 업로드 길(`uploadFileIn` — 같은 판정 · 같은 MIME 가리기 · 같은 상한 · 같은 `file` 행)을 세션 행과 **한 트랜잭션**에서 —
 *     파일 id = 세션 id. 저장소에 먼저 쓰고, 되돌려지면 쓴 객체를 지운다(`file.ts` 의 순서)
 *   · 붙이기는 각 자리(블록 · 속성 · 아이콘 · 커버)가 `upload-claim.ts` 로 — 여기는 세션의 일만
 *   · 모두 내보내기 정책 게이트를 지난다(다른 API 와 같다) · 요청 제한은 부를 때마다(`v1Route`)
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { discardStoredObjects, uploadFileIn } from '../file/file.ts'
import type { UploadRejection } from '../file/limits.ts'
import {
  contentMismatch,
  fileUploadStatus,
  fileUploadToApi,
  parseCreateFileUpload,
  parseListStatus,
  resolveSendInput,
  FILE_UPLOAD_TTL_SECONDS,
  type FileUploadRow,
  type FileUploadStatus,
} from './file-upload-object.ts'
import { apiLinks, bodyInvalid, invalid, policyBlock } from './pages.ts'
import { v1Fail, v1Ok, type V1Handler, type V1Reply } from './v1.ts'
import {
  API_MAX_PAGE_SIZE,
  API_MESSAGES,
  decodeBoundCursor,
  encodeBoundCursor,
  invalidPathIdMessage,
  parseApiId,
  parsePageSize,
  shownValue,
} from './v1-protocol.ts'

const COLUMNS = `id, user_id, status, filename, content_type, content_length, created_at, last_edited_at, expires_at, attached_at`

const notFound = (id: string): V1Reply => v1Fail(404, 'object_not_found', `Could not find file upload with ID: ${id}.`)

/** 보낼 수 없는 상태의 글 — 이미 보냈다 · 지났다. */
function notPendingReply(status: FileUploadStatus, id: string): V1Reply {
  return status === 'expired'
    ? invalid(`File upload ${id} has expired. Create a new file upload and send the file again.`)
    : invalid(`File upload ${id} has already been sent (status "${status}"). Create a new file upload to send another file.`)
}

/** 앱의 업로드가 거부한 까닭 — 노션의 `validation_error`(크기도 400 — 정본 ④ 와 같은 자리). */
function rejectionReply(reason: UploadRejection): V1Reply {
  switch (reason) {
    case 'too_large':
      return invalid(API_MESSAGES.fileTooLarge)
    case 'empty_file':
      return bodyInvalid('file should not be empty.')
    case 'name_too_long':
      return bodyInvalid('file name should be at most 900 bytes.')
    case 'unsupported_type':
      return bodyInvalid('file type is not supported.')
  }
}

/** 내 세션 하나 — 남의 것 · 다른 워크스페이스의 것은 null. */
async function ownUploadIn(tx: Tx, ctx: SessionContext, id: string, lock = false): Promise<FileUploadRow | null> {
  return tx.queryMaybe<FileUploadRow>(
    `SELECT ${COLUMNS} FROM api_file_upload WHERE id = $1 AND workspace_id = $2 AND user_id = $3${lock ? ' FOR UPDATE' : ''}`,
    [id, ctx.workspaceId, ctx.userId],
  )
}

/** `POST /v1/file_uploads` — `single_part` 세션을 만든다(만료는 1시간 뒤). */
export const createApiFileUpload: V1Handler = async ({ ctx, body, request, requestId }) => {
  const parsed = parseCreateFileUpload(body)
  if (!parsed.ok) return bodyInvalid(parsed.message)
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const row = await withTransaction((tx) =>
    tx.queryOne<FileUploadRow>(
      `INSERT INTO api_file_upload (id, workspace_id, user_id, status, filename, content_type, expires_at)
       VALUES ($1, $2, $3, 'pending', $4, $5, now() + $6::int * interval '1 second')
       RETURNING ${COLUMNS}`,
      [randomUUID(), ctx.workspaceId, ctx.userId, parsed.value.filename, parsed.value.contentType, FILE_UPLOAD_TTL_SECONDS],
    ),
  )
  return v1Ok(fileUploadToApi(row, new Date(), apiLinks(ctx, request).origin, requestId))
}

/** `GET /v1/file_uploads/{file_upload_id}` — 내 것만. */
export const retrieveApiFileUpload: V1Handler = async ({ ctx, params, request, requestId }) => {
  const id = parseApiId(params.file_upload_id)
  if (id === null) return invalid(invalidPathIdMessage('file_upload_id', params.file_upload_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const row = await withReadTransaction((tx) => ownUploadIn(tx, ctx, id))
  return row === null ? notFound(id) : v1Ok(fileUploadToApi(row, new Date(), apiLinks(ctx, request).origin, requestId))
}

type SendStep = { readonly ok: true; readonly row: FileUploadRow } | { readonly ok: false; readonly reply: V1Reply }

/**
 * `POST /v1/file_uploads/{file_upload_id}/send` — `multipart/form-data` 의 `file` 하나(본문 상한은 파일의 상한 + 64KB · `v1Route` 의 multipart).
 * 상태를 바이트보다 먼저 본다 · 형식이 말한 것과 다르면 400 · 저장은 앱의 길(세션 행을 잠근 트랜잭션에서).
 */
export const sendApiFileUpload: V1Handler = async ({ ctx, params, body, request, requestId }) => {
  const id = parseApiId(params.file_upload_id)
  if (id === null) return invalid(invalidPathIdMessage('file_upload_id', params.file_upload_id))
  if (!(body instanceof FormData)) return invalid(API_MESSAGES.multipartRequired)
  const part = body.get('file')
  if (!(part instanceof File)) return bodyInvalid(`file should be a file field of the multipart/form-data body, instead was ${part === null ? 'missing' : 'a text field'}.`)
  if (body.get('part_number') !== null) return bodyInvalid('part_number should be not present — "single_part" uploads are sent in one request.')
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const head = await withReadTransaction((tx) => ownUploadIn(tx, ctx, id))
  if (head === null) return notFound(id)
  const before = fileUploadStatus(head, new Date())
  if (before !== 'pending') return notPendingReply(before, id)

  const bytes = new Uint8Array(await part.arrayBuffer())
  const input = resolveSendInput({ declaredType: head.content_type, declaredName: head.filename, partType: part.type, partName: part.name })
  if (bytes.byteLength > 0 && contentMismatch(input.mime, bytes)) {
    return bodyInvalid(`file content is not ${input.mime} (the file upload's content_type). Send the file that content_type describes, or create the upload with the right content_type.`)
  }

  const stored: string[] = []
  let step: SendStep
  try {
    step = await withCommandTransaction(async (tx): Promise<SendStep> => {
      const locked = await ownUploadIn(tx, ctx, id, true)
      if (locked === null) return { ok: false, reply: notFound(id) }
      const status = fileUploadStatus(locked, new Date())
      if (status !== 'pending') return { ok: false, reply: notPendingReply(status, id) }
      const up = await uploadFileIn(tx, ctx, { id, bytes, mime: input.mime, originalName: input.originalName, kind: 'file' }, stored)
      if (!up.ok) return { ok: false, reply: rejectionReply(up.reason) }
      const row = await tx.queryOne<FileUploadRow>(
        `UPDATE api_file_upload
            SET status = 'uploaded', file_id = $1, filename = $4, content_type = $5, content_length = $6, last_edited_at = clock_timestamp()
          WHERE id = $1 AND workspace_id = $2 AND user_id = $3
          RETURNING ${COLUMNS}`,
        [id, ctx.workspaceId, ctx.userId, up.file.originalName, up.file.mime, up.file.sizeBytes],
      )
      return { ok: true, row }
    })
  } catch (e) {
    await discardStoredObjects(stored)
    throw e
  }
  if (!step.ok) {
    await discardStoredObjects(stored)
    return step.reply
  }
  return v1Ok(fileUploadToApi(step.row, new Date(), apiLinks(ctx, request).origin, requestId))
}

/** `POST /v1/file_uploads/{file_upload_id}/complete` — single_part 는 보내면 끝이라 늘 400(내 것이 아니면 404). */
export const completeApiFileUpload: V1Handler = async ({ ctx, params }) => {
  const id = parseApiId(params.file_upload_id)
  if (id === null) return invalid(invalidPathIdMessage('file_upload_id', params.file_upload_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const row = await withReadTransaction((tx) => ownUploadIn(tx, ctx, id))
  if (row === null) return notFound(id)
  return invalid(`File upload ${id} is a "single_part" upload — it is complete once the file is sent. "multi_part" uploads are not supported.`)
}

/** 상태 거르기의 SQL — 읽을 때의 판정(`fileUploadStatus`)과 같은 뜻. */
const STATUS_SQL: Readonly<Record<FileUploadStatus, string>> = {
  pending: `status = 'pending' AND expires_at > now()`,
  uploaded: `status = 'uploaded' AND (attached_at IS NOT NULL OR expires_at > now())`,
  expired: `attached_at IS NULL AND expires_at <= now()`,
  failed: `false`,
}

/** `GET /v1/file_uploads` — 내 것만 · 최근 것부터 · `status` · `page_size`(≤ 100) · `start_cursor`(그 거르기에 묶인다). */
export const listApiFileUploads: V1Handler = async ({ ctx, request, requestId }) => {
  const query = new URL(request.url).searchParams
  const status = parseListStatus(query.get('status'))
  if (status === null) {
    return invalid(`query failed validation: query.status should be "pending", "uploaded", "expired" or "failed", instead was ${shownValue(query.get('status'))}.`)
  }
  const pageSize = parsePageSize(query.get('page_size'))
  if (pageSize === null) {
    return invalid(`query failed validation: query.page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(query.get('page_size'))}.`)
  }
  const binding = `file_uploads:${status ?? ''}`
  const offset = decodeBoundCursor(binding, query.get('start_cursor'))
  if (offset === null) return invalid('query failed validation: query.start_cursor is not a valid cursor.')
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const rows = await withReadTransaction((tx) =>
    tx.query<FileUploadRow>(
      `SELECT ${COLUMNS} FROM api_file_upload
        WHERE workspace_id = $1 AND user_id = $2${status === undefined ? '' : ` AND ${STATUS_SQL[status]}`}
        ORDER BY created_at DESC, id DESC
        OFFSET $3 LIMIT $4`,
      [ctx.workspaceId, ctx.userId, offset, pageSize + 1],
    ),
  )
  const now = new Date()
  const origin = apiLinks(ctx, request).origin
  const more = rows.length > pageSize
  return v1Ok({
    object: 'list',
    results: rows.slice(0, pageSize).map((row) => fileUploadToApi(row, now, origin, requestId)),
    next_cursor: more ? encodeBoundCursor(binding, offset + pageSize) : null,
    has_more: more,
    type: 'file_upload',
    file_upload: {},
    request_id: requestId,
  })
}
