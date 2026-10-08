/**
 * 프로퍼티 타입 바꾸기 — 명령 (DB 심화 2c-1조각 · F-03-14, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 프로퍼티 타입 바꾸기
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 손실이 있으면 확인 없이는 거부한다 — 개수를 말하고 **아무것도 바뀌지 않는다**. 확인을 실으면 바뀐다
 *   ② ★ 바뀐 칸은 새 타입의 봉투 · 사이드카로 — 그 타입의 필터가 걸린다 · id 는 그대로 · 스키마 버전이 오른다
 *   ③ ★ 선택으로 — 이름마다 옵션 하나(대소문자 무시) · 선택에서 글로 갔다 돌아오면 같은 옵션(지우지 않는다)
 *   ④ ★ 그 속성의 필터 규칙은 지운다 — 다른 속성의 규칙은 남는다 · 지운 수를 말한다
 *   ⑤ 바꿀 수 없는 쌍 — 제목(`title_immutable`) · relation · 상태(`unsupported_type`) · 같은 타입은 아무 일 없음
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow } from './row.ts'
import { queryRows } from './query.ts'
import { getView, updateView } from './view.ts'
import { addRelationProperty } from './relation.ts'
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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 글 속성 하나에 값을 채운 표. */
async function table(name: string, texts: readonly string[]) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const schema = unwrap(await addProperty(fx.owner.ctx, ds, { name: '메모', type: 'rich_text' }))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const memo = schema.properties.find((p) => p.name === '메모')!.id
  const rows: string[] = []
  for (const [i, text] of texts.entries()) {
    const cells: { propertyId: string; value: CellValue }[] = [{ propertyId: titleId, value: { type: 'title', title: [textRun(`행 ${i}`)] } }]
    if (text !== '') cells.push({ propertyId: memo, value: { type: 'rich_text', rich_text: [textRun(text)] } })
    rows.push(unwrap(await createRow(fx.owner.ctx, ds, { cells })).id)
  }
  return { ds, viewId: created.defaultViewId, titleId, memo, rows }
}

async function cellsOf(propertyId: string) {
  const rows = await withReadTransaction((tx) =>
    tx.query<{ page_id: string; value: CellValue; num_value: string | null; text_value: string | null }>(
      `SELECT page_id, value, num_value, text_value FROM page_property_value WHERE property_id = $1`,
      [propertyId],
    ),
  )
  return new Map(rows.map((r) => [r.page_id, r]))
}

describe('① 손실은 확인을 받는다', () => {
  test('★ 확인 없이는 개수를 말하고 아무것도 바뀌지 않는다 · 확인을 실으면 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, memo, rows } = await table('손실', ['12', '1,234', '약 3', ''])
    const before = unwrap(await getSchema(fx.owner.ctx, ds)).schemaVersion

    const refused = await convertProperty(fx.owner.ctx, ds, memo, { type: 'number' })
    assert.equal(!refused.ok && refused.reason, 'lossy_conversion')
    assert.equal(!refused.ok && refused.lost, 1)
    const unchanged = unwrap(await getSchema(fx.owner.ctx, ds))
    assert.equal(unchanged.properties.find((p) => p.id === memo)?.type, 'rich_text')
    assert.equal(unchanged.schemaVersion, before)
    assert.equal((await cellsOf(memo)).get(rows[2])?.value.type, 'rich_text')

    const done = unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'number', confirmLoss: true }))
    assert.deepEqual([done.converted, done.lost], [2, 1])
    assert.equal(done.schema.properties.find((p) => p.id === memo)?.type, 'number')
  })
})

