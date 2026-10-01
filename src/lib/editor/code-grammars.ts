/**
 * 코드 블록의 문법 — 언어 이름 → highlight.js 문법 · 지연 로드 · 토큰 (잔여 묶음 8a-3 · F-01-14 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 코드 블록 ④ — 저장값은 노션 API 의 이름 90개. 목록 밖의 값은 보존하고 **칠하지 않는다**
 *       01-block-editor.md F-01-14 *"하이라이터는 … 지연 로드"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 노션 이름 → highlight.js 문법 — 어떤 규칙으로 잇는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 노션의 이름 목록은 Prism 의 언어 이름을 따른다(`markup` · `clike` 계열의 `java/c/c++/c#` 같은 Prism 고유 이름이 있다). 그래서
 *   ① highlight.js 에 그 언어의 문법이 있으면 그것(`c#` → `csharp` · `docker` → `dockerfile` · `toml` → `ini`(ini 문법의 공식 별칭) …)
 *   ② 없으면 **Prism 이 그 언어를 넓혀 만든 바탕 언어**의 문법 — Prism 의 정의가 그 언어를 바탕 언어로 읽으므로 노션에서도 같은
 *      색이다(`flow` ← javascript · `purescript` ← haskell · `racket` ← scheme · `shell` 은 Prism 에서 bash 의 별칭 · `java/c/c++/c#` 은
 *      Prism 의 clike — highlight.js 에 clike 가 없어 C 계열의 가장 넓은 문법 cpp). `sass` 는 SCSS 와 같은 언어(Sass)의 다른 표기라 scss
 *   ③ 그것도 없으면 칠하지 않는다(null) — 닮은 언어로 어림하지 않는다. 틀린 색은 색이 없는 것보다 나쁘다
 * **목록 밖의 값(가져온 `py` · `tsx` …)은 칠하지 않는다** — 그 값은 라벨도 원문이다(`codeLanguageLabel`). 별칭은 검색어이지 저장값이
 * 아니다. 대소문자는 가리지 않는다(라벨과 같은 규칙 — 가져온 값이 'Python' 일 수 있다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 지연 로드 — 언어마다 한 덩어리
 * ──────────────────────────────────────────────────────────────────────
 *
 * 문법을 다 실으면 편집기 묶음이 커진다(highlight.js 의 언어 파일만 수백 KB). 언어마다 `import()` 를 **글자 그대로** 적어 번들러가
 * 언어마다 덩어리를 만든다(경로를 변수로 만들면 번들러가 묶음을 가르지 못한다). 처음 보는 언어가 나오면 강조 플러그인의 뷰가 부르고,
 * 들어오면 다시 그리게 한다(`code-highlight.ts`). 문법이 다른 문법을 품으면(`xml` 의 `<script>` · `javascript` 의 JSX · 템플릿)
 * 그것까지 들어온 뒤에 준비됐다고 한다 — 먼저 칠하고 나중에 들어온 품은 문법을 반영하려면 한 번 더 그려야 한다.
 *
 * lowlight 인스턴스는 모듈에 하나다 — 등록은 전역이고 멱등이다. 편집기가 여럿이어도 한 번 불러 같이 쓴다.
 */

import { createLowlight } from 'lowlight'
import type { LanguageFn } from 'highlight.js'

// ── 노션 이름 → highlight.js 문법 ─────────────────────────────────────

/**
 * 노션 공개 API 의 언어 이름(저장값 · `CODE_LANGUAGES` 의 `id`) → highlight.js 문법 이름. null 이면 칠하지 않는다. 규칙은 머리말 ①~③.
 * `CODE_LANGUAGES` 와 키가 같아야 한다(검사가 본다 — 언어를 더하면 여기도 정한다).
 */
