/**
 * 페이지 본문 저장 — Phase 0 의 프로젝터
 *
 * 정본: 판결 X-1 (본문 순서의 정본은 Y.Doc, `order_key` 는 파생 / 프로젝터가
 *       유일한 쓰기자), X-3 · B2 · B5 (비페이지 블록은 lifecycle 축이 없다),
 *       X-6 (`block.version` 은 페이지 단위 변경 카운터)
 *       마스터 문서 §5.1 "Phase 0 은 페이지 단위 LWW"
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 함수가 프로젝터다
 * ──────────────────────────────────────────────────────────────────────
 *
 * X-1 은 `parent_type='block'` 인 블록의 `order_key` 를 "프로젝터가 쓰는 파생"
 * 이라고 정하고, 그 대가로 "프로젝터가 유일한 쓰기자이므로
 * `UNIQUE(parent_id, order_key)` 충돌이 구조적으로 발생하지 않는다"를 얻었다.
 *
 * Phase 0 에는 Y.Doc 이 없다. 상류가 문서(`EditorDoc`)이고, 이 함수가 그
 * 문서를 `block` 행으로 투영한다. **Phase 1 에서 바뀌는 것은 상류뿐이다** —
 * `doc_update` 로그를 머지해 문서를 만들고 같은 투영을 돌린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 비페이지 블록의 삭제는 물리 삭제다
 * ──────────────────────────────────────────────────────────────────────
 *
 * X-3 이 `lifecycle` 을 `type='page'` 만의 축으로 못박았고
 * (`ck_lifecycle_page` CHECK 이 실제로 막는다), B5 는 "비페이지 블록은 소속
 * Y.Doc 안에 있으므로 건드리지 않는다"고 한다. 즉 문단은 휴지통에 가지 않는다
 * (§9-Q8 의 잠정 결정과 일치: "나타나지 않음"). 문서에서 사라진 본문 블록은
 * **행을 지운다.** 복원은 `page_version` 이 담당한다(Phase 1).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자식 페이지는 프로젝터가 소유하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 문서에는 `type='page'` 참조 노드가 들어오지만, 프로젝터는 그 행의 **위치만**
 * 건드린다(순서, 그리고 부모). 제목·properties·lifecycle 은 그 페이지 자신의 것이다.
 *
 * 부모가 바뀌는 경우 — 하위 페이지를 토글 안으로 끌어다 놓는 것 — 는
 * `order_key` 만 고쳐서는 안 된다. 그 페이지 **서브트리 전체의 `ancestor_path`
 * 와 `perm_scope_id`** 를 다시 써야 한다 [X-7 / §3.11 ④]. 그 일은
 * `move-page.ts` 의 `relocateSubtree` 가 하고, 여기서는 부르기만 한다 —
 * 두 벌로 만들면 한쪽만 고쳐져 권한이 조용히 틀어진다.
 *
 * 그리고 문서에서 자식 페이지가 빠져 있으면 **저장을 거부한다** — 낡은 에디터
 * 탭 하나가 하위 페이지를 통째로 지워버리는 경로를 만들지 않기 위해서다.
 * 하위 페이지 삭제는 휴지통 API 로만 한다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { PAGE_TYPE } from './types.ts'
import { countFileReferences, fileReferenceDelta } from './image.ts'
import { orderKeyBetween } from './order-key.ts'
import { relocateSubtree, MoveError } from './move-page.ts'
import {
  projectDocument,
  rowsToDoc,
  validateDoc,
  type BodyRow,
  type DocIssue,
  type EditorDoc,
  type ProjectedBlock,
} from '../editor/document.ts'

// ── 결과 ──────────────────────────────────────────────────────────────

export type SaveWriteCounts = {
  readonly inserted: number
  readonly updated: number
  readonly deleted: number
  readonly reordered: number
}

export type SaveBodyResult =
  | {
      readonly ok: true
      /** 저장 후 `block.version` [X-6]. 다음 저장의 `expectedVersion` 으로 쓴다. */
      readonly version: string
      readonly writes: SaveWriteCounts
    }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'invalid_document'; readonly issues: DocIssue[] }
  | {
      readonly ok: false
      readonly reason: 'version_conflict'
      /** 서버의 현재 버전. 클라이언트가 이 값으로 다시 읽어 병합한다. */
      readonly currentVersion: string
    }
  | {
      readonly ok: false
      readonly reason: 'page_ref_missing'
      /** 문서에서 빠진 자식 페이지들. */
      readonly missing: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: 'page_ref_too_deep'
      /** 옮기려던 자식 페이지. 그 서브트리가 깊이 상한을 넘는다. */
      readonly pageId: string
      readonly message: string
    }

