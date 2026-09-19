/**
 * 코멘트 스레드 · 코멘트 · 반응 — 서버 명령 한 벌 (F-05-08 · F-05-07 · F-11-05)
 *
 * 정본: 00-canonical-data-model.md §3.9 `discussion` · `comment` · `reaction`(+ 마이그레이션 0018 의 보강)
 *       05-collaboration-sync.md F-05-07 · F-05-08 (엣지 케이스 표 · 권한 정책)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 코멘트의 자리는 Y.Doc 이 정한다 — 행이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 스레드는 블록 하나를 가리킨다(`parent_block_id`). 페이지 스레드면 페이지 블록, 인라인이면 본문 블록이다.
 * 본문 블록의 **행**은 Y.Doc 의 투영이므로(판결 X-1) 그 행에 물으면 두 번 틀린다.
 *
 *   ① 방금 친 문단에 코멘트를 달 수 없다 — 참여자 경로의 투영은 창(1s)만큼 늦다(CRDT 5d)
 *   ② 남이 그 문단을 지우면 스레드의 근거가 사라진다 — 프로젝터가 행을 hard delete 한다
 *
 * 그래서 **있는지도 · 사라졌는지도 Y.Doc 에 묻는다**(`readBodyState` → `readBodyYDoc`). 사라진 스레드는 지우지 않고
 * `orphaned` 로 표시해 페이지 스레드처럼 보여준다 — 05 F-05-07 의 엣지 케이스가 정한 동작이다.
 *
 * 코멘트는 본문을 **읽기만 한다.** 본문 쓰기 경로(`block/body-write.ts`)를 거치지 않고, Y.Doc 에 아무것도 쓰지 않는다.
 * 코멘트가 본문 안에 들어가는 순간 "해결됨으로 거르기"와 "페이지를 넘겨 읽기"가 전부 문서 전체 읽기가 된다
 * (정본 §3.9: *"코멘트는 CRDT 에 넣지 않는다(관계형)"*).
 *
 * 글자 범위에 단 스레드는 앵커를 하나 더 갖는다(`anchor.ts` — 2조각). **앵커는 보낸 쪽이 자기 Y.Doc 에서 만들고**,
 * 이곳은 모양만 보고 받아 둔다. 지금 풀리는지는 보지 않는다 — 방금 친 글자를 가리키면 그 update 가 도착하기 전까지
 * 풀리지 않고, 도착하면 스스로 풀린다. 풀리지 않는 동안은 고아로 보이고 원문 스냅샷(`quoted_text`)이 그 자리를 지킨다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한 — 쓰는 권한과 정리하는 권한을 나눈다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 05 F-05-08 의 자체 정책: *"resolve/reopen 은 `Can edit` 이상, 코멘트 작성은 `Can comment` 이상(작성 권한과 정리
 * 권한을 분리)"*. 우리 capability 로 옮기면 작성 · 답글 · 반응은 `comment`, 해결 · 재오픈은 `edit_content` 다.
 *
 * 읽기는 `view`. 볼 수 없는 페이지에는 **없는 것처럼** 답한다(HANDOFF §3.2-18) — "권한이 없다"고 답하면 그 페이지가
 * 있다는 것과 스레드가 달렸다는 것을 알려주게 된다. 볼 수는 있지만 쓸 수 없으면 `forbidden` 이다.
 *
 * 수정 · 삭제는 **작성자만** 한다. 05 F-05-08 이 인정하는 경로가 *"자기 코멘트 수정/삭제"* 하나뿐이라, 페이지 관리자가
 * 남의 코멘트를 고치는 길은 만들지 않았다(만들면 "고친 것인지 쓴 것인지"를 행이 구분하지 못한다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 원본과 다르게 정한 것 둘
 * ──────────────────────────────────────────────────────────────────────
 *
 *   · **답글은 해결된 스레드를 다시 연다.** 05 F-05-08 이 재확인한 대로 노션은 수동 재오픈뿐이고, 이 문서가 그것을
 *     "의도된 원본과의 차이"로 기록했다 — *"해결된 스레드에 달린 답글이 아무에게도 안 보이는 것이 더 나쁜 실패"*
 *   · **마지막 살아 있는 코멘트를 지우면 스레드도 지운다.** 05 F-05-08 이 정책 결정으로 남긴 자리다. 중간 코멘트를
 *     지우면 스레드는 남고 "삭제된 코멘트" 자리가 남지만(맥락), 아무 글도 남지 않은 스레드는 목록에 있을 이유가 없다
 */

