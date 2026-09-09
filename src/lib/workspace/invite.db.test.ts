/**
 * 워크스페이스 생성 · 초대 · 수락 통합 테스트 — F-14-10 / F-02-17
 *
 * 이 기능의 위험은 "링크를 가진 아무나 남의 워크스페이스에 들어가는 것"이다.
 * 그래서 실패 경로를 성공 경로보다 많이 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'
process.env.MAIL_TRANSPORT ??= 'console'
process.env.DATABASE_URL ??= 'postgresql://notion:notion_dev_only@localhost:5432/notion'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let available = false
let skipReason = ''
let pool: typeof import('../db/pool.ts')
let ws: typeof import('./create.ts')
let inv: typeof import('./invite.ts')

const freshEmail = () => `wsi-${randomUUID().slice(0, 8)}@example.com`

/** 검증된 이메일을 가진 사용자를 만든다. */
async function makeUser(email = freshEmail()): Promise<{ userId: string; email: string }> {
  const userId = randomUUID()
  const emailId = randomUUID()
  const { withTransaction } = await import('../db/tx.ts')
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,'테스트',$2, now())`,
      [userId, emailId],
    )
    await tx.query(
      `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
       VALUES ($1,$2,$3, now(), true, now())`,
      [emailId, userId, email],
    )
  })
  return { userId, email }
}

before(async () => {
  try {
    pool = await import('../db/pool.ts')
    ws = await import('./create.ts')
    inv = await import('./invite.ts')
    await pool.query('SELECT 1')
    available = true
  } catch (e) {
    skipReason = `DB 사용 불가: ${(e as Error).message.split('\n')[0]}`
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (available) await pool.closePool().catch(() => {})
})

describe('createWorkspace — F-02-17', () => {
  test('생성자가 owner 로 활성 멤버가 된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const created = await ws.createWorkspace({ ownerUserId: owner.userId, name: '내 워크스페이스' })

    const [m] = await pool.query<{ role: string; status: string; join_method: string | null }>(
      `SELECT role, status, join_method FROM workspace_member
        WHERE workspace_id = $1 AND user_id = $2`,
      [created.workspaceId, owner.userId],
    )
    assert.equal(m.role, 'owner')
    assert.equal(m.status, 'active')
    assert.equal(m.join_method, null, '직접 만든 것은 초대 경로가 아니다')
  })

  test('좌석 1개로 계산된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const created = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'seat' })
    const [s] = await pool.query<{ seats: string }>(
      `SELECT seats FROM workspace_seat_count WHERE workspace_id = $1`, [created.workspaceId],
    )
    assert.equal(Number(s.seats), 1)
  })

  test('이름 정규화 — 빈 이름과 과도한 길이를 거부한다', async (t) => {
    if (!available) return t.skip(skipReason)

    assert.equal(ws.normalizeWorkspaceName('  '), null)
    assert.equal(ws.normalizeWorkspaceName(''), null)
    assert.equal(ws.normalizeWorkspaceName('a'.repeat(101)), null)
    assert.equal(ws.normalizeWorkspaceName('  내   워크스페이스  '), '내 워크스페이스')
  })
})

describe('createEmailInvite — 권한과 중복', () => {
  test('member 는 초대할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'perm' })
    const result = await inv.createEmailInvite({
      workspaceId: w.workspaceId,
      inviterUserId: owner.userId,
      inviterRole: 'member',
      email: freshEmail(),
      role: 'member',
    })
    assert.equal(result.ok, false)
    assert.equal((result as { reason: string }).reason, 'forbidden')
  })

  test('owner 와 membership_admin 은 초대할 수 있다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'perm2' })
    for (const role of ['owner', 'membership_admin']) {
      const r = await inv.createEmailInvite({
        workspaceId: w.workspaceId,
        inviterUserId: owner.userId,
        inviterRole: role,
        email: freshEmail(),
        role: 'member',
      })
      assert.equal(r.ok, true, `${role} 이 초대하지 못한다`)
    }
  })

  test('이미 멤버인 이메일은 거부한다 — 좌석 중복 금지', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'dup' })
    const result = await inv.createEmailInvite({
      workspaceId: w.workspaceId,
      inviterUserId: owner.userId,
      inviterRole: 'owner',
      email: owner.email,
      role: 'member',
    })
    assert.equal((result as { reason: string }).reason, 'already_member')
  })

  test('재초대는 역할과 토큰을 갱신하고 옛 링크를 무효화한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'reinvite' })
    const target = freshEmail()

    const first = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target, role: 'member',
    })
    const second = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target, role: 'membership_admin',
    })

    assert.ok(first.ok && second.ok)
    assert.equal(second.inviteId, first.inviteId, '행은 하나만 유지한다')
    assert.notEqual(second.token, first.token)

    // 옛 토큰은 더 이상 통하지 않는다 — 역할이 바뀐 초대를 옛 링크로 수락할 수 없다
    assert.equal(await inv.previewInvite(first.token), null)
    const preview = await inv.previewInvite(second.token)
    assert.equal(preview?.role, 'membership_admin')
  })
})

describe('토큰은 해시로만 저장된다', () => {
  test('DB 에 원문이 남지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'hash' })
    const r = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: freshEmail(), role: 'member',
    })
    assert.ok(r.ok)

    const [row] = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM workspace_invite WHERE id = $1`, [r.inviteId],
    )
    assert.notEqual(row.token_hash, r.token)
    assert.equal(row.token_hash, inv.hashInviteToken(r.token))
  })
})

