-- 리마인더 — 히스토리 · 활동 4c-1조각 (F-11-10 · 데이터베이스 날짜 속성 먼저)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 `reminder` · [보강] 리마인더 ① ~ ⑥
--       11-history-notifications.md F-11-10 *"데이터베이스 리마인더는 Date property 가 있어야 설정 가능"* · *"빈 값 — 날짜만 있고 시각이
--       없는 리마인더 → 기본 시각(예: 09:00)을 반드시 정의한다"* · *"과거 시각 설정 → 즉시 발화하지 않고 '이미 지남' 상태"*
--
-- ① 표 — 정본 DDL 에 `workspace_id` · `fire_at`(= target_at − lead 분 · 워커가 찾는 칸) · `created_at` 을 더했다. 불변식은 CHECK 로.
--    날짜 속성의 리마인더는 칸마다 하나(부분 UNIQUE). 색인은 초판의 `target_at` 대신 `fire_at`(발화 전인 것만 — 리드가 있으면 target_at 의
--    색인으로는 찾을 수 없다).
-- ② `reminder_target_at` — 날짜 값의 시작을 울릴 시각으로. 날짜만이면 그날 09:00, 오프셋이 있는 시각은 그대로, 오프셋이 없는 시각은
--    타임존으로 읽는다. 타임존은 값의 `time_zone` 이 먼저(모르는 이름이면 물러난다), 없으면 리마인더의 것.
-- ③ 트리거 — 셀을 쓰는 모든 길(셀 고치기 · 카드 옮기기 · 행 만들기 · 템플릿 · 가져오기 · 뒤의 자동화)의 뒤에 그 칸의 리마인더를 맞춘다.
--    값이 비거나 날짜가 아니면 지우고, 시각이 바뀌었으면 다시 계산한다 — 미래로 옮기면 다시 걸고(`fired_at` = NULL), 지난 시각이면 "지남"
--    (울리지 않는다).
--
-- 기존 행: 없다(새 표).

CREATE TABLE reminder (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id),
  -- 리마인더가 사는 블록 — 날짜 속성의 것이면 그 행(= page_id). 본문 칩(뒤)이면 그 블록.
  block_id      uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  -- 날짜 속성의 리마인더면 그 속성. 속성을 지우면(물리) 함께 사라진다.
  property_id   text NULL REFERENCES property(id) ON DELETE CASCADE,
  -- 날짜 값이 가리키는 시각(날짜만이면 그날 09:00) — `reminder_target_at`.
  target_at     timestamptz NOT NULL,
  -- 건 사람의 타임존(IANA) — 값에 타임존이 없을 때 날짜를 읽는 기준.
  timezone      text NOT NULL,
  lead_minutes  int NOT NULL DEFAULT 0,
  fire_at       timestamptz NOT NULL,
  recipient_ids uuid[] NOT NULL,
  -- 울렸거나(4c-2) · 지난 시각에 걸렸다("지남" — 울리지 않는다). NULL 이면 기다린다.
  fired_at      timestamptz NULL,
  created_by    uuid NOT NULL REFERENCES "user"(id),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_reminder_lead CHECK (lead_minutes BETWEEN 0 AND 10080),
  CONSTRAINT ck_reminder_recipients CHECK (cardinality(recipient_ids) >= 1),
  CONSTRAINT ck_reminder_fire_at CHECK (fire_at = target_at - make_interval(mins => lead_minutes)),
  CONSTRAINT ck_reminder_property_block CHECK (property_id IS NULL OR block_id = page_id)
);

CREATE UNIQUE INDEX ux_reminder_property ON reminder (page_id, property_id) WHERE property_id IS NOT NULL;
-- 워커가 때가 된 리마인더를 찾는 질의의 모양이다(4c-2).
CREATE INDEX ix_reminder_due ON reminder (fire_at) WHERE fired_at IS NULL;

CREATE FUNCTION reminder_target_at(start text, value_tz text, reminder_tz text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tz text := reminder_tz;
BEGIN
  -- 값의 타임존이 먼저 — 모르는 이름이면 리마인더의 것으로 물러난다(셀의 타임존은 모양만 검사한다)
  IF value_tz IS NOT NULL THEN
    BEGIN
      PERFORM now() AT TIME ZONE value_tz;
      tz := value_tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      tz := reminder_tz;
    END;
  END IF;
  IF start ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN (start::date + time '09:00') AT TIME ZONE tz;
  ELSIF start ~ '(Z|[+-]\d{2}:\d{2})$' THEN
    RETURN start::timestamptz;
  ELSE
    RETURN start::timestamp AT TIME ZONE tz;
  END IF;
END
$$;

CREATE FUNCTION reminder_follow_cell() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r reminder%ROWTYPE;
  d jsonb;
  target timestamptz;
  fire timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM reminder WHERE page_id = OLD.page_id AND property_id = OLD.property_id;
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM reminder WHERE page_id = NEW.page_id AND property_id = NEW.property_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  d := NEW.value -> 'date';
  IF NEW.value ->> 'type' IS DISTINCT FROM 'date' OR d IS NULL OR jsonb_typeof(d) <> 'object' OR (d ->> 'start') IS NULL THEN
    -- 날짜가 비었다 — 울릴 시각이 없다
    DELETE FROM reminder WHERE id = r.id;
    RETURN NULL;
  END IF;
  target := reminder_target_at(d ->> 'start', d ->> 'time_zone', r.timezone);
  IF target IS DISTINCT FROM r.target_at THEN
    fire := target - make_interval(mins => r.lead_minutes);
    UPDATE reminder
       SET target_at = target,
           fire_at = fire,
           -- 미래로 옮기면 다시 건다 · 지난 시각이면 "지남"(울리지 않는다)
           fired_at = CASE WHEN fire > now() THEN NULL ELSE coalesce(r.fired_at, now()) END
     WHERE id = r.id;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER tg_reminder_follow_cell
  AFTER INSERT OR UPDATE OF value OR DELETE ON page_property_value
  FOR EACH ROW EXECUTE FUNCTION reminder_follow_cell();
