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

import { buildBoardColumns } from '@/lib/publish/public-board'
import type { PublicBoard, PublicColumn, PublicRow, PublicRowProperties, PublicTable } from '@/lib/publish/public-database'
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

/** 목록의 줄 · 갤러리 · 보드의 카드가 쓰는 속성 줄 — 제목 열은 머리라 뺀다. 값이 빈 칸은 그리지 않는다. */
function CardProps({ table, row, view }: { table: PublicTable; row: PublicRow; view: PublicPageView }): ReactNode {
  const shown = table.columns.filter((c) => c.type !== 'title' && publicCell(c, row.cells[c.id], row.uniqueSeq).kind !== 'empty')
  if (shown.length === 0) return null
  return (
    <span className="pub-card-props">
      {shown.map((column) => (
        <span key={column.id} className="pub-card-prop" title={column.name}>
          <CellView column={column} value={row.cells[column.id]} uniqueSeq={row.uniqueSeq} view={view} />
        </span>
      ))}
    </span>
  )
}

function RowCard({ table, row, view }: { table: PublicTable; row: PublicRow; view: PublicPageView }): ReactNode {
  return (
    <div className="pub-card" data-testid="public-card" data-row-id={row.id}>
      <RowTitle row={row} view={view} />
      <CardProps table={table} row={row} view={view} />
    </div>
  )
}

function ListView({ table, view }: { table: PublicTable; view: PublicPageView }): ReactNode {
  return (
    <ul className="pub-db-list" data-testid="public-db-list">
      {table.rows.map((row) => (
        <li key={row.id} className="pub-db-list-item" data-testid="public-db-row" data-row-id={row.id}>
          <RowTitle row={row} view={view} />
          <CardProps table={table} row={row} view={view} />
        </li>
      ))}
    </ul>
  )
}

function GalleryView({ table, view }: { table: PublicTable; view: PublicPageView }): ReactNode {
  return (
    <div className="pub-db-gallery" data-size={table.cardSize} data-testid="public-db-gallery">
      {table.rows.map((row) => (
        <RowCard key={row.id} table={table} row={row} view={view} />
      ))}
    </div>
  )
}

function BoardView({ table, board, view }: { table: PublicTable; board: PublicBoard; view: PublicPageView }): ReactNode {
  const columns = buildBoardColumns(board.spec, table.rows, (row) => row.groupKey ?? '')
  return (
    <div className="pub-db-board" data-testid="public-db-board">
      {columns.map((column) => (
        <section key={column.key} className="pub-board-column" data-testid="public-board-column" data-group={column.key} aria-label={column.name}>
          <h3 className="pub-board-head">
            <span className="pub-option" data-color={column.color === null || column.color === 'default' ? undefined : `${column.color}_background`}>
              {column.name}
            </span>{' '}
            <span className="pub-board-count">{column.rows.length}</span>
          </h3>
          {column.rows.map((row) => (
            <RowCard key={row.id} table={table} row={row} view={view} />
          ))}
        </section>
      ))}
    </div>
  )
}

export function PublicTableView({ table, view }: { table: PublicTable; view: PublicPageView }): ReactNode {
  const body =
    table.layout === 'table'
      ? undefined
      : table.rows.length === 0
        ? null
        : table.layout === 'board' && table.board !== null
          ? <BoardView table={table} board={table.board} view={view} />
          : table.layout === 'list'
            ? <ListView table={table} view={view} />
            : table.layout === 'gallery'
              ? <GalleryView table={table} view={view} />
              : undefined
  // 목록 · 갤러리 · 보드는 자기 그림 — 아니면(undefined) 표
  if (body !== undefined) {
    return (
      <section className="pub-db" data-testid="public-table" data-layout={table.layout} aria-label={table.viewName || '데이터베이스'}>
        {table.viewName !== '' && <p className="pub-db-view">{table.viewName}</p>}
        {body === null ? (
          <p className="pub-note" data-testid="public-table-empty">
            표시할 항목이 없습니다.
          </p>
        ) : (
          body
        )}
        {table.truncated && (
          <p className="pub-note" data-testid="public-table-truncated">
            처음 {PUBLIC_TABLE_MAX_ROWS}개 항목만 보입니다.
          </p>
        )}
      </section>
    )
  }
  return <PublicTableGrid table={table} view={view} />
}

function PublicTableGrid({ table, view }: { table: PublicTable; view: PublicPageView }): ReactNode {
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
