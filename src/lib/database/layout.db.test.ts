/**
 * 행의 레이아웃 — 잔여 묶음 8f-2 (F-16-03 · F-16-07)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 머리는 lazy 다 — 처음에는 표에 아무것도 없고(version '0'), 처음 벗어날 때 한 벌(머리 · content 탭 · heading · 그룹)이 생긴다
 *   ② **sparse** — 다시 보이면 숨김 행이 지워진다 · 바뀐 것이 없으면 아무것도 쓰지 않는다(version 도 · 머리도)
 *   ③ 순서는 스키마 순서다 — 적용이 `property.order_idx` 를 고친다(옮긴 것만 · `schema_version` 오름)
 *   ④ 낙관적 잠금 — 낡은 version 은 거부되고 아무것도 바뀌지 않는다
 *   ⑤ 누가 — 구조를 고칠 수 있는 사람만(`edit_structure`) · 잠긴 데이터베이스 · 휴지통의 소스는 막힌다
 *   ⑥ 제목은 숨길 수 없다 · 모르는 id 는 건너뛴다 · 새 속성은 보인다(M6) · 지운 속성의 숨김은 되살리면 돌아온다
 *   ⑦ 행 페이지가 숨김을 읽는다 — 소스마다 따로 · 데이터베이스가 잠기면 구조를 닫는다
 *   ⑧ 제목 아래 고정(3a-1 · F-16-02) — heading 의 property 행 · 자기 순서 · 풀면 행이 지워진다 · 주지 않으면 그대로 · 숨김과 겹치지 않는다
 *      · 제목은 고정하지 않는다 · 15개까지 · 속성을 지우면 풀린다(되살려도 속성 묶음으로) · 행 페이지가 읽는다
 *
 *   ⑨ 페이지 설정(3b-1 · F-16-09 · F-16-10) — 머리가 없으면 기본값 · 처음 벗어나면 머리가 생긴다 · 준 칸만 바꾼다 · 같으면 쓰지 않는다 ·
 *      숨김 · 고정과 함께 보내도 서로 건드리지 않는다 · 행 페이지가 읽는다
 *
 * 반사실(HANDOFF §3.3): 고정을 다시 쓰지 않으면 ⑧ 의 순서가, 상한을 세지 않으면 16개가, 숨김과 겹침을 안 보면 겹침이 실패한다.
 *   ⑩ 본문 모듈 · 상세 패널(3c-1 · F-16-04 · F-16-05) — 올리면 부모 없는 행 · 속성 묶음과 한 줄에서 순서 · 내리면 행이 지워진다 ·
 *      관계형은 패널에 못 놓는다 · 한 속성은 한 자리(겹치면 거부 · 주지 않은 목록에서는 빠진다) · 속성 묶음은 줄에 꼭 하나 ·
 *      지운 속성의 모듈은 남아 되살리면 돌아온다 · 행 페이지가 읽는다
 *
 * 설정을 바뀐 것으로 세지 않으면 ⑨ 의 머리가, 지금 것과 합치지 않으면 ⑨ 의 부분 적용이 실패한다.
 * 다른 목록이 가져간 속성을 빼지 않으면 ⑩ 의 옮기기가, 패널 유형을 안 보면 ⑩ 의 관계형이 실패한다.
 *   ⑪ 직전 버전(3e-1 · F-16-12) — 바뀐 적용이 적용 전을 남긴다(한 단계 · 바뀐 것이 없으면 그대로) · 되돌리면 그 레이아웃이 새 버전으로
 *      돌아오고(스키마 순서 · 자리 · 설정) 기록이 지워진다 · 낡은 버전은 거부 · 읽기는 볼 수 있으면 · 되돌리기는 구조의 문
 * 기록을 남기지 않으면 ⑪ 의 되돌리기가, 기록을 지우지 않으면 ⑪ 의 두 번째 되돌리기가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addDataSource, trashDataSource } from './data-source.ts'
import { addProperty, deleteProperty, getSchema, restoreProperty } from './property.ts'
import { createRow } from './row.ts'
import { addRelationProperty } from './relation.ts'
import { applyRecordLayout, getRecordLayout, readRecordLayout, undoRecordLayout } from './layout.ts'
import { MAX_PINNED_PROPERTIES } from './limits.ts'
import { DEFAULT_PAGE_SETTINGS } from './page-settings.ts'
import { GROUP_MODULE } from './layout-modules.ts'
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
  other = await joinAs(fx.workspaceId, await createUser('레이아웃의 다른 멤버'), 'member')
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

/** 표 하나 · 속성 A · B · C(숫자) · 행 하나. 스키마 순서는 이름 · A · B · C. */
const seeded = async () => {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: '업무' }))
  for (const name of ['A', 'B', 'C']) unwrap(await addProperty(fx.owner.ctx, created.dataSourceId, { name, type: 'number' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, created.dataSourceId))
  const id = (n: string) => schema.properties.find((p) => p.name === n)!.id
  const row = unwrap(await createRow(fx.owner.ctx, created.dataSourceId, {
    cells: [{ propertyId: id('이름'), value: { type: 'title', title: [textRun('첫 일')] } }],
  }))
  return { databaseId: created.id, dataSourceId: created.dataSourceId, rowId: row.id, id }
}

