/**
 * 수식 — 화면이 같은 행의 칸으로 계산한다 (DB 심화 2i-3a조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 수식 1단계 ⑥
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 화면이 계산하는가 — rollup 과 다르다
 * ──────────────────────────────────────────────────────────────────────
 *
 * rollup 은 다른 행을 읽고 **보는 사람마다 결과가 다르다**(볼 수 없는 행을 뺀다) — 그래서 서버가 계산해 따로 준다. 1단계의 수식은
 * **그 행의 칸만** 읽는다. 화면은 그 칸을 이미 갖고 있다(행 읽기가 권한 · 휴지통을 지났다) — 새로 알게 되는 것이 없다. 화면이 같은
 * 함수(`compileLiveFormulas` · `evaluateRowFormulas` — 서버의 `computeFormulaValues` 가 쓰는 그것)로 계산하면:
 *
 *   ① 칸을 고치는 순간 수식이 따라 바뀐다(왕복 없음 — 낙관적으로 칠한 칸 그대로)
 *   ② "더 보기" · 새 행 · 하위 항목이 따로 물을 것이 없다
 *
 * 계산에 필요한 것은 **표의 속성 전부**다(숨긴 속성도 수식은 읽는다 — 표는 보이는 컬럼만 받는다). 그래서 서버 렌더가 뷰의 컬럼 전부로
 * 계획(`FormulaPlan`)을 만들어 내려준다. 수식을 만들거나 식을 고치면 화면은 다시 읽는다(계획이 새로 선다).
 *
 * **지금(`now()` · `today()`)은 계획에 박는다** — 서버 렌더와 브라우저가 같은 시각으로 계산해야 붙을 때(hydration) 글자가 어긋나지
 * 않는다. 화면을 오래 열어 두면 그 시각에 머문다(다시 열면 맞는다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰는 동안 검사한다 (2i-3b)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 식 편집기는 치는 동안 **같은 함수**(`compileFormula`)로 식을 읽어 틀린 자리를 보이고, 맞으면 결과 타입과 첫 행의 값을 미리 보인다
 * (`checkFormulaDraft`). 그래서 계획은 수식 컬럼이 없어도 선다 — 첫 수식을 만드는 폼이 표의 속성을 알아야 한다. 화면이 보지 못하는 것
 * (다른 수식을 거쳐 돌아오는 고리 · 깊이 15)은 저장할 때 서버가 본다 — 화면은 자기 자신을 바로 읽는 것만 먼저 막는다.
 */

import { textRun } from '../contracts/rich-text.ts'
import { compileFormula, type FormulaError, type FormulaType, type FormulaValue } from '../formula/formula.ts'
import type { CellValue } from './property-types.ts'
import type { ViewColumn } from './view-columns.ts'
import { compileLiveFormulas, evaluateRowFormulas, formulaSchemaOf, type FormulaSourceProperty } from './formula-schema.ts'

/** 화면이 수식을 계산하는 데 필요한 전부 — 직렬화할 수 있다(서버 렌더 → 브라우저). */
export type FormulaPlan = {
  /** 표의 살아 있는 속성 전부(숨긴 것 포함). 수식은 저장된 식(`⟦id⟧`)을 싣는다. */
  readonly sources: readonly FormulaSourceProperty[]
  /** 선택 · 상태 옵션 id → 이름(수식은 옵션을 이름으로 읽는다). */
  readonly optionNames: Readonly<Record<string, string>>
  /** 계산의 기준 시각(ISO) — 머리말. */
  readonly now: string
}

/** 뷰의 컬럼 **전부**(숨긴 것 포함)로 계획을 만든다. 수식 컬럼이 없어도 선다 — 식 편집기가 표의 속성을 읽는다(머리말). */
export function formulaPlanOf(columns: readonly ViewColumn[], now: Date): FormulaPlan {
  return {
    sources: columns.map((c) => ({
      id: c.propertyId,
      name: c.name,
      type: c.type,
      config: c.type === 'formula' ? { expression: c.formula.source, result_type: c.formula.resultType } : null,
    })),
    optionNames: Object.fromEntries(columns.flatMap((c) => c.options.map((o) => [o.id, o.name] as const))),
    now: now.toISOString(),
  }
}

