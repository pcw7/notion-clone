-- 감사 로그 화면의 요금제 — 게시 · 공유 6d-2조각 (F-11-12)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 끝 [보강] 감사 로그 ⑥ · §3.10 [보강] 엔타이틀먼트(키는 소비자가 생길 때 더한다)
--       11-history-notifications.md F-11-12 *"Settings → Audit log 진입(Enterprise 플랜만)"*
--
-- 키 하나 — `audit.log`(boolean). Enterprise 만 감사 로그를 **읽는다**. 쌓는 것은 요금제와 무관하다(6d-1 — 올린 뒤 지난 기록을 볼 수 있다).
-- 모든 요금제가 키를 같은 종류로 갖는다(`billing.db.test.ts` ①).

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'audit.log', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'false'::jsonb), ('business', 'false'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
