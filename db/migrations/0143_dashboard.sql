-- 대시보드 뷰 — 위젯 뷰와 배치 — DB-1 (F-04-20)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강 DB-1] ①②③
--       04-database-views.md F-04-20
--
-- 0015 가 자리만 만들어 둔 `owner_kind='dashboard_widget'` · `dashboard_view_id` · `dashboard_layout` 에 불변식을 건다.
--
--   ① 위젯 ⇔ 부모 대시보드가 있다           → ck_view_widget_parent
--   ② 위젯의 타입은 여덟 가지다(폼 · 대시보드는 안 된다 — 중첩 금지) → ck_view_widget_type
--   ③ 위젯은 볼 소스가 있다(0015 의 ck_view_needs_source 가 위젯만 면제했다) → ck_view_widget_source
--   ④ 대시보드 타입은 탭 뷰만 · 배치는 대시보드 뷰에만 → ck_view_dashboard_owner · ck_view_dashboard_layout_owner
--   ⑤ 배치의 모양                           → ck_view_dashboard_layout (함수 dashboard_layout_valid)
--   ⑥ 부모는 같은 데이터베이스의 대시보드 뷰다 → 트리거 view_widget_guard (다른 줄을 봐야 해서 CHECK 이 못 한다)
--
-- 위젯이 그 데이터베이스에 붙은 소스를 보는지는 0042 의 복합 FK(fk_view_attached_source)가 이미 막는다.
-- 배치의 칸이 그 대시보드의 위젯인지는 명령이 본다(CHECK 은 다른 줄을 못 본다).
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 함수가 NULL 을 돌려주는 모양(키가 빠졌다)을 `IS TRUE` 로 접는다(0057 · 0127 과 같은 함정).

-- ──────────────────────────────────────────────────────────────────────
-- 배치의 모양: {rows:[{height, cells:[{view_id}]}]}
--   줄 0~3 · 줄마다 칸 1~4(모두 12 이하는 여기서 따라 나온다) · height 는 small|medium|large · view_id 는 uuid 글 · 같은 id 는 한 번만
--   모르는 키는 거부한다.
-- ──────────────────────────────────────────────────────────────────────

CREATE FUNCTION dashboard_layout_valid(l jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  r jsonb;
  c jsonb;
  seen text[] := ARRAY[]::text[];
  id text;
BEGIN
  IF l IS NULL OR jsonb_typeof(l) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (l - 'rows') <> '{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(l -> 'rows') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(l -> 'rows') > 3 THEN RETURN false; END IF;

  FOR r IN SELECT e FROM jsonb_array_elements(l -> 'rows') AS e LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (r - ARRAY['height', 'cells']::text[]) <> '{}'::jsonb THEN RETURN false; END IF;
    IF jsonb_typeof(r -> 'height') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF (r ->> 'height') NOT IN ('small', 'medium', 'large') THEN RETURN false; END IF;
    IF jsonb_typeof(r -> 'cells') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(r -> 'cells') NOT BETWEEN 1 AND 4 THEN RETURN false; END IF;

    FOR c IN SELECT e FROM jsonb_array_elements(r -> 'cells') AS e LOOP
      IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
      IF (c - 'view_id') <> '{}'::jsonb THEN RETURN false; END IF;
      IF jsonb_typeof(c -> 'view_id') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      id := c ->> 'view_id';
      IF id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
      IF id = ANY (seen) THEN RETURN false; END IF;
      seen := seen || id;
    END LOOP;
  END LOOP;
  RETURN true;
END
$$;

ALTER TABLE view
  ADD CONSTRAINT ck_view_widget_parent
  CHECK ((owner_kind = 'dashboard_widget') = (dashboard_view_id IS NOT NULL));

ALTER TABLE view
  ADD CONSTRAINT ck_view_widget_type
  CHECK (owner_kind <> 'dashboard_widget'
         OR type IN ('table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart', 'map'));

ALTER TABLE view
  ADD CONSTRAINT ck_view_widget_source
  CHECK (owner_kind <> 'dashboard_widget' OR data_source_id IS NOT NULL);

-- 대시보드는 탭 뷰다(레이아웃 탭 · 위젯이 될 수 없다)
ALTER TABLE view
  ADD CONSTRAINT ck_view_dashboard_owner
  CHECK (type <> 'dashboard' OR owner_kind = 'database_view');

ALTER TABLE view
  ADD CONSTRAINT ck_view_dashboard_layout_owner
  CHECK (dashboard_layout IS NULL OR (owner_kind = 'database_view' AND type = 'dashboard'));

ALTER TABLE view
  ADD CONSTRAINT ck_view_dashboard_layout
  CHECK (dashboard_layout IS NULL OR dashboard_layout_valid(dashboard_layout) IS TRUE);

-- ──────────────────────────────────────────────────────────────────────
-- 위젯의 부모는 같은 데이터베이스의 대시보드 뷰다 · 위젯이 달린 대시보드는 타입 · 데이터베이스를 못 바꾼다
-- ──────────────────────────────────────────────────────────────────────

CREATE FUNCTION view_widget_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent record;
BEGIN
  IF NEW.owner_kind = 'dashboard_widget' THEN
    SELECT owner_kind, type, database_id INTO parent FROM view WHERE id = NEW.dashboard_view_id;
    IF NOT FOUND OR parent.owner_kind <> 'database_view' OR parent.type <> 'dashboard'
       OR parent.database_id IS DISTINCT FROM NEW.database_id THEN
      RAISE EXCEPTION 'dashboard widget parent must be a dashboard view of the same database'
        USING ERRCODE = '23514', CONSTRAINT = 'trg_view_widget_parent';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_view_widget_parent
  BEFORE INSERT OR UPDATE OF owner_kind, dashboard_view_id, database_id ON view
  FOR EACH ROW EXECUTE FUNCTION view_widget_guard();

CREATE FUNCTION view_dashboard_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.type = 'dashboard'
     AND (NEW.type IS DISTINCT FROM OLD.type OR NEW.database_id IS DISTINCT FROM OLD.database_id OR NEW.owner_kind IS DISTINCT FROM OLD.owner_kind)
     AND EXISTS (SELECT 1 FROM view w WHERE w.dashboard_view_id = OLD.id) THEN
    RAISE EXCEPTION 'dashboard with widgets cannot change type or database'
      USING ERRCODE = '23514', CONSTRAINT = 'trg_view_dashboard_parent';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_view_dashboard_parent
  BEFORE UPDATE OF type, database_id, owner_kind ON view
  FOR EACH ROW EXECUTE FUNCTION view_dashboard_parent_guard();

-- 위젯 목록(대시보드 하나의 위젯) 조회용
CREATE INDEX ix_view_by_dashboard ON view (dashboard_view_id) WHERE dashboard_view_id IS NOT NULL;
