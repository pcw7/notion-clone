/**
 * 뷰 탭 끌기의 규칙 — §7 정리 10n-19 (F-04-01, DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 놓을 자리는 가운데를 넘은 탭의 다음 — 끌고 있는 탭을 뺀 나머지에서 가운데가 포인터보다 오른쪽인 첫 탭의 앞 · 없으면 맨 뒤(null)
 *   ② **제자리는 undefined** — 원래 칸 안에서 놓으면 보내지 않는다
 *   ③ 끌고 있는 탭은 후보가 아니다 — 자기 앞에 놓으라는 요청이 생기지 않는다
 *   ④ 줄의 x — 놓일 자리의 왼쪽 경계 · 맨 뒤면 마지막 탭의 오른쪽 · 제자리면 null
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { tabDropBefore, tabDropLineX, type TabBox } from './tab-drag.ts'

// 폭 100 의 탭 셋 — 가(0~100) · 나(100~200) · 다(200~300). 가운데는 50 · 150 · 250
const tabs: TabBox[] = [
  { id: 'a', left: 0, width: 100 },
  { id: 'b', left: 100, width: 100 },
  { id: 'c', left: 200, width: 100 },
]

describe('탭 끌기의 놓을 자리 (10n-19)', () => {
  test('① 가운데를 넘은 탭의 다음 · 없으면 맨 뒤', () => {
    assert.equal(tabDropBefore(tabs, 'c', 10), 'a', '다를 맨 앞으로')
    assert.equal(tabDropBefore(tabs, 'c', 120), 'b', '다를 가와 나 사이로(나의 가운데 150 전)')
    assert.equal(tabDropBefore(tabs, 'a', 160), 'c', '가를 나 뒤로(나의 가운데를 넘었다)')
    assert.equal(tabDropBefore(tabs, 'a', 290), null, '가를 맨 뒤로')
    assert.equal(tabDropBefore(tabs, 'a', 999), null, '오른쪽 밖도 맨 뒤')
    assert.equal(tabDropBefore(tabs, 'c', -50), 'a', '왼쪽 밖은 맨 앞')
  })

  test('② 제자리는 undefined', () => {
    assert.equal(tabDropBefore(tabs, 'b', 140), undefined, '나를 자기 칸 안에서')
    assert.equal(tabDropBefore(tabs, 'b', 60), undefined, '가의 가운데를 넘지 않았다 — 그대로 둘째')
    assert.equal(tabDropBefore(tabs, 'a', 20), undefined)
    assert.equal(tabDropBefore(tabs, 'c', 280), undefined)
    assert.equal(tabDropBefore(tabs, 'x', 10), undefined, '없는 탭')
  })

  test('③ 끌고 있는 탭은 후보가 아니다', () => {
    // 나(100~200)를 끌며 자기 가운데(150)를 넘은 160 — 자기 앞이 아니라 다의 앞(그대로 둘째 = 제자리)
    assert.equal(tabDropBefore(tabs, 'b', 160), undefined)
    assert.equal(tabDropBefore(tabs, 'b', 260), null, '다의 가운데를 넘으면 맨 뒤')
    assert.equal(tabDropBefore(tabs, 'b', 40), 'a', '가의 가운데 전이면 맨 앞')
  })

  test('④ 줄의 x', () => {
    assert.equal(tabDropLineX(tabs, 'c', 10), 0, '가의 왼쪽')
    assert.equal(tabDropLineX(tabs, 'a', 290), 300, '맨 뒤면 다의 오른쪽')
    assert.equal(tabDropLineX(tabs, 'b', 140), null, '제자리면 그리지 않는다')
  })
})
