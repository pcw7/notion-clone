-- 검색 색인 — W7 (F-07-06 색인 파이프라인 / F-07-07 권한 인지 검색의 저장 축)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 `search_document`
--       판결 X-6 (`version` = `block.version`) · X-8 (`principals[]` 폐기, `perm_scope_id` 단일 축)
--       07-search-navigation.md F-07-06 "클론 시 현실적 대안 v0/v1"
--
-- ──────────────────────────────────────────────────────────────────────
-- 정본의 GIN 인덱스 식은 PostgreSQL 에서 만들어지지 않는다 — 실측으로 확인했다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 §3.9 의 마지막 줄은 이렇게 적혀 있다:
--
--   CREATE INDEX ON search_document USING gin (
--     to_tsvector(lang, coalesce(title_text,'') || ' ' || coalesce(body_text,'')));
--
-- 이 문장은 **실행되지 않는다.** 이유가 둘이고 둘 다 회피할 수 없다:
--
--   1. `to_tsvector(text, text)` 라는 함수가 **존재하지 않는다.** 2인자 형태는
--      `to_tsvector(regconfig, text)` 뿐이다.
--        → ERROR: function to_tsvector(text, text) does not exist
--   2. `lang::regconfig` 로 캐스팅해도 막힌다. regconfig 를 런타임에 고르는
--      호출은 STABLE 이고, 인덱스 식은 IMMUTABLE 을 요구한다.
--        → ERROR: functions in index expression must be marked IMMUTABLE
--
-- 즉 "문서마다 다른 analyzer" 를 인덱스 식으로 표현하는 것이 PostgreSQL 에서
-- 불가능하다. 정본이 참조한 per-language analyzer 는 Elasticsearch 의 기능이고
-- (F-07-06 "언어 감지 결과를 문서에 넣어 per-language analyzer 를 적용"),
-- v0 물리 구현이 Postgres 인 이상 그대로 옮겨지지 않는다.
--
-- **그래서 고정 regconfig(`simple`) + GENERATED 컬럼으로 바꿨다.** `lang` 컬럼은
-- 정본대로 남기고 값도 채우지만(F-07-06 의 "언어 감지 결과"), 인덱스 식에는
-- 쓰지 않는다. 정본 문서 §3.9 에 `[정정]` 으로 이 근거를 남겼다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 한국어는 tsvector 로 검색되지 않는다 — 그래서 축이 둘이다
-- ──────────────────────────────────────────────────────────────────────
--
-- PostgreSQL 16 이 제공하는 text search config 는 28개이고 **한국어·CJK 는
-- 하나도 없다**(`SELECT cfgname FROM pg_ts_config` 로 확인). `simple` 은 공백으로
-- 쪼개고 소문자화만 하므로 조사가 붙은 어절이 다른 토큰이 된다. 실측:
--
--   to_tsvector('simple','검색 인덱스를 만든다')  →  '검색':1 '만든다':3 '인덱스를':2
--   to_tsvector('simple','검색이 빠르다') @@ websearch_to_tsquery('simple','검색')
--     →  false      ← '검색' 으로 '검색이' 를 찾지 못한다
--   '검색이 빠르다' LIKE likequery('검색')
--     →  true       ← pg_bigm 은 넘는다
--
-- "검색" 이 "검색이" 를 못 찾는 검색은 한국어에서 쓸 수 없다. 그래서 **축을 둘
-- 만든다** — 라틴 쿼리는 tsvector(랭킹·구문 검색·불리언이 공짜), CJK 쿼리는
-- pg_bigm 2-gram(조사를 넘는다). 쿼리 쪽이 쿼리의 스크립트를 보고 고른다.
-- CLAUDE.md 가 pg_bigm 을 스택에 넣은 이유가 이것이고, `npm run db:verify` 가
-- 이미 2-gram 동작을 확인하고 있다.
--
-- ──────────────────────────────────────────────────────────────────────
-- tsvector 에는 1MB 한도가 있고, 우리 본문 한도가 그것을 넘는다
-- ──────────────────────────────────────────────────────────────────────
--
-- F-12-16 이 본문 상한을 1MB 로 정했다. 그 크기의 본문을 `to_tsvector` 에 넣으면
-- **던진다**: `string is too long for tsvector (1677408 bytes, max 1048575 bytes)`.
-- GENERATED 컬럼이면 그 예외가 INSERT 를 실패시키므로, 사용자가 긴 페이지를
-- 저장하는 순간 **저장 자체가 거부된다.** 색인 때문에 글을 잃는 것은 안 된다.
--
-- 그래서 tsvector 는 본문의 **앞부분만** 본다. 상한은 전부 고유한 한글 토큰으로
-- 실측해 정했다 (고유 토큰 20만개 / 80만 자):
--
--   left(body_text, 100000) → tsvector  450,008 바이트 = 한도의 42.9%
--   left(body_text, 200000) → tsvector  900,008 바이트 = 한도의 85.8%
--   left(body_text, 262144) → tsvector 1,179,656 바이트 = 한도의 112.5%  ← 던진다
--
-- 10만 자를 고른다. 2.3배 여유가 있고, 20만 자는 여유가 14% 뿐이라 콘텐츠가
-- 조금만 달라도 넘는다. **`body_text` 자체는 자르지 않는다** — pg_bigm 축은
-- 한도가 없으므로 한국어 검색은 본문 전체를 본다(1.2MB 삽입을 실측 확인했다).
-- 잘리는 것은 라틴 tsvector 축의 10만 자 뒤쪽뿐이다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 색인 단위: 이 마이그레이션의 행은 `type='page'` 블록뿐이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본은 `doc_id uuid PRIMARY KEY -- = block.id (색인 단위는 block)` 이라고 했고
-- 스키마를 그대로 따랐다. 그러나 Phase 0 에서 **행을 만드는 블록은 페이지뿐이다**:
-- `title_text` = 페이지 제목, `body_text` = 그 페이지 문서 범위의 본문 전체.
--
-- 스키마를 좁히지 않았으므로 나중에 본문 블록마다 행을 만드는 것은 마이그레이션
-- 없이 된다. 지금 그러지 않는 이유:
--   · Phase 0 의 저장 단위가 페이지다(페이지 단위 LWW). 색인도 같은 단위면
--     갱신이 저장과 같은 트랜잭션의 **1행 upsert** 로 끝난다. 블록 단위면
--     페이지 저장마다 N행을 지우고 다시 넣는다.
--   · F-07-02 가 요구한 `setweight(title,'A') || setweight(body,'B')` 가 한 행
--     안에서 성립한다. 본문 블록 행에는 제목이 없어서 가중치 분리가 안 된다.
--   · F-07-02 의 "동일 페이지의 여러 블록 매칭 → 페이지 단위로 접기(dedup 필수)"
--     가 **애초에 필요 없어진다.** 1페이지 = 1행이다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 텍스트는 앱이 쓰고, 메타데이터는 트리거가 따라간다
-- ──────────────────────────────────────────────────────────────────────
--
-- F-07-06 엣지 케이스: *"권한 변경(공유 해제) → 텍스트는 그대로인데 권한만 갱신
-- → 본문 재색인 없이 메타만 partial update 하는 경로가 필요."* 그 경로가 아래
-- 트리거다. 쓰기자를 이렇게 나눈다:
--
--   트리거  → doc_id · workspace_id · region_id · parent_id · ancestor_ids
--             · perm_scope_id · in_trash · version · 감사 컬럼
--   앱      → title_text · body_text · lang   (`src/lib/search/index-page.ts`)
--
-- 이 분할이 중요한 것은 **행의 존재와 권한 축이 DB 가 보장하는 것이 되기 때문**
-- 이다. 앱이 잊을 수 있는 것은 텍스트의 신선도뿐이고, 그 실패는 "검색 결과가
-- 낡는다" 다. 권한 축을 앱이 복사하게 두면 그 실패는 **권한 누출**이다.
-- 실패 방향을 고를 수 있을 때 고른다.

