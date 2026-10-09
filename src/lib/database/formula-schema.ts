/**
 * 수식 속성 — 보는 스키마 · 설정 · 순환과 깊이 · 한 행의 계산 (DB 심화 2i-2조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 `property_dependency` · [보강] 수식 1단계 · 03-database-core.md F-03-12
 *
 * ──────────────────────────────────────────────────────────────────────
 * 수식이 읽을 수 있는 속성
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1단계는 **같은 표의 칸 속성과 다른 수식**만 읽는다. relation · rollup · 고유 ID 는 아직이다(3단계 — 목록 · relation 순회). 타입은
 *
 *   제목 · 글 · 선택 · 상태  → 글(선택 · 상태는 **옵션 이름** — 칸이 든 옵션 id 를 이름으로 바꾼다)
 *   수                       → 수
 *   체크박스                 → 참거짓(빈 칸은 거짓 — 체크박스에는 빈 값이 없다)
 *   날짜                     → 날짜
 *   수식                     → 그 수식의 결과 타입
 *
 * ──────────────────────────────────────────────────────────────────────
 * 순환은 거부 · 깊이는 15 까지 — 노션처럼 조용히 틀리지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 03 *"순환 참조 → 저장 시 그래프 사이클 검출 → 저장 거부"* · *"참조 깊이 16단 → 노션: 조용히 실패. 클론 권고: 저장 거부"*. 깊이는 수식이
 * 수식을 읽을 때마다 하나씩 쌓인다(칸 속성만 읽으면 1). 저장할 때 **표의 수식 전부**의 깊이를 다시 센다 — 가운데 수식을 고치면 그것을 읽는
 * 수식의 깊이도 바뀐다. 표에 수식이 몇 개 안 되므로 캐시(`ref_depth`)를 두지 않는다(§7).
 */

import { toPlainText } from '../contracts/rich-text.ts'
import { compileFormula, evaluateFormula, type CompiledFormula, type FormulaSchema, type FormulaType, type FormulaValue } from '../formula/formula.ts'
import type { FormulaEnv } from '../formula/formula.ts'
import { readCell } from './cell-format.ts'
import { isMvpPropertyType, type MvpPropertyType } from './property-types.ts'

/** 참조 깊이의 상한 — 노션의 15(2024년 8월부터). 넘으면 저장을 거부한다. */
export const MAX_FORMULA_DEPTH = 15

const FORMULA_RESULT_TYPES: readonly FormulaType[] = ['number', 'text', 'boolean', 'date']

export type FormulaConfig = { readonly expression: string; readonly result_type: FormulaType }

/** 저장된 config → 수식 설정. 모양이 아니면 null(그 컬럼은 그리지 않는다 — 다른 파생 타입과 같은 규칙). */
export function readFormulaConfig(raw: unknown): FormulaConfig | null {
  const c = raw as { expression?: unknown; result_type?: unknown } | null | undefined
  if (typeof c?.expression !== 'string' || !(FORMULA_RESULT_TYPES as readonly unknown[]).includes(c.result_type)) return null
  return { expression: c.expression, result_type: c.result_type as FormulaType }
}

/** 칸 타입이 수식에서 무엇으로 읽히는가. 수식에서 쓸 수 없는 타입이면 null. */
export function formulaTypeOfCell(type: string): FormulaType | null {
  switch (type) {
    case 'title':
    case 'rich_text':
    case 'select':
    case 'status':
      return 'text'
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'date'
    default:
      return null
  }
}

/** 수식이 보는 속성 하나 — 살아 있는 것만 넘긴다. */
export type FormulaSourceProperty = { readonly id: string; readonly name: string; readonly type: string; readonly config: unknown }

/** 이 속성의 수식 타입 — 칸이면 칸의 것, 수식이면 그 결과 타입. */
function typeOfProperty(p: FormulaSourceProperty): FormulaType | null {
  if (p.type === 'formula') return readFormulaConfig(p.config)?.result_type ?? null
  return formulaTypeOfCell(p.type)
}

/** 표의 살아 있는 속성들 → 수식이 이름 · id 로 찾는 스키마. 이름은 정확히 같아야 한다(노션처럼 대소문자를 가린다). */
export function formulaSchemaOf(properties: readonly FormulaSourceProperty[]): FormulaSchema {
  const usable = properties.flatMap((p) => {
    const type = typeOfProperty(p)
    return type === null ? [] : [{ id: p.id, name: p.name, type }]
  })
  return {
    byName: (name) => {
      const p = usable.find((x) => x.name === name)
      return p ? { id: p.id, type: p.type } : null
    },
    byId: (id) => {
      const p = usable.find((x) => x.id === id)
      return p ? { name: p.name, type: p.type } : null
    },
  }
}

/**
 * 수식 그래프를 본다 — `formulas` 는 표의 수식마다 그것이 읽는 속성 id(고칠 수식은 새 것으로 바꿔 넣는다). 수식이 아닌 속성은 잎이다.
 * 순환이 있으면 그 고리를, 깊이가 넘치면 가장 깊은 수식과 그 깊이를 준다.
 */
