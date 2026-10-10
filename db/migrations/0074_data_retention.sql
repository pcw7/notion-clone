-- 알림 · 활동 데이터 수명 — 히스토리 · 활동 4d-1조각 (F-11-18 · 공용 스케줄러의 다섯 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 알림 · 활동 데이터 수명 ① ~ ⑤
--       11-history-notifications.md F-11-18 *"정책 미설정 → 코드 상수 기본값. NULL 을 '무제한'으로 해석하지 말 것"* ·
--       *"미읽음 알림이 보관 기간을 넘김 → 삭제하지 않는다 … 사용자당 미읽음 상한(N건)"*
--
-- ① 일의 종류에 `data_retention` 을 더한다 — 읽은 알림 · 오래된 활동 이벤트 · 넘친 안 읽은 알림 · 넘친 최근 방문을 지우고 파티션을 미리
--    만드는 주기 일이다.
-- ② 색인 둘 — 지울 때가 된 알림(읽었거나 보관한 뒤의 시각 · 처리한 것만)과 활동 이벤트의 시각. 워커가 찾는 질의의 모양이다.
-- ③ `ensure_activity_partition(year)` — 활동 이벤트의 그 해 파티션을 만든다. 앱이 DDL 을 쓰지 않도록 여기 둔다(스키마는 SQL 이 소유한다).
--    이미 있으면 'exists', DEFAULT 에 그 해의 행이 이미 있으면 만들지 못하므로 'blocked'(그 해는 DEFAULT 에 남는다), 만들었으면 'created'.
--    경계는 0020 의 파티션과 같다(UTC 1월 1일 0시).
--
-- 기존 행: 일의 종류는 넓히기만 한다 · 색인은 새로 · 함수는 새로.

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind
  CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete', 'reminder_fire', 'data_retention'));

-- 읽었거나 보관한 뒤의 시각(늦은 쪽) — GREATEST 는 NULL 을 건너뛴다
CREATE INDEX ix_notification_processed ON notification (GREATEST(read_at, archived_at))
  WHERE read_at IS NOT NULL OR archived_at IS NOT NULL;
CREATE INDEX ix_activity_event_created ON activity_event (created_at);

CREATE FUNCTION ensure_activity_partition(y int) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  part text := format('activity_event_%s', y);
  lo timestamptz := make_timestamptz(y, 1, 1, 0, 0, 0, 'UTC');
  hi timestamptz := make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'UTC');
BEGIN
  IF to_regclass(part) IS NOT NULL THEN
    RETURN 'exists';
  END IF;
  -- DEFAULT 에 그 해의 행이 있으면 새 파티션을 붙일 수 없다(Postgres 가 거부한다) — 그 해는 DEFAULT 에 남는다
  IF EXISTS (SELECT 1 FROM activity_event_default WHERE created_at >= lo AND created_at < hi) THEN
    RETURN 'blocked';
  END IF;
  EXECUTE format('CREATE TABLE %I PARTITION OF activity_event FOR VALUES FROM (%L) TO (%L)', part, lo, hi);
  RETURN 'created';
END
$$;
