/**
 * 유효 권한 `effective()` — W6-b (F-06-01 / F-06-07)
 *
 * 정본: 00-canonical-data-model.md §3.11 "유효 권한 effective()", §3.3 규칙 A1·A2·A9
 *
 * ──────────────────────────────────────────────────────────────────────
 * 0단계는 이미 지나 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본의 `effective()` 는 0단계(정책 게이트 · `can_enter_workspace`)로 시작한다.
 * 우리 코드에서 그 단계는 **`SessionContext` 를 발급하는 순간** 끝난다
 * (`resolveSessionContext`). 불변식 A9 가 "입력은 user_id 가 아니다"라고 못박은
 * 이유가 그것이고, 그래서 이 파일의 모든 함수는 `SessionContext` 를 받는다 —
 * 그 값을 갖고 있다는 것 자체가 0단계 통과의 증명이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 1단계는 "허용의 합집합"이다. deny 가 없다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 규칙 A1: `level='none'` 행은 존재하지 않는다. 회수는 행 삭제다. 그래서 판정은
 * **만나는 모든 grant 의 capability 를 OR** 하는 것뿐이고, 순서에 의존하지 않는다.
 * deny 를 넣는 순간 "어느 규칙이 이기는가"가 생기고 그 답은 문서에 안 적힌다.
 *
 * 규칙 A2: **정수 비교 금지.** `create` 는 `view` 를 포함하지 않으므로 레벨을
 * 크기로 비교하면 조용히 틀린다. 합치는 일은 `maxByCap`(capability 비트마스크 OR)
 * 이 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 재귀 대신 조상 배열
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본은 `effective(S, parent(N))` 재귀로 적혀 있다. 우리는 `block.ancestor_path`
 * 가 이미 조상 목록이므로 **한 번의 질의로 노드+조상의 ACL 을 전부 읽고** 위로
 * 훑는다. 재귀 질의를 돌리면 깊이만큼 왕복이 생기고, 그 왕복이 페이지를 열 때마다
 * 일어난다.
 *
 * 절단(`inherits_from_parent = false`)을 만나면 **그 노드까지만** 센다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import {
  can,
  isDefinedLevel,
  maxByCap,
  unionCaps,
  NO_CAPABILITIES,
  type CapSet,
  type Capability,
  type Grant,
  type Level,
} from './levels.ts'

/** ACL 행 중 판정에 필요한 것만. */
export type AclRow = {
  readonly node_id: string
  readonly principal_type: string
  readonly principal_id: string | null
  readonly level: string
}

export type Principal = { readonly type: string; readonly id: string | null }

/**
 * 이 세션이 가진 주체 집합 `P(U)`. 순수 함수다 — 그룹은 부르는 쪽이 읽어서 넘긴다(`principalsFor`).
 *
 * 정본:
 *   P(U) = {('user',U)} + {('group',g)} + {('teamspace',t)}
 *        + {('workspace_everyone',NULL) : U 가 role in (owner, membership_admin, member)}
 *        + {('public',NULL)}
 *
 * teamspace(7c-1)는 그 teamspace 의 멤버에게 — 사람으로 받았든 그룹을 거쳐 받았든 — `('teamspace', t)` 로 들어온다.
 *
 * `guest` 와 `restricted_member` 는 `workspace_everyone` 에 **들어가지 않는다**.
 * 그들이 보는 것은 자기에게 직접 준 것뿐이다 — 손님을 초대했더니 워크스페이스
 * 전체가 보이는 사고가 정확히 이 한 줄에서 난다. `restricted_member` 는 그룹으로는
 * 받는다(G3 — 그것이 그들의 유일한 대량 부여 수단이다).
 *
 * ★ **게스트에게는 그룹 주체를 주지 않는다**(G2). 넣는 쪽은 DB 가 막지만(0027 `tg_group_member_guard`),
 *   멤버가 떠났다 게스트로 돌아오면 M1 이 남겨 둔 그룹 행이 살아 있는 채로 남는다 — 그 행을 믿으면 게스트가
 *   그룹이 받은 페이지를 전부 본다. 판정은 행이 틀려도 틀리지 않아야 한다.
 */
export function principalsOf(
  ctx: SessionContext,
  groupIds: readonly string[] = [],
  teamspaceIds: readonly string[] = [],
): Principal[] {
  const principals: Principal[] = [{ type: 'user', id: ctx.userId }]
  if (ctx.role !== 'guest') {
    for (const id of groupIds) principals.push({ type: 'group', id })
    // 게스트는 teamspace 멤버가 될 수 없다(F-06-04). 넣는 쪽은 DB 가 막고(0028 ①), 멤버였다 게스트가 된 사람의 남은
    // 행은 여기서 무시한다 — 그룹과 같은 이유다.
    for (const id of teamspaceIds) principals.push({ type: 'teamspace', id })
  }
  if (ctx.role === 'owner' || ctx.role === 'membership_admin' || ctx.role === 'member') {
    principals.push({ type: 'workspace_everyone', id: null })
  }
  // public 은 공개 링크(F-06-06)가 생길 때 온다. 지금 넣으면 아무도 만들지 않은
  // grant 를 기다리는 코드가 된다.
  return principals
}

