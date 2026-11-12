/**
 * 대시보드 편집의 규칙 — 옮기기 · 줄 자리 · 줄 높이 · 끌기의 놓을 자리 (DB-3 · 순수)
 *
 *   ① 왼쪽 · 오른쪽은 한 칸 · 끝에서는 null
 *   ② 위 줄 · 아래 줄은 같은 자리 근처에 · 가득 찬 줄로는 null · 맨 위 · 맨 아래에서는 새 줄(혼자면 제자리라 null · 줄 3개면 null)
 *   ③ 놓기 — 비게 된 줄은 없앤다 · 새 줄은 옮긴 위젯의 높이 · 제자리는 null · 결과는 늘 모양 검사(`validateLayout`)를 지난다
 *   ④ 줄 높이 · 자리(4개 미만) · 넣을 수 있는가(12개 미만)
 *   ⑤ 끌기 — 칸은 가운데를 넘은 수 · 줄의 세로 범위 · 위 · 아래 · 틈은 새 줄 · 줄 그리기
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  canAddWidget,
  dropIndex,
  dropLine,
  dropTarget,
  dropWidget,
  layoutOfGrid,
  moveWidget,
  rowHasRoom,
  setRowHeight,
  type RowBox,
} from './dashboard-edit.ts'
import { validateLayout, type DashboardHeight, type DashboardLayout } from './dashboard-layout.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (height: DashboardHeight, ...ns: number[]) => ({ height, cells: ns.map((n) => ({ view_id: id(n) })) })
const layout = (...rows: ReturnType<typeof row>[]): DashboardLayout => ({ rows })
/** 배치를 `[[높이, 1, 2], ...]` 꼴로 — 비교가 읽히게. */
const shape = (l: DashboardLayout | null) => (l === null ? null : l.rows.map((r) => [r.height, ...r.cells.map((c) => Number(c.view_id.slice(-12)))]))
const valid = (l: DashboardLayout | null) => l !== null && validateLayout(l).ok

describe('대시보드 편집 — 메뉴의 옮기기 (DB-3)', () => {
  const base = layout(row('large', 1, 2, 3), row('small', 4))

  test('① 왼쪽 · 오른쪽은 한 칸 · 끝에서는 null', () => {
    assert.deepEqual(shape(moveWidget(base, id(2), 'left')), [['large', 2, 1, 3], ['small', 4]])
    assert.deepEqual(shape(moveWidget(base, id(2), 'right')), [['large', 1, 3, 2], ['small', 4]])
    assert.equal(moveWidget(base, id(1), 'left'), null, '맨 왼쪽')
    assert.equal(moveWidget(base, id(3), 'right'), null, '맨 오른쪽')
    assert.equal(moveWidget(base, id(4), 'left'), null, '혼자인 줄')
    assert.equal(moveWidget(base, id(99), 'left'), null, '없는 위젯')
  })

  test('② 아래 줄 · 위 줄 — 같은 자리 근처에(그 줄의 칸 수로 줄인다) · 비게 된 줄은 없앤다', () => {
    assert.deepEqual(shape(moveWidget(base, id(3), 'down')), [['large', 1, 2], ['small', 4, 3]], '셋째 칸 → 칸이 하나뿐인 줄의 끝')
    assert.deepEqual(shape(moveWidget(base, id(1), 'down')), [['large', 2, 3], ['small', 1, 4]], '첫째 칸 → 첫째 칸')
    assert.deepEqual(shape(moveWidget(base, id(4), 'up')), [['large', 4, 1, 2, 3]], '같은 자리(0) · 혼자 있던 줄은 없어진다')
  })

  test('② 가득 찬 줄로는 null', () => {
    const full = layout(row('medium', 1, 2, 3, 4), row('medium', 5))
    assert.equal(moveWidget(full, id(5), 'up'), null)
  })

  test('② 맨 위 · 맨 아래에서는 새 줄 — 옮긴 위젯의 높이 · 혼자면 제자리라 null · 줄 3개면 null', () => {
    assert.deepEqual(shape(moveWidget(base, id(2), 'up')), [['large', 2], ['large', 1, 3], ['small', 4]])
    assert.deepEqual(shape(moveWidget(base, id(1), 'down')), [['large', 2, 3], ['small', 1, 4]], '아래 줄이 있으면 그 줄로')
    assert.equal(moveWidget(base, id(4), 'down'), null, '혼자인 마지막 줄의 아래 새 줄 — 제자리')
    const three = layout(row('medium', 1, 2), row('medium', 3), row('small', 4, 5))
    assert.equal(moveWidget(three, id(1), 'up'), null, '줄이 이미 셋')
    assert.equal(moveWidget(three, id(5), 'down'), null, '줄이 이미 셋')
    assert.deepEqual(shape(moveWidget(three, id(3), 'up')), [['medium', 3, 1, 2], ['small', 4, 5]], '둘째 줄의 혼자 → 위 줄의 같은 자리(0) · 빈 줄은 없어진다')
  })
})

