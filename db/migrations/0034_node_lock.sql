-- 잠금 — Teamspace · 게스트 · 그룹 7f-1조각 (F-06-16)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `node_lock` · [보강] 잠금이 막는 것 ①~⑧ · 판결 X-9(`database.is_locked`
--       폐기 · `node_lock` 단일) · §3.11 "2단계: 잠금 게이트" · §6.1-8(상속 안 됨)
--       06-permissions-sharing.md F-06-16 *"ACL 과 무관하게 노드의 편집을 동결하는 플래그로, 권한이 아니라 실수 방지 장치"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 잠금은 행의 존재다 — 표는 정본 DDL 그대로
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본: *"잠금은 행의 존재로 표현한다. locked BOOL 컬럼을 두지 않는다(해제 = DELETE)."* 올린 불변식:
--
--   · **블록이 지워지면 잠금도 간다** — `node_id` 는 블록을 가리키고 `ON DELETE CASCADE`
--   · **kind 는 그 블록의 type 이다** — 페이지에 'database' 잠금을 걸면 막는 것이 달라진다(페이지 잠금은 본문 · 제목, 데이터베이스
--     잠금은 구조 — 7f-2). 두 표에 걸친 규칙이라 CHECK 로는 못 쓰고 트리거로 막는다(`tg_node_lock_kind`)
--   · `locked_at` 은 늘 있다 — 행이 곧 잠금이므로 "언제부터"가 없는 잠금은 없다
--
-- ──────────────────────────────────────────────────────────────────────
-- 잠금의 전이는 협업 신호다
-- ──────────────────────────────────────────────────────────────────────
--
-- 잠기는 순간 그 페이지를 열어 둔 편집 연결은 읽기 전용이 되어야 한다(06 엣지 *"A 가 편집 중 B 가 잠금 → A 의 세션에 잠금 이벤트
-- 브로드캐스트 → 즉시 read-only 전환"*). 협업 서버는 `collab_access` 신호가 오면 그 범위의 연결을 다시 판정한다(0016) — 잠금
-- 행의 삽입 · 삭제도 그 신호를 낸다. 함수는 부여(`acl_entry`)와 같은 것을 쓴다(`node_id` 로 워크스페이스를 찾는다 · 0028).

CREATE TABLE node_lock (
  node_id   uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('page', 'database')),
  scope     text NOT NULL DEFAULT 'content_and_layout' CHECK (scope IN ('content', 'content_and_layout')),
  locked_by uuid NULL REFERENCES "user"(id),
  locked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE node_lock IS
  'F-06-16 잠금 — 행이 있으면 잠겼다(해제 = DELETE · X-9). 권한이 아니라 쓰기 명령의 별도 게이트다(permissions/lock.ts).
   상속되지 않는다(정본 §6.1-8). kind 는 그 블록의 type 과 같다(tg_node_lock_kind).';

CREATE FUNCTION node_lock_kind_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM block WHERE id = NEW.node_id AND type = NEW.kind) THEN
    RAISE EXCEPTION '잠금의 종류(%)가 블록의 type 과 다르다: %', NEW.kind, NEW.node_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_node_lock_kind
  BEFORE INSERT OR UPDATE OF node_id, kind ON node_lock
  FOR EACH ROW EXECUTE FUNCTION node_lock_kind_guard();

CREATE TRIGGER tg_collab_access_node_lock
  AFTER INSERT OR DELETE OR UPDATE ON node_lock
  FOR EACH ROW EXECUTE FUNCTION collab_notify_node_access();
