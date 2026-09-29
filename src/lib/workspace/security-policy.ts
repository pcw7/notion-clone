/**
 * 워크스페이스 정책 — Teamspace · 게스트 · 그룹 7g-2조각 (F-06-15)
 *
 * 정본: 00-canonical-data-model.md §3.2 `security_policy` [보강 7g-2] · §3.3 [보강] 접근 요청의 길 ⑩ (f) · (g)
 *
 * **행이 없으면 모든 칸이 기본값이다**(0036) — 행은 owner 가 처음 바꿀 때 생긴다. 읽는 곳은 없는 행을 기본값으로 읽는다
 * (`readSecurityPolicyIn`). 지금 뜻이 있는 칸은 하나다:
 *
 *   `allow_nonmember_page_access_request` — 워크스페이스 밖의 사람(가입했지만 멤버가 아닌 사람)이 페이지 주소에서 접근을
 *   요청할 수 있는가(기본 true). 끄면 요청 화면이 404 가 되고, 대기 중인 밖의 요청은 목록에서 빠진다(다시 켜면 돌아온다)
 *
 * 나머지 칸은 그 기능이 생길 때 여기에 더한다 — 화면에 없는 칸을 바꾸는 명령을 미리 두지 않는다.
 */

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'

export type SecurityPolicy = {
  /** 워크스페이스 밖의 사람이 페이지 접근을 요청할 수 있는가(정본 기본값 true). */
  readonly allowNonmemberPageAccessRequest: boolean
}

/** 행이 없을 때의 정책 — 정본 DDL 의 DEFAULT 그대로. */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = { allowNonmemberPageAccessRequest: true }

/** 정책을 바꿀 수 있는 역할 — 워크스페이스 owner(정본 [보강] ⑩ (g)). 역할 **이름**으로 묻는다(CLAUDE.md). */
export function canManageSecurityPolicy(role: WorkspaceRole): boolean {
  return role === 'owner'
}

/** 이 워크스페이스의 정책 — 행이 없으면 기본값. 판정이 아니라 설정을 읽는다(누가 묻는지와 무관하다). */
export async function readSecurityPolicyIn(tx: Tx, workspaceId: string): Promise<SecurityPolicy> {
  const row = await tx.queryMaybe<{ allow_nonmember_page_access_request: boolean }>(
    `SELECT allow_nonmember_page_access_request FROM security_policy WHERE workspace_id = $1`,
    [workspaceId],
  )
  return row === null ? DEFAULT_SECURITY_POLICY : { allowNonmemberPageAccessRequest: row.allow_nonmember_page_access_request }
}

export type SecurityPolicyResult =
  | { readonly ok: true; readonly value: SecurityPolicy }
  | { readonly ok: false; readonly reason: 'forbidden' | 'invalid_policy' }

/** 정책을 읽는다 — 바꿀 수 있는 사람(owner)에게만 준다. 화면의 설정 절이 쓴다. */
export async function getSecurityPolicy(ctx: SessionContext): Promise<SecurityPolicyResult> {
  if (!canManageSecurityPolicy(ctx.role)) return { ok: false, reason: 'forbidden' }
  return { ok: true, value: await withReadTransaction((tx) => readSecurityPolicyIn(tx, ctx.workspaceId)) }
}

/**
 * 정책을 바꾼다 — owner 만. `{ allowNonmemberPageAccessRequest: boolean }` 이 아니면 `invalid_policy`. 행이 없으면 만든다(나머지
 * 칸은 DEFAULT).
 */
export async function updateSecurityPolicy(ctx: SessionContext, patch: unknown): Promise<SecurityPolicyResult> {
  if (!canManageSecurityPolicy(ctx.role)) return { ok: false, reason: 'forbidden' }
  const allow = (patch as { allowNonmemberPageAccessRequest?: unknown } | null)?.allowNonmemberPageAccessRequest
  if (typeof allow !== 'boolean') return { ok: false, reason: 'invalid_policy' }

  return withCommandTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO security_policy (workspace_id, allow_nonmember_page_access_request)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET allow_nonmember_page_access_request = EXCLUDED.allow_nonmember_page_access_request`,
      [ctx.workspaceId, allow],
    )
    return { ok: true, value: await readSecurityPolicyIn(tx, ctx.workspaceId) } as const
  })
}
