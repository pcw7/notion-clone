/**
 * 페이지 — `block` 테이블의 `type='page'` 행 (F-02-01 / F-01-01)
 *
 * 정본: 00-canonical-data-model.md §3.4, 판결 C-3 · C-9 · C-10 · X-3 · X-7
 *
 * **페이지는 별도 엔티티가 아니다** (판결 C-3). `page` 테이블도 `row_page` 테이블도
 * 만들지 않는다. 페이지는 `type='page'` 인 블록이고, 그 블록의 자식이 본문이다.
 * 그래서 "페이지 안의 페이지"와 "문단 안의 문단"이 같은 코드 경로를 쓴다.
 *
 * 이 파일이 책임지는 것은 **트리 불변식 4개**다. 전부 조용히 깨지는 종류라
 * 각각에 대해 실패 경로 테스트가 있다.
 *
 *   1. `ancestor_path` 는 루트→parent 까지의 블록 id 순서 배열이다 [X-7]
 *   2. `perm_scope_id` 는 자신 또는 가장 가까운 "권한 경계" 조상의 id 다
 *   3. `order_key` 는 **같은 parent_id 를 가진 모든 행**에서 유일하다
 *      — 자식 페이지와 본문 문단이 같은 이름공간을 쓴다
 *   4. 깊이는 `MAX_TREE_DEPTH` 를 넘지 못한다
 *
 * **보안 축은 둘이다.** 모든 조회는 `workspace_id` 를 술어에 넣고(워크스페이스 경계), 그 안에서 **페이지 권한**을
 * 본다 — 하나를 읽으면 `view`, 제목을 담는 목록은 `perm_scope_id = ANY(readableScopes)`. 한때 이 머리말이
 * "워크스페이스 경계가 보안 축"이라고만 적었고, 그 전제로 남은 목록 둘이 볼 수 없는 페이지의 제목을 내줬다(#76).
 * 블록 id 는 uuid 라 추측할 수 없지만, 추측 불가능성은 권한이 아니다 — 링크가 유출되면 그대로 뚫린다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { query } from '../db/pool.ts'
import { orderKeyBetween } from './order-key.ts'
import { can } from '../permissions/levels.ts'
import { inheritFromWorkspace } from '../permissions/acl.ts'
import { canViewPage, effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { MAX_TREE_DEPTH } from './types.ts'
import { indexPageTitle } from '../search/index-page.ts'
import { openPageBody } from './body-write.ts'
import { appendPageRef, placePageRefAt } from './page-refs.ts'
import {
  normalizeRichText,
  toPlainText,
  textRun,
  validateRichText,
  type RichTextRun,
} from '../contracts/rich-text.ts'

// 트리 깊이 상한은 레지스트리(`types.ts`)가 소유한다 — 페이지 트리와 본문
// 문서가 같은 값을 써야 하기 때문이다. 여기서 다시 내보내는 것은 호출자가
// "페이지 관련 상수"를 찾는 자리가 이 파일이기 때문.
export { MAX_TREE_DEPTH }

/** 제목 평문 상한. rich text 런 하나의 상한(2000)과 같은 축으로 둔다. */
export const MAX_TITLE_LENGTH = 2000

// ── 오류 ──────────────────────────────────────────────────────────────

export type PageErrorCode =
  | 'parent_not_found' // 부모가 없거나 다른 워크스페이스거나 페이지가 아님
  | 'too_deep' // MAX_TREE_DEPTH 초과
  | 'invalid_title' // RichText[] 계약 위반
  | 'not_found' // 대상 페이지 없음 / 다른 워크스페이스

export class PageError extends Error {
  // 파라미터 프로퍼티(`constructor(readonly code: ...)`)를 쓰지 않는다 —
  // node 의 strip-only TypeScript 모드가 지원하지 않아 `node --test` 가 죽는다.
  readonly code: PageErrorCode

  constructor(code: PageErrorCode, message: string) {
    super(message)
    this.name = 'PageError'
    this.code = code
  }
}

// ── 타입 ──────────────────────────────────────────────────────────────

