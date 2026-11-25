/**
 * 남이 바꾼 칸 — DB 실시간 동기화 RT-4조각 (F-05-16 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md 판결 X-5 [보강] "X-5 의 단계" ⑳ [보강 RT-4]
 *       05-collaboration-sync.md F-05-16 UI *"원격 행 변경 시 셀 하이라이트 페이드"*
 *
 * 합치기(델타 · 다시 읽기)가 화면에 있던 행의 칸 값을 바꾸면 그 칸만 잠깐 칠한다. 여기는 **어느 칸인가**만 정한다 — 칠하기 · 지우기는 표가 한다.
 *
 *   · 칸마다 옛 값과 새 값을 견준다(행의 판이 아니라). 키 차례는 보지 않는다 — 화면이 낙관적으로 칠한 값과 서버의 값은 키 차례가 다를 수 있다
 *   · 화면에 있던 행만 — 새로 들어온 행 · 빠진 행은 칠하지 않는다
 *   · 이 탭이 쓴 칸은 칠하지 않는다(`OwnWrites` — 탭마다 하나 · 같은 사람의 다른 탭은 남이다)
 *   · 한 번에 너무 많은 행이 바뀌면 아무것도 칠하지 않는다(대량 — 소음)
 */

import type { RowJson } from './http.ts'

/** 칠해 두는 시간(ms) — 움직이면 이만큼 흐리고, 움직임 줄이기면 이만큼 가만히. */
export const REMOTE_FLASH_MS = 2000
/** 한 번의 합치기에서 칸이 바뀐 행이 이보다 많으면 칠하지 않는다. */
export const REMOTE_FLASH_MAX_ROWS = 20
/** 이 탭이 쓴 칸을 "내 것"으로 치는 시간(ms) — 쓰기 응답보다 델타가 먼저 와도 · 늦게 와도. */
export const OWN_WRITE_MS = 10_000

/** 값이 같은가 — JSON 값만 온다(행의 칸). 객체의 키 차례는 보지 않는다. */
export function sameValueJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as readonly unknown[]
    return a.length === other.length && a.every((v, i) => sameValueJson(v, other[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  // undefined 인 키는 없는 키와 같다(JSON 에 실리지 않는다)
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const key of keys) if (!sameValueJson(ra[key], rb[key])) return false
  return true
}

/** 두 판의 같은 행에서 값이 바뀐 칸 — `propertyIds`(칠할 수 있는 보이는 칸) 안에서만. */
export function changedCells(previous: RowJson, next: RowJson, propertyIds: readonly string[]): string[] {
  return propertyIds.filter((id) => !sameValueJson(previous.properties[id], next.properties[id]))
}

/**
 * 합치기 앞뒤의 목록에서 남이 바꾼 칸 — 행 id → 속성 id 들. 화면에 있던 행만 · `isOwn` 인 칸은 빼고 · 칸이 바뀐 행이 `maxRows` 를 넘으면
 * 빈 지도(대량).
 */
export function remoteChanges(input: {
  readonly previous: readonly RowJson[]
  readonly next: readonly RowJson[]
  readonly propertyIds: readonly string[]
  readonly isOwn: (rowId: string, propertyId: string) => boolean
  readonly maxRows?: number
}): Map<string, string[]> {
  const found = new Map<string, string[]>()
  if (input.propertyIds.length === 0) return found
  const before = new Map(input.previous.map((row) => [row.id, row]))
  for (const row of input.next) {
    const old = before.get(row.id)
    if (old === undefined || old === row) continue
    const cells = changedCells(old, row, input.propertyIds).filter((id) => !input.isOwn(row.id, id))
    if (cells.length > 0) found.set(row.id, cells)
  }
  return found.size > (input.maxRows ?? REMOTE_FLASH_MAX_ROWS) ? new Map() : found
}

/**
 * 이 탭이 쓴 칸의 장부 — 칸 쓰기는 그 칸, 행 단위 동작(행 추가 · 버튼 · 다른 그룹으로 옮기기)은 그 행 전체(`propertyId` 없음). 마지막으로
 * 적은 뒤 `windowMs` 동안 "내 것"이다. 쓰기를 보낼 때와 답을 받을 때 둘 다 적으면 느린 요청도 덮는다.
 */
export type OwnWrites = {
  note(rowId: string, propertyId?: string): void
  isOwn(rowId: string, propertyId: string): boolean
}

const WHOLE_ROW = '*'

export function createOwnWrites(now: () => number = Date.now, windowMs = OWN_WRITE_MS): OwnWrites {
  const until = new Map<string, number>()
  const keyOf = (rowId: string, propertyId: string) => `${rowId}/${propertyId}`
  const live = (key: string) => (until.get(key) ?? -Infinity) > now()
  return {
    note(rowId, propertyId = WHOLE_ROW) {
      const at = now()
      // 오래된 것은 가끔 비운다(한 탭이 하루 종일 열려 있어도 자라지 않게)
      if (until.size > 500) for (const [key, end] of until) if (end <= at) until.delete(key)
      until.set(keyOf(rowId, propertyId), at + windowMs)
    },
    isOwn: (rowId, propertyId) => live(keyOf(rowId, propertyId)) || live(keyOf(rowId, WHOLE_ROW)),
  }
}

/** 이 탭의 장부 — 모듈이 탭마다 하나다(표 · 행 페이지 · 미리보기 · 버튼이 함께 적는다). */
export const ownWrites: OwnWrites = createOwnWrites()
