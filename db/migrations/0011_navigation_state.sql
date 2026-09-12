-- 내비게이션 상태 — W6-a (F-07-04 최근 방문 · F-07-16 즐겨찾기)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 "[추가] 내비게이션 상태"
--       (이 두 표는 정본 초판에 없었다. 이 마이그레이션과 같은 커밋에서 정본을 먼저 고쳤다.)
--
-- ──────────────────────────────────────────────────────────────────────
-- 이 표들은 권한의 저장 지점이 아니다
-- ──────────────────────────────────────────────────────────────────────
--
-- 판결 C-7: 권한의 유일한 저장 지점은 `acl_entry` 다. 여기에 행이 있다고 접근이
-- 생기지 않는다 — **조회할 때마다 `effective()` 로 다시 거른다.** 정본 F-07-04 의
-- 엣지 케이스가 그것을 명시한다: *"최근 방문한 페이지의 권한이 회수됨 → 목록에서
-- 즉시 제거(권한 필터를 조회 시점에 재적용)."*
--
-- 그래서 "볼 수 없게 된 페이지"의 행을 지우는 정리 작업이 필요 없다. 지우는 설계로
-- 갔다면 권한이 바뀔 때마다 모든 사용자의 목록을 손봐야 하고, 한 번 놓치면 제목이 샌다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 제목을 복사해 두지 않는다
-- ──────────────────────────────────────────────────────────────────────
--
-- F-07-04: *"페이지 제목 변경 → 목록은 현재 제목을 보여줘야 함 → 제목을 복사 저장하지
-- 말고 조인."* 목록이 짧아서(최근 N개 · 즐겨찾기 N개) 조인 비용이 문제되지 않는다.

CREATE TABLE recent_visit (
  user_id         uuid NOT NULL REFERENCES "user"(id),
  workspace_id    uuid NOT NULL REFERENCES workspace(id),
  -- type='page' 인 블록. FK 를 걸어 페이지가 물리 삭제되면 기록도 함께 사라진다 —
  -- 없는 페이지를 가리키는 항목이 목록에 남으면 클릭할 때마다 404 다.
  block_id        uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  last_visited_at timestamptz NOT NULL DEFAULT now(),
  visit_count     int NOT NULL DEFAULT 1,

  PRIMARY KEY (user_id, block_id),
  -- 같은 페이지를 오갈 때마다 행이 늘면 목록이 한 페이지로 가득 찬다. 재방문은 upsert 다.
  CONSTRAINT ck_recent_visit_count CHECK (visit_count > 0)
);

-- 목록 질의의 모양 그대로: 이 사용자의 이 워크스페이스에서 최근 순.
CREATE INDEX ix_recent_visit_recent ON recent_visit (user_id, workspace_id, last_visited_at DESC);

COMMENT ON TABLE recent_visit IS
  'F-07-04. 권한의 저장 지점이 아니다 — 조회 시점에 effective() 로 다시 거른다.
   제목은 복사하지 않고 block 과 조인한다(제목이 바뀌면 목록도 바뀌어야 한다).';

CREATE TABLE favorite (
  user_id      uuid NOT NULL REFERENCES "user"(id),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  block_id     uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  -- 사용자가 순서를 바꿀 수 있다(F-07-16). 블록 순서와 같은 fractional index 를 쓴다 —
  -- 정수 position 이면 하나를 끼울 때 뒤의 전부를 다시 써야 한다.
  order_key    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, block_id),
  CONSTRAINT ck_favorite_order_key CHECK (length(order_key) > 0)
);

-- ⚠ `order_key` 는 **이진 순서**로 비교되어야 한다(마이그레이션 0008 과 같은 이유).
--   DB collation 이 ICU + ko-KR 이라 기본 비교로는 'aZ' 가 'aa' 보다 뒤에 온다.
CREATE INDEX ix_favorite_order ON favorite (user_id, workspace_id, order_key COLLATE "C");
ALTER TABLE favorite ALTER COLUMN order_key TYPE text COLLATE "C";

COMMENT ON TABLE favorite IS
  'F-07-16. 사용자별 개인 목록. 권한의 저장 지점이 아니다(C-7).';
