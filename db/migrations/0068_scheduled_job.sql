-- 공용 스케줄러 — 히스토리 · 활동 4a-1조각 (F-11-03 의 버전 GC 가 첫 소비자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.10 [보강] 공용 스케줄러 — `scheduled_job` 하나 · §3.7 [보강] 버전 기록 ④
--       마스터 문서 §6 *"스케줄러는 하나만 만든다 — 리마인더 · 반복 템플릿 · 히스토리 GC · verification 만료 · resync 가 전부
--       '시각이 되면 실행'이다"*
--
-- "시각이 되면 실행"의 단일 행 큐. 워커가 `FOR UPDATE SKIP LOCKED` 로 때가 된 일을 잠그고 임대(`locked_until`)를 건 뒤 커밋하고, 일은
-- 그 바깥에서 한다. 끝나면 행을 지운다(주기 일은 같은 키로 다음 실행을 다시 넣는다). 실패하면 물러나고 다섯 번째에 멈춘다(`dead_at`).
--
-- 정본 DDL 에 더한 것: 없다 — 정본 [보강]이 이 표를 처음 적었다(4a-1). 표현 가능한 불변식은 CHECK · 부분 UNIQUE 로:
--   · `kind` 는 아는 일만 — 소비자가 들어올 때마다 이 목록을 마이그레이션으로 늘린다(모르는 일을 넣으면 워커가 처리하지 못해 죽는다)
--   · 살아 있는 일은 키마다 하나(부분 UNIQUE) — 주기 일이 둘 생기지 않는다
--   · 죽은 일은 임대를 쥐지 않는다
--
-- 기존 행: 없다(새 표).

CREATE TABLE scheduled_job (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  run_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 살아 있는 일은 키마다 하나 — 주기 일은 자기 이름을 키로 쓴다.
  dedupe_key text NULL,
  attempts int NOT NULL DEFAULT 0,
  -- 가져간 워커의 임대 — 지나면(워커가 죽었다) 다른 워커가 다시 가져간다.
  locked_until timestamptz NULL,
  last_error text NULL,
  -- 다섯 번 실패하면 멈춘다 — 지우지 않는다(사람이 본다).
  dead_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_scheduled_job_kind CHECK (kind IN ('version_gc')),
  CONSTRAINT ck_scheduled_job_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_scheduled_job_attempts CHECK (attempts >= 0),
  CONSTRAINT ck_scheduled_job_dead CHECK (dead_at IS NULL OR locked_until IS NULL)
);

CREATE UNIQUE INDEX ux_scheduled_job_dedupe ON scheduled_job (dedupe_key) WHERE dedupe_key IS NOT NULL AND dead_at IS NULL;
-- 워커가 때가 된 일을 찾는 질의의 모양이다.
CREATE INDEX ix_scheduled_job_due ON scheduled_job (run_at) WHERE dead_at IS NULL;

COMMENT ON TABLE scheduled_job IS
  '공용 스케줄러(정본 §3.10 [보강] · 4a-1) — 시각이 되면 실행할 일의 단일 행 큐. 끝나면 지운다 · 실패하면 물러난다 · 다섯 번째에 dead_at.';
