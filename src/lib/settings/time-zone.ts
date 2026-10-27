/**
 * 보는 사람의 시간대 — 쿠키 하나 (그룹 버킷 트랙 B-3 · 정본 §3.6 [보강] `view.group_by` 의 [보강 B-3] ①)
 *
 * 상대 날짜 그룹(오늘 · 어제 · 지난 7일 …)의 "오늘"은 보는 사람의 것이다. 서버 렌더는 브라우저의 시간대를 모르므로 브라우저가 자기 IANA
 * 시간대를 쿠키로 알린다(`time-zone-cookie.tsx` — 워크스페이스 화면에 들어올 때마다). 접근성 설정(`device-preferences.ts`)처럼 기기의 것이다 —
 * 계정 설정이 아니다(출장지에서는 그곳의 오늘). 이 모듈은 브라우저 · 서버가 함께 읽는다(DOM · next/headers 없음).
 */

export const TIME_ZONE_COOKIE = 'nc_tz'
/** 쿠키의 수명 — 기기 설정과 같다(400일 · 브라우저의 상한). */
const MAX_AGE = 60 * 60 * 24 * 400
/** IANA 이름의 느슨한 모양(`Asia/Seoul` · `America/Argentina/Buenos_Aires` · `UTC`) — 진짜인지는 `Intl` 이 본다. */
const SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

/** 쓸 수 있는 시간대면 그것, 아니면 UTC. */
export function normalizeTimeZone(raw: string | undefined | null): string {
  if (typeof raw !== 'string' || raw.length > 64 || !SHAPE.test(raw)) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw })
    return raw
  } catch {
    return 'UTC'
  }
}

/** 브라우저가 쓰는 쿠키 한 줄. */
export function timeZoneCookie(timeZone: string): string {
  return `${TIME_ZONE_COOKIE}=${encodeURIComponent(normalizeTimeZone(timeZone))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`
}

/** `document.cookie` 에서 지금 값 — 없으면 null. */
export function timeZoneFromCookieHeader(header: string): string | null {
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === TIME_ZONE_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='))
      } catch {
        return null
      }
    }
  }
  return null
}
