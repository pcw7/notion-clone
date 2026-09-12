/**
 * 휴지통 — 삭제 · 조회 · 복원 · 영구 삭제 (F-11-05 / F-02-11)
 *
 * 정본: 00-canonical-data-model.md §3.4 상태 전이표, 불변식 B2·B3·B4·B5, 판결 X-3
 *
 * ──────────────────────────────────────────────────────────────────────
 * 3상태 + 물리 삭제
 * ──────────────────────────────────────────────────────────────────────
 *
 *   live → trashed → purged → (물리 삭제)
 *
 * F-02-11 이 정정한 대로 보존은 **2단계**다. 휴지통(기본 30일) 다음이 곧
 * 소멸이 아니라, "영구 삭제됨"(UI 에서 안 보이지만 소유자·지원 경로로 복구
 * 가능) 상태가 한 번 더 있다. 그래서 `purge_after`(휴지통 만료)와
 * `purged_at`(영구 삭제 시각)을 **따로** 저장한다 — 하나로 합치면 ②단계를
 * 표현할 수 없고, 첨부 스토리지를 언제 GC 해도 되는지도 알 수 없게 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 전파는 `type='page'` 에만 (B5 / X-3)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `ck_lifecycle_page` CHECK 이 **비페이지 블록은 'live' 외의 값을 못 갖게**
 * 막는다. 본문 블록은 소속 페이지의 문서 안에 있으므로 페이지가 휴지통에 가면
 * 함께 안 보이면 된다 — 행을 건드릴 이유가 없다. 실제로 건드리려 하면 DB 가
 * 거부한다(테스트로 확인한다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 복원은 **삭제 루트 단위**로만
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-11-05: *"삭제 루트만 목록에 노출하고 복원도 루트 단위로 한다. 트리 중간
 * 노드만 개별 복원하는 경로는 제공하지 않는 편이 단순하고 안전하다."*
 * 정본 B3 의 "복원 범위 = 대상 + `trash_root_id` 가 대상 id 인 자손"과 정확히
 * 맞물린다. 중간 노드 복원을 허용하면 "부모는 휴지통인데 자식만 살아 있는"
 * 상태를 만들 방법이 생기고, 그건 트리에서 보이지 않는 고아가 된다.
 *
 * 그래서 `restorePage` 는 **`trash_root_id = 자기 id`** 인 페이지만 받는다.
 * 아니면 어느 묶음에 속하는지(`trashRootId`)를 알려주고 거부한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * B2 — 삭제해도 위치를 건드리지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `parent_id` · `order_key` 를 그대로 둔다. 그래서 복원이 공짜다 —
 * `lifecycle` 만 되돌리면 원래 자리에 다시 나타난다. 정본이 `trash_entry`
 * 테이블을 **존재하지 않는다**고 못박은 이유이기도 하다.
 * (`save-page-body.ts` 의 키 할당이 휴지통 형제의 `order_key` 를 비켜 가는 것도
 * 같은 규칙의 뒷면이다.)
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { relocateSubtree, type MovingRow } from './move-page.ts'

export type TrashErrorCode =
  /** 페이지가 없거나 다른 워크스페이스거나 상태가 맞지 않는다. */
  | 'not_found'
  /** 삭제 루트가 아니다 — 복원/영구삭제는 루트 단위로만 한다. */
  | 'not_a_trash_root'

export class TrashError extends Error {
  readonly code: TrashErrorCode
  /** `not_a_trash_root` 일 때 이 페이지가 속한 삭제 묶음의 루트. */
  readonly trashRootId: BlockId | null

  constructor(code: TrashErrorCode, message: string, trashRootId: BlockId | null = null) {
    super(message)
    this.name = 'TrashError'
    this.code = code
    this.trashRootId = trashRootId
  }
}

// ── 삭제 ──────────────────────────────────────────────────────────────

export type TrashResult = {
  readonly pageId: BlockId
  /** 함께 휴지통에 들어간 자손 페이지 수. */
  readonly trashedDescendants: number
  /** 이 시각이 지나면 GC 가 purged 로 옮긴다. */
  readonly purgeAfter: Date
}

/**
 * 페이지를 휴지통으로 (live → trashed).
 *
 * 자손 페이지 전체에 전파하되, **이미 따로 버려져 있던 자손은 건드리지 않는다**
 * (B3: "먼저 독립적으로 버려진 자손은 `trashed` 유지"). `lifecycle = 'live'`
 * 조건이 그 역할을 한다 — 건드리면 그 자손의 `trash_root_id` 가 덮여서 원래
 * 묶음으로 복원할 수 없게 된다.
 */