CREATE TABLE search_document (
  -- `= block.id`. FK + CASCADE 로 물리 삭제된 페이지의 유령 결과를 원천 차단한다
  -- (F-07-06: "블록 삭제 → 인덱스에서 사라져야 함(유령 결과 금지)").
  doc_id         uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspace(id),   -- 샤드 라우팅 키 [X-8]
  region_id      text NOT NULL REFERENCES region(id),      -- <17 F-17-06> 소급 불가

  page_id        uuid NOT NULL,                 -- 페이지 단위 색인이므로 = doc_id
  parent_id      uuid NULL,                     -- 워크스페이스 루트면 NULL
  type           text NOT NULL,
  ancestor_ids   uuid[] NOT NULL DEFAULT '{}',  -- = block.ancestor_path [X-7]
  -- breadcrumb 용 제목 캐시. **Phase 0 은 채우지 않는다(NULL).** 결과 25건의
  -- 조상 제목은 `ancestor_ids` 로 block 을 한 번 조인하면 나오고, 복사해 두면
  -- 조상 제목이 바뀔 때마다 서브트리 전체가 낡는다(F-07-04 가 recent_visit 에
  -- 대해 경고한 것과 같은 함정). 조인이 비싸지는 규모가 오면 그때 채운다.
  ancestor_titles text[],

  title_text     text,
  body_text      text,
  -- 색인 시점의 언어 감지 결과(F-07-06). **Phase 0 의 쿼리 경로는 이 값을 읽지
  -- 않는다** — 분기는 쿼리 쪽 스크립트로 하고 regconfig 는 고정이다(위 참조).
  -- 그래도 채우는 이유는 같은 `detectScript()` 가 양쪽을 지배하게 두면 두 규칙이
  -- 갈라지지 않기 때문이다. 읽는 곳이 생기기 전까지는 진단용이다.
  lang           text,

  -- ★ 유일한 권한 축 [X-8]. `principals uuid[]` 는 U-3 이 폐기했다.
  perm_scope_id  uuid NOT NULL,
  is_public      boolean NOT NULL DEFAULT false,           -- 공개 링크(F-06-06)가 오면 쓴다
  origin         origin_kind NOT NULL DEFAULT 'native',    -- <15 R12>

  created_by     uuid NULL REFERENCES "user"(id),
  created_at     timestamptz NULL,
  last_edited_by uuid NULL REFERENCES "user"(id),
  last_edited_at timestamptz NULL,
  content_status text NULL,
  in_trash       boolean NOT NULL DEFAULT false,
  version        bigint NOT NULL DEFAULT 0,                -- = block.version [X-6]

  -- 정본 인덱스 식의 대체물(머리말 참조). GENERATED 라 앱이 갱신을 잊을 수 없다.
  -- 제목도 자른다 — `left()` 없이 두면 제목만으로 한도를 넘기는 경로가 남는다.
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(left(title_text, 10000), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(left(body_text, 100000), '')), 'B')
  ) STORED,

  -- 페이지 단위 색인의 불변식. 블록 단위로 확장하면 이 CHECK 을 떼는 마이그레이션이
  -- 그 변경의 일부가 된다 — 조용히 의미가 달라지지 않게.
  CONSTRAINT ck_search_page_scoped CHECK (type = 'page' AND page_id = doc_id)
);

