/**
 * 공개 API 의 질의 DSL — 노션의 `filter` · `sorts` → 앱의 필터 트리 · 정렬 키 (API-4 · F-09-16 · 순수)
 *
 *   ★ 타입마다 노션의 조건 전부 — 옮긴 잎은 앱의 컴파일러가 **아는 연산자**다(건너뛰지 않는다 — SQL 이 나온다)
 *   ★ 열쇠 — 속성의 타입(글 계열은 rich_text · 시각은 date · 사람은 people 도) · 이름 또는 id · 제목은 'title' · 다른 타입의 열쇠는 거부
 *   ★ 값 — 선택류는 옵션 이름 → id(없는 이름은 아무 옵션도 아닌 id · 같은 이름이 여럿이면 묶음) · 사람의 "me" · uuid 는 대시 없이도 ·
 *     날짜는 ISO 8601 만 · is_empty 는 true 만 · 상대 날짜는 {} 만
 *   ★ 수식 — 결과 타입의 열쇠 · 다른 열쇠는 거부 / rollup · 장소 · 버튼 — 400 으로 그렇다고 말한다
 *   ★ timestamp — 행 자신의 시각(속성이 없어도) · 정렬도
 *   ★ compound — 두 겹까지 · 배열마다 100개 · 한 열쇠만
 *   ★ 정렬 — 차례가 우선순위 · ascending/descending · 같은 속성은 첫째만 · 정렬할 수 없는 타입은 거부
 *   ★ 커서 — 지문 · 준 행 수 · 앱의 커서를 싣고 되읽는다 · 모양이 틀리면 null · 지문은 같은 질의에서만 같다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { compileFilter, compileSorts, isGroup, ME_NODE, ParamBag, ROW_TIMESTAMP_KEYS, withRowTimestamps, formulaTypeKey, type FilterNode } from '../database/filter.ts'
import { RELATIVE_DATE_OPERATORS } from '../database/relative-date.ts'
import type { SelectOption } from '../database/property-types.ts'
import type { ApiProperty } from './property-values.ts'
import {
  API_FILTER_MAX_ITEMS,
  decodeQueryCursor,
  encodeQueryCursor,
  queryFingerprint,
  translateFilter,
  translateSorts,
} from './query-dsl.ts'

const U1 = '11111111-1111-4111-8111-111111111111'
const O1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const O2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const O3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NO_OPTION = '00000000-0000-0000-0000-000000000000'

const p = (id: string, name: string, type: string, config: unknown = {}): ApiProperty => ({ id, name, type, config })
const schema: ApiProperty[] = [
  p('p_title', '이름', 'title'),
  p('p_text', '메모', 'rich_text'),
  p('p_url', '주소', 'url'),
  p('p_email', '메일', 'email'),
  p('p_phone', '전화', 'phone_number'),
  p('p_num', '점수', 'number'),
  p('p_check', '완료', 'checkbox'),
  p('p_select', '종류', 'select'),
  p('p_status', '상태', 'status'),
  p('p_multi', '태그', 'multi_select'),
  p('p_date', '기한', 'date'),
  p('p_ctime', '만든 시각', 'created_time'),
  p('p_etime', '고친 시각', 'last_edited_time'),
  p('p_people', '담당', 'people'),
  p('p_cby', '만든 사람', 'created_by'),
  p('p_eby', '고친 사람', 'last_edited_by'),
  p('p_rel', '관련', 'relation', { target_data_source_id: U1 }),
  p('p_files', '파일', 'files'),
  p('p_uid', '번호', 'unique_id'),
  p('p_verify', '검증', 'verification'),
  p('p_fnum', '두배', 'formula', { expression: 'prop("점수") * 2', result_type: 'number' }),
  p('p_ftext', '글식', 'formula', { expression: '"a"', result_type: 'text' }),
  p('p_fbool', '참식', 'formula', { expression: 'true', result_type: 'boolean' }),
  p('p_fdate', '날식', 'formula', { expression: 'now()', result_type: 'date' }),
  p('p_rollup', '합', 'rollup', { relation_property_id: 'p_rel', target_property_id: 'x', function: 'sum' }),
  p('p_place', '장소', 'place'),
  p('p_button', '버튼', 'button'),
]
const opt = (id: string, name: string): SelectOption => ({ id, name, color: 'default' })
const options = new Map<string, SelectOption[]>([
  ['p_select', [opt(O1, '버그'), opt(O2, '기능')]],
  ['p_status', [opt(O1, '할 일'), opt(O2, '완료')]],
  // 같은 이름이 둘
  ['p_multi', [opt(O1, '급함'), opt(O2, '나중'), opt(O3, '급함')]],
])

/** 앱의 타입 맵 — 행 질의(`queryRows`)가 만드는 것과 같다(수식은 결과 타입과 · 행 시각의 열쇠). */
const types = withRowTimestamps(
  new Map(schema.map((x) => [x.id, x.type === 'formula' ? formulaTypeKey((x.config as { result_type: string }).result_type) : x.type])),
)

