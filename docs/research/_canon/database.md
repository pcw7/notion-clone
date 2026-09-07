# 정본: 데이터베이스 저장 모델 (ARBITRATION / cluster: database-storage)

> 판결일: 2026-09-06 / 판사: arbiter:database-storage
> 입력: `_critique/coverage-critique.md` (C-2, C-4, C-5, C-6, C-15, V-2, V-7, V-10, U-1)
> 관련 문서: 03-database-core.md, 04-database-views.md, 09-api-integrations.md, 16-item-layout.md
> **이 문서는 데이터베이스 저장 모델에 대한 유일한 정답지다.** 03/04/09/16 의 해당 스키마 정의는 이 문서로 대체된다.

## 클러스터 경계

| 엔티티 | 소유 | 이 문서에서의 취급 |
|---|---|---|
| `database`, `data_source`, `database_data_source`, `property`, `select_option`, `page_property_value`, `relation_edge`, `property_dependency`, `derived_value` | **이 클러스터** | 정본 DDL 정의 |
| `view_property`, `row_position`, `view_user_override` | **이 클러스터** (C-6 배정분) | 정본 DDL 정의 |
| `page` (DB 행) | **분할** — DB 소유 컬럼은 이 문서, `block` 과의 연결은 **block-tree 클러스터의 C-3 / V-6 결정에 종속** | DB 소유 컬럼만 정의 |
| `view` (뷰 본체) | views 클러스터 | **참조만.** 단 C-6 이 건드리는 `frozen` 축 1개 컬럼만 이 문서가 규정 |
| `acl` | permissions 클러스터 (C-7) | 참조만. 04 의 `acl` 정의는 이 문서가 채택하지 않는다 |
| `block` | block-tree 클러스터 (C-10) | 참조만 |
| `page_layout`, `layout_tab`, `layout_module` | item-layout 클러스터 (16-item-layout.md) | **U-1 은 16 이 이미 해소했다.** 비준만 하고 재정의하지 않는다 |
| 삭제 상태 컬럼 | lifecycle 클러스터 (C-1 / V-4) | DDL 에서 `-- [C-1 종속]` 자리표시자로만 둔다 |

---

## 판결 요약

| 항목 | 채택 | 폐기 | 파급 |
|---|---|---|---|
| **C-2 / V-2** 행 셀 저장 | **EAV `page_property_value` + 타입별 사이드카 컬럼**, relation 은 **`relation_edge` 별도 테이블 필수** (03 + 09 합의안) | 04 `row_page.properties jsonb` 단일 컬럼, relation-in-jsonb | 04: F-04-02·03·09·10·11·16·23·24·26·27·28 전량 / 03: F-03-16·17 인덱스 절 |
| **C-2 보조** 읽기 성능 | `page.properties_cache jsonb` + `page.search_tsv` **파생 읽기 모델**(쓰기 금지, 트리거 갱신) | "JSONB 가 아니면 검색 벡터가 불가능하다"(04 L1329)는 전제 | 04 F-04-27, 07 인덱싱 파이프라인 |
| **C-3 참조** 행 테이블 이름 | 테이블명 **`page`** (03) | 04 `row_page` | 04 전량 식별자 치환. `REFERENCES block(id)` 여부는 block-tree C-3 판결에 종속 |
| **C-4 / V-7** property id 타입 | **`property.id text PRIMARY KEY`** — 21자 nanoid, **전역 유니크**. 단일 컬럼 FK 유지 | 03 `uuid PK`, 04 `PRIMARY KEY (data_source_id, id)` 복합 PK **양쪽 다 폐기** | 03 스키마·F-03-02·10·11·14 / 04 property·view_property / 09 F-09-16·17 / 16 layout_module |
| **V-7** 동명 프로퍼티 | **`UNIQUE (data_source_id, name)` 강제** (대소문자 구분, 정확 일치 해석기) | 04 의 무제약, 03 의 `[확인필요]` 태그 | 03 스키마 태그 제거 / 09 F-09-16 name 해석 규칙 |
| **C-5** data_source ↔ database | **`data_source.owner_database_id NOT NULL` 단일 소유 FK(03)** + **`database_data_source` 부착 조인 테이블(04)** 을 *서로 다른 축*으로 병존. `is_linked` 컬럼 제거(파생) | 04 의 "단일 FK 는 결함" 판정 / 03 의 조인 테이블 부재 **양쪽 다 폐기** | 03 `data_source` DDL·F-03-01 / 04 F-04-13·23 정정 각주 |
| **C-6** 뷰별 컬럼 설정 | **`view_property`(04 이름) 단일 테이블**, 03 의 컬럼 흡수, `position`→`order_idx` | 03 `view_property_config` 테이블 자체 | 03 F-03-16 / 04 F-04-12 |
| **C-6 부속** 컬럼 고정 | **`view.frozen_upto_property_id text NULL` 경계 포인터** | 03 의 `view_property.frozen boolean` 열별 플래그 (1차 출처 `Freeze up to column` 과 모델 불일치) | 03 F-03-16 / 04 F-04-02·12 |
| **C-15 / V-10** 필터 중첩 상한 | **`MAX_FILTER_DEPTH = 3`** (헬프센터 UI 기준). 쓰기 경로만 검증, **읽기 경로 무검증** | 03 한도표의 `2단계` 단정 | 03 L207·L992 / 04 F-04-09(이미 정합) / 09 F-09-16 |
| **U-1** `layout_tab` dangling FK | **16-item-layout.md 의 `page_layout`+`layout_tab`+`layout_module` 3테이블을 정본으로 비준** | 03 `page_layout_slot` 테이블 전체 삭제 | 03 F-03-16 DDL 블록 삭제 → 16 참조로 교체 |

---

## 웹 검증으로 확정한 사실 (판결 근거)

