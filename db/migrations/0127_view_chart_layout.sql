-- 차트 뷰 레이아웃 — 종류 · 값 표시 · 누적 — 38번 트랙 CH-1 (F-04-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강 CH-1] ③
--       04-database-views.md F-04-08
--
-- X축은 `view.group_by`, Y값은 `group_by.calculation`(없으면 개수)이라 차트만의 설정은 `configuration.chart` 한 키에 둔다:
-- `{ kind, data_labels, cumulative }`. 셋 다 늘 쓴다(명령이 지금 값 위에 합쳐서 쓴다 · `database/chart.ts`). 값의 목록은 그 파일의 상수와 같다.
-- 모르는 키는 거부한다(정확히 이 세 키).
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 키가 빠지면 `->>` 가 NULL 이고 `NULL IN (…)` 도 NULL 이다. 묶음 전체를 `IS TRUE` 로 접는다(0057 과 같은 함정).

ALTER TABLE view
  ADD CONSTRAINT ck_view_chart_layout
  CHECK (
    NOT (configuration ? 'chart')
    OR (
      jsonb_typeof(configuration -> 'chart') = 'object'
      AND ((configuration -> 'chart') - ARRAY['kind', 'data_labels', 'cumulative']::text[]) = '{}'::jsonb
      AND (configuration -> 'chart' ->> 'kind') IN ('column', 'bar', 'line', 'donut')
      AND jsonb_typeof(configuration -> 'chart' -> 'data_labels') = 'boolean'
      AND jsonb_typeof(configuration -> 'chart' -> 'cumulative') = 'boolean'
    ) IS TRUE
  );
