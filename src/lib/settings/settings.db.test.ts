/**
 * 설정 — 설정 정보구조 8g-1조각 (F-17-12)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 읽기 — 역할마다 보이는 항목 · 값 · 고칠 수 있는가(소유자 · 멤버 · 게스트)
 *   ② **내 이름은 `"user".name` 을 고친다** — 게스트도 · 공백을 정리한 값으로 · 다른 워크스페이스에서도 같은 이름
 *   ③ 워크스페이스 이름은 소유자만 — 멤버는 보지만 못 고친다 · 목록 · 머리가 따라온다
 *   ④ 거부는 아무것도 쓰지 않는다 — 모르는 키 · 권한 · 값
 *   ⑤ 패널(8g-2 · 8i-1b) — 그 기능의 판정 그대로 역할마다 선다(비밀번호는 누구나 · 소유자 다섯 · 멤버 관리자 넷 · 멤버 둘)
 *   ⑥ 테마(8h) — 행이 없으면 system · 고르면 setting_value 한 줄 · 모든 워크스페이스에서 같다 · 세션 토큰으로 읽는다
 *
 * 정책(`workspace.allow_nonmember_page_access_request`)의 판정은 `permissions/outsider-request.db.test.ts` ⑩ 이 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createBareWorkspace, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { listWorkspacesForUser, workspaceNameOf } from '../workspace/list.ts'
import { visiblePanels } from './panels.ts'
import { readSettings, updateSetting } from './settings.ts'
import { themeOfSessionToken } from './theme.ts'

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
  test('★ 역할마다 보이는 항목과 고칠 수 있는가 — 소유자 넷 · 멤버 셋(워크스페이스 이름은 읽기 전용) · 게스트 둘(내 계정만)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    assert.deepEqual(await rows(fx.owner), [
      ['account.name', true],
      ['account.theme', true],
      ['workspace.name', true],
      ['workspace.allow_nonmember_page_access_request', true],
    ])
    assert.deepEqual(await rows(member), [
      ['account.name', true],
      ['account.theme', true],
      ['workspace.name', false],
    ])
    assert.deepEqual(await rows(guest), [
      ['account.name', true],
      ['account.theme', true],
    ])
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

describe('⑤ 패널', () => {
  test('★ 그 기능의 판정 그대로 — 비밀번호는 누구나 · 소유자 다섯 · 멤버 관리자 넷(내보내기 없음) · 멤버 둘(목록 · 그룹) · 게스트는 비밀번호뿐', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const admin = await joinAs(fx.workspaceId, await createUser('설정의 멤버 관리자'), 'membership_admin')
    const ids = (who: Actor) => visiblePanels(who.ctx).map((panel) => panel.id)
    assert.deepEqual(ids(fx.owner), ['password', 'mfa', 'members', 'invites', 'guests', 'groups', 'export', 'plan'])
    assert.deepEqual(ids(admin), ['password', 'mfa', 'members', 'invites', 'guests', 'groups', 'plan'])
    assert.deepEqual(ids(member), ['password', 'mfa', 'members', 'groups'])
    assert.deepEqual(ids(guest), ['password', 'mfa'])
  })
})

describe('⑥ 테마', () => {
  test('★ 행이 없으면 system · 고르면 setting_value 한 줄 · 다른 워크스페이스 · 세션 토큰에서도 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const user = await createUser('테마를 고르는 사람')
    const here = await joinAs(fx.workspaceId, user, 'member')
    const elsewhere = await joinAs(await createBareWorkspace('테마의 다른 곳'), user, 'guest')
    const themeOf = async (who: Actor) => (await readSettings(who.ctx)).find((item) => item.key === 'account.theme')?.value
    const stored = () => query<{ value: unknown }>(`SELECT value FROM setting_value WHERE scope = 'account' AND user_id = $1 AND key = 'account.theme'`, [user.userId])

    assert.equal(await themeOf(here), 'system')
    assert.equal(await themeOfSessionToken(here.token), 'system')
    assert.equal((await stored()).length, 0, '읽기만 했는데 행이 생겼다')

    assert.deepEqual(await updateSetting(here.ctx, 'account.theme', 'dark'), { ok: true, value: 'dark' })
    assert.deepEqual(await stored(), [{ value: 'dark' }])
    assert.equal(await themeOf(elsewhere), 'dark', '다른 워크스페이스에서 다른 테마 — 계정의 것이다')
    assert.equal(await themeOfSessionToken(elsewhere.token), 'dark')
    assert.equal(await themeOfSessionToken(fx.owner.token), 'system', '다른 사람의 테마가 따라왔다')
    assert.equal(await themeOfSessionToken(null), 'system')
    assert.equal(await themeOfSessionToken('없는 토큰'), 'system')

    // 기본으로 되돌려도 행은 남는다 — 사용자가 고른 값이다(정본 ②)
    assert.deepEqual(await updateSetting(here.ctx, 'account.theme', 'system'), { ok: true, value: 'system' })
    assert.deepEqual(await stored(), [{ value: 'system' }])

    assert.deepEqual(await updateSetting(here.ctx, 'account.theme', 'blue'), { ok: false, reason: 'invalid_value' })
    assert.deepEqual(await stored(), [{ value: 'system' }], '거부된 값이 쓰였다')
  })

  test('표에 모양이 맞지 않는 값이 있으면 기본으로 읽는다 — 행은 그대로 둔다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const user = await createUser('옛 테마 값을 가진 사람')
    const who = await joinAs(fx.workspaceId, user, 'member')
    await query(`INSERT INTO setting_value (scope, user_id, key, value) VALUES ('account', $1, 'account.theme', '"sepia"'::jsonb)`, [user.userId])
    assert.equal((await readSettings(who.ctx)).find((item) => item.key === 'account.theme')?.value, 'system')
    assert.equal(await themeOfSessionToken(who.token), 'system')
  })
})
