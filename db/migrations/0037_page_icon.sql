-- 페이지 아이콘의 모양 — 잔여 묶음 8c-1조각 (F-02-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 페이지 아이콘 ①②
--       02-page-workspace.md F-02-05 *"아이콘 없음 → icon = null 저장"* · 노션 공개 API 의 icon 객체
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 페이지의 아이콘은 `block.format.page_icon` 이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 새 컬럼을 두지 않는다. 아이콘은 제목(`properties.title`)과 달리 페이지의 **모습**이고(노션 내부 모델과 같은 자리), 복제(#110)가
-- 이미 `format` 을 통째로 사본에 옮긴다. 값은 노션 API 의 icon 객체 모양이다 — 지금은 `{"type":"emoji","emoji":"🌱"}` 하나.
--
-- DB 가 막는 것(표현할 수 있는 부분 — "grapheme 하나 · 이모지"는 SQL 로 셀 수 없어 명령이 본다 · `block/page-icon.ts`):
--   ① **페이지 행만** 갖는다 — 본문 블록(문단 · 하위 페이지 참조가 아닌 것)의 `format` 은 Y.Doc 에서 투영되고, 본문의 규칙
--      (`normalizeFormat`)이 이 키를 늘 버린다. 참여자가 본문의 attr 에 이 키를 넣어도 투영 전에 빠진다 — 여기서 막는 것은 그
--      길을 지나지 않는 쓰기다
--   ② 객체 · `type` 은 `emoji` · `emoji` 는 문자열 · 비지 않고 16 코드포인트 이하 · 공백 없음(teamspace 아이콘의 0032 와 같은 값)
--   ③ 다른 키가 없다 — 받은 객체를 그대로 싣는 쓰기(옛 클라이언트 · 다른 조각)가 모르는 값을 끌고 들어오지 않게
--
-- 이미지 아이콘(업로드 · 외부 URL)이 생기면 새 마이그레이션이 이 CHECK 을 넓힌다.
--
-- 기존 행: 이 키를 쓴 명령이 없었다 — 검사(`duplicate.db.test.ts`)가 남긴 문자열 값만 있을 수 있어 모양이 아닌 것은 지운다.

UPDATE block
   SET format = format - 'page_icon'
 WHERE format ? 'page_icon'
   AND NOT (
         type = 'page'
     AND jsonb_typeof(format -> 'page_icon') = 'object'
     AND (format -> 'page_icon') ->> 'type' = 'emoji'
     AND jsonb_typeof((format -> 'page_icon') -> 'emoji') = 'string'
     AND char_length((format -> 'page_icon') ->> 'emoji') BETWEEN 1 AND 16
     AND (format -> 'page_icon') ->> 'emoji' !~ '[[:space:]]'
     AND (format -> 'page_icon') - 'type' - 'emoji' = '{}'::jsonb
   );

ALTER TABLE block
  ADD CONSTRAINT block_page_icon_shape
  CHECK (
    NOT (format ? 'page_icon')
    OR (
          type = 'page'
      AND jsonb_typeof(format -> 'page_icon') = 'object'
      AND (format -> 'page_icon') ->> 'type' = 'emoji'
      AND jsonb_typeof((format -> 'page_icon') -> 'emoji') = 'string'
      AND char_length((format -> 'page_icon') ->> 'emoji') BETWEEN 1 AND 16
      AND (format -> 'page_icon') ->> 'emoji' !~ '[[:space:]]'
      AND (format -> 'page_icon') - 'type' - 'emoji' = '{}'::jsonb
    )
  );