describe('대시보드 편집 — 놓기 (DB-3)', () => {
  const base = layout(row('large', 1, 2, 3), row('small', 4))

  test('③ 같은 줄 — 나머지에서 센 자리 · 제자리는 null', () => {
    assert.deepEqual(shape(dropWidget(base, id(1), { row: 0, index: 2 })), [['large', 2, 3, 1], ['small', 4]])
    assert.deepEqual(shape(dropWidget(base, id(3), { row: 0, index: 0 })), [['large', 3, 1, 2], ['small', 4]])
    assert.equal(dropWidget(base, id(2), { row: 0, index: 1 }), null, '제자리')
    assert.deepEqual(shape(dropWidget(base, id(1), { row: 0, index: 99 })), [['large', 2, 3, 1], ['small', 4]], '넘는 자리는 끝')
  })

  test('③ 다른 줄 — 그 줄의 높이 · 자리가 없으면 null · 비게 된 줄은 없앤다', () => {
    assert.deepEqual(shape(dropWidget(base, id(4), { row: 0, index: 1 })), [['large', 1, 4, 2, 3]])
    assert.deepEqual(shape(dropWidget(base, id(2), { row: 1, index: 0 })), [['large', 1, 3], ['small', 2, 4]])
    const full = layout(row('medium', 1, 2, 3, 4), row('small', 5))
    assert.equal(dropWidget(full, id(5), { row: 0, index: 0 }), null)
    assert.equal(dropWidget(base, id(1), { row: 7, index: 0 }), null, '없는 줄')
  })

  test('③ 새 줄 — 그 자리에 끼운다 · 옮긴 위젯의 높이 · 혼자 있던 줄의 바로 위 · 아래는 제자리 · 줄 셋을 넘지 않는다', () => {
    assert.deepEqual(shape(dropWidget(base, id(2), { newRow: 1 })), [['large', 1, 3], ['large', 2], ['small', 4]])
    assert.deepEqual(shape(dropWidget(base, id(4), { newRow: 0 })), [['small', 4], ['large', 1, 2, 3]], '혼자 있던 줄은 없어지고 맨 위에')
    assert.equal(dropWidget(base, id(4), { newRow: 1 }), null, '제자리(위)')
    assert.equal(dropWidget(base, id(4), { newRow: 2 }), null, '제자리(아래)')
    const three = layout(row('medium', 1, 2), row('medium', 3), row('small', 4))
    assert.equal(dropWidget(three, id(1), { newRow: 3 }), null, '줄이 넷이 된다')
    assert.deepEqual(shape(dropWidget(three, id(3), { newRow: 3 })), [['medium', 1, 2], ['small', 4], ['medium', 3]], '혼자 있던 줄이 없어지므로 셋 그대로')
    assert.equal(dropWidget(base, id(1), { newRow: 9 }), null, '없는 자리')
  })

  test('③ 결과는 늘 모양 검사를 지난다(같은 위젯 전부 · 줄 1~4칸)', () => {
    const l = layout(row('large', 1, 2, 3, 4), row('medium', 5, 6), row('small', 7))
    const ids = [1, 2, 3, 4, 5, 6, 7]
    for (const n of ids) {
      for (const target of [{ newRow: 0 }, { newRow: 3 }, { row: 0, index: 0 }, { row: 1, index: 1 }, { row: 2, index: 5 }]) {
        const out = dropWidget(l, id(n), target)
        if (out === null) continue
        assert.ok(valid(out), JSON.stringify([n, target, shape(out)]))
        assert.deepEqual(out.rows.flatMap((r) => r.cells.map((c) => c.view_id)).sort(), ids.map(id).sort())
      }
    }
  })
})

