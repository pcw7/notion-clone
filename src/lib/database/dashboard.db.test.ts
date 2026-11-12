/**
 * 대시보드 뷰 — 서버 (DB-1 · F-04-20, DB 필요)
 *
 *   ① 대시보드 = 탭 뷰(`type='dashboard'`) · 소스는 첫 소유 소스 · 필터 · 정렬 · 묶기 · 보이는 속성이 없다 · 행 질의는 모두 거부한다
 *   ② 위젯 = `dashboard_widget` 뷰 — 탭 목록에 서지 않는다 · 붙인(연결) 소스도 된다 · 보통 뷰의 명령으로 고친다 · 폼 · 대시보드는 안 된다
 *   ③ 배치 — 위젯 넣기(줄 · 새 줄 · full) · 지우기(줄 당기기 · 빈 줄 없애기) · 낡은 판은 conflict · 칸은 이 대시보드의 위젯 전부여야 한다
 *   ④ 원본을 볼 수 없는 위젯은 이름 · 타입 · 소스가 없다 · 휴지통의 소스는 sourceGone · 떼면 위젯이 함께 사라지고 칸이 정리된다
 *   ⑤ 대시보드를 지우면 위젯도 · 구조 권한이 없으면 넣기 · 지우기 · 옮기기가 모두 forbidden
 *   ⑥ 복제 — 위젯과 배치의 view_id 가 사본의 것 · 공개 탭에서는 대시보드가 빠진다
 *
 * 반사실(HANDOFF §3.3): `openView` 가 위젯을 안 받으면 ② 의 읽기 · 고치기가, `dashboard` 거부를 빼면 ① 의 질의가, `updated_at` 비교를 빼면
 * ③ 의 conflict 가, 접근 검사를 빼면 ④ 가, 복제의 view_id 다시 매기기를 빼면 ⑥ 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createView, deleteView, getView, listViews, moveView, setPersonalView, setViewColumn, updateView, type ViewDetail } from './view.ts'
import { addDataSource, attachLinkedDataSource, detachLinkedDataSource, trashDataSource } from './data-source.ts'
import { addDashboardWidget, readDashboard, removeDashboardWidget, updateDashboardLayout, type DashboardDetail } from './dashboard.ts'
import { queryGroups, queryGroupSummary, moveRow } from './group.ts'
import { queryCalendar } from './calendar-query.ts'
import { queryMapPins } from './map-query.ts'
import { rowStandsInView } from './row-in-view.ts'
import { moveViewRow } from './row-order.ts'
import { duplicateDatabase } from './duplicate-database.ts'
import { createRow } from './row.ts'
import { textRun } from '../contracts/rich-text.ts'
import { publicTableOf } from '../publish/public-database.ts'
import type { DashboardLayout } from './dashboard-layout.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}
const reasonOf = (r: { ok: boolean; reason?: string }): string | undefined => (r.ok ? undefined : r.reason)

/** 표 하나(select 속성 포함 — 보드 위젯이 쓴다) + 대시보드 하나. */
async function setup(name = '표', actor: Actor = fx.owner) {
  const created = unwrap(await createDatabase(actor.ctx, { name }))
  unwrap(await addProperty(actor.ctx, created.dataSourceId, { name: '단계', type: 'select' }))
  const schema = unwrap(await getSchema(actor.ctx, created.dataSourceId))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const dashboard = unwrap(await createView(actor.ctx, created.id, { type: 'dashboard' }))
  return { databaseId: created.id, ds: created.dataSourceId, tableViewId: created.defaultViewId!, titleId, dashboardId: dashboard.id, dashboard }
}

const add = async (dashboardId: string, ds: string, type: 'table' | 'board' | 'list' | 'gallery' = 'table', row?: number, actor: Actor = fx.owner) =>
  unwrap(await addDashboardWidget(actor.ctx, dashboardId, { dataSourceId: ds, type, ...(row === undefined ? {} : { row }) }))

const shape = (layout: DashboardLayout) => layout.rows.map((r) => r.cells.length)