describe('② 새 타입의 칸', () => {
  test('★ 봉투 · 사이드카가 새 타입 — 그 타입의 필터가 걸린다 · id 는 그대로 · 버전이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, memo, rows } = await table('칸', ['12', '1,234', '7'])
    const before = unwrap(await getSchema(fx.owner.ctx, ds)).schemaVersion
    const done = unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'number' }))
    assert.notEqual(done.schema.schemaVersion, before)
    const cells = await cellsOf(memo)
    assert.deepEqual(cells.get(rows[1])?.value, { type: 'number', number: 1234 })
    assert.equal(Number(cells.get(rows[1])?.num_value), 1234)
    assert.equal(cells.get(rows[1])?.text_value, null)
    const big = unwrap(await queryRows(fx.owner.ctx, ds, { filter: { property_id: memo, operator: 'greater_than', value: 10 } })).rows
    assert.deepEqual(big.map((r) => r.title).sort(), ['행 0', '행 1'])
  })
})

describe('③ 선택으로', () => {
  test('★ 이름마다 옵션 하나(대소문자 무시) · 글로 갔다 돌아오면 같은 옵션', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, memo, rows } = await table('선택', ['긴급', '보통', 'Urgent', 'urgent', ''])
    const first = unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'select' }))
    const options = first.schema.properties.find((p) => p.id === memo)?.options ?? []
    assert.deepEqual(options.map((o) => o.name), ['긴급', '보통', 'Urgent'])
    const cells = await cellsOf(memo)
    const idOf = (row: string) => (cells.get(row)?.value as { select: { id: string } } | undefined)?.select.id
    assert.equal(idOf(rows[2]), idOf(rows[3]), '대소문자만 다른 이름은 같은 옵션')
    assert.equal(cells.get(rows[4]), undefined, '빈 칸은 칸이 없다')

    unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'rich_text' }))
    assert.deepEqual((await cellsOf(memo)).get(rows[0])?.value, { type: 'rich_text', rich_text: [textRun('긴급')] })
    unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'select' }))
    const back = await cellsOf(memo)
    assert.equal((back.get(rows[0])?.value as { select: { id: string } }).select.id, idOf(rows[0]), '옛 옵션이 그대로 돌아온다')
  })
})

describe('④ 필터', () => {
  test('★ 그 속성의 규칙은 지운다 — 다른 속성의 규칙은 남는다 · 지운 수를 말한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, titleId, memo } = await table('필터', ['12'])
    unwrap(
      await updateView(fx.owner.ctx, viewId, {
        filter: {
          op: 'and',
          children: [
            { property_id: memo, operator: 'contains', value: '1' },
            { property_id: titleId, operator: 'contains', value: '행' },
          ],
        },
      }),
    )
    const done = unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'number' }))
    assert.equal(done.filtersRemoved, 1)
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, viewId)).filter, {
      op: 'and',
      children: [{ property_id: titleId, operator: 'contains', value: '행' }],
    })
  })
})

describe('⑤ 바꿀 수 없는 쌍', () => {
  test('제목 · relation · 상태 — 거부 · 같은 타입은 아무 일 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, titleId, memo } = await table('쌍', ['x'])
    assert.equal(((r) => !r.ok && r.reason)(await convertProperty(fx.owner.ctx, ds, titleId, { type: 'rich_text' })), 'title_immutable')
    assert.equal(((r) => !r.ok && r.reason)(await convertProperty(fx.owner.ctx, ds, memo, { type: 'title' })), 'title_immutable')
    assert.equal(((r) => !r.ok && r.reason)(await convertProperty(fx.owner.ctx, ds, memo, { type: 'status' })), 'unsupported_type')
    const rel = unwrap(await addRelationProperty(fx.owner.ctx, ds, { name: '관계', targetDataSourceId: ds })).propertyId
    assert.equal(((r) => !r.ok && r.reason)(await convertProperty(fx.owner.ctx, ds, rel, { type: 'number' })), 'unsupported_type')
    const same = unwrap(await convertProperty(fx.owner.ctx, ds, memo, { type: 'rich_text' }))
    assert.deepEqual([same.converted, same.lost, same.filtersRemoved], [0, 0, 0])
  })
})
