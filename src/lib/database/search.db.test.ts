/**
 * 뷰 검색 — 제목 · 글 · 옵션 이름으로 행을 좁힌다 (DB 심화 2e-1조각 · F-04-27, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 검색
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 찾는 칸 — 제목 · 글(부분 · 대소문자 무시 · 한국어 조사를 넘는다) · 선택 · 상태(옵션 이름). 숫자는 아니다 · % 는 글자다
 *   ② ★ 필터와 AND · 템플릿 · 휴지통은 뺀다 · 지워진 속성의 칸으로는 찾지 않는다
 *   ③ ★ 열 집계 · 보드(카드 · 개수 · 머리 값 · 다음 페이지)가 같은 행을 본다 — 그룹(열)은 남는다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, deleteProperty, getSchema } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { createTemplate } from './template.ts'
import { createView, updateView } from './view.ts'
import { queryRows } from './query.ts'
import { computeCalculations } from './calculate.ts'
import { queryGroupCalculations, queryGroupRows, queryGroups } from './group.ts'
import type { FilterNode } from './filter.ts'

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

/**
 * 제목 · 메모(글) · 수량(숫자) · 단계(선택: 기획 · 개발) · 상태(상태 — 새 행은 "시작 전").
 *   주간 보고서 — 메모 "초안" · 수량 42 · 기획
 *   회의록     — 메모 "Alpha 보고서를 검토" · 개발 · 진행 중
 *   예산       — 메모 "50% 할인" · 수량 7
 *   잡무       — 빈 칸
 */
async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `검색 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'rich_text' | 'number' | 'select' | 'status') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const memo = await add('메모', 'rich_text')
  const qty = await add('수량', 'number')
  const stage = await add('단계', 'select')
  const status = await add('상태', 'status')
  const opt = async (name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, stage, { name })).option.id
  const plan = await opt('기획')
  const dev = await opt('개발')
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const doing = schema.properties.find((p) => p.id === status)!.options!.find((o) => o.name === '진행 중')!.id

  const row = async (title: string, extra: { propertyId: string; value: CellValue }[] = []) =>
    unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }, ...extra],
      }),
    ).id
  const text = (s: string): CellValue => ({ type: 'rich_text', rich_text: [textRun(s)] })
  await row('주간 보고서', [
    { propertyId: memo, value: text('초안') },
    { propertyId: qty, value: { type: 'number', number: 42 } },
    { propertyId: stage, value: { type: 'select', select: { id: plan } } },
  ])
  await row('회의록', [
    { propertyId: memo, value: text('Alpha 보고서를 검토') },
    { propertyId: stage, value: { type: 'select', select: { id: dev } } },
    { propertyId: status, value: { type: 'status', status: { id: doing } } },
  ])
  await row('예산', [
    { propertyId: memo, value: text('50% 할인') },
    { propertyId: qty, value: { type: 'number', number: 7 } },
  ])
  await row('잡무')
  return { databaseId: created.id, ds, viewId: created.defaultViewId, titleId, memo, qty, stage, plan, dev, row, text }
}

const titles = async (ds: string, search: string | null, filter: FilterNode | null = null) =>
  unwrap(await queryRows(fx.owner.ctx, ds, { search, filter })).rows.map((r) => r.title).sort()

describe('① 찾는 칸', () => {
  test('★ 제목 · 글 · 선택 · 상태의 옵션 이름 — 숫자는 아니다 · % 는 글자다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds } = await table()
    assert.deepEqual(await titles(ds, '보고서'), ['주간 보고서', '회의록'], '제목 · 글(조사를 넘는다 — "보고서를")')
    assert.deepEqual(await titles(ds, 'alpha'), ['회의록'], '대소문자 무시')
    assert.deepEqual(await titles(ds, '기획'), ['주간 보고서'], '선택의 옵션 이름')
    assert.deepEqual(await titles(ds, '진행'), ['회의록'], '상태의 옵션 이름')
    assert.deepEqual(await titles(ds, '42'), [], '숫자 칸은 찾지 않는다')
    assert.deepEqual(await titles(ds, '%'), ['예산'], '% 는 모든 행이 아니다')
    assert.deepEqual(await titles(ds, null), ['잡무', '예산', '주간 보고서', '회의록'].sort(), '검색어가 없으면 전부')
  })
})

describe('② 필터 · 템플릿 · 휴지통 · 지워진 속성', () => {
  test('★ 필터와 AND — 템플릿 · 휴지통은 뺀다 · 지워진 속성의 칸으로는 찾지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, memo, qty, row, text } = await table()
    assert.deepEqual(await titles(ds, '보고서', { property_id: qty, operator: 'greater_than', value: 10 }), ['주간 보고서'])

    const template = unwrap(await createTemplate(fx.owner.ctx, ds, { title: '보고서 틀' }))
    unwrap(await updateCells(fx.owner.ctx, template.id, { cells: [{ propertyId: memo, value: text('보고서') }] }))
    unwrap(await trashRow(fx.owner.ctx, await row('옛 보고서')))
    assert.deepEqual(await titles(ds, '보고서'), ['주간 보고서', '회의록'], '템플릿 · 휴지통은 뺀다')

    unwrap(await deleteProperty(fx.owner.ctx, ds, memo))
    assert.deepEqual(await titles(ds, '초안'), [], '지워진 메모의 칸으로는 찾지 않는다')
    assert.deepEqual(await titles(ds, '보고서'), ['주간 보고서'], '제목으로는 여전히')
  })
})

describe('③ 열 집계 · 보드가 같은 행을 본다', () => {
  test('★ 열 집계 — 검색에 맞는 행만 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, qty } = await table()
    const calc = await computeCalculations(fx.owner.ctx, ds, null, [{ propertyId: qty, type: 'number', calculation: 'count_all' }], '보고서')
    assert.deepEqual(calc[qty], { kind: 'count', value: 2 })
  })

  test('★ 보드 — 카드 · 개수 · 머리 값 · 다음 페이지가 좁혀지고 그룹(열)은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, stage, qty, plan, dev } = await table()
    const board = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'board', groupBy: { property_id: stage } }))
    unwrap(await updateView(fx.owner.ctx, board.id, { groupBy: { property_id: stage, calculation: { property_id: qty, function: 'count_all' } } }))

    const page = unwrap(await queryGroups(fx.owner.ctx, board.id, { search: '보고서' }))
    const byKey = Object.fromEntries(page.groups.map((g) => [g.key, g]))
    assert.deepEqual(page.groups.map((g) => g.key), ['', plan, dev], '그룹(열)은 남는다')
    assert.equal(byKey['']!.count, 0, '"단계 없음" 열은 빈다(예산 · 잡무는 맞지 않는다)')
    assert.equal(byKey[plan]!.count, 1)
    assert.deepEqual(byKey[dev]!.rows.map((r) => r.title), ['회의록'])
    assert.deepEqual(byKey[plan]!.calculation, { kind: 'count', value: 1 }, '머리 값도')

    const more = unwrap(await queryGroupRows(fx.owner.ctx, board.id, '', { search: '보고서' }))
    assert.deepEqual(more.rows, [], '다음 페이지도 같은 조건')
    const heads = unwrap(await queryGroupCalculations(fx.owner.ctx, board.id, { search: '할인' }))
    assert.deepEqual(heads.values[''], { kind: 'count', value: 1 }, '머리 값만 다시 받을 때도')
    assert.deepEqual(heads.values[plan], { kind: 'count', value: 0 })
  })
})
