/**
 * 설정 — 읽기 · 쓰기 (설정 정보구조 8g-1조각 · F-17-12)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 정보구조 ② · ④ · ⑤
 *
 * 무엇이 있고 누가 보고 고치는가는 레지스트리(`registry.ts`)가 선언한다. 여기에는 **키마다 값이 사는 자리 하나**(`STORES`)와, 그 선언으로
 * 판정하는 곳 하나가 있다 — 화면과 라우트는 이 결과를 그대로 쓴다(판정을 다시 짓지 않는다).
 *
 *   · 값은 그 설정이 이미 사는 칸에 그대로다(정본 ②) — `"user".name` · `workspace.name` · `security_policy` 의 칸. 전용 칸이 없는
 *     설정은 `setting_value` 의 한 줄이다(8h — 테마 · `storedAccountSetting`)
 *   · 보이지 않는 설정은 읽기 목록에 없고 쓰기는 `forbidden` 이다. 모르는 키는 `not_found`(④)
 *   · 값은 레지스트리의 규칙으로 고친 뒤 쓴다(`normalizeSettingValue`) — 맞지 않으면 `invalid_value`
 *   · 요금제 게이트(⑦ · 4b-3) — 정의의 `requires` 가 거짓인 워크스페이스에서는 보이되 읽기 전용(`planRequired`)이고 쓰기는
 *     `plan_required`. 쓰기는 그 트랜잭션에서 다시 묻는다(화면의 판정은 표시일 뿐이다)
 *   · 마지막 쓰기가 이긴다 — 설정은 CRDT 대상이 아니다(⑥)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { recordForContextIn } from '../audit/audit.ts'
import { entitlement } from '../billing/entitlement.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { readSecurityPolicyIn, writeNonmemberRequestPolicyIn, writePublishPolicyIn } from '../workspace/security-policy.ts'
import {
  DEFAULT_THEME,
  SETTINGS,
  canEditSetting,
  isTheme,
  canSeeSetting,
  normalizeSettingValue,
  requiredEntitlement,
  settingDefinition,
  type SettingControl,
  type SettingKey,
  type SettingSectionId,
  type SettingValue,
  type SettingValueOf,
} from './registry.ts'

type Store<V extends SettingValue> = {
  readonly read: (tx: Tx, ctx: SessionContext) => Promise<V>
  readonly write: (tx: Tx, ctx: SessionContext, value: V) => Promise<void>
}

/**
 * 전용 칸이 없는 계정 설정 — `setting_value` 의 한 줄(정본 [보강] 설정 값 표 · 테마 ① · ②). 행이 없으면 `fallback` 이다. 읽은 값이 지금의
 * 모양에 맞지 않으면(선택지가 줄었을 때) 역시 `fallback` — 행은 그대로 둔다(되돌아오면 다시 맞는다).
 */
