/**
 * 워크스페이스 이메일 초대 · 수락 — F-14-10
 *
 * 정본: docs/research/14-auth-accounts.md F-14-10
 *
 * **MVP 는 ① 이메일 초대 하나만이다.** 명세가 직접 자른 범위다:
 *   "MVP는 ① 이메일 초대 하나만으로 자르고 ②③④는 v1."
 *   "비밀 링크와 도메인 자동 가입은 보안 리스크가 크므로 정책 UI가 갖춰진 뒤에 연다."
 *
 * 여기서 구현하지 않는 것 (v1):
 *   ② 비밀 초대 링크 — 유출 시 재발급이 유일한 방어라 revoke UI 가 먼저 필요하다
 *   ③ allowed domain 자동 가입 — 공용 도메인 블랙리스트와 verified_at 검사가 전제
 *   ④ SAML JIT — F-14-11
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { isUuid } from '../ids.ts'
import { queryMaybe } from '../db/pool.ts'
import { recordAuditIn } from '../audit/audit.ts'
import { withCommandTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { grantFromInviteIn } from '../permissions/acl.ts'
import { membersWith } from '../permissions/effective.ts'
import type { Level } from '../permissions/levels.ts'
import { joinDefaultTeamspaces } from './teamspace.ts'

/** 초대에 부여할 수 있는 역할. guest 는 페이지 단위라 워크스페이스 초대 대상이 아니다. */
export const INVITABLE_ROLES = ['owner', 'membership_admin', 'member'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

/** 초대를 보낼 수 있는 역할. 정본 §3.3 의 역할 체계 기준. */
const CAN_INVITE: ReadonlySet<string> = new Set(['owner', 'membership_admin'])

/**
 * 초대를 보내고 · 대기 중인 초대를 보고 · 취소할 수 있는 역할인가 — owner · membership_admin. 역할 **이름**으로 묻는다(CLAUDE.md).
 * 화면(홈의 "멤버 초대" 절)과 명령이 같은 답을 쓴다.
 */
export function canInvite(role: WorkspaceRole): boolean {
  return CAN_INVITE.has(role)
}

export const INVITE_TTL_DAYS = 7

/**
 * 초대 토큰 해시.
 *
 * 토큰은 고엔트로피 난수라 느린 KDF 가 필요 없다 — 세션 토큰과 같은 규약이다.
 * 원문은 메일에만 존재한다. (정본 §3.2 [정정 2026-09-09])
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashInviteToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ── 발급 ──────────────────────────────────────────────────────────────

export type CreateInviteInput = {
  readonly workspaceId: string
  readonly inviterUserId: string
  readonly inviterRole: string
  readonly email: string
  readonly role: InvitableRole
}

export type CreateInviteOutcome =
  | { readonly ok: true; readonly inviteId: string; readonly token: string }
  | {
      readonly ok: false
      readonly reason: 'forbidden' | 'already_member' | 'already_invited'
    }

export async function createEmailInvite(
  input: CreateInviteInput,
): Promise<CreateInviteOutcome> {
  // 초대 권한은 역할로 판정한다. ACL 은 페이지 축이고 멤버십은 워크스페이스 축이라
  // acl_entry 를 거치지 않는다.
  if (!CAN_INVITE.has(input.inviterRole)) {
    return { ok: false, reason: 'forbidden' }
  }

  const email = input.email.trim()

  return withTransaction(async (tx) => {
    // 이미 멤버인가. 이메일이 그 계정의 **별칭**일 수도 있으므로 user_email 로 조인한다.
    // (F-14-10 엣지 케이스: "초대된 주소가 이미 그 계정의 별칭 → 이미 멤버로 판정.
    //  좌석 중복 금지")
    const member = await tx.queryMaybe<{ status: string }>(
      `SELECT m.status
         FROM user_email ue
         JOIN workspace_member m ON m.user_id = ue.user_id
        WHERE ue.email = $1 AND m.workspace_id = $2`,
      [email, input.workspaceId],
    )
    if (member && member.status === 'active') {
      return { ok: false, reason: 'already_member' } as const
    }

    // 대기 중인 초대가 이미 있으면 역할만 갱신한다.
    // (F-14-10: "초대 수락 전 관리자가 역할 변경 → pending 초대의 role 을 갱신")
    // 게스트의 대기 초대(7g-1)는 다른 초대다 — 페이지 하나를 받는 초대를 워크스페이스 멤버 초대로 바꾸지 않는다.
    const pending = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM workspace_invite
        WHERE workspace_id = $1 AND email = $2 AND role <> 'guest'
          AND revoked_at IS NULL AND accepted_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [input.workspaceId, email],
    )

    const token = randomBytes(32).toString('base64url')

    if (pending) {
      // 토큰도 새로 발급한다 — 이전 메일의 링크는 무효가 된다.
      // 역할이 바뀐 초대를 옛 링크로 수락할 수 있으면 안 된다.
      await tx.query(
        `UPDATE workspace_invite
            SET role = $2, token_hash = $3, created_by = $4, created_at = now(),
                expires_at = now() + ($5 || ' days')::interval
          WHERE id = $1`,
        [pending.id, input.role, hashInviteToken(token), input.inviterUserId, String(INVITE_TTL_DAYS)],
      )
      await auditInvited(tx, input.workspaceId, input.inviterUserId, pending.id, email, input.role, true)
      return { ok: true, inviteId: pending.id, token } as const
    }

    const row = await tx.queryOne<{ id: string }>(
      `INSERT INTO workspace_invite
         (id, workspace_id, kind, email, token_hash, role, created_by, created_at, expires_at)
       VALUES (gen_random_uuid(), $1, 'email', $2, $3, $4, $5, now(),
               now() + ($6 || ' days')::interval)
       RETURNING id`,
      [
        input.workspaceId,
        email,
        hashInviteToken(token),
        input.role,
        input.inviterUserId,
        String(INVITE_TTL_DAYS),
      ],
    )

    await auditInvited(tx, input.workspaceId, input.inviterUserId, row.id, email, input.role, false)
    return { ok: true, inviteId: row.id, token } as const
  })
}

/** 감사 로그(F-11-12 — 6d-1) — 누구를 들이려 했는가가 감사의 목적이라 받는 주소를 남긴다. */
function auditInvited(tx: Tx, workspaceId: string, inviterUserId: string, inviteId: string, email: string, role: string, renewed: boolean) {
  return recordAuditIn(tx, {
    type: 'workspace.member_invited',
    workspaceId,
    actorUserId: inviterUserId,
    target: { type: 'invite', id: inviteId },
    metadata: { email, role, renewed },
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

export type InvitePreview = {
  readonly inviteId: string
  readonly workspaceId: string
  readonly workspaceName: string
  readonly email: string
  /** 게스트 초대면 `guest`(7g-1) — 페이지 하나를 받는다. 수락 화면은 페이지 제목을 싣지 않는다(받기 전에는 볼 수 없다). */
  readonly role: InvitableRole | 'guest'
}

/** 수락 화면에 보여줄 정보. 토큰이 유효할 때만 돌려준다. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const row = await queryMaybe<{
    id: string
    workspace_id: string
    workspace_name: string
    email: string
    role: string
    token_hash: string
  }>(
    `SELECT i.id, i.workspace_id, w.name AS workspace_name,
            i.email::text AS email, i.role, i.token_hash
       FROM workspace_invite i
       JOIN workspace w ON w.id = i.workspace_id
      WHERE i.token_hash = $1
        AND i.revoked_at IS NULL
        AND i.accepted_at IS NULL
        AND (i.expires_at IS NULL OR i.expires_at > now())
        AND w.deleted_at IS NULL`,
    [hashInviteToken(token)],
  )

  if (!row || !tokenMatches(token, row.token_hash)) return null

  return {
    inviteId: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    email: row.email,
    role: row.role as InvitableRole | 'guest',
  }
}

// ── 수락 ──────────────────────────────────────────────────────────────

export type AcceptInviteOutcome =
  | {
      readonly ok: true
      readonly workspaceId: string
      /** 이 워크스페이스에서의 역할 — 게스트 초대를 받은 기존 멤버는 원래 역할 그대로다. */
      readonly role: InvitableRole | 'guest'
      /** 게스트 초대면 받은 페이지 — 화면이 그리로 간다(7g-1). */
      readonly pageId?: string
    }
  | {
      readonly ok: false
      readonly reason:
        | 'invalid'
        | 'email_mismatch'
        | 'seat_limit'
        | 'already_member'
        /** 게스트 초대인데 페이지가 살아 있지 않거나, 초대한 사람이 이제 그 페이지를 공유할 수 없다(7g-1 · 정본 게스트 ⑨ (c)). */
        | 'page_unavailable'
        /** 받는 사람의 멤버십이 멈춰 있다. */
        | 'unavailable'
    }

/**
 * 좌석 한도 확인 — **수락 트랜잭션이 강제 지점이다.**
 *
 * F-14-10: "좌석 한도 초과 상태에서 수락 → 수락 시점에 좌석을 소비하므로
 * 수락을 막거나 과금을 늘린다. 13-18 F-13-18의 강제 지점 = 수락 트랜잭션."
 *
 * 한도 자체는 `plan_entitlement`(정본 §3.10)에서 오는데 그 테이블은 아직
 * 마이그레이션되지 않았다. 지금은 **좌석을 세기만 하고 막지 않는다.**
 * 함수를 지금 만들어 두는 이유는, 한도가 생겼을 때 붙일 자리를 코드에
 * 남겨두기 위해서다 — 나중에 "어디서 막지?"를 다시 찾지 않도록.
 */
async function checkSeatAvailable(
  tx: Tx,
  workspaceId: string,
  role: InvitableRole,
): Promise<{ available: true; seats: number } | { available: false }> {
  // guest 는 좌석을 소비하지 않는다(불변식 M2). 초대 가능 역할에 guest 는 없지만
  // 나중에 추가될 때를 대비해 규칙을 여기 명시해 둔다.
  const consumesSeat = role !== ('guest' as string)

  const row = await tx.queryMaybe<{ seats: string }>(
    `SELECT seats FROM workspace_seat_count WHERE workspace_id = $1`,
    [workspaceId],
  )
  const seats = Number(row?.seats ?? 0) + (consumesSeat ? 1 : 0)

  // TODO(F-13-18): plan_entitlement 마이그레이션 후 여기서 한도를 읽어 막는다.
  return { available: true, seats }
}

/**
 * 초대를 수락한다.
 *
 * 초대받은 이메일과 로그인한 계정이 일치하는지 확인한다. 별칭도 인정한다
 * (F-14-07). 그렇지 않으면 링크를 가진 아무나 남의 초대를 가로챌 수 있다.
 */
export async function acceptInvite(
  token: string,
  userId: string,
): Promise<AcceptInviteOutcome> {
  // 거부는 아무것도 바꾸지 않는다(§3.3-158) — 게스트 초대는 멤버십을 쓴 뒤에 부여를 쓰므로 그 사이의 거부가 되돌아가야 한다.
  return withCommandTransaction(async (tx) => {
    // FOR UPDATE 로 잠근다. 같은 초대를 동시에 수락하면 좌석이 두 번 소비된다.
    const invite = await tx.queryMaybe<GuestInviteRow>(
      `SELECT i.id, i.workspace_id, i.email::text AS email, i.role, i.token_hash,
              i.page_id, i.page_level, i.created_by, i.created_at
         FROM workspace_invite i
         JOIN workspace w ON w.id = i.workspace_id
        WHERE i.token_hash = $1
          AND i.revoked_at IS NULL
          AND i.accepted_at IS NULL
          AND (i.expires_at IS NULL OR i.expires_at > now())
          AND w.deleted_at IS NULL
        FOR UPDATE OF i`,
      [hashInviteToken(token)],
    )

    if (!invite || !tokenMatches(token, invite.token_hash)) {
      return { ok: false, reason: 'invalid' } as const
    }

    // 초대받은 주소가 이 계정의 **검증된** 이메일이어야 한다.
    // 미검증 별칭을 인정하면 아무 주소나 등록해 남의 초대를 가져갈 수 있다.
    const owns = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM user_email
        WHERE user_id = $1 AND email = $2 AND verified_at IS NOT NULL`,
      [userId, invite.email],
    )
    if (!owns) {
      return { ok: false, reason: 'email_mismatch' } as const
    }

    if (invite.role === 'guest') return acceptGuestInvite(tx, invite, userId)

    const existing = await tx.queryMaybe<{ status: string }>(
      `SELECT status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [invite.workspace_id, userId],
    )
    if (existing && existing.status === 'active') {
      return { ok: false, reason: 'already_member' } as const
    }

    const role = invite.role as InvitableRole
    const seat = await checkSeatAvailable(tx, invite.workspace_id, role)
    if (!seat.available) {
      return { ok: false, reason: 'seat_limit' } as const
    }

    // 멤버십은 삭제가 아니라 상태 전이다(불변식 M1). 30일 내 재가입이면
    // 이전 행이 status='removed' 로 남아 있으므로 UPSERT 한다.
    await tx.query(
      `INSERT INTO workspace_member
         (workspace_id, user_id, role, status, join_method, invited_by, invited_at, accepted_at)
       VALUES ($1, $2, $3, 'active', 'invite_email', $4, $5, now())
       ON CONFLICT (workspace_id, user_id) DO UPDATE
          SET role = EXCLUDED.role,
              status = 'active',
              join_method = EXCLUDED.join_method,
              accepted_at = now(),
              removed_at = NULL`,
      [invite.workspace_id, userId, role, null, null],
    )

    await tx.query(
      `UPDATE workspace_invite
          SET accepted_at = now(), accepted_by_user_id = $2
        WHERE id = $1`,
      [invite.id, userId],
    )

    // 기본 teamspace 에 함께 들어간다(7c-11 · F-06-04 *"이후 가입자도 자동 추가"*). 멤버 행을 세운 뒤여야 한다 —
    // teamspace 멤버 가드(0028 ①)가 이 워크스페이스의 멤버인지 묻는다.
    await joinDefaultTeamspaces(tx, invite.workspace_id, userId, role)

    // 멤버십이 바뀌면 권한 캐시 세대를 올린다 (정본 §3.11 캐시 키 규약).
    // Redis 미러는 W6 에서 붙인다. 지금은 DB 쪽만 올려둔다.
    await tx.query(`UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = $1`, [userId])
    await tx.query(`UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = $1`, [
      invite.workspace_id,
    ])
    // 감사 로그(F-11-12 — 6d-1) — 들어온 사람이 행위자다
    await recordAuditIn(tx, {
      type: 'workspace.member_joined',
      workspaceId: invite.workspace_id,
      actorUserId: userId,
      target: { type: 'user', id: userId },
      metadata: { role, via: 'invite' },
    })

    return { ok: true, workspaceId: invite.workspace_id, role } as const
  })
}

type GuestInviteRow = {
  id: string
  workspace_id: string
  email: string
  role: string
  token_hash: string
  page_id: string | null
  page_level: string | null
  created_by: string
  created_at: Date
}

/**
 * 게스트의 대기 초대를 받아들인다(7g-1 · 정본 §3.3 게스트 ⑨) — 이메일 소유는 부르는 쪽이 이미 확인했다.
 *
 *   ① 초대한 사람이 **지금도** 그 페이지를 공유할 수 있는가 — 세션이 없으므로 판정과 같은 규칙을 그 사람으로 센다(`membersWith` ·
 *      활성 멤버 · `manage_perm`). 부여를 정한 것은 초대할 때 그 사람의 세션이었고, 이것은 그 결정을 좁히기만 한다
 *   ② 멤버십 — 이미 들어와 있으면 역할을 건드리지 않고, 멈췄으면 받지 않고, 아니면 게스트로(떠났던 사람은 돌아온다 · M1)
 *   ③ 부여 — `grantFromInviteIn`(살아 있는 페이지 · 이 워크스페이스의 사람 · 게스트는 편집까지 · 낮추지 않는다)
 *
 * 멤버십을 부여보다 먼저 쓴다(공유의 사용자 주체는 이 워크스페이스의 사람 · 7d-2) — 그 사이의 거부는 트랜잭션이 되돌린다.
 */
async function acceptGuestInvite(tx: Tx, invite: GuestInviteRow, userId: string): Promise<AcceptInviteOutcome> {
  const pageId = invite.page_id as string
  const sharers = (await membersWith(tx, invite.workspace_id, [pageId], 'manage_perm', [invite.created_by])).get(pageId)
  const page = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'live' FOR SHARE`,
    [pageId, invite.workspace_id],
  )
  if (page === null || !sharers?.has(invite.created_by)) return { ok: false, reason: 'page_unavailable' } as const

  const existing = await tx.queryMaybe<{ role: string; status: string }>(
    `SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
    [invite.workspace_id, userId],
  )
  if (existing?.status === 'suspended') return { ok: false, reason: 'unavailable' } as const
  const active = existing?.status === 'active'
  if (!active) {
    await tx.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, status, join_method, invited_by, invited_at, accepted_at)
       VALUES ($1, $2, 'guest', 'active', 'invite_email', $3, $4, now())
       ON CONFLICT (workspace_id, user_id) DO UPDATE
          SET role = 'guest', status = 'active', removed_at = NULL, join_method = 'invite_email',
              invited_by = EXCLUDED.invited_by, invited_at = EXCLUDED.invited_at, accepted_at = now()`,
      [invite.workspace_id, userId, invite.created_by, invite.created_at],
    )
    await tx.query(`UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = $1`, [userId])
    await tx.query(`UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = $1`, [invite.workspace_id])
  }

  const granted = await grantFromInviteIn(
    tx,
    invite.workspace_id,
    pageId,
    userId,
    invite.page_level as Level,
    invite.created_by,
  )
  if (granted !== 'granted' && granted !== 'covered') return { ok: false, reason: 'page_unavailable' } as const

  await tx.query(`UPDATE workspace_invite SET accepted_at = now(), accepted_by_user_id = $2 WHERE id = $1`, [invite.id, userId])
  // 감사 로그(F-11-12 — 6d-1) — 이미 이 워크스페이스의 사람이면 들어온 것이 아니다(페이지 하나를 받았을 뿐 — 권한 변경으로 남지 않는다:
  // 초대한 사람이 이미 그 공유를 정했다)
  if (!active) {
    await recordAuditIn(tx, {
      type: 'workspace.member_joined',
      workspaceId: invite.workspace_id,
      actorUserId: userId,
      target: { type: 'user', id: userId },
      metadata: { role: 'guest', via: 'invite', pageId },
    })
  }
  return {
    ok: true,
    workspaceId: invite.workspace_id,
    role: active ? (existing.role as InvitableRole | 'guest') : 'guest',
    pageId,
  } as const
}

export type RevokeInviteFailure =
  /** 초대를 다룰 역할이 아니다(owner · membership_admin 만). */
  | 'forbidden'
  /** 그런 대기 중인 초대가 없다 — 없는 id · 다른 워크스페이스 · 이미 받아들였거나 취소했다. */
  | 'not_found'

export type RevokeInviteResult =
  /** `email` — 취소한 초대의 주소(화면이 "누구의 초대를 취소했다"고 말한다). 링크 초대는 없다(null). */
  | { readonly ok: true; readonly value: { readonly email: string | null } }
  | { readonly ok: false; readonly reason: RevokeInviteFailure }

/**
 * 대기 중인 초대를 취소한다 — 보낸 링크는 곧바로 무효가 된다(수락 화면이 "유효하지 않은 초대"). 멤버 초대와 게스트의 대기
 * 초대(7g-1) 모두 — 게스트 초대를 보낸 공유자라도 초대를 다룰 역할이 아니면 못 한다(정본 §3.3 [보강] 게스트 ⑨ (g) — 목록 · 취소는
 * 홈 · owner · membership_admin).
 *
 * 권한을 묻는 함수라 `SessionContext` 를 받는다(A9 — 7g-3 전에는 역할 문자열과 워크스페이스 id 를 따로 받았다). 역할이 먼저다 —
 * 다룰 수 없는 사람에게는 그 초대가 있는지 말하지 않는다. 만료된 초대도 취소한다(받아들일 수는 없지만 목록에서 사라지게 두는 것과
 * 같다).
 */
export async function revokeInvite(ctx: SessionContext, inviteId: string): Promise<RevokeInviteResult> {
  if (!canInvite(ctx.role)) return { ok: false, reason: 'forbidden' }
  if (!isUuid(inviteId)) return { ok: false, reason: 'not_found' }
  const row = await queryMaybe<{ email: string | null }>(
    `UPDATE workspace_invite
        SET revoked_at = now()
      WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND accepted_at IS NULL
      RETURNING email::text AS email`,
    [inviteId, ctx.workspaceId],
  )
  return row === null ? { ok: false, reason: 'not_found' } : { ok: true, value: { email: row.email } }
}
