-- data source 휴지통 — 잔여 묶음 8e-3a조각 (F-04-23)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 `data_source` · [보강] 다중 data source ⑩ · §3.4 블록 수명주기(B2 · B3) · 판결 X-3
--       04-database-views.md F-04-23 *"원본 data source 삭제 → … '삭제됨' 상태. 복원 가능해야 함"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 소스를 지울 수 있게 되면 "소스가 살아 있는가"를 물을 칸이 필요하다
-- ──────────────────────────────────────────────────────────────────────
--
-- 노션은 data source 를 휴지통으로 보내고 되살린다(*"select ••• to Move to Trash"*). 지금까지 data source 는 주인 데이터베이스와 함께
-- 사라질 뿐 스스로의 상태가 없었다. 그래서 블록과 **같은 세 값**(`block_lifecycle` — live · trashed · purged)과 같은 시각 열을 준다.
--
-- X-3 은 이것과 부딪히지 않는다 — X-3 은 **블록**의 수명주기 축을 `type='page'` 로 좁힌 판결이고, data source 는 블록이 아니다.
-- 행(`type='page'` 블록)은 여전히 블록의 휴지통을 쓴다: 소스를 휴지통에 넣는 명령이 그 행들을 **소스 id 를 삭제 루트로** 함께 넣는다
-- (`trash_root_id = data_source.id` — B3 의 "복원 범위 = 그 루트의 것"이 그대로 맞물린다. 따로 먼저 지운 행은 제 루트를 가져 남는다).
--
-- ──────────────────────────────────────────────────────────────────────
-- 불변식 DSL1 — 살아 있지 않은 data source 에는 살아 있는 행이 없다
-- ──────────────────────────────────────────────────────────────────────
--
-- 행의 읽기 경로(검색 · 관계형 칩 · 최근 방문 · 행 주소 · 멘션)는 **행 블록의 lifecycle** 만 본다. 소스가 휴지통인데 행이 살아 있으면
-- 그 길들로 행이 새어 나온다 — 휴지통 목록에서 행 하나만 되살리는 길(`restorePage`)이 그 구멍이다. 명령이 먼저 거부하지만(같은 질문을
-- 먼저 묻는다) 표가 막는다: **지연 제약 트리거**가 커밋 때 두 방향을 본다 — 살아 있는 행이 생기거나 옮겨질 때 그 소스가 살아 있는가,
-- 소스가 살아 있지 않게 될 때 그 소스에 살아 있는 행이 남았는가. 지연이라 "소스와 행을 한 트랜잭션에서 함께 옮기기"는 순서와 상관없이
-- 지나간다.
--
-- 기존 행: 모든 data source 가 'live' 로 시작한다(DEFAULT) — CHECK 과 트리거를 그대로 지난다.

ALTER TABLE data_source
  ADD COLUMN lifecycle   block_lifecycle NOT NULL DEFAULT 'live',
  ADD COLUMN trashed_at  timestamptz NULL,
  ADD COLUMN trashed_by  uuid NULL REFERENCES "user"(id),
  ADD COLUMN purge_after timestamptz NULL,          -- trashed_at + workspace.trash_days
  ADD COLUMN purged_at   timestamptz NULL;

-- 블록의 `ck_lifecycle_ts` 와 같은 모양 — 휴지통이면 만료 시각까지 있어야 한다(목록이 "N일 남음"을 그린다).
ALTER TABLE data_source
  ADD CONSTRAINT ck_data_source_lifecycle CHECK (
       (lifecycle = 'live'    AND trashed_at IS NULL     AND purge_after IS NULL     AND purged_at IS NULL)
    OR (lifecycle = 'trashed' AND trashed_at IS NOT NULL AND purge_after IS NOT NULL AND purged_at IS NULL)
    OR (lifecycle = 'purged'  AND trashed_at IS NOT NULL AND purged_at IS NOT NULL));

-- 휴지통 목록이 읽는 모양(블록의 `ix_block_trash` 와 같다).
CREATE INDEX ix_data_source_trash ON data_source (trashed_at DESC) WHERE lifecycle = 'trashed';

-- ── DSL1 ─────────────────────────────────────────────────────────────

CREATE FUNCTION data_source_rows_follow_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_id uuid;
  source_state block_lifecycle;
BEGIN
  IF TG_TABLE_NAME = 'block' THEN
    -- 커밋 시점의 상태로 묻는다 — 같은 트랜잭션에서 다시 바뀌었으면 지금의 값이 답이다.
    SELECT b.parent_id INTO source_id FROM block b
     WHERE b.id = NEW.id AND b.type = 'page' AND b.parent_type = 'data_source' AND b.lifecycle = 'live';
    IF source_id IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT ds.lifecycle INTO source_state FROM data_source ds WHERE ds.id = source_id;
    IF source_state IS NOT NULL AND source_state <> 'live' THEN
      RAISE EXCEPTION '살아 있지 않은 data source 에 살아 있는 행이 있다 (DSL1 — 행 %, data_source %)', NEW.id, source_id
        USING ERRCODE = '23514', CONSTRAINT = 'tg_data_source_rows_follow';
    END IF;
    RETURN NULL;
  END IF;

  SELECT ds.lifecycle INTO source_state FROM data_source ds WHERE ds.id = NEW.id;
  IF source_state IS NULL OR source_state = 'live' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM block b
              WHERE b.parent_id = NEW.id AND b.parent_type = 'data_source' AND b.type = 'page' AND b.lifecycle = 'live') THEN
    RAISE EXCEPTION '살아 있지 않은 data source 에 살아 있는 행이 남았다 (DSL1 — data_source %)', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'tg_data_source_rows_follow';
  END IF;
  RETURN NULL;
END $$;

-- 행이 살아나거나 · 만들어지거나 · 다른 소스로 옮겨질 때.
CREATE CONSTRAINT TRIGGER tg_data_source_rows_follow
  AFTER INSERT OR UPDATE OF lifecycle, parent_id, parent_type ON block
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.type = 'page' AND NEW.parent_type = 'data_source' AND NEW.lifecycle = 'live')
  EXECUTE FUNCTION data_source_rows_follow_check();

-- 소스가 살아 있지 않게 될 때.
CREATE CONSTRAINT TRIGGER tg_data_source_rows_follow_source
  AFTER UPDATE OF lifecycle ON data_source
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.lifecycle <> 'live')
  EXECUTE FUNCTION data_source_rows_follow_check();
