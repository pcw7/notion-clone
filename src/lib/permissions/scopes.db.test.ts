/**
 * 스코프 후보 — 블록이 가리키는 `perm_scope_id` 로 고른다 (플랫폼 잔여 10l-2 · F-12-07)
 *
 * `scopesWith` 는 워크스페이스의 블록마다 "경계인가"(ACL 행이 있거나 끊겼다)를 묻다가, 블록이 가리키는 스코프(`perm_scope_id`)를
 * 후보로 고르고 경계는 이미 읽는 사슬의 행으로 가르게 바뀌었다. 지키는 것 셋.
 *   ① 같은 답 — 여러 모양의 트리(직속 · 하위 · 직접 부여 · 끊김 · 개인 최상위 · teamspace 최상위 · 그 아래 부여)에서, 사람마다 ·
 *      물음마다 옛 정의("경계 블록 중 판정이 required 를 다 가진 것 + teamspace")와 같다.
 *   ② 행이 없는 워크스페이스 직속 페이지 — 자기 자신을 스코프로 가리키지만(`acl.ts` 의 `parentScope`) 경계가 아니라 스코프가 아니다.
 *   ③ 다른 워크스페이스의 노드를 가리키는 어긋난 행이 있어도 그 노드를 스코프로 내지 않는다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Fixture, type Actor } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createTeamspace } from '../workspace/teamspace.ts'
import { grantAccess, stopInheriting } from './acl.ts'
import { effectiveCaps, scopesWith, teamspaceCaps } from './effective.ts'
import { can, type Capability } from './levels.ts'
import { withReadTransaction } from '../db/tx.ts'
import { query } from '../db/pool.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let granted: Actor
let plain: Actor
const page: Record<string, string> = {}
let teamspaceId = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  granted = await joinAs(fx.workspaceId, await createUser('스코프 받은 사람'), 'member')
  plain = await joinAs(fx.workspaceId, await createUser('스코프 그냥 멤버'), 'member')
  const make = async (title: string, input: Parameters<typeof createPage>[1] = {}) =>
    (await createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...input })).id

  page.root = await make('직속')
  page.child = await make('물려받는 하위', { parentPageId: page.root })
  page.grantedChild = await make('직접 준 하위', { parentPageId: page.root })
  assert.ok((await grantAccess(fx.owner.ctx, page.grantedChild, { type: 'user', id: granted.userId }, 'view')).ok)
  page.cutChild = await make('끊은 하위', { parentPageId: page.root })
  assert.ok((await stopInheriting(fx.owner.ctx, page.cutChild)).ok)
  page.privateTop = await make('개인 최상위', { privateTop: true })

  const teamspace = await createTeamspace(fx.owner.ctx, { name: `스코프 팀 ${Date.now()}` })
  assert.ok(teamspace.ok, JSON.stringify(teamspace))
  teamspaceId = teamspace.value.id
  page.teamTop = await make('팀 최상위', { teamspaceId })
  page.teamGranted = await make('팀 아래 준 하위', { parentPageId: page.teamTop })
  assert.ok((await grantAccess(fx.owner.ctx, page.teamGranted, { type: 'user', id: granted.userId }, 'edit')).ok)

  // ② 행이 없는 직속 페이지 — 명령으로는 만들 수 없다(마지막 행을 거두면 would_orphan). 행을 직접 지워 그 모양을 세운다.
  page.bareRoot = await make('행 없는 직속')
  await query(`DELETE FROM acl_entry WHERE node_kind = 'block' AND node_id = $1`, [page.bareRoot])
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 옛 정의 — 경계 블록(행이 있거나 끊겼다) 전부를 훑어 노드마다 판정한 것 + teamspace. 바꾸기 전의 질의 그대로다. */
async function oldScopes(actor: Actor, required: readonly Capability[]): Promise<string[]> {
  return withReadTransaction(async (tx) => {
    const boundary = await tx.query<{ id: string }>(
      `SELECT b.id FROM block b
        WHERE b.workspace_id = $1
          AND (EXISTS (SELECT 1 FROM acl_entry a WHERE a.node_kind = 'block' AND a.node_id = b.id)
            OR EXISTS (SELECT 1 FROM block_acl_meta m WHERE m.node_id = b.id AND m.inherits_from_parent = false))`,
      [fx.workspaceId],
    )
    const teamspaces = await tx.query<{ id: string }>(
      `SELECT id FROM teamspace WHERE workspace_id = $1 AND archived_at IS NULL`,
      [fx.workspaceId],
    )
    const out: string[] = []
    for (const { id } of boundary) {
      const caps = await effectiveCaps(tx, actor.ctx, id)
      if (required.every((c) => can(caps, c))) out.push(id)
    }
    for (const { id } of teamspaces) {
      const caps = await teamspaceCaps(tx, actor.ctx, id)
      if (required.every((c) => can(caps, c))) out.push(id)
    }
    return out.sort()
  })
}

const newScopes = async (actor: Actor, required: readonly Capability[]) =>
  (await withReadTransaction((tx) => scopesWith(tx, actor.ctx, required))).sort()

