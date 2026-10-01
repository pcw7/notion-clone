/**
 * 코드 블록의 문법 — 잔여 묶음 8a-3 (F-01-14 · DOM 없음 · highlight.js 를 실제로 불러 돌린다)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 품은 문법 — `html`(xml) 안의 `<script>` 는 javascript 로 칠한다(품은 문법까지 불러야 준비됐다). **이 검사는 파일의 첫 검사다** —
 *      등록은 프로세스 전역이라 다른 검사가 javascript 를 먼저 부르면 품은 문법을 빼도 통과한다
 *   ② ★ 표 — 노션 목록 90개와 키가 같다 · 값과 품은 문법은 모두 불러올 수 있다 · 쓰지 않는 불러오기가 없다 · 모두 실제로 등록된다
 *   ③ ★ 이름 → 문법 — 대소문자 · 앞뒤 공백을 가리지 않는다 · plain text · 목록 밖(별칭 포함) · 문법이 없는 언어 · 프로토타입 이름은 null
 *   ④ ★ 지연 로드 — 부르기 전에는 칠하지 않는다 · 실패한 문법은 다시 부르지 않고 failed
 *   ⑤ ★ 토큰 — 범위는 겹치지 않고 글자와 맞는다(한글 · 이모지 뒤에서도) · 안쪽 범위는 바깥 클래스를 함께 진다 · 창의 경계에서 자른다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { CODE_LANGUAGES } from '../block/code.ts'
import {
  GRAMMAR_LOADERS,
  GRAMMAR_REQUIRES,
  HIGHLIGHT_GRAMMARS,
  flattenTokens,
  grammarClosure,
  grammarOf,
  grammarStatus,
  highlightTokens,
  loadGrammar,
  type TokenRange,
} from './code-grammars.ts'

const whole = (text: string) => ({ scanFrom: 0, from: 0, to: text.length })

/** 칠한 글자와 클래스. */
const painted = (text: string, ranges: readonly TokenRange[]) => ranges.map((r) => [text.slice(r.from, r.to), r.className] as const)

// ── ① — 반드시 첫 검사 ───────────────────────────────────────────────

