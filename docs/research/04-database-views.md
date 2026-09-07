# 04. 데이터베이스 뷰 & 쿼리

> 조사일: 2026-09-06 / 기준 API 버전: Notion API `2025-09-03` (Views API 도입 버전)
> 태그 규칙: `[추정]` = 공개 문서 없이 관찰·추론한 내용 / `[확인필요]` = 검증 필요
>
> **개정 이력**
> - 2026-09-06 (1차 GAP) — 기능 17개 → **24개**(F-04-18 form / F-04-19 map / F-04-20 dashboard / F-04-21 페이지 열림 방식 / F-04-22 sub-item / F-04-23 다중 data source / F-04-24 실시간 동기화 추가). 1차 출처 재확인으로 (a) board 그룹 프로퍼티 부재 시 status 자동 생성, (b) relation·formula 그룹 불가(FAQ 원문), (c) chart configuration 필드 구조, (d) data_source 조인 테이블 필요성, (e) 필터 중첩 깊이 2 vs 3 원문 대조를 정정했고, F-04-16/17/13 의 난이도 등급을 상향했다.
> - 2026-09-06 (2차 GAP, 이어서) — 기능 24개 → **28개**(F-04-25 권한·잠금 / F-04-26 뷰 단위 내보내기 / F-04-27 DB 내 검색 / F-04-28 템플릿·뷰별 기본 템플릿 추가). F-04-01/02/06/08/09/10/11/12/14 의 **엣지 케이스를 7축(빈 값·중첩·동시편집·삭제된 참조·권한 없음·대용량·순환 참조) 기준으로 재작성**하고, 한 줄로 때워져 있던 데이터 모델 함의를 테이블 스키마·인덱스 수준까지 확장했다. 신규 1차 출처 5건(customize-your-database, assign-custom-database-permissions, export-your-content, database-templates, search)으로 (f) `Lock database` 원문, (g) `Can edit content` 등급이 **linked DB 에서는 뷰 생성 가능**, (h) 내보내기 범위가 `current view` / `default view` 2택, (i) DB 검색 대상이 **제목 + 프로퍼티**(본문 제외), (j) 헬프센터의 필터 중첩 `three layers deep` 원문을 각각 확인했다.

## 요약

- 노션의 데이터베이스는 **데이터(data source)와 표현(view)이 분리된 구조**다. 같은 행 집합을 table/board/list/calendar/gallery/timeline/chart/form/map/dashboard 중 하나로 렌더링하는 view 객체가 N개 붙는다.
- view는 스스로 `filter`, `sorts`, `group_by`, `sub_group_by`, 그리고 타입별 `configuration`(표시 프로퍼티·컬럼 폭·카드 크기·커버 소스·날짜 프로퍼티 등)을 **독립적으로** 저장한다. 뷰 설정 변경은 데이터를 바꾸지 않는다.
- 단, **board 드래그·calendar 드래그·timeline 리사이즈는 예외적으로 데이터(셀 값)를 직접 변경**한다. 이 지점이 "뷰 = 읽기 전용 렌즈"라는 단순 모델이 깨지는 곳이며 클론 구현의 핵심 난제다.
- 쿼리는 `filter`(AND/OR 중첩) → `sorts`(다중 키) → `group`(버킷) → `page`(load limit / cursor) 순의 파이프라인으로 정의된다.
- 데이터베이스는 최대 250,000 rows / 500 properties를 지원하며, 뷰 단에서는 load limit(10/25/50/100)과 커서 페이지네이션으로 렌더 부하를 제어한다.
- 뷰 타입 10종 중 **form / map / dashboard 는 나머지 7종과 성격이 다르다**: form 은 읽기 뷰가 아니라 **쓰기 진입점**, map 은 place 프로퍼티 전용 + **동시 표시 100개 상한**, dashboard 는 `data_source_id = null` 인 **위젯 컨테이너**(행당 4개, 총 12개 위젯)다. 이 3종을 레이아웃 하나 더로 취급하면 설계가 틀어진다.
- 뷰는 행 목록뿐 아니라 **행 열림 방식(`side peek` / `center peek` / `full page`)과 sub-item 표시·필터 범위**도 저장한다. 즉 뷰 설정의 범위는 filter/sort/group보다 넓다.
- 실시간 동기화는 이 도메인의 숨은 XL 항목이다. 노션은 클라이언트 RecordCache(IndexedDB/SQLite) → `SaveTransactions` 검증 → MessageStore WebSocket 알림 → `syncRecordValues` 재조회 구조로 동작한다고 공식 엔지니어링 글에 서술한다. 뷰는 쿼리 결과 집합이므로 **행 값 변경이 뷰 멤버십 변경(필터 진입/이탈)으로 이어지는 재평가 문제**가 별도로 존재한다(F-04-24).

- **뷰 설정의 저장 단위(뷰)와 편집 권한의 판정 단위(database)는 다르다.** 헬프센터 원문 `Each database view has its own settings.` 와, database 전용 등급 `Can edit content`(구조는 못 바꾸고 데이터만 편집) + `Lock database` 토글이 이 어긋남을 만든다. 권한을 뷰 단위로 설계하면 클론이 어긋난다(F-04-25).
- 뷰가 결정하는 것은 화면만이 아니다 — **내보내기 파일의 스키마**(current view 기준 CSV 열 = 표시 프로퍼티, F-04-26)와 **`+ New` 가 적용할 기본 템플릿**(F-04-28)까지 뷰에 매달린다.
- 툴바 검색(F-04-27)은 필터와 별개로 존재하며 **뷰에 저장되지 않는 임시 조건**이다. 대상은 제목 + 프로퍼티 값이고 본문 블록은 포함되지 않는다.

출처: https://www.notion.com/help/data-sources-and-linked-databases , https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/optimize-database-load-times-and-performance , https://www.notion.com/help/customize-your-database

---

## 핵심 개념 / 데이터 모델

### 계층 구조

```
workspace
└── database              (컨테이너 / 블록으로 페이지에 배치됨)
    ├── data_source[]     (실제 행 집합. 1 database = 1~N data_source)
    │   ├── property[]    (스키마: title, text, number, select, status, date, relation, rollup, formula ...)
    │   └── page[]        (= row. 각 row 는 그 자체로 페이지이며 본문 block tree 를 가짐)
    └── view[]            (표현 레이어. 최소 1개 필수)
```

| 개념 | 정의 | 클론 구현 시 주의 |
|---|---|---|
| `database` | 페이지 안에 놓이는 블록. `is_inline` 여부로 인라인/풀페이지 렌더 결정 | 블록 트리와 DB 엔티티를 잇는 접합점 |
| `data_source` | `A set of pages in a database`(헬프센터 원문). 1 database 가 여러 data source 를 가질 수 있다. **UI 표현이 탭인지 다른 형태인지는 문서에 명시되지 않음** `[확인필요]` | MVP 에서는 1:1 로 고정해도 무방하나 **FK 는 반드시 data_source 를 향하게** (F-04-23) |
| `view` | `data_source_id`를 가리키고 그 위에 filter/sort/group/layout config를 얹음 | 항상 최소 1개 존재 보장 필요 |
| linked database | 다른 곳의 data_source를 참조하는 database 블록 | 뷰 설정은 독립, 스키마·행은 원본과 공유 |

출처: https://www.notion.com/help/data-sources-and-linked-databases

### 의사 스키마 (관계형 기준)

```sql
-- 컨테이너
CREATE TABLE database (
  id              uuid PRIMARY KEY,
  parent_block_id uuid,               -- 인라인이면 페이지 내 블록, 풀페이지면 부모 페이지
  title           jsonb,              -- rich text
  icon            jsonb, cover jsonb,
  is_inline       boolean NOT NULL DEFAULT true,
  is_full_width   boolean NOT NULL DEFAULT false,
  -- 데이터베이스 단위 설정 (뷰 아님)
  dependency_shift_mode text          -- 'overlap_only' | 'maintain_gap' | 'never'
    CHECK (dependency_shift_mode IN ('overlap_only','maintain_gap','never')),
  avoid_weekends  boolean DEFAULT false,
  is_locked       boolean NOT NULL DEFAULT false,  -- Lock database (F-04-25)
  created_time timestamptz, last_edited_time timestamptz
);

CREATE TABLE data_source (
  id uuid PRIMARY KEY,
  owner_database_id uuid REFERENCES database(id),  -- 원본(생성된) database
  name text
);

-- [정정] 한 data_source 가 여러 database 에 연결될 수 있으므로(linked data source)
-- data_source.database_id 단일 FK 로는 표현되지 않는다 → 조인 테이블 필수 (F-04-23)
CREATE TABLE database_data_source (
  database_id    uuid REFERENCES database(id) ON DELETE CASCADE,
  data_source_id uuid REFERENCES data_source(id),
  position  text,                      -- 소스 표시 순서 (fractional index)
  is_linked boolean NOT NULL DEFAULT false,  -- true = 원본이 다른 database 인 연결
  PRIMARY KEY (database_id, data_source_id)
);

-- 스키마
CREATE TABLE property (
  id           text,                   -- data_source 내 유니크 (짧은 문자열 id)
  data_source_id uuid REFERENCES data_source(id),
  name         text NOT NULL,
  type         text NOT NULL,          -- title|rich_text|number|select|multi_select|status|
                                       -- date|people|files|checkbox|url|email|phone|formula|
                                       -- relation|rollup|created_time|created_by|
                                       -- last_edited_time|last_edited_by|unique_id|verification|button|place
  config       jsonb NOT NULL,         -- select options, number format, relation target 등
  position     text,                   -- 스키마 상 기본 순서 (뷰별 순서와 별개)
  PRIMARY KEY (data_source_id, id)
);

-- 행
CREATE TABLE row_page (
  id uuid PRIMARY KEY,
  data_source_id uuid REFERENCES data_source(id),
  properties jsonb NOT NULL,           -- { "<property_id>": <typed value> }
  position   text,                     -- 수동 정렬용 fractional index (기본 뷰 순서)
  in_trash   boolean DEFAULT false,
  created_time timestamptz, last_edited_time timestamptz,
  created_by uuid, last_edited_by uuid
);

-- 표현 레이어
CREATE TABLE view (
  id uuid PRIMARY KEY,
  database_id    uuid REFERENCES database(id),
  data_source_id uuid REFERENCES data_source(id),   -- dashboard 위젯이면 NULL 가능
  name  text,
  type  text NOT NULL,                 -- table|board|list|calendar|timeline|gallery|chart|form|map|dashboard
  position text,                       -- 뷰 탭 순서
  filter  jsonb,                       -- 아래 FilterNode 재귀 구조
  sorts   jsonb,                       -- [{ property_id, direction }] 배열 순서 = 우선순위
  quick_filters jsonb,                 -- 필터바에 노출할 프로퍼티 목록
  group_by     jsonb,                  -- GroupSpec
  sub_group_by jsonb,                  -- GroupSpec (board 전용)
  configuration jsonb NOT NULL,        -- type 별 discriminated union
  load_limit int DEFAULT 50,           -- 10|25|50|100 (인라인 DB)
                                       -- [확인필요] 공개 Views API 의 configuration 필드 목록에는
                                       -- load limit 이 없다. UI 전용 설정이거나 미노출 필드일 가능성
  open_pages_in text DEFAULT 'side_peek',     -- 'side_peek'|'center_peek'|'full_page' (F-04-21)
  dashboard_view_id uuid REFERENCES view(id), -- 위젯 뷰일 때 부모 dashboard 뷰 (F-04-20)
  dashboard_layout jsonb,                     -- dashboard 전용: rows[] x cols (행당 4, 총 12)
  sub_item_display text,               -- 'nested_toggle'|'flattened'|'card_property' (F-04-22)
  sub_item_filter_scope text,          -- 'parents_only'|'parents_and_sub_items'|'sub_items_only'
  owner_user_id uuid,                  -- NULL = 전체 공유 뷰, 값 있으면 개인 뷰
  default_template_page_id uuid,       -- 이 뷰에서 + New 시 자동 적용할 템플릿 (F-04-28)
  created_time timestamptz, last_edited_time timestamptz
);

-- 데이터베이스 단위 권한 (F-04-25). 페이지 ACL 과 별개 축이 아니라
-- object_type 으로 구분되는 같은 테이블에 두는 편이 상속 계산이 단순하다.
CREATE TABLE acl (
  object_type text NOT NULL,           -- 'database' | 'data_source' | 'page' | 'block'
  object_id   uuid NOT NULL,
  subject_type text NOT NULL,          -- 'user' | 'group' | 'workspace' | 'public'
  subject_id  uuid,
  level text NOT NULL                  -- 'full_access'|'edit'|'edit_content'|'comment'|'view'
    CHECK (level IN ('full_access','edit','edit_content','comment','view')),
  PRIMARY KEY (object_type, object_id, subject_type, subject_id)
);

-- 데이터베이스 템플릿 (F-04-28)
CREATE TABLE database_template (
  id uuid PRIMARY KEY,
  data_source_id uuid REFERENCES data_source(id) ON DELETE CASCADE,
  name text,
  template_page_id uuid REFERENCES row_page(id),   -- 템플릿 본체(= 특수 상태의 행 페이지)
  position text,
  is_database_default boolean NOT NULL DEFAULT false,  -- DB 전역 기본
  repeat_rule jsonb,                   -- {freq:'daily'|'weekly'|'monthly'|'yearly', interval, start_at, tz}
  parent_template_id uuid REFERENCES database_template(id)  -- 중첩 템플릿(최대 3단계)
);

-- 뷰별 프로퍼티 표시 설정 (configuration.properties 를 정규화한 형태)
CREATE TABLE view_property (
  view_id uuid REFERENCES view(id) ON DELETE CASCADE,
  property_id text NOT NULL,
  visible  boolean DEFAULT false,
  position text,                       -- 뷰 내 표시 순서
  width    int,                        -- px, table 전용
  wrap     boolean DEFAULT false,
  date_format text, time_format text,  -- 'full'|'short'|'relative' / '12_hour'|'24_hour'|'hidden'
  status_show_as text,                 -- 'select' | 'checkbox'
  card_property_width_mode text,       -- 'full_line' | 'inline'
  calculation text,                    -- 열 하단 집계: 'count_all'|'sum'|'average'|...
  PRIMARY KEY (view_id, property_id)
);

-- 뷰별/그룹별 수동 행 순서 (board 드래그, 그룹 내 재정렬용)
CREATE TABLE row_position (
  view_id   uuid REFERENCES view(id) ON DELETE CASCADE,
  group_key text NOT NULL DEFAULT '',  -- group 미사용 시 ''
  row_id    uuid REFERENCES row_page(id) ON DELETE CASCADE,
  position  text NOT NULL,             -- fractional index
  PRIMARY KEY (view_id, group_key, row_id)
);

-- 개인 필터/정렬 (Save for everyone 하지 않은 경우)
CREATE TABLE view_user_override (
  view_id uuid REFERENCES view(id) ON DELETE CASCADE,
  user_id uuid,
  filter  jsonb, sorts jsonb,
  PRIMARY KEY (view_id, user_id)
);
```

### FilterNode (재귀 구조)

```ts
type FilterNode = PropertyFilter | CompoundFilter | TimestampFilter;

interface CompoundFilter {           // 정확히 하나의 키만 존재
  and?: FilterNode[];
  or?:  FilterNode[];
}

interface PropertyFilter {
  property: string;                  // property id or name
  [conditionType: string]: {         // 'rich_text' | 'number' | 'date' | 'select' | ...
    [operator: string]: unknown;     // 'equals' | 'contains' | 'is_empty' | ...
  };
}

interface TimestampFilter {          // property 필드 불필요
  timestamp: 'created_time' | 'last_edited_time';
  created_time?: DateCondition;
  last_edited_time?: DateCondition;
}
```

- **중첩 깊이 문서 불일치(1차 출처 원문 재확인)**: API 레퍼런스는 `Nesting is supported up to two levels deep`, 헬프센터는 advanced filter가 `up to three layers deep` 라고 각각 명시한다. 두 문장 모두 1차 출처에서 직접 확인했다.
  - 해석 `[추정]`: 서버 엔진은 3단계까지 지원하되 **공개 API 계약이 2단계로 더 보수적으로 고정**된 것으로 보인다. UI가 3단계 필터를 저장할 수 있는데 엔진 제약이 2단계일 수는 없기 때문이다. 노션이 이 관계를 명시한 문서는 없으므로 `[확인필요]`.
  - 클론 권고: 깊이 상한을 **상수 하나(MAX_FILTER_DEPTH = 3)** 로 두고 API 진입점·UI 양쪽이 같은 검증기를 호출한다. 초과는 400 거부. 단 **읽기 경로에는 깊이 검증을 걸지 않는다** — 나중에 상한을 낮추면 기존 뷰가 통째로 열리지 않게 된다.
- 출처: https://developers.notion.com/reference/filter-data-source-entries , https://www.notion.com/help/views-filters-and-sorts

### GroupSpec

```ts
interface GroupSpec {
  type: 'select'|'multi_select'|'status'|'person'|'date'|'text'|'number'|'checkbox'|'relation';
  property_id: string;
  sort: 'manual' | 'ascending' | 'descending';   // required
  hide_empty_groups?: boolean;
  start_day_of_week?: number;          // date 그룹
  date_granularity?: 'relative'|'day'|'week'|'month'|'year';
  text_mode?: 'exact' | 'alphabet_prefix';
  number_bucket?: { size: number, start?: number };
  status_mode?: 'group' | 'option';    // status 는 group(todo/in_progress/complete) 또는 개별 option
  group_order?: string[];              // manual 정렬 시 그룹 키 순서
  hidden_groups?: string[];            // 눈 아이콘으로 숨긴 그룹 키
}
```

- **그룹 불가 타입(1차 출처 확인)**: 헬프센터 boards FAQ는 `Relation and formula properties cannot currently be used for grouping` 이라고 명시한다. 반면 같은 문서 본문은 board 기본 그룹 후보로 `a select, person, multi-select, or relation property` 를 든다 → **노션 자체 문서 내 모순**. 클론은 **relation·formula 그룹 미지원**으로 확정하는 편이 안전하다(파생값 그룹은 인덱스가 불가능해 성능도 나쁘다).
- 위 `GroupSpec` 필드 중 `hide_empty_groups` / `group_order` / `hidden_groups` / `text_mode` / `number_bucket` 은 공개 문서에서 필드명까지 확인되지 않았다 `[확인필요]`. **필드명은 클론 자체 규약으로 두되, 의미(빈 그룹 숨김 / 수동 그룹 순서 / 개별 그룹 숨김 / 텍스트 버킷 / 숫자 구간화)는 헬프센터에서 확인된 UI 동작에 1:1 대응**시킨다.

출처: https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/boards , https://www.notion.com/help/views-filters-and-sorts

### 쿼리 파이프라인

```
rows(data_source)
  → WHERE evaluate(filter ∧ user_override_filter)   -- 재귀 트리 평가, 서버측
  → ORDER BY sorts[0], sorts[1], ... , position, id  -- 마지막 tie-breaker 필수
  → GROUP INTO buckets(group_by [, sub_group_by])    -- 그룹별 카운트 + 그룹별 상위 N
  → LIMIT load_limit / cursor 페이지네이션
```

---

## 기능 명세

### F-04-01 뷰 컨테이너 & 뷰 타입 전환

- **한 줄 정의**: 하나의 데이터 집합 위에 여러 개의 이름 붙은 뷰를 만들고, 탭으로 전환하며, 각 뷰의 레이아웃 타입을 바꾼다.
- **사용자 시나리오**: DB 상단 뷰 탭 우측 `+` 클릭 → 레이아웃 선택 팝오버(Table/Board/List/Calendar/Gallery/Timeline/Chart/Form) → 이름 입력 → 뷰 생성. 기존 탭 더블클릭 시 이름 편집, `···` 클릭 시 Rename·Duplicate·Copy link to view·Delete 메뉴. 탭 드래그로 순서 변경.
- **동작 상세**:
  - 뷰 생성 시 기본값: 이름 = 레이아웃 타입명, filter/sorts 없음, 표시 프로퍼티는 title + 앞쪽 소수 개 `[추정]`.
  - 타입 전환 시 filter/sorts는 **유지**, 타입 고유 설정은 초기화된다. 예: table→board 전환 시 `group_by`가 없으면 status → select → person → multi_select 순으로 자동 선택된다(board 기본 그룹 규칙).
  - 데이터베이스는 **항상 최소 1개 뷰를 가져야 한다**. 마지막 뷰는 삭제 불가(API: "Cannot delete last view in database").
  - 뷰 URL은 `?v=<view_id>` 형태의 딥링크를 가지며, 뷰 객체에 `url` 필드로 노출된다.
  - API 엔드포인트: `GET /v1/views`(database_id/data_source_id 필터), `GET /v1/views/{id}`, `POST /v1/views`, `PATCH /v1/views/{id}`(모든 필드 optional, null 전달로 해제), `DELETE /v1/views/{id}`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 마지막 뷰 삭제 시도 | 삭제 버튼 비활성 / 409 에러 |
  | board 전환인데 그룹 가능한 프로퍼티가 없음 | **확인됨**: 노션은 status 프로퍼티가 있으면 자동 선택하고, select/person/multi_select 도 없으면 **status 프로퍼티를 자동 생성**한다(help/boards). 클론도 동일하게 그룹 프로퍼티 자동 생성 후 전환을 택하면 전환 실패 상태 자체가 사라진다 |
  | calendar/timeline 전환인데 date 프로퍼티 없음 | `date_property_id`가 required이므로 date 프로퍼티 생성 유도 후 전환 |
  | group_by 프로퍼티가 삭제됨 | 해당 뷰는 group 해제 상태로 폴백. 크래시 금지 |
  | 동시편집: A가 filter 편집, B가 sort 편집 | 서로 다른 필드 → 필드 단위 LWW 병합 `[추정]` |
  | 뷰가 수십 개 | 탭 바 가로 스크롤 + `N more` 드롭다운 |
  | **빈 값**: 뷰 이름 미입력 | 레이아웃 타입명(`Table`, `Board` …)을 폴백 이름으로. 빈 문자열 저장은 허용하되 렌더에서 폴백 — 이름을 NOT NULL 로 강제하면 rename 도중 저장이 막힌다 |
  | **빈 값**: data source 에 행이 0개 | 뷰는 정상 렌더 + 빈 상태 안내 + `+ New`. 뷰 자체를 숨기면 안 됨 |
  | **중첩**: 행 페이지 본문 안의 인라인 DB 가 또 뷰를 가짐 | 뷰 트리가 아니라 **블록 트리의 중첩**이다. 렌더 깊이 상한(예: 5) 필요(F-04-14) |
  | **삭제된 참조**: `configuration` 이 참조하는 프로퍼티(date_property_id, group_by, cover 소스 등) 삭제 | **뷰를 삭제하지 말고 해당 필드만 null 로 폴백**하고 "설정 필요" 배너를 띄운다. 프로퍼티 삭제가 뷰 삭제로 전파되면 사용자가 되돌릴 방법이 없다 |
  | **삭제된 참조**: 삭제된 뷰의 `?v=` 딥링크로 접근 | 기본 뷰로 리다이렉트 + 토스트. 404 로 떨어뜨리지 않는다 |
  | **순환 참조**: dashboard 위젯이 자기 자신(또는 조상 dashboard)을 가리킴 | `dashboard_view_id` self-FK 에 조상 체인 검사(F-04-20) |
  | **권한 없음**: 읽기 권한만 있는 사용자 | 뷰 생성/삭제/설정 변경 불가, 개인 필터(F-04-17)만 허용. `+` 버튼과 탭 컨텍스트 메뉴는 렌더하지 않는다(비활성 표시보다 미노출이 안전) |
  | **권한 없음**: database 가 잠긴 상태(F-04-25) | 편집 권한자여도 뷰 CRUD 차단. 잠금 해제 안내 |
  | **대용량**: 뷰 개수 상한 | 공개 문서에 뷰 개수 상한 명시 없음 `[확인필요]`. 클론 권고: DB 당 뷰 50개 소프트 상한 — 뷰마다 실시간 구독이 하나씩 붙기 때문(F-04-24) |
- **데이터 모델 함의**:
  - 위 `view` 테이블이 전부이며 **뷰를 위한 별도 조인 테이블은 필요 없다**. 핵심은 세 가지 제약이다.
  - (1) 최소 1뷰: `DELETE` 트랜잭션 안에서 `SELECT count(*) FROM view WHERE database_id = ? FOR UPDATE` 카운트 체크. 애플리케이션 레벨 체크만으로는 동시 삭제 2건에서 0개가 된다.
  - (2) 뷰 순서: `position text`(fractional index). 정수 순서 컬럼은 탭 드래그마다 전체 행 UPDATE 가 나가 동시편집에서 충돌한다.
  - (3) 타입 전환: `configuration jsonb` 를 **discriminated union**(`{"type":"board", ...}`)으로 두고, 전환 시 `migrate(oldType, newType, oldConfig) -> newConfig` 순수 함수를 통과시킨다. 승계 대상은 `filter` / `sorts` / `properties[]` 3개로 고정하고 나머지는 기본값 재생성.
  - 인덱스: `view(database_id, position)`, `view(data_source_id)`(F-04-13 의 역참조), `view(dashboard_view_id)`.
  - `view.configuration` 안에 프로퍼티 id 가 흩어져 있으면 프로퍼티 삭제 시 cascade 정리가 전수 스캔이 된다 → 축·그룹·커버 소스 등 **프로퍼티 참조는 평면 최상위 필드로 승격**(F-04-08 과 같은 이유).
