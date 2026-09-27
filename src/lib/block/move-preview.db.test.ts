/**
 * 이동 미리보기 — Teamspace · 게스트 · 그룹 7c-13조각 (F-06-20 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ `viewersOf` 는 판정과 같다 — 워크스페이스의 사람마다 세션으로 판정한 답(`canViewPage`)과 같은 사람을 센다
 *      (게스트 · 제한 멤버 · 그룹 · teamspace · 보관된 teamspace · 상속 끊기 · 개인 페이지)
 *   ② ★ 미리보기가 말한 대로 된다 — teamspace A → B · 개인으로(따로 준 공유가 걷히고, 하위의 공유는 남는다)
 *   ③ ★ 미리보기는 아무것도 바꾸지 않는다 — 행도 권한 신호도
 *   ④ 이미 그 자리면 noop · 뿌리 안의 이동은 바뀌는 사람이 없다 · 거부는 옮기기와 같다(`MoveError`)
 *   ⑤ 이름은 그 페이지를 공유할 수 있는 사람에게만 — 나머지는 수만
 *
 * 워크스페이스마다 사람을 전부 우리가 만든다(`office`) — 그래야 "이 워크스페이스에서 볼 수 있는 사람"을 정확히 셀 수 있다.
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import { openChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess, stopInheriting } from '../permissions/acl.ts'
import { canViewPage, viewersOf } from '../permissions/effective.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { addGroupMember, createGroup } from '../workspace/group.ts'
import { addTeamspaceMember, archiveTeamspace, createTeamspace, updateTeamspace } from '../workspace/teamspace.ts'
import { MoveError, movePage, previewMove, type MoveDestination } from './move-page.ts'
import { createPage, titleFromPlainText } from './page.ts'

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

/** 새 워크스페이스 — 사람을 전부 여기서 만든다. `people` 이 그 워크스페이스의 활성 멤버 전원이다. */
async function office() {
  const ws = await createBareWorkspace('이동 미리보기')
  const people: Actor[] = []
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => {
    const actor = await joinAs(ws, await createUser(name), role)
    people.push(actor)
    return actor
  }
  const boss = await person('대표', 'owner')
  return { ws, boss, person, people }
}

const user = (actor: Actor) => ({ type: 'user' as const, id: actor.userId })

async function teamspace(by: Actor, ...members: Actor[]): Promise<string> {
  const created = await createTeamspace(by.ctx, { name: unique('팀') })
  assert.ok(created.ok, JSON.stringify(created))
  for (const m of members) assert.ok((await addTeamspaceMember(by.ctx, created.value.id, user(m))).ok)
  return created.value.id
}

const page = async (by: Actor, where: { teamspaceId?: string; parentPageId?: BlockId; privateTop?: true } = {}) =>
  (await createPage(by.ctx, { ...where, title: titleFromPlainText(unique('문서')) })).id

/** 세션으로 판정한 답 — 이 사람들 중 그 페이지를 볼 수 있는 사람의 이름. */
async function truth(people: readonly Actor[], pageId: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (const p of people) if (await canViewPage(p.ctx, pageId)) out.add(p.userId)
  return out
}

const nameOf = async (ids: Iterable<string>): Promise<string[]> =>
  (await query<{ name: string }>(`SELECT name FROM "user" WHERE id = ANY($1::uuid[]) ORDER BY lower(name), id`, [[...ids]])).map(
    (r) => r.name,
  )

const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)))

// ── ① viewersOf ────────────────────────────────────────────────────────

