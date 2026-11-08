import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accumulate,
  cumulativeAllowed,
  donutLabelVisible,
  OPTION_FILL,
  DONUT_CYCLE,
  arcPath,
  chartCalculationsFor,
  chartData,
  chartSummaryLabel,
  donutSlices,
  fillOf,
  niceCeil,
  niceScale,
  scaleLinear,
  truncateLabel,
  type SummaryGroup,
  type SummaryInput,
} from './chart-geometry.ts'
import { OPTION_COLORS } from './property-types.ts'

test('niceCeil — 1 · 2 · 5 × 10ⁿ 로 올린다', () => {
  assert.equal(niceCeil(0), 1)
  assert.equal(niceCeil(-3), 1)
  assert.equal(niceCeil(1), 1)
  assert.equal(niceCeil(1.1), 2)
  assert.equal(niceCeil(3), 5)
  assert.equal(niceCeil(5), 5)
  assert.equal(niceCeil(5.1), 10)
  assert.equal(niceCeil(37), 50)
  assert.equal(niceCeil(101), 200)
  assert.equal(niceCeil(0.03), 0.05)
  assert.equal(niceCeil(0.1 * 3), 0.5)
})

test('niceScale — 다섯 칸 안팎 · 개수는 정수 눈금', () => {
  assert.deepEqual(niceScale([3, 1], true), { min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5] })
  assert.deepEqual(niceScale([1], true), { min: 0, max: 1, ticks: [0, 1] })
  assert.deepEqual(niceScale([0, 0], true), { min: 0, max: 1, ticks: [0, 1] })
  assert.deepEqual(niceScale([2], true), { min: 0, max: 2, ticks: [0, 1, 2] })
  assert.deepEqual(niceScale([37]), { min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50] })
  assert.deepEqual(niceScale([1]), { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] })
  assert.deepEqual(niceScale([2]), { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2] })
  assert.deepEqual(niceScale([]), { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] })
})

test('niceScale — 음수가 있으면 0 아래로도 같은 간격', () => {
  const s = niceScale([-30, 80])
  assert.equal(s.max, 80)
  assert.equal(s.min, -40)
  assert.deepEqual(s.ticks, [-40, -20, 0, 20, 40, 60, 80])
  const onlyNeg = niceScale([-5, -2])
  assert.equal(onlyNeg.max, 0)
  assert.ok(onlyNeg.min <= -5)
})

test('scaleLinear — 아래 끝 · 위 끝', () => {
  const y = scaleLinear({ min: 0, max: 50, ticks: [] }, 100, 0)
  assert.equal(y(0), 100)
  assert.equal(y(50), 0)
  assert.equal(y(25), 50)
  assert.equal(scaleLinear({ min: 0, max: 0, ticks: [] }, 7, 1)(3), 7)
})

test('donutSlices — 양수만 · 합이 한 바퀴', () => {
  assert.deepEqual(donutSlices([0, 0]), [])
  const s = donutSlices([1, 0, 3, -2])
  assert.equal(s.length, 2)
  assert.deepEqual(
    s.map((x) => x.index),
    [0, 2],
  )
  assert.equal(s[0].start, 0)
  assert.ok(Math.abs(s[0].fraction - 0.25) < 1e-12)
  assert.ok(Math.abs(s[1].end - Math.PI * 2) < 1e-9)
  assert.ok(Math.abs(s[0].end - s[1].start) < 1e-12)
})

test('arcPath — 호 · 큰 호 플래그 · 한 바퀴', () => {
  // 4분의 1(12시 → 3시)
  assert.equal(arcPath(50, 50, 40, 20, 0, Math.PI / 2), 'M50 10A40 40 0 0 1 90 50L70 50A20 20 0 0 0 50 30Z')
  // 절반 넘는 호는 큰 호
  assert.match(arcPath(50, 50, 40, 20, 0, Math.PI * 1.5), /A40 40 0 1 1/)
  // 조각 하나 = 한 바퀴 — 반원 둘 + 안쪽 구멍
  const full = arcPath(50, 50, 40, 20, 0, Math.PI * 2)
  assert.equal((full.match(/M/g) ?? []).length, 2)
  assert.equal((full.match(/A/g) ?? []).length, 4)
})

