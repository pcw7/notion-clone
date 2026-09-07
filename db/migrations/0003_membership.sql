-- 워크스페이스 멤버십 · 그룹
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 ⟨C-14 · U-3 · V-8⟩
--
-- teamspace / acl_entry / block_acl_meta 등 권한 저장 지점은 블록 트리(§3.4)에
-- 의존하므로 W6(권한) 마이그레이션에서 만든다. 여기서는 인증 흐름이 당장
-- 필요로 하는 "누가 어느 워크스페이스에 속하는가"까지만 만든다.

CREATE TABLE workspace_member (                              -- <C-14>
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  user_id      uuid NOT NULL REFERENCES "user"(id),
  role         text NOT NULL
               CHECK (role IN ('owner', 'membership_admin', 'member',
                               'restricted_member', 'guest')),
  is_temporary boolean NOT NULL DEFAULT false,               -- 좌석 미소비. 역할과 직교한 수명 축
  expires_at   timestamptz NULL,                             -- is_temporary 일 때 필수. 최대 today+1y
  status       text NOT NULL DEFAULT 'invited'
               CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  join_method  text NULL                                     -- <14 R-5>
               CHECK (join_method IN ('invite_email', 'invite_link', 'allowed_domain',
                                      'saml_jit', 'scim', 'guest_upgrade')),
  invited_by   uuid NULL REFERENCES "user"(id),
  invited_at   timestamptz,
  accepted_at  timestamptz NULL,
  removed_at   timestamptz NULL,                             -- 30일 복원 창의 기준점

  PRIMARY KEY (workspace_id, user_id),
  CHECK (NOT is_temporary OR expires_at IS NOT NULL),
  CHECK (NOT is_temporary OR role = 'member')                -- temp 는 member-level access
);

CREATE INDEX ix_workspace_member_active ON workspace_member (workspace_id, status)
  WHERE status = 'active';
CREATE INDEX ix_workspace_member_expiring ON workspace_member (workspace_id, expires_at)
  WHERE is_temporary;
-- 한 사용자가 속한 워크스페이스 목록 (로그인 후 워크스페이스 선택 화면)
CREATE INDEX ix_workspace_member_by_user ON workspace_member (user_id)
  WHERE status = 'active';

COMMENT ON TABLE workspace_member IS
  '불변식 M1: 멤버 제거는 물리 삭제가 아니라 status=''removed'' + removed_at 이다.
              30일 내 재가입 시 private/공유 페이지 · group · teamspace 멤버십이 복원되어야 한다.
   불변식 M2: restricted_member 는 좌석을 소비한다(1차 출처). guest/temporary 는 소비하지 않는다.
   불변식 M3: status=''invited''(미수락)는 좌석에 세지 않는다.';

-- 좌석의 유일한 원천. billing_subscription.seats 를 세지 말 것. <C-14부속 / 14 R-14>
CREATE VIEW workspace_seat_count AS
SELECT workspace_id, count(*) AS seats
  FROM workspace_member
 WHERE status = 'active' AND is_temporary = false AND role <> 'guest'
 GROUP BY workspace_id;

-- ── 그룹 ──────────────────────────────────────────────────────────────

CREATE TABLE "group" (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  name         text NOT NULL,
  icon         text NULL,
  external_id  text NULL,                                    -- SCIM IdP 그룹 id. 멱등성 키
  deleted_at   timestamptz NULL,

  UNIQUE (workspace_id, external_id)
);
-- 이름 유일성은 대소문자를 무시한다. 표현식 UNIQUE 는 테이블 제약으로 못 쓰므로 인덱스로.
CREATE UNIQUE INDEX ux_group_workspace_name ON "group" (workspace_id, lower(name));

CREATE TABLE group_member (
  group_id   uuid NOT NULL REFERENCES "group"(id),
  user_id    uuid NOT NULL REFERENCES "user"(id),
  added_at   timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz NULL,                               -- soft delete. 30일 복원용
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX ix_group_member_user ON group_member (user_id) WHERE removed_at IS NULL;

COMMENT ON TABLE "group" IS
  '불변식 G1: 중첩 그룹 금지. group 은 user 만 담는다.
   불변식 G2: role=''guest'' 인 멤버는 group_member 가 될 수 없다(앱 가드 + 야간 정합성 검사).
   불변식 G3: role=''restricted_member'' 는 group_member 가 될 수 있다. 그것이 유일한 대량 부여 수단이다.';
