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
 *   · 마지막 쓰기가 이긴다 — 설정은 CRDT 대상이 아니다(⑥)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { readSecurityPolicyIn, writeNonmemberRequestPolicyIn } from '../workspace/security-policy.ts'
import {
  DEFAULT_THEME,
  SETTINGS,
  canEditSetting,
  isTheme,
  canSeeSetting,
  normalizeSettingValue,
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
}

/** 이 사람에게 보이는 설정과 그 값 — 레지스트리의 순서로. 한 스냅샷에서 읽는다. */
export async function readSettings(ctx: SessionContext): Promise<SettingItem[]> {
  const visible = SETTINGS.filter((definition) => canSeeSetting(definition, ctx.role))
  return withReadTransaction(async (tx) => {
    const items: SettingItem[] = []
    for (const definition of visible) {
      items.push({
        key: definition.key,
        section: definition.section,
        label: definition.label,
        description: definition.description,
        control: definition.control,
        value: await storeOf(definition.key).read(tx, ctx),
        editable: canEditSetting(definition, ctx.role),
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
  /** 값이 컨트롤의 규칙에 맞지 않는다(글자 수 · 빈 값 · 모양). */
  | 'invalid_value'

export type SettingResult =
  | { readonly ok: true; readonly value: SettingValue }
  | { readonly ok: false; readonly reason: SettingFailure }

/** 설정 하나를 바꾼다 — 판정 · 값 검사를 쓰기 앞에서 하고, 쓴 뒤의 값을 다시 읽어 준다. */
export async function updateSetting(ctx: SessionContext, key: string, raw: unknown): Promise<SettingResult> {
  const definition = settingDefinition(key)
  if (definition === null) return { ok: false, reason: 'not_found' }
  if (!canEditSetting(definition, ctx.role)) return { ok: false, reason: 'forbidden' }
  const value = normalizeSettingValue(definition, raw)
  if (value === null) return { ok: false, reason: 'invalid_value' }

  const store = storeOf(definition.key)
  return withCommandTransaction(async (tx) => {
    await store.write(tx, ctx, value)
    return { ok: true, value: await store.read(tx, ctx) } as const
  })
}
