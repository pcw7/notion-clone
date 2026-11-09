/**
 * 데이터베이스 게시 — 공개 표 · 공개 행 (게시 · 공유 6a-2c-1 · F-06-08 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [정정] 웹 게시 ⑫ · [보강] 공개 화면 ⑩).
 *
 *   ① ★ 데이터베이스를 게시하면 그 토큰으로 표가 열린다 — 소유한 data source 의 첫 뷰의 **공유** 필터 · 정렬(소유자의 개인 필터는
 *      방문자에게 없다) · 보이는 공개 열(숨긴 열 · 그리지 않는 타입은 없다) · 선택의 옵션
 *   ② ★ 표에 서는 행 = 공개로 열리는 행 — 템플릿 · 상속을 끊은 행 · 휴지통의 행은 표에도 없고 주소로도 안 열린다 · 열리는 행은 속성
 *      묶음(스키마 순서 · 제목 빼고 · 행 레이아웃이 숨긴 것 빼고)
 *   ③ data source 를 휴지통에 보내면 그 행도 열리지 않는다(행이 함께 휴지통에 간다) · 게시를 해제하면 표 · 행 모두 닫힌다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource, trashDataSource } from '../database/data-source.ts'
import { applyRecordLayout } from '../database/layout.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema } from '../database/property.ts'
import type { CellValue } from '../database/property-types.ts'
import { createRow, trashRow } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'
import { setPersonalView, setViewColumn, updateView } from '../database/view.ts'
import { withReadTransaction } from '../db/tx.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { stopInheriting } from '../permissions/acl.ts'
import { resolvePublicPage } from './public-access.ts'
import { readPublicRowPropertiesIn, readPublicTableIn } from './public-database.ts'
import { publishPage, unpublishPage } from './public-link.ts'

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

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

/**
 * 게시할 표 — 점수(숫자) · 상태(선택: 할 일 · 끝) · 메모(글 — 뷰에서 숨긴다) · 행 A(10) · B(20) · C(30) · D(40 — 상속을 끊는다) ·
 * E(50 — 휴지통) · 템플릿 T. 뷰: 점수 > 15 · 점수 내림차순.
 */
async function board() {
  const ws = await createBareWorkspace('공개 표')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: unique('공개 목록') }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '점수', type: 'number' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '상태', type: 'select' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '메모', type: 'rich_text' }))
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
  const [title, score, status, memo] = [id('이름'), id('점수'), id('상태'), id('메모')]
  const todo = unwrap(await addSelectOption(boss.ctx, ds, status, { name: '할 일' })).option.id
  unwrap(await addSelectOption(boss.ctx, ds, status, { name: '끝' }))
  const row = async (name: string, n: number) =>
    unwrap(
      await createRow(boss.ctx, ds, {
        cells: [
          { propertyId: title, value: { type: 'title', title: [textRun(name)] } as CellValue },
          { propertyId: score, value: { type: 'number', number: n } as CellValue },
          { propertyId: status, value: { type: 'select', select: { id: todo } } as CellValue },
          { propertyId: memo, value: { type: 'rich_text', rich_text: [textRun('숨긴 메모')] } as CellValue },
        ],
      }),
    ).id
  const rows = { A: await row('A', 10), B: await row('B', 20), C: await row('C', 30), D: await row('D', 40), E: await row('E', 50) }
  const template = unwrap(await createTemplate(boss.ctx, ds, { title: 'T' }))
  assert.ok((await stopInheriting(boss.ctx, rows.D)).ok)
  assert.ok((await trashRow(boss.ctx, rows.E)).ok)
  unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: score, operator: 'greater_than', value: 15 }, sorts: [{ property_id: score, direction: 'desc' }] }))
  unwrap(await setViewColumn(boss.ctx, db.defaultViewId, memo, { visible: false }))
  // 소유자의 개인 필터(2h-1) — 방문자에게는 없다
  unwrap(await setPersonalView(boss.ctx, db.defaultViewId, { filter: { property_id: score, operator: 'less_than', value: 15 } }))
  const token = unwrap(await publishPage(boss.ctx, db.id)).token!
  return { boss, db, ds, title, score, status, memo, todo, rows, template, token }
}

const tableOf = async (token: string) =>
  withReadTransaction(async (tx) => {
    const { resolvePublicPageIn } = await import('./public-access.ts')
    const access = await resolvePublicPageIn(tx, token)
    if (!access.ok) return access.reason
    return readPublicTableIn(tx, access.value)
  })

