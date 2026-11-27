/**
 * 공개 API 의 페이지 — `GET/PATCH /v1/pages/{id}` · `POST /v1/pages` · `GET /v1/pages/{id}/properties/{property_id}` (API-2 · F-09-01 · F-09-17)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ · 공개 API 투영 규칙 · 09-api-integrations.md F-09-01 · F-09-17
 *
 * **모든 일은 토큰을 만든 사람으로 앱의 명령을 지난다** — 권한 SQL 을 여기서 쓰지 않는다:
 *   · 페이지 밑에 만들기 `createPageIn`(부모의 `create_child`) · 행 만들기 `createRowIn`(소스의 `create_child`) · 칸 `updateCellsIn` ·
 *     연결 `linkRowsIn` · 제목 `renamePageIn` · 아이콘 · 커버 `setPageIconIn` · `setPageCoverIn` — 한 명령 트랜잭션에 묶는다(하나라도 거부되면
 *     아무것도 바뀌지 않는다) · 휴지통 `trashPage` · `trashRow` · 되살리기 `restorePage`
 *   · 쓰기의 출처는 앱의 서버 명령 그대로 — 본문 쓰기(하위 페이지의 참조)는 `doc_update.origin = 'api'` · 행위자는 그 사람 · 데이터베이스
 *     자동화는 사람의 편집처럼 깨운다(정본 ⑤ — 칸 쓰기의 출처 `user`)
 *   · 내보내기 정책(`allow_export`)을 끄면 소유자만 — 이 주소들은 모두 페이지의 내용을 돌려주므로(쓰기의 응답도 페이지 객체다) 읽기 · 쓰기
 *     모두 같은 게이트를 지난다. 403 `restricted_resource`(권한 거부와 같은 코드 · 다른 글)
 *
 * 오류 — 볼 수 없으면 404 `object_not_found`(있는지 새지 않는다) · 볼 수만 있고 고칠 수 없으면 403 `restricted_resource`(09 F-09-01 *"403 은
 * capability 부족"*) · 모양이 틀린 id · 본문 400 `validation_error` · 잠긴 페이지는 400 `validation_error`(노션이 휴지통의 블록을 고칠 때 주는
 * 자리 — 상태 때문에 고칠 수 없다는 뜻이 같다) · 동시 쓰기의 충돌은 409 `conflict_error`.
 *
 * `children`(API-3) — 블록 JSON 을 우리 블록으로(`block-json.ts` — 블록 API 와 같은 변환 · 같은 상한) 옮겨 **같은 명령 트랜잭션에서** 새 페이지의
 * 본문 세션으로 쓴다(경로 ② · 출처 `api` · `block-body.ts`). 블록이 거부되면 페이지도 생기지 않는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { createPageIn, PageError, renamePageIn, setPageCoverIn, setPageIconIn } from '../block/page.ts'
import { parsePageCoverInput, type PageCover } from '../block/page-cover.ts'
import { parsePageIconInput, type PageIcon } from '../block/page-icon.ts'
import { restorePage, trashPage, TrashError } from '../block/trash.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import { listDataSources } from '../database/data-source.ts'
import type { SelectOption } from '../database/property-types.ts'
import { MAX_LINKS_PER_REQUEST, linkRowsIn } from '../database/relation.ts'
import { createRowIn, isRowFailure, openDataSource, trashRow, updateCellsIn, type RowCell } from '../database/row.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { exportPolicyAllows } from '../export/download.ts'
import type { EditorBlock } from '../editor/document.ts'
import { asBlockId } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { newApiBlockId, syncedRefIssueIn, uploadIssueIn, writeNewPageBodyIn } from './block-body.ts'
import { parseApiChildren, type SyncedRef, type UploadRef } from './block-json.ts'
import { fileUrlKey, ownFileIdOf, signedFileUrl } from './file-url.ts'
import { loadPageIn, readApiOptions, readApiPage, readApiPageOnly, readApiProperties, readPropertyItem, visibleRelationIn } from './page-object.ts'
import { TITLE_PROPERTY_ID, findProperty, parsePropertyWrite, type ApiProperty, type ApiWrite } from './property-values.ts'
import type { ApiLinks } from './rich-text.ts'
import { claimApiUploadsIn, type UploadClaim } from './upload-claim.ts'
import { v1Fail, v1Ok, type V1Handler, type V1Reply } from './v1.ts'
import { API_MAX_PAGE_SIZE, decodeCursor, invalidPathIdMessage, parseApiId, parsePageSize, shownValue } from './v1-protocol.ts'

// ── 답 ────────────────────────────────────────────────────────────────

const RESTRICTED_MESSAGE = "Given the bearer token used, the client doesn't have permission to perform this operation."
const POLICY_MESSAGE = 'The workspace security policy disables export for members, so only workspace owners can use the pages and blocks API.'
export const LOCKED_MESSAGE = "Can't edit page that is locked. Unlock the page in the app before editing."
const TRASHED_MESSAGE = "Can't edit page that is in trash. Restore it first by setting in_trash to false."
const CONFLICT_MESSAGE = 'Conflict occurred while saving. Please try again.'

export const notFound = (kind: 'page' | 'data source' | 'database', id: string): V1Reply =>
  v1Fail(404, 'object_not_found', `Could not find ${kind} with ID: ${id}.`)
export const restricted = (): V1Reply => v1Fail(403, 'restricted_resource', RESTRICTED_MESSAGE)
export const invalid = (message: string): V1Reply => v1Fail(400, 'validation_error', message)
export const bodyInvalid = (clause: string): V1Reply => invalid(`body failed validation: ${clause}`)
export const conflict = (): V1Reply => v1Fail(409, 'conflict_error', CONFLICT_MESSAGE)

/**
 * 앱의 주소 — 설정한 공개 주소(`NEXT_PUBLIC_APP_URL` — 초대 링크 · 자동화와 같은 값), 없으면 요청의 출처. 올린 파일은 그 출처의 서명 주소
 * (API-7 · 한 응답 안에서는 같은 시각으로 — 같은 파일은 같은 주소).
 */
