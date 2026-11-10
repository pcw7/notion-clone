/**
 * 다중 선택으로 묶기 · 끌기 · 선택과 바꾸기 — PT-1b조각 (F-04-11 "multi_select 중복 등장" · F-03-09, DB 필요)
 *
 * 정본: 00-canonical-data-model.md [보강 PT-1] ⑤
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 값이 둘인 행은 두 그룹에 선다 · 값이 없는 행은 없음('') 에 한 번 · 그룹 순서는 옵션 순서 · 카운트는 그룹마다 센다 · 전체는 행을 두 번 세지 않는다
 *   ② ★ 끌기 — A→B 는 A 를 빼고 B 를 더한다(다른 값은 지킨다) · A→없음은 A 만 · 없음→B 는 더한다 · B 가 이미 있으면 A 만 뺀다
 *   ③ ★ 선택 → 다중 선택은 값을 감싼다 · 다중 선택 → 선택은 첫 값을 남기고 둘 이상이던 칸의 수를 알린다(확인하면 바꾼다)
 *
 * ⚠ skip 은 테스트마다 `t.skip` 으로 건다(HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { createView } from './view.ts'
import { moveRow, queryGroupSummary, queryGroups } from './group.ts'
import { convertProperty } from './property-convert.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 태그(다중 선택 · 가 · 나 · 다)가 있는 표. `rows` 는 [제목, 값들]. */
async function table(rows: readonly (readonly [string, readonly ('가' | '나' | '다')[]])[], type: 'multi_select' | 'select' = 'multi_select') {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `다중 묶기 ${Date.now()}` }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '태그', type }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const tag = schema.properties.find((p) => p.name === '태그')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const o: Record<string, string> = {}
  for (const name of ['가', '나', '다']) o[name] = unwrap(await addSelectOption(fx.owner.ctx, ds, tag, { name })).option.id
  const ids: Record<string, string> = {}
  for (const [title, names] of rows) {
    const value =
      type === 'multi_select'
        ? { type: 'multi_select' as const, multi_select: names.map((n) => ({ id: o[n] })) }
        : { type: 'select' as const, select: names[0] === undefined ? null : { id: o[names[0]] } }
    ids[title] = unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(type === 'select' && names.length === 0 ? [] : [{ propertyId: tag, value }]),
        ],
      }),
    ).id
  }
  return { created, ds, tag, o, ids }
}

const board = async (t: { created: { id: string }; tag: string }, type: 'board' | 'table' = 'board') =>
  unwrap(await createView(fx.owner.ctx, t.created.id, { type, groupBy: { property_id: t.tag } })).id

