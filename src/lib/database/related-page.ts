/**
 * relation 편집기의 지금 연결 — 페이지를 이어 붙인다 (§7 정리 10n-40 · F-03-10 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-40] 편집기의 더 보기
 *
 * 편집기는 열 때 지금 연결의 첫 페이지를 읽고, "더 보기" 로 다음 페이지를 붙인다(커서는 칩 순서 `(order_idx, id)` — 앞이 바뀌어도 밀리지
 * 않는다). 붙일 때 **이미 있는 행은 거른다** — 편집기를 연 사이 고른 행은 이 목록의 끝에 먼저 붙고(서버도 칸의 맨 뒤에 둔다), 다음 페이지가
 * 그 행을 다시 싣는다. 거르지 않으면 같은 행이 두 줄 선다(× 를 두 번 누르면 둘째는 "이미 없다").
 */

export function appendRelatedPage<T extends { readonly id: string }>(current: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(current.map((row) => row.id))
  return [...current, ...next.filter((row) => !seen.has(row.id))]
}
