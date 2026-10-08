'use client'

/**
 * 카드의 속성 배지 — 보드 · 갤러리가 같이 쓴다 (갤러리 2f-1 에서 보드 카드에서 꺼냈다)
 *
 * 보이는 컬럼(제목 · 그룹 프로퍼티는 부르는 쪽이 뺀다)을 뷰 순서로 한 줄씩. **값이 빈 배지는 그리지 않는다** — 카드는 좁아서 빈 줄이
 * 쌓이면 카드끼리 높이만 달라진다. 체크박스는 켜진 것만 `☑ 이름` 이다.
 *
 * rollup 배지는 아직 없다 — 값이 행에 없어서 카드마다 따로 물어야 한다(표 · 목록은 5c-2 가 그린다 · §7).
 */

import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import { isEmptyValue, readRelationValue } from '@/lib/database/property-types'
import { cellText, readCell } from '@/lib/database/cell-format'
import { formatUniqueId } from '@/lib/database/unique-id-format'
import { CellDisplay, RelationChips, type RelationIcons, type RelationLabels } from './cell-view'

export function CardBadges({
  row,
  columns,
  relationLabels,
  relationIcons,
  testId,
}: {
  row: RowJson
  columns: readonly ViewColumn[]
  relationLabels: RelationLabels
  relationIcons: RelationIcons
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
        if (column.type === 'rollup') return null
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
            {value.type === 'select' || value.type === 'status' ? (
              <CellDisplay value={value} options={column.options} />
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
