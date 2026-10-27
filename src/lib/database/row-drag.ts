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
 *
 * 갤러리(10n-61)는 카드가 격자라 `cardDropBefore` 가 읽는 차례(왼쪽 → 오른쪽, 위 → 아래)로 놓을 자리를 정한다 — 키로 한 칸(`stepTarget`)과
 * 먼저 그리기(`reorderRows`)는 표와 같다.
 *
 * 그룹 덩이 사이(G-2c · 정본 [보강 G-1] ⑧)는 끄는 행이 놓을 목록에 없다 — `foreignDropBefore` · `foreignDropLineY` · `insertRow`.
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

// ── 그룹 덩이 사이(G-2c) — 끄는 행이 다른 목록에서 온다 ─────────────────

/** 다른 덩이에 놓을 자리 — 가운데가 포인터보다 아래인 첫 행의 앞 · 없으면 맨 뒤(null · 더 볼 행이 남았으면 undefined). 제자리가 없다. */
export function foreignDropBefore(rows: readonly RowBox[], pointerY: number, hasMore: boolean): string | null | undefined {
  const at = rows.find((r) => r.top + r.height / 2 > pointerY)
  if (at !== undefined) return at.id
  return hasMore ? undefined : null
}

/** 다른 덩이에 끄는 동안 가로 줄의 y — 놓일 행의 위 경계 · 맨 뒤면 마지막 행의 아래 경계 · 행이 없으면 `emptyY`. 놓을 수 없으면 null. */
export function foreignDropLineY(rows: readonly RowBox[], pointerY: number, hasMore: boolean, emptyY: number | null): number | null {
  const before = foreignDropBefore(rows, pointerY, hasMore)
  if (before === undefined) return null
  if (before === null) {
    const last = rows.at(-1)
    return last === undefined ? emptyY : last.top + last.height
  }
  return rows.find((r) => r.id === before)!.top
}

/** 다른 덩이에서 온 행을 `before` 앞에 — null 이거나 목록에 없으면 맨 뒤. 이미 있으면 그 자리를 옮긴다. */
export function insertRow<T extends { readonly id: string }>(rows: readonly T[], row: T, before: string | null): readonly T[] {
  const rest = rows.filter((r) => r.id !== row.id)
  const at = before === null ? -1 : rest.findIndex((r) => r.id === before)
  return at < 0 ? [...rest, row] : [...rest.slice(0, at), row, ...rest.slice(at)]
}

// ── 갤러리(10n-61) — 카드는 격자다 ──────────────────────────────────

/** 카드 하나의 자리 — 화면의 `getBoundingClientRect` 에서. 목록은 읽는 차례(왼쪽 → 오른쪽, 위 → 아래)다. */
export type CardBox = { readonly id: string; readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/**
 * 카드를 놓을 자리 — 끌고 있는 카드를 뺀 나머지에서 **읽는 차례로 포인터보다 뒤에 오는 첫 카드**의 앞. 뒤에 온다 = 아래 줄이거나(위가 포인터보다
 * 아래) 같은 줄(아래가 포인터보다 아래)에서 가운데가 포인터보다 오른쪽. 없으면 맨 뒤(null · 더 볼 카드가 남았으면 undefined). 제자리는 undefined.
 */
export function cardDropBefore(cards: readonly CardBox[], draggedId: string, x: number, y: number, hasMore: boolean): string | null | undefined {
  const from = cards.findIndex((c) => c.id === draggedId)
  if (from < 0) return undefined
  const others = cards.filter((c) => c.id !== draggedId)
  const at = others.findIndex((c) => c.top + c.height > y && (c.top > y || c.left + c.width / 2 > x))
  const index = at < 0 ? others.length : at
  if (index === from) return undefined
  const before = others[index]?.id ?? null
  return before === null && hasMore ? undefined : before
}

/** 끄는 동안 세로 막대를 그릴 자리 — 놓일 카드의 왼쪽 경계(맨 뒤면 마지막 카드의 오른쪽 경계)에서 `gap / 2` 바깥 · 그 카드의 높이. 없으면 null. */
export function cardDropMark(
  cards: readonly CardBox[],
  draggedId: string,
  x: number,
  y: number,
  hasMore: boolean,
  gap: number,
): { readonly x: number; readonly top: number; readonly height: number } | null {
  const before = cardDropBefore(cards, draggedId, x, y, hasMore)
  if (before === undefined) return null
  if (before === null) {
    const last = cards.filter((c) => c.id !== draggedId).at(-1)
    return last === undefined ? null : { x: last.left + last.width + gap / 2, top: last.top, height: last.height }
  }
  const target = cards.find((c) => c.id === before)!
  return { x: target.left - gap / 2, top: target.top, height: target.height }
}
