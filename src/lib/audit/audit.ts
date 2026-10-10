/**
 * 감사 로그 — 쌓기 · 읽기 (게시 · 공유 6d-1 · F-11-12)
 *
 * 정본: 00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ①~⑤ · 마이그레이션 0087
 *       11-history-notifications.md F-11-12 *"페이지 본문/코멘트 원문을 절대 metadata 에 넣지 않는다"* · *"actor 계정 삭제 → 이벤트는 유지"*
 *
 * **명령과 같은 트랜잭션에서 쌓는다**(`recordAuditIn` — 정본 ②). 명령이 되돌려지면 기록도 없다 — 거부된 명령은 기록되지 않는다.
 * 행위자의 이름 · 메일은 그때의 것을 함께 적는다(사람이 지워지거나 이름을 바꿔도 그때 누구였는지 남는다). IP 는 그 세션이 열린
 * 곳이다(위임 컨텍스트 — DB automation — 는 세션이 없어 비운다).
 *
 * 내용은 싣지 않는다 — 페이지는 id 로만, 설정은 키와 값으로.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'

import { AUDIT_EVENT_TYPES, type AuditEventType, type AuditRow } from './audit-types.ts'

export { AUDIT_EVENT_TYPES, type AuditEventType, type AuditRow } from './audit-types.ts'

/** 보관 기간 — 0087 의 트리거가 이보다 오래된 행만 지우게 둔다. */
export const AUDIT_RETENTION_DAYS = 365

export type AuditTarget = { readonly type: 'page' | 'user' | 'invite' | 'setting' | 'workspace'; readonly id: string }

export type AuditEvent = {
  readonly type: AuditEventType
  /** 계정 범위면 null(로그인 · 계정 보안). */
  readonly workspaceId: string | null
  readonly actorUserId: string | null
  /** IP 를 읽을 세션 — 없으면 비운다. */
  readonly sessionId?: string | null
  readonly target?: AuditTarget
  /** 무엇이 어떻게 — 내용(제목 · 본문 · 코멘트)은 싣지 않는다. */
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly setting?: { readonly key: string; readonly before: unknown; readonly after: unknown }
}

/** 감사 한 줄을 쌓는다 — 부르는 명령의 트랜잭션 안에서. */
export async function recordAuditIn(tx: Tx, event: AuditEvent): Promise<void> {
  const actor =
    event.actorUserId === null
      ? null
      : await tx.queryMaybe<{ name: string | null; email: string | null }>(
          `SELECT u.name, e.email FROM "user" u
             LEFT JOIN user_email e ON e.user_id = u.id AND e.is_primary
            WHERE u.id = $1`,
          [event.actorUserId],
        )
  const ip =
    event.sessionId == null
      ? null
      : ((await tx.queryMaybe<{ ip: string | null }>(`SELECT host(ip) AS ip FROM user_session WHERE id = $1`, [event.sessionId]))?.ip ?? null)
  await tx.query(
    `INSERT INTO audit_event (id, scope, workspace_id, event_type, actor_user_id, actor_name, actor_email, target_type, target_id, ip,
                              metadata, setting_key, value_before, value_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::inet, $11::jsonb, $12, $13::jsonb, $14::jsonb)`,
    [
      randomUUID(),
      event.workspaceId === null ? 'account' : 'workspace',
      event.workspaceId,
      event.type,
      event.actorUserId,
      actor?.name ?? null,
      actor?.email ?? null,
      event.target?.type ?? null,
      event.target?.id ?? null,
      ip,
      JSON.stringify(event.metadata ?? {}),
      event.setting?.key ?? null,
      event.setting === undefined ? null : JSON.stringify(event.setting.before ?? null),
      event.setting === undefined ? null : JSON.stringify(event.setting.after ?? null),
    ],
  )
}

