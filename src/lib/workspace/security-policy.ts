/**
 * 워크스페이스 정책 — Teamspace · 게스트 · 그룹 7g-2조각 (F-06-15)
 *
 * 정본: 00-canonical-data-model.md §3.2 `security_policy` [보강 7g-2] · §3.3 [보강] 접근 요청의 길 ⑩ (f) · (g)
 *       · §3.1 [보강] 설정 정보구조 ②(8g-1 — 정책을 바꾸는 길은 설정이다)
 *
 * **행이 없으면 모든 칸이 기본값이다**(0036) — 행은 owner 가 처음 바꿀 때 생긴다. 읽는 곳은 없는 행을 기본값으로 읽는다
 * (`readSecurityPolicyIn`). 지금 뜻이 있는 칸은 하나다:
 *
 *   `allow_nonmember_page_access_request` — 워크스페이스 밖의 사람(가입했지만 멤버가 아닌 사람)이 페이지 주소에서 접근을
 *   요청할 수 있는가(기본 true). 끄면 요청 화면이 404 가 되고, 대기 중인 밖의 요청은 목록에서 빠진다(다시 켜면 돌아온다)
 *
 * 누가 바꾸는가 · 값이 맞는가는 설정 레지스트리가 정한다(`settings/registry.ts` — 소유자만). 이 모듈은 칸을 읽고 쓰기만 한다.
 * 나머지 칸은 그 기능이 생길 때 레지스트리와 여기에 더한다 — 화면에 없는 칸을 바꾸는 명령을 미리 두지 않는다.
 */

import type { Tx } from '../db/tx.ts'

export type SecurityPolicy = {
  /** 워크스페이스 밖의 사람이 페이지 접근을 요청할 수 있는가(정본 기본값 true). */
  readonly allowNonmemberPageAccessRequest: boolean
}

/** 행이 없을 때의 정책 — 정본 DDL 의 DEFAULT 그대로. */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = { allowNonmemberPageAccessRequest: true }

/** 이 워크스페이스의 정책 — 행이 없으면 기본값. 판정이 아니라 설정을 읽는다(누가 묻는지와 무관하다). */
export async function readSecurityPolicyIn(tx: Tx, workspaceId: string): Promise<SecurityPolicy> {
  const row = await tx.queryMaybe<{ allow_nonmember_page_access_request: boolean }>(
    `SELECT allow_nonmember_page_access_request FROM security_policy WHERE workspace_id = $1`,
    [workspaceId],
  )
  return row === null ? DEFAULT_SECURITY_POLICY : { allowNonmemberPageAccessRequest: row.allow_nonmember_page_access_request }
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
