-- 수식 속성 — 설정 · 의존 그래프 — DB 심화 2i-2조각 (F-03-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `property_dependency` · [보강] 수식 1단계
--       03-database-core.md F-03-12 *"`property.config = {expression, compiled_ast, result_type, depends_on, ref_depth}`"*
--
-- ① `property.type = 'formula'` 의 설정은 `{ expression, result_type }` 이다 — expression 은 **원문 그대로에 속성 자리만 `⟦id⟧`** 인 식
--    (`lib/formula/formula.ts` 머리말 · 이름을 바꿔도 깨지지 않는다), result_type 은 저장할 때 정한 결과 타입(수 · 글 · 참거짓 · 날짜).
--    나무(`compiled_ast`)는 저장하지 않는다 — 읽을 때 식에서 다시 만든다(싸다 · 언어가 바뀌어도 저장값을 고칠 일이 없다).
-- ② `property_dependency` 는 정본 그대로 — 수식이 읽는 속성마다 한 줄(dependent → source). 순환과 깊이(15)는 저장할 때 명령이 이
--    그래프에서 본다. 1단계의 수식은 **같은 표의 속성만** 읽는다 — relation 을 타지 않는 간선(`via_relation_id IS NULL`)은 두 속성이 같은
--    표에 있어야 한다(트리거 — 다른 표를 봐야 해서 CHECK 이 아니다). 자기 자신을 가리키는 간선은 CHECK 이 막는다.
--
-- ⚠ CHECK 은 NULL 이면 통과다 — 묶음 전체를 `IS TRUE` 로 접는다(0055 · 0057 · 0058 과 같다).

ALTER TABLE property
  ADD CONSTRAINT ck_property_formula_config
  CHECK (
    type <> 'formula'
    OR (
      jsonb_typeof(config -> 'expression') = 'string'
      AND (config ->> 'result_type') IN ('number', 'text', 'boolean', 'date')
    ) IS TRUE
  );

CREATE TABLE property_dependency (
  dependent_property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  source_property_id    text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  via_relation_id       text NULL REFERENCES property(id) ON DELETE CASCADE,
  PRIMARY KEY (dependent_property_id, source_property_id),
  CONSTRAINT ck_property_dependency_not_self CHECK (dependent_property_id <> source_property_id)
);

-- 어느 속성이 바뀌면 그것을 읽는 수식을 찾는다(무효화 · 지울 때 알리기 — F-03-13).
CREATE INDEX ix_property_dependency_source ON property_dependency (source_property_id);

CREATE FUNCTION property_dependency_same_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.via_relation_id IS NULL AND (
    SELECT d.data_source_id IS DISTINCT FROM s.data_source_id
      FROM property d, property s
     WHERE d.id = NEW.dependent_property_id AND s.id = NEW.source_property_id
  ) THEN
    RAISE EXCEPTION 'property_dependency: relation 을 타지 않는 의존은 같은 표의 속성끼리다 (% → %)',
      NEW.dependent_property_id, NEW.source_property_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tg_property_dependency_same_source';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_property_dependency_same_source
  BEFORE INSERT OR UPDATE ON property_dependency
  FOR EACH ROW EXECUTE FUNCTION property_dependency_same_source();
