/**
 * 고유 ID — 접두사 · 표시 · 필터와 정렬의 컴파일 (DB 심화 2a-1조각 · F-03-09 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 접두사 — 대소문자를 가리지 않고 받아 **대문자로**, 앞뒤 공백은 걷고, 비우면 "없음". 영숫자 2~7자가 아니면 거부하고
 *        고쳐 주지 않는다(`TA-SK` → `TASK` 로 바꾸지 않는다). 저장 CHECK(0050)과 같은 식이다
 *   ② 표시 — `접두사-번호`, 접두사가 없으면 번호만, 번호가 없으면(템플릿) 빈 문자열
 *   ③ ★ 필터 — 셀이 아니라 **행의 열**(`p.unique_seq`)을 본다(EXISTS 가 없다). 부정은 `IS NOT TRUE`. 값은 파라미터로만 간다.
 *        비어 있음 · 비어 있지 않음은 없다(정본 ⑧)
 *   ④ 정렬 · 커서 — 같은 열을 키로 쓴다(서브쿼리가 없다). 커서의 캐스트가 붙는다
 *   ⑤ 셀 타입이 아니다 — 셀 컬럼으로 취급되지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { UNIQUE_ID_PREFIX_PATTERN, formatUniqueId, normalizeUniqueIdPrefix } from './unique-id-format.ts'
import {
  ParamBag,
  compileCursor,
  compileFilter,
  compileSorts,
  isFilterableType,
  operatorArity,
  operatorsFor,
  validateFilter,
} from './filter.ts'
import { isMvpPropertyType, isAppPropertyType } from './property-types.ts'

const TYPES = new Map<string, string>([
  ['pId', 'unique_id'],
  ['pNum', 'number'],
])

describe('① 접두사', () => {
  test('★ 대문자로 바꾸고 앞뒤 공백을 걷는다', () => {
    assert.deepEqual(normalizeUniqueIdPrefix('task'), { ok: true, prefix: 'TASK' })
    assert.deepEqual(normalizeUniqueIdPrefix('  Bug7 '), { ok: true, prefix: 'BUG7' })
    assert.deepEqual(normalizeUniqueIdPrefix('ab'), { ok: true, prefix: 'AB' })
    assert.deepEqual(normalizeUniqueIdPrefix('ABCDEFG'), { ok: true, prefix: 'ABCDEFG' })
  })

  test('비우면 "없음" — null · 빈 문자열 · 공백만', () => {
    for (const raw of [null, '', '   ']) assert.deepEqual(normalizeUniqueIdPrefix(raw), { ok: true, prefix: null }, String(raw))
  })

  test('★ 2~7자 영숫자가 아니면 거부한다 — 고쳐 주지 않는다', () => {
    for (const raw of ['T', 'ABCDEFGH', 'TA-SK', 'TA SK', '작업', 'ÄB', 42, undefined, {}]) {
      assert.deepEqual(normalizeUniqueIdPrefix(raw), { ok: false }, JSON.stringify(raw))
    }
  })

  test('저장 CHECK(0050)과 같은 식이다', () => {
    assert.equal(UNIQUE_ID_PREFIX_PATTERN.source, '^[A-Z0-9]{2,7}$')
  })
})

describe('② 표시', () => {
  test('접두사-번호 · 번호만 · 번호가 없으면 빈 문자열', () => {
    assert.equal(formatUniqueId('TASK', 12), 'TASK-12')
    assert.equal(formatUniqueId(null, 12), '12')
    assert.equal(formatUniqueId('TASK', null), '')
  })
})

const compile = (node: Parameters<typeof compileFilter>[0]) => {
  const params = new ParamBag(1)
  return { sql: compileFilter(node, TYPES, params), values: params.values }
}

describe('③ 필터', () => {
  test('★ 행의 열을 바로 본다 — EXISTS · 사이드카가 없다', () => {
    const { sql, values } = compile({ property_id: 'pId', operator: 'greater_than', value: 3 })
    assert.equal(sql, 'p.unique_seq > $1::numeric')
    assert.deepEqual(values, [3])
  })

  test('★ 부정은 IS NOT TRUE — NOT EXISTS 가 아니다', () => {
    const { sql } = compile({ property_id: 'pId', operator: 'does_not_equal', value: 5 })
    assert.equal(sql, '(p.unique_seq = $1::numeric) IS NOT TRUE')
  })

  test('값은 숫자로 바인딩한다 — 문자열 번호도', () => {
    assert.deepEqual(compile({ property_id: 'pId', operator: 'equals', value: '7' }).values, [7])
  })

  test('★ 연산자는 비교 여섯 — 비어 있음 · 비어 있지 않음이 없다', () => {
    assert.deepEqual(operatorsFor('unique_id').sort(), [
      'does_not_equal',
      'equals',
      'greater_than',
      'greater_than_or_equal_to',
      'less_than',
      'less_than_or_equal_to',
    ])
    assert.equal(operatorArity('unique_id', 'is_empty'), null)
    assert.equal(compile({ property_id: 'pId', operator: 'is_empty' }).sql, null)
    assert.equal(validateFilter({ property_id: 'pId', operator: 'is_empty' }, TYPES).length, 1)
    assert.deepEqual(validateFilter({ property_id: 'pId', operator: 'equals', value: 1 }, TYPES), [])
  })

  test('다른 규칙과 묶여도 같은 모양이다', () => {
    const { sql } = compile({
      op: 'and',
      children: [
        { property_id: 'pId', operator: 'less_than', value: 10 },
        { property_id: 'pNum', operator: 'equals', value: 1 },
      ],
    })
    assert.ok(sql?.startsWith('(p.unique_seq < $1::numeric AND EXISTS'), sql ?? '')
  })
})

describe('④ 정렬 · 커서', () => {
  test('정렬 키는 행의 열이다', () => {
    const sorted = compileSorts([{ property_id: 'pId', direction: 'desc' }], TYPES, new ParamBag(1))
    assert.equal(sorted.orderBy, 'p.unique_seq DESC NULLS LAST, b.order_key COLLATE "C" ASC')
    assert.deepEqual(sorted.keys, [{ expr: 'p.unique_seq', direction: 'desc', cast: '::numeric' }])
  })

  test('커서는 그 열과 캐스트로 비교한다', () => {
    const params = new ParamBag(1)
    const sorted = compileSorts([{ property_id: 'pId', direction: 'asc' }], TYPES, params)
    const sql = compileCursor(sorted, ['4', 'a5'], params) ?? ''
    assert.ok(sql.includes('p.unique_seq > $1::numeric'), sql)
  })
})

describe('⑤ 셀이 아니다', () => {
  test('앱 타입이지만 셀 타입이 아니고, 거를 수 있다', () => {
    assert.equal(isAppPropertyType('unique_id'), true)
    assert.equal(isMvpPropertyType('unique_id'), false)
    assert.equal(isFilterableType('unique_id'), true)
    assert.equal(isFilterableType('rollup'), false)
    assert.equal(isFilterableType('relation'), false)
  })
})
