-- 휴지통 보관 기간 — 히스토리 · 활동 4b-3조각 (F-11-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 휴지통 보관 기간 ① · [보강] 엔타이틀먼트(키는 소비자가 생길 때 더한다)
--       §3.1 [보강] 설정 정보구조 ⑦(설정의 요금제 게이트 칸은 boolean 엔타이틀먼트 키)
--       11-history-notifications.md F-11-06 *"Enterprise 커스텀 보존: 휴지통 보관 최소 1일 ~ 최대 10년, 기본 30일"*
--
-- 키 하나 — `trash.custom_retention`(boolean). Enterprise 만 휴지통 보관 기간(`workspace.trash_days`)을 바꾼다. 값의 칸과 범위(1 ~ 3650)는
-- 초판에 있다(0001) — 이 조각은 줄만 더한다. 모든 요금제가 키를 같은 종류로 갖는다(`billing.db.test.ts` ①).

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'trash.custom_retention', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'false'::jsonb), ('business', 'false'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
