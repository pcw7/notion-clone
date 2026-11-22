/**
 * AI 모델 — 공급자의 목록 · 채팅 모델 거르기 · 허용 목록 · 이번 응답의 모델 (AI-7 · F-10-26 · 서버)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫
 *
 * 목록은 `GET {AI_BASE_URL}/models`(OpenAI 호환 · 같은 키)를 서버 메모리에 1시간 둔다 — 실패는 1분(공급자를 두드리지 않는다)이고 그동안은
 * `AI_MODEL` 하나뿐이다. 키 · 공급자의 응답 본문은 어디에도 싣지 않는다(`provider.ts` 와 같다).
 *
 * **"자동" = `AI_MODEL`** — 늘 쓸 수 있다. 소유자가 더한 모델(`allowed`)과 워크스페이스 기본(`defaultModel` · null 이면 자동)은 DB 의 것
 * (`workspace_ai_setting` · 0149). 여기 함수는 모두 순수하다(목록 받기만 `fetch`).
 */

import type { AiConfig } from './config.ts'

/**
 * 채팅 모델이 아닌 것 — id 를 영숫자가 아닌 글자로 자른 조각 중 하나가 이 낱말로 시작하면 뺀다(받아쓰기 · 말하기 · 안전 분류 · 임베딩 ·
 * 그림 · 재순위). 예: `whisper-large-v3` · `playai-tts` · `meta-llama/llama-guard-4-12b` · `text-embedding-3-small` · `dall-e-3` ·
 * `openai/gpt-oss-safeguard-20b`(안전 정책 분류 — Groq 실측 2026-11-22 · "guard" 로 시작하지 않아 따로 둔다).
 */
export const NON_CHAT_MODEL_WORDS = ['whisper', 'tts', 'guard', 'safeguard', 'embed', 'moderation', 'dall', 'orpheus', 'transcribe', 'rerank', 'speech'] as const

/** 목록에 싣는 모델 수의 상한(OpenRouter 는 수백 개다). */
export const AI_MODEL_LIST_MAX = 200
/** 소유자가 더할 수 있는 모델 수(DB CHECK 와 같다). */
export const AI_ALLOWED_MODELS_MAX = 20
/** 모델 id 의 최대 글자(DB CHECK 와 같다). */
export const AI_MODEL_ID_MAX = 200

export const MODEL_LIST_TTL_MS = 60 * 60 * 1000
export const MODEL_LIST_FAILURE_TTL_MS = 60 * 1000
export const MODEL_LIST_TIMEOUT_MS = 5000

/** 채팅 모델인가 — 거르는 낱말로 시작하는 조각이 없다. */
export function isChatModelId(id: string): boolean {
  const parts = id.toLowerCase().split(/[^a-z0-9]+/)
  return !parts.some((p) => NON_CHAT_MODEL_WORDS.some((w) => p.startsWith(w)))
}

/** 공급자의 `/models` 응답 → 채팅 모델 id(겹침 없이 · id 차례 · 200개까지). 모양이 틀리면 null. */
export function chatModelIdsOf(json: unknown): string[] | null {
  if (typeof json !== 'object' || json === null) return null
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  const ids = new Set<string>()
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const m = item as Record<string, unknown>
    if (typeof m.id !== 'string') continue
    const id = m.id
    if (id === '' || id !== id.trim() || id.length > AI_MODEL_ID_MAX) continue
    // Groq 는 내린 모델을 `active: false` 로 남긴다
    if (m.active === false) continue
    if (isChatModelId(id)) ids.add(id)
  }
  return [...ids].sort().slice(0, AI_MODEL_LIST_MAX)
}

// ── 공급자의 목록 ─────────────────────────────────────────────────────

export type ProviderModels = {
  /** 고를 수 있는 채팅 모델 — `AI_MODEL` 은 늘 든다(id 차례). */
  readonly models: readonly string[]
  /** `fallback` 이면 목록을 받지 못했다(자동 하나뿐). */
  readonly source: 'provider' | 'fallback'
}

type CacheEntry = { readonly at: number; readonly ttl: number; readonly ids: readonly string[] | null }

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<readonly string[] | null>>()

/** 시험이 캐시를 비운다. */
export function clearModelListCache(): void {
  cache.clear()
  inflight.clear()
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

const withAuto = (config: Pick<AiConfig, 'model'>, ids: readonly string[] | null): ProviderModels => ({
  models: [...new Set([config.model, ...(ids ?? [])])].sort(),
  source: ids === null ? 'fallback' : 'provider',
})

async function fetchModelIds(config: Pick<AiConfig, 'baseUrl' | 'apiKey'>, fetchImpl: FetchLike): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${config.baseUrl}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    })
    if (!res.ok) {
      // 본문은 읽지 않고 버린다 — 공급자의 말을 흘리지 않는다
      await res.body?.cancel().catch(() => undefined)
      console.warn(`[ai] 모델 목록을 받지 못했다 (${res.status})`)
      return null
    }
    const ids = chatModelIdsOf(await res.json())
    if (ids === null) console.warn('[ai] 모델 목록의 모양이 틀렸다')
    return ids
  } catch {
    console.warn('[ai] 모델 목록을 받지 못했다 (연결)')
    return null
  }
}

/**
 * 공급자가 주는 채팅 모델 — 1시간 둔다(실패는 1분). 같은 순간의 요청은 한 번만 묻는다. 못 받으면 `AI_MODEL` 하나(`fallback`).
 *
 * @param options.now 지금(ms) — 시험이 캐시의 시각을 정한다
 */
