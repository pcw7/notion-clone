/**
 * 게스트 — Teamspace · 게스트 · 그룹 7d-1조각 (F-06-09)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 게스트를 들이는 길 · `workspace_member.role='guest'` · 불변식 M2 · G2
 *       06-permissions-sharing.md F-06-09 *"페이지 Share 에서 외부 이메일 입력 → 게스트로 추가"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 게스트는 페이지에서 생긴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 워크스페이스 초대(`invite.ts`)는 워크스페이스 역할 셋만 받는다 — 게스트는 워크스페이스에 들어오는 사람이 아니라 **페이지를
 * 받는 사람**이기 때문이다. 그래서 게스트를 들이는 길은 페이지의 공유다: 그 페이지를 공유할 수 있는 사람(`manage_perm`)이
 * 이메일과 레벨을 주면, 한 트랜잭션에서 **페이지 부여와 멤버십을 함께** 쓴다. 부여가 거부되면(권한 · 레벨) 멤버십도 남지 않는다
 * — 공유 게이트를 먼저 묻고(멤버십을 쓰기 전), 그 뒤의 거부는 트랜잭션이 되돌린다. 멤버십이 부여보다 앞서는 까닭: 공유의 사용자
 * 주체는 이 워크스페이스의 사람이어야 한다(`acl.ts` `isPerson` · 7d-2).
 *
 *   · **있는 계정은 수락 없이 곧바로.** 이메일은 **검증된** 주소로 찾는다(미검증 주소는 누구나 등록할 수 있다 — 워크스페이스
 *     초대의 수락과 같은 규칙). **없으면 대기 초대를 남긴다**(7g-1 · `as: 'pending'`) — 워크스페이스 초대의 한 종류(`role='guest'`
 *     + 페이지 · 레벨)로, 받는 사람이 메일의 링크로 가입해 받아들이면 그때 멤버십과 부여를 쓴다(`invite.ts` `acceptInvite`)
 *   · 그 사람이 **이미 멤버**면 역할을 건드리지 않고 부여만 한다(`as: 'member'`). 이미 게스트면 부여만, 떠났던 사람은 게스트로
 *     돌아온다(M1 의 행을 되살린다). 멈춘 사람은 들이지 않는다(`unavailable`)
 *   · **레벨은 편집까지**(`GUEST_LEVELS`) — 전체 권한은 공유를 품는다. 공유 패널의 사람 부여도 같은 규칙(`acl.ts` `guest_level`)
 *
 * 게스트는 좌석을 소비하지 않고(M2) 기본 teamspace 에 들어가지 않는다(`DEFAULT_TEAMSPACE_ROLES`). 한도(`plan_entitlement`)와
 * 정책(`security_policy`)은 그 표가 생길 때 여기에 건다(HANDOFF §7).
 */

import { randomBytes } from 'node:crypto'

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { query } from '../db/pool.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { dropGrantsOf, grantAccessIn, shareGateIn, type AclFailure } from '../permissions/acl.ts'
import { hashInviteToken, INVITE_TTL_DAYS } from './invite.ts'
import { joinDefaultTeamspaces } from './teamspace.ts'

/** 게스트에게 줄 수 있는 레벨 — 편집까지(머리말). 좁은 것부터. */
export const GUEST_LEVELS = ['view', 'comment', 'edit'] as const
export type GuestLevel = (typeof GUEST_LEVELS)[number]

export type GuestInviteFailure =
  | Exclude<AclFailure, 'would_orphan' | 'invalid_principal'>
  /** 이메일의 모양이 아니다. */
  | 'invalid_email'
  /** 게스트에게 줄 수 없는 레벨이다(편집까지). */
  | 'invalid_level'
  /** 그 사람의 멤버십이 멈춰 있다(`suspended`). */
  | 'unavailable'
  /** 요금제의 게스트 한도에 닿았다(`guests.max` · 8k-2) — 새 게스트만 막는다. 이미 게스트인 사람에게 페이지를 더 주는 것은 된다. */
  | 'guest_limit'

export type GuestInviteResult =
  | {
      readonly ok: true
      readonly value:
        | {
            readonly userId: string
            /** 받은 사람이 무엇으로 받았는가 — 이미 멤버면 `member`(역할을 건드리지 않았다), 아니면 `guest`. */
            readonly as: 'member' | 'guest'
            /** 이번에 워크스페이스에 들어왔는가(새 게스트 · 떠났다 돌아온 사람). */
            readonly joined: boolean
          }
        | {
            /** 계정이 없다 — 대기 초대를 남겼다(7g-1). 받아들이면 그때 들어온다. */
            readonly as: 'pending'
            readonly email: string
            /** 메일에 실을 수락 토큰 — 원문은 여기와 메일에만 있다(DB 에는 해시). 라우트가 메일로 보내고 응답에 싣지 않는다. */
            readonly token: string
          }
    }
  | { readonly ok: false; readonly reason: GuestInviteFailure }

