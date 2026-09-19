/**
 * 뷰 CRUD — W8-b (F-04-01 · F-04-12)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **표를 만들면 뷰가 함께 생긴다.** 뷰가 없으면 화면에 그릴 것이 없다
 *   ② **컬럼을 추가하면 모든 뷰에 나타난다.** `visible` 기본값이 false 라
 *      시딩하지 않으면 "추가했는데 표에 없다" 가 된다
 *   ③ **뷰 순서와 스키마 순서는 별개 축이다**(C-6). 한 뷰에서 옮긴 것이 퍼지지 않는다
 *   ④ **필터·정렬은 쓰기 경로에서 검증한다.** 저장된 뒤에는 다시 보지 않는다
 *   ⑤ 뷰 설정은 공유 상태라 `edit_structure` 다 — 셀만 고치는 사람은 못 바꾼다
 *   ⑥ 마지막 뷰는 지울 수 없다
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
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import {
  addProperty,
  addSelectOption,
  deleteProperty,
  getSchema,
  moveProperty,
  restoreProperty,
} from './property.ts'
import {
  createView,
  deleteView,
  getView,
  listViews,
  moveViewColumn,
  setViewColumn,
  updateView,
  type ViewDetail,
} from './view.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import { textRun } from '../contracts/rich-text.ts'
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
  defaultViewId: string
  titleId: string
  prop: (name: string) => string
}

const newTable = async (
  extra: readonly { name: string; type: MvpPropertyType }[] = [],
): Promise<Table> => {
  const created = await createDatabase(fx.owner.ctx, { name: '표' })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('unreachable')
  assert.ok(created.value.defaultViewId !== undefined, '기본 뷰가 없다')

  for (const p of extra) {
    assert.equal(
      (await addProperty(fx.owner.ctx, created.value.dataSourceId, { name: p.name, type: p.type })).ok,
      true,
      `프로퍼티 ${p.name}`,
    )
  }
  const schema = await getSchema(fx.owner.ctx, created.value.dataSourceId)
  if (!schema.ok) throw new Error('스키마를 읽지 못했다')
  const byName = new Map(schema.value.properties.map((p) => [p.name, p.id]))

  return {
    databaseId: created.value.id,
    dataSourceId: created.value.dataSourceId,
    defaultViewId: created.value.defaultViewId!,
    titleId: schema.value.properties.find((p) => p.type === 'title')!.id,
    prop: (name) => {
      const id = byName.get(name)
      assert.ok(id !== undefined, `프로퍼티 ${name} 이 없다`)
      return id
    },
  }
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const columnNames = (view: ViewDetail): string[] => view.columns.map((c) => c.name)
const visibleNames = (view: ViewDetail): string[] =>
  view.columns.filter((c) => c.visible).map((c) => c.name)

describe('★ 표를 만들면 뷰가 함께 생긴다', () => {
  test('★ 기본 뷰가 하나 있고 제목 컬럼이 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()

    const views = unwrap(await listViews(fx.owner.ctx, table.databaseId))
    assert.equal(views.length, 1)
    assert.equal(views[0].type, 'table')
    assert.equal(views[0].id, table.defaultViewId)

    const view = unwrap(await getView(fx.owner.ctx, table.defaultViewId))
    assert.deepEqual(visibleNames(view), ['이름'])
  })

  test('뷰는 data_source 를 가리킨다 — 행 질의가 그것을 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const view = unwrap(await getView(fx.owner.ctx, table.defaultViewId))
    assert.equal(view.dataSourceId, table.dataSourceId)
    assert.equal(view.databaseId, table.databaseId)
  })
})

describe('select 컬럼은 옵션을 싣는다', () => {
  test('★ 옵션이 order_idx 순으로 컬럼에 실린다 — 셀은 id 만 들고 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '상태', type: 'select' },
      { name: '메모', type: 'rich_text' },
    ])
    for (const name of ['할 일', '진행 중']) {
      unwrap(await addSelectOption(fx.owner.ctx, table.dataSourceId, table.prop('상태'), { name }))
    }

    const view = unwrap(await getView(fx.owner.ctx, table.defaultViewId))
    // 이것이 없으면 화면은 셀의 옵션 id 를 이름으로 바꿀 방법이 없다.
    assert.deepEqual(
      view.columns.find((c) => c.name === '상태')?.options.map((o) => o.name),
      ['할 일', '진행 중'],
    )
    assert.deepEqual(view.columns.find((c) => c.name === '메모')?.options, [])
  })
})

describe('★ 컬럼을 추가하면 모든 뷰에 나타난다', () => {
  test('★ addProperty 가 기본 뷰에 컬럼을 넣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    assert.equal((await addProperty(fx.owner.ctx, table.dataSourceId, { name: '수량', type: 'number' })).ok, true)

    const view = unwrap(await getView(fx.owner.ctx, table.defaultViewId))
    assert.deepEqual(visibleNames(view), ['이름', '수량'])
  })

  test('★ 뷰가 둘이면 둘 다에 나타난다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const second = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '두 번째' }))

    assert.equal((await addProperty(fx.owner.ctx, table.dataSourceId, { name: '나중 컬럼' })).ok, true)

    for (const viewId of [table.defaultViewId, second.id]) {
      const view = unwrap(await getView(fx.owner.ctx, viewId))
      assert.ok(columnNames(view).includes('나중 컬럼'), `뷰 ${view.name} 에 없다`)
    }
  })

  test('새 뷰는 그 시점의 컬럼 전부를 물려받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: 'A', type: 'number' },
      { name: 'B', type: 'checkbox' },
    ])
    const created = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '새 뷰' }))
    assert.deepEqual(visibleNames(created), ['이름', 'A', 'B'])
  })

  test('★ 지운 컬럼은 뷰에서 사라지고, 복원하면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '지울것', type: 'number' }])
    const id = table.prop('지울것')

    assert.equal((await deleteProperty(fx.owner.ctx, table.dataSourceId, id)).ok, true)
    assert.deepEqual(
      columnNames(unwrap(await getView(fx.owner.ctx, table.defaultViewId))),
      ['이름'],
    )

    assert.equal((await restoreProperty(fx.owner.ctx, table.dataSourceId, id)).ok, true)
    assert.ok(
      columnNames(unwrap(await getView(fx.owner.ctx, table.defaultViewId))).includes('지울것'),
    )
  })
})

describe('★ 뷰 순서와 스키마 순서는 별개 축이다 (C-6)', () => {
  test('★ 뷰에서 컬럼을 옮기면 다른 뷰는 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: 'A', type: 'number' },
      { name: 'B', type: 'number' },
    ])
    const second = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '두 번째' }))

    // 기본 뷰에서 B 를 A 앞으로.
    const moved = unwrap(
      await moveViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('B'), table.prop('A')),
    )
    assert.deepEqual(columnNames(moved), ['이름', 'B', 'A'])

    // 두 번째 뷰는 그대로.
    assert.deepEqual(columnNames(unwrap(await getView(fx.owner.ctx, second.id))), ['이름', 'A', 'B'])
  })

  test('★ 스키마 순서를 바꿔도 뷰 순서는 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: 'A', type: 'number' },
      { name: 'B', type: 'number' },
    ])
    assert.equal(
      (await moveProperty(fx.owner.ctx, table.dataSourceId, table.prop('B'), table.prop('A'))).ok,
      true,
    )
    // 뷰는 자기 order_idx 를 쓴다.
    assert.deepEqual(
      columnNames(unwrap(await getView(fx.owner.ctx, table.defaultViewId))),
      ['이름', 'A', 'B'],
    )
  })

  test('맨 뒤로 옮긴다 (beforeId = null)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])
    const moved = unwrap(
      await moveViewColumn(fx.owner.ctx, table.defaultViewId, table.titleId, null),
    )
    assert.deepEqual(columnNames(moved), ['A', '이름'])
  })

  test('★ 자기 앞으로 옮기면 제자리다 — moveProperty 에서 겪은 버그', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])
    const moved = unwrap(
      await moveViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('A'), table.prop('A')),
    )
    assert.deepEqual(columnNames(moved), ['이름', 'A'])
  })

  test('없는 컬럼은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const r = await moveViewColumn(fx.owner.ctx, table.defaultViewId, 'Zz'.repeat(10) + 'x', null)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_found')
  })
})

describe('setViewColumn (불변식 V1 — 단일 행 UPDATE)', () => {
  test('숨기고 다시 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])
    const hidden = unwrap(
      await setViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('A'), { visible: false }),
    )
    assert.deepEqual(visibleNames(hidden), ['이름'])
    // 숨긴 컬럼도 목록에는 남는다 — 다시 켤 수 있어야 한다.
    assert.deepEqual(columnNames(hidden), ['이름', 'A'])

    const shown = unwrap(
      await setViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('A'), { visible: true }),
    )
    assert.deepEqual(visibleNames(shown), ['이름', 'A'])
  })

  test('폭을 주고 지운다 — "안 보냈다"와 "자동으로"를 구분한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])
    const p = table.prop('A')

    let view = unwrap(await setViewColumn(fx.owner.ctx, table.defaultViewId, p, { width: 240 }))
    assert.equal(view.columns.find((c) => c.propertyId === p)?.width, 240)

    // 다른 필드만 보내면 폭이 유지된다.
    view = unwrap(await setViewColumn(fx.owner.ctx, table.defaultViewId, p, { wrap: true }))
    assert.equal(view.columns.find((c) => c.propertyId === p)?.width, 240)
    assert.equal(view.columns.find((c) => c.propertyId === p)?.wrap, true)

    // null 을 보내면 자동 폭으로 돌아간다.
    view = unwrap(await setViewColumn(fx.owner.ctx, table.defaultViewId, p, { width: null }))
    assert.equal(view.columns.find((c) => c.propertyId === p)?.width, null)
  })

  test('★ 한 컬럼을 고쳐도 다른 컬럼의 설정이 살아 있다 (V1 의 이유)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: 'A', type: 'number' },
      { name: 'B', type: 'number' },
    ])
    await setViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('A'), { width: 100 })
    const view = unwrap(
      await setViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('B'), { visible: false }),
    )
    // 배열 하나를 통째로 쓰는 설계라면 A 의 폭이 날아간다.
    assert.equal(view.columns.find((c) => c.name === 'A')?.width, 100)
    assert.equal(view.columns.find((c) => c.name === 'B')?.visible, false)
  })

  test('폭이 0 이하면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])
    assert.equal(
      (await setViewColumn(fx.owner.ctx, table.defaultViewId, table.prop('A'), { width: 0 })).ok,
      false,
    )
  })

  test('★ 제목 컬럼은 숨길 수 없다 — 행으로 들어가는 길이 사라진다 (F-04-12)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])

    const r = await setViewColumn(fx.owner.ctx, table.defaultViewId, table.titleId, { visible: false })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'title_required')

    // 거부됐으니 여전히 보인다. 폭 같은 다른 설정은 제목 컬럼에도 줄 수 있다.
    const view = unwrap(await setViewColumn(fx.owner.ctx, table.defaultViewId, table.titleId, { width: 320 }))
    const title = view.columns.find((c) => c.propertyId === table.titleId)
    assert.equal(title?.visible, true)
    assert.equal(title?.width, 320)
  })
})

describe('★ 필터·정렬 저장', () => {
  test('★ 저장한 필터가 행 질의에 그대로 쓰인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    for (const v of [1, 10]) {
      assert.equal(
        (await createRow(fx.owner.ctx, table.dataSourceId, {
          cells: [
            { propertyId: table.titleId, value: { type: 'title', title: [textRun(`n${v}`)] } },
            { propertyId: n, value: { type: 'number', number: v } },
          ],
        })).ok,
        true,
      )
    }

    const view = unwrap(
      await updateView(fx.owner.ctx, table.defaultViewId, {
        filter: { property_id: n, operator: 'greater_than', value: 5 },
      }),
    )
    assert.ok(view.filter !== null)

    // 뷰가 들고 있는 AST 를 그대로 질의에 넘긴다.
    const page = unwrap(
      await queryRows(fx.owner.ctx, view.dataSourceId, { filter: view.filter, sorts: view.sorts }),
    )
    assert.deepEqual(page.rows.map((r) => r.title), ['n10'])
  })

  test('정렬을 저장한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    const view = unwrap(
      await updateView(fx.owner.ctx, table.defaultViewId, {
        sorts: [{ property_id: n, direction: 'desc' }],
      }),
    )
    assert.deepEqual(view.sorts, [{ property_id: n, direction: 'desc' }])
  })

  test('★ null 을 보내면 필터가 없어진다 — "안 보냈다"와 구분한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    await updateView(fx.owner.ctx, table.defaultViewId, {
      filter: { property_id: n, operator: 'is_empty' },
    })
    // 이름만 보내면 필터가 유지된다.
    let view = unwrap(await updateView(fx.owner.ctx, table.defaultViewId, { name: '이름만' }))
    assert.ok(view.filter !== null)

    view = unwrap(await updateView(fx.owner.ctx, table.defaultViewId, { filter: null }))
    assert.equal(view.filter, null)
  })

  test('★ 틀린 필터는 거부하고 어디가 틀렸는지 알려준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '완료', type: 'checkbox' }])
    // checkbox 에는 is_empty 가 없다.
    const r = await updateView(fx.owner.ctx, table.defaultViewId, {
      filter: { property_id: table.prop('완료'), operator: 'is_empty' },
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.reason, 'invalid_filter')
      assert.ok((r.issues?.length ?? 0) > 0)
    }
  })

  test('★ 지운 컬럼으로 규칙을 새로 만들 수 없다 (쓰기 경로)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    assert.equal((await deleteProperty(fx.owner.ctx, table.dataSourceId, n)).ok, true)

    const r = await updateView(fx.owner.ctx, table.defaultViewId, {
      filter: { property_id: n, operator: 'equals', value: 1 },
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'invalid_filter')
  })

  test('★ 저장된 뒤에 컬럼이 지워져도 뷰는 열린다 — 읽기에서 다시 검증하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const n = table.prop('수량')
    assert.equal(
      (await updateView(fx.owner.ctx, table.defaultViewId, {
        filter: { property_id: n, operator: 'equals', value: 1 },
      })).ok,
      true,
    )
    assert.equal((await deleteProperty(fx.owner.ctx, table.dataSourceId, n)).ok, true)

    // 뷰는 열리고 필터 AST 도 그대로 있다(화면이 "비활성" 배지를 그릴 수 있게).
    const view = unwrap(await getView(fx.owner.ctx, table.defaultViewId))
    assert.ok(view.filter !== null)
  })

  test('정렬 키가 상한을 넘으면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: 'A', type: 'number' },
      { name: 'B', type: 'number' },
      { name: 'C', type: 'number' },
      { name: 'D', type: 'number' },
    ])
    const r = await updateView(fx.owner.ctx, table.defaultViewId, {
      sorts: ['A', 'B', 'C', 'D'].map((nm) => ({ property_id: table.prop(nm), direction: 'asc' as const })),
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'invalid_sorts')
  })

  test('load_limit 범위 밖은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    for (const limit of [0, 201, 1.5]) {
      assert.equal(
        (await updateView(fx.owner.ctx, table.defaultViewId, { loadLimit: limit })).ok,
        false,
        String(limit),
      )
    }
    assert.equal((await updateView(fx.owner.ctx, table.defaultViewId, { loadLimit: 25 })).ok, true)
  })
})

describe('뷰 목록 · 생성 · 삭제', () => {
  test('뷰는 order_idx 순으로 나오고 새 뷰는 맨 뒤다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await createView(fx.owner.ctx, table.databaseId, { name: '둘' })
    await createView(fx.owner.ctx, table.databaseId, { name: '셋' })

    const views = unwrap(await listViews(fx.owner.ctx, table.databaseId))
    assert.deepEqual(views.map((v) => v.name), ['표', '둘', '셋'])
  })

  test('이름을 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const view = unwrap(await updateView(fx.owner.ctx, table.defaultViewId, { name: '바뀐 이름' }))
    assert.equal(view.name, '바뀐 이름')
  })

  test('빈 이름은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    assert.equal((await updateView(fx.owner.ctx, table.defaultViewId, { name: '   ' })).ok, false)
  })

  test('MVP 밖 뷰 타입은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    // 4a(#98)가 board · list 를 열었으므로 정본 10종 중 아직 닫힌 것으로 본다.
    // @ts-expect-error — 런타임 방어를 확인한다
    const r = await createView(fx.owner.ctx, table.databaseId, { type: 'calendar' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'unsupported_type')
  })

  test('★ 마지막 뷰는 지울 수 없다 — 그릴 것이 없어진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const r = await deleteView(fx.owner.ctx, table.defaultViewId)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'last_view')
  })

  test('뷰가 둘이면 지울 수 있고 view_property 도 함께 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const second = unwrap(await createView(fx.owner.ctx, table.databaseId, { name: '지울 뷰' }))

    assert.equal((await deleteView(fx.owner.ctx, second.id)).ok, true)
    assert.equal(unwrap(await listViews(fx.owner.ctx, table.databaseId)).length, 1)
    assert.equal((await getView(fx.owner.ctx, second.id)).ok, false)
  })

  test('없는 뷰는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const r = await getView(fx.owner.ctx, randomUUID())
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_found')
  })
})

describe('★ 권한 — 뷰 설정은 공유 상태다', () => {
  const makePrivate = async (databaseId: string, level?: 'view' | 'edit_content' | 'edit') => {
    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )
    if (level !== undefined) {
      assert.equal(
        (await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, level)).ok,
        true,
      )
    }
  }

  test('★ 못 보는 사람에게는 존재를 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await makePrivate(table.databaseId)

    for (const r of [
      await listViews(other.ctx, table.databaseId),
      await getView(other.ctx, table.defaultViewId),
      await createView(other.ctx, table.databaseId, {}),
      await updateView(other.ctx, table.defaultViewId, { name: '몰래' }),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'not_found')
    }
  })

  test('★ 볼 수만 있으면 뷰 설정을 바꿀 수 없다 (edit_structure)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: 'A', type: 'number' }])
    await makePrivate(table.databaseId, 'view')

    // 읽기는 된다.
    assert.equal((await listViews(other.ctx, table.databaseId)).ok, true)
    assert.equal((await getView(other.ctx, table.defaultViewId)).ok, true)

    // 고치는 네 경로 모두 막힌다 — 내 화면이 아니라 **모두의** 화면이 바뀌기 때문이다.
    for (const r of [
      await createView(other.ctx, table.databaseId, {}),
      await updateView(other.ctx, table.defaultViewId, { name: '몰래' }),
      await setViewColumn(other.ctx, table.defaultViewId, table.prop('A'), { visible: false }),
      await moveViewColumn(other.ctx, table.defaultViewId, table.prop('A'), null),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'forbidden')
    }
  })

  test('edit 레벨이면 뷰 설정을 바꿀 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    await makePrivate(table.databaseId, 'edit')
    assert.equal((await updateView(other.ctx, table.defaultViewId, { name: '고쳤다' })).ok, true)
  })
})
