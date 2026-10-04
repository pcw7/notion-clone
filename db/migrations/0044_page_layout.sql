-- 행의 레이아웃 — 잔여 묶음 8f-2조각 (F-16-03 · F-16-07)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 `page_layout` · `layout_tab` · `layout_module` · 불변식 T1 · M1 · M2 · M5 · M6
--       · [보강] 행의 레이아웃 — lazy 한 머리 · 속성 묶음의 순서와 숨김 · 판결 U-1(16 비준)
--       16-item-layout.md F-16-03 *"모듈 행은 기본 동작에서의 이탈만 기록한다(sparse 저장)"* · F-16-12 *"레코드가 없으면 기본 레이아웃"*
--
-- ──────────────────────────────────────────────────────────────────────
-- 왜 — 행 페이지의 속성 묶음에 숨기기가 들어온다
-- ──────────────────────────────────────────────────────────────────────
--
-- 8f-1 의 행 페이지는 속성을 스키마 순서로 모두 보였다. 숨기기는 데이터베이스의 모든 행에 공통인 화면 정의(레이아웃)다 — 뷰마다도
-- 행마다도 아니다(노션 *"A page layout will apply to all pages in the database"*). 정본의 세 표를 그대로 만든다.
--
-- **머리(`page_layout`)는 lazy 다** — data_source 당 최대 1행이고 없으면 기본 레이아웃(모두 보임 · 스키마 순서)이다. 그래서 이미 있는
-- 소스에 되채우지 않고, 소스를 만드는 길(`createDatabase` · `addDataSource`)도 고치지 않는다. 처음으로 기본에서 벗어날 때 머리 · content
-- 탭 · heading · property_group 을 한 트랜잭션에서 함께 만든다(`database/layout.ts` 한 곳).
--
-- ──────────────────────────────────────────────────────────────────────
-- 정본 DDL 에 더한 것 — 표현할 수 있는 불변식을 표로 올린다
-- ──────────────────────────────────────────────────────────────────────
--
-- ① M1 의 "tab 당 1개 · area='heading' 고정" — 부분 UNIQUE 와 CHECK. 정본은 그룹(M2)만 인덱스로 올려 두었다.
-- ② `order_idx` 는 property 행에서만 NULL 이다 — 속성 묶음 안의 순서는 `property.order_idx`(스키마 순서)이고 레이아웃 전용 순서를 두지
--    않는다(16 F-16-03 클론 대안). 숨김 행은 순서를 갖지 않는다. 다른 종류의 모듈은 자기 순서가 있어야 한다.
-- ③ 같은 소스 · 같은 탭 — 복합 FK 셋. 모듈의 탭 · 모듈의 속성이 모듈과 같은 소스여야 하고, 부모 모듈은 같은 탭이어야 한다. 정본은
--    `data_source_id` 를 탭 · 모듈에 따로 적고 맞는지를 말하지 않았다 — 어긋나면 한 소스의 레이아웃에 남의 속성이 서고, 그 속성을 지워도
--    (`property_id` 의 단일 FK 는 지우지만) 소스를 지울 때 엉뚱한 쪽의 CASCADE 를 탄다.
--
-- "적어도 1개"(T1 · M1 · M2 — 머리가 있으면 content 탭 · heading · 그룹이 하나씩)는 만드는 함수 하나가 지킨다. 그것들을 지우는 길은
-- 없다(소스의 영구 삭제 CASCADE 뿐).
--
-- 기존 행: 없다(새 표).

-- 복합 FK 의 대상 — `property.id` 는 이미 PK 라 이 UNIQUE 는 늘 참이다. FK 가 (id, data_source_id) 쌍을 가리키려면 그 쌍의 UNIQUE 가 있어야 한다.
ALTER TABLE property ADD CONSTRAINT ux_property_source UNIQUE (id, data_source_id);

CREATE TABLE page_layout (
  data_source_id uuid PRIMARY KEY REFERENCES data_source(id) ON DELETE CASCADE,
  structure text NOT NULL DEFAULT 'simple',
  backlinks_mode text NOT NULL DEFAULT 'hover',
  inline_comment_mode text NOT NULL DEFAULT 'default',
  show_discussions boolean NOT NULL DEFAULT true,
  show_property_icons boolean NOT NULL DEFAULT true,
  full_width boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES "user"(id),
  -- 낙관적 잠금. 레이아웃은 CRDT 대상이 아니다(16 R10). 머리가 없으면 화면은 0 으로 읽는다 — 첫 저장이 1 이다.
  version bigint NOT NULL DEFAULT 1,

  CONSTRAINT ck_page_layout_structure CHECK (structure IN ('simple', 'tabbed')),
  CONSTRAINT ck_page_layout_backlinks CHECK (backlinks_mode IN ('always', 'hover', 'off')),
  CONSTRAINT ck_page_layout_inline_comment CHECK (inline_comment_mode IN ('default', 'minimal')),
  CONSTRAINT ck_page_layout_version CHECK (version >= 1)
);

