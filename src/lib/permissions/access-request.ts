/**
 * 접근 요청 — Teamspace · 게스트 · 그룹 7e-1조각 (F-06-15)
 *
 * 정본: 00-canonical-data-model.md §3.3 `access_request` · [보강] 접근 요청의 길 ①~⑧ · §3.8 [보강] 접근 요청의 알림
 *       06-permissions-sharing.md F-06-15 *"권한이 없거나 부족한 사용자가 스스로 요청을 보내고, 승인 권한자가 승인 · 거부하는
 *       비동기 권한 부여 경로"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 요청 → 허락 · 무시
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이 워크스페이스의 사람이 볼 수 없는 살아 있는 페이지의 주소를 열면 "권한이 없습니다"와 요청 버튼을 본다(제목은 보지 않는다).
 * 누르면 대기 중인 요청이 하나 생기고, **이름이 걸린 관리자**(`approversOf`)의 인박스로 알림이 간다. 그 페이지를 공유할 수 있는
 * 사람(`manage_perm`)은 누구든 공유 패널에서 요청을 보고 레벨을 골라 허락하거나 무시한다.
 *
 *   · **허락은 공유 설정의 부여를 거친다**(`grantAccessIn`) — 게이트 · 게스트의 레벨 상한 · 사용자 주체 규칙이 같은 한 곳에서.
 *     이미 그 사람에게 직접 준 행이 고른 레벨을 품으면 쓰지 않는다 — 허락이 권한을 낮추지 않는다
 *   · **무시는 알리지 않는다** — 무시된 뒤 하루 동안 요청한 사람에게는 "보냈습니다"로 보이고 새 요청을 받지 않는다(스팸 억제와
 *     같은 규칙이다). 하루가 지나면 다시 보낼 수 있다
 *   · 대기 중인 요청은 (페이지, 사람, 종류)마다 하나다(0033 의 부분 UNIQUE) — 다시 눌러도 새 알림이 가지 않는다
 *
 * 볼 수 없는 페이지에 요청을 받는다는 것은 **그 id 의 페이지가 있다**를 알려 준다는 뜻이다. 그 말은 이 워크스페이스의 사람에게만
 * (세션이 0단계를 지났다) · 주소를 가진 사람에게만 하고, 제목은 싣지 않는다(정본 [보강] ②). 휴지통 · 다른 워크스페이스 · 없는
 * id 는 여전히 없는 페이지다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 종류는 둘이다 — 무엇이 없어서 요청하는가 (7e-2)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   `page_access` — 볼 수 없는 사람이 요청 화면에서(7e-1). 볼 수 있게 되면 필요 없다
 *   `edit_access` — **볼 수는 있지만 고칠 수 없는** 사람(읽기 · 댓글)이 공유 패널에서(7e-2 · F-06-15 *"Request edit access"*).
 *                   요청 레벨은 편집이다. 고칠 수 있게 되면 필요 없다. 볼 수 없는 사람은 이 종류로 요청하지 못한다(`not_found` —
 *                   요청 화면의 `page_access` 가 그 길이다)
 *
 * 둘은 같은 문을 지난다 — 열린 요청(종류마다) · 알림 받는 사람 · 목록 · 처리 · 쿨다운. 갈라지는 곳은 `SATISFIED_BY`(무엇을
 * 가졌으면 요청이 필요 없는가)와 `REQUESTED_LEVEL` 둘뿐이다.
 *
 * 워크스페이스 밖의 사람의 요청은 뒤의 조각이다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { notifyAccessGranted, notifyAccessRequested } from '../notification/fanout.ts'
import { grantAccessIn, shareGateIn } from './acl.ts'
import { effectiveCaps, membersWith, namedManagersOf } from './effective.ts'
import { can, capabilitiesOf, isDefinedLevel, unionCaps, type Capability, type Level } from './levels.ts'

/** 무시된 요청 뒤 새 요청을 받지 않는 시간(정본 [보강] 접근 요청 ③). */
export const REREQUEST_AFTER_IGNORE_HOURS = 24

