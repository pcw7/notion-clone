'use client'

/**
 * 마지막으로 앱을 연 사람을 이 기기에 적는다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ②) — 워크스페이스 레이아웃에 단다. 그리는 것은 없다.
 *
 * 오프라인 껍데기는 세션이 없으므로 이 id 로 그 사람이 내려받은 목록만 보인다(`lib/offline/offline-store.ts` 의 `meta`). 저장소 코드는
 * 효과 안에서 지연 로드한다 — 모든 화면의 첫 JS 를 늘리지 않는다. 실패는 조용히(앱은 그대로다).
 */

import { useEffect } from 'react'

export function OfflineUserMark({ userId }: { userId: string }) {
  useEffect(() => {
    void import('@/lib/offline/offline-store').then((m) => m.markSignedInUser(userId)).catch(() => undefined)
  }, [userId])
  return null
}
