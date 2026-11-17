/**
 * 공개 API 의 코멘트 — `GET/POST /v1/comments` · `GET/PATCH/DELETE /v1/comments/{id}` (API-5 · F-09-07 · F-09-03 · F-09-04)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑩ · §3.9 `discussion` · `comment` · 09-api-integrations.md F-09-07
 *
 * **모든 일은 앱의 코멘트 명령을 지난다**(`comment/discussion.ts`) — 권한 SQL 을 여기서 쓰지 않는다:
 *   · 읽기 `listDiscussions`(페이지의 `view` — 못 보면 없는 것 · 휴지통의 페이지도 없는 것) · 쓰기 `createDiscussion` · `replyToDiscussion`
 *     (`comment` 능력 — 볼 수만 있으면 403) · 고치기 · 지우기 `editComment` · `deleteComment`(작성자만 — 남의 코멘트는 403 · 지우면 내용을 비우고
 *     마지막 글이면 스레드째). 알림 · 활동 · 구독 · 코멘트 안의 멘션 알림은 명령이 한다 — 행위자는 토큰의 사람이다
 *   · 잠긴 페이지에도 코멘트를 단다(앱이 그렇다 — 잠금은 본문 · 속성 편집을 막는다)
 *   · 해결된 스레드는 목록에 없다(노션) · 하나를 id 로 읽으면 준다 · 해결된 스레드에 답하면 다시 열린다(앱의 규칙 — 노션은 그대로 둔다)
 *   · 제안의 스레드(`suggestion.thread_id`)는 코멘트가 아니다 — 목록에서 뺀다
 *   · 블록에 다는 새 스레드는 블록 하나 전체에(앱의 블록 스레드) · 글자 범위 스레드는 노션처럼 만들 수 없다(답글은 된다)
 *
 * `block_id` 가 페이지면 그 페이지의 모든 열린 스레드(페이지 스레드 + 본문 블록의 스레드), 본문 블록이면 그 블록의 스레드다. 코멘트의 이름
 * (`display_name.resolved_name`)은 그 사람의 지금 이름이다. 내보내기 정책을 끄면 소유자만(코멘트도 내용이다 — 쓰기의 응답도 코멘트를
 * 돌려준다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import {
  createDiscussion,
  deleteComment,
  editComment,
  listDiscussions,
  replyToDiscussion,
  type CommentFailure,
  type CommentResult,
  type DiscussionView,
} from '../comment/discussion.ts'
import { query, queryMaybe } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { locateIn } from './block-body.ts'
import {
  commentListEnvelope,
  commentToApi,
  decodeCommentCursor,
  encodeCommentCursor,
  parseCommentCreate,
  parseCommentUpdate,
  type ApiComment,
  type CommentSource,
} from './comment-object.ts'
import { apiLinks, invalid, policyBlock, restricted } from './pages.ts'
import type { ApiLinks } from './rich-text.ts'
import { v1Fail, v1Ok, type V1Handler, type V1Reply } from './v1.ts'
import { invalidPathIdMessage, parseApiId, parsePageSize, shownValue, API_MAX_PAGE_SIZE } from './v1-protocol.ts'

const missing = (kind: 'page' | 'block' | 'discussion' | 'comment', id: string): V1Reply =>
  v1Fail(404, 'object_not_found', `Could not find ${kind} with ID: ${id}.`)

const AUTHOR_ONLY_MESSAGE = 'Only the author of a comment can update or delete it.'
const DATABASE_MESSAGE = 'Databases have no comments. Use the ID of a page or of a block in a page.'

// ── 읽기 ──────────────────────────────────────────────────────────────

/** 코멘트가 사는 페이지 — 행으로 찾기만 한다(볼 수 있는지는 `listDiscussions` 가 본다). */
async function pageOfComment(ctx: SessionContext, commentId: string): Promise<string | null> {
  const row = await queryMaybe<{ page_id: string }>(
    `SELECT d.page_id FROM comment c JOIN discussion d ON d.id = c.discussion_id WHERE c.id = $1 AND d.workspace_id = $2`,
    [commentId, ctx.workspaceId],
  )
  return row?.page_id ?? null
}

/** 한 페이지의 스레드 — 앱의 읽기 그대로에서 제안의 스레드만 뺀다. */
async function threadsOf(
  ctx: SessionContext,
  pageId: string,
  resolved?: boolean,
): Promise<CommentResult<{ readonly discussions: readonly DiscussionView[] }>> {
  const listed = await listDiscussions(ctx, pageId, resolved === undefined ? {} : { resolved })
  if (!listed.ok || listed.discussions.length === 0) return listed
  const hidden = new Set(
    (await query<{ thread_id: string }>(`SELECT thread_id FROM suggestion WHERE page_id = $1 AND thread_id IS NOT NULL`, [pageId])).map(
      (r) => r.thread_id,
    ),
  )
  return { ok: true, discussions: listed.discussions.filter((d) => !hidden.has(d.id)) }
}

