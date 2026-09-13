-- 뷰 · 연산자 카탈로그 — W8-b (F-04-01 Table 뷰 · F-04-12 표시 프로퍼티 · F-03-17 연산자)
--
-- 정본: docs/research/00-canonical-data-model.md §3.6 (`view` · `view_property`,
--       불변식 VW1~VW3 · V1 · V2) · 판결 C-6 · U-1
--       03-database-core.md F-03-17 (연산자 전수표)
--
-- 마스터 문서 §5.2 W8-b: "Table view, 단일 레벨 AND 필터, 다중 정렬, 표시 프로퍼티,
--                         풀페이지 DB, keyset 커서 + '더 보기' 50행"
--
-- ──────────────────────────────────────────────────────────────────────
-- 뷰는 프론트엔드 로컬 상태가 아니다
-- ──────────────────────────────────────────────────────────────────────
--
-- F-03-17 의 2026 갱신: *"Views API 정식 출시(2026-03-19) … **즉 뷰도 이제 1급 API
-- 리소스다.** 클론 설계 시 뷰를 '프론트엔드 로컬 상태'로 두면 안 된다는 강한 신호."*
--
-- 그래서 필터·정렬이 서버에 저장되고, 같은 링크를 연 두 사람이 같은 행 집합을 본다.
--
-- ──────────────────────────────────────────────────────────────────────
-- `view_property` 는 행 단위 테이블이다. JSON 배열이 아니다 <C-6>
-- ──────────────────────────────────────────────────────────────────────
--
-- 불변식 V1: *"순서 변경은 반드시 단일 행 UPDATE. 배열이면 'A는 폭, B는 순서'가
-- 전체 LWW 로 충돌한다."* 두 사람이 각각 다른 컬럼을 만지는 것이 **같은 조작이
-- 아니어야** 한다 — 배열 하나를 통째로 쓰면 나중 저장이 앞의 것을 지운다.
--
-- 불변식 V2: `frozen` boolean 컬럼을 이 표에 두지 않는다. 고정은 경계 포인터
-- (`view.frozen_upto_property_id`)다 — 열별 boolean 이면 "3번째와 5번째만 고정"
-- 같은 표현 불가능한 상태를 만들 수 있다.
--
-- ──────────────────────────────────────────────────────────────────────
-- 연산자 카탈로그에 SQL 을 넣지 않는다 — F-03-17 의 두 요구를 함께 지킨다
-- ──────────────────────────────────────────────────────────────────────
--
-- F-03-17 은 두 가지를 말한다:
--   ① *"연산자 카탈로그는 코드가 아니라 **데이터**로 둔다:
--      `(property_type, operator) → sql_template` 테이블. 새 타입을 추가하면
--      필터 UI가 자동으로 따라온다."*
--   ② *"`filter_ast` 는 사용자 입력이다. **절대 문자열 연결로 SQL 을 만들지 말고**
--      파라미터 바인딩 + 화이트리스트 연산자 매핑으로만 컴파일하라."*
--
-- `sql_template` 을 DB 에 두고 스플라이스하면 ①은 지키지만 ②의 정신을 어긴다 —
-- 컴파일러의 동작이 DB 행에 달리고, 그 표에 쓰기가 닿는 날 곧 SQL 주입이다.
--
-- **그래서 이 표에는 SQL 이 없다.** 담는 것은 `(타입, 연산자)` 쌍과 **UI 메타데이터**
-- (값이 몇 개 필요한가 · 한국어 라벨 · 표시 순서)뿐이다. ①이 원한 효과("새 타입을
-- 추가하면 필터 UI 가 자동으로 따라온다")는 그것으로 충분하다.
--
-- SQL 조각은 `src/lib/database/filter.ts` 의 **화이트리스트 맵**에 있다(서버 저작,
-- DB 를 읽지 않는다). 두 곳이 어긋나지 않게 하는 것은 테스트다 —
-- `level_capability`(DB)와 `levels.ts`(TS) 매트릭스를 `levels.db.test.ts` 가 맞추는
-- 것과 **같은 패턴**이고, 이 저장소에 이미 선례가 있다.

-- ──────────────────────────────────────────────────────────────────────
-- ① view
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE view (
  id uuid PRIMARY KEY,
  -- <16 R2> 같은 표가 DB 뷰 탭 · 레이아웃 탭 · 대시보드 위젯 세 자리에 쓰인다.
  -- 불변식 VW3: 탭 뷰라고 별도 저장 경로를 만들지 않는다.
  owner_kind text NOT NULL DEFAULT 'database_view'
    CHECK (owner_kind IN ('database_view', 'layout_tab', 'dashboard_widget')),
  database_id    uuid NULL REFERENCES database(id) ON DELETE CASCADE,
  -- 대시보드 위젯이면 NULL 이다.
  data_source_id uuid NULL REFERENCES data_source(id) ON DELETE CASCADE,

  name      text NULL,
  type      text NOT NULL,                 -- table|board|list|calendar|timeline|gallery|chart|form|map|dashboard
  order_idx text NOT NULL,                 -- 뷰 탭 순서

  -- FilterNode 트리. 깊이 상한은 <C-15> 의 MAX_FILTER_DEPTH=3 이고 **쓰기 경로에서만**
  -- 검증한다(정본: 읽기 경로에 걸면 나중에 상한을 낮출 때 기존 뷰가 통째로 안 열린다).
  filter         jsonb NULL,
  sorts          jsonb NULL,
  quick_filters  jsonb NULL,
  group_by       jsonb NULL,
  sub_group_by   jsonb NULL,
  configuration  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- type 별 판별 유니온

  -- <C-6부속> **경계 포인터**다. 열별 boolean 이 아니다(불변식 V2).
  frozen_upto_property_id text NULL REFERENCES property(id) ON DELETE SET NULL,
  load_limit int NOT NULL DEFAULT 50,
  -- L2 층. 레이아웃(page_layout)에 두지 않는다 — 뷰마다 다를 수 있다.
  open_pages_in text NOT NULL DEFAULT 'side_peek'
    CHECK (open_pages_in IN ('side_peek', 'center_peek', 'full_page')),

  dashboard_view_id uuid NULL REFERENCES view(id) ON DELETE CASCADE,
  dashboard_layout  jsonb NULL,
  sub_item_display  text NULL,
  sub_item_filter_scope text NULL,

  -- NULL = 공유 뷰, 값이 있으면 개인 뷰.
  owner_user_id uuid NULL REFERENCES "user"(id),
  default_template_page_id uuid NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_view_order CHECK (length(order_idx) > 0),
  CONSTRAINT ck_view_load_limit CHECK (load_limit > 0 AND load_limit <= 200),
  -- 대시보드 위젯이 아니면 data_source 가 있어야 한다. 없으면 어떤 행을
  -- 보여줘야 하는지 알 수 없는 뷰가 된다.
  CONSTRAINT ck_view_needs_source CHECK (
    owner_kind = 'dashboard_widget' OR data_source_id IS NOT NULL)
);
ALTER TABLE view ALTER COLUMN order_idx TYPE text COLLATE "C";

CREATE INDEX ix_view_by_source ON view (data_source_id, order_idx)
  WHERE owner_kind = 'database_view';
-- 불변식 VW2: owner_kind='layout_tab' 인 뷰는 DB 뷰 탭 목록에 노출되지 않는다.
--             위 부분 인덱스가 그 질의의 모양을 고정한다.
CREATE INDEX ix_view_by_database ON view (database_id);

COMMENT ON TABLE view IS
  'C-6. 뷰는 서버 자원이다(Views API 가 1급 리소스로 출시됐다). filter·sorts 는 AST
   이고 문자열 SQL 을 저장하지 않는다. frozen 은 경계 포인터 한 개다(V2).';

-- ──────────────────────────────────────────────────────────────────────
-- ② view_property — 행 단위 (불변식 V1)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE view_property (
  view_id     uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  -- ★ 기본값이 `false` 다(정본 그대로). 새 프로퍼티가 **모든 뷰에 자동으로
  --   나타나지 않는다** — 행이 없으면 안 보이는 것이고, 보이게 하려면 행을 만든다.
  visible     boolean NOT NULL DEFAULT false,
  order_idx   text NOT NULL,
  width       int NULL,
  wrap        boolean NOT NULL DEFAULT false,
  date_format text NULL,
  time_format text NULL,
  status_show_as text NULL,
  card_property_width_mode text NULL,
  calculation text NULL,
  -- ★ `frozen` 컬럼이 **없다**(불변식 V2). 고정은 view.frozen_upto_property_id 다.

  PRIMARY KEY (view_id, property_id),
  CONSTRAINT ck_view_property_order CHECK (length(order_idx) > 0),
  CONSTRAINT ck_view_property_width CHECK (width IS NULL OR width > 0)
);
ALTER TABLE view_property ALTER COLUMN order_idx TYPE text COLLATE "C";
CREATE INDEX ix_view_property_order ON view_property (view_id, order_idx);

COMMENT ON TABLE view_property IS
  'C-6 / 불변식 V1. 행 단위 테이블이고 JSON 배열이 아니다 — 배열이면 "A는 폭, B는 순서"를
   각각 바꾼 두 저장이 전체 LWW 로 충돌한다. frozen 컬럼은 없다(V2).';

-- ──────────────────────────────────────────────────────────────────────
-- ③ filter_operator — 연산자 카탈로그 (SQL 없음. 머리말 참조)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE filter_operator (
  property_type property_type NOT NULL,
  operator      text NOT NULL,
  -- 값이 몇 개 필요한가. `is_empty` 는 0, 나머지는 1.
  -- 화면이 값 입력칸을 그릴지 말지를 이 값으로 정한다.
  arity         smallint NOT NULL CHECK (arity IN (0, 1)),
  label_ko      text NOT NULL,
  order_idx     smallint NOT NULL,

  PRIMARY KEY (property_type, operator),
  CONSTRAINT ck_filter_operator_label CHECK (length(label_ko) > 0)
);
CREATE INDEX ix_filter_operator_order ON filter_operator (property_type, order_idx);

COMMENT ON TABLE filter_operator IS
  'F-03-17 의 "연산자 카탈로그를 데이터로 둔다". **SQL 을 담지 않는다** — 같은 절이
   "절대 문자열 연결로 SQL 을 만들지 말라"고도 경고하기 때문이다. SQL 조각은
   src/lib/database/filter.ts 의 화이트리스트 맵(서버 저작)에 있고, 두 곳의 일치는
   filter.db.test.ts 가 강제한다 — level_capability 와 levels.ts 를 맞추는 것과 같은 패턴.';

-- ── 카탈로그 시딩 ──
--
-- MVP 6종(title · rich_text · number · select · checkbox · date)만 넣는다.
-- 나머지 18종은 그 타입을 구현할 때 같은 표에 행을 더한다 — 그 순간 필터 UI 가
-- 코드 변경 없이 따라온다(F-03-17 이 원한 효과).
--
-- 연산자 집합은 F-03-17 의 전수표(API `2025-09-03`)를 그대로 옮긴 것이다.
-- **뺀 것**: 상대 날짜(`past_week`·`this_week`·`today` 류). F-03-17 의 현실적
-- 대안이 *"상대 날짜는 today ± N일 로 단순화"* 라고 했고, 그것은 평가 시점 의존
-- 노드여서 결과 캐시 키가 (view_id, actor_id, 평가일)로 쪼개진다(불변식 VW1).
-- 캐시를 만들기 전에 넣으면 "어제 본 것과 다른 결과"를 설명할 수 없다.

INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx) VALUES
  -- 텍스트 계열 (title · rich_text). F-03-17 전수표와 동일.
  ('title', 'contains',          1, '포함',        1),
  ('title', 'does_not_contain',  1, '포함하지 않음', 2),
  ('title', 'equals',            1, '같음',        3),
  ('title', 'does_not_equal',    1, '같지 않음',    4),
  ('title', 'starts_with',       1, '시작함',      5),
  ('title', 'ends_with',         1, '끝남',        6),
  ('title', 'is_empty',          0, '비어 있음',    7),
  ('title', 'is_not_empty',      0, '비어 있지 않음', 8),

  ('rich_text', 'contains',          1, '포함',        1),
  ('rich_text', 'does_not_contain',  1, '포함하지 않음', 2),
  ('rich_text', 'equals',            1, '같음',        3),
  ('rich_text', 'does_not_equal',    1, '같지 않음',    4),
  ('rich_text', 'starts_with',       1, '시작함',      5),
  ('rich_text', 'ends_with',         1, '끝남',        6),
  ('rich_text', 'is_empty',          0, '비어 있음',    7),
  ('rich_text', 'is_not_empty',      0, '비어 있지 않음', 8),

  ('number', 'equals',                      1, '같음',        1),
  ('number', 'does_not_equal',              1, '같지 않음',    2),
  ('number', 'greater_than',                1, '초과',        3),
  ('number', 'greater_than_or_equal_to',    1, '이상',        4),
  ('number', 'less_than',                   1, '미만',        5),
  ('number', 'less_than_or_equal_to',       1, '이하',        6),
  ('number', 'is_empty',                    0, '비어 있음',    7),
  ('number', 'is_not_empty',                0, '비어 있지 않음', 8),

  -- ★ checkbox 에 `is_empty` 가 **없다**. null 상태가 없으므로(전수표 명시).
  ('checkbox', 'equals',         1, '이다',    1),
  ('checkbox', 'does_not_equal', 1, '아니다',  2),

  ('select', 'equals',         1, '같음',        1),
  ('select', 'does_not_equal', 1, '같지 않음',    2),
  ('select', 'is_empty',       0, '비어 있음',    3),
  ('select', 'is_not_empty',   0, '비어 있지 않음', 4),

  ('date', 'equals',        1, '같음',        1),
  ('date', 'before',        1, '이전',        2),
  ('date', 'after',         1, '이후',        3),
  ('date', 'on_or_before',  1, '이전이거나 같음', 4),
  ('date', 'on_or_after',   1, '이후거나 같음', 5),
  ('date', 'is_empty',      0, '비어 있음',    6),
  ('date', 'is_not_empty',  0, '비어 있지 않음', 7);
