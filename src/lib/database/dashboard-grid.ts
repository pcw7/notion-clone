/**
 * 대시보드의 격자 — DB-2 (F-04-20 · 순수: DB 를 읽지 않는다)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ③ ④
 *
 * 읽은 배치(`readDashboard` 의 `layout`)와 위젯 목록을 그릴 줄로 바꾼다 — 줄마다 높이(px)와 칸(위젯)들. 한 줄의 칸은 폭을 똑같이 나눈다(좁은
 * 화면에서 세로로 쌓는 것은 CSS 의 일이다). 위젯 목록에 없는 칸(사라진 위젯)은 뺀다. 배치에 없는 위젯(저장된 배치가 깨져 빈 배치로 읽혔다 등)은
 * 숨기지 않고 끝의 줄에 4개씩 세운다 — 있는 위젯이 화면에서 사라지면 지울 길도 없다.
 *
 * 위젯은 서버가 따로 읽는다(위젯마다 그 뷰의 보통 읽기). 한꺼번에 읽으면 대시보드 하나가 연결 풀을 다 쓴다 — `createGate` 로 동시에 읽는 위젯
 * 수를 묶고 기다린 차례(배치의 위 줄부터)대로 들인다.
 */

import {
  DASHBOARD_HEIGHT_PX,
  DEFAULT_DASHBOARD_HEIGHT,
  MAX_DASHBOARD_CELLS_PER_ROW,
  type DashboardHeight,
  type DashboardLayout,
} from './dashboard-layout.ts'

/** 위젯이 그리는 행 수 — 정본 ④ "위젯당 처음 25줄"(표 · 목록 · 갤러리. 보드 · 캘린더 · 타임라인 · 차트 · 지도는 그 뷰의 보통 모양). */
export const WIDGET_ROW_LIMIT = 25
/** 한 대시보드에서 동시에 읽는 위젯 수 — 연결 풀(기본 10)을 혼자 쓰지 않게. */
export const WIDGET_READ_CONCURRENCY = 3
/** 위젯 틀이 줄 높이에서 가져가는 몫(머리 · 몸의 여백 · 테두리) — 칸에 맞춰 그리는 것(지도)의 높이를 여기서 뺀다. */
export const WIDGET_CHROME_PX = 60

/** 칸에 맞춰 그리는 위젯 몸의 높이(px) — 줄 높이에서 틀을 뺀 것(너무 작아지지 않게). */
export function widgetBodyPx(rowPx: number): number {
  return Math.max(120, rowPx - WIDGET_CHROME_PX)
}

export type DashboardGridRow<W> = {
  readonly height: DashboardHeight
  readonly heightPx: number
  readonly cells: readonly W[]
}

/** 배치 + 위젯 목록 → 그릴 줄. 배치의 차례를 따르고, 배치에 없는 위젯은 끝에 4개씩 보통 높이로. */
export function dashboardGrid<W extends { readonly id: string }>(layout: DashboardLayout, widgets: readonly W[]): DashboardGridRow<W>[] {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]))
  const placed = new Set<string>()
  const rows: DashboardGridRow<W>[] = []
  for (const row of layout.rows) {
    const cells: W[] = []
    for (const cell of row.cells) {
      const widget = byId.get(cell.view_id)
      if (widget === undefined || placed.has(widget.id)) continue
      placed.add(widget.id)
      cells.push(widget)
    }
    if (cells.length > 0) rows.push({ height: row.height, heightPx: DASHBOARD_HEIGHT_PX[row.height], cells })
  }
  const unplaced = widgets.filter((widget) => !placed.has(widget.id))
  for (let i = 0; i < unplaced.length; i += MAX_DASHBOARD_CELLS_PER_ROW) {
    rows.push({
      height: DEFAULT_DASHBOARD_HEIGHT,
      heightPx: DASHBOARD_HEIGHT_PX[DEFAULT_DASHBOARD_HEIGHT],
      cells: unplaced.slice(i, i + MAX_DASHBOARD_CELLS_PER_ROW),
    })
  }
  return rows
}

export type Gate = {
  /** 자리가 나면 풀린다 — 받은 `release` 를 끝날 때 부른다(두 번 불러도 한 번이다). */
  acquire(): Promise<() => void>
}

/** 동시에 도는 일을 `limit` 개(1 이상)로 묶는다 — 먼저 기다린 것부터 들인다. */
export function createGate(limit: number): Gate {
  const max = Math.max(1, Math.floor(limit))
  let running = 0
  const waiting: (() => void)[] = []
  const grant = (resolve: (release: () => void) => void): void => {
    running += 1
    let released = false
    resolve(() => {
      if (released) return
      released = true
      running -= 1
      waiting.shift()?.()
    })
  }
  return {
    acquire: () =>
      new Promise((resolve) => {
        if (running < max) grant(resolve)
        else waiting.push(() => grant(resolve))
      }),
  }
}
