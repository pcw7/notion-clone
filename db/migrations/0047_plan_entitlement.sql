-- 요금제 · 엔타이틀먼트 · 결제 구독 — 잔여 묶음 8k-1조각 (F-13-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 `plan` · `plan_entitlement` · `billing_subscription` · 불변식 PE1 · PE2 ·
--       [보강] 엔타이틀먼트 ① ~ ⑥
--       13-adjacent-products.md F-13-18 *"엔타이틀먼트는 코드가 아니라 데이터여야 한다 … v1은 축 ①(기능 온/오프)과 ②(개수 한도)만 구현하고,
--       ③(기간)·④(크레딧)은 실제 유료 기능이 생길 때 추가한다"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 요금제가 코드 상수로 흩어지기 시작했다
-- ──────────────────────────────────────────────────────────────────────
--
-- 버전 보존 일수(8d-1 · `history/retention.ts`)와 파일 크기 상한(`file/limits.ts`)이 "그 표가 생기면 옮긴다"는 머리말과 함께 코드 상수로
-- 기다리고 있다. 다음 게이트(게스트 한도 · private teamspace)가 같은 길을 가기 전에 표를 세운다. 조회는 `entitlement(workspace, key)`
-- 하나다(PE1 — `if (plan === 'business')` 를 코드에 흩뿌리지 않는다).
--
--   ① 요금제 넷(free · plus · business · enterprise)을 시드한다 — 가격은 13 의 1차 출처(KRW). `price_annual` 은 연 결제의 **월 환산액**이다
--   ② 엔타이틀먼트의 값 모양은 종류가 정한다 — boolean 은 참거짓 · limit · duration 은 0 이상의 정수 또는 null(무제한) · credit 은 객체.
--      키는 점으로 나눈 소문자(`history.days`). 같은 키의 종류가 요금제마다 같은 것 · 모든 요금제가 모든 키를 갖는 것은 시드와 검사가 지킨다
--   ③ 결제 구독 — 워크스페이스마다 살아 있는 구독(취소되지 않은 것)은 하나. 좌석 칸은 두지 않는다(PE2 — `workspace_seat_count` 뷰가 유일한
--      원천). 상태는 반드시 있다(정본은 NULL 을 막지 않았다 — 상태 없는 구독은 판정할 수 없다). 결제 연동은 없다 — 요금제는 운영자 명령이
--      바꾼다(CLAUDE.md 절대 제약 1 · 유료 SaaS 의존 금지)
--   ④ `workspace.plan_code`(0001 — 파생 캐시)는 있는 요금제만 가리킨다(FK). 정본은 구독이고, 둘을 한 트랜잭션에서 쓰는 것은 명령 하나다
--   ⑤ 이 조각이 쓰는 키는 `history.days` 하나 — 소비자가 생길 때 키를 더한다(8g "지금 걸 곳이 없는 칸을 미리 두지 않는다")
--
-- 기존 행: 모든 워크스페이스가 `free`(0001 의 기본값) — FK 를 그대로 지난다. 구독 행은 없다(free 는 구독이 없는 상태다).

CREATE TABLE plan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code IN ('free', 'plus', 'business', 'enterprise')),
  display_name  text NOT NULL,
  price_monthly numeric NULL CHECK (price_monthly >= 0),   -- NULL = 문의(Enterprise)
  price_annual  numeric NULL CHECK (price_annual >= 0),    -- 연 결제의 월 환산액
  currency      text NULL
);

CREATE TABLE plan_entitlement (
  plan_id uuid NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  key     text NOT NULL,
  kind    text NOT NULL CHECK (kind IN ('boolean', 'limit', 'duration', 'credit')),
  value   jsonb NOT NULL,
  PRIMARY KEY (plan_id, key),
  CONSTRAINT ck_plan_entitlement_key CHECK (key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  -- CASE 로 순서를 묶는다 — 숫자가 아닌 jsonb 를 numeric 으로 바꾸면 던지므로 모양을 먼저 본다.
  CONSTRAINT ck_plan_entitlement_value CHECK (
    CASE kind
      WHEN 'boolean' THEN jsonb_typeof(value) = 'boolean'
      WHEN 'credit' THEN jsonb_typeof(value) = 'object'
      ELSE CASE jsonb_typeof(value)
        WHEN 'null' THEN true
        WHEN 'number' THEN (value)::numeric >= 0 AND (value)::numeric = trunc((value)::numeric)
        ELSE false
      END
    END
  )
);

CREATE TABLE billing_subscription (                 -- 구 13 `subscription`. 개명 [X-10]
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspace(id),
  plan_id              uuid NOT NULL REFERENCES plan(id),
  billing_cycle        text NULL CHECK (billing_cycle IN ('monthly', 'annual')),   -- NULL = 운영자가 준 요금제(결제 없음)
  status               text NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'grace')),
  current_period_start timestamptz NULL,
  current_period_end   timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  canceled_at          timestamptz NULL,
  CONSTRAINT ck_billing_subscription_period
    CHECK (current_period_start IS NULL OR current_period_end IS NULL OR current_period_end > current_period_start),
  CONSTRAINT ck_billing_subscription_canceled CHECK ((status = 'canceled') = (canceled_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_billing_subscription_live ON billing_subscription (workspace_id) WHERE status <> 'canceled';

INSERT INTO plan (code, display_name, price_monthly, price_annual, currency) VALUES
  ('free', 'Free', 0, 0, 'KRW'),
  ('plus', 'Plus', 14000, 11200, 'KRW'),
  ('business', 'Business', 30000, 24000, 'KRW'),
  ('enterprise', 'Enterprise', NULL, NULL, 'KRW');

-- 버전 보존 일수 — 11 F-11-01 *"Free 7일 / Plus 30일 / Business 90일 / Enterprise Any number of days"* (null = 무제한)
INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'history.days', 'duration', v.value
  FROM plan p
  JOIN (VALUES ('free', '7'::jsonb), ('plus', '30'::jsonb), ('business', '90'::jsonb), ('enterprise', 'null'::jsonb)) AS v(code, value)
    ON v.code = p.code;

ALTER TABLE workspace
  ADD CONSTRAINT fk_workspace_plan_code FOREIGN KEY (plan_code) REFERENCES plan(code);

COMMENT ON TABLE plan_entitlement IS
  '불변식 PE1: if (plan === ''business'') 를 코드에 흩뿌리지 않는다 — entitlement(workspace, key) 단일 조회 함수만 쓴다(src/lib/billing/entitlement.ts).
   값 모양은 종류가 정한다(ck_plan_entitlement_value · 0047). 모든 요금제가 모든 키를 갖는 것은 시드와 검사(entitlement.db.test.ts)가 지킨다.';
COMMENT ON TABLE billing_subscription IS
  '불변식 PE2: seats 컬럼을 두지 않는다 — 좌석은 workspace_seat_count 뷰가 유일한 원천이다.
   살아 있는(취소되지 않은) 구독은 워크스페이스마다 하나 — ux_billing_subscription_live(0047). workspace.plan_code 는 이것의 파생 캐시이고
   둘을 함께 쓰는 것은 setWorkspacePlan 하나다.';
