-- 표가 바뀌었다는 신호 — 뷰 결과 실시간 동기화 1단계 — DB 심화 2k-1조각 (F-04-24)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 런타임 구독 레지스트리 · 판결 X-5 · [보강] X-5 의 단계(0단계는 "다시 읽어라" 한 종류)
--       04-database-views.md F-04-24 *"클론 시 현실적 대안 (1) MVP: … 뷰 전체 재조회 알림만"* ·
--       *"브로드캐스트 폭증 → 뷰 단위 코얼레싱 + 디바운스 + '변경 있음, 재조회하라' 형태의 얇은 알림"*
--
-- 채널 `db_rows` 에 **표(data source) id 하나**만 싣는다 — 무엇이 바뀌었는지는 싣지 않는다(받는 쪽이 다시 읽는다 · 권한은 다시 읽는
-- 쪽이 본다). 신호는 쓰는 트랜잭션의 트리거가 보내므로 **커밋된 것만** 오고, 같은 트랜잭션 안의 같은 신호는 Postgres 가 하나로 합친다
-- (큰 타입 바꾸기 · 일괄 편집도 표마다 한 번). 0016(`collab_doc` · `collab_access`)과 같은 길이다.
--
-- 무엇이 신호를 보내는가 — 뷰에 보이는 것이 바뀌는 쓰기:
--   ① 행(`page`)의 넣기 · 지우기 · 바꾸기 — 칸(`page_property_value`)과 relation 은 행의 읽기 모델(`properties_cache`)을 고치므로 여기로 온다
--   ② 행 블록의 수명 · 순서 · 제목 · 아이콘(`block` — 휴지통 · 복원 · 옮기기)
--   ③ 속성 · 옵션(컬럼이 바뀐다) ④ 뷰(필터 · 정렬 · 컬럼) ⑤ 보드의 손으로 둔 순서(`row_position`)

CREATE FUNCTION db_rows_notify(source uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT pg_notify('db_rows', source::text) WHERE source IS NOT NULL;
$$;

-- ① 행
CREATE FUNCTION db_rows_notify_page() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify(CASE WHEN TG_OP = 'DELETE' THEN OLD.data_source_id ELSE NEW.data_source_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER tg_page_db_rows_notify AFTER INSERT OR UPDATE OR DELETE ON page
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_page();

-- ② 행 블록 — 표의 행만(부모가 data source 인 페이지)
CREATE FUNCTION db_rows_notify_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'page' AND NEW.parent_type = 'data_source'
     AND (OLD.lifecycle, OLD.order_key, OLD.properties, OLD.format, OLD.parent_id)
         IS DISTINCT FROM (NEW.lifecycle, NEW.order_key, NEW.properties, NEW.format, NEW.parent_id) THEN
    PERFORM db_rows_notify(NEW.parent_id);
    IF OLD.parent_type = 'data_source' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
      PERFORM db_rows_notify(OLD.parent_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tg_block_db_rows_notify AFTER UPDATE ON block
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_block();

-- ③ 속성 · 옵션
CREATE FUNCTION db_rows_notify_property() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify(CASE WHEN TG_OP = 'DELETE' THEN OLD.data_source_id ELSE NEW.data_source_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER tg_property_db_rows_notify AFTER INSERT OR UPDATE OR DELETE ON property
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_property();

CREATE FUNCTION db_rows_notify_option() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify((SELECT data_source_id FROM property
                           WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.property_id ELSE NEW.property_id END)));
  RETURN NULL;
END $$;
CREATE TRIGGER tg_select_option_db_rows_notify AFTER INSERT OR UPDATE OR DELETE ON select_option
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_option();

-- ④ 뷰 · ⑤ 보드의 순서
CREATE FUNCTION db_rows_notify_view() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify(CASE WHEN TG_OP = 'DELETE' THEN OLD.data_source_id ELSE NEW.data_source_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER tg_view_db_rows_notify AFTER INSERT OR UPDATE OR DELETE ON view
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_view();

CREATE FUNCTION db_rows_notify_row_position() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify((SELECT data_source_id FROM view
                           WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.view_id ELSE NEW.view_id END)));
  RETURN NULL;
END $$;
CREATE TRIGGER tg_row_position_db_rows_notify AFTER INSERT OR UPDATE OR DELETE ON row_position
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_row_position();
