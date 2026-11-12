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

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import type { EditorBlock } from '../editor/document.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage } from '../file/storage.ts'
import { readPublicBlockFile } from './public-file.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase, createInlineDatabase } from '../database/database.ts'
import { createFormView } from '../database/form.ts'
import { addDataSource, trashDataSource } from '../database/data-source.ts'
import { applyRecordLayout } from '../database/layout.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema } from '../database/property.ts'
import type { CellValue } from '../database/property-types.ts'
import { createRow, trashRow } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'
import { createView, setPersonalView, setViewColumn, updateView } from '../database/view.ts'
import { withReadTransaction } from '../db/tx.ts'
import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { stopInheriting } from '../permissions/acl.ts'
import { resolvePublicPage } from './public-access.ts'
import { publicTableOf, readPublicRowPropertiesIn, readPublicTableIn } from './public-database.ts'
import { publishPage, unpublishPage } from './public-link.ts'
import { readPublicPage } from './public-read.ts'
import { queryGroups, queryGroupSummary } from '../database/group.ts'
import { groupLabel } from '../database/board-drag.ts'
import { buildBoardColumns } from './public-board.ts'
import { publicToday } from './public-window.ts'

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
  test('보드(선택으로 묶음)는 레이아웃 · 옵션 · 숨긴 그룹을 싣고 행은 표와 같다 · 다중 선택으로 묶으면 표로 돌아간다', async (t) => {
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

    // 다중 선택으로 묶은 보드는 공개 경로가 그리지 않는다 — 표(날짜 · 숫자 · 글은 PV-6 이 그린다 — ⑩)
    unwrap(await addProperty(boss.ctx, ds, { name: '태그', type: 'multi_select' }))
    const tagsId = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === '태그')!.id
    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: tagsId } }))
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

// ── PV-3 — 차트 ────────────────────────────────────────────────────────

describe('⑥ ★ 차트의 자기 집계 (PV-3)', () => {
  /**
   * 차트 표 — 점수(숫자) · 상태(할 일 · 끝) · 행: A(10 · 할 일) B(20 · 할 일) C(30 · 끝) F(5 · 값 없음) +
   * 공개로 안 열리는 D(40 · 할 일 · 상속 끊음) E(50 · 끝 · 휴지통) + 필터 밖 G(100 · 끝). 뷰: 점수 < 60.
   */
  async function charted() {
    const ws = await createBareWorkspace('공개 차트')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const db = unwrap(await createDatabase(boss.ctx, { name: unique('공개 차트') }))
    const ds = db.dataSourceId
    unwrap(await addProperty(boss.ctx, ds, { name: '점수', type: 'number' }))
    unwrap(await addProperty(boss.ctx, ds, { name: '상태', type: 'select' }))
    unwrap(await addProperty(boss.ctx, ds, { name: '기한', type: 'date' }))
    const schema = unwrap(await getSchema(boss.ctx, ds))
    const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
    const [title, score, status, due] = [id('이름'), id('점수'), id('상태'), id('기한')]
    const todo = unwrap(await addSelectOption(boss.ctx, ds, status, { name: '할 일', color: 'red' })).option.id
    const done = unwrap(await addSelectOption(boss.ctx, ds, status, { name: '끝', color: 'green' })).option.id
    const row = async (name: string, n: number, option: string | null) =>
      unwrap(
        await createRow(boss.ctx, ds, {
          cells: [
            { propertyId: title, value: { type: 'title', title: [textRun(name)] } as CellValue },
            { propertyId: score, value: { type: 'number', number: n } as CellValue },
            ...(option === null ? [] : [{ propertyId: status, value: { type: 'select', select: { id: option } } as CellValue }]),
          ],
        }),
      ).id
    const rows = {
      A: await row('A', 10, todo), B: await row('B', 20, todo), C: await row('C', 30, done), F: await row('F', 5, null),
      D: await row('D', 40, todo), E: await row('E', 50, done), G: await row('G', 100, done),
    }
    assert.ok((await stopInheriting(boss.ctx, rows.D)).ok)
    assert.ok((await trashRow(boss.ctx, rows.E)).ok)
    unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: score, operator: 'less_than', value: 60 } }))
    const token = unwrap(await publishPage(boss.ctx, db.id)).token!
    return { boss, db, ds, score, status, due, todo, done, rows, token }
  }

  const chartOf = async (token: string) => {
    const table = await tableOf(token)
    assert.ok(table !== null && typeof table !== 'string')
    return table
  }
  const summary = (t: { chart: { groups: readonly { key: string; count: number; value: unknown }[] } | null }) =>
    t.chart?.groups.map((g) => [g.key, g.count])

  test('선택으로 묶은 개수 — 공개로 열리는 행 · 필터를 지난 행만 센다 · 옵션 순서 · 값 없음 맨 앞', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, status, todo, done, token } = await charted()
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'chart', groupBy: { property_id: status }, chart: { kind: 'column' } }))
    const table = await chartOf(token)
    assert.equal(table.layout, 'chart')
    assert.equal(table.viewType, 'chart')
    assert.equal(table.chart?.kind, 'column')
    assert.deepEqual(summary(table), [['', 1], [todo, 2], [done, 1]], '끊은 D · 휴지통 E · 필터 밖 G 는 세지 않는다')
    assert.deepEqual(table.rows, [], '차트는 행을 싣지 않는다')

    // 숨긴 그룹은 뺀다
    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: status, hidden: [todo] } }))
    assert.deepEqual(summary(await chartOf(token)), [['', 1], [done, 1]])
  })

  test('숫자 속성의 합계 · 평균 — 값이 행에서 나온다 · 숫자 종류는 모든 행에 한 번', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, status, score, todo, done, token } = await charted()
    unwrap(
      await updateView(boss.ctx, db.defaultViewId, {
        type: 'chart', groupBy: { property_id: status, calculation: { property_id: score, function: 'sum' } }, chart: { kind: 'bar' },
      }),
    )
    const sum = await chartOf(token)
    const values = (c: typeof sum) => c.chart!.groups.map((g) => [g.key, (g.value as { value: number }).value])
    assert.deepEqual(values(sum), [['', 5], [todo, 30], [done, 30]], 'D(40) · E(50) · G(100) 는 합에 없다')
    assert.equal(sum.chart?.calculation?.propertyName, '점수')

    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: status, calculation: { property_id: score, function: 'average' } } }))
    assert.deepEqual(values(await chartOf(token)), [['', 5], [todo, 15], [done, 30]])

    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: status, calculation: { property_id: score, function: 'sum' } }, chart: { kind: 'number' } }))
    const number = await chartOf(token)
    assert.equal(number.layout, 'chart')
    assert.deepEqual(number.chart?.total, { kind: 'number', value: 65 })
    assert.deepEqual(number.chart?.groups, [])
  })

  test('그리지 못하는 X축 · Y계산은 표 — 다중 선택으로 묶음 · 날짜 계산', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, ds, status, due, rows, token } = await charted()
    // 다중 선택은 공개 경로가 그리지 않는다(날짜 · 숫자 · 글은 PV-6 이 그린다 — ⑩)
    unwrap(await addProperty(boss.ctx, ds, { name: '태그', type: 'multi_select' }))
    const tags = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.name === '태그')!.id
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'chart', groupBy: { property_id: tags }, chart: { kind: 'column' } }))
    const byTags = await chartOf(token)
    assert.equal(byTags.layout, 'table')
    assert.equal(byTags.viewType, 'chart')
    assert.equal(byTags.chart, null)
    assert.ok(byTags.rows.some((r) => r.id === rows.A), '표는 행을 싣는다')

    // 날짜 계산(가장 이른 날짜)은 Y값이 아니다 — 앱과 같이 저장만 해 두고 공개 화면은 표로
    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: status, calculation: { property_id: due, function: 'earliest_date' } } }))
    assert.equal((await chartOf(token)).layout, 'table')
  })
})

