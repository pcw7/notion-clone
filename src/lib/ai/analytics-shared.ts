/**
 * AI 사용량 분석 — 서버와 화면이 함께 쓰는 모양 · 날 묶기 · 쌓기 · 커서 (AI-7 · F-10-25 · 순수 · DB · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫
 *
 * 날은 **UTC 달력 날**이다(셈의 달 · 하루 상한과 같다 — 보는 사람의 시간대로 다시 묶지 않는다). "응답" 은 실패를 뺀 것(셈과 같다).
 */

import { AI_FEATURES, utcDayOf, type AiFeature, type AiQuotaView } from './quota.ts'

/** 지난 며칠을 그리는가 — 오늘이 끝. */
export const AI_USAGE_DAYS = 30
/** 활동 기록 한 쪽. */
export const AI_LOG_PAGE = 50

export const AI_FEATURE_LABEL: Readonly<Record<AiFeature, string>> = {
  ask: '묻기',
  edit: '고치기',
  translate: '번역',
  block: 'AI 블록',
  chat: '채팅',
}

export type AiUsageStatus = 'reserved' | 'completed' | 'stopped' | 'failed'

export const AI_STATUS_LABEL: Readonly<Record<AiUsageStatus, string>> = {
  reserved: '진행 중',
  completed: '완료',
  stopped: '멈춤',
  failed: '실패',
}

// ── 화면에 보내는 모양 ────────────────────────────────────────────────

export type AiUsageTotals = { readonly responses: number; readonly failed: number; readonly inputTokens: number; readonly outputTokens: number }

export type AiUsageMemberRow = {
  readonly userId: string
  readonly name: string
  readonly responses: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** 이번 달의 마지막 응답(ISO) — 없으면 null. */
  readonly lastUsedAt: string | null
}

export type AiUsageFeatureRow = { readonly feature: AiFeature; readonly responses: number; readonly inputTokens: number; readonly outputTokens: number }
export type AiUsageModelRow = { readonly model: string; readonly responses: number; readonly inputTokens: number; readonly outputTokens: number }

export type AiDailySeries = {
  /** UTC 날(`YYYY-MM-DD`) — 오래된 것부터 · 오늘이 끝. */
  readonly days: readonly string[]
  /** 기능마다 날마다 응답 수(쌓는 차례는 `AI_FEATURES`). */
  readonly byFeature: Readonly<Record<AiFeature, readonly number[]>>
  /** 날마다 합. */
  readonly totals: readonly number[]
}

export type AiUsageOverview = {
  /** 워크스페이스 전체(소유자 · 멤버 관리자) · 자기 것만(다른 멤버). */
  readonly scope: 'workspace' | 'self'
  /** 이번 UTC 달의 시작(ISO). */
  readonly monthStart: string
  /** 이번 기간의 쓴 양 · 한도(AI-1 의 것 — 워크스페이스의 몫). */
  readonly quota: AiQuotaView
  readonly month: AiUsageTotals
  readonly daily: AiDailySeries
  readonly members: readonly AiUsageMemberRow[]
  readonly features: readonly AiUsageFeatureRow[]
  readonly models: readonly AiUsageModelRow[]
  /** 기록을 거를 사람(쓴 적이 있는 사람 · 자기 것만이면 자기). */
  readonly people: readonly { readonly id: string; readonly name: string }[]
}

export type AiUsageLogPageRef = { readonly kind: 'page'; readonly id: string; readonly title: string } | { readonly kind: 'hidden' }

export type AiUsageLogEntry = {
  readonly id: string
  /** ISO. */
  readonly at: string
  readonly user: { readonly id: string; readonly name: string }
  readonly feature: AiFeature
  readonly model: string
  readonly status: AiUsageStatus
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  /** 그 응답의 페이지 — 보는 사람이 지금 볼 수 있으면 제목 · 아니면 `hidden` · 페이지 없이 물었으면 null. */
  readonly page: AiUsageLogPageRef | null
}

export type AiUsageLogPage = { readonly entries: readonly AiUsageLogEntry[]; readonly nextCursor: string | null }

// ── 날 ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

/** 지난 n 일의 UTC 날 — 오래된 것부터 · 오늘(UTC)이 끝. */
export function utcDaysEnding(now: Date, n: number = AI_USAGE_DAYS): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: n }, (_, i) => utcDayOf(new Date(today - (n - 1 - i) * DAY_MS)))
}

/**
 * 날 · 기능마다 센 줄(DB 의 묶음) → 기능마다 쌓을 열. 범위 밖의 날 · 모르는 기능 · 음수는 버린다. 같은 칸이 두 번 오면 더한다.
 */
export function dailySeries(rows: readonly { readonly day: string; readonly feature: string; readonly responses: number }[], now: Date, n: number = AI_USAGE_DAYS): AiDailySeries {
  const days = utcDaysEnding(now, n)
  const at = new Map(days.map((d, i) => [d, i]))
  const byFeature = Object.fromEntries(AI_FEATURES.map((f) => [f, new Array<number>(n).fill(0)])) as Record<AiFeature, number[]>
  for (const r of rows) {
    const i = at.get(r.day)
    if (i === undefined || !(AI_FEATURES as readonly string[]).includes(r.feature) || !(r.responses > 0)) continue
    byFeature[r.feature as AiFeature][i]! += r.responses
  }
  const totals = days.map((_, i) => AI_FEATURES.reduce((sum, f) => sum + byFeature[f][i]!, 0))
  return { days, byFeature, totals }
}

export type StackSegment = { readonly feature: AiFeature; readonly value: number; readonly from: number; readonly to: number }

/** 그 날의 막대 — 기능 차례로 아래에서 위로 쌓은 조각(0 인 기능은 뺀다). */
export function stackDay(series: AiDailySeries, index: number): StackSegment[] {
  let pos = 0
  const out: StackSegment[] = []
  for (const feature of AI_FEATURES) {
    const value = series.byFeature[feature][index] ?? 0
    if (value <= 0) continue
    out.push({ feature, value, from: pos, to: pos + value })
    pos += value
  }
  return out
}

// ── 활동 기록의 커서 ──────────────────────────────────────────────────

const CURSOR = /^(\d{1,17})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/**
 * 커서 — 마지막 줄의 `(created_at 의 epoch 마이크로초, id)`. 마이크로초는 글로 둔다(DB 의 시각은 마이크로초다 — 밀리초로 접으면 같은
 * 밀리초의 줄을 건너뛰거나 두 번 준다).
 */
export function encodeLogCursor(micros: string, id: string): string {
  return `${micros}_${id.toLowerCase()}`
}

/** 커서를 읽는다 — 모양이 틀리면 null. */
export function decodeLogCursor(raw: unknown): { readonly micros: string; readonly id: string } | null {
  if (typeof raw !== 'string') return null
  const m = CURSOR.exec(raw.trim().toLowerCase())
  return m === null ? null : { micros: m[1]!, id: m[2]! }
}

// ── 글 ────────────────────────────────────────────────────────────────

/** 수 — 천 단위 쉼표. */
export const countText = (n: number): string => n.toLocaleString('ko-KR')

/** 짧은 날 — `11/22`(UTC 날 글에서). */
export const shortDay = (day: string): string => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