- **UI/인터랙션**: 뷰 탭 바(가로 스크롤), `+` 버튼, 탭 드래그 재정렬, 탭 컨텍스트 메뉴, 뷰 링크 복사, 우측 뷰 설정 사이드패널(Layout / Properties / Filter / Sort / Group / Sub-group / Load limit).
- **의존 기능**: data source, property 스키마, 페이지 라우팅(`?v=`).
- **구현 난이도**: **M** — CRUD 자체는 단순하나 타입 전환 시 config 마이그레이션 규칙이 타입 수만큼 필요하다.
- **우선순위**: **P0** — 뷰 개념 없이는 도메인 전체가 성립하지 않음.
- **클론 시 현실적 대안**: MVP는 table/board/list 3종만. 타입 전환 시 config를 무조건 기본값으로 리셋하고 filter/sorts만 승계.
- **참고 출처**: https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/help/boards

---

### F-04-02 Table view

- **한 줄 정의**: 행 = 페이지, 열 = 프로퍼티인 스프레드시트형 그리드로 데이터를 표시·편집한다.
- **사용자 시나리오**: 열 헤더 경계 드래그로 폭 조절 → 헤더 드래그로 열 순서 변경 → 헤더 `···` → `Wrap column` / `Freeze up to column` / `Hide in view` → 행 좌측 `⋮⋮` 드래그로 행 순서 변경 → 하단 `+ New`로 행 추가 → 열 하단 `Calculate` 클릭해 집계 선택.
- **동작 상세**:
  - `configuration.properties[]` 가 `{property_id, visible, width, wrap}` 을 보관. 폭은 px 정수.
  - `frozen_column_index`: 해당 인덱스까지의 열이 가로 스크롤 시 고정("Freeze up to column").
  - `wrap_cells`(뷰 전역) 와 프로퍼티별 `wrap` 이 공존. `show_vertical_lines` 로 세로 구분선 토글.
  - title 프로퍼티는 항상 첫 열이며 삭제 불가(페이지 접근 경로).
  - 열 하단 집계 목록: count(all/values/unique/empty/not empty), percent(empty/not empty), date(earliest/latest/range), number(sum/average/median/min/max/range). 집계는 **필터 통과 행 기준** `[추정]`.
  - `subtasks` 설정으로 sub-item을 토글 중첩(nested in toggle) 또는 flattened list로 표시.
  - 데이터베이스 검색(F-04-27): 툴바 검색으로 **제목 + 프로퍼티 값**을 대상으로 행을 좁힌다(본문 블록은 대상 아님, 헬프센터 확인). 초판이 적었던 **"행이 3개 이상일 때만 노출"이라는 임계는 1차 출처로 재확인되지 않았다** `[확인필요]` — 근거 없는 단정이었으므로 클론 자체 판단 사항으로 내린다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 열 폭을 최소 이하로 드래그 | 최소폭(예: 80px)에서 클램프 |
  | 모든 프로퍼티 숨김 | title 열만 남음 |
  | sort가 걸린 상태에서 행 드래그 | 수동 재정렬 불가 → drag handle 비활성 + 안내 `[확인필요]` |
  | 프로퍼티 500개(상한) | 열 가상화 없으면 DOM 폭발. 가로 가상 스크롤 필요 |
  | 동시편집: A가 폭 조절, B가 열 순서 변경 | 서로 다른 필드이므로 병합 가능 |
  | 삭제된 프로퍼티가 view_property에 잔존 | 렌더 시 스킵 + 지연 GC |
  | 셀 편집 중 다른 사용자가 같은 셀 변경 | 셀 단위 LWW + 편집 중이면 로컬 편집 우선 `[추정]` |
  | **빈 값**: 행 0개 | 헤더 행 + 빈 상태 + `+ New` 는 유지. 열 하단 집계는 count=0, sum=0, avg=`—`(F-04-16) |
  | **빈 값**: 셀 값이 비어 있음 | 플레이스홀더만. **빈 문자열과 null 을 구분해 저장**하되 `is_empty` 필터가 둘을 같게 취급해야 하므로 쿼리 컴파일러에서 정규화(`COALESCE`) |
  | **중첩**: sub-item 이 켜진 table | 트리 렌더가 되며 정렬은 형제 그룹 내부에만 적용된다(F-04-22). 가상 스크롤은 **펼쳐진 노드만 flatten 한 배열**을 대상으로 동작해야 함 |
  | **중첩**: group + sub-item 동시 사용 | 그룹 섹션 안에 트리가 들어간다. 클론 권고: **둘 중 하나만 허용**하고 조합은 v2 로 미룬다(펼침 상태 키가 `(group_key, row_id)` 로 이중화되어 상태 관리가 급격히 복잡해짐) |
  | **순환 참조**: 행 페이지 본문에 자기 DB 의 인라인/링크드 뷰가 들어감 | 렌더 깊이 카운터로 차단. 무한 렌더 방지 |
  | **권한 없음**: 볼 수 없는 행 | 쿼리 단계에서 제외. **행 번호·총 개수·열 집계에서도 제외**해야 존재가 새지 않는다 |
  | **권한 없음**: `Can edit content` 사용자 | 셀 편집·행 추가는 가능하되 **열 폭·열 순서·표시 여부·정렬·필터 변경은 차단**(F-04-25). 열 헤더 컨텍스트 메뉴 자체를 축소 렌더 |
  | **권한 없음**: 잠긴 DB(F-04-25) | 열 리사이즈 핸들·드래그 핸들 미노출, 셀 편집만 허용 |
  | **대용량**: 25만 행 × 500 프로퍼티 | 행·열 양방향 가상화. 실무 임계는 **표시 프로퍼티 수**가 행 수보다 먼저 온다(노션도 성능 요인으로 명시) → 기본 표시 프로퍼티를 소수로 제한 |
- **데이터 모델 함의**:
  - `view_property(view_id, property_id, visible, position, width, wrap, calculation)` — **행 단위 테이블**로 두는 것이 핵심이다. `configuration.properties[]` JSON 배열로 두면 "A 는 폭 조절, B 는 열 순서 변경"이 배열 전체 LWW 로 충돌한다(F-04-12).
  - `view.configuration = { frozen_column_index int, wrap_cells bool, show_vertical_lines bool, subtasks text }`.
  - `width` 는 **px 정수 + NULL 허용**. NULL = "타입별 기본 폭"이며 렌더에서 계산한다. 기본값을 물리적으로 써 넣으면 기본 폭 정책을 나중에 바꿀 수 없다.
  - 행 순서: 정렬이 없을 때만 `row_position(view_id, group_key='', row_id, position)` 을 사용하고, 정렬이 있으면 무시한다(F-04-10).
  - 열 순서 갱신은 반드시 단일 행 UPDATE: `UPDATE view_property SET position = <fractional> WHERE view_id = ? AND property_id = ?`.
  - 인덱스: `view_property(view_id, position)`, `row_position(view_id, group_key, position)`.
- **UI/인터랙션**: 열 리사이즈 핸들, 열/행 드래그, 셀 클릭 진입 + `Esc` 이탈, 방향키 셀 이동 `[확인필요]`, `Shift+클릭` 다중 행 선택, 행 hover 시 `⋮⋮` + `열기` 버튼, 행 컨텍스트 메뉴(Delete / Duplicate / Copy link / Move to).
- **의존 기능**: property 타입별 셀 에디터, 가상 스크롤(F-04-15), 정렬(F-04-10), 집계(F-04-16).
- **구현 난이도**: **L** — 가상 스크롤 + 열 고정 + 인라인 셀 편집 + 키보드 내비게이션 조합이 난이도의 대부분.
- **우선순위**: **P0** — 데이터베이스의 기본 뷰.
- **클론 시 현실적 대안**: TanStack Table + TanStack Virtual. 열 고정은 `position: sticky` + z-index. 초기엔 행 가상화만, 열 가상화는 v2.
- **참고 출처**: https://www.notion.com/help/tables , https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/views-filters-and-sorts

---

### F-04-03 Board view (Kanban) + 드래그로 프로퍼티 값 변경

- **한 줄 정의**: 특정 프로퍼티 값별 컬럼에 카드를 배치하고, 카드를 다른 컬럼으로 드래그하면 그 프로퍼티 값이 실제로 변경된다.
- **사용자 시나리오**: 뷰 타입 Board 선택 → Group by에서 `Status` 선택 → 컬럼별 카드 표시 → 카드를 `In progress` 컬럼으로 드래그 → 놓는 순간 해당 페이지의 Status = In progress로 저장 → 컬럼 헤더 `+`로 그 그룹 값이 미리 채워진 새 카드 생성 → 컬럼 헤더 `···` → `Hide group` → 컬럼 헤더 드래그로 컬럼 순서 변경.
- **동작 상세**:
  - `group_by` **필수**. 헬프센터 원문 기준: status 프로퍼티가 있으면 자동 선택, 없으면 `a select, person, multi-select, or relation property` 로 그룹, **그마저 없으면 status 프로퍼티를 새로 생성**해 준다. → 클론 규칙: `status → select → multi_select → person → (없으면 status 프로퍼티 자동 생성)`.
  - 단 같은 문서 FAQ는 `Relation and formula properties cannot currently be used for grouping` 이라고 명시한다 → **본문·FAQ 모순**. 구현 결론: **relation/formula 그룹 미지원 고정**(F-04-11 참조).
  - 드래그 드롭 = 두 개의 mutation이 원자적으로 발생: (1) 그룹 프로퍼티 셀 값 갱신, (2) `row_position(view_id, group_key, row_id)` 갱신.
  - multi_select 그룹에서 카드 이동 시 원래 그룹 값 제거 + 대상 그룹 값 추가 `[추정 — semantics 문서 미기재, 확인필요]`.
  - 컬럼 순서는 select/status 옵션 순서(스키마 전역) 또는 뷰별 `group_order`(manual)로 결정.
  - "No {property}" 그룹: 값이 비어 있는 행을 모으는 특수 그룹. 개별 숨김 가능.
  - `card_layout`: list | compact. `cover`: page_cover | page_content | files 프로퍼티. `cover_size`: small/medium/large. `cover_aspect`: contain/cover.
  - 컬럼 헤더에 기본으로 카드 수를 회색 숫자로 표시하며, sum/average/date range/percent 등으로 변경 가능.
  - `sub_group_by`로 2차 그룹 → 보드가 행×열 격자가 된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 그룹 프로퍼티 값이 비어 있는 행 | "No Status" 그룹에 수집 (빈 그룹 숨김과 별개 개념) |
  | 카드가 0개인 옵션 | `hide_empty_groups=true`면 컬럼 미표시 |
  | 그룹 프로퍼티 옵션 삭제 | 컬럼 소멸, 카드는 "No X"로 이동 |
  | 숨긴 그룹으로 드래그 | 드롭 타겟 없음 → 이동 불가 |
  | 필터에 걸리는 값으로 드래그 | 드롭 직후 카드가 뷰에서 사라짐 → 토스트 안내 권장 |
  | person 그룹에서 드래그 | People이 배열이므로 치환/추가 정책을 명시적으로 정해야 함 |
  | 동시편집: 같은 카드를 A·B가 다른 컬럼으로 드래그 | 셀 값 LWW, position은 fractional index라 충돌 없이 병합 |
  | 컬럼당 카드 5,000장 | 컬럼별 독립 가상 스크롤 + 컬럼별 페이지네이션 필요 |
  | **권한 없음**: 읽기 전용 사용자 | 드래그 핸들 미노출, 드롭 시도 시 권한 오류 |
  | **권한 없음**: `Can edit content` 사용자 | **카드 드래그는 허용**(셀 값 변경 = 데이터 편집), 그룹 프로퍼티 변경·컬럼 순서 저장·그룹 숨김은 차단(F-04-25). 이 둘을 한 권한으로 묶으면 board 가 사실상 읽기 전용이 된다 |
  | **중첩**: `sub_group_by` 로 행×열 격자 | 드롭 타겟이 `(group_key, sub_group_key)` 2차원이 된다 → 드롭 = **두 개의 셀 값 동시 변경**. 단일 API 하나로 원자 처리하지 않으면 절반만 반영된 카드가 생긴다 |
  | **중첩**: board + sub-item | 카드에는 `Card property` 또는 `Flattened list` 만 지원되고 필터 범위는 부모만(F-04-22). 카드 안에 트리를 그리지 말 것 |
  | **순환 참조**: 자기참조 relation 으로 그룹 | relation 그룹 자체를 미지원으로 고정했으므로 발생하지 않는다(F-04-11). 지원하려면 "행이 자기 그룹의 카드로 들어가는" 케이스를 먼저 정의해야 한다 |
- **데이터 모델 함의**:
  - `view.group_by`, `view.sub_group_by`, `view.configuration = {cover, cover_size, cover_aspect, card_layout, properties[]}`.
  - **그룹 내 순서는 `row_page.position` 하나로 표현 불가** → `row_position(view_id, group_key, row_id, position)` 별도 테이블 필수.
  - 이동 API: `POST /views/{id}/move-row { row_id, target_group_key, before_row_id? }` → 서버가 셀 갱신 + position 계산을 한 트랜잭션으로 처리.
- **UI/인터랙션**: 카드 드래그(컬럼 간/내부), 컬럼 헤더 드래그, 컬럼 헤더 `···`(Rename group / Hide group / Color), 컬럼 하단 `+ New`, 카드 hover 시 열기 버튼, 카드 위 프로퍼티 배지.
- **의존 기능**: F-04-11(group by), 셀 값 mutation, fractional index 정렬, 낙관적 업데이트/롤백.
- **구현 난이도**: **L** — 드래그 인터랙션보다 "드롭 = 데이터 변경"의 낙관적 업데이트/롤백, 그룹별 순서 저장, 필터와의 상호작용이 어렵다.
- **우선순위**: **P0** — 사용 빈도가 높고 노션 DB의 대표 기능.
- **클론 시 현실적 대안**: dnd-kit 사용. MVP는 single-select/status 그룹만 지원, multi_select/person/relation 그룹 및 sub_group_by는 v2.
- **참고 출처**: https://www.notion.com/help/boards , https://developers.notion.com/guides/data-apis/working-with-views , https://deepwiki.com/AppFlowy-IO/AppFlowy/7.2-database-views-(filters-sorts-groups)

---

### F-04-04 List view

- **한 줄 정의**: 프로퍼티를 최소한으로 노출하고 제목 중심의 세로 목록으로 행을 표시한다.
- **사용자 시나리오**: 뷰 타입 List 선택 → Properties 패널에서 표시할 프로퍼티 토글 → 항목 우측에 배지 형태로 프로퍼티 표시 → 클릭 시 side peek 열림.
- **동작 상세**: `configuration.properties`(visible만 존재, width 없음)가 설정의 전부다. 제목은 좌측, 표시 프로퍼티는 우측 정렬 배지. group_by 적용 시 그룹 헤더로 구분된 섹션 목록이 된다. 기본 페이지 열림 방식은 side peek.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 제목이 빈 페이지 | `Untitled` 플레이스홀더. 정렬 시 빈 문자열로 취급 |
  | 표시 프로퍼티 0개 | 제목만 있는 순수 목록. 오류 아님 |
  | 매우 긴 제목 | 1줄 ellipsis `[추정]` |
  | 표시 프로퍼티가 많아 폭 초과 | 뒤쪽부터 잘림 `[확인필요]`. 클론 권고: 우선순위 낮은 배지부터 숨기고 `+N` 표기 |
  | **동시편집**: 다른 사용자가 표시 중인 행의 title 변경 | 행은 제자리 유지, 텍스트만 갱신. 정렬 키가 title 이면 **행 위치가 점프**하므로 스크롤 앵커(앵커 행 id 기준 보정) 필요 |
  | **동시편집**: 다른 사용자가 그 행을 삭제 | 리스트에서 제거 + 해당 행 side peek 이 열려 있으면 `삭제됨` 상태로 전환 |
  | **삭제된 참조**: 표시 프로퍼티가 relation 인데 대상 페이지 삭제 | 배지에서 해당 항목 제거. 배지가 0개가 되면 프로퍼티 자체를 숨김(빈 배지 렌더 금지) |
  | **권한 없음** | 쿼리 단계에서 제외(클라이언트 필터 금지 — 개수·집계로 존재가 새어 나감). 읽기 전용 사용자는 `+ New` 및 드래그 핸들 미노출 |
  | **대용량** | table 과 동일한 행 가상 스크롤 재사용. 행 높이가 배지 줄바꿈으로 가변이므로 **동적 높이 측정** 필요 |
- **데이터 모델 함의**: `view.configuration = { properties: [{property_id, visible}] }`. **신규 테이블 불필요** — table view 스키마의 부분집합.
- **UI/인터랙션**: 행 hover 시 `⋮⋮` 드래그 핸들 + `···` 메뉴, 하단 `+ New`, 클릭 시 side peek.
- **의존 기능**: F-04-01, F-04-12(표시 프로퍼티).
- **구현 난이도**: **S** — table view 컴포넌트의 축약 렌더러로 구현 가능.
- **우선순위**: **P1** — 비용 대비 효과가 크지만 MVP 필수는 아님.
- **클론 시 현실적 대안**: table view 렌더러에 `variant='list'` 를 두어 **셀 컴포넌트를 재사용**하고 그리드 레이아웃만 교체한다. 별도 컴포넌트 트리를 만들면 셀 에디터를 두 벌 유지하게 되므로 피한다. 표시 프로퍼티 오버플로 처리(`+N`)는 v1 이후.
- **참고 출처**: https://www.notion.com/help/lists , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-05 Gallery view (카드 + 커버 소스)

- **한 줄 정의**: 각 행을 커버 이미지가 있는 카드 그리드로 표시한다.
- **사용자 시나리오**: 뷰 타입 Gallery → Layout에서 `Card preview` = Page cover / Page content / 특정 Files & media 프로퍼티 선택 → `Card size` = Small/Medium/Large → `Fit image` 토글(contain/cover) → 카드에 표시할 프로퍼티 선택.
- **동작 상세**:
  - `cover`: `page_cover` | `page_content` | `property:<files_property_id>`.
  - `page_content`: 페이지 본문의 첫 이미지 블록을 썸네일로 사용 `[추정 — 선택 규칙 문서 미기재]`.
  - `cover_size`(small/medium/large)는 커버 영역 크기를 결정하고, 그리드 컬럼 수는 컨테이너 폭 기준 자동 계산 `[추정]`.
  - `cover_aspect`: contain(여백 포함 전체 표시) | cover(크롭하여 채움).
  - `card_layout`: list | compact. 기본 페이지 열림 방식은 center peek.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 커버 없는 행 | 플레이스홀더(아이콘 또는 제목 이니셜). 카드 높이는 유지해야 그리드가 흔들리지 않음 |
  | files 에 이미지 여러 개 | 첫 번째 사용 `[추정]` |
  | files 에 비이미지(PDF 등) | 파일 타입 아이콘 `[확인필요]` |
  | 외부 이미지 URL 만료 | `onError` → 플레이스홀더 폴백. 실패 URL은 세션 캐시에 기록해 재요청 금지 |
  | **삭제된 참조**: 커버 소스로 지정한 files 프로퍼티가 삭제됨 | `cover` 설정을 `page_cover` 로 폴백. 뷰가 빈 화면이 되면 안 됨 |
  | **동시편집**: A가 커버 소스 변경, B가 카드 크기 변경 | 서로 다른 configuration 키 → **키 단위 병합 가능**. `configuration` 전체를 LWW 로 덮으면 상대 변경이 사라지므로 **JSON 전체 교체 금지** |
  | **동시편집**: 표시 중 카드의 커버 이미지 교체 | 이미지 URL 갱신 시 레이아웃 시프트 방지를 위해 기존 이미지 유지 후 크로스페이드 |
  | **권한 없음**: 첨부 파일에 접근 권한 없음 | 잠금 플레이스홀더. **서명 URL을 클라이언트에 내려보내기 전에 권한 판정**(썸네일 CDN 경로가 권한 우회로가 되기 쉬움) |
  | **대용량**: 카드 1,000장 | 가상 그리드 + `loading="lazy"` + `IntersectionObserver` 프리페치. 썸네일 원본을 그대로 쓰면 대역폭이 수백 MB 가 됨 |
- **데이터 모델 함의**: `view.configuration = { cover: {type, property_id?}, cover_size, cover_aspect, card_layout, properties[] }`. 별도로 **이미지 썸네일 파이프라인(리사이즈·CDN)** 이 필요하다.
- **UI/인터랙션**: 카드 hover 시 `···`, 카드 드래그 수동 재정렬, 반응형 그리드, 커버 lazy loading.
- **의존 기능**: files 프로퍼티, 페이지 커버, 이미지 스토리지/썸네일.
- **구현 난이도**: **M** — 렌더는 쉬우나 썸네일 생성·캐싱 파이프라인이 실비용.
- **우선순위**: **P1**.
- **클론 시 현실적 대안**: `page_content` 소스는 제외하고 `page_cover` + files 프로퍼티만 지원. 썸네일은 원본 + `loading="lazy"` + CSS `object-fit`으로 시작.
- **참고 출처**: https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/views-filters-and-sorts

---

### F-04-06 Calendar view + date range 드래그

- **한 줄 정의**: date 프로퍼티 값에 따라 행을 달력 격자에 배치하고, 드래그로 날짜를, 가장자리 리사이즈로 기간을 변경한다.
- **사용자 시나리오**: 뷰 타입 Calendar → Layout에서 배치 기준 date 프로퍼티 선택 → 월/주 전환 → 카드를 다른 날짜로 드래그(= date 값 변경) → 카드 좌/우 가장자리 드래그(= range의 start/end 변경) → 빈 날짜 hover 후 `+` 클릭 → 그 날짜가 채워진 새 페이지 생성.
- **동작 상세**:
  - `date_property_id` **필수**. `view_range`: week | month. `show_weekends`: boolean. — 세 필드 모두 Views API configuration 목록에서 확인(단 `show_weekends` 는 헬프센터 calendars 문서에는 언급이 없어 **UI 노출 위치는 `[확인필요]`**).
  - date 프로퍼티가 여러 개면 Layout 에서 어느 프로퍼티로 배치할지 전환할 수 있다(헬프센터 확인).
  - date 프로퍼티가 range(start+end)이면 카드가 여러 칸에 걸쳐 렌더된다. 주 경계를 넘으면 여러 줄로 분할 렌더 `[추정]`.
  - 드래그 이동 시 range의 **duration을 유지**하며 start/end를 동시 이동 `[추정 — 문서 미기재]`.
  - 주 시작 요일: Settings > Preferences에서 Monday/Sunday 선택, 기본은 지역 기반 자동.
  - 시간 포함 date의 시간 표시 여부는 프로퍼티 표시 설정 `time_format`(12_hour/24_hour/hidden)으로 제어.
  - date 값이 비어 있는 행은 달력에 표시되지 않는다 `[추정]`. **재검증 결과 헬프센터 calendars 문서는 날짜 없는 항목의 처리를 아예 다루지 않는다** → 여전히 `[확인필요]`. 클론 권고: 툴바에 `날짜 없음 N개` 칩을 두고 클릭 시 해당 행만 필터링한 목록을 띄운다(달력에서 행이 조용히 사라지는 것이 가장 흔한 사용자 혼란 지점).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | date 값 없음 | 미표시. "N items without dates" 안내 제공 여부 `[확인필요]` |
  | end < start | 저장 거부(권장) 또는 자동 스왑 |
  | 하루에 카드 50개 | 셀 높이 제한 + "+45 more" 오버플로 |
  | 타임존 / DST | 저장은 UTC, 배치는 뷰어 로컬 기준. all-day는 date-only(타임존 없음)로 저장해야 DST 이슈 회피 |
  | 리사이즈로 range 0일 축소 | 최소 1일로 클램프 |
  | 필터에 걸리는 날짜로 드래그 | 이동 후 카드가 뷰에서 사라짐 |
  | **빈 값**: date 값 없음 | 달력에서 미표시. 툴바에 `날짜 없음 N개` 칩 필수(위 동작 상세) |
  | **빈 값**: end 만 있고 start 없음 | 저장 시점에 거부. date 값의 불변식은 `start IS NOT NULL` |
  | **중첩**: sub-item 이 있는 calendar | 표시 방식은 `Card property` 또는 `Flattened list` 만 지원되고 **필터 범위는 부모만**(F-04-22). 트리를 달력에 그리려 하지 말 것 |
  | **삭제된 참조**: `date_property_id` 프로퍼티 삭제 | 다른 date 프로퍼티로 자동 폴백, 없으면 **빈 달력 + "날짜 프로퍼티를 선택하세요" 배너**. 뷰 삭제 금지 |
  | **삭제된 참조**: 표시 프로퍼티가 relation 인데 대상 삭제 | 카드 배지에서 제거. 카드 높이가 바뀌므로 재레이아웃 |
  | **순환 참조**: 해당 없음 | calendar 는 행 간 참조를 만들지 않는다(dependency 는 timeline, F-04-07) |
  | **동시편집**: 같은 카드를 A·B 가 다른 날짜로 드래그 | date 셀 값 LWW. 단 **드래그는 낙관적 이동 → 서버 거절 시 원위치 애니메이션**으로 되돌릴 것(즉시 사라졌다 나타나면 유실로 보인다) |
  | **동시편집**: 보고 있는 달의 다른 행이 날짜 변경 | 해당 카드만 이동. **달력 뷰포트(현재 월)는 절대 자동 이동 금지** |
  | **권한 없음**: 볼 수 없는 행 | 서버 쿼리에서 제외. 셀의 `+N more` 카운트에도 포함 금지 |
  | **권한 없음**: `Can edit content` / 잠긴 DB | 카드 드래그·리사이즈는 셀 값 변경이므로 **허용**(데이터 편집), 반면 `date_property_id`·`view_range` 변경은 차단(F-04-25). 이 둘을 같은 권한으로 묶으면 안 된다 |
  | **대용량**: 5년치 수만 행 | 화면에 보이는 기간만 범위 쿼리(`start <= range_end AND COALESCE(end,start) >= range_start`). 전체 로드 금지. 월 이동 시 앞뒤 1개월 프리페치 |
  | **대용량**: 하루에 카드 수백 개 | 셀당 렌더 상한 + `+N more` 팝오버(팝오버 안에서만 그 날짜의 행을 별도 페이지네이션) |
