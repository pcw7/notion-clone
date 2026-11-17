-- AI 1차 기반 — 스위치 · 응답 원장 · 운영자 보충 · 앱 전체의 하루 카운터 · 한도의 요금제 권리 — AI-1 (F-10-12 · F-10-25)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강 AI-1] ③ ④ ⑤ ⑦ · CLAUDE.md 절대 제약 2(하드 캡 — 닫힌 쪽으로 실패)
--
-- ① `workspace_ai_setting` — 줄이 없으면 꺼짐(기본 끔 ⑤). 소유자만 켜고 끈다(`setAiEnabled` · 감사 `workspace.setting_changed` 의 키
--    `ai.enabled`). 게이트가 이 줄을 잠가 한 워크스페이스의 예약을 줄 세운다(④ — 같은 잔량을 두 번 쓰지 못한다).
-- ② `ai_usage` — 응답 하나(공급자 호출 하나)가 한 줄 · 사용량 화면과 감사(F-10-25)의 원장. **예약(`reserved`)을 넣는 것이 곧 셈이다.**
--    끝나면 `completed` · `stopped`(셈에 든다) · `failed`(셈에서 빠진다 — 응답을 받지 못했다). 끝나지 않은 `reserved` 도 센다.
--    `quota` 는 어느 몫에서 셌는가 — `plan`(월 · 6시간 창) · `trial`(평생 체험) · `grant`(운영자 보충 — 그 보충을 `grant_id` 로). 몫마다
--    쓴 양 · 보충마다 남은 수를 행에서 바로 센다(정본 ⑦ 에 이 두 열을 더했다 — 같은 날 정본을 먼저 고쳤다). 본문 · 질문은 싣지 않는다.
-- ③ `ai_grant` — 운영자 보충(`npm run ai:grant` — 노션의 크레딧 자리 · 결제 없음). 응답 수 > 0 · 만료(선택) · 까닭.
-- ④ `ai_daily_usage` — 앱 전체의 UTC 하루 카운터(`AI_DAILY_CAP`). 예약이 +1 · 공급자 실패가 그 예약의 날에서 -1. 음수는 없다.
-- ⑤ 한도의 요금제 권리 셋(limit) — `ai.trial_responses`(평생 · Free · Plus 20) · `ai.monthly_responses`(UTC 달력 달 · Business 1,000 ·
--    Enterprise 3,000) · `ai.window_responses`(지난 6시간 · Business 100 · Enterprise 300). 해당 없는 요금제는 0 이다(창은 월 몫을
--    조이는 것이라 월이 0 이면 쓰이지 않는다).

CREATE TABLE workspace_ai_setting (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id),
  enabled      boolean NOT NULL DEFAULT false,
  changed_by   uuid NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  -- 바꾼 사람은 그 워크스페이스의 사람이었다(멤버십 행은 지우지 않는다 · M1)
  CONSTRAINT fk_workspace_ai_setting_member FOREIGN KEY (workspace_id, changed_by) REFERENCES workspace_member (workspace_id, user_id)
);

CREATE TABLE ai_grant (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  responses    integer NOT NULL
               CONSTRAINT ck_ai_grant_responses CHECK (responses > 0 AND responses <= 1000000),
  reason       text NOT NULL
               CONSTRAINT ck_ai_grant_reason CHECK (char_length(reason) BETWEEN 1 AND 200 AND reason = btrim(reason)),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NULL,
  CONSTRAINT ck_ai_grant_expires CHECK (expires_at IS NULL OR expires_at > granted_at),
  -- ai_usage 가 (보충, 워크스페이스) 를 함께 가리킨다 — 다른 워크스페이스의 보충을 쓰지 못한다
  CONSTRAINT uq_ai_grant_workspace UNIQUE (id, workspace_id)
);