const layoutOf = (dataSourceId: string) => withReadTransaction((tx) => readRecordLayout(tx, dataSourceId))

/** 이 소스의 레이아웃 표 — 종류별 행 수. */
const tables = async (dataSourceId: string) => {
  const rows = await query<{ heads: number; tabs: number; headings: number; groups: number; props: number }>(
    `SELECT (SELECT count(*)::int FROM page_layout WHERE data_source_id = $1) AS heads,
            (SELECT count(*)::int FROM layout_tab WHERE data_source_id = $1) AS tabs,
            (SELECT count(*)::int FROM layout_module WHERE data_source_id = $1 AND kind = 'heading') AS headings,
            (SELECT count(*)::int FROM layout_module WHERE data_source_id = $1 AND kind = 'property_group') AS groups,
            (SELECT count(*)::int FROM layout_module WHERE data_source_id = $1 AND kind = 'property') AS props`,
    [dataSourceId],
  )
  return rows[0]!
}

const schemaOrder = async (dataSourceId: string) => unwrap(await getSchema(fx.owner.ctx, dataSourceId)).properties.map((p) => p.name)

describe('① 머리는 lazy 다', () => {
  test('★ 처음에는 표에 아무것도 없고 기본(version 0 · 모두 보임)이다 — 처음 숨길 때 한 벌이 생긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    assert.deepEqual(await layoutOf(db.dataSourceId), { version: '0', settings: DEFAULT_PAGE_SETTINGS, hidden: [], pinned: [], main: [GROUP_MODULE], panel: [] })
    assert.deepEqual(await tables(db.dataSourceId), { heads: 0, tabs: 0, headings: 0, groups: 0, props: 0 })

    const applied = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('B')] }))
    assert.equal(applied.changed, true)
    assert.deepEqual(applied.layout, { version: '1', settings: DEFAULT_PAGE_SETTINGS, hidden: [db.id('B')], pinned: [], main: [GROUP_MODULE], panel: [] })
    assert.deepEqual(await tables(db.dataSourceId), { heads: 1, tabs: 1, headings: 1, groups: 1, props: 1 })
    const rows = await query<{ visible: boolean; order_idx: string | null; parent_kind: string; area: string }>(
      `SELECT m.visible, m.order_idx, g.kind AS parent_kind, m.area
         FROM layout_module m JOIN layout_module g ON g.id = m.parent_module_id
        WHERE m.data_source_id = $1 AND m.kind = 'property'`,
      [db.dataSourceId],
    )
    assert.deepEqual(rows, [{ visible: false, order_idx: null, parent_kind: 'property_group', area: 'main' }], '숨김 행의 모양이 정본과 다르다')
  })
})

describe('② sparse', () => {
  test('★ 다시 보이면 숨김 행이 지워진다 — 한 벌은 남고 version 은 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('A'), db.id('C')] }))
    const shown = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [db.id('C')] }))
    assert.deepEqual(shown.layout, { version: '2', settings: DEFAULT_PAGE_SETTINGS, hidden: [db.id('C')], pinned: [], main: [GROUP_MODULE], panel: [] })
    assert.deepEqual(await tables(db.dataSourceId), { heads: 1, tabs: 1, headings: 1, groups: 1, props: 1 })

    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [] }))
    assert.equal((await tables(db.dataSourceId)).props, 0, '모두 보이는데 property 행이 남았다')
  })

  test('★ 바뀐 것이 없으면 아무것도 쓰지 않는다 — 머리도 만들지 않고 version 도 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const same = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0',
      order: [db.id('A'), db.id('B'), db.id('C')],
      hidden: [],
    }))
    assert.deepEqual(same, { layout: { version: '0', settings: DEFAULT_PAGE_SETTINGS, hidden: [], pinned: [], main: [GROUP_MODULE], panel: [] }, changed: false })
    assert.equal((await tables(db.dataSourceId)).heads, 0, '바뀐 것이 없는데 머리가 생겼다')

    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('A')] }))
    const again = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [db.id('A')] }))
    assert.deepEqual(again, { layout: { version: '1', settings: DEFAULT_PAGE_SETTINGS, hidden: [db.id('A')], pinned: [], main: [GROUP_MODULE], panel: [] }, changed: false })
  })
})

