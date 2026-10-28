/**
 * 보드의 하위 그룹(가로줄) — 서버 (그룹 버킷 트랙 B-4a · F-04-11, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] `view.group_by` 의 [보강 B-4]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 칸 = (열, 가로줄) — 가로줄마다 칸의 카운트 · 첫 페이지 · 열은 합계만(행은 칸이 싣는다) · 가로줄 순서는 옵션 순서 · 값 없음이 맨 앞
 *   ② ★ 칸마다 커서 — 그룹 행 읽기에 가로줄 키를 주면 그 칸만 이어 읽는다
 *   ③ ★ 옮기기는 두 축을 한 트랜잭션으로 — 다른 칸이면 두 값이 바뀐다 · 가로줄을 주지 않으면 지금 가로줄 · 칸 안의 자리 키는 열 + chr(31) + 가로줄
 *   ④ 하위 그룹은 보드에서만 · 그룹 기준과 다른 속성 · 계산은 버린다 · null 은 없앤다 · 다른 뷰로 바꾸면 읽지 않는다 · 숨김 · 빈 줄 숨기기
 *
 * ⚠ skip 은 테스트마다 `t.skip` 으로 건다(HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { moveRow, queryGroupRows, queryGroups, type GroupsPage } from './group.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 상태(할 일 · 끝) · 담당(가 · 나)이 있는 표와 보드(상태로 묶고 담당으로 가로줄). `rows` 는 [제목, 상태, 담당]. */
async function board(rows: readonly (readonly [string, '할 일' | '끝', '가' | '나' | null])[]) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `하위 그룹 ${Date.now()}` }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'select' }))
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '담당', type: 'select' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const status = schema.properties.find((p) => p.name === '상태')!.id
  const owner = schema.properties.find((p) => p.name === '담당')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const opt = async (prop: string, name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, prop, { name })).option.id
  const s = { '할 일': await opt(status, '할 일'), 끝: await opt(status, '끝') }
  const o = { 가: await opt(owner, '가'), 나: await opt(owner, '나') }
  const ids: Record<string, string> = {}
  for (const [title, st, ow] of rows) {
    ids[title] = unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          { propertyId: status, value: { type: 'select', select: { id: s[st] } } },
          ...(ow === null ? [] : [{ propertyId: owner, value: { type: 'select' as const, select: { id: o[ow] } } }]),
        ],
      }),
    ).id
  }
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'board', groupBy: { property_id: status } }))
  unwrap(await updateView(fx.owner.ctx, view.id, { subGroupBy: { property_id: owner } }))
  return { databaseId: created.id, viewId: view.id, status, owner, s, o, ids }
}

/** 가로줄 → 열 → [개수, 제목들]. */
const lanesOf = (page: GroupsPage) =>
  (page.sub?.groups ?? []).map((l) => [l.key, l.count, Object.entries(l.cells).map(([k, c]) => [k, c.count, c.rows.map((r) => r.title).join('')])])

describe('① 칸 = (열, 가로줄)', () => {
  test('★ 가로줄마다 칸의 카운트 · 첫 페이지 · 열은 합계만 · 가로줄은 옵션 순서 · 값 없음이 맨 앞', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await board([
      ['A', '할 일', '가'],
      ['B', '할 일', '나'],
      ['C', '끝', '가'],
      ['D', '할 일', null],
      ['E', '할 일', '가'],
    ])
    const page = unwrap(await queryGroups(fx.owner.ctx, b.viewId))
    assert.equal(page.sub?.propertyId, b.owner)
    assert.deepEqual(page.groups.map((g) => [g.key, g.count, g.rows.length]), [['', 0, 0], [b.s['할 일'], 4, 0], [b.s.끝, 1, 0]], '열은 합계만 — 행은 칸이 싣는다')
    assert.deepEqual(lanesOf(page), [
      ['', 1, [['', 0, ''], [b.s['할 일'], 1, 'D'], [b.s.끝, 0, '']]],
      [b.o.가, 3, [['', 0, ''], [b.s['할 일'], 2, 'AE'], [b.s.끝, 1, 'C']]],
      [b.o.나, 1, [['', 0, ''], [b.s['할 일'], 1, 'B'], [b.s.끝, 0, '']]],
    ])
  })
})

describe('② 칸마다 커서', () => {
  test('★ 가로줄 키를 주면 그 칸만 이어 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await board([
      ['A', '할 일', '가'],
      ['B', '할 일', '가'],
      ['C', '할 일', '가'],
      ['D', '할 일', '나'],
    ])
    unwrap(await updateView(fx.owner.ctx, b.viewId, { loadLimit: 10 }))
    const first = unwrap(await queryGroupRows(fx.owner.ctx, b.viewId, b.s['할 일'], { subKey: b.o.가, limit: 2 }))
    assert.deepEqual([first.rows.map((r) => r.title), first.hasMore], [['A', 'B'], true])
    const next = unwrap(await queryGroupRows(fx.owner.ctx, b.viewId, b.s['할 일'], { subKey: b.o.가, limit: 2, cursor: first.nextCursor }))
    assert.deepEqual([next.rows.map((r) => r.title), next.hasMore], [['C'], false], '나의 D 는 섞이지 않는다')
    const bad = await queryGroupRows(fx.owner.ctx, b.viewId, b.s['할 일'], { subKey: 'nope' })
    assert.equal(bad.ok === false && bad.reason, 'invalid_value')
  })
})

