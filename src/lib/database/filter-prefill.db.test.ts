/**
 * 필터가 걸린 뷰에서 만든 행 — 10n-10 (F-04-09 · 정본 §3.5 [보강] 필터가 걸린 뷰에서 만든 행)
 *
 * 지키는 것.
 *   ① ★ 빈 행 — 필터가 정하는 값이 채워지고, 그 필터의 질의에 새 행이 든다(채우지 않으면 들지 않는다)
 *   ② 요청이 준 칸이 필터를 이긴다(보드 열의 `+` 가 주는 그룹 값)
 *   ③ ★ 템플릿 — 필터가 템플릿의 값을 이기고, 필터가 정하지 않는 칸은 템플릿이 그대로 · 요청이 준 칸은 둘 다 이긴다
 *   ④ ★ 상태 is_empty — 기본 옵션이 들어가지 않아 새 행이 그 필터에 든다
 *   ⑤ ★ 맞지 않는 값은 그 칸만 버린다 — 지운 옵션 · 떠난 사람 · 지운 속성을 가리키는 필터에서도 행은 만들어진다
 *   ⑥ 하위 항목도 같은 뷰에서 만들면 채운다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import type { CellValue } from './property-types.ts'
import { ME_NODE, type FilterNode } from './filter.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, deleteSelectOption, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { createRow, updateCells } from './row.ts'
import { createRowFromTemplate, createTemplate } from './template.ts'
import { enableSubItems } from './sub-items.ts'
import { createSubItem } from './sub-item-rows.ts'
import { query } from '../db/pool.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const sel = (id: string): CellValue => ({ type: 'select', select: { id } })
const leaf = (property_id: string, operator: string, value?: unknown): FilterNode =>
  value === undefined ? { property_id, operator } : { property_id, operator, value }
const and = (...children: FilterNode[]): FilterNode => ({ op: 'and', children })

/** 표 하나 — 단계(select · 가 · 나) · 진행(status — 만들 때 옵션 셋 · 첫 옵션이 기본) · 완료(체크) · 수량(숫자) · 담당(사람) · 메모(글). */
async function table() {
  const ws = await createBareWorkspace('필터 채우기')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const mate: Actor = await joinAs(ws, await createUser('동료'), 'member')
  const db = unwrap(await createDatabase(boss.ctx, { name: `필터 채우기 ${Date.now()}`, privateTop: true }))
  const ds = db.dataSourceId
  for (const [name, type] of [['단계', 'select'], ['진행', 'status'], ['완료', 'checkbox'], ['수량', 'number'], ['담당', 'people'], ['메모', 'rich_text']] as const) {
    unwrap(await addProperty(boss.ctx, ds, { name, type }))
  }
  const schema = unwrap(await getSchema(boss.ctx, ds))
  const prop = (name: string) => schema.properties.find((p) => p.name === name)!
  const stage = prop('단계').id
  const a = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '가' })).option.id
  const b = unwrap(await addSelectOption(boss.ctx, ds, stage, { name: '나' })).option.id
  const progress = prop('진행')
  return {
    ws, boss, mate, ds, stage, a, b,
    progress: progress.id,
    progressOptions: progress.options!.map((o) => o.id),
    done: prop('완료').id,
    qty: prop('수량').id,
    who: prop('담당').id,
    memo: prop('메모').id,
  }
}

/** 그 행의 칸 값(없으면 null). */
const cellOf = async (rowId: string, propertyId: string) =>
  ((await query<{ value: CellValue }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [rowId, propertyId]))[0]
    ?.value ?? null)

