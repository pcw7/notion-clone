# 16. 데이터베이스 항목 페이지 레이아웃 빌더

> 조사일: 2026-09-06 / 기준 API 버전: Notion API `2025-09-03` (database ↔ data_source 분리 버전)
> 태그 규칙: `[추정]` = 공개 문서 없이 관찰·추론한 내용 / `[확인필요]` = 검증 필요
>
> **작성 배경**
> 커버리지 비평 A-3 / U-1 대응 문서다. 13개 기존 문서에서 이 도메인은 03-database-core.md F-03-02·F-03-16 의 `[정정]` 각주와 한도표 1행으로만 존재했고, F-03-16 이 선언한 `page_layout_slot.tab_id` 가 **어디에도 정의되지 않은 `layout_tab` 테이블을 가리키는 dangling FK** 상태였다. 이 문서가 그 테이블의 정본 정의를 소유한다.
>
> **스코프 선언 — 이 문서가 소유하는 것 / 소유하지 않는 것**
>
> | 주제 | 소유 F-ID | 비고 |
> |---|---|---|
> | 항목 페이지 레이아웃 정의·편집·적용 | **이 문서 (F-16-01~12)** | 정본 |
> | `layout_tab` / `layout_module` 스키마 | **이 문서 (F-16-12)** | 03 F-03-16 의 `page_layout_slot` 을 대체 |
> | 프로퍼티 타입별 편집기·셀 UX | F-03-16 | 재서술하지 않음 |
> | 프로퍼티 스키마·타입 시스템 | F-03-02 | 재서술하지 않음 |
> | 뷰 컨테이너·필터·정렬·그룹 | F-04-01 / F-04-09~11 | 탭이 이것을 **재사용**한다 |
> | linked view | F-04-13 | 탭은 "지속되는 linked view" 다 |
> | 페이지 열림 방식(peek) 자체 | F-04-21 (뷰 저장) / F-02-20 (라우팅) | 이 문서는 **레이아웃과의 교차점만** 다룸 |
> | 백링크 기능 자체 | F-02-14 | 이 문서는 **표시 모드 3종만** 다룸 |
> | 페이지 설정(full width 등) 일반 페이지판 | F-02-07 | 이 문서는 **DB 행에서의 승격**만 다룸 |
> | relation / sub-item | F-03-10 / F-03-18 / F-04-22 | 탭의 필터 근거로만 참조 |
> | 권한 등급 체계 | F-06-01 / F-04-25 | 이 문서는 **레이아웃 편집에 필요한 등급**만 지정 |

---

## 요약