import { randomUUID } from 'node:crypto'

import type * as Y from 'yjs'

import type { SessionContext } from '../auth/session-context.ts'
import { readBodyState } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import {
  normalizeRichText,
  textRun,
  toPlainText,
  validateRichText,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import { withTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can, type Capability } from '../permissions/levels.ts'
import {
  acceptAnchor,
  anchorFromStored,
  bodyView,
  resolveTextRangeAnchor,
  storedAnchor,
  type AnchorRange,
  type TextRangeAnchor,
} from './anchor.ts'

/**
 * 코멘트 한 개의 평문 상한.
 *
 * 정본에도 05 문서에도 값이 없다. 코멘트는 본문이 아니다 — 긴 글은 본문에 쓴다. `rich_text` 계약이 이미 런마다
 * 2000자 · 런 100개로 막지만(200,000자) 그것은 "계약 위반"의 경계이지 코멘트의 경계가 아니다.
 */
export const MAX_COMMENT_LENGTH = 2000

/** 반응 이모지의 바이트가 아니라 글자 수 상한. DB 의 CHECK 과 같은 값이다(0018). */
export const MAX_EMOJI_LENGTH = 16

export type CommentFailure =
  /** 페이지 · 스레드 · 코멘트가 없거나 볼 수 없다 — 둘을 구분하지 않는다(§3.2-18). */
  | 'not_found'
  /** 볼 수는 있지만 이 조작의 권한이 없다. */
  | 'forbidden'
  /** 이 페이지 본문에 그 블록이 없다(Y.Doc 에 물었다). */
  | 'block_not_found'
  /** 앵커를 받을 수 없다 — 모양이 아니거나, 블록 없이 왔거나, 페이지 스레드에 달렸다(D4). */
  | 'invalid_anchor'
  /** 공백뿐인 코멘트. */
  | 'empty'
  | 'too_long'
  | 'invalid_rich_text'
  | 'invalid_emoji'

export type CommentResult<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: CommentFailure; readonly message?: string }

const fail = (reason: CommentFailure, message?: string): CommentResult<never> =>
  ({ ok: false, reason, message }) as CommentResult<never>

// ── 입력 검증 ─────────────────────────────────────────────────────────

/** 쓰기 경로의 코멘트 본문 검증 — 통과하면 정규화한 것을 준다. */
function checkRichText(raw: unknown): { ok: true; value: RichTextRun[] } | { ok: false; reason: CommentFailure; message: string } {
  const issues = validateRichText(raw, 'rich_text')
  if (issues.length > 0) {
    return { ok: false, reason: 'invalid_rich_text', message: issues.map((i) => `${i.path} ${i.message}`).join(', ') }
  }
  const normalized = normalizeRichText(raw as RichTextRun[])
  const text = toPlainText(normalized)
  if (text.trim() === '') return { ok: false, reason: 'empty', message: '빈 코멘트는 저장하지 않습니다.' }
  if (text.length > MAX_COMMENT_LENGTH) {
    return { ok: false, reason: 'too_long', message: `코멘트가 ${MAX_COMMENT_LENGTH}자를 넘습니다.` }
  }
  return { ok: true, value: normalized }
}

// ── 권한 ──────────────────────────────────────────────────────────────

type Access = 'ok' | 'not_found' | 'forbidden'

/**
 * 이 페이지에서 이 capability 를 갖는가 — 볼 수 없으면 `not_found`(HANDOFF §3.2-18).
 *
 * 휴지통에 있는 페이지는 없는 것으로 본다(`lifecycle='live'`). 본문을 읽는 곳(`doc-store.ts` `accessOf`)과 같은 조건이다 —
 * 버린 페이지의 코멘트만 쓸 수 있으면 "페이지는 안 보이는데 알림은 온다"가 된다.
 */