// ── 안정 비교 ─────────────────────────────────────────────────────────

/**
 * 키 순서에 무관한 JSON 직렬화.
 *
 * `properties`/`format` 이 실제로 바뀌었는지 판단하는 데 쓴다. `JSON.stringify`
 * 를 그냥 쓰면 키 순서가 다른 같은 값이 "변경됨"으로 잡혀서, 아무것도 고치지
 * 않은 저장이 페이지 전체를 다시 쓴다 — 마스터 문서 §9-Q1(프로젝터 쓰기 증폭)이
 * 경계하는 그 지점이다.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}

// ── 본문 범위 조회 ────────────────────────────────────────────────────

type ScopeRow = BodyRow & { lifecycle: string; ancestor_path: string[]; perm_scope_id: string }

/**
 * 이 페이지의 **문서 범위**에 있는 행을 읽는다.
 *
 * 재귀는 `type='page'` 에서 멈춘다. 자식 페이지의 본문은 그 페이지의 문서이므로
 * 이 문서의 범위가 아니다. `ancestor_path @> ARRAY[pageId]` 로 뽑으면 자식
 * 페이지의 자손까지 딸려 와서 **다른 문서의 블록을 지우게 된다.**
 */
async function readScope(tx: Tx, ctx: SessionContext, pageId: string): Promise<ScopeRow[]> {
  return tx.query<ScopeRow>(
    `WITH RECURSIVE doc_scope AS (
         SELECT b.id, b.type, b.parent_id, b.order_key, b.properties, b.format,
                b.lifecycle, b.ancestor_path, b.perm_scope_id
           FROM block b
          WHERE b.parent_id = $1 AND b.workspace_id = $2
       UNION ALL
         SELECT c.id, c.type, c.parent_id, c.order_key, c.properties, c.format,
                c.lifecycle, c.ancestor_path, c.perm_scope_id
           FROM block c
           JOIN doc_scope s ON c.parent_id = s.id
          WHERE s.type <> $3 AND c.workspace_id = $2
     )
     SELECT * FROM doc_scope`,
    [pageId, ctx.workspaceId, PAGE_TYPE],
  )
}

// ── order_key 할당 ────────────────────────────────────────────────────

/**
 * 문서 밖 형제가 점유한 키를 피해 형제 키를 매긴다.
 *
 * 문서 밖 형제는 **휴지통에 있는 자식 페이지**다. B2 가 "삭제 시 parent_id ·
 * order_key 를 절대 변경하지 않는다"고 정했으므로 그 키를 밀어낼 수 없다.
 * 그래서 우리 쪽이 비켜간다 — 점유된 키가 나오면 한 칸 더 나아간다.
 *
 * 점유가 없으면(보통) 결과는 `a0, a1, …` 로 **결정론적**이다. 그래서 문서가
 * 안 바뀌면 키도 그대로고 저장이 쓰기 0건이 된다.
 */
function assignSiblingKeys(count: number, occupied: ReadonlySet<string>): string[] {
  const keys: string[] = []
  let prev: string | null = null
  for (let i = 0; i < count; i += 1) {
    let key = orderKeyBetween(prev, null)
    while (occupied.has(key)) key = orderKeyBetween(key, null)
    keys.push(key)
    prev = key
  }
  return keys
}

// ── 저장 ──────────────────────────────────────────────────────────────

export type SavePageBodyOptions = {
  /**
   * 클라이언트가 읽었을 때의 `block.version`.
   *
   * 주면 낙관적 잠금이 된다 — 그 사이 누가 저장했으면 `version_conflict` 다.
   * Phase 0 의 대체안이 "페이지 단위 LWW + 다른 사람이 편집 중 배너"(§5.1)이고,
   * 배너를 띄우려면 충돌을 **알아야** 한다. 생략하면 무조건 덮어쓴다(순수 LWW).
   */
  readonly expectedVersion?: string
}

