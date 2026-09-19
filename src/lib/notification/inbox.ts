/**
 * 인박스 — 알림 목록 · 읽음 · 보관 (F-11-07 · 코멘트 3조각)
 *
 * 정본: 00-canonical-data-model.md §3.8 `notification`(불변식 N2 · N3) · 배달 파이프라인 ②
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한 재검사가 **조회 쿼리 안**에 있다 (파이프라인 ②)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본이 ②를 팬아웃이 아니라 배달 시점에 둔 이유: *"이벤트와 배달 사이에 권한이 회수될 수 있고, 알림 본문(멘션
 * 스니펫)이 곧 콘텐츠 유출 경로다."* 인앱 인박스에는 배달 시점이 따로 없으므로 **읽는 순간**이 그 시점이다.
 *
 * 그래서 `perm_scope_id = ANY(readableScopes)` 를 쿼리 안에 둔다 — 검색 · 사이드바와 같은 규칙(§3.3-32).
 * 밖에서 거르면 페이지네이션이 깨지고, 무엇보다 한 곳만 잊으면 유출이다. 권한이 회수되면 **이미 만들어진 알림도**
 * 목록에서 사라진다(지우지는 않는다 — 다시 받으면 다시 보인다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 병합은 조회 시점이다 (N2)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 저장은 알림 하나에 행 하나다. 같은 스레드의 알림을 접는 것은 여기서 `group_key` 로 한다 — 정본이 그렇게 못박은
 * 이유는 ① 스레드 일부만 읽음을 표현할 수 있어야 하고 ② 인기 페이지의 팬아웃이 한 행의 잠금에 줄 서지 않아야 하기
 * 때문이다. 그래서 묶음의 읽음 처리는 **묶인 행 전부**(`notificationIds`)에 건다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 보여줄 글은 지금 읽는다 (N3)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 알림도 이벤트도 사람이 쓴 글을 복제하지 않는다. 미리보기는 **지금 코멘트 행**에서 읽고, 지워졌으면 `null` 에
 * `deleted: true` 다 — 지운 글이 인박스에 남아 있으면 지운 것이 아니다(§3.3-126).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { readEvents } from './activity.ts'
import type { NotificationKind } from './fanout.ts'

/** 정본 §3.8 이 `read_at` · `archived_at` 을 따로 둔 이유 — 인박스 필터가 넷이다. */
export const INBOX_FILTERS = ['all', 'unread', 'read', 'archived'] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]

export const INBOX_PAGE_SIZE = 30

/** 미리보기 길이 — 인박스는 글을 읽는 곳이 아니다. */
export const MAX_PREVIEW = 140

export type InboxItem = {
  /** 묶음의 열쇠(N2). 같은 스레드의 알림이 한 줄로 접힌다. */
  readonly groupKey: string
  readonly kind: NotificationKind
  readonly pageId: string
  readonly pageTitle: string
  /** 이 묶음에 접힌 알림들 — 읽음 · 보관은 이 전부에 건다. */
  readonly notificationIds: readonly string[]
  readonly count: number
  readonly unreadCount: number
  readonly lastAt: Date
  /** 마지막 이벤트를 일으킨 사람. 시스템이면 null. */
  readonly actorId: string | null
  readonly discussionId: string | null
  /** 지금 글. 지워졌거나 찾을 수 없으면 null(머리말). */
  readonly preview: string | null
  readonly deleted: boolean
}

type GroupRow = {
  group_key: string
  page_id: string
  last_at: Date
  total: number
  unread: number
  kind: string
  latest_event: string | null
  ids: string[]
}

const WHERE: Record<InboxFilter, string> = {
  all: 'n.archived_at IS NULL',
  unread: 'n.archived_at IS NULL AND n.read_at IS NULL',
  read: 'n.archived_at IS NULL AND n.read_at IS NOT NULL',
  archived: 'n.archived_at IS NOT NULL',
}

export type ListInboxOptions = {
  readonly filter?: InboxFilter
  readonly limit?: number
}

