/**
 * 최근 방문 · 즐겨찾기 — W6-a (F-07-04 / F-07-16)
 *
 * 이 파일이 지키는 것 넷.
 *
 *   ① **권한은 조회 시점에 다시 건다.** 볼 수 없게 된 페이지는 목록에서 사라진다 —
 *      기록을 지우지 않아도.
 *   ② **제목을 복사해 두지 않는다.** 제목을 바꾸면 목록도 바뀐다.
 *   ③ 같은 페이지를 다시 봐도 **행이 늘지 않는다**(upsert).
 *   ④ 휴지통에 간 페이지는 목록에 남지 않는다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import {
  probeDatabase,
  makeFixture,
  createUser,
  joinAs,
  type Actor,
  type Fixture,
} from '../testing/db-fixtures.ts'
import { createPage, renamePage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import {
  addFavorite,
  isFavorite,
  listFavorites,
  listRecent,
  recordVisit,
  removeFavorite,
} from './recent.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'

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
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const newPage = async (title: string): Promise<BlockId> =>
  (await createPage(fx.owner.ctx, { title: titleFromPlainText(title) })).id

const visitRows = async (userId: string, pageId: string) =>
  withReadTransaction((tx) =>
    tx.query<{ visit_count: number }>(
      `SELECT visit_count FROM recent_visit WHERE user_id = $1 AND block_id = $2`,
      [userId, pageId],
    ),
  )

describe('최근 방문', () => {
  test('본 페이지가 맨 앞에 온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const first = await newPage('먼저 본 것')
    const second = await newPage('나중에 본 것')

    await recordVisit(fx.owner.ctx, first)
    await recordVisit(fx.owner.ctx, second)

    const recent = await listRecent(fx.owner.ctx)
    assert.equal(recent[0]?.id, second)
    assert.ok(recent.some((r) => r.id === first))
  })

  test('★ 같은 페이지를 다시 봐도 행이 늘지 않는다 — 목록이 한 페이지로 가득 차지 않게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('여러 번 볼 것')
    for (let i = 0; i < 5; i += 1) await recordVisit(fx.owner.ctx, page)

    const rows = await visitRows(fx.owner.userId, page)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].visit_count, 5)
  })

  test('★ 제목을 바꾸면 목록도 바뀐다 — 제목을 복사해 두지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('옛 제목')
    await recordVisit(fx.owner.ctx, page)
    await renamePage(fx.owner.ctx, page, titleFromPlainText('새 제목'))

    const recent = await listRecent(fx.owner.ctx)
    assert.equal(recent.find((r) => r.id === page)?.title, '새 제목')
  })

  test('★ 볼 수 없게 되면 목록에서 사라진다 — 기록을 지우지 않아도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('곧 못 볼 페이지')
    await recordVisit(other.ctx, page)
    assert.ok((await listRecent(other.ctx)).some((r) => r.id === page))

    // 소유자만 볼 수 있게 만든다.
    await stopInheriting(fx.owner.ctx, page)
    await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')
    await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })

    assert.equal(
      (await listRecent(other.ctx)).some((r) => r.id === page),
      false,
      '볼 수 없는 페이지의 제목이 최근 목록에 남았다',
    )
    // 기록 자체는 남아 있다 — 지우는 설계였다면 권한이 바뀔 때마다 모든 사용자의
    // 목록을 손봐야 하고, 한 번 놓치면 제목이 샌다.
    assert.equal((await visitRows(other.userId, page)).length, 1)
  })

  test('휴지통에 간 페이지는 목록에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('버릴 페이지')
    await recordVisit(fx.owner.ctx, page)
    await trashPage(fx.owner.ctx, page)

    assert.equal((await listRecent(fx.owner.ctx)).some((r) => r.id === page), false)
  })

  test('다른 사람의 방문은 내 목록에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('남이 본 페이지')
    await recordVisit(other.ctx, page)

    assert.equal((await listRecent(fx.owner.ctx)).some((r) => r.id === page), false)
  })

  test('limit 을 넘지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (let i = 0; i < 4; i += 1) await recordVisit(fx.owner.ctx, await newPage(`목록 ${i}`))
    assert.equal((await listRecent(fx.owner.ctx, 3)).length, 3)
  })
})

describe('즐겨찾기', () => {
  test('넣고 빼고 상태를 묻는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('별 붙일 페이지')
    assert.equal(await isFavorite(fx.owner.ctx, page), false)

    await addFavorite(fx.owner.ctx, page)
    assert.equal(await isFavorite(fx.owner.ctx, page), true)
    assert.ok((await listFavorites(fx.owner.ctx)).some((f) => f.id === page))

    await removeFavorite(fx.owner.ctx, page)
    assert.equal(await isFavorite(fx.owner.ctx, page), false)
  })

  test('두 번 넣어도 한 번만 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('두 번 누를 별')
    await addFavorite(fx.owner.ctx, page)
    await addFavorite(fx.owner.ctx, page)

    const listed = (await listFavorites(fx.owner.ctx)).filter((f) => f.id === page)
    assert.equal(listed.length, 1)
  })

  test('★ 새 항목은 맨 뒤에 붙는다 — 기존 목록이 밀려 내려가지 않게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const solo = await makeFixture() // 이 테스트만의 빈 목록
    const first = (await createPage(solo.owner.ctx, { title: titleFromPlainText('첫 번째') })).id
    const second = (await createPage(solo.owner.ctx, { title: titleFromPlainText('두 번째') })).id

    await addFavorite(solo.owner.ctx, first)
    await addFavorite(solo.owner.ctx, second)

    const order = (await listFavorites(solo.owner.ctx)).map((f) => f.id)
    assert.deepEqual(order, [first, second])
  })

  test('★ 볼 수 없게 되면 즐겨찾기에서도 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('별 붙였다 못 볼 페이지')
    await addFavorite(other.ctx, page)
    assert.ok((await listFavorites(other.ctx)).some((f) => f.id === page))

    await stopInheriting(fx.owner.ctx, page)
    await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')
    await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })

    assert.equal((await listFavorites(other.ctx)).some((f) => f.id === page), false)
  })

  test('휴지통에 간 페이지는 즐겨찾기에 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('별 붙였다 버릴 페이지')
    await addFavorite(fx.owner.ctx, page)
    await trashPage(fx.owner.ctx, page)

    assert.equal((await listFavorites(fx.owner.ctx)).some((f) => f.id === page), false)
  })
})
