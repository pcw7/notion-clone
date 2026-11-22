/**
 * 공개 API 의 블록 — `GET/PATCH/DELETE /v1/blocks/{id}` · `GET/PATCH /v1/blocks/{id}/children` (API-3 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ · 공개 API 투영 규칙 · 판결 X-1 · V-5 · 09-api-integrations.md F-09-01
 *
 * **본문 쓰기는 서버 명령의 본문 세션 하나로**(경로 ② · `openPageBody(…, 'api')`) — 블록 행을 직접 쓰지 않는다(행은 Y.Doc 의 투영이다). 한
 * 요청이 한 명령 트랜잭션이다: 본문을 가진 페이지 행을 잠그고 → 볼 수 있는가(404) · 고칠 수 있는가(403) · 휴지통 · 잠금(400) → 본문을 열고 →
 * 읽어서 자리를 찾고 받은 블록을 검사 → ProseMirror 변경 하나(`block-edit.ts`) → 투영 · 쌓기(`finish` — `doc_update.origin = 'api'` · 행위자는
 * 토큰의 사람 · 활동도 그 사람). 쌓인 update 는 협업 서버의 커밋 신호로 열린 편집기에 곧바로 간다. 하나라도 거부되면 아무것도 바뀌지 않는다.
 *
 *   · 페이지 id 도 블록 id 다(노션) — 읽으면 `child_page`, 자식은 그 페이지의 본문. 지우면 앱의 휴지통 명령(`trashPage` · 행은 `trashRow`) ·
 *     `in_trash: false` 는 되살리기(`restorePage`). 페이지의 내용은 `PATCH /v1/pages` 가 고친다
 *   · 본문 블록을 지우면 Y.Doc 에서 빠진다 — 되살릴 수 없다(버전 기록으로 되돌린다). 지우면 지우기 전의 블록을 `in_trash: true` 로 돌려준다(노션).
 *     그 안의 하위 페이지는 휴지통으로 간다(편집기에서 지울 때와 같다 — 버릴 권한이 없으면 403)
 *   · 붙이기의 자리 — 끝(기본) · `after`(형제 id · 노션 2025-09-03) · `position`(`start` · `end` · `after_block` — 노션의 새 모양) 중 하나
 *   · 내보내기 정책을 끄면 소유자만(API-2 와 같은 게이트 — 블록도 내용이다)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import type { SessionContext } from '../auth/session-context.ts'
import { openPageBody, type PageBodyWrite } from '../block/body-write.ts'
import { restorePage, trashPage, TrashError } from '../block/trash.ts'
import { specOf, type BlockType } from '../block/types.ts'
import { trashRow } from '../database/row.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import type { EditorDoc } from '../editor/document.ts'
import { asBlockId } from '../ids.ts'
import { recordCoalescedActivity } from '../notification/activity.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'
import {
  blockObjectsIn,
  databaseBlockObject,
  indexBody,
  locateIn,
  newApiBlockId,
  pageBlockObjectIn,
  readBodyIn,
  uploadIssueIn,
  type BodyEntry,
  type Located,
} from './block-body.ts'
import { appendBlocksIn, deleteBlockIn, updateBlockIn, type AppendPlace, type EditOutcome } from './block-edit.ts'
import { apiTypeOf, parseApiBlockUpdate, parseApiChildren, tableWidthOf } from './block-json.ts'
import { ownFileIdOf } from './file-url.ts'
import { loadPageIn, type LoadedPage } from './page-object.ts'
import {
  apiLinks,
  bodyInvalid,
  conflict,
  invalid,
  isConflict,
  isObject,
  LOCKED_MESSAGE,
  policyBlock,
  restricted,
  rowFailureReply,
  trashErrorReply,
  unexpectedKey,
} from './pages.ts'
import { userRef } from './property-values.ts'
import type { ApiLinks } from './rich-text.ts'
import { v1Fail, v1Ok, type V1Handler, type V1Reply } from './v1.ts'
import { API_MAX_PAGE_SIZE, decodeCursor, encodeCursor, invalidPathIdMessage, parseApiId, parsePageSize, shownValue } from './v1-protocol.ts'

const TRASHED_BLOCK_MESSAGE = "Can't edit block that is in trash. Restore its page first."

const notFound = (id: string): V1Reply => v1Fail(404, 'object_not_found', `Could not find block with ID: ${id}.`)

/** 노션의 목록 모양 — 블록. */
function blockList(results: readonly unknown[], nextCursor: string | null): Record<string, unknown> {
  return { object: 'list', results, next_cursor: nextCursor, has_more: nextCursor !== null, type: 'block', block: {} }
}