describe('① 대시보드 뷰', () => {
  test('★ 탭 뷰로 선다 — 첫 소유 소스 · 필터 · 정렬 · 묶기 · 보이는 속성이 없다 · 배치는 빈 줄 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.equal(s.dashboard.type, 'dashboard')
    assert.equal(s.dashboard.name, '대시보드')
    assert.equal(s.dashboard.dataSourceId, s.ds)
    assert.equal(s.dashboard.filter, null)
    assert.deepEqual(s.dashboard.sorts, [])
    assert.equal(s.dashboard.groupBy, null)
    assert.deepEqual(s.dashboard.columns, [])
    const tabs = unwrap(await listViews(fx.owner.ctx, s.databaseId))
    assert.deepEqual(tabs.map((v) => v.type), ['table', 'dashboard'])
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    assert.deepEqual(read.layout, { rows: [] })
    assert.deepEqual(read.widgets, [])
    assert.match(read.updatedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
  })

  test('★ 이름만 고친다 — 필터 · 정렬 · 묶기 · 타입 · 보이는 속성 · 개인 필터는 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.equal(unwrap(await updateView(fx.owner.ctx, s.dashboardId, { name: '현황' })).name, '현황')
    assert.equal(reasonOf(await updateView(fx.owner.ctx, s.dashboardId, { sorts: [{ property_id: s.titleId, direction: 'asc' }] })), 'unsupported_type')
    assert.equal(reasonOf(await updateView(fx.owner.ctx, s.dashboardId, { type: 'table' })), 'unsupported_type')
    assert.equal(reasonOf(await updateView(fx.owner.ctx, s.dashboardId, { loadLimit: 10 })), 'unsupported_type')
    assert.equal(reasonOf(await setViewColumn(fx.owner.ctx, s.dashboardId, s.titleId, { visible: true })), 'unsupported_type')
    assert.equal(reasonOf(await setPersonalView(fx.owner.ctx, s.dashboardId, { sorts: [] })), 'unsupported_type')
  })

  test('★ 행 질의는 대시보드를 거부한다 — 묶기 · 요약 · 캘린더 · 지도 · 행 순서 · 행이 서는가', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const row = unwrap(await createRow(fx.owner.ctx, s.ds, { cells: [{ propertyId: s.titleId, value: { type: 'title', title: [textRun('가')] } }] })).id
    assert.equal(reasonOf(await queryGroups(fx.owner.ctx, s.dashboardId)), 'not_found')
    assert.equal(reasonOf(await queryGroupSummary(fx.owner.ctx, s.dashboardId)), 'not_found')
    assert.equal(reasonOf(await queryCalendar(fx.owner.ctx, s.dashboardId, { from: '2026-01-01', to: '2026-01-31' })), 'not_calendar')
    assert.equal(reasonOf(await queryMapPins(fx.owner.ctx, s.dashboardId)), 'not_map')
    assert.equal(reasonOf(await moveViewRow(fx.owner.ctx, s.dashboardId, { rowId: row, beforeRowId: null })), 'not_found')
    assert.equal(reasonOf(await moveRow(fx.owner.ctx, s.dashboardId, { rowId: row, toGroup: 'x', beforeRowId: null } as never)), 'not_found')
    assert.equal(await rowStandsInView(fx.owner.ctx, s.dashboardId, row), null)
  })

  test('★ 마지막 행 뷰는 대시보드가 있어도 지울 수 없다 · 대시보드는 지울 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.equal(reasonOf(await deleteView(fx.owner.ctx, s.tableViewId)), 'last_view')
    unwrap(await deleteView(fx.owner.ctx, s.dashboardId))
    assert.equal((await readDashboard(fx.owner.ctx, s.dashboardId)).ok, false)
  })

  test('새 속성은 대시보드의 보이는 속성으로 퍼지지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const w = await add(s.dashboardId, s.ds)
    unwrap(await addProperty(fx.owner.ctx, s.ds, { name: '수량', type: 'number' }))
    const onDashboard = await query(`SELECT 1 FROM view_property WHERE view_id = $1`, [s.dashboardId])
    assert.equal(onDashboard.length, 0)
    const widget = unwrap(await getView(fx.owner.ctx, w.widgetId))
    assert.ok(widget.columns.some((c) => c.name === '수량'), '위젯은 보통 뷰처럼 새 속성을 받는다')
  })
})

