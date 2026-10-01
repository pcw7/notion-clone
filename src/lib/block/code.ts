/**
 * 코드 블록의 값 — 잔여 묶음 8a-1 · 8a-2 (F-01-14 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 코드 블록의 저장 모양 ① · ④ ~ ⑥
 *       01-block-editor.md F-01-14 *"`language` 는 enum 이 아니라 문자열로 저장 … 지원 목록에서 빠진 값이 들어와도 원본을
 *       보존해야 라운드트립이 깨지지 않는다"*
 *
 * 본문 편집기 · 블록 복사의 평문 · Markdown 내보내기가 같은 규칙을 쓴다 — 셋이 각자 세면 한쪽의 울타리가 코드 안의 백틱에
 * 끊긴다.
 */

import {
  DEFAULT_ANNOTATIONS,
  sameAnnotations,
  sanitizeRichText,
  splitText,
  textRun,
  toPlainText,
  validateRichText,
  type RichTextRun,
} from '../contracts/rich-text.ts'

/** 언어를 고르지 않은 코드 블록의 언어 — 노션의 기본값 이름. 저장하지 않는다(없으면 이것이다). */
export const PLAIN_TEXT_LANGUAGE = 'plain text'

/**
 * 코드 블록의 언어 — 고른 적이 없거나 plain text 면 null. **목록 밖의 값도 그대로 준다**(보존 · 정본 ①) — 표시할 이름이
 * 없는 것은 화면이 가른다.
 */
export function codeLanguageOf(properties: Readonly<Record<string, unknown>> | undefined): string | null {
  const raw = properties?.language
  if (typeof raw !== 'string') return null
  const language = raw.trim()
  return language === '' || language.toLowerCase() === PLAIN_TEXT_LANGUAGE ? null : language
}

// ── 언어 목록 (8a-2) ──────────────────────────────────────────────────

export type CodeLanguage = {
  /** 저장값 — 노션 공개 API 의 이름 그대로(정본 ④). */
  readonly id: string
  /** 화면 이름. */
  readonly label: string
  /** 검색어 — 저장하지 않는다. */
  readonly aliases?: readonly string[]
}