export function apiLinks(ctx: SessionContext, request: Request): ApiLinks {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '')
  const now = new Date()
  return {
    origin,
    pageUrl: (pageId) => `${origin}/w/${ctx.workspaceId}/${pageId}`,
    fileUrl: (fileId) => signedFileUrl(origin, fileUrlKey(), fileId, now),
  }
}

/** 내보내기 정책(정본 [보강] 보안 정책 ① · [보강 API-1] ⑤) — 끄면 소유자만. 블록 API 도 같은 게이트다(내용을 돌려준다). */
export async function policyBlock(ctx: SessionContext): Promise<V1Reply | null> {
  return (await exportPolicyAllows(ctx)) ? null : v1Fail(403, 'restricted_resource', POLICY_MESSAGE)
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 받지 않는 키 — 노션의 말투(`should be not present`). */
export function unexpectedKey(body: Record<string, unknown>, allowed: readonly string[]): V1Reply | null {
  const extra = Object.keys(body).find((k) => !allowed.includes(k))
  return extra === undefined ? null : bodyInvalid(`body.${extra} should be not present, instead was ${shownValue(body[extra])}.`)
}

/** 동시 쓰기의 충돌 — 직렬화 실패 · 교착 · 같은 자리의 키(형제 순서) · 잠금 대기 실패. */
export function isConflict(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  return code === '40001' || code === '40P01' || code === '23505' || code === '55P03'
}

function pageErrorReply(e: PageError, id: string): V1Reply {
  switch (e.code) {
    case 'parent_not_found':
    case 'not_found':
      return notFound('page', id)
    case 'forbidden':
      return restricted()
    case 'locked':
      return invalid(LOCKED_MESSAGE)
    case 'too_deep':
      return invalid('The page is nested too deeply. Create it under a page closer to the top.')
    case 'invalid_title':
      return bodyInvalid('body.properties.title is invalid.')
    case 'invalid_icon':
      return bodyInvalid('body.icon is not usable — an uploaded image must be an image of this workspace, a custom emoji must exist.')
    case 'invalid_cover':
      return bodyInvalid('body.cover is not usable — an uploaded cover must be an image of this workspace.')
    default:
      return invalid(e.message)
  }
}

export function trashErrorReply(e: TrashError, id: string): V1Reply {
  switch (e.code) {
    case 'not_found':
      return notFound('page', id)
    case 'forbidden':
      return restricted()
    case 'not_a_trash_root':
      return invalid(`This page was moved to trash together with ${e.trashRootId ?? 'its parent'}. Restore that page instead.`)
    case 'source_trashed':
      return invalid('The data source of this page is in trash. Restore the data source first.')
  }
}

type RowLikeFailure = { readonly reason: string; readonly issues?: readonly { readonly path: string }[] }

/** 행 · 연결 명령의 거부 → 노션의 답. `properties` 로 칸의 이름을 찾는다(오류 글에 싣는다). */
export function rowFailureReply(failure: RowLikeFailure, id: string, properties: readonly ApiProperty[], fallbackName?: string): V1Reply {
  switch (failure.reason) {
    case 'not_found':
      return notFound('page', id)
    case 'forbidden':
    case 'shift_forbidden':
      return restricted()
    case 'locked':
      return invalid(LOCKED_MESSAGE)
    case 'version_conflict':
    case 'schema_conflict':
      return conflict()
    case 'shift_too_large':
      return invalid('Changing this date would move too many dependent rows. Change fewer rows at once.')
    case 'unknown_property':
    case 'readonly_property':
      return bodyInvalid(`body.properties${fallbackName === undefined ? '' : `.${fallbackName}`} cannot be updated.`)
    default: {
      const propertyId = /^cells\.([^.[]+)/.exec(failure.issues?.[0]?.path ?? '')?.[1]
      const name = properties.find((p) => p.id === propertyId)?.name ?? fallbackName
      return bodyInvalid(
        name === undefined
          ? 'body.properties has a value that is not allowed.'
          : `body.properties.${name} has a value that is not allowed (a person outside the workspace, an option or row that does not exist, or a file from another workspace).`,
      )
    }
  }
}

// ── 받기 ──────────────────────────────────────────────────────────────

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reply: V1Reply }
const parsed = <T>(value: T): Parsed<T> => ({ ok: true, value })
const refused = <T>(reply: V1Reply): Parsed<T> => ({ ok: false, reply })

/**
 * 아이콘 · 커버의 올린 파일 — `file_upload {id}`(API-7 의 업로드 · 앱에서 올린 파일) · 읽은 `file {url}`(우리 서명 주소의 왕복 — 만료는 보지
 * 않는다). 우리 주소가 아닌 `file` 은 거부한다(바깥 주소는 `external`).
 */
function uploadedFileOf(raw: Record<string, unknown>, kind: 'file_upload' | 'file', at: string): Parsed<{ type: 'file'; file_id: string } | undefined> {
  if (kind === 'file_upload') {
    const id = parseApiId(isObject(raw.file_upload) ? raw.file_upload.id : undefined)
    return parsed(id === null ? undefined : { type: 'file', file_id: id })
  }
  const url = isObject(raw.file) ? raw.file.url : undefined
  const id = typeof url === 'string' ? ownFileIdOf(url) : null
  if (id === null) {
    return refused(bodyInvalid(`${at}.file.url should be a file URL read from this API (send it back unchanged) — use "external" for other URLs, instead was ${shownValue(url)}.`))
  }
  return parsed({ type: 'file', file_id: id })
}

/**
 * 노션의 아이콘(요청) → 우리 아이콘. `file_upload` · `file` 은 이 워크스페이스에 올린 이미지다(API 업로드 세션은 `lookClaims` 가 · 이미지인지는
 * 명령이 다시 본다). 데이터베이스의 아이콘(API-4b)도 같은 모양이다.
 */
export function parseIcon(raw: unknown): Parsed<PageIcon | null> {
  if (raw === null) return parsed(null)
  if (!isObject(raw)) return refused(bodyInvalid(`body.icon should be an object or \`null\`, instead was ${shownValue(raw)}.`))
  const kind = raw.type ?? ['emoji', 'external', 'file_upload', 'custom_emoji', 'file'].find((k) => k in raw)
  let candidate: unknown
  if (kind === 'emoji') candidate = { type: 'emoji', emoji: raw.emoji }
  else if (kind === 'external') candidate = { type: 'external', url: isObject(raw.external) ? raw.external.url : undefined }
  else if (kind === 'file_upload' || kind === 'file') {
    const file = uploadedFileOf(raw, kind, 'body.icon')
    if (!file.ok) return file
    candidate = file.value
  } else if (kind === 'custom_emoji') {
    const id = parseApiId(isObject(raw.custom_emoji) ? raw.custom_emoji.id : undefined)
    candidate = id === null ? undefined : { type: 'custom_emoji', custom_emoji: { id } }
  } else {
    return refused(bodyInvalid(`body.icon.type should be "emoji", "external", "file_upload", "file" or "custom_emoji", instead was ${shownValue(kind)}.`))
  }
  const icon = parsePageIconInput(candidate)
  return icon === undefined ? refused(bodyInvalid(`body.icon is not a valid ${String(kind)} icon.`)) : parsed(icon)
}

/** 노션의 커버(요청) → 우리 커버 — 외부 주소 · 올린 이미지(`file_upload` · 읽은 `file` 의 왕복). */
function parseCover(raw: unknown): Parsed<PageCover | null> {
  if (raw === null) return parsed(null)
  if (!isObject(raw)) return refused(bodyInvalid(`body.cover should be an object or \`null\`, instead was ${shownValue(raw)}.`))
  const kind = raw.type ?? ['external', 'file_upload', 'file'].find((k) => k in raw)
  let candidate: unknown
  if (kind === 'external') candidate = { type: 'external', url: isObject(raw.external) ? raw.external.url : undefined }
  else if (kind === 'file_upload' || kind === 'file') {
    const file = uploadedFileOf(raw, kind, 'body.cover')
    if (!file.ok) return file
    candidate = file.value
  } else {
    return refused(bodyInvalid(`body.cover.type should be "external", "file_upload" or "file", instead was ${shownValue(kind)}.`))
  }
  const cover = parsePageCoverInput(candidate)
  return cover === undefined ? refused(bodyInvalid(`body.cover is not a valid ${String(kind)} cover.`)) : parsed(cover)
}

/** 아이콘 · 커버가 붙이는 올린 파일 — API 업로드 세션의 검사(`claimApiUploadsIn`)에 넘긴다. 데이터베이스의 아이콘도 쓴다. */
export function lookClaims(icon: PageIcon | null | undefined, cover?: PageCover | null): UploadClaim[] {
  return [
    ...(icon?.type === 'file' ? [{ id: icon.file_id, path: 'body.icon' }] : []),
    ...(cover?.type === 'file' ? [{ id: cover.file_id, path: 'body.cover' }] : []),
  ]
}

/** files 속성의 칸이 붙이는 올린 파일 — 자리는 `body.properties.<이름>.files[i]`. */
function cellClaims(writes: readonly ApiWrite[], schema: readonly ApiProperty[]): UploadClaim[] {
  return writes.flatMap((w) => {
    if (w.kind !== 'cell' || w.value.type !== 'files') return []
    const name = schema.find((p) => p.id === w.propertyId)?.name ?? w.propertyId
    return w.value.files.map((f, i) => ({ id: f.id, path: `body.properties.${name}.files[${i}]` }))
  })
}

type ParentRef = { readonly kind: 'page_id' | 'data_source_id' | 'database_id'; readonly id: string }

function parseParent(raw: unknown): Parsed<ParentRef> {
  if (!isObject(raw)) return refused(bodyInvalid(`body.parent should be an object, instead was ${shownValue(raw)}.`))
  const kind = raw.type ?? ['page_id', 'data_source_id', 'database_id', 'workspace', 'block_id'].find((k) => k in raw)
  if (kind === 'workspace') {
    return refused(invalid('Creating a page at the top of the workspace is not supported. Use parent.page_id or parent.data_source_id.'))
  }
  if (kind !== 'page_id' && kind !== 'data_source_id' && kind !== 'database_id') {
    return refused(bodyInvalid(`body.parent.type should be "page_id", "data_source_id" or "database_id", instead was ${shownValue(kind)}.`))
  }
  const id = parseApiId(raw[kind])
  return id === null ? refused(bodyInvalid(`body.parent.${kind} should be a valid uuid, instead was ${shownValue(raw[kind])}.`)) : parsed({ kind, id })
}

/** 데이터베이스 행이 아닌 페이지의 속성 — 제목 하나. */
const TITLE_ONLY: readonly ApiProperty[] = [{ id: TITLE_PROPERTY_ID, name: TITLE_PROPERTY_ID, type: 'title', config: null }]

/** `properties` → 쓰기들. 모르는 이름 · id 는 노션의 글(`… is not a property that exists.`). 같은 속성을 두 번 주면 거부한다. */
function planWrites(raw: unknown, properties: readonly ApiProperty[], options: ReadonlyMap<string, readonly SelectOption[]>): Parsed<ApiWrite[]> {
  if (raw === undefined) return parsed([])
  if (!isObject(raw)) return refused(bodyInvalid(`body.properties should be an object, instead was ${shownValue(raw)}.`))
  const writes: ApiWrite[] = []
  for (const [key, value] of Object.entries(raw)) {
    const property = findProperty(properties, key)
    if (property === null) return refused(invalid(`${key} is not a property that exists.`))
    if (writes.some((w) => w.propertyId === property.id)) return refused(bodyInvalid(`body.properties.${key}: property "${property.name}" is given twice.`))
    const write = parsePropertyWrite(property, value, `body.properties.${key}`, options.get(property.id) ?? [], ownFileIdOf)
    if (!write.ok) return refused(bodyInvalid(write.message))
    writes.push(write.write)
  }
  return parsed(writes)
}

const cellsOf = (writes: readonly ApiWrite[]): RowCell[] =>
  writes.flatMap((w) => (w.kind === 'cell' ? [{ propertyId: w.propertyId, value: w.value }] : []))

function titleOf(writes: readonly ApiWrite[]): readonly RichTextRun[] | null {
  for (const w of writes) if (w.kind === 'cell' && w.value.type === 'title') return w.value.title
  return null
}

// ── 쓰기 ──────────────────────────────────────────────────────────────

type Step = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reply: V1Reply }
const stepFail = (reply: V1Reply): Step => ({ ok: false, reply })

