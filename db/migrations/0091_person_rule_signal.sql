-- 사람 규칙 — 칸이 바뀌면 권한 신호 · 규칙의 칸 찾기 색인 — 게시 · 공유 6g-3a조각 (F-06-10 · F-03-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 끝 [보강] 행 단위 접근 규칙 ③
--       06-permissions-sharing.md F-06-10 엣지 *"person 속성 값 변경 → 이전 담당자의 접근 즉시 소멸 → 권한 캐시 무효화 트리거"*
--
-- ① 사람 규칙의 원천인 속성의 칸이 바뀌면(넣기 · 고치기 · 지우기) 그 행의 권한이 바뀐다 — `acl_entry` 와 같은 신호(`collab_access`
--    'ws:…' · 0016)를 보낸다. 협업 서버가 그 워크스페이스의 연결을 다시 판정한다(뺀 사람의 편집기가 닫힌다).
--    규칙의 원천이 아닌 칸은 신호를 보내지 않는다 — 셀 쓰기는 잦다.
-- ② 판정 · 트리거가 "이 속성을 원천으로 하는 규칙" 을 찾는다 — 부분 색인.
-- ③ 원천 속성을 휴지통에 넣거나 되살리면 같은 신호(규칙이 판정에서 빠지거나 돌아온다).
--    정본: [보강] 행 단위 접근 규칙 ③ *"속성을 지우면(휴지통) 규칙은 남지만 판정에 들지 않고, 되살리면 돌아온다"*
--
-- 기존 행: 트리거 · 색인만 더한다.

CREATE INDEX ix_page_access_rule_property ON page_access_rule (source_property_id) WHERE source_property_id IS NOT NULL;

CREATE FUNCTION collab_notify_person_rule_cell() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prop text;
  ws uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    prop := OLD.property_id;
  ELSE
    prop := NEW.property_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM page_access_rule WHERE source_property_id = prop) THEN
    RETURN NULL;
  END IF;
  -- 고치기인데 값이 그대로면 권한도 그대로다
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NULL;
  END IF;
  SELECT b.workspace_id INTO ws FROM block b WHERE b.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.page_id ELSE NEW.page_id END;
  IF ws IS NOT NULL THEN
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_person_rule_cell() IS
  '6g-3a · F-06-10: 사람 규칙의 원천인 속성의 칸이 바뀌었다 — 그 행의 권한이 바뀐다. 협업 서버가 그 워크스페이스의 연결을 다시 판정한다.';

CREATE TRIGGER tg_collab_access_person_rule_cell
  AFTER INSERT OR UPDATE OR DELETE ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION collab_notify_person_rule_cell();

-- ③ 원천 속성을 휴지통에 넣거나 되살리면 그 규칙이 판정에서 빠지거나 돌아온다 — 같은 신호를 보낸다.
CREATE FUNCTION collab_notify_person_rule_property() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ws uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM page_access_rule WHERE source_property_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT b.workspace_id INTO ws FROM data_source d JOIN block b ON b.id = d.owner_database_id WHERE d.id = NEW.data_source_id;
  IF ws IS NOT NULL THEN
    PERFORM pg_notify('collab_access', 'ws:' || ws::text);
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION collab_notify_person_rule_property() IS
  '6g-3a · F-06-10: 사람 규칙의 원천 속성이 휴지통에 들어가거나 돌아왔다 — 그 규칙이 판정에서 빠지거나 돌아온다.';

CREATE TRIGGER tg_collab_access_person_rule_property
  AFTER UPDATE OF deleted_at ON property
  FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION collab_notify_person_rule_property();
