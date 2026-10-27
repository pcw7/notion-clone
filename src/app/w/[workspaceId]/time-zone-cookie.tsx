'use client'

/**
 * 이 기기의 시간대를 쿠키로 알린다 (그룹 버킷 트랙 B-3 · 정본 [보강 B-3] ①)
 *
 * 상대 날짜 그룹의 "오늘"은 보는 사람의 것이다 — 서버 렌더가 그것을 알게 브라우저의 IANA 시간대를 쿠키에 둔다. 바뀌었으면(처음 · 다른
 * 시간대로 옮겼다) 화면을 한 번 새로 받는다 — 그 전의 화면은 UTC(또는 옛 시간대)의 오늘로 그렸다. 아무것도 그리지 않는다.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { timeZoneCookie, timeZoneFromCookieHeader } from '@/lib/settings/time-zone'

export function TimeZoneCookie() {
  const router = useRouter()
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone || timeZoneFromCookieHeader(document.cookie) === zone) return
    document.cookie = timeZoneCookie(zone)
    router.refresh()
  }, [router])
  return null
}