| # | 사실 | 원문 | 출처 |
|---|---|---|---|
| W1 | property `id` 는 **짧은 랜덤 문자열**이며 이름 변경에 불변. 일부 타입은 사람이 읽는 특수 id(`"title"`) | `An identifier for the property, usually a short string of random letters and symbols. Some automatically generated property types have special human-readable IDs (e.g. all Title properties have an id of "title")` | https://developers.notion.com/reference/property-object |
| W2 | data source 의 부모는 **정확히 1개**. 보통 database, 외부 동기화 소스만 다른 data source | `Most data sources are parented by a database (type: "database_id"). Some externally synced data sources can be parented by another data source (type: "data_source_id")` + 별도 `database_parent` 필드 | https://developers.notion.com/reference/data-source |
| W3 | database 는 `data_sources[]` **자식 목록**을 가진다 | `List of child data sources, each of which is a JSON object with an id and name` | https://developers.notion.com/reference/database |
| W4 | linked database = **다른 database 의 data source 를 현재 database 에 연결**. Manage Data Sources 의 `Linked` 섹션에 별도 표시, `X` 로 제거 | `you can choose to link an existing data source instead. That existing data source's pages will appear in your database` | https://www.notion.com/help/data-sources-and-linked-databases |
| W5 | data source 의 `properties` 는 **프로퍼티 이름을 키로 하는 객체** | `The key is the name of the property as it appears in Notion` | https://developers.notion.com/reference/data-source |
| W6 | 공개 API 필터 중첩 상한 **2단계** | `Nesting is supported up to two levels deep.` | https://developers.notion.com/reference/post-database-query-filter |
| W7 | 헬프센터(UI) 중첩 상한 **3단계** | `nested filter groups up to three layers deep` | https://www.notion.com/help/views-filters-and-sorts |
| W8 | 필터 group 배열 `maxItems: 100`, 쿼리당 페이지네이션 **10,000행 상한** | `This endpoint supports paginating through up to 10,000 results per query.` | https://developers.notion.com/reference/query-a-data-source |
| W9 | 필터의 `property` 는 **id 또는 name 둘 다** 허용 | `The name of the property as it appears in the database, or the property ID.` | https://developers.notion.com/reference/post-database-query-filter |
| W10 | 컬럼 고정은 **경계 지정**이지 열별 토글이 아니다 | `click the name of the column and click "Freeze up to column"` / `Unfreeze column` | https://www.notion.com/help/views-filters-and-sorts |

---

## 정본 스키마

