/**
 * 그룹 덩이 사이의 행 끌기 — 덩이들이 서로를 찾는 자리 (그룹 트랙 G-2c · 정본 §3.6 [보강 G-1] ⑧)
 *
 * 덩이마다 표(`DatabaseTable`)가 따로라 끄는 행은 한 표의 것이고 놓을 자리는 다른 표의 것이다. 그룹 화면(`grouped-rows.tsx`)이 이것을 하나
 * 두고 덩이마다 제 "차선"을 올린다. 끄는 표는 포인터 아래의 다른 덩이를 찾아 그 차선에 줄을 그리게 하고, 놓으면 서버의 답(새 값의 행)을
 * 그 차선에 넘긴다. 차선은 렌더마다 다시 올라온다(지금의 행 · 더 보기 · 조건 밖을 그대로 읽게).
 */

import { createContext } from 'react'

import type { RowJson } from '@/lib/database/http'
import type { RowBox } from '@/lib/database/row-drag'

export type GroupLane = {
  /** 이 덩이의 자리(화면) — 포인터가 이 덩이 위인가를 잰다. 접힌 덩이는 높이가 없어 걸리지 않는다. */
  readonly bounds: () => DOMRect | null
  /** 놓을 자리를 셀 행들 — "조건 밖" 행은 뺐다. */
  readonly boxes: () => RowBox[]
  /** 행이 없을 때 줄의 y(화면). */
  readonly emptyLineY: () => number | null
  readonly hasMore: () => boolean
  /** 이 그룹의 값을 채울 수 있는가 — 옵션이 없는 범주(10n-27)에는 놓지 못한다. */
  readonly accepts: boolean
  /** 끄는 동안 이 덩이에 줄을 그린다(화면 y) · null 이면 지운다. */
  readonly showLine: (y: number | null) => void
  /** 옮긴 행을 받는다 — 서버의 답(새 값) · `before` 앞에 · 뷰의 조건 밖이면(`inView` 거짓) "조건 밖"으로 남긴다. */
  readonly receive: (row: RowJson, before: string | null, inView: boolean) => void
  /** 옮기기가 거절됐다 — 이 덩이를 다시 읽는다. */
  readonly reload: () => void
}

export type GroupLanes = {
  /** 덩이의 차선을 올린다 — 돌려준 함수로 내린다(그사이 다시 올라온 것은 지우지 않는다). */
  register(key: string, lane: GroupLane): () => void
  /** 포인터 아래의 **다른** 덩이(세로로만 잰다 — 덩이는 위아래로 쌓인다). 없으면 null. */
  laneAt(y: number, except: string): { readonly key: string; readonly lane: GroupLane } | null
}

export function createGroupLanes(): GroupLanes {
  const lanes = new Map<string, GroupLane>()
  return {
    register(key, lane) {
      lanes.set(key, lane)
      return () => {
        if (lanes.get(key) === lane) lanes.delete(key)
      }
    },
    laneAt(y, except) {
      for (const [key, lane] of lanes) {
        if (key === except) continue
        const r = lane.bounds()
        if (r !== null && r.height > 0 && y >= r.top && y < r.bottom) return { key, lane }
      }
      return null
    },
  }
}

/** 그룹 화면 밖(평평한 표 · 행 페이지의 표)에서는 없다. */
export const GroupLanesContext = createContext<GroupLanes | null>(null)
