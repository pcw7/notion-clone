/**
 * 행 단위 접근 규칙 — 게시 · 공유 6f-2a조각 (F-06-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 `page_access_rule`(C-7 — data source 단위) · §3.3 끝 [보강] 행 단위 접근 규칙 ①~⑧
 *       06-permissions-sharing.md F-06-10 *"DB 전체는 Can create + Created by → Can edit 규칙 → 자기가 만든 것만 보고 편집"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 파일은 규칙을 **두고 지우기만** 한다 — 판정은 `effective.ts` 의 `accessRuleEntries`
 * ──────────────────────────────────────────────────────────────────────
 *
 * 규칙의 부여는 그 행 노드의 ACL 행으로 합성돼 판정에 섞인다(①). 그래서 여기에는 판정 코드가 없다 — 규칙 한 줄을 쓰고, 감사 로그를
 * 남기고, 권한 신호는 0089 의 트리거가 보낸다(규칙의 칸이 바뀔 때는 0091).
 *
 * 누가 — 데이터베이스의 `manage_perm`(공유의 일이다 · ④). 못 보면 not_found, 보지만 관리하지 못하면 forbidden. 목록은 보는 사람
 * 누구나(공유 패널이 보는 사람에게도 상태를 그린다 — `listAccess` 와 같다).
 *
 * 원천 — "만든 사람"(`created_by` — data source 마다 하나)과 사람 속성(`person_property` — 속성마다 하나 · 6g-3a · ③). 사람 속성의
 * 원천은 **그 data source 의 살아 있는 사람 속성**이다 — 다른 표의 속성 · 지운 속성 · 사람이 아닌 속성은 `invalid_property`. 만든 사람
 * 규칙에 속성을 주는 것도 `invalid_property` 다(키가 둘이 되면 같은 규칙이 둘이다). 모르는 원천은 `unsupported_source`.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { recordForContextIn } from '../audit/audit.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from './effective.ts'
import { can, isGrantableLevel } from './levels.ts'

export type AccessRuleSource = 'created_by' | 'person_property'

/** 규칙 하나 — data source 마다 원천마다 하나(0089 의 UNIQUE). 레벨은 페이지 레벨 넷(대상은 행 — 페이지다). */
export type AccessRule = {
  readonly id: string
  readonly dataSourceId: string
  readonly source: AccessRuleSource
  readonly propertyId: string | null
  readonly level: string
}

export type AccessRuleFailure = 'not_found' | 'forbidden' | 'invalid_level' | 'unsupported_source' | 'invalid_property'

export type AccessRuleResult<T = void> =
  | ({ readonly ok: true } & (T extends void ? object : { readonly value: T }))
  | { readonly ok: false; readonly reason: AccessRuleFailure }

type RuleRow = { id: string; data_source_id: string; source_kind: AccessRuleSource; source_property_id: string | null; level: string }

const toRule = (r: RuleRow): AccessRule => ({
  id: r.id,
  dataSourceId: r.data_source_id,
  source: r.source_kind,
  propertyId: r.source_property_id,
  level: r.level,
})

/** 이 워크스페이스의 살아 있는 데이터베이스이고, 부르는 사람이 `need` 를 가졌는가. */
async function gateDatabase(tx: Tx, ctx: SessionContext, databaseId: string, need: 'view' | 'manage_perm'): Promise<AccessRuleFailure | null> {
  // 모양이 틀린 id 를 DB 까지 보내면 uuid 캐스팅이 500 을 낸다 — 없는 것과 같다
  if (!isUuid(databaseId)) return 'not_found'
  const db = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'database' AND lifecycle = 'live'`,
    [databaseId, ctx.workspaceId],
  )
  if (db === null) return 'not_found'
  const caps = await effectiveCaps(tx, ctx, databaseId)
  if (!can(caps, 'view')) return 'not_found'
  if (!can(caps, need)) return 'forbidden'
  return null
}

/** 그 데이터베이스의 살아 있는 data source 인가 — 다른 표의 것 · 휴지통의 것은 없는 것과 같다. */
async function ownsDataSource(tx: Tx, databaseId: string, dataSourceId: string): Promise<boolean> {
  if (!isUuid(dataSourceId)) return false
  const row = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM data_source WHERE id = $1 AND owner_database_id = $2 AND lifecycle = 'live'`,
    [dataSourceId, databaseId],
  )
  return row !== null
}

/** 규칙의 원천 — 원천의 이름과 속성이 맞는 짝인가. 사람 속성이면 그 data source 의 살아 있는 사람 속성이어야 한다(`live`). */
type RuleKey = { readonly source: AccessRuleSource; readonly propertyId: string | null }

