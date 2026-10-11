/**
 * 공개 표 · 공개 행의 속성 — 게시된 데이터베이스를 읽기 전용으로 그린다 (게시 · 공유 6a-2c-2 · F-06-08 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ⑩
 *
 * 재료는 `publish/public-database.ts` 가 판정과 같은 스냅샷에서 읽었다 — 여기는 그리기만 한다(서버 컴포넌트 · 스크립트 없음).
 *   · 표 — 그 뷰의 보이는 열 · 제목 칸은 그 행의 공개 주소로 가는 링크 · 처음 100줄이면 그렇다고 말한다
 *   · 행 — 제목 아래에 속성 묶음(이름 · 값)
 * 칸의 글은 `public-cells.ts`(순수)가 만든다 — 모양이 틀린 값은 빈 칸.
 */

import type { ReactNode } from 'react'

import type { PublicColumn, PublicRow, PublicRowProperties, PublicTable } from '@/lib/publish/public-database'
import { PUBLIC_TABLE_MAX_ROWS } from '@/lib/publish/public-database'
import type { PublicPageView } from '@/lib/publish/public-read'
import { RichText, UNTITLED, publicHref, titleText } from './public-blocks'
import { checkboxLabel, publicCell } from './public-cells'

function CellView({ column, value, uniqueSeq, view }: { column: PublicColumn; value: unknown; uniqueSeq: number | null; view: PublicPageView }): ReactNode {
  const cell = publicCell(column, value, uniqueSeq)
  switch (cell.kind) {
    case 'runs':
      return <RichText runs={cell.runs} view={view} />
    case 'option':
      // 옵션 색은 편집기와 같은 팔레트(`[data-color]` 의 배경)다
      return (
        <span className="pub-option" data-color={cell.option.color === 'default' ? undefined : `${cell.option.color}_background`}>
          {cell.option.name}
        </span>
      )
    case 'checkbox':
      return (
        <span className="pub-checkbox" role="img" aria-label={checkboxLabel(cell.checked)}>
          {cell.checked ? '☑' : '☐'}
        </span>
      )
    case 'text':
      return cell.text
    case 'empty':
      return null
  }
}

/** 행의 제목 칸 — 그 행의 공개 주소로 간다(표에 선 행은 공개로 열리는 행이다 · 정본 ⑩). */
function RowTitle({ row, view }: { row: PublicRow; view: PublicPageView }): ReactNode {
  return (
    <a href={publicHref(view, row.id)} className="pub-db-row-link" data-testid="public-db-row-link">
      {row.icon?.type === 'emoji' && <span aria-hidden="true">{row.icon.emoji} </span>}
      {titleText(row.title) === UNTITLED ? UNTITLED : <RichText runs={row.title} view={view} />}
    </a>
  )
}

export function PublicTableView({ table, view }: { table: PublicTable; view: PublicPageView }): ReactNode {
  // 제목 열은 늘 첫 자리에 링크로 선다 — 뷰가 제목을 다른 자리에 두었으면 그 자리
  const hasTitle = table.columns.some((c) => c.type === 'title')
  return (
    <section className="pub-db" data-testid="public-table" aria-label={table.viewName || '표'}>
      {table.viewName !== '' && <p className="pub-db-view">{table.viewName}</p>}
      {table.rows.length === 0 ? (
        <p className="pub-note" data-testid="public-table-empty">
          표시할 항목이 없습니다.
        </p>
      ) : (
        <div className="pub-table-wrap">
          <table className="pub-table pub-db-table">
            <thead>
              <tr>
                {!hasTitle && <th scope="col">이름</th>}
                {table.columns.map((column) => (
                  <th key={column.id} scope="col">
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id} data-testid="public-db-row" data-row-id={row.id}>
                  {!hasTitle && (
                    <td>
                      <RowTitle row={row} view={view} />
                    </td>
                  )}
                  {table.columns.map((column) => (
                    <td key={column.id}>
                      {column.type === 'title' ? (
                        <RowTitle row={row} view={view} />
                      ) : (
                        <CellView column={column} value={row.cells[column.id]} uniqueSeq={row.uniqueSeq} view={view} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.truncated && (
        <p className="pub-note" data-testid="public-table-truncated">
          처음 {PUBLIC_TABLE_MAX_ROWS}개 항목만 보입니다.
        </p>
      )}
    </section>
  )
}

export function PublicRowPropertiesView({ properties, view }: { properties: PublicRowProperties; view: PublicPageView }): ReactNode {
  if (properties.columns.length === 0) return null
  return (
    <dl className="pub-props" data-testid="public-row-properties">
      {properties.columns.map((column) => (
        <div key={column.id} className="pub-prop" data-testid="public-row-property">
          <dt>{column.name}</dt>
          <dd>
            <CellView column={column} value={properties.cells[column.id]} uniqueSeq={properties.uniqueSeq} view={view} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