export const HIGHLIGHT_GRAMMARS: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ['abap', null],
  ['abc', null],
  ['agda', null],
  ['arduino', 'arduino'],
  ['ascii art', null],
  ['assembly', 'x86asm'],
  ['bash', 'bash'],
  ['basic', 'basic'],
  ['bnf', 'bnf'],
  ['c', 'c'],
  ['c#', 'csharp'],
  ['c++', 'cpp'],
  ['clojure', 'clojure'],
  ['coffeescript', 'coffeescript'],
  ['coq', 'coq'],
  ['css', 'css'],
  ['dart', 'dart'],
  ['dhall', null],
  ['diff', 'diff'],
  ['docker', 'dockerfile'],
  ['ebnf', 'ebnf'],
  ['elixir', 'elixir'],
  ['elm', 'elm'],
  ['erlang', 'erlang'],
  ['f#', 'fsharp'],
  ['flow', 'javascript'],
  ['fortran', 'fortran'],
  ['gherkin', 'gherkin'],
  ['glsl', 'glsl'],
  ['go', 'go'],
  ['graphql', 'graphql'],
  ['groovy', 'groovy'],
  ['haskell', 'haskell'],
  ['hcl', null],
  ['html', 'xml'],
  ['idris', null],
  ['java', 'java'],
  ['javascript', 'javascript'],
  ['json', 'json'],
  ['julia', 'julia'],
  ['kotlin', 'kotlin'],
  ['latex', 'latex'],
  ['less', 'less'],
  ['lisp', 'lisp'],
  ['livescript', 'livescript'],
  ['llvm ir', 'llvm'],
  ['lua', 'lua'],
  ['makefile', 'makefile'],
  ['markdown', 'markdown'],
  ['markup', 'xml'],
  ['matlab', 'matlab'],
  ['mathematica', 'mathematica'],
  ['mermaid', null],
  ['nix', 'nix'],
  ['notion formula', null],
  ['objective-c', 'objectivec'],
  ['ocaml', 'ocaml'],
  ['pascal', 'delphi'],
  ['perl', 'perl'],
  ['php', 'php'],
  ['plain text', null],
  ['powershell', 'powershell'],
  ['prolog', 'prolog'],
  ['protobuf', 'protobuf'],
  ['purescript', 'haskell'],
  ['python', 'python'],
  ['r', 'r'],
  ['racket', 'scheme'],
  ['reason', 'reasonml'],
  ['ruby', 'ruby'],
  ['rust', 'rust'],
  ['sass', 'scss'],
  ['scala', 'scala'],
  ['scheme', 'scheme'],
  ['scss', 'scss'],
  ['shell', 'bash'],
  ['smalltalk', 'smalltalk'],
  ['solidity', null],
  ['sql', 'sql'],
  ['swift', 'swift'],
  ['toml', 'ini'],
  ['typescript', 'typescript'],
  ['vb.net', 'vbnet'],
  ['verilog', 'verilog'],
  ['vhdl', 'vhdl'],
  ['visual basic', 'vbnet'],
  ['webassembly', 'wasm'],
  ['xml', 'xml'],
  ['yaml', 'yaml'],
  ['java/c/c++/c#', 'cpp'],
])

/**
 * 코드 블록 언어(저장값) → 칠할 문법. plain text · 없음 · 목록 밖 · 문법이 없는 언어는 null. **Map 으로 찾는다** — 저장값은 협업
 * 참여자가 무엇이든 쓸 수 있어 `'constructor'` · `'__proto__'` 같은 값으로 객체의 프로토타입을 읽으면 안 된다.
 */
export function grammarOf(language: string | null): string | null {
  if (typeof language !== 'string') return null
  return HIGHLIGHT_GRAMMARS.get(language.trim().toLowerCase()) ?? null
}

// ── 지연 로드 ─────────────────────────────────────────────────────────

type GrammarModule = { readonly default: LanguageFn }

/**
 * 문법 이름 → 그 파일을 불러오는 함수. **경로를 글자 그대로 적는다**(머리말 — 번들러가 언어마다 덩어리를 만든다). 위 표의 값과
 * 아래 품은 문법이 모두 여기 있어야 한다(검사가 본다).
 */
