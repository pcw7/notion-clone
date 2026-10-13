-- 워크스페이스 게시 차단 — 운영자의 잠금 — 게시 · 공유 6b-3a조각 (F-17-09 · F-17-13)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 끝 [보강] 모더레이션 조치 ⑥
--
-- 반복 위반한 워크스페이스의 웹 게시를 운영자가 막는다. 소유자의 설정(`security_policy.allow_publish_sites_and_forms`)과 따로 둔다 —
-- 설정으로 되돌릴 수 없다. 효과 정책은 `설정 AND 잠금 없음` 이다(판정은 앱이 한 곳에서 낸다).
--
--   · workspace.publishing_blocked_at — 운영자가 막은 시각 · 비면 없다. 쓰는 것은 운영자 명령뿐이다(서버 셸)
--   · moderation_action — 대상에 워크스페이스 · 조치에 block_publishing · unblock_publishing. 대상과 조치가 맞아야 하고(페이지 조치는
--     페이지에만 · 게시 차단은 워크스페이스에만), 막는 데는 까닭이 있다(take_down 과 같다)
--
-- 기존 행: 잠금 없음 · 조치는 모두 페이지의 것 — 바뀌는 것이 없다(새 CHECK 을 그대로 지난다).

ALTER TABLE workspace ADD COLUMN publishing_blocked_at timestamptz NULL;

ALTER TABLE moderation_action
  DROP CONSTRAINT ck_moderation_action_target,
  DROP CONSTRAINT ck_moderation_action_action,
  DROP CONSTRAINT ck_moderation_action_reason_needed;

ALTER TABLE moderation_action
  ADD CONSTRAINT ck_moderation_action_target CHECK (target_type IN ('page', 'workspace')),
  ADD CONSTRAINT ck_moderation_action_action
    CHECK (action IN ('take_down', 'dismiss', 'reinstate', 'block_publishing', 'unblock_publishing')),
  ADD CONSTRAINT ck_moderation_action_target_action
    CHECK ((target_type = 'workspace') = (action IN ('block_publishing', 'unblock_publishing'))),
  ADD CONSTRAINT ck_moderation_action_reason_needed
    CHECK ((action IN ('take_down', 'block_publishing')) = (reason_code IS NOT NULL));
