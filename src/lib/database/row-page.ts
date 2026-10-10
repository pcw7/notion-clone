/**
 * 행 페이지 — 데이터베이스 행을 페이지로 열 때 필요한 것 (잔여 묶음 8f-1 · F-16-07 · F-16-03)
 *
 * 정본: 00-canonical-data-model.md §3.6 `page_layout` · `layout_tab` · `layout_module` · [보강] 행의 레이아웃(8f-2) · 판결 C-3(행 = 블록)
 *       16-item-layout.md F-16-07 *"모듈 배치는 레이아웃(전 행 공통), 본문 블록은 행 소유(행마다 다름)"* · F-16-03 Property group
 *
 * 행은 페이지다(C-3) — 본문 · 코멘트 · 기록 · 잠금은 페이지 화면이 그대로 쓴다. 다른 것은 **본문 위의 속성 묶음**과 **제목의 정본**(제목 셀)
 * 이다. 이 모듈은 페이지 화면이 행을 알아보고 그 둘을 그리는 데 필요한 것을 한 번에 읽는다.
 *
 *   · 행인가 — `page` 확장 행이 있고(템플릿 제외) 그 소스가 살아 있다. 아니면 null(보통 페이지다)
 *   · 속성 묶음 — 스키마 순서(`readRecordColumns`) 위에 레이아웃의 숨김을 얹는다(`readRecordLayout` — 숨긴 속성은 `visible: false`).
 *     순서는 레이아웃이 따로 갖지 않는다 — 적용이 스키마 순서를 고친다(8f-2)
 *   · 권한 — 볼 수 있는지는 페이지 화면이 이미 물었다(`getPage`). 셀 · 구조를 고칠 수 있는지는 데이터베이스의 것이다(`getDatabase`).
 *     데이터베이스가 잠기면 구조(옵션 만들기 · 레이아웃)는 닫는다 — 데이터베이스 화면과 같다(7f-2)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { PageIcon } from '../block/page-icon.ts'
import { isLocked } from '../permissions/lock.ts'
import { getDatabase, type DatabaseAccess } from './database.ts'
import { readRecordLayout } from './layout.ts'
import type { PageSettings } from './page-settings.ts'
import { readRow, type RowSummary } from './row.ts'
import { readRecordColumns } from './view.ts'
import type { ViewColumn } from './view-columns.ts'

export type RowPage = {
  readonly databaseId: string
  readonly databaseName: string
  readonly databaseIcon: PageIcon | null
  readonly dataSourceId: string
  /** 표의 이름 — 소스가 둘 이상이면 이 행의 소스 이름(데이터베이스 화면 · 템플릿 화면과 같은 규칙 · 8e-2). */
  readonly tableName: string
  /** 그 소스의 첫 뷰 — 표(`DatabaseTable`)가 뷰 하나를 받는다(레코드 모양에서는 쓰지 않는다). */
  readonly viewId: string
  /** 속성 묶음 — 스키마 순서 · 레이아웃이 숨긴 것은 `visible: false`. 제목 · rollup 은 화면이 뺀다(`listColumns('record', …)`). */
  readonly columns: readonly ViewColumn[]
  /** 레이아웃의 버전 — 편집 모드가 적용할 때 낙관적 잠금으로 보낸다(머리가 없으면 `'0'`). */
  readonly layoutVersion: string
  /** 제목 아래에 고정한 속성(3a-1 · F-16-02) — heading 안의 순서. `columns` 에도 그대로 있다(속성 묶음에서 빼는 것은 화면이다). */
  readonly pinned: readonly string[]
  /** 페이지 설정(3b-1 · F-16-09 · F-16-10) — 이 데이터베이스의 모든 행에 같다. 머리가 없으면 기본값. */
  readonly settings: PageSettings
  /** 본문 영역의 줄(3c-1 · F-16-04) — 속성 id 와 속성 묶음(`GROUP_MODULE`). 올린 속성도 `columns` 에 그대로 있다. */
  readonly main: readonly string[]
  /** 상세 패널의 속성(3c-1 · F-16-05). */
  readonly panel: readonly string[]
  /** 직전 레이아웃으로 되돌릴 수 있다(3e-2 · F-16-12 — 직전 버전이 지금 버전을 만든 적용의 것이다). */
  readonly layoutUndo: boolean
  readonly titlePropertyId: string | null
  readonly row: RowSummary
  readonly access: DatabaseAccess
}

/**
 * 이 페이지가 데이터베이스 행이면 행 페이지에 필요한 것을, 아니면 null 을 준다. 볼 수 있는지는 부르는 쪽이 이미 물었다(`getPage`) —
 * 여기서는 그 행이 속한 데이터베이스를 읽을 수 있는지만 다시 본다(`getDatabase` — 못 보면 null).
 */
export async function readRowPage(ctx: SessionContext, pageId: string): Promise<RowPage | null> {
  const found = await withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ data_source_id: string; database_id: string }>(
      `SELECT p.data_source_id, ds.owner_database_id AS database_id
         FROM page p
         JOIN block b ON b.id = p.id
         JOIN data_source ds ON ds.id = p.data_source_id
        WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
          AND p.is_template = false AND ds.lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (row === null) return null
    const view = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM view
        WHERE database_id = $1 AND data_source_id = $2 AND owner_kind = 'database_view'
        ORDER BY order_idx, id LIMIT 1`,
      [row.database_id, row.data_source_id],
    )
    const summary = await readRow(tx, pageId)
    if (view === null || summary === null) return null
    const [columns, layout, locked, kept] = await Promise.all([
      readRecordColumns(tx, row.data_source_id),
      readRecordLayout(tx, row.data_source_id),
      isLocked(tx, row.database_id),
      tx.queryMaybe<{ after_version: string }>(
        `SELECT after_version::text AS after_version FROM page_layout_history WHERE data_source_id = $1`,
        [row.data_source_id],
      ),
    ])
    const hidden = new Set(layout.hidden)
    return {
      ...row,
      viewId: view.id,
      summary,
      columns: columns.map((c) => (hidden.has(c.propertyId) ? { ...c, visible: false } : c)),
      layoutVersion: layout.version,
      pinned: layout.pinned,
      settings: layout.settings,
      main: layout.main,
      panel: layout.panel,
      layoutUndo: kept !== null && kept.after_version === layout.version,
      locked,
    }
  })
  if (found === null) return null

  const database = await getDatabase(ctx, found.database_id)
  if (!database.ok) return null
  const sources = database.value.dataSources
  const source = sources.find((ds) => ds.id === found.data_source_id)
  return {
    databaseId: found.database_id,
    databaseName: database.value.name,
    databaseIcon: database.value.icon,
    dataSourceId: found.data_source_id,
    tableName: sources.length > 1 && source !== undefined ? source.name : database.value.name,
    viewId: found.viewId,
    columns: found.columns,
    layoutVersion: found.layoutVersion,
    pinned: found.pinned,
    settings: found.settings,
    main: found.main,
    panel: found.panel,
    layoutUndo: found.layoutUndo,
    titlePropertyId: found.columns.find((c) => c.type === 'title')?.propertyId ?? null,
    row: found.summary,
    access: found.locked ? { ...database.value.access, canEditStructure: false } : database.value.access,
  }
}
