/**
 * 그룹 덩이 사이의 행 끌기 — 덩이들이 서로를 찾는 자리 (그룹 트랙 G-2c · 정본 §3.6 [보강 G-1] ⑧)
 *
 * 덩이마다 표(`DatabaseTable`)가 따로라 끄는 행은 한 표의 것이고 놓을 자리는 다른 표의 것이다. 그룹 화면(`grouped-rows.tsx`)이 이것을 하나
 * 두고 덩이마다 제 "차선"을 올린다. 끄는 표는 포인터 아래의 다른 덩이를 찾아 그 차선에 줄을 그리게 하고, 놓으면 서버의 답(새 값의 행)을
 * 그 차선에 넘긴다. 차선은 렌더마다 다시 올라온다(지금의 행 · 더 보기 · 조건 밖을 그대로 읽게).
 *
 * 놓을 자리를 세는 법과 그 표시는 받는 덩이가 맡는다(G-3b) — 표는 세로 줄, 갤러리는 격자의 세로 막대. 끄는 쪽은 포인터만 넘긴다.
 */

import { createContext } from 'react'

import type { RowJson } from '@/lib/database/http'

/** 포인터의 자리(화면). */
export type LanePoint = { readonly x: number; readonly y: number }

export type GroupLane = {
  /** 이 덩이의 자리(화면) — 포인터가 이 덩이 위인가를 잰다. 접힌 덩이는 높이가 없어 걸리지 않는다. */
  readonly bounds: () => DOMRect | null
  /**
   * 포인터 자리에 놓을 자리 — 이 행 앞 · null 이면 맨 뒤 · 놓을 수 없으면 undefined(채울 값이 없는 범주 · 더 볼 행이 남은 끝). 세는 법은
   * 덩이의 것이다 — 표는 세로 줄(`foreignDropBefore` · "조건 밖" 행은 뺀다) · 갤러리는 읽는 차례의 격자(`foreignCardDropBefore`).
   */
  readonly dropAt: (point: LanePoint) => string | null | undefined
  /** 끄는 동안 그 자리 표시를 그린다(표는 가로 줄 · 갤러리는 세로 막대) · null 이면 지운다. */
  readonly preview: (point: LanePoint | null) => void
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