```sql
-- =========================================================================
-- 0. 공통 규약
--    순서 컬럼은 전부 fractional index (text). 컬럼명은 order_idx 로 통일한다.
--    (C-10 의 컬럼명 4종 분산은 block-tree 클러스터 소관이나, 이 클러스터가
--     소유한 테이블 안에서는 order_idx 로 강제한다.)
--    삭제 상태 컬럼은 [C-1 종속] 자리만 잡고 타입은 lifecycle 클러스터가 확정한다.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. 컨테이너
-- -------------------------------------------------------------------------
CREATE TABLE database (
  id            uuid PRIMARY KEY,
  parent_block  uuid REFERENCES block(id),          -- [block-tree C-9 종속]
  title_rich    jsonb,
  icon          jsonb,
  cover         jsonb,
  is_inline     boolean NOT NULL DEFAULT true,
  is_full_width boolean NOT NULL DEFAULT false,
  is_locked     boolean NOT NULL DEFAULT false,      -- F-04-25 / F-03-22
  kind          text NULL,                           -- typed database (tasks|projects|skills)
  dependency_shift_mode text
    CHECK (dependency_shift_mode IN ('overlap_only','maintain_gap','never')),
  avoid_weekends boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  -- , 삭제 상태  [C-1 종속]
);

-- -------------------------------------------------------------------------
-- 2. 스키마 소유자. 소유(ownership)는 단일 FK — W2/W3 근거
-- -------------------------------------------------------------------------
CREATE TABLE data_source (
  id                    uuid PRIMARY KEY,
  owner_database_id     uuid NOT NULL REFERENCES database(id) ON DELETE CASCADE,
      -- API database_parent 에 대응. 외부 동기화 소스라도 최종 컨테이너는 항상 1개다.
  parent_data_source_id uuid NULL REFERENCES data_source(id),
      -- W2: 외부 동기화 data source 만 다른 data source 를 부모로 갖는다.
      -- 채우기 규칙은 external-sync 클러스터(15) 소관. 여기서는 컬럼만 예약한다.
  name                  text NOT NULL,
  schema_version        bigint NOT NULL DEFAULT 1,  -- stale 스키마 쓰기 차단 (F-03-02)
  unique_id_counter     bigint NOT NULL DEFAULT 0,  -- F-03-09. UPDATE...RETURNING 으로만 발급
  unique_id_prefix      text NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);

-- 부착(attachment). 소유와 다른 축이다 — W4 근거.
CREATE TABLE database_data_source (
  database_id    uuid NOT NULL REFERENCES database(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  order_idx      text NOT NULL,
  PRIMARY KEY (database_id, data_source_id)
);
-- 불변식 DS1: 모든 data_source 는 (owner_database_id, id) 부착 행을 정확히 1개 가진다
--            (data_source 생성 트랜잭션에서 함께 삽입).
-- 불변식 DS2: is_linked 는 컬럼이 아니라 파생값이다 →
--            is_linked(row) := (row.database_id <> data_source.owner_database_id)
--            04 의 is_linked boolean 컬럼은 owner_database_id 와 이중 진실이 되므로 폐기.
-- 불변식 DS3: 소유 행(database_id = owner_database_id) DELETE 금지.
--            linked 행 제거는 부착 해제(원본 무손상), 소유 행 제거는 data_source 삭제여야 한다.

-- -------------------------------------------------------------------------
-- 3. 프로퍼티 정의 — id 는 전역 유니크 짧은 문자열 (C-4 판결)
-- -------------------------------------------------------------------------
CREATE TABLE property (
  id             text PRIMARY KEY,     -- nanoid(21, base62). 전역 유니크. 이름 변경에 불변(W1)
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  type           property_type NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_idx      text NOT NULL,        -- 스키마 기본 순서 (뷰별 순서와 별개)
  deleted_at     timestamptz NULL,     -- soft delete (복원·undo, F-03-02)
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (data_source_id, name)        -- W5 근거. 확정 (V-7 판결)
);
CREATE INDEX ON property (data_source_id) WHERE deleted_at IS NULL;
-- 불변식 P1: data_source 당 type='title' 인 살아있는 property 는 정확히 1개.
-- 불변식 P2: property.id 는 어떤 경로로도 변경되지 않는다(rename 은 name 만 바꾼다).
-- 불변식 P3: API 직렬화 계층은 title 프로퍼티에 한해 별칭 "title" 을 수용/노출한다.
--            (W1 호환. 저장은 언제나 실제 id.)

CREATE TABLE select_option (
  id          uuid PRIMARY KEY,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       option_color NOT NULL,
  group_id    uuid NULL,                -- status 전용 그룹
  order_idx   text NOT NULL,
  UNIQUE (property_id, lower(name))     -- 1차 출처: Names must be unique (case-insensitive)
);

-- -------------------------------------------------------------------------
-- 4. 행. 테이블명은 page (row_page 폐기)
--    id 와 block 의 관계는 block-tree 클러스터 C-3 / V-6 판결에 종속.
-- -------------------------------------------------------------------------
CREATE TABLE page (
  id             uuid PRIMARY KEY,     -- [C-3 종속] REFERENCES block(id) 여부는 block-tree 판결
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  order_idx      text NOT NULL,        -- 데이터소스 기본 순서
  is_template    boolean NOT NULL DEFAULT false,  -- F-04-28 / F-03-21
  unique_seq     bigint NULL,          -- F-03-09
  created_by     uuid NULL,            -- 공개 폼 제출 시 NULL 허용 (F-04-18)
  created_at     timestamptz NOT NULL,
  edited_by      uuid NULL,
  edited_at      timestamptz NOT NULL,
  -- --- 파생 읽기 모델. 정본 아님. 애플리케이션 코드의 직접 쓰기 금지 ---
  properties_cache jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"<property_id>": <typed value>}
  search_tsv     tsvector,
  cache_version  bigint NOT NULL DEFAULT 0
  -- , 삭제 상태  [C-1 종속]
);
CREATE INDEX ON page (data_source_id, is_template);
CREATE INDEX ON page USING gin (search_tsv);
-- 불변식 R1: 모든 뷰 쿼리·API 쿼리는 기본 조건으로 is_template = false 를 강제한다.
-- 불변식 R2: properties_cache / search_tsv 는 page_property_value 변경 트리거로만 갱신된다.
--            읽기 최적화 전용이며 충돌 해소 대상이 아니다.

-- -------------------------------------------------------------------------
-- 5. 셀 값 — EAV 정본 (C-2 / V-2 판결)
-- -------------------------------------------------------------------------
CREATE TABLE page_property_value (
  page_id     uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  value       jsonb NOT NULL,          -- 타입별 판별 유니온 (정본)
  -- 정렬/필터/인덱싱용 타입별 사이드카. value 에서 파생, 같은 트랜잭션에서 동시 갱신
  num_value   numeric     NULL,
  text_value  text        NULL,
  date_start  timestamptz NULL,
  date_end    timestamptz NULL,
  bool_value  boolean     NULL,
  -- 출처 추적 (F-03-20 AI Autofill)
  filled_by   text NULL
    CHECK (filled_by IN ('user','ai','automation','template','import','external')),
  manually_overridden boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (page_id, property_id)
);
CREATE INDEX ON page_property_value (property_id, num_value)  WHERE num_value  IS NOT NULL;
CREATE INDEX ON page_property_value (property_id, date_start) WHERE date_start IS NOT NULL;
CREATE INDEX ON page_property_value (property_id, lower(text_value) text_pattern_ops)
                                                              WHERE text_value IS NOT NULL;
CREATE INDEX ON page_property_value (property_id, bool_value) WHERE bool_value IS NOT NULL;
-- 불변식 C1: 자동 메타 4종(created_time/created_by/last_edited_time/last_edited_by)과
--            unique_id 는 이 테이블에 행을 만들지 않는다 — page 테이블에서 투영한다.
--            formula/rollup 도 만들지 않는다 — derived_value 소관. (03 F-03-08 규칙 승계)
-- 불변식 C2: relation 값은 이 테이블에 저장하지 않는다. relation_edge 가 유일한 정본.
--            properties_cache 에만 렌더용 배열로 투영된다.

-- relation 은 반드시 별도 엣지 테이블 (C-2 판결의 핵심)
CREATE TABLE relation_edge (
  property_id  text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  from_page_id uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  to_page_id   uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  order_idx    text NOT NULL,          -- relation 셀 내 표시 순서 보존
  role         text NULL CHECK (role IN ('sub_item','dependency')),  -- F-03-18 self-relation
  PRIMARY KEY (property_id, from_page_id, to_page_id)
);
CREATE INDEX ON relation_edge (property_id, to_page_id);   -- 역방향(rollup 무효화) 전용
CREATE INDEX ON relation_edge (to_page_id);                -- 전 프로퍼티 역참조(백링크)
-- 불변식 E1: 양방향 relation 은 property.config.synced_property_id 로 짝을 맺고,
--            엣지 삽입/삭제는 두 프로퍼티에 대해 같은 트랜잭션에서 대칭 수행한다.
-- 불변식 E2: sub-item/dependency 용 parent_row_id 같은 비정규화 컬럼을 두지 않는다.
--            필요하면 relation_edge 에서 파생시킨다
--            (03 F-03-18 의 "둘 중 하나를 정본으로" 지침을 엣지 테이블 쪽으로 확정).

-- 파생 프로퍼티(formula / rollup) 의존성 그래프와 값 캐시
CREATE TABLE property_dependency (
  dependent_property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  source_property_id    text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  via_relation_id       text NULL REFERENCES property(id) ON DELETE CASCADE,
  PRIMARY KEY (dependent_property_id, source_property_id)
);

CREATE TABLE derived_value (
  page_id     uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  value       jsonb,
  num_value   numeric NULL, text_value text NULL, date_start timestamptz NULL,
  stale       boolean NOT NULL DEFAULT true,
  computed_at timestamptz NULL,
  PRIMARY KEY (page_id, property_id)
);
CREATE INDEX ON derived_value (property_id) WHERE stale;
CREATE INDEX ON derived_value (property_id, num_value) WHERE NOT stale AND num_value IS NOT NULL;
-- 불변식 D1: formula/rollup 필터·정렬은 derived_value 의 사이드카 컬럼으로만 컴파일된다.
--            09 F-09-16 이 요구한 "머티리얼라이즈" 계약이 이것이다.

-- -------------------------------------------------------------------------
-- 6. 뷰별 컬럼 설정 — 단일 테이블 (C-6 판결)
--    view 본체는 views 클러스터 소유. 아래 두 컬럼만 이 판결이 규정한다.
-- -------------------------------------------------------------------------
-- ALTER TABLE view ADD COLUMN frozen_upto_property_id text NULL REFERENCES property(id);
--   W10: Freeze up to column 은 경계 지정이다. 열별 boolean 이 아니다.
--   NULL = 고정 없음. table 타입 뷰에서만 의미를 가진다.
-- ALTER TABLE view ADD COLUMN filter jsonb;   -- FilterNode 트리, MAX_FILTER_DEPTH=3 (C-15)

CREATE TABLE view_property (
  view_id     uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  visible     boolean NOT NULL DEFAULT false,
  order_idx   text NOT NULL,           -- 뷰 내 표시 순서 (fractional index)
  width       int NULL,                -- px, table 전용
  wrap        boolean NOT NULL DEFAULT false,
  date_format text NULL,               -- full|short|relative
  time_format text NULL,               -- 12_hour|24_hour|hidden
  status_show_as text NULL,            -- select|checkbox
  card_property_width_mode text NULL,  -- full_line|inline
  calculation text NULL,               -- 열 하단 집계
  PRIMARY KEY (view_id, property_id)
);
CREATE INDEX ON view_property (view_id, order_idx);
-- 불변식 V1: 행 단위 테이블이어야 한다. JSON 배열로 두면 "A는 폭 조절, B는 순서 변경"이
--            배열 전체 LWW 로 충돌한다 (04 F-04-12 의 논거 승계).
-- 불변식 V2: 순서 변경은 반드시 단일 행 UPDATE 로만 수행한다.
-- 불변식 V3: 03 의 frozen boolean 은 이 테이블에 존재하지 않는다.

CREATE TABLE row_position (              -- 뷰별/그룹별 수동 행 순서
  view_id   uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  group_key text NOT NULL DEFAULT '',
  row_id    uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  order_idx text NOT NULL,
  PRIMARY KEY (view_id, group_key, row_id)
);
CREATE INDEX ON row_position (view_id, group_key, order_idx);

CREATE TABLE view_user_override (        -- 개인 필터/정렬 (Save for everyone 미적용)
  view_id uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  filter  jsonb, sorts jsonb,
  PRIMARY KEY (view_id, user_id)
);
```

