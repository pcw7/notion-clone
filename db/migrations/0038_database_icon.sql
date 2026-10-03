-- 데이터베이스 아이콘의 모양 — 잔여 묶음 8c-3b조각 (F-02-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `database.icon` · [보강] 데이터베이스 아이콘 ①②
--       §3.4 [보강] 페이지 아이콘 ② (같은 모양 · 같은 규칙)
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 데이터베이스의 아이콘은 `database.icon` 이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 §3.5 의 `database.icon jsonb` 는 0013 부터 있었지만 읽고 쓰는 코드가 없었다. 페이지의 아이콘(`block.format.page_icon` ·
-- 0037)과 자리가 다르다 — 0037 의 CHECK 이 그 키를 **페이지 행만** 갖게 하므로 데이터베이스 블록의 `format` 에는 둘 수 없고, 정본이
-- 이미 데이터베이스의 모습(`title_rich` · `icon` · `cover`)을 이 표에 두었다. 값의 모양은 페이지 아이콘과 **같다** — 노션 공개 API 의
-- icon 객체, 지금은 `{"type":"emoji","emoji":"📚"}` 하나. 없으면 SQL NULL 이다(컬럼이므로 — 페이지는 키가 없다).
--
-- DB 가 막는 것(0037 과 같은 값 — "grapheme 하나 · 이모지"는 SQL 로 셀 수 없어 명령이 본다 · `block/page-icon.ts`):
--   ① 객체 · `type` 은 `emoji` · `emoji` 는 문자열 · 비지 않고 16 코드포인트 이하 · 공백 없음
--   ② 다른 키가 없다
--   JSON 의 `null`(SQL NULL 이 아닌 것)은 객체가 아니므로 거부한다 — 없는 것은 하나의 모양(SQL NULL)이다.
--
-- 이미지 아이콘(업로드 · 외부 URL — 8c-4)이 생기면 0037 과 함께 이 CHECK 도 넓힌다.
--
-- 기존 행: 이 컬럼을 쓴 명령이 없었다(만들기는 icon 을 넣지 않는다). 모양이 아닌 것이 있으면 지운다.

UPDATE database
   SET icon = NULL
 WHERE icon IS NOT NULL
   AND NOT (
         jsonb_typeof(icon) = 'object'
     AND icon ->> 'type' = 'emoji'
     AND jsonb_typeof(icon -> 'emoji') = 'string'
     AND char_length(icon ->> 'emoji') BETWEEN 1 AND 16
     AND icon ->> 'emoji' !~ '[[:space:]]'
     AND icon - 'type' - 'emoji' = '{}'::jsonb
   );

ALTER TABLE database
  ADD CONSTRAINT database_icon_shape
  CHECK (
    icon IS NULL
    OR (
          jsonb_typeof(icon) = 'object'
      AND icon ->> 'type' = 'emoji'
      AND jsonb_typeof(icon -> 'emoji') = 'string'
      AND char_length(icon ->> 'emoji') BETWEEN 1 AND 16
      AND icon ->> 'emoji' !~ '[[:space:]]'
      AND icon - 'type' - 'emoji' = '{}'::jsonb
    )
  );
