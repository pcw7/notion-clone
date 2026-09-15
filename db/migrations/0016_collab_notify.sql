-- 협업 서버에 커밋을 알린다 — CRDT 5c조각 (F-05-19 · F-05-02)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 "런타임 구독 레지스트리"
--         — 구독 시점 권한검사 + **권한 회수 시 서버 강제 unsubscribe**
--       판결 C-11(페이지 = 동기화 단위 = 권한 단위 = 채널 단위) · V-5(쓰기 경로 ② 서버 명령)
--       05-collaboration-sync.md F-05-19 "권한 변경 시 무효화 브로드캐스트" · 클론 대안 (c)
--
-- 표를 만들지 않는다. 구독은 연결 수명과 같아서 영속 표가 아니다(정본 §3.7 — `page_channel` · `subscription(device_id,
-- page_id)` 표는 없다). 여기서 만드는 것은 **쓰는 트랜잭션이 커밋될 때 협업 서버에 가는 신호**뿐이다. 신호는 무엇이 바뀌었는지만
-- 싣는다 — 본문은 협업 서버가 로그에서, 권한은 판정 함수로 다시 읽는다(`src/lib/collab/change-feed.ts` · `collab-server.ts`).
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 앱이 아니라 트리거가 알리는가
-- ──────────────────────────────────────────────────────────────────────
--
-- 권한 판정이 읽는 것을 바꾸는 쓰기가 여러 곳이다 — 부여 · 회수 · 상속 끊기/되받기(`acl.ts`) · 이동(경로 · 스코프) · 휴지통 ·
-- 멤버 역할/상태 · 세션 폐기 · SSO 강제. 한 곳이라도 알리기를 빠뜨리면 **회수된 연결이 계속 본문을 받는다** — 틀려도 조용한
-- 종류다. 트리거는 앞으로 생길 쓰기와 SQL 로 직접 고친 것까지 잡는다. `search_document`(0012)가 권한 축을 트리거로 따라가는
-- 것과 같은 이유다.
--
-- ──────────────────────────────────────────────────────────────────────
-- NOTIFY 의 성질 — PostgreSQL 16.15 에서 진단 스크립트로 쟀다
-- ──────────────────────────────────────────────────────────────────────
--
--   - **커밋할 때만 간다.** 롤백한 트랜잭션의 것도, 되돌린 savepoint 안의 것도 버려진다 — 투영이 거부해 savepoint 로 되돌린
--     휴지통 전이(5b)는 알리지 않는다
--   - 한 트랜잭션 안의 같은 (채널, 페이로드)는 한 번만 간다. 순서는 커밋 순서, 한 트랜잭션 안에서는 보낸 순서다(채널이 달라도)
--     — 휴지통은 권한 신호가 부모 본문 신호보다 먼저 간다
--   - 페이로드는 8000 바이트 **미만**이어야 한다(7999 통과 · 8000 거부). 여기서는 uuid 하나다
--   - 듣는 연결이 끊긴 사이의 신호는 사라지고, 다시 LISTEN 해도 오지 않는다 — 협업 서버가 다시 붙은 뒤 가진 것을 전부 다시
--     맞춘다(`change-feed.ts` 의 `onResync`)
--   - 행 트리거는 파티션 표(`doc_update`)에서도 돈다. `UPDATE OF … WHEN (OLD … IS DISTINCT FROM NEW …)` 은 같은 값을 SET 한
--     갱신에서 돌지 않는다
--
-- ──────────────────────────────────────────────────────────────────────
-- 채널
-- ──────────────────────────────────────────────────────────────────────
--
--   collab_doc      '{page_id}:{seq}'    그 페이지 로그에 seq 가 쌓였다
--   collab_access   'ws:{workspace_id}'  그 워크스페이스의 누군가의 페이지 권한이 바뀌었을 수 있다
--                   'user:{user_id}'     그 사용자의 세션이 폐기 · 만료 변경됐다
--
-- 권한 신호는 **워크스페이스 단위**다. 어느 페이지 · 누구의 권한이 바뀌었는지 좁히지 않는다 — 좁히려면 변경마다 영향받는
-- 서브트리를 계산해야 하고(F-05-19 "O(서브트리 × 구독자)"), 받는 쪽은 어차피 같은 판정 함수를 부른다. 정밀 무효화는 05 문서가
-- v2 로 미뤘다.
--
-- 무엇에 걸었고 무엇에 걸지 않았는가:
--   - `acl_entry` · `block_acl_meta` · `workspace_member` · `sso_config` — 넣기 · 고치기 · 지우기 전부. 드물다
--   - `block` — `type='page'` 의 `lifecycle` · `perm_scope_id` · `ancestor_path` 가 **실제로 바뀐** 갱신만. 프로젝터가 본문 행을
--     갱신마다 쓰므로 WHEN 을 트리거 정의에 둔다(Postgres 가 함수 호출 자체를 건너뛴다 — 0012 와 같다). 넣기는 걸지 않는다 —
--     새 페이지에 이미 붙은 연결은 없다
--   - `user_session` — `revoked_at` · `expires_at` 이 바뀐 갱신과 지우기. 넣기(로그인)와 `last_seen_at` 은 걸지 않는다
--   - ⚠ 세션이 **시간이 지나** 만료되는 것은 쓰기가 없어 알리지 않는다(HANDOFF §7)