### 이 클러스터가 정의하지 않고 참조만 하는 것

| 엔티티 | 정본 위치 |
|---|---|
| `block` / 자식 순서 / parent enum | block-tree 클러스터 (C-9, C-10) |
| `page` ↔ `block` 연결 여부 | block-tree 클러스터 (C-3 / V-6). 결정 전까지 `page.id` 는 독립 uuid PK 로 두었고, block 연결로 판결되면 FK 추가 1줄로 흡수된다 |
| 삭제 상태 컬럼 | lifecycle 클러스터 (C-1 / V-4). 이 문서의 `[C-1 종속]` 자리 |
| `acl` / 권한 상속 | permissions 클러스터 (C-7 / C-8). **04 의 `acl` 정의는 채택하지 않는다** |
| `view` 본체 컬럼 전량 | views 클러스터. 이 문서는 `frozen_upto_property_id` 와 `filter` 깊이 상한만 규정 |
| `page_layout` / `layout_tab` / `layout_module` | 16-item-layout.md (U-1 해소 완료) |
| `database_template` | templates 클러스터 (C-16 소유권 판결에 종속). 단 `page.is_template` 플래그는 이 문서가 소유 |

### 상수

```ts
const MAX_FILTER_DEPTH       = 3;       // C-15 판결. 그룹 중첩 층수
const MAX_FILTER_GROUP_ITEMS = 100;     // W8
const MAX_QUERY_PAGINATION   = 10_000;  // W8
const PROPERTY_ID_LENGTH     = 21;      // nanoid base62
```

**깊이 정의(모호성 제거)**: `view.filter` 의 루트 객체를 **layer 1** 로 센다. 루트의 `and`/`or` 배열 원소 중 다시 `and`/`or` 를 가진 것이 **layer 2**, 그 안이 **layer 3**. layer 4 를 만드는 쓰기는 400 으로 거부한다.

---

## 판결별 상세

### C-2 / V-2 — 행 셀 저장: EAV 채택, JSONB 단일 컬럼 폐기

**채택**: `page_property_value(page_id, property_id, value jsonb + 타입별 사이드카 컬럼)` EAV. relation 은 `relation_edge` 별도 테이블. formula/rollup 은 `derived_value`. 읽기 최적화는 `page.properties_cache` / `page.search_tsv` **파생 컬럼**으로 해결한다.

**근거**

1. **04 가 스스로 반대 논거를 제공한다.** 04 F-04-12 는 `view_property` 를 JSON 배열이 아니라 행 단위 테이블로 두는 이유를 이렇게 적었다 — "`configuration.properties[]` JSON 배열로 두면 'A 는 폭 조절, B 는 열 순서 변경'이 배열 전체 LWW 로 충돌한다"(04 L337, L766). 그 논거는 뷰 설정보다 **행 셀에 훨씬 강하게 적용된다**. 뷰 설정은 하루에 몇 번 바뀌지만 셀은 초 단위로 동시 편집된다. 04 는 같은 문서 안에서 뷰 설정에는 정규화를, 행 셀에는 단일 JSONB 를 적용해 자기모순 상태다.
2. **구체적 실패 시나리오**: A 가 `Status` 를 In progress 로, B 가 동시에 `Due` 를 내일로 바꾼다. `row_page.properties` 단일 JSONB 는 문서 전체가 하나의 값이므로 후행 쓰기가 선행 쓰기를 통째로 덮는다. B 의 Due 변경이 사라지고 **어떤 오류도 나지 않는다**(침묵 데이터 손실). EAV 는 서로 다른 PK 행이므로 자연 병합된다.
3. **relation 역방향 조회**: rollup 무효화는 "대상 페이지의 프로퍼티가 바뀌었을 때 그것을 참조하는 source page 집합"을 구하는 연산이다. `relation_edge (property_id, to_page_id)` 인덱스로 O(log N + k). JSONB 배열이면 `properties @> ...` 전 행 스캔이거나, GIN 을 걸어도 프로퍼티별 선택도를 잃는다. 03 F-03-11 / F-03-13 의 무효화 경로는 04 스키마 위에서 성립하지 않는다.
4. **제3 문서의 독립 수렴**: 09-api-integrations.md 는 03 을 참조하지 않고 API 계약에서 출발했는데도 같은 결론에 도달했다 — `page_property_value(page_id, property_id, type, value jsonb)` + 타입별 사이드카 컬럼 승격 + `page_relation` 배열 정규화 테이블(09 L860~866, L923~924). 3개 문서 중 2개가 독립적으로 EAV 로 수렴했다.
5. **필터 컴파일**: 09 F-09-16 이 명시한 "값이 jsonb 한 컬럼에 있으면 인덱스가 안 먹는다"는 04 스키마에 대한 정확한 진단이다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 04 `row_page.properties jsonb NOT NULL` | 셀 단위 동시편집 병합 불가(근거 2). 프로퍼티별 부분 인덱스 불가 |
| 04 relation-in-jsonb (`row_page.properties[prop_id] = [row_id,...]`, 04 L536) | 역방향 조회 불가 → F-03-10 양방향 relation, F-03-11 rollup 성립 불가 |
| 03 의 "JSONB 는 프로토타입만" 이라는 **표현** | 결론은 맞으나 근거가 약했다. 이 문서가 위 5개 근거로 대체한다 |
| 데이터소스별 물리 테이블 (Teable 방식, 03 비교표 3행) | 프로퍼티 추가가 온라인 DDL 이 된다. 프로퍼티 500개 한도·타입 변환(F-03-14)이 전부 마이그레이션 작업이 된다. v2 이후로도 채택하지 않는다 |

**04 의 유효한 반론과 그 처리**

| 04 의 반론 | 처리 |
|---|---|
| "읽기 1회 vs N-way 조인" | `page.properties_cache jsonb` 파생 컬럼. 행 목록 렌더는 이 컬럼 하나만 읽는다. 정렬/필터/집계만 EAV 를 탄다 |
| "JSONB 설계에서는 `search_tsv` 머티리얼라이즈 컬럼이 사실상 필수"(04 L1329) | EAV 에서도 동일하게 `page.search_tsv` 를 둔다. 04 의 전제("JSONB 라서 필요하다")만 틀렸고 결론은 유효하므로 흡수한다 |
| 프로퍼티 100개 × 행 10만 = 셀 1,000만 행 | Postgres 에서 1,000만 행은 문제 규모가 아니다. 부분 인덱스가 프로퍼티별로 쪼개지므로 실제 스캔 대상은 `WHERE property_id = ?` 로 좁혀진다 |

