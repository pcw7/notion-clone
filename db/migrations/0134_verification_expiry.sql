-- 검증 만료 알림 — 일의 종류 `verification_expire` · 알림 종류 `verification_expired` · 활동 이벤트 `verification.expired` (VF-3 · F-03-23)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 VF-1] ⑤ (만료 알림 — 한 번짜리 잡) · §3.10 공용 스케줄러 · §3.8 `activity_event.type` 의 목록
--
-- ① `scheduled_job.kind` 에 `verification_expire` 를 더한다 — 검증할 때 run_at = `expires_at` 로 넣는 한 번짜리 잡(주기 잡이 아니다).
-- ② `notification.kind` 에 `verification_expired` 를 더한다 — 소유자(비었으면 검증한 사람)에게 가는 인박스 알림.
-- ③ 알림이 가리킬 활동 이벤트 `verification.expired` 를 더한다(payload 는 속성 id 하나).
--
-- 기존 행: 목록을 넓히기만 한다 — 그대로 지난다.

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind
  CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire', 'data_retention', 'webhook_deliver', 'automation_dispatch',
                  'automation_webhook', 'verification_expire'));

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'mention', 'comment', 'comment_reply', 'page_update',
  'invite', 'reminder', 'person_property_assigned', 'suggestion',
  'access_requested', 'access_granted',
  'automation',
  'verification_expired'));

ALTER TABLE activity_event DROP CONSTRAINT activity_event_type_check;
ALTER TABLE activity_event ADD CONSTRAINT activity_event_type_check CHECK (type IN (
  'block.updated', 'property.updated', 'comment.created', 'user.mentioned',
  'page.created', 'page.moved', 'page.trashed',
  'suggestion.created', 'suggestion.accepted',
  'access.requested', 'access.granted',
  'reminder.fired',
  'person.assigned',
  'automation.notified',
  'verification.expired'));
