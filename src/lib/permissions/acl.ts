/**
 * 권한 부여 · 회수 · 상속 차단 — W6-b (F-06-01 / F-06-05 / F-06-07)
 *
 * 정본: 00-canonical-data-model.md §3.3 (`acl_entry` 규칙 A1~A4 · `block_acl_meta`
 *       불변식 P1~P4), §3.11 (`perm_scope_id` 재계산 트리거 5개, 상속 차단 알고리즘)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 절단은 **복사한 뒤에** 한다 (불변식 P1)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본의 경고 그대로: *"깨지면 '1명 제거'가 '전원 상실'이 된다."*
 *
 * 공유 패널에서 '상속됨' 주체 하나를 지우는 동작은 사실 두 가지 일이다 —
 * ① 지금까지 상속으로 받던 **모든** 주체를 이 노드에 그대로 복사하고
 * ② 상속을 끊은 다음
 * ③ 지목된 주체 하나를 지운다.
 *
 * ①을 빼먹고 ②만 하면 그 페이지는 아무에게도 안 보이는 페이지가 된다. 그래서
 * 이 파일 밖에서 `inherits_from_parent` 를 내리는 길을 만들지 않는다. DB 의
 * `ck_block_acl_materialized` 가 마지막 방어선이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * `perm_scope_id` 는 권한이 바뀔 때마다 서브트리째 다시 쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본이 재계산 트리거를 정확히 5개로 못박았다 — ① 첫 `acl_entry` 삽입
 * ② 마지막 `acl_entry` 삭제 ③ `inherits_from_parent` 전이 ④ 서브트리 이동
 * ⑤ `public_link.enabled` 전이. 이 파일이 ①②③ 을, `move-page.ts` 가 ④ 를 한다
 * (⑤ 는 공개 링크가 생길 때).
 *
 * 서브트리를 통째로 덮어쓰지 않는다 — **옛 스코프를 따르던 노드만** 바꾼다.
 * 아래쪽에 따로 권한을 준 페이지가 있으면 그 스코프는 그대로 두어야 한다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { can, type Level } from './levels.ts'
import { effectiveCaps, principalsOf, resolveCaps, type AclRow } from './effective.ts'

export type PrincipalRef =
  | { readonly type: 'user'; readonly id: string }
  | { readonly type: 'workspace_everyone' }

export type AclFailure =
  | 'not_found'
  /** 권한을 바꿀 권한이 없다(manage_perm). */
  | 'forbidden'
  /** 마지막 관리자를 지우면 아무도 이 페이지를 고칠 수 없게 된다. */
  | 'would_orphan'

export type AclResult<T = void> =
  | ({ readonly ok: true } & (T extends void ? object : { readonly value: T }))
  | { readonly ok: false; readonly reason: AclFailure }

type NodeRow = { id: string; ancestor_path: string[]; perm_scope_id: string; parent_id: string }

async function loadNode(tx: Tx, ctx: SessionContext, nodeId: string): Promise<NodeRow | null> {
  return tx.queryMaybe<NodeRow>(
    `SELECT id, ancestor_path, perm_scope_id, parent_id
       FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page'`,
    [nodeId, ctx.workspaceId],
  )
}

function principalColumns(principal: PrincipalRef): { type: string; id: string | null } {
  return principal.type === 'user'
    ? { type: 'user', id: principal.id }
    : { type: 'workspace_everyone', id: null }
}

/**
 * 이 노드를 스코프 경계로 만들거나(또는 풀거나) 서브트리에 반영한다.
 *
 * @param from 지금 이 서브트리가 따르고 있는 스코프
 * @param to   앞으로 따라야 할 스코프
 */
async function rescope(tx: Tx, ctx: SessionContext, node: NodeRow, from: string, to: string): Promise<void> {
  if (from === to) return
  await tx.query(
    `UPDATE block
        SET perm_scope_id = $3
      WHERE workspace_id = $2
        AND (id = $1 OR ancestor_path @> ARRAY[$1]::uuid[])
        -- ★ 옛 스코프를 따르던 노드만. 아래쪽에 따로 권한을 준 페이지가 있으면
        --   그 스코프는 그대로 둔다.
        AND perm_scope_id = $4`,
    [node.id, ctx.workspaceId, to, from],
  )
}