- **데이터 모델 함의**:
  - date 값 스키마: `{ start: ISO8601, end: ISO8601 | null, time_zone: string | null, is_all_day: boolean }`.
  - 범위 쿼리: `WHERE start <= range_end AND COALESCE(end, start) >= range_start`. JSON에서 꺼낸 **생성 컬럼 + 인덱스**가 사실상 필수.
  - `view.configuration = { date_property_id, view_range, show_weekends, properties[] }`.
- **UI/인터랙션**: 월/주 전환, 이전/다음/Today 버튼, 무한 세로 스크롤로 월 이동, 카드 드래그, 좌우 엣지 리사이즈 커서, 날짜 셀 hover `+`.
- **의존 기능**: date 프로퍼티, 타임존 처리, 셀 값 mutation.
- **구현 난이도**: **L** — 월/주 격자 + multi-day 이벤트 lane packing 알고리즘 + 드래그/리사이즈가 각각 별도 작업.
- **우선순위**: **P1** — MVP 이후 첫 확장 후보.
- **클론 시 현실적 대안**: 월 뷰만 먼저 지원. range는 표시만 하고 리사이즈는 v2. 레이아웃은 검증된 캘린더 라이브러리 도입 검토.
- **참고 출처**: https://www.notion.com/help/calendars , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-07 Timeline view + dependency arrows

- **한 줄 정의**: 가로 시간축 위에 각 행을 기간 막대로 그리고, 행 간 선행/후행 관계를 화살표로 표시하며 날짜 이동 시 연결된 항목의 날짜를 자동 조정한다.
- **사용자 시나리오**: 뷰 타입 Timeline → Layout에서 시작/종료 날짜 소스 선택(단일 range 프로퍼티 또는 별도의 두 date 프로퍼티) → 우상단 드롭다운에서 시간 단위(Hours~Years) 선택 → 좌측 `>>` 버튼으로 사이드 테이블 패널 열기 → 막대 hover 시 나타나는 노란 화살표 핸들을 다른 항목으로 드래그해 dependency 생성 → 선행 항목 막대를 우측으로 드래그 → 설정에 따라 후행 항목 날짜가 함께 이동.
- **동작 상세**:
  - `date_property_id`(시작, 필수) + `end_date_property_id`(선택). 두 프로퍼티 방식과 단일 range 프로퍼티 방식 모두 지원.
  - `preference`: `{ zoom_level, center_timestamp }` — 줌 레벨과 스크롤 위치가 뷰에 저장된다.
  - `show_table` + `table_properties` — 사이드 테이블은 **타임라인 본체와 별개의 표시 프로퍼티 목록**을 가진다(표시 프로퍼티 2벌).
  - `arrows_by`: dependency를 표현하는 **relation 프로퍼티 ID**. 즉 dependency는 자기참조 relation으로 저장된다(Blocking / Blocked by 양방향 쌍).
  - `color_by`: 막대 색상을 결정하는 프로퍼티.
  - 데이터베이스 단위 설정(`More settings`)의 날짜 시프트 정책 3종:
    | 옵션 | 동작 |
    |---|---|
    | Shift only when dates overlap | 날짜가 겹칠 때만 후행을 밀어냄. 항목 간 간격은 줄어들 수 있음 |
    | Shift & maintain time between items | 선행이 1주 밀리면 후행도 1주 밀림(간격 보존) |
    | Do not automatically shift | 자동 이동 없음. 화살표는 표시만 |
  - `Avoid weekends` 토글: 시작/종료가 주말에 놓이지 않도록 조정.
  - 막대 좌/우 엣지 드래그로 기간 조절, 막대 전체 드래그로 이동, 로드 한도(표시 페이지 수) 조절 가능.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 날짜 없는 항목 | 막대 없음. 사이드 테이블에는 표시 `[추정]` |
  | 순환 dependency (A→B→A) | 저장 거부 필요. 시프트 전파 시 무한 루프 방지를 위해 사이클 감지 필수 `[확인필요 — 노션의 실제 처리 미확인]` |
  | 한 항목이 여러 항목을 blocking | fan-out 전파. 여러 선행이 한 후행을 밀면 **가장 늦은 제약** 적용 `[추정]` |
  | 전파 깊이 수백 단계 | 서버측 배치 처리 + 최대 홉 수 제한 권장 |
  | 시프트 결과가 필터를 벗어남 | 항목이 뷰에서 사라짐 |
  | dependency 대상 페이지 삭제 | 화살표 제거 + relation 값 정리 |
  | 후행 항목에 쓰기 권한 없음 | 부분 적용 금지 → 트랜잭션 롤백 + 안내 |
  | 줌 = Hours + 5년치 데이터 | 가로 가상화 필수. 뷰포트 밖 데이터는 쿼리하지 않음 |
  | **중첩**: sub-item 이 있는 timeline | `Nested in toggle` / `Flattened list` 지원. 부모 막대를 **자식 기간의 합집합으로 자동 계산할지, 부모 자신의 date 값을 쓸지**를 먼저 정해야 한다(간트 도구마다 다르며 노션 문서에는 명시 없음 `[확인필요]`) |
  | **중첩**: dependency 체인 안의 sub-item | 부모를 밀면 자식도 밀리는가? **계층 전파와 dependency 전파는 별개 규칙**이며 둘을 동시에 켜면 같은 행이 두 경로로 밀려 이중 이동한다 → 전파 엔진에서 행별 **최종 delta 를 1회만 적용** |
  | **동시편집**: A 가 선행 막대를 드래그하는 동안 B 가 후행 막대를 직접 이동 | 시프트 전파는 **서버 트랜잭션 안에서 재계산**해야 한다. 클라이언트가 계산한 후행 날짜를 그대로 보내면 B 의 변경을 덮어쓴다 |
  | **동시편집**: 전파가 수십 행을 건드리는 중 다른 사용자가 그중 한 행을 편집 | 전파 트랜잭션은 대상 행을 잠근다 → **잠금 범위가 넓어져 경합이 커진다**. 클론 권고: 전파 홉 상한(예: 50)을 두고 초과분은 비동기 잡으로 넘긴 뒤 결과를 알림 |
  | **동시편집**: 두 사용자가 같은 쌍에 dependency 를 서로 반대 방향으로 생성 | relation 값 LWW + **커밋 시점 사이클 검사**. 검사를 읽기 시점에만 하면 두 요청이 모두 통과해 사이클이 생긴다 |
- **데이터 모델 함의**:
  - `view.configuration = { date_property_id, end_date_property_id, properties[], show_table, table_properties[], preference{zoom_level, center_timestamp}, arrows_by, color_by }`.
  - dependency는 **별도 테이블이 아니라 자기참조 relation 프로퍼티 값**(`row_page.properties[prop_id] = [row_id, ...]`)에 저장. 양방향 relation이면 blocking/blocked_by 두 프로퍼티가 쌍으로 생성된다 `[추정 — 자동 생성 이름 확인필요]`.
  - 시프트 정책은 뷰가 아니라 **database 레벨**(`database.dependency_shift_mode`, `database.avoid_weekends`).
  - 서버측 시프트 엔진: `shift(rowId, delta)` → 위상 순회로 후행 갱신 → 단일 트랜잭션 커밋.
- **UI/인터랙션**: 가로 스크롤/줌, Today 버튼, 막대 드래그·리사이즈, 화살표 핸들 드래그, 사이드 테이블 접기(`>>`/`<<`), 막대 hover 툴팁.
- **의존 기능**: F-04-06(date 처리), relation 프로퍼티, sub-items, 서버측 트랜잭션.
- **구현 난이도**: **XL** — 가로 가상화된 간트 렌더러 + 그래프 기반 날짜 전파 엔진 + 사이클 방지, 셋 모두 독립적으로 난이도가 높다.
- **우선순위**: **P2** — 구현 비용 대비 MVP 기여도가 낮다.
- **클론 시 현실적 대안**: (1) 화살표·자동 시프트 없이 읽기 전용 간트 막대만, (2) 드래그 이동만 허용하고 전파 정책은 `never` 고정, (3) 오픈소스 간트 라이브러리 채용.
- **참고 출처**: https://www.notion.com/help/timelines , https://www.notion.com/help/tasks-and-dependencies , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-08 Chart view

