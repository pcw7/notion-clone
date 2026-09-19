-- 멘션의 역인덱스 — 코멘트 5a조각 (F-07-08 자동완성의 뒷면 · F-07-09 백링크 · F-05-09 멘션 알림)
--
-- 정본: docs/research/00-canonical-data-model.md §3.9 `[추가] link_edge` (불변식 L1~L3)
--       07-search-navigation.md F-07-08 · F-07-09 · 05-collaboration-sync.md F-05-09
--
-- ──────────────────────────────────────────────────────────────────────
-- 프로젝터만 쓴다 (L1) — "에디터가 만들 때 기록"하지 않는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 마스터 문서 §5.2 의 문장은 *"에디터가 mention 노드를 만들 때 역인덱스를 함께 기록한다"* 인데, 정본 X-1 이 이긴다.
-- 본문의 정본은 Y.Doc 이고 행은 그 투영이다. 에디터가 따로 기록하면 진실이 둘이 된다 — 동시 편집으로 멘션이 지워졌는데
-- 행이 남거나, 오프라인에서 넣은 멘션은 행이 없다. 그래서 `block` 행 · `search_document` 와 **같은 자리**에서, 같은
-- 트랜잭션으로 투영한다(`src/lib/block/link-edges.ts` · `save-page-body.ts`).
--
-- ──────────────────────────────────────────────────────────────────────
-- `source_block_id` · `target_id` 에 FK 를 걸지 않는다
-- ──────────────────────────────────────────────────────────────────────
--
-- 본문 블록 행은 투영이라 아직 없거나 이미 지워져 있다(§3.3-125 — `discussion.parent_block_id` 와 같다). 대상은
-- 다형(페이지 · 사람)이고, 지워진 페이지 · 나간 사람을 가리키는 멘션은 노드가 남되 "삭제됨"으로 그린다(07 F-07-08 엣지
-- 표) — 조회가 거른다. `source_page_id` 는 페이지 블록이라 FK 가 성립하고, 페이지가 물리 삭제되면 함께 간다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 차분으로 쓴다 (L3)
-- ──────────────────────────────────────────────────────────────────────
--
-- 페이지의 edge 를 통째로 지우고 다시 넣으면 `created_at` 이 매 투영마다 새로 찍혀 "새로 생긴 멘션"을 가려낼 수 없고,
-- 그러면 같은 사람에게 투영마다 알림이 간다. 넣을 것과 지울 것만 쓴다 — 새로 넣은 사람 멘션이 곧 알림 대상이다.

CREATE TABLE link_edge (
  source_page_id  uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  source_block_id uuid NOT NULL,                              -- 본문 블록. FK 없음(머리말)
  target_kind     text NOT NULL CHECK (target_kind IN ('page', 'user')),
  target_id       uuid NOT NULL,                              -- 다형. FK 없음(머리말)
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_block_id, target_kind, target_id)
);

-- 백링크 · "누가 나를 멘션했나" — 대상에서 출발한다.
CREATE INDEX ix_link_edge_target ON link_edge (target_kind, target_id, source_page_id);
-- 투영이 페이지 단위로 지금 edge 를 읽어 차분을 낸다.
CREATE INDEX ix_link_edge_source_page ON link_edge (source_page_id);

COMMENT ON TABLE link_edge IS
  'L1: 프로젝터만 쓴다 — Y.Doc 의 멘션 노드가 투영될 때 갱신된다(X-1). 에디터가 따로 기록하지 않는다.
   L2: 트리(하위 페이지 참조)는 여기 없다 — block.parent_id 가 정본이다. 이 그래프는 순환해도 된다.
   L3: 투영 한 번에 새로 생긴 (페이지, 사람) 당 알림 하나. 통째로 갈아 끼우지 않고 차분으로 쓴다.';