const fail = (reason: GuestInviteFailure) => ({ ok: false, reason }) as const

function isGuestLevel(raw: unknown): raw is GuestLevel {
  return typeof raw === 'string' && (GUEST_LEVELS as readonly string[]).includes(raw)
}

/** 이메일의 모양 — 공백 없는 `x@y`. 나머지(있는 주소인가)는 계정을 찾으며 안다. 비교는 citext 가 대소문자를 무시한다. */
export function normalizeGuestEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim()
  if (email.length === 0 || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) return null
  return email
}

/**
 * 이메일로 페이지를 준다 — 그 사람이 이 워크스페이스에 없으면 **게스트로 들인다**(머리말).
 *
 * 순서: 모양 → 계정 → **공유 게이트**(`manage_perm` — 쓰지 않는다) → 멤버십 → 부여(게스트 레벨 규칙이 여기서 걸린다). 부여가
 * 거부되면 `withCommandTransaction` 이 되돌리므로 멤버십이 남지 않는다 — 게이트가 먼저라 권한 없는 사람의 거부는 쓰기 전에 난다. 멤버십이 바뀌면 그 사람의 권한 세대와 워크스페이스의
 * `acl_epoch` 를 올린다(`acceptInvite` 와 같다) — 협업 신호는 `workspace_member` 의 트리거가 나른다(0016).
 */
