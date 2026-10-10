-- 자동화 엔진 · 버튼 속성 — 자동화 5a-1조각 (F-08-07 · F-03-15)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 DDL(`automation` · `automation_action` · `automation_run`) ·
--       [보강] 자동화 엔진 · 버튼 속성 ① ~ ⑧
--
-- ① `automation` — [정정] 다형 `host_id` 대신 주인 칸 셋(속성 · 데이터 소스 · 페이지)과 kind 마다 정확히 하나(`ck_automation_host`).
--    모두 FK ON DELETE CASCADE — 주인이 지워지면 함께 지워진다(물리 삭제가 따로 챙길 표가 아니다). 버튼 속성마다 하나(부분 UNIQUE).
-- ② `automation_action` — 종류는 처음부터 상위집합으로 CHECK(⑥). 순서는 0부터의 네 자리 글자 — 목록을 통째로 바꿔 쓴다.
-- ③ `automation_run` — 실행 기록. [보강] 칸 `steps`(단계마다의 결과). 끝난 실행만 끝난 시각을 갖는다(`ck_automation_run_finished`).
--    멱등 키는 워크스페이스 안에서 하나(정본 DDL 의 UNIQUE — 연타는 한 번 · ⑤).
-- ④ 셀 가드(0025)에 `button` 을 더한다 — 버튼 속성은 셀이 없는 타입이다(②).
--
-- 기존 행: 새 표 셋 · 가드 함수는 목록만 넓힌다(버튼 속성은 지금까지 만들 수 없었다 — 아래에서 확인한다).

DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM page_property_value v
    JOIN property p ON p.id = v.property_id
   WHERE p.type = 'button';
  IF bad > 0 THEN
    RAISE EXCEPTION '버튼 프로퍼티에 셀 행이 %개 있다 — 지우고 다시 실행한다', bad;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION page_property_value_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type property_type;
BEGIN
  SELECT type INTO owner_type FROM property WHERE id = NEW.property_id;

  IF owner_type IN ('relation', 'formula', 'rollup',
                    'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id', 'button') THEN
    RAISE EXCEPTION '% 프로퍼티는 셀 값을 갖지 않는다 (property %)', owner_type, NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_type_guard';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_type_guard() IS
  '불변식 C1 · C2. 셀을 갖지 않는 타입(relation · formula · rollup · 자동 메타 4종 · unique_id · button)의 프로퍼티에는
   page_property_value 행을 만들 수 없다. relation 의 정본은 relation_edge, rollup 은 읽을 때 계산한다. button 은 값이 없다(5a-1).';

CREATE TABLE automation (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspace(id),
  kind                text NOT NULL
                      CONSTRAINT ck_automation_kind CHECK (kind IN ('button_block', 'button_property', 'db_automation')),
  host_property_id    text NULL REFERENCES property(id) ON DELETE CASCADE,
  host_data_source_id uuid NULL REFERENCES data_source(id) ON DELETE CASCADE,
  host_page_id        uuid NULL REFERENCES block(id) ON DELETE CASCADE,
  name                text NULL,
  label               text NULL,
  style               jsonb NULL,
  trigger_mode        text NOT NULL DEFAULT 'any' CONSTRAINT ck_automation_trigger_mode CHECK (trigger_mode IN ('any', 'all')),
  enabled             boolean NOT NULL DEFAULT true,
  created_by          uuid NOT NULL REFERENCES "user"(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_automation_host CHECK (
    (kind = 'button_property' AND host_property_id IS NOT NULL AND host_data_source_id IS NULL AND host_page_id IS NULL)
    OR (kind = 'db_automation' AND host_data_source_id IS NOT NULL AND host_property_id IS NULL AND host_page_id IS NULL)
    OR (kind = 'button_block' AND host_page_id IS NOT NULL AND host_property_id IS NULL AND host_data_source_id IS NULL)
  )
);
-- 버튼 속성마다 automation 하나(②)
CREATE UNIQUE INDEX ux_automation_button_property ON automation (host_property_id) WHERE kind = 'button_property';
CREATE INDEX ix_automation_data_source ON automation (host_data_source_id) WHERE host_data_source_id IS NOT NULL;
CREATE INDEX ix_automation_page ON automation (host_page_id) WHERE host_page_id IS NOT NULL;

CREATE TABLE automation_action (
  id            uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
  order_idx     text NOT NULL CONSTRAINT ck_automation_action_order CHECK (order_idx ~ '^[0-9]{4}$'),
  type          text NOT NULL CONSTRAINT ck_automation_action_type
                CHECK (type IN ('edit_property', 'add_page_to', 'insert_blocks', 'send_webhook', 'define_variables', 'show_confirmation')),
  config        jsonb NOT NULL CONSTRAINT ck_automation_action_config CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT ux_automation_action_order UNIQUE (automation_id, order_idx)
);

CREATE TABLE automation_run (
  id              uuid PRIMARY KEY,
  automation_id   uuid NULL REFERENCES automation(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspace(id),
  run_kind        text NOT NULL DEFAULT 'automation'
                  CONSTRAINT ck_automation_run_kind CHECK (run_kind IN ('automation', 'ai_autofill', 'agent', 'sync')),
  trigger_page_id uuid NULL REFERENCES block(id) ON DELETE SET NULL,
  actor_id        uuid NULL REFERENCES "user"(id),
  origin          text NOT NULL CONSTRAINT ck_automation_run_origin CHECK (origin IN ('user', 'automation', 'schedule', 'api', 'sync')),
  depth           int NOT NULL DEFAULT 0 CONSTRAINT ck_automation_run_depth CHECK (depth >= 0),
  status          text NOT NULL CONSTRAINT ck_automation_run_status CHECK (status IN ('queued', 'running', 'success', 'partial', 'failed')),
  idempotency_key text NULL,
  steps           jsonb NOT NULL DEFAULT '[]' CONSTRAINT ck_automation_run_steps CHECK (jsonb_typeof(steps) = 'array'),
  error           jsonb NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz NULL,
  CONSTRAINT ck_automation_run_finished CHECK ((status IN ('success', 'partial', 'failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT ux_automation_run_idempotency UNIQUE (workspace_id, idempotency_key)
);
-- 그 automation 의 최근 실행 — 기록 화면 · 50건 상한(⑧)
CREATE INDEX ix_automation_run_automation ON automation_run (automation_id, started_at DESC);
