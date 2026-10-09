/**
 * 수식 — 타입 검사 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 저장하기 전에 식 전체의 타입을 정한다 — 결과 타입은 수식 속성의 `result_type` 이 되고, 틀린 식은 **위치와 함께** 거부한다(03 *"타입
 * 불일치(`"a" + 1`) → 편집기에서 컴파일 에러로 차단"* · *"Wrong return type — 정적 타입 추론 결과를 소비처와 계약으로"*).
 *
 *   + 는 수끼리(더하기) 또는 글끼리(잇기)   · 나머지 산술은 수끼리
 *   == != 는 같은 타입끼리                   · > >= < <= 는 같은 타입의 수 · 글 · 날짜
 *   and or not 은 참거짓                     · 삼항 · if 는 조건이 참거짓이고 두 값의 타입이 같다
 *
 * 빈 값은 타입이 아니다 — 모든 값이 비어 있을 수 있고, 계산기가 빈 값을 흘린다(`evaluate.ts`).
 */

import type { FormulaError } from './lexer.ts'
import { functionNamed } from './functions.ts'
import type { Node } from './parser.ts'
import { TYPE_LABEL, type FormulaType } from './values.ts'

class CheckFailure extends Error {
  readonly detail: FormulaError
  constructor(detail: FormulaError) {
    super(detail.message)
    this.detail = detail
  }
}

const label = (t: FormulaType) => TYPE_LABEL[t]

/** 식의 타입. 속성의 타입은 `propType` 이 준다(없으면 지워진 속성). */
export function checkFormula(
  node: Node,
  propType: (id: string) => FormulaType | null,
): { ok: true; type: FormulaType } | { ok: false; error: FormulaError } {
  const fail = (message: string, at: Node): never => {
    throw new CheckFailure({ message, start: at.start, end: at.end })
  }

  const typeOf = (n: Node): FormulaType => {
    switch (n.kind) {
      case 'number':
        return 'number'
      case 'text':
        return 'text'
      case 'boolean':
        return 'boolean'
      case 'propName':
        return fail(`속성 "${n.name}" 을(를) 찾지 못했습니다`, n)
      case 'prop': {
        const t = propType(n.id)
        return t === null ? fail('지워졌거나 수식에서 쓸 수 없는 속성입니다', n) : t
      }
      case 'unary': {
        const t = typeOf(n.arg)
        if (n.op === '-') return t === 'number' ? 'number' : fail(`\`-\` 는 수에만 붙습니다(${label(t)})`, n)
        return t === 'boolean' ? 'boolean' : fail(`not 은 참거짓에만 붙습니다(${label(t)})`, n)
      }
      case 'binary': {
        const l = typeOf(n.left)
        const r = typeOf(n.right)
        switch (n.op) {
          case '+':
            if (l === 'number' && r === 'number') return 'number'
            if (l === 'text' && r === 'text') return 'text'
            return fail(`\`+\` 는 수끼리 더하거나 글끼리 잇습니다(${label(l)} + ${label(r)}) — 글로 바꾸려면 format()`, n)
          case '-':
          case '*':
          case '/':
          case '%':
          case '^':
            return l === 'number' && r === 'number' ? 'number' : fail(`\`${n.op}\` 는 수끼리입니다(${label(l)} ${n.op} ${label(r)})`, n)
          case '==':
          case '!=':
            return l === r ? 'boolean' : fail(`같은 타입끼리 비교합니다(${label(l)} ${n.op} ${label(r)})`, n)
          case '>':
          case '>=':
          case '<':
          case '<=':
            if (l !== r) return fail(`같은 타입끼리 비교합니다(${label(l)} ${n.op} ${label(r)})`, n)
            return l === 'boolean' ? fail('참거짓은 크기를 비교하지 않습니다', n) : 'boolean'
          case 'and':
          case 'or':
            return l === 'boolean' && r === 'boolean' ? 'boolean' : fail(`${n.op} 는 참거짓끼리입니다(${label(l)} · ${label(r)})`, n)
        }
        return fail('모르는 연산입니다', n)
      }
      case 'ternary': {
        const c = typeOf(n.cond)
        if (c !== 'boolean') fail(`\`?\` 앞의 조건은 참거짓이어야 합니다(${label(c)})`, n.cond)
        const a = typeOf(n.then)
        const b = typeOf(n.else)
        return a === b ? a : fail(`\`:\` 양쪽의 타입이 같아야 합니다(${label(a)} · ${label(b)})`, n)
      }
      case 'call': {
        const spec = functionNamed(n.name)
        if (spec === undefined) return fail(`모르는 함수입니다: ${n.name}`, n)
        if (n.args.length < spec.min || n.args.length > spec.max) {
          const want = spec.min === spec.max ? `${spec.min}개` : spec.max === Infinity ? `${spec.min}개 이상` : `${spec.min} ~ ${spec.max}개`
          return fail(`${n.name} 의 인자는 ${want}입니다(${n.args.length}개를 받았습니다)`, n)
        }
        const result = spec.type(n.args.map(typeOf))
        return typeof result === 'string' ? result : fail(`${n.name}: ${result.error}`, n)
      }
    }
  }

  try {
    return { ok: true, type: typeOf(node) }
  } catch (e) {
    if (e instanceof CheckFailure) return { ok: false, error: e.detail }
    throw e
  }
}
