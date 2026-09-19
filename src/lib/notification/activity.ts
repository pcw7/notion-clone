/**
 * 활동 이벤트 — 알림 · 피드 · 웹훅의 **단일 소스** (C-13 · 코멘트 3조각)
 *
 * 정본: 00-canonical-data-model.md §3.8 `activity_event`
 *
 * 무슨 일이 있었는지는 여기 한 번만 적고, 그것을 **누구에게 알리는가**는 알림이 `event_ids[]` 로 가리킨다(불변식 N3).
 * 한 이벤트가 수신자 N명에게 복제되지 않아야 알림을 지워도 활동 피드가 남는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * payload 에 사람이 쓴 글을 복제하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 코멘트를 지우면 내용을 행에서도 비운다(불변식 D3 · HANDOFF §3.3-126). payload 에 본문 사본을 넣으면 **인박스가 지운
 * 글을 되살린다** — 지우는 쪽이 여기까지 기억해야 하는 설계가 되고, 한 곳만 잊으면 유출이다.
 *
 * 그래서 payload 는 **가리키는 id 만** 담는다. 보여줄 글은 읽는 쪽이 지금 상태에서 읽는다(`inbox.ts`).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'

/** 정본 §3.8 의 목록 그대로. 0020 의 CHECK 과 같아야 한다 — 늘리려면 마이그레이션이 함께 온다. */
export const ACTIVITY_TYPES = [
  'block.updated',
  'property.updated',
  'comment.created',
  'user.mentioned',
  'page.created',
  'page.moved',
  'page.trashed',
  'suggestion.created',
  'suggestion.accepted',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export type ActivityInput = {
  readonly pageId: string
  /** 본문 블록. 행이 아직 없거나 이미 지워졌을 수 있다 — FK 를 걸지 않는 이유다(0020 머리말). */
  readonly blockId?: string | null
  readonly type: ActivityType
  /** **id 만 담는다**(머리말). 사람이 쓴 글을 넣지 마라. */
  readonly payload?: Readonly<Record<string, string>>
}

export type ActivityEvent = {
  readonly id: string
  readonly createdAt: Date
}

/** 이벤트를 남긴다. 호출자의 트랜잭션 안에서 — 일어난 일과 그 기록이 함께 커밋돼야 한다. */
export async function recordActivity(tx: Tx, ctx: SessionContext, input: ActivityInput): Promise<ActivityEvent> {
  const row = await tx.queryOne<{ id: string; created_at: Date }>(
    `INSERT INTO activity_event (id, workspace_id, page_id, block_id, actor_id, type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
     RETURNING id, created_at`,
    [
      randomUUID(),
      ctx.workspaceId,
      input.pageId,
      input.blockId ?? null,
      ctx.userId,
      input.type,
      JSON.stringify(input.payload ?? {}),
    ],
  )
  return { id: row.id, createdAt: row.created_at }
}

export type StoredEvent = {
  readonly id: string
  readonly actorId: string | null
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly createdAt: Date
}

/**
 * id 로 이벤트를 읽는다 — 인박스가 보여줄 것을 찾을 때.
 *
 * `created_at` 없이 id 로만 찾으므로 파티션을 전부 본다. 지금은 셋뿐이고(연 2개 + DEFAULT) 인박스 한 쪽이 묻는 id 도
 * 수십 개다. 파티션이 늘면 알림이 이벤트 시각을 함께 들고 다니게 바꾼다(§7).
 */
export async function readEvents(tx: Tx, ids: readonly string[]): Promise<Map<string, StoredEvent>> {
  if (ids.length === 0) return new Map()
  const rows = await tx.query<{
    id: string
    actor_id: string | null
    type: string
    payload: Record<string, unknown>
    created_at: Date
  }>(
    `SELECT id, actor_id, type, payload, created_at FROM activity_event WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  return new Map(
    rows.map((r) => [r.id, { id: r.id, actorId: r.actor_id, type: r.type, payload: r.payload, createdAt: r.created_at }]),
  )
}