describe('② 위젯', () => {
  test('★ 위젯은 탭 목록에 서지 않고 getView 로 읽힌다 · 새 탭 뷰와 같은 기본값(보드는 그룹을 고른다 · 속성이 시딩된다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const board = await add(s.dashboardId, s.ds, 'board')
    const table = await add(s.dashboardId, s.ds, 'table')
    const tabs = unwrap(await listViews(fx.owner.ctx, s.databaseId))
    assert.ok(!tabs.some((v) => v.id === board.widgetId || v.id === table.widgetId), '위젯은 탭이 아니다')
    const view = unwrap(await getView(fx.owner.ctx, board.widgetId))
    assert.equal(view.type, 'board')
    assert.ok(view.groupBy !== null, '보드 위젯은 첫 select 로 그룹')
    assert.ok(view.columns.some((c) => c.name === '이름' && c.visible))
    const row = (await query<{ owner_kind: string; dashboard_view_id: string; database_id: string }>(
      `SELECT owner_kind, dashboard_view_id, database_id FROM view WHERE id = $1`, [board.widgetId]))[0]!
    assert.deepEqual([row.owner_kind, row.dashboard_view_id, row.database_id], ['dashboard_widget', s.dashboardId, s.databaseId])
  })

  test('★ 위젯은 보통 뷰의 명령으로 고친다 — 필터 · 정렬 · 이름 · 타입 전환 · 보이는 속성 · 개인 필터', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const w = await add(s.dashboardId, s.ds, 'table')
    const filtered = unwrap(await updateView(fx.owner.ctx, w.widgetId, {
      name: '진행 중', sorts: [{ property_id: s.titleId, direction: 'desc' }], filter: { property_id: s.titleId, operator: 'contains', value: '가' },
    }))
    assert.equal(filtered.name, '진행 중')
    assert.equal(filtered.sorts.length, 1)
    assert.equal(unwrap(await updateView(fx.owner.ctx, w.widgetId, { type: 'list' })).type, 'list')
    unwrap(await setViewColumn(fx.owner.ctx, w.widgetId, s.titleId, { visible: true }))
    unwrap(await setPersonalView(fx.owner.ctx, w.widgetId, { sorts: [] }))
    // 대시보드가 읽는 이름은 위젯의 이름
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    assert.deepEqual(read.widgets.map((x) => [x.accessible && x.name, x.accessible && x.type]), [['진행 중', 'list']])
  })

  test('★ 위젯 타입은 여덟 — 폼 · 대시보드(중첩) · 모르는 타입 거부 · 아무것도 만들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    for (const type of ['form', 'dashboard', 'kanban']) {
      assert.equal(reasonOf(await addDashboardWidget(fx.owner.ctx, s.dashboardId, { dataSourceId: s.ds, type: type as never })), 'unsupported_type', type)
    }
    assert.equal((await query(`SELECT 1 FROM view WHERE dashboard_view_id = $1`, [s.dashboardId])).length, 0)
  })

  test('★ 위젯은 탭이 아니라 지우기 · 옮기기가 일반 길로는 되지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const w = await add(s.dashboardId, s.ds)
    assert.equal(reasonOf(await deleteView(fx.owner.ctx, w.widgetId)), 'not_found')
    assert.equal(reasonOf(await moveView(fx.owner.ctx, w.widgetId, null)), 'not_found')
  })

  test('★ 연결한 소스의 위젯 — 그 데이터베이스에 붙은 소스만(안 붙은 소스 · 다른 대시보드의 소스는 not_found)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup('대시보드 표')
    const source = await setup('원본 표')
    // 아직 붙이지 않았다
    assert.equal(reasonOf(await addDashboardWidget(fx.owner.ctx, s.dashboardId, { dataSourceId: source.ds, type: 'table' })), 'not_found')
    unwrap(await attachLinkedDataSource(fx.owner.ctx, s.databaseId, { dataSourceId: source.ds }))
    const w = await add(s.dashboardId, source.ds, 'table')
    const view = unwrap(await getView(fx.owner.ctx, w.widgetId))
    assert.equal(view.dataSourceId, source.ds)
    assert.equal(view.databaseId, s.databaseId)
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    assert.deepEqual(read.widgets.map((x) => x.accessible && x.dataSourceId), [source.ds])
  })

  test('★ 다른 데이터베이스의 대시보드에는 쓸 수 없다 — 없는 대시보드 · 표 뷰 id 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.equal(reasonOf(await addDashboardWidget(fx.owner.ctx, s.tableViewId, { dataSourceId: s.ds, type: 'table' })), 'not_found')
    assert.equal(reasonOf(await readDashboard(fx.owner.ctx, s.tableViewId)), 'not_found')
  })
})

