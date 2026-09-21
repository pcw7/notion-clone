-- 그룹이 권한의 주체가 된다 — Teamspace · 게스트 · 그룹 7a조각 (F-06-03)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `group` · `group_member` · 불변식 G1~G3
--       §3.11 `effective()` 의 P(U) · 캐시 키 규약 · "그룹 멤버 1건 변경 시 일어나는 일 전부"
--       06-permissions-sharing.md F-06-03
--
-- 표는 0003 이 만들었다. 지금까지 아무도 쓰지 않았고, 이 조각에서 `effective()` 가 처음 읽는다
-- (`src/lib/permissions/effective.ts` `principalsFor`). 읽기 시작하는 자리에서 세 가지를 더한다.
--
-- ──────────────────────────────────────────────────────────────────────
-- ① 이름은 **살아 있는** 그룹 사이에서만 겹치지 않는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0003 은 정본 그대로 `(workspace_id, lower(name))` 전체에 UNIQUE 를 걸었다. 그런데 그룹은 `deleted_at` 으로
-- 지운다(soft delete) — 그대로 두면 "디자인팀"을 지운 뒤 같은 이름으로 다시 만들 수 없다. 지운 그룹은 어디에도
-- 보이지 않으므로 사용자는 **보이지 않는 것과 이름이 겹친다**는 답을 받는다. 정본 §3.5 `property` 의 이름
-- UNIQUE 를 부분 UNIQUE 로 고친 것(HANDOFF §3.1-2e)과 같은 사정이고 같은 방식으로 고친다(§3.1-2n).
--
-- ──────────────────────────────────────────────────────────────────────
-- ② G2 — 게스트는 그룹에 들어갈 수 없다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본은 *"앱 가드 + 야간 정합성 검사"* 라고 적었다. 넣는 쪽은 트리거로 올린다(CLAUDE.md — 표현할 수 있는 불변식은
-- 승격한다): 그룹의 워크스페이스에 **게스트가 아닌 멤버 행**이 있는 사용자만 살아 있는 멤버가 될 수 있다.
-- 다른 워크스페이스 사람도 함께 막힌다.
--
-- ⚠ **반대쪽 — 이미 그룹에 있는 멤버가 게스트가 되는 것 — 은 막지 않는다.** 불변식 M1 이 떠난 멤버의 그룹 멤버십을
--   30일 동안 **남겨 두라**고 하므로, 떠났다가 게스트로 다시 초대받은 사람은 살아 있는 그룹 행을 가진 게스트가 된다.
--   그 수락을 거부할 수는 없다. 그래서 **읽는 쪽**이 막는다: `principalsOf` 는 게스트에게 그룹 주체를 주지 않는다.
--   (야간 정합성 검사보다 강하다 — 틀린 행이 있어도 판정이 틀리지 않는다.)
--
-- ──────────────────────────────────────────────────────────────────────
-- ③ 그룹 멤버가 바뀌면 — 정본의 "일어나는 일 전부"
-- ──────────────────────────────────────────────────────────────────────
--
--   ① group_member upsert / removed_at         → 앱의 명령(`src/lib/workspace/group.ts`)
--   ② INCR perm_gen:{user}                      → 이 트리거
--   ③ INCR acl_epoch:{ws}                       → 이 트리거
--   ④ permission_changed emit                   → 이 트리거의 `collab_access` 신호(0016 과 같은 채널 · 같은 페이로드)
--   ⑤ 검색 재색인 0건                             → 하지 않는다. 검색도 목록도 `perm_scope_id = ANY(readableScopes)` 로
--                                                 거르고 그 스코프는 판정 때마다 P(U) 로 다시 계산한다
--   ⑥ 사이드바는 다음 요청 시 자연 반영            → 같은 이유
--
-- **권한 캐시는 아직 없다** — 판정은 요청마다 DB 를 읽는다. 그래서 ②③ 의 세대 카운터를 읽는 쪽이 아직 없고, 초대
-- 수락(`workspace/invite.ts`)이 그랬듯 올려만 둔다. 캐시가 생기면 그 키가 이 값을 읽는다. 지금 **실제로 무효화가
-- 필요한 곳은 열린 협업 연결**이다 — 그룹에서 빠진 사람의 편집기가 계속 본문을 받으면 안 된다. 그것은 ④ 가 한다:
-- 협업 서버가 그 워크스페이스의 연결을 다시 판정한다(`collab/change-feed.ts`).
--
-- 트리거에 두는 이유는 0016 과 같다 — 쓰는 곳이 늘어도(SCIM · 그룹 지우기 · SQL 로 고친 것) 알리기를 빠뜨리지 않는다.
--
-- 그룹 **지우기**(`deleted_at`)도 멤버 전원의 주체 집합을 바꾼다. 그 그룹의 ACL 행은 앱이 같은 트랜잭션에서 지우고
-- (F-06-03 *"그 group principal 의 ACL 전부 캐스케이드 삭제"* — 그 삭제는 0016 의 `acl_entry` 트리거가 알린다),
-- 여기서는 세대와 신호를 맡는다. 이름 바꾸기 · 만들기는 누구의 권한도 바꾸지 않으므로 걸지 않는다.