export type PageSummary = {
  readonly id: BlockId
  readonly title: RichTextRun[]
  /** 사이드바·탭 제목용 평문. 빈 제목이면 빈 문자열이다(호출자가 대체 문구를 고른다). */
  readonly plainTitle: string
  /** 루트 페이지면 null. */
  readonly parentPageId: BlockId | null
  readonly orderKey: string
  readonly createdAt: Date
  readonly lastEditedAt: Date
}

export type PageDetail = PageSummary & {
  /** 루트→부모까지의 조상 페이지. breadcrumb 용. 루트 페이지면 빈 배열. */
  readonly ancestors: readonly BlockId[]
  readonly permScopeId: string
  readonly version: string
}

/** 모든 페이지 조회가 같은 열 집합을 읽는다. 어긋나면 toSummary 가 조용히 undefined 를 본다. */
const PAGE_COLUMNS = `id, properties, parent_type, parent_id, order_key,
                      ancestor_path, perm_scope_id, created_at, last_edited_at, version`

type PageRow = {
  id: string
  properties: { title?: unknown } | null
  parent_type: string
  parent_id: string
  order_key: string
  ancestor_path: string[]
  perm_scope_id: string
  created_at: Date
  last_edited_at: Date
  version: string
}

function toSummary(row: PageRow): PageSummary {
  const title = readTitle(row.properties)
  return {
    id: asBlockId(row.id),
    title,
    plainTitle: toPlainText(title),
    parentPageId: row.parent_type === 'block' ? asBlockId(row.parent_id) : null,
    orderKey: row.order_key,
    createdAt: row.created_at,
    lastEditedAt: row.last_edited_at,
  }
}

/**
 * `properties.title` 을 읽는다.
 *
 * 계약을 어긴 값이 DB 에 있어도 **던지지 않는다.** 제목 하나가 망가졌다고
 * 페이지 목록 전체가 500 이 되면 복구할 방법이 없어진다. 읽기는 관대하게,
 * 쓰기는 엄격하게.
 *
 * 익스포트 스냅샷(`export/snapshot.ts`)도 이 함수로 읽는다 — 화면과 백업의 제목이
 * 다른 규칙으로 읽히면 안 된다.
 */
export function readTitle(properties: { title?: unknown } | null): RichTextRun[] {
  const raw = properties?.title
  if (!Array.isArray(raw)) return []
  if (validateRichText(raw).length > 0) {
    // 손상된 제목 — 평문만이라도 살린다.
    const salvaged = raw
      .map((r) => (typeof r === 'object' && r !== null ? String((r as { plain_text?: unknown }).plain_text ?? '') : ''))
      .join('')
    return salvaged === '' ? [] : [textRun(salvaged)]
  }
  return normalizeRichText(raw as RichTextRun[])
}

/**
 * 페이지 블록의 제목을 평문으로 읽는다.
 *
 * `readTitle` 의 관대한 규칙(손상된 제목에서 평문만 살린다)을 밖에서도 쓸 수 있게
 * 내보낸다. 검색 색인(W7)이 `block.properties` 를 직접 들고 있을 때 쓴다 —
 * 규칙을 두 벌로 만들면 색인과 화면의 제목이 달라지는 날이 온다.
 */
export function plainTitleOf(properties: { title?: unknown } | null): string {
  return toPlainText(readTitle(properties))
}

// ── 제목 정규화 ───────────────────────────────────────────────────────

/**
 * 폼에서 온 평문 제목을 RichText[] 로 만든다.
 *
 * 제목에는 개행이 없다 — 노션에서 페이지 제목에 Enter 를 치면 본문 첫 블록으로
 * 이동하지 저장되지 않는다. 개행을 공백으로 접어 저장 시점에 없앤다.
 */
export function titleFromPlainText(raw: unknown): RichTextRun[] {
  if (typeof raw !== 'string') return []
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text === '') return []
  return [textRun(text.slice(0, MAX_TITLE_LENGTH))]
}

/** 쓰기 경로의 제목 검증. 읽기(readTitle)와 달리 엄격하다. */
function assertValidTitle(title: readonly RichTextRun[]): RichTextRun[] {
  const issues = validateRichText(title, 'title')
  if (issues.length > 0) {
    throw new PageError(
      'invalid_title',
      `제목이 RichText[] 계약을 위반했습니다: ${issues.map((i) => `${i.path} ${i.message}`).join(', ')}`,
    )
  }
  const normalized = normalizeRichText(title)
  if (toPlainText(normalized).length > MAX_TITLE_LENGTH) {
    throw new PageError('invalid_title', `제목이 ${MAX_TITLE_LENGTH}자를 넘습니다.`)
  }
  return normalized
}