- **한 줄 정의**: 데이터베이스 행을 집계해 막대/선/도넛/숫자 차트로 렌더한다.
- **사용자 시나리오**: 뷰 타입 Chart → 차트 종류(세로 막대 / 가로 막대 / 선 / 도넛 / 숫자) 선택 → X축 프로퍼티 지정 + 정렬(asc/desc) + 개별 그룹 눈 아이콘 표시/숨김 + `Omit zero values` 토글 → Y축에서 `Count` 또는 프로퍼티+집계 지정 → Group by(stack) 지정 → 색상/높이/그리드/레전드/데이터 라벨 설정.
- **동작 상세**:
  - `chart_type` **필수**: column | bar | line | donut | number.
  - `x_axis`: 그룹핑 축(프로퍼티 + 정렬 + 그룹 표시/숨김 + zero 생략).
  - `y_axis`: 집계(Count 또는 프로퍼티 기반 sum/average 등) + `stack_by`.
  - `value`: number 차트 전용 단일 집계.
  - **Cumulative**: Y축이 Count 또는 Sum이고 X축이 오름차순일 때만 활성 — 누적 합계를 표시.
  - 도넛: 값 프로퍼티 + 슬라이스 기준 프로퍼티 + 중앙값 표시 옵션.
  - 포맷: 색상 팔레트(Auto/Colorful), 높이(Small~Extra Large), 그리드 라인, 축 라벨, 데이터 라벨, 라인 스무딩, 그라디언트 필, 레전드 위치, 값 강도 기반 조건부 색상, reference line.
  - 뷰의 filter/sorts는 집계 **이전에** 적용된다 `[추정]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 데이터 0건 | 빈 상태 플레이스홀더 |
  | 그룹 200개 초과 | **최대 200 groups / 50 subgroups** 까지만 표시(명시된 상한) |
  | 미지원 축 프로퍼티 | rollup, button, unique ID, files/media, 일부 formula 타입은 축으로 사용 불가 |
  | X축 값이 빈 행 | "Empty" 버킷 또는 제외 `[확인필요]` |
  | 집계 대상이 비숫자 | Count만 허용 |
  | **빈 값**: X축 프로퍼티가 빈 행 | "Empty" 버킷 또는 제외 `[확인필요]`. 클론 권고: **Empty 버킷을 만들되 기본 숨김**(제외하면 합계가 총행수와 안 맞아 신뢰를 잃는다) |
  | **빈 값**: Y축 집계 대상이 전부 비어 있음 | sum=0, average=빈 값. 0 과 빈 값을 다르게 렌더(F-04-16 과 동일 규칙) |
  | **중첩**: X축 group + `stack_by` 서브그룹 | 200 groups × 50 subgroups 상한. 초과분은 잘라내고 "N개 더 있음" 표기 |
  | **삭제된 참조**: `x_axis_property_id` / `y_axis_property_id` / `stack_by` 프로퍼티 삭제 | 해당 필드만 null 로 폴백 + "축을 다시 선택하세요" 배너. 차트 뷰 자체는 유지. **평면 필드로 두어야 `UPDATE view SET x_axis_property_id = NULL WHERE x_axis_property_id = ?` 한 줄로 정리된다** |
  | **삭제된 참조**: 축이 참조하던 select 옵션 삭제 | 해당 버킷 소멸. `hidden_groups[]` 에 남은 죽은 키는 지연 GC |
  | **순환 참조**: 해당 없음 | 차트는 읽기 전용 집계라 데이터 순환 경로가 없다. 단 **formula/rollup 축은 파생값 재계산 → 재집계 → 재브로드캐스트 루프**가 가능하므로 서버에서 수렴 후 1회만 알린다(F-04-24) |
  | **동시편집**: A 가 축 설정, B 가 포맷 설정 | `configuration` 을 통째로 LWW 하면 한쪽이 사라진다 → **키 단위 병합**(F-04-05 와 동일 원칙) |
  | **동시편집**: 차트를 보는 중 원본 행 변경 | 집계값만 갱신. 값 변경은 트랜지션으로 알리되 **축 스케일 재계산은 디바운스(300ms)** — 매 변경마다 축이 튀면 읽을 수 없다 |
  | **권한 없음**: 볼 수 없는 행이 섞인 data source | **집계 이전에 권한 필터 적용**. 차트는 개수·합계만으로 비공개 데이터를 추론할 수 있는 대표적 누수 경로다 |
  | **권한 없음**: dashboard 위젯으로 놓인 차트 | 소스 접근 불가 시 차트 제목·축 라벨까지 숨긴다(F-04-20) |
  | **대용량**: 25만 행 집계 | 서버측 `GROUP BY` 필수. 전 행을 클라이언트로 보내 집계하면 실패. `(data_source_id, x축 추출식)` 생성 컬럼 + 인덱스가 사실상 요구된다 |
  | **대용량**: 집계 응답 캐시 | 캐시 키 = `(view_id, filter_hash, user_permission_hash, schema_version)`. **권한 해시를 빼면 사용자 간 캐시 오염**이 발생한다 |
- **데이터 모델 함의**:
  - **API 실제 필드(재확인)**: `chart_type`(required) 외에 `x_axis`, `y_axis`, `x_axis_property_id`, `y_axis_property_id`, `value`, `stack_by` 및 포맷 필드들이 **configuration 최상위에 평면적으로** 나열된다. 즉 `stack_by` 는 `y_axis` 하위가 아니라 형제 필드다 — 앞선 중첩 표기는 잘못이었다.
  - 클론 스키마 권고: `{ chart_type, x_axis_property_id, x_axis{sort, hidden_groups[], omit_zero}, y_axis_property_id, y_axis{aggregation, cumulative}, stack_by, value, format{...} }` — 축 프로퍼티 참조를 **평면 필드로 빼 두면 프로퍼티 삭제 시 cascade 정리 쿼리가 단순**해진다.
  - 행 목록 쿼리와 **별개의 집계 엔드포인트**가 필요: `GROUP BY <x>[, <stack>] → aggregate(<y>)`.
- **UI/인터랙션**: 차트 hover 툴팁, 레전드 클릭으로 시리즈 토글, 축 설정 팝오버.
- **의존 기능**: F-04-09(filter), F-04-11(group 로직 재사용), 서버측 집계.
- **구현 난이도**: **L** — 렌더는 라이브러리로 줄지만 설정 조합의 경우의 수와 서버 집계 API가 부담.
- **우선순위**: **P2**.
- **클론 시 현실적 대안**: bar + donut + number 3종만, 집계는 count/sum/average만. 렌더는 Recharts/ECharts 등 기성 라이브러리.
- **참고 출처**: https://www.notion.com/help/charts , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-09 Filter (simple / advanced, AND·OR 그룹 중첩)

- **한 줄 정의**: 프로퍼티 조건으로 뷰에 표시할 행을 걸러내며, 조건을 AND/OR 그룹으로 중첩해 조합할 수 있다.
- **사용자 시나리오**: 툴바 `Filter` 클릭 → 프로퍼티 선택 → 조건(연산자) 선택 → 값 입력 → 즉시 반영 → `Save for everyone` 여부 결정. 고급: `···` → `Add advanced filter` → 조건 행마다 앞에 `Where / And / Or` 콤보 표시 → `Add filter group` 으로 중첩 그룹 생성.
- **동작 상세**:
  - 필터 트리는 재귀 구조(`FilterNode`). UI 기준 그룹 3단계, API 문서 기준 2단계 — **불일치 `[확인필요]`**.
  - 프로퍼티 타입별 연산자 (API 레퍼런스 기준):
    | 타입 | 연산자 |
    |---|---|
    | checkbox | equals, does_not_equal |
    | number | equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to, is_empty, is_not_empty |
    | rich_text / title | equals, does_not_equal, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty |
    | select | equals, does_not_equal, is_empty, is_not_empty |
    | status | equals, does_not_equal, is_empty, is_not_empty |
    | multi_select | contains, does_not_contain, is_empty, is_not_empty |
    | people | contains, does_not_contain, is_empty, is_not_empty |
    | relation | contains, does_not_contain, is_empty, is_not_empty |
    | files | is_empty, is_not_empty |
    | date | equals, before, after, on_or_before, on_or_after, past_week, past_month, past_year, this_week, next_week, next_month, next_year, is_empty, is_not_empty |
    | formula | 결과 타입에 따라 checkbox/date/number/string 필터를 중첩 |
    | rollup | any / every / none (배열형) + 중첩 date/number 조건 |
    | unique_id | equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to |
    | verification | status, does_not_equal |
    | timestamp | created_time / last_edited_time 에 date 조건 적용 (property 필드 불필요) |
  - **상대 날짜 값**: `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago`, `one_month_from_now`. 리터럴 날짜가 아니라 **심볼로 저장되어 조회 시점에 해석**되어야 한다.
  - `quick_filters`: 필터바에 상시 노출되는 프로퍼티 목록. **뷰 필터와 동일한 스키마**를 사용한다(API 체인지로그 명시).
  - 2025-11 릴리스에서 sub-item에 대한 필터링이 추가되었다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 조건 그룹 | 항상 true로 평가(스킵). 저장은 허용 |
  | 참조 프로퍼티 삭제 | 해당 노드 비활성/제거. 쿼리 전체 실패 금지 |
  | 삭제된 select 옵션 참조 | 매칭 0건. "삭제된 옵션" 표시 권장 |
  | 상대 날짜 + 타임존 | 사용자 타임존 기준 경계 계산 필수(UTC로 계산 시 하루 어긋남) |
  | formula/rollup 필터 | 파생값이라 인덱스 사용 불가 → 전체 스캔. 노션도 성능 저하를 문서에 명시 |
  | 중첩 깊이 초과 | 서버에서 400 거부 |
  | **중첩**: 그룹 안의 그룹 안의 그룹 | 헬프센터 원문 `These can be nested up to three layers deep!`(재확인 완료), API 레퍼런스는 2단계. `MAX_FILTER_DEPTH` 상수 하나로 통일하고 **읽기 경로에는 검증을 걸지 않는다** |
  | **중첩**: rollup 필터 안의 date 조건 | rollup 은 `any/every/none` + 중첩 조건이라 **트리 안의 트리**가 된다. 평가기를 재귀로 짜지 않으면 여기서 무너진다 |
  | **순환 참조**: relation 필터가 자기 DB 를 가리킴(sub-item 등) | relation 을 **1홉만 따라가면 순환이 생기지 않는다**. 다홉 탐색을 허용하려면 방문 집합 + 홉 상한 필수. 클론 권고: **1홉 고정** |
  | **동시편집**: A·B 가 같은 뷰의 필터를 동시 편집 | 필터 트리 전체를 하나의 값으로 LWW 교체 `[추정]`. 부분 병합은 트리 구조상 위험(노드 id 가 없으면 병합 기준 자체가 없다). 클론 권고: 트리 노드마다 **안정적 uuid** 를 부여해 두면 나중에 노드 단위 병합으로 승격할 수 있다 |
  | **동시편집**: 필터 변경으로 다른 사용자 화면에서 행이 대량 소멸 | 뷰 설정 변경은 **결과 집합 전체 무효화 이벤트**로 브로드캐스트하고 재조회시킨다. 행 델타로 표현하려 하지 말 것(F-04-24) |
  | **권한 없음**: 볼 수 없는 행 | 권한 조건은 **사용자 필터와 AND 로 합성된 별도 절**이어야 한다. 사용자 필터 트리 안에 권한 조건을 끼워 넣으면 `OR` 그룹 안에서 권한이 무력화된다 — 이 도메인에서 가장 위험한 단일 버그 |
  | **권한 없음**: `Can edit content` 사용자 | 뷰 필터 저장 불가, 개인 필터(F-04-17)만 허용(F-04-25) |
  | **대용량**: 25만 행 | 필터는 반드시 서버측 평가. 클라이언트 필터링은 load limit 이후 데이터를 놓친다 |
  | **대용량**: formula/rollup 조건 | 인덱스 불가 → 전체 스캔. 클론 권고: **파생값을 물리 컬럼으로 머티리얼라이즈**하고 쓰기 시점에 갱신. 아니면 25만 행에서 타임아웃 |
  | **대용량**: 상대 날짜(`past_week` 등) | 조회 시점에 절대 범위로 전개하되 **캐시 키에 전개된 날짜 경계를 포함**. 심볼 그대로 캐시하면 자정 이후에도 어제 결과가 나온다 |
- **데이터 모델 함의**:
  - `view.filter jsonb` 에 재귀 트리 저장(정규화보다 JSON 권장).
  - 서버는 트리를 SQL WHERE로 컴파일하는 컴파일러가 필요하다. 프로퍼티가 `jsonb`에 있다면 타입별 추출 표현식 + 생성 컬럼/GIN 인덱스 전략이 성능을 결정한다.
  - 개인 필터: `view_user_override(view_id, user_id, filter, sorts)`.
- **UI/인터랙션**: 필터 칩(조건 요약), 칩 클릭 시 편집 팝오버, `Add filter rule` / `Add filter group`, And/Or 콤보(그룹 내 일괄 적용), 필터 삭제, 필터바 quick filter.
- **의존 기능**: property 타입 시스템, 서버 쿼리 엔진.
- **구현 난이도**: **XL** — 20여 타입 × 다수 연산자 × 재귀 트리 × SQL 컴파일 + 인덱스 전략. 이 도메인에서 코드량이 가장 많다.
- **우선순위**: **P0**.
- **클론 시 현실적 대안**: MVP는 (1) 단일 레벨 AND만, (2) text/number/checkbox/select/status/date 6개 타입만, (3) 상대 날짜는 today/past_week/next_week만. 중첩 그룹과 formula/rollup 필터는 v1 이후.
- **참고 출처**: https://developers.notion.com/reference/filter-data-source-entries , https://www.notion.com/help/views-filters-and-sorts , https://developers.notion.com/page/changelog , https://www.notion.com/releases/2025-11-17

---

### F-04-10 Sort (다중 키)

- **한 줄 정의**: 하나 이상의 프로퍼티를 우선순위 순서대로 지정해 행 순서를 결정한다.
- **사용자 시나리오**: 툴바 `Sort` 클릭 → 프로퍼티 선택 → Ascending/Descending 선택 → `+ Add sort` 로 2차 키 추가 → 정렬 항목 좌측 `⋮⋮` 드래그로 우선순위 변경 → `Save for everyone` 여부 선택.
- **동작 상세**:
  - `sorts` 배열의 **인덱스가 곧 우선순위**: `[{property_id, direction}]`.
  - 타입별 비교: text = 알파벳(로케일), number = 수치, date = 시간, checkbox = false < true, **select/multi_select = 옵션 정의 순서**(헬프센터: "정렬 순서의 의미를 직접 정한다").
  - 정렬이 하나라도 걸리면 **수동 드래그 재정렬이 무효화**된다(`position` 무시).
  - timestamp(created_time / last_edited_time) 기준 정렬도 지원.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 값이 비어 있음 | null 위치 정책 필요. 오름차순에서 빈 값 뒤로 보내는 것으로 관찰 `[추정 / 확인필요]` |
  | 완전 동점 | 마지막 tie-breaker로 `position` 또는 `id` 필수 — 없으면 페이지네이션이 불안정 |
  | 커서 페이지네이션 + 정렬 | 커서에 정렬 키 튜플 + id 포함 필요. offset 기반은 동시 삽입 시 누락/중복 |
  | 정렬 중 값 변경(동시편집) | 행이 리스트 내에서 점프 |
  | formula/rollup 정렬 | 인덱스 불가 → 느림 |
  | 정렬 프로퍼티 삭제 | 해당 sort 엔트리 제거 |
  | 대소문자 | 대소문자 무시 비교 권장 `[확인필요]` |
  | **중첩**: sub-item 트리에 정렬 적용 | **형제 그룹 내부에서만** 정렬해야 트리가 유지된다. 전역 정렬을 그대로 적용하면 자식이 부모 위로 올라간다(F-04-22) |
  | **중첩**: group + sort | 그룹 순서(`group_by.sort`)와 그룹 내 행 정렬(`sorts`)은 **완전히 별개의 축**이다. 하나로 합치면 board 컬럼 순서가 카드 정렬에 끌려간다 |
  | **순환 참조**: 해당 없음 | 정렬은 행 간 참조를 만들지 않는다. 단 relation 의 title 로 정렬하면 **조인이 생기고 인덱스가 사라진다** — 허용 여부를 명시적으로 결정할 것 |
  | **권한 없음**: 읽기 전용 / `Can edit content` 사용자 | 공유 정렬 저장 불가. 개인 정렬은 `view_user_override(view_id, user_id)` 로 저장(F-04-17, F-04-25) |
  | **권한 없음**: 정렬 키가 볼 수 없는 행의 값 | 권한 필터가 정렬보다 **먼저** 적용되어야 한다. 순서가 뒤바뀌면 볼 수 없는 행이 순위에 영향을 준다 |
  | **대용량**: 25만 행 + 다중 키 정렬 | 복합 인덱스 `(data_source_id, k1, k2, id)` 가 없으면 전체 정렬. 뷰마다 인덱스를 만들 수는 없으므로 **정렬 가능 프로퍼티를 생성 컬럼으로 승격**하는 편이 현실적 |
  | **대용량**: 정렬 변경 시 | 커서 전면 폐기 + 처음부터 재조회. 기존 커서를 재사용하면 결과가 섞인다(F-04-15) |
- **데이터 모델 함의**: `view.sorts jsonb NOT NULL DEFAULT '[]'`. SQL: `ORDER BY expr1 ASC NULLS LAST, expr2 DESC, position, id`. select 정렬은 옵션 순서 인덱스 조인 또는 `array_position(options, value)` 표현식 필요.
- **UI/인터랙션**: 정렬 칩, 드래그 재정렬, 열 헤더 `···`에서 `Sort ascending/descending` 바로가기.
- **의존 기능**: F-04-09와 공유하는 쿼리 컴파일러, 커서 페이지네이션(F-04-15).
- **구현 난이도**: **M** — 다중 키 자체는 쉽지만 select 옵션 순서 정렬과 커서 안정성이 함정.
- **우선순위**: **P0**.
- **클론 시 현실적 대안**: MVP는 정렬 키 최대 3개. select는 옵션 순서 대신 라벨 알파벳 정렬로 단순화 후 교체.
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-11 Group by / Sub-group (빈 그룹 처리 포함)

- **한 줄 정의**: 프로퍼티 값을 기준으로 행을 버킷으로 묶고, 각 버킷을 섹션(table/list) 또는 컬럼(board)으로 렌더한다.
- **사용자 시나리오**: 뷰 설정 → `Group` → 프로퍼티 선택 → 그룹 정렬(Manual / Ascending / Descending) 선택 → 그룹 목록에서 눈 아이콘으로 개별 그룹 숨김 → `Hide empty groups` 토글 → board면 `Sub-group` 추가로 2차 축 구성.
- **동작 상세**:
  - `GroupSpec`은 프로퍼티 타입에 따라 버킷 생성 규칙이 다르다:
    | 프로퍼티 타입 | 버킷 생성 규칙 |
    |---|---|
    | select | 정의된 옵션마다 1개 + "No X" |
    | status | `status_mode`에 따라 status 그룹(To-do/In progress/Complete) 또는 개별 옵션 단위 |
    | multi_select | 옵션마다 1개. **한 행이 여러 버킷에 중복 등장** |
    | person | 값에 등장하는 사용자마다 1개 |
    | date | `date_granularity` = relative/day/week/month/year, `start_day_of_week` 적용 |
    | text | `exact`(값 그대로) 또는 `alphabet_prefix`(첫 글자) |
    | number | 값 그대로 또는 `number_bucket{size}` 구간화 |
    | checkbox | Checked / Unchecked 2개 |
    | relation | 연결된 페이지마다 1개 `[확인필요 — 지원 여부 문서 불일치]` |
  - **빈 그룹 vs No X 그룹은 다른 개념**: 빈 그룹 = 옵션은 있으나 행이 0개(`hide_empty_groups`로 제어), No X 그룹 = 값이 비어 있는 행의 수집처(개별 숨김으로 제어).
  - 그룹 순서: `sort='manual'`이면 `group_order` 배열, 아니면 값 기준 asc/desc.
  - 그룹 헤더에 행/카드 수 + 선택한 집계 표시.
  - table view도 group을 가질 수 있다(`configuration.group_by` optional).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | multi_select 그룹, 행이 값 3개 보유 | 3개 그룹에 각각 렌더. **카드 수 합 ≠ 행 수** → 카운트 표기 주의 |
  | 새 select 옵션 추가 | 즉시 새 빈 그룹 등장(hide_empty_groups=false 시) |
  | 옵션 삭제 | 그룹 소멸, 행은 "No X"로 이동 |
  | 그룹 프로퍼티 삭제 | group 해제 폴백 |
  | person 그룹 + 멤버 500명 | 값이 존재하는 사용자만 버킷 생성 |
  | date 그룹 + 5년치(day 단위) | 버킷 수 폭발 → 기본 granularity를 month로 두거나 상한 필요 |
  | 숨긴 그룹의 행 | 뷰에서 미표시. 집계 포함 여부 정책 필요 `[확인필요]` |
  | **빈 값**: 그룹 프로퍼티 값이 비어 있는 행 | "No X" 그룹으로 수집. **빈 그룹(옵션은 있으나 행 0개)과는 다른 개념**이며 제어 스위치도 다르다 |
  | **중첩**: group + sub_group(board 격자) | 버킷 수가 `|G| × |S|` 로 곱해진다. 상한(차트와 같은 200 × 50 수준)을 두지 않으면 렌더가 폭발한다 |
  | **중첩**: group + sub-item 트리 | 그룹 섹션 안에 트리. 펼침 상태 키가 `(group_key, row_id)` 로 이중화된다 — MVP 에서는 조합 금지 권장(F-04-02) |
  | **삭제된 참조**: 그룹 프로퍼티 삭제 | `view.group_by = NULL` 폴백. board 는 그룹이 필수이므로 **다음 후보(status → select → multi_select → person)로 자동 재바인딩**하고, 후보가 없으면 F-04-01 규칙대로 status 프로퍼티를 생성 |
  | **삭제된 참조**: `group_order` / `hidden_groups` 에 남은 죽은 키 | 렌더 시 무시하고 지연 GC. 매 조회마다 정리 쿼리를 돌리면 쓰기 부하가 는다 |
  | **순환 참조**: relation 그룹 | 자기참조 relation 으로 그룹하면 그룹 키가 행 id 가 되어 **행이 자기 그룹에 들어가는** 구조가 가능. relation 그룹은 미지원 고정이므로 실제로는 발생하지 않는다 |
  | **동시편집**: 그룹 순서 재배열 | `group_order` 배열 LWW `[추정]`. 클론 권고: 그룹 순서를 **select 옵션의 fractional index**(스키마 전역)로 옮기면 배열 LWW 자체가 사라진다 — 단 그러면 뷰별 그룹 순서를 포기하게 되므로 트레이드오프를 명시적으로 선택할 것 |
  | **동시편집**: A 가 카드를 옮기는 중 B 가 그 그룹을 숨김 | 이동은 성공시키고, A 화면에서 카드가 사라지면 토스트로 안내 |
  | **권한 없음**: 볼 수 없는 행 | **그룹 카운트에서도 제외**. 카운트만으로 비공개 행의 존재가 드러나는 대표 경로 |
  | **권한 없음**: `Can edit content` 사용자 | 그룹 설정 변경 불가. 단 카드 드래그(= 셀 값 변경)는 허용(F-04-25) |
  | **대용량**: 그룹 200개 × 각 5,000행 | **2단계 쿼리 필수** — (1) 그룹 키 + 카운트만, (2) 화면에 보이는 그룹만 상위 N행. 그룹별 독립 커서(F-04-15) |
- **데이터 모델 함의**:
  - `view.group_by jsonb`, `view.sub_group_by jsonb`.
  - 서버 그룹 쿼리는 2단계: (1) 그룹 키 목록 + 카운트, (2) 그룹별 상위 N행. 한 번에 전부 가져오면 board가 스케일하지 않는다.
  - 수동 그룹 내 순서: `row_position(view_id, group_key, row_id, position)`.
- **UI/인터랙션**: 그룹 헤더 접기/펼치기, 헤더 드래그 재정렬, 눈 아이콘 숨김, 헤더 우측 `+`(그 그룹 값으로 새 행 생성), 그룹별 집계 셀렉트.
- **의존 기능**: property 타입 시스템, F-04-03(board), F-04-10(그룹 내 정렬).
- **구현 난이도**: **L** — 타입별 버킷 생성기 9종 + multi_select 중복 등장 + 2단 그룹 + 그룹별 페이지네이션.
- **우선순위**: **P0** (board가 P0이므로). 단 `sub_group_by`만 떼면 **P2**.
- **클론 시 현실적 대안**: MVP는 select/status/checkbox 3종 그룹만. multi_select/date/number 버킷화와 sub-group은 이후 단계.
- **참고 출처**: https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/help/boards

---

### F-04-12 뷰별 표시 프로퍼티 / 컬럼 폭 / 순서 / 고정

- **한 줄 정의**: 어떤 프로퍼티를 어떤 순서·폭·형식으로 보여줄지를 **뷰마다 독립적으로** 저장한다.
- **사용자 시나리오**: 뷰 설정 → `Properties` → 각 프로퍼티 토글로 표시/숨김 → `⋮⋮` 드래그로 표시 순서 변경 → table에서는 열 경계 드래그로 폭 조정 → 헤더 `···` → `Freeze up to column` / `Wrap column` → date 프로퍼티는 표시 형식(full/short/relative) + 시간 형식(12h/24h/hidden) 선택 → status 프로퍼티는 `Show as` = select 또는 checkbox 선택.
- **동작 상세**:
  - API의 `configuration.properties[]` 항목 필드: `property_id`(required), `visible`, `width`(table 전용, px), `wrap`, `date_format`, `time_format`, `status_show_as`, `card_property_width_mode`(full_line | inline).
  - 프로퍼티 **정의(스키마)** 는 data source 전역, **표시 설정** 은 뷰 로컬. 새 프로퍼티를 추가하면 기존 뷰들에서는 기본 숨김 상태 `[추정 / 확인필요]`.
  - 뷰 내 표시 순서는 스키마 순서와 별개다.
  - card_layout이 board/gallery인 경우 `card_property_width_mode`로 카드 위 프로퍼티가 한 줄 전체를 쓰는지 인라인으로 붙는지 결정.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 프로퍼티 삭제 | 모든 뷰의 view_property 행을 cascade 정리 |
  | 프로퍼티 타입 변경(text→number) | 타입 전용 설정(date_format 등) 무효화 → null 처리 |
  | 새 프로퍼티 추가 | 기존 뷰에는 숨김으로 추가 `[확인필요]` |
  | title 프로퍼티 숨김 시도 | 거부(페이지 진입 경로 상실) |
  | width 미설정 | 타입별 기본 폭 적용 |
  | 동시편집: 표시 순서 vs 표시 여부 | 서로 다른 필드/행 → 병합 가능 |
  | **빈 값**: `width` 미설정 | NULL 유지 + 렌더 시 타입별 기본 폭 계산. 기본값을 물리적으로 써 넣지 말 것 |
  | **중첩**: 카드형 뷰(board/gallery)의 프로퍼티 표시 | `card_property_width_mode`(full_line/inline)가 추가로 필요. table 의 `width` 와는 다른 축이므로 같은 컬럼을 재사용하지 않는다 |
  | **삭제된 참조**: 프로퍼티 삭제 | 모든 뷰의 `view_property` cascade 정리 + `view.configuration` 의 평면 프로퍼티 참조 필드도 함께 null 처리 |
  | **순환 참조**: 해당 없음 | 표시 설정은 참조 그래프를 만들지 않는다 |
  | **동시편집**: A 가 순서 변경, B 가 표시 토글 | `view_property` **행 단위 테이블 + fractional index** 라면 서로 다른 컬럼/행이라 자연 병합. JSON 배열이면 전체 LWW 로 한쪽이 사라진다 — 이것이 배열 대신 테이블을 쓰는 결정적 이유 |
  | **권한 없음**: `Can edit content` / 잠긴 DB | 표시 프로퍼티·폭·순서 변경 차단. 다만 **개인 필터와 달리 표시 설정에는 개인 오버라이드가 없다**(노션도 없음) → 읽기 전용 사용자는 뷰 제작자의 설정을 그대로 본다 |
  | **대용량**: 500 프로퍼티 | Properties 패널 자체에 검색 + 가상 스크롤 필요. 표시 프로퍼티가 늘수록 쿼리 페이로드가 선형 증가하므로 **기본 표시 개수 상한(예: 8개)** 이 체감 성능에 크게 기여 |
- **데이터 모델 함의**: 위 `view_property` 테이블. JSON 배열로 두면 순서 변경이 배열 재작성(LWW)이 되어 동시편집 충돌이 커지므로, **행 단위 테이블 + fractional index position**을 권장.
- **UI/인터랙션**: Properties 사이드패널(토글 + 드래그), 열 헤더 컨텍스트 메뉴, `Show all` / `Hide all` 일괄 버튼.
- **의존 기능**: property 스키마, F-04-02.
- **구현 난이도**: **M** — 개념은 단순하나 타입별 표시 옵션이 프로퍼티 타입 수만큼 늘어난다.
- **우선순위**: **P0** — 표시 프로퍼티 제어 없이는 뷰가 의미를 갖지 못한다.
- **클론 시 현실적 대안**: MVP는 visible + position + width 3개 필드만. date_format/status_show_as 등 세부 표시 옵션은 v1 이후.
- **참고 출처**: https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/tables

---

### F-04-13 Linked view (다른 data source를 참조하는 뷰)

- **한 줄 정의**: 원본 데이터베이스를 그대로 둔 채, 다른 페이지에서 같은 데이터를 자신만의 필터/정렬/그룹으로 보는 뷰를 만든다.
- **사용자 시나리오**: 페이지에서 `/linked` 입력 → Enter → 데이터베이스 검색 → 선택 → "기존 뷰 복사" 또는 "새 뷰 생성" 선택 → 삽입된 블록에서 필터/정렬/표시 프로퍼티를 원본과 무관하게 설정.
- **동작 상세**:
  - **뷰 레벨 변경은 독립적**: "The views, filters, sorts, and groups you create and delete will not affect the views on the original database".
  - **구조적 변경은 전역 전파**: 제목·프로퍼티 스키마·행 데이터 변경은 원본과 링크된 모든 뷰에 반영된다.
  - **권한은 원본을 따른다(원문)**: `Linked data sources in a database will respect the access level of the original database`. 원본에 읽기 권한만 있으면 링크드 뷰에서도 쓰기 불가이며, **링크를 통해 권한이 상승하지 않는다**.
  - **단 하나의 예외(2차 조사에서 확인)**: `Can edit content` 등급 사용자는 **원본 DB 에서는 뷰를 만들 수 없지만 다른 페이지의 linked database 위에서는 자기 뷰를 만들 수 있다**(헬프센터 권한 가이드 명시). 즉 "원본 ACL 을 그대로 상속"이 아니라 **"행 데이터 권한은 상속, 뷰 생성 권한은 링크드 컨테이너 쪽에서 다시 판정"** 이 정확한 규칙이다. 클론에서 권한 판정을 `level(원본 data_source)` 한 줄로 끝내면 이 케이스가 잘못 막힌다 → 능력 단위 판정 필요(F-04-25).
  - data source 수정은 `Can edit`, data source 이동은 `Full access` 가 필요하다(헬프센터 명시). 즉 **뷰 편집 권한과 data source 이동 권한이 다른 등급**이므로 권한 체크를 한 덩어리로 만들면 안 된다.
  - **Form 뷰는 원본 database에서만 생성 가능**, 링크드 데이터베이스에서는 불가.
  - 하나의 database가 여러 data source를 묶을 수 있으므로, 링크드 데이터베이스는 "원본 data source를 가리키는 새 database 컨테이너 + 새 view"로 표현된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 원본 데이터베이스 삭제(휴지통) | 링크드 뷰는 "삭제된 데이터베이스" 상태로 렌더. 복원 시 복구되어야 함 |
  | 원본 영구 삭제 | 링크드 뷰 블록을 깨진 참조 상태로 표시하고 삭제 유도 |
  | 원본에 대한 권한 없는 사용자가 링크드 뷰가 있는 페이지를 봄 | 데이터 미표시 + "접근 권한 없음" 안내. **데이터 유출 방지가 핵심** |
  | 원본 프로퍼티 삭제 | 링크드 뷰의 해당 필터/정렬/표시 설정 정리 |
  | 링크드 뷰에서 행 추가 | 원본 data source에 행이 생성됨. 링크드 뷰의 필터 조건을 기본값으로 채울지 결정 필요 `[확인필요]` |
  | 순환(원본 페이지 안에 자기 자신 링크드 뷰) | 렌더 무한 재귀 방지 필요 |
  | **동시편집** | 뷰 설정은 각 링크드 뷰에 독립 저장이라 충돌 없음. 단 **스키마 변경(프로퍼티 추가/삭제)은 전역 전파**이므로 모든 링크드 뷰 구독자에게 브로드캐스트해야 한다(F-04-24) |
  | **중첩**: 링크드 뷰 안의 행 페이지에 또 다른 링크드 뷰 | 데이터 순환은 없지만 **렌더 재귀**가 발생한다. 깊이 카운터로 차단(F-04-02/F-04-14 와 같은 가드) |
  | **중첩**: dashboard 위젯으로 놓인 링크드 뷰 | 위젯 개수만큼 원본 ACL 재판정이 곱해진다(F-04-20) |
  | **빈 값**: 원본 data source 에 행이 0개 | 빈 상태 렌더. "연결이 끊겼다"는 오해가 없도록 **원본 이름과 링크 아이콘은 계속 표시** |
  | **대용량**: 한 원본을 수백 개 링크드 뷰가 참조 | 원본 행 1건 변경이 **N개 뷰의 멤버십 재평가**로 팬아웃된다 → 뷰 단위가 아니라 `(data_source_id)` 단위로 코얼레싱한 뒤 각 뷰가 재조회하도록 얇은 알림만 보낸다(F-04-24) |
  | **대용량**: 링크드 뷰마다 다른 필터 | 결과 캐시가 뷰 수만큼 쪼개진다. 캐시 키를 `(data_source_id, filter_hash, permission_hash)` 로 잡으면 **동일 필터를 쓰는 링크드 뷰끼리는 캐시를 공유**할 수 있다 |
- **데이터 모델 함의**:
  - 별도 엔티티 불필요. `database.id ≠ data_source.database_id` 인 경우, 즉 **`view.data_source_id`가 다른 database 소유의 data source를 가리키면 그것이 linked view**다.
  - 권한 체크는 항상 `data_source → 원본 database → 부모 페이지`의 ACL을 따라 올라가 판정해야 한다.
  - 쿼리 시 `view.data_source_id`로 조회하므로 쿼리 경로 자체는 일반 뷰와 동일하다.
- **UI/인터랙션**: `/linked` 슬래시 커맨드, 데이터베이스 검색 팝오버, 블록 상단에 원본 데이터베이스 이름 + 화살표 아이콘 표시, 클릭 시 원본으로 이동.
- **의존 기능**: F-04-01, 권한 시스템, 블록 트리(슬래시 커맨드).
- **구현 난이도**: **M~L** — 데이터 모델을 처음부터 `view → data_source` 참조로 설계했다면 추가 작업은 검색 UI 정도다. 그러나 **권한 계산은 과소평가하기 쉽다**: 링크드 뷰는 "이 페이지를 볼 수 있는 사람"과 "원본 data source 를 볼 수 있는 사람"이 다르므로, 행 목록·집계·그룹 카운트·실시간 브로드캐스트 **네 경로 모두에서 원본 ACL 을 재판정**해야 한다. 한 곳이라도 빠지면 카운트만으로 비공개 데이터의 존재가 새어 나간다. `view` 를 `database` 에 강결합해 설계했다면 여기에 리팩터 비용이 더해져 **L**.
- **우선순위**: **P1** — 노션 워크플로의 핵심(대시보드 페이지 구성)이지만 MVP 이후여도 됨. **단, 데이터 모델은 MVP 시점에 미리 분리해 둘 것.**
- **클론 시 현실적 대안**: MVP에서 기능은 빼되 `view.data_source_id` 참조 구조만 미리 확보. v1에서 UI만 얹는다.
- **참고 출처**: https://www.notion.com/help/data-sources-and-linked-databases , https://www.notion.com/help/guides/using-linked-databases , https://www.notion.com/help/intro-to-databases

---

### F-04-14 인라인 데이터베이스 vs 풀페이지 데이터베이스

- **한 줄 정의**: 데이터베이스를 페이지 본문 안의 블록으로 배치할지, 하나의 페이지 전체를 차지하는 형태로 배치할지 결정한다.
- **사용자 시나리오**: 인라인 → 풀페이지: 인라인 DB 블록을 사이드바 최상위로 드래그. 풀페이지 → 인라인: 사이드바에서 DB를 다른 페이지의 하위로 드래그해 서브페이지로 만든 뒤, 페이지 안에서 `⋮⋮` → `Turn into inline`.
- **동작 상세**:
  - 인라인: 페이지의 다른 블록과 위아래로 섞여 배치된다. 툴바가 hover 시에만 노출되고 세로 공간이 제한적이라 **load limit 설정(10/25/50/100)** 이 함께 제공된다.
  - 풀페이지: 페이지 전체가 데이터베이스이며 툴바/뷰 탭이 상시 노출된다. 페이지 아이콘·커버·제목을 그대로 사용한다.
  - `is_full_width` 토글로 인라인 DB를 페이지 폭 전체로 확장할 수 있다 `[확인필요 — 블록 공통 설정과 동일한지]`.
  - 전환 시 데이터·뷰·필터는 모두 보존된다 `[추정]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 풀페이지 DB를 인라인으로 전환 | 원래 페이지는 DB를 담는 일반 페이지가 되어야 함(빈 껍데기 페이지 처리 필요) |
  | 인라인 DB가 있는 페이지 복제 | DB도 함께 복제할지, 링크드 뷰로 둘지 정책 필요 |
  | 인라인 DB를 다른 페이지로 드래그 | parent_block_id 갱신 |
  | 인라인 DB 100개가 한 페이지에 | 심각한 성능 저하. 노션 공식 권고는 "링크드 뷰 사용" |
  | 인라인 DB 안에서 다시 인라인 DB 생성 | 행 페이지 본문 안에는 가능. 중첩 깊이 제한 필요 `[확인필요]` |
  | **빈 값**: 인라인 DB 에 행 0개 | 빈 상태 + `+ New` 만. 블록 높이를 0 으로 접으면 사용자가 블록을 선택·삭제할 수 없다 |
  | **빈 값**: 풀페이지 DB 의 제목 미입력 | `Untitled` 폴백. 사이드바 항목명도 동일 폴백 |
  | **중첩**: 인라인 DB 안에서 다시 인라인 DB 생성 | 행 페이지 본문 안에는 가능. 중첩 깊이 제한 필요 `[확인필요 — 노션의 상한 미확인]`. 클론 권고: 렌더 깊이 3 |
  | **중첩**: toggle / column / callout 블록 안의 인라인 DB | 부모 블록 폭이 좁아지므로 **가로 가상 스크롤과 컨테이너 폭 측정이 필수**. `is_full_width` 는 부모 폭 기준으로 해석 |
  | **삭제된 참조**: 인라인 DB 블록만 삭제 | 블록과 database 의 수명을 같게 볼지(hard) 휴지통으로 보낼지(soft) 정책 결정 필요. 노션은 휴지통 경유 `[추정]` |
  | **삭제된 참조**: 풀페이지 DB 를 담던 부모 페이지 삭제 | 서브트리 soft delete. 복원 시 database 와 전체 뷰가 함께 복구되어야 한다 |
  | **순환 참조**: 인라인 DB 의 행 페이지 본문에 그 DB 자신의 인라인/링크드 뷰 | 렌더 깊이 카운터로 차단(F-04-02) |
  | **동시편집**: A 가 인라인↔풀페이지 전환, B 가 같은 DB 에서 행 편집 | 전환은 **블록/페이지 계층 재배치**이고 행 편집은 data source 쓰기 → 서로 다른 엔티티라 충돌 없음. 단 B 의 라우트가 바뀌므로 전환 후 **경로 리다이렉트 이벤트**를 브로드캐스트할 것 |
  | **권한 없음**: 인라인 | 부모 페이지 권한을 상속. 부모 페이지를 볼 수 있으면 DB 도 보인다 |
  | **권한 없음**: 풀페이지 | 자체 공유 설정 가능 + database 전용 등급(`Can edit content`)이 붙는다(F-04-25) |
  | **권한 없음**: 인라인 DB 를 풀페이지로 전환 | 상속받던 권한이 **자체 ACL 로 승격**된다. 전환 시점의 유효 권한을 스냅샷해 명시적 ACL 로 써 넣지 않으면 접근권이 조용히 넓어지거나 좁아진다 `[확인필요 — 노션 실제 동작 미확인]` |
  | **대용량**: 한 페이지에 인라인 DB 100개 | 심각한 성능 저하. 노션 공식 권고는 "링크드 뷰 사용". 클론 권고: 인라인 DB 블록은 **뷰포트 진입 시에만 쿼리**(IntersectionObserver) |
- **데이터 모델 함의**:
  - `database.is_inline boolean NOT NULL DEFAULT true`, `database.parent_block_id uuid`, `database.is_full_width boolean`.
  - **블록 트리와 DB 엔티티의 접합점이 이 한 컬럼**이다. 블록 테이블에 `block(type='database', target_database_id)` 를 두고 렌더러가 위임하는 형태가 가장 단순하다.
  - 풀페이지: `page(id) 1:1 database(id)` 로 두지 말고 `database.parent_block_id = <부모 페이지 블록>` + `is_inline=false` 로 통일한다. 별도 매핑 테이블을 만들면 전환 때마다 두 테이블을 옮겨야 한다.
  - 전환 연산: `UPDATE database SET is_inline = ?, parent_block_id = ? WHERE id = ?` + 블록 트리 삽입/삭제를 **한 트랜잭션**으로. 뷰·필터·행은 손대지 않는다(= 전환은 데이터 무손실 연산이어야 한다).
  - 인덱스: `database(parent_block_id)`, `block(target_database_id)`.
- **UI/인터랙션**: 블록 `⋮⋮` 메뉴의 `Turn into inline` / `Turn into page`, 사이드바 드래그, 인라인 DB hover 시 툴바 표시.
- **의존 기능**: 블록 트리, 페이지 계층, 사이드바.
- **구현 난이도**: **M** — 전환 시 페이지/블록 계층 재배치 로직이 까다롭다.
- **우선순위**: **P0**(둘 중 하나는 반드시 필요) / 전환 기능만 떼면 **P2**.
- **클론 시 현실적 대안**: MVP는 풀페이지만 지원(라우팅이 단순함). 인라인은 v1, 상호 전환은 v2.
- **참고 출처**: https://www.notion.com/help/guides/full-page-vs-inline-databases , https://www.notion.com/help/intro-to-databases , https://www.notion.com/help/optimize-database-load-times-and-performance

---

### F-04-15 페이지네이션 / load limit / 가상 스크롤