export type FormulaEvaluator = {
  /** 수식 컬럼마다 — 읽히면 null, 아니면 이유(지워진 속성 · 타입이 바뀐 속성). 컬럼 전체의 일이다(행과 무관하다). */
  readonly errors: Readonly<Record<string, string | null>>
  /** 한 행의 수식 값 전부. `optionName` 은 계획 뒤에 생긴 옵션(이 화면에서 방금 만든 것)을 찾는다. */
  readonly valuesOf: (
    cells: Readonly<Record<string, unknown>>,
    optionName?: (id: string) => string | null,
  ) => Record<string, FormulaValue>
}

/** 계획 → 계산기. 식은 여기서 한 번 읽는다(행마다 읽지 않는다). */
export function formulaEvaluator(plan: FormulaPlan): FormulaEvaluator {
  const formulas = compileLiveFormulas(plan.sources)
  const typeOf = new Map(plan.sources.map((p) => [p.id, p.type]))
  const now = new Date(plan.now)
  return {
    errors: Object.fromEntries(formulas.map((f) => [f.id, f.ok ? null : f.error])),
    valuesOf: (cells, optionName = () => null) =>
      evaluateRowFormulas(
        formulas,
        (id) => typeOf.get(id) ?? null,
        cells,
        (id) => plan.optionNames[id] ?? optionName(id),
        { now },
      ),
  }
}

/**
 * 수식 값 → 칸 값. 화면은 칸을 그리는 함수(`CellDisplay`)로 수식을 그린다 — 수 · 날짜의 모양이 칸과 같다. 빈 값은 null(그리지 않는다).
 */
export function formulaCell(value: FormulaValue | undefined): CellValue | null {
  if (value === null || value === undefined) return null
  switch (value.type) {
    case 'number':
      return { type: 'number', number: value.value }
    case 'text':
      return { type: 'rich_text', rich_text: [textRun(value.value)] }
    case 'boolean':
      return { type: 'checkbox', checkbox: value.value }
    case 'date':
      return { type: 'date', date: value.value.end === undefined ? { start: value.value.start } : { start: value.value.start, end: value.value.end } }
  }
}

// ── 쓰는 동안 검사 (2i-3b) ──────────────────────────────────────────

/** 편집기가 그리는 검사 결과 — 비었다 · 틀렸다(자리와 이유) · 읽힌다(결과 타입 · 미리볼 행이 있으면 그 값). */
export type FormulaDraftCheck =
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly error: FormulaError }
  | { readonly kind: 'ok'; readonly resultType: FormulaType; readonly preview?: FormulaValue }

/**
 * 사람이 친 식을 지금 표의 속성으로 읽는다(서버가 저장할 때 쓰는 그 함수). `selfId` 는 고치는 수식 — 자기 자신을 바로 읽으면 틀렸다고
 * 말한다(거쳐서 돌아오는 고리는 서버가 본다). `previewCells` 가 있으면 그 행으로 계산해 미리 보인다 — 다른 수식을 읽으면 그 수식도
 * 계산한다(고치는 수식을 읽는 수식은 새 식으로).
 */
export function checkFormulaDraft(
  plan: FormulaPlan,
  expression: string,
  options: {
    readonly selfId?: string
    readonly previewCells?: Readonly<Record<string, unknown>> | null
    readonly optionName?: (id: string) => string | null
  } = {},
): FormulaDraftCheck {
  if (expression.trim() === '') return { kind: 'empty' }
  const compiled = compileFormula(expression, formulaSchemaOf(plan.sources))
  if (!compiled.ok) return { kind: 'error', error: compiled.error }
  const { selfId, previewCells } = options
  if (selfId !== undefined && compiled.value.dependsOn.includes(selfId)) {
    return { kind: 'error', error: { message: '수식이 자기 자신을 읽습니다', start: 0, end: expression.length } }
  }
  if (previewCells === undefined || previewCells === null) return { kind: 'ok', resultType: compiled.value.resultType }

  const draftId = selfId ?? '\u0000draft'
  const formulas = [
    ...compileLiveFormulas(plan.sources).filter((f) => f.id !== draftId),
    { id: draftId, ok: true as const, compiled: compiled.value },
  ]
  const typeOf = new Map(plan.sources.map((p) => [p.id, p.type]))
  const values = evaluateRowFormulas(
    formulas,
    (id) => typeOf.get(id) ?? null,
    previewCells,
    (id) => plan.optionNames[id] ?? options.optionName?.(id) ?? null,
    { now: new Date(plan.now) },
  )
  return { kind: 'ok', resultType: compiled.value.resultType, preview: values[draftId] ?? null }
}
