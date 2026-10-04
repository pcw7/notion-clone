/**
 * data source — 데이터베이스 하나에 여럿 (잔여 묶음 8e-1 · F-04-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 (`data_source` · `database_data_source` · 불변식 DS1~DS3 · P1 · [보강] 다중 data source)
 *       판결 C-5 (소유와 부착은 다른 축) · 04-database-views.md F-04-23
 *
 * ──────────────────────────────────────────────────────────────────────
 * data source 가 스키마와 행의 주인이고, 데이터베이스는 그것을 담는 그릇이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 속성 · 행 · 템플릿은 처음부터 data source 에 매달려 있다(`property.data_source_id` · `page.data_source_id`). 그래서 둘째 data source 를
 * 더하는 것은 **그 셋을 한 벌 더 만드는 것**이다 — 제목 속성(P1)과 소유 부착 행(DS1)과, 그것을 보여 줄 뷰 하나.
 *
 *   · 권한은 데이터베이스에 있다(규칙 A4 — data source 에는 ACL 이 없다). 그래서 모든 게이트가 **주인 데이터베이스**의 capability 를 묻는다.
 *     더하기 · 이름 바꾸기는 표의 모양이다 — `edit_structure` 이고, 데이터베이스가 잠기면 막는다(뷰 · 속성과 같은 줄).
 *   · 순서는 부착 행의 `order_idx` 다. 같은 데이터베이스의 행을 먼저 잠그고 끝 키를 읽는다 — 두 사람이 동시에 더해도 같은 키가 나오지 않는다.
 *   · 새 data source 는 **뷰 하나와 함께** 태어난다(노션: *"When you create a data source, a new view will automatically be created and
 *     attached to it"*). 뷰가 없는 data source 는 탭 어디에서도 열 수 없다 — `deleteView` 가 data source 의 마지막 뷰를 막는 것과 같은 이유다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이름 — 하나일 때는 데이터베이스 이름이 곧 그 이름이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * data source 가 하나뿐이면 화면은 그 이름을 따로 보여 주지 않는다 — 데이터베이스 이름이 그 자리다. 그래서 그동안 `data_source.name` 은
 * 만들 때의 이름(또는 "표")에 머물러 있다. **둘째를 더하는 순간** 첫째의 이름이 처음으로 화면에 나오므로, 그때 첫째가 데이터베이스의
 * 지금 이름을 받는다(비어 있으면 그대로). 이름 바꾸기를 매번 양쪽에 맞춰 쓰는 대신, 보이기 시작하는 한 순간에 맞춘다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 휴지통 — 소스와 그 행이 한 묶음으로 간다 (8e-3a · 0043)
 * ──────────────────────────────────────────────────────────────────────
 *
 * data source 는 블록이 아니지만 블록과 같은 세 상태(live · trashed · purged)를 갖는다. 휴지통으로 보낼 때 그 소스의 살아 있는 행 ·
 * 템플릿과 그 하위 페이지를 **소스 id 를 삭제 루트로**(`trash_root_id`) 함께 보낸다 — 행의 모든 읽기 경로(검색 · 관계형 칩 · 최근 방문 ·
 * 행 주소 · 멘션)가 이미 행 블록의 lifecycle 로 거르므로 따로 막을 곳이 없다. 되살리면 그 루트의 것만 돌아온다(B3) — 그 전에 따로 지운
 * 행은 휴지통에 남는다. 영구 삭제도 같은 묶음이다(2단계 보존 — 물리 삭제는 하지 않는다).
 *
 *   · **마지막 살아 있는 소스는 휴지통에 넣지 않는다**(`last_source`) — 데이터베이스가 그릴 것이 없어진다(F-04-23 *"마지막 data source 는
 *     제거 불가로 두는 편이 단순하다"*).
 *   · 휴지통의 소스는 이 모듈의 목록 · 이름 바꾸기 · 뷰 · 행 · 속성의 모든 문에서 **없는 것**이다(`lifecycle = 'live'`).
 *   · 소스의 뷰는 지우지 않는다 — 숨길 뿐이다(되살리면 탭이 돌아온다).
 *   · 권한은 더하기와 같다 — 주인 데이터베이스의 `edit_structure` · 잠기면 막는다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { isLocked } from '../permissions/lock.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import { plainTitleOf } from '../block/page.ts'
import { newPropertyId } from './property.ts'
import { DEFAULT_VIEW_NAME } from './view.ts'

/** 제목 프로퍼티의 기본 이름. 노션은 "Name" 이고 우리는 한국어 UI 다. */
export const DEFAULT_TITLE_PROPERTY_NAME = '이름'

