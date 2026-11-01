-- 페이지 커버의 위치 — 페이지 행의 `format.page_cover_position` — 34번 트랙 PC-3 (F-02-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강 PC-3] 커버 위치 조정 ① ②
--       02-page-structure.md F-02-06 *"Reposition 은 이미지의 세로 오프셋만 조정한다(가로는 항상 100% fill). 값은 0~1 비율로 저장"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 위치는 커버에 딸린 값이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 값은 0(그림의 위 끝)~1(아래 끝)의 수 하나 — 화면의 `object-position: center <값×100>%`. 없으면 가운데(0.5)다(키가 없다).
-- DB 가 막는 것: 페이지 행만 · 수 · 0 이상 1 이하 · **커버가 있을 때만**(커버를 지우면 위치도 지운다 — 명령이 함께 지운다).
-- 커버가 그림(올린 이미지 · 주소)인지는 명령이 본다 — 내장 커버(단색 · 그라디언트)에는 위치가 뜻이 없지만, 커버를 바꾸는 명령이 위치를
-- 지우므로 DB 로 승격하지 않는다(jsonb 의 두 키를 한 CHECK 에서 견주면 되지만 종류의 목록을 두 곳에 두게 된다).
--
-- 기존 행: 이 키를 쓰는 곳이 없었다 — 바꿀 행이 없다.

-- CASE 로 차례를 못박는다 — 수가 아닌 값을 numeric 으로 바꾸면 CHECK 가 거부(23514)가 아니라 오류로 끝난다(AND 는 차례를 지키지 않는다).
ALTER TABLE block
  ADD CONSTRAINT block_page_cover_position
  CHECK (CASE
    WHEN NOT (format ? 'page_cover_position') THEN true
    WHEN type <> 'page' OR NOT (format ? 'page_cover') THEN false
    WHEN jsonb_typeof(format -> 'page_cover_position') <> 'number' THEN false
    ELSE (format ->> 'page_cover_position')::numeric BETWEEN 0 AND 1
  END);