/**
 * 판정하는 트랜잭션 안에서 `P(U)` 를 읽는다 — 이 워크스페이스의 **살아 있는** 그룹 중 이 사람이 빠지지 않은 것.
 *
 * 세션을 발급할 때(`resolveSessionContext`) 읽어 두지 않는 이유: 협업 서버는 연결을 오래 들고 신호가 올 때마다
 * 다시 판정한다. 그룹이 컨텍스트에 박혀 있으면 그룹에서 빠진 사람의 연결이 **옛 그룹으로** 다시 판정된다.
 * 판정과 같은 스냅샷에서 읽으면 ACL 과 멤버십이 같은 시점의 사실이다.
 */
export async function principalsFor(tx: Tx, ctx: SessionContext): Promise<Principal[]> {
  const groups = await tx.query<{ id: string }>(
    `SELECT g.id
       FROM group_member gm
       JOIN "group" g ON g.id = gm.group_id
      WHERE gm.user_id = $1 AND gm.removed_at IS NULL
        AND g.workspace_id = $2 AND g.deleted_at IS NULL`,
    [ctx.userId, ctx.workspaceId],
  )
  const groupIds = groups.map((g) => g.id)
  // teamspace 는 사람으로도, 그룹을 거쳐서도 멤버가 된다(정본 §3.3 `teamspace_member.principal_type`). 보관된
  // teamspace 는 주체가 아니다 — F-06-04 *"archive 시 모든 멤버의 사이드바에서 제거"*.
  const teamspaces = await tx.query<{ id: string }>(
    `SELECT DISTINCT t.id
       FROM teamspace_member tm
       JOIN teamspace t ON t.id = tm.teamspace_id
      WHERE t.workspace_id = $2 AND t.archived_at IS NULL AND tm.removed_at IS NULL
        AND ((tm.principal_type = 'user' AND tm.principal_id = $1)
          OR (tm.principal_type = 'group' AND tm.principal_id = ANY($3::uuid[])))`,
    [ctx.userId, ctx.workspaceId, groupIds],
  )
  return principalsOf(ctx, groupIds, teamspaces.map((t) => t.id))
}

function matches(row: AclRow, principals: readonly Principal[]): boolean {
  return principals.some(
    (p) => p.type === row.principal_type && (p.id ?? null) === (row.principal_id ?? null),
  )
}

export type ResolveInput = {
  /** 대상 노드부터 루트까지. `[node, parent, …, root]` 순서다. */
  readonly chain: readonly string[]
  /** `inherits_from_parent = false` 인 노드. 여기서 위로 올라가기를 멈춘다. */
  readonly cutAt: ReadonlySet<string>
  readonly entries: readonly AclRow[]
  readonly principals: readonly Principal[]
}

/**
 * 순수 판정. DB 를 모른다.
 *
 * @returns capability 비트마스크. 아무 grant 도 없으면 `NO_CAPABILITIES` —
 *          정본의 `'none'` 이다. **없는 것이 기본값**이고, 그래서 ACL 을 잃은
 *          노드는 "모두 보임"이 아니라 "아무도 못 봄"이 된다.
 */
