-- 검증 속성(verification) — 값은 셀 · 속성은 표마다 하나 · 플랜 열쇠 — VF-1조각 (F-03-23)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 VF-1] ① ② ③ ⑨
--
-- 0013 이 `property_type` 에 `verification` 을 두었고 0025 가 "저장 모양 미정" 이라 남겼다. 여기서 정한다.
--
--   ① 칸의 모양 — `{type:'verification', state:'verified', verified_by:uuid, verified_at:시각, expires_at:null|시각}`.
--      키는 이 다섯뿐이고 `expires_at` 은 `verified_at` 보다 뒤여야 한다. 검증 안 됨은 칸이 없는 것이다(해제는 칸을 지운다).
--      만료는 적지 않는다 — 읽을 때 `expires_at <= 지금` 으로 본다. 모양은 칸 가드 트리거(0025 계열)가 막는다.
--   ② 속성 — 표(data source)마다 살아 있는 검증 속성은 하나. 설정은 `config.owner_property_id`(같은 표의 사람 속성) 하나뿐.
--      소유자 속성을 지우거나 타입을 바꾸는 것을 막는 것은 애플리케이션 명령이다(`property.ts` · 지운 뒤 검증 속성을 되살릴 때도 본다).
--   ③ 플랜 — 엔타이틀먼트 `database.verification`(boolean) — Business · Enterprise 만 속성을 더하고 검증한다. 해제 · 있던 값의 읽기는 무관하다.
--
-- 기존 행: 검증 속성이 없다 — 바뀌는 것이 없다.

CREATE UNIQUE INDEX ux_property_verification_one ON property (data_source_id)
  WHERE type = 'verification' AND deleted_at IS NULL;

ALTER TABLE property
  ADD CONSTRAINT ck_property_verification_config CHECK (
    type <> 'verification'
    OR coalesce(
         jsonb_typeof(config -> 'owner_property_id') = 'string' AND (config - 'owner_property_id') = '{}'::jsonb,
         false)
  );

CREATE FUNCTION page_property_value_verification_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
  v jsonb := NEW.value;
  at_ timestamptz;
  until_ timestamptz;
  iso text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$';
BEGIN
  SELECT type::text INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type IS DISTINCT FROM 'verification' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v) <> 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)
        IS DISTINCT FROM ARRAY['expires_at', 'state', 'type', 'verified_at', 'verified_by']
     OR v ->> 'state' IS DISTINCT FROM 'verified'
     OR jsonb_typeof(v -> 'verified_by') IS DISTINCT FROM 'string'
     OR v ->> 'verified_by' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(v -> 'verified_at') IS DISTINCT FROM 'string'
     OR v ->> 'verified_at' !~ iso
     OR jsonb_typeof(v -> 'expires_at') NOT IN ('null', 'string')
     OR (jsonb_typeof(v -> 'expires_at') = 'string' AND v ->> 'expires_at' !~ iso) THEN
    RAISE EXCEPTION '검증 칸의 모양이 아니다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_verification_shape';
  END IF;

  BEGIN
    at_ := (v ->> 'verified_at')::timestamptz;
    until_ := (v ->> 'expires_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '검증 칸의 시각이 읽히지 않는다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_verification_shape';
  END;
  IF until_ IS NOT NULL AND until_ <= at_ THEN
    RAISE EXCEPTION '만료는 검증한 시각보다 뒤여야 한다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_verification_shape';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_verification_shape() IS
  'VF-1 ①. 검증 속성의 칸은 {type, state:verified, verified_by, verified_at, expires_at} 다섯 키뿐이고 expires_at 은 verified_at 보다 뒤다.';

CREATE TRIGGER tg_ppv_verification_shape
  BEFORE INSERT OR UPDATE OF property_id, value ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_verification_shape();

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'database.verification', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'false'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
