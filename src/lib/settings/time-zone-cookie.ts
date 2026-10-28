/**
 * 보는 사람의 오늘 — 요청의 쿠키에서 (그룹 버킷 트랙 B-3 · 정본 [보강 B-3] ①)
 *
 * 서버는 읽기만 한다(쓰는 것은 브라우저 — `time-zone.ts` 머리말). next/headers 의 cookies() 는 요청 컨텍스트 안에서만 동작한다 — 서버
 * 컴포넌트 · 라우트에서만 import 한다.
 */

import { cookies } from 'next/headers'

import { todayIn } from '../database/date-group.ts'
import { TIME_ZONE_COOKIE, normalizeTimeZone } from './time-zone.ts'

/** 보는 사람의 시간대의 오늘(`YYYY-MM-DD`) — 쿠키가 없거나 틀리면 UTC 의 오늘. */
/** 보는 사람의 시간대(A-1) — 쿠키의 이름(맞지 않으면 UTC). 자동화를 저장할 때 그 사람의 날로 조건을 판정하려고 적는다. */
export async function readViewerTimeZone(): Promise<string> {
  const jar = await cookies()
  const raw = jar.get(TIME_ZONE_COOKIE)?.value
  return normalizeTimeZone(raw === undefined ? undefined : safeDecode(raw))
}

export async function readViewerToday(): Promise<string> {
  const jar = await cookies()
  const raw = jar.get(TIME_ZONE_COOKIE)?.value
  return todayIn(normalizeTimeZone(raw === undefined ? undefined : safeDecode(raw)))
}

function safeDecode(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}