async function pageAccessFor(tx: Tx, ctx: SessionContext, pageId: string, required: Capability): Promise<Access> {
  if (!isUuid(pageId)) return 'not_found'
  const page = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
    [pageId, ctx.workspaceId],
  )
  if (page === null) return 'not_found'
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (!can(caps, 'view')) return 'not_found'
  return can(caps, required) ? 'ok' : 'forbidden'
}

// ── 본문(Y.Doc)에 묻기 ────────────────────────────────────────────────

function collectIds(blocks: readonly EditorBlock[], out: Set<string>): void {
  for (const block of blocks) {
    out.add(block.id)
    if (block.children !== undefined) collectIds(block.children, out)
  }
}

export function bodyBlockIds(doc: EditorDoc): Set<string> {
  const ids = new Set<string>()
  collectIds(doc.blocks, ids)
  return ids
}

type BodyLook = {
  /** 본문에 있는 블록 id — 정규화해 읽은 것(`readBodyYDoc`), 투영이 보는 것과 같다. */
  readonly ids: ReadonlySet<string>
  /** 앵커를 풀 때 쓴다. 아직 Y.Doc 으로 옮기지 않은 페이지면 null. */
  readonly ydoc: Y.Doc | null
}

/**
 * 이 페이지 본문 — 아직 Y.Doc 으로 옮기지 않은 페이지면 비어 있다.
 *
 * 빈 것은 "본문에 블록이 없다"와 같게 취급한다. 페이지를 열면 첫 읽기가 옮기므로(`loadDocState`), 코멘트를 달 수 있는
 * 화면에 닿은 페이지는 이미 옮겨져 있다.
 */
async function bodyOf(tx: Tx, pageId: string): Promise<BodyLook> {
  const state = await readBodyState(tx, pageId)
  if (state === null) return { ids: new Set<string>(), ydoc: null }
  return { ids: bodyBlockIds(readBodyYDoc(state.ydoc, pageId).doc), ydoc: state.ydoc }
}

// ── 스레드 만들기 ─────────────────────────────────────────────────────

export type CreateDiscussionInput = {
  readonly pageId: string
  /** 스레드를 달 본문 블록. 생략하거나 `pageId` 와 같으면 페이지 스레드다. */
  readonly blockId?: string | null
  /**
   * 글자 범위 앵커 — **보낸 쪽이 자기 Y.Doc 에서 만든다**(`anchor.ts` `textRangeAnchor`). 없으면 블록 하나를 가리키는
   * 스레드다. 페이지 스레드에는 둘 수 없다(불변식 D4).
   */
  readonly anchor?: unknown
  readonly richText: unknown
}

/**
 * 스레드를 열고 **첫 코멘트까지 한 트랜잭션에서** 쓴다.
 *
 * 둘로 나누면 "코멘트 없는 스레드"를 만들 수 있고, 그 상태는 화면에 빈 말풍선으로 남는다. 05 F-05-08 이 코멘트 0개인
 * 스레드를 정책 결정으로 남긴 것은 **지운 뒤**의 이야기지 만드는 순간의 이야기가 아니다.
 */
