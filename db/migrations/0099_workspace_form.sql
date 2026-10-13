-- 워크스페이스 멤버만의 폼 — 인접 제품 7b-1조각 (F-13-02)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑨
--
-- `form_view.access` 의 셋째 값 `workspace`(로그인한 그 워크스페이스의 멤버만 · 응답자를 남긴다). 주소는 공개와 같은 `/f/{토큰}` 하나라
-- 닫지 않은 폼은 토큰이 있다.
--
--   · ck_form_view_access       — closed | public | workspace
--   · ck_form_view_public_token → ck_form_view_open_token — 닫지 않았으면 토큰이 있다(공개만이 아니다)
--
-- 기존 행: closed · public 뿐이고 공개는 이미 토큰이 있다 — 그대로 통과한다.

ALTER TABLE form_view DROP CONSTRAINT ck_form_view_access;
ALTER TABLE form_view ADD CONSTRAINT ck_form_view_access CHECK (access IN ('closed', 'public', 'workspace'));

ALTER TABLE form_view DROP CONSTRAINT ck_form_view_public_token;
ALTER TABLE form_view ADD CONSTRAINT ck_form_view_open_token CHECK (access = 'closed' OR token IS NOT NULL);