/** 스레드들의 살아 있는 코멘트 → 객체의 재료(스레드 차례 → 코멘트 차례). 지운 코멘트는 없다(내용이 없다 — 불변식 D3). */
async function sourcesOf(discussions: readonly DiscussionView[]): Promise<CommentSource[]> {
  const live = discussions.flatMap((d) => d.comments.filter((c) => !c.deleted).map((c) => ({ d, c })))
  const authors = [...new Set(live.map(({ c }) => c.authorId))]
  const names = new Map(
    authors.length === 0
      ? []
      : (await query<{ id: string; name: string }>(`SELECT id, name FROM "user" WHERE id = ANY($1::uuid[])`, [authors])).map((r) => [r.id, r.name]),
  )
  return live.map(({ d, c }) => ({
    id: c.id,
    discussionId: d.id,
    // 가리키던 블록이 사라진 스레드는 앱이 페이지 코멘트로 보여 준다(05 F-05-07 "강등")
    parent: d.onPage || d.orphaned ? { kind: 'page' as const, id: d.pageId } : { kind: 'block' as const, id: d.blockId },
    authorId: c.authorId,
    authorName: names.get(c.authorId) ?? null,
    richText: c.richText,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
  }))
}

/** 코멘트 하나 — 볼 수 없거나 · 지웠거나 · 제안의 스레드면 null. 해결된 스레드의 것도 준다. */
async function readComment(ctx: SessionContext, commentId: string, links: ApiLinks): Promise<ApiComment | null> {
  const pageId = await pageOfComment(ctx, commentId)
  if (pageId === null) return null
  const threads = await threadsOf(ctx, pageId)
  if (!threads.ok) return null
  const owner = threads.discussions.find((d) => d.comments.some((c) => c.id === commentId))
  if (owner === undefined) return null
  const source = (await sourcesOf([owner])).find((s) => s.id === commentId)
  return source === undefined ? null : commentToApi(source, links)
}

/** id 가 가리키는 코멘트의 자리 — 페이지면 그 페이지 전체 · 본문 블록이면 그 블록(그 블록을 가진 페이지). */
type CommentPlace = { readonly kind: 'page'; readonly pageId: string } | { readonly kind: 'block'; readonly pageId: string; readonly blockId: string }

async function placeOf(ctx: SessionContext, id: string): Promise<CommentPlace | 'database' | null> {
  const located = await withReadTransaction((tx) => locateIn(tx, ctx, id))
  if (located === null) return null
  if (located.kind === 'database') return 'database'
  return located.kind === 'page' ? { kind: 'page', pageId: located.page.id } : { kind: 'block', pageId: located.owner.id, blockId: id }
}

/** `GET /v1/comments?block_id=…` — 열린 코멘트(쪽 나누기). */
export const listApiComments: V1Handler = async ({ ctx, request }) => {
  const url = new URL(request.url)
  const raw = url.searchParams.get('block_id')
  if (raw === null || raw === '') return invalid('query failed validation: block_id should be defined, instead was `undefined`.')
  const id = parseApiId(raw)
  if (id === null) return invalid(`query failed validation: block_id should be a valid uuid, instead was ${shownValue(raw)}.`)
  const pageSize = parsePageSize(url.searchParams.get('page_size'))
  if (pageSize === null) {
    return invalid(`query failed validation: page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(url.searchParams.get('page_size'))}.`)
  }
  const offset = decodeCommentCursor(id, url.searchParams.get('start_cursor'))
  if (offset === null) {
    return invalid(`query failed validation: start_cursor should be a cursor from a previous response for this block_id, instead was ${shownValue(url.searchParams.get('start_cursor'))}.`)
  }

  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const place = await placeOf(ctx, id)
  if (place === null) return missing('block', id)
  if (place === 'database') return invalid(DATABASE_MESSAGE)
  const threads = await threadsOf(ctx, place.pageId, false)
  if (!threads.ok) return missing('block', id)
  const mine = place.kind === 'page' ? threads.discussions : threads.discussions.filter((d) => d.blockId === place.blockId)
  const all = await sourcesOf(mine)
  const links = apiLinks(ctx, request)
  const slice = all.slice(offset, offset + pageSize).map((s) => commentToApi(s, links))
  const end = offset + slice.length
  return v1Ok(commentListEnvelope(slice, end < all.length ? encodeCommentCursor(id, end) : null))
}

