-- 장소 속성(place) — 칸의 모양 가드 · 필터 연산자 — MP-1조각 (F-03-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 MP-1] ① ④ [MP-1] 장소 속성
--       0013 `property_type`(place 는 이미 ENUM 에 있다) · 0015 §③ `filter_operator` · 0025 · 0053 · 0133 · 0136 · 0137 · 0139 (칸 가드의 계열)
--
-- ① 칸의 모양 — `{type:'place', place:{name, address, lat, lng}}`. 이름 1~255자 · 주소 0~500자(없으면 빈 글) · lat -90~90 · lng -180~180 의 수.
--    키는 그 넷뿐이다(남는 키는 막는다). 장소 값은 장소 속성의 칸에만 선다.
-- ④ 필터 — 글(`rich_text`)과 같은 여덟 연산자. 사이드카 text 는 이름이고, 포함 · 포함하지 않음은 주소도 본다(SQL 조각은 `filter.ts` 의
--    `PLACE_OPERATORS` 이고 목록의 일치는 테스트가 강제한다).
--
-- 기존 행: 새 행만 더한다(장소 속성은 이 조각 전에는 만들 수 없었다).

CREATE FUNCTION page_property_value_place_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
  v jsonb := NEW.value;
  p jsonb;
BEGIN
  SELECT type::text INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type IS DISTINCT FROM 'place' THEN
    IF jsonb_typeof(v) = 'object' AND v ->> 'type' = 'place' THEN
      RAISE EXCEPTION '장소 값은 장소 속성의 칸에만 선다 (property %)', NEW.property_id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_place_shape';
    END IF;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v) <> 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM ARRAY['place', 'type']
     OR v ->> 'type' IS DISTINCT FROM 'place'
     OR jsonb_typeof(v -> 'place') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '장소 칸의 모양이 아니다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_place_shape';
  END IF;

  p := v -> 'place';
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM ARRAY['address', 'lat', 'lng', 'name']
     OR jsonb_typeof(p -> 'name') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p -> 'address') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p -> 'lat') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'lng') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION '장소 칸의 모양이 아니다 — name · address · lat · lng 뿐이다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_place_shape';
  END IF;

  IF length(p ->> 'name') NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION '장소 이름은 1~255자다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_place_shape';
  END IF;
  IF length(p ->> 'address') > 500 THEN
    RAISE EXCEPTION '장소 주소는 500자까지다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_place_shape';
  END IF;
  IF (p ->> 'lat')::numeric NOT BETWEEN -90 AND 90 OR (p ->> 'lng')::numeric NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION '좌표가 범위 밖이다 — lat -90~90 · lng -180~180 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_place_shape';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_place_shape() IS
  'MP-1 ①. 장소 칸은 {type, place:{name 1~255, address 0~500, lat -90~90, lng -180~180}} — 키는 그뿐이다.';

CREATE TRIGGER tg_ppv_place_shape
  BEFORE INSERT OR UPDATE OF property_id, value ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_place_shape();

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx)
SELECT 'place'::property_type, operator, arity, label_ko, order_idx
  FROM filter_operator WHERE property_type = 'rich_text';
