/**
 * 버전 기록 화면의 글자 — 시각 · 고친 사람 (잔여 묶음 8d-2 · F-11-01 · 순수)
 *
 * F-11-01 *"각 항목은 날짜 · 시각 · 편집자"*. 시각은 그 버전이 담은 내용의 시각이다(`created_at` — 정본 §3.7 [보강] 버전 기록 ③).
 */

/** 시각 — 오늘이면 "오늘 오후 3:12", 올해면 "10월 3일 오후 3:12", 아니면 "2025년 10월 3일 오후 3:12". `timeZone` 은 검사가 고정한다. */
export function formatVersionTime(iso: string, now: Date = new Date(), timeZone?: string): string {
  const at = new Date(iso)
  const day = (d: Date) =>
    new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).format(d)
  const time = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone }).format(at)
  if (day(at) === day(now)) return `오늘 ${time}`
  const sameYear = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', timeZone }).format(at) ===
    new Intl.DateTimeFormat('ko-KR', { year: 'numeric', timeZone }).format(now)
  const date = new Intl.DateTimeFormat('ko-KR', { ...(sameYear ? {} : { year: 'numeric' }), month: 'long', day: 'numeric', timeZone }).format(at)
  return `${date} ${time}`
}

/** 이 이름보다 많으면 "외 N명"으로 접는다 — 목록의 한 줄이 넘치지 않게. */
export const MAX_EDITOR_NAMES = 3

/** 고친 사람 — "가 · 나 · 다 외 2명". 없으면(옮긴 내용 · 시스템) 빈 글이다. */
export function formatEditors(editors: readonly { readonly name: string }[]): string {
  const names = editors.map((e) => e.name || '이름 없음')
  if (names.length <= MAX_EDITOR_NAMES) return names.join(' · ')
  return `${names.slice(0, MAX_EDITOR_NAMES).join(' · ')} 외 ${names.length - MAX_EDITOR_NAMES}명`
}

/**
 * 버전이 생긴 까닭 — 복원이 남긴 것만 말한다(8d-3): "되돌리기 전" · "○○ 버전에서 되돌림". 출처는 **한 단계만** 말한다 — 출처의 출처를
 * 따라가지 않는다(F-11-02 *"표시는 1단계(v7 에서 복원됨)까지만"*). 출처가 목록에 없으면(보관 기간이 지났다) "지난 버전에서 되돌림".
 * 쉼 · 주기는 null — 목록의 보통 항목이다.
 */
export function formatVersionReason(
  version: { readonly reason: string; readonly restoredFrom: string | null },
  all: readonly { readonly id: string; readonly createdAt: string }[],
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  if (version.reason === 'pre_restore') return '되돌리기 전'
  if (version.reason !== 'restore') return null
  const from = all.find((v) => v.id === version.restoredFrom)
  return from === undefined ? '지난 버전에서 되돌림' : `${formatVersionTime(from.createdAt, now, timeZone)} 버전에서 되돌림`
}
