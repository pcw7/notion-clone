-- 공개 링크 만료의 요금제 — §7 정리 10n-50 (F-06-08 · F-06-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 ⑬ [보강 10n-50] · §3.10 [보강] 엔타이틀먼트(키는 소비자가 생길 때 더한다)
--       06-sharing-permissions.md *"만료는 유료 플랜 기능"*
--
-- 키 하나 — `publish.link_expiry`(boolean). Plus · Business · Enterprise 만 공개 링크의 만료(`public_link.expires_at`)를 정한다. 공유 패널의
-- 설정 명령이 정할 때 묻는다(허락하지 않으면 `plan_required`) — 지우기는 요금제와 무관하다. 모든 요금제가 키를 같은 종류로 갖는다
-- (`billing.db.test.ts` ①).

INSERT INTO plan_entitlement (plan_id, key, kind, value)
SELECT p.id, 'publish.link_expiry', 'boolean', v.value
  FROM plan p
  JOIN (VALUES ('free', 'false'::jsonb), ('plus', 'true'::jsonb), ('business', 'true'::jsonb), ('enterprise', 'true'::jsonb)) AS v(code, value)
    ON v.code = p.code;