- Notion 의 데이터베이스 **행 페이지(row page)는 자유 문서가 아니라 "레이아웃 템플릿이 렌더하는 폼"** 이다. 행을 열었을 때 보이는 화면 — 제목 아래 고정 프로퍼티 줄, 본문 영역, 우측 상세 패널, 탭 바 — 은 행마다 다르지 않고 **데이터베이스에 하나 저장된 레이아웃 정의**가 모든 행에 동일하게 적용된 결과다. 헬프센터 원문: `A page layout will apply to all pages in the database. Layouts can't be applied only to specific pages or specific views.` (https://www.notion.com/help/layouts)
- 이 한 문장이 이 도메인의 핵심 불변식이다. **레이아웃은 행 단위도 뷰 단위도 아니다.** 반면 같은 화면에 영향을 주는 `Open pages in`(side/center/full peek)은 **뷰 단위**다(F-04-21). 즉 "행 페이지가 어떻게 보이는가"는 **서로 다른 스코프를 가진 두 축의 곱**이며, 이것을 한 테이블에 합치면 클론이 즉시 어긋난다.
- 편집 진입점: 데이터베이스를 **풀페이지로 연 뒤** `•••` → `Customize layout`, 또는 행 페이지에서 제목 위 호버 → `Customize layout`. 편집 결과는 우상단 **`Apply to all pages`** 로 확정된다. 요구 권한은 `at least Can edit access to the database`(원문). 모바일은 **보기만 가능하고 빌더는 데스크톱·웹 전용**(원문: `you'll only get the full layout builder experience on desktop or web`).
- 레이아웃은 **모듈(module)의 트리**다. 고정된 3개 슬롯이 아니라, `Heading` / `Property group` / 개별 프로퍼티 모듈 / `Backlinks` 를 **본문 영역(main page area)과 상세 패널(details panel) 사이에서 이동**시키는 구조다. 모듈 `•••` 메뉴는 `Move up` / `Move down` / `Move to panel` / `Move to page` 를 제공한다.
- 제약이 명확히 존재한다: **Heading 은 이동·제거 불가**, **Property group 은 제거 불가(레이아웃당 1개)**, **relation 등 일부 타입은 상세 패널로 이동 불가**, **pinned 프로퍼티는 최대 15개**.
- 구조(structure)는 **Simple / Tabbed** 2택이다. Tabbed 는 `Content` 탭(본문 + 모듈) **정확히 1개** + 추가 탭 N개로 구성되며, **추가 탭은 관련 데이터베이스의 뷰**다. 탭 추가 시 `Page containing this view` 성격의 필터가 자동으로 걸려 **현재 행과 관련된 항목만** 표시된다 `[확인필요: 필터 라벨 원문은 2차 출처 기반]`.
- 클론 관점의 결정적 함의: **탭은 새 렌더러가 아니라 `view` 엔티티의 재사용**이다. 다만 그 뷰는 "데이터베이스 화면에 붙은 뷰"가 아니라 "레이아웃 탭에 붙은 뷰"이므로, `view` 엔티티에 **소유 축(owner_kind)** 이 없으면 표현할 수 없다. 그리고 그 뷰의 필터 AST 는 **행 페이지마다 값이 달라지는 평가 컨텍스트(`current_page`)** 를 포함하므로, F-03-17 이 도입한 `me`/상대날짜 컨텍스트 노드와 같은 축에 `current_page` 노드를 추가해야 한다. 결과 캐시 키가 `(view_id, actor_id, 평가일)` 에서 `(view_id, actor_id, 평가일, current_page_id)` 로 한 차원 늘어난다.

출처: https://www.notion.com/help/layouts , https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/releases/2025-07-10 , https://www.notion.vip/insights/notion-tabbed-page-layouts , https://notionmastery.com/tabbed-layout-adds-application-style-ui-to-notion/

---

## 핵심 개념 / 데이터 모델

### 스코프 3층 — 이 도메인의 유일한 난제

행 페이지 화면을 만드는 설정은 **저장 위치가 다른 3층**에서 온다. 이 셋을 한 곳에 저장하면 반드시 틀어진다.

| 층 | 저장 단위 | 예 | 근거 |
|---|---|---|---|
| L1 **레이아웃** | **data_source(=DB) 1개당 1벌** | 모듈 배치, pinned 15개, 섹션, Simple/Tabbed, 탭 목록, backlinks 표시, page settings | `A page layout will apply to all pages in the database` (help/layouts) |
| L2 **뷰 설정** | **view 1개당 1벌** | `Open pages in`(side/center/full), 표시 프로퍼티·컬럼 폭·wrap·freeze | `Each database view has its own settings.` (help/views-filters-and-sorts, F-04-21 / F-04-12) |
| L3 **뷰어 로컬 상태** | **사용자·디바이스** | 상세 패널 펼침/접힘, 현재 선택된 탭, peek 폭 | 서버 영속 여부 문서 없음 `[추정]` |

> **불변식 L1**: 레이아웃 레코드는 행(page)을 참조하지 않는다. 행 테이블에 레이아웃 관련 컬럼이 생기면 그 순간 "행별 커스터마이즈"가 가능해지고, 이는 원본 동작과 어긋난다.
>
> **불변식 L2**: `Open pages in` 은 레이아웃 레코드에 넣지 않는다. 같은 DB 의 Table 뷰는 side peek, Gallery 뷰는 center peek 가 기본값인데(F-04-21), 이는 L1 에 저장할 수 없는 값이다.

### 모듈 모델 — 03 F-03-16 `page_layout_slot` 을 왜 대체하는가

03 F-03-16 이 제안한 스키마는 다음과 같았다.

```sql
-- 03-database-core.md F-03-16 (이 문서가 대체함)
CREATE TABLE page_layout_slot (
  data_source_id uuid, property_id uuid,
  visible boolean, area text, tab_id uuid NULL, order_idx text,
  PRIMARY KEY (data_source_id, property_id)
);
```

이 스키마로 표현할 수 없는 것이 4가지다.

| 표현 불가 항목 | 이유 |
|---|---|
| `Heading` 모듈, `Property group` 모듈, `Backlinks` 모듈 | **프로퍼티가 없는 모듈**인데 PK 가 `property_id` 를 요구한다 |
| Property group 안의 **섹션**(`Add section`) | 모듈 아래 1단계 그룹핑 계층이 없다 |
| 같은 프로퍼티를 **본문 모듈로 승격하면서 Property group 에서 빠지는** 동작 | property 당 1행이므로 "어느 컨테이너 소속인지"를 부모 참조로 표현해야 한다 |
| `tab_id` 가 가리키는 대상 | `layout_tab` 테이블이 정의된 적 없다 (**U-1 dangling FK**) |

### 정본 스키마 (이 문서가 소유)

```sql
-- L1. 레이아웃 정의 1벌. data_source 당 정확히 1행.
CREATE TABLE page_layout (
  data_source_id  uuid PRIMARY KEY REFERENCES data_source(id) ON DELETE CASCADE,
  structure       text NOT NULL DEFAULT 'simple'
                  CHECK (structure IN ('simple','tabbed')),
  -- Heading 모듈에 붙는 설정 (모듈이 제거 불가이므로 레이아웃 레벨에 둔다)
  backlinks_mode  text NOT NULL DEFAULT 'hover'
                  CHECK (backlinks_mode IN ('always','hover','off')),
  -- Page settings (F-16-10)
  inline_comment_mode text NOT NULL DEFAULT 'default'
                  CHECK (inline_comment_mode IN ('default','minimal')),
  show_discussions    boolean NOT NULL DEFAULT true,
  show_property_icons boolean NOT NULL DEFAULT true,
  full_width          boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL,
  updated_by      uuid REFERENCES "user"(id),
  version         bigint NOT NULL DEFAULT 1   -- 낙관적 동시편집용 (F-16-12)
);

-- 탭. U-1 의 dangling FK 를 여기서 해소한다.
CREATE TABLE layout_tab (
  id              uuid PRIMARY KEY,
  data_source_id  uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('content','linked_view')),
  name            text,            -- content 탭은 기본 'Content'
  icon            jsonb,           -- emoji | file  [확인필요: 탭 아이콘 지정 UI 존재 여부]
  -- kind='linked_view' 일 때만 채워진다
  view_id         uuid REFERENCES view(id) ON DELETE CASCADE,
  relation_property_id uuid REFERENCES property(id) ON DELETE SET NULL,
  order_idx       text NOT NULL,   -- fractional index
  CHECK ( (kind = 'content'     AND view_id IS NULL)
       OR (kind = 'linked_view' AND view_id IS NOT NULL) )
);
-- 불변식 T1: data_source 당 kind='content' 행은 정확히 1개
CREATE UNIQUE INDEX layout_tab_one_content
  ON layout_tab (data_source_id) WHERE kind = 'content';
-- 불변식 T2: structure='simple' 이어도 content 탭 행은 유지한다(구조 전환 시 모듈 배치 보존)

-- 모듈. page_layout_slot 을 대체.
CREATE TABLE layout_module (
  id              uuid PRIMARY KEY,
  data_source_id  uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  tab_id          uuid NOT NULL REFERENCES layout_tab(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN
                    ('heading','property_group','property','backlinks','section')),
  area            text NOT NULL CHECK (area IN ('heading','main','panel')),
  parent_module_id uuid REFERENCES layout_module(id) ON DELETE CASCADE, -- section 소속
  property_id     uuid REFERENCES property(id) ON DELETE CASCADE,       -- kind='property'
  label           text,            -- section 이름 등
  visible         boolean NOT NULL DEFAULT true,   -- 눈(👁️) 토글
  order_idx       text NOT NULL,
  CHECK ( (kind = 'property') = (property_id IS NOT NULL) )
);
-- 불변식 M1: kind='heading' 행은 tab 당 1개, area='heading' 고정, 삭제 불가
-- 불변식 M2: kind='property_group' 행은 tab 당 정확히 1개, 삭제 불가(이동만 가능)
-- 불변식 M3: area='heading' AND kind='property' 인 행은 data_source 당 최대 15개  ← 원문 한도
CREATE UNIQUE INDEX layout_module_one_group
  ON layout_module (tab_id) WHERE kind = 'property_group';
-- 불변식 M4: area='panel' 인 kind='property' 행의 property.type 은 panel 배치 허용 타입이어야 함
-- 불변식 M5: 같은 property_id 가 한 tab 안에서 2개 모듈로 나타나지 않는다
CREATE UNIQUE INDEX layout_module_prop_once
  ON layout_module (tab_id, property_id) WHERE property_id IS NOT NULL;
```

> **`pinned` 컬럼을 두지 않은 이유**: "pin 되었다"는 상태는 `area='heading'` 과 정확히 동치다. 두 컬럼을 모두 두면 진실이 두 곳에 생기고 반드시 어긋난다. UI 의 핀 아이콘은 `area` 값을 `heading ↔ main` 으로 토글하는 조작이다.
>
> **`property_group` 의 의미론**: 이 모듈은 프로퍼티를 열거하지 않는다. **"별도 모듈로 승격되지도, heading 에 pin 되지도 않은 모든 프로퍼티"의 잔여 컨테이너**다. 즉 렌더 시 `SELECT property WHERE data_source_id = ? AND id NOT IN (모듈로 승격된 property_id 집합)` 로 계산된다. 이렇게 두어야 **프로퍼티를 새로 만들었을 때 자동으로 화면에 나타난다**(원본 동작). 승격된 프로퍼티 목록을 property_group 안에 복사해 두면 신규 프로퍼티가 어디에도 안 보이는 버그가 생긴다.

### 렌더 파이프라인 (읽기 경로)

```
행 클릭
 └─ L2: view.open_pages_in 으로 컨테이너 결정 (side peek | center peek | full page)  ← F-04-21
     └─ L1: page_layout(data_source_id) 조회
         ├─ structure='simple'  → content 탭의 모듈만 렌더
         └─ structure='tabbed'  → 탭 바 렌더 + 선택 탭만 렌더(비활성 탭은 쿼리하지 않음)
             ├─ content 탭      → 모듈 트리 + 본문 block tree
             └─ linked_view 탭  → view 조회 → 필터 AST 에 current_page_id 바인딩 → 행 목록
         ├─ area='heading' 모듈 → 제목 아래 가로 스크롤러 (최대 15)
         ├─ area='main'    모듈 → 본문 상단, 그 아래 본문 block tree
         └─ area='panel'   모듈 → 우측 접이식 패널 (기본 접힘)
```

### 이 도메인이 기존 엔티티에 요구하는 것 (정본 결정 입력)

| # | 대상 엔티티 | 요구사항 | 없으면 무엇이 깨지는가 |
|---|---|---|---|
| R1 | `data_source` | 레이아웃의 소유자는 **database 가 아니라 data_source** 여야 한다(1 database = N data_source 이므로). 헬프센터 표현은 "database" 지만 2025-09-03 데이터 모델에서는 data_source 가 행 집합의 단위다 `[확인필요]` | 다중 data source DB(F-04-23)에서 어느 행 집합의 레이아웃인지 결정 불가 |
| R2 | `view` | `owner_kind ∈ {database_view, layout_tab, dashboard_widget}` **소유 축**이 필요. 뷰가 항상 "DB 화면의 탭"이라는 전제가 깨진다 | 레이아웃 탭 뷰가 DB 뷰 목록에 섞여 노출됨. 삭제 캐스케이드 대상도 갈림 |
| R3 | `view.filter` AST | 평가 컨텍스트 노드에 **`current_page`** 추가 필요(F-03-17 이 도입한 `me`·상대날짜와 같은 축). 결과 캐시 키가 `(view_id, actor_id, 평가일, **current_page_id**)` 로 확장 | 탭 뷰가 모든 행에서 같은 결과를 보여줌 = 기능 자체가 성립 안 함 |
| R4 | `property_type` 메타 | 타입별 `can_pin bool` / `can_place_in_panel bool` **배치 능력 플래그** 필요 (relation 은 panel 불가) | 배치 불가 조합을 서버가 막지 못해 렌더러가 런타임에 깨진다 |
| R5 | `page`(=row) | 레이아웃 관련 컬럼을 **가지면 안 된다**(negative requirement). 동시에 F-02-07 의 페이지 설정(`full_width` 등)이 DB 행에서는 **레이아웃으로 승격**되므로, page 설정 필드에 `scope ∈ {page, data_source_layout}` 축이 필요 | 행별 full width 설정과 레이아웃 설정이 충돌해 무엇이 이기는지 정의 불가 |
| R6 | `property` | 삭제 시 `layout_module` 캐스케이드 + **Property group 잔여 계산**이 자동 반영되어야 한다. 프로퍼티 타입 변환(F-03-14) 시 배치 능력이 바뀔 수 있음(예: text → relation 이면 panel 에서 축출) | 삭제·타입변환 후 유령 모듈이 남는다 |
| R7 | ACL / 권한 | 레이아웃 편집 권한 = **`Can edit` on the database**(원문). F-04-25 의 `Can edit content`(데이터만 편집) 등급은 **레이아웃을 바꿀 수 없다**. 즉 레이아웃은 **스키마 변경과 같은 권한 클래스**다 | 데이터 편집자가 전 사용자의 화면을 바꿀 수 있게 됨 |
| R8 | 잠금 | `Lock database`(F-06-16 / F-04-25)의 범위에 **레이아웃 편집이 포함**되어야 한다 `[추정]` | 잠금의 의미가 뷰마다 다르게 해석됨 |
| R9 | 버전/감사 | 레이아웃 변경은 페이지 버전 히스토리(도메인 11)가 아니라 **data_source 스키마 변경 이벤트**다. 버전·감사 엔티티가 `object_kind='data_source_layout'` 을 받아야 한다 | "누가 우리 팀 DB 화면을 바꿨나"를 추적 불가 (레이아웃은 전 구성원 영향) |
| R10 | 동시편집 | 레이아웃은 CRDT 대상이 아니라 **`page_layout.version` 기반 낙관적 잠금 + 전체 교체** 단위여야 한다 `[추정]`. 편집 세션 중에는 드래프트를 클라이언트에 두고 `Apply to all pages` 에서 1회 커밋 | 두 사람이 동시에 배치를 바꾸면 모듈 순서가 섞인다 |
| R11 | 복제/템플릿 | DB 복제 시 `page_layout` + `layout_tab` + **탭이 소유한 view** 가 함께 복제되어야 한다. 탭 뷰가 가리키는 **외부 data_source 는 복제 대상이 아니면 원본을 계속 가리킨다** | 템플릿 배포 시 레이아웃이 사라지거나, 남의 워크스페이스 DB 를 가리킨다 |
| R12 | 검색 인덱스 | 레이아웃은 **인덱싱 대상이 아니다**(negative). 단 `visible=false` 프로퍼티도 **검색 대상에서 제외되면 안 된다** — 표시 규칙이지 접근 제어가 아니다 | 숨긴 프로퍼티가 검색에서 사라져 데이터 유실처럼 보인다 |
| R13 | 실시간 동기화 | 레이아웃 변경은 **해당 data_source 의 모든 열린 행 페이지**에 브로드캐스트되어야 한다. 즉 구독 단위에 `data_source_layout:{id}` 채널이 필요 | 다른 사용자는 새로고침 전까지 옛 레이아웃을 본다 |
| R14 | 반응형 | 모바일은 빌더 비활성 + **패널·탭의 폴백 렌더 규칙**이 필요(원문: 모바일은 보기만) | 좁은 화면에서 상세 패널이 본문을 덮는다 |

---

## 기능 명세

### F-16-01 레이아웃 편집 모드 진입과 적용 스코프

- **한 줄 정의**: 데이터베이스의 모든 행 페이지에 공통 적용되는 화면 정의를 편집 모드에서 수정하고, 한 번의 확정 동작으로 전체에 반영한다.
- **사용자 시나리오**:
  1. 데이터베이스를 **풀페이지로 연다**(인라인 DB 에서는 진입 경로가 다르다 → 엣지 케이스).
  2. 우상단 `•••` → `Customize layout`. 또는 아무 행을 열어 제목 위 영역 호버 → `Customize layout`.
  3. 화면이 **레이아웃 편집 모드**로 전환된다 — 모듈마다 드래그 핸들·`•••`·눈(👁️) 아이콘이 노출되고, 우측에 미배치 프로퍼티 목록(`Unpinned properties`)과 `Page settings` 가 열린다.
  4. 모듈을 드래그하거나 프로퍼티를 pin/unpin 한다. **변경은 현재 열려 있는 행에 즉시 미리보기**로 반영된다.
  5. 우상단 `Apply to all pages` 클릭 → 데이터베이스 전체 행에 확정 반영.
- **동작 상세**:
  - 요구 권한: **`at least Can edit access to the database`**(헬프센터 원문). `Can edit content`(F-04-25 의 데이터 전용 등급)로는 진입 불가 `[추정 — 헬프센터가 "Can edit" 이라고만 명시하므로 중간 등급의 배제는 논리적 귀결]`.
  - 적용 스코프: **데이터베이스 전역**. 원문 `A page layout will apply to all pages in the database. Layouts can't be applied only to specific pages or specific views.` → **뷰별 레이아웃도, 행별 레이아웃도 존재하지 않는다.**
  - 플랫폼: **데스크톱·웹 전용**. 원문 `While you can view layouts on mobile, you'll only get the full layout builder experience on desktop or web.`
  - 편집 중 상태는 확정 전까지 다른 사용자에게 보이지 않는다 `[추정 — Apply to all pages 라는 명시적 확정 버튼의 존재가 드래프트 단계를 함의한다]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 DB(행 0개)에서 레이아웃 편집 | 편집 가능해야 한다. 미리보기는 **빈 값 상태의 가상 행**으로 렌더 |
  | 프로퍼티 0개인 DB | Heading 은 제목만, Property group 은 빈 상태 안내. 저장 가능 |
  | 인라인 DB 에서 진입 | 헬프센터는 `full page (not inline)` 를 명시 → 인라인에서는 행을 열어 진입하거나 풀페이지 전환 유도 |
  | 동시편집: A·B 가 동시에 `Apply` | `page_layout.version` 낙관적 잠금 → 나중 커밋이 충돌 배너로 거부되고 재조회 요구. **부분 병합 금지** |
  | 편집 중 다른 사용자가 프로퍼티 삭제 | 드래프트에서 해당 모듈 제거 + `프로퍼티가 삭제됨` 인라인 안내. Apply 시 서버가 재검증 |
  | 권한 없음(`Can view` / `Can edit content`) | 메뉴에 `Customize layout` 자체를 노출하지 않음. API 로 시도 시 403 |
  | DB 가 잠김(`Lock database`) | 진입 차단 `[추정 — R8]` |
  | 대용량(프로퍼티 500개, F-03-02 한도) | `Unpinned properties` 목록을 가상 스크롤 + 검색 필수. 모듈 드래그는 실제 배치된 것만 대상이므로 부하 낮음 |
  | 편집 중 이탈(탭 닫기) | 드래프트 폐기. 이 화면은 노션 전반의 자동저장 원칙에 대한 **명시적 예외**(1회 커밋)다 |

- **데이터 모델 함의**: `page_layout`(위 정본 스키마) 1행. `version bigint` 로 낙관적 잠금. 드래프트는 서버에 저장하지 않고 클라이언트 상태로 둔다 → 서버 API 는 `PUT /data_sources/{id}/layout` **전체 교체 1개**면 충분하다(모듈 단위 PATCH 를 만들면 순서 병합 문제가 생긴다).
- **UI/인터랙션**: `•••` → `Customize layout`, 제목 호버 진입, 우상단 `Apply to all pages`, `Esc` 로 편집 모드 종료(확인 다이얼로그), 모듈 드래그 핸들.
- **의존 기능**: F-04-01(뷰·DB 컨테이너), F-03-02(프로퍼티 스키마), F-06-01 / F-04-25(권한 등급), F-16-12(영속화).
- **구현 난이도**: **M** — 편집 모드 UI 자체는 폼 빌더 수준이지만, "드래프트 → 1회 커밋 → 전역 브로드캐스트"라는 노션 전반과 다른 저장 모델을 이 화면에만 따로 만들어야 한다.
- **우선순위**: **P1** — MVP 는 고정 레이아웃(제목 + 프로퍼티 목록 + 본문)으로 성립한다. 그러나 프로퍼티가 10개를 넘는 순간 행 페이지가 사용 불가능해지므로 v1 에는 필요하다.
- **클론 시 현실적 대안**: 드래그 앤 드롭 빌더를 처음부터 만들지 말고 **① 프로퍼티 순서 변경 + ② pin 토글 + ③ 패널로 보내기** 3개 동작만 리스트 UI 로 제공한다(dnd-kit 리스트 1개). 자유 배치 캔버스는 v2.
- **참고 출처**: https://www.notion.com/help/layouts , https://www.eazypath.com/blog/notion-layouts-guide

---

### F-16-02 Heading 모듈과 pinned 프로퍼티 (최대 15개)

- **한 줄 정의**: 행 페이지 제목 바로 아래에 최대 15개의 프로퍼티를 가로로 고정 노출해, 페이지를 열자마자 핵심 값을 읽고 수정하게 한다.
- **사용자 시나리오**:
  1. 편집 모드에서 우측 `Unpinned properties` 목록을 연다.
  2. 프로퍼티 옆 **핀 아이콘** 클릭 → 해당 프로퍼티가 Heading 영역으로 이동한다.
  3. Heading 안에서 좌우 드래그로 순서를 바꾼다.
  4. 화면 폭보다 많아지면 **가로 스크롤러 + 좌우 화살표**로 넘긴다(헬프센터 명시 동작).
  5. 핀 해제 → 프로퍼티는 사라지지 않고 **Property group 으로 되돌아간다**.
- **동작 상세**:
  - **상한 15개**(헬프센터 원문 `You can pin up to 15 properties`). 03-database-core.md 한도표와 일치.
  - Heading 모듈 자체는 **이동·제거 불가**(2차 출처 다수 일치: `You can't move or remove a page's Heading`). 즉 `area='heading'` 은 항상 존재하고 항상 최상단이다.
  - Heading 모듈 설정으로 **프로퍼티 이름 표시 여부** 토글과 **Backlinks 표시 모드**(F-16-09)가 붙는다.
  - pin 은 **표시 위치**이지 접근 제어가 아니다 — 핀 여부는 API 응답·검색·필터에 영향을 주지 않아야 한다(R12).
  - `[확인필요]` 2차 출처 중 하나(notion.vip)는 `up to four "pinned" properties` 라고 서술한다. **1차 출처(help/layouts)의 15가 정본**이며, 4는 이전 버전 UI 또는 "화면에 동시에 보이는 개수"를 가리키는 것으로 판단한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 16번째 pin 시도 | 핀 아이콘 비활성 + `최대 15개` 툴팁. 서버도 불변식 M3 로 거부 |
  | pinned 프로퍼티의 **값이 빔** | 자리를 유지하고 placeholder 를 보여준다(레이아웃 흔들림 방지). 값 유무로 숨기는 조건부 표시는 **현행 노션에 없다** `[확인필요 — 03 미해결 14와 동일 항목]` |
  | pinned 프로퍼티 삭제 | 모듈 캐스케이드 삭제. 남은 항목이 자동으로 당겨진다 |
  | pinned 프로퍼티 **타입 변환**(F-03-14) | 배치는 유지. 단 새 타입이 `can_pin=false` 면 자동 unpin + 알림 |
  | 동시편집: A가 pin, B가 같은 프로퍼티 삭제 | 삭제가 이긴다(참조 무결성). A 의 Apply 는 충돌 배너 |
  | 좁은 화면 / peek 폭 축소 | 가로 스크롤러. **줄바꿈으로 세로 확장 금지** — 본문이 밀린다 |
  | 권한: `Can view` 사용자 | pinned 값은 읽기 전용 렌더. pin 구성은 못 바꿈 |
  | 15개 전부 relation·rollup | 각 칩이 N개 참조를 로드 → **행 목록에서 peek 을 빠르게 넘길 때 N+1 조회**. 프리페치 배치 필요 |

- **데이터 모델 함의**: `layout_module(kind='property', area='heading', order_idx)`. 불변식 M3(≤15)은 **DB 제약이 아니라 애플리케이션 검증**으로 둔다(부분 인덱스로 개수 제약은 표현 불가) → 커밋 트랜잭션 안에서 `SELECT count(*)` 검증. **`pinned` 별도 컬럼을 두지 않는다**(`area='heading'` 과 동치).
- **UI/인터랙션**: 핀 아이콘 토글, 좌우 드래그 정렬, 가로 스크롤 화살표, 프로퍼티 이름 표시 토글, 값 인라인 편집(F-03-16 의 셀 편집기를 그대로 재사용).
- **의존 기능**: F-16-01, F-03-02(프로퍼티), F-03-16(값 편집기), F-16-03(핀 해제 시 되돌아갈 곳).
- **구현 난이도**: **S~M** — 렌더는 S. 15개 상한·타입별 pin 가능 여부·가로 스크롤러·값 프리페치가 붙어 M 쪽.
- **우선순위**: **P1** — 없으면 프로퍼티가 많은 DB 에서 행 페이지가 스크롤 지옥이 된다. 단 MVP 는 "상위 N개 자동 표시"로 대체 가능.
- **클론 시 현실적 대안**: 초기에는 **프로퍼티 순서 상위 5개를 자동 pin** 하는 규칙형으로 시작하고, 수동 pin 은 v1. 상한은 15 대신 **8** 로 낮춰도 사용성 손실이 거의 없다(가로 스크롤러 구현을 통째로 미룰 수 있다).
- **참고 출처**: https://www.notion.com/help/layouts , https://www.notion.vip/insights/notion-tabbed-page-layouts

---

### F-16-03 Property group 과 섹션 (Add section)

- **한 줄 정의**: 개별 모듈로 승격되지도, 헤딩에 고정되지도 않은 나머지 프로퍼티 전부를 담는 단일 컨테이너이며, 그 안을 이름 있는 섹션으로 나눌 수 있다.
- **사용자 시나리오**:
  1. 편집 모드에서 본문 영역의 `Property group` 모듈을 확인한다(기본 위치: main page area).
  2. 모듈 `•••` → `Add section` → 섹션 이름 입력(예: `Stats`).
  3. 프로퍼티를 드래그해 섹션 안으로 옮긴다.
  4. 프로퍼티 옆 **눈(👁️) 아이콘**으로 개별 숨김.
  5. 모듈 `•••` → `Move to panel` 로 그룹 전체를 우측 패널로 보낸다.
- **동작 상세**:
  - **레이아웃당 Property group 은 1개**이며 **제거할 수 없다**(2차 출처 일치: `You can't remove the Property group`). 이동만 가능하다.
  - 내용은 **잔여 집합으로 계산**된다: `모든 property − (pin 된 것 ∪ 개별 모듈로 승격된 것)`. 새 프로퍼티를 만들면 **자동으로 여기에 나타난다**.
  - 섹션은 접기/펼치기 가능하며 검색 가능한 형태로 정리된다(헬프센터: `searchable sections`) `[확인필요: "searchable" 이 섹션 내 검색 UI 를 뜻하는지, 단순 정리 표현인지]`.
  - 눈 아이콘 숨김은 **표시 규칙**이다 — 값은 남아 있고 API·검색·필터에서 그대로 조회된다(R12).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 모든 프로퍼티를 pin/승격 → 잔여 0개 | Property group 은 **빈 상태로 유지**(삭제 불가). 편집 모드에서만 자리표시자 노출, 읽기 모드에서는 렌더 생략 |
  | 섹션 삭제 | 안의 프로퍼티는 삭제되지 않고 상위(그룹 루트)로 승격 |
  | 빈 섹션 | 유지된다. 읽기 모드에서 렌더 생략 `[추정]` |
  | 중첩 섹션(섹션 안 섹션) | **금지**. 1단계만 허용(`parent_module_id` 가 `kind='section'` 만 가리키도록 CHECK) |
  | 동시편집: A가 섹션 생성, B가 같은 프로퍼티 이동 | 낙관적 잠금으로 나중 커밋 거부 |
  | 삭제된 참조(프로퍼티 삭제) | 캐스케이드. 잔여 계산이므로 유령 항목 자체가 생기지 않는 것이 이 설계의 장점 |
  | 권한 없음 | 숨김 프로퍼티도 **권한이 있으면 API 로 보인다**. 숨김을 보안 수단으로 홍보하면 안 된다 |
  | 프로퍼티 500개(F-03-02 한도) | 그룹 내부를 가상 스크롤. 섹션 접힘 상태를 기본 접힘으로 |

- **데이터 모델 함의**: `layout_module(kind='property_group')` 1행(불변식 M2) + `layout_module(kind='section', label, parent_module_id=그룹id)` N행. **섹션 소속 프로퍼티는 `kind='property'` 행의 `parent_module_id` 로 표현**하되, 잔여 계산과 충돌하지 않도록 규칙을 명시한다: `kind='property'` 행이 존재하면 "배치가 지정된 것"이고, 존재하지 않으면 "그룹 루트에 `property.order_idx` 기본 순서로 표시"다. 즉 **모듈 행은 기본 동작에서의 이탈만 기록**한다(sparse 저장).
- **UI/인터랙션**: 눈 아이콘 토글, 섹션 접기 화살표, 드래그로 섹션 간 이동, 모듈 `•••`(Move up / Move down / Move to panel / Move to page), `Add section`.
- **의존 기능**: F-16-01, F-16-02(pin 과 상호 배타), F-16-04(승격과 상호 배타), F-03-02.
- **구현 난이도**: **M** — sparse 저장 + 잔여 계산 규칙이 정합성의 핵심이고, 여기를 대충 하면 "새 프로퍼티가 안 보이는" 버그가 반복된다.
- **우선순위**: **P0** — 이 컨테이너가 곧 "행 페이지의 프로퍼티 목록"이다. 섹션 기능만 P2.
- **클론 시 현실적 대안**: MVP 는 **섹션 없이 단일 목록 + 순서 + 숨김 토글**. 섹션은 v2. 정렬은 `property.order_idx` 를 그대로 재사용하고 레이아웃 전용 순서를 따로 두지 않는다.
- **참고 출처**: https://www.notion.com/help/layouts , https://www.simple.ink/guides/a-complete-guide-to-using-notions-new-layouts-feature

---

### F-16-04 개별 프로퍼티의 모듈 승격과 모듈 배치 이동

- **한 줄 정의**: 특정 프로퍼티를 Property group 에서 떼어내 본문이나 패널에 독립 모듈로 크게 배치하고, 모듈들의 상하 순서와 소속 영역을 바꾼다.
- **사용자 시나리오**:
  1. 편집 모드에서 본문 영역 또는 패널의 `+` 클릭.
  2. `새 프로퍼티 만들기` 또는 `기존 프로퍼티 선택` 중 하나를 고른다(헬프센터: `Add to panel` → create new or select existing).
  3. 선택한 프로퍼티가 **독립 모듈**로 배치되고, Property group 의 잔여 목록에서는 빠진다.
  4. 모듈 `•••` → `Move up` / `Move down` / `Move to panel` / `Move to page` 로 이동. 또는 드래그.
- **동작 상세**:
  - 모듈로 승격하면 **더 큰 표시 영역**을 갖는다 — 긴 텍스트, sub-item 목록, relation 목록처럼 값 자체가 부피를 갖는 프로퍼티가 대상이다(헬프센터: 본문 영역은 `properties containing substantial information, like sub-items or text fields` 에 적합).
  - **Heading 모듈은 이 조작의 대상이 아니다**(이동·제거 불가).
  - `Move to panel` 은 **타입 제약**을 받는다 → F-16-05.
  - 승격/강등은 값을 변경하지 않는다. 순수 표시 조작이다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 같은 프로퍼티를 두 번 승격 | 불변식 M5(tab 당 property 1회)로 차단. UI 에서 이미 배치된 프로퍼티는 선택 목록에서 회색 처리 |
  | `+` 로 **새 프로퍼티 생성** | 프로퍼티 스키마 변경(F-03-02)이 함께 일어난다 → **레이아웃 편집이 스키마를 바꾸는 유일한 경로**. 권한이 `Can edit`(스키마 편집 가능) 이어야 하는 또 하나의 근거 |
  | 승격한 프로퍼티를 다른 사용자가 삭제 | 모듈 캐스케이드 삭제. 열려 있던 편집 드래프트는 재검증에서 걸러짐 |
  | 순서 충돌(동시 드래그) | fractional index `order_idx` 로 충돌 없이 삽입. 같은 키 발생 시 `id` 로 타이브레이크 |
  | 모듈 개수 상한 | 공개 문서에 없음 `[확인필요]`. 클론은 **소프트 상한 30** 권고(렌더 비용·스크롤 피로) |
  | 대용량 relation 을 본문 모듈로 | 모듈 내부에서 **페이지네이션**(최초 N개 + 더 보기). 전량 로드 금지 |
  | 권한 없음 | 모듈 이동 UI 미노출 |
  | 빈 값 프로퍼티 모듈 | 자리 유지 + placeholder. 자동 숨김 없음(F-16-02 와 동일 규칙) |

- **데이터 모델 함의**: `layout_module(kind='property', area ∈ {main, panel}, parent_module_id = NULL, order_idx)`. **승격 = 모듈 행 생성**, **강등 = 모듈 행 삭제**(잔여 계산으로 자동 복귀). 이 대칭성 덕분에 "어디에도 없는 프로퍼티" 상태가 구조적으로 생기지 않는다.
- **UI/인터랙션**: `+` 버튼(본문/패널 각각), 모듈 `•••` 4개 항목, 드래그 앤 드롭, 드롭 가능 영역 하이라이트.
- **의존 기능**: F-16-03(잔여 계산), F-16-05(패널 제약), F-03-02(프로퍼티 생성).
- **구현 난이도**: **M** — dnd 자체는 라이브러리로 해결되지만, 드롭 대상 유효성(타입 제약·중복 방지·영역 규칙)을 드래그 중에 실시간 판정해야 한다.
- **우선순위**: **P2** — 순서 변경(P0)과 달리 "크게 보여주기"는 사용성 향상이다. sub-item 을 다루는 DB 에서는 P1.
- **클론 시 현실적 대안**: 승격을 자유 배치로 만들지 말고 **"본문 상단 고정 모듈 목록"** 하나로 제한한다. 즉 `area` 를 3개로 두되 main 안에서의 자유 좌표는 두지 않고 세로 스택만 지원 — 노션도 실제로 세로 스택이다.
- **참고 출처**: https://www.notion.com/help/layouts , https://www.eazypath.com/blog/notion-layouts-guide

---

### F-16-05 상세 패널 (Details panel)

- **한 줄 정의**: 행 페이지 우측에 접었다 펼 수 있는 보조 패널을 두고, 자주 보지 않는 프로퍼티·모듈을 본문 밖으로 치운다.
- **사용자 시나리오**:
  1. 행 페이지에서 제목 아래 또는 우상단의 패널 토글을 클릭 → 우측 패널이 열린다.
  2. 편집 모드에서 패널 안 `+` → `Add to panel` → 새 프로퍼티 생성 또는 기존 프로퍼티 선택.
  3. 본문 모듈의 `•••` → `Move to panel` 로 기존 모듈을 옮긴다.
  4. Property group 전체를 패널로 보낼 수도 있다(헬프센터: 패널은 Property group / 개별 프로퍼티 / 커스텀 모듈을 담을 수 있다).
- **동작 상세**:
  - 패널은 **기본 접힘**이며(2차 출처: `hidden by default`, `hidden drawer`) 사용자가 토글한다. 이 펼침 상태는 L3(뷰어 로컬 상태)로 본다 `[추정 — 서버 저장 여부 문서 없음]`.
  - **배치 제약**: `Some properties, like Relation, can't be moved to the details panel.` 또한 **Heading 은 패널로 이동 불가**. 즉 패널은 "모든 모듈을 담는 자유 컨테이너"가 아니다 → R4(타입별 `can_place_in_panel`).
  - 패널이 비어 있으면 토글 자체를 노출하지 않는다 `[추정]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 패널이 비었는데 열기 시도 | 토글 미노출. 편집 모드에서만 빈 드롭 영역 표시 |
  | relation 을 패널로 드래그 | 드롭 거부 + `이 프로퍼티는 패널에 배치할 수 없습니다` 안내 |
  | 프로퍼티 타입을 text → relation 으로 변환(F-03-14) | 패널에 있던 모듈이 **자동으로 본문으로 축출**되고 편집자에게 알림 `[추정 — 원본 동작 미확인, 클론 규칙으로 선언]` |
  | side peek 폭이 좁을 때 | 패널을 **본문 위에 오버레이**하거나 강제 접기. 나란히 두면 본문이 읽을 수 없게 좁아진다 |
  | 모바일 | 패널을 하단 시트 또는 별도 화면으로 폴백(빌더는 비활성) |
  | 패널에만 있는 프로퍼티를 편집 | 접힌 상태에서는 값이 보이지 않으므로, **필수 입력 프로퍼티를 패널에 두지 말라**는 운영 가이드가 필요 |
  | 동시편집: 두 사용자가 서로 다른 모듈을 패널로 이동 | 낙관적 잠금(전체 교체)으로 나중 커밋 거부 |
  | 삭제된 참조: 패널의 프로퍼티 삭제 | 모듈 캐스케이드. 패널이 비면 토글 자동 숨김 |
  | 권한 `Can view` | 패널 열람 가능, 구성 변경 불가 |

- **데이터 모델 함의**: `layout_module.area='panel'`. 추가 컬럼 없음 — **패널은 별도 엔티티가 아니라 area enum 의 한 값**이다. 여기에 별도 `panel` 테이블을 만들면 모듈 이동이 두 테이블 간 이관이 되어 트랜잭션이 복잡해진다. `property_type` 메타에 `can_place_in_panel bool` 필요(R4). 패널 펼침 상태는 `user_setting(scope='device')`(12-platform-ux.md) 로 보내고 서버 레이아웃에는 저장하지 않는다.
- **UI/인터랙션**: 패널 토글 버튼, 패널 폭 드래그 `[확인필요]`, `Add to panel`, 모듈 `Move to panel` / `Move to page`.
- **의존 기능**: F-16-04(모듈 이동), F-16-01, F-03-14(타입 변환 시 축출).
- **구현 난이도**: **S~M** — 렌더는 S. 타입 제약 판정과 좁은 화면 폴백이 붙어 M 쪽.
- **우선순위**: **P2** — 없어도 행 페이지는 성립한다. 프로퍼티가 20개 넘는 DB 에서 체감이 커진다.
- **클론 시 현실적 대안**: 패널을 만들지 말고 **Property group 을 접이식으로** 만드는 것으로 80% 대체된다. 패널을 만든다면 `position: sticky` 사이드 컬럼 하나 + 미디어쿼리 폴백이면 충분하다.
- **참고 출처**: https://www.notion.com/help/layouts , https://www.simple.ink/guides/a-complete-guide-to-using-notions-new-layouts-feature , https://www.eazypath.com/blog/notion-layouts-guide

---

### F-16-06 구조 전환 — Simple ↔ Tabbed

- **한 줄 정의**: 행 페이지를 단일 화면(Simple)으로 둘지, 상단 탭 바를 가진 다중 화면(Tabbed)으로 둘지 데이터베이스 단위로 선택한다.
- **사용자 시나리오**:
  1. 편집 모드 → `Page settings` → `Structure` → `Simple` / `Tabbed` 선택.
  2. `Tabbed` 선택 시 즉시 **`Content` 탭 하나만 있는 탭 바**가 나타난다.
  3. `Content` 탭 옆 `+` 로 탭을 추가한다(F-16-08).
  4. `Apply to all pages` 로 확정 → DB 전체 행이 탭 UI 로 열린다.
- **동작 상세**:
  - 헬프센터 정의 — Simple: `Shows your properties and page contents across the main page and the details panel.` / Tabbed: 탭 단위로 구성하며 `one Content tab` + `additional tabs that contain views of other databases`.
  - **Content 탭은 정확히 1개**이며 제거할 수 없다(불변식 T1).
  - Simple → Tabbed 전환은 **파괴적이지 않다**: 기존 모듈 배치가 Content 탭으로 그대로 이어진다 `[추정 — 스키마를 T2 로 설계해 이 성질을 보장한다]`.
  - Tabbed → Simple 전환 시 **추가 탭이 어떻게 되는가**가 핵심 질문이다. 클론 규칙: **추가 탭 정의를 삭제하지 않고 보존**하고 렌더에서만 숨긴다(다시 Tabbed 로 돌리면 복원). 삭제하면 되돌릴 수 없는 파괴적 전환이 된다 `[확인필요 — 원본 동작 미확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | Tabbed 인데 추가 탭 0개 | 탭 바를 렌더하지 않는다(Simple 과 시각적으로 동일). 편집 모드에서만 `+` 노출 |
  | Tabbed → Simple, 추가 탭 3개 | 확인 다이얼로그(`추가 탭 3개가 숨겨집니다`) 후 보존 전환 |
  | 관련 DB(relation)가 하나도 없는 DB 에서 Tabbed 선택 | 선택은 가능하나 `+` 가 추가할 후보를 제시하지 못한다 → 안내 문구 필요 |
  | 동시편집: A가 Simple 로, B가 탭 추가 | 낙관적 잠금 |
  | 삭제된 참조: 탭이 참조하던 DB 삭제 후 구조 전환 | 전환은 성공. 문제 탭은 `구성 오류` 상태로 보존 |
  | 모바일 | 탭 바는 렌더하되 스와이프 또는 드롭다운으로 폴백 |
  | 권한 없음 | 구조 전환 UI 미노출 |
  | 대용량: 탭 10개 | 탭 바 가로 스크롤. **비활성 탭의 뷰 쿼리는 실행하지 않는다**(lazy) — 이 규칙이 없으면 행 하나 열 때 쿼리 10개가 나간다 |

- **데이터 모델 함의**: `page_layout.structure ∈ {simple, tabbed}` 1컬럼. **탭 레코드는 structure 와 무관하게 유지**한다(불변식 T2). 렌더러가 `structure='simple'` 이면 content 탭만 렌더한다. 이 설계로 전환이 무손실 토글이 된다.
- **UI/인터랙션**: Page settings 의 세그먼트 컨트롤, 탭 바, 탭 클릭 전환. 선택 탭을 URL 쿼리(`?tab=`)에 반영할지는 F-02-16 라우팅과 교차 결정 `[추정: 반영하는 편이 딥링크·새로고침 보존에 유리]`.
- **의존 기능**: F-16-01, F-16-07, F-16-08.
- **구현 난이도**: **S** — 컬럼 하나와 렌더 분기. 비용은 전부 F-16-08 쪽에 있다.
- **우선순위**: **P2** — Tabbed 없이도 클론은 완전히 성립한다.
- **클론 시 현실적 대안**: 구조 전환을 사용자에게 노출하지 않고 **항상 Simple** 로 시작. 탭이 필요해지면 F-16-08 을 도입하면서 자동으로 Tabbed 가 켜지도록 하는 편이 설정 항목을 하나 줄인다.
- **참고 출처**: https://www.notion.com/help/layouts , https://notionmastery.com/tabbed-layout-adds-application-style-ui-to-notion/

---

### F-16-07 Content 탭 — 본문 블록 트리와 모듈의 소유자

- **한 줄 정의**: Tabbed 구조에서 행 페이지의 본문(자유 블록 편집 영역)과 프로퍼티 모듈을 담는 기본 탭이며, 레이아웃당 정확히 하나만 존재한다.
- **사용자 시나리오**:
  1. 행 페이지를 연다 → 기본으로 `Content` 탭이 선택된 상태다.
  2. 제목 아래 pinned 프로퍼티 → 모듈들 → 자유 본문 블록 순으로 보인다.
  3. 본문에 `/` 로 블록을 추가하면 **그 행에만** 저장된다(레이아웃이 아니다).
  4. 다른 탭으로 이동했다 돌아와도 본문 편집 상태가 유지된다.
- **동작 상세**:
  - **결정적 구분**: Content 탭 안의 것 중 **모듈 배치는 레이아웃(전 행 공통)**, **본문 블록은 행 소유(행마다 다름)**다. 같은 화면에 두 소유권이 섞여 있는 유일한 지점이며, 클론에서 가장 흔한 설계 실수가 여기다.
  - Content 탭은 제거·복제 불가(불변식 T1).
  - 이름 변경 가능 여부 `[확인필요]`. 클론은 **변경 가능**으로 두는 편이 무해하다.
  - 본문 블록 트리는 F-02-01(페이지 = 블록)·도메인 01 의 규칙을 그대로 따른다. 이 문서는 재서술하지 않는다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 본문이 빈 행 | 모듈만 렌더 + 본문 자리에 `내용을 입력하세요` placeholder |
  | 모듈 0개 + 본문 0개 | 제목만 있는 페이지. 정상 상태 |
  | 동시편집: 본문은 CRDT, 모듈은 낙관적 잠금 | **두 저장 모델이 한 화면에 공존**한다. 본문 편집은 레이아웃 version 을 올리지 않아야 한다(올리면 모든 행 편집이 레이아웃 충돌을 유발) |
  | 중첩: 본문 안에 linked view 블록(F-04-13) | 허용. 탭과 별개 개념이며 그 행에만 존재한다 |
  | 삭제된 참조: 모듈 프로퍼티 삭제 | 모듈만 사라지고 본문은 무영향 |
  | 템플릿(F-03-21)으로 생성된 행 | 템플릿은 **본문 블록과 프로퍼티 기본값**을 채우고, 레이아웃은 건드리지 않는다. 두 기능의 경계를 명시해야 한다 |
  | 대용량 본문(수천 블록) | 모듈은 즉시, 본문은 가상 스크롤. peek 에서는 특히 중요 |
  | 권한 `Can edit content` | 본문·값은 편집 가능, 모듈 배치는 불가 |

- **데이터 모델 함의**: `layout_tab(kind='content')` 1행 + 그 `tab_id` 를 가진 `layout_module` 들. **본문 블록은 이 테이블들과 무관하게 `block(parent_id = row_page_id)` 로 존재한다.** 즉 레이아웃 삭제가 본문을 지우면 안 된다 — `layout_tab` 삭제 캐스케이드는 `layout_module` 까지만 도달해야 한다.
- **UI/인터랙션**: 탭 바의 첫 번째 탭, 본문 슬래시 커맨드·드래그 핸들(도메인 01), 모듈 영역과 본문 영역의 시각적 경계.
- **의존 기능**: F-16-06, 도메인 01(블록 에디터), F-02-01.
- **구현 난이도**: **S** — 컨테이너일 뿐이다. 난이도는 "두 소유권 경계를 코드에서 흐리지 않는 규율"에 있다.
- **우선순위**: **P0** — Tabbed 를 안 만들어도 이 개념(모듈 vs 본문의 소유권 분리)은 반드시 있어야 한다.
- **클론 시 현실적 대안**: 없음 — 구조 자체가 최소 형태다.
- **참고 출처**: https://www.notion.com/help/layouts , https://www.notion.vip/insights/notion-tabbed-page-layouts

---

### F-16-08 관련 데이터베이스 탭 — 지속되는 linked view + 자동 컨텍스트 필터

- **한 줄 정의**: 현재 행과 relation 으로 연결된 다른 데이터베이스의 뷰를 탭으로 붙여, 그 행에 관련된 항목만 자동으로 걸러 보여주며, 그 구성이 데이터베이스의 모든 행에 동일하게 유지된다.
- **사용자 시나리오**:
  1. 편집 모드 → 구조 `Tabbed` → `Content` 탭 옆 `+` 클릭.
  2. **현재 데이터베이스에 연결된 relation 목록**이 피커로 뜬다(예: `Tasks`, `Meetings`).
  3. 하나를 고르면 새 탭이 생기고, 그 안에 대상 DB 의 뷰가 렌더된다.
  4. 이 뷰에는 **`Page containing this view` 성격의 필터가 자동으로** 걸려 있어, 현재 행과 관련된 항목만 나온다.
  5. 뷰 설정(레이아웃 타입·표시 프로퍼티·정렬·그룹·추가 필터)은 일반 뷰와 동일하게 편집한다.
  6. `Apply to all pages` → **다른 행을 열어도 같은 탭 구성이 나오고, 필터만 그 행 기준으로 재평가된다.**
- **동작 상세**:
  - 헬프센터 원문: 추가 탭은 `views of other databases from your workspace`. 2차 출처(Notion Mastery)는 `+` 피커가 **현재 페이지에 연결된 relation 들을 보여준다**고 서술하며, 자동 필터를 `"Page containing this view" as a Quick Filter` 로 기술한다 `[확인필요 — 필터 라벨과 피커 구성은 1차 출처에서 확인되지 않음]`.
  - **linked view(F-04-13)와의 차이**: linked view 는 특정 페이지 본문에 삽입된 블록 1개다. 탭 뷰는 **레이아웃에 저장되어 DB 의 모든 행에서 동일하게 나타난다**. 2차 출처가 이 차이를 이 기능의 존재 이유로 지목한다 — 템플릿에 linked view 를 넣어 수백 페이지에 복제한 뒤 일괄 수정이 불가능했던 문제를 해결한다.
  - 자동 필터는 편집 가능하며 추가 조건과 AND 로 결합된다 `[확인필요]`.
  - relation 이 없는 임의 DB 도 탭으로 붙일 수 있는가: 2차 출처는 "가능하지만 권한 문제가 생긴다"고 서술한다 `[확인필요]`. 클론 권고: **relation 기반만 허용**. 관계 없는 DB 를 붙이면 자동 필터의 근거가 사라져 모든 행에서 동일한 목록이 나오고, 이는 본문 linked view 와 구별되지 않는다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 관련 항목 0개인 행 | 빈 상태 + `+ New`(생성 시 relation 자동 연결). 탭 자체는 숨기지 않는다 |
  | **relation 프로퍼티가 삭제됨** | 탭의 필터 근거 소멸. 클론 규칙: 탭을 **`구성 오류` 상태로 렌더**하고 편집자에게만 수정 CTA 노출. 자동 삭제 금지(복구 불가) |
  | **탭이 참조하는 view 가 삭제됨** | `view_id` FK 캐스케이드로 탭도 삭제 — 그러나 탭 뷰는 `owner_kind='layout_tab'` 이므로 **DB 뷰 목록에 노출되지 않아 사용자가 삭제할 경로 자체가 없어야 한다**(R2) |
  | **대상 데이터베이스가 삭제/휴지통 이동** | 탭을 `접근 불가` 상태로 렌더. 대상이 복원되면 자동 회복 |
  | **권한 없음**: 뷰어가 대상 DB 접근권이 없음 | 탭을 **숨긴다**(빈 목록으로 보여주면 관련 항목 수가 0이라는 잘못된 정보를 준다). 탭 이름 자체가 정보 누설이 되는 경우도 있으므로 숨김이 안전 |
  | 뷰어가 대상 DB 에 `Can view` 만 | 탭 렌더 O, 인라인 편집·`+ New` X |
  | 동시편집: 다른 사용자가 탭 순서 변경 | 낙관적 잠금 |
  | 중첩/순환: A의 탭이 B를 보고 B의 탭이 A를 봄 | **행 페이지는 중첩 렌더되지 않으므로 무한 루프는 없다**(탭 안의 행을 클릭하면 새 peek 이 열릴 뿐). 단 peek 스택 깊이 제한 필요(F-04-21) |
  | 대용량: 관련 항목 5,000개 | 탭 뷰도 일반 뷰와 동일하게 페이지네이션(F-04-15). **비활성 탭은 쿼리하지 않는다** |
  | 행 목록에서 peek 을 빠르게 넘김 | 탭 쿼리를 디바운스(200ms) + 이전 요청 취소. 안 하면 화살표로 20행 훑을 때 쿼리 20개 |
  | 대상 DB 가 다른 teamspace | 권한 재판정 필수. 레이아웃 편집자가 볼 수 있다고 모든 행 뷰어가 볼 수 있는 것이 아니다 |

- **데이터 모델 함의**:
  - `layout_tab(kind='linked_view', view_id, relation_property_id, name, icon, order_idx)` — **U-1 의 dangling FK 해소 지점**.
  - `view` 엔티티에 `owner_kind` 축 필요(R2). 탭 뷰는 DB 뷰 목록·뷰 API 열거에서 제외되어야 한다.
  - **필터 AST 에 컨텍스트 노드 추가**(R3):
    ```json
    { "property": "<relation_property_id>",
      "relation": { "contains": { "$context": "current_page" } } }
    ```
    렌더 시 `current_page` → 현재 행 id 로 바인딩. F-03-17 의 `me`·상대날짜 노드와 **같은 평가 컨텍스트 메커니즘**을 재사용해야 하며, 새로 만들면 필터 평가기가 두 벌이 된다.
  - **쿼리 결과 캐시 키**: `(view_id, actor_id, 평가일)` → `(view_id, actor_id, 평가일, current_page_id)`. 캐시 엔트리 수가 행 수만큼 곱해지므로 **탭 뷰 결과는 캐시하지 않거나 짧은 TTL** 로 두는 편이 현실적이다.
  - 권한: 탭 렌더 시 **대상 data_source ACL 을 뷰어 기준으로 재판정**(F-04-25 와 동일 경로). 레이아웃 정의는 편집자 권한으로 만들어졌지만 렌더는 뷰어 권한으로 실행된다 — 이 분리를 놓치면 권한 우회가 된다.
- **UI/인터랙션**: 탭 바 `+`, relation 피커, 탭 `•••`(이름 변경·아이콘·삭제·복제) `[확인필요]`, 탭 드래그 정렬 `[확인필요]`, 탭 안에서는 일반 뷰의 필터·정렬·그룹 UI 전부 사용 가능.
- **의존 기능**: F-16-06(Tabbed), F-03-10(relation), F-04-01 / F-04-09 / F-04-13 / F-04-15 / F-04-25(뷰·필터·linked view·페이지네이션·권한), F-03-17(필터 컨텍스트 노드).
- **구현 난이도**: **L** — 뷰 렌더 자체는 재사용이지만, ① `view.owner_kind` 축 추가(기존 스키마 변경), ② 필터 AST 의 `current_page` 컨텍스트 바인딩, ③ 캐시 키 차원 확장, ④ 뷰어 기준 권한 재판정, ⑤ lazy 탭 쿼리 + peek 전환 시 요청 취소 — 다섯 갈래가 모두 기존 시스템을 건드린다.
- **우선순위**: **P2** — 없어도 클론은 성립하고, relation 프로퍼티를 본문 모듈로 크게 보여주는 것(F-16-04)으로 상당 부분 대체된다. 단 **`view.owner_kind` 축만은 P0 결정**이다 — 나중에 추가하면 모든 뷰 조회 쿼리를 고쳐야 한다.
- **클론 시 현실적 대안**: 탭 UI 를 만들지 말고 **"relation 프로퍼티를 본문에서 인라인 목록으로 펼쳐 보여주는 모듈"** 하나로 대체한다(F-16-04). 필터·정렬 없이 관련 항목 목록만 보여줘도 실사용의 대부분을 커버하며, 난이도가 L → S 로 떨어진다. 탭이 정말 필요하면 v2 에서 **탭 = 저장된 linked view + `current_page` 필터**로 구현한다.
- **참고 출처**: https://www.notion.com/help/layouts , https://notionmastery.com/tabbed-layout-adds-application-style-ui-to-notion/ , https://www.notion.vip/insights/notion-tabbed-page-layouts , https://www.notion.com/help/relations-and-rollups

---

### F-16-09 Backlinks 표시 모드 (Always show / Show on hover / Off)

- **한 줄 정의**: 이 행을 참조하는 다른 페이지 목록을 제목 영역에 항상 보일지, 호버 시에만 보일지, 아예 끌지를 데이터베이스 단위로 정한다.
- **사용자 시나리오**:
  1. 편집 모드 → Heading 모듈 설정 → `Backlinks` 드롭다운.
  2. `Always show backlinks` / `Show on hover only` / `Off` 중 선택(헬프센터 원문 3택).
  3. `Apply to all pages` → DB 의 모든 행에 동일 적용.
- **동작 상세**:
  - 백링크 **수집·계산 로직 자체는 F-02-14** 가 소유한다. 이 기능은 **표시 정책 1개 enum** 이다.
  - 일반 페이지에서는 같은 설정이 `Customize page` 에 **페이지별로** 있다(02-page-workspace.md L395). **DB 행에서는 이 설정이 레이아웃으로 승격되어 행별 설정이 사라진다** — R5 가 요구하는 `scope` 축의 구체적 사례다.
  - `Show on hover only` 는 렌더 비용 관점에서 중요하다: 호버 전까지 백링크 쿼리를 실행하지 않아도 된다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 백링크 0개 + `Always show` | 영역을 렌더하지 않는다(빈 자리를 남기지 않음) |
  | 백링크가 **권한 없는 페이지**에서 옴 | 뷰어 권한으로 필터링 후 개수를 센다. **개수만 노출해도 존재 누설**이므로 필터 후 카운트가 원칙 |
  | 백링크 수천 개(대용량) | 상위 N개 + `더 보기`. `Always show` 여도 전량 로드 금지 |
  | 삭제된 참조: 참조 페이지가 휴지통으로 이동 | 백링크에서 제외(F-02-14 규칙) |
  | 중첩: 백링크 페이지가 또 다른 DB 행 | 링크만 렌더. 그 행의 레이아웃을 여기서 렌더하지 않는다 |
  | 동시편집: 다른 사용자가 방금 링크 추가 | 실시간 반영은 선택. 다음 렌더에 반영해도 무방 |
  | 모바일 | `hover` 개념이 없으므로 **`hover` → `always` 로 폴백**하거나 탭 토글로 대체 |
  | 권한 없음(편집 권한 없는 뷰어) | 설정 변경 불가, 표시는 정책대로 |

- **데이터 모델 함의**: `page_layout.backlinks_mode ∈ {always, hover, off}` 1컬럼. 백링크 자체는 F-02-14 의 인덱스(`backlink(source_block_id, target_page_id)` 성격)를 그대로 조회한다. **이 기능은 새 테이블을 요구하지 않는다.**
- **UI/인터랙션**: Heading 모듈 안의 드롭다운, 읽기 모드에서 제목 아래 `N개의 백링크` 칩, 호버 시 팝오버.
- **의존 기능**: F-02-14(백링크), F-16-02(Heading 모듈).
- **구현 난이도**: **S** — enum 1개 + 렌더 분기. 비용은 F-02-14 에 있다.
- **우선순위**: **P2** — 백링크 기능(P1) 이후의 표시 정책이다.
- **클론 시 현실적 대안**: 3택 대신 **on/off 2택**으로 시작. `hover` 는 모바일에서 무의미하고 폴백 규칙만 늘린다.
- **참고 출처**: https://www.notion.com/help/layouts , (백링크 본체) 02-page-workspace.md F-02-14

---

### F-16-10 Page settings — 코멘트 표시 / 페이지 토론 / 프로퍼티 아이콘 / 전체 폭

- **한 줄 정의**: 행 페이지의 읽기 경험을 좌우하는 4개의 표시 토글을 데이터베이스 단위로 설정한다.
- **사용자 시나리오**:
  1. 편집 모드 → 우측 `Page settings` 섹션.
  2. `Inline comments`: `Default` / `Minimal` 중 선택.
  3. `Page discussions`(페이지 하단 토론 영역) 표시 토글.
  4. `Show property icons` 토글.
  5. `Full width` 토글.
  6. `Apply to all pages`.
- **동작 상세**:
  - 헬프센터가 명시하는 항목: inline comment 표시 모드(Default/Minimal), page discussions 표시 여부, property icon 표시 여부, full width 토글.
  - `Minimal` 인라인 코멘트는 하이라이트를 옅게 하거나 마커만 남기는 축소 표시로 추정된다 `[확인필요 — 정확한 시각 차이는 문서에 없음]`. **코멘트 데이터는 그대로 존재**하며 표시만 바뀐다.
  - `Full width` 는 일반 페이지에서 F-02-07 이 페이지별로 갖는 설정과 같은 축이지만, DB 행에서는 **레이아웃으로 승격**된다(R5).
  - 4개 모두 **표시 정책**이며 권한·데이터에 영향이 없다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | `Page discussions` off 인데 미읽은 코멘트 존재 | **알림은 계속 온다**(도메인 11). 알림 클릭으로 진입할 때는 영역을 **강제 표시**하는 예외가 필요 |
  | `Inline comments = Minimal` 에서 코멘트 달기 | 가능해야 한다. 표시 축소이지 기능 비활성이 아니다 |
  | 빈 값: 코멘트 0개 | 토론 영역을 렌더하지 않음(설정이 on 이어도) |
  | 행별로 다른 full width 를 원함 | **불가능**(레이아웃 스코프). 이것이 원본 제약이며 클론도 따라야 일관됨 |
  | 일반 페이지 → DB 행으로 이동(F-02-08) | 페이지가 갖고 있던 개별 `full_width` 값이 **무시되고 레이아웃 값이 적용**된다. 원래 값은 보존만(되돌릴 때 복원) |
  | DB 행 → 일반 페이지로 이동 | 레이아웃 값을 **페이지 개별 설정으로 물질화(materialize)** 한다. 안 하면 화면이 갑자기 바뀐다 |
  | 좁은 화면 | `full_width` 는 무의미 → 무시 |
  | 동시편집 | 낙관적 잠금(레이아웃 전체 교체와 동일) |
  | 권한 없음 | 토글 미노출 |

- **데이터 모델 함의**: `page_layout` 의 4컬럼(`inline_comment_mode`, `show_discussions`, `show_property_icons`, `full_width`). **R5 의 `scope` 축**: `page.full_width` 같은 페이지 개별 설정 필드는 그대로 두되, 렌더러가 `page.parent_kind='data_source'` 이면 레이아웃 값을 우선한다. 이동 시 물질화 규칙(위 엣지 케이스)이 필요.
- **UI/인터랙션**: 편집 모드 우측 패널의 토글 3개 + 세그먼트 컨트롤 1개.
- **의존 기능**: F-16-01, F-02-07(전체 폭), 코멘트 도메인(11), F-02-08(페이지 이동).
- **구현 난이도**: **S** — 컬럼 4개와 렌더 분기. 유일한 함정은 이동 시 물질화 규칙이다.
- **우선순위**: **P2** — `full_width` 만 P1 급 체감(프로퍼티 15개 pin 하면 좁은 폭에서 못 읽는다).
- **클론 시 현실적 대안**: `full_width` 만 구현하고 나머지 3개는 생략. 코멘트 표시 모드는 코멘트 기능이 완성된 뒤에 붙인다.
- **참고 출처**: https://www.notion.com/help/layouts , https://www.eazypath.com/blog/notion-layouts-guide

---

### F-16-11 열기 방식과 레이아웃의 상호작용 (peek 컨테이너 × 레이아웃)

- **한 줄 정의**: 같은 레이아웃이 side peek / center peek / full page 세 컨테이너에서 각각 어떻게 축소·폴백 렌더되는지를 규정한다.
- **사용자 시나리오**:
  1. Table 뷰에서 행 클릭 → side peek(뷰 기본값, F-04-21)으로 열린다.
  2. peek 폭이 좁아 상세 패널이 본문을 압박한다 → 패널이 자동으로 접힌다.
  3. peek 상단 `전체 페이지로 열기` → full page 로 전환 → 패널이 다시 펼쳐진다.
  4. Gallery 뷰에서 같은 행을 열면 center peek(기본값)이고, **레이아웃은 동일**하다.
- **동작 상세**:
  - **스코프 충돌이 이 항목의 존재 이유**: 레이아웃은 L1(DB 전역), 열기 방식은 L2(뷰별). 즉 **같은 레이아웃이 서로 다른 폭의 컨테이너에서 렌더된다.** 레이아웃 편집기가 보여주는 미리보기는 어느 컨테이너 기준인가 — 클론 규칙: **full page 기준으로 편집하고, 좁은 컨테이너는 결정론적 폴백 규칙으로 축소**한다.
  - 폴백 규칙(**클론 자체 규약으로 선언** — 원본 문서에 수치 없음):

    | 컨테이너 폭 | 상세 패널 | 탭 바 | pinned 프로퍼티 |
    |---|---|---|---|
    | ≥ 1100px (full page) | 나란히 표시 | 가로 나열 | 가로 스크롤러 |
    | 700~1100px (center peek) | 오버레이 토글 | 가로 나열 + 스크롤 | 가로 스크롤러 |
    | 480~700px (side peek) | 강제 접힘 | 드롭다운으로 축약 | 가로 스크롤러 |
    | < 480px (모바일) | 하단 시트 | 스와이프 또는 드롭다운 | 세로 목록으로 폴백 |

  - 열기 방식의 정본 명세는 F-04-21(뷰 저장)과 F-02-20(라우팅)이며 여기서 재서술하지 않는다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | side peek 에서 Tabbed 레이아웃 | 탭 드롭다운으로 축약. 탭을 통째로 숨기면 사용자가 데이터에 도달할 수 없다 |
  | 중첩: peek 안에서 탭 뷰의 행을 클릭 | peek 을 **교체**(스택 무한 증가 방지, F-02-20 규칙). 뒤로가기 제공 |
  | peek 폭 드래그로 실시간 축소 | 폴백 규칙을 CSS container query 로 처리 — JS 리렌더 금지(리사이즈마다 리렌더하면 편집 중 포커스가 튄다) |
  | 빈 값: 모듈이 하나도 없는 레이아웃 | 어느 컨테이너에서도 제목 + 본문만. 폴백 규칙 무영향 |
  | full page 에서 `full_width=false` | 레이아웃의 full width 설정이 적용됨. peek 에서는 무의미 |
  | 뷰마다 다른 열기 방식 | 레이아웃은 동일하므로 **폴백 규칙만 다르게 적용**된다. 레이아웃을 뷰별로 나눌 유혹이 여기서 생기는데, 원본은 그것을 명시적으로 금지한다 |
  | 삭제된 참조: peek 열린 중 행 삭제 | `삭제됨` 상태로 전환(F-04-21 규칙) |
  | 동시편집: peek 열린 중 레이아웃 변경 | R13 브로드캐스트로 모듈 영역만 리렌더. 본문 편집 커서 유지 |
  | 권한 없는 행을 peek | peek 안에서 접근 거부 렌더(F-02-20) |
  | 대용량: 탭 + side peek 연속 이동 | 탭 쿼리 디바운스·취소(F-16-08) |

- **데이터 모델 함의**: **새 필드 없음.** 이 기능은 전적으로 렌더러의 반응형 규칙이며, 서버에 저장되는 것은 `view.open_pages_in`(F-04-21, 이미 존재)뿐이다. 폴백 임계값은 **클론 상수**로 코드에 선언한다. 이 항목의 데이터 모델 기여는 "레이아웃 테이블에 컨테이너 축을 넣지 않는다"는 **부정 요구(negative requirement)** 다.
- **UI/인터랙션**: peek 폭 드래그, `전체 페이지로 열기` 아이콘, 패널 자동 접힘, 탭 드롭다운 축약, `Esc`.
- **의존 기능**: F-04-21, F-02-20, F-16-05(패널), F-16-06(탭).
- **구현 난이도**: **M** — 반응형 규칙 자체는 CSS 지만, 세 컨테이너 × 두 구조 × 패널 유무의 조합을 실제로 다 확인해야 하는 것이 비용이다.
- **우선순위**: **P1** — peek 을 구현하는 순간(F-04-21, P1) 이 규칙이 없으면 좁은 폭에서 레이아웃이 깨진다.
- **클론 시 현실적 대안**: **MVP 는 full page 만 지원**(F-02-20 의 권고와 동일). 그러면 이 기능은 통째로 사라진다. side peek 을 붙일 때 표의 폴백 규칙 4행만 구현한다.
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/releases/2022-07-20 , (본체) 04-database-views.md F-04-21 / 02-page-workspace.md F-02-20

---

### F-16-12 레이아웃 정의의 영속화 · 동시편집 · 감사 · 마이그레이션

- **한 줄 정의**: 레이아웃 레코드를 어떤 단위로 저장·전송·충돌 해소하고, 변경을 누가 언제 했는지 남기며, 프로퍼티/뷰 변경에 따라 어떻게 정합성을 유지하는지의 시스템 규약.
- **사용자 시나리오**:
  1. A가 레이아웃 편집 모드에 들어가 모듈을 옮긴다(드래프트는 로컬).
  2. 동시에 B도 편집 모드에 들어가 pin 을 추가한다.
  3. A가 먼저 `Apply to all pages` → 서버 `version` 1 → 2.
  4. B가 `Apply` → 서버가 `version=1` 기준 커밋을 거부 → B 화면에 `다른 사람이 레이아웃을 변경했습니다. 새로고침 후 다시 시도하세요` 배너.
  5. 반영 즉시 이 DB 의 행 페이지를 열고 있던 모든 사용자의 화면이 갱신된다.
- **동작 상세**:
  - **저장 단위 = 레이아웃 전체 1건**. 모듈 단위 op 를 만들면 순서 병합 문제가 생기고, 이 화면은 CRDT 가 필요할 만큼 동시 편집 빈도가 높지 않다 `[추정 — 클론의 설계 선택으로 선언]`.
  - **API**: `GET /data_sources/{id}/layout`, `PUT /data_sources/{id}/layout`(If-Match: version). 공개 Notion API 에는 **레이아웃을 읽거나 쓰는 엔드포인트가 없다** `[확인필요 — 2025-09-03 database object / Views API 문서에서 layout 관련 필드 미확인]`. 즉 클론이 이 API 를 노출하면 원본 대비 순증 기능이다.
  - **감사**: 레이아웃 변경은 **전 구성원의 화면을 바꾸는 파괴적 변경**이므로 `updated_by` + 감사 로그 엔트리(`object_kind='data_source_layout'`)가 필요하다(R9). 페이지 버전 히스토리에는 넣지 않는다 — 레이아웃은 페이지에 속하지 않는다.
  - **실시간 전파**: `data_source_layout:{id}` 채널로 브로드캐스트(R13). 페이로드는 version 만 보내고 클라이언트가 재조회하는 편이 안전하다(05 의 pull 모델과 정합).
  - **되돌리기**: 레이아웃 undo 는 편집 세션 안에서만 유효한 로컬 undo 이고, `Apply` 이후에는 되돌리기 UI 가 없다 `[확인필요]`. 클론 권고: 직전 버전 1개를 `page_layout_history` 에 남겨 `실행 취소` 를 1스텝 제공한다(비용 대비 안전 이득이 크다).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 레이아웃(레코드 없음) | **레코드가 없으면 기본 레이아웃**으로 렌더한다. DB 생성 시 굳이 레코드를 만들지 않는 lazy 생성이 마이그레이션에 유리 |
  | 삭제된 참조: 프로퍼티 삭제 | `layout_module` 캐스케이드. Property group 은 잔여 계산이라 자동 정합 |
  | 프로퍼티 타입 변환(F-03-14) | 배치 능력(R4) 재검증 → 위반 모듈은 자동 이동 + 감사 기록 |
  | 뷰 삭제(탭 뷰) | `owner_kind='layout_tab'` 뷰는 일반 경로로 삭제되지 않아야 한다. 탭 삭제가 뷰를 지우는 유일한 경로 |
  | data_source 삭제 | 레이아웃·탭·모듈 전부 캐스케이드 |
  | 중첩: DB 복제 / 템플릿 배포 | 레이아웃 + 탭 + 탭 소유 뷰를 함께 복제. **탭이 가리키는 외부 data_source 는 복제 대상에 포함되면 새 id 로 리매핑, 아니면 원본 유지**(R11) |
  | 워크스페이스 간 복제 | 외부 data_source 참조가 **접근 불가**가 된다 → 탭을 `구성 오류` 상태로 만들고 임포트 리포트에 기록 |
  | 동시편집 3인 이상 | 낙관적 잠금은 항상 "먼저 Apply 한 사람이 이긴다". presence 로 `N명이 이 레이아웃을 편집 중` 표시 권고 |
  | 대용량: 프로퍼티 500 + 탭 10 | 레이아웃 문서 크기는 수십 KB 수준 → 전체 교체 방식으로 충분 |
  | 권한 회수 중 편집 | 커밋 시점에 권한 재확인(F-04-25 와 동일 원칙). 진입 시 확인만으로는 부족 |

- **데이터 모델 함의**: 위 정본 스키마 전체 + `page_layout_history(data_source_id, version, snapshot jsonb, changed_by, changed_at)` 1단계 히스토리 `[클론 자체 결정]`. 전송 형식은 정규화 테이블이지만 **API 페이로드는 중첩 JSON 1건**으로 직렬화하는 편이 클라이언트 드래프트 관리에 유리하다.
- **UI/인터랙션**: `Apply to all pages`, 충돌 배너, `N명 편집 중` presence, (권고) `실행 취소` 1스텝.
- **의존 기능**: F-16-01~11 전부, F-04-25(권한), 도메인 05(실시간), 도메인 11(감사·히스토리).
- **구현 난이도**: **M** — 전체 교체 + 낙관적 잠금이라 로직 자체는 단순하다. 비용은 **캐스케이드·복제·타입변환 정합성 5갈래**를 빠짐없이 거는 데 있다.
- **우선순위**: **P1** — F-16-01 을 만드는 순간 함께 필요하다. 단 감사·히스토리는 P2.
- **클론 시 현실적 대안**: 히스토리 없이 `version` 낙관적 잠금만. 실시간 전파도 초기엔 생략하고 **다음 페이지 오픈 시 반영**으로 충분하다(레이아웃 변경 빈도가 낮다).
- **참고 출처**: https://developers.notion.com/reference/database , https://www.notion.com/help/layouts , (실시간 모델) 05-collaboration-sync.md

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-16-01 | 레이아웃 편집 모드 & 적용 스코프 | M | P1 | F-04-01, F-03-02, F-04-25 |
| F-16-02 | Heading + pinned 프로퍼티(≤15) | S~M | P1 | F-16-01, F-03-16 |
| F-16-03 | Property group & 섹션 | M | **P0** (섹션만 P2) | F-16-01, F-03-02 |
| F-16-04 | 프로퍼티 모듈 승격 & 모듈 이동 | M | P2 (sub-item DB 면 P1) | F-16-03, F-16-05 |
| F-16-05 | 상세 패널 | S~M | P2 | F-16-04, F-03-14 |
| F-16-06 | 구조 전환 Simple ↔ Tabbed | S | P2 | F-16-07, F-16-08 |
| F-16-07 | Content 탭 (모듈 vs 본문 소유권 분리) | S | **P0** | 도메인 01, F-02-01 |
| F-16-08 | 관련 DB 탭 (지속 linked view + current_page 필터) | **L** | P2 (단 `view.owner_kind` 축은 **P0 결정**) | F-03-10, F-04-09/13/15/25, F-03-17 |
| F-16-09 | Backlinks 표시 모드 3택 | S | P2 | F-02-14 |
| F-16-10 | Page settings 4종 | S | P2 (`full_width` 만 P1) | F-02-07, 코멘트 도메인 |
| F-16-11 | peek 컨테이너 × 레이아웃 폴백 | M | P1 | F-04-21, F-02-20 |
| F-16-12 | 영속화·동시편집·감사·마이그레이션 | M | P1 (감사·히스토리 P2) | F-16-01~11, 도메인 05/11 |

### 난이도·우선순위 판정 메모

- 이 도메인에서 **유일한 L 은 F-16-08** 이다. 나머지가 전부 S~M 인 이유는 레이아웃 빌더의 본체가 "폼 빌더 UI + enum 몇 개"이기 때문이다. **비용은 UI 가 아니라 기존 엔티티에 축을 하나씩 추가하는 데 있다** — `view.owner_kind`, 필터 AST 의 `current_page`, `property_type.can_place_in_panel`, page 설정의 `scope`. 이 4개는 나중에 넣으면 각각 전면 수정을 부른다.
- **P0 이 3개뿐**(F-16-03 / F-16-07 / F-16-08 의 스키마 축)인 것이 이 도메인의 성격이다. 레이아웃 빌더는 **기능으로는 P2 지만 데이터 모델로는 P0** 인 전형적 케이스다. 기존 13개 문서가 이 도메인을 통째로 빠뜨렸는데도 겉으로 티가 나지 않았던 이유이자, 그럼에도 지금 결정해야 하는 이유가 같다.
- 기존 문서와의 등급 정합: 03 F-03-16 은 셀 편집 UX 를 **L / P0** 로 잡았다. 이 문서는 그 등급에 **개입하지 않는다** — 레이아웃(F-16-xx)과 셀 편집(F-03-16)은 별개 작업 단위이며, F-03-16 의 L 은 그리드 키보드 내비게이션과 붙여넣기 파싱에서 온 것이지 레이아웃에서 온 것이 아니다.

### 의존 순서 (구현 순서 권고)

```
데이터 모델 선결 (코드보다 먼저 — 나중에 넣으면 전면 수정)
  view.owner_kind 축 ──────────────> F-16-08
  필터 AST current_page 컨텍스트 ──> F-16-08     (F-03-17 의 me/상대날짜와 같은 메커니즘)
  property_type.can_place_in_panel ─> F-16-05
  page 설정 scope(page|layout) 축 ──> F-16-09, F-16-10

렌더 경로 (읽기 먼저 만들고 편집기를 나중에)
  F-16-07 Content 탭(소유권 분리) ─┬─ F-16-03 Property group ─┬─ F-16-02 pinned
                                   │                          └─ F-16-04 모듈 승격 ─ F-16-05 패널
                                   └─ F-16-06 구조 ─ F-16-08 관련 DB 탭

편집 경로
  F-16-01 편집 모드 ─ F-16-12 영속화/동시편집
                    └─ F-16-09 / F-16-10 (설정 enum 들)

가로지르는 축
  F-16-11 반응형 폴백 ── F-16-02/05/06 전부와 결합 (F-04-21 peek 을 만드는 시점에 함께)
  F-16-12 캐스케이드 정합성 ── F-03-02(프로퍼티 삭제) / F-03-14(타입 변환)
                            ├─ F-04-13(뷰 삭제) / F-04-23(data_source 삭제)
                            └─ 복제·템플릿(F-03-21 / F-08-02)
```

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인에서 참고할 점 | 차용 가능한 접근 |
|---|---|---|
| **NocoDB** (`Expanded record`) | 레코드 상세를 모달/사이드시트로 열고, 필드 표시·순서를 툴바에서 관리한다. 그리드에서 display value 포함 최대 3개 필드 pin. | **레코드 상세 = 뷰 설정의 일부**로 두는 단순한 모델. 클론 MVP(순서 + 숨김만)의 참고. pin 개수에 낮은 상한을 두는 것이 구현·성능 모두 유리하다는 근거(F-16-02 의 "15 대신 8" 권고와 같은 방향). |
| **NocoDB** (`Interfaces` / layouts, `Page Designer` 확장) | 앱 레이아웃을 데이터와 분리된 별도 레이어로 정의하고, 레코드 자유 배치 디자이너를 **코어가 아닌 확장**으로 분리했다. | 레이아웃 레이어를 데이터 레이어와 **별도 테이블로 분리**하는 구조 근거(= `page_layout`). 자유 배치를 코어에 넣지 않은 결정도 그대로 참고할 만하다. |
| **Teable** | 필드를 실제 Postgres 컬럼으로 승격하고, 뷰는 비파괴적 오버레이(각자 숨김 필드·순서)로 둔다. | 레이아웃도 같은 성격의 "비파괴적 오버레이"다. **오버레이는 sparse 저장(기본에서 벗어난 것만 기록)** 이 정답이라는 근거 — F-16-03 의 잔여 계산과 같은 원리. |
| **AppFlowy** | 데이터베이스 Row detail 화면이 프로퍼티 목록 + 본문으로 고정 구성. 커스터마이즈 레이어가 없다. | **레이아웃 빌더 없이도 DB 클론이 성립한다는 증거**. F-16-03/F-16-07 만 구현하고 나머지를 미루는 로드맵의 타당성 근거. |
| **AFFiNE / BlockSuite** | 블록 기반 문서 안에 DB 를 임베드. 행 상세 커스터마이즈 여부 `[확인필요 — 1차 출처 미확보]` | 본문 블록 트리와 모듈 영역의 소유권 분리(F-16-07) 설계 참고 후보 |

> 주의: 위 5개 중 **Notion 의 Tabbed layout 에 해당하는 기능을 가진 오픈소스는 확인되지 않았다.** F-16-08 은 참고 구현 없이 만들어야 하며, 이것이 이 항목을 L 로 평가한 부수적 근거다.

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 |
|---|---|---|
| 1 | **레이아웃의 소유자가 database 인가 data_source 인가** — 헬프센터는 "database" 라 쓰지만 2025-09-03 모델에서 행 집합의 단위는 data_source 다 | 다중 data source DB(F-04-23)에서 레이아웃이 몇 개인지 결정. R1 |
| 2 | **탭 개수 상한** — 공개 문서에 없음 | 행 하나 열 때 나가는 쿼리 수의 상한. 소프트 리밋 필요 |
| 3 | **탭 이름·아이콘·순서 변경 가능 여부** — 2차 출처는 "뷰 설정을 그대로 쓴다"고 하나 1차 미확인 | `layout_tab.name/icon/order_idx` 컬럼의 필요 여부 |
| 4 | **relation 없는 임의 DB 를 탭으로 붙일 수 있는가** — 2차 출처는 가능하다고 하나(권한 문제 언급) 1차 미확인 | 가능하면 `relation_property_id NOT NULL` 제약을 풀어야 하고, 자동 필터의 근거가 사라진다 |
| 5 | **자동 필터의 정확한 형태·라벨**(`Page containing this view`) | 필터 AST 컨텍스트 노드의 계약. R3 |
| 6 | **Tabbed → Simple 전환 시 추가 탭이 삭제되는가 보존되는가** | 파괴적 전환인지 여부. 클론은 보존으로 선언했으나 원본 확인 필요 |
| 7 | **pinned 상한이 15인가 4인가** — 1차(help/layouts)는 15, 2차(notion.vip)는 4 | 15를 정본으로 채택했으나 4가 "동시 표시 개수"일 가능성. UI 실측 필요 |
| 8 | **패널 배치 불가 타입의 전수 목록** — 문서는 `Some properties, like Relation` 이라고만 함 | R4 의 `can_place_in_panel` 플래그 값을 채울 수 없다. 실측 필요 |
| 9 | **조건부 표시(값 있을 때만 표시)의 존재 여부** — 03 미해결 14와 **동일 항목**(중복 추적 금지, 이 행으로 병합) | 존재하면 `layout_module` 에 `visible_when` 축이 하나 더 생긴다 |
| 10 | **`Apply to all pages` 이전 드래프트의 서버 저장 여부** | 저장한다면 `page_layout_draft` 테이블과 드래프트 동시편집이 추가로 필요해진다 |
| 11 | **레이아웃이 공개 API 에 노출되는가** — Views API·database object 에서 layout 필드 미확인 | 노출된다면 필드명을 원본에 맞춰야 하고, 아니면 클론 자체 API 로 설계 |
| 12 | **linked database(F-04-13)에서 원본 DB 의 레이아웃을 따르는가** | 따르지 않으면 linked view 에서 행을 연 화면이 원본과 달라진다 |
| 13 | **상세 패널 펼침 상태가 서버에 저장되는가**(사용자별/디바이스별/전역) | L3 로 분류했으나 확인 필요. 전역이면 레이아웃 컬럼이 하나 늘어난다 |
| 14 | **레이아웃 변경의 되돌리기(undo) 제공 여부** | 없다면 전 구성원 화면이 바뀌는 변경에 안전망이 없다는 뜻 |
| 15 | **Dashboard / Feed / Form 뷰를 탭에 넣을 수 있는가** | 가능하면 F-04-18/20 과의 조합 폭발. form 탭은 "행 상세에서 다른 DB 에 익명 제출"이라는 권한 축을 새로 만든다 |
| 16 | **레이아웃 변경이 감사 로그에 남는가**(Enterprise) | R9. 남지 않으면 클론이 순증 기능으로 추가하는 것 |
| 17 | **`Minimal` 인라인 코멘트의 정확한 시각 차이** | F-16-10 렌더 규칙 |
| 18 | **`searchable sections`(헬프센터 표현)가 섹션 내 검색 UI 를 뜻하는가** | 그렇다면 F-16-03 에 검색 입력이 추가된다 |
| 19 | **레이아웃 기능의 정확한 출시 시점** — 2차 출처는 Make with Notion 2024(2024-10-24) 키노트를 지목하나 공식 릴리스 노트에서 해당 항목을 특정하지 못함 | 릴리스 노트 기반 기능 계보 추적의 정확성 |

---

## 출처

1. https://www.notion.com/help/layouts — **1차 출처(정본)**. `Customize layout` 진입 경로(`full page (not inline)` → `•••`), `You can pin up to 15 properties`, 가로 스크롤러, Heading·Property group·Details panel·Page settings 구성, `Add section`, `Add to panel`, Backlinks 3택(`Always show` / `Show on hover only` / `Off`), Simple vs Tabbed 정의(`one Content tab` + `additional tabs that contain views of other databases`), `A page layout will apply to all pages in the database. Layouts can't be applied only to specific pages or specific views.`, `You must have at least Can edit access to the database.`, `While you can view layouts on mobile, you'll only get the full layout builder experience on desktop or web.`
2. https://www.notion.com/help/views-filters-and-sorts — **1차 출처**. `Open pages in`(side peek / center peek / full page)이 **뷰 단위 설정**이며 Table·Board·List·Timeline = side peek, Gallery·Calendar = center peek 기본값
3. https://www.notion.com/releases/2025-07-10 — **1차 출처**. Notion 2.52 "Everything is database". 프로퍼티 메뉴에서 group/insert/rename, Feed 뷰, row-level permissions 예고 — 레이아웃 주변 데이터 모델 변화의 시점 근거
4. https://www.notion.com/releases/2022-07-20 — **1차 출처**. database side peek 도입 릴리스
5. https://developers.notion.com/reference/database — **1차 출처**. 2025-09-03 이후 database → `data_sources[]` 구조. **layout 관련 필드가 노출되지 않음**을 확인한 근거(미해결 11)
6. https://www.notion.com/help/relations-and-rollups — **1차 출처**. 탭의 자동 필터 근거가 되는 relation 의 양방향 구조
7. https://www.notion.vip/insights/notion-tabbed-page-layouts — 2차. 레이아웃 영역 구분(heading / main / details panel), 탭이 관련 DB 뷰이며 `automatically filtered to display only the items related to the current page`, `Each database has just one layout configuration`. **단 pinned 개수를 4로 서술해 1차 출처(15)와 불일치** → 미해결 7
8. https://notionmastery.com/tabbed-layout-adds-application-style-ui-to-notion/ — 2차. Tabbed 전환 경로(`Customize layout` → `Page Settings` → `Tabbed`), `Content` 탭 옆 `+` 가 **현재 페이지에 연결된 relation 목록**을 제시, 자동 필터가 `Page containing this view` Quick Filter 형태, 탭마다 아이콘·이름·레이아웃·필터·정렬·그룹 설정 가능, **Content 탭은 1개만**, 관련 없는 DB 를 붙이면 권한 문제 발생, linked view 대비 차이(템플릿 재적용 불필요)
9. https://www.simple.ink/guides/a-complete-guide-to-using-notions-new-layouts-feature — 2차. 상세 패널이 `collapsible sidebar` / `hidden drawer`(기본 숨김), 모듈 생성 경로, 레이아웃이 DB 전 항목에 일괄 적용
10. https://www.eazypath.com/blog/notion-layouts-guide — 2차. 레이아웃 편집기 사이드바 구성(Inline Comments / Page Discussions / Show Property Icons), 영역 구분(Heading / Property Group / Relation Group / Panel), 모듈 `•••` 의 `Move to Panel`, `Add section` 흐름, **우상단 `Apply to all pages` 버튼**
11. 제약 사항 교차 확인(위 7·9·10 출처군) — `You can't move or remove a page's Heading`, `You can't remove the Property group`, `Some properties, like Relation, can't be moved to the details panel`, 모듈 `•••` 의 `Move up` / `Move down` / `Move to panel` / `Move to page`
12. https://nocodb.com/docs/interfaces/layouts , https://nocodb.com/docs/product-docs/extensions/page-designer , https://nocodb.com/docs/product-docs/table-operations/field-operations — 오픈소스 대조군(레코드 상세·필드 순서·레이아웃 레이어 분리)
13. https://help.teable.ai/en/changelog — 오픈소스 대조군(비파괴적 뷰 오버레이)
14. (내부 참조) `03-database-core.md` F-03-02 / F-03-14 / F-03-16 / F-03-17 / F-03-21, `04-database-views.md` F-04-01 / F-04-09 / F-04-13 / F-04-15 / F-04-21 / F-04-23 / F-04-25, `02-page-workspace.md` F-02-01 / F-02-07 / F-02-08 / F-02-14 / F-02-16 / F-02-20, `06-permissions-sharing.md` F-06-01 / F-06-16, `12-platform-ux.md` `user_setting(scope)`, `_critique/coverage-critique.md` A-3 / U-1

---

## 03-database-core.md 에 대한 정정 요청

이 문서의 작성으로 다음 항목이 해소·정정되어야 한다.

| 대상 | 현재 | 정정 |
|---|---|---|
| F-03-16 `page_layout_slot` (L942~951) | `PRIMARY KEY (data_source_id, property_id)`, `tab_id uuid NULL` (**dangling FK**) | **`page_layout` + `layout_tab` + `layout_module` 3테이블로 대체**(이 문서 정본 스키마). `tab_id` 가 참조하는 `layout_tab` 은 F-16-08 / F-16-12 가 정의한다 |
| F-03-16 · F-03-02 의 레이아웃 서술 (L266, L917) | `[정정]` 각주 2곳에 레이아웃 빌더 설명이 압축돼 있음 | **F-16-01~12 로 포인터 축약**. 재서술 금지 |
| 한도표 `페이지 레이아웃 헤딩 영역 고정 프로퍼티 최대 15개` (L205) | 유지 | 유지(1차 출처 일치). **불변식 M3 로 승격**하고 검증 위치를 명시(레이아웃 커밋 트랜잭션) |
| 미해결 14(조건부 표시가 남아 있는가) | 03 소유 | 이 문서 미해결 9와 **동일 항목** — 하나로 병합해 중복 추적을 없앤다 |
| `relation 등 일부 타입은 상세 패널에 배치할 수 없다` | 03 F-03-16 본문에 단문으로 존재 | **R4(`property_type.can_place_in_panel`)로 스키마화**. 전수 목록은 미해결 8 |
