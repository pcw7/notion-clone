-- 공통 타입 · 리전 · 조직 · 워크스페이스
--
-- 정본: docs/research/00-canonical-data-model.md §3.0, §3.1
-- 이 파일은 정본 문서를 그대로 옮긴 것이다. 스키마를 바꿔야 한다면
-- 정본 문서를 먼저 고치고 판결 근거를 남긴 뒤 새 마이그레이션을 추가한다.

-- ── §3.0 공통 타입 ────────────────────────────────────────────────────
-- 이 마이그레이션에서 쓰지 않는 타입도 함께 만든다. 타입은 스키마의 어휘이고,
-- 뒤 마이그레이션들이 순서 상관없이 참조할 수 있어야 한다.

CREATE TYPE block_lifecycle   AS ENUM ('live', 'trashed', 'purged');                    -- <C-1/V-4>
CREATE TYPE block_parent_type AS ENUM ('workspace', 'teamspace', 'block', 'data_source'); -- <C-9/V-9>
CREATE TYPE origin_kind       AS ENUM ('native', 'external');                           -- <15 R1/R2/R3>
CREATE TYPE moderation_state  AS ENUM ('none', 'reported', 'restricted', 'taken_down', 'reinstated'); -- <17 1.4>
CREATE TYPE user_type         AS ENUM ('person', 'bot', 'agent');                       -- <PM 규칙 A3>
CREATE TYPE user_status       AS ENUM ('active', 'suspended', 'deleted');               -- <14 R-3>

-- ── §3.1 리전 ─────────────────────────────────────────────────────────

CREATE TABLE region (                                   -- <17 F-17-05> 중앙 1개 테이블
  id           text PRIMARY KEY,                        -- 'us', 'eu', ...
  display_name text  NOT NULL,
  endpoints    jsonb NOT NULL                           -- {db, search, vector, blob, kafka} 리소스 매핑
);
COMMENT ON TABLE region IS
  '불변식 RG1: 모든 파생 저장소 접근은 region_of(workspace_id) 헬퍼를 거친다. 엔드포인트 상수 하드코딩 금지.';

-- workspace.region_id 가 NOT NULL 이므로 최소 1개 리전이 있어야 워크스페이스를 만들 수 있다.
-- 스키마 계약의 일부이므로 여기서 넣는다. 운영 리전은 별도 마이그레이션으로 추가한다.
INSERT INTO region (id, display_name, endpoints) VALUES
  ('local', '로컬 개발', '{"db": "localhost:5432", "blob": "local", "search": "postgres"}'::jsonb);

-- ── §3.1 조직 ─────────────────────────────────────────────────────────

CREATE TABLE organization (                             -- <17: 정본 엔티티로 승격>
  id                           uuid PRIMARY KEY,
  name                         text   NOT NULL,
  -- DNS 검증됨. managed user / SAML / domain claim 의 전제 <14 R-6>
  verified_domains             text[] NOT NULL DEFAULT '{}',
  default_new_workspace_region text REFERENCES region(id),
  created_at                   timestamptz NOT NULL
);

-- ── §3.1 워크스페이스 ─────────────────────────────────────────────────

CREATE TABLE workspace (
  id                    uuid PRIMARY KEY,
  name                  text NOT NULL,
  icon                  jsonb,
  organization_id       uuid NULL REFERENCES organization(id),  -- <17> NULL = 개인/무료
  region_id             text NOT NULL REFERENCES region(id),    -- <17 F-17-05> 소급 불가 축
  migration_state       text NOT NULL DEFAULT 'stable'
                        CHECK (migration_state IN ('stable', 'migrating_out', 'migrating_in')),
  plan_code             text NOT NULL DEFAULT 'free',           -- 파생 캐시. 정본은 billing_subscription
  allowed_email_domains text[] NOT NULL DEFAULT '{}',           -- 자기신고. 자동가입 트리거 <14 R-6>
  analytics_enabled     boolean NOT NULL DEFAULT true,          -- <17 F-17-03>
  trash_days            int NOT NULL DEFAULT 30
                        CHECK (trash_days BETWEEN 1 AND 3650),  -- <C-1 상수>
  version_history_days  int NULL,                               -- NULL = 무제한 <C-12>
  acl_epoch             bigint NOT NULL DEFAULT 0,              -- <U-3> 권한 캐시 세대. Redis 미러
  created_at            timestamptz NOT NULL,
  deleted_at            timestamptz NULL
);

CREATE INDEX ix_workspace_organization
  ON workspace (organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON TABLE workspace IS
  '불변식 W1: region_id 는 region_migration_job 을 거치지 않고 변경할 수 없다. <17 F-17-07>
   불변식 W2: allowed_email_domains(자기신고) 와 organization.verified_domains(DNS검증) 는
              절대 합치지 않는다. 전자는 자동가입, 후자는 계정 소유권. <14 R-6>
   불변식 W3: 단독 owner 의 계정 삭제는 워크스페이스 삭제를 연쇄시킨다. <14 R-15>';