export function checkFormulaGraph(
  formulas: ReadonlyMap<string, readonly string[]>,
): { readonly ok: true } | { readonly ok: false; readonly cycle: readonly string[] } | { readonly ok: false; readonly tooDeep: { readonly id: string; readonly depth: number } } {
  const state = new Map<string, 'visiting' | number>()
  const stack: string[] = []
  let cycle: string[] | null = null
  const depthOf = (id: string): number => {
    const seen = state.get(id)
    if (typeof seen === 'number') return seen
    if (seen === 'visiting') {
      cycle ??= [...stack.slice(stack.indexOf(id)), id]
      return 0
    }
    const deps = formulas.get(id)
    if (deps === undefined) return 0 // 칸 속성 — 잎
    state.set(id, 'visiting')
    stack.push(id)
    let deepest = 0
    for (const d of deps) deepest = Math.max(deepest, depthOf(d))
    stack.pop()
    const depth = deepest + 1
    state.set(id, depth)
    return depth
  }
  let worst: { id: string; depth: number } | null = null
  for (const id of formulas.keys()) {
    const d = depthOf(id)
    if (cycle !== null) return { ok: false, cycle }
    if (worst === null || d > worst.depth) worst = { id, depth: d }
  }
  return worst !== null && worst.depth > MAX_FORMULA_DEPTH ? { ok: false, tooDeep: worst } : { ok: true }
}

/** 칸 값 → 수식 값. 선택 · 상태는 옵션 이름으로(없는 옵션은 빈 값). */
export function cellToFormulaValue(type: MvpPropertyType, raw: unknown, optionName: (id: string) => string | null): FormulaValue {
  const cell = readCell(type, raw)
  switch (cell.type) {
    case 'title':
      return cell.title.length === 0 ? null : { type: 'text', value: toPlainText(cell.title) }
    case 'rich_text':
      return cell.rich_text.length === 0 ? null : { type: 'text', value: toPlainText(cell.rich_text) }
    case 'number':
      return cell.number === null ? null : { type: 'number', value: cell.number }
    case 'checkbox':
      return { type: 'boolean', value: cell.checkbox }
    case 'date':
      return cell.date === null ? null : { type: 'date', value: cell.date.end ? { start: cell.date.start, end: cell.date.end } : { start: cell.date.start } }
    case 'select':
    case 'status': {
      const ref = cell.type === 'select' ? cell.select : cell.status
      const name = ref === null ? null : optionName(ref.id)
      return name === null ? null : { type: 'text', value: name }
    }
  }
}

/** 읽을 때 만든 수식 — 식이 지금 스키마로 읽히지 않으면(지워진 속성 · 타입을 바꾼 속성) 이유를 든다. */
export type LiveFormula =
  | { readonly id: string; readonly ok: true; readonly compiled: CompiledFormula }
  | { readonly id: string; readonly ok: false; readonly error: string }

/** 표의 수식들을 지금 스키마로 다시 읽는다(저장된 식은 `⟦id⟧` 라 이름 없이도 읽힌다). */
export function compileLiveFormulas(properties: readonly FormulaSourceProperty[]): LiveFormula[] {
  const schema = formulaSchemaOf(properties)
  return properties
    .filter((p) => p.type === 'formula')
    .map((p): LiveFormula => {
      const config = readFormulaConfig(p.config)
      if (config === null) return { id: p.id, ok: false, error: '수식 설정이 손상되었습니다' }
      const c = compileFormula(config.expression, schema)
      return c.ok ? { id: p.id, ok: true, compiled: c.value } : { id: p.id, ok: false, error: c.error.message }
    })
}

/**
 * 한 행의 수식 값 전부 — 수식이 수식을 읽으면 그쪽을 먼저(메모). 읽히지 않는 수식 · 그것을 읽는 수식은 빈 값이다. 순환은 저장이 막지만,
 * 그래도 만나면(손으로 고친 데이터) 빈 값으로 끊는다.
 */
export function evaluateRowFormulas(
  formulas: readonly LiveFormula[],
  propertyType: (id: string) => string | null,
  cells: Readonly<Record<string, unknown>>,
  optionName: (id: string) => string | null,
  env: FormulaEnv,
): Record<string, FormulaValue> {
  const byId = new Map(formulas.map((f) => [f.id, f]))
  const memo = new Map<string, FormulaValue>()
  const visiting = new Set<string>()
  const valueOf = (id: string): FormulaValue => {
    const formula = byId.get(id)
    if (formula === undefined) {
      const type = propertyType(id)
      return type !== null && isMvpPropertyType(type) ? cellToFormulaValue(type, cells[id], optionName) : null
    }
    if (memo.has(id)) return memo.get(id) ?? null
    if (visiting.has(id) || !formula.ok) return null
    visiting.add(id)
    const v = evaluateFormula(formula.compiled, valueOf, env)
    visiting.delete(id)
    memo.set(id, v)
    return v
  }
  const out: Record<string, FormulaValue> = {}
  for (const f of formulas) out[f.id] = valueOf(f.id)
  return out
}
