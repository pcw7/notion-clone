/**
 * 페이지 이동 (Move to) — F-02-08
 *
 * 정본: 00-canonical-data-model.md §3.4 (X-7 `ancestor_path`), §3.11 (perm_scope 재계산 트리거 ④)
 *       02-page-workspace.md F-02-08, 불변식 I5
 *
 * ──────────────────────────────────────────────────────────────────────
 * 도메인 문서의 SQL 을 그대로 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-02-08 의 데이터 모델 함의는 `space_id` 전파와 `position` 갱신을 적어 두었지만,
 * 정본이 그 둘을 **폐기**했다:
 *   - B8: `block.space_id` 컬럼은 존재하지 않는다. teamspace 소속은 `ancestor_path` 로 해석
 *   - B10: `position` 컬럼은 존재하지 않는다. 형제 순서는 `order_key`
 *   - X-7: 서브트리 일괄 갱신의 술어는 `ancestor_path @> ARRAY[:id]`
 * CLAUDE.md 문서 계층대로 정본이 이긴다(01~17 문서에는 폐기된 스키마가 남아 있다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이동이 건드리는 것은 정확히 넷이다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   ① 이동한 페이지의 `parent_type` · `parent_id` · `order_key`
 *   ② **서브트리 전체**의 `ancestor_path` — 앞부분을 새 경로로 갈아 끼운다 [X-7]
 *   ③ 경계를 넘는 노드의 `perm_scope_id` [§3.11 트리거 ④]
 *   ④ `version` — 구조 변경도 페이지 변경이다 [X-6]. 경로가 바뀌면 breadcrumb 과
 *      검색 문서가 바뀌므로 **자손 페이지들의 version 도** 올라야 인덱스가 낡지 않는다
 *
 * 본문 블록도 `ancestor_path` 와 `perm_scope_id` 를 갖는다. ②③의 술어가
 * `ancestor_path @> ARRAY[:id]` 이므로 본문 블록까지 한 번에 갱신된다 — 따로
 * 다루지 않는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { query } from '../db/pool.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { specOf, isKnownBlockType, MAX_TREE_DEPTH } from './types.ts'
import { nextSiblingKey } from './page.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'

export type MoveErrorCode =
  /** 옮길 페이지가 없거나 다른 워크스페이스거나 휴지통에 있다. */
  | 'not_found'
  /** 대상 부모가 없거나 다른 워크스페이스거나 자식을 가질 수 없는 타입이다. */
  | 'target_not_found'
  /** 자기 자신 또는 자기 자손으로 옮기려 했다 (I5). */
  | 'cycle'
  /** 옮기면 서브트리의 어딘가가 MAX_TREE_DEPTH 를 넘는다. */
  | 'too_deep'

export class MoveError extends Error {
  readonly code: MoveErrorCode

  constructor(code: MoveErrorCode, message: string) {
    super(message)
    this.name = 'MoveError'
    this.code = code
  }
}

export type MoveResult = {
  readonly pageId: BlockId
  /** 새 부모. 워크스페이스 루트로 갔으면 null. */
  readonly parentBlockId: BlockId | null
  readonly ancestors: readonly BlockId[]
  readonly permScopeId: string
  readonly orderKey: string
  readonly version: string
  /** 경로가 다시 쓰인 자손 블록 수(본문 블록 포함). 이동 자체는 제외. */
  readonly movedDescendants: number
  /** 아무것도 바뀌지 않았다 — 이미 그 자리에 있었다. */
  readonly noop: boolean
}

export type MovingRow = {
  id: string
  parent_type: string
  parent_id: string
  ancestor_path: string[]
  perm_scope_id: string
}

export type TargetRow = {
  id: string
  type: string
  ancestor_path: string[]
  perm_scope_id: string
}

/**
 * 대상 부모를 확정하고 잠근다.
 *
 * `null` 이면 워크스페이스 루트다. 그 외에는 **같은 워크스페이스의 살아 있는
 * 블록**이어야 한다 — 페이지가 아니어도 된다(토글 안의 하위 페이지처럼).
 * 다만 자식을 가질 수 없는 타입(heading·divider·image)은 거부한다.
 */
