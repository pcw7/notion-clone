/**
 * 대기 중인 초대의 취소 — Teamspace · 게스트 · 그룹 7g-3조각 (F-14-10 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ owner · membership_admin 이 멤버 초대와 게스트의 대기 초대를 취소한다 — 목록에서 빠지고 · 링크가 죽고(미리보기 · 수락) ·
 *      취소한 주소를 돌려준다
 *   ② ★ 초대를 다룰 역할이 아니면 forbidden — 없는 id 에도(있는지 말하지 않는다) · 아무것도 바뀌지 않는다
 *   ③ not_found — 없는 id · uuid 가 아님 · 다른 워크스페이스의 초대 · 이미 받아들인 초대 · 이미 취소한 초대
 *   ④ 취소한 뒤 다시 초대하면 새 대기 초대 — 새 링크로 받는다(옛 링크는 죽은 채)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { inviteGuestToPage } from './guest.ts'
import { acceptInvite, createEmailInvite, previewInvite, revokeInvite } from './invite.ts'
import { listPendingInvites } from './list.ts'

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
const unique = (name: string): string => `${name} ${(seq += 1)}`
const freshEmail = () => `revoke-${randomUUID().slice(0, 8)}@example.com`

async function office() {
  const ws = await createBareWorkspace('초대 취소')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

/** 멤버 초대 하나 — id · 토큰. */
async function memberInvite(by: Actor, email: string) {
  const made = await createEmailInvite({
    workspaceId: by.ctx.workspaceId,
    inviterUserId: by.userId,
    inviterRole: by.ctx.role,
    email,
    role: 'member',
  })
  assert.ok(made.ok)
  return { inviteId: made.inviteId, token: made.token }
}

/** 계정이 없는 이메일에게 게스트의 대기 초대 하나(7g-1) — id · 토큰. */
async function guestInvite(by: Actor, email: string) {
  const page = (await createPage(by.ctx, { privateTop: true, title: titleFromPlainText(unique('문서')) })).id
  const made = await inviteGuestToPage(by.ctx, page, email, 'comment')
  assert.ok(made.ok && made.value.as === 'pending')
  const row = (
    await query<{ id: string }>(`SELECT id FROM workspace_invite WHERE page_id = $1 AND email = $2 AND revoked_at IS NULL`, [page, email])
  )[0]
  assert.ok(row)
  return { inviteId: row.id, token: made.value.token, page }
}

const pendingIds = async (ws: string) => (await listPendingInvites(ws)).map((i) => i.inviteId).sort()

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 취소', () => {
  test('★ owner · membership_admin 이 멤버 초대와 게스트의 대기 초대를 취소한다 — 목록에서 빠지고 링크가 죽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const admin = await person('인사 담당', 'membership_admin')
    const memberEmail = freshEmail()
    const guestEmail = freshEmail()
    const member = await memberInvite(boss, memberEmail)
    const guest = await guestInvite(boss, guestEmail)
    assert.deepEqual(await pendingIds(ws), [member.inviteId, guest.inviteId].sort())

    assert.deepEqual(await revokeInvite(boss.ctx, member.inviteId), { ok: true, value: { email: memberEmail } })
    assert.deepEqual(await revokeInvite(admin.ctx, guest.inviteId), { ok: true, value: { email: guestEmail } })
    assert.deepEqual(await pendingIds(ws), [], '취소한 초대가 목록에 남았다')
    assert.equal(await previewInvite(member.token), null, '취소한 멤버 초대의 링크가 열린다')
    assert.equal(await previewInvite(guest.token), null, '취소한 게스트 초대의 링크가 열린다')

    // 받는 사람이 이제 가입해도(같은 이메일) 받아들일 수 없다.
    const late = await createUser('늦게 온 사람')
    await query(`UPDATE user_email SET email = $2 WHERE user_id = $1`, [late.userId, memberEmail])
    assert.deepEqual(await acceptInvite(member.token, late.userId), { ok: false, reason: 'invalid' })
    const joined = await query(`SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`, [ws, late.userId])
    assert.equal(joined.length, 0, '취소한 초대로 들어왔다')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 다룰 역할', () => {
  test('★ 멤버 · 게스트는 forbidden — 없는 id 에도 · 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const member = await person('멤버')
    const guest = await person('손님', 'guest')
    const invite = await memberInvite(boss, freshEmail())

    for (const who of [member, guest]) {
      assert.deepEqual(await revokeInvite(who.ctx, invite.inviteId), { ok: false, reason: 'forbidden' })
      assert.deepEqual(await revokeInvite(who.ctx, randomUUID()), { ok: false, reason: 'forbidden' }, '역할보다 초대의 유무를 먼저 말한다')
    }
    assert.deepEqual(await pendingIds(ws), [invite.inviteId], '거부됐는데 초대가 사라졌다')
    assert.ok(await previewInvite(invite.token))
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 그런 대기 초대가 없다', () => {
  test('없는 id · uuid 가 아님 · 다른 워크스페이스 · 이미 받아들임 · 이미 취소함 — not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const elsewhere = await office()
    const foreign = await memberInvite(elsewhere.boss, freshEmail())

    const taker = await createUser('받을 사람')
    const taken = await memberInvite(boss, taker.email)
    assert.ok((await acceptInvite(taken.token, taker.userId)).ok)

    const twice = await memberInvite(boss, freshEmail())
    assert.ok((await revokeInvite(boss.ctx, twice.inviteId)).ok)

    for (const id of [randomUUID(), 'not-a-uuid', foreign.inviteId, taken.inviteId, twice.inviteId]) {
      assert.deepEqual(await revokeInvite(boss.ctx, id), { ok: false, reason: 'not_found' }, id)
    }
    assert.ok(await previewInvite(foreign.token), '다른 워크스페이스의 초대가 죽었다')
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 다시 초대', () => {
  test('취소한 뒤 다시 초대하면 새 대기 초대 — 새 링크는 열리고 옛 링크는 죽은 채', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const email = freshEmail()
    const first = await guestInvite(boss, email)
    assert.ok((await revokeInvite(boss.ctx, first.inviteId)).ok)

    const again = await inviteGuestToPage(boss.ctx, first.page, email, 'view')
    assert.ok(again.ok && again.value.as === 'pending')
    const ids = await pendingIds(ws)
    assert.equal(ids.length, 1)
    assert.notEqual(ids[0], first.inviteId, '취소한 초대를 되살렸다')
    assert.ok(await previewInvite(again.value.token))
    assert.equal(await previewInvite(first.token), null)
  })
})