export async function createDiscussion(
  ctx: SessionContext,
  input: CreateDiscussionInput,
): Promise<CommentResult<{ readonly discussionId: string; readonly commentId: string }>> {
  const text = checkRichText(input.richText)
  if (!text.ok) return fail(text.reason, text.message)

  return withTransaction(async (tx) => {
    const access = await pageAccessFor(tx, ctx, input.pageId, 'comment')
    if (access !== 'ok') return fail(access)

    const blockId = input.blockId ?? input.pageId
    if (blockId !== input.pageId) {
      // 본문에 있는가 — Y.Doc 에 묻는다(머리말). 행에 물으면 방금 친 블록에 코멘트를 달 수 없다.
      if (!isUuid(blockId) || !(await bodyOf(tx, input.pageId)).ids.has(blockId)) return fail('block_not_found')
    }

    // 앵커는 받아 두기만 한다 — **풀리는지는 보지 않는다.** 보낸 쪽이 방금 친 글자를 가리키면 그 update 가 도착하기
    // 전까지 풀리지 않는데(`anchor.ts` 머리말), 그때 거부하면 "방금 고른 글에 코멘트 달기"가 끊긴다.
    let anchor: TextRangeAnchor | null = null
    if (input.anchor !== undefined && input.anchor !== null) {
      if (blockId === input.pageId) return fail('invalid_anchor', '페이지 스레드에는 글자 범위를 둘 수 없습니다.')
      anchor = acceptAnchor(input.anchor)
      if (anchor === null) return fail('invalid_anchor')
    }

    const discussionId = randomUUID()
    const commentId = randomUUID()
    await tx.query(
      `INSERT INTO discussion (id, workspace_id, page_id, parent_block_id, anchor, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())`,
      [
        discussionId,
        ctx.workspaceId,
        input.pageId,
        blockId,
        anchor === null ? null : JSON.stringify(storedAnchor(anchor)),
        ctx.userId,
      ],
    )
    await tx.query(
      `INSERT INTO comment (id, discussion_id, created_by, rich_text, created_at)
       VALUES ($1, $2, $3, $4::jsonb, now())`,
      [commentId, discussionId, ctx.userId, JSON.stringify(text.value)],
    )
    return { ok: true, discussionId, commentId } as const
  })
}

// ── 답글 ──────────────────────────────────────────────────────────────

type DiscussionRow = { id: string; page_id: string; resolved: boolean }

