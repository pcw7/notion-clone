'use client'

/**
 * 지도를 지연 로드한다(MP-2) — 지도 뷰를 그릴 때만 받는 청크다. Leaflet 은 불러올 때 `window` 를 만지므로 서버 렌더는 하지 않는다(`ssr: false`).
 * 표 · 보드 · 행 페이지의 인라인 데이터베이스가 처음 받는 JS 가 지도 때문에 늘지 않게(`check:bundle` 예산 · `database-chart-lazy.tsx` 와 같은 방식).
 */

import dynamic from 'next/dynamic'

export const DatabaseMap = dynamic(() => import('./database-map').then((m) => m.DatabaseMap), {
  ssr: false,
  loading: () => <div aria-hidden className="h-24" />,
})
