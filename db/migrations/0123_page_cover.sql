-- 페이지 커버 — 페이지 행의 `format.page_cover` 의 모양 — 34번 트랙 PC-1 (F-02-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강 PC-1] 페이지 커버 ① ②
--       02-page-structure.md F-02-06 (데이터 모델 함의의 `page_meta.cover_*` 는 폐기된 표의 것이다 — C-3)
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 아이콘(`format.page_icon` · 0037 · 0039)과 같은 자리 · 같은 방식으로 막는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 커버는 페이지의 **모습**이다 — 새 컬럼을 두지 않고 페이지 행의 `format` 에 둔다(복제가 `format` 을 통째로 옮긴다). 모양은 셋:
--
--   { "type": "gallery",  "gallery": "gradient_1" }   내장 커버 — id 만(그림은 화면의 표가 안다 · 지금 표에 있는지는 명령이 본다)
--   { "type": "external", "url": "https://…" }        외부 이미지 — 아이콘과 같은 규칙(http · https · 1~2048자 · 공백 없음)
--   { "type": "file",     "file_id": "…uuid…" }       올린 이미지 — 모양은 지금 받는다. 명령이 받는 것은 PC-2(파일 참조 장부와 함께)
--
-- DB 가 막는 것: 페이지 행만 · 객체 · `type` 셋 중 하나 · 그 종류의 키 하나 말고 다른 키 없음 · `gallery` 는 `^[a-z0-9_]{1,40}$`.
-- CASE 로 차례를 못박는다 — 객체가 아닌 값에 `-` 를 쓰면 CHECK 가 거부(23514)가 아니라 오류로 끝난다(0039 와 같다).
--
-- 기존 행: 이 키를 쓰는 곳이 없었다 — 바꿀 행이 없다.

CREATE FUNCTION cover_shape_ok(cover jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE
    WHEN jsonb_typeof(cover) <> 'object' THEN false
    WHEN cover ->> 'type' = 'gallery' THEN
          jsonb_typeof(cover -> 'gallery') = 'string'
      AND cover ->> 'gallery' ~ '^[a-z0-9_]{1,40}$'
      AND cover - 'type' - 'gallery' = '{}'::jsonb
    WHEN cover ->> 'type' = 'file' THEN
          jsonb_typeof(cover -> 'file_id') = 'string'
      AND cover ->> 'file_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND cover - 'type' - 'file_id' = '{}'::jsonb
    WHEN cover ->> 'type' = 'external' THEN
          jsonb_typeof(cover -> 'url') = 'string'
      AND char_length(cover ->> 'url') BETWEEN 1 AND 2048
      AND cover ->> 'url' ~* '^https?://[^[:space:]]+$'
      AND cover - 'type' - 'url' = '{}'::jsonb
    ELSE false
  END
$$;

COMMENT ON FUNCTION cover_shape_ok(jsonb) IS
  '페이지 커버의 모양 — gallery(id) | file(file_id) | external(url). 0123 · 정본 §3.4 [보강 PC-1] 페이지 커버';

ALTER TABLE block
  ADD CONSTRAINT block_page_cover_shape
  CHECK (NOT (format ? 'page_cover') OR (type = 'page' AND coalesce(cover_shape_ok(format -> 'page_cover'), false)));
