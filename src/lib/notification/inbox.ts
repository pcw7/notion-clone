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
 * 그래서 `perm_scope_id = ANY(readableScopes)` 를 쿼리 안에 둔다 — 검색 · 사이드바와 같은 규칙(§3.3-32). **행 단위 접근 규칙이 이 사람에게
 * 연 행도**(`ruleOpensRowSql` — 6h · 정본 §3.8 [보강] 담당 알림 ④) — 스코프에 없지만 판정은 연다. 검색 · 사이드바는 그 행을 세우지
 * 않지만(행 단위 접근 규칙 ⑤) 인박스는 받는 사람의 것이라 판정과 같은 답을 낸다 — 아니면 "담당 → 편집" 으로 행을 받은 사람이 정작 담당
 * 알림을 못 본다.
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
import { readPageIcon, type PageIcon } from '../block/page-icon.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { ruleOpensRowSql } from '../database/row-access.ts'
import { canListMembers } from '../workspace/list.ts'
import { readEvents } from './activity.ts'
import { decodeInboxCursor, encodeInboxCursor } from './inbox-cursor.ts'
import type { NotificationKind } from './fanout.ts'

/** 정본 §3.8 이 `read_at` · `archived_at` 을 따로 둔 이유 — 인박스 필터가 넷이다. */
export const INBOX_FILTERS = ['all', 'unread', 'read', 'archived'] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]

export const INBOX_PAGE_SIZE = 30

/**
 * 한 번에 줄 수 있는 줄의 상한(10n-69) — 읽음 · 보관 뒤의 다시 읽기가 지금까지 펼친 만큼을 한 번에 받는다(쪽 하나는 `INBOX_PAGE_SIZE`).
 * 그보다 많이 펼쳤으면 그 뒤는 다시 "더 보기" 로 받는다.
 */
export const INBOX_MAX_LIMIT = 300

/** 미리보기 길이 — 인박스는 글을 읽는 곳이 아니다. */
export const MAX_PREVIEW = 140

export type InboxItem = {
  /** 묶음의 열쇠(N2). 같은 스레드의 알림이 한 줄로 접힌다. */
  readonly groupKey: string
  readonly kind: NotificationKind
  readonly pageId: string
  readonly pageTitle: string
  /** 그 페이지의 아이콘(8c-2) — 목록의 페이지는 이미 권한으로 걸렀다. 없으면 null. */
  readonly pageIcon: PageIcon | null
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
  /**
   * 접근 요청(7e-1 · `access_requested`)의 **지금** 상태 — 마지막 요청의 요청한 사람 · 상태 · 종류(접근 · 편집 — 7e-2). 이름은
   * 멤버 목록을 받을 수 있는 역할일 때만(정본 §3.8 [보강] 접근 요청의 알림 ③). 다른 알림은 null.
   */
  readonly access: { readonly requesterName: string | null; readonly status: string; readonly kind: string } | null
  /**
   * 리마인더(4c-2 · `reminder`) — 울린 날짜 속성의 **지금** 이름(N3 — 복제하지 않는다). 속성이 없어졌거나 날짜 속성의 것이 아니면 이름이
   * null. 다른 알림은 null.
   */
  readonly reminder: { readonly propertyName: string | null } | null
  /**
   * 담당(6h · `person_property_assigned`) — 회원님을 넣은 사람 속성의 **지금** 이름(N3 — 복제하지 않는다). 속성이 없어졌으면 이름이
   * null 이고, 담당 알림이 아니면 항목 자체가 null 이다.
   */
  readonly assignment: { readonly propertyName: string | null } | null
}