describe('acceptInvite — 실패 경로', () => {
  test('없는 토큰은 invalid', async (t) => {
    if (!available) return t.skip(skipReason)
    const u = await makeUser()
    const r = await inv.acceptInvite('does-not-exist', u.userId)
    assert.equal((r as { reason: string }).reason, 'invalid')
  })

  test('다른 사람의 초대는 수락할 수 없다 — 링크만으로는 부족하다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'mismatch' })
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: freshEmail(), role: 'member',
    })
    assert.ok(invited.ok)

    // 초대받지 않은 사람이 링크를 손에 넣었다
    const stranger = await makeUser()
    const r = await inv.acceptInvite(invited.token, stranger.userId)
    assert.equal((r as { reason: string }).reason, 'email_mismatch',
      '링크를 가진 아무나 들어올 수 있으면 초대가 무의미하다')
  })

  test('미검증 이메일로는 수락할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'unverified' })
    const target = freshEmail()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target, role: 'member',
    })
    assert.ok(invited.ok)

    // 그 주소를 **미검증** 별칭으로 등록한 사용자
    const other = await makeUser()
    await pool.query(
      `INSERT INTO user_email (id, user_id, email, added_at) VALUES ($1,$2,$3, now())`,
      [randomUUID(), other.userId, target],
    )

    const r = await inv.acceptInvite(invited.token, other.userId)
    assert.equal((r as { reason: string }).reason, 'email_mismatch',
      '미검증 주소를 인정하면 아무 주소나 등록해 초대를 가로챌 수 있다')
  })

  test('취소된 초대는 수락할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'revoked' })
    const target = await makeUser()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(invited.ok)

    assert.equal(await inv.revokeInvite(invited.inviteId, w.workspaceId, 'owner'), true)
    const r = await inv.acceptInvite(invited.token, target.userId)
    assert.equal((r as { reason: string }).reason, 'invalid')
  })

  test('만료된 초대는 수락할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'expired' })
    const target = await makeUser()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(invited.ok)
    await pool.query(
      `UPDATE workspace_invite SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [invited.inviteId],
    )

    const r = await inv.acceptInvite(invited.token, target.userId)
    assert.equal((r as { reason: string }).reason, 'invalid')
  })
})

describe('acceptInvite — 성공 경로', () => {
  test('멤버가 되고 초대가 소비된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'accept' })
    const target = await makeUser()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(invited.ok)

    const r = await inv.acceptInvite(invited.token, target.userId)
    assert.equal(r.ok, true)

    const [m] = await pool.query<{ role: string; status: string; join_method: string }>(
      `SELECT role, status, join_method FROM workspace_member
        WHERE workspace_id = $1 AND user_id = $2`,
      [w.workspaceId, target.userId],
    )
    assert.equal(m.status, 'active')
    assert.equal(m.role, 'member')
    assert.equal(m.join_method, 'invite_email')

    const [s] = await pool.query<{ seats: string }>(
      `SELECT seats FROM workspace_seat_count WHERE workspace_id = $1`, [w.workspaceId],
    )
    assert.equal(Number(s.seats), 2, 'owner + 새 멤버')
  })

  test('같은 초대를 두 번 수락할 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'twice' })
    const target = await makeUser()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(invited.ok)

    assert.equal((await inv.acceptInvite(invited.token, target.userId)).ok, true)
    assert.equal((await inv.acceptInvite(invited.token, target.userId)).ok, false)
  })

  test('동시에 수락해도 좌석이 한 번만 늘어난다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'race' })
    const target = await makeUser()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(invited.ok)

    const results = await Promise.all([
      inv.acceptInvite(invited.token, target.userId),
      inv.acceptInvite(invited.token, target.userId),
      inv.acceptInvite(invited.token, target.userId),
    ])
    assert.equal(results.filter((r) => r.ok).length, 1, 'FOR UPDATE 가 없으면 좌석이 중복 소비된다')

    const [s] = await pool.query<{ seats: string }>(
      `SELECT seats FROM workspace_seat_count WHERE workspace_id = $1`, [w.workspaceId],
    )
    assert.equal(Number(s.seats), 2)
  })

  test('제거됐던 멤버가 재초대로 복귀한다 (불변식 M1)', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'rejoin' })
    const target = await makeUser()

    const first = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(first.ok)
    await inv.acceptInvite(first.token, target.userId)

    // 제거는 삭제가 아니라 상태 전이다
    await pool.query(
      `UPDATE workspace_member SET status = 'removed', removed_at = now()
        WHERE workspace_id = $1 AND user_id = $2`,
      [w.workspaceId, target.userId],
    )

    const second = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(second.ok, '제거된 멤버는 다시 초대할 수 있어야 한다')
    const r = await inv.acceptInvite(second.token, target.userId)
    assert.equal(r.ok, true)

    const [m] = await pool.query<{ status: string; removed_at: Date | null }>(
      `SELECT status, removed_at FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [w.workspaceId, target.userId],
    )
    assert.equal(m.status, 'active')
    assert.equal(m.removed_at, null)
  })

  test('수락하면 권한 캐시 세대가 올라간다', async (t) => {
    if (!available) return t.skip(skipReason)

    const owner = await makeUser()
    const w = await ws.createWorkspace({ ownerUserId: owner.userId, name: 'gen' })
    const target = await makeUser()
    const invited = await inv.createEmailInvite({
      workspaceId: w.workspaceId, inviterUserId: owner.userId, inviterRole: 'owner',
      email: target.email, role: 'member',
    })
    assert.ok(invited.ok)

    const before = await pool.query<{ perm_gen: string }>(
      `SELECT perm_gen FROM "user" WHERE id = $1`, [target.userId],
    )
    await inv.acceptInvite(invited.token, target.userId)
    const after = await pool.query<{ perm_gen: string }>(
      `SELECT perm_gen FROM "user" WHERE id = $1`, [target.userId],
    )

    assert.ok(
      Number(after[0].perm_gen) > Number(before[0].perm_gen),
      '멤버십이 바뀌면 perm_gen 을 올려야 낡은 권한 판정이 안 남는다',
    )
  })
})
