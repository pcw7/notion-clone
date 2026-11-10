-- 파일과 미디어 속성(files) — 칸의 모양 가드 · 참조 장부 · 필터 연산자 — PT-4조각 (F-03-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 PT-1] ⑧ [PT-4] 파일과 미디어
--       0009 `file`(불변식 FS1 — `ref_count > 0` 은 지우지 않는다) · 0013 `property_type`(files 는 이미 ENUM 에 있다) · 0015 §③ `filter_operator`
--       0025 · 0053 · 0133 · 0136 · 0137 (칸 가드의 계열)
--
-- ① 칸의 모양 — `{type:'files', files:[{id, name}, …]}`. id 는 **그 행과 같은 워크스페이스의 `file`** 이고, 같은 id 는 한 번, 20개 이하,
--    이름은 1~255자. 빈 목록(`files: []`)은 비운 칸이다(사람 칸과 같다).
--    파일 값은 파일 속성의 칸에만 선다 — 다른 타입의 칸에 files 값이 있으면 아래 ② 의 장부가 어긋난다.
-- ② 참조 장부 — 칸이 가리키는 파일은 파일 블록 · 아이콘 · 커버와 **같은 장부**(`file.ref_count`)에 센다. 앱 쪽 명령마다 세면 칸을 쓰는 길
--    (셀 쓰기 · 템플릿으로 행 만들기 · 데이터베이스 복제 · 영구 삭제의 CASCADE · 워크스페이스 삭제)이 하나라도 빠지면 장부가 어긋나므로
--    **칸 표의 트리거가 센다**: 넣으면 +1 · 빼면 −1 · 칸이 사라지면(행 · 속성의 물리 삭제) −1. 바닥은 0(프로젝터와 같다 — 어긋나면 덜 지우는 쪽).
--    휴지통 · 영구 삭제(purged)는 칸을 지우지 않으므로 내리지 않는다(되살릴 수 있다) — 30일 뒤 물리 삭제가 CASCADE 로 내린다.
-- ③ 필터 — `is_empty` · `is_not_empty`. 정렬은 없다.
--
-- 기존 행: 새 행만 더한다(파일 속성은 이 조각 전에는 만들 수 없었다).

CREATE FUNCTION page_property_value_files_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
  v jsonb := NEW.value;
  list jsonb;
  n int;
  ws uuid;
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT type::text INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type IS DISTINCT FROM 'files' THEN
    IF jsonb_typeof(v) = 'object' AND v ->> 'type' = 'files' THEN
      RAISE EXCEPTION '파일 값은 파일과 미디어 속성의 칸에만 선다 (property %)', NEW.property_id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_files_shape';
    END IF;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v) <> 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM ARRAY['files', 'type']
     OR v ->> 'type' IS DISTINCT FROM 'files'
     OR jsonb_typeof(v -> 'files') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '파일 칸의 모양이 아니다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_files_shape';
  END IF;

  list := v -> 'files';
  n := jsonb_array_length(list);
  IF n > 20 THEN
    RAISE EXCEPTION '파일 칸은 파일 20개까지다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_files_shape';
  END IF;

  -- 원소는 {id, name} 뿐인 객체 — id 는 uuid 글자, 이름은 1~255자
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(list) e(x)
     WHERE jsonb_typeof(e.x) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.x) k) IS DISTINCT FROM ARRAY['id', 'name']
        OR jsonb_typeof(e.x -> 'id') IS DISTINCT FROM 'string'
        OR e.x ->> 'id' !~* uuid_re
        OR jsonb_typeof(e.x -> 'name') IS DISTINCT FROM 'string'
        OR length(e.x ->> 'name') NOT BETWEEN 1 AND 255
  ) THEN
    RAISE EXCEPTION '파일 칸의 원소가 {id, name} 이 아니다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_files_shape';
  END IF;

  IF (SELECT count(DISTINCT lower(e.x ->> 'id')) FROM jsonb_array_elements(list) e(x)) <> n THEN
    RAISE EXCEPTION '파일 칸에 같은 파일이 두 번 있다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_files_shape';
  END IF;

  -- 그 행과 같은 워크스페이스의 파일만 — 다른 워크스페이스의 id 를 적어 넣어도 받지 않는다
  SELECT workspace_id INTO ws FROM block WHERE id = NEW.page_id;
  IF (SELECT count(*) FROM file f
       WHERE f.workspace_id = ws
         AND f.id::text IN (SELECT lower(e.x ->> 'id') FROM jsonb_array_elements(list) e(x))) <> n THEN
    RAISE EXCEPTION '파일 칸에 이 워크스페이스의 파일이 아닌 id 가 있다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_files_shape';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_files_shape() IS
  'PT-4 ①. 파일 칸은 {type, files:[{id, name}…]} — id 는 그 행과 같은 워크스페이스의 파일 · 중복 없음 · 20개 이하 · 이름 1~255자.';

CREATE TRIGGER tg_ppv_files_shape
  BEFORE INSERT OR UPDATE OF property_id, value ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_files_shape();

CREATE FUNCTION page_property_value_files_refs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_ids uuid[] := ARRAY[]::uuid[];
  new_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- 값의 타입 표지로 가른다 — 가드(위)가 파일 값은 파일 속성에만 서게 했다. 속성 행이 먼저 지워지는 CASCADE 에서도 읽을 수 있다
  IF TG_OP IN ('UPDATE', 'DELETE') AND jsonb_typeof(OLD.value) = 'object' AND OLD.value ->> 'type' = 'files' THEN
    old_ids := ARRAY(SELECT (e.x ->> 'id')::uuid FROM jsonb_array_elements(OLD.value -> 'files') e(x));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND jsonb_typeof(NEW.value) = 'object' AND NEW.value ->> 'type' = 'files' THEN
    new_ids := ARRAY(SELECT (e.x ->> 'id')::uuid FROM jsonb_array_elements(NEW.value -> 'files') e(x));
  END IF;
  IF old_ids = ARRAY[]::uuid[] AND new_ids = ARRAY[]::uuid[] THEN
    RETURN NULL;
  END IF;

  -- 두 칸이 같은 파일을 서로 반대 순서로 잡아 교착하지 않게 id 순으로 잠근다
  PERFORM 1 FROM file WHERE id = ANY(old_ids || new_ids) ORDER BY id FOR NO KEY UPDATE;
  UPDATE file SET ref_count = ref_count + 1
   WHERE id = ANY(new_ids) AND NOT (id = ANY(old_ids));
  UPDATE file SET ref_count = GREATEST(ref_count - 1, 0)
   WHERE id = ANY(old_ids) AND NOT (id = ANY(new_ids));
  RETURN NULL;
END $$;

COMMENT ON FUNCTION page_property_value_files_refs() IS
  'PT-4 ②. 파일 칸이 가리키는 파일의 참조 수(file.ref_count) — 넣으면 +1 · 빼면 −1 · 칸이 사라지면 −1. 파일 블록 · 아이콘 · 커버와 같은 장부.';

CREATE TRIGGER tg_ppv_files_refs
  AFTER INSERT OR UPDATE OF value OR DELETE ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_files_refs();

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('files', 'is_empty',     0, '비어 있음',     1),
  ('files', 'is_not_empty', 0, '비어 있지 않음', 2);