// ── MP-3 — 지도 ────────────────────────────────────────────────────────

describe('⑦ ★ 지도의 자기 질의 (MP-3)', () => {
  const place = (name: string, lat = 37.5665, lng = 126.978): CellValue => ({ type: 'place', place: { name, address: '비밀 주소', lat, lng } })

  /**
   * 지도 표 — 위치(장소) · 점수(숫자) · 행: A(서울 · 10) B(부산 · 20) C(장소 없음 · 30) D(대전 · 40 · 상속 끊음) E(광주 · 50 · 휴지통) G(제주 · 100 · 필터 밖) +
   * 템플릿 T(장소 있음). 뷰: 지도 · 점수 < 60.
   */
  async function mapped() {
    const ws = await createBareWorkspace('공개 지도')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const db = unwrap(await createDatabase(boss.ctx, { name: unique('공개 지도') }))
    const ds = db.dataSourceId
    unwrap(await addProperty(boss.ctx, ds, { name: '위치', type: 'place' }))
    unwrap(await addProperty(boss.ctx, ds, { name: '점수', type: 'number' }))
    const schema = unwrap(await getSchema(boss.ctx, ds))
    const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
    const [title, loc, score] = [id('이름'), id('위치'), id('점수')]
    const row = async (name: string, n: number, where: CellValue | null) =>
      unwrap(
        await createRow(boss.ctx, ds, {
          cells: [
            { propertyId: title, value: { type: 'title', title: [textRun(name)] } as CellValue },
            { propertyId: score, value: { type: 'number', number: n } as CellValue },
            ...(where === null ? [] : [{ propertyId: loc, value: where }]),
          ],
        }),
      ).id
    const rows = {
      A: await row('A', 10, place('서울', 37.5, 127)), B: await row('B', 20, place('부산', 35.1, 129)), C: await row('C', 30, null),
      D: await row('D', 40, place('대전')), E: await row('E', 50, place('광주')), G: await row('G', 100, place('제주')),
    }
    await createTemplate(boss.ctx, ds, { title: 'T' })
    assert.ok((await stopInheriting(boss.ctx, rows.D)).ok)
    assert.ok((await trashRow(boss.ctx, rows.E)).ok)
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'map', filter: { property_id: score, operator: 'less_than', value: 60 } }))
    const token = unwrap(await publishPage(boss.ctx, db.id)).token!
    return { boss, db, ds, loc, score, rows, token, title, row }
  }
  const mapOf = async (token: string) => {
    const table = await tableOf(token)
    assert.ok(table !== null && typeof table !== 'string')
    return table
  }

  test('핀은 공개로 열리는 행 · 공유 필터 · 장소 값이 있는 행만 — 이름과 좌표만 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { rows, token } = await mapped()
    const table = await mapOf(token)
    assert.equal(table.layout, 'map')
    assert.equal(table.rows.length, 0)
    assert.equal(table.truncated, false)
    assert.deepEqual(table.map?.pins.map((p) => [p.rowId, p.title, p.name]), [[rows.A, 'A', '서울'], [rows.B, 'B', '부산']])
    assert.deepEqual(table.map?.pins[0], { rowId: rows.A, title: 'A', name: '서울', lat: 37.5, lng: 127 })
    assert.equal(table.map?.height, 480)
    assert.ok(!JSON.stringify(table).includes('비밀 주소'), '주소는 싣지 않는다')
  })

  test('모양이 틀린 장소 값은 건너뛴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { rows, token } = await mapped()
    await query(
      `UPDATE page SET properties_cache = jsonb_set(properties_cache, ARRAY[(SELECT id FROM property WHERE name = '위치' AND data_source_id = page.data_source_id), 'place', 'lat'], '999'::jsonb) WHERE id = $1`,
      [rows.A],
    )
    assert.deepEqual((await mapOf(token)).map?.pins.map((p) => p.rowId), [rows.B])
  })

  test('101개 → 100핀 + truncated · 정확히 100개는 truncated 아님', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { token, row } = await mapped()
    for (let i = 0; i < 98; i += 1) await row(`R${i}`, 1, place(`곳${i}`))
    const hundred = await mapOf(token)
    assert.equal(hundred.map?.pins.length, 100)
    assert.equal(hundred.truncated, false)
    await row('R넘침', 1, place('넘침'))
    const over = await mapOf(token)
    assert.equal(over.map?.pins.length, 100)
    assert.equal(over.truncated, true)
  })

  test('★ 처음 100개는 표와 같은 차례 — 뷰의 정렬(점수 오름차순)이면 점수가 큰 B 가 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, rows, score, token, row } = await mapped()
    for (let i = 0; i < 99; i += 1) await row(`R${i}`, 1, place(`곳${i}`))
    // 정렬이 없으면 수동 순서 — 먼저 만든 A · B 가 든다
    const manual = (await mapOf(token)).map?.pins.map((p) => p.rowId) ?? []
    assert.ok(manual.includes(rows.A) && manual.includes(rows.B))
    unwrap(await updateView(boss.ctx, db.defaultViewId, { sorts: [{ property_id: score, direction: 'asc' }] }))
    const sorted = (await mapOf(token)).map?.pins.map((p) => p.rowId) ?? []
    assert.equal(sorted.length, 100)
    assert.ok(sorted.includes(rows.A) && !sorted.includes(rows.B), '점수 1 의 99개 · A(10) 다음에서 끊긴다')
  })

  test('보이는 장소 열이 없으면 표(viewType 은 map 그대로)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, db, loc, token } = await mapped()
    unwrap(await setViewColumn(boss.ctx, db.defaultViewId, loc, { visible: false }))
    const table = await mapOf(token)
    assert.equal(table.layout, 'table')
    assert.equal(table.viewType, 'map')
    assert.equal(table.map, null)
  })
})

