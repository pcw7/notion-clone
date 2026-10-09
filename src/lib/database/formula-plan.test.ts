/**
 * 수식 — 화면이 계산하는 계획 (2i-3a조각 · F-03-12)
 *
 *   ① 계획은 컬럼 **전부**(숨긴 것 포함)로 만든다 — 숨긴 속성을 읽는 수식도 계산된다. 수식 컬럼이 없으면 계획이 없다
 *   ② 계산기는 저장된 식(`⟦id⟧`)을 읽는다 — 이름이 겹쳐도 다른 속성을 묶지 않는다. 읽히지 않는 식은 컬럼 전체가 이유를 든다
 *   ③ 옵션 이름 — 계획의 것, 없으면 지금 화면의 것(계획 뒤에 만든 옵션)
 *   ④ 지금은 계획의 시각이다(서버 렌더와 브라우저가 같은 값을 낸다)
 *   ⑤ 수식 값 → 칸 값(칸을 그리는 함수로 그린다)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import type { CellValue, SelectOption } from './property-types.ts'
import type { ViewColumn } from './view-columns.ts'
import { formulaCell, formulaEvaluator, formulaPlanOf } from './formula-plan.ts'

const NOW = new Date('2026-10-10T09:00:00Z')
const slot = (id: string) => `⟦${id}⟧`

const base = { visible: true, orderKey: 'a0', width: null, wrap: false, options: [] as readonly SelectOption[], calculation: null }
const col = (propertyId: string, name: string, type: Exclude<ViewColumn['type'], 'formula' | 'relation' | 'rollup' | 'unique_id'>, extra: Partial<typeof base> = {}): ViewColumn =>
  ({ ...base, ...extra, propertyId, name, type }) as ViewColumn
const formula = (propertyId: string, name: string, source: string, resultType: 'number' | 'text' | 'boolean' | 'date', extra: Partial<typeof base> = {}): ViewColumn => ({
  ...base,
  ...extra,
  propertyId,
  name,
  type: 'formula',
  formula: { expression: '(사람이 읽는 식 — 계산은 이것을 읽지 않는다)', source, resultType },
})

const cell = (v: CellValue) => v

describe('① 계획 — 컬럼 전부로', () => {
  test('★ 숨긴 속성을 읽는 수식도 계산된다 · 수식 컬럼이 없으면 계획이 없다', () => {
    const columns = [
      col('t', '이름', 'title'),
      col('h', '시간', 'number', { visible: false }), // 숨겼다
      formula('f', '두 배', `${slot('h')} * 2`, 'number'),
    ]
    const plan = formulaPlanOf(columns, NOW)
    assert.ok(plan !== null)
    assert.deepEqual(plan.sources.map((p) => p.id), ['t', 'h', 'f'])
    const values = formulaEvaluator(plan).valuesOf({ h: cell({ type: 'number', number: 21 }) })
    assert.deepEqual(values, { f: { type: 'number', value: 42 } })

    assert.equal(formulaPlanOf(columns.slice(0, 2), NOW), null)
  })

  test('계획은 직렬화된다(서버 렌더 → 브라우저)', () => {
    const plan = formulaPlanOf([col('h', '시간', 'number'), formula('f', 'f', `${slot('h')} + 1`, 'number')], NOW)
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan)
  })
})

describe('② 저장된 식을 읽는다', () => {
  test('★ 이름이 아니라 id 로 묶는다 — 사람이 읽는 식이 어떻든 계산은 같다', () => {
    const plan = formulaPlanOf([col('a', '값', 'number'), col('b', '다른 값', 'number'), formula('f', 'f', `${slot('b')} + 1`, 'number')], NOW)!
    const values = formulaEvaluator(plan).valuesOf({ a: cell({ type: 'number', number: 100 }), b: cell({ type: 'number', number: 1 }) })
    assert.deepEqual(values.f, { type: 'number', value: 2 })
  })

  test('★ 읽히지 않는 식(지워진 속성 · 타입이 바뀐 속성)은 컬럼 전체가 이유를 든다 — 값은 빈 값', () => {
    const plan = formulaPlanOf(
      [
        col('h', '시간', 'rich_text'), // 수였는데 글로 바뀌었다
        formula('gone', '지워진 것을 읽는다', `${slot('deleted')} + 1`, 'number'),
        formula('mismatch', '타입이 바뀐 것을 읽는다', `${slot('h')} * 2`, 'number'),
        formula('ok', '읽힌다', '1 + 1', 'number'),
      ],
      NOW,
    )!
    const evaluator = formulaEvaluator(plan)
    assert.equal(typeof evaluator.errors.gone, 'string')
    assert.equal(typeof evaluator.errors.mismatch, 'string')
    assert.equal(evaluator.errors.ok, null)
    assert.deepEqual(evaluator.valuesOf({}), { gone: null, mismatch: null, ok: { type: 'number', value: 2 } })
  })
})

describe('③ 옵션 이름', () => {
  test('★ 계획의 옵션 · 없으면 지금 화면의 것(계획 뒤에 만든 옵션)', () => {
    const stage = col('s', '단계', 'select', { options: [{ id: 'o1', name: '검토', color: 'default' }] })
    const plan = formulaPlanOf([stage, formula('f', '표시', `${slot('s')} + "!"`, 'text')], NOW)!
    const evaluator = formulaEvaluator(plan)
    assert.deepEqual(evaluator.valuesOf({ s: cell({ type: 'select', select: { id: 'o1' } }) }).f, { type: 'text', value: '검토!' })
    // 방금 만든 옵션 — 계획에는 없다
    assert.equal(evaluator.valuesOf({ s: cell({ type: 'select', select: { id: 'o2' } }) }).f, null)
    assert.deepEqual(
      evaluator.valuesOf({ s: cell({ type: 'select', select: { id: 'o2' } }) }, (id) => (id === 'o2' ? '새 단계' : null)).f,
      { type: 'text', value: '새 단계!' },
    )
  })
})

describe('④ 지금', () => {
  test('★ today() 는 계획의 시각이다', () => {
    const plan = formulaPlanOf([col('d', '마감', 'date'), formula('f', '남은 날', `dateBetween(${slot('d')}, today(), "days")`, 'number')], NOW)!
    assert.deepEqual(formulaEvaluator(plan).valuesOf({ d: cell({ type: 'date', date: { start: '2026-10-20' } }) }).f, { type: 'number', value: 10 })
  })
})

describe('⑤ 칸 값으로', () => {
  test('수 · 글 · 참거짓 · 날짜(범위) · 빈 값', () => {
    assert.deepEqual(formulaCell({ type: 'number', value: 1.5 }), { type: 'number', number: 1.5 })
    assert.deepEqual(formulaCell({ type: 'text', value: '가' }), { type: 'rich_text', rich_text: [textRun('가')] })
    assert.deepEqual(formulaCell({ type: 'boolean', value: false }), { type: 'checkbox', checkbox: false })
    assert.deepEqual(formulaCell({ type: 'date', value: { start: '2026-10-01', end: '2026-10-03' } }), {
      type: 'date',
      date: { start: '2026-10-01', end: '2026-10-03' },
    })
    assert.deepEqual(formulaCell({ type: 'date', value: { start: '2026-10-01' } }), { type: 'date', date: { start: '2026-10-01' } })
    assert.equal(formulaCell(null), null)
    assert.equal(formulaCell(undefined), null)
  })
})