describe('대시보드 편집 — 줄 높이 · 자리 (DB-3)', () => {
  test('④ 줄 높이 — 그 줄만 · 같은 높이 · 없는 줄은 null', () => {
    const l = layout(row('large', 1), row('small', 2))
    assert.deepEqual(shape(setRowHeight(l, 1, 'medium')), [['large', 1], ['medium', 2]])
    assert.equal(setRowHeight(l, 0, 'large'), null)
    assert.equal(setRowHeight(l, 5, 'large'), null)
  })

  test('④ 자리(4개 미만) · 넣을 수 있는가(12개 미만)', () => {
    const l = layout(row('medium', 1, 2, 3, 4), row('medium', 5))
    assert.equal(rowHasRoom(l, 0), false)
    assert.equal(rowHasRoom(l, 1), true)
    assert.equal(rowHasRoom(l, 2), false, '없는 줄')
    assert.equal(canAddWidget(l), true)
    const twelve = layout(row('medium', 1, 2, 3, 4), row('medium', 5, 6, 7, 8), row('medium', 9, 10, 11, 12))
    assert.equal(canAddWidget(twelve), false)
  })

  test('그리는 줄 → 배치 — 차례 · 높이 그대로', () => {
    const grid = [
      { height: 'large' as const, cells: [{ id: id(1) }, { id: id(2) }] },
      { height: 'small' as const, cells: [{ id: id(3) }] },
    ]
    assert.deepEqual(shape(layoutOfGrid(grid)), [['large', 1, 2], ['small', 3]])
  })
})

describe('대시보드 편집 — 끌기의 놓을 자리 (DB-3)', () => {
  // 줄 둘 — 0~100 에 칸 셋(폭 100 · 사이 16) · 116~216 에 칸 하나
  const rows: RowBox[] = [
    { top: 0, bottom: 100, cells: [{ id: 'a', left: 0, width: 100 }, { id: 'b', left: 116, width: 100 }, { id: 'c', left: 232, width: 100 }] },
    { top: 116, bottom: 216, cells: [{ id: 'd', left: 0, width: 100 }] },
  ]

  test('⑤ 칸 — 끌고 있는 위젯을 뺀 나머지에서 가운데를 넘은 수', () => {
    assert.equal(dropIndex(rows[0]!.cells, 'c', 10), 0)
    assert.equal(dropIndex(rows[0]!.cells, 'c', 170), 2, '나의 가운데(166)를 넘었다')
    assert.equal(dropIndex(rows[0]!.cells, 'a', 170), 1, '끌고 있는 가는 세지 않는다')
    assert.equal(dropIndex(rows[0]!.cells, 'a', 999), 2)
  })

  test('⑤ 줄 — 세로 범위 안은 그 줄 · 위 · 아래 · 틈은 새 줄', () => {
    assert.deepEqual(dropTarget(rows, 'd', 60, 50), { row: 0, index: 1 })
    assert.deepEqual(dropTarget(rows, 'a', 60, 150), { row: 1, index: 1 })
    assert.deepEqual(dropTarget(rows, 'a', 60, -20), { newRow: 0 })
    assert.deepEqual(dropTarget(rows, 'a', 60, 108), { newRow: 1 }, '두 줄 사이의 틈')
    assert.deepEqual(dropTarget(rows, 'a', 60, 400), { newRow: 2 })
    assert.equal(dropTarget([], 'a', 0, 0), null)
  })

  test('⑤ 줄 그리기 — 놓일 칸의 왼쪽 · 끝이면 마지막 칸의 오른쪽 · 새 줄은 가로 줄', () => {
    assert.deepEqual(dropLine(rows, 'd', { row: 0, index: 1 }), { kind: 'vertical', x: 116, top: 0, bottom: 100 })
    assert.deepEqual(dropLine(rows, 'd', { row: 0, index: 3 }), { kind: 'vertical', x: 332, top: 0, bottom: 100 })
    assert.deepEqual(dropLine(rows, 'a', { row: 0, index: 2 }), { kind: 'vertical', x: 332, top: 0, bottom: 100 }, '가를 뺀 나머지의 끝')
    assert.deepEqual(dropLine(rows, 'a', { newRow: 0 }), { kind: 'horizontal', y: -8 })
    assert.deepEqual(dropLine(rows, 'a', { newRow: 1 }), { kind: 'horizontal', y: 108 })
    assert.deepEqual(dropLine(rows, 'a', { newRow: 2 }), { kind: 'horizontal', y: 224 })
  })
})