// ── 본문 쓰기 ─────────────────────────────────────────────────────────

type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reply: V1Reply }
const yes = <T>(value: T): Step<T> => ({ ok: true, value })
const no = <T>(reply: V1Reply): Step<T> => ({ ok: false, reply })

/** 변경 하나를 본문 세션에 쓰고 그 결과(자리를 찾았는가)를 돌려준다. 실패한 변경은 문서를 건드리지 않는다. */
function applyEdit(body: PageBodyWrite, edit: (tr: Transaction, doc: PmNode) => EditOutcome): EditOutcome {
  const box: { outcome: EditOutcome } = { outcome: 'ok' }
  body.change((tr, doc) => {
    box.outcome = edit(tr, doc)
  })
  return box.outcome
}

/** 자리를 찾지 못한 변경의 답. */
function outcomeReply(outcome: EditOutcome, id: string, afterId: string | null): V1Reply {
  switch (outcome) {
    case 'after_not_found':
      return bodyInvalid(`block ${afterId ?? ''} given as the position is not a child of block ${id}.`)
    case 'last_row':
      return invalid('A table needs at least one row. Delete the table instead.')
    default:
      return notFound(id)
  }
}

/**
 * 본문을 가진 페이지 하나를 잠그고 본문 세션에서 고친다(머리말의 차례). `edit` 이 거부하면 아무것도 쓰지 않는다. 바꾼 것이 있을 때만
 * 투영 · 쌓기를 한다 — 바꾸지 않은 요청(`in_trash: false` 같은)은 로그에 아무것도 남기지 않는다.
 */
async function editBody<T>(
  ctx: SessionContext,
  ownerId: string,
  edit: (tx: Tx, body: PageBodyWrite, doc: EditorDoc, owner: LoadedPage) => Promise<Step<T>>,
): Promise<Step<T>> {
  try {
    return await withCommandTransaction(async (tx): Promise<Step<T>> => {
      const locked = await tx.queryMaybe<{ id: string }>(
        `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' FOR UPDATE`,
        [ownerId, ctx.workspaceId],
      )
      if (locked === null) return no(notFound(ownerId))
      const owner = await loadPageIn(tx, ctx, ownerId)
      if (owner === null) return no(notFound(ownerId))
      if (!can(await effectiveCaps(tx, ctx, ownerId), 'edit_content')) return no(restricted())
      if (owner.trashed) return no(invalid(TRASHED_BLOCK_MESSAGE))
      if (await isLocked(tx, ownerId)) return no(invalid(LOCKED_MESSAGE))

      const body = await openPageBody(tx, ctx, ownerId, 'api')
      const step = await edit(tx, body, body.read(), owner)
      if (!step.ok || !body.changed) return step
      // 빠진 하위 페이지 참조는 휴지통으로 — 블록을 지우면 그 안의 하위 페이지도 간다(참여자 편집과 같은 규칙 · 버릴 권한을 본다)
      const result = await body.finish({ origin: 'api', missingPageRefs: 'trash' })
      if (!result.ok) {
        if (result.reason === 'page_ref_forbidden') return no(restricted())
        return no(invalid(`The page content could not be saved (${result.reason}).`))
      }
      // 활동 — 사람이 본문을 고쳤다(정본 ⑤ — 활동의 행위자는 그 사람 · 같은 사람 · 같은 페이지 5분 안이면 접는다)
      if (result.commit.appended) await recordCoalescedActivity(tx, ctx, { pageId: ownerId, type: 'block.updated' })
      return step
    })
  } catch (e) {
    if (isConflict(e)) return no(conflict())
    throw e
  }
}

/** 본문 블록들을 다시 읽어 노션 객체로 — 쓴 뒤의 답(투영된 행의 시각 · 사람). 본문에 없는 id 는 빠진다. */
async function readBodyBlocks(ctx: SessionContext, ownerId: string, ids: readonly string[], links: ApiLinks): Promise<Record<string, unknown>[]> {
  return withReadTransaction(async (tx) => {
    const owner = await loadPageIn(tx, ctx, ownerId)
    if (owner === null) return []
    const doc = await readBodyIn(tx, ctx, ownerId)
    const index = indexBody(doc)
    return blockObjectsIn(tx, ctx, owner, doc, ids.flatMap((id) => index.get(id) ?? []), links)
  })
}

// ── 받기 ──────────────────────────────────────────────────────────────

