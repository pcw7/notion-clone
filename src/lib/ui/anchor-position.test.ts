/**
 * 기준점에 붙는 층의 자리 — 플랫폼 잔여 10j-3a (F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑥)
 *
 *   ① 아래에 — 기준점의 아래 + 틈 · 정렬 시작은 기준점의 왼쪽 · 끝은 오른쪽 끝에 맞춘다
 *   ② ★ 화면 안으로 — 오른쪽 · 왼쪽으로 넘치면 민다 · 화면보다 넓으면 왼쪽 여백에
 *   ③ ★ 아래 자리가 모자라고 위가 더 넓으면 위로 — 위로 뒤집으면 층의 아래가 기준점의 위 - 틈
 *   ④ 고른 쪽이 모자라면 최대 높이로 — 아래가 더 넓으면(모자라도) 아래에 둔다
 *   ⑤ 선호하는 쪽(10j-3b) — 위를 선호하면 들어가거나 더 넓을 때 위 · 아니면 아래
 *   ⑥ ★ 정해 둔 쪽(10j-3b) — 주면 자리가 모자라도 그쪽(내용이 자라 뒤집혀 튀지 않게)
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { placeLayer } from './anchor-position.ts'

const VIEW = { width: 400, height: 800 }
const OPT = { align: 'start' as const, gap: 4, margin: 8 }
const cell = { left: 100, top: 100, right: 200, bottom: 130 }

test('① 아래에 — 정렬 시작 · 끝', () => {
  assert.deepEqual(placeLayer(cell, { width: 150, height: 200 }, VIEW, OPT), { top: 134, left: 100, side: 'below', maxHeight: 800 - 130 - 4 - 8 })
  assert.equal(placeLayer(cell, { width: 150, height: 200 }, VIEW, { ...OPT, align: 'end' }).left, 50, '끝 — 층의 오른쪽 끝이 기준점의 오른쪽 끝')
})

test('② ★ 화면 안으로 — 넘치면 민다 · 화면보다 넓으면 왼쪽 여백', () => {
  const right = { left: 300, top: 100, right: 390, bottom: 130 }
  assert.equal(placeLayer(right, { width: 256, height: 100 }, VIEW, OPT).left, 400 - 8 - 256, '오른쪽으로 넘치면 왼쪽으로 민다')
  const leftEdge = { left: 0, top: 100, right: 60, bottom: 130 }
  assert.equal(placeLayer(leftEdge, { width: 256, height: 100 }, VIEW, { ...OPT, align: 'end' }).left, 8, '왼쪽으로 넘치면 여백까지')
  assert.equal(placeLayer(cell, { width: 500, height: 100 }, VIEW, OPT).left, 8, '화면보다 넓으면 왼쪽 여백에')
})

test('③ ★ 아래가 모자라고 위가 더 넓으면 위로', () => {
  const low = { left: 100, top: 700, right: 200, bottom: 730 }
  const placed = placeLayer(low, { width: 150, height: 300 }, VIEW, OPT)
  assert.equal(placed.side, 'above')
  assert.equal(placed.top, 700 - 4 - 300, '층의 아래가 기준점의 위 - 틈')
  assert.equal(placed.maxHeight, 700 - 4 - 8)
  assert.equal(placeLayer(low, { width: 150, height: 50 }, VIEW, OPT).side, 'below', '아래에 들어가면 아래')
})

test('④ 고른 쪽이 모자라면 최대 높이 — 아래가 더 넓으면 아래', () => {
  const mid = { left: 100, top: 380, right: 200, bottom: 410 }
  const placed = placeLayer(mid, { width: 150, height: 600 }, VIEW, OPT)
  assert.equal(placed.side, 'below', '아래(378)가 위(368)보다 넓다')
  assert.equal(placed.maxHeight, 800 - 410 - 4 - 8)
  const highish = { left: 100, top: 420, right: 200, bottom: 450 }
  const up = placeLayer(highish, { width: 150, height: 600 }, VIEW, OPT)
  assert.equal(up.side, 'above', '위(408)가 아래(338)보다 넓다')
  assert.equal(up.top, 420 - 4 - 408, '모자라면 최대 높이만큼 위로')
})

test('⑤ 선호하는 쪽 — 위를 선호하면 들어가거나 더 넓을 때 위 · 아니면 아래', () => {
  const up = { ...OPT, prefer: 'above' as const }
  const mid = { left: 100, top: 400, right: 200, bottom: 430 }
  const placed = placeLayer(mid, { width: 150, height: 200 }, VIEW, up)
  assert.equal(placed.side, 'above')
  assert.equal(placed.top, 400 - 4 - 200, '층의 아래가 기준점의 위 - 틈')
  const top = { left: 100, top: 60, right: 200, bottom: 90 }
  assert.equal(placeLayer(top, { width: 150, height: 200 }, VIEW, up).side, 'below', '위가 모자라고 아래가 더 넓으면 아래')
  assert.equal(placeLayer(mid, { width: 150, height: 200 }, VIEW, OPT).side, 'below', '기본은 아래')
})

test('⑥ ★ 정해 둔 쪽 — 주면 자리가 모자라도 그쪽', () => {
  const low = { left: 100, top: 700, right: 200, bottom: 730 }
  const grown = placeLayer(low, { width: 150, height: 300 }, VIEW, { ...OPT, side: 'below' })
  assert.equal(grown.side, 'below', '처음에 아래로 정했으면 커져도 아래')
  assert.equal(grown.top, 734)
  assert.equal(grown.maxHeight, 800 - 730 - 4 - 8, '모자란 만큼은 최대 높이가 잘라 층 안에서 스크롤한다')
  assert.equal(placeLayer(low, { width: 150, height: 300 }, VIEW, OPT).side, 'above', '정하지 않았으면 뒤집는다')
})