- **한 줄 정의**: 대량 행을 한 번에 렌더하지 않고, 초기 로드 개수를 제한하고 스크롤에 따라 추가 로드하며 화면 밖 DOM을 만들지 않는다.
- **사용자 시나리오**: 인라인 DB `···` → `Load limit` → 10/25/50/100 중 선택 → 목록 하단에 `Load more` 버튼 표시 → 클릭 시 다음 묶음 추가. table을 아래로 스크롤하면 보이는 행만 DOM에 존재.
- **동작 상세**:
  - **load limit**: 인라인 DB에서 최초 렌더할 페이지 수(10/25/50/100). 목적은 "성능 향상 + 스크롤 길이 단축"이라고 문서에 명시.
  - **API 커서 페이지네이션**: `POST /v1/views/{view_id}/queries` 로 쿼리를 생성하고 `GET /v1/views/{view_id}/queries/{query_id}` 로 후속 페이지를 가져온다. `DELETE`로 캐시 해제.
  - **쿼리 캐시는 약 15분 후 만료**되며, 페이지네이션 진행 중 결과 집합은 안정적으로 유지된다(= 스냅샷 격리).
  - **뷰 쿼리에는 추가 필터/정렬을 얹을 수 없다**. 다른 조건이 필요하면 별도 뷰를 만들어야 한다.
  - 데이터베이스 상한: 250,000 rows, 500 properties, 페이지당 프로퍼티 데이터 2.5MB, 스키마 1.5MB, 양방향 relation 참조 10,000개. files/media/formula/rollup/본문 블록은 2.5MB 계산에서 제외.
  - 성능 저하 요인(문서 명시): 행 수, **표시 중인 프로퍼티 수**, title/text/formula/rollup 기반 정렬·필터.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 페이지네이션 도중 다른 사용자가 행 삽입/삭제 | 스냅샷 커서라면 결과 안정. 실시간 커서라면 행 중복/누락 발생 → **정렬 키 튜플 커서 사용 필수** |
  | 쿼리 캐시 만료 후 다음 페이지 요청 | 410/만료 응답 → 클라이언트가 처음부터 재조회 |
  | 그룹 뷰의 페이지네이션 | 그룹별로 독립 커서 필요. 전체 목록 하나의 커서로는 board를 표현할 수 없다 |
  | 필터 변경 | 기존 커서 폐기, 재쿼리 |
  | 가변 행 높이(wrap cells) | 고정 높이 가정형 가상 스크롤이 깨짐 → 동적 높이 측정(measure) 지원 필요 |
  | 스크롤 중 실시간 업데이트 수신 | 뷰포트 밖 행 갱신은 데이터만 반영하고 스크롤 위치는 유지 |
  | 250,000행에 정렬 없이 전체 스캔 | 인덱스 없는 정렬/필터는 타임아웃 → 서버 타임아웃 및 상한 응답 필요 |
  | **권한 없음**: 볼 수 없는 행이 섞인 결과 | 권한 조건이 **커서 조건과 같은 WHERE 에** 들어가야 한다. 조회 후 애플리케이션에서 걸러내면 페이지당 개수가 들쭉날쭉해지고 `has_more` 가 거짓말을 한다 |
  | **권한 없음**: 페이지네이션 도중 권한이 회수됨 | 다음 페이지 요청부터 즉시 반영. 스냅샷 캐시를 쓴다면 **캐시에도 권한 해시를 키로 넣어** 회수 후 옛 스냅샷이 재사용되지 않게 한다 |
  | **권한 없음**: 총 개수(total) 노출 | 권한 필터를 적용한 개수만 반환. 전체 개수를 그대로 주면 비공개 행의 존재가 새어 나간다 |
  | **순환 참조**: 커서가 자기 자신을 가리키는 무한 루프 | `next_cursor` 가 이전 커서와 동일하면 **서버가 즉시 에러**를 반환한다. 동점 tie-breaker(`id`)가 빠지면 실제로 발생하는 버그다 |
  | **순환 참조**: sub-item 트리를 lazy expand 하며 페이지네이션 | 조상 체인 방문 집합 없이 재귀 CTE 를 돌리면 순환 데이터에서 무한 루프. `depth` 상한 + 방문 집합 필수(F-04-22) |
  | **빈 값**: 결과 0행 | `{rows: [], has_more: false, next_cursor: null, aggregates: {...}}`. 빈 배열과 에러를 구분해서 응답할 것 |
- **데이터 모델 함의**:
  - 커서 인코딩: `base64({sort_key_values[], row_id})` → `WHERE (k1, k2, id) > (v1, v2, vid)` 형태의 keyset pagination.
  - 선택적으로 `query_snapshot(query_id, view_id, row_ids[], created_at)` 캐시 테이블(노션식 15분 만료 모델).
  - 그룹 쿼리 응답: `{ groups: [{key, count, rows[], next_cursor}], total }`.
- **UI/인터랙션**: `Load limit` 메뉴, `Load more` 버튼, 무한 스크롤, 스켈레톤 로딩 행, 스크롤바 길이가 실제 데이터량을 반영하도록 총 개수 사전 조회.
- **의존 기능**: F-04-09/10(쿼리 컴파일), 실시간 동기화.
- **구현 난이도**: **L** — keyset 커서 설계 + 그룹별 커서 + 동적 높이 가상 스크롤 + 실시간 업데이트 병합.
- **우선순위**: **P0** — 없으면 수천 행에서 즉시 사용 불가가 된다.
- **클론 시 현실적 대안**: MVP는 (1) TanStack Virtual로 행 가상화, (2) keyset 커서 + `Load more` 버튼, (3) 그룹 뷰는 그룹당 상위 50행만 로드하고 나머지는 그룹별 `Load more`. 15분 스냅샷 캐시는 생략하고 keyset만으로 안정성 확보.
- **참고 출처**: https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/optimize-database-load-times-and-performance , https://x.com/NotionHQ/status/1331678200234065920

---

### F-04-16 열/그룹 집계 (Calculations)

- **한 줄 정의**: 열 하단과 그룹 헤더에 필터 통과 행 기준의 집계값을 표시한다.
- **사용자 시나리오**: table 열 하단 `Calculate` 클릭 → 집계 함수 선택 → 값 표시. board 컬럼 헤더의 회색 숫자 클릭 → 카드 수 대신 sum/average/date range/percent 등으로 변경.
- **동작 상세**:
  - 함수 목록(헬프센터 기준): count all / count values / count unique values / count empty / count not empty, percent empty / percent not empty, sum / average / median / min / max / range, earliest date / latest date / date range.
  - 사용 가능 함수는 프로퍼티 타입에 의존한다(숫자 집계는 number/formula(number)/rollup(number)에서만).
  - board 컬럼은 기본값이 카드 수.
  - 집계 대상은 **현재 필터를 통과한 행** `[추정 — 문서 미기재]`. 페이지네이션으로 로드되지 않은 행도 포함되어야 하므로 **반드시 서버측 계산**이어야 한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 행 0개 | count 계열 = 0, sum = 0, average/median/min/max = 빈 값(`—`). 0 과 빈 값을 구분해야 함 |
  | 값이 전부 비어 있음 | average 는 0 이 아니라 빈 값이어야 한다 `[확인필요]`. SQL `AVG` 가 NULL 을 반환하는 것과 동일 의미로 맞추면 안전 |
  | count unique + multi_select | **값 단위 유니크**(옵션 집합의 distinct)로 정의 권장. 셀 단위로 하면 `A,B` 와 `B,A` 가 다르게 세짐 |
  | **삭제된 참조**: 집계 대상 프로퍼티 삭제 | `view_property.calculation` cascade 정리. 남아 있으면 매 쿼리마다 unknown property 에러 |
  | **삭제된 참조**: rollup/formula 대상이 삭제됨 | 집계 결과를 빈 값으로 두고 에러 배지 표시. 쿼리 전체 실패 금지 |
  | **권한 없음** | 볼 수 없는 행은 **집계 이전에** 제외. 집계는 권한 누수 경로다 — 개수만으로도 비공개 행의 존재가 드러난다 |
  | **동시편집** | 다른 사용자의 셀 수정으로 집계가 바뀌면 **행 델타와 같은 트랜잭션에서 재계산값을 push** 하거나, 디바운스(예: 300ms) 후 재조회. 매 키 입력마다 전체 재집계 금지 |
  | **대용량** | 매 스크롤마다 재계산 금지 — 행 쿼리 응답에 `aggregates` 를 함께 담아 1회 왕복으로 끝낸다. 250,000행 sum 은 인덱스 스캔이라도 수백 ms 이므로 **집계 캐시 + 무효화 키(data_source_id, filter_hash)** 를 둘 가치가 있다 |
  | 숨긴 그룹 / 접힌 그룹 | 집계 포함 여부 정책 필요 `[확인필요]`. 클론 권고: **필터는 반영, 그룹 숨김은 미반영**(숨김은 표시 설정일 뿐) |
- **데이터 모델 함의**: `view_property.calculation text`, 그룹 헤더 집계는 `view.group_by.calculation`. 응답 형태: `{ rows: [...], aggregates: {"<property_id>": value}, groups: [{key, count, aggregates}] }`.
- **UI/인터랙션**: 열 하단 hover 시 `Calculate` 노출, 드롭다운 함수 선택, 그룹 헤더 클릭.
- **의존 기능**: F-04-09(필터), F-04-11(그룹), 서버 집계 쿼리.
- **구현 난이도**: **M~L** — 단일 열 집계는 SQL 한 줄이지만, (1) 타입 × 함수 허용 매트릭스, (2) **그룹별 집계를 행 페이지네이션과 같은 응답에 담기**, (3) 권한 필터를 집계에도 동일 적용, (4) 실시간 갱신 시 재계산 트리거까지 합치면 M 을 넘어간다. 초기 M 평가는 (2)(4)를 빠뜨린 과소평가였다.
- **우선순위**: **P1**.
- **클론 시 현실적 대안**: count / sum / average / percent not empty 4종만 MVP 이후 추가.
- **참고 출처**: https://www.notion.com/help/tables , https://www.notion.com/help/boards , https://deepwiki.com/AppFlowy-IO/AppFlowy/7.2-database-views-(filters-sorts-groups)

---

### F-04-17 개인 필터/정렬 vs 전체 공유 ("Save for everyone")

- **한 줄 정의**: 필터·정렬 변경을 나에게만 적용할지, 뷰 설정으로 저장해 모두에게 적용할지 선택한다.
- **사용자 시나리오**: 필터 추가 → 툴바에 "Save for everyone" 버튼 노출 → 누르지 않으면 본인 세션에만 적용 → 누르면 뷰 설정에 영구 저장되어 모든 사용자에게 반영 → `Reset` 으로 개인 변경 폐기.
- **동작 상세**:
  - **원문 재확인(정정)**: 초판이 인용한 "The option to 'Save for everyone' applies the filter workspace-wide; otherwise it remains personal." 은 헬프센터에 그대로 존재하지 않는 **의역**이었다. 실제 원문은 "You can choose to Save for everyone if you want the filter to be applied for everyone in the database view. If you want the filter to apply only for you, don't select this option." 이다. 적용 범위는 workspace-wide 가 아니라 **`for everyone in the database view`**(그 뷰를 보는 모든 사람)이므로, 클론의 저장 단위도 워크스페이스가 아니라 **뷰**여야 한다.
  - 정렬에도 같은 패턴이 적용된다 `[추정 — 정렬에 대한 별도 원문은 확인하지 못했으나 UI 상 같은 툴바·같은 버튼을 공유한다]`.
  - 개인 변경은 사용자별로 지속되는지, 세션 한정인지 문서에 없다 `[확인필요 — 관찰상 사용자별로 지속되는 것으로 보임, 추정]`.
  - 읽기 권한만 있는 사용자도 개인 필터는 적용할 수 있어야 한다(공유 저장은 불가).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | **삭제된 참조**: 개인 필터가 참조하는 프로퍼티 삭제 | 해당 노드만 제거하고 나머지 개인 필터는 유지. override 전체 삭제는 과잉 |
  | 공유 필터 + 개인 필터 동시 존재 | **결합 규칙을 반드시 하나로 못박아야 한다** `[확인필요 — 노션 실제 동작 미확인]`. 클론 권고: 개인 필터는 공유 필터를 **대체(replace)** 한다. AND 결합으로 하면 사용자가 공유 필터를 완화할 방법이 없어 "내 필터를 넣었는데 행이 더 줄었다"는 혼란이 생긴다 |
  | 개인 정렬 + 공유 정렬 | 정렬은 결합이 무의미하므로 **개인 정렬이 존재하면 전면 대체** |
  | **동시편집**: A가 개인 필터 사용 중 B가 공유 필터 변경 | A 화면은 개인 필터가 대체하므로 변화 없음. 단 **개인 필터 Reset 시 새 공유 필터가 적용**되어야 하므로 공유 필터 갱신은 계속 구독 |
  | **권한 없음**: 읽기 전용 사용자 | 개인 필터·정렬은 허용, `Save for everyone` 버튼 미노출 |
  | 뷰 삭제 / 사용자 탈퇴 | override cascade 삭제 |
  | 익명(퍼블릭 링크) 사용자 | 저장 대상 user_id 가 없음 → localStorage 폴백. **서버에 익명 override 행을 만들면 무한 증식** |
  | **대용량 / 캐시** | 개인 필터가 생기면 **쿼리 캐시 키에 user_id 가 들어간다** → 캐시 적중률이 사용자 수만큼 떨어진다. 공유 뷰 결과 캐시와 분리해 설계할 것 |
  | 개인 필터 지속 범위 | 세션 한정인지 사용자별 영구인지 노션 문서에 없음 `[확인필요]`. 클론 권고: **사용자별 영구 + 명시적 Reset**(새로고침마다 초기화되면 필터를 매번 다시 거는 고통이 큼) |
- **데이터 모델 함의**: `view_user_override(view_id, user_id, filter, sorts)`. 쿼리 시 `effective_filter = merge(view.filter, override.filter)`. **결합 규칙을 코드 한 곳에 명시**해야 버그가 나지 않는다.
- **UI/인터랙션**: 툴바에 "Save for everyone" / "Reset" 버튼, 개인 필터 적용 중임을 알리는 시각 표시.
- **의존 기능**: F-04-09, F-04-10, 인증/사용자 식별.
- **구현 난이도**: **M** — 테이블 하나로 끝나 보이지만, (1) 쿼리 캐시 키에 user_id 가 섞여 캐시 전략이 바뀌고, (2) 실시간 브로드캐스트를 "뷰 단위"에서 "뷰 × 사용자 단위"로 쪼개야 하며(같은 뷰라도 사용자마다 결과 집합이 다름), (3) 공유/개인 결합 규칙이 쿼리 경로 전체에 스며든다. S 평가는 (1)(2)를 빠뜨린 과소평가였다.
- **우선순위**: **P2** — 협업 규모가 커지기 전에는 없어도 무방.
- **클론 시 현실적 대안**: MVP는 모든 필터 변경을 즉시 전체 저장(개인 필터 없음). v2에서 override 도입.
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts

---

### F-04-18 Form view (쓰기 전용 뷰)

- **한 줄 정의**: 같은 data source 위에 놓이는 뷰이지만 행을 **보여주는** 대신 **행을 생성하는 입력 폼**을 렌더한다.
- **사용자 시나리오**: 페이지에서 `/form` 입력(신규 생성) 또는 기존 DB 뷰 탭 `+` → Form 선택 → 질문 목록에 프로퍼티를 배치 → 질문마다 `Required` 토글 / 설명 문구 / (텍스트) `Long answer` / (multi_select·relation) 최대 선택 개수 지정 → 제목·설명·아이콘·커버·제출 버튼 색상·확인 메시지 편집 → 우상단 공유에서 공개 범위 선택 → 링크 배포 → 제출 시 data source 에 **새 행 1개 생성**.
- **동작 상세**:
  - API configuration 필드: `is_form_closed`, `anonymous_submissions`, `submission_permissions`. (질문 구성·조건부 로직에 해당하는 필드는 공개 목록에 없음 `[확인필요]`)
  - 질문 타입 = **프로퍼티 타입에서 파생**된다. 별도 질문 타입 체계가 아니라 property → question 매핑이다.
  - `Sync with property name` 토글: 질문 라벨을 프로퍼티 이름과 분리할 수 있다 → **질문 라벨은 뷰 로컬 데이터**.
  - 익명 제출을 끄면 `Respondent` 프로퍼티가 자동 생성되어 제출자를 기록한다.
  - 공개 범위 3단: 워크스페이스 멤버 / `anyone on the web with link` / 닫힘(`is_form_closed`).
  - 제출자의 응답 열람 권한은 `No access` ~ `Full access` 범위로 별도 지정(워크스페이스 전용 폼).
  - 조건부 로직(if/then 분기)은 **Business·Enterprise 플랜 한정**.
  - **링크드 데이터베이스에는 폼을 만들 수 없다** — 원본 database 에서만 생성 가능(F-04-13 과 직접 충돌하는 제약).
  - 모바일에서는 폼 생성·편집 불가(제출만 가능).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 폼이 닫힌 뒤 기존 링크로 접근 | 제출 차단 + 닫힘 안내. 200 으로 폼을 렌더하면 안 됨 |
  | 질문이 참조하는 **프로퍼티 삭제** | 해당 질문 제거. 이미 배포된 링크가 500 나면 안 되므로 렌더 시 unknown property 는 스킵 |
  | 필수 질문의 프로퍼티가 나중에 타입 변경 | 질문 세부 설정(최대 선택 수 등) 초기화, `required` 는 유지 |
  | **권한**: 익명 사용자의 제출 | 서버는 **폼 뷰 토큰만으로 INSERT 만 허용**해야 하며 같은 토큰으로 SELECT 가 되면 안 된다. 폼은 권한 모델의 예외 경로다 |
  | 익명 제출 + relation 질문 | 익명 사용자가 대상 DB 행 목록을 조회하게 되므로 **relation 옵션 노출 범위 제한** 필요(미고려 시 데이터 유출) |
  | 스팸/대량 제출 | rate limit + 캡차. 노션도 고응답 폼은 느려진다고 명시 |
  | **동시편집**: 폼 편집 중 다른 사용자가 제출 | 제출은 data source INSERT, 편집은 view 설정 변경 → 충돌 없음 |
  | **대용량**: 응답 수만 건 | 폼 뷰에서는 export 불가(테이블 뷰에서 export). 응답 목록은 별도 table 뷰로 본다 |
  | 필수 질문 미입력 제출 | 클라이언트 검증 + **서버 재검증**. `required` 는 스키마 제약이 아니라 뷰 설정이므로 서버가 반드시 다시 확인해야 한다 |
- **데이터 모델 함의**:
  - `view.configuration = { is_form_closed, anonymous_submissions, submission_permissions, header{title, description, icon, cover}, submit{button_text, button_color, confirmation_title, confirmation_body} }`.
  - `form_question(view_id, property_id, position, label, description, required, long_answer, max_selections, visibility_rule jsonb)` — **질문 = 프로퍼티 참조 + 뷰 로컬 메타** 조합이므로 별도 테이블이 정규화에 맞다.
  - `submission_permissions` 는 워크스페이스 ACL 과 별개의 **폼 전용 권한 축**이다. 행 생성 주체가 워크스페이스 사용자가 아닐 수 있으므로 `row_page.created_by` 가 NULL 인 경우를 스키마가 허용해야 한다.
- **UI/인터랙션**: 질문 드래그 재정렬, 질문별 설정 팝오버, 미리보기 토글, 공유 팝오버(링크 복사), 제출 후 확인 화면, `Respondent` 자동 프로퍼티.
- **의존 기능**: property 타입 시스템, 공개 링크 공유, 익명 접근 경로, F-04-01(뷰 컨테이너), (조건부 로직은) 플랜/과금.
- **구현 난이도**: **L** — 폼 렌더 자체는 M 이지만 **익명 쓰기 경로의 권한 설계**(쓰기만 허용, 읽기 차단, relation 옵션 노출 제한)와 서버측 required 재검증이 별도 보안 작업이라 L.
- **우선순위**: **P2** — 뷰 도메인의 다른 기능과 의존이 거의 없어 언제든 뒤에 붙일 수 있다. 다만 외부 수집(설문·신청) 유스케이스에서는 단독 가치가 크다.
- **클론 시 현실적 대안**: MVP 제외. v2 에서 (1) 워크스페이스 멤버 전용 폼만, (2) 조건부 로직·최대 선택 수 제외, (3) 질문 타입은 text/number/select/date/checkbox 5종만 지원.
- **참고 출처**: https://www.notion.com/help/forms , https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/data-sources-and-linked-databases

---

### F-04-19 Map view

- **한 줄 정의**: place 타입 프로퍼티의 위치를 지도 위 핀으로 렌더하고, 핀 클릭으로 해당 행 페이지를 연다.
- **사용자 시나리오**: 뷰 타입 Map 선택 → (place 프로퍼티가 여러 개면) Layout → `Map by` 로 기준 프로퍼티 선택 → 지도 높이 조절 → 핀 클릭 → 행 페이지 peek 오픈 → 필터/정렬로 표시 대상 축소.
- **동작 상세**:
  - configuration: `height`, `map_by`, `properties`. (`map_by` = place 프로퍼티 id)
  - **place 프로퍼티 전용**. 텍스트 주소 프로퍼티는 place 로 타입 변환해야 하며 변환 시 주소 정제가 필요할 수 있다(헬프센터 명시).
  - 주소 검색·지오코딩은 **서드파티 의존**이며 `data quality and coverage may vary by region` 이라고 명시된다.
  - **동시 표시 상한 100개** — 원문: `Up to 100 items can be shown in map view at one time`. 초과분은 필터/추가 뷰로 나누라고 안내한다.
  - 지점 간 거리 계산은 **미지원**.
  - 필터·정렬은 place 의 이름·주소 문자열 기준(텍스트 연산자, 알파벳 정렬)으로 동작한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | place 값이 비었거나 지오코딩 실패 | 핀 미표시. **행이 조용히 사라지므로 `표시 불가 N개` 배지 필요** |
  | 100개 초과 | 노션은 상한까지만 렌더. 클론 권고: 상한 대신 **클러스터링(supercluster)** 이 UX 상 우월 |
  | 같은 좌표에 여러 행 | 핀 겹침 → 클러스터 또는 스파이더파이 |
  | **삭제된 참조**: `map_by` 프로퍼티 삭제 | 다른 place 프로퍼티로 폴백, 없으면 빈 상태 + 프로퍼티 생성 유도 |
  | **권한 없음** | 볼 수 없는 행의 핀은 렌더 금지. 핀 개수만으로 위치 정보가 새는 경로 |
  | **동시편집** | 다른 사용자가 주소를 바꾸면 핀 이동. 지도 뷰포트는 유지(자동 리센터 금지) |
  | **대용량** | 뷰포트 bounding box 를 쿼리 조건으로 사용. 전체 로드 금지 |
  | 좌표계/국제화 | 저장은 WGS84 lat/lng. 주소 문자열과 좌표를 **둘 다** 저장해야 지오코더 교체 시 재작업이 없다 |
- **데이터 모델 함의**:
  - place 프로퍼티 값 스키마 `[추정]`: `{ name, address, lat, lng, provider, provider_place_id }`. **좌표를 캐시하지 않고 렌더마다 지오코딩하면 비용·레이트리밋에서 즉시 실패**한다.
  - `view.configuration = { map_by, height, properties[] }`.
  - 인덱스: `lat`/`lng` 생성 컬럼 + (PostGIS 가능하면) `geography` 컬럼 + GiST 인덱스.
- **UI/인터랙션**: 지도 팬·줌, 핀 클릭 → peek, 핀 hover 툴팁(표시 프로퍼티), 높이 리사이즈 핸들.
- **의존 기능**: place 프로퍼티 타입, 외부 지오코딩/타일 제공자, F-04-09(필터).
- **구현 난이도**: **M** — MapLibre/Leaflet 로 렌더 자체는 빠르다. 다만 **외부 API 키·과금·레이트리밋이라는 비기술적 비용**이 붙는다.
- **우선순위**: **P2** — place 프로퍼티가 선행되어야 하고 대체 불가능한 유스케이스가 좁다.
- **클론 시 현실적 대안**: v2 이후로 미룬다. 구현 시 MapLibre GL + OSM 타일 + Nominatim(요청량 제한 주의) 조합, place 값에 좌표를 **비정규화 저장**.
- **참고 출처**: https://www.notion.com/help/maps , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-20 Dashboard view (위젯 컨테이너 뷰)

- **한 줄 정의**: 행 목록을 그리지 않고 **여러 뷰(위젯)를 격자로 배치**해 한 화면에서 함께 보여주는 상위 뷰다.
- **사용자 시나리오**: DB 뷰 탭 `+` → Dashboard 선택(또는 페이지에서 `/dash`) → Edit 모드 진입 → 위젯 추가(table/board/calendar/chart/timeline) → 위젯마다 데이터 소스·필터·정렬·그룹·시각화 지정 → 위젯 드래그로 이동, 위젯 사이 경계 드래그로 폭·높이 조절 → View 모드로 전환해 소비.
- **동작 상세**:
  - **`data_source_id` 가 null 인 유일한 뷰 타입**이다. 대신 각 위젯 뷰가 `dashboard_view_id` 로 부모 대시보드를 가리킨다(참조 방향 주의).
  - configuration: `rows` (read-only) — 격자 배치.
  - **상한: 행당 위젯 4개, 총 12개**(문서 명시).
  - 위젯은 **서로 다른 데이터베이스에서 올 수 있다** — 대시보드는 사실상 여러 linked view 를 담는 컨테이너이며 F-04-13 의 권한 문제를 그대로 상속한다.
  - View 모드 / Edit 모드 분리로 소비 중 레이아웃이 바뀌지 않게 한다.
  - Notion Agent 로 초안 생성도 가능(문서 명시) — 클론에서는 무시해도 되는 부가 경로.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 위젯이 참조하는 **DB/data source 삭제** | 해당 위젯만 `삭제된 소스` 상태로 렌더. 대시보드 전체가 깨지면 안 됨 |
  | **권한 없음**: 일부 위젯 소스에 접근 불가 | 그 위젯만 잠금 표시. **위젯 제목·행 개수도 숨겨야 한다**(제목만으로도 정보가 샌다) |
  | 위젯 12개가 모두 대용량 DB | 위젯별 **지연 로드(뷰포트 진입 시 쿼리)** + 위젯당 낮은 load limit. 12개 쿼리 동시 발사는 커넥션 고갈 |
  | **동시편집**: 두 사용자가 동시에 레이아웃 편집 | 격자 배치를 배열 하나로 LWW 하면 한쪽 작업이 통째로 사라진다 → **위젯 단위 position(fractional index) + 위젯별 크기 필드**로 쪼개 병합 가능하게 설계 `[추정 — 노션 내부 처리 미확인]` |
  | 위젯 삭제 후 남는 빈 칸 | 자동 리플로우 정책 필요(우측 위젯 당김 vs 빈 칸 유지) |
  | 대시보드 뷰 자체 삭제 | 하위 위젯 뷰 cascade 삭제. 고아 위젯 뷰가 남으면 표시 경로 없는 유령 레코드가 된다 |
  | 위젯 안의 대시보드(중첩) | 금지. 위젯 타입 화이트리스트로 차단 |