function translated(filter: unknown): FilterNode | null {
  const r = translateFilter(filter, schema, options)
  if (!r.ok) throw new Error(r.message)
  return r.value
}

function refused(filter: unknown): string {
  const r = translateFilter(filter, schema, options)
  assert.equal(r.ok, false, `거부돼야 한다: ${JSON.stringify(filter)}`)
  return r.ok ? '' : r.message
}

/** 앱의 컴파일러가 잎마다 SQL 을 낸다 — 모르는 연산자 · 타입이면 null 로 건너뛴다. */
function compilesEveryLeaf(node: FilterNode): void {
  if (isGroup(node)) return node.children.forEach(compilesEveryLeaf)
  const sql = compileFilter(node, types, new ParamBag(2), { me: U1, today: '2026-11-17' })
  assert.notEqual(sql, null, `앱의 컴파일러가 건너뛰었다: ${JSON.stringify(node)}`)
}

const leaf = (property: string, key: string, operator: string, value: unknown) => ({ property, [key]: { [operator]: value } })

describe('★ 타입마다 노션의 조건 전부 — 앱의 연산자로', () => {
  const TEXT_OPS: [string, unknown][] = [
    ['equals', 'a'], ['does_not_equal', 'a'], ['contains', 'a'], ['does_not_contain', 'a'], ['starts_with', 'a'], ['ends_with', 'a'],
    ['is_empty', true], ['is_not_empty', true],
  ]
  const NUMBER_OPS: [string, unknown][] = [
    ['equals', 1], ['does_not_equal', 1], ['greater_than', 1], ['greater_than_or_equal_to', 1], ['less_than', 1], ['less_than_or_equal_to', 1],
  ]
  const DATE_OPS: [string, unknown][] = [
    ['equals', '2026-03-01'], ['before', '2026-03-01T09:00:00+09:00'], ['after', '2026-03-01T09:00'], ['on_or_before', '2026-03-01'],
    ['on_or_after', '2026-03-01T00:00:00.000Z'], ['is_empty', true], ['is_not_empty', true],
    ...RELATIVE_DATE_OPERATORS.map((op): [string, unknown] => [op, {}]),
  ]
  const cases: [string, string, [string, unknown][]][] = [
    ['이름', 'title', TEXT_OPS],
    ['메모', 'rich_text', TEXT_OPS],
    ['주소', 'url', TEXT_OPS],
    ['메일', 'email', TEXT_OPS],
    ['전화', 'phone_number', TEXT_OPS],
    ['점수', 'number', [...NUMBER_OPS, ['is_empty', true], ['is_not_empty', true]]],
    ['완료', 'checkbox', [['equals', true], ['does_not_equal', false]]],
    ['종류', 'select', [['equals', '버그'], ['does_not_equal', '기능'], ['is_empty', true], ['is_not_empty', true]]],
    ['상태', 'status', [['equals', '완료'], ['does_not_equal', '할 일'], ['is_empty', true], ['is_not_empty', true]]],
    ['태그', 'multi_select', [['contains', '나중'], ['does_not_contain', '나중'], ['is_empty', true], ['is_not_empty', true]]],
    ['기한', 'date', DATE_OPS],
    ['만든 시각', 'created_time', DATE_OPS],
    ['고친 시각', 'last_edited_time', DATE_OPS],
    ['담당', 'people', [['contains', U1], ['does_not_contain', 'me'], ['is_empty', true], ['is_not_empty', true]]],
    ['만든 사람', 'created_by', [['contains', U1], ['does_not_contain', U1], ['is_empty', true], ['is_not_empty', true]]],
    ['고친 사람', 'last_edited_by', [['contains', 'me'], ['does_not_contain', U1], ['is_empty', true], ['is_not_empty', true]]],
    ['관련', 'relation', [['contains', U1], ['does_not_contain', U1], ['is_empty', true], ['is_not_empty', true]]],
    ['파일', 'files', [['is_empty', true], ['is_not_empty', true]]],
    ['번호', 'unique_id', NUMBER_OPS],
    ['검증', 'verification', [['status', 'verified'], ['status', 'expired'], ['status', 'none'], ['does_not_equal', 'verified']]],
  ]
  for (const [name, key, ops] of cases) {
    test(`${key} — ${ops.map(([op]) => op).join(' · ')}`, () => {
      for (const [op, value] of ops) {
        const node = translated(leaf(name, key, op, value))
        assert.ok(node !== null)
        compilesEveryLeaf(node)
      }
    })
  }

  test('잎의 모양 — 속성 id · 같은 연산자 · 값(is_empty · 상대 날짜는 값이 없다)', () => {
    assert.deepEqual(translated(leaf('점수', 'number', 'greater_than', 3)), { property_id: 'p_num', operator: 'greater_than', value: 3 })
    assert.deepEqual(translated(leaf('메모', 'rich_text', 'is_empty', true)), { property_id: 'p_text', operator: 'is_empty' })
    assert.deepEqual(translated(leaf('기한', 'date', 'past_week', {})), { property_id: 'p_date', operator: 'past_week' })
    assert.deepEqual(translated(leaf('기한', 'date', 'equals', '2026-03-01')), { property_id: 'p_date', operator: 'equals', value: '2026-03-01' })
    assert.deepEqual(translated(leaf('완료', 'checkbox', 'equals', false)), { property_id: 'p_check', operator: 'equals', value: false })
  })

  test('검증 — status → is · does_not_equal → is_not · none → unverified', () => {
    assert.deepEqual(translated(leaf('검증', 'verification', 'status', 'none')), { property_id: 'p_verify', operator: 'is', value: 'unverified' })
    assert.deepEqual(translated(leaf('검증', 'verification', 'does_not_equal', 'expired')), { property_id: 'p_verify', operator: 'is_not', value: 'expired' })
  })
})

