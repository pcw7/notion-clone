-- 열 집계 · 그룹 머리의 계산에 "완료 비율" — §7 정리 10n-30 (F-04-16 · F-03-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 열 집계 ① [보강 10n-30]
--       03 F-03-05 *"'완료' 판정(Complete 그룹 소속 여부)은 진행률 계산의 기준"* — rollup 의 완료 비율(10n-29)과 같은 뜻을 표 아래 ·
--       보드 머리에도
--
-- 함수 이름의 목록은 `is_calculation_name` 하나다(0055 ①) — 그 목록에 `percent_complete` 를 더한다. 목록은 `database/calculations.ts` 의
-- `CALCULATIONS` 와 같다(둘의 일치는 검사가 본다). 두 CHECK(`ck_view_property_calculation` · `ck_view_group_by_calculation`)가 이 함수를
-- 보므로 함께 넓어진다. 이름을 더하기만 하므로 이미 있는 행은 그대로 맞다.

CREATE OR REPLACE FUNCTION is_calculation_name(name text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT name IN (
      'count_all', 'count_values', 'count_empty', 'count_unique', 'percent_empty', 'percent_not_empty',
      'sum', 'average', 'median', 'min', 'max', 'range',
      'earliest_date', 'latest_date', 'date_range',
      'checked', 'unchecked', 'percent_checked', 'percent_unchecked',
      'percent_complete'
    )
  $$;
