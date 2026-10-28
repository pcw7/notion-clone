'use client'

/**
 * 상대 날짜 필터의 오늘을 이 기기의 오늘에 맞춘다 (상대 날짜 필터 트랙 R-1 · 정본 [보강 R-1] ③)
 *
 * 서버 렌더는 쿠키의 시간대로 오늘을 셈해 걸렀다(`readViewerToday`). 쿠키가 처음이거나 시간대가 바뀌었으면 그 오늘이 이 기기의 오늘과 다를 수
 * 있다 — 그때 한 번 새로 받는다(상대 날짜 그룹 B-3 의 `useViewerToday` 그대로). 필터에 상대 날짜 규칙이 없으면 `today` 가 null 이라 아무것도
 * 하지 않는다.
 */

import { useViewerToday } from './use-viewer-today'

export function ViewerTodaySync({ today }: { today: string | null }) {
  useViewerToday(today)
  return null
}