const rowPropertiesOf = async (token: string, rowId: string) =>
  withReadTransaction(async (tx) => {
    const { resolvePublicPageIn } = await import('./public-access.ts')
    const access = await resolvePublicPageIn(tx, token, rowId)
    if (!access.ok) return access.reason
    return readPublicRowPropertiesIn(tx, access.value)
  })

describe('① ★ 공개 표', () => {
  test('공유 필터 · 정렬 · 보이는 공개 열 · 옵션 — 개인 필터 · 숨긴 열은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, token, title, score, status, memo, todo, rows } = await board()
    const root = unwrap(await resolvePublicPage(token))
    assert.equal(root.rootId, db.id)

    const table = await tableOf(token)
    assert.ok(table !== null && typeof table !== 'string', JSON.stringify(table))
    assert.deepEqual(table.rows.map((r) => r.id), [rows.C, rows.B], '점수 > 15 · 내림차순 — 끊은 D · 휴지통 E 는 없다')
    assert.deepEqual(table.columns.map((c) => c.id), [title, score, status], '숨긴 메모는 없다')
    assert.deepEqual(table.columns.find((c) => c.id === status)?.options.map((o) => o.name), ['할 일', '끝'])
    assert.deepEqual(table.rows[0]!.cells[score], { type: 'number', number: 30 })
    assert.deepEqual(table.rows[0]!.cells[status], { type: 'select', select: { id: todo } })
    assert.equal(table.rows[0]!.cells[memo], undefined, '숨긴 열의 값은 싣지 않는다')
    assert.equal(table.truncated, false)

    // 필터를 걷어도 템플릿 · 끊은 행 · 휴지통의 행은 없다 — 필터가 대신 걸러 준 것이 아니다
    unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: null }))
    const all = await tableOf(token)
    assert.ok(all !== null && typeof all !== 'string')
    assert.deepEqual(all.rows.map((r) => r.id), [rows.C, rows.B, rows.A])
  })
})

describe('② ★ 표에 서는 행 = 공개로 열리는 행', () => {
  test('템플릿 · 끊은 행 · 휴지통의 행은 주소로도 안 열린다 · 열리는 행은 속성 묶음(제목 · 레이아웃이 숨긴 것 빼고)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, token, score, status, memo, rows, template } = await board()
    for (const closed of [rows.D, rows.E, template.id]) {
      assert.deepEqual(await resolvePublicPage(token, closed), { ok: false, reason: 'not_found' }, closed)
    }
    assert.ok((await resolvePublicPage(token, rows.A)).ok, '뷰의 필터 밖의 행도 주소로는 열린다(필터는 표의 모양이다)')

    unwrap(await applyRecordLayout(boss.ctx, ds, { expectedVersion: '0', order: [], hidden: [memo] }))
    const props = await rowPropertiesOf(token, rows.C)
    assert.ok(props !== null && typeof props !== 'string', JSON.stringify(props))
    assert.deepEqual(props.columns.map((c) => c.id), [score, status], '스키마 순서 · 제목 빼고 · 레이아웃이 숨긴 메모 빼고')
    assert.deepEqual(props.cells[score], { type: 'number', number: 30 })
  })
})

