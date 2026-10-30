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
 * "적어도 1개" 쪽 불변식이 둘 있고, 둘 다 같은 트랜잭션에서 지킨다(`insertOwnedDataSource` — data source 를 더할 때도 같은 함수다):
 *
 *   DS1: 모든 `data_source` 는 `(owner_database_id, id)` 부착 행을 **정확히 1개**
 *        갖는다. PK 가 "1개 이하"를, 0042 의 지연 트리거가 커밋 때 "적어도 1개"를 본다(8e-1).
 *   P1:  `data_source` 당 살아있는 `title` 프로퍼티가 **정확히 1개**. 부분 UNIQUE
 *        인덱스가 "1개 이하"를, 이 함수가 "적어도 1개"를 지킨다.
 *
 * 나눠서 만들면 그 사이에 DS1·P1 을 어긴 data_source 가 존재하는 구간이 생기고,
 * 그 구간에 읽기가 들어오면 제목 없는 표가 화면에 나온다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 지금 만드는 것은 **풀페이지 데이터베이스**다 (워크스페이스 · teamspace 최상위)
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
import { asBlockId, isUuid } from '../ids.ts'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { enterPrivateRoot, inheritFromWorkspace } from '../permissions/acl.ts'
import { effectiveCaps, readableScopes, teamspaceCaps } from '../permissions/effective.ts'
import { canOpenDatabase } from './row-access.ts'
import { isLocked } from '../permissions/lock.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import { listAncestors, lockParentPage, nextSiblingKey, PageError, titleFromPlainText, plainTitleOf, type PageSummary } from '../block/page.ts'
import { openPageBody } from '../block/body-write.ts'
import { appendPageRef, placePageRefAt } from '../block/page-refs.ts'
import { pageIconJson, parsePageIconInput, readPageIcon, samePageIcon, type PageIcon } from '../block/page-icon.ts'
import { isUsableIcon, moveIconFileReference } from '../file/icon-reference.ts'
import { indexPageTitle } from '../search/index-page.ts'
import { insertLinkedAttachment, insertOwnedDataSource, readDataSources, type DataSourceSummary } from './data-source.ts'
import { canViewOwnerDatabase } from './source-access.ts'
import { normalizeDatabaseQuery } from './linked-picker.ts'

export { DEFAULT_TITLE_PROPERTY_NAME } from './data-source.ts'

export const MAX_DATABASE_NAME_LENGTH = 200

export type DatabaseDetail = {
  /** `block.id` 와 같다 [X-2]. */
  readonly id: string
  readonly name: string
  /**
   * 데이터베이스 자신의 아이콘(8c-3b) — 정본의 `database.icon`. 없으면 null. 모양은 페이지 아이콘과 같다(`block/page-icon.ts`) —
   * 블록의 `format.page_icon` 은 페이지 행만 갖는다(0037).
   */
  readonly icon: PageIcon | null
  /**
   * 이 데이터베이스에 붙은 data source 들 — 부착 순서대로(8e-1 · F-04-23). 적어도 하나다(DS1). 뷰마다 그중 하나를 본다 —
   * "이 표의 data source" 를 물을 때는 뷰의 것을 쓴다(`ViewDetail.dataSourceId`). 첫째를 대표로 고르지 않는다.
   */
  readonly dataSources: readonly DataSourceSummary[]
  readonly isInline: boolean
  /** teamspace 최상위면 그 teamspace(7c-8 — 화면의 "이동"이 현재 자리를 안다). */
  readonly teamspaceId: string | null
  /** 개인 최상위면 그 주인(7c-8). `PageSummary.ownerUserId` 와 같은 규칙 — 서버 렌더 판별용, 라우트 JSON 에 싣지 않는다. */
  readonly ownerUserId: string | null
}

/** 방금 만든 데이터베이스 — data source 는 하나이고, 기본 뷰가 함께 생긴다. */
export type CreatedDatabase = DatabaseDetail & {
  /** 함께 만든 data source(첫째이자 유일한 것). */
  readonly dataSourceId: string
  /** 기본 뷰. 표를 만들면 항상 하나가 함께 생긴다. */
  readonly defaultViewId: string
}

