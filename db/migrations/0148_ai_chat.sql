-- AI 채팅 · 내 AI 지시 — AI-6 (F-10-17 · F-10-22)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강 AI-1] ⑪ · ④(한 턴 = 응답 하나 · 원장 `ai_usage`)
--
-- ① `ai_chat_session` — 그 사람만의 대화(모든 읽기 · 쓰기가 `user_id = ctx.userId` 로 거른다). 제목은 첫 질문의 첫 줄(1~60자 · 앞뒤 공백 없음).
--    범위는 `{kind:'workspace'}` | `{kind:'page', pageId}` — 다른 열쇠는 없다. 멤버십 행을 가리킨다(복합 FK · 멤버십은 지우지 않는다 · M1) —
--    떠난 사람은 0단계 게이트가 막는다(지우는 잡은 없다). 계정을 지우면 명령이 지운다(`account-deletion.ts`).
-- ② `ai_chat_message` — 대화를 지우면 함께 지워진다(CASCADE). 차례는 `seq`(넣은 차례). 사람의 말은 상태 · 출처 · 토큰 · 원장이 없고 비지 않는다.
--    AI 의 답은 상태(completed · stopped · failed — 받은 데까지)와 원장의 그 응답(`usage_id` · 하나에 하나)이 있다. 출처는 배열 ≤ 8.
--    원장은 지우지 않는다 — 대화를 지워도 셈의 기록은 남는다(FK 는 원장 쪽으로만 향한다).
-- ③ `ai_user_setting` — 사람마다 워크스페이스마다 한 줄 · 내 AI 지시 페이지 하나(한 번에 하나 — PK 가 강제한다). 페이지를 영구 삭제하면 비운다.

CREATE TABLE ai_chat_session (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  user_id      uuid NOT NULL REFERENCES "user"(id),
  title        text NOT NULL
               CONSTRAINT ck_ai_chat_session_title CHECK (char_length(title) BETWEEN 1 AND 60 AND title = btrim(title)),
  -- 칸이 없으면(`->>` 가 NULL) CHECK 이 NULL 로 통과하는 구멍 — 통째로 COALESCE(…, false)
  scope        jsonb NOT NULL DEFAULT '{"kind": "workspace"}'::jsonb
               CONSTRAINT ck_ai_chat_session_scope CHECK (COALESCE(
                 jsonb_typeof(scope) = 'object' AND scope - 'kind' - 'pageId' = '{}'::jsonb AND (
                   (scope ->> 'kind' = 'workspace' AND NOT scope ? 'pageId')
                   OR (scope ->> 'kind' = 'page' AND jsonb_typeof(scope -> 'pageId') = 'string'
                       AND scope ->> 'pageId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
                 ),
                 false
               )),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ai_chat_session_updated CHECK (updated_at >= created_at),
  CONSTRAINT fk_ai_chat_session_member FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_member (workspace_id, user_id)
);

-- 목록 — 그 사람의 것 · 최근 것부터
CREATE INDEX ix_ai_chat_session_list ON ai_chat_session (workspace_id, user_id, updated_at DESC, id);

CREATE TABLE ai_chat_message (
  id            uuid PRIMARY KEY,
  session_id    uuid NOT NULL REFERENCES ai_chat_session(id) ON DELETE CASCADE,
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  role          text NOT NULL
                CONSTRAINT ck_ai_chat_message_role CHECK (role IN ('user', 'assistant')),
  content       text NOT NULL
                CONSTRAINT ck_ai_chat_message_content CHECK (char_length(content) <= 20000 AND (role = 'assistant' OR btrim(content) <> '')),
  sources       jsonb NOT NULL DEFAULT '[]'::jsonb
                CONSTRAINT ck_ai_chat_message_sources CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 8),
  status        text NULL
                CONSTRAINT ck_ai_chat_message_status CHECK (status IS NULL OR status IN ('completed', 'stopped', 'failed')),
  input_tokens  integer NULL
                CONSTRAINT ck_ai_chat_message_input_tokens CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer NULL
                CONSTRAINT ck_ai_chat_message_output_tokens CHECK (output_tokens IS NULL OR output_tokens >= 0),
  usage_id      uuid NULL REFERENCES ai_usage(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 사람의 말 — 상태 · 출처 · 토큰 · 원장이 없다. AI 의 답 — 상태와 원장의 응답이 있다
  CONSTRAINT ck_ai_chat_message_shape CHECK (
    (role = 'user' AND status IS NULL AND sources = '[]'::jsonb AND input_tokens IS NULL AND output_tokens IS NULL AND usage_id IS NULL)
    OR (role = 'assistant' AND status IS NOT NULL AND usage_id IS NOT NULL)
  ),
  -- 원장의 응답 하나에 답 하나
  CONSTRAINT uq_ai_chat_message_usage UNIQUE (usage_id)
);

CREATE INDEX ix_ai_chat_message_session ON ai_chat_message (session_id, seq);

CREATE TABLE ai_user_setting (
  workspace_id         uuid NOT NULL REFERENCES workspace(id),
  user_id              uuid NOT NULL REFERENCES "user"(id),
  instructions_page_id uuid NULL REFERENCES block(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT fk_ai_user_setting_member FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_member (workspace_id, user_id)
);

COMMENT ON TABLE ai_chat_session IS
  'AI-6: 그 사람만의 AI 대화 — 제목은 첫 질문(≤ 60) · 범위 workspace | page · 지우면 메시지와 함께 없어진다(원장은 남는다).';
COMMENT ON TABLE ai_chat_message IS
  'AI-6: 대화의 메시지 — 사람의 말(상태 없음) · AI 의 답(completed | stopped | failed · 출처 · 토큰 · 원장의 응답 하나).';
COMMENT ON TABLE ai_user_setting IS
  'AI-6: 사람마다 워크스페이스마다 AI 설정 — 내 AI 지시 페이지 하나(F-10-22 · 채팅에만 싣는다).';