describe('③ 순서는 스키마 순서다', () => {
  test('★ 적용이 property.order_idx 를 고친다 — 옮긴 것만 쓰고 schema_version 이 오른다 · 순서만 바꿔도 머리가 생긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const before = unwrap(await getSchema(fx.owner.ctx, db.dataSourceId))
    const keys = new Map(before.properties.map((p) => [p.id, p.orderKey]))

    const applied = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0',
      // 제목은 화면이 보내지 않는다 — 제자리다.
      order: [db.id('C'), db.id('A'), db.id('B')],
      hidden: [],
    }))
    assert.deepEqual(applied.layout, { version: '1', settings: DEFAULT_PAGE_SETTINGS, hidden: [], pinned: [], main: [GROUP_MODULE], panel: [] })
    assert.deepEqual(await schemaOrder(db.dataSourceId), ['이름', 'C', 'A', 'B'])

    const afterSchema = unwrap(await getSchema(fx.owner.ctx, db.dataSourceId))
    const rewritten = afterSchema.properties.filter((p) => p.orderKey !== keys.get(p.id)).map((p) => p.name)
    assert.deepEqual(rewritten, ['C'], '옮긴 것만 써야 한다')
    assert.notEqual(afterSchema.schemaVersion, before.schemaVersion, '스키마 순서를 고쳤는데 schema_version 이 그대로다')
  })
})

describe('④ 낙관적 잠금', () => {
  test('★ 낡은 version 은 거부되고(현재 version 과 함께) 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('A')] }))

    const stale = await applyRecordLayout(other.ctx, db.dataSourceId, {
      expectedVersion: '0',
      order: [db.id('C'), db.id('A'), db.id('B')],
      hidden: [db.id('B')],
    })
    assert.deepEqual(stale, { ok: false, reason: 'layout_conflict', currentVersion: '1' })
    assert.deepEqual(await layoutOf(db.dataSourceId), { version: '1', settings: DEFAULT_PAGE_SETTINGS, hidden: [db.id('A')], pinned: [], main: [GROUP_MODULE], panel: [] })
    assert.deepEqual(await schemaOrder(db.dataSourceId), ['이름', 'A', 'B', 'C'], '거부됐는데 순서가 바뀌었다')
  })
})

describe('⑤ 누가', () => {
  // 데이터베이스 노드에 `edit_content`(내용만)를 직접 주는 길은 아직 판정이 무시한다(effective.ts `resolveCaps` · HANDOFF §7) —
  // 구조를 못 고치는 사람은 볼 수만 있는 사람으로 세운다.
  test('★ 볼 수만 있는 사람은 forbidden · 못 보는 사람은 not_found · 고칠 수 있으면 통과', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    assert.equal((await stopInheriting(fx.owner.ctx, db.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, db.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    const input = { expectedVersion: '0', order: [], hidden: [db.id('A')] }
    assert.deepEqual(await applyRecordLayout(other.ctx, db.dataSourceId, input), { ok: false, reason: 'not_found' })

    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: other.userId }, 'view')).ok, true)
    assert.deepEqual(await applyRecordLayout(other.ctx, db.dataSourceId, input), { ok: false, reason: 'forbidden' })
    assert.equal((await readRowPage(other.ctx, db.rowId))?.access.canEditStructure, false)

    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: other.userId }, 'edit')).ok, true)
    assert.equal((await applyRecordLayout(other.ctx, db.dataSourceId, input)).ok, true, '구조를 고칠 수 있는데 막혔다')
  })

  test('★ 잠긴 데이터베이스는 locked · 행 페이지는 구조를 닫는다 · 휴지통의 소스는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const input = { expectedVersion: '0', order: [], hidden: [db.id('A')] }
    unwrap(await setDatabaseLock(fx.owner.ctx, db.databaseId, true))
    assert.deepEqual(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, input), { ok: false, reason: 'locked' })
    const locked = await readRowPage(fx.owner.ctx, db.rowId)
    assert.equal(locked?.access.canEditStructure, false, '잠긴 데이터베이스의 행 페이지가 구조를 열었다')
    assert.equal(locked?.access.canEditContent, true, '잠금은 구조만 막는다 — 셀은 그대로다')
    unwrap(await setDatabaseLock(fx.owner.ctx, db.databaseId, false))
    assert.equal((await readRowPage(fx.owner.ctx, db.rowId))?.access.canEditStructure, true)

    const added = unwrap(await addDataSource(fx.owner.ctx, db.databaseId, { name: '둘째' }))
    unwrap(await trashDataSource(fx.owner.ctx, added.dataSource.id))
    assert.deepEqual(
      await applyRecordLayout(fx.owner.ctx, added.dataSource.id, { expectedVersion: '0', order: [], hidden: [] }),
      { ok: false, reason: 'not_found' },
    )
  })
})

