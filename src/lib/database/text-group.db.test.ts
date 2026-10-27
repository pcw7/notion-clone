/**
 * 글자로 묶기 — 서버 (그룹 버킷 트랙 B-2b · F-04-11, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] `view.group_by` 의 [보강 B-2b]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 글 그대로 — 그룹은 데이터에서 · 한국어 순서 · 값 없음이 맨 앞 · 결과가 방식을 싣는다
 *   ② ★ 첫 글자 — 한글은 초성(된소리는 예사소리로) · 로마자는 대문자 · 그 밖은 # · 앞 공백은 건너뛴다 · 순서 ㄱ ~ ㅎ · A ~ Z · #
 *   ③ ★ 옮기기 — 글 그대로는 그 글이 된다(없던 글에도) · 값 없음 그룹은 비운다 · 첫 글자는 다른 덩이로 못 옮긴다(덩이 안의 차례는 바꾼다)
 *   ④ 방식은 글 속성에만 · 제목은 묶지 않는다
 *
 * ⚠ skip 은 테스트마다 `t.skip` 으로 건다(HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { createView, updateView } from './view.ts'
import { moveRow, queryGroups, type GroupsPage } from './group.ts'

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

/** 메모(글)가 있는 표와 그 표의 표 뷰(메모로 묶는다). `rows` 는 [제목, 메모] — null 이면 값 없음. */
async function table(rows: readonly (readonly [string, string | null])[], textBy?: 'exact' | 'first') {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `글 그룹 ${Date.now()}` }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '메모', type: 'rich_text' }))
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '점수', type: 'number' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const memo = schema.properties.find((p) => p.name === '메모')!.id
  const score = schema.properties.find((p) => p.name === '점수')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const ids: Record<string, string> = {}
  for (const [title, text] of rows) {
    ids[title] = unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(text === null ? [] : [{ propertyId: memo, value: { type: 'rich_text' as const, rich_text: [textRun(text)] } }]),
        ],
      }),
    ).id
  }
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'table' }))
  unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: memo, ...(textBy === undefined ? {} : { text_by: textBy }) } }))
  return { viewId: view.id, memo, score, titleId, ids }
}

const shape = (page: GroupsPage) => page.groups.map((g) => [g.key, g.count, g.rows.map((r) => r.title).join('')])

describe('① 글 그대로', () => {
  test('★ 그룹은 데이터에서 · 한국어 순서 · 값 없음이 맨 앞 · 결과가 방식을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', '사과'],
      ['나', '바나나'],
      ['다', '사과'],
      ['라', null],
    ])
    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.equal(page.propertyType, 'rich_text')
    assert.equal(page.textMode, 'exact')
    assert.deepEqual(shape(page), [
      ['', 1, '라'],
      ['바나나', 1, '나'],
      ['사과', 2, '가다'],
    ])
  })
})

describe('② 첫 글자', () => {
  test('★ 초성(된소리는 예사소리로) · 대문자 · # · 앞 공백 · 순서 ㄱ ~ ㅎ · A ~ Z · #', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table(
      [
        ['가', '사과'],
        ['나', '시계'],
        ['다', '바나나'],
        ['라', 'apple'],
        ['마', 'Zoo'],
        ['바', '3번'],
        ['사', '  까치'],
        ['아', null],
      ],
      'first',
    )
    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.equal(page.textMode, 'first')
    assert.deepEqual(shape(page), [
      ['', 1, '아'],
      ['ㄱ', 1, '사'],
      ['ㅂ', 1, '다'],
      ['ㅅ', 2, '가나'],
      ['A', 1, '라'],
      ['Z', 1, '마'],
      ['#', 1, '바'],
    ])
  })
})

describe('③ 옮기기', () => {
  test('★ 글 그대로는 그 글이 된다 · 값 없음은 비운다 · 첫 글자는 다른 덩이로 못 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', '사과'],
      ['나', '바나나'],
    ])
    const textOf = (r: { properties: Record<string, unknown> }) =>
      ((r.properties[g.memo] as { rich_text: { text?: { content: string } }[] }).rich_text ?? []).map((run) => run.text?.content ?? '').join('')

    const a = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '사과' }))
    assert.equal(textOf(a.row), '사과', '그 덩이의 글이 된다')
    const b = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['가']!, groupKey: '포도' }))
    assert.equal(textOf(b.row), '포도', '행이 없던 글에도 — 그 글이 된다')
    const cleared = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['가']!, groupKey: '' }))
    assert.equal(textOf(cleared.row), '', '값 없음 그룹은 비운다')

    const f = await table(
      [
        ['가', '사과'],
        ['나', '시계'],
        ['다', '바나나'],
      ],
      'first',
    )
    const refused = await Promise.all([
      moveRow(fx.owner.ctx, f.viewId, { rowId: f.ids['다']!, groupKey: 'ㅅ' }),
      moveRow(fx.owner.ctx, f.viewId, { rowId: f.ids['다']!, groupKey: '' }),
      moveRow(fx.owner.ctx, f.viewId, { rowId: f.ids['다']!, groupKey: 'ㄲ' }),
    ])
    assert.deepEqual(refused.map((r) => (r.ok ? 'ok' : r.reason)), ['invalid_value', 'invalid_value', 'invalid_value'], '첫 글자만 정할 수는 없다')
    // 덩이 안의 차례는 바꾼다 — 시계를 사과 앞에
    unwrap(await moveRow(fx.owner.ctx, f.viewId, { rowId: f.ids['나']!, groupKey: 'ㅅ', beforeRowId: f.ids['가']! }))
    const page = unwrap(await queryGroups(fx.owner.ctx, f.viewId))
    assert.deepEqual(page.groups.find((x) => x.key === 'ㅅ')!.rows.map((r) => r.title), ['나', '가'])
  })
})

describe('④ 방식은 글 속성에만', () => {
  test('글이 아닌 속성 · 모르는 방식은 거부 · 제목은 묶지 않는다 · 저장하면 방식이 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([['가', '사과']])
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.score, text_by: 'first' } })).ok, false)
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.memo, text_by: 'alphabet_prefix' } })).ok, false)
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.titleId } })).ok, false, '제목은 묶지 않는다')
    const saved = unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.memo, text_by: 'first' } }))
    assert.deepEqual(saved.groupBy, { property_id: g.memo, text_by: 'first' })
  })
})