async function ruleKeyOf(
  tx: Tx,
  dataSourceId: string,
  source: string,
  propertyId: string | null | undefined,
  live: boolean,
): Promise<RuleKey | AccessRuleFailure> {
  if (source === 'created_by') return propertyId == null ? { source, propertyId: null } : 'invalid_property'
  if (source !== 'person_property') return 'unsupported_source'
  if (typeof propertyId !== 'string' || propertyId === '') return 'invalid_property'
  // 지울 때는 속성이 이미 휴지통에 있어도 된다 — 규칙은 남아 있다(③)
  if (!live) return { source, propertyId }
  const prop = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM property WHERE id = $1 AND data_source_id = $2 AND type = 'people' AND deleted_at IS NULL`,
    [propertyId, dataSourceId],
  )
  return prop === null ? 'invalid_property' : { source, propertyId }
}

/** 감사 로그의 원천 속성 — 만든 사람 규칙은 속성이 없다(6f-2a 의 모양 그대로). */
const propertyMeta = (key: RuleKey) => (key.propertyId === null ? {} : { propertyId: key.propertyId })

/** 이 데이터베이스의 규칙 — data source 순 · 원천 순. 보는 사람 누구나. */
export async function listAccessRules(ctx: SessionContext, databaseId: string): Promise<AccessRuleResult<AccessRule[]>> {
  return withTransaction(async (tx) => {
    const denied = await gateDatabase(tx, ctx, databaseId, 'view')
    if (denied !== null) return { ok: false, reason: denied } as const
    const rows = await tx.query<RuleRow>(
      `SELECT r.id, r.data_source_id, r.source_kind, r.source_property_id, r.level
         FROM page_access_rule r
         JOIN data_source d ON d.id = r.data_source_id
        WHERE d.owner_database_id = $1 AND d.lifecycle = 'live'
        ORDER BY d.id, r.source_kind, r.source_property_id NULLS FIRST`,
      [databaseId],
    )
    return { ok: true, value: rows.map(toRule) } as const
  })
}

export type SetAccessRuleInput = {
  readonly dataSourceId: string
  readonly source: string
  /** 사람 속성 규칙의 원천 속성. 만든 사람 규칙이면 없다. */
  readonly propertyId?: string | null
  readonly level: string
}

/**
 * 규칙을 둔다 — 이미 있으면 레벨만 바꾼다(원천마다 하나 — 사람 속성은 속성마다). 바뀌었을 때만 감사 로그를 남긴다(같은 레벨이면 아무것도
 * 쓰지 않는다).
 */
export async function setAccessRule(
  ctx: SessionContext,
  databaseId: string,
  input: SetAccessRuleInput,
): Promise<AccessRuleResult<AccessRule>> {
  return withTransaction(async (tx) => {
    const denied = await gateDatabase(tx, ctx, databaseId, 'manage_perm')
    if (denied !== null) return { ok: false, reason: denied } as const
    if (!(await ownsDataSource(tx, databaseId, input.dataSourceId))) return { ok: false, reason: 'not_found' } as const
    const key = await ruleKeyOf(tx, input.dataSourceId, input.source, input.propertyId, true)
    if (typeof key === 'string') return { ok: false, reason: key } as const
    if (!isGrantableLevel('page', input.level)) return { ok: false, reason: 'invalid_level' } as const

    const before = await tx.queryMaybe<RuleRow>(
      `SELECT id, data_source_id, source_kind, source_property_id, level FROM page_access_rule
        WHERE data_source_id = $1 AND source_kind = $2 AND source_property_id IS NOT DISTINCT FROM $3
        FOR UPDATE`,
      [input.dataSourceId, key.source, key.propertyId],
    )
    if (before !== null && before.level === input.level) return { ok: true, value: toRule(before) } as const

    const saved = await tx.queryOne<RuleRow>(
      `INSERT INTO page_access_rule (id, data_source_id, source_kind, source_property_id, level)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (data_source_id, source_kind, COALESCE(source_property_id, '')) DO UPDATE SET level = EXCLUDED.level
       RETURNING id, data_source_id, source_kind, source_property_id, level`,
      [randomUUID(), input.dataSourceId, key.source, key.propertyId, input.level],
    )
    await recordForContextIn(tx, ctx, 'page.permission_changed', {
      target: { type: 'page', id: databaseId },
      metadata: { change: 'rule_set', source: key.source, ...propertyMeta(key), level: input.level },
    })
    return { ok: true, value: toRule(saved) } as const
  })
}

/** 규칙을 지운다 — 없으면 그대로 성공(감사 로그는 지웠을 때만). 그 규칙으로만 열던 사람은 곧바로 잃는다(신호 — 0089). */
export async function removeAccessRule(
  ctx: SessionContext,
  databaseId: string,
  input: { readonly dataSourceId: string; readonly source: string; readonly propertyId?: string | null },
): Promise<AccessRuleResult> {
  return withTransaction(async (tx) => {
    const denied = await gateDatabase(tx, ctx, databaseId, 'manage_perm')
    if (denied !== null) return { ok: false, reason: denied } as const
    if (!(await ownsDataSource(tx, databaseId, input.dataSourceId))) return { ok: false, reason: 'not_found' } as const
    const key = await ruleKeyOf(tx, input.dataSourceId, input.source, input.propertyId, false)
    if (typeof key === 'string') return { ok: false, reason: key } as const

    const removed = await tx.query<{ id: string }>(
      `DELETE FROM page_access_rule
        WHERE data_source_id = $1 AND source_kind = $2 AND source_property_id IS NOT DISTINCT FROM $3
        RETURNING id`,
      [input.dataSourceId, key.source, key.propertyId],
    )
    if (removed.length > 0) {
      await recordForContextIn(tx, ctx, 'page.permission_changed', {
        target: { type: 'page', id: databaseId },
        metadata: { change: 'rule_removed', source: key.source, ...propertyMeta(key) },
      })
    }
    return { ok: true } as const
  })
}
