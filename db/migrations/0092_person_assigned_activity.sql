-- 담당 알림 — 활동 이벤트 `person.assigned` — 게시 · 공유 6h조각 (F-11-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 담당 알림 ② · `activity_event.type` 의 목록
--       11-*.md F-11-08 *"데이터베이스 Person property 에 내가 추가됨 → 추가된 사용자"*
--
-- ① 활동 이벤트에 `person.assigned` 를 더한다 — 사람 칸에 새로 든 사람이 있다(payload 는 `property_id` 하나 — 받는 사람은 알림 행이
--    안다 · N3). 알림 종류 `person_property_assigned` 는 초판(0020)에 있다.
--
-- 기존 행: 목록을 넓히기만 한다 — 그대로 지난다.

ALTER TABLE activity_event DROP CONSTRAINT activity_event_type_check;
ALTER TABLE activity_event ADD CONSTRAINT activity_event_type_check CHECK (type IN (
  'block.updated', 'property.updated', 'comment.created', 'user.mentioned',
  'page.created', 'page.moved', 'page.trashed',
  'suggestion.created', 'suggestion.accepted',
  'access.requested', 'access.granted',
  'reminder.fired',
  'person.assigned'));
