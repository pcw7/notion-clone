-- 커스텀 이모지를 페이지 · 데이터베이스 아이콘으로 — 인접 제품 7c-2a조각 (F-13-16)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ⑤ · [보강] 페이지 아이콘 ⑥
--
-- 두 자리(페이지 행의 `format.page_icon` · `database.icon`)의 CHECK 이 부르는 판정 함수 `icon_shape_ok`(0039)를 다시 정의해
-- 넷째 종류를 받는다 — 함수가 하나라 두 자리가 함께 넓어진다(0039 가 함수로 둔 까닭).
--
--   · custom_emoji — `{"type":"custom_emoji","custom_emoji":{"id":"…"}}`(노션 API 모양에서 id 만 · 이름 · 주소는 싣지 않는다).
--     안쪽 객체는 `id` 키 하나 · 소문자 uuid · 바깥에도 다른 키 없음. **그 이모지가 이 워크스페이스에 살아 있는지는 명령이 본다**
--     (jsonb 안의 id 에 FK 를 걸 수 없다 · 지운 뒤에도 달린 아이콘은 남는다 — ⑤)
--
-- 나머지 세 종류는 0039 와 한 글자도 다르지 않다. 기존 행: 셋 중 하나뿐이고 그대로 통과한다(바꿀 행이 없다).

CREATE OR REPLACE FUNCTION icon_shape_ok(icon jsonb) RETURNS boolean
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
    WHEN icon ->> 'type' = 'custom_emoji' THEN
      -- CASE 로 차례를 못박는다 — 안쪽이 객체가 아니면(없으면) `-` 가 거부(23514)가 아니라 오류로 끝난다(0039 와 같은 까닭)
      CASE
        WHEN jsonb_typeof(icon -> 'custom_emoji') IS DISTINCT FROM 'object' THEN false
        ELSE  jsonb_typeof(icon -> 'custom_emoji' -> 'id') = 'string'
          AND icon -> 'custom_emoji' ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          -- 괄호가 필요하다 — `-` 가 `->` 보다 먼저 묶인다(`icon -> ('custom_emoji' - 'id')` 가 된다)
          AND (icon -> 'custom_emoji') - 'id' = '{}'::jsonb
          AND icon - 'type' - 'custom_emoji' = '{}'::jsonb
      END
    ELSE false
  END
$$;

COMMENT ON FUNCTION icon_shape_ok(jsonb) IS
  '페이지 · 데이터베이스 아이콘의 모양 — emoji | file(file_id) | external(url) | custom_emoji({id}). 0039 · 0097 · 정본 §3.4 [보강] 페이지 아이콘 · 커스텀 이모지 ⑤';
