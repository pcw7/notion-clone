/**
 * 대시보드 뷰의 명령 — DB-1 (F-04-20)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ①②③
 *
 * 대시보드는 행을 그리지 않는 탭 뷰(`type='dashboard'`)이고, 위젯은 `owner_kind='dashboard_widget'` 인 보통의 뷰다. 만들기는 `createView({ type:
 * 'dashboard' })` 가 한다(보통의 탭 만들기 길) — 여기는 읽기 · 위젯 넣기 · 위젯 지우기 · 배치 고치기.
 *
 * 권한: 읽기는 데이터베이스를 여는 문(`view`), 쓰기는 다른 뷰 명령과 같은 `edit_structure`(잠기면 `locked`). 위젯의 원본을 볼 수 없는 사람에게는
 * 그 위젯의 **이름 · 타입 · 소스를 주지 않는다**(N-2 — "볼 수 없는 위젯").
 *
 * 동시성: 배치는 배열 하나를 통째로 덮는다 — 그래서 고칠 때 **읽은 판의 `updatedAt`** 을 함께 보내고, 그 사이 바뀌었으면 `conflict`(화면은 다시 읽는다).
 * 위젯 넣기 · 지우기는 서버가 지금 판 위에서 고치므로 `updatedAt` 을 받지 않는다(더하기 · 빼기는 서로 겹치지 않는다).
 *
 * 소스가 떨어지면(`detachLinkedDataSource` — 0042 의 FK 가 그 위의 뷰를 함께 지운다) 배치에는 사라진 위젯의 칸이 남는다 — 읽을 때 걸러 내고
 * 다음 쓰기가 정리한다. 휴지통의 소스는 위젯이 남고 `sourceGone: true`.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'
import { canViewOwnerDatabase } from './source-access.ts'
import {
  DEFAULT_VIEW_NAME,
  insertViewRow,
  isFailure,
  openDatabase,
  type ViewFailure,
} from './view.ts'
import {
  isWidgetViewType,
  keepCells,
  layoutViewIds,
  placeWidget,
  readLayout,
  removeCell,
  validateLayout,
  type DashboardLayout,
  type WidgetViewType,
} from './dashboard-layout.ts'

export type DashboardFailure = ViewFailure | 'conflict' | 'full'

export type DashboardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DashboardFailure; readonly issues?: readonly ValidationIssue[] }

const fail = (reason: DashboardFailure, issues?: readonly ValidationIssue[]): DashboardResult<never> =>
  issues === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, issues } as const)

export type DashboardWidget =
  | {
      readonly id: string
      readonly accessible: true
      readonly type: string
      readonly name: string
      readonly dataSourceId: string
      /** 휴지통의 소스를 본다 — 그릴 것이 없다("지워진 소스"). 되살리면 돌아온다. */
      readonly sourceGone: boolean
    }
  | {
      /** 원본을 볼 수 없는 위젯 — 이름 · 타입 · 소스를 주지 않는다(N-2). */
      readonly id: string
      readonly accessible: false
      readonly type: null
      readonly name: null
      readonly dataSourceId: null
      readonly sourceGone: false
    }

export type DashboardDetail = {
  readonly id: string
  readonly layout: DashboardLayout
  /** 읽은 판 — 배치를 고칠 때 그대로 돌려보낸다(마이크로초까지 담은 UTC 글). */
  readonly updatedAt: string
  readonly widgets: readonly DashboardWidget[]
}

export type AddWidgetInput = {
  readonly dataSourceId: string
  readonly type: WidgetViewType
  readonly name?: string
  /** 넣을 줄(0부터) — 자리가 없으면 새 줄 · 그것도 없으면 `full`. 생략하면 새 줄. */
  readonly row?: number
}

const STAMP = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const STAMP_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/
const MAX_WIDGET_NAME_LENGTH = 200

/** 대시보드 뷰를 열고 권한을 본다. 쓰기면 그 행을 잠가 배치 고치기를 한 줄로 세운다(권한을 본 **뒤**에 잠근다). */
async function openDashboard(
  tx: Tx,
  ctx: SessionContext,
  dashboardId: string,
  need: 'view' | 'edit_structure',
): Promise<{ databaseId: string } | DashboardResult<never>> {
  if (!isUuid(dashboardId)) return fail('not_found')
  const row = await tx.queryMaybe<{ database_id: string }>(
    `SELECT v.database_id FROM view v JOIN block b ON b.id = v.database_id
      WHERE v.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND v.owner_kind = 'database_view' AND v.type = 'dashboard'`,
    [dashboardId, ctx.workspaceId],
  )
  if (row === null) return fail('not_found')
  const gate = await openDatabase(tx, ctx, row.database_id, need)
  if (isFailure(gate)) return gate
  if (need === 'edit_structure') await tx.query(`SELECT id FROM view WHERE id = $1 FOR UPDATE`, [dashboardId])
  return { databaseId: row.database_id }
}

