/**
 * 공개 차트의 집계 → 그릴 자료 (PV-3 · 순수) — 옵션 순서 · 없음 · 숨긴 그룹 · 개수 대 합계
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { BoardSpec } from './public-board.ts'
import { buildChartGroups, chartCalculationSupported, chartResultOf, chartSeriesOf, type ChartStatRow } from './public-chart.ts'

const spec = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  type: 'select',
  options: [
    { id: 'a', name: '할 일', color: 'red' },
    { id: 'b', name: '진행', color: 'blue' },
    { id: 'c', name: '끝', color: 'green' },
  ],
  hidden: [],
  hideEmpty: false,
  ...over,
})

const stat = (key: string, n: number, sum: number | null = null): ChartStatRow => ({
  key, n, filled: n, distinct: n, sum, avg: sum === null ? null : sum / n, median: null, min: null, max: null,
})

describe('buildChartGroups', () => {
  test('옵션 순서 · 값 없음은 맨 앞 "없음" · 통계 줄이 없는 그룹은 0', () => {
    // 줄은 섞여 들어와도 순서는 옵션 순서
    const groups = buildChartGroups(spec(), [stat('c', 1), stat('', 2), stat('a', 3)], null)
    assert.deepEqual(groups.map((g) => [g.key, g.name, g.count]), [['', '없음', 2], ['a', '할 일', 3], ['b', '진행', 0], ['c', '끝', 1]])
    assert.equal(groups[1]!.color, 'red')
    assert.equal(groups[0]!.color, null)
    assert.ok(groups.every((g) => g.value === null), '계산이 없으면 값은 개수')
  })

  test('숨긴 그룹은 빠지고 hide_empty 는 행이 0개인 그룹을 뺀다', () => {
    const groups = buildChartGroups(spec({ hidden: ['b'], hideEmpty: true }), [stat('a', 1), stat('c', 2)], null)
    assert.deepEqual(groups.map((g) => g.key), ['a', 'c'], '없음(0개) · 진행(숨김)은 없다')
  })

  test('체크박스는 체크 안 함 → 체크', () => {
    const groups = buildChartGroups({ type: 'checkbox', options: [], hidden: [], hideEmpty: false }, [stat('true', 2)], null)
    assert.deepEqual(groups.map((g) => [g.key, g.count]), [['false', 0], ['true', 2]])
  })
})

describe('chartSeriesOf', () => {
  test('개수 대 합계 — 합계는 그룹의 합을 그린다(행 수가 아니다)', () => {
    const rows = [stat('a', 2, 30), stat('b', 1, 7)]
    const counted = chartSeriesOf(buildChartGroups(spec(), rows, null), null)
    assert.deepEqual(counted.data.map((d) => d.value), [0, 2, 1, 0])
    assert.equal(counted.integer, true)

    const summed = chartSeriesOf(buildChartGroups(spec(), rows, 'sum'), 'sum')
    assert.deepEqual(summed.data.map((d) => d.value), [0, 30, 7, 0], '합은 행이 없으면 0')
    assert.deepEqual(summed.data.map((d) => d.text), ['0', '30', '7', '0'])
    assert.equal(summed.integer, false)
    assert.equal(summed.data[1]!.color, 'red')
    assert.equal(summed.data[0]!.color, null)
  })

  test('평균이 빈 그룹은 0 으로 그리고 글자는 —', () => {
    const series = chartSeriesOf(buildChartGroups(spec(), [stat('a', 2, 30)], 'average'), 'average')
    assert.equal(series.data.find((d) => d.key === 'b')!.value, 0)
    assert.equal(series.data.find((d) => d.key === 'b')!.text, '—')
    assert.equal(series.data.find((d) => d.key === 'a')!.value, 15)
  })

  test('행이 하나도 없으면 empty', () => {
    assert.equal(chartSeriesOf(buildChartGroups(spec(), [], null), null).empty, true)
    assert.equal(chartSeriesOf(buildChartGroups(spec(), [stat('a', 1)], null), null).empty, false)
  })
})

describe('chartCalculationSupported · chartResultOf', () => {
  test('개수 · 숫자 속성의 통계만 — 그 밖은 표', () => {
    assert.equal(chartCalculationSupported(null, undefined), true)
    assert.equal(chartCalculationSupported('sum', 'number'), true)
    assert.equal(chartCalculationSupported('count_all', 'select'), true)
    assert.equal(chartCalculationSupported('sum', 'formula:number'), false)
    assert.equal(chartCalculationSupported('count_values', 'select'), false)
    assert.equal(chartCalculationSupported('earliest_date', 'date'), false)
    assert.equal(chartCalculationSupported('sum', 'rollup'), false)
  })

  test('통계 → 앱과 같은 계산 결과', () => {
    const row = { n: 4, filled: 3, distinct: 2, sum: 60, avg: 20, median: 20, min: 10, max: 30 }
    assert.deepEqual(chartResultOf('sum', row), { kind: 'number', value: 60 })
    assert.deepEqual(chartResultOf('max', row), { kind: 'number', value: 30 })
    assert.deepEqual(chartResultOf('count_empty', row), { kind: 'count', value: 1 })
  })
})
