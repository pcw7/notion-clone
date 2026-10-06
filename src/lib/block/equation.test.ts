/**
 * 블록 수식의 저장 모양 — Phase 2 1a (F-01-20 · 순수)
 *
 *   ① 식 읽기 · 쓰기 — 없으면 빈 문자열 · 비면 키를 지운다 · 다른 키는 그대로
 *   ② 상한 — 1000자까지 자르고 서로게이트 쌍의 가운데에서 자르지 않는다
 *   ③ 마크다운 — `$$` 울타리 · 빈 줄은 뺀다 · 빈 식은 줄이 없다 / 되읽기는 문단이 통째로 `$$ … $$` 일 때만
 *   ④ 정화 — 문자열이 아니거나 공백뿐이면 지우고 넘으면 자른다 · 맞는 값은 같은 객체
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeBlockAttrs } from './props.ts'
import {
  clampExpression,
  displayMathOf,
  equationDisplayLines,
  equationExpressionOf,
  MAX_EQUATION_LENGTH,
  withEquationExpression,
} from './equation.ts'

test('① 식 읽기 · 쓰기', () => {
  assert.equal(equationExpressionOf({ expression: 'x^2' }), 'x^2')
  assert.equal(equationExpressionOf({ expression: 7 }), '')
  assert.equal(equationExpressionOf(undefined), '')
  assert.deepEqual(withEquationExpression({ other: 1 }, 'a+b'), { other: 1, expression: 'a+b' })
  assert.deepEqual(withEquationExpression({ other: 1, expression: 'a' }, '  \n '), { other: 1 })
})

test('★ ② 상한 — 1000자 · 서로게이트 쌍을 가르지 않는다', () => {
  assert.equal(MAX_EQUATION_LENGTH, 1000)
  assert.equal(clampExpression('x'.repeat(1001)).length, 1000)
  const pair = `${'x'.repeat(999)}😀`
  assert.equal(pair.length, 1001)
  assert.equal(clampExpression(pair), 'x'.repeat(999))
  assert.equal(clampExpression('짧다'), '짧다')
  assert.equal((withEquationExpression({}, 'y'.repeat(1500)).expression as string).length, 1000)
})

test('★ ③ 마크다운 — 울타리 · 빈 줄 · 되읽기', () => {
  assert.deepEqual(equationDisplayLines({ expression: 'a\n\n  \nb' }), ['$$', 'a', 'b', '$$'])
  assert.deepEqual(equationDisplayLines({}), [])
  assert.deepEqual(equationDisplayLines({ expression: '  ' }), [])
  assert.equal(displayMathOf('$$\n\\frac{a}{b}\n$$'), '\\frac{a}{b}')
  assert.equal(displayMathOf('  $$x^2$$  '), 'x^2')
  assert.equal(displayMathOf('$$ $$'), null)
  assert.equal(displayMathOf('앞 글 $$x$$'), null)
  assert.equal(displayMathOf('$$a$$ 와 $$b$$'), null)
  assert.equal(displayMathOf('$x$'), null)
  // 왕복 — 내보낸 줄을 문단으로 다시 읽으면 같은 식(빈 줄은 빠진다)
  assert.equal(displayMathOf(equationDisplayLines({ expression: 'a \\\\\nb' }).join('\n')), 'a \\\\\nb')
})

test('★ ④ 정화 — 틀린 모양은 지우고 넘는 것은 자른다 · 맞으면 같은 객체', () => {
  const ok = { expression: 'x' }
  assert.equal(sanitizeBlockAttrs('equation', ok, {}).props, ok)
  assert.equal(sanitizeBlockAttrs('equation', ok, {}).changed, false)
  assert.deepEqual(sanitizeBlockAttrs('equation', { expression: 42 }, {}).props, {})
  assert.deepEqual(sanitizeBlockAttrs('equation', { expression: '   ' }, {}).props, {})
  const long = sanitizeBlockAttrs('equation', { expression: 'z'.repeat(1200) }, {})
  assert.equal(long.changed, true)
  assert.equal((long.props.expression as string).length, 1000)
  // 색은 없다(공개 API 의 페이로드에 color 가 없다)
  assert.deepEqual(sanitizeBlockAttrs('equation', ok, { block_color: 'red' }).format, {})
  // 다른 타입의 `expression` 은 건드리지 않는다(레지스트리 칸이 정한다)
  assert.deepEqual(sanitizeBlockAttrs('paragraph', { expression: 42 }, {}).props, { expression: 42 })
})
