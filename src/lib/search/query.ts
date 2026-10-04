/**
 * 검색 쿼리 파서 — 잔여 묶음 8l-1 (F-07-02 · 순수 · DOM 없음)
 *
 * 정본: 07-search-navigation.md F-07-02 *"따옴표 구문 검색 — 공식 지원 확인됨 … 쿼리 파서에 phrase 연산자가 필수다. Postgres
 *       `websearch_to_tsquery` 가 따옴표 구문/OR/`-`(NOT)을 그대로 지원 … 불리언 `OR` / `-`(제외) — 클론은 어차피 따라오므로 스펙에 넣어도
 *       비용이 0"*
 *
 * 라틴 축은 `websearch_to_tsquery` 가 이 문법을 그대로 안다. **CJK 축(pg_bigm · LIKE)은 모른다** — W7 은 쿼리 전체를 부분 문자열 하나로
 * 찾아, "회의록 2024" 가 붙어 있는 문서만 걸렸다. 같은 문법을 두 축이 같은 뜻으로 읽게, 여기서 한 번 풀어 둔다.
 *
 *   · 공백으로 나뉜 말은 모두 있어야 한다(AND) — 순서 · 거리는 묻지 않는다
 *   · `"…"` 는 구절 — 그 문자열 그대로(붙어서) 있어야 한다. 닫는 따옴표가 없으면 끝까지가 구절이다
 *   · `OR`(대문자 · 앞뒤에 말이 있을 때)는 바로 앞뒤의 말을 대안으로 묶는다 — `a OR b c` 는 (a 또는 b) 그리고 c
 *   · `-말` · `-"구절"` 은 제외 — 그 말이 있는 문서는 빠진다
 *   · 연산자만 남은 조각(`-` · `OR` 홀로 · 빈 따옴표)은 버린다
 *
 * 화면의 강조(`highlight.ts`)도 이것을 쓴다 — 서버가 찾은 것과 화면이 칠하는 것이 같은 말이다.
 */

export type ParsedQuery = {
  /** 모두 만족해야 하는 절 — 절마다 대안 중 하나가 있으면 된다(대안이 하나면 그 말). */
  readonly clauses: readonly (readonly string[])[]
  /** 있으면 안 되는 말 · 구절. */
  readonly exclude: readonly string[]
}

type Token = { readonly text: string; readonly negated: boolean; readonly operator: boolean }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    let negated = false
    if (ch === '-' && i + 1 < input.length && !/\s/.test(input[i + 1]!)) {
      negated = true
      i += 1
    }
    if (input[i] === '"') {
      const close = input.indexOf('"', i + 1)
      const end = close === -1 ? input.length : close
      const phrase = input.slice(i + 1, end).replace(/\s+/g, ' ').trim()
      if (phrase !== '') tokens.push({ text: phrase, negated, operator: false })
      i = close === -1 ? input.length : close + 1
      continue
    }
    let j = i
    while (j < input.length && !/\s/.test(input[j]!) && input[j] !== '"') j += 1
    const word = input.slice(i, j)
    i = j
    if (word === '' || word === '-') continue
    tokens.push({ text: word, negated, operator: !negated && word === 'OR' })
  }
  return tokens
}

export function parseQuery(input: string): ParsedQuery {
  const tokens = tokenize(input)
  const clauses: string[][] = []
  const exclude: string[] = []
  let joinNext = false
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k]!
    if (token.operator) {
      // 앞에 묶을 절이 있고 뒤에 긍정의 말이 있을 때만 연산자다 — 아니면 버린다.
      const next = tokens[k + 1]
      joinNext = clauses.length > 0 && next !== undefined && !next.operator && !next.negated
      continue
    }
    if (token.negated) {
      if (!exclude.includes(token.text)) exclude.push(token.text)
      joinNext = false
      continue
    }
    if (joinNext) clauses[clauses.length - 1]!.push(token.text)
    else clauses.push([token.text])
    joinNext = false
  }
  return { clauses: clauses.map((alternatives) => [...new Set(alternatives)]), exclude }
}

/** 찾는(제외가 아닌) 말 전부 — 강조 · 스니펫의 닻 · 최소 길이가 쓴다. 긴 것부터. */
export function positiveTerms(parsed: ParsedQuery): string[] {
  return [...new Set(parsed.clauses.flat())].sort((a, b) => b.length - a.length)
}

/** 스니펫을 자를 자리 — 첫 절의 첫 말(사용자가 처음 적은 말). 없으면 null. */
export function snippetAnchor(parsed: ParsedQuery): string | null {
  return parsed.clauses[0]?.[0] ?? null
}

/**
 * 제목이 **정확히** 같아야 할 말 — 대안 · 제외가 없는 쿼리의 말을 공백 하나로 이은 것("주간 보고" · `"주간 보고"` 둘 다). 대안이나 제외가
 * 있으면 "정확히"가 뜻이 없다 — null.
 */
export function exactTitleTarget(parsed: ParsedQuery): string | null {
  if (parsed.exclude.length > 0 || parsed.clauses.some((c) => c.length !== 1)) return null
  const text = parsed.clauses.map((c) => c[0]).join(' ').trim()
  return text === '' ? null : text
}
