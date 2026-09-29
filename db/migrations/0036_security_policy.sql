-- 워크스페이스 밖의 사람의 접근 요청 — Teamspace · 게스트 · 그룹 7g-2조각 (F-06-15)
--
-- 정본: docs/research/00-canonical-data-model.md §3.2 `security_policy` · `workspace_member.join_method` ·
--       §3.3 [보강] 접근 요청의 길 ⑩
--       06-permissions-sharing.md F-06-15 *"권한 없는 사용자가 페이지 URL 을 연다 → No access 화면 → 요청 전송"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 정책 표 — 행이 없으면 기본값
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 DDL 그대로다. **행이 없으면 모든 칸이 기본값**이다 — 워크스페이스를 만들 때 행을 쓰지 않고, owner 가 처음 바꿀 때
-- 생긴다(읽는 쪽이 없는 행을 기본값으로 읽는다 · `workspace/security-policy.ts`). 지금 읽는 칸은
-- `allow_nonmember_page_access_request` 하나다 — 나머지는 그 기능이 생길 때 건다.
--
-- 워크스페이스는 지우지 않으므로(보관만) 외래 키에 CASCADE 가 없다 — 정본 그대로.
--
-- ──────────────────────────────────────────────────────────────────────
-- 들어온 길 — 접근 요청
-- ──────────────────────────────────────────────────────────────────────
--
-- 밖의 사람의 접근 요청을 허락하면 그 사람이 게스트로 들어온다. 초대 메일(`invite_email`)로 들어온 것이 아니므로 들어온 길에
-- `access_request` 를 더한다. 이름 없는 CHECK(0003)의 이름은 PostgreSQL 이 붙인 것이다.

CREATE TABLE security_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id),
  allow_publish_sites_and_forms boolean NOT NULL DEFAULT true,
  allow_duplicate_to_other_workspace boolean NOT NULL DEFAULT true,
  allow_export boolean NOT NULL DEFAULT true,
  allow_member_invite_guests boolean NOT NULL DEFAULT true,
  allow_member_request_add_guests boolean NOT NULL DEFAULT true,
  allow_member_request_add_members boolean NOT NULL DEFAULT true,
  allow_nonmember_page_access_request boolean NOT NULL DEFAULT true,
  allow_guest_request_membership boolean NOT NULL DEFAULT true,
  require_mfa_for_guests boolean NOT NULL DEFAULT false,
  who_can_add_restricted_members text NOT NULL DEFAULT 'owners'
);

COMMENT ON TABLE security_policy IS
  '워크스페이스 정책(정본 §3.2). 행이 없으면 모든 칸이 기본값 · 바꾸는 사람은 owner. 7g-2 가 읽는 칸은 allow_nonmember_page_access_request 하나.';

ALTER TABLE workspace_member
  DROP CONSTRAINT workspace_member_join_method_check,
  ADD CONSTRAINT workspace_member_join_method_check
    CHECK (join_method IN ('invite_email', 'invite_link', 'allowed_domain', 'saml_jit', 'scim', 'guest_upgrade',
                           'access_request'));
