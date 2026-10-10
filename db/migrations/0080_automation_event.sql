-- DB automation — 받기 · 실행 — 자동화 5b-2조각 (F-08-09 · F-08-10 · 공용 스케줄러의 일곱 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] DB automation — 받기 · 실행 ⓐ ~ ⓕ
--       08 F-08-09 *"Database automations work over a three second window"*
--
-- ① `automation_event` — automation · 행마다 모으는 묶음 하나(`ux_automation_event_collecting`). 첫 일의 창 전 값(`before`)을 붙들고
--    창(3초)이 끝나면 워커가 순변화로 판정한다. 잡으면 `dispatching`(임대)으로 바뀌어 그 사이의 일은 새 묶음으로 간다. 끝나면 지운다.
-- ② 짝 — 임대는 잡은 동안만(`ck_automation_event_lease`).
-- ③ 일의 종류에 `automation_dispatch` 를 더한다.
--
-- 기존 행: 새 표 · 일의 종류는 넓히기만 한다.

CREATE TABLE automation_event (
  id            uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  page_added    boolean NOT NULL DEFAULT false,
  before        jsonb NOT NULL DEFAULT '{}' CONSTRAINT ck_automation_event_before CHECK (jsonb_typeof(before) = 'object'),
  window_end    timestamptz NOT NULL,
  status        text NOT NULL CONSTRAINT ck_automation_event_status CHECK (status IN ('collecting', 'dispatching')),
  locked_until  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_automation_event_lease CHECK ((status = 'dispatching') = (locked_until IS NOT NULL))
);

-- automation · 행마다 모으는 묶음은 하나(정본 ⓑ)
CREATE UNIQUE INDEX ux_automation_event_collecting ON automation_event (automation_id, page_id) WHERE status = 'collecting';
-- 때가 된 묶음 — 워커가 찾는 모양
CREATE INDEX ix_automation_event_window ON automation_event (window_end) WHERE status = 'collecting';

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind
  CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire', 'data_retention', 'webhook_deliver', 'automation_dispatch'));
