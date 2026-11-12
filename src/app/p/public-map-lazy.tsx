'use client'

/**
 * 공개 지도를 지연 로드한다(MP-3) — 지도를 그릴 때만 받는 청크다. Leaflet 은 불러올 때 `window` 를 만지므로 서버 렌더는 하지 않는다(`ssr: false`).
 * 공개 페이지가 처음 받는 JS 가 지도 때문에 늘지 않게(`check:bundle` 예산 · 앱의 `database-map-lazy.tsx` 와 같은 방식).
 */

import dynamic from 'next/dynamic'

export const PublicMap = dynamic(() => import('./public-map').then((m) => m.PublicMap), {
  ssr: false,
  loading: () => <div aria-hidden className="h-24" />,
})