describe('④ ★ 첫 뷰의 레이아웃 (PV-1)', () => {
  test('보드(선택으로 묶음)는 레이아웃 · 옵션 · 숨긴 그룹을 싣고 행은 표와 같다 · 날짜로 묶으면 표로 돌아간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, ds, db, token, status, rows } = await board()
    const tableLayout = await tableOf(token)
    assert.ok(tableLayout !== null && typeof tableLayout !== 'string')
    assert.equal(tableLayout.layout, 'table')
    assert.equal(tableLayout.board, null)

    const doneId = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.id === status)!.options!.find((o) => o.name === '끝')!.id
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'board', groupBy: { property_id: status, hidden: [doneId] } }))
    const asBoard = await tableOf(token)
    assert.ok(asBoard !== null && typeof asBoard !== 'string')
    assert.equal(asBoard.layout, 'board')
    assert.equal(asBoard.viewType, 'board')
    assert.equal(asBoard.board?.spec.type, 'select')
    assert.deepEqual(asBoard.board?.spec.options.map((o) => o.name), ['할 일', '끝'], '옵션은 스키마 순서')
    assert.deepEqual(asBoard.board?.spec.hidden, [doneId])
    assert.deepEqual(asBoard.rows.map((r) => r.id), tableLayout.rows.map((r) => r.id), '고르는 행 · 순서는 표와 같다')
    assert.ok(asBoard.rows.every((r) => r.groupKey !== null))

    // 날짜로 묶은 보드는 공개 경로가 버킷을 계산하지 않는다 — 표
    unwrap(await addProperty(boss.ctx, ds, { name: '기한', type: 'date' }))
    const dateId = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === '기한')!.id
    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: dateId } }))
    const fallback = await tableOf(token)
    assert.ok(fallback !== null && typeof fallback !== 'string')
    assert.equal(fallback.layout, 'table')
    assert.equal(fallback.viewType, 'board')
    assert.equal(fallback.board, null)
    assert.deepEqual(fallback.rows.map((r) => r.id), [rows.C, rows.B], '행은 그대로')

    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'gallery', groupBy: null, gallery: { cover_size: 'large' } }))
    const gallery = await tableOf(token)
    assert.ok(gallery !== null && typeof gallery !== 'string')
    assert.equal(gallery.layout, 'gallery')
    assert.equal(gallery.cardSize, 'large')
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'list' }))
    assert.equal(((await tableOf(token)) as { layout: string }).layout, 'list')
  })
})

describe('③ 휴지통의 data source · 게시 해제', () => {
  test('휴지통의 data source 의 행은 열리지 않는다 · 해제하면 표 · 행 모두 닫힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, token, rows } = await board()
    const second = unwrap(await addDataSource(boss.ctx, db.id, { name: '둘째' }))
    const other = unwrap(await createRow(boss.ctx, second.dataSource.id))
    assert.ok((await resolvePublicPage(token, other.id)).ok, '둘째 소스의 행도 데이터베이스 아래다')
    unwrap(await trashDataSource(boss.ctx, second.dataSource.id))
    assert.deepEqual(await resolvePublicPage(token, other.id), { ok: false, reason: 'not_found' })

    unwrap(await unpublishPage(boss.ctx, db.id))
    assert.equal(await tableOf(token), 'not_found')
    assert.deepEqual(await resolvePublicPage(token, rows.C), { ok: false, reason: 'not_found' })
  })
})

// ── PV-2 — 캘린더 · 타임라인 ─────────────────────────────────────────────

