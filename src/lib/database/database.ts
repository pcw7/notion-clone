/**
 * 데이터베이스 컨테이너 — W8-a (F-03-01)
 *
 * 정본: 00-canonical-data-model.md §3.5 (`database` · `data_source` ·
 *       `database_data_source`, 불변식 DS1 · P1 · R3)
 *       판결 C-5 (소유와 부착은 다른 축) · X-2 (id FK)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 세 표를 한 트랜잭션에서 만든다 — 불변식이 그것을 요구한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 스키마로 표현할 수 없는 "적어도 1개" 쪽 불변식이 둘 있고, 둘 다 여기서 지킨다:
 *
 *   DS1: 모든 `data_source` 는 `(owner_database_id, id)` 부착 행을 **정확히 1개**
 *        갖는다. PK 가 "1개 이하"를, 이 함수가 "적어도 1개"를 지킨다.
 *   P1:  `data_source` 당 살아있는 `title` 프로퍼티가 **정확히 1개**. 부분 UNIQUE
 *        인덱스가 "1개 이하"를, 이 함수가 "적어도 1개"를 지킨다.
 *
 * 나눠서 만들면 그 사이에 DS1·P1 을 어긴 data_source 가 존재하는 구간이 생기고,
 * 그 구간에 읽기가 들어오면 제목 없는 표가 화면에 나온다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 지금 만드는 것은 **풀페이지 데이터베이스**다 (워크스페이스 직속)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 인라인 데이터베이스(페이지 본문 안)를 만들지 않는 이유가 프로젝터다.
 * `save-page-body.ts` 는 **문서에 없는 자식 블록을 지운다**:
 *
 *   toDelete = scope.filter((r) => !docIds.has(r.id) && r.type !== PAGE_TYPE)
 *
 * `type='database'` 는 `PAGE_TYPE` 이 아니므로, 페이지의 자식으로 만든 데이터베이스는
 * **그 페이지를 한 번 저장하는 순간 사라진다.** 에디터가 그 타입을 모르기 때문에
 * 문서에도 들어가지 않는다(`unsupported` 로 감싸이기는 하지만 그건 본문 블록
 * 경로다).
 *
 * 그래서 인라인 DB 는 블록 타입 레지스트리(`block/types.ts`)에 `database` 를
 * 넣고 노드 뷰를 붙이는 작업과 **함께** 와야 한다 — F-04-14(풀페이지 DB)가
 * W8-b 에 있고, 인라인은 그 뒤다. 지금 반쯤 만들어 두면 데이터가 사라지는
 * 경로를 열어두는 것이다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import { nextSiblingKey, titleFromPlainText, plainTitleOf } from '../block/page.ts'
import { newPropertyId } from './property.ts'
import { DEFAULT_VIEW_NAME } from './view.ts'

/** 제목 프로퍼티의 기본 이름. 노션은 "Name" 이고 우리는 한국어 UI 다. */
export const DEFAULT_TITLE_PROPERTY_NAME = '이름'

export const MAX_DATABASE_NAME_LENGTH = 200

export type DatabaseDetail = {
  /** `block.id` 와 같다 [X-2]. */
  readonly id: string
  readonly name: string
  /** 이 데이터베이스가 **소유한** data_source. MVP 는 하나다. */
  readonly dataSourceId: string
  readonly schemaVersion: string
  readonly isInline: boolean
  /** 기본 뷰. 표를 만들면 항상 하나가 함께 생긴다. */
  readonly defaultViewId?: string
}

export type DatabaseFailure = 'not_found' | 'forbidden' | 'invalid_name'

export type DatabaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DatabaseFailure }

export type CreateDatabaseInput = {
  /** 표 이름. 비면 빈 제목으로 만든다(페이지와 같은 규칙). */
  readonly name?: string
}

function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DATABASE_NAME_LENGTH)
}

