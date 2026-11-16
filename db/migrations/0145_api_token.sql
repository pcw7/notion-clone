-- 공개 API 의 개인 토큰 — API-1 (F-09-02 · F-09-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.1 끝 [보강 API-1] 공개 API — 개인 토큰 · 노션 API 호환 ① ②
--       09-api-integrations.md F-09-02 *"토큰은 해시로만 저장하고 prefix 4~8자만 평문 보관해 UI 식별에 쓴다"* · PAT 만료 선택 · 즉시 폐기
--
-- ① `api_token` — 사람이 설정 → 내 계정 → "API 토큰" 에서 만든다. **한 워크스페이스에 묶이고 만든 사람의 권한 그대로** 움직인다.
--    값(`ntn_` + base62 46자)은 만들 때 한 번만 보이고 저장은 해시만(`token_hash` — 세션 토큰과 같은 sha256 hex). 끝 4자(`last4`)는
--    목록에서 알아보는 데만 쓴다. 멤버십 행을 가리킨다(복합 FK — 멤버십 행은 지우지 않는다 · M1) — 그 워크스페이스에 들어온 적 없는
--    사람의 토큰은 설 수 없다. 멤버십이 끊기면(내보내기 · 비활성 · 계정 삭제 · 워크스페이스 삭제) 0단계 게이트가 막는다 — 지우는 잡은 없다.
-- ② 살아 있는 것(`revoked_at IS NULL`)은 사람마다 워크스페이스마다 20개 — 명령이 그 사람의 멤버십 행을 잠그고 센다(부분 인덱스가 센다).
--    폐기는 표시다(`revoked_at`) — 곧바로 듣는다(게이트가 매 요청 읽는다).
-- ③ `last_used_at` 은 1분에 한 번만 쓴다(요청마다 쓰지 않는다 · `session-context.ts`).

CREATE TABLE api_token (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES "user"(id),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  name         text NOT NULL
               CONSTRAINT ck_api_token_name CHECK (char_length(name) BETWEEN 1 AND 100 AND name = btrim(name)),
  token_hash   text NOT NULL
               CONSTRAINT ck_api_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  last4        text NOT NULL
               CONSTRAINT ck_api_token_last4 CHECK (last4 ~ '^[0-9A-Za-z]{4}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  expires_at   timestamptz NULL,
  revoked_at   timestamptz NULL,
  CONSTRAINT uq_api_token_hash UNIQUE (token_hash),
  CONSTRAINT fk_api_token_member FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_member (workspace_id, user_id),
  CONSTRAINT ck_api_token_expires CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT ck_api_token_revoked CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT ck_api_token_last_used CHECK (last_used_at IS NULL OR last_used_at >= created_at)
);

-- ② 살아 있는 토큰 — 목록 · 20개 세기
CREATE INDEX ix_api_token_live ON api_token (workspace_id, user_id, created_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE api_token IS
  'API-1: 공개 API 의 개인 토큰 — 한 워크스페이스 · 만든 사람의 권한. 값은 해시만(token_hash) · 살아 있는 것 사람마다 워크스페이스마다 20개 · 폐기는 revoked_at.';