/**
 * 이 사람이 이 표에서 할 수 있는 것 — **화면 표시 전용.**
 *
 * 화면이 "+ 새로 만들기"·컬럼 추가 버튼을 그릴지 정한다. F-04-01: *"`+` 버튼과 탭
 * 컨텍스트 메뉴는 렌더하지 않는다(비활성 표시보다 미노출이 안전)."* 판정은 쓰기
 * 경로가 `can()` 으로 **다시 한다** — 이 값으로 서버 판정을 대신하지 않는다
 * (`displayLevel()` 과 같은 규칙).
 */
export type DatabaseAccess = {
  /**
   * 모든 행을 본다(`view`). 아니면 "만들기만"(6f-2b-1 — `create_child` 만) — 표를 열지만 행은 자기가 열 수 있는 것만 온다
   * (`row-access.ts`). 화면이 "내가 열 수 있는 행만 보인다" 를 말할 때 읽는다.
   */
  readonly canViewAllRows: boolean
  /** 셀을 고칠 수 있다 (`edit_content`). */
  readonly canEditContent: boolean
  /** 행을 추가할 수 있다 (`create_child`). */
  readonly canCreateRows: boolean
  /** 컬럼 · 옵션 · 뷰 설정 · 표 이름을 고칠 수 있다 (`edit_structure`). */
  readonly canEditStructure: boolean
}

export type DatabaseFailure =
  | 'not_found'
  | 'forbidden'
  | 'invalid_name'
  /** 아이콘의 모양이 아니다 — 이모지 한 글자 · 이 워크스페이스에 올린 이미지 · http(s) 이미지 주소(8c-3b · 8c-4 — 페이지 아이콘과 같은 규칙). */
  | 'invalid_icon'
  /** 데이터베이스(구조) · 행 페이지가 잠겼다(7f-2 · F-06-16) — 풀어야 고친다. */
  | 'locked'
  /** 인라인 데이터베이스(I-1)의 자리가 트리 깊이 상한을 넘는다(`MAX_TREE_DEPTH` — 하위 페이지와 같은 상한). */
  | 'too_deep'

export type DatabaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DatabaseFailure }

export type CreateDatabaseInput = {
  /** 표 이름. 비면 빈 제목으로 만든다(페이지와 같은 규칙). */
  readonly name?: string
  /**
   * 그 teamspace 의 최상위에 만든다(7c-4 · `createPage` 의 teamspace 자리와 같다). 멤버여야 한다 — 아니면 `not_found`.
   * 생략하면 워크스페이스 최상위다.
   */
  readonly teamspaceId?: string | null
  /**
   * **내 개인 최상위**에 만든다(7c-8 · `createPage` 의 `privateTop` 과 같은 규칙 — 7c-4 가 정한 "최상위 자리를 받는 생성은
   * 둘이고 같은 규칙"). 나만 본다. `teamspaceId` 와 함께 주지 않는다. 게스트는 못 만든다.
   */
  readonly privateTop?: boolean
}

function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DATABASE_NAME_LENGTH)
}

/**
 * 풀페이지 데이터베이스를 만든다.
 *
 * 자리는 둘이다 — `createPage` 의 최상위와 같은 규칙이다.
 *
 *   - 워크스페이스 최상위: **자기 자신이 `perm_scope_id`** 이며 ACL 을 갖고 태어난다(`inheritFromWorkspace`). `effective()` 가
 *     켜진 뒤로 ACL 없는 노드는 아무도 못 보는 노드이기 때문이다
 *   - teamspace 최상위(7c-4): 그 teamspace 행을 잠그고, 거기에 둘 수 있어야 한다(`teamspaceCaps` 의 `create_child` — 멤버).
 *     행을 넣지 않는다 — teamspace 노드의 부여를 물려받고 스코프는 teamspace id 다(정본 §3.11 *"없으면 teamspace 루트 id"*).
 *     없는 · 보관된 · 남의 · 멤버가 아닌 teamspace 는 전부 `not_found` 다(구분하면 존재를 알려 준다)
 *   - 내 개인 최상위(7c-8): 워크스페이스 부모 + `owner_user_id` = 나(판결문 C-9). 행은 내 full_access 하나
 *     (`enterPrivateRoot`)이고 표의 행(row)도 그 스코프를 따른다 — 나만 본다. 게스트는 `not_found`
 */
