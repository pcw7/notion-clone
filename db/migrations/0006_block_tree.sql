-- 블록 트리
--
-- 정본: docs/research/00-canonical-data-model.md §3.4
--       판결 C-1/V-4 · C-3/V-6 · C-9/V-9 · C-10 · X-1 · X-3 · X-7
--
-- 마스터 문서 경고: "01 블록 트리로 들어오는 화살표는 02 워크스페이스뿐이고,
-- 나가는 화살표는 8개다. 여기서 스키마를 틀리면 되돌리는 비용이 프로젝트 최대다."
--
-- 그래서 정본의 부정 요구사항(B6·B8·B9·B10 — "이 컬럼은 존재하지 않는다")도
-- 그대로 지킨다. 편해 보인다고 content[] 나 deleted_at 을 추가하면 판결이 무너진다.

-- 모든 콘텐츠의 단일 테이블. 페이지도 블록이고(type='page'),
-- 데이터베이스 행도 블록이다(type='page' AND parent_type='data_source').
CREATE TABLE block (
  id            uuid PRIMARY KEY,            -- v4, 클라이언트 생성(오프라인/낙관적 업데이트)
  workspace_id  uuid NOT NULL REFERENCES workspace(id),
  type          text NOT NULL,               -- 'page'|'paragraph'|'heading_1'|'column'|...

  -- 트리 <C-9, C-10>
  parent_type   block_parent_type NOT NULL,
  parent_id     uuid NOT NULL,               -- 다형 참조. DB FK 불가 -> 앱이 강제한다
                                             --   'block'       -> block(id)
                                             --   'data_source' -> data_source(id)
                                             --   'teamspace'   -> teamspace(id)
                                             --   'workspace'   -> workspace(id)
  order_key     text NOT NULL,               -- fractional index. 형제 정렬의 유일한 축.
                                             -- [X-1] parent_type='block' 이면 Y.Doc 에서 파생되는
                                             --       읽기 모델이다(프로젝터만 쓴다).
                                             --       그 외 3값이면 이 컬럼이 정본이다.
  ancestor_path uuid[] NOT NULL DEFAULT '{}',-- 루트->parent 까지의 block id 순서 배열 [X-7]
  owner_user_id uuid NULL REFERENCES "user"(id),  -- Private 루트일 때만 NOT NULL
  perm_scope_id uuid NOT NULL,               -- <C-8부속> 권한 재귀 종료점 + 검색 필터 키

  -- 내용 (parent_type='block' 인 비페이지 블록에서는 Y.Doc 파생 [X-1])
  properties    jsonb NOT NULL DEFAULT '{}', -- { title: RichText[], checked, language, ... }
  format        jsonb NOT NULL DEFAULT '{}', -- { block_color, code_wrap, column_ratio, ... }

  -- 수명주기 <C-1> [X-3: type='page' 인 블록에서만 'live' 이외의 값을 가진다]
  lifecycle     block_lifecycle NOT NULL DEFAULT 'live',
  trashed_at    timestamptz NULL,
  trashed_by    uuid NULL REFERENCES "user"(id),
  trash_root_id uuid NULL,                   -- 삭제 조작이 일어난 조상 id. 복원 범위의 유일한 근거
  trash_reason  text NOT NULL DEFAULT 'user'
                CHECK (trash_reason IN ('user', 'source_deleted', 'source_out_of_scope')),
  purge_after   timestamptz NULL,            -- trashed_at + workspace.trash_days
  purged_at     timestamptz NULL,

  -- 거버넌스 <17 1.4> lifecycle 과 직교
  moderation_state moderation_state NOT NULL DEFAULT 'none',
  public_exposure  boolean NOT NULL DEFAULT false,

  -- 감사 / 동시성
  created_by     uuid NULL REFERENCES "user"(id),   -- 익명 폼 제출 행은 NULL
  created_at     timestamptz NOT NULL,
  last_edited_by uuid NULL REFERENCES "user"(id),
  last_edited_at timestamptz NOT NULL,
  version        bigint NOT NULL DEFAULT 0,  -- [X-6] 페이지 단위 단조 변경 카운터

  CONSTRAINT ck_private_root   CHECK (owner_user_id IS NULL OR parent_type = 'workspace'),
  CONSTRAINT ck_lifecycle_page CHECK (type = 'page' OR lifecycle = 'live'),          -- [X-3]
  CONSTRAINT ck_lifecycle_ts   CHECK (
       (lifecycle = 'live'    AND trashed_at IS NULL     AND purged_at IS NULL)
    OR (lifecycle = 'trashed' AND trashed_at IS NOT NULL AND purged_at IS NULL AND trash_root_id IS NOT NULL)
    OR (lifecycle = 'purged'  AND trashed_at IS NOT NULL AND purged_at IS NOT NULL))
);

