-- 파일 · 스토리지 (F-12-09 / F-09-08 / F-01-15)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 `file`
--
-- 정본이 이 표에 달아 둔 주석 한 줄이 설계를 결정한다:
--   "서명 URL 은 저장하지 않고 조회 시점에 생성한다(저장하면 만료 관리가 불가능)."
-- 그래서 여기에는 URL 컬럼이 **없다.** 있는 것은 `storage_key` 뿐이고, 읽는 쪽이
-- 그때그때 접근 경로를 만든다. F-12-09 가 확인한 대로 노션의 서명 URL 은 1시간 뒤
-- 죽으므로, 문서나 DB 에 박아 넣으면 "정적 사이트·캐시·메일에 굽는" 고전적 사고가 된다.
--
-- ⚠ 정본과 다른 점 하나: 정본 §3.10 은 `workspace_id uuid NOT NULL` 로만 적고 FK 를
-- 생략했다. 워크스페이스에 매인 다른 표(§3.4 `block` 등)는 전부 `REFERENCES
-- workspace(id)` 를 달고 있어 표기 누락으로 판단하고 FK 를 건다. 의미를 바꾸는 변경이
-- 아니라 제약을 **강화**하는 쪽이라 정본을 고치지는 않았다.

CREATE TABLE file (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id),
  region_id     text NOT NULL REFERENCES region(id),  -- 불변식 RG1: 엔드포인트를 코드에 박지 않는다
  storage_key   text NOT NULL,                        -- 버킷 안의 키. URL 이 아니다
  mime          text,
  size_bytes    bigint,
  original_name text,
  checksum      text,                                 -- sha256 hex. 같은 바이트인지 확인용
  -- block + page_version 참조를 모두 포함한다 <S5>.
  ref_count     int NOT NULL DEFAULT 0,
  uploaded_by   uuid NULL REFERENCES "user"(id),      -- NULL = 시스템/임포트
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 표현 가능한 불변식은 CHECK 으로 승격한다(CLAUDE.md).
  CONSTRAINT ck_file_ref_count_not_negative CHECK (ref_count >= 0),
  CONSTRAINT ck_file_size_not_negative CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT ck_file_storage_key_not_blank CHECK (length(storage_key) > 0),
  -- F-12-09: "파일명 최대 길이 900 bytes(확장자 포함)". 글자 수가 아니라 바이트다 —
  -- 한글 파일명은 글자당 3바이트이므로 둘을 혼동하면 300자에서 잘린다.
  CONSTRAINT ck_file_name_length CHECK (original_name IS NULL OR octet_length(original_name) <= 900)
);

-- 같은 객체를 두 번 등록하지 않는다. 키는 업로드할 때 uuid 로 만들므로 충돌 자체가
-- 사고 신호다(같은 키에 다른 파일을 덮어썼다는 뜻).
CREATE UNIQUE INDEX ux_file_storage_key ON file (storage_key);

CREATE INDEX ix_file_workspace ON file (workspace_id, created_at DESC);

-- GC 대상 조회 — 아무도 참조하지 않는 파일. 부분 인덱스라 참조가 있는 파일은 담지 않는다.
CREATE INDEX ix_file_unreferenced ON file (workspace_id) WHERE ref_count = 0;

COMMENT ON TABLE file IS
  '불변식 FS1: ref_count 가 0 이 되기 전에는 스토리지 객체를 지우지 않는다. '
  'F-09-08 이 확인한 대로 하나의 업로드를 여러 블록이 공유하는 것이 정상 상태다 — '
  '블록 하나를 지웠다고 객체를 지우면 다른 블록이 깨진다. '
  '불변식 FS2: 서명 URL 은 저장하지 않는다. 저장 대상은 storage_key 이고 '
  '접근 경로는 조회 시점에 만든다.';