export async function createDatabase(
  ctx: SessionContext,
  input: CreateDatabaseInput = {},
): Promise<DatabaseResult<CreatedDatabase>> {
  const name = normalizeName(input.name)
  const teamspaceId = input.teamspaceId ?? null
  const privateTop = input.privateTop === true

  return withCommandTransaction(async (tx) => {
    const id = randomUUID()

    if (privateTop && (teamspaceId !== null || ctx.role === 'guest')) {
      // 자리 지정은 하나만 · 게스트에게는 개인 섹션이 없다(createPage 의 개인 자리와 같은 답).
      return { ok: false, reason: 'not_found' } as const
    }
    if (privateTop) {
      await tx.query(`SELECT id FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    }
    if (teamspaceId !== null) {
      const teamspace = await tx.queryMaybe<{ id: string }>(
        `SELECT id FROM teamspace WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL FOR UPDATE`,
        [teamspaceId, ctx.workspaceId],
      )
      if (teamspace === null || !can(await teamspaceCaps(tx, ctx, teamspace.id), 'create_child')) {
        return { ok: false, reason: 'not_found' } as const
      }
    }
    const parentType = teamspaceId === null ? 'workspace' : 'teamspace'
    const parentId = teamspaceId ?? ctx.workspaceId
    const ownerUserId = privateTop ? ctx.userId : null

    // 최상위 형제들 사이의 자리. 페이지와 같은 축을 쓴다 — 사이드바가 둘을 한 목록으로 보여주므로 순서가 같아야 한다.
    const orderKey = await nextSiblingKey(tx, parentId)

    await tx.query(
      `INSERT INTO block (
         id, workspace_id, type,
         parent_type, parent_id, order_key, ancestor_path, perm_scope_id, owner_user_id,
         properties, format, created_by, created_at, last_edited_by, last_edited_at
       ) VALUES (
         $1, $2, 'database',
         $6, $7, $3, '{}', $8, $9,
         $4::jsonb, '{}'::jsonb, $5, now(), $5, now()
       )`,
      [
        id,
        ctx.workspaceId,
        orderKey,
        JSON.stringify({ title: titleFromPlainText(name) }),
        ctx.userId,
        parentType,
        parentId,
        teamspaceId ?? id,
        ownerUserId,
      ],
    )

    // 검색 색인의 이름(10p-2 · 정본 §3.9 [보강] 데이터베이스 자신의 이름 색인 ②) — 색인 행은 위 INSERT 에서 트리거가 만들었다(메타는
    // 트리거가 · 이름은 여기서). 페이지를 만들 때와 같은 함수다.
    await indexPageTitle(tx, id, name)

    // 워크스페이스 최상위 노드는 ACL 을 갖고 태어난다(W6-b 의 규칙) — 최상위 페이지와 같은 함수다. teamspace 최상위는
    // teamspace 노드에서 물려받고, 개인 최상위는 내 행 하나다(7c-8 — createPage 와 같은 갈림).
    if (privateTop) await enterPrivateRoot(tx, ctx, id)
    else if (teamspaceId === null) await inheritFromWorkspace(tx, ctx, id)

    const value = await insertDatabaseRows(tx, { id, name, isInline: false })
    return { ok: true, value: { ...value, teamspaceId, ownerUserId } } as const
  })
}

/**
 * 데이터베이스 행과 그 최소 한 벌(data source · 소유 부착 행 · 제목 속성 · 기본 뷰)을 넣는다 — 풀페이지(`createDatabase`)와
 * 인라인(`createInlineDatabase`)이 같은 함수를 쓴다. 블록 행은 부르는 쪽이 먼저 넣었다.
 */
async function insertDatabaseRows(
  tx: Tx,
  input: { readonly id: string; readonly name: string; readonly isInline: boolean },
): Promise<Omit<CreatedDatabase, 'teamspaceId' | 'ownerUserId'>> {
  const { id, name, isInline } = input
  await tx.query(
    `INSERT INTO database (id, title_rich, is_inline, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, now(), now())`,
    [id, JSON.stringify(titleFromPlainText(name)), isInline],
  )

  // data source 하나와 그 최소 한 벌(소유 부착 행 · 제목 속성 · 기본 뷰) — 더하기(`addDataSource`)와 같은 함수다.
  //
  // ★ 기본 뷰. **뷰가 없는 데이터베이스는 화면에 그릴 것이 없다** — `deleteView` 가 마지막 뷰 삭제를 막는 이유와 같다. 여기서
  //   만들지 않으면 표를 만든 사람이 뷰를 먼저 만들어야 하는 상태가 된다.
  const sourceName = name === '' ? '표' : name
  const sourceOrder = orderKeyBetween(null, null)
  const { dataSourceId, viewId } = await insertOwnedDataSource(tx, {
    databaseId: id,
    name: sourceName,
    sourceOrder,
    viewOrder: orderKeyBetween(null, null),
  })

  return {
    id,
    name,
    icon: null,
    dataSources: [{ id: dataSourceId, name: sourceName, owned: true, orderKey: sourceOrder, readable: true, ownerDatabaseId: id }],
    dataSourceId,
    isInline,
    defaultViewId: viewId,
  }
}

/**
 * 붙일 소스 — 살아 있고 이 사람이 원본을 볼 수 있으면 그 이름들(정본 [보강 L-1] ②). 아니면 null(없는 것과 같다).
 * `displayName` 은 그릇의 처음 이름이다 — 원본의 소스가 하나면 원본 데이터베이스의 지금 이름(소스 이름은 하나일 때 화면에 나오지 않아 낡을
 * 수 있다 — §3.6 [보강] 다중 data source ③), 여럿이면 그 소스의 이름.
 */
async function linkableSource(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
): Promise<{ readonly name: string; readonly owner: string; readonly displayName: string } | null> {
  const source = await tx.queryMaybe<{ name: string; owner: string; owner_properties: Record<string, unknown> | null; attached: number }>(
    `SELECT ds.name, ds.owner_database_id AS owner, b.properties AS owner_properties,
            (SELECT count(*)::int FROM database_data_source x WHERE x.database_id = ds.owner_database_id) AS attached
       FROM data_source ds JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND ds.lifecycle = 'live' AND b.workspace_id = $2`,
    [dataSourceId, ctx.workspaceId],
  )
  if (source === null || !(await canViewOwnerDatabase(tx, ctx, source.owner))) return null
  const ownerName = plainTitleOf(source.owner_properties)
  return { name: source.name, owner: source.owner, displayName: source.attached <= 1 && ownerName !== '' ? ownerName : source.name }
}

/** 소유한 소스 없이 붙인 소스 하나를 가진 데이터베이스의 행(정본 [보강 L-1] ①). */
async function insertLinkedDatabaseRows(
  tx: Tx,
  input: { readonly id: string; readonly name: string; readonly dataSourceId: string; readonly source: { readonly name: string; readonly owner: string } },
): Promise<Omit<CreatedDatabase, 'teamspaceId' | 'ownerUserId'>> {
  await tx.query(
    `INSERT INTO database (id, title_rich, is_inline, created_at, updated_at)
     VALUES ($1, $2::jsonb, true, now(), now())`,
    [input.id, JSON.stringify(titleFromPlainText(input.name))],
  )
  const added = await insertLinkedAttachment(tx, input.id, input.dataSourceId, input.source)
  return {
    id: input.id,
    name: input.name,
    icon: null,
    dataSources: [added.dataSource],
    dataSourceId: input.dataSourceId,
    isInline: true,
    defaultViewId: added.viewId,
  }
}

/**
 * 인라인 데이터베이스를 만든다(26번 트랙 I-1 · 정본 §3.5 [보강 I-1] ①) — 부모 페이지 본문 안의 데이터베이스.
 *
 * 하위 페이지를 만드는 것과 같은 순서다(`page.ts` `createPageIn`): 부모 페이지를 잠그고(권한 `create_child` · 깊이 — 하위 페이지와 같은
 * 규칙) **행을 넣기 전에** 부모 본문을 연 뒤, 데이터베이스 블록(부모 = 그 페이지 · 경로 · 권한 스코프는 물려받는다 · ACL 행을 두지 않는다)과
 * 그 한 벌을 넣고, 본문에 참조 노드(`database_ref`)를 넣어 투영한다 — 한 트랜잭션. `at` 을 주면 그 블록 자리(비었으면 대체 · 아니면 바로 뒤),
 * 없으면 본문 맨 뒤. 투영이 자리(부모 · 순서 키 · 경로)를 문서 위치로 매긴다 — 토글 안이면 부모가 그 토글이다.
 *
 * **라우트가 없다** — 만드는 길은 I-2 가 연다. 휴지통 · 되살리기 · 복제 · 되돌리기의 규칙(I-1b)이 먼저 서야 한다(반쯤 열면 데이터가
 * 사라지는 길이 생긴다 — 정본 ⑤). 지금은 검사가 쓴다.
 */
export async function createInlineDatabase(
  ctx: SessionContext,
  input: {
    readonly parentPageId: string
    readonly name?: string
    readonly at?: string
    /**
     * 본문 안의 연결된 데이터베이스(27번 트랙 L-1 · 정본 [보강 L-1]) — 주면 소유한 소스 없이 이 소스를 붙인 그릇을 만든다(붙이기와 같은
     * 몸 — 부착 행 하나 + 그 소스를 보는 표 뷰 하나). 원본을 볼 수 없거나 없는 · 휴지통의 소스면 `not_found`.
     */
    readonly linkedDataSourceId?: string
  },
): Promise<DatabaseResult<CreatedDatabase>> {
  let name = normalizeName(input.name)
  // uuid 가 아니면 없는 것과 같이 답한다(존재를 알리지 않는다 · asBlockId 는 던진다)
  if (!isUuid(input.parentPageId)) return { ok: false, reason: 'not_found' }
  if (input.linkedDataSourceId !== undefined && !isUuid(input.linkedDataSourceId)) return { ok: false, reason: 'not_found' }
  return withCommandTransaction(async (tx) => {
    // 붙일 소스 — 행을 넣기 **전에** 묻는다(실패하면 아무것도 쓰지 않는다). 원본을 볼 수 없으면 없는 것과 같은 답(정본 ⑪)
    const linked = input.linkedDataSourceId === undefined ? null : await linkableSource(tx, ctx, input.linkedDataSourceId)
    if (input.linkedDataSourceId !== undefined && linked === null) return { ok: false, reason: 'not_found' } as const
    // 이름을 주지 않으면 원본의 이름(정본 [보강 L-1] ① — 그 뒤 그릇의 이름은 그릇의 것)
    if (linked !== null && name === '') name = linked.displayName
    let placement: Awaited<ReturnType<typeof lockParentPage>>
    try {
      placement = await lockParentPage(tx, ctx, asBlockId(input.parentPageId))
    } catch (e) {
      if (e instanceof PageError) return { ok: false, reason: e.code === 'too_deep' ? 'too_deep' : 'not_found' } as const
      throw e
    }
    // 하위 페이지와 같다 — 행을 넣기 **전에** 부모 본문을 연다(명령이 자기가 바꾼 것을 자기가 쓰는 순서 · `body-write.ts` 머리말).
    const parentBody = await openPageBody(tx, ctx, placement.parentId)
    const orderKey = await nextSiblingKey(tx, placement.parentId)
    const id = randomUUID()
    await tx.query(
      `INSERT INTO block (
         id, workspace_id, type,
         parent_type, parent_id, order_key, ancestor_path, perm_scope_id,
         properties, format, created_by, created_at, last_edited_by, last_edited_at
       ) VALUES (
         $1, $2, 'database',
         'block', $3, $4, $5, $6,
         $7::jsonb, '{}'::jsonb, $8, now(), $8, now()
       )`,
      [id, ctx.workspaceId, placement.parentId, orderKey, placement.ancestorPath, placement.permScopeId, JSON.stringify({ title: titleFromPlainText(name) }), ctx.userId],
    )
    await indexPageTitle(tx, id, name)
    const value = linked === null
      ? await insertDatabaseRows(tx, { id, name, isInline: true })
      : await insertLinkedDatabaseRows(tx, { id, name, dataSourceId: input.linkedDataSourceId!, source: linked })

    parentBody.change(input.at ? placePageRefAt(id, input.at, 'database') : appendPageRef(null, id, 'database'))
    const result = await parentBody.finish()
    if (!result.ok && result.reason === 'page_ref_too_deep') return { ok: false, reason: 'too_deep' } as const
    if (!result.ok) throw new Error(`본문 투영이 인라인 데이터베이스 생성을 거부했다(${result.reason}): ${placement.parentId}`)
    return { ok: true, value: { ...value, teamspaceId: null, ownerUserId: null } } as const
  })
}

/**
 * 데이터베이스 이름을 바꾼다.
 *
 * 이름이 **두 곳**에 있다 — `block.properties.title`(사이드바 · breadcrumb · 최근
 * 방문이 읽는 블록 제목)과 `database.title_rich`(정본 §3.5 의 DB 제목). 같은
 * 트랜잭션에서 둘 다 쓴다. 하나만 쓰면 사이드바와 표 머리의 이름이 갈린다. 검색
 * 색인의 이름도 같은 트랜잭션에서 쓴다(10p-2 — 0108 부터 색인 행은 데이터베이스
 * 노드에도 있다 · `renamePage` 와 같은 함수 `indexPageTitle`).
 *
 * `renamePage` 를 빌려 쓰지 않는다. 그 함수는 `type='page'` 만 받는다 — 묻는
 * 권한(`edit_structure`)과 잠금의 뜻이 다르다.
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

  return withCommandTransaction(async (tx) => {
    const row = await loadDatabase(tx, ctx, databaseId)
    if (row === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, databaseId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_structure')) return { ok: false, reason: 'forbidden' } as const
    // 이름은 구조다 — 잠긴 데이터베이스는 거부한다(7f-2).
    if (await isLocked(tx, databaseId)) return { ok: false, reason: 'locked' } as const

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
    await indexPageTitle(tx, databaseId, name)

    return {
      ok: true,
      value: {
        id: row.id,
        name,
        icon: readPageIcon(row.icon),
        dataSources: await readDataSources(tx, databaseId, ctx),
        isInline: row.is_inline,
        teamspaceId: row.parent_type === 'teamspace' ? row.parent_id : null,
        ownerUserId: row.parent_type === 'workspace' ? row.owner_user_id : null,
      },
    } as const
  })
}

/**
 * 데이터베이스 자신의 아이콘을 바꾼다 — 잔여 묶음 8c-3b (F-02-05). `null` 은 지우기.
 *
 * 자리는 정본의 `database.icon` 이다(0038 — 블록의 `format.page_icon` 은 페이지 행만 갖는다). 모양 · 받기 규칙은 페이지 아이콘과
 * 같은 함수다(`parsePageIconInput` — 이모지 한 글자).
 *
 * **이름과 같은 권한이다** — `edit_structure` 이고, 데이터베이스가 잠기면 막는다(7f-2 — 잠금 안내가 이미 "이름"을 구조로 센다). 아이콘은
 * 이름 옆에 서는 표의 모습이고, 모두가 보는 사이드바 · teamspace 화면에 선다. 행 · 셀(`edit_content`)을 고치는 사람이 바꾸는 것이
 * 아니다. 페이지 아이콘이 `edit_content` 인 것도 그 페이지의 이름이 그렇기 때문이다 — 둘 다 각자의 이름을 따른다.
 *
 * 블록 행을 먼저 잠근다 — 잠그는 명령(`setDatabaseLock`)이 같은 행에 줄을 선다. 같은 아이콘이면 쓰지 않는다. 바뀌면 블록의
 * `last_edited_*` · `version` 을 올린다(이름과 같다).
 *
 * 이미지 아이콘(8c-4)은 페이지와 같다 — 올린 파일은 이 워크스페이스의 이미지여야 하고(`invalid_icon`), 참조 수를 같은 트랜잭션에서 옮긴다.
 * 커스텀 이모지(7c-2a)도 페이지와 같다 — 이 워크스페이스의 살아 있는 이모지여야 한다.
 */
export async function setDatabaseIcon(
  ctx: SessionContext,
  databaseId: string,
  rawIcon: unknown,
): Promise<DatabaseResult<PageIcon | null>> {
  const icon = parsePageIconInput(rawIcon)
  if (icon === undefined) return { ok: false, reason: 'invalid_icon' } as const

  return withCommandTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ icon: unknown }>(
      `SELECT d.icon FROM block b JOIN database d ON d.id = b.id
        WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = 'database' AND b.lifecycle = 'live'
        FOR UPDATE OF b`,
      [databaseId, ctx.workspaceId],
    )
    if (row === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, databaseId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_structure')) return { ok: false, reason: 'forbidden' } as const
    if (await isLocked(tx, databaseId)) return { ok: false, reason: 'locked' } as const

    const current = readPageIcon(row.icon)
    if (samePageIcon(current, icon)) return { ok: true, value: icon } as const
    if (icon !== null && !(await isUsableIcon(tx, ctx, icon))) {
      return { ok: false, reason: 'invalid_icon' } as const
    }
    await tx.query(`UPDATE database SET icon = $2::jsonb, updated_at = now() WHERE id = $1`, [
      databaseId,
      icon === null ? null : JSON.stringify(pageIconJson(icon)),
    ])
    await tx.query(
      `UPDATE block SET last_edited_by = $2, last_edited_at = now(), version = version + 1 WHERE id = $1`,
      [databaseId, ctx.userId],
    )
    await moveIconFileReference(tx, ctx, current, icon)
    return { ok: true, value: icon } as const
  })
}

type DatabaseRow = {
  parent_type: string
  parent_id: string
  owner_user_id: string | null
  id: string
  properties: { title?: unknown } | null
  icon: unknown
  is_inline: boolean
}

/**
 * 데이터베이스 하나를 읽는다 — 붙은 data source 들을 부착 순서대로 함께 준다(8e-1). 소유와 부착은 다른 축이다(C-5) — 붙인 것(linked)인지는
 * 각 항목의 `owned` 가 말한다.
 */
export async function getDatabase(
  ctx: SessionContext,
  databaseId: string,
): Promise<DatabaseResult<DatabaseDetail & { readonly access: DatabaseAccess }>> {
  return withReadTransaction(async (tx) => {
    const row = await loadDatabase(tx, ctx, databaseId)
    if (row === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, databaseId)
    // 표를 여는 문 — 볼 수 있거나 "만들기만"(6f-2b-1). 행은 돌려주지 않는다(`view.ts` `openDatabase` 머리말).
    if (!canOpenDatabase(caps)) {
      return { ok: false, reason: 'not_found' } as const
    }
    return {
      ok: true,
      value: {
        id: row.id,
        name: plainTitleOf(row.properties),
        icon: readPageIcon(row.icon),
        dataSources: await readDataSources(tx, databaseId, ctx),
        isInline: row.is_inline,
        teamspaceId: row.parent_type === 'teamspace' ? row.parent_id : null,
        ownerUserId: row.parent_type === 'workspace' ? row.owner_user_id : null,
        access: {
          canViewAllRows: can(caps, 'view'),
          canEditContent: can(caps, 'edit_content'),
          canCreateRows: can(caps, 'create_child'),
          canEditStructure: can(caps, 'edit_structure'),
        },
      },
    } as const
  })
}

export type DatabaseListItem = {
  readonly id: string
  readonly name: string
  /** 아이콘(8c-3b) — 없으면 null. 관계형의 대상 고르개(`<select>`)가 이름 앞에 싣는다. */
  readonly icon: PageIcon | null
  /** relation 이 가리키는 것은 데이터베이스가 아니라 이 data source 다(`config.target_data_source_id`). */
  readonly dataSourceId: string
  /**
   * 데이터베이스가 data source 를 둘 이상 가지면 그 이름 — 고르개가 "데이터베이스 · 소스"로 가른다(8e-1). 하나뿐이면 null 이다 —
   * 그 이름은 화면에 나오지 않는다(`data-source.ts` 머리말 "이름").
   */
  readonly sourceName: string | null
}

/** 목록의 상한. relation 의 대상 고르기가 읽는다 — 워크스페이스에 표가 이보다 많으면 검색이 있어야 한다(HANDOFF §7). */
export const MAX_DATABASE_LIST = 200

/**
 * 이 사람이 **볼 수 있는** 데이터베이스의 data source 들 — relation 프로퍼티의 대상을 고를 때 읽는다(relation 5b-2 · F-03-10 시나리오 1).
 * 항목은 data source 하나다(8e-1) — 소유한 것만이고(붙인 것은 원본 데이터베이스 쪽에서 한 번 나온다), 한 데이터베이스의 것은 부착 순서대로
 * 붙어 나온다. 상한도 data source 로 센다.
 *
 * 권한은 목록 필터와 같은 축이다(`readableScopes` — 사이드바 · 검색 · 제목 맵과 같다): 볼 수 없는 표는 **쿼리 밖으로 나오지
 * 않는다.** 뽑아서 거르지 않는다 — 거르기를 빠뜨려 이름이 새는 경로를 만들지 않는다. 이름순으로 준다(같은 이름은 만든 순서).
 */
export async function listDatabases(ctx: SessionContext, options: { readonly query?: unknown } = {}): Promise<DatabaseListItem[]> {
  // 이름으로 거르기(27번 트랙 L-2 — 본문의 연결 고르개) — 상한 밖의 데이터베이스를 찾는다. 검색 색인의 이름(`search_document.title_text`
  // — 데이터베이스 노드에도 있다 · 10p-2)을 pg_bigm 의 `likequery` 로(`%` · `_` 를 막는다 · 검색과 같은 함수). 대소문자는 가리지 않는다.
  const query = normalizeDatabaseQuery(options.query)
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    const rows = await tx.query<{
      id: string
      properties: { title?: unknown } | null
      icon: unknown
      data_source_id: string
      source_name: string
      sources: string
    }>(
      `SELECT b.id, b.properties, d.icon, ds.id AS data_source_id, ds.name AS source_name,
              count(*) OVER (PARTITION BY d.id) AS sources
         FROM block b
         JOIN database d ON d.id = b.id
         JOIN data_source ds ON ds.owner_database_id = d.id
         JOIN database_data_source dds ON dds.database_id = d.id AND dds.data_source_id = ds.id
        WHERE b.workspace_id = $1 AND b.type = 'database' AND b.lifecycle = 'live' AND ds.lifecycle = 'live'
          AND b.perm_scope_id = ANY($2::uuid[])
          ${query === null ? '' : `AND EXISTS (SELECT 1 FROM search_document sd WHERE sd.doc_id = b.id AND sd.title_text ILIKE likequery($4))`}
        ORDER BY b.created_at, b.id, dds.order_idx, ds.id
        LIMIT $3`,
      [ctx.workspaceId, scopes, MAX_DATABASE_LIST, ...(query === null ? [] : [query])],
    )
    // 이름순은 안정 정렬이다 — 같은 데이터베이스의 소스들이 부착 순서를 지킨다.
    return rows
      .map((row) => ({
        id: row.id,
        name: plainTitleOf(row.properties),
        icon: readPageIcon(row.icon),
        dataSourceId: row.data_source_id,
        sourceName: Number(row.sources) > 1 ? row.source_name : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  })
}

/**
 * teamspace 최상위의 데이터베이스 — 볼 수 있는 것만(스코프로 거른다 · `listTeamspacePages` 와 같은 규칙). teamspace 를 볼 수
 * 없으면 비어 있다 — 없는 teamspace 와 같은 답이다. 형제 순서(`order_key`)대로 준다(7c-4).
 */
export async function listTeamspaceDatabases(
  ctx: SessionContext,
  teamspaceId: string,
): Promise<{ id: string; name: string; icon: PageIcon | null }[]> {
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    const rows = await tx.query<{ id: string; properties: { title?: unknown } | null; icon: unknown }>(
      `SELECT b.id, b.properties, d.icon FROM live_block b JOIN database d ON d.id = b.id
        WHERE b.parent_type = 'teamspace' AND b.parent_id = $1 AND b.workspace_id = $2 AND b.type = 'database'
          AND b.perm_scope_id = ANY($3::uuid[])
        ORDER BY b.order_key, b.id`,
      [teamspaceId, ctx.workspaceId, scopes],
    )
    return rows.map((row) => ({ id: row.id, name: plainTitleOf(row.properties), icon: readPageIcon(row.icon) }))
  })
}

async function loadDatabase(
  tx: Tx,
  ctx: SessionContext,
  databaseId: string,
): Promise<DatabaseRow | null> {
  return tx.queryMaybe<DatabaseRow>(
    `SELECT b.id, b.properties, b.parent_type, b.parent_id, b.owner_user_id, d.icon, d.is_inline
       FROM block b
       JOIN database d ON d.id = b.id
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
    [databaseId, ctx.workspaceId],
  )
}

/**
 * 데이터베이스가 놓인 페이지들 — 경로(I-4c)의 조상 줄. 인라인 데이터베이스면 그 페이지와 조상(볼 수 있는 것만 · 위에서 아래로 ·
 * `listAncestors` 와 같은 규칙), 최상위 데이터베이스면 빈 목록. 부르는 쪽이 이 데이터베이스를 볼 수 있다는 것을 이미 확인했다
 * (`getDatabase`) — 없거나 휴지통이면 빈 목록.
 */
export async function listDatabaseAncestors(ctx: SessionContext, databaseId: string): Promise<PageSummary[]> {
  if (!isUuid(databaseId)) return []
  const row = await withReadTransaction((tx) =>
    tx.queryMaybe<{ ancestor_path: string[] }>(
      `SELECT ancestor_path FROM live_block WHERE id = $1 AND workspace_id = $2 AND type = 'database'`,
      [databaseId, ctx.workspaceId],
    ),
  )
  if (row === null || row.ancestor_path.length === 0) return []
  return listAncestors(ctx, { ancestors: row.ancestor_path as PageSummary['id'][] })
}
