/**
 * 위 칸(`Ctrl/Cmd + Shift + U`) — 권한으로 거른 경로의 바로 위 칸 (NV-1 · F-07-12 · 정본 §3.9 [보강 NV-0] ④)
 *
 * 페이지 화면(`page-content-base.tsx`)이 부르는 것을 그대로 잇는다 — `getPage` → `listAncestors`(볼 수 있는 조상만) → `breadcrumbTrail` →
 * `upHrefOf`. 단축키에는 새 권한 판정이 없으므로 **줄이 거르지 않으면 단축키가 볼 수 없는 부모의 주소(곧 그 존재)를 알린다** — 이 파일이
 * 그것을 지킨다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, getPage, listAncestors, titleFromPlainText } from '../block/page.ts'
import { breadcrumbTrail } from '../block/breadcrumb.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { upHrefOf } from './nav-keys.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('위 칸의 동료'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const newPage = async (title: string, parentPageId?: BlockId): Promise<BlockId> =>
  (await createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...(parentPageId === undefined ? {} : { parentPageId }) })).id

/** 그 사람의 화면이 그 페이지에서 고르는 위 칸 — 페이지 화면과 같은 길(teamspace 없는 워크스페이스 페이지). */
async function upFor(ctx: SessionContext, pageId: BlockId): Promise<string | null> {
  const page = await getPage(ctx, pageId)
  assert.ok(page, '그 사람이 볼 수 있는 페이지여야 한다')
  const ancestors = await listAncestors(ctx, page)
  return upHrefOf(breadcrumbTrail({ workspaceId: fx.workspaceId, teamspace: null, ancestors, page }))
}

describe('위 칸 — 경로의 바로 위 칸', () => {
  test('볼 수 있는 부모면 부모로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('위 칸 부모')
    const child = await newPage('위 칸 자식', parent)
    assert.equal(await upFor(other.ctx, child), `/w/${fx.workspaceId}/${parent}`)
  })

  test('루트 페이지면 워크스페이스 홈으로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await newPage('위 칸 루트')
    assert.equal(await upFor(other.ctx, root), `/w/${fx.workspaceId}`)
  })

  test('★ 부모를 볼 수 없게 되면 부모를 건너뛴다 — 볼 수 있는 조상으로(그 부모의 주소가 나오지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const grand = await newPage('위 칸 조부모')
    const parent = await newPage('위 칸 비공개 부모', grand)
    const child = await newPage('위 칸 따로 공유받은 자식', parent)
    // 처음에는 동료도 부모를 본다
    assert.equal(await upFor(other.ctx, child), `/w/${fx.workspaceId}/${parent}`)

    // 부모를 소유자만 보게 하고, 자식만 동료에게 따로 준다(비공개 조상 밑에서 따로 공유받은 페이지)
    await stopInheriting(fx.owner.ctx, parent)
    await grantAccess(fx.owner.ctx, parent, { type: 'user', id: fx.owner.userId }, 'full_access')
    await revokeAccess(fx.owner.ctx, parent, { type: 'workspace_everyone' })
    assert.equal((await grantAccess(fx.owner.ctx, child, { type: 'user', id: other.userId }, 'view')).ok, true)
    assert.equal(await getPage(other.ctx, parent), null, '준비 — 동료는 부모를 볼 수 없어야 한다')

    const up = await upFor(other.ctx, child)
    assert.equal(up, `/w/${fx.workspaceId}/${grand}`, '볼 수 없는 부모를 건너뛰어 볼 수 있는 조상으로 가야 한다')
    assert.equal(up?.includes(parent), false, '볼 수 없는 부모의 주소가 단축키로 샜다')
    // 부모를 보는 사람에게는 그대로 부모다
    assert.equal(await upFor(fx.owner.ctx, child), `/w/${fx.workspaceId}/${parent}`)
  })

  test('★ 볼 수 있는 조상이 하나도 없으면 홈으로 — 루트까지 볼 수 없는 따로 공유받은 페이지', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await newPage('위 칸 비공개 맨 위')
    const child = await newPage('위 칸 외딴 자식', top)
    await stopInheriting(fx.owner.ctx, top)
    await grantAccess(fx.owner.ctx, top, { type: 'user', id: fx.owner.userId }, 'full_access')
    await revokeAccess(fx.owner.ctx, top, { type: 'workspace_everyone' })
    assert.equal((await grantAccess(fx.owner.ctx, child, { type: 'user', id: other.userId }, 'view')).ok, true)

    assert.equal(await upFor(other.ctx, child), `/w/${fx.workspaceId}`)
  })
})