CREATE UNIQUE INDEX ux_block_sibling_order ON block (parent_id, order_key);
CREATE INDEX ix_block_children_live ON block (parent_id, order_key) WHERE lifecycle = 'live';
CREATE INDEX ix_block_trash         ON block (workspace_id, trashed_at DESC)
                                    WHERE lifecycle = 'trashed' AND type = 'page';
CREATE INDEX ix_block_purge_due     ON block (purge_after) WHERE lifecycle = 'trashed';
CREATE INDEX ix_block_hard_del_due  ON block (purged_at)   WHERE lifecycle = 'purged';
CREATE INDEX ix_block_ancestor      ON block USING gin (ancestor_path);
CREATE INDEX ix_block_perm_scope    ON block (workspace_id, perm_scope_id);
CREATE INDEX ix_block_moderation    ON block (workspace_id, moderation_state)
                                    WHERE moderation_state <> 'none';

-- 모든 일반 조회는 이 뷰만 본다.
-- 개별 쿼리에서 lifecycle 조건을 빼먹는 것이 1순위 버그다.
CREATE VIEW live_block AS SELECT * FROM block WHERE lifecycle = 'live';

COMMENT ON TABLE block IS
  'B1: 모든 블록은 parent 를 정확히 하나 가진다. 재귀 종료는 parent_type ∈ {teamspace, workspace}.
       data_source 는 종료가 아니라 경유(-> 부모 database 블록 -> 계속 상향).
   B2: 삭제 시 parent_id·order_key 를 절대 변경하지 않는다. 원위치 복원이 공짜가 된다.
       -> trash_entry 테이블은 존재하지 않는다.
   B3: 복원 범위 = 대상 + trash_root_id 가 대상 id 인 자손만.
   B4: 조상이 purged 인 노드를 복원하면 복원 실행자의 Private 루트로 재부모화하고 고지한다.
   B5: lifecycle 전파는 type=''page'' 인 자손에만. 비페이지 블록은 소속 Y.Doc 안에 있다.
   B6: content uuid[] 컬럼은 존재하지 않는다. 자식 목록은 parent_id 인덱스 + order_key.
   B7: 결정적 정렬은 ORDER BY order_key, id. ORDER_KEY_MAX_LEN=32 초과 시 형제 재균형.
   B8: block.space_id 는 존재하지 않는다. teamspace 소속은 ancestor_path 로 해석한다.
   B9: 외부 origin 행의 본문 블록은 언제나 native. block 에 origin 컬럼을 두지 않는다.
   B10: is_alive/alive/archived/deleted_at/position/order_idx/path 컬럼은 존재하지 않는다.';

COMMENT ON COLUMN block.order_key IS
  '[X-1] parent_type=''block'' 이면 Y.Doc 이 정본이고 이 컬럼은 프로젝터가 쓰는 파생이다.
   parent_type ∈ {data_source, teamspace, workspace} 이면 이 컬럼이 정본이다.
   프로젝터가 유일한 쓰기자이므로 UNIQUE(parent_id, order_key) 충돌이 구조적으로 발생하지 않는다.';