async function lockDiscussion(tx: Tx, ctx: SessionContext, discussionId: string): Promise<DiscussionRow | null> {
  if (!isUuid(discussionId)) return null
  return tx.queryMaybe<DiscussionRow>(
    `SELECT id, page_id, resolved FROM discussion WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [discussionId, ctx.workspaceId],
  )
}

/**
 * 답글. 해결된 스레드면 **다시 연다**(머리말 — 의도된 원본과의 차이).
 *
 * 스레드 행을 잠그고 시작한다. 잠그지 않으면 "해결"과 "답글"이 동시에 들어올 때 해결이 나중에 커밋되어 방금 단 답글이
 * 접힌 채로 남는다 — 아무도 보지 못하는 답글이 정확히 이 동작이 막으려던 것이다.
 */
export async function replyToDiscussion(
  ctx: SessionContext,
  discussionId: string,
  richText: unknown,
): Promise<CommentResult<{ readonly commentId: string; readonly reopened: boolean }>> {
  const text = checkRichText(richText)
  if (!text.ok) return fail(text.reason, text.message)

  return withTransaction(async (tx) => {
    const row = await lockDiscussion(tx, ctx, discussionId)
    if (row === null) return fail('not_found')
    const access = await pageAccessFor(tx, ctx, row.page_id, 'comment')
    if (access !== 'ok') return fail(access)

    const commentId = randomUUID()
    await tx.query(
      `INSERT INTO comment (id, discussion_id, created_by, rich_text, created_at)
       VALUES ($1, $2, $3, $4::jsonb, now())`,
      [commentId, discussionId, ctx.userId, JSON.stringify(text.value)],
    )
    if (row.resolved) {
      await tx.query(
        `UPDATE discussion SET resolved = false, resolved_by = NULL, resolved_at = NULL WHERE id = $1`,
        [discussionId],
      )
    }
    return { ok: true, commentId, reopened: row.resolved } as const
  })
}

// ── 해결 · 재오픈 ─────────────────────────────────────────────────────

/**
 * 스레드를 접거나 다시 연다 — `edit_content` 가 필요하다(머리말: 작성 권한과 정리 권한을 나눈다).
 *
 * 멱등이다. 05 F-05-08 엣지: *"두 명이 동시에 resolve → 멱등 처리. resolved_by 는 먼저 커밋된 쪽"*. 행 잠금이 그것을
 * 그대로 만든다 — 뒤에 온 쪽은 이미 resolved 인 행을 보고 아무것도 쓰지 않는다.
 */
export async function setDiscussionResolved(
  ctx: SessionContext,
  discussionId: string,
  resolved: boolean,
): Promise<CommentResult<{ readonly changed: boolean }>> {
  return withTransaction(async (tx) => {
    const row = await lockDiscussion(tx, ctx, discussionId)
    if (row === null) return fail('not_found')
    const access = await pageAccessFor(tx, ctx, row.page_id, 'edit_content')
    if (access !== 'ok') return fail(access)
    if (row.resolved === resolved) return { ok: true, changed: false } as const

    await tx.query(
      resolved
        ? `UPDATE discussion SET resolved = true, resolved_by = $2, resolved_at = now() WHERE id = $1`
        : `UPDATE discussion SET resolved = false, resolved_by = NULL, resolved_at = NULL WHERE id = $1`,
      resolved ? [discussionId, ctx.userId] : [discussionId],
    )
    return { ok: true, changed: true } as const
  })
}

// ── 코멘트 수정 · 삭제 ────────────────────────────────────────────────

type CommentRow = { id: string; discussion_id: string; page_id: string; created_by: string; deleted_at: Date | null }

async function lockComment(tx: Tx, ctx: SessionContext, commentId: string): Promise<CommentRow | null> {
  if (!isUuid(commentId)) return null
  return tx.queryMaybe<CommentRow>(
    `SELECT c.id, c.discussion_id, c.created_by, c.deleted_at, d.page_id
       FROM comment c JOIN discussion d ON d.id = c.discussion_id
      WHERE c.id = $1 AND d.workspace_id = $2
      FOR UPDATE OF c`,
    [commentId, ctx.workspaceId],
  )
}

/** 내 코멘트 고치기. 남의 코멘트는 forbidden, 지워진 코멘트는 없는 것이다. */
export async function editComment(
  ctx: SessionContext,
  commentId: string,
  richText: unknown,
): Promise<CommentResult<object>> {
  const text = checkRichText(richText)
  if (!text.ok) return fail(text.reason, text.message)

  return withTransaction(async (tx) => {
    const row = await lockComment(tx, ctx, commentId)
    if (row === null || row.deleted_at !== null) return fail('not_found')
    const access = await pageAccessFor(tx, ctx, row.page_id, 'comment')
    if (access !== 'ok') return fail(access)
    if (row.created_by !== ctx.userId) return fail('forbidden', '자기 코멘트만 고칠 수 있습니다.')

    await tx.query(`UPDATE comment SET rich_text = $2::jsonb, last_edited_at = now() WHERE id = $1`, [
      commentId,
      JSON.stringify(text.value),
    ])
    return { ok: true } as const
  })
}

/**
 * 내 코멘트 지우기 — **내용을 비우고** 행을 남긴다(불변식 D3).
 *
 * 남은 살아 있는 코멘트가 없으면 스레드까지 지운다(머리말). 반응은 다형 참조라 FK 가 없다 — 지우는 쪽이 함께 지운다.
 * 남겨 두면 아무도 가리키지 않는 행이 쌓이고, 같은 대상 id 로 다시 세면 유령 반응이 보인다.
 */
export async function deleteComment(
  ctx: SessionContext,
  commentId: string,
): Promise<CommentResult<{ readonly discussionDeleted: boolean }>> {
  return withTransaction(async (tx) => {
    const row = await lockComment(tx, ctx, commentId)
    if (row === null || row.deleted_at !== null) return fail('not_found')
    const access = await pageAccessFor(tx, ctx, row.page_id, 'comment')
    if (access !== 'ok') return fail(access)
    if (row.created_by !== ctx.userId) return fail('forbidden', '자기 코멘트만 지울 수 있습니다.')

    await tx.query(`UPDATE comment SET rich_text = '[]'::jsonb, deleted_at = now() WHERE id = $1`, [commentId])
    await tx.query(`DELETE FROM reaction WHERE target_kind = 'comment' AND target_id = $1`, [commentId])

    const remaining = await tx.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM comment WHERE discussion_id = $1 AND deleted_at IS NULL`,
      [row.discussion_id],
    )
    if (remaining.n !== '0') return { ok: true, discussionDeleted: false } as const

    await tx.query(
      `DELETE FROM reaction
        WHERE (target_kind = 'discussion' AND target_id = $1)
           OR (target_kind = 'comment' AND target_id IN (SELECT id FROM comment WHERE discussion_id = $1))`,
      [row.discussion_id],
    )
    // comment 는 ON DELETE CASCADE 로 함께 지워진다(0018).
    await tx.query(`DELETE FROM discussion WHERE id = $1`, [row.discussion_id])
    return { ok: true, discussionDeleted: true } as const
  })
}

