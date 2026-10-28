-- 하위 항목의 표시 방식 — 23번 트랙 P-3 (F-04-22 · F-03-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 P-1] ⑦
--
-- 0015 가 `view.sub_item_display` 칸만 두고 값을 정하지 않았다. 노션의 *Nested in toggle* · *Flattened list* 중 기본(토글로 중첩)은
-- NULL 하나로 적는다(0119 의 표시 범위와 같은 까닭 — 같은 뜻의 표기가 둘이면 갈라진다). 그래서 칸이 받는 값은 `flattened` 하나뿐이다.
-- 프로브는 verify-schema 의 [41b].
--
-- 기존 행: 모두 NULL(아무도 쓰지 않았다) — 토글로 중첩.

ALTER TABLE view
  ADD CONSTRAINT ck_view_sub_item_display CHECK (sub_item_display IS NULL OR sub_item_display = 'flattened');