/** 명령을 돌린다 — 앱의 명령이 던지는 거부(페이지 · 휴지통)와 동시 쓰기의 충돌을 노션의 답으로. */
async function runCommand(id: string, run: () => Promise<Step>): Promise<Step> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof PageError) return stepFail(pageErrorReply(e, id))
    if (e instanceof TrashError) return stepFail(trashErrorReply(e, id))
    if (isConflict(e)) return stepFail(conflict())
    throw e
  }
}

/** 아이콘 · 커버 — 준 것만. API 로 올린 파일이면 그 세션부터 본다(API-7) — 거부면 그 답(부르는 쪽이 트랜잭션째 되돌린다). */
async function applyLookIn(
  tx: Tx,
  ctx: SessionContext,
  pageId: string,
  icon: PageIcon | null | undefined,
  cover: PageCover | null | undefined,
): Promise<V1Reply | null> {
  const claimed = await claimApiUploadsIn(tx, ctx, lookClaims(icon, cover))
  if (claimed !== null) return bodyInvalid(claimed)
  if (icon !== undefined) await setPageIconIn(tx, ctx, asBlockId(pageId), icon)
  if (cover !== undefined) await setPageCoverIn(tx, ctx, asBlockId(pageId), cover)
  return null
}

/** files 칸이 붙이는 API 업로드의 검사(API-7) — 칸 쓰기(`createRowIn` · `updateCellsIn`) 앞에서. */
async function claimCellsIn(tx: Tx, ctx: SessionContext, writes: readonly ApiWrite[], schema: readonly ApiProperty[]): Promise<V1Reply | null> {
  const claimed = await claimApiUploadsIn(tx, ctx, cellClaims(writes, schema))
  return claimed === null ? null : bodyInvalid(claimed)
}

