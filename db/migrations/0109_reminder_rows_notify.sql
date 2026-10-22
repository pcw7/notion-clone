-- 리마인더의 걸기 · 풀기 · 울림을 표 변경 신호로 — §7 정리 10n-17 (F-11-10 · F-04-24)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 리마인더 ⑩ [보강 10n-17]
--       0063 의 신호 길(`db_rows_notify` — 표(data source) id 하나를 싣는다 · 받는 쪽이 다시 읽는다 · 같은 트랜잭션의 같은 신호는 하나로)
--
-- 리마인더는 행의 칸(EAV)이 아니라 따로 사는 표라, 걸고 풀어도 표 변경 신호가 나가지 않았다 — 같은 행을 보는 다른 사람의 칸에 종이 서는
-- 것은 새로 열 때였다. 리마인더 행이 생기고 바뀌고 지워지면(걸기 · 다시 걸기 · 풀기 · 울림의 `fired_at` · 셀을 따라 맞춘 시각 — 0072 의
-- `reminder_follow_cell`) 그 행의 표로 신호를 보낸다. 본문 칩의 리마인더(속성 없음)는 그 페이지가 표의 행이 아니므로 `page` 에 없고 —
-- 표가 NULL 이라 `db_rows_notify` 가 보내지 않는다.

CREATE FUNCTION db_rows_notify_reminder() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_notify((SELECT data_source_id FROM page
                           WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.page_id ELSE NEW.page_id END)));
  RETURN NULL;
END $$;

CREATE TRIGGER tg_reminder_db_rows_notify AFTER INSERT OR UPDATE OR DELETE ON reminder
  FOR EACH ROW EXECUTE FUNCTION db_rows_notify_reminder();
