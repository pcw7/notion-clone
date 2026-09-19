/**
 * 그룹 · 보드의 서버 명령 — 보드 4a조각 (F-04-11 · F-04-03 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **보드는 그룹이 필수다.** 안 주면 select 를 고르고, 고를 것이 없으면 거부한다(F-04-03)
 *   ② **그룹 키는 옵션 id · 'true'/'false' · ''** 이고 `''` 가 맨 앞이다. 카운트는 필터를 지난 행만 센다
 *   ③ **드롭은 한 트랜잭션이다** — 셀 값이 바뀌고 열 안 자리가 정해진다. 같은 그룹이면 셀은 건드리지 않는다
 *   ④ **자리 없는 행이 정상이다** — 자리 있는 행 뒤에 트리 순서. "맨 뒤"는 그 뒤여야 하고, 자리 없는 행 앞에도 놓을 수 있다
 *   ⑤ **정렬이 걸리면 자리를 읽지도 쓰지도 않는다** — 드롭은 셀 값만 바꾼다
 *   ⑥ 그룹별 독립 커서로 이어 읽으면 중복 · 누락이 없다
 *   ⑦ 권한: 못 보면 카운트도 없고, 볼 수만 있으면 이동은 안 된다. `edit_content` 는 이동은 되고 그룹 설정은 안 되는 것이
 *      코드의 규칙인데(`openBoard` 는 edit_content · `updateView` 는 edit_structure) **여기서 검사하지 못한다** — `resolveCaps` 가
 *      대상 종류를 'page' 로 고정해 데이터베이스 노드에 `edit_content` 레벨을 직접 줄 수 없다(HANDOFF §7). 그 부채가 풀리면
 *      그때 검사를 더한다
 *   ⑧ 그룹 프로퍼티가 지워지면 `groupBy` 가 null 이고 복원하면 돌아온다 — 저장값은 건드리지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema, restoreProperty } from './property.ts'
import { createRow, updateCells, type RowSummary } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { moveRow, queryGroupRows, queryGroups, type GroupsPage } from './group.ts'
import type { MvpPropertyType } from './property-types.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

type Table = {
  databaseId: string
  dataSourceId: string
  titleId: string
  statusId: string
  /** 옵션 id — 할 일 · 진행 중 · 완료. */
  todo: string
  doing: string
  done: string
  row: (title: string, status?: string | null) => Promise<RowSummary>
}

