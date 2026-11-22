-- 공개 API 의 파일 올리기 세션 — API-7 (F-09-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.1 끝 [보강 API-1] ⑪ · §3.10 `api_file_upload`(`file` 옆)
--       09-api-integrations.md F-09-08 — 만들기 → 보내기 → 붙이기 · `expiry_time` 은 "붙지 않은 업로드" 의 만료 · 붙으면 영구 · 한 id 를 여러 곳에
--
-- ① 세션 하나 = 올릴 파일 하나. **id 는 올린 뒤의 `file.id` 와 같다** — `file_id` 는 그 값만 받는다(왕복이 쉽고, 앱에서 올린 파일의 id 를
--    받던 옛 `file_upload {id}` 와 같은 이름 공간이다).
-- ② 주인은 토큰의 사람 — 멤버십 행을 가리킨다(복합 FK · `api_token` 과 같다). 남의 세션은 없는 것과 같다(404).
-- ③ 저장하는 상태는 둘 — `pending`(보내기 전) · `uploaded`(파일 행이 있다 · 길이가 있다). `expired` 는 읽을 때 판정한다(붙지 않았고
--    `expires_at` 이 지났다 — 지우는 잡이 없다). `failed` 는 생기지 않는다(`external_url` 을 받지 않는다).
-- ④ 만료 — 만든 뒤 1시간(`expires_at`). 붙이면 `attached_at` 을 쓰고 `expires_at` 을 비운다(노션 — 붙은 업로드는 만료되지 않는다).
--    둘은 함께 움직인다(하나만 있는 상태는 없다).

CREATE TABLE api_file_upload (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspace(id),
  user_id        uuid NOT NULL REFERENCES "user"(id),
  status         text NOT NULL
                 CONSTRAINT ck_api_file_upload_status CHECK (status IN ('pending', 'uploaded')),
  -- F-12-09 의 900바이트(`file.original_name` 과 같은 값)
  filename       text NULL
                 CONSTRAINT ck_api_file_upload_filename CHECK (filename IS NULL OR octet_length(filename) BETWEEN 1 AND 900),
  -- MIME 의 모양(소문자 · 매개변수 없이)
  content_type   text NULL
                 CONSTRAINT ck_api_file_upload_content_type CHECK (
                   content_type IS NULL OR content_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'
                 ),
  content_length bigint NULL,
  file_id        uuid NULL REFERENCES file(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_edited_at timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NULL,
  attached_at    timestamptz NULL,
  CONSTRAINT fk_api_file_upload_member FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_member (workspace_id, user_id),
  -- ① 파일 행은 올린 뒤에만 · 같은 id 만
  CONSTRAINT ck_api_file_upload_file CHECK ((status = 'uploaded') = (file_id IS NOT NULL) AND (file_id IS NULL OR file_id = id)),
  -- ③ 길이는 올린 뒤에만 · 0 바이트는 없다(앱의 업로드가 거부한다)
  CONSTRAINT ck_api_file_upload_length CHECK ((status = 'uploaded') = (content_length IS NOT NULL) AND (content_length IS NULL OR content_length > 0)),
  -- ④ 붙는 것은 올린 것만 · 붙으면 만료가 없다 · 붙지 않았으면 만료가 있다
  CONSTRAINT ck_api_file_upload_attached CHECK (attached_at IS NULL OR (status = 'uploaded' AND attached_at >= created_at)),
  CONSTRAINT ck_api_file_upload_expiry CHECK ((attached_at IS NULL) = (expires_at IS NOT NULL) AND (expires_at IS NULL OR expires_at > created_at)),
  CONSTRAINT ck_api_file_upload_edited CHECK (last_edited_at >= created_at)
);

-- `GET /v1/file_uploads` — 내 것만 · 최근 것부터
CREATE INDEX ix_api_file_upload_owner ON api_file_upload (workspace_id, user_id, created_at DESC, id DESC);

COMMENT ON TABLE api_file_upload IS
  'API-7: 공개 API 의 파일 올리기 세션 — id = 올린 뒤의 file.id · 주인은 토큰의 사람 · pending/uploaded(expired 는 읽을 때) · 붙으면 expires_at NULL.';