/**
 * relation 쓰기 — 노션처럼 **통째로 바꾼다**: 지금 보이는 연결과 견주어 더할 것 · 뺄 것을 `linkRowsIn` 에 준다. 볼 수 없는 연결은 남는다
 * (앱의 "비우기" 와 같다 — 보지 못한 것을 지우지 않는다).
 */
async function applyRelationsIn(tx: Tx, ctx: SessionContext, rowId: string, writes: readonly ApiWrite[], schema: readonly ApiProperty[]): Promise<V1Reply | null> {
  for (const write of writes) {
    if (write.kind !== 'relation') continue
    const property = schema.find((p) => p.id === write.propertyId)
    if (property === undefined) continue
    const current = (await visibleRelationIn(tx, ctx, rowId, property, 0, 100_000)).ids
    const add = write.ids.filter((id) => !current.includes(id))
    const remove = current.filter((id) => !write.ids.includes(id))
    if (add.length === 0 && remove.length === 0) continue
    if (add.length + remove.length > MAX_LINKS_PER_REQUEST) {
      return bodyInvalid(`body.properties.${property.name}.relation changes more than ${MAX_LINKS_PER_REQUEST} links at once.`)
    }
    const linked = await linkRowsIn(tx, ctx, rowId, property.id, add, remove)
    if (!linked.ok) return rowFailureReply(linked, rowId, schema, property.name)
  }
  return null
}