describe('★ 열쇠 · 속성 찾기', () => {
  test('글 계열은 rich_text 도 · 시각은 date 도 · 사람은 people 도 받는다', () => {
    assert.deepEqual(translated(leaf('이름', 'rich_text', 'contains', 'a')), { property_id: 'p_title', operator: 'contains', value: 'a' })
    assert.deepEqual(translated(leaf('주소', 'rich_text', 'contains', 'a')), { property_id: 'p_url', operator: 'contains', value: 'a' })
    assert.deepEqual(translated(leaf('만든 시각', 'date', 'after', '2026-01-01')), { property_id: 'p_ctime', operator: 'after', value: '2026-01-01' })
    assert.deepEqual(translated(leaf('만든 사람', 'people', 'contains', U1)), { property_id: 'p_cby', operator: 'contains', value: U1 })
  })

  test('이름 · 우리 id · 제목의 title 로 찾는다 · type 열쇠는 같아야 한다', () => {
    assert.deepEqual(translated(leaf('p_num', 'number', 'equals', 1)), { property_id: 'p_num', operator: 'equals', value: 1 })
    assert.deepEqual(translated(leaf('title', 'title', 'equals', 'x')), { property_id: 'p_title', operator: 'equals', value: 'x' })
    assert.deepEqual(translated({ property: '점수', type: 'number', number: { equals: 1 } }), { property_id: 'p_num', operator: 'equals', value: 1 })
    assert.match(refused({ property: '점수', type: 'rich_text', number: { equals: 1 } }), /type should be `"number"`/)
  })

  test('없는 속성 — 노션의 글 · 다른 타입의 열쇠 · 모르는 조건 · 조건 둘', () => {
    assert.equal(refused(leaf('없음', 'number', 'equals', 1)), 'Could not find property with name or id: 없음')
    assert.match(refused(leaf('점수', 'rich_text', 'equals', 'a')), /"점수" is a number property — use the "number" filter/)
    assert.match(refused(leaf('점수', 'number', 'contains', 1)), /contains is not a supported condition for "점수"/)
    assert.match(refused({ property: '점수', number: { equals: 1, less_than: 3 } }), /exactly one condition/)
    assert.match(refused({ property: '점수', number: { equals: 1 }, checkbox: { equals: true } }), /exactly one filter condition/)
    assert.match(refused(leaf('완료', 'checkbox', 'is_empty', true)), /is_empty is not a supported condition/)
    assert.match(refused(leaf('번호', 'unique_id', 'is_empty', true)), /is_empty is not a supported condition/)
  })
})

