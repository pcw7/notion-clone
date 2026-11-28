-- 세션의 기기 표시 — 아는 기기를 묻는 색인 · 해시만 받는 CHECK (AC-3 · F-14-08)
--
-- 정본: docs/research/00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] · DDL 의 user_session
--
-- 칸은 그대로다(⑭ "세션 표는 그대로다") — `device_id` 는 0002 부터 있었고 비어 있었다.
--
-- · 기기 표시는 브라우저 쿠키(`nc_device`)의 원문이 아니라 SHA-256(user_id ‖ 열쇠)의 앞 16바이트를 판 8 UUID 로 적은 것이다. 판 8 만
--   받는다 — 날 UUID(판 4)를 그대로 넣는 실수를 DB 가 막는다(그러면 쿠키 원문이 DB 에 남는다). 지금 있는 행은 모두 NULL 이다.
-- · 새 로그인마다 "그 사람의 지난 30일 세션에 같은 기기 표시가 있는가"를 묻는다. 사람 쪽 색인은 살아 있는 세션의 부분 색인뿐이라
--   스스로 끝낸 세션(로그아웃)까지 보는 이 질의는 표를 훑었다(개발 DB 90만 행에서 ~30ms · 로그인마다). 기기 표시가 있는 행만의 부분 색인이라
--   처음에는 비어 있다.

ALTER TABLE user_session
  ADD CONSTRAINT ck_user_session_device_id_derived
  CHECK (device_id IS NULL OR substr(device_id::text, 15, 1) = '8');

CREATE INDEX ix_user_session_device ON user_session (user_id, device_id) WHERE device_id IS NOT NULL;

COMMENT ON COLUMN user_session.device_id IS
  '기기 표시(AC-3) — 기기 쿠키 원문이 아니라 SHA-256(user_id ‖ 열쇠)의 앞 16바이트(판 8 UUID). 같은 브라우저라도 사람마다 다르다.
   device_offline_manifest.device_id 와 같은 축(C-11).';
