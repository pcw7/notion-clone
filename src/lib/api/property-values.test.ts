/**
 * 공개 API 의 속성 값 — 우리 칸 ↔ 노션의 page property value (API-2 · F-09-17 · 순수)
 *
 *   ★ 내보내기 — 타입마다 노션의 모양(제목 id 는 `title` · 옵션은 {id,name,color} · 날짜 범위와 시간대 · 사람 · 파일 · 장소 · relation 의
 *     has_more · rollup · 수식 · 고유 ID · 만든/고친 사람과 시각 · 검증 · 버튼)
 *   ★ 빈 값 — 타입마다 노션의 빈 모양(null · [] · false) · 계약을 어긴 칸은 빈 값으로 읽는다
 *   ★ 받기 — 타입마다 우리 칸 · 옵션은 id · 이름(대소문자) · 없는 옵션은 거부 · 날짜 범위와 시간대 · 비우기 · 되돌리기
 *   ★ 거부 — 계산 · 읽기 전용 속성 · 타입이 다른 봉투 · 모양이 틀린 값(영어로 자리를 말한다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import type { SelectOption } from '../database/property-types.ts'
import {
  apiPropertyId,
  findProperty,
  findPropertyById,
  parsePropertyWrite,
  propertyValueToApi,
  type ApiProperty,
  type RowValues,
} from './property-values.ts'
import type { ApiLinks } from './rich-text.ts'

const links: ApiLinks = { origin: 'https://app.test', pageUrl: (id) => `https://app.test/w/ws/${id}` }
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const F1 = '33333333-3333-4333-8333-333333333333'
const R1 = '44444444-4444-4444-8444-444444444444'
const O_TODO = '55555555-5555-4555-8555-555555555555'
const O_DONE = '66666666-6666-4666-8666-666666666666'

const prop = (id: string, name: string, type: string, config: unknown = null): ApiProperty => ({ id, name, type, config })
const P = {
  title: prop('pTitle00000000000000a', '이름', 'title'),
  text: prop('pText000000000000000a', '메모', 'rich_text'),
  number: prop('pNum0000000000000000a', '점수', 'number'),
  select: prop('pSel0000000000000000a', '종류', 'select'),
  status: prop('pStat000000000000000a', '상태', 'status'),
  multi: prop('pMulti00000000000000a', '태그', 'multi_select'),
  check: prop('pCheck00000000000000a', '완료', 'checkbox'),
  date: prop('pDate000000000000000a', '기한', 'date'),
  people: prop('pPeople0000000000000a', '담당', 'people'),
  files: prop('pFiles00000000000000a', '첨부', 'files'),
  url: prop('pUrl0000000000000000a', '주소', 'url'),
  email: prop('pEmail00000000000000a', '메일', 'email'),
  phone: prop('pPhone00000000000000a', '전화', 'phone_number'),
  place: prop('pPlace00000000000000a', '장소', 'place'),
  relation: prop('pRel0000000000000000a', '관련', 'relation', { target_data_source_id: R1 }),
  rollup: prop('pRoll000000000000000a', '합', 'rollup', { relation_property_id: 'pRel0000000000000000a', target_property_id: 'x', function: 'sum' }),
  formula: prop('pForm000000000000000a', '두배', 'formula', { expression: 'prop("점수") * 2', result_type: 'number' }),
  uid: prop('pUid0000000000000000a', '번호', 'unique_id'),
  ct: prop('pCt00000000000000000a', '만든 시각', 'created_time'),
  cb: prop('pCb00000000000000000a', '만든 사람', 'created_by'),
  lt: prop('pLt00000000000000000a', '고친 시각', 'last_edited_time'),
  lb: prop('pLb00000000000000000a', '고친 사람', 'last_edited_by'),
  verify: prop('pVer0000000000000000a', '검증', 'verification'),
  button: prop('pBtn0000000000000000a', '버튼', 'button'),
}

const statusOptions: SelectOption[] = [
  { id: O_TODO, name: 'Todo', color: 'gray', group: 'todo' },
  { id: O_DONE, name: 'Done', color: 'green', group: 'complete' },
]
const selectOptions: SelectOption[] = [{ id: O_TODO, name: '버그', color: 'red' }, { id: O_DONE, name: '기능', color: 'blue' }]

const NOW = new Date('2026-11-16T09:00:00.000Z')

function row(cells: Record<string, unknown>, extra: Partial<RowValues> = {}): RowValues {
  return {
    cells,
    options: new Map([
      [P.select.id, selectOptions],
      [P.status.id, statusOptions],
      [P.multi.id, selectOptions],
    ]),
    relations: new Map(),
    rollups: null,
    formulas: {},
    uniqueId: { prefix: 'TASK', number: 12 },
    createdTime: new Date('2026-01-02T03:04:05.000Z'),
    createdBy: U1,
    lastEditedTime: new Date('2026-02-03T04:05:06.000Z'),
    lastEditedBy: U2,
    now: NOW,
    ...extra,
  }
}

const value = (p: ApiProperty, r: RowValues) => propertyValueToApi(p, r, links)

test('★ 내보내기 — 셀 타입마다 노션의 모양', () => {
  const r = row({
    [P.title.id]: { type: 'title', title: [textRun('할 일')] },
    [P.text.id]: { type: 'rich_text', rich_text: [textRun('메모', { bold: true })] },
    [P.number.id]: { type: 'number', number: 3.5 },
    [P.select.id]: { type: 'select', select: { id: O_DONE } },
    [P.status.id]: { type: 'status', status: { id: O_TODO } },
    [P.multi.id]: { type: 'multi_select', multi_select: [{ id: O_DONE }, { id: O_TODO }] },
    [P.check.id]: { type: 'checkbox', checkbox: true },
    [P.date.id]: { type: 'date', date: { start: '2026-03-01T09:00:00+09:00', end: '2026-03-02T18:00:00+09:00', time_zone: 'Asia/Seoul' } },
    [P.people.id]: { type: 'people', people: [{ id: U1 }, { id: U2 }] },
    [P.files.id]: { type: 'files', files: [{ id: F1, name: '보고서.pdf' }] },
    [P.url.id]: { type: 'url', url: 'https://example.com' },
    [P.email.id]: { type: 'email', email: 'a@example.com' },
    [P.phone.id]: { type: 'phone_number', phone_number: '010-1234-5678' },
    [P.place.id]: { type: 'place', place: { name: '서울역', address: '서울 중구', lat: 37.55, lng: 126.97 } },
  })
  const title = value(P.title, r)
  assert.equal(title.id, 'title', '제목 속성의 id 는 노션처럼 title')
  assert.equal(title.type, 'title')
  assert.equal((title.title as { plain_text: string }[])[0].plain_text, '할 일')
  assert.equal(value(P.text, r).id, P.text.id)
  assert.equal((value(P.text, r).rich_text as { annotations: { bold: boolean } }[])[0].annotations.bold, true)
  assert.deepEqual(value(P.number, r), { id: P.number.id, type: 'number', number: 3.5 })
  assert.deepEqual(value(P.select, r).select, { id: O_DONE, name: '기능', color: 'blue' })
  assert.deepEqual(value(P.status, r).status, { id: O_TODO, name: 'Todo', color: 'gray' })
  assert.deepEqual(value(P.multi, r).multi_select, [{ id: O_DONE, name: '기능', color: 'blue' }, { id: O_TODO, name: '버그', color: 'red' }])
  assert.equal(value(P.check, r).checkbox, true)
  assert.deepEqual(value(P.date, r).date, { start: '2026-03-01T09:00:00+09:00', end: '2026-03-02T18:00:00+09:00', time_zone: 'Asia/Seoul' })
  assert.deepEqual(value(P.people, r).people, [{ object: 'user', id: U1 }, { object: 'user', id: U2 }])
  assert.deepEqual(value(P.files, r).files, [{ name: '보고서.pdf', type: 'file_upload', file_upload: { id: F1 } }])
  assert.equal(value(P.url, r).url, 'https://example.com')
  assert.equal(value(P.email, r).email, 'a@example.com')
  assert.equal(value(P.phone, r).phone_number, '010-1234-5678')
  assert.deepEqual(value(P.place, r).place, { lat: 37.55, lon: 126.97, name: '서울역', address: '서울 중구', aws_place_id: null, google_place_id: null })
})

test('★ 빈 값 — 칸이 없거나 계약을 어기면 노션의 빈 모양 · 지운 옵션은 빠진다', () => {
  const r = row({
    [P.number.id]: { type: 'rich_text', rich_text: [textRun('타입을 바꾸기 전의 옛 값')] },
    [P.select.id]: { type: 'select', select: { id: '77777777-7777-4777-8777-777777777777' } },
    [P.multi.id]: { type: 'multi_select', multi_select: [{ id: '77777777-7777-4777-8777-777777777777' }, { id: O_TODO }] },
    [P.date.id]: { type: 'date', date: { start: '2026-02-30' } },
  })
  assert.deepEqual(value(P.title, r).title, [])
  assert.deepEqual(value(P.text, r).rich_text, [])
  assert.equal(value(P.number, r).number, null)
  assert.equal(value(P.select, r).select, null)
  assert.equal(value(P.status, r).status, null)
  assert.deepEqual(value(P.multi, r).multi_select, [{ id: O_TODO, name: '버그', color: 'red' }])
  assert.equal(value(P.check, r).checkbox, false, '체크박스의 빈 값은 false')
  assert.equal(value(P.date, r).date, null, '달력에 없는 날은 계약을 어긴 칸 — 빈 값')
  assert.deepEqual(value(P.people, r).people, [])
  assert.deepEqual(value(P.files, r).files, [])
  assert.equal(value(P.url, r).url, null)
  assert.equal(value(P.email, r).email, null)
  assert.equal(value(P.phone, r).phone_number, null)
  assert.equal(value(P.place, r).place, null)
  assert.deepEqual(value(P.relation, r), { id: P.relation.id, type: 'relation', relation: [], has_more: false })
  assert.deepEqual(value(P.verify, r).verification, { state: 'unverified', verified_by: null, date: null })
})

test('★ 내보내기 — relation 의 has_more · rollup · 수식 · 고유 ID · 만든/고친 · 검증 · 버튼', () => {
  const r = row(
    {
      [P.verify.id]: { type: 'verification', state: 'verified', verified_by: U1, verified_at: '2026-11-01T00:00:00.000Z', expires_at: '2026-11-10T00:00:00.000Z' },
    },
    {
      relations: new Map([[P.relation.id, { ids: [R1], hasMore: true }]]),
      rollups: {
        columns: {
          [P.rollup.id]: { state: 'ok', function: 'sum', relationPropertyId: P.relation.id, targetPropertyId: 'x', targetType: 'number', targetOptions: [] },
        },
        cells: { [P.rollup.id]: { state: 'ok', result: { kind: 'number', number: 42 }, hidden: 0 } },
      },
      formulas: { [P.formula.id]: { type: 'number', value: 7 } },
    },
  )
  assert.deepEqual(value(P.relation, r), { id: P.relation.id, type: 'relation', relation: [{ id: R1 }], has_more: true })
  assert.deepEqual(value(P.rollup, r).rollup, { type: 'number', number: 42, function: 'sum' })
  assert.deepEqual(value(P.formula, r).formula, { type: 'number', number: 7 })
  assert.deepEqual(value(P.uid, r).unique_id, { prefix: 'TASK', number: 12 })
  assert.equal(value(P.ct, r).created_time, '2026-01-02T03:04:05.000Z')
  assert.deepEqual(value(P.cb, r).created_by, { object: 'user', id: U1 })
  assert.equal(value(P.lt, r).last_edited_time, '2026-02-03T04:05:06.000Z')
  assert.deepEqual(value(P.lb, r).last_edited_by, { object: 'user', id: U2 })
  assert.deepEqual(value(P.verify, r).verification, {
    state: 'expired',
    verified_by: { object: 'user', id: U1 },
    date: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-10T00:00:00.000Z', time_zone: null },
  })
  assert.deepEqual(value(P.button, r), { id: P.button.id, type: 'button', button: {} })
})

test('rollup — 비율 · 날짜 · 원본 배열 · 계산할 수 없으면 unsupported(설정의 함수) · 수식의 빈 값과 글', () => {
  const info = (fn: string, targetType: string) => ({ state: 'ok', function: fn, relationPropertyId: 'r', targetPropertyId: 't', targetType, targetOptions: selectOptions })
  const roll = (fn: string, targetType: string, result: unknown) =>
    value(P.rollup, row({}, { rollups: { columns: { [P.rollup.id]: info(fn, targetType) }, cells: { [P.rollup.id]: { state: 'ok', result, hidden: 0 } } } } as Partial<RowValues>)).rollup
  assert.deepEqual(roll('percent_checked', 'checkbox', { kind: 'percent', percent: 0.5 }), { type: 'number', number: 0.5, function: 'percent_checked' })
  assert.deepEqual(roll('latest_date', 'date', { kind: 'date', date: '2026-05-01' }), {
    type: 'date',
    date: { start: '2026-05-01', end: null, time_zone: null },
    function: 'latest_date',
  })
  assert.deepEqual(roll('show_original', 'select', { kind: 'values', values: [{ type: 'select', select: { id: O_TODO } }], count: 1 }), {
    type: 'array',
    array: [{ type: 'select', select: { id: O_TODO, name: '버그', color: 'red' } }],
    function: 'show_original',
  })
  assert.deepEqual(value(P.rollup, row({})).rollup, { type: 'unsupported', unsupported: {}, function: 'sum' })
  assert.deepEqual(
    value(P.rollup, row({}, { rollups: { columns: { [P.rollup.id]: info('sum', 'number') }, cells: { [P.rollup.id]: { state: 'too_many' } } } } as Partial<RowValues>)).rollup,
    { type: 'unsupported', unsupported: {}, function: 'sum' },
  )
  assert.deepEqual(value(P.formula, row({})).formula, { type: 'number', number: null })
  const textFormula = prop('pF2', 'f', 'formula', { expression: '"a"', result_type: 'text' })
  assert.deepEqual(value(textFormula, row({}, { formulas: { pF2: { type: 'text', value: '안녕' } } })).formula, { type: 'string', string: '안녕' })
  assert.deepEqual(value(textFormula, row({}, { formulas: { pF2: { type: 'date', value: { start: '2026-01-01', end: '2026-01-03' } } } })).formula, {
    type: 'date',
    date: { start: '2026-01-01', end: '2026-01-03', time_zone: null },
  })
})

test('속성 찾기 — 이름이 먼저 · 우리 id · title 별칭 · property item 은 id 만', () => {
  const all = Object.values(P)
  assert.equal(findProperty(all, '점수'), P.number)
  assert.equal(findProperty(all, P.number.id), P.number)
  assert.equal(findProperty(all, 'title'), P.title)
  assert.equal(findProperty(all, '없음'), null)
  assert.equal(findPropertyById(all, 'title'), P.title)
  assert.equal(findPropertyById(all, P.title.id), P.title)
  assert.equal(findPropertyById(all, '점수'), null)
  assert.equal(apiPropertyId(P.title), 'title')
  assert.equal(apiPropertyId(P.number), P.number.id)
})

const write = (p: ApiProperty, raw: unknown, options: readonly SelectOption[] = []) => parsePropertyWrite(p, raw, `body.properties.${p.name}`, options)
const cell = (p: ApiProperty, raw: unknown, options: readonly SelectOption[] = []) => {
  const w = write(p, raw, options)
  assert.ok(w.ok, JSON.stringify(w))
  if (!w.ok || w.write.kind !== 'cell') throw new Error('칸 쓰기가 아니다')
  return w.write.value
}

test('★ 받기 — 타입마다 우리 칸', () => {
  const title = cell(P.title, { title: [{ text: { content: '새 일' } }] })
  assert.equal(title.type === 'title' && title.title[0].plain_text, '새 일')
  const short = cell(P.title, [{ text: { content: '배열만' } }])
  assert.equal(short.type === 'title' && short.title[0].plain_text, '배열만', '제목은 배열만 보내도 받는다')
  assert.equal(cell(P.text, { type: 'rich_text', rich_text: [] }).type, 'rich_text')
  assert.deepEqual(cell(P.number, { number: 12 }), { type: 'number', number: 12 })
  assert.deepEqual(cell(P.number, { number: null }), { type: 'number', number: null })
  assert.deepEqual(cell(P.check, { checkbox: false }), { type: 'checkbox', checkbox: false })
  assert.deepEqual(cell(P.select, { select: { name: '기능' } }, selectOptions), { type: 'select', select: { id: O_DONE } })
  assert.deepEqual(cell(P.select, { select: { id: O_TODO } }, selectOptions), { type: 'select', select: { id: O_TODO } })
  assert.deepEqual(cell(P.select, { select: null }, selectOptions), { type: 'select', select: null })
  assert.deepEqual(cell(P.status, { status: { name: 'done' } }, statusOptions), { type: 'status', status: { id: O_DONE } }, '이름은 대소문자를 가리지 않고 찾는다')
  assert.deepEqual(cell(P.multi, { multi_select: [{ name: '버그' }, { id: O_DONE }, { name: '버그' }] }, selectOptions), {
    type: 'multi_select',
    multi_select: [{ id: O_TODO }, { id: O_DONE }],
  })
  assert.deepEqual(cell(P.multi, { multi_select: [] }, selectOptions), { type: 'multi_select', multi_select: [] })
  assert.deepEqual(cell(P.people, { people: [{ object: 'user', id: U1 }, { id: U2.replace(/-/g, '') }] }), { type: 'people', people: [{ id: U1 }, { id: U2 }] })
  assert.deepEqual(cell(P.files, { files: [{ name: '사진.png', type: 'file_upload', file_upload: { id: F1 } }] }), {
    type: 'files',
    files: [{ id: F1, name: '사진.png' }],
  })
  assert.deepEqual(cell(P.url, { url: 'https://a.test' }), { type: 'url', url: 'https://a.test' })
  assert.deepEqual(cell(P.url, { url: null }), { type: 'url', url: '' }, 'null 은 비우기')
  assert.deepEqual(cell(P.email, { email: 'b@a.test' }), { type: 'email', email: 'b@a.test' })
  assert.deepEqual(cell(P.phone, { phone_number: null }), { type: 'phone_number', phone_number: '' })
  assert.deepEqual(cell(P.place, { place: { lat: 37.5, lon: 127, name: '집', address: null } }), {
    type: 'place',
    place: { name: '집', address: '', lat: 37.5, lng: 127 },
  })
  assert.deepEqual(cell(P.place, { place: null }), { type: 'place', place: { name: '', address: '', lat: 0, lng: 0 } })
  const linked = write(P.relation, { relation: [{ id: R1 }, { id: R1.replace(/-/g, '') }] })
  assert.ok(linked.ok && linked.write.kind === 'relation')
  if (linked.ok && linked.write.kind === 'relation') assert.deepEqual(linked.write.ids, [R1], '같은 행은 한 번')
})

test('★ 받기 — 날짜 범위와 시간대 · 시작만 · 비우기', () => {
  assert.deepEqual(cell(P.date, { date: { start: '2026-03-01T09:00:00', end: '2026-03-03T18:30:00', time_zone: 'Asia/Seoul' } }), {
    type: 'date',
    date: { start: '2026-03-01T09:00:00', end: '2026-03-03T18:30:00', time_zone: 'Asia/Seoul' },
  })
  assert.deepEqual(cell(P.date, { date: { start: '2026-03-01T09:00:00.000+09:00', end: null } }), {
    type: 'date',
    date: { start: '2026-03-01T09:00:00.000+09:00', end: null, time_zone: null },
  })
  assert.deepEqual(cell(P.date, { date: { start: '2026-03-01' } }), { type: 'date', date: { start: '2026-03-01', end: null, time_zone: null } })
  assert.deepEqual(cell(P.date, { date: null }), { type: 'date', date: null })
})

test('★ 되돌리기 — 내보낸 값을 그대로 다시 보내면 같은 칸이다', () => {
  const cells: Record<string, unknown> = {
    [P.select.id]: { type: 'select', select: { id: O_DONE } },
    [P.multi.id]: { type: 'multi_select', multi_select: [{ id: O_TODO }] },
    [P.date.id]: { type: 'date', date: { start: '2026-03-01', end: '2026-03-05', time_zone: null } },
    [P.people.id]: { type: 'people', people: [{ id: U1 }] },
    [P.files.id]: { type: 'files', files: [{ id: F1, name: 'a.txt' }] },
    [P.place.id]: { type: 'place', place: { name: '역', address: '주소', lat: 1, lng: 2 } },
  }
  const r = row(cells)
  for (const p of [P.select, P.multi, P.date, P.people, P.files, P.place]) {
    const out = value(p, r)
    assert.deepEqual(cell(p, out, r.options.get(p.id) ?? []), cells[p.id], p.name)
  }
})

test('★ 거부 — 없는 옵션 · 계산 · 읽기 전용 · 봉투의 타입 · 모양(영어로 자리를 말한다)', () => {
  const cases: [ApiProperty, unknown, RegExp, readonly SelectOption[]?][] = [
    [P.select, { select: { name: '없는 옵션' } }, /body\.properties\.종류\.select\.name `"없는 옵션"` is not an option of property "종류"/, selectOptions],
    [P.status, { status: { id: '99999999-9999-4999-8999-999999999999' } }, /status\.id .* is not an option/, statusOptions],
    [P.multi, { multi_select: [null] }, /multi_select\[0\] should be an object/, selectOptions],
    [P.formula, { formula: { number: 1 } }, /is a formula property and cannot be updated/],
    [P.rollup, { rollup: {} }, /is a rollup property and cannot be updated/],
    [P.uid, { unique_id: { number: 3 } }, /is a unique_id property/],
    [P.ct, { created_time: '2026-01-01' }, /is a created_time property/],
    [P.verify, { verification: { state: 'verified' } }, /is a verification property/],
    [P.button, { button: {} }, /is a button property/],
    [P.number, { type: 'rich_text', rich_text: [] }, /\.type should be `"number"`/],
    [P.number, { select: null }, /\.number should be defined/],
    [P.number, { number: '3' }, /\.number should be a number/],
    [P.number, { number: Number.POSITIVE_INFINITY }, /\.number should be a number/],
    [P.check, { checkbox: null }, /\.checkbox should be a boolean/],
    [P.date, { date: { end: '2026-01-01' } }, /\.date\.start should be a string/],
    [P.date, { date: { start: '2026-02-30' } }, /\.date\.start is invalid/],
    [P.date, { date: { start: '2026-03-05', end: '2026-03-01' } }, /\.date is invalid/],
    [P.date, { date: { start: '2026-03-05', time_zone: 'not a zone!' } }, /\.date\.time_zone is invalid/],
    [P.people, { people: [{ id: 'nope' }] }, /people\[0\]\.id should be a valid uuid/],
    [P.files, { files: [{ name: 'a', type: 'external', external: { url: 'https://x' } }] }, /files\[0\]\.type `"external"` is not supported/],
    [P.files, { files: [{ type: 'file_upload', file_upload: { id: F1 } }] }, /files\[0\]\.name should be a non-empty string/],
    [P.email, { email: 'x'.repeat(300) }, /\.email is invalid/],
    [P.place, { place: { lat: 100, lon: 0, name: '극' } }, /\.place\.lat is invalid/],
    [P.place, { place: { lat: 1, lon: 2 } }, /\.place\.name should be a non-empty string/],
    [P.relation, { relation: [{ id: 3 }] }, /relation\[0\]\.id should be a valid uuid/],
    [P.title, { title: 'plain' }, /\.title should be an array/],
    [P.title, 'plain', /body\.properties\.이름 should be an object/],
  ]
  for (const [p, raw, pattern, options] of cases) {
    const r = write(p, raw, options ?? [])
    assert.ok(!r.ok, `${p.name} ${JSON.stringify(raw)}`)
    if (!r.ok) assert.match(r.message, pattern)
  }
})