/** `GET /v1/comments/{comment_id}` */
export const retrieveApiComment: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.comment_id)
  if (id === null) return invalid(invalidPathIdMessage('comment_id', params.comment_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const comment = await readComment(ctx, id, apiLinks(ctx, request))
  return comment === null ? missing('comment', id) : v1Ok(comment)
}

// ── 쓰기 ──────────────────────────────────────────────────────────────

/** 명령의 거부 → 노션의 답. `notFound` 는 대상이 없을 때의 답(대상마다 다르다). */
function failureReply(reason: CommentFailure, notFound: () => V1Reply, message?: string): V1Reply {
  switch (reason) {
    case 'not_found':
      return notFound()
    case 'forbidden':
      return message === AUTHOR_ONLY_MESSAGE ? v1Fail(403, 'restricted_resource', AUTHOR_ONLY_MESSAGE) : restricted()
    case 'block_not_found':
      return notFound()
    case 'empty':
      return invalid('body failed validation: body.rich_text should have some text — a comment cannot be blank.')
    case 'too_long':
      return invalid('body failed validation: body.rich_text — a comment can have at most 2000 characters.')
    case 'invalid_rich_text':
    case 'invalid_anchor':
    case 'invalid_emoji':
      return invalid('body failed validation: body.rich_text is invalid.')
  }
}

/** 남의 코멘트라서 거부됐는가 — 명령은 둘(능력 없음 · 작성자 아님)을 같은 `forbidden` 으로 준다. 글로 가르지 않고 작성자를 본다. */
async function forbiddenReason(ctx: SessionContext, commentId: string, links: ApiLinks): Promise<string | undefined> {
  const comment = await readComment(ctx, commentId, links)
  return comment !== null && comment.created_by.id !== ctx.userId ? AUTHOR_ONLY_MESSAGE : undefined
}

/** `POST /v1/comments` — 페이지 · 블록에 새 스레드, 또는 스레드에 답글. */
export const createApiComment: V1Handler = async ({ ctx, body, request }) => {
  const parsed = parseCommentCreate(body)
  if (!parsed.ok) return invalid(parsed.message)
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const { target, runs } = parsed.value
  const links = apiLinks(ctx, request)

  let commentId: string
  if (target.kind === 'discussion') {
    const replied = await replyToDiscussion(ctx, target.id, runs)
    if (!replied.ok) return failureReply(replied.reason, () => missing('discussion', target.id))
    commentId = replied.commentId
  } else {
    let pageId = target.id
    let blockId: string | null = null
    if (target.kind === 'block') {
      // 블록 id — 페이지면 페이지 스레드(노션의 페이지도 블록이다) · 본문 블록이면 그 블록 하나에 다는 스레드
      const place = await placeOf(ctx, target.id)
      if (place === null) return missing('block', target.id)
      if (place === 'database') return invalid(DATABASE_MESSAGE)
      pageId = place.pageId
      blockId = place.kind === 'block' ? place.blockId : null
    }
    const opened = await createDiscussion(ctx, { pageId, blockId, richText: runs })
    if (!opened.ok) return failureReply(opened.reason, () => missing(target.kind === 'page' ? 'page' : 'block', target.id))
    commentId = opened.commentId
  }
  const comment = await readComment(ctx, commentId, links)
  return v1Ok(comment ?? { object: 'comment', id: commentId })
}

/** `PATCH /v1/comments/{comment_id}` — 내 코멘트의 글을 바꾼다. */
export const updateApiComment: V1Handler = async ({ ctx, params, body, request }) => {
  const id = parseApiId(params.comment_id)
  if (id === null) return invalid(invalidPathIdMessage('comment_id', params.comment_id))
  const parsed = parseCommentUpdate(body)
  if (!parsed.ok) return invalid(parsed.message)
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const links = apiLinks(ctx, request)

  const edited = await editComment(ctx, id, parsed.value)
  if (!edited.ok) {
    const why = edited.reason === 'forbidden' ? await forbiddenReason(ctx, id, links) : undefined
    return failureReply(edited.reason, () => missing('comment', id), why)
  }
  const comment = await readComment(ctx, id, links)
  return comment === null ? missing('comment', id) : v1Ok(comment)
}

/** `DELETE /v1/comments/{comment_id}` — 내 코멘트를 지운다. 지우기 전의 객체를 돌려준다(노션). */
export const deleteApiComment: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.comment_id)
  if (id === null) return invalid(invalidPathIdMessage('comment_id', params.comment_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const links = apiLinks(ctx, request)

  const before = await readComment(ctx, id, links)
  if (before === null) return missing('comment', id)
  const removed = await deleteComment(ctx, id)
  if (!removed.ok) {
    const why = removed.reason === 'forbidden' && before.created_by.id !== ctx.userId ? AUTHOR_ONLY_MESSAGE : undefined
    return failureReply(removed.reason, () => missing('comment', id), why)
  }
  return v1Ok(before)
}
