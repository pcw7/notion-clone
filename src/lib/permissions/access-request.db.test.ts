/**
 * 접근 요청 — Teamspace · 게스트 · 그룹 7e-1 · 7e-2조각 (F-06-15 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 볼 수 없는 사람이 요청하면 대기 중인 요청 하나 · 관리자에게 알림 · 다시 눌러도 새 행 · 새 알림이 없다
 *   ② 요청할 수 없는 것 — 이미 볼 수 있다 · 휴지통 · 다른 워크스페이스 · 없는 id (아무것도 쓰지 않는다) · 보관된 teamspace 의 페이지
 *   ③ 동시에 두 번 눌러도 요청은 하나 · 알림도 한 번
 *   ④ ★ 목록은 공유할 수 있는 사람에게만 · 이미 볼 수 있게 된 사람의 요청은 세우지 않는다(다시 못 보면 다시 선다) · 떠난 사람의
 *      요청은 워크스페이스 밖의 요청으로 선다(7g-2 — 그쪽 검사는 outsider-request.db.test.ts)
 *   ⑤ ★ 허락 — 고른 레벨을 준다 · 요청한 사람에게 알림 · 이미 처리됨 · 공유할 수 없는 사람은 못 한다(아무것도 안 바뀐다)
 *   ⑥ ★ 허락은 권한을 낮추지 않는다 · 게스트에게 전체 권한은 거부하고 요청은 대기로 남는다 · 떠난 사람은 게스트로 돌아온다(7g-2)
 *   ⑦ ★ 무시는 알리지 않는다 · 하루 동안 요청한 사람에게 "보냈습니다" · 하루가 지나면 다시 보낼 수 있다
 *   ⑧ ★ 알림은 이름이 걸린 관리자에게 — 공유 권한을 가진 전원이 아니다 · 없으면 owner
 *   ⑨ 인박스 — 관리자는 요청한 사람의 이름과 **지금** 상태를 · 한 페이지의 요청은 한 줄 · 허락은 요청한 사람에게
 *   ⑩ 휴지통 · 영구 삭제된 페이지의 요청은 처리할 수 없다 · 휴지통에서 돌아오면 대기 중이던 요청도 돌아온다
 *   ⑪ (7e-2) ★ 편집 권한 요청 — 볼 수는 있지만 고칠 수 없는 사람만 · 요청 레벨은 편집 · 허락하면 고친다 · 이미 고칠 수 있게 된
 *      사람의 요청은 세우지 않는다 · 종류는 따로 센다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { purgePage, restorePage, trashPage } from '../block/trash.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { listInbox } from '../notification/inbox.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { archiveTeamspace, createTeamspace } from '../workspace/teamspace.ts'
import { grantAccess, revokeAccess } from './acl.ts'
import {
  approveAccessRequest,
  editRequestState,
  ignoreAccessRequest,
  listAccessRequests,
  noAccessState,
  requestEditAccess,
  requestPageAccess,
} from './access-request.ts'
import { canViewPage, effectiveCaps } from './effective.ts'
import { can } from './levels.ts'

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

async function office() {
  const ws = await createBareWorkspace('접근 요청')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

const page = async (by: Actor, where: { parentPageId?: BlockId; privateTop?: true } = {}) =>
  (await createPage(by.ctx, { ...where, title: titleFromPlainText(unique('문서')) })).id

const requestsOf = async (pageId: string) =>
  query<{ id: string; requester_id: string; status: string; decided_by: string | null }>(
    `SELECT id, requester_id, status, decided_by FROM access_request WHERE node_id = $1 ORDER BY created_at, id`,
    [pageId],
  )

const notified = async (pageId: string, kind: string) =>
  (
    await query<{ recipient_id: string }>(
      `SELECT recipient_id FROM notification WHERE page_id = $1 AND kind = $2 ORDER BY recipient_id`,
      [pageId, kind],
    )
  ).map((r) => r.recipient_id)

const directLevel = async (pageId: string, userId: string) =>
  (
    await query<{ level: string }>(
      `SELECT level FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [pageId, userId],
    )
  )[0]?.level ?? null

const sorted = (ids: readonly string[]) => [...ids].sort()

/** 대기 중인 요청 하나를 만든다 — 그 id 를 준다. */
async function asked(by: Actor, pageId: string): Promise<string> {
  assert.deepEqual(await requestPageAccess(by.ctx, pageId), { ok: true, value: { sent: true } })
  const row = (await requestsOf(pageId)).find((r) => r.requester_id === by.userId && r.status === 'pending')
  assert.ok(row, '대기 중인 요청이 없다')
  return row.id
}

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 요청', () => {
  test('★ 볼 수 없는 사람이 요청하면 대기 중인 요청 하나 · 관리자에게 알림 · 다시 눌러도 새 행 · 새 알림이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('요청하는 사람')
    await person('구경꾼')
    const doc = await page(boss, { privateTop: true })

    assert.deepEqual(await noAccessState(asker.ctx, doc), { requested: false })
    assert.deepEqual(await requestPageAccess(asker.ctx, doc), { ok: true, value: { sent: true } })
    const rows = await requestsOf(doc)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.requester_id, asker.userId)
    assert.equal(rows[0]?.status, 'pending')
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId], '관리자(만든 사람)만 받아야 한다')
    assert.deepEqual(await noAccessState(asker.ctx, doc), { requested: true })

    assert.deepEqual(await requestPageAccess(asker.ctx, doc), { ok: true, value: { sent: false } })
    assert.equal((await requestsOf(doc)).length, 1, '다시 눌렀더니 요청이 늘었다')
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId], '다시 눌렀더니 알림이 또 갔다')
    assert.equal(await canViewPage(asker.ctx, doc), false, '요청만으로 보이면 안 된다')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 요청할 수 없는 것', () => {
  test('이미 볼 수 있으면 has_access · 휴지통 · 다른 워크스페이스 · 없는 id 는 not_found — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const asker = await person('요청하는 사람')
    const open = await page(boss) // 워크스페이스 최상위 — 멤버 모두가 본다
    const trashed = await page(boss, { privateTop: true })
    await trashPage(boss.ctx, trashed as BlockId)
    const elsewhere = await office()
    const foreign = await page(elsewhere.boss, { privateTop: true })

    assert.deepEqual(await requestPageAccess(asker.ctx, open), { ok: false, reason: 'has_access' })
    assert.deepEqual(await requestPageAccess(boss.ctx, trashed), { ok: false, reason: 'not_found' })
    assert.deepEqual(await requestPageAccess(asker.ctx, trashed), { ok: false, reason: 'not_found' })
    assert.deepEqual(await requestPageAccess(asker.ctx, foreign), { ok: false, reason: 'not_found' })
    assert.deepEqual(await requestPageAccess(asker.ctx, randomUUID()), { ok: false, reason: 'not_found' })
    for (const id of [open, trashed, foreign]) assert.equal(await noAccessState(asker.ctx, id), null, id)

    const written = await query(`SELECT 1 FROM access_request WHERE workspace_id = $1`, [ws])
    assert.equal(written.length, 0, '거부했는데 요청이 남았다')
    assert.equal((await notified(open, 'access_requested')).length, 0)
  })

  test('보관된 teamspace 의 페이지 — 아무도 못 보고 되살릴 사람만 존재를 본다(7c-6) · 요청 화면도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('팀 밖의 사람')
    const team = await createTeamspace(boss.ctx, { name: unique('닫힌 팀'), visibility: 'closed' })
    assert.ok(team.ok)
    const doc = (await createPage(boss.ctx, { teamspaceId: team.value.id, title: titleFromPlainText(unique('팀 문서')) })).id
    assert.deepEqual(await noAccessState(asker.ctx, doc), { requested: false }, '전제 — 보관 전에는 요청할 수 있다')

    assert.ok((await archiveTeamspace(boss.ctx, team.value.id)).ok)
    assert.equal(await noAccessState(asker.ctx, doc), null)
    assert.deepEqual(await requestPageAccess(asker.ctx, doc), { ok: false, reason: 'not_found' })
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 동시에', () => {
  test('두 번을 동시에 눌러도 요청은 하나 · 알림도 한 번', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('성급한 사람')
    // 경합은 두 요청이 서로의 커밋 전에 "열린 요청 없음"을 볼 때만 난다 — 한 번이면 늦게 온 쪽이 먼저 것을 보고 비껴갈 수 있어서
    // (그러면 충돌 처리를 빼도 통과한다) 다섯 쌍을 한꺼번에 보낸다.
    const docs = await Promise.all([1, 2, 3, 4, 5].map(() => page(boss, { privateTop: true })))
    const pairs = await Promise.all(docs.map((doc) => Promise.all([requestPageAccess(asker.ctx, doc), requestPageAccess(asker.ctx, doc)])))

    for (const [i, doc] of docs.entries()) {
      assert.deepEqual(
        pairs[i]?.map((r) => (r.ok ? r.value.sent : r.reason)).sort(),
        [false, true],
        JSON.stringify(pairs[i]),
      )
      assert.equal((await requestsOf(doc)).length, 1)
      assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId])
    }
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 목록', () => {
  test('★ 공유할 수 있는 사람에게만 · 이미 볼 수 있게 된 사람의 요청은 세우지 않는다 · 떠난 사람은 밖의 요청으로 · 다시 못 보면 다시 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const asker = await person('요청하는 사람')
    const leaver = await person('떠날 사람')
    const viewer = await person('보기만')
    const stranger = await person('못 보는 사람')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    await asked(asker, doc)
    await asked(leaver, doc)

    const names = async () => {
      const listed = await listAccessRequests(boss.ctx, doc)
      assert.ok(listed.ok)
      return listed.value.map((r) => r.requesterId)
    }
    const outsiders = async () => {
      const listed = await listAccessRequests(boss.ctx, doc)
      assert.ok(listed.ok)
      return listed.value.filter((r) => r.outsider).map((r) => r.requesterId)
    }
    assert.deepEqual(await names(), [asker.userId, leaver.userId])
    assert.deepEqual(await listAccessRequests(viewer.ctx, doc), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await listAccessRequests(stranger.ctx, doc), { ok: false, reason: 'not_found' })

    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: asker.userId }, 'view')).ok)
    assert.deepEqual(await names(), [leaver.userId], '이미 볼 수 있게 된 사람의 요청이 선다')
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      ws,
      leaver.userId,
    ])
    // 떠난 사람은 워크스페이스 밖의 사람이다(7g-2) — 그 사람의 접근 요청은 밖의 요청으로 선다(허락하면 게스트로 돌아온다).
    assert.deepEqual(await outsiders(), [leaver.userId], '떠난 사람의 요청이 밖의 요청으로 서지 않는다')
    assert.ok((await revokeAccess(boss.ctx, doc, { type: 'user', id: asker.userId })).ok)
    assert.deepEqual(await names(), [asker.userId, leaver.userId], '다시 못 보게 됐는데 요청이 서지 않는다')
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 허락', () => {
  test('★ 고른 레벨을 준다 · 요청한 사람에게 알림 · 공유할 수 없는 사람은 못 한다 · 이미 처리됨', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('요청하는 사람')
    const viewer = await person('보기만')
    const stranger = await person('못 보는 사람')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    const id = await asked(asker, doc)

    assert.deepEqual(await approveAccessRequest(viewer.ctx, id, 'edit'), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await approveAccessRequest(stranger.ctx, id, 'edit'), { ok: false, reason: 'not_found' })
    assert.deepEqual(await ignoreAccessRequest(viewer.ctx, id), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'owner'), { ok: false, reason: 'invalid_level' })
    assert.deepEqual(await approveAccessRequest(boss.ctx, randomUUID(), 'edit'), { ok: false, reason: 'not_found' })
    assert.equal((await requestsOf(doc))[0]?.status, 'pending', '거부됐는데 요청이 처리됐다')
    assert.equal(await directLevel(doc, asker.userId), null, '거부됐는데 부여가 남았다')

    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'edit'), { ok: true, value: { granted: true } })
    assert.equal(await directLevel(doc, asker.userId), 'edit')
    const caps = await withReadTransaction((tx) => effectiveCaps(tx, asker.ctx, doc))
    assert.ok(can(caps, 'view') && can(caps, 'edit_content'), '허락받았는데 편집하지 못한다')
    assert.deepEqual(
      (await requestsOf(doc)).map((r) => [r.status, r.decided_by]),
      [['approved', boss.userId]],
    )
    assert.deepEqual(await notified(doc, 'access_granted'), [asker.userId])

    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'view'), { ok: false, reason: 'decided' })
    assert.deepEqual(await ignoreAccessRequest(boss.ctx, id), { ok: false, reason: 'decided' })
    assert.equal(await directLevel(doc, asker.userId), 'edit', '이미 처리된 요청이 레벨을 바꿨다')
  })
})

