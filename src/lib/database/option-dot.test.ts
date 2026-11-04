// 옵션 점 색의 두 표가 같은 색인가(38번 트랙 CH-2 · 정본 §3.6 [보강 CH-2] ③).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OPTION_DOT_CLASS, OPTION_DOT_RGB } from './option-dot.ts'

test('★ 태그의 점 클래스와 차트의 면 색이 같은 색 · 같은 색 이름', () => {
  assert.deepEqual(Object.keys(OPTION_DOT_CLASS).sort(), Object.keys(OPTION_DOT_RGB).sort())
  for (const [color, rgb] of Object.entries(OPTION_DOT_RGB)) {
    assert.equal(OPTION_DOT_CLASS[color as keyof typeof OPTION_DOT_CLASS], `bg-[${rgb}]`, color)
  }
})
