/**
 * 행 검증 · 해제 — 검증 칸을 쓰는 **유일한** 길 (VF-1 · F-03-23 · 정본 §3.5 [보강 VF-1] ③ ④ ⑨)
 *
 * 일반 칸 쓰기(`updateCells`)는 검증 칸을 받지 않는다(`verification` 은 셀 타입 밖 — `prepareCells` 가 거부). 검증한 사람 · 시각을 남이
 * 적지 못하게 여기서 서버 시각 · 그 사람으로 적는다. 권한은 그 행의 편집(`edit_content`) — 소유자만이 아니다(소유자가 빈 행은 아무도
 * 검증하지 못하게 된다). 플랜은 **검증할 때만** 묻는다 — 해제는 낮은 플랜에서도 된다(다운그레이드에 배지가 말없이 사라지지 않고 낮추는 쪽은
 * 막지 않는다).
 *
 * 행의 마지막 편집(`block.last_edited_at`)은 올리지 않는다 — 검증은 "내용을 고친 것"이 아니고(⑦ "검증 뒤 고침" 의 비교가 늘 참이 된다).
 * 활동 기록(`property.updated`)도 남기지 않는다 — 전용 이벤트 종류가 생기는 VF-3 에서 정한다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { isLocked } from '../permissions/lock.ts'
import { entitlement } from '../billing/entitlement.ts'
import { enqueueJob } from '../jobs/scheduler.ts'
import { verificationExpireDedupeKey } from '../notification/verification-expire.ts'
import { toVerificationCell, type VerificationCell } from './verification-cell.ts'

export type VerificationFailure =
  | 'not_found'
  | 'forbidden'
  /** 그 행의 칸이 아니거나 검증 속성이 아니다. */
  | 'unknown_property'
  /** 만료가 지난 시각이거나 시각이 아니다(400). */
  | 'invalid_value'
  /** 행 페이지가 잠겼다. */
  | 'locked'
  /** 요금제가 검증을 허락하지 않는다(`database.verification`) — 해제는 무관하다. */
  | 'plan_required'

export type VerificationResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: VerificationFailure }

export function verificationFailureStatus(reason: VerificationFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
    case 'plan_required':
      return 403
    case 'locked':
      return 409
    case 'unknown_property':
    case 'invalid_value':
      return 400
  }
}

const fail = (reason: VerificationFailure): { readonly ok: false; readonly reason: VerificationFailure } => ({ ok: false, reason })

/** 행 · 속성을 문 앞에서 확인한다 — 행을 잠그고, 그 행의 편집 권한 · 잠금 · 검증 속성을 본다. 통과하면 null. */
async function gate(tx: Tx, ctx: SessionContext, rowId: string, propertyId: string): Promise<ReturnType<typeof fail> | null> {
  const row = await tx.queryMaybe<{ data_source_id: string }>(
    `SELECT p.data_source_id
       FROM page p
       JOIN block b ON b.id = p.id
      WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
      FOR UPDATE OF b`,
    [rowId, ctx.workspaceId],
  )
  if (row === null) return fail('not_found')
  const caps = await effectiveCaps(tx, ctx, rowId)
  if (!can(caps, 'view')) return fail('not_found')
  if (!can(caps, 'edit_content')) return fail('forbidden')
  if (await isLocked(tx, rowId)) return fail('locked')
  const property = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM property WHERE id = $1 AND data_source_id = $2 AND type = 'verification' AND deleted_at IS NULL`,
    [propertyId, row.data_source_id],
  )
  return property === null ? fail('unknown_property') : null
}

/** 행을 검증한다 — 다시 검증하면 덮어쓴다(검증한 사람 · 시각이 새로). `expiresAt` 이 null 이면 무기한. */
export async function verifyRow(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  expiresAt: string | null,
): Promise<VerificationResult<VerificationCell>> {
  const now = new Date()
  let until: Date | null = null
  if (expiresAt !== null) {
    until = typeof expiresAt === 'string' ? new Date(expiresAt) : new Date(Number.NaN)
    // 지난 시각은 받지 않는다(④) — 같은 시각도 이미 만료다
    if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return fail('invalid_value')
  }
  return withCommandTransaction(async (tx) => {
    const blocked = await gate(tx, ctx, rowId, propertyId)
    if (blocked !== null) return blocked
    // 플랜은 검증할 때만 묻는다(③) — 해제는 아래 `unverifyRow` 가 묻지 않는다
    if (!(await entitlement(ctx.workspaceId, 'database.verification', tx))) return fail('plan_required')

    const value = {
      type: 'verification',
      state: 'verified',
      verified_by: ctx.userId,
      verified_at: now.toISOString(),
      expires_at: until === null ? null : until.toISOString(),
    }
    await tx.query(
      `INSERT INTO page_property_value (page_id, property_id, value, filled_by, updated_at)
       VALUES ($1, $2, $3::jsonb, 'user', now())
       ON CONFLICT (page_id, property_id) DO UPDATE SET value = EXCLUDED.value, filled_by = 'user', updated_at = now()`,
      [rowId, propertyId, JSON.stringify(value)],
    )
    // 만료 알림 — 한 번짜리 잡(⑤). 다시 검증해도 옛 잡은 지우지 않는다(돌 때 본다) · 무기한이면 넣지 않는다
    if (until !== null) {
      await enqueueJob(tx, {
        kind: 'verification_expire',
        runAt: until,
        payload: { rowId, propertyId, expiresAt: value.expires_at },
        dedupeKey: verificationExpireDedupeKey(rowId, propertyId, until.toISOString()),
      })
    }
    const cell = toVerificationCell(value, now)
    return { ok: true, value: cell as VerificationCell } as const
  })
}

/** 검증을 푼다 — 칸을 지운다. 이미 비어 있어도 된다. 요금제를 묻지 않는다. */
export async function unverifyRow(ctx: SessionContext, rowId: string, propertyId: string): Promise<VerificationResult<null>> {
  return withCommandTransaction(async (tx) => {
    const blocked = await gate(tx, ctx, rowId, propertyId)
    if (blocked !== null) return blocked
    await tx.query(`DELETE FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [rowId, propertyId])
    return { ok: true, value: null } as const
  })
}
