/**
 * 검증 만료 알림 — 한 번짜리 잡 `verification_expire` (VF-3 · F-03-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 VF-1] ⑤ · §3.10 공용 스케줄러(여섯째 소비자)
 *
 * 검증할 때(`verifyRow`) run_at = `expires_at` 로 넣은 잡이 돈다. 잡은 지우지 않으므로(다시 검증해도 옛 잡이 남는다) **돌 때 본다**:
 *
 *   · 행이 살아 있다(휴지통 · purged 면 아무것도 안 한다 — 되살려도 지난 것은 알리지 않는다)
 *   · 칸이 아직 **그 `expires_at` 의 검증**이다(다시 검증 · 해제면 아무것도 안 한다)
 *   · 받는 사람 — 소유자 칸의 사람들, 비었으면 검증한 사람. 이 워크스페이스의 살아 있는 멤버만(볼 수 있는가는 인박스가 읽을 때 본다)
 *   · 한 번만 — 묶음 열쇠 `verification:{행}:{속성}:{expires_at}` 가 이미 있는 받는 사람은 건너뛴다(잡이 다시 돌아도 하나)
 *
 * 세션 없는 시스템 주체다. 활동 이벤트 `verification.expired`(id 만) · 행위자는 검증한 사람.
 */

import { randomUUID } from 'node:crypto'

import { withTransaction } from '../db/tx.ts'
import { asUserId, asWorkspaceId } from '../ids.ts'
import { recordActivity } from './activity.ts'

/** 한 검증의 만료 알림을 묶고 · 중복을 막는 열쇠. */
export const verificationExpiredGroupKey = (rowId: string, propertyId: string, expiresAt: string): string =>
  `verification:${rowId}:${propertyId}:${expiresAt}`

/** 잡의 중복 열쇠 — 행 · 속성 · expires_at. */
export const verificationExpireDedupeKey = (rowId: string, propertyId: string, expiresAt: string): string =>
  `verification_expire:${rowId}:${propertyId}:${expiresAt}`

/** 만든 알림 수를 돌려준다. */
export async function runVerificationExpire(payload: Readonly<Record<string, unknown>>, now: Date): Promise<number> {
  const { rowId, propertyId, expiresAt } = payload
  if (typeof rowId !== 'string' || typeof propertyId !== 'string' || typeof expiresAt !== 'string') return 0
  const expiresMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresMs)) return 0

  return withTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ workspace_id: string; owner_property_id: string | null; value: Record<string, unknown> }>(
      `SELECT b.workspace_id, p.config ->> 'owner_property_id' AS owner_property_id, v.value
         FROM block b
         JOIN property p ON p.id = $2 AND p.type = 'verification' AND p.deleted_at IS NULL
         JOIN page_property_value v ON v.page_id = b.id AND v.property_id = p.id
        WHERE b.id = $1 AND b.type = 'page' AND b.lifecycle = 'live'
          AND NOT EXISTS (SELECT 1 FROM workspace dw WHERE dw.id = b.workspace_id AND dw.deleted_at IS NOT NULL)`,
      [rowId, propertyId],
    )
    if (row === null) return 0
    // 아직 그 expires_at 의 검증인가 — 다시 검증했으면(다른 시각) 옛 잡은 아무것도 안 한다
    const cell = row.value
    if (cell.state !== 'verified' || typeof cell.expires_at !== 'string' || typeof cell.verified_by !== 'string') return 0
    if (new Date(cell.expires_at).getTime() !== expiresMs) return 0
    if (expiresMs > now.getTime()) return 0

    // 받는 사람 — 소유자 칸의 사람들, 비었으면 검증한 사람
    let candidates: string[] = []
    if (row.owner_property_id !== null) {
      const owners = await tx.queryMaybe<{ value: unknown }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [
        rowId,
        row.owner_property_id,
      ])
      const people = (owners?.value as { people?: unknown } | undefined)?.people
      if (Array.isArray(people)) {
        candidates = people.flatMap((p) => (typeof (p as { id?: unknown })?.id === 'string' ? [(p as { id: string }).id] : []))
      }
    }
    if (candidates.length === 0) candidates = [cell.verified_by]

    // 이 워크스페이스의 살아 있는 멤버만 · 이미 알린 사람은 뺀다
    const groupKey = verificationExpiredGroupKey(rowId, propertyId, expiresAt)
    const recipients = await tx.query<{ user_id: string }>(
      `SELECT m.user_id FROM workspace_member m
        WHERE m.workspace_id = $1 AND m.status = 'active' AND m.user_id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM notification n WHERE n.recipient_id = m.user_id AND n.group_key = $3)`,
      [row.workspace_id, candidates, groupKey],
    )
    if (recipients.length === 0) return 0

    const activity = await recordActivity(
      tx,
      { workspaceId: asWorkspaceId(row.workspace_id), userId: asUserId(cell.verified_by) },
      { pageId: rowId, type: 'verification.expired', payload: { property_id: propertyId } },
    )
    for (const r of recipients) {
      await tx.query(
        `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
         VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'verification_expired', $6, $7)`,
        [randomUUID(), r.user_id, row.workspace_id, rowId, activity.id, groupKey, now],
      )
    }
    return recipients.length
  })
}
