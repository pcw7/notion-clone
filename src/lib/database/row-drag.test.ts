/**
 * 표 · 목록의 행 끌기 규칙 — §7 정리 10n-60 (F-04-01)
 *
 *   ① ★ 놓을 자리 — 가운데가 포인터보다 아래인 첫 행의 앞 · 없으면 맨 뒤(null) · 제자리는 undefined
 *   ② ★ 더 볼 행이 남았으면 맨 뒤에 놓지 않는다 — 놓을 자리도 줄도 없다
 *   ③ 가로 줄의 y — 놓일 행의 위 경계 · 맨 뒤면 마지막 행의 아래 경계
 *   ④ 키로 한 칸 — 끝에서는 그대로 · ↓ 의 다음이 없으면 맨 뒤(더 볼 행이 남았으면 없음)
 *   ⑤ 화면의 목록을 먼저 그 차례로 — 모르는 `before` · 자기 앞은 그대로
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { reorderRows, rowDropBefore, rowDropLineY, stepTarget, type RowBox } from './row-drag.ts'

// 가 · 나 · 다 — 높이 30 씩(가 0~30 · 나 30~60 · 다 60~90)
const ROWS: RowBox[] = [
  { id: 'ga', top: 0, height: 30 },
  { id: 'na', top: 30, height: 30 },
  { id: 'da', top: 60, height: 30 },
]

describe('표 · 목록의 행 끌기 규칙 (10n-60)', () => {
  test('★ ① 놓을 자리 — 첫 행의 앞 · 맨 뒤 · 제자리', () => {
    assert.equal(rowDropBefore(ROWS, 'da', 5, false), 'ga', '가의 가운데(15) 위 → 가의 앞')
    assert.equal(rowDropBefore(ROWS, 'ga', 80, false), null, '다의 가운데(75) 아래 → 맨 뒤')
    assert.equal(rowDropBefore(ROWS, 'na', 40, false), undefined, '나 자신의 칸 → 제자리')
    assert.equal(rowDropBefore(ROWS, 'ga', 20, false), undefined, '가를 나의 가운데 위에 → 제자리')
    assert.equal(rowDropBefore(ROWS, 'ga', 50, false), 'da', '나의 가운데(45) 아래 · 다의 가운데 위 → 다의 앞')
  })

  test('★ ② 더 볼 행이 남았으면 맨 뒤에 놓지 않는다', () => {
    assert.equal(rowDropBefore(ROWS, 'ga', 80, true), undefined)
    assert.equal(rowDropLineY(ROWS, 'ga', 80, true), null)
    assert.equal(rowDropBefore(ROWS, 'da', 5, true), 'ga', '맨 뒤가 아니면 그대로')
  })

  test('③ 가로 줄의 y', () => {
    assert.equal(rowDropLineY(ROWS, 'da', 5, false), 0)
    assert.equal(rowDropLineY(ROWS, 'ga', 50, false), 60)
    assert.equal(rowDropLineY(ROWS, 'ga', 80, false), 90, '맨 뒤 — 마지막 행(다)의 아래')
    assert.equal(rowDropLineY(ROWS, 'na', 40, false), null, '제자리')
  })

  test('④ 키로 한 칸', () => {
    const ids = ['ga', 'na', 'da']
    assert.equal(stepTarget(ids, 0, 'up', false), undefined)
    assert.equal(stepTarget(ids, 1, 'up', false), 'ga')
    assert.equal(stepTarget(ids, 0, 'down', false), 'da', '가를 나 뒤로 = 다의 앞')
    assert.equal(stepTarget(ids, 1, 'down', false), null, '나를 다 뒤로 = 맨 뒤')
    assert.equal(stepTarget(ids, 1, 'down', true), undefined, '더 볼 행이 남았으면 맨 뒤가 아니다')
    assert.equal(stepTarget(ids, 2, 'down', false), undefined)
    assert.equal(stepTarget(ids, 5, 'up', false), undefined)
  })

  test('⑤ 화면의 목록을 먼저 그 차례로', () => {
    const rows = [{ id: 'ga' }, { id: 'na' }, { id: 'da' }]
    const ids = (list: readonly { id: string }[]) => list.map((r) => r.id).join(',')
    assert.equal(ids(reorderRows(rows, 'da', 'ga')), 'da,ga,na')
    assert.equal(ids(reorderRows(rows, 'ga', null)), 'na,da,ga')
    assert.equal(ids(reorderRows(rows, 'ga', 'nope')), 'ga,na,da', '모르는 before — 그대로')
    assert.equal(ids(reorderRows(rows, 'na', 'na')), 'ga,na,da', '자기 앞 — 그대로')
    assert.equal(ids(reorderRows(rows, 'nope', null)), 'ga,na,da')
  })
})