export function resolveCaps(input: ResolveInput): CapSet {
  let caps: CapSet = NO_CAPABILITIES

  for (const nodeId of input.chain) {
    const grants: Grant[] = input.entries
      .filter((row) => row.node_id === nodeId && matches(row, input.principals))
      // ⚠ 대상 종류를 `'page'` 로 **고정한다.** W8-a 에서 데이터베이스 블록이
      //   생겼지만 여기는 아직 그것을 구분하지 않는다.
      //
      //   되는 것: `view` · `comment` · `edit` · `full_access` — 정본 §3.3 의
      //   page 와 database 매트릭스에 **같은 이름으로 같은 capability 집합**이
      //   있으므로 판정이 같다. 그래서 표의 공유(W8-a)가 정상 동작한다.
      //
      //   안 되는 것: `edit_content` · `create` 레벨을 **데이터베이스 노드에
      //   직접 부여**하는 것. 그 둘은 database 매트릭스에만 있어서 아래
      //   `isDefinedLevel` 이 걸러낸다 — 즉 조용히 무시된다. "행은 추가하지만
      //   컬럼은 못 고치는 사람"(정본이 `create` 로 표현한 것)을 아직 만들 수 없다.
      //
      //   고치려면 `node_kind` 를 `acl_entry` 에서 읽어 여기까지 흘려야 하고,
      //   그건 별개 변경이다(HANDOFF §7).
      //
      //   teamspace 노드의 행(7c-1)도 page 매트릭스로 읽는다 — 그 행은 **그 아래 페이지가 물려받는 부여**다
      //   (정본 §3.3 [보강]). teamspace 자체의 관리(설정 · 멤버)는 ACL 이 아니라 `teamspace_member.role` 이 정한다.
      .map((row) => ({ targetKind: 'page' as const, level: row.level as Level }))
      // ★ 페이지에 정의되지 않은 레벨(`create`·`edit_content` 는 database 전용)은
      //   **없는 grant 로 본다.** `capabilitiesOf` 는 그런 조합에 던지는데, 권한
      //   경로에서 던지면 그 페이지를 아무도 못 여는 500 이 된다. 거부 쪽으로
      //   기우는 것이 맞다 — 뜻을 알 수 없는 grant 로 문을 열어주지 않는다.
      //   (DB 는 node_kind='block' 하나로 페이지와 database 를 다 담으므로
      //    CHECK 으로는 막을 수 없는 조합이다.)
      .filter((grant) => isDefinedLevel(grant.targetKind, grant.level))

    if (grants.length > 0) caps = unionCaps(caps, maxByCap(grants))

    // 절단된 노드다. 이 위의 조상은 이 노드에 아무 영향도 주지 않는다(불변식 P2).
    if (input.cutAt.has(nodeId)) break
  }

  return caps
}

// ── DB 경로 ───────────────────────────────────────────────────────────

/**
 * 사슬을 세울 행 — 노드 · 조상 배열 · **루트 블록의 부모**.
 *
 * teamspace 는 트리 노드지만 `ancestor_path` 에 들어가지 않는다 — 판결문(C-9)의 `ancestor_path` 는 *"루트(비block parent
 * 직하)→parent 까지의 block id 배열"* 이다. 그래서 어느 노드의 teamspace 는 **루트 블록(`ancestor_path[1]`, 없으면 자기)의
 * 부모**로 읽는다(B8). 같은 질의에서 루트를 붙여 읽으므로 질의 수는 늘지 않는다.
 */
type ChainRow = {
  id: string
  ancestor_path: string[]
  root_parent_type: string
  root_parent_id: string
}

const CHAIN_COLUMNS = `b.id, b.ancestor_path, r.parent_type AS root_parent_type, r.parent_id AS root_parent_id`
const CHAIN_FROM = `block b JOIN block r ON r.id = COALESCE(b.ancestor_path[1], b.id)`

/** 자신부터 위로 — `[node, parent, …, root]`, 루트가 teamspace 아래면 그 teamspace 가 끝이다. */
function chainOf(row: ChainRow): { chain: string[]; teamspaceId: string | null } {
  const teamspaceId = row.root_parent_type === 'teamspace' ? row.root_parent_id : null
  // `ancestor_path` 는 루트부터 부모까지다. 우리는 자신부터 위로 훑으므로 뒤집는다.
  const blocks = [row.id, ...[...row.ancestor_path].reverse()]
  return { chain: teamspaceId === null ? blocks : [...blocks, teamspaceId], teamspaceId }
}

/**
 * 노드 하나의 유효 권한.
 *
 * 질의는 셋이다 — 노드의 조상 배열(+ 루트의 부모) · 그 사슬의 ACL · 그 사슬의 절단 플래그. 깊이와 무관하게 셋이다
 * (주체 집합을 읽는 질의는 따로다).
 */
export async function effectiveCaps(
  tx: Tx,
  ctx: SessionContext,
  nodeId: string,
): Promise<CapSet> {
  const node = await tx.queryMaybe<ChainRow>(
    `SELECT ${CHAIN_COLUMNS} FROM ${CHAIN_FROM} WHERE b.id = $1 AND b.workspace_id = $2`,
    [nodeId, ctx.workspaceId],
  )
  if (node === null) return NO_CAPABILITIES
  const { chain, teamspaceId } = chainOf(node)
  return resolveChain(tx, await principalsFor(tx, ctx), chain, teamspaceId)
}

/**
 * teamspace **자체**의 권한 — 그 최상위에 페이지를 둘 수 있는가(`create_child`) 같은 물음. 사슬은 teamspace 하나다.
 *
 * 이 워크스페이스의 보관되지 않은 teamspace 가 아니면 아무 권한도 없다(`NO_CAPABILITIES`) — 없는 것과 같다.
 */
export async function teamspaceCaps(tx: Tx, ctx: SessionContext, teamspaceId: string): Promise<CapSet> {
  const live = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM teamspace WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
    [teamspaceId, ctx.workspaceId],
  )
  if (live === null) return NO_CAPABILITIES
  return resolveChain(tx, await principalsFor(tx, ctx), [teamspaceId], teamspaceId)
}