/** 이름 없이 만든 data source 의 이름(정본: `name` 은 비어 있을 수 없다 — `ck_data_source_name`). */
export const DEFAULT_DATA_SOURCE_NAME = '새 데이터 소스'

export const MAX_DATA_SOURCE_NAME_LENGTH = 200

export type DataSourceSummary = {
  readonly id: string
  readonly name: string
  /**
   * 이 데이터베이스가 **소유한다**(DS2 의 `is_linked` 의 반대). 거짓이면 다른 데이터베이스의 것을 붙인 것이다(linked · F-04-13) —
   * 아직 그것을 만드는 길은 없다.
   */
  readonly owned: boolean
  readonly orderKey: string
}

export type DataSourceFailure =
  | 'not_found'
  | 'forbidden'
  | 'invalid_name'
  | 'locked'
  /** 데이터베이스의 마지막 살아 있는 소스는 휴지통에 넣을 수 없다(8e-3a). */
  | 'last_source'

export type DataSourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DataSourceFailure }

const fail = (reason: DataSourceFailure) => ({ ok: false, reason }) as const

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DATA_SOURCE_NAME_LENGTH)
  return name === '' ? null : name
}

/** 이 데이터베이스에 붙은 **살아 있는** data source 들 — 부착 순서대로. 권한은 부르는 쪽이 이미 봤다. 휴지통의 소스는 없는 것이다(8e-3a). */
export async function readDataSources(tx: Tx, databaseId: string): Promise<DataSourceSummary[]> {
  const rows = await tx.query<{ id: string; name: string; owned: boolean; order_idx: string }>(
    `SELECT ds.id, ds.name, ds.owner_database_id = dds.database_id AS owned, dds.order_idx
       FROM database_data_source dds
       JOIN data_source ds ON ds.id = dds.data_source_id
      WHERE dds.database_id = $1 AND ds.lifecycle = 'live'
      ORDER BY dds.order_idx, ds.id`,
    [databaseId],
  )
  return rows.map((r) => ({ id: r.id, name: r.name, owned: r.owned, orderKey: r.order_idx }))
}

/**
 * data source 하나와 그 최소 한 벌 — 소유 부착 행(DS1) · 제목 속성(P1) · 뷰 하나 — 을 넣는다. 데이터베이스를 만들 때와 더할 때가 같은
 * 함수를 쓴다. 권한 · 잠금 · 순서 키는 부르는 쪽이 정한다(같은 트랜잭션이다).
 *
 * 뷰를 `createView` 로 만들지 않는다 — 그 함수는 자기 트랜잭션을 열고 권한을 다시 보는데, 데이터베이스를 만드는 중에는 방금 넣은 ACL 이
 * 그 바깥에서 보이지 않는다.
 */
export async function insertOwnedDataSource(
  tx: Tx,
  input: { databaseId: string; name: string; sourceOrder: string; viewOrder: string },
): Promise<{ dataSourceId: string; viewId: string }> {
  const dataSourceId = randomUUID()
  await tx.query(
    `INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())`,
    [dataSourceId, input.databaseId, input.name],
  )
  // DS1 의 "적어도 1개". 소유 부착 행이다(`database_id = owner_database_id`) — 커밋 때 0042 의 트리거가 다시 본다.
  await tx.query(
    `INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, $3)`,
    [input.databaseId, dataSourceId, input.sourceOrder],
  )

  // P1 의 "적어도 1개". 제목 프로퍼티는 삭제도 타입 변경도 안 되므로 여기서 만들어지는 것이 그 data source 의 제목 컬럼 전부다.
  const titlePropertyId = newPropertyId()
  const titleOrder = orderKeyBetween(null, null)
  await tx.query(
    `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
     VALUES ($1, $2, $3, 'title', $4, now(), now())`,
    [titlePropertyId, dataSourceId, DEFAULT_TITLE_PROPERTY_NAME, titleOrder],
  )

  // ★ 뷰 하나. **뷰가 없는 data source 는 화면에 그릴 길이 없다.**
  const viewId = randomUUID()
  await tx.query(
    `INSERT INTO view (id, owner_kind, database_id, data_source_id, name, type, order_idx,
                       configuration, created_at, updated_at)
     VALUES ($1, 'database_view', $2, $3, $4, 'table', $5, '{}'::jsonb, now(), now())`,
    [viewId, input.databaseId, dataSourceId, DEFAULT_VIEW_NAME, input.viewOrder],
  )
  await tx.query(
    `INSERT INTO view_property (view_id, property_id, visible, order_idx) VALUES ($1, $2, true, $3)`,
    [viewId, titlePropertyId, titleOrder],
  )
  return { dataSourceId, viewId }
}