function parsePlace(body: Record<string, unknown>): Step<AppendPlace> {
  if (body.after !== undefined && body.position !== undefined) return no(bodyInvalid('body.after should be not present when body.position is given.'))
  if (body.after !== undefined) {
    const id = parseApiId(body.after)
    return id === null ? no(bodyInvalid(`body.after should be a valid uuid, instead was ${shownValue(body.after)}.`)) : yes({ kind: 'after', id })
  }
  if (body.position === undefined) return yes({ kind: 'end' })
  const position = body.position
  if (!isObject(position)) return no(bodyInvalid(`body.position should be an object, instead was ${shownValue(position)}.`))
  if (position.type === 'end') return yes({ kind: 'end' })
  if (position.type === 'start') return yes({ kind: 'start' })
  if (position.type === 'after_block') {
    const raw = isObject(position.after_block) ? position.after_block.id : undefined
    const id = parseApiId(raw)
    return id === null
      ? no(bodyInvalid(`body.position.after_block.id should be a valid uuid, instead was ${shownValue(raw)}.`))
      : yes({ kind: 'after', id })
  }
  return no(bodyInvalid(`body.position.type should be "start", "end" or "after_block", instead was ${shownValue(position.type)}.`))
}

/** `in_trash` · 옛 이름 `archived` — 둘 다 오면 같아야 한다. */
function parseInTrash(input: Record<string, unknown>): Step<boolean | undefined> {
  if (input.in_trash !== undefined && input.archived !== undefined && input.in_trash !== input.archived) {
    return no(bodyInvalid('body.in_trash and body.archived should be the same when both are given.'))
  }
  const value = input.in_trash ?? input.archived
  if (value !== undefined && typeof value !== 'boolean') return no(bodyInvalid(`body.in_trash should be a boolean, instead was ${shownValue(value)}.`))
  return yes(value as boolean | undefined)
}

const pathId = (raw: unknown): string | null => parseApiId(raw)

// ── 페이지 · 데이터베이스를 블록으로 ──────────────────────────────────

/** 페이지 · 데이터베이스 블록의 휴지통 · 되살리기 — 앱의 명령으로. 그다음 다시 읽어 답한다. */
async function trashOrRestore(ctx: SessionContext, located: Exclude<Located, { kind: 'body' }>, inTrash: boolean | undefined): Promise<V1Reply> {
  const id = located.kind === 'page' ? located.page.id : located.database.id
  const trashed = located.kind === 'page' ? located.page.trashed : located.database.trashed
  try {
    if (inTrash === true && !trashed) {
      if (located.kind === 'page' && located.page.row !== null) {
        const done = await trashRow(ctx, id)
        if (!done.ok) return rowFailureReply(done, id, [])
      } else {
        await trashPage(ctx, asBlockId(id))
      }
    } else if (inTrash === false && trashed) {
      await restorePage(ctx, asBlockId(id))
    }
  } catch (e) {
    if (e instanceof TrashError) return trashErrorReply(e, id)
    if (isConflict(e)) return conflict()
    throw e
  }
  const json = await withReadTransaction(async (tx) => {
    const again = await locateIn(tx, ctx, id)
    if (again?.kind === 'page') return pageBlockObjectIn(tx, ctx, again.page)
    if (again?.kind === 'database') return databaseBlockObject(again.database)
    return null
  })
  return json === null ? notFound(id) : v1Ok(json)
}

// ── 본문 블록의 고치기 · 지우기 ───────────────────────────────────────

type BodyChange = { readonly typeKey: string | undefined; readonly payload: unknown; readonly inTrash: boolean | undefined }

