/**
 * 데이터베이스 하나에 data source 여럿 — 잔여 묶음 8e-1 (F-04-23)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 더하면 끝에 붙고, 제목 속성 · 소유 부착 행 · 표 뷰 하나가 함께 생긴다
 *   ② 둘째를 더하는 순간 첫째가 데이터베이스의 지금 이름을 받는다(하나일 때는 그 이름이 화면에 없다)
 *   ③ 뷰는 **자기** data source 의 스키마로 검사되고, 만들 때 data source 를 고른다
 *   ④ data source 의 마지막 뷰는 지울 수 없다 — 데이터베이스에 뷰가 더 있어도
 *   ⑤ 권한은 데이터베이스의 것 — 못 보면 없는 것, 볼 수만 있으면 못 고친다, 잠기면 못 고친다
 *   ⑥ 이름 규칙
 *   ⑦ relation 대상 목록과 내보내기가 data source 마다 하나씩이다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase, getDatabase, listDatabases, renameDatabase } from './database.ts'
import { addDataSource, DEFAULT_DATA_SOURCE_NAME, listDataSources, renameDataSource } from './data-source.ts'
import { addProperty, getSchema } from './property.ts'
import { createView, deleteView, getView, listViews, updateView } from './view.ts'
import { createRow } from './row.ts'
import { queryRows } from './query.ts'
import { readExportSnapshot } from '../export/snapshot.ts'
import type { ExportDatabaseNode } from '../export/plan.ts'

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

const newTable = async (name = '업무') => {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  return { databaseId: created.id, dataSourceId: created.dataSourceId, viewId: created.defaultViewId }
}

const reasonOf = (r: { ok: boolean; reason?: string }): string | true => (r.ok ? true : (r.reason ?? '?'))

describe('① 더하기', () => {
  test('★ 끝에 붙고 제목 속성 · 소유 부착 행 · 표 뷰 하나가 함께 생긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '  사람   목록 ' }))
    assert.equal(added.dataSource.name, '사람 목록')
    assert.equal(added.dataSource.owned, true)

    const sources = unwrap(await listDataSources(fx.owner.ctx, table.databaseId))
    assert.deepEqual(
      sources.map((s) => s.id),
      [table.dataSourceId, added.dataSource.id],
      '더한 것이 끝에 붙지 않았다',
    )

    const schema = unwrap(await getSchema(fx.owner.ctx, added.dataSource.id))
    assert.deepEqual(schema.properties.map((p) => p.type), ['title'], 'P1 — 제목 속성이 하나 있어야 한다')

    const attachments = await withReadTransaction((tx) =>
      tx.query<{ database_id: string }>(`SELECT database_id FROM database_data_source WHERE data_source_id = $1`, [
        added.dataSource.id,
      ]),
    )
    assert.deepEqual(attachments.map((a) => a.database_id), [table.databaseId], 'DS1 — 소유 부착 행이 하나 있어야 한다')

    const view = unwrap(await getView(fx.owner.ctx, added.viewId))
    assert.equal(view.dataSourceId, added.dataSource.id)
    assert.equal(view.type, 'table')
    assert.deepEqual(view.columns.filter((c) => c.visible).map((c) => c.type), ['title'])
    const views = unwrap(await listViews(fx.owner.ctx, table.databaseId))
    assert.deepEqual(views.map((v) => [v.id, v.dataSourceId]), [
      [table.viewId, table.dataSourceId],
      [added.viewId, added.dataSource.id],
    ])
  })

  test('이름 없이 더하면 기본 이름이다 · 셋째도 끝에 붙는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const second = unwrap(await addDataSource(fx.owner.ctx, table.databaseId))
    const third = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '셋째' }))
    assert.equal(second.dataSource.name, DEFAULT_DATA_SOURCE_NAME)
    const sources = unwrap(await listDataSources(fx.owner.ctx, table.databaseId))
    assert.deepEqual(sources.map((s) => s.id), [table.dataSourceId, second.dataSource.id, third.dataSource.id])
  })

  test('더하기 · 이름 바꾸기는 데이터베이스의 마지막 편집을 남긴다 — 같은 이름이면 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const edited = () =>
      withReadTransaction((tx) =>
        tx.queryOne<{ by: string; version: string }>(`SELECT last_edited_by AS by, version::text FROM block WHERE id = $1`, [
          table.databaseId,
        ]),
      )
    const before = await edited()
    const added = unwrap(await addDataSource(other.ctx, table.databaseId, { name: '둘째' }))
    const afterAdd = await edited()
    assert.equal(afterAdd.by, other.userId)
    assert.equal(Number(afterAdd.version), Number(before.version) + 1)

    unwrap(await renameDataSource(fx.owner.ctx, added.dataSource.id, '둘째 고침'))
    const afterRename = await edited()
    assert.equal(afterRename.by, fx.owner.userId)
    assert.equal(Number(afterRename.version), Number(afterAdd.version) + 1)

    unwrap(await renameDataSource(other.ctx, added.dataSource.id, '둘째 고침'))
    assert.deepEqual(await edited(), afterRename, '같은 이름인데 썼다')
  })

  test('행은 자기 data source 에만 있다 — 소스마다 행 집합이 따로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    const row = unwrap(await createRow(fx.owner.ctx, added.dataSource.id))
    const first = await queryRows(fx.owner.ctx, table.dataSourceId)
    const second = await queryRows(fx.owner.ctx, added.dataSource.id)
    assert.ok(first.ok && second.ok)
    assert.deepEqual(first.value.rows.map((r) => r.id), [])
    assert.deepEqual(second.value.rows.map((r) => r.id), [row.id])
  })
})

describe('② 둘째를 더하는 순간 첫째가 데이터베이스 이름을 받는다', () => {
  test('★ 데이터베이스 이름을 바꾼 뒤에 더해도 첫째는 지금 이름이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('옛 이름')
    unwrap(await renameDatabase(fx.owner.ctx, table.databaseId, '새 이름'))
    unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    const sources = unwrap(await listDataSources(fx.owner.ctx, table.databaseId))
    assert.deepEqual(sources.map((s) => s.name), ['새 이름', '둘째'])
  })

  test('데이터베이스 이름이 비었으면 첫째는 제 이름 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('')
    unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    const sources = unwrap(await listDataSources(fx.owner.ctx, table.databaseId))
    assert.deepEqual(sources.map((s) => s.name), ['표', '둘째'])
  })

  test('셋째를 더할 때는 첫째의 이름을 건드리지 않는다 — 이미 보이는 이름이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('업무')
    unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    unwrap(await renameDataSource(fx.owner.ctx, table.dataSourceId, '할 일'))
    unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '셋째' }))
    const sources = unwrap(await listDataSources(fx.owner.ctx, table.databaseId))
    assert.deepEqual(sources.map((s) => s.name), ['할 일', '둘째', '셋째'])
  })
})

describe('③ 뷰는 자기 data source 를 본다', () => {
  test('★ 필터 · 정렬은 그 뷰의 data source 스키마로 검사된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    const onSecond = unwrap(await addProperty(fx.owner.ctx, added.dataSource.id, { name: '점수', type: 'number' }))
    const scoreId = onSecond.properties.find((p) => p.name === '점수')!.id

    const sorted = await updateView(fx.owner.ctx, added.viewId, { sorts: [{ property_id: scoreId, direction: 'desc' }] })
    assert.equal(reasonOf(sorted), true, '둘째 소스의 뷰가 제 속성으로 정렬하지 못했다')
    const wrong = await updateView(fx.owner.ctx, table.viewId, { sorts: [{ property_id: scoreId, direction: 'desc' }] })
    assert.equal(reasonOf(wrong), 'invalid_sorts', '첫째 소스의 뷰가 남의 속성으로 정렬됐다')
  })

  test('★ 뷰를 만들 때 data source 를 고른다 — 그 소스의 속성으로 시딩된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    unwrap(await addProperty(fx.owner.ctx, added.dataSource.id, { name: '둘째만', type: 'number' }))

    const view = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '둘째 보드', dataSourceId: added.dataSource.id }))
    assert.equal(view.dataSourceId, added.dataSource.id)
    assert.deepEqual(view.columns.map((c) => c.name), ['이름', '둘째만'])

    const plain = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '기본' }))
    assert.equal(plain.dataSourceId, table.dataSourceId, '고르지 않으면 부착 순서의 첫째다')
  })

  test('다른 데이터베이스의 data source 로는 뷰를 만들 수 없다 — not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const elsewhere = await newTable('다른 표')
    const r = await createView(fx.owner.ctx, table.databaseId, { dataSourceId: elsewhere.dataSourceId })
    assert.equal(reasonOf(r), 'not_found')
    const missing = await createView(fx.owner.ctx, table.databaseId, { dataSourceId: randomUUID() })
    assert.equal(reasonOf(missing), 'not_found')
  })
})

describe('④ data source 의 마지막 뷰', () => {
  test('★ 데이터베이스에 뷰가 더 있어도 그 소스의 마지막 뷰는 지울 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    assert.equal(reasonOf(await deleteView(fx.owner.ctx, added.viewId)), 'last_view')
    assert.equal(reasonOf(await deleteView(fx.owner.ctx, table.viewId)), 'last_view')

    const extra = unwrap(await createView(fx.owner.ctx, table.databaseId, { dataSourceId: added.dataSource.id }))
    assert.equal(reasonOf(await deleteView(fx.owner.ctx, added.viewId)), true, '소스에 뷰가 둘이면 하나는 지울 수 있다')
    assert.equal(reasonOf(await deleteView(fx.owner.ctx, extra.id)), 'last_view')
  })
})

describe('⑤ 권한은 데이터베이스의 것', () => {
  const makePrivate = async (databaseId: string, level?: 'view' | 'edit') => {
    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    if (level !== undefined) {
      assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok, true)
    }
  }

  test('★ 못 보는 사람에게는 data source 가 있다는 것도 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await makePrivate(table.databaseId)
    assert.equal(reasonOf(await listDataSources(other.ctx, table.databaseId)), 'not_found')
    assert.equal(reasonOf(await addDataSource(other.ctx, table.databaseId)), 'not_found')
    assert.equal(reasonOf(await renameDataSource(other.ctx, table.dataSourceId, '몰래')), 'not_found')
  })

  test('★ 볼 수만 있으면 목록은 읽고 더하기 · 이름 바꾸기는 못 한다 (edit_structure)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await makePrivate(table.databaseId, 'view')
    assert.equal(unwrap(await listDataSources(other.ctx, table.databaseId)).length, 1)
    assert.equal(reasonOf(await addDataSource(other.ctx, table.databaseId)), 'forbidden')
    assert.equal(reasonOf(await renameDataSource(other.ctx, table.dataSourceId, '몰래')), 'forbidden')
    assert.equal(unwrap(await listDataSources(fx.owner.ctx, table.databaseId)).length, 1, '거부했는데 소스가 생겼다')
  })

  test('★ 잠긴 데이터베이스에는 더하지도 이름을 바꾸지도 못한다 (7f-2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    unwrap(await setDatabaseLock(fx.owner.ctx, table.databaseId, true))
    assert.equal(reasonOf(await addDataSource(fx.owner.ctx, table.databaseId)), 'locked')
    assert.equal(reasonOf(await renameDataSource(fx.owner.ctx, table.dataSourceId, '잠김')), 'locked')
    unwrap(await setDatabaseLock(fx.owner.ctx, table.databaseId, false))
    assert.equal(reasonOf(await addDataSource(fx.owner.ctx, table.databaseId)), true)
  })
})

describe('⑥ 이름', () => {
  test('공백을 접고, 비었거나 글자가 아니면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    assert.deepEqual(unwrap(await renameDataSource(fx.owner.ctx, table.dataSourceId, '  고객   명단 ')), {
      id: table.dataSourceId,
      name: '고객 명단',
    })
    assert.equal(reasonOf(await renameDataSource(fx.owner.ctx, table.dataSourceId, '   ')), 'invalid_name')
    assert.equal(reasonOf(await renameDataSource(fx.owner.ctx, table.dataSourceId, 3)), 'invalid_name')
    assert.equal(reasonOf(await addDataSource(fx.owner.ctx, table.databaseId, { name: '' })), 'invalid_name')
    assert.equal(reasonOf(await renameDataSource(fx.owner.ctx, randomUUID(), '없음')), 'not_found')
    const sources = unwrap(await listDataSources(fx.owner.ctx, table.databaseId))
    assert.deepEqual(sources.map((s) => s.name), ['고객 명단'])
  })

  test('getDatabase 가 data source 들을 부착 순서로 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('목록')
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '둘째' }))
    const got = unwrap(await getDatabase(fx.owner.ctx, table.databaseId))
    assert.deepEqual(got.dataSources.map((s) => [s.id, s.name, s.owned]), [
      [table.dataSourceId, '목록', true],
      [added.dataSource.id, '둘째', true],
    ])
  })
})

describe('⑦ data source 마다 하나씩', () => {
  test('★ relation 대상 목록 — 소스가 여럿이면 소스마다 항목이고 이름으로 가른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const single = await newTable(`하나뿐 ${randomUUID().slice(0, 6)}`)
    const multi = await newTable(`여럿 ${randomUUID().slice(0, 6)}`)
    const added = unwrap(await addDataSource(fx.owner.ctx, multi.databaseId, { name: '둘째' }))

    const all = await listDatabases(fx.owner.ctx)
    const ofSingle = all.filter((d) => d.id === single.databaseId)
    const ofMulti = all.filter((d) => d.id === multi.databaseId)
    assert.deepEqual(ofSingle.map((d) => [d.dataSourceId, d.sourceName]), [[single.dataSourceId, null]])
    assert.deepEqual(ofMulti.map((d) => [d.dataSourceId, d.sourceName]), [
      [multi.dataSourceId, ofMulti[0]?.sourceName ?? '?'],
      [added.dataSource.id, '둘째'],
    ])
    assert.notEqual(ofMulti[0]?.sourceName, null, '소스가 여럿인데 첫째의 이름을 싣지 않았다')
  })

  test('★ 내보내기 — 데이터베이스 노드가 소스마다 표를 갖고 행은 자기 소스에 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('CRM 내보내기')
    const added = unwrap(await addDataSource(fx.owner.ctx, table.databaseId, { name: '회사' }))
    const titleOf = async (dataSourceId: string) =>
      unwrap(await getSchema(fx.owner.ctx, dataSourceId)).properties.find((p) => p.type === 'title')!.id
    const person = unwrap(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: await titleOf(table.dataSourceId), value: { type: 'title', title: [textRun('사람 행')] } }],
      }),
    )
    const company = unwrap(
      await createRow(fx.owner.ctx, added.dataSource.id, {
        cells: [{ propertyId: await titleOf(added.dataSource.id), value: { type: 'title', title: [textRun('회사 행')] } }],
      }),
    )

    const snapshot = unwrap(await readExportSnapshot(fx.owner.ctx, { kind: 'page', rootId: table.databaseId }))
    const node = snapshot.nodes.get(table.databaseId) as ExportDatabaseNode
    assert.equal(node.kind, 'database')
    assert.deepEqual(
      node.sources.map((s) => [s.id, s.name, s.rowIds]),
      [
        [table.dataSourceId, 'CRM 내보내기', [person.id]],
        [added.dataSource.id, '회사', [company.id]],
      ],
      '둘째 소스의 행이 내보내기에서 빠졌거나 섞였다',
    )
  })
})
