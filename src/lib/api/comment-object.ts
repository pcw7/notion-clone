/**
 * 공개 API 의 코멘트 — 노션의 코멘트 객체 · 요청 다듬기 (API-5 · F-09-07 · F-09-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑩ · §3.9 `discussion` · `comment` · 09-api-integrations.md F-09-07
 *
 * 객체(노션 `2025-09-03`): `object:'comment'` · `id` · `parent`(페이지 스레드 · 가리키던 블록이 사라진 스레드는 `page_id` — 앱이 페이지
 * 코멘트로 보여 준다 · 블록 스레드는 `block_id`) · `discussion_id` · `created_time` · `last_edited_time`(고친 적이 없으면 만든 때) ·
 * `created_by` · `rich_text` · `attachments`(늘 빈 배열 — 첨부가 없다) · `display_name`(`{type:'user', resolved_name}` — 개인 토큰은 그 사람으로
 * 쓴다).
 *
 * 요청 — 만들기는 `parent.page_id` · `parent.block_id` · `discussion_id` 중 **정확히 하나**와 `rich_text`(글 · 링크 · 서식 · 수식 · 사람 ·
 * 페이지 멘션 — `parseApiRichText` 가 페이지 · 블록 쓰기와 같은 규칙으로). `display_name` 은 `user` 만(통합 · 임의 이름은 400 — 사람의 토큰은
 * 그 사람으로 쓴다) · `attachments` 는 비어 있을 때만(파일 올리기 API 가 없다). 고치기는 `rich_text` 하나.
 */

import type { RichTextRun } from '../contracts/rich-text.ts'
import { parseApiRichText, toApiRichText, type ApiLinks, type ApiRichText } from './rich-text.ts'
import { encodeBoundCursor, decodeBoundCursor, parseApiId, shownValue } from './v1-protocol.ts'

/** 객체로 옮길 코멘트 하나 — 앱의 스레드 읽기(`listDiscussions`)에서 모은 것. */
export type CommentSource = {
  readonly id: string
  readonly discussionId: string
  /** 페이지 스레드(또는 가리키던 블록이 사라진 스레드)면 페이지, 아니면 그 블록. */
  readonly parent: { readonly kind: 'page' | 'block'; readonly id: string }
  readonly authorId: string
  readonly authorName: string | null
  readonly richText: readonly RichTextRun[]
  readonly createdAt: Date
  readonly editedAt: Date | null
}

export type ApiComment = {
  readonly object: 'comment'
  readonly id: string
  readonly parent: { readonly type: 'page_id'; readonly page_id: string } | { readonly type: 'block_id'; readonly block_id: string }
  readonly discussion_id: string
  readonly created_time: string
  readonly last_edited_time: string
  readonly created_by: { readonly object: 'user'; readonly id: string }
  readonly rich_text: ApiRichText[]
  readonly attachments: never[]
  readonly display_name: { readonly type: 'user'; readonly resolved_name: string }
}

/** 노션의 코멘트 객체. */
export function commentToApi(c: CommentSource, links: ApiLinks): ApiComment {
  return {
    object: 'comment',
    id: c.id,
    parent: c.parent.kind === 'page' ? { type: 'page_id', page_id: c.parent.id } : { type: 'block_id', block_id: c.parent.id },
    discussion_id: c.discussionId,
    created_time: c.createdAt.toISOString(),
    last_edited_time: (c.editedAt ?? c.createdAt).toISOString(),
    created_by: { object: 'user', id: c.authorId },
    rich_text: toApiRichText(c.richText, links),
    attachments: [],
    display_name: { type: 'user', resolved_name: c.authorName ?? '' },
  }
}

/** 노션의 코멘트 목록 봉투. */
export function commentListEnvelope(results: readonly ApiComment[], next: string | null): Record<string, unknown> {
  return { object: 'list', results, next_cursor: next, has_more: next !== null, type: 'comment', comment: {} }
}

/** 코멘트 목록의 커서 — 그 `block_id` 에 묶인다(다른 블록의 커서는 400). */
export const encodeCommentCursor = (blockId: string, offset: number): string => encodeBoundCursor(`comments:${blockId}`, offset)
export const decodeCommentCursor = (blockId: string, raw: string | null): number | null => decodeBoundCursor(`comments:${blockId}`, raw)

// ── 요청 ──────────────────────────────────────────────────────────────

export type CommentTarget =
  | { readonly kind: 'page'; readonly id: string }
  | { readonly kind: 'block'; readonly id: string }
  | { readonly kind: 'discussion'; readonly id: string }

export type CommentCreate = { readonly target: CommentTarget; readonly runs: RichTextRun[] }