- **데이터 모델 함의**:
  - 별도 엔티티를 만들지 말고 **`view` 재귀 구조**로 표현한다: `view.dashboard_view_id` self-FK + `view.data_source_id IS NULL` 이면 대시보드.
  - 격자: `dashboard_layout = [{ height, cells: [{view_id, width_ratio} x ≤4] } x ≤3]`, 총 12개 상한은 서버 검증.
  - 권한: 대시보드 렌더 = **위젯 수만큼의 독립 권한 판정**. 한 번의 쿼리로 끝나지 않는다.
- **UI/인터랙션**: Edit/View 모드 토글, 위젯 드래그, 위젯 경계 리사이즈, 위젯 `···`(Duplicate / Open as full view / Remove), 위젯 헤더 클릭 시 원본 뷰로 이동.
- **의존 기능**: F-04-01, F-04-13(다른 DB 참조 = linked view 와 동일한 권한 경로), 위젯이 되는 각 뷰 타입, F-04-15(위젯별 페이지네이션), F-04-24(위젯별 구독).
- **구현 난이도**: **L** — 격자 편집기 자체는 M 이지만 **N개 위젯 = N개 독립 쿼리 + N개 권한 판정 + N개 실시간 구독**이 되면서 F-04-24 와 곱해진다.
- **우선순위**: **P2** — 다른 뷰 타입이 완성된 뒤에야 의미가 있는 합성 기능.
- **클론 시 현실적 대안**: 전용 뷰 타입을 만들지 말고 **일반 페이지에 linked view 블록을 여러 개 배치**하는 것으로 대체한다(노션도 dashboard 도입 전까지 그 방식이었다). 전용 격자 편집기는 v2 이후.
- **참고 출처**: https://www.notion.com/help/dashboards , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-21 페이지 열림 방식 (Open pages in)

- **한 줄 정의**: 뷰에서 행을 클릭했을 때 side peek / center peek / full page 중 어떤 형태로 열지를 **뷰마다** 저장한다.
- **사용자 시나리오**: DB 상단 `···` → `Layout` → `Open pages in` → Side peek / Center peek / Full page 선택 → 이후 그 뷰에서 행 클릭 시 선택한 방식으로 열림. 다른 뷰는 영향받지 않는다.
- **동작 상세**:
  - **레이아웃별 기본값(헬프센터 명시)**: Table / Board / List / Timeline = **side peek**, Gallery / Calendar = **center peek**.
  - side peek: 우측 패널로 열리고 **좌측 데이터베이스는 계속 인터랙션 가능**하다(목록을 훑으며 편집하는 워크플로의 근거).
  - center peek: 중앙 모달. full page: 라우팅 이동.
  - 열린 페이지에서의 프로퍼티 편집은 뒤의 목록에 **즉시 반영**되어야 한다(필터에 걸리면 목록에서 사라지는 상황 발생 → F-04-24).
  - 공개 Views API configuration 목록에 대응 필드가 보이지 않아 **API 필드명은 `[확인필요]`**.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | peek 에서 값을 고쳐 그 행이 **현재 필터를 벗어남** | 목록에서는 제거하되 **peek 은 열린 채 유지**. 즉시 닫으면 방금 한 편집의 결과를 확인할 수 없다 |
  | peek 열린 상태에서 다른 사용자가 그 행 삭제 | peek 을 `삭제됨` 상태로 전환 + 복원 버튼. 무음 닫기 금지 |
  | full page 로 열고 브라우저 뒤로가기 | 원래 뷰 + 스크롤 위치 + 개인 필터 상태 복원(`?v=<view_id>` 딥링크 + 스크롤 앵커) |
  | 모바일 폭 | side peek 은 물리적으로 불가 → **full page 강제 폴백** |
  | peek 안에서 또 다른 페이지 링크 클릭 | peek 내부 네비게이션 스택 필요(뒤로가기 처리) |
  | **권한 없음** 행에 딥링크로 접근 | 403 안내 vs 존재 자체를 숨기는 404 중 **하나로 고정**할 것(혼용하면 존재 여부가 추론된다) |
  | 대용량 목록에서 peek 열기 | peek 은 단일 행 조회이므로 목록 쿼리와 분리. 목록 재조회 유발 금지 |
- **데이터 모델 함의**: `view.open_pages_in text CHECK (IN ('side_peek','center_peek','full_page'))`. 기본값은 **뷰 타입에 따라 다르게** 생성 시점에 계산해 넣는다(컬럼 DEFAULT 하나로는 위 기본값 표를 표현할 수 없다).
- **UI/인터랙션**: Layout 메뉴 세그먼트 컨트롤, peek 상단 `전체 페이지로 열기` 아이콘, `Esc` 로 닫기, peek 좌우 화살표로 이전/다음 행 이동.
- **의존 기능**: 페이지 렌더러, 라우팅, F-04-01.
- **구현 난이도**: **M** — 렌더 자체는 S 지만 **peek 내부 라우팅 스택 + 목록 상태 유지 + 편집 즉시 반영**이 붙어 M.
- **우선순위**: **P1** — MVP 는 full page 하나로도 성립하나, side peek 이 없으면 "목록을 훑으며 편집"이라는 DB 뷰의 핵심 사용감이 사라진다.
- **클론 시 현실적 대안**: MVP 는 center peek(모달) 하나만 고정 구현하고 설정 UI 를 만들지 않는다. v1 에서 side peek + 뷰별 설정 추가.
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/help/tables

---

### F-04-22 Sub-item(하위 항목) 표시 & 필터 범위

- **한 줄 정의**: 같은 data source 안에서 행이 행을 자식으로 갖는 계층을 만들고, 뷰마다 계층을 어떻게 펼칠지와 필터가 어느 레벨에 적용될지를 정한다.
- **사용자 시나리오**: DB `···` → Sub-items 활성화 → 행 hover 시 `+` 로 하위 항목 추가 → table 에서 부모 행 좌측 토글로 접기/펼치기 → 뷰 설정에서 표시 방식(`Nested in toggle` / `Flattened list`) 선택 → 필터 추가 시 적용 범위(부모만 / 부모+하위 / 하위만) 선택.
- **동작 상세**:
  - **지원 뷰(헬프센터 명시)**: table, list, timeline, board, calendar, gallery **전부**.
  - 표시 방식: table/list/timeline = `Nested in toggle` 또는 `Flattened list`. board/calendar/gallery = `Card property` 또는 `Flattened list`.
  - **필터 범위 3종**: 부모만 / 부모 + 하위 항목 / 하위 항목만. **단 board·calendar·gallery 는 부모만 지원**.
  - sub-item 은 별도 엔티티가 아니라 **자기참조 relation 프로퍼티 쌍**(Parent item / Sub-item)으로 저장된다 `[추정 — 저장 형태를 명시한 1차 문서 미확인]`.
  - 부모 항목을 다른 DB 로 **이동하면 대상 DB 에서 sub-item 기능이 자동 활성화**된다.
  - 부모를 **복제하면 하위 항목도 함께 복제**된다.
  - 부모를 **삭제하면 하위 항목이 함께 삭제**된다 — 헬프센터가 명시적으로 경고하는 파괴적 동작("보존하려면 먼저 옮겨라").
  - 2025-11 릴리스에서 sub-item 대상 필터링이 확장되었다(F-04-09 참조).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 부모는 필터 탈락, 자식은 통과 | 범위 설정에 따라 다름. `부모+하위` 에서는 자식을 보여주려면 **부모를 고아 상태로라도 렌더**해야 한다(트리 유지 vs 결과 정확성의 충돌) — 클론은 부모를 비활성 회색 행으로 표시할 것 |
  | 정렬이 걸린 트리 뷰 | 정렬은 **형제 그룹 내부에서만** 적용해야 트리가 유지된다. 전역 정렬을 그대로 적용하면 자식이 부모 위로 올라간다 |
  | **순환 참조**: A 의 하위에 B, B 의 하위에 A | 저장 거부. **부모 설정 시 조상 체인 검사 필수** — 없으면 렌더가 무한 재귀한다 |
  | 중첩 깊이 | 상한이 문서에 없음 `[확인필요]`. 클론 권고: 깊이 상한(예: 10) + 재귀 CTE 에 `depth` 컬럼 |
  | **삭제된 참조**: 부모 삭제 | 노션은 **자식도 함께 삭제**. 클론이 다르게(고아 승격) 하려면 사용자에게 명시 안내 필요 |
  | **동시편집**: A 는 X 를 B 의 자식으로, B 는 X 를 C 의 자식으로 이동 | parent 는 단일 값이므로 LWW. 단 **결과가 사이클을 만들면 나중 쓰기를 거부** — 사이클 검사는 쓰기 트랜잭션 내부에서 |
  | **권한 없음** 자식 | 자식만 숨기고 부모는 표시. 접기 토글에 숨겨진 개수를 노출하면 정보가 새므로 개수도 제외 |
  | **대용량**: 부모 1,000 × 자식 100 | 펼친 노드만 쿼리(lazy expand). 전체 트리 로드 금지. 가상 스크롤과 펼침 상태를 함께 관리해야 함 |
- **데이터 모델 함의**:
  - `property.type = 'relation'` 이면서 `config.is_self_reference = true` 인 쌍 2개(`parent_item`, `sub_items`). 스키마상 **신규 테이블 불필요**.
  - 조회: 재귀 CTE(`WITH RECURSIVE`)로 서브트리 조회하고 `depth`/`path` 를 함께 계산해 `ORDER BY path` 로 트리 순서를 만든다.
  - 뷰 설정: `view.sub_item_display`, `view.sub_item_filter_scope`(핵심 개념 절 스키마 참조).
  - **삭제 정책**: 휴지통 복원을 지원하려면 FK CASCADE 가 아니라 **애플리케이션 레벨 soft delete + 서브트리 일괄 처리**여야 한다.
- **UI/인터랙션**: 행 좌측 펼침 토글, 행 hover `+`(하위 추가), 드래그 들여쓰기로 부모 변경, 카드에 하위 항목 배지, 필터 팝오버의 적용 범위 셀렉트.
- **의존 기능**: relation 프로퍼티(자기참조), F-04-09(필터 범위), F-04-10(형제 내 정렬), F-04-15(lazy expand + 가상 스크롤), F-04-07(타임라인의 기본 UX).
- **구현 난이도**: **L** — 트리 + 필터 + 정렬 + 가상 스크롤의 4중 상호작용이 본질적 난제다. "부모 탈락, 자식 통과" 정책 하나로 쿼리와 렌더가 모두 바뀐다.
- **우선순위**: **P1** — 태스크 관리 유스케이스에서는 사실상 필수지만 뷰 도메인 MVP 에는 없어도 성립한다.
- **클론 시 현실적 대안**: MVP 는 sub-item 없음(플랫 행만). v1 에서 **table 뷰 한정, 깊이 1단계, 필터 범위 `부모만` 고정**으로 도입하고 정렬은 형제 내 정렬만 허용한다.
- **참고 출처**: https://www.notion.com/help/tasks-and-dependencies , https://www.notion.com/releases/2025-11-17 , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-23 다중 data source 데이터베이스

- **한 줄 정의**: 하나의 database 컨테이너가 서로 다른 스키마를 가진 여러 data source 를 묶고, 각 뷰는 그중 하나를 골라 바인딩된다.
- **사용자 시나리오**: 데이터베이스 메뉴에서 data source 추가 → 새 data source 생성 또는 기존 data source 연결(= 링크) → data source 별로 독립적인 프로퍼티 스키마 구성 → 뷰 생성 시 어떤 data source 를 볼지 선택 → 예: 하나의 CRM database 안에 Contacts / Companies / Deals / Activities 를 함께 둔다(헬프센터가 드는 예시).
- **동작 상세**:
  - 헬프센터 정의: data source 는 `a set of pages in a database` 이며 **한 database 가 여러 data source 를 가질 수 있다**.
  - 기존 data source 를 다른 database 에 연결하면 그것이 **linked data source** 이며, 접근 권한은 원본 database 를 따른다(F-04-13).
  - 원본 data source 의 **제목·프로퍼티·행 변경은 연결된 모든 곳에 전파**되고, **뷰·필터·정렬·그룹은 전파되지 않는다**(원문 확인).
  - data source 수정에는 `Can edit`, 이동에는 `Full access` 권한이 필요하다.
  - **UI 표현이 탭인지 다른 형태인지는 헬프센터에 명시되어 있지 않다** `[확인필요]` — 이 문서 초판이 "탭처럼 묶는다"고 단정한 것은 근거가 없었다.
  - 2025-09-03 API 버전에서 `database` 와 `data_source` 가 분리되었고 이전 버전의 `database_id` 는 실질적으로 data source 를 가리켰다 `[추정 — 업그레이드 가이드 원문 미확인, 확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | data source 를 database 에서 제거 | 그 소스를 보던 뷰도 함께 제거하거나 재바인딩. **뷰가 0개가 되면 F-04-01 의 "최소 1뷰" 제약과 충돌** → 마지막 data source 는 제거 불가로 두는 편이 단순하다 |
  | 서로 다른 data source 를 한 뷰에서 합쳐 보기 | 불가. 뷰는 단일 `data_source_id` 바인딩. 합성이 필요하면 dashboard(F-04-20) |
  | **권한 없음**: 접근 가능/불가 소스가 한 database 안에 혼재 | 접근 불가 소스는 목록에서 숨김. **소스 이름조차 노출 금지** |
  | 원본 data source 삭제 | 연결된 database 들에서 `삭제됨` 상태. 복원 가능해야 함 |
  | **순환**: A 가 B 의 소스를, B 가 A 의 소스를 연결 | data source 실체는 하나이므로 데이터 순환은 없으나 **UI 렌더 재귀**는 발생 가능 → 렌더 깊이 제한 |
  | **동시편집**: 서로 다른 소스에 각각 행 추가 | 완전히 독립. 충돌 없음 |
  | **대용량**: 소스 10개 × 각 25만 행 | 뷰는 한 번에 한 소스만 조회하므로 쿼리 비용은 단일 소스와 동일. 단 소스 목록 UI 는 카운트를 지연 로드할 것 |
  | 마이그레이션 | 기존 1:1 데이터를 다중 소스 모델로 올릴 때 **`view.data_source_id` 를 처음부터 두었다면 백필만으로 끝난다** |
- **데이터 모델 함의**:
  - **핵심은 `property` 와 `row_page` 가 `database_id` 가 아니라 `data_source_id` 를 FK 로 갖는 것**이다. 이 하나만 MVP 에 넣어 두면 F-04-13 과 F-04-23 이 나중에 UI 작업만으로 해결된다.
  - linked data source 표현: `database_data_source(database_id, data_source_id, position, is_linked)` **조인 테이블이 필요하다** — 한 data source 가 여러 database 에 붙을 수 있으므로 `data_source.database_id` 단일 FK 로는 표현되지 않는다(이 문서 초판 의사 스키마의 결함).
  - 삭제 정책: 조인 행 삭제(연결 해제) ≠ data source 삭제. 두 연산을 반드시 분리한다.
- **UI/인터랙션**: data source 전환 컨트롤, data source 추가 메뉴, 뷰 생성 시 소스 선택 단계, 소스별 스키마 편집.
- **의존 기능**: F-04-01, F-04-13, 권한 시스템, property 스키마.
- **구현 난이도**: **M** — 스키마를 처음부터 맞춰 두면 M. `view`/`property`/`row` 가 `database_id` 에 직접 매달린 설계에서 뒤늦게 도입하면 **XL 급 마이그레이션**이 된다. 난이도가 도입 시점에 따라 극단적으로 달라지는 항목.
- **우선순위**: **P2**(기능) / **P0**(데이터 모델) — 기능은 늦춰도 되지만 **FK 방향 결정은 MVP 시점에 반드시 내려야 한다**.
- **클론 시 현실적 대안**: 기능은 1 database = 1 data source 로 고정하고 UI 를 만들지 않는다. 단 테이블은 3계층으로 미리 나누고 조인 테이블도 빈 채로 만들어 둔다.
- **참고 출처**: https://www.notion.com/help/data-sources-and-linked-databases , https://developers.notion.com/guides/data-apis/working-with-views

---

### F-04-24 뷰 결과 실시간 동기화 & 멤버십 재평가

- **한 줄 정의**: 다른 사용자의 편집이 내가 보고 있는 뷰의 **행 목록·순서·그룹·집계에 즉시 반영**되며, 편집으로 인해 행이 필터를 새로 만족하거나 이탈하면 목록에서 추가·제거된다.
- **사용자 시나리오**: A 가 board 에서 카드를 다른 컬럼으로 드래그 → B 의 화면에서 같은 카드가 1초 내로 이동 → C 는 `Status = Done` 필터가 걸린 table 을 보고 있어 그 카드가 **목록에 새로 나타남** → 동시에 컬럼 카운트와 열 하단 집계가 갱신됨.
- **동작 상세**:
  - 노션 공식 엔지니어링 글이 서술하는 흐름: 클라이언트 편집 → operation 을 transaction 으로 묶어 로컬 **RecordCache(IndexedDB/SQLite)** 에 즉시 적용 → `SaveTransactions` API 가 before/after 상태로 권한·정합성 검증 → **MessageStore WebSocket** 이 구독 중인 클라이언트에 알림 → 클라이언트가 `syncRecordValues` 로 변경 레코드를 재조회. 초기 로드는 `loadPageChunk` 로 content 트리를 따라 내려간다.
  - 즉 노션의 실시간은 **CRDT 자동 병합이 아니라 서버 검증 트랜잭션 + 레코드 단위 무효화/재조회** 모델로 서술된다 `[추정 — 글이 이 흐름을 서술하지만 "CRDT 를 쓰지 않는다"고 명시하지는 않는다]`.
  - 뷰 도메인 고유 문제: 레코드 하나가 바뀌면 **그 레코드를 포함/제외하는 뷰들의 결과 집합이 바뀔 수 있다**. 블록 트리 동기화(부모-자식 관계가 고정)와 달리 **멤버십 자체가 쿼리 결과**라는 점이 근본적으로 다르다.
  - 갱신 대상 파생값: 행 존재 여부, 정렬 위치, 그룹 소속, 그룹 카운트, 열 집계, 페이지네이션 커서 유효성.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 편집으로 행이 **필터 밖으로 나감** | 목록에서 제거. 단 **그 편집을 한 당사자에게는 즉시 제거하지 않고 토스트로 안내**(자기 편집으로 화면에서 사라지면 버그로 인식된다) |
  | 편집으로 행이 **필터 안으로 들어옴** | 정렬 위치에 삽입. 뷰포트 위쪽에 삽입되면 **스크롤 앵커 보정** 필요 |
  | 페이지네이션 중 삽입/삭제 | keyset 커서면 안정. 노션은 쿼리 결과를 약 15분 TTL 로 **스냅샷**해 페이지네이션 안정성을 보장한다(F-04-15) — 실시간성과 스냅샷 일관성은 **상충하므로 정책을 명시적으로 선택**해야 한다 |
  | 낙관적 업데이트 실패(권한/검증 거부) | 로컬 롤백 + 원인 안내. board 드래그(F-04-03)는 셀 값 + 순서 2개를 되돌려야 하므로 **롤백 단위 = 서버 API 단위**로 맞출 것 |
  | 오프라인 후 재접속 | 로컬 큐의 미전송 트랜잭션 재전송 → 서버가 before 상태 불일치를 감지하면 거부 → 재조회 후 재적용 또는 폐기 |
  | **권한 변경**이 실시간으로 발생 | 구독 중 클라이언트에서 즉시 데이터 제거 + 재구독 차단. 권한 캐시 TTL 이 길면 회수(revoke)가 그만큼 늦어진다 |
  | 브로드캐스트 폭증(대형 DB 일괄 편집) | 레코드 단위 전량 push 는 팬아웃 폭발 → **뷰 단위 코얼레싱 + 디바운스(100~300ms) + "변경 있음, 재조회하라" 형태의 얇은 알림**이 안전하다 |
  | 개인 필터 사용자(F-04-17) | 같은 뷰라도 사용자마다 결과 집합이 다르므로 **브로드캐스트 단위를 뷰가 아니라 (뷰 × 필터 해시)** 로 잡아야 한다 |
  | **순환**: 갱신 → formula/rollup 재계산 → 다시 갱신 알림 | 파생값은 서버에서 수렴시킨 뒤 **한 번만** 알린다. 클라이언트 재계산 결과를 되돌려 브로드캐스트하면 루프가 생긴다 |
  | 삭제된 행을 보고 있던 클라이언트 | 목록에서 제거 + 열린 peek 은 `삭제됨` 상태(F-04-21) |
- **데이터 모델 함의**:
  - 구독 레지스트리: `subscription(connection_id, view_id, user_id, filter_hash, last_seen_version)`.
  - 전파용 시퀀스: `row_page.version bigint` 또는 워크스페이스 단위 단조 증가 `lsn`. 클라이언트는 마지막으로 본 version 을 들고 재접속해 **델타만** 받는다.
  - 서버 판정: 변경된 행을 각 구독의 filter 로 **before/after 각각 평가** → `enter` / `exit` / `update` / `move` 이벤트로 분류. 이를 위해 필터 평가기를 **SQL 컴파일러와 인메모리 평가기 두 벌**로 가져야 한다 — F-04-09 가 XL 인 실질적 이유다.
  - 집계는 델타로 갱신 가능한 것(count, sum)과 불가능한 것(median, count unique)이 갈린다 → 후자는 재조회.
- **UI/인터랙션**: 원격 변경 행의 짧은 하이라이트, 다른 사용자 편집 중 배지, 연결 끊김 인디케이터, 충돌 시 토스트.
- **의존 기능**: F-04-09(필터 평가기), F-04-10, F-04-11, F-04-15(커서), F-04-16(집계), 인증/권한, WebSocket 인프라.
- **구현 난이도**: **XL** — 이 도메인에서 F-04-09 와 함께 가장 비싼 항목이다. 필터 평가기를 SQL·인메모리 두 경로로 이중 구현해야 하고, **두 경로의 결과가 어긋나면 유령 행이 생긴다**. 팬아웃 제어·권한 회수·오프라인 재적용이 각각 별도 작업.
- **우선순위**: **P1** — 단일 사용자 MVP 에서는 없어도 되지만 협업 도구를 표방하는 순간 P0 로 올라간다. **초기 설계에서 빠뜨리면 아키텍처를 갈아엎게 되는 대표 항목**이라 난이도를 낮게 잡으면 안 된다.
- **클론 시 현실적 대안**: 단계적 도입 — (1) MVP: 폴링(5~10초) 또는 SSE 로 **뷰 전체 재조회 알림만**. 구현 1~2일, 정확성 100%, 효율만 나쁨. (2) v1: WebSocket + 행 델타(update 만), 멤버십 변경은 여전히 전체 재조회. (3) v2: enter/exit 분류 + 집계 델타. **CRDT(Yjs)는 행 본문 리치 텍스트에만 쓰고, 프로퍼티 셀과 뷰 설정은 필드 단위 LWW** 로 두는 조합이 현실적이다.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://developers.notion.com/guides/data-apis/working-with-views , https://www.notion.com/help/optimize-database-load-times-and-performance

---

### F-04-25 뷰·스키마 편집 권한 & 데이터베이스 잠금

- **한 줄 정의**: 누가 뷰·필터·정렬·프로퍼티 같은 **구조**를 바꿀 수 있고 누가 **행 데이터만** 바꿀 수 있는지를, 데이터베이스 전용 권한 등급과 잠금 토글로 분리한다.
- **사용자 시나리오**: 풀페이지 DB 우상단 `···` → `Lock database` 토글 ON → 상단 breadcrumb 제목 옆에 `Locked` 표시 → 이후 **본인 포함 모든 사용자**가 뷰·프로퍼티를 바꿀 수 없고 행 데이터 입력만 가능 → 공유 팝오버에서 동료에게 `Can edit content` 부여 → 그 동료는 행 추가·프로퍼티 값 편집·기존 템플릿 사용은 되지만 원본 DB 의 뷰/필터/정렬/그룹 생성·수정과 select 옵션 추가는 불가 → 단 **다른 페이지에 만든 linked database 위에서는 자기 뷰를 만들 수 있다**.
- **동작 상세**:
  - **Lock database(원문)**: `When you turn this on, people can still enter data, but they can't change views or properties.` 편집 권한이 있는 사람이면 누구나 토글할 수 있으므로 **접근 제어가 아니라 실수 방지 장치**다. 잠금 상태는 breadcrumb 에 `Locked` 로 노출된다.
  - **Can edit content(원문)**: `prevents accidental edits to a database's structure — views, filters, property names, property types & more — while still allowing your colleagues to edit the content inside the database pages.` 이 등급은 **데이터베이스 페이지에서만 존재**한다.
  - 등급별 능력(헬프센터 기준, 뷰 도메인에 한정):
    | 동작 | Full access | Can edit | Can edit content | Can comment / view |
    |---|---|---|---|---|
    | DB 이름·설명·아이콘 변경 | O | O | X | X |
    | 프로퍼티 추가/삭제/타입 변경 | O | O | X | X |
    | select·multi-select 옵션 추가 | O | O | **X** | X |
    | **원본 DB 의 뷰/필터/정렬/그룹 생성·수정** | O | O | **X** | X |
    | **linked DB 에서 자기 뷰 생성** | O | O | **O** | X |
    | 행 생성/삭제, 셀 값 편집, 기존 템플릿 사용 | O | O | O | X |
    | 개인 필터/정렬(F-04-17) | O | O | O | O `[추정]` |
    | data source 수정 / 이동 | 이동은 Full access, 수정은 Can edit (F-04-13) | 수정 O | X | X |
  - `Can edit` vs `Can edit content` 의 경계가 곧 **"뷰 설정 쓰기 권한"의 경계**다. 뷰 설정은 per-view 로 저장되지만 **권한 판정은 database(또는 data source) 단위**로 이루어진다.
  - 헬프센터 원문: `Each database view has its own settings. Settings applied to one database view won't be applied across all other database views automatically.` → 설정 저장 단위(뷰)와 권한 단위(DB)가 **다르다**는 점이 이 기능의 핵심.
  - 잠금과 권한은 **직교**한다: Full access 사용자도 잠긴 DB 에서는 뷰를 바꿀 수 없고, 잠금을 풀 수는 있다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | **빈 값**: ACL 항목이 하나도 없는 DB | 부모 페이지 권한을 상속. 명시 ACL 이 없다고 접근 불가로 떨어뜨리면 인라인 DB 가 전부 잠긴다 |
  | **중첩**: 페이지 ACL + DB ACL + data source ACL 이 모두 존재 | **가장 가까운 명시 ACL 이 이긴다**(상속 중단). 세 레벨을 합산(union)하면 하위에서 권한을 낮출 수 없다 |
  | **중첩**: linked view 를 통한 접근 | 원본 data source ACL 로 **재판정**. 링크를 통해 권한이 상승하지 않는다(F-04-13 원문) |
  | **삭제된 참조**: ACL 대상 사용자·그룹 삭제 | 해당 ACL 행 정리. 남아 있으면 재생성된 동명 그룹에 권한이 되살아난다 |
  | **순환 참조**: 그룹이 그룹을 포함 | 그룹 멤버십 해석 시 방문 집합 + 깊이 상한 필요 |
  | **동시편집**: A 가 잠금 ON, B 가 같은 순간 필터 저장 | 잠금 상태를 **쓰기 트랜잭션 안에서 재확인**해야 한다. 요청 진입 시점 체크만 하면 잠금 직후 요청이 통과한다 |
  | **동시편집**: 권한 회수 중 상대가 뷰를 보고 있음 | 구독을 즉시 끊고 클라이언트 캐시를 비운다. 권한 캐시 TTL 이 길면 회수가 그만큼 늦어진다(F-04-24) |
  | **권한 없음**: 볼 수 없는 뷰의 `?v=` 딥링크 | 403 과 404 중 **하나로 고정**. 혼용하면 뷰 존재 여부가 추론된다(F-04-21 과 같은 원칙) |
  | **권한 없음**: `Can edit content` 사용자가 API 로 직접 PATCH `/views/{id}` | **서버가 반드시 재검증**. UI 비활성만으로는 막히지 않는다 |
  | **대용량**: 사용자 수천 명 × 뷰 수십 개 | 권한을 매 행마다 계산하면 25만 행 쿼리가 죽는다 → **권한을 SQL WHERE 절로 컴파일**(F-04-09 와 같은 컴파일러 경로)하고, 사용자별 유효 권한 집합은 요청 단위로 1회 계산해 캐시 |
  | **대용량**: 권한 해시와 쿼리 캐시 | 캐시 키에 `user_permission_hash` 를 포함(F-04-08). 빼면 사용자 간 캐시 오염 = 데이터 유출 |