async function resolveChain(
  tx: Tx,
  principals: readonly Principal[],
  chain: string[],
  teamspaceId: string | null,
): Promise<CapSet> {
  const [entries, cuts] = await Promise.all([
    // teamspace 노드의 행은 `node_kind` 가 다르다 — 블록 id 와 겹칠 일은 없지만 종류까지 맞춰 읽는다.
    tx.query<AclRow>(
      `SELECT node_id, principal_type, principal_id, level
         FROM acl_entry
        WHERE (node_kind = 'block' AND node_id = ANY($1::uuid[]))
           OR (node_kind = 'teamspace' AND node_id = $2)`,
      [chain, teamspaceId],
    ),
    tx.query<{ node_id: string }>(
      `SELECT node_id FROM block_acl_meta
        WHERE node_id = ANY($1::uuid[]) AND inherits_from_parent = false`,
      [chain],
    ),
  ])

  return resolveCaps({
    chain,
    cutAt: new Set(cuts.map((c) => c.node_id)),
    entries,
    principals,
  })
}

/**
 * **이 사용자가 볼 수 있는 `perm_scope_id` 들.**
 *
 * 목록 질의(사이드바 · 휴지통 · 검색)는 노드마다 판정하지 않는다 —
 * 그러면 페이지 수만큼 질의가 생긴다. 정본이 검색에 대해 정한 모양
 * (`WHERE perm_scope_id = ANY(scopes)`)을 목록 전체에 쓴다.
 *
 * 성립하는 이유는 `perm_scope_id` 의 정의 자체다: *"N 자신 또는 가장 가까운 조상
 * 중 acl_entry 를 갖거나 절단된 노드"*. 즉 같은 스코프의 노드는 **정의상 권한이
 * 같다.** 스코프 노드의 수는 "권한을 따로 준 페이지"의 수라 보통 아주 적다.
 */
export async function readableScopes(tx: Tx, ctx: SessionContext): Promise<string[]> {
  return scopesWith(tx, ctx, ['view'])
}

/**
 * `required` capability 를 **전부** 가진 `perm_scope_id` 들 — `readableScopes` 의 일반형.
 *
 * 같은 스코프의 노드는 정의상 권한이 같으므로(위 머리말) "볼 수 있는 곳"뿐 아니라 "하위 페이지를 둘 수 있는 곳"도
 * 스코프로 거른다 — 이동 대상 목록(`listMovableTargets`)이 쓴다.
 *
 * 스코프 후보는 둘이다 — 경계인 블록(행이 있거나 끊겼다), 그리고 **teamspace**. 정본 §3.11 이 경계가 없는 노드의
 * 스코프를 *"teamspace 루트"* 로 정했으므로 teamspace 최상위의 페이지는 따로 행이 없으면 `perm_scope_id` 가 그
 * teamspace id 다(블록 id 가 아니다).
 */
export async function scopesWith(
  tx: Tx,
  ctx: SessionContext,
  required: readonly Capability[],
): Promise<string[]> {
  const [scopes, teamspaces] = await Promise.all([
    tx.query<ChainRow>(
      `SELECT DISTINCT ${CHAIN_COLUMNS}
         FROM ${CHAIN_FROM}
        WHERE b.workspace_id = $1
          AND (EXISTS (SELECT 1 FROM acl_entry a
                        WHERE a.node_kind = 'block' AND a.node_id = b.id)
            OR EXISTS (SELECT 1 FROM block_acl_meta m
                        WHERE m.node_id = b.id AND m.inherits_from_parent = false))`,
      [ctx.workspaceId],
    ),
    tx.query<{ id: string }>(`SELECT id FROM teamspace WHERE workspace_id = $1 AND archived_at IS NULL`, [
      ctx.workspaceId,
    ]),
  ])

  // 주체 집합은 한 번만 읽는다 — 스코프마다 읽으면 스코프 수만큼 질의가 는다.
  const principals = await principalsFor(tx, ctx)
  const readable: string[] = []
  const admit = async (id: string, chain: string[], teamspaceId: string | null) => {
    const caps = await resolveChain(tx, principals, chain, teamspaceId)
    if (required.every((capability) => can(caps, capability))) readable.push(id)
  }
  for (const scope of scopes) {
    const { chain, teamspaceId } = chainOf(scope)
    await admit(scope.id, chain, teamspaceId)
  }
  for (const teamspace of teamspaces) await admit(teamspace.id, [teamspace.id], teamspace.id)
  return readable
}

/** 트랜잭션 밖에서 쓰는 편의 함수. 읽기 전용이다. */
export async function canViewPage(ctx: SessionContext, pageId: string): Promise<boolean> {
  return withReadTransaction(async (tx) => can(await effectiveCaps(tx, ctx, pageId), 'view'))
}
