/**
 * 워크스페이스 정책 — Teamspace · 게스트 · 그룹 7g-2조각 (F-06-15) · 게시 · 공유 6a-1조각 (F-06-11)
 *
 * 정본: 00-canonical-data-model.md §3.2 `security_policy` [보강 7g-2] · §3.3 [보강] 접근 요청의 길 ⑩ (f) · (g)
 *       · §3.1 [보강] 설정 정보구조 ②(8g-1 — 정책을 바꾸는 길은 설정이다) · §3.3 끝 [정정] 웹 게시 ③⑨
 *
 * **행이 없으면 모든 칸이 기본값이다**(0036) — 행은 owner 가 처음 바꿀 때 생긴다. 읽는 곳은 없는 행을 기본값으로 읽는다
 * (`readSecurityPolicyIn`). 지금 뜻이 있는 칸은 둘이다:
 *
 *   `allow_nonmember_page_access_request` — 워크스페이스 밖의 사람(가입했지만 멤버가 아닌 사람)이 페이지 주소에서 접근을
 *   요청할 수 있는가(기본 true). 끄면 요청 화면이 404 가 되고, 대기 중인 밖의 요청은 목록에서 빠진다(다시 켜면 돌아온다)
 *
 *   `allow_publish_sites_and_forms` — 페이지를 웹에 게시할 수 있는가(기본 true · 6a-1). 끄면 새로 게시할 수 없고 **이미 게시한
 *   주소도 곧바로 열리지 않는다**(공개 경로가 런타임에 묻는다 — 행은 남는다). 다시 켜면 돌아온다. 공개 폼(7번 트랙)도 이 칸을 묻는다
 *
 * **운영자의 게시 차단(6b-3a)은 이 표가 아니라 워크스페이스 행에 있다**(`workspace.publishing_blocked_at` — 소유자가 설정으로 되돌릴 수
 * 없다 · 정본 §3.3 끝 [보강] 모더레이션 조치 ⑥). 효과 정책 `allowPublish` 는 둘의 곱이다 — 설정 값 · 잠금을 따로도 낸다.
 *
 * 누가 바꾸는가 · 값이 맞는가는 설정 레지스트리가 정한다(`settings/registry.ts` — 소유자만). 이 모듈은 칸을 읽고 쓰기만 한다.
 * 나머지 칸은 그 기능이 생길 때 레지스트리와 여기에 더한다 — 화면에 없는 칸을 바꾸는 명령을 미리 두지 않는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'

export type SecurityPolicy = {
  /** 워크스페이스 밖의 사람이 페이지 접근을 요청할 수 있는가(정본 기본값 true). */
  readonly allowNonmemberPageAccessRequest: boolean
  /** 페이지를 웹에 게시할 수 있는가 · 게시한 주소가 열리는가 — **효과 정책**: 소유자의 설정 AND 운영자의 잠금 없음(6a-1 · 6b-3a). */
  readonly allowPublish: boolean
  /** 소유자의 설정 값 그대로(`allow_publish_sites_and_forms` · 정본 기본값 true) — 설정 화면이 보이는 값. 판정에는 `allowPublish`. */
  readonly allowPublishSetting: boolean
  /** 운영자가 이 워크스페이스의 웹 게시를 막았는가(6b-3a — `workspace.publishing_blocked_at`). */
  readonly publishingBlocked: boolean
  /** 멤버가 내보낼 수 있는가(정본 기본값 true · 6e-1) — 끄면 소유자만. */
  readonly allowExport: boolean
  /** 멤버가 게스트를 들이고 게스트와 공유할 수 있는가(정본 기본값 true · 6e-1) — 끄면 소유자 · 멤버 관리자만. */
  readonly allowMemberInviteGuests: boolean
}

/** 행이 없을 때의 정책 — 정본 DDL 의 DEFAULT 그대로. */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  allowNonmemberPageAccessRequest: true,
  allowPublish: true,
  allowPublishSetting: true,
  publishingBlocked: false,
  allowExport: true,
  allowMemberInviteGuests: true,
}