describe('① 품은 문법', () => {
  test('★ html 의 <script> 안은 javascript 로, <style> 안은 css 로 칠한다 — 품은 문법까지 불러야 준비됐다', async () => {
    assert.equal(grammarStatus('javascript'), 'idle', '전제 — 이 검사 전에 javascript 를 부른 검사가 있다(첫 검사여야 한다)')
    assert.equal(grammarOf('html'), 'xml')
    await loadGrammar('xml')
    assert.equal(grammarStatus('xml'), 'ready')
    assert.equal(grammarStatus('javascript'), 'ready', 'xml 을 부르면 품은 javascript 도 들어와야 한다')
    const text = '<script>let x = 1</script><style>p { color: red }</style>'
    const out = painted(text, highlightTokens('xml', text, whole(text)))
    assert.ok(out.some(([t, c]) => t === 'let' && c.split(' ').includes('hljs-keyword')), JSON.stringify(out))
    assert.ok(out.some(([t, c]) => t === 'color' && c.split(' ').includes('hljs-attribute')), JSON.stringify(out))
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 표', () => {
  test('★ 노션 목록 90개와 키가 같다 — 언어를 더하면 칠할 문법도 정해야 한다', () => {
    assert.deepEqual([...HIGHLIGHT_GRAMMARS.keys()].sort(), CODE_LANGUAGES.map((l) => l.id).sort())
    assert.equal(HIGHLIGHT_GRAMMARS.size, 90)
  })

  test('★ 표의 값과 품은 문법은 모두 불러올 수 있고, 쓰지 않는 불러오기가 없다', () => {
    const used = new Set<string>()
    for (const grammar of HIGHLIGHT_GRAMMARS.values()) if (grammar !== null) for (const name of grammarClosure(grammar)) used.add(name)
    for (const name of used) assert.ok(GRAMMAR_LOADERS.has(name), `불러올 수 없는 문법: ${name}`)
    for (const [name, inner] of GRAMMAR_REQUIRES) {
      assert.ok(GRAMMAR_LOADERS.has(name), `품는 쪽을 불러올 수 없다: ${name}`)
      for (const n of inner) assert.ok(GRAMMAR_LOADERS.has(n), `품은 문법을 불러올 수 없다: ${n}`)
    }
    assert.deepEqual([...GRAMMAR_LOADERS.keys()].filter((name) => !used.has(name)), [], '아무 언어도 쓰지 않는 불러오기')
  })

  test('★ 모든 문법이 실제로 불러와져 등록된다 — 경로 · 패키지 exports 가 맞다', async () => {
    for (const grammar of new Set(HIGHLIGHT_GRAMMARS.values())) {
      if (grammar === null) continue
      await loadGrammar(grammar)
      assert.equal(grammarStatus(grammar), 'ready', grammar)
    }
  })

  test('문법이 없는 언어는 11개다 — 어림하지 않는다(머리말 ③)', () => {
    const none = [...HIGHLIGHT_GRAMMARS].filter(([, g]) => g === null).map(([id]) => id)
    assert.deepEqual(none, ['abap', 'abc', 'agda', 'ascii art', 'dhall', 'hcl', 'idris', 'mermaid', 'notion formula', 'plain text', 'solidity'])
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 이름 → 문법', () => {
  test('★ 대소문자 · 앞뒤 공백을 가리지 않는다(라벨과 같은 규칙)', () => {
    assert.equal(grammarOf('python'), 'python')
    assert.equal(grammarOf('Python'), 'python')
    assert.equal(grammarOf('  C++ '), 'cpp')
    assert.equal(grammarOf('Java/C/C++/C#'), 'cpp')
  })

  test('노션 이름이 Prism 의 바탕 언어를 따른다 — shell 은 bash · flow 는 javascript · toml 은 ini', () => {
    assert.equal(grammarOf('shell'), 'bash')
    assert.equal(grammarOf('flow'), 'javascript')
    assert.equal(grammarOf('toml'), 'ini')
    assert.equal(grammarOf('docker'), 'dockerfile')
    assert.equal(grammarOf('markup'), 'xml')
  })

  test('★ plain text · 없음 · 목록 밖(별칭 포함) · 문법이 없는 언어는 칠하지 않는다', () => {
    for (const language of [null, '', 'plain text', 'Plain Text', 'py', 'tsx', 'js', 'sh', 'pythonx', 'mermaid', 'notion formula']) {
      assert.equal(grammarOf(language), null, String(language))
    }
  })

  test('★ 프로토타입 이름 · 문자열이 아닌 값은 null — 저장값은 참여자가 무엇이든 쓸 수 있다', () => {
    for (const language of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) assert.equal(grammarOf(language), null, language)
    for (const poison of [5, 5n, {}, ['python'], true]) assert.equal(grammarOf(poison as never), null, String(poison))
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 지연 로드', () => {
  test('★ 없는 문법은 failed — 불러오기는 거부한다', async () => {
    assert.equal(grammarStatus('no-such-grammar'), 'failed')
    await assert.rejects(loadGrammar('no-such-grammar'))
  })

  test('★ 불러오기가 실패한 문법은 failed 가 되고 다시 부르지 않는다', async () => {
    let calls = 0
    // 실패하는 덩어리를 흉내낸다 — 검사 전용 이름이라 다른 검사와 겹치지 않는다.
    ;(GRAMMAR_LOADERS as Map<string, () => Promise<never>>).set('test-broken', () => {
      calls += 1
      return Promise.reject(new Error('덩어리를 받지 못했다'))
    })
    try {
      assert.equal(grammarStatus('test-broken'), 'idle')
      const first = loadGrammar('test-broken')
      assert.equal(grammarStatus('test-broken'), 'loading')
      await assert.rejects(first)
      assert.equal(grammarStatus('test-broken'), 'failed')
      await assert.rejects(loadGrammar('test-broken'))
      assert.equal(calls, 1, '실패한 문법을 다시 불렀다')
      assert.deepEqual(highlightTokens('test-broken', 'x', whole('x')), [])
    } finally {
      ;(GRAMMAR_LOADERS as Map<string, unknown>).delete('test-broken')
    }
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 토큰', () => {
  test('★ 범위는 겹치지 않고 정렬돼 있으며 글자와 맞는다 — 한글 · 이모지 뒤에서도(UTF-16 오프셋)', async () => {
    await loadGrammar('python')
    const text = '# 한글 😀 주석\ndef 함수(x):\n    return "값 😀"  # 끝'
    const ranges = highlightTokens('python', text, whole(text))
    for (let i = 1; i < ranges.length; i += 1) assert.ok(ranges[i - 1].to <= ranges[i].from, '범위가 겹치거나 순서가 틀렸다')
    const out = painted(text, ranges)
    assert.deepEqual(out.find(([, c]) => c === 'hljs-comment'), ['# 한글 😀 주석', 'hljs-comment'])
    assert.ok(out.some(([t, c]) => t === 'def' && c === 'hljs-keyword'), JSON.stringify(out))
    assert.ok(out.some(([t, c]) => t === '"값 😀"' && c === 'hljs-string'), JSON.stringify(out))
    // 끝까지 밀리지 않았다 — 마지막 주석이 정확히 그 글자다.
    assert.deepEqual(out[out.length - 1], ['# 끝', 'hljs-comment'])
  })

  test('★ 안쪽 범위는 바깥 클래스를 함께 진다 — 템플릿 문자열 안의 식(바깥 → 안 순서)', async () => {
    await loadGrammar('javascript')
    const text = 'const s = `a${b + 1}c`'
    const out = painted(text, highlightTokens('javascript', text, whole(text)))
    assert.ok(out.some(([t, c]) => t === '1' && c === 'hljs-string hljs-subst hljs-number'), JSON.stringify(out))
    assert.ok(out.some(([t, c]) => t === '${b + ' && c === 'hljs-string hljs-subst'), JSON.stringify(out))
  })

  test('★ 칠하는 범위의 경계에서 자른다 — 문맥은 읽되 칠하지 않는다', async () => {
    await loadGrammar('python')
    const text = '"""여는 줄\n안쪽 def\n닫는 줄"""\ndef f(): pass'
    const inner = text.indexOf('안쪽')
    const ranges = highlightTokens('python', text, { scanFrom: 0, from: inner, to: text.length })
    assert.ok(ranges.every((r) => r.from >= inner && r.to <= text.length), '경계 밖을 칠했다')
    const out = painted(text, ranges)
    // 문맥(여는 줄)을 읽었으므로 `def` 는 문자열 안이다.
    assert.equal(out[0][1], 'hljs-string')
    assert.ok(out[0][0].startsWith('안쪽 def'), JSON.stringify(out))
    assert.ok(out.some(([t, c]) => t === 'def' && c === 'hljs-keyword'), '닫힌 뒤의 def 는 키워드다')
  })

  test('flattenTokens — 클래스 없는 조각은 범위를 만들지 않고 붙어 있는 같은 클래스는 잇는다', () => {
    const root = {
      type: 'root',
      children: [
        { type: 'text', value: 'a ' },
        { type: 'element', properties: { className: ['k'] }, children: [{ type: 'text', value: 'if' }] },
        { type: 'element', properties: { className: ['k'] }, children: [{ type: 'text', value: 'x' }] },
        { type: 'element', properties: { className: [5, 'n'] }, children: [{ type: 'text', value: '' }, { type: 'text', value: '9' }] },
      ],
    }
    assert.deepEqual(flattenTokens(root, 10), [
      { from: 12, to: 15, className: 'k' },
      { from: 15, to: 16, className: 'n' },
    ])
  })
})
