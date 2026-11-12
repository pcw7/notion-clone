/**
 * 대시보드의 배치 — DB-1 (F-04-20 · 순수: DB 를 읽지 않는다)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ③
 *
 * `dashboard_layout = { rows: [{ height, cells: [{ view_id }] }] }` — 줄 3개까지 · 줄마다 칸 4개까지 · 모두 12개 · 한 줄의 칸은 폭을 똑같이 나눈다.
 * `height` 는 small · medium · large(320 · 480 · 640 px). 모양의 정본은 0143 의 CHECK(`dashboard_layout_valid`)이고 이것은 같은 규칙을 코드로 옮긴
 * 것이다 — 명령이 DB 에 닿기 전에 `issues` 로 말해 주려고. 칸이 그 대시보드의 위젯인지는 DB 를 봐야 해서 명령이 본다.
 */

import type { ValidationIssue } from '../contracts/rich-text.ts'

export const MAX_DASHBOARD_ROWS = 3
export const MAX_DASHBOARD_CELLS_PER_ROW = 4
export const MAX_DASHBOARD_WIDGETS = MAX_DASHBOARD_ROWS * MAX_DASHBOARD_CELLS_PER_ROW

export const DASHBOARD_HEIGHTS = ['small', 'medium', 'large'] as const
export type DashboardHeight = (typeof DASHBOARD_HEIGHTS)[number]
/** 줄 높이(px) — 그리는 쪽이 쓴다. */
export const DASHBOARD_HEIGHT_PX: Readonly<Record<DashboardHeight, number>> = { small: 320, medium: 480, large: 640 }
export const DEFAULT_DASHBOARD_HEIGHT: DashboardHeight = 'medium'

export type DashboardCell = { readonly view_id: string }
export type DashboardRow = { readonly height: DashboardHeight; readonly cells: readonly DashboardCell[] }
export type DashboardLayout = { readonly rows: readonly DashboardRow[] }

export const EMPTY_DASHBOARD_LAYOUT: DashboardLayout = { rows: [] }

