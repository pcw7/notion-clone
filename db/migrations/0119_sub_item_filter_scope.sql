-- 하위 항목의 표시 범위 — 23번 트랙 P-1 (F-04-22 · F-03-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 P-1] 하위 항목의 표시 범위 ①
--
-- 0015 가 `view.sub_item_filter_scope` 칸만 두고 값을 정하지 않았다. 노션의 *Filter options* 셋 — 부모만 · 부모와 하위 · 하위만 — 중
-- 기본(부모와 하위)은 NULL 하나로 적는다(같은 뜻의 표기가 둘이면 갈라진다 — API 는 `both` 로 읽고 쓰되 NULL 로 저장한다). 그래서 칸이 받는
-- 값은 `parents` · `sub_items` 둘뿐이다. 프로브는 verify-schema 의 [41b].
--
-- 기존 행: 모두 NULL(아무도 쓰지 않았다) — 부모와 하위.

ALTER TABLE view
  ADD CONSTRAINT ck_view_sub_item_filter_scope CHECK (sub_item_filter_scope IS NULL OR sub_item_filter_scope IN ('parents', 'sub_items'));