type DatabaseGate = { readonly title: string }

/** 데이터베이스를 열고 권한을 본다. 고치는 쪽이면 블록 행을 잠근다 — 같은 표의 더하기 · 잠그기가 그 줄에 선다. */
async function openDatabase(
  tx: Tx,
  ctx: SessionContext,
  databaseId: string,
  need: 'view' | 'edit_structure',
): Promise<DatabaseGate | ReturnType<typeof fail>> {
  const row = await tx.queryMaybe<{ properties: { title?: unknown } | null }>(
    `SELECT b.properties FROM block b JOIN database d ON d.id = b.id
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = 'database' AND b.lifecycle = 'live'
      ${need === 'edit_structure' ? 'FOR UPDATE OF b' : ''}`,
    [databaseId, ctx.workspaceId],
  )
  if (row === null) return fail('not_found')
  const caps = await effectiveCaps(tx, ctx, databaseId)
  // 못 보는 사람에게는 있다는 것도 알리지 않는다.
  if (!can(caps, 'view')) return fail('not_found')
  if (need === 'edit_structure') {
    if (!can(caps, 'edit_structure')) return fail('forbidden')
    if (await isLocked(tx, databaseId)) return fail('locked')
  }
  return { title: plainTitleOf(row.properties) }
}

function isFailure(v: unknown): v is ReturnType<typeof fail> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

/** 이 데이터베이스의 data source 들 — 볼 수 있어야 한다. */
export async function listDataSources(
  ctx: SessionContext,
  databaseId: string,
): Promise<DataSourceResult<DataSourceSummary[]>> {
  return withReadTransaction(async (tx) => {
    const gate = await openDatabase(tx, ctx, databaseId, 'view')
    if (isFailure(gate)) return gate
    return { ok: true, value: await readDataSources(tx, databaseId) } as const
  })
}

export type AddedDataSource = {
  readonly dataSource: DataSourceSummary
  /** 함께 태어난 뷰 — 화면이 곧바로 그 탭을 연다. */
  readonly viewId: string
}

/**
 * data source 를 더한다 — 끝에 붙고, 표 뷰 하나가 함께 생긴다(그 뷰도 탭의 끝).
 *
 * 둘째를 더하는 순간 첫째가 데이터베이스의 지금 이름을 받는다(머리말 "이름").
 */
export async function addDataSource(
  ctx: SessionContext,
  databaseId: string,
  input: { readonly name?: unknown } = {},
): Promise<DataSourceResult<AddedDataSource>> {
  const name = input.name === undefined ? DEFAULT_DATA_SOURCE_NAME : normalizeName(input.name)
  if (name === null) return fail('invalid_name')

  return withCommandTransaction(async (tx) => {
    const gate = await openDatabase(tx, ctx, databaseId, 'edit_structure')
    if (isFailure(gate)) return gate

    // 이름 받기는 **처음으로** 둘째가 생길 때뿐이다 — 부착 행(휴지통의 소스까지)이 하나인 데이터베이스. 살아 있는 것만 세면, 둘 중
    // 하나를 휴지통에 넣은 뒤 더할 때 이미 보였던(사용자가 고쳤을 수 있는) 첫째의 이름을 덮는다(8e-3a).
    const { attached } = await tx.queryOne<{ attached: string }>(
      `SELECT count(*) AS attached FROM database_data_source WHERE database_id = $1`,
      [databaseId],
    )
    const sources = await readDataSources(tx, databaseId)
    const only = Number(attached) === 1 ? sources[0] : undefined
    if (only !== undefined && only.owned && gate.title !== '' && gate.title !== only.name) {
      await tx.query(`UPDATE data_source SET name = $2, updated_at = now() WHERE id = $1`, [only.id, gate.title])
    }

    const lastView = await tx.queryMaybe<{ order_idx: string }>(
      `SELECT order_idx FROM view WHERE database_id = $1 AND owner_kind = 'database_view' ORDER BY order_idx DESC LIMIT 1`,
      [databaseId],
    )
    // 끝 키는 휴지통의 소스까지 센다 — 살아 있는 것만 보면 되살린 소스와 같은 키가 생길 수 있다.
    const lastSource = await tx.queryMaybe<{ order_idx: string }>(
      `SELECT order_idx FROM database_data_source WHERE database_id = $1 ORDER BY order_idx DESC LIMIT 1`,
      [databaseId],
    )
    const sourceOrder = orderKeyBetween(lastSource?.order_idx ?? null, null)
    const { dataSourceId, viewId } = await insertOwnedDataSource(tx, {
      databaseId,
      name,
      sourceOrder,
      viewOrder: orderKeyBetween(lastView?.order_idx ?? null, null),
    })
    await tx.query(
      `UPDATE block SET last_edited_by = $2, last_edited_at = now(), version = version + 1 WHERE id = $1`,
      [databaseId, ctx.userId],
    )
    return {
      ok: true,
      value: { dataSource: { id: dataSourceId, name, owned: true, orderKey: sourceOrder }, viewId },
    } as const
  })
}

