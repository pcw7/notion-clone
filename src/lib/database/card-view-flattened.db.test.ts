/**
 * 카드 뷰의 표시 방식 — 카드 속성 · 평평한 목록 (24번 트랙 K-1 · F-04-22, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 P-1] ⑧
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 보드 — 카드 속성(기본)이면 부모만, 평평한 목록이면 하위 항목도 따로 카드로(카드 · 열의 개수 모두) · 필터는 들어온 모든 행에
 *   ② ★ 캘린더 — 달력 칸과 "날짜 없음"(수 · 목록)이 같은 조건으로 · 카드 속성이면 부모만, 평평한 목록이면 모든 행
 *   ③ 그룹이 걸린 표는 평평한 목록이어도 부모만(G-1 — 그 표의 평평한 목록은 그룹이 없을 때만)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { linkRows } from './relation.ts'
import { enableSubItems } from './sub-items.ts'
import { createView, updateView } from './view.ts'
import { queryGroups } from './group.ts'
import { queryCalendar, queryUndatedRows } from './calendar-query.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 가 ─ 가-1 끝 · 나 끝 ─ 나-1 · 다. 마감은 가 · 가-1 끝만 3월에, 나머지는 비었다. */
async function forest(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'select' }))
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '마감', type: 'date' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const due = schema.properties.find((p) => p.name === '마감')!.id
  const { parentPropertyId } = unwrap(await enableSubItems(fx.owner.ctx, ds))
  const row = async (title: string, date: string | null, parent?: string) => {
    const id = unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(date === null ? [] : [{ propertyId: due, value: { type: 'date' as const, date: { start: date } } }]),
        ],
      }),
    ).id
    if (parent !== undefined) unwrap(await linkRows(fx.owner.ctx, id, parentPropertyId, { add: [parent] }))
    return id
  }
  const ga = await row('가', '2026-03-10')
  await row('가-1 끝', '2026-03-12', ga)
  const na = await row('나 끝', null)
  await row('나-1', null, na)
  await row('다', null)
  const filter = { property_id: titleId, operator: 'contains', value: '끝' } as const
  return { databaseId: created.id, ds, titleId, filter }
}

describe('① 보드', () => {
  test('★ 카드 속성이면 부모만 · 평평한 목록이면 하위 항목도 따로 카드로 — 카드 · 개수 · 필터', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('카드 뷰 ① 보드')
    const board = unwrap(await createView(fx.owner.ctx, f.databaseId, { type: 'board' }))
    const cards = async () => {
      const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
      return { titles: page.groups.flatMap((g) => g.rows.map((r) => r.title)).sort(), count: page.groups.reduce((n, g) => n + g.count, 0) }
    }
    assert.deepEqual(await cards(), { titles: ['가', '나 끝', '다'], count: 3 }, '카드 속성(기본) — 부모만')
    unwrap(await updateView(fx.owner.ctx, board.id, { subItemDisplay: 'flattened' }))
    assert.deepEqual(await cards(), { titles: ['가', '가-1 끝', '나 끝', '나-1', '다'], count: 5 }, '평평한 목록 — 모든 행')
    unwrap(await updateView(fx.owner.ctx, board.id, { filter: f.filter }))
    assert.deepEqual(await cards(), { titles: ['가-1 끝', '나 끝'], count: 2 }, '필터는 들어온 모든 행에(범위를 보지 않는다)')
  })
})

describe('② 캘린더', () => {
  test('★ 달력 칸과 날짜 없음이 같은 조건 — 카드 속성이면 부모만 · 평평한 목록이면 모든 행', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('카드 뷰 ② 캘린더')
    const calendar = unwrap(await createView(fx.owner.ctx, f.databaseId, { type: 'calendar' }))
    const read = async () => {
      const month = unwrap(await queryCalendar(fx.owner.ctx, calendar.id, { from: '2026-03-01', to: '2026-03-31' }))
      const undated = unwrap(await queryUndatedRows(fx.owner.ctx, calendar.id))
      return { month: month.rows.map((r) => r.title).sort(), undated: month.undated, list: undated.rows.map((r) => r.title).sort() }
    }
    assert.deepEqual(await read(), { month: ['가'], undated: 2, list: ['나 끝', '다'] }, '카드 속성 — 부모만')
    unwrap(await updateView(fx.owner.ctx, calendar.id, { subItemDisplay: 'flattened' }))
    assert.deepEqual(await read(), { month: ['가', '가-1 끝'], undated: 3, list: ['나 끝', '나-1', '다'] }, '평평한 목록 — 모든 행')
  })
})

describe('③ 그룹이 걸린 표는 그대로', () => {
  test('평평한 목록이어도 그룹이 걸린 표는 부모만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('카드 뷰 ③ 그룹 표')
    const schema = unwrap(await getSchema(fx.owner.ctx, f.ds))
    const status = schema.properties.find((p) => p.name === '상태')!.id
    const table = unwrap(await createView(fx.owner.ctx, f.databaseId, { type: 'table' }))
    unwrap(await updateView(fx.owner.ctx, table.id, { groupBy: { property_id: status }, subItemDisplay: 'flattened' }))
    const page = unwrap(await queryGroups(fx.owner.ctx, table.id))
    assert.deepEqual(page.groups.flatMap((g) => g.rows.map((r) => r.title)).sort(), ['가', '나 끝', '다'])
  })
})
