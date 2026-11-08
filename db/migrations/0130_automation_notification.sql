-- 알림 보내기 액션 — 알림 종류 `automation` · 활동 이벤트 `automation.notified` · 액션 종류 `send_notification` (AN-1 · F-08-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강 AN-1] ③ (알림 종류) · ① (액션 종류) · §3.8 `activity_event.type` 의 목록
--       08-*.md F-08-07 *"Send notification to"*
--
-- ① `notification.kind` 에 `automation` 을 더한다 — 버튼 · DB automation 이 보낸 인박스 알림. 실행마다 따로이므로 묶지 않는다(group_key 가
--    실행 id 를 담는다).
-- ② 알림이 가리킬 활동 이벤트 `automation.notified` 를 더한다(payload 는 자동화 id · 실행 방식 · 풀어 낸 메시지 — 사람이 쓴 글의
--    복제가 아니라 자동화 설정의 글이다).
-- ③ 액션 종류 `send_notification` 을 더한다(0078 의 `ck_automation_action_type` — 처음부터의 상위집합에 없던 다섯째).
--
-- 기존 행: 목록을 넓히기만 한다 — 그대로 지난다.

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'mention', 'comment', 'comment_reply', 'page_update',
  'invite', 'reminder', 'person_property_assigned', 'suggestion',
  'access_requested', 'access_granted',
  'automation'));

ALTER TABLE activity_event DROP CONSTRAINT activity_event_type_check;
ALTER TABLE activity_event ADD CONSTRAINT activity_event_type_check CHECK (type IN (
  'block.updated', 'property.updated', 'comment.created', 'user.mentioned',
  'page.created', 'page.moved', 'page.trashed',
  'suggestion.created', 'suggestion.accepted',
  'access.requested', 'access.granted',
  'reminder.fired',
  'person.assigned',
  'automation.notified'));

ALTER TABLE automation_action DROP CONSTRAINT ck_automation_action_type;
ALTER TABLE automation_action ADD CONSTRAINT ck_automation_action_type
  CHECK (type IN ('edit_property', 'add_page_to', 'insert_blocks', 'send_webhook', 'define_variables', 'show_confirmation', 'send_notification'));
