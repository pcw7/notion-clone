/**
 * 보드 드래그의 규칙 — 보드 4b조각 (F-04-03 Board, DOM 없음)
 *
 * 정본: 04-database-views.md F-04-03 (드롭 = 셀 값 + 순서) · F-04-11 (그룹 키)
 *
 * 화면(`database-board.tsx`)이 하는 일은 ① 포인터 좌표를 받고 ② 열 · 카드의 사각형을 재고 ③ 그리는 것뿐이다.
 * **어디에 놓이는가 · 상태가 어떻게 바뀌는가 · 되돌리려면 어디로 보내는가**는 여기서 정하고 DOM 없이 검사한다
 * (`lib/editor/block-handle.ts` 와 같은 나눔).
 *
 * ──────────────────────────────────────────────────────────────────────
 * dnd-kit 을 쓰지 않는다 (HANDOFF §3.2-28)
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-03 의 현실적 대안은 dnd-kit(MIT)이다. 쓰지 않은 이유: 이 보드의 드래그는 **카드 하나를 한 열의 한 자리로**
 * 옮기는 것뿐이고, 그 자리는 서버가 준 `key` 와 "이 카드 앞"(`beforeRowId`) 두 값으로 끝난다. dnd-kit 의 sortable 은
 * 끄는 동안 항목을 컨테이너 사이로 옮겨 가며 로컬 배열을 재정렬하는 모델이라, "순서의 정본은 서버(`row_position`)
 * 이고 화면은 드롭 한 번에 요청 하나"인 우리 모델과 어긋난다(§3.3-148). 블록 드래그도 같은 이유로 직접 만들었다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 드롭 자리 = (열, 이 카드 앞)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 열은 포인터 x 에 **가장 가까운** 열이다 — 열 사이 틈이나 보드 밖에서도 드롭이 된다(끌고 있는 동안 포인터가
 * 잠깐 벗어나도 자리가 사라지지 않는다). 열 안 자리는 카드 **중앙선** 기준이다: 중앙선보다 위면 그 카드 앞.
 * 끌고 있는 카드는 후보에서 뺀다 — 안 그러면 한 칸 아래로 옮기는 드롭이 "자기 앞"으로 계산되어 제자리다.
 *
 * **제자리 드롭은 null 이다.** 같은 열에서 원래 뒤 카드 앞에 놓는 것은 아무것도 바꾸지 않는데 요청을 보내면 서버가
 * 자리를 다시 쓰고(자리 없는 행들에 자리가 생긴다) 헛된 왕복이 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 정렬이 걸린 보드는 열 사이 이동만이다 (§3.3-149)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `manualOrder: false` 면 열 안 자리는 정렬이 정하므로 `beforeRowId` 는 늘 null 이고, 같은 열로의 드롭은 null
 * (아무 일도 없다)이다. 서버도 그때는 자리를 쓰지 않는다 — 화면은 옮긴 카드를 일단 열 끝에 두고, 그 열을 다시 읽는다.
 */

import type { RowCell } from './row.ts'
import type { GroupableType, SelectOption } from './property-types.ts'

// ── 좌표 ──────────────────────────────────────────────────────────────

export type CardBox = {
  readonly id: string
  readonly top: number
  readonly bottom: number
}

export type ColumnBox = {
  readonly key: string
  readonly left: number
  readonly right: number
  /** 화면 순서(위 → 아래). */
  readonly cards: readonly CardBox[]
}

export type Dragging = {
  readonly id: string
  readonly fromKey: string
}

export type DropTarget = {
  readonly key: string
  /** 이 카드 앞에 놓는다. null 이면 열의 맨 뒤. 서버의 `MoveRowInput.beforeRowId` 와 같은 뜻. */
  readonly beforeRowId: string | null
}

/** 포인터 x 에 가장 가까운 열. 열 안이면 거리 0. 같은 거리면 앞의 열. */
function nearestColumn(columns: readonly ColumnBox[], x: number): ColumnBox | null {
  let best: ColumnBox | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const column of columns) {
    const distance = x < column.left ? column.left - x : x > column.right ? x - column.right : 0
    if (distance < bestDistance) {
      best = column
      bestDistance = distance
    }
  }
  return best
}