describe('③ 배치', () => {
  test('★ 넣기 — 줄을 안 주면 새 줄(medium) · 준 줄에 자리가 있으면 그 줄 · 가득이면 새 줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds)
    assert.deepEqual(a.dashboard.layout.rows.map((r) => r.height), ['medium'])
    const b = await add(s.dashboardId, s.ds, 'table', 0)
    assert.deepEqual(shape(b.dashboard.layout), [2])
    await add(s.dashboardId, s.ds, 'table', 0)
    await add(s.dashboardId, s.ds, 'table', 0)
    const full = await add(s.dashboardId, s.ds, 'table', 0)
    assert.deepEqual(shape(full.dashboard.layout), [4, 1], '줄이 가득이면 새 줄')
    assert.equal(full.dashboard.widgets.length, 5)
  })

  test('★ 12개 · 3줄이 다 차면 full 이고 위젯 뷰를 만들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    for (let i = 0; i < 12; i++) await add(s.dashboardId, s.ds, 'table', Math.floor(i / 4))
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    assert.deepEqual(shape(read.layout), [4, 4, 4])
    assert.equal(reasonOf(await addDashboardWidget(fx.owner.ctx, s.dashboardId, { dataSourceId: s.ds, type: 'table' })), 'full')
    assert.equal(reasonOf(await addDashboardWidget(fx.owner.ctx, s.dashboardId, { dataSourceId: s.ds, type: 'table', row: 1 })), 'full')
    assert.equal((await query(`SELECT 1 FROM view WHERE dashboard_view_id = $1`, [s.dashboardId])).length, 12)
  })

  test('★ 지우면 칸이 빠지고 줄이 당겨진다 · 빈 줄은 없어진다 · 위젯 뷰도 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds)
    const b = await add(s.dashboardId, s.ds, 'table', 0)
    const c = await add(s.dashboardId, s.ds, 'table')
    assert.deepEqual(shape(c.dashboard.layout), [2, 1])
    const afterB = unwrap(await removeDashboardWidget(fx.owner.ctx, s.dashboardId, b.widgetId))
    assert.deepEqual(afterB.layout.rows.map((r) => r.cells.map((x) => x.view_id)), [[a.widgetId], [c.widgetId]])
    const afterC = unwrap(await removeDashboardWidget(fx.owner.ctx, s.dashboardId, c.widgetId))
    assert.deepEqual(shape(afterC.layout), [1], '빈 줄은 없어진다')
    assert.equal((await query(`SELECT 1 FROM view WHERE id = $1`, [b.widgetId])).length, 0)
    assert.equal(reasonOf(await removeDashboardWidget(fx.owner.ctx, s.dashboardId, b.widgetId)), 'not_found')
    // 다른 대시보드의 위젯은 못 지운다
    const t2 = await setup()
    assert.equal(reasonOf(await removeDashboardWidget(fx.owner.ctx, t2.dashboardId, a.widgetId)), 'not_found')
  })

  test('★ 옮기기 — 읽은 판의 updatedAt 과 함께 · 낡은 판은 conflict · 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds)
    const b = await add(s.dashboardId, s.ds, 'table', 0)
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    // 두 칸을 따로 줄로 · 높이를 바꾼다
    const moved: DashboardLayout = { rows: [{ height: 'large', cells: [{ view_id: b.widgetId }] }, { height: 'small', cells: [{ view_id: a.widgetId }] }] }
    const ok = unwrap(await updateDashboardLayout(fx.owner.ctx, s.dashboardId, { layout: moved, updatedAt: read.updatedAt }))
    assert.deepEqual(ok.layout, moved)
    assert.notEqual(ok.updatedAt, read.updatedAt)
    // 같은 낡은 판으로 다시 — 남이 먼저 고쳤다
    const stale = await updateDashboardLayout(fx.owner.ctx, s.dashboardId, { layout: read.layout, updatedAt: read.updatedAt })
    assert.equal(reasonOf(stale), 'conflict')
    assert.deepEqual(unwrap(await readDashboard(fx.owner.ctx, s.dashboardId)).layout, moved)
    // 위젯 넣기도 판을 바꾼다 — 그 전에 읽은 판은 낡았다
    const before = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    await add(s.dashboardId, s.ds)
    assert.equal(reasonOf(await updateDashboardLayout(fx.owner.ctx, s.dashboardId, { layout: before.layout, updatedAt: before.updatedAt })), 'conflict')
  })

  test('★ 배치는 모양과 칸을 지킨다 — 한계 · 중복 · 남의 위젯 · 빠진 위젯 · 판 글 모양', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds)
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    const send = (layout: unknown, updatedAt: unknown = read.updatedAt) => updateDashboardLayout(fx.owner.ctx, s.dashboardId, { layout, updatedAt })
    const cell = { view_id: a.widgetId }
    assert.equal(reasonOf(await send({ rows: [{ height: 'huge', cells: [cell] }] })), 'invalid_layout')
    assert.equal(reasonOf(await send({ rows: [{ height: 'small', cells: [cell, cell] }] })), 'invalid_layout')
    assert.equal(reasonOf(await send({ rows: [] })), 'invalid_layout', '위젯이 빠졌다 — 빼려면 지운다')
    const other2 = await setup()
    const foreign = await add(other2.dashboardId, other2.ds)
    assert.equal(reasonOf(await send({ rows: [{ height: 'small', cells: [cell, { view_id: foreign.widgetId }] }] })), 'invalid_layout', '남의 대시보드 위젯')
    assert.equal(reasonOf(await send({ rows: [{ height: 'small', cells: [cell] }] }, '어제')), 'invalid_layout')
    assert.equal(reasonOf(await send({ rows: [{ height: 'small', cells: [cell] }] })), undefined)
  })
})

