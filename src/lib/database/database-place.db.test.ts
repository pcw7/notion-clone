/**
 * 데이터베이스의 자리 — 7c-8조각 (F-04-14 · F-06-20 · DB)
 *
 * 개인 데이터베이스(`createDatabase` 의 `privateTop` — 7c-4 의 "최상위 자리를 받는 생성은 둘이고 같은 규칙"이 다시
 * 맞는다)와 **표 옮기기**(`movePage` 가 `type='database'` 를 받는다 — 최상위 사이에서만). 표의 행(row)은 `ancestor_path`
 * 에 표 블록을 지므로 서브트리 이동이 스코프를 함께 옮긴다.
 *
 *   ① ★ 개인 표 — 나만 본다(행도) · 행은 내 full_access 하나 · 게스트 · 자리 조합은 not_found
 *   ② ★ 워크스페이스 → teamspace → 개인 → 워크스페이스 — 행과 스코프가 자리를 따라간다 · noop 이 아니다
 *   ③ 뿌리 이동은 manage_perm · 페이지 밑으로는 invalid_target — 거부는 아무것도 바꾸지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { movePage, MoveError } from '../block/move-page.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { groupSidebarRoots, listPageTree } from '../block/page-tree.ts'
import { query, queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { addTeamspaceMember, createTeamspace, listMyTeamspaces } from '../workspace/teamspace.ts'
import { createDatabase, getDatabase } from './database.ts'
import { createRow, listRows } from './row.ts'

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

const move = (actor: Actor, id: string, destination: Parameters<typeof movePage>[2]) =>
  movePage(actor.ctx, asBlockId(id) as BlockId, destination)

const moveAttempt = (actor: Actor, id: string, destination: Parameters<typeof movePage>[2]) =>
  move(actor, id, destination).then(
    () => 'ok',
    (e: unknown) => (e instanceof MoveError ? e.code : String(e)),
  )

/** 표 하나 + 행 하나 — 행의 스코프가 자리를 따라가는지 볼 재료다. */
async function tableWithRow(by: Actor, place: { teamspaceId?: string; privateTop?: boolean } = {}) {
  const created = await createDatabase(by.ctx, { name: unique('표'), ...place })
  assert.ok(created.ok, JSON.stringify(created))
  const row = await createRow(by.ctx, created.value.dataSourceId)
  assert.ok(row.ok, JSON.stringify(row))
  return { db: created.value, rowId: row.value.id }
}