/** 이 노드에 ACL 행이 있는가. 스코프 경계인지의 절반이다. */
async function hasEntries(tx: Tx, nodeId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 LIMIT 1`,
    [nodeId],
  )
  return row !== null
}

async function isCut(tx: Tx, nodeId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ inherits_from_parent: boolean }>(
    `SELECT inherits_from_parent FROM block_acl_meta WHERE node_id = $1`,
    [nodeId],
  )
  return row !== null && !row.inherits_from_parent
}

/** 부모가 따르는 스코프. 상속을 다시 시작할 때 돌아갈 자리다. */
async function parentScope(tx: Tx, ctx: SessionContext, node: NodeRow): Promise<string> {
  const parent = await tx.queryMaybe<{ perm_scope_id: string }>(
    `SELECT perm_scope_id FROM block WHERE id = $1 AND workspace_id = $2`,
    [node.parent_id, ctx.workspaceId],
  )
  // 루트 페이지는 부모가 워크스페이스다 — 돌아갈 상위 스코프가 없으므로 자기 자신이다.
  return parent?.perm_scope_id ?? node.id
}

// ── 부여 ──────────────────────────────────────────────────────────────

/**
 * 주체에게 레벨을 준다. 이미 있으면 레벨만 바꾼다.
 *
 * 규칙 A1 에 따라 `level='none'` 은 없다 — 회수는 `revokeAccess` 다.
 */
export async function grantAccess(
  ctx: SessionContext,
  pageId: string,
  principal: PrincipalRef,
  level: Level,
): Promise<AclResult> {
  return withTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, pageId), 'manage_perm')) {
      return { ok: false, reason: 'forbidden' } as const
    }

    const had = await hasEntries(tx, pageId)
    const p = principalColumns(principal)

    await tx.query(
      `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
       VALUES ($1, 'block', $2, $3, $4, $5, $6)
       ON CONFLICT (node_kind, node_id, principal_type, principal_id)
       DO UPDATE SET level = EXCLUDED.level, granted_by = EXCLUDED.granted_by, granted_at = now()`,
      [randomUUID(), pageId, p.type, p.id, level, ctx.userId],
    )

    // 트리거 ①: 첫 ACL 삽입 → 이 노드가 스코프 경계가 된다.
    if (!had) await rescope(tx, ctx, node, node.perm_scope_id, node.id)

    return { ok: true } as const
  })
}

/**
 * 주체의 권한을 회수한다(행 삭제 — 규칙 A1).
 *
 * **마지막 관리자는 지우지 않는다.** 지우면 그 페이지의 권한을 아무도 못 고치는
 * 상태가 되고, 되돌릴 방법이 DB 직접 수정밖에 없다. 정본에 명시된 규칙은 아니지만
 * 되돌릴 수 없는 상태를 만드는 조작은 막는다.
 */
export async function revokeAccess(
  ctx: SessionContext,
  pageId: string,
  principal: PrincipalRef,
): Promise<AclResult> {
  return withTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, pageId), 'manage_perm')) {
      return { ok: false, reason: 'forbidden' } as const
    }

    const p = principalColumns(principal)
    const cut = await isCut(tx, pageId)

    if (cut && (await wouldOrphan(tx, pageId, p))) {
      return { ok: false, reason: 'would_orphan' } as const
    }

    await tx.query(
      `DELETE FROM acl_entry
        WHERE node_kind = 'block' AND node_id = $1
          AND principal_type = $2 AND principal_id IS NOT DISTINCT FROM $3`,
      [pageId, p.type, p.id],
    )

    // 트리거 ②: 마지막 ACL 삭제 → 경계가 아니게 된다(절단돼 있으면 여전히 경계다).
    if (!(await hasEntries(tx, pageId)) && !cut) {
      await rescope(tx, ctx, node, node.id, await parentScope(tx, ctx, node))
    }

    return { ok: true } as const
  })
}

/**
 * 이 행을 지우면 이 노드를 관리할 수 있는 사람이 아무도 안 남는가.
 *
 * 상속이 끊긴 노드에서만 묻는다 — 상속받는 노드는 조상에게 관리자가 있다.
 */
async function wouldOrphan(tx: Tx, nodeId: string, victim: { type: string; id: string | null }): Promise<boolean> {
  const rows = await tx.query<AclRow>(
    `SELECT node_id, principal_type, principal_id, level
       FROM acl_entry WHERE node_kind = 'block' AND node_id = $1`,
    [nodeId],
  )
  const remaining = rows.filter(
    (r) => !(r.principal_type === victim.type && (r.principal_id ?? null) === victim.id),
  )
  return !remaining.some((r) =>
    can(
      resolveCaps({
        chain: [nodeId],
        cutAt: new Set([nodeId]),
        entries: [r],
        principals: [{ type: r.principal_type, id: r.principal_id }],
      }),
      'manage_perm',
    ),
  )
}

// ── 상속 차단 ─────────────────────────────────────────────────────────

/**
 * 상속을 끊는다. **끊기 전에 지금까지 상속하던 것을 이 노드에 복사한다**(P1).
 *
 * 복사 대상은 "조상들이 주는 grant 의 합집합"이다. 주체별로 가장 관대한 레벨
 * 하나만 남긴다 — 같은 주체에 두 행을 만들 수 없고(UNIQUE), 그럴 이유도 없다.
 */
export async function stopInheriting(ctx: SessionContext, pageId: string): Promise<AclResult> {
  return withTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, pageId), 'manage_perm')) {
      return { ok: false, reason: 'forbidden' } as const
    }
    if (await isCut(tx, pageId)) return { ok: true } as const

    // 조상(자기 자신 제외)의 모든 grant. 절단된 조상을 만나면 거기서 멈춘다.
    const ancestors = [...node.ancestor_path].reverse()
    const inherited = await inheritedGrants(tx, ancestors)

    for (const [key, level] of inherited) {
      const [type, id] = key.split(' ')
      await tx.query(
        `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
         VALUES ($1, 'block', $2, $3, $4, $5, $6)
         ON CONFLICT (node_kind, node_id, principal_type, principal_id) DO NOTHING`,
        [randomUUID(), pageId, type, id === '' ? null : id, level, ctx.userId],
      )
    }

    await tx.query(
      `INSERT INTO block_acl_meta (node_id, inherits_from_parent, materialized_at, updated_at)
       VALUES ($1, false, now(), now())
       ON CONFLICT (node_id)
       DO UPDATE SET inherits_from_parent = false, materialized_at = now(), updated_at = now()`,
      [pageId],
    )

    // 트리거 ③: 절단 → 경계가 된다.
    await rescope(tx, ctx, node, node.perm_scope_id, node.id)
    return { ok: true } as const
  })
}

/**
 * 조상 사슬이 주는 grant 를 주체별로 모은다.
 *
 * 레벨을 합치지 않고 **가장 관대한 것 하나**를 고른다. capability 합집합을 정확히
 * 표현하는 레벨이 없을 수 있어서(A2: 전순서가 아니다) 표현 가능한 값 중 고르는
 * 쪽이 정직하다 — 없는 레벨을 지어내지 않는다.
 */
async function inheritedGrants(tx: Tx, ancestors: string[]): Promise<Map<string, Level>> {
  const result = new Map<string, Level>()
  if (ancestors.length === 0) return result

  const [entries, cuts] = await Promise.all([
    tx.query<AclRow>(
      `SELECT node_id, principal_type, principal_id, level
         FROM acl_entry WHERE node_kind = 'block' AND node_id = ANY($1::uuid[])`,
      [ancestors],
    ),
    tx.query<{ node_id: string }>(
      `SELECT node_id FROM block_acl_meta
        WHERE node_id = ANY($1::uuid[]) AND inherits_from_parent = false`,
      [ancestors],
    ),
  ])
  const cutSet = new Set(cuts.map((c) => c.node_id))

  for (const nodeId of ancestors) {
    for (const row of entries.filter((e) => e.node_id === nodeId)) {
      const key = `${row.principal_type} ${row.principal_id ?? ''}`
      const current = result.get(key)
      result.set(key, moreGenerous(current, row.level as Level))
    }
    if (cutSet.has(nodeId)) break
  }
  return result
}

/** capability 개수로 비교한다 — 레벨 이름을 크기로 보지 않는다(A2). */
function moreGenerous(a: Level | undefined, b: Level): Level {
  if (a === undefined) return b
  const caps = (level: Level): number => {
    const set = resolveCaps({
      chain: ['n'],
      cutAt: new Set(['n']),
      entries: [{ node_id: 'n', principal_type: 'user', principal_id: 'u', level }],
      principals: [{ type: 'user', id: 'u' }],
    })
    let bits = 0
    for (let i = 0; i < 16; i += 1) if (set & (1 << i)) bits += 1
    return bits
  }
  return caps(b) > caps(a) ? b : a
}

/**
 * 상속을 다시 받는다 (불변식 P3).
 *
 * ⚠ **정본과 다른 점**: 정본은 "inherits:=TRUE + **부모 유래 행 삭제**"라고 적지만,
 * `acl_entry` 에는 그 행이 어디서 왔는지 적는 자리가 없다(정본 스키마에도 없다).
 * 그래서 복사해 둔 행을 **지우지 않고 남긴다.** 결과의 차이는 "절단 시점에 있던
 * 권한을 계속 갖는다"이고, 잃는 쪽이 아니라 **남는 쪽**으로 기운다.
 *
 * 지우는 쪽을 택하면 provenance 컬럼이 필요하고, 그건 정본을 고치는 일이다(§7).
 */
export async function resumeInheriting(ctx: SessionContext, pageId: string): Promise<AclResult> {
  return withTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, pageId), 'manage_perm')) {
      return { ok: false, reason: 'forbidden' } as const
    }

    await tx.query(
      `UPDATE block_acl_meta
          SET inherits_from_parent = true, materialized_at = NULL, updated_at = now()
        WHERE node_id = $1`,
      [pageId],
    )

    // 트리거 ③의 반대. 남은 ACL 이 없으면 경계가 아니게 된다.
    if (!(await hasEntries(tx, pageId))) {
      await rescope(tx, ctx, node, node.id, await parentScope(tx, ctx, node))
    }
    return { ok: true } as const
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

export type AccessEntry = {
  readonly principalType: string
  readonly principalId: string | null
  readonly level: Level
  /** 이 노드에 직접 준 것인가, 조상에서 물려받은 것인가. */
  readonly inherited: boolean
}

/** 공유 패널이 보여줄 목록. 직접 준 것과 물려받은 것을 구분해 준다. */
export async function listAccess(
  ctx: SessionContext,
  pageId: string,
): Promise<AclResult<AccessEntry[]>> {
  return withTransaction(async (tx) => {
    const node = await loadNode(tx, ctx, pageId)
    if (node === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, pageId), 'view')) {
      return { ok: false, reason: 'forbidden' } as const
    }

    const direct = await tx.query<AclRow>(
      `SELECT node_id, principal_type, principal_id, level
         FROM acl_entry WHERE node_kind = 'block' AND node_id = $1
         ORDER BY principal_type, principal_id`,
      [pageId],
    )
    const value: AccessEntry[] = direct.map((row) => ({
      principalType: row.principal_type,
      principalId: row.principal_id,
      level: row.level as Level,
      inherited: false,
    }))

    if (!(await isCut(tx, pageId))) {
      const inherited = await inheritedGrants(tx, [...node.ancestor_path].reverse())
      for (const [key, level] of inherited) {
        const [type, id] = key.split(' ')
        const principalId = id === '' ? null : id
        if (value.some((v) => v.principalType === type && v.principalId === principalId)) continue
        value.push({ principalType: type, principalId, level, inherited: true })
      }
    }

    return { ok: true, value } as const
  })
}

export { principalsOf }
