/**
 * 버튼 블록 — 라벨 (자동화 5e-1 · F-08-06 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑰
 *
 * 버튼 블록의 내용은 라벨 하나다(`properties.label`) — 본문(Y.Doc)에 살아서 협업 · 버전 · 되돌리기를 다른 블록처럼 탄다. 액션은 본문이
 * 아니라 automation 에 있다(`automation/button-block.ts`). 정화는 수식의 식과 같은 자리(`props.ts`)다.
 */

export const BUTTON_TYPE = 'button' as const
/** 라벨의 길이 상한(08 — 버튼 속성의 이름과 같은 감각 · 단추에 들어가는 글이다). */
export const MAX_BUTTON_LABEL = 100
/** 라벨이 비었을 때 그리는 글(`/버튼` 이 만드는 라벨도 이것이다). */
export const DEFAULT_BUTTON_LABEL = '버튼'

/** 저장된 라벨 — 없거나 문자열이 아니면 빈 문자열. */
export function buttonLabelOf(props: Readonly<Record<string, unknown>> | null | undefined): string {
  const value = props?.label
  return typeof value === 'string' ? value : ''
}

/** 그릴 라벨 — 비었으면 "버튼". */
export function buttonDisplayLabel(props: Readonly<Record<string, unknown>> | null | undefined): string {
  const label = buttonLabelOf(props).trim()
  return label === '' ? DEFAULT_BUTTON_LABEL : label
}

/** 상한까지 자른다 — 대리쌍의 앞 반쪽에서 끊지 않는다. */
export function clampButtonLabel(text: string): string {
  if (text.length <= MAX_BUTTON_LABEL) return text
  const cut = text.slice(0, MAX_BUTTON_LABEL)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** 라벨을 쓴 새 props — 비면 키를 지운다(그릴 때 "버튼") · 상한까지 자른다 · 줄바꿈은 빈칸으로. 다른 키는 그대로다. */
export function withButtonLabel(props: Readonly<Record<string, unknown>>, label: string): Record<string, unknown> {
  const next = { ...props }
  const text = clampButtonLabel(label.replace(/[\r\n]+/g, ' ').trim())
  if (text === '') delete next.label
  else next.label = text
  return next
}

/** 평문으로 — 내보내기 · 복사(정본 ⑰ — `[버튼: ‹라벨›]`). */
export function buttonPlainText(props: Readonly<Record<string, unknown>>): string {
  return `[버튼: ${buttonDisplayLabel(props)}]`
}
