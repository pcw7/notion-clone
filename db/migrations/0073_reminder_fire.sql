-- 리마인더 울리기 — 히스토리 · 활동 4c-2조각 (F-11-10 · 공용 스케줄러의 네 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 리마인더 ⑧ · `activity_event.type` 의 목록 · §3.10 [보강] 공용 스케줄러
--
-- ① 활동 이벤트에 `reminder.fired` 를 더한다 — 리마인더가 울렸다(payload 는 `reminder_id` · `property_id`). 알림 종류 `reminder` 는 초판에 있다.
-- ② 일의 종류에 `reminder_fire` 를 더한다 — `fire_at` 이 지난 리마인더를 1분마다 울리는 주기 일이다.
--
-- 기존 행: 두 목록 모두 넓히기만 한다 — 그대로 지난다.

ALTER TABLE activity_event DROP CONSTRAINT activity_event_type_check;
ALTER TABLE activity_event ADD CONSTRAINT activity_event_type_check CHECK (type IN (
  'block.updated', 'property.updated', 'comment.created', 'user.mentioned',
  'page.created', 'page.moved', 'page.trashed',
  'suggestion.created', 'suggestion.accepted',
  'access.requested', 'access.granted',
  'reminder.fired'));

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire'));
