-- 오프라인 자동 내려받기의 요금제 — OF-5 (F-12-04)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 [보강 OF-1] ⑥ 설정 → 오프라인 · §3.10 [보강] 엔타이틀먼트(키는 소비자가 생길 때 더한다)
--
-- 키 하나 — `offline.auto_download`(boolean). Plus · Business · Enterprise 만 즐겨찾기 · 최근 페이지를 이 기기에 자동으로 내려받는다(노션과
-- 같다 · Free 는 꺼진 스위치와 "Plus 요금제부터"). 자동 내려받기의 원천 라우트(`GET …/offline/auto`)가 물을 때 묻는다(허락하지 않으면
-- `plan_required`). 직접 내려받기(스위치 · OF-2 · OF-4)는 요금제와 무관하다. 모든 요금제가 키를 같은 종류로 갖는다(`billing.db.test.ts` ①).

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'offline.auto_download', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'true'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
