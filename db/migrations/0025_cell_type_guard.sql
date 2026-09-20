-- 셀을 갖지 않는 타입에는 셀 행이 생기지 않는다 — 불변식 C1 · C2 의 집행 — rollup 5c-1조각 (F-03-11)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `page_property_value`
--         불변식 C1: *"자동 메타 4종(created_time/created_by/last_edited_time/last_edited_by)과 unique_id 는 이 테이블에
--                     행을 만들지 않는다 — block/page 에서 투영한다. formula/rollup 도 만들지 않는다 — derived_value 소관."*
--         불변식 C2: *"relation 값은 이 테이블에 저장하지 않는다. relation_edge 가 유일한 정본."*
--       §3.5 [보강] rollup v1 — rollup 의 값은 **어디에도** 저장하지 않는다(읽을 때 계산).
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 지금인가
-- ──────────────────────────────────────────────────────────────────────
--
-- C1 · C2 는 0013 부터 **주석으로만** 있었다. 지키는 것은 애플리케이션의 한 줄(`row.ts` `prepareCells` 가 셀 타입이 아닌
-- 프로퍼티를 `unknown_property` 로 거부한다)뿐이다. relation(0024)에 이어 rollup 이 "셀이 없는 타입"의 두 번째 식구가 됐고,
-- 셀을 쓰는 경로는 앞으로 는다(임포트 · 복제 · 템플릿 · 자동화). 그중 하나가 rollup 칸에 값을 써 넣으면:
--
--   · `properties_cache` 에 그 값이 실린다(0024 의 재생성은 EAV 를 통째로 읽는다) — 화면은 계산한 값과 저장된 값 중
--     무엇을 그릴지 모르고, **저장된 값은 권한으로 걸러지지 않았다**
--   · relation 칸이면 엣지가 있는 동안은 캐시의 투영(`||` 의 오른쪽)이 덮어써서 가려지고, **마지막 엣지를 빼는 순간**
--     그 값이 칸에 되살아난다(투영은 엣지가 있는 프로퍼티의 키만 만든다)
--
-- 표현할 수 있는 불변식은 승격한다(CLAUDE.md). 다른 표(`property.type`)를 봐야 해서 CHECK 이 아니라 트리거다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 범위 — 정본이 이름을 든 타입만
-- ──────────────────────────────────────────────────────────────────────
--
--   C1  created_time · created_by · last_edited_time · last_edited_by · unique_id · formula · rollup
--   C2  relation
--
-- `button` · `verification`(UI 전용)은 넣지 않았다 — 정본이 그 둘의 저장 모양을 아직 정하지 않았다. 정하는 조각이 여기에
-- 더하거나(새 마이그레이션) 두지 않는다.
--
-- ⚠ **프로퍼티의 타입이 바뀌는 쪽은 이 트리거가 보지 않는다.** 타입 변환(F-03-09)이 number 를 rollup 으로 바꾸면 기존 셀
--   행이 남는다 — 그 명령이 셀을 지워야 한다(변환 매트릭스의 "손실" 열). 지금은 타입을 바꾸는 명령이 없다(`updateProperty`
--   는 타입을 받지 않는다).

-- 이미 어긋난 행이 있으면 조용히 덮지 않는다 — 트리거는 새 쓰기만 막으므로, 있던 거짓말은 그대로 남는다.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM page_property_value v
    JOIN property p ON p.id = v.property_id
   WHERE p.type IN ('relation', 'formula', 'rollup',
                    'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id');
  IF bad > 0 THEN
    RAISE EXCEPTION '셀을 갖지 않는 타입의 프로퍼티에 셀 행이 %개 있다 — 지우고 다시 실행한다', bad;
  END IF;
END $$;

CREATE FUNCTION page_property_value_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type property_type;
BEGIN
  SELECT type INTO owner_type FROM property WHERE id = NEW.property_id;

  IF owner_type IN ('relation', 'formula', 'rollup',
                    'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id') THEN
    RAISE EXCEPTION '% 프로퍼티는 셀 값을 갖지 않는다 (property %)', owner_type, NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_ppv_type_guard';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION page_property_value_type_guard() IS
  '불변식 C1 · C2. 셀을 갖지 않는 타입(relation · formula · rollup · 자동 메타 4종 · unique_id)의 프로퍼티에는
   page_property_value 행을 만들 수 없다. relation 의 정본은 relation_edge, rollup 은 읽을 때 계산한다.';

-- `property_id` 는 PK 의 일부라 UPDATE 로 바뀔 일이 드물지만, 바뀌면 같은 검사를 탄다.
CREATE TRIGGER tg_ppv_type_guard
  BEFORE INSERT OR UPDATE OF property_id ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_property_value_type_guard();
