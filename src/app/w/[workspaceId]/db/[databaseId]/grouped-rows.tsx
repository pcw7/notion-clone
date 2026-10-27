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
 */

import { useState, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'

import { fillKeyOf, groupLabel, prefillCells } from '@/lib/database/board-drag'
import { CALCULATION_LABEL, formatCalculation, type Calculation } from '@/lib/database/calculations'
import { OptionChip } from './cell-view'
import { DatabaseTable } from './database-table'
import type { BoardGroupJson, GroupProperty } from './database-board'
import { useTableChanges } from './use-table-changes'

type TableProps = ComponentProps<typeof DatabaseTable>

export function GroupedRows({
  property,
  groups,
  calculation,
  table,
}: {
  property: GroupProperty
  groups: readonly BoardGroupJson[]
  /** 그룹 머리의 계산(보드와 같다) — 없으면 머리는 개수. */
  calculation: { readonly propertyId: string; readonly propertyName: string; readonly fn: Calculation } | null
  /** 덩이마다 같은 표의 재료 — 행 · 커서 · 그룹 · 신호는 여기서 넣는다. */
  table: Omit<TableProps, 'rows' | 'hasMore' | 'nextCursor' | 'group' | 'liveTick' | 'calculations' | 'subItems' | 'key'>
}) {
  const router = useRouter()
  const [tick, setTick] = useState(0)
  useTableChanges(
    table.workspaceId,
    table.dataSourceId,
    {
      onChanged: () => {
        setTick((n) => n + 1)
        router.refresh()
      },
      onRevoked: () => router.refresh(),
    },
    true,
    table.renderedAt,
  )

  const shown = groups.filter((g) => !g.hidden)
  const hiddenCount = groups.length - shown.length
  return (
    <div data-testid="db-grouped" className="flex flex-col gap-6">
      {shown.map((group) => {
        const fill = fillKeyOf(group)
        const label = groupLabel(property.type, property.name, group)
        return (
          <section key={group.key} data-testid="db-group" data-group-key={group.key} aria-label={label} className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 px-1 text-sm font-medium">
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
            <DatabaseTable
              {...table}
              // 채울 값이 없는 범주(10n-27 — 범주에 옵션이 없다)에는 만들 수 없다 — "새로 만들기"를 세우지 않는다
              access={fill === null ? { ...table.access, canCreateRows: false } : table.access}
              rows={[...group.rows]}
              hasMore={group.hasMore}
              nextCursor={group.nextCursor}
              group={{ key: group.key, cells: fill === null ? [] : prefillCells(property.type, property.id, fill) }}
              liveTick={tick}
              subItems={null}
            />
          </section>
        )
      })}
      {hiddenCount > 0 && (
        <p data-testid="db-group-hidden" className="px-1 text-sm text-neutral-500">
          숨긴 그룹 {hiddenCount}개 — 도구줄의 &quot;그룹&quot;에서 보이게 할 수 있습니다.
        </p>
      )}
    </div>
  )
}
