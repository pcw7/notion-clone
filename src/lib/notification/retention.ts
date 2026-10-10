/**
 * 알림 · 활동 데이터 수명 — 쌓이기만 하는 표를 정리한다 (히스토리 · 활동 4d-1 · F-11-18)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 알림 · 활동 데이터 수명 ① ~ ⑤ · 마이그레이션 0074
 *       11-history-notifications.md F-11-18 *"정책 없이 3개월 운영하면 가장 큰 테이블 3개가 전부 이 도메인에서 나온다"*
 *
 * 공용 스케줄러가 부른다(`data_retention` — 세션 없는 시스템 주체). 한 판에 종류마다 `RETENTION_BATCH` 행:
 *
 *   ① 읽었거나 보관한 알림 — 그 뒤(늦은 쪽) `PROCESSED_NOTIFICATION_DAYS` 일이 지나면 지운다
 *   ② 안 읽은 알림 — **지우지 않는다**(사라지면 데이터 손실로 보인다). 단 사람마다(워크스페이스마다) `UNREAD_NOTIFICATION_CAP` 개를 넘으면
 *      오래된 것부터 지운다
 *   ③ 활동 이벤트 — `ACTIVITY_DAYS` 일이 지나면 지운다. 단 **남은 알림이 가리키는 이벤트는 남긴다**(인박스가 그 payload 를 읽는다 · N3).
 *      알림을 먼저 지우고(①②) 이벤트를 나중에 — 남은 알림 전체의 `event_ids` 로 본다(시각의 짝에 기대지 않는다)
 *   ④ 최근 방문 — 사람마다(워크스페이스마다) 최근 `RECENT_VISIT_CAP` 개만 남긴다
 *   ⑤ 파티션 — 활동 이벤트의 올해 · 다음 해 파티션을 미리 만든다(`ensure_activity_partition` — 마이그레이션의 함수 · 앱은 DDL 을 쓰지 않는다)
 *
 * 감사 기록(`audit_event`)은 지우지 않는다(F-11-12). 기간은 코드 상수다 — 관리자 화면은 없다(노션에도 없다).
 */

import { query } from '../db/pool.ts'

/** 읽었거나 보관한 알림을 남기는 날(그 뒤). */
export const PROCESSED_NOTIFICATION_DAYS = 180
/** 사람마다(워크스페이스마다) 남기는 안 읽은 알림의 수 — 넘으면 오래된 것부터. */
export const UNREAD_NOTIFICATION_CAP = 1000
/** 활동 이벤트를 남기는 날 — 남은 알림이 가리키는 것은 더 남는다. */
export const ACTIVITY_DAYS = 90
/** 사람마다(워크스페이스마다) 남기는 최근 방문의 수. */
export const RECENT_VISIT_CAP = 200
/** 한 판에 종류마다 지우는 수 — 꽉 차면 스케줄러가 곧 다시 부른다. */
export const RETENTION_BATCH = 5000

const DAY = 86_400_000

/** 미리 만들 활동 이벤트 파티션의 해 — 올해 · 다음 해(UTC · 0020 의 경계와 같다). */
export const partitionYears = (now: Date): readonly number[] => [now.getUTCFullYear(), now.getUTCFullYear() + 1]

export type RetentionResult = {
  readonly processedNotifications: number
  readonly unreadOverCap: number
  readonly events: number
  readonly visits: number
  /** 그 해마다 파티션이 어떻게 됐나 — `created` · `exists` · `blocked`. */
  readonly partitions: Readonly<Record<number, string>>
  /** 한 종류라도 한 판이 꽉 찼다 — 더 남았을 수 있다. */
  readonly more: boolean
}

/**
 * @param options.workspaces 이 워크스페이스들만 — 검사가 다른 검사의 데이터를 지우지 않게(워커는 주지 않는다)
 * @param options.unreadCap · visitCap 상한을 바꿔 끼운다 — 검사가 1,000개를 만들지 않게(워커는 주지 않는다)
 * @param options.partitions 거짓이면 파티션을 건드리지 않는다 — **DB 검사는 늘 끈다**: 파티션을 만드는 DDL 이 활동 이벤트의 부모 표를 잠가
 *   병렬로 도는 다른 검사와 교착한다(함수는 혼자 도는 verify-schema 의 프로브가 롤백 트랜잭션 안에서 본다)
 */