/** 이 조각들이 다루는 요청 종류(머리말). 정본의 나머지 셋(가입 · 멤버 추가 · 게스트 추가)은 아직 없다. */
export const ACCESS_REQUEST_KINDS = ['page_access', 'edit_access'] as const
export type AccessRequestKind = (typeof ACCESS_REQUEST_KINDS)[number]

export function isAccessRequestKind(raw: unknown): raw is AccessRequestKind {
  return typeof raw === 'string' && (ACCESS_REQUEST_KINDS as readonly string[]).includes(raw)
}

/** 이것을 가졌으면 그 종류의 요청은 필요 없다 — 요청을 받을지 · 목록에 세울지를 이것으로 가른다. */
const SATISFIED_BY: Readonly<Record<AccessRequestKind, Capability>> = {
  page_access: 'view',
  edit_access: 'edit_content',
}

/** 요청한 레벨 — 접근 요청은 고르지 않는다(허락하는 사람이 고른다), 편집 요청은 편집이다. 허락할 때의 기본값이 된다. */
const REQUESTED_LEVEL: Readonly<Record<AccessRequestKind, Level | null>> = {
  page_access: null,
  edit_access: 'edit',
}

/** 허락할 때 고를 수 있는 레벨 — 페이지의 네 레벨. 게스트에게 전체 권한은 `grantAccessIn` 이 거부한다(`guest_level`). */
export const APPROVE_LEVELS = ['view', 'comment', 'edit', 'full_access'] as const
export type ApproveLevel = (typeof APPROVE_LEVELS)[number]

function isApproveLevel(raw: unknown): raw is ApproveLevel {
  return typeof raw === 'string' && (APPROVE_LEVELS as readonly string[]).includes(raw)
}

/**
 * 요청의 대상이 될 수 있는 페이지인가 — 이 워크스페이스의 **살아 있는** 페이지. 휴지통의 페이지는 없는 페이지와 같다(정본
 * [보강] ⑧). **보관된 teamspace 의 페이지도 아니다** — 아무도 못 보고 되살릴 사람만 그 존재를 본다(정본 §3.3 [보강]
 * `teamspace.archived_at` · 7c-6). 요청 화면이 그 존재를 알리면 안 되고, 허락할 사람도 없다. 데이터베이스는 아직 아니다 — 그
 * 화면(`/db/…`)은 이 조각이 건드리지 않는다.
 */
async function livePage(tx: Tx, ctx: SessionContext, pageId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one
       FROM block b
       JOIN block r ON r.id = COALESCE(b.ancestor_path[1], b.id)
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = 'page' AND b.lifecycle = 'live'
        AND NOT EXISTS (SELECT 1 FROM teamspace t
                         WHERE r.parent_type = 'teamspace' AND t.id = r.parent_id AND t.archived_at IS NOT NULL)`,
    [pageId, ctx.workspaceId],
  )
  return row !== null
}

/**
 * 이 사람의 이 페이지 요청(그 종류)이 열려 있는가 — 대기 중이거나, **하루 안에 무시됐거나**. 둘 다 요청한 사람에게는
 * "보냈습니다"다(무시를 드러내지 않는다 · 머리말).
 */
async function hasOpenRequest(tx: Tx, ctx: SessionContext, pageId: string, kind: AccessRequestKind): Promise<boolean> {
  const row = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM access_request
      WHERE workspace_id = $1 AND node_id = $2 AND requester_id = $3 AND kind = $5
        AND (status = 'pending'
          OR (status = 'ignored' AND decided_at > now() - make_interval(hours => $4)))
      LIMIT 1`,
    [ctx.workspaceId, pageId, ctx.userId, REREQUEST_AFTER_IGNORE_HOURS, kind],
  )
  return row !== null
}

