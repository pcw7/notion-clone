import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_TIMELINE_SHOW_TABLE,
  DEFAULT_TIMELINE_ZOOM,
  MAX_TIMELINE_ROWS,
  MAX_TIMELINE_SPAN_DAYS,
  mergeTimelineLayout,
  readTimelineLayout,
  validateTimelinePatch,
} from './timeline.ts'

const types = new Map([
  ['d1', 'date'],
  ['t1', 'rich_text'],
])

test('상수 — 732일 · 1000행 · 기본 줌 week · 표 보임', () => {
  assert.equal(MAX_TIMELINE_SPAN_DAYS, 732)
  assert.equal(MAX_TIMELINE_ROWS, 1000)
  assert.equal(DEFAULT_TIMELINE_ZOOM, 'week')
  assert.equal(DEFAULT_TIMELINE_SHOW_TABLE, true)
})

test('readTimelineLayout — 없거나 모르는 값이면 기본값 · 날짜 속성 null', () => {
  const base = { date_property_id: null, zoom: 'week', show_table: true }
  assert.deepEqual(readTimelineLayout(null), base)
  assert.deepEqual(readTimelineLayout({}), base)
  assert.deepEqual(readTimelineLayout({ timeline: 'x' }), base)
  assert.deepEqual(readTimelineLayout({ timeline: { date_property_id: 3, zoom: 'hour', show_table: 'y' } }), base)
})

test('readTimelineLayout — 저장된 값을 읽는다', () => {
  assert.deepEqual(readTimelineLayout({ timeline: { date_property_id: 'd1', zoom: 'quarter', show_table: false } }), {
    date_property_id: 'd1',
    zoom: 'quarter',
    show_table: false,
  })
})

test('validateTimelinePatch — 올바른 부분 · 거부', () => {
  assert.deepEqual(validateTimelinePatch({ zoom: 'year' }, types), [])
  assert.deepEqual(validateTimelinePatch({ date_property_id: 'd1', show_table: false }, types), [])
  assert.equal(validateTimelinePatch(null, types).length, 1)
  assert.equal(validateTimelinePatch([], types).length, 1)
  assert.equal(validateTimelinePatch({}, types).length, 1)
  assert.equal(validateTimelinePatch({ zoom: 'hour' }, types)[0]?.path, 'timeline.zoom')
  assert.equal(validateTimelinePatch({ show_table: 1 }, types)[0]?.path, 'timeline.show_table')
  assert.equal(validateTimelinePatch({ date_property_id: 't1' }, types)[0]?.path, 'timeline.date_property_id')
  assert.equal(validateTimelinePatch({ date_property_id: 'nope' }, types)[0]?.path, 'timeline.date_property_id')
  assert.equal(validateTimelinePatch({ date_property_id: 5 }, types)[0]?.path, 'timeline.date_property_id')
  assert.equal(validateTimelinePatch({ color_by: 'x' }, types)[0]?.path, 'timeline.color_by')
})

test('mergeTimelineLayout — 준 키만 바꾼다', () => {
  const cur = { date_property_id: 'd1', zoom: 'week', show_table: true } as const
  assert.deepEqual(mergeTimelineLayout(cur, { zoom: 'month' }), { date_property_id: 'd1', zoom: 'month', show_table: true })
  assert.deepEqual(mergeTimelineLayout(cur, { show_table: false }), { date_property_id: 'd1', zoom: 'week', show_table: false })
  assert.deepEqual(mergeTimelineLayout(cur, {}), cur)
})
