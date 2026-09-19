-- relation 의 규칙 — 캐시 투영 · 끝점 검사 · 양방향 대칭 — relation 5a조각 (F-03-10)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `relation_edge` · 불변식 C2 · E1 · R2
--       docs/research/_canon/database.md (C-2 판결: *"relation 값은 [EAV] 에 저장하지 않는다. relation_edge 가 유일한
--       정본. **properties_cache 에만 렌더용 배열로 투영된다.**"*)
--
-- `relation_edge` 표는 0013 이 이미 만들었다. 이 마이그레이션은 **그 위의 규칙**이다 — 표현할 수 있는 것은 전부
-- 승격한다(CLAUDE.md).
--
-- ──────────────────────────────────────────────────────────────────────
-- ① 캐시 투영 — 행 목록은 캐시 한 컬럼으로 그린다 (C2 · R2)
-- ──────────────────────────────────────────────────────────────────────
--
-- 0014 의 `page_cache_rebuild()` 는 `page_property_value` 만 읽었다. relation 은 거기 없으므로(C2) 그대로면 표 · 보드 ·
-- 목록 · 익스포트가 relation 칸을 보려고 저마다 엣지를 조인해야 한다. 판결 그대로 캐시에 투영한다:
--
--   "<property_id>": {"type":"relation","relation":[{"id":"<to_page_id>"}, …],"count":<전체 개수>}
--
-- 배열은 `order_idx` 순 **앞 25개**까지다(노션 API 가 relation 을 25개 + `has_more` 로 주는 것과 같은 크기). F-03-10:
-- *"한 셀에 수천 개 연결 → 셀 렌더는 상위 N개 + '+N개 더'."* 전부 실으면 연결 수천 개짜리 행 하나가 목록 전체의
-- 읽기를 무겁게 한다. 전체는 `relation_edge` 를 페이지로 나눠 읽는다.
--
-- ★ 캐시에는 **걸러지지 않은 id** 가 든다. 볼 수 없는 페이지 · 휴지통에 간 페이지를 빼는 것은 읽는 쪽의 일이다
--   (`src/lib/database/relation.ts` `readRelation`) — 권한은 사람마다 달라 캐시에 넣을 수 없고, 휴지통은 되돌릴 수 있어
--   엣지를 지우지 않는다(F-03-10: *"복원 시 되살아나야 함 → page 의 상태로 필터"*).
--
-- 재생성은 두 트리거가 **같은 함수**(`page_cache_refresh`)를 부른다 — EAV 가 바뀌든 엣지가 바뀌든 결과가 한 규칙이다.
-- 0014 의 원칙 그대로 증분이 아니라 재생성이다(복구 경로가 곧 평상시 경로).
--
-- ──────────────────────────────────────────────────────────────────────
-- ② 끝점 검사 — 엣지는 relation 프로퍼티의 것이고, 양 끝이 제 data_source 에 있다 (RE1)
-- ──────────────────────────────────────────────────────────────────────
--
--   RE1  `property.type = 'relation'` · `from_page` 는 그 프로퍼티의 data_source 의 행 ·
--        `to_page` 는 `config.target_data_source_id` 의 행이다
--
-- FK 는 "행이다"까지만 본다. 어느 표의 행인지는 못 본다 — 다른 표의 행을 가리키는 엣지는 rollup 이 엉뚱한 스키마의
-- 프로퍼티를 읽게 만든다. CHECK 으로 쓸 수 없어(다른 표를 본다) 트리거다.
--
-- ──────────────────────────────────────────────────────────────────────
-- ③ 양방향 대칭 — 짝이 있는 프로퍼티의 엣지는 거울상과 함께 있다 (E1)
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 E1: *"양방향 relation 은 `property.config.synced_property_id` 로 짝을 맺고, 엣지 삽입/삭제는 두 프로퍼티에 대해
-- 같은 트랜잭션에서 대칭 수행한다."* 03 F-03-10 은 "엣지 1행 + 역방향 조회"를 권했지만 정본이 이긴다 — 두 행이면
-- 어느 방향의 칸이든 `WHERE property_id = ? AND from_page_id = ?` 한 모양으로 읽고, 방향마다 칩 순서(`order_idx`)를
-- 따로 가진다. 03 이 걱정한 "두 행은 반드시 어긋난다"는 **커밋 시점에 DB 가 검사**해서 막는다:
--
--   · 넣은 엣지 (P, a→b): P 의 짝 S 가 있으면 (S, b→a) 가 있어야 한다
--   · 지운 엣지 (P, a→b): P 와 S 가 아직 있으면 (S, b→a) 도 없어야 한다
--
-- `DEFERRABLE INITIALLY DEFERRED` 다 — 두 행을 한 문장으로 넣을 수 없으므로 문장 끝이 아니라 **트랜잭션 끝**에 본다.
-- 자기 자신과 짝인 프로퍼티(자기참조 · 프로퍼티 하나로 양방향)는 S = P 다 — (P, a→b) 의 거울상은 (P, b→a) 이고,
-- a = b 면 자기 자신이다.
--
-- 프로퍼티나 페이지가 **물리 삭제**되며 CASCADE 로 사라진 엣지는 검사하지 않는다(그 프로퍼티가 이미 없다 · 페이지가
-- 사라지면 양쪽 엣지가 함께 CASCADE 된다). 프로퍼티의 soft delete 는 엣지를 건드리지 않는다.

-- ── ① ────────────────────────────────────────────────────────────────

CREATE FUNCTION page_cache_refresh(target uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE page p
     SET properties_cache =
           coalesce(
             (SELECT jsonb_object_agg(v.property_id, v.value)
                FROM page_property_value v
               WHERE v.page_id = target),
             '{}'::jsonb)
           ||
           coalesce(
             (SELECT jsonb_object_agg(r.property_id, r.value)
                FROM (
                  SELECT e.property_id,
                         jsonb_build_object(
                           'type', 'relation',
                           'relation', coalesce(
                             jsonb_agg(jsonb_build_object('id', e.to_page_id) ORDER BY e.order_idx, e.to_page_id)
                               FILTER (WHERE e.rn <= 25),
                             '[]'::jsonb),
                           'count', count(*)
                         ) AS value
                    FROM (
                      SELECT re.property_id, re.to_page_id, re.order_idx,
                             row_number() OVER (PARTITION BY re.property_id ORDER BY re.order_idx, re.to_page_id) AS rn
                        FROM relation_edge re
                       WHERE re.from_page_id = target
                    ) e
                   GROUP BY e.property_id
                ) r),
             '{}'::jsonb),

         search_tsv = to_tsvector('simple', coalesce(
           left(
             (SELECT string_agg(v.text_value, ' ' ORDER BY pr.order_idx)
                FROM page_property_value v
                JOIN property pr ON pr.id = v.property_id
               WHERE v.page_id = target
                 AND v.text_value IS NOT NULL
                 AND pr.type IN ('title', 'rich_text')),
             100000),
           '')),

         cache_version = p.cache_version + 1
   WHERE p.id = target;
END $$;

COMMENT ON FUNCTION page_cache_refresh(uuid) IS
  '불변식 R2. properties_cache · search_tsv 의 **유일한** 쓰기자다. EAV(page_property_value)와 relation_edge 를 함께
   읽어 재생성한다(C2: relation 은 캐시에만 렌더용 배열로 투영된다 — 앞 25개 + count).';

-- 0014 의 트리거 함수를 같은 이름으로 갈아 끼운다 — 트리거는 그대로 두고 몸통만 새 함수를 부른다.
CREATE OR REPLACE FUNCTION page_cache_rebuild() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM page_cache_refresh(coalesce(NEW.page_id, OLD.page_id));
  RETURN NULL;
END $$;

CREATE FUNCTION relation_cache_rebuild() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 엣지는 **나가는 쪽** 행의 칸이다. 들어오는 쪽(to)의 칸은 거울상 엣지가 따로 바꾼다(E1).
  PERFORM page_cache_refresh(coalesce(NEW.from_page_id, OLD.from_page_id));
  RETURN NULL;
END $$;

CREATE TRIGGER tg_relation_cache_rebuild
  AFTER INSERT OR UPDATE OR DELETE ON relation_edge
  FOR EACH ROW EXECUTE FUNCTION relation_cache_rebuild();

-- ── ② RE1 ────────────────────────────────────────────────────────────

CREATE FUNCTION relation_edge_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type property_type;
  owner_ds   uuid;
  target_ds  text;
  from_ds    uuid;
  to_ds      uuid;
BEGIN
  SELECT type, data_source_id, config->>'target_data_source_id'
    INTO owner_type, owner_ds, target_ds
    FROM property WHERE id = NEW.property_id;

  IF owner_type IS DISTINCT FROM 'relation' THEN
    RAISE EXCEPTION 'relation 프로퍼티의 엣지만 만들 수 있다 (property %)', NEW.property_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_guard';
  END IF;

  SELECT data_source_id INTO from_ds FROM page WHERE id = NEW.from_page_id;
  IF from_ds IS DISTINCT FROM owner_ds THEN
    RAISE EXCEPTION '엣지의 시작은 그 프로퍼티의 data_source 의 행이어야 한다 (page %)', NEW.from_page_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_guard';
  END IF;

  SELECT data_source_id INTO to_ds FROM page WHERE id = NEW.to_page_id;
  IF to_ds::text IS DISTINCT FROM target_ds THEN
    RAISE EXCEPTION '엣지의 끝은 대상 data_source 의 행이어야 한다 (page %)', NEW.to_page_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_guard';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER tg_relation_edge_guard
  BEFORE INSERT OR UPDATE OF property_id, from_page_id, to_page_id ON relation_edge
  FOR EACH ROW EXECUTE FUNCTION relation_edge_guard();

-- ── ③ E1 ─────────────────────────────────────────────────────────────

CREATE FUNCTION relation_edge_mirror_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  synced text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 같은 트랜잭션에서 다시 지워졌으면 볼 것이 없다.
    IF NOT EXISTS (SELECT 1 FROM relation_edge
                    WHERE property_id = NEW.property_id AND from_page_id = NEW.from_page_id AND to_page_id = NEW.to_page_id) THEN
      RETURN NULL;
    END IF;
    SELECT config->>'synced_property_id' INTO synced FROM property WHERE id = NEW.property_id;
    IF synced IS NULL OR NOT EXISTS (SELECT 1 FROM property WHERE id = synced) THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM relation_edge
                    WHERE property_id = synced AND from_page_id = NEW.to_page_id AND to_page_id = NEW.from_page_id) THEN
      RAISE EXCEPTION '양방향 relation 의 엣지에 거울상이 없다 (% : % → %)', NEW.property_id, NEW.from_page_id, NEW.to_page_id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_mirror';
    END IF;
    RETURN NULL;
  END IF;

  -- DELETE. 같은 트랜잭션에서 다시 생겼으면 볼 것이 없다.
  IF EXISTS (SELECT 1 FROM relation_edge
              WHERE property_id = OLD.property_id AND from_page_id = OLD.from_page_id AND to_page_id = OLD.to_page_id) THEN
    RETURN NULL;
  END IF;
  -- 프로퍼티가 물리 삭제되며 CASCADE 된 엣지면 그 프로퍼티가 이미 없다 → synced 가 NULL.
  SELECT config->>'synced_property_id' INTO synced FROM property WHERE id = OLD.property_id;
  IF synced IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM relation_edge
              WHERE property_id = synced AND from_page_id = OLD.to_page_id AND to_page_id = OLD.from_page_id) THEN
    RAISE EXCEPTION '양방향 relation 의 엣지를 지웠는데 거울상이 남았다 (% : % → %)', OLD.property_id, OLD.from_page_id, OLD.to_page_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_relation_edge_mirror';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tg_relation_edge_mirror
  AFTER INSERT OR DELETE ON relation_edge
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION relation_edge_mirror_check();
