/**
 * 개인 페이지(Private 루트 페이지) — 7c-7조각 (F-02-12 · F-07-16 · DB)
 *
 * 판결문 C-9: *"Private/Teamspace/Shared 구분을 `parent_type` + `owner_user_id` 로"*. 개인 페이지는 워크스페이스 부모에
 * `owner_user_id` 를 진 최상위 페이지이고, 행은 주인의 full_access 하나다 — 판정 기계는 그대로 쓴다(새 축이 없다).
 *
 *   ① ★ 만들기 — 나만 본다(워크스페이스 소유자도 못 본다) · 행 하나 · 스코프는 자기 · 사이드바의 개인 페이지 섹션
 *   ② 게스트는 못 만든다 · 제한 멤버는 만든다 · 부모 · teamspace 와 함께 줄 수 없다
 *   ③ ★ 공용 → 개인 — 모두의 행과 **따로 준 공유가 걷힌다**(정본 §3.11 move_to_private) · 하위의 명시 부여는 산다
 *   ④ ★ 개인 → 공용 — 주인의 상속분 행이 걷히고 모두의 행 · **noop 이 아니다**(부모가 같아도 자리가 다르다)
 *   ⑤ 개인 → teamspace · 페이지 밑 — owner_user_id 가 지워진다 · 뿌리가 바뀌므로 manage_perm
 *   ⑥ ★ 복제 — 내 개인의 사본은 개인 · 공유받은 남의 개인의 사본은 **내** 개인 · 공용의 사본은 공용
 *
 * 부모가 사라진 페이지의 복원(B4)이 개인 최상위로 오는 것은 `trash.db.test.ts` 의 B4 검사가 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query, queryOne } from '../db/pool.ts'
import { grantAccess } from '../permissions/acl.ts'
import { canViewPage } from '../permissions/effective.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { listMyTeamspaces, createTeamspace } from '../workspace/teamspace.ts'
import { duplicatePage } from './duplicate.ts'
import { movePage, MoveError } from './move-page.ts'
import { createPage, PageError, titleFromPlainText } from './page.ts'
import { groupSidebarRoots, listPageTree } from './page-tree.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

const member = async (name: string, role: Parameters<typeof joinAs>[2] = 'member'): Promise<Actor> =>
  joinAs(fx.workspaceId, await createUser(name), role)

const privatePage = async (by: Actor, title = '내 메모') =>
  createPage(by.ctx, { privateTop: true, title: titleFromPlainText(unique(title)) })

const rowOf = (id: string) =>
  queryOne<{ parent_type: string; parent_id: string; owner_user_id: string | null; perm_scope_id: string }>(
    `SELECT parent_type, parent_id, owner_user_id, perm_scope_id FROM block WHERE id = $1`,
    [id],
  )

const aclOf = async (id: string) =>
  (
    await query<{ principal_type: string; principal_id: string | null; level: string }>(
      `SELECT principal_type, principal_id, level FROM acl_entry
        WHERE node_kind = 'block' AND node_id = $1 ORDER BY principal_type, principal_id`,
      [id],
    )
  ).map((r) => [r.principal_type, r.principal_id, r.level])

/** 판정과 사이드바(섹션까지)를 나란히 — §3.3-107. */
async function sees(actor: Actor, page: string) {
  const judged = await canViewPage(actor.ctx, page)
  const split = groupSidebarRoots(await listPageTree(actor.ctx), await listMyTeamspaces(actor.ctx))
  const inSection = (nodes: readonly { id: string }[]) => nodes.some((n) => n.id === page)
  return {
    judged,
    section: inSection(split.privatePages)
      ? 'private'
      : inSection(split.shared)
        ? 'shared'
        : inSection(split.workspacePages)
          ? 'workspace'
          : null,
  }
}

const attempt = (actor: Actor, input: Parameters<typeof createPage>[1]) =>
  createPage(actor.ctx, input).then(
    () => 'ok',
    (e: unknown) => (e instanceof PageError ? e.code : String(e)),
  )

const moveAttempt = (actor: Actor, page: string, destination: Parameters<typeof movePage>[2]) =>
  movePage(actor.ctx, page as Parameters<typeof movePage>[1], destination).then(
    () => 'ok',
    (e: unknown) => (e instanceof MoveError ? e.code : String(e)),
  )

// ── ① · ② 만들기 ─────────────────────────────────────────────────────