/** 내 인박스. 볼 수 없게 된 페이지의 알림은 빠진다(머리말). */
export async function listInbox(ctx: SessionContext, options: ListInboxOptions = {}): Promise<InboxItem[]> {
  const filter = options.filter ?? 'all'
  const limit = Math.min(Math.max(options.limit ?? INBOX_PAGE_SIZE, 1), 100)

  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []

    const groups = await tx.query<GroupRow>(
      `SELECT n.group_key, n.page_id,
              max(n.created_at) AS last_at,
              count(*)::int AS total,
              count(*) FILTER (WHERE n.read_at IS NULL)::int AS unread,
              (array_agg(n.kind ORDER BY n.created_at DESC))[1] AS kind,
              (array_agg(n.event_ids[1] ORDER BY n.created_at DESC))[1] AS latest_event,
              array_agg(n.id) AS ids
         FROM notification n
         JOIN block b ON b.id = n.page_id AND b.lifecycle = 'live'
        WHERE n.recipient_id = $1 AND n.workspace_id = $2
          AND b.perm_scope_id = ANY($3::uuid[])
          AND ${WHERE[filter]}
        GROUP BY n.group_key, n.page_id
        ORDER BY max(n.created_at) DESC
        LIMIT $4`,
      [ctx.userId, ctx.workspaceId, scopes, limit],
    )
    if (groups.length === 0) return []

    const events = await readEvents(
      tx,
      groups.map((g) => g.latest_event).filter((id): id is string => id !== null),
    )
    const commentIds = [...events.values()]
      .map((e) => e.payload.comment_id)
      .filter((id): id is string => typeof id === 'string')
    const comments = await readComments(tx, commentIds)
    const titles = await readTitles(tx, ctx, groups.map((g) => g.page_id))

    return groups.map((g): InboxItem => {
      const event = g.latest_event === null ? undefined : events.get(g.latest_event)
      const commentId = typeof event?.payload.comment_id === 'string' ? event.payload.comment_id : null
      const comment = commentId === null ? undefined : comments.get(commentId)
      return {
        groupKey: g.group_key,
        kind: g.kind as NotificationKind,
        pageId: g.page_id,
        pageTitle: titles.get(g.page_id) ?? '',
        notificationIds: g.ids,
        count: g.total,
        unreadCount: g.unread,
        lastAt: g.last_at,
        actorId: event?.actorId ?? null,
        discussionId: typeof event?.payload.discussion_id === 'string' ? event.payload.discussion_id : null,
        preview: comment === undefined || comment.deleted ? null : comment.text.slice(0, MAX_PREVIEW),
        deleted: comment?.deleted ?? false,
      }
    })
  })
}

async function readComments(tx: Tx, ids: readonly string[]): Promise<Map<string, { text: string; deleted: boolean }>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{ id: string; rich_text: unknown; deleted_at: Date | null }>(
    `SELECT id, rich_text, deleted_at FROM comment WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  return new Map(
    rows.map((r) => [
      r.id,
      {
        text: Array.isArray(r.rich_text) ? toPlainText(r.rich_text as RichTextRun[]) : '',
        deleted: r.deleted_at !== null,
      },
    ]),
  )
}

/** 제목은 **복사해 두지 않는다** — 바뀐 제목을 보여줘야 한다(정본 §3.9 의 내비게이션 규칙과 같다). */
async function readTitles(tx: Tx, ctx: SessionContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{ id: string; properties: { title?: unknown } }>(
    `SELECT id, properties FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
    [[...new Set(ids)], ctx.workspaceId],
  )
  return new Map(rows.map((r) => [r.id, plainTitleOf(r.properties)]))
}

/** 배지에 쓰는 수 — 보관하지 않은 안 읽은 알림. 권한 필터는 목록과 같다. */
export async function unreadCount(ctx: SessionContext): Promise<number> {
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return 0
    const row = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM notification n
         JOIN block b ON b.id = n.page_id AND b.lifecycle = 'live'
        WHERE n.recipient_id = $1 AND n.workspace_id = $2
          AND b.perm_scope_id = ANY($3::uuid[])
          AND n.archived_at IS NULL AND n.read_at IS NULL`,
      [ctx.userId, ctx.workspaceId, scopes],
    )
    return row.n
  })
}

export type MarkPatch = {
  readonly read?: boolean
  readonly archived?: boolean
}

/**
 * 읽음 · 보관을 바꾼다 — **내 알림만**.
 *
 * 둘은 따로다(정본이 컬럼을 따로 둔 이유). 읽지 않고 보관할 수 있고, 보관한 것을 다시 꺼낼 수 있다.
 * 이미 그 상태면 시각을 다시 찍지 않는다 — "언제 읽었는가"가 목록을 열 때마다 밀리면 안 된다.
 *
 * @returns 실제로 바뀐 행 수.
 */
export async function markNotifications(
  ctx: SessionContext,
  ids: readonly string[],
  patch: MarkPatch,
): Promise<number> {
  if (ids.length === 0 || (patch.read === undefined && patch.archived === undefined)) return 0
  return withTransaction(async (tx) => {
    const sets: string[] = []
    const where: string[] = []
    if (patch.read !== undefined) {
      sets.push(patch.read ? 'read_at = now()' : 'read_at = NULL')
      where.push(patch.read ? 'read_at IS NULL' : 'read_at IS NOT NULL')
    }
    if (patch.archived !== undefined) {
      sets.push(patch.archived ? 'archived_at = now()' : 'archived_at = NULL')
      where.push(patch.archived ? 'archived_at IS NULL' : 'archived_at IS NOT NULL')
    }
    const rows = await tx.query<{ id: string }>(
      `UPDATE notification SET ${sets.join(', ')}
        WHERE id = ANY($1::uuid[]) AND recipient_id = $2 AND workspace_id = $3
          AND (${where.join(' OR ')})
        RETURNING id`,
      [ids, ctx.userId, ctx.workspaceId],
    )
    return rows.length
  })
}