function storedAccountSetting<V extends SettingValue>(
  key: SettingKey,
  fallback: V,
  accept: (raw: unknown) => raw is V,
): Store<V> {
  return {
    read: async (tx, ctx) => {
      const row = await tx.queryMaybe<{ value: unknown }>(
        `SELECT value FROM setting_value WHERE scope = 'account' AND user_id = $1 AND key = $2`,
        [ctx.userId, key],
      )
      return row !== null && accept(row.value) ? row.value : fallback
    },
    write: async (tx, ctx, value) => {
      await tx.query(
        `INSERT INTO setting_value (scope, user_id, key, value, updated_by)
         VALUES ('account', $1, $2, $3::jsonb, $1)
         ON CONFLICT (user_id, key) WHERE scope = 'account'
         DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [ctx.userId, key, JSON.stringify(value)],
      )
    },
  }
}

/** 키마다 값이 사는 자리. 키를 더하면 타입이 여기를 요구한다. */
const STORES: { readonly [K in SettingKey]: Store<SettingValueOf<K>> } = {
  'account.name': {
    read: async (tx, ctx) => (await tx.queryOne<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [ctx.userId])).name,
    write: async (tx, ctx, value) => {
      await tx.query(`UPDATE "user" SET name = $2 WHERE id = $1`, [ctx.userId, value])
    },
  },
  'account.theme': storedAccountSetting('account.theme', DEFAULT_THEME, isTheme),
  'workspace.name': {
    read: async (tx, ctx) =>
      (await tx.queryOne<{ name: string }>(`SELECT name FROM workspace WHERE id = $1`, [ctx.workspaceId])).name,
    write: async (tx, ctx, value) => {
      await tx.query(`UPDATE workspace SET name = $2 WHERE id = $1`, [ctx.workspaceId, value])
    },
  },
  'workspace.allow_nonmember_page_access_request': {
    read: async (tx, ctx) => (await readSecurityPolicyIn(tx, ctx.workspaceId)).allowNonmemberPageAccessRequest,
    write: (tx, ctx, value) => writeNonmemberRequestPolicyIn(tx, ctx.workspaceId, value),
  },
  // 웹 게시(6a-1) — 끄면 게시한 주소도 곧바로 닫힌다(공개 경로가 런타임에 묻는다 · 정본 [정정] 웹 게시 ③⑨)
  'workspace.allow_publish_sites_and_forms': {
    read: async (tx, ctx) => (await readSecurityPolicyIn(tx, ctx.workspaceId)).allowPublish,
    write: (tx, ctx, value) => writePublishPolicyIn(tx, ctx.workspaceId, value),
  },
  // 휴지통 보관 기간(4b-3) — 버리는 명령이 이 칸을 읽어 `purge_after` 를 적는다. 바꿔도 이미 버린 것은 그대로다(정본 [보강] ③)
  'workspace.trash_days': {
    read: async (tx, ctx) =>
      (await tx.queryOne<{ days: number }>(`SELECT trash_days AS days FROM workspace WHERE id = $1`, [ctx.workspaceId])).days,
    write: async (tx, ctx, value) => {
      await tx.query(`UPDATE workspace SET trash_days = $2 WHERE id = $1`, [ctx.workspaceId, value])
    },
  },
}

/** 키로 고른 자리 — 값의 모양은 레지스트리가 이미 맞췄다(`normalizeSettingValue`). */
const storeOf = (key: SettingKey): Store<SettingValue> => STORES[key] as Store<SettingValue>

/** 설정 화면의 한 항목. */
export type SettingItem = {
  readonly key: SettingKey
  readonly section: SettingSectionId
  readonly label: string
  readonly description: string
  readonly control: SettingControl
  readonly value: SettingValue
  /** 이 사람이 고칠 수 있는가 — 아니면 읽기 전용으로 선다. */
  readonly editable: boolean
  /** 요금제가 막는가(⑦) — 참이면 `editable` 은 거짓이고 화면은 "요금제 필요"를 붙인다. */
  readonly planRequired: boolean
}

/** 이 사람에게 보이는 설정과 그 값 — 레지스트리의 순서로. 한 스냅샷에서 읽는다. */
export async function readSettings(ctx: SessionContext): Promise<SettingItem[]> {
  const visible = SETTINGS.filter((definition) => canSeeSetting(definition, ctx.role))
  return withReadTransaction(async (tx) => {
    const items: SettingItem[] = []
    for (const definition of visible) {
      const requires = requiredEntitlement(definition)
      const planRequired = requires !== null && !(await entitlement(ctx.workspaceId, requires, tx))
      items.push({
        key: definition.key,
        section: definition.section,
        label: definition.label,
        description: definition.description,
        control: definition.control,
        value: await storeOf(definition.key).read(tx, ctx),
        editable: canEditSetting(definition, ctx.role) && !planRequired,
        planRequired,
      })
    }
    return items
  })
}

export type SettingFailure =
  /** 그런 설정이 없다. */
  | 'not_found'
  /** 볼 수 없거나 고칠 수 없다. */
  | 'forbidden'
  /** 값이 컨트롤의 규칙에 맞지 않는다(글자 수 · 빈 값 · 모양 · 범위). */
  | 'invalid_value'
  /** 이 워크스페이스의 요금제가 이 설정을 허락하지 않는다(⑦). */
  | 'plan_required'

export type SettingResult =
  | { readonly ok: true; readonly value: SettingValue }
  | { readonly ok: false; readonly reason: SettingFailure }

/**
 * 설정 하나를 바꾼다 — 판정 · 요금제 · 값 검사를 쓰기 앞에서 하고, 쓴 뒤의 값을 다시 읽어 준다. 요금제는 값보다 먼저 묻는다 — 바꿀 수
 * 없는 사람에게 값의 규칙을 말해도 소용이 없다.
 */
export async function updateSetting(ctx: SessionContext, key: string, raw: unknown): Promise<SettingResult> {
  const definition = settingDefinition(key)
  if (definition === null) return { ok: false, reason: 'not_found' }
  if (!canEditSetting(definition, ctx.role)) return { ok: false, reason: 'forbidden' }
  const value = normalizeSettingValue(definition, raw)
  const requires = requiredEntitlement(definition)

  const store = storeOf(definition.key)
  return withCommandTransaction(async (tx): Promise<SettingResult> => {
    if (requires !== null && !(await entitlement(ctx.workspaceId, requires, tx))) return { ok: false, reason: 'plan_required' }
    if (value === null) return { ok: false, reason: 'invalid_value' }
    // 감사 로그(F-11-12 — 6d-1) — 워크스페이스의 설정만(내 계정의 이름 · 테마는 보안 기록이 아니다) · 바뀌었을 때만 · 앞뒤 값과 함께
    const audited = definition.scope === 'workspace'
    const before = audited ? await store.read(tx, ctx) : null
    await store.write(tx, ctx, value)
    const after = await store.read(tx, ctx)
    if (audited && JSON.stringify(before) !== JSON.stringify(after)) {
      await recordForContextIn(tx, ctx, 'workspace.setting_changed', {
        target: { type: 'setting', id: definition.key },
        setting: { key: definition.key, before, after },
      })
    }
    return { ok: true, value: after }
  })
}