// ── ⑥ ─────────────────────────────────────────────────────────────────

describe('⑥ 허락의 한계', () => {
  test('★ 허락은 권한을 낮추지 않는다 — 이미 직접 받은 레벨이 고른 레벨을 품으면 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('요청하는 사람')
    const doc = await page(boss, { privateTop: true })
    const id = await asked(asker, doc)
    // 요청을 처리하기 전에 다른 길(공유 패널)로 편집을 받았다.
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: asker.userId }, 'edit')).ok)

    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'view'), { ok: true, value: { granted: false } })
    assert.equal(await directLevel(doc, asker.userId), 'edit', '허락이 편집을 읽기로 낮췄다')
    assert.equal((await requestsOf(doc))[0]?.status, 'approved')
  })

  test('★ 게스트에게 전체 권한은 거부하고 요청은 대기로 남는다 · 편집까지는 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const guest = await person('손님', 'guest')
    const doc = await page(boss, { privateTop: true })
    const id = await asked(guest, doc)

    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'full_access'), { ok: false, reason: 'guest_level' })
    assert.equal((await requestsOf(doc))[0]?.status, 'pending', '거부됐는데 요청이 처리됐다')
    assert.equal(await directLevel(doc, guest.userId), null)
    assert.deepEqual(await notified(doc, 'access_granted'), [], '거부됐는데 허락 알림이 갔다')

    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'edit'), { ok: true, value: { granted: true } })
    assert.equal(await directLevel(doc, guest.userId), 'edit')
  })

  test('떠난 사람의 요청을 허락하면 게스트로 돌아온다(7g-2) — 초대만 받은 사람에게는 주지 않는다(invalid_principal)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const leaver = await person('떠날 사람')
    const doc = await page(boss, { privateTop: true })
    const id = await asked(leaver, doc)
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      ws,
      leaver.userId,
    ])

    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'view'), { ok: true, value: { granted: true } })
    const back = await queryOne<{ role: string; status: string }>(
      `SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [ws, leaver.userId],
    )
    assert.deepEqual([back.role, back.status], ['guest', 'active'], '떠난 멤버는 게스트로 돌아온다(멤버로 돌아오지 않는다)')
    assert.equal(await directLevel(doc, leaver.userId), 'view')

    // 초대만 받은 사람(`invited`)은 밖의 사람도, 이 워크스페이스의 사람도 아니다 — 부여가 거부되고 요청은 대기로 남는다.
    const pending = await person('초대만 받은 사람')
    const other = await page(boss, { privateTop: true })
    const pendingId = await asked(pending, other)
    await query(`UPDATE workspace_member SET status = 'invited' WHERE workspace_id = $1 AND user_id = $2`, [ws, pending.userId])
    assert.deepEqual(await approveAccessRequest(boss.ctx, pendingId, 'view'), { ok: false, reason: 'invalid_principal' })
    assert.equal((await requestsOf(other))[0]?.status, 'pending')
    assert.equal(await directLevel(other, pending.userId), null)
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 무시', () => {
  test('★ 알리지 않는다 · 하루 동안 요청한 사람에게 "보냈습니다" · 하루가 지나면 다시 보낼 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('요청하는 사람')
    const doc = await page(boss, { privateTop: true })
    const id = await asked(asker, doc)

    assert.deepEqual(await ignoreAccessRequest(boss.ctx, id), { ok: true, value: null })
    assert.deepEqual(
      (await requestsOf(doc)).map((r) => [r.status, r.decided_by]),
      [['ignored', boss.userId]],
    )
    assert.deepEqual(await notified(doc, 'access_granted'), [], '무시했는데 요청한 사람에게 알림이 갔다')
    assert.equal(await directLevel(doc, asker.userId), null)
    const listed = await listAccessRequests(boss.ctx, doc)
    assert.deepEqual(listed, { ok: true, value: [] }, '무시한 요청이 목록에 남았다')

    // 하루 안 — 요청한 사람에게는 여전히 "보냈습니다"이고, 다시 눌러도 새 요청 · 새 알림이 없다.
    assert.deepEqual(await noAccessState(asker.ctx, doc), { requested: true })
    assert.deepEqual(await requestPageAccess(asker.ctx, doc), { ok: true, value: { sent: false } })
    assert.equal((await requestsOf(doc)).length, 1)
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId])

    // 하루가 지나면 다시 보낼 수 있다.
    await query(`UPDATE access_request SET decided_at = now() - interval '25 hours' WHERE id = $1`, [id])
    assert.deepEqual(await noAccessState(asker.ctx, doc), { requested: false })
    assert.deepEqual(await requestPageAccess(asker.ctx, doc), { ok: true, value: { sent: true } })
    assert.deepEqual(
      (await requestsOf(doc)).map((r) => r.status),
      ['ignored', 'pending'],
    )
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId, boss.userId])
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

describe('⑧ 알림을 받는 사람', () => {
  test('★ 워크스페이스 최상위 페이지(모두가 전체 권한) — 만든 사람에게만 · 전원에게 보내지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const author = await person('만든 사람')
    const reader = await person('읽기로도 받은 멤버')
    const guest = await person('손님', 'guest')
    const doc = await page(author)
    assert.equal(await canViewPage(boss.ctx, doc), true, '전제 — 최상위 페이지는 모두가 본다')
    // 사람에게 직접 준 행이라도 공유를 품지 않은 레벨(읽기)이면 이름이 걸린 관리자가 아니다 — 그 사람이 다른 길(모두의 전체
    // 권한)로 공유할 수 있어도.
    assert.ok((await grantAccess(author.ctx, doc, { type: 'user', id: reader.userId }, 'view')).ok)

    await asked(guest, doc)
    assert.deepEqual(await notified(doc, 'access_requested'), [author.userId])
  })

  test('만든 사람이 떠났고 사람에게 직접 준 행이 없으면 — 공유할 수 있는 owner 에게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const author = await person('떠난 작성자')
    await person('관리자', 'membership_admin')
    await person('다른 멤버')
    const guest = await person('손님', 'guest')
    const doc = await page(author)
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      ws,
      author.userId,
    ])

    await asked(guest, doc)
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId])
  })

  test('사슬의 사람에게 직접 준 공유 권한 — 부모의 전체 권한 행 · 만든 사람이라도 공유할 수 없으면 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const helper = await person('공동 관리자')
    const writer = await person('편집자')
    const viewer = await person('보기만')
    const asker = await person('요청하는 사람')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: helper.userId }, 'full_access')).ok)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: writer.userId }, 'edit')).ok)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    const sub = await page(writer, { parentPageId: doc as BlockId })

    await asked(asker, sub)
    assert.deepEqual(await notified(sub, 'access_requested'), sorted([boss.userId, helper.userId]))
  })
})

// ── ⑨ ─────────────────────────────────────────────────────────────────

describe('⑨ 인박스', () => {
  test('관리자는 요청한 사람의 이름과 지금 상태를 본다 · 한 페이지의 요청은 한 줄 · 허락은 요청한 사람에게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const first = await person('첫 요청자')
    const second = await person('둘째 요청자')
    const doc = await page(boss, { privateTop: true })
    await asked(first, doc)
    const id = await asked(second, doc)

    const line = async () => (await listInbox(boss.ctx)).find((i) => i.pageId === doc && i.kind === 'access_requested')
    const before = await line()
    assert.ok(before, '관리자의 인박스에 요청이 없다')
    assert.equal(before.count, 2, '한 페이지의 요청이 한 줄로 접히지 않았다')
    assert.deepEqual(before.access, { requesterName: '둘째 요청자', status: 'pending', kind: 'page_access' })
    assert.deepEqual(await listInbox(second.ctx), [], '허락 전에 요청한 사람의 인박스에 무언가 있다')

    assert.ok((await approveAccessRequest(boss.ctx, id, 'comment')).ok)
    assert.deepEqual(
      (await line())?.access,
      { requesterName: '둘째 요청자', status: 'approved', kind: 'page_access' },
      '지금 상태를 읽지 않는다',
    )
    const mine = await listInbox(second.ctx)
    assert.deepEqual(
      mine.map((i) => [i.pageId, i.kind]),
      [[doc, 'access_granted']],
    )
  })
})

// ── ⑩ ─────────────────────────────────────────────────────────────────

describe('⑩ 페이지의 삶과 죽음', () => {
  test('휴지통 · 영구 삭제된 페이지의 요청은 처리할 수 없다 · 휴지통에서 돌아오면 대기 중이던 요청도 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('요청하는 사람')
    const doc = await page(boss, { privateTop: true })
    const id = await asked(asker, doc)

    await trashPage(boss.ctx, doc as BlockId)
    assert.deepEqual(await approveAccessRequest(boss.ctx, id, 'view'), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listAccessRequests(boss.ctx, doc), { ok: false, reason: 'not_found' })
    await restorePage(boss.ctx, doc as BlockId)
    const back = await listAccessRequests(boss.ctx, doc)
    assert.ok(back.ok)
    assert.deepEqual(back.value.map((r) => r.id), [id], '돌아왔는데 요청이 없다')

    // 영구 삭제(purged)는 행을 지우지 않는다(F-02-11) — 요청은 행과 함께 간다(물리 삭제 · ON DELETE CASCADE — verify-schema 가
    // 본다). 그 전까지는 없는 페이지의 요청이다.
    await trashPage(boss.ctx, doc as BlockId)
    await purgePage(boss.ctx, doc as BlockId)
    assert.deepEqual(await ignoreAccessRequest(boss.ctx, id), { ok: false, reason: 'not_found' })
    assert.equal((await queryOne<{ status: string }>(`SELECT status FROM access_request WHERE id = $1`, [id])).status, 'pending')
  })
})

// ── ⑪ ─────────────────────────────────────────────────────────────────

describe('⑪ 편집 권한 요청 (7e-2)', () => {
  const kindsOf = async (pageId: string) =>
    (
      await query<{ kind: string; requested_level: string | null; requester_id: string; status: string }>(
        `SELECT kind, requested_level, requester_id, status FROM access_request WHERE node_id = $1 ORDER BY created_at, id`,
        [pageId],
      )
    ).map((r) => [r.kind, r.requested_level, r.requester_id, r.status])

  test('★ 볼 수는 있지만 고칠 수 없는 사람만 요청한다 — 요청 레벨은 편집 · 관리자에게 알림 · 다시 눌러도 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const reader = await person('읽기만')
    const commenter = await person('댓글까지')
    const editor = await person('편집자')
    const stranger = await person('못 보는 사람')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: reader.userId }, 'view')).ok)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: commenter.userId }, 'comment')).ok)
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: editor.userId }, 'edit')).ok)

    assert.deepEqual(await editRequestState(reader.ctx, doc), { requested: false })
    assert.deepEqual(await editRequestState(commenter.ctx, doc), { requested: false })
    for (const who of [editor, boss, stranger]) assert.equal(await editRequestState(who.ctx, doc), null)
    assert.deepEqual(await requestEditAccess(editor.ctx, doc), { ok: false, reason: 'has_access' })
    assert.deepEqual(await requestEditAccess(boss.ctx, doc), { ok: false, reason: 'has_access' })
    assert.deepEqual(
      await requestEditAccess(stranger.ctx, doc),
      { ok: false, reason: 'not_found' },
      '볼 수 없는 사람이 편집 요청으로 페이지가 있는지 알아낸다 — 그 사람의 길은 요청 화면이다',
    )

    assert.deepEqual(await requestEditAccess(reader.ctx, doc), { ok: true, value: { sent: true } })
    assert.deepEqual(await requestEditAccess(reader.ctx, doc), { ok: true, value: { sent: false } })
    assert.deepEqual(await kindsOf(doc), [['edit_access', 'edit', reader.userId, 'pending']])
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId])
    assert.deepEqual(await editRequestState(reader.ctx, doc), { requested: true })
    assert.equal(await noAccessState(reader.ctx, doc), null, '볼 수 있는 사람에게 요청 화면은 없다')

    const line = (await listInbox(boss.ctx)).find((i) => i.pageId === doc && i.kind === 'access_requested')
    assert.deepEqual(line?.access, { requesterName: '읽기만', status: 'pending', kind: 'edit_access' })
  })

  test('★ 목록에 종류 · 요청 레벨이 서고 · 허락하면 고친다 · 이미 고칠 수 있게 된 사람의 요청은 세우지 않는다(다시 잃으면 선다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const first = await person('첫 독자')
    const second = await person('둘째 독자')
    const doc = await page(boss, { privateTop: true })
    for (const who of [first, second]) {
      assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: who.userId }, 'view')).ok)
      assert.deepEqual(await requestEditAccess(who.ctx, doc), { ok: true, value: { sent: true } })
    }

    const listed = async () => {
      const result = await listAccessRequests(boss.ctx, doc)
      assert.ok(result.ok)
      return result.value.map((r) => [r.requesterId, r.kind, r.requestedLevel])
    }
    assert.deepEqual(await listed(), [
      [first.userId, 'edit_access', 'edit'],
      [second.userId, 'edit_access', 'edit'],
    ])

    const pending = await listAccessRequests(boss.ctx, doc)
    assert.ok(pending.ok)
    const firstId = pending.value[0]?.id
    assert.ok(firstId)
    assert.deepEqual(await approveAccessRequest(boss.ctx, firstId, 'edit'), { ok: true, value: { granted: true } })
    const caps = await withReadTransaction((tx) => effectiveCaps(tx, first.ctx, doc))
    assert.ok(can(caps, 'edit_content'), '허락받았는데 고치지 못한다')
    assert.deepEqual(await editRequestState(first.ctx, doc), null)

    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: second.userId }, 'edit')).ok)
    assert.deepEqual(await listed(), [], '이미 고칠 수 있게 된 사람의 편집 요청이 선다')
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: second.userId }, 'view')).ok)
    assert.deepEqual(await listed(), [[second.userId, 'edit_access', 'edit']], '다시 고칠 수 없게 됐는데 요청이 서지 않는다')
  })

  test('종류는 따로 센다 — 대기 중인 접근 요청이 편집 요청을 막지 않는다 · 볼 수 있게 되면 접근 요청만 목록에서 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const asker = await person('처음엔 못 보던 사람')
    const doc = await page(boss, { privateTop: true })
    assert.deepEqual(await requestPageAccess(asker.ctx, doc), { ok: true, value: { sent: true } })
    // 다른 길(공유 패널)로 읽기를 받았다 — 접근 요청은 대기 중인 채로 남는다.
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: asker.userId }, 'view')).ok)

    assert.deepEqual(await requestEditAccess(asker.ctx, doc), { ok: true, value: { sent: true } })
    assert.deepEqual(
      (await kindsOf(doc)).map((r) => r[0]),
      ['page_access', 'edit_access'],
    )
    const listed = await listAccessRequests(boss.ctx, doc)
    assert.ok(listed.ok)
    assert.deepEqual(listed.value.map((r) => r.kind), ['edit_access'])
  })
})