/**
 * 코드 블록의 언어 목록 — 노션 공개 API 가 받는 값 90개, 그 순서 그대로(8a-2).
 *
 * 출처: developers.notion.com 엔드포인트 레퍼런스(Append block children · Update a block …)의 OpenAPI 스키마 `languageRequest`
 * = 공식 SDK @notionhq/client 의 `LanguageRequest`(src/api-endpoints/common.ts). **Block object 레퍼런스의 표(72개)는 2021-11 에서
 * 멈춰 낡았다** — 그것으로 거르면 toml · solidity · notion formula 같은 값을 버린다.
 *
 * `id` 가 저장값이다(`properties.language` — 소문자 · 공백 · 기호 그대로). `label` 은 화면 이름, `aliases` 는 검색어(저장하지 않는다).
 * 목록 밖의 값도 보존한다(정본 §3.4 [보강] 코드 블록 ④) — 이 목록은 고르는 화면과 라벨의 것이지 검증의 것이 아니다.
 */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'abap', label: 'ABAP' },
  { id: 'abc', label: 'ABC' },
  { id: 'agda', label: 'Agda' },
  { id: 'arduino', label: 'Arduino', aliases: ['ino'] },
  { id: 'ascii art', label: 'ASCII Art', aliases: ['ascii'] },
  { id: 'assembly', label: 'Assembly', aliases: ['asm'] },
  { id: 'bash', label: 'Bash', aliases: ['sh'] },
  { id: 'basic', label: 'BASIC' },
  { id: 'bnf', label: 'BNF' },
  { id: 'c', label: 'C', aliases: ['h'] },
  { id: 'c#', label: 'C#', aliases: ['cs', 'csharp'] },
  { id: 'c++', label: 'C++', aliases: ['cpp', 'cxx', 'hpp'] },
  { id: 'clojure', label: 'Clojure', aliases: ['clj'] },
  { id: 'coffeescript', label: 'CoffeeScript', aliases: ['coffee'] },
  { id: 'coq', label: 'Coq' },
  { id: 'css', label: 'CSS' },
  { id: 'dart', label: 'Dart' },
  { id: 'dhall', label: 'Dhall' },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
  { id: 'docker', label: 'Docker', aliases: ['dockerfile'] },
  { id: 'ebnf', label: 'EBNF' },
  { id: 'elixir', label: 'Elixir', aliases: ['ex', 'exs'] },
  { id: 'elm', label: 'Elm' },
  { id: 'erlang', label: 'Erlang', aliases: ['erl'] },
  { id: 'f#', label: 'F#', aliases: ['fs', 'fsharp'] },
  { id: 'flow', label: 'Flow' },
  { id: 'fortran', label: 'Fortran', aliases: ['f90'] },
  { id: 'gherkin', label: 'Gherkin', aliases: ['cucumber', 'feature'] },
  { id: 'glsl', label: 'GLSL', aliases: ['shader'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'graphql', label: 'GraphQL', aliases: ['gql'] },
  { id: 'groovy', label: 'Groovy', aliases: ['gradle'] },
  { id: 'haskell', label: 'Haskell', aliases: ['hs'] },
  { id: 'hcl', label: 'HCL', aliases: ['terraform', 'tf'] },
  { id: 'html', label: 'HTML', aliases: ['htm'] },
  { id: 'idris', label: 'Idris' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'node'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc'] },
  { id: 'julia', label: 'Julia', aliases: ['jl'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt'] },
  { id: 'latex', label: 'LaTeX', aliases: ['tex'] },
  { id: 'less', label: 'Less' },
  { id: 'lisp', label: 'Lisp' },
  { id: 'livescript', label: 'LiveScript', aliases: ['ls'] },
  { id: 'llvm ir', label: 'LLVM IR', aliases: ['llvm'] },
  { id: 'lua', label: 'Lua' },
  { id: 'makefile', label: 'Makefile', aliases: ['make'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'markup', label: 'Markup' },
  { id: 'matlab', label: 'MATLAB' },
  { id: 'mathematica', label: 'Mathematica', aliases: ['wolfram'] },
  { id: 'mermaid', label: 'Mermaid' },
  { id: 'nix', label: 'Nix' },
  { id: 'notion formula', label: 'Notion Formula', aliases: ['formula'] },
  { id: 'objective-c', label: 'Objective-C', aliases: ['objc'] },
  { id: 'ocaml', label: 'OCaml', aliases: ['ml'] },
  { id: 'pascal', label: 'Pascal', aliases: ['delphi'] },
  { id: 'perl', label: 'Perl', aliases: ['pl'] },
  { id: 'php', label: 'PHP' },
  { id: 'plain text', label: 'Plain Text', aliases: ['text', 'txt', 'plain', '텍스트'] },
  { id: 'powershell', label: 'PowerShell', aliases: ['ps1', 'pwsh'] },
  { id: 'prolog', label: 'Prolog' },
  { id: 'protobuf', label: 'Protobuf', aliases: ['proto'] },
  { id: 'purescript', label: 'PureScript', aliases: ['purs'] },
  { id: 'python', label: 'Python', aliases: ['py', 'python3'] },
  { id: 'r', label: 'R' },
  { id: 'racket', label: 'Racket', aliases: ['rkt'] },
  { id: 'reason', label: 'Reason', aliases: ['reasonml'] },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'sass', label: 'Sass' },
  { id: 'scala', label: 'Scala' },
  { id: 'scheme', label: 'Scheme', aliases: ['scm'] },
  { id: 'scss', label: 'SCSS' },
  { id: 'shell', label: 'Shell', aliases: ['sh', 'zsh', 'console'] },
  { id: 'smalltalk', label: 'Smalltalk', aliases: ['st'] },
  { id: 'solidity', label: 'Solidity', aliases: ['sol'] },
  { id: 'sql', label: 'SQL', aliases: ['postgresql', 'mysql', 'sqlite'] },
  { id: 'swift', label: 'Swift' },
  { id: 'toml', label: 'TOML' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'vb.net', label: 'VB.Net', aliases: ['vbnet'] },
  { id: 'verilog', label: 'Verilog', aliases: ['v'] },
  { id: 'vhdl', label: 'VHDL' },
  { id: 'visual basic', label: 'Visual Basic', aliases: ['vb', 'vba'] },
  { id: 'webassembly', label: 'WebAssembly', aliases: ['wasm', 'wat'] },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
  { id: 'java/c/c++/c#', label: 'Java/C/C++/C#' },
]

const LANGUAGE_BY_ID: ReadonlyMap<string, CodeLanguage> = new Map(CODE_LANGUAGES.map((l) => [l.id, l]))

/**
 * 언어의 화면 이름 — 없으면(plain text) 'Plain Text', 목록에 있으면 그 이름, **목록 밖이면 저장된 원문**(보존된 값을 숨기지
 * 않는다). 대소문자는 가리지 않고 찾는다(가져온 값이 'Python' 일 수 있다).
 */
export function codeLanguageLabel(language: string | null): string {
  const key = (language ?? PLAIN_TEXT_LANGUAGE).trim().toLowerCase()
  return LANGUAGE_BY_ID.get(key)?.label ?? (language ?? '').trim()
}

export type CodeLanguageOption = {
  /** 고르면 쓸 값 — plain text 는 null(키를 지운다). */
  readonly id: string | null
  readonly label: string
  /** 지금 이 블록의 언어인가. */
  readonly current: boolean
}

/** 검색어 하나에 대한 한 언어의 순위 — 같다 0 · 앞머리 1 · 포함 2 · 없음 null. 이름 · 저장값 · 별칭을 본다. */
function rankOf(entry: CodeLanguage, query: string): number | null {
  if (query === '') return 0
  const names = [entry.label.toLowerCase(), entry.id, ...(entry.aliases ?? [])]
  if (names.some((n) => n === query)) return 0
  if (names.some((n) => n.startsWith(query))) return 1
  if (names.some((n) => n.includes(query))) return 2
  return null
}

/**
 * 언어 목록의 후보 — 검색어에 맞는 것만, 순위(같다 → 앞머리 → 포함) 다음 목록 순서. 저장된 값이 목록 밖이면 **맨 위에 그 원문**을
 * 한 줄 둔다 — 보존된 값이 목록에서 사라지지 않게.
 */
export function codeLanguageOptions(query: string, current: string | null): CodeLanguageOption[] {
  const q = query.trim().toLowerCase()
  const currentKey = (current ?? PLAIN_TEXT_LANGUAGE).trim().toLowerCase()
  const pool: CodeLanguage[] =
    current !== null && !LANGUAGE_BY_ID.has(currentKey) ? [{ id: current, label: current.trim() }, ...CODE_LANGUAGES] : [...CODE_LANGUAGES]
  return pool
    .map((entry, index) => ({ entry, index, rank: rankOf(entry, q) }))
    .filter((x): x is { entry: CodeLanguage; index: number; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => ({
      id: entry.id === PLAIN_TEXT_LANGUAGE ? null : entry.id,
      label: entry.label,
      current: entry.id.trim().toLowerCase() === currentKey,
    }))
}

/** 언어를 바꾼 props — null · 빈 값 · plain text 면 키를 지운다(정본 ④). 64자를 넘는 값은 받지 않는다(그대로 둔다). */
export function withCodeLanguage(props: Readonly<Record<string, unknown>>, language: string | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props }
  const value = (language ?? '').trim()
  if (value === '' || value.toLowerCase() === PLAIN_TEXT_LANGUAGE) delete next.language
  else if (value.length <= MAX_CODE_LANGUAGE_LENGTH) next.language = value
  return next
}

// ── 캡션 (8a-2) ───────────────────────────────────────────────────────

/** 캡션의 런 — 정화한 뒤(모양이 틀린 런은 빠진다 · `sanitizeRichText`). 없으면 빈 배열. */
export function codeCaptionRuns(props: Readonly<Record<string, unknown>> | undefined): RichTextRun[] {
  return sanitizeRichText(props?.caption) ?? []
}

/** 캡션의 평문. */
export function codeCaptionText(props: Readonly<Record<string, unknown>> | undefined): string {
  return toPlainText(codeCaptionRuns(props))
}

/** 받은 캡션을 평문 한 런으로 옮기면 잃는 것(서식 · 링크 · 멘션 · 수식)이 있는가 — 화면이 고치기 전에 말한다(정본 ⑤). */
export function isCaptionFormatted(props: Readonly<Record<string, unknown>> | undefined): boolean {
  return codeCaptionRuns(props).some(
    (r) => r.type !== 'text' || (r.text?.link ?? null) !== null || !sameAnnotations(r.annotations, DEFAULT_ANNOTATIONS),
  )
}

/**
 * 캡션을 바꾼 props — 평문 런(정본 ⑤). **글자가 지금과 같으면 받은 모양 그대로**(서식을 지킨다 · 쓰지 않게 — 앞뒤 공백만 다른 것도
 * 같다). 비우면 키를 지운다. 앞뒤 공백은 뗀다. **자르지 않는다** — 받은 캡션은 2000자를 넘을 수 있다(런마다 2000자다). 한 글자를
 * 고쳤다고 나머지를 버리면 안 되므로 2000자 단위의 런으로 쪼갠다(`splitText` — 서로게이트 쌍을 가르지 않는다).
 */
export function withCodeCaption(props: Readonly<Record<string, unknown>>, text: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props }
  const trimmed = text.trim()
  if (trimmed === codeCaptionText(props).trim()) return next
  if (trimmed === '') delete next.caption
  else next.caption = splitText(trimmed).map((chunk) => textRun(chunk))
  return next
}

/**
 * Markdown 울타리 — 코드 안의 가장 긴 백틱 줄보다 하나 긴 백틱(셋 이상). CommonMark 는 여는 울타리보다 짧지 않은 백틱 줄에서
 * 코드를 닫으므로, 코드 안에 ```` ``` ```` 가 있으면 넷으로 연다.
 */
export function markdownFence(code: string): string {
  let longest = 0
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * 울타리의 정보 문자열 — 언어. CommonMark 의 백틱 울타리는 정보 문자열에 백틱을 받지 않고 첫 낱말만 언어로 읽는다 — 백틱은
 * 빼고 공백은 `-` 로 잇는다(목록 밖의 값도 보존하되 울타리를 깨지 않는다).
 */
export function fenceInfo(language: string | null): string {
  return language === null ? '' : language.replace(/`/g, '').trim().replace(/\s+/g, '-')
}

/** 코드 블록 하나를 Markdown 울타리로 — 줄마다 `indent` 를 앞에 붙인다. */
export function fencedCode(code: string, language: string | null, indent = ''): string[] {
  const fence = markdownFence(code)
  return [`${indent}${fence}${fenceInfo(language)}`, ...code.split('\n').map((line) => `${indent}${line}`), `${indent}${fence}`]
}

/** 코드 블록의 타입 이름(`block.type` · 공개 API 와 같다). 노드 이름은 `code_block` 이다(레지스트리 `nodeName`). */
export const CODE_TYPE = 'code'

/** 언어 이름의 길이 상한 — 목록 밖의 값도 보존하지만(정본 ①) 끝없는 글자는 받지 않는다. */
export const MAX_CODE_LANGUAGE_LENGTH = 64

/**
 * 코드 블록의 properties 를 검사한다 — 본문 저장(API)이 화면을 거치지 않고 올 수 있다. `language` 는 문자열(64자까지 ·
 * 목록 밖의 값도 받는다), `caption` 은 RichText 배열.
 */
export function validateCodeProperties(properties: unknown, path: string): { path: string; message: string }[] {
  const raw = (properties as { language?: unknown; caption?: unknown } | null | undefined) ?? {}
  const issues: { path: string; message: string }[] = []
  // 읽기의 정화(`props.ts`)가 고칠 값은 받지 않는다(8a-2) — 받으면 저장한 뒤 읽을 때마다 고쳐 쓴다. 언어가 없으면 키를 뺀다.
  if (raw.language !== undefined) {
    if (typeof raw.language !== 'string') issues.push({ path: `${path}.language`, message: '문자열이어야 합니다(없으면 키를 빼세요)' })
    else if (raw.language.trim() === '') issues.push({ path: `${path}.language`, message: '비어 있습니다(없으면 키를 빼세요)' })
    else if (raw.language.length > MAX_CODE_LANGUAGE_LENGTH) {
      issues.push({ path: `${path}.language`, message: `${MAX_CODE_LANGUAGE_LENGTH}자까지입니다` })
    }
  }
  // 캡션은 런마다 계약을 지나야 한다(8a-2) — 배열인지만 보던 때에는 `[null]` 이 저장돼 투영을 멈췄다(정본 ⑧).
  if (raw.caption !== undefined) issues.push(...validateRichText(raw.caption, `${path}.caption`))
  return issues
}