/** 배치와 위젯을 읽는다 — 호출자가 권한을 봤다. 사라진 위젯의 칸은 걸러 낸다. */
async function readDashboardIn(tx: Tx, ctx: SessionContext, databaseId: string, dashboardId: string): Promise<DashboardDetail> {
  const head = await tx.queryOne<{ layout: unknown; updated_at: string }>(
    `SELECT dashboard_layout AS layout, ${STAMP} AS updated_at FROM view WHERE id = $1`,
    [dashboardId],
  )
  const rows = await tx.query<{ id: string; type: string; name: string | null; data_source_id: string; lifecycle: string; owner: string }>(
    `SELECT w.id, w.type, w.name, w.data_source_id, ds.lifecycle::text AS lifecycle, ds.owner_database_id AS owner
       FROM view w JOIN data_source ds ON ds.id = w.data_source_id
      WHERE w.dashboard_view_id = $1
      ORDER BY w.order_idx, w.id`,
    [dashboardId],
  )
  const widgets: DashboardWidget[] = []
  const ownerSeen = new Map<string, boolean>()
  for (const r of rows) {
    let accessible = r.owner === databaseId
    if (!accessible) {
      const known = ownerSeen.get(r.owner)
      accessible = known ?? (await canViewOwnerDatabase(tx, ctx, r.owner))
      ownerSeen.set(r.owner, accessible)
    }
    widgets.push(
      accessible
        ? { id: r.id, accessible: true, type: r.type, name: r.name ?? DEFAULT_VIEW_NAME, dataSourceId: r.data_source_id, sourceGone: r.lifecycle !== 'live' }
        : { id: r.id, accessible: false, type: null, name: null, dataSourceId: null, sourceGone: false },
    )
  }
  const alive = new Set(widgets.map((w) => w.id))
  return { id: dashboardId, layout: keepCells(readLayout(head.layout), (id) => alive.has(id)), updatedAt: head.updated_at, widgets }
}

/** 대시보드를 읽는다 — 배치 · 판(`updatedAt`) · 위젯 목록. 위젯의 행은 읽지 않는다(위젯마다 따로 읽는다 — 정본 ④). */
export async function readDashboard(ctx: SessionContext, dashboardId: string): Promise<DashboardResult<DashboardDetail>> {
  return withReadTransaction(async (tx) => {
    const gate = await openDashboard(tx, ctx, dashboardId, 'view')
    if ('ok' in gate) return gate
    return { ok: true, value: await readDashboardIn(tx, ctx, gate.databaseId, dashboardId) } as const
  })
}

async function writeLayout(tx: Tx, dashboardId: string, layout: DashboardLayout): Promise<void> {
  await tx.query(`UPDATE view SET dashboard_layout = $2::jsonb, updated_at = now() WHERE id = $1`, [dashboardId, JSON.stringify(layout)])
}

/**
 * 위젯을 넣는다 — 그 데이터베이스에 붙은(소유 · 연결) 살아 있는 소스와 타입으로 뷰를 만들고(새 탭 뷰와 같은 기본값) 배치 끝에 얹는다.
 * 자리가 없으면(`full`) 아무것도 만들지 않는다.
 */
export async function addDashboardWidget(ctx: SessionContext, dashboardId: string, input: AddWidgetInput): Promise<DashboardResult<{ widgetId: string; dashboard: DashboardDetail }>> {
  if (!isWidgetViewType(input.type)) return fail('unsupported_type')
  if (!isUuid(input.dataSourceId)) return fail('not_found')
  if (input.row !== undefined && (!Number.isInteger(input.row) || input.row < 0)) return fail('invalid_layout')
  let name: string | undefined
  if (input.name !== undefined) {
    name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
    if (name.length === 0 || name.length > MAX_WIDGET_NAME_LENGTH) return fail('invalid_name')
  }

  return withCommandTransaction(async (tx) => {
    const gate = await openDashboard(tx, ctx, dashboardId, 'edit_structure')
    if ('ok' in gate) return gate

    // 0042 의 FK 가 같은 것을 막지만 예외가 되어 화면이 받을 말이 없다 — 먼저 묻는다(`createView` 와 같다)
    const source = await tx.queryMaybe<{ owner: string }>(
      `SELECT ds.owner_database_id AS owner FROM database_data_source dds JOIN data_source ds ON ds.id = dds.data_source_id
        WHERE dds.database_id = $1 AND dds.data_source_id = $2 AND ds.lifecycle = 'live'`,
      [gate.databaseId, input.dataSourceId],
    )
    if (source === null) return fail('not_found')
    if (source.owner !== gate.databaseId && !(await canViewOwnerDatabase(tx, ctx, source.owner))) return fail('not_found')

    const current = await readDashboardIn(tx, ctx, gate.databaseId, dashboardId)
    // 배치의 자리를 먼저 본다 — 뷰를 만들기 전에 거부한다
    const placeholder = '00000000-0000-4000-8000-000000000000'
    if (placeWidget(current.layout, placeholder, input.row) === null) return fail('full')

    const widgetId = await insertViewRow(tx, {
      databaseId: gate.databaseId,
      dataSourceId: input.dataSourceId,
      name: name ?? DEFAULT_VIEW_NAME,
      type: input.type,
      widgetOf: dashboardId,
    })
    if (isFailure(widgetId)) return widgetId
    const placed = placeWidget(current.layout, widgetId, input.row)
    if (placed === null) return fail('full')
    await writeLayout(tx, dashboardId, placed)
    return { ok: true, value: { widgetId, dashboard: await readDashboardIn(tx, ctx, gate.databaseId, dashboardId) } } as const
  })
}

