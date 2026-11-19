-- 본문 쓰기의 출처에 `ai` — AI-4 페이지 번역 (F-10-03)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강 AI-1] ⑥ *"AI 가 서버에서 본문을 직접 쓰는 길(번역 · AI 블록 새로 고침)이 생길 때
--       `doc_update.origin` 에 `ai` 를 더한다"* · ⑨(번역은 새 하위 페이지에) · §3.7 `doc_update`
--
-- 번역(AI-4)은 번역본을 원본의 새 하위 페이지로 만들고 그 본문을 서버가 본문 세션(경로 ②)으로 쓴다 — 출처 `ai` · 행위자는 부른 사람.
-- 0007 의 CHECK 에 그 값이 없다. 이름 없는 CHECK 이라 PostgreSQL 이 지은 이름(`doc_update_origin_check`)으로 지우고 같은 이름으로 다시 건다
-- (0041 의 `page_version_reason_check` 와 같은 모양). 해시 파티션 16개는 부모의 CHECK 을 물려받는다 — 부모에서 지우고 걸면 함께 바뀐다.
--
-- 기존 행: 값이 늘기만 한다 — 모두 그대로 지난다.

ALTER TABLE doc_update DROP CONSTRAINT doc_update_origin_check;
ALTER TABLE doc_update
  ADD CONSTRAINT doc_update_origin_check
  CHECK (origin IN ('editor', 'api', 'automation', 'restore', 'import', 'external_sync', 'ai'));
