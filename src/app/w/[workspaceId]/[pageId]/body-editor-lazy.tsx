'use client'

/**
 * 본문 편집기를 지연 로드한다(BX-1) — 피크가 그려질 때만 받는 청크다(서버 렌더는 그대로 한다). 데이터베이스 화면이 처음 받는 JS 가
 * 편집기 때문에 늘지 않게(`check:bundle` 예산 · `database-chart-lazy.tsx` 와 같은 방식).
 */

import dynamic from 'next/dynamic'

export const LazyBodyEditor = dynamic(() => import('./body-editor').then((m) => m.BodyEditor))
