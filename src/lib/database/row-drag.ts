/**
 * 표 · 목록의 행 끌기 규칙 — §7 정리 10n-60 (F-04-01 *"행 드래그 재정렬"*, DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.6 `row_position` [보강 10n-59] · HANDOFF §3.2-296
 *
 * 화면은 행의 세로 자리(위 · 높이)와 포인터의 y 만 넘긴다. 놓을 자리는 서버 명령(`moveViewRow`)이 받는 모양 그대로("이 행을 `before`
 * 앞에" · null 이면 맨 뒤) — 규칙은 뷰 탭 끌기(`tab-drag.ts`)를 세로로 쓴다.
 *
 * **더 볼 행이 남았으면(`hasMore`) 맨 뒤에 놓지 않는다** — 서버의 "맨 뒤" 는 아직 받지 않은 행들까지 지난 끝이라, 놓은 행이 화면에서
 * 사라진다. 그때는 놓을 자리를 주지 않는다(undefined — 줄도 그리지 않는다).
 */

import { tabDropBefore, tabDropLineX } from './tab-drag.ts'

/** 행 하나의 세로 자리 — 화면의 `getBoundingClientRect` 에서. */
export type RowBox = { readonly id: string; readonly top: number; readonly height: number }

const asTabs = (rows: readonly RowBox[]) => rows.map((r) => ({ id: r.id, left: r.top, width: r.height }))

/** 놓을 자리 — 제자리면 undefined · 더 볼 행이 남았는데 맨 뒤면 undefined. */
export function rowDropBefore(rows: readonly RowBox[], draggedId: string, pointerY: number, hasMore: boolean): string | null | undefined {
  const before = tabDropBefore(asTabs(rows), draggedId, pointerY)
  return before === null && hasMore ? undefined : before
}

/** 끄는 동안 가로 줄을 그릴 y — 놓일 자리의 위 경계(맨 뒤면 마지막 행의 아래 경계). 놓을 자리가 없으면 null. */
export function rowDropLineY(rows: readonly RowBox[], draggedId: string, pointerY: number, hasMore: boolean): number | null {
  if (rowDropBefore(rows, draggedId, pointerY, hasMore) === undefined) return null
  return tabDropLineX(asTabs(rows), draggedId, pointerY)
}

/** 키로 한 칸 — ↑ 는 바로 위 행의 앞 · ↓ 는 바로 아래 행의 다음 행 앞(없으면 맨 뒤). 끝이거나 놓을 수 없으면 undefined. */
export function stepTarget(ids: readonly string[], index: number, direction: 'up' | 'down', hasMore: boolean): string | null | undefined {
  if (index < 0 || index >= ids.length) return undefined
  if (direction === 'up') return index === 0 ? undefined : ids[index - 1]
  if (index === ids.length - 1) return undefined
  const after = ids[index + 2]
  if (after !== undefined) return after
  return hasMore ? undefined : null
}

/** 화면의 목록을 먼저 그 차례로 — 서버의 새 목록이 오기 전에(실패하면 부르는 쪽이 되돌린다). `before` 가 목록에 없으면 그대로. */
export function reorderRows<T extends { readonly id: string }>(rows: readonly T[], id: string, before: string | null): readonly T[] {
  const moving = rows.find((r) => r.id === id)
  if (moving === undefined || before === id) return rows
  const rest = rows.filter((r) => r.id !== id)
  const at = before === null ? rest.length : rest.findIndex((r) => r.id === before)
  if (at < 0) return rows
  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}
