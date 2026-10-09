/**
 * 수식 — 계산기 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 타입 검사를 지난 나무를 걸으며 값을 낸다. **`eval` · `Function` 을 쓰지 않는다**(마스터 문서) — 나무의 갈래마다 정해진 일을 한다.
 *
 *   빈 값은 흐른다 — 산술 · 글 함수에 빈 값이 들어가면 빈 값(03 *"0 이 아니라 null 전파"*)
 *   0 으로 나누기 · 나머지는 빈 값 — 무한대를 칸에 그리지 않는다
 *   크기 비교에 빈 값이 끼면 거짓 · 같음은 빈 값끼리만 참
 *   조건 자리(if · ifs · 삼항 · and · or · not)의 빈 값은 거짓 — 필요한 쪽만 계산한다
 *
 * 계산은 **던지지 않는다** — 예상하지 못한 것이 나와도 그 칸은 빈 값이다(행 하나의 수식이 표 전체를 멈추지 않게).
 */

import { functionNamed, type FormulaEnv } from './functions.ts'
import type { Node } from './parser.ts'
import { bool, compareValues, MAX_TEXT_LENGTH, num, sameValue, text, truthy, type FormulaValue } from './values.ts'

export function evaluateNode(node: Node, prop: (id: string) => FormulaValue, env: FormulaEnv): FormulaValue {
  const ev = (n: Node): FormulaValue => {
    switch (n.kind) {
      case 'number':
        return num(n.value)
      case 'text':
        return text(n.value)
      case 'boolean':
        return bool(n.value)
      case 'prop':
        return prop(n.id)
      case 'propName':
        return null
      case 'unary': {
        const v = ev(n.arg)
        if (n.op === '-') return v !== null && v.type === 'number' ? num(-v.value) : null
        return bool(!truthy(v))
      }
      case 'ternary':
        return truthy(ev(n.cond)) ? ev(n.then) : ev(n.else)
      case 'binary': {
        if (n.op === 'and') return bool(truthy(ev(n.left)) && truthy(ev(n.right)))
        if (n.op === 'or') return bool(truthy(ev(n.left)) || truthy(ev(n.right)))
        const l = ev(n.left)
        const r = ev(n.right)
        switch (n.op) {
          case '==':
            return bool(sameValue(l, r))
          case '!=':
            return bool(!sameValue(l, r))
          case '>':
          case '>=':
          case '<':
          case '<=': {
            const c = compareValues(l, r)
            if (c === null) return bool(false)
            return bool(n.op === '>' ? c > 0 : n.op === '>=' ? c >= 0 : n.op === '<' ? c < 0 : c <= 0)
          }
        }
        if (l === null || r === null) return null
        if (n.op === '+' && l.type === 'text' && r.type === 'text') {
          const joined = l.value + r.value
          return text(joined.length > MAX_TEXT_LENGTH ? joined.slice(0, MAX_TEXT_LENGTH) : joined)
        }
        if (l.type !== 'number' || r.type !== 'number') return null
        switch (n.op) {
          case '+':
            return num(l.value + r.value)
          case '-':
            return num(l.value - r.value)
          case '*':
            return num(l.value * r.value)
          case '/':
            return r.value === 0 ? null : num(l.value / r.value)
          case '%':
            return r.value === 0 ? null : num(l.value % r.value)
          case '^':
            return num(l.value ** r.value)
        }
        return null
      }
      case 'call': {
        const spec = functionNamed(n.name)
        if (spec === undefined) return null
        if (spec.lazy) {
          switch (n.name) {
            case 'if':
              return truthy(ev(n.args[0]!)) ? ev(n.args[1]!) : ev(n.args[2]!)
            case 'ifs': {
              for (let i = 0; i + 1 < n.args.length; i += 2) if (truthy(ev(n.args[i]!))) return ev(n.args[i + 1]!)
              return ev(n.args[n.args.length - 1]!)
            }
            case 'and':
              return bool(n.args.every((a) => truthy(ev(a))))
            case 'or':
              return bool(n.args.some((a) => truthy(ev(a))))
          }
          return null
        }
        return spec.impl ? spec.impl(n.args.map(ev), env) : null
      }
    }
  }
  try {
    return ev(node)
  } catch {
    return null
  }
}