/** 상태(select · 옵션 3개) 프로퍼티를 가진 표. `extra` 로 더 넣는다. */
async function newTable(extra: readonly { name: string; type: MvpPropertyType }[] = []): Promise<Table> {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: '보드' }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'select' }))
  for (const p of extra) unwrap(await addProperty(fx.owner.ctx, ds, { name: p.name, type: p.type }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const statusId = schema.properties.find((p) => p.name === '상태')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const opt = async (name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, statusId, { name })).option.id
  const todo = await opt('할 일')
  const doing = await opt('진행 중')
  const done = await opt('완료')
  return {
    databaseId: created.id,
    dataSourceId: ds,
    titleId,
    statusId,
    todo,
    doing,
    done,
    row: async (title, status) =>
      unwrap(
        await createRow(fx.owner.ctx, ds, {
          cells: [
            { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
            ...(status === undefined
              ? []
              : [{ propertyId: statusId, value: { type: 'select' as const, select: status === null ? null : { id: status } } }]),
          ],
        }),
      ),
  }
}

const titlesOf = (page: GroupsPage, key: string): string[] => {
  const g = page.groups.find((x) => x.key === key)
  assert.ok(g !== undefined, `그룹 ${key} 이 없다`)
  return g.rows.map((r) => r.title)
}
const countOf = (page: GroupsPage, key: string): number => page.groups.find((x) => x.key === key)?.count ?? -1

const positionsIn = (viewId: string) =>
  withReadTransaction((tx) =>
    tx.query<{ group_key: string; row_id: string; order_idx: string }>(
      `SELECT group_key, row_id, order_idx FROM row_position WHERE view_id = $1 ORDER BY group_key, order_idx`,
      [viewId],
    ),
  )

describe('★ 보드는 그룹이 필수다', () => {
  test('★ 그룹을 안 주면 첫 select 를 고르고, 고를 것이 없으면 group_required', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))
    assert.equal(board.type, 'board')
    assert.deepEqual(board.groupBy, { property_id: table.statusId })

    const bare = unwrap(await createDatabase(fx.owner.ctx, { name: '빈 표' }))
    const r = await createView(fx.owner.ctx, bare.id, { type: 'board' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'group_required')
    // 표 뷰는 그룹 없이 만들어진다 — 그룹은 보드의 조건이지 뷰의 조건이 아니다.
    assert.equal(unwrap(await createView(fx.owner.ctx, bare.id, {})).groupBy, null)
  })

  test('checkbox 로 묶을 수 있고, number · 지워진 프로퍼티는 invalid_group', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '끝', type: 'checkbox' },
      { name: '점수', type: 'number' },
    ])
    const schema = unwrap(await getSchema(fx.owner.ctx, table.dataSourceId))
    const id = (n: string) => schema.properties.find((p) => p.name === n)!.id

    const byCheck = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board', groupBy: { property_id: id('끝') } }))
    assert.equal(byCheck.groupBy?.property_id, id('끝'))

    const bad = await createView(fx.owner.ctx, table.databaseId, { type: 'board', groupBy: { property_id: id('점수') } })
    assert.equal(bad.ok, false)
    if (!bad.ok) {
      assert.equal(bad.reason, 'invalid_group')
      assert.equal(bad.issues?.[0]?.path, 'groupBy.property_id')
    }
    const ghost = await updateView(fx.owner.ctx, byCheck.id, { groupBy: { property_id: 'p'.repeat(21) } })
    assert.equal(ghost.ok, false)
    if (!ghost.ok) assert.equal(ghost.reason, 'invalid_group')
  })

  test('★ 표 → 보드 전환은 그룹을 고르고, 보드의 그룹을 null 로 지우는 것은 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const view = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '표' }))
    assert.equal(view.groupBy, null)

    const board = unwrap(await updateView(fx.owner.ctx, view.id, { type: 'board' }))
    assert.equal(board.type, 'board')
    assert.equal(board.groupBy?.property_id, table.statusId)

    const cleared = await updateView(fx.owner.ctx, view.id, { groupBy: null })
    assert.equal(cleared.ok, false)
    if (!cleared.ok) assert.equal(cleared.reason, 'group_required')

    // 다시 표로 돌리면 그룹은 남는다(F-04-11: 표도 그룹을 가질 수 있다) — 지우는 것은 명시적 null 이다.
    const back = unwrap(await updateView(fx.owner.ctx, view.id, { type: 'table' }))
    assert.equal(back.groupBy?.property_id, table.statusId)
    assert.equal(unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: null })).groupBy, null)
  })

  test('hidden 은 중복을 접고, hide_empty 는 true 일 때만 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const view = unwrap(
      await createView(fx.owner.ctx, table.databaseId, {
        type: 'board',
        groupBy: { property_id: table.statusId, hidden: ['', table.done, ''], hide_empty: false },
      }),
    )
    assert.deepEqual(view.groupBy, { property_id: table.statusId, hidden: ['', table.done] })
  })
})

