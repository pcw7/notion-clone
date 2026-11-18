/**
 * AI 에게 묻기 — 편집기 쪽: 상태 기계 · 스트림 읽기 · 문구 (AI-2 · F-10-01 · F-10-09 · 브라우저 · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① ③ ⑤ · 10-ai-features.md F-10-01 · F-10-09
 *
 * 입력창(`ai-ask-bar.tsx`)과 함께 지연 로드된다. 상태 기계 하나가 진실이다:
 *
 *   idle ─묻기→ streaming ─delta…→ streaming ─done→ done
 *                          ├─멈추기(Esc · 버튼 · 연결을 닫는다)→ stopped(받은 데까지 남는다 · 서버는 stopped — 셈에 든다)
 *                          └─실패→ error(한도 · 바쁨 · 연결 …)
 *   done · stopped ─다시→ streaming(같은 질문 · 새 응답 하나로 센다) · ─이어서 묻기→ streaming(앞선 문답을 싣는다)
 *   error ─다시(되는 실패만)→ streaming
 *
 * 한 편집기에 응답은 하나만 흐른다 — streaming 중의 묻기 · 다시는 무시한다(두 번 누르기). 응답마다 차례 번호(`seq`)를 두어 멈춘 뒤 늦게 온
 * 조각을 버린다.
 */

import type { AskTurn } from './ask-prompt.ts'
import type { AiQuotaView } from './quota.ts'
import { createSseParser } from './sse.ts'

// ── 실패 ──────────────────────────────────────────────────────────────

export type AskFailure =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'cannot_edit' }
  | { readonly kind: 'too_long' }
  | { readonly kind: 'limit'; readonly limit: string; readonly resetsAt: string | null }
  | { readonly kind: 'busy'; readonly retryAfter: number | null }
  | { readonly kind: 'provider' }
  | { readonly kind: 'network' }

export const AI_ASK_DISABLED = '워크스페이스 소유자가 AI 를 켜야 합니다.'
export const AI_ASK_UNAVAILABLE = '운영자가 AI 를 설정하지 않았습니다.'
export const AI_ASK_FORBIDDEN = '게스트는 AI 를 쓸 수 없습니다.'

/** 거부의 JSON(`{ error, limit?, resetsAt?, retryAfter? }`) → 실패. 모르는 말이면 공급자 실패로. */
export function askFailureOf(body: unknown): AskFailure {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  switch (b.error) {
    case 'ai_disabled':
      return { kind: 'disabled' }
    case 'ai_unavailable':
      return { kind: 'unavailable' }
    case 'forbidden':
      return { kind: 'forbidden' }
    case 'not_found':
      return { kind: 'not_found' }
    case 'cannot_edit':
      return { kind: 'cannot_edit' }
    case 'input_too_long':
      return { kind: 'too_long' }
    case 'ai_limit_reached':
      return { kind: 'limit', limit: typeof b.limit === 'string' ? b.limit : '', resetsAt: typeof b.resetsAt === 'string' ? b.resetsAt : null }
    case 'ai_busy':
      return { kind: 'busy', retryAfter: typeof b.retryAfter === 'number' && b.retryAfter > 0 ? b.retryAfter : null }
    default:
      return { kind: 'provider' }
  }
}

/** 지금 다시 해 볼 수 있는가 — 바쁨 · 공급자 · 연결만. 한도는 풀릴 때까지 · 꺼짐 · 권한 · 긴 글은 다시 해도 같다. */
export const canRetry = (f: AskFailure): boolean => f.kind === 'busy' || f.kind === 'provider' || f.kind === 'network'

/** 시각 — 오늘이면 "오후 3:20", 아니면 "12월 1일 오후 3:20"(그 사람의 시간대 · 시험은 시간대를 준다). */
export function clockText(iso: string, now: Date, timeZone?: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const day = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone })
  const time = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone }).format(at)
  if (day.format(at) === day.format(now)) return time
  const md = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone }).format(at)
  return `${md} ${time}`
}