/** 위젯을 지운다 — 뷰를 지우고(속성 · 순서는 CASCADE) 배치에서 칸을 빼고 그 줄을 당긴다 · 빈 줄은 없앤다. */
export async function removeDashboardWidget(ctx: SessionContext, dashboardId: string, widgetId: string): Promise<DashboardResult<DashboardDetail>> {
  if (!isUuid(widgetId)) return fail('not_found')
  return withCommandTransaction(async (tx) => {
    const gate = await openDashboard(tx, ctx, dashboardId, 'edit_structure')
    if ('ok' in gate) return gate
    const deleted = await tx.queryMaybe<{ id: string }>(
      `DELETE FROM view WHERE id = $1 AND dashboard_view_id = $2 RETURNING id`,
      [widgetId, dashboardId],
    )
    if (deleted === null) return fail('not_found')
    const stored = await tx.queryOne<{ layout: unknown }>(`SELECT dashboard_layout AS layout FROM view WHERE id = $1`, [dashboardId])
    // 다른 사라진 칸(떨어진 소스)도 이때 함께 정리한다
    const alive = new Set((await tx.query<{ id: string }>(`SELECT id FROM view WHERE dashboard_view_id = $1`, [dashboardId])).map((r) => r.id))
    await writeLayout(tx, dashboardId, keepCells(removeCell(readLayout(stored.layout), widgetId), (id) => alive.has(id)))
    return { ok: true, value: await readDashboardIn(tx, ctx, gate.databaseId, dashboardId) } as const
  })
}

/**
 * 배치를 고친다(옮기기 · 줄 높이) — 읽은 판의 `updatedAt` 과 새 배치를 받는다. 판이 다르면 `conflict`. 새 배치는 모양을 지키고(`validateLayout`)
 * 칸이 **정확히 이 대시보드의 위젯 전부**여야 한다(없는 위젯 · 남의 위젯 · 빠진 위젯을 거부한다 — 배치에서 빼려면 위젯을 지운다).
 */
export async function updateDashboardLayout(
  ctx: SessionContext,
  dashboardId: string,
  input: { readonly layout: unknown; readonly updatedAt: unknown },
): Promise<DashboardResult<DashboardDetail>> {
  const checked = validateLayout(input.layout)
  if (!checked.ok) return fail('invalid_layout', checked.issues)
  if (typeof input.updatedAt !== 'string' || !STAMP_FORMAT.test(input.updatedAt)) {
    return fail('invalid_layout', [{ path: 'updatedAt', message: '읽은 판의 updatedAt 을 그대로 보내야 합니다' }])
  }
  const stamp = input.updatedAt

  return withCommandTransaction(async (tx) => {
    const gate = await openDashboard(tx, ctx, dashboardId, 'edit_structure')
    if ('ok' in gate) return gate
    const same = await tx.queryOne<{ same: boolean }>(`SELECT updated_at = $2::timestamptz AS same FROM view WHERE id = $1`, [dashboardId, stamp])
    if (!same.same) return fail('conflict')

    const widgets = new Set((await tx.query<{ id: string }>(`SELECT id FROM view WHERE dashboard_view_id = $1`, [dashboardId])).map((r) => r.id))
    const ids = layoutViewIds(checked.layout)
    const issues: ValidationIssue[] = []
    for (const id of ids) if (!widgets.has(id)) issues.push({ path: 'layout', message: `이 대시보드의 위젯이 아닙니다: ${id}` })
    for (const id of widgets) if (!ids.includes(id)) issues.push({ path: 'layout', message: `배치에 빠진 위젯이 있습니다: ${id}` })
    if (issues.length > 0) return fail('invalid_layout', issues)

    await writeLayout(tx, dashboardId, checked.layout)
    return { ok: true, value: await readDashboardIn(tx, ctx, gate.databaseId, dashboardId) } as const
  })
}