// ── PV-4 — 뷰 탭 ─────────────────────────────────────────────────────────

describe('⑧ ★ 뷰 탭 (PV-4)', () => {
  /** 뷰가 표(기본) · 보드 · 폼 · 갤러리 순인 데이터베이스 — 행 하나(점수 30) · 보드 뷰는 점수 ≥ 25 필터. */
  async function tabbed(boss: Awaited<ReturnType<typeof board>>['boss'], name: string) {
    const db = unwrap(await createDatabase(boss.ctx, { name: unique(name) }))
    unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '점수', type: 'number' }))
    const score = unwrap(await getSchema(boss.ctx, db.dataSourceId)).properties.find((p) => p.name === '점수')!.id
    unwrap(await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: score, value: { type: 'number', number: 30 } as CellValue }] }))
    unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '단계', type: 'select' }))
    const stage = unwrap(await getSchema(boss.ctx, db.dataSourceId)).properties.find((p) => p.name === '단계')!.id
    const boardView = unwrap(await createView(boss.ctx, db.id, { type: 'board', name: '보드 탭', groupBy: { property_id: stage } }))
    const form = unwrap(await createFormView(boss.ctx, db.id, { name: '신청 폼' }))
    const gallery = unwrap(await createView(boss.ctx, db.id, { type: 'gallery' }))
    unwrap(await updateView(boss.ctx, boardView.id, { filter: { property_id: score, operator: 'greater_than', value: 99 } }))
    return { db, score, ids: { first: db.defaultViewId, board: boardView.id, form: form.viewId, gallery: gallery.id } }
  }

  const tableWith = async (databaseId: string, chosen: readonly string[]) =>
    withReadTransaction(async (tx) => {
      const table = await publicTableOf(tx, databaseId, null, chosen)
      assert.ok(table !== null)
      return table
    })

  test('탭 — 앱의 탭 차례 · 폼 뷰는 뺀다 · 이름이 비면 빈 글자(화면이 레이아웃 이름으로 채운다) · 안 고르면 첫 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await board()
    const { db, ids } = await tabbed(boss, '탭 있는 표')
    const table = await tableWith(db.id, [])
    assert.deepEqual(table.tabs.map((x) => x.id), [ids.first, ids.board, ids.gallery])
    assert.deepEqual(table.tabs.map((x) => x.type), ['table', 'board', 'gallery'])
    assert.equal(table.tabs[1]!.name, '보드 탭')
    assert.ok(!table.tabs.some((x) => x.id === ids.form), '폼 뷰는 탭이 아니다')
    assert.equal(table.viewId, ids.first)
    assert.equal(table.layout, 'table')
  })

  test('v 가 뷰를 고른다 — 그 뷰의 레이아웃 · 공유 필터 · 폼 뷰 id 는 무시하고 첫 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await board()
    const { db, ids } = await tabbed(boss, '고르는 표')
    const asGallery = await tableWith(db.id, [ids.gallery])
    assert.equal(asGallery.viewId, ids.gallery)
    assert.equal(asGallery.layout, 'gallery')
    assert.equal(asGallery.rows.length, 1)
    // 보드 뷰의 필터(점수 > 99)가 걸린다 — 첫 뷰와 다른 행 집합이다. (그룹 기준이 없으면 보드가 아니라 표로 그린다)
    const asBoard = await tableWith(db.id, [ids.board])
    assert.equal(asBoard.viewId, ids.board)
    assert.equal(asBoard.viewType, 'board')
    assert.equal(asBoard.rows.length, 0, '고른 뷰 자신의 필터')
    const form = await tableWith(db.id, [ids.form])
    assert.equal(form.viewId, ids.first, '폼 뷰 id 는 탭이 아니다')
    assert.equal(form.layout, 'table')
  })

  test('★ 남의 뷰 · 모르는 id 는 무시 — v 가 없을 때와 같은 출력 · 다른 데이터베이스의 뷰는 새지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await board()
    const a = await tabbed(boss, '내 표')
    const b = await tabbed(boss, '남의 표')
    const plain = await tableWith(a.db.id, [])
    for (const stray of [[b.ids.gallery], [b.ids.board], ['00000000-0000-0000-0000-000000000000'], ['nope'], ['']]) {
      assert.deepEqual(await tableWith(a.db.id, stray), plain, JSON.stringify(stray))
    }
    // 낯선 id 가 앞에 있어도 자기 뷰인 첫 값을 고른다
    assert.equal((await tableWith(a.db.id, [b.ids.gallery, a.ids.gallery])).viewId, a.ids.gallery)
    assert.ok(!JSON.stringify(plain).includes(b.ids.gallery), '다른 데이터베이스의 뷰 id 가 출력에 없다')
  })

  test('★ 한 페이지의 데이터베이스 둘 — 각자 자기 v 를 고른다 (인라인 · readPublicPage)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await board()
    const doc = (await createPage(boss.ctx, { privateTop: true, title: titleFromPlainText(unique('문서')) })).id
    const mk = async (name: string) => {
      const made = await createInlineDatabase(boss.ctx, { parentPageId: doc, name })
      assert.ok(made.ok, JSON.stringify(made))
      const g = unwrap(await createView(boss.ctx, made.value.id, { type: 'gallery' }))
      const l = unwrap(await createView(boss.ctx, made.value.id, { type: 'list' }))
      return { id: made.value.id, gallery: g.id, list: l.id }
    }
    const one = await mk(unique('첫째'))
    const two = await mk(unique('둘째'))
    const token = unwrap(await publishPage(boss.ctx, doc)).token!
    const read = async (v: readonly string[]) => {
      const r = await readPublicPage(token, undefined, { window: { v } })
      assert.ok(r.ok, JSON.stringify(r))
      return r.value
    }
    const both = await read([one.gallery, two.list])
    assert.equal(both.databases.get(one.id)?.layout, 'gallery')
    assert.equal(both.databases.get(two.id)?.layout, 'list')
    assert.deepEqual(both.query.v, [one.gallery, two.list], '탭 링크가 다른 v 를 둘 수 있게 주소의 값이 실린다')
    const swapped = await read([two.gallery])
    assert.equal(swapped.databases.get(one.id)?.layout, 'table', '첫째는 자기 뷰가 아니라서 첫 뷰')
    assert.equal(swapped.databases.get(two.id)?.layout, 'gallery')
  })
})

