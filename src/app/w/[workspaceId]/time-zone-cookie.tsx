'use client'

/**
 * 이 기기의 시간대를 쿠키로 알린다 (그룹 버킷 트랙 B-3 · 정본 [보강 B-3] ①)
 *
 * 상대 날짜 그룹의 "오늘"은 보는 사람의 것이다 — 서버 렌더가 그것을 알게 브라우저의 IANA 시간대를 쿠키에 둔다. 쓰기만 한다 — 화면을 새로
 * 받는 것은 상대 날짜 그룹을 그린 화면이 서버의 오늘과 이 기기의 오늘이 다를 때만(`use-viewer-today.ts`). 모든 화면에서 새로 받으면 곧바로
 * 이어지는 이동이 그 요청을 끊어 서버가 "stream closed early" 를 남긴다. 아무것도 그리지 않는다.
 */

import { useEffect } from 'react'

import { timeZoneCookie, timeZoneFromCookieHeader } from '@/lib/settings/time-zone'

export function TimeZoneCookie() {
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone && timeZoneFromCookieHeader(document.cookie) !== zone) document.cookie = timeZoneCookie(zone)
  }, [])
  return null
}
