-- 이미지 아이콘 — 페이지 · 데이터베이스 아이콘의 모양을 넓힌다 — 잔여 묶음 8c-4조각 (F-02-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 페이지 아이콘 ②⑤ · §3.5 [보강] 데이터베이스 아이콘 ②
--       01-block-editor.md F-01-15 이미지 블록의 `source` 모양
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 이모지만 받던 두 CHECK(0037 · 0038)이 이미지를 받게 한다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0037 · 0038 은 "이미지(업로드 · 외부 URL)가 생기면 이 CHECK 을 넓힌다"고 적었다. 이미지 아이콘의 모양은 **이미지 블록의
-- `source` 와 같다** — `{type:'file', file_id}`(우리가 호스팅하는 파일 · 주소는 파생값) · `{type:'external', url}`(값 자체가 주소).
-- 두 자리(페이지 행의 `format.page_icon` · `database.icon`)가 같은 모양을 받으므로 판정은 함수 하나(`icon_shape_ok`)에 둔다 —
-- 둘을 따로 적으면 한쪽만 넓히는 날이 온다.
--
-- DB 가 막는 것(표현할 수 있는 부분):
--   · 객체이고 `type` 이 셋 중 하나 · 그 종류의 키 하나 말고 다른 키가 없다
--   · emoji — 0037 과 같다(1~16 코드포인트 · 공백 없음 · grapheme 하나는 명령이 본다)
--   · file — `file_id` 는 uuid 모양의 글. **그 파일이 이 워크스페이스의 이미지인지는 명령이 본다**(jsonb 안의 id 에 FK 를 걸 수 없다)
--   · external — `url` 은 http · https 로 시작하는 1~2048자의 글 · 공백 없음(`<img src>` 에 그대로 들어간다 — `javascript:` 를
--     막는 것은 이미지 블록과 같은 까닭)
-- CASE 로 차례를 못박는다 — 객체가 아닌 값에 `-` 를 쓰면 CHECK 가 거부(23514)가 아니라 오류로 끝난다.
--
-- 기존 행: 0037 · 0038 이 이미 이모지만 남겼다 — 바꿀 행이 없다.

CREATE FUNCTION icon_shape_ok(icon jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE
    WHEN jsonb_typeof(icon) <> 'object' THEN false
    WHEN icon ->> 'type' = 'emoji' THEN
          jsonb_typeof(icon -> 'emoji') = 'string'
      AND char_length(icon ->> 'emoji') BETWEEN 1 AND 16
      AND icon ->> 'emoji' !~ '[[:space:]]'
      AND icon - 'type' - 'emoji' = '{}'::jsonb
    WHEN icon ->> 'type' = 'file' THEN
          jsonb_typeof(icon -> 'file_id') = 'string'
      AND icon ->> 'file_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND icon - 'type' - 'file_id' = '{}'::jsonb
    WHEN icon ->> 'type' = 'external' THEN
          jsonb_typeof(icon -> 'url') = 'string'
      AND char_length(icon ->> 'url') BETWEEN 1 AND 2048
      AND icon ->> 'url' ~* '^https?://[^[:space:]]+$'
      AND icon - 'type' - 'url' = '{}'::jsonb
    ELSE false
  END
$$;

COMMENT ON FUNCTION icon_shape_ok(jsonb) IS
  '페이지 · 데이터베이스 아이콘의 모양 — emoji | file(file_id) | external(url). 0039 · 정본 §3.4 [보강] 페이지 아이콘';

ALTER TABLE block DROP CONSTRAINT block_page_icon_shape;
ALTER TABLE block
  ADD CONSTRAINT block_page_icon_shape
  CHECK (NOT (format ? 'page_icon') OR (type = 'page' AND coalesce(icon_shape_ok(format -> 'page_icon'), false)));

ALTER TABLE database DROP CONSTRAINT database_icon_shape;
ALTER TABLE database
  ADD CONSTRAINT database_icon_shape
  CHECK (icon IS NULL OR coalesce(icon_shape_ok(icon), false));
