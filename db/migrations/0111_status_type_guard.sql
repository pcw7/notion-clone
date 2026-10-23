-- SG3 · SG4 를 속성의 타입 바꾸기에도 — 지연 제약 트리거 — §7 정리 10n-25 (F-03-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `status_group` 불변식 SG3 · SG4 [보강 10n-25]
--       HANDOFF §3.3-499 ① — 0023 의 트리거는 옵션 · 그룹 행의 넣기 · 바꾸기만 본다. 속성의 `type` 을 status 로 바꿔도 있던 옵션
--       (그룹 없음)은 다시 검사되지 않아, 상태 변환(10n-24)의 반사실에서 그룹 없는 status 옵션이 조용히 남았다.
--
-- 왜 지연(커밋 시점)인가: 타입 바꾸기는 순서가 정해져 있다 — 타입을 **먼저** 바꿔야 그룹을 만들 수 있고(SG4) 옵션에 그룹을 줄 수
-- 있다(SG3). 그래서 `UPDATE property SET type` 의 그 순간에는 늘 어긋나 있다. 같은 트랜잭션의 정리가 끝난 커밋 때 본다(0024 의
-- `tg_relation_edge_mirror` 와 같은 방식). 검사는 커밋 때의 상태를 다시 읽는다(`NEW` 는 그 UPDATE 의 순간이다).
--
-- 기존 행: 10n-24 전에는 상태와 오가는 변환이 없었으므로 어긋난 속성이 없다 — 새 트리거만 건다.

CREATE FUNCTION property_status_shape_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  now_type property_type;
BEGIN
  SELECT type INTO now_type FROM property WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL; -- 같은 트랜잭션에서 지워졌다(그룹 · 옵션은 CASCADE)
  END IF;
  IF now_type = 'status' THEN
    IF EXISTS (SELECT 1 FROM select_option WHERE property_id = NEW.id AND group_id IS NULL) THEN
      RAISE EXCEPTION 'status 로 바꾼 프로퍼티에 그룹 없는 옵션이 남았다 (property %) — SG3', NEW.id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_property_status_shape';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM select_option WHERE property_id = NEW.id AND group_id IS NOT NULL) THEN
      RAISE EXCEPTION 'status 가 아니게 된 프로퍼티의 옵션이 그룹을 가졌다 (property %) — SG3', NEW.id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_property_status_shape';
    END IF;
    IF EXISTS (SELECT 1 FROM status_group WHERE property_id = NEW.id) THEN
      RAISE EXCEPTION 'status 가 아니게 된 프로퍼티에 그룹이 남았다 (property %) — SG4', NEW.id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_property_status_shape';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_property_status_shape
  AFTER UPDATE OF type ON property
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION property_status_shape_check();
