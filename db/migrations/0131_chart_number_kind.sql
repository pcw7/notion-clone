-- 차트 종류에 값 하나(number) — 43번 트랙 CH-4 (F-04-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강 CH-4] ①
--
-- 0127 의 `ck_view_chart_layout` 에서 kind 목록만 넓힌다(column · bar · line · donut · number). 나머지 규칙은 0127 그대로다 —
-- 정확히 `kind` · `data_labels` · `cumulative` 세 키, 뒤의 둘은 boolean. 값의 목록은 `database/chart.ts` 의 `CHART_KINDS` 와 같다.
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 묶음 전체를 `IS TRUE` 로 접는다(0127 과 같은 함정).

ALTER TABLE view DROP CONSTRAINT ck_view_chart_layout;

ALTER TABLE view
  ADD CONSTRAINT ck_view_chart_layout
  CHECK (
    NOT (configuration ? 'chart')
    OR (
      jsonb_typeof(configuration -> 'chart') = 'object'
      AND ((configuration -> 'chart') - ARRAY['kind', 'data_labels', 'cumulative']::text[]) = '{}'::jsonb
      AND (configuration -> 'chart' ->> 'kind') IN ('column', 'bar', 'line', 'donut', 'number')
      AND jsonb_typeof(configuration -> 'chart' -> 'data_labels') = 'boolean'
      AND jsonb_typeof(configuration -> 'chart' -> 'cumulative') = 'boolean'
    ) IS TRUE
  );