-- ── ① 이름 ────────────────────────────────────────────────────────────

DROP INDEX ux_group_workspace_name;
CREATE UNIQUE INDEX ux_group_workspace_name ON "group" (workspace_id, lower(name))
  WHERE deleted_at IS NULL;

-- ── ② G2 ──────────────────────────────────────────────────────────────

CREATE FUNCTION group_member_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 빠진 멤버 행(removed_at 이 있는 것)은 누구의 것이든 남아도 된다 — M1 의 복원 창이다.
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM "group" g
      JOIN workspace_member m ON m.workspace_id = g.workspace_id AND m.user_id = NEW.user_id
     WHERE g.id = NEW.group_id
       AND m.role <> 'guest'
  ) THEN
    RAISE EXCEPTION 'G2: 사용자 % 는 그룹 % 의 워크스페이스 멤버가 아니거나 게스트다', NEW.user_id, NEW.group_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION group_member_guard() IS
  'G2: 게스트는 그룹에 들어갈 수 없다(다른 워크스페이스 사람도). 넣는 쪽만 막는다 — 멤버가 게스트가 되는 쪽은
   M1 의 복원 창 때문에 막을 수 없어 읽는 쪽(principalsOf)이 게스트의 그룹을 무시한다.';

CREATE TRIGGER tg_group_member_guard
  BEFORE INSERT OR UPDATE ON group_member
  FOR EACH ROW EXECUTE FUNCTION group_member_guard();

-- ── ③ 세대 · 신호 ──────────────────────────────────────────────────────

CREATE FUNCTION group_member_access_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT workspace_id INTO ws FROM "group" WHERE id = OLD.group_id;
    UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = OLD.user_id;
  ELSE
    SELECT workspace_id INTO ws FROM "group" WHERE id = NEW.group_id;
    UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = NEW.user_id;
    -- 멤버 행의 주인을 바꾸는 UPDATE(앱에는 없다)면 옛 사람의 집합도 바뀌었다.
    IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN
      UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = OLD.user_id;
    END IF;
  END IF;
  IF ws IS NOT NULL THEN
    UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = ws;
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION group_member_access_changed() IS
  'F-06-03 · §3.11: 그룹 멤버가 바뀌면 그 사람의 perm_gen · 워크스페이스의 acl_epoch 를 올리고, 협업 서버가 그
   워크스페이스의 연결을 다시 판정하게 알린다(0016 과 같은 채널).';

CREATE TRIGGER tg_collab_access_group_member
  AFTER INSERT OR DELETE ON group_member
  FOR EACH ROW EXECUTE FUNCTION group_member_access_changed();

-- 다시 넣기(upsert 로 removed_at 을 비운다) · 빼기(removed_at 을 채운다)가 이 길이다. 멤버십을 바꾸지 않는 갱신
-- (`added_at` 만 고친 것 — 앱에는 없다)은 누구의 권한도 바꾸지 않으므로 함수를 부르지 않는다. 이미 있는 멤버를 또
-- 넣는 것은 여기까지 오지 않는다 — 앱의 upsert 가 `WHERE removed_at IS NOT NULL` 로 갱신 자체를 하지 않는다.
CREATE TRIGGER tg_collab_access_group_member_update
  AFTER UPDATE ON group_member
  FOR EACH ROW
  WHEN (OLD.removed_at IS DISTINCT FROM NEW.removed_at
        OR OLD.user_id IS DISTINCT FROM NEW.user_id
        OR OLD.group_id IS DISTINCT FROM NEW.group_id)
  EXECUTE FUNCTION group_member_access_changed();

CREATE FUNCTION group_access_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "user" SET perm_gen = perm_gen + 1
   WHERE id IN (SELECT user_id FROM group_member WHERE group_id = NEW.id AND removed_at IS NULL);
  UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = NEW.workspace_id;
  PERFORM pg_notify('collab_access', 'ws:' || NEW.workspace_id::text);
  RETURN NULL;
END $$;

COMMENT ON FUNCTION group_access_changed() IS
  'F-06-03: 그룹을 지우거나(되살리거나) 하면 멤버 전원의 주체 집합이 바뀐다 — 세대를 올리고 협업 서버에 알린다.';

CREATE TRIGGER tg_collab_access_group
  AFTER UPDATE OF deleted_at ON "group"
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION group_access_changed();
