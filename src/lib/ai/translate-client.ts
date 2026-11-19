/**
 * 페이지 번역 — 화면 쪽: 언어 차례 · 상태 기계 · 미리 보기 · 스트림 읽기 · 문구 (AI-4 · F-10-03 · 브라우저 · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ③ ⑨ · 10-ai-features.md F-10-03(언어 피커 — 최근 사용 언어 위 · 진행률 · 취소)
 *
 * 패널(`translate-page-panel.tsx`)과 함께 지연 로드된다. 상태 기계 하나가 진실이다:
 *
 *   closed ─열기→ pick ─언어→ estimating ─미리 보기→ confirm ─번역→ running ─progress…→ running ─done→ done
 *                  ↑────────────── 뒤로 ─────────────┘          ├─취소→ (cancelling) ─done(partial)→ done
 *                                                               └─실패→ error
 *   confirm 은 남은 응답이 청크 수보다 적으면 번역을 막는다(서버도 막는다 — 닫힌 쪽으로). done · error ─다시→ estimating(같은 언어 · 새 번역본)
 *
 * 한 번에 번역 하나 — running 중의 열기 · 다시는 무시한다. 차례 번호(`seq`)로 늦게 온 사건을 버린다.
 */

import { askFailureMessage, askFailureOf, canRetry, type AskFailure } from './ask-client.ts'
import { EDIT_LANGUAGES, isEditLanguage, type EditLanguage } from './edit-prompt.ts'
import type { AiQuotaView } from './quota.ts'
import { createSseParser } from './sse.ts'
import { stopNoticeText, type TranslateStop } from './translate-plan.ts'

// ── 언어의 차례 ───────────────────────────────────────────────────────

export const RECENT_LANGUAGES_KEY = 'nc.ai.translate.recent'

/** 최근 쓴 언어가 위 · 나머지는 고치기의 차례(일곱 언어). 모르는 값 · 겹친 값은 버린다. */
export function orderLanguages(recent: readonly unknown[]): EditLanguage[] {
  const front = [...new Set(recent.filter(isEditLanguage))]
  return [...front, ...EDIT_LANGUAGES.filter((l) => !front.includes(l))]
}

/** 고른 언어를 맨 앞에 — 새 최근 목록. */
export const rememberLanguage = (recent: readonly unknown[], language: EditLanguage): EditLanguage[] => orderLanguages([language, ...recent]).slice(0, 3)

