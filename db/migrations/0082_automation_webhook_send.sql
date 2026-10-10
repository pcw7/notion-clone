-- send_webhook — 보내기 — 자동화 5c-2조각 (F-08-13 · 공용 스케줄러의 여덟 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑬
--       08 F-08-13 *"전송 실패 시 느낌표가 표시되고 automation 이 자동 일시정지되며 사용자가 수동으로 재개해야 한다"*
--
-- ① 꺼진 까닭에 `webhook_failed` 를 더한다 — 배달이 네 번 실패하면 automation 을 멈춘다(버튼이면 버튼이 꺼진다).
-- ② 일의 종류에 `automation_webhook` 을 더한다.
-- ③ 끝난 배달을 7일 뒤 지우는 색인(`data_retention` — 페이지 웹훅의 배달과 같다).
--
-- 기존 행: 값을 넓히기만 한다.

ALTER TABLE automation DROP CONSTRAINT ck_automation_disabled_reason_value;
ALTER TABLE automation ADD CONSTRAINT ck_automation_disabled_reason_value
  CHECK (disabled_reason IN ('creator_left', 'trigger_broken', 'failures', 'webhook_failed'));

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind
  CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire', 'data_retention', 'webhook_deliver', 'automation_dispatch',
                  'automation_webhook'));

CREATE INDEX ix_automation_delivery_finished ON automation_delivery (finished_at) WHERE finished_at IS NOT NULL;
