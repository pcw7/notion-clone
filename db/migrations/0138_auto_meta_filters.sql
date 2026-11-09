-- 만든 시각 · 만든 사람 · 마지막 편집 시각 · 마지막 편집 사람의 필터 연산자 — PT-3조각 (F-03-08 · F-03-17)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 PT-1] ⑦ (자동 메타 4종 — 칸이 없다 · 불변식 C1)
--       0013 `property_type` (네 타입은 이미 ENUM 에 있다) · 0015 §③ `filter_operator` · 0116 (상대 날짜)
--
-- 칸 가드는 더하지 않는다 — 0025 가 이 네 타입의 칸을 이미 막는다(불변식 C1). 값은 그 행 페이지 블록의 열(`created_at` · `created_by` ·
-- `last_edited_at` · `last_edited_by`)이고, SQL 조각은 `src/lib/database/filter.ts` 가 만든다. 두 곳의 일치는 `filter.db.test.ts` 가 강제한다.
-- 시각은 날짜의 연산자 열넷(상대 날짜 포함), 사람은 사람의 연산자 넷이다.
--
-- 기존 행: 새 행만 더한다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx)
SELECT t.property_type::property_type, d.operator, d.arity, d.label_ko, d.order_idx
  FROM (VALUES ('created_time'), ('last_edited_time')) AS t(property_type)
 CROSS JOIN (VALUES
   ('equals',       1, '같음',          1),
   ('before',       1, '이전',          2),
   ('after',        1, '이후',          3),
   ('on_or_before', 1, '이전이거나 같음', 4),
   ('on_or_after',  1, '이후거나 같음',  5),
   ('is_empty',     0, '비어 있음',      6),
   ('is_not_empty', 0, '비어 있지 않음',  7),
   ('past_week',    0, '지난 1주 안',    8),
   ('past_month',   0, '지난 1개월 안',  9),
   ('past_year',    0, '지난 1년 안',   10),
   ('this_week',    0, '이번 주',       11),
   ('next_week',    0, '다음 1주 안',   12),
   ('next_month',   0, '다음 1개월 안', 13),
   ('next_year',    0, '다음 1년 안',   14)
 ) AS d(operator, arity, label_ko, order_idx);

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx)
SELECT t.property_type::property_type, d.operator, d.arity, d.label_ko, d.order_idx
  FROM (VALUES ('created_by'), ('last_edited_by')) AS t(property_type)
 CROSS JOIN (VALUES
   ('contains',         1, '포함',          1),
   ('does_not_contain', 1, '포함하지 않음',   2),
   ('is_empty',         0, '비어 있음',      3),
   ('is_not_empty',     0, '비어 있지 않음',  4)
 ) AS d(operator, arity, label_ko, order_idx);