/** 이 워크스페이스의 정책 — 행이 없으면 기본값. 판정이 아니라 설정을 읽는다(누가 묻는지와 무관하다). */
export async function readSecurityPolicyIn(tx: Tx, workspaceId: string): Promise<SecurityPolicy> {
  // 워크스페이스 행에서 시작한다 — 정책 행이 없어도(기본값) 운영자의 잠금은 읽는다
  const row = await tx.queryMaybe<{
    allow_nonmember_page_access_request: boolean | null
    allow_publish_sites_and_forms: boolean | null
    allow_export: boolean | null
    allow_member_invite_guests: boolean | null
    publishing_blocked: boolean
  }>(
    `SELECT sp.allow_nonmember_page_access_request, sp.allow_publish_sites_and_forms, sp.allow_export, sp.allow_member_invite_guests,
            (w.publishing_blocked_at IS NOT NULL) AS publishing_blocked
       FROM workspace w LEFT JOIN security_policy sp ON sp.workspace_id = w.id
      WHERE w.id = $1`,
    [workspaceId],
  )
  if (row === null) return DEFAULT_SECURITY_POLICY
  const allowPublishSetting = row.allow_publish_sites_and_forms ?? DEFAULT_SECURITY_POLICY.allowPublishSetting
  return {
    allowNonmemberPageAccessRequest: row.allow_nonmember_page_access_request ?? DEFAULT_SECURITY_POLICY.allowNonmemberPageAccessRequest,
    allowPublish: allowPublishSetting && !row.publishing_blocked,
    allowPublishSetting,
    publishingBlocked: row.publishing_blocked,
    allowExport: row.allow_export ?? DEFAULT_SECURITY_POLICY.allowExport,
    allowMemberInviteGuests: row.allow_member_invite_guests ?? DEFAULT_SECURITY_POLICY.allowMemberInviteGuests,
  }
}

/** 밖의 사람의 접근 요청을 켜고 끈다 — 행이 없으면 만든다(나머지 칸은 DEFAULT). 권한은 부르는 쪽(설정)이 이미 물었다. */
export async function writeNonmemberRequestPolicyIn(tx: Tx, workspaceId: string, allow: boolean): Promise<void> {
  await tx.query(
    `INSERT INTO security_policy (workspace_id, allow_nonmember_page_access_request)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET allow_nonmember_page_access_request = EXCLUDED.allow_nonmember_page_access_request`,
    [workspaceId, allow],
  )
}

/** 웹 게시를 허용하고 막는다(6a-1) — 행이 없으면 만든다(나머지 칸은 DEFAULT). 권한은 부르는 쪽(설정)이 이미 물었다. */
export async function writePublishPolicyIn(tx: Tx, workspaceId: string, allow: boolean): Promise<void> {
  await tx.query(
    `INSERT INTO security_policy (workspace_id, allow_publish_sites_and_forms)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET allow_publish_sites_and_forms = EXCLUDED.allow_publish_sites_and_forms`,
    [workspaceId, allow],
  )
}

/** 멤버의 내보내기를 허용하고 막는다(6e-1). 권한은 부르는 쪽(설정)이 이미 물었다. */
export async function writeExportPolicyIn(tx: Tx, workspaceId: string, allow: boolean): Promise<void> {
  await tx.query(
    `INSERT INTO security_policy (workspace_id, allow_export) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET allow_export = EXCLUDED.allow_export`,
    [workspaceId, allow],
  )
}

/** 멤버의 게스트 초대를 허용하고 막는다(6e-1). 권한은 부르는 쪽(설정)이 이미 물었다. */
export async function writeMemberInviteGuestsPolicyIn(tx: Tx, workspaceId: string, allow: boolean): Promise<void> {
  await tx.query(
    `INSERT INTO security_policy (workspace_id, allow_member_invite_guests) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET allow_member_invite_guests = EXCLUDED.allow_member_invite_guests`,
    [workspaceId, allow],
  )
}

/** 소유자 · 멤버 관리자 — 정책이 막아도 하는 사람(6e-1 · 정본 [보강] 보안 정책 ①②). */
const POLICY_EXEMPT: ReadonlySet<string> = new Set(['owner', 'membership_admin'])

/**
 * 이 사람이 게스트를 들이거나 게스트와 공유할 수 있는가(정본 [보강] 보안 정책 ②) — 소유자 · 멤버 관리자는 늘, 그 밖은 정책이 허용할 때.
 * 게스트에게 주는 모든 길(공유 패널의 게스트 부여 · 이메일 초대 · 접근 요청의 허락)이 이것을 묻는다.
 */
export async function mayInviteGuestsIn(tx: Tx, ctx: Pick<SessionContext, 'workspaceId' | 'role'>): Promise<boolean> {
  if (POLICY_EXEMPT.has(ctx.role)) return true
  return (await readSecurityPolicyIn(tx, ctx.workspaceId)).allowMemberInviteGuests
}

/** 그 역할의 사람이 지금 게스트를 들일 수 있는가 — 세션이 없는 길(대기 초대의 수락 — 초대한 사람의 지금 역할)이 묻는다. */
export async function roleMayInviteGuestsIn(tx: Tx, workspaceId: string, role: string | null): Promise<boolean> {
  if (role !== null && POLICY_EXEMPT.has(role)) return true
  if (role === null) return false
  return (await readSecurityPolicyIn(tx, workspaceId)).allowMemberInviteGuests
}