/** 실패의 말 — 한도는 어느 한도 · 언제 풀리는지(체험은 풀리지 않는다). */
export function askFailureMessage(f: AskFailure, now: Date = new Date(), timeZone?: string): string {
  const again = (resetsAt: string | null) => (resetsAt === null ? '' : ` — ${clockText(resetsAt, now, timeZone)} 에 다시 쓸 수 있습니다`)
  switch (f.kind) {
    case 'disabled':
      return AI_ASK_DISABLED
    case 'unavailable':
      return AI_ASK_UNAVAILABLE
    case 'forbidden':
      return AI_ASK_FORBIDDEN
    case 'not_found':
      return '이 페이지를 읽을 수 없습니다 — 권한이 바뀌었거나 페이지가 지워졌습니다.'
    case 'cannot_edit':
      return '이 페이지를 고칠 수 없습니다 — 편집 권한이 있어야 AI 로 고칠 수 있습니다.'
    case 'too_long':
      return '질문이 너무 깁니다 — 줄여서 다시 물어보세요.'
    case 'limit':
      switch (f.limit) {
        case 'window':
          return `6시간 한도에 닿았습니다${again(f.resetsAt)}.`
        case 'month':
          return `이번 달 한도에 닿았습니다${again(f.resetsAt)}.`
        case 'daily':
          return `오늘 이 앱의 AI 사용량이 모두 찼습니다${again(f.resetsAt)}.`
        case 'trial':
          return '체험 응답을 모두 썼습니다 — 운영자에게 보충을 요청하세요.'
      }
      return `AI 한도에 닿았습니다${again(f.resetsAt)}.`
    case 'busy':
      return `AI 서비스가 잠시 바쁩니다 — ${f.retryAfter === null ? '잠시' : `${f.retryAfter}초`} 뒤 다시 시도하세요.`
    case 'provider':
      return 'AI 서비스가 답하지 못했습니다. 다시 시도하세요.'
    case 'network':
      return '연결이 끊겼습니다. 다시 시도하세요.'
  }
}

/** 남은 응답의 한 줄 — 무제한이면 null. 6시간 창이 먼저 막으면 그것을 말한다. */
export function remainingText(quota: AiQuotaView | null): string | null {
  if (quota === null || quota.remaining === null) return null
  const n = quota.remaining.toLocaleString('ko-KR')
  if (quota.kind === 'trial') return `남은 체험 응답 ${n}`
  if (quota.kind === 'plan') {
    const w = quota.window
    const windowLeft = w !== null && w.limit !== null ? w.limit - w.used : null
    const monthLeft = quota.month !== null && quota.month.limit !== null ? quota.month.limit - quota.month.used : null
    if (windowLeft !== null && (monthLeft === null || windowLeft < monthLeft)) return `6시간 안에 남은 응답 ${n}`
    return `이번 달 남은 응답 ${n}`
  }
  return `남은 응답 ${n}`
}

// ── 상태 기계 ─────────────────────────────────────────────────────────

export type AskPhase = 'idle' | 'streaming' | 'done' | 'stopped' | 'error'

export type AskState = {
  readonly phase: AskPhase
  /** 지금 답의 질문. */
  readonly question: string
  /** 받은 데까지의 답(미리보기 · 문서에 들지 않는다). */
  readonly answer: string
  /** 앞선 문답 — 이어서 묻기가 싣는다. */
  readonly history: readonly AskTurn[]
  readonly failure: AskFailure | null
  readonly quota: AiQuotaView | null
  readonly truncated: boolean
  /** 응답의 차례 — 늦게 온 사건을 버린다. */
  readonly seq: number
}

export type AskEvent =
  | { readonly type: 'ask'; readonly question: string }
  | { readonly type: 'followUp'; readonly question: string }
  | { readonly type: 'retry' }
  | { readonly type: 'delta'; readonly seq: number; readonly text: string }
  | { readonly type: 'done'; readonly seq: number; readonly truncated: boolean; readonly quota: AiQuotaView | null }
  | { readonly type: 'stopped'; readonly seq: number }
  | { readonly type: 'failed'; readonly seq: number; readonly failure: AskFailure }

