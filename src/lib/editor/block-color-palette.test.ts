/**
 * 블록 색의 고대비 팔레트 — 플랫폼 잔여 10d-5 (F-12-13 · 정본 §3.1 [보강] 설정 값 표 · 테마 ⑧)
 *
 * 팔레트는 CSS 에 산다(`app/editor.css` · 화면 바탕은 `app/globals.css`). 그 파일을 읽어 대비(WCAG 2)를 잰다 — 값을 고친 사람이 기준을 깨면 막는다.
 *   ① 대비 계산 — 검은 글자 · 흰 바탕은 21:1
 *   ② 블록 글자색 9개는 변수를 칠한다(`--block-text-<색>`) — 고대비가 바꿔 끼울 자리 · 다른 곳에서 색을 박지 않는다
 *   ③ 세 세트(표준 · 고대비 밝게 · 고대비 어둡게)가 9색을 모두 갖는다
 *   ④ ★ 고대비 — 화면 바탕과 7:1 이상(밝게 · 어둡게) · 같은 테마의 배경 9색 위에서도 4.5:1 이상
 *   ⑤ 배경 9색은 기본 글자와 7:1 이상(고대비에서 바꾸지 않는 까닭)
 *   ⑥ 편집기 CSS 는 `globals.css` 만 싣는다 — 따로 import 하면 우리 변형(`dark` · `contrast-high`)을 모른 채 컴파일된다
 *   ⑦ 어두운 테마의 표준 세트(10d-6) — 어두운 바탕과 4.5:1 이상(AA). 밝은 테마의 값을 그대로 쓰면 4.3:1 인 색이 있다
 *   ⑧ 고대비 세트는 표준 세트들보다 뒤에 선언한다 — 변형이 `:where()` 라 특이도가 같아 파일의 뒤가 이긴다
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { TEXT_COLORS } from '../contracts/rich-text.ts'

type Declaration = { readonly path: string; readonly prop: string; readonly value: string }

/** 선언마다 감싼 머리(선택자 · `@variant …`)를 ` > ` 로 이어 붙여 모은다. 주석은 지운다. */
function declarations(file: string): Declaration[] {
  const text = readFileSync(new URL(`../../app/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Declaration[] = []
  const stack: string[] = []
  let buf = ''
  for (const ch of text) {
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '))
      buf = ''
    } else if (ch === ';' || ch === '}') {
      const m = /^([\w-]+)\s*:\s*([\s\S]+)$/.exec(buf.trim())
      if (m) out.push({ path: stack.join(' > '), prop: m[1], value: m[2].trim() })
      buf = ''
      if (ch === '}') stack.pop()
    } else {
      buf += ch
    }
  }
  return out
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const HEX = /^#[0-9a-f]{6}$/i
const editor = declarations('editor.css')
const globals = declarations('globals.css')

const STANDARD = ':root'
const STANDARD_DARK = ':root > @variant dark'
const HIGH_LIGHT = ':root > @variant contrast-high'
const HIGH_DARK = ':root > @variant contrast-high > @variant dark'

/** 한 세트의 글자색 — 색 → 값. */
function textPalette(path: string): Map<string, string> {
  return new Map(editor.filter((d) => d.path === path && d.prop.startsWith('--block-text-')).map((d) => [d.prop.slice('--block-text-'.length), d.value]))
}

/** 배경 9색 — 밝은 테마는 맨 바깥 규칙 · 어두운 테마는 `dark` 변형 안. */
function backgrounds(dark: boolean): string[] {
  return TEXT_COLORS.map((c) => {
    const found = editor.filter((d) => d.prop === 'background' && d.path.endsWith(`[data-color='${c}_background']`) && d.path.startsWith(':root > @variant dark > ') === dark)
    assert.equal(found.length, 1, `${c}_background (${dark ? '어둡게' : '밝게'})`)
    return found[0].value
  })
}

function rootVar(name: string, dark: boolean): string {
  const found = globals.filter((d) => d.prop === name && d.path === (dark ? ':root > @variant dark' : ':root'))
  assert.equal(found.length, 1, `${name} (${dark ? '어둡게' : '밝게'})`)
  return found[0].value
}

test('① 대비 계산 — WCAG 2 상대 휘도', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21)
  assert.equal(contrast('#ffffff', '#000000'), 21, '순서와 상관없다')
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.01)
})

test('② 블록 글자색 9개는 변수를 칠한다 — 다른 곳에서 색을 박지 않는다', () => {
  for (const c of TEXT_COLORS) {
    const rules = editor.filter((d) => d.prop === 'color' && new RegExp(`\\[data-color='${c}'\\]$`).test(d.path))
    assert.ok(rules.length >= 1, `${c} 의 규칙이 없다`)
    for (const rule of rules) assert.equal(rule.value, `var(--block-text-${c})`, `${rule.path}`)
  }
})

test('③ 네 세트(표준 밝게 · 표준 어둡게 · 고대비 밝게 · 고대비 어둡게)가 9색을 모두 갖는다', () => {
  for (const path of [STANDARD, STANDARD_DARK, HIGH_LIGHT, HIGH_DARK]) {
    const palette = textPalette(path)
    assert.deepEqual([...palette.keys()].sort(), [...TEXT_COLORS].sort(), path)
    for (const [c, value] of palette) assert.match(value, HEX, `${path} ${c}`)
  }
})

test('④ ★ 고대비 — 화면 바탕과 7:1 이상 · 같은 테마의 배경 9색 위에서도 4.5:1 이상', () => {
  for (const [path, dark] of [[HIGH_LIGHT, false], [HIGH_DARK, true]] as const) {
    const page = rootVar('--background', dark)
    const tints = backgrounds(dark)
    const failures: string[] = []
    for (const [c, value] of textPalette(path)) {
      const onPage = contrast(value, page)
      if (onPage < 7) failures.push(`${c} ${value} — 바탕 ${page} 와 ${onPage.toFixed(2)}:1`)
      for (const tint of tints) {
        const onTint = contrast(value, tint)
        if (onTint < 4.5) failures.push(`${c} ${value} — 배경 ${tint} 위 ${onTint.toFixed(2)}:1`)
      }
    }
    assert.deepEqual(failures, [], path)
  }
})

test('⑤ 배경 9색은 기본 글자와 7:1 이상 — 고대비에서 바꾸지 않는 까닭', () => {
  for (const dark of [false, true]) {
    const fg = rootVar('--foreground', dark)
    for (const tint of backgrounds(dark)) assert.ok(contrast(fg, tint) >= 7, `${fg} on ${tint} = ${contrast(fg, tint).toFixed(2)}`)
  }
})

test('⑥ 편집기 CSS 는 globals.css 만 싣는다 — 따로 import 하면 우리 변형(dark · contrast-high)을 모른 채 컴파일된다', () => {
  const src = fileURLToPath(new URL('../../', import.meta.url))
  const importers = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('.test.ts'))
    .filter((f) => /(^|\n)\s*(@?import)\s+['"][^'"]*editor\.css['"]/.test(readFileSync(join(src, f), 'utf8')))
    .map((f) => f.replaceAll('\\', '/'))
  assert.deepEqual(importers, ['app/globals.css'])
})

test('⑦ 어두운 테마의 표준 세트 — 어두운 바탕과 4.5:1 이상(AA)', () => {
  const page = rootVar('--background', true)
  const failures = [...textPalette(STANDARD_DARK)]
    .map(([c, value]) => [c, value, contrast(value, page)] as const)
    .filter(([, , ratio]) => ratio < 4.5)
    .map(([c, value, ratio]) => `${c} ${value} — ${ratio.toFixed(2)}:1`)
  assert.deepEqual(failures, [])
  // 밝은 테마의 값을 그대로 쓰면 못 미친다 — 그래서 따로 둔다
  const light = textPalette(STANDARD)
  assert.ok([...light.values()].some((value) => contrast(value, page) < 4.5))
})

test('⑧ 고대비 세트는 표준 세트들보다 뒤에 선언한다 — 특이도가 같아(`:where`) 파일의 뒤가 이긴다', () => {
  const at = (path: string) => editor.flatMap((d, i) => (d.path === path && d.prop.startsWith('--block-text-') ? [i] : []))
  const lastStandard = Math.max(...at(STANDARD), ...at(STANDARD_DARK))
  assert.ok(Math.min(...at(HIGH_LIGHT), ...at(HIGH_DARK)) > lastStandard, '고대비 블록이 표준 · 어두운 테마의 선언보다 앞에 있다')
})
