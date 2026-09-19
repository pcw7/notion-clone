/**
 * 팬아웃 — 활동 이벤트 하나에서 받을 사람을 고른다 (F-11-08 · 코멘트 3조각)
 *
 * 정본: 00-canonical-data-model.md §3.8 배달 파이프라인(3단 필터 · 순서 고정) · 불변식 N1~N3
 *
 * ──────────────────────────────────────────────────────────────────────
 * 3단 중 여기서 하는 것은 ① 뿐이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본의 순서: ① 대상자 산출(`subscription.level` + 직접 트리거) → ② **배달 시점** 권한 재검사 → ③ presence 로 활성
 * 뷰어 억제.
 *
 *   · **②는 인박스를 읽을 때 한다**(`inbox.ts`). 인앱 인박스에는 "배달 시점"이 따로 없다 — 사용자가 보는 순간이
 *     배달이다. 게다가 팬아웃 시점에는 받는 사람의 **세션이 없어** `effective()` 를 부를 수도 없다(불변식 A9:
 *     "effective() 의 입력은 user_id 가 아니다"). 정본 §3.8 에 그 보강을 적었다
 *   · **③은 없다** — presence(F-05-03)가 아직 없다. 순서는 지킨다: 생기면 ② 다음에 들어간다(§7)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 누가 받는가 (코멘트)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   직접 트리거 — **그 스레드에 글을 쓴 사람들**(스레드를 연 사람 + 코멘트 작성자들). 구독 행이 없어도 받는다
 *   구독      — 그 페이지를 `all_comments` 로 따르는 사람들
 *   빼는 것    — 나 자신 · `none` 으로 뮤트한 사람(N1: 명시적 none 이 이긴다)
 *
 * 둘 다인 사람은 `comment_reply` 다 — 더 직접적인 쪽을 고른다.
 *
 * 알림은 **한 사람당 한 행**이다. 같은 스레드의 알림을 하나로 접는 것은 조회 시점이고(N2 · `group_key`), 저장은
 * 개별이다 — 인기 페이지의 팬아웃이 한 행의 잠금을 두고 줄 서지 않게 한다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { recordActivity } from './activity.ts'
import { subscribersOf } from './subscription.ts'

/** 정본 §3.8 `notification.kind` 의 목록. 0020 의 CHECK 과 같다. */
export const NOTIFICATION_KINDS = [
  'mention',
  'comment',
  'comment_reply',
  'page_update',
  'invite',
  'reminder',
  'person_property_assigned',
  'suggestion',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** 한 스레드의 알림을 조회 시점에 묶는 열쇠(N2). */
export const discussionGroupKey = (discussionId: string): string => `discussion:${discussionId}`

export type CommentEvent = {
  readonly pageId: string
  readonly discussionId: string
  readonly commentId: string
  /** 스레드를 연 사람. 첫 코멘트면 글쓴이와 같다. */
  readonly threadStarterId: string
  /** 앵커가 가리키는 본문 블록(페이지 스레드면 페이지 id). */
  readonly blockId: string
}

/**
 * 코멘트 하나가 만드는 알림. 호출자의 트랜잭션 안에서 — 코멘트와 알림이 함께 커밋된다.
 *
 * @returns 만든 알림 수. 아무도 받지 않으면 0 이고, 이벤트는 그래도 남는다(활동 피드의 소스다).
 */
export async function notifyComment(tx: Tx, ctx: SessionContext, event: CommentEvent): Promise<number> {
  const activity = await recordActivity(tx, ctx, {
    pageId: event.pageId,
    blockId: event.blockId,
    type: 'comment.created',
    // id 만 담는다 — 글을 복제하면 지운 코멘트가 인박스에서 되살아난다(`activity.ts` 머리말).
    payload: { discussion_id: event.discussionId, comment_id: event.commentId },
  })

  const participants = new Set<string>([event.threadStarterId])
  for (const row of await tx.query<{ created_by: string }>(
    `SELECT DISTINCT created_by FROM comment WHERE discussion_id = $1 AND deleted_at IS NULL`,
    [event.discussionId],
  )) {
    participants.add(row.created_by)
  }

  const levels = await subscribersOf(tx, event.pageId)
  const recipients = new Map<string, NotificationKind>()
  for (const userId of participants) {
    if (levels.get(userId) === 'none') continue
    recipients.set(userId, 'comment_reply')
  }
  for (const [userId, level] of levels) {
    if (level !== 'all_comments' || recipients.has(userId)) continue
    recipients.set(userId, 'comment')
  }
  // 내가 쓴 글을 나에게 알리지 않는다.
  recipients.delete(ctx.userId)
  if (recipients.size === 0) return 0

  const groupKey = discussionGroupKey(event.discussionId)
  for (const [userId, kind] of recipients) {
    await tx.query(
      `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
       VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], $6, $7, now())`,
      [randomUUID(), userId, ctx.workspaceId, event.pageId, activity.id, kind, groupKey],
    )
  }
  return recipients.size
}
