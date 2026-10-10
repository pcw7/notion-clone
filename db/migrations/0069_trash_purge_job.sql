-- 휴지통 자동 비우기 — 히스토리 · 활동 4b-1조각 (F-11-06 · 공용 스케줄러의 두 번째 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.4 [보강] 휴지통 자동 비우기 · 상태 전이표의 GC 행(`trashed` → `purged`)
--       §3.10 [보강] 공용 스케줄러 — "소비자가 들어올 때마다 kind 목록을 늘린다"
--
-- ① 일의 종류에 `trash_purge` 를 더한다 — `purge_after` 가 지난 휴지통 묶음을 `purged` 로 바꾸는 주기 일이다.
-- ② data source 에도 블록과 같은 "만료가 된 휴지통" 색인을 둔다(블록은 0006 의 `ix_block_purge_due`). 워커가 찾는 질의의 모양이다.
--
-- 기존 행: `scheduled_job` 에는 `version_gc` 만 있다 — 새 CHECK 를 그대로 지난다.

ALTER TABLE scheduled_job DROP CONSTRAINT ck_scheduled_job_kind;
ALTER TABLE scheduled_job ADD CONSTRAINT ck_scheduled_job_kind CHECK (kind IN ('version_gc', 'trash_purge'));

CREATE INDEX ix_data_source_purge_due ON data_source (purge_after) WHERE lifecycle = 'trashed';
