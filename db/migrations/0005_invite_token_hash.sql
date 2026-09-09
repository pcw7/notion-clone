-- workspace_invite.token 을 해시 저장으로 바꾼다
--
-- 정본: 00-canonical-data-model.md §3.2 workspace_invite [정정 2026-09-09]
--
-- 초대 토큰은 세션 토큰과 같은 bearer 자격증명이다. 링크를 가진 사람이 곧
-- 워크스페이스 멤버가 된다. 그런데 이 표만 평문으로 저장하고 있었다 —
-- 같은 정본의 user_session.token_hash / scim_token.token_hash 와 어긋난다.
--
-- 아직 초대 데이터가 없으므로 컬럼을 갈아끼운다. 데이터가 있었다면
-- 평문을 해시로 옮길 수 없으므로(해시는 단방향) 기존 초대를 전부 폐기하고
-- 재발급해야 했을 것이다 — 지금 고치는 이유다.

ALTER TABLE workspace_invite DROP COLUMN token;
ALTER TABLE workspace_invite ADD COLUMN token_hash text UNIQUE;

COMMENT ON COLUMN workspace_invite.token_hash IS
  '초대 토큰의 sha256. 원문은 메일에만 존재한다. 조회는 해시로 한다.
   user_session.token_hash 와 같은 규약.';

-- 대기 중인 초대 조회를 위한 인덱스.
-- "이 워크스페이스에 아직 수락되지 않은 초대" 를 People 설정 화면이 읽는다.
CREATE INDEX ix_workspace_invite_pending
  ON workspace_invite (workspace_id, email)
  WHERE revoked_at IS NULL AND accepted_at IS NULL;
