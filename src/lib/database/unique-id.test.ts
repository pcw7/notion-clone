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
 *   ⑥ ★ 화면(2a-2) — 필터 값 칸은 `12` 도 `TASK-12` 도 받는다 · 도구줄은 셀 컬럼 + 고유 ID 를 거르고 정렬한다 · 정렬 판정이 rollup ·
 *        relation · 옵션 타입을 뺀다(전에는 rollup 머리에 눌러도 아무 일 없는 정렬이 섰다) · 필터 초안이 고유 ID 규칙을 만든다
 *   ⑦ ★ 내보내기(2a-2b) — 스냅숏이 끼운 칸(노션 API 모양)을 CSV · 행 Markdown 이 보이는 그대로 쓴다 · 손상된 칸은 빈 글자 · 수식 막기 대상이 아니다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  UNIQUE_ID_PREFIX_PATTERN,
  formatUniqueId,
  normalizeUniqueIdPrefix,
  parseUniqueIdQuery,
  uniqueIdCell,
  uniqueIdCellText,
} from './unique-id-format.ts'
import { cellPlainText, tableToCsv } from '../export/csv.ts'
import { isFilterableColumn, isSortable, type ViewColumn } from './view-columns.ts'
import { describeRule, ruleFor, toFilter } from './filter-draft.ts'
import type { OperatorCatalogEntry } from './operator-catalog.ts'
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

const columnOf = (type: string): ViewColumn =>
  ({ propertyId: 'p', name: 'n', visible: true, orderKey: 'a0', width: null, wrap: false, options: [], type }) as ViewColumn

const CATALOG: OperatorCatalogEntry[] = [
  { propertyType: 'unique_id', operator: 'equals', arity: 1, label: '같음' },
  { propertyType: 'unique_id', operator: 'greater_than', arity: 1, label: '초과' },
]

describe('⑥ 화면', () => {
  test('★ 필터 값 칸 — 번호도, 보이는 그대로의 `TASK-12` 도 받는다', () => {
    assert.equal(parseUniqueIdQuery('12'), 12)
    assert.equal(parseUniqueIdQuery(' TASK-12 '), 12)
    assert.equal(parseUniqueIdQuery('task-7'), 7)
    assert.equal(parseUniqueIdQuery('0'), 0)
  })

  test('번호가 아니면 받지 않는다', () => {
    for (const text of ['', '  ', 'abc', '1.5', '-3', 'TA-SK-1', 'TASK-', '12a']) {
      assert.equal(parseUniqueIdQuery(text), null, JSON.stringify(text))
    }
  })

  test('★ 도구줄이 거를 수 있는 컬럼 — 셀 컬럼 + 고유 ID', () => {
    assert.equal(isFilterableColumn(columnOf('unique_id')), true)
    assert.equal(isFilterableColumn(columnOf('number')), true)
    assert.equal(isFilterableColumn(columnOf('rollup')), false)
    assert.equal(isFilterableColumn(columnOf('relation')), false)
  })

  test('★ 정렬 판정 — 고유 ID 는 되고, rollup · relation · 옵션 타입은 안 된다', () => {
    assert.equal(isSortable({ type: 'unique_id' }), true)
    assert.equal(isSortable({ type: 'number' }), true)
    assert.equal(isSortable({ type: 'title' }), true)
    for (const type of ['rollup', 'relation', 'select', 'status'] as const) assert.equal(isSortable({ type }), false, type)
  })

  test('필터 초안 — 고유 ID 규칙을 만들고 칩에 번호를 적는다', () => {
    const rule = ruleFor('pId', 'unique_id', CATALOG)
    assert.deepEqual(rule, { property_id: 'pId', operator: 'equals' })
    const filled = { ...rule, operator: 'greater_than', value: 3 }
    assert.deepEqual(toFilter([filled], new Map([['pId', 'unique_id' as const]]), CATALOG), {
      op: 'and',
      children: [{ property_id: 'pId', operator: 'greater_than', value: 3 }],
    })
    assert.equal(describeRule(filled, { propertyId: 'pId', name: 'ID', type: 'unique_id', options: [] }, CATALOG), 'ID · 초과 · 3')
  })
})

describe('⑦ 내보내기', () => {
  test('★ 칸은 노션 API 모양이고 보이는 그대로 쓴다', () => {
    assert.deepEqual(uniqueIdCell('TASK', 12), { type: 'unique_id', unique_id: { prefix: 'TASK', number: 12 } })
    assert.equal(uniqueIdCellText(uniqueIdCell('TASK', 12)), 'TASK-12')
    assert.equal(uniqueIdCellText(uniqueIdCell(null, 3)), '3')
  })

  test('손상된 칸 · 다른 타입의 칸은 빈 글자', () => {
    for (const raw of [undefined, null, 5, {}, { type: 'number', number: 5 }, { type: 'unique_id' }, { type: 'unique_id', unique_id: { number: 0 } }, { type: 'unique_id', unique_id: { number: '7' } }]) {
      assert.equal(uniqueIdCellText(raw), '', JSON.stringify(raw))
    }
  })

  test('★ CSV · 행 Markdown 의 함수가 ID 열을 쓴다 — 수식 막기는 걸리지 않는다', () => {
    const column = { propertyId: 'pId', name: 'ID', type: 'unique_id' as const }
    assert.equal(cellPlainText(column, uniqueIdCell('BUG', 7)), 'BUG-7')
    const { csv, guardedFormulas } = tableToCsv(
      [{ propertyId: 't', name: '이름', type: 'title' }, column],
      [{ cells: { pId: uniqueIdCell('BUG', 7) } }, { cells: {} }],
    )
    assert.equal(csv, '﻿이름,ID\r\n,BUG-7\r\n,\r\n')
    assert.equal(guardedFormulas, 0)
  })
})
