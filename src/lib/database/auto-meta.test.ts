/**
 * 만든 · 마지막 편집 시각과 사람 — 글 · 연산자 · 집계 · 공개 칸 (순수) — PT-3조각 (F-03-08)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { publicCell } from '../../app/p/public-cells.ts'
import type { PublicColumn } from '../publish/public-database.ts'
import { autoMetaPersonText, formatAutoMetaTime } from './cell-format.ts'
import { calculationsFor, canCalculate, canCalculateColumn } from './calculations.ts'
import { operatorsFor } from './filter.ts'
import { AUTO_META_TYPES, isAutoMetaPersonType, isAutoMetaTimeType, isAutoMetaType, isMvpPropertyType } from './property-types.ts'
import { isSortable, type ViewColumn } from './view-columns.ts'

test('시각의 글 — 날짜 칸의 시각 있는 모양(상대 시각 없음) · 보는 사람의 시간대로', () => {
  assert.equal(formatAutoMetaTime('2026-03-01T15:21:05.123Z', 'UTC'), '2026년 3월 1일 15:21')
  assert.equal(formatAutoMetaTime('2026-03-01T15:21:05.123Z', 'Asia/Seoul'), '2026년 3월 2일 00:21', '날짜가 넘어간다')
  assert.equal(formatAutoMetaTime('2026-03-01T00:05:00Z', 'UTC'), '2026년 3월 1일 00:05', '자정은 00 시')
  assert.equal(formatAutoMetaTime('엉터리'), '', '읽을 수 없는 값은 빈 글')
  assert.equal(formatAutoMetaTime('2026-03-01T15:21:00Z', 'Nowhere/Nothing'), '2026년 3월 1일 15:21', '모르는 시간대는 UTC')
})

test('사람의 글 — 이름표 · 만든 사람이 없는 행(익명 폼)은 빈 칸', () => {
  assert.equal(autoMetaPersonText('a', { a: '대표' }), '대표')
  assert.equal(autoMetaPersonText(null, { a: '대표' }), '')
  assert.equal(autoMetaPersonText('b', { a: '대표' }), '', '아직 이름표가 오지 않았다')
  // 게스트에게는 서버가 이름 대신 "멤버" 를 준다 — 이 함수는 받은 이름표를 그대로 쓴다
  assert.equal(autoMetaPersonText('a', { a: '멤버' }), '멤버')
})

test('타입 술어 — 넷은 셀 타입이 아니다(C1)', () => {
  assert.deepEqual([...AUTO_META_TYPES], ['created_time', 'created_by', 'last_edited_time', 'last_edited_by'])
  for (const t of AUTO_META_TYPES) {
    assert.ok(isAutoMetaType(t))
    assert.ok(!isMvpPropertyType(t), `${t} 는 셀 타입이 아니다`)
    assert.equal(isAutoMetaTimeType(t) !== isAutoMetaPersonType(t), true, `${t} 는 시각 아니면 사람`)
  }
  assert.ok(!isAutoMetaType('date') && !isAutoMetaType('people'))
})

test('연산자 — 시각은 날짜의 것(상대 날짜 포함) · 사람은 사람의 것', () => {
  assert.deepEqual(operatorsFor('created_time'), operatorsFor('date'))
  assert.deepEqual(operatorsFor('last_edited_time'), operatorsFor('date'))
  assert.ok(operatorsFor('created_time').includes('past_week'))
  assert.deepEqual(operatorsFor('created_by'), ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'])
  assert.deepEqual(operatorsFor('last_edited_by'), operatorsFor('created_by'))
})

test('열 집계 — 시각은 가장 이른 · 늦은 · 기간 · 사람은 세기 · 보드 그룹의 집계에는 열리지 않는다', () => {
  assert.deepEqual(calculationsFor('created_time'), ['count_all', 'earliest_date', 'latest_date', 'date_range'])
  assert.ok(calculationsFor('last_edited_by').includes('count_values'))
  assert.ok(canCalculateColumn('created_time', 'earliest_date'))
  assert.ok(!canCalculateColumn('created_by', 'earliest_date'))
  assert.ok(!canCalculate('created_time', 'earliest_date'), '그룹 머리의 집계(page_property_value)는 이 타입을 읽지 못한다')
})

test('정렬 — 시각만 정렬한다(사람 id 의 순서는 뜻이 없다)', () => {
  const column = (type: ViewColumn['type']) => ({ propertyId: 'p', name: 'n', visible: true, orderKey: 'a', width: null, wrap: false, options: [], type }) as ViewColumn
  assert.ok(isSortable(column('created_time')) && isSortable(column('last_edited_time')))
  assert.ok(!isSortable(column('created_by')) && !isSortable(column('last_edited_by')))
})

test('공개 칸 — 시각은 UTC 글로 · 사람 열은 공개 열이 아니라 칸이 비어 있다', () => {
  const column = (type: string): PublicColumn => ({ id: 'p', name: 'n', type: type as PublicColumn['type'], options: [], prefix: null })
  assert.deepEqual(publicCell(column('created_time'), { type: 'created_time', created_time: '2026-03-01T15:21:05.123Z' }, null), {
    kind: 'text',
    text: '2026-03-01 15:21 UTC',
  })
  assert.deepEqual(publicCell(column('last_edited_time'), undefined, null), { kind: 'empty' })
  assert.deepEqual(publicCell(column('created_by'), { type: 'created_by', created_by: 'x' }, null), { kind: 'empty' }, '사람은 그리지 않는다')
})
