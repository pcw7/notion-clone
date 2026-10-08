-- 셀 봉투의 타입은 프로퍼티의 타입과 같다(불변식 CV1) — DB 심화 2c-1조각 (F-03-14)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] 프로퍼티 타입 바꾸기 ⑥
--       03-database-core.md F-03-14 *"변환 도중 다른 사용자가 셀 편집 → 변환 중 프로퍼티 쓰기 잠금 필요"*
--
-- `page_property_value.value` 는 자기 타입을 들고 있는 판별 유니온이다(`property-types.ts` 머리말). 타입 바꾸기(2c-1)가 생기면서
-- "프로퍼티는 number 인데 칸에는 옛 rich_text 봉투가 있는" 상태가 생길 길이 열렸다 — 변환과 엇갈린 셀 쓰기가 변환 **전에** 읽은 스키마로
-- 옛 타입의 봉투를 쓰는 경우다(셀 쓰기는 data source 를 잠그지 않는다). 그 쓰기를 여기서 막는다.
--
-- 읽는 쪽(`cell-format.ts` `readCell`)은 이미 어긋난 봉투를 빈 값으로 읽는다 — 그것은 **방어**이고, 이 트리거는 **원천**을 막는다.

-- 이미 어긋난 칸이 있으면 실패한다(트리거는 새 쓰기만 막는다 — 0025 와 같은 태도).
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM page_property_value v
    JOIN property p ON p.id = v.property_id
   WHERE v.value->>'type' IS DISTINCT FROM p.type::text;
  IF bad > 0 THEN
    RAISE EXCEPTION '봉투의 타입이 프로퍼티의 타입과 다른 칸이 %개 있다 — 고치고 다시 실행한다', bad;
  END IF;
END $$;

CREATE FUNCTION page_property_value_value_type() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
BEGIN
  SELECT type::text INTO owner_type FROM property WHERE id = NEW.property_id;
  IF NEW.value->>'type' IS DISTINCT FROM owner_type THEN
    RAISE EXCEPTION '칸의 타입(%)이 프로퍼티의 타입(%)과 다르다 (property %)', NEW.value->>'type', owner_type, NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_value_type';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_value_type() IS
  '불변식 CV1. 칸의 봉투(value.type)는 그 프로퍼티의 지금 타입과 같다 — 타입 바꾸기와 엇갈린 옛 타입의 셀 쓰기를 막는다.';

CREATE TRIGGER tg_ppv_value_type
  BEFORE INSERT OR UPDATE OF property_id, value ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_value_type();
