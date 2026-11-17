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
 *
 * **묻기(`ask` · AI-2)는 서버가 프롬프트를 짓는다**(`ask-prompt.ts`) — `messages` 를 받지 않는다(지시를 바꿔 넣지 못한다):
 *
 *   { feature: 'ask', prompt: 질문, pageId?: uuid | null, blockId?: uuid | null, history?: [{ question, answer }, …] }
 *
 * `blockId` 는 넣을 자리(문맥의 창이 그 둘레다) · `history` 는 이어서 묻기의 앞선 문답(최근 `ASK_MAX_HISTORY` 개만 싣는다). 지시 + 질문만으로
 * 상한을 넘으면 `input_too_long` — 페이지의 글은 서버가 남은 자리만큼 채운다.
 */

import { ASK_MAX_HISTORY, buildAskMessages, type AskTurn } from './ask-prompt.ts'
import type { ChatMessage } from './provider.ts'
import { isAiFeature, type AiFeature } from './quota.ts'

export const AI_MAX_MESSAGES = 20
/** 받는 앞선 문답의 수 — 이보다 많으면 모양이 틀린 것이다(싣는 것은 최근 `ASK_MAX_HISTORY` 개). */
export const ASK_HISTORY_LIMIT = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 묻기의 요청 — 프롬프트는 서버가 이것과 페이지의 원문으로 짓는다. */
export type AskRequest = {
  readonly question: string
  readonly blockId: string | null
  readonly history: readonly AskTurn[]
}

export type AiCompleteInput = {
  readonly feature: AiFeature
  /** 공급자에 보낼 메시지 — 묻기면 페이지의 글을 넣기 전의 모양(지시 + 질문 · 상한 검사용). */
  readonly messages: readonly ChatMessage[]
  readonly pageId: string | null
  /** 묻기(`ask`)일 때만 — 서버가 페이지의 원문을 읽어 메시지를 다시 짓는다(`complete-http.ts`). */
  readonly ask: AskRequest | null
}

const optionalUuid = (raw: unknown): string | null | undefined =>
  raw === undefined || raw === null ? null : typeof raw === 'string' && UUID.test(raw) ? raw.toLowerCase() : undefined

/** 묻기의 몸 — 질문 · 넣을 자리 · 앞선 문답. 틀리면 null. */
function parseAsk(b: Record<string, unknown>): AskRequest | null {
  if (b.messages !== undefined) return null
  if (typeof b.prompt !== 'string' || b.prompt.trim() === '') return null
  const blockId = optionalUuid(b.blockId)
  if (blockId === undefined) return null
  const rawHistory = b.history ?? []
  if (!Array.isArray(rawHistory) || rawHistory.length > ASK_HISTORY_LIMIT) return null
  const history: AskTurn[] = []
  for (const raw of rawHistory) {
    if (typeof raw !== 'object' || raw === null) return null
    const t = raw as Record<string, unknown>
    if (typeof t.question !== 'string' || t.question.trim() === '' || typeof t.answer !== 'string') return null
    history.push({ question: t.question, answer: t.answer })
  }
  return { question: b.prompt, blockId, history: history.slice(-ASK_MAX_HISTORY) }
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
  const pageId = rawPage === null ? null : rawPage.toLowerCase()

  if (b.feature === 'ask') {
    const ask = parseAsk(b)
    if (ask === null) return { ok: false, error: 'invalid_input' }
    const built = buildAskMessages({ question: ask.question, history: ask.history, anchorBlockId: ask.blockId, page: null }, maxInputChars)
    if (!built.ok) return { ok: false, error: built.error }
    return { ok: true, value: { feature: 'ask', messages: built.messages, pageId, ask } }
  }

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
  return { ok: true, value: { feature: b.feature, messages, pageId, ask: null } }
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
