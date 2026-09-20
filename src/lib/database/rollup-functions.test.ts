/**
 * rollup 의 계약과 집계 함수 — rollup 5c-1조각 (F-03-11, DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 함수 11종 — 대상 타입이 고를 수 있는 것을 정하고, 맞지 않는 함수는 읽을 때 `show_original` 로 접힌다
 *   ② **0 과 "없음"은 다르다**(F-03-11 엣지 케이스 표) — 연결 0개의 sum 은 0, average · min · max · percent 는 없음
 *   ③ null 이 섞이면 sum · average 는 무시한다 · count 는 전체, count_values 는 빈 값이 아닌 것만
 *   ④ 체크박스의 `false` 는 빈 값이 아니다 — count_values 에 세고, percent 의 분모에 든다
 *   ⑤ 날짜는 **시작일**로 견주고, 이긴 값을 적힌 그대로 준다(날짜만 적은 값에 시각을 붙이지 않는다)
 *   ⑥ show_original 은 빈 값을 빼고 앞 25개만 싣는다 — 개수는 전체
 *   ⑦ config 읽기 — 모양이 아니면 null, 모르는 함수는 기본 함수
 *
 * 반사실(HANDOFF §3.3-167): average 가 빈 목록에 0 을 주면 ②, null 을 0 으로 세면 ③, `false` 를 빈 값으로 보면 ④,
 * 날짜를 문자열로 견주면 ⑤(오프셋이 붙은 값)가 실패한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregate,
  rollupIsEmpty,
  ROLLUP_FUNCTION_LABEL,
  effectiveRollupFunction,
  isRollupFunction,
  isRollupTargetType,
  readRollupConfig,
  rollupFunctionsFor,
  ROLLUP_FUNCTIONS,
  ROLLUP_SHOW_LIMIT,
} from './rollup-functions.ts'
import { MVP_PROPERTY_TYPES, type CellValue } from './property-types.ts'
import { textRun } from '../contracts/rich-text.ts'

const num = (n: number | null): CellValue => ({ type: 'number', number: n })
const box = (b: boolean): CellValue => ({ type: 'checkbox', checkbox: b })
const day = (start: string | null): CellValue => ({ type: 'date', date: start === null ? null : { start } })
const text = (s: string): CellValue => ({ type: 'rich_text', rich_text: s === '' ? [] : [textRun(s)] })

describe('① 함수와 대상 타입', () => {
  test('함수는 11종이다', () => {
    assert.equal(ROLLUP_FUNCTIONS.length, 11)
    assert.equal(isRollupFunction('sum'), true)
    assert.equal(isRollupFunction('median'), false)
    assert.equal(isRollupFunction(null), false)
  })

  test('★ 타입이 고를 수 있는 함수를 정한다 — 공통 셋 + 타입별', () => {
    const common = ['show_original', 'count', 'count_values']
    assert.deepEqual(rollupFunctionsFor('rich_text'), common)
    assert.deepEqual(rollupFunctionsFor('title'), common)
    assert.deepEqual(rollupFunctionsFor('select'), common)
    assert.deepEqual(rollupFunctionsFor('status'), common)
    assert.deepEqual(rollupFunctionsFor('number'), [...common, 'sum', 'average', 'min', 'max'])
    assert.deepEqual(rollupFunctionsFor('checkbox'), [...common, 'checked', 'percent_checked'])
    assert.deepEqual(rollupFunctionsFor('date'), [...common, 'earliest_date', 'latest_date'])
  })

  test('모든 함수는 어느 타입에선가 고를 수 있다 — 고를 수 없는 함수는 죽은 코드다', () => {
    const reachable = new Set(MVP_PROPERTY_TYPES.flatMap((t) => rollupFunctionsFor(t)))
    assert.deepEqual([...reachable].sort(), [...ROLLUP_FUNCTIONS].sort())
  })

  test('★ 맞지 않는 함수는 읽을 때 show_original 로 접힌다 — 던지지 않는다', () => {
    assert.equal(effectiveRollupFunction('sum', 'number'), 'sum')
    assert.equal(effectiveRollupFunction('sum', 'rich_text'), 'show_original')
    assert.equal(effectiveRollupFunction('percent_checked', 'date'), 'show_original')
    assert.equal(effectiveRollupFunction('count', 'date'), 'count')
  })

  test('대상이 될 수 있는 것은 셀 타입뿐이다 — relation · rollup 은 안 된다', () => {
    assert.equal(isRollupTargetType('number'), true)
    assert.equal(isRollupTargetType('relation'), false)
    assert.equal(isRollupTargetType('rollup'), false)
    assert.equal(isRollupTargetType('formula'), false)
  })
})

describe('② 0 과 "없음"은 다르다 — 연결 0개', () => {
  test('★ count = 0 · sum = 0 · average · min · max = 없음', () => {
    assert.deepEqual(aggregate('count', []), { kind: 'number', number: 0 })
    assert.deepEqual(aggregate('count_values', []), { kind: 'number', number: 0 })
    assert.deepEqual(aggregate('sum', []), { kind: 'number', number: 0 })
    assert.deepEqual(aggregate('average', []), { kind: 'number', number: null })
    assert.deepEqual(aggregate('min', []), { kind: 'number', number: null })
    assert.deepEqual(aggregate('max', []), { kind: 'number', number: null })
  })

  test('★ checked = 0 이지만 percent_checked 는 없음 — 0 으로 나눈 것은 0% 가 아니다', () => {
    assert.deepEqual(aggregate('checked', []), { kind: 'number', number: 0 })
    assert.deepEqual(aggregate('percent_checked', []), { kind: 'percent', percent: null })
  })

  test('날짜는 없음 · show_original 은 빈 목록', () => {
    assert.deepEqual(aggregate('earliest_date', []), { kind: 'date', date: null })
    assert.deepEqual(aggregate('latest_date', []), { kind: 'date', date: null })
    assert.deepEqual(aggregate('show_original', []), { kind: 'values', values: [], count: 0 })
  })
})

describe('③ null 이 섞였다', () => {
  const values = [num(10), num(null), num(20), num(null)]

  test('★ sum · average 는 null 을 무시한다 — average 의 분모는 값이 있는 것만', () => {
    assert.deepEqual(aggregate('sum', values), { kind: 'number', number: 30 })
    assert.deepEqual(aggregate('average', values), { kind: 'number', number: 15 })
    assert.deepEqual(aggregate('min', values), { kind: 'number', number: 10 })
    assert.deepEqual(aggregate('max', values), { kind: 'number', number: 20 })
  })

  test('★ count 는 전체, count_values 는 빈 값이 아닌 것만', () => {
    assert.deepEqual(aggregate('count', values), { kind: 'number', number: 4 })
    assert.deepEqual(aggregate('count_values', values), { kind: 'number', number: 2 })
    assert.deepEqual(aggregate('count_values', [text('가'), text(''), text('나')]), { kind: 'number', number: 2 })
  })

  test('전부 null 이면 sum 은 0, average 는 없음', () => {
    assert.deepEqual(aggregate('sum', [num(null), num(null)]), { kind: 'number', number: 0 })
    assert.deepEqual(aggregate('average', [num(null)]), { kind: 'number', number: null })
  })

  test('음수 · 0 도 값이다 — min 이 0 을 "없음"으로 읽지 않는다', () => {
    assert.deepEqual(aggregate('min', [num(3), num(0), num(-2)]), { kind: 'number', number: -2 })
    assert.deepEqual(aggregate('max', [num(-3), num(0)]), { kind: 'number', number: 0 })
    assert.deepEqual(aggregate('average', [num(0), num(0)]), { kind: 'number', number: 0 })
  })

  test('부동소수점 찌꺼기를 턴다 — 0.1 + 0.2 는 0.3 이다', () => {
    assert.deepEqual(aggregate('sum', [num(0.1), num(0.2)]), { kind: 'number', number: 0.3 })
    assert.deepEqual(aggregate('average', [num(0.1), num(0.2), num(0.3)]), { kind: 'number', number: 0.2 })
    // 큰 정수는 그대로다.
    assert.deepEqual(aggregate('sum', [num(123456789012), num(1)]), { kind: 'number', number: 123456789013 })
  })

  test('타입이 다른 값은 없는 값이다 — sum 에 글이 와도 던지지 않는다', () => {
    assert.deepEqual(aggregate('sum', [text('가'), num(5)]), { kind: 'number', number: 5 })
  })
})

describe('④ 체크박스', () => {
  const values = [box(true), box(false), box(true), box(false)]

  test('★ `false` 는 빈 값이 아니다 — count_values 가 센다', () => {
    assert.deepEqual(aggregate('count_values', values), { kind: 'number', number: 4 })
  })

  test('★ checked 는 개수, percent_checked 는 전체에 대한 비율(0..1)', () => {
    assert.deepEqual(aggregate('checked', values), { kind: 'number', number: 2 })
    assert.deepEqual(aggregate('percent_checked', values), { kind: 'percent', percent: 0.5 })
    assert.deepEqual(aggregate('percent_checked', [box(false)]), { kind: 'percent', percent: 0 })
    assert.deepEqual(aggregate('percent_checked', [box(true), box(true), box(false)]), {
      kind: 'percent',
      percent: Number((2 / 3).toPrecision(15)),
    })
  })
})

describe('⑤ 날짜', () => {
  test('★ 시작일로 견준다 — 이긴 값을 적힌 그대로 준다', () => {
    const values = [day('2026-03-10'), day(null), day('2026-01-05'), day('2026-02-01')]
    assert.deepEqual(aggregate('earliest_date', values), { kind: 'date', date: '2026-01-05' })
    assert.deepEqual(aggregate('latest_date', values), { kind: 'date', date: '2026-03-10' })
  })

  test('★ 문자열이 아니라 **시각**으로 견준다 — 오프셋이 붙은 값', () => {
    // 글자로는 "…T23:00+09:00" 이 뒤지만, 시각으로는 그쪽이 이르다(14:00Z < 20:00Z).
    const a = day('2026-01-05T23:00:00+09:00')
    const b = day('2026-01-05T20:00:00Z')
    assert.deepEqual(aggregate('earliest_date', [b, a]), { kind: 'date', date: '2026-01-05T23:00:00+09:00' })
    assert.deepEqual(aggregate('latest_date', [a, b]), { kind: 'date', date: '2026-01-05T20:00:00Z' })
  })

  test('범위의 끝은 보지 않는다 — 시작이 이른 쪽이 이르다', () => {
    const long: CellValue = { type: 'date', date: { start: '2026-01-01', end: '2026-12-31' } }
    assert.deepEqual(aggregate('latest_date', [long, day('2026-06-01')]), { kind: 'date', date: '2026-06-01' })
  })

  test('같은 시각이면 앞선 연결이 남는다', () => {
    assert.deepEqual(aggregate('earliest_date', [day('2026-01-05'), day('2026-01-05T00:00:00Z')]), {
      kind: 'date',
      date: '2026-01-05',
    })
  })
})

describe('⑥ show_original', () => {
  test('★ 빈 값은 빼고 엣지 순서대로 — 체크박스의 false 는 남는다', () => {
    assert.deepEqual(aggregate('show_original', [text('가'), text(''), text('나')]), {
      kind: 'values',
      values: [text('가'), text('나')],
      count: 2,
    })
    assert.deepEqual(aggregate('show_original', [box(false), box(true)]), {
      kind: 'values',
      values: [box(false), box(true)],
      count: 2,
    })
  })

  test(`★ 앞 ${ROLLUP_SHOW_LIMIT}개만 싣고 개수는 전체다`, () => {
    const many = Array.from({ length: ROLLUP_SHOW_LIMIT + 7 }, (_, i) => num(i))
    const result = aggregate('show_original', many)
    assert.equal(result.kind, 'values')
    if (result.kind !== 'values') return
    assert.equal(result.values.length, ROLLUP_SHOW_LIMIT)
    assert.equal(result.count, ROLLUP_SHOW_LIMIT + 7)
    assert.deepEqual(result.values[0], num(0))
  })
})

describe('⑦ config 읽기', () => {
  test('모양이 맞으면 읽는다', () => {
    assert.deepEqual(readRollupConfig({ relation_property_id: 'r', target_property_id: 't', function: 'sum' }), {
      relation_property_id: 'r',
      target_property_id: 't',
      function: 'sum',
    })
  })

  test('★ 모르는 함수는 기본 함수로 읽는다 — 카탈로그를 줄이는 날에도 표가 열린다', () => {
    assert.equal(readRollupConfig({ relation_property_id: 'r', target_property_id: 't', function: 'median' })?.function, 'show_original')
    assert.equal(readRollupConfig({ relation_property_id: 'r', target_property_id: 't' })?.function, 'show_original')
  })

  test('relation · 대상이 없으면 null', () => {
    assert.equal(readRollupConfig({ target_property_id: 't', function: 'sum' }), null)
    assert.equal(readRollupConfig({ relation_property_id: '', target_property_id: 't' }), null)
    assert.equal(readRollupConfig({ relation_property_id: 'r', target_property_id: 7 }), null)
    assert.equal(readRollupConfig(null), null)
    assert.equal(readRollupConfig([]), null)
  })
})

describe('⑧ 화면이 묻는 것 (5c-2)', () => {
  test('함수마다 화면에 그릴 이름이 있다 — 목록에서 고르는 글자다', () => {
    for (const fn of ROLLUP_FUNCTIONS) {
      assert.equal(typeof ROLLUP_FUNCTION_LABEL[fn], 'string', fn)
      assert.ok(ROLLUP_FUNCTION_LABEL[fn].length > 0, fn)
    }
    assert.equal(new Set(Object.values(ROLLUP_FUNCTION_LABEL)).size, ROLLUP_FUNCTIONS.length, '이름이 겹치면 무엇을 골랐는지 모른다')
  })

  test('★ 그릴 것이 없는 칸 — 받지 못한 칸 · 없음(null) 은 비었고, **0 과 false 는 값이다**', () => {
    assert.equal(rollupIsEmpty(undefined), true, '아직 받지 못했다')
    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'number', number: null }, hidden: 0 }), true)
    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'percent', percent: null }, hidden: 0 }), true)
    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'date', date: null }, hidden: 0 }), true)
    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'values', values: [], count: 0 }, hidden: 0 }), true)

    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'number', number: 0 }, hidden: 0 }), false, '0 은 값이다')
    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'percent', percent: 0 }, hidden: 0 }), false, '0% 는 값이다')
    assert.equal(
      rollupIsEmpty({ state: 'ok', result: { kind: 'values', values: [box(false)], count: 1 }, hidden: 0 }),
      false,
      'false 는 값이다',
    )
  })

  test('★ 말할 것이 있으면 비어 있지 않다 — 볼 수 없는 항목 · 너무 많음', () => {
    assert.equal(rollupIsEmpty({ state: 'ok', result: { kind: 'number', number: null }, hidden: 2 }), false)
    assert.equal(rollupIsEmpty({ state: 'too_many' }), false)
  })
})
