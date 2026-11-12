-- 지도 뷰 레이아웃 — 기준 장소 속성 · 높이 — MP-2 (F-04-19)
--
-- 정본: docs/research/00-canonical-data-model.md [보강 MP-1] ⑥
--       04-database-views.md F-04-19
--
-- 지도의 설정은 `configuration.map` 한 키에 둔다: `{ map_by, height }`. 둘 다 늘 쓴다(명령이 지금 값 위에 합쳐서 쓴다 · `database/map.ts`).
-- `map_by` 는 장소 속성 id 또는 null(null 이면 첫 장소 속성) — 이 데이터베이스의 장소 속성인지는 명령이 본다(다른 표의 속성 id 는 CHECK 이 모른다).
-- `height` 는 240~960 px 정수. 모르는 키는 거부한다(정확히 이 두 키).
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 키가 빠지면 `->>` 가 NULL 이고 비교도 NULL 이다. 묶음 전체를 `IS TRUE` 로 접는다(0057 · 0127 과 같은 함정).

ALTER TABLE view
  ADD CONSTRAINT ck_view_map_layout
  CHECK (
    NOT (configuration ? 'map')
    OR (
      jsonb_typeof(configuration -> 'map') = 'object'
      AND ((configuration -> 'map') - ARRAY['map_by', 'height']::text[]) = '{}'::jsonb
      AND (configuration -> 'map') ? 'map_by'
      AND jsonb_typeof(configuration -> 'map' -> 'map_by') IN ('string', 'null')
      AND jsonb_typeof(configuration -> 'map' -> 'height') = 'number'
      -- 정수만(소수는 글에 점이 있다) · 형 변환은 정수 글일 때만 — AND 의 평가 순서는 정해져 있지 않아 CASE 로 막는다
      AND CASE WHEN (configuration -> 'map' ->> 'height') ~ '^[0-9]{1,4}$'
               THEN (configuration -> 'map' ->> 'height')::int BETWEEN 240 AND 960
               ELSE false END
    ) IS TRUE
  );
