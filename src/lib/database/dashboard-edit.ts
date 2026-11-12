/**
 * 대시보드 편집의 규칙 — DB-3 (F-04-20 · 순수: DOM · DB 를 보지 않는다)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ③ ⑤
 *
 * 편집 모드의 옮기기(메뉴의 왼쪽 · 오른쪽 · 위 줄 · 아래 줄, 끌기)와 줄 높이를 배치 → 배치로 계산한다. 결과는 서버가 받는 모양 그대로다
 * (`updateDashboardLayout` — 위젯 전부를 담은 배치 하나 · 읽은 판의 `updatedAt` 과 함께). **할 수 없거나 제자리면 null** — 보내지 않는다.
 * 줄은 3개 · 줄마다 4개를 지키고, 비게 된 줄은 없앤다(서버의 `keepCells` 와 같은 규칙).
 *
 * 끌기는 화면이 줄 · 칸의 자리(`getBoundingClientRect`)와 포인터만 넘기고 여기서 놓을 자리를 정한다(`tab-drag.ts` 와 같은 나눔).
 */

import {
  MAX_DASHBOARD_CELLS_PER_ROW,
  MAX_DASHBOARD_ROWS,
  MAX_DASHBOARD_WIDGETS,
  layoutViewIds,
  type DashboardHeight,
  type DashboardLayout,
  type DashboardRow,
} from './dashboard-layout.ts'

export type MoveDirection = 'left' | 'right' | 'up' | 'down'

/** 놓을 자리 — 있는 줄의 몇째 칸(끌고 있는 위젯을 뺀 나머지에서 센다) · 또는 새 줄(그 자리에 끼운다 · 0 이면 맨 위). */
export type DropTarget = { readonly row: number; readonly index: number } | { readonly newRow: number }

/** 이만큼 움직여야 끌기다 — 그 전에 놓으면 손잡이를 누른 것뿐이다. */
export const DASHBOARD_DRAG_THRESHOLD = 4

/** 그리는 줄(`dashboardGrid`) → 배치. 서버가 그린 차례 그대로다(배치에 없던 위젯도 끝의 줄에 들어 있다 — 고치기는 위젯 전부를 담아야 한다). */
export function layoutOfGrid(rows: readonly { readonly height: DashboardHeight; readonly cells: readonly { readonly id: string }[] }[]): DashboardLayout {
  return { rows: rows.map((row) => ({ height: row.height, cells: row.cells.map((cell) => ({ view_id: cell.id })) })) }
}

/** 위젯을 하나 더 넣을 수 있는가 — 모두 12개 미만(줄 3 · 줄마다 4 이므로 그때는 자리가 어딘가 있다). */
export function canAddWidget(layout: DashboardLayout): boolean {
  return layoutViewIds(layout).length < MAX_DASHBOARD_WIDGETS
}

/** 그 줄에 자리가 있는가(4개 미만). */
export function rowHasRoom(layout: DashboardLayout, row: number): boolean {
  const target = layout.rows[row]
  return target !== undefined && target.cells.length < MAX_DASHBOARD_CELLS_PER_ROW
}

function locate(layout: DashboardLayout, viewId: string): { readonly row: number; readonly index: number } | null {
  for (let row = 0; row < layout.rows.length; row++) {
    const index = layout.rows[row]!.cells.findIndex((cell) => cell.view_id === viewId)
    if (index >= 0) return { row, index }
  }
  return null
}

/**
 * 위젯을 놓는다 — 같은 줄이면 차례만 · 다른 줄이면 그 줄에 자리가 있어야 한다 · 새 줄이면 줄이 3개를 넘지 않아야 한다(옮긴 뒤 비는 줄은
 * 없어지므로 그것을 빼고 센다). 새 줄의 높이는 위젯이 있던 줄의 것이다(크기가 그대로). 제자리 · 할 수 없으면 null.
 */
export function dropWidget(layout: DashboardLayout, viewId: string, target: DropTarget): DashboardLayout | null {
  const at = locate(layout, viewId)
  if (at === null) return null
  const source = layout.rows[at.row]!
  const cell = source.cells[at.index]!
  const sourceEmpties = source.cells.length === 1
  const without: (DashboardRow | null)[] = layout.rows.map((row, i) =>
    i === at.row ? (sourceEmpties ? null : { height: row.height, cells: row.cells.filter((c) => c.view_id !== viewId) }) : row,
  )
  const compact = (rows: readonly (DashboardRow | null)[]): DashboardLayout => ({ rows: rows.filter((row): row is DashboardRow => row !== null) })

  if ('newRow' in target) {
    if (!Number.isInteger(target.newRow) || target.newRow < 0 || target.newRow > layout.rows.length) return null
    // 혼자 있던 줄을 바로 위 · 아래의 새 줄로 — 제자리다
    if (sourceEmpties && (target.newRow === at.row || target.newRow === at.row + 1)) return null
    if (layout.rows.length - (sourceEmpties ? 1 : 0) >= MAX_DASHBOARD_ROWS) return null
    const fresh: DashboardRow = { height: source.height, cells: [cell] }
    return compact([...without.slice(0, target.newRow), fresh, ...without.slice(target.newRow)])
  }

  const dest = layout.rows[target.row]
  if (dest === undefined || !Number.isInteger(target.index) || target.index < 0) return null
  if (target.row === at.row) {
    const others = source.cells.filter((c) => c.view_id !== viewId)
    const index = Math.min(target.index, others.length)
    if (index === at.index) return null
    const cells = [...others.slice(0, index), cell, ...others.slice(index)]
    return { rows: layout.rows.map((row, i) => (i === at.row ? { height: row.height, cells } : row)) }
  }
  if (dest.cells.length >= MAX_DASHBOARD_CELLS_PER_ROW) return null
  const index = Math.min(target.index, dest.cells.length)
  const cells = [...dest.cells.slice(0, index), cell, ...dest.cells.slice(index)]
  return compact(without.map((row, i) => (i === target.row ? { height: dest.height, cells } : row)))
}