export const GRAMMAR_LOADERS: ReadonlyMap<string, () => Promise<GrammarModule>> = new Map<string, () => Promise<GrammarModule>>([
  ['arduino', () => import('highlight.js/lib/languages/arduino')],
  ['bash', () => import('highlight.js/lib/languages/bash')],
  ['basic', () => import('highlight.js/lib/languages/basic')],
  ['bnf', () => import('highlight.js/lib/languages/bnf')],
  ['c', () => import('highlight.js/lib/languages/c')],
  ['clojure', () => import('highlight.js/lib/languages/clojure')],
  ['coffeescript', () => import('highlight.js/lib/languages/coffeescript')],
  ['coq', () => import('highlight.js/lib/languages/coq')],
  ['cpp', () => import('highlight.js/lib/languages/cpp')],
  ['csharp', () => import('highlight.js/lib/languages/csharp')],
  ['css', () => import('highlight.js/lib/languages/css')],
  ['dart', () => import('highlight.js/lib/languages/dart')],
  ['delphi', () => import('highlight.js/lib/languages/delphi')],
  ['diff', () => import('highlight.js/lib/languages/diff')],
  ['dockerfile', () => import('highlight.js/lib/languages/dockerfile')],
  ['ebnf', () => import('highlight.js/lib/languages/ebnf')],
  ['elixir', () => import('highlight.js/lib/languages/elixir')],
  ['elm', () => import('highlight.js/lib/languages/elm')],
  ['erlang', () => import('highlight.js/lib/languages/erlang')],
  ['fortran', () => import('highlight.js/lib/languages/fortran')],
  ['fsharp', () => import('highlight.js/lib/languages/fsharp')],
  ['gherkin', () => import('highlight.js/lib/languages/gherkin')],
  ['glsl', () => import('highlight.js/lib/languages/glsl')],
  ['go', () => import('highlight.js/lib/languages/go')],
  ['graphql', () => import('highlight.js/lib/languages/graphql')],
  ['groovy', () => import('highlight.js/lib/languages/groovy')],
  ['haskell', () => import('highlight.js/lib/languages/haskell')],
  ['ini', () => import('highlight.js/lib/languages/ini')],
  ['java', () => import('highlight.js/lib/languages/java')],
  ['javascript', () => import('highlight.js/lib/languages/javascript')],
  ['json', () => import('highlight.js/lib/languages/json')],
  ['julia', () => import('highlight.js/lib/languages/julia')],
  ['kotlin', () => import('highlight.js/lib/languages/kotlin')],
  ['latex', () => import('highlight.js/lib/languages/latex')],
  ['less', () => import('highlight.js/lib/languages/less')],
  ['lisp', () => import('highlight.js/lib/languages/lisp')],
  ['livescript', () => import('highlight.js/lib/languages/livescript')],
  ['llvm', () => import('highlight.js/lib/languages/llvm')],
  ['lua', () => import('highlight.js/lib/languages/lua')],
  ['makefile', () => import('highlight.js/lib/languages/makefile')],
  ['markdown', () => import('highlight.js/lib/languages/markdown')],
  ['mathematica', () => import('highlight.js/lib/languages/mathematica')],
  ['matlab', () => import('highlight.js/lib/languages/matlab')],
  ['nix', () => import('highlight.js/lib/languages/nix')],
  ['objectivec', () => import('highlight.js/lib/languages/objectivec')],
  ['ocaml', () => import('highlight.js/lib/languages/ocaml')],
  ['perl', () => import('highlight.js/lib/languages/perl')],
  ['php', () => import('highlight.js/lib/languages/php')],
  ['powershell', () => import('highlight.js/lib/languages/powershell')],
  ['prolog', () => import('highlight.js/lib/languages/prolog')],
  ['protobuf', () => import('highlight.js/lib/languages/protobuf')],
  ['python', () => import('highlight.js/lib/languages/python')],
  ['r', () => import('highlight.js/lib/languages/r')],
  ['reasonml', () => import('highlight.js/lib/languages/reasonml')],
  ['ruby', () => import('highlight.js/lib/languages/ruby')],
  ['rust', () => import('highlight.js/lib/languages/rust')],
  ['scala', () => import('highlight.js/lib/languages/scala')],
  ['scheme', () => import('highlight.js/lib/languages/scheme')],
  ['scss', () => import('highlight.js/lib/languages/scss')],
  ['smalltalk', () => import('highlight.js/lib/languages/smalltalk')],
  ['sql', () => import('highlight.js/lib/languages/sql')],
  ['swift', () => import('highlight.js/lib/languages/swift')],
  ['typescript', () => import('highlight.js/lib/languages/typescript')],
  ['vbnet', () => import('highlight.js/lib/languages/vbnet')],
  ['verilog', () => import('highlight.js/lib/languages/verilog')],
  ['vhdl', () => import('highlight.js/lib/languages/vhdl')],
  ['wasm', () => import('highlight.js/lib/languages/wasm')],
  ['x86asm', () => import('highlight.js/lib/languages/x86asm')],
  ['xml', () => import('highlight.js/lib/languages/xml')],
  ['yaml', () => import('highlight.js/lib/languages/yaml')],
])

/**
 * 문법이 품는 문법(highlight.js 의 `subLanguage`) — 그것이 없으면 그 부분은 글자로 남는다. 칠하는 데 의미가 있는 것만 적었다
 * (`xml` 의 handlebars · `perl` 의 mojolicious 처럼 노션 목록에 없는 템플릿 언어는 뺐다).
 */
export const GRAMMAR_REQUIRES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['xml', ['css', 'javascript']],
  ['javascript', ['xml', 'css', 'graphql']],
  ['typescript', ['xml', 'css', 'graphql']],
  ['markdown', ['xml']],
  ['coffeescript', ['javascript']],
  ['livescript', ['javascript']],
  ['dockerfile', ['bash']],
  ['dart', ['markdown']],
  ['nix', ['markdown']],
  ['yaml', ['ruby']],
])

/** 문법과 그것이 품는 문법 전부(순환을 따라가지 않는다). */
export function grammarClosure(grammar: string): string[] {
  const seen = new Set<string>()
  const visit = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    for (const inner of GRAMMAR_REQUIRES.get(name) ?? []) visit(inner)
  }
  visit(grammar)
  return [...seen]
}

