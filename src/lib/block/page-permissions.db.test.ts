/**
 * 페이지 명령의 권한 — 휴지통 · 복원 · 영구 삭제 · 이동 (F-06-01 · F-06-20 · F-11-05 · F-02-08)
 *
 * CRDT 5a 에서 발견한 구멍: 이 넷이 워크스페이스 멤버인지만 봤다. 볼 수 없는 페이지도 id 를 알면 버리고 옮길 수 있었고,
 * 이동 대상 목록은 워크스페이스의 모든 페이지 제목을 화면에 넘겼다.
 *
 * 이 파일이 지키는 것 (HANDOFF §3.2-18).
 *
 *   ① **볼 수 없는 페이지는 없는 페이지와 같다** — `not_found`. 삭제 루트인지(`not_a_trash_root`)도 알려주지 않는다
 *   ② **볼 수만 있으면 `forbidden`** — 버리기 · 되살리기 · 영구 삭제 · 옮기기는 `edit_content` 를 요구한다
 *   ③ **옮길 곳에는 `create_child` 가 있어야 한다** — 볼 수 없는 곳 · 볼 수만 있는 곳은 `target_not_found`(하위 페이지
 *      생성과 같은 매핑). 최상위로는 옮길 수 있다
 *   ④ **이동 대상 목록은 옮길 수 있는 곳만 담고, 볼 수 없는 페이지의 제목은 어디에도 싣지 않는다**(경로 라벨 포함)
 *   ⑤ **거부는 아무것도 쓰지 않는다**
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { listMovableTargets, movePage, MoveError } from './move-page.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { purgePage, restorePage, trashPage, TrashError } from './trash.ts'

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

async function workspace(): Promise<{ owner: Actor; member: Actor }> {
  const workspaceId = await createBareWorkspace('페이지 권한')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  return { owner, member }
}

const mk = async (actor: Actor, title: string, parent: string | null = null): Promise<BlockId> =>
  (await createPage(actor.ctx, { parentPageId: parent as BlockId | null, title: titleFromPlainText(title) })).id

/** 최상위 페이지를 소유자만의 것으로 바꾸고 멤버에게 `level` 을 준다(null 이면 아무것도). */
async function restrict(owner: Actor, member: Actor, pageId: string, level: Level | null): Promise<void> {
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  if (level !== null) {
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, level)).ok, true)
  }
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

const stateOf = (id: string) =>
  queryOne<{ lifecycle: string; parent_id: string; ancestor_path: string[]; version: string }>(
    `SELECT lifecycle, parent_id, ancestor_path, version FROM block WHERE id = $1`,
    [id],
  )

/** 명령이 던진 오류 코드. 던지지 않았으면 `'ok'`. */
async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run
    return 'ok'
  } catch (e) {
    if (e instanceof TrashError || e instanceof MoveError) return e.code
    throw e
  }
}

// ── ① ② 휴지통 · 복원 · 영구 삭제 ───────────────────────────────────

describe('휴지통 · 복원 · 영구 삭제', () => {
  test('★ 볼 수 없는 페이지는 not_found, 볼 수만 있으면 forbidden, 고칠 수 있으면 버린다 — 거부는 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const hidden = await mk(owner, '비공개')
    await restrict(owner, member, hidden, null)
    const viewable = await mk(owner, '보기만')
    await restrict(owner, member, viewable, 'view')
    const editable = await mk(owner, '고칠 수 있음')
    await restrict(owner, member, editable, 'edit')
    const before = [await stateOf(hidden), await stateOf(viewable)]

    assert.deepEqual(
      [await codeOf(trashPage(member.ctx, hidden)), await codeOf(trashPage(member.ctx, viewable))],
      ['not_found', 'forbidden'],
    )
    assert.deepEqual([await stateOf(hidden), await stateOf(viewable)], before, '거부했는데 무언가 썼다')
    assert.equal(await codeOf(trashPage(member.ctx, editable)), 'ok')
  })

  test('★ 되살리기 · 영구 삭제도 같다 — 볼 수 없는 페이지에는 삭제 루트인지부터 알려주지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const hidden = await mk(owner, '비공개')
    const hiddenChild = await mk(owner, '비공개 하위', hidden)
    await restrict(owner, member, hidden, null)
    const viewable = await mk(owner, '보기만')
    await restrict(owner, member, viewable, 'view')
    await trashPage(owner.ctx, hidden)
    await trashPage(owner.ctx, viewable)
    const before = [await stateOf(hidden), await stateOf(hiddenChild), await stateOf(viewable)]

    assert.deepEqual(
      [
        await codeOf(restorePage(member.ctx, hidden)),
        await codeOf(restorePage(member.ctx, hiddenChild)),
        await codeOf(restorePage(member.ctx, viewable)),
        await codeOf(purgePage(member.ctx, hidden)),
        await codeOf(purgePage(member.ctx, hiddenChild)),
        await codeOf(purgePage(member.ctx, viewable)),
      ],
      ['not_found', 'not_found', 'forbidden', 'not_found', 'not_found', 'forbidden'],
    )
    assert.deepEqual([await stateOf(hidden), await stateOf(hiddenChild), await stateOf(viewable)], before, '거부했는데 무언가 썼다')

    assert.equal(await codeOf(restorePage(owner.ctx, viewable)), 'ok', '권한이 있으면 되살린다')
  })
})

