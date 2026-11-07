/**
 * 타임라인 레이아웃 (41번 트랙 TL-1 · F-04-07 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 TL-1] ① ② · 04-database-views.md F-04-07
 *
 * 날짜는 속성 하나다(`end_date_property_id` 는 두지 않는다 — 우리 날짜 값은 처음부터 기간을 품는다). 저장은 `view.configuration.timeline`
 * 한 키이고 그 안은 **세 키 모두** 늘 쓴다(CHECK `ck_view_timeline_layout` · 0128):
 *
 *   date_property_id  막대를 놓을 날짜 속성. 만들 때 · 타임라인으로 바꿀 때 첫 날짜 속성을 고른다(없으면 `date_required`)
 *   zoom              'day' | 'week' | 'month' | 'quarter' | 'year' — 한 화면의 눈금 · 기본 week
 *   show_table        왼쪽의 표를 그리는가 · 기본 참
 *
 * 스크롤 자리(04 `center_timestamp`)는 저장하지 않는다 — 보는 사람마다 다르다(처음 열면 오늘).
 */

import type { ValidationIssue } from '../contracts/rich-text.ts'

export const TIMELINE_ZOOMS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number]

/** 저장 모양. `date_property_id` 는 늘 있다(만들 때 고른다). */
export type TimelineLayout = {
  readonly date_property_id: string
  readonly zoom: TimelineZoom
  readonly show_table: boolean
}

/** 읽은 모양 — 날짜 속성이 없으면(저장 전 · 지워짐) null. */
export type LiveTimelineLayout = {
  readonly date_property_id: string | null
  readonly zoom: TimelineZoom
  readonly show_table: boolean
}

export const DEFAULT_TIMELINE_ZOOM: TimelineZoom = 'week'
export const DEFAULT_TIMELINE_SHOW_TABLE = true

/** 한 번에 묻는 창의 상한(일) — 2년, `year` 줌의 한 화면. 넘는 요청은 거부한다(전체 로드 금지 · 04). */
export const MAX_TIMELINE_SPAN_DAYS = 732

/** 한 창에서 읽는 행의 상한. 넘으면 `truncated`. */
export const MAX_TIMELINE_ROWS = 1000

const isZoom = (v: unknown): v is TimelineZoom => typeof v === 'string' && (TIMELINE_ZOOMS as readonly string[]).includes(v)

/** 저장된 `configuration` 에서 타임라인 레이아웃을 읽는다 — 없거나 모르는 값이면 기본값(날짜 속성은 null). 살아 있는지는 부르는 쪽이 본다. */
export function readTimelineLayout(configuration: unknown): LiveTimelineLayout {
  const c = (configuration as { timeline?: unknown } | null | undefined)?.timeline as Record<string, unknown> | undefined
  if (typeof c !== 'object' || c === null) {
    return { date_property_id: null, zoom: DEFAULT_TIMELINE_ZOOM, show_table: DEFAULT_TIMELINE_SHOW_TABLE }
  }
  return {
    date_property_id: typeof c.date_property_id === 'string' ? c.date_property_id : null,
    zoom: isZoom(c.zoom) ? c.zoom : DEFAULT_TIMELINE_ZOOM,
    show_table: typeof c.show_table === 'boolean' ? c.show_table : DEFAULT_TIMELINE_SHOW_TABLE,
  }
}

/** 바꿀 키만 — 모르는 키 · 값은 거부, 빈 객체도 거부. 날짜 속성은 이 표의 살아 있는 날짜 속성이어야 한다(타입 맵). */
export function validateTimelinePatch(raw: unknown, types: ReadonlyMap<string, string>): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [{ path: 'timeline', message: '객체여야 합니다' }]
  const c = raw as Record<string, unknown>
  const keys = Object.keys(c)
  if (keys.length === 0) return [{ path: 'timeline', message: '바꿀 것이 없습니다' }]
  const issues: ValidationIssue[] = []
  for (const key of keys) {
    if (key === 'date_property_id') {
      if (typeof c.date_property_id !== 'string' || types.get(c.date_property_id) !== 'date') {
        issues.push({ path: 'timeline.date_property_id', message: '이 표의 날짜 속성이어야 합니다' })
      }
    } else if (key === 'zoom') {
      if (!isZoom(c.zoom)) issues.push({ path: 'timeline.zoom', message: `${TIMELINE_ZOOMS.join(' · ')} 중 하나여야 합니다` })
    } else if (key === 'show_table') {
      if (typeof c.show_table !== 'boolean') issues.push({ path: 'timeline.show_table', message: 'true 또는 false 여야 합니다' })
    } else {
      issues.push({ path: `timeline.${key}`, message: '모르는 키입니다' })
    }
  }
  return issues
}

/** 지금 레이아웃 위에 바꾸려는 키만 얹는다. `validateTimelinePatch` 를 지난 값만. 날짜 속성은 호출자가 고른 것을 넘긴다. */
export function mergeTimelineLayout(current: LiveTimelineLayout, patch: Partial<TimelineLayout>): LiveTimelineLayout {
  return {
    date_property_id: patch.date_property_id ?? current.date_property_id,
    zoom: patch.zoom ?? current.zoom,
    show_table: patch.show_table ?? current.show_table,
  }
}
