-- 뷰별 · 그룹별 수동 행 순서 — 보드 4a조각 (F-04-03 Board · F-04-11 Group by)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `row_position` · 불변식 VW3
--       04-database-views.md F-04-03 ("그룹 내 순서는 row_page.position 하나로 표현 불가 → row_position 별도 테이블 필수")
--
-- 마스터 문서 §5.2 4번: *"드롭 = '셀 값 + 순서' 2 mutation 을 **서버 단일 API** 로"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 순서는 (뷰, 그룹) 마다 따로다 — `block.order_key` 로 대신할 수 없다
-- ──────────────────────────────────────────────────────────────────────
--
-- 같은 행이 보드 A 의 "진행 중" 열에서는 맨 위, 보드 B 의 같은 열에서는 맨 아래일 수 있다. 트리 순서
-- (`block.order_key`)는 하나뿐이라 그것을 표현할 수 없다 — 정본 C-3 경계 선언: *"뷰별 수동 순서와 트리 순서는
-- 별개 축이며 서로를 대체하지 않는다."*
--
-- `group_key` 의 뜻은 애플리케이션이 정한다(`src/lib/database/group.ts`): select 는 옵션 id, checkbox 는 'true' ·
-- 'false', **빈 값 그룹은 ''** — 정본의 `DEFAULT ''` 가 그 자리다. 뷰가 그룹을 갖지 않으면 쓰지 않는다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 자리가 없는 행이 정상이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 새 행 · 다른 열에서 옮겨 온 적 없는 행은 여기 행이 없고, 열 안에서 **자리 있는 행 뒤에 트리 순서로** 놓인다.
-- 열마다 모든 행의 자리를 미리 채우면 행 하나를 만들 때 뷰 수만큼 INSERT 가 생긴다. 사용자가 그 행을 어딘가로
-- 끌어 놓을 때 그 열의 자리 없는 행들만 그 자리까지 채운다(`group.ts` `materializePositions`).
--
-- 정렬(`view.sorts`)이 걸린 뷰에서는 이 표를 **읽지 않는다** — 정렬이 순서를 정하고, 드롭은 셀 값만 바꾼다.
-- 노션도 정렬이 걸린 보드에서는 열 안 순서를 끌어 옮길 수 없다.

CREATE TABLE row_position (
  view_id   uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  group_key text NOT NULL DEFAULT '',
  row_id    uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  order_idx text NOT NULL,

  PRIMARY KEY (view_id, group_key, row_id),
  CONSTRAINT ck_row_position_order CHECK (length(order_idx) > 0)
);
-- fractional index 는 이진 순서를 전제한다(마이그레이션 0008 과 같은 이유).
ALTER TABLE row_position ALTER COLUMN order_idx TYPE text COLLATE "C";
CREATE INDEX ix_row_position_order ON row_position (view_id, group_key, order_idx);

COMMENT ON TABLE row_position IS
  '정본 §3.6. 뷰별 · 그룹별 수동 순서. group_key 의 뜻은 group.ts 가 정한다 — 빈 값 그룹은 ''''.
   자리 없는 행이 정상이고(자리 있는 행 뒤 · 트리 순서), 정렬이 걸린 뷰는 이 표를 읽지 않는다.';

-- ──────────────────────────────────────────────────────────────────────
-- `view.type` 을 CHECK 으로 승격한다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 §3.6 이 주석으로 열거한 10종이다. 0015 는 주석으로만 남겼는데, 이제 두 번째 타입(board)이 들어오므로
-- "표현 가능한 불변식은 승격한다"(CLAUDE.md)를 따른다. 애플리케이션이 받는 것은 그 부분집합
-- (`MVP_VIEW_TYPES`)이고, 여기는 정본의 전체 집합이다 — 나중에 calendar 를 열 때 마이그레이션이 필요 없다.

ALTER TABLE view ADD CONSTRAINT ck_view_type CHECK (
  type IN ('table', 'board', 'list', 'calendar', 'timeline', 'gallery', 'chart', 'form', 'map', 'dashboard'));
