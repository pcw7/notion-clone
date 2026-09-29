-- 게스트의 대기 초대 — Teamspace · 게스트 · 그룹 7g-1조각 (F-06-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.2 `workspace_invite` · §3.3 [보강] 게스트를 들이는 길 ⑨
--       06-permissions-sharing.md F-06-09 *"페이지 Share 에서 외부 이메일 입력 → 게스트로 추가"* · *"게스트도 자체 Notion 계정이
--       필요하다"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 계정이 없는 이메일에게 — 가입한 뒤에 받는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 7d-1 은 계정이 없는 이메일을 거부했다(`no_account` — "먼저 가입하라"). 이제 **대기 초대**를 남긴다 — 워크스페이스 초대
-- (`workspace_invite`)의 한 종류로, 역할이 `guest` 이고 **어느 페이지를 어떤 레벨로** 받는지를 함께 싣는다. 받는 사람은 초대
-- 메일의 링크로 가입(로그인)하고 받아들인다 — 멤버 초대와 같은 수락 화면 · 같은 이메일 소유 검사(검증된 주소)를 지난다.
--
-- 올린 불변식:
--
--   · **게스트 초대 ⇔ 페이지 · 레벨이 있다** — 멤버 초대에는 없다. 레벨은 게스트가 받을 수 있는 셋(편집까지 · 7d-1 ④)
--   · 게스트 초대는 이메일 초대다(링크 초대는 없다)
--   · 역할은 넷 중 하나 — 전에는 CHECK 이 없었다(명령이 `INVITABLE_ROLES` 로만 썼다)
--   · **대기 중인 게스트 초대는 (페이지, 이메일)마다 하나** — 다시 초대하면 그 행의 레벨 · 토큰을 새로 쓴다. 만료된 것도 센다
--     (받아들이지도 취소하지도 않은 행) — 만료된 행을 새로 쓰므로 부분 UNIQUE 가 막는 일이 없다
--   · 페이지가 지워지면(물리) 초대도 간다 — `ON DELETE CASCADE`

ALTER TABLE workspace_invite
  ADD COLUMN page_id uuid NULL REFERENCES block(id) ON DELETE CASCADE,
  ADD COLUMN page_level text NULL CHECK (page_level IN ('view', 'comment', 'edit'));

ALTER TABLE workspace_invite
  ADD CONSTRAINT ck_workspace_invite_role CHECK (role IN ('owner', 'membership_admin', 'member', 'guest')),
  ADD CONSTRAINT ck_workspace_invite_guest_page CHECK ((role = 'guest') = (page_id IS NOT NULL AND page_level IS NOT NULL)),
  ADD CONSTRAINT ck_workspace_invite_guest_email CHECK (role <> 'guest' OR kind = 'email');

CREATE UNIQUE INDEX ux_workspace_invite_guest_pending
  ON workspace_invite (page_id, email)
  WHERE role = 'guest' AND revoked_at IS NULL AND accepted_at IS NULL;

COMMENT ON COLUMN workspace_invite.page_id IS
  '7g-1 게스트의 대기 초대 — 받아들이면 이 페이지를 page_level 로 받는다. 게스트 초대에만 있다(ck_workspace_invite_guest_page).';
