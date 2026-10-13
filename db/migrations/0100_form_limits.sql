-- 폼의 응답 상한 · 마감 시각 — 인접 제품 7b-2조각 (F-13-02 · F-17-10 계층 7)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑩
--
-- `form_view` 에 두 칸 — 넘으면 폼이 받지 않는다(닫힘은 판정이다 · `access` 를 바꾸지 않는다).
--
--   · max_responses — 1~100,000 · 비면 없다. 세는 것은 이 폼으로 받은 살아 있는 응답(`form_submission_meta.view_id` — 색인은 0095)
--   · closes_at     — 이 시각부터 받지 않는다 · 비면 없다
--
-- 기존 행: 두 칸 모두 비어 있다(상한도 마감도 없다) — 바뀌는 것이 없다.

ALTER TABLE form_view
  ADD COLUMN max_responses int NULL CONSTRAINT ck_form_view_max_responses CHECK (max_responses BETWEEN 1 AND 100000),
  ADD COLUMN closes_at timestamptz NULL;
