/**
 * AI 모델 설정 — 소유자가 더한 모델 · 워크스페이스 기본 · 채팅의 고르개 (AI-7 · F-10-26 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫ · 마이그레이션 0149
 *
 * 바꾸는 것은 소유자만(로그인 세션 — 스위치와 같다 · `canManageAi`) · 바뀌었을 때만 감사(`workspace.setting_changed` · 키 `ai.models` ·
 * before/after `{allowed, default}`). 새로 더하는 모델은 공급자의 지금 목록에 있어야 한다(`parseModelSetting`). 보는 것은 게스트가 아닌
 * 사람 — 공급자의 목록은 소유자에게만 묻는다(고를 사람만).
 */

import { recordForContextIn } from '../audit/audit.ts'
import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import type { AiConfig } from './config.ts'
import {
  allowedModelsOf,
  defaultModelOf,
  listProviderModels,
  NO_MODEL_SETTING,
  parseModelSetting,
  sameModelSetting,
  type AiModelSetting,
  type ModelSettingFailure,
} from './models.ts'
import { canManageAi, canSeeAiSettings, canUseAi } from './usage.ts'

type Reader = Pick<Tx, 'query' | 'queryMaybe'>
type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** 워크스페이스의 모델 설정 — 줄이 없으면 아무것도 더하지 않았다(자동만). */
export async function aiModelSettingIn(db: Reader, workspaceId: string): Promise<AiModelSetting> {
  const row = await db.queryMaybe<{ allowed_models: string[]; default_model: string | null }>(
    `SELECT allowed_models, default_model FROM workspace_ai_setting WHERE workspace_id = $1`,
    [workspaceId],
  )
  return row === null ? NO_MODEL_SETTING : { allowed: row.allowed_models, defaultModel: row.default_model }
}

export type AiModelSettingsView = {
  /** 자동 — 운영자의 모델(`AI_MODEL` · 늘 쓸 수 있다). */
  readonly autoModel: string
  /** 소유자가 더한 모델(자동 말고). */
  readonly allowed: readonly string[]
  /** 워크스페이스 기본 — null 은 자동. */
  readonly defaultModel: string | null
  readonly canManage: boolean
  /** 소유자에게만 — 공급자가 주는 채팅 모델(자동 포함). 아니면 null. */
  readonly available: readonly string[] | null
  /** 목록을 받지 못했으면 `fallback`(자동 하나뿐). 소유자가 아니면 null. */
  readonly source: 'provider' | 'fallback' | null
}

/** 설정 → AI 의 모델 절 — 게스트 · 공급자 없음이면 null(절이 서지 않는다). */
export async function aiModelSettingsFor(
  ctx: SessionContext,
  options: { readonly config: AiConfig | null; readonly fetchImpl?: FetchLike },
): Promise<AiModelSettingsView | null> {
  const config = options.config
  if (config === null || !canSeeAiSettings(ctx)) return null
  const canManage = canManageAi(ctx)
  const [setting, listed] = await Promise.all([
    withReadTransaction((tx) => aiModelSettingIn(tx, ctx.workspaceId)),
    canManage ? listProviderModels(config, { fetchImpl: options.fetchImpl }) : Promise.resolve(null),
  ])
  return {
    autoModel: config.model,
    allowed: setting.allowed,
    defaultModel: setting.defaultModel,
    canManage,
    available: listed?.models ?? null,
    source: listed?.source ?? null,
  }
}

export type AiModelsResult =
  | { readonly ok: true; readonly value: AiModelSetting }
  | { readonly ok: false; readonly reason: 'forbidden' | 'ai_unavailable' | ModelSettingFailure }

/**
 * 더한 모델 · 기본을 바꾼다 — 소유자만. 본문 `{ allowed: string[], default: string | null }`(자동은 넣어도 뺀다 · 기본이 자동이면 null).
 * 스위치 줄이 없으면 꺼진 채로 만든다.
 */
export async function setAiModels(
  ctx: SessionContext,
  raw: unknown,
  options: { readonly config: AiConfig | null; readonly fetchImpl?: FetchLike },
): Promise<AiModelsResult> {
  if (!canManageAi(ctx)) return { ok: false, reason: 'forbidden' }
  const config = options.config
  if (config === null) return { ok: false, reason: 'ai_unavailable' }
  // 공급자에게는 트랜잭션 밖에서 묻는다(잠금을 쥔 채 기다리지 않는다)
  const listed = await listProviderModels(config, { fetchImpl: options.fetchImpl })
  return withCommandTransaction(async (tx): Promise<AiModelsResult> => {
    // 워크스페이스를 줄 세운다 — 같은 때의 두 저장이 같은 "전" 을 읽고 감사를 어긋나게 쓰지 않게(스위치와 같다)
    await tx.query(`SELECT 1 FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    const before = await aiModelSettingIn(tx, ctx.workspaceId)
    const parsed = parseModelSetting(raw, { autoModel: config.model, available: listed.models, current: before })
    if (!parsed.ok) return parsed
    const after = parsed.value
    if (sameModelSetting(before, after)) return { ok: true, value: after }
    await tx.query(
      `INSERT INTO workspace_ai_setting (workspace_id, enabled, changed_by, changed_at, allowed_models, default_model)
       VALUES ($1, false, $2, now(), $3::text[], $4)
       ON CONFLICT (workspace_id) DO UPDATE
         SET allowed_models = EXCLUDED.allowed_models, default_model = EXCLUDED.default_model,
             changed_by = EXCLUDED.changed_by, changed_at = EXCLUDED.changed_at`,
      [ctx.workspaceId, ctx.userId, after.allowed, after.defaultModel],
    )
    await recordForContextIn(tx, ctx, 'workspace.setting_changed', {
      target: { type: 'setting', id: 'ai.models' },
      setting: {
        key: 'ai.models',
        before: { allowed: before.allowed, default: before.defaultModel },
        after: { allowed: after.allowed, default: after.defaultModel },
      },
    })
    return { ok: true, value: after }
  })
}

/** 채팅의 고르개 — "자동" 이 쓰는 모델(워크스페이스 기본) · 고를 수 있는 모델(자동이 먼저). */
export type AiModelChoices = {
  readonly defaultModel: string
  readonly allowed: readonly string[]
}

/** 채팅 화면의 고르개 — AI 를 쓸 수 없는 사람 · 공급자 없음이면 null. */
export async function aiModelChoicesFor(ctx: SessionContext, config: AiConfig | null): Promise<AiModelChoices | null> {
  if (config === null || !canUseAi(ctx)) return null
  const setting = await withReadTransaction((tx) => aiModelSettingIn(tx, ctx.workspaceId))
  return { defaultModel: defaultModelOf(config.model, setting), allowed: allowedModelsOf(config.model, setting) }
}