describe('⑨ ★ 갤러리의 미리보기 그림 (PV-5)', () => {
  const store = new Map<string, Uint8Array>()
  before(() => {
    setFileStorage({
      kind: 'memory',
      async put(key, bytes) { store.set(key, bytes) },
      async read(key) { return store.get(key) ?? null },
      async remove(key) { store.delete(key) },
    })
  })
  after(() => setFileStorage(null))

  const PNG = (fill: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill, fill])
  const upload = async (boss: Awaited<ReturnType<typeof board>>['boss'], fill: number): Promise<string> => {
    const r = await uploadFile(boss.ctx, { bytes: PNG(fill), mime: 'image/png', originalName: null })
    assert.ok(r.ok)
    return r.file.id
  }
  const setFormat = (id: string, patch: Record<string, unknown>) =>
    query(`UPDATE block SET format = coalesce(format, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [id, JSON.stringify(patch)])
  const imageBlock = (id: string, source: Record<string, unknown>): EditorBlock => ({ id, type: 'image', title: [], properties: { source } }) as EditorBlock
  const body = async (boss: Awaited<ReturnType<typeof board>>['boss'], rowId: string, blocks: EditorBlock[]) =>
    assert.ok((await savePageBody(boss.ctx, rowId, { blocks })).ok)

  /**
   * 갤러리 데이터베이스 — 행 C(올린 커버 · 본문 이미지도 있다) · I(본문: 토글 안 이미지가 맨 뒤 이미지보다 먼저) · X(바깥 주소 이미지) ·
   * N(아무것도 없다) · 닫힌 행 K(상속을 끊음) · 휴지통 행 T · 템플릿 — 닫힌 셋도 커버 · 이미지를 가진다.
   */
  async function gallery() {
    const ws = await createBareWorkspace('공개 갤러리')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const db = unwrap(await createDatabase(boss.ctx, { name: unique('공개 갤러리') }))
    const ds = db.dataSourceId
    const row = async () => unwrap(await createRow(boss.ctx, ds, {})).id
    const ids = { C: await row(), I: await row(), X: await row(), N: await row(), K: await row(), T: await row() }
    const template = unwrap(await createTemplate(boss.ctx, ds, { title: 'T' })).id
    const coverFile = await upload(boss, 11)
    for (const id of [ids.C, ids.K, ids.T, template]) await setFormat(id, { page_cover: { type: 'file', file_id: await upload(boss, 12) } })
    await setFormat(ids.C, { page_cover: { type: 'file', file_id: coverFile } })
    const nested = crypto.randomUUID()
    const last = crypto.randomUUID()
    const external = crypto.randomUUID()
    const closedImage = crypto.randomUUID()
    const cImage = crypto.randomUUID()
    await body(boss, ids.C, [imageBlock(cImage, { type: 'file', file_id: await upload(boss, 13) })])
    await body(boss, ids.I, [
      { id: crypto.randomUUID(), type: 'toggle', title: [textRun('접기')], children: [imageBlock(nested, { type: 'file', file_id: await upload(boss, 14) })] } as EditorBlock,
      imageBlock(last, { type: 'file', file_id: await upload(boss, 15) }),
    ])
    await body(boss, ids.X, [imageBlock(external, { type: 'external', url: 'https://example.com/a.png' })])
    for (const id of [ids.K, ids.T, template]) await body(boss, id, [imageBlock(id === ids.K ? closedImage : crypto.randomUUID(), { type: 'file', file_id: await upload(boss, 16) })])
    assert.ok((await stopInheriting(boss.ctx, ids.K)).ok)
    assert.ok((await trashRow(boss.ctx, ids.T)).ok)
    unwrap(await updateView(boss.ctx, db.defaultViewId, { type: 'gallery' }))
    const token = unwrap(await publishPage(boss.ctx, db.id)).token!
    return { boss, db, ids, template, token, nested, last, external, cImage, closedImage }
  }

  const previewsOf = async (token: string) => {
    const table = await tableOf(token)
    assert.ok(table !== null && typeof table !== 'string')
    assert.equal(table.layout, 'gallery')
    return new Map(table.rows.map((r) => [r.id, r.preview]))
  }

  test('★ 본문의 첫 이미지(기본) — 깊이 우선(토글 안이 먼저) · 올린 파일은 블록 id · 바깥 주소는 그대로 · 없으면 없음 · 닫힌 행은 표에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await gallery()
    const previews = await previewsOf(g.token)
    assert.deepEqual([...previews.keys()].sort(), [g.ids.C, g.ids.I, g.ids.N, g.ids.X].sort(), '공개로 열리는 행만 — 상속을 끊은 행 · 휴지통 · 템플릿은 없다')
    assert.deepEqual(previews.get(g.ids.I), { kind: 'image', blockId: g.nested })
    assert.deepEqual(previews.get(g.ids.C), { kind: 'image', blockId: g.cImage })
    assert.deepEqual(previews.get(g.ids.X), { kind: 'url', url: 'https://example.com/a.png' })
    assert.equal(previews.get(g.ids.N), null)
    assert.ok(!JSON.stringify([...previews]).includes(g.closedImage), '닫힌 행의 이미지 블록 id 는 출력에 없다')
  })

  test('★ 페이지 커버 — 올린 이미지는 cover(행 id 로 연다) · 내장은 배경 · 주소는 url · 닫힌 행은 없다 · 파일 id 는 출력에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await gallery()
    await setFormat(g.ids.I, { page_cover: { type: 'gallery', gallery: 'gradient_1' } })
    await setFormat(g.ids.X, { page_cover: { type: 'external', url: 'https://example.com/cover.png' } })
    unwrap(await updateView(g.boss.ctx, g.db.defaultViewId, { gallery: { cover: 'page_cover' } }))
    const previews = await previewsOf(g.token)
    assert.deepEqual(previews.get(g.ids.C), { kind: 'cover' })
    assert.equal(previews.get(g.ids.I)?.kind, 'background')
    assert.deepEqual(previews.get(g.ids.X), { kind: 'url', url: 'https://example.com/cover.png' })
    assert.equal(previews.get(g.ids.N), null)
    assert.ok(![g.ids.K, g.ids.T, g.template].some((id) => previews.has(id)), '공개로 열리지 않는 행')
    const files = await query<{ id: string }>(`SELECT id FROM file WHERE workspace_id = $1`, [g.boss.ctx.workspaceId])
    const out = JSON.stringify([...previews])
    assert.ok(files.every((f) => !out.includes(f.id)), '파일 id 는 싣지 않는다')
  })

  test('미리보기 "없음" — 어떤 행에도 그림이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await gallery()
    unwrap(await updateView(g.boss.ctx, g.db.defaultViewId, { gallery: { cover: 'none' } }))
    assert.ok([...(await previewsOf(g.token)).values()].every((p) => p === null))
  })

  test('★ 만든 주소가 실제로 열린다 — 열리는 행의 커버 · 본문 이미지는 파일을 주고 닫힌 행의 것은 닫혀 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await gallery()
    assert.equal((await readPublicBlockFile(g.token, g.ids.C, 'cover'))?.bytes[8], 11)
    assert.equal((await readPublicBlockFile(g.token, g.nested, 'image'))?.bytes[8], 14)
    assert.equal((await readPublicBlockFile(g.token, g.ids.K, 'cover')), null, '상속을 끊은 행의 커버')
    assert.equal((await readPublicBlockFile(g.token, g.closedImage, 'image')), null, '상속을 끊은 행의 본문 이미지')
    assert.equal((await readPublicBlockFile(g.token, g.ids.T, 'cover')), null, '휴지통 행의 커버')
    assert.equal((await readPublicBlockFile(g.token, g.template, 'cover')), null, '템플릿의 커버')
  })

  test('갤러리가 아닌 뷰는 그림을 싣지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await gallery()
    unwrap(await updateView(g.boss.ctx, g.db.defaultViewId, { type: 'list' }))
    const table = await tableOf(g.token)
    assert.ok(table !== null && typeof table !== 'string')
    assert.ok(table.rows.every((r) => r.preview === null))
  })
})

// ── PV-6 — 날짜 · 숫자 · 글로 묶은 보드 · 차트 ─────────────────────────────

describe('⑩ ★ 날짜 · 숫자 · 글로 묶은 보드 · 차트 (PV-6)', () => {
  /** 공개 화면의 오늘(UTC · `publicToday`)에서 n 일 떨어진 날. */
  const dayFrom = (n: number): string => {
    const t = new Date(`${publicToday()}T00:00:00Z`)
    t.setUTCDate(t.getUTCDate() + n)
    return t.toISOString().slice(0, 10)
  }

  /**
   * 묶을 표 — 기한(날짜) · 점수(숫자) · 메모(글) · 태그(다중 선택). 행(모두 공개로 열린다):
   *   A 오늘 · 3 · 가방 / B 어제 · 12 · 고양이 / C 3일 뒤 · 17 · 까치(ㄲ → ㄱ) / D 20일 전 · 25 · 나무 / E 100일 뒤 · -4 · apple /
   *   F 2001-02-03(토) · 40 · 123 / G 값 없음
   */
  async function bucketed() {
    const ws = await createBareWorkspace('공개 버킷')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const db = unwrap(await createDatabase(boss.ctx, { name: unique('공개 버킷') }))
    const ds = db.dataSourceId
    for (const [name, type] of [['기한', 'date'], ['점수', 'number'], ['메모', 'rich_text'], ['태그', 'multi_select']] as const) {
      unwrap(await addProperty(boss.ctx, ds, { name, type }))
    }
    const schema = unwrap(await getSchema(boss.ctx, ds))
    const id = (name: string) => schema.properties.find((p) => p.name === name)!.id
    const [title, due, score, memo, tags] = [id('이름'), id('기한'), id('점수'), id('메모'), id('태그')]
    const specs: [string, string | null, number | null, string | null][] = [
      ['A', dayFrom(0), 3, '가방'],
      ['B', dayFrom(-1), 12, '고양이'],
      ['C', dayFrom(3), 17, '까치'],
      ['D', dayFrom(-20), 25, '나무'],
      ['E', dayFrom(100), -4, 'apple'],
      ['F', '2001-02-03', 40, '123'],
      ['G', null, null, null],
    ]
    const rows: Record<string, string> = {}
    for (const [name, date, n, text] of specs) {
      rows[name] = unwrap(
        await createRow(boss.ctx, ds, {
          cells: [
            { propertyId: title, value: { type: 'title', title: [textRun(name)] } as CellValue },
            ...(date === null ? [] : [{ propertyId: due, value: { type: 'date', date: { start: date } } as CellValue }]),
            ...(n === null ? [] : [{ propertyId: score, value: { type: 'number', number: n } as CellValue }]),
            ...(text === null ? [] : [{ propertyId: memo, value: { type: 'rich_text', rich_text: [textRun(text)] } as CellValue }]),
          ],
        }),
      ).id
    }
    const token = unwrap(await publishPage(boss.ctx, db.id)).token!
    return { boss, db, ds, due, score, memo, tags, rows, token }
  }
  type Fixture = Awaited<ReturnType<typeof bucketed>>

  /** 앱의 보드 — 숨기지 않은 열의 [키 · 이름 · 행](보는 사람의 오늘 = 공개 화면의 오늘). */
  const appBoard = async (b: Fixture, propertyName: string) => {
    const page = unwrap(await queryGroups(b.boss.ctx, b.db.defaultViewId, { today: publicToday() }))
    return page.groups.filter((g) => !g.hidden).map((g) => [g.key, groupLabel(page.propertyType, propertyName, g, page), g.rows.map((r) => r.id).sort()])
  }
  /** 공개 보드 — 화면과 같은 열 짓기(`buildBoardColumns`)의 [키 · 이름 · 행]. */
  const publicBoard = async (b: Fixture) => {
    const table = await tableOf(b.token)
    assert.ok(table !== null && typeof table !== 'string')
    assert.equal(table.layout, 'board', JSON.stringify(table.board))
    return buildBoardColumns(table.board!.spec, table.rows, (r) => r.groupKey ?? '').map((c) => [c.key, c.name, c.rows.map((r) => r.id).sort()])
  }
  /** 앱의 차트 — 숨기지 않은 막대의 [키 · 이름 · 개수 · 값]. */
  const appChart = async (b: Fixture, propertyName: string) => {
    const page = unwrap(await queryGroupSummary(b.boss.ctx, b.db.defaultViewId, { today: publicToday() }))
    return page.groups
      .filter((g) => !g.hidden)
      .map((g) => [g.key, groupLabel(page.propertyType, propertyName, g, page), g.count, (g.value as { value?: unknown } | null)?.value ?? null])
  }
  const publicChart = async (b: Fixture) => {
    const table = await tableOf(b.token)
    assert.ok(table !== null && typeof table !== 'string')
    assert.equal(table.layout, 'chart')
    return table.chart!.groups.map((g) => [g.key, g.name, g.count, (g.value as { value?: unknown } | null)?.value ?? null])
  }

  test('★ 날짜(월 · 주 — 일요일 시작) — 열은 앱의 그룹과 같은 키 · 이름 · 차례 · 같은 행 · 값 없음 "기한 없음" 열이 맨 앞', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await bucketed()
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'board', groupBy: { property_id: b.due } }))
    const month = await publicBoard(b)
    assert.deepEqual(month, await appBoard(b, '기한'))
    assert.deepEqual(month[0], ['', '기한 없음', [b.rows.G]])
    assert.deepEqual(month[1], ['2001-02-01', '2001년 2월', [b.rows.F]], '가장 이른 달이 값 없음 다음')

    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: { property_id: b.due, date_unit: 'week', week_start: 'sunday' } }))
    const week = await publicBoard(b)
    assert.deepEqual(week, await appBoard(b, '기한'))
    assert.deepEqual(week[1], ['2001-01-28', '2001년 1월 28일 주', [b.rows.F]], '토요일(2/3)의 주는 그 전 일요일')
  })

  test('★ 상대 날짜 — 공개 화면의 오늘(UTC)로 · 앱과 같은 열', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await bucketed()
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'board', groupBy: { property_id: b.due, date_unit: 'relative' } }))
    const relative = await publicBoard(b)
    assert.deepEqual(relative, await appBoard(b, '기한'))
    assert.deepEqual(relative.map(([, name]) => name), ['기한 없음', '그 전', '지난 30일', '어제', '오늘', '앞으로 7일', '그 뒤'])
    assert.deepEqual(relative.find(([key]) => key === 'today')?.[2], [b.rows.A])
  })

  test('★ 숫자(크기 10) — 숨긴 그룹은 뺀다 · 내림 · 값 없음 열도 숨긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await bucketed()
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'board', groupBy: { property_id: b.score, number_size: 10, hidden: ['10'] } }))
    const number = await publicBoard(b)
    assert.deepEqual(number, await appBoard(b, '점수'))
    assert.deepEqual(number.map(([key, name]) => `${key}:${name}`), [':점수 없음', '-10:-10 ~ 0', '0:0 ~ 10', '20:20 ~ 30', '40:40 ~ 50'], '숨긴 10 ~ 20 은 없다')

    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: { property_id: b.score, number_size: 10, hidden: [''], sort: 'descending' } }))
    const down = await publicBoard(b)
    assert.deepEqual(down, await appBoard(b, '점수'))
    assert.deepEqual(down.map(([key]) => key), ['40', '20', '10', '0', '-10'])
  })

  test('★ 글 — 첫 글자(한글은 초성 · 된소리는 예사소리로) · 글 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await bucketed()
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'board', groupBy: { property_id: b.memo, text_by: 'first' } }))
    const first = await publicBoard(b)
    assert.deepEqual(first, await appBoard(b, '메모'))
    assert.deepEqual(first, [
      ['', '메모 없음', [b.rows.G]],
      ['ㄱ', 'ㄱ', [b.rows.A, b.rows.B, b.rows.C].sort()],
      ['ㄴ', 'ㄴ', [b.rows.D]],
      ['A', 'A', [b.rows.E]],
      ['#', '그 밖', [b.rows.F]],
    ])

    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: { property_id: b.memo } }))
    const exact = await publicBoard(b)
    assert.deepEqual(exact, await appBoard(b, '메모'))
    assert.equal(exact.length, 7, '값 없음 + 글 여섯')
  })

  test('★ 차트 — 날짜 · 숫자 · 글의 X축은 앱의 차트와 같은 막대(키 · 이름 · 개수 · 합계 · 차례) · 숨긴 그룹은 뺀다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await bucketed()
    const cases = [
      { name: '기한', groupBy: { property_id: b.due, calculation: { property_id: b.score, function: 'sum' as const } } },
      { name: '기한', groupBy: { property_id: b.due, date_unit: 'relative' as const } },
      { name: '점수', groupBy: { property_id: b.score, number_size: 10, hidden: ['10'] } },
      { name: '메모', groupBy: { property_id: b.memo, text_by: 'first' as const } },
    ]
    for (const c of cases) {
      unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'chart', groupBy: c.groupBy, chart: { kind: 'column' } }))
      const bars = await publicChart(b)
      assert.deepEqual(bars, await appChart(b, c.name), JSON.stringify(c.groupBy))
      assert.equal(bars[0]![1], `${c.name} 없음`, '값 없음 막대가 맨 앞')
    }
    const sums = await (async () => {
      unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: cases[0]!.groupBy }))
      return publicChart(b)
    })()
    assert.deepEqual(sums.find(([key]) => key === '2001-02-01'), ['2001-02-01', '2001년 2월', 1, 40], '그 달의 점수 합')
    const number = await (async () => {
      unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: cases[2]!.groupBy }))
      return publicChart(b)
    })()
    assert.ok(!number.some(([key]) => key === '10'), '숨긴 구간은 막대가 없다')
  })

  test('아직 그리지 못하는 기준은 그대로 — 다중 선택 · 상태의 범주 단위는 표 · 하위 그룹은 빼고 그린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const b = await bucketed()
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'board', groupBy: { property_id: b.tags } }))
    const byTags = await tableOf(b.token)
    assert.ok(byTags !== null && typeof byTags !== 'string')
    assert.equal(byTags.layout, 'table')
    assert.equal(byTags.board, null)
    assert.equal(byTags.rows.length, 7, '행은 그대로')

    unwrap(await addProperty(b.boss.ctx, b.ds, { name: '진행', type: 'status' }))
    const progress = unwrap(await getSchema(b.boss.ctx, b.ds)).properties.find((p) => p.name === '진행')!.id
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: { property_id: progress, status_by: 'group' } }))
    assert.equal(((await tableOf(b.token)) as { layout: string }).layout, 'table', '범주 단위는 표')

    // 하위 그룹(가로줄)은 읽지 않는다 — 열은 앱의 열과 같고 행은 모두 열에 선다
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { groupBy: { property_id: b.due }, subGroupBy: { property_id: b.score } }))
    const app = unwrap(await queryGroups(b.boss.ctx, b.db.defaultViewId, { today: publicToday() }))
    assert.ok(app.sub !== null, '앱은 가로줄을 그린다')
    const flat = await publicBoard(b)
    assert.deepEqual(flat.map(([key, name]) => [key, name]), app.groups.filter((g) => !g.hidden).map((g) => [g.key, groupLabel(app.propertyType, '기한', g, app)]))
    assert.equal(flat.flatMap(([, , ids]) => ids as string[]).length, 7)

    // 차트의 쌓기도 읽지 않는다 — 막대는 그룹 합계(앱의 그룹 개수와 같다)
    unwrap(await updateView(b.boss.ctx, b.db.defaultViewId, { type: 'chart', chart: { kind: 'column' } }))
    const stacked = await publicChart(b)
    assert.deepEqual(stacked.map(([key, , count]) => [key, count]), (await appChart(b, '기한')).map(([key, , count]) => [key, count]))
  })
})