describe('⑥ 속성의 변화', () => {
  test('제목은 숨길 수 없다 — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    assert.deepEqual(
      await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('이름'), db.id('A')] }),
      { ok: false, reason: 'invalid_layout' },
    )
    assert.equal((await tables(db.dataSourceId)).heads, 0)
  })

  test('모르는 id 는 건너뛴다 — 그사이 지워진 속성 · 다른 소스의 속성', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const elsewhere = await seeded()
    const applied = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0',
      order: ['없는속성없는속성없는속성1', elsewhere.id('A')],
      hidden: [elsewhere.id('B'), db.id('C')],
    }))
    assert.deepEqual(applied.layout.hidden, [db.id('C')])
    assert.deepEqual(await layoutOf(elsewhere.dataSourceId), { version: '0', settings: DEFAULT_PAGE_SETTINGS, hidden: [], pinned: [], main: [GROUP_MODULE], panel: [] }, '다른 소스의 레이아웃이 생겼다')
  })

  test('★ 새 속성은 보인다(그룹은 열거하지 않는다 · M6) · 지운 속성의 숨김은 빠졌다가 되살리면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('A')] }))
    unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: 'D', type: 'number' }))
    const page = await readRowPage(fx.owner.ctx, db.rowId)
    assert.deepEqual(page?.columns.map((c) => [c.name, c.visible]), [['이름', true], ['A', false], ['B', true], ['C', true], ['D', true]])

    unwrap(await deleteProperty(fx.owner.ctx, db.dataSourceId, db.id('A')))
    assert.deepEqual((await layoutOf(db.dataSourceId)).hidden, [], '지운 속성이 숨김 목록에 남았다')
    assert.equal((await tables(db.dataSourceId)).props, 1, '지운 속성의 숨김 행은 남아야 한다 — 되살리면 돌아온다')
    unwrap(await restoreProperty(fx.owner.ctx, db.dataSourceId, db.id('A')))
    assert.deepEqual((await layoutOf(db.dataSourceId)).hidden, [db.id('A')])
  })
})

describe('⑦ 행 페이지', () => {
  test('★ 숨긴 속성은 visible: false · 순서는 스키마 순서 · 버전이 함께 온다 — 소스마다 따로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const blank = await readRowPage(fx.owner.ctx, db.rowId)
    assert.equal(blank?.layoutVersion, '0')

    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0',
      order: [db.id('C'), db.id('A'), db.id('B')],
      hidden: [db.id('A')],
    }))
    const page = await readRowPage(fx.owner.ctx, db.rowId)
    assert.equal(page?.layoutVersion, '1')
    assert.deepEqual(page?.columns.map((c) => [c.name, c.visible]), [['이름', true], ['C', true], ['A', false], ['B', true]])

    // 같은 데이터베이스의 다른 소스 — 그 소스의 레이아웃은 기본 그대로다.
    const added = unwrap(await addDataSource(fx.owner.ctx, db.databaseId, { name: '둘째' }))
    unwrap(await addProperty(fx.owner.ctx, added.dataSource.id, { name: 'A', type: 'number' }))
    const second = unwrap(await createRow(fx.owner.ctx, added.dataSource.id))
    const secondPage = await readRowPage(fx.owner.ctx, second.id)
    assert.equal(secondPage?.layoutVersion, '0')
    assert.ok(secondPage?.columns.every((c) => c.visible), '다른 소스의 행에 숨김이 섞였다')
  })
})

