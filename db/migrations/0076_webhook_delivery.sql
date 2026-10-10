-- 웹훅 보내기 — 히스토리 · 활동 4e-2조각 (F-11-19 · 공용 스케줄러의 여섯 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 — 보내기 ⓐ ~ ⓖ
--       11 F-11-11b *"편집 폭주 → 시간 윈도우(예: 5분) 집계 후 1건으로 게시"* · 08 F-08-13 *"짧은 재시도 3회 후 동일하게 정지"*
--
-- ① `webhook_delivery` — 웹훅마다 모으는 묶음 하나(`ux_webhook_delivery_collecting`). 묶음의 id 가 받는 쪽의 멱등 키다.
--    상태: collecting(모으는 중) → pending(보낼 차례 — 첫 시도 · 다시) → sent · failed · dropped(끝).
-- ② 짝 — 보낼 시각은 pending 일 때만 · 끝난 시각은 끝났을 때만 · 이벤트는 하나 이상.
-- ③ 일의 종류에 `webhook_deliver` 를 더한다(1분마다).
-- ④ 색인 — 때가 된 묶음(모으는 것의 창 끝 · 보낼 차례의 시각) · 끝난 묶음(7일 뒤 지운다).
--
-- 기존 행: 새 표 · 일의 종류는 넓히기만 한다.

CREATE TABLE webhook_delivery (
  id               uuid PRIMARY KEY,
  webhook_id       uuid NOT NULL REFERENCES page_webhook(id) ON DELETE CASCADE,
  event_ids        uuid[] NOT NULL,
  window_end       timestamptz NOT NULL,
  status           text NOT NULL
                   CONSTRAINT ck_webhook_delivery_status CHECK (status IN ('collecting', 'pending', 'sent', 'failed', 'dropped')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NULL,
  locked_until     timestamptz NULL,
  last_status      int NULL,
  last_error       text NULL,
  finished_at      timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_webhook_delivery_events CHECK (cardinality(event_ids) >= 1),
  CONSTRAINT ck_webhook_delivery_pending CHECK ((status = 'pending') = (next_attempt_at IS NOT NULL)),
  CONSTRAINT ck_webhook_delivery_finished CHECK ((status IN ('sent', 'failed', 'dropped')) = (finished_at IS NOT NULL))
);

-- 웹훅마다 모으는 묶음은 하나(정본 ⓐ — 이벤트는 여기에 더해진다)
CREATE UNIQUE INDEX ux_webhook_delivery_collecting ON webhook_delivery (webhook_id) WHERE status = 'collecting';
-- 때가 된 묶음 — 워커가 찾는 두 모양
CREATE INDEX ix_webhook_delivery_window ON webhook_delivery (window_end) WHERE status = 'collecting';
CREATE INDEX ix_webhook_delivery_next ON webhook_delivery (next_attempt_at) WHERE status = 'pending';
-- 끝난 묶음 — 7일 뒤 지운다(정본 ⓖ)
CREATE INDEX ix_webhook_delivery_finished ON webhook_delivery (finished_at) WHERE finished_at IS NOT NULL;

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind
  CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire', 'data_retention', 'webhook_deliver'));
