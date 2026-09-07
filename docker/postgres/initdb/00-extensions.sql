-- 정본 데이터 모델이 요구하는 확장 (docs/research/00-canonical-data-model.md)
--
-- 이 스크립트는 데이터 볼륨이 비어 있을 때 최초 1회만 실행된다.
-- 이미 만들어진 볼륨에는 적용되지 않는다 — 확장을 추가하려면
-- `npm run db:reset` 으로 볼륨을 지우거나 마이그레이션으로 넣어야 한다.

-- 한국어를 포함한 CJK 전문 검색. to_tsvector('simple') 은 CJK 를 쪼개지 못한다.
-- 최소 쿼리 길이는 CJK 1자 / 라틴 2자로 둔다 (§9-Q5).
CREATE EXTENSION IF NOT EXISTS pg_bigm;

-- 유사도 검색 · LIKE 가속 (라틴 문자 쪽)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 대소문자 구분 없는 텍스트. user_email.address 등에 쓴다.
CREATE EXTENSION IF NOT EXISTS citext;

-- gen_random_uuid(), 해시 함수
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 설치 확인 — 하나라도 빠지면 여기서 에러를 내고 initdb 가 실패한다.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(e, ', ')
    INTO missing
    FROM unnest(ARRAY['pg_bigm', 'pg_trgm', 'citext', 'pgcrypto']) AS e
   WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = e);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '필수 확장이 설치되지 않았습니다: %', missing;
  END IF;

  RAISE NOTICE '확장 설치 완료: pg_bigm, pg_trgm, citext, pgcrypto';
END
$$;
