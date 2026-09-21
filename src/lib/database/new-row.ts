/**
 * `New ▾` 가 사람에게 말하는 법 — 템플릿 6c-4조각 (F-08-02 · F-08-03, DOM · DB 없음)
 *
 * 정본: 08-templates-automation.md
 *   F-08-03 *"`New` 버튼 라벨을 `New <템플릿명>` 으로 바꿔 예측 가능성 확보."*
 *   F-08-03 *"기본 템플릿이 지정되면 템플릿 선택 메뉴를 건너뛴다."*
 *
 * 부르는 자리가 둘이다 — 표 · 목록의 꼬리줄과 보드의 열마다. 문구를 여기 모으는 이유는 복제(`duplicate-page.ts`)와
 * 같다: 두 벌이면 한쪽만 고쳐진다. 그리고 **클라이언트가 값으로 import 한다** — 그래서 DB 를 모르는 모듈이다
 * (`view.ts` · `template.ts` 에서 값을 가져오면 빌드가 죽는다 · §3.3-163).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 템플릿으로 만들었는데 빠진 것이 있으면 말한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 서버는 볼 수 없는 하위 페이지를 복제하지 않고(`skippedPages`) 볼 수 없는 대상에는 연결을 잇지 않는다
 * (`skippedLinks` · §3.2-37). 조용히 넘어가면 사용자는 **새 행에 무엇이 없는지 영영 모른다** — 템플릿을 연 사람은
 * 그것이 있다고 알고 있다(§3.3-174 와 같은 이유).
 */

/** 기본 템플릿 — 화면이 아는 것은 이름뿐이다. */
export type DefaultTemplate = { readonly id: string; readonly title: string }

export const UNTITLED_TEMPLATE = '제목 없음'

/**
 * `+` 버튼의 글자. 기본 템플릿이 있으면 그 이름을 붙인다 — 그냥 누르면 **무엇이** 만들어지는지 버튼이 말한다(08).
 * 없으면 빈 항목이다.
 */
export function newRowLabel(defaultTemplate: DefaultTemplate | null): string {
  if (defaultTemplate === null) return '+ 새로 만들기'
  return `+ 새 ${defaultTemplate.title.trim() || UNTITLED_TEMPLATE}`
}

/**
 * 템플릿으로 만든 뒤 할 말. 빠진 것이 없으면 `null` — 잘된 일에 문구를 띄우지 않는다(§3.3-174).
 *
 * ★ 개수는 **"0 보다 크다"로** 묻는다. `<= 0` 으로 거르면 `NaN` 에서 거짓이라 "NaN개"가 샌다 — 복제 버튼에서
 *   검사가 잡은 것과 같은 자리다(`duplicate-page.ts`).
 */
export function templateRowNote(skippedPages: number, skippedLinks: number): string | null {
  const parts: string[] = []
  if (skippedPages > 0) parts.push(`볼 수 없는 하위 페이지 ${skippedPages}개는 복제하지 못했습니다`)
  if (skippedLinks > 0) parts.push(`볼 수 없는 항목 ${skippedLinks}개에는 연결하지 않았습니다`)
  if (parts.length === 0) return null
  return `템플릿으로 만들었습니다. ${parts.join(' · ')}.`
}
