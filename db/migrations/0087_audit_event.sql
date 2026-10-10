-- 감사 로그 — 보안 이벤트 11종 · 쌓기만 한다 · 365일 — 게시 · 공유 6d-1조각 (F-11-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ①~⑤
--       11-history-notifications.md F-11-12 클론 대안 *"보안 관련 10종만 · audit_event 한 테이블"*
--       17-ops-governance.md *"audit_event.scope ∈ {account, workspace, teamspace, organization} — 1일차 · 소급 불가"*
--
-- ① `audit_event` — 범위(scope · 1일차 축) · 종류 11 · 행위자는 FK 없이 id 와 그때의 이름 · 메일(사람이 지워져도 남는다) · 대상 ·
--    IP · 내용 없는 메타데이터 · 설정 변경의 키와 앞뒤 값. 짝 — 계정 범위면 워크스페이스가 없다 · 설정 변경이면 설정 키가 있다.
-- ② 고치기는 트리거가 막는다 · 지우기는 365일이 지난 행만(보관 기간 — 데이터 수명 잡이 지운다).
--
-- 기존 행: 새 표.

CREATE TABLE audit_event (
  id            uuid PRIMARY KEY,
  scope         text NOT NULL CONSTRAINT ck_audit_event_scope CHECK (scope IN ('account', 'workspace', 'teamspace', 'organization')),
  workspace_id  uuid NULL REFERENCES workspace(id),
  event_type    text NOT NULL CONSTRAINT ck_audit_event_type CHECK (event_type IN (
                  'account.login', 'account.security_changed',
                  'workspace.member_invited', 'workspace.member_joined', 'workspace.member_removed', 'workspace.member_role_changed',
                  'workspace.setting_changed', 'workspace.exported',
                  'page.permission_changed', 'page.publish_changed', 'page.permanently_deleted')),
  actor_user_id uuid NULL,
  actor_name    text NULL,
  actor_email   text NULL,
  target_type   text NULL CONSTRAINT ck_audit_event_target CHECK (target_type IN ('page', 'user', 'invite', 'setting', 'workspace')),
  target_id     text NULL,
  ip            inet NULL,
  metadata      jsonb NOT NULL DEFAULT '{}' CONSTRAINT ck_audit_event_metadata CHECK (jsonb_typeof(metadata) = 'object'),
  setting_key   text NULL,
  value_before  jsonb NULL,
  value_after   jsonb NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_audit_event_account_scope CHECK ((scope = 'account') = (workspace_id IS NULL)),
  CONSTRAINT ck_audit_event_setting CHECK ((event_type = 'workspace.setting_changed') = (setting_key IS NOT NULL))
);

-- 워크스페이스의 감사 로그 — 최근 것부터(6d-2 의 화면)
CREATE INDEX ix_audit_event_workspace ON audit_event (workspace_id, occurred_at DESC) WHERE workspace_id IS NOT NULL;
-- 한 사람의 계정 범위 기록
CREATE INDEX ix_audit_event_actor ON audit_event (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
-- 보관 기간이 지난 것 — 데이터 수명 잡
CREATE INDEX ix_audit_event_occurred ON audit_event (occurred_at);

CREATE FUNCTION audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.occurred_at < now() - interval '365 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_event 는 쌓기만 한다(append-only) — 지우는 것은 365일이 지난 행뿐' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER tg_audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