export async function listProviderModels(
  config: Pick<AiConfig, 'baseUrl' | 'apiKey' | 'model'>,
  options: { readonly fetchImpl?: FetchLike; readonly now?: () => number } = {},
): Promise<ProviderModels> {
  const now = options.now ?? Date.now
  const key = `${config.baseUrl}\n${config.apiKey}`
  const hit = cache.get(key)
  if (hit !== undefined && now() - hit.at < hit.ttl) return withAuto(config, hit.ids)
  let pending = inflight.get(key)
  if (pending === undefined) {
    pending = fetchModelIds(config, options.fetchImpl ?? fetch).then((ids) => {
      cache.set(key, { at: now(), ttl: ids === null ? MODEL_LIST_FAILURE_TTL_MS : MODEL_LIST_TTL_MS, ids })
      return ids
    })
    inflight.set(key, pending)
    void pending.finally(() => inflight.delete(key))
  }
  return withAuto(config, await pending)
}

// ── 허용 목록 · 기본 ──────────────────────────────────────────────────

/** 워크스페이스의 모델 설정 — `allowed` 는 자동 말고 더한 것 · `defaultModel` null 은 자동. */
export type AiModelSetting = { readonly allowed: readonly string[]; readonly defaultModel: string | null }

export const NO_MODEL_SETTING: AiModelSetting = { allowed: [], defaultModel: null }

/** 쓸 수 있는 모델 — 자동(`AI_MODEL`)이 먼저 · 그다음 더한 것(차례 그대로 · 겹침 없음). */
export function allowedModelsOf(autoModel: string, setting: AiModelSetting): string[] {
  return [autoModel, ...setting.allowed.filter((m) => m !== autoModel)]
}

/** 워크스페이스 기본 — 정하지 않았거나 지금 허용 밖이면 자동. */
export function defaultModelOf(autoModel: string, setting: AiModelSetting): string {
  const d = setting.defaultModel
  return d !== null && allowedModelsOf(autoModel, setting).includes(d) ? d : autoModel
}

export type ModelPick = { readonly ok: true; readonly model: string } | { readonly ok: false }

/**
 * 이번 응답의 모델 — `requested` 가 null 이면 워크스페이스 기본. 허용 밖이면 거부 — `fallback` 이면 기본으로(회수된 대화의 모델 ·
 * F-10-26 *"다음 턴부터 기본 모델 폴백"*).
 */
export function pickModel(autoModel: string, setting: AiModelSetting, requested: string | null, fallback = false): ModelPick {
  const byDefault = defaultModelOf(autoModel, setting)
  if (requested === null) return { ok: true, model: byDefault }
  if (allowedModelsOf(autoModel, setting).includes(requested)) return { ok: true, model: requested }
  return fallback ? { ok: true, model: byDefault } : { ok: false }
}

/** 요청의 모델 칸 — 없음(undefined) · 자동(null) · 1~200자의 id. 틀리면 `invalid`. */
export function readModelField(raw: unknown): string | null | undefined | 'invalid' {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') return 'invalid'
  const id = raw.trim()
  return id === '' || id.length > AI_MODEL_ID_MAX ? 'invalid' : id
}

export type ModelSettingFailure = 'invalid_value' | 'too_many_models' | 'unknown_model' | 'default_not_allowed'

export type ModelSettingParse = { readonly ok: true; readonly value: AiModelSetting } | { readonly ok: false; readonly reason: ModelSettingFailure }

/**
 * 소유자가 보낸 설정 `{ allowed: string[], default: string | null }` 을 읽는다 — 자동은 빼고(늘 된다) 겹침을 지우고 id 차례로. 새로 더하는
 * 모델은 공급자의 목록(`available`)에 있어야 한다(이미 허용한 것은 목록을 받지 못해도 남긴다). 기본이 자동이면 null.
 */
export function parseModelSetting(
  raw: unknown,
  input: { readonly autoModel: string; readonly available: readonly string[]; readonly current: AiModelSetting },
): ModelSettingParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'invalid_value' }
  const r = raw as Record<string, unknown>
  if (Object.keys(r).some((k) => k !== 'allowed' && k !== 'default')) return { ok: false, reason: 'invalid_value' }
  if (!Array.isArray(r.allowed)) return { ok: false, reason: 'invalid_value' }
  const picked = new Set<string>()
  for (const item of r.allowed) {
    const id = readModelField(item)
    if (typeof id !== 'string' || id === 'invalid') return { ok: false, reason: 'invalid_value' }
    if (id !== input.autoModel) picked.add(id)
  }
  if (picked.size > AI_ALLOWED_MODELS_MAX) return { ok: false, reason: 'too_many_models' }
  const known = new Set([...input.available, ...input.current.allowed])
  for (const id of picked) if (!known.has(id)) return { ok: false, reason: 'unknown_model' }
  const allowed = [...picked].sort()

  const d = readModelField(r.default)
  if (d === 'invalid') return { ok: false, reason: 'invalid_value' }
  const defaultModel = d === undefined || d === null || d === input.autoModel ? null : d
  if (defaultModel !== null && !allowed.includes(defaultModel)) return { ok: false, reason: 'default_not_allowed' }
  return { ok: true, value: { allowed, defaultModel } }
}

/** 두 설정이 같은가(바뀌었을 때만 감사한다). */
export function sameModelSetting(a: AiModelSetting, b: AiModelSetting): boolean {
  return a.defaultModel === b.defaultModel && a.allowed.length === b.allowed.length && a.allowed.every((m, i) => m === b.allowed[i])
}
