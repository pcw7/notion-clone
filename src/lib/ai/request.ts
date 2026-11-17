/**
 * AI 응답 요청의 모양 · 거부의 HTTP 상태 — AI-1 (F-10-09 · F-10-12 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① ② ④ ⑥
 *
 * `POST /api/workspaces/{id}/ai/complete` 의 본문:
 *
 *   { feature: 'ask' | 'edit' | 'translate' | 'block' | 'chat', prompt: string, pageId?: uuid | null }
 *   { feature, messages: [{ role: 'system' | 'user', content: string }, …], pageId? }
 *
 * `prompt` 는 사용자 메시지 하나의 줄임이다(AI-1 의 묻기). 기능마다의 시스템 프롬프트는 뒤 조각이 서버에서 짓는다 — 그때까지 받는 역할은
 * system · user 뿐이다(assistant 를 받으면 대화를 꾸며 넣을 수 있다). 글자 합이 `AI_MAX_INPUT_CHARS` 를 넘으면 보내지 않는다.
 */

import type { ChatMessage } from './provider.ts'
import { isAiFeature, type AiFeature } from './quota.ts'

export const AI_MAX_MESSAGES = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AiCompleteInput = {
  readonly feature: AiFeature
  readonly messages: readonly ChatMessage[]
  readonly pageId: string | null
}

export type AiCompleteParse =
  | { readonly ok: true; readonly value: AiCompleteInput }
  | { readonly ok: false; readonly error: 'invalid_input' | 'input_too_long' }

/** 본문을 읽는다 — 모양이 틀리면 `invalid_input` · 글이 길면 `input_too_long`. */
export function parseAiCompleteBody(body: unknown, maxInputChars: number): AiCompleteParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'invalid_input' }
  const b = body as Record<string, unknown>
  if (!isAiFeature(b.feature)) return { ok: false, error: 'invalid_input' }

  const rawPage = b.pageId ?? null
  if (rawPage !== null && (typeof rawPage !== 'string' || !UUID.test(rawPage))) return { ok: false, error: 'invalid_input' }

  let messages: ChatMessage[]
  if (b.prompt !== undefined && b.messages !== undefined) return { ok: false, error: 'invalid_input' }
  if (b.prompt !== undefined) {
    if (typeof b.prompt !== 'string' || b.prompt.trim() === '') return { ok: false, error: 'invalid_input' }
    messages = [{ role: 'user', content: b.prompt }]
  } else {
    if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > AI_MAX_MESSAGES) return { ok: false, error: 'invalid_input' }
    messages = []
    for (const raw of b.messages) {
      if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'invalid_input' }
      const m = raw as Record<string, unknown>
      if ((m.role !== 'system' && m.role !== 'user') || typeof m.content !== 'string' || m.content.trim() === '') {
        return { ok: false, error: 'invalid_input' }
      }
      messages.push({ role: m.role, content: m.content })
    }
    if (!messages.some((m) => m.role === 'user')) return { ok: false, error: 'invalid_input' }
  }

  const chars = messages.reduce((sum, m) => sum + m.content.length, 0)
  if (chars > maxInputChars) return { ok: false, error: 'input_too_long' }
  return { ok: true, value: { feature: b.feature, messages, pageId: rawPage === null ? null : rawPage.toLowerCase() } }
}

/** 게이트 · 요청의 거부 → HTTP 상태. 한도는 429 · 꺼짐 · 권한 403 · 없는 페이지 404 · 공급자 없음 503. */
export function aiFailureStatus(error: string): number {
  switch (error) {
    case 'ai_limit_reached':
      return 429
    case 'ai_disabled':
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'ai_unavailable':
      return 503
    case 'invalid_input':
    case 'input_too_long':
      return 400
    default:
      return 400
  }
}

/** 공급자 실패 → HTTP 상태 — 공급자의 요청 수 · 분당 토큰 한도는 503(잠시 뒤 다시) · 나머지는 502. */
export const aiProviderFailureStatus = (reason: string): number => (reason === 'rate_limited' ? 503 : 502)

/**
 * 공급자 실패 → 거부 코드 — 429 는 `ai_busy`(지나가는 것 · `retryAfter` 초와 함께 · 우리 한도의 `ai_limit_reached` 와 다르다), 나머지는
 * `ai_provider_failed`. 둘 다 그 응답은 셈에서 빠진다(받은 답이 없다).
 */
export const aiProviderFailureError = (reason: string): 'ai_busy' | 'ai_provider_failed' => (reason === 'rate_limited' ? 'ai_busy' : 'ai_provider_failed')
