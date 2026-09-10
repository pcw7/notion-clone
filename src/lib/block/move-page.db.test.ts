/**
 * 페이지 이동 — F-02-08 / X-7 / §3.11 트리거 ④ / I5
 *
 * 이동이 조용히 깨뜨릴 수 있는 것 넷을 전부 확인한다.
 *
 *   ① 자손의 `ancestor_path` 가 새 경로를 반영하는가 — 안 되면 breadcrumb 과
 *      서브트리 조회가 통째로 틀어진다
 *   ② `perm_scope_id` 가 경계를 넘은 노드만 바뀌는가
 *   ③ 사이클이 실제로 거부되는가 (I5)
 *   ④ 본문 블록까지 따라오는가 — 페이지만 갱신하면 본문이 트리에서 미아가 된다
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
import { createPage, titleFromPlainText, MAX_TREE_DEPTH } from './page.ts'
import { movePage, MoveError } from './move-page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
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

/** 페이지 하나. 제목으로 실패 메시지를 알아볼 수 있게 한다. */
async function page(title: string, parent: BlockId | null = null) {
  return createPage(fx.owner.ctx, {
    parentPageId: parent,
    title: titleFromPlainText(title),
  })
}

/** DB 에서 직접 읽는다 — 서비스 계층을 거치지 않아야 진짜 상태를 본다. */
async function rowOf(id: string) {
  const { queryOne } = await import('../db/pool.ts')
  return queryOne<{
    parent_type: string
    parent_id: string
    ancestor_path: string[]
    perm_scope_id: string
    version: string
  }>(
    `SELECT parent_type, parent_id, ancestor_path, perm_scope_id, version
       FROM block WHERE id = $1`,
    [id],
  )
}

// ── 기본 ──────────────────────────────────────────────────────────────

describe('movePage — 부모 변경', () => {
  test('루트 페이지를 다른 페이지 아래로 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('대상')
    const moving = await page('옮길 것')

    const result = await movePage(fx.owner.ctx, moving.id, target.id)
    assert.equal(result.noop, false)
    assert.deepEqual(result.ancestors, [target.id])

    const row = await rowOf(moving.id)
    assert.equal(row.parent_type, 'block')
    assert.equal(row.parent_id, target.id)
    assert.deepEqual(row.ancestor_path, [target.id])
  })

  test('하위 페이지를 워크스페이스 최상위로 꺼낸다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const child = await page('자식', parent.id)

    const result = await movePage(fx.owner.ctx, child.id, null)
    assert.deepEqual(result.ancestors, [])

    const row = await rowOf(child.id)
    assert.equal(row.parent_type, 'workspace')
    assert.equal(row.parent_id, fx.workspaceId)
    assert.deepEqual(row.ancestor_path, [])
  })

  test('이미 그 자리면 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const child = await page('자식', parent.id)
    const before = await rowOf(child.id)

    const result = await movePage(fx.owner.ctx, child.id, parent.id)
    assert.equal(result.noop, true)

    const after = await rowOf(child.id)
    // version 이 올라가면 검색 인덱서가 바뀐 것 없는 페이지를 다시 읽는다.
    assert.equal(after.version, before.version)
  })

  test('order_key 는 새 형제들의 맨 뒤다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('대상')
    const first = await page('먼저 있던 자식', target.id)
    const moving = await page('옮길 것')

    const result = await movePage(fx.owner.ctx, moving.id, target.id)
    assert.ok(
      result.orderKey > first.orderKey,
      `맨 뒤여야 한다: ${result.orderKey} vs ${first.orderKey}`,
    )
  })
})

// ── 서브트리 ──────────────────────────────────────────────────────────