describe('⑤ ★ 캘린더 · 타임라인의 창 (PV-2)', () => {
  /** 날짜 있는 표 — 기한(날짜) · 점수(숫자) · 행: 범위(3/10~3/12) · 하루(3/20) · 앞에 걸침(2/27~3/02) · 밖(5/01) · 필터 밖(3/15 · 점수 5) · 날짜 없음. */
  async function dated() {
    const ws = await createBareWorkspace('공개 캘린더')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const db = unwrap(await createDatabase(boss.ctx, { name: unique('공개 일정') }))
    const ds = db.dataSourceId
    unwrap(await addProperty(boss.ctx, ds, { name: '기한', type: 'date' }))
    unwrap(await addProperty(boss.ctx, ds, { name: '점수', type: 'number' }))
    const schema = unwrap(await getSchema(boss.ctx, ds))
    const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
    const [title, due, score] = [id('이름'), id('기한'), id('점수')]
    const row = async (name: string, start: string | null, end: string | null, n = 10) =>
      unwrap(
        await createRow(boss.ctx, ds, {
          cells: [
            { propertyId: title, value: { type: 'title', title: [textRun(name)] } as CellValue },
            { propertyId: score, value: { type: 'number', number: n } as CellValue },
            ...(start === null ? [] : [{ propertyId: due, value: { type: 'date', date: { start, ...(end === null ? {} : { end }) } } as CellValue }]),
          ],
        }),
      ).id
    const rows = {
      range: await row('범위', '2026-03-10', '2026-03-12'),
      one: await row('하루', '2026-03-20', null),
      before: await row('앞에 걸침', '2026-02-27', '2026-03-02'),
      out: await row('밖', '2026-05-01', null),
      filtered: await row('필터 밖', '2026-03-15', null, 5),
      none: await row('날짜 없음', null, null),
    }
    unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: score, operator: 'greater_than', value: 7 } }))
    const token = unwrap(await publishPage(boss.ctx, db.id)).token!
    return { boss, db, ds, due, score, rows, token }
  }

  const windowOf = async (token: string, win: { m?: string; from?: string }) =>
    withReadTransaction(async (tx) => {
      const { resolvePublicPageIn } = await import('./public-access.ts')
      const access = await resolvePublicPageIn(tx, token)
      if (!access.ok) throw new Error(access.reason)
      const table = await readPublicTableIn(tx, access.value, win)
      assert.ok(table !== null)
      return table
    })

  test('캘린더 — 달에 걸친 행만(범위 · 앞에서 걸친 것 포함) · 필터 · 날짜 없음 · 밖은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, due, rows, token } = await dated()
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'calendar', calendar: { date_property_id: due } }))

    const march = await windowOf(token, { m: '2026-03' })
    assert.equal(march.layout, 'calendar')
    assert.equal(march.viewType, 'calendar')
    assert.equal(march.window?.month, '2026-03')
    assert.deepEqual(march.window?.prev, '2026-02')
    assert.deepEqual(march.window?.next, '2026-04')
    assert.deepEqual(march.rows.map((r) => r.id), [rows.before, rows.range, rows.one], '날짜순 · 필터 밖 · 5월 · 날짜 없음은 없다')
    assert.deepEqual(march.rows.find((r) => r.id === rows.range)!.span, { start: '2026-03-10', end: '2026-03-12' })

    const may = await windowOf(token, { m: '2026-05' })
    assert.deepEqual(may.rows.map((r) => r.id), [rows.out])

    // 끝 날이 달의 첫날에 닿으면 든다 · 하루 전에 끝나면 없다(겹침 규칙의 경계)
    const apr = await windowOf(token, { m: '2026-04' })
    assert.deepEqual(apr.rows, [], '3월에 끝난 행은 4월에 없다')
    const feb = await windowOf(token, { m: '2026-02' })
    assert.deepEqual(feb.rows.map((r) => r.id), [rows.before], '2/27~3/02 는 2월에도 있다')

    // 틀린 값은 오늘이 든 달
    const bad = await windowOf(token, { m: 'garbage' })
    assert.equal(bad.window?.month, new Date().toISOString().slice(0, 7))
  })

  test('타임라인 — 창에 걸친 행만 · 이전 · 다음 창 · 막대 색(color_by)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, ds, due, rows, token } = await dated()
    unwrap(await addProperty(boss.ctx, ds, { name: '단계', type: 'select' }))
    const stage = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === '단계')!.id
    unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '진행', color: 'blue' }))
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'timeline', timeline: { date_property_id: due, zoom: 'day', color_by: stage } }))

    // day 줌 — 42일: 3/01 ~ 4/11
    const win = await windowOf(token, { from: '2026-03-01' })
    assert.equal(win.layout, 'timeline')
    assert.equal(win.window?.from, '2026-03-01')
    assert.equal(win.window?.to, '2026-04-11')
    assert.deepEqual(win.rows.map((r) => r.id), [rows.before, rows.range, rows.one])
    assert.equal(win.window?.prev, '2026-01-18')
    assert.equal(win.window?.next, '2026-04-12')
    assert.ok(win.rows.every((r) => r.barColor === 'default'), '단계가 빈 행은 기본 색')

    const later = await windowOf(token, { from: win.window!.next })
    assert.equal(later.window?.from, '2026-04-12')
    assert.deepEqual(later.rows.map((r) => r.id), [rows.out], '4/12 ~ 5/23 에는 5/01 행만 든다')
  })

  test('날짜 속성이 지워진 캘린더 · 타임라인은 표 — viewType 은 그대로 · 행은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, ds, due, rows, token } = await dated()
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'calendar', calendar: { date_property_id: due } }))
    unwrap(await deleteProperty(boss.ctx, ds, due))
    const table = await windowOf(token, { m: '2026-03' })
    assert.equal(table.layout, 'table')
    assert.equal(table.viewType, 'calendar')
    assert.equal(table.window, null)
    assert.ok(table.rows.some((r) => r.id === rows.none), '표는 창으로 거르지 않는다')
  })

  test('보이는 행의 조건은 그대로 — 상속을 끊은 행 · 휴지통의 행은 창 안이어도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, due, rows, token } = await dated()
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'calendar', calendar: { date_property_id: due } }))
    assert.ok((await stopInheriting(boss.ctx, rows.range)).ok)
    assert.ok((await trashRow(boss.ctx, rows.one)).ok)
    const march = await windowOf(token, { m: '2026-03' })
    assert.deepEqual(march.rows.map((r) => r.id), [rows.before])
  })
})
