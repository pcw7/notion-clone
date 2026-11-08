/**
 * 계정 삭제 — AD-2 (F-14-13 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-2] ① ~ ⑤
 *
 *   ① ★ 미리보기 — 혼자면 delete · 다른 owner 가 있거나 멤버면 leave · 유일한 owner 면 blocked(sole_owner) · teamspace 의 마지막 owner 면 blocked
 *   ② ★ 실행 — 이메일이 다르면 거부 · blocked 면 아무것도 안 바꾼다 · 성공하면 지움/나감 · tombstone · 세션 폐기 · 자격 증명/이메일 삭제 · 같은 이메일로 다시 가입
 *   ③ ★ 남는 것 — 만든 블록의 created_by 는 그대로, 이름만 "삭제된 사용자" · 위임 자동화는 거부된다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createDbAutomation } from '../automation/db-automation.ts'
import { editorNames } from '../block/edit-info.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDatabase } from '../database/database.ts'
import { query, queryOne } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { createTeamspace } from '../workspace/teamspace.ts'
import { changeMemberRole } from '../workspace/member.ts'
import { DELETED_USER_NAME, deleteAccount, previewAccountDeletion } from './account-deletion.ts'
import { establishLogin } from './establish-login.ts'
import { resolveDelegatedContext, resolveSessionContext } from './session-context.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

let seq = 0
const unique = (base: string): string => `${base}-${Date.now().toString(36)}-${(seq += 1)}`

/** 사람 하나가 든 워크스페이스 이름 → 결과. */
async function outcomes(userId: string) {
  const preview = await previewAccountDeletion(userId)
  assert.ok(preview)
  return new Map(preview.workspaces.map((w) => [w.name, w]))
}

describe('① 미리보기', () => {
  test('★ 혼자면 delete · owner 가 또 있으면 leave · 멤버면 leave · 유일한 owner 면 blocked · teamspace 의 마지막 owner 면 blocked', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await createUser('나')
    const names = { solo: unique('혼자'), co: unique('공동'), member: unique('멤버'), sole: unique('유일'), team: unique('팀') }

    const solo = await createBareWorkspace(names.solo)
    await joinAs(solo, me, 'owner')

    const co = await createBareWorkspace(names.co)
    await joinAs(co, me, 'owner')
    await joinAs(co, await createUser('공동 owner'), 'owner')

    const asMember = await createBareWorkspace(names.member)
    await joinAs(asMember, await createUser('대표'), 'owner')
    await joinAs(asMember, me, 'member')

    const sole = await createBareWorkspace(names.sole)
    await joinAs(sole, me, 'owner')
    await joinAs(sole, await createUser('동료'), 'member')

    const teamWs = await createBareWorkspace(names.team)
    const meInTeam = await joinAs(teamWs, me, 'member')
    await joinAs(teamWs, await createUser('대표'), 'owner')
    const teamspaceName = unique('공방')
    unwrap(await createTeamspace(meInTeam.ctx, { name: teamspaceName }))

    const got = await outcomes(me.userId)
    assert.equal(got.get(names.solo)?.outcome, 'delete')
    assert.equal(got.get(names.co)?.outcome, 'leave')
    assert.equal(got.get(names.member)?.outcome, 'leave')
    assert.deepEqual([got.get(names.sole)?.outcome, got.get(names.sole)?.reason], ['blocked', 'sole_owner'])
    assert.deepEqual([got.get(names.team)?.outcome, got.get(names.team)?.reason, got.get(names.team)?.teamspaces], ['blocked', 'teamspace_last_owner', [teamspaceName]])
    assert.equal((await previewAccountDeletion(me.userId))?.email, me.email)
  })
})