describe('movePage — 서브트리가 따라온다 (X-7)', () => {
  test('손자까지 ancestor_path 가 다시 쓰인다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('새 부모')
    const root = await page('옮길 루트')
    const child = await page('자식', root.id)
    const grandchild = await page('손자', child.id)

    await movePage(fx.owner.ctx, root.id, target.id)

    assert.deepEqual((await rowOf(root.id)).ancestor_path, [target.id])
    assert.deepEqual((await rowOf(child.id)).ancestor_path, [target.id, root.id])
    assert.deepEqual(
      (await rowOf(grandchild.id)).ancestor_path,
      [target.id, root.id, child.id],
      '손자의 경로가 갈아 끼워지지 않았다 — 배열 슬라이스 인덱스를 확인하라',
    )
  })

  test('본문 블록도 따라온다 — 페이지만 고치면 본문이 미아가 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('새 부모')
    const moving = await page('옮길 것')

    const blockId = randomUUID()
    const saved = await savePageBody(fx.owner.ctx, moving.id, {
      blocks: [{ id: blockId, type: 'paragraph', title: [textRun('본문')] }],
    })
    assert.ok(saved.ok)

    // 이동 전: 본문 블록의 경로는 [moving]
    assert.deepEqual((await rowOf(blockId)).ancestor_path, [moving.id])

    const result = await movePage(fx.owner.ctx, moving.id, target.id)
    assert.equal(result.movedDescendants, 1)

    assert.deepEqual((await rowOf(blockId)).ancestor_path, [target.id, moving.id])
    // 본문 자체는 멀쩡해야 한다.
    const body = await loadPageBody(fx.owner.ctx, moving.id)
    assert.equal(body?.doc.blocks[0].title[0]?.plain_text, '본문')
  })

  test('깊은 서브트리에서도 상대 깊이가 유지된다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('새 부모')
    let current = await page('d0')
    const chain = [current.id]
    for (let i = 1; i < 5; i += 1) {
      current = await page(`d${i}`, current.id)
      chain.push(current.id)
    }

    await movePage(fx.owner.ctx, chain[0], target.id)

    for (let i = 0; i < chain.length; i += 1) {
      assert.deepEqual(
        (await rowOf(chain[i])).ancestor_path,
        [target.id, ...chain.slice(0, i)],
        `d${i} 의 경로가 틀렸다`,
      )
    }
  })
})

// ── 권한 스코프 ───────────────────────────────────────────────────────

describe('movePage — perm_scope_id (§3.11 트리거 ④)', () => {
  test('루트 아래로 들어가면 서브트리 전체가 새 스코프를 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('대상 루트')
    const moving = await page('옮길 루트')
    const child = await page('자식', moving.id)

    // 이동 전: 각 루트가 자기 스코프다.
    assert.equal(moving.permScopeId, moving.id)
    assert.equal(child.permScopeId, moving.id)

    await movePage(fx.owner.ctx, moving.id, target.id)

    assert.equal((await rowOf(moving.id)).perm_scope_id, target.id)
    assert.equal(
      (await rowOf(child.id)).perm_scope_id,
      target.id,
      '자손의 스코프가 옛 루트를 계속 가리킨다 — 권한이 조용히 틀어진다',
    )
  })

  test('최상위로 꺼내면 자기 자신이 스코프 루트가 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const parent = await page('부모')
    const moving = await page('자식', parent.id)
    const grandchild = await page('손자', moving.id)
    assert.equal(moving.permScopeId, parent.id)

    await movePage(fx.owner.ctx, moving.id, null)

    assert.equal((await rowOf(moving.id)).perm_scope_id, moving.id)
    assert.equal((await rowOf(grandchild.id)).perm_scope_id, moving.id)
  })

  test('본문 블록의 스코프도 함께 옮겨간다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('대상')
    const moving = await page('옮길 것')
    const blockId = randomUUID()
    assert.ok(
      (await savePageBody(fx.owner.ctx, moving.id, {
        blocks: [{ id: blockId, type: 'paragraph', title: [textRun('본문')] }],
      })).ok,
    )

    await movePage(fx.owner.ctx, moving.id, target.id)
    assert.equal((await rowOf(blockId)).perm_scope_id, target.id)
  })
})

// ── 거부 경로 ─────────────────────────────────────────────────────────

describe('movePage — 사이클 차단 (I5)', () => {
  test('자기 자신으로는 못 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const p = await page('자기 자신')
    await assert.rejects(
      () => movePage(fx.owner.ctx, p.id, p.id),
      (e: unknown) => e instanceof MoveError && e.code === 'cycle',
    )
  })

  test('자기 자손으로는 못 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await page('루트')
    const child = await page('자식', root.id)
    const grandchild = await page('손자', child.id)

    for (const target of [child.id, grandchild.id]) {
      await assert.rejects(
        () => movePage(fx.owner.ctx, root.id, target),
        (e: unknown) => e instanceof MoveError && e.code === 'cycle',
      )
    }

    // 거부됐으면 구조가 그대로여야 한다.
    assert.deepEqual((await rowOf(child.id)).ancestor_path, [root.id])
  })

  test('형제나 조카로는 옮길 수 있다 — 사이클이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const a = await page('A')
    const b = await page('B')
    const bChild = await page('B의 자식', b.id)

    await movePage(fx.owner.ctx, a.id, bChild.id)
    assert.deepEqual((await rowOf(a.id)).ancestor_path, [b.id, bChild.id])
  })
})

