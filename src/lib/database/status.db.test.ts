/**
 * status 프로퍼티 — 보드 4c-1조각 (F-03-05, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① status 를 만들면 **그룹 셋 · 옵션 셋 · 기본 옵션**이 함께 생긴다 — 스키마 응답이 그 옵션을 싣고 온다
 *   ② 옵션은 그룹에 속하고(기본은 `todo`), select 에 그룹을 주면 거부한다(불변식 SG3)
 *   ③ **옵션 순서는 그룹 순서가 먼저다** — 나중에 "진행 중"에 더한 옵션이 `완료` 앞에 선다(표 · 보드가 같은 순서)
 *   ④ **새 행은 기본 옵션을 받는다.** 보낸 셀이 이긴다 — 빈 값이어도. 비우는 것은 막지 않는다(§3.2-29)
 *   ⑤ `config.default_option_id` 는 이 프로퍼티의 옵션이어야 한다 — 남의 옵션 · 모르는 키는 거부
 *   ⑥ 필터 · 보드가 select 와 같은 길을 탄다 — 보드의 자동 선택은 status 가 select 보다 먼저다(F-04-03)
 *   ⑦ 익스포트 CSV 가 옵션 이름을 쓴다
 *
 * 반사실(HANDOFF §3.3-154~156): 그룹 순서 정렬을 빼면 ③ 이, 기본 옵션 주입을 빼면 ④ 의 첫 검사가, "보낸 셀이 이긴다"를
 * 빼면 ④ 의 둘째 검사와 보드의 "상태 없음" `+` 가, status 우선 정렬을 빼면 ⑥ 의 자동 선택이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema, updateProperty, type PropertySummary } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { moveRow, queryGroups } from './group.ts'
import { queryRows } from './query.ts'
import { prefillCells } from './board-drag.ts'
import { cellPlainText } from '../export/csv.ts'
import { optionIdOf } from './property-types.ts'
import { readCell } from './cell-format.ts'

const readCellValue = (raw: unknown) => readCell('status', raw)

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

// ⚠ skip 은 **테스트마다** `t.skip` 으로 건다. `describe(…, { skip: skipReason })` 는 등록 시점에 평가돼 `before()` 가
//   채우기 전의 빈 문자열을 본다 — DB 가 없는 CI 잡에서 18개가 skip 되지 않고 실패했다(#101).

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

type Table = {
  databaseId: string
  dataSourceId: string
  titleId: string
  status: PropertySummary
  /** 이름 → 옵션 id */
  option: (name: string) => string
}

async function newTable(before: readonly { name: string; type: 'select' | 'checkbox' }[] = []): Promise<Table> {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: '상태 표' }))
  const ds = created.dataSourceId
  for (const p of before) unwrap(await addProperty(fx.owner.ctx, ds, p))
  const schema = unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'status' }))
  const status = schema.properties.find((p) => p.name === '상태')!
  return {
    databaseId: created.id,
    dataSourceId: ds,
    titleId: schema.properties.find((p) => p.type === 'title')!.id,
    status,
    option: (name) => status.options!.find((o) => o.name === name)!.id,
  }
}

const titled = (t: Table, title: string) => ({ propertyId: t.titleId, value: { type: 'title' as const, title: [textRun(title)] } })