describe('★ 그룹 질의', () => {
  test("★ '' 가 맨 앞, 옵션 순서대로. 빈 옵션은 count 0 이고 카운트는 필터를 지난 행만", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await table.row('A', table.todo)
    await table.row('B', table.todo)
    await table.row('C', table.doing)
    await table.row('없음')
    await table.row('빈 값', null)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))

    const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.deepEqual(
      page.groups.map((g) => [g.key, g.count]),
      [
        ['', 2],
        [table.todo, 2],
        [table.doing, 1],
        [table.done, 0],
      ],
    )
    assert.equal(page.groups[1].option?.name, '할 일')
    assert.equal(page.manualOrder, true)
    assert.deepEqual(titlesOf(page, ''), ['없음', '빈 값'])
    assert.deepEqual(titlesOf(page, table.todo), ['A', 'B'], '자리 없는 행은 트리 순서(만든 순서)')
    assert.deepEqual(titlesOf(page, table.done), [])

    // 필터는 카운트에도 걸린다 — 카운트만으로 걸러진 행의 존재가 드러나면 안 된다(F-04-11).
    unwrap(
      await updateView(fx.owner.ctx, board.id, {
        filter: { property_id: table.titleId, operator: 'contains', value: 'A' },
      }),
    )
    const filtered = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.deepEqual(
      filtered.groups.map((g) => [g.key, g.count]),
      [
        ['', 0],
        [table.todo, 1],
        [table.doing, 0],
        [table.done, 0],
      ],
    )
    assert.deepEqual(titlesOf(filtered, table.todo), ['A'])
  })

  test('★ hide_empty 는 빈 그룹을 빼고, hidden 그룹은 count 만 있고 행이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await table.row('A', table.todo)
    await table.row('C', table.doing)
    const board = unwrap(
      await createView(fx.owner.ctx, table.databaseId, {
        type: 'board',
        groupBy: { property_id: table.statusId, hidden: [table.doing], hide_empty: true },
      }),
    )
    const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.deepEqual(
      page.groups.map((g) => [g.key, g.count, g.hidden, g.rows.length]),
      [
        [table.todo, 1, false, 1],
        [table.doing, 1, true, 0],
      ],
      "'' 와 완료는 비어서 빠지고, 진행 중은 숨겨져 행이 없다",
    )
  })

  test("checkbox 보드 — 'false' 다음 'true', 셀 없는 행은 false", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '끝', type: 'checkbox' }])
    const checkId = unwrap(await getSchema(fx.owner.ctx, table.dataSourceId)).properties.find((p) => p.name === '끝')!.id
    const a = await table.row('A')
    await table.row('B')
    unwrap(await updateCells(fx.owner.ctx, a.id, { cells: [{ propertyId: checkId, value: { type: 'checkbox', checkbox: true } }] }))
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board', groupBy: { property_id: checkId } }))

    const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.equal(page.propertyType, 'checkbox')
    assert.deepEqual(
      page.groups.map((g) => [g.key, g.rows.map((r) => r.title)]),
      [
        ['false', ['B']],
        ['true', ['A']],
      ],
    )
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: 'false' }))
    const moved = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.deepEqual(titlesOf(moved, 'false'), ['B', 'A'])
    // `properties` 는 `properties_cache` 의 타입 붙은 값이다(정본 §3.5).
    assert.deepEqual(moved.groups[0].rows[1].properties[checkId], { type: 'checkbox', checkbox: false })
  })
})

