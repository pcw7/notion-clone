-- 타임라인 막대 색 — 선택 · 상태 속성의 옵션 색으로 — 41번 트랙 TL-7 (F-04-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강 TL-7] ①
--       04-database-views.md F-04-07 `color_by`
--
-- `ck_view_timeline_layout`(0128)을 넓힌다: 세 키(`date_property_id` · `zoom` · `show_table`)는 늘 있어야 하고, `color_by` 는 **있을 때만** 글이다.
-- 그 밖의 키는 여전히 거부한다.
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 묶음 전체를 `IS TRUE` 로 접는다(0128 과 같은 함정).

ALTER TABLE view DROP CONSTRAINT ck_view_timeline_layout;

ALTER TABLE view
  ADD CONSTRAINT ck_view_timeline_layout
  CHECK (
    NOT (configuration ? 'timeline')
    OR (
      jsonb_typeof(configuration -> 'timeline') = 'object'
      AND ((configuration -> 'timeline') - ARRAY['date_property_id', 'zoom', 'show_table', 'color_by']::text[]) = '{}'::jsonb
      AND jsonb_typeof(configuration -> 'timeline' -> 'date_property_id') = 'string'
      AND (configuration -> 'timeline' ->> 'zoom') IN ('day', 'week', 'month', 'quarter', 'year')
      AND jsonb_typeof(configuration -> 'timeline' -> 'show_table') = 'boolean'
      AND (NOT (configuration -> 'timeline' ? 'color_by') OR jsonb_typeof(configuration -> 'timeline' -> 'color_by') = 'string')
    ) IS TRUE
  );
