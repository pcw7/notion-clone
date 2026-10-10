/**
 * 페이지 활동 — Updates 패널이 읽는 것 (히스토리 · 활동 4d-3 · F-11-04)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] Updates 패널 ① ~ ⑦ · [보강] 활동 기록(무엇을 남기는가 — `activity.ts`)
 *
 * 그 페이지의 `activity_event` 를 최신순으로 30개씩 읽는다. 이 파일이 지키는 것은 **새지 않는 것**이다.
 *
 *   - 문은 페이지 화면과 같다 — 살아 있고 볼 수 있는 페이지만. 아니면 없는 페이지와 같은 답(`not_found`).
 *   - 보이는 종류는 **허용 목록**(`PAGE_ACTIVITY_TYPES`)이다. 멘션 · 접근 요청 · 리마인더는 한 사람 · 관리자의 것이라 빠진다. 새 종류는
 *     여기 넣기 전까지 보이지 않는다 — 빠지는 쪽이 새는 쪽보다 낫다.
 *   - 옮기기의 목적지는 읽는 사람이 **볼 수 있는 살아 있는 페이지**일 때만 제목을 준다(사이드바 · 휴지통과 같은 `readableScopes` 규칙).
 *   - 행위자의 이름은 지금의 이름이다(payload 에 이름이 없다). 탈퇴한 사람은 이름을 싣지 않는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { decodeCursor, encodeCursor } from '../contracts/pagination.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import type { ActivityType } from './activity.ts'

/** Updates 에 보이는 종류 — 허용 목록(정본 ②). `suggestion.*` 은 제안 편집이 생길 때 더한다. */
export const PAGE_ACTIVITY_TYPES = [
  'page.created',
  'page.moved',
  'page.trashed',
  'block.updated',
  'property.updated',
  'comment.created',
] as const satisfies readonly ActivityType[]
export type PageActivityType = (typeof PAGE_ACTIVITY_TYPES)[number]

/** 한 번에 읽는 수(정본 ③). */
export const PAGE_ACTIVITY_PAGE_SIZE = 30

export type PageActivityActor = {
  readonly id: string
  /** 지금의 이름. 탈퇴했으면 빈 글이다(`deleted`). */
  readonly name: string
  readonly deleted: boolean
}

export type PageActivityItem = {
  readonly id: string
  readonly type: PageActivityType
  readonly at: Date
  /** 일을 한 사람. 시스템이면 null. */
  readonly actor: PageActivityActor | null
  /** `page.moved` 의 새 부모 — 읽는 사람이 볼 수 있는 살아 있는 페이지일 때만(정본 ⑤). 아니면 null. */
  readonly movedTo: { readonly id: string; readonly title: string } | null
}

export type PageActivityResult =
  | { readonly ok: true; readonly items: readonly PageActivityItem[]; readonly nextCursor: string | null }
  | { readonly ok: false; readonly reason: 'not_found' | 'invalid_cursor' }

type Row = {
  id: string
  type: PageActivityType
  created_at: Date
  at_micros: string
  actor_id: string | null
  actor_name: string | null
  actor_deleted: boolean | null
  payload: Record<string, unknown>
}

/** 커서 — 마지막 항목의 시각(마이크로초 · Date 는 밀리초라 같은 밀리초의 이벤트를 건너뛴다)과 id. */
function readCursor(raw: string | null | undefined): { micros: string; id: string } | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null
  const cursor = decodeCursor(raw)
  if (cursor === null || !/^\d{1,19}$/.test(cursor.sortKey) || !isUuid(cursor.id)) return 'invalid'
  return { micros: cursor.sortKey, id: cursor.id }
}

/**
 * 페이지의 활동 — 최신순 · 커서(정본 ③). 볼 수 없거나 없는(휴지통 포함) 페이지면 `not_found`, 커서가 깨졌으면 `invalid_cursor`.
 */
export async function listPageActivity(
  ctx: SessionContext,
  pageId: string,
  options: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<PageActivityResult> {
  if (!isUuid(pageId)) return { ok: false, reason: 'not_found' }
  const cursor = readCursor(options.cursor)
  if (cursor === 'invalid') return { ok: false, reason: 'invalid_cursor' }
  const limit = Math.min(Math.max(Math.floor(options.limit ?? PAGE_ACTIVITY_PAGE_SIZE), 1), 100)

  return withReadTransaction(async (tx) => {
    // 문은 페이지 화면과 같다(`getPage`) — 살아 있는 페이지 · `view`. 아니면 없는 페이지와 같은 답이다.
    const page = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (page === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) return { ok: false, reason: 'not_found' } as const

    const rows = await tx.query<Row>(
      `SELECT e.id, e.type, e.created_at, e.payload, e.actor_id,
              (extract(epoch FROM e.created_at) * 1000000)::bigint::text AS at_micros,
              u.name AS actor_name, u.deleted_at IS NOT NULL AS actor_deleted
         FROM activity_event e
         LEFT JOIN "user" u ON u.id = e.actor_id
        WHERE e.page_id = $1 AND e.workspace_id = $2 AND e.type = ANY($3::text[])
          AND ($4::bigint IS NULL
               OR (e.created_at, e.id) < ('epoch'::timestamptz + $4::bigint * interval '1 microsecond', $5::uuid))
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $6`,
      [pageId, ctx.workspaceId, PAGE_ACTIVITY_TYPES, cursor?.micros ?? null, cursor?.id ?? null, limit + 1],
    )
    const more = rows.length > limit
    const shown = more ? rows.slice(0, limit) : rows
    const destinations = await readDestinations(tx, ctx, shown)
    const last = shown.at(-1)

    return {
      ok: true,
      items: shown.map((r): PageActivityItem => {
        const to = r.type === 'page.moved' ? r.payload.to : undefined
        return {
          id: r.id,
          type: r.type,
          at: r.created_at,
          actor:
            r.actor_id === null
              ? null
              : { id: r.actor_id, name: r.actor_deleted ? '' : (r.actor_name ?? ''), deleted: r.actor_deleted === true },
          movedTo: typeof to === 'string' ? (destinations.get(to) ?? null) : null,
        }
      }),
      nextCursor: more && last !== undefined ? encodeCursor({ sortKey: last.at_micros, id: last.id }) : null,
    } as const
  })
}

/** 옮기기의 목적지 중 읽는 사람이 볼 수 있는 살아 있는 페이지의 제목(정본 ⑤ — 사이드바 · 휴지통과 같은 규칙). */
async function readDestinations(tx: Tx, ctx: SessionContext, rows: readonly Row[]): Promise<Map<string, { id: string; title: string }>> {
  const ids = [
    ...new Set(
      rows
        .filter((r) => r.type === 'page.moved')
        .map((r) => r.payload.to)
        .filter((id): id is string => typeof id === 'string' && isUuid(id)),
    ),
  ]
  if (ids.length === 0) return new Map()
  const scopes = await readableScopes(tx, ctx)
  if (scopes.length === 0) return new Map()
  const pages = await tx.query<{ id: string; properties: { title?: unknown } }>(
    `SELECT id, properties FROM block
      WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        AND perm_scope_id = ANY($3::uuid[])`,
    [ids, ctx.workspaceId, scopes],
  )
  return new Map(pages.map((p) => [p.id, { id: p.id, title: plainTitleOf(p.properties) }]))
}