**정본과 캐시의 규율 (가장 흔한 실패 지점)**

- 쓰기 경로는 **오직** `page_property_value` / `relation_edge` / `derived_value`.
- `properties_cache` 와 `search_tsv` 는 같은 트랜잭션의 AFTER 트리거로만 갱신. 애플리케이션 코드가 이 컬럼에 `UPDATE` 하는 것은 금지한다.
- 캐시가 깨졌을 때의 복구는 항상 재생성(rebuild from EAV)이다. 캐시를 정본으로 승격하는 경로를 만들지 않는다.

**파급 범위**

| 문서 | 고칠 곳 |
|---|---|
| 04-database-views.md | 의사 스키마 `row_page` 블록 전체 교체. `row_page` → `page` 식별자 치환(L101, 155, 178~181, 994, 1200, 1291, 1329, 1372, 1376). F-04-02·F-04-03·F-04-09·F-04-10·F-04-11·F-04-16·F-04-24·F-04-26·F-04-27 의 "properties jsonb 에서 읽는다" 전제 전량. F-04-22 의 dependency 저장 위치(L536)를 `relation_edge(role='dependency')` 로 |
| 03-database-core.md | 셀 저장 전략 비교표를 "판결 완료" 표기로. F-03-16 의 `ALTER TABLE page_property_value` 인덱스 절을 정본 인덱스로. F-03-18 의 `parent_row_id` 비정규화 옵션 삭제(불변식 E2) |
| 09-api-integrations.md | F-09-16 / F-09-17 의 `page_relation` → `relation_edge`, `property_computed_cache` → `derived_value` 로 이름 통일 |
| 07-search-navigation.md | 인덱싱 소스가 `page.search_tsv` 라는 점 반영(실제 판결은 search 클러스터 U-6 소관) |

---

### C-3 참조 — 행 테이블 이름은 `page`

**채택**: `page`. **폐기**: `row_page`.

**근거**: 03 F-03-01 이 "별도의 row 개념을 만들면 안 된다"고 명시했고, 04 자신도 `row_page` 를 "특수 상태의 행 **페이지**"(04 L1372)라 부르며 페이지임을 인정한다. 이름이 `row_page` 인 채로 두면 block-tree 클러스터가 C-3 을 "행은 블록이다"로 판결했을 때 테이블명이 개념과 어긋난 채 남는다.

**경계**: `page.id REFERENCES block(id)` 인지는 **block-tree 클러스터의 C-3 / V-6 판결에 종속**한다. 이 문서는 그 판결이 어느 쪽이든 흡수되도록 `page.id uuid PRIMARY KEY` 만 선언했다 — block 연결로 결정되면 FK 추가 1줄, 독립으로 결정되면 현행 유지다. **이 클러스터는 이 축 자체를 판결하지 않는다.**

---

### C-4 / V-7 — property.id 는 text, 전역 유니크. 동명 프로퍼티 금지

**채택**

```sql
property.id text PRIMARY KEY   -- nanoid(21, base62), 전역 유니크
UNIQUE (data_source_id, name)
```

모든 참조(`page_property_value`, `relation_edge`, `derived_value`, `select_option`, `view_property`, `property_dependency`, `layout_module`, 필터 AST, formula AST, 자동화 트리거)는 **단일 컬럼 `text` FK** 를 쓴다.

**근거**

1. **1차 출처(W1)**: `usually a short string of random letters and symbols`. uuid 가 아니다. 03 의 `uuid PK` 는 공개 API 계약과 직접 충돌한다.
2. **복합 PK 를 쓰지 않는 이유**: property id 는 **사용자 데이터 JSON 안에 파묻힌다** — 뷰 필터 AST, formula AST, `layout_module`, 자동화 트리거 조건, CSV 내보내기 헤더. 복합 PK(04)를 채택하면 이 JSON 들이 전부 `{data_source_id, property_id}` 2필드 튜플을 들고 다녀야 하고, linked data source 를 참조하는 뷰에서는 어느 `data_source_id` 를 쓸지 매번 판단해야 한다. **JSON 안의 참조는 반드시 스칼라 1개여야 한다.**
3. **전역 유니크로 만드는 이유**: 노션은 `"title"` 같은 human-readable id 때문에 id 가 data source 안에서만 유니크하다(W1). 이를 그대로 모사하면 `select_option.property_id` 처럼 data_source 를 유추할 수 없는 테이블에서 복합키가 되살아난다. nanoid 21자(base62 ≈ 126 bit)는 실무적으로 충돌하지 않으므로 전역 유니크로 두고, `"title"` 별칭은 **API 직렬화 계층 1곳**에서만 흡수한다(불변식 P3). 이것은 원본 모사보다 클론 코드 단순성을 택한 **클론의 설계 선택**이며, 트레이드오프는 "API 응답의 title property id 가 노션과 다르다" 하나뿐이다(우리 API 이므로 무해).
4. **동명 금지 근거(W5)**: data source 객체의 `properties` 는 **프로퍼티 이름을 키로 하는 JSON 객체**다. 동명 프로퍼티가 존재하면 이 표현 자체가 불가능하다. 즉 노션이 동명을 막는다는 것은 API 형태에서 **연역된다** — 03 의 `[확인필요]` 태그는 제거해도 된다.
5. **name 참조 결정성(W9)**: 필터는 `property` 를 id 또는 name 으로 받는다. 동명이 허용되면 name 참조가 비결정적이 되어 쿼리 계약이 무너진다.

**name 해석 규칙(확정)**: 정확 일치(대소문자 구분) 1건 → 해당 property. 0건 → `400 invalid_property`. **대소문자 무시 폴백은 두지 않는다** — 폴백을 두면 `Status`/`status` 를 둘 다 허용할지가 다시 열린다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 03 `property.id uuid PRIMARY KEY` | W1 과 직접 충돌. 09 F-09-17 이 명시한 "통합은 이름이 아니라 id 를 저장해야 한다"의 그 id 가 uuid 가 아니다 |
| 04 `PRIMARY KEY (data_source_id, id)` | 근거 2 — 8개 테이블과 4종 JSON AST 에 복합키가 전파된다 |
| 노션의 `"title"` human-readable id 모사 | 근거 3 — 전역 유니크를 포기하게 만든다. API 별칭으로만 수용 |
| 04 의 name 무제약 | 근거 4·5 |

**파급 범위**

| 문서 | 고칠 곳 |
|---|---|
| 03-database-core.md | `property.id uuid` → `text`, `[확인필요]` 태그 제거. `relation_edge.property_id`, `select_option.property_id`, `property_dependency.*`, `page_property_value.property_id`, `page_person.property_id`, `view_property_config.property_id`, `page_layout_slot.property_id` 전부 `text`. F-03-02(이름 변경 시 id 불변), F-03-14(타입 변환 시 id 유지) 재서술 |
| 04-database-views.md | `property` PK 정의 교체. `view_property.property_id` 는 이미 text 이므로 유지 |
| 09-api-integrations.md | F-09-16/17 의 `property_id text` 는 이미 정합 — PK 를 `(page_id, property_id)` 로 확인 |
| 16-item-layout.md | `layout_module.property_id uuid REFERENCES property(id)` → `text`. `layout_tab.relation_property_id` 동일 |