export async function inviteGuestToPage(
  ctx: SessionContext,
  pageId: string,
  rawEmail: unknown,
  rawLevel: unknown,
): Promise<GuestInviteResult> {
  const email = normalizeGuestEmail(rawEmail)
  if (email === null) return fail('invalid_email')
  if (!isGuestLevel(rawLevel)) return fail('invalid_level')
  const level = rawLevel

  return withCommandTransaction(async (tx) => {
    const account = await tx.queryMaybe<{ user_id: string }>(
      `SELECT ue.user_id
         FROM user_email ue
         JOIN "user" u ON u.id = ue.user_id AND u.deleted_at IS NULL
        WHERE ue.email = $1 AND ue.verified_at IS NOT NULL`,
      [email],
    )
    const target = account?.user_id ?? null
    const membership =
      target === null
        ? null
        : await tx.queryMaybe<{ role: string; status: string }>(
            `SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
            [ctx.workspaceId, target],
          )

    // 줄 사람이 없거나(계정 없음) 줄 수 없으면(멈춤) 부여를 쓰지 않는다 — 그래도 **이 페이지를 공유할 수 없는 사람에게는 그 말부터**
    // 한다. 공유할 수 없는 사람이 이메일을 넣어 보며 계정이 있는지 알아내면 안 된다.
    if (target === null || membership?.status === 'suspended') {
      const denied = await shareGateIn(tx, ctx, pageId)
      if (denied !== null) return fail(denied)
      if (target !== null) return fail('unavailable')
      // 계정이 없다 — 대기 초대를 남긴다(7g-1). 받아들일 때 멤버십 → 부여를 한 트랜잭션에 쓴다(`acceptInvite`). 대기 초대는 게스트
      // 한도의 자리를 미리 잡는다 — 받아들일 때는 다시 묻지 않는다(8k-2).
      if (!(await guestRoomIn(tx, ctx.workspaceId, { email }))) return fail('guest_limit')
      const token = await pendGuestInvite(tx, ctx, pageId, email, level)
      return { ok: true, value: { as: 'pending', email, token } } as const
    }

    const denied = await shareGateIn(tx, ctx, pageId)
    if (denied !== null) return fail(denied)

    const active = membership !== null && membership.status === 'active'
    const alreadyMember = active && membership.role !== 'guest'
    const give = async () => {
      const granted = await grantAccessIn(tx, ctx, pageId, { type: 'user', id: target }, level)
      return granted.ok ? null : fail(granted.reason as GuestInviteFailure)
    }
    if (active) {
      return (await give()) ?? ({ ok: true, value: { userId: target, as: alreadyMember ? 'member' : 'guest', joined: false } } as const)
    }

    // 새로 들어오거나(행 없음) 돌아온다(removed · invited) — 게스트로. 멤버를 게스트로 내리는 일은 위에서 걸렀다(active).
    const admitted = await admitGuestIn(tx, ctx, target, 'invite_email')
    if (admitted !== null) return fail(admitted)
    return (await give()) ?? ({ ok: true, value: { userId: target, as: 'guest', joined: true } } as const)
  })
}

/** 게스트로 들어온 길 — 이메일로 공유받았다(7d-1) · 접근 요청을 허락받았다(7g-2). */
export type GuestJoinMethod = 'invite_email' | 'access_request'

/**
 * 이 워크스페이스의 사람이 아닌 사람을 **게스트로 들인다** — 멤버십 행을 쓰거나(처음) 되살린다(떠났던 · 초대만 받은 사람). 들어온
 * 길을 남기고 권한 세대를 올린다. 게스트를 들이는 길(이메일 공유 · 접근 요청의 허락)이 모두 이것을 지난다 — **게스트 한도**
 * (`guests.max` · 8k-2)를 여기서 묻는다(넘으면 아무것도 쓰지 않고 `guest_limit`). 정책(`allow_member_invite_guests`)도 여기에 건다(뒤의 조각).
 *
 * **부여는 부르는 쪽이 곧바로 같은 트랜잭션에서 쓴다** — 부여 없이 들어온 게스트가 생기지 않게(정본 [보강] 게스트 ①). 부여가
 * 거부되면 `withCommandTransaction` 이 이 멤버십도 되돌린다. 이미 이 워크스페이스의 사람(active · suspended)은 부르는 쪽이 걸렀다
 * — 여기서도 그런 행은 건드리지 않고 던진다(멤버를 게스트로 내리지 않는다 · 멈춘 사람을 되살리지 않는다).
 */
export async function admitGuestIn(
  tx: Tx,
  ctx: SessionContext,
  userId: string,
  joinMethod: GuestJoinMethod,
): Promise<'guest_limit' | null> {
  if (!(await guestRoomIn(tx, ctx.workspaceId, { userId }))) return 'guest_limit'
  const row = await tx.queryMaybe<{ user_id: string }>(
    `INSERT INTO workspace_member (workspace_id, user_id, role, status, join_method, invited_by, invited_at, accepted_at)
     VALUES ($1, $2, 'guest', 'active', $4, $3, now(), now())
     ON CONFLICT (workspace_id, user_id) DO UPDATE
        SET role = 'guest', status = 'active', removed_at = NULL, join_method = EXCLUDED.join_method,
            invited_by = EXCLUDED.invited_by, invited_at = now(), accepted_at = now()
      WHERE workspace_member.status IN ('invited', 'removed')
     RETURNING user_id`,
    [ctx.workspaceId, userId, ctx.userId, joinMethod],
  )
  if (row === null) throw new Error('이미 이 워크스페이스의 사람이다 — 게스트로 들이지 않는다')
  await membershipChanged(tx, ctx, userId)
  return null
}

/** 게스트 한도가 세는 것(8k-2) — 활성 게스트 · 받아들이지 않은 게스트 초대의 이메일. 판정(`guestRoomIn`)과 개요(`guestSeatsUsed`)가 같이 쓴다. */
const GUEST_SEATS = `guests AS (
       SELECT m.user_id FROM workspace_member m WHERE m.workspace_id = $1 AND m.role = 'guest' AND m.status = 'active'
     ), pending AS (
       SELECT DISTINCT lower(i.email) AS email FROM workspace_invite i
        WHERE i.workspace_id = $1 AND i.role = 'guest' AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > now()
     )`

/** 지금 쓴 게스트 자리(8k-3 — 설정의 요금제 절) · 한도 판정과 같은 셈. */
export async function guestSeatsUsed(workspaceId: string): Promise<number> {
  const rows = await query<{ used: number }>(
    `WITH ${GUEST_SEATS} SELECT (SELECT count(*) FROM guests)::int + (SELECT count(*) FROM pending)::int AS used`,
    [workspaceId],
  )
  return rows[0]?.used ?? 0
}

/**
 * 게스트 한도의 자리가 있는가(8k-2 · `guests.max`) — 이 사람(또는 이메일)을 새로 세어도 한도 안인가. 무제한이면 늘 있다.
 *
 * 세는 것은 **활성 게스트 + 받아들이지 않은 게스트 초대의 이메일**이다 — 대기 초대는 자리를 미리 잡는다(받아들일 때 다시 묻지 않아,
 * 초대받은 사람이 링크를 열었는데 막히는 일이 없다). 같은 이메일의 대기 초대가 여럿이어도(페이지마다) 한 사람이다. 이미 세어진
 * 사람(활성 게스트 · 대기 중인 그 이메일)을 다시 들이는 것은 자리를 더 쓰지 않는다.
 *
 * 워크스페이스마다 advisory 잠금으로 줄을 세운다 — 한도 바로 밑에서 두 초대가 함께 통과하지 않게. 내려도 이미 있는 게스트는 그대로다
 * (13 *"이미 초대된 게스트를 쫓아낼 수는 없다 → 신규 초대만 차단"*).
 */
export async function guestRoomIn(
  tx: Tx,
  workspaceId: string,
  who: { readonly userId?: string; readonly email?: string },
): Promise<boolean> {
  const limit = await entitlement(workspaceId, 'guests.max', tx)
  if (limit === null) return true
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('guest-seats:' || $1, 0))`, [workspaceId])
  const row = await tx.queryOne<{ used: number; counted: boolean }>(
    `WITH ${GUEST_SEATS}
     SELECT (SELECT count(*) FROM guests)::int + (SELECT count(*) FROM pending)::int AS used,
            (EXISTS (SELECT 1 FROM guests WHERE user_id = $2::uuid)
              OR EXISTS (SELECT 1 FROM pending WHERE email = lower($3::text))) AS counted`,
    [workspaceId, who.userId ?? null, who.email ?? null],
  )
  return row.counted || row.used < limit
}

/**
 * 게스트의 대기 초대를 남긴다(7g-1) — (페이지, 이메일)마다 하나. 이미 있으면(만료된 것도) 레벨 · 토큰 · 만료를 새로 쓴다 — 옛 메일의
 * 링크는 죽는다(워크스페이스 초대가 역할을 바꿀 때와 같다). 동시에 두 번 초대해도 부분 UNIQUE(0035)에 기대는 한 문장이라 하나다.
 *
 * @returns 수락 토큰의 원문 — DB 에는 해시만 남는다(`hashInviteToken`).
 */
async function pendGuestInvite(tx: Tx, ctx: SessionContext, pageId: string, email: string, level: GuestLevel): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await tx.query(
    `INSERT INTO workspace_invite
       (id, workspace_id, kind, email, token_hash, role, created_by, created_at, expires_at, page_id, page_level)
     VALUES (gen_random_uuid(), $1, 'email', $2, $3, 'guest', $4, now(), now() + ($5 || ' days')::interval, $6, $7)
     ON CONFLICT (page_id, email) WHERE role = 'guest' AND revoked_at IS NULL AND accepted_at IS NULL
     DO UPDATE SET page_level = EXCLUDED.page_level, token_hash = EXCLUDED.token_hash, created_by = EXCLUDED.created_by,
                   created_at = now(), expires_at = EXCLUDED.expires_at`,
    [ctx.workspaceId, email, hashInviteToken(token), ctx.userId, String(INVITE_TTL_DAYS), pageId, level],
  )
  return token
}

// ── owner 의 게스트 관리 (7d-3) ──────────────────────────────────────

/**
 * 게스트를 보고 · 멤버로 올리고 · 뺄 수 있는 워크스페이스 역할인가 — 역할 **이름**으로 묻는다(CLAUDE.md). 워크스페이스 초대를
 * 보낼 수 있는 역할(`invite.ts` 의 owner · membership_admin)과 같다 — 사람을 들이고 내보내는 일이다.
 */
export function canManageGuests(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'membership_admin'
}

export type GuestManageFailure =
  /** 게스트를 다룰 역할이 아니다. */
  | 'forbidden'
  /** 이 워크스페이스의 (들어와 있는) 게스트가 아니다 — 멤버 · 떠난 사람 · 모르는 사람. */
  | 'not_found'
  /** 빼면 관리할 사람이 남지 않는 페이지가 생긴다(`dropGrantsOf` 의 규칙). 게스트는 편집까지라 정상 경로에서는 없다. */
  | 'would_orphan'

export type GuestManageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: GuestManageFailure }