async function lockTarget(
  tx: Tx,
  ctx: SessionContext,
  targetId: BlockId | null,
): Promise<TargetRow | null> {
  if (targetId === null) {
    // 형제 삽입 직렬화. `page.ts` 의 lockParent 와 같은 이유다.
    await tx.query(`SELECT id FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    return null
  }

  const target = await tx.queryMaybe<TargetRow>(
    `SELECT id, type, ancestor_path, perm_scope_id
       FROM block
      WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'live'
      FOR UPDATE`,
    [targetId, ctx.workspaceId],
  )

  // 없음 / 다른 워크스페이스 / 휴지통 — 전부 같은 오류다. 구분하면 존재를 유출한다.
  if (!target) throw new MoveError('target_not_found', '옮길 위치를 찾을 수 없습니다.')

  if (isKnownBlockType(target.type) && !specOf(target.type).canHaveChildren) {
    throw new MoveError(
      'target_not_found',
      `${target.type} 은 하위 페이지를 가질 수 없습니다.`,
    )
  }

  return target
}

/**
 * 페이지를 서브트리째 옮긴다.
 *
 * @param targetParentId 새 부모 블록. `null` 이면 워크스페이스 최상위로.
 *
 * 순서는 **맨 뒤**에 붙는다. 형제 사이의 정확한 위치 지정은 드래그 앤 드롭
 * (F-01-08 / W5-b)과 함께 온다 — 노션의 "Move to" 도 맨 뒤에 붙인다.
 */
export async function movePage(
  ctx: SessionContext,
  pageId: BlockId,
  targetParentId: BlockId | null,
): Promise<MoveResult> {
  return withTransaction(async (tx) => {
    const moving = await tx.queryMaybe<MovingRow>(
      `SELECT id, parent_type, parent_id, ancestor_path, perm_scope_id
         FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!moving) throw new MoveError('not_found', '페이지를 찾을 수 없습니다.')

    // ── I5: 자기 자신 / 자손으로는 못 간다 ──────────────────────────
    //
    // 통과시키면 부모 체인이 순환한다. `ancestor_path` 는 배열이라 순환이
    // "무한 루프"가 아니라 **조용히 잘못된 경로**로 나타난다 — 그 서브트리가
    // 트리에서 통째로 사라진 것처럼 보이고, 권한 스코프도 함께 틀어진다.
    if (targetParentId === pageId) {
      throw new MoveError('cycle', '페이지를 자기 자신 안으로 옮길 수 없습니다.')
    }

    const target = await lockTarget(tx, ctx, targetParentId)

    if (target !== null && target.ancestor_path.includes(moving.id)) {
      throw new MoveError('cycle', '페이지를 자기 하위 페이지 안으로 옮길 수 없습니다.')
    }

    // ── 이미 그 자리인가 ────────────────────────────────────────────
    const alreadyThere =
      target === null
        ? moving.parent_type === 'workspace'
        : moving.parent_type === 'block' && moving.parent_id === target.id
    if (alreadyThere) {
      return {
        pageId: asBlockId(moving.id),
        parentBlockId: target === null ? null : asBlockId(target.id),
        ancestors: moving.ancestor_path.map(asBlockId),
        permScopeId: moving.perm_scope_id,
        orderKey: '',
        version: '',
        movedDescendants: 0,
        noop: true,
      } satisfies MoveResult
    }

    const placed = await relocateSubtree(tx, ctx, moving, target)

    return {
      pageId: asBlockId(moving.id),
      parentBlockId: target === null ? null : asBlockId(target.id),
      ancestors: placed.ancestors.map(asBlockId),
      permScopeId: placed.permScopeId,
      orderKey: placed.orderKey,
      version: placed.version,
      movedDescendants: placed.movedDescendants,
      noop: false,
    } satisfies MoveResult
  })
}

export type RelocateResult = {
  readonly ancestors: readonly string[]
  readonly permScopeId: string
  readonly orderKey: string
  readonly version: string
  readonly movedDescendants: number
}

