'use client'

/**
 * AI 패널의 무거운 절을 지연 로드한다(AI-7) — 모델 설정 · 사용량 분석은 그 절을 그릴 때만 받는 청크다. 설정 화면이 처음 받는 JS 가 이것들
 * 때문에 늘지 않게(`check:bundle` 예산 — `database-chart-lazy.tsx` 와 같은 방식).
 */

import dynamic from 'next/dynamic'

const loading = (text: string) =>
  function Loading() {
    return <p className="text-xs text-neutral-500">{text}</p>
  }

export const AiModelsPanel = dynamic(() => import('./ai-models-panel').then((m) => m.AiModelsPanel), { loading: loading('모델 설정을 불러오는 중…') })
export const AiUsagePanel = dynamic(() => import('./ai-usage-panel').then((m) => m.AiUsagePanel), { loading: loading('사용량을 불러오는 중…') })
