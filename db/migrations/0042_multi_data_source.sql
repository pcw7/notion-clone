-- 데이터베이스 하나에 data source 여럿 — 잔여 묶음 8e-1조각 (F-04-23)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `data_source` · `database_data_source` · 불변식 DS1 · DS3 · [보강] 다중 data source
--       §3.6 `view` · 판결 C-5 (소유와 부착은 다른 축)
--       04-database-views.md F-04-23 *"각 뷰는 그중 하나를 골라 바인딩된다"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 표가 data source 를 둘 이상 갖는 순간 주석으로 남긴 불변식이 실제로 깨질 수 있다
-- ──────────────────────────────────────────────────────────────────────
--
-- 0013 은 database ↔ data_source 를 1:N 으로 만들어 두었지만 data source 를 만드는 곳은 `createDatabase` 하나뿐이었다. 8e 가 둘째
-- 경로(`addDataSource`)를 연다. 그래서 0013 이 애플리케이션에 맡긴 것 중 셋을 표로 올린다.
--
-- ① 뷰의 (데이터베이스, data source) 쌍은 **부착 행**이어야 한다. 지금까지는 뷰를 만드는 코드가 그 표의 첫 data source 를
--    골랐으므로 어긋날 길이 없었다. 이제 뷰마다 data source 를 고르므로, 다른 표의 data source 를 가리키는 뷰가 생기면 이 표의
--    탭에 남의 행이 나온다. 복합 FK 로 막는다 — 부착 행의 PK 가 바로 그 쌍이다. 부착이 풀리면(앞으로의 linked 해제) 그 위의 뷰도
--    함께 사라진다(CASCADE · F-04-23 *"그 소스를 보던 뷰도 함께 제거"*). `database_id` 가 NULL 인 뷰(대시보드 위젯)는 MATCH
--    SIMPLE 이라 검사 밖이다.
--
-- ② `database_view` 는 데이터베이스를 가져야 한다. ①은 `database_id` 가 NULL 이면 보지 않으므로, 탭 목록 밖으로 떨어진 DB 뷰가
--    ①을 피해 가지 못하게 한다.
--
-- ③ DS1(모든 data source 는 소유 부착 행을 갖는다)과 DS3(소유 부착 행은 지울 수 없다)을 **지연 제약 트리거**로 올린다.
--    0013 은 DS3 을 트리거로 막지 않았다 — BEFORE DELETE 트리거는 그 삭제가 data_source 삭제의 CASCADE 인지 직접 DELETE 인지
--    가를 수 없기 때문이다. 커밋 시점에 묻으면 가를 필요가 없다: 그때 data source 가 **아직 있고 그 주인도 같은데** 소유 부착
--    행이 없으면 어긴 것이다. CASCADE 로 사라진 data source 는 그때 이미 없다. DS1 의 "적어도 1개"도 같은 질문이다 — 만든
--    트랜잭션이 끝날 때 부착 행이 있어야 한다. 그래서 두 표의 트리거가 한 함수를 부른다.
--
-- 기존 행: data source 는 `createDatabase` 만 만들었고 같은 트랜잭션에서 소유 부착 행을 넣었다. 뷰는 `createDatabase` · `createView` 가
-- 그 표의 소유 data source 로 만들었다 — 셋 다 그대로 지난다.

-- ── ① · ② 뷰 ─────────────────────────────────────────────────────────

ALTER TABLE view
  ADD CONSTRAINT fk_view_attached_source
  FOREIGN KEY (database_id, data_source_id)
  REFERENCES database_data_source (database_id, data_source_id) ON DELETE CASCADE;

ALTER TABLE view
  ADD CONSTRAINT ck_database_view_has_database
  CHECK (owner_kind <> 'database_view' OR database_id IS NOT NULL);

-- ── ③ DS1 · DS3 ──────────────────────────────────────────────────────

CREATE FUNCTION data_source_owner_attachment_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_id uuid;
  owner_id uuid;
BEGIN
  -- 갈래마다 따로 쓴다 — 한 식에 두 표의 열을 섞으면 부착 표에서 `NEW.id` 를 풀다가 실패한다(그 표에는 id 열이 없다).
  IF TG_TABLE_NAME = 'data_source' THEN
    source_id := NEW.id;
  ELSE
    source_id := OLD.data_source_id;
  END IF;
  -- 커밋 시점의 상태로 묻는다. 같은 트랜잭션에서 지워졌으면(CASCADE 포함) 볼 것이 없다.
  SELECT owner_database_id INTO owner_id FROM data_source WHERE id = source_id;
  IF owner_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM database_data_source WHERE database_id = owner_id AND data_source_id = source_id) THEN
    RAISE EXCEPTION 'data source 는 자기 주인 데이터베이스의 부착 행을 가져야 한다 (DS1 · DS3 — data_source %, database %)', source_id, owner_id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_data_source_owner_attachment';
  END IF;
  RETURN NULL;
END $$;

-- 만들 때 · 주인이 바뀔 때(앞으로의 "다른 데이터베이스로 옮기기") — 그 트랜잭션이 끝날 때 새 주인의 부착 행이 있어야 한다.
CREATE CONSTRAINT TRIGGER tg_data_source_owner_attachment
  AFTER INSERT OR UPDATE OF owner_database_id ON data_source
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION data_source_owner_attachment_check();

-- 부착 행이 지워지거나 다른 쌍으로 바뀔 때 — 그것이 소유 행이었고 data source 가 남아 있으면 어긴 것이다.
CREATE CONSTRAINT TRIGGER tg_data_source_owner_detach
  AFTER DELETE OR UPDATE OF database_id, data_source_id ON database_data_source
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION data_source_owner_attachment_check();