const tagsOf = async (rowId: string, tag: string) =>
  (await query<{ v: { multi_select: { id: string }[] } }>(`SELECT value AS v FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [rowId, tag]))[0]?.v.multi_select.map((x) => x.id)

describe('① 묶기 — 행이 값마다 그룹에 선다', () => {
  test('★ [가,나] 는 가 · 나 양쪽에 · 값이 없으면 없음에 한 번 · 카운트는 그룹마다 · 그룹 순서는 옵션 순서', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table([
      ['R1', ['가', '나']],
      ['R2', ['나']],
      ['R3', []],
    ])
    const viewId = await board(tb)
    const page = unwrap(await queryGroups(fx.owner.ctx, viewId))
    const titles = (key: string) => page.groups.find((g) => g.key === key)!.rows.map((r) => r.title).sort()
    assert.deepEqual(page.groups.map((g) => g.key), ['', tb.o['가'], tb.o['나'], tb.o['다']])
    assert.deepEqual(titles(tb.o['가']), ['R1'])
    assert.deepEqual(titles(tb.o['나']), ['R1', 'R2'], '★ R1 은 가 · 나 양쪽')
    assert.deepEqual(titles(''), ['R3'])
    assert.deepEqual(page.groups.map((g) => g.count), [1, 1, 2, 0])
    const summary = unwrap(await queryGroupSummary(fx.owner.ctx, viewId))
    assert.equal(summary.total.value, 3, '전체는 행을 두 번 세지 않는다')
  })
})

describe('② 끌기', () => {
  test('★ A→B 는 A 를 빼고 B 를 더한다 · A→없음은 A 만 · 없음→B 는 더한다 · B 가 이미 있으면 A 만 뺀다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table([
      ['R1', ['가', '나']],
      ['R2', []],
      ['R3', ['가', '다']],
    ])
    const viewId = await board(tb)
    const move = async (rowId: string, from: string, to: string) =>
      unwrap(await moveRow(fx.owner.ctx, viewId, { rowId, groupKey: to, fromGroupKey: from, beforeRowId: null }))

    await move(tb.ids.R1, tb.o['가'], tb.o['다'])
    assert.deepEqual(await tagsOf(tb.ids.R1, tb.tag), [tb.o['나'], tb.o['다']], '★ 가 → 다: 나는 지키고 다는 끝에')

    await move(tb.ids.R1, tb.o['나'], '')
    assert.deepEqual(await tagsOf(tb.ids.R1, tb.tag), [tb.o['다']], '나 → 없음: 나만 뺀다')

    await move(tb.ids.R2, '', tb.o['나'])
    assert.deepEqual(await tagsOf(tb.ids.R2, tb.tag), [tb.o['나']], '없음 → 나: 더한다')

    await move(tb.ids.R3, tb.o['가'], tb.o['다'])
    assert.deepEqual(await tagsOf(tb.ids.R3, tb.tag), [tb.o['다']], '다가 이미 있으면 가만 뺀다')

    const page = unwrap(await queryGroups(fx.owner.ctx, viewId))
    assert.deepEqual(page.groups.map((g) => [g.rows.map((r) => r.title).sort().join(',')]), [[''], [''], ['R2'], ['R1,R3']])
  })

  test('끈 열이 틀리면 거부한다 · 열이 하나뿐이면 생략할 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table([['R1', ['가']]])
    const viewId = await board(tb)
    const wrong = await moveRow(fx.owner.ctx, viewId, { rowId: tb.ids.R1, groupKey: tb.o['다'], fromGroupKey: tb.o['나'] })
    assert.equal(wrong.ok, false)
    unwrap(await moveRow(fx.owner.ctx, viewId, { rowId: tb.ids.R1, groupKey: tb.o['나'] }))
    assert.deepEqual(await tagsOf(tb.ids.R1, tb.tag), [tb.o['나']])
  })
})

describe('③ 선택 ↔ 다중 선택 바꾸기', () => {
  test('★ 선택 → 다중 선택은 값을 한 원소 배열로 감싼다 · 옵션은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table([['R1', ['가']], ['R2', ['나']], ['R3', []]], 'select')
    const done = unwrap(await convertProperty(fx.owner.ctx, tb.ds, tb.tag, { type: 'multi_select' }))
    assert.equal(done.lost, 0)
    assert.deepEqual(await tagsOf(tb.ids.R1, tb.tag), [tb.o['가']])
    assert.deepEqual(await tagsOf(tb.ids.R2, tb.tag), [tb.o['나']])
    assert.equal(await tagsOf(tb.ids.R3, tb.tag), undefined)
    const options = unwrap(await getSchema(fx.owner.ctx, tb.ds)).properties.find((p) => p.id === tb.tag)!.options ?? []
    assert.deepEqual(options.map((o) => o.name), ['가', '나', '다'])
  })

  test('★ 다중 선택 → 선택은 둘 이상이던 칸의 수를 알리고 · 확인하면 첫 값을 남긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table([['R1', ['나', '가']], ['R2', ['다']], ['R3', ['가', '나', '다']], ['R4', []]])
    const refused = await convertProperty(fx.owner.ctx, tb.ds, tb.tag, { type: 'select' })
    assert.equal(refused.ok, false)
    if (!refused.ok) assert.deepEqual([refused.reason, refused.lost], ['lossy_conversion', 2])
    const done = unwrap(await convertProperty(fx.owner.ctx, tb.ds, tb.tag, { type: 'select', confirmLoss: true }))
    assert.equal(done.lost, 2)
    const select = async (id: string) =>
      (await query<{ t: string | null }>(`SELECT text_value AS t FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [id, tb.tag]))[0]?.t
    assert.equal(await select(tb.ids.R1), tb.o['나'], '저장된 차례의 첫 값')
    assert.equal(await select(tb.ids.R2), tb.o['다'])
    assert.equal(await select(tb.ids.R3), tb.o['가'])
    assert.equal(await select(tb.ids.R4), undefined)
  })
})
