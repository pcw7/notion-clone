-- 검색의 팀스페이스 필터의 요금제 — 플랫폼 잔여 10a-3a조각 (F-07-03)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 [보강] 검색 필터 ⑥ · §3.10 [보강] 엔타이틀먼트(키는 소비자가 생길 때 더한다)
--       07-search-navigation.md F-07-03 *"Teamspace(Plus/Business/Enterprise 플랜 한정)"* · *"게이팅은 쿼리 빌더 단계에서"*
--
-- 키 하나 — `search.teamspace_filter`(boolean). Plus · Business · Enterprise 만 검색을 팀스페이스로 좁힌다. 검색 명령이 질의를 만들 때
-- 묻는다(허락하지 않으면 `plan_required` — 필터를 버리지 않는다). 모든 요금제가 키를 같은 종류로 갖는다(`billing.db.test.ts` ①).

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'search.teamspace_filter', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'true'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