describe('④ 접근 · 소스의 상태', () => {
  const restrict = async (databaseId: string) => {
    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
  }

  test('★ 원본을 볼 수 없는 연결 위젯 — 이름 · 타입 · 소스가 없다 · 볼 수 있는 사람은 그대로 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup('내 대시보드')
    const secret = await setup('기밀 원본')
    unwrap(await attachLinkedDataSource(fx.owner.ctx, s.databaseId, { dataSourceId: secret.ds }))
    const own = await add(s.dashboardId, s.ds, 'table')
    const linked = await add(s.dashboardId, secret.ds, 'board')
    unwrap(await updateView(fx.owner.ctx, linked.widgetId, { name: '기밀 보드' }))
    await restrict(secret.databaseId)

    const seen = unwrap(await readDashboard(other.ctx, s.dashboardId))
    const hidden = seen.widgets.find((w) => w.id === linked.widgetId)!
    assert.deepEqual(hidden, { id: linked.widgetId, accessible: false, type: null, name: null, dataSourceId: null, sourceGone: false })
    assert.equal(JSON.stringify(hidden).includes('기밀'), false)
    assert.equal(seen.widgets.find((w) => w.id === own.widgetId)?.accessible, true)
    assert.equal(seen.layout.rows.flatMap((r) => r.cells).length, 2, '칸은 남는다(볼 수 없는 위젯으로 그린다)')
    // 못 보는 위젯은 읽을 수도 없다
    assert.equal(reasonOf(await getView(other.ctx, linked.widgetId)), 'not_found')
    // 소유자는 그대로 본다
    const mine = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    assert.deepEqual(mine.widgets.map((w) => w.accessible), [true, true])
  })

  test('★ 휴지통의 소스는 sourceGone(이름 · 타입은 남는다) · 되살리면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const second = unwrap(await addDataSource(fx.owner.ctx, s.databaseId, { name: '둘째' }))
    const w = await add(s.dashboardId, second.dataSource.id, 'table')
    unwrap(await trashDataSource(fx.owner.ctx, second.dataSource.id))
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    const gone = read.widgets.find((x) => x.id === w.widgetId)!
    assert.equal(gone.accessible && gone.sourceGone, true)
    assert.equal(gone.accessible && gone.type, 'table')
    assert.equal(read.layout.rows.flatMap((r) => r.cells).length, 1, '칸은 남는다 — 위젯이 있다')
  })

  test('★ 연결을 떼면 위젯이 함께 사라지고 배치의 칸은 읽을 때 걸러진다 · 다음 쓰기가 정리한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const source = await setup('원본')
    unwrap(await attachLinkedDataSource(fx.owner.ctx, s.databaseId, { dataSourceId: source.ds }))
    const keep = await add(s.dashboardId, s.ds)
    const linked = await add(s.dashboardId, source.ds, 'table', 0)
    unwrap(await detachLinkedDataSource(fx.owner.ctx, s.databaseId, source.ds))
    assert.equal((await query(`SELECT 1 FROM view WHERE id = $1`, [linked.widgetId])).length, 0, '0042 의 FK 가 위젯을 지운다')
    const read = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    assert.deepEqual(read.layout.rows.flatMap((r) => r.cells.map((c) => c.view_id)), [keep.widgetId])
    // 저장된 배치에는 죽은 칸이 남아 있다 — 다음 쓰기가 정리한다
    const stored = (await query<{ dashboard_layout: DashboardLayout }>(`SELECT dashboard_layout FROM view WHERE id = $1`, [s.dashboardId]))[0]!.dashboard_layout
    assert.equal(stored.rows.flatMap((r) => r.cells).length, 2)
    // 걸러진 배치로 옮기기가 된다(칸 = 위젯 전부)
    unwrap(await updateDashboardLayout(fx.owner.ctx, s.dashboardId, { layout: read.layout, updatedAt: read.updatedAt }))
    const cleaned = (await query<{ dashboard_layout: DashboardLayout }>(`SELECT dashboard_layout FROM view WHERE id = $1`, [s.dashboardId]))[0]!.dashboard_layout
    assert.equal(cleaned.rows.flatMap((r) => r.cells).length, 1)
  })
})