// ── 반응 ──────────────────────────────────────────────────────────────

export const REACTION_TARGETS = ['comment', 'discussion'] as const
export type ReactionTarget = (typeof REACTION_TARGETS)[number]

export type ToggleReactionInput = {
  readonly targetKind: ReactionTarget
  readonly targetId: string
  readonly emoji: string
}

/**
 * 같은 이모지를 다시 누르면 없앤다 — PK `(target_kind, target_id, user_id, emoji)` 가 곧 2P-Set 이다(정본 §3.9).
 *
 * 지워진 코멘트에는 반응할 수 없다. 내용이 없는 글에 붙은 반응은 무엇에 대한 반응인지 알 수 없다(D3 의 뒷면).
 */
export async function toggleReaction(
  ctx: SessionContext,
  input: ToggleReactionInput,
): Promise<CommentResult<{ readonly added: boolean }>> {
  const emoji = typeof input.emoji === 'string' ? input.emoji.trim() : ''
  if (emoji === '' || emoji.length > MAX_EMOJI_LENGTH || /\s/.test(emoji)) return fail('invalid_emoji')
  if (!REACTION_TARGETS.includes(input.targetKind)) return fail('invalid_emoji', '대상 종류가 올바르지 않습니다.')
  if (!isUuid(input.targetId)) return fail('not_found')

  return withTransaction(async (tx) => {
    const target = await tx.queryMaybe<{ page_id: string }>(
      input.targetKind === 'discussion'
        ? `SELECT page_id FROM discussion WHERE id = $1 AND workspace_id = $2`
        : `SELECT d.page_id FROM comment c JOIN discussion d ON d.id = c.discussion_id
            WHERE c.id = $1 AND d.workspace_id = $2 AND c.deleted_at IS NULL`,
      [input.targetId, ctx.workspaceId],
    )
    if (target === null) return fail('not_found')
    const access = await pageAccessFor(tx, ctx, target.page_id, 'comment')
    if (access !== 'ok') return fail(access)

    const removed = await tx.query<{ emoji: string }>(
      `DELETE FROM reaction
        WHERE target_kind = $1 AND target_id = $2 AND user_id = $3 AND emoji = $4
        RETURNING emoji`,
      [input.targetKind, input.targetId, ctx.userId, emoji],
    )
    if (removed.length > 0) return { ok: true, added: false } as const

    await tx.query(
      `INSERT INTO reaction (target_kind, target_id, user_id, emoji, created_at) VALUES ($1, $2, $3, $4, now())`,
      [input.targetKind, input.targetId, ctx.userId, emoji],
    )
    return { ok: true, added: true } as const
  })
}

// ── 읽기 ──────────────────────────────────────────────────────────────

export type ReactionView = {
  readonly emoji: string
  /** 누른 사람들, 누른 순서대로. */
  readonly userIds: readonly string[]
}

export type CommentView = {
  readonly id: string
  readonly authorId: string
  /** 지운 코멘트는 빈 배열이다 — 행에도 없다(불변식 D3). */
  readonly richText: readonly RichTextRun[]
  readonly deleted: boolean
  readonly createdAt: Date
  readonly editedAt: Date | null
  readonly reactions: readonly ReactionView[]
}

