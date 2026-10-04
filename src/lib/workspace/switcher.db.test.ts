/**
 * 워크스페이스 스위처가 받는 것 — 잔여 묶음 8j-1 (F-14-09 · F-02-17)
 *
 *   ① 이 계정의 이메일과 워크스페이스 전부 — 만든 순서(단축키의 자리) · 역할 · 다른 워크스페이스에서 물어도 같다
 *   ② 떠난 워크스페이스 · 지운 워크스페이스는 없다
 *   ③ 다른 사람의 워크스페이스는 없다
 *   ④ 다른 계정들(8j-3) — 들어와 있는 계정만 워크스페이스를 받는다 · 2단계 인증이 남았거나 끝난 세션은 빈 목록(화면이 그리지 않아도
 *     페이로드에 이름이 실리지 않게)
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createWorkspace } from './create.ts'
import { switcherOf, withWorkspaces } from './list.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Fixture
let mine: string
let member: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await makeFixture()
  // 소유자가 둘째 워크스페이스를 만들고 · 남의 워크스페이스에 멤버로 들어간다 — 목록은 만든 순서(fx · other · mine)지 들어간 순서가 아니다
  mine = (await createWorkspace({ ownerUserId: fx.owner.userId, name: '스위처의 둘째' })).workspaceId
  await joinAs(other.workspaceId, fx.owner, 'member')
  member = await joinAs(fx.workspaceId, await createUser('스위처의 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

test('★ ① 이메일과 워크스페이스 전부 — 만든 순서 · 역할', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const got = await switcherOf(fx.owner.ctx)
  assert.equal(got.email, fx.owner.email)
  assert.deepEqual(
    got.workspaces.map((w) => [w.workspaceId, w.role]),
    [
      [fx.workspaceId, 'owner'],
      [other.workspaceId, 'member'],
      [mine, 'owner'],
    ],
  )
  assert.equal(got.workspaces.find((w) => w.workspaceId === mine)?.name, '스위처의 둘째')
  // 다른 워크스페이스의 세션으로 물어도 같다 — 계정의 목록이다
  const elsewhere = await joinAs(mine, fx.owner, 'owner')
  assert.deepEqual((await switcherOf(elsewhere.ctx)).workspaces.map((w) => w.workspaceId), got.workspaces.map((w) => w.workspaceId))
})

test('② 떠난 워크스페이스 · 지운 워크스페이스는 없다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [other.workspaceId, fx.owner.userId])
  await query(`UPDATE workspace SET deleted_at = now() WHERE id = $1`, [mine])
  try {
    assert.deepEqual((await switcherOf(fx.owner.ctx)).workspaces.map((w) => w.workspaceId), [fx.workspaceId])
  } finally {
    await query(`UPDATE workspace_member SET status = 'active' WHERE workspace_id = $1 AND user_id = $2`, [other.workspaceId, fx.owner.userId])
    await query(`UPDATE workspace SET deleted_at = NULL WHERE id = $1`, [mine])
  }
})

test('③ 다른 사람의 워크스페이스는 없다 — 멤버는 자기 것만', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const got = await switcherOf(member.ctx)
  assert.equal(got.email, member.email)
  assert.deepEqual(got.workspaces.map((w) => [w.workspaceId, w.role]), [[fx.workspaceId, 'member']])
})

test('★ ④ 다른 계정들 — 들어와 있는 계정만 워크스페이스를 받는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const base = { userId: fx.owner.userId, name: '', email: fx.owner.email }
  const got = await withWorkspaces([
    { ...base, state: 'signed_in' },
    { ...base, state: 'mfa_required' },
    { ...base, state: 'signed_out' },
  ])
  assert.deepEqual(got.map((a) => [a.state, a.workspaces.length > 0]), [
    ['signed_in', true],
    ['mfa_required', false],
    ['signed_out', false],
  ])
  assert.deepEqual(await withWorkspaces([]), [])
})
