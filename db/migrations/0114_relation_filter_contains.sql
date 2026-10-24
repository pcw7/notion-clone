-- relation 속성의 필터 연산자 — 포함 · 포함하지 않음 — §7 정리 10n-45 (F-04-09 · F-03-10)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-45] relation 으로 거르기 — 포함 · 포함하지 않음
--       0015 의 카탈로그 머리말 *"나머지 타입은 그 타입을 구현할 때 같은 표에 행을 더한다"*
--
-- 값은 대상 표의 행 id 하나다. SQL 조각은 `src/lib/database/filter.ts` 가 0113 의 `relation_edge` 길에 `e.to_page_id = 값` 을 더해 만든다.
-- 비어 있음 · 비어 있지 않음 뒤에 둔다 — 새 규칙의 기본 연산자는 값이 필요 없는 첫 줄 그대로다. 두 곳의 일치는 `filter.db.test.ts` 가 강제한다.
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('relation', 'contains',         1, '포함',         3),
  ('relation', 'does_not_contain', 1, '포함하지 않음', 4);
