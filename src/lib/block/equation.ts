/**
 * 블록 수식의 저장 모양 — Phase 2 1a (F-01-20 · 순수 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 블록 수식 · 01-block-editor.md F-01-20
 *
 *   · `type='equation'` · `properties.expression` = KaTeX 문자열 하나(공개 API 의 페이로드 그대로 — rich text · 자식 · 색 없음)
 *   · **원문만 저장한다** — 렌더 결과(HTML · MathML)를 저장하면 KaTeX 를 올릴 때 모든 페이지를 옮겨야 한다. 그리는 쪽이 매번 그린다
 *   · 길이는 `MAX_EQUATION_LENGTH`(노션 API 의 1000자 · JS 문자열 길이) — 입력칸이 막고, 읽을 때의 정화가 넘는 것을 자른다
 *   · 비면 키가 없다(화면은 "수식을 입력하세요")
 */

export const EQUATION_TYPE = 'equation' as const

/** F-01-20 *"`equation.expression` 의 공개 API 상한은 1000자"*. */
export const MAX_EQUATION_LENGTH = 1000

/** 저장된 식 — 없거나 문자열이 아니면 빈 문자열. */
export function equationExpressionOf(props: Readonly<Record<string, unknown>> | null | undefined): string {
  const value = props?.expression
  return typeof value === 'string' ? value : ''
}

/**
 * 상한까지 자른다 — 서로게이트 쌍의 가운데에서 자르지 않는다(잘린 반쪽이 남으면 JSON 은 되지만 글자가 깨진다).
 */
export function clampExpression(text: string): string {
  if (text.length <= MAX_EQUATION_LENGTH) return text
  const cut = text.slice(0, MAX_EQUATION_LENGTH)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * 마크다운의 블록 수식 — `$$` 줄 · 식 · `$$` 줄(내보내기 · 클립보드 평문). 식의 빈 줄은 뺀다 — 빈 줄은 마크다운의 문단을 끊어 울타리가
 * 깨진다(수식 모드에서 빈 줄은 뜻이 없다). 빈 식은 줄이 없다.
 */
export function equationDisplayLines(props: Readonly<Record<string, unknown>>): string[] {
  const lines = equationExpressionOf(props)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  return lines.length === 0 ? [] : ['$$', ...lines, '$$']
}

/** 문단 하나가 통째로 `$$ … $$` 이면 그 식(가져오기 · 8m-1 의 역) — 아니면 null. 빈 식도 null. */
export function displayMathOf(paragraph: string): string | null {
  const match = /^\$\$([\s\S]*?)\$\$$/.exec(paragraph.trim())
  const expression = match?.[1]?.trim() ?? ''
  return expression === '' || expression.includes('$$') ? null : expression
}

/** 식을 쓴 새 props — 비면(공백뿐이어도) 키를 지운다 · 상한까지 자른다. 다른 키는 그대로다. */
export function withEquationExpression(props: Readonly<Record<string, unknown>>, text: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props }
  if (text.trim() === '') delete next.expression
  else next.expression = clampExpression(text)
  return next
}
