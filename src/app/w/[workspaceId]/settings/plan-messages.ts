/**
 * 요금제 절의 문구 — 잔여 묶음 8k-3 (F-13-18 · DOM · DB 없음)
 *
 * 값은 서버가 준다(`planOverview` — 엔타이틀먼트 표 그대로). 여기는 **키의 이름과 값을 읽는 말**만 정한다 — 요금제마다 무엇이 다른지를
 * 코드에 적지 않는다(PE1). 모르는 키 · 모양이 아닌 값은 그대로 보인다(표에 키가 더해져도 화면이 깨지지 않게).
 */

import type { EntitlementKey } from '@/lib/billing/entitlement'

/** 비교 표의 줄 이름. */
export function entitlementLabel(key: EntitlementKey | string): string {
  switch (key) {
    case 'history.days':
      return '버전 기록 보존'
    case 'guests.max':
      return '게스트'
    case 'teamspace.private':
      return 'private teamspace'
    default:
      return key
  }
}

/** 값을 읽는 말 — null 은 무제한. */
export function formatEntitlement(key: EntitlementKey | string, value: unknown): string {
  if (typeof value === 'boolean') return value ? '쓸 수 있음' : '—'
  if (value === null) return '무제한'
  if (typeof value === 'number') {
    if (key === 'history.days') return `${value}일`
    if (key === 'guests.max') return `${value}명`
    return String(value)
  }
  return JSON.stringify(value)
}

/** 가격 — 0 은 무료 · null 은 문의 · 연 결제의 월 환산액을 함께. */
export function formatPrice(monthly: number | null, annual: number | null, currency: string | null): string {
  if (monthly === null) return '문의'
  if (monthly === 0) return '무료'
  const money = (n: number) => (currency === 'KRW' ? `₩${n.toLocaleString('ko-KR')}` : `${n.toLocaleString('ko-KR')} ${currency ?? ''}`.trim())
  return annual !== null && annual !== monthly ? `월 ${money(monthly)} (연 결제 시 월 ${money(annual)})` : `월 ${money(monthly)}`
}

/** 쓴 양 — 게스트 몇 자리 중 몇(무제한이면 수만). */
export function guestUsageLine(used: number, limit: unknown): string {
  return typeof limit === 'number' ? `게스트 ${used} / ${limit}명` : `게스트 ${used}명 (무제한)`
}

/** 요금제는 이 화면에서 바꾸지 않는다 — 운영자가 정한다(결제 연동 없음). */
export const PLAN_CHANGE_NOTE = '요금제는 운영자가 정합니다. 바꾸려면 운영자에게 요청하세요.'