/** 받은 `children` — 새 페이지의 본문(API-3). 올린 파일은 이 워크스페이스의 것이어야 한다. */
type NewBody = { readonly blocks: readonly EditorBlock[]; readonly uploads: readonly UploadRef[]; readonly syncedRefs: readonly SyncedRef[] }

/** 새 페이지의 본문을 같은 트랜잭션에서 쓴다 — 거부면 그 답(트랜잭션째 되돌린다). */
async function writeNewBodyIn(tx: Tx, ctx: SessionContext, pageId: string, body: NewBody): Promise<V1Reply | null> {
  const upload = await uploadIssueIn(tx, ctx, body.uploads)
  if (upload !== null) return bodyInvalid(upload)
  // 동기화 블록 사본의 원본 — 살아 있고 이 사람이 볼 수 있어야 한다(SB-5 · ⑳)
  const synced = await syncedRefIssueIn(tx, ctx, body.syncedRefs)
  if (synced !== null) return bodyInvalid(synced)
  const wrote = await writeNewPageBodyIn(tx, ctx, pageId, body.blocks)
  return wrote === null ? null : invalid(wrote)
}

/** 페이지 밑에 — 부모를 볼 수 없으면 404, 볼 수만 있으면 403(만들 수 없다), 그다음은 `createPageIn` 의 판정. */
async function createUnderPage(
  ctx: SessionContext,
  parentId: string,
  properties: unknown,
  icon: PageIcon | null | undefined,
  cover: PageCover | null | undefined,
  body: NewBody,
): Promise<Step> {
  const plan = planWrites(properties, TITLE_ONLY, new Map())
  if (!plan.ok) return stepFail(plan.reply)
  const title = titleOf(plan.value) ?? []
  return runCommand(parentId, () =>
    withCommandTransaction(async (tx): Promise<Step> => {
      const caps = await effectiveCaps(tx, ctx, parentId)
      if (!can(caps, 'view')) return stepFail(notFound('page', parentId))
      if (!can(caps, 'create_child')) return stepFail(restricted())
      const page = await createPageIn(tx, ctx, { parentPageId: asBlockId(parentId), title })
      const look = await applyLookIn(tx, ctx, page.id, icon, cover)
      if (look !== null) return stepFail(look)
      const wrote = await writeNewBodyIn(tx, ctx, page.id, body)
      if (wrote !== null) return stepFail(wrote)
      return { ok: true, id: page.id }
    }),
  )
}