const group = (key: string, count: number, extra: Partial<SummaryGroup> = {}): SummaryGroup => ({
  key,
  option: null,
  statusGroup: null,
  count,
  hidden: false,
  value: null,
  ...extra,
})
const summary = (groups: SummaryGroup[], extra: Partial<SummaryInput> = {}): SummaryInput => ({
  propertyType: 'select',
  propertyName: '상태',
  calculation: null,
  dateUnit: null,
  numberSize: null,
  textMode: null,
  groups,
  ...extra,
})

test('chartData — 숨긴 그룹은 빼고 차례는 그대로 · 이름은 보드 머리와 같다', () => {
  const c = chartData(
    summary([
      group('a', 2, { option: { id: 'a', name: '진행', color: 'blue' } }),
      group('b', 5, { hidden: true, option: { id: 'b', name: '숨김', color: 'red' } }),
      group('', 1),
    ]),
  )
  assert.deepEqual(
    c.data.map((d) => [d.key, d.label, d.value, d.text, d.color]),
    [
      ['a', '진행', 2, '2', 'blue'],
      ['', '상태 없음', 1, '1', null],
    ],
  )
  assert.equal(c.empty, false)
  assert.equal(c.yNeedsReselect, false)
  assert.equal(c.integer, true)
})

test('chartData — 계산 값 · 머리와 같은 글자', () => {
  const c = chartData(
    summary(
      [
        group('x', 2, { value: { kind: 'number', value: 12.5 } }),
        group('y', 1, { value: { kind: 'number', value: null } }),
        group('z', 1, { value: { kind: 'percent', value: 50 } }),
      ],
      { calculation: { property_id: 'p', function: 'sum' } },
    ),
  )
  assert.deepEqual(
    c.data.map((d) => [d.value, d.text]),
    [
      [12.5, '12.5'],
      [0, '—'],
      [50, '50%'],
    ],
  )
  assert.equal(c.integer, false)
})

test('chartData — 수가 아닌 계산은 개수로 그리고 다시 고르라고 한다', () => {
  const c = chartData(
    summary([group('x', 3, { value: { kind: 'date', value: '2026-01-01' } })], {
      calculation: { property_id: 'p', function: 'earliest_date' },
    }),
  )
  assert.equal(c.yNeedsReselect, true)
  assert.deepEqual(
    c.data.map((d) => d.value),
    [3],
  )
})

test('chartData — 행이 없으면 empty', () => {
  assert.equal(chartData(summary([group('a', 0), group('b', 0)])).empty, true)
  assert.equal(chartData(summary([])).empty, true)
  assert.equal(chartData(summary([group('a', 0), group('b', 4, { hidden: true })])).empty, true)
})

test('chartData — status 범주 그룹은 범주 이름과 색', () => {
  const c = chartData(
    summary([group('todo', 1, { statusGroup: 'todo' }), group('complete', 1, { statusGroup: 'complete' })], { propertyType: 'status' }),
  )
  assert.deepEqual(
    c.data.map((d) => [d.label, d.color]),
    [
      ['할 일', 'gray'],
      ['완료', 'green'],
    ],
  )
})

test('chartData — 체크박스 이름', () => {
  const c = chartData(summary([group('true', 1), group('false', 2)], { propertyType: 'checkbox' }))
  assert.deepEqual(
    c.data.map((d) => d.label),
    ['체크됨', '체크 안 됨'],
  )
})

test('chartCalculationsFor — 날짜 · 기간 계산은 고르개에 없다', () => {
  assert.ok(chartCalculationsFor('number').includes('sum'))
  assert.ok(!chartCalculationsFor('date').includes('earliest_date'))
  assert.ok(!chartCalculationsFor('date').includes('date_range'))
  assert.ok(chartCalculationsFor('date').includes('count_values'))
  assert.deepEqual(chartCalculationsFor('relation'), [])
})