describe('① ★ 빈 행 — 필터가 정하는 값', () => {
  test('채워지고 그 필터의 질의에 든다 — 채우지 않은 행은 들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    const filter = and(
      leaf(fx.stage, 'equals', fx.a),
      leaf(fx.progress, 'equals', fx.progressOptions[2]),
      leaf(fx.done, 'equals', true),
      leaf(fx.qty, 'equals', 3),
      leaf(fx.who, 'contains', ME_NODE),
    )
    const plain = unwrap(await createRow(fx.boss.ctx, fx.ds)).id
    const made = unwrap(await createRow(fx.boss.ctx, fx.ds, { viewFilter: filter })).id

    assert.deepEqual(await cellOf(made, fx.stage), sel(fx.a))
    assert.deepEqual(await cellOf(made, fx.progress), { type: 'status', status: { id: fx.progressOptions[2] } }, '기본 옵션이 아니라 필터의 옵션')
    assert.deepEqual(await cellOf(made, fx.done), { type: 'checkbox', checkbox: true })
    assert.deepEqual(await cellOf(made, fx.qty), { type: 'number', number: 3 })
    assert.deepEqual(await cellOf(made, fx.who), { type: 'people', people: [{ id: fx.boss.ctx.userId }] }, '"나" 는 만드는 사람')

    const ids = unwrap(await queryRows(fx.boss.ctx, fx.ds, { filter })).rows.map((r) => r.id)
    assert.ok(!ids.includes(plain), '전제: 채우지 않은 행은 그 필터에 들지 않는다')
    assert.deepEqual(ids, [made], '★ 새 행이 그 필터에 든다')
  })

  test('채울 수 없는 조건(범위 · OR)은 건너뛰고 나머지는 채운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    const made = unwrap(
      await createRow(fx.boss.ctx, fx.ds, {
        viewFilter: and(
          leaf(fx.qty, 'greater_than', 3),
          { op: 'or', children: [leaf(fx.stage, 'equals', fx.a), leaf(fx.stage, 'equals', fx.b)] },
          leaf(fx.done, 'equals', true),
        ),
      }),
    ).id
    assert.equal(await cellOf(made, fx.qty), null)
    assert.equal(await cellOf(made, fx.stage), null)
    assert.deepEqual(await cellOf(made, fx.done), { type: 'checkbox', checkbox: true })
  })
})

describe('② 요청이 준 칸이 이긴다', () => {
  test('보드 열의 그룹 값 — 필터와 다른 값을 주면 준 값', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    const made = unwrap(
      await createRow(fx.boss.ctx, fx.ds, {
        cells: [{ propertyId: fx.stage, value: sel(fx.b) }],
        viewFilter: and(leaf(fx.stage, 'equals', fx.a), leaf(fx.done, 'equals', true)),
      }),
    ).id
    assert.deepEqual(await cellOf(made, fx.stage), sel(fx.b), '준 칸')
    assert.deepEqual(await cellOf(made, fx.done), { type: 'checkbox', checkbox: true }, '준 칸이 아닌 것은 필터가')
  })
})

describe('③ ★ 템플릿', () => {
  test('필터가 템플릿을 이긴다 · 필터가 정하지 않는 칸은 템플릿 · 준 칸은 둘 다 이긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    const template = unwrap(await createTemplate(fx.boss.ctx, fx.ds, { title: '틀' })).id
    unwrap(
      await updateCells(fx.boss.ctx, template, {
        cells: [
          { propertyId: fx.stage, value: sel(fx.b) },
          { propertyId: fx.memo, value: { type: 'rich_text', rich_text: [textRun('틀 메모')] } },
        ],
      }),
    )
    const filter = leaf(fx.stage, 'equals', fx.a)

    const byFilter = unwrap(await createRowFromTemplate(fx.boss.ctx, fx.ds, template, { viewFilter: filter })).row.id
    assert.deepEqual(await cellOf(byFilter, fx.stage), sel(fx.a), '★ 필터가 템플릿을 이긴다')
    assert.equal(
      ((await cellOf(byFilter, fx.memo)) as { rich_text: { plain_text: string }[] } | null)?.rich_text[0]?.plain_text,
      '틀 메모',
      '필터가 정하지 않는 칸은 템플릿',
    )

    const byCell = unwrap(
      await createRowFromTemplate(fx.boss.ctx, fx.ds, template, { cells: [{ propertyId: fx.stage, value: sel(fx.b) }], viewFilter: filter }),
    ).row.id
    assert.deepEqual(await cellOf(byCell, fx.stage), sel(fx.b), '준 칸은 필터도 이긴다')

    const noView = unwrap(await createRowFromTemplate(fx.boss.ctx, fx.ds, template)).row.id
    assert.deepEqual(await cellOf(noView, fx.stage), sel(fx.b), '뷰가 없으면 템플릿 그대로')
  })
})