const scopeOf = async (id: string) =>
  (await query<{ perm_scope_id: string }>(`SELECT perm_scope_id FROM block WHERE id = $1`, [id]))[0].perm_scope_id

describe('★ ① 같은 답 — 여러 모양의 트리에서 옛 정의와 같다', () => {
  test('전제 — 모양이 의도대로 섰다(스코프가 가리키는 곳)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.equal(await scopeOf(page.child), page.root, '하위는 부모의 스코프를 물려받는다')
    assert.equal(await scopeOf(page.grantedChild), page.grantedChild)
    assert.equal(await scopeOf(page.cutChild), page.cutChild)
    assert.equal(await scopeOf(page.teamTop), teamspaceId, 'teamspace 최상위는 teamspace 를 가리킨다(블록이 아니다)')
    assert.equal(await scopeOf(page.teamGranted), page.teamGranted)
  })

  for (const required of [['view'], ['view', 'create_child'], ['edit_content']] as const) {
    test(`★ 사람마다 같은 답 — required ${required.join('+')}`, async (t) => {
      if (skipReason) return t.skip(skipReason)
      for (const [who, actor] of [['소유자', fx.owner], ['받은 사람', granted], ['그냥 멤버', plain]] as const) {
        const want = await oldScopes(actor, required)
        const got = await newScopes(actor, required)
        assert.deepEqual(got, want, `${who} · ${required.join('+')}`)
      }
    })
  }

  test('팀 아래 준 하위는 받은 사람만 · 직속 아래 준 하위는 둘 다(상속은 그대로 — 직속의 "모든 멤버" 행)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mine = await newScopes(granted, ['view'])
    const theirs = await newScopes(plain, ['view'])
    assert.ok(mine.includes(page.grantedChild) && mine.includes(page.teamGranted), JSON.stringify({ mine, page }))
    assert.ok(theirs.includes(page.grantedChild) && !theirs.includes(page.teamGranted), JSON.stringify({ theirs, page }))
  })
})

describe('★ ② 행이 없는 워크스페이스 직속 페이지 — 자기를 가리키지만 스코프가 아니다', () => {
  test('★ 아무에게도 스코프로 나오지 않는다 — 소유자에게도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.equal(await scopeOf(page.bareRoot), page.bareRoot, '전제: 자기 자신을 가리킨다')
    const rows = await query(`SELECT 1 FROM acl_entry WHERE node_id = $1`, [page.bareRoot])
    assert.equal(rows.length, 0, '전제: 행이 없다')
    for (const actor of [fx.owner, granted, plain]) {
      assert.ok(!(await newScopes(actor, ['view'])).includes(page.bareRoot))
    }
  })
})

describe('★ ③ 다른 워크스페이스의 노드를 가리키는 어긋난 행', () => {
  test('★ 그 노드를 스코프로 내지 않는다 — 그 사람이 거기서 그 노드를 볼 수 있어도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 다른 워크스페이스의 페이지 X — 이 워크스페이스의 소유자가 거기서도 X 를 직접 받았다
    const other = await makeFixture()
    await joinAs(other.workspaceId, { userId: fx.owner.userId }, 'member')
    const foreign = (await createPage(other.owner.ctx, { title: titleFromPlainText('남의 워크스페이스') })).id
    assert.ok((await grantAccess(other.owner.ctx, foreign, { type: 'user', id: fx.owner.userId }, 'view')).ok)
    // 이 워크스페이스의 블록 하나가 X 를 가리키게 어긋낸다(명령으로는 생기지 않는다)
    const victim = page.child
    const before = await scopeOf(victim)
    await query(`UPDATE block SET perm_scope_id = $1 WHERE id = $2`, [foreign, victim])
    try {
      const scopes = await newScopes(fx.owner, ['view'])
      assert.ok(!scopes.includes(foreign), '다른 워크스페이스의 노드가 스코프로 나왔다')
    } finally {
      await query(`UPDATE block SET perm_scope_id = $1 WHERE id = $2`, [before, victim])
    }
  })
})

// 끊긴 노드는 행이 없어도 경계다(절단만으로) — 후보로 들어와 경계로 갈린다. 행이 없으니 아무에게도 열리지 않는다(옛 정의도 같다).
describe('끊고 행을 다 거둔 하위', () => {
  test('후보 · 경계로 들어오지만 아무에게도 열리지 않는다 — 옛 정의와 같은 답', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const cut = (await createPage(fx.owner.ctx, { title: titleFromPlainText('끊고 비운 하위'), parentPageId: page.root })).id
    assert.ok((await stopInheriting(fx.owner.ctx, cut)).ok)
    // 소유자 행만 남기고 나머지를 거두면 would_orphan 이 막는다 — 행을 직접 지워 "끊김만 있는" 모양을 세운다
    await query(`DELETE FROM acl_entry WHERE node_kind = 'block' AND node_id = $1`, [cut])
    assert.equal(await scopeOf(cut), cut)
    for (const actor of [fx.owner, granted, plain]) {
      const got = await newScopes(actor, ['view'])
      assert.deepEqual(got, await oldScopes(actor, ['view']))
      assert.ok(!got.includes(cut))
    }
  })
})
