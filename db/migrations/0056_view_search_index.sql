-- 뷰 검색의 인덱스 — DB 심화 2e-1조각 (F-04-27)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 [보강] 뷰 검색
--       04-database-views.md F-04-27 *"`LIKE '%term%'` 는 인덱스를 못 쓴다 → trigram(pg_trgm GIN) 또는 전문 검색 인덱스 필요.
--       없으면 타이핑마다 전체 스캔"*
--
-- 뷰 검색(`database/search.ts`)은 칸의 사이드카 `text_value` 를 `lower(text_value) LIKE '%' || lower($q) || '%'` 로 본다. 0013 의
-- `ix_ppv_text` 는 `text_pattern_ops` 라 **접두사**만 받는다 — 부분 일치는 이 인덱스가 받는다.
--
-- pg_trgm 이 아니라 pg_bigm 이다 — 한국어는 2-gram 이어야 조사를 넘는다(0012 머리말의 실측 · `npm run db:verify` [3]). 식은 질의와
-- 같은 `lower(text_value)` 다(다르면 쓰이지 않는다). 선택 · 상태의 사이드카(옵션 id)도 담기지만 해롭지 않다 — 질의가 프로퍼티로
-- 거르고, 옵션은 이름(`select_option.name`)으로 찾는다. 옵션 이름은 프로퍼티마다 몇 개라 인덱스를 두지 않는다.

CREATE INDEX ix_ppv_text_bigm ON page_property_value USING gin (lower(text_value) gin_bigm_ops)
  WHERE text_value IS NOT NULL;
