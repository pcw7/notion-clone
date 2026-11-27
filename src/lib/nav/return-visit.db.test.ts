/**
 * 되돌아간 열기의 방문 기록 — NV-2 (F-07-04 · F-07-12 · 정본 §3.9 [보강 NV-0] ⑨ [NV-2])
 *
 * 뒤로 · 앞으로가 받아 둔 렌더를 다시 그리면 화면이 방문 라우트를 부른다. 여기서 지키는 것:
 *
 *   ① 볼 수 있으면 서버 렌더와 **같은 기록**이다 — 맨 앞으로 오고 · 행은 하나(upsert).
 *   ② 볼 수 없거나 · 휴지통이거나 · 없거나 · 다른 워크스페이스면 **아무것도 쓰지 않고** 같은 답(false)이다 — 흔적이 존재를 알리지 않게.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { listRecent, recordVisit } from './recent.ts'
import { recordVisitIfViewable } from './return-visit.ts'
import { withReadTransaction } from '../db/tx.ts'
import { asBlockId, type BlockId } from '../ids.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor
let elsewhere: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('되돌아간 멤버'), 'member')
  elsewhere = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const newPage = async (title: string, owner: Fixture = fx): Promise<BlockId> =>
  (await createPage(owner.owner.ctx, { title: titleFromPlainText(title) })).id

const visits = async (userId: string, pageId: string) =>
  withReadTransaction((tx) =>
    tx.query<{ visit_count: number }>(`SELECT visit_count FROM recent_visit WHERE user_id = $1 AND block_id = $2`, [userId, pageId]),
  )

describe('되돌아간 열기의 방문 기록', () => {
  test('★ 볼 수 있으면 남긴다 — 뒤로 간 페이지가 최근의 맨 앞 · 서버 렌더의 기록과 같은 행(upsert)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const a = await newPage('먼저 연 A')
    const b = await newPage('나중에 연 B')
    // A → B 를 서버 렌더로 열었다
    await recordVisit(other.ctx, a)
    await recordVisit(other.ctx, b)
    assert.equal((await listRecent(other.ctx))[0]?.id, b)

    // 뒤로 — 받아 둔 A 를 다시 그렸다
    assert.equal(await recordVisitIfViewable(other.ctx, a), true)
    assert.equal((await listRecent(other.ctx))[0]?.id, a)
    const rows = await visits(other.userId, a)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.visit_count, 2)
  })

  test('★ 볼 수 없게 된 페이지는 남기지 않는다 — 기록이 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('곧 잃을 페이지')
    await recordVisit(other.ctx, page)
    // 소유자만 볼 수 있게 만든다
    await stopInheriting(fx.owner.ctx, page)
    await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')
    await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })

    assert.equal(await recordVisitIfViewable(other.ctx, page), false)
    assert.equal((await visits(other.userId, page))[0]?.visit_count, 1, '볼 수 없는 페이지의 방문이 늘었다')
  })

  test('★ 처음부터 볼 수 없던 페이지는 행이 생기지 않는다 — 흔적이 존재를 알리지 않게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('처음부터 못 보는 페이지')
    await stopInheriting(fx.owner.ctx, page)
    await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')
    await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })

    assert.equal(await recordVisitIfViewable(other.ctx, page), false)
    assert.equal((await visits(other.userId, page)).length, 0)
  })

  test('휴지통 · 없는 id · 다른 워크스페이스의 페이지 — 모두 같은 답(false)이고 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const trashed = await newPage('버린 페이지')
    await trashPage(fx.owner.ctx, trashed)
    const missing = asBlockId(randomUUID())
    const foreign = await newPage('남의 워크스페이스', elsewhere)

    for (const id of [trashed, missing, foreign]) {
      assert.equal(await recordVisitIfViewable(fx.owner.ctx, id), false, id)
      assert.equal((await visits(fx.owner.userId, id)).length, 0, id)
    }
  })
})
