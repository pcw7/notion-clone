-- 페이지의 모습 — 페이지 행의 `format.page_font` · `page_small_text` · `page_full_width` — 36번 트랙 PL-1 (F-02-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강 PL-1] 페이지의 모습 ① ②
--       02-page-structure.md F-02-07 *"페이지 단위로 서체(Default / Serif / Mono) · Small text · Full width"*
--
-- 기본값이면 키가 없다 — 서체는 'serif' · 'mono' 일 때만, 두 토글은 켰을 때만(true) 적는다. 그래서 DB 가 막는 것은:
--   · 페이지 행만(본문 블록 · 데이터베이스 블록은 이 키를 갖지 않는다)
--   · page_font 는 'serif' · 'mono' 중 하나(글 — 'default' 를 적지 않는다)
--   · page_small_text · page_full_width 는 true 하나(false 를 적지 않는다 — 끄면 키를 지운다)
-- CASE 로 차례를 못박는다(0124 와 같은 까닭). 기존 행: 이 키를 쓰는 곳이 없었다.

ALTER TABLE block
  ADD CONSTRAINT block_page_appearance
  CHECK (CASE
    WHEN NOT (format ?| ARRAY['page_font', 'page_small_text', 'page_full_width']) THEN true
    WHEN type <> 'page' THEN false
    WHEN format ? 'page_font' AND (jsonb_typeof(format -> 'page_font') <> 'string' OR format ->> 'page_font' NOT IN ('serif', 'mono')) THEN false
    WHEN format ? 'page_small_text' AND format -> 'page_small_text' <> 'true'::jsonb THEN false
    WHEN format ? 'page_full_width' AND format -> 'page_full_width' <> 'true'::jsonb THEN false
    ELSE true
  END);