describe('① viewersOf 는 판정과 같다', () => {
  test('★ 사람마다 세션으로 판정한 답과 같은 사람을 센다 — 게스트 · 제한 멤버 · 그룹 · teamspace · 보관 · 상속 끊기 · 개인', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person, people } = await office()
    const admin = await person('관리자', 'membership_admin')
    const ann = await person('앤')
    const bea = await person('비')
    const limited = await person('제한', 'restricted_member')
    const guest = await person('손님', 'guest')
    const group = await createGroup(boss.ctx, unique('그룹'))
    assert.ok(group.ok)
    for (const who of [bea, limited]) assert.ok((await addGroupMember(boss.ctx, group.value.id, who.userId)).ok)

    const team = await teamspace(boss, ann)
    assert.ok((await addTeamspaceMember(boss.ctx, team, { type: 'group', id: group.value.id })).ok)
    const archived = await teamspace(boss, admin)
    const archivedPage = await page(boss, { teamspaceId: archived })
    assert.deepEqual(await archiveTeamspace(boss.ctx, archived), { ok: true })

    const everyone = await page(boss)
    const teamPage = await page(boss, { teamspaceId: team })
    const cut = await page(boss, { parentPageId: teamPage })
    assert.ok((await stopInheriting(boss.ctx, cut)).ok)
    assert.ok((await grantAccess(boss.ctx, cut, user(guest), 'view')).ok)
    const mine = await page(ann, { privateTop: true })
    assert.ok((await grantAccess(ann.ctx, mine, user(limited), 'comment')).ok)
    // 떠난 사람 — 행은 남아 있지만(M1) 세션을 받을 수 없으니 아무것도 못 본다. 판정으로 물을 수 없으므로 목록에서 뺀다.
    const leaver = await person('떠난 사람')
    assert.ok((await grantAccess(boss.ctx, everyone, user(leaver), 'view')).ok)
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [ws, leaver.userId])
    people.splice(people.indexOf(leaver), 1)

    const nodes = [everyone, teamPage, cut, mine, archivedPage]
    const counted = await withReadTransaction((tx) => viewersOf(tx, ws, nodes))
    for (const node of nodes) {
      assert.deepEqual(
        await nameOf(counted.get(node) ?? []),
        await nameOf(await truth(people, node)),
        `판정과 다른 사람을 셌다: ${node}`,
      )
    }
    // 판정이 여러 갈래를 실제로 지났는지 — 모두 같은 답(모두 · 아무도)이면 위 비교가 헛돈다.
    const sizes = nodes.map((n) => counted.get(n)?.size ?? 0)
    assert.ok(new Set(sizes).size >= 3, `갈래가 모자란다: ${sizes.join(' · ')}`)
  })
})

// ── ② 미리보기가 말한 대로 된다 ────────────────────────────────────────

describe('② 미리보기가 말한 대로 된다', () => {
  test('★ teamspace A → B — A 에만 있는 사람이 잃고 B 에만 있는 사람이 얻는다 · 따로 준 공유와 양쪽 멤버는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person, people } = await office()
    const ann = await person('앤') // A 만
    const bea = await person('비') // B 만
    const cal = await person('칼') // 둘 다
    const dan = await person('댄') // 어디에도 없지만 따로 받았다
    const A = await teamspace(boss, ann, cal)
    const B = await teamspace(boss, bea, cal)
    const doc = await page(boss, { teamspaceId: A })
    assert.ok((await grantAccess(boss.ctx, doc, user(dan), 'view')).ok)

    const before = await truth(people, doc)
    const preview = await previewMove(boss.ctx, doc, { teamspaceId: B })
    assert.deepEqual(preview, {
      noop: false,
      lose: { count: 1, names: ['앤'] },
      gain: { count: 1, names: ['비'] },
      keep: 3,
      keptBelow: { pages: 0, people: 0 },
    })

    await movePage(boss.ctx, doc, { teamspaceId: B })
    const afterMove = await truth(people, doc)
    assert.deepEqual(await nameOf(minus(before, afterMove)), preview.lose.names, '미리보기가 말한 잃는 사람과 다르다')
    assert.deepEqual(await nameOf(minus(afterMove, before)), preview.gain.names, '미리보기가 말한 얻는 사람과 다르다')
  })

  test('★ 개인으로 — 이 페이지에 따로 준 공유까지 걷혀 모두 잃는다 · 하위에 따로 준 공유는 남는다(하위 N개를 M명이 여전히 본다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person, people } = await office()
    const ann = await person('앤')
    const bob = await person('밥', 'restricted_member') // 이 페이지에 따로 받았다 — 걷힌다
    const dan = await person('댄', 'restricted_member') // 하위 페이지에 따로 받았다 — 남는다
    const doc = await page(boss)
    assert.ok((await grantAccess(boss.ctx, doc, user(bob), 'view')).ok)
    const child = await page(boss, { parentPageId: doc })
    const grandchild = await page(boss, { parentPageId: child })
    assert.ok((await grantAccess(boss.ctx, child, user(dan), 'view')).ok)

    const before = await truth(people, doc)
    const preview = await previewMove(boss.ctx, doc, { privateTop: true })
    assert.deepEqual(preview.lose, { count: 2, names: ['밥', '앤'] })
    assert.deepEqual(preview.gain, { count: 0, names: [] })
    assert.equal(preview.keep, 1)
    // 하위 페이지와 그 아래 손자가 한 스코프다 — 둘 다 댄이 여전히 본다.
    assert.deepEqual(preview.keptBelow, { pages: 2, people: 1 })

    await movePage(boss.ctx, doc, { privateTop: true })
    assert.deepEqual(await nameOf(minus(before, await truth(people, doc))), preview.lose.names)
    for (const below of [child, grandchild]) {
      assert.ok(await canViewPage(dan.ctx, below), '미리보기가 "하위는 여전히 본다"고 했는데 못 본다')
    }
    assert.equal(await canViewPage(ann.ctx, child), false)
  })
})

