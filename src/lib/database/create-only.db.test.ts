/**
 * "만들기만" · 자기가 열 수 있는 행만 — 게시 · 공유 6f-2b-1조각 (F-06-10 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 행 단위 접근 규칙 ⑥).
 *
 *   ① ★ "만들기만"(`create` 레벨) — 데이터베이스를 못 보면서 행을 만든다 · 표를 열지만(스키마 · 뷰) 행은 하나도 오지 않는다(자기 행도
 *      — 규칙이 없으면) · 화면이 읽는 `canViewAllRows` 는 거짓
 *   ② ★ "만들기만 + 만든 사람 → 편집" — 자기 행만 · **표 · 보드(개수) · 캘린더(날짜 없음의 수) · 열 집계가 같은 행**(남의 행이 개수 ·
 *      합으로 새지 않는다) · 자기 행의 칸을 고치고 남의 행은 not_found
 *   ③ 행에 따로 준 부여도 보인다(스코프) · 뷰의 기본 템플릿으로 만든다 · 템플릿 목록 · 구조는 여전히 닫혀 있다
 *   ④ 셀 쓰기는 **그 행의 권한** — 데이터베이스를 고치는 사람이라도 자기를 뺀 채 끊긴 행의 칸은 not_found(초판은 데이터베이스로 물었다)
 *   ⑤ 볼 수도 만들 수도 없는 사람에게는 표 · 행 · 개수 모두 없다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import type { CellValue } from './property-types.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setAccessRule } from '../permissions/access-rule.ts'
import { computeCalculations } from './calculate.ts'
import { queryCalendar } from './calendar-query.ts'
import { createDatabase, getDatabase } from './database.ts'
import { queryGroups } from './group.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { createRow, updateCells } from './row.ts'
import { createRowFromTemplate, createTemplate, listTemplates } from './template.ts'
import { createView, getView, updateView } from './view.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

const num = (n: number): CellValue => ({ type: 'number', number: n })
const day = (d: string): CellValue => ({ type: 'date', date: { start: d } })

/**
 * 소유자의 개인 표(점수 · 마감 · 상태) · 소유자의 행 둘(10 · 20) · "만들기만" 을 받은 동료 · 표를 보는 편집자 · 아무것도 없는 사람.
 */
async function submissions() {
  const ws = await createBareWorkspace('만들기만')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const maker = await joinAs(ws, await createUser('제출자'), 'member')
  const editor = await joinAs(ws, await createUser('편집자'), 'member')
  const stranger = await joinAs(ws, await createUser('남'), 'member')
  const db = unwrap(await createDatabase(boss.ctx, { name: unique('제출함'), privateTop: true }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '점수', type: 'number' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '마감', type: 'date' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '상태', type: 'select' }))
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const score = id('점수')
  const due = id('마감')
  const status = id('상태')
  const todo = unwrap(await addSelectOption(boss.ctx, ds, status, { name: '할 일' })).option.id
  const cells = (n: number, d: string) => [
    { propertyId: score, value: num(n) },
    { propertyId: due, value: day(d) },
    { propertyId: status, value: { type: 'select', select: { id: todo } } as CellValue },
  ]
  const theirs = [unwrap(await createRow(boss.ctx, ds, { cells: cells(10, '2026-03-10') })), unwrap(await createRow(boss.ctx, ds, { cells: cells(20, '2026-03-11') }))]
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: maker.userId }, 'create')).ok)
  assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: editor.userId }, 'edit')).ok)
  const board = unwrap(await createView(boss.ctx, db.id, { type: 'board' }))
  const calendar = unwrap(await createView(boss.ctx, db.id, { type: 'calendar' }))
  return { ws, boss, maker, editor, stranger, db, ds, score, due, todo, cells, theirs, board, calendar }
}

const titlesOf = async (who: Actor, ds: string) => {
  const r = await queryRows(who.ctx, ds)
  return r.ok ? r.value.rows.map((row) => row.id) : r.reason
}
const sumOf = async (who: Actor, ds: string, score: string) =>
  (await computeCalculations(who.ctx, ds, null, [{ propertyId: score, type: 'number', calculation: 'sum' }]))[score]
const countOf = async (who: Actor, boardId: string, key: string) => {
  const r = await queryGroups(who.ctx, boardId)
  return r.ok ? (r.value.groups.find((g) => g.key === key)?.count ?? 0) : r.reason
}
const calendarIds = async (who: Actor, viewId: string) => {
  const r = await queryCalendar(who.ctx, viewId, { from: '2026-03-01', to: '2026-03-31' })
  return r.ok ? r.value.rows.map((row) => row.id) : r.reason
}

// ── ① 만들기만 ────────────────────────────────────────────────────────

describe('① ★ "만들기만" — 못 보면서 만든다', () => {
  test('행을 만든다 · 표(스키마 · 뷰)는 열리지만 행은 하나도 오지 않는다 · canViewAllRows 거짓', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { maker, db, ds, score, todo, cells, board, calendar } = await submissions()

    const mine = await createRow(maker.ctx, ds, { cells: cells(5, '2026-03-12') })
    assert.ok(mine.ok, JSON.stringify(mine))
    const seen = unwrap(await getDatabase(maker.ctx, db.id))
    assert.deepEqual(seen.access, { canViewAllRows: false, canEditContent: false, canCreateRows: true, canEditStructure: false })
    assert.ok((await getView(maker.ctx, board.id)).ok, '뷰 설정은 열린다(행은 없다)')

    assert.deepEqual(await titlesOf(maker, ds), [], '규칙이 없으면 자기 행도 보이지 않는다(06 "기존 row 는 보이지 않음")')
    assert.equal(await countOf(maker, board.id, todo), 0)
    assert.deepEqual(await calendarIds(maker, calendar.id), [])
    assert.deepEqual(await sumOf(maker, ds, score), { kind: 'number', value: 0 })
  })
})

