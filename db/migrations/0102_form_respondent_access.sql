-- 폼의 제출 뒤 응답자 권한 — 인접 제품 7b-4조각 (F-13-02 · F-06-17)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑫
--
-- `form_view` 에 한 칸 — 워크스페이스 멤버만의 폼(⑨)이 응답을 받으면 그 응답 행에 응답자의 ACL 행 하나를 쓴다(이 레벨로).
--
--   · view · comment · edit — 페이지 레벨 가운데 전체 권한을 뺀 셋(응답자가 그 행을 다시 나눠 주지 않게). 데이터베이스 전용 레벨(내용
--     편집 · 만들기)은 행이 받지 않는다
--   · 비면 주지 않는다 — A1 에 `none` 레벨은 없다
--
-- 기존 행: 비어 있다(주지 않는다) — 바뀌는 것이 없다.

ALTER TABLE form_view
  ADD COLUMN respondent_access text NULL
    CONSTRAINT ck_form_view_respondent_access CHECK (respondent_access IN ('view', 'comment', 'edit'));
