-- 하위 항목(sub-item) — DB 심화 2b-1조각 (F-03-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] 하위 항목 ① ② ③ ④
--       03-database-core.md F-03-18
--
-- 하위 항목은 relation 의 특수화다 — 같은 표를 가리키는 양방향 짝("상위 항목" · "하위 항목")의 `config.sub_items` 표시와,
-- 0013 이 자리만 둔 `relation_edge.role` 로 표현한다. 계층을 행에 복사하지 않는다(불변식 E2 — `parent_row_id` 없음).
-- 이 파일은 그 모양에 걸린 불변식을 DB 로 올린다. 짝을 만들고 연결하는 것은 애플리케이션(`database/sub-items.ts` · `relation.ts`)이다.

-- ──────────────────────────────────────────────────────────────────────
-- ① 표시는 같은 표를 가리키는 relation 에만 · 값은 둘 중 하나
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE property
  ADD CONSTRAINT ck_property_sub_items
  CHECK (
    NOT (config ? 'sub_items')
    OR (type = 'relation'
        AND config->>'sub_items' IN ('parent', 'children')
        AND config->>'target_data_source_id' = data_source_id::text)
  );

-- SI1 — 표마다 살아 있는 짝은 하나(상위 항목 하나 · 하위 항목 하나).
CREATE UNIQUE INDEX ux_property_sub_items ON property (data_source_id, (config->>'sub_items'))
  WHERE type = 'relation' AND deleted_at IS NULL AND config ? 'sub_items';

-- ──────────────────────────────────────────────────────────────────────
-- ② role 은 DB 가 매긴다 — 자식 → 부모 엣지(상위 항목 프로퍼티의 엣지)에만 'sub_item'
-- ──────────────────────────────────────────────────────────────────────
--
-- 거울상(부모 → 자식 · 하위 항목 프로퍼티의 엣지)은 표시용 투영이라 NULL 이다. 엣지를 넣거나 고칠 때마다 프로퍼티의 표시에서
-- 다시 정한다 — 애플리케이션이 쓴 값은 덮인다. 하위 항목을 끄면 표시를 떼고 그 엣지를 한 번 고쳐(UPDATE) 다시 매기게 한다.
CREATE FUNCTION relation_edge_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.role := (SELECT CASE WHEN config->>'sub_items' = 'parent' THEN 'sub_item' END
                 FROM property WHERE id = NEW.property_id);
  RETURN NEW;
END $$;

CREATE TRIGGER tg_relation_edge_role
  BEFORE INSERT OR UPDATE ON relation_edge
  FOR EACH ROW EXECUTE FUNCTION relation_edge_role();

-- ──────────────────────────────────────────────────────────────────────
-- ③ SI2 — 부모는 하나
-- ──────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX ux_relation_edge_one_parent ON relation_edge (property_id, from_page_id)
  WHERE role = 'sub_item';

-- ──────────────────────────────────────────────────────────────────────
-- ④ SI3 — 순환이 없다(자기 자신 · 자기 자손을 부모로 둘 수 없다)
-- ──────────────────────────────────────────────────────────────────────
--
-- 커밋 때 본다(지연) — 명령이 먼저 묻고 이유를 말하지만, 두 사람이 동시에 서로를 부모로 두는 경쟁은 각자의 검사를 지난다.
-- 부모가 하나라 위로 걷는 길은 한 줄이다. 깊이 상한은 이미 순환이 있는 데이터(있을 수 없다)에서 멈추기 위한 것이다.
CREATE FUNCTION relation_edge_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 같은 트랜잭션에서 지워졌으면 볼 것이 없다.
  IF NOT EXISTS (SELECT 1 FROM relation_edge
                  WHERE property_id = NEW.property_id AND from_page_id = NEW.from_page_id
                    AND to_page_id = NEW.to_page_id AND role = 'sub_item') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    WITH RECURSIVE up(id, depth) AS (
      SELECT NEW.to_page_id, 1
      UNION ALL
      SELECT e.to_page_id, up.depth + 1
        FROM relation_edge e JOIN up ON e.from_page_id = up.id
       WHERE e.property_id = NEW.property_id AND e.role = 'sub_item' AND up.depth < 100000
    )
    SELECT 1 FROM up WHERE id = NEW.from_page_id
  ) THEN
    RAISE EXCEPTION '하위 항목에 순환이 생긴다 (% → %)', NEW.from_page_id, NEW.to_page_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_no_cycle';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tg_relation_edge_no_cycle
  AFTER INSERT OR UPDATE ON relation_edge
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.role = 'sub_item')
  EXECUTE FUNCTION relation_edge_no_cycle();
