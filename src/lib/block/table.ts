/**
 * 심플 테이블의 값 — Phase 2 1d (F-01-18 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 심플 테이블 · 01-block-editor.md F-01-18
 *
 *   · 표(`type='table'`)의 `properties` 는 머리 플래그 둘(`has_column_header` · `has_row_header` — 공개 API 이름). 열 수
 *     (`table_width`)는 저장하지 않는다 — 행의 셀 수가 정한다(모든 행이 같다)
 *   · 행(`type='table_row'`)의 `properties.cells` 는 **RichText[][]**(가로 표시 순서) — 셀은 rich text 만 담는다(블록 없음).
 *     글(title) · 색 · 자식이 없다
 *   · 편집기 · Y.Doc 에서는 행이 표의 내용 노드 안에 산다(`editor/schema.ts` · `pm-adapter.ts`) — 이 파일은 저장 모양만 다룬다
 */

import { validateRichText, type RichTextRun } from '../contracts/rich-text.ts'

export const TABLE_TYPE = 'table' as const
export const TABLE_ROW_TYPE = 'table_row' as const

/** 행의 셀들이 사는 키. */
export const TABLE_CELLS_KEY = 'cells'
/** 첫 행을 머리 줄로 그린다(굵게 · 배경). */
export const COLUMN_HEADER_KEY = 'has_column_header'
/** 첫 열을 머리 열로 그린다. */
export const ROW_HEADER_KEY = 'has_row_header'

/** `/표` 가 만드는 크기 — 열 · 행. */
export const NEW_TABLE_COLUMNS = 3
export const NEW_TABLE_ROWS = 2

/** 행의 셀들 — 배열이 아닌 것은 빈 셀로 읽는다(검증은 `validateTableRow`). */
export function cellsOf(properties: Readonly<Record<string, unknown>> | undefined): RichTextRun[][] {
  const raw = properties?.[TABLE_CELLS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.map((cell) => (Array.isArray(cell) ? (cell as RichTextRun[]) : []))
}

/** 행 속성에서 셀을 뺀 나머지 — 편집기는 셀을 노드로 들고 나머지만 attr 로 싣는다. */
export function rowPropsWithoutCells(properties: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(properties ?? {}) }
  delete rest[TABLE_CELLS_KEY]
  return rest
}

type Issue = { path: string; message: string }

/** 행 하나의 셀 — 배열의 배열 · 하나 이상 · 셀마다 RichText 계약. 열 수가 행마다 같은지는 표가 본다(`validateTableWidths`). */
export function validateTableRow(properties: unknown, path: string): Issue[] {
  const cells = (properties as Record<string, unknown> | undefined)?.[TABLE_CELLS_KEY]
  if (!Array.isArray(cells)) return [{ path: `${path}.${TABLE_CELLS_KEY}`, message: '셀의 배열이어야 합니다' }]
  if (cells.length === 0) return [{ path: `${path}.${TABLE_CELLS_KEY}`, message: '셀이 하나 이상이어야 합니다' }]
  return cells.flatMap((cell, i) => validateRichText(cell, `${path}.${TABLE_CELLS_KEY}[${i}]`))
}

/** 표의 행들 — 하나 이상 · 모든 행의 셀 수가 같다. */
export function validateTableWidths(rows: readonly { properties?: Record<string, unknown> }[], path: string): Issue[] {
  if (rows.length === 0) return [{ path, message: '표에는 행이 하나 이상 있어야 합니다' }]
  const widths = rows.map((row) => {
    const cells = row.properties?.[TABLE_CELLS_KEY]
    return Array.isArray(cells) ? cells.length : -1
  })
  return widths.every((w) => w === widths[0]) ? [] : [{ path, message: `행마다 셀 수가 같아야 합니다: ${widths.join(' · ')}` }]
}