describe('⑤ 지우기 · 권한', () => {
  test('★ 대시보드를 지우면 위젯 뷰도 지워진다(CASCADE) · 위젯의 속성 행도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds)
    const b = await add(s.dashboardId, s.ds, 'board')
    unwrap(await deleteView(fx.owner.ctx, s.dashboardId))
    assert.equal((await query(`SELECT 1 FROM view WHERE id = ANY($1::uuid[])`, [[a.widgetId, b.widgetId]])).length, 0)
    assert.equal((await query(`SELECT 1 FROM view_property WHERE view_id = ANY($1::uuid[])`, [[a.widgetId, b.widgetId]])).length, 0)
  })

  test('★ 구조 권한이 없으면(편집만) 넣기 · 지우기 · 옮기기가 forbidden · 읽기는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds)
    // 이 데이터베이스는 `other` 에게 보기 등급만 — 구조 권한이 없다
    assert.equal((await stopInheriting(fx.owner.ctx, s.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, s.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, s.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, s.databaseId, { type: 'user', id: other.userId }, 'view')).ok, true)

    const read = unwrap(await readDashboard(other.ctx, s.dashboardId))
    assert.equal(read.widgets.length, 1)
    assert.equal(reasonOf(await addDashboardWidget(other.ctx, s.dashboardId, { dataSourceId: s.ds, type: 'table' })), 'forbidden')
    assert.equal(reasonOf(await removeDashboardWidget(other.ctx, s.dashboardId, a.widgetId)), 'forbidden')
    assert.equal(reasonOf(await updateDashboardLayout(other.ctx, s.dashboardId, { layout: read.layout, updatedAt: read.updatedAt })), 'forbidden')
    assert.equal(reasonOf(await createView(other.ctx, s.databaseId, { type: 'dashboard' })), 'forbidden')
    assert.deepEqual(unwrap(await readDashboard(fx.owner.ctx, s.dashboardId)).layout, read.layout, '아무것도 바뀌지 않았다')
  })

  test('볼 수 없는 사람에게는 없는 대시보드', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    assert.equal((await stopInheriting(fx.owner.ctx, s.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, s.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, s.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal(reasonOf(await readDashboard(other.ctx, s.dashboardId)), 'not_found')
  })
})