test('색 — 옵션 색 · 한 색 · 도넛은 차례로', () => {
  assert.deepEqual(Object.keys(OPTION_FILL), [...OPTION_COLORS])
  const withColor = { key: 'a', label: 'a', value: 1, text: '1', color: 'red' as const }
  const plain = { ...withColor, color: null }
  assert.equal(fillOf(withColor, 0, true), OPTION_FILL.red)
  assert.equal(fillOf(plain, 0, false), fillOf(plain, 5, false))
  assert.equal(fillOf(plain, 0, true), OPTION_FILL[DONUT_CYCLE[0]])
  assert.equal(fillOf(plain, DONUT_CYCLE.length, true), OPTION_FILL[DONUT_CYCLE[0]])
})

test('truncateLabel · chartSummaryLabel', () => {
  assert.equal(truncateLabel('가나다', 5), '가나다')
  assert.equal(truncateLabel('가나다라마바', 4), '가나다…')
  assert.equal(chartSummaryLabel('column', 3), '세로 막대 · 그룹 3개')
  assert.equal(chartSummaryLabel('donut', 0), '도넛 · 그룹 0개')
})

test('★ 도넛은 조각 색이 겹치면 도는 색 — 모두 다르면 옵션 색', async () => {
  const { donutUsesOptionColors, fillOf } = await import('./chart-geometry.ts')
  const d = (key: string, color: 'default' | 'gray' | 'red' | 'blue' | null) => ({ key, label: key, value: 1, text: '1', color })
  const same = [d('a', 'default'), d('b', 'default')]
  assert.equal(donutUsesOptionColors(same), false)
  assert.notEqual(fillOf(same[0], 0, true, false), fillOf(same[1], 1, true, false))
  assert.equal(donutUsesOptionColors([d('a', 'red'), d('b', 'blue')]), true)
  assert.equal(donutUsesOptionColors([d('a', 'red'), d('b', null)]), false)
  // 막대는 그대로 옵션 색
  assert.equal(fillOf(same[0], 0, false, false), fillOf(same[1], 1, false, false))
})

test('cumulativeAllowed — 도넛 · 내림차순 · 개수/합계 아닌 계산은 그리지 않는다', () => {
  assert.equal(cumulativeAllowed('column', null, undefined), true)
  assert.equal(cumulativeAllowed('line', 'count_values', 'ascending'), true)
  assert.equal(cumulativeAllowed('bar', 'count_all', null), true)
  assert.equal(cumulativeAllowed('column', 'sum', undefined), true)
  assert.equal(cumulativeAllowed('donut', null, undefined), false)
  assert.equal(cumulativeAllowed('number', null, undefined), false)
  assert.equal(cumulativeAllowed('column', null, 'descending'), false)
  assert.equal(cumulativeAllowed('column', 'average', undefined), false)
  assert.equal(cumulativeAllowed('column', 'max', undefined), false)
})

test('accumulate — 그리는 차례로 더해 간다 · 글자는 같은 서식', () => {
  const d = (key: string, value: number) => ({ key, label: key, value, text: String(value), color: null })
  const out = accumulate([d('a', 2), d('b', 0), d('c', 1500.1), d('d', 0.2)])
  assert.deepEqual(out.map((x) => x.value), [2, 2, 1502.1, 1502.3])
  assert.deepEqual(out.map((x) => x.text), ['2', '2', '1,502.1', '1,502.3'])
  assert.deepEqual(out.map((x) => x.key), ['a', 'b', 'c', 'd'])
})

test('donutLabelVisible — 10% 이상만', () => {
  assert.equal(donutLabelVisible(0.1), true)
  assert.equal(donutLabelVisible(0.0999), false)
  assert.equal(donutLabelVisible(0.5), true)
})