/** 데이터 소스에 행을 — 앱의 "새 행" 과 같은 문(`create_child`) · 같은 칸 검사(`createRowIn`). */
async function createRowUnder(
  ctx: SessionContext,
  dataSourceId: string,
  properties: unknown,
  icon: PageIcon | null | undefined,
  cover: PageCover | null | undefined,
  body: NewBody,
): Promise<Step> {
  return runCommand(dataSourceId, () =>
    withCommandTransaction(async (tx): Promise<Step> => {
      const gate = await openDataSource(tx, ctx, dataSourceId, 'create_child')
      if (isRowFailure(gate)) return stepFail(!gate.ok && gate.reason === 'forbidden' ? restricted() : notFound('data source', dataSourceId))
      const schema = await readApiProperties(tx, dataSourceId)
      const plan = planWrites(properties, schema, await readApiOptions(tx, schema))
      if (!plan.ok) return stepFail(plan.reply)
      const claimed = await claimCellsIn(tx, ctx, plan.value, schema)
      if (claimed !== null) return stepFail(claimed)
      const made = await createRowIn(tx, ctx, dataSourceId, { cells: cellsOf(plan.value) })
      if (!made.ok) return stepFail(made.reason === 'not_found' ? notFound('data source', dataSourceId) : rowFailureReply(made, dataSourceId, schema))
      const linked = await applyRelationsIn(tx, ctx, made.value.id, plan.value, schema)
      if (linked !== null) return stepFail(linked)
      const look = await applyLookIn(tx, ctx, made.value.id, icon, cover)
      if (look !== null) return stepFail(look)
      const wrote = await writeNewBodyIn(tx, ctx, made.value.id, body)
      if (wrote !== null) return stepFail(wrote)
      return { ok: true, id: made.value.id }
    }),
  )
}

