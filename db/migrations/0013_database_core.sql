-- 데이터베이스 코어 — W8-a (F-03-01 컨테이너 · F-03-02 스키마 · F-03-03/04/06 프로퍼티 · F-03-16 셀)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5
--       판결 C-2/V-2 (셀 값 EAV) · C-3 (DB 행은 block 의 행이다) · C-4/V-7 (property.id)
--       C-5 (data_source 가 스키마와 행 집합을 소유) · C-15 (필터 깊이)
--       X-2 (id FK) · X-4 (셀은 CRDT 밖) · X-9 (is_locked 폐기)
--
-- 마스터 문서 §5.2 W8-a: "3계층 + EAV 셀 + 사이드카 컬럼 + `relation_edge` 자리 예약.
--                         프로퍼티 5종."
--
-- ──────────────────────────────────────────────────────────────────────
-- 3계층이 무엇이고 왜 나뉘어 있는가
-- ──────────────────────────────────────────────────────────────────────
--
--   block(type='database')  →  database   : 화면에 놓인 컨테이너
--   database                →  data_source: **스키마와 행 집합의 소유자** <C-5>
--   data_source             →  page       : 행. 그 자신이 block 의 행이다 <C-3>
--
-- 2계층(database 가 곧 스키마)으로 합치면 linked database 가 표현되지 않는다.
-- `database_data_source` 가 **부착**을, `data_source.owner_database_id` 가 **소유**를
-- 각각 들고 있고, 둘이 다른 축이라는 것이 C-5 의 핵심이다. `is_linked` 를 컬럼으로
-- 두지 않는 이유도 그것이다 — 파생값이다(불변식 DS2).
--
-- ──────────────────────────────────────────────────────────────────────
-- 정본에 ENUM 정의가 없어서 도메인 문서에서 가져왔다
-- ──────────────────────────────────────────────────────────────────────
--
-- 정본 §3.5 는 `property_type` 과 `option_color` 를 **쓰지만 정의하지 않는다.**
-- 값 목록은 `03-database-core.md` 의 전수표(24종, 2026-09-06 에 헬프센터와 API
-- 문서를 2차 대조한 것)와 그 아래 한 줄("옵션 색상 enum: default, gray, …")에 있다.
--
-- **24종을 지금 전부 넣는다.** MVP 가 쓰는 것은 6종뿐이지만:
--   · `ALTER TYPE … ADD VALUE` 로 추가한 값은 **같은 트랜잭션에서 쓸 수 없다.**
--     우리 마이그레이션 러너는 파일 하나를 한 트랜잭션에서 돌리므로(CLAUDE.md),
--     타입을 추가하는 마이그레이션과 그 값을 쓰는 마이그레이션이 갈라진다.
--   · 전수표가 이미 확정돼 있다. 나중에 넣을 이유가 "지금은 안 쓴다" 뿐이라면
--     그건 나중에 파일 두 개를 쓰게 만드는 선택이다.
--
-- `button` 과 `verification` 은 API 에 노출되지 않는 UI 전용 타입이다(전수표 비고).
-- 03 문서가 `property.api_exposed boolean` 을 권했으나 **두지 않았다** — 그 값은
-- `type` 의 함수이므로 컬럼으로 두면 두 곳이 어긋날 수 있다. 필요해지면 타입별
-- 상수표(애플리케이션)에서 읽는다.
CREATE TYPE property_type AS ENUM (
  -- 저장 (14)
  'title', 'rich_text', 'number', 'select', 'multi_select', 'status', 'date',
  'people', 'files', 'checkbox', 'url', 'email', 'phone_number', 'place',
  -- 저장(엣지)
  'relation',
  -- 파생 (2)
  'formula', 'rollup',
  -- 자동 (5)
  'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id',
  -- UI 전용 (2) — API property-object 목록에 없다
  'button', 'verification'
);

-- 19색 블록 컬러(`rich-text.ts`)와 **다른 집합**이다. 옵션 색은 10색이다.
-- 같아 보인다고 합치면 안 된다 — 1차 출처가 둘을 따로 열거한다.
CREATE TYPE option_color AS ENUM (
  'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'
);

