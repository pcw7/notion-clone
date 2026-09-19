/**
 * 페이지 구독 — 누가 이 페이지의 소식을 받는가 (F-11-09 · 코멘트 3조각)
 *
 * 정본: 00-canonical-data-model.md §3.8 `subscription`(불변식 N1) · 판결 X-10(결제 구독이 아니다)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 불변식 N1 — 명시적 `none` 은 암묵 구독을 덮어쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본: *"아니면 '뮤트했는데 편집하면 다시 켜지는' 버그가 생긴다."* 그래서 자동 구독은 **행이 없을 때만** 넣는다
 * (`ON CONFLICT DO NOTHING`). 사용자가 한 번 정한 값은 그 뒤의 어떤 자동 경로도 건드리지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자동 구독 둘
 * ──────────────────────────────────────────────────────────────────────
 *
 *   · **페이지를 만들면** `auto_created` · `all_comments` — 내가 만든 페이지의 코멘트는 다 받는다
 *   · **코멘트를 쓰면** `auto_edited` · `replies_and_mentions` — 내가 낀 스레드의 답글만 받는다
 *
 * 둘째를 `all_comments` 로 하면 한 번 코멘트를 단 사람이 그 페이지의 모든 대화를 받게 된다. 정본에 값이 없어 정한
 * 것이고(HANDOFF §3.3-132), 화면이 생기면 사용자가 바꿀 수 있다(`setSubscription`).
 *
 * 구독 행이 **없는** 사람은 `replies_and_mentions` 와 같다 — 직접 걸린 스레드의 답글만 받는다. 행이 없다고 아무것도
 * 못 받으면 "내 스레드에 달린 답글"을 놓친다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { withTransaction, type Tx as Transaction } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'

/** 정본 §3.8 의 `page_kind='page'` 쪽 CHECK 그대로. */
export const PAGE_LEVELS = ['all_comments', 'replies_and_mentions', 'none'] as const
export type PageSubscriptionLevel = (typeof PAGE_LEVELS)[number]

export const SUBSCRIPTION_SOURCES = ['explicit', 'auto_created', 'auto_edited'] as const
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number]

/** 구독 행이 없는 사람에게 적용되는 값(머리말). */
export const DEFAULT_LEVEL: PageSubscriptionLevel = 'replies_and_mentions'

/**
 * 자동 구독 — **행이 없을 때만** 넣는다(N1).
 *
 * 호출자의 트랜잭션 안에서 돈다. 구독을 남기지 못했다고 페이지 생성 · 코멘트 작성이 실패하면 안 되므로 여기서 던지지
 * 않는 조건만 쓴다(`ON CONFLICT DO NOTHING`).
 */
export async function autoSubscribe(
  tx: Tx,
  userId: string,
  pageId: string,
  source: Exclude<SubscriptionSource, 'explicit'>,
  level: PageSubscriptionLevel,
): Promise<void> {
  await tx.query(
    `INSERT INTO subscription (id, user_id, page_id, page_kind, level, source, created_at)
     VALUES ($1, $2, $3, 'page', $4, $5, now())
     ON CONFLICT (user_id, page_id) DO NOTHING`,
    [randomUUID(), userId, pageId, level, source],
  )
}

export type SubscriptionFailure = 'not_found' | 'invalid_level'

export type SubscriptionResult<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: SubscriptionFailure }

/**
 * 내가 이 페이지를 어떻게 따를지 정한다 — 화면의 "알림 받기" 토글.
 *
 * 볼 수 있으면 정할 수 있다(`view`). 코멘트를 쓸 수 없는 사람도 알림은 받을 수 있어야 한다 — 읽기만 하는 참여자가
 * 문서의 변화를 따라가는 것이 구독의 쓸모다.
 */
export async function setSubscription(
  ctx: SessionContext,
  pageId: string,
  level: PageSubscriptionLevel,
): Promise<SubscriptionResult<{ readonly level: PageSubscriptionLevel }>> {
  if (!PAGE_LEVELS.includes(level)) return { ok: false, reason: 'invalid_level' }
  return withTransaction(async (tx: Transaction) => {
    if (!isUuid(pageId)) return { ok: false, reason: 'not_found' } as const
    const page = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (page === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, pageId), 'view')) return { ok: false, reason: 'not_found' } as const

    await tx.query(
      `INSERT INTO subscription (id, user_id, page_id, page_kind, level, source, created_at)
       VALUES ($1, $2, $3, 'page', $4, 'explicit', now())
       ON CONFLICT (user_id, page_id) DO UPDATE SET level = EXCLUDED.level, source = 'explicit'`,
      [randomUUID(), ctx.userId, pageId, level],
    )
    return { ok: true, level } as const
  })
}

/** 내가 이 페이지를 어떻게 따르고 있는가. 행이 없으면 기본값이다. */
export async function subscriptionOf(
  ctx: SessionContext,
  pageId: string,
): Promise<{ readonly level: PageSubscriptionLevel; readonly source: SubscriptionSource | null }> {
  return withTransaction(async (tx: Transaction) => {
    const row = await tx.queryMaybe<{ level: string; source: string }>(
      `SELECT level, source FROM subscription WHERE user_id = $1 AND page_id = $2`,
      [ctx.userId, pageId],
    )
    if (row === null) return { level: DEFAULT_LEVEL, source: null }
    return { level: row.level as PageSubscriptionLevel, source: row.source as SubscriptionSource }
  })
}

/** 이 페이지의 구독 행 전부 — 팬아웃이 대상자를 고를 때 읽는다. */
export async function subscribersOf(tx: Tx, pageId: string): Promise<Map<string, PageSubscriptionLevel>> {
  const rows = await tx.query<{ user_id: string; level: string }>(
    `SELECT user_id, level FROM subscription WHERE page_id = $1`,
    [pageId],
  )
  return new Map(rows.map((r) => [r.user_id, r.level as PageSubscriptionLevel]))
}
