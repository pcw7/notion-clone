/**
 * 수식 — 문법 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 토큰을 나무(`Node`)로 엮는다. 우선순위가 낮은 것부터:
 *
 *   삼항     c ? a : b            (오른쪽부터 묶는다)
 *   또는     a or b · a || b
 *   그리고   a and b · a && b
 *   같음     == · !=
 *   비교     > >= < <=
 *   덧셈     + -
 *   곱셈     * / %
 *   앞       -a · not a · !a
 *   거듭     a ^ b                 (오른쪽부터 · 앞의 `-` 보다 세다 — `-2 ^ 2` 는 -4)
 *   뒤       f(a, b) · a.f(b)      (`a.f(b)` 는 `f(a, b)` 와 같다 — 03 *"dot notation"*)
 *
 * `prop("이름")` 은 이름 그대로 남긴다(`propName`) — 이름을 id 로 묶는 것은 스키마를 아는 `formula.ts` 의 일이다. 저장된 식의 `⟦id⟧`
 * 는 바로 `prop` 이다. 중첩 깊이는 `MAX_DEPTH` 까지 — 03 *"매우 긴 수식 — 파서 재귀 깊이 제한 필요"*.
 */

import type { FormulaError, Token } from './lexer.ts'

export type Span = { readonly start: number; readonly end: number }

export type Node = Span &
  (
    | { readonly kind: 'number'; readonly value: number }
    | { readonly kind: 'text'; readonly value: string }
    | { readonly kind: 'boolean'; readonly value: boolean }
    | { readonly kind: 'propName'; readonly name: string }
    | { readonly kind: 'prop'; readonly id: string }
    | { readonly kind: 'unary'; readonly op: '-' | 'not'; readonly arg: Node }
    | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Node; readonly right: Node }
    | { readonly kind: 'ternary'; readonly cond: Node; readonly then: Node; readonly else: Node }
    | { readonly kind: 'call'; readonly name: string; readonly args: readonly Node[] }
  )

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '>' | '>=' | '<' | '<=' | 'and' | 'or'

/** 중첩 깊이의 상한 — 괄호 · 호출 · 연산이 이만큼 겹치면 거부한다(재귀가 스택을 넘지 않게). */
export const MAX_DEPTH = 100

const INFIX: Readonly<Record<string, { op: BinaryOp; bp: number; right?: true }>> = {
  or: { op: 'or', bp: 2 },
  '||': { op: 'or', bp: 2 },
  and: { op: 'and', bp: 3 },
  '&&': { op: 'and', bp: 3 },
  '==': { op: '==', bp: 4 },
  '!=': { op: '!=', bp: 4 },
  '>': { op: '>', bp: 5 },
  '>=': { op: '>=', bp: 5 },
  '<': { op: '<', bp: 5 },
  '<=': { op: '<=', bp: 5 },
  '+': { op: '+', bp: 6 },
  '-': { op: '-', bp: 6 },
  '*': { op: '*', bp: 7 },
  '/': { op: '/', bp: 7 },
  '%': { op: '%', bp: 7 },
  '^': { op: '^', bp: 9, right: true },
}
const TERNARY_BP = 1
const PREFIX_BP = 8
const POSTFIX_BP = 10

class ParseFailure extends Error {
  readonly detail: FormulaError
  constructor(detail: FormulaError) {
    super(detail.message)
    this.detail = detail
  }
}