-- 정본 §3.9 의 인덱스. 모든 검색 질의의 필수 술어다.
CREATE INDEX ix_search_scope ON search_document (workspace_id, perm_scope_id);

-- 라틴 축.
CREATE INDEX ix_search_tsv ON search_document USING gin (tsv);

-- CJK 축. pg_bigm 2-gram — 조사를 넘는 유일한 경로다(머리말 실측).
CREATE INDEX ix_search_title_bigm ON search_document USING gin (title_text gin_bigm_ops);
CREATE INDEX ix_search_body_bigm  ON search_document USING gin (body_text  gin_bigm_ops);

-- 랭킹의 타이브레이커(F-07-02: "Best Matches 에 recency 가 섞여 있다").
CREATE INDEX ix_search_recent ON search_document (workspace_id, last_edited_at DESC)
  WHERE in_trash = false;

COMMENT ON TABLE search_document IS
  'F-07-06. 색인 정본(정본 §3.9). Phase 0 은 type=''page'' 블록만 색인한다.
   텍스트(title_text·body_text·lang)는 앱이 쓰고, 메타(perm_scope_id·in_trash·
   ancestor_ids·version)는 tg_search_document_sync 트리거가 block 에서 따라간다 —
   권한 축을 앱이 복사하면 누락이 권한 누출이 되기 때문이다.';

COMMENT ON COLUMN search_document.tsv IS
  '정본 §3.9 의 to_tsvector(lang, ...) GIN 인덱스 식은 PostgreSQL 에서 만들어지지
   않는다(to_tsvector(text,text) 부재 + IMMUTABLE 요구). 고정 regconfig simple 의
   GENERATED 컬럼으로 대체했다. 한국어는 이 축으로 검색되지 않는다 — gin_bigm_ops
   축이 그 일을 한다.';

-- ──────────────────────────────────────────────────────────────────────
-- 메타데이터 동기화 트리거
-- ──────────────────────────────────────────────────────────────────────
--
-- `WHEN (NEW.type = 'page')` 을 트리거 정의에 둔다. 함수 안에서 걸러도 되지만,
-- 그러면 프로젝터가 본문 블록 N개를 쓸 때 plpgsql 함수가 N번 호출된다 —
-- 정의에 두면 Postgres 가 **호출 자체를 건너뛴다**. 프로젝터는 블록을 수십~수백
-- 개씩 쓰므로 이 차이가 모든 저장에 실린다.

