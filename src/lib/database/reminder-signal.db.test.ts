/**
 * 리마인더의 걸기 · 풀기 · 울림을 표 변경 신호로 — §7 정리 10n-17 (F-11-10 · F-04-24)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑩ · 마이그레이션 0109
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 걸면 그 행의 표로 신호(`db_rows`)가 온다 · 다시 걸어도
 *   ② ★ 풀면 온다
 *   ③ ★ 울리면(`fired_at`) 온다 — 종이 빨갛게 바뀌는 것을 다른 화면도 안다
 *   ④ 행의 판(`version`)은 올리지 않는다 — 그 행의 다른 칸을 `expectedVersion` 으로 쓰던 사람이 충돌을 맞지 않는다
 *   ⑤ 본문 칩의 리마인더(속성 없음)는 표가 없다 — 트리거가 던지지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { openChangeFeed, ROWS_CHANNEL, type ChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { createDatabase } from './database.ts'
import { addProperty } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { clearDateReminder, setDateReminder } from './reminder.ts'

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

/** 이 일을 하는 동안 이 표에 온 신호 수 — 신호가 다 올 때까지 조금 기다린다(row-feed.db.test.ts 와 같다). */
async function signalsDuring(ds: string, work: () => Promise<unknown>): Promise<number> {
  await sleep(150)
  const from = signals.length
  await work()
  await sleep(300)
  return signals.slice(from).filter((id) => id === ds).length
}

async function table(name: string) {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const due = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
  const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
  unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: due, value: { type: 'date', date: { start: '2031-05-01' } } }] }))
  return { ds: db.dataSourceId, due, row }
}

const versionOf = async (row: string) => (await query<{ version: string }>(`SELECT version FROM block WHERE id = $1`, [row]))[0]!.version

describe('리마인더의 바뀜을 다른 화면에 알린다 (10n-17)', () => {
  test('★ ① 걸면 그 행의 표로 신호가 온다 · 다시 걸어도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 신호 걸기')
    assert.ok((await signalsDuring(tb.ds, () => setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' }))) >= 1, '걸기')
    assert.ok((await signalsDuring(tb.ds, () => setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 1440, timeZone: 'Asia/Seoul' }))) >= 1, '다시 걸기')
  })

  test('★ ② 풀면 온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 신호 풀기')
    unwrap(await setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' }))
    assert.ok((await signalsDuring(tb.ds, () => clearDateReminder(fx.owner.ctx, tb.row, tb.due))) >= 1)
  })

  test('★ ③ 울리면(fired_at) 온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 신호 울림')
    unwrap(await setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' }))
    assert.ok((await signalsDuring(tb.ds, () => query(`UPDATE reminder SET fired_at = now() WHERE page_id = $1`, [tb.row]))) >= 1)
  })

  test('④ 행의 판은 올리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 판')
    const before = await versionOf(tb.row)
    unwrap(await setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' }))
    unwrap(await clearDateReminder(fx.owner.ctx, tb.row, tb.due))
    assert.equal(await versionOf(tb.row), before)
  })

  test('⑤ 본문 칩의 리마인더(속성 없음)는 표가 없다 — 트리거가 던지지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('칩 리마인더 페이지') })).id
    const id = randomUUID()
    await query(
      `INSERT INTO reminder (id, workspace_id, block_id, page_id, property_id, target_at, timezone, lead_minutes, fire_at, recipient_ids, created_by)
       VALUES ($1, $2, $3, $3, NULL, now() + interval '1 day', 'Asia/Seoul', 0, now() + interval '1 day', ARRAY[$4::uuid], $4)`,
      [id, fx.workspaceId, page, fx.owner.userId],
    )
    await query(`DELETE FROM reminder WHERE id = $1`, [id])
  })
})
