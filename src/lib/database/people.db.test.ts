/**
 * 사람 속성 — 게시 · 공유 6g-1조각 (F-03-07 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강] 사람 속성).
 *
 *   ① ★ 칸에는 이 워크스페이스의 활동 중인 사람(멤버 · 게스트)만 — 다른 워크스페이스의 사람 · 떠난 사람 · 없는 id 는 invalid_value 이고
 *      아무것도 쓰지 않는다 · 행 만들기도 같다
 *   ② ★ 필터 — 포함 · 포함하지 않음(칸이 없는 행도) · 비어 있음 · 비어 있지 않음
 *   ③ 정렬 키로는 거부 · 열 집계는 세기
 *   ④ 떠난 사람은 값에 남고 이름 지도에서 빠진다("떠난 사용자")
 *   ⑤ 내보내기 — 사람 열은 이름 지도를 싣고 CSV 는 이름이다
 *   ⑥ 고르개 후보(6g-2) — 활동 중인 사람만 · 이름 · 메일로 · **게스트에게는 없다**(7d-2) · 이름 지도는 id 를 주면 활동 중인 사람만
 *   ⑦ ★ "나"(6g-2c · ⑪) — 같은 뷰가 보는 사람마다 다른 행이다: 표 · 보드의 개수 · 캘린더 · 열 집계 · 저장 검증 · 공개 표는 아무도
 *      아니다(포함은 0행 · 포함하지 않음은 모든 행)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { computeCalculations } from './calculate.ts'
import { queryCalendar } from './calendar-query.ts'
import { queryGroups } from './group.ts'
import { resolvePublicPageIn } from '../publish/public-access.ts'
import { readPublicTableIn } from '../publish/public-database.ts'
import { publishPage } from '../publish/public-link.ts'
import { createDatabase } from './database.ts'
import { loadPeopleNames, peopleNamesIn, searchPeople } from './people.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import type { CellValue } from './property-types.ts'
import { queryRows } from './query.ts'
import { createRow, updateCells } from './row.ts'
import { createView, updateView } from './view.ts'
import { cellPlainText } from '../export/csv.ts'
import { readExportSnapshot, type ExportDatabaseNode } from '../export/snapshot.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const people = (...ids: string[]): CellValue => ({ type: 'people', people: ids.map((id) => ({ id })) })

/** 담당(사람) 속성이 있는 표 · 멤버 · 게스트 · 다른 워크스페이스의 사람. */
async function team() {
  const ws = await createBareWorkspace('사람 칸')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const guest = await joinAs(ws, await createUser('손님'), 'guest')
  const elsewhere = await createUser('남의 사람')
  await joinAs(await createBareWorkspace('다른 곳'), elsewhere, 'member')
  const db = unwrap(await createDatabase(boss.ctx, { name: '할 일' }))
  unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '담당', type: 'people' }))
  const schema = unwrap(await getSchema(boss.ctx, db.dataSourceId))
  const owner = schema.properties.find((p) => p.name === '담당')!.id
  return { ws, boss, mate, guest, elsewhere, db, owner }
}

describe('① ★ 이 워크스페이스의 사람만', () => {
  test('멤버 · 게스트는 들어간다 · 다른 워크스페이스의 사람 · 떠난 사람 · 없는 id 는 invalid_value 이고 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, guest, elsewhere, db, owner } = await team()
    const row = unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(mate.userId, guest.userId) }] }))
    assert.deepEqual(row.properties[owner], people(mate.userId, guest.userId))

    const bad = await updateCells(boss.ctx, row.id, { cells: [{ propertyId: owner, value: people(mate.userId, elsewhere.userId) }] })
    assert.equal(bad.ok, false)
    assert.ok(!bad.ok && bad.reason === 'invalid_value' && JSON.stringify(bad).includes('이 워크스페이스의 사람이 아닙니다'), JSON.stringify(bad))
    const ghost = await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(crypto.randomUUID()) }] })
    assert.equal(ghost.ok, false, '행 만들기도 같다')

    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      boss.ctx.workspaceId,
      guest.userId,
    ])
    const left = await updateCells(boss.ctx, row.id, { cells: [{ propertyId: owner, value: people(guest.userId) }] })
    assert.equal(left.ok, false, '떠난 사람은 새로 넣지 못한다')
    const stored = await query<{ value: unknown }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [row.id, owner])
    assert.deepEqual(stored[0]?.value, people(mate.userId, guest.userId), '거부는 아무것도 쓰지 않는다 · 떠난 사람도 값에는 남는다(④)')
    const names = await withReadTransaction((tx) => peopleNamesIn(tx, boss.ctx.workspaceId, [mate.userId, guest.userId]))
    assert.deepEqual([...names.keys()], [mate.userId], '떠난 사람은 이름 지도에 없다 — 화면은 "떠난 사용자"')
  })
})

