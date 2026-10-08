-- 종속 관계(dependency) — DB 심화 2b-3조각 (F-03-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강] 종속 관계 ① ② ③
--       03-database-core.md F-03-18
--
-- 하위 항목(0051)과 같은 모양이다 — 같은 표의 양방향 relation 짝("선행 작업" · "후행 작업")의 `config.dependencies` 표시와
-- `relation_edge.role='dependency'`. 다른 것은 개수 제한이 없다는 것(막는 행이 여럿)과, 그래서 순환 검사가 그래프를 걷는다는 것이다.

-- ──────────────────────────────────────────────────────────────────────
-- ① 표시는 같은 표를 가리키는 relation 에만 · 값은 둘 중 하나 · 하위 항목과 함께 맡지 않는다
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE property
  ADD CONSTRAINT ck_property_dependencies
  CHECK (
    NOT (config ? 'dependencies')
    OR (type = 'relation'
        AND config->>'dependencies' IN ('blocked_by', 'blocking')
        AND config->>'target_data_source_id' = data_source_id::text
        AND NOT (config ? 'sub_items'))
  );

-- DP1 — 표마다 살아 있는 짝은 하나.
CREATE UNIQUE INDEX ux_property_dependencies ON property (data_source_id, (config->>'dependencies'))
  WHERE type = 'relation' AND deleted_at IS NULL AND config ? 'dependencies';

-- ──────────────────────────────────────────────────────────────────────
-- ② role — 선행 작업 프로퍼티의 엣지(막히는 행 → 막는 행)에 'dependency'
-- ──────────────────────────────────────────────────────────────────────
--
-- 0051 의 함수를 넓힌다 — role 을 매기는 규칙은 이 함수 하나다.
CREATE OR REPLACE FUNCTION relation_edge_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.role := (SELECT CASE
                        WHEN config->>'sub_items' = 'parent' THEN 'sub_item'
                        WHEN config->>'dependencies' = 'blocked_by' THEN 'dependency'
                      END
                 FROM property WHERE id = NEW.property_id);
  RETURN NEW;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- ③ DP2 — 순환이 없다(자기 자신 · 자기를 막는 사슬 위의 행이 자기에게 막힐 수 없다)
-- ──────────────────────────────────────────────────────────────────────
--
-- 막는 행이 여럿이라 위로 걷는 길이 여럿이다 — UNION 이 방문한 행을 한 번만 걷게 해 끝난다(그래프는 유한하다).
CREATE FUNCTION relation_edge_no_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relation_edge
                  WHERE property_id = NEW.property_id AND from_page_id = NEW.from_page_id
                    AND to_page_id = NEW.to_page_id AND role = 'dependency') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT NEW.to_page_id
      UNION
      SELECT e.to_page_id
        FROM relation_edge e JOIN up ON e.from_page_id = up.id
       WHERE e.property_id = NEW.property_id AND e.role = 'dependency'
    )
    SELECT 1 FROM up WHERE id = NEW.from_page_id
  ) THEN
    RAISE EXCEPTION '종속 관계에 순환이 생긴다 (% → %)', NEW.from_page_id, NEW.to_page_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_no_dependency_cycle';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tg_relation_edge_no_dependency_cycle
  AFTER INSERT OR UPDATE ON relation_edge
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.role = 'dependency')
  EXECUTE FUNCTION relation_edge_no_dependency_cycle();