describe('⑥ 복제 · 공개', () => {
  test('★ 복제는 위젯과 배치의 view_id 를 사본의 것으로 옮긴다 — 사본의 위젯 뷰는 사본의 대시보드 · 소스를 가리킨다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const a = await add(s.dashboardId, s.ds, 'table')
    const b = await add(s.dashboardId, s.ds, 'board', 0)
    unwrap(await updateView(fx.owner.ctx, b.widgetId, { name: '보드 위젯' }))
    const original = unwrap(await readDashboard(fx.owner.ctx, s.dashboardId))
    const moved: DashboardLayout = { rows: [{ height: 'large', cells: [{ view_id: b.widgetId }, { view_id: a.widgetId }] }] }
    unwrap(await updateDashboardLayout(fx.owner.ctx, s.dashboardId, { layout: moved, updatedAt: original.updatedAt }))

    const copy = unwrap(await duplicateDatabase(fx.owner.ctx, s.databaseId, { content: false }))
    const tabs = unwrap(await listViews(fx.owner.ctx, copy.id))
    const dash = tabs.find((v) => v.type === 'dashboard')!
    const read = unwrap(await readDashboard(fx.owner.ctx, dash.id))
    assert.notEqual(dash.id, s.dashboardId)
    assert.equal(read.widgets.length, 2)
    const ids = read.layout.rows[0]!.cells.map((c) => c.view_id)
    assert.ok(!ids.includes(a.widgetId) && !ids.includes(b.widgetId), '원본의 위젯 id 가 남지 않는다')
    assert.equal(read.layout.rows[0]!.height, 'large')
    // 칸 차례 그대로 — 첫 칸은 보드 위젯
    const first = read.widgets.find((w) => w.id === ids[0])!
    assert.equal(first.accessible && first.name, '보드 위젯')
    assert.equal(first.accessible && first.type, 'board')
    const rows = await query<{ id: string; database_id: string; dashboard_view_id: string; data_source_id: string }>(
      `SELECT id, database_id, dashboard_view_id, data_source_id FROM view WHERE dashboard_view_id = $1`, [dash.id])
    assert.equal(rows.length, 2)
    const copySources = (await query<{ id: string }>(`SELECT id FROM data_source WHERE owner_database_id = $1`, [copy.id])).map((r) => r.id)
    assert.equal(copySources.length, 1)
    assert.ok(rows.every((r) => r.database_id === copy.id && r.data_source_id === copySources[0]))
    // 사본의 위젯은 사본의 보이는 속성을 가진다 · 원본은 그대로
    assert.ok(unwrap(await getView(fx.owner.ctx, ids[0]!)).columns.length > 0)
    assert.deepEqual(unwrap(await readDashboard(fx.owner.ctx, s.dashboardId)).layout, moved)
  })

  test('★ 공개 화면의 탭에서 대시보드는 빠진다 — 대시보드만 있으면 그릴 표가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    await add(s.dashboardId, s.ds)
    const withTabs = await withReadTransaction((tx) => publicTableOf(tx, s.databaseId, null, [s.dashboardId]))
    assert.ok(withTabs !== null)
    assert.deepEqual(withTabs.tabs.map((x) => x.type), ['table'])
    assert.equal(withTabs.viewId, s.tableViewId, '대시보드 id 를 골라도 첫 탭으로')
  })
})