describe('⑧ 제목 아래 고정 (3a-1 · F-16-02)', () => {
  /** 이 소스의 고정 행 — heading 안의 순서대로 [속성, 부모가 heading 인가, 순서가 있는가, 보이는가]. */
  const pinRows = async (dataSourceId: string) =>
    (
      await query<{ property_id: string; under_heading: boolean; ordered: boolean; visible: boolean }>(
        `SELECT m.property_id, h.kind = 'heading' AS under_heading, m.order_idx IS NOT NULL AS ordered, m.visible
           FROM layout_module m JOIN layout_module h ON h.id = m.parent_module_id
          WHERE m.data_source_id = $1 AND m.kind = 'property' AND m.area = 'heading'
          ORDER BY m.order_idx`,
        [dataSourceId],
      )
    ).map((r) => [r.property_id, r.under_heading, r.ordered, r.visible])

  test('★ 고정은 heading 의 property 행(자기 순서 · 보임) — 순서를 바꾸고, 같으면 쓰지 않고, 주지 않으면 그대로, 풀면 행이 지워진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, c] = [db.id('A'), db.id('C')]
    const first = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [], pinned: [c, a] }))
    assert.deepEqual([first.layout.pinned, first.layout.hidden, first.layout.version, first.changed], [[c, a], [], '1', true])
    assert.deepEqual(await pinRows(db.dataSourceId), [[c, true, true, true], [a, true, true, true]])

    const swapped = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [], pinned: [a, c] }))
    assert.deepEqual([swapped.layout.pinned, swapped.layout.version], [[a, c], '2'], 'heading 안의 순서는 스키마 순서가 아니다')
    const same = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [], pinned: [a, c] }))
    assert.deepEqual([same.changed, same.layout.version], [false, '2'])
    const omitted = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [] }))
    assert.deepEqual([omitted.changed, omitted.layout.pinned], [false, [a, c]], '주지 않으면 그대로다')

    const unpinned = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [], pinned: [a] }))
    assert.deepEqual(unpinned.layout.pinned, [a])
    assert.equal((await tables(db.dataSourceId)).props, 1, '푼 고정의 행은 지워진다(sparse) — 속성 묶음으로 돌아간다')
  })

  test('★ 숨김과 겹치지 않는다 — 고정을 주지 않고 숨기면 풀리고, 숨기면서 고정하거나 제목을 고정하면 invalid_layout · 16개는 too_many_pinned', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, b] = [db.id('A'), db.id('B')]
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [], pinned: [a, b] }))
    const hid = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [a] }))
    assert.deepEqual([hid.layout.hidden, hid.layout.pinned], [[a], [b]], '고정을 주지 않고 숨기면 그 속성의 고정이 풀린다(한 속성은 한 자리)')
    const back = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [], pinned: [a, b] }))
    assert.deepEqual([back.layout.hidden, back.layout.pinned], [[], [a, b]], '숨긴 속성을 고정하면 숨김이 풀린다')

    const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)
    assert.equal(reason(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '3', order: [], hidden: [a], pinned: [a] })), 'invalid_layout')
    assert.equal(reason(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '3', order: [], hidden: [], pinned: [db.id('이름')] })), 'invalid_layout')

    for (let i = 0; i < MAX_PINNED_PROPERTIES - 1; i += 1) unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: `P${i}`, type: 'number' }))
    const all = unwrap(await getSchema(fx.owner.ctx, db.dataSourceId)).properties.filter((p) => p.type !== 'title').map((p) => p.id)
    assert.equal(all.length, MAX_PINNED_PROPERTIES + 2)
    assert.equal(reason(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '3', order: [], hidden: [], pinned: all.slice(0, MAX_PINNED_PROPERTIES + 1) })), 'too_many_pinned')
    assert.deepEqual((await layoutOf(db.dataSourceId)).pinned, [a, b], '거부된 적용은 아무것도 쓰지 않는다')
    const full = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '3', order: [], hidden: [], pinned: all.slice(0, MAX_PINNED_PROPERTIES) }))
    assert.equal(full.layout.pinned.length, MAX_PINNED_PROPERTIES, '15개까지는 된다')
  })

  test('★ 속성을 지우면 고정이 풀린다 — 되살려도 속성 묶음으로 돌아온다(숨김은 되살리면 돌아온다 — ⑥)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, b] = [db.id('A'), db.id('B')]
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [], pinned: [a, b] }))
    unwrap(await deleteProperty(fx.owner.ctx, db.dataSourceId, a))
    assert.deepEqual((await layoutOf(db.dataSourceId)).pinned, [b])
    assert.deepEqual((await pinRows(db.dataSourceId)).map((r) => r[0]), [b], '지운 속성의 고정 행이 남았다 — 15자리 중 하나를 차지한다')
    unwrap(await restoreProperty(fx.owner.ctx, db.dataSourceId, a))
    assert.deepEqual((await layoutOf(db.dataSourceId)).pinned, [b], '되살린 속성은 속성 묶음으로 돌아온다')
  })

  test('행 페이지가 고정을 읽는다 — heading 안의 순서 · 속성 묶음의 컬럼에도 그대로 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [], pinned: [db.id('C'), db.id('A')] }))
    const page = await readRowPage(fx.owner.ctx, db.rowId)
    assert.deepEqual(page?.pinned, [db.id('C'), db.id('A')])
    assert.ok(page?.columns.some((c) => c.propertyId === db.id('C') && c.visible))
  })
})