/**
 * 포인터가 가리키는 드롭 자리. 아무것도 바꾸지 않는 자리(제자리 · 정렬된 보드의 같은 열)는 null.
 */
export function resolveDrop(
  columns: readonly ColumnBox[],
  dragging: Dragging,
  x: number,
  y: number,
  manualOrder: boolean,
): DropTarget | null {
  const column = nearestColumn(columns, x)
  if (column === null) return null

  if (!manualOrder) {
    return column.key === dragging.fromKey ? null : { key: column.key, beforeRowId: null }
  }

  const others = column.cards.filter((card) => card.id !== dragging.id)
  const next = others.find((card) => y < (card.top + card.bottom) / 2)
  const beforeRowId = next === undefined ? null : next.id

  if (column.key === dragging.fromKey) {
    const at = column.cards.findIndex((card) => card.id === dragging.id)
    const currentNext = at >= 0 && at + 1 < column.cards.length ? column.cards[at + 1].id : null
    if (beforeRowId === currentNext) return null
  }
  return { key: column.key, beforeRowId }
}

// ── 상태 ──────────────────────────────────────────────────────────────

export type BoardColumn<Row extends { readonly id: string }> = {
  readonly key: string
  readonly rows: readonly Row[]
  /** 필터를 지난 행 수. 불러온 행 수와 다를 수 있다("더 보기"). */
  readonly count: number
}

export type MoveResult<Column> = {
  readonly columns: readonly Column[]
  /** 이 자리로 다시 옮기면 원래대로다 — 요청이 거부됐을 때 되돌리는 곳. */
  readonly undo: DropTarget
}

/**
 * 카드를 자리로 옮긴 새 상태. 행이 없거나 열이 없으면 null. `beforeRowId` 가 열에 없으면(그사이 사라졌다) 맨 뒤.
 *
 * 카운트도 함께 옮긴다 — 헤더의 숫자가 카드 수와 어긋나면 사용자는 "더 보기"가 남았다고 읽는다.
 */
export function moveCard<Row extends { readonly id: string }, Column extends BoardColumn<Row>>(
  columns: readonly Column[],
  rowId: string,
  target: DropTarget,
): MoveResult<Column> | null {
  const from = columns.find((column) => column.rows.some((row) => row.id === rowId))
  const to = columns.find((column) => column.key === target.key)
  if (from === undefined || to === undefined) return null

  const at = from.rows.findIndex((row) => row.id === rowId)
  const row = from.rows[at]
  const undo: DropTarget = { key: from.key, beforeRowId: from.rows[at + 1]?.id ?? null }

  const removed = from.rows.filter((r) => r.id !== rowId)
  const base = to.key === from.key ? removed : to.rows
  const insertAt = target.beforeRowId === null ? -1 : base.findIndex((r) => r.id === target.beforeRowId)
  const inserted = insertAt < 0 ? [...base, row] : [...base.slice(0, insertAt), row, ...base.slice(insertAt)]

  const next = columns.map((column): Column => {
    if (column.key === to.key && column.key === from.key) return { ...column, rows: inserted }
    if (column.key === to.key) return { ...column, rows: inserted, count: column.count + 1 }
    if (column.key === from.key) return { ...column, rows: removed, count: column.count - 1 }
    return column
  })
  return { columns: next, undo }
}

// ── 새 카드 · 이름 ────────────────────────────────────────────────────

/**
 * 열의 `+` 가 미리 채우는 셀(F-04-03: "그 그룹 값이 미리 채워진 새 카드"). `''` 그룹은 값이 없는 것이 곧 그 그룹이다.
 */
export function prefillCells(propertyType: GroupableType, propertyId: string, key: string): RowCell[] {
  if (propertyType === 'checkbox') {
    return [{ propertyId, value: { type: 'checkbox', checkbox: key === 'true' } }]
  }
  if (key === '') return []
  return [{ propertyId, value: { type: 'select', select: { id: key } } }]
}

/** 열 머리의 이름. 노션의 "No Status" 자리. */
export function groupLabel(
  propertyType: GroupableType,
  propertyName: string,
  group: { readonly key: string; readonly option: SelectOption | null },
): string {
  if (propertyType === 'checkbox') return group.key === 'true' ? '체크됨' : '체크 안 됨'
  return group.option?.name ?? `${propertyName} 없음`
}
