-- teamspace — 워크스페이스 안의 공간 · 트리의 뿌리 · 권한의 원천 — Teamspace · 게스트 · 그룹 7c-1조각 (F-06-04 · F-02-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `teamspace` · `teamspace_member` · `acl_entry.node_kind`
--       §3.4 `block.parent_type`('teamspace' → teamspace(id)) · 불변식 B1 · B8
--       §3.11 `effective()` 의 P(U) · `perm_scope_id` 의 *"없으면 teamspace 루트(또는 Private 루트) id"*
--       판결문 _canon/block-tree.md C-9/V-9 — **teamspace 는 트리 노드다**
--       06-permissions-sharing.md F-06-04 · 02-page-workspace.md F-02-12
--
-- ──────────────────────────────────────────────────────────────────────
-- teamspace 는 트리의 뿌리다 — 소속은 루트 블록의 부모로 읽는다
-- ──────────────────────────────────────────────────────────────────────
--
-- teamspace 의 최상위 페이지는 `parent_type='teamspace', parent_id=<teamspace>` 다. 그 아래 페이지들은 컬럼을 따로 갖지
-- 않는다(B8 — `space_id` 는 없다). 판결문의 `ancestor_path` 는 *"루트(비block parent 직하)→parent 까지의 **block id**
-- 배열"* 이므로 teamspace id 는 그 배열에 들어가지 않는다 — 어느 페이지의 teamspace 는 **`ancestor_path[1]`(없으면 자기)
-- 인 루트 블록의 부모**다. 그래서 페이지를 teamspace 사이로 옮기는 것이 곧 권한을 옮기는 것이 된다(C-9 의 근거 2).
--
-- 기존 최상위 페이지(`parent_type='workspace'`)는 그대로 둔다 — 판결문이 `workspace` 부모를 *"Private 루트 페이지 및
-- 워크스페이스 직속 페이지"* 로 남겼다. 옮기는 데이터 마이그레이션은 없다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 권한은 teamspace 노드의 acl_entry 다 (C-7 — 권한의 유일한 저장 지점)
-- ──────────────────────────────────────────────────────────────────────
--
-- teamspace 를 만들면 그 노드(`node_kind='teamspace'`)에 두 가지 행이 생긴다(`src/lib/workspace/teamspace.ts`):
--   · ('teamspace', T) → 멤버 기본 레벨 — "이 teamspace 의 멤버는 그 페이지들을 이 레벨로 받는다"
--   · owner 마다 ('user' | 'group', id) → full_access — F-06-04 *"owner 는 모든 페이지에 기본 full access"*
-- 판정(`effective.ts`)은 페이지의 조상 사슬 끝에 teamspace 노드를 붙여 그 행을 함께 읽는다. 루트 페이지를 끊으면
-- (`inherits_from_parent=false`) 거기서 멈춘다 — 상속 차단이 teamspace 에도 그대로 선다.
--
-- `default_member_level` 컬럼은 정본대로 두되 **쓰지 않는다** — 멤버의 기본 레벨은 위 첫 행의 level 이다. 같은 사실을
-- 두 곳에 두면 어긋난다([확인필요] 6-5 는 그 행의 값으로 푼다).
--
-- ──────────────────────────────────────────────────────────────────────
-- 이 마이그레이션이 DB 로 올리는 것
-- ──────────────────────────────────────────────────────────────────────
--
--   ① 멤버 가드 — 사람은 이 워크스페이스의 **게스트가 아닌** 멤버만(F-06-04 *"게스트는 teamspace 멤버가 될 수 없다"*),
--      그룹은 이 워크스페이스의 살아 있는 그룹만. G2 와 같은 모양이다(0027) — 넣는 쪽만 막고, 게스트가 된 사람의 남은 행은
--      판정(`principalsOf`)이 무시한다
--   ② 블록 부모 가드 — `parent_type='teamspace'` 인 블록은 **같은 워크스페이스의 teamspace** 를 가리키는 페이지 · 데이터베이스다.
--      다형 참조라 FK 를 걸 수 없어 트리거로 건다(0026 과 같은 사정)
--   ③ 세대 · 신호 — 멤버십이 바뀌면 그 사람(그룹이면 그 그룹의 멤버 전원)의 perm_gen · 워크스페이스의 acl_epoch 를 올리고
--      협업 서버에 알린다(0027 과 같은 이유 · §3.2-39). archive 전이도 같다 — 판정이 보관된 teamspace 를 보지 않는다
--   ④ 0016 의 노드 신호 함수가 **teamspace 노드의 acl_entry** 도 알린다 — 전에는 블록에서만 워크스페이스를 찾아, teamspace
--      노드의 행이 바뀌어도 신호가 가지 않았을 것이다

CREATE TABLE teamspace (
  id                   uuid PRIMARY KEY,
  workspace_id         uuid NOT NULL REFERENCES workspace(id),
  name                 text NOT NULL,
  icon                 text NULL,
  visibility           text NOT NULL CHECK (visibility IN ('open', 'closed', 'private')),
  is_default           boolean NOT NULL DEFAULT false,               -- visibility 와 직교
  who_can_invite       text NOT NULL DEFAULT 'all_members'
                       CHECK (who_can_invite IN ('owners', 'all_members')),
  default_member_level text NULL,                                    -- [확인필요] 6-5 · 쓰지 않는다(머리말)
  archived_at          timestamptz NULL
);
CREATE INDEX ix_teamspace_workspace ON teamspace (workspace_id) WHERE archived_at IS NULL;

CREATE TABLE teamspace_member (
  teamspace_id   uuid NOT NULL REFERENCES teamspace(id),
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id   uuid NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner', 'member')),
  removed_at     timestamptz NULL,                                   -- soft delete. M1 의 복원 창
  PRIMARY KEY (teamspace_id, principal_type, principal_id)
);
-- P(U) 를 읽는 쪽 — "이 사람(또는 이 그룹)이 속한 teamspace".
CREATE INDEX ix_teamspace_member_principal ON teamspace_member (principal_type, principal_id)
  WHERE removed_at IS NULL;

COMMENT ON TABLE teamspace IS
  'C-9: 트리 노드. 최상위 페이지의 parent 다(parent_type=teamspace). 권한은 이 노드의 acl_entry(node_kind=teamspace)이고
   default_member_level 은 쓰지 않는다(0028 머리말).';

-- ── ① 멤버 가드 ────────────────────────────────────────────────────────

CREATE FUNCTION teamspace_member_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.principal_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM teamspace t
        JOIN workspace_member m ON m.workspace_id = t.workspace_id AND m.user_id = NEW.principal_id
       WHERE t.id = NEW.teamspace_id AND m.role <> 'guest'
    ) THEN
      RAISE EXCEPTION 'teamspace_member: 사용자 % 는 teamspace % 의 워크스페이스 멤버가 아니거나 게스트다',
        NEW.principal_id, NEW.teamspace_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
        FROM teamspace t
        JOIN "group" g ON g.workspace_id = t.workspace_id
       WHERE t.id = NEW.teamspace_id AND g.id = NEW.principal_id AND g.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'teamspace_member: 그룹 % 는 teamspace % 의 워크스페이스의 살아 있는 그룹이 아니다',
        NEW.principal_id, NEW.teamspace_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_teamspace_member_guard
  BEFORE INSERT OR UPDATE ON teamspace_member
  FOR EACH ROW EXECUTE FUNCTION teamspace_member_guard();