CREATE TABLE ai_usage (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id),
  user_id       uuid NOT NULL REFERENCES "user"(id),
  feature       text NOT NULL
                CONSTRAINT ck_ai_usage_feature CHECK (feature IN ('ask', 'edit', 'translate', 'block', 'chat')),
  status        text NOT NULL DEFAULT 'reserved'
                CONSTRAINT ck_ai_usage_status CHECK (status IN ('reserved', 'completed', 'failed', 'stopped')),
  quota         text NOT NULL
                CONSTRAINT ck_ai_usage_quota CHECK (quota IN ('plan', 'trial', 'grant')),
  grant_id      uuid NULL,
  model         text NOT NULL
                CONSTRAINT ck_ai_usage_model CHECK (char_length(model) BETWEEN 1 AND 200),
  input_tokens  integer NULL
                CONSTRAINT ck_ai_usage_input_tokens CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer NULL
                CONSTRAINT ck_ai_usage_output_tokens CHECK (output_tokens IS NULL OR output_tokens >= 0),
  -- 그 페이지의 맥락으로 물었다(권한을 본 페이지) — 페이지를 영구 삭제해도 원장은 남는다
  page_id       uuid NULL REFERENCES block(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz NULL,
  -- 보충에서 셌을 때만 그 보충을 가리킨다
  CONSTRAINT ck_ai_usage_grant CHECK ((quota = 'grant') = (grant_id IS NOT NULL)),
  -- 예약만 끝나지 않았다 · 끝은 시작보다 앞서지 않는다
  CONSTRAINT ck_ai_usage_finished CHECK ((status = 'reserved') = (finished_at IS NULL) AND (finished_at IS NULL OR finished_at >= created_at)),
  CONSTRAINT fk_ai_usage_grant FOREIGN KEY (grant_id, workspace_id) REFERENCES ai_grant (id, workspace_id),
  -- 쓴 사람은 그 워크스페이스의 사람이었다
  CONSTRAINT fk_ai_usage_member FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_member (workspace_id, user_id)
);

-- 몫마다 쓴 양(창 · 월 · 체험) — 실패는 세지 않는다
CREATE INDEX ix_ai_usage_counted ON ai_usage (workspace_id, quota, created_at) WHERE status <> 'failed';
-- 보충마다 쓴 양
CREATE INDEX ix_ai_usage_grant ON ai_usage (grant_id) WHERE grant_id IS NOT NULL AND status <> 'failed';
CREATE INDEX ix_ai_grant_workspace ON ai_grant (workspace_id, expires_at);

CREATE TABLE ai_daily_usage (
  day       date PRIMARY KEY,
  responses integer NOT NULL DEFAULT 0
            CONSTRAINT ck_ai_daily_usage_responses CHECK (responses >= 0)
);

COMMENT ON TABLE workspace_ai_setting IS
  'AI-1: 워크스페이스의 AI 스위치 — 줄이 없으면 꺼짐 · 소유자만 바꾼다 · 게이트가 잠가 예약을 줄 세운다.';
COMMENT ON TABLE ai_usage IS
  'AI-1: 응답 하나가 한 줄(원장 · F-10-25). reserved 를 넣는 것이 곧 셈 · failed 만 세지 않는다 · quota 는 plan/trial/grant.';
COMMENT ON TABLE ai_grant IS
  'AI-1: 운영자 보충(npm run ai:grant) — 요금제 몫을 다 쓴 뒤에 쓴다 · 만료가 이른 것부터 · 결제 없음.';
COMMENT ON TABLE ai_daily_usage IS
  'AI-1: 앱 전체의 UTC 하루 응답 수(AI_DAILY_CAP) — 예약이 +1 · 공급자 실패가 그날에서 -1.';

-- ⑤ 한도의 요금제 권리 — 모든 요금제가 세 키를 같은 종류(limit)로 갖는다(`billing.db.test.ts` ①)
INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, v.key, 'limit', v.value
  FROM plan p
  JOIN (VALUES
          ('free',       'ai.trial_responses',   '20'::jsonb),
          ('plus',       'ai.trial_responses',   '20'::jsonb),
          ('business',   'ai.trial_responses',   '0'::jsonb),
          ('enterprise', 'ai.trial_responses',   '0'::jsonb),
          ('free',       'ai.monthly_responses', '0'::jsonb),
          ('plus',       'ai.monthly_responses', '0'::jsonb),
          ('business',   'ai.monthly_responses', '1000'::jsonb),
          ('enterprise', 'ai.monthly_responses', '3000'::jsonb),
          ('free',       'ai.window_responses',  '0'::jsonb),
          ('plus',       'ai.window_responses',  '0'::jsonb),
          ('business',   'ai.window_responses',  '100'::jsonb),
          ('enterprise', 'ai.window_responses',  '300'::jsonb)
       ) AS v(code, key, value)
    ON v.code = p.code;