export type CommentParse<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bad = <T>(clause: string): CommentParse<T> => ({ ok: false, message: `body failed validation: ${clause}` })

const CREATE_KEYS = ['parent', 'discussion_id', 'rich_text', 'attachments', 'display_name']

/** 받지 않는 키 — `markdown` 은 노션의 다음 판의 것이라 따로 말한다. */
function extraKey<T>(input: Record<string, unknown>, allowed: readonly string[]): CommentParse<T> | null {
  const extra = Object.keys(input).find((k) => !allowed.includes(k))
  if (extra === undefined) return null
  if (extra === 'markdown' || extra === 'markdown_version') {
    return bad(`body.${extra} is not supported in Notion-Version 2025-09-03. Use body.rich_text.`)
  }
  return bad(`body.${extra} should be not present, instead was ${shownValue(input[extra])}.`)
}

function parseRuns(raw: unknown): CommentParse<RichTextRun[]> {
  if (raw === undefined) return bad('body.rich_text should be defined, instead was `undefined`.')
  const parsed = parseApiRichText(raw, 'body.rich_text')
  if (!parsed.ok) return bad(parsed.message)
  if (parsed.runs.length === 0) return bad('body.rich_text should not be empty.')
  return { ok: true, value: parsed.runs }
}

/** `POST /v1/comments` 의 본문. */
export function parseCommentCreate(body: unknown): CommentParse<CommentCreate> {
  if (!isObject(body)) return bad(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = extraKey<CommentCreate>(body, CREATE_KEYS)
  if (extra !== null) return extra

  const hasParent = body.parent !== undefined && body.parent !== null
  const hasDiscussion = body.discussion_id !== undefined && body.discussion_id !== null
  if (hasParent === hasDiscussion) return bad('exactly one of body.parent or body.discussion_id should be defined.')

  let target: CommentTarget
  if (hasDiscussion) {
    const id = parseApiId(body.discussion_id)
    if (id === null) return bad(`body.discussion_id should be a valid uuid, instead was ${shownValue(body.discussion_id)}.`)
    target = { kind: 'discussion', id }
  } else {
    const parent = body.parent
    if (!isObject(parent)) return bad(`body.parent should be an object, instead was ${shownValue(parent)}.`)
    const px = Object.keys(parent).find((k) => !['type', 'page_id', 'block_id'].includes(k))
    if (px !== undefined) return bad(`body.parent.${px} should be not present, instead was ${shownValue(parent[px])}.`)
    const keys = (['page_id', 'block_id'] as const).filter((k) => parent[k] !== undefined && parent[k] !== null)
    if (keys.length !== 1) return bad('exactly one of body.parent.page_id or body.parent.block_id should be defined.')
    const key = keys[0]
    if (parent.type !== undefined && parent.type !== key) return bad(`body.parent.type should be "${key}", instead was ${shownValue(parent.type)}.`)
    const id = parseApiId(parent[key])
    if (id === null) return bad(`body.parent.${key} should be a valid uuid, instead was ${shownValue(parent[key])}.`)
    target = key === 'page_id' ? { kind: 'page', id } : { kind: 'block', id }
  }

  const attachments = body.attachments
  if (attachments !== undefined && attachments !== null) {
    if (!Array.isArray(attachments)) return bad(`body.attachments should be an array, instead was ${shownValue(attachments)}.`)
    if (attachments.length > 0) return bad('body.attachments — comment attachments are not supported (there is no file upload API).')
  }

  const display = body.display_name
  if (display !== undefined && display !== null) {
    if (!isObject(display)) return bad(`body.display_name should be an object, instead was ${shownValue(display)}.`)
    if (display.type === 'integration' || display.type === 'custom') {
      return bad(`body.display_name.type "${display.type}" is not supported — a personal token comments as its owner. Use "user".`)
    }
    if (display.type !== 'user') return bad(`body.display_name.type should be "user", instead was ${shownValue(display.type)}.`)
    const dx = Object.keys(display).find((k) => k !== 'type')
    if (dx !== undefined) return bad(`body.display_name.${dx} should be not present, instead was ${shownValue(display[dx])}.`)
  }

  const runs = parseRuns(body.rich_text)
  if (!runs.ok) return runs
  return { ok: true, value: { target, runs: runs.value } }
}

/** `PATCH /v1/comments/{id}` 의 본문 — `rich_text` 하나. */
export function parseCommentUpdate(body: unknown): CommentParse<RichTextRun[]> {
  if (!isObject(body)) return bad(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = extraKey<RichTextRun[]>(body, ['rich_text'])
  if (extra !== null) return extra
  return parseRuns(body.rich_text)
}
