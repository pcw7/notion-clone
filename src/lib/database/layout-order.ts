/**
 * 속성 묶음의 순서 — 레이아웃의 "적용"이 스키마 순서를 어떻게 다시 쓰는가 (잔여 묶음 8f-2 · F-16-03, DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 행의 레이아웃 ③ — 속성 묶음 안의 순서는 `property.order_idx`(스키마 순서)다.
 *       16-item-layout.md F-16-03 *"정렬은 `property.order_idx` 를 그대로 재사용하고 레이아웃 전용 순서를 따로 두지 않는다"*
 *
 * 편집 화면은 스키마 전체가 아니라 **속성 묶음에 서는 것**만 늘어놓는다 — 제목 · rollup 은 레코드 모양이 뺀다(`listColumns('record', …)`).
 * 그래서 받는 순서는 일부의 상대 순서다. 규칙 둘.
 *
 *   ① 자리(slot) — 받은 속성들이 지금 차지한 자리는 그대로 두고, 그 자리들을 받은 순서로 다시 채운다. 받지 않은 속성(제목 · rollup ·
 *      편집하는 사이에 남이 더한 속성)은 제자리다. 모르는 id(그사이 지워진 속성)는 건너뛴다
 *   ② 옮긴 것만 쓴다 — 새 순서에서 키가 이미 오름차순인 가장 긴 줄(LIS)은 그대로 두고, 나머지만 이웃 사이의 새 키를 받는다.
 *      하나를 옮기면 한 행만 쓴다(`moveProperty` 머리말 — 정수 자리면 한 칸 옮길 때마다 뒤의 전부를 다시 쓴다)
 */

import { orderKeyBetween } from '../block/order-key.ts'

export type KeyedProperty = { readonly id: string; readonly key: string }

/**
 * 지금 순서(`current` — `order_idx, id` 로 정렬된 살아 있는 속성 전부)와 받은 순서(`wanted`)로 **새 키를 받을 속성**만 돌려준다.
 * 바뀐 것이 없으면 빈 배열이다.
 */
export function planOrder(current: readonly KeyedProperty[], wanted: readonly string[]): KeyedProperty[] {
  const at = new Map(current.map((p, i) => [p.id, i]))
  // ① 받은 것 중 아는 것만 · 처음 나온 자리로.
  const picked: string[] = []
  for (const id of wanted) {
    if (at.has(id) && !picked.includes(id)) picked.push(id)
  }
  const slots = picked.map((id) => at.get(id)!).sort((a, b) => a - b)
  const target = current.slice()
  slots.forEach((slot, i) => {
    target[slot] = current[at.get(picked[i]!)!]!
  })
  if (target.every((p, i) => p.id === current[i]!.id)) return []

  // ② 그대로 둘 것 — 키가 **엄격히** 오르는 가장 긴 줄. 같은 키가 둘이면(있어서는 안 되지만) 하나만 남겨 새 키 사이가 늘 비어 있게 한다.
  const keep = longestIncreasing(target.map((p) => p.key))
  const nextKept: (string | null)[] = new Array(target.length).fill(null)
  for (let i = target.length - 2; i >= 0; i -= 1) {
    nextKept[i] = keep.has(i + 1) ? target[i + 1]!.key : nextKept[i + 1]!
  }
  const moves: KeyedProperty[] = []
  let prev: string | null = null
  target.forEach((p, i) => {
    if (keep.has(i)) {
      prev = p.key
      return
    }
    const key = orderKeyBetween(prev, nextKept[i]!)
    moves.push({ id: p.id, key })
    prev = key
  })
  return moves
}

/** 엄격히 오르는 가장 긴 부분열의 자리들 — O(n log n). 키는 fractional index 라 문자열 비교가 곧 `COLLATE "C"` 의 순서다. */
function longestIncreasing(keys: readonly string[]): Set<number> {
  /** tails[k] = 길이 k+1 인 줄들 중 끝 키가 가장 작은 것의 끝 자리. */
  const tails: number[] = []
  const before: number[] = new Array(keys.length).fill(-1)
  keys.forEach((key, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[tails[mid]!]! < key) lo = mid + 1
      else hi = mid
    }
    before[i] = lo > 0 ? tails[lo - 1]! : -1
    tails[lo] = i
  })
  const keep = new Set<number>()
  for (let i = tails.length > 0 ? tails[tails.length - 1]! : -1; i !== -1; i = before[i]!) keep.add(i)
  return keep
}
