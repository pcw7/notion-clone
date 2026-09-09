/**
 * DB 테스트 픽스처.
 *
 * **`SessionContext` 를 리터럴로 만들지 않는다.** 그 타입은 브랜디드라
 * 캐스팅 없이는 만들 수 없고, 그 제약이 존재하는 이유가
 * "권한 판정의 입력은 user_id 가 아니다"(불변식 A9)이기 때문이다.
 * 테스트에서 캐스팅으로 우회하면 그 불변식을 테스트가 먼저 어긴다.
 *
 * 그래서 여기서는 **진짜 사용자·워크스페이스·멤버십·세션 행을 만들고
 * `resolveSessionContext()` 로 발급받는다.** 느리지만, 테스트가 지나는 길이
 * 애플리케이션이 지나는 길과 같아진다 — CLAUDE.md 가 `verify-db.mjs` 에 대해
 * 적은 것과 같은 원칙이다.
 */

import { randomUUID } from 'node:crypto'

import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createSession } from '../auth/session.ts'
import { resolveSessionContext, type SessionContext, type WorkspaceRole } from '../auth/session-context.ts'
import { asWorkspaceId, type UserId, type WorkspaceId } from '../ids.ts'

export type Actor = {
  readonly userId: UserId
  readonly email: string
  readonly token: string
  readonly ctx: SessionContext
}

export type Fixture = {
  readonly workspaceId: WorkspaceId
  readonly owner: Actor
}

/** DB 가 붙는가. 붙지 않으면 테스트를 건너뛴다(CI 는 REQUIRE_DB=1 로 막는다). */
export async function probeDatabase(): Promise<string | null> {
  process.env.DATABASE_URL ??= 'postgresql://notion:notion_dev_only@localhost:5432/notion'
  try {
    await query('SELECT 1')
    return null
  } catch (e) {
    // ECONNREFUSED 는 message 가 비어 있고 code 에만 정보가 있다. 둘 다 찍지 않으면
    // "DB 사용 불가: " 라는 아무 말도 아닌 skip 사유가 남는다 (WSL2 가 VM 을
    // 내렸을 때 실제로 그랬다 — HANDOFF §6).
    const err = e as { message?: string; code?: string }
    const detail = err.message?.split('\n')[0] || err.code || String(e)
    return `DB 사용 불가: ${detail} — npm run db:up 을 한 번 실행하세요`
  }
}

/** 사용자 한 명을 만든다. `user` ↔ `user_email` 순환 FK 때문에 한 트랜잭션이어야 한다. */
export async function createUser(name = '테스트'): Promise<{ userId: UserId; email: string }> {
  const email = `t-${randomUUID().slice(0, 12)}@example.com`
  const userId = randomUUID()
  const emailId = randomUUID()

  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1, $2, $3, now())`,
      [userId, name, emailId],
    )
    await tx.query(
      `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
       VALUES ($1, $2, $3, now(), true, now())`,
      [emailId, userId, email],
    )
  })

  return { userId: userId as UserId, email }
}

/** 워크스페이스를 만든다. 멤버는 넣지 않는다 — 호출자가 역할을 정한다. */
export async function createBareWorkspace(name = '테스트 워크스페이스'): Promise<WorkspaceId> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO workspace (id, name, region_id, created_at)
     VALUES (gen_random_uuid(), $1, 'local', now()) RETURNING id`,
    [name],
  )
  return asWorkspaceId(row.id)
}

/**
 * 사용자를 워크스페이스 멤버로 넣고 세션을 발급해 `SessionContext` 까지 만든다.
 *
 * `resolveSessionContext` 가 실패하면 던진다. 테스트가 "권한이 없어서"가 아니라
 * "픽스처가 잘못돼서" 실패하는 경우를 조용히 넘기지 않기 위해서다.
 */
export async function joinAs(
  workspaceId: WorkspaceId,
  user: { userId: UserId },
  role: WorkspaceRole = 'owner',
): Promise<Actor> {
  await query(
    `INSERT INTO workspace_member (workspace_id, user_id, role, status, accepted_at)
     VALUES ($1, $2, $3, 'active', now())
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
    [workspaceId, user.userId, role],
  )

  const issued = await withTransaction((tx) =>
    createSession(tx, {
      userId: user.userId,
      authMethod: 'login_code',
      mfaSatisfied: false,
      ip: null,
      userAgent: 'node:test',
    }),
  )

  const resolved = await resolveSessionContext(issued.token, workspaceId)
  if (!resolved.ok) {
    throw new Error(`픽스처가 SessionContext 를 얻지 못했습니다: ${resolved.reason}`)
  }

  const email = await queryOne<{ email: string }>(
    `SELECT email FROM user_email WHERE user_id = $1 AND is_primary LIMIT 1`,
    [user.userId],
  )

  return { userId: user.userId, email: email.email, token: issued.token, ctx: resolved.context }
}

/** 워크스페이스 + owner 한 명. 대부분의 테스트가 필요로 하는 최소 조합. */
export async function makeFixture(): Promise<Fixture> {
  const workspaceId = await createBareWorkspace()
  const user = await createUser()
  const owner = await joinAs(workspaceId, user, 'owner')
  return { workspaceId, owner }
}
