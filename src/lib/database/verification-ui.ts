/**
 * 검증 화면의 순수 계산 — 기간 → 만료 시각 · 날짜의 끝 · 머리말 (VF-2 · F-03-23 · 정본 §3.5 [보강 VF-1] ④ ⑥ ⑦)
 *
 * 칸 고르개와 행 머리 배지가 함께 쓴다. DB 를 모른다(클라이언트가 값으로 쓴다).
 */

import { verificationTitle, type VerificationCell } from './verification-cell.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/** 프리셋 기간(일). */
export const VERIFY_PRESET_DAYS = [7, 30, 90] as const

/** 프리셋 — 지금 + N×24시간(ISO). */
export function presetExpiresAt(days: number, now: Date): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString()
}

/** `timeZone` 의 시각 `ts` 에서 UTC 와의 차(ms). */
function zoneOffsetMs(timeZone: string, ts: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts))
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second')) - Math.floor(ts / 1000) * 1000
}

/** 날짜(`YYYY-MM-DD`)를 보는 사람의 시간대로 그날의 끝(다음 날 0시 − 1ms)으로. 날짜가 아니면 null. */
export function endOfDayExpiresAt(date: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (m === null) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null
  try {
    const nextMidnight = Date.UTC(y, mo - 1, d + 1)
    // 오프셋을 두 번 맞춘다 — 서머타임이 넘는 날의 어긋남을 줄인다
    const first = nextMidnight - zoneOffsetMs(timeZone, nextMidnight)
    const second = nextMidnight - zoneOffsetMs(timeZone, first)
    return new Date(second - 1).toISOString()
  } catch {
    return null
  }
}

/** 행의 마지막 편집이 검증보다 뒤인가(⑦ "검증 뒤 고침"). */
export function editedAfterVerified(lastEditedAt: string, cell: Pick<VerificationCell, 'verified_at'>): boolean {
  return new Date(lastEditedAt).getTime() > new Date(cell.verified_at).getTime()
}

/** 행 머리 배지의 머리말 — 누가 · 언제 · 언제까지 (+ 검증 뒤 고쳤으면 "검증 뒤 고침"). */
export function verificationBadgeTitle(cell: VerificationCell, who: string, lastEditedAt: string): string {
  const base = verificationTitle(cell, who)
  return editedAfterVerified(lastEditedAt, cell) ? `${base} · 검증 뒤 고침` : base
}
