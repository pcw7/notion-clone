-- 행의 레이아웃 — 제목 아래 고정 속성(pinned) — 항목 레이아웃 3a-1조각 (F-16-02)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `layout_module` · 불변식 M3 · M5 · [보강] 행의 레이아웃 ③④ · [보강] 고정 속성(3a-1)
--       16-item-layout.md F-16-02 *"You can pin up to 15 properties"* · *"`pinned` 별도 컬럼을 두지 않는다(area='heading' 과 동치)"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 행 페이지의 제목 아래에 핵심 속성을 고정한다
-- ──────────────────────────────────────────────────────────────────────
--
-- 고정은 새 표가 아니다(M5) — content 탭의 property 행이 heading 영역에 서는 것이다. 부모는 heading 모듈이고, heading 안의 순서는
-- 자기 순서(`order_idx`)다 — 스키마 순서가 아니다(16 *"Heading 안에서 좌우 드래그로 순서를 바꾼다"*). 풀면 행을 지운다 — 속성 묶음으로
-- 돌아간 것은 기본이라 행이 없다(sparse · 8f-2 ④ 와 같다). 한 속성은 한 탭에 한 번이라(`layout_module_prop_once`) 숨김과 고정은 겹치지 않는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 정본 DDL 에 더한 것
-- ──────────────────────────────────────────────────────────────────────
--
-- ① M3 — heading 영역의 property 행은 소스마다 15개까지. 16 은 *"부분 인덱스로 개수 제약은 표현 불가 → 애플리케이션 검증"* 이라 했지만
--    트리거로는 표현된다 — 표로 올린다. 적용 함수가 소스 행을 잠그고(`lockSchema`) 먼저 세므로 트리거는 마지막 그물이다. 문장 끝에 센다
--    (CONSTRAINT TRIGGER) — 한 문장에 16개를 넣어도 걸린다.
-- ② 고정 행은 보이고 자기 순서가 있다(CHECK) — "숨긴 고정"은 뜻이 없고, 순서 없는 고정은 heading 안의 자리를 모른다.
-- ③ 속성을 지우면(soft delete) 고정이 풀린다(트리거) — 지운 속성이 15자리를 차지하지 않게. 되살리면 속성 묶음으로 돌아온다. 숨김은
--    지워도 남는다(8f-2 ④ — 되살리면 숨김도 돌아온다) — 다른 규칙인 까닭은 숨김에는 자리 상한이 없기 때문이다.
--
-- 기존 행: heading 영역의 property 행은 없다(만드는 길이 없었다) — 제약을 바로 건다.

-- ②
ALTER TABLE layout_module
  ADD CONSTRAINT ck_layout_module_pinned CHECK (kind <> 'property' OR area <> 'heading' OR (visible AND order_idx IS NOT NULL));

-- ① M3
CREATE FUNCTION layout_module_pin_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM layout_module
       WHERE data_source_id = NEW.data_source_id AND kind = 'property' AND area = 'heading') > 15 THEN
    RAISE EXCEPTION 'layout_module: 제목 아래 고정 속성은 소스마다 15개까지다 (%)', NEW.data_source_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tg_layout_module_pin_limit';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_layout_module_pin_limit
  AFTER INSERT OR UPDATE OF kind, area, data_source_id ON layout_module
  FOR EACH ROW WHEN (NEW.kind = 'property' AND NEW.area = 'heading')
  EXECUTE FUNCTION layout_module_pin_limit();

-- ③
CREATE FUNCTION property_unpin_on_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM layout_module WHERE property_id = NEW.id AND kind = 'property' AND area = 'heading';
  RETURN NULL;
END;
$$;

CREATE TRIGGER tg_property_unpin_on_delete
  AFTER UPDATE OF deleted_at ON property
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION property_unpin_on_delete();

COMMENT ON CONSTRAINT ck_layout_module_pinned ON layout_module IS
  '고정(heading 영역의 property 행)은 보이고 자기 순서가 있다 — 3a-1 · F-16-02. 개수(M3 ≤ 15)는 tg_layout_module_pin_limit.';
