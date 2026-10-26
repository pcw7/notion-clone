/**
 * 소프트 키보드 — 캐럿을 보이게 굴릴 양 (플랫폼 잔여 10j-4 · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑪)
 *
 *   ① 보이는 영역 안(여백 포함)이면 0
 *   ② ★ 키보드에 가렸다(아래로 벗어났다) — 그만큼 아래로 · 여백 16px 을 남긴다
 *   ③ 위로 벗어났다(보이는 영역이 아래로 밀렸다) — 음수
 *   ④ 영역이 캐럿 한 줄보다 좁다 — 0(맞출 수 없다)
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { KEYBOARD_CARET_MARGIN, caretScrollDelta } from './keyboard-caret.ts'

const view = { top: 0, bottom: 350 }

test('① 보이는 영역 안이면 굴리지 않는다 — 여백의 끝에 닿아도', () => {
  assert.equal(caretScrollDelta({ top: 100, bottom: 120 }, view), 0)
  assert.equal(caretScrollDelta({ top: 16, bottom: 36 }, view), 0)
  assert.equal(caretScrollDelta({ top: 314, bottom: 334 }, view), 0)
})

test('② ★ 키보드에 가렸다 — 그만큼 아래로, 여백 16px 을 남긴다', () => {
  assert.equal(KEYBOARD_CARET_MARGIN, 16)
  assert.equal(caretScrollDelta({ top: 600, bottom: 624 }, view), 624 - (350 - 16))
  assert.equal(caretScrollDelta({ top: 330, bottom: 335 }, view), 1)
})

test('③ 위로 벗어났다 — 음수(위로 굴린다) · 보이는 영역이 내려가 있어도 같은 축', () => {
  assert.equal(caretScrollDelta({ top: 5, bottom: 25 }, view), 5 - 16)
  assert.equal(caretScrollDelta({ top: 200, bottom: 220 }, { top: 300, bottom: 650 }), 200 - 316)
})

test('④ 영역이 캐럿 한 줄보다 좁으면 굴리지 않는다', () => {
  assert.equal(caretScrollDelta({ top: 600, bottom: 640 }, { top: 0, bottom: 60 }), 0)
  // 꼭 한 줄이 들어가는 영역(여백을 빼고 24px)이면 맞춘다
  assert.equal(caretScrollDelta({ top: 600, bottom: 624 }, { top: 0, bottom: 56 }), 624 - 40)
})
