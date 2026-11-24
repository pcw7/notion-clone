-- 표의 변경 기록 — X-5 1단계(서버) · DB 실시간 동기화 RT-1조각 (F-05-16 · F-05-06)
--
-- 정본: docs/research/00-canonical-data-model.md §3.7 `data_source_change` · [보강] X-5 의 단계 — 1단계(RT-1) · 판결 X-5
--       05-collaboration-sync.md F-05-16 *"10,000행 뷰에서 1행 변경 → 전체 재조회 금지 → 행 단위 델타"* ·
--       F-05-06 *"델타가 수천 op → 임계치 초과 시 델타 포기하고 snapshot"* · *"비교는 서버 시각만 신뢰"*
--
-- 0063 의 신호(`db_rows` — 표 id 하나 · "다시 읽어라")는 그대로 두고, 같은 트리거가 **무엇이 바뀌었나**를 표마다 쌓는다. 화면은 커서
-- 뒤의 기록만 물어 바뀐 행만 다시 받는다(`…/data-sources/[id]/changes/delta`).
--
-- ── 왜 카운터(`data_source.change_seq`)가 아니라 기록인가 ──
-- 정본은 gap 감지 축을 `data_source.change_seq`(쓰기마다 +1)로 두었다. 그러면 한 표의 모든 쓰기가 `data_source` **한 행의 잠금**에
-- 커밋까지 줄을 선다(HANDOFF 3zn). 기록은 넣기만 한다 — 쓰기끼리 같은 행을 고치지 않으므로 줄이 생기지 않는다.
--
-- ── 안전 지평(커서의 정확성은 이것 하나다) ──
-- `seq`(identity)의 차례는 **커밋 차례가 아니다** — A 가 10 을 받고 열린 채 B 가 11 을 받아 커밋할 수 있고, xid 가 앞선 트랜잭션이
-- 뒤의 seq 를 받을 수도 있다(C 가 xid 99 로 먼저 시작해 다른 쓰기를 하고 · A 가 xid 100 으로 seq 10 · C 가 seq 11 로 커밋). 그래서
-- 커서는 seq 가 아니라 **쓴 트랜잭션의 xid** 로 끊는다: 읽는 문장의 스냅샷에서 `pg_snapshot_xmin`(아직 돌고 있는 가장 오래된 xid) 아래의
-- 트랜잭션은 모두 끝났고(커밋됐으면 보인다) 앞으로 그 아래 xid 로 기록이 생기지 않는다. 읽기는 `after <= xid < 지평` 만 돌려주고
-- 다음 커서는 지평이다 — 빠지는 것도 두 번 오는 것도 없다(xid 는 트랜잭션의 최상위 것 · `pg_current_xact_id()`).
--
-- ── 지우기 ──
-- 보관 정리(`data_retention`)가 24시간이 지난 기록을 지우고, 표마다 지운 것 중 가장 큰 xid 를 `data_source_change_floor` 에 남긴다.
-- 커서가 그 아래면(지운 것을 넘겨야 한다) 델타 대신 "처음부터 다시 읽어라"(reset)다.
--
-- ── 비용 ──
-- 쓰기의 행마다 넣기 한 번(힙 + 인덱스 둘). FK 는 걸지 않는다 — 행 · 표가 지워진 뒤에도 기록은 남아야 하고(지운 것을 알린다), FK 검사의
-- KEY SHARE 잠금을 쓰기마다 `data_source` 한 행에 걸지 않는다. 같은 트랜잭션 · 같은 표 · 같은 종류 · 같은 대상은 한 줄(UNIQUE · 넣다가
-- 겹치면 버린다).
--
-- 기존 행: 해당 없음(기록은 지금부터 쌓인다 — 커서가 없는 화면은 처음부터 읽는다).

CREATE TABLE data_source_change (
  seq            bigint GENERATED ALWAYS AS IDENTITY,
  data_source_id uuid        NOT NULL,                          -- FK 없음(머리말 "비용")
  kind           text        NOT NULL,
  row_id         uuid        NULL,                              -- 행의 종류만 — 그 행(page.id)
  view_id        uuid        NULL,                              -- 뷰 · 보드 순서만 — 그 뷰
  xid            xid8        NOT NULL DEFAULT pg_current_xact_id(),  -- 쓴 트랜잭션(최상위) — 커서의 축(머리말 "안전 지평")
  at             timestamptz NOT NULL DEFAULT now(),            -- 지우기의 기준(24시간)
  CONSTRAINT pk_data_source_change PRIMARY KEY (seq),
  CONSTRAINT ck_data_source_change_kind CHECK (
    kind IN ('row_upsert', 'row_delete', 'position', 'reminder', 'schema', 'view', 'layout')
  ),
  -- 행의 종류는 행을, 아니면 행이 없다
  CONSTRAINT ck_data_source_change_row CHECK (
    (row_id IS NOT NULL) = (kind IN ('row_upsert', 'row_delete', 'position', 'reminder'))
  ),
  -- 뷰 · 보드 순서는 뷰를, 아니면 뷰가 없다
  CONSTRAINT ck_data_source_change_view CHECK (
    (view_id IS NOT NULL) = (kind IN ('view', 'position'))
  )
);

-- 읽기(표 · xid 범위)와 한 트랜잭션 안의 겹침 버리기를 함께 한다 — 인덱스 하나
CREATE UNIQUE INDEX ux_data_source_change_once ON data_source_change (data_source_id, xid, kind, row_id, view_id) NULLS NOT DISTINCT;

