-- 레이아웃이 바뀌었다는 신호 — 항목 레이아웃 3e-2조각 (F-16-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 런타임 구독 레지스트리 (`layout:{data_source_id}`) · [보강] X-5 의 단계 (0단계)
--       16-item-layout.md F-16-12 *"반영 즉시 이 DB 의 행 페이지를 열고 있던 모든 사용자의 화면이 갱신된다 · 페이로드는 version 만 보내고
--       클라이언트가 재조회하는 편이 안전하다"*
--
-- 정본은 레이아웃에 따로 채널(`layout:{data_source_id}`)을 적었다. 0단계에서는 표 변경 알림의 채널(`db_rows` · 0063)에 같은 표 id 를
-- 싣는다 — 받는 쪽(열린 행 페이지)이 레이아웃 버전을 다시 물어 바뀌었을 때만 다시 그린다. 채널을 나누는 것은 X-5 의 다음 단계와 함께다
-- (신호가 "무엇이 바뀌었나"를 싣게 될 때).
--
-- 레이아웃의 모든 적용 · 되돌리기는 머리(`page_layout`)를 넣거나 버전을 올린다 — 머리 하나에 트리거를 건다. 모듈 · 탭 · 기록 표는
-- 같은 트랜잭션에서 머리와 함께 바뀌므로 따로 걸지 않는다(같은 트랜잭션의 같은 신호는 Postgres 가 하나로 합친다).
--
-- 기존 행: 해당 없음(트리거만).

CREATE FUNCTION db_rows_notify_page_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify(NEW.data_source_id);
  RETURN NULL;
END $$;

CREATE TRIGGER tg_page_layout_db_rows_notify AFTER INSERT OR UPDATE ON page_layout
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_page_layout();
