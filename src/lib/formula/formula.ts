/**
 * 수식 — 바깥 얼굴: 묶기 · 저장 모양 · 보이는 모양 · 계산 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 정본: 03-database-core.md F-03-12 · 마스터 문서 §5.3 *"formula 는 3단계 점진 도입(미지원 → 최소 언어 → List/map/filter).
 *       `eval` · `Function` 생성 절대 금지"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 속성은 id 로 묶는다 — 이름을 바꿔도 깨지지 않게
 * ──────────────────────────────────────────────────────────────────────
 *
 * 03 *"`prop("이름")` 은 저장 시 property id 로 바인딩 … 문자열 이름 바인딩이면 깨진다 → id 바인딩 필수"*. 사람은 `prop("점수")` 로 쓰고,
 * 저장하는 식(`stored`)은 그 자리를 `⟦id⟧` 로 바꾼 **원문 그대로**다 — 줄바꿈 · 주석 · 띄어쓰기가 남는다. 보일 때는(`displayFormula`)
 * 지금 이름으로 되돌린다. 저장된 식은 이름 없이도 다시 읽힌다(`⟦id⟧` 가 곧 속성이다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 한 번 읽어 넷을 낸다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `compileFormula` = 토큰 → 문법 → 이름 묶기 → 타입 검사. 결과는 저장할 식 · 묶인 나무 · 결과 타입 · 기대는 속성(`dependsOn` — 의존
 * 그래프의 간선 · F-03-13). 틀리면 **첫 오류 하나**를 위치와 함께 준다(편집기가 그 자리에 밑줄을 긋는다).
 */

import { tokenize, PROP_CLOSE, PROP_OPEN, type FormulaError } from './lexer.ts'
import { parse, type Node } from './parser.ts'
import { checkFormula } from './check.ts'
import { evaluateNode } from './evaluate.ts'
import type { FormulaEnv } from './functions.ts'
import type { FormulaType, FormulaValue } from './values.ts'

export type { FormulaError } from './lexer.ts'
export type { FormulaEnv } from './functions.ts'
export type { FormulaType, FormulaValue } from './values.ts'

/** 식 글자의 상한. */
export const MAX_FORMULA_LENGTH = 10_000

/** 수식이 보는 속성들 — 이름으로도 id 로도 찾는다. 수식에서 쓸 수 없는 속성(relation · rollup …)은 없는 것처럼 답한다. */
export type FormulaSchema = {
  readonly byName: (name: string) => { readonly id: string; readonly type: FormulaType } | null
  readonly byId: (id: string) => { readonly name: string; readonly type: FormulaType } | null
}

export type CompiledFormula = {
  /** 저장하는 식 — 속성 자리가 `⟦id⟧` 다. */
  readonly stored: string
  /** 묶인 나무(속성은 id). */
  readonly ast: Node
  readonly resultType: FormulaType
  /** 이 식이 읽는 속성 id(중복 없이 · 나온 순서). */
  readonly dependsOn: readonly string[]
}

export type CompileResult = { readonly ok: true; readonly value: CompiledFormula } | { readonly ok: false; readonly error: FormulaError }