/** 게스트 한 사람 — 이름 · 이메일 · **받은 페이지 수**(휴지통이 아닌 페이지 · 데이터베이스에 준 부여의 수). */
export type GuestRow = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly pages: number
}

const refuse = (reason: GuestManageFailure) => ({ ok: false, reason }) as const

/** 게스트 목록 — 이름순. 게스트를 다룰 역할이 아니면 `forbidden`(멤버 목록과 달리 누구에게나 주는 목록이 아니다). */
export async function listGuests(ctx: SessionContext): Promise<GuestManageResult<GuestRow[]>> {
  if (!canManageGuests(ctx.role)) return refuse('forbidden')
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{ user_id: string; name: string; email: string | null; pages: number }>(
      `SELECT m.user_id, u.name, ue.email::text AS email,
              (SELECT count(DISTINCT a.node_id)::int
                 FROM acl_entry a
                 JOIN block b ON b.id = a.node_id AND b.workspace_id = m.workspace_id
                WHERE a.node_kind = 'block' AND a.principal_type = 'user' AND a.principal_id = m.user_id
                  AND b.type IN ('page', 'database') AND b.lifecycle = 'live') AS pages
         FROM workspace_member m
         JOIN "user" u ON u.id = m.user_id
         LEFT JOIN user_email ue ON ue.id = u.primary_email_id
        WHERE m.workspace_id = $1 AND m.role = 'guest' AND m.status = 'active'
        ORDER BY lower(u.name), m.user_id`,
      [ctx.workspaceId],
    )
    return { ok: true, value: rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, pages: r.pages })) } as const
  })
}

