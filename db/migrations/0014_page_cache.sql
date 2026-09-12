-- DB 행의 파생 캐시 — W8-a (F-03-16 셀 편집의 읽기 모델)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 불변식 R2
--   *"properties_cache / search_tsv 는 page_property_value 변경 트리거로만
--     갱신된다. 캐시가 깨지면 복구는 **항상 EAV 로부터의 재생성**이다.
--     캐시를 정본으로 승격하지 않는다."*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 트리거인가 — 애플리케이션이 쓰면 정본이 둘이 된다
-- ──────────────────────────────────────────────────────────────────────
--
-- `page_property_value` 가 셀 값의 유일한 정본이고(C-2/V-2), `properties_cache` 는
-- 그것을 한 행으로 모아 둔 **읽기 모델**이다. 표를 그릴 때 행마다 셀을 조인하는
-- 대신 이 jsonb 하나를 읽는다.
--
-- 애플리케이션이 둘을 함께 쓰게 두면 "EAV 는 맞는데 캐시는 낡은" 상태가 생기고,
-- 그 상태는 **화면에만 보인다** — 필터·정렬은 EAV 의 사이드카를 읽으므로 정상
-- 동작하고, 사용자는 "필터에는 걸리는데 화면에는 옛 값이 보이는" 표를 본다.
-- 트리거가 쥐고 있으면 그 틈이 구조적으로 없다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 증분 갱신이 아니라 **재생성**이다
-- ──────────────────────────────────────────────────────────────────────
--
-- `jsonb_set` 으로 바뀐 키만 고치는 편이 싸다. 그러지 않는 이유는 R2 의 두 번째
-- 문장이다 — *"복구는 항상 EAV 로부터의 재생성"*. 재생성 경로가 **유일한** 경로면
-- 그 경로가 늘 돌고 있으므로 썩지 않는다. 증분과 재생성을 둘 다 두면, 복구
-- 경로는 장애 때만 돌고 그때 처음 버그가 드러난다.
--
-- 비용은 한 행의 셀 수에 비례하고 그 수는 프로퍼티 수(최대 500)로 묶인다.
-- 셀 하나를 고칠 때 그 행의 셀을 다시 모으는 것이므로 표 전체를 읽지 않는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- `search_tsv` 는 사람이 쓴 텍스트만 담는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 사이드카 `text_value` 는 타입마다 의미가 다르다. `select` 은 **옵션 id** 를
-- 담는다(`property-types.ts` 머리말 — 옵션 rename 이 자동으로 전파되게 하려고).
-- 그것을 검색 벡터에 넣으면 `opt_a1b2…` 같은 토큰이 색인되어, 옵션 id 를 아는
-- 사람만 찾을 수 있는 쓰레기가 쌓인다.
--
-- 그래서 `property.type` 을 조인해 **`title` · `rich_text` 만** 넣는다. 타입이
-- 늘어나면 이 목록도 함께 본다.
--
-- ⚠ **한국어는 이 축으로 검색되지 않는다.** 마이그레이션 0012 머리말의 실측과
--   같은 이유다(PostgreSQL 에 한국어 config 가 없어 `'검색'` 이 `'검색이'` 를
--   못 찾는다). `search_document` 는 pg_bigm 축을 함께 갖지만 여기는 정본 §3.5 가
--   `search_tsv` 하나만 정의했다. DB 안 검색(F-03-19 · F-07-14)은 W8 범위 밖이고,
--   그것이 올 때 bigm 축을 같이 만든다 — HANDOFF §7 에 남긴다.

CREATE FUNCTION page_cache_rebuild() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := coalesce(NEW.page_id, OLD.page_id);
BEGIN
  UPDATE page p
     SET properties_cache = coalesce(
           (SELECT jsonb_object_agg(v.property_id, v.value)
              FROM page_property_value v
             WHERE v.page_id = target),
           '{}'::jsonb),

         search_tsv = to_tsvector('simple', coalesce(
           -- tsvector 의 1MB 한도. 프로퍼티가 최대 500개이고 셀마다 길 수 있어서
           -- 합친 뒤 자른다 — 상한의 근거는 마이그레이션 0012 머리말의 실측이다
           -- (고유 한글 토큰 10만 자 → 한도의 42.9%).
           left(
             (SELECT string_agg(v.text_value, ' ' ORDER BY pr.order_idx)
                FROM page_property_value v
                JOIN property pr ON pr.id = v.property_id
               WHERE v.page_id = target
                 AND v.text_value IS NOT NULL
                 -- ★ 사람이 쓴 텍스트만. select 의 text_value 는 옵션 id 다.
                 AND pr.type IN ('title', 'rich_text')),
             100000),
           '')),

         cache_version = p.cache_version + 1
   WHERE p.id = target;

  RETURN NULL;   -- AFTER 트리거의 반환값은 무시된다
END $$;

COMMENT ON FUNCTION page_cache_rebuild() IS
  '불변식 R2. properties_cache·search_tsv 의 **유일한** 쓰기자다. 증분이 아니라
   EAV 로부터의 재생성이므로 복구 경로가 곧 평상시 경로다 — 따로 두면 복구 경로는
   장애 때만 돌고 그때 처음 버그가 드러난다.';

-- `FOR EACH ROW` 다. 셀 쓰기는 보통 한 번에 몇 개이고, statement 트리거로 묶으면
-- 전이 테이블(transition table)을 돌며 page_id 를 모아야 해서 오히려 복잡해진다.
-- 같은 행의 셀 여러 개를 한 트랜잭션에서 쓰면 재생성이 그만큼 돌지만, 마지막
-- 결과는 같고 `cache_version` 만 더 오른다(그 값은 단조성만 의미가 있다).
CREATE TRIGGER tg_page_cache_rebuild
  AFTER INSERT OR UPDATE OR DELETE ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION page_cache_rebuild();

-- ──────────────────────────────────────────────────────────────────────
-- 프로퍼티를 **물리** 삭제하면 캐시에 유령 키가 남는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 평상시 삭제는 soft delete 라(F-03-02) 셀도 캐시도 그대로 남는 것이 의도다.
-- 그러나 `property` 행을 정말 지우면 `page_property_value` 가 CASCADE 로 사라지고,
-- 그때 **행 단위 트리거가 셀마다 돌아** 캐시가 따라온다 — CASCADE DELETE 도
-- DELETE 이므로 위 트리거가 본다. 즉 유령 키는 남지 않는다.
--
-- 이 주석을 남기는 이유는 "CASCADE 는 트리거를 안 돈다"고 착각하기 쉬워서다.
-- `verify-schema.mjs` 의 프로브가 실제로 확인한다.