describe('① 만들기 — 그룹 셋 · 옵션 셋 · 기본 옵션', () => {
  test('★ 스키마 응답이 옵션 셋을 그룹과 함께 싣고 오고, 첫 옵션이 기본 옵션이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    assert.deepEqual(
      t.status.options!.map((o) => [o.name, o.color, o.group]),
      [['시작 전', 'gray', 'todo'], ['진행 중', 'blue', 'in_progress'], ['완료', 'green', 'complete']],
    )
    assert.equal(t.status.config.default_option_id, t.option('시작 전'))
  })

  test('그룹은 프로퍼티마다 셋이다 — kind 별로 하나', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const kinds = await withReadTransaction((tx) =>
      // ⚠ `ORDER BY kind` 라고 쓰면 text 로 바꾼 **출력 별칭**을 잡아 가나다순이 된다 — ENUM 순서는 표의 컬럼으로 묻는다.
      tx.query<{ kind: string }>(
        `SELECT g.kind::text AS kind FROM status_group g WHERE g.property_id = $1 ORDER BY g.kind`,
        [t.status.id],
      ),
    )
    assert.deepEqual(kinds.map((k) => k.kind), ['todo', 'in_progress', 'complete'])
  })

  test('만들 때 준 config 는 받지 않는다 — 기본 옵션 id 는 만든 옵션에서 나온다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const created = unwrap(await createDatabase(fx.owner.ctx, { name: 'config' }))
    const schema = unwrap(
      await addProperty(fx.owner.ctx, created.dataSourceId, { name: '상태', type: 'status', config: { default_option_id: 'x', junk: 1 } }),
    )
    const status = schema.properties.find((p) => p.type === 'status')!
    assert.deepEqual(Object.keys(status.config), ['default_option_id'])
    assert.equal(status.config.default_option_id, status.options![0].id)
  })
})

describe('② ③ 옵션 — 그룹과 순서', () => {
  test('그룹을 안 주면 todo, 주면 그 그룹이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const plain = unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '보류' }))
    const review = unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '검토 중', group: 'in_progress' }))
    assert.equal(plain.option.group, 'todo')
    assert.equal(review.option.group, 'in_progress')
  })

  test('★ 옵션 순서는 그룹 순서가 먼저다 — 나중에 더한 "검토 중"(진행 중)이 완료 앞에 선다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '검토 중', group: 'in_progress' }))
    unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '보류' }))
    const schema = unwrap(await getSchema(fx.owner.ctx, t.dataSourceId))
    const names = schema.properties.find((p) => p.id === t.status.id)!.options!.map((o) => o.name)
    assert.deepEqual(names, ['시작 전', '보류', '진행 중', '검토 중', '완료'])
  })

  test('같은 이름이면 있는 옵션을 **그 그룹 그대로** 돌려준다 — 요청한 그룹으로 옮기지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const again = unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '완료', group: 'todo' }))
    assert.equal(again.created, false)
    assert.equal(again.option.id, t.option('완료'))
    assert.equal(again.option.group, 'complete')
  })

  test('★ select 옵션에 그룹을 주면 거부한다(SG3) · 모르는 그룹도', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable([{ name: '분류', type: 'select' }])
    const schema = unwrap(await getSchema(fx.owner.ctx, t.dataSourceId))
    const selectId = schema.properties.find((p) => p.name === '분류')!.id
    const grouped = await addSelectOption(fx.owner.ctx, t.dataSourceId, selectId, { name: 'A', group: 'todo' })
    assert.equal(grouped.ok === false && grouped.reason, 'invalid_group')
    const unknown = await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: 'B', group: 'blocked' as never })
    assert.equal(unknown.ok === false && unknown.reason, 'invalid_group')
    // select 옵션에는 그룹이 없다.
    const plain = unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, selectId, { name: 'C' }))
    assert.equal(plain.option.group, undefined)
  })
})

