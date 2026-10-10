-- 물리 삭제 — 히스토리 · 활동 4b-2조각 (F-11-06 · 공용 스케줄러의 세 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 물리 삭제 · 상태 전이표의 마지막 행(`purged` → 물리 삭제)
--       §3.10 [보강] 공용 스케줄러 — "소비자가 들어올 때마다 kind 목록을 늘린다"
--
-- ① 일의 종류에 `trash_hard_delete` 를 더한다 — `purged_at` + 30일이 지난 묶음의 행을 지우는 주기 일이다.
-- ② data source 에도 블록과 같은 "지울 때가 된 purged" 색인을 둔다(블록은 0006 의 `ix_block_hard_del_due`). 워커가 찾는 질의의 모양이다.
-- ③ `trash_root_id` 의 부분 색인 — 묶음을 루트로 찾는 질의(물리 삭제의 "묶음이 모두 때가 됐는가" · 자동 비우기 · 되살리기 ·
--    영구 삭제)가 지금까지 블록 표를 훑었다. 휴지통에 있거나 purged 인 행만 이 칸이 있다(되살리면 NULL).
--
-- 기존 행: `scheduled_job` 에는 `version_gc` · `trash_purge` 만 있다 — 새 CHECK 를 그대로 지난다.

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind CHECK (kind IN ('version_gc', 'trash_purge', 'trash_hard_delete'));

CREATE INDEX ix_data_source_hard_del_due ON data_source (purged_at) WHERE lifecycle = 'purged';
CREATE INDEX ix_block_trash_root ON block (trash_root_id) WHERE trash_root_id IS NOT NULL;
