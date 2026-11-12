'use client'

/**
 * 서비스 워커 등록 (OF-1 · F-12-04 · 정본 §3.7 [보강 OF-1] ①) — 루트 레이아웃에 단다. 그리는 것은 없다.
 *
 * 운영 빌드에서만 — 개발 서버의 청크는 이름에 해시가 없어 먼저 캐시하면 고친 코드가 안 보인다. 지원하지 않는 브라우저면 그냥 지나가고
 * 실패는 조용히(콘솔만) — 워커가 없어도 앱은 그대로 돈다(오프라인 껍데기만 없다). 규칙 · 갱신은 `public/sw.js` 머리.
 */

import { useEffect } from 'react'

export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    // updateViaCache 'none' — 워커 파일의 갱신을 HTTP 캐시를 거치지 않고 묻는다
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch((error: unknown) => {
      console.warn('서비스 워커를 등록하지 못했다', error)
    })
  }, [])
  return null
}