---

### C-5 — data_source 소유는 단일 FK, 부착은 조인 테이블. 두 축을 분리한다

**채택**: `data_source.owner_database_id uuid NOT NULL`(소유) **와** `database_data_source(database_id, data_source_id, order_idx)`(부착)을 **둘 다** 둔다. `is_linked` 는 컬럼이 아니라 `database_id <> owner_database_id` 파생값이다.

이것은 "둘 다 맞다"가 아니라 **04 가 하나의 축이라고 착각한 것이 실은 두 개의 축이었다**는 판정이다. 04 의 "단일 FK 로는 표현되지 않는다 = 초판 의사 스키마의 결함"(04 L1165)이라는 **진단 자체가 틀렸다**.

**근거**

1. **W2(1차 출처)**: data source 의 `parent` 는 **단수**다 — `type: "database_id"` 이거나(대부분) 외부 동기화의 경우 `type: "data_source_id"`. 여기에 더해 `database_parent` 라는 **별도 필드**가 컨테이너 database 를 가리킨다. 즉 노션 자신이 "이 data source 를 소유한 database 는 정확히 1개"라는 모델을 갖고 있다. 03 의 단일 FK 는 이 축을 정확히 표현한다.
2. **W3 / W4**: database 는 `data_sources[]` 자식 목록을 갖고(W3), 헬프센터는 linked database 를 "**다른 database 의** 기존 data source 를 현재 database 에 연결하는 것"으로 정의하며 Manage Data Sources 에서 소유분과 `Linked` 를 **구분해 보여준다**(W4). 구분해 보여준다는 것은 시스템이 소유와 부착을 구별해 저장한다는 뜻이다.
3. **04 의 조인 테이블만 남기면 깨지는 것**: 소유 개념이 사라져 (a) data_source 삭제의 주체가 불명확해지고, (b) `X` 로 linked 를 제거했을 때 원본이 살아남아야 한다는 규칙을 표현할 수 없으며, (c) 마지막 부착을 지우면 소유자 없는 고아 data_source 가 생긴다. W4 의 "원본 무손상"이 스키마 불변식으로 서지 않는다.
4. **03 의 단일 FK 만 남기면 깨지는 것**: linked database(F-04-13 / F-04-23)를 저장할 곳이 없다. 부착 순서(탭 순서)도 없다.
5. **`is_linked` 컬럼을 지우는 이유**: `owner_database_id` 와 이중 진실이 된다. 둘이 어긋나면(부착 행은 `is_linked=false` 인데 owner 는 다른 database) 어느 쪽이 옳은지 판단 불가. 파생값으로 두면 어긋날 수 없다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 04 의 "단일 FK 는 결함" 판정과 그에 따른 `owner_database_id` 제거 | W2 — 소유는 실제로 단일이다 |
| 04 `database_data_source.is_linked boolean` 컬럼 | 근거 5 — 파생값을 저장하면 이중 진실 |
| 03 의 조인 테이블 부재 | 근거 4 — linked database 표현 불가 |
| 04 `data_source.owner_database_id` 의 **NULL 허용** | 고아 data_source 를 허용한다. NOT NULL 로 강제 |

**MVP 축소 지침**: MVP 는 database : data_source = 1:1 로 고정하고 UI 에서 data source 개념을 숨긴다. **그래도 세 가지는 처음부터 넣는다** — (a) `property` / `page` 의 FK 는 `database_id` 가 아니라 `data_source_id`, (b) `owner_database_id NOT NULL`, (c) `database_data_source` 소유 행 1개. 이 셋이 있으면 F-04-13 / F-04-23 은 나중에 UI 작업만으로 해결된다.

**파급 범위**: 03 `data_source` DDL(L59~66) + F-03-01 데이터 모델 절 / 04 F-04-13·F-04-23 의 정정 각주(L1165)를 "소유·부착 2축" 서술로 교체 / 15-external-sync 의 외부 동기화 data source 가 `parent_data_source_id` 를 쓴다는 점을 상호참조.

---

### C-6 — `view_property` 단일 테이블. 컬럼 고정은 경계 포인터

**채택**: `view_property`(04 의 이름) 하나. 03 의 `view_property_config` 컬럼 중 실재하는 것을 흡수하고, `frozen` 은 모델을 바꿔 `view.frozen_upto_property_id` 로 이관한다.

| 컬럼 | 출처 | 처리 |
|---|---|---|
| `visible`, `width`, `wrap` | 양쪽 공통 | 유지 |
| `position` / `order_idx` | 04 `position` / 03 `order_idx` | **`order_idx` 로 통일**(이 클러스터 소유 테이블의 명명 규약) |
| `date_format`, `time_format`, `status_show_as`, `card_property_width_mode`, `calculation` | 04 전용 | 흡수 |
| `frozen boolean` | 03 전용 | **폐기** → `view.frozen_upto_property_id text NULL` |

**근거**

1. 같은 개념의 테이블이 두 이름으로 존재할 이유가 없다. 04 가 뷰 도메인의 주 소유자이고 컬럼 수가 더 많으므로 04 이름을 남긴다.
2. **`frozen` 을 열별 boolean 으로 두면 안 되는 이유(W10)**: 1차 출처의 조작은 `Freeze up to column` / `Unfreeze column` 이다. 이는 **접두 경계**이지 임의 열 집합이 아니다. 열별 boolean 을 두면 "1·3열은 고정, 2열은 비고정" 같은 표현 불가능한 상태가 스키마상 합법이 되고, 열 순서를 바꿀 때마다 접두 불변식을 애플리케이션이 재검사해야 한다. 경계 포인터 1개면 순서 변경과 무관하게 항상 정합이다.
3. `frozen` 을 `view_property` 가 아니라 `view` 에 두는 이유: 뷰당 값이 1개인 속성을 열 테이블에 두면 N-1 개 행이 낭비되고, 동시편집 시 "여러 행이 동시에 frozen=true" 라는 불일치 상태가 발생한다.

**폐기**: 03 `view_property_config` 테이블 정의 전체 / 03 `frozen boolean` 컬럼 모델.

**파급 범위**: 03 F-03-16 의 `view_property_config` DDL 블록(L934~939) 삭제 → 이 문서 참조로 교체 / 04 F-04-02(표 뷰 열 고정 서술)·F-04-12 에 `frozen_upto_property_id` 반영 / 04 `view_property.position` → `order_idx` 치환(L163~176, 337, 341, 342, 756, 764, 766, 769, 918, 924, 1291).

