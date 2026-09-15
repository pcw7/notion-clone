/**
 * 페이지 목록의 권한 — 하위 페이지 목록 · breadcrumb (F-02-03 · F-06-01)
 *
 * #75 를 만들며 발견한 누출: `listChildPages`(워크스페이스 홈 · 페이지 화면 · `GET /pages?parent=`)와 `listAncestors`
 * (breadcrumb)가 권한을 거르지 않아 볼 수 없는 페이지의 제목을 내줬다. F-02-03: *"접근 권한 없는 페이지 → 존재도 노출
 * 금지."* 사이드바 · 휴지통 · 최근 방문 · 검색 · 익스포트는 이미 `readableScopes` 로 거른다(HANDOFF §3.3-32).
 *
 * 이 파일이 지키는 것.
 *
 *   ① **하위 페이지 목록에는 볼 수 있는 페이지만** — 볼 수 있는 부모 밑의 비공개 하위 페이지도, 최상위의 비공개 페이지도 빠진다
 *   ② **볼 수 없는 부모의 하위 페이지 목록은 비어 있다** — 따로 공유받은 하위 페이지가 있어도. 없는 부모와 같은 답이다
 *   ③ **breadcrumb 에는 볼 수 있는 조상만** — 비공개 조상 밑에서 따로 공유받은 페이지의 조상 제목이 나오지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import type { BlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createPage, getPage, listAncestors, listChildPages, titleFromPlainText } from './page.ts'

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
  const workspaceId = await createBareWorkspace('목록 권한')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  return { owner, member }
}

const mk = async (actor: Actor, title: string, parent: string | null = null): Promise<BlockId> =>
  (await createPage(actor.ctx, { parentPageId: parent as BlockId | null, title: titleFromPlainText(title) })).id

/**
 * 페이지를 소유자만 볼 수 있게 한다. 하위 페이지는 부모에게서 받던 것을 먼저 복사해 끊고(P1) 지운다 — 공유 패널에서
 * '상속됨' 을 지우는 것과 같은 순서다.
 */
async function hide(owner: Actor, pageId: string, inherited: boolean): Promise<void> {
  if (inherited) assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

const share = async (owner: Actor, pageId: string, to: Actor) =>
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: to.userId }, 'edit')).ok, true)

// ── ① ② 하위 페이지 목록 ─────────────────────────────────────────────

describe('하위 페이지 목록', () => {
  test('★ 볼 수 있는 부모 밑의 비공개 하위 페이지와 최상위의 비공개 페이지는 목록에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const parent = await mk(owner, '열린 부모')
    const openChild = await mk(owner, '열린 하위', parent)
    const secretChild = await mk(owner, '비밀 하위', parent)
    await hide(owner, secretChild, true)
    const secretRoot = await mk(owner, '비밀 루트')
    await hide(owner, secretRoot, false)

    assert.deepEqual(
      (await listChildPages(owner.ctx, parent)).map((p) => p.id),
      [openChild, secretChild],
      '전제: 소유자에게는 둘 다 보인다',
    )
    const children = await listChildPages(member.ctx, parent)
    assert.deepEqual(children.map((p) => p.id), [openChild])

    const roots = await listChildPages(member.ctx, null)
    assert.ok(roots.some((p) => p.id === parent), '볼 수 있는 최상위 페이지가 빠졌다')
    assert.ok(!roots.some((p) => p.id === secretRoot), '비공개 최상위 페이지가 목록에 있다')
    assert.ok(!JSON.stringify([children, roots]).includes('비밀'), '볼 수 없는 페이지의 제목이 목록에 실렸다')
  })

  test('★ 볼 수 없는 부모의 하위 페이지 목록은 비어 있다 — 따로 공유받은 하위 페이지가 있어도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const secretRoot = await mk(owner, '비밀 루트')
    const shared = await mk(owner, '공유받은 하위', secretRoot)
    await hide(owner, secretRoot, false)
    await share(owner, shared, member)
    assert.ok((await getPage(member.ctx, shared)) !== null, '전제: 따로 공유받은 하위 페이지는 볼 수 있다')

    assert.deepEqual(await listChildPages(member.ctx, secretRoot), [])
  })
})

// ── ③ breadcrumb ────────────────────────────────────────────────────

describe('breadcrumb', () => {
  test('★ 볼 수 있는 조상만 나온다 — 비공개 조상 밑에서 따로 공유받은 페이지의 조상 제목이 나오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const secretRoot = await mk(owner, '비밀 루트')
    const middle = await mk(owner, '공유받은 중간', secretRoot)
    const leaf = await mk(owner, '잎', middle)
    await hide(owner, secretRoot, false)
    await share(owner, middle, member)

    const detail = await getPage(member.ctx, leaf)
    assert.ok(detail !== null, '전제: 공유받은 중간 밑의 페이지는 볼 수 있다')
    const chain = await listAncestors(member.ctx, detail)
    assert.deepEqual(chain.map((p) => p.plainTitle), ['공유받은 중간'])
    assert.ok(!JSON.stringify(chain).includes('비밀'), '볼 수 없는 조상의 제목이 breadcrumb 에 실렸다')
  })
})
