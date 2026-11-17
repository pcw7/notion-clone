/**
 * 공개 API 의 속성 스키마 객체 — 우리 속성 → 노션의 property object (API-4 · F-09-16 · 순수)
 *
 *   ★ 타입마다 노션의 모양 — 제목 id 는 title · 옵션 {id,name,color} · 상태 범주(이름 · 색 · option_ids) · 숫자 format · 수식 expression ·
 *     relation(짝 있음 · 없음 · 자기 자신) · rollup(이름 · 대상 제목은 title) · 고유 ID prefix · 설정 없는 타입은 {}
 *   ★ 설명은 있을 때만 · 다른 표의 이름을 모르면 null · 열쇠는 이름 · 스키마 순서
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { SelectOption } from '../database/property-types.ts'
import { schemaPropertyToApi, schemaToApi, type SchemaLookups, type SchemaProperty } from './schema-object.ts'

const DS = '11111111-1111-4111-8111-111111111111'
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const G3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const p = (id: string, name: string, type: string, config: unknown = {}, extra: Partial<SchemaProperty> = {}): SchemaProperty => ({
  id,
  name,
  type,
  config,
  description: null,
  ...extra,
})

const statusOptions: SelectOption[] = [
  { id: 'o1', name: '시작 전', color: 'default', group: 'todo' },
  { id: 'o2', name: '진행 중', color: 'blue', group: 'in_progress' },
  { id: 'o3', name: '끝', color: 'green', group: 'complete' },
]

const lookups: SchemaLookups = {
  uniqueIdPrefix: 'TASK',
  statusGroups: new Map([['p_status', [{ id: G1, kind: 'todo' }, { id: G2, kind: 'in_progress' }, { id: G3, kind: 'complete' }]]]),
  refs: new Map([
    ['p_rel', { name: '관련', type: 'relation' }],
    ['t_back', { name: '거꾸로', type: 'relation' }],
    ['t_value', { name: '값', type: 'number' }],
    ['t_title', { name: '대상 이름', type: 'title' }],
    ['t_hidden', { name: null, type: 'relation' }],
  ]),
}

const out = (prop: SchemaProperty) => schemaPropertyToApi(prop, lookups)

test('★ 설정이 없는 타입 — {id, name, type, <type>: {}} · 제목 id 는 title', () => {
  assert.deepEqual(out(p('p_title', '이름', 'title')), { id: 'title', name: '이름', type: 'title', title: {} })
  for (const type of ['rich_text', 'date', 'people', 'files', 'checkbox', 'url', 'email', 'phone_number', 'place', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'verification', 'button']) {
    assert.deepEqual(out(p('p_x', 'X', type)), { id: 'p_x', name: 'X', type, [type]: {} }, type)
  }
})

test('★ 숫자 · 수식 · 고유 ID', () => {
  assert.deepEqual(out(p('p_num', '점수', 'number')), { id: 'p_num', name: '점수', type: 'number', number: { format: 'number' } })
  // 저장된 식의 `⟦id⟧` 는 지금 이름으로
  const withScore: SchemaLookups = { ...lookups, refs: new Map([...lookups.refs, ['p_num', { name: '점수', type: 'number' }]]) }
  assert.deepEqual(schemaPropertyToApi(p('p_f', '두배', 'formula', { expression: '⟦p_num⟧ * 2', result_type: 'number' }), withScore).formula, { expression: 'prop("점수") * 2' })
  assert.deepEqual(out(p('p_uid', '번호', 'unique_id')).unique_id, { prefix: 'TASK' })
  assert.deepEqual(schemaPropertyToApi(p('p_uid', '번호', 'unique_id'), { ...lookups, uniqueIdPrefix: null }).unique_id, { prefix: null })
})

test('★ 선택 · 다중 선택 — options {id, name, color}', () => {
  const options: SelectOption[] = [{ id: 'a', name: '버그', color: 'red' }, { id: 'b', name: '기능', color: 'blue' }]
  assert.deepEqual(out(p('p_s', '종류', 'select', {}, { options })).select, { options: [{ id: 'a', name: '버그', color: 'red' }, { id: 'b', name: '기능', color: 'blue' }] })
  assert.deepEqual(out(p('p_m', '태그', 'multi_select', {}, { options: [] })).multi_select, { options: [] })
})

test('★ 상태 — options 와 groups(노션의 범주 이름 · 색 · 그 범주의 옵션 id)', () => {
  assert.deepEqual(out(p('p_status', '상태', 'status', {}, { options: statusOptions })).status, {
    options: [
      { id: 'o1', name: '시작 전', color: 'default' },
      { id: 'o2', name: '진행 중', color: 'blue' },
      { id: 'o3', name: '끝', color: 'green' },
    ],
    groups: [
      { id: G1, name: 'To-do', color: 'gray', option_ids: ['o1'] },
      { id: G2, name: 'In progress', color: 'blue', option_ids: ['o2'] },
      { id: G3, name: 'Complete', color: 'green', option_ids: ['o3'] },
    ],
  })
})

test('★ relation — 짝이 있으면 dual_property · 없으면 single_property · 자기 자신 · 이름을 모르면 null', () => {
  assert.deepEqual(out(p('p_rel', '관련', 'relation', { target_data_source_id: DS, synced_property_id: 't_back' })).relation, {
    data_source_id: DS,
    type: 'dual_property',
    dual_property: { synced_property_id: 't_back', synced_property_name: '거꾸로' },
  })
  assert.deepEqual(out(p('p_one', '한쪽', 'relation', { target_data_source_id: DS })).relation, { data_source_id: DS, type: 'single_property', single_property: {} })
  assert.deepEqual(out(p('p_self', '서로', 'relation', { target_data_source_id: DS, synced_property_id: 'p_self' })).relation, {
    data_source_id: DS,
    type: 'dual_property',
    dual_property: { synced_property_id: 'p_self', synced_property_name: '서로' },
  })
  assert.equal(
    (out(p('p_x', '숨김', 'relation', { target_data_source_id: DS, synced_property_id: 't_hidden' })).relation as { dual_property: { synced_property_name: unknown } }).dual_property
      .synced_property_name,
    null,
  )
})

test('★ rollup — 연결 · 대상의 id 와 이름 · 함수 · 대상이 제목이면 title', () => {
  assert.deepEqual(out(p('p_r', '합', 'rollup', { relation_property_id: 'p_rel', target_property_id: 't_value', function: 'sum' })).rollup, {
    relation_property_id: 'p_rel',
    relation_property_name: '관련',
    rollup_property_id: 't_value',
    rollup_property_name: '값',
    function: 'sum',
  })
  const titled = out(p('p_r2', '원본', 'rollup', { relation_property_id: 'p_rel', target_property_id: 't_title', function: 'show_original' })).rollup as Record<string, unknown>
  assert.equal(titled.rollup_property_id, 'title')
  assert.equal(titled.rollup_property_name, '대상 이름')
})

test('★ 설명은 있을 때만 · 열쇠는 이름 · 스키마 순서', () => {
  assert.deepEqual(out(p('p_d', '메모', 'rich_text', {}, { description: '자세한 설명' })), { id: 'p_d', name: '메모', type: 'rich_text', description: '자세한 설명', rich_text: {} })
  assert.equal('description' in out(p('p_d', '메모', 'rich_text', {}, { description: '  ' })), false)
  const all = schemaToApi([p('p_title', '이름', 'title'), p('p_num', '점수', 'number')], lookups)
  assert.deepEqual(Object.keys(all), ['이름', '점수'])
  assert.equal((all['점수'] as { id: string }).id, 'p_num')
})