export function parse(tokens: readonly Token[]): { ok: true; node: Node } | { ok: false; error: FormulaError } {
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]!
  const next = () => tokens[pos++]!
  const fail = (message: string, at: Span): never => {
    throw new ParseFailure({ message, start: at.start, end: at.end })
  }
  const isOp = (t: Token, text: string) => (t.kind === 'op' || t.kind === 'name') && t.text === text
  const expect = (text: string, what: string) => {
    const t = peek()
    if (!isOp(t, text)) fail(`${what}이(가) 와야 합니다`, t)
    return next()
  }

  /** 함수 인자 — `(` 는 이미 읽었다. */
  const args = (): Node[] => {
    const out: Node[] = []
    if (isOp(peek(), ')')) {
      next()
      return out
    }
    for (;;) {
      out.push(expr(0))
      const t = next()
      if (isOp(t, ')')) return out
      if (!isOp(t, ',')) fail('인자 사이에는 `,` 가, 끝에는 `)` 가 와야 합니다', t)
    }
  }

  const prefix = (): Node => {
    const t = next()
    switch (t.kind) {
      case 'number': {
        const value = Number(t.text)
        if (!Number.isFinite(value)) fail('너무 큰 수입니다', t)
        return { kind: 'number', value, start: t.start, end: t.end }
      }
      case 'string':
        return { kind: 'text', value: t.text, start: t.start, end: t.end }
      case 'prop':
        return { kind: 'prop', id: t.text, start: t.start, end: t.end }
      case 'name': {
        if (t.text === 'true' || t.text === 'false') return { kind: 'boolean', value: t.text === 'true', start: t.start, end: t.end }
        if (t.text === 'not') {
          const arg = expr(PREFIX_BP)
          return { kind: 'unary', op: 'not', arg, start: t.start, end: arg.end }
        }
        // `and(a, b)` · `or(a, b)` 는 함수로 부른 것이다 — 뒤에 `(` 가 없을 때만 연산자 자리의 실수다
        if ((t.text === 'and' || t.text === 'or') && !isOp(peek(), '(')) fail(`\`${t.text}\` 앞에 값이 와야 합니다`, t)
        if (!isOp(peek(), '(')) fail(`\`${t.text}\` 는 함수입니다 — 뒤에 \`(\` 가 와야 합니다. 속성은 prop("이름") 으로 씁니다`, t)
        next()
        const list = args()
        const end = tokens[pos - 1]!.end
        // prop("이름") — 이름 그대로 남긴다(묶는 것은 `formula.ts`)
        if (t.text === 'prop') {
          const only = list[0]
          if (list.length !== 1 || only === undefined || only.kind !== 'text') fail('prop 에는 속성 이름 하나를 글로 줍니다 — prop("이름")', { start: t.start, end })
          return { kind: 'propName', name: (only as { value: string }).value, start: t.start, end }
        }
        return { kind: 'call', name: t.text, args: list, start: t.start, end }
      }
      case 'op': {
        if (t.text === '(') {
          const inner = expr(0)
          const close = expect(')', '`)`')
          return { ...inner, start: t.start, end: close.end }
        }
        if (t.text === '-') {
          const arg = expr(PREFIX_BP)
          // 수 글자 앞의 `-` 는 그 수로 접는다 — `-2 ^ 2` 의 우선순위는 그대로(거듭이 먼저 묶인다)
          return { kind: 'unary', op: '-', arg, start: t.start, end: arg.end }
        }
        if (t.text === '!') {
          const arg = expr(PREFIX_BP)
          return { kind: 'unary', op: 'not', arg, start: t.start, end: arg.end }
        }
        return fail(t.text === ')' ? '`(` 없이 `)` 가 왔습니다' : `\`${t.text}\` 앞에 값이 와야 합니다`, t)
      }
      case 'eof':
        return fail('식이 끝났는데 값이 와야 합니다', t)
    }
  }

  function expr(minBp: number): Node {
    depth += 1
    if (depth > MAX_DEPTH) fail(`식이 너무 깊게 겹쳤습니다(${MAX_DEPTH}단까지)`, peek())
    let left = prefix()
    for (;;) {
      const t = peek()
      // 뒤: a.f(b)
      if (isOp(t, '.') && POSTFIX_BP >= minBp) {
        next()
        const name = next()
        if (name.kind !== 'name') fail('`.` 뒤에는 함수 이름이 와야 합니다', name)
        if (!isOp(peek(), '(')) fail(`\`.${name.text}\` 뒤에 \`(\` 가 와야 합니다`, peek())
        next()
        const rest = args()
        left = { kind: 'call', name: name.text, args: [left, ...rest], start: left.start, end: tokens[pos - 1]!.end }
        continue
      }
      // 삼항
      if (isOp(t, '?') && TERNARY_BP >= minBp) {
        next()
        const then = expr(0)
        expect(':', '삼항의 `:`')
        const otherwise = expr(TERNARY_BP)
        left = { kind: 'ternary', cond: left, then, else: otherwise, start: left.start, end: otherwise.end }
        continue
      }
      const info = (t.kind === 'op' || t.kind === 'name') ? INFIX[t.text] : undefined
      if (info === undefined || info.bp < minBp) break
      next()
      const right = expr(info.right ? info.bp : info.bp + 1)
      left = { kind: 'binary', op: info.op, left, right, start: left.start, end: right.end }
    }
    depth -= 1
    return left
  }

  try {
    const node = expr(0)
    const rest = peek()
    if (rest.kind !== 'eof') fail(`식이 끝나야 하는 자리에 \`${rest.text}\` 가 있습니다`, rest)
    return { ok: true, node }
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, error: e.detail }
    throw e
  }
}