/** 세션으로 한 워크스페이스 범위의 일 — 행위자 · IP 는 그 세션의 것(위임이면 IP 없음). */
export function recordForContextIn(
  tx: Tx,
  ctx: SessionContext,
  type: AuditEventType,
  extra: Pick<AuditEvent, 'target' | 'metadata' | 'setting'> = {},
): Promise<void> {
  return recordAuditIn(tx, {
    type,
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    sessionId: ctx.delegation === undefined ? ctx.sessionId : null,
    ...extra,
  })
}

// ── 읽기 ──────────────────────────────────────────────────────────────

export type AuditReadFailure =
  /** owner 가 아니다(위임 컨텍스트도). */
  | 'forbidden'
  /** 이 워크스페이스의 요금제가 감사 로그를 읽게 하지 않는다(`audit.log` — Enterprise 만 · 6d-2). 쌓는 것은 그대로다. */
  | 'plan_required'

/** 한 번에 읽는 상한 — 화면 한 쪽. CSV 는 따로(`AUDIT_CSV_MAX`). */
export const AUDIT_PAGE_MAX = 500
/** CSV 한 번에 담는 상한 — 365일치가 이보다 많으면 거르기 · 기간으로 나눈다(화면이 말한다). */
export const AUDIT_CSV_MAX = 10_000

/** 감사 로그를 볼 수 있는 역할인가 — 설정의 절이 설지 정한다(요금제는 패널이 따로 말한다). 판정은 `listWorkspaceAudit` 가 다시 한다. */
export function canReadAudit(ctx: SessionContext): boolean {
  return ctx.role === 'owner' && ctx.delegation === undefined
}

/**
 * 워크스페이스의 감사 로그 — **owner 만**(정본 ⑤ · 11 *"Enterprise 조직/워크스페이스 소유자 외 접근 시 403"*) · **Enterprise 만**(6d-2 ·
 * `audit.log`). 최근 것부터 `limit` 개 · `before`(그 시각보다 앞)로 넘긴다 · 종류로 거를 수 있다.
 */
export async function listWorkspaceAudit(
  ctx: SessionContext,
  options: { readonly limit?: number; readonly before?: string; readonly type?: string } = {},
  max = AUDIT_PAGE_MAX,
): Promise<{ readonly ok: true; readonly value: readonly AuditRow[] } | { readonly ok: false; readonly reason: AuditReadFailure }> {
  if (!canReadAudit(ctx)) return { ok: false, reason: 'forbidden' }
  if (!(await entitlement(ctx.workspaceId, 'audit.log'))) return { ok: false, reason: 'plan_required' }
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), max)
  const before = options.before !== undefined && !Number.isNaN(Date.parse(options.before)) ? new Date(options.before) : null
  const type = options.type !== undefined && (AUDIT_EVENT_TYPES as readonly string[]).includes(options.type) ? options.type : null
  const rows = await withReadTransaction((tx) =>
    tx.query<{
      id: string
      event_type: AuditEventType
      occurred_at: Date
      actor_user_id: string | null
      actor_name: string | null
      actor_email: string | null
      target_type: string | null
      target_id: string | null
      ip: string | null
      metadata: Record<string, unknown>
      setting_key: string | null
      value_before: unknown
      value_after: unknown
    }>(
      `SELECT id, event_type, occurred_at, actor_user_id, actor_name, actor_email, target_type, target_id, host(ip) AS ip, metadata,
              setting_key, value_before, value_after
         FROM audit_event
        WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR occurred_at < $2) AND ($3::text IS NULL OR event_type = $3)
        ORDER BY occurred_at DESC, id DESC
        LIMIT $4`,
      [ctx.workspaceId, before, type, limit],
    ),
  )
  return {
    ok: true,
    value: rows.map((r) => ({
      id: r.id,
      type: r.event_type,
      occurredAt: r.occurred_at.toISOString(),
      actor: { userId: r.actor_user_id, name: r.actor_name, email: r.actor_email },
      target: r.target_type === null || r.target_id === null ? null : { type: r.target_type, id: r.target_id },
      ip: r.ip,
      metadata: r.metadata,
      setting: r.setting_key === null ? null : { key: r.setting_key, before: r.value_before, after: r.value_after },
    })),
  }
}
