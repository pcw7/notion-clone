/**
 * 설정 — 설정 정보구조 8g-1조각 (F-17-12)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 읽기 — 역할마다 보이는 항목 · 값 · 고칠 수 있는가(소유자 · 멤버 · 게스트)
 *   ② **내 이름은 `"user".name` 을 고친다** — 게스트도 · 공백을 정리한 값으로 · 다른 워크스페이스에서도 같은 이름
 *   ③ 워크스페이스 이름은 소유자만 — 멤버는 보지만 못 고친다 · 목록 · 머리가 따라온다
 *   ④ 거부는 아무것도 쓰지 않는다 — 모르는 키 · 권한 · 값
 *
 * 정책(`workspace.allow_nonmember_page_access_request`)의 판정은 `permissions/outsider-request.db.test.ts` ⑩ 이 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createBareWorkspace, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { listWorkspacesForUser, workspaceNameOf } from '../workspace/list.ts'
import { readSettings, updateSetting } from './settings.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let member: Actor
let guest: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  member = await joinAs(fx.workspaceId, await createUser('설정의 멤버'), 'member')
  guest = await joinAs(fx.workspaceId, await createUser('설정의 게스트'), 'guest')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const userName = async (userId: string) => (await query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [userId]))[0]?.name
const rows = async (who: Actor) => (await readSettings(who.ctx)).map((item) => [item.key, item.editable])

describe('① 읽기', () => {
  test('★ 역할마다 보이는 항목과 고칠 수 있는가 — 소유자 셋 · 멤버 둘(이름은 읽기 전용) · 게스트 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.deepEqual(await rows(fx.owner), [
      ['account.name', true],
      ['workspace.name', true],
      ['workspace.allow_nonmember_page_access_request', true],
    ])
    assert.deepEqual(await rows(member), [
      ['account.name', true],
      ['workspace.name', false],
    ])
    assert.deepEqual(await rows(guest), [['account.name', true]])
  })

  test('값은 그 설정이 사는 칸의 것이다 — 정책은 행이 없으면 켜짐', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const items = await readSettings(fx.owner.ctx)
    const valueOf = (key: string) => items.find((item) => item.key === key)?.value
    assert.equal(valueOf('account.name'), await userName(fx.owner.userId))
    assert.equal(valueOf('workspace.name'), await workspaceNameOf(fx.owner.ctx))
    assert.equal(valueOf('workspace.allow_nonmember_page_access_request'), true)
  })
})

describe('② 내 이름', () => {
  test('★ "user".name 을 고친다 — 공백을 정리한 값 · 게스트도 · 다른 워크스페이스에서도 같은 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const user = await createUser('이름을 바꿀 사람')
    const here = await joinAs(fx.workspaceId, user, 'guest')
    const elsewhere = await joinAs(await createBareWorkspace('다른 곳'), user, 'member')

    assert.deepEqual(await updateSetting(here.ctx, 'account.name', '  새   이름 '), { ok: true, value: '새 이름' })
    assert.equal(await userName(user.userId), '새 이름')
    const there = (await readSettings(elsewhere.ctx)).find((item) => item.key === 'account.name')?.value
    assert.equal(there, '새 이름', '다른 워크스페이스에서 다른 이름이 보인다 — 계정의 것이다')
  })
})

describe('③ 워크스페이스 이름', () => {
  test('★ 소유자만 고친다 — 멤버 · 게스트는 forbidden · 목록과 머리가 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('처음 이름')
    const owner = await joinAs(ws, await createUser('주인'), 'owner')
    const mate = await joinAs(ws, await createUser('동료'), 'member')
    const visitor = await joinAs(ws, await createUser('손님'), 'guest')

    for (const who of [mate, visitor]) {
      assert.deepEqual(await updateSetting(who.ctx, 'workspace.name', '몰래 바꾼 이름'), { ok: false, reason: 'forbidden' })
    }
    assert.equal(await workspaceNameOf(owner.ctx), '처음 이름')

    assert.deepEqual(await updateSetting(owner.ctx, 'workspace.name', ' 우리 팀 '), { ok: true, value: '우리 팀' })
    assert.equal(await workspaceNameOf(mate.ctx), '우리 팀')
    assert.equal((await listWorkspacesForUser(mate.userId)).find((w) => w.workspaceId === ws)?.name, '우리 팀')
  })
})

describe('④ 거부는 아무것도 쓰지 않는다', () => {
  test('모르는 키는 not_found · 값이 맞지 않으면 invalid_value — 이름이 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const before = await userName(fx.owner.userId)
    assert.deepEqual(await updateSetting(fx.owner.ctx, 'account.nickname', '별명'), { ok: false, reason: 'not_found' })
    for (const bad of ['', '    ', 'a'.repeat(101), 42, null, undefined]) {
      assert.deepEqual(await updateSetting(fx.owner.ctx, 'account.name', bad), { ok: false, reason: 'invalid_value' }, JSON.stringify(bad))
    }
    assert.equal(await userName(fx.owner.userId), before)
  })
})