/** 본문 블록 하나를 고치거나 지운다(`PATCH /v1/blocks/{id}` · `DELETE`). */
async function changeBodyBlock(ctx: SessionContext, owner: LoadedPage, id: string, change: BodyChange, links: ApiLinks): Promise<V1Reply> {
  const done = await editBody(ctx, owner.id, async (tx, body, doc, lockedOwner): Promise<Step<Record<string, unknown> | null>> => {
    const index = indexBody(doc)
    const entry = index.get(id)
    if (entry === undefined) return no(notFound(id))
    let next = entry.block
    let changes = { textChanged: false, cellsChanged: false }
    if (change.typeKey !== undefined) {
      const expected = apiTypeOf(entry.block)
      if (change.typeKey !== expected && change.typeKey !== entry.block.type) {
        return no(bodyInvalid(`body.${change.typeKey} should be not present — the block is of type "${expected}".`))
      }
      const parent = entry.parentId === null ? undefined : index.get(entry.parentId)?.block
      const tableWidth = entry.block.type === 'table_row' && parent !== undefined ? tableWidthOf(parent) : undefined
      const parsed = parseApiBlockUpdate(entry.block, change.payload, `body.${change.typeKey}`, { tableWidth, ownFileId: ownFileIdOf })
      if (!parsed.ok) return no(bodyInvalid(parsed.message))
      const upload = await uploadIssueIn(tx, ctx, parsed.uploads)
      if (upload !== null) return no(bodyInvalid(upload))
      next = parsed.next
      changes = { textChanged: parsed.textChanged, cellsChanged: parsed.cellsChanged }
    }

    if (change.inTrash === true) {
      // 지우기 전의 모습으로 답한다(노션) — 행은 투영이 지우므로 지금 만든다
      const [before] = await blockObjectsIn(tx, ctx, lockedOwner, doc, [{ block: next, parentId: entry.parentId }], links)
      const outcome = applyEdit(body, (tr, pm) => deleteBlockIn(tr, pm, id))
      if (outcome !== 'ok') return no(outcomeReply(outcome, id, null))
      return yes({ ...before, in_trash: true, last_edited_time: new Date().toISOString(), last_edited_by: userRef(ctx.userId) })
    }
    if (change.typeKey !== undefined) {
      const outcome = applyEdit(body, (tr, pm) => updateBlockIn(tr, pm, next, changes))
      if (outcome !== 'ok') return no(outcomeReply(outcome, id, null))
    }
    return yes(null)
  })
  if (!done.ok) return done.reply
  if (done.value !== null) return v1Ok(done.value)
  const [json] = await readBodyBlocks(ctx, owner.id, [id], links)
  return json === undefined ? notFound(id) : v1Ok(json)
}

// ── 주소들 ────────────────────────────────────────────────────────────