describe('④ 새 행의 기본 옵션', () => {
  test('★ 셀을 안 보내면 기본 옵션을 받는다 — 사이드카까지(필터가 찾는다)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const row = unwrap(await createRow(fx.owner.ctx, t.dataSourceId, { cells: [titled(t, '새 행')] }))
    assert.equal(optionIdOf(readCellValue(row.properties[t.status.id])), t.option('시작 전'))

    const found = unwrap(
      await queryRows(fx.owner.ctx, t.dataSourceId, {
        filter: { property_id: t.status.id, operator: 'equals', value: t.option('시작 전') },
        sorts: [],
      }),
    )
    assert.deepEqual(found.rows.map((r) => r.id), [row.id])
  })

  test('★ 보낸 셀이 이긴다 — 다른 옵션도, **빈 값도**', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const done = unwrap(
      await createRow(fx.owner.ctx, t.dataSourceId, {
        cells: [{ propertyId: t.status.id, value: { type: 'status', status: { id: t.option('완료') } } }],
      }),
    )
    assert.equal(optionIdOf(readCellValue(done.properties[t.status.id])), t.option('완료'))

    // 보드의 "상태 없음" 열의 `+` 가 보내는 것 — 안 보내면 카드가 기본 옵션의 열로 가 버린다.
    const empty = unwrap(await createRow(fx.owner.ctx, t.dataSourceId, { cells: prefillCells('status', t.status.id, '') }))
    assert.equal(optionIdOf(readCellValue(empty.properties[t.status.id])), null)
  })

  test('기본 옵션을 해제하면 새 행은 빈 값이다 · 비우는 것은 막지 않는다(§3.2-29)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const first = unwrap(await createRow(fx.owner.ctx, t.dataSourceId, {}))
    const cleared = unwrap(
      await updateCells(fx.owner.ctx, first.id, { cells: [{ propertyId: t.status.id, value: { type: 'status', status: null } }] }),
    )
    assert.equal(optionIdOf(readCellValue(cleared.properties[t.status.id])), null)

    unwrap(await updateProperty(fx.owner.ctx, t.dataSourceId, t.status.id, { config: { default_option_id: null } }))
    const second = unwrap(await createRow(fx.owner.ctx, t.dataSourceId, {}))
    assert.equal(optionIdOf(readCellValue(second.properties[t.status.id])), null)
  })

  test('status 가 나중에 더해진 표의 기존 행은 값이 없다 — 전부 채우지 않는다(§3.2-29)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const created = unwrap(await createDatabase(fx.owner.ctx, { name: '기존 행' }))
    const old = unwrap(await createRow(fx.owner.ctx, created.dataSourceId, {}))
    const schema = unwrap(await addProperty(fx.owner.ctx, created.dataSourceId, { name: '상태', type: 'status' }))
    const statusId = schema.properties.find((p) => p.type === 'status')!.id
    const page = unwrap(await queryRows(fx.owner.ctx, created.dataSourceId, { filter: null, sorts: [] }))
    const row = page.rows.find((r) => r.id === old.id)!
    assert.equal(row.properties[statusId], undefined)
    assert.equal(row.version, old.version, '기존 행의 버전을 올리지 않는다')
  })
})

describe('⑤ config.default_option_id', () => {
  test('이 프로퍼티의 다른 옵션으로 바꿀 수 있고 새 행이 그것을 받는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    unwrap(await updateProperty(fx.owner.ctx, t.dataSourceId, t.status.id, { config: { default_option_id: t.option('진행 중') } }))
    const row = unwrap(await createRow(fx.owner.ctx, t.dataSourceId, {}))
    assert.equal(optionIdOf(readCellValue(row.properties[t.status.id])), t.option('진행 중'))
  })

  test('★ 남의 프로퍼티의 옵션 · 모르는 키 · uuid 가 아닌 값은 거부한다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const other = await newTable()
    for (const config of [
      { default_option_id: other.option('완료') },
      { default_option_id: 'not-a-uuid' },
      { default_option_id: t.option('완료'), extra: true },
    ]) {
      const r = await updateProperty(fx.owner.ctx, t.dataSourceId, t.status.id, { config })
      assert.equal(r.ok === false && r.reason, 'invalid_config', JSON.stringify(config))
    }
    // 이름만 바꾸는 요청은 config 를 건드리지 않는다.
    const renamed = unwrap(await updateProperty(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '진행 상태' }))
    assert.equal(renamed.properties.find((p) => p.id === t.status.id)!.config.default_option_id, t.option('시작 전'))
  })
})

