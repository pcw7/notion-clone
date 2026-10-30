/**
 * 데이터베이스 복제의 id 다시 매기기 (29번 트랙 D-1 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 D-1] ② ③
 *
 *   ① 글자 · 배열 · 중첩 객체의 값이 id 면 바꾼다 · 지도에 없는 것(바깥)은 그대로 · 원본은 건드리지 않는다
 *   ② 객체의 키가 id 면 키도 바꾼다
 *   ③ ★ 수식의 `⟦id⟧` 토큰을 바꾼다 — 지도에 없는 토큰은 그대로
 *   ④ ★ relation — 대상이 사본 안이면 대상 · 짝을 바꾸고, 바깥이면 짝을 떼어 한쪽 relation 으로(대상은 그대로)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { remapIds, remapRelationConfig } from './duplicate-database-remap.ts'

const ids = new Map([
  ['propA', 'newA'],
  ['propB', 'newB'],
  ['opt-1', 'opt-9'],
  ['ds-old', 'ds-new'],
])

test('① 값이 id 면 바꾼다 · 바깥은 그대로 · 원본은 그대로', () => {
  const filter = { and: [{ property_id: 'propA', operator: 'equals', value: 'opt-1' }, { property_id: 'outside', operator: 'is_empty' }] }
  const out = remapIds(filter, ids)
  assert.deepEqual(out, { and: [{ property_id: 'newA', operator: 'equals', value: 'opt-9' }, { property_id: 'outside', operator: 'is_empty' }] })
  assert.equal(filter.and[0]!.property_id, 'propA', '원본은 건드리지 않는다')
  assert.deepEqual(remapIds([{ property_id: 'propB', direction: 'desc' }], ids), [{ property_id: 'newB', direction: 'desc' }])
  assert.equal(remapIds(42, ids), 42)
  assert.equal(remapIds(null, ids), null)
})

test('② 객체의 키가 id 면 키도', () => {
  assert.deepEqual(remapIds({ hidden: { 'opt-1': true, other: false } }, ids), { hidden: { 'opt-9': true, other: false } })
})

test('③ ★ 수식의 토큰', () => {
  assert.deepEqual(
    remapIds({ expression: '⟦propA⟧ + ⟦propB⟧ * ⟦outside⟧', result_type: 'number' }, ids),
    { expression: '⟦newA⟧ + ⟦newB⟧ * ⟦outside⟧', result_type: 'number' },
  )
})

test('④ ★ relation — 안이면 대상 · 짝을 바꾸고 바깥이면 한쪽으로', () => {
  assert.deepEqual(
    remapRelationConfig({ target_data_source_id: 'ds-old', synced_property_id: 'propB', sub_items: 'parent', limit: 'one' }, ids),
    { target_data_source_id: 'ds-new', synced_property_id: 'newB', sub_items: 'parent', limit: 'one' },
  )
  assert.deepEqual(
    remapRelationConfig({ target_data_source_id: 'ds-outside', synced_property_id: 'theirs' }, ids),
    { target_data_source_id: 'ds-outside' },
    '바깥 — 짝을 떼고 대상은 그대로',
  )
})