/** `GET /v1/blocks/{block_id}` — 페이지 id 면 `child_page`. */
export const retrieveBlock: V1Handler = async ({ ctx, params, request }) => {
  const id = pathId(params.block_id)
  if (id === null) return invalid(invalidPathIdMessage('block_id', params.block_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const links = apiLinks(ctx, request)
  const json = await withReadTransaction(async (tx) => {
    const located = await locateIn(tx, ctx, id)
    if (located === null) return null
    if (located.kind === 'page') return pageBlockObjectIn(tx, ctx, located.page)
    if (located.kind === 'database') return databaseBlockObject(located.database)
    const doc = await readBodyIn(tx, ctx, located.owner.id)
    const entry = indexBody(doc).get(id)
    if (entry === undefined) return null
    const [object] = await blockObjectsIn(tx, ctx, located.owner, doc, [entry], links)
    return object ?? null
  })
  return json === null ? notFound(id) : v1Ok(json)
}

/** `GET /v1/blocks/{block_id}/children` — `page_size`(≤ 100) · `start_cursor`. 페이지면 본문의 맨 위, 블록이면 그 자식(표면 행). */
export const retrieveBlockChildren: V1Handler = async ({ ctx, params, request }) => {
  const id = pathId(params.block_id)
  if (id === null) return invalid(invalidPathIdMessage('block_id', params.block_id))
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

  const read = await withReadTransaction(async (tx) => {
    const located = await locateIn(tx, ctx, id)
    if (located === null) return null
    // 데이터베이스의 행은 블록의 자식이 아니다(노션 — 행은 데이터 소스 질의로)
    if (located.kind === 'database') return { results: [], more: false }
    const owner = located.kind === 'page' ? located.page : located.owner
    const doc = await readBodyIn(tx, ctx, owner.id)
    let all: BodyEntry[]
    if (located.kind === 'page') all = doc.blocks.map((block) => ({ block, parentId: null }))
    else {
      const entry = indexBody(doc).get(id)
      if (entry === undefined) return null
      all = (entry.block.children ?? []).map((block) => ({ block, parentId: id }))
    }
    const slice = all.slice(offset, offset + pageSize)
    return { results: await blockObjectsIn(tx, ctx, owner, doc, slice, links), more: all.length > offset + pageSize }
  })
  if (read === null) return notFound(id)
  return v1Ok(blockList(read.results, read.more ? encodeCursor(offset + pageSize) : null))
}

/** `PATCH /v1/blocks/{block_id}/children` — 블록을 붙인다(≤ 100 · 중첩 2단 · 모두 1000). 붙인 맨 위 블록들을 목록으로 돌려준다. */
export const appendBlockChildren: V1Handler = async ({ ctx, params, body, request }) => {
  const id = pathId(params.block_id)
  if (id === null) return invalid(invalidPathIdMessage('block_id', params.block_id))
  if (!isObject(body)) return bodyInvalid(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = unexpectedKey(body, ['children', 'after', 'position'])
  if (extra !== null) return extra
  if (body.children === undefined) return bodyInvalid('body.children should be defined, instead was undefined.')
  const place = parsePlace(body)
  if (!place.ok) return place.reply
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const links = apiLinks(ctx, request)

  const located = await withReadTransaction((tx) => locateIn(tx, ctx, id))
  if (located === null) return notFound(id)
  if (located.kind === 'database') return invalid('Block type child_database does not support children.')
  const ownerId = located.kind === 'page' ? located.page.id : located.owner.id
  const target = located.kind === 'page' ? null : id

  const done = await editBody(ctx, ownerId, async (tx, session, doc): Promise<Step<string[]>> => {
    let parentType: BlockType = 'page'
    let tableWidth: number | undefined
    if (target !== null) {
      const entry = indexBody(doc).get(target)
      if (entry === undefined) return no(notFound(id))
      parentType = entry.block.type
      if (!specOf(parentType).canHaveChildren || apiTypeOf(entry.block) === 'unsupported') {
        return no(invalid(`Block type ${apiTypeOf(entry.block)} does not support children.`))
      }
      if (parentType === 'table') tableWidth = tableWidthOf(entry.block)
    }
    const parsed = parseApiChildren(body.children, 'body.children', parentType, newApiBlockId, { tableWidth, ownFileId: ownFileIdOf })
    if (!parsed.ok) return no(bodyInvalid(parsed.message))
    const upload = await uploadIssueIn(tx, ctx, parsed.uploads)
    if (upload !== null) return no(bodyInvalid(upload))
    const outcome = applyEdit(session, (tr, pm) => appendBlocksIn(tr, pm, target, place.value, parsed.blocks))
    if (outcome !== 'ok') return no(outcomeReply(outcome, id, place.value.kind === 'after' ? place.value.id : null))
    return yes(parsed.blocks.map((b) => b.id))
  })
  if (!done.ok) return done.reply
  return v1Ok(blockList(await readBodyBlocks(ctx, ownerId, done.value, links), null))
}

/** 고치기 · 지우기의 공통 — 무엇인지 찾아 페이지 · 데이터베이스면 앱의 명령, 본문 블록이면 본문 세션. */
async function changeBlock(ctx: SessionContext, id: string, change: BodyChange, links: ApiLinks): Promise<V1Reply> {
  const located = await withReadTransaction((tx) => locateIn(tx, ctx, id))
  if (located === null) return notFound(id)
  if (located.kind !== 'body') {
    if (change.typeKey !== undefined) {
      return invalid(
        located.kind === 'page'
          ? 'Blocks of type child_page cannot be updated here. Use PATCH /v1/pages/{page_id} to change the page.'
          : 'Blocks of type child_database cannot be updated through the API.',
      )
    }
    return trashOrRestore(ctx, located, change.inTrash)
  }
  return changeBodyBlock(ctx, located.owner, id, change, links)
}

/** `PATCH /v1/blocks/{block_id}` — `{ [type]: 고칠 것 }`(준 키만) · `in_trash`(옛 이름 `archived`). */
export const updateApiBlock: V1Handler = async ({ ctx, params, body, request }) => {
  const id = pathId(params.block_id)
  if (id === null) return invalid(invalidPathIdMessage('block_id', params.block_id))
  const input = body === undefined ? {} : body
  if (!isObject(input)) return bodyInvalid(`body should be an object, instead was ${shownValue(input)}.`)
  const inTrash = parseInTrash(input)
  if (!inTrash.ok) return inTrash.reply
  const typeKeys = Object.keys(input).filter((k) => k !== 'in_trash' && k !== 'archived')
  if (typeKeys.length > 1) return bodyInvalid(`body.${typeKeys[1]} should be not present, instead was ${shownValue(input[typeKeys[1]])}.`)
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const typeKey = typeKeys[0]
  return changeBlock(ctx, id, { typeKey, payload: typeKey === undefined ? undefined : input[typeKey], inTrash: inTrash.value }, apiLinks(ctx, request))
}

/** `DELETE /v1/blocks/{block_id}` — 휴지통으로(노션 — 지운 블록을 `in_trash: true` 로 돌려준다). 페이지면 페이지를 휴지통으로. */
export const deleteApiBlock: V1Handler = async ({ ctx, params, request }) => {
  const id = pathId(params.block_id)
  if (id === null) return invalid(invalidPathIdMessage('block_id', params.block_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  return changeBlock(ctx, id, { typeKey: undefined, payload: undefined, inTrash: true }, apiLinks(ctx, request))
}
