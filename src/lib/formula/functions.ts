/**
 * 수식 — 함수 표 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 함수마다 **인자 수 · 타입 규칙 · 계산**을 한 자리에 둔다. 타입 규칙은 인자의 타입들을 받아 결과 타입을 주거나, 틀렸으면 사람이 읽을
 * 이유를 준다 — 편집기가 저장 전에 막는다(03 *"타입 불일치 → 편집기에서 컴파일 에러로 차단"*). 계산은 인자 값들을 받아 값을 준다 —
 * **던지지 않는다**(틀린 입력은 빈 값). `if` · `ifs` · `and` · `or` 는 필요한 인자만 계산하므로(`lazy`) 계산기가 따로 다룬다.
 *
 * 1단계(최소 언어)의 범위다 — 03 의 목록 중 글 · 수 · 참거짓 · 날짜를 다루는 것. 정규식(`test` · `match` · `replace`) · 목록(`map` ·
 * `filter` …) · 사람 · 페이지 · `let` 은 다음 단계다(§7). 이름은 노션과 같다(같은 식이 같은 뜻이게).
 */

import {
  bool,
  compareValues,
  date,
  DATE_UNITS,
  dateDiff,
  dateMillis,
  dateParts,
  formatValue,
  MAX_TEXT_LENGTH,
  num,
  sameValue,
  shiftDate,
  text,
  ymd,
  type DateUnit,
  type FormulaType,
  type FormulaValue,
  TYPE_LABEL,
} from './values.ts'

/** 계산이 쓰는 바깥 — 지금(`now()` · `today()`). 결정적이지 않은 값은 이것 하나다. */
export type FormulaEnv = { readonly now: Date }

export type FnSpec = {
  readonly name: string
  readonly category: '논리' | '글' | '수' | '날짜' | '변환'
  /** 편집기의 한 줄 설명. */
  readonly description: string
  readonly min: number
  readonly max: number
  /** 결과 타입 — 틀렸으면 이유(글). */
  readonly type: (args: readonly FormulaType[]) => FormulaType | { readonly error: string }
  /** 값 계산. `lazy` 면 없다(계산기가 다룬다). */
  readonly impl?: (args: readonly FormulaValue[], env: FormulaEnv) => FormulaValue
  readonly lazy?: true
}

const err = (error: string) => ({ error })
const label = (t: FormulaType) => TYPE_LABEL[t]

/** 모든 인자가 이 타입이어야 한다. */
const all =
  (want: FormulaType, result: FormulaType) =>
  (args: readonly FormulaType[]) => {
    const bad = args.findIndex((t) => t !== want)
    return bad === -1 ? result : err(`${bad + 1}번째 인자는 ${label(want)}여야 합니다(${label(args[bad]!)}를 받았습니다)`)
  }

/** 자리마다 타입이 정해져 있다. */
const shape =
  (wants: readonly FormulaType[], result: FormulaType) =>
  (args: readonly FormulaType[]) => {
    const bad = args.findIndex((t, i) => t !== wants[i])
    return bad === -1 ? result : err(`${bad + 1}번째 인자는 ${label(wants[bad]!)}여야 합니다(${label(args[bad]!)}를 받았습니다)`)
  }

const n = (v: FormulaValue): number | null => (v !== null && v.type === 'number' ? v.value : null)
const s = (v: FormulaValue): string | null => (v !== null && v.type === 'text' ? v.value : null)
const capText = (value: string): FormulaValue => text(value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value)

/** 수 하나 → 수 하나. 빈 값은 빈 값. */
const math1 = (name: string, description: string, f: (x: number) => number): FnSpec => ({
  name,
  category: '수',
  description,
  min: 1,
  max: 1,
  type: all('number', 'number'),
  impl: ([a]) => {
    const x = n(a ?? null)
    return x === null ? null : num(f(x))
  },
})