-- ── ② 블록 부모 가드 ───────────────────────────────────────────────────

CREATE FUNCTION block_teamspace_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type NOT IN ('page', 'database') THEN
    RAISE EXCEPTION 'block %: teamspace 의 바로 아래에는 페이지 · 데이터베이스만 선다 (type=%)', NEW.id, NEW.type
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teamspace WHERE id = NEW.parent_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'block %: parent_id % 는 이 워크스페이스의 teamspace 가 아니다', NEW.id, NEW.parent_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 프로젝터가 본문 행의 부모를 매번 쓰므로 WHEN 을 트리거 정의에 둔다 — teamspace 부모가 아니면 함수를 부르지 않는다.
CREATE TRIGGER tg_block_teamspace_parent
  BEFORE INSERT OR UPDATE OF parent_type, parent_id, type ON block
  FOR EACH ROW
  WHEN (NEW.parent_type = 'teamspace')
  EXECUTE FUNCTION block_teamspace_parent_guard();

-- ── ③ 세대 · 신호 ──────────────────────────────────────────────────────

CREATE FUNCTION teamspace_member_access_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ws uuid;
  tid uuid;
  ptype text;
  pid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    tid := OLD.teamspace_id; ptype := OLD.principal_type; pid := OLD.principal_id;
  ELSE
    tid := NEW.teamspace_id; ptype := NEW.principal_type; pid := NEW.principal_id;
  END IF;
  SELECT workspace_id INTO ws FROM teamspace WHERE id = tid;
  IF ptype = 'user' THEN
    UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = pid;
  ELSE
    -- 그룹이 멤버가 되거나 빠지면 그 그룹의 사람 전원의 P(U) 가 바뀐다.
    UPDATE "user" SET perm_gen = perm_gen + 1
     WHERE id IN (SELECT user_id FROM group_member WHERE group_id = pid AND removed_at IS NULL);
  END IF;
  IF ws IS NOT NULL THEN
    UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = ws;
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION teamspace_member_access_changed() IS
  'F-06-04 · §3.11: teamspace 멤버십이 바뀌면 그 사람(그룹이면 멤버 전원)의 perm_gen · acl_epoch 를 올리고 협업 서버에 알린다.';

