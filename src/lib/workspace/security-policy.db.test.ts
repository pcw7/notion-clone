/**
 * 보안 정책 — 내보내기 · 멤버의 게스트 초대 — 게시 · 공유 6e-1조각 (F-06-11 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 [보강] 보안 정책).
 *
 *   ① ★ 내보내기 — 끄면 멤버의 페이지 내보내기는 policy_disabled · 소유자는 된다 · 켜면 다시 된다
 *   ② ★ 게스트 — 끄면 멤버가 게스트에게 주는 모든 길이 막힌다: 공유 패널의 게스트 부여 · 이메일 초대(있는 계정 · 대기 초대) ·
 *      밖의 사람의 접근 요청 허락 — 막힌 길은 아무것도 남기지 않는다(멤버십 · 대기 초대 · 요청은 대기 그대로)
 *   ③ 막지 않는 것 — 멤버에게 주는 공유 · 소유자 · 멤버 관리자의 게스트 초대 · 이미 들어온 게스트의 접근
 *   ④ ★ 대기 초대의 수락은 초대한 사람의 지금 역할로 — 정책이 바뀐 뒤 멤버가 보냈던 초대는 들어오지 않는다 · 소유자의 초대는 들어온다
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { queryOne, query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { prepareExport } from '../export/download.ts'
import type { BlockId } from '../ids.ts'
import { approveAccessRequest, requestAccessAsOutsider } from '../permissions/access-request.ts'
import { grantAccess } from '../permissions/acl.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, visitAsOutsider, type Actor } from '../testing/db-fixtures.ts'
import { inviteGuestToPage } from './guest.ts'
import { acceptInvite } from './invite.ts'

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
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)} ${Date.now()}`

async function office() {
  const ws = await createBareWorkspace('보안 정책')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

/** 멤버가 전체 권한을 가진 페이지 — 워크스페이스 최상위(모두가 본다) 위에 그 멤버에게 전체 권한. */
async function pageFor(boss: Actor, member: Actor): Promise<BlockId> {
  const page = await createPage(boss.ctx, { title: titleFromPlainText(unique('정책 문서')) })
  assert.ok((await grantAccess(boss.ctx, page.id, { type: 'user', id: member.userId }, 'full_access')).ok)
  return page.id
}

const setPolicy = async (owner: Actor, key: 'workspace.allow_export' | 'workspace.allow_member_invite_guests', value: boolean) =>
  assert.deepEqual(await updateSetting(owner.ctx, key, value), { ok: true, value })

const emailOf = async (userId: string) => (await queryOne<{ email: string }>(`SELECT email FROM user_email WHERE user_id = $1`, [userId])).email

// ── ① 내보내기 ────────────────────────────────────────────────────────

describe('① ★ 내보내기', () => {
  test('끄면 멤버의 페이지 내보내기는 policy_disabled · 소유자는 된다 · 켜면 다시 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const mate = await person('동료')
    const doc = await pageFor(boss, mate)
    assert.ok((await prepareExport(mate.ctx, { kind: 'page', rootId: doc })).ok)

    await setPolicy(boss, 'workspace.allow_export', false)
    assert.deepEqual(await prepareExport(mate.ctx, { kind: 'page', rootId: doc }), { ok: false, reason: 'policy_disabled' })
    assert.ok((await prepareExport(boss.ctx, { kind: 'page', rootId: doc })).ok, '소유자는 된다')
    assert.ok((await prepareExport(boss.ctx, { kind: 'workspace' })).ok)

    await setPolicy(boss, 'workspace.allow_export', true)
    assert.ok((await prepareExport(mate.ctx, { kind: 'page', rootId: doc })).ok)
  })
})

// ── ② 게스트 ──────────────────────────────────────────────────────────