// ── 생성 ──────────────────────────────────────────────────────────────

export type CreatePageInput = {
  /** 자식 페이지로 만들 부모. 생략하면 워크스페이스 루트 페이지가 된다. */
  readonly parentPageId?: BlockId | null
  readonly title?: readonly RichTextRun[]
  /**
   * 부모 본문에서 참조를 넣을 자리 — 편집기의 캐럿이 있던 블록(`page-refs.ts` `placePageRefAt`: 비었으면 대체 · 아니면 바로 뒤 ·
   * 본문에 없으면 맨 뒤). 생략하면 본문 맨 뒤다. 최상위 페이지는 넣을 본문이 없어 보지 않는다.
   */
  readonly at?: BlockId | null
}

type ParentPlacement = {
  parentType: 'workspace' | 'block'
  parentId: string
  ancestorPath: string[]
  permScopeId: string | null // null = 자기 자신이 스코프 루트가 된다
}

/**
 * 부모를 확정하고 **잠근다.**
 *
 * `SELECT ... FOR UPDATE` 가 필요한 이유: 다음 줄에서 형제의 max(order_key) 를
 * 읽어 그 뒤에 새 키를 만드는데, 두 요청이 같은 max 를 읽으면 같은 키를 만들어
 * `ux_block_sibling_order` 에 충돌한다. 부모 행을 잠가 형제 삽입을 직렬화한다.
 * (재시도 루프로도 되지만, 충돌이 흔한 연산에서 재시도는 지연을 튀게 한다.)
 */
