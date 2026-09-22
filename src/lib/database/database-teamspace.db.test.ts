/**
 * teamspace 최상위의 데이터베이스 — Teamspace · 게스트 · 그룹 7c-4조각 (F-06-04 · F-04-14 · DB)
 *
 * `createDatabase` 의 teamspace 자리는 `createPage` 의 그것과 같은 규칙이다 — 멤버만 두고, 행 없이 teamspace 노드에서 물려받고,
 * 스코프는 teamspace 다. 판정(`getDatabase`)과 목록(사이드바 · teamspace 목록 — 스코프로 거른다)을 **나란히** 묻는다.
 *
 *   ① ★ 멤버만 본다 · 행 없이 물려받는다 · 사이드바의 그 teamspace 섹션에 선다
 *   ② 행도 teamspace 를 따른다 — 멤버는 행을 만들고 읽고, 멤버가 아닌 사람은 표를 못 연다
 *   ③ 멤버가 아닌 · 보관된 · 남의 teamspace 에는 못 만든다(not_found) · 아무것도 남지 않는다
 *   ④ teamspace 를 주지 않으면 전과 같다 — 워크스페이스 최상위 · 모두의 행
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { groupRootsByTeamspace, listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { query, queryOne } from '../db/pool.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { addTeamspaceMember, createTeamspace, listMyTeamspaces } from '../workspace/teamspace.ts'
import { createDatabase, getDatabase, listTeamspaceDatabases } from './database.ts'
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

const member = async (name: string): Promise<Actor> => joinAs(fx.workspaceId, await createUser(name), 'member')

async function teamspaceWith(by: Actor, ...members: Actor[]): Promise<string> {
  const created = await createTeamspace(by.ctx, { name: unique('팀') })
  assert.ok(created.ok, JSON.stringify(created))
  for (const m of members) assert.ok((await addTeamspaceMember(by.ctx, created.value.id, { type: 'user', id: m.userId })).ok)
  return created.value.id
}

async function tableIn(teamspaceId: string | null, by: Actor = fx.owner) {
  const created = await createDatabase(by.ctx, { name: unique('표'), teamspaceId })
  assert.ok(created.ok, JSON.stringify(created))
  return created.value
}

const flatten = (nodes: readonly PageTreeNode[]): string[] => nodes.flatMap((n) => [n.id, ...flatten(n.children)])

const rowOf = (id: string) =>
  queryOne<{ parent_type: string; parent_id: string; ancestor_path: string[]; perm_scope_id: string }>(
    `SELECT parent_type, parent_id, ancestor_path, perm_scope_id FROM block WHERE id = $1`,
    [id],
  )

const aclOf = async (id: string) =>
  (
    await query<{ principal_type: string; level: string }>(
      `SELECT principal_type, level FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 ORDER BY principal_type`,
      [id],
    )
  ).map((r) => [r.principal_type, r.level])

// ── ① ─────────────────────────────────────────────────────────────────

describe('① teamspace 최상위의 데이터베이스', () => {
  test('★ 멤버만 본다 — 행 없이 teamspace 에서 물려받고 · 스코프는 teamspace · 사이드바의 그 teamspace 섹션에 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const alice = await member('앨리스')
    const outsider = await member('바깥 사람')
    // 바깥 사람도 볼 수 있는 것이 하나는 있어야 한다 — 볼 수 있는 스코프가 비면 목록 함수가 일찍 빈 답을 내서, 권한 거르기가
    // 빠져도 이 검사가 모른다(반사실 k5 가 처음에 그래서 통과했다).
    await tableIn(null)
    const team = await teamspaceWith(fx.owner, alice)
    const table = await tableIn(team)

    assert.deepEqual(await rowOf(table.id), { parent_type: 'teamspace', parent_id: team, ancestor_path: [], perm_scope_id: team })
    assert.deepEqual(await aclOf(table.id), [], '워크스페이스 최상위처럼 모두의 행을 넣었다')

    const seen = await getDatabase(alice.ctx, table.id)
    assert.ok(seen.ok && seen.value.access.canCreateRows, JSON.stringify(seen))
    assert.deepEqual(await getDatabase(outsider.ctx, table.id), { ok: false, reason: 'not_found' })

    const split = groupRootsByTeamspace(await listPageTree(alice.ctx), await listMyTeamspaces(alice.ctx))
    const section = split.teamspaces.find((s) => s.teamspace.id === team)
    assert.deepEqual(section?.pages.map((p) => [p.id, p.kind]), [[table.id, 'database']])
    assert.ok(!flatten(await listPageTree(outsider.ctx)).includes(table.id), '멤버가 아닌 사람의 사이드바에 나왔다')

    assert.deepEqual((await listTeamspaceDatabases(alice.ctx, team)).map((d) => d.id), [table.id])
    assert.deepEqual(await listTeamspaceDatabases(outsider.ctx, team), [])
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 행', () => {
  test('행도 teamspace 를 따른다 — 멤버는 행을 만들고 읽고, 멤버가 아닌 사람은 표를 못 연다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const alice = await member('앨리스')
    const outsider = await member('바깥 사람')
    const team = await teamspaceWith(fx.owner, alice)
    const table = await tableIn(team)

    const row = await createRow(alice.ctx, table.dataSourceId)
    assert.ok(row.ok, JSON.stringify(row))
    assert.equal((await rowOf(row.value.id)).perm_scope_id, team, '행이 teamspace 스코프를 따르지 않는다')

    const listed = await listRows(alice.ctx, table.dataSourceId)
    assert.ok(listed.ok && listed.value.rows.some((r) => r.id === row.value.id))
    assert.equal((await listRows(outsider.ctx, table.dataSourceId)).ok, false)
    assert.equal((await createRow(outsider.ctx, table.dataSourceId)).ok, false)
  })
})

// ── ③ · ④ ─────────────────────────────────────────────────────────────

describe('③ 둘 수 없는 자리 · ④ 워크스페이스 최상위', () => {
  test('멤버가 아닌 · 보관된 · 남의 워크스페이스 teamspace 에는 못 만든다(not_found) — 아무것도 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const other = await member('다른 사람')
    const notMine = await teamspaceWith(other)
    const archived = await teamspaceWith(fx.owner)
    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [archived])
    const elsewhere = await makeFixture()
    const theirs = await teamspaceWith(elsewhere.owner)
    const count = async () =>
      (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM block WHERE workspace_id = $1 AND type = 'database'`, [fx.workspaceId])).n
    const before = await count()

    for (const teamspaceId of [notMine, archived, theirs]) {
      assert.deepEqual(await createDatabase(fx.owner.ctx, { name: '몰래', teamspaceId }), { ok: false, reason: 'not_found' }, teamspaceId)
    }
    assert.equal(await count(), before, '거부됐는데 표가 남았다')
  })

  test('teamspace 를 주지 않으면 전과 같다 — 워크스페이스 최상위에 모두의 행을 갖고 태어난다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await tableIn(null)
    assert.deepEqual(await rowOf(table.id), {
      parent_type: 'workspace',
      parent_id: fx.workspaceId,
      ancestor_path: [],
      perm_scope_id: table.id,
    })
    assert.deepEqual(await aclOf(table.id), [['workspace_everyone', 'full_access']])
  })
})