describe('② 실행', () => {
  test('★ 이메일이 다르면 거부 · blocked 면 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await createUser('나')
    const solo = await createBareWorkspace(unique('혼자'))
    const mine = await joinAs(solo, me, 'owner')
    const sole = await createBareWorkspace(unique('유일'))
    await joinAs(sole, me, 'owner')
    await joinAs(sole, await createUser('동료'), 'member')

    for (const bad of ['', 'x@example.com', null, 5]) {
      assert.deepEqual(await deleteAccount(me.userId, { confirmEmail: bad }), { ok: false, reason: 'email_mismatch' })
    }
    const blocked = await deleteAccount(me.userId, { confirmEmail: me.email })
    assert.equal(blocked.ok, false)
    assert.ok(!blocked.ok && blocked.reason === 'blocked')
    assert.ok(!blocked.ok && blocked.reason === 'blocked' && blocked.preview.workspaces.some((w) => w.outcome === 'blocked'))

    const user = await queryOne<{ status: string; name: string }>(`SELECT status, name FROM "user" WHERE id = $1`, [me.userId])
    assert.deepEqual([user.status, user.name], ['active', '나'])
    const ws = await queryOne<{ deleted_at: Date | null }>(`SELECT deleted_at FROM workspace WHERE id = $1`, [solo])
    assert.equal(ws.deleted_at, null, '혼자인 워크스페이스도 지우지 않았다')
    assert.ok((await resolveSessionContext(mine.token, solo)).ok, '세션도 살아 있다')
  })

  test('★ 성공 — 지우고 나가고 · tombstone · 세션 폐기 · 자격 증명 · 2단계 · 이메일 삭제 · 같은 이메일로 다시 가입', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await createUser('나')
    const soloName = unique('혼자')
    const solo = await createBareWorkspace(soloName)
    const mine = await joinAs(solo, me, 'owner')
    const shared = await createBareWorkspace(unique('공동'))
    const boss = await joinAs(shared, await createUser('남는 사람'), 'owner')
    const mineShared = await joinAs(shared, me, 'member')

    await query(`UPDATE "user" SET avatar_url = 'https://example.com/a.png' WHERE id = $1`, [me.userId])
    await query(`INSERT INTO credential (id, user_id, kind, password_hash, created_at) VALUES (gen_random_uuid(), $1, 'password', '$argon2id$v=19$m=19456,t=2,p=1$AAAA$BBBB', now())`, [me.userId])
    await query(`INSERT INTO mfa_method (id, user_id, kind, label, created_at) VALUES (gen_random_uuid(), $1, 'totp', 't', now())`, [me.userId])
    await query(`INSERT INTO mfa_backup_code (user_id, code_hash, batch_id) VALUES ($1, 'h', gen_random_uuid())`, [me.userId])

    const page = await createPage(mineShared.ctx, { title: titleFromPlainText('내가 만든 페이지') })
    const db = unwrap(await createDatabase(mineShared.ctx, { name: '표' }))
    const auto = unwrap(await createDbAutomation(mineShared.ctx, db.dataSourceId, { name: '자동화', triggers: [{ type: 'page_added' }], actions: [] }))
    assert.ok((await resolveDelegatedContext(shared, auto.id)).ok)

    const result = await deleteAccount(me.userId, { confirmEmail: me.email.toUpperCase() })
    assert.ok(result.ok, JSON.stringify(result))
    assert.deepEqual(result.ok && result.workspaces.map((w) => w.outcome).sort(), ['delete', 'leave'])

    const user = await queryOne<{ status: string; name: string; deleted_at: Date | null; avatar_url: string | null; primary_email_id: string | null }>(
      `SELECT status, name, deleted_at, avatar_url, primary_email_id FROM "user" WHERE id = $1`,
      [me.userId],
    )
    assert.equal(user.status, 'deleted')
    assert.equal(user.name, DELETED_USER_NAME)
    assert.ok(user.deleted_at)
    assert.equal(user.avatar_url, null)
    assert.equal(user.primary_email_id, null)

    assert.deepEqual(await resolveSessionContext(mine.token, solo), { ok: false, reason: 'revoked' }, '옛 토큰은 쓸 수 없다')
    assert.deepEqual(await resolveSessionContext(mineShared.token, shared), { ok: false, reason: 'revoked' })
    const reason = await queryOne<{ revoked_reason: string }>(`SELECT revoked_reason FROM user_session WHERE token_hash IS NOT NULL AND user_id = $1 LIMIT 1`, [me.userId])
    assert.equal(reason.revoked_reason, 'account_deleted')
    for (const table of ['credential', 'mfa_method', 'mfa_backup_code', 'user_email']) {
      const n = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [me.userId])
      assert.equal(Number(n.n), 0, table)
    }

    const soloRow = await queryOne<{ deleted_at: Date | null; deleted_by: string | null }>(`SELECT deleted_at, deleted_by FROM workspace WHERE id = $1`, [solo])
    assert.ok(soloRow.deleted_at, '혼자인 워크스페이스는 지웠다')
    assert.equal(soloRow.deleted_by, me.userId)
    const audit = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM audit_event WHERE workspace_id = $1 AND event_type = 'workspace.deleted'`, [solo])
    assert.equal(Number(audit.n), 1)

    const member = await queryOne<{ status: string }>(`SELECT status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`, [shared, me.userId])
    assert.equal(member.status, 'removed', '공동 워크스페이스에서는 나갔다')
    assert.ok((await resolveSessionContext(boss.token, shared)).ok, '남은 사람은 그대로 쓴다')

    // ③ 남는 것
    const block = await queryOne<{ created_by: string }>(`SELECT created_by FROM block WHERE id = $1`, [page.id])
    assert.equal(block.created_by, me.userId, 'created_by 는 옛 id 그대로')
    assert.equal((await editorNames(boss.ctx, [me.userId])).get(me.userId), DELETED_USER_NAME)
    assert.deepEqual(await resolveDelegatedContext(shared, auto.id), { ok: false, reason: 'creator_left' }, '만든 사람이 없는 자동화는 돌지 않는다')

    // 같은 이메일로 다시 가입
    const again = await establishLogin({ email: me.email, existingUserId: null, authMethod: 'login_code', ip: null, userAgent: null })
    assert.equal(again.created, true)
    const fresh = await queryOne<{ id: string; status: string }>(
      `SELECT u.id, u.status FROM user_email ue JOIN "user" u ON u.id = ue.user_id WHERE ue.email = $1`,
      [me.email],
    )
    assert.notEqual(fresh.id, me.userId)
    assert.equal(fresh.status, 'active')
  })

  test('★ 막힌 것을 풀면(다른 사람을 owner 로) 지워진다 · 두 번째는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const me = await createUser('나')
    const ws = await createBareWorkspace(unique('넘기기'))
    const mine = await joinAs(ws, me, 'owner')
    const other = await joinAs(ws, await createUser('후임'), 'member')
    assert.equal((await deleteAccount(me.userId, { confirmEmail: me.email })).ok, false)
    unwrap(await changeMemberRole(mine.ctx, other.userId, 'owner'))
    const done = await deleteAccount(me.userId, { confirmEmail: me.email })
    assert.ok(done.ok, JSON.stringify(done))
    assert.deepEqual(await deleteAccount(me.userId, { confirmEmail: me.email }), { ok: false, reason: 'not_found' })
    assert.equal(await previewAccountDeletion(me.userId), null)
  })
})