export async function savePageBody(
  ctx: SessionContext,
  pageId: BlockId,
  doc: EditorDoc,
  options: SavePageBodyOptions = {},
): Promise<SaveBodyResult> {
  const issues = validateDoc(doc)
  if (issues.length > 0) return { ok: false, reason: 'invalid_document', issues }

  return withTransaction(async (tx) => {
    // 페이지 행을 잠근다. 프로젝터가 유일한 쓰기자라는 X-1 의 전제를
    // 동시 저장 두 건에 대해서도 성립시키는 것이 이 잠금이다.
    const page = await tx.queryMaybe<{
      id: string
      ancestor_path: string[]
      perm_scope_id: string
      version: string
    }>(
      `SELECT id, ancestor_path, perm_scope_id, version
         FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'
        FOR UPDATE`,
      [pageId, ctx.workspaceId],
    )
    if (!page) return { ok: false, reason: 'not_found' } as const

    if (options.expectedVersion !== undefined && options.expectedVersion !== page.version) {
      return { ok: false, reason: 'version_conflict', currentVersion: page.version } as const
    }

    const scope = await readScope(tx, ctx, pageId)
    const projection = projectDocument(pageId, page.ancestor_path, doc)

    // ── 자식 페이지 정합성 ────────────────────────────────────────────
    const docIds = new Set(projection.blocks.map((b) => b.id))
    const livePageRefs = scope.filter((r) => r.type === PAGE_TYPE && r.lifecycle === 'live')

    const missing = livePageRefs.filter((r) => !docIds.has(r.id)).map((r) => r.id)
    if (missing.length > 0) {
      // 낡은 탭이 하위 페이지를 지워버리는 경로를 만들지 않는다.
      return { ok: false, reason: 'page_ref_missing', missing } as const
    }

    // ── 자리를 옮긴 자식 페이지 ───────────────────────────────────────
    //
    // 하위 페이지를 토글 안으로 끌어다 놓는 것 같은 조작이다. 부모가 바뀌면
    // `order_key` 만 고쳐서는 안 되고 **그 페이지 서브트리 전체의
    // `ancestor_path` 와 `perm_scope_id`** 를 다시 써야 한다 [X-7 / §3.11 ④].
    // 방치하면 정확히 X-7 이 경계한 "권한이 조용히 틀어지는" 상태가 된다.
    //
    // 그 일은 `move-page.ts` 의 `relocateSubtree` 가 이미 한다. 여기서 다시
    // 구현하지 않고 부른다 — 두 벌이면 한쪽만 고쳐져 어긋난다.
    const currentParentOf = new Map(scope.map((r) => [r.id, r.parent_id]))
    const pageRefMoves = projection.blocks.filter(
      (b) => b.type === PAGE_TYPE && currentParentOf.get(b.id) !== b.parentId,
    )

    // ── order_key 재할당 (문서 밖 형제를 피한다) ──────────────────────
    const occupiedByParent = new Map<string, Set<string>>()
    for (const row of scope) {
      if (docIds.has(row.id)) continue
      if (row.type !== PAGE_TYPE) continue // 본문 블록은 지워질 것이므로 비켜줄 필요가 없다
      const set = occupiedByParent.get(row.parent_id) ?? new Set<string>()
      set.add(row.order_key)
      occupiedByParent.set(row.parent_id, set)
    }

    const targets = withReassignedKeys(projection.blocks, occupiedByParent)

    // ── 차집합 ────────────────────────────────────────────────────────
    const existing = new Map(scope.map((r) => [r.id, r]))
    const toDelete = scope
      .filter((r) => !docIds.has(r.id) && r.type !== PAGE_TYPE)
      .map((r) => r.id)

    const toInsert: ProjectedBlock[] = []
    const toUpdate: ProjectedBlock[] = []
    const keyChanges: ProjectedBlock[] = []

    for (const target of targets) {
      const row = existing.get(target.id)
      if (!row) {
        toInsert.push(target)
        continue
      }
      // ★ "키가 바뀌는 행"이 아니라 **(부모, 키) 자리가 바뀌는 행**이다.
      // 키는 위치로 결정론적으로 매겨지므로(a0, a1, …) 루트 첫 블록을 다른 블록의
      // 첫 자식으로 옮기면 키 문자열은 a0 그대로이고 부모만 바뀐다. 키만 비교하면
      // 이 행은 임시 키로 비켜나지 않고 옛 자리 (옛 부모, a0) 에 남는데, 그 자리로
      // 들어오는 형제의 UPDATE 가 먼저 돌면 UNIQUE 에 걸린다. 드래그(F-01-08)의
      // "자식 드롭"이 처음 밟았다 — Tab/Shift+Tab 은 우연히 늘 키도 바뀌었다.
      if (row.order_key !== target.orderKey || row.parent_id !== target.parentId) {
        keyChanges.push(target)
      }
      if (row.type === PAGE_TYPE) {
        // 자식 페이지는 순서(그리고 필요하면 부모)만. 내용은 그 페이지의 것이다.
        continue
      }
      const changed =
        row.type !== target.type ||
        row.parent_id !== target.parentId ||
        row.order_key !== target.orderKey ||
        stableJson(row.ancestor_path) !== stableJson(target.ancestorPath) ||
        stableJson(row.properties ?? {}) !== stableJson(target.properties) ||
        stableJson(row.format ?? {}) !== stableJson(target.format)
      if (changed) toUpdate.push(target)
    }

    // ── 쓰기 ──────────────────────────────────────────────────────────
    //
    // 순서가 중요하다. `ux_block_sibling_order` 는 `CREATE UNIQUE INDEX` 로
    // 만든 **지연 불가** 제약이라, 한 UPDATE 안에서 두 형제의 키를 맞바꾸면
    // 중간 상태에서 충돌한다. 그래서 네 단계로 나눈다.
    //
    //   ① 사라진 본문 블록을 지운다        — 키가 비워진다
    //   ② 키가 바뀌는 행을 임시 키로 옮긴다 — id 기반이라 서로 충돌하지 않고,
    //                                         '~' 로 시작해 최종 키와도 겹치지 않는다
    //   ③ 새 행을 최종 키로 넣는다
    //   ④ ②의 행을 최종 키로 옮긴다

    if (toDelete.length > 0) {
      await tx.query(`DELETE FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`, [
        toDelete,
        ctx.workspaceId,
      ])
    }

    // 자리를 옮기는 자식 페이지도 임시 키로 비켜둔다. 최종 키를 바로 쓰면
    // 새 형제 그룹에서 아직 임시 키로 옮겨지지 않은 행과 충돌할 수 있다.
    const tempKeyIds = [...new Set([...keyChanges, ...pageRefMoves].map((b) => b.id))]
    if (tempKeyIds.length > 0) {
      await tx.query(
        `UPDATE block SET order_key = '~' || id::text
          WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
        [tempKeyIds, ctx.workspaceId],
      )
    }

    // 개별 문장으로 쓴다. 위의 차집합 계산 덕분에 아무것도 안 바뀐 저장은
    // 여기서 0건이 되고, 보통의 타이핑은 1~3건이다. 한 페이지를 통째로 새로
    // 만드는 경우에만 블록 수만큼 문장이 나가는데, 그때가 문제가 되면
    // unnest 배치로 바꾼다 (§9-Q1 의 관측 대상).
    for (const b of toInsert) {
      await tx.query(
        `INSERT INTO block (
           id, workspace_id, type, parent_type, parent_id, order_key,
           ancestor_path, perm_scope_id, properties, format,
           created_by, created_at, last_edited_by, last_edited_at
         ) VALUES ($1, $2, $3, 'block', $4, $5, $6::uuid[], $7, $8::jsonb, $9::jsonb,
                   $10, now(), $10, now())`,
        [
          b.id,
          ctx.workspaceId,
          b.type,
          b.parentId,
          b.orderKey,
          b.ancestorPath,
          page.perm_scope_id,
          JSON.stringify(b.properties),
          JSON.stringify(b.format),
          ctx.userId,
        ],
      )
    }

    for (const b of toUpdate) {
      await tx.query(
        `UPDATE block
            SET type = $3, parent_id = $4, order_key = $5, ancestor_path = $6::uuid[],
                properties = $7::jsonb, format = $8::jsonb,
                last_edited_by = $9, last_edited_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [
          b.id,
          ctx.workspaceId,
          b.type,
          b.parentId,
          b.orderKey,
          b.ancestorPath,
          JSON.stringify(b.properties),
          JSON.stringify(b.format),
          ctx.userId,
        ],
      )
    }

    // ── 자리를 옮긴 자식 페이지: 서브트리째 재배치 ────────────────────
    //
    // `relocateSubtree` 가 `ancestor_path` · `perm_scope_id` · `version` 을
    // 서브트리 전체에 다시 쓴다. 우리가 계산한 `order_key` 를 넘겨서
    // 문서 위치가 그대로 반영되게 한다.
    //
    // 사이클은 있을 수 없다 — 대상은 **이 페이지의 문서 안 블록**이고, 그 블록이
    // 옮겨지는 자식 페이지의 자손일 수는 없다(자식 페이지의 본문은 별도 문서다).
    // 그래서 `relocateSubtree` 가 던질 수 있는 것은 깊이 초과뿐이다.
    const movedPageIds = new Set(pageRefMoves.map((b) => b.id))
    for (const b of pageRefMoves) {
      const row = existing.get(b.id)
      if (!row) continue
      const parentRow = b.parentId === pageId ? null : existing.get(b.parentId)

      try {
        await relocateSubtree(
          tx,
          ctx,
          {
            id: row.id,
            parent_type: 'block',
            parent_id: row.parent_id,
            ancestor_path: row.ancestor_path,
            perm_scope_id: row.perm_scope_id,
          },
          {
            id: b.parentId,
            type: parentRow?.type ?? 'page',
            ancestor_path: b.ancestorPath.slice(0, -1),
            perm_scope_id: page.perm_scope_id,
          },
          b.orderKey,
        )
      } catch (e) {
        if (e instanceof MoveError && e.code === 'too_deep') {
          return { ok: false, reason: 'page_ref_too_deep', pageId: b.id, message: e.message } as const
        }
        throw e
      }
    }

    // 남은 자식 페이지(순서만 바뀐 것)는 임시 키에 있다. 키만 확정한다.
    const updatedIds = new Set(toUpdate.map((b) => b.id))
    for (const b of keyChanges) {
      if (updatedIds.has(b.id) || movedPageIds.has(b.id)) continue
      await tx.query(
        `UPDATE block SET order_key = $3 WHERE id = $1 AND workspace_id = $2`,
        [b.id, ctx.workspaceId, b.orderKey],
      )
    }

    // ── 파일 참조 카운트 ──────────────────────────────────────────────
    //
    // 정본 F-01-15: *"같은 파일을 여러 블록이 참조 → 참조 카운트로 물리 삭제
    // 제어"*, 불변식 FS1: *"`ref_count > 0` 인 객체를 지우지 않는다."*
    //
    // **이 트랜잭션 안에서 한다.** 블록을 넣고 카운트를 나중에 올리면 그 사이에
    // GC 가 도는 순간 방금 붙인 이미지의 바이트가 사라진다.
    //
    // 자식 페이지는 양쪽 모두에서 뺀다. 그 행의 properties 는 그 페이지의
    // 것이고 이 프로젝터가 쓰지 않으므로, 한쪽에만 세면 저장할 때마다 같은 값이
    // 올라가거나 내려간다.
    const before = countFileReferences(scope.filter((r) => r.type !== PAGE_TYPE))
    const after = countFileReferences(
      projection.blocks.filter((b) => b.type !== PAGE_TYPE).map((b) => ({ properties: b.properties })),
    )
    for (const [fileId, delta] of fileReferenceDelta(before, after)) {
      // 워크스페이스로 한정한다 — 다른 워크스페이스의 파일 id 를 문서에 적어
      // 넣어도 그 카운터는 움직이지 않는다(그 이미지는 어차피 보이지 않는다).
      //
      // 내릴 때 `GREATEST(…, 0)` 로 바닥을 둔다. 장부가 어긋났을 때 저장을
      // 실패시키는 쪽이 더 나빠 보이지만 — 사용자는 자기가 쓴 글을 잃고,
      // 얻는 것은 GC 힌트의 정확도뿐이다. 어긋나면 **덜 지우는 쪽**으로
      // 기울게 둔다(FS1 이 지키려는 것이 그 방향이다).
      await tx.query(
        `UPDATE file SET ref_count = GREATEST(ref_count + $3, 0)
          WHERE id = $1 AND workspace_id = $2`,
        [fileId, ctx.workspaceId, delta],
      )
    }

    const wroteSomething =
      toDelete.length > 0 ||
      toInsert.length > 0 ||
      toUpdate.length > 0 ||
      keyChanges.length > 0 ||
      pageRefMoves.length > 0

    // X-6: `block.version` 은 페이지 단위 단조 변경 카운터이고 검색 인덱스의
    // external version 이다. **바뀐 게 없으면 올리지 않는다** — 올리면
    // 인덱서가 같은 내용을 계속 다시 읽는다.
    let version = page.version
    if (wroteSomething) {
      const bumped = await tx.queryOne<{ version: string }>(
        `UPDATE block
            SET version = version + 1, last_edited_by = $2, last_edited_at = now()
          WHERE id = $1
          RETURNING version`,
        [pageId, ctx.userId],
      )
      version = bumped.version
    }

    return {
      ok: true,
      version,
      writes: {
        inserted: toInsert.length,
        updated: toUpdate.length,
        deleted: toDelete.length,
        reordered: keyChanges.length,
      },
    } as const
  })
}

