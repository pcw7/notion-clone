-- 다중 선택 속성(multi_select) — 칸의 모양 가드 · 필터 연산자 — PT-1조각 (F-03-03 · F-03-04 · F-03-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 PT-1] ① 값 · ③ 필터
--       0013 `property_type` (multi_select 는 이미 ENUM 에 있다) · 0015 §③ `filter_operator` · 0025 · 0053 · 0133 (칸 가드의 계열)
--
-- ① 칸의 모양 — `{type:'multi_select', multi_select:[{id}, …]}`. id 는 **그 속성의 옵션**(`select_option` — select 와 같은 표)이고, 같은 id 는 한 번,
--    100개 이하다. 옵션이 그 속성의 것인지는 앱이 쓰기 전에 `FOR SHARE` 로 본다(`options.ts`) — 여기는 **마지막 문**이다. 옵션을 지우는 명령은
--    옵션 행을 먼저 지우고 칸에서 그 id 를 빼므로(`deleteSelectOption`) 이 트리거와 어긋나지 않는다.
-- ③ 필터 — `contains` · `does_not_contain`(값은 옵션 id 하나) · `is_empty` · `is_not_empty`. SQL 조각은 `filter.ts` 에 있고 일치는 `filter.db.test.ts` 가 강제한다.
--
-- 기존 행: 새 행만 더한다(다중 선택 속성은 이 조각 전에는 만들 수 없었다).

CREATE FUNCTION page_property_value_multi_select_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
  v jsonb := NEW.value;
  list jsonb;
  n int;
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT type::text INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type IS DISTINCT FROM 'multi_select' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v) <> 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM ARRAY['multi_select', 'type']
     OR jsonb_typeof(v -> 'multi_select') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '다중 선택 칸의 모양이 아니다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_multi_select_shape';
  END IF;

  list := v -> 'multi_select';
  n := jsonb_array_length(list);
  IF n > 100 THEN
    RAISE EXCEPTION '다중 선택은 옵션 100개까지다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_multi_select_shape';
  END IF;

  -- 원소는 {id} 하나뿐인 객체이고 id 는 uuid 글자다
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(list) e(x)
     WHERE jsonb_typeof(e.x) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.x) k) IS DISTINCT FROM ARRAY['id']
        OR jsonb_typeof(e.x -> 'id') IS DISTINCT FROM 'string'
        OR e.x ->> 'id' !~* uuid_re
  ) THEN
    RAISE EXCEPTION '다중 선택 칸의 원소가 {id} 가 아니다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_multi_select_shape';
  END IF;

  IF (SELECT count(DISTINCT lower(e.x ->> 'id')) FROM jsonb_array_elements(list) e(x)) <> n THEN
    RAISE EXCEPTION '다중 선택 칸에 같은 옵션이 두 번 있다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_multi_select_shape';
  END IF;

  IF (SELECT count(*) FROM select_option o
       WHERE o.property_id = NEW.property_id
         AND o.id::text IN (SELECT lower(e.x ->> 'id') FROM jsonb_array_elements(list) e(x))) <> n THEN
    RAISE EXCEPTION '다중 선택 칸에 이 속성의 옵션이 아닌 id 가 있다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_multi_select_shape';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_multi_select_shape() IS
  'PT-1 ①. 다중 선택 칸은 {type, multi_select:[{id}…]} — id 는 그 속성의 옵션 · 중복 없음 · 100개 이하.';

CREATE TRIGGER tg_ppv_multi_select_shape
  BEFORE INSERT OR UPDATE OF property_id, value ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_multi_select_shape();

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('multi_select', 'contains',         1, '포함',         1),
  ('multi_select', 'does_not_contain', 1, '포함하지 않음', 2),
  ('multi_select', 'is_empty',         0, '비어 있음',     3),
  ('multi_select', 'is_not_empty',     0, '비어 있지 않음', 4);
