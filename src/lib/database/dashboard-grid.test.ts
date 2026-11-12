/**
 * 대시보드의 격자 — 줄 · 높이 · 칸의 차례 · 동시에 읽는 위젯 수 (DB-2 · 순수)
 *
 *   ① 배치의 차례 · 높이(px) — 위젯 목록에 없는 칸은 빼고 빈 줄은 없앤다
 *   ② 배치에 없는 위젯은 끝에 4개씩 보통 높이로(숨기지 않는다)
 *   ③ 묶기: 동시에 `limit` 개 · 먼저 기다린 것부터 · release 는 한 번만
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createGate, dashboardGrid, widgetBodyPx, WIDGET_CHROME_PX, type DashboardGridRow } from './dashboard-grid.ts'
import type { DashboardLayout } from './dashboard-layout.ts'

const w = (id: string) => ({ id })
const ids = (rows: readonly DashboardGridRow<{ id: string }>[]) => rows.map((r) => [r.heightPx, r.cells.map((c) => c.id).join()])

test('① 배치의 차례 · 높이 — 없는 위젯의 칸은 빼고 빈 줄은 없앤다', () => {
  const layout: DashboardLayout = {
    rows: [
      { height: 'large', cells: [{ view_id: 'b' }, { view_id: 'a' }] },
      { height: 'small', cells: [{ view_id: 'gone' }] },
      { height: 'medium', cells: [{ view_id: 'c' }, { view_id: 'gone2' }] },
    ],
  }
  const rows = dashboardGrid(layout, [w('a'), w('b'), w('c')])
  assert.deepEqual(ids(rows), [[640, 'b,a'], [480, 'c']])
  assert.deepEqual(rows.map((r) => r.height), ['large', 'medium'])
  assert.deepEqual(dashboardGrid({ rows: [] }, []), [], '빈 대시보드')
  // 칸에 맞춰 그리는 몸의 높이 — 줄 높이에서 틀을 뺀다
  assert.equal(widgetBodyPx(320), 320 - WIDGET_CHROME_PX)
  assert.equal(widgetBodyPx(640), 640 - WIDGET_CHROME_PX)
  assert.equal(widgetBodyPx(100), 120, '너무 작아지지 않는다')
})

test('② 배치에 없는 위젯 — 끝에 4개씩 보통 높이로', () => {
  const layout: DashboardLayout = { rows: [{ height: 'small', cells: [{ view_id: 'a' }] }] }
  const rows = dashboardGrid(layout, ['a', 'b', 'c', 'd', 'e', 'f'].map(w))
  assert.deepEqual(ids(rows), [[320, 'a'], [480, 'b,c,d,e'], [480, 'f']])
  // 저장된 배치가 깨져 빈 배치로 읽혀도 위젯은 선다
  assert.deepEqual(ids(dashboardGrid({ rows: [] }, [w('x'), w('y')])), [[480, 'x,y']])
})

test('③ 묶기 — 동시에 limit 개 · 먼저 기다린 것부터 · release 는 한 번만', async () => {
  const gate = createGate(2)
  const order: string[] = []
  let running = 0
  let peak = 0
  const job = async (name: string, ms: number) => {
    const release = await gate.acquire()
    running += 1
    peak = Math.max(peak, running)
    order.push(name)
    await new Promise((r) => setTimeout(r, ms))
    running -= 1
    release()
    release()
  }
  await Promise.all([job('1', 20), job('2', 5), job('3', 5), job('4', 5), job('5', 5)])
  assert.equal(peak, 2, '두 번 불러도 자리는 하나만 돌려준다')
  assert.deepEqual(order, ['1', '2', '3', '4', '5'], '들어간 차례 = 기다린 차례')

  const one = createGate(0)
  const first = await one.acquire()
  let second = false
  const pending = one.acquire().then((release) => { second = true; release() })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(second, false, '0 은 1 로 — 앞의 것이 끝나야 들어간다')
  first()
  await pending
  assert.equal(second, true)
})
