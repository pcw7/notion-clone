/**
 * 공개 화면의 날짜 창 — 순수 (공개 화면의 뷰 PV-2 · F-06-08)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ③
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { calendarMonth, monthCells, monthSpan, overlapsWindow, pickView, tabHref, timelineWindow, windowHref, windowQueryOf } from './public-window.ts'

const TODAY = '2026-11-09'

describe('창 값 읽기', () => {
  test('?m= — 맞으면 그 달 · 틀리면 오늘이 든 달', () => {
    assert.equal(calendarMonth('2026-03', TODAY), '2026-03')
    for (const bad of [null, undefined, '', '2026-13', '2026-3', '26-03', 'abc', '2026-03-01', '0099-01', '3000-01']) {
      assert.equal(calendarMonth(bad, TODAY), '2026-11', String(bad))
    }
  })

  test('달의 범위 — 윤년 2월 · 12월', () => {
    assert.deepEqual(monthSpan('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
    assert.deepEqual(monthSpan('2026-12'), { from: '2026-12-01', to: '2026-12-31' })
  })

  test('?from= — 맞으면 그 시작을 줌으로 편 창 · 틀리면 오늘 근처', () => {
    assert.deepEqual(timelineWindow('2026-01-01', 'day', TODAY), { from: '2026-01-01', to: '2026-02-11' })
    const dflt = timelineWindow(null, 'week', TODAY)
    assert.equal(dflt.from, '2026-10-12', '오늘 − 28일')
    assert.deepEqual(timelineWindow('2026-02-30', 'week', TODAY), dflt)
    assert.deepEqual(timelineWindow('nope', 'week', TODAY), dflt)
    assert.deepEqual(timelineWindow('0001-01-01', 'week', TODAY), dflt)
  })

  test('searchParams 에서 첫 값만', () => {
    assert.deepEqual(windowQueryOf({ m: ['2026-01', '2026-02'], from: '2026-01-01', x: 'y' }), { m: '2026-01', from: '2026-01-01', v: [] })
    assert.deepEqual(windowQueryOf({}), { m: null, from: null, v: [] })
  })

  test('?v= — 모두 읽는다 · 중복 · 빈 값 · 너무 긴 값 · 쉼표가 든 값은 버린다', () => {
    assert.deepEqual(windowQueryOf({ v: 'a' }).v, ['a'])
    assert.deepEqual(windowQueryOf({ v: ['a', 'b', 'a', '', 'x,y', 'z'.repeat(65)] }).v, ['a', 'b'])
    assert.equal(windowQueryOf({ v: Array.from({ length: 30 }, (_, i) => `v${i}`) }).v?.length, 20)
  })
})

describe('뷰 탭 (PV-4)', () => {
  test('pickView — 자기 뷰인 첫 값 · 낯선 id 는 무시 · 없으면 null', () => {
    assert.equal(pickView(['x', 'b', 'a'], ['a', 'b']), 'b')
    assert.equal(pickView(['x'], ['a', 'b']), null)
    assert.equal(pickView([], ['a']), null)
    assert.equal(pickView(undefined, ['a']), null)
  })

  test('windowHref — 고른 뷰(v)를 두고 창 값 하나만', () => {
    assert.equal(windowHref('/p/t', {}, 'm', '2026-04'), '/p/t?m=2026-04')
    assert.equal(windowHref('/p/t/pg', { m: '2026-03', v: ['a', 'b'] }, 'from', '2026-05-01'), '/p/t/pg?v=a&v=b&from=2026-05-01')
  })

  test('tabHref —이 데이터베이스의 v 만 바꾼다 · 다른 데이터베이스의 v 는 둔다 · m · from 은 뺀다', () => {
    const own = ['a1', 'a2']
    assert.equal(tabHref('/p/t', {}, own, 'a2'), '/p/t?v=a2')
    assert.equal(tabHref('/p/t/pg', { m: '2026-03', from: '2026-01-01', v: ['a1'] }, own, 'a2'), '/p/t/pg?v=a2', 'm · from 이 빠지고 자기 v 는 바뀐다')
    assert.equal(tabHref('/p/t', { v: ['b1', 'a1', 'c1'] }, own, 'a2'), '/p/t?v=b1&v=c1&v=a2', '다른 데이터베이스의 v 는 그대로')
    assert.equal(tabHref('/s/d/s', { v: ['a1', 'a2'] }, own, 'a1'), '/s/d/s?v=a1', '자기 v 가 겹쳐 있어도 하나로')
  })
})

describe('칸에 놓기', () => {
  const events = [
    { id: 'multi', start: '2026-03-10', end: '2026-03-12' },
    { id: 'one', start: '2026-03-11', end: '2026-03-11' },
    { id: 'edge', start: '2026-02-27', end: '2026-03-02' },
    { id: 'outside', start: '2026-05-01', end: '2026-05-02' },
  ]

  test('여러 날 일정은 걸친 날마다 든다 · 창 밖 일정은 어느 칸에도 없다', () => {
    const cells = monthCells('2026-03', 'sunday', true, events).flat()
    const on = (d: string) => cells.find((c) => c.date === d)!.ids
    assert.deepEqual(on('2026-03-10'), ['multi'])
    assert.deepEqual(on('2026-03-11'), ['multi', 'one'])
    assert.deepEqual(on('2026-03-12'), ['multi'])
    assert.deepEqual(on('2026-03-13'), [])
    assert.ok(!cells.some((c) => c.ids.includes('outside')))
  })

  test('그 달 밖의 날(격자 가장자리)은 일정을 싣지 않는다', () => {
    const cells = monthCells('2026-03', 'sunday', true, events).flat()
    const feb27 = cells.find((c) => c.date === '2026-02-27')
    assert.ok(feb27 === undefined || (feb27.inMonth === false && feb27.ids.length === 0))
    assert.deepEqual(cells.find((c) => c.date === '2026-03-01')!.ids, ['edge'])
  })

  test('6주 · 월요일 시작 · 주말 숨김', () => {
    const full = monthCells('2026-03', 'sunday', true, [])
    assert.equal(full.length, 6)
    assert.ok(full.every((w) => w.length === 7))
    assert.equal(full[0]![0]!.date, '2026-03-01', '2026-03-01 은 일요일')
    assert.equal(monthCells('2026-03', 'monday', true, [])[0]![0]!.date, '2026-02-23')
    const weekdays = monthCells('2026-03', 'monday', false, [])
    assert.ok(weekdays.every((w) => w.length === 5))
  })

  test('창과 겹침 — 양끝 포함', () => {
    const win = { from: '2026-03-01', to: '2026-03-31' }
    assert.equal(overlapsWindow('2026-02-20', '2026-03-01', win), true)
    assert.equal(overlapsWindow('2026-03-31', '2026-04-05', win), true)
    assert.equal(overlapsWindow('2026-02-20', '2026-02-28', win), false)
    assert.equal(overlapsWindow('2026-04-01', '2026-04-01', win), false)
  })
})