const sectionOf = async (actor: Actor, id: string) => {
  const split = groupSidebarRoots(await listPageTree(actor.ctx), await listMyTeamspaces(actor.ctx))
  if (split.privatePages.some((n) => n.id === id)) return 'private'
  if (split.shared.some((n) => n.id === id)) return 'shared'
  if (split.workspacePages.some((n) => n.id === id)) return 'workspace'
  if (split.teamspaces.some((t) => t.pages.some((n) => n.id === id))) return 'teamspace'
  return null
}

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 개인 데이터베이스', () => {
  test('★ 나만 본다 — 행도 나만 · 블록 행은 내 full_access 하나 · 사이드바의 개인 섹션에 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mina = await member('표 미나')
    const other = await member('표 다른 멤버')
    const { db, rowId } = await tableWithRow(mina, { privateTop: true })

    assert.deepEqual(await rowOf(db.id), {
      parent_type: 'workspace',
      parent_id: fx.workspaceId,
      owner_user_id: mina.userId,
      perm_scope_id: db.id,
    })
    assert.deepEqual(await aclOf(db.id), [['user', mina.userId, 'full_access']])
    assert.equal((await rowOf(rowId)).perm_scope_id, db.id, '행이 표의 스코프를 따르지 않는다')

    assert.equal(await sectionOf(mina, db.id), 'private')
    assert.equal(await sectionOf(other, db.id), null)
    assert.deepEqual(await getDatabase(other.ctx, db.id), { ok: false, reason: 'not_found' })
    assert.deepEqual(await getDatabase(fx.owner.ctx, db.id), { ok: false, reason: 'not_found' }, '워크스페이스 소유자가 본다')
    assert.equal((await listRows(other.ctx, db.dataSourceId)).ok, false, '행 목록이 남에게 열렸다')
  })

  test('게스트는 못 만든다 · teamspace 와 함께 줄 수 없다 — 아무것도 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const guest = await member('표 손님', 'guest')
    const team = await createTeamspace(fx.owner.ctx, { name: unique('표 팀') })
    assert.ok(team.ok)
    const count = async () =>
      (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM block WHERE workspace_id = $1 AND type = 'database'`, [fx.workspaceId])).n
    const before = await count()

    assert.deepEqual(await createDatabase(guest.ctx, { name: '몰래', privateTop: true }), { ok: false, reason: 'not_found' })
    assert.deepEqual(
      await createDatabase(fx.owner.ctx, { name: '둘 다', privateTop: true, teamspaceId: team.value.id }),
      { ok: false, reason: 'not_found' },
    )
    assert.equal(await count(), before, '거부됐는데 표가 남았다')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 표 옮기기 — 최상위 사이', () => {
  test('★ 워크스페이스 → teamspace — 모두의 행을 거두고 멤버만 본다 · 표의 행 스코프가 따라간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const alice = await member('옮기는 앨리스')
    const outsider = await member('팀 밖 사람')
    const team = await createTeamspace(fx.owner.ctx, { name: unique('행선지 팀') })
    assert.ok(team.ok)
    assert.ok((await addTeamspaceMember(fx.owner.ctx, team.value.id, { type: 'user', id: alice.userId })).ok)
    const { db, rowId } = await tableWithRow(fx.owner)
    assert.equal(await sectionOf(outsider, db.id), 'workspace', '전제 — 공용 표는 모두에게 보인다')

    const moved = await move(fx.owner, db.id, { teamspaceId: team.value.id })
    assert.equal(moved.teamspaceId, team.value.id)
    assert.equal(moved.noop, false)

    assert.deepEqual(await rowOf(db.id), {
      parent_type: 'teamspace',
      parent_id: team.value.id,
      owner_user_id: null,
      perm_scope_id: team.value.id,
    })
    assert.deepEqual(await aclOf(db.id), [], '모두의 행이 teamspace 까지 따라왔다')
    assert.equal((await rowOf(rowId)).perm_scope_id, team.value.id, '표의 행 스코프가 자리를 따라가지 않는다')
    assert.equal(await sectionOf(outsider, db.id), null, '옮겼는데 팀 밖 사람이 아직 본다')
    assert.equal((await listRows(outsider.ctx, db.dataSourceId)).ok, false)
    assert.ok((await getDatabase(alice.ctx, db.id)).ok, '팀 멤버가 못 본다')
  })

  test('★ teamspace → 내 개인 → 워크스페이스 — 주인이 붙었다 떨어지고 · 같은 부모라도 noop 이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const other = await member('구경하는 멤버')
    const team = await createTeamspace(fx.owner.ctx, { name: unique('출발 팀') })
    assert.ok(team.ok)
    const { db, rowId } = await tableWithRow(fx.owner, { teamspaceId: team.value.id })

    assert.equal((await move(fx.owner, db.id, { privateTop: true })).privateTop, true)
    assert.deepEqual(await aclOf(db.id), [['user', fx.owner.userId, 'full_access']])
    assert.equal((await rowOf(db.id)).owner_user_id, fx.owner.userId)
    assert.equal((await rowOf(rowId)).perm_scope_id, db.id, '개인이 된 표의 행 스코프')
    assert.equal(await sectionOf(fx.owner, db.id), 'private')
    assert.deepEqual(await getDatabase(other.ctx, db.id), { ok: false, reason: 'not_found' })

    const opened = await move(fx.owner, db.id, null)
    assert.equal(opened.noop, false, '개인 → 공용이 noop 으로 샜다 — 부모가 같아도 자리가 다르다')
    assert.deepEqual(await aclOf(db.id), [['workspace_everyone', null, 'full_access']], '주인의 상속분 행이 남았다')
    assert.equal((await rowOf(db.id)).owner_user_id, null)
    assert.ok((await getDatabase(other.ctx, db.id)).ok, '공용으로 열었는데 안 보인다')
    assert.equal((await move(fx.owner, db.id, null)).noop, true, '같은 자리 또 옮기기가 noop 이 아니다')
  })

  test('③ 뿌리 이동은 manage_perm · 페이지 밑으로는 invalid_target — 거부는 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mina = await member('표 주인 미나')
    const editor = await member('표 편집자')
    const host = await createPage(fx.owner.ctx, { title: titleFromPlainText(unique('받을 페이지')) })

    const { db } = await tableWithRow(mina, { privateTop: true })
    assert.ok((await grantAccess(mina.ctx, db.id, { type: 'user', id: editor.userId }, 'edit')).ok)
    const before = { row: await rowOf(db.id), acl: await aclOf(db.id) }

    assert.equal(await moveAttempt(editor, db.id, null), 'needs_full_access', '남의 개인 표를 edit 만으로 공용에 열었다')
    assert.equal(await moveAttempt(mina, db.id, host.id), 'invalid_target', '표가 페이지 밑으로 들어갔다')
    assert.equal(await moveAttempt(mina, db.id, { teamspaceId: fx.workspaceId }), 'target_not_found')
    assert.deepEqual({ row: await rowOf(db.id), acl: await aclOf(db.id) }, before, '거부됐는데 무언가 바뀌었다')
  })
})
