-- 폼의 한 사람당 한 번 — 인접 제품 7b-3조각 (F-13-02 · F-17-10 계층 6)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 끝 [보강] 폼 ⑪
--
-- `form_view` 에 한 칸 — 켜면 워크스페이스 멤버만의 폼(⑨)에서 같은 사람이 응답을 두 번 내지 못한다. 열쇠는 로그인한 응답자 하나다
-- (웹 공개 폼은 응답자를 모른다 — 켜 두어도 막지 않는다 · 브라우저 지문은 쓰지 않는다).
--
-- 이미 냈는지는 칸이 아니라 판정이다 — 이 폼으로 받은 살아 있는 응답(`form_submission_meta.view_id`)의 만든 사람(`block.created_by`).
-- 응답을 휴지통에 넣으면 그 사람이 다시 낸다(⑩ 의 셈과 같다).
--
-- 기존 행: 꺼진 채(false) — 바뀌는 것이 없다.

ALTER TABLE form_view
  ADD COLUMN one_per_respondent boolean NOT NULL DEFAULT false;
