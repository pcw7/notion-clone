-- 북마크의 메타 캐시 — 32번 트랙 F-4a (01 F-01-15 P1 · 09 F-09-11 · F-09-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강 F-4]
--
-- 북마크 블록은 주소와 캡션만 적는다([보강 F-3] ①) — 카드의 제목 · 설명 · 그림은 서버가 그 주소에서 가져온 **메타**다. 같은 주소의 메타는
-- 워크스페이스를 넘는 공개 정보라(09 F-09-11 *"공개 언퍼 캐시는 전역 공유"*) 워크스페이스 열이 없는 전역 캐시 하나에 둔다. 열쇠는 정규화한
-- 주소(`new URL(u).href`)의 sha256 이다. 가져오지 못한 것도 적는다(`failed` — 짧게 · 재시도 폭주를 막는 음성 캐시 · F-09-18) · http 주소는
-- 가져오지 않는다(`skipped` — 바깥 요청은 https 만이다 · §3.8 [보강] 페이지 웹훅 ②).
--
-- 기존 행: 없다(새 테이블). 프로브는 verify-schema 의 [80].

CREATE TABLE link_preview (
  url_hash     text PRIMARY KEY,
  url          text NOT NULL,
  status       text NOT NULL,
  title        text NULL,
  description  text NULL,
  image_url    text NULL,
  site_name    text NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,

  CONSTRAINT ck_link_preview_hash CHECK (url_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_link_preview_url CHECK (char_length(url) BETWEEN 1 AND 2048),
  CONSTRAINT ck_link_preview_status CHECK (status IN ('ok', 'failed', 'skipped')),
  -- 메타는 가져왔을 때만 — 실패 · 건너뜀은 빈 줄이다
  CONSTRAINT ck_link_preview_meta_only_ok CHECK (status = 'ok' OR (title IS NULL AND description IS NULL AND image_url IS NULL AND site_name IS NULL)),
  CONSTRAINT ck_link_preview_title CHECK (title IS NULL OR char_length(title) <= 300),
  CONSTRAINT ck_link_preview_description CHECK (description IS NULL OR char_length(description) <= 1000),
  CONSTRAINT ck_link_preview_image CHECK (image_url IS NULL OR (char_length(image_url) <= 2048 AND image_url ~ '^https?://')),
  CONSTRAINT ck_link_preview_site CHECK (site_name IS NULL OR char_length(site_name) <= 200),
  CONSTRAINT ck_link_preview_expiry CHECK (expires_at > fetched_at)
);

-- 만료된 줄을 지우는 일(뒤로)이 이 순서로 읽는다
CREATE INDEX ix_link_preview_expires ON link_preview (expires_at);
