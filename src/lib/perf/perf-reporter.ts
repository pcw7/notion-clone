/**
 * 성능 계측 — 브라우저의 수집기 (플랫폼 잔여 10e-1b · F-12-18 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 성능 계측 ⑤
 *       12-platform-ux.md F-12-18 *"이벤트 전송 자체가 성능을 깎는 자기모순 → 버퍼링 + 샘플링"* · *"시작 이벤트와 완료 이벤트를 짝으로 세고
 *       미완료율을 함께 본다"*
 *
 * 규칙만 둔다 — 보내는 길(`sendBeacon`)과 시각(`performance.now()`)은 화면이 넘긴다(검사가 부를 수 있게).
 *
 *   · **표본은 페이지 읽기마다 한 번** 정한다 — 뽑히지 않았으면 아무것도 모으지 않는다. 비율은 측정값마다 싣는다(되돌리기)
 *   · 모아 두었다가 20개가 차면 · 화면을 떠날 때 보낸다
 *   · `editor_ready` 는 **문서를 처음 읽은 뒤의 첫 편집기**만 — 값은 읽기를 시작한 때부터 쓸 수 있게 되기까지(`performance.now()`). 그 전에
 *     화면을 떠나면 `completed=false` 로 남긴다(생존자 편향 — 느린 것이 사라지지 않게). 화면 안에서 옮겨 간 뒤의 편집기는 재지 않는다
 */

import { MAX_PERF_BATCH, PERF_METRICS, PERF_NAVIGATIONS, routeTemplate } from './perf-events.ts'

/** 기본 표본 비율 — 12 *"처음부터 10~20%"*. */
export const DEFAULT_PERF_SAMPLE_RATE = 0.2

/** 설정의 표본 비율 — 0 이면 끈다 · 모르는 값은 기본 · 1 을 넘지 않는다. */
export function normalizeSampleRate(raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isFinite(value) || value < 0) return DEFAULT_PERF_SAMPLE_RATE
  return Math.min(value, 1)
}

export type OutgoingPerfEvent = {
  readonly metric: string
  readonly value: number
  readonly route: string
  readonly navigation: string | null
  readonly completed: boolean
  readonly sampleRate: number
}

export type PerfReporter = {
  /** 이 페이지 읽기가 표본에 들었는가. */
  readonly sampled: boolean
  /** 측정값 하나 — 모르는 지표는 버린다. */
  record(metric: string, value: number, pathname: string, completed?: boolean): void
  /** 본문 편집기가 서기 시작했다(첫 편집기만 뜻이 있다). */
  editorStarted(): void
  /** 본문 편집기를 쓸 수 있게 됐다 — `now` 는 읽기를 시작한 때부터의 밀리초. */
  editorReady(now: number, pathname: string): void
  /** 화면을 떠난다 — 끝나지 않은 편집기 측정을 남기고 보낸다. */
  pageHidden(now: number, pathname: string): void
  flush(): void
}

export function createPerfReporter(options: {
  readonly sampleRate: number
  readonly random: () => number
  readonly navigation: string | null
  readonly send: (events: OutgoingPerfEvent[]) => void
}): PerfReporter {
  const sampleRate = options.sampleRate
  const sampled = sampleRate > 0 && options.random() < sampleRate
  const navigation = options.navigation !== null && (PERF_NAVIGATIONS as readonly string[]).includes(options.navigation) ? options.navigation : null
  let buffer: OutgoingPerfEvent[] = []
  let editor: 'idle' | 'pending' | 'done' = 'idle'

  const flush = () => {
    if (buffer.length === 0) return
    const out = buffer
    buffer = []
    options.send(out)
  }

  const record = (metric: string, value: number, pathname: string, completed = true) => {
    if (!sampled || !(PERF_METRICS as readonly string[]).includes(metric) || !Number.isFinite(value) || value < 0) return
    buffer.push({ metric, value, route: routeTemplate(pathname), navigation, completed, sampleRate })
    if (buffer.length >= MAX_PERF_BATCH) flush()
  }

  return {
    sampled,
    record,
    editorStarted: () => {
      if (editor === 'idle') editor = 'pending'
    },
    editorReady: (now, pathname) => {
      if (editor === 'done') return
      editor = 'done'
      record('editor_ready', now, pathname, true)
    },
    pageHidden: (now, pathname) => {
      if (editor === 'pending') {
        editor = 'done'
        record('editor_ready', now, pathname, false)
      }
      flush()
    },
    flush,
  }
}
