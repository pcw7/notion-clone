'use client'

/**
 * 상대 날짜 그룹의 오늘을 이 기기의 오늘에 맞춘다 (그룹 버킷 트랙 B-3 · 정본 [보강 B-3] ①)
 *
 * 서버는 쿠키의 시간대로 오늘을 셈한다(`readViewerToday`). 쿠키가 처음이거나(서버는 UTC 로 셈했다) 시간대가 바뀌었으면 서버의 오늘이 이 기기의
 * 오늘과 다를 수 있다 — 그때만 쿠키를 맞추고 화면을 한 번 새로 받는다. 자식의 효과가 부모(레이아웃의 `TimeZoneCookie`)보다 먼저 돌므로 쿠키도
 * 여기서 쓴다. 한 번만 — 쿠키가 막힌 브라우저에서 서버는 늘 UTC 라 계속 다르다.
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

import { todayIn } from '@/lib/database/date-group'
import { timeZoneCookie, timeZoneFromCookieHeader } from '@/lib/settings/time-zone'

/** `serverToday` — 그룹 결과가 실은 서버의 오늘(상대 날짜로 묶었을 때만 · 그 밖은 null 이라 아무것도 하지 않는다). */
export function useViewerToday(serverToday: string | null | undefined): void {
  const router = useRouter()
  const refreshed = useRef(false)
  useEffect(() => {
    if (!serverToday || refreshed.current) return
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return
    if (timeZoneFromCookieHeader(document.cookie) !== zone) document.cookie = timeZoneCookie(zone)
    if (todayIn(zone) === serverToday) return
    refreshed.current = true
    router.refresh()
  }, [serverToday, router])
}