/** 이 워크스페이스의 들어와 있는 게스트를 잠근다 — 아니면 null. 올리기 · 빼기가 같은 사람을 겹쳐 다루지 않게. */
async function lockGuest(tx: Tx, ctx: SessionContext, userId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM workspace_member
      WHERE workspace_id = $1 AND user_id = $2 AND role = 'guest' AND status = 'active'
      FOR UPDATE`,
    [ctx.workspaceId, userId],
  )
  return row !== null
}

/** 멤버십이 바뀌었다 — 그 사람의 권한 세대와 워크스페이스의 `acl_epoch` 를 올린다(`acceptInvite` · 게스트 초대와 같다). */
async function membershipChanged(tx: Tx, ctx: SessionContext, userId: string): Promise<void> {
  await tx.query(`UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = $1`, [userId])
  await tx.query(`UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = $1`, [ctx.workspaceId])
}

/**
 * 게스트를 **멤버로 올린다**(정본 [보강] 게스트를 들이는 길 ⑧) — 받은 부여는 그대로, 워크스페이스 전체 접근이 얹힌다(모든
 * 멤버에게 준 페이지 · 공개 teamspace 의 열람). 좌석을 쓰기 시작한다(M2 — `workspace_seat_count` 가 역할로 센다).
 *
 * 멤버가 되는 길이므로 **기본 teamspace 에 함께 들어간다**(`joinDefaultTeamspaces` — 7c-11 이 정한 것). `teamspaces` 는 그렇게
 * 들어간 수다.
 */
export async function promoteGuest(ctx: SessionContext, userId: string): Promise<GuestManageResult<{ teamspaces: number }>> {
  if (!canManageGuests(ctx.role)) return refuse('forbidden')
  return withCommandTransaction(async (tx) => {
    if (!(await lockGuest(tx, ctx, userId))) return refuse('not_found')
    await tx.query(
      `UPDATE workspace_member SET role = 'member', join_method = 'guest_upgrade'
        WHERE workspace_id = $1 AND user_id = $2`,
      [ctx.workspaceId, userId],
    )
    const teamspaces = await joinDefaultTeamspaces(tx, ctx.workspaceId, userId, 'member')
    await membershipChanged(tx, ctx, userId)
    return { ok: true, value: { teamspaces } } as const
  })
}

/**
 * 게스트를 **워크스페이스에서 뺀다**(⑧) — `status='removed'` 와 함께 **받은 부여를 모두 거둔다**(`dropGrantsOf` — 그룹을 지울 때와
 * 같은 규칙). 거두지 않으면 M1 의 멤버십 행이 남아, 다시 초대받는 순간 옛 페이지들이 한꺼번에 돌아온다. `pages` 는 부여를 거둔
 * 페이지 수다. 열어 둔 편집기는 멤버십 행의 트리거(0016)가 협업 서버에 알려 닫힌다.
 */
export async function removeGuest(ctx: SessionContext, userId: string): Promise<GuestManageResult<{ pages: number }>> {
  if (!canManageGuests(ctx.role)) return refuse('forbidden')
  return withCommandTransaction(async (tx) => {
    if (!(await lockGuest(tx, ctx, userId))) return refuse('not_found')
    const dropped = await dropGrantsOf(tx, ctx, { type: 'user', id: userId })
    if (!dropped.ok) return refuse('would_orphan')
    await tx.query(
      `UPDATE workspace_member SET status = 'removed', removed_at = now()
        WHERE workspace_id = $1 AND user_id = $2`,
      [ctx.workspaceId, userId],
    )
    await membershipChanged(tx, ctx, userId)
    return { ok: true, value: { pages: dropped.nodes } } as const
  })
}
