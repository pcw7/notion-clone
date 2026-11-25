'use client'

/**
 * 표 · 목록의 그룹 — 그룹마다 한 덩이 (그룹 트랙 G-1 · 04 F-04-04 · F-04-11 · 정본 §3.6 [보강 G-1])
 *
 * 머리(그룹 이름 — 옵션 칩 · 체크 · "값 없음" · 개수 또는 머리의 계산) 아래에 그 그룹의 표(`DatabaseTable` 의 그룹 덩이 모드 — 그 그룹의
 * 행만 읽고 · 그 그룹만의 "더 보기" · "새로 만들기"가 그 그룹의 값을 채운다). 순서는 보드의 열 순서(옵션 순서). 숨긴 그룹은 그 수만 말한다.
 *
 * 표 변경 신호의 구독은 **여기서 하나** — 덩이마다 구독하면 그룹 수만큼 연결이 열린다(브라우저의 서버당 동시 연결 상한 · ④). 신호가 오면
 * 덩이들에 다시 읽기를 알리고(`liveTick`) 화면을 다시 그려 머리(개수 · 그룹 목록)를 맞춘다. 덩이는 그룹 키로 붙어 있어 다시 그려도 불러온
 * 행 · 편집 상태를 잃지 않는다.
 *
 * 덩이 접기(G-2a · ⑥) — 머리의 펼침 단추. 접은 키는 보는 사람의 이 기기에(`group-collapse.ts`). 접어도 표는 숨기기만 한다(상태 · 다시 읽기 그대로).
 *
 * 덩이 사이의 행 끌기(G-2c · ⑧) — 덩이들이 서로를 찾는 자리(`group-lanes.ts`)를 여기 하나 두고 덩이들에 나눠 준다.
 *
 * 갤러리의 그룹(G-3a · 정본 [보강 G-3]) — 표 대신 덩이마다 카드 격자(`gallery`). 머리 · 접기 · 숨긴 그룹 · 구독 하나는 같다 — 갤러리는
 * 신호에 서버 렌더를 다시 불러 제 그룹의 첫 페이지를 받아들인다(`liveTick` 을 쓰지 않는다).
 *
 * 바뀐 행만(RT-5 · 정본 X-5 의 단계 ㉔) — 표 · 목록의 덩이는 다시 읽지 않고 합친다: 여기서 그룹 델타(행마다 그룹 키 · 그 그룹 안의 이웃 · 그룹
 * 머리)를 한 번 묻고 덩이마다 제 몫(`deltaForGroup`)을 넘긴다(`GroupSyncContext`). 어긋난 덩이만 제 그룹을 다시 읽는다. 머리(개수 · 계산)는
 * 델타의 것으로 갈아 끼운다. 그룹 목록이 바뀌었거나(그룹이 생기거나 사라졌다) 서버가 그룹 자리를 주지 못하면(여러 값 · 부모만) 지금처럼
 * 덩이들을 다시 읽고 화면을 다시 부른다. 그룹 갤러리는 다시 읽기 그대로다.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'

import { fillKeyOf, groupLabel, prefillCells } from '@/lib/database/board-drag'
import { CALCULATION_LABEL, formatCalculation, type Calculation } from '@/lib/database/calculations'
import type { Calculations } from '@/lib/database/calculate'
import type { DeltaGroupHead } from '@/lib/database/delta-merge'
import { deltaForGroup, groupedDeltaFallback, MAX_GROUP_PAGES } from '@/lib/database/grouped-delta-merge'
import { OptionChip } from './cell-view'
import { DatabaseTable } from './database-table'
import { DatabaseGallery } from './database-gallery'
import type { BoardGroupJson, GroupProperty } from './database-board'
import { useViewDeltaSync } from './use-view-delta-sync'
import * as api from './table-api'
import { getGroupCollapseStore } from './group-collapse'
import { createGroupLanes, createGroupSyncs, GroupLanesContext, GroupSyncContext, type GroupChunkPage } from './group-lanes'
import { useViewerToday } from './use-viewer-today'

type TableProps = ComponentProps<typeof DatabaseTable>
type GalleryProps = ComponentProps<typeof DatabaseGallery>

export function GroupedRows({
  property,
  groups,
  calculation,
  columnCalculations,
  table,
  gallery,
}: {
  property: GroupProperty
  groups: readonly BoardGroupJson[]
  /** 그룹 머리의 계산(보드와 같다) — 없으면 머리는 개수. */
  calculation: { readonly propertyId: string; readonly propertyName: string; readonly fn: Calculation } | null
  /** 덩이마다 열 집계(G-2d · ⑨) — 그룹 키 → 그 그룹의 행 전부로 계산한 값. 표 모양만 온다. */
  columnCalculations?: Readonly<Record<string, Calculations>>
  /** 덩이마다 같은 표의 재료 — 행 · 커서 · 그룹 · 신호는 여기서 넣는다. `gallery` 와 둘 중 하나. */
  table?: Omit<TableProps, 'rows' | 'hasMore' | 'nextCursor' | 'group' | 'liveTick' | 'calculations' | 'subItems' | 'key'>
  /** 갤러리의 그룹(G-3a) — 덩이마다 같은 갤러리의 재료. 행 · 커서 · 그룹은 여기서 넣는다. */
  gallery?: Omit<GalleryProps, 'rows' | 'hasMore' | 'nextCursor' | 'group' | 'live' | 'key'>
}) {
  const base = (table ?? gallery)!
  const router = useRouter()
  const [tick, setTick] = useState(0)
  const [lanes] = useState(() => createGroupLanes())
  const [syncs] = useState(() => createGroupSyncs())
  // 상대 날짜 그룹(B-3) — 서버의 오늘이 이 기기의 오늘과 다르면 쿠키를 맞추고 한 번 새로 받는다
  useViewerToday(property.today)
  const groupsRef = useRef(groups)
  useEffect(() => {
    groupsRef.current = groups
  })
  /** 델타가 준 머리(개수 · 계산) — 그 그룹 목록(`of`)의 것만 쓴다(서버 화면이 새로 오면 그것이 이긴다). */
  const [heads, setHeads] = useState<{ readonly of: readonly BoardGroupJson[]; readonly by: ReadonlyMap<string, DeltaGroupHead> } | null>(null)
  const headOf = (group: BoardGroupJson): BoardGroupJson => {
    const head = heads !== null && heads.of === groups ? heads.by.get(group.key) : undefined
    return head === undefined ? group : { ...group, count: head.count, calculation: head.calculation }
  }
  const syncStats = useViewDeltaSync({
    workspaceId: base.workspaceId,
    dataSourceId: base.dataSourceId,
    viewId: base.viewId,
    // 바쁜 것은 덩이마다 따로 — 바쁜 덩이는 끝난 뒤 제 그룹을 다시 읽는다(㉕)
    busy: false,
    enabled: true,
    renderedAt: base.renderedAt,
    // 그룹 갤러리 · 여러 값 그룹은 다시 읽는다(㉓)
    deltaCapable: table !== undefined && property.type !== 'multi_select',
    server: groups,
    // 처음부터 — 덩이마다 제 그룹을 다시 읽고(G-1 ④) 화면을 다시 불러 머리(개수 · 그룹 목록)를 맞춘다
    full: () => {
      setTick((n) => n + 1)
      router.refresh()
    },
    attempt: async (after) => {
      const shown = groupsRef.current
      const sent = new Map<string, GroupChunkPage | null>()
      const pages: Record<string, string> = {}
      for (const g of shown) {
        if (g.hidden) continue
        const sync = syncs.get(g.key)
        // 아직 서지 않은 덩이 — 제 몫을 받을 곳이 없다
        if (sync === undefined) return { kind: 'full', cursor: null }
        const page = sync.page()
        sent.set(g.key, page)
        if (page !== null && page.hasMore && page.cursor !== null) pages[g.key] = page.cursor
      }
      if (Object.keys(pages).length > MAX_GROUP_PAGES) return { kind: 'full', cursor: null }
      const result = await api.loadDelta(base.workspaceId, base.dataSourceId, base.viewId, after, {
        search: base.search ?? null,
        pages,
        // 덩이의 집계 줄(G-2d)은 표 모양만 그린다 — 집계가 걸린 열이 있을 때만 묻는다
        calculations: table?.variant === 'table' && table.columns.some((c) => c.calculation != null),
      })
      // 묻는 사이 그룹 목록이 새로 왔다(서버 화면) — 그 덩이들로 다시 묻는다
      if (groupsRef.current !== shown) return { kind: 'retry' }
      if (!result.ok || result.value === null) return { kind: 'full', cursor: null }
      const delta = result.value
      if (groupedDeltaFallback(delta, shown) !== null) return { kind: 'full', cursor: delta.cursor }
      let partial = false
      if (delta.rows.length > 0) {
        for (const g of shown) {
          if (g.hidden) continue
          const ok = syncs.get(g.key)?.apply(deltaForGroup(delta.rows, g.key), sent.get(g.key) ?? null, delta.groupCalculations?.[g.key]) ?? false
          if (!ok) partial = true
        }
        if (delta.groups !== undefined) setHeads({ of: shown, by: new Map(delta.groups.map((h) => [h.key, h])) })
      }
      return { kind: 'applied', cursor: delta.cursor, behind: delta.behind, partial }
    },
  })

  const collapseStore = getGroupCollapseStore(base.viewId)
  const collapsed = useSyncExternalStore(collapseStore.subscribe, collapseStore.getSnapshot, collapseStore.getServerSnapshot)
  const shown = groups.filter((g) => !g.hidden)
  const hiddenCount = groups.length - shown.length
  return (
    <GroupLanesContext.Provider value={lanes}>
    <GroupSyncContext.Provider value={syncs}>
    <div
      data-testid="db-grouped"
      // 마지막 맞추기가 델타였나 다시 읽기였나 · 센 수(RT-5 — 검사용 · 그리지 않는다 · 덩이 하나라도 다시 읽었으면 다시 읽기)
      data-sync={syncStats.last ?? undefined}
      data-sync-delta={syncStats.delta}
      data-sync-full={syncStats.full}
      className="flex flex-col gap-6"
    >
      {shown.map((shownGroup) => {
        // 머리(개수 · 계산)는 델타가 준 것이 있으면 그것(㉔)
        const group = headOf(shownGroup)
        const fill = fillKeyOf(group, property)
        const label = groupLabel(property.type, property.name, group, property)
        const folded = collapsed.has(group.key)
        return (
          <section
            key={group.key}
            data-testid="db-group"
            data-group-key={group.key}
            data-collapsed={folded || undefined}
            aria-label={label}
            className="flex flex-col gap-1"
          >
            <h3 className="flex items-center gap-1 px-1 text-sm font-medium">
              <button
                type="button"
                data-testid="db-group-toggle"
                aria-expanded={!folded}
                aria-label={`${label} ${folded ? '펼치기' : '접기'}`}
                onClick={() => collapseStore.toggle(group.key)}
                className="flex size-6 flex-none items-center justify-center rounded-md text-[rgb(173,169,163)] hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
              >
                <svg aria-hidden viewBox="0 0 16 16" width="12" height="12" fill="currentColor" className={folded ? '-rotate-90' : ''}>
                  <path d="M2.5 4.75h11L8 12.25z" />
                </svg>
              </button>
              {group.option !== null && group.statusGroup === null ? (
                <span data-testid="db-group-label">
                  <OptionChip option={group.option} />
                </span>
              ) : (
                <span data-testid="db-group-label" className="text-[rgb(125,122,117)] dark:text-[#ada9a3]">
                  {label}
                </span>
              )}
              {calculation !== null && group.calculation !== null ? (
                <span
                  data-testid="db-group-calc"
                  title={`${calculation.propertyName} · ${CALCULATION_LABEL[calculation.fn]}`}
                  className="text-xs font-normal tabular-nums text-neutral-500 dark:text-neutral-400"
                >
                  {formatCalculation(group.calculation)}
                </span>
              ) : (
                <span data-testid="db-group-count" className="text-xs font-normal tabular-nums text-neutral-400">
                  {group.count}
                </span>
              )}
            </h3>
            {/* 접어도 표는 살아 있다 — 숨기기만 한다(불러온 행 · 편집 · 실시간 다시 읽기 그대로) */}
            <div hidden={folded} data-testid="db-group-body">
            {table !== undefined && (
            <DatabaseTable
              {...table}
              // 채울 값이 없는 범주(10n-27 — 범주에 옵션이 없다)에는 만들 수 없다 — "새로 만들기"를 세우지 않는다
              access={fill === null ? { ...table.access, canCreateRows: false } : table.access}
              rows={[...group.rows]}
              hasMore={group.hasMore}
              nextCursor={group.nextCursor}
              group={{ key: group.key, cells: fill === null ? [] : prefillCells(property.type, property.id, fill), accepts: fill !== null }}
              liveTick={tick}
              subItems={null}
              calculations={columnCalculations?.[group.key]}
            />
            )}
            {table === undefined && gallery !== undefined && (
              <DatabaseGallery
                {...gallery}
                access={fill === null ? { ...gallery.access, canCreateRows: false } : gallery.access}
                rows={[...group.rows]}
                hasMore={group.hasMore}
                nextCursor={group.nextCursor}
                group={{ key: group.key, cells: fill === null ? [] : prefillCells(property.type, property.id, fill), accepts: fill !== null }}
                live={false}
              />
            )}
            </div>
          </section>
        )
      })}
      {hiddenCount > 0 && (
        <p data-testid="db-group-hidden" className="px-1 text-sm text-neutral-500">
          숨긴 그룹 {hiddenCount}개 — 도구줄의 &quot;그룹&quot;에서 보이게 할 수 있습니다.
        </p>
      )}
    </div>
    </GroupSyncContext.Provider>
    </GroupLanesContext.Provider>
  )
}