-- ──────────────────────────────────────────────────────────────────────
-- ① database — 컨테이너
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE database (
  -- [X-2] `block(type='database')` 의 1:1 확장. block 이 지워지면 같이 사라진다.
  id            uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,
  title_rich    jsonb NULL,
  icon          jsonb NULL,
  cover         jsonb NULL,
  is_inline     boolean NOT NULL DEFAULT true,
  is_full_width boolean NOT NULL DEFAULT false,
  -- ★ `is_locked` 컬럼이 **없다** [X-9]. 잠금은 `node_lock` 테이블 하나로 통합됐고,
  --   04 문서의 DDL 에 남아 있던 컬럼은 permission 판결이 폐기했다. 편해 보인다고
  --   되살리면 잠금 상태의 진실이 둘이 된다.
  kind          text NULL,                   -- typed database: tasks|projects|skills
  dependency_shift_mode text NULL
                CHECK (dependency_shift_mode IN ('overlap_only', 'maintain_gap', 'never')),
  avoid_weekends boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE database IS
  'F-03-01. block(type=''database'') 의 1:1 확장 [X-2]. is_locked 컬럼은 없다 — node_lock 으로 통합 [X-9].';

-- ──────────────────────────────────────────────────────────────────────
-- ② data_source — 스키마와 행 집합의 소유자 <C-5>
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE data_source (
  id                    uuid PRIMARY KEY,
  owner_database_id     uuid NOT NULL REFERENCES database(id) ON DELETE CASCADE,
  -- 외부 동기화 전용. 우리가 만드는 data_source 는 항상 NULL 이다.
  parent_data_source_id uuid NULL REFERENCES data_source(id),
  name                  text NOT NULL,
  origin                origin_kind NOT NULL DEFAULT 'native',
  -- stale 스키마 쓰기 차단. 클라이언트가 들고 있던 스키마 버전으로 셀을 쓰면 거부한다.
  schema_version        bigint NOT NULL DEFAULT 1,
  -- [X-5] `ds:{data_source_id}` 채널의 gap 감지 축. 실시간은 Phase 1 이지만
  --       컬럼을 지금 둔다 — 나중에 넣으면 기존 행의 시작점을 정할 수 없다.
  change_seq            bigint NOT NULL DEFAULT 0,
  -- unique_id 발급 카운터. **`UPDATE … RETURNING` 으로만 발급한다**(정본) —
  -- `SELECT` 후 `UPDATE` 하면 동시 삽입 두 건이 같은 번호를 받는다.
  unique_id_counter     bigint NOT NULL DEFAULT 0,
  unique_id_prefix      text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_data_source_name CHECK (length(name) > 0),
  CONSTRAINT ck_data_source_counter CHECK (unique_id_counter >= 0),
  -- 자기 자신을 부모로 두면 외부 동기화 경로가 무한 루프가 된다.
  CONSTRAINT ck_data_source_no_self_parent CHECK (parent_data_source_id IS NULL OR parent_data_source_id <> id)
);
CREATE INDEX ix_data_source_owner ON data_source (owner_database_id);

COMMENT ON TABLE data_source IS
  'C-5. 스키마(property)와 행 집합(page)의 소유자. database 와 분리된 이유는
   linked database 다 — 부착(database_data_source)과 소유(owner_database_id)가 다른 축이다.';

-- ── 부착 ──
--
-- 불변식 DS1: 모든 data_source 는 `(owner_database_id, id)` 부착 행을 **정확히 1개**
--             갖는다. "1개 이하"는 PK 가 막지만 "적어도 1개"는 스키마로 표현할 수
--             없다 — 애플리케이션이 data_source 를 만들 때 같은 트랜잭션에서 넣는다.
-- 불변식 DS2: `is_linked` 는 컬럼이 아니라 파생값이다:
--             `is_linked(row) := (row.database_id <> data_source.owner_database_id)`
-- 불변식 DS3: 소유 행 DELETE 금지. linked 행 제거는 부착 해제(원본 무손상)이고,
--             소유 행 제거는 data_source 삭제여야 한다.
--             ⚠ **트리거로 막지 않았다.** `data_source` 를 지우면 CASCADE 가 이
--             행도 지우는데, BEFORE DELETE 트리거는 그것이 CASCADE 인지 직접
--             DELETE 인지 구분할 방법이 없다. 막으면 정당한 삭제가 막힌다.
--             애플리케이션이 지킨다(부착 해제 API 가 소유 행을 거부한다).
CREATE TABLE database_data_source (
  database_id    uuid NOT NULL REFERENCES database(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  order_idx      text NOT NULL,
  PRIMARY KEY (database_id, data_source_id),
  CONSTRAINT ck_ddsorder CHECK (length(order_idx) > 0)
);
-- ⚠ `order_idx` 는 fractional index 라 **이진 순서**로 비교돼야 한다(마이그레이션 0008
--   과 같은 이유 — DB collation 이 ICU + ko-KR 이다).
ALTER TABLE database_data_source ALTER COLUMN order_idx TYPE text COLLATE "C";
CREATE INDEX ix_dds_by_source ON database_data_source (data_source_id);

-- ──────────────────────────────────────────────────────────────────────
-- ③ property — 스키마 <C-4/V-7>
-- ──────────────────────────────────────────────────────────────────────
--
-- **MVP 가 만드는 프로퍼티는 6종이다** — 마스터 문서 W8-a 의 "프로퍼티 5종"에
-- 필수인 `title` 을 더한 것이다. 정본도 마스터 문서도 **어느 5종인지 이름을 적지
-- 않았으므로** 여기서 정하고 근거를 남긴다(HANDOFF §3.2 의 부류).
--
--   title · rich_text · number · select · checkbox · date
--
-- 고른 기준은 **사이드카 컬럼을 전부 덮는 것**이다. 사이드카는 정렬·필터가 실제로
-- 읽는 컬럼이고(불변식 D1 과 같은 취지), 거기서 빠진 축이 있으면 그 타입을 넣을 때
-- 인덱스와 필터 컴파일러를 다시 설계해야 한다:
--
--   text_value  ← title, rich_text, select(옵션 이름)
--   num_value   ← number
--   bool_value  ← checkbox
--   date_start / date_end ← date
--
-- `multi_select` 는 뺐다. `select_option` 레지스트리를 `select` 와 **공유**하므로
-- 나중에 추가하는 것이 스키마 변경이 아니라 레지스트리 재사용이다(F-03-04 가 둘을
-- 한 F-ID 로 묶은 이유도 그것이다). `status` 도 같은 레지스트리 + `group_id` 다.
--
-- 자동 메타 4종(created_*/last_edited_*)과 `unique_id` 는 **프로퍼티 행은 만들 수
-- 있지만 셀 행은 만들지 않는다**(불변식 C1) — block/page 에서 투영한다.

CREATE TABLE property (
  -- nanoid(21, base62). **uuid 가 아니다** — 정본 C-4 가 전역 유니크 text 로 정했다.
  -- 불변식 P2: 이 값은 어떤 경로로도 변경되지 않는다. rename 은 `name` 만 바꾼다.
  id             text PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text NULL,                  -- API property-object 의 1급 필드(추정 아님)
  type           property_type NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}',
  order_idx      text NOT NULL,              -- 스키마 기본 순서(뷰별 순서와 별개)
  -- <15 R2> 두 축은 **독립**이다(불변식 P5): "제목은 못 고치는데 우선순위는
  -- 고칠 수 있다"가 표현되어야 하므로 origin 으로 writable 을 유도하지 않는다.
  origin         origin_kind NOT NULL DEFAULT 'native',
  writable       text NOT NULL DEFAULT 'local'
                 CHECK (writable IN ('readonly', 'write_back', 'local')),
  can_pin            boolean NOT NULL DEFAULT true,   -- <16 R4> 배치 능력
  can_place_in_panel boolean NOT NULL DEFAULT true,
  deleted_at     timestamptz NULL,            -- soft delete(복원·undo)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_property_id_len CHECK (length(id) = 21),
  CONSTRAINT ck_property_name CHECK (length(name) > 0),
  CONSTRAINT ck_property_order CHECK (length(order_idx) > 0),
  -- 불변식 P1 의 절반: `title` 은 삭제할 수 없다. 나머지 절반("정확히 1개")은
  -- 아래 부분 UNIQUE 인덱스가 본다.
  CONSTRAINT ck_property_title_alive CHECK (type <> 'title' OR deleted_at IS NULL)
);
ALTER TABLE property ALTER COLUMN order_idx TYPE text COLLATE "C";

-- **[정정] 정본의 `UNIQUE (data_source_id, name)` 을 부분 인덱스로 좁혔다.**
--
-- 정본은 전체 UNIQUE 로 적었지만 이 표에는 **soft delete 가 있다.** 그대로 두면
-- "상태" 프로퍼티를 지운 뒤 같은 이름으로 다시 만들 수 없다 — 지운 행이 이름을
-- 영구히 점유한다. 사용자가 즉시 부딪히는 버그이고, `deleted_at` 이 복원·undo
-- 용이라는 정본 주석과도 어긋난다. 정본 §3.5 에 `[정정]` 으로 근거를 남겼다.
--
-- 대소문자는 **구분한다** <V-7 확정>. `select_option` 과 다르다(그쪽은 1차 출처가
-- 대소문자 무시 유니크라고 명시한다) — 같아 보인다고 맞추면 둘 다 틀린다.
CREATE UNIQUE INDEX ux_property_name ON property (data_source_id, name)
  WHERE deleted_at IS NULL;

-- 불변식 P1: data_source 당 `type='title'` 인 살아있는 property 는 **정확히 1개.**
-- 인덱스는 "1개 이하"를 막는다. "적어도 1개"는 data_source 를 만드는 트랜잭션이 지킨다.
CREATE UNIQUE INDEX ux_property_one_title ON property (data_source_id)
  WHERE type = 'title' AND deleted_at IS NULL;

CREATE INDEX ix_property_live ON property (data_source_id, order_idx)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE property IS
  'C-4. id 는 nanoid(21) text 이고 불변이다(P2). 이름 UNIQUE 는 살아있는 행에만 걸린다
   — 정본의 전체 UNIQUE 는 soft delete 와 충돌한다(§3.5 [정정]).';

-- ── select / multi_select / status 옵션 레지스트리 (F-03-04) ──
CREATE TABLE select_option (
  id          uuid PRIMARY KEY,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       option_color NOT NULL DEFAULT 'default',
  -- `status` 의 그룹(To-do / In progress / Complete). select 에서는 NULL 이다.
  group_id    uuid NULL,
  order_idx   text NOT NULL,

  CONSTRAINT ck_select_option_name CHECK (length(name) > 0),
  CONSTRAINT ck_select_option_order CHECK (length(order_idx) > 0)
);
ALTER TABLE select_option ALTER COLUMN order_idx TYPE text COLLATE "C";
-- 1차 출처: 옵션 이름은 **대소문자 무시** 유니크다(property.name 과 반대).
CREATE UNIQUE INDEX ux_select_option_name ON select_option (property_id, lower(name));
CREATE INDEX ix_select_option_order ON select_option (property_id, order_idx);

-- ──────────────────────────────────────────────────────────────────────
-- ④ page — DB 행 <C-3>
-- ──────────────────────────────────────────────────────────────────────
--
-- **DB 행은 `block` 테이블의 행이다.** `row_page` 같은 별도 엔티티를 만들지 않는다
-- (CLAUDE.md 절대 제약 3). 이 표는 그 block 행의 1:1 확장이고, 여기에 없는 것이
-- 중요하다 — 불변식 R4: **`order_idx` · `lifecycle` · `deleted_at` 이 없다.**
-- 행 순서는 `block.order_key`, 삭제는 `block.lifecycle` 이다. 편해 보인다고
-- 추가하면 순서와 삭제의 진실이 둘이 된다.

CREATE TABLE page (
  id             uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,   -- [X-2]
  -- `block.parent_id` 의 파생 캐시다. 정본이 그렇게 적었다 — 행을 data_source 로
  -- 거르는 질의가 block 을 거치지 않아도 되게 한다.
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  is_template    boolean NOT NULL DEFAULT false,
  unique_seq     bigint NULL,
  origin         origin_kind NOT NULL DEFAULT 'native',

  -- ── 파생 읽기 모델. 정본이 아니다. 애플리케이션이 직접 쓰지 않는다 ──
  --
  -- 불변식 R2: `page_property_value` 변경 트리거로만 갱신된다. 캐시가 깨지면
  -- 복구는 **항상 EAV 로부터의 재생성**이다. 캐시를 정본으로 승격하지 않는다.
  -- (트리거는 셀 쓰기 경로와 함께 오는 다음 마이그레이션이다. 지금은 빈 기본값.)
  properties_cache jsonb NOT NULL DEFAULT '{}',
  search_tsv       tsvector NULL,
  cache_version    bigint NOT NULL DEFAULT 0,

  CONSTRAINT ck_page_unique_seq CHECK (unique_seq IS NULL OR unique_seq > 0)
);
-- 불변식 R1 을 싸게 만든다: 모든 뷰/API 질의는 `is_template = false` 를 강제한다.
CREATE INDEX ix_page_rows ON page (data_source_id, is_template);
CREATE INDEX ix_page_search ON page USING gin (search_tsv);
-- `unique_id` 프로퍼티의 번호는 data_source 안에서 유니크해야 한다.
CREATE UNIQUE INDEX ux_page_unique_seq ON page (data_source_id, unique_seq)
  WHERE unique_seq IS NOT NULL;

COMMENT ON TABLE page IS
  'C-3. DB 행은 block 의 행이다. 이 표는 그 1:1 확장이고 order_idx·lifecycle·deleted_at 이
   **없다**(R4) — 순서는 block.order_key, 삭제는 block.lifecycle 이다.
   properties_cache·search_tsv 는 EAV 에서 재생성되는 파생이다(R2).';

-- ── 불변식 R3 을 DB 가 거부하게 만든다 ──
--
-- R3: `page.id` 가 참조하는 block 은 `type='page' AND parent_type='data_source'` 여야
--     한다. 이것은 **다른 표의 컬럼을 보는 조건**이라 CHECK 으로 쓸 수 없다
--     (CHECK 은 같은 행만 본다). 그래서 트리거다.
--
-- 주석으로만 남기지 않는 이유: 이 불변식이 깨지면 "DB 행이 아닌 블록이 행 목록에
-- 나타나거나" "행이 본문 블록으로 보이는" 상태가 된다. 판결 C-3 가 지키려는 것이
-- 정확히 그 경계다.
CREATE FUNCTION page_row_must_be_ds_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b record;
BEGIN
  SELECT type, parent_type, parent_id INTO b FROM block WHERE id = NEW.id;
  IF b IS NULL THEN
    RAISE EXCEPTION 'R3: page(%) 가 가리키는 block 이 없습니다', NEW.id;
  END IF;
  IF b.type <> 'page' OR b.parent_type <> 'data_source' THEN
    RAISE EXCEPTION 'R3: DB 행은 type=page AND parent_type=data_source 인 block 이어야 합니다 (got type=%, parent_type=%)',
      b.type, b.parent_type;
  END IF;
  -- `data_source_id` 는 `block.parent_id` 의 파생 캐시다. 어긋나면 행이 두 곳에
  -- 속한 것처럼 보인다 — 그 상태를 만들 수 있게 두지 않는다.
  IF b.parent_id <> NEW.data_source_id THEN
    RAISE EXCEPTION 'R3: page.data_source_id(%) 가 block.parent_id(%) 와 다릅니다',
      NEW.data_source_id, b.parent_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_page_row_r3
  BEFORE INSERT OR UPDATE OF id, data_source_id ON page
  FOR EACH ROW EXECUTE FUNCTION page_row_must_be_ds_child();

COMMENT ON FUNCTION page_row_must_be_ds_child() IS
  '불변식 R3. 다른 표를 봐야 하므로 CHECK 으로 쓸 수 없어 트리거다.
   page.data_source_id 가 block.parent_id 의 파생 캐시라는 것도 여기서 강제한다.';

-- ──────────────────────────────────────────────────────────────────────
-- ⑤ page_property_value — 셀 값 EAV 정본 <C-2/V-2>
-- ──────────────────────────────────────────────────────────────────────
--
-- 왜 EAV 인가: 프로퍼티가 data_source 당 최대 500개이고 사용자가 언제든 추가한다.
-- 컬럼으로 펼치면 `ALTER TABLE` 이 사용자 조작이 되고, 250,000행 테이블에서
-- 그것은 잠금이다.
--
-- **사이드카 컬럼이 이 표의 핵심이다.** `value jsonb` 만 있으면 정렬·필터가
-- 매번 jsonb 를 파싱해야 하고 인덱스를 걸 수 없다. 같은 트랜잭션에서 파생해
-- 함께 쓴다 — 나중에 채우는 설계로 가면 "정렬은 맞는데 필터는 틀린" 구간이 생긴다.

CREATE TABLE page_property_value (
  page_id     uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  value       jsonb NOT NULL,                -- 타입별 판별 유니온(정본)

  -- 정렬/필터/인덱싱용 사이드카. `value` 에서 파생, 같은 트랜잭션에서 동시 갱신.
  num_value   numeric NULL,
  text_value  text NULL,
  date_start  timestamptz NULL,
  date_end    timestamptz NULL,
  bool_value  boolean NULL,

  filled_by   text NULL
              CHECK (filled_by IN ('user', 'ai', 'automation', 'template', 'import', 'external')),
  manually_overridden boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (page_id, property_id),
  -- 범위가 거꾸로면 기간 필터가 조용히 0건을 돌려준다.
  CONSTRAINT ck_ppv_date_range CHECK (date_end IS NULL OR date_start IS NULL OR date_end >= date_start),
  -- `date_end` 만 있는 값은 의미가 없다(정본: end 없으면 단일 날짜).
  CONSTRAINT ck_ppv_date_end_needs_start CHECK (date_end IS NULL OR date_start IS NOT NULL)
);

-- 정본이 지정한 부분 인덱스 4개. 전체 인덱스로 만들면 NULL 이 대부분인 컬럼에
-- 쓸데없이 커진다 — 한 셀은 사이드카 중 **하나만** 채운다.
CREATE INDEX ix_ppv_num   ON page_property_value (property_id, num_value)  WHERE num_value IS NOT NULL;
CREATE INDEX ix_ppv_date  ON page_property_value (property_id, date_start) WHERE date_start IS NOT NULL;
CREATE INDEX ix_ppv_text  ON page_property_value (property_id, lower(text_value) text_pattern_ops)
                                                                          WHERE text_value IS NOT NULL;
CREATE INDEX ix_ppv_bool  ON page_property_value (property_id, bool_value) WHERE bool_value IS NOT NULL;
-- 한 행의 모든 셀을 읽는 질의(행 상세 패널)의 경로.
CREATE INDEX ix_ppv_by_page ON page_property_value (page_id);

COMMENT ON TABLE page_property_value IS
  'C-2/V-2. 셀 값의 유일한 정본. 사이드카 컬럼(num/text/date/bool)은 value 에서 파생되며
   **같은 트랜잭션에서** 갱신된다. 불변식 C1: 자동 메타 4종과 unique_id 는 여기에 행을
   만들지 않는다(block/page 에서 투영). C2: relation 은 relation_edge 가 정본이다.
   C3 [X-4]: 셀은 CRDT 밖이고 병합 단위는 (page_id, property_id) 행이다.';

-- ──────────────────────────────────────────────────────────────────────
-- ⑥ relation_edge — 자리 예약 (F-03-10 은 Phase 0 밖)
-- ──────────────────────────────────────────────────────────────────────
--
-- 마스터 문서가 relation 을 "없음. **`relation_edge` 테이블 자리만 예약**"으로
-- 잘랐다. 그래도 표를 지금 만드는 이유는 불변식 C2 다 — 셀 값 EAV 에 relation 을
-- **저장하지 않는다**는 규칙은 "그럼 어디에 저장하는가"가 있어야 성립한다.
-- 표가 없으면 그 규칙이 "아직 정하지 않았다"로 읽히고, 누군가 `value` 에 page id
-- 배열을 넣는 것이 자연스러워 보인다.
CREATE TABLE relation_edge (
  property_id  text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  from_page_id uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  to_page_id   uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  order_idx    text NOT NULL,                -- relation 셀 안의 표시 순서
  role         text NULL CHECK (role IN ('sub_item', 'dependency')),
  -- <15 R8> 불변식 E3: `owner='sync'` 인 엣지만 동기화가 삭제할 수 있다.
  owner        text NOT NULL DEFAULT 'user' CHECK (owner IN ('user', 'sync')),
  PRIMARY KEY (property_id, from_page_id, to_page_id),
  CONSTRAINT ck_relation_edge_order CHECK (length(order_idx) > 0)
);
ALTER TABLE relation_edge ALTER COLUMN order_idx TYPE text COLLATE "C";
CREATE INDEX ix_relation_edge_to_prop ON relation_edge (property_id, to_page_id);  -- rollup 무효화
CREATE INDEX ix_relation_edge_to      ON relation_edge (to_page_id);               -- 백링크

COMMENT ON TABLE relation_edge IS
  'relation 의 유일한 정본(C2). Phase 0 에서는 쓰지 않지만 표를 둔다 —
   "EAV 에 relation 을 넣지 않는다"는 규칙은 대안이 존재할 때만 성립한다.
   불변식 E2: sub_item/dependency 용 parent_row_id 같은 비정규화 컬럼을 두지 않는다.';