describe('0143 — DB 가 거부한다', () => {
  const widgetRow = async (s: Awaited<ReturnType<typeof setup>>, over: Partial<Record<string, unknown>> = {}) => {
    const v = { id: crypto.randomUUID(), kind: 'dashboard_widget', db: s.databaseId, ds: s.ds, type: 'table', parent: s.dashboardId, ...over }
    return query(
      `INSERT INTO view (id, owner_kind, database_id, data_source_id, type, order_idx, dashboard_view_id, configuration, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'a0', $6, '{}'::jsonb, now(), now())`,
      [v.id, v.kind, v.db, v.ds, v.type, v.parent],
    )
  }

  test('★ 위젯 ⇔ 부모 · 타입 화이트리스트 · 소스 필수 · 부모는 같은 데이터베이스의 대시보드', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    const o = await setup()
    await widgetRow(s) // 통과
    // pg 의 오류는 `constraint` 에 이름을 싣는다 — BEFORE 트리거가 CHECK 보다 먼저 도는 줄은 트리거 이름
    const rejectsBy = (p: Promise<unknown>, ...names: string[]) =>
      assert.rejects(p, (e: { constraint?: string }) => names.includes(e.constraint ?? ''), `거부 이름이 ${names.join(' | ')} 이어야 한다`)
    await rejectsBy(widgetRow(s, { parent: null }), 'trg_view_widget_parent', 'ck_view_widget_parent')
    await rejectsBy(widgetRow(s, { kind: 'database_view' }), 'ck_view_widget_parent')
    await rejectsBy(widgetRow(s, { type: 'form' }), 'ck_view_widget_type')
    await rejectsBy(widgetRow(s, { type: 'dashboard' }), 'ck_view_widget_type', 'ck_view_dashboard_owner')
    await rejectsBy(widgetRow(s, { ds: null }), 'ck_view_widget_source')
    await rejectsBy(widgetRow(s, { parent: s.tableViewId }), 'trg_view_widget_parent')
    await rejectsBy(widgetRow(s, { parent: o.dashboardId }), 'trg_view_widget_parent')
    await rejectsBy(widgetRow(s, { parent: crypto.randomUUID() }), 'trg_view_widget_parent')
  })

  test('★ 배치는 대시보드 뷰에만 · 모양 CHECK · 위젯이 달린 대시보드는 타입을 못 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await setup()
    await add(s.dashboardId, s.ds)
    const setLayout = (id: string, layout: unknown) => query(`UPDATE view SET dashboard_layout = $2::jsonb WHERE id = $1`, [id, JSON.stringify(layout)])
    const rejectsBy = (p: Promise<unknown>, ...names: string[]) =>
      assert.rejects(p, (e: { constraint?: string }) => names.includes(e.constraint ?? ''), `거부 이름이 ${names.join(' | ')} 이어야 한다`)
    await rejectsBy(setLayout(s.tableViewId, { rows: [] }), 'ck_view_dashboard_layout_owner')
    await rejectsBy(setLayout(s.dashboardId, { rows: [{ height: 'small', cells: [] }] }), 'ck_view_dashboard_layout')
    await rejectsBy(query(`UPDATE view SET type = 'table', dashboard_layout = NULL WHERE id = $1`, [s.dashboardId]), 'trg_view_dashboard_parent')
    await rejectsBy(query(`UPDATE view SET owner_kind = 'layout_tab' WHERE id = $1`, [s.dashboardId]), 'trg_view_dashboard_parent', 'ck_view_dashboard_owner')
  })
})

export type { DashboardDetail, ViewDetail }
