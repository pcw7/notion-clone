/**
 * 워크스페이스 생성 — F-02-17
 *
 * 정본: 00-canonical-data-model.md §3.1 workspace, §3.3 workspace_member
 *
 * MVP 는 "계정당 워크스페이스 1개 자동 생성, 스위처 UI 없음"이다(F-02-17 클론 대안).
 * 다만 **스키마와 쿼리 스코프는 처음부터 다중 워크스페이스를 전제**로 만든다 —
 * 명세가 "1일차에 넣으면 2~3일, 나중에 넣으면 XL"이라고 경고한 지점이다.
 */

import { withTransaction } from '../db/tx.ts'

export type CreateWorkspaceInput = {
  readonly ownerUserId: string
  readonly name: string
}

export type CreatedWorkspace = {
  readonly workspaceId: string
  readonly name: string
}

/** 이름 정규화. 빈 이름은 허용하지 않는다. */
export function normalizeWorkspaceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length === 0 || name.length > 100) return null
  return name
}

/**
 * 리전은 소급 변경 불가 축이다(불변식 W1). 환경에서 읽되 기본값을 둔다.
 * 운영에서는 DEFAULT_REGION 을 명시적으로 설정한다.
 */
function defaultRegion(): string {
  return process.env.DEFAULT_REGION ?? 'local'
}

/**
 * 워크스페이스를 만들고 생성자를 owner 로 넣는다.
 *
 * 둘은 같은 트랜잭션이어야 한다. 워크스페이스만 만들어지고 멤버십이 실패하면
 * **아무도 접근할 수 없는 워크스페이스**가 남는다 — owner 가 0명이면 복구 경로도 없다.
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspace> {
  return withTransaction(async (tx) => {
    const ws = await tx.queryOne<{ id: string; name: string }>(
      `INSERT INTO workspace (id, name, region_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, now())
       RETURNING id, name`,
      [input.name, defaultRegion()],
    )

    // 생성자는 owner 다.
    //
    // join_method 는 NULL 이다 — CHECK 이 허용하는 값
    // (invite_email / invite_link / allowed_domain / saml_jit / scim / guest_upgrade)
    // 중 어디에도 "직접 만들었다"가 없다. 초대로 들어온 게 아니므로 NULL 이 맞다.
    await tx.query(
      `INSERT INTO workspace_member
         (workspace_id, user_id, role, status, accepted_at)
       VALUES ($1, $2, 'owner', 'active', now())`,
      [ws.id, input.ownerUserId],
    )

    return { workspaceId: ws.id, name: ws.name }
  })
}
