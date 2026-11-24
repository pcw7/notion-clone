/**
 * 공개 API 의 페이지 옮기기 — `POST /v1/pages/{page_id}/move` (API-10 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑭ ① · §3.4 X-7 · [보강] 잠금이 막는 것 ③
 *
 * **앱의 옮기기 명령(`movePage`)을 토큰의 사람으로 부른다** — 사이드바 · 끌기 · "옮기기" 와 같은 함수 · 그 명령의 트랜잭션 하나 · 부모 본문의
 * 참조 쓰기는 출처 `api`. 앞의 읽기는 노션의 답(404 · 403 · 400)을 고르려는 것뿐이다 — 판정은 명령이 잠그고 다시 한다.
 *   · 부모는 `page_id` 만 — `data_source_id` · `database_id` 는 400(페이지를 행으로 바꾸는 명령이 없다 · C-3 — 행은 만들 때 `data_source_id`) ·
 *     `workspace` 는 400(노션도 받지 않는다 — SDK 의 타입에 없다 · 만들기 ⑥ 과 같다) · `block_id` 는 모양이 틀린 것
 *   · 데이터베이스 행은 옮기지 않는다(소스 밖으로 꺼내는 명령이 없다 — 앱의 화면도 행에 옮기기를 두지 않는다) · 휴지통의 페이지 · 부모는 400
 *   · 옮길 페이지는 `edit_content`, 새 부모는 `create_child` — 볼 수 없으면 404 · 볼 수만 있으면 403(만들기와 같은 갈래)
 *   · **잠금은 막지 않는다**(트리 연산 — [보강] 잠금 ③ · 앱과 같다) · 같은 부모면 아무것도 바꾸지 않는다 · 맨 뒤에 붙는다
 *   · 웹훅 `page.moved` 는 명령의 목이 낸다(⑬ ① — 부모가 바뀔 때만)
 */

import { MoveError, movePage } from '../block/move-page.ts'
import { withReadTransaction } from '../db/tx.ts'
import { asBlockId } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { loadPageIn, readApiPage } from './page-object.ts'
import { apiLinks, bodyInvalid, conflict, invalid, isConflict, isObject, notFound, policyBlock, restricted, unexpectedKey } from './pages.ts'
import { v1Fail, v1Ok, type V1Handler, type V1Reply } from './v1.ts'
import { invalidPathIdMessage, parseApiId, shownValue } from './v1-protocol.ts'

const TRASHED_MESSAGE = "Can't move page that is in trash. Restore it first by setting in_trash to false."
const TARGET_TRASHED_MESSAGE = "Can't move a page into a page that is in trash."
const ROW_MESSAGE = 'Moving a database row is not supported — a row stays in its data source.'
const INTO_SOURCE_MESSAGE =
  'Moving a page into a data source is not supported — create rows with POST /v1/pages and parent.data_source_id.'
const TO_WORKSPACE_MESSAGE = 'Moving a page to the top of the workspace is not supported. Use parent.page_id.'
const CYCLE_MESSAGE = "Can't move a page into itself or one of its descendants."
const TOO_DEEP_MESSAGE = 'The page would be nested too deeply. Move it under a page closer to the top.'
const FULL_ACCESS_MESSAGE = 'Moving this page to another teamspace or out of a private section needs full access to the page.'

type ParentRead = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reply: V1Reply }

/** `parent` — 노션의 모양(`type` 이 없으면 키로 고른다). */
function parseMoveParent(raw: unknown): ParentRead {
  if (!isObject(raw)) return { ok: false, reply: bodyInvalid(`body.parent should be an object, instead was ${shownValue(raw)}.`) }
  const kind = raw.type ?? ['page_id', 'data_source_id', 'database_id', 'workspace', 'block_id'].find((k) => k in raw)
  if (kind === 'data_source_id' || kind === 'database_id') return { ok: false, reply: invalid(INTO_SOURCE_MESSAGE) }
  if (kind === 'workspace') return { ok: false, reply: invalid(TO_WORKSPACE_MESSAGE) }
  if (kind !== 'page_id') {
    return { ok: false, reply: bodyInvalid(`body.parent.type should be "page_id" or "data_source_id", instead was ${shownValue(kind)}.`) }
  }
  const id = parseApiId(raw.page_id)
  if (id === null) return { ok: false, reply: bodyInvalid(`body.parent.page_id should be a valid uuid, instead was ${shownValue(raw.page_id)}.`) }
  return { ok: true, id }
}

/** 명령의 거부 → 노션의 답. 앞의 읽기를 지난 뒤라 대개는 그 사이의 변화다. */
function moveErrorReply(e: MoveError, pageId: string, targetId: string): V1Reply {
  switch (e.code) {
    case 'not_found':
      return notFound('page', pageId)
    case 'target_not_found':
      return notFound('page', targetId)
    case 'forbidden':
      return restricted()
    case 'needs_full_access':
      return v1Fail(403, 'restricted_resource', FULL_ACCESS_MESSAGE)
    case 'cycle':
      return invalid(CYCLE_MESSAGE)
    case 'too_deep':
      return invalid(TOO_DEEP_MESSAGE)
    case 'invalid_target':
      return invalid('This page cannot be moved there.')
  }
}

/** `POST /v1/pages/{page_id}/move` — `{ parent: { type: 'page_id', page_id } }`. 응답은 옮긴 뒤의 페이지 객체. */
export const moveApiPage: V1Handler = async ({ ctx, params, body, request }) => {
  const id = parseApiId(params.page_id)
  if (id === null) return invalid(invalidPathIdMessage('page_id', params.page_id))
  if (!isObject(body)) return bodyInvalid(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = unexpectedKey(body, ['parent'])
  if (extra !== null) return extra
  // 응답이 페이지의 내용이다 — 읽기 · 쓰기와 같은 게이트(⑥)
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const parent = parseMoveParent(body.parent)
  if (!parent.ok) return parent.reply

  // 답을 고른다 — 옮길 페이지(볼 수 없음 404 · 휴지통 · 행 400 · 고칠 수 없음 403) → 새 부모(볼 수 없음 404 · 휴지통 400 · 둘 수 없음 403)
  const refusal = await withReadTransaction(async (tx): Promise<V1Reply | null> => {
    const page = await loadPageIn(tx, ctx, id)
    if (page === null) return notFound('page', id)
    if (page.trashed) return invalid(TRASHED_MESSAGE)
    if (page.row !== null) return invalid(ROW_MESSAGE)
    if (!can(await effectiveCaps(tx, ctx, id), 'edit_content')) return restricted()
    const target = await loadPageIn(tx, ctx, parent.id)
    if (target === null) return notFound('page', parent.id)
    if (target.trashed) return invalid(TARGET_TRASHED_MESSAGE)
    if (!can(await effectiveCaps(tx, ctx, parent.id), 'create_child')) return restricted()
    return null
  })
  if (refusal !== null) return refusal

  try {
    await movePage(ctx, asBlockId(id), asBlockId(parent.id))
  } catch (e) {
    if (e instanceof MoveError) return moveErrorReply(e, id, parent.id)
    if (isConflict(e)) return conflict()
    throw e
  }
  const page = await readApiPage(ctx, id, apiLinks(ctx, request))
  return page === null ? notFound('page', id) : v1Ok(page)
}