// ── 주소들 ────────────────────────────────────────────────────────────

/** `GET /v1/pages/{page_id}` */
export const retrievePage: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.page_id)
  if (id === null) return invalid(invalidPathIdMessage('page_id', params.page_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  // 고른 속성만(API-6 — SDK 의 `filter_properties`) · 질의와 같은 두 모양을 받는다
  const query = new URL(request.url).searchParams
  const wanted = [...query.getAll('filter_properties'), ...query.getAll('filter_properties[]')]
  const page = await readApiPageOnly(ctx, id, apiLinks(ctx, request), wanted)
  if (page === null) return notFound('page', id)
  if ('unknownProperty' in page) return invalid(`query failed validation: filter_properties — Could not find property with name or id: ${page.unknownProperty}`)
  return v1Ok(page.json)
}

/** `POST /v1/pages` — 페이지 밑(`page_id`) · 데이터 소스(`data_source_id`) · 소스가 하나인 데이터베이스(`database_id`). */
export const createApiPage: V1Handler = async ({ ctx, body, request }) => {
  if (!isObject(body)) return bodyInvalid(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = unexpectedKey(body, ['parent', 'properties', 'icon', 'cover', 'children'])
  if (extra !== null) return extra
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const parent = parseParent(body.parent)
  if (!parent.ok) return parent.reply
  // 본문 — 블록 API 와 같은 변환 · 같은 상한(페이지 본문의 맨 위)
  const children = body.children === undefined ? null : parseApiChildren(body.children, 'body.children', 'page', newApiBlockId, { ownFileId: ownFileIdOf })
  if (children !== null && !children.ok) return bodyInvalid(children.message)
  const newBody: NewBody = children === null ? { blocks: [], uploads: [], syncedRefs: [] } : { blocks: children.blocks, uploads: children.uploads, syncedRefs: children.syncedRefs }
  const icon = body.icon === undefined ? undefined : parseIcon(body.icon)
  if (icon !== undefined && !icon.ok) return icon.reply
  const cover = body.cover === undefined ? undefined : parseCover(body.cover)
  if (cover !== undefined && !cover.ok) return cover.reply

  let created: Step
  if (parent.value.kind === 'page_id') {
    created = await createUnderPage(ctx, parent.value.id, body.properties, icon?.value, cover?.value, newBody)
  } else {
    let dataSourceId = parent.value.id
    if (parent.value.kind === 'database_id') {
      // 노션의 옛 판과의 호환 — 데이터 소스가 하나뿐인 데이터베이스만(둘 이상이면 어느 것인지 골라야 한다)
      const sources = await listDataSources(ctx, parent.value.id)
      if (!sources.ok) return notFound('database', parent.value.id)
      if (sources.value.length !== 1) {
        return invalid(`Database ${parent.value.id} has ${sources.value.length} data sources. Use parent.data_source_id to choose one.`)
      }
      dataSourceId = sources.value[0].id
    }
    created = await createRowUnder(ctx, dataSourceId, body.properties, icon?.value, cover?.value, newBody)
  }
  if (!created.ok) return created.reply
  const page = await readApiPage(ctx, created.id, apiLinks(ctx, request))
  return page === null ? notFound('page', created.id) : v1Ok(page)
}

/** `PATCH /v1/pages/{page_id}` — 속성 · 아이콘 · 커버 · 휴지통(`in_trash` — 옛 이름 `archived` 도 받는다). */
export const updateApiPage: V1Handler = async ({ ctx, params, body, request }) => {
  const id = parseApiId(params.page_id)
  if (id === null) return invalid(invalidPathIdMessage('page_id', params.page_id))
  const input = body === undefined ? {} : body
  if (!isObject(input)) return bodyInvalid(`body should be an object, instead was ${shownValue(input)}.`)
  const extra = unexpectedKey(input, ['properties', 'icon', 'cover', 'in_trash', 'archived'])
  if (extra !== null) return extra
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  if (input.in_trash !== undefined && input.archived !== undefined && input.in_trash !== input.archived) {
    return bodyInvalid('body.in_trash and body.archived should be the same when both are given.')
  }
  const inTrash = input.in_trash ?? input.archived
  if (inTrash !== undefined && typeof inTrash !== 'boolean') {
    return bodyInvalid(`body.in_trash should be a boolean, instead was ${shownValue(inTrash)}.`)
  }
  const icon = input.icon === undefined ? undefined : parseIcon(input.icon)
  if (icon !== undefined && !icon.ok) return icon.reply
  const cover = input.cover === undefined ? undefined : parseCover(input.cover)
  if (cover !== undefined && !cover.ok) return cover.reply

  const head = await withReadTransaction(async (tx) => {
    const page = await loadPageIn(tx, ctx, id)
    if (page === null) return null
    const schema = page.row === null ? TITLE_ONLY : await readApiProperties(tx, page.row.dataSourceId)
    const options: ReadonlyMap<string, readonly SelectOption[]> = page.row === null ? new Map() : await readApiOptions(tx, schema)
    return { page, schema, options }
  })
  if (head === null) return notFound('page', id)
  const plan = planWrites(input.properties, head.schema, head.options)
  if (!plan.ok) return plan.reply
  const edits = plan.value.length > 0 || icon !== undefined || cover !== undefined

  if (head.page.trashed) {
    if (inTrash === false) {
      const restored = await runCommand(id, async () => {
        await restorePage(ctx, asBlockId(id))
        return { ok: true, id }
      })
      if (!restored.ok) return restored.reply
    } else if (edits) {
      return invalid(TRASHED_MESSAGE)
    }
  }

  if (edits) {
    const row = head.page.row
    const wrote = await runCommand(id, () =>
      withCommandTransaction(async (tx): Promise<Step> => {
        if (row === null) {
          const title = titleOf(plan.value)
          if (title !== null) await renamePageIn(tx, ctx, asBlockId(id), title)
        } else {
          const cells = cellsOf(plan.value)
          if (cells.length > 0) {
            const claimed = await claimCellsIn(tx, ctx, plan.value, head.schema)
            if (claimed !== null) return stepFail(claimed)
            const updated = await updateCellsIn(tx, ctx, id, { cells })
            if (!updated.ok) return stepFail(rowFailureReply(updated, id, head.schema))
          }
          const linked = await applyRelationsIn(tx, ctx, id, plan.value, head.schema)
          if (linked !== null) return stepFail(linked)
        }
        const look = await applyLookIn(tx, ctx, id, icon?.value, cover?.value)
        if (look !== null) return stepFail(look)
        return { ok: true, id }
      }),
    )
    if (!wrote.ok) return wrote.reply
  }

  if (inTrash === true && !head.page.trashed) {
    if (head.page.row !== null) {
      const trashed = await trashRow(ctx, id)
      if (!trashed.ok) return rowFailureReply(trashed, id, head.schema)
    } else {
      const trashed = await runCommand(id, async () => {
        await trashPage(ctx, asBlockId(id))
        return { ok: true, id }
      })
      if (!trashed.ok) return trashed.reply
    }
  }

  const page = await readApiPage(ctx, id, apiLinks(ctx, request))
  return page === null ? notFound('page', id) : v1Ok(page)
}

/** `GET /v1/pages/{page_id}/properties/{property_id}` — `page_size`(≤ 100) · `start_cursor`. */
export const retrievePageProperty: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.page_id)
  if (id === null) return invalid(invalidPathIdMessage('page_id', params.page_id))
  const raw = typeof params.property_id === 'string' ? params.property_id : ''
  let propertyId = raw
  try {
    propertyId = decodeURIComponent(raw)
  } catch {
    // 이미 풀린 글자 — 그대로
  }
  const query = new URL(request.url).searchParams
  const pageSize = parsePageSize(query.get('page_size'))
  if (pageSize === null) {
    return invalid(`query failed validation: query.page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(query.get('page_size'))}.`)
  }
  const offset = decodeCursor(query.get('start_cursor'))
  if (offset === null) return invalid('query failed validation: query.start_cursor is not a valid cursor.')
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const links = apiLinks(ctx, request)
  const sizeQuery = query.get('page_size') === null ? '' : `&page_size=${pageSize}`
  const read = await readPropertyItem(ctx, id, propertyId, { offset, pageSize }, links, (cursor) =>
    `${links.origin}/v1/pages/${id}/properties/${encodeURIComponent(propertyId)}?start_cursor=${cursor}${sizeQuery}`,
  )
  if (!read.ok) return read.reason === 'page_not_found' ? notFound('page', id) : v1Fail(404, 'object_not_found', `Could not find property with ID: ${propertyId}.`)
  return v1Ok(read.json)
}