/** 사람이 쓴 식(또는 저장된 식)을 읽는다. */
export function compileFormula(source: string, schema: FormulaSchema): CompileResult {
  if (source.trim() === '') return { ok: false, error: { message: '식이 비었습니다', start: 0, end: 0 } }
  if (source.length > MAX_FORMULA_LENGTH) {
    return { ok: false, error: { message: `식이 너무 깁니다(${MAX_FORMULA_LENGTH.toLocaleString('ko-KR')}자까지)`, start: MAX_FORMULA_LENGTH, end: source.length } }
  }
  const lexed = tokenize(source)
  if (!lexed.ok) return lexed
  const parsed = parse(lexed.tokens)
  if (!parsed.ok) return parsed

  // 이름 묶기 — prop("이름") → ⟦id⟧
  const rewrites: { start: number; end: number; id: string }[] = []
  let missing: FormulaError | null = null
  const bind = (n: Node): Node => {
    switch (n.kind) {
      case 'propName': {
        const found = schema.byName(n.name)
        if (found === null) {
          missing ??= { message: `속성 "${n.name}" 을(를) 찾지 못했습니다 — 이름이 정확한지, 수식에서 쓸 수 있는 속성인지 보세요`, start: n.start, end: n.end }
          return n
        }
        rewrites.push({ start: n.start, end: n.end, id: found.id })
        return { kind: 'prop', id: found.id, start: n.start, end: n.end }
      }
      case 'unary':
        return { ...n, arg: bind(n.arg) }
      case 'binary':
        return { ...n, left: bind(n.left), right: bind(n.right) }
      case 'ternary':
        return { ...n, cond: bind(n.cond), then: bind(n.then), else: bind(n.else) }
      case 'call':
        return { ...n, args: n.args.map(bind) }
      default:
        return n
    }
  }
  const ast = bind(parsed.node)
  if (missing !== null) return { ok: false, error: missing }

  const checked = checkFormula(ast, (id) => schema.byId(id)?.type ?? null)
  if (!checked.ok) return checked

  let stored = source
  for (const r of [...rewrites].sort((a, b) => b.start - a.start)) {
    stored = `${stored.slice(0, r.start)}${PROP_OPEN}${r.id}${PROP_CLOSE}${stored.slice(r.end)}`
  }
  const dependsOn: string[] = []
  const collect = (n: Node) => {
    switch (n.kind) {
      case 'prop':
        if (!dependsOn.includes(n.id)) dependsOn.push(n.id)
        return
      case 'unary':
        return collect(n.arg)
      case 'binary':
        collect(n.left)
        return collect(n.right)
      case 'ternary':
        collect(n.cond)
        collect(n.then)
        return collect(n.else)
      case 'call':
        return n.args.forEach(collect)
      default:
        return
    }
  }
  collect(ast)
  return { ok: true, value: { stored, ast, resultType: checked.type, dependsOn } }
}

/** 이름을 글 자리에 넣을 모양으로(`"` 와 `\` 를 탈출). */
const quote = (name: string) => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * 저장된 식을 사람이 읽는 모양으로 — `⟦id⟧` 를 지금 이름의 `prop("이름")` 으로. 지워진 속성은 `prop("(지워진 속성)")` 이다(다시 저장하면
 * 찾지 못했다고 말한다). 원문의 줄바꿈 · 주석 · 띄어쓰기는 그대로다.
 */
export function displayFormula(stored: string, nameOf: (id: string) => string | null): string {
  const lexed = tokenize(stored)
  if (!lexed.ok) return stored
  let out = stored
  for (const t of [...lexed.tokens].reverse()) {
    if (t.kind !== 'prop') continue
    out = `${out.slice(0, t.start)}prop(${quote(nameOf(t.text) ?? '(지워진 속성)')})${out.slice(t.end)}`
  }
  return out
}

/** 한 행에서 계산한다 — `prop` 은 그 행의 속성 값을 준다. 던지지 않는다. */
export function evaluateFormula(compiled: Pick<CompiledFormula, 'ast'>, prop: (id: string) => FormulaValue, env: FormulaEnv): FormulaValue {
  return evaluateNode(compiled.ast, prop, env)
}

/** 지금을 읽는 함수 — 이것을 부르는 식은 시간이 지나면 값이 바뀐다(캐시가 틀린다 · `derived-values.ts`). */
const CLOCK_FUNCTIONS: ReadonlySet<string> = new Set(['now', 'today'])

/** 이 나무가 지금(`now()` · `today()`)을 읽는가. 다른 수식을 거쳐 읽는 것은 부르는 쪽이 그래프로 본다. */
export function usesClock(node: Node): boolean {
  switch (node.kind) {
    case 'call':
      return CLOCK_FUNCTIONS.has(node.name) || node.args.some(usesClock)
    case 'unary':
      return usesClock(node.arg)
    case 'binary':
      return usesClock(node.left) || usesClock(node.right)
    case 'ternary':
      return usesClock(node.cond) || usesClock(node.then) || usesClock(node.else)
    default:
      return false
  }
}