**[확인필요]**: 고정 경계가 **뷰별**인지 **사용자별**인지 1차 출처에 없다. 클론은 뷰별(공유)로 확정하되, 사용자별로 밝혀지면 `view_user_override` 에 컬럼을 추가하는 경로로 흡수한다.

---

### C-15 / V-10 — `MAX_FILTER_DEPTH = 3`

**채택**: 상수 하나 `MAX_FILTER_DEPTH = 3`. 쓰기 경로(UI 저장 + API POST/PATCH)에서만 검증, **읽기 경로에는 깊이 검증을 걸지 않는다**. 그룹당 조건 수 상한 100(W8).

**근거**

1. **두 출처는 상충이 아니라 서로 다른 표면을 서술한다.** W6(API 레퍼런스 `Nesting is supported up to two levels deep`)은 공개 API 의 제한이고, W7(헬프센터 `nested filter groups up to three layers deep`)은 UI 필터 빌더의 제한이다. 04 가 이를 "1차 출처 두 개의 불일치"로 서술한 것은 절반만 맞다 — 불일치가 아니라 **표면이 둘**이다.
2. 클론에서 상수를 둘로 나누면(API 2 / UI 3) UI 로 만든 3단 필터를 API 로 읽을 수 없는 **비대칭 상태**가 생긴다. 노션에는 그 비대칭이 실제로 있지만(공개 API 가 UI 보다 좁다), 클론이 승계할 이유가 없다. **넓은 쪽(3)으로 통일한다.**
3. 읽기 경로에 검증을 걸지 않는 이유(04 의 권고 채택): 나중에 상한을 낮추면 기존에 저장된 뷰가 통째로 열리지 않는다. 검증은 새로운 상태를 만드는 시점에만 건다.

**폐기**: 03 한도표 L207 의 `API 필터 compound 중첩 | 2단계까지` 단정 및 L992 본문 서술. 두 곳 모두 "공개 API 원문은 2단계이나 UI 는 3단계이며 **클론 상수는 3**"으로 정정한다.

**파급 범위**: 03 L207 한도표 1행, L992 / 04 F-04-09(이미 정합, 근거를 W6/W7 로 교체) / 09 F-09-16 의 필터 DSL 검증기.

---

### U-1 — `layout_tab` dangling FK: 16-item-layout.md 를 정본으로 비준

**채택**: 16-item-layout.md 의 `page_layout` + `layout_tab` + `layout_module` 3테이블. `layout_tab(id, data_source_id, kind∈{content,linked_view}, name, icon, view_id, relation_property_id, order_idx)` 가 U-1 이 지적한 dangling FK 를 해소한다.

**근거**: U-1 은 이 문서가 판결하기 전에 16 이 이미 정면으로 해결했다 — 16 은 "이 문서가 그 테이블의 정본 정의를 소유한다"고 선언하고, `page_layout_slot` 이 왜 부족한지(모듈 vs 슬롯, 탭 소속, section 중첩, `PRIMARY KEY (data_source_id, property_id)` 로는 프로퍼티 1개가 2개 모듈로 나타날 수 없음)를 근거와 함께 적었다. **판사가 할 일은 재설계가 아니라 소유권 확정이다.** 16 을 비준하고 03 의 잔존 정의를 제거하는 것으로 끝난다.

**폐기**: 03 F-03-16 의 `page_layout_slot` DDL 블록(L942~951) 전체. 이 테이블은 존재하지 않는다.

**이 클러스터가 붙이는 조건 2가지** (16 의 스키마가 이 문서의 판결과 맞물리는 지점)

1. `layout_module.property_id` / `layout_tab.relation_property_id` 는 `uuid` 가 아니라 **`text REFERENCES property(id)`** 다 (C-4 판결).
2. `layout_tab.view_id` 가 참조하는 `view` 는 `owner_kind='layout_tab'` 이어야 하며, 그 뷰는 `view_property` / `row_position` 을 일반 뷰와 동일하게 쓴다. **탭 뷰라고 해서 별도 저장 경로를 만들지 않는다.**

**파급 범위**: 03 F-03-16 의 `page_layout_slot` 블록 삭제 + "레이아웃은 16-item-layout.md 소관" 포인터 1줄 / 16 의 `property_id` 타입 정정.

---

### V-2 / V-7 / V-10 검증 항목 처리 결과

| 항목 | 처리 |
|---|---|
| **V-2** 행 저장 EAV vs JSONB | 비평이 "외부 검증이 아니라 내부 결정으로 끝내야 한다"고 적은 대로 **내부 판결로 종결**(C-2). EAV 채택. 09 의 독립 수렴을 근거로 보강했다 |
| **V-7** property id 타입 + 동명 허용 | **외부 검증으로 종결**. W1 이 id 타입(짧은 문자열)을, W5 가 동명 금지(properties 가 name 키 객체)를 확정했다. 실측 불필요 |
| **V-10** 필터 중첩 상한 | **외부 검증으로 종결**. W6/W7 이 "두 출처의 상충"이 아니라 "두 표면"임을 확정. 클론 상수 3 |

---

## 수정이 필요한 문서 목록

| 문서 | 수정 내용 | 심각도 |
|---|---|---|
| **04-database-views.md** | ① 의사 스키마의 `row_page` 블록을 이 문서의 `page` + `page_property_value` + `relation_edge` 로 교체 ② 전 문서 `row_page` → `page` 식별자 치환 ③ `property` PK 를 `id text PRIMARY KEY` 로 ④ `database_data_source.is_linked` 컬럼 제거 + `data_source.owner_database_id NOT NULL` 복원 ⑤ `view_property.position` → `order_idx` ⑥ `view` 에 `frozen_upto_property_id` 추가 ⑦ F-04-22 dependency 저장을 `relation_edge(role='dependency')` 로 ⑧ `acl` 테이블 정의 삭제 → permissions 클러스터 참조 ⑨ F-04-23 의 "단일 FK 는 결함" 각주를 "소유·부착 2축"으로 재서술 | **치명** — 스키마 전면 |
| **03-database-core.md** | ① `property.id uuid` → `text`, `[확인필요]` 태그 제거 ② 모든 `property_id uuid` → `text` ③ `data_source` 에 `parent_data_source_id` 추가 + `database_data_source` 조인 테이블 추가 ④ `view_property_config` 삭제 → `view_property` 참조 ⑤ `page_layout_slot` 삭제 → 16 참조 ⑥ 한도표 L207 필터 중첩 `2단계` → `3(클론 상수), 공개 API 원문 2` ⑦ 셀 저장 전략 비교표에 "판결 완료" 표기 ⑧ F-03-18 의 `parent_row_id` 비정규화 옵션 삭제 ⑨ `page` 에 `properties_cache` / `search_tsv` / `is_template` 추가 | **높음** |
| **09-api-integrations.md** | ① `page_relation` → `relation_edge` ② `property_computed_cache` → `derived_value` ③ F-09-16 필터 깊이 검증기 상수 3 + `maxItems 100` ④ F-09-17 의 name 참조 해석 규칙(정확 일치, 폴백 없음) 명시 | 중간 |
| **16-item-layout.md** | ① `layout_module.property_id` / `layout_tab.relation_property_id` 를 `text REFERENCES property(id)` 로 ② `page_layout.data_source_id` 가 `data_source(id)` 를 직접 참조하는지 확인(현재 `layout_tab`/`layout_module` 이 `page_layout(data_source_id)` 를 경유) | 낮음 |
| **07-search-navigation.md** | 인덱싱 소스가 `page.search_tsv` 파생 컬럼임을 반영(실제 판결은 search 클러스터 U-6 소관) | 낮음(상호참조만) |