describe('movePage — 거부 경로', () => {
  test('다른 워크스페이스의 페이지는 옮길 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const otherWs = await createBareWorkspace('이동 격리')
    const other = await joinAs(otherWs, await createUser(), 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('남의 페이지') })

    await assert.rejects(
      () => movePage(fx.owner.ctx, foreign.id, null),
      (e: unknown) => e instanceof MoveError && e.code === 'not_found',
    )
    // 실제로 안 움직였는지 확인한다.
    assert.equal((await rowOf(foreign.id)).parent_id, otherWs)
  })

  test('다른 워크스페이스의 페이지를 대상으로 삼을 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const otherWs = await createBareWorkspace('대상 격리')
    const other = await joinAs(otherWs, await createUser(), 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('남의 페이지') })
    const mine = await page('내 페이지')

    await assert.rejects(
      () => movePage(fx.owner.ctx, mine.id, foreign.id),
      (e: unknown) => e instanceof MoveError && e.code === 'target_not_found',
    )
  })

  test('없는 대상은 target_not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const p = await page('페이지')
    await assert.rejects(
      () => movePage(fx.owner.ctx, p.id, asBlockId(randomUUID())),
      (e: unknown) => e instanceof MoveError && e.code === 'target_not_found',
    )
  })

  test('자식을 가질 수 없는 블록 아래로는 못 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const host = await page('본문 있는 페이지')
    const headingId = randomUUID()
    assert.ok(
      (await savePageBody(fx.owner.ctx, host.id, {
        blocks: [{ id: headingId, type: 'heading_1', title: [textRun('제목')] }],
      })).ok,
    )

    const moving = await page('옮길 것')
    await assert.rejects(
      () => movePage(fx.owner.ctx, moving.id, asBlockId(headingId)),
      (e: unknown) => e instanceof MoveError && e.code === 'target_not_found',
    )
  })
})

describe('movePage — 깊이 상한', () => {
  test(`서브트리를 옮겨 ${MAX_TREE_DEPTH} 를 넘기면 거부한다 — 페이지 하나만 보고 판단하지 않는다`, async (t) => {
    if (skipReason) return t.skip(skipReason)
    t.diagnostic('깊은 체인 두 개를 만든다 — 느리다')

    const ws = await createBareWorkspace('깊이 이동')
    const actor = await joinAs(ws, await createUser(), 'owner')
    const mk = (title: string, parent: BlockId | null) =>
      createPage(actor.ctx, { parentPageId: parent, title: titleFromPlainText(title) })

    // 깊이 60 짜리 대상 체인
    let deepTarget = await mk('t0', null)
    for (let i = 1; i < 60; i += 1) deepTarget = await mk(`t${i}`, deepTarget.id)

    // 깊이 50 짜리 이동 대상 (루트 + 자손 49단)
    const movingRoot = await mk('m0', null)
    let tail = movingRoot
    for (let i = 1; i < 50; i += 1) tail = await mk(`m${i}`, tail.id)

    // 60 + 50 = 110 > 100 → 거부되어야 한다.
    await assert.rejects(
      () => movePage(actor.ctx, movingRoot.id, deepTarget.id),
      (e: unknown) => e instanceof MoveError && e.code === 'too_deep',
      '서브트리의 가장 깊은 노드가 아니라 페이지 하나만 보고 통과시켰다',
    )

    // 얕은 곳으로는 갈 수 있다.
    const shallow = await mk('얕은 대상', null)
    const ok = await movePage(actor.ctx, movingRoot.id, shallow.id)
    assert.equal(ok.noop, false)
  })
})

// ── version ───────────────────────────────────────────────────────────

describe('movePage — version (X-6)', () => {
  test('옮긴 페이지와 자손 페이지의 version 이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const target = await page('대상')
    const moving = await page('옮길 것')
    const child = await page('자식', moving.id)

    const beforeMoving = (await rowOf(moving.id)).version
    const beforeChild = (await rowOf(child.id)).version

    await movePage(fx.owner.ctx, moving.id, target.id)

    // 경로가 바뀌면 breadcrumb 과 검색 문서가 달라진다 — 인덱서가 다시 읽어야 한다.
    assert.equal(Number((await rowOf(moving.id)).version), Number(beforeMoving) + 1)
    assert.equal(Number((await rowOf(child.id)).version), Number(beforeChild) + 1)
  })
})