describe('④ ★ 상태 is_empty', () => {
  test('기본 옵션이 들어가지 않아 새 행이 그 필터에 든다 — 필터가 없으면 기본 옵션', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    const filter = leaf(fx.progress, 'is_empty')
    const plain = unwrap(await createRow(fx.boss.ctx, fx.ds)).id
    assert.deepEqual(await cellOf(plain, fx.progress), { type: 'status', status: { id: fx.progressOptions[0] } }, '전제: 기본 옵션')

    const made = unwrap(await createRow(fx.boss.ctx, fx.ds, { viewFilter: filter })).id
    const ids = unwrap(await queryRows(fx.boss.ctx, fx.ds, { filter })).rows.map((r) => r.id)
    assert.deepEqual(ids, [made], '★ 새 행이 "비어 있음" 에 든다')
  })
})

describe('⑤ ★ 맞지 않는 값은 그 칸만 버린다', () => {
  test('지운 옵션 · 떠난 사람 · 지운 속성을 가리키는 필터 — 행은 만들어지고 맞는 칸은 채운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    unwrap(await deleteSelectOption(fx.boss.ctx, fx.ds, fx.stage, fx.b))
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      fx.ws,
      fx.mate.ctx.userId,
    ])
    unwrap(await deleteProperty(fx.boss.ctx, fx.ds, fx.qty))
    const made = await createRow(fx.boss.ctx, fx.ds, {
      viewFilter: and(
        leaf(fx.stage, 'equals', fx.b),
        leaf(fx.who, 'contains', fx.mate.ctx.userId),
        leaf(fx.qty, 'equals', 3),
        leaf(fx.done, 'equals', true),
      ),
    })
    assert.equal(made.ok, true, `★ 행은 만들어진다 — ${JSON.stringify(made)}`)
    const id = unwrap(made).id
    assert.equal(await cellOf(id, fx.stage), null, '지운 옵션은 버린다')
    assert.equal(await cellOf(id, fx.who), null, '떠난 사람만 있던 칸은 적지 않는다')
    assert.deepEqual(await cellOf(id, fx.done), { type: 'checkbox', checkbox: true }, '맞는 칸은 채운다')
  })

  test('떠난 사람과 남은 사람이 함께면 남은 사람만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      fx.ws,
      fx.mate.ctx.userId,
    ])
    const id = unwrap(
      await createRow(fx.boss.ctx, fx.ds, { viewFilter: and(leaf(fx.who, 'contains', fx.mate.ctx.userId), leaf(fx.who, 'contains', ME_NODE)) }),
    ).id
    assert.deepEqual(await cellOf(id, fx.who), { type: 'people', people: [{ id: fx.boss.ctx.userId }] })
  })
})

describe('⑥ 하위 항목', () => {
  test('같은 뷰에서 만든 하위 항목도 채운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const fx = await table()
    unwrap(await enableSubItems(fx.boss.ctx, fx.ds))
    const parent = unwrap(await createRow(fx.boss.ctx, fx.ds)).id
    const child = unwrap(await createSubItem(fx.boss.ctx, fx.ds, parent, { viewFilter: leaf(fx.stage, 'equals', fx.a) })).id
    assert.deepEqual(await cellOf(child, fx.stage), sel(fx.a))
  })
})
