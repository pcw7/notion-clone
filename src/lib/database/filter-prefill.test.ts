/**
 * 필터가 걸린 뷰에서 만든 행에 채울 값 — 10n-10 (F-04-09, DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 필터가 걸린 뷰에서 만든 행
 *
 *   ① 조건이 **값 하나를 정할 때만** 채운다 — 글 · 숫자 · 선택 · 상태 · 날짜 equals · 체크박스 · 사람 contains · 상태 is_empty 는 빈 값
 *   ② 범위 · 부분 일치 · 부정 · is_not_empty · 수식 · 고유 ID 는 채우지 않는다
 *   ③ AND 로 닿는 조건만 — 자식이 둘 이상인 OR 은 건너뛰고, 같은 칸에 서로 다른 값이면 채우지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { filterPrefill } from './filter-prefill.ts'
import { ME_NODE, type FilterNode } from './filter.ts'

const ME = '11111111-1111-4111-8111-111111111111'
const KIM = '22222222-2222-4222-8222-222222222222'
const OPT = '33333333-3333-4333-8333-333333333333'
const OPT2 = '44444444-4444-4444-8444-444444444444'

const TYPES: Record<string, string> = {
  title: 'title',
  memo: 'rich_text',
  qty: 'number',
  kind: 'select',
  state: 'status',
  done: 'checkbox',
  due: 'date',
  who: 'people',
  calc: 'formula',
  seq: 'unique_id',
}
const typeOf = (id: string) => TYPES[id]
const fill = (filter: FilterNode | null) => filterPrefill(filter, typeOf, ME)
const leaf = (property_id: string, operator: string, value?: unknown): FilterNode =>
  value === undefined ? { property_id, operator } : { property_id, operator, value }
/** 칸 id → 값의 모양만(비교하기 쉽게). */
const valuesOf = (filter: FilterNode | null) => Object.fromEntries(fill(filter).map((c) => [c.propertyId, c.value]))

describe('① 값 하나를 정하는 조건', () => {
  test('글 · 숫자 · 선택 · 상태 · 체크박스 · 날짜의 equals', () => {
    const got = valuesOf({
      op: 'and',
      children: [
        leaf('title', 'equals', '회의록'),
        leaf('memo', 'equals', '메모'),
        leaf('qty', 'equals', 3),
        leaf('kind', 'equals', OPT),
        leaf('state', 'equals', OPT2),
        leaf('done', 'equals', true),
        leaf('due', 'equals', '2026-03-05'),
      ],
    })
    assert.equal((got.title as { title: { plain_text: string }[] }).title[0].plain_text, '회의록')
    assert.equal((got.memo as { rich_text: { plain_text: string }[] }).rich_text[0].plain_text, '메모')
    assert.deepEqual(got.qty, { type: 'number', number: 3 })
    assert.deepEqual(got.kind, { type: 'select', select: { id: OPT } })
    assert.deepEqual(got.state, { type: 'status', status: { id: OPT2 } })
    assert.deepEqual(got.done, { type: 'checkbox', checkbox: true })
    assert.deepEqual(got.due, { type: 'date', date: { start: '2026-03-05' } })
  })

  test('숫자를 글자로 적은 값 · 체크박스의 "true" 글자도 읽는다(필터 값은 느슨하게 저장된다)', () => {
    assert.deepEqual(valuesOf(leaf('qty', 'equals', '12.5')).qty, { type: 'number', number: 12.5 })
    assert.deepEqual(valuesOf(leaf('done', 'equals', 'true')).done, { type: 'checkbox', checkbox: true })
    assert.deepEqual(valuesOf(leaf('qty', 'equals', 'abc')), {}, '수가 아니면 채우지 않는다')
    assert.deepEqual(valuesOf(leaf('qty', 'equals', '')), {}, '빈 글자는 0 이 아니다')
  })

  test('날짜는 날만 — 시각이 붙어 와도 그날', () => {
    assert.deepEqual(valuesOf(leaf('due', 'equals', '2026-03-05T09:30:00Z')).due, { type: 'date', date: { start: '2026-03-05' } })
    assert.deepEqual(valuesOf(leaf('due', 'equals', '다음 주')), {})
  })

  test('체크박스 — "체크 안 함이 아니다" 는 체크 · "체크가 아니다" 는 새 행이 이미 만족한다', () => {
    assert.deepEqual(valuesOf(leaf('done', 'does_not_equal', false)).done, { type: 'checkbox', checkbox: true })
    assert.deepEqual(valuesOf(leaf('done', 'does_not_equal', true)), {})
  })

  test('사람 contains — "나" 는 만드는 사람 · 여럿이면 모두(순서대로 · 겹치지 않게)', () => {
    assert.deepEqual(valuesOf(leaf('who', 'contains', ME_NODE)).who, { type: 'people', people: [{ id: ME }] })
    assert.deepEqual(
      valuesOf({ op: 'and', children: [leaf('who', 'contains', KIM), leaf('who', 'contains', ME_NODE), leaf('who', 'contains', KIM)] }).who,
      { type: 'people', people: [{ id: KIM }, { id: ME }] },
    )
    assert.deepEqual(filterPrefill(leaf('who', 'contains', ME_NODE), typeOf, null), [], '익명이면 "나" 를 채우지 않는다')
  })

  test('★ 상태 is_empty 는 빈 값을 적는다 — 기본 옵션이 들어가 조건 밖이 되지 않게', () => {
    assert.deepEqual(valuesOf(leaf('state', 'is_empty')).state, { type: 'status', status: null })
  })
})

