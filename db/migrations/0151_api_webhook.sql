-- 공개 API 의 웹훅 — 구독 · 확인 토큰 · 서명 · 배달 아웃박스 (API-8 · F-09-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.1 끝 [보강 API-1] ⑫ · §3.10 `api_webhook_subscription` · `api_webhook_event`
--       (`api_file_upload` 옆) · §3.10 [보강] 공용 스케줄러(열 번째 소비자 `api_webhook_deliver`)
--       09-api-integrations.md F-09-09 — verification token 이 곧 HMAC 비밀 · `X-Notion-Signature: sha256=` · 8회 · 약 24시간 · 이벤트 봉투
--
-- ① `api_webhook_subscription` — 구독 하나는 **API 토큰 하나의 것**이다(노션의 웹훅은 통합의 것 — 우리의 통합 자리는 개인 토큰).
--    워크스페이스 · 사람은 토큰의 것과 같다(복합 FK — `uq_api_token_owner`). 토큰을 지우면 구독도 사라진다.
-- ② 상태 넷 — `pending_verification`(확인 토큰을 붙여 넣기 전) · `active` · `paused`(사람이 멈춤) · `disabled`(까닭이 있다 — 실패가
--    이어졌다 `failures` · 토큰을 폐기했다 `token_revoked`). 켜짐 · 멈춤은 확인한 뒤에만 있다 · 확인 전에는 확인 시각이 없다.
-- ③ 비밀 둘은 **봉인해 둔다** — 받는 주소(`url_sealed` — 주소에 비밀이 든 경우가 있다)와 확인 토큰(`secret_sealed` — 서명의 비밀).
--    AES-256-GCM 봉인(`net/url-seal.ts` 의 모양: 판 1바이트 = 1 ‖ IV 12 ‖ 태그 16 ‖ 암호문). 평문 칸은 없다 — 화면에는 주소의 힌트만.
-- ④ 이벤트 종류 — 비지 않은 목록 · 카탈로그의 것만(`lib/api/webhook-events.ts` 와 같은 목록 · API-9 가 내보낸다). `test` 는 고를 수 없다.
-- ⑤ `api_webhook_event` — **아웃박스**: 구독 × 이벤트 한 줄 · 만드는 쪽의 트랜잭션에서 쓴다. 워커(`api_webhook_deliver`)가 보낸다.
--    `event_id` 는 봉투의 `id`(받는 쪽의 멱등 키 — 한 이벤트가 여러 구독에 가면 같다 · 한 구독에는 한 번). 순서는 `seq`(같은 트랜잭션의
--    여러 줄도 줄 선다). 상태 넷 — `pending`(다음 시도 시각이 있다) · `delivered`(2xx) · `failed`(여덟 번 모두 실패) · `skipped`(보내지
--    않은 까닭이 있다 — 실패가 아니다). 응답 본문은 두지 않는다 — 상태 코드와 200자 이하의 짧은 까닭만.
-- ⑥ 한 구독에 동시에 하나만 보낸다 — 워커가 구독 행에 임대(`locked_until`)를 건다.
-- ⑦ 끝난 줄은 7일 뒤 지운다(`data_retention` ⑩ — 페이지 웹훅의 묶음과 같은 날).

ALTER TABLE api_token ADD CONSTRAINT uq_api_token_owner UNIQUE (id, workspace_id, user_id);

CREATE TABLE api_webhook_subscription (
  id                   uuid PRIMARY KEY,
  workspace_id         uuid NOT NULL REFERENCES workspace(id),
  api_token_id         uuid NOT NULL,
  user_id              uuid NOT NULL REFERENCES "user"(id),
  url_sealed           bytea NOT NULL
                       CONSTRAINT ck_api_webhook_url_sealed CHECK (octet_length(url_sealed) > 29 AND get_byte(url_sealed, 0) = 1),
  url_hint             text NOT NULL
                       CONSTRAINT ck_api_webhook_url_hint CHECK (char_length(url_hint) BETWEEN 1 AND 300),
  secret_sealed        bytea NOT NULL
                       CONSTRAINT ck_api_webhook_secret_sealed CHECK (octet_length(secret_sealed) > 29 AND get_byte(secret_sealed, 0) = 1),
  event_types          text[] NOT NULL
                       CONSTRAINT ck_api_webhook_event_types CHECK (
                         cardinality(event_types) BETWEEN 1 AND 21
                         AND array_position(event_types, NULL) IS NULL
                         AND event_types <@ ARRAY[
                           'page.created', 'page.properties_updated', 'page.content_updated', 'page.moved', 'page.deleted', 'page.undeleted',
                           'page.locked', 'page.unlocked',
                           'database.created', 'database.moved', 'database.deleted', 'database.undeleted',
                           'data_source.created', 'data_source.content_updated', 'data_source.moved', 'data_source.deleted',
                           'data_source.undeleted', 'data_source.schema_updated',
                           'comment.created', 'comment.updated', 'comment.deleted'
                         ]::text[]
                       ),
  status               text NOT NULL
                       CONSTRAINT ck_api_webhook_status CHECK (status IN ('pending_verification', 'active', 'paused', 'disabled')),
  disabled_reason      text NULL
                       CONSTRAINT ck_api_webhook_disabled_reason CHECK (disabled_reason IN ('failures', 'token_revoked')),
  verified_at          timestamptz NULL,
  -- 확인 토큰을 마지막으로 보낸 때와 그 결과(상태 코드 · 짧은 까닭) — 화면이 "보냈습니다 · HTTP 200" 을 말한다
  verification_sent_at timestamptz NULL,
  verification_status  int NULL
                       CONSTRAINT ck_api_webhook_verification_status CHECK (verification_status BETWEEN 100 AND 599),
  verification_error   text NULL
                       CONSTRAINT ck_api_webhook_verification_error CHECK (char_length(verification_error) <= 200),
  consecutive_failures int NOT NULL DEFAULT 0
                       CONSTRAINT ck_api_webhook_failures CHECK (consecutive_failures >= 0),
  locked_until         timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- ① 워크스페이스 · 사람은 토큰의 것
  CONSTRAINT fk_api_webhook_token FOREIGN KEY (api_token_id, workspace_id, user_id)
    REFERENCES api_token (id, workspace_id, user_id) ON DELETE CASCADE,
  -- ② 꺼짐에만 까닭이 있다
  CONSTRAINT ck_api_webhook_disabled_pair CHECK ((status = 'disabled') = (disabled_reason IS NOT NULL)),
  -- ② 확인 전에는 확인 시각이 없고 · 켜짐 · 멈춤은 확인한 뒤에만(꺼짐은 둘 다 — 확인 전에 토큰을 폐기할 수 있다)
  CONSTRAINT ck_api_webhook_verified CHECK (
    CASE status WHEN 'pending_verification' THEN verified_at IS NULL WHEN 'disabled' THEN true ELSE verified_at IS NOT NULL END
  ),
  CONSTRAINT ck_api_webhook_verified_order CHECK (verified_at IS NULL OR verified_at >= created_at),
  -- 결과는 보낸 뒤에만
  CONSTRAINT ck_api_webhook_verification_sent CHECK (
    verification_sent_at IS NOT NULL OR (verification_status IS NULL AND verification_error IS NULL)
  ),
  CONSTRAINT ck_api_webhook_updated CHECK (updated_at >= created_at)
);

-- 토큰의 구독 — 목록 · 토큰마다 세기
CREATE INDEX ix_api_webhook_token ON api_webhook_subscription (api_token_id, created_at, id);
-- 워크스페이스마다 세기 · 워커의 거르기
CREATE INDEX ix_api_webhook_workspace ON api_webhook_subscription (workspace_id);

CREATE TABLE api_webhook_event (
  id               uuid PRIMARY KEY,
  seq              bigint GENERATED ALWAYS AS IDENTITY,
  subscription_id  uuid NOT NULL REFERENCES api_webhook_subscription(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspace(id),
  event_id         uuid NOT NULL,
  type             text NOT NULL
                   CONSTRAINT ck_api_webhook_event_type CHECK (type IN (
                     'test',
                     'page.created', 'page.properties_updated', 'page.content_updated', 'page.moved', 'page.deleted', 'page.undeleted',
                     'page.locked', 'page.unlocked',
                     'database.created', 'database.moved', 'database.deleted', 'database.undeleted',
                     'data_source.created', 'data_source.content_updated', 'data_source.moved', 'data_source.deleted',
                     'data_source.undeleted', 'data_source.schema_updated',
                     'comment.created', 'comment.updated', 'comment.deleted'
                   )),
  entity_id        uuid NOT NULL,
  entity_type      text NOT NULL
                   CONSTRAINT ck_api_webhook_event_entity CHECK (
                     entity_type IN ('page', 'block', 'database', 'data_source', 'comment', 'webhook_subscription')
                   ),
  authors          jsonb NOT NULL DEFAULT '[]'::jsonb
                   CONSTRAINT ck_api_webhook_event_authors CHECK (jsonb_typeof(authors) = 'array'),
  data             jsonb NOT NULL DEFAULT '{}'::jsonb
                   CONSTRAINT ck_api_webhook_event_data CHECK (jsonb_typeof(data) = 'object'),
  occurred_at      timestamptz NOT NULL,
  status           text NOT NULL
                   CONSTRAINT ck_api_webhook_event_status CHECK (status IN ('pending', 'delivered', 'failed', 'skipped')),
  attempts         int NOT NULL DEFAULT 0
                   CONSTRAINT ck_api_webhook_event_attempts CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at  timestamptz NULL,
  last_attempt_at  timestamptz NULL,
  last_http_status int NULL
                   CONSTRAINT ck_api_webhook_event_http CHECK (last_http_status BETWEEN 100 AND 599),
  last_error       text NULL
                   CONSTRAINT ck_api_webhook_event_error CHECK (char_length(last_error) <= 200),
  skip_reason      text NULL
                   CONSTRAINT ck_api_webhook_event_skip_reason CHECK (skip_reason IN (
                     'paused', 'disabled', 'not_verified', 'token_revoked', 'token_expired', 'access_lost', 'entity_not_visible',
                     'webhooks_disabled', 'unseal_failed'
                   )),
  finished_at      timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- ⑤ 한 구독에 한 이벤트는 한 번
  CONSTRAINT uq_api_webhook_event_once UNIQUE (subscription_id, event_id),
  -- ⑤ 기다리는 것만 다음 시각이 있고 · 끝난 것만 끝난 시각이 있다
  CONSTRAINT ck_api_webhook_event_pending CHECK ((status = 'pending') = (next_attempt_at IS NOT NULL)),
  CONSTRAINT ck_api_webhook_event_finished CHECK ((status = 'pending') = (finished_at IS NULL)),
  -- ⑤ 보냄은 한 번 이상 보냈고 2xx 다 · 실패는 여덟 번 모두 · 건너뜀에만 까닭이 있다
  CONSTRAINT ck_api_webhook_event_delivered CHECK (status <> 'delivered' OR (attempts >= 1 AND last_http_status BETWEEN 200 AND 299)),
  CONSTRAINT ck_api_webhook_event_failed CHECK (status <> 'failed' OR attempts = 8),
  CONSTRAINT ck_api_webhook_event_skipped CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  -- 시도한 적이 있어야 마지막 시도 시각이 있다
  CONSTRAINT ck_api_webhook_event_attempted CHECK ((attempts = 0) = (last_attempt_at IS NULL)),
  -- `test` 의 대상은 구독 자신이다(노션에 없는 이벤트 — 정본 ⑫)
  CONSTRAINT ck_api_webhook_event_test CHECK ((type = 'test') = (entity_type = 'webhook_subscription'))
);

-- 워커 — 때가 된 것
CREATE INDEX ix_api_webhook_event_due ON api_webhook_event (next_attempt_at) WHERE status = 'pending';
-- 워커 — 같은 대상의 앞선 것(대상마다 차례를 지킨다)
CREATE INDEX ix_api_webhook_event_entity ON api_webhook_event (subscription_id, entity_id, seq) WHERE status = 'pending';
-- 화면의 배달 기록(최근 것부터)
CREATE INDEX ix_api_webhook_event_log ON api_webhook_event (subscription_id, seq DESC);
-- 끝난 것 지우기
CREATE INDEX ix_api_webhook_event_finished ON api_webhook_event (finished_at) WHERE finished_at IS NOT NULL;

-- 공용 스케줄러의 열 번째 소비자
ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind
  CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire', 'data_retention', 'webhook_deliver', 'automation_dispatch',
                  'automation_webhook', 'verification_expire', 'api_webhook_deliver'));

COMMENT ON TABLE api_webhook_subscription IS
  'API-8: 공개 API 의 웹훅 구독 — API 토큰 하나의 것 · pending_verification/active/paused/disabled · 주소와 확인 토큰(HMAC 비밀)은 봉인.';
COMMENT ON TABLE api_webhook_event IS
  'API-8: 웹훅 아웃박스 — 구독 × 이벤트 한 줄 · pending/delivered/failed/skipped · 8회 · 응답 본문 없음 · 끝나고 7일 뒤 지운다.';