/** 위젯이 될 수 있는 뷰 타입 — 0143 의 `ck_view_widget_type` 과 같다(폼 · 대시보드는 안 된다 — 중첩 금지). */
export const WIDGET_VIEW_TYPES = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart', 'map'] as const
export type WidgetViewType = (typeof WIDGET_VIEW_TYPES)[number]
export function isWidgetViewType(value: unknown): value is WidgetViewType {
  return typeof value === 'string' && (WIDGET_VIEW_TYPES as readonly string[]).includes(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isHeight = (v: unknown): v is DashboardHeight => typeof v === 'string' && (DASHBOARD_HEIGHTS as readonly string[]).includes(v)

/** 받은 배치를 엄격하게 검사한다(쓰기 경로) — 모양이 틀리면 어디인지 말한다. 같은 id 는 한 번만. */
export function validateLayout(raw: unknown): { readonly ok: true; readonly layout: DashboardLayout } | { readonly ok: false; readonly issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  if (!isObject(raw) || Object.keys(raw).some((k) => k !== 'rows') || !Array.isArray(raw.rows)) {
    return { ok: false, issues: [{ path: 'layout', message: '{ rows: [...] } 모양이어야 합니다' }] }
  }
  if (raw.rows.length > MAX_DASHBOARD_ROWS) issues.push({ path: 'layout.rows', message: `줄은 ${MAX_DASHBOARD_ROWS}개까지입니다` })
  const seen = new Set<string>()
  const rows: DashboardRow[] = []
  raw.rows.forEach((row: unknown, r: number) => {
    const at = `layout.rows[${r}]`
    if (!isObject(row) || Object.keys(row).some((k) => k !== 'height' && k !== 'cells')) {
      issues.push({ path: at, message: '{ height, cells } 모양이어야 합니다' })
      return
    }
    if (!isHeight(row.height)) issues.push({ path: `${at}.height`, message: 'small · medium · large 중 하나여야 합니다' })
    if (!Array.isArray(row.cells) || row.cells.length < 1 || row.cells.length > MAX_DASHBOARD_CELLS_PER_ROW) {
      issues.push({ path: `${at}.cells`, message: `줄마다 위젯은 1~${MAX_DASHBOARD_CELLS_PER_ROW}개입니다` })
      return
    }
    const cells: DashboardCell[] = []
    row.cells.forEach((cell: unknown, c: number) => {
      const cat = `${at}.cells[${c}]`
      if (!isObject(cell) || Object.keys(cell).some((k) => k !== 'view_id') || typeof cell.view_id !== 'string' || !UUID.test(cell.view_id)) {
        issues.push({ path: cat, message: '{ view_id } 모양이어야 합니다' })
        return
      }
      if (seen.has(cell.view_id)) issues.push({ path: `${cat}.view_id`, message: '같은 위젯이 두 번 있습니다' })
      seen.add(cell.view_id)
      cells.push({ view_id: cell.view_id })
    })
    if (isHeight(row.height)) rows.push({ height: row.height, cells })
  })
  return issues.length > 0 ? { ok: false, issues } : { ok: true, layout: { rows } }
}

/** 저장된 배치를 읽는다(읽기 경로) — 모양이 틀리면 빈 배치. 읽기에서 거부하지 않는다(상한을 낮추는 날 기존 대시보드가 안 열리면 안 된다). */
export function readLayout(stored: unknown): DashboardLayout {
  const checked = validateLayout(stored)
  return checked.ok ? checked.layout : EMPTY_DASHBOARD_LAYOUT
}

export function layoutViewIds(layout: DashboardLayout): string[] {
  return layout.rows.flatMap((row) => row.cells.map((cell) => cell.view_id))
}

/** 살아 있는 위젯만 남기고 줄을 당긴다 · 빈 줄은 없앤다(소스가 떨어져 위젯이 사라진 칸 · 위젯 삭제). */
export function keepCells(layout: DashboardLayout, keep: (viewId: string) => boolean): DashboardLayout {
  const rows: DashboardRow[] = []
  for (const row of layout.rows) {
    const cells = row.cells.filter((cell) => keep(cell.view_id))
    if (cells.length > 0) rows.push({ height: row.height, cells })
  }
  return { rows }
}

export function removeCell(layout: DashboardLayout, viewId: string): DashboardLayout {
  return keepCells(layout, (id) => id !== viewId)
}

/**
 * 위젯 하나를 배치 끝에 넣는다.
 *   - `row`(0부터)가 있고 자리가 있으면 그 줄 · 있는데 가득 차면 새 줄(줄이 남았으면) · 없으면 null
 *   - `row` 가 없으면 새 줄(줄이 남았으면) · 줄이 다 찼으면 자리가 있는 마지막 줄 · 그것도 없으면 null (12개 · 3줄 소진 = `full`)
 */
export function placeWidget(layout: DashboardLayout, viewId: string, row?: number): DashboardLayout | null {
  if (layoutViewIds(layout).length >= MAX_DASHBOARD_WIDGETS) return null
  const cell: DashboardCell = { view_id: viewId }
  const addTo = (index: number): DashboardLayout => ({
    rows: layout.rows.map((r, i) => (i === index ? { height: r.height, cells: [...r.cells, cell] } : r)),
  })
  const newRow = (): DashboardLayout | null =>
    layout.rows.length < MAX_DASHBOARD_ROWS ? { rows: [...layout.rows, { height: DEFAULT_DASHBOARD_HEIGHT, cells: [cell] }] } : null

  if (row !== undefined) {
    const target = layout.rows[row]
    if (target !== undefined && target.cells.length < MAX_DASHBOARD_CELLS_PER_ROW) return addTo(row)
    return newRow()
  }
  const fresh = newRow()
  if (fresh !== null) return fresh
  for (let i = layout.rows.length - 1; i >= 0; i--) {
    if ((layout.rows[i]?.cells.length ?? MAX_DASHBOARD_CELLS_PER_ROW) < MAX_DASHBOARD_CELLS_PER_ROW) return addTo(i)
  }
  return null
}