describe('③ 옮기기', () => {
  test('★ 다른 칸이면 두 값이 바뀐다 · 가로줄을 주지 않으면 지금 가로줄 · 자리 키는 열 + chr(31) + 가로줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await board([
      ['A', '할 일', '가'],
      ['B', '끝', '나'],
      ['C', '끝', '나'],
    ])
    const valueOf = (r: { properties: Record<string, unknown> }, prop: string) => (r.properties[prop] as { select: { id: string } | null }).select?.id ?? null

    // A 를 (끝, 나) 칸의 C 앞으로 — 두 값이 바뀐다
    const a = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: b.ids['A']!, groupKey: b.s.끝, subGroupKey: b.o.나, beforeRowId: b.ids['C']! }))
    assert.deepEqual([valueOf(a.row, b.status), valueOf(a.row, b.owner), a.subGroupKey], [b.s.끝, b.o.나, b.o.나])
    const page = unwrap(await queryGroups(fx.owner.ctx, b.viewId))
    const cell = page.sub!.groups.find((l) => l.key === b.o.나)!.cells[b.s.끝]!
    assert.deepEqual(cell.rows.map((r) => r.title), ['B', 'A', 'C'], 'C 앞에')

    // 가로줄을 주지 않으면 지금 가로줄(나)에 남는다 — 열만 바뀐다
    const back = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: b.ids['A']!, groupKey: b.s['할 일'] }))
    assert.deepEqual([valueOf(back.row, b.status), valueOf(back.row, b.owner)], [b.s['할 일'], b.o.나])

    const positions = await withReadTransaction((tx) =>
      tx.query<{ group_key: string }>(`SELECT group_key FROM row_position WHERE view_id = $1 AND row_id = $2`, [b.viewId, b.ids['A']!]),
    )
    assert.deepEqual(positions.map((p) => p.group_key), [`${b.s['할 일']}\u001f${b.o.나}`], '자리 키는 열 + chr(31) + 가로줄')

    // 가로줄의 값 없음(빈 칸)으로 — 담당이 비워진다
    const cleared = unwrap(await moveRow(fx.owner.ctx, b.viewId, { rowId: b.ids['B']!, groupKey: b.s.끝, subGroupKey: '' }))
    assert.equal(valueOf(cleared.row, b.owner), null)
    // 틀린 가로줄 키 · 칸 밖의 before
    const bad = await Promise.all([
      moveRow(fx.owner.ctx, b.viewId, { rowId: b.ids['C']!, groupKey: b.s.끝, subGroupKey: 'nope' }),
      moveRow(fx.owner.ctx, b.viewId, { rowId: b.ids['C']!, groupKey: b.s.끝, subGroupKey: b.o.가, beforeRowId: b.ids['B']! }),
    ])
    assert.deepEqual(bad.map((r) => (r.ok ? 'ok' : r.reason)), ['invalid_value', 'not_found'])
  })
})

describe('④ 하위 그룹의 규칙', () => {
  test('보드에서만 · 그룹 기준과 다른 속성 · 계산은 버린다 · null 은 없앤다 · 다른 뷰로 바꾸면 읽지 않는다 · 숨김 · 빈 줄 숨기기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await board([['A', '할 일', '가']])
    const view = unwrap(await getView(fx.owner.ctx, b.viewId))
    assert.deepEqual(view.subGroupBy, { property_id: b.owner })

    const same = await updateView(fx.owner.ctx, b.viewId, { subGroupBy: { property_id: b.status } })
    assert.equal(same.ok, false, '그룹 기준과 같은 속성')
    const withCalc = unwrap(
      await updateView(fx.owner.ctx, b.viewId, { subGroupBy: { property_id: b.owner, hide_empty: true, calculation: { property_id: b.owner, function: 'count_all' } } }),
    )
    assert.deepEqual(withCalc.subGroupBy, { property_id: b.owner, hide_empty: true }, '계산은 버린다')
    // 빈 줄 숨기기 — 행이 없는 가로줄(나 · 값 없음)은 빠진다
    assert.deepEqual(unwrap(await queryGroups(fx.owner.ctx, b.viewId)).sub!.groups.map((l) => l.key), [b.o.가])
    // 숨김
    unwrap(await updateView(fx.owner.ctx, b.viewId, { subGroupBy: { property_id: b.owner, hidden: [b.o.가] } }))
    assert.deepEqual(unwrap(await queryGroups(fx.owner.ctx, b.viewId)).sub!.groups.map((l) => [l.key, l.hidden]), [['', false], [b.o.가, true], [b.o.나, false]])

    // 다른 뷰로 바꾸면 읽지 않는다(저장값은 남는다) — 되돌리면 돌아온다
    const asTable = unwrap(await updateView(fx.owner.ctx, b.viewId, { type: 'table' }))
    assert.equal(asTable.subGroupBy, null)
    const backBoard = unwrap(await updateView(fx.owner.ctx, b.viewId, { type: 'board' }))
    assert.equal(backBoard.subGroupBy?.property_id, b.owner)
    // 표 뷰에는 줄 수 없다
    const table = unwrap(await createView(fx.owner.ctx, b.databaseId, { type: 'table' }))
    assert.equal((await updateView(fx.owner.ctx, table.id, { subGroupBy: { property_id: b.owner } })).ok, false, '보드에서만')
    // null 은 없앤다 — 열만의 보드로
    const none = unwrap(await updateView(fx.owner.ctx, b.viewId, { subGroupBy: null }))
    assert.equal(none.subGroupBy, null)
    assert.equal(unwrap(await queryGroups(fx.owner.ctx, b.viewId)).sub, null)
  })
})
