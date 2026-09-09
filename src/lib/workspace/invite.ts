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

import { queryMaybe } from '../db/pool.ts'
import { withTransaction, type Tx } from '../db/tx.ts'

/** 초대에 부여할 수 있는 역할. guest 는 페이지 단위라 워크스페이스 초대 대상이 아니다. */
export const INVITABLE_ROLES = ['owner', 'membership_admin', 'member'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

/** 초대를 보낼 수 있는 역할. 정본 §3.3 의 역할 체계 기준. */
const CAN_INVITE: ReadonlySet<string> = new Set(['owner', 'membership_admin'])

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
    const pending = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM workspace_invite
        WHERE workspace_id = $1 AND email = $2
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

    return { ok: true, inviteId: row.id, token } as const
  })
}

// ── 조회 ──────────────────────────────────────────────────────────────

export type InvitePreview = {
  readonly inviteId: string
  readonly workspaceId: string
  readonly workspaceName: string
  readonly email: string
  readonly role: InvitableRole
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
    role: row.role as InvitableRole,
  }
}

// ── 수락 ──────────────────────────────────────────────────────────────

export type AcceptInviteOutcome =
  | { readonly ok: true; readonly workspaceId: string; readonly role: InvitableRole }
  | {
      readonly ok: false
      readonly reason: 'invalid' | 'email_mismatch' | 'seat_limit' | 'already_member'
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
  return withTransaction(async (tx) => {
    // FOR UPDATE 로 잠근다. 같은 초대를 동시에 수락하면 좌석이 두 번 소비된다.
    const invite = await tx.queryMaybe<{
      id: string
      workspace_id: string
      email: string
      role: string
      token_hash: string
    }>(
      `SELECT i.id, i.workspace_id, i.email::text AS email, i.role, i.token_hash
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

    // 멤버십이 바뀌면 권한 캐시 세대를 올린다 (정본 §3.11 캐시 키 규약).
    // Redis 미러는 W6 에서 붙인다. 지금은 DB 쪽만 올려둔다.
    await tx.query(`UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = $1`, [userId])
    await tx.query(`UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = $1`, [
      invite.workspace_id,
    ])

    return { ok: true, workspaceId: invite.workspace_id, role } as const
  })
}

/** 초대를 취소한다. 링크는 즉시 무효가 된다. */
export async function revokeInvite(
  inviteId: string,
  workspaceId: string,
  actorRole: string,
): Promise<boolean> {
  if (!CAN_INVITE.has(actorRole)) return false
  const row = await queryMaybe<{ id: string }>(
    `UPDATE workspace_invite
        SET revoked_at = now()
      WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND accepted_at IS NULL
      RETURNING id`,
    [inviteId, workspaceId],
  )
  return row !== null
}
