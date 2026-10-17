'use client'

/**
 * 성능 계측 — 워크스페이스 화면의 수집기 (플랫폼 잔여 10e-1b · F-12-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 성능 계측 ⑤
 *
 * 규칙은 `perf-reporter.ts`(표본 · 모으기 · `editor_ready`)가 갖고, 여기는 브라우저의 길만 잇는다 — 웹 바이탈(`useReportWebVitals`) · 이동의
 * 종류(`PerformanceNavigationTiming`) · 시각(`performance.now()`) · 화면을 떠남(`visibilitychange` · `pagehide`) · 보내기(`sendBeacon`).
 * 수집기는 **이 문서(페이지 읽기)에 하나**다 — 화면 안에서 옮겨 가도 그대로다(표본 · 첫 편집기가 문서마다의 것이라).
 *
 * 본문 편집기가 수집기보다 먼저 신호를 보낼 수 있다(자식의 효과가 먼저 돈다) — 먼저 온 신호는 모아 두었다가 수집기가 서면 넘긴다.
 */

import { useEffect } from 'react'
import { useReportWebVitals } from 'next/web-vitals'

import { createPerfReporter, type PerfReporter as Reporter } from '@/lib/perf/perf-reporter'

let reporter: Reporter | null = null
let pendingStart = false
let pendingReady: number | null = null

function send(events: unknown[]): void {
  const body = JSON.stringify({ events })
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/perf', body)) return
  void fetch('/api/perf', { method: 'POST', body, keepalive: true }).catch(() => undefined)
}

/** 이 문서의 수집기 — 처음 부를 때 표본을 정한다. 먼저 온 편집기 신호를 넘긴다. */
function reporterFor(sampleRate: number): Reporter {
  if (reporter === null) {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    reporter = createPerfReporter({
      sampleRate,
      random: Math.random,
      navigation: entry?.type ? entry.type.replace('_', '-') : null,
      send,
    })
    if (pendingStart) reporter.editorStarted()
    if (pendingReady !== null) reporter.editorReady(pendingReady, location.pathname)
    pendingStart = false
    pendingReady = null
  }
  return reporter
}

/** 본문 편집기가 서기 시작했다(10e-1b). */
export function perfEditorStarted(): void {
  if (reporter !== null) reporter.editorStarted()
  else pendingStart = true
}

/** 본문 편집기를 쓸 수 있게 됐다 — 읽기를 시작한 때부터의 밀리초. 첫 편집기만 뜻이 있다(수집기가 거른다). */
export function perfEditorReady(): void {
  const now = performance.now()
  if (reporter !== null) reporter.editorReady(now, location.pathname)
  else if (pendingReady === null) pendingReady = now
}

/** 웹 바이탈 — 콜백은 바뀌지 않아야 한다(바뀌면 이미 받은 측정을 다시 받는다 · Next 문서). */
const onMetric = (metric: { name: string; value: number }): void => {
  reporter?.record(metric.name, metric.value, location.pathname)
}

export function PerfReporter({ sampleRate }: { sampleRate: number }) {
  // 수집기를 세우는 효과가 웹 바이탈의 효과보다 먼저 돈다(훅의 차례)
  useEffect(() => {
    const r = reporterFor(sampleRate)
    const leave = () => r.pageHidden(performance.now(), location.pathname)
    const hidden = () => {
      if (document.visibilityState === 'hidden') leave()
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', leave)
    }
  }, [sampleRate])
  useReportWebVitals(onMetric)
  return null
}