COMMENT ON TABLE data_source_change IS
  '정본 §3.7 [보강] X-5 의 단계 — 1단계(RT-1). 표의 변경 기록 — 쌓기만 한다. 커서는 xid 지평(pg_snapshot_xmin) · seq 가 아니다. 24시간 뒤 data_retention 이 지운다.';

-- 쌓기만 한다 — 고치지 않는다(지우는 것은 보관 정리뿐 · 표가 지워질 때도 남는다)
CREATE FUNCTION data_source_change_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'data_source_change 는 쌓기만 한다(append-only) — 고치지 않는다' USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER tg_data_source_change_append_only
  BEFORE UPDATE ON data_source_change
  FOR EACH ROW EXECUTE FUNCTION data_source_change_append_only();

-- 표마다 지운 기록의 가장 큰 xid — 커서가 이 아래면 지운 것을 넘겨야 하므로 reset
CREATE TABLE data_source_change_floor (
  data_source_id uuid        NOT NULL,
  purged_through xid8        NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_data_source_change_floor PRIMARY KEY (data_source_id)
);

COMMENT ON TABLE data_source_change_floor IS
  '정본 §3.7 [보강] X-5 의 단계 — 1단계(RT-1). 표마다 보관 정리가 지운 기록의 가장 큰 xid. 쓰기는 건드리지 않는다(보관 정리만 고친다).';

-- ── 0063 · 0067 · 0109 의 트리거 함수를 기록도 쌓도록 바꾼다(트리거는 그대로 · 신호도 그대로) ──

-- 기록 한 줄 + 0063 의 신호. 표가 없으면(NULL) 아무것도 하지 않는다.
CREATE FUNCTION db_rows_log(source uuid, change text, row_ref uuid, view_ref uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF source IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO data_source_change (data_source_id, kind, row_id, view_id) VALUES (source, change, row_ref, view_ref)
    ON CONFLICT DO NOTHING;
  PERFORM pg_notify('db_rows', source::text);
END $$;

-- ① 행 — 넣기 · 바꾸기는 그 행, 지우기 · 다른 표로 옮기기는 옛 표에서 빠진 것
CREATE OR REPLACE FUNCTION db_rows_notify_page() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM db_rows_log(OLD.data_source_id, 'row_delete', OLD.id, NULL);
  ELSIF TG_OP = 'UPDATE' AND OLD.data_source_id IS DISTINCT FROM NEW.data_source_id THEN
    PERFORM db_rows_log(OLD.data_source_id, 'row_delete', OLD.id, NULL);
    PERFORM db_rows_log(NEW.data_source_id, 'row_upsert', NEW.id, NULL);
  ELSE
    PERFORM db_rows_log(NEW.data_source_id, 'row_upsert', NEW.id, NULL);
  END IF;
  RETURN NULL;
END $$;

-- ② 행 블록 — 0063 과 같은 조건. 살아 있지 않게 되면(휴지통) 빠진 것 · 다른 표로 옮기면 옛 표에서 빠진 것
CREATE OR REPLACE FUNCTION db_rows_notify_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'page' AND NEW.parent_type = 'data_source'
     AND (OLD.lifecycle, OLD.order_key, OLD.properties, OLD.format, OLD.parent_id)
         IS DISTINCT FROM (NEW.lifecycle, NEW.order_key, NEW.properties, NEW.format, NEW.parent_id) THEN
    PERFORM db_rows_log(NEW.parent_id, CASE WHEN NEW.lifecycle = 'live' THEN 'row_upsert' ELSE 'row_delete' END, NEW.id, NULL);
    IF OLD.parent_type = 'data_source' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
      PERFORM db_rows_log(OLD.parent_id, 'row_delete', OLD.id, NULL);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ③ 속성 · 옵션 — 구조
CREATE OR REPLACE FUNCTION db_rows_notify_property() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_log(CASE WHEN TG_OP = 'DELETE' THEN OLD.data_source_id ELSE NEW.data_source_id END, 'schema', NULL, NULL);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION db_rows_notify_option() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_log((SELECT data_source_id FROM property
                        WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.property_id ELSE NEW.property_id END)),
                      'schema', NULL, NULL);
  RETURN NULL;
END $$;

-- ④ 뷰 — 그 뷰 · ⑤ 보드의 손으로 둔 순서 — 그 뷰의 그 행
CREATE OR REPLACE FUNCTION db_rows_notify_view() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM db_rows_log(OLD.data_source_id, 'view', NULL, OLD.id);
  ELSE
    PERFORM db_rows_log(NEW.data_source_id, 'view', NULL, NEW.id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION db_rows_notify_row_position() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target row_position;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM db_rows_log((SELECT data_source_id FROM view WHERE id = target.view_id), 'position', target.row_id, target.view_id);
  RETURN NULL;
END $$;

-- 레이아웃(0067) — 표 하나
CREATE OR REPLACE FUNCTION db_rows_notify_page_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM db_rows_log(NEW.data_source_id, 'layout', NULL, NULL);
  RETURN NULL;
END $$;

-- 리마인더(0109) — 그 행
CREATE OR REPLACE FUNCTION db_rows_notify_reminder() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.page_id ELSE NEW.page_id END;
BEGIN
  PERFORM db_rows_log((SELECT data_source_id FROM page WHERE id = target), 'reminder', target, NULL);
  RETURN NULL;
END $$;