/**
 * 이 종류의 요청을 받을 수 있는 사람인가 — 요청할 것이 있으면 null, 아니면 거부 사유.
 *
 *   page_access — 볼 수 있으면 `has_access`
 *   edit_access — 볼 수 없으면 `not_found`(그 사람의 길은 요청 화면의 접근 요청이다 — 공유 패널의 요청 API 가 요청 화면과 다른
 *                 말을 하지 않는다), 고칠 수 있으면 `has_access`
 */
async function requestGate(
  tx: Tx,
  ctx: SessionContext,
  pageId: string,
  kind: AccessRequestKind,
): Promise<AccessRequestFailure | null> {
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (kind === 'edit_access' && !can(caps, 'view')) return 'not_found'
  return can(caps, SATISFIED_BY[kind]) ? 'has_access' : null
}

export type NoAccessState = {
  /** 이미 요청했는가(대기 중 · 하루 안에 무시됨) — 화면은 버튼 대신 "보냈습니다"를 보인다. */
  readonly requested: boolean
}

/**
 * 볼 수 없는 페이지를 열었을 때의 화면 상태. **요청할 수 있는 페이지가 아니면 null** — 없는 페이지 · 휴지통 · 다른 워크스페이스
 * (그 화면은 404 다), 그리고 이미 볼 수 있는 페이지(부르는 쪽이 페이지를 그린다).
 */
export async function noAccessState(ctx: SessionContext, pageId: string): Promise<NoAccessState | null> {
  return requestState(ctx, pageId, 'page_access')
}

/**
 * 공유 패널의 "편집 권한 요청"(7e-2) 상태. **요청할 수 없으면 null** — 볼 수 없거나(패널에 오지 않는다) 이미 고칠 수 있다(관리자
 * 포함) · 살아 있는 페이지가 아니다.
 */
export async function editRequestState(ctx: SessionContext, pageId: string): Promise<NoAccessState | null> {
  return requestState(ctx, pageId, 'edit_access')
}

async function requestState(ctx: SessionContext, pageId: string, kind: AccessRequestKind): Promise<NoAccessState | null> {
  return withReadTransaction(async (tx) => {
    if (!(await livePage(tx, ctx, pageId))) return null
    if ((await requestGate(tx, ctx, pageId, kind)) !== null) return null
    return { requested: await hasOpenRequest(tx, ctx, pageId, kind) }
  })
}

export type AccessRequestFailure =
  /** 요청할 수 있는 페이지가 아니다 — 없거나 · 휴지통이거나 · 다른 워크스페이스 · (편집 요청인데) 볼 수 없다. */
  | 'not_found'
  /** 이미 가졌다 — 볼 수 있다(접근 요청) · 고칠 수 있다(편집 요청). 요청할 것이 없다. */
  | 'has_access'

export type AccessRequestResult =
  | {
      readonly ok: true
      /** `sent` — 이번에 새 요청을 만들었는가. 이미 열려 있으면 false 이고 알림도 다시 가지 않는다(화면은 둘 다 "보냈습니다"). */
      readonly value: { readonly sent: boolean }
    }
  | { readonly ok: false; readonly reason: AccessRequestFailure }

/** 이 페이지의 접근을 요청한다(`page_access` · 요청 화면). */
export async function requestPageAccess(ctx: SessionContext, pageId: string): Promise<AccessRequestResult> {
  return requestAccess(ctx, pageId, 'page_access')
}

/** 이 페이지의 편집 권한을 요청한다(`edit_access` · 공유 패널 · 7e-2). */
export async function requestEditAccess(ctx: SessionContext, pageId: string): Promise<AccessRequestResult> {
  return requestAccess(ctx, pageId, 'edit_access')
}

/**
 * 요청을 만든다. 알림은 요청과 같은 트랜잭션에서 관리자들에게 간다.
 *
 * 이미 열린 요청(같은 종류 · 대기 · 하루 안에 무시됨)이 있으면 새로 쓰지 않는다. 동시에 두 번 눌러도 부분 UNIQUE 가 하나만
 * 남긴다(`ON CONFLICT DO NOTHING` — 늦은 쪽은 `sent: false`).
 */
