'use client'

/**
 * 카드의 속성 배지 — 보드 · 갤러리가 같이 쓴다 (갤러리 2f-1 에서 보드 카드에서 꺼냈다)
 *
 * 보이는 컬럼(제목 · 그룹 프로퍼티는 부르는 쪽이 뺀다)을 뷰 순서로 한 줄씩. **값이 빈 배지는 그리지 않는다** — 카드는 좁아서 빈 줄이
 * 쌓이면 카드끼리 높이만 달라진다. 체크박스는 켜진 것만 `☑ 이름` 이다.
 *
 * rollup 배지(10n-33) — 값이 행에 없어서 부르는 쪽이 따로 받아 넘긴다(`useRollupValues` · 표 · 목록과 같은 훅). 그릴 것이 없으면
 * (`rollupIsEmpty` — 받지 못했다 · 없음 · 빈 목록) 서지 않는다 — 다른 배지와 같은 규칙이다. 설정이 끊긴 rollup(관계 · 대상이 지워졌다)도
 * 카드에는 세우지 않는다 — 표의 칸이 그렇다고 말하고, 좁은 카드에 고장 안내가 쌓이면 값이 묻힌다.
 */

import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import { isEmptyValue, readRelationValue } from '@/lib/database/property-types'
import { cellText, readCell } from '@/lib/database/cell-format'
import { formatUniqueId } from '@/lib/database/unique-id-format'
import { showsRollupBadge, type RollupPage } from '@/lib/database/rollup-functions'
import { CellDisplay, RelationChips, RollupDisplay, type RelationIcons, type RelationLabels, type PeopleNames } from './cell-view'
import { ButtonCell } from './button-cell'

export function CardBadges({
  row,
  columns,
  relationLabels,
  relationIcons,
  testId,
  button,
  peopleNames = {},
  rollups,
}: {
  row: RowJson
  columns: readonly ViewColumn[]
  relationLabels: RelationLabels
  relationIcons: RelationIcons
  /** rollup 칸의 값(10n-33) — 없으면 rollup 배지는 서지 않는다. */
  rollups?: RollupPage
  /** 사람 칸의 이름(6g-2) — 없으면 빈 지도(칩은 "떠난 사용자"). */
  peopleNames?: PeopleNames
  /** 버튼 칸(5a-4)을 세울 때 — 워크스페이스와 누를 수 있는가. 없으면 버튼은 서지 않는다. */
  button?: { readonly workspaceId: string; readonly canPress: boolean }
  /** 배지 하나의 `data-testid` — 보드는 `db-board-badge`, 갤러리는 `db-gallery-badge`. */
  testId: string
}) {
  return (
    <>
      {columns.map((column) => {
        if (column.type === 'relation') {
          const related = readRelationValue(row.properties[column.propertyId])
          if (related.count === 0) return null
          return (
            <span key={column.propertyId} title={column.name} data-testid={testId} className="max-w-full">
              <RelationChips value={related} labels={relationLabels} icons={relationIcons} />
            </span>
          )
        }
        // 수식(2i-2)도 — 값이 행에 없다(읽을 때 계산 · 카드에는 아직 싣지 않는다 · §7).
        // 버튼(5a-4) — 카드에도 단추가 선다(누르기가 카드를 열지 않는다 · `ButtonCell`)
        if (column.type === 'button') {
          if (button === undefined) return null
          return (
            <span key={column.propertyId} data-testid={testId} className="max-w-full">
              <ButtonCell workspaceId={button.workspaceId} rowId={row.id} propertyId={column.propertyId} name={column.name} canPress={button.canPress} />
            </span>
          )
        }
        // rollup(10n-33) — 받아 둔 값으로. 그릴 것이 없거나 설정이 끊겼으면 서지 않는다(머리말).
        if (column.type === 'rollup') {
          const info = rollups?.columns[column.propertyId]
          const cell = rollups?.values[row.id]?.[column.propertyId]
          if (!showsRollupBadge(info, cell)) return null
          return (
            <span key={column.propertyId} title={column.name} data-testid={testId} className="max-w-full text-xs text-neutral-600 dark:text-neutral-300">
              <RollupDisplay cell={cell} info={info} />
            </span>
          )
        }
        if (column.type === 'formula') return null
        // 고유 ID 는 행에 있다 — 번호를 그대로 그린다(2a-1).
        if (column.type === 'unique_id') {
          const id = formatUniqueId(column.uniqueId.prefix, row.uniqueSeq)
          if (id === '') return null
          return (
            <span
              key={column.propertyId}
              title={column.name}
              data-testid={testId}
              className="max-w-full truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
            >
              {id}
            </span>
          )
        }
        const value = readCell(column.type, row.properties[column.propertyId])
        if (value.type === 'checkbox' ? !value.checkbox : isEmptyValue(value)) return null
        return (
          <span
            key={column.propertyId}
            title={column.name}
            data-testid={testId}
            className="max-w-full truncate text-xs text-neutral-600 dark:text-neutral-300"
          >
            {value.type === 'select' || value.type === 'status' || value.type === 'people' ? (
              <CellDisplay value={value} options={column.options} names={peopleNames} />
            ) : value.type === 'checkbox' ? (
              `☑ ${column.name}`
            ) : (
              cellText(value)
            )}
          </span>
        )
      })}
    </>
  )
}