CREATE TABLE layout_tab (
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NULL,
  icon jsonb NULL,
  view_id uuid NULL REFERENCES view(id) ON DELETE CASCADE,
  relation_property_id text NULL REFERENCES property(id) ON DELETE SET NULL,   -- text [X-12]
  order_idx text COLLATE "C" NOT NULL,

  CONSTRAINT ck_layout_tab_kind CHECK (kind IN ('content', 'linked_view')),
  CONSTRAINT ck_layout_tab_view CHECK ((kind = 'content' AND view_id IS NULL) OR (kind = 'linked_view' AND view_id IS NOT NULL)),
  -- ③ 모듈의 (탭, 소스) 쌍이 가리킬 자리.
  CONSTRAINT ux_layout_tab_source UNIQUE (id, data_source_id)
);
-- 불변식 T1: 머리가 있으면 content 탭은 정확히 1개 — 이 인덱스는 "1개 이하", "적어도 1개"는 만드는 함수가.
CREATE UNIQUE INDEX layout_tab_one_content ON layout_tab (data_source_id) WHERE kind = 'content';

CREATE TABLE layout_module (            -- page_layout_slot 대체. 그 표는 존재하지 않는다
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  tab_id uuid NOT NULL REFERENCES layout_tab(id) ON DELETE CASCADE,
  kind text NOT NULL,
  area text NOT NULL,
  parent_module_id uuid NULL REFERENCES layout_module(id) ON DELETE CASCADE,
  property_id text NULL REFERENCES property(id) ON DELETE CASCADE,             -- text [X-12]
  label text NULL,
  visible boolean NOT NULL DEFAULT true,
  -- NULL = 자기 순서가 없다 — 그룹 안에서 스키마 순서(`property.order_idx`)를 따른다(②).
  order_idx text COLLATE "C" NULL,

  CONSTRAINT ck_layout_module_kind CHECK (kind IN ('heading', 'property_group', 'property', 'backlinks', 'section')),
  CONSTRAINT ck_layout_module_area CHECK (area IN ('heading', 'main', 'panel')),
  CONSTRAINT ck_layout_module_property CHECK ((kind = 'property') = (property_id IS NOT NULL)),
  -- ②
  CONSTRAINT ck_layout_module_order CHECK (kind = 'property' OR order_idx IS NOT NULL),
  -- ① M1 의 절반 — heading 은 heading 영역에만.
  CONSTRAINT ck_layout_module_heading_area CHECK (kind <> 'heading' OR area = 'heading'),
  -- ③ 같은 소스 · 같은 탭. MATCH SIMPLE 이라 속성 · 부모가 없는(NULL) 행은 검사 밖이다.
  CONSTRAINT fk_layout_module_tab_source FOREIGN KEY (tab_id, data_source_id)
    REFERENCES layout_tab (id, data_source_id) ON DELETE CASCADE,
  CONSTRAINT fk_layout_module_property_source FOREIGN KEY (property_id, data_source_id)
    REFERENCES property (id, data_source_id) ON DELETE CASCADE,
  CONSTRAINT ux_layout_module_tab UNIQUE (id, tab_id),
  CONSTRAINT fk_layout_module_parent_tab FOREIGN KEY (parent_module_id, tab_id)
    REFERENCES layout_module (id, tab_id) ON DELETE CASCADE
);
-- ① 불변식 M1: heading 은 탭마다 하나.
CREATE UNIQUE INDEX layout_module_one_heading ON layout_module (tab_id) WHERE kind = 'heading';
-- 불변식 M2: property_group 은 탭마다 하나.
CREATE UNIQUE INDEX layout_module_one_group ON layout_module (tab_id) WHERE kind = 'property_group';
-- 한 속성은 한 탭에 한 번만 놓인다.
CREATE UNIQUE INDEX layout_module_prop_once ON layout_module (tab_id, property_id) WHERE property_id IS NOT NULL;

COMMENT ON TABLE page_layout IS
  '행 페이지의 화면 정의(16 L1). data_source 당 최대 1행 — 없으면 기본 레이아웃(모두 보임 · 스키마 순서)이다(정본 §3.6 [보강] 8f-2).';
COMMENT ON COLUMN layout_module.order_idx IS
  'NULL = 자기 순서가 없다 — 속성 묶음 안에서는 property.order_idx(스키마 순서)를 따른다. property 행만 NULL 일 수 있다.';