type GroupRow = {
  group_key: string
  page_id: string
  last_at: Date
  /** 마지막 시각의 DB 글자 그대로 — 커서가 마이크로초까지 싣는다(`inbox-cursor.ts` 머리말). */
  last_at_text: string
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

/**
 * 받는 사람이 그 페이지를 볼 수 있는가 — 스코프(`$3`) 또는 행 단위 접근 규칙(`$1` 이 받는 사람 · 행이고 템플릿이 아닐 때). 목록과 배지가
 * 같은 식을 쓴다(배지가 목록에 없는 것을 세면 안 된다).
 */
const CAN_SEE = `(b.perm_scope_id = ANY($3::uuid[]) OR (p.id IS NOT NULL AND p.is_template = false AND ${ruleOpensRowSql('$1')}))`

export type ListInboxOptions = {
  readonly filter?: InboxFilter
  readonly limit?: number
  /** 지난 쪽이 준 `next`(10n-69) — 그 줄의 뒤부터. 없으면 처음부터. */
  readonly after?: string
}

export type InboxPage = {
  readonly items: InboxItem[]
  /** 다음 쪽의 커서 — 더 없으면 null(빈 쪽을 한 번 더 부르지 않게 하나를 더 읽어 본다). */
  readonly next: string | null
}

/** 내 인박스. 볼 수 없게 된 페이지의 알림은 빠진다(머리말). 첫 쪽만 — 쪽을 넘기려면 `listInboxPage`. */
export async function listInbox(ctx: SessionContext, options: ListInboxOptions = {}): Promise<InboxItem[]> {
  return (await listInboxPage(ctx, options)).items
}

/**
 * 인박스의 한 쪽(10n-69 · HANDOFF §3.2-302) — 차례는 묶음의 마지막 시각이 새 것부터, 같으면 `group_key` · `page_id` 가 큰 것부터.
 * `after` 는 지난 쪽의 마지막 줄이고 이 쪽은 그보다 뒤(작은) 줄이다 — 권한 재검사 · 필터와 같은 쿼리 안에서 자른다(밖에서 자르면
 * 쪽이 빈다). 망가진 커서는 던진다(라우트가 먼저 거른다).
 */
export async function listInboxPage(ctx: SessionContext, options: ListInboxOptions = {}): Promise<InboxPage> {
  const filter = options.filter ?? 'all'
  const limit = Math.min(Math.max(options.limit ?? INBOX_PAGE_SIZE, 1), INBOX_MAX_LIMIT)
  const after = options.after === undefined ? null : decodeInboxCursor(options.after)
  if (options.after !== undefined && after === null) throw new Error('인박스 커서의 모양이 틀렸다')

  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)

    const groups = await tx.query<GroupRow>(
      `SELECT n.group_key, n.page_id,
              max(n.created_at) AS last_at,
              max(n.created_at)::text AS last_at_text,
              count(*)::int AS total,
              count(*) FILTER (WHERE n.read_at IS NULL)::int AS unread,
              (array_agg(n.kind ORDER BY n.created_at DESC))[1] AS kind,
              (array_agg(n.event_ids[1] ORDER BY n.created_at DESC))[1] AS latest_event,
              array_agg(n.id) AS ids
         FROM notification n
         JOIN block b ON b.id = n.page_id AND b.lifecycle = 'live'
         LEFT JOIN page p ON p.id = n.page_id
        WHERE n.recipient_id = $1 AND n.workspace_id = $2
          AND ${CAN_SEE}
          AND ${WHERE[filter]}
        GROUP BY n.group_key, n.page_id
       HAVING $5::timestamptz IS NULL OR (max(n.created_at), n.group_key, n.page_id) < ($5::timestamptz, $6::text, $7::uuid)
        ORDER BY max(n.created_at) DESC, n.group_key DESC, n.page_id DESC
        LIMIT $4`,
      // 하나를 더 읽어 다음 쪽이 있는지 본다 — 남은 줄이 쪽 크기와 꼭 같을 때 빈 쪽을 부르지 않게
      [ctx.userId, ctx.workspaceId, scopes, limit + 1, after?.at ?? null, after?.groupKey ?? null, after?.pageId ?? null],
    )
    const more = groups.length > limit
    if (more) groups.length = limit
    const last = groups.at(-1)
    const next = more && last !== undefined ? encodeInboxCursor({ at: last.last_at_text, groupKey: last.group_key, pageId: last.page_id }) : null
    if (groups.length === 0) return { items: [], next: null }

    const events = await readEvents(
      tx,
      groups.map((g) => g.latest_event).filter((id): id is string => id !== null),
    )
    const commentIds = [...events.values()]
      .map((e) => e.payload.comment_id)
      .filter((id): id is string => typeof id === 'string')
    const comments = await readComments(tx, commentIds)
    // 멘션 알림은 코멘트가 아니라 본문 블록을 가리킨다 — 그 블록의 **지금** 글을 읽는다(행은 투영이라 늦거나 없을 수 있다).
    const blockIds = [...events.values()]
      .map((e) => e.payload.block_id)
      .filter((id): id is string => typeof id === 'string')
    const blocks = await readBlockTexts(tx, ctx, blockIds)
    const titles = await readTitles(tx, ctx, groups.map((g) => g.page_id))
    const propertyNames = await readPropertyNames(
      tx,
      groups
        .filter((g) => (g.kind === 'reminder' || g.kind === 'person_property_assigned') && g.latest_event !== null)
        .map((g) => events.get(g.latest_event as string)?.payload.property_id)
        .filter((id): id is string => typeof id === 'string'),
    )
    const requests = await readAccessRequests(
      tx,
      ctx,
      groups
        .filter((g) => g.kind === 'access_requested' && g.latest_event !== null)
        .map((g) => events.get(g.latest_event as string)?.payload.request_id)
        .filter((id): id is string => typeof id === 'string'),
    )

    const items = groups.map((g): InboxItem => {
      const event = g.latest_event === null ? undefined : events.get(g.latest_event)
      const commentId = typeof event?.payload.comment_id === 'string' ? event.payload.comment_id : null
      const comment = commentId === null ? undefined : comments.get(commentId)
      const blockId = typeof event?.payload.block_id === 'string' ? event.payload.block_id : null
      const blockText = commentId === null && blockId !== null ? (blocks.get(blockId) ?? null) : null
      const requestId = g.kind === 'access_requested' && typeof event?.payload.request_id === 'string' ? event.payload.request_id : null
      return {
        groupKey: g.group_key,
        kind: g.kind as NotificationKind,
        pageId: g.page_id,
        pageTitle: titles.get(g.page_id)?.title ?? '',
        pageIcon: titles.get(g.page_id)?.icon ?? null,
        notificationIds: g.ids,
        count: g.total,
        unreadCount: g.unread,
        lastAt: g.last_at,
        actorId: event?.actorId ?? null,
        discussionId: typeof event?.payload.discussion_id === 'string' ? event.payload.discussion_id : null,
        preview:
          comment !== undefined
            ? comment.deleted
              ? null
              : comment.text.slice(0, MAX_PREVIEW)
            : blockText === null
              ? null
              : blockText.slice(0, MAX_PREVIEW),
        deleted: comment?.deleted ?? false,
        access: requestId === null ? null : (requests.get(requestId) ?? null),
        reminder:
          g.kind === 'reminder'
            ? {
                propertyName:
                  typeof event?.payload.property_id === 'string' ? (propertyNames.get(event.payload.property_id) ?? null) : null,
              }
            : null,
        assignment:
          g.kind === 'person_property_assigned'
            ? {
                propertyName:
                  typeof event?.payload.property_id === 'string' ? (propertyNames.get(event.payload.property_id) ?? null) : null,
              }
            : null,
      }
    })
    return { items, next }
  })
}

