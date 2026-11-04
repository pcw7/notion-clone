'use client'

/**
 * 차트를 지연 로드한다(CH-2) — 차트 뷰를 그릴 때만 받는 청크다(서버 렌더는 그대로 한다). 표 · 보드가 처음 받는 JS 가 차트 때문에 늘지 않게
 * (`check:bundle` 예산 — 클라이언트 컴포넌트 안의 `next/dynamic` 이 따로 나뉜 청크를 만든다 · `row-properties.tsx` 와 같은 방식).
 */

import dynamic from 'next/dynamic'

export const DatabaseChart = dynamic(() => import('./database-chart').then((m) => m.DatabaseChart))