describe('② ★ 필터', () => {
  test('포함 · 포함하지 않음(칸이 없는 행도) · 비어 있음 · 비어 있지 않음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, guest, db, owner } = await team()
    const both = unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(mate.userId, guest.userId) }] })).id
    const onlyGuest = unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(guest.userId) }] })).id
    const cleared = unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people() }] })).id
    const blank = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
    const ids = async (filter: unknown) => {
      const r = await queryRows(boss.ctx, db.dataSourceId, { filter: filter as never })
      return r.ok ? new Set(r.value.rows.map((row) => row.id)) : r.reason
    }
    assert.deepEqual(await ids({ property_id: owner, operator: 'contains', value: mate.userId }), new Set([both]))
    assert.deepEqual(await ids({ property_id: owner, operator: 'does_not_contain', value: mate.userId }), new Set([onlyGuest, cleared, blank]))
    assert.deepEqual(await ids({ property_id: owner, operator: 'is_empty' }), new Set([cleared, blank]))
    assert.deepEqual(await ids({ property_id: owner, operator: 'is_not_empty' }), new Set([both, onlyGuest]))
  })
})

describe('③ 정렬 · 집계', () => {
  test('정렬 키로는 거부 · 열 집계는 세기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await team()
    unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(mate.userId) }] }))
    unwrap(await createRow(boss.ctx, db.dataSourceId))
    const sorted = await updateView(boss.ctx, db.defaultViewId, { sorts: [{ property_id: owner, direction: 'asc' }] })
    assert.equal(sorted.ok, false, '사람으로는 정렬하지 않는다')
    const calc = await computeCalculations(boss.ctx, db.dataSourceId, null, [
      { propertyId: owner, type: 'people', calculation: 'count_empty' },
    ])
    assert.deepEqual(calc[owner], { kind: 'count', value: 1 })
  })
})

describe('⑤ 내보내기', () => {
  test('사람 열은 이름 지도를 싣고 CSV 는 이름이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await team()
    const row = unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: owner, value: people(mate.userId) }] }))
    const snapshot = await readExportSnapshot(boss.ctx, { kind: 'workspace' })
    assert.ok(snapshot.ok, JSON.stringify(snapshot))
    const column = (snapshot.value.nodes.get(db.id) as ExportDatabaseNode).sources[0]!.columns.find((c) => c.propertyId === owner)
    assert.ok(column !== undefined && column.type === 'people')
    assert.equal(cellPlainText(column, row.properties[owner]), '동료')
  })
})

describe('⑥ 고르개 후보 · 이름(6g-2)', () => {
  test('★ 활동 중인 사람만 · 이름으로 좁힌다 · 게스트에게는 후보가 없다 · 이름 지도는 활동 중인 사람만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, guest } = await team()
    const all = await searchPeople(boss.ctx, '')
    assert.ok(all.some((p) => p.id === mate.userId && !p.guest) && all.some((p) => p.id === guest.userId && p.guest))
    assert.deepEqual((await searchPeople(boss.ctx, '동료')).map((p) => p.id), [mate.userId])
    assert.deepEqual(await searchPeople(guest.ctx, ''), [], '게스트는 멤버 목록을 받지 않는다(7d-2)')

    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      boss.ctx.workspaceId,
      mate.userId,
    ])
    assert.equal((await searchPeople(boss.ctx, '')).some((p) => p.id === mate.userId), false, '떠난 사람은 후보가 아니다')
    assert.deepEqual(await loadPeopleNames(boss.ctx, [mate.userId, guest.userId, 'not-a-uuid']), { [guest.userId]: '손님' })
  })
})