export const initialAskState: AskState = { phase: 'idle', question: '', answer: '', history: [], failure: null, quota: null, truncated: false, seq: 0 }

const start = (s: AskState, question: string, history: readonly AskTurn[]): AskState => ({
  ...s,
  phase: 'streaming',
  question,
  answer: '',
  history,
  failure: null,
  truncated: false,
  seq: s.seq + 1,
})

export function askReducer(s: AskState, e: AskEvent): AskState {
  switch (e.type) {
    case 'ask':
      return s.phase === 'idle' && e.question.trim() !== '' ? start(s, e.question.trim(), s.history) : s
    case 'followUp':
      if ((s.phase !== 'done' && s.phase !== 'stopped') || e.question.trim() === '') return s
      return start(s, e.question.trim(), s.answer.trim() === '' ? s.history : [...s.history, { question: s.question, answer: s.answer }])
    case 'retry':
      if (s.phase === 'done' || s.phase === 'stopped' || (s.phase === 'error' && s.failure !== null && canRetry(s.failure))) return start(s, s.question, s.history)
      return s
    case 'delta':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, answer: s.answer + e.text } : s
    case 'done':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, phase: 'done', truncated: e.truncated, quota: e.quota ?? s.quota } : s
    case 'stopped':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, phase: 'stopped' } : s
    case 'failed':
      return s.phase === 'streaming' && e.seq === s.seq ? { ...s, phase: 'error', failure: e.failure } : s
  }
}

// ── 스트림 ────────────────────────────────────────────────────────────

export type AskRequestBody = {
  readonly pageId: string | null
  readonly blockId: string | null
  readonly question: string
  readonly history: readonly AskTurn[]
}

export type AskOutcome =
  | { readonly kind: 'done'; readonly truncated: boolean; readonly quota: AiQuotaView | null }
  | { readonly kind: 'failed'; readonly failure: AskFailure }
  | { readonly kind: 'aborted' }

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/**
 * 묻고 답을 읽는다 — 조각마다 `onDelta`. 멈추면(`signal`) 연결을 닫는다(서버가 stopped 로 적는다). 던지지 않는다.
 */
export function streamAsk(
  workspaceId: string,
  body: AskRequestBody,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  fetchImpl: FetchLike = fetch,
): Promise<AskOutcome> {
  const json = { feature: 'ask', prompt: body.question, pageId: body.pageId, blockId: body.blockId, history: body.history }
  return streamAi(workspaceId, json, signal, onDelta, fetchImpl)
}

/** 응답 하나를 읽는다 — 몸(JSON)은 기능마다(묻기 · 고치기 AI-3). 거부 · 스트림의 읽기는 같다. 던지지 않는다. */
export async function streamAi(
  workspaceId: string,
  json: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  fetchImpl: FetchLike = fetch,
): Promise<AskOutcome> {
  let res: Response
  try {
    res = await fetchImpl(`/api/workspaces/${workspaceId}/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(json),
      signal,
    })
  } catch {
    return signal.aborted ? { kind: 'aborted' } : { kind: 'failed', failure: { kind: 'network' } }
  }
  if (!res.ok || res.body === null) {
    const json = await res.json().catch(() => null)
    return { kind: 'failed', failure: json === null ? { kind: res.status >= 500 ? 'provider' : 'network' } : askFailureOf(json) }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  try {
    for (;;) {
      const chunk = await reader.read()
      const events = chunk.done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(chunk.value, { stream: true }))
      for (const event of events) {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          continue
        }
        if (event.event === 'delta' && typeof data.text === 'string') onDelta(data.text)
        else if (event.event === 'done') return { kind: 'done', truncated: data.truncated === true, quota: (data.quota as AiQuotaView | null | undefined) ?? null }
        else if (event.event === 'error') return { kind: 'failed', failure: askFailureOf(data) }
      }
      if (chunk.done) return signal.aborted ? { kind: 'aborted' } : { kind: 'failed', failure: { kind: 'network' } }
    }
  } catch {
    return signal.aborted ? { kind: 'aborted' } : { kind: 'failed', failure: { kind: 'network' } }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
