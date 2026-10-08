-- 캘린더 레이아웃 — 날짜 속성 · 보기 단위 — DB 심화 2g-1조각 (F-04-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 캘린더
--       04-database-views.md F-04-06 *"`date_property_id` 필수 · `view_range`: week | month"*
--
-- `view.configuration` 의 둘째 손님이다(첫째는 갤러리 0057). `configuration.calendar = { date_property_id, view_range }` 한 키 · 두 키를
-- 늘 함께 쓴다(`database/calendar.ts`). 날짜 속성이 살아 있는지 · 날짜 타입인지는 명령이 고를 때 보고 읽을 때 아니면 null 로 준다 —
-- 속성은 지워졌다 돌아올 수 있으므로 여기서 FK 로 묶지 않는다(그룹 속성과 같은 태도 · 0022).
--
-- ⚠ 묶음 전체를 `IS TRUE` 로 접는다 — 키가 빠지면 NULL 이 되어 통과하는 구멍(0055 · 0057 과 같다).

ALTER TABLE view
  ADD CONSTRAINT ck_view_calendar_layout
  CHECK (
    NOT (configuration ? 'calendar')
    OR (
      jsonb_typeof(configuration -> 'calendar') = 'object'
      AND jsonb_typeof(configuration -> 'calendar' -> 'date_property_id') = 'string'
      AND (configuration -> 'calendar' ->> 'view_range') IN ('month', 'week')
    ) IS TRUE
  );