describe('① 개인 페이지 만들기', () => {
  test('★ 나만 본다 — 워크스페이스 소유자도 못 본다 · 행은 내 full_access 하나 · 스코프는 자기 · 개인 페이지 섹션에 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mina = await member('미나')
    const other = await member('다른 멤버')
    const page = await privatePage(mina)

    assert.deepEqual(await rowOf(page.id), {
      parent_type: 'workspace',
      parent_id: fx.workspaceId,
      owner_user_id: mina.userId,
      perm_scope_id: page.id,
    })
    assert.deepEqual(await aclOf(page.id), [['user', mina.userId, 'full_access']])

    assert.deepEqual(await sees(mina, page.id), { judged: true, section: 'private' })
    assert.deepEqual(await sees(other, page.id), { judged: false, section: null })
    assert.deepEqual(await sees(fx.owner, page.id), { judged: false, section: null }, '워크스페이스 소유자에게 보인다')
  })

  test('게스트는 못 만든다 · 제한 멤버는 만든다 · 부모 · teamspace 와 함께 줄 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const guest = await member('손님', 'guest')
    const restricted = await member('제한 멤버', 'restricted_member')
    const mina = await member('조합 미나')
    const parent = await privatePage(mina)

    assert.equal(await attempt(guest, { privateTop: true }), 'parent_not_found')
    const restrictedPage = await privatePage(restricted)
    assert.deepEqual(await sees(restricted, restrictedPage.id), { judged: true, section: 'private' })

    assert.equal(await attempt(mina, { privateTop: true, parentPageId: parent.id }), 'parent_not_found')
    const team = await createTeamspace(fx.owner.ctx, { name: unique('팀') })
    assert.ok(team.ok)
    assert.equal(await attempt(fx.owner, { privateTop: true, teamspaceId: team.value.id }), 'parent_not_found')
  })
})

// ── ③ · ④ · ⑤ 옮기기 ─────────────────────────────────────────────────

describe('② 옮기기 — 개인으로 · 개인에서', () => {
  test('★ 공용 → 개인 — 모두의 행과 따로 준 공유가 걷힌다(정본 move_to_private) · 하위의 명시 부여는 산다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mina = await member('옮기는 미나')
    const friend = await member('따로 받은 친구')
    const childFriend = await member('하위만 받은 친구')
    const page = await createPage(mina.ctx, { title: titleFromPlainText(unique('공용이던 것')) })
    const child = await createPage(mina.ctx, { parentPageId: page.id, title: titleFromPlainText('하위') })
    assert.ok((await grantAccess(mina.ctx, page.id, { type: 'user', id: friend.userId }, 'edit')).ok)
    assert.ok((await grantAccess(mina.ctx, child.id, { type: 'user', id: childFriend.userId }, 'view')).ok)

    const moved = await movePage(mina.ctx, page.id, { privateTop: true })
    assert.equal(moved.privateTop, true)
    assert.equal(moved.noop, false)

    assert.deepEqual(await aclOf(page.id), [['user', mina.userId, 'full_access']], '따로 준 공유가 남았다')
    assert.equal((await rowOf(page.id)).owner_user_id, mina.userId)
    assert.deepEqual(await sees(mina, page.id), { judged: true, section: 'private' })
    assert.deepEqual(await sees(friend, page.id), { judged: false, section: null }, '개인으로 옮겼는데 친구가 본다')
    // 하위의 명시 부여는 산다 — 정본: "하위 명시 부여는 그대로 살아남는다". 그 친구에게 하위는 공유됨 조각으로 선다.
    assert.deepEqual(await sees(childFriend, child.id), { judged: true, section: 'shared' })
  })

  test('★ 개인 → 공용 최상위 — noop 이 아니다 · 주인의 상속분 행이 걷히고 모두의 행이 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mina = await member('여는 미나')
    const other = await member('보게 될 멤버')
    const page = await privatePage(mina, '열 것')

    const moved = await movePage(mina.ctx, page.id, null)
    assert.equal(moved.noop, false, '부모가 같다고 noop 으로 새면 개인 페이지가 영영 못 나간다')
    assert.deepEqual(await aclOf(page.id), [['workspace_everyone', null, 'full_access']], '주인의 상속분 행이 남았다')
    assert.equal((await rowOf(page.id)).owner_user_id, null)
    assert.deepEqual(await sees(other, page.id), { judged: true, section: 'workspace' })

    // 같은 자리로 또 — 이제는 noop 이다.
    assert.equal((await movePage(mina.ctx, page.id, null)).noop, true)
    // 그리고 개인으로 되옮기면 다시 나만 본다.
    assert.equal((await movePage(mina.ctx, page.id, { privateTop: true })).privateTop, true)
    assert.deepEqual(await sees(other, page.id), { judged: false, section: null })
    assert.equal((await movePage(mina.ctx, page.id, { privateTop: true })).noop, true, '이미 내 개인인데 또 옮겼다')
  })

  test('개인 → teamspace · 페이지 밑 — owner_user_id 가 지워지고 그 자리의 권한을 따른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const team = await createTeamspace(fx.owner.ctx, { name: unique('옮길 팀') })
    assert.ok(team.ok)
    const toTeam = await privatePage(fx.owner, '팀으로 갈 것')
    assert.equal((await movePage(fx.owner.ctx, toTeam.id, { teamspaceId: team.value.id })).teamspaceId, team.value.id)
    assert.deepEqual(await rowOf(toTeam.id), {
      parent_type: 'teamspace',
      parent_id: team.value.id,
      owner_user_id: null,
      perm_scope_id: team.value.id,
    })
    assert.deepEqual(await aclOf(toTeam.id), [], '개인의 행이 teamspace 까지 따라왔다')

    const host = await createPage(fx.owner.ctx, { title: titleFromPlainText(unique('공개 부모')) })
    const toChild = await privatePage(fx.owner, '하위로 갈 것')
    await movePage(fx.owner.ctx, toChild.id, host.id)
    const row = await rowOf(toChild.id)
    assert.deepEqual([row.owner_user_id, row.perm_scope_id], [null, host.id], 'owner 가 남았거나 상속을 못 받는다')
    const other = await member('하위를 보는 멤버')
    assert.equal(await canViewPage(other.ctx, toChild.id), true, '공개 부모 밑으로 갔는데 안 보인다')
  })

  test('뿌리가 바뀌므로 전체 권한 — 남의 개인 페이지를 edit 만 받고 내 개인으로 가져가면 needs_full_access · 아무것도 안 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // ⚠ 공용 최상위 페이지로는 이 검사를 못 짠다 — 모두의 행이 full_access 라 부여와 무관하게 manage_perm 이 있다
    //   (7c-3 이 경계 검사에서 겪은 것과 같다). 남의 **개인** 페이지에 edit 만 받은 사람으로 짠다.
    const mina = await member('주인 미나')
    const editor = await member('편집만 받은 사람')
    const guest = await member('옮기는 손님', 'guest')
    const page = await privatePage(mina, '노리는 것')
    assert.ok((await grantAccess(mina.ctx, page.id, { type: 'user', id: editor.userId }, 'edit')).ok)
    assert.ok((await grantAccess(mina.ctx, page.id, { type: 'user', id: guest.userId }, 'edit')).ok)
    const before = { row: await rowOf(page.id), acl: await aclOf(page.id) }

    assert.equal(await moveAttempt(editor, page.id, { privateTop: true }), 'needs_full_access')
    assert.equal(await moveAttempt(editor, page.id, null), 'needs_full_access', '공용 최상위로 여는 것도 뿌리 이동이다')
    assert.equal(await moveAttempt(guest, page.id, { privateTop: true }), 'target_not_found')
    assert.deepEqual({ row: await rowOf(page.id), acl: await aclOf(page.id) }, before, '거부됐는데 무언가 바뀌었다')
    // full_access 를 받으면 가져갈 수 있다 — 그때는 원래 주인의 상속분이 걷히고 내 것만 남는다.
    assert.ok((await grantAccess(mina.ctx, page.id, { type: 'user', id: editor.userId }, 'full_access')).ok)
    assert.equal(await moveAttempt(editor, page.id, { privateTop: true }), 'ok')
    assert.deepEqual(await aclOf(page.id), [['user', editor.userId, 'full_access']])
    assert.deepEqual(await sees(mina, page.id), { judged: false, section: null }, '가져간 뒤에도 원래 주인이 본다')
  })
})

