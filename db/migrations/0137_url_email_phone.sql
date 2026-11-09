-- URL · 이메일 · 전화 속성(url · email · phone_number) — 칸의 모양 가드 · 필터 연산자 — PT-2조각 (F-03-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 PT-1] ⑥ [PT-2] URL · 이메일 · 전화
--       0013 `property_type` (세 타입은 이미 ENUM 에 있다) · 0015 §③ `filter_operator` · 0025 · 0053 · 0133 · 0136 (칸 가드의 계열)
--
-- ① 칸의 모양 — `{type:'url', url}` · `{type:'email', email}` · `{type:'phone_number', phone_number}`. 값은 **글 하나**이고 비어 있지 않다
--    (빈 값은 칸이 없다 — 앱이 비울 때 칸을 지운다). 길이 상한은 URL 2048 · 이메일 254 · 전화 64.
--    **적는 것은 너그럽게**: 글이면 무엇이든 받는다(`javascript:` 도 저장된다). 링크로 거는 것은 그릴 때 거른다(`contact-links.ts`).
-- ③ 필터 — 글(`rich_text`)과 같은 여덟 연산자. SQL 조각은 `filter.ts` 의 `TEXT_OPERATORS` 이고 일치는 테스트가 강제한다.
--
-- 기존 행: 새 행만 더한다(세 타입은 이 조각 전에는 만들 수 없었다).

CREATE FUNCTION page_property_value_contact_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
  v jsonb := NEW.value;
  max_len int;
BEGIN
  SELECT type::text INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type IS NULL OR owner_type NOT IN ('url', 'email', 'phone_number') THEN
    RETURN NEW;
  END IF;

  max_len := CASE owner_type WHEN 'url' THEN 2048 WHEN 'email' THEN 254 ELSE 64 END;

  IF jsonb_typeof(v) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v)) <> 2
     OR NOT (v ? 'type')
     OR NOT (v ? owner_type)
     OR v ->> 'type' IS DISTINCT FROM owner_type
     OR jsonb_typeof(v -> owner_type) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION '% 칸의 모양이 아니다 (property %)', owner_type, NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_contact_shape';
  END IF;

  IF length(v ->> owner_type) = 0 THEN
    RAISE EXCEPTION '% 칸은 비어 있을 수 없다 — 빈 값은 칸이 없다 (property %)', owner_type, NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_contact_shape';
  END IF;

  IF length(v ->> owner_type) > max_len THEN
    RAISE EXCEPTION '% 칸은 %자까지다 (property %)', owner_type, max_len, NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_contact_shape';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_contact_shape() IS
  'PT-2 ①. URL · 이메일 · 전화 칸은 {type, <type>: 글} — 글은 비어 있지 않고 URL 2048 · 이메일 254 · 전화 64자 이하.';

CREATE TRIGGER tg_ppv_contact_shape
  BEFORE INSERT OR UPDATE OF property_id, value ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_contact_shape();

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx)
SELECT t.property_type, o.operator, o.arity, o.label_ko, o.order_idx
  FROM (VALUES ('url'::property_type), ('email'::property_type), ('phone_number'::property_type)) t(property_type)
 CROSS JOIN (SELECT operator, arity, label_ko, order_idx FROM filter_operator WHERE property_type = 'rich_text') o;