/** 수 둘 → 수. */
const math2 = (name: string, description: string, f: (x: number, y: number) => number | null): FnSpec => ({
  name,
  category: '수',
  description,
  min: 2,
  max: 2,
  type: all('number', 'number'),
  impl: ([a, b]) => {
    const x = n(a ?? null)
    const y = n(b ?? null)
    if (x === null || y === null) return null
    const r = f(x, y)
    return r === null ? null : num(r)
  },
})

/** 수 여럿 → 수(빈 값은 건너뛴다 — 하나도 없으면 빈 값). */
const mathN = (name: string, description: string, f: (xs: number[]) => number): FnSpec => ({
  name,
  category: '수',
  description,
  min: 1,
  max: Infinity,
  type: all('number', 'number'),
  impl: (args) => {
    const xs = args.map(n).filter((x): x is number => x !== null)
    return xs.length === 0 ? null : num(f(xs))
  },
})

/** 글 하나 → 글. */
const text1 = (name: string, description: string, f: (x: string) => string): FnSpec => ({
  name,
  category: '글',
  description,
  min: 1,
  max: 1,
  type: all('text', 'text'),
  impl: ([a]) => {
    const x = s(a ?? null)
    return x === null ? null : capText(f(x))
  },
})

/** 날짜 하나 → 그 날짜 글자의 한 부분(수). */
const datePart = (name: string, description: string, pick: (p: NonNullable<ReturnType<typeof dateParts>>) => number): FnSpec => ({
  name,
  category: '날짜',
  description,
  min: 1,
  max: 1,
  type: all('date', 'number'),
  impl: ([a]) => {
    if (a === null || a === undefined || a.type !== 'date') return null
    const p = dateParts(a.value.start)
    return p === null ? null : num(pick(p))
  },
})

const isUnit = (u: string): u is DateUnit => (DATE_UNITS as readonly string[]).includes(u)

/** 날짜 · 수 · 단위(글) → 날짜. `sign` 은 더하기(1)인지 빼기(-1)인지. */
const dateShift = (name: string, description: string, sign: 1 | -1): FnSpec => ({
  name,
  category: '날짜',
  description,
  min: 3,
  max: 3,
  type: shape(['date', 'number', 'text'], 'date'),
  impl: ([d, amount, unit]) => {
    const x = n(amount ?? null)
    const u = s(unit ?? null)
    if (d === null || d === undefined || d.type !== 'date' || x === null || u === null || !isUnit(u)) return null
    const start = shiftDate(d.value.start, sign * x, u)
    if (start === null) return null
    const end = d.value.end === undefined ? undefined : shiftDate(d.value.end, sign * x, u)
    return date(end === undefined || end === null ? { start } : { start, end })
  },
})

const sameTypes = (args: readonly FormulaType[]) =>
  args.every((t) => t === args[0]) ? null : err(`비교하는 두 값의 타입이 같아야 합니다(${args.map(label).join(' · ')})`)

