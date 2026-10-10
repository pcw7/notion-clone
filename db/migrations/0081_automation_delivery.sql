-- send_webhook — 정의 · 쌓기 — 자동화 5c-1조각 (F-08-13)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑫
--       08 F-08-13 *"`Send webhook` … 유료 플랜 전용"* · *"페이로드에 `run_id`(멱등키)를 반드시 포함"*
--
-- ① 엔타이틀먼트 `automation.webhook`(boolean) — Free 만 false. 저장할 때 막고 실행 때 다시 묻는다.
-- ② `automation_delivery` — 실행이 쌓는 배달 한 줄. 엔진은 바깥으로 나가지 않는다(트랜잭션 안에서 네트워크를 타지 않는다) — 같은
--    트랜잭션에서 이 줄을 쌓고, 실행이 되돌려지면 함께 사라진다(`run_id` FK). 그때의 봉인된 URL · 헤더를 옮겨 싣는다 — 나중에 액션을
--    고쳐도 쌓인 배달은 그때의 것이다. 몸(payload)은 그때의 값이다. 보내기(가져가기 · 재시도 · 멈춤)는 5c-2.
--    짝 — 보낼 차례(`pending`)면 보낼 시각이 있다 · 끝났으면(`sent` · `failed` · `dropped`) 끝난 시각이 있다(페이지 웹훅의 배달과 같다).
--
-- 기존 행: 새 키 · 새 표.

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'automation.webhook', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'true'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;

CREATE TABLE automation_delivery (
  id               uuid PRIMARY KEY,
  run_id           uuid NOT NULL REFERENCES automation_run(id) ON DELETE CASCADE,
  automation_id    uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspace(id),
  url_sealed       bytea NOT NULL,
  url_hint         text NOT NULL,
  -- [{ name, valueSealed(base64) }]
  headers          jsonb NOT NULL DEFAULT '[]' CONSTRAINT ck_automation_delivery_headers CHECK (jsonb_typeof(headers) = 'array'),
  payload          jsonb NOT NULL CONSTRAINT ck_automation_delivery_payload CHECK (jsonb_typeof(payload) = 'object'),
  status           text NOT NULL
                   CONSTRAINT ck_automation_delivery_status CHECK (status IN ('pending', 'sent', 'failed', 'dropped')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NULL,
  locked_until     timestamptz NULL,
  last_status      int NULL,
  last_error       text NULL,
  finished_at      timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_automation_delivery_pending CHECK ((status = 'pending') = (next_attempt_at IS NOT NULL)),
  CONSTRAINT ck_automation_delivery_finished CHECK ((status IN ('sent', 'failed', 'dropped')) = (finished_at IS NOT NULL))
);

-- 보낼 차례가 된 것 — 워커가 찾는 모양(5c-2)
CREATE INDEX ix_automation_delivery_next ON automation_delivery (next_attempt_at) WHERE status = 'pending';
-- 실행의 배달 — 실행 기록 화면 · 지우기
CREATE INDEX ix_automation_delivery_run ON automation_delivery (run_id);