// ── ⑥ 복제 ────────────────────────────────────────────────────────────

describe('③ 복제', () => {
  test('★ 내 개인의 사본은 개인 · 공유받은 남의 개인의 사본은 내 개인 · 공용의 사본은 공용', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mina = await member('복제 미나')
    const friend = await member('복제 친구')

    const mine = await privatePage(mina, '복제할 메모')
    const myCopy = await duplicatePage(mina.ctx, mine.id)
    assert.equal((await rowOf(myCopy.page.id)).owner_user_id, mina.userId, '내 개인의 사본이 개인이 아니다')
    assert.deepEqual(await aclOf(myCopy.page.id), [['user', mina.userId, 'full_access']])

    assert.ok((await grantAccess(mina.ctx, mine.id, { type: 'user', id: friend.userId }, 'edit')).ok)
    const friendCopy = await duplicatePage(friend.ctx, mine.id)
    assert.equal((await rowOf(friendCopy.page.id)).owner_user_id, friend.userId, '남의 개인의 사본이 내 개인이 아니다')
    assert.deepEqual(await sees(mina, friendCopy.page.id), { judged: false, section: null }, '사본이 원본 주인에게 열렸다')

    const open = await createPage(mina.ctx, { title: titleFromPlainText(unique('공용 원본')) })
    const openCopy = await duplicatePage(mina.ctx, open.id)
    assert.deepEqual(await aclOf(openCopy.page.id), [['workspace_everyone', null, 'full_access']], '공용의 사본이 공용이 아니다')
  })
})
