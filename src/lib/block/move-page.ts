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
 *   ③ `perm_scope_id` [§3.11 트리거 ④] — 옮긴 페이지가 **경계(자기 ACL · 상속 끊기)면 그대로**, 아니면 그것과 옛 스코프를 따르던
 *      자손이 새 부모의 스코프를 받는다. 최상위로 오면 먼저 상속 원천을 ACL 행으로 둔다(아래 "최상위")
 *   ④ `version` — 구조 변경도 페이지 변경이다 [X-6]. 경로가 바뀌면 breadcrumb 과
 *      검색 문서가 바뀌므로 **자손 페이지들의 version 도** 올라야 인덱스가 낡지 않는다
 *
 * 본문 블록도 `ancestor_path` 와 `perm_scope_id` 를 갖는다. ②③의 술어가
 * `ancestor_path @> ARRAY[:id]` 이므로 본문 블록까지 한 번에 갱신된다 — 따로
 * 다루지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한 — 옮길 페이지는 바꿀 수 있어야, 옮길 곳은 하위 페이지를 둘 수 있어야 (HANDOFF §3.2-18)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 06 F-06-20: *"이동자가 대상 위치에 대한 권한이 없음 → 이동 거부. 원본 권한 + 대상 부모의 create 권한 둘 다 필요."*
 *
 *   - 옮길 페이지: `edit_content` — 휴지통과 같은 규칙. 볼 수 없으면 `not_found`, 볼 수만 있으면 `forbidden`
 *   - 옮길 곳: `create_child` — 하위 페이지 생성(`createPage`)과 같은 capability 이고 같은 매핑이다. 볼 수 없는 곳도, 볼 수만
 *     있는 곳도 `target_not_found`. 최상위로 옮기는 것은 막지 않는다(최상위 페이지 생성도 막지 않는다)
 *   - 이동 대상 목록은 같은 규칙으로 거른다 — 화면이 서버가 거부할 곳을 보여주지 않는다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 최상위 — 상속 원천이 부모 페이지가 아니다 (HANDOFF §3.2-21)
 * ──────────────────────────────────────────────────────────────────────
 *
 * ACL 이 없는 노드는 아무도 못 본다(`effective()` 는 허용의 합집합뿐이다). 페이지 밑에서는 부모에게서 상속하지만 최상위에는 부모
 * 페이지가 없다 — 그래서 최상위로 올 때 상속 원천을 행으로 둔다.
 *
 *   - 옮기기: 워크스페이스에서 상속한다(`inheritFromWorkspace` — 최상위에 만들 때와 같은 행). 06 F-06-20 "이동 즉시 새 부모의
 *     권한이 상속된다". 상속을 끊은 페이지는 받지 않는다
 *   - 부모가 사라져 되살리기(B4): 되살린 사람만(`grantToRestorer`) — 정본 "복원 실행자의 Private 루트"
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { grantToRestorer, inheritFromWorkspace, isScopeBoundary } from '../permissions/acl.ts'
import { effectiveCaps, readableScopes, scopesWith } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { specOf, isKnownBlockType, MAX_TREE_DEPTH } from './types.ts'
import { nextSiblingKey } from './page.ts'
import { finishOrThrow, openPageBody, ownerPageOf, type PageBodyWrite } from './body-write.ts'
import { appendPageRef, removePageRef } from './page-refs.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'

