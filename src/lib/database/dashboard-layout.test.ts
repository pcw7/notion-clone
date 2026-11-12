/**
 * 대시보드 배치 — 모양 검사 · 칸 빼기 · 위젯 넣을 자리 (DB-1 · 순수)
 *
 *   ① 모양: 줄 3 · 줄마다 칸 4 · 모두 12 · height 셋 · 같은 id 한 번 · 모르는 키 거부 — 0143 의 CHECK 과 같은 규칙
 *   ② 칸 빼기: 줄을 당기고 빈 줄은 없앤다
 *   ③ 넣을 자리: 준 줄 → 새 줄 → (줄이 다 찼으면) 자리 있는 마지막 줄 → 없으면 null
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_DASHBOARD_LAYOUT,
  isWidgetViewType,
  keepCells,
  layoutViewIds,
  placeWidget,
  readLayout,
  removeCell,
  validateLayout,
  type DashboardLayout,
} from './dashboard-layout.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (height: 'small' | 'medium' | 'large', ...ns: number[]) => ({ height, cells: ns.map((n) => ({ view_id: id(n) })) })

describe('① 모양 검사', () => {
  test('빈 배치 · 가득 찬 배치(3줄 × 4칸)는 통과', () => {
    assert.equal(validateLayout({ rows: [] }).ok, true)
    const full = { rows: [row('small', 1, 2, 3, 4), row('medium', 5, 6, 7, 8), row('large', 9, 10, 11, 12)] }
    const checked = validateLayout(full)
    assert.equal(checked.ok, true)
    if (checked.ok) assert.equal(layoutViewIds(checked.layout).length, 12)
  })

  test('★ 줄은 3개까지 · 칸은 줄마다 4개까지 · 빈 줄은 거부', () => {
    assert.equal(validateLayout({ rows: [row('small', 1), row('small', 2), row('small', 3), row('small', 4)] }).ok, false)
    assert.equal(validateLayout({ rows: [row('small', 1, 2, 3, 4, 5)] }).ok, false)
    assert.equal(validateLayout({ rows: [{ height: 'small', cells: [] }] }).ok, false)
  })

  test('★ height 는 small · medium · large — 그 밖 · 빠짐 거부', () => {
    assert.equal(validateLayout({ rows: [{ height: 'huge', cells: [{ view_id: id(1) }] }] }).ok, false)
    assert.equal(validateLayout({ rows: [{ cells: [{ view_id: id(1) }] }] }).ok, false)
  })

  test('★ 같은 위젯이 두 번 — 줄이 달라도 거부 · issues 가 자리를 말한다', () => {
    const r = validateLayout({ rows: [row('small', 1), row('small', 1)] })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.issues.some((i) => i.path === 'layout.rows[1].cells[0].view_id'))
  })

  test('모르는 키 · 모양이 아닌 값 · uuid 가 아닌 id 거부', () => {
    assert.equal(validateLayout({ rows: [], extra: 1 }).ok, false)
    assert.equal(validateLayout({ rows: [{ height: 'small', cells: [{ view_id: id(1) }], gap: 1 }] }).ok, false)
    assert.equal(validateLayout({ rows: [{ height: 'small', cells: [{ view_id: id(1), w: 2 }] }] }).ok, false)
    assert.equal(validateLayout({ rows: [{ height: 'small', cells: [{ view_id: 'abc' }] }] }).ok, false)
    assert.equal(validateLayout(null).ok, false)
    assert.equal(validateLayout([]).ok, false)
    assert.equal(validateLayout({ rows: 'x' }).ok, false)
  })

  test('읽기는 거부하지 않는다 — 틀린 저장값은 빈 배치', () => {
    assert.deepEqual(readLayout({ rows: [row('small', 1, 2, 3, 4, 5)] }), EMPTY_DASHBOARD_LAYOUT)
    assert.deepEqual(readLayout(null), EMPTY_DASHBOARD_LAYOUT)
  })

  test('위젯이 될 수 있는 타입은 여덟 — 폼 · 대시보드는 안 된다(중첩 금지)', () => {
    for (const t of ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart', 'map']) assert.equal(isWidgetViewType(t), true, t)
    assert.equal(isWidgetViewType('form'), false)
    assert.equal(isWidgetViewType('dashboard'), false)
    assert.equal(isWidgetViewType(3), false)
  })
})

describe('② 칸 빼기 · 줄 당기기', () => {
  const layout: DashboardLayout = { rows: [row('small', 1, 2), row('medium', 3), row('large', 4, 5)] }

  test('★ 줄의 칸을 빼면 그 줄이 당겨진다', () => {
    assert.deepEqual(removeCell(layout, id(1)).rows[0], row('small', 2))
  })

  test('★ 줄의 마지막 칸을 빼면 그 줄이 없어진다 — 다른 줄의 높이는 그대로', () => {
    const next = removeCell(layout, id(3))
    assert.deepEqual(next.rows, [row('small', 1, 2), row('large', 4, 5)])
  })

  test('없는 id 를 빼도 그대로', () => {
    assert.deepEqual(removeCell(layout, id(99)), layout)
  })

  test('keepCells — 사라진 위젯의 칸을 한꺼번에 걸러 낸다', () => {
    assert.deepEqual(keepCells(layout, (v) => v === id(2) || v === id(5)).rows, [row('small', 2), row('large', 5)])
  })
})

describe('③ 위젯 넣을 자리', () => {
  test('빈 배치에 넣으면 새 줄(medium)', () => {
    assert.deepEqual(placeWidget(EMPTY_DASHBOARD_LAYOUT, id(1))?.rows, [row('medium', 1)])
  })

  test('★ row 를 주면 그 줄 끝에(자리가 있으면)', () => {
    const base: DashboardLayout = { rows: [row('small', 1), row('large', 2)] }
    assert.deepEqual(placeWidget(base, id(3), 0)?.rows, [row('small', 1, 3), row('large', 2)])
  })

  test('★ 준 줄이 가득이면 새 줄 · 없는 줄 번호도 새 줄', () => {
    const base: DashboardLayout = { rows: [row('small', 1, 2, 3, 4)] }
    assert.deepEqual(placeWidget(base, id(5), 0)?.rows, [row('small', 1, 2, 3, 4), row('medium', 5)])
    assert.deepEqual(placeWidget({ rows: [row('small', 1)] }, id(2), 7)?.rows, [row('small', 1), row('medium', 2)])
  })

  test('★ 줄을 안 주면 새 줄 · 줄이 다 찼으면 자리 있는 마지막 줄', () => {
    const three: DashboardLayout = { rows: [row('small', 1, 2), row('small', 3, 4, 5, 6), row('small', 7, 8)] }
    assert.deepEqual(placeWidget(three, id(9))?.rows[2], row('small', 7, 8, 9))
    assert.equal(placeWidget({ rows: [row('small', 1)] }, id(2))?.rows.length, 2)
  })

  test('★ 준 줄이 가득이고 3줄도 다 찼으면 null(full) — 12개를 채워도 null', () => {
    const three: DashboardLayout = { rows: [row('small', 1, 2, 3, 4), row('small', 5, 6), row('small', 7)] }
    assert.equal(placeWidget(three, id(9), 0), null)
    const twelve: DashboardLayout = { rows: [row('small', 1, 2, 3, 4), row('small', 5, 6, 7, 8), row('small', 9, 10, 11, 12)] }
    assert.equal(placeWidget(twelve, id(13)), null)
    assert.equal(placeWidget(twelve, id(13), 1), null)
  })
})