// ── ② 만든 사람 → 편집 ────────────────────────────────────────────────

describe('② ★ "만들기만 + 만든 사람 → 편집"', () => {
  test('자기 행만 — 표 · 보드 개수 · 캘린더 · 열 집계가 같은 행 · 자기 칸을 고치고 남의 행은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, maker, db, ds, score, todo, cells, theirs, board, calendar } = await submissions()
    const mine = unwrap(await createRow(maker.ctx, ds, { cells: cells(5, '2026-03-12') }))
    assert.ok((await setAccessRule(boss.ctx, db.id, { dataSourceId: ds, source: 'created_by', level: 'edit' })).ok)

    assert.deepEqual(await titlesOf(maker, ds), [mine.id])
    assert.equal(await countOf(maker, board.id, todo), 1, '보드의 개수가 남의 행을 세지 않는다')
    assert.deepEqual(await calendarIds(maker, calendar.id), [mine.id])
    assert.deepEqual(await sumOf(maker, ds, score), { kind: 'number', value: 5 }, '합이 남의 행(10 · 20)을 더하지 않는다')
    assert.deepEqual(await sumOf(boss, ds, score), { kind: 'number', value: 35 }, '소유자는 모두')

    assert.ok((await updateCells(maker.ctx, mine.id, { cells: [{ propertyId: score, value: num(7) }] })).ok, '자기 칸을 고친다')
    assert.deepEqual(await updateCells(maker.ctx, theirs[0].id, { cells: [{ propertyId: score, value: num(0) }] }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await sumOf(maker, ds, score), { kind: 'number', value: 7 })
  })
})

// ── ③ 따로 준 부여 · 템플릿 · 구조 ──────────────────────────────────

describe('③ 행에 따로 준 부여 · 기본 템플릿 · 닫힌 것', () => {
  test('따로 준 행은 보인다 · 뷰의 기본 템플릿으로 만든다 · 템플릿 목록 · 구조는 닫혀 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, maker, ds, theirs, board } = await submissions()
    assert.ok((await grantAccess(boss.ctx, theirs[1].id, { type: 'user', id: maker.userId }, 'view')).ok)
    assert.deepEqual(await titlesOf(maker, ds), [theirs[1].id], '행에 따로 준 부여(스코프)는 보인다')

    const template = unwrap(await createTemplate(boss.ctx, ds, { title: '제출 양식' }))
    unwrap(await updateView(boss.ctx, board.id, { defaultTemplateId: template.id }))
    assert.equal((await getView(maker.ctx, board.id)).ok && unwrap(await getView(maker.ctx, board.id)).defaultTemplateId, template.id)
    assert.ok((await createRowFromTemplate(maker.ctx, ds, template.id)).ok, '뷰의 기본 템플릿으로 만든다(만드는 것과 같은 권한)')
    assert.deepEqual(await listTemplates(maker.ctx, ds), { ok: false, reason: 'not_found' }, '템플릿 목록은 보는 일이다')
    assert.equal((await addProperty(maker.ctx, ds, { name: '끼어들기', type: 'number' })).ok, false, '구조는 닫혀 있다')
    assert.equal((await updateView(maker.ctx, board.id, { name: '바꾼 이름' })).ok, false)
    assert.ok((await revokeAccess(boss.ctx, theirs[1].id, { type: 'user', id: maker.userId })).ok)
  })
})

// ── ④ 셀 쓰기는 행의 권한 ─────────────────────────────────────────────

describe('④ ★ 셀 쓰기는 그 행의 권한', () => {
  test('데이터베이스를 고치는 사람이라도 자기를 뺀 채 끊긴 행의 칸은 not_found · 다른 행은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, editor, score, theirs } = await submissions()
    assert.ok((await updateCells(editor.ctx, theirs[0].id, { cells: [{ propertyId: score, value: num(11) }] })).ok)
    assert.ok((await stopInheriting(boss.ctx, theirs[1].id)).ok)
    assert.ok((await revokeAccess(boss.ctx, theirs[1].id, { type: 'user', id: editor.userId })).ok)
    assert.deepEqual(await updateCells(editor.ctx, theirs[1].id, { cells: [{ propertyId: score, value: num(0) }] }), {
      ok: false,
      reason: 'not_found',
    })
  })
})

// ── ⑤ 아무것도 없는 사람 ──────────────────────────────────────────────

describe('⑤ 볼 수도 만들 수도 없는 사람', () => {
  test('표 · 행 · 개수 · 합 · 만들기 모두 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { stranger, db, ds, score, board, calendar, todo } = await submissions()
    assert.deepEqual(await getDatabase(stranger.ctx, db.id), { ok: false, reason: 'not_found' })
    assert.equal(await titlesOf(stranger, ds), 'not_found')
    assert.equal(await countOf(stranger, board.id, todo), 'not_found')
    assert.equal(await calendarIds(stranger, calendar.id), 'not_found')
    assert.equal(await sumOf(stranger, ds, score), undefined)
    assert.deepEqual(await createRow(stranger.ctx, ds), { ok: false, reason: 'not_found' })
  })
})