describe('⑨ 페이지 설정 (3b-1 · F-16-09 · F-16-10)', () => {
  test('★ 머리가 없으면 기본값 — 설정만 바꿔도 머리가 생긴다(version 1) · 준 칸만 바꾸고 같으면 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    assert.deepEqual((await layoutOf(db.dataSourceId)).settings, DEFAULT_PAGE_SETTINGS)

    const wide = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [], settings: { fullWidth: true } }))
    assert.deepEqual([wide.changed, wide.layout.version, wide.layout.settings], [true, '1', { ...DEFAULT_PAGE_SETTINGS, fullWidth: true }])
    assert.equal((await tables(db.dataSourceId)).heads, 1, '설정만 바꿔도 기본에서 벗어난 것이다 — 머리가 생긴다')

    const off = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [], settings: { backlinks: 'off' } }))
    assert.deepEqual([off.layout.version, off.layout.settings], ['2', { ...DEFAULT_PAGE_SETTINGS, fullWidth: true, backlinks: 'off' }], '준 칸만 바꾼다 — 전체 폭은 남는다')

    const same = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [], settings: { backlinks: 'off', fullWidth: true } }))
    assert.deepEqual([same.changed, same.layout.version], [false, '2'])
  })

  test('★ 숨김 · 고정과 함께 보내도 서로 건드리지 않는다 — 설정을 주지 않으면 그대로 · 행 페이지가 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const all = {
      backlinks: 'always',
      inlineComments: 'minimal',
      showDiscussions: false,
      showPropertyIcons: false,
      fullWidth: true,
    } as const
    const first = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0', order: [], hidden: [db.id('B')], pinned: [db.id('A')], settings: all,
    }))
    assert.deepEqual([first.layout.settings, first.layout.hidden, first.layout.pinned], [all, [db.id('B')], [db.id('A')]])
    const omitted = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [] }))
    assert.deepEqual([omitted.layout.settings, omitted.layout.hidden, omitted.layout.pinned], [all, [], [db.id('A')]], '설정을 주지 않으면 그대로다')
    assert.deepEqual((await readRowPage(fx.owner.ctx, db.rowId))?.settings, all)
  })
})

