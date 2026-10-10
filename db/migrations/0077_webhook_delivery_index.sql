-- 웹훅의 배달 색인 — 히스토리 · 활동 4e-3조각 (F-11-19)
--
-- 정본: docs/research/00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 — 화면 ⓙ
--
-- 목록이 웹훅마다 "마지막 배달"(끝난 묶음 중 가장 최근 것)을 읽는다. 0076 에는 웹훅 id 로 찾는 색인이 모으는 묶음(부분 UNIQUE)뿐이라
-- 끝난 묶음을 찾으려면 표를 훑는다. 웹훅을 지울 때의 FK 연쇄(ON DELETE CASCADE)도 같은 이유로 훑는다 — 이 색인 하나로 둘 다.
--
-- 기존 행: 색인만 더한다.

CREATE INDEX ix_webhook_delivery_webhook ON webhook_delivery (webhook_id, finished_at DESC);
