-- relation 속성의 필터 연산자 — 비어 있음 · 비어 있지 않음 — §7 정리 10n-44 (F-04-09 · F-03-10)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-44] relation 으로 거르기
--       0015 의 카탈로그 머리말 *"나머지 타입은 그 타입을 구현할 때 같은 표에 행을 더한다"*
--
-- relation 의 값은 칸이 아니라 엣지다 — SQL 조각은 `src/lib/database/filter.ts` 가 사이드카가 아니라 `relation_edge`(살아 있는 · 템플릿이
-- 아닌 대상 행)를 보는 길로 만든다. 포함 · 포함하지 않음(값은 행 하나)은 화면의 행 고르개와 함께 뒤에 더한다. 두 곳의 일치는
-- `filter.db.test.ts` 가 강제한다.
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('relation', 'is_empty',     0, '비어 있음',     1),
  ('relation', 'is_not_empty', 0, '비어 있지 않음', 2);
