/**
 * 수식 — 토큰 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 정본: 03-database-core.md F-03-12 · 마스터 문서 §5.3 2번 트랙 *"formula 는 3단계 점진 도입 … `eval` · `Function` 생성 절대 금지"*
 *
 * 글자를 한 번 훑어 토큰으로 자른다. 토큰마다 **원문의 위치**(`start` · `end`)를 단다 — 03 *"파서 에러를 위치(offset)와 함께 반환"*.
 *
 *   수       12 · 3.5 · .5 · 1e3
 *   글       "…" — `\"` · `\\` · `\n` · `\t` 만 탈출로 읽는다
 *   이름     함수 이름 · `true` · `false` · `not` · `and` · `or`(한글 이름은 함수가 아니라 `prop("…")` 로 쓴다)
 *   속성     `⟦id⟧` — 저장된 식에서 `prop("이름")` 자리에 들어가는 속성 id(이름을 바꿔도 깨지지 않게 · `formula.ts` 머리말)
 *   기호     + - * / % ^ ( ) , . ? : == != > >= < <= && || !
 *   주석     `/* … *\/` 와 `// …` — 건너뛴다
 */

export type TokenKind = 'number' | 'string' | 'name' | 'prop' | 'op' | 'eof'

export type Token = {
  readonly kind: TokenKind
  /** 수는 원문 그대로 · 글은 탈출을 푼 값 · 속성은 id. */
  readonly text: string
  readonly start: number
  readonly end: number
}

export type FormulaError = { readonly message: string; readonly start: number; readonly end: number }

/** 저장된 식의 속성 자리 표시. 사람이 치지 않을 글자로 감싼다. */
export const PROP_OPEN = '⟦'
export const PROP_CLOSE = '⟧'

const TWO_CHAR = new Set(['==', '!=', '>=', '<=', '&&', '||'])
const ONE_CHAR = new Set(['+', '-', '*', '/', '%', '^', '(', ')', ',', '.', '?', ':', '>', '<', '!'])

const isDigit = (c: string) => c >= '0' && c <= '9'
const isNameStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
const isNamePart = (c: string) => isNameStart(c) || isDigit(c)

export function tokenize(source: string): { ok: true; tokens: Token[] } | { ok: false; error: FormulaError } {
  const tokens: Token[] = []
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]!
    // 공백 · 줄바꿈
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1
      continue
    }
    // 주석
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      if (close === -1) return { ok: false, error: { message: '주석이 닫히지 않았습니다(`*/`)', start: i, end: n } }
      i = close + 2
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const line = source.indexOf('\n', i + 2)
      i = line === -1 ? n : line + 1
      continue
    }
    // 수
    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i
      while (i < n && isDigit(source[i]!)) i += 1
      if (source[i] === '.') {
        i += 1
        while (i < n && isDigit(source[i]!)) i += 1
      }
      if ((source[i] === 'e' || source[i] === 'E') && (isDigit(source[i + 1] ?? '') || ((source[i + 1] === '+' || source[i + 1] === '-') && isDigit(source[i + 2] ?? '')))) {
        i += 2
        while (i < n && isDigit(source[i]!)) i += 1
      }
      tokens.push({ kind: 'number', text: source.slice(start, i), start, end: i })
      continue
    }
    // 글
    if (c === '"') {
      const start = i
      i += 1
      let out = ''
      for (;;) {
        if (i >= n) return { ok: false, error: { message: '글이 닫히지 않았습니다(`"`)', start, end: n } }
        const d = source[i]!
        if (d === '"') {
          i += 1
          break
        }
        if (d === '\\') {
          const e = source[i + 1]
          if (e === '"' || e === '\\') out += e
          else if (e === 'n') out += '\n'
          else if (e === 't') out += '\t'
          else return { ok: false, error: { message: `모르는 탈출 문자입니다(\\${e ?? ''})`, start: i, end: Math.min(i + 2, n) } }
          i += 2
          continue
        }
        out += d
        i += 1
      }
      tokens.push({ kind: 'string', text: out, start, end: i })
      continue
    }
    // 속성 자리(저장된 식)
    if (c === PROP_OPEN) {
      const close = source.indexOf(PROP_CLOSE, i + 1)
      if (close === -1) return { ok: false, error: { message: '속성 자리가 닫히지 않았습니다', start: i, end: n } }
      tokens.push({ kind: 'prop', text: source.slice(i + 1, close), start: i, end: close + 1 })
      i = close + 1
      continue
    }
    // 이름
    if (isNameStart(c)) {
      const start = i
      while (i < n && isNamePart(source[i]!)) i += 1
      tokens.push({ kind: 'name', text: source.slice(start, i), start, end: i })
      continue
    }
    // 기호
    const two = source.slice(i, i + 2)
    if (TWO_CHAR.has(two)) {
      tokens.push({ kind: 'op', text: two, start: i, end: i + 2 })
      i += 2
      continue
    }
    if (ONE_CHAR.has(c)) {
      tokens.push({ kind: 'op', text: c, start: i, end: i + 1 })
      i += 1
      continue
    }
    if (c === '=') return { ok: false, error: { message: '같음은 `==` 입니다', start: i, end: i + 1 } }
    return { ok: false, error: { message: `읽을 수 없는 글자입니다(${c})`, start: i, end: i + 1 } }
  }
  tokens.push({ kind: 'eof', text: '', start: n, end: n })
  return { ok: true, tokens }
}
