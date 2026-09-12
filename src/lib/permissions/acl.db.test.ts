/**
 * 권한 부여 · 절단 · 강제 — W6-b (F-06-01 / F-06-07 / F-02-03 / F-11-05)
 *
 * 이 파일이 지키는 것 다섯. 전부 **못 봐야 할 것이 보이는** 종류다.
 *
 *   ① 상속을 끊고 한 사람만 남기면 나머지는 **제목도 못 본다**(사이드바 · 휴지통 포함).
 *   ② 절단은 복사한 뒤에 한다 — 불변식 P1. 안 그러면 "1명 제거"가 "전원 상실"이다.
 *   ③ `perm_scope_id` 는 권한이 바뀔 때 서브트리째 따라온다(정본의 재계산 트리거).
 *   ④ 볼 수 없는 페이지는 **없는 페이지와 같다** — 403 과 404 를 구분해 주지 않는다.
 *   ⑤ 볼 수만 있는 사람은 저장할 수 없다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import {
  probeDatabase,
  makeFixture,
  createUser,
  joinAs,
  type Fixture,
  type Actor,
} from '../testing/db-fixtures.ts'
import { createPage, getPage, titleFromPlainText } from '../block/page.ts'
import { listPageTree } from '../block/page-tree.ts'
import { listTrash, trashPage } from '../block/trash.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { grantAccess, listAccess, revokeAccess, stopInheriting, resumeInheriting } from './acl.ts'
import { effectiveCaps, readableScopes } from './effective.ts'
import { can } from './levels.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { BlockId } from '../ids.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
/** 같은 워크스페이스의 다른 멤버. "남이 보는가"를 묻는 쪽이다. */
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const newPage = async (title: string, parentPageId?: BlockId): Promise<BlockId> =>
  (await createPage(fx.owner.ctx, { title: titleFromPlainText(title), parentPageId })).id

const capsOf = (actor: Actor, pageId: string) =>
  withReadTransaction((tx) => effectiveCaps(tx, actor.ctx, pageId))

const scopeOf = async (pageId: string): Promise<string> =>
  withReadTransaction(async (tx) => {
    const row = await tx.queryOne<{ perm_scope_id: string }>(
      `SELECT perm_scope_id FROM block WHERE id = $1`,
      [pageId],
    )
    return row.perm_scope_id
  })

describe('기본 상태 — 루트 페이지는 ACL 을 갖고 태어난다', () => {
  test('만든 사람도 다른 멤버도 볼 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('모두의 페이지')
    assert.ok(can(await capsOf(fx.owner, page), 'view'))
    assert.ok(can(await capsOf(other, page), 'view'), 'workspace_everyone 행이 없다')
  })

  test('하위 페이지는 자기 ACL 없이 상속만 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('루트')
    const child = await newPage('자식', root)

    const access = await listAccess(fx.owner.ctx, child)
    assert.ok(access.ok)
    assert.equal(access.value.length, 1)
    assert.equal(access.value[0].inherited, true, '자식에게 직접 행을 넣으면 부모 공유가 안 따라온다')
    assert.equal(await scopeOf(child), root, '스코프는 루트다')
  })
})

describe('★ 상속을 끊고 한 사람만 남기면', () => {
  test('나머지는 그 페이지를 못 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('비밀 루트')
    assert.ok(can(await capsOf(other, root), 'view'), '아직은 보인다')

    await assertOk(stopInheriting(fx.owner.ctx, root))
    await assertOk(grantAccess(fx.owner.ctx, root, { type: 'user', id: fx.owner.userId }, 'full_access'))
    await assertOk(revokeAccess(fx.owner.ctx, root, { type: 'workspace_everyone' }))

    assert.equal(can(await capsOf(other, root), 'view'), false, '남이 아직 본다')
    assert.ok(can(await capsOf(fx.owner, root), 'view'), '나까지 잃었다')
  })

  test('★ 자손까지 함께 가려진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('가릴 루트')
    const child = await newPage('가려질 자식', root)
    await restrictToOwner(root)

    assert.equal(can(await capsOf(other, child), 'view'), false)
    assert.ok(can(await capsOf(fx.owner, child), 'view'))
  })

  test('★ 사이드바에 제목도 나오지 않는다 (F-02-03 "존재도 노출 금지")', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('사이드바에서 사라질 제목')
    await restrictToOwner(root)

    const mine = await listPageTree(fx.owner.ctx)
    const theirs = await listPageTree(other.ctx)
    assert.ok(mine.some((n) => n.id === root))
    assert.equal(theirs.some((n) => n.id === root), false, '제목이 그대로 샜다')
  })

  test('★ 휴지통에도 나오지 않는다 (F-11-05)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('휴지통에서도 숨을 제목')
    await restrictToOwner(root)
    await trashPage(fx.owner.ctx, root)

    assert.ok((await listTrash(fx.owner.ctx)).some((e) => e.id === root))
    assert.equal((await listTrash(other.ctx)).some((e) => e.id === root), false)
  })

  test('★ 볼 수 없는 페이지는 없는 페이지와 같다 — 404 와 403 을 구분하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('없는 것처럼 보일 페이지')
    await restrictToOwner(root)

    assert.equal(await getPage(other.ctx, root), null)
    assert.equal(await loadPageBody(other.ctx, root), null)
  })
})

