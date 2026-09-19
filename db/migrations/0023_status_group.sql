-- status 프로퍼티의 그룹 — 보드 4c-1조각 (F-03-05 status: 옵션 + 그룹 2계층)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `select_option.group_id` (+ [보강] status_group)
--       03-database-core.md F-03-05 ("`select_option.group_id` + `status_group` 테이블 · **kind 컬럼 필수**")
--
-- ──────────────────────────────────────────────────────────────────────
-- status 는 "그룹이 강제되는 select" 다
-- ──────────────────────────────────────────────────────────────────────
--
-- 옵션 레지스트리(`select_option`)는 select 와 같고(0013 머리말), status 만 옵션마다 **그룹**이 붙는다.
-- 0013 은 `group_id uuid NULL` 자리만 두고 그것이 가리킬 표를 만들지 않았다 — 이 마이그레이션이 만든다.
--
-- 그룹은 프로퍼티마다 **정확히 세 개**이고(F-03-05: *"You can't change the three main categories"*),
-- 사용자가 더하거나 지우거나 이름을 바꿀 수 없다. 그래서 그룹의 **이름 · 색은 컬럼이 아니다** — `kind` 의
-- 함수이므로 애플리케이션 상수(`property-types.ts` `STATUS_GROUPS`)에서 읽는다. 컬럼으로 두면 두 곳이 어긋날
-- 수 있다(0013 이 `api_exposed` 를 두지 않은 것과 같은 이유).
--
-- `kind` 를 ENUM 으로 두는 이유는 F-03-05 의 권고 그대로다: *"진행률/자동화 규칙이 그룹 이름에 의존하지 않는다."*
-- "완료인가"는 `kind = 'complete'` 하나로 묻는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 불변식 — 표현할 수 있는 것은 전부 승격한다
-- ──────────────────────────────────────────────────────────────────────
--
--   SG1  그룹은 (프로퍼티, kind) 에 하나다                        → UNIQUE (property_id, kind)
--   SG2  옵션의 그룹은 **같은 프로퍼티의** 그룹이다                → 복합 FK (property_id, group_id)
--   SG3  status 옵션은 그룹이 있고, 그 밖의 옵션은 그룹이 없다     → 트리거(프로퍼티 타입은 다른 표에 있다)
--   SG4  그룹은 status 프로퍼티에만 생긴다                         → 트리거
--
-- SG2 가 없으면 옵션이 **남의 프로퍼티의 그룹**을 가리킬 수 있다. 단일 FK(`group_id → status_group.id`)는 그것을
-- 막지 못한다. `MATCH SIMPLE`(기본)이라 `group_id` 가 NULL 인 select 옵션은 검사를 건너뛴다.
--
-- SG3 · SG4 는 CHECK 으로 쓸 수 없다(`property.type` 을 봐야 한다). 0014 의 R2 처럼 트리거로 지킨다. 프로퍼티의
-- 타입은 바뀌지 않으므로(`updateProperty` 가 타입을 받지 않는다 · F-03-09 미구현) 옵션 쪽만 지키면 된다.
-- 타입 변환이 들어오면 그 명령이 옵션의 그룹을 함께 옮겨야 한다 — 이 트리거가 그것을 강제한다.

CREATE TYPE status_group_kind AS ENUM ('todo', 'in_progress', 'complete');

CREATE TABLE status_group (
  id          uuid PRIMARY KEY,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  kind        status_group_kind NOT NULL,
  CONSTRAINT ux_status_group_kind UNIQUE (property_id, kind),
  -- 복합 FK 의 대상. `id` 가 이미 유일하지만 FK 는 참조 컬럼 조합에 UNIQUE 가 있어야 한다.
  CONSTRAINT ux_status_group_owner UNIQUE (property_id, id)
);

COMMENT ON TABLE status_group IS
  'F-03-05. status 프로퍼티의 세 범주. 이름 · 색은 kind 의 함수라 컬럼이 없다(애플리케이션 상수).';

-- SG2
ALTER TABLE select_option
  ADD CONSTRAINT fk_select_option_group
  FOREIGN KEY (property_id, group_id) REFERENCES status_group (property_id, id);

CREATE INDEX ix_select_option_group ON select_option (group_id) WHERE group_id IS NOT NULL;

-- SG3
CREATE FUNCTION select_option_group_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type property_type;
BEGIN
  SELECT type INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type = 'status' AND NEW.group_id IS NULL THEN
    RAISE EXCEPTION 'status 옵션은 그룹이 있어야 한다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_select_option_group_guard';
  END IF;
  IF owner_type IS DISTINCT FROM 'status' AND NEW.group_id IS NOT NULL THEN
    RAISE EXCEPTION 'status 가 아닌 프로퍼티의 옵션은 그룹을 가질 수 없다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_select_option_group_guard';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_select_option_group_guard
  BEFORE INSERT OR UPDATE OF property_id, group_id ON select_option
  FOR EACH ROW EXECUTE FUNCTION select_option_group_guard();

-- SG4
CREATE FUNCTION status_group_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type property_type;
BEGIN
  SELECT type INTO owner_type FROM property WHERE id = NEW.property_id;
  IF owner_type IS DISTINCT FROM 'status' THEN
    RAISE EXCEPTION '그룹은 status 프로퍼티에만 만들 수 있다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_status_group_owner_guard';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_status_group_owner_guard
  BEFORE INSERT OR UPDATE OF property_id ON status_group
  FOR EACH ROW EXECUTE FUNCTION status_group_owner_guard();

-- ──────────────────────────────────────────────────────────────────────
-- 필터 연산자 — select 와 같은 넷 (F-03-17 전수표)
-- ──────────────────────────────────────────────────────────────────────
--
-- status 의 사이드카도 **옵션 id** 다(`text_value`). 부분 문자열 · 접두사 비교는 뜻이 없다.
-- 노션은 status 에 **그룹 단위** 필터("To-do 전체")도 주지만 그건 옵션 id 집합으로 펴야 하는 다른 연산자다 —
-- 아직 없다(HANDOFF §7).
INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  ('status', 'equals',         1, '같음',        1),
  ('status', 'does_not_equal', 1, '같지 않음',    2),
  ('status', 'is_empty',       0, '비어 있음',    3),
  ('status', 'is_not_empty',   0, '비어 있지 않음', 4);