CREATE FUNCTION search_document_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 영구 삭제된 페이지는 색인에서 내린다. `purged` 는 행이 아직 남아 있는
  -- 상태라(X-3) CASCADE 가 돌지 않는다 — 여기서 지우지 않으면 검색이 영구
  -- 삭제된 페이지를 계속 돌려준다.
  IF NEW.lifecycle = 'purged' THEN
    DELETE FROM search_document WHERE doc_id = NEW.id;
    RETURN NULL;
  END IF;

  INSERT INTO search_document (
    doc_id, workspace_id, region_id, page_id, parent_id, type,
    ancestor_ids, perm_scope_id, in_trash, version,
    created_by, created_at, last_edited_by, last_edited_at
  )
  SELECT
    NEW.id, NEW.workspace_id, w.region_id, NEW.id,
    -- 워크스페이스 직속 루트 페이지의 `parent_id` 는 workspace.id 다. 그것을
    -- 그대로 넣으면 "부모가 블록인 것처럼" 보이므로 블록 부모만 남긴다.
    CASE WHEN NEW.parent_type = 'block' THEN NEW.parent_id END,
    NEW.type, NEW.ancestor_path, NEW.perm_scope_id,
    NEW.lifecycle = 'trashed', NEW.version,
    NEW.created_by, NEW.created_at, NEW.last_edited_by, NEW.last_edited_at
  FROM workspace w WHERE w.id = NEW.workspace_id
  ON CONFLICT (doc_id) DO UPDATE SET
    -- ★ title_text · body_text · lang 은 **건드리지 않는다.** 그것들의 쓰기자는
    --   앱이고, 여기서 덮으면 페이지를 옮기거나 공유를 바꿀 때마다 본문 색인이
    --   NULL 로 날아간다.
    workspace_id   = EXCLUDED.workspace_id,
    parent_id      = EXCLUDED.parent_id,
    ancestor_ids   = EXCLUDED.ancestor_ids,
    perm_scope_id  = EXCLUDED.perm_scope_id,
    in_trash       = EXCLUDED.in_trash,
    version        = EXCLUDED.version,
    last_edited_by = EXCLUDED.last_edited_by,
    last_edited_at = EXCLUDED.last_edited_at;
    -- region_id · created_by · created_at 은 갱신하지 않는다. 불변이다
    -- (region_id 는 <17 F-17-06> "소급 불가").

  RETURN NULL;   -- AFTER 트리거의 반환값은 무시된다
END $$;

COMMENT ON FUNCTION search_document_sync() IS
  'F-07-06 의 "본문 재색인 없이 메타만 partial update 하는 경로". 페이지 이동으로
   ancestor_ids·perm_scope_id 가 바뀌거나 공유 설정으로 perm_scope_id 가 재계산될
   때, 본문을 다시 읽지 않고 메타만 따라간다.';

CREATE TRIGGER tg_search_document_sync
  AFTER INSERT OR UPDATE ON block
  FOR EACH ROW WHEN (NEW.type = 'page')
  EXECUTE FUNCTION search_document_sync();

-- ──────────────────────────────────────────────────────────────────────
-- 기존 페이지 백필
-- ──────────────────────────────────────────────────────────────────────
--
-- 트리거는 앞으로의 쓰기만 본다. 이미 있는 페이지에는 행이 생기지 않으므로
-- 검색에서 통째로 빠진다. 텍스트는 앱이 쓰므로 여기서는 메타만 넣는다 —
-- 제목은 `properties->'title'` 의 RichText[] 계약을 SQL 에 복제해야 하고,
-- 그 규칙이 두 곳에 생기면 한쪽만 고쳐지는 날이 온다.
--
-- 그래서 백필 행의 `title_text` 는 NULL 이고, 해당 페이지는 **저장·이름변경이
-- 한 번 일어날 때 검색 가능해진다.** 기존 데이터가 개발용뿐이라(PR 시점
-- 워크스페이스가 테스트 데이터다) 재색인 잡을 만들지 않았다. 운영 데이터가
-- 생기기 전에 전체 재색인 경로가 필요하다 — HANDOFF §7 에 남긴다.
INSERT INTO search_document (
  doc_id, workspace_id, region_id, page_id, parent_id, type,
  ancestor_ids, perm_scope_id, in_trash, version,
  created_by, created_at, last_edited_by, last_edited_at
)
SELECT
  b.id, b.workspace_id, w.region_id, b.id,
  CASE WHEN b.parent_type = 'block' THEN b.parent_id END,
  b.type, b.ancestor_path, b.perm_scope_id,
  b.lifecycle = 'trashed', b.version,
  b.created_by, b.created_at, b.last_edited_by, b.last_edited_at
FROM block b
JOIN workspace w ON w.id = b.workspace_id
WHERE b.type = 'page' AND b.lifecycle <> 'purged';
