/**
 * 휴지통 — F-11-05 / F-02-11 / B2 · B3 · B4 · B5 / X-3
 *
 * 이 기능의 1순위 버그는 정본이 직접 지목했다: **조회 쿼리에서 lifecycle 필터를
 * 빼먹는 것.** 그래서 "휴지통에 넣었더니 목록·본문·이동 대상에서 정말 사라지는가"를
 * 각각 확인한다. "행의 lifecycle 이 바뀌었다"만 보면 그 사고를 못 잡는다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import {
  probeDatabase,
  makeFixture,
  createUser,
  createBareWorkspace,
  joinAs,
  type Fixture,
} from '../testing/db-fixtures.ts'
import { createPage, getPage, listChildPages, titleFromPlainText } from './page.ts'
import { listMovableTargets, movePage, MoveError } from './move-page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { listTrash, purgePage, restorePage, trashPage, TrashError } from './trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import { asBlockId, type BlockId } from '../ids.ts'

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

const page = (title: string, parent: BlockId | null = null) =>
  createPage(fx.owner.ctx, { parentPageId: parent, title: titleFromPlainText(title) })

async function rowOf(id: string) {
  const { queryOne } = await import('../db/pool.ts')
  return queryOne<{
    lifecycle: string
    trashed_at: Date | null
    trashed_by: string | null
    trash_root_id: string | null
    purge_after: Date | null
    purged_at: Date | null
    parent_id: string
    order_key: string
  }>(
    `SELECT lifecycle, trashed_at, trashed_by, trash_root_id, purge_after, purged_at,
            parent_id, order_key
       FROM block WHERE id = $1`,
    [id],
  )
}

// ── 삭제 ──────────────────────────────────────────────────────────────

describe('trashPage — 전파와 상태', () => {
  test('페이지와 자손 페이지가 함께 휴지통에 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)
    const grandchild = await page('손자', child.id)

    const result = await trashPage(fx.owner.ctx, root.id)
    assert.equal(result.trashedDescendants, 2)

    for (const id of [root.id, child.id, grandchild.id]) {
      assert.equal((await rowOf(id)).lifecycle, 'trashed', id)
    }
    // 자손의 trash_root_id 는 삭제를 실행한 페이지다.
    assert.equal((await rowOf(child.id)).trash_root_id, root.id)
    assert.equal((await rowOf(grandchild.id)).trash_root_id, root.id)
    assert.equal((await rowOf(root.id)).trash_root_id, root.id)
  })

  test('purge_after 가 workspace.trash_days 뒤로 잡힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const p = await page('보존 기간')
    const { purgeAfter } = await trashPage(fx.owner.ctx, p.id)
    const days = (purgeAfter.getTime() - Date.now()) / 86_400_000
    // 기본 30일. 초 단위 오차를 감안해 범위로 본다.
    assert.ok(days > 29.9 && days < 30.1, `${days}일`)
  })

  test('삭제해도 parent_id · order_key 를 건드리지 않는다 (B2)', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const child = await page('자식', parent.id)
    const before = await rowOf(child.id)

    await trashPage(fx.owner.ctx, child.id)
    const after = await rowOf(child.id)

    // 이 두 값이 보존되기 때문에 복원이 공짜다. 정본이 trash_entry 테이블을
    // "존재하지 않는다"고 못박은 근거이기도 하다.
    assert.equal(after.parent_id, before.parent_id)
    assert.equal(after.order_key, before.order_key)
  })

  test('본문 블록은 lifecycle 을 건드리지 않는다 (B5 / X-3)', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const p = await page('본문 있는 페이지')
    const blockId = randomUUID()
    assert.ok(
      (await savePageBody(fx.owner.ctx, p.id, {
        blocks: [{ id: blockId, type: 'paragraph', title: [textRun('본문') ] }],
      })).ok,
    )

    await trashPage(fx.owner.ctx, p.id)

    // ck_lifecycle_page CHECK 이 비페이지 블록의 non-live 를 막는다.
    // 전파가 페이지를 넘어가면 여기서 'trashed' 가 보인다.
    assert.equal((await rowOf(blockId)).lifecycle, 'live')
  })

  test('이미 따로 버려진 자손의 trash_root_id 는 덮이지 않는다 (B3)', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)

    // 자식을 먼저 따로 버린다.
    await trashPage(fx.owner.ctx, child.id)
    assert.equal((await rowOf(child.id)).trash_root_id, child.id)

    // 그다음 루트를 버린다.
    const result = await trashPage(fx.owner.ctx, root.id)
    assert.equal(result.trashedDescendants, 0, '이미 버려진 자손을 다시 세면 안 된다')

    // 덮였다면 루트 복원 시 이 자식까지 딸려 올라온다 — 사용자가 따로 버린 것을
    // 되살리는 셈이 된다.
    assert.equal((await rowOf(child.id)).trash_root_id, child.id)
  })

  test('휴지통 페이지는 다시 버릴 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const p = await page('두 번')
    await trashPage(fx.owner.ctx, p.id)
    await assert.rejects(
      () => trashPage(fx.owner.ctx, p.id),
      (e: unknown) => e instanceof TrashError && e.code === 'not_found',
    )
  })
})

// ── 조회에서 사라지는가 (이 기능의 1순위 버그) ────────────────────────

describe('휴지통에 넣으면 모든 조회에서 빠진다', () => {
  test('getPage · listChildPages · loadPageBody · listMovableTargets 전부', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const child = await page('자식', parent.id)
    const other = await page('다른 루트')

    // 부모 본문에 자식 페이지 참조를 넣어 둔다.
    const paraId = randomUUID()
    assert.ok(
      (await savePageBody(fx.owner.ctx, parent.id, {
        blocks: [
          { id: paraId, type: 'paragraph', title: [textRun('본문')] },
          { id: child.id, type: 'page', title: [] },
        ],
      })).ok,
    )

    await trashPage(fx.owner.ctx, child.id)

    assert.equal(await getPage(fx.owner.ctx, child.id), null, 'getPage 에 남아 있다')
    assert.deepEqual(
      (await listChildPages(fx.owner.ctx, parent.id)).map((c) => c.id),
      [],
      'listChildPages 에 남아 있다',
    )

    // 부모 본문에서도 참조가 빠져야 한다 — 정본의 "부모 Y.Doc 에서 참조 노드 제거".
    const body = await loadPageBody(fx.owner.ctx, parent.id)
    assert.deepEqual(body?.doc.blocks.map((b) => b.id), [paraId], '본문에 참조가 남아 있다')

    // 이동 대상 목록에도 없어야 한다.
    const targets = await listMovableTargets(fx.owner.ctx, other.id)
    assert.equal(targets.some((x) => x.id === child.id), false, '이동 대상에 남아 있다')
  })

  test('휴지통 페이지로는 옮길 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const dead = await page('버려질 대상')
    const alive = await page('살아 있는 페이지')
    await trashPage(fx.owner.ctx, dead.id)

    await assert.rejects(
      () => movePage(fx.owner.ctx, alive.id, dead.id),
      (e: unknown) => e instanceof MoveError && e.code === 'target_not_found',
    )
  })

  test('휴지통 페이지 자체는 옮길 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('대상')
    const dead = await page('버려진 것')
    await trashPage(fx.owner.ctx, dead.id)

    await assert.rejects(
      () => movePage(fx.owner.ctx, dead.id, target.id),
      (e: unknown) => e instanceof MoveError && e.code === 'not_found',
    )
  })

  test('휴지통 페이지의 본문은 저장할 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const p = await page('편집 불가')
    await trashPage(fx.owner.ctx, p.id)

    const result = await savePageBody(fx.owner.ctx, p.id, {
      blocks: [{ id: randomUUID(), type: 'paragraph', title: [textRun('쓰면 안 된다')] }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'not_found')
  })
})

// ── 목록 ──────────────────────────────────────────────────────────────

describe('listTrash — 삭제 루트만', () => {
  test('자손은 목록에 나오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const ws = await createBareWorkspace('휴지통 목록')
    const actor = await joinAs(ws, await createUser(), 'owner')
    const mk = (title: string, parent: BlockId | null = null) =>
      createPage(actor.ctx, { parentPageId: parent, title: titleFromPlainText(title) })

    const root = await mk('삭제 루트')
    await mk('자식', root.id)
    await mk('손자2', root.id)

    await trashPage(actor.ctx, root.id)

    const entries = await listTrash(actor.ctx)
    assert.deepEqual(entries.map((e) => e.title), ['삭제 루트'])
    assert.equal(entries[0].descendantCount, 2, '하위 개수를 함께 준다')
  })

  test('따로 버린 것은 각각 루트로 나온다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const ws = await createBareWorkspace('휴지통 다중')
    const actor = await joinAs(ws, await createUser(), 'owner')
    const a = await createPage(actor.ctx, { title: titleFromPlainText('A') })
    const b = await createPage(actor.ctx, { title: titleFromPlainText('B') })

    await trashPage(actor.ctx, a.id)
    await trashPage(actor.ctx, b.id)

    const entries = await listTrash(actor.ctx)
    assert.deepEqual(entries.map((e) => e.title).sort(), ['A', 'B'])
  })

  test('다른 워크스페이스의 휴지통은 보이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const otherWs = await createBareWorkspace('남의 휴지통')
    const other = await joinAs(otherWs, await createUser(), 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('남의 비밀 페이지') })
    await trashPage(other.ctx, foreign.id)

    const mine = await listTrash(fx.owner.ctx)
    assert.equal(
      mine.some((e) => e.id === foreign.id),
      false,
      '휴지통 목록으로 남의 페이지 제목이 유출된다',
    )
  })
})

// ── 복원 ──────────────────────────────────────────────────────────────

describe('restorePage — 루트 단위 (B3)', () => {
  test('원래 위치로 되돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const child = await page('자식', parent.id)
    const before = await rowOf(child.id)

    await trashPage(fx.owner.ctx, child.id)
    const result = await restorePage(fx.owner.ctx, child.id)

    assert.equal(result.reparented, false)
    const after = await rowOf(child.id)
    assert.equal(after.lifecycle, 'live')
    assert.equal(after.parent_id, before.parent_id)
    assert.equal(after.order_key, before.order_key, 'B2 덕분에 원위치가 공짜여야 한다')
    // live 는 trashed_at · purged_at 이 모두 NULL 이어야 한다(ck_lifecycle_ts).
    assert.equal(after.trashed_at, null)
    assert.equal(after.trash_root_id, null)
    assert.equal(after.purge_after, null)
  })

  test('자손도 함께 되살아난다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)
    const grandchild = await page('손자', child.id)

    await trashPage(fx.owner.ctx, root.id)
    const result = await restorePage(fx.owner.ctx, root.id)

    assert.equal(result.restoredDescendants, 2)
    for (const id of [root.id, child.id, grandchild.id]) {
      assert.equal((await rowOf(id)).lifecycle, 'live', id)
    }
  })

  test('따로 버려졌던 자손은 휴지통에 남는다 (B3)', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)

    await trashPage(fx.owner.ctx, child.id) // 먼저 자식만
    await trashPage(fx.owner.ctx, root.id) // 그다음 루트
    await restorePage(fx.owner.ctx, root.id)

    assert.equal((await rowOf(root.id)).lifecycle, 'live')
    assert.equal(
      (await rowOf(child.id)).lifecycle,
      'trashed',
      '사용자가 따로 버린 페이지가 루트 복원에 딸려 올라왔다',
    )
  })

  test('삭제 루트가 아니면 거부하고 어느 묶음인지 알려준다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)
    await trashPage(fx.owner.ctx, root.id)

    await assert.rejects(
      () => restorePage(fx.owner.ctx, child.id),
      (e: unknown) =>
        e instanceof TrashError && e.code === 'not_a_trash_root' && e.trashRootId === root.id,
    )
    // 거부됐으면 상태가 그대로여야 한다.
    assert.equal((await rowOf(child.id)).lifecycle, 'trashed')
  })

  test('복원 후 부모 본문에 참조가 다시 나타난다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const child = await page('자식', parent.id)
    const paraId = randomUUID()
    assert.ok(
      (await savePageBody(fx.owner.ctx, parent.id, {
        blocks: [
          { id: paraId, type: 'paragraph', title: [textRun('본문')] },
          { id: child.id, type: 'page', title: [] },
        ],
      })).ok,
    )

    await trashPage(fx.owner.ctx, child.id)
    await restorePage(fx.owner.ctx, child.id)

    // order_key 가 보존됐으므로 원래 순서 그대로 돌아와야 한다.
    const body = await loadPageBody(fx.owner.ctx, parent.id)
    assert.deepEqual(body?.doc.blocks.map((b) => b.id), [paraId, child.id])
  })
})

describe('restorePage — 부모가 사라진 경우 (B4)', () => {
  test('부모가 영구 삭제됐으면 최상위로 복원하고 알린다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('사라질 부모')
    const child = await page('자식', parent.id)
    const grandchild = await page('손자', child.id)

    // 자식을 먼저 따로 버려 둔다 → 자기 삭제 루트가 된다.
    await trashPage(fx.owner.ctx, child.id)
    // 그다음 부모를 버리고 영구 삭제한다.
    await trashPage(fx.owner.ctx, parent.id)
    await purgePage(fx.owner.ctx, parent.id)
    assert.equal((await rowOf(parent.id)).lifecycle, 'purged')

    const result = await restorePage(fx.owner.ctx, child.id)
    assert.equal(result.reparented, true, '부모가 없는데 원위치로 복원했다')

    const row = await rowOf(child.id)
    assert.equal(row.lifecycle, 'live')
    assert.equal(row.parent_id, fx.workspaceId, '최상위로 올라가지 않았다')

    // 서브트리 경로도 함께 다시 쓰여야 한다 — 이동과 같은 코드를 쓰는 이유다.
    const { queryOne } = await import('../db/pool.ts')
    const gc = await queryOne<{ ancestor_path: string[] }>(
      `SELECT ancestor_path FROM block WHERE id = $1`,
      [grandchild.id],
    )
    assert.deepEqual(gc.ancestor_path, [child.id])
  })
})

// ── 영구 삭제 ─────────────────────────────────────────────────────────

describe('purgePage — 2단계 보존 (F-02-11 정정)', () => {
  test('행을 지우지 않고 purged 로 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const p = await page('영구 삭제')
    await trashPage(fx.owner.ctx, p.id)
    await purgePage(fx.owner.ctx, p.id)

    const row = await rowOf(p.id)
    assert.equal(row.lifecycle, 'purged')
    // ②단계 — 아직 복구 경로가 있어야 하고 첨부 GC 도 하면 안 된다.
    // 그래서 행이 남아 있고 두 시각이 따로 기록된다.
    assert.notEqual(row.trashed_at, null)
    assert.notEqual(row.purged_at, null)
  })

  test('자손도 함께 purged 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)
    await trashPage(fx.owner.ctx, root.id)

    const result = await purgePage(fx.owner.ctx, root.id)
    assert.equal(result.purgedDescendants, 1)
    assert.equal((await rowOf(child.id)).lifecycle, 'purged')
  })

  test('purged 페이지는 휴지통 목록에도 없고 복원도 안 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const ws = await createBareWorkspace('영구 삭제 목록')
    const actor = await joinAs(ws, await createUser(), 'owner')
    const p = await createPage(actor.ctx, { title: titleFromPlainText('사라짐') })
    await trashPage(actor.ctx, p.id)
    await purgePage(actor.ctx, p.id)

    assert.deepEqual(await listTrash(actor.ctx), [])
    await assert.rejects(
      () => restorePage(actor.ctx, p.id),
      (e: unknown) => e instanceof TrashError && e.code === 'not_found',
    )
  })

  test('삭제 루트가 아니면 영구 삭제도 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)
    await trashPage(fx.owner.ctx, root.id)

    await assert.rejects(
      () => purgePage(fx.owner.ctx, child.id),
      (e: unknown) => e instanceof TrashError && e.code === 'not_a_trash_root',
    )
  })
})

// ── 워크스페이스 격리 ─────────────────────────────────────────────────

describe('워크스페이스 경계', () => {
  test('다른 워크스페이스의 페이지는 버릴 수도 되살릴 수도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const otherWs = await createBareWorkspace('휴지통 격리')
    const other = await joinAs(otherWs, await createUser(), 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('남의 페이지') })

    await assert.rejects(
      () => trashPage(fx.owner.ctx, foreign.id),
      (e: unknown) => e instanceof TrashError && e.code === 'not_found',
    )
    assert.equal((await rowOf(foreign.id)).lifecycle, 'live', '실제로 버려졌다')

    await trashPage(other.ctx, foreign.id)
    await assert.rejects(
      () => restorePage(fx.owner.ctx, foreign.id),
      (e: unknown) => e instanceof TrashError && e.code === 'not_found',
    )
  })

  test('없는 페이지도 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    await assert.rejects(
      () => trashPage(fx.owner.ctx, asBlockId(randomUUID())),
      (e: unknown) => e instanceof TrashError && e.code === 'not_found',
    )
  })
})