describe('★ 값', () => {
  test('선택 — 이름이 옵션 id 로 · 없는 이름은 아무 옵션도 아닌 id(거부하지 않는다)', () => {
    assert.deepEqual(translated(leaf('종류', 'select', 'equals', '기능')), { property_id: 'p_select', operator: 'equals', value: O2 })
    assert.deepEqual(translated(leaf('상태', 'status', 'does_not_equal', '할 일')), { property_id: 'p_status', operator: 'does_not_equal', value: O1 })
    assert.deepEqual(translated(leaf('종류', 'select', 'equals', '없는 옵션')), { property_id: 'p_select', operator: 'equals', value: NO_OPTION })
  })

  test('다중 선택 — 같은 이름이 여럿이면 포함은 or · 포함하지 않음은 and', () => {
    assert.deepEqual(translated(leaf('태그', 'multi_select', 'contains', '급함')), {
      op: 'or',
      children: [
        { property_id: 'p_multi', operator: 'contains', value: O1 },
        { property_id: 'p_multi', operator: 'contains', value: O3 },
      ],
    })
    const negative = translated(leaf('태그', 'multi_select', 'does_not_contain', '급함'))
    assert.equal(negative !== null && isGroup(negative) ? negative.op : null, 'and')
  })

  test('사람의 "me" 는 앱의 "나" · uuid 는 대시 없이도 · 틀리면 거부', () => {
    assert.deepEqual(translated(leaf('담당', 'people', 'contains', 'me')), { property_id: 'p_people', operator: 'contains', value: ME_NODE })
    assert.deepEqual(translated(leaf('관련', 'relation', 'contains', U1.replace(/-/g, '').toUpperCase())), { property_id: 'p_rel', operator: 'contains', value: U1 })
    assert.match(refused(leaf('담당', 'people', 'contains', 'nobody')), /should be a valid uuid or "me"/)
    assert.match(refused(leaf('관련', 'relation', 'contains', 'me')), /should be a valid uuid/)
  })

  test('날짜는 ISO 8601 만 · is_empty 는 true 만 · 상대 날짜는 {} 만 · 숫자 · 불리언 · 글의 모양', () => {
    for (const bad of ['어제', '2026-02-30', '2026-3-1', 12, null, '2026-03-01T25:00']) {
      assert.match(refused(leaf('기한', 'date', 'equals', bad)), /ISO 8601/, String(bad))
    }
    assert.match(refused(leaf('메모', 'rich_text', 'is_empty', false)), /should be `true`/)
    assert.match(refused(leaf('기한', 'date', 'past_week', { days: 3 })), /empty object/)
    assert.match(refused(leaf('점수', 'number', 'equals', '3')), /should be a number/)
    assert.match(refused(leaf('점수', 'number', 'equals', Number.NaN)), /should be a number/)
    assert.match(refused(leaf('완료', 'checkbox', 'equals', 'true')), /should be a boolean/)
    assert.match(refused(leaf('메모', 'rich_text', 'contains', 3)), /should be a string/)
    assert.match(refused(leaf('검증', 'verification', 'status', 'unverified')), /"verified", "expired" or "none"/)
  })
})

describe('★ 수식 · 계산 속성', () => {
  test('수식 — 결과 타입의 열쇠(string · number · checkbox · date) · 앱의 컴파일러가 캐시로 거른다', () => {
    for (const [name, key, op, value] of [
      ['두배', 'number', 'greater_than', 3],
      ['글식', 'string', 'contains', 'a'],
      ['참식', 'checkbox', 'equals', true],
      ['날식', 'date', 'past_month', {}],
    ] as const) {
      const node = translated({ property: name, formula: { [key]: { [op]: value } } })
      assert.ok(node !== null)
      compilesEveryLeaf(node)
    }
    assert.match(refused({ property: '두배', formula: { string: { contains: 'a' } } }), /returns number — use body\.filter\.formula\.number/)
    assert.match(refused({ property: '두배', number: { equals: 2 } }), /formula property — use the "formula" filter/)
  })

  test('rollup · 장소 · 버튼 — 400 으로 그렇다고 말한다(앱의 필터가 표현하지 못한다)', () => {
    assert.match(refused({ property: '합', rollup: { number: { greater_than: 1 } } }), /Filtering by a rollup property is not supported.*"합"/)
    assert.match(refused({ property: '합', rollup: { any: { rich_text: { contains: 'a' } } } }), /rollup/)
    assert.match(refused({ property: '장소', place: { is_empty: true } }), /place property is not supported/)
    assert.match(refused({ property: '버튼', button: {} }), /button property is not supported/)
  })
})