- **데이터 모델 함의**:
  - `database.is_locked boolean NOT NULL DEFAULT false` (핵심 개념 절 스키마 참조).
  - `acl(object_type, object_id, subject_type, subject_id, level)` — 페이지/DB/data source 를 **같은 테이블의 object_type 으로** 구분한다. 별도 테이블 3벌로 나누면 상속 계산이 3중 조인이 된다.
  - 판정 함수를 **능력(capability) 단위**로 노출한다: `can_view_rows`, `can_edit_rows`, `can_edit_view_config`, `can_edit_schema`, `can_move_data_source`. 등급 enum 을 코드 곳곳에서 직접 비교하면 `Can edit content` 같은 등급이 나중에 추가될 때 전수 수정이 된다.
  - `can_edit_view_config(user, view) = level(user, view.data_source의 소유 database) >= 'edit' AND NOT database.is_locked` — 잠금은 등급과 **AND** 로 결합되는 별도 항이다.
  - 인덱스: `acl(object_type, object_id)`, `acl(subject_type, subject_id)`.
- **UI/인터랙션**: DB `···` 메뉴의 `Lock database` 토글, breadcrumb 의 `Locked` 배지, 공유 팝오버의 등급 셀렉트, 권한 부족 시 컨트롤 **미노출**(비활성 회색보다 안전), 차단된 조작 시도 시 사유 토스트.
- **의존 기능**: 인증/사용자·그룹 모델, 페이지 ACL, F-04-01(뷰 CRUD), F-04-09/10/12(설정 쓰기 경로), F-04-13(원본 ACL 재판정), F-04-24(권한 회수 브로드캐스트).
- **구현 난이도**: **L** — 등급 테이블 자체는 M 이지만, 권한이 **행 목록·집계·그룹 카운트·실시간 브로드캐스트 네 경로 전부**에 스며들고(F-04-13 과 같은 이유), 여기에 잠금이라는 직교 축과 `Can edit content` 라는 "데이터는 되고 구조는 안 되는" 중간 등급이 더해진다. 권한을 나중에 얹으면 쿼리 컴파일러를 다시 쓰게 된다.
- **우선순위**: **P1** — 단일 사용자 MVP 에는 불필요하지만, **권한 조건을 사용자 필터와 AND 로 합성하는 자리만은 MVP 쿼리 컴파일러에 미리 뚫어 둘 것**(F-04-09). 잠금 토글 자체는 **P2**.
- **클론 시 현실적 대안**: MVP 는 `edit` / `view` 2등급만 두고 `can_*` 능력 함수 5개를 미리 정의해 둔다(내부적으로는 2등급을 매핑). v1 에서 `edit_content` 를 추가하면 능력 함수 구현만 바뀐다. 잠금은 `database.is_locked` 컬럼 하나 + 쓰기 경로 가드 1줄로 v1 에 넣을 수 있다.
- **참고 출처**: https://www.notion.com/help/customize-your-database , https://www.notion.com/help/guides/assign-custom-database-permissions , https://www.notion.com/help/sharing-and-permissions , https://www.notion.com/help/views-filters-and-sorts

---

### F-04-26 뷰 단위 내보내기 (Export current view)

- **한 줄 정의**: 지금 보고 있는 뷰의 **필터·정렬·표시 프로퍼티가 적용된 결과**를 CSV/PDF/HTML/Markdown 파일로 내려받는다.
- **사용자 시나리오**: 앱 우상단 `···` → `Export` → 형식 선택(PDF / HTML / Markdown & CSV) → `Include databases` 에서 **`Current view` 또는 `Default view`** 선택 → (PDF 면) `Page format`(용지 크기) 선택 → 내보내기 실행 → 다운로드 링크 수신.
- **동작 상세**:
  - 원문: `When exporting a database, you can only choose between the current view and the default view.` → 선택지는 **2개뿐**이며 임의 뷰를 지정할 수 없다.
  - 원문: `Exporting all views at once isn't supported.`
  - 원문: `At this time, you can't export a Form view of a database. Try exporting your questions and responses from Table view instead.` → **form 뷰(F-04-18)는 내보내기 대상에서 제외**된다.
  - 원문: `Full page databases will be exports as a CSV file, with Markdown files for each subpage.` → 행 = CSV 한 줄 + 행 본문 = 별도 Markdown 파일이라는 **2계층 산출물**이다.
  - 워크스페이스 전체 내보내기는 비동기 작업이며 `up to 30 hours to process, depending on the size of the workspace` 라고 명시된다 → **동기 응답으로 설계하면 안 되는 기능**.
  - `Current view` 선택 시 적용되는 것: 뷰의 filter / sorts / 표시 프로퍼티. **개인 필터(F-04-17)가 적용되는지는 문서에 없음** `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | **빈 값**: 필터 결과 0행 | 헤더만 있는 CSV 를 생성. 파일 자체를 만들지 않으면 사용자는 실패로 오인한다 |
  | **빈 값**: 셀 값이 비어 있음 | CSV 빈 필드. `null` 문자열을 쓰지 말 것 |
  | **중첩**: sub-item 트리(F-04-22) | CSV 는 평면이므로 **부모 열(Parent item)에 부모 title 또는 id 를 넣어 평탄화**한다. 들여쓰기로 표현하면 재수입이 불가능해진다 |
  | **중첩**: 행 본문에 인라인 DB | Markdown 산출물 안에서 다시 CSV 가 필요해진다. 클론 권고: **중첩 DB 는 링크만 남기고 내보내지 않는다** |
  | **삭제된 참조**: relation 대상 페이지 삭제 | 해당 값 제거. 깨진 id 를 그대로 쓰면 재수입 시 유령 관계가 생긴다 |
  | **삭제된 참조**: 내보내기 진행 중 뷰/DB 삭제 | 잡을 취소하고 사유 안내. 부분 파일을 내려주지 말 것 |
  | **순환 참조**: 자기참조 relation / 순환 링크 | 방문 집합으로 1회만 직렬화 |
  | **동시편집**: 내보내는 중 행이 변경됨 | **스냅샷 시점을 잡아 그 시점 기준으로 직렬화**하고, 파일에 생성 시각을 기록한다. 스트리밍 중 재조회하면 중복/누락이 생긴다(F-04-15 와 같은 문제) |
  | **권한 없음**: 볼 수 없는 행/프로퍼티 | 내보내기는 **권한 우회의 대표 경로**다. 반드시 요청자 권한으로 재조회해 직렬화하고, 다운로드 URL 에도 만료·서명이 필요하다 |
  | **권한 없음**: `Can view` 사용자의 내보내기 | 워크스페이스 정책으로 내보내기 자체를 차단할 수 있어야 한다(엔터프라이즈 요건) `[확인필요 — 노션 설정 위치 미확인]` |
  | **대용량**: 25만 행 | 동기 HTTP 응답 불가 → **비동기 잡 + 커서 스트리밍 + 오브젝트 스토리지 업로드 + 완료 알림**. 메모리에 전체를 올리지 않는다 |
  | **대용량**: 첨부 파일 포함 | 파일 다운로드가 지배적 비용. zip 스트리밍으로 처리하고 총 용량 상한을 둘 것 |
- **데이터 모델 함의**:
  - `export_job(id, requester_user_id, view_id, scope('current_view'|'default_view'), format('csv'|'pdf'|'html'|'markdown'), status('queued'|'running'|'done'|'failed'), snapshot_at timestamptz, result_url text, expires_at, error text)`.
  - 직렬화는 **F-04-15 의 keyset 커서를 그대로 재사용**한다. 별도 조회 경로를 만들면 필터·권한 로직이 두 벌이 되어 어긋난다 — 뷰 도메인에서 가장 흔한 권한 누수 지점.
  - CSV 열 = `view_property.visible = true` 인 프로퍼티를 `position` 순으로. **뷰 설정이 곧 파일 스키마**다.
  - 인덱스: `export_job(requester_user_id, status)`.
- **UI/인터랙션**: `···` → Export 다이얼로그(형식/뷰 범위/용지 크기/하위 페이지 포함 토글), 진행률 표시, 완료 시 다운로드 링크 또는 이메일 알림.
- **의존 기능**: F-04-09/10/12(뷰 설정 = 파일 스키마), F-04-15(커서), F-04-25(권한 재판정), 오브젝트 스토리지, 잡 큐.
- **구현 난이도**: **M** — CSV 직렬화 자체는 S 지만, **비동기 잡 인프라 + 스냅샷 일관성 + 서명 만료 URL + 권한 재판정** 때문에 M. PDF 까지 하면 헤드리스 렌더러가 붙어 L 로 올라간다.
- **우선순위**: **P2** — 뷰 도메인 내부 의존이 없어 언제든 뒤에 붙일 수 있다. 다만 **데이터 이관·백업 요구가 있는 조직에서는 도입 조건**이 되는 경우가 많다.
- **클론 시 현실적 대안**: MVP 는 **CSV 만, 현재 뷰만, 동기 응답, 상한 1만 행**. 상한 초과 시 명시적으로 거부한다. PDF/HTML 과 첨부 zip 은 v2.
- **참고 출처**: https://www.notion.com/help/export-your-content , https://www.notion.com/help/back-up-your-data

---

### F-04-27 데이터베이스 내 검색 (뷰 툴바 검색)

- **한 줄 정의**: 뷰 툴바의 검색 입력에 문자열을 넣으면, 뷰의 필터·정렬은 유지한 채 **제목과 프로퍼티 값에 그 문자열이 있는 행만** 남는다.
- **사용자 시나리오**: DB 상단 🔍 클릭 → 입력창 등장 → 타이핑 → 입력하는 동안 실시간으로 행이 좁혀짐 → `Esc` 또는 X 로 해제하면 원래 결과로 복귀.
- **동작 상세**:
  - 원문: `select 🔍 at the top of the database and enter a query. As you type, the database will only show pages that match your query.` / `Database search looks at database page titles and properties.`
  - **본문 블록은 검색 대상이 아니다** — 제목 + 프로퍼티 값만. 워크스페이스 전역 검색(별개 기능)과 범위가 다르다.
  - 검색은 **임시 상태이며 뷰에 저장되지 않는다** `[추정 — 저장 여부를 명시한 1차 문서 미확인]`. 즉 필터(F-04-09)와 달리 `view` 레코드를 건드리지 않는다.
  - 쿼리 파이프라인 상 위치: `filter ∧ search_term` → sorts → group → page. 즉 **필터와 AND 로 합성되는 추가 조건**이며 필터를 대체하지 않는다.
  - F-04-02 에 적힌 "행이 3개 이상일 때 검색 UI 노출"은 **1차 출처로 재확인되지 않았다** `[확인필요]` → 노출 임계는 클론 자체 판단 사항으로 둔다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | **빈 값**: 검색어 삭제 | 즉시 원래 결과로 복귀. 재조회 없이 이전 결과를 복원할 수 있도록 검색 전 커서를 보관 |
  | **빈 값**: 매칭 0건 | "검색 결과 없음 + 검색어 지우기" 안내. 빈 테이블만 보이면 필터 버그로 오인된다 |
  | **중첩**: sub-item 트리에서 자식만 매칭 | 자식을 보여주려면 부모를 **비활성 회색 행으로라도 렌더**해야 트리가 유지된다(F-04-22 와 동일한 딜레마) |
  | **중첩**: group / board 에서 검색 | 그룹은 유지하고 카드만 좁힌다. **빈 그룹이 되어도 컬럼은 남기는 편이 덜 혼란스럽다**(카드가 어디로 갔는지 보인다) |
  | **삭제된 참조**: relation 프로퍼티의 대상 title 로 검색 | 조인이 필요해 비용이 급증. 클론 권고: **1홉 relation 의 title 은 비정규화 저장**하거나 검색 대상에서 제외 |
  | **순환 참조**: 해당 없음 | 검색은 참조 그래프를 만들지 않는다 |
  | **동시편집**: 검색 중 다른 사용자가 행 값 변경 | 그 행이 검색어를 새로 만족/불만족하게 되면 **멤버십 재평가**가 필요하다 — 검색어도 F-04-24 의 `filter_hash` 에 포함되어야 한다 |
  | **권한 없음**: 볼 수 없는 행 | 권한 조건 AND 가 검색보다 먼저. **검색은 권한 우회 탐침으로 쓰이기 쉬우므로** 매칭 개수도 노출 금지 |
  | **대용량**: 25만 행 부분 일치 | `LIKE '%term%'` 는 인덱스를 못 쓴다 → **trigram(pg_trgm GIN) 또는 전문 검색 인덱스** 필요. 없으면 타이핑마다 전체 스캔 |
  | **대용량**: 타이핑 중 요청 폭주 | 디바운스(200~300ms) + 이전 요청 취소(AbortController) + 최소 길이(2자) |
- **데이터 모델 함의**:
  - **테이블 추가 없음.** 검색어는 요청 파라미터이자 클라이언트 상태이며 `view` 에 저장하지 않는다.
  - 서버 계약: `POST /views/{id}/queries { search?: string }` → 쿼리 컴파일러가 `AND (title ILIKE ... OR <표시 프로퍼티 텍스트화> ILIKE ...)` 절을 추가.
  - 검색 대상 컬럼 정의를 **명시적 화이트리스트**로 둔다(제목 + 텍스트류 프로퍼티). "모든 프로퍼티"로 두면 파일·수식·롤업까지 문자열화하게 되어 비용이 폭발한다.
  - 인덱스: `CREATE INDEX ON row_page USING gin (search_tsv)` 형태의 **머티리얼라이즈된 검색 벡터 컬럼**을 쓰기 시점에 갱신하는 것이 현실적. 프로퍼티가 JSONB 인 설계에서는 이 컬럼이 사실상 필수다.
  - 캐시 키에 검색어 포함 → 검색은 캐시 적중률이 낮으므로 **결과 캐시 대상에서 제외**하는 편이 낫다.
- **UI/인터랙션**: 툴바 🔍 아이콘 → 인라인 입력창, 타이핑 중 디바운스 필터링, `Esc` 로 해제, 매칭 텍스트 하이라이트, 검색 중임을 알리는 툴바 상태 표시.
- **의존 기능**: F-04-09(쿼리 컴파일러 — 검색은 필터의 특수 케이스), F-04-15(커서 재발급), F-04-24(검색어를 포함한 멤버십 재평가), 텍스트 인덱스.
- **구현 난이도**: **M** — UI 는 S 지만 **인덱스 없이는 대용량에서 즉시 무너지는** 기능이라, trigram/tsvector 인덱스와 쓰기 시점 갱신 트리거가 실질 작업량이다. 필터 컴파일러가 이미 있으면 절 하나 추가로 끝난다.
- **우선순위**: **P1** — 수백 행만 넘어가도 없으면 답답하다. 구현 비용 대비 체감 효용이 이 도메인에서 가장 높은 축에 든다.
- **클론 시 현실적 대안**: MVP 는 **title 만 대상**으로 `ILIKE` 부분 일치 + 디바운스. v1 에서 텍스트류 프로퍼티로 확대하고 `pg_trgm` 인덱스를 붙인다. 전문 검색 엔진(Elastic/Meilisearch) 도입은 v2 이후.
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/help/tables , https://www.notion.com/help/search

---

### F-04-28 데이터베이스 템플릿 & 뷰별 기본 템플릿

- **한 줄 정의**: 새 행을 만들 때 프로퍼티 값과 본문 블록이 미리 채워진 템플릿을 적용하고, 어떤 템플릿을 자동 적용할지를 **뷰마다** 다르게 지정한다.
- **사용자 시나리오**: DB 우상단 `New` 옆 드롭다운 화살표 클릭 → `+ New template` → 템플릿 페이지 제목 입력(= 템플릿 이름) + 프로퍼티 값·본문 작성 → 목록으로 복귀 → 템플릿 우측 `···` → `Set as default` → **현재 뷰에만 적용할지 데이터베이스 전체에 적용할지 선택** → 이후 그 뷰에서 `+ New` 를 누르면 템플릿이 자동 적용됨. 반복 템플릿은 `···` → `Repeat` → daily/weekly/monthly/yearly + 간격 + 시작일 지정.
- **동작 상세**:
  - 생성(원문): `click the dropdown arrow next to New at the top right of your database. Then, select + New template.` 템플릿 페이지의 제목이 곧 템플릿 이름이다.
  - 내용(원문): `Templates can contain any type of content, including images, embeds, and sub-pages. Whatever you choose will show up identically on each page created with the template.` → 템플릿은 **프로퍼티 프리필 + 본문 블록 트리** 둘 다를 복제한다.
  - relation 프로퍼티 경고(원문): `do not fill it in unless you want every page you create with that template to relate to the same existing page(s).` → 템플릿의 relation 값은 **모든 파생 행이 같은 대상을 가리키게** 만든다.
  - 반복(원문): `repeat daily, weekly, monthly, or yearly` + 간격·시작일 지정. 반복은 **서버가 스케줄러로 행을 자동 생성**하는 동작이므로 뷰 렌더와 무관하게 돌아간다.
  - 중첩 제약(원문): `You can't nest a template within a template that recurs daily. You can only nest a template that recurs weekly, monthly, or yearly` / `You can only have three levels of nesting per database template.`
  - 개수 제한(원문): `You can make as many as you want`.
  - **`Set as default` 의 범위 선택(현재 뷰 only / 전체 DB)** — 검색 인덱스에서 확인되나 헬프센터 본문 페이지 fetch 로는 해당 문장을 재확인하지 못했다 `[확인필요]`. 다만 **뷰별 기본 템플릿이라는 개념 자체가 "뷰가 저장하는 설정"의 범위를 filter/sort/group 밖으로 넓힌다**는 점에서 이 도메인의 항목이 맞다(F-04-21 과 같은 성격).
  - 링크드 데이터베이스에서의 템플릿 동작은 문서에 없음 `[확인필요]`. `Can edit content` 사용자는 **기존 템플릿 사용은 가능**하다(F-04-25).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | **빈 값**: 템플릿이 하나도 없음 | `+ New` 는 빈 행을 만든다. 드롭다운은 `+ New template` 만 노출 |
  | **빈 값**: 기본 템플릿 미지정 뷰 | DB 전역 기본 템플릿 → 그것도 없으면 빈 행. **3단 폴백(뷰 → DB → 없음)** 을 코드 한 곳에 둘 것 |
  | **중첩**: 템플릿 안의 템플릿 | 최대 3단계(원문). daily 반복 템플릿 안에는 중첩 금지 |
  | **중첩**: 템플릿 본문에 인라인 DB | 복제 시 DB 를 실제로 복제할지 링크드 뷰로 둘지 정책 필요(F-04-14 와 같은 문제) |
  | **삭제된 참조**: 기본 템플릿으로 지정된 템플릿 삭제 | `view.default_template_page_id = NULL` 폴백. 남겨두면 `+ New` 가 매번 실패한다 |
  | **삭제된 참조**: 템플릿이 참조하던 프로퍼티/select 옵션 삭제 | 적용 시 해당 프리필만 스킵. 행 생성 자체를 실패시키지 말 것 |
  | **삭제된 참조**: 템플릿의 relation 대상 페이지 삭제 | 프리필 값에서 제거 |
  | **순환 참조**: 템플릿 A 가 B 를 중첩하고 B 가 A 를 중첩 | 저장 거부. `parent_template_id` 체인에 조상 검사 필수 — 없으면 행 생성이 무한 재귀한다 |
  | **동시편집**: A 가 템플릿 본문 수정 중 B 가 그 템플릿으로 행 생성 | 템플릿은 **적용 시점에 스냅샷 복제**된다. 이미 만들어진 행은 이후 템플릿 변경의 영향을 받지 않는다(원문: `show up identically on each page created with the template` — 생성 시점 복제) |
  | **동시편집**: 두 사용자가 서로 다른 템플릿을 같은 뷰의 기본으로 지정 | 단일 필드 LWW. 마지막 지정이 이긴다 |
  | **권한 없음**: `Can edit content` 사용자 | **기존 템플릿 사용은 가능, 템플릿 생성·수정·기본 지정은 불가**(F-04-25). 이 구분이 이 등급의 설계 의도 그 자체다 |
  | **권한 없음**: 잠긴 DB | 템플릿 목록 조회·사용은 허용, 생성·수정 차단 `[추정 — 잠금이 템플릿을 덮는지 문서 미확인]` |
  | **대용량**: 본문 블록 수천 개짜리 템플릿 | 행 생성이 블록 트리 전체 복제가 된다 → **비동기 복제 + 낙관적 행 생성**(먼저 빈 행을 만들고 본문을 채운다). 동기 복제로 두면 `+ New` 가 수 초 걸린다 |
  | **대용량**: 반복 템플릿 다수 × 워크스페이스 전체 | 스케줄러가 자정에 몰린다 → 생성 시각을 워크스페이스 타임존 기준으로 분산 |
- **데이터 모델 함의**:
  - `database_template(id, data_source_id, name, template_page_id, position, is_database_default, repeat_rule jsonb, parent_template_id)` (핵심 개념 절 스키마 참조).
  - **템플릿 본체는 별도 엔티티가 아니라 특수 상태의 행 페이지**로 두는 것이 노션의 모델과 맞다(템플릿도 프로퍼티와 본문을 가진 페이지다). `row_page.is_template boolean` 을 두고 **모든 뷰 쿼리에서 `is_template = false` 를 기본 조건으로 강제**한다 — 이 조건을 한 군데라도 빠뜨리면 템플릿이 일반 행처럼 목록에 나타난다.
  - 뷰별 기본: `view.default_template_page_id uuid`. DB 전역 기본: `database_template.is_database_default`. **두 축이 별개**이므로 하나의 컬럼으로 합칠 수 없다.
  - 적용 연산 `instantiate(template, target_data_source)`: (1) 프로퍼티 값 얕은 복사(생성 시각·작성자 등 자동 프로퍼티는 제외), (2) 본문 블록 트리 깊은 복사(새 block id 재발급), (3) 내부 링크 재작성. 3번을 빠뜨리면 복제 행들이 전부 원본 템플릿의 하위 페이지를 가리킨다.
  - 반복 스케줄: `repeat_rule` + `template_run(template_id, scheduled_for, created_row_id)` 로 **멱등 키**를 둔다. 없으면 스케줄러 재시도가 행을 중복 생성한다.
  - 인덱스: `database_template(data_source_id, position)`, `row_page(data_source_id, is_template)`.