/**
 * 투영 결과의 `order_key` 를 점유 키를 피한 값으로 다시 매긴다.
 *
 * `projectDocument` 는 순수 함수라 DB 상태(휴지통 형제의 키)를 모른다.
 * 그 정보는 여기서만 알 수 있으므로 이 단계를 분리했다.
 */
function withReassignedKeys(
  blocks: readonly ProjectedBlock[],
  occupiedByParent: ReadonlyMap<string, ReadonlySet<string>>,
): ProjectedBlock[] {
  if (occupiedByParent.size === 0) return [...blocks]

  const groups = new Map<string, ProjectedBlock[]>()
  for (const b of blocks) {
    const list = groups.get(b.parentId)
    if (list) list.push(b)
    else groups.set(b.parentId, [b])
  }

  const remapped = new Map<string, string>()
  for (const [parentId, siblings] of groups) {
    const occupied = occupiedByParent.get(parentId)
    if (!occupied || occupied.size === 0) continue
    // position 순 = 문서 순서. projectDocument 가 전위 순회로 매긴 값이다.
    const ordered = [...siblings].sort((a, b) => a.position - b.position)
    const keys = assignSiblingKeys(ordered.length, occupied)
    ordered.forEach((b, i) => remapped.set(b.id, keys[i]))
  }

  return blocks.map((b) => {
    const key = remapped.get(b.id)
    return key === undefined ? b : { ...b, orderKey: key }
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

export type LoadedBody = {
  readonly doc: EditorDoc
  /** 저장 시 `expectedVersion` 으로 되돌려 보낼 값 [X-6]. */
  readonly version: string
}

/**
 * 페이지 본문을 문서로 읽는다.
 *
 * 빈 페이지는 `blocks: []` 다. 에디터가 빈 문단 하나를 화면에서 합성한다 —
 * 서버가 미리 넣어두면 "한 번도 열지 않은 페이지"와 "열어서 비운 페이지"가
 * 구분되지 않는다.
 */
export async function loadPageBody(
  ctx: SessionContext,
  pageId: BlockId,
): Promise<LoadedBody | null> {
  return withTransaction(async (tx) => {
    const page = await tx.queryMaybe<{ version: string }>(
      `SELECT version FROM block
        WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (!page) return null

    const scope = await readScope(tx, ctx, pageId)
    // 휴지통에 있는 자식 페이지는 문서에 넣지 않는다. 다만 그 키는 점유된
    // 상태로 남아 있고(B2), 저장 시 assignSiblingKeys 가 비켜간다.
    const live = scope.filter((r) => r.lifecycle === 'live')

    return { doc: rowsToDoc(pageId, live), version: page.version }
  })
}