-- ── 본문 로그 ────────────────────────────────────────────────────────

CREATE FUNCTION collab_notify_doc_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('collab_doc', NEW.page_id::text || ':' || NEW.seq::text);
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_doc_update() IS
  'CRDT 5c: doc_update 가 쌓이면 협업 서버가 그 페이지의 메모리 문서를 로그 꼬리로 맞춘다. 로그를 쓰는 곳(append ·
   Phase 0 옮기기)이 둘이라 트리거에 둔다.';

CREATE TRIGGER tg_collab_doc_update
  AFTER INSERT ON doc_update
  FOR EACH ROW EXECUTE FUNCTION collab_notify_doc_update();

-- ── 권한 — 워크스페이스 열을 가진 표 ────────────────────────────────

CREATE FUNCTION collab_notify_workspace_access() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('collab_access', 'ws:' || OLD.workspace_id::text);
  ELSE
    PERFORM pg_notify('collab_access', 'ws:' || NEW.workspace_id::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_workspace_access() IS
  'CRDT 5c · F-05-19: 페이지 권한 판정이 읽는 것이 바뀌었다 — 협업 서버가 그 워크스페이스의 연결을 다시 판정한다.';

CREATE TRIGGER tg_collab_access_block
  AFTER UPDATE OF lifecycle, perm_scope_id, ancestor_path ON block
  FOR EACH ROW
  WHEN (NEW.type = 'page' AND (OLD.lifecycle IS DISTINCT FROM NEW.lifecycle
                               OR OLD.perm_scope_id IS DISTINCT FROM NEW.perm_scope_id
                               OR OLD.ancestor_path IS DISTINCT FROM NEW.ancestor_path))
  EXECUTE FUNCTION collab_notify_workspace_access();

CREATE TRIGGER tg_collab_access_workspace_member
  AFTER INSERT OR UPDATE OR DELETE ON workspace_member
  FOR EACH ROW EXECUTE FUNCTION collab_notify_workspace_access();

CREATE TRIGGER tg_collab_access_sso_config
  AFTER INSERT OR UPDATE OR DELETE ON sso_config
  FOR EACH ROW EXECUTE FUNCTION collab_notify_workspace_access();

-- ── 권한 — 노드에 걸린 표 ────────────────────────────────────────────
--
-- `acl_entry` · `block_acl_meta` 는 워크스페이스 열이 없다. 노드 행에서 읽는다. 노드가 없으면(teamspace 노드 — 아직 없다 ·
-- 블록이 지워지며 CASCADE 로 함께 지워진 메타) 붙은 연결도 없다.

CREATE FUNCTION collab_notify_node_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  node uuid;
  ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    node := OLD.node_id;
  ELSE
    node := NEW.node_id;
  END IF;
  SELECT workspace_id INTO ws FROM block WHERE id = node;
  IF ws IS NOT NULL THEN
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_node_access() IS
  'CRDT 5c · F-05-19: ACL · 상속 끊기가 바뀌었다 — 협업 서버가 그 노드의 워크스페이스 연결을 다시 판정한다.';

CREATE TRIGGER tg_collab_access_acl_entry
  AFTER INSERT OR UPDATE OR DELETE ON acl_entry
  FOR EACH ROW EXECUTE FUNCTION collab_notify_node_access();

CREATE TRIGGER tg_collab_access_block_acl_meta
  AFTER INSERT OR UPDATE OR DELETE ON block_acl_meta
  FOR EACH ROW EXECUTE FUNCTION collab_notify_node_access();

-- ── 세션 ──────────────────────────────────────────────────────────────
--
-- 지우기 트리거를 따로 둔다 — WHEN 이 NEW 를 읽는데 DELETE 트리거는 NEW 를 참조할 수 없다.

CREATE FUNCTION collab_notify_session_access() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('collab_access', 'user:' || OLD.user_id::text);
  ELSE
    PERFORM pg_notify('collab_access', 'user:' || NEW.user_id::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_session_access() IS
  'CRDT 5c · F-05-19: 세션이 폐기 · 만료 변경됐다 — 협업 서버가 그 사용자의 연결을 다시 판정한다.';

CREATE TRIGGER tg_collab_access_user_session
  AFTER UPDATE OF revoked_at, expires_at ON user_session
  FOR EACH ROW
  WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at)
  EXECUTE FUNCTION collab_notify_session_access();

CREATE TRIGGER tg_collab_access_user_session_delete
  AFTER DELETE ON user_session
  FOR EACH ROW EXECUTE FUNCTION collab_notify_session_access();
