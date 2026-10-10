-- 행의 레이아웃 — 본문 모듈 · 상세 패널 — 항목 레이아웃 3c-1조각 (F-16-04 · F-16-05)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `layout_module` · 불변식 M4 · [보강] 본문 모듈 · 상세 패널
--       16-item-layout.md F-16-04 *"승격 = 모듈 행 생성, 강등 = 모듈 행 삭제(잔여 계산으로 자동 복귀)"* · F-16-05 *"패널은 area enum 의 한 값"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 속성을 속성 묶음 밖으로 올리고, 상세 패널에 놓는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 새 표는 없다. content 탭의 property 행이 자리를 셋째 · 넷째로 늘린다:
--
--   · 숨김       그룹이 부모 · 보이지 않음 · 순서 없음(8f-2)
--   · 고정       heading 이 부모 · 보임 · 자기 순서(3a-1 · 0064)
--   · 본문 모듈  부모 없음 · area `main` · 보임 · 자기 순서 — 속성 묶음(그룹 모듈)과 같은 줄에서 순서를 다툰다
--   · 패널       부모 없음 · area `panel` · 보임 · 자기 순서
--
-- 내리면(강등) 행을 지운다 — 속성 묶음으로 돌아간 것은 기본이라 행이 없다(sparse · M6).
--
-- ──────────────────────────────────────────────────────────────────────
-- 정본 DDL 에 더한 것
-- ──────────────────────────────────────────────────────────────────────
--
-- ① property 행의 자리는 넷 중 하나다(CHECK) — heading 아래면 부모가 있고, 그 밖에서는 "부모 없음 · 보임 · 순서 있음"(모듈) 이거나
--    "부모 있음 · 숨김 · 순서 없음"(그룹 아래의 숨김)이다. 섞인 행(보이는데 순서 없는 모듈 · 부모 없는 숨김)은 뜻이 없다.
-- ② M4 — 패널에 놓을 수 없는 유형(관계형)은 트리거가 막는다. 정본은 `property.can_place_in_panel` 칸을 적었지만 두지 않는다 — 유형이
--    정한다(같은 목록이 `lib/database/layout-modules.ts` 에 있다). 칸으로 두면 속성마다 같은 값을 들고 다니다 유형과 어긋날 수 있다.
-- ③ 속성이 관계형으로 바뀌면 패널에서 내린다(트리거 — 행을 지워 속성 묶음으로 돌아간다 · 16 *"자동으로 본문으로 축출"*). 지금은
--    유형 바꾸기가 관계형으로 가지 않으므로 지키는 그물이다.
--
-- 기존 행: 숨김 · 고정 행이다 — ① 을 지킨다. 단 그룹 아래의 **보이는** 행(순서 없음)은 뜻이 없다 — 보임은 기본이라 행이 없어야 한다
-- (8f-2 ④). 그런 행이 개발 DB 에 하나 남아 있었다(검사가 남긴 것). 지워도 화면은 같으므로 지운다.
DELETE FROM layout_module
 WHERE kind = 'property' AND area <> 'heading' AND parent_module_id IS NOT NULL AND visible;

-- ①
ALTER TABLE layout_module
  ADD CONSTRAINT ck_layout_module_place CHECK (
    kind <> 'property'
    OR (area = 'heading' AND parent_module_id IS NOT NULL)
    OR (area <> 'heading' AND parent_module_id IS NULL AND visible AND order_idx IS NOT NULL)
    OR (area <> 'heading' AND parent_module_id IS NOT NULL AND NOT visible AND order_idx IS NULL)
  );

-- ② M4
CREATE FUNCTION layout_module_panel_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT type::text FROM property WHERE id = NEW.property_id) = 'relation' THEN
    RAISE EXCEPTION 'layout_module: 관계형 속성은 상세 패널에 놓을 수 없다 (%)', NEW.property_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tg_layout_module_panel_type';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_layout_module_panel_type
  AFTER INSERT OR UPDATE OF area, kind, property_id ON layout_module
  FOR EACH ROW WHEN (NEW.kind = 'property' AND NEW.area = 'panel')
  EXECUTE FUNCTION layout_module_panel_type();

-- ③
CREATE FUNCTION property_unpanel_on_relation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM layout_module WHERE property_id = NEW.id AND kind = 'property' AND area = 'panel';
  RETURN NULL;
END;
$$;

CREATE TRIGGER tg_property_unpanel_on_relation
  AFTER UPDATE OF type ON property
  FOR EACH ROW WHEN (NEW.type::text = 'relation' AND OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION property_unpanel_on_relation();

COMMENT ON CONSTRAINT ck_layout_module_place ON layout_module IS
  'property 행의 자리 — 고정(heading 아래) · 본문 모듈 · 패널(부모 없음 · 보임 · 순서) · 숨김(그룹 아래 · 숨김 · 순서 없음). 3c-1 · F-16-04.';
