'use client'

/**
 * 하위 그룹이 있는 보드 — 가로줄마다 보드 하나 (그룹 버킷 트랙 B-4b · 정본 §3.6 [보강 B-4] ⑤ · 04 F-04-11)
 *
 * 가로줄(머리: 펼침 · 이름 · 행 수) 아래에 그 가로줄의 칸들을 보드 그대로 그린다(`DatabaseBoard` 의 가로줄 모드 — 칸마다 "더 보기" · `+` 가
 * 두 값을 채운다 · 가로줄 안에서 열 사이로 옮긴다). 칸 머리는 그 칸의 행 수다(머리의 계산은 열을 가로지르므로 두지 않는다).
 *
 * 구독은 여기서 하나 — 가로줄마다 열면 줄 수만큼 연결이 열린다([보강 G-3] ③). 신호가 오면 서버 렌더를 다시 부르고 가로줄마다 보드가 제
 * 칸들을 받아들인다. 가로줄 접기는 보는 사람의 이 기기에(열의 접기와 따로 — `group-collapse.ts` 의 다른 키).
 */

import { useSyncExternalStore, type ComponentProps } from 'react'

import { fillKeyOf, groupLabel, prefillCells } from '@/lib/database/board-drag'
import type { RowJson } from '@/lib/database/http'
import type { SelectOption, StatusGroupKind } from '@/lib/database/property-types'
import { OptionChip } from './cell-view'
import { DatabaseBoard, type BoardGroupJson, type GroupProperty } from './database-board'
import { getGroupCollapseStore } from './group-collapse'
import { useLiveServerRefresh } from './use-table-changes'
import { useViewerToday } from './use-viewer-today'

type BoardProps = ComponentProps<typeof DatabaseBoard>

/** 가로줄 하나(서버의 `SubGroup` — 행은 JSON). */
export type LaneJson = {
  readonly key: string
  readonly option: SelectOption | null
  readonly statusGroup: StatusGroupKind | null
  readonly fillOptionId: string | null
  readonly count: number
  readonly hidden: boolean
  readonly cells: Readonly<Record<string, { readonly count: number; readonly rows: readonly RowJson[]; readonly hasMore: boolean; readonly nextCursor: string | null }>>
}

export function SubGroupedBoard({
  subProperty,
  lanes,
  board,
}: {
  /** 가로줄의 속성 — 이름 · 새 행 채우기(단위 · 오늘). */
  subProperty: GroupProperty
  lanes: readonly LaneJson[]
  /** 가로줄마다 같은 보드의 재료 — 칸(행 · 커서) · 가로줄 · 구독은 여기서 넣는다. */
  board: Omit<BoardProps, 'lane' | 'live' | 'calculation' | 'key'>
}) {
  useLiveServerRefresh(board.workspaceId, board.dataSourceId, false, board.renderedAt)
  // 상대 날짜(B-3)로 묶은 축이 있으면 서버의 오늘이 이 기기의 오늘과 다를 때 한 번 새로 받는다
  useViewerToday(subProperty.today ?? board.property.today)

  const store = getGroupCollapseStore(`${board.viewId}:lanes`)
  const collapsed = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const shown = lanes.filter((l) => !l.hidden)
  const hiddenLanes = lanes.length - shown.length
  const hiddenColumns = board.groups.filter((g) => g.hidden).length
  return (
    <div data-testid="db-sub-grouped" className="flex flex-col gap-5">
      {shown.map((lane) => {
        const fill = fillKeyOf(lane, subProperty)
        const label = groupLabel(subProperty.type, subProperty.name, lane, subProperty)
        const folded = collapsed.has(lane.key)
        const laneGroups: BoardGroupJson[] = board.groups.map((g) => {
          const cell = lane.cells[g.key]
          return { ...g, count: cell?.count ?? 0, rows: [...(cell?.rows ?? [])], hasMore: cell?.hasMore ?? false, nextCursor: cell?.nextCursor ?? null, calculation: null }
        })
        return (
          <section key={lane.key} data-testid="db-lane" data-lane-key={lane.key} data-collapsed={folded || undefined} aria-label={label} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1 px-1 text-sm font-medium">
              <button
                type="button"
                data-testid="db-lane-toggle"
                aria-expanded={!folded}
                aria-label={`${label} ${folded ? '펼치기' : '접기'}`}
                onClick={() => store.toggle(lane.key)}
                className="flex size-6 flex-none items-center justify-center rounded-md text-[rgb(173,169,163)] hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
              >
                <svg aria-hidden viewBox="0 0 16 16" width="12" height="12" fill="currentColor" className={folded ? '-rotate-90' : ''}>
                  <path d="M2.5 4.75h11L8 12.25z" />
                </svg>
              </button>
              {lane.option !== null && lane.statusGroup === null ? (
                <span data-testid="db-lane-label">
                  <OptionChip option={lane.option} />
                </span>
              ) : (
                <span data-testid="db-lane-label" className="text-[rgb(125,122,117)] dark:text-[#ada9a3]">
                  {label}
                </span>
              )}
              <span data-testid="db-lane-count" className="text-xs font-normal tabular-nums text-neutral-400">
                {lane.count}
              </span>
            </h3>
            {/* 접어도 보드는 살아 있다 — 숨기기만 한다(불러온 카드 · 편집 그대로) */}
            <div hidden={folded} data-testid="db-lane-body">
              <DatabaseBoard
                {...board}
                // 채울 값이 없는 가로줄(옵션 없는 범주 · 첫 글자 · 상대 날짜의 범위)에는 만들 수 없다
                access={fill === null ? { ...board.access, canCreateRows: false } : board.access}
                groups={laneGroups}
                calculation={null}
                live={false}
                lane={{ key: lane.key, propertyId: subProperty.id, cells: fill === null ? [] : prefillCells(subProperty.type, subProperty.id, fill) }}
              />
            </div>
          </section>
        )
      })}
      {(hiddenLanes > 0 || hiddenColumns > 0) && (
        <p data-testid="db-lane-hidden" className="px-1 text-sm text-neutral-500">
          {[hiddenColumns > 0 ? `숨긴 열 ${hiddenColumns}개` : null, hiddenLanes > 0 ? `숨긴 가로줄 ${hiddenLanes}개` : null].filter(Boolean).join(' · ')} —
          도구줄의 &quot;그룹&quot;에서 보이게 할 수 있습니다.
        </p>
      )}
    </div>
  )
}
