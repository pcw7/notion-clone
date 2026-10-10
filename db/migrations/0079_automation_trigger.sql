-- DB automation — 정의 · 실행 주체 — 자동화 5b-1조각 (F-08-09 · F-08-10)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 DDL(`automation_trigger`) · [보강] DB automation — 정의 · 실행 주체 ① ~ ⑤
--
-- ① `automation_trigger` — 정본 DDL 그대로 + 짝 CHECK: 속성 편집 트리거만 속성을 갖는다 · 조건은 속성 편집 트리거에만 · 일정은 일정
--    트리거에만. 속성이 물리 삭제되면(표가 지워질 때) 트리거도 함께 지워진다(CASCADE). 소프트 삭제는 실행할 때 본다(5b-2).
-- ② `automation.disabled_reason` — [보강] 칸. 꺼진 까닭(`creator_left` 만든 사람이 떠났다 · `trigger_broken` 트리거의 속성이 사라졌다 ·
--    `failures` 실패가 이어졌다). 까닭이 있으면 꺼져 있다(`ck_automation_disabled_reason`) — 사람이 끈 것은 까닭이 없다.
-- ③ DB automation 은 이름이 있다(1~100자 · `ck_automation_db_name`). 버튼은 속성 이름이 곧 글자라 이름이 없어도 된다.
--
-- 기존 행: 새 표 · 새 칸(NULL) · 기존 automation 은 모두 버튼이라 이름 CHECK 에 걸리지 않는다.

CREATE TABLE automation_trigger (
  id            uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
  type          text NOT NULL
                CONSTRAINT ck_automation_trigger_type CHECK (type IN ('page_added', 'property_edited', 'schedule', 'manual_click')),
  property_id   text NULL REFERENCES property(id) ON DELETE CASCADE,
  condition     jsonb NULL,
  schedule      jsonb NULL,
  CONSTRAINT ck_automation_trigger_property CHECK ((type = 'property_edited') = (property_id IS NOT NULL)),
  CONSTRAINT ck_automation_trigger_condition CHECK (condition IS NULL OR (type = 'property_edited' AND jsonb_typeof(condition) = 'object')),
  CONSTRAINT ck_automation_trigger_schedule CHECK ((type = 'schedule') = (schedule IS NOT NULL))
);
-- 그 automation 의 트리거 · 속성이 바뀌었을 때 그 속성을 보는 트리거(5b-2)
CREATE INDEX ix_automation_trigger_automation ON automation_trigger (automation_id);
CREATE INDEX ix_automation_trigger_property ON automation_trigger (property_id) WHERE property_id IS NOT NULL;

ALTER TABLE automation
  ADD COLUMN disabled_reason text NULL
    CONSTRAINT ck_automation_disabled_reason_value CHECK (disabled_reason IN ('creator_left', 'trigger_broken', 'failures')),
  ADD CONSTRAINT ck_automation_disabled_reason CHECK (disabled_reason IS NULL OR NOT enabled),
  ADD CONSTRAINT ck_automation_db_name CHECK (kind <> 'db_automation' OR (name IS NOT NULL AND char_length(name) BETWEEN 1 AND 100));