describe('★ 카드 이동 — 셀 값 + 자리를 한 트랜잭션으로', () => {
  test('★ 다른 열로 옮기면 셀이 바뀌고(버전이 오른다) 그 열의 맨 뒤에 놓인다. 같은 열이면 셀은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    await table.row('B', table.todo)
    await table.row('C', table.doing)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))

    const moved = unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.doing }))
    assert.equal(moved.positioned, true)
    assert.deepEqual(moved.row.properties[table.statusId], { type: 'select', select: { id: table.doing } })
    assert.ok(BigInt(moved.row.version) > BigInt(a.version), '셀이 바뀌었으니 버전이 오른다')

    const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.deepEqual(titlesOf(page, table.todo), ['B'])
    // ★ "맨 뒤"는 자리 없는 C 의 **뒤**여야 한다 — 자리 없는 행에 자리를 먼저 준다.
    assert.deepEqual(titlesOf(page, table.doing), ['C', 'A'])

    // 같은 열의 맨 뒤로 다시 — 셀은 그대로, 버전도 그대로.
    const again = unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.doing }))
    assert.equal(again.row.version, moved.row.version, '값이 같으면 셀을 쓰지 않는다')
  })

  test('★ beforeRowId 로 앞에 놓는다 — 자리 있는 행 앞에도, 자리 없는 행 앞에도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const b = await table.row('B', table.todo)
    const c = await table.row('C', table.todo)
    const d = await table.row('D', table.todo)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))

    // 자리 없는 C 앞에 D — A · B · C 가 자리를 받고 D 가 C 앞으로.
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: d.id, groupKey: table.todo, beforeRowId: c.id }))
    assert.deepEqual(titlesOf(unwrap(await queryGroups(fx.owner.ctx, board.id)), table.todo), ['A', 'B', 'D', 'C'])
    // 자리 있는 A 앞에 C — 맨 앞.
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: c.id, groupKey: table.todo, beforeRowId: a.id }))
    assert.deepEqual(titlesOf(unwrap(await queryGroups(fx.owner.ctx, board.id)), table.todo), ['C', 'A', 'B', 'D'])
    // 다른 열에서 와서 B 앞에.
    const e = await table.row('E', table.doing)
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: e.id, groupKey: table.todo, beforeRowId: b.id }))
    assert.deepEqual(titlesOf(unwrap(await queryGroups(fx.owner.ctx, board.id)), table.todo), ['C', 'A', 'E', 'B', 'D'])

    // 자리는 이 뷰의 것이다 — 다른 보드는 트리 순서 그대로다.
    const another = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))
    assert.deepEqual(titlesOf(unwrap(await queryGroups(fx.owner.ctx, another.id)), table.todo), ['A', 'B', 'C', 'D', 'E'])
  })

  test("★ '' 그룹으로 옮기면 셀이 비고, 옛 열의 자리는 남지 않는다(다시 돌아올 수 있다)", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const b = await table.row('B', table.todo)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))

    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.todo, beforeRowId: b.id })) // A 에 자리
    const cleared = unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: '' }))
    assert.deepEqual(cleared.row.properties[table.statusId], { type: 'select', select: null })
    assert.deepEqual(
      (await positionsIn(board.id)).map((p) => [p.group_key, p.row_id]),
      [
        ['', a.id],
        [table.todo, b.id],
      ],
      '옛 열의 자리는 지워졌다',
    )
    // ★ 돌아오면 다시 넣을 수 있어야 한다 — 옛 자리가 남아 있으면 PK 충돌로 죽는다.
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.todo }))
    assert.deepEqual(titlesOf(unwrap(await queryGroups(fx.owner.ctx, board.id)), table.todo), ['B', 'A'])
  })

  test('★ 정렬이 걸린 뷰 — 자리를 읽지도 쓰지도 않고, 드롭은 셀 값만 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const b = await table.row('B', table.doing)
    const board = unwrap(
      await createView(fx.owner.ctx, table.databaseId, { type: 'board' }),
    )
    unwrap(await updateView(fx.owner.ctx, board.id, { sorts: [{ property_id: table.titleId, direction: 'desc' }] }))

    const moved = unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.doing, beforeRowId: b.id }))
    assert.equal(moved.positioned, false)
    assert.deepEqual(moved.row.properties[table.statusId], { type: 'select', select: { id: table.doing } })
    assert.deepEqual(await positionsIn(board.id), [], '정렬된 뷰는 자리를 쓰지 않는다')

    const page = unwrap(await queryGroups(fx.owner.ctx, board.id))
    assert.equal(page.manualOrder, false)
    assert.deepEqual(titlesOf(page, table.doing), ['B', 'A'], '제목 내림차순이 열 안 순서를 정한다')
  })

  test('틀린 그룹 키 · 다른 열의 beforeRowId · 자기 자신 앞은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const c = await table.row('C', table.doing)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))

    const reasons = await Promise.all([
      moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: randomUUID() }),
      moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.todo, beforeRowId: c.id }),
      moveRow(fx.owner.ctx, board.id, { rowId: a.id, groupKey: table.todo, beforeRowId: a.id }),
      moveRow(fx.owner.ctx, board.id, { rowId: randomUUID(), groupKey: table.todo }),
    ])
    assert.deepEqual(
      reasons.map((r) => (r.ok ? 'ok' : r.reason)),
      ['invalid_value', 'not_found', 'invalid_value', 'not_found'],
    )
  })
})