/** 이 기기의 최근 언어 — 저장소가 없거나 막혀도 빈 목록(늘 그린다). */
export function readRecentLanguages(storage: Pick<Storage, 'getItem'> | null): EditLanguage[] {
  try {
    const raw = JSON.parse(storage?.getItem(RECENT_LANGUAGES_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter(isEditLanguage) : []
  } catch {
    return []
  }
}

export function writeRecentLanguages(storage: Pick<Storage, 'setItem'> | null, recent: readonly EditLanguage[]): void {
  try {
    storage?.setItem(RECENT_LANGUAGES_KEY, JSON.stringify(recent))
  } catch {
    // 저장소가 막혔다 — 다음에 기본 차례
  }
}

// ── 실패 ──────────────────────────────────────────────────────────────

export type TranslateFailure =
  | AskFailure
  | { readonly kind: 'cannot_create' }
  | { readonly kind: 'empty_page' }
  | { readonly kind: 'not_enough'; readonly needed: number; readonly remaining: number }
  | { readonly kind: 'page_gone' }
  | { readonly kind: 'write_failed' }

/** 거부의 JSON · error 사건 → 실패. */
export function translateFailureOf(body: unknown): TranslateFailure {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  switch (b.error) {
    case 'cannot_create':
      return { kind: 'cannot_create' }
    case 'empty_page':
      return { kind: 'empty_page' }
    case 'not_enough_quota':
      return { kind: 'not_enough', needed: Number(b.needed) || 0, remaining: Number(b.remaining) || 0 }
    case 'page_gone':
      return { kind: 'page_gone' }
    case 'write_failed':
      return { kind: 'write_failed' }
    default:
      return askFailureOf(body)
  }
}

export function translateFailureMessage(f: TranslateFailure, now: Date = new Date(), timeZone?: string): string {
  switch (f.kind) {
    case 'cannot_create':
      return '이 페이지 아래에 번역본을 만들 수 없습니다 — 하위 페이지를 만들 권한이 있어야 합니다.'
    case 'empty_page':
      return '번역할 글이 없습니다.'
    case 'not_enough':
      return notEnoughText(f.needed, f.remaining)
    case 'page_gone':
      return '번역본 페이지가 사라졌거나 고칠 수 없게 되어 쓰지 못했습니다.'
    case 'write_failed':
      return '번역본을 쓰지 못했습니다. 다시 시도하세요.'
    case 'too_long':
      return '블록 하나가 너무 길어 번역할 수 없습니다.'
    default:
      return askFailureMessage(f, now, timeZone)
  }
}

export const translateCanRetry = (f: TranslateFailure): boolean => f.kind === 'write_failed' || (f.kind !== 'cannot_create' && f.kind !== 'empty_page' && f.kind !== 'not_enough' && f.kind !== 'page_gone' && canRetry(f))

export const notEnoughText = (needed: number, remaining: number): string =>
  `AI 응답이 ${needed.toLocaleString('ko-KR')}회 필요한데 ${remaining.toLocaleString('ko-KR')}회 남았습니다 — 시작하지 않습니다.`

/** 확인의 한 줄 — 쓸 응답 수 · 남은 응답(무제한이면 남은 수는 말하지 않는다). */
export function costText(chunks: number, remaining: number | null): string {
  const use = `AI 응답 ${chunks.toLocaleString('ko-KR')}회를 씁니다`
  return remaining === null ? `${use}.` : `${use} · 남은 응답 ${remaining.toLocaleString('ko-KR')}회.`
}

// ── 결과 ──────────────────────────────────────────────────────────────

export type TranslateResult = {
  readonly status: 'completed' | 'partial'
  readonly pageId: string
  readonly translated: number
  readonly skipped: number
  readonly done: number
  readonly total: number
  readonly reason: TranslateStop | null
  readonly limit: string | null
  readonly resetsAt: string | null
}

const STOPS: readonly TranslateStop[] = ['limit', 'stopped', 'busy', 'provider', 'unavailable']

export function translateResultOf(data: Record<string, unknown>): TranslateResult | null {
  if (typeof data.pageId !== 'string') return null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    status: data.status === 'partial' ? 'partial' : 'completed',
    pageId: data.pageId,
    translated: n(data.translated),
    skipped: n(data.skipped),
    done: n(data.done),
    total: n(data.total),
    reason: STOPS.includes(data.reason as TranslateStop) ? (data.reason as TranslateStop) : null,
    limit: typeof data.limit === 'string' ? data.limit : null,
    resetsAt: typeof data.resetsAt === 'string' ? data.resetsAt : null,
  }
}

/** 끝의 말 — 다 했으면 몇 블록 · 건너뛴 것, 멈췄으면 어디서 왜(한도면 어느 한도 · 언제). */
export function resultText(r: TranslateResult, now: Date = new Date(), timeZone?: string): string {
  if (r.status === 'completed') {
    const skipped = r.skipped > 0 ? ` · ${r.skipped.toLocaleString('ko-KR')}개는 원문 그대로 두었습니다` : ''
    return `번역을 마쳤습니다${skipped}.`
  }
  const head = stopNoticeText(r.done, r.total, r.reason ?? 'provider')
  if (r.reason === 'limit') return `${head} ${askFailureMessage({ kind: 'limit', limit: r.limit ?? '', resetsAt: r.resetsAt }, now, timeZone)}`
  return head
}

// ── 상태 기계 ─────────────────────────────────────────────────────────

export type TranslatePhase = 'closed' | 'pick' | 'estimating' | 'confirm' | 'running' | 'done' | 'error'

export type TranslateState = {
  readonly phase: TranslatePhase
  readonly language: EditLanguage | null
  /** 미리 보기 — 쓸 응답 수(청크) · 남은 응답(null 무제한). */
  readonly chunks: number
  readonly remaining: number | null
  /** 진행 — 끝난 청크 · 모두. */
  readonly done: number
  readonly total: number
  /** 번역본 페이지(만든 뒤부터). */
  readonly pageId: string | null
  /** 공급자가 바빠 기다리는 초. */
  readonly waiting: number | null
  readonly cancelling: boolean
  readonly result: TranslateResult | null
  readonly failure: TranslateFailure | null
  readonly seq: number
}

export type TranslateEvent =
  | { readonly type: 'open' }
  /** 메뉴가 닫힌다(바깥 · Esc) — 카드만 닫는다(진행 · 결과의 토스트는 남는다). */
  | { readonly type: 'close' }
  /** 토스트를 닫는다 — 흐르는 동안은 아니다. */
  | { readonly type: 'dismiss' }
  | { readonly type: 'pick'; readonly language: EditLanguage }
  | { readonly type: 'back' }
  | { readonly type: 'estimated'; readonly seq: number; readonly chunks: number; readonly remaining: number | null }
  | { readonly type: 'start' }
  | { readonly type: 'progress'; readonly seq: number; readonly done: number; readonly total: number; readonly pageId: string | null }
  | { readonly type: 'wait'; readonly seq: number; readonly seconds: number }
  | { readonly type: 'cancel' }
  | { readonly type: 'finished'; readonly seq: number; readonly result: TranslateResult }
  | { readonly type: 'failed'; readonly seq: number; readonly failure: TranslateFailure }
  | { readonly type: 'retry' }

export const initialTranslateState: TranslateState = {
  phase: 'closed',
  language: null,
  chunks: 0,
  remaining: null,
  done: 0,
  total: 0,
  pageId: null,
  waiting: null,
  cancelling: false,
  result: null,
  failure: null,
  seq: 0,
}

/** 메뉴 자리의 카드에 있는가 — 언어 · 미리 보기 · 확인 · 시작 전의 실패. 나머지(진행 · 결과 · 시작 뒤의 실패)는 토스트다. */
export const inCard = (s: Pick<TranslateState, 'phase' | 'total'>): boolean =>
  s.phase === 'pick' || s.phase === 'estimating' || s.phase === 'confirm' || (s.phase === 'error' && s.total === 0)

/** 토스트에 있는가. */
export const inToast = (s: Pick<TranslateState, 'phase' | 'total'>): boolean => s.phase === 'running' || s.phase === 'done' || (s.phase === 'error' && s.total > 0)

/** 남은 응답이 청크 수만큼 있는가(무제한이면 있다). */
export const enoughQuota = (s: Pick<TranslateState, 'chunks' | 'remaining'>): boolean => s.remaining === null || s.remaining >= s.chunks

const estimating = (s: TranslateState, language: EditLanguage): TranslateState => ({
  ...initialTranslateState,
  phase: 'estimating',
  language,
  seq: s.seq + 1,
})

export function translateReducer(s: TranslateState, e: TranslateEvent): TranslateState {
  const current = (seq: number) => seq === s.seq
  switch (e.type) {
    case 'open':
      return s.phase === 'running' ? s : { ...initialTranslateState, phase: 'pick', seq: s.seq + 1 }
    case 'close':
      return inCard(s) ? { ...initialTranslateState, seq: s.seq + 1 } : s
    case 'dismiss':
      return s.phase === 'running' ? s : { ...initialTranslateState, seq: s.seq + 1 }
    case 'pick':
      return s.phase === 'pick' ? estimating(s, e.language) : s
    case 'back':
      return s.phase === 'confirm' || s.phase === 'estimating' || s.phase === 'error' ? { ...initialTranslateState, phase: 'pick', seq: s.seq + 1 } : s
    case 'estimated':
      return s.phase === 'estimating' && current(e.seq) ? { ...s, phase: 'confirm', chunks: e.chunks, remaining: e.remaining } : s
    case 'start':
      return s.phase === 'confirm' && enoughQuota(s) ? { ...s, phase: 'running', done: 0, total: s.chunks, seq: s.seq + 1 } : s
    case 'progress':
      return s.phase === 'running' && current(e.seq) ? { ...s, done: e.done, total: e.total, pageId: e.pageId ?? s.pageId, waiting: null } : s
    case 'wait':
      return s.phase === 'running' && current(e.seq) ? { ...s, waiting: e.seconds } : s
    case 'cancel':
      return s.phase === 'running' ? { ...s, cancelling: true } : s
    case 'finished':
      return s.phase === 'running' && current(e.seq) ? { ...s, phase: 'done', result: e.result, pageId: e.result.pageId, waiting: null, cancelling: false } : s
    case 'failed':
      return (s.phase === 'running' || s.phase === 'estimating') && current(e.seq) ? { ...s, phase: 'error', failure: e.failure, waiting: null, cancelling: false } : s
    case 'retry':
      return (s.phase === 'done' || (s.phase === 'error' && s.failure !== null && translateCanRetry(s.failure))) && s.language !== null ? estimating(s, s.language) : s
  }
}

// ── 서버 ──────────────────────────────────────────────────────────────

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type EstimateOutcome =
  | { readonly kind: 'ok'; readonly chunks: number; readonly remaining: number | null; readonly quota: AiQuotaView | null }
  | { readonly kind: 'failed'; readonly failure: TranslateFailure }

/** 미리 보기 — 쓸 응답 수 · 남은 응답. 던지지 않는다. */
export async function fetchTranslateEstimate(workspaceId: string, pageId: string, language: EditLanguage, fetchImpl: FetchLike = fetch): Promise<EstimateOutcome> {
  let res: Response
  try {
    res = await fetchImpl(`/api/workspaces/${workspaceId}/ai/translate?pageId=${encodeURIComponent(pageId)}&language=${language}`)
  } catch {
    return { kind: 'failed', failure: { kind: 'network' } }
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || json === null || json.ok !== true) return { kind: 'failed', failure: json === null ? { kind: res.status >= 500 ? 'provider' : 'network' } : translateFailureOf(json) }
  return {
    kind: 'ok',
    chunks: typeof json.chunks === 'number' ? json.chunks : 0,
    remaining: typeof json.remaining === 'number' ? json.remaining : null,
    quota: (json.quota as AiQuotaView | null | undefined) ?? null,
  }
}

export type TranslateStreamEvent =
  | { readonly kind: 'progress'; readonly done: number; readonly total: number; readonly pageId: string | null }
  | { readonly kind: 'wait'; readonly seconds: number }

export type TranslateOutcome = { readonly kind: 'done'; readonly result: TranslateResult } | { readonly kind: 'failed'; readonly failure: TranslateFailure }

/**
 * 번역한다 — 사건마다 `onEvent`. `signal` 로 끊으면 서버가 흐르던 청크를 멈추고 거기까지로 번역본을 쓴다(그 결과는 이 연결로 오지 않는다 —
 * 끊긴 뒤의 끝은 `aborted` 실패다 · 화면은 이미 만든 번역본으로 안내한다). 던지지 않는다.
 */
export async function streamTranslate(
  workspaceId: string,
  body: { readonly pageId: string; readonly language: EditLanguage },
  signal: AbortSignal,
  onEvent: (e: TranslateStreamEvent) => void,
  fetchImpl: FetchLike = fetch,
): Promise<TranslateOutcome> {
  let res: Response
  try {
    res = await fetchImpl(`/api/workspaces/${workspaceId}/ai/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    return { kind: 'failed', failure: { kind: 'network' } }
  }
  if (!res.ok || res.body === null) {
    const json = await res.json().catch(() => null)
    return { kind: 'failed', failure: json === null ? { kind: res.status >= 500 ? 'provider' : 'network' } : translateFailureOf(json) }
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
        if (event.event === 'progress') {
          onEvent({ kind: 'progress', done: Number(data.done) || 0, total: Number(data.total) || 0, pageId: typeof data.pageId === 'string' ? data.pageId : null })
        } else if (event.event === 'wait') {
          onEvent({ kind: 'wait', seconds: Number(data.seconds) || 0 })
        } else if (event.event === 'done') {
          const result = translateResultOf(data)
          return result === null ? { kind: 'failed', failure: { kind: 'provider' } } : { kind: 'done', result }
        } else if (event.event === 'error') {
          return { kind: 'failed', failure: translateFailureOf(data) }
        }
      }
      if (chunk.done) return { kind: 'failed', failure: { kind: 'network' } }
    }
  } catch {
    return { kind: 'failed', failure: { kind: 'network' } }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
