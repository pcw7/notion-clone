-- 수식 값의 캐시 — 수식으로 거르기 · 정렬 — DB 심화 2j-2조각 (F-03-13)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `derived_value` · 불변식 D1 · [보강] `derived_value`
--       03-database-core.md F-03-13 *"stale 마킹 후 조회되는 페이지만 계산(lazy)"*
--
-- ① 표는 정본 DDL 에 사이드카 둘(`date_end` · `bool_value`)을 더한 것이다 — `page_property_value` 와 같은 다섯 축이어야 필터 컴파일러가
--    한 축 표로 두 표를 본다([보강] ①).
-- ② **수식만** 들어간다 — rollup 은 보는 사람마다 결과가 다르다([보강] ②). 그리고 그 행의 표의 수식이어야 한다(다른 표의 수식 값을
--    이 행에 두면 그 표의 필터가 엉뚱한 행을 거른다). 다른 표를 봐야 해서 CHECK 이 아니라 트리거다.
-- ③ 무효화는 트리거 셋이다([보강] ③) — 칸이 바뀌면 그 행 · 속성(타입 · 설정 · 지움/되살림 · 영구 삭제)이나 옵션(이름 · 추가 · 삭제)이
--    바뀌면 그 표의 수식 값 전부를 `stale` 로. 채우기는 애플리케이션이 거르기 직전에 한다(`derived-values.ts`).

CREATE TABLE derived_value (
  page_id     uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  value       jsonb NULL,
  num_value   numeric NULL,
  text_value  text NULL,
  date_start  timestamptz NULL,
  date_end    timestamptz NULL,
  bool_value  boolean NULL,
  stale       boolean NOT NULL DEFAULT true,
  computed_at timestamptz NULL,
  PRIMARY KEY (page_id, property_id)
);

-- 정본의 두 인덱스 — 낡은 것을 찾기 · 수로 거르기
CREATE INDEX ix_derived_value_stale ON derived_value (property_id) WHERE stale;
CREATE INDEX ix_derived_value_num ON derived_value (property_id, num_value) WHERE NOT stale AND num_value IS NOT NULL;

-- ② 수식만 · 그 행의 표의 수식
CREATE FUNCTION derived_value_formula_of_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM property f JOIN page p ON p.data_source_id = f.data_source_id
     WHERE f.id = NEW.property_id AND p.id = NEW.page_id AND f.type = 'formula'
  ) THEN
    RAISE EXCEPTION 'derived_value: 그 행의 표의 수식만 캐시한다 (% · %)', NEW.page_id, NEW.property_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tg_derived_value_formula_of_row';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_derived_value_formula_of_row
  BEFORE INSERT OR UPDATE OF page_id, property_id ON derived_value
  FOR EACH ROW EXECUTE FUNCTION derived_value_formula_of_row();

-- ③-가 칸이 바뀌면 그 행의 수식 값 전부
CREATE FUNCTION derived_value_stale_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE derived_value SET stale = true
   WHERE page_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.page_id ELSE NEW.page_id END) AND NOT stale;
  RETURN NULL;
END $$;

CREATE TRIGGER tg_ppv_derived_stale
  AFTER INSERT OR UPDATE OR DELETE ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION derived_value_stale_row();

-- ③-나 이 표의 수식 값 전부 — 속성 · 옵션이 부른다
CREATE FUNCTION derived_value_stale_source(source text) RETURNS void
LANGUAGE sql AS $$
  UPDATE derived_value dv SET stale = true
    FROM property f
   WHERE f.data_source_id = source::uuid AND f.type = 'formula' AND dv.property_id = f.id AND NOT dv.stale;
$$;

CREATE FUNCTION derived_value_stale_property() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM derived_value_stale_source(OLD.data_source_id::text);
  ELSIF (OLD.type, OLD.config, OLD.deleted_at) IS DISTINCT FROM (NEW.type, NEW.config, NEW.deleted_at) THEN
    PERFORM derived_value_stale_source(NEW.data_source_id::text);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER tg_property_derived_stale
  AFTER UPDATE OR DELETE ON property
  FOR EACH ROW EXECUTE FUNCTION derived_value_stale_property();

CREATE FUNCTION derived_value_stale_option() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.name IS NOT DISTINCT FROM NEW.name THEN
    RETURN NULL; -- 색 · 순서 · 그룹은 수식이 읽지 않는다(이름만 읽는다)
  END IF;
  SELECT data_source_id INTO source FROM property
   WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.property_id ELSE NEW.property_id END);
  IF source IS NOT NULL THEN
    PERFORM derived_value_stale_source(source::text);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER tg_select_option_derived_stale
  AFTER INSERT OR UPDATE OR DELETE ON select_option
  FOR EACH ROW EXECUTE FUNCTION derived_value_stale_option();