describe('그룹별 커서', () => {
  test('★ load_limit 만큼 끊고, 그룹 커서로 이어 읽으면 중복 · 누락이 없다 — 자리 있는 행과 없는 행이 섞여도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const rows: RowSummary[] = []
    for (const n of ['A', 'B', 'C', 'D', 'E']) rows.push(await table.row(n, table.todo))
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))
    unwrap(await updateView(fx.owner.ctx, board.id, { loadLimit: 2 }))
    // E 를 B 앞에 — A · B 는 자리를 받고, C · D 는 자리가 없다.
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: rows[4].id, groupKey: table.todo, beforeRowId: rows[1].id }))

    const first = unwrap(await queryGroups(fx.owner.ctx, board.id))
    const g = first.groups.find((x) => x.key === table.todo)!
    assert.equal(g.count, 5)
    assert.equal(g.hasMore, true)
    const seen = g.rows.map((r) => r.title)
    let cursor = g.nextCursor
    while (cursor !== null) {
      const next = unwrap(await queryGroupRows(fx.owner.ctx, board.id, table.todo, { cursor }))
      seen.push(...next.rows.map((r) => r.title))
      cursor = next.nextCursor
      assert.ok(seen.length <= 5, '끝없이 돈다')
    }
    assert.deepEqual(seen, ['A', 'E', 'B', 'C', 'D'])

    // 정렬이 걸려도 같은 규칙으로 잇는다.
    unwrap(await updateView(fx.owner.ctx, board.id, { sorts: [{ property_id: table.titleId, direction: 'desc' }] }))
    const sorted = unwrap(await queryGroups(fx.owner.ctx, board.id)).groups.find((x) => x.key === table.todo)!
    const all = sorted.rows.map((r) => r.title)
    let c2 = sorted.nextCursor
    while (c2 !== null) {
      const next = unwrap(await queryGroupRows(fx.owner.ctx, board.id, table.todo, { cursor: c2 }))
      all.push(...next.rows.map((r) => r.title))
      c2 = next.nextCursor
    }
    assert.deepEqual(all, ['E', 'D', 'C', 'B', 'A'])

    const bad = await queryGroupRows(fx.owner.ctx, board.id, randomUUID())
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.reason, 'invalid_value')
  })
})

describe('★ 권한', () => {
  const makePrivate = async (databaseId: string, level?: 'view' | 'edit') => {
    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok, true)
    if (level !== undefined) {
      assert.equal((await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok, true)
    }
  }

  test('★ 못 보면 카운트도 없다(not_found) · 볼 수만 있으면 이동은 forbidden', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))

    await makePrivate(table.databaseId)
    for (const r of [
      await queryGroups(other.ctx, board.id),
      await queryGroupRows(other.ctx, board.id, table.todo),
      await moveRow(other.ctx, board.id, { rowId: a.id, groupKey: table.doing }),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'not_found')
    }

    await makePrivate(table.databaseId, 'view')
    assert.equal(countOf(unwrap(await queryGroups(other.ctx, board.id)), table.todo), 1)
    const r = await moveRow(other.ctx, board.id, { rowId: a.id, groupKey: table.doing })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'forbidden')
  })

  test('edit 레벨이면 카드를 옮기고 그룹 설정도 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))
    await makePrivate(table.databaseId, 'edit')

    unwrap(await moveRow(other.ctx, board.id, { rowId: a.id, groupKey: table.doing }))
    const hidden = unwrap(await updateView(other.ctx, board.id, { groupBy: { property_id: table.statusId, hidden: [table.todo] } }))
    assert.deepEqual(hidden.groupBy?.hidden, [table.todo])
  })
})

describe('그룹 프로퍼티가 지워지면', () => {
  test('★ groupBy 는 null 이고 보드 질의는 not_grouped — 복원하면 저장값 그대로 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await table.row('A', table.todo)
    const board = unwrap(
      await createView(fx.owner.ctx, table.databaseId, {
        type: 'board',
        groupBy: { property_id: table.statusId, hidden: [table.done] },
      }),
    )

    unwrap(await deleteProperty(fx.owner.ctx, table.dataSourceId, table.statusId))
    assert.equal(unwrap(await getView(fx.owner.ctx, board.id)).groupBy, null)
    const r = await queryGroups(fx.owner.ctx, board.id)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_grouped')

    unwrap(await restoreProperty(fx.owner.ctx, table.dataSourceId, table.statusId))
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, board.id)).groupBy, {
      property_id: table.statusId,
      hidden: [table.done],
    })
    assert.equal(countOf(unwrap(await queryGroups(fx.owner.ctx, board.id)), table.todo), 1)
  })

  test('표에서 셀을 고친 행은 새 열의 자리 없는 행으로 뒤에 온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const a = await table.row('A', table.todo)
    const b = await table.row('B', table.doing)
    const c = await table.row('C', table.doing)
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board' }))
    unwrap(await moveRow(fx.owner.ctx, board.id, { rowId: c.id, groupKey: table.doing, beforeRowId: b.id })) // C · B 자리

    unwrap(await updateCells(fx.owner.ctx, a.id, { cells: [{ propertyId: table.statusId, value: { type: 'select', select: { id: table.doing } } }] }))
    assert.deepEqual(titlesOf(unwrap(await queryGroups(fx.owner.ctx, board.id)), table.doing), ['C', 'B', 'A'])
  })
})