/**
 * 메뉴의 옮기기 — 왼쪽 · 오른쪽은 한 칸 · 위 줄 · 아래 줄은 같은 자리 근처(그 줄의 칸 수로 줄인다)에. 맨 위 · 맨 아래 줄에서 위 · 아래로는
 * 새 줄을 만든다(혼자 있는 위젯이면 제자리라 null). 가득 찬 줄로는 옮기지 않는다.
 */
export function moveTarget(layout: DashboardLayout, viewId: string, direction: MoveDirection): DropTarget | null {
  const at = locate(layout, viewId)
  if (at === null) return null
  const count = layout.rows[at.row]!.cells.length
  switch (direction) {
    case 'left':
      return at.index > 0 ? { row: at.row, index: at.index - 1 } : null
    case 'right':
      return at.index < count - 1 ? { row: at.row, index: at.index + 1 } : null
    case 'up': {
      if (at.row === 0) return { newRow: 0 }
      return { row: at.row - 1, index: Math.min(at.index, layout.rows[at.row - 1]!.cells.length) }
    }
    case 'down': {
      if (at.row === layout.rows.length - 1) return { newRow: layout.rows.length }
      return { row: at.row + 1, index: Math.min(at.index, layout.rows[at.row + 1]!.cells.length) }
    }
  }
}

/** 메뉴의 옮기기를 배치에 — 할 수 없으면 null(메뉴가 그 항목을 세우지 않는다). */
export function moveWidget(layout: DashboardLayout, viewId: string, direction: MoveDirection): DashboardLayout | null {
  const target = moveTarget(layout, viewId, direction)
  return target === null ? null : dropWidget(layout, viewId, target)
}

/** 줄 높이 — 그 줄이 없거나 같은 높이면 null. */
export function setRowHeight(layout: DashboardLayout, row: number, height: DashboardHeight): DashboardLayout | null {
  const target = layout.rows[row]
  if (target === undefined || target.height === height) return null
  return { rows: layout.rows.map((r, i) => (i === row ? { height, cells: r.cells } : r)) }
}

// ── 끌기 ──────────────────────────────────────────────────────────────

/** 칸 하나의 가로 자리 — 화면의 `getBoundingClientRect` 에서. */
export type CellBox = { readonly id: string; readonly left: number; readonly width: number }
/** 줄 하나의 세로 자리와 칸들(왼쪽부터). */
export type RowBox = { readonly top: number; readonly bottom: number; readonly cells: readonly CellBox[] }

/** 줄 안의 놓을 칸 — 끌고 있는 위젯을 뺀 나머지에서 가운데가 포인터보다 왼쪽인 칸의 수. */
export function dropIndex(cells: readonly CellBox[], draggedId: string, pointerX: number): number {
  return cells.filter((cell) => cell.id !== draggedId && cell.left + cell.width / 2 < pointerX).length
}

/**
 * 포인터 → 놓을 자리. 줄의 세로 범위 안이면 그 줄(칸은 `dropIndex`) · 첫 줄 위면 맨 위의 새 줄 · 마지막 줄 아래면 맨 아래의 새 줄 · 두 줄
 * 사이(틈)면 그 사이의 새 줄. 줄이 없으면 null.
 */
export function dropTarget(rows: readonly RowBox[], draggedId: string, pointerX: number, pointerY: number): DropTarget | null {
  if (rows.length === 0) return null
  if (pointerY < rows[0]!.top) return { newRow: 0 }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (pointerY <= row.bottom) {
      return pointerY >= row.top ? { row: i, index: dropIndex(row.cells, draggedId, pointerX) } : { newRow: i }
    }
  }
  return { newRow: rows.length }
}

/** 끄는 동안 그릴 줄 — 칸 사이의 세로 줄(x · 그 줄의 위아래) 또는 새 줄 자리의 가로 줄(y). 화면 좌표다. */
export type DropLine = { readonly kind: 'vertical'; readonly x: number; readonly top: number; readonly bottom: number } | { readonly kind: 'horizontal'; readonly y: number }

export function dropLine(rows: readonly RowBox[], draggedId: string, target: DropTarget): DropLine | null {
  if ('newRow' in target) {
    const above = rows[target.newRow - 1]
    const below = rows[target.newRow]
    if (above === undefined && below === undefined) return null
    const y = above === undefined ? below!.top - 8 : below === undefined ? above.bottom + 8 : (above.bottom + below.top) / 2
    return { kind: 'horizontal', y }
  }
  const row = rows[target.row]
  if (row === undefined) return null
  const others = row.cells.filter((cell) => cell.id !== draggedId)
  const next = others[target.index]
  const last = others.at(-1)
  const x = next !== undefined ? next.left : last !== undefined ? last.left + last.width : (row.cells[0]?.left ?? 0)
  return { kind: 'vertical', x, top: row.top, bottom: row.bottom }
}