export type MoveErrorCode =
  /** 옮길 페이지가 없거나 다른 워크스페이스거나 휴지통에 있거나 볼 수 없다. */
  | 'not_found'
  /** 옮길 페이지를 볼 수는 있지만 바꿀 수 없다(`edit_content` 없음). */
  | 'forbidden'
  /** 대상 부모가 없거나 다른 워크스페이스거나 자식을 가질 수 없는 타입이거나, 거기에 하위 페이지를 둘 수 없다. */
  | 'target_not_found'
  /** 자기 자신 또는 자기 자손으로 옮기려 했다 (I5). */
  | 'cycle'
  /** 옮기면 서브트리가 더 깊어져 어딘가가 MAX_TREE_DEPTH 를 넘는다. */
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

  // 거기에 하위 페이지를 둘 수 있어야 한다(머리말 "권한"). 타입을 알려주는 아래 거부보다 먼저 본다 — 볼 수 없는 블록의
  // 타입을 알려주지 않는다.
  if (!can(await effectiveCaps(tx, ctx, target.id), 'create_child')) {
    throw new MoveError('target_not_found', '옮길 위치를 찾을 수 없습니다.')
  }

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
    const peek = await tx.queryMaybe<{ parent_type: string; parent_id: string; properties: { title?: unknown } | null }>(
      `SELECT parent_type, parent_id, properties FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (!peek) throw new MoveError('not_found', '페이지를 찾을 수 없습니다.')

    // ── I5: 자기 자신 / 자손으로는 못 간다 ──────────────────────────
    //
    // 통과시키면 부모 체인이 순환한다. `ancestor_path` 는 배열이라 순환이
    // "무한 루프"가 아니라 **조용히 잘못된 경로**로 나타난다 — 그 서브트리가
    // 트리에서 통째로 사라진 것처럼 보이고, 권한 스코프도 함께 틀어진다.
    if (targetParentId === pageId) {
      throw new MoveError('cycle', '페이지를 자기 자신 안으로 옮길 수 없습니다.')
    }

    // ── 두 본문 (CRDT 4b · 판결 X-1) ────────────────────────────────
    //
    // 페이지의 자리는 부모 본문의 참조 노드다. 옮기면 옛 자리의 본문에서 빼고 새 자리의 본문에 넣는다. 대상이 어느
    // 페이지 본문에도 속하지 않으면(워크스페이스 직속 데이터베이스 같은 것) 참조를 둘 곳이 없다 — 옮길 위치가 아니다.
    // 두 본문 페이지를 옮길 행 · 대상보다 먼저, id 순으로 잡는다(잠금 순서: 본문 페이지 행 → 옮길 행 · 대상 → 스냅샷).
    const oldOwner = peek.parent_type === 'block' ? await ownerPageOf(tx, ctx, peek.parent_id) : null
    const newOwner = targetParentId === null ? null : await ownerPageOf(tx, ctx, targetParentId)
    if (targetParentId !== null && newOwner === null) {
      throw new MoveError('target_not_found', '옮길 위치를 찾을 수 없습니다.')
    }
    const owners = [...new Set([oldOwner, newOwner].filter((id): id is string => id !== null))].sort()
    for (const owner of owners) await tx.query(`SELECT id FROM block WHERE id = $1 FOR UPDATE`, [owner])

    const moving = await tx.queryMaybe<MovingRow>(
      `SELECT id, parent_type, parent_id, ancestor_path, perm_scope_id
         FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!moving) throw new MoveError('not_found', '페이지를 찾을 수 없습니다.')
    if (moving.parent_id !== peek.parent_id) throw new Error(`옮기는 사이 페이지의 자리가 바뀌었다: ${pageId}`)

    // 옮길 페이지를 바꿀 수 있어야 한다(머리말 "권한"). 볼 수 없으면 없는 것과 같다 — 이미 그 자리인지도 알려주지 않는다.
    const caps = await effectiveCaps(tx, ctx, moving.id)
    if (!can(caps, 'view')) throw new MoveError('not_found', '페이지를 찾을 수 없습니다.')
    if (!can(caps, 'edit_content')) throw new MoveError('forbidden', '이 페이지를 옮길 권한이 없습니다.')

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

    // 본문을 행을 쓰기 전에 연다(`body-write.ts` 머리말).
    const bodies = new Map<string, PageBodyWrite>()
    for (const owner of owners) bodies.set(owner, await openPageBody(tx, ctx, owner))

    const placed = await relocateSubtree(tx, ctx, moving, target)

    if (oldOwner !== null) bodies.get(oldOwner)?.change(removePageRef(moving.id))
    if (newOwner !== null && target !== null) {
      // 대상이 그 본문을 가진 페이지 자신이면 본문 최상위, 본문 안의 블록이면 그 블록의 자식 끝이다.
      const parentBlockId = target.id === newOwner ? null : target.id
      bodies.get(newOwner)?.change(appendPageRef(parentBlockId, moving.id))
    }
    for (const owner of owners) {
      const body = bodies.get(owner)
      if (body !== undefined) await finishOrThrow(body)
    }

    // 투영이 순서 키를 본문 위치로 다시 매겼을 수 있다 — 돌려줄 키 · 버전은 다시 읽는다.
    const final = await tx.queryOne<{ order_key: string; version: string }>(
      `SELECT order_key, version FROM block WHERE id = $1`,
      [moving.id],
    )

    return {
      pageId: asBlockId(moving.id),
      parentBlockId: target === null ? null : asBlockId(target.id),
      ancestors: placed.ancestors.map(asBlockId),
      permScopeId: placed.permScopeId,
      orderKey: final.order_key,
      version: final.version,
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

export type RelocateOptions = {
  /**
   * 새 형제 그룹에서 쓸 `order_key`. 생략하면 **맨 뒤**에 붙인다.
   *
   * 프로젝터(`save-page-body.ts`)는 문서 위치가 순서를 정하므로 자기가 계산한
   * 키를 넘긴다. 맨 뒤에 붙여 놓고 나중에 고치면 그 사이에 키가 두 번 쓰이고,
   * 지연 불가 UNIQUE 인덱스에서 중간 상태 충돌이 난다.
   */
  readonly orderKey?: string
  /**
   * 최상위로 갈 때 누가 보는가(머리말 "최상위"). 기본은 옮기기 — 워크스페이스에서 상속한다. 부모가 사라져 되살리는
   * `restorePage` 만 `'restorer_only'` 를 넘긴다.
   */
  readonly atTopLevel?: 'inherit_workspace' | 'restorer_only'
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
  options: RelocateOptions = {},
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
    //
    // **더 깊어지지 않는 이동은 거부하지 않는다.** 본문은 페이지에서 센 깊이만 막으므로(`validateDoc` · 정규화) 상한을 이미
    // 넘은 서브트리가 생긴다 — 깊이 1 인 페이지의 본문이 경로 길이 101 까지 간다(검사 · 진단). 그런 페이지를 같은 깊이 ·
    // 더 얕은 곳으로도 못 옮기면 되돌릴 길이 없다. 참여자 경로가 참조를 올릴 때 끝이 있는 것도 이 규칙이다(`pageRefDepthLimits`).
    const deepest = await tx.queryOne<{ max_depth: number | null }>(
      `SELECT max(coalesce(array_length(ancestor_path, 1), 0)) AS max_depth
         FROM block
        WHERE ancestor_path @> ARRAY[$1::uuid] AND workspace_id = $2`,
      [moving.id, ctx.workspaceId],
    )
    const deepestRelative = (deepest.max_depth ?? oldPath.length) - oldPath.length
    const newDeepest = newPath.length + deepestRelative
    if (newDeepest >= MAX_TREE_DEPTH && newPath.length > oldPath.length) {
      throw new MoveError(
        'too_deep',
        `옮기면 깊이가 상한(${MAX_TREE_DEPTH})을 넘습니다. 더 얕은 위치를 고르세요.`,
      )
    }

    // ── perm_scope_id ───────────────────────────────────────────────
    //
    // 정본 §3.11: 스코프는 "자신 또는 가장 가까운 조상 중 ACL 을 갖거나 상속을 끊은 노드"다. 그래서 옮긴 페이지가 **경계면 자기
    // 스코프를 지키고**, 경계가 아닐 때만 새 부모의 스코프를 받는다. 자손은 옮긴 페이지의 옛 스코프를 따르던 것만 따라간다(아래 ③).
    //
    // 한때 여기는 "지금은 acl_entry 가 없으므로 경계는 워크스페이스 최상위뿐"(W5-a)이라며 늘 대상의 스코프를 썼고 W6-b 뒤에도 그대로
    // 남았다. 상속을 끊은 비공개 페이지를 공개 페이지 밑으로 옮기면 목록 · 사이드바 · 검색이 그 제목을 내줬다(HANDOFF §3.2-21).
    //
    // 최상위로 오면 먼저 상속 원천을 행으로 둔다(머리말 "최상위") — 그 뒤로는 늘 경계다.
    if (target === null) {
      if (options.atTopLevel === 'restorer_only') await grantToRestorer(tx, ctx, moving.id)
      else await inheritFromWorkspace(tx, ctx, moving.id)
    }
    const oldScope = moving.perm_scope_id
    const newScope = target === null || (await isScopeBoundary(tx, moving.id)) ? moving.id : target.perm_scope_id

    const orderKey =
      options.orderKey ??
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
    // ③ perm_scope 는 **옮긴 페이지의 옛 스코프를 따르던 노드만** 고친다. 서브트리 안에
    //    자기 스코프 경계가 있는 노드는 그대로다. 옮긴 페이지가 경계였으면 옛 스코프 = 새
    //    스코프 = 자기라 아무것도 바뀌지 않는다.
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
  /**
   * 루트→부모 순서의 조상 페이지 제목 — **볼 수 있는 조상만.** 화면이 경로 라벨을 그린다. 볼 수 없는 조상은 제목도
   * id 도 싣지 않는다(F-02-03 "존재도 노출 금지").
   */
  readonly path: readonly string[]
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
 * 권한도 같다 — 하위 페이지를 둘 수 있는 곳(`create_child`)만 담는다(머리말 "권한"). 노드마다 판정하지 않고 스코프로
 * 거른다(`scopesWith` — 같은 스코프의 노드는 정의상 권한이 같다). 그래서 **후보의 조상이 후보 안에 있다는 보장은 없다**
 * — 볼 수만 있는 조상 · 볼 수 없는 조상이 빠진다. 경로 라벨은 볼 수 있는 조상 페이지의 제목으로 서버가 만든다.
 */
export async function listMovableTargets(
  ctx: SessionContext,
  pageId: BlockId,
): Promise<MoveTarget[]> {
  return withReadTransaction(async (tx) => {
    const creatable = await scopesWith(tx, ctx, ['view', 'create_child'])
    if (creatable.length === 0) return []

    const rows = await tx.query<{ id: string; properties: { title?: unknown } | null; ancestor_path: string[] }>(
      `SELECT id, properties, ancestor_path
         FROM live_block
        WHERE workspace_id = $1 AND type = 'page'
          AND id <> $2
          AND NOT (ancestor_path @> ARRAY[$2::uuid])
          AND perm_scope_id = ANY($3::uuid[])
        ORDER BY array_length(ancestor_path, 1) NULLS FIRST, order_key, id`,
      [ctx.workspaceId, pageId, creatable],
    )

    // 경로 라벨 — 조상 중 볼 수 있는 페이지의 제목만 읽는다. 본문 블록(토글 같은) 조상은 라벨에 넣지 않는다.
    const ancestorIds = [...new Set(rows.flatMap((row) => row.ancestor_path))]
    const readable = ancestorIds.length === 0 ? [] : await readableScopes(tx, ctx)
    const ancestors =
      readable.length === 0
        ? []
        : await tx.query<{ id: string; properties: { title?: unknown } | null }>(
            `SELECT id, properties FROM live_block
              WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page'
                AND perm_scope_id = ANY($3::uuid[])`,
            [ancestorIds, ctx.workspaceId, readable],
          )
    const titleOf = new Map(ancestors.map((a) => [a.id, titleText(a.properties)]))

    return rows.map((row) => ({
      id: asBlockId(row.id),
      title: titleText(row.properties),
      path: row.ancestor_path.flatMap((id) => {
        const title = titleOf.get(id)
        return title === undefined ? [] : [title]
      }),
    }))
  })
}

/** 읽기는 관대하게 — 제목 하나가 망가졌다고 이동 자체를 막지 않는다. */
function titleText(properties: { title?: unknown } | null): string {
  const raw = properties?.title
  return Array.isArray(raw) ? toPlainText(raw as RichTextRun[]) : ''
}