/** 접근 요청의 지금 상태(N3 — 알림은 요청을 복제하지 않는다). 이름은 멤버 목록을 받을 수 있는 역할에게만. */
async function readAccessRequests(
  tx: Tx,
  ctx: SessionContext,
  ids: readonly string[],
): Promise<Map<string, { requesterName: string | null; status: string; kind: string }>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{ id: string; status: string; kind: string; name: string | null }>(
    `SELECT r.id, r.status, r.kind, u.name
       FROM access_request r
       LEFT JOIN "user" u ON u.id = r.requester_id
      WHERE r.id = ANY($1::uuid[]) AND r.workspace_id = $2`,
    [[...new Set(ids)], ctx.workspaceId],
  )
  const named = canListMembers(ctx.role)
  return new Map(rows.map((r) => [r.id, { requesterName: named ? r.name : null, status: r.status, kind: r.kind }]))
}

/** 리마인더가 울린 날짜 속성의 지금 이름 — 페이지는 이미 권한으로 걸렀고, 속성은 그 행의 표의 것이다. */
async function readPropertyNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{ id: string; name: string }>(`SELECT id, name FROM property WHERE id = ANY($1::text[]) AND deleted_at IS NULL`, [
    [...new Set(ids)],
  ])
  return new Map(rows.map((r) => [r.id, r.name]))
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

/** 멘션이 든 블록의 지금 글 — 없으면(아직 투영 전 · 지워짐) 미리보기가 없다. */
async function readBlockTexts(tx: Tx, ctx: SessionContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{ id: string; properties: { title?: unknown } }>(
    `SELECT id, properties FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
    [[...new Set(ids)], ctx.workspaceId],
  )
  return new Map(rows.map((r) => [r.id, plainTitleOf(r.properties)]))
}

/**
 * 제목 · 아이콘은 **복사해 두지 않는다** — 바뀐 것을 보여줘야 한다(정본 §3.9 의 내비게이션 규칙과 같다). 부르는 쪽(`listInbox`)이
 * 이미 권한으로 거른 페이지만 넘긴다.
 */
async function readTitles(
  tx: Tx,
  ctx: SessionContext,
  ids: readonly string[],
): Promise<Map<string, { title: string; icon: PageIcon | null }>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{ id: string; properties: { title?: unknown }; page_icon: unknown }>(
    `SELECT id, properties, format -> 'page_icon' AS page_icon FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
    [[...new Set(ids)], ctx.workspaceId],
  )
  return new Map(rows.map((r) => [r.id, { title: plainTitleOf(r.properties), icon: readPageIcon(r.page_icon) }]))
}

/** 배지에 쓰는 수 — 보관하지 않은 안 읽은 알림. 권한 필터는 목록과 같다. */
export async function unreadCount(ctx: SessionContext): Promise<number> {
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    const row = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM notification n
         JOIN block b ON b.id = n.page_id AND b.lifecycle = 'live'
         LEFT JOIN page p ON p.id = n.page_id
        WHERE n.recipient_id = $1 AND n.workspace_id = $2
          AND ${CAN_SEE}
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