const lowlight = createLowlight()
const loading = new Map<string, Promise<void>>()
const failed = new Set<string>()

/** 한 문법 파일을 불러 등록한다 — 이미 불렀거나 부르는 중이면 그 약속. 실패하면 다시 부르지 않는다(덩어리가 없는 배포 · 끊긴 망). */
function loadOne(name: string): Promise<void> {
  const pending = loading.get(name)
  if (pending !== undefined) return pending
  const loader = GRAMMAR_LOADERS.get(name)
  const promise =
    loader === undefined
      ? Promise.reject(new Error(`문법이 없다: ${name}`))
      : loader().then((module) => {
          if (!lowlight.registered(name)) lowlight.register(name, module.default)
        })
  const settled = promise.catch((error: unknown) => {
    failed.add(name)
    throw error
  })
  loading.set(name, settled)
  return settled
}

/** 문법(과 그것이 품는 문법)을 불러 등록한다. 하나라도 실패하면 거부한다 — 그 문법은 이번 세션에 칠하지 않는다(`grammarStatus`). */
export async function loadGrammar(grammar: string): Promise<void> {
  await Promise.all(grammarClosure(grammar).map(loadOne))
}

export type GrammarStatus = 'ready' | 'loading' | 'failed' | 'idle'

/** 문법이 칠할 준비가 됐는가 — 품는 문법까지 등록됐으면 ready, 그중 하나라도 실패했으면 failed. */
export function grammarStatus(grammar: string): GrammarStatus {
  const names = grammarClosure(grammar)
  if (names.some((name) => failed.has(name) || !GRAMMAR_LOADERS.has(name))) return 'failed'
  if (names.every((name) => lowlight.registered(name))) return 'ready'
  return names.some((name) => loading.has(name)) ? 'loading' : 'idle'
}

// ── 토큰 ─────────────────────────────────────────────────────────────

/** 칠할 글자 범위 — 코드 글자 안의 오프셋(UTF-16 · ProseMirror 의 위치와 같은 단위) · 그 글자가 든 범위들의 클래스 전부. */
export type TokenRange = { readonly from: number; readonly to: number; readonly className: string }

/** lowlight 가 돌려주는 hast 의 필요한 부분만 — 타입 패키지를 따로 들이지 않는다. */
type HastNode = {
  readonly type: string
  readonly value?: string
  readonly properties?: { readonly className?: unknown }
  readonly children?: readonly HastNode[]
}

/**
 * hast 를 겹치지 않는 범위로 편다 — 글자 조각마다 **바깥에서 안쪽까지의 클래스를 모두** 잇는다(`hljs-string hljs-subst`). 안쪽이
 * 이기게 하는 것은 CSS 의 순서다(`editor.css` — 감싸는 범위 → 글자 범위). 클래스가 없는 조각은 범위를 만들지 않고, 붙어 있는 같은
 * 클래스는 하나로 잇는다. `base` 는 첫 글자의 오프셋이다.
 */
export function flattenTokens(root: HastNode, base: number): TokenRange[] {
  const out: { from: number; to: number; className: string }[] = []
  let offset = base
  const walk = (nodes: readonly HastNode[], classes: string): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const length = (node.value ?? '').length
        if (classes !== '' && length > 0) {
          const last = out[out.length - 1]
          if (last !== undefined && last.to === offset && last.className === classes) last.to += length
          else out.push({ from: offset, to: offset + length, className: classes })
        }
        offset += length
      } else if (node.children !== undefined) {
        const own = Array.isArray(node.properties?.className) ? node.properties.className.filter((c) => typeof c === 'string').join(' ') : ''
        walk(node.children, own === '' ? classes : classes === '' ? own : `${classes} ${own}`)
      }
    }
  }
  walk(root.children ?? [], '')
  return out
}

/**
 * 코드 글자의 한 구간을 칠한다 — `text[scanFrom, to)` 를 읽고(앞의 문맥까지) `[from, to)` 안의 범위만 돌려준다(경계에서 자른다).
 * 문법이 준비되지 않았거나 highlight.js 가 던지면 빈 배열 — **칠하기가 편집을 막지 않는다**.
 */
export function highlightTokens(grammar: string, text: string, range: { readonly scanFrom: number; readonly from: number; readonly to: number }): TokenRange[] {
  if (grammarStatus(grammar) !== 'ready') return []
  let root: HastNode
  try {
    root = lowlight.highlight(grammar, text.slice(range.scanFrom, range.to)) as HastNode
  } catch {
    return []
  }
  const out: TokenRange[] = []
  for (const token of flattenTokens(root, range.scanFrom)) {
    const from = Math.max(token.from, range.from)
    const to = Math.min(token.to, range.to)
    if (from < to) out.push(from === token.from && to === token.to ? token : { from, to, className: token.className })
  }
  return out
}
