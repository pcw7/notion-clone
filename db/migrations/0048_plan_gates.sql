-- 요금제 게이트 — 게스트 한도 · private teamspace — 잔여 묶음 8k-2조각 (F-13-18)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 엔타이틀먼트 ⑥ · [보강] 요금제 게이트 ① ~ ⑤
--       13-adjacent-products.md F-13-18 *"게스트 Free 10명 / 유료 무제한 · Teamspace: Business 부터 + private teamspace … 게스트 한도 초과
--       상태 — 이미 초대된 게스트를 쫓아낼 수는 없다 → 신규 초대만 차단"*
--
-- 키는 소비자가 생길 때 더한다(0047 ⑤) — 이 조각이 두 키를 쓴다.
--
--   ① `guests.max`(limit) — Free 10 · 나머지 무제한(null). 게스트를 들이는 도우미(`admitGuestIn`)와 대기 초대가 묻는다
--   ② `teamspace.private`(boolean) — Business · Enterprise 만. teamspace 를 private 으로 만들거나 바꿀 때 묻는다
--
-- 표는 그대로다 — 줄만 더한다. 모든 요금제가 두 키를 같은 종류로 갖는다(`billing.db.test.ts` ①).

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'guests.max', 'limit', v.value
  FROM plan p
  JOIN (VALUES ('free', '10'::jsonb), ('plus', 'null'::jsonb), ('business', 'null'::jsonb), ('enterprise', 'null'::jsonb)) AS v(code, value)
    ON v.code = p.code;

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'teamspace.private', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'false'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