// ── ③ 아무것도 바꾸지 않는다 ──────────────────────────────────────────

describe('③ 미리보기는 아무것도 바꾸지 않는다', () => {
  test('★ 자리 · 경로 · 스코프 · 공유 행이 그대로이고 · 권한 신호도 나가지 않는다', async (t: TestContext) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const ann = await person('앤')
    await person('밥') // teamspace 밖 — 옮기면 잃는다
    const team = await teamspace(boss, ann)
    const doc = await page(boss)
    const child = await page(boss, { parentPageId: doc })
    const snapshot = async () => ({
      rows: await query(
        `SELECT id, parent_type, parent_id, owner_user_id, perm_scope_id, ancestor_path, version FROM block WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[doc, child]],
      ),
      acl: await query(
        `SELECT node_id, principal_type, principal_id, level FROM acl_entry WHERE node_id = ANY($1::uuid[]) ORDER BY node_id, principal_type`,
        [[doc, child]],
      ),
    })

    const heard: CollabSignal[] = []
    const feed = await openChangeFeed({ onSignal: (s) => void heard.push(s), onResync: () => {} })
    t.after(() => feed.close())
    const was = await snapshot()
    for (const destination of [{ teamspaceId: team }, { privateTop: true as const }] satisfies MoveDestination[]) {
      const preview = await previewMove(boss.ctx, doc, destination)
      assert.ok(preview.lose.count > 0, '전제 — 뭔가 바뀌는 이동이어야 미리보기가 헛돌지 않는다')
    }
    assert.deepEqual(await snapshot(), was, '미리보기가 행을 바꿨다')
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.deepEqual(
      heard.filter((s) => s.kind === 'access' && s.workspaceId === ws),
      [],
      '미리보기가 권한 신호를 냈다 — 되돌린 쓰기의 알림이 나갔다',
    )
  })
})

// ── ④ noop · 변화 없음 · 거부 ─────────────────────────────────────────

describe('④ 이미 그 자리 · 바뀌는 사람 없음 · 거부', () => {
  test('이미 그 자리면 noop · 같은 뿌리 안의 이동은 잃는 사람도 얻는 사람도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    await person('앤')
    const doc = await page(boss)
    const other = await page(boss)
    assert.equal((await previewMove(boss.ctx, doc, null)).noop, true)
    const inside = await previewMove(boss.ctx, doc, other)
    assert.equal(inside.noop, false)
    assert.deepEqual([inside.lose.count, inside.gain.count, inside.keep], [0, 0, 2])
  })

  test('거부는 옮기기와 같다 — 편집만 받은 사람의 뿌리 이동은 needs_full_access · 볼 수 없는 페이지는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const ed = await person('편집자')
    const outsider = await person('남', 'restricted_member')
    const team = await teamspace(boss, ed)
    const doc = await page(boss, { teamspaceId: team })
    assert.deepEqual(await updateTeamspace(boss.ctx, team, { memberLevel: 'edit' }), { ok: true })

    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e instanceof MoveError ? e.code : `던짐: ${String(e)}`),
      )
    assert.equal(await code(previewMove(ed.ctx, doc, null)), 'needs_full_access')
    assert.equal(await code(movePage(ed.ctx, doc, null)), 'needs_full_access')
    assert.equal(await code(previewMove(outsider.ctx, doc, null)), 'not_found')
  })
})

// ── ⑤ 이름 ─────────────────────────────────────────────────────────────

describe('⑤ 이름은 공유할 수 있는 사람에게만', () => {
  test('★ 편집만 받은 사람에게는 수만 · 전체 권한인 사람에게는 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const ed = await person('편집자')
    const dan = await person('댄', 'restricted_member')
    const team = await teamspace(boss, ed)
    assert.deepEqual(await updateTeamspace(boss.ctx, team, { memberLevel: 'edit' }), { ok: true })
    const doc = await page(boss, { teamspaceId: team })
    // 같은 뿌리 안이지만 볼 수 있는 사람이 느는 자리 — 댄에게 따로 준 페이지 밑.
    const shared = await page(boss, { teamspaceId: team })
    assert.ok((await grantAccess(boss.ctx, shared, user(dan), 'view')).ok)

    const byEditor = await previewMove(ed.ctx, doc, shared)
    assert.deepEqual(byEditor.gain, { count: 1, names: null }, '공유할 수 없는 사람에게 이름이 갔다')
    const byOwner = await previewMove(boss.ctx, doc, shared)
    assert.deepEqual(byOwner.gain, { count: 1, names: ['댄'] })
  })
})