async function lockParent(
  tx: Tx,
  ctx: SessionContext,
  parentPageId: BlockId | null | undefined,
): Promise<ParentPlacement> {
  if (!parentPageId) {
    // 워크스페이스 루트. MVP 에는 teamspace 가 없으므로 루트 페이지가 곧
    // 권한 스코프 루트다(정본 §3.11: "없으면 teamspace 루트(또는 Private 루트) id").
    // teamspace 를 도입하면 이 자리에 teamspace id 가 들어간다.
    await tx.query(`SELECT id FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    return {
      parentType: 'workspace',
      parentId: ctx.workspaceId,
      ancestorPath: [],
      permScopeId: null,
    }
  }

  const parent = await tx.queryMaybe<{
    id: string
    ancestor_path: string[]
    perm_scope_id: string
  }>(
    `SELECT id, ancestor_path, perm_scope_id
       FROM block
      WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
      FOR UPDATE`,
    [parentPageId, ctx.workspaceId],
  )

  // 다른 워크스페이스의 페이지 / 휴지통 / 페이지가 아닌 블록 — 전부 같은 오류다.
  // 구분해서 알려주면 "그 id 는 존재한다"를 유출한다.
  if (!parent) {
    throw new PageError('parent_not_found', '부모 페이지를 찾을 수 없습니다.')
  }

  // W6-b: 남의 페이지 밑에 마음대로 하위 페이지를 만들 수 없다.
  if (!can(await effectiveCaps(tx, ctx, parent.id), 'create_child')) {
    throw new PageError('parent_not_found', '부모 페이지를 찾을 수 없습니다.')
  }

  const ancestorPath = [...parent.ancestor_path, parent.id]
  if (ancestorPath.length >= MAX_TREE_DEPTH) {
    throw new PageError(
      'too_deep',
      `페이지 깊이가 상한(${MAX_TREE_DEPTH})에 도달했습니다. 더 깊은 하위 페이지를 만들 수 없습니다.`,
    )
  }

  return {
    parentType: 'block',
    parentId: parent.id,
    ancestorPath,
    permScopeId: parent.perm_scope_id,
  }
}

/**
 * 형제 맨 뒤의 order_key 를 만든다.
 *
 * ⚠ **형제는 페이지만이 아니다.** `ux_block_sibling_order` 는
 * `(parent_id, order_key)` 전체에 걸린 UNIQUE 이고 lifecycle 조건이 없다.
 * 즉 같은 부모의 본문 문단, 그리고 **휴지통에 있는 블록**(B2 가 parent_id·order_key
 * 를 보존한다)까지 같은 이름공간을 쓴다. `type='page'` 로 걸러서 max 를 구하면
 * 언젠가 반드시 충돌한다.
 */
export async function nextSiblingKey(tx: Tx, parentId: string): Promise<string> {
  const row = await tx.queryOne<{ max_key: string | null }>(
    `SELECT max(order_key) AS max_key FROM block WHERE parent_id = $1`,
    [parentId],
  )
  return orderKeyBetween(row.max_key, null)
}

/**
 * 페이지를 만든다.
 *
 * 본문 블록은 만들지 않는다. 빈 페이지는 자식이 0개인 페이지이고, 에디터가
 * 빈 문단 하나를 화면에서 합성한다 — 서버가 미리 넣어두면 "한 번도 열지 않은
 * 페이지"와 "열어서 빈 문단만 남긴 페이지"가 구분되지 않는다.
 */
export async function createPage(
  ctx: SessionContext,
  input: CreatePageInput = {},
): Promise<PageDetail> {
  const title = assertValidTitle(input.title ?? [])

  return withTransaction(async (tx) => {
    const placement = await lockParent(tx, ctx, input.parentPageId)
    // 하위 페이지의 자리는 부모 본문의 참조 노드다(CRDT 4b · 판결 X-1). 행을 넣기 **전에** 부모 본문을 연다 —
    // 명령이 자기가 바꾼 것을 자기가 쓰는 순서다(`body-write.ts` 머리말).
    const parentBody = placement.parentType === 'block' ? await openPageBody(tx, ctx, placement.parentId) : null
    const orderKey = await nextSiblingKey(tx, placement.parentId)

    // id 는 앱이 만든다 — 정본 §3.4 가 `block.id` 에 "v4, 클라이언트 생성"이라고
    // 적은 그대로다. 루트 페이지의 `perm_scope_id` 가 자기 자신이어야 하는데,
    // INSERT 문 안에서는 생성될 id 를 참조할 수 없다. 미리 만들면 자리표시자를
    // 넣었다가 UPDATE 로 고치는 과도 상태가 사라진다.
    const id = randomUUID()

    const row = await tx.queryOne<PageRow>(
      `INSERT INTO block (
         id, workspace_id, type,
         parent_type, parent_id, order_key, ancestor_path, perm_scope_id,
         properties, format,
         created_by, created_at, last_edited_by, last_edited_at
       ) VALUES (
         $1, $2, 'page',
         $3, $4, $5, $6, $7,
         $8::jsonb, '{}'::jsonb,
         $9, now(), $9, now()
       )
       RETURNING ${PAGE_COLUMNS}`,
      [
        id,
        ctx.workspaceId,
        placement.parentType,
        placement.parentId,
        orderKey,
        placement.ancestorPath,
        placement.permScopeId ?? id,
        JSON.stringify({ title }),
        ctx.userId,
      ],
    )

    // ★ 루트 페이지는 ACL 을 갖고 태어난다 — W6-b.
    //
    // `effective()` 가 켜진 뒤로 **ACL 이 없는 노드는 아무도 못 보는 노드**다.
    // 지금까지 "워크스페이스 멤버면 다 본다"는 코드에 없는 규칙이었고(아무 검사도
    // 하지 않았다), 그것을 데이터로 옮긴 것이 이 한 행이다. 마이그레이션 0010 이
    // 기존 루트 페이지에 같은 행을 백필했다.
    //
    // 하위 페이지에는 넣지 않는다 — 부모에게서 상속받는 것이 맞고, 넣으면
    // 부모의 공유 설정을 바꿔도 자식이 안 따라온다.
    //
    // 최상위로 **옮길 때**도 같은 행이 필요해 한 함수로 모았다(`inheritFromWorkspace`, HANDOFF §3.2-21).
    if (placement.parentType === 'workspace') {
      await inheritFromWorkspace(tx, ctx, id)
    }

    // 검색 색인 — W7 (F-07-06). 행 자체는 위 INSERT 가 트리거를 돌려 이미
    // 만들어졌고(마이그레이션 0012), 여기서 쓰는 것은 제목 텍스트뿐이다.
    // 본문은 비어 있으므로 `indexPageText` 가 아니라 제목 전용 경로를 쓴다.
    await indexPageTitle(tx, id, toSummary(row).plainTitle)

    let current = row
    if (parentBody !== null) {
      parentBody.change(input.at ? placePageRefAt(id, input.at) : appendPageRef(null, id))
      const result = await parentBody.finish()
      if (!result.ok && result.reason === 'page_ref_too_deep') {
        // 자리가 본문 안 깊은 곳(토글 안)이면 부모 페이지의 깊이만 본 위 검사를 지나 투영이 거부한다.
        throw new PageError('too_deep', `페이지 깊이가 상한(${MAX_TREE_DEPTH})에 도달했습니다. 더 깊은 하위 페이지를 만들 수 없습니다.`)
      }
      if (!result.ok) throw new Error(`본문 투영이 하위 페이지 생성을 거부했다(${result.reason}): ${placement.parentId}`)
      // 투영이 자리(부모 · 순서 키 · 경로)를 문서 위치로 매긴다 — 돌려줄 것은 다시 읽는다. 토글 안이면 부모가 그 토글이다.
      current = await tx.queryOne<PageRow>(`SELECT ${PAGE_COLUMNS} FROM block WHERE id = $1`, [id])
    }

    return {
      ...toSummary(current),
      ancestors: current.ancestor_path.map(asBlockId),
      permScopeId: current.perm_scope_id,
      version: current.version,
    }
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

/**
 * 페이지 하나를 읽는다 — **볼 수 있는 페이지만.**
 *
 * `workspace_id` 술어는 워크스페이스 경계일 뿐이다. `SessionContext` 는 "이 워크스페이스에 들어올 수 있다"의 증명이지
 * "이 페이지를 볼 수 있다"의 증명이 아니다(W6-b 부터 페이지 단위 ACL 이 있다). 그래서 `view` 를 따로 묻는다.
 */
export async function getPage(ctx: SessionContext, pageId: BlockId): Promise<PageDetail | null> {
  const rows = await query<PageRow>(
    `SELECT ${PAGE_COLUMNS}
       FROM live_block
      WHERE id = $1 AND workspace_id = $2 AND type = 'page'`,
    [pageId, ctx.workspaceId],
  )
  const row = rows[0]
  if (!row) return null

  // 볼 수 없는 페이지는 **없는 페이지와 같다**(F-02-03: "접근 권한 없는 페이지는
  // 존재도 노출 금지"). 403 과 404 를 구분해 주면 id 를 찍어 존재를 알아낼 수 있다.
  if (!(await canViewPage(ctx, pageId))) return null

  return {
    ...toSummary(row),
    ancestors: row.ancestor_path.map(asBlockId),
    permScopeId: row.perm_scope_id,
    version: row.version,
  }
}

/**
 * 자식 페이지 목록 — **볼 수 있는 페이지만.**
 *
 * `parentPageId` 가 null 이면 워크스페이스 루트 페이지들.
 * 정렬은 B7 이 정한 `ORDER BY order_key, id` 다 — `order_key` 만으로 정렬하면
 * 결정적이지 않다(다른 부모의 자식을 섞어 볼 때 같은 키가 나온다).
 *
 * 권한은 사이드바 · 휴지통과 같은 규칙으로 SQL 안에서 거른다(`perm_scope_id = ANY(readableScopes)` — HANDOFF §3.3-32).
 * 부모를 볼 수 없으면 비어 있다 — 따로 공유받은 하위 페이지가 있어도 그 부모 id 로 관계를 알려주지 않는다. 없는 부모와
 * 같은 답이다.
 */
export async function listChildPages(
  ctx: SessionContext,
  parentPageId: BlockId | null,
): Promise<PageSummary[]> {
  const rows = await withReadTransaction(async (tx) => {
    if (parentPageId !== null && !can(await effectiveCaps(tx, ctx, parentPageId), 'view')) return []
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    return parentPageId
      ? tx.query<PageRow>(
          `SELECT ${PAGE_COLUMNS}
             FROM live_block
            WHERE parent_type = 'block' AND parent_id = $1
              AND workspace_id = $2 AND type = 'page'
              AND perm_scope_id = ANY($3::uuid[])
            ORDER BY order_key, id`,
          [parentPageId, ctx.workspaceId, scopes],
        )
      : tx.query<PageRow>(
          `SELECT ${PAGE_COLUMNS}
             FROM live_block
            WHERE parent_type = 'workspace' AND parent_id = $1
              AND workspace_id = $1 AND type = 'page'
              AND perm_scope_id = ANY($2::uuid[])
            ORDER BY order_key, id`,
          [ctx.workspaceId, scopes],
        )
  })

  return rows.map(toSummary)
}

/**
 * breadcrumb 용 조상 체인 — **볼 수 있는 조상만.** 루트→부모 순서 그대로 돌려준다.
 *
 * 비공개 조상 밑에서 따로 공유받은 페이지를 열면 그 조상은 빠진다 — 사이드바가 그 페이지를 가장 가까운 볼 수 있는 조상
 * 밑에 두는 것과 같다(`page-tree.ts`).
 */
export async function listAncestors(
  ctx: SessionContext,
  page: PageDetail,
): Promise<PageSummary[]> {
  if (page.ancestors.length === 0) return []

  const rows = await withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    return tx.query<PageRow>(
      `SELECT ${PAGE_COLUMNS}
         FROM live_block
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page'
          AND perm_scope_id = ANY($3::uuid[])`,
      [page.ancestors, ctx.workspaceId, scopes],
    )
  })

  // ancestor_path 의 순서가 정본이다. IN 조회 결과 순서에 의존하면 안 된다.
  const byId = new Map(rows.map((r) => [r.id, toSummary(r)]))
  return page.ancestors.map((id) => byId.get(id)).filter((p): p is PageSummary => p !== undefined)
}

// ── 제목 수정 ─────────────────────────────────────────────────────────

/**
 * 제목만 갱신한다.
 *
 * `version` 을 올린다 [X-6]. 이 컬럼은 프로젝터 배치·셀 쓰기·구조 변경이 함께
 * 올리는 페이지 단위 변경 카운터이고, 검색 인덱스의 external version 이 된다.
 * 제목 변경은 검색 결과에 직접 보이므로 여기서 올리지 않으면 인덱스가 낡는다.
 */
export async function renamePage(
  ctx: SessionContext,
  pageId: BlockId,
  title: readonly RichTextRun[],
): Promise<PageDetail> {
  const normalized = assertValidTitle(title)

  // 트랜잭션으로 감싼 이유는 검색 색인이다(F-07-06). 제목을 고치고 색인을 별도
  // 커넥션으로 쓰면 "제목은 바뀌었는데 검색은 옛 제목으로만 찾히는" 상태가
  // 남는다. 같은 트랜잭션이면 그 틈이 없다.
  return withTransaction(async (tx) => {
    const rows = await tx.query<PageRow>(
      `UPDATE block
          SET properties = jsonb_set(properties, '{title}', $3::jsonb, true),
              last_edited_by = $4,
              last_edited_at = now(),
              version = version + 1
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
          -- ★ DB 행은 제외한다 (W8-a). 행의 제목은 title 타입 프로퍼티의
          --   **셀 값**이 정본이고 block.properties.title 은 거기서 온 투영이다
          --   (database/row.ts 의 projectTitle). 여기서 덮으면 투영이 어긋나
          --   "표에는 옛 제목, 페이지 머리에는 새 제목"이 된다.
          --   행 제목은 셀을 고쳐서 바꾼다 — updateCells.
          AND parent_type <> 'data_source'
        RETURNING ${PAGE_COLUMNS}`,
      [pageId, ctx.workspaceId, JSON.stringify(normalized), ctx.userId],
    )

    const row = rows[0]
    if (!row) throw new PageError('not_found', '페이지를 찾을 수 없습니다.')

    const summary = toSummary(row)
    await indexPageTitle(tx, pageId, summary.plainTitle)

    return {
      ...summary,
      ancestors: row.ancestor_path.map(asBlockId),
      permScopeId: row.perm_scope_id,
      version: row.version,
    }
  })
}
