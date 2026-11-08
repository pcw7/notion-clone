-- 워크스페이스 삭제 — 누가 지웠는가 · 감사 두 종류 · 지우면 협업 연결을 다시 판정 — 41번 트랙 AD-1 (F-14-13)
--
-- 정본: docs/research/00-canonical-data-model.md §3.1 [보강 AD-1] ② ③ ⑤ ⑥
--       14-auth-accounts.md F-14-13 *"Any deleted workspaces will be deleted for everyone in them"*
--
-- ② 지우기는 표시다 — `deleted_at`(0001 부터 있었다) · `deleted_by`(이 파일). 행 · 블록 · 파일은 그대로 남는다. `deleted_by` 는
--    `deleted_at` 과 함께일 때만 선다(지우지 않은 워크스페이스에 지운 사람이 있을 수 없다). 거꾸로는 허용한다 — 계정 삭제의 연쇄(W3)처럼
--    사람이 아닌 길로 지울 자리를 남긴다.
-- ③ 문은 0단계 게이트 하나다 — 그런데 이미 열린 협업 연결은 다음 판정까지 붙어 있다. `deleted_at` 이 바뀌면 `collab_access` 로
--    그 워크스페이스의 신호를 보낸다(0016 의 권한 신호와 같은 채널 · 같은 모양) — 협업 서버 · 표 변경 허브가 연결을 다시 판정해 닫는다.
-- ⑤ ⑥ 감사 — `workspace.deleted`(owner 가 지웠다) · `workspace.restored`(운영자 명령이 되살렸다). 종류 CHECK(0087)을 늘린다.
--
-- 기존 행: `deleted_by` 는 NULL — 지금까지 아무도 지우지 않았다(`deleted_at` 을 쓰는 명령이 없었다).

ALTER TABLE workspace
  ADD COLUMN deleted_by uuid NULL REFERENCES "user"(id);

ALTER TABLE workspace
  ADD CONSTRAINT ck_workspace_deleted_by
  CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL);

ALTER TABLE audit_event DROP CONSTRAINT ck_audit_event_type;
ALTER TABLE audit_event ADD CONSTRAINT ck_audit_event_type CHECK (event_type IN (
  'account.login', 'account.security_changed',
  'workspace.member_invited', 'workspace.member_joined', 'workspace.member_removed', 'workspace.member_role_changed',
  'workspace.setting_changed', 'workspace.exported', 'workspace.deleted', 'workspace.restored',
  'page.permission_changed', 'page.publish_changed', 'page.permanently_deleted'));

CREATE FUNCTION collab_notify_workspace_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('collab_access', 'ws:' || NEW.id::text);
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_workspace_deleted() IS
  'AD-1 ③: 워크스페이스를 지웠거나 되살렸다 — 협업 서버 · 표 변경 허브가 그 워크스페이스의 연결을 다시 판정한다(게이트가 닫는다).';

CREATE TRIGGER tg_collab_access_workspace_deleted
  AFTER UPDATE OF deleted_at ON workspace
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION collab_notify_workspace_deleted();