// ── ⑦ "나" ───────────────────────────────────────────────────────────

describe('⑦ ★ "나"(6g-2c)', () => {
  test('같은 뷰가 보는 사람마다 다른 행 — 표 · 보드 · 캘린더 · 집계 · 공개 표는 아무도 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, mate, db, owner } = await team()
    const ds = db.dataSourceId
    unwrap(await addProperty(boss.ctx, ds, { name: '상태', type: 'select' }))
    unwrap(await addProperty(boss.ctx, ds, { name: '마감', type: 'date' }))
    const schema = unwrap(await getSchema(boss.ctx, ds))
    const status = schema.properties.find((p) => p.name === '상태')!.id
    const due = schema.properties.find((p) => p.name === '마감')!.id
    const todo = unwrap(await addSelectOption(boss.ctx, ds, status, { name: '할 일' })).option.id
    const row = async (who: string) =>
      unwrap(
        await createRow(boss.ctx, ds, {
          cells: [
            { propertyId: owner, value: people(who) },
            { propertyId: status, value: { type: 'select', select: { id: todo } } },
            { propertyId: due, value: { type: 'date', date: { start: '2026-03-10' } } },
          ],
        }),
      ).id
    const bossRows = [await row(boss.userId), await row(boss.userId)]
    const mateRow = await row(mate.userId)
    const me = { property_id: owner, operator: 'contains', value: { $context: 'me' } }

    // 저장 검증이 받는다 — 표 · 보드 · 캘린더의 공유 필터로
    unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: me as never }))
    const board = unwrap(await createView(boss.ctx, db.id, { type: 'board' }))
    const calendar = unwrap(await createView(boss.ctx, db.id, { type: 'calendar' }))
    for (const view of [board.id, calendar.id]) unwrap(await updateView(boss.ctx, view, { filter: me as never }))
    assert.equal((await updateView(boss.ctx, db.defaultViewId, { filter: { ...me, value: 'me' } as never })).ok, false, '"me" 글자는 받지 않는다')

    const rowsOf = async (who: typeof boss) => {
      const r = await queryRows(who.ctx, ds, { filter: me as never })
      return r.ok ? r.value.rows.map((x) => x.id).sort() : r.reason
    }
    assert.deepEqual(await rowsOf(boss), [...bossRows].sort())
    assert.deepEqual(await rowsOf(mate), [mateRow], '★ 같은 필터 — 동료에게는 동료의 행')

    const countOf = async (who: typeof boss) => {
      const r = await queryGroups(who.ctx, board.id)
      return r.ok ? (r.value.groups.find((g) => g.key === todo)?.count ?? 0) : r.reason
    }
    assert.deepEqual([await countOf(boss), await countOf(mate)], [2, 1], '보드의 개수')
    const calendarOf = async (who: typeof boss) => {
      const r = await queryCalendar(who.ctx, calendar.id, { from: '2026-03-01', to: '2026-03-31' })
      return r.ok ? r.value.rows.map((x) => x.id) : r.reason
    }
    assert.deepEqual(await calendarOf(mate), [mateRow], '캘린더')
    const total = async (who: typeof boss) =>
      (await computeCalculations(who.ctx, ds, me as never, [{ propertyId: owner, type: 'people', calculation: 'count_all' }]))[owner]
    assert.deepEqual([await total(boss), await total(mate)], [{ kind: 'count', value: 2 }, { kind: 'count', value: 1 }], '열 집계')

    // 공개 표 — 보는 사람이 없다
    const token = unwrap(await publishPage(boss.ctx, db.id)).token!
    const publicRows = async () =>
      withReadTransaction(async (tx) => {
        const access = await resolvePublicPageIn(tx, token)
        if (!access.ok) return access.reason
        return (await readPublicTableIn(tx, access.value))?.rows.map((r) => r.id).sort() ?? null
      })
    assert.deepEqual(await publicRows(), [], '공개 표 — "나" 는 아무도 아니다(포함은 0행)')
    unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: { ...me, operator: 'does_not_contain' } as never }))
    assert.deepEqual(await publicRows(), [...bossRows, mateRow].sort(), '포함하지 않음은 모든 행')
  })
})