/**
 * data source 의 이름을 바꾼다. 권한은 **주인** 데이터베이스의 것이다 — 붙인 곳(linked)에서 바꿔도 원본의 이름이 바뀐다(F-04-23 *"원본
 * data source 의 제목 … 변경은 연결된 모든 곳에 전파"*).
 *
 * 하나뿐인 data source 의 이름은 화면에 나오지 않고, 둘째를 더할 때 데이터베이스 이름이 덮는다(머리말 "이름").
 */
export async function renameDataSource(
  ctx: SessionContext,
  dataSourceId: string,
  rawName: unknown,
): Promise<DataSourceResult<{ readonly id: string; readonly name: string }>> {
  const name = normalizeName(rawName)
  if (name === null) return fail('invalid_name')

  return withCommandTransaction(async (tx) => {
    const source = await tx.queryMaybe<{ owner_database_id: string; name: string }>(
      `SELECT ds.owner_database_id, ds.name FROM data_source ds JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'`,
      [dataSourceId, ctx.workspaceId],
    )
    if (source === null) return fail('not_found')
    const gate = await openDatabase(tx, ctx, source.owner_database_id, 'edit_structure')
    if (isFailure(gate)) return gate

    if (source.name !== name) {
      await tx.query(`UPDATE data_source SET name = $2, updated_at = now() WHERE id = $1`, [dataSourceId, name])
      await tx.query(
        `UPDATE block SET last_edited_by = $2, last_edited_at = now(), version = version + 1 WHERE id = $1`,
        [source.owner_database_id, ctx.userId],
      )
    }
    return { ok: true, value: { id: dataSourceId, name } } as const
  })
}

// ── 휴지통 (8e-3a) ─────────────────────────────────────────────────────

type SourceState = { readonly owner_database_id: string; readonly lifecycle: string; readonly name: string }

/**
 * 소스를 찾고 주인 데이터베이스의 문을 지난다(블록 행을 잠근다) — 그 뒤에 소스 행을 잠그고 상태를 다시 읽는다. 상태가 `expect` 가
 * 아니면 `not_found` 다(휴지통에 없는 소스를 되살리라는 것은 없는 것을 되살리라는 것과 같다).
 */
