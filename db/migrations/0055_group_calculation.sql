-- 그룹 집계 — 보드 그룹 머리의 계산 — DB 심화 2d-3조각 (F-04-16)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 열 집계 ⑤ · [보강] `view.group_by` 의 모양
--       04-database-views.md F-04-16 *"그룹 헤더 집계는 `view.group_by.calculation`"*
--
-- ① 함수 이름의 목록을 함수 하나(`is_calculation_name`)로 모은다. 0054 가 `view_property.calculation` 의 CHECK 에 목록을 그대로
--    적었는데, 그룹 머리의 계산도 같은 목록을 본다 — 두 벌을 두면 하나만 고치는 날이 온다. 0054 의 제약을 같은 이름으로 다시 건다.
--    목록은 `database/calculations.ts` 의 `CALCULATIONS` 와 같다(바꾸면 둘을 함께 — 검사가 둘의 일치를 본다).
-- ② `view.group_by.calculation = { property_id, function }` — 없으면 카드 수(노션 보드의 기본). 모양과 함수 이름을 CHECK 으로 막는다.
--    프로퍼티가 살아 있는지 · 타입에 맞는지는 명령이 고를 때 보고, 읽을 때 맞지 않으면 무시한다(열 집계와 같은 태도 — 0054 머리말).
--
-- ⚠ CHECK 은 **NULL 이면 통과**다. `jsonb_typeof(없는 키)` 는 NULL 이고 `NULL = 'string'` 도 NULL 이라, 조건을 그대로 AND 로 이으면
--   `property_id` 가 없는 계산이 통과한다(처음 그렇게 썼고 verify-schema 의 프로브가 잡았다). 묶음 전체를 `IS TRUE` 로 접는다.

CREATE FUNCTION is_calculation_name(name text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT name IN (
      'count_all', 'count_values', 'count_empty', 'count_unique', 'percent_empty', 'percent_not_empty',
      'sum', 'average', 'median', 'min', 'max', 'range',
      'earliest_date', 'latest_date', 'date_range',
      'checked', 'unchecked', 'percent_checked', 'percent_unchecked'
    )
  $$;

ALTER TABLE view_property
  DROP CONSTRAINT ck_view_property_calculation,
  ADD CONSTRAINT ck_view_property_calculation
  CHECK (calculation IS NULL OR is_calculation_name(calculation));

ALTER TABLE view
  ADD CONSTRAINT ck_view_group_by_calculation
  CHECK (
    group_by IS NULL
    OR jsonb_typeof(group_by) <> 'object'
    OR NOT (group_by ? 'calculation')
    OR (
      jsonb_typeof(group_by -> 'calculation') = 'object'
      AND jsonb_typeof(group_by -> 'calculation' -> 'property_id') = 'string'
      AND jsonb_typeof(group_by -> 'calculation' -> 'function') = 'string'
      AND is_calculation_name(group_by -> 'calculation' ->> 'function')
    ) IS TRUE
  );