export async function requestAccess(
  ctx: SessionContext,
  pageId: string,
  kind: AccessRequestKind,
): Promise<AccessRequestResult> {
  return withCommandTransaction(async (tx) => {
    if (!(await livePage(tx, ctx, pageId))) return { ok: false, reason: 'not_found' } as const
    const refused = await requestGate(tx, ctx, pageId, kind)
    if (refused !== null) return { ok: false, reason: refused } as const
    if (await hasOpenRequest(tx, ctx, pageId, kind)) return { ok: true, value: { sent: false } } as const

    const row = await tx.queryMaybe<{ id: string }>(
      `INSERT INTO access_request (id, workspace_id, kind, node_id, requester_id, requested_level, status, created_at)
       VALUES ($1, $2, $5, $3, $4, $6, 'pending', now())
       ON CONFLICT (node_id, requester_id, kind) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [randomUUID(), ctx.workspaceId, pageId, ctx.userId, kind, REQUESTED_LEVEL[kind]],
    )
    if (row === null) return { ok: true, value: { sent: false } } as const

    await notifyAccessRequested(tx, ctx, {
      pageId,
      requestId: row.id,
      recipients: await approversOf(tx, ctx.workspaceId, pageId),
    })
    return { ok: true, value: { sent: true } } as const
  })
}

/**
 * 요청의 알림을 받을 관리자(정본 [보강] 접근 요청 ⑤) — **이름이 걸린** 사람 중 지금 그 페이지를 공유할 수 있는 사람.
 *
 *   후보 = 사슬에서 사람에게 직접 공유를 품은 레벨을 준 행의 그 사람들(`namedManagersOf`) + 페이지를 만든 사람
 *   없으면 워크스페이스 owner 중 공유할 수 있는 사람
 *
 * 공유 권한을 가진 사람 **전원**이 아니다 — 워크스페이스 최상위 페이지는 모두가 전체 권한이라 요청 하나가 멤버 전원의 인박스로
 * 간다. 알림을 받지 못한 공유 가능자도 공유 패널에서 요청을 본다.
 */
async function approversOf(tx: Tx, workspaceId: string, pageId: string): Promise<string[]> {
  const page = await tx.queryOne<{ created_by: string | null }>(`SELECT created_by FROM block WHERE id = $1`, [pageId])
  const named = new Set(await namedManagersOf(tx, workspaceId, pageId))
  if (page.created_by !== null) named.add(page.created_by)
  const holding = async (candidates: readonly string[]) =>
    [...((await membersWith(tx, workspaceId, [pageId], 'manage_perm', candidates)).get(pageId) ?? [])]

  const approvers = await holding([...named])
  if (approvers.length > 0) return approvers
  const owners = await tx.query<{ user_id: string }>(
    `SELECT user_id FROM workspace_member WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'`,
    [workspaceId],
  )
  return holding(owners.map((o) => o.user_id))
}

/** 공유 패널에 서는 대기 중인 요청 한 줄. */
export type PendingAccessRequest = {
  readonly id: string
  readonly requesterId: string
  readonly name: string
  readonly email: string | null
  /** 요청한 사람이 게스트인가 — 화면이 전체 권한을 고를 수 없게 한다(서버는 `grantAccessIn` 이 거부한다). */
  readonly guest: boolean
  readonly kind: AccessRequestKind
  /** 요청한 레벨 — 편집 요청은 `edit`, 접근 요청은 null. 화면이 허락할 레벨의 기본값으로 쓴다. */
  readonly requestedLevel: Level | null
  readonly createdAt: Date
}

export type AccessRequestListResult =
  | { readonly ok: true; readonly value: PendingAccessRequest[] }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' }

/**
 * 이 페이지의 대기 중인 요청 — 그 페이지를 공유할 수 있는 사람에게만(공유 설정의 게이트 그대로). 오래된 것부터.
 *
 * **세우지 않는 것**(정본 [보강] ⑦): 이미 가진 사람의 요청 — 볼 수 있게 된 사람의 접근 요청 · 고칠 수 있게 된 사람의 편집 요청
 * (판정과 같은 규칙으로 센다 — `membersWith`) · 워크스페이스를 떠난 사람의 요청. 상태를 바꾸지 않고 읽을 때 거른다 — 다시 잃으면
 * 그 요청이 다시 선다.
 */
export async function listAccessRequests(ctx: SessionContext, pageId: string): Promise<AccessRequestListResult> {
  return withReadTransaction(async (tx) => {
    if (!(await livePage(tx, ctx, pageId))) return { ok: false, reason: 'not_found' } as const
    const denied = await shareGateIn(tx, ctx, pageId)
    if (denied !== null) return { ok: false, reason: denied } as const

    const rows = await tx.query<{
      id: string
      requester_id: string
      name: string
      email: string | null
      role: string
      kind: AccessRequestKind
      requested_level: Level | null
      created_at: Date
    }>(
      `SELECT r.id, r.requester_id, u.name, ue.email::text AS email, m.role, r.kind, r.requested_level, r.created_at
         FROM access_request r
         JOIN workspace_member m
           ON m.workspace_id = r.workspace_id AND m.user_id = r.requester_id AND m.status IN ('active', 'suspended')
         JOIN "user" u ON u.id = r.requester_id
         LEFT JOIN user_email ue ON ue.id = u.primary_email_id
        WHERE r.workspace_id = $1 AND r.node_id = $2 AND r.kind = ANY($3::text[]) AND r.status = 'pending'
        ORDER BY r.created_at, r.id`,
      [ctx.workspaceId, pageId, ACCESS_REQUEST_KINDS],
    )
    if (rows.length === 0) return { ok: true, value: [] } as const

    // 종류마다 "이미 가진 사람" — 그 종류로 요청한 사람들만 센다.
    const satisfied = new Map<AccessRequestKind, Set<string>>()
    for (const kind of ACCESS_REQUEST_KINDS) {
      const askers = rows.filter((r) => r.kind === kind).map((r) => r.requester_id)
      const holders =
        askers.length === 0 ? undefined : (await membersWith(tx, ctx.workspaceId, [pageId], SATISFIED_BY[kind], askers)).get(pageId)
      satisfied.set(kind, holders ?? new Set())
    }
    return {
      ok: true,
      value: rows
        .filter((r) => !satisfied.get(r.kind)?.has(r.requester_id))
        .map((r) => ({
          id: r.id,
          requesterId: r.requester_id,
          name: r.name,
          email: r.email,
          guest: r.role === 'guest',
          kind: r.kind,
          requestedLevel: r.requested_level,
          createdAt: r.created_at,
        })),
    } as const
  })
}

export type AccessDecisionFailure =
  /** 그런 요청이 없다 — 또는 그 페이지를 볼 수 없다(없는 요청과 같다) · 휴지통이다. */
  | 'not_found'
  /** 그 페이지를 볼 수는 있지만 공유할 수 없다. */
  | 'forbidden'
  /** 이미 누군가 처리했다(허락 · 무시). */
  | 'decided'
  /** 페이지의 네 레벨이 아니다. */
  | 'invalid_level'
  /** 게스트에게 전체 권한을 주려 했다(`grantAccessIn`). */
  | 'guest_level'
  /** 요청한 사람이 이제 이 워크스페이스에 없다(`grantAccessIn` — 떠난 사람에게 주지 않는다). */
  | 'invalid_principal'

export type AccessDecisionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: AccessDecisionFailure }

type LockedRequest = { id: string; node_id: string; requester_id: string; status: string }

/**
 * 처리할 요청을 잠그고 게이트를 묻는다 — 순서는 **요청 → 페이지가 살아 있나 → 공유 게이트 → 상태**. 게이트가 상태보다 먼저다:
 * 공유할 수 없는 사람에게 "이미 처리됨"을 말하면 그 요청의 사정을 알려 준다. 잠금은 두 사람이 동시에 처리할 때 줄을 세운다.
 */
async function openDecision(
  tx: Tx,
  ctx: SessionContext,
  requestId: string,
): Promise<{ ok: true; request: LockedRequest } | { ok: false; reason: AccessDecisionFailure }> {
  const request = await tx.queryMaybe<LockedRequest>(
    `SELECT id, node_id, requester_id, status FROM access_request
      WHERE id = $1 AND workspace_id = $2 AND kind = ANY($3::text[])
      FOR UPDATE`,
    [requestId, ctx.workspaceId, ACCESS_REQUEST_KINDS],
  )
  if (request === null || !(await livePage(tx, ctx, request.node_id))) return { ok: false, reason: 'not_found' }
  const denied = await shareGateIn(tx, ctx, request.node_id)
  if (denied !== null) return { ok: false, reason: denied }
  if (request.status !== 'pending') return { ok: false, reason: 'decided' }
  return { ok: true, request }
}

async function decide(tx: Tx, ctx: SessionContext, requestId: string, status: 'approved' | 'ignored'): Promise<void> {
  await tx.query(`UPDATE access_request SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [
    requestId,
    status,
    ctx.userId,
  ])
}

/**
 * 요청을 허락한다 — 고른 레벨을 그 사람에게 준다(공유 설정의 부여를 거친다). 요청한 사람의 인박스로 알림이 간다.
 *
 * **허락은 권한을 낮추지 않는다**(정본 [보강] ⑥): 그 사람에게 이 페이지에 직접 준 행이 이미 고른 레벨을 품으면(capability
 * 부분집합 — 레벨을 정수로 비교하지 않는다 · A2) 쓰지 않는다. 부여가 거부되면(게스트의 전체 권한 · 떠난 사람) 아무것도 바뀌지
 * 않는다 — 요청은 대기 중으로 남는다.
 *
 * @returns `granted` — 이번에 부여를 썼는가(이미 품고 있었으면 false).
 */
export async function approveAccessRequest(
  ctx: SessionContext,
  requestId: string,
  rawLevel: unknown,
): Promise<AccessDecisionResult<{ readonly granted: boolean }>> {
  if (!isApproveLevel(rawLevel)) return { ok: false, reason: 'invalid_level' }
  const level: Level = rawLevel

  return withCommandTransaction(async (tx) => {
    const opened = await openDecision(tx, ctx, requestId)
    if (!opened.ok) return opened
    const { request } = opened

    const direct = await tx.queryMaybe<{ level: string }>(
      `SELECT level FROM acl_entry
        WHERE node_kind = 'block' AND node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [request.node_id, request.requester_id],
    )
    const want = capabilitiesOf('page', level)
    const have =
      direct !== null && isDefinedLevel('page', direct.level as Level) ? capabilitiesOf('page', direct.level as Level) : null
    const covered = have !== null && unionCaps(have, want) === have

    if (!covered) {
      const granted = await grantAccessIn(tx, ctx, request.node_id, { type: 'user', id: request.requester_id }, level)
      if (!granted.ok) return { ok: false, reason: granted.reason as AccessDecisionFailure } as const
    }
    await decide(tx, ctx, request.id, 'approved')
    await notifyAccessGranted(tx, ctx, { pageId: request.node_id, requestId: request.id, requesterId: request.requester_id })
    return { ok: true, value: { granted: !covered } } as const
  })
}

/** 요청을 무시한다 — 아무것도 주지 않고, 요청한 사람에게 알리지 않는다(머리말). */
export async function ignoreAccessRequest(ctx: SessionContext, requestId: string): Promise<AccessDecisionResult<null>> {
  return withCommandTransaction(async (tx) => {
    const opened = await openDecision(tx, ctx, requestId)
    if (!opened.ok) return opened
    await decide(tx, ctx, opened.request.id, 'ignored')
    return { ok: true, value: null } as const
  })
}