describe('② 채우지 않는 조건', () => {
  for (const [name, node] of [
    ['숫자의 범위', leaf('qty', 'greater_than', 3)],
    ['글의 부분 일치', leaf('title', 'contains', '회의')],
    ['글의 접두사', leaf('title', 'starts_with', '회의')],
    ['선택의 부정', leaf('kind', 'does_not_equal', OPT)],
    ['사람의 부정', leaf('who', 'does_not_contain', ME_NODE)],
    ['날짜의 이후', leaf('due', 'after', '2026-03-05')],
    ['비어 있지 않음', leaf('kind', 'is_not_empty')],
    ['선택의 is_empty(새 행은 이미 비었다 — 기본값이 없다)', leaf('kind', 'is_empty')],
    ['글의 빈 equals', leaf('title', 'equals', '')],
    ['수식', leaf('calc', 'equals', 3)],
    ['고유 ID', leaf('seq', 'equals', 3)],
    ['모르는 속성', leaf('nope', 'equals', 'x')],
  ] as const) {
    test(name, () => assert.deepEqual(fill(node), []))
  }
})

describe('③ AND 로 닿는 조건만', () => {
  test('자식이 둘 이상인 OR 은 통째로 건너뛴다 — 옆의 AND 조건은 채운다', () => {
    const got = valuesOf({
      op: 'and',
      children: [
        leaf('done', 'equals', true),
        { op: 'or', children: [leaf('kind', 'equals', OPT), leaf('kind', 'equals', OPT2)] },
      ],
    })
    assert.deepEqual(Object.keys(got), ['done'])
  })

  test('맨 위가 OR 이면 아무것도 채우지 않는다', () => {
    assert.deepEqual(fill({ op: 'or', children: [leaf('done', 'equals', true), leaf('qty', 'equals', 1)] }), [])
  })

  test('자식이 하나뿐인 OR 은 AND 와 같다 · 중첩 AND 도 내려간다', () => {
    const got = valuesOf({
      op: 'and',
      children: [{ op: 'or', children: [leaf('kind', 'equals', OPT)] }, { op: 'and', children: [leaf('qty', 'equals', 2)] }],
    })
    assert.deepEqual(got, { kind: { type: 'select', select: { id: OPT } }, qty: { type: 'number', number: 2 } })
  })

  test('같은 칸에 서로 다른 값 — 만족할 수 없는 필터라 그 칸은 채우지 않는다(다른 칸은 채운다)', () => {
    const got = valuesOf({
      op: 'and',
      children: [leaf('kind', 'equals', OPT), leaf('kind', 'equals', OPT2), leaf('qty', 'equals', 1)],
    })
    assert.deepEqual(Object.keys(got), ['qty'])
  })

  test('같은 칸에 같은 값이 두 번이면 하나', () => {
    assert.equal(fill({ op: 'and', children: [leaf('kind', 'equals', OPT), leaf('kind', 'equals', OPT)] }).length, 1)
  })

  test('상태의 빈 값과 옵션이 함께면 채우지 않는다', () => {
    assert.deepEqual(fill({ op: 'and', children: [leaf('state', 'is_empty'), leaf('state', 'equals', OPT)] }), [])
  })

  test('필터가 없으면 아무것도', () => {
    assert.deepEqual(fill(null), [])
  })
})

describe('status 의 그룹 단위 (10n-23)', () => {
  test('그룹 조건은 채우지 않는다 — 그 그룹의 옵션이 여럿이다(②)', () => {
    const typeOf = (id: string) => (id === 'progress' ? 'status' : undefined)
    assert.deepEqual(filterPrefill({ property_id: 'progress', operator: 'group_is', value: 'complete' }, typeOf, null), [])
    assert.deepEqual(filterPrefill({ property_id: 'progress', operator: 'group_is_not', value: 'todo' }, typeOf, null), [])
  })
})
