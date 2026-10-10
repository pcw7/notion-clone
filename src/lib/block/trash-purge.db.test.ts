/**
 * 휴지통 자동 비우기 — 히스토리 · 활동 4b-1 (DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 만료된 묶음 — 루트와 그 자손이 함께 `purged`(`purged_at` = 실행기의 시각) · 만료 전 · 살아 있는 것은 그대로 · 휴지통 목록에서
 *      빠진다 · 두 번 돌아도 같다
 *   ② 묶음 단위 — 따로 먼저 버린 자손은 제 루트의 시각에 따로 비워진다
 *   ③ data source 묶음 — 소스와 함께 들어간 행이 함께 `purged`
 *   ④ 되살리기와 겹치면 — 루트를 다른 쪽이 쥐고 있으면 그 묶음을 건너뛰고 기다리지 않는다 · 놓으면 다음 판에 비운다
 *   ⑤ 한 판의 상한
 *
 * 검사는 자기 워크스페이스만 비운다(`workspaces`) — 진짜 GC 는 다른 검사의 휴지통도 비운다.
 *
 * 반사실(HANDOFF §3.3): 묶음 단위로 묶지 않으면 ②, 루트를 잠그지 않으면 ④, 소스를 바꾸지 않으면 ③, 만료를 보지 않으면 ① 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { listTrash, trashPage } from './trash.ts'
import { runTrashPurge } from './trash-purge.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource, trashDataSource } from '../database/data-source.ts'
import { createRow } from '../database/row.ts'
import type { BlockId } from '../ids.ts'

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

const DAY = 86_400_000
/** 휴지통 기본 30일이 지난 시각. */
const later = () => new Date(Date.now() + 31 * DAY)
const purge = (now: Date, batch?: number) =>
  runTrashPurge(now, { workspaces: [fx.workspaceId], ...(batch === undefined ? {} : { batch }) })

const page = (title: string, parent: BlockId | null = null) =>
  createPage(fx.owner.ctx, { parentPageId: parent, title: titleFromPlainText(title) })

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

type State = { id: string; lifecycle: string; purged_at: Date | null }
const states = async (ids: readonly string[]) => {
  const rows = await query<State>(`SELECT id, lifecycle::text AS lifecycle, purged_at FROM block WHERE id = ANY($1::uuid[])`, [ids])
  return ids.map((id) => rows.find((r) => r.id === id)?.lifecycle)
}
/** 그 묶음의 휴지통 만료를 `days` 일 뒤로 — "아직 만료되지 않은 묶음". 검사마다 다른 날을 쓴다(다른 검사의 묶음과 섞이지 않게). */
const postpone = (root: string, days: number) =>
  query(`UPDATE block SET purge_after = now() + make_interval(days => $2) WHERE trash_root_id = $1 AND lifecycle = 'trashed'`, [
    root,
    days,
  ])
/** 이 워크스페이스의 다른 만료된 휴지통을 미리 비워 둔다 — 검사마다 결과의 수가 그 검사의 것만이 되게. */
const settle = async (now: Date) => {
  while ((await purge(now)).more) {
    // 한 판이 꽉 찼으면 다시
  }
}

describe('① 만료된 묶음', () => {
  test('★ 루트와 자손이 함께 purged — 만료 전 · 살아 있는 것은 그대로 · 휴지통 목록에서 빠진다 · 두 번 돌아도 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const root = await page('버린 묶음')
    const child = await page('자식', root.id)
    const grandchild = await page('손자', child.id)
    const fresh = await page('아직')
    const alive = await page('살아 있음')
    await trashPage(fx.owner.ctx, root.id)
    await trashPage(fx.owner.ctx, fresh.id)
    await postpone(fresh.id, 400)

    const result = await purge(now)
    assert.deepEqual(
      [result.units, result.skipped, result.pages, result.sources, result.more],
      [1, 0, 3, 0, false],
      '만료된 묶음 하나 — 루트 · 자식 · 손자',
    )
    assert.deepEqual(await states([root.id, child.id, grandchild.id]), ['purged', 'purged', 'purged'])
    assert.deepEqual(await states([fresh.id, alive.id]), ['trashed', 'live'], '만료 전 · 살아 있는 것은 그대로')
    const { purged_at } = await queryOne<{ purged_at: Date }>(`SELECT purged_at FROM block WHERE id = $1`, [root.id])
    assert.equal(purged_at.getTime(), now.getTime(), 'purged_at 은 실행기의 시각이다')

    const trash = await listTrash(fx.owner.ctx)
    assert.deepEqual(
      [trash.some((e) => e.id === root.id), trash.some((e) => e.id === fresh.id)],
      [false, true],
      '비운 묶음은 휴지통 목록에서 빠진다',
    )

    const again = await purge(now)
    assert.deepEqual([again.units, again.pages], [0, 0], '두 번 돌아도 같다')
  })
})

