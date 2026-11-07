-- 타임라인 뷰 레이아웃 — 날짜 속성 · 줌 · 왼쪽 표 — 41번 트랙 TL-1 (F-04-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강 TL-1] ②
--       04-database-views.md F-04-07
--
-- 설정은 `configuration.timeline` 한 키에 둔다: `{ date_property_id, zoom, show_table }`. 셋 다 늘 쓴다(명령이 지금 값 위에 합쳐서 쓴다 ·
-- `database/timeline.ts`). `zoom` 의 값 목록은 그 파일의 상수와 같다. 모르는 키는 거부한다(정확히 이 세 키).
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 키가 빠지면 `->>` 가 NULL 이고 `NULL IN (…)` 도 NULL 이다. 묶음 전체를 `IS TRUE` 로 접는다(0057 · 0127 과 같은 함정).

ALTER TABLE view
  ADD CONSTRAINT ck_view_timeline_layout
  CHECK (
    NOT (configuration ? 'timeline')
    OR (
      jsonb_typeof(configuration -> 'timeline') = 'object'
      AND ((configuration -> 'timeline') - ARRAY['date_property_id', 'zoom', 'show_table']::text[]) = '{}'::jsonb
      AND jsonb_typeof(configuration -> 'timeline' -> 'date_property_id') = 'string'
      AND (configuration -> 'timeline' ->> 'zoom') IN ('day', 'week', 'month', 'quarter', 'year')
      AND jsonb_typeof(configuration -> 'timeline' -> 'show_table') = 'boolean'
    ) IS TRUE
  );