export const FUNCTIONS: readonly FnSpec[] = [
  // ── 논리 ──
  {
    name: 'if',
    category: '논리',
    description: 'if(조건, 참일 때, 거짓일 때) — 두 값의 타입이 같아야 합니다',
    min: 3,
    max: 3,
    lazy: true,
    type: ([c, a, b]) =>
      c !== 'boolean' ? err(`조건은 참거짓이어야 합니다(${label(c!)}를 받았습니다)`) : a !== b ? err(`두 값의 타입이 같아야 합니다(${label(a!)} · ${label(b!)})`) : a!,
  },
  {
    name: 'ifs',
    category: '논리',
    description: 'ifs(조건1, 값1, 조건2, 값2, …, 그밖의 값)',
    min: 3,
    max: Infinity,
    lazy: true,
    type: (args) => {
      if (args.length % 2 === 0) return err('조건과 값을 짝으로 주고 끝에 그밖의 값을 줍니다(인자 수는 홀수)')
      const result = args[args.length - 1]!
      for (let i = 0; i < args.length - 1; i += 2) {
        if (args[i] !== 'boolean') return err(`${i + 1}번째 인자(조건)는 참거짓이어야 합니다`)
        if (args[i + 1] !== result) return err(`모든 값의 타입이 같아야 합니다(${label(args[i + 1]!)} · ${label(result)})`)
      }
      return result
    },
  },
  { name: 'and', category: '논리', description: 'and(a, b, …) — 모두 참인가', min: 2, max: Infinity, lazy: true, type: all('boolean', 'boolean') },
  { name: 'or', category: '논리', description: 'or(a, b, …) — 하나라도 참인가', min: 2, max: Infinity, lazy: true, type: all('boolean', 'boolean') },
  {
    name: 'not',
    category: '논리',
    description: 'not(a) — 참거짓을 뒤집는다(빈 값은 거짓으로 읽는다)',
    min: 1,
    max: 1,
    type: all('boolean', 'boolean'),
    impl: ([a]) => bool(!(a !== null && a !== undefined && a.type === 'boolean' && a.value)),
  },
  {
    name: 'empty',
    category: '논리',
    description: 'empty(값) — 비었는가(빈 값 · 빈 글 · 0 · 거짓)',
    min: 1,
    max: 1,
    type: () => 'boolean',
    impl: ([a]) =>
      bool(a === null || a === undefined || (a.type === 'text' && a.value === '') || (a.type === 'number' && a.value === 0) || (a.type === 'boolean' && !a.value)),
  },
  {
    name: 'equal',
    category: '논리',
    description: 'equal(a, b) — 같은가(`==` 와 같다)',
    min: 2,
    max: 2,
    type: (args) => sameTypes(args) ?? 'boolean',
    impl: ([a, b]) => bool(sameValue(a ?? null, b ?? null)),
  },
  {
    name: 'unequal',
    category: '논리',
    description: 'unequal(a, b) — 다른가(`!=` 와 같다)',
    min: 2,
    max: 2,
    type: (args) => sameTypes(args) ?? 'boolean',
    impl: ([a, b]) => bool(!sameValue(a ?? null, b ?? null)),
  },

  // ── 글 ──
  {
    name: 'length',
    category: '글',
    description: 'length(글) — 글자 수',
    min: 1,
    max: 1,
    type: all('text', 'number'),
    impl: ([a]) => {
      const x = s(a ?? null)
      return x === null ? null : num([...x].length)
    },
  },
  text1('lower', 'lower(글) — 소문자로', (x) => x.toLowerCase()),
  text1('upper', 'upper(글) — 대문자로', (x) => x.toUpperCase()),
  text1('trim', 'trim(글) — 앞뒤 공백을 지운다', (x) => x.trim()),
  {
    name: 'contains',
    category: '글',
    description: 'contains(글, 찾을 글) — 들어 있는가(대소문자를 가린다)',
    min: 2,
    max: 2,
    type: all('text', 'boolean'),
    impl: ([a, b]) => {
      const x = s(a ?? null)
      const y = s(b ?? null)
      return x === null || y === null ? null : bool(x.includes(y))
    },
  },
  {
    name: 'substring',
    category: '글',
    description: 'substring(글, 시작, 끝?) — 0 부터 센 자리로 자른다',
    min: 2,
    max: 3,
    type: shape(['text', 'number', 'number'], 'text'),
    impl: ([a, b, c]) => {
      const x = s(a ?? null)
      const from = n(b ?? null)
      if (x === null || from === null) return null
      const chars = [...x]
      const to = c === undefined ? chars.length : n(c)
      return to === null ? null : text(chars.slice(Math.max(0, Math.trunc(from)), Math.max(0, Math.trunc(to))).join(''))
    },
  },
  {
    name: 'repeat',
    category: '글',
    description: 'repeat(글, 횟수) — 이어 붙인다',
    min: 2,
    max: 2,
    type: shape(['text', 'number'], 'text'),
    impl: ([a, b]) => {
      const x = s(a ?? null)
      const times = n(b ?? null)
      if (x === null || times === null || times < 0) return null
      const count = Math.min(Math.trunc(times), x.length === 0 ? 0 : Math.ceil(MAX_TEXT_LENGTH / x.length))
      return capText(x.repeat(count))
    },
  },

  // ── 수 ──
  math2('add', 'add(a, b) — 더한다', (x, y) => x + y),
  math2('subtract', 'subtract(a, b) — 뺀다', (x, y) => x - y),
  math2('multiply', 'multiply(a, b) — 곱한다', (x, y) => x * y),
  math2('divide', 'divide(a, b) — 나눈다(0 으로 나누면 빈 값)', (x, y) => (y === 0 ? null : x / y)),
  math2('mod', 'mod(a, b) — 나머지(0 으로 나누면 빈 값)', (x, y) => (y === 0 ? null : x % y)),
  math2('pow', 'pow(a, b) — 거듭제곱', (x, y) => x ** y),
  math1('abs', 'abs(수) — 절댓값', Math.abs),
  math1('ceil', 'ceil(수) — 올림', Math.ceil),
  math1('floor', 'floor(수) — 내림', Math.floor),
  math1('sqrt', 'sqrt(수) — 제곱근(음수면 빈 값)', Math.sqrt),
  math1('cbrt', 'cbrt(수) — 세제곱근', Math.cbrt),
  math1('exp', 'exp(수) — e 의 거듭제곱', Math.exp),
  math1('ln', 'ln(수) — 자연로그', Math.log),
  math1('log10', 'log10(수) — 상용로그', Math.log10),
  math1('log2', 'log2(수) — 이진로그', Math.log2),
  math1('sign', 'sign(수) — 부호(-1 · 0 · 1)', Math.sign),
  {
    name: 'round',
    category: '수',
    description: 'round(수, 자릿수?) — 반올림',
    min: 1,
    max: 2,
    type: all('number', 'number'),
    impl: ([a, b]) => {
      const x = n(a ?? null)
      const places = b === undefined ? 0 : n(b)
      if (x === null || places === null) return null
      const f = 10 ** Math.max(0, Math.min(10, Math.trunc(places)))
      return num(Math.round(x * f) / f)
    },
  },
  mathN('min', 'min(a, b, …) — 가장 작은 수', (xs) => Math.min(...xs)),
  mathN('max', 'max(a, b, …) — 가장 큰 수', (xs) => Math.max(...xs)),
  mathN('sum', 'sum(a, b, …) — 합', (xs) => xs.reduce((t, x) => t + x, 0)),
  mathN('mean', 'mean(a, b, …) — 평균', (xs) => xs.reduce((t, x) => t + x, 0) / xs.length),
  { name: 'pi', category: '수', description: 'pi() — 원주율', min: 0, max: 0, type: () => 'number', impl: () => num(Math.PI) },
  { name: 'e', category: '수', description: 'e() — 자연상수', min: 0, max: 0, type: () => 'number', impl: () => num(Math.E) },

  // ── 날짜 ──
  {
    name: 'now',
    category: '날짜',
    description: 'now() — 지금(시각까지)',
    min: 0,
    max: 0,
    type: () => 'date',
    impl: (_args, env) => date({ start: env.now.toISOString() }),
  },
  {
    name: 'today',
    category: '날짜',
    description: 'today() — 오늘(날짜만 · UTC)',
    min: 0,
    max: 0,
    type: () => 'date',
    impl: (_args, env) => date({ start: env.now.toISOString().slice(0, 10) }),
  },
  datePart('year', 'year(날짜) — 해', (p) => p.year),
  datePart('month', 'month(날짜) — 달(1 ~ 12)', (p) => p.month),
  datePart('date', 'date(날짜) — 날(1 ~ 31)', (p) => p.day),
  datePart('hour', 'hour(날짜) — 시(0 ~ 23)', (p) => p.hour),
  datePart('minute', 'minute(날짜) — 분(0 ~ 59)', (p) => p.minute),
  dateShift('dateAdd', 'dateAdd(날짜, 수, "days") — 단위: years · quarters · months · weeks · days · hours · minutes', 1),
  dateShift('dateSubtract', 'dateSubtract(날짜, 수, "days") — 뺀다', -1),
  {
    name: 'dateBetween',
    category: '날짜',
    description: 'dateBetween(날짜1, 날짜2, "days") — 날짜1 − 날짜2 를 그 단위로(0 쪽으로 자른다)',
    min: 3,
    max: 3,
    type: shape(['date', 'date', 'text'], 'number'),
    impl: ([a, b, unit]) => {
      const u = s(unit ?? null)
      if (a === null || b === null || a === undefined || b === undefined || a.type !== 'date' || b.type !== 'date' || u === null || !isUnit(u)) return null
      const d = dateDiff(a.value.start, b.value.start, u)
      return d === null ? null : num(d)
    },
  },
  {
    name: 'dateStart',
    category: '날짜',
    description: 'dateStart(날짜) — 범위의 시작',
    min: 1,
    max: 1,
    type: all('date', 'date'),
    impl: ([a]) => (a === null || a === undefined || a.type !== 'date' ? null : date({ start: a.value.start })),
  },
  {
    name: 'dateEnd',
    category: '날짜',
    description: 'dateEnd(날짜) — 범위의 끝(범위가 아니면 그 날짜)',
    min: 1,
    max: 1,
    type: all('date', 'date'),
    impl: ([a]) => (a === null || a === undefined || a.type !== 'date' ? null : date({ start: a.value.end ?? a.value.start })),
  },
  {
    name: 'formatDate',
    category: '날짜',
    description: 'formatDate(날짜, "YYYY-MM-DD") — 쓸 수 있는 글자: YYYY · MM · DD · HH · mm',
    min: 1,
    max: 2,
    type: shape(['date', 'text'], 'text'),
    impl: ([a, f]) => {
      if (a === null || a === undefined || a.type !== 'date') return null
      const p = dateParts(a.value.start)
      if (p === null) return null
      const pattern = f === undefined ? 'YYYY-MM-DD' : s(f)
      if (pattern === null) return null
      const pad = (x: number, w = 2) => String(x).padStart(w, '0')
      return capText(
        pattern
          .replace(/YYYY/g, pad(p.year, 4))
          .replace(/MM/g, pad(p.month))
          .replace(/DD/g, pad(p.day))
          .replace(/HH/g, pad(p.hour))
          .replace(/mm/g, pad(p.minute)),
      )
    },
  },
  {
    name: 'parseDate',
    category: '날짜',
    description: 'parseDate("2026-03-01") — 글을 날짜로(못 읽으면 빈 값)',
    min: 1,
    max: 1,
    type: all('text', 'date'),
    impl: ([a]) => {
      const x = s(a ?? null)?.trim()
      if (x === undefined || x === null) return null
      const p = dateParts(x)
      if (p === null || dateMillis(x) === null) return null
      // 달력에 없는 날(2월 30일)은 거부한다
      return ymd(p.year, p.month, p.day) === x.slice(0, 10) ? date({ start: x }) : null
    },
  },

  // ── 변환 ──
  {
    name: 'format',
    category: '변환',
    description: 'format(값) — 글로(빈 값은 빈 글)',
    min: 1,
    max: 1,
    type: () => 'text',
    impl: ([a]) => capText(formatValue(a ?? null)),
  },
  {
    name: 'toNumber',
    category: '변환',
    description: 'toNumber(값) — 수로(글은 읽히는 것만 · 참은 1 · 날짜는 그 순간의 ms)',
    min: 1,
    max: 1,
    type: () => 'number',
    impl: ([a]) => {
      if (a === null || a === undefined) return null
      switch (a.type) {
        case 'number':
          return a
        case 'boolean':
          return num(a.value ? 1 : 0)
        case 'text': {
          const t = a.value.trim().replace(/,/g, '')
          return t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? null : num(Number(t))
        }
        case 'date': {
          const ms = dateMillis(a.value.start)
          return ms === null ? null : num(ms)
        }
      }
    },
  },
]

const BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]))

export function functionNamed(name: string): FnSpec | undefined {
  return BY_NAME.get(name)
}

// 비교 · 같음은 연산자에서도 같은 규칙을 쓴다
export { compareValues, sameValue }