---

## 남은 불확실성

| # | 확정 못한 것 | 왜 지금 못 정하나 | 실측 방법 | 잠정 결정 |
|---|---|---|---|---|
| 1 | 동명 프로퍼티가 **대소문자 구분**으로 유니크한가 | W5 는 name 이 키라는 사실만 준다. `Status` / `status` 가 동시 존재 가능한지는 1차 출처에 없다 | 테스트 워크스페이스에서 `Status` 생성 후 `status` 생성 시도 → 거부 여부 관찰. 이어서 API 로 data source 를 GET 해 `properties` 객체에 두 키가 다 나오는지 확인 | 대소문자 **구분** 유니크. name 해석기는 정확 일치만(폴백 없음) |
| 2 | 컬럼 고정 경계가 뷰별인가 사용자별인가 | W10 은 조작 방법만 준다. 저장 스코프 미기재 | 계정 2개로 같은 공유 뷰를 열고 A 가 `Freeze up to column` 실행 → B 화면에 반영되는지 관찰 | **뷰별(공유)**. 사용자별로 밝혀지면 `view_user_override` 에 컬럼 추가로 흡수 |
| 3 | 하나의 data_source 가 동시에 **몇 개** database 에 linked 로 붙을 수 있는가 | W4 는 가능하다고만 한다. 상한 미기재 | 같은 data source 를 5~10개 database 에 linked 로 붙여 보고 거부 지점 관찰 | 상한 없음. 필요 시 `database_data_source` 개수 제한을 나중에 추가 |
| 4 | linked data source 를 붙인 database 에서 **스키마 편집**이 가능한가(원본에 전파되는가) | 헬프센터가 linked 제거만 서술하고 스키마 편집 권한을 언급하지 않는다. 이 답에 따라 `property.data_source_id` 만으로 충분한지, 부착별 스키마 오버레이가 필요한지가 갈린다 | 워크스페이스의 data source 를 database B 에 linked 로 붙인 뒤 B 에서 프로퍼티 추가 시도 → 원본 database 에 나타나는지 관찰 | **전파된다**(스키마는 data_source 소유이므로 부착별 오버레이 없음). 오버레이가 필요하다고 밝혀지면 `database_data_source` 에 `property_overrides jsonb` 추가 |
| 5 | `properties_cache` 갱신을 **DB 트리거**로 할지 **애플리케이션 outbox 워커**로 할지 | 성능 실측 문제다. 트리거는 정합성이 강하지만 대량 임포트에서 쓰기 증폭이 크다 | 10만 행 × 30 프로퍼티 임포트 벤치마크. 트리거 방식 / 워커 방식의 임포트 소요와 캐시 지연 비교 | 트리거(같은 트랜잭션). 임포트 경로만 트리거를 끄고 배치 재생성하는 예외 경로를 둔다 |
| 6 | 프로퍼티 500개 한도가 **data_source 당**인지 database 당인지 | 03 이 한도만 인용하고 스코프를 명시하지 않았다 | API 로 data source 하나에 프로퍼티를 501개 추가 시도 | data_source 당. 위반 시 `400 validation_error` |
| 7 | 파생 프로퍼티(formula/rollup) 필터·정렬 시 stale 행 처리 정책 | 동기 재계산(a)을 기본으로 정했으나 큰 데이터소스에서 응답 지연 한계가 미지수 | 1만 행 rollup 전량 stale 상태에서 정렬 쿼리 p95 측정. 500ms 초과 시 (b) 비동기 + stale 표시로 전환 | (a) 동기 재계산 |
| 8 | `relation_edge` 의 `role` 값이 sub_item / dependency 2종으로 충분한가 | 03 F-03-18 이 내장 self-relation 2종만 서술했다. 노션이 다른 내장 relation 을 추가할 여지가 있다 | 신규 typed database(`tasks`/`projects`)에서 자동 생성되는 relation 프로퍼티 목록을 API 로 확인 | 2종. CHECK 제약이므로 확장은 마이그레이션 1줄 |

---

## 판결 원칙 요약 (다음 클러스터를 위한 메모)

이 클러스터의 판결에서 반복적으로 작동한 규칙 3가지:

1. **JSON 안에 들어가는 참조는 스칼라 1개여야 한다.** C-4 의 복합 PK 폐기가 여기서 나왔다. 식별자가 필터 AST·formula AST·레이아웃·자동화 조건에 파묻히는 엔티티는 복합키를 가질 수 없다.
2. **동시편집 병합 단위가 저장 단위를 결정한다.** C-2(셀)와 C-6(뷰 컬럼 설정)이 같은 규칙의 두 사례다. 사용자가 독립적으로 바꾸는 두 값은 서로 다른 행에 있어야 한다.
3. **"A 와 B 중 하나"로 보이는 모순 중 일부는 실은 서로 다른 두 축이다.** C-5(소유 vs 부착), C-15(API 표면 vs UI 표면)가 그 사례다. 축이 둘이면 둘 다 저장하되 **한쪽을 다른 쪽에서 파생**시켜 이중 진실을 없앤다.

---

## 참고 출처 (실제 확인)

1. https://developers.notion.com/reference/property-object — property `id` 는 짧은 랜덤 문자열, 이름 변경에 불변, `"title"` 특수 id (W1)
2. https://developers.notion.com/reference/data-source — data source 의 `parent` 는 단수(database_id 또는 data_source_id), `database_parent` 별도 필드, `properties` 는 name 키 객체 (W2, W5)
3. https://developers.notion.com/reference/database — database 의 `data_sources[]` 자식 목록 (W3)
4. https://www.notion.com/help/data-sources-and-linked-databases — data source 정의, 한 database 안의 다중 data source, linked database 의 의미와 `Linked` 섹션 (W4)
5. https://developers.notion.com/reference/post-database-query-filter — `Nesting is supported up to two levels deep`, 필터의 property 는 id 또는 name (W6, W9)
6. https://www.notion.com/help/views-filters-and-sorts — `nested filter groups up to three layers deep`, `Freeze up to column` / `Unfreeze column` (W7, W10)
7. https://developers.notion.com/reference/query-a-data-source — `maxItems: 100`, `paginating through up to 10,000 results per query`, `accepts property IDs or property names` (W8, W9)