CREATE TRIGGER tg_collab_access_teamspace_member
  AFTER INSERT OR DELETE ON teamspace_member
  FOR EACH ROW EXECUTE FUNCTION teamspace_member_access_changed();

-- 역할(owner ↔ member)은 P(U) 를 바꾸지 않는다 — 바뀌는 것은 teamspace 노드의 owner 행이고 그 행의 쓰기는 0016 의
-- acl_entry 트리거가 알린다. 그래서 여기서는 멤버십(removed_at · 주체)이 바뀐 갱신만 본다.
CREATE TRIGGER tg_collab_access_teamspace_member_update
  AFTER UPDATE ON teamspace_member
  FOR EACH ROW
  WHEN (OLD.removed_at IS DISTINCT FROM NEW.removed_at
        OR OLD.principal_type IS DISTINCT FROM NEW.principal_type
        OR OLD.principal_id IS DISTINCT FROM NEW.principal_id
        OR OLD.teamspace_id IS DISTINCT FROM NEW.teamspace_id)
  EXECUTE FUNCTION teamspace_member_access_changed();

CREATE FUNCTION teamspace_access_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = NEW.workspace_id;
  PERFORM pg_notify('collab_access', 'ws:' || NEW.workspace_id::text);
  RETURN NULL;
END $$;

CREATE TRIGGER tg_collab_access_teamspace
  AFTER UPDATE OF archived_at ON teamspace
  FOR EACH ROW
  WHEN (OLD.archived_at IS DISTINCT FROM NEW.archived_at)
  EXECUTE FUNCTION teamspace_access_changed();

-- ── ④ 0016 의 노드 신호 함수가 teamspace 노드도 알린다 ──────────────────
--
-- `acl_entry` 와 `block_acl_meta` 가 이 함수를 함께 쓴다. `node_kind` 는 `acl_entry` 에만 있으므로 표 이름으로 가른다 —
-- plpgsql 은 문장을 처음 실행할 때 준비하므로 `block_acl_meta` 에서는 그 가지를 읽지 않는다.
CREATE OR REPLACE FUNCTION collab_notify_node_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  node uuid;
  kind text := 'block';
  ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    node := OLD.node_id;
    IF TG_TABLE_NAME = 'acl_entry' THEN
      kind := OLD.node_kind;
    END IF;
  ELSE
    node := NEW.node_id;
    IF TG_TABLE_NAME = 'acl_entry' THEN
      kind := NEW.node_kind;
    END IF;
  END IF;
  IF kind = 'teamspace' THEN
    SELECT workspace_id INTO ws FROM teamspace WHERE id = node;
  ELSE
    SELECT workspace_id INTO ws FROM block WHERE id = node;
  END IF;
  IF ws IS NOT NULL THEN
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;