describe('★ 절단은 복사한 뒤에 한다 (불변식 P1)', () => {
  test('끊는 순간 상속받던 주체가 이 노드에 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('P1 루트')
    const child = await newPage('P1 자식', root)

    await assertOk(stopInheriting(fx.owner.ctx, child))

    const access = await listAccess(fx.owner.ctx, child)
    assert.ok(access.ok)
    const everyone = access.value.find((a) => a.principalType === 'workspace_everyone')
    assert.ok(everyone, '복사하지 않고 플래그만 내렸다 — "1명 제거"가 "전원 상실"이 된다')
    assert.equal(everyone.inherited, false, '이제 이 노드의 것이다')
    assert.ok(can(await capsOf(other, child), 'view'), '끊자마자 남이 접근을 잃었다')
  })

  test('끊은 뒤에는 조상의 새 권한이 내려오지 않는다 (P2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('P2 루트')
    const child = await newPage('P2 자식', root)
    await assertOk(stopInheriting(fx.owner.ctx, child))
    // ⚠ 모두 권한을 떼기 전에 관리자를 남긴다 — 안 그러면 `would_orphan` 이 막는다.
    //    공유 패널도 같은 순서로 움직여야 한다("나만 보기"는 두 조작이다).
    await assertOk(grantAccess(fx.owner.ctx, child, { type: 'user', id: fx.owner.userId }, 'full_access'))
    await assertOk(revokeAccess(fx.owner.ctx, child, { type: 'workspace_everyone' }))

    // 부모에는 여전히 workspace_everyone 이 있다.
    assert.ok(can(await capsOf(other, root), 'view'))
    assert.equal(can(await capsOf(other, child), 'view'), false, '끊긴 노드가 조상 권한을 받았다')
  })

  test('다시 상속하면 조상 권한이 돌아온다 (P3)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('P3 루트')
    const child = await newPage('P3 자식', root)
    await assertOk(stopInheriting(fx.owner.ctx, child))
    await assertOk(grantAccess(fx.owner.ctx, child, { type: 'user', id: fx.owner.userId }, 'full_access'))
    await assertOk(revokeAccess(fx.owner.ctx, child, { type: 'workspace_everyone' }))
    assert.equal(can(await capsOf(other, child), 'view'), false)

    await assertOk(resumeInheriting(fx.owner.ctx, child))
    assert.ok(can(await capsOf(other, child), 'view'))
  })
})

