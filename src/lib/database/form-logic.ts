/**
 * 폼의 조건부 보이기 — 질문 타입 · 연산자 · 보이는 질문의 판정 (인접 제품 7b-5a · F-13-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑬
 *
 * **서버와 브라우저가 이 판정 하나를 쓴다** — 브라우저는 답에 따라 질문을 곧바로 보이고 숨기고, 서버는 제출을 다시 평가한다(13 *"서버가
 * 재평가하지 않으면 숨겨진 질문에 값을 주입할 수 있다"*). 그래서 이 파일은 DB · 서버 모듈을 가져오지 않는다.
 *
 *   · 조건은 "보이기" 하나 — 근거 질문의 답이 조건에 맞을 때만 보인다
 *   · 근거는 **앞에 선 질문**이다 — 순서대로 평가하므로 순환이 없다. 숨은 질문의 답은 없는 것으로 친다
 *   · 근거가 앞에 없으면(빠졌다 · 뒤에 있다) 끊어진 조건 — 질문이 보인다(질문을 잃지 않는다)
 */

/** 폼이 받는 질문의 타입(v1 — 정본 ②). */
export const FORM_QUESTION_TYPES = ['title', 'rich_text', 'number', 'select', 'checkbox', 'date'] as const
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number]

/** 보이기 조건의 연산자 — 0104 의 CHECK 과 같다. */
export const SHOW_IF_OPERATORS = ['equals', 'not_equals', 'is_checked', 'is_not_checked', 'is_empty', 'is_not_empty'] as const
export type ShowIfOperator = (typeof SHOW_IF_OPERATORS)[number]

/** 보이기 조건 — 근거 질문(속성 id) · 연산자 · 옵션(같다 · 같지 않다 에만). */
export type ShowWhen = {
  readonly propertyId: string
  readonly operator: ShowIfOperator
  readonly optionId: string | null
}

/** 근거의 타입이 받는 연산자. 선택은 옵션으로 · 체크박스는 체크로 · 나머지는 답이 있는지로. */
export function operatorsFor(type: FormQuestionType): readonly ShowIfOperator[] {
  switch (type) {
    case 'select':
      return ['equals', 'not_equals', 'is_empty', 'is_not_empty']
    case 'checkbox':
      return ['is_checked', 'is_not_checked']
    case 'title':
    case 'rich_text':
    case 'number':
    case 'date':
      return ['is_empty', 'is_not_empty']
  }
}

/** 옵션이 있어야 하는 연산자인가 — 같다 · 같지 않다. */
export function needsOption(operator: ShowIfOperator): boolean {
  return operator === 'equals' || operator === 'not_equals'
}

/** 체크박스의 답이 체크인가 — 제출의 값 검사와 같은 말(`true` · `'true'` · `'on'`). */
export function isChecked(answer: unknown): boolean {
  return answer === true || answer === 'true' || answer === 'on'
}

/** 답이 있는가 — 글은 앞뒤 공백을 빼고 · 숫자는 수 또는 빈 글이 아닌 것 · 체크박스는 체크. */
export function isAnswered(type: FormQuestionType, answer: unknown): boolean {
  if (type === 'checkbox') return isChecked(answer)
  if (typeof answer === 'number') return type === 'number' && Number.isFinite(answer)
  return typeof answer === 'string' && answer.trim() !== ''
}

/** 조건이 맞는가 — 근거의 타입과 답으로. 근거가 숨었으면 답은 `undefined` 로 들어온다. */
export function conditionHolds(when: ShowWhen, sourceType: FormQuestionType, answer: unknown): boolean {
  switch (when.operator) {
    case 'equals':
      return typeof answer === 'string' && answer === when.optionId
    case 'not_equals':
      return !(typeof answer === 'string' && answer === when.optionId)
    case 'is_checked':
      return isChecked(answer)
    case 'is_not_checked':
      return !isChecked(answer)
    case 'is_empty':
      return !isAnswered(sourceType, answer)
    case 'is_not_empty':
      return isAnswered(sourceType, answer)
  }
}

/**
 * 끊어질 조건을 지운다 — 근거가 앞에 없는(빠졌다 · 뒤로 갔다) 질문의 조건을 null 로. 편집 화면이 질문을 빼거나 옮긴 목록을 보내기 전에
 * 부른다(13 *"규칙 대상 질문 삭제 → 규칙 동반 삭제"* — 서버는 끊어진 조건을 받지 않는다). 지우기는 요금제와 무관하다.
 */
export function pruneShowWhen<Q extends { readonly propertyId: string; readonly showWhen: ShowWhen | null }>(questions: readonly Q[]): Q[] {
  const before = new Set<string>()
  return questions.map((q) => {
    const kept = q.showWhen !== null && !before.has(q.showWhen.propertyId) ? { ...q, showWhen: null } : q
    before.add(q.propertyId)
    return kept
  })
}

/**
 * 지금 보이는 질문(속성 id) — 질문의 순서대로 평가한다. 조건의 근거가 앞에 없으면 끊어진 조건이라 보인다. 숨은 근거의 답은 없는 것으로
 * 친다(그 근거에 걸린 뒤의 질문도 그 답으로 본다).
 */
export function visibleQuestionIds(
  questions: readonly { readonly propertyId: string; readonly type: FormQuestionType; readonly showWhen: ShowWhen | null }[],
  answers: Readonly<Record<string, unknown>>,
): Set<string> {
  const visible = new Set<string>()
  const before = new Map<string, FormQuestionType>()
  for (const q of questions) {
    const when = q.showWhen
    const sourceType = when === null ? undefined : before.get(when.propertyId)
    const shown =
      when === null || sourceType === undefined
        ? true
        : conditionHolds(when, sourceType, visible.has(when.propertyId) && Object.hasOwn(answers, when.propertyId) ? answers[when.propertyId] : undefined)
    if (shown) visible.add(q.propertyId)
    before.set(q.propertyId, q.type)
  }
  return visible
}