/**
 * 풀페이지 데이터베이스를 만든다.
 *
 * 워크스페이스 최상위에 놓는다. `teamspace` 표가 없어서 루트가 곧 권한 스코프
 * 루트이고(HANDOFF §7), 그래서 **자기 자신이 `perm_scope_id`** 이며 ACL 을 갖고
 * 태어난다 — `createPage` 의 루트 페이지와 같은 규칙이다. `effective()` 가 켜진
 * 뒤로 ACL 없는 노드는 아무도 못 보는 노드이기 때문이다.
 */
export async function createDatabase(
  ctx: SessionContext,
  input: CreateDatabaseInput = {},
): Promise<DatabaseResult<DatabaseDetail>> {
  const name = normalizeName(input.name)

  return withTransaction(async (tx) => {
    const id = randomUUID()
    const dataSourceId = randomUUID()

    // 워크스페이스 직속 형제들 사이의 자리. 페이지와 같은 축을 쓴다 —
    // 사이드바가 둘을 한 목록으로 보여주게 될 것이므로 순서가 같아야 한다.
    const orderKey = await nextSiblingKey(tx, ctx.workspaceId)

    await tx.query(
      `INSERT INTO block (
         id, workspace_id, type,
         parent_type, parent_id, order_key, ancestor_path, perm_scope_id,
         properties, format, created_by, created_at, last_edited_by, last_edited_at
       ) VALUES (
         $1, $2, 'database',
         'workspace', $2, $3, '{}', $1,
         $4::jsonb, '{}'::jsonb, $5, now(), $5, now()
       )`,
      [id, ctx.workspaceId, orderKey, JSON.stringify({ title: titleFromPlainText(name) }), ctx.userId],
    )

    // 루트 노드는 ACL 을 갖고 태어난다(W6-b 의 규칙).
    await tx.query(
      `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
       VALUES ($1, 'block', $2, 'workspace_everyone', NULL, 'full_access', $3)`,
      [randomUUID(), id, ctx.userId],
    )

    await tx.query(
      `INSERT INTO database (id, title_rich, is_inline, created_at, updated_at)
       VALUES ($1, $2::jsonb, false, now(), now())`,
      [id, JSON.stringify(titleFromPlainText(name))],
    )

    await tx.query(
      `INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [dataSourceId, id, name === '' ? '표' : name],
    )

    // DS1 의 "적어도 1개". 소유 부착 행이다(`database_id = owner_database_id`).
    await tx.query(
      `INSERT INTO database_data_source (database_id, data_source_id, order_idx)
       VALUES ($1, $2, $3)`,
      [id, dataSourceId, orderKeyBetween(null, null)],
    )

    // P1 의 "적어도 1개". 제목 프로퍼티는 삭제도 타입 변경도 안 되므로
    // 여기서 만들어지는 것이 그 data_source 의 제목 컬럼 전부다.
    const titlePropertyId = newPropertyId()
    const titleOrder = orderKeyBetween(null, null)
    await tx.query(
      `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
       VALUES ($1, $2, $3, 'title', $4, now(), now())`,
      [titlePropertyId, dataSourceId, DEFAULT_TITLE_PROPERTY_NAME, titleOrder],
    )

    // ★ 기본 뷰. **뷰가 없는 데이터베이스는 화면에 그릴 것이 없다** — `deleteView`
    //   가 마지막 뷰 삭제를 막는 이유와 같다. 여기서 만들지 않으면 표를 만든
    //   사람이 뷰를 먼저 만들어야 하는 상태가 된다.
    //
    //   `view.ts` 의 `createView` 를 부르지 않는다 — 그 함수는 자기 트랜잭션을
    //   열고 권한을 다시 보는데, 여기는 방금 만들어지는 중인 밖에 ACL 행이 아직
    //   보이지 않을 수 있는 같은 트랜잭션 어딘가다.
    const viewId = randomUUID()
    await tx.query(
      `INSERT INTO view (id, owner_kind, database_id, data_source_id, name, type, order_idx,
                         configuration, created_at, updated_at)
       VALUES ($1, 'database_view', $2, $3, $4, 'table', $5, '{}'::jsonb, now(), now())`,
      [viewId, id, dataSourceId, DEFAULT_VIEW_NAME, orderKeyBetween(null, null)],
    )
    await tx.query(
      `INSERT INTO view_property (view_id, property_id, visible, order_idx)
       VALUES ($1, $2, true, $3)`,
      [viewId, titlePropertyId, titleOrder],
    )

    return {
      ok: true,
      value: {
        id,
        name,
        dataSourceId,
        schemaVersion: '1',
        isInline: false,
        defaultViewId: viewId,
      },
    } as const
  })
}

/**
 * 데이터베이스 이름을 바꾼다.
 *
 * 이름이 **두 곳**에 있다 — `block.properties.title`(사이드바 · breadcrumb · 최근
 * 방문이 읽는 블록 제목)과 `database.title_rich`(정본 §3.5 의 DB 제목). 같은
 * 트랜잭션에서 둘 다 쓴다. 하나만 쓰면 사이드바와 표 머리의 이름이 갈린다.
 *
 * `renamePage` 를 빌려 쓰지 않는다. 그 함수는 `type='page'` 만 받고 검색 색인을
 * 함께 쓰는데, `search_document` 는 페이지만 담는다(CHECK 로 승격돼 있다).
 *
 * `edit_structure` 를 묻는다. 표의 이름은 모두가 보는 표의 모양이다 — 뷰 설정이
 * 같은 capability 를 묻는 이유와 같다(`view.ts` 머리말).
 */
export async function renameDatabase(
  ctx: SessionContext,
  databaseId: string,
  rawName: unknown,
): Promise<DatabaseResult<DatabaseDetail>> {
  if (typeof rawName !== 'string') return { ok: false, reason: 'invalid_name' } as const
  const name = normalizeName(rawName)

  return withTransaction(async (tx) => {
    const row = await loadDatabase(tx, ctx, databaseId)
    if (row === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, databaseId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_structure')) return { ok: false, reason: 'forbidden' } as const

    const title = JSON.stringify(titleFromPlainText(name))
    await tx.query(
      `UPDATE block
          SET properties = jsonb_set(properties, '{title}', $2::jsonb, true),
              last_edited_by = $3, last_edited_at = now(), version = version + 1
        WHERE id = $1`,
      [databaseId, title, ctx.userId],
    )
    await tx.query(`UPDATE database SET title_rich = $2::jsonb, updated_at = now() WHERE id = $1`, [
      databaseId,
      title,
    ])

    return {
      ok: true,
      value: {
        id: row.id,
        name,
        dataSourceId: row.data_source_id,
        schemaVersion: row.schema_version,
        isInline: row.is_inline,
      },
    } as const
  })
}

type DatabaseRow = {
  id: string
  properties: { title?: unknown } | null
  is_inline: boolean
  data_source_id: string
  schema_version: string
}

/**
 * 데이터베이스 하나를 읽는다.
 *
 * **소유한** data_source 를 돌려준다(`owner_database_id` 기준). 부착된 것까지
 * 세면 linked database 의 원본이 섞인다 — 그 구분이 C-5 의 요점이다.
 */
export async function getDatabase(
  ctx: SessionContext,
  databaseId: string,
): Promise<DatabaseResult<DatabaseDetail>> {
  return withReadTransaction(async (tx) => {
    const row = await loadDatabase(tx, ctx, databaseId)
    if (row === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, databaseId), 'view')) {
      return { ok: false, reason: 'not_found' } as const
    }
    return {
      ok: true,
      value: {
        id: row.id,
        name: plainTitleOf(row.properties),
        dataSourceId: row.data_source_id,
        schemaVersion: row.schema_version,
        isInline: row.is_inline,
      },
    } as const
  })
}

async function loadDatabase(
  tx: Tx,
  ctx: SessionContext,
  databaseId: string,
): Promise<DatabaseRow | null> {
  return tx.queryMaybe<DatabaseRow>(
    `SELECT b.id, b.properties, d.is_inline, ds.id AS data_source_id, ds.schema_version
       FROM block b
       JOIN database d ON d.id = b.id
       JOIN data_source ds ON ds.owner_database_id = d.id
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
      ORDER BY ds.created_at
      LIMIT 1`,
    [databaseId, ctx.workspaceId],
  )
}