async function openSourceFor(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  expect: 'live' | 'trashed',
): Promise<SourceState | ReturnType<typeof fail>> {
  const found = await tx.queryMaybe<{ owner_database_id: string }>(
    `SELECT ds.owner_database_id FROM data_source ds JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
    [dataSourceId, ctx.workspaceId],
  )
  if (found === null) return fail('not_found')
  const gate = await openDatabase(tx, ctx, found.owner_database_id, 'edit_structure')
  if (isFailure(gate)) return gate
  const source = await tx.queryOne<SourceState>(
    `SELECT owner_database_id, lifecycle::text AS lifecycle, name FROM data_source WHERE id = $1 FOR UPDATE`,
    [dataSourceId],
  )
  return source.lifecycle === expect ? source : fail('not_found')
}

async function touchDatabase(tx: Tx, ctx: SessionContext, databaseId: string): Promise<void> {
  await tx.query(
    `UPDATE block SET last_edited_by = $2, last_edited_at = now(), version = version + 1 WHERE id = $1`,
    [databaseId, ctx.userId],
  )
}

export type TrashedDataSource = {
  readonly dataSourceId: string
  /** 함께 휴지통에 들어간 행 · 템플릿과 그 하위 페이지의 수. */
  readonly trashedRows: number
  readonly purgeAfter: Date
}

/**
 * 소스를 휴지통으로 — 그 소스의 살아 있는 행 · 템플릿과 그 하위 페이지를 **소스 id 를 삭제 루트로** 함께(머리말 "휴지통").
 * 데이터베이스의 마지막 살아 있는 소스면 `last_source` 다.
 */
export async function trashDataSource(
  ctx: SessionContext,
  dataSourceId: string,
): Promise<DataSourceResult<TrashedDataSource>> {
  return withCommandTransaction(async (tx) => {
    const source = await openSourceFor(tx, ctx, dataSourceId, 'live')
    if (isFailure(source)) return source
    const live = await readDataSources(tx, source.owner_database_id)
    if (live.length <= 1) return fail('last_source')

    const { days } = await tx.queryOne<{ days: number }>(`SELECT trash_days AS days FROM workspace WHERE id = $1`, [
      ctx.workspaceId,
    ])
    const { purge_after } = await tx.queryOne<{ purge_after: Date }>(
      `UPDATE data_source
          SET lifecycle = 'trashed', trashed_at = now(), trashed_by = $2,
              purge_after = now() + make_interval(days => $3), updated_at = now()
        WHERE id = $1
        RETURNING purge_after`,
      [dataSourceId, ctx.userId, days],
    )

    // 행 · 템플릿(소스의 직계)과 그 하위 페이지. 따로 먼저 지운 것은 이미 휴지통이라 걸리지 않는다 — 제 루트를 지킨다(B3).
    const rows = await tx.query<{ id: string }>(
      `UPDATE block
          SET lifecycle = 'trashed', trashed_at = now(), trashed_by = $3, trash_root_id = $1, trash_reason = 'user',
              purge_after = $4, version = version + 1
        WHERE workspace_id = $2 AND parent_type = 'data_source' AND parent_id = $1
          AND type = 'page' AND lifecycle = 'live'
        RETURNING id`,
      [dataSourceId, ctx.workspaceId, ctx.userId, purge_after],
    )
    const below =
      rows.length === 0
        ? []
        : await tx.query<{ id: string }>(
            `UPDATE block
                SET lifecycle = 'trashed', trashed_at = now(), trashed_by = $3, trash_root_id = $1, trash_reason = 'user',
                    purge_after = $4, version = version + 1
              WHERE workspace_id = $2 AND type = 'page' AND lifecycle = 'live' AND ancestor_path && $5::uuid[]
              RETURNING id`,
            [dataSourceId, ctx.workspaceId, ctx.userId, purge_after, rows.map((r) => r.id)],
          )
    await touchDatabase(tx, ctx, source.owner_database_id)
    return {
      ok: true,
      value: { dataSourceId, trashedRows: rows.length + below.length, purgeAfter: purge_after },
    } as const
  })
}

/** 휴지통의 소스를 되살린다 — 그 소스를 루트로 함께 들어간 것만 돌아온다(B3). 탭 · 순서는 그대로다(지우지 않았다). */
export async function restoreDataSource(
  ctx: SessionContext,
  dataSourceId: string,
): Promise<DataSourceResult<{ readonly dataSourceId: string; readonly restoredRows: number }>> {
  return withCommandTransaction(async (tx) => {
    const source = await openSourceFor(tx, ctx, dataSourceId, 'trashed')
    if (isFailure(source)) return source
    await tx.query(
      `UPDATE data_source
          SET lifecycle = 'live', trashed_at = NULL, trashed_by = NULL, purge_after = NULL, updated_at = now()
        WHERE id = $1`,
      [dataSourceId],
    )
    const restored = await tx.query<{ id: string }>(
      `UPDATE block
          SET lifecycle = 'live', trashed_at = NULL, trashed_by = NULL, trash_root_id = NULL, purge_after = NULL,
              version = version + 1
        WHERE workspace_id = $2 AND lifecycle = 'trashed' AND trash_root_id = $1
        RETURNING id`,
      [dataSourceId, ctx.workspaceId],
    )
    await touchDatabase(tx, ctx, source.owner_database_id)
    return { ok: true, value: { dataSourceId, restoredRows: restored.length } } as const
  })
}

/** 휴지통의 소스를 영구 삭제한다 — 소스와 그 묶음이 `purged` 가 된다(2단계 보존 · 물리 삭제는 하지 않는다). 되돌릴 수 없다. */
export async function purgeDataSource(
  ctx: SessionContext,
  dataSourceId: string,
): Promise<DataSourceResult<{ readonly dataSourceId: string; readonly purgedRows: number }>> {
  return withCommandTransaction(async (tx) => {
    const source = await openSourceFor(tx, ctx, dataSourceId, 'trashed')
    if (isFailure(source)) return source
    await tx.query(`UPDATE data_source SET lifecycle = 'purged', purged_at = now(), updated_at = now() WHERE id = $1`, [
      dataSourceId,
    ])
    const purged = await tx.query<{ id: string }>(
      `UPDATE block SET lifecycle = 'purged', purged_at = now()
        WHERE workspace_id = $2 AND lifecycle = 'trashed' AND trash_root_id = $1
        RETURNING id`,
      [dataSourceId, ctx.workspaceId],
    )
    await touchDatabase(tx, ctx, source.owner_database_id)
    return { ok: true, value: { dataSourceId, purgedRows: purged.length } } as const
  })
}
