/**
 * 장소 속성의 순수한 부분 — MP-1조각 (F-03-04 · 정본 §3.5 [보강 MP-1])
 *
 *   ① 좌표로 쓴 글 · 찾기 글 · 환경 변수 · 찾기 주소
 *   ② Nominatim 답 거르기 — 틀린 줄은 버린다 · 상한에서 자른다 · 5개
 *   ③ 값 검증 · 비운 칸 · 사이드카
 *   ④ 필터 컴파일 — 이름 + 포함은 주소도
 *   ⑤ CSV · 공개 · 수식 · 바꾸기 · 롤업
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { publicCell } from '../../app/p/public-cells.ts'
import { textRun } from '../contracts/rich-text.ts'
import { cellPlainText } from '../export/csv.ts'
import { publicPlaceValue } from '../publish/public-places.ts'
import { cellText } from './cell-format.ts'
import { compileFilter, noViewer, operatorsFor, ParamBag, type FilterNode } from './filter.ts'
import { cellToFormulaValue, formulaTypeOfCell } from './formula-schema.ts'
import {
  mapNominatim,
  normalizePlaceQuery,
  parseCoordinates,
  placeSearchBase,
  placeSearchUrl,
  placeText,
  readPlace,
} from './place.ts'
import {
  deriveSidecars,
  emptyValue,
  isEmptyValue,
  validateCellValue,
  type CellValue,
} from './property-types.ts'
import { rollupFunctionsFor } from './rollup-functions.ts'
import { canConvert, convertCell, convertTargets } from './type-conversion.ts'

const place = (over: Record<string, unknown> = {}): CellValue =>
  ({ type: 'place', place: { name: '서울시청', address: '서울 중구 세종대로 110', lat: 37.5665, lng: 126.978, ...over } }) as CellValue

describe('① 좌표 · 찾기 글', () => {
  test('★ 쉼표 또는 공백으로 가른 좌표는 장소가 된다(이름은 쓴 글)', () => {
    assert.deepEqual(parseCoordinates('37.5665, 126.978'), { name: '37.5665, 126.978', address: '', lat: 37.5665, lng: 126.978 })
    assert.deepEqual(parseCoordinates('  -33.86 151.21 '), { name: '-33.86 151.21', address: '', lat: -33.86, lng: 151.21 })
    assert.deepEqual(parseCoordinates('37,127'), { name: '37,127', address: '', lat: 37, lng: 127 })
  })

  test('범위 밖 · 수가 아닌 글 · 한 수만은 좌표가 아니다', () => {
    for (const text of ['91, 0', '0, 181', '-90.1, 0', 'abc', '37.5', '37.5, abc', '1, 2, 3', '', '서울 37, 127', '1e2, 3']) {
      assert.equal(parseCoordinates(text), null, text)
    }
    assert.notEqual(parseCoordinates('90, 180'), null, '끝값은 된다')
    assert.notEqual(parseCoordinates('-90, -180'), null)
  })

  test('찾기 글 — 공백을 걷고 비었거나 200자를 넘으면 null', () => {
    assert.equal(normalizePlaceQuery('  서울   시청 '), '서울 시청')
    assert.equal(normalizePlaceQuery('   '), null)
    assert.equal(normalizePlaceQuery(null), null)
    assert.equal(normalizePlaceQuery('가'.repeat(201)), null)
    assert.equal(normalizePlaceQuery('가'.repeat(200)), '가'.repeat(200))
  })

  test('★ PLACE_SEARCH_URL — 비면 기본 · off 면 끈다 · 끝의 / 는 뗀다', () => {
    assert.equal(placeSearchBase(undefined), 'https://nominatim.openstreetmap.org')
    assert.equal(placeSearchBase('  '), 'https://nominatim.openstreetmap.org')
    assert.equal(placeSearchBase('off'), null)
    assert.equal(placeSearchBase(' OFF '), null)
    assert.equal(placeSearchBase('https://geo.example.com//'), 'https://geo.example.com')
  })

  test('찾기 주소 — Nominatim 호환 /search 에 jsonv2 · limit 5 · ko', () => {
    const url = new URL(placeSearchUrl('https://geo.example.com', '서울 시청&x=1'))
    assert.equal(url.pathname, '/search')
    assert.equal(url.searchParams.get('format'), 'jsonv2')
    assert.equal(url.searchParams.get('limit'), '5')
    assert.equal(url.searchParams.get('accept-language'), 'ko')
    assert.equal(url.searchParams.get('q'), '서울 시청&x=1', '글은 값으로만 들어간다')
    assert.equal(url.searchParams.has('x'), false)
  })
})

describe('② Nominatim 답 거르기', () => {
  test('★ 이름 · 주소 · 좌표(글로 온 수도)로 옮긴다', () => {
    const out = mapNominatim([{ lat: '37.5666', lon: '126.9784', name: '서울특별시청', display_name: '서울특별시청, 세종대로, 중구' }])
    assert.deepEqual(out, [{ name: '서울특별시청', address: '서울특별시청, 세종대로, 중구', lat: 37.5666, lng: 126.9784 }])
    assert.deepEqual(mapNominatim([{ lat: 1.5, lon: 2.5, name: 'a', display_name: 'a, b' }]), [{ name: 'a', address: 'a, b', lat: 1.5, lng: 2.5 }])
  })

  test('이름이 없으면 display_name 의 첫 조각', () => {
    assert.equal(mapNominatim([{ lat: '1', lon: '2', name: '', display_name: '남산타워, 용산구, 서울' }])[0]?.name, '남산타워')
  })

  test('★ 틀린 줄은 버린다 — 좌표가 수가 아니다 · 범위 밖 · 이름을 만들 수 없다 · 객체가 아니다', () => {
    const out = mapNominatim([
      null,
      'x',
      [],
      { lat: 'abc', lon: '2', name: 'a', display_name: 'a' },
      { lat: '91', lon: '2', name: 'b', display_name: 'b' },
      { lat: '1', lon: '181', name: 'c', display_name: 'c' },
      { lat: '1', lon: '2', name: '', display_name: '' },
      { lat: '1' },
      { lat: '3', lon: '4', name: '남는 줄', display_name: '남는 줄, 주소' },
    ])
    assert.deepEqual(out.map((p) => p.name), ['남는 줄'])
    assert.deepEqual(mapNominatim({ not: 'array' }), [])
    assert.deepEqual(mapNominatim(null), [])
  })

  test('★ 상한에서 자른다 — 이름 255 · 주소 500 · 결과 5개', () => {
    const [one] = mapNominatim([{ lat: '1', lon: '2', name: 'n'.repeat(300), display_name: 'a'.repeat(600) }])
    assert.equal(one?.name.length, 255)
    assert.equal(one?.address.length, 500)
    const many = Array.from({ length: 9 }, (_, i) => ({ lat: String(i), lon: '0', name: `p${i}`, display_name: `p${i}` }))
    assert.equal(mapNominatim(many).length, 5)
    // 걸러진 줄은 5개에 세지 않는다
    const mixed = [{ lat: 'x', lon: '0', name: 'bad' }, ...many]
    assert.equal(mapNominatim(mixed).length, 5)
    // 걸러낸 값은 칸 검증을 통과한다
    for (const p of mapNominatim(many)) assert.deepEqual(validateCellValue('place', { type: 'place', place: p }), [])
  })

  test('readPlace — 저장된 값에서 읽고 모양이 아니면 null', () => {
    assert.deepEqual(readPlace(place()), { name: '서울시청', address: '서울 중구 세종대로 110', lat: 37.5665, lng: 126.978 })
    assert.equal(readPlace(null), null)
    assert.equal(readPlace(place({ name: '' })), null)
    assert.equal(readPlace(place({ lat: 99 })), null)
    assert.equal(readPlace({ place: 'x' }), null)
  })
})

describe('③ 값 검증 · 비운 칸 · 사이드카', () => {
  test('★ 정상 값과 끝값을 받는다', () => {
    assert.deepEqual(validateCellValue('place', place()), [])
    assert.deepEqual(validateCellValue('place', place({ address: '' })), [])
    assert.deepEqual(validateCellValue('place', place({ name: 'n'.repeat(255), address: 'a'.repeat(500), lat: -90, lng: 180 })), [])
  })

  test('★ 이름 · 주소 · 좌표 · 키 · 수 타입이 틀린 값은 거부한다', () => {
    const bad: [string, Record<string, unknown>][] = [
      ['이름 비었다', { name: '' }],
      ['이름 256자', { name: 'n'.repeat(256) }],
      ['이름이 글이 아니다', { name: 5 }],
      ['주소 501자', { address: 'a'.repeat(501) }],
      ['주소가 글이 아니다', { address: null }],
      ['lat 91', { lat: 91 }],
      ['lat -91', { lat: -91 }],
      ['lng 181', { lng: 181 }],
      ['lat 글', { lat: '37' }],
      ['lat NaN', { lat: Number.NaN }],
      ['lat Infinity', { lat: Number.POSITIVE_INFINITY }],
      ['모르는 키', { extra: 1 }],
    ]
    for (const [label, over] of bad) assert.notEqual(validateCellValue('place', place(over)).length, 0, label)
    assert.notEqual(validateCellValue('place', { type: 'place', place: 'x' }).length, 0)
    assert.notEqual(validateCellValue('place', { type: 'place', place: [] }).length, 0)
    assert.notEqual(validateCellValue('place', { type: 'place' }).length, 0)
  })

  test('비운 칸(emptyValue)은 받는다 — 쓰기가 칸을 지운다', () => {
    const empty = emptyValue('place')
    assert.equal(isEmptyValue(empty), true)
    assert.deepEqual(validateCellValue('place', empty), [])
    assert.equal(isEmptyValue(place()), false)
    // 이름만 비고 나머지가 찬 값은 비운 칸이 아니다
    assert.notEqual(validateCellValue('place', place({ name: '', address: '주소 있음' })).length, 0)
  })

  test('사이드카 text 는 이름 — 비면 null', () => {
    assert.equal(deriveSidecars(place()).text, '서울시청')
    assert.equal(deriveSidecars(emptyValue('place')).text, null)
  })
})

describe('④ 필터 컴파일', () => {
  const TYPES = new Map<string, string>([['pPlace', 'place']])
  const compile = (node: FilterNode) => {
    const params = new ParamBag(1)
    const sql = compileFilter(node, TYPES, params, noViewer())
    return { sql, values: params.values }
  }

  test('★ 연산자는 글과 같은 여덟 개', () => {
    assert.deepEqual(operatorsFor('place').sort(), operatorsFor('rich_text').sort())
    assert.equal(operatorsFor('place').length, 8)
  })

  test('★ 포함 · 포함하지 않음은 이름(사이드카)과 주소(값)를 같이 본다 · 값은 바인딩 · 와일드카드는 글자', () => {
    const contains = compile({ property_id: 'pPlace', operator: 'contains', value: '100%_' })
    assert.match(contains.sql ?? '', /text_value/)
    assert.match(contains.sql ?? '', /'place' ->> 'address'/)
    assert.deepEqual(contains.values.includes('pPlace'), true)
    assert.equal(contains.values.includes('100\\%\\_'), true, 'LIKE 와일드카드를 글자로 만든다')
    assert.equal((contains.sql ?? '').includes('100%'), false, '값이 SQL 에 박히지 않는다')
    const not = compile({ property_id: 'pPlace', operator: 'does_not_contain', value: 'x' })
    assert.match(not.sql ?? '', /NOT EXISTS/)
    assert.match(not.sql ?? '', /'place' ->> 'address'/)
  })

  test('같음 · 시작 · 끝은 이름만 본다', () => {
    for (const operator of ['equals', 'does_not_equal', 'starts_with', 'ends_with']) {
      const { sql } = compile({ property_id: 'pPlace', operator, value: 'x' })
      assert.doesNotMatch(sql ?? '', /address/, operator)
    }
    assert.match(compile({ property_id: 'pPlace', operator: 'is_empty' }).sql ?? '', /NOT EXISTS/)
    assert.doesNotMatch(compile({ property_id: 'pPlace', operator: 'is_not_empty' }).sql ?? '', /address/)
  })
})

describe('⑤ CSV · 공개 · 수식 · 바꾸기 · 롤업', () => {
  test('★ CSV 는 `이름 (주소)` · 주소가 없으면 이름', () => {
    const column = { propertyId: 'p', name: '위치', type: 'place' as const }
    assert.equal(cellPlainText(column, place()), '서울시청 (서울 중구 세종대로 110)')
    assert.equal(cellPlainText(column, place({ address: '' })), '서울시청')
    assert.equal(placeText({ name: 'a', address: '', lat: 0, lng: 0 }), 'a')
  })

  test('칸의 글은 이름 · 주소는 칸이 title 로 보인다', () => {
    assert.equal(cellText(place() as CellValue), '서울시청')
  })

  test('★ 공개 표는 이름만 — 재료에 주소 · 좌표가 없다', () => {
    const out = publicPlaceValue(place())
    assert.deepEqual(out, { type: 'place', place: { name: '서울시청' } })
    const json = JSON.stringify(out)
    for (const leak of ['세종대로', '37.5665', '126.978', 'lat', 'lng']) assert.equal(json.includes(leak), false, leak)
    assert.deepEqual(publicPlaceValue(null), { type: 'place', place: { name: '' } })
    const col = { id: 'p1', name: '위치', type: 'place' as const, options: [], prefix: null }
    assert.deepEqual(publicCell(col, out, null), { kind: 'text', text: '서울시청' })
    assert.deepEqual(publicCell(col, { type: 'place', place: { name: '' } }, null), { kind: 'empty' })
  })

  test('★ 수식 prop() 은 이름(글)', () => {
    assert.equal(formulaTypeOfCell('place'), 'text')
    assert.deepEqual(cellToFormulaValue('place', place(), () => null), { type: 'text', value: '서울시청' })
  })

  test('★ 롤업은 세기만', () => {
    assert.deepEqual([...rollupFunctionsFor('place')].sort(), ['count', 'count_values', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'].sort())
    assert.equal(rollupFunctionsFor('place').includes('show_original'), false)
  })

  test('★ 바꾸기 — 장소 → 글은 이름 · 다른 타입 → 장소는 칸을 비운다', () => {
    assert.equal(canConvert('place', 'rich_text'), true)
    assert.equal(canConvert('place', 'number'), false)
    assert.equal(canConvert('place', 'select'), false)
    assert.deepEqual(convertTargets('place'), ['rich_text'])
    for (const from of ['rich_text', 'number', 'select', 'multi_select', 'status', 'checkbox', 'date']) assert.equal(canConvert(from, 'place'), true, from)
    assert.equal(canConvert('url', 'place'), false, 'URL 은 바꿀 수 있는 타입이 아니다')
    const opts = { optionName: () => null, optionIdFor: () => 'o' }
    assert.deepEqual(convertCell(place() as CellValue, 'rich_text', opts).value, { type: 'rich_text', rich_text: [textRun('서울시청')] })
    assert.deepEqual(convertCell({ type: 'rich_text', rich_text: [textRun('서울')] }, 'place', opts), { value: null, lost: true })
    assert.deepEqual(convertCell({ type: 'rich_text', rich_text: [] }, 'place', opts), { value: null, lost: false })
  })
})
