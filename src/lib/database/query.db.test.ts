/**
 * 행 질의 — W8-b (F-04-09 필터 · F-04-10 정렬 · F-04-15 커서)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **셀이 없는 행이 `does_not_equal` 에 걸린다.** EAV 의 가장 미묘한 지점이고,
 *      틀리면 "분명히 5가 아닌데 안 나오는 행"이 생긴다
 *   ② **빈 칸은 정렬에서 맨 아래다**(NULLS LAST). 방향을 바꿔도 그렇다
 *   ③ **커서가 NULL 을 건너뛰지 않는다.** `=` 로 비교하면 빈 칸 행들이 두 번째
 *      페이지에서 통째로 사라진다
 *   ④ 권한이 필터보다 먼저다 — 못 보면 건수조차 나오지 않는다
 *   ⑤ 지워진 프로퍼티를 참조하는 필터는 무시된다(0건이 아니다)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import {
  probeDatabase,
  makeFixture,
  createUser,
  joinAs,
  type Actor,
  type Fixture,
} from '../testing/db-fixtures.ts'
import { withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { queryRows } from './query.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { FilterNode, SortKey } from './filter.ts'
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

type Table = {
  databaseId: string
  dataSourceId: string
  titleId: string
  prop: (name: string) => string
}

const newTable = async (
  extra: readonly { name: string; type: MvpPropertyType }[] = [],
): Promise<Table> => {
  const created = await createDatabase(fx.owner.ctx, { name: '표' })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('unreachable')
  const dataSourceId = created.value.dataSourceId

  for (const p of extra) {
    assert.equal(
      (await addProperty(fx.owner.ctx, dataSourceId, { name: p.name, type: p.type })).ok,
      true,
      `프로퍼티 ${p.name}`,
    )
  }
  const schema = await getSchema(fx.owner.ctx, dataSourceId)
  if (!schema.ok) throw new Error('스키마를 읽지 못했다')
  const byName = new Map(schema.value.properties.map((p) => [p.name, p.id]))
  return {
    databaseId: created.value.id,
    dataSourceId,
    titleId: schema.value.properties.find((p) => p.type === 'title')!.id,
    prop: (name) => {
      const id = byName.get(name)
      assert.ok(id !== undefined, `프로퍼티 ${name} 이 없다`)
      return id
    },
  }
}

/** 제목 + 선택 셀을 가진 행. */
const addRow = async (
  table: Table,
  title: string,
  cells: { propertyId: string; value: Parameters<typeof updateCells>[2]['cells'][number]['value'] }[] = [],
): Promise<string> => {
  const r = await createRow(fx.owner.ctx, table.dataSourceId, {
    cells: [
      { propertyId: table.titleId, value: { type: 'title', title: [textRun(title)] } },
      ...cells,
    ],
  })
  assert.equal(r.ok, true, `행 생성 실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value.id
}

const titlesOf = async (
  table: Table,
  input: { filter?: FilterNode | null; sorts?: SortKey[]; limit?: number; cursor?: string | null } = {},
  actor: Actor = fx.owner,
): Promise<string[]> => {
  const r = await queryRows(actor.ctx, table.dataSourceId, input)
  assert.equal(r.ok, true, `질의 실패: ${r.ok === false ? r.reason : ''}`)
  return r.ok ? r.value.rows.map((row) => row.title) : []
}

describe('기본 질의', () => {
  test('필터가 없으면 전부 나온다 (order_key 순)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    for (const n of ['A', 'B', 'C']) await addRow(table, n)
    assert.deepEqual(await titlesOf(table), ['A', 'B', 'C'])
  })

  test('properties_cache 를 그대로 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    await addRow(table, 'A', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 7 } },
    ])
    const r = await queryRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual(r.value.rows[0].properties[table.prop('수량')], {
        type: 'number',
        number: 7,
      })
    }
  })
})

describe('★ 필터 — 셀이 없는 행', () => {
  test('★ does_not_equal 은 셀이 없는 행도 잡는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    await addRow(table, '다섯', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 5 } },
    ])
    await addRow(table, '일곱', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 7 } },
    ])
    await addRow(table, '빈칸') // 셀이 아예 없다

    const got = await titlesOf(table, {
      filter: { property_id: table.prop('수량'), operator: 'does_not_equal', value: 5 },
    })
    // `EXISTS(… <> 5)` 로 컴파일하면 '빈칸' 이 빠진다. 그게 이 테스트의 이유다.
    assert.deepEqual(got.sort(), ['빈칸', '일곱'])
  })

  test('★ checkbox does_not_equal true 는 셀이 없는 행을 잡는다 (체크 안 함)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '완료', type: 'checkbox' }])
    await addRow(table, '했음', [
      { propertyId: table.prop('완료'), value: { type: 'checkbox', checkbox: true } },
    ])
    await addRow(table, '안함', [
      { propertyId: table.prop('완료'), value: { type: 'checkbox', checkbox: false } },
    ])
    await addRow(table, '빈칸')

    const got = await titlesOf(table, {
      filter: { property_id: table.prop('완료'), operator: 'does_not_equal', value: true },
    })
    assert.deepEqual(got.sort(), ['빈칸', '안함'])
  })

  test('is_empty 는 셀이 없는 행과 값이 NULL 인 행을 모두 잡는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    await addRow(table, '값있음', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 1 } },
    ])
    const nulled = await addRow(table, '값지움', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 2 } },
    ])
    await updateCells(fx.owner.ctx, nulled, {
      cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: null } }],
    })
    await addRow(table, '셀없음')

    const got = await titlesOf(table, {
      filter: { property_id: table.prop('수량'), operator: 'is_empty' },
    })
    assert.deepEqual(got.sort(), ['값지움', '셀없음'])
  })

  test('is_not_empty 는 값이 있는 행만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    await addRow(table, '값있음', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 1 } },
    ])
    await addRow(table, '셀없음')

    assert.deepEqual(
      await titlesOf(table, {
        filter: { property_id: table.prop('수량'), operator: 'is_not_empty' },
      }),
      ['값있음'],
    )
  })
})

describe('필터 — 타입별 연산자', () => {
  test('숫자 비교', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    for (const n of [1, 5, 10]) {
      await addRow(table, `n${n}`, [
        { propertyId: table.prop('수량'), value: { type: 'number', number: n } },
      ])
    }
    const p = table.prop('수량')
    assert.deepEqual(await titlesOf(table, { filter: { property_id: p, operator: 'greater_than', value: 5 } }), ['n10'])
    assert.deepEqual(
      (await titlesOf(table, { filter: { property_id: p, operator: 'greater_than_or_equal_to', value: 5 } })).sort(),
      ['n10', 'n5'],
    )
    assert.deepEqual(await titlesOf(table, { filter: { property_id: p, operator: 'less_than', value: 5 } }), ['n1'])
  })

  test('텍스트 — contains · starts_with · ends_with (대소문자 무시)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '메모', type: 'rich_text' }])
    const memo = table.prop('메모')
    const cell = (s: string) => ({ propertyId: memo, value: { type: 'rich_text' as const, rich_text: [textRun(s)] } })
    await addRow(table, '가', [cell('Alpha Beta')])
    await addRow(table, '나', [cell('Gamma')])

    assert.deepEqual(await titlesOf(table, { filter: { property_id: memo, operator: 'contains', value: 'beta' } }), ['가'])
    assert.deepEqual(await titlesOf(table, { filter: { property_id: memo, operator: 'starts_with', value: 'ALPHA' } }), ['가'])
    assert.deepEqual(await titlesOf(table, { filter: { property_id: memo, operator: 'ends_with', value: 'ma' } }), ['나'])
  })

  test('★ 한국어 contains 도 동작한다 (LIKE 는 조사를 넘는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '메모', type: 'rich_text' }])
    const memo = table.prop('메모')
    await addRow(table, '가', [
      { propertyId: memo, value: { type: 'rich_text', rich_text: [textRun('검색이 빠르다')] } },
    ])
    assert.deepEqual(
      await titlesOf(table, { filter: { property_id: memo, operator: 'contains', value: '검색' } }),
      ['가'],
    )
  })

  test('★ 날짜는 하루 단위로 비교한다 — 시각이 있어도 그 날로 잡힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '마감', type: 'date' }])
    const due = table.prop('마감')
    await addRow(table, '오전', [
      { propertyId: due, value: { type: 'date', date: { start: '2026-03-01T09:30:00Z' } } },
    ])
    await addRow(table, '다음날', [
      { propertyId: due, value: { type: 'date', date: { start: '2026-03-02' } } },
    ])

    assert.deepEqual(
      await titlesOf(table, { filter: { property_id: due, operator: 'equals', value: '2026-03-01' } }),
      ['오전'],
    )
    assert.deepEqual(
      await titlesOf(table, { filter: { property_id: due, operator: 'before', value: '2026-03-02' } }),
      ['오전'],
    )
    assert.deepEqual(
      (await titlesOf(table, { filter: { property_id: due, operator: 'on_or_after', value: '2026-03-01' } })).sort(),
      ['다음날', '오전'],
    )
  })

  test('★ select 은 옵션 id 로 비교한다 — 이름을 바꿔도 필터가 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '상태', type: 'select' }])
    const status = table.prop('상태')
    const optionId = randomUUID()
    await withTransaction((tx) =>
      tx.query(
        `INSERT INTO select_option (id, property_id, name, color, order_idx)
         VALUES ($1, $2, '진행중', 'blue', 'a0')`,
        [optionId, status],
      ),
    )
    await addRow(table, '고른것', [
      { propertyId: status, value: { type: 'select', select: { id: optionId } } },
    ])
    await addRow(table, '안고른것')

    assert.deepEqual(
      await titlesOf(table, { filter: { property_id: status, operator: 'equals', value: optionId } }),
      ['고른것'],
    )

    // 옵션 이름을 바꿔도 같은 필터가 같은 행을 잡는다.
    await withTransaction((tx) =>
      tx.query(`UPDATE select_option SET name = '완료' WHERE id = $1`, [optionId]),
    )
    assert.deepEqual(
      await titlesOf(table, { filter: { property_id: status, operator: 'equals', value: optionId } }),
      ['고른것'],
    )
  })
})

describe('필터 — 그룹', () => {
  test('AND 는 둘 다 만족하는 행만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '수량', type: 'number' },
      { name: '완료', type: 'checkbox' },
    ])
    const n = table.prop('수량')
    const c = table.prop('완료')
    const mk = (title: string, num: number, done: boolean) =>
      addRow(table, title, [
        { propertyId: n, value: { type: 'number', number: num } },
        { propertyId: c, value: { type: 'checkbox', checkbox: done } },
      ])
    await mk('둘다', 10, true)
    await mk('숫자만', 10, false)
    await mk('체크만', 1, true)

    assert.deepEqual(
      await titlesOf(table, {
        filter: {
          op: 'and',
          children: [
            { property_id: n, operator: 'greater_than', value: 5 },
            { property_id: c, operator: 'equals', value: true },
          ],
        },
      }),
      ['둘다'],
    )
  })

  test('OR 는 하나만 만족해도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    for (const v of [1, 2, 3]) {
      await addRow(table, `n${v}`, [{ propertyId: n, value: { type: 'number', number: v } }])
    }
    assert.deepEqual(
      (await titlesOf(table, {
        filter: {
          op: 'or',
          children: [
            { property_id: n, operator: 'equals', value: 1 },
            { property_id: n, operator: 'equals', value: 3 },
          ],
        },
      })).sort(),
      ['n1', 'n3'],
    )
  })

  test('★ 지워진 프로퍼티를 참조하는 규칙은 무시된다 — 0건이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    await addRow(table, 'A', [{ propertyId: n, value: { type: 'number', number: 1 } }])
    await addRow(table, 'B', [{ propertyId: n, value: { type: 'number', number: 2 } }])

    assert.equal((await deleteProperty(fx.owner.ctx, table.dataSourceId, n)).ok, true)

    // 규칙은 남아 있지만 무시되므로 전부 나온다.
    assert.deepEqual(
      (await titlesOf(table, { filter: { property_id: n, operator: 'equals', value: 1 } })).sort(),
      ['A', 'B'],
    )
  })
})

describe('★ 정렬', () => {
  const numTable = async (values: (number | null)[]): Promise<Table> => {
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    for (const [i, v] of values.entries()) {
      await addRow(
        table,
        `r${i}`,
        v === null ? [] : [{ propertyId: n, value: { type: 'number', number: v } }],
      )
    }
    return table
  }

  test('오름차순', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await numTable([3, 1, 2])
    assert.deepEqual(
      await titlesOf(table, { sorts: [{ property_id: table.prop('수량'), direction: 'asc' }] }),
      ['r1', 'r2', 'r0'],
    )
  })

  test('내림차순', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await numTable([3, 1, 2])
    assert.deepEqual(
      await titlesOf(table, { sorts: [{ property_id: table.prop('수량'), direction: 'desc' }] }),
      ['r0', 'r2', 'r1'],
    )
  })

  test('★ 빈 칸은 맨 아래다 (오름차순)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await numTable([2, null, 1])
    assert.deepEqual(
      await titlesOf(table, { sorts: [{ property_id: table.prop('수량'), direction: 'asc' }] }),
      ['r2', 'r0', 'r1'],
    )
  })

  test('★ 내림차순에서도 빈 칸은 맨 아래다 — 방향이 바뀌어도 예측 가능하게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await numTable([2, null, 1])
    assert.deepEqual(
      await titlesOf(table, { sorts: [{ property_id: table.prop('수량'), direction: 'desc' }] }),
      ['r0', 'r2', 'r1'],
    )
  })

  test('★ 동률은 order_key 로 안정 정렬된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await numTable([5, 5, 5])
    // 세 번 질의해도 같은 순서여야 한다.
    const sorts: SortKey[] = [{ property_id: table.prop('수량'), direction: 'asc' }]
    const first = await titlesOf(table, { sorts })
    assert.deepEqual(first, ['r0', 'r1', 'r2'])
    assert.deepEqual(await titlesOf(table, { sorts }), first)
  })

  test('다중 정렬 — 첫 키가 같으면 둘째 키로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '그룹', type: 'number' },
      { name: '순서', type: 'number' },
    ])
    const g = table.prop('그룹')
    const o = table.prop('순서')
    const mk = (title: string, gv: number, ov: number) =>
      addRow(table, title, [
        { propertyId: g, value: { type: 'number', number: gv } },
        { propertyId: o, value: { type: 'number', number: ov } },
      ])
    await mk('a', 1, 2)
    await mk('b', 1, 1)
    await mk('c', 2, 1)

    assert.deepEqual(
      await titlesOf(table, {
        sorts: [
          { property_id: g, direction: 'asc' },
          { property_id: o, direction: 'desc' },
        ],
      }),
      ['a', 'b', 'c'],
    )
  })
})

describe('★ keyset 커서', () => {
  const readAll = async (
    table: Table,
    input: { sorts?: SortKey[]; limit: number },
  ): Promise<string[]> => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard += 1) {
      const r = await queryRows(fx.owner.ctx, table.dataSourceId, { ...input, cursor })
      assert.equal(r.ok, true)
      if (!r.ok) break
      seen.push(...r.value.rows.map((row) => row.title))
      cursor = r.value.nextCursor
      if (cursor === null) break
    }
    return seen
  }

  test('정렬 없이 끝까지 읽으면 중복·누락이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const expected: string[] = []
    for (let i = 0; i < 7; i += 1) {
      expected.push(`r${i}`)
      await addRow(table, `r${i}`)
    }
    assert.deepEqual(await readAll(table, { limit: 3 }), expected)
  })

  test('정렬과 함께 끝까지 읽어도 중복·누락이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    for (const v of [5, 1, 4, 2, 3, 7, 6]) {
      await addRow(table, `n${v}`, [{ propertyId: n, value: { type: 'number', number: v } }])
    }
    const got = await readAll(table, { limit: 2, sorts: [{ property_id: n, direction: 'asc' }] })
    assert.deepEqual(got, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'])
  })

  test('★ 빈 칸 행이 두 번째 페이지에서 사라지지 않는다 — NULL 비교의 함정', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    // 값 2개 + 빈 칸 3개. NULLS LAST 라 빈 칸들이 뒤에 몰리고, 그 구간에서
    // 커서가 `=` 로 비교하면 전부 건너뛴다.
    await addRow(table, 'v1', [{ propertyId: n, value: { type: 'number', number: 1 } }])
    await addRow(table, 'v2', [{ propertyId: n, value: { type: 'number', number: 2 } }])
    for (const name of ['e1', 'e2', 'e3']) await addRow(table, name)

    const got = await readAll(table, { limit: 2, sorts: [{ property_id: n, direction: 'asc' }] })
    assert.deepEqual(got, ['v1', 'v2', 'e1', 'e2', 'e3'])
  })

  test('★ 전부 빈 칸이어도 끝까지 읽힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const expected: string[] = []
    for (let i = 0; i < 5; i += 1) {
      expected.push(`e${i}`)
      await addRow(table, `e${i}`)
    }
    const got = await readAll(table, {
      limit: 2,
      sorts: [{ property_id: table.prop('수량'), direction: 'asc' }],
    })
    assert.deepEqual(got, expected)
  })

  test('마지막 페이지의 nextCursor 는 null 이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await addRow(table, 'A')
    const r = await queryRows(fx.owner.ctx, table.dataSourceId, { limit: 10 })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.nextCursor, null)
      assert.equal(r.value.hasMore, false)
    }
  })

  test('손상된 커서는 처음부터 읽는다 — 던지지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await addRow(table, 'A')
    assert.deepEqual(await titlesOf(table, { cursor: '깨진커서!!' }), ['A'])
  })

  test('★ 정렬 구성이 바뀌면 커서를 버리고 처음부터 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    for (const v of [1, 2, 3]) {
      await addRow(table, `n${v}`, [{ propertyId: n, value: { type: 'number', number: v } }])
    }
    const first = await queryRows(fx.owner.ctx, table.dataSourceId, {
      limit: 1,
      sorts: [{ property_id: n, direction: 'asc' }],
    })
    assert.equal(first.ok, true)
    if (!first.ok) return
    // 같은 커서를 **정렬 없이** 쓰면 길이가 안 맞는다 → 처음부터.
    const got = await titlesOf(table, { cursor: first.value.nextCursor })
    assert.equal(got.length, 3)
  })
})

describe('★ 권한이 필터보다 먼저다', () => {
  test('★ 못 보는 사람에게는 건수조차 나오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    await addRow(table, '비밀', [
      { propertyId: table.prop('수량'), value: { type: 'number', number: 1 } },
    ])

    assert.equal((await stopInheriting(fx.owner.ctx, table.databaseId)).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, table.databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )

    const r = await queryRows(other.ctx, table.dataSourceId, {
      filter: { property_id: table.prop('수량'), operator: 'equals', value: 1 },
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_found')
  })

  test('볼 수 있으면 질의된다 (view 만으로 충분하다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await addRow(table, 'A')

    assert.equal((await stopInheriting(fx.owner.ctx, table.databaseId)).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, table.databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: other.userId }, 'view')).ok,
      true,
    )

    assert.deepEqual(await titlesOf(table, {}, other), ['A'])
  })

  test('없는 data_source 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const r = await queryRows(fx.owner.ctx, randomUUID())
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_found')
  })
})
