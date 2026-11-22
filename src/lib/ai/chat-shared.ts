/**
 * AI 채팅 — 서버와 화면이 함께 쓰는 모양 · 제목 · 범위 · 인용 (AI-6 · F-10-17 · 순수 · DB · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 *
 * 화면(`/w/{id}/ai`)의 첫 JS 에 든다 — 무거운 것(편집기 · 본문 읽기)을 부르지 않는다.
 */

/** 대화 제목의 최대 글자(DB CHECK 와 같다). */
export const CHAT_TITLE_MAX = 60
/** 첫 질문이 비었을 때의 제목. */
export const CHAT_DEFAULT_TITLE = '새 대화'
/** 질문 하나의 최대 글자 — 넘으면 `input_too_long`. */
export const CHAT_QUESTION_MAX = 4000
/** 목록에 싣는 대화 수(F-10-17 *"히스토리는 페이지네이션 없이 최근 50건"*). */
export const CHAT_LIST_LIMIT = 50
/** 한 답의 출처 수의 상한(DB CHECK 는 8 — 여유). */
export const CHAT_MAX_SOURCES = 4

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 범위 — 세션의 속성(마지막 턴의 범위). */
export type ChatScope = { readonly kind: 'workspace' } | { readonly kind: 'page'; readonly pageId: string }

export const WORKSPACE_SCOPE: ChatScope = { kind: 'workspace' }

/** 범위를 읽는다 — 없으면 워크스페이스 전체 · 모양이 틀리면 null. */
export function parseChatScope(raw: unknown): ChatScope | null {
  if (raw === undefined || raw === null) return WORKSPACE_SCOPE
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const keys = Object.keys(r)
  if (r.kind === 'workspace') return keys.every((k) => k === 'kind') ? WORKSPACE_SCOPE : null
  if (r.kind === 'page' && typeof r.pageId === 'string' && UUID.test(r.pageId) && keys.every((k) => k === 'kind' || k === 'pageId')) {
    return { kind: 'page', pageId: r.pageId.toLowerCase() }
  }
  return null
}

/** 제목 — 첫 질문의 첫 줄(공백을 접고 60자 · 넘으면 59자 + "…"). 비면 "새 대화". */
export function chatTitleOf(question: string): string {
  const line = question.split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? ''
  const folded = line.replace(/\s+/g, ' ').trim()
  if (folded === '') return CHAT_DEFAULT_TITLE
  const chars = [...folded]
  return chars.length > CHAT_TITLE_MAX ? `${chars.slice(0, CHAT_TITLE_MAX - 1).join('').trimEnd()}…` : folded
}

/** 이름 바꾸기 — 공백을 접고 1~60자. 틀리면 null. */
export function normalizeChatTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const folded = raw.replace(/\s+/g, ' ').trim()
  return folded === '' || [...folded].length > CHAT_TITLE_MAX ? null : folded
}

/** 모델에 준 출처 하나 — 번호(`[n]`) · 페이지 · 그때의 제목. `cited` 는 답이 그 번호를 썼는가. */
export type ChatSource = { readonly n: number; readonly pageId: string; readonly title: string; readonly cited: boolean }

/** 답이 쓴 출처 번호 — `[1]` · `[1][2]` · `[1, 2]`. */
export function citedNumbers(answer: string): Set<number> {
  const out = new Set<number>()
  for (const m of answer.matchAll(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g)) {
    for (const part of m[1]!.split(',')) out.add(Number(part.trim()))
  }
  return out
}

/** 출처마다 답이 인용했는가를 적는다 — 없는 번호의 인용은 버린다. */
export function markCited(answer: string, sources: readonly Omit<ChatSource, 'cited'>[]): ChatSource[] {
  const used = citedNumbers(answer)
  return sources.map((s) => ({ n: s.n, pageId: s.pageId, title: s.title, cited: used.has(s.n) }))
}

/** 저장된 출처(jsonb)를 읽는다 — 모양이 틀린 것은 버린다. */
export function readChatSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return []
  const out: ChatSource[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const s = item as Record<string, unknown>
    if (typeof s.n !== 'number' || !Number.isInteger(s.n) || typeof s.pageId !== 'string' || !UUID.test(s.pageId) || typeof s.title !== 'string') continue
    out.push({ n: s.n, pageId: s.pageId, title: s.title, cited: s.cited === true })
  }
  return out
}

// ── 화면에 보내는 모양 ────────────────────────────────────────────────

export type ChatSessionSummary = {
  readonly id: string
  readonly title: string
  readonly scope: ChatScope
  /** ISO. */
  readonly updatedAt: string
  /** 이 대화에서 고른 모델(AI-7) — null 은 자동(워크스페이스 기본). */
  readonly model: string | null
}

export type ChatMessageStatus = 'completed' | 'stopped' | 'failed'

/** 화면의 출처 칩 — 지금 그 사람이 볼 수 있는가(다시 열 때 다시 본다 · 볼 수 없으면 링크 없이). */
export type ChatSourceView = ChatSource & { readonly viewable: boolean }

export type ChatMessageView = {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  /** 사람의 말은 null. */
  readonly status: ChatMessageStatus | null
  readonly sources: readonly ChatSourceView[]
  /** AI 의 답을 쓴 모델(원장의 것 · AI-7) — 사람의 말 · 아직 모르면 없다. */
  readonly model?: string | null
}

export type ChatSessionView = ChatSessionSummary & {
  readonly messages: readonly ChatMessageView[]
  /** 범위가 페이지면 그 제목 — 지금 볼 수 없으면 null(화면은 워크스페이스 전체로 돌아간다). */
  readonly scopeTitle: string | null
}
