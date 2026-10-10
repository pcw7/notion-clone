-- 모더레이션 조치 — 운영자는 주체가 아니다 · 조치는 쌓기만 한다 — 게시 · 공유 6b-2조각 (F-17-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 끝 [보강] 모더레이션 조치 ①~⑥
--       17-ops-governance.md F-17-09 *"moderation_action — append-only"* · *"이력은 파기 대상에서 제외"*
--
-- ① `moderation_action` — 운영자의 조치 한 줄. 대상 FK 가 없다(파기돼도 이력은 남는다). 케이스 없이 하는 조치도 있다(법적 요청).
--    내리는 데는 까닭이 있다(take_down ⇔ reason_code). 누가 했는지는 운영자가 적은 이름(`actor` — 1~100자).
-- ② append-only — 고치기 · 지우기를 트리거가 막는다. 지금 상태는 블록의 `moderation_state` 에 비정규화한다.
--
-- 기존 행: 새 표.

CREATE TABLE moderation_action (
  id           uuid PRIMARY KEY,
  case_id      uuid NULL REFERENCES moderation_case(id),
  target_type  text NOT NULL CONSTRAINT ck_moderation_action_target CHECK (target_type IN ('page')),
  target_id    uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  action       text NOT NULL CONSTRAINT ck_moderation_action_action CHECK (action IN ('take_down', 'dismiss', 'reinstate')),
  reason_code  text NULL
               CONSTRAINT ck_moderation_action_reason CHECK (reason_code IN ('phishing', 'malware', 'illegal', 'harassment', 'copyright', 'spam', 'other')),
  note         text NOT NULL DEFAULT '' CONSTRAINT ck_moderation_action_note CHECK (char_length(note) <= 2000),
  actor        text NOT NULL CONSTRAINT ck_moderation_action_actor CHECK (char_length(btrim(actor)) BETWEEN 1 AND 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_moderation_action_reason_needed CHECK ((action = 'take_down') = (reason_code IS NOT NULL))
);

CREATE INDEX ix_moderation_action_target ON moderation_action (target_type, target_id, created_at);

CREATE FUNCTION moderation_action_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'moderation_action 은 쌓기만 한다(append-only)' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER tg_moderation_action_append_only
  BEFORE UPDATE OR DELETE ON moderation_action
  FOR EACH ROW EXECUTE FUNCTION moderation_action_append_only();