describe('② ★ 멤버의 게스트 초대', () => {
  test('끄면 멤버가 게스트에게 주는 모든 길이 막히고 아무것도 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const mate = await person('동료')
    const doc = await pageFor(boss, mate)
    const guest = await person('이미 게스트', 'guest')
    const account = await createUser('계정 있는 밖의 사람')
    const outsider = await visitAsOutsider(ws, await createUser('요청하는 밖의 사람'))
    assert.ok((await requestAccessAsOutsider(outsider.outsider, doc)).ok)
    const request = await queryOne<{ id: string }>(`SELECT id FROM access_request WHERE node_id = $1 AND requester_id = $2`, [doc, outsider.userId])

    await setPolicy(boss, 'workspace.allow_member_invite_guests', false)

    assert.deepEqual(await grantAccess(mate.ctx, doc, { type: 'user', id: guest.userId }, 'view'), { ok: false, reason: 'policy_disabled' })
    assert.deepEqual(await inviteGuestToPage(mate.ctx, doc, await emailOf(account.userId), 'view'), { ok: false, reason: 'policy_disabled' })
    assert.deepEqual(await inviteGuestToPage(mate.ctx, doc, `${unique('nobody').replace(/\s+/g, '-')}@example.com`, 'view'), {
      ok: false,
      reason: 'policy_disabled',
    })
    assert.deepEqual(await approveAccessRequest(mate.ctx, request.id, 'view'), { ok: false, reason: 'policy_disabled' })

    const members = await query<{ user_id: string }>(`SELECT user_id FROM workspace_member WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])`, [
      ws,
      [account.userId, outsider.userId],
    ])
    assert.deepEqual(members, [], '막힌 초대 · 허락은 멤버십을 남기지 않는다')
    const pending = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM workspace_invite WHERE workspace_id = $1 AND role = 'guest'`, [ws])
    assert.equal(pending.n, 0, '대기 초대도 남기지 않는다')
    const status = await queryOne<{ status: string }>(`SELECT status FROM access_request WHERE id = $1`, [request.id])
    assert.equal(status.status, 'pending', '요청은 대기 그대로')
  })
})

// ── ③ 막지 않는 것 ────────────────────────────────────────────────────

describe('③ 막지 않는 것', () => {
  test('멤버에게 주는 공유 · 소유자 · 멤버 관리자의 게스트 초대 · 이미 들어온 게스트의 접근', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const mate = await person('동료')
    const other = await person('다른 멤버')
    const admin = await person('멤버 관리자', 'membership_admin')
    const doc = await pageFor(boss, mate)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: admin.userId }, 'full_access')).ok)
    const guest = await person('들어와 있던 게스트', 'guest')
    assert.ok((await grantAccess(mate.ctx, doc, { type: 'user', id: guest.userId }, 'view')).ok)

    await setPolicy(boss, 'workspace.allow_member_invite_guests', false)

    assert.ok((await grantAccess(mate.ctx, doc, { type: 'user', id: other.userId }, 'comment')).ok, '멤버에게는 준다')
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: guest.userId }, 'comment')).ok, '소유자는 게스트에게도')
    const newGuest = await createUser('관리자가 들이는 손님')
    const admitted = await inviteGuestToPage(admin.ctx, doc, await emailOf(newGuest.userId), 'view')
    assert.ok(admitted.ok, JSON.stringify(admitted))
    const caps = await withReadTransaction((tx) => effectiveCaps(tx, guest.ctx, doc))
    assert.ok(can(caps, 'view'), '이미 들어온 게스트의 접근은 그대로')
  })
})

// ── ④ 대기 초대의 수락 ────────────────────────────────────────────────

describe('④ ★ 대기 초대의 수락은 초대한 사람의 지금 역할로', () => {
  test('정책이 바뀐 뒤 멤버가 보냈던 초대는 들어오지 않는다 · 소유자의 초대는 들어온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const mate = await person('동료')
    const doc = await pageFor(boss, mate)
    const late = `${unique('late').replace(/\s+/g, '-')}@example.com`
    const fromMate = await inviteGuestToPage(mate.ctx, doc, late, 'view')
    assert.ok(fromMate.ok && fromMate.value.as === 'pending', JSON.stringify(fromMate))
    const fromBossEmail = `${unique('boss-guest').replace(/\s+/g, '-')}@example.com`
    const fromBoss = await inviteGuestToPage(boss.ctx, doc, fromBossEmail, 'view')
    assert.ok(fromBoss.ok && fromBoss.value.as === 'pending')

    await setPolicy(boss, 'workspace.allow_member_invite_guests', false)

    const signUp = async (email: string) => {
      const user = await createUser('받는 사람')
      await query(`UPDATE user_email SET email = $2, verified_at = now() WHERE user_id = $1`, [user.userId, email])
      return user
    }
    const lateUser = await signUp(late)
    const bossGuest = await signUp(fromBossEmail)
    if (!fromMate.ok || fromMate.value.as !== 'pending' || !fromBoss.ok || fromBoss.value.as !== 'pending') throw new Error('unreachable')
    assert.deepEqual(await acceptInvite(fromMate.value.token, lateUser.userId), { ok: false, reason: 'page_unavailable' })
    const accepted = await acceptInvite(fromBoss.value.token, bossGuest.userId)
    assert.ok(accepted.ok, JSON.stringify(accepted))
  })
})