export type DiscussionAnchorView = {
  /** 만들 때의 원문 스냅샷. 앵커를 풀지 못하면 이것을 보여준다(05 F-05-07 "반드시 저장한다"). */
  readonly quotedText: string
  /** 지금 풀리는 범위(블록 안 오프셋). 못 풀면 null, 길이 0 이면 범위가 다 지워진 것이다. */
  readonly range: AnchorRange | null
}

export type DiscussionView = {
  readonly id: string
  readonly pageId: string
  readonly blockId: string
  /** 페이지 스레드인가 — 본문의 한 블록이 아니라 페이지 전체에 달렸다. */
  readonly onPage: boolean
  /** 글자 범위에 달린 스레드면 그 앵커. 블록 하나를 가리키는 스레드면 null. */
  readonly anchor: DiscussionAnchorView | null
  /**
   * 가리키던 자리가 본문에서 사라졌는가 — 블록이 없거나, 앵커가 풀리지 않거나, 범위가 다 지워졌다.
   * 05 F-05-07: *"스레드는 생존. '원본 없음(orphaned)' 표시 후 페이지 코멘트로 강등"*.
   * 판정은 Y.Doc 이 한다(머리말) — 행은 늦거나 이미 지워져 있다.
   */
  readonly orphaned: boolean
  readonly resolved: boolean
  readonly resolvedBy: string | null
  readonly createdBy: string
  readonly createdAt: Date
  readonly comments: readonly CommentView[]
  readonly reactions: readonly ReactionView[]
}

export type ListDiscussionsOptions = {
  /** 생략하면 열린 것과 해결된 것을 모두 준다. 05 F-05-08 의 'Open'/'Resolved' 필터가 이 축이다. */
  readonly resolved?: boolean
}

/**
 * 손상된 코멘트 본문도 읽기는 던지지 않는다 — `block/page.ts` `readTitle` 과 같은 규칙이다.
 *
 * 코멘트 하나가 계약을 어겼다고 페이지의 스레드 전체가 500 이 되면 지울 수도 없다. 쓰기는 엄격하게(`checkRichText`),
 * 읽기는 관대하게.
 */
function readCommentText(raw: unknown): RichTextRun[] {
  if (!Array.isArray(raw)) return []
  if (validateRichText(raw).length === 0) return normalizeRichText(raw as RichTextRun[])
  const salvaged = raw
    .map((r) => (typeof r === 'object' && r !== null ? String((r as { plain_text?: unknown }).plain_text ?? '') : ''))
    .join('')
  return salvaged === '' ? [] : [textRun(salvaged)]
}

type ReactionRow = { target_kind: string; target_id: string; emoji: string; user_id: string }

/** (대상 종류, 대상 id) → 이모지별 사용자 목록. 순서는 누른 순서다(쿼리가 created_at 으로 정렬해 준다). */
function groupReactions(rows: readonly ReactionRow[]): Map<string, ReactionView[]> {
  const byTarget = new Map<string, Map<string, string[]>>()
  for (const row of rows) {
    const key = `${row.target_kind}:${row.target_id}`
    const emojis = byTarget.get(key) ?? new Map<string, string[]>()
    byTarget.set(key, emojis)
    const users = emojis.get(row.emoji) ?? []
    emojis.set(row.emoji, users)
    users.push(row.user_id)
  }
  const out = new Map<string, ReactionView[]>()
  for (const [key, emojis] of byTarget) {
    out.set(key, [...emojis].map(([emoji, userIds]) => ({ emoji, userIds })))
  }
  return out
}

/**
 * 한 페이지의 스레드 전부 — 코멘트와 반응까지 한 번에.
 *
 * 볼 수 없는 페이지는 없는 것이다(`not_found`). 스레드마다 권한을 다시 묻지 않는다 — 코멘트의 권한 경계는 페이지 하나이고
 * (정본 §3.9 에는 코멘트 단위 ACL 이 없다), 05 F-05-08 의 엣지도 *"페이지 권한 없는 사용자: 코멘트 자체가 보이지 않음
 * (페이지 권한이 상위)"* 이라고 적었다.
 */
