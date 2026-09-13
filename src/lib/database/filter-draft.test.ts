/**
 * 필터 · 정렬 패널의 초안 — W8-b (F-04-09 · F-04-10, DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **OR · 중첩 필터는 편집할 수 없다고 말한다** — 평평하게 펴서 다시 저장하면 뜻이 바뀐다
 *   ② **덜 찬 규칙은 보내지 않는다** — 타이핑 중인 규칙이 나머지 저장을 막지 않는다
 *   ③ **지워진 속성의 규칙 · 정렬은 저장 전에 뺀다** — 서버의 쓰기 검증이 통째로 거부한다
 *   ④ 만든 필터 · 정렬은 **서버와 같은 검증 함수**를 통과한다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  addSort,
  describeRule,
  isComplete,
  liveSorts,
  moveSort,
  readRules,
  ruleFor,
  sortFirst,
  toFilter,
  withOperator,
  type RuleColumn,
} from './filter-draft.ts'
import { MAX_SORT_KEYS, validateFilter, validateSorts, type SortKey } from './filter.ts'
import type { OperatorCatalogEntry } from './operator-catalog.ts'
import type { MvpPropertyType } from './property-types.ts'

// 마이그레이션 0015 시딩의 일부. 실제 표와의 일치는 filter.db.test.ts 가 본다.
const catalog: OperatorCatalogEntry[] = [
  { propertyType: 'rich_text', operator: 'contains', arity: 1, label: '포함' },
  { propertyType: 'rich_text', operator: 'is_empty', arity: 0, label: '비어 있음' },
  { propertyType: 'number', operator: 'equals', arity: 1, label: '같음' },
  { propertyType: 'number', operator: 'greater_than', arity: 1, label: '초과' },
  { propertyType: 'number', operator: 'is_empty', arity: 0, label: '비어 있음' },
  { propertyType: 'checkbox', operator: 'equals', arity: 1, label: '이다' },
  { propertyType: 'select', operator: 'equals', arity: 1, label: '같음' },
  { propertyType: 'date', operator: 'before', arity: 1, label: '이전' },
]

const types = new Map<string, MvpPropertyType>([
  ['memo', 'rich_text'],
  ['qty', 'number'],
  ['done', 'checkbox'],
  ['status', 'select'],
  ['due', 'date'],
])

describe('readRules — ① 평평한 AND 만 편집한다', () => {
  test('필터가 없으면 빈 목록이다', () => {
    assert.deepEqual(readRules(null), { editable: true, rules: [] })
  })

  test('규칙 하나(그룹 없음)도 편다', () => {
    const leaf = { property_id: 'qty', operator: 'equals', value: 3 }
    assert.deepEqual(readRules(leaf), { editable: true, rules: [leaf] })
  })

  test('AND 그룹의 규칙들을 편다', () => {
    const a = { property_id: 'qty', operator: 'equals', value: 3 }
    const b = { property_id: 'memo', operator: 'is_empty' }
    assert.deepEqual(readRules({ op: 'and', children: [a, b] }), { editable: true, rules: [a, b] })
  })

  test('★ OR 그룹은 편집할 수 없다 — 펴서 저장하면 AND 로 뜻이 바뀐다', () => {
    const r = readRules({
      op: 'or',
      children: [
        { property_id: 'qty', operator: 'equals', value: 3 },
        { property_id: 'qty', operator: 'equals', value: 4 },
      ],
    })
    assert.equal(r.editable, false)
  })

  test('자식이 하나뿐인 OR 는 AND 와 뜻이 같아 편집할 수 있다', () => {
    const only = { property_id: 'qty', operator: 'equals', value: 3 }
    assert.deepEqual(readRules({ op: 'or', children: [only] }), { editable: true, rules: [only] })
  })

  test('★ 중첩 그룹은 편집할 수 없다', () => {
    const r = readRules({
      op: 'and',
      children: [{ op: 'or', children: [{ property_id: 'qty', operator: 'equals', value: 3 }] }],
    })
    assert.equal(r.editable, false)
  })
})

describe('toFilter — ② 덜 찬 규칙 · ③ 지워진 속성', () => {
  test('★ 값이 없는 규칙은 빼고 나머지를 저장한다', () => {
    const filter = toFilter(
      [
        { property_id: 'qty', operator: 'greater_than', value: 10 },
        { property_id: 'memo', operator: 'contains' }, // 타이핑 전
        { property_id: 'memo', operator: 'contains', value: '' }, // 지운 뒤
      ],
      types,
      catalog,
    )
    assert.deepEqual(filter, { op: 'and', children: [{ property_id: 'qty', operator: 'greater_than', value: 10 }] })
  })

  test('값이 필요 없는 연산자는 값 없이도 완성이고, 남은 값을 싣지 않는다', () => {
    const filter = toFilter([{ property_id: 'memo', operator: 'is_empty', value: '옛 값' }], types, catalog)
    assert.deepEqual(filter, { op: 'and', children: [{ property_id: 'memo', operator: 'is_empty' }] })
  })

  test('★ 지워진 속성의 규칙은 뺀다 — 그대로 보내면 다른 규칙의 저장까지 거부된다', () => {
    const filter = toFilter(
      [
        { property_id: 'gone', operator: 'equals', value: 1 },
        { property_id: 'qty', operator: 'equals', value: 1 },
      ],
      types,
      catalog,
    )
    assert.deepEqual(filter, { op: 'and', children: [{ property_id: 'qty', operator: 'equals', value: 1 }] })
  })

  test('그 타입에 없는 연산자는 뺀다', () => {
    assert.equal(toFilter([{ property_id: 'done', operator: 'contains', value: true }], types, catalog), null)
  })

  test('남는 규칙이 없으면 null — "필터 없음"이다', () => {
    assert.equal(toFilter([], types, catalog), null)
    assert.equal(toFilter([{ property_id: 'memo', operator: 'contains' }], types, catalog), null)
  })

  test('★ 만든 필터는 서버의 쓰기 검증을 통과한다', () => {
    const filter = toFilter(
      [
        { property_id: 'qty', operator: 'greater_than', value: 10 },
        { property_id: 'done', operator: 'equals', value: true },
        { property_id: 'status', operator: 'equals', value: 'opt-1' },
        { property_id: 'due', operator: 'before', value: '2026-09-13' },
        { property_id: 'memo', operator: 'is_empty' },
        { property_id: 'gone', operator: 'equals', value: 1 },
      ],
      types,
      catalog,
    )
    assert.ok(filter !== null)
    assert.deepEqual(validateFilter(filter, types), [])
  })
})

describe('규칙 편집', () => {
  test('속성을 고르면 그 타입의 첫 연산자가 되고 값은 비어 있다', () => {
    assert.deepEqual(ruleFor('qty', 'number', catalog), { property_id: 'qty', operator: 'equals' })
    assert.equal(isComplete(ruleFor('qty', 'number', catalog), 'number', catalog), false)
  })

  test('체크박스는 true 로 시작해 곧바로 완성이다', () => {
    const rule = ruleFor('done', 'checkbox', catalog)
    assert.deepEqual(rule, { property_id: 'done', operator: 'equals', value: true })
    assert.equal(isComplete(rule, 'checkbox', catalog), true)
  })

  test('값이 필요 없는 연산자로 바꾸면 값을 버린다', () => {
    const rule = withOperator({ property_id: 'qty', operator: 'equals', value: 3 }, 'is_empty', 'number', catalog)
    assert.deepEqual(rule, { property_id: 'qty', operator: 'is_empty' })
  })

  test('값이 필요한 연산자끼리 바꾸면 값을 남긴다', () => {
    const rule = withOperator({ property_id: 'qty', operator: 'equals', value: 3 }, 'greater_than', 'number', catalog)
    assert.deepEqual(rule, { property_id: 'qty', operator: 'greater_than', value: 3 })
  })
})

describe('describeRule — 칩의 요약', () => {
  const status: RuleColumn = {
    propertyId: 'status',
    name: '상태',
    type: 'select',
    options: [{ id: 'opt-1', name: '진행 중', color: 'blue' }],
  }

  test('속성 · 연산자 라벨 · 값', () => {
    assert.equal(describeRule({ property_id: 'status', operator: 'equals', value: 'opt-1' }, status, catalog), '상태 · 같음 · 진행 중')
  })

  test('★ select 는 옵션 이름을, 지워진 옵션이면 그렇다고 말한다 (F-03-17)', () => {
    assert.equal(describeRule({ property_id: 'status', operator: 'equals', value: 'gone' }, status, catalog), '상태 · 같음 · 지워진 옵션')
  })

  test('★ 지워진 속성의 규칙은 무시된다고 말한다 — 조용히 사라지지 않는다', () => {
    assert.equal(describeRule({ property_id: 'gone', operator: 'equals', value: 1 }, undefined, catalog), '지워진 속성 (무시됨)')
  })

  test('값이 없는 연산자 · 아직 값을 안 넣은 규칙 · 날짜 · 체크박스', () => {
    const qty: RuleColumn = { propertyId: 'qty', name: '수량', type: 'number', options: [] }
    const due: RuleColumn = { propertyId: 'due', name: '마감', type: 'date', options: [] }
    const done: RuleColumn = { propertyId: 'done', name: '완료', type: 'checkbox', options: [] }
    assert.equal(describeRule({ property_id: 'qty', operator: 'is_empty' }, qty, catalog), '수량 · 비어 있음')
    assert.equal(describeRule({ property_id: 'qty', operator: 'equals' }, qty, catalog), '수량 · 같음 · …')
    assert.equal(describeRule({ property_id: 'due', operator: 'before', value: '2026-09-13' }, due, catalog), '마감 · 이전 · 2026년 9월 13일')
    assert.equal(describeRule({ property_id: 'done', operator: 'equals', value: false }, done, catalog), '완료 · 이다 · 체크 안 됨')
  })
})

describe('정렬', () => {
  const asc = (id: string): SortKey => ({ property_id: id, direction: 'asc' })

  test('더하면 오름차순으로 뒤에 붙는다', () => {
    assert.deepEqual(addSort([asc('qty')], 'due'), [asc('qty'), asc('due')])
  })

  test('★ 같은 속성은 두 번 넣지 않는다 — 서버도 거부한다', () => {
    assert.deepEqual(addSort([asc('qty')], 'qty'), [asc('qty')])
  })

  test('상한을 넘기지 않는다', () => {
    const full = ['qty', 'due', 'memo'].map(asc)
    assert.equal(full.length, MAX_SORT_KEYS)
    assert.deepEqual(addSort(full, 'status'), full)
  })

  test('우선순위를 한 칸 옮기고, 끝에서는 그대로다', () => {
    const s = ['qty', 'due', 'memo'].map(asc)
    assert.deepEqual(moveSort(s, 2, -1).map((k) => k.property_id), ['qty', 'memo', 'due'])
    assert.deepEqual(moveSort(s, 0, -1), s)
    assert.deepEqual(moveSort(s, 2, 1), s)
  })

  test('★ 머리 메뉴의 정렬은 그 속성을 첫 키로 둔다 — 뒤에 붙이면 눌러도 변화가 없어 보인다', () => {
    const s = [asc('qty'), asc('due')]
    assert.deepEqual(sortFirst(s, 'due', 'desc'), [{ property_id: 'due', direction: 'desc' }, asc('qty')])
    assert.deepEqual(sortFirst(['qty', 'due', 'memo'].map(asc), 'status', 'asc').map((k) => k.property_id), ['status', 'qty', 'due'])
  })

  test('★ 지워진 속성의 정렬 키를 뺀다 (F-04-10) — 결과는 서버 검증을 통과한다', () => {
    const s = liveSorts([asc('gone'), asc('qty')], types)
    assert.deepEqual(s, [asc('qty')])
    assert.deepEqual(validateSorts(s, types), [])
    assert.ok(validateSorts([asc('gone'), asc('qty')], types).length > 0, '빼지 않으면 서버가 거부한다')
  })
})
