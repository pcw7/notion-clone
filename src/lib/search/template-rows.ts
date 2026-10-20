/**
 * 검색 색인에서 템플릿 행을 뺀다 — 플랫폼 잔여 10p-1 (F-07-01)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 데이터베이스 행의 제목 색인 ② · 불변식 R1(*"모든 뷰/API 쿼리는 is_template=false"*)
 *
 * 템플릿은 `page.is_template` 인 행이다(6c-1). 행의 제목을 색인하므로(①) 템플릿도 색인에 이름을 갖는다 — 색인에서 빼지 않고 **읽는
 * 질의가 뺀다**(템플릿이 일반 행으로 바뀌는 길이 생겨도 색인을 다시 쓰지 않게). 전역 검색 · `@` 후보가 같은 술어를 건다.
 */

/** `docColumn`(색인 문서의 id 칸 — 예: `s.doc_id`)이 템플릿 행이 아니다. 질의에 그대로 넣는 SQL 조각이다 — 사용자 값을 받지 않는다. */
export function notTemplateRow(docColumn: string): string {
  return `NOT EXISTS (SELECT 1 FROM page tp WHERE tp.id = ${docColumn} AND tp.is_template)`
}
