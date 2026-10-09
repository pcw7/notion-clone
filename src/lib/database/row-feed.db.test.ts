/**
 * 표가 바뀌었다는 신호 — 2k-1조각 (F-04-24, DB 필요)
 *
 *   ① 뷰에 보이는 것이 바뀌는 쓰기가 신호를 보낸다 — 행 만들기 · 칸 · 휴지통 · 속성 · 옵션 · 뷰
 *   ② 한 트랜잭션은 표마다 한 번이다(Postgres 가 같은 신호를 합친다) · 다른 표의 쓰기는 이 표의 신호가 아니다
 *   ③ 허브 — 그 표의 구독에게만 "바뀌었다" · 워크스페이스의 권한 신호는 그 워크스페이스의 구독에게 · 세션 신호는 그 사용자에게 · 끊으면 더 받지 않는다
 *
 * 반사실(HANDOFF §3.3): 행의 트리거가 없으면 ① 의 칸이, 허브가 표를 가리지 않으면 ③ 이 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { openChangeFeed, ROWS_CHANNEL, type ChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { textRun } from '../contracts/rich-text.ts'
import { withTransaction } from '../db/tx.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import type { MvpPropertyType } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { updateView } from './view.ts'
import { closeRowFeed, dispatchRowSignal, rowFeedListenerCount, subscribeRows, type RowFeedListener } from './row-feed.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let feed: ChangeFeed | null = null
const signals: string[] = []

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  feed = await openChangeFeed(
    {
      onSignal: (s: CollabSignal) => {
        if (s.kind === 'rows') signals.push(s.dataSourceId)
      },
      onResync: () => undefined,
    },
    { channels: [ROWS_CHANNEL] },
  )
})

after(async () => {
  await feed?.close()
  await closeRowFeed()
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 이 일을 하는 동안 이 표에 온 신호 수 — 신호가 다 올 때까지 조금 기다린다. */
async function signalsDuring(ds: string, work: () => Promise<unknown>): Promise<number> {
  await sleep(150)
  const from = signals.length
  await work()
  await sleep(300)
  return signals.slice(from).filter((id) => id === ds).length
}

async function table(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const prop = async (propName: string, type: MvpPropertyType) =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name: propName, type })).properties.find((p) => p.name === propName)!.id
  const row = async (title: string) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
  return { ds, viewId: created.defaultViewId, titleId, prop, row }
}

describe('① 신호를 보내는 쓰기', () => {
  test('★ 행 만들기 · 칸 · 휴지통 · 속성 · 옵션 · 뷰', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('신호')
    const qty = await t.prop('수량', 'number')
    const stage = await t.prop('단계', 'select')
    let r = ''
    assert.ok((await signalsDuring(t.ds, async () => (r = await t.row('가')))) >= 1, '행 만들기')
    assert.ok((await signalsDuring(t.ds, () => updateCells(fx.owner.ctx, r, { cells: [{ propertyId: qty, value: { type: 'number', number: 3 } }] }))) >= 1, '칸')
    assert.ok((await signalsDuring(t.ds, () => t.prop('메모', 'rich_text'))) >= 1, '속성')
    assert.ok((await signalsDuring(t.ds, () => addSelectOption(fx.owner.ctx, t.ds, stage, { name: '검토' }))) >= 1, '옵션')
    assert.ok((await signalsDuring(t.ds, () => updateView(fx.owner.ctx, t.viewId, { filter: { property_id: qty, operator: 'greater_than', value: 1 } }))) >= 1, '뷰')
    assert.ok((await signalsDuring(t.ds, () => trashRow(fx.owner.ctx, r))) >= 1, '휴지통')
  })
})

describe('② 한 번 · 섞이지 않는다', () => {
  test('★ 한 트랜잭션은 표마다 한 번 · 다른 표의 쓰기는 이 표의 신호가 아니다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('한 번')
    const other = await table('다른 표')
    const a = await t.row('가')
    const b = await t.row('나')
    // 한 트랜잭션에서 두 행의 칸을 고친다 — 행 읽기 모델 · 블록이 여러 번 바뀌어도 신호는 하나
    const once = await signalsDuring(t.ds, () =>
      withTransaction(async (tx) => {
        for (const id of [a, b]) {
          await tx.query(`UPDATE block SET properties = jsonb_build_object('title', 'x') WHERE id = $1`, [id])
          await tx.query(`UPDATE block SET order_key = order_key || 'z' WHERE id = $1`, [id])
        }
      }),
    )
    assert.equal(once, 1)
    assert.equal(await signalsDuring(t.ds, () => other.row('남의 행')), 0)
  })
})

describe('③ 허브', () => {
  const listener = (dataSourceId: string, workspaceId = 'w', userId = 'u') => {
    const seen: string[] = []
    const l: RowFeedListener = {
      dataSourceId,
      workspaceId,
      userId,
      onChanged: () => seen.push('changed'),
      onAccess: () => seen.push('access'),
      onSession: () => seen.push('session'),
    }
    return { l, seen }
  }

  test('나눠 주기 — 그 표 · 그 워크스페이스 · 그 사용자에게만(연결 없이)', () => {
    const mine = listener('ds-1', 'ws-1', 'user-1')
    const others = listener('ds-2', 'ws-2', 'user-2')
    const all = [mine.l, others.l]
    dispatchRowSignal({ kind: 'rows', dataSourceId: 'ds-1' }, all)
    dispatchRowSignal({ kind: 'access', workspaceId: 'ws-1' }, all)
    dispatchRowSignal({ kind: 'session', userId: 'user-1' }, all)
    dispatchRowSignal({ kind: 'doc', pageId: 'p', seq: '1' }, all)
    assert.deepEqual(mine.seen, ['changed', 'access', 'session'])
    assert.deepEqual(others.seen, [])
  })

  test('★ 실제 신호로 — 그 표를 보는 구독에게만 · 끊으면 더 받지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table('허브')
    const other = await table('허브 밖')
    const mine = listener(t.ds, fx.workspaceId, fx.owner.userId)
    const theirs = listener(other.ds, fx.workspaceId, fx.owner.userId)
    const before = rowFeedListenerCount()
    const offMine = await subscribeRows(mine.l)
    const offTheirs = await subscribeRows(theirs.l)
    assert.equal(rowFeedListenerCount(), before + 2)

    await t.row('가')
    for (let i = 0; i < 40 && !mine.seen.includes('changed'); i++) await sleep(50)
    assert.ok(mine.seen.includes('changed'), '그 표의 구독은 받는다')
    assert.ok(!theirs.seen.includes('changed'), '다른 표의 구독은 받지 않는다')

    offMine()
    offTheirs()
    assert.equal(rowFeedListenerCount(), before)
    const count = mine.seen.length
    await t.row('나')
    await sleep(400)
    assert.equal(mine.seen.length, count, '끊은 뒤에는 받지 않는다')
  })
})
