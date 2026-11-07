'use client'

/**
 * 타임라인을 지연 로드한다(TL-2) — 타임라인 뷰를 그릴 때만 받는 청크다(서버 렌더는 그대로 한다). 데이터베이스 화면이 처음 받는 JS 가
 * 타임라인 때문에 늘지 않게(`check:bundle` 예산 · `database-chart-lazy.tsx` 와 같은 방식).
 */

import dynamic from 'next/dynamic'

export const DatabaseTimeline = dynamic(() => import('./database-timeline').then((m) => m.DatabaseTimeline))