export async function listDiscussions(
  ctx: SessionContext,
  pageId: string,
  options: ListDiscussionsOptions = {},
): Promise<CommentResult<{ readonly discussions: readonly DiscussionView[] }>> {
  return withReadTransaction(async (tx) => {
    const access = await pageAccessFor(tx, ctx, pageId, 'view')
    if (access !== 'ok') return fail(access)

    const rows = await tx.query<{
      id: string
      page_id: string
      parent_block_id: string
      anchor: unknown
      resolved: boolean
      resolved_by: string | null
      created_by: string
      created_at: Date
    }>(
      `SELECT id, page_id, parent_block_id, anchor, resolved, resolved_by, created_by, created_at
         FROM discussion
        WHERE page_id = $1 AND workspace_id = $2 AND ($3::boolean IS NULL OR resolved = $3)
        ORDER BY created_at, id`,
      [pageId, ctx.workspaceId, options.resolved ?? null],
    )
    if (rows.length === 0) return { ok: true, discussions: [] } as const

    const discussionIds = rows.map((r) => r.id)
    const comments = await tx.query<{
      id: string
      discussion_id: string
      created_by: string
      rich_text: unknown
      created_at: Date
      last_edited_at: Date | null
      deleted_at: Date | null
    }>(
      `SELECT id, discussion_id, created_by, rich_text, created_at, last_edited_at, deleted_at
         FROM comment WHERE discussion_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [discussionIds],
    )

    const commentIds = comments.map((c) => c.id)
    const reactions = groupReactions(
      await tx.query<ReactionRow>(
        `SELECT target_kind, target_id, emoji, user_id FROM reaction
          WHERE (target_kind = 'discussion' AND target_id = ANY($1::uuid[]))
             OR (target_kind = 'comment' AND target_id = ANY($2::uuid[]))
          ORDER BY created_at, user_id`,
        [discussionIds, commentIds],
      ),
    )

    // 본문은 스레드가 본문 블록을 가리킬 때만 읽는다 — 페이지 스레드뿐이면 Y.Doc 을 펼칠 이유가 없다.
    const onBlock = rows.some((r) => r.parent_block_id !== pageId)
    const body = onBlock ? await bodyOf(tx, pageId) : { ids: new Set<string>(), ydoc: null }
    // 앵커를 푸는 변환은 페이지마다 한 번만 만든다 — 스레드마다 만들면 본문을 스레드 수만큼 펼친다.
    const anchors = rows.map((r) => anchorFromStored(r.anchor))
    const view = anchors.some((a) => a !== null) && body.ydoc !== null ? bodyView(body.ydoc) : null

    const byDiscussion = new Map<string, CommentView[]>()
    for (const c of comments) {
      const list = byDiscussion.get(c.discussion_id) ?? []
      byDiscussion.set(c.discussion_id, list)
      list.push({
        id: c.id,
        authorId: c.created_by,
        richText: c.deleted_at === null ? readCommentText(c.rich_text) : [],
        deleted: c.deleted_at !== null,
        createdAt: c.created_at,
        editedAt: c.last_edited_at,
        reactions: reactions.get(`comment:${c.id}`) ?? [],
      })
    }

    const discussions = rows.map((r, i): DiscussionView => {
      const anchor = anchors[i]
      const range =
        anchor === null || body.ydoc === null || view === null
          ? null
          : resolveTextRangeAnchor(body.ydoc, r.parent_block_id, anchor, view)
      const lost = anchor !== null && (range === null || range.start === range.end)
      return {
        id: r.id,
        pageId: r.page_id,
        blockId: r.parent_block_id,
        onPage: r.parent_block_id === pageId,
        anchor: anchor === null ? null : { quotedText: anchor.quotedText, range },
        orphaned: r.parent_block_id !== pageId && (!body.ids.has(r.parent_block_id) || lost),
        resolved: r.resolved,
        resolvedBy: r.resolved_by,
        createdBy: r.created_by,
        createdAt: r.created_at,
        comments: byDiscussion.get(r.id) ?? [],
        reactions: reactions.get(`discussion:${r.id}`) ?? [],
      }
    })
    return { ok: true, discussions } as const
  })
}
