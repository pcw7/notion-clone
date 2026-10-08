-- 열 집계의 함수 이름 — DB 심화 2d-1조각 (F-04-16)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 열 집계 ①
--       04-database-views.md F-04-16
--
-- 0015 가 `view_property.calculation text NULL` 자리만 뒀다. 값은 함수 이름 하나이고 목록은 `database/calculations.ts` 의
-- `CALCULATIONS` 와 같다(바꾸면 둘을 함께). 타입에 맞는지는 명령이 고를 때 보고, 읽을 때 맞지 않으면 무시한다 — 타입을 바꾸면
-- 맞지 않게 될 수 있으므로 여기서 타입과 묶지 않는다.
ALTER TABLE view_property
  ADD CONSTRAINT ck_view_property_calculation
  CHECK (calculation IS NULL OR calculation IN (
    'count_all', 'count_values', 'count_empty', 'count_unique', 'percent_empty', 'percent_not_empty',
    'sum', 'average', 'median', 'min', 'max', 'range',
    'earliest_date', 'latest_date', 'date_range',
    'checked', 'unchecked', 'percent_checked', 'percent_unchecked'
  ));
