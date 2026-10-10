/**
 * 리마인더 울리기 — 때가 된 리마인더를 알림으로 (히스토리 · 활동 4c-2 · F-11-10)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑧ · 배달 파이프라인 ② · §3.10 [보강] 공용 스케줄러(네 번째 소비자)
 *       11-history-notifications.md F-11-10 *"중복 발화 — 발화 전 `UPDATE … WHERE fired_at IS NULL` 로 조건부 선점해 at-most-once"* ·
 *       *"페이지가 휴지통행 — 발화 억제. 복원 시 이미 지난 것은 발화하지 않음"* · *"수신자 중 워크스페이스를 떠난 사람만 제외"*
 *
 * 공용 스케줄러가 1분마다 부른다(`reminder_fire` — 세션 없는 시스템 주체). 한 판에 `REMINDER_FIRE_BATCH` 개:
 *
 *   · **한 번만** — 리마인더마다 한 트랜잭션에서 `fired_at` 을 실행기의 시각으로 적어 선점한다(`… WHERE fired_at IS NULL`). 두 워커가 같은
 *     것을 집어도 하나만 이긴다. 선점한 뒤 울리지 못하면(아래) 그대로 "지남"이다 — 되살려도 지난 것은 울리지 않는다
 *   · **울리지 않는 것** — 페이지가 살아 있지 않다(휴지통 · purged) · 날짜 속성이 지워졌거나 날짜가 아니다 · 받는 사람 중 이 워크스페이스의
 *     살아 있는 멤버가 하나도 없다
 *   · **페이지를 볼 수 있는가는 인박스가 읽을 때** 본다(배달 파이프라인 ② — 울리는 시점에는 받는 사람의 세션이 없다 · A9). 멘션 · 코멘트
 *     알림과 같은 길이다(`fanout.ts` 머리말)
 *   · 활동 이벤트 `reminder.fired`(id 만 — `reminder_id` · `property_id`) · 행위자는 건 사람 · 알림 종류 `reminder` · 묶음 열쇠
 *     `reminder:{id}`
 */

import { randomUUID } from 'node:crypto'

import { withTransaction } from '../db/tx.ts'
import { asUserId, asWorkspaceId } from '../ids.ts'
import { query } from '../db/pool.ts'
import { recordActivity } from './activity.ts'

/** 한 판에 울리는 수. */
export const REMINDER_FIRE_BATCH = 200

/** 한 리마인더의 알림을 조회 시점에 묶는 열쇠. */
export const reminderGroupKey = (reminderId: string): string => `reminder:${reminderId}`

export type ReminderFireResult = {
  /** 알림을 만든 리마인더 수. */
  readonly fired: number
  /** 선점했지만 울리지 않은 수 — 페이지 · 속성이 살아 있지 않거나 받을 멤버가 없다("지남"으로 남는다). */
  readonly suppressed: number
  /** 만든 알림 수(받는 사람마다 하나). */
  readonly notifications: number
  /** 한 판이 꽉 찼다 — 더 남았을 수 있다. */
  readonly more: boolean
}

type Claimed = {
  id: string
  workspace_id: string
  page_id: string
  block_id: string
  property_id: string | null
  recipient_ids: string[]
  created_by: string
}

/**
 * @param options.batch 한 판에 울리는 수
 * @param options.workspaces 이 워크스페이스들만 — 검사가 다른 검사의 리마인더를 울리지 않게(워커는 주지 않는다)
 */
export async function runReminderFire(
  now: Date,
  options: { readonly batch?: number; readonly workspaces?: readonly string[] } = {},
): Promise<ReminderFireResult> {
  const batch = options.batch ?? REMINDER_FIRE_BATCH
  const due = await query<{ id: string }>(
    `SELECT id FROM reminder
      WHERE fired_at IS NULL AND fire_at <= $1
        AND ($3::uuid[] IS NULL OR workspace_id = ANY($3::uuid[]))
      ORDER BY fire_at, id
      LIMIT $2`,
    [now, batch, options.workspaces ?? null],
  )

  let fired = 0
  let suppressed = 0
  let notifications = 0
  for (const { id } of due) {
    const outcome = await withTransaction(async (tx): Promise<'lost' | 'suppressed' | number> => {
      // 선점 — 이긴 쪽만 울린다(머리말 "한 번만")
      const claimed = await tx.queryMaybe<Claimed>(
        `UPDATE reminder SET fired_at = $2
          WHERE id = $1 AND fired_at IS NULL AND fire_at <= $2
          RETURNING id, workspace_id, page_id, block_id, property_id, recipient_ids, created_by`,
        [id, now],
      )
      if (claimed === null) return 'lost'

      // 페이지가 살아 있고 · (날짜 속성이면) 그 속성이 살아 있는 날짜 속성이어야 울린다
      const alive = await tx.queryMaybe<{ ok: boolean }>(
        `SELECT true AS ok FROM block b
          WHERE b.id = $1 AND b.lifecycle = 'live'
            AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM property p WHERE p.id = $2 AND p.deleted_at IS NULL AND p.type = 'date'))`,
        [claimed.page_id, claimed.property_id],
      )
      if (alive === null) return 'suppressed'

      // 받는 사람 — 이 워크스페이스의 살아 있는 멤버만(떠난 사람은 뺀다)
      const members = await tx.query<{ user_id: string }>(
        `SELECT user_id FROM workspace_member WHERE workspace_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`,
        [claimed.workspace_id, claimed.recipient_ids],
      )
      if (members.length === 0) return 'suppressed'

      const activity = await recordActivity(
        tx,
        { workspaceId: asWorkspaceId(claimed.workspace_id), userId: asUserId(claimed.created_by) },
        {
          pageId: claimed.page_id,
          blockId: claimed.block_id,
          type: 'reminder.fired',
          payload: { reminder_id: claimed.id, ...(claimed.property_id === null ? {} : { property_id: claimed.property_id }) },
        },
      )
      for (const m of members) {
        await tx.query(
          `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
           VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'reminder', $6, $7)`,
          [randomUUID(), m.user_id, claimed.workspace_id, claimed.page_id, activity.id, reminderGroupKey(claimed.id), now],
        )
      }
      return members.length
    })
    if (outcome === 'lost') continue
    if (outcome === 'suppressed') {
      suppressed += 1
      continue
    }
    fired += 1
    notifications += outcome
  }
  return { fired, suppressed, notifications, more: due.length === batch }
}