describe('⑩ 본문 모듈 · 상세 패널 (3c-1 · F-16-04 · F-16-05)', () => {
  /** 이 소스의 부모 없는 property 행 — [영역, 속성, 보임, 순서가 있는가] · 영역 · 순서대로. */
  const moduleRows = async (dataSourceId: string) =>
    (
      await query<{ area: string; property_id: string; visible: boolean; ordered: boolean }>(
        `SELECT area, property_id, visible, order_idx IS NOT NULL AS ordered FROM layout_module
          WHERE data_source_id = $1 AND kind = 'property' AND parent_module_id IS NULL AND area <> 'heading'
          ORDER BY area, order_idx`,
        [dataSourceId],
      )
    ).map((r) => [r.area, r.property_id, r.visible, r.ordered])

  test('★ 올리면 부모 없는 행 — 속성 묶음과 한 줄에서 순서를 다투고, 패널은 따로 · 내리면 행이 지워진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, b, c] = [db.id('A'), db.id('B'), db.id('C')]
    assert.deepEqual([(await layoutOf(db.dataSourceId)).main, (await layoutOf(db.dataSourceId)).panel], [[GROUP_MODULE], []])

    const placed = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0', order: [], hidden: [], main: [a, GROUP_MODULE, c], panel: [b],
    }))
    assert.deepEqual([placed.layout.main, placed.layout.panel, placed.layout.version], [[a, GROUP_MODULE, c], [b], '1'])
    assert.deepEqual(await moduleRows(db.dataSourceId), [['main', a, true, true], ['main', c, true, true], ['panel', b, true, true]])

    const reordered = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '1', order: [], hidden: [], main: [GROUP_MODULE, c, a],
    }))
    assert.deepEqual([reordered.layout.main, reordered.layout.panel], [[GROUP_MODULE, c, a], [b]], '패널을 주지 않으면 그대로다')
    const same = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [], main: [GROUP_MODULE, c, a], panel: [b] }))
    assert.deepEqual([same.changed, same.layout.version], [false, '2'])

    const lowered = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2', order: [], hidden: [], main: [GROUP_MODULE], panel: [] }))
    assert.deepEqual([lowered.layout.main, lowered.layout.panel], [[GROUP_MODULE], []])
    assert.deepEqual(await moduleRows(db.dataSourceId), [], '내리면 행이 지워진다 — 속성 묶음으로 돌아간다(sparse)')
  })

  test('★ 한 속성은 한 자리 — 겹치면 invalid_layout · 주지 않은 목록에서는 빠진다 · 관계형은 panel_type · 속성 묶음은 줄에 꼭 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, b] = [db.id('A'), db.id('B')]
    const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)
    const apply = (input: { main?: string[]; panel?: string[]; pinned?: string[]; hidden?: string[] }, version = '0') =>
      applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: version, order: [], hidden: input.hidden ?? [], ...input })
    assert.equal(reason(await apply({ main: [GROUP_MODULE, a], panel: [a] })), 'invalid_layout', '본문과 패널에 함께')
    assert.equal(reason(await apply({ main: [GROUP_MODULE, a], hidden: [a] })), 'invalid_layout', '본문에 올리면서 숨김')
    assert.equal(reason(await apply({ main: [GROUP_MODULE, a], pinned: [a] })), 'invalid_layout', '본문에 올리면서 고정')
    assert.equal(reason(await apply({ main: [a] })), 'invalid_layout', '속성 묶음이 줄에 없다')
    assert.equal(reason(await apply({ main: [GROUP_MODULE, db.id('이름')] })), 'invalid_layout', '제목은 올리지 않는다')

    const target = unwrap(await createDatabase(fx.owner.ctx, { name: '관계 대상' }))
    const relation = unwrap(await addRelationProperty(fx.owner.ctx, db.dataSourceId, { name: '관계', targetDataSourceId: target.dataSourceId }))
    assert.equal(reason(await apply({ panel: [relation.propertyId] })), 'panel_type', '관계형은 패널에 못 놓는다(M4)')
    assert.equal((await tables(db.dataSourceId)).heads, 0, '거부된 적용은 아무것도 쓰지 않는다')

    // 주지 않은 목록에서는 빠진다 — 패널의 속성을 고정하면 패널에서 나온다 · 본문 모듈을 숨기면 본문에서 나온다
    unwrap(await apply({ main: [GROUP_MODULE, a], panel: [b] }))
    const moved = unwrap(await apply({ pinned: [b], hidden: [a] }, '1'))
    assert.deepEqual([moved.layout.pinned, moved.layout.hidden, moved.layout.main, moved.layout.panel], [[b], [a], [GROUP_MODULE], []])
  })

  test('★ 지운 속성의 모듈은 남아 되살리면 돌아온다 · 행 페이지가 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, c] = [db.id('A'), db.id('C')]
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [], main: [GROUP_MODULE, a], panel: [c] }))
    unwrap(await deleteProperty(fx.owner.ctx, db.dataSourceId, a))
    assert.deepEqual((await layoutOf(db.dataSourceId)).main, [GROUP_MODULE])
    // 다른 자리를 고쳐도 지운 속성의 모듈은 남는다(보이는 모듈만 다시 쓴다)
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [], panel: [] }))
    unwrap(await restoreProperty(fx.owner.ctx, db.dataSourceId, a))
    assert.deepEqual((await layoutOf(db.dataSourceId)).main, [GROUP_MODULE, a], '되살리면 본문 모듈로 돌아온다')
    const page = await readRowPage(fx.owner.ctx, db.rowId)
    assert.deepEqual([page?.main, page?.panel], [[GROUP_MODULE, a], []])
  })
})

