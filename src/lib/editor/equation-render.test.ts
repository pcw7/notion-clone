/**
 * 수식 그리기 — Phase 2 1a (F-01-20 · 실제 KaTeX)
 *
 *   ① 블록은 디스플레이 모드로 그린다 · 분수 같은 구조가 나온다
 *   ② 틀린 식은 던지지 않고 까닭을 돌려준다(머리말을 뗀다)
 *   ③ 보안 — `trust: false`: `\href` · `\url` · `\includegraphics` 가 링크 · 이미지를 만들지 않는다 · 재귀 매크로는 멈춘다
 *   ④ mhchem — `\ce` · `\pu` 만 가린다 · 불러 오면 화학식을 그린다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import katex from 'katex'

import { needsMhchem, renderEquation } from './equation-render.ts'

test('★ ① 블록은 디스플레이 모드 · 구조가 나온다', () => {
  const result = renderEquation(katex, '\\frac{a}{b} + \\sqrt{x}')
  assert.ok(result.ok)
  assert.match(result.html, /katex-display/)
  assert.match(result.html, /mfrac/)
  assert.match(result.html, /<math/)
  const inline = renderEquation(katex, 'x^2', false)
  assert.ok(inline.ok && !inline.html.includes('katex-display'))
})

test('★ ② 틀린 식은 던지지 않고 까닭을 돌려준다', () => {
  const unknown = renderEquation(katex, '\\nosuchmacro{x}')
  assert.equal(unknown.ok, false)
  assert.ok(!unknown.ok && unknown.message.includes('\\nosuchmacro') && !unknown.message.startsWith('KaTeX parse error'))
  assert.equal(renderEquation(katex, '\\frac{a}{').ok, false)
})

test('★ ③ 보안 — 주소를 받는 명령은 링크 · 이미지가 되지 않는다 · 재귀 매크로는 멈춘다', () => {
  for (const expression of [
    '\\href{javascript:alert(1)}{x}',
    '\\href{https://example.com}{x}',
    '\\url{javascript:alert(1)}',
    '\\includegraphics{https://example.com/a.png}',
    '\\htmlId{x}{y}',
  ]) {
    const result = renderEquation(katex, expression)
    const html = result.ok ? result.html : ''
    // 원문은 MathML 의 주석(글자)으로만 남는다 — 링크 · 이미지 · 주소를 담은 속성 · id 가 생기지 않는다.
    assert.ok(!/<a[\s>]|<img[\s>]|href=|src=|id="x"/.test(html), `${expression} → ${html.slice(0, 160)}`)
  }
  const started = Date.now()
  const loop = renderEquation(katex, '\\def\\a{\\a\\a}\\a')
  assert.equal(loop.ok, false)
  assert.ok(Date.now() - started < 2000)
})

test('④ mhchem — `\\ce` · `\\pu` 만 · 불러 오면 화학식', async () => {
  assert.equal(needsMhchem('\\ce{H2O}'), true)
  assert.equal(needsMhchem('\\pu{123 kJ}'), true)
  assert.equal(needsMhchem('\\cent \\put'), false)
  assert.equal(renderEquation(katex, '\\ce{H2O}').ok, false)
  await import('katex/contrib/mhchem')
  const water = renderEquation(katex, '\\ce{H2O}')
  assert.ok(water.ok && water.html.includes('H'))
})