describe('② 묶음 단위', () => {
  test('★ 따로 먼저 버린 자손은 제 루트의 시각에 — 부모 묶음이 비워질 때 함께 가지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const parent = await page('부모')
    const early = await page('먼저 버린 자식', parent.id)
    const along = await page('함께 버린 자식', parent.id)
    await trashPage(fx.owner.ctx, early.id)
    await trashPage(fx.owner.ctx, parent.id)
    // 먼저 버린 자식의 묶음은 아직 — 부모 묶음만 만료
    await postpone(early.id, 200)

    const result = await purge(now)
    assert.deepEqual([result.units, result.pages], [1, 2], '부모 묶음 — 부모 · 함께 버린 자식')
    assert.deepEqual(await states([parent.id, along.id, early.id]), ['purged', 'purged', 'trashed'])

    // 그 자식의 시각이 오면 따로 비워진다
    const result2 = await purge(new Date(Date.now() + 201 * DAY))
    assert.deepEqual([result2.units, result2.pages], [1, 1])
    assert.deepEqual(await states([early.id]), ['purged'])
  })
})

describe('③ data source 묶음', () => {
  test('★ 소스와 함께 들어간 행이 함께 purged — 소스도 purged_at 을 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '비울 표' }))
    const second = unwrap(await addDataSource(fx.owner.ctx, db.id, { name: '둘째' })).dataSource.id
    const rowA = unwrap(await createRow(fx.owner.ctx, second)).id
    const rowB = unwrap(await createRow(fx.owner.ctx, second)).id
    unwrap(await trashDataSource(fx.owner.ctx, second))

    const result = await purge(now)
    assert.deepEqual([result.units, result.pages, result.sources], [1, 2, 1])
    const source = await queryOne<{ lifecycle: string; purged_at: Date | null }>(
      `SELECT lifecycle::text AS lifecycle, purged_at FROM data_source WHERE id = $1`,
      [second],
    )
    assert.deepEqual([source.lifecycle, source.purged_at?.getTime()], ['purged', now.getTime()])
    assert.deepEqual(await states([rowA, rowB]), ['purged', 'purged'])
    assert.equal((await listTrash(fx.owner.ctx)).some((e) => e.id === second), false, '휴지통 목록에서 빠진다')
  })
})

describe('④ 되살리기와 겹치면', () => {
  test('★ 루트를 다른 쪽이 쥐고 있으면 그 묶음을 건너뛰고 기다리지 않는다 — 놓으면 다음 판에 비운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const root = await page('되살리는 중')
    const child = await page('자식', root.id)
    await trashPage(fx.owner.ctx, root.id)

    // 되살리기가 루트를 잠근 채 머무는 모양 — 다른 연결에서
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let held: () => void = () => undefined
    const holding = new Promise<void>((resolve) => (held = resolve))
    const holder = withTransaction(async (tx) => {
      await tx.query(`SELECT id FROM block WHERE id = $1 FOR UPDATE`, [root.id])
      held()
      await gate
    })
    await holding

    const running = purge(now)
    try {
      const raced = await Promise.race([running, new Promise<'waited'>((r) => setTimeout(() => r('waited'), 3000))])
      assert.notEqual(raced, 'waited', '잠긴 루트를 기다렸다 — 워커가 사람의 명령에 묶인다')
      if (raced !== 'waited') assert.deepEqual([raced.units, raced.skipped, raced.pages], [0, 1, 0])
      assert.deepEqual(await states([root.id, child.id]), ['trashed', 'trashed'], '건너뛴 묶음은 그대로')
    } finally {
      release()
      await holder
      await running
    }

    const next = await purge(now)
    assert.deepEqual([next.units, next.pages], [1, 2], '놓으면 다음 판에 비운다')
    assert.deepEqual(await states([root.id, child.id]), ['purged', 'purged'])
  })
})

describe('⑤ 한 판의 상한', () => {
  test('꽉 차면 more — 다음 판이 나머지를 비운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    for (const title of ['하나', '둘', '셋']) await trashPage(fx.owner.ctx, (await page(title)).id)

    const first = await purge(now, 2)
    assert.deepEqual([first.units, first.more], [2, true])
    const second = await purge(now, 2)
    assert.deepEqual([second.units, second.more], [1, false])
  })
})