describe('⑪ 직전 버전 — 한 단계 되돌리기 (3e-1 · F-16-12)', () => {
  const kept = async (dataSourceId: string) =>
    (await query<{ after_version: string }>(`SELECT after_version::text AS after_version FROM page_layout_history WHERE data_source_id = $1`, [dataSourceId]))[0]
      ?.after_version ?? null

  test('★ 바뀐 적용이 적용 전을 남기고, 되돌리면 그 레이아웃이 새 버전으로 돌아온다 — 기록은 지워지고 두 번은 되돌리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    const [a, b, c] = [db.id('A'), db.id('B'), db.id('C')]
    assert.equal((unwrap(await getRecordLayout(fx.owner.ctx, db.dataSourceId))).undo.available, false, '처음에는 되돌릴 것이 없다')

    const first = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '0', order: [], hidden: [b], pinned: [a], main: [c, GROUP_MODULE], settings: { fullWidth: true },
    }))
    assert.equal(await kept(db.dataSourceId), '1')
    const unchanged = unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '1', order: [], hidden: [b] }))
    assert.deepEqual([unchanged.changed, await kept(db.dataSourceId)], [false, '1'], '바뀐 것이 없는 적용은 기록을 덮지 않는다')

    // 둘째 적용 — 순서를 바꾸고 고정을 풀고 설정을 바꾼다
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, {
      expectedVersion: '1', order: [c, b, a], hidden: [], pinned: [], main: [GROUP_MODULE], settings: { fullWidth: false, backlinks: 'off' },
    }))
    assert.deepEqual(await schemaOrder(db.dataSourceId), ['이름', 'C', 'B', 'A'])
    const got = unwrap(await getRecordLayout(fx.owner.ctx, db.dataSourceId))
    assert.deepEqual([got.layout.version, got.undo.available], ['2', true])

    const undone = unwrap(await undoRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '2' }))
    assert.deepEqual(
      [undone.layout.version, { ...undone.layout, version: first.layout.version }],
      ['3', first.layout],
      '첫 적용의 레이아웃이 새 버전(3)으로 돌아온다 — 되감지 않는다',
    )
    assert.deepEqual(await schemaOrder(db.dataSourceId), ['이름', 'A', 'B', 'C'], '스키마 순서도 돌아온다')
    assert.equal(await kept(db.dataSourceId), null, '되돌리기는 기록을 지운다')
    assert.equal(unwrap(await getRecordLayout(fx.owner.ctx, db.dataSourceId)).undo.available, false)
    const again = await undoRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '3' })
    assert.equal(again.ok === false && again.reason, 'no_undo', '되돌리기는 되돌리지 않는다')
  })

  test('★ 낡은 버전은 거부 · 읽기는 볼 수 있으면 · 되돌리기는 구조의 문(볼 수만 있으면 forbidden)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await seeded()
    unwrap(await applyRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0', order: [], hidden: [db.id('A')] }))
    const stale = await undoRecordLayout(fx.owner.ctx, db.dataSourceId, { expectedVersion: '0' })
    assert.deepEqual(stale, { ok: false, reason: 'layout_conflict', currentVersion: '1' })

    assert.equal((await stopInheriting(fx.owner.ctx, db.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, db.databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    assert.deepEqual(await getRecordLayout(other.ctx, db.dataSourceId), { ok: false, reason: 'not_found' }, '못 보는 사람은 읽지도 못한다')
    assert.equal((await grantAccess(fx.owner.ctx, db.databaseId, { type: 'user', id: other.userId }, 'view')).ok, true)
    assert.equal((await getRecordLayout(other.ctx, db.dataSourceId)).ok, true, '볼 수 있으면 읽는다')
    const viewer = await undoRecordLayout(other.ctx, db.dataSourceId, { expectedVersion: '1' })
    assert.equal(viewer.ok === false && viewer.reason, 'forbidden')
    assert.equal(await kept(db.dataSourceId), '1', '거부된 되돌리기는 기록을 지우지 않는다')
  })
})
