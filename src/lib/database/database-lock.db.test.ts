/**
 * 데이터베이스 잠금 · 행 페이지의 셀 — Teamspace · 게스트 · 그룹 7f-2조각 (F-06-16 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 데이터베이스를 잠그면 구조가 막힌다 — 속성(더하기 · 이름 · 지우기 · 옵션) · 뷰(만들기 · 설정 · 컬럼 · 지우기) · 템플릿
 *      (만들기 · 지우기) · 이름. 아무것도 바뀌지 않는다
 *   ② ★ 행과 값은 막지 않는다 — 행 만들기 · 셀 · 템플릿으로 만들기 · 템플릿의 셀 · 연결 · 행 휴지통 · 행 페이지 본문
 *   ③ 양방향 relation 은 대상 표의 스키마도 바꾼다 — 대상이 잠겼으면 거부 · 단방향은 된다
 *   ④ 누가 잠그나 — 구조를 고칠 수 있는 사람만(볼 수만 있으면 forbidden · 못 보면 not_found) · 화면 상태
 *   ⑤ ★ 행 페이지를 잠그면 그 행의 셀 · 연결 칸이 막힌다 — 거울상은 따라간다 · 다른 행은 그대로 · 데이터베이스 구조도 그대로
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { pageAccess } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { grantAccess } from '../permissions/acl.ts'
import { databaseLockState, setDatabaseLock, setPageLock } from '../permissions/lock.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { createDatabase, renameDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema, updateProperty } from './property.ts'
import { addRelationProperty, linkRows } from './relation.ts'
import { createRow, trashRow, updateCells, type RowCell } from './row.ts'
import { createRowFromTemplate, createTemplate, deleteTemplate } from './template.ts'
import { createView, deleteView, setViewColumn, updateView } from './view.ts'

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

// ── 도우미 ────────────────────────────────────────────────────────────

type Table = { databaseId: string; dataSourceId: string; viewId: string; titleId: string; selectId: string }

function ok<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  assert.equal(r.ok, true, r.ok ? '' : `실패: ${r.reason}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

async function newTable(name: string, options: { privateTop?: true } = {}): Promise<Table> {
  const created = ok(await createDatabase(fx.owner.ctx, { name, ...options }))
  ok(await addProperty(fx.owner.ctx, created.dataSourceId, { name: '상태', type: 'select' }))
  const schema = ok(await getSchema(fx.owner.ctx, created.dataSourceId))
  return {
    databaseId: created.id,
    dataSourceId: created.dataSourceId,
    viewId: created.defaultViewId as string,
    titleId: schema.properties.find((p) => p.type === 'title')!.id,
    selectId: schema.properties.find((p) => p.name === '상태')!.id,
  }
}

const titled = (table: Table, text: string): RowCell[] => [
  { propertyId: table.titleId, value: { type: 'title', title: [textRun(text)] } } as RowCell,
]

const shape = async (table: Table) => {
  const props = await query<{ id: string; name: string; deleted: boolean }>(
    `SELECT id, name, deleted_at IS NOT NULL AS deleted FROM property WHERE data_source_id = $1 ORDER BY id`,
    [table.dataSourceId],
  )
  const views = await query<{ id: string; name: string }>(`SELECT id, name FROM view WHERE database_id = $1 ORDER BY id`, [
    table.databaseId,
  ])
  const title = await query<{ title: unknown }>(`SELECT properties->'title' AS title FROM block WHERE id = $1`, [table.databaseId])
  return JSON.stringify({ props, views, title })
}

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 데이터베이스를 잠그면 구조가 막힌다', () => {
  test('★ 속성 · 뷰 · 템플릿 · 이름 — 전부 locked 이고 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('잠글 표')
    const second = ok(await createView(fx.owner.ctx, table.databaseId, { name: '둘째 뷰' }))
    const template = ok(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '있던 템플릿' }))
    assert.deepEqual(await setDatabaseLock(fx.owner.ctx, table.databaseId, true), { ok: true, value: { changed: true } })
    const before = await shape(table)
    const locked = { ok: false, reason: 'locked' }
    const c = fx.owner.ctx

    assert.deepEqual(await addProperty(c, table.dataSourceId, { name: '새 속성', type: 'number' }), locked)
    assert.deepEqual(await updateProperty(c, table.dataSourceId, table.selectId, { name: '바꾼 이름' }), locked)
    assert.deepEqual(await deleteProperty(c, table.dataSourceId, table.selectId), locked)
    assert.deepEqual(await addSelectOption(c, table.dataSourceId, table.selectId, { name: '새 옵션' }), locked)
    assert.deepEqual(await createView(c, table.databaseId, { name: '셋째 뷰' }), locked)
    assert.deepEqual(await updateView(c, second.id, { name: '바꾼 뷰' }), locked)
    assert.deepEqual(await setViewColumn(c, table.viewId, table.selectId, { width: 240 }), locked)
    assert.deepEqual(await deleteView(c, second.id), locked)
    assert.deepEqual(await createTemplate(c, table.dataSourceId, { title: '새 템플릿' }), locked)
    assert.deepEqual(await deleteTemplate(c, template.id), locked)
    assert.deepEqual(await renameDatabase(c, table.databaseId, '바꾼 표'), locked)
    assert.equal(await shape(table), before, '잠겼는데 구조가 바뀌었다')

    assert.ok((await setDatabaseLock(c, table.databaseId, false)).ok)
    assert.equal((await renameDatabase(c, table.databaseId, '풀고 바꾼 표')).ok, true, '풀었는데 구조를 못 고친다')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 행과 값은 막지 않는다', () => {
  test('★ 행 만들기 · 셀 · 템플릿으로 만들기 · 템플릿의 셀 · 연결 · 행 휴지통 · 행 페이지 본문', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('행은 그대로')
    const rel = ok(
      await addRelationProperty(fx.owner.ctx, table.dataSourceId, { name: '같은 표 연결', targetDataSourceId: table.dataSourceId }),
    )
    const template = ok(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '템플릿' }))
    ok(await setDatabaseLock(fx.owner.ctx, table.databaseId, true))
    const c = fx.owner.ctx

    const row = ok(await createRow(c, table.dataSourceId))
    const other = ok(await createRow(c, table.dataSourceId))
    assert.equal((await updateCells(c, row.id, { cells: titled(table, '잠긴 표의 행') })).ok, true)
    assert.equal((await createRowFromTemplate(c, table.dataSourceId, template.id)).ok, true)
    assert.equal((await updateCells(c, template.id, { cells: titled(table, '템플릿의 셀') })).ok, true, '템플릿의 내용은 행의 길이다')
    assert.equal((await linkRows(c, row.id, rel.propertyId, { add: [other.id] })).ok, true)
    assert.equal(await pageAccess(c, row.id), 'edit', '데이터베이스 잠금이 행 페이지로 상속됐다')
    assert.equal((await trashRow(c, other.id)).ok, true)
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 양방향 relation', () => {
  test('대상 표의 스키마도 바꾸므로 대상이 잠겼으면 거부 · 단방향은 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable('작업')
    const projects = await newTable('프로젝트')
    ok(await setDatabaseLock(fx.owner.ctx, projects.databaseId, true))
    const before = await shape(projects)

    assert.deepEqual(
      await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
        name: '프로젝트',
        targetDataSourceId: projects.dataSourceId,
        twoWay: { name: '작업들' },
      }),
      { ok: false, reason: 'locked' },
    )
    assert.equal(await shape(projects), before, '잠긴 대상 표에 역방향 속성이 생겼다')
    assert.equal(
      (await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '프로젝트', targetDataSourceId: projects.dataSourceId })).ok,
      true,
      '단방향은 대상의 스키마를 바꾸지 않는다',
    )
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 누가 잠그나', () => {
  test('구조를 고칠 수 있는 사람만 — 볼 수만 있으면 forbidden · 못 보면 not_found · 화면 상태', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('개인 표', { privateTop: true })
    const viewer = await joinAs(fx.workspaceId, await createUser('보기만'), 'member')
    const stranger = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: viewer.userId }, 'view')).ok)

    assert.deepEqual(await setDatabaseLock(viewer.ctx, table.databaseId, true), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setDatabaseLock(stranger.ctx, table.databaseId, true), { ok: false, reason: 'not_found' })
    assert.equal((await query(`SELECT 1 FROM node_lock WHERE node_id = $1`, [table.databaseId])).length, 0)

    ok(await setDatabaseLock(fx.owner.ctx, table.databaseId, true))
    const row = await query<{ kind: string }>(`SELECT kind FROM node_lock WHERE node_id = $1`, [table.databaseId])
    assert.deepEqual(row, [{ kind: 'database' }])
    assert.deepEqual(await databaseLockState(viewer.ctx, table.databaseId), { locked: true, canToggle: false })
    assert.deepEqual(await databaseLockState(fx.owner.ctx, table.databaseId), { locked: true, canToggle: true })
    assert.equal(await databaseLockState(stranger.ctx, table.databaseId), null)
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 행 페이지를 잠그면', () => {
  test('★ 그 행의 셀 · 연결 칸이 막힌다 — 거울상은 따라간다 · 다른 행은 그대로 · 데이터베이스 구조도 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable('작업들')
    const projects = await newTable('프로젝트들')
    const rel = ok(
      await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, {
        name: '프로젝트',
        targetDataSourceId: projects.dataSourceId,
        twoWay: { name: '작업' },
      }),
    )
    const c = fx.owner.ctx
    const task = ok(await createRow(c, tasks.dataSourceId))
    const otherTask = ok(await createRow(c, tasks.dataSourceId))
    const project = ok(await createRow(c, projects.dataSourceId))
    assert.deepEqual(await setPageLock(c, task.id, true), { ok: true, value: { changed: true } })

    assert.deepEqual(await updateCells(c, task.id, { cells: titled(tasks, '잠긴 행의 제목') }), { ok: false, reason: 'locked' })
    assert.deepEqual(await linkRows(c, task.id, rel.propertyId, { add: [project.id] }), { ok: false, reason: 'locked' })
    assert.equal((await updateCells(c, otherTask.id, { cells: titled(tasks, '다른 행') })).ok, true, '다른 행까지 막혔다')

    // 거울상 — 프로젝트 쪽에서 잠긴 작업을 연결하면 작업 쪽의 역방향 칸이 따라 바뀐다(대상 행을 고치는 것이 아니다).
    assert.equal((await linkRows(c, project.id, rel.syncedPropertyId as string, { add: [task.id] })).ok, true)
    const mirror = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relation_edge WHERE from_page_id = $1 AND to_page_id = $2`,
      [task.id, project.id],
    )
    assert.equal(mirror[0]?.n, 1, '거울상이 따라가지 않았다')

    assert.equal((await addProperty(c, tasks.dataSourceId, { name: '행이 잠겨도', type: 'number' })).ok, true, '행 잠금이 구조를 막았다')
    assert.equal((await trashRow(c, task.id)).ok, true, '행 휴지통은 트리 연산이다')
  })
})