// ── ② ③ 이동 ─────────────────────────────────────────────────────────

describe('이동', () => {
  test('★ 옮길 페이지 — 볼 수 없으면 not_found, 볼 수만 있으면 forbidden. 거부는 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const hidden = await mk(owner, '비공개')
    await restrict(owner, member, hidden, null)
    const viewable = await mk(owner, '보기만')
    await restrict(owner, member, viewable, 'view')
    const open = await mk(member, '멤버의 페이지')
    const before = [await stateOf(hidden), await stateOf(viewable)]

    assert.deepEqual(
      [await codeOf(movePage(member.ctx, hidden, open)), await codeOf(movePage(member.ctx, viewable, open))],
      ['not_found', 'forbidden'],
    )
    assert.deepEqual([await stateOf(hidden), await stateOf(viewable)], before, '거부했는데 무언가 썼다')
  })

  test('★ 옮길 곳 — create_child 가 없으면(볼 수 없는 곳 · 볼 수만 있는 곳) target_not_found. 고칠 수 있는 곳과 최상위로는 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const mine = await mk(member, '옮길 페이지')
    const hidden = await mk(owner, '비공개')
    await restrict(owner, member, hidden, null)
    const viewable = await mk(owner, '보기만')
    await restrict(owner, member, viewable, 'view')
    const editable = await mk(owner, '고칠 수 있음')
    await restrict(owner, member, editable, 'edit')
    const before = await stateOf(mine)

    assert.deepEqual(
      [await codeOf(movePage(member.ctx, mine, hidden)), await codeOf(movePage(member.ctx, mine, viewable))],
      ['target_not_found', 'target_not_found'],
    )
    assert.deepEqual(await stateOf(mine), before, '거부했는데 무언가 썼다')
    assert.equal(await codeOf(movePage(member.ctx, mine, editable)), 'ok')
    assert.equal(await codeOf(movePage(member.ctx, mine, null)), 'ok')
  })
})

// ── ④ 이동 대상 목록 ─────────────────────────────────────────────────

describe('이동 대상 목록', () => {
  test('★ 옮길 수 있는 곳만 담고, 볼 수 없는 페이지의 제목은 경로 라벨까지 어디에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const mine = await mk(member, '옮길 페이지')

    const hidden = await mk(owner, '비밀 루트')
    const hiddenChild = await mk(owner, '비밀 하위', hidden)
    const openUnderHidden = await mk(owner, '열린 하위', hidden)
    await restrict(owner, member, hidden, null)
    assert.equal((await grantAccess(owner.ctx, openUnderHidden, { type: 'user', id: member.userId }, 'edit')).ok, true)

    const viewable = await mk(owner, '보기만 루트')
    const editableUnderViewable = await mk(owner, '보기만 밑의 고칠 곳', viewable)
    await restrict(owner, member, viewable, 'view')
    assert.equal((await grantAccess(owner.ctx, editableUnderViewable, { type: 'user', id: member.userId }, 'edit')).ok, true)

    const targets = await listMovableTargets(member.ctx, mine)
    const byId = new Map(targets.map((target) => [target.id as string, target]))

    assert.deepEqual(
      [hidden, hiddenChild, viewable].map((id) => byId.has(id)),
      [false, false, false],
      '옮길 수 없는 곳이 목록에 있다',
    )
    assert.ok(byId.has(openUnderHidden) && byId.has(editableUnderViewable), '옮길 수 있는 곳이 목록에 없다')
    assert.ok(!JSON.stringify(targets).includes('비밀'), '볼 수 없는 페이지의 제목이 목록에 실렸다')
    assert.deepEqual(byId.get(openUnderHidden)?.path, [], '볼 수 없는 조상이 경로에 들어갔다')
    assert.deepEqual(byId.get(editableUnderViewable)?.path, ['보기만 루트'], '볼 수 있는 조상의 제목이 경로에 없다')
  })
})
