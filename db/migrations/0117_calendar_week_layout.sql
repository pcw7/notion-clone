-- 캘린더의 주 시작 요일 · 주말 숨기기 — 캘린더의 나머지 트랙 C-3 (F-04-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 캘린더 ① · ⑦
--       04 F-04-06 *"`view.configuration = { date_property_id, view_range, show_weekends, properties[] }`"* — 0058 이 "아직 없다"로 남긴
--       `show_weekends` 와 주의 시작 요일(그룹의 주 시작 [보강 B-3] B-3b 와 같은 두 값).
--
-- `configuration.calendar` 에 키 둘 — 둘 다 **기본값이면 싣지 않는다**(일요일 · 주말을 그린다 — 지금까지의 격자):
--   week_start     'sunday' | 'monday'
--   show_weekends  boolean
-- 0058 의 CHECK 를 같은 이름으로 다시 건다(묶음 전체를 `IS TRUE` — 키가 있는데 값이 null 이면 거부된다). 프로브는 verify-schema [41].
--
-- 기존 행: 두 키가 없다 — 그대로 통과한다.

ALTER TABLE view DROP CONSTRAINT ck_view_calendar_layout;

ALTER TABLE view
  ADD CONSTRAINT ck_view_calendar_layout
  CHECK (
    NOT (configuration ? 'calendar')
    OR (
      jsonb_typeof(configuration -> 'calendar') = 'object'
      AND jsonb_typeof(configuration -> 'calendar' -> 'date_property_id') = 'string'
      AND (configuration -> 'calendar' ->> 'view_range') IN ('month', 'week')
      AND (NOT (configuration -> 'calendar' ? 'week_start') OR (configuration -> 'calendar' ->> 'week_start') IN ('sunday', 'monday'))
      AND (NOT (configuration -> 'calendar' ? 'show_weekends') OR jsonb_typeof(configuration -> 'calendar' -> 'show_weekends') = 'boolean')
    ) IS TRUE
  );
