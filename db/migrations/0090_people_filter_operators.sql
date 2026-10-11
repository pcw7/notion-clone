-- 사람 속성의 필터 연산자 — 카탈로그에 넷 — 게시 · 공유 6g-1조각 (F-03-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] 사람 속성 ④
--       0015 의 카탈로그 머리말 *"나머지 타입은 그 타입을 구현할 때 같은 표에 행을 더한다"*
--
-- 포함 · 포함하지 않음(값은 사람 id 하나) · 비어 있음 · 비어 있지 않음. SQL 조각은 `src/lib/database/filter.ts` 의 화이트리스트에 있고
-- 두 곳의 일치는 `filter.db.test.ts` 가 강제한다. "나(me)" 는 필터 평가 컨텍스트(VW1)와 함께 — 뒤로.
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('people', 'contains',         1, '포함',         1),
  ('people', 'does_not_contain', 1, '포함하지 않음', 2),
  ('people', 'is_empty',         0, '비어 있음',     3),
  ('people', 'is_not_empty',     0, '비어 있지 않음', 4);