- **UI/인터랙션**: `New` 버튼의 분할 드롭다운, 템플릿 목록 팝오버, 템플릿별 `···`(Edit / Duplicate / Set as default / Repeat / Delete), 기본 템플릿 배지, 반복 설정 다이얼로그.
- **의존 기능**: 행 페이지 + 블록 트리 복제, property 타입 시스템, F-04-01(뷰 단위 저장), F-04-25(권한 등급), 스케줄러(반복 템플릿).
- **구현 난이도**: **M** — 프로퍼티 프리필은 S, **블록 트리 깊은 복사 + 내부 링크 재작성**이 실제 작업량이다. 반복 템플릿(스케줄러 + 멱등성 + 타임존)을 포함하면 L.
- **우선순위**: **P2** — 뷰 도메인 MVP 에는 불필요. 단 `row_page.is_template` 플래그와 **모든 뷰 쿼리의 기본 조건**은 MVP 시점에 넣어 두는 편이 안전하다(나중에 추가하면 기존 쿼리 전수 점검이 된다).
- **클론 시 현실적 대안**: MVP 는 템플릿 없음. v1 은 **프로퍼티 프리필만 있는 템플릿 + DB 전역 기본 1개**(본문 복제·뷰별 기본·반복 제외). v2 에서 본문 블록 복제와 뷰별 기본 템플릿, v3 에서 반복 템플릿.
- **참고 출처**: https://www.notion.com/help/database-templates , https://www.notion.com/help/guides/using-database-templates , https://www.notion.com/help/guides/assign-custom-database-permissions

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-04-01 | 뷰 컨테이너 & 타입 전환 | M | P0 | data source, property |
| F-04-02 | Table view | L | P0 | F-04-01, F-04-12, F-04-15 |
| F-04-03 | Board view + 드래그 프로퍼티 변경 | L | P0 | F-04-11, 셀 mutation |
| F-04-04 | List view | S | P1 | F-04-01, F-04-12 |
| F-04-05 | Gallery view | M | P1 | files 프로퍼티, 썸네일 |
| F-04-06 | Calendar view + date range | L | P1 | date 프로퍼티, 타임존 |
| F-04-07 | Timeline view + dependency | XL | P2 | F-04-06, relation |
| F-04-08 | Chart view | L | P2 | F-04-09, F-04-11, 서버 집계 |
| F-04-09 | Filter (AND/OR 중첩) | XL | P0 | property 타입 시스템 |
| F-04-10 | Sort (다중 키) | M | P0 | F-04-09 쿼리 컴파일러 |
| F-04-11 | Group by / Sub-group | L | P0 (sub-group만 P2) | property 타입 시스템 |
| F-04-12 | 표시 프로퍼티/폭/순서/고정 | M | P0 | property 스키마 |
| F-04-13 | Linked view | M~L | P1 | F-04-01, 권한 |
| F-04-14 | 인라인 vs 풀페이지 DB | M | P0 (전환은 P2) | 블록 트리 |
| F-04-15 | 페이지네이션 / 가상 스크롤 | L | P0 | F-04-09, F-04-10 |
| F-04-16 | 열/그룹 집계 | M~L | P1 | F-04-09, F-04-11, F-04-24 |
| F-04-17 | 개인 필터 vs 전체 공유 | M | P2 | F-04-09, 인증, F-04-24 |
| F-04-18 | Form view | L | P2 | property 타입, 익명 쓰기 권한 |
| F-04-19 | Map view | M | P2 | place 프로퍼티, 외부 지오코딩 |
| F-04-20 | Dashboard view | L | P2 | F-04-13, 각 뷰 타입, F-04-24 |
| F-04-21 | 페이지 열림 방식(peek) | M | P1 | 페이지 렌더러, 라우팅 |
| F-04-22 | Sub-item 표시/필터 범위 | L | P1 | 자기참조 relation, F-04-09/10/15 |
| F-04-23 | 다중 data source | M (기능) | P2 기능 / **P0 데이터 모델** | F-04-01, F-04-13, 권한 |
| F-04-24 | 실시간 동기화 & 멤버십 재평가 | **XL** | P1 (협업 지원 시 P0) | F-04-09~11, F-04-15/16, WebSocket |
| F-04-25 | 뷰·스키마 편집 권한 & DB 잠금 | L | P1 (잠금만 P2) | ACL, F-04-09/13/24 |
| F-04-26 | 뷰 단위 내보내기 | M (PDF 포함 시 L) | P2 | F-04-12/15/25, 잡 큐 |
| F-04-27 | 데이터베이스 내 검색 | M | P1 | F-04-09 컴파일러, 텍스트 인덱스 |
| F-04-28 | 템플릿 & 뷰별 기본 템플릿 | M (반복 포함 시 L) | P2 | 블록 트리 복제, F-04-25 |

> 난이도 재검토 메모 (1차): 초판의 F-04-16(M) / F-04-17(S) 는 각각 **그룹별 집계의 응답 결합·실시간 재계산**, **쿼리 캐시 키와 브로드캐스트 단위 분화**를 빠뜨린 과소평가였다. F-04-13 은 권한을 행·집계·그룹카운트·브로드캐스트 **네 경로에서 재판정**해야 한다는 점에서 M~L 로 조정했다. 이 도메인의 진짜 상한선은 F-04-09(필터)와 F-04-24(실시간) 두 XL 항목이며, 둘은 **필터 평가기를 SQL·인메모리 두 벌로 요구한다는 점에서 사실상 한 덩어리**다.
>
> 난이도 재검토 메모 (2차): 신규 F-04-25(권한)를 **M 이 아니라 L** 로 잡았다. 근거는 (a) 권한 조건이 F-04-09 의 쿼리 컴파일러 안으로 들어가야 하고(사용자 필터와 반드시 AND 로 합성 — OR 그룹 안에 섞이면 권한이 무력화된다), (b) 행·집계·그룹 카운트·브로드캐스트 네 경로에서 각각 재판정해야 하며, (c) `Can edit content` 라는 "데이터는 되고 구조는 안 되는" 중간 등급과 `Lock database` 라는 직교 축이 동시에 존재하기 때문이다. 권한을 나중에 얹으면 쿼리 컴파일러를 다시 쓰게 되므로 **F-04-09 와 같은 시기에 설계해야 하는 항목**이다.
>
> 반대로 **F-04-27(검색)은 P1 로 올렸다** — 구현 비용은 M 인데(필터 컴파일러가 있으면 절 하나 추가) 수백 행만 넘어가도 없으면 못 쓰는 기능이라, 이 도메인에서 비용 대비 체감 효용이 가장 높다. 단 인덱스 없이 `LIKE '%x%'` 로 내보내면 대용량에서 즉시 무너지므로 **난이도의 실체는 UI 가 아니라 텍스트 인덱스와 쓰기 시점 갱신**이다.
>
> 이 문서에서 **과대평가 방향의 조정은 없었다.** 초판 대비 등급이 내려간 항목이 하나도 없다는 것 자체가, 뷰 도메인에서는 "렌더가 쉬워 보이는 기능일수록 권한·실시간·페이지네이션과 곱해지면서 비싸진다"는 패턴을 보여준다.

### 의존 순서 (구현 순서 권고)

```
property 타입 시스템
   └─> F-04-09 filter ──┐
   └─> F-04-10 sort ────┼─> 쿼리 엔진 ─> F-04-15 페이지네이션
   └─> F-04-11 group ───┘                     │
                                              ├─> F-04-02 table ─> F-04-16 집계
F-04-12 표시 프로퍼티 ────────────────────────┤
F-04-01 뷰 컨테이너 ──────────────────────────┼─> F-04-03 board
                                              ├─> F-04-04 list / F-04-05 gallery
                                              ├─> F-04-06 calendar ─> F-04-07 timeline
                                              └─> F-04-08 chart
F-04-14 인라인/풀페이지 ─> F-04-13 linked view ─> F-04-17 개인 필터
                                    │
                                    └─> F-04-20 dashboard (위젯 = linked view 묶음)

데이터 모델 선결(코드보다 먼저):
  F-04-23 data_source FK 방향 ──> F-04-13 / F-04-20 이 전부 여기에 의존

부가 축(다른 축과 독립적으로 붙일 수 있음):
  property 타입 시스템 ─> F-04-18 form (익명 쓰기 권한 경로 필요)
                       ─> F-04-19 map (place 프로퍼티 + 외부 지오코더)
  자기참조 relation ───> F-04-22 sub-item ─> (F-04-07 timeline 의 기본 UX)
  페이지 렌더러/라우팅 ─> F-04-21 peek

가로지르는 축(모든 뷰에 걸침):
  F-04-24 실시간 동기화 ── F-04-02/03/06/15/16/20 전부와 결합
                        └─ F-04-09 필터 평가기를 인메모리 버전으로도 요구
  F-04-25 권한·잠금 ───── F-04-09 쿼리 컴파일러 안으로 들어감(권한 절 AND 합성)
                        ├─ F-04-13/20/23 원본 ACL 재판정
                        ├─ F-04-16 집계 / F-04-11 그룹 카운트 (개수 누수 차단)
                        └─ F-04-24 권한 회수 시 즉시 구독 해제

쿼리 컴파일러에 얹히는 조건들(전부 같은 WHERE 로 합성됨 — 코드 한 곳에 모을 것):
  view.filter  ∧  user_override.filter(F-04-17)  ∧  search_term(F-04-27)  ∧  permission(F-04-25)
  ∧ is_template = false (F-04-28)  ∧ in_trash = false

뷰 설정에 매달리는 부가 산출물(뷰가 "화면"만 정하지 않는다는 증거):
  F-04-12 표시 프로퍼티 ─> F-04-26 내보내기 CSV 열 스키마
  F-04-01 뷰 ──────────> F-04-28 뷰별 기본 템플릿
                       └> F-04-21 페이지 열림 방식
```

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인에서 참고할 점 | 차용 가능한 접근 |
|---|---|---|
| **AppFlowy** (Rust + Flutter) | 뷰 로직을 `FilterController` / `SortController` / `GroupController` / `CalculationsController` 4개의 독립 컨트롤러로 분리. 각 컨트롤러는 `TaskDispatcher`로 비동기 태스크를 큐잉하고, 변경 시 전체 재조회가 아니라 **델타 알림**(`GroupRowsNotificationPB` 등)을 프론트로 보낸다. | **컨트롤러 분리 구조를 그대로 차용할 가치가 높다.** 필터/정렬/그룹을 하나의 God object에 넣지 말고 각각 "입력: 행 스트림 + 설정, 출력: 델타" 인터페이스로 설계. |
| AppFlowy (board 드래그) | `onMoveGroupItemToGroup` → `moveGroupRow(source, target)` → 백엔드 `GroupCustomize`가 **필요한 셀 업데이트를 계산**해서 적용 → `UpdatedCells` + `GroupData` 동시 갱신. | F-04-03의 "드롭 = 셀 변경 + 순서 변경"을 **서버 단일 API 하나**로 만드는 설계 근거. 클라이언트가 두 번 호출하면 부분 실패가 생긴다. |
| AppFlowy (정렬/집계) | `rayon::par_sort_by`로 정렬, 집계도 병렬 처리. 필터는 `cmp_row`를 순차 적용. | 클라이언트 사이드 정렬을 하는 로컬 우선 아키텍처를 택할 경우의 성능 참고. 서버 SQL 기반이라면 불필요. |
| **Teable** (TypeScript + Postgres) | 모든 테이블이 **실제 Postgres 테이블**이라 filter/sort/group이 DB 엔진에서 실행된다. 100만 행에서 복잡 필터가 약 200ms(자체 주장). 뷰는 "비파괴적 오버레이"로 각자의 필터/숨김 필드를 가진다. | JSONB 단일 컬럼 방식 대신 **프로퍼티를 실제 컬럼으로 승격**하는 대안. 스키마 마이그레이션 비용과 트레이드오프. 벤치마크 수치는 벤더 주장이므로 `[확인필요]`. |
| **NocoDB** | 무한 스크롤(0.258.0), 그리드에서 display value 포함 **최대 3개 필드 고정(pin)**, 드래그로 고정 개수 조절. | F-04-02의 `frozen_column_index` UX 참고. 고정 열 수에 상한을 두는 편이 구현·성능 모두 유리하다. |
| **AFFiNE / BlockSuite** | 블록 기반 문서 안에 데이터베이스 블록을 넣는 구조. `[확인필요 — 뷰 설정 저장 구조와 필터 표현식 구현은 이번 조사에서 1차 출처로 확인하지 못함]` | 블록 트리에 DB를 임베드하는 F-04-14 인라인 DB 설계 참고 후보. |

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 |
|---|---|---|
| 1 | **필터 중첩 깊이**: API 문서 "2단계" vs 헬프센터 "3단계" 불일치 | 서버 검증 상수를 정해야 함 |
| 2 | ~~board 에서 relation 그룹 지원 여부~~ → **부분 해소**: 헬프센터 FAQ 원문이 `Relation and formula properties cannot currently be used for grouping` 으로 명시. 같은 문서 본문의 "relation 으로 그룹" 서술은 **노션 문서 내부 모순**으로 판단하고 클론은 미지원 고정 | 그룹 타입 매트릭스 확정(해소) |
| 3 | **multi_select 그룹에서 카드 드래그 시 semantics** (값 치환 vs 추가) | 데이터 손실 위험이 있는 동작 |
| 4 | **정렬 시 빈 값(null)의 위치** 규칙 | 페이지네이션·UX 일관성 |
| 5 | calendar에서 **date 없는 행의 처리** 및 안내 UI 유무 | 사용자 혼란 방지 |
| 6 | timeline **순환 dependency 처리** 및 fan-out 시프트 규칙 | 무한 루프/데이터 파손 방지 |
| 7 | dependency relation 프로퍼티의 **자동 생성 이름**(Blocking / Blocked by 여부) | 스키마 자동 생성 로직 |
| 8 | 새 프로퍼티 추가 시 **기존 뷰에서 기본 표시/숨김** 중 무엇인지 | 마이그레이션 기본값 |
| 9 | **개인 필터와 공유 필터의 결합 규칙**(AND vs override) | 잘못 정하면 데이터가 안 보이는 버그 |
| 10 | 숨긴 그룹의 행이 **집계에 포함되는지** | 숫자 신뢰성 |
| 11 | chart에서 **X축 빈 값 버킷** 처리 | 집계 정확도 |
| 12 | gallery `page_content` 커버의 **이미지 선택 규칙** | 썸네일 파이프라인 설계 |
| 13 | AFFiNE/BlockSuite의 데이터베이스 뷰 내부 구조 (1차 출처 미확보) | 인라인 DB 설계 참고 |
| 14 | Teable의 "100만 행 200ms" 수치의 측정 조건 | 아키텍처 선택 근거로 쓰기 전 검증 필요 |
| 15 | **Views API configuration 목록에 `load limit` 과 `open pages in` 필드가 없다** — UI 전용 설정인지, 미노출 필드인지 | 뷰 설정을 API 로 왕복시킬 수 있는지가 갈림 |
| 16 | dashboard 의 격자 배치 저장 구조(`rows` 가 read-only 로만 노출됨) | 레이아웃 편집을 API 로 지원할지, 동시편집 병합 단위를 무엇으로 할지 |
| 17 | form 의 **질문 구성·조건부 로직**이 API 에 어떤 형태로도 노출되지 않음 | 폼 정의를 코드로 관리 가능한지 |
| 18 | sub-item **중첩 깊이 상한**이 문서에 없음 | 재귀 CTE 깊이 제한값 결정 |
| 19 | 다중 data source 의 **UI 표현**(탭인지 아닌지) | 정보구조·네비게이션 설계 |
| 20 | 2025-09-03 이전 `database_id` → 신규 `data_source_id` **마이그레이션 매핑 규칙** | 기존 API 클라이언트 호환 |
| 21 | 노션 실시간이 CRDT 병합인지 **트랜잭션 검증 + 레코드 재조회**인지 (엔지니어링 글은 후자를 서술하나 전자를 배제한다고 명시하지 않음) | F-04-24 아키텍처 선택의 근거 |
| 22 | 개인 필터와 공유 필터의 **결합 규칙**(replace vs AND) — 노션 실제 동작 미확인 | 잘못 고르면 "필터를 걸었는데 결과가 더 줄어드는" 버그 |
| 23 | 템플릿 `Set as default` 의 **범위 선택(현재 뷰 / 전체 DB)** — 검색 인덱스에는 나오나 헬프센터 본문 fetch 로 재확인 실패 | 뷰별 기본 템플릿 컬럼(`view.default_template_page_id`)을 둘지 DB 전역 하나로 갈지 갈림 |
| 24 | **뷰 개수 상한**이 공개 문서에 없음 | 뷰마다 실시간 구독이 붙으므로 소프트 상한을 정해야 함(F-04-24) |
| 25 | 내보내기 `Current view` 가 **개인 필터(F-04-17)를 반영하는지** | 같은 뷰를 두 사람이 내보냈을 때 결과가 달라지는지가 갈림 |
| 26 | DB 검색 UI 의 **노출 임계**("행 3개 이상") — 이번 조사에서 1차 출처로 재확인 실패 | F-04-02 초판 서술의 근거 부재. 클론 자체 판단으로 전환함 |
| 27 | DB 검색어가 **뷰에 저장되는지**(임시 상태인지) | 저장된다면 `view` 스키마와 동시편집 병합 대상이 하나 늘어난다 |
| 28 | `Lock database` 가 **템플릿 생성·수정까지 덮는지** | 잠금의 범위 정의 |
| 29 | 인라인 → 풀페이지 전환 시 **상속 권한이 자체 ACL 로 어떻게 승격되는지** | 전환만으로 접근권이 조용히 넓어질 수 있는 지점 |
| 30 | 링크드 데이터베이스에서 **템플릿이 어떻게 동작하는지**(원본 템플릿을 쓰는지) | F-04-13 과 F-04-28 의 교차점 |
| 31 | 정렬 시 **빈 값(null)의 위치** — 2차 조사에서도 1차 출처 확인 실패(항목 4와 동일 건, 재시도 후에도 미해결) | 페이지네이션·UX 일관성 |
| 32 | 새 프로퍼티 추가 시 **기존 뷰에서 기본 표시/숨김** — 2차 조사에서도 확인 실패(항목 8과 동일 건) | 마이그레이션 기본값 |

> 미해결 항목 중 **4·8 은 2차 GAP 에서 재조사했으나 여전히 1차 출처를 찾지 못했다**(31·32 로 재기록). 헬프센터·API 레퍼런스 어디에도 서술이 없으며, 관찰 기반 추정을 사실로 승격하지 않기 위해 `[확인필요]` 를 유지한다. 클론에서는 각각 **"오름차순에서 빈 값 뒤로(NULLS LAST)"**, **"새 프로퍼티는 기존 뷰에서 숨김"** 을 자체 규약으로 고정하고 문서화할 것을 권한다 — 둘 다 나중에 바꾸면 기존 뷰의 표시 결과가 통째로 달라지는 결정이다.

---

## 출처

| # | URL | 사용한 내용 |
|---|---|---|
| 1 | https://www.notion.com/help/views-filters-and-sorts | 뷰 타입 목록, 뷰별 설정 메뉴, simple/advanced 필터, 필터 그룹 3단계, 다중 정렬, 그룹/서브그룹, 빈 그룹 숨김, 열 고정, Save for everyone, 페이지 열림 방식 |
| 2 | https://developers.notion.com/guides/data-apis/working-with-views | view 객체 전체 스키마, 타입별 configuration 필드, GroupSpec, 프로퍼티 표시 설정 필드, 뷰 CRUD/쿼리 엔드포인트, 커서 캐시 15분, 최소 1개 뷰 제약 |
| 3 | https://developers.notion.com/reference/filter-data-source-entries | 프로퍼티 타입별 필터 연산자 전체 목록, compound and/or, 중첩 2단계, 상대 날짜 값, timestamp 필터 |
| 4 | https://www.notion.com/help/boards | board 기본 그룹 규칙, 카드 드래그/컬럼 재정렬, 그룹 숨김, 카드 크기/미리보기 소스, 컬럼 헤더 집계, 서브그룹 |
| 5 | https://www.notion.com/help/timelines | 날짜 range 요구, 시간 단위 Hours~Years, 사이드 테이블 패널, 막대 드래그/리사이즈, 로드 한도 |
| 6 | https://www.notion.com/help/tasks-and-dependencies | dependency 화살표 생성 방식, 날짜 시프트 3옵션 정확한 이름, Avoid weekends, sub-item 표시 방식 |
| 7 | https://www.notion.com/help/calendars | 날짜 프로퍼티 전환, 카드 좌우 엣지 스트레치, 월/주 뷰, 드래그 이동, 주 시작 요일 설정 |
| 8 | https://www.notion.com/help/charts | 차트 5종, X/Y축 설정, 누적 표시 조건, 200 groups / 50 subgroups 상한, 축 미지원 프로퍼티 |
| 9 | https://www.notion.com/help/tables | 열 리사이즈/재정렬, wrap, 행 드래그, 집계 함수 목록, title 삭제 불가 |
| 10 | https://www.notion.com/help/data-sources-and-linked-databases | database/data source/view 3계층, 링크드 뷰의 뷰 독립성·스키마 전파·권한 상속, form 제약 |
| 11 | https://www.notion.com/help/guides/full-page-vs-inline-databases | 인라인/풀페이지 차이, 상호 전환 절차 |
| 12 | https://www.notion.com/help/optimize-database-load-times-and-performance | 250,000행 / 500 프로퍼티 / 2.5MB / 1.5MB / 10,000 relation 상한, 성능 저하 요인, 링크드 뷰 권고 |
| 13 | https://x.com/NotionHQ/status/1331678200234065920 | 인라인 DB load limit 10/25/50/100 도입 |
| 14 | https://deepwiki.com/AppFlowy-IO/AppFlowy/7.2-database-views-(filters-sorts-groups) | AppFlowy의 FilterController/SortController/GroupController 구조, move_group_row 흐름, 델타 알림, 병렬 정렬·집계 |
| 15 | https://docs.nocodb.com/views/view-types/grid | NocoDB 그리드 뷰 / 필드 고정 |
| 16 | https://github.com/nocodb/nocodb/releases/tag/0.258.0 | 무한 스크롤 도입 |
| 17 | https://developers.notion.com/page/changelog | quick_filters가 뷰 필터와 동일 스키마 사용 |
| 18 | https://www.notion.com/releases/2025-11-17 | sub-item 필터링 추가 |
| 19 | https://www.notion.com/help/intro-to-databases | 데이터베이스 기본 개념, 다중 뷰 |
| 20 | https://www.notion.com/help/guides/using-linked-databases | `/linked` 삽입 절차, 기존 뷰 복사 vs 새 뷰 |
| 21 | https://www.notion.com/help/forms | form 생성 경로, 질문 설정(required/long answer/최대 선택), 공개 범위 3단, 익명 제출·Respondent 프로퍼티, 조건부 로직 플랜 제한, 링크드 DB 불가, 모바일 제약 |
| 22 | https://www.notion.com/help/maps | map view 의 place 프로퍼티 요구, `Map by`, 지오코딩 품질 경고, **동시 표시 100개 상한**, 거리 계산 미지원 |
| 23 | https://www.notion.com/help/dashboards | dashboard 생성 경로(`/dash`), 위젯 타입, 다중 DB 위젯, **행당 4개·총 12개 상한**, View/Edit 모드 |
| 24 | https://www.notion.com/blog/data-model-behind-notion | 블록 데이터 모델(id/type/properties/content/parent), RecordCache → SaveTransactions → MessageStore WebSocket → syncRecordValues 동기화 흐름, loadPageChunk 초기 로드 |
| 25 | https://www.notion.com/help/customize-your-database | `Lock database` 원문(`people can still enter data, but they can't change views or properties`), 데이터베이스 설정이 뷰가 아닌 DB 전체에 적용된다는 명시, sub-items·dependencies·automations·custom page layout 토글 위치 |
| 26 | https://www.notion.com/help/guides/assign-custom-database-permissions | database 전용 등급 `Can edit content` 의 정확한 허용/금지 범위(구조 편집 불가, select 옵션 추가 불가, **linked DB 에서는 자기 뷰 생성 가능**), Full access 와의 차이 |
| 27 | https://www.notion.com/help/export-your-content | 내보내기 형식(PDF/HTML/Markdown&CSV), `Include databases` 의 current view vs default view 2택, 전체 뷰 동시 내보내기 미지원, form 뷰 내보내기 불가, 풀페이지 DB = CSV + 하위 Markdown, 대형 워크스페이스 최대 30시간 |
| 28 | https://www.notion.com/help/database-templates | 템플릿 생성 경로, 템플릿이 담는 내용(이미지/임베드/하위 페이지), relation 프리필 경고, 반복 주기(daily/weekly/monthly/yearly), **중첩 3단계 상한**, daily 반복 템플릿 중첩 불가, 개수 무제한 |
| 29 | https://www.notion.com/help/search | DB 툴바 검색 동작(입력 즉시 좁혀짐), **검색 대상 = 페이지 제목 + 프로퍼티**(본문 블록 제외) |
| 30 | https://www.notion.com/help/guides/using-advanced-database-filters | advanced filter 에서 AND/OR 를 filter group 으로 조합한다는 서술(단, 중첩 깊이·연결자 적용 범위는 이 문서에 명시 없음 — 헬프센터 본문의 `three layers deep` 쪽이 근거) |
