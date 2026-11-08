/**
 * 차트 레이아웃 — 종류 · 값 표시 · 누적 (38번 트랙 CH-1 · F-04-08 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 CH-1] ③ · 04-database-views.md F-04-08
 *
 * X축은 `view.group_by`, Y값은 `group_by.calculation`(없으면 개수)이다 — 차트만의 설정은 `view.configuration.chart` 한 키에 둔다
 * (갤러리와 같은 규칙: 다른 뷰 종류의 키와 섞이지 않게 · JSON 전체 교체 금지). 그 안은 **세 키 모두** 늘 쓴다.
 * 모양은 CHECK(`ck_view_chart_layout` · 0127)이 막는다.
 *
 *   kind         'column' 세로 막대 · 'bar' 가로 막대 · 'line' 선 · 'donut' 도넛 · 'number' 값 하나(CH-4 · 뷰의 모든 행의 계산)
 *   data_labels  막대 · 점 · 조각에 값을 적는다
 *   cumulative   앞 그룹까지의 값을 더해 간다(Y 가 개수/합이고 X 오름차순일 때만 그린다 — 그 밖에는 저장값만 둔다)
 */

import type { ValidationIssue } from '../contracts/rich-text.ts'

export const CHART_KINDS = ['column', 'bar', 'line', 'donut', 'number'] as const
export type ChartKind = (typeof CHART_KINDS)[number]

export type ChartLayout = {
  readonly kind: ChartKind
  readonly data_labels: boolean
  readonly cumulative: boolean
}

export const DEFAULT_CHART_LAYOUT: ChartLayout = { kind: 'column', data_labels: false, cumulative: false }

const isKind = (v: unknown): v is ChartKind => typeof v === 'string' && (CHART_KINDS as readonly string[]).includes(v)

/** 저장된 `configuration` 에서 차트 레이아웃을 읽는다 — 없거나 모르는 값이면 기본값(읽기 경로는 너그럽다). */
export function readChartLayout(configuration: unknown): ChartLayout {
  const c = (configuration as { chart?: unknown } | null | undefined)?.chart as Record<string, unknown> | undefined
  if (typeof c !== 'object' || c === null) return DEFAULT_CHART_LAYOUT
  return {
    kind: isKind(c.kind) ? c.kind : DEFAULT_CHART_LAYOUT.kind,
    data_labels: typeof c.data_labels === 'boolean' ? c.data_labels : DEFAULT_CHART_LAYOUT.data_labels,
    cumulative: typeof c.cumulative === 'boolean' ? c.cumulative : DEFAULT_CHART_LAYOUT.cumulative,
  }
}

/** 바꾸려는 키만 보낸다(부분) — 모르는 키 · 모르는 값은 거부한다. 빈 객체도 거부한다(바꿀 것이 없다). */
export function validateChartPatch(raw: unknown): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [{ path: 'chart', message: '객체여야 합니다' }]
  const c = raw as Record<string, unknown>
  const keys = Object.keys(c)
  if (keys.length === 0) return [{ path: 'chart', message: '바꿀 것이 없습니다' }]
  const issues: ValidationIssue[] = []
  for (const key of keys) {
    if (key === 'kind') {
      if (!isKind(c.kind)) issues.push({ path: 'chart.kind', message: `${CHART_KINDS.join(' · ')} 중 하나여야 합니다` })
    } else if (key === 'data_labels') {
      if (typeof c.data_labels !== 'boolean') issues.push({ path: 'chart.data_labels', message: 'true 또는 false 여야 합니다' })
    } else if (key === 'cumulative') {
      if (typeof c.cumulative !== 'boolean') issues.push({ path: 'chart.cumulative', message: 'true 또는 false 여야 합니다' })
    } else {
      issues.push({ path: `chart.${key}`, message: '모르는 키입니다' })
    }
  }
  return issues
}

/** 지금 레이아웃 위에 바꾸려는 키만 얹는다. `validateChartPatch` 를 지난 값만. */
export function mergeChartLayout(current: ChartLayout, patch: Partial<ChartLayout>): ChartLayout {
  return {
    kind: patch.kind ?? current.kind,
    data_labels: patch.data_labels ?? current.data_labels,
    cumulative: patch.cumulative ?? current.cumulative,
  }
}
