-- 권한의 저장 지점 — W6-b (F-06-01 · F-06-02 · F-06-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.3 `acl_entry` · `block_acl_meta`,
--       §3.11 `effective()` · `perm_scope_id`
--
-- ──────────────────────────────────────────────────────────────────────
-- 판결 C-7: 권한의 **유일한** 저장 지점이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 페이지에 컬럼을 하나 더 다는 방식(`is_public`, `shared_with`)을 쓰지 않는다.
-- 권한이 두 곳에 있으면 반드시 어긋나고, 어긋난 쪽이 더 관대하면 그게 사고다.
--
-- 규칙 A1: **`level='none'` 행은 존재하지 않는다.** 권한 회수는 행 DELETE 다.
--          deny 계층이 없다 — "허용의 합집합"만 있다. deny 를 넣으면 판정이
--          순서에 의존하게 되고, 그 순서는 문서에 적히지 않는다.
-- 규칙 A2: level 은 전순서가 아니다. 비교는 `level_capability` 를 거친다
--          (`create` 는 `view` 를 포함하지 않는다).
-- 규칙 A3: bot/agent 는 principal_type 값이 아니다. `user(type='bot')` 행으로
--          만들고 `principal_type='user'` 로 부여한다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 상속 차단(`block_acl_meta`)이 이 마이그레이션의 위험한 부분이다
-- ──────────────────────────────────────────────────────────────────────
--
-- 불변식 P1: `inherits_from_parent = FALSE` 인 노드는 **절단 시점의 상속 집합이
-- `acl_entry` 로 머티리얼라이즈되어 있어야** 한다. 정본의 경고 그대로 —
-- *"깨지면 '1명 제거'가 '전원 상실'이 된다."* 플래그만 내리고 상속분을 복사하지
-- 않으면, 페이지를 공유 해제하려던 사람이 자기 접근까지 잃는다.
--
-- 그래서 절단은 애플리케이션의 한 함수(`permissions/acl.ts` 의 `stopInheriting`)
-- 에서만 일어나고, 그 함수가 복사와 플래그를 같은 트랜잭션에서 한다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 기존 루트 페이지에 `workspace_everyone` 을 채운다
-- ──────────────────────────────────────────────────────────────────────
--
-- 지금까지는 "워크스페이스 멤버면 전부 볼 수 있다"가 **코드에 없는 규칙**이었다
-- (아무 검사도 하지 않았다). `effective()` 를 켜는 순간 ACL 이 없는 노드는
-- 아무도 못 보는 노드가 되므로, 그 암묵적 규칙을 **데이터로 옮긴다.**
-- 루트 페이지마다 `workspace_everyone → full_access` 행 하나. 이후 만들어지는
-- 루트 페이지는 `createPage` 가 같은 행을 넣는다.

CREATE TABLE acl_entry (
  id             uuid PRIMARY KEY,
  -- teamspace 는 아직 없다(§7). 값은 정본대로 열어 두되 지금 들어오는 것은 'block' 뿐이다.
  node_kind      text NOT NULL CHECK (node_kind IN ('block', 'teamspace')),
  node_id        uuid NOT NULL,
  principal_type text NOT NULL
                 CHECK (principal_type IN ('user', 'group', 'teamspace', 'workspace_everyone', 'public')),
  principal_id   uuid NULL,
  level          text NOT NULL
                 CHECK (level IN ('view', 'comment', 'edit_content', 'create', 'edit', 'full_access')),
  -- [확인필요] 6-6. workspace_everyone 에만 의미가 있다.
  hidden_from_search boolean NOT NULL DEFAULT false,
  granted_by     uuid NULL REFERENCES "user"(id),
  granted_at     timestamptz NOT NULL DEFAULT now(),

  -- 같은 주체에게 두 번 부여하지 않는다. 레벨 변경은 UPDATE 다.
  --
  -- ⚠ **`NULLS NOT DISTINCT` 가 없으면 이 제약은 정작 필요한 곳에서 안 걸린다.**
  -- 정본은 `UNIQUE (node_kind, node_id, principal_type, principal_id)` 라고만 적었는데,
  -- PostgreSQL 의 기본 동작은 "NULL 은 서로 다르다"이다. `principal_id` 가 NULL 인
  -- 주체가 바로 `workspace_everyone` 과 `public` — **가장 많이 쓰이고 가장 중복되기 쉬운
  -- 두 종류**다. 기본 동작대로 두면 같은 노드에 `workspace_everyone` 행을 몇 개든 넣을 수
  -- 있고, `ON CONFLICT … DO UPDATE` 로 짠 레벨 변경이 조용히 **행 추가**가 된다.
  -- (verify-schema 프로브가 이 구멍을 잡았다. 정본을 강화하는 쪽이라 문서는 고치지 않는다.)
  UNIQUE NULLS NOT DISTINCT (node_kind, node_id, principal_type, principal_id),
  -- 주체가 하나뿐인 종류(모두 · 공개)는 id 를 갖지 않는다. 반대도 마찬가지다 —
  -- `('user', NULL)` 이 들어오면 "아무 사용자나"가 되어 버린다.
  CONSTRAINT ck_acl_principal_id
    CHECK ((principal_type IN ('workspace_everyone', 'public')) = (principal_id IS NULL)),
  CONSTRAINT ck_acl_hidden_from_search
    CHECK (NOT hidden_from_search OR principal_type = 'workspace_everyone')
);

-- 판정은 "이 노드(와 조상들)의 행 전부"를 한 번에 읽는다 — `node_id = ANY(...)`.
CREATE INDEX ix_acl_entry_node      ON acl_entry (node_kind, node_id);
-- "이 사람이 볼 수 있는 것" 역방향 조회(사이드바 · 검색 스코프).
CREATE INDEX ix_acl_entry_principal ON acl_entry (principal_type, principal_id);

COMMENT ON TABLE acl_entry IS
  'C-7: 권한의 유일한 저장 지점. A1: level=none 행은 없다(회수 = DELETE, deny 계층 없음).
   A2: level 은 전순서가 아니다 — 비교는 level_capability 를 거친다.
   A3: bot/agent 는 user(type) 로 만들고 principal_type=user 로 부여한다.';

CREATE TABLE block_acl_meta (
  node_id              uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,
  inherits_from_parent boolean NOT NULL DEFAULT true,
  materialized_at      timestamptz NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- P1 을 표현 가능한 만큼 승격한다: 절단된 노드는 **머티리얼라이즈 시각이 있어야**
  -- 한다. 상속분을 복사하지 않고 플래그만 내린 행은 이 CHECK 에 걸린다.
  CONSTRAINT ck_block_acl_materialized
    CHECK (inherits_from_parent OR materialized_at IS NOT NULL)
);

COMMENT ON TABLE block_acl_meta IS
  'P1: inherits_from_parent=false 인 노드는 절단 시점의 상속 집합이 acl_entry 로
   머티리얼라이즈되어 있다(깨지면 "1명 제거"가 "전원 상실"이 된다).
   P2: 절단된 노드는 이후 조상 ACL 변경을 받지 않는다.
   P3: 절단은 되돌릴 수 있다(inherits:=true + 부모 유래 행 삭제).';

-- ── 기존 루트 페이지 백필 ──────────────────────────────────────────────
--
-- `parent_type='workspace'` 인 페이지가 루트다(B1: 재귀 종료는 teamspace·workspace).
-- 휴지통에 있는 것도 포함한다 — 복원했는데 아무도 못 보는 페이지가 되면 안 된다.
INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
SELECT gen_random_uuid(), 'block', b.id, 'workspace_everyone', NULL, 'full_access', b.created_by
  FROM block b
 WHERE b.type = 'page' AND b.parent_type = 'workspace';
