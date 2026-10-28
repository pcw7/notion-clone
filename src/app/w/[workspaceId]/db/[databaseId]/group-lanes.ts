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
import type { DropTarget } from '@/lib/database/board-drag'

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

/** 차선의 공통 — 덩이의 자리(화면). 표 · 갤러리의 덩이(`GroupLane`)와 보드의 가로줄(`BoardLane`)이 같은 등록소를 쓴다. */
type LaneBase = { readonly bounds: () => DOMRect | null }

export type GroupLanes<L extends LaneBase = GroupLane> = {
  /** 덩이의 차선을 올린다 — 돌려준 함수로 내린다(그사이 다시 올라온 것은 지우지 않는다). */
  register(key: string, lane: L): () => void
  /** 포인터 아래의 **다른** 덩이(세로로만 잰다 — 덩이는 위아래로 쌓인다). 없으면 null. */
  laneAt(y: number, except: string): { readonly key: string; readonly lane: L } | null
  /** 올라온 차선 모두 — 화면의 위에서 아래 순(자리를 재지 못한 것은 뒤 · B-4e 의 메뉴가 쓴다). */
  list(): readonly { readonly key: string; readonly lane: L }[]
}

export function createGroupLanes<L extends LaneBase = GroupLane>(): GroupLanes<L> {
  const lanes = new Map<string, L>()
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
    list() {
      const top = (lane: L) => lane.bounds()?.top ?? Number.POSITIVE_INFINITY
      return [...lanes].map(([key, lane]) => ({ key, lane, at: top(lane) })).sort((a, b) => a.at - b.at).map(({ key, lane }) => ({ key, lane }))
    },
  }
}

/** 그룹 화면 밖(평평한 표 · 행 페이지의 표)에서는 없다. */
export const GroupLanesContext = createContext<GroupLanes | null>(null)

/**
 * 보드의 가로줄 하나(B-4d · 정본 [보강 B-4] ⑦) — 놓을 자리가 (열, 앞 카드)다(보드의 `resolveDrop`). 받는 가로줄이 제 열 · 카드로 자리를 세고
 * 표시한다 · 받을 수 없는 가로줄 · 열이면 null.
 */
export type BoardLane = {
  readonly bounds: () => DOMRect | null
  /** 가로줄의 이름(B-4e — 카드 메뉴의 "다른 가로줄로"). */
  readonly label: string
  /** 이 가로줄의 그 열이 카드를 받는가 — 채울 값이 있고 · 접히지 않았고 · 그 열이 받는다(끌기의 `dropAt` 과 같은 규칙). */
  readonly takes: (columnKey: string) => boolean
  /** 옮겨 온 카드의 "옮기기" 단추에 포커스를 둔다(B-4e — 키보드로 이어서 옮기게). */
  readonly focus: (rowId: string) => void
  readonly dropAt: (point: LanePoint) => DropTarget | null
  readonly preview: (point: LanePoint | null) => void
  /** 옮긴 카드를 받는다 — 서버의 답(새 값) · 그 자리에. */
  readonly receive: (row: RowJson, target: DropTarget) => void
  readonly reload: () => void
}

/** 하위 그룹이 있는 보드 밖에서는 없다. */
export const BoardLanesContext = createContext<GroupLanes<BoardLane> | null>(null)
