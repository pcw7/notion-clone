-- status 의 그룹 단위 필터 — 카탈로그에 둘 — §7 정리 10n-23 (F-03-05 · F-03-17)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 status 절 [보강 10n-23] 그룹 단위 필터
--       0023 의 머리말 *"노션은 status 에 그룹 단위 필터("To-do 전체")도 주지만 그건 옵션 id 집합으로 펴야 하는 다른 연산자다"*
--
-- 그룹이 같음 · 그룹이 같지 않음(값은 그룹 — todo · in_progress · complete). 옵션 id 집합으로 펴서 저장하지 않고 **그룹으로 저장한다** —
-- 옵션을 다른 그룹으로 옮기거나(10n-20) 그 그룹에 새 옵션을 만들면(10n-22) 필터가 따라온다. SQL 조각은 `src/lib/database/filter.ts` 의
-- 화이트리스트에 있고 두 곳의 일치는 `filter.db.test.ts` 가 강제한다.
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('status', 'group_is',     1, '그룹이 같음',     5),
  ('status', 'group_is_not', 1, '그룹이 같지 않음', 6);
