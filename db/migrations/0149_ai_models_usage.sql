-- AI 모델 고르기 · 사용량 분석 — AI-7 (F-10-26 · F-10-25)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강 AI-1] ⑫
--
-- ① `workspace_ai_setting.allowed_models` — 소유자가 멤버에게 더한 모델(자동 = `AI_MODEL` 은 늘 쓸 수 있어 넣지 않는다). ≤ 20 · 겹침 없음 ·
--    1~200자 · 앞뒤 공백 없음 · NULL 원소 없음 · 1차원(함수 `ai_model_ids_valid` — CHECK 은 집합을 펼치는 함수를 못 쓴다).
-- ② `workspace_ai_setting.default_model` — 워크스페이스 기본(편집기의 기능 · 채팅의 "자동"). NULL = 자동. 있으면 `allowed_models` 안.
-- ③ `ai_chat_session.model` — 대화마다 고른 모델. NULL = 자동(워크스페이스 기본). 허용인지는 게이트가 턴마다 본다(회수돼도 줄은 그대로 —
--    다음 턴이 기본으로 돌아간다).
-- ④ 사용량 분석 · 활동 기록 — 원장(`ai_usage`)만 읽는다(최근 것부터 · 사람마다). 새 표는 없다.

CREATE FUNCTION ai_model_ids_valid(ids text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m text;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF ids IS NULL THEN RETURN false; END IF;
  IF array_ndims(ids) IS NOT NULL AND array_ndims(ids) <> 1 THEN RETURN false; END IF;
  IF cardinality(ids) > 20 THEN RETURN false; END IF;
  FOREACH m IN ARRAY ids LOOP
    IF m IS NULL OR char_length(m) NOT BETWEEN 1 AND 200 OR m <> btrim(m) THEN RETURN false; END IF;
    IF m = ANY (seen) THEN RETURN false; END IF;
    seen := seen || m;
  END LOOP;
  RETURN true;
END
$$;

ALTER TABLE workspace_ai_setting
  ADD COLUMN allowed_models text[] NOT NULL DEFAULT '{}',
  ADD COLUMN default_model  text NULL;

ALTER TABLE workspace_ai_setting
  ADD CONSTRAINT ck_workspace_ai_setting_allowed CHECK (ai_model_ids_valid(allowed_models));

-- 기본은 더한 모델 중 하나다(자동이면 NULL)
ALTER TABLE workspace_ai_setting
  ADD CONSTRAINT ck_workspace_ai_setting_default CHECK (default_model IS NULL OR default_model = ANY (allowed_models));

ALTER TABLE ai_chat_session
  ADD COLUMN model text NULL;

ALTER TABLE ai_chat_session
  ADD CONSTRAINT ck_ai_chat_session_model CHECK (model IS NULL OR (char_length(model) BETWEEN 1 AND 200 AND model = btrim(model)));

-- 활동 기록(최근 것부터 · 키셋 커서) · 이번 달 · 지난 30일
CREATE INDEX ix_ai_usage_recent ON ai_usage (workspace_id, created_at DESC, id DESC);
-- 자기 것만 보는 멤버 · 사람으로 거른 기록
CREATE INDEX ix_ai_usage_user_recent ON ai_usage (workspace_id, user_id, created_at DESC, id DESC);

COMMENT ON COLUMN workspace_ai_setting.allowed_models IS
  'AI-7: 소유자가 멤버에게 더한 모델(자동 = AI_MODEL 은 늘 된다 · 넣지 않는다) — ≤ 20 · 겹침 없음.';
COMMENT ON COLUMN workspace_ai_setting.default_model IS
  'AI-7: 워크스페이스 기본 모델(편집기의 기능 · 채팅의 자동) — NULL 은 자동(AI_MODEL) · 있으면 allowed_models 안.';
COMMENT ON COLUMN ai_chat_session.model IS
  'AI-7: 대화마다 고른 모델 — NULL 은 자동(워크스페이스 기본) · 허용인지는 게이트가 턴마다 본다.';