describe('⑥ 필터 · 보드 — select 와 같은 길', () => {
  test('값 계약: 봉투가 status 여야 한다 — select 봉투는 거부', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const r = await createRow(fx.owner.ctx, t.dataSourceId, {
      cells: [{ propertyId: t.status.id, value: { type: 'select', select: { id: t.option('완료') } } as never }],
    })
    assert.equal(r.ok === false && r.reason, 'invalid_value')
  })

  test('★ 보드의 자동 선택은 status 가 select 보다 먼저다 — select 가 스키마에서 앞에 있어도(F-04-03)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable([{ name: '분류', type: 'select' }])
    const view = unwrap(await createView(fx.owner.ctx, t.databaseId, { type: 'board' }))
    assert.equal(view.groupBy?.property_id, t.status.id)
  })

  test('★ 열은 "상태 없음" → 그룹 순서의 옵션이고, 카드를 옮기면 status 값이 바뀐다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    unwrap(await addSelectOption(fx.owner.ctx, t.dataSourceId, t.status.id, { name: '검토 중', group: 'in_progress' }))
    const a = unwrap(await createRow(fx.owner.ctx, t.dataSourceId, { cells: [titled(t, 'A')] }))
    const view = unwrap(await createView(fx.owner.ctx, t.databaseId, { type: 'board' }))

    const groups = unwrap(await queryGroups(fx.owner.ctx, view.id))
    assert.equal(groups.propertyType, 'status')
    assert.deepEqual(groups.groups.map((g) => g.option?.name ?? '(없음)'), ['(없음)', '시작 전', '진행 중', '검토 중', '완료'])
    assert.deepEqual(groups.groups.map((g) => g.count), [0, 1, 0, 0, 0])
    assert.equal(groups.groups[3].option?.group, 'in_progress')

    const schema = unwrap(await getSchema(fx.owner.ctx, t.dataSourceId))
    const review = schema.properties.find((p) => p.id === t.status.id)!.options!.find((o) => o.name === '검토 중')!.id
    const moved = unwrap(await moveRow(fx.owner.ctx, view.id, { rowId: a.id, groupKey: review }))
    assert.deepEqual(readCellValue(moved.row.properties[t.status.id]), { type: 'status', status: { id: review } })

    // "상태 없음" 으로 옮기면 비워진다 — 기본 옵션이 있어도 막지 않는다.
    const emptied = unwrap(await moveRow(fx.owner.ctx, view.id, { rowId: a.id, groupKey: '' }))
    assert.equal(optionIdOf(readCellValue(emptied.row.properties[t.status.id])), null)
  })

  test('뷰의 컬럼이 status 옵션을 그룹과 함께 싣는다 · 그룹 기준으로 고를 수 있다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable([{ name: '완료 여부', type: 'checkbox' }])
    const table = unwrap(await createView(fx.owner.ctx, t.databaseId, { type: 'table' }))
    const detail = unwrap(await getView(fx.owner.ctx, table.id))
    const column = detail.columns.find((c) => c.propertyId === t.status.id)!
    assert.equal(column.type, 'status')
    assert.deepEqual(column.options.map((o) => o.group), ['todo', 'in_progress', 'complete'])
    const updated = unwrap(await updateView(fx.owner.ctx, table.id, { groupBy: { property_id: t.status.id } }))
    assert.equal(updated.groupBy?.property_id, t.status.id)
  })
})

describe('⑦ 익스포트', () => {
  test('CSV 칸은 옵션 이름이다 — id 가 아니다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await newTable()
    const column = { propertyId: t.status.id, name: '상태', type: 'status' as const, options: [...t.status.options!] }
    assert.equal(cellPlainText(column, { type: 'status', status: { id: t.option('완료') } }), '완료')
    assert.equal(cellPlainText(column, { type: 'status', status: null }), '')
  })
})