describe('★ timestamp — 행 자신의 시각', () => {
  test('속성이 없어도 거른다 · 날짜의 조건 · 앱의 컴파일러가 block 의 열을 본다', () => {
    const node = translated({ timestamp: 'created_time', created_time: { on_or_before: '2022-10-13' } })
    assert.deepEqual(node, { property_id: ROW_TIMESTAMP_KEYS.created_time, operator: 'on_or_before', value: '2022-10-13' })
    compilesEveryLeaf(node!)
    const sql = compileFilter(node, types, new ParamBag(2), { me: null, today: '2026-11-17' })
    assert.match(String(sql), /fb\.created_at/)
    const edited = translated({ timestamp: 'last_edited_time', last_edited_time: { past_week: {} } })
    assert.match(String(compileFilter(edited, types, new ParamBag(2), { me: null, today: '2026-11-17' })), /fb\.last_edited_at/)
  })

  test('모르는 시각 · 다른 열쇠 · 조건이 없다', () => {
    assert.match(refused({ timestamp: 'deleted_time', deleted_time: {} }), /"created_time" or "last_edited_time"/)
    assert.match(refused({ timestamp: 'created_time', last_edited_time: { past_week: {} } }), /should be not present/)
    assert.match(refused({ timestamp: 'created_time' }), /created_time should be defined/)
  })
})

describe('★ compound', () => {
  test('and · or 두 겹까지 — 앱의 묶음으로', () => {
    const node = translated({
      and: [
        leaf('완료', 'checkbox', 'equals', true),
        { or: [leaf('점수', 'number', 'greater_than', 3), leaf('메모', 'rich_text', 'contains', 'a')] },
      ],
    })
    assert.deepEqual(node, {
      op: 'and',
      children: [
        { property_id: 'p_check', operator: 'equals', value: true },
        {
          op: 'or',
          children: [
            { property_id: 'p_num', operator: 'greater_than', value: 3 },
            { property_id: 'p_text', operator: 'contains', value: 'a' },
          ],
        },
      ],
    })
  })

  test('세 겹은 거부 · 배열은 100개까지 · 한 열쇠만 · 배열이어야 한다', () => {
    assert.match(refused({ and: [{ or: [{ and: [leaf('완료', 'checkbox', 'equals', true)] }] }] }), /nested too deeply/)
    const many = Array.from({ length: API_FILTER_MAX_ITEMS }, () => leaf('완료', 'checkbox', 'equals', true))
    assert.ok(translated({ or: many }) !== null)
    assert.match(refused({ or: [...many, leaf('완료', 'checkbox', 'equals', true)] }), /length should be ≤ 100/)
    assert.match(refused({ and: [], or: [] }), /only one of "and" or "or"/)
    assert.match(refused({ and: {} }), /should be an array/)
    assert.match(refused({ nope: 1 }), /should have "property", "timestamp", "and" or "or"/)
    assert.match(refused('x'), /body\.filter should be an object/)
  })

  test('없는 필터 · null 은 모든 행 · 빈 묶음도', () => {
    assert.equal(translated(undefined), null)
    assert.equal(translated(null), null)
    assert.deepEqual(translated({ and: [] }), { op: 'and', children: [] })
  })

  test('잘못된 잎의 자리를 말한다', () => {
    assert.match(refused({ or: [leaf('완료', 'checkbox', 'equals', true), leaf('점수', 'number', 'equals', 'x')] }), /body\.filter\.or\[1\]\.number\.equals/)
  })
})