/**
 * 서브트리를 새 자리에 앉힌다 — **쓰기 부분만.**
 *
 * `movePage`(이동)와 `restorePage`(부모가 사라진 페이지를 되살릴 때)가 정확히
 * 같은 일을 해야 해서 뽑았다. 두 곳에 복사해 두면 한쪽만 고쳐지고, 그러면
 * `ancestor_path` 나 `perm_scope_id` 가 어긋난 채 **조용히** 굴러간다.
 *
 * 호출자가 `moving` 행을 이미 잠갔다고 가정한다. 사이클 검사는 호출자의 몫이지만
 * (복원 경로에는 사이클이 있을 수 없다) **깊이 검사는 여기서 한다** — 호출자에게
 * 맡기면 새 호출자가 빠뜨린다.
 */
export async function relocateSubtree(
  tx: Tx,
  ctx: SessionContext,
  moving: MovingRow,
  target: TargetRow | null,
  /**
   * 새 형제 그룹에서 쓸 `order_key`. 생략하면 **맨 뒤**에 붙인다.
   *
   * 프로젝터(`save-page-body.ts`)는 문서 위치가 순서를 정하므로 자기가 계산한
   * 키를 넘긴다. 맨 뒤에 붙여 놓고 나중에 고치면 그 사이에 키가 두 번 쓰이고,
   * 지연 불가 UNIQUE 인덱스에서 중간 상태 충돌이 난다.
   */
  explicitOrderKey?: string,
): Promise<RelocateResult> {
  {
    // 최상위로 가는 경우 형제 삽입을 직렬화한다. `movePage` 는 `lockTarget` 에서
    // 이미 잡았지만 같은 트랜잭션 안이라 재진입이 무해하고, `restorePage` 처럼
    // `lockTarget` 을 거치지 않는 호출자도 안전해진다.
    if (target === null) {
      await tx.query(`SELECT id FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    }

    const oldPath = moving.ancestor_path
    const newPath = target === null ? [] : [...target.ancestor_path, target.id]

    // ── 깊이 ────────────────────────────────────────────────────────
    //
    // 페이지 하나가 아니라 **서브트리에서 가장 깊은 노드**로 판정해야 한다.
    // 페이지만 보고 통과시키면 자손이 상한을 넘은 채 저장된다.
    const deepest = await tx.queryOne<{ max_depth: number | null }>(
      `SELECT max(coalesce(array_length(ancestor_path, 1), 0)) AS max_depth
         FROM block
        WHERE ancestor_path @> ARRAY[$1::uuid] AND workspace_id = $2`,
      [moving.id, ctx.workspaceId],
    )
    const deepestRelative = (deepest.max_depth ?? oldPath.length) - oldPath.length
    const newDeepest = newPath.length + deepestRelative
    if (newDeepest >= MAX_TREE_DEPTH) {
      throw new MoveError(
        'too_deep',
        `옮기면 깊이가 상한(${MAX_TREE_DEPTH})을 넘습니다. 더 얕은 위치를 고르세요.`,
      )
    }

    // ── perm_scope_id ───────────────────────────────────────────────
    //
    // 정본 §3.11: 스코프는 "자신 또는 가장 가까운 경계 조상"이다. 지금은
    // `acl_entry` · `public_link` 가 없으므로 **경계는 워크스페이스 최상위뿐**이다.
    // W6 에서 경계가 늘어나면 이 두 줄만 바뀐다.
    const oldScope = moving.perm_scope_id
    const newScope = target === null ? moving.id : target.perm_scope_id

    const orderKey =
      explicitOrderKey ??
      (await nextSiblingKey(tx, target === null ? ctx.workspaceId : target.id))

    // ── ① 이동한 페이지 ────────────────────────────────────────────
    const updated = await tx.queryOne<{ order_key: string; version: string }>(
      `UPDATE block
          SET parent_type = $3, parent_id = $4, order_key = $5,
              ancestor_path = $6::uuid[], perm_scope_id = $7,
              last_edited_by = $8, last_edited_at = now(), version = version + 1
        WHERE id = $1 AND workspace_id = $2
        RETURNING order_key, version`,
      [
        moving.id,
        ctx.workspaceId,
        target === null ? 'workspace' : 'block',
        target === null ? ctx.workspaceId : target.id,
        orderKey,
        newPath,
        newScope,
        ctx.userId,
      ],
    )

    // ── ② 서브트리 경로 갈아 끼우기 [X-7] ──────────────────────────
    //
    // 자손 D 의 경로는 `oldPath ++ [pageId] ++ (pageId 아래 구간)` 이다.
    // 앞의 `oldPath.length + 1` 개를 `newPath ++ [pageId]` 로 바꾸면 된다.
    // Postgres 배열은 1-based 라 남길 구간의 시작은 `oldPath.length + 2`.
    //
    // ③ perm_scope 는 **경계를 넘던 노드만** 고친다. 서브트리 안에 자기
    //    스코프 경계가 있는 노드는 그대로 둬야 한다(W6 에서 실제로 생긴다).
    // ④ version 은 `type='page'` 인 자손만 올린다 — 경로가 바뀌면 breadcrumb 과
    //    검색 문서가 달라지므로 인덱서가 다시 읽어야 한다.
    const descendants = await tx.query<{ id: string }>(
      `UPDATE block
          SET ancestor_path = $3::uuid[] || ancestor_path[$4:],
              perm_scope_id = CASE WHEN perm_scope_id = $5 THEN $6 ELSE perm_scope_id END,
              version = CASE WHEN type = 'page' THEN version + 1 ELSE version END
        WHERE ancestor_path @> ARRAY[$1::uuid] AND workspace_id = $2
        RETURNING id`,
      [moving.id, ctx.workspaceId, [...newPath, moving.id], oldPath.length + 2, oldScope, newScope],
    )

    return {
      ancestors: newPath,
      permScopeId: newScope,
      orderKey: updated.order_key,
      version: updated.version,
      movedDescendants: descendants.length,
    } satisfies RelocateResult
  }
}

// ── 이동 대상 목록 ────────────────────────────────────────────────────

export type MoveTarget = {
  readonly id: BlockId
  readonly title: string
  /** 루트→부모 순서의 조상 id. 화면에서 경로를 그릴 때 쓴다. */
  readonly ancestors: readonly BlockId[]
}

/**
 * 이 페이지를 옮길 수 있는 대상들.
 *
 * F-02-08 엣지 케이스: *"자기 자신/자손으로 이동 → 차단(I5).
 * **대상 선택 목록에서 자손 제외**."* 목록을 서버에서 거르는 이유는 두 가지다.
 *   - 화면이 고를 수 없는 선택지를 보여주지 않는다
 *   - 거르는 규칙이 `movePage` 의 거부 규칙과 **같은 곳에서** 나온다.
 *     클라이언트가 따로 거르면 두 규칙이 언젠가 어긋난다
 *
 * 자손을 제외하면 남은 후보들의 **조상도 모두 후보 안에 있다** — 후보 C 의
 * 조상 A 가 옮길 페이지의 자손이라면 C 도 자손이어야 하므로. 그래서 화면이
 * 이 목록만으로 경로 라벨을 만들 수 있다.
 */
export async function listMovableTargets(
  ctx: SessionContext,
  pageId: BlockId,
): Promise<MoveTarget[]> {
  const rows = await query<{
    id: string
    properties: { title?: unknown } | null
    ancestor_path: string[]
  }>(
    `SELECT id, properties, ancestor_path
       FROM live_block
      WHERE workspace_id = $1 AND type = 'page'
        AND id <> $2
        AND NOT (ancestor_path @> ARRAY[$2::uuid])
      ORDER BY array_length(ancestor_path, 1) NULLS FIRST, order_key, id`,
    [ctx.workspaceId, pageId],
  )

  return rows.map((row) => {
    const raw = row.properties?.title
    // 읽기는 관대하게 — 제목 하나가 망가졌다고 이동 자체를 막지 않는다.
    const title = Array.isArray(raw) ? toPlainText(raw as RichTextRun[]) : ''
    return { id: asBlockId(row.id), title, ancestors: row.ancestor_path.map(asBlockId) }
  })
}
