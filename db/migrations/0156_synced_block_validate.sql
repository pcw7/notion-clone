-- 동기화 블록 CHECK 의 검증 — 58번 트랙 SB-1 (F-01-11)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강 SB-0] 나(SQL 스케치 — *"CHECK 는 NOT VALID 로 걸고 VALIDATE 를 따로(잠금이 짧다)"*)
--
-- 0155 가 `NOT VALID` 로 건 두 CHECK 이 기존 행을 훑어 검증한다. 이 파일은 따로 커밋된 트랜잭션이다(러너가 파일마다 하나) — VALIDATE 는
-- `SHARE UPDATE EXCLUSIVE` 라 훑는 동안 읽기 · 쓰기가 계속된다(0155 ③ — 개발 DB 3.3M행에서 함께 걸면 1.4초 동안 모두 멈췄다).
-- 어긋난 기존 행이 있으면 여기서 멈춘다 — 그 행을 고친 뒤 다시 돈다(지금은 없다: `synced_block` 행이 없고 `synced_from` 을 쓴 적이 없다).

ALTER TABLE block VALIDATE CONSTRAINT ck_synced_block_in_body;
ALTER TABLE block VALIDATE CONSTRAINT ck_synced_from_shape;