describe('★ 정렬', () => {
  test('차례가 우선순위 · 이름 · id · timestamp · 앱의 정렬 키로', () => {
    const r = translateSorts(
      [
        { property: '점수', direction: 'descending' },
        { timestamp: 'created_time', direction: 'ascending' },
        { property: 'p_select', direction: 'ascending' },
        { property: '점수', direction: 'ascending' },
      ],
      schema,
    )
    assert.ok(r.ok)
    assert.deepEqual(r.value, [
      { property_id: 'p_num', direction: 'desc' },
      { property_id: ROW_TIMESTAMP_KEYS.created_time, direction: 'asc' },
      { property_id: 'p_select', direction: 'asc' },
    ])
    const compiled = compileSorts(r.value, types, new ParamBag(2))
    assert.equal(compiled.keys.length, 3, '앱의 정렬이 셋 모두 쓴다')
    assert.match(compiled.keys[1].expr, /fb\.created_at/)
  })

  test('정렬할 수 있는 타입은 앱의 정렬이 모두 쓴다', () => {
    const sortable = ['이름', '메모', '주소', '메일', '전화', '점수', '완료', '종류', '상태', '태그', '기한', '만든 시각', '고친 시각', '번호', '검증', '두배', '글식', '참식', '날식', '장소']
    const r = translateSorts(sortable.map((property) => ({ property, direction: 'ascending' })), schema)
    assert.ok(r.ok, r.ok ? '' : r.message)
    assert.equal(compileSorts(r.value, types, new ParamBag(2)).keys.length, sortable.length)
  })

  test('정렬할 수 없는 타입 · 없는 속성 · 틀린 방향 · 둘 다 · 배열이 아니다', () => {
    for (const name of ['담당', '만든 사람', '고친 사람', '관련', '파일', '합', '버튼']) {
      const r = translateSorts([{ property: name, direction: 'ascending' }], schema)
      assert.ok(!r.ok && /^Sorting by a \w+ property is not supported/.test(r.message), name)
    }
    const missing = translateSorts([{ property: '없음', direction: 'ascending' }], schema)
    assert.ok(!missing.ok && missing.message === 'Could not find sort property with name or id: 없음')
    const direction = translateSorts([{ property: '점수', direction: 'asc' }], schema)
    assert.ok(!direction.ok && /"ascending" or "descending"/.test(direction.message))
    const both = translateSorts([{ property: '점수', timestamp: 'created_time', direction: 'ascending' }], schema)
    assert.ok(!both.ok && /either "property" or "timestamp"/.test(both.message))
    const notArray = translateSorts({ property: '점수' }, schema)
    assert.ok(!notArray.ok && /should be an array/.test(notArray.message))
    assert.deepEqual(translateSorts(undefined, schema), { ok: true, value: [] })
  })
})

describe('★ 커서', () => {
  test('지문 · 준 행 수 · 앱의 커서를 싣고 되읽는다 — 속이 보이지 않는 글자', () => {
    const fingerprint = queryFingerprint(U1, null, [], false)
    const raw = encodeQueryCursor({ fingerprint, consumed: 200, engine: 'WyJhIl0' })
    assert.match(raw, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(decodeQueryCursor(raw), { fingerprint, consumed: 200, engine: 'WyJhIl0' })
  })

  test('모양이 틀리면 null', () => {
    for (const bad of ['', 'not a cursor!', 123, null, Buffer.from('{"h":"x","n":1,"c":"a"}').toString('base64url'), Buffer.from('[1]').toString('base64url')]) {
      assert.equal(decodeQueryCursor(bad), null, String(bad))
    }
    const negative = Buffer.from(JSON.stringify({ h: 'a'.repeat(24), n: -1, c: 'x' })).toString('base64url')
    assert.equal(decodeQueryCursor(negative), null)
  })

  test('지문은 같은 질의에서만 같다 — 소스 · 필터 · 정렬 · 휴지통', () => {
    const f: FilterNode = { property_id: 'p_num', operator: 'equals', value: 1 }
    const base = queryFingerprint(U1, f, [{ property_id: 'p_num', direction: 'asc' }], false)
    assert.equal(base, queryFingerprint(U1, { ...f }, [{ property_id: 'p_num', direction: 'asc' }], false))
    assert.notEqual(base, queryFingerprint(O1, f, [{ property_id: 'p_num', direction: 'asc' }], false))
    assert.notEqual(base, queryFingerprint(U1, { ...f, value: 2 }, [{ property_id: 'p_num', direction: 'asc' }], false))
    assert.notEqual(base, queryFingerprint(U1, f, [{ property_id: 'p_num', direction: 'desc' }], false))
    assert.notEqual(base, queryFingerprint(U1, f, [{ property_id: 'p_num', direction: 'asc' }], true))
  })
})