describe('★ perm_scope_id 재계산', () => {
  test('첫 ACL 을 넣으면 그 노드가 경계가 된다 (트리거 ①)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('스코프 루트')
    const child = await newPage('스코프 자식', root)
    const grandchild = await newPage('스코프 손자', child)
    assert.equal(await scopeOf(grandchild), root)

    await assertOk(grantAccess(fx.owner.ctx, child, { type: 'user', id: other.userId }, 'view'))

    assert.equal(await scopeOf(child), child)
    assert.equal(await scopeOf(grandchild), child, '자손이 따라오지 않았다')
    assert.equal(await scopeOf(root), root, '조상은 그대로여야 한다')
  })

  test('마지막 ACL 을 지우면 경계가 풀린다 (트리거 ②)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('풀릴 루트')
    const child = await newPage('풀릴 자식', root)
    await assertOk(grantAccess(fx.owner.ctx, child, { type: 'user', id: other.userId }, 'view'))
    assert.equal(await scopeOf(child), child)

    await assertOk(revokeAccess(fx.owner.ctx, child, { type: 'user', id: other.userId }))
    assert.equal(await scopeOf(child), root)
  })

  test('★ 아래쪽에 따로 준 권한의 스코프는 건드리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('바깥 루트')
    const mid = await newPage('중간', root)
    const deep = await newPage('깊은 곳', mid)
    await assertOk(grantAccess(fx.owner.ctx, deep, { type: 'user', id: other.userId }, 'view'))
    assert.equal(await scopeOf(deep), deep)

    // 위쪽에 새 경계가 생겨도 아래쪽 경계는 그대로다.
    await assertOk(grantAccess(fx.owner.ctx, mid, { type: 'user', id: other.userId }, 'view'))
    assert.equal(await scopeOf(mid), mid)
    assert.equal(await scopeOf(deep), deep, '아래쪽 스코프를 덮어썼다')
  })

  test('볼 수 있는 스코프 목록이 그만큼만 나온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const hidden = await newPage('목록에서 빠질 페이지')
    await restrictToOwner(hidden)

    const mine = await withReadTransaction((tx) => readableScopes(tx, fx.owner.ctx))
    const theirs = await withReadTransaction((tx) => readableScopes(tx, other.ctx))
    assert.ok(mine.includes(hidden))
    assert.equal(theirs.includes(hidden), false)
  })
})

describe('★ 쓰기 권한', () => {
  test('볼 수만 있는 사람은 저장할 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('읽기 전용')
    await assertOk(stopInheriting(fx.owner.ctx, page))
    await assertOk(grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access'))
    await assertOk(revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' }))
    await assertOk(grantAccess(fx.owner.ctx, page, { type: 'user', id: other.userId }, 'view'))

    const result = await savePageBody(other.ctx, page, {
      blocks: [{ id: crypto.randomUUID(), type: 'paragraph', title: [textRun('남의 글')], properties: {}, format: {}, children: [] }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.ok === false && result.reason === 'forbidden', JSON.stringify(result))
  })

  test('못 보는 사람에게는 not_found 다 — 존재를 알려주지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('숨은 페이지')
    await restrictToOwner(page)

    const result = await savePageBody(other.ctx, page, { blocks: [] })
    assert.ok(result.ok === false && result.reason === 'not_found', JSON.stringify(result))
  })

  test('권한을 관리할 수 없는 사람은 부여도 못 한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('관리 권한 없음')
    await assertOk(stopInheriting(fx.owner.ctx, page))
    await assertOk(grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access'))
    await assertOk(revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' }))
    await assertOk(grantAccess(fx.owner.ctx, page, { type: 'user', id: other.userId }, 'edit'))

    const result = await grantAccess(other.ctx, page, { type: 'user', id: other.userId }, 'full_access')
    assert.equal(result.ok, false)
    assert.ok(result.ok === false && result.reason === 'forbidden')
  })

  test('★ 마지막 관리자는 지울 수 없다 — 되돌릴 수 없는 상태를 만들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('마지막 관리자')
    await assertOk(stopInheriting(fx.owner.ctx, page))
    await assertOk(grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access'))
    await assertOk(revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' }))

    const result = await revokeAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId })
    assert.ok(result.ok === false && result.reason === 'would_orphan', JSON.stringify(result))
  })

  test('남의 페이지 밑에 하위 페이지를 만들 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('남의 페이지')
    await restrictToOwner(page)

    await assert.rejects(() => createPage(other.ctx, { title: titleFromPlainText('끼어들기'), parentPageId: page }))
  })
})

// ── 보조 ──────────────────────────────────────────────────────────────

async function assertOk(promise: Promise<{ ok: boolean; reason?: string }>): Promise<void> {
  const result = await promise
  assert.ok(result.ok, JSON.stringify(result))
}

/** 이 페이지를 소유자만 볼 수 있게 만든다. 상속을 끊고 모두 권한을 뗀다. */
async function restrictToOwner(pageId: BlockId): Promise<void> {
  await assertOk(stopInheriting(fx.owner.ctx, pageId))
  await assertOk(grantAccess(fx.owner.ctx, pageId, { type: 'user', id: fx.owner.userId }, 'full_access'))
  await assertOk(revokeAccess(fx.owner.ctx, pageId, { type: 'workspace_everyone' }))
}
