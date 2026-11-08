import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CHART_LAYOUT, mergeChartLayout, readChartLayout, validateChartPatch } from './chart.ts'

test('readChartLayout — 없거나 모르는 값이면 기본값', () => {
  assert.deepEqual(readChartLayout(null), DEFAULT_CHART_LAYOUT)
  assert.deepEqual(readChartLayout({}), DEFAULT_CHART_LAYOUT)
  assert.deepEqual(readChartLayout({ chart: 'x' }), DEFAULT_CHART_LAYOUT)
  assert.deepEqual(readChartLayout({ chart: { kind: 'pie', data_labels: 1 } }), DEFAULT_CHART_LAYOUT)
})

test('readChartLayout — 저장된 값을 읽는다', () => {
  assert.deepEqual(readChartLayout({ chart: { kind: 'donut', data_labels: true, cumulative: true } }), {
    kind: 'donut',
    data_labels: true,
    cumulative: true,
  })
})

test('validateChartPatch — 올바른 부분 · 거부', () => {
  assert.deepEqual(validateChartPatch({ kind: 'line' }), [])
  assert.deepEqual(validateChartPatch({ kind: 'number' }), [])
  assert.deepEqual(readChartLayout({ chart: { kind: 'number', data_labels: false, cumulative: false } }).kind, 'number')
  assert.deepEqual(validateChartPatch({ data_labels: true, cumulative: false }), [])
  assert.equal(validateChartPatch(null).length, 1)
  assert.equal(validateChartPatch([]).length, 1)
  assert.equal(validateChartPatch({}).length, 1)
  assert.equal(validateChartPatch({ kind: 'pie' })[0]?.path, 'chart.kind')
  assert.equal(validateChartPatch({ data_labels: 'yes' })[0]?.path, 'chart.data_labels')
  assert.equal(validateChartPatch({ cumulative: 1 })[0]?.path, 'chart.cumulative')
  assert.equal(validateChartPatch({ stack: true })[0]?.path, 'chart.stack')
})

test('mergeChartLayout — 바꾸려는 키만 얹는다', () => {
  assert.deepEqual(mergeChartLayout(DEFAULT_CHART_LAYOUT, { kind: 'bar' }), { kind: 'bar', data_labels: false, cumulative: false })
  assert.deepEqual(mergeChartLayout({ kind: 'bar', data_labels: true, cumulative: false }, { cumulative: true }), {
    kind: 'bar',
    data_labels: true,
    cumulative: true,
  })
})