export async function trashPage(ctx: SessionContext, pageId: BlockId): Promise<TrashResult> {
  return withTransaction(async (tx) => {
    const target = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!target) throw new TrashError('not_found', '페이지를 찾을 수 없습니다.')

    // 보존 기간은 워크스페이스 설정이다(§3.1 `workspace.trash_days`, 1~3650).
    const ws = await tx.queryOne<{ trash_days: number }>(
      `SELECT trash_days FROM workspace WHERE id = $1`,
      [ctx.workspaceId],
    )

    const moved = await tx.queryOne<{ purge_after: Date }>(
      `UPDATE block
          SET lifecycle = 'trashed',
              trashed_at = now(), trashed_by = $3, trash_root_id = id,
              purge_after = now() + ($4 || ' days')::interval,
              last_edited_by = $3, last_edited_at = now(), version = version + 1
        WHERE id = $1 AND workspace_id = $2
        RETURNING purge_after`,
      [target.id, ctx.workspaceId, ctx.userId, String(ws.trash_days)],
    )

    // B5 / X-3: 전파는 페이지에만. 비페이지 블록은 CHECK 이 막는다.
    const descendants = await tx.query<{ id: string }>(
      `UPDATE block
          SET lifecycle = 'trashed',
              trashed_at = now(), trashed_by = $3, trash_root_id = $1,
              purge_after = now() + ($4 || ' days')::interval,
              version = version + 1
        WHERE ancestor_path @> ARRAY[$1::uuid] AND workspace_id = $2
          AND type = 'page' AND lifecycle = 'live'
        RETURNING id`,
      [target.id, ctx.workspaceId, ctx.userId, String(ws.trash_days)],
    )

    return {
      pageId: asBlockId(target.id),
      trashedDescendants: descendants.length,
      purgeAfter: moved.purge_after,
    }
  })
}

// ── 복원 ──────────────────────────────────────────────────────────────

export type RestoreResult = {
  readonly pageId: BlockId
  readonly restoredDescendants: number
  /**
   * 원래 부모가 사라져 최상위로 올려놓았는가 (B4).
   * 화면은 이때 "원래 위치가 사라져 최상위로 복원했습니다"를 알려야 한다.
   */
  readonly reparented: boolean
}

/**
 * 휴지통에서 되살린다 (trashed → live).
 *
 * @throws TrashError('not_a_trash_root') 삭제 루트가 아닌 페이지를 지정하면.
 */
