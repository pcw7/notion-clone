/**
 * 행 페이지 — 잔여 묶음 8f-1 (F-16-07 · F-16-03)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 데이터베이스 행만 행 페이지다 — 보통 페이지 · 템플릿 · 휴지통의 행은 아니다
 *   ② 속성 묶음은 뷰가 아니라 **스키마 순서**이고 모두 보인다 — 뷰에서 숨기거나 옮긴 것이 따라오지 않는다
 *   ③ 표의 이름 · 뷰 · 제목 속성 — 소스가 여럿이면 그 행의 소스
 *   ④ 고칠 수 있는지는 데이터베이스의 것이다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createPage } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addDataSource } from './data-source.ts'
import { addProperty, moveProperty } from './property.ts'
import { createRow, trashRow } from './row.ts'
import { createTemplate } from './template.ts'
import { moveViewColumn, setViewColumn } from './view.ts'
import { readRowPage } from './row-page.ts'

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
  other = await joinAs(fx.workspaceId, await createUser('행 페이지의 다른 멤버'), 'member')
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

/** 표 하나 · 속성 A(숫자) · B(선택) · 행 하나. */
const seeded = async (name = '업무') => {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const schema = unwrap(await addProperty(fx.owner.ctx, created.dataSourceId, { name: 'A', type: 'number' }))
  const withB = unwrap(await addProperty(fx.owner.ctx, created.dataSourceId, { name: 'B', type: 'select', expectedVersion: schema.schemaVersion }))
  const id = (n: string) => withB.properties.find((p) => p.name === n)!.id
  const row = unwrap(await createRow(fx.owner.ctx, created.dataSourceId, {
    cells: [{ propertyId: id('이름'), value: { type: 'title', title: [textRun('첫 일')] } }],
  }))
  return { databaseId: created.id, dataSourceId: created.dataSourceId, viewId: created.defaultViewId, rowId: row.id, id }
}

describe('① 무엇이 행 페이지인가', () => {
  test('★ 데이터베이스 행은 행 페이지 — 보통 페이지 · 템플릿 · 휴지통의 행은 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const page = await createPage(fx.owner.ctx, { title: [textRun('보통 페이지')] })
    const template = unwrap(await createTemplate(fx.owner.ctx, db.dataSourceId, { title: '템플릿' }))

    const rowPage = await readRowPage(fx.owner.ctx, db.rowId)
    assert.ok(rowPage !== null, '행인데 행 페이지가 아니다')
    assert.equal(rowPage.databaseId, db.databaseId)
    assert.equal(rowPage.dataSourceId, db.dataSourceId)
    assert.equal(rowPage.row.title, '첫 일')
    assert.equal(await readRowPage(fx.owner.ctx, page.id), null, '보통 페이지가 행 페이지로 읽혔다')
    assert.equal(await readRowPage(fx.owner.ctx, template.id), null, '템플릿이 행 페이지로 읽혔다(템플릿은 템플릿 화면이다)')

    unwrap(await trashRow(fx.owner.ctx, db.rowId))
    assert.equal(await readRowPage(fx.owner.ctx, db.rowId), null, '휴지통의 행이 행 페이지로 읽혔다')
  })
})

describe('② 속성 묶음', () => {
  test('★ 뷰가 아니라 스키마 순서이고 모두 보인다 — 뷰에서 숨기고 옮긴 것이 따라오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    // 스키마 순서를 이름 · B · A 로 — 이름순(한국어 정렬은 한글이 먼저라 이름 · A · B)과도, 뷰 순서와도 다르게.
    unwrap(await moveProperty(fx.owner.ctx, db.dataSourceId, db.id('B'), db.id('A')))
    unwrap(await setViewColumn(fx.owner.ctx, db.viewId, db.id('A'), { visible: false }))
    unwrap(await moveViewColumn(fx.owner.ctx, db.viewId, db.id('A'), db.id('이름')))

    const rowPage = await readRowPage(fx.owner.ctx, db.rowId)
    assert.ok(rowPage !== null)
    assert.deepEqual(rowPage.columns.map((c) => [c.name, c.visible]), [['이름', true], ['B', true], ['A', true]])
    assert.equal(rowPage.titlePropertyId, db.id('이름'))
  })
})

describe('③ 표의 이름 · 뷰', () => {
  test('소스가 하나면 데이터베이스 이름 · 여럿이면 그 행의 소스 이름과 그 소스의 첫 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded('CRM')
    const first = await readRowPage(fx.owner.ctx, db.rowId)
    assert.equal(first?.tableName, 'CRM')
    assert.equal(first?.viewId, db.viewId)

    const added = unwrap(await addDataSource(fx.owner.ctx, db.databaseId, { name: '회사' }))
    const companyRow = unwrap(await createRow(fx.owner.ctx, added.dataSource.id))
    const company = await readRowPage(fx.owner.ctx, companyRow.id)
    assert.equal(company?.tableName, '회사')
    assert.equal(company?.viewId, added.viewId, '그 소스의 첫 뷰가 아니다')
    assert.equal(company?.dataSourceId, added.dataSource.id)
    assert.equal((await readRowPage(fx.owner.ctx, db.rowId))?.tableName, 'CRM', '첫째 소스는 데이터베이스 이름을 받았다(8e-1)')
  })
})

describe('④ 고칠 수 있는지는 데이터베이스의 것', () => {
  test('볼 수만 있는 사람 — 행 페이지는 읽고 셀은 못 고친다 · 못 보면 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    assert.equal((await stopInheriting(fx.owner.ctx, db.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, db.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal(await readRowPage(other.ctx, db.rowId), null, '볼 수 없는 데이터베이스의 행이 읽혔다')

    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: other.userId }, 'view')).ok, true)
    const viewer = await readRowPage(other.ctx, db.rowId)
    assert.ok(viewer !== null)
    assert.equal(viewer.access.canEditContent, false)
    assert.equal((await readRowPage(fx.owner.ctx, db.rowId))?.access.canEditContent, true)
  })
})
