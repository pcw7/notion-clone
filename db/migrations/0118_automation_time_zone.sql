-- 자동화를 저장한 사람의 시간대 — 자동화 조건의 상대 날짜 트랙 A-1 (F-08-09 · F-04-09)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 R-1] ④ — "받으려면 실행 주체(만든 사람)의 시간대를 저장해야 한다 — 뒤로" 를 연다.
--
-- 트리거의 조건이 상대 날짜(지난 1주 안 · 이번 주 …)면 "오늘" 이 필요한데, 판정하는 워커에는 보는 사람이 없다. 자동화를 **저장한 사람의
-- 시간대**(그 요청의 시간대 쿠키 `nc_tz` — 13번 트랙 B-3)를 자동화에 적어 두고 워커가 그 시간대의 오늘로 판정한다. 트리거를 다시 저장하면
-- 그 사람의 것으로 바뀐다(조건을 마지막으로 정한 사람의 날). 없으면(이 열 전의 자동화 · 버튼) UTC.
--
-- 값은 IANA 시간대 이름(앱이 `Intl` 로 걸러 넣는다 — 모르는 이름은 UTC). DB 는 모양만 막는다: 1 ~ 64자 · 영숫자와 `_ + - /` 만(따옴표 ·
-- 공백 · 세미콜론이 들어올 수 없다). 프로브는 verify-schema 의 자동화 절.
--
-- 기존 행: NULL — UTC 로 읽는다.

ALTER TABLE automation
  ADD COLUMN time_zone text NULL
  CONSTRAINT ck_automation_time_zone CHECK (time_zone IS NULL OR (length(time_zone) BETWEEN 1 AND 64 AND time_zone ~ '^[A-Za-z0-9_+/-]+$'));