export async function runDataRetention(
  now: Date,
  options: {
    readonly batch?: number
    readonly workspaces?: readonly string[]
    readonly unreadCap?: number
    readonly visitCap?: number
    readonly partitions?: boolean
  } = {},
): Promise<RetentionResult> {
  const batch = options.batch ?? RETENTION_BATCH
  const ws = options.workspaces ?? null

  // ① 읽었거나 보관한 알림
  const processed = await query<{ id: string }>(
    `DELETE FROM notification WHERE id IN (
       SELECT id FROM notification
        WHERE (read_at IS NOT NULL OR archived_at IS NOT NULL) AND GREATEST(read_at, archived_at) < $1
          AND ($3::uuid[] IS NULL OR workspace_id = ANY($3::uuid[]))
        LIMIT $2)
     RETURNING id`,
    [new Date(now.getTime() - PROCESSED_NOTIFICATION_DAYS * DAY), batch, ws],
  )

  // ② 넘친 안 읽은 알림 — 넘친 사람만 골라 그 안에서 오래된 것부터
  const unreadCap = options.unreadCap ?? UNREAD_NOTIFICATION_CAP
  const overCap = await query<{ id: string }>(
    `DELETE FROM notification WHERE id IN (
       SELECT id FROM (
         SELECT n.id, row_number() OVER (PARTITION BY n.recipient_id, n.workspace_id ORDER BY n.created_at DESC, n.id DESC) AS rank
           FROM notification n
           JOIN (SELECT recipient_id, workspace_id FROM notification
                  WHERE read_at IS NULL AND archived_at IS NULL AND ($3::uuid[] IS NULL OR workspace_id = ANY($3::uuid[]))
                  GROUP BY recipient_id, workspace_id HAVING count(*) > $1) heavy
             ON heavy.recipient_id = n.recipient_id AND heavy.workspace_id = n.workspace_id
          WHERE n.read_at IS NULL AND n.archived_at IS NULL
       ) ranked
        WHERE rank > $1
        LIMIT $2)
     RETURNING id`,
    [unreadCap, batch, ws],
  )

  // ③ 활동 이벤트 — 남은 알림이 가리키는 것은 남긴다(알림을 먼저 지운 뒤라 남은 것만 본다)
  const events = await query<{ id: string }>(
    `DELETE FROM activity_event a USING (
       SELECT e.id, e.created_at FROM activity_event e
        WHERE e.created_at < $1
          AND ($3::uuid[] IS NULL OR e.workspace_id = ANY($3::uuid[]))
          AND e.id NOT IN (SELECT ref FROM notification n, unnest(n.event_ids) AS ref WHERE ref IS NOT NULL)
        LIMIT $2) old
     WHERE a.id = old.id AND a.created_at = old.created_at
     RETURNING a.id`,
    [new Date(now.getTime() - ACTIVITY_DAYS * DAY), batch, ws],
  )

  // ④ 넘친 최근 방문
  const visitCap = options.visitCap ?? RECENT_VISIT_CAP
  const visits = await query<{ block_id: string }>(
    `DELETE FROM recent_visit r USING (
       SELECT user_id, block_id FROM (
         SELECT v.user_id, v.block_id, row_number() OVER (PARTITION BY v.user_id, v.workspace_id ORDER BY v.last_visited_at DESC, v.block_id) AS rank
           FROM recent_visit v
           JOIN (SELECT user_id, workspace_id FROM recent_visit
                  WHERE $3::uuid[] IS NULL OR workspace_id = ANY($3::uuid[])
                  GROUP BY user_id, workspace_id HAVING count(*) > $1) heavy
             ON heavy.user_id = v.user_id AND heavy.workspace_id = v.workspace_id
       ) ranked
        WHERE rank > $1
        LIMIT $2) extra
     WHERE r.user_id = extra.user_id AND r.block_id = extra.block_id
     RETURNING r.block_id`,
    [visitCap, batch, ws],
  )

  // ⑤ 파티션 — 올해 · 다음 해(UTC). 검사는 끈다(위 `options.partitions`)
  const partitions: Record<number, string> = {}
  if (options.partitions !== false) {
    for (const y of partitionYears(now)) {
      partitions[y] = (await query<{ state: string }>(`SELECT ensure_activity_partition($1) AS state`, [y]))[0]?.state ?? 'unknown'
    }
  }

  const counts = [processed.length, overCap.length, events.length, visits.length]
  return {
    processedNotifications: processed.length,
    unreadOverCap: overCap.length,
    events: events.length,
    visits: visits.length,
    partitions,
    more: counts.some((n) => n === batch),
  }
}