export async function restorePage(ctx: SessionContext, pageId: BlockId): Promise<RestoreResult> {
  return withTransaction(async (tx) => {
    const target = await tx.queryMaybe<MovingRow & { trash_root_id: string | null }>(
      `SELECT id, parent_type, parent_id, ancestor_path, perm_scope_id, trash_root_id
         FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'trashed'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!target) throw new TrashError('not_found', '휴지통에서 페이지를 찾을 수 없습니다.')

    if (target.trash_root_id !== target.id) {
      throw new TrashError(
        'not_a_trash_root',
        '이 페이지는 상위 페이지와 함께 삭제됐습니다. 그 상위 페이지를 복원하세요.',
        target.trash_root_id === null ? null : asBlockId(target.trash_root_id),
      )
    }

    // ── 부모가 아직 살아 있는가 (B4) ────────────────────────────────
    //
    // 부모가 purged 면 원위치가 없다. 정본 B4 는 "복원 실행자의 Private 루트로
    // 재부모화"라고 하지만 **MVP 에는 Private 루트가 없다**(teamspace·개인 영역이
    // W6 이후다). 그래서 워크스페이스 최상위로 올린다 — 사라지게 두는 것보다
    // 낫고, 사용자에게 `reparented` 로 알린다.
    //
    // 부모가 **trashed** 인 경우는 여기 오지 않는다: 그랬다면 이 페이지의
    // `trash_root_id` 가 자기 자신이 아니라 그 부모였을 것이고 위에서 걸린다.
    let reparented = false
    if (target.parent_type === 'block') {
      const parent = await tx.queryMaybe<{ id: string }>(
        `SELECT id FROM block
          WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'live'`,
        [target.parent_id, ctx.workspaceId],
      )
      reparented = parent === null
    }

    // ── B3: 대상 + trash_root_id 가 대상인 자손만 ───────────────────
    //
    // 먼저 독립적으로 버려졌던 자손은 자기 `trash_root_id` 를 갖고 있으므로
    // 여기 걸리지 않는다 — 휴지통에 그대로 남는다. 그게 정본이 정한 동작이다.
    const restored = await tx.query<{ id: string }>(
      `UPDATE block
          SET lifecycle = 'live',
              trashed_at = NULL, trashed_by = NULL, trash_root_id = NULL, purge_after = NULL,
              version = version + 1
        WHERE workspace_id = $2 AND lifecycle = 'trashed'
          AND trash_root_id = $1 AND id <> $1
        RETURNING id`,
      [target.id, ctx.workspaceId],
    )

    await tx.query(
      `UPDATE block
          SET lifecycle = 'live',
              trashed_at = NULL, trashed_by = NULL, trash_root_id = NULL, purge_after = NULL,
              last_edited_by = $3, last_edited_at = now(), version = version + 1
        WHERE id = $1 AND workspace_id = $2`,
      [target.id, ctx.workspaceId, ctx.userId],
    )

    // 원위치가 사라졌으면 최상위로. 경로·권한 스코프 갱신은 이동과 **같은 코드**를
    // 쓴다 — 여기서 따로 쓰면 언젠가 이동 쪽과 어긋난다.
    if (reparented) {
      await relocateSubtree(tx, ctx, target, null)
    }

    return {
      pageId: asBlockId(target.id),
      restoredDescendants: restored.length,
      reparented,
    }
  })
}

// ── 영구 삭제 ─────────────────────────────────────────────────────────

export type PurgeResult = {
  readonly pageId: BlockId
  readonly purgedDescendants: number
}

/**
 * 영구 삭제 (trashed → purged).
 *
 * **행을 지우지 않는다.** F-02-11 이 정정한 ②단계다 — UI 에서는 사라지지만
 * 일정 기간 소유자·지원 경로로 복구할 수 있어야 하고, 그동안 첨부 스토리지도
 * GC 하면 안 된다. 물리 삭제는 `purged_at` 이후 별도 GC 의 몫이다(Phase 1).
 */
export async function purgePage(ctx: SessionContext, pageId: BlockId): Promise<PurgeResult> {
  return withTransaction(async (tx) => {
    const target = await tx.queryMaybe<{ id: string; trash_root_id: string | null }>(
      `SELECT id, trash_root_id FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'trashed'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!target) throw new TrashError('not_found', '휴지통에서 페이지를 찾을 수 없습니다.')

    if (target.trash_root_id !== target.id) {
      throw new TrashError(
        'not_a_trash_root',
        '이 페이지는 상위 페이지와 함께 삭제됐습니다. 그 상위 페이지를 영구 삭제하세요.',
        target.trash_root_id === null ? null : asBlockId(target.trash_root_id),
      )
    }

    const descendants = await tx.query<{ id: string }>(
      `UPDATE block
          SET lifecycle = 'purged', purged_at = now()
        WHERE workspace_id = $2 AND lifecycle = 'trashed'
          AND trash_root_id = $1 AND id <> $1
        RETURNING id`,
      [target.id, ctx.workspaceId],
    )

    await tx.query(
      `UPDATE block SET lifecycle = 'purged', purged_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [target.id, ctx.workspaceId],
    )

    return { pageId: asBlockId(target.id), purgedDescendants: descendants.length }
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

export type TrashEntry = {
  readonly id: BlockId
  readonly title: string
  readonly trashedAt: Date
  readonly purgeAfter: Date | null
  /** 함께 들어간 하위 페이지 수. "하위 3개 포함"을 보여주기 위한 값. */
  readonly descendantCount: number
}

/**
 * 휴지통 목록 — **삭제 루트만**.
 *
 * F-11-05: *"휴지통 목록에는 삭제 루트만 노출되어야 한다(자식 수천 개가
 * 목록에 쏟아지면 안 됨)."* `trash_root_id = id` 가 곧 "이 삭제 조작의 루트"다.
 *
 * TODO(W6 / F-06-*): 권한이 들어오면 **접근 가능한 페이지만** 노출해야 한다 —
 * F-11-05 가 "권한 필터 누락 시 제목 유출"이라고 못박은 지점이다. 지금은
 * 워크스페이스 멤버 전원이 모든 페이지를 보므로 `workspace_id` 필터가 곧 전부다.
 */
export async function listTrash(ctx: SessionContext): Promise<TrashEntry[]> {
  // ★ W6-b: 휴지통도 권한으로 거른다. F-11-05 가 "권한 필터 누락 시 제목 유출"을
  //    못박았고, 휴지통은 **지워진 페이지의 제목이 모이는 곳**이라 더 위험하다.
  const rows = await withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    return tx.query<{
      id: string
      properties: { title?: unknown } | null
      trashed_at: Date
      purge_after: Date | null
      descendant_count: string
    }>(
      `SELECT t.id, t.properties, t.trashed_at, t.purge_after,
              (SELECT count(*) FROM block d
                WHERE d.trash_root_id = t.id AND d.id <> t.id
                  AND d.workspace_id = t.workspace_id) AS descendant_count
         FROM block t
        WHERE t.workspace_id = $1 AND t.type = 'page'
          AND t.lifecycle = 'trashed' AND t.trash_root_id = t.id
          AND t.perm_scope_id = ANY($2::uuid[])
        ORDER BY t.trashed_at DESC, t.id`,
      [ctx.workspaceId, scopes],
    )
  })

  return rows.map((row) => {
    const raw = row.properties?.title
    return {
      id: asBlockId(row.id),
      // 읽기는 관대하게 — 제목이 망가졌다고 휴지통 전체가 500 이 되면 복구 경로가 없다.
      title: Array.isArray(raw) ? toPlainText(raw as RichTextRun[]) : '',
      trashedAt: row.trashed_at,
      purgeAfter: row.purge_after,
      descendantCount: Number(row.descendant_count),
    }
  })
}
