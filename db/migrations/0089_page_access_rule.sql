-- 행 단위 접근 규칙 — 규칙의 부여는 그 행의 ACL 행처럼 읽는다 — 게시 · 공유 6f-2a조각 (F-06-10)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `page_access_rule`(C-7 — data source 단위) · §3.3 끝 [보강] 행 단위 접근 규칙 ①~⑤
--       06-permissions-sharing.md F-06-10 *"DB 전체는 Can create + Created by → Can edit 규칙 → 자기가 만든 것만 보고 편집"*
--
-- ① 표는 정본 DDL 그대로 — 원천은 사람 속성 · 만든 사람 둘(사람 속성은 그 타입(F-03-07)이 생길 때까지 명령이 거절한다 · ③).
--    레벨은 페이지 레벨 넷(대상은 행 — 페이지다).
-- ② 원천마다 하나 — 같은 data source 에 같은 원천의 규칙은 레벨만 바꾼다(UNIQUE · 속성 없는 원천은 '' 로 센다).
-- ③ 규칙이 바뀌면 권한이 바뀐다 — `acl_entry` 와 같은 신호(`collab_access` 'ws:…' · 0016)를 보낸다. 협업 서버가 그 워크스페이스의
--    연결을 다시 판정한다(규칙을 지우면 그 규칙으로만 열던 사람의 편집기가 닫힌다).
--
-- 기존 행: 새 표.

CREATE TABLE page_access_rule (
  id                 uuid PRIMARY KEY,
  data_source_id     uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  source_kind        text NOT NULL CONSTRAINT ck_page_access_rule_source CHECK (source_kind IN ('person_property', 'created_by')),
  source_property_id text NULL REFERENCES property(id),
  level              text NOT NULL CONSTRAINT ck_page_access_rule_level CHECK (level IN ('view', 'comment', 'edit', 'full_access')),
  CONSTRAINT ck_page_access_rule_property CHECK ((source_kind = 'person_property') = (source_property_id IS NOT NULL))
);

-- 원천마다 하나 · 판정이 data source 로 찾는다
CREATE UNIQUE INDEX ux_page_access_rule_source ON page_access_rule (data_source_id, source_kind, COALESCE(source_property_id, ''));

COMMENT ON TABLE page_access_rule IS
  '6f-2a · F-06-10: 행 단위 접근 규칙 — 그 data source 의 행마다 원천(만든 사람 · 사람 속성)의 사람에게 레벨을 준다. 판정은 그 행 노드의 ACL 행으로 합성한다(노드 로컬 · P4).';

-- 신호 — 노드는 data source 의 데이터베이스 블록이다(워크스페이스를 거기서 읽는다)
CREATE FUNCTION collab_notify_access_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ds uuid;
  ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    ds := OLD.data_source_id;
  ELSE
    ds := NEW.data_source_id;
  END IF;
  SELECT b.workspace_id INTO ws FROM data_source d JOIN block b ON b.id = d.owner_database_id WHERE d.id = ds;
  IF ws IS NOT NULL THEN
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_access_rule() IS
  '6f-2a · F-06-10: 행 단위 접근 규칙이 바뀌었다 — 협업 서버가 그 워크스페이스의 연결을 다시 판정한다(0016 의 collab_notify_node_access 와 같은 신호).';

CREATE TRIGGER tg_collab_access_page_access_rule
  AFTER INSERT OR UPDATE OR DELETE ON page_access_rule
  FOR EACH ROW EXECUTE FUNCTION collab_notify_access_rule();
