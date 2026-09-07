# 03. 데이터베이스 코어 & 프로퍼티

> 조사일: 2026-09-06 (GAP 2차 보완) / 기준 API 버전: **`2026-03-11`** (현행 최신 breaking 버전). database→data_source 3계층은 `2025-09-03` 에서 도입
> 변경 이력 근거: https://developers.notion.com/page/changelog
> 태그 규칙: `[추정]` = 공개 문서에 없어 추론한 내용, `[확인필요]` = 검증이 필요한 사실

## 요약

- 노션 데이터베이스는 "행을 가진 표"가 아니라 **페이지의 컬렉션**이다. 모든 행(row)은 그 자체로 본문 블록을 갖는 완전한 페이지다. ("Every item you enter into your database is a Notion page" — [intro-to-databases](https://www.notion.com/help/intro-to-databases))
- 2025-09-03 이후 계층은 3단이다: **database(컨테이너) → data source(스키마 + 행 집합) → page(행)**. 하나의 database가 여러 data source를 가질 수 있다.
- 스키마는 `properties` 맵이다. 각 프로퍼티는 `id` / `name` / `type` + **타입별 config 객체**를 갖는다. 이 "타입별 config" 패턴이 도메인 전체의 설계 축이다.
- 프로퍼티는 3계층으로 나뉜다: **저장형(stored)** 사용자가 직접 값을 씀 / **자동형(system)** 시스템이 씀(created_time, unique_id) / **파생형(derived)** 다른 값에서 계산됨(formula, rollup).
- 클론 난이도의 대부분은 프로퍼티 타입 개수가 아니라 **relation ↔ rollup ↔ formula 의존성 그래프 재계산**과 **프로퍼티 타입 변환 시 데이터 마이그레이션**에 몰려 있다.
- **[2026-09-06 GAP 검증에서 뒤집힌 전제]** 초판은 "formula 는 다른 formula 를 참조할 수 없다"고 서술했다. 이는 **틀렸다**. 노션은 formula/rollup 참조를 **체인 15단계까지 허용**하며(2024-08 이전에는 7단계), 한도를 넘어도 **에러를 표시하지 않고 조용히 값이 비거나 틀린다**. 따라서 파생값 의존 그래프의 깊이는 1이 아니라 최대 15이고, F-03-13 은 "얕은 그래프"가 아니라 **깊이 제한이 있는 DAG 평가기**로 설계해야 한다. (https://thomasjfrank.com/formulas/property-reference-limits/)
- 데이터베이스 코어는 프로퍼티 스키마만이 아니다. **필터/정렬 연산자 계약(F-03-17), sub-item·dependency 내장 self-relation(F-03-18), 데이터베이스 자동화(F-03-19), AI 자동 채우기(F-03-20), 데이터베이스 템플릿=사실상의 기본값 메커니즘(F-03-21), 데이터베이스 잠금(F-03-22)** 이 모두 이 도메인에 속한다. 초판에는 전부 빠져 있었다.
- **노션에는 범용 "프로퍼티 기본값" 설정이 없다.** 기본값은 오직 **데이터베이스 템플릿**의 사전 입력 값으로만 표현된다. 헬프센터의 프로퍼티 문서에 default value 항목이 존재하지 않는다(재확인 2026-09-06). 단 **`status` 만은 예외로 "기본 옵션(default option)" 개념이 있어 신규 행에 자동 배정된다** `[2차 출처]`. (https://www.notion.com/help/database-templates , https://athena.outer-reaches.com/site/blog/2024/06/notion-status-property-no-defaults-empty/)
- **[2026-09-06 2차 GAP 에서 1차 출처로 격상된 항목]** "formula/rollup 참조 체인 깊이 15" 는 더 이상 2차 출처 추정이 아니다. **노션 공식 헬프가 명시한다**: `Notion formulas can only be 15 layers deep. Every time a formula references another formula or rollup, it adds a layer.` (https://www.notion.com/help/common-formula-errors)
- **[2026-09-06 2차 GAP 에서 뒤집힌 전제]** 초판·1차 GAP 은 `verification` 을 "위키 전용 특수 프로퍼티 `[확인필요]`" 로 처리했다. **틀렸다.** 공식 헬프는 `you can also add verification as a property to an entire database to verify all of the database's pages` 라고 명시하며, 이 프로퍼티를 추가하면 **`Owner` 프로퍼티가 자동으로 함께 생성**된다. 즉 verification 은 "다른 프로퍼티를 자동 생성하는 유일한 프로퍼티"이며 만료·알림 상태 머신을 갖는다. F-03-23 신설. (https://www.notion.com/help/wikis-and-verified-pages)
- **[2026 API 변경 반영]** 이 문서의 초판·1차 GAP 은 `2025-09-03` 을 기준으로 삼았으나, 그 이후 데이터베이스 코어에 직접 영향을 주는 변경이 다수 있었다: **Views API 정식 출시(2026-03-19, 8개 엔드포인트 + view.created/updated/deleted 웹훅)**, **API 버전 `2026-03-11`(breaking: `archived` → `in_trash`)**, **status 프로퍼티의 API 생성·수정 지원(2026-06-22, 옵션에 `group` 필드)**, **formula 표현식의 API 쓰기 + 유효성 에러 반환(2026-08-12)**, **`me` 상대 필터·상대 날짜 값(2026-03-30)**, **select/status 다중값 필터(2026-04-17)**, **쿼리 페이지네이션 최대 깊이 10,000(2026-04-20)**, **typed database `database_type`= `tasks`/`projects`/`skills`(2026-09-02)**. (https://developers.notion.com/page/changelog)

---

## 핵심 개념 / 데이터 모델

### 계층 구조

```
workspace
└── block (page 포함, 모든 콘텐츠의 단위)
    └── database          # 컨테이너. title, icon, cover, is_inline, views
        └── data_source   # 스키마 소유자. properties{} 를 가짐
            └── page      # 행. properties 값 + 자체 블록 본문
```

- `database` 객체: `id`, `title`, `parent`, `is_inline`, `icon`, `cover`, `created_time`, `last_edited_time`, `data_sources[]`
- `data_source` 객체: `id`, `properties{}`, `parent`(database 참조), `database_parent`, 타임스탬프
- page 생성 시 parent 는 `{"type":"data_source_id","data_source_id":"..."}`
- relation 프로퍼티는 이제 `data_source_id` 를 가리킨다. 응답에는 `database_id` 와 `data_source_id` 가 모두 오지만, 요청에는 `data_source_id` 만 넣어야 한다.
- 출처: https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03

> **클론 권고**: MVP에서 database : data_source = 1 : 1 로 고정하되, **스키마를 database 테이블이 아니라 별도 data_source 테이블에 두는 것**만은 처음부터 지켜라. 나중에 1:N 확장 시 마이그레이션 비용이 사라진다.

### 의사 스키마 (RDB 기준)

```sql
-- 컨테이너
CREATE TABLE database (
  id            uuid PRIMARY KEY,
  parent_block  uuid REFERENCES block(id),
  title_rich    jsonb,
  icon          jsonb,
  cover         jsonb,
  is_inline     boolean NOT NULL DEFAULT false,
  created_at    timestamptz, updated_at timestamptz,
  deleted_at    timestamptz             -- soft delete (휴지통)
);

-- 스키마 소유자
CREATE TABLE data_source (
  id            uuid PRIMARY KEY,
  database_id   uuid NOT NULL REFERENCES database(id),
  name          text,
  order_idx     text,                   -- fractional index
  created_at    timestamptz, updated_at timestamptz
);

-- 프로퍼티 정의 (properties{} 를 정규화)
CREATE TABLE property (
  id             uuid PRIMARY KEY,      -- 노션의 짧은 property id 에 대응
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  type           property_type NOT NULL,   -- enum, 아래 전수표 참조
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 타입별 설정
  order_idx      text NOT NULL,         -- 컬럼 순서 (fractional index)
  created_at     timestamptz, updated_at timestamptz,
  UNIQUE (data_source_id, name)         -- [확인필요] 노션이 동명 프로퍼티를 실제로 막는지
);

-- 행 = 페이지
CREATE TABLE page (
  id             uuid PRIMARY KEY REFERENCES block(id),
  data_source_id uuid REFERENCES data_source(id),
  order_idx      text,
  created_by     uuid, created_at timestamptz,
  edited_by      uuid, edited_at  timestamptz,
  unique_seq     bigint,                -- unique_id 프로퍼티용 시퀀스 값
  deleted_at     timestamptz
);

-- 셀 값. EAV(세로형)
CREATE TABLE page_property_value (
  page_id     uuid REFERENCES page(id) ON DELETE CASCADE,
  property_id uuid REFERENCES property(id) ON DELETE CASCADE,
  value       jsonb,                    -- 타입별 판별 유니온
  PRIMARY KEY (page_id, property_id)
);

-- relation 은 반드시 별도 엣지 테이블 (jsonb 배열이면 역방향 조회 불가)
CREATE TABLE relation_edge (
  property_id  uuid REFERENCES property(id) ON DELETE CASCADE,
  from_page_id uuid REFERENCES page(id) ON DELETE CASCADE,
  to_page_id   uuid REFERENCES page(id) ON DELETE CASCADE,
  order_idx    text,                    -- relation 셀 내 순서 보존
  PRIMARY KEY (property_id, from_page_id, to_page_id)
);
CREATE INDEX ON relation_edge (property_id, to_page_id);   -- 양방향 역참조용

-- select / multi_select / status 옵션 레지스트리
CREATE TABLE select_option (
  id          uuid PRIMARY KEY,
  property_id uuid REFERENCES property(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       option_color NOT NULL,
  group_id    uuid NULL,                -- status 전용
  order_idx   text
);

-- 파생 프로퍼티 재계산용 의존성 그래프
CREATE TABLE property_dependency (
  dependent_property_id uuid REFERENCES property(id) ON DELETE CASCADE,
  source_property_id    uuid REFERENCES property(id) ON DELETE CASCADE,
  via_relation_id       uuid NULL REFERENCES property(id),  -- rollup/map 경유 relation
  PRIMARY KEY (dependent_property_id, source_property_id)
);
```

### 셀 저장 전략 비교

| 방식 | 장점 | 단점 | 권고 |
|---|---|---|---|
| EAV (`page_property_value`) | 스키마 변경이 DDL 없이 즉시, 프로퍼티 500개 한도 대응 쉬움, 셀 단위 동시편집 충돌 해소 자연스러움 | 정렬/필터 시 조인·피벗 비용 | **MVP 권고** |
| 페이지당 단일 `properties jsonb` | 읽기 1회, 구현 최단 | 프로퍼티별 인덱싱 불가, 셀 단위 충돌 해소 불가 | 프로토타입만 |
| 데이터소스별 물리 테이블 (Teable 방식) | 네이티브 SQL 정렬/필터, 100만 행 이상 | 스키마 변경 = 온라인 DDL, 운영 복잡 | v2 이후 |

Teable 은 data source 마다 실제 Postgres 물리 테이블을 만든다 (https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion). NocoDB 는 relation/lookup/rollup/formula 를 "virtual column"으로 두고 쿼리 시점에 해석한다 (https://deepwiki.com/nocodb/nocodb/5.4-formula-system).

### 프로퍼티 타입 전수표

두 문서를 2026-09-06 에 재대조. 출처: https://developers.notion.com/reference/property-object , https://www.notion.com/help/database-properties (API 버전 `2026-03-11` 기준이지만 프로퍼티 타입 집합 자체는 `2025-09-03` 이후 변동 없음 — 추가된 것은 status 의 API 조작 가능성과 필터 표면뿐)

| # | type | 분류 | config 키 | 셀 값 형태 | 비고 |
|---|---|---|---|---|---|
| 1 | `title` | 저장 | `{}` | rich_text[] | data source 당 **정확히 1개 필수**. 삭제·타입 변경 불가 |
| 2 | `rich_text` | 저장 | `{}` | rich_text[] | 인라인 서식·멘션 포함 |
| 3 | `number` | 저장 | `{format}` | number \| null | format: `number`, `number_with_commas`, `percent`, `dollar`, `euro`, `pound`, `yen`, `yuan`, `won`, `ruble`, `rupee`, `franc`, `real`, `lira`, `krona`, `ringgit` 등 |
| 4 | `select` | 저장 | `{options[]}` | option ref \| null | option = `{id, name, color}` |
| 5 | `multi_select` | 저장 | `{options[]}` | option ref[] | 순서 보존 |
| 6 | `status` | 저장 | `{options[], groups[]}` | option ref \| null | group = `{id, name, color, option_ids[]}` |
| 7 | `date` | 저장 | `{}` | `{start, end, time_zone}` | end 없으면 단일 날짜, 시간 optional |
| 8 | `people` | 저장 | `{}` | user ref[] | 사용자 + 그룹 |
| 9 | `files` | 저장 | `{}` | file[] | 업로드 파일 + 외부 URL 혼재 |
| 10 | `checkbox` | 저장 | `{}` | boolean | null 없음, 기본값 false |
| 11 | `url` | 저장 | `{}` | string \| null | |
| 12 | `email` | 저장 | `{}` | string \| null | 클릭 시 메일 클라이언트 |
| 13 | `phone_number` | 저장 | `{}` | string \| null | 클릭 시 전화 |
| 14 | `place` | 저장 | `{}` | 장소 객체 | name / formatted address / lat / lng. map view의 소스 |
| 15 | `relation` | 저장(엣지) | `{data_source_id, single_property \| dual_property}` | page ref[] | dual_property = `{synced_property_id, synced_property_name}` |
| 16 | `formula` | 파생 | `{expression}` | 가변 | 결과 타입: string / number / boolean / date / person / page / list |
| 17 | `rollup` | 파생 | `{relation_property_id, rollup_property_id, function}` | 함수별 가변 | 아래 집계 함수표 |
| 18 | `created_time` | 자동 | `{}` | ISO datetime | 읽기 전용 |
| 19 | `created_by` | 자동 | `{}` | user ref | 읽기 전용 |
| 20 | `last_edited_time` | 자동 | `{}` | ISO datetime | 읽기 전용 |
| 21 | `last_edited_by` | 자동 | `{}` | user ref | 읽기 전용 |
| 22 | `unique_id` | 자동 | `{prefix}` | `{prefix, number}` | 읽기 전용, 자동 증가 |
| 23 | `button` | 액션 | 액션 스텝 배열 | 값 없음 | 셀이 값이 아니라 트리거. 헬프 `database-properties` 에는 **Button 이 명시**되지만 **API `property-object` 타입 목록에는 없다**(2026-09-06 재확인) → **UI 전용 타입**. API 로 생성/수정 불가 `[확인필요: retrieve 응답에 unsupported 형태로라도 나오는지]` |
| 24 | `verification` | 자동/워크플로 | `{}` `[확인필요: API 미노출]` | `{state, verified_by, date}` | **[정정]** 위키 전용이 아니다. **임의의 데이터베이스에 프로퍼티로 추가할 수 있고, 추가 시 `Owner` 프로퍼티가 자동 동반 생성된다.** 만료 시각을 갖는 상태 머신(verified → expired). Business/Enterprise 전용. API `property-object` 타입 목록에는 없으나 **2026-08-13 부터 뷰 필터에서는 verification 필터가 지원**된다 → API 표면에 부분적으로 존재. F-03-23 참조 |
| — | (AI 자동 채우기) | 파생/외부 | `[확인필요: API 미노출]` | 텍스트 | **독립 타입이 아니다.** `text` 프로퍼티에 "AI Autofill" 을 설정하는 형태. F-03-20 참조 |

> **전수표 검증 결과 (2026-09-06, 2차 확인)**: 두 문서를 각각 다시 읽어 목록을 대조했다.
> - 헬프 `database-properties` 가 열거하는 타입: Text, Number, Select, Status, Multi-Select, Date, Formula, Relation, Rollup, Person, File, Checkbox, URL, Email, Phone, Created time, Created by, Last edited time, Last edited by, **Button**, ID, **Place** = **22종**. `title` 은 별도로 열거되지 않고(모든 DB 가 강제로 갖는 것이라 목록에서 빠진다), `verification` 도 여기에 없다(위키 문서에 따로 기술된다).
> - API `property-object` 가 열거하는 타입 키: `checkbox, created_by, created_time, date, email, files, formula, last_edited_by, last_edited_time, multi_select, number, people, phone_number, place, relation, rich_text, rollup, select, status, title, unique_id, url` = **22종**. **`button` 과 `verification` 이 없다.**
> - 즉 **UI 타입 집합 ∆ API 타입 집합 = {title(UI 미열거)}, {button, verification}(API 미노출)** 이다. 클론에서는 "API 로 다룰 수 있는 타입"과 "UI 에서만 존재하는 타입"을 스키마 레벨에서 구분(`property.api_exposed boolean`)해 두는 편이 안전하다.
> - 초판이 적은 "헬프가 24종을 명시" 은 **오기였다** — 실제 열거 수는 22 다.
> API `property-object` 는 모든 프로퍼티에 `id` / `name` / **`description`** / `type` + 타입별 config 를 정의한다. 즉 `description` 은 추정이 아니라 확인된 1급 필드다. (https://developers.notion.com/reference/property-object)

옵션 색상 enum: `default, gray, brown, orange, yellow, green, blue, purple, pink, red`

### rollup 집계 함수 전수

| 분류 | 함수 |
|---|---|
| 원본 표시 | `show_original`, `show_unique` |
| 개수 | `count`, `count_values`, `unique`, `empty`, `not_empty` |
| 비율 | `percent_empty`, `percent_not_empty`, `percent_checked`, `percent_unchecked` |
| 체크박스 | `checked`, `unchecked` |
| 숫자 | `sum`, `average`, `median`, `min`, `max`, `range` |
| 날짜 | `earliest_date`, `latest_date`, `date_range` |

> **검증 완료**: 위 22개는 `property-object` 문서의 `function` enum 전수와 **정확히 일치**한다("Values include: `average`, `checked`, `count`, `count_values`, `date_range`, `earliest_date`, `empty`, `latest_date`, `max`, `median`, `min`, `not_empty`, `percent_checked`, `percent_empty`, `percent_not_empty`, `percent_unchecked`, `range`, `show_original`, `show_unique`, `sum`, `unchecked`, `unique`"). 반면 헬프센터 `relations-and-rollups` 는 이보다 적은 수만 UI 관점에서 설명한다 — **API enum 을 정본으로 삼아라.**

### 알려진 한도

| 항목 | 값 | 출처 |
|---|---|---|
| 프로퍼티 수 / database | 500 | https://www.notion.com/help/database-properties |
| select / multi-select 옵션 수 | 무제한(문서상) | 동일 |
| 1,000개 초과 시 신규 페이지 위치 | 끝이 아니라 중간에 삽입될 수 있음 | https://www.notion.com/help/intro-to-databases |
| unique ID prefix | 영숫자 2~7자, 대소문자 무시(항상 대문자 표시), 워크스페이스 내 DB 간 중복 불가 | https://www.notion.com/help/unique-id `[확인필요: 2~7자 범위는 헬프 본문에 명시되지 않아 2차 출처 근거]` |
| button 알림 수신자 | 최대 20명 | https://www.notion.com/help/database-buttons |
| **formula/rollup 참조 체인 깊이** | **15** (2024-08 이전 7). formula 가 다른 formula 또는 rollup 을 참조할 때마다 1 레이어 소모 | **1차 출처 확보(2026-09-06)**: https://www.notion.com/help/common-formula-errors — `Notion formulas can only be 15 layers deep. Every time a formula references another formula or rollup, it adds a layer.` / 7→15 상향 시점(2024-08)과 "초과 시 무경고" 는 여전히 2차 출처: https://thomasjfrank.com/formulas/property-reference-limits/ |
| 자동화 트리거 판정 윈도우 | 약 3초 | https://www.notion.com/help/database-automations |
| 자동화 → 자동화 연쇄 | **불가** ("Database automations can't be triggered by other automations") | 동일 |
| 자동화 알림 수신자 | 최대 20명 | 동일 |
| 페이지 레이아웃 헤딩 영역 고정 프로퍼티 | 최대 15개 | https://www.notion.com/help/layouts |
| 데이터베이스 템플릿 중첩 | 최대 3단계. **일간 반복 템플릿은 중첩 템플릿을 포함할 수 없다**(주/월/년 반복만 가능) | https://www.notion.com/help/database-templates |
| API 필터 compound 중첩 | 2단계까지 | https://developers.notion.com/reference/post-database-query-filter |
| API 페이지네이션 | 응답당 최대 100건. 블록 트리의 **모든 레벨**에 동일 적용 | https://developers.notion.com/reference/request-limits |
| API 레이트 리밋 | 커넥션당 평균 3 req/s (버스트 허용), 워크스페이스 한도는 플랜별. 초과 시 HTTP 429 `rate_limited` | 동일 |
| **API 쿼리 페이지네이션 최대 깊이** | **10,000건**. 초과 시 응답에 `request_status: {type:"incomplete"}` | https://developers.notion.com/page/changelog (2026-04-20) |
| map view 동시 표시 핀 수 | **100개**. 초과분은 필터/뷰 분할로 나눠야 함 | https://www.notion.com/help/maps |
| verification 만료 알림 | 만료 시 **Owner** 에게 Notion 인박스 + 이메일 알림. Business/Enterprise 전용 | https://www.notion.com/help/wikis-and-verified-pages |
| status 그룹 수 | **3개 고정**("You can't change the three main categories") | https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks |
| 헬프 열거 프로퍼티 타입 수 / API 노출 타입 수 | **22 / 22** (교집합 20, 차집합은 위 전수표 주석 참조) | 두 문서 대조(2026-09-06) |

---

## 기능 명세

### F-03-01 데이터베이스 = 페이지 컬렉션 (database / data source / page 3계층)

- **한 줄 정의**: 사용자가 "표"라고 인식하는 대상은 실제로는 공통 스키마를 공유하는 페이지들의 집합이며, 각 행은 열어서 본문을 쓸 수 있는 완전한 페이지다.
- **사용자 시나리오**:
  1. 페이지 본문에서 `/table` 입력 → 인라인 데이터베이스 생성. 기본 프로퍼티는 title 1개(+ 노션은 기본으로 몇 개를 더 붙임 `[확인필요]`).
  2. 행에 마우스를 올리면 좌측에 `⤢ 열기` 버튼이 나타남 → 클릭 시 해당 행이 **페이지 피어(peek) 모달**로 열림.
  3. 모달 상단에 프로퍼티 목록, 하단에 자유 블록 편집 영역.
  4. `···` → `전체 페이지로 전환` 하면 인라인 DB가 독립 페이지가 됨.
- **동작 상세**:
  - database 는 컨테이너, data source 는 스키마 + 행 집합. 한 database 에 data source 를 여러 개 붙일 수 있고 view 는 database 레벨에 존재한다.
  - 행 페이지는 `parent = data_source_id`. 행을 삭제하면 페이지 전체가 휴지통으로 이동한다.
  - 인라인 DB는 부모 페이지의 블록으로 존재하고, 전체 페이지 DB는 사이드바 항목이 된다. 둘은 상호 변환 가능하다 (`is_inline` 토글).
  - 위키(wiki)는 multi data source 를 지원하지 않는다.
  - **[2026 갱신] typed database 개념이 추가되었다.** 2026-09-02 부터 `Create a database` 가 선택적 `database_type` 파라미터(`"tasks"` / `"projects"` / `"skills"`)를 받고, database·data_source 객체가 **읽기 전용 `database_type` 필드**를 노출한다(`initial_data_source` 와 동시 사용 불가). 즉 노션은 데이터베이스에 **의미론적 종류 태그**를 붙이기 시작했다 — 프로젝트/작업 전용 자동화·AI 동작을 분기하기 위한 것으로 보인다 `[추정]`. 클론 스키마에 `database.kind text NULL` 을 미리 비워 두면 나중에 확장이 공짜다. (https://developers.notion.com/page/changelog)
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 DB | 헤더(프로퍼티 행)만 표시, "새로 만들기" 행 1개 |
  | 행 페이지를 DB 밖으로 이동 | data_source_id 가 끊기며 프로퍼티 값이 사라짐. 노션은 경고 표시 `[확인필요]` |
  | 부모 페이지 삭제 (인라인 DB) | DB와 모든 행이 함께 휴지통으로 |
  | 1,000행 초과 | 신규 행이 목록 끝이 아닌 중간에 나타날 수 있음(공식 명시) |
  | 동시 편집 | 서로 다른 셀 = 충돌 없음. 같은 셀 = LWW 또는 CRDT 필요 |
  | 권한 없음 | DB는 보이되 행 페이지 접근 차단 시 제목만 표시 `[추정]` |
- **데이터 모델 함의**: 위 `database` / `data_source` / `page` 테이블. 핵심은 **page 가 block 테이블을 상속(또는 참조)** 한다는 점 — 행은 블록 트리의 루트이기도 하다. 별도의 "row" 개념을 만들면 안 된다.
- **UI/인터랙션**: 행 hover 시 `⤢ 열기` / `⋮⋮` 드래그 핸들 노출. 행 우클릭 → 삭제 / 복제 / 위·아래 삽입 / 링크 복사 / 다른 DB로 이동. `Esc` 로 peek 모달 닫기.
- **의존 기능**: 블록 시스템(도메인 01), 페이지 트리, 권한 모델.
- **구현 난이도**: **L** — 페이지와 행을 같은 엔티티로 묶는 설계가 전체 아키텍처를 규정하므로 되돌리기 비용이 크다.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: MVP에서는 database:data_source 를 1:1 로 고정하고 UI에서 data source 개념을 숨긴다. 스키마 테이블만 분리해 둔다.
- **참고 출처**: https://www.notion.com/help/intro-to-databases , https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03

---

### F-03-02 프로퍼티 스키마 관리 (추가 / 이름변경 / 삭제 / 순서 / 설명 / 표시)

- **한 줄 정의**: data source 의 컬럼 정의를 추가·수정·삭제·재정렬한다.
- **사용자 시나리오**:
  1. 표 우측 끝 `+` 클릭 → 타입 선택기 팝오버 → 타입 선택 → 이름 입력.
  2. 컬럼 헤더 클릭 → `속성 편집` → 이름, 타입, 설명, 타입별 옵션 편집.
  3. 헤더 드래그로 컬럼 순서 변경. 헤더 경계 드래그로 폭 조절.
  4. 헤더 메뉴 → `숨기기` / `복제` / `삭제`.
- **동작 상세**:
  - 신규 프로퍼티 기본 타입은 `rich_text`(텍스트) `[확인필요]`. 기본 이름은 "속성 N" 형태.
  - `title` 프로퍼티는 삭제 불가, 다른 타입으로 변경 불가, 다른 프로퍼티를 title 로 변경 불가. (API 문서 명시: "Every data source has exactly one `title` property. Its type cannot be changed to something else, and no other property can be changed to `title`.")
  - 프로퍼티 삭제 = 해당 컬럼의 모든 셀 값 삭제. 노션은 일정 기간 내 `삭제된 속성 복원` 을 제공한다 `[확인필요: 기간 미확인]`.
  - API 에서 프로퍼티 삭제는 해당 키를 `null` 로 PATCH.
  - **[정정]** 초판은 프로퍼티 표시 상태를 "항상 표시 / 값 있을 때만 표시 / 항상 숨김" 3단계로 서술했으나, **현행 헬프 문서에서 이 3단계 enum 은 확인되지 않는다.** 현재 문서화된 모델은 **페이지 레이아웃 빌더**다: 프로퍼티마다 눈(👁️) 아이콘으로 표시/숨김을 토글하고, 배치 영역을 **헤딩(최대 15개 고정) / 본문 모듈 / 우측 상세 패널** 중에서 고른다(relation 등 일부 타입은 상세 패널로 옮길 수 없다). 레이아웃은 `모든 페이지에 적용`으로 데이터베이스 전체에 일괄 적용된다. 즉 표시 규칙은 **boolean visible + placement enum** 의 조합이지 3단계 enum 이 아니다. (https://www.notion.com/help/layouts) `[확인필요: 구 UI의 "값이 있을 때만 표시"가 지금도 남아 있는지 — 현행 문서에는 조건부 표시 기능이 없다고 보는 편이 안전하다]`
  - 뷰의 컬럼 표시/숨김은 여전히 view 레벨 설정으로 별개다.
  - 프로퍼티 순서(`order_idx`)도 스키마 레벨이고, 뷰별 컬럼 순서는 view 레벨에서 덮어쓴다 `[추정]`.
  - **프로퍼티 "기본값" 설정은 존재하지 않는다.** 신규 행의 초기 프로퍼티 값은 오직 데이터베이스 템플릿(F-03-21)으로만 지정한다. 클론에서 `property.config.default_value` 를 추가하는 것은 노션 대비 순증 기능이며, 추가한다면 **템플릿과 기본값 중 어느 쪽이 우선인지**를 먼저 정의해야 한다.
  - 데이터베이스가 **잠금(lock) 상태**면 프로퍼티 추가/변경/삭제가 차단된다(값 입력은 계속 가능). F-03-22 참조.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 이름 중복 | 노션 UI는 중복 이름을 허용하는 것으로 보임 `[확인필요]`. formula 의 `prop("이름")` 해석이 모호해지므로 클론에서는 **금지 권고** |
  | 이름만 변경 | 셀 값 유지. formula/rollup 참조는 property **id** 기준이므로 깨지지 않아야 한다 |
  | 다른 프로퍼티가 참조 중인 프로퍼티 삭제 | 참조하는 formula/rollup 은 에러 상태로 전환 |
  | title 삭제 시도 | 거부 |
  | 500개 초과 | 추가 거부 |
  | 동시에 두 명이 같은 프로퍼티 편집 | 스키마는 셀보다 충돌 비용이 크다. 스키마 변경은 **서버 직렬화 + 낙관적 잠금(version)** 권고 |
- **데이터 모델 함의**: `property` 테이블 + `order_idx` fractional index. 스키마 변경마다 `data_source.schema_version` 을 증가시키고 클라이언트가 stale 스키마로 쓰는 것을 막는다. 프로퍼티 삭제는 **soft delete** (`deleted_at`) 로 두어 복원과 undo를 지원한다.
- **UI/인터랙션**: 헤더 드래그 재정렬, 헤더 더블클릭 → 이름 인라인 편집, 컬럼 폭 리사이즈 핸들, 컬럼 헤더 컨텍스트 메뉴(오름/내림 정렬, 필터 추가, 좌/우 삽입, 고정(freeze), 줄바꿈(wrap)).
- **의존 기능**: F-03-01. F-03-22(잠금/권한)가 이 기능의 실행 가능 여부를 게이팅한다.
- **구현 난이도**: **M~L** — CRUD 자체는 단순하나 순서·표시·soft delete·스키마 버전 관리가 붙고, 스키마 변경이 **F-03-13 의존성 그래프 재검증**과 **F-03-14 마이그레이션 잡**을 동시에 트리거하기 때문에 실질 비용은 M 을 넘는다. 초판의 **M 은 과소평가**.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: 프로퍼티 복원 기능은 v2로 미루고, MVP는 soft delete + "실행 취소" 만 제공.
- **참고 출처**: https://developers.notion.com/reference/update-property-schema-object , https://www.notion.com/help/database-properties

---

### F-03-03 기본 스칼라 프로퍼티군 (title / text / number / checkbox / url / email / phone)

- **한 줄 정의**: 검증·표시 규칙만 다른 단순 값 타입 7종.
- **사용자 시나리오**: 셀 클릭 → 인라인 입력 → `Esc` 또는 셀 밖 클릭으로 확정. `Tab` 으로 우측 셀, `Enter` 로 아래 셀 이동.
- **동작 상세**:
  | 타입 | 입력 검증 | 표시 | 빈 값 |
  |---|---|---|---|
  | title | rich text 허용, 빈 문자열 허용 | 페이지 링크로 렌더, 빈 경우 "제목 없음" | `""` |
  | rich_text | 인라인 볼드/이탤릭/코드/링크/멘션 허용 | 셀 내 서식 유지 | `[]` |
  | number | 숫자만. 파싱 실패 시 입력 거부 또는 이전값 복원 | format 에 따라 `1,234` / `12%` / `$1,234` / 막대(bar)·원형(ring) 게이지 | `null` |
  | checkbox | 토글만 | 체크박스 | `false` (null 없음) |
  | url | 문자열 자유 입력. 검증 느슨 `[추정]` | 클릭 시 새 탭 | `null` |
  | email | 문자열 자유 입력 | 클릭 시 메일 클라이언트 | `null` |
  | phone_number | 문자열 자유 입력 | 클릭 시 전화 앱 | `null` |
  - **[해소됨 2026-09-06] number 의 percent 포맷은 저장값이 0~1 의 소수다.** `0.5` 를 입력하면 `50%` 로 표시되고, `50` 을 입력하면 `5000%` 로 표시된다. 즉 percent 는 **표시 포맷일 뿐이고 formula·rollup·필터는 항상 원시 소수값을 본다.** `[2차 출처 2건 교차 확인: https://notiondemy.com/calculate-percentage-notion/ , https://wisechecker.com/notion-number-property-format-currency-percent-bar/ — 공식 헬프에는 이 저장 규약이 명시되어 있지 않다]`
    → **클론 설계 결정**: `page_property_value.num_value` 에는 항상 소수 원본을 저장하고, `config.format='percent'` 는 렌더 계층에서만 ×100 한다. 입력 파서에서 사용자가 `50%` 라고 타이핑하면 0.5 로, `50` 이라고 타이핑하면 50 으로 해석해야 노션과 동일하다(이 비대칭이 사용자 오해 1위 지점이므로 입력 힌트를 띄워라).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | number 에 `1e400` 등 오버플로 | IEEE754 double 범위 초과 → `Infinity` 방지, 입력 거부 권고 |
  | number 에 통화 기호 붙여 붙여넣기 (`$1,200`) | 기호·콤마 제거 후 파싱 시도 `[추정]` |
  | url 에 스킴 없는 `example.com` | 클릭 시 `https://` 자동 부착 `[추정]` |
  | 매우 긴 rich_text | 셀은 wrap 설정에 따라 1줄 말줄임 또는 여러 줄 |
  | checkbox 의 null | 존재하지 않음. 미설정 = false |
  | 대량 붙여넣기 (스프레드시트에서 100행 복사) | 행 자동 생성 + 타입별 파싱 |
  | 동시편집: 두 사용자가 같은 number 셀 수정 | 스칼라 값은 LWW(서버 타임스탬프 기준). 셀 단위 버전을 응답에 실어 클라이언트가 stale 낙관적 업데이트를 되돌릴 수 있게 한다 |
  | 동시편집: 같은 rich_text 셀을 두 사용자가 편집 | LWW 면 타이핑이 통째로 사라진다. rich_text 셀만 **블록 본문과 동일한 CRDT/OT 경로**를 태우는 것이 정답 |
  | 권한: 행 읽기는 되나 쓰기 권한 없음 | 셀이 편집 모드로 진입하지 않고 읽기 전용 커서. **낙관적 로컬 반영도 하면 안 된다**(서버 거부 시 값이 되돌아가 깜빡인다) |
  | 대용량: 10만 행 뷰에서 number 컬럼 합계 표시 | 클라이언트 집계 불가. 서버 집계 + 필터 조건 동일 적용 |
  | 삭제된 참조: title 이 빈 행을 relation 이 가리킴 | 칩에 "제목 없음" 표시. 빈 문자열이 참조 무결성을 깨뜨리면 안 된다 |
- **데이터 모델 함의**: `page_property_value.value` 에 판별 유니온으로 저장.
  ```json
  {"type":"number","number":1234}
  {"type":"checkbox","checkbox":true}
  {"type":"rich_text","rich_text":[{"type":"text","text":{"content":"..."},"annotations":{...}}]}
  ```
  `number` 는 정확한 통화 계산을 위해 `numeric` 컬럼 별도 저장(정렬/집계 인덱스용)을 권고한다. `config` 에 `{"format":"won"}`.
- **UI/인터랙션**: `Tab`/`Shift+Tab` 셀 이동, `Enter` 편집 진입·확정, `Esc` 취소, `Space` 로 checkbox 토글, 셀 우하단 드래그로 채우기(fill-down) `[확인필요: 노션 지원 여부]`, `Ctrl/Cmd+C/V` 로 셀 범위 복사.
- **의존 기능**: F-03-01, F-03-02.
- **구현 난이도**: **S** (checkbox/url/email/phone), **M** (number 포맷 + rich_text 셀 에디터).
- **우선순위**: **P0**
- **클론 시 현실적 대안**: number format 은 MVP에서 `number`, `percent`, 통화 3종만. 게이지(bar/ring) 표시는 P2.
- **참고 출처**: https://www.notion.com/help/database-properties , https://developers.notion.com/reference/property-object

---

### F-03-04 select / multi-select (옵션 레지스트리)

- **한 줄 정의**: 프로퍼티에 소속된 옵션 목록에서 하나(select) 또는 여럿(multi-select)을 고른다.
- **사용자 시나리오**:
  1. 셀 클릭 → 팝오버 열림 → 검색창 + 기존 옵션 목록.
  2. 텍스트 입력 → 일치 옵션 필터링 + `"XXX" 생성` 항목 표시 → 클릭 시 **옵션이 스키마에 추가되고 동시에 셀에 할당**된다.
  3. multi-select 는 선택 후 팝오버 유지, 칩 좌측 `x` 또는 `Backspace` 로 제거.
  4. 팝오버 내 옵션 `···` → 이름 변경 / 색상 변경 / 삭제.
- **동작 상세**:
  - 옵션은 `{id, name, color}`. **셀은 옵션 id 를 참조**한다 (이름 문자열이 아님).
  - 옵션 이름 변경 시 그 옵션을 쓰는 모든 셀 표시가 함께 바뀐다. (id 참조이므로 자동)
  - 신규 옵션 색상은 팔레트에서 자동 배정된다 `[추정: 랜덤 또는 라운드로빈]`.
  - 옵션 삭제 시 그 옵션을 쓰던 셀은 빈 값이 된다.
  - **API 제약**: 기존 옵션의 name/color 는 API 로 변경할 수 없다 ("The name and color of an existing option cannot be updated"). 추가만 가능. UI 에서는 변경 가능하므로 **UI와 API의 능력이 다르다** — 클론에서는 통일 권고.
  - multi-select 셀 내 순서는 사용자가 선택한 순서로 보존된다 `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 동일 이름 옵션 2개 생성 시도 | 노션은 대소문자 구분 없이 중복을 막는 것으로 보임 `[확인필요]` |
  | 옵션 이름에 쉼표 포함 | multi-select 를 텍스트로 변환할 때 쉼표 조인이 깨진다 → 변환 경고 필요 |
  | 옵션 삭제 후 실행 취소 | 옵션 id 를 유지한 채 복원해야 셀 참조가 살아난다 → **옵션도 soft delete** |
  | 옵션 수백 개 | 팝오버 목록 가상 스크롤 필요 |
  | 동시편집: A가 옵션 생성, B가 같은 이름 옵션 생성 | 서버에서 이름 정규화 후 병합, 두 id 중 하나로 수렴 `[추정]` |
  | 필터가 참조하던 옵션 삭제 | 필터가 "삭제된 옵션" 상태가 되어 결과 0건 |
- **데이터 모델 함의**: `select_option` 테이블(위 스키마). 셀 값은
  ```json
  {"type":"select","select":{"id":"opt_..."}}
  {"type":"multi_select","multi_select":[{"id":"opt_a"},{"id":"opt_b"}]}
  ```
  multi-select 를 별도 조인 테이블(`page_option`)로 두면 "이 옵션을 쓰는 페이지" 역조회와 그룹핑이 빨라진다. **권고: multi-select 는 조인 테이블.**
- **UI/인터랙션**: 셀 진입 시 검색 포커스, `↑/↓` 이동, `Enter` 선택/생성, `Backspace`(빈 검색어) 로 마지막 칩 제거, 옵션 목록 드래그 재정렬.
- **의존 기능**: F-03-02.
- **구현 난이도**: **M** — 옵션 레지스트리 + 인라인 생성 + 색상 배정 + 참조 무결성.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: 옵션 드래그 재정렬은 P1. 색상은 고정 10색 팔레트 라운드로빈.
- **참고 출처**: https://developers.notion.com/reference/update-property-schema-object , https://www.notion.com/help/database-properties

---

### F-03-05 status (옵션 + 그룹 2계층)

- **한 줄 정의**: select 에 "그룹" 계층을 추가해, 임의 개수의 세부 상태를 To-do / In progress / Complete 세 범주로 묶는다.
- **사용자 시나리오**:
  1. 프로퍼티 타입 `상태` 선택 → 기본 옵션이 자동 생성됨: `Not started`(To-do), `In progress`(In progress), `Done`(Complete).
  2. 셀 클릭 → 팝오버가 그룹 헤더 3개로 구획되어 표시.
  3. 각 그룹 아래 `+ 상태 추가` 로 세부 상태 생성.
  4. 옵션을 드래그해 다른 그룹으로 이동 가능.
- **동작 상세**:
  - `status.options[]` = `{id, name, color}`, `status.groups[]` = `{id, name, color, option_ids[]}`.
  - 그룹은 **3개로 고정**되며 사용자가 그룹을 추가/삭제/이름변경할 수 없다. 헬프 원문: `You can't change the three main categories.` (https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks) → **초판의 `[확인필요: 그룹 이름 변경 가능 여부]` 는 해소됨: 불가.**
  - **status 는 노션에서 유일하게 "기본 옵션(default option)" 을 갖는 프로퍼티다.** 신규 행은 그 옵션을 자동으로 받으며, 기본 옵션이 지정되어 있는 동안에는 셀을 완전히 비울 수 없다(값 삭제 `x` 가 노출되지 않는다). 기본 지정을 해제해야 빈 값이 가능해진다. `[2차 출처: https://athena.outer-reaches.com/site/blog/2024/06/notion-status-property-no-defaults-empty/ — 공식 헬프에는 default option 서술이 없음]` → **F-03-21(템플릿=기본값)의 유일한 예외**이므로 클론 데이터 모델에 `property.config.default_option_id` 를 status 에만 허용하라.
  - **[2026 갱신]** API 지원 범위가 바뀌었다. 2026-03-19 부터 status 프로퍼티의 **생성·수정이 API 로 가능**해졌고(초기 옵션 지정 포함), 2026-06-22 부터 status **옵션 객체가 `group` 필드(`"To-do"` / `"In progress"` / `"Complete"`)를 받는다.** 기존 옵션의 name/color 를 API 로 변경할 수 없다는 제약은 여전히 `update-property-schema-object` 에 남아 있으나, 옵션 **추가**는 `Update data source` 로 가능하다. (https://developers.notion.com/page/changelog)
  - 보드 뷰에서 status 로 그룹핑하면 그룹(범주) 단위 또는 옵션 단위 컬럼을 만들 수 있다.
  - "완료" 판정(`Complete` 그룹 소속 여부)은 진행률 계산, 프로젝트 자동화의 기준이 된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 그룹에 옵션이 0개 | 그룹 헤더는 남고 목록만 비어 있음 |
  | 마지막 남은 옵션 삭제 | 허용. 셀은 빈 값 |
  | status 셀 빈 값 | **조건부.** 기본 옵션이 지정된 상태에서는 비울 수 없고, 기본 지정을 해제하면 셀에 `x` 가 나타나 비울 수 있다 `[2차 출처]`. 클론 불변식: `default_option_id IS NOT NULL` 이면 `value NOT NULL` 을 강제하고, 해제 시 기존 값은 유지하되 신규 행만 NULL 허용 |
  | select → status 변환 | 기존 옵션이 어느 그룹으로 갈지 결정 필요 → 전부 To-do 로 `[추정]` |
  | 옵션이 그룹 없이 존재 | 스키마 불변식 위반. 모든 옵션은 정확히 1개 그룹에 속해야 함 |
  | 동시편집: A가 옵션을 To-do → Complete 로 이동, B가 같은 옵션 삭제 | 스키마 변경 충돌. **스키마는 셀과 달리 서버 직렬화 + 버전 검사** 대상(F-03-02와 동일 정책) |
  | 동시편집: 두 사용자가 같은 행의 status 를 다른 값으로 | 단일 값 LWW. 단 `Complete` 그룹 진입 여부가 자동화/진행률을 트리거하므로 **최종 상태 1회만** 발화해야 한다 |
  | 권한: 상태 변경 권한은 있으나 옵션 추가 권한 없음 | 팝오버에서 `+ 상태 추가` 를 비활성. DB 잠금(F-03-22) 상태와 동일한 판정 경로 |
  | 삭제된 참조: 보드 뷰가 그룹핑 중인 옵션 삭제 | 해당 컬럼이 사라지고 행들이 "값 없음" 컬럼으로 이동. 뷰 설정의 컬럼 순서 배열에서도 제거 필요 |
  | 대용량: 옵션 200개 + 행 10만 | 그룹별 카운트 집계를 실시간 계산하면 무겁다 → 옵션별 행 수를 증분 카운터로 유지 |
- **데이터 모델 함의**: `select_option.group_id` + `status_group` 테이블. 불변식: `status` 타입 프로퍼티의 모든 option 은 `group_id NOT NULL`. `status_group.kind ENUM('todo','in_progress','complete')` 를 두면 진행률/자동화 규칙이 그룹 이름에 의존하지 않는다. **권고: kind 컬럼 필수.**
- **UI/인터랙션**: 팝오버 내 그룹 구획 헤더, 그룹 간 옵션 드래그, 셀에는 색 점 + 이름 표시(select 의 알약형 칩과 시각적으로 구분).
- **의존 기능**: F-03-04(옵션 레지스트리 재사용).
- **구현 난이도**: **M** — select 위에 그룹 계층과 불변식이 추가된다.
- **우선순위**: **P1** — MVP는 select 로 대체 가능. 다만 보드 뷰/진행률과 결합할 계획이면 P0로 올린다.
- **클론 시 현실적 대안**: `select` 에 `group_id` 컬럼을 미리 두고, status 는 "그룹이 강제되는 select"로 구현한다 (별도 타입 코드 최소화).
- **참고 출처**: https://developers.notion.com/reference/property-object , https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks

---

### F-03-06 date (단일 / 범위 / 시간 / 타임존 / 리마인더)

- **한 줄 정의**: 하나의 날짜 또는 시작–종료 범위를 선택적 시간과 함께 저장한다.
- **사용자 시나리오**:
  1. 셀 클릭 → 달력 팝오버.
  2. 날짜 클릭 → `start` 설정.
  3. `종료일 포함` 토글 → 두 번째 날짜 선택 → `end` 설정.
  4. `시간 포함` 토글 → 시:분 입력 필드 노출.
  5. `리마인더` → 이벤트 시각 기준 오프셋 선택.
  6. 상단 텍스트 입력창에 `내일`, `다음 주 금요일` 같은 자연어 입력 → 파싱되어 날짜로 변환.
- **동작 상세**:
  - 저장 형태 `{start, end|null, time_zone|null}`. `time_zone` 은 시간 포함일 때만 의미가 있다.
  - 시간 미포함이면 값은 `YYYY-MM-DD` (날짜만). 포함이면 ISO8601.
  - 날짜 표시 포맷(월/일/년, 년/월/일, 상대 표기)과 12/24시간제는 프로퍼티 config 로 설정한다 `[확인필요: API에 노출 안 됨]`.
  - 캘린더/타임라인 뷰의 소스가 된다. 범위가 있으면 타임라인에서 바(bar)로 렌더된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | end < start | 입력 거부 또는 자동 스왑 `[확인필요]` |
  | 시간 포함 → 미포함 전환 | 시각 정보 손실 (경고 필요) |
  | 타임존 미지정 | 뷰어의 로컬 타임존으로 렌더 → **서로 다른 사용자에게 다른 날짜로 보일 수 있음** |
  | DST 경계 | 범위 길이 계산(`dateBetween`)이 24h 배수가 아님 |
  | 윤년 2/29 | `dateAdd(d, 1, "years")` 결과 정의 필요 (2/28 권고) |
  | 빈 값 | `null`. 캘린더 뷰에서 해당 행은 표시되지 않음 |
  | 동시편집: A는 캘린더에서 드래그로 날짜 이동, B는 셀에서 직접 입력 | 단일 값 LWW. 드래그는 연속 이벤트이므로 **드롭 시점에 1회만 커밋**하고 중간 상태는 로컬 프리뷰로만 |
  | 동시편집 + 종속 관계 자동 날짜 이동(F-03-18) | 사람의 수정과 시스템의 전파가 충돌한다. 권고: **사용자 편집이 항상 우선**, 전파는 편집 커밋 이후에 재실행 |
  | 권한: 읽기 전용 사용자가 타임라인 바를 드래그 | 드래그 핸들 자체를 렌더하지 않는다 |
  | 삭제된 참조: 캘린더 뷰가 기준으로 삼던 date 프로퍼티 삭제 | 뷰가 렌더 불가 상태 → 다른 date 프로퍼티로 폴백하거나 뷰를 "설정 필요" 상태로 표시. 행을 통째로 숨기면 데이터 소실로 오인된다 |
  | 대용량: 5만 행을 타임라인에 표시 | 기간 윈도우 기준 서버 필터 필수. `start_at`/`end_at` 범위 인덱스(GiST tstzrange) 고려 |
  | 리마인더가 붙은 행의 날짜가 자동화로 변경됨 | 예약된 알림을 취소·재예약해야 한다. 알림 스케줄은 날짜 값과 **트랜잭션으로 함께** 갱신 |
- **데이터 모델 함의**:
  ```sql
  -- 정렬/필터를 위해 jsonb 외에 파생 컬럼 권고
  start_at        timestamptz,
  end_at          timestamptz NULL,
  has_time        boolean NOT NULL DEFAULT false,
  time_zone       text NULL          -- IANA tz name
  ```
  `has_time = false` 인 값을 timestamptz 로 저장하면 타임존 이동 시 날짜가 밀린다. **날짜만인 경우 `date` 타입 별도 컬럼 또는 UTC 자정 고정 + has_time 플래그**로 처리하라.
- **UI/인터랙션**: 달력 그리드 키보드 이동, `Esc` 닫기, 셀 우클릭 → `지우기`, 타임라인 뷰에서 바 양끝 드래그로 start/end 조정, 캘린더에서 드래그로 날짜 이동.
- **의존 기능**: F-03-02. 캘린더/타임라인 뷰(도메인 04)가 이 프로퍼티에 의존.
- **구현 난이도**: **M** — 타임존과 has_time 조합이 버그의 온상.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: MVP는 자연어 파싱과 리마인더 제외, `{start, end, has_time}` 만. 타임존은 워크스페이스 단일 타임존으로 고정.
- **참고 출처**: https://www.notion.com/help/database-properties

---

### F-03-07 person / files & media / place

- **한 줄 정의**: 워크스페이스 구성원, 첨부 파일, 지리 위치를 셀 값으로 참조한다.
- **사용자 시나리오**:
  - **person**: 셀 클릭 → 멤버 검색 팝오버 → 이름/이메일 검색 → 선택. 그룹도 선택 가능. 태그된 사람에게 알림이 갈 수 있다 `[확인필요: 프로퍼티 태그가 알림을 발생시키는지]`.
  - **files**: 셀 클릭 → `파일 업로드` / `링크 임베드`. 드래그 앤 드롭 지원. 이미지면 썸네일, 그 외는 파일명 칩.
  - **place**: 셀 클릭 → 주소/장소명 검색 또는 `현재 위치 사용`. 선택 시 이름 + 정규화된 주소 + 위/경도가 저장된다. map view 의 소스.
- **동작 상세**:
  - person 셀은 **user id 참조**. 사용자가 워크스페이스를 떠나면 값은 유지되되 "비활성 사용자"로 표시된다 `[추정]`.
  - files 는 업로드 파일과 외부 URL이 같은 배열에 섞인다. 업로드 파일은 만료되는 서명 URL로 제공된다 (노션 API의 `file.url` 은 1시간 유효) `[확인필요: 현재 만료 시간]`.
  - place 는 외부 지오코딩 서비스에 의존한다. 공식 헬프는 제공자를 익명으로만 표기한다(`a third-party provider that processes your query`, `data quality and coverage may vary by region`). 저장 필드는 **이름 + 정규화 주소 + 위/경도**이며, 출처에 따라 **Google Place ID 또는 AWS Place ID** 를 함께 보관한다 `[2차 출처: https://notiontomaps.com/blog/notion-place-property-complete-guide]`.
  - **place 의 필터·정렬은 지리 연산이 아니라 텍스트 연산이다.** 헬프 원문: `Filtering and sorting for place properties is text-based. You can filter by text contained in the place's name or address, and sort alphabetically.` → **반경 검색·거리 정렬은 없다.** 클론에서 PostGIS 를 도입할 필요가 없다는 뜻이며, 이는 구현 난이도를 크게 낮춘다.
  - map view 는 **한 번에 최대 100개 핀**만 표시한다. 초과 시 필터나 뷰 분할로 줄여야 한다.
  - place 프로퍼티는 **API `property-object` 타입 목록에 정식으로 포함**되어 있다(2026-09-06 재확인). button/verification 과 달리 API 1급 타입이다. 다만 값 객체의 정확한 JSON 스키마는 레퍼런스에 상세 기술되어 있지 않다 `[확인필요]`.
  - 2026-08-13 부터 뷰 필터에서 place 필터가 지원된다(https://developers.notion.com/page/changelog).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 태그된 멤버가 DB 접근 권한 없음 | 이름은 보이되 알림/접근은 불가 |
  | 그룹을 person 셀에 넣고 그룹 삭제 | 값이 끊긴 참조가 됨 → soft 처리 필요 |
  | 파일 원본 삭제 | 셀에는 항목이 남지만 다운로드 실패 |
  | 대용량 파일 업로드 | 요금제별 업로드 한도 존재 `[확인필요]` |
  | 지오코딩 실패 / 오프라인 | place 값 미확정. 원문 텍스트 보존 필요 |
  | 같은 사람 2번 추가 | 중복 제거 |
  | 동시편집: 두 사용자가 같은 person 셀에 서로 다른 사람 추가 | **집합 값이므로 LWW 로 덮으면 한쪽이 사라진다.** relation 과 동일하게 **add/remove 오퍼레이션 단위로 병합**하라(2-phase set 또는 엣지 테이블 upsert) |
  | 동시편집: files 셀에 두 사용자가 동시 업로드 | 배열 append 병합. 업로드는 비동기이므로 낙관적 플레이스홀더 + 완료 시 교체 |
  | 권한: person 셀에 워크스페이스 외부 게스트 지정 | 목록에 노출할지 결정 필요. 권고: 해당 DB 에 접근 권한이 있는 사용자만 검색 결과에 노출 |
  | 권한: files 의 presigned URL 유출 | URL 만 알면 누구나 받을 수 있다 → 만료 시간 짧게 + **요청 시점 권한 검사 후 발급**(정적 공개 URL 금지) |
  | 삭제된 참조: file_asset 이 다른 페이지에서도 참조 중인데 한쪽에서 삭제 | 참조 카운트 기반 GC. 즉시 물리 삭제하면 다른 셀이 깨진다 |
  | 대용량: 한 셀에 파일 500개 | 목록 페이지네이션 + 썸네일 지연 로딩 |
  | place 제공자 API 키 만료/쿼터 초과 | 기존 저장값은 그대로 유효(좌표가 이미 저장됨). 신규 검색만 실패 → 사용자에게 명확한 오류 |
  | place: 지역에 따라 검색 품질이 다름 | 공식 문서가 인정하는 한계(`data quality and coverage may vary by region`). 클론은 **사용자 입력 원문(raw_query)을 반드시 함께 저장**해 재지오코딩이 가능하게 하라 |
  | place: 100개 초과 행을 map view 로 볼 때 | 서버가 상위 100건만 반환. **어떤 100건인지(정렬 기준)를 반드시 정의**해야 한다. 임의 100건이면 사용자는 데이터가 사라졌다고 인식한다 |
  | place 를 정렬 키로 사용 | 알파벳(텍스트) 정렬만. 좌표 기반 정렬은 노션에 없으므로 클론도 굳이 만들지 마라 |
- **데이터 모델 함의**:
  ```sql
  -- person: 조인 테이블 권고 (역조회 "내가 담당인 항목")
  CREATE TABLE page_person (page_id uuid, property_id uuid, user_id uuid, order_idx text,
                            PRIMARY KEY (page_id, property_id, user_id));
  -- files: 파일 엔티티 참조
  CREATE TABLE file_asset (id uuid PK, storage_key text, name text, mime text, size bigint, uploaded_by uuid);
  -- place: 값 형태
  -- {"name":"...","address":"...","lat":37.5,"lng":127.0,"provider":"google","provider_place_id":"..."}
  ```
- **UI/인터랙션**: person 팝오버 검색, 아바타 스택 표시. files 드래그 앤 드롭 + 붙여넣기 업로드. place 는 검색 결과 목록 + 미니 지도 미리보기.
- **의존 기능**: 사용자/그룹 모델(도메인: 권한), 파일 스토리지.
- **구현 난이도**: person **S**, files **M**(스토리지·서명 URL·용량 제한), place **S~M** — **하향 조정(2026-09-06)**: 노션의 place 는 필터·정렬이 전부 텍스트 기반이고 지리 연산이 없으므로 공간 인덱스(PostGIS)가 불필요하다. 남는 비용은 외부 지오코딩 API 키·쿼터·비용뿐이다.
- **우선순위**: person **P0**, files **P1**, place **P2**.
- **클론 시 현실적 대안**: files 는 S3 호환 스토리지 + presigned URL. place 는 MVP에서 제외하고, 필요 시 무료 Nominatim(OSM) 지오코딩으로 대체(레이트 리밋 주의).
- **참고 출처**: https://www.notion.com/help/database-properties , https://www.notion.com/help/maps

---

### F-03-08 자동 메타 프로퍼티 (created_time / created_by / last_edited_time / last_edited_by)

- **한 줄 정의**: 페이지의 생성·최종수정 시각과 주체를 시스템이 자동 기록하는 읽기 전용 프로퍼티.
- **사용자 시나리오**: 프로퍼티 추가 → `생성 일시` 등 선택 → 즉시 모든 기존 행에 값이 채워진다. 셀은 클릭해도 편집되지 않는다.
- **동작 상세**:
  - 값은 프로퍼티 추가 시점이 아니라 **페이지 자체의 메타데이터**에서 읽는다. 그래서 과거에 만든 행도 정확한 생성 시각을 갖는다. → **프로퍼티 값을 저장하지 말고 page 행에서 투영(projection)해야 한다.**
  - `last_edited_time` 갱신 트리거 범위가 관건이다. 노션은 **페이지 본문 블록 편집과 프로퍼티 값 변경 모두**에서 갱신되는 것으로 보인다 `[확인필요: 하위 페이지 편집이 부모 행을 갱신하는지]`.
  - 파생 프로퍼티(formula/rollup) 재계산은 `last_edited_time` 을 갱신시키지 **않아야** 한다. 갱신시키면 rollup ↔ last_edited 간 무한 루프가 생긴다. `[추정]`
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 같은 프로퍼티를 2개 추가 | 허용됨. 둘 다 같은 값 표시 |
  | 페이지 복제 | 복제본의 created_time 은 복제 시각, created_by 는 복제한 사람 |
  | 가져오기(import) | created_time 이 원본 아닌 import 시각이 됨 |
  | 삭제된 사용자 | created_by 는 과거 사용자 id 유지, 이름은 "삭제된 사용자" |
  | API 로 값 쓰기 시도 | 거부 (읽기 전용) |
  | 시계 역행 / 서버 시간 불일치 | 서버 시각 단일 소스 사용 |
- **데이터 모델 함의**: 별도 셀 저장 없음. `property.type IN ('created_time','created_by','last_edited_time','last_edited_by')` 이면 쿼리 시 `page.created_at` / `page.created_by` / `page.edited_at` / `page.edited_by` 를 매핑한다. 정렬·필터도 이 컬럼에 직접 건다(인덱스 유리).
- **UI/인터랙션**: 셀 hover 시 편집 불가 커서. 헤더 메뉴에 옵션 편집 항목이 거의 없다(날짜 포맷만).
- **의존 기능**: F-03-01, 사용자 모델.
- **구현 난이도**: **S~M** — 투영 자체는 S 다. 그러나 `last_edited_time` 은 **쓰기 증폭의 진원지**다: 셀 1개 수정 → page.edited_at UPDATE → 이 프로퍼티로 정렬 중인 모든 뷰의 실시간 재정렬 브로드캐스트가 연쇄한다. 대량 import·자동화·파생값 재계산이 이 컬럼을 건드리지 않도록 **쓰기 경로별 갱신 여부를 화이트리스트로 명시**해야 하므로 M 쪽에 가깝다. 초판의 단순 **S 는 과소평가**.
- **우선순위**: **P0**
- **클론 시 현실적 대안**:
  1. 4종 모두 **저장하지 않고 `page` 테이블에서 투영**한다. `page_property_value` 에 행을 만들면 안 된다(스토리지 4배 + 정합성 문제).
  2. `last_edited_time` 갱신 경로를 **화이트리스트**로 명시한다. 권고 초기값: 셀 값 사용자 편집 ✅ / 본문 블록 편집 ✅ / **파생값 재계산 ❌ / 자동화·AI 쓰기 ❌(설정 가능) / 하위 페이지 편집 ❌**. 노션 실동작은 미확인이므로 **설정으로 빼두고 기본값을 보수적으로** 잡는 편이 안전하다.
  3. 이 컬럼으로 정렬하는 뷰가 있으면 갱신마다 재정렬 브로드캐스트가 나간다. MVP 에서는 **재정렬 브로드캐스트를 200ms 디바운스**로 묶어라.
  4. 표시 포맷(상대 시간 "3분 전" vs 절대 시각)은 클라이언트 렌더 옵션으로만 두고 서버는 항상 UTC ISO8601 을 준다.
- **참고 출처**: https://developers.notion.com/reference/property-object , https://www.notion.com/help/database-properties

---

### F-03-09 unique ID (접두사 + 자동 증가 번호)

- **한 줄 정의**: 각 행에 `PREFIX-123` 형태의 사람이 읽을 수 있는 영구 식별자를 자동 부여한다.
- **사용자 시나리오**:
  1. 프로퍼티 추가 → `ID` 선택.
  2. 기존 모든 행에 1부터 순서대로 번호가 부여된다.
  3. `속성 편집` → 접두사 입력(기본값은 팀스페이스/DB 이름에서 자동 생성).
  4. 이후 생성되는 행은 마지막 번호 + 1 을 받는다.
  5. `notion.so/TASK-123` 으로 해당 페이지에 바로 접근 가능(접두사가 있어야 동작).
- **동작 상세**:
  - "Unique ID numbers always start at 1 and are assigned to every page, including deleted pages. ID numbers will never change." — 번호는 **1부터 시작, 삭제된 페이지도 번호를 소비, 재사용 없음, 변경 불가**.
  - 값은 `{prefix, number}` 이며 표시 문자열은 `PREFIX-NUMBER`. 접두사가 없으면 숫자만 표시.
  - 접두사는 대소문자를 구분하지 않고 항상 대문자로 표시되며, 워크스페이스 내에서 다른 DB와 중복될 수 없다. **영숫자 2~7자** — 2026-09-06 재검색에서 독립된 2차 출처 2건(https://notionthings.com/2023/05/19/notion-native-unique-task-ids/ , https://www.landmarklabs.co/notion-tutorials/notion-unique-id)이 동일한 수치를 보고했다. 다만 공식 헬프 본문에는 여전히 길이 제약 문구가 없다 `[확인필요: 1차 미확인, 2차 교차확인 완료]`
  - 읽기 전용. 사용자가 값을 지정할 수 없다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 행 삭제 후 새 행 생성 | 번호 재사용 없음 → 시퀀스에 구멍 |
  | 삭제 행 휴지통에서 복원 | 원래 번호 그대로 복원 |
  | ID 프로퍼티 삭제 후 재추가 | **번호가 1부터 다시 부여되는지, 이전 번호를 기억하는지** `[확인필요]`. 클론 권고: `page.unique_seq` 를 페이지에 영속화하여 재추가 시 복원 |
  | DB 복제 | 복제본은 자체 시퀀스를 새로 시작하며 접두사는 중복 불가이므로 변경 필요 `[확인필요]` |
  | 동시 생성 2건 | 번호 충돌 금지 → DB 시퀀스 또는 원자적 카운터 필수 |
  | 접두사 변경 | 표시가 전부 바뀌고 기존 `OLD-1` URL 은 깨진다 |
  | 대량 import 10만 건 | 배치 번호 예약(카운터를 N만큼 한 번에 증가) 필요 |
- **데이터 모델 함의**:
  ```sql
  ALTER TABLE data_source ADD COLUMN unique_id_counter bigint NOT NULL DEFAULT 0;
  ALTER TABLE page        ADD COLUMN unique_seq bigint;   -- 페이지에 영속. 프로퍼티 삭제해도 유지
  CREATE UNIQUE INDEX ON page (data_source_id, unique_seq);
  -- 접두사는 property.config = {"prefix":"TASK"}
  CREATE UNIQUE INDEX ON property ((config->>'prefix')) WHERE type='unique_id';  -- 워크스페이스 범위면 workspace_id 포함
  ```
  번호 발급은 `UPDATE data_source SET unique_id_counter = unique_id_counter + 1 RETURNING unique_id_counter` 로 원자화한다. 애플리케이션 레벨 `MAX(seq)+1` 은 동시성에서 반드시 깨진다.
- **UI/인터랙션**: 셀은 읽기 전용 텍스트. 우클릭 → `ID 복사` / `링크 복사`. 페이지 상단에도 ID 를 표시한다 `[확인필요]`.
- **의존 기능**: F-03-01, F-03-02.
- **구현 난이도**: **M** — 로직은 단순하지만 동시성·복원·프로퍼티 재추가 시나리오가 함정이다.
- **우선순위**: **P1** — MVP 없이도 동작하나, 이슈 트래커류 클론이면 P0.
- **클론 시 현실적 대안**: `notion.so/TASK-123` 같은 전역 단축 URL 라우팅은 P2로 미룬다. 번호 발급만 우선.
- **참고 출처**: https://www.notion.com/help/unique-id , https://developers.notion.com/reference/property-object

---

### F-03-10 relation (단방향 / 양방향 / 자기참조)

- **한 줄 정의**: 한 data source 의 페이지를 다른(또는 같은) data source 의 페이지들과 연결한다.
- **사용자 시나리오**:
  1. 프로퍼티 추가 → `관계형` 선택 → 대상 데이터베이스 검색·선택.
  2. `[대상 DB]에 표시` 토글: **끄면 단방향**, 켜면 양방향이며 대상 DB 에 역방향 프로퍼티 이름을 입력한다.
  3. `관계 추가` 클릭으로 확정.
  4. 셀 클릭 → 대상 DB 페이지 검색 팝오버 → 선택. `+ 새 페이지` 로 대상 DB 에 새 행을 만들며 동시에 연결.
  5. 셀의 칩을 클릭하면 대상 페이지가 peek 모달로 열린다.
- **동작 상세**:
  - 기본값은 **단방향(one-way)**. 양방향은 명시적으로 켜야 한다.
  - 양방향이면 한쪽에서 연결을 추가/삭제하면 반대쪽에 즉시 반영된다.
  - 자기참조(self-relation) 가능: 같은 DB 를 대상으로 지정. 이때 (a) 하나의 프로퍼티로 양방향 동작 또는 (b) 두 개의 프로퍼티로 방향 분리("이전 작업" / "다음 작업") 를 선택할 수 있다.
  - 관계 개수 제한 설정: `1 페이지` 또는 `제한 없음` — 헬프 원문 확인됨("choose to limit the number of pages that can be included in your relations property – with the option to select `1 page` or to have `No limit`").
  - 자기참조는 **프로퍼티 1개로 양방향 동작**이 기본이다("With one property, the relation operates bidirectionally — adding Task B to Task A also shows Task A in Task B"). 양방향을 켜면 방향별로 **별도 프로퍼티 2개**가 생긴다.
  - **relation 은 파생값 참조 체인의 한 단계로 계산된다.** rollup/formula 가 relation 을 타고 다른 DB 값을 읽으면 체인 깊이가 소모되며, 총 15단계를 넘으면 조용히 실패한다(F-03-12 참조).
  - 노션 헬프 `relations-and-rollups` 는 **연결된 페이지 삭제 / relation 프로퍼티 삭제 시 동작을 전혀 문서화하지 않는다.** 아래 엣지 케이스는 전부 클론 측 설계 결정이며 노션 동작과 일치한다는 보장이 없다 `[확인필요]`.
  - API 상 `single_property`(단방향) vs `dual_property`(양방향, `synced_property_id`/`synced_property_name` 포함).
  - 단방향 ↔ 양방향 전환은 UI 에서 가능하다 `[확인필요: 전환 시 기존 엣지 보존 여부 — 보존되는 것으로 추정]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 연결된 페이지 삭제(휴지통) | 엣지가 사라진 것처럼 보이고, 복원 시 되살아나야 함 → **엣지도 soft delete 또는 page.deleted_at 로 필터** |
  | 연결된 페이지 영구 삭제 | 엣지 물리 삭제 |
  | 양방향 relation 의 한쪽 프로퍼티 삭제 | 반대쪽도 함께 삭제되는지 / 단방향으로 강등되는지 `[확인필요]`. 클론 권고: **단방향으로 강등**하고 엣지 보존 |
  | 대상 DB 자체 삭제 | 프로퍼티가 "끊긴 관계" 상태. 이 프로퍼티를 참조하는 rollup 은 에러 |
  | `1 페이지` 제한 설정 후 2개 이상 연결된 기존 셀 | 기존 값 유지 + 신규 입력만 제한 `[추정]` |
  | 순환 참조 (A→B→A) | relation 자체는 순환 허용. 문제는 rollup/formula 가 이를 타고 순환할 때 |
  | 자기 자신을 연결 | 허용됨 `[확인필요]` |
  | 권한 없는 DB 로의 relation | 칩은 보이되 제목이 가려짐 `[추정]` |
  | 한 셀에 수천 개 연결 | 셀 렌더는 상위 N개 + "+N개 더". 로딩 성능 주의 |
- **데이터 모델 함의**: `relation_edge` 테이블 (위 스키마). 핵심 설계 결정:
  - **양방향 relation 을 엣지 1행으로 표현할지, 2행으로 표현할지.** 권고: **엣지 1행 + `property.config.inverse_property_id`**. 역방향 조회는 `WHERE property_id = fwd AND to_page_id = X` 인덱스로 처리한다. 2행 복제는 동시성에서 반드시 불일치를 만든다.
  ```sql
  -- property.config 예시
  -- 단방향: {"target_data_source_id":"...","limit":"none"}
  -- 양방향: {"target_data_source_id":"...","inverse_property_id":"...","limit":"one"}
  ```
  - `order_idx` 로 셀 내 칩 순서를 보존한다.
- **UI/인터랙션**: 칩 드래그 재정렬, 칩 hover 시 `x`, 팝오버 검색 시 title 프로퍼티 기준 매칭, `+ 새 페이지` 인라인 생성, 셀 확장 시 전체 목록.
- **의존 기능**: F-03-01, F-03-02. rollup(F-03-11)과 formula 의 `map`/`filter`(F-03-12)가 이것에 의존.
- **구현 난이도**: **L** — 양방향 동기화, 참조 무결성, soft delete 복원, 권한 필터링이 모두 얽힌다.
- **우선순위**: **P0** — relation 없이는 노션형 데이터베이스라 부를 수 없다.
- **클론 시 현실적 대안**: MVP는 **양방향 relation 만** 지원하고 단방향은 v1 로 미루는 편이 오히려 단순하다(엣지 1행 모델에서 단방향은 "역방향 프로퍼티가 없는 상태"일 뿐). 셀 내 순서 보존은 P2.
- **참고 출처**: https://www.notion.com/help/relations-and-rollups , https://developers.notion.com/reference/property-object

---

### F-03-11 rollup (관계 경유 집계)

- **한 줄 정의**: relation 으로 연결된 페이지들의 특정 프로퍼티 값을 모아 집계 함수를 적용한 결과를 보여준다.
- **사용자 시나리오**:
  1. relation 프로퍼티가 먼저 존재해야 한다.
  2. 프로퍼티 추가 → `롤업` 선택.
  3. 3단 설정: **관계**(어느 relation 을 탈지) → **속성**(대상 DB 의 어떤 프로퍼티를 가져올지) → **계산**(어떤 집계를 할지).
  4. 셀은 읽기 전용으로 결과를 표시한다.
- **동작 상세**:
  - 기본 계산은 `show_original` `[추정]`.
  - 계산 옵션은 대상 프로퍼티 타입에 따라 다르게 노출된다: 숫자 → sum/average/median/min/max/range, 날짜 → earliest/latest/date_range, 체크박스 → checked/unchecked/percent_checked/percent_unchecked, 공통 → show_original/show_unique/count/count_values/unique/empty/not_empty/percent_*.
  - **rollup 의 rollup 은 불가**: 헬프 원문 "Unfortunately not, as this could create unintended loops. We recommend sticking to rolling up other properties" — rollup 대상 프로퍼티로 다른 rollup 을 **선택 목록에서 고를 수 없다**.
  - **rollup 대상으로 formula 는 지정 가능하다.** 실제로 date 프로퍼티의 종료일은 rollup 이 직접 읽지 못하므로, `dateEnd()` formula 를 만들어 그 formula 를 rollup 대상으로 삼는 것이 표준 우회법으로 통용된다. `[2차 출처 근거: https://thomasjfrank.com/formulas/reference-properties-in-formulas/ — 공식 문서에 명시 없음]`
  - **[정정] "rollup 금지 규칙이 순환을 원천 차단한다"는 초판 서술은 틀렸다.** rollup → formula → rollup 경로로 체인은 얼마든지 길어질 수 있고, 노션은 이를 **금지가 아니라 깊이 15 제한**으로 막는다. 그리고 그 제한은 **rollup 에도 함께 적용**된다("The reference chain limit also applies if you send values from one row (or database) to another using rollups").
  - `show_original` 은 값의 리스트를 그대로 나열한다(스칼라가 아님).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 연결된 페이지 0개 | `count`=0, `sum`=0, `average`=빈 값(0 아님), `show_original`=빈 목록 |
  | 대상 프로퍼티에 null 섞임 | `sum`/`average` 는 null 을 무시. `count_values` 는 non-empty 개수, `count` 는 전체 개수 |
  | 대상 프로퍼티 삭제 | rollup 이 에러/빈 상태. 사용자에게 재설정 유도 |
  | relation 프로퍼티 삭제 | rollup 무효화 |
  | 대상 프로퍼티 타입 변경 (number→text) | 선택된 집계 함수가 무효 → 기본 함수로 폴백 필요 |
  | 연결된 페이지 수백~수천 | 매 렌더마다 집계하면 O(N). 증분 캐시 필요 |
  | 순환: A의 rollup 이 B를, B의 rollup 이 A를 참조 | **차단되지 않는다.** rollup → formula → rollup 우회 경로가 열려 있으므로 클론은 **저장 시점 DFS 사이클 검출**을 직접 구현해야 한다 |
  | 참조 체인이 15단계를 넘음 | 노션은 **경고 없이 조용히 빈 값/오답**을 낸다. 클론 권고: 저장 시 깊이를 계산해 **명시적 에러**로 거부 |
  | 대상 DB에 대한 권한이 없는 사용자가 rollup 셀을 볼 때 | 집계 결과는 **원본 값을 역산할 수 있는 정보 누출 경로**다(예: `show_original`, `min`/`max`). 권고: 권한 없는 행을 제외하고 "N개 항목 접근 불가" 표기, `show_original` 은 아예 마스킹 |
  | 대상 페이지가 휴지통에 있음 | 집계에서 제외. 복원 시 자동 재포함 → `page.deleted_at IS NULL` 을 집계 쿼리의 불변 조건으로 |
  | 권한 없는 연결 페이지 | 집계에 포함할지 제외할지 결정 필요. **권고: 제외하고 "일부 항목 접근 불가" 표시** |
- **데이터 모델 함의**:
  ```json
  // property.config
  {"relation_property_id":"prop_rel","target_property_id":"prop_num","function":"sum"}
  ```
  - 셀 값은 저장하지 않는 것이 원칙이나, 성능을 위해 **머티리얼라이즈드 캐시**를 둔다:
  ```sql
  CREATE TABLE derived_value (
    page_id     uuid, property_id uuid,
    value       jsonb,
    computed_at timestamptz,
    stale       boolean NOT NULL DEFAULT true,
    PRIMARY KEY (page_id, property_id)
  );
  ```
  - 무효화 경로: `대상 페이지의 대상 프로퍼티 값 변경` 또는 `relation 엣지 추가/삭제` → `relation_edge` 역인덱스로 영향받는 from_page 집합을 구하고 그 페이지들의 rollup 을 `stale = true` 로 표시 → 지연 계산 또는 워커 재계산.
- **UI/인터랙션**: 3단 설정 팝오버, 셀 읽기 전용, 셀 hover 시 원본 값 목록 툴팁 `[확인필요]`. 뷰 하단 집계행(calculation row)과는 별개 기능이다.
- **의존 기능**: F-03-10(relation), 대상 프로퍼티 타입.
- **구현 난이도**: **L** — 집계 자체는 쉽지만 무효화 전파, 대량 데이터 성능, **권한 필터링(권한 없는 행을 집계에서 빼면 사용자마다 결과가 달라져 캐시가 사용자별로 쪼개진다)** 이 겹친다. 이 마지막 항목이 초판에서 빠져 있었고, 캐시 설계를 근본적으로 바꾼다.
- **우선순위**: **P1** — MVP는 relation 만으로도 가치를 내지만, rollup 없으면 "프로젝트/작업" 템플릿이 성립하지 않는다.
- **클론 시 현실적 대안**: MVP는 **읽기 시점 계산(on-read)** 으로 시작하고, 연결 수가 커지면 `derived_value` 캐시 + 무효화 큐를 도입한다. 함수는 `show_original, count, count_values, sum, average, min, max, checked, percent_checked, earliest_date, latest_date` 11종으로 시작.
- **참고 출처**: https://www.notion.com/help/relations-and-rollups , https://developers.notion.com/reference/property-object

---

### F-03-12 formula 엔진 (Formulas 2.0)

- **한 줄 정의**: 같은 페이지의 다른 프로퍼티(그리고 relation 을 통해 연결된 페이지의 프로퍼티)를 입력으로 받아 값을 계산하는 표현식 언어.
- **사용자 시나리오**:
  1. 프로퍼티 추가 → `수식` → 수식 편집기 모달.
  2. 좌측에 함수·프로퍼티 목록, 우측에 설명과 예제, 중앙에 코드 입력.
  3. 입력하면서 **실시간 에러 하이라이팅**과 결과 미리보기가 표시된다.
  4. `완료` 클릭 → 모든 행에서 즉시 계산.
- **동작 상세 (언어 사양)**:
  - **데이터 타입**: `String`, `Number`, `Boolean`, `Date`, `Person`, `Page`, `List<T>`. Formulas 2.0 에서 page/date/person/list 가 출력 타입으로 추가되었다(1.0 은 text/number/checkbox 만).
  - **프로퍼티 참조**: `prop("이름")`. 2.0 부터는 편집기 상에서 프로퍼티를 멘션 형태로 삽입하며 `prop()` 없이도 참조 가능.
  - **연산자**: 산술 `+ - * / % ^`, 비교 `== != > >= < <=`, 논리 `and`/`&&`, `or`/`||`, `not`/`!`, 삼항 `cond ? a : b`.
  - **dot notation**: `prop("Created By").email()`, `prop("Text").length()` — 모든 함수는 첫 인자를 리시버로 하는 메서드 호출로도 쓸 수 있다.
  - **변수**: `let(name, value, expr)`, `lets(a, v1, b, v2, expr)`.
  - **주석과 줄바꿈**: 2.0 에서 멀티라인과 주석을 지원한다.
  - **함수 목록**(카테고리별):
    | 카테고리 | 함수 |
    |---|---|
    | 논리 | `if`, `ifs`, `empty`, `and`, `or`, `not`, `equal`, `unequal` |
    | 문자열 | `length`, `substring`, `contains`, `test`, `match`, `replace`, `replaceAll`, `lower`, `upper`, `repeat`, `trim`, `split`, `join`, `link`, `style`, `unstyle`, `format` |
    | 수학 | `add`, `subtract`, `multiply`, `divide`, `mod`, `pow`, `abs`, `round`, `ceil`, `floor`, `sqrt`, `cbrt`, `exp`, `ln`, `log10`, `log2`, `sign`, `min`, `max`, `sum`, `median`, `mean`, `pi`, `e` |
    | 날짜 | `now`, `today`, `minute`, `hour`, `day`, `date`, `week`, `month`, `year`, `dateAdd`, `dateSubtract`, `dateBetween`, `dateRange`, `dateStart`, `dateEnd`, `timestamp`, `fromTimestamp`, `formatDate`, `parseDate` |
    | 리스트 | `at`, `first`, `last`, `slice`, `concat`, `sort`, `reverse`, `unique`, `includes`, `find`, `findIndex`, `filter`, `some`, `every`, `map`, `flat`, `length` |
    | 사람/페이지 | `name`, `email`, `id` |
    | 변환 | `toNumber`, `format`, `formatNumber` |
  - **relation 순회**: `prop("Tasks").map(current.prop("Status"))`, `prop("Tasks").filter(current.prop("Status") != "Done")`. `current` 는 map/filter 의 반복 변수. **rollup 없이도 관계 건너 값을 읽을 수 있다** — 이게 2.0 의 핵심 변화다.
  - **formula 참조 formula — [초판 오류 정정]**: **가능하다.** 노션은 formula → formula, formula → rollup, rollup → formula 참조를 허용하되 **reference chain 깊이를 15로 제한**한다(원문: `Notion formulas will only allow you to create a reference chain that is 15 properties long`). 이 한도는 2024년 8월에 **7 → 15 로 상향**되었고, **다른 데이터베이스로 rollup 을 태워 값을 넘기는 경우에도 동일하게 누적**된다. 한 수식 안에서 참조하는 프로퍼티의 *개수* 에는 알려진 한도가 없다 — 제한되는 것은 **깊이**뿐이다.
  - **한도 초과 시 노션은 에러를 띄우지 않는다**(원문: `Notion won't alert you to it`). 값이 조용히 비거나 잘못 계산된다. **클론에서는 이것을 따라 하지 마라.** 저장 시 깊이를 계산해 명시적으로 거부하거나 경고하는 것이 명백한 개선점이다.
  - 설계적 함의: 파생값 의존 그래프는 **깊이 1의 별 모양이 아니라 최대 15단의 DAG** 다. F-03-13 을 `얕은 그래프` 가정으로 만들면 안 된다.
  - **[2026-09-06 2차 GAP — 1차 출처 확보]** 이 깊이 15 규칙은 이제 추정이 아니다. 노션 공식 헬프 `Fix common formula errors` 가 `Formula depth limit reached` 를 정식 에러 항목으로 두고 **`Notion formulas can only be 15 layers deep. Every time a formula references another formula or rollup, it adds a layer.`** 라고 명시한다. (https://www.notion.com/help/common-formula-errors) → 1차 GAP 이 달아둔 `[2차 출처]` 태그는 **해제**한다. 다만 "2024-08 에 7→15 상향" 과 "초과 시 무경고" 는 여전히 2차 출처(https://thomasjfrank.com/formulas/property-reference-limits/ , 교차 확인: https://notionmastery.com/pushing-notion-to-the-limits/)에만 근거한다.
  - **노션이 공식 문서화한 formula 에러 분류(= 클론이 그대로 구현해야 할 에러 taxonomy)**:
    | 에러 | 원인 | 클론 구현 시 대응 |
    |---|---|---|
    | Permissions | 참조 대상 데이터베이스에 접근 권한이 없어 계산이 신뢰할 수 없음 | **파생값은 권한과 결합된다는 공식 확인.** F-03-11/F-03-13 의 권한 클래스별 캐시 설계 근거 |
    | Wrong return type | 자동화가 특정 반환 타입(date/text/number/person)을 기대하는데 다름 | 정적 타입 추론 결과를 소비처(자동화·필터)와 계약으로 맞춘다 |
    | Formula depth limit reached | 참조 레이어 15 초과 | 저장 시 `ref_depth` 계산 후 **명시적 거부** |
    | Referencing variables in other variables | 같은 자동화 액션 안에서 변수끼리 참조 불가 | 변수 스코프를 액션 단위로 격리 |
    | Referencing variables in filters | 자동화 액션의 페이지 필터에 변수 사용 불가 | 필터 AST 에 변수 노드를 허용하지 않는다 |
    | Referencing relations and people | relation/rollup/person 은 **리스트**를 돌려주므로 첫 원소를 지정하지 않으면 자동화가 일시정지됨 | 리스트 → 스칼라 강제 변환 지점을 언어 차원에서 명시(`first()`) |
    | Undefined value | 비어 있는 date/person 값을 만나면 자동화가 에러로 **자동 일시정지** | null 전파 규칙을 명문화하고, 소비처에서 pause/skip 중 무엇인지 정의 |
    | Common syntax errors | 괄호 누락, 잘못된 연산자, 미지원 함수 | 파서 에러를 위치(offset)와 함께 반환 |
    (https://www.notion.com/help/common-formula-errors)
  - **[2026 API 갱신]** 2026-08-12 부터 formula 표현식이 **API 읽기·쓰기 모두에서 `prop("Property Name")` 문법으로 왕복**하며, formula 프로퍼티가 **결과 타입을 보존**하고, **잘못된 표현식은 조용히 재작성되지 않고 유효성 에러를 반환**한다. 즉 노션 스스로도 "무경고 실패"에서 "명시적 에러" 방향으로 움직였다 — 클론의 권고 방향과 일치한다. (https://developers.notion.com/page/changelog)
  - `prop("이름")` 은 **저장 시 property id 로 바인딩**되므로 이후 프로퍼티 이름을 바꿔도 수식이 깨지지 않는다. 초판의 `id 바인딩 필수` 권고는 노션 실동작과 일치한다 — 근거 확보됨. `[2차 출처]`
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 0으로 나누기 | 에러 또는 빈 값. 정의 필요 |
  | 타입 불일치 (`"a" + 1`) | 편집기에서 컴파일 에러로 차단 |
  | 참조하던 프로퍼티 삭제 | 수식이 에러 상태. 셀에 에러 표시, 값 없음 |
  | 참조하던 프로퍼티 이름 변경 | property id 로 바인딩되어 있으면 무해. **문자열 이름 바인딩이면 깨진다 → id 바인딩 필수** |
  | 순환 참조 | 저장 시 그래프 사이클 검출 → 저장 거부. formula↔rollup 혼합 경로도 같은 그래프에서 검사해야 한다 |
  | 참조 깊이 16단 | 노션: 조용히 실패. **클론 권고: 저장 거부 + 참조 깊이 15 초과 에러** |
  | 다른 DB 의 formula 를 rollup 으로 끌어오는 경우 | 체인 깊이가 DB 경계를 넘어 누적된다. 깊이 계산은 **워크스페이스 전역 그래프**에서 해야 한다 |
  | `now()` / `today()` 사용 | 결정적 함수가 아님 → 캐시 불가, 렌더 시점 계산 또는 주기적 무효화 필요 |
  | relation 수천 개에 map/filter | O(N) × 행 수 = O(N·M). 무거움 |
  | 빈 프로퍼티 | `empty()` 가 true. 숫자 연산에서는 0 이 아니라 null 전파를 권고 |
  | 매우 긴 수식 | 파서 재귀 깊이 제한 필요 |
- **데이터 모델 함의**:
  - `property.config = {"expression":"...", "compiled_ast":{...}, "result_type":"number", "depends_on":["prop_a","prop_b"], "ref_depth": 3}`
  - `ref_depth` = 이 프로퍼티가 뿌리내린 참조 체인의 최대 깊이. 저장 시 `max(depends_on 각각의 ref_depth) + 1` 로 계산해 캐시하면, 매 저장마다 전체 그래프를 순회하지 않고 O(직접 의존 수) 로 깊이 제한을 강제할 수 있다. 상류 프로퍼티의 `ref_depth` 가 바뀌면 하류로 위상 순서대로 전파한다.
  - 저장 시 파싱 → **AST 를 함께 저장**하고 `depends_on` 을 추출해 `property_dependency` 에 기록한다. 매 계산마다 재파싱하면 안 된다.
  - 결과는 `derived_value` 캐시(F-03-11 과 공유). `now()/today()` 를 포함하면 `is_volatile = true` 로 표시해 캐시에서 제외한다.
  - 표현식은 **사용자 입력 코드**다. 반드시 자체 파서 + 인터프리터로 실행하라. `eval()` 또는 JS 함수 생성은 XSS/RCE 경로다.
- **UI/인터랙션**: 코드 에디터(구문 강조, 자동완성, 괄호 매칭), 좌측 함수 브라우저, 우측 문서 패널, 하단 실시간 결과 미리보기 + 에러 메시지, `Cmd/Ctrl+Enter` 저장.
- **의존 기능**: 모든 프로퍼티 타입, F-03-10(relation 순회 시), 의존성 그래프(F-03-13).
- **구현 난이도**: **XL** — 렉서/파서/타입체커/인터프리터 + 에디터 UX + 캐시/무효화. 함수 100개 이상. 이 도메인에서 가장 큰 단일 작업이다.
- **우선순위**: **P1** — 없어도 DB는 동작하지만, formula 없는 노션 클론은 경쟁력이 없다.
- **클론 시 현실적 대안**:
  1. **단계 1(MVP)**: formula 미지원. rollup 만.
  2. **단계 2**: 산술·비교·논리 + `if`/`empty` + 문자열 기본 10종 + 날짜 5종만 지원하는 최소 언어. 파서는 Pratt parser 또는 `chevrotain`/`peggy` 등 파서 제너레이터로 1~2주.
  3. **단계 3**: list 타입과 `map`/`filter`/`current` 도입.
  - 결과 타입은 정적 추론하여 정렬·필터가 타입을 알 수 있게 한다. 동적 타입으로 두면 정렬 로직이 무너진다.
- **참고 출처**: https://www.notion.com/help/formula-syntax , https://www.notion.com/help/guides/new-formulas-whats-changed

---

### F-03-13 파생 프로퍼티 의존성 그래프 & 재계산

- **한 줄 정의**: formula 와 rollup 의 결과를, 입력이 바뀔 때만 정확히 다시 계산하기 위한 내부 메커니즘.
- **사용자 시나리오**: 사용자가 작업(Task)의 `예상 시간`을 8→12 로 바꾸면, 그 작업이 속한 프로젝트(Project) 행의 `총 시간` rollup 과 그 rollup 을 쓰는 `진행률` formula 가 **다른 사용자 화면에서도** 즉시 갱신된다.
- **동작 상세**:
  - 노드 = `(page_id, property_id)`. 엣지 = "이 값이 저 값의 입력이다".
  - 3가지 무효화 트리거:
    1. **같은 페이지 내**: 프로퍼티 X 변경 → 같은 페이지에서 X 에 의존하는 formula.
    2. **relation 경유**: 대상 페이지의 프로퍼티 변경 → `relation_edge` 역인덱스로 소스 페이지들의 rollup/`map` formula.
    3. **엣지 변경**: relation 연결 추가/삭제 → 양쪽 페이지의 파생값.
  - **[정정]** 초판은 노션이 그래프 깊이를 인위적으로 얕게 유지한다고 썼으나, 실제 정책은 **금지가 아니라 깊이 15 상한**이다(2024-08 이전 7). rollup-of-rollup 만 UI 선택지에서 막혀 있을 뿐 formula 를 한 단 끼우면 우회된다. 즉 **그래프는 얕지 않다.** 이 오해 위에 설계하면 위상 정렬·사이클 검출을 생략하게 되어 반드시 무너진다. **(1차 출처 확보 2026-09-06: https://www.notion.com/help/common-formula-errors — `Formula depth limit reached … 15 layers deep`. 상향 시점·무경고 실패는 2차: https://thomasjfrank.com/formulas/property-reference-limits/)**
  - 상한이 존재한다는 사실 자체는 클론에 유리하다: **재계산 깊이가 유한(≤15)** 이므로 위상 정렬 결과를 스키마 레벨에 캐시해 두면 런타임 그래프 순회를 거의 없앨 수 있다.
  - 재계산은 동기(요청 내) / 비동기(워커) 중 선택. 노션은 서버 사이드에서 비동기 전파하는 것으로 보인다 `[추정]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 순환 발생 | 스키마 저장 시점에 DFS 로 사이클 검출 → 저장 거부. 런타임 검출은 이미 늦다 |
  | 팬아웃 폭발 (1개 값 변경 → 10만 행 무효화) | 즉시 계산하지 말고 `stale` 마킹 후 **조회되는 페이지만** 계산(lazy) |
  | `now()` 포함 formula | 캐시 불가. 렌더 시점 계산 + 1분/1일 주기 갱신 |
  | 재계산 중 다시 변경 | 계산 결과에 입력 버전을 태그해 stale write 방지 |
  | 오프라인 편집 후 동기화 | 서버에서 전체 재계산 |
  | 대량 import | 트리거를 끄고 import 후 일괄 재계산 |
- **데이터 모델 함의**: `property_dependency`(스키마 레벨 그래프) + `derived_value`(페이지 레벨 캐시, `stale` 플래그) + 무효화 큐(예: Redis / Postgres LISTEN-NOTIFY / 잡 큐).
  - 스키마 레벨 그래프만 두고 페이지 레벨 그래프는 만들지 않는다(노드 수가 행 수 × 프로퍼티 수가 되어 폭발한다). 페이지 집합은 `relation_edge` 조회로 그때그때 구한다.
- **UI/인터랙션**: 사용자에게 직접 노출되지 않는다. 계산 중 셀에 스켈레톤/스피너 표시, 에러 시 셀에 경고 아이콘.
- **의존 기능**: F-03-10, F-03-11, F-03-12.
- **구현 난이도**: **XL** — 정확성(순환·stale·깊이 상한)과 성능(팬아웃)을 동시에 만족시켜야 하며, 실시간 협업(도메인 02)과 직접 얽힌다. **여기에 권한이 곱해진다**: rollup/formula 결과가 볼 수 있는 행 집합에 의존하면 파생값 캐시는 전역 1벌이 아니라 **권한 클래스별 N벌**이 된다. 이 결합을 계산에 넣지 않은 견적은 전부 과소평가다.
- **우선순위**: **P1** — rollup/formula 를 넣는 순간 필수가 된다.
- **클론 시 현실적 대안**: MVP는 **완전 lazy 계산**. 파생값을 저장하지 않고 페이지/뷰를 조회할 때마다 계산한다. 행 1,000개 규모까지는 충분하다. 캐시·무효화 큐는 성능 문제가 실제로 발생한 뒤 도입한다.
- **참고 출처**: https://www.notion.com/help/relations-and-rollups (rollup 중첩 금지), https://deepwiki.com/nocodb/nocodb/5.4-formula-system

---

### F-03-14 프로퍼티 타입 변환 & 데이터 마이그레이션

- **한 줄 정의**: 기존 프로퍼티의 타입을 다른 타입으로 바꿀 때 각 셀 값을 어떻게 변환·보존·폐기할지 정의한 규칙 집합.
- **사용자 시나리오**: 컬럼 헤더 → `속성 편집` → `유형` 드롭다운 → 다른 타입 선택 → **확인 다이얼로그 없이 즉시 적용**된다.
- **동작 상세**:
  - 노션은 타입 변경 시 확인 체크포인트를 제공하지 않는다. 세션 내 `Ctrl+Z` 만 되돌릴 수 있고, **페이지 버전 히스토리는 스키마를 스냅샷하지 않는다** → 되돌릴 수 없는 손실이 발생할 수 있다.
  - 변환 규칙(관찰·2차 출처 기반, `[확인필요]` 다수):
    | 변환 | 결과 |
    |---|---|
    | text → number | 숫자로 파싱 가능한 값만 보존, 나머지 폐기 |
    | text → select | **기존 값들로 옵션이 자동 생성**되고 매핑됨 (안전한 편) |
    | select → text | 옵션 이름이 문자열로 보존 |
    | multi_select → text | 옵션들이 쉼표 조인 문자열로 병합. 역변환 시 원본 분해가 보장되지 않음 |
    | text → multi_select | 쉼표 기준 분해 `[확인필요]` |
    | select ↔ status | 옵션 보존 + 그룹 배정 필요 `[확인필요]` |
    | number → text | 포맷된 문자열 또는 원시 숫자 `[확인필요]` |
    | date → text | 포맷 문자열 |
    | text → date | 파싱 성공한 것만 |
    | relation → 무엇이든 | **엣지 전량 폐기** |
    | formula/rollup → 저장형 | 계산 결과가 값으로 고정되는지, 폐기되는지 `[확인필요]` |
    | 무엇이든 → checkbox | 값 존재 여부로 true/false `[추정]` |
    | 자동형(created_time 등) → 다른 타입 | 값 폐기 `[추정]` |
    | title 로/에서 변환 | **금지** (API 문서 명시) |
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 10만 행 DB 의 타입 변경 | 동기 처리 불가 → 백그라운드 잡 + 진행 표시 |
  | 변환 도중 다른 사용자가 셀 편집 | 변환 중 프로퍼티 쓰기 잠금 필요 |
  | 변환 중 서버 오류 | 부분 변환 상태 방지 → 트랜잭션 또는 이중 쓰기(신규 property 에 쓰고 스왑) |
  | 변환된 프로퍼티를 참조하던 formula/rollup | 타입 불일치 → 에러 상태로 전환하고 사용자에게 알림 |
  | 되돌리기 | 원본 값 스냅샷 없이는 불가 |
  | 권한: 잠긴 DB(F-03-22)에서 타입 변경 시도 | 거부. 잠금은 스키마 레이어를 덮으므로 이 경로도 함께 막혀야 한다 |
  | 변환 대상 프로퍼티가 참조 체인 중간에 있음 | 하류 formula/rollup 의 `ref_depth` 와 결과 타입이 연쇄로 바뀐다 → **위상 순서대로 하류를 전부 재검증**하고, 타입이 맞지 않는 하류는 에러 상태로 표시 |
  | 순환 위험: 변환 결과가 새로운 사이클을 만듦 | 변환 커밋 전에 사이클 검출을 한 번 더 돌린다 |
  | 변환 중 실시간 협업 세션이 열려 있음 | 스키마 버전 증가를 브로드캐스트해 **클라이언트가 stale 스키마로 셀을 쓰지 못하게** 한다. 진행 중에는 해당 컬럼을 읽기 전용으로 렌더 |
  | 변환된 컬럼을 참조하던 뷰 필터(F-03-17) | 연산자가 무효 → 규칙 자동 비활성화 + 사용자 알림. 조용히 0건을 내면 안 된다 |
- **데이터 모델 함의**:
  - **권고 아키텍처(노션보다 안전하게)**: 변환은 파괴적 UPDATE 가 아니라 **새 property 행을 만들고 값을 채운 뒤 스왑**하는 방식으로 구현한다.
  ```sql
  CREATE TABLE property_migration (
    id uuid PK, property_id uuid, from_type property_type, to_type property_type,
    started_at timestamptz, finished_at timestamptz,
    status text,                       -- pending|running|done|failed|reverted
    snapshot_ref text,                 -- 변환 전 셀 값 덤프 위치
    lossy_count int                    -- 폐기된 셀 수
  );
  ```
  - 변환 전 셀 값 스냅샷을 N일 보관하면 되돌리기가 가능해진다. 이것만으로도 노션 대비 명확한 개선점이 된다.
  - 변환 규칙은 `(from_type, to_type) → converter` 매트릭스로 테이블화한다. 24개 타입이면 최대 24×24 이지만 실제로 필요한 것은 "텍스트 경유" 허브 패턴이면 충분하다: `X → text → Y`. 직접 변환은 손실 없는 쌍(select↔multi_select, number↔text 등)만 특수 처리한다.
- **UI/인터랙션**: 타입 드롭다운. **클론 권고**: 손실이 발생하는 변환일 때 "N개 셀의 값이 삭제됩니다" 다이얼로그를 띄운다(노션은 안 띄운다).
- **의존 기능**: F-03-02, 모든 프로퍼티 타입, F-03-13(참조 무효화).
- **구현 난이도**: **L** — 규칙 매트릭스 + 대량 배치 + 스냅샷/롤백.
- **우선순위**: **P1** — MVP에서는 "타입 변경 불가, 새 프로퍼티 만들고 지우세요"로 우회할 수 있다.
- **클론 시 현실적 대안**: MVP는 안전한 변환 쌍 6~8개만 허용하고 나머지는 UI 에서 비활성화. 전면 매트릭스는 v2.
- **참고 출처**: https://developers.notion.com/reference/update-property-schema-object , https://www.notion.com/help/database-properties , https://restora.cc/blog/notion-property-type-changes-are-permanent (2차 출처)

---

### F-03-15 button 프로퍼티 (행 단위 액션 트리거)

- **한 줄 정의**: 셀이 값이 아니라 버튼이며, 클릭 시 정의된 액션 시퀀스를 해당 행 컨텍스트로 실행한다.
- **사용자 시나리오**:
  1. 프로퍼티 추가 → `버튼` → 라벨과 아이콘 지정.
  2. `단계 추가` 로 액션을 순서대로 쌓는다.
  3. 행의 버튼 셀 클릭 → 액션이 위에서 아래로 실행 → 짧은 완료 토스트.
- **동작 상세 (액션 종류)**:
  | 액션 | 설명 | 제약 |
  |---|---|---|
  | 속성 편집 | 현재 행의 프로퍼티 값 변경 | |
  | ...에 페이지 추가 | 임의 DB 에 새 페이지 생성 + 프로퍼티 채우기 | |
  | ...의 페이지 편집 | 임의 DB 의 페이지들(필터 조건) 프로퍼티 변경 | |
  | 알림 보내기 | 워크스페이스 멤버에게 알림 | 최대 20명 |
  | 메일 보내기 | Gmail 연동 | 유료 플랜 |
  | 웹훅 보내기 | 지정 URL 로 HTTP POST | 유료 플랜 |
  | 확인 표시 | 실행 전 확인 다이얼로그(문구·버튼 텍스트 커스터마이즈) | |
  | 페이지/URL 열기 | 지정 페이지 또는 링크 열기 | |
  | Slack 알림 | Slack 채널로 전송 | Plus 이상 |
  | 변수 정의 | 멘션(`@`)과 수식(`∑`)으로 변수 생성해 다른 액션에서 사용 | 블록 삽입 / 페이지·URL 열기 / Slack 알림에서는 수식 사용 불가 |
  - 액션 값에 `@` 멘션(날짜/사람/페이지/그룹)과 `∑` 수식을 넣어 동적으로 만들 수 있다.
  - 권한: 버튼 생성·편집은 `전체 허용`/`편집 가능`, 클릭 실행은 `전체 허용`/`편집 가능`/`콘텐츠 편집 가능`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 중간 액션 실패 | 전체 롤백인지 부분 적용인지 정의 필요. 노션 동작 `[확인필요]`. 권고: **부분 적용 + 실패 지점 알림** |
  | 대상 DB 접근 권한 없음 | 실행 거부 |
  | 버튼이 자기 자신을 트리거하는 페이지 생성 | 무한 루프 → 실행 깊이 제한 필요 |
  | 연타 | 멱등 처리 또는 실행 중 비활성화 |
  | 웹훅 대상 무응답 | 타임아웃 + 재시도 정책 |
  | 뷰가 필터링 중일 때 "페이지 편집" | 필터 조건이 액션 정의에 포함됨 |
- **데이터 모델 함의**:
  ```json
  // property.config
  {"label":"완료 처리","icon":"✅","steps":[
    {"type":"confirm","title":"진행할까요?","confirm_label":"네","cancel_label":"아니오"},
    {"type":"edit_property","target":"self","values":{"prop_status":{"select":{"id":"opt_done"}}}},
    {"type":"add_page","data_source_id":"ds_log","values":{"prop_title":{"expr":"..."}}}
  ]}
  ```
  실행 감사를 위해 `button_run` 로그 테이블 권고(누가/언제/어느 행/성공 여부).
- **UI/인터랙션**: 셀에 버튼 렌더, 실행 중 스피너, 완료 토스트, 실패 시 에러 토스트. 액션 편집기는 드래그로 단계 순서 변경.
- **의존 기능**: F-03-02, F-03-12(수식 변수), 권한 모델, 알림 시스템.
- **구현 난이도**: **L** — 액션 종류가 많고 각각 다른 서브시스템(알림/메일/웹훅/Slack)을 건드린다.
- **우선순위**: **P2**
- **클론 시 현실적 대안**: MVP는 `속성 편집(self)` + `확인 표시` 2종만. 웹훅은 v2, 외부 연동(메일/Slack)은 범위 밖.
- **참고 출처**: https://www.notion.com/help/database-buttons , https://www.notion.com/help/buttons

---

### F-03-16 프로퍼티 값 편집 UX 공통 규약 (셀 편집 / 대량 붙여넣기 / 표시 규칙)

- **한 줄 정의**: 타입과 무관하게 모든 셀에 적용되는 편집·이동·복사·표시 동작.
- **사용자 시나리오**:
  1. 셀 클릭 → 선택 상태(테두리). 한 번 더 클릭 또는 `Enter` → 편집 모드.
  2. `Tab` / `Shift+Tab` 좌우 이동, `↑↓←→` 셀 선택 이동, `Enter` 아래 셀.
  3. `Esc` 편집 취소, `Cmd/Ctrl+Z` 실행 취소.
  4. 스프레드시트에서 범위 복사 → 표에 붙여넣기 → 행이 자동 생성되고 타입별로 파싱된다.
  5. 페이지 상세(peek) 화면에서는 프로퍼티가 세로 목록으로 표시되며 `속성 N개 더 보기` 로 숨김 프로퍼티를 펼친다.
- **동작 상세**:
  - **[정정]** 페이지 상세 화면의 프로퍼티 표시는 3단계 enum 이 아니라 **레이아웃 빌더**로 관리된다: 프로퍼티별 표시/숨김 토글(👁️) + 배치 영역(**헤딩 최대 15개 / 본문 모듈 / 우측 상세 패널**) + 구조 선택(**Simple / Tabbed**). `모든 페이지에 적용` 시 DB 전체에 일괄 적용된다. relation 등 일부 타입은 상세 패널에 배치할 수 없다. (https://www.notion.com/help/layouts)
  - 조건부(값이 비었을 때 자동 숨김) 표시 규칙은 **현행 노션에 없다** `[확인필요: 과거 UI에 존재했다는 서술이 2차 출처에 있으나 현행 문서에서는 확인되지 않음]`. 클론에서 구현한다면 순증 기능이다.
  - 컬럼 폭(width), 줄바꿈(wrap), 컬럼 고정(freeze)은 **뷰 레벨** 설정이다.
  - 대부분의 프로퍼티에서 **셀 단위 코멘트**가 가능하다.
  - 조건부 색상(conditional color)은 select, multi-select, status, title, text, number, date, person, checkbox, formula, relation, rollup 에서 지원된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 읽기 전용 프로퍼티 편집 시도 | 편집 모드 진입 차단 |
  | 붙여넣기 열 수 > 프로퍼티 수 | 초과분 폐기 또는 프로퍼티 자동 생성 `[확인필요]` |
  | 붙여넣기 값이 타입과 불일치 | 파싱 실패 셀은 비워둠 |
  | 여러 사용자가 동일 셀 동시 편집 | 셀 단위 잠금 없이 LWW. rich_text 셀만 CRDT 권고 |
  | 매우 많은 컬럼(100+) | 가로 가상 스크롤 필요 |
  | 오프라인 편집 | 로컬 큐잉 후 재연결 시 반영 |
- **데이터 모델 함의**:
  - 뷰 레벨 컬럼 설정을 별도 테이블로:
  ```sql
  CREATE TABLE view_property_config (
    view_id uuid, property_id uuid,
    visible boolean, width int, wrap boolean, frozen boolean, order_idx text,
    PRIMARY KEY (view_id, property_id)
  );
  ```
  - 스키마 레벨 표시 규칙은 노션 실제 모델에 맞춰 enum 이 아니라 **배치 레코드**로 둔다:
  ```sql
  CREATE TABLE page_layout_slot (
    data_source_id uuid, property_id uuid,
    visible   boolean NOT NULL DEFAULT true,
    area      text NOT NULL,         -- 'heading' | 'body' | 'side_panel'
    tab_id    uuid NULL,             -- Tabbed 구조일 때
    order_idx text,
    PRIMARY KEY (data_source_id, property_id)
  );
  -- 불변식: area='heading' 인 행은 data_source 당 최대 15개
  ```
  - 셀 코멘트는 `comment(target_type='property_value', page_id, property_id)` 로 확장.
- **UI/인터랙션**: 위 단축키 전부. 셀 hover 시 확장 아이콘(rich_text/relation/files), 셀 우클릭 컨텍스트 메뉴(복사, 지우기, 코멘트 추가).
- **의존 기능**: 모든 프로퍼티 타입, 뷰 시스템(도메인 04), 실시간 협업(도메인 02).
- **구현 난이도**: **L** — 그리드 키보드 내비게이션과 붙여넣기 파싱은 개별 타입 구현보다 손이 많이 간다.
- **우선순위**: **P0** (기본 편집·이동), **P1** (대량 붙여넣기), **P2** (조건부 색상, 셀 코멘트)
- **클론 시 현실적 대안**: 그리드는 직접 만들지 말고 TanStack Table + 가상화(`@tanstack/react-virtual`) 위에 셀 렌더러/에디터를 타입별로 얹는다. 키보드 내비게이션만 직접 구현.
- **참고 출처**: https://www.notion.com/help/database-properties , https://www.notion.com/help/intro-to-databases

---

### F-03-17 프로퍼티별 필터 · 정렬 연산자 규약 (쿼리 계약)

- **한 줄 정의**: 뷰와 API가 행을 걸러내고 정렬할 때, 각 프로퍼티 타입이 노출하는 연산자 집합과 그 의미론을 규정한다.
- **사용자 시나리오**:
  1. 뷰 상단 `필터` 클릭 → 프로퍼티 선택.
  2. **선택한 프로퍼티의 타입에 따라 연산자 드롭다운의 항목이 달라진다**(텍스트는 `포함/시작함`, 숫자는 `>/<`, 체크박스는 `이다`만).
  3. 값 입력 → 즉시 반영.
  4. `+ 필터 규칙 추가` → AND/OR 그룹 구성. 그룹 안에 그룹을 한 번 더 만들 수 있다.
  5. 헤더 메뉴 `오름차순/내림차순` 또는 `정렬` 패널에서 다중 정렬 키를 순서대로 쌓는다.
- **동작 상세** — API `2025-09-03` 의 필터 연산자 전수 (https://developers.notion.com/reference/post-database-query-filter):

  | 타입 | 연산자 |
  |---|---|
  | `rich_text` / `title` / `url` / `email` / `phone_number` | `contains`, `does_not_contain`, `equals`, `does_not_equal`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
  | `number` | `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to`, `is_empty`, `is_not_empty` |
  | `checkbox` | `equals`, `does_not_equal` — **`is_empty` 없음**(null 상태가 없으므로) |
  | `select` | `equals`, `does_not_equal`, `is_empty`, `is_not_empty` |
  | `multi_select` | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` — **`equals` 없음**(집합 동등 비교 미지원) |
  | `status` | `equals`, `does_not_equal`, `is_empty`, `is_not_empty` |
  | `date` / `created_time` / `last_edited_time` | `after`, `before`, `equals`, `on_or_after`, `on_or_before`, `is_empty`, `is_not_empty`, `past_week`, `past_month`, `past_year`, `this_week`, `next_week`, `next_month`, `next_year` |
  | `people` / `created_by` / `last_edited_by` | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` |
  | `files` | `is_empty`, `is_not_empty` — **내용 기반 필터 불가** |
  | `relation` | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` (대상 page id 기준) |
  | `formula` | 결과 타입(`checkbox`/`date`/`number`/`string`)에 해당하는 필터를 **중첩**해서 지정 |
  | `rollup` | 배열 결과는 `any` / `every` / `none` 한정자 + 내부 조건, 스칼라 결과는 `date`/`number` 조건 중첩 |
  | `unique_id` | `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to` |
  | `place` | **텍스트 기반**: 장소 이름 또는 주소에 포함된 문자열로 필터, 정렬은 알파벳순. **지리 연산(반경/거리) 없음** (https://www.notion.com/help/maps) |
  | `verification` | 뷰 필터에서 `status` 조건과 `does_not_equal` 지원 (2026-08-13 추가) |
  | `button` | 필터 불가(값이 없다) |

  - **compound 필터**: `and` / `or` 키로 묶으며 **중첩은 2단계까지**(원문: `Nesting is supported up to two levels deep`).
  - **timestamp 필터**: 프로퍼티로 추가하지 않아도 `created_time` / `last_edited_time` 자체를 필터 대상으로 지정할 수 있다.
  - **`this_week` 류 상대 날짜**는 평가 시점 의존이므로 결과를 캐시할 수 없다. 주 시작 요일과 타임존 기준을 반드시 고정해야 한다 `[확인필요: 노션이 사용자 로캘 기준인지 워크스페이스 기준인지]`.
  - 페이지네이션은 응답당 최대 100건, 커서 기반이다. **2026-04-20 부터 누적 페이지네이션 깊이가 10,000건으로 제한**되며, 한도에 닿으면 응답에 `request_status: {type:"incomplete"}` 가 실린다 → **"전부 훑는" 클라이언트 로직은 반드시 깨진다.** 클론도 무한 스크롤 대신 상한 + 필터 유도 UX 를 설계하라.
  - **[2026 갱신] 동적/상대 필터가 확장되었다.**
    | 변경 | 내용 | 날짜 |
    |---|---|---|
    | `me` 필터 | people 계열 프로퍼티의 `contains`/`does_not_contain` 에 `"me"` 를 넣으면 **호출 주체(현재 인증 사용자)** 로 해석된다. 사용자 id 하드코딩 불필요 | 2026-03-30 |
    | 상대 날짜 값 | `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago`, `one_month_from_now` | 2026-03-30 |
    | 다중값 필터 | select/status 의 `equals`/`does_not_equal` 가 **배열**을 받고, multi_select 의 `contains`/`does_not_contain` 이 다중 값을 받는다 | 2026-04-17 |
    | 뷰 필터 확장 | relation, person, status, created-by, last-edited-by, unique ID, last-visited, **verification**, **place** 필터 지원 | 2026-08-13 |
    (https://developers.notion.com/page/changelog)
  - **`me` 필터의 설계 함의**: 필터 AST 에 **평가 컨텍스트 의존 노드**(`me`, `today`)가 존재한다는 뜻이다. 즉 **뷰 결과는 사용자마다 다를 수 있고, 필터 단위의 결과 캐시는 (view_id) 가 아니라 (view_id, actor_id, 평가일) 로 키를 잡아야 한다.** 이것은 F-03-11/F-03-13 의 "파생값 캐시가 권한 클래스별로 쪼개진다"와 같은 종류의 함정이다.
  - **[2026 갱신] Views API 정식 출시(2026-03-19)**: 뷰 생성/조회/수정/삭제/목록/쿼리 8개 엔드포인트, 지원 뷰 타입 `table, board, calendar, timeline, gallery, list, form, chart, map, dashboard`, 웹훅 `view.created` / `view.updated` / `view.deleted`. **즉 뷰도 이제 1급 API 리소스다.** 클론 설계 시 뷰를 "프론트엔드 로컬 상태"로 두면 안 된다는 강한 신호. (https://developers.notion.com/page/changelog)
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 필터가 참조하던 프로퍼티 삭제 | 규칙이 무효 상태. 결과 0건으로 두면 데이터 소실로 오인된다 → **규칙을 비활성 표시하고 무시**하는 편이 안전 |
  | 필터가 참조하던 select 옵션 삭제 | 규칙은 남고 매칭 0건. UI에 "삭제된 옵션" 배지 필요 |
  | `formula` 결과 타입 변경 (number → string) | 기존 필터의 연산자가 무효 → 규칙 자동 비활성화 + 알림 |
  | `rollup` / `formula` 로 정렬·필터 | **파생값을 미리 계산해 두지 않으면 SQL 로 풀 수 없다.** F-03-13 의 on-read 계산 전략이 무너지는 첫 지점 |
  | 권한 없는 행이 필터 결과에 포함 | 건수조차 노출하면 안 된다 → 권한 술어를 **필터보다 먼저** 적용 |
  | 대용량(10만 행) + EAV 저장 | 프로퍼티마다 조인이 붙어 급격히 느려짐 → 타입별 파생 컬럼 + 부분 인덱스 필수 |
  | 정렬 키 동률 | 안정 정렬 보장을 위해 마지막 키로 `order_idx` 또는 `page.id` 를 항상 덧붙인다 |
  | 편집 중인 행이 필터에서 탈락 | 화면에서 즉시 사라지면 입력이 끊긴다 → **편집 중인 행은 필터 예외 처리** `[추정: 노션도 편집 중에는 즉시 사라지지 않는 것으로 관찰됨]` |
  | 동시편집 중 다른 사용자가 필터를 바꿈 | 뷰 설정은 공유 상태다. 내 화면의 행 집합이 갑자기 변한다 → 뷰 설정 변경도 실시간 브로드캐스트 대상 |
- **데이터 모델 함의**:
  ```sql
  -- 뷰의 필터/정렬은 AST 로 저장한다 (문자열 SQL 저장 금지)
  ALTER TABLE view ADD COLUMN filter_ast jsonb;   -- {op:'and', children:[{property_id, operator, value}]}
  ALTER TABLE view ADD COLUMN sort_keys  jsonb;   -- [{property_id, direction}]

  -- EAV 위에서 정렬/필터를 성립시키는 파생 컬럼
  ALTER TABLE page_property_value
    ADD COLUMN num_value  numeric,
    ADD COLUMN text_value text,
    ADD COLUMN date_start timestamptz,
    ADD COLUMN bool_value boolean;
  CREATE INDEX ON page_property_value (property_id, num_value);
  CREATE INDEX ON page_property_value (property_id, date_start);
  CREATE INDEX ON page_property_value (property_id, lower(text_value) text_pattern_ops);
  ```
  - 연산자 카탈로그는 코드가 아니라 **데이터**로 둔다: `(property_type, operator) → sql_template` 테이블. 새 타입을 추가하면 필터 UI가 자동으로 따라온다.
  - `filter_ast` 는 사용자 입력이다. **절대 문자열 연결로 SQL 을 만들지 말고** 파라미터 바인딩 + 화이트리스트 연산자 매핑으로만 컴파일하라.
- **UI/인터랙션**: 필터 칩(프로퍼티·연산자·값), 칩 클릭 시 팝오버, 드래그로 규칙 순서 변경, `AND/OR` 토글, 정렬 패널의 다중 키 드래그 재정렬, 헤더 우클릭 즉시 정렬.
- **의존 기능**: F-03-02(스키마), 모든 프로퍼티 타입, F-03-13(파생값이 필터 대상일 때), 뷰 시스템(도메인 04), 권한 모델.
- **구현 난이도**: **L** — 연산자 자체는 단순하지만 (a) 타입 × 연산자 매트릭스, (b) EAV 피벗 성능, (c) 파생 프로퍼티 필터, (d) 권한 술어 결합이 겹친다. **초판에는 이 기능이 통째로 빠져 있었다.**
- **우선순위**: **P0** — 필터/정렬 없는 데이터베이스는 표가 아니라 목록이다. 뷰(도메인 04)의 전제 조건.
- **클론 시 현실적 대안**: MVP는 타입별 연산자를 4~6개로 줄이고(`equals / contains / is_empty / >, <`), compound 는 1단계 AND 만. `formula`/`rollup` 필터는 파생값 캐시가 생긴 뒤(v1)에 연다. 상대 날짜(`this_week` 등)는 `today ± N일` 로 단순화.
- **참고 출처**: https://developers.notion.com/reference/post-database-query-filter , https://developers.notion.com/reference/request-limits

---

### F-03-18 sub-item(하위 항목) & dependency(종속 관계) — 내장 self-relation

- **한 줄 정의**: 같은 데이터베이스 안에서 행 사이의 **계층(부모–자식)** 과 **선후행(차단–차단됨)** 을 노션이 미리 만들어 주는 특수 self-relation 프로퍼티 쌍.
- **사용자 시나리오**:
  1. 데이터베이스 설정 `···` → `하위 항목` 토글 ON → `Sub-item` / `Parent item` 프로퍼티 쌍이 자동 생성된다.
  2. 표 뷰의 행 좌측에 토글 화살표가 생기고, 펼치면 하위 항목이 들여쓰기되어 보인다. `+` 로 하위 행을 직접 추가.
  3. 데이터베이스 설정 → `종속 관계` 토글 ON → `Blocking` / `Blocked by` 프로퍼티 쌍 생성.
  4. 타임라인 뷰에서 항목에 hover → 노란 화살표를 끌어 다른 항목에 연결하면 종속 관계가 생기고 방향 화살표로 렌더된다.
  5. 설정 → `종속 관계` → 날짜 이동 정책 3종 중 선택.
- **동작 상세**:
  - sub-item / dependency 는 **별도 프로퍼티 타입이 아니라 relation 의 특수화**다. 따라서 relation 의 모든 제약(엣지 테이블, 참조 체인 깊이 소모)을 그대로 상속한다 `[추정: 공개 API 에 별도 타입 키가 없고 relation 으로 노출되므로]`.
  - 표시 모드: 하위 항목을 **토글로 중첩**하거나 **평면 목록**으로 펼칠 수 있다(뷰 타입에 따라 다름).
  - 뷰별 필터 스코프가 별도로 존재한다: 표/리스트/타임라인 뷰는 `Parents only` / `Parents and sub-items` / `Sub-items only` 중 선택. **보드/캘린더/갤러리 뷰는 `Parents only` 만 지원한다.**
  - 종속 관계 날짜 이동 정책 3종:
    | 옵션 | 동작 |
    |---|---|
    | `Shift only when dates overlap` | 날짜가 겹치기 시작할 때만 뒤 작업을 민다. 작업 간 간격은 줄어들 수 있다 |
    | `Shift & maintain time between items` | A가 1주 밀리면 A가 차단하는 B도 1주 밀려 **간격이 보존**된다 |
    | `Do not automatically shift` | 자동 이동 없음 |
  - 하위 항목이 있는 행을 다른 DB 로 옮길 때, 대상 DB 에서 하위 항목 기능을 켤 권한이 없으면 **하위 항목들이 전부 최상위 항목으로 승격**된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 순환 계층 (A의 하위가 B, B의 하위가 A) | **반드시 차단.** 트리 렌더가 무한 재귀에 빠진다. 저장 시 조상 체인 검사 |
  | 순환 종속 (A가 B를 차단, B가 A를 차단) | 노션 문서에 언급 없음 `[확인필요]`. 날짜 자동 이동이 무한 루프가 되므로 **클론은 저장 시 거부** |
  | 부모 삭제 | 자식을 함께 휴지통으로 보낼지, 최상위로 승격시킬지 결정 필요. 권고: **승격**(데이터 손실 없음) `[확인필요: 노션 실동작]` |
  | 중첩 깊이 제한 | 문서에 명시 없음 `[확인필요]`. 클론 권고: **깊이 10 상한 + 자식 지연 로딩** |
  | 필터가 부모만 통과시키고 자식은 탈락 | 트리가 끊긴다. 권고: 매칭된 자식의 **조상 경로를 강제 포함**(고스트 행으로 표시) |
  | 정렬과 계층의 충돌 | 정렬은 **형제 그룹 내부에서만** 적용해야 트리가 유지된다 |
  | 날짜 자동 이동이 수천 행으로 연쇄 | 위상 정렬 후 배치 업데이트. 요청 스레드에서 동기 처리 금지 |
  | 하위 항목 기능을 끄면 | 프로퍼티가 사라지는지 일반 relation 으로 남는지 `[확인필요]`. 권고: **일반 relation 으로 강등, 엣지 보존** |
  | 동시편집: 두 사용자가 같은 행을 서로 다른 부모 아래로 이동 | 부모 지정은 단일 값이므로 LWW. 단 이동 결과가 순환을 만들면 나중 쓰기를 거부해야 한다 |
  | 대용량: 부모 1개에 자식 5,000개 | 자식 목록 페이지네이션 필요 |
  | 권한: 부모는 보이지만 자식에 접근 권한 없음 | 자식 수 배지에서 접근 불가 항목을 제외. "N개 항목 접근 불가" 표기 |
- **데이터 모델 함의**:
  ```sql
  -- 별도 테이블을 만들지 말고 relation_edge 를 재사용하되 역할을 표시한다
  ALTER TABLE property ADD COLUMN relation_role text NULL;
    -- NULL | 'sub_item' | 'parent_item' | 'blocking' | 'blocked_by'
  ALTER TABLE data_source
    ADD COLUMN sub_items_enabled     boolean NOT NULL DEFAULT false,
    ADD COLUMN dependencies_enabled  boolean NOT NULL DEFAULT false,
    ADD COLUMN dependency_shift_mode text NOT NULL DEFAULT 'none';
    -- 'overlap_only' | 'maintain_gap' | 'none'

  -- 트리 조회 가속: 부모 체인을 머티리얼라이즈드 패스로 중복 저장
  ALTER TABLE page ADD COLUMN parent_row_id uuid NULL REFERENCES page(id);
  ALTER TABLE page ADD COLUMN ancestor_path uuid[] NOT NULL DEFAULT '{}';
  CREATE INDEX ON page USING gin (ancestor_path);
  -- 불변식: 쓰기 시 id = ANY(new.ancestor_path) 이면 순환 → 거부
  ```
  - `ancestor_path` 를 두면 `Parents and sub-items` 필터 스코프와 "조상 강제 포함"을 한 번의 쿼리로 처리할 수 있다. 재귀 CTE 만으로 버티면 뷰 렌더마다 재귀가 돈다.
  - `parent_row_id` 는 `relation_edge` 의 비정규화 사본이다. **둘 중 하나를 정본으로 정하고(권고: 엣지 테이블) 다른 쪽은 트리거로 파생**시켜라. 양쪽에 독립적으로 쓰면 반드시 어긋난다.
- **UI/인터랙션**: 행 좌측 토글 화살표(펼침 상태는 뷰별로 기억), 드래그로 행을 다른 부모 아래로 이동, 타임라인의 노란 연결 핸들 드래그, 종속 화살표 클릭 시 해제 메뉴, `Tab`/`Shift+Tab` 으로 들여쓰기 변경 `[확인필요: 노션이 표 뷰에서 지원하는지]`.
- **의존 기능**: F-03-10(relation), F-03-06(date — 종속 관계의 날짜 이동), F-03-17(필터 스코프), 타임라인 뷰(도메인 04).
- **구현 난이도**: **L** — 계층 트리(순환 방지 + 필터/정렬 상호작용)와 날짜 전파가 각각 독립적으로 까다롭다. 종속 관계의 자동 날짜 이동은 사실상 **작은 제약 해결기(constraint solver)** 다.
- **우선순위**: **P1** — 프로젝트/태스크 관리 클론이 목표라면 P0. 문서 중심 클론이면 P2.
- **클론 시 현실적 대안**: sub-item 만 먼저 만든다(자기참조 relation + `parent_row_id` 비정규화). dependency 는 "화살표로 표시만 하고 날짜는 옮기지 않는" 버전(`Do not automatically shift` 고정)으로 시작하고 자동 이동은 v2.
- **참고 출처**: https://www.notion.com/help/tasks-and-dependencies , https://www.notion.com/help/customize-your-database , https://www.notion.com/releases/2022-12-15

---

### F-03-19 데이터베이스 자동화 (프로퍼티 변경 트리거)

- **한 줄 정의**: 데이터베이스 안에서 특정 사건(행 추가 / 프로퍼티 변경 / 일정)이 발생하면 미리 정의한 액션 시퀀스를 자동 실행한다. button(F-03-15)이 "사람이 누르는 트리거"라면 이것은 "데이터가 스스로 당기는 트리거"다.
- **사용자 시나리오**:
  1. 데이터베이스 우상단 ⚡ 아이콘 → `+ 새 자동화`.
  2. **트리거** 선택: `페이지 추가됨` / `속성 편집됨`(어떤 프로퍼티인지, 어떤 값으로 바뀌었을 때인지까지 지정) / `반복`(일·주·월 단위 시각·타임존 지정).
  3. 트리거가 여러 개면 `이 중 하나라도 발생 시` 또는 `모두 발생 시` 를 고른다.
  4. **액션** 을 순서대로 쌓는다.
  5. 적용 범위를 **데이터베이스 전체** 또는 **특정 뷰** 로 지정한다.
- **동작 상세**:
  - 트리거 3종: 페이지 추가, 속성 편집, 반복 일정.
  - `속성 편집` 트리거는 name / person / number / text / select / relation 프로퍼티에 대해 **어떤 종류의 편집인지까지 세분화**할 수 있다.
  - **판정 윈도우 약 3초**: "모두 발생 시" 조건은 트리거들이 약 3초 안에 일어나야 성립한다("Database automations work over a three second window"). → 내부적으로 변경 이벤트를 **3초 버퍼에 모아 배치 평가**하는 구조임을 강하게 시사한다 `[추정]`.
  - **자동화는 다른 자동화를 트리거하지 못한다**(원문: `Database automations can't be triggered by other automations`). 이것이 노션의 무한 루프 방지 장치다. 다만 **버튼 클릭은 자동화를 트리거할 수 있다** — 즉 차단은 "자동화 → 자동화" 간선에만 걸린다.
  - 액션 종류는 button 과 대체로 동일: 속성 편집, 페이지 추가, 페이지 편집, 워크스페이스 알림(최대 20명), Gmail 메일, 웹훅, Slack 알림, 변수 정의.
  - 유료 플랜 전용. 무료 사용자는 **Slack 알림 자동화만** 만들 수 있다. 생성자는 해당 데이터베이스에 대한 전체 액세스 권한이 필요하다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 자동화가 자신의 트리거 프로퍼티를 수정 | 노션은 자동화→자동화를 차단하므로 루프가 생기지 않는다. **클론이 이 차단을 빼면 즉시 무한 루프** |
  | 3초 안에 같은 프로퍼티가 여러 번 바뀜 | 최종 상태로 1회만 평가(디바운스). 중간 상태로 발화하면 안 된다 |
  | 대량 import 로 1만 행 추가 | `페이지 추가` 트리거가 1만 번 발화 → **import 경로는 자동화를 우회**하거나 배치 억제 플래그 필요 |
  | 자동화 실행 중 대상 페이지 삭제 | 액션 실패 → 부분 적용. 실행 로그에 실패 지점 기록 |
  | 액션 대상 DB 에 권한 없음 | 실행 거부. **생성 시점 권한과 실행 시점 권한이 다를 수 있다**(권한 회수 후에도 자동화가 남아 있음) → 실행 시점 재검사 필수 |
  | 웹훅 대상 무응답 | 타임아웃 + 지수 백오프 재시도 + 최대 시도 횟수 |
  | 반복 트리거와 서머타임/타임존 | 타임존 지정 필수. UTC 저장 + 로컬 타임존 해석. DST 경계에서 건너뛰거나 두 번 실행되지 않도록 마지막 실행 시각으로 멱등 처리 |
  | 파생값(formula/rollup) 변경이 트리거가 되어야 하는가 | **정의 필요.** 인정하면 F-03-13 재계산 → 자동화 → 재계산 연쇄가 생긴다. 권고: **파생 프로퍼티는 트리거 대상에서 제외** `[확인필요: 노션 실동작]` |
  | 동시편집: 두 사용자가 같은 행을 3초 안에 각각 수정 | 이벤트가 병합되어 자동화는 1회만 실행. "누가 트리거했는가"는 마지막 편집자로 기록 |
- **데이터 모델 함의**:
  ```sql
  CREATE TABLE db_automation (
    id uuid PRIMARY KEY,
    data_source_id uuid REFERENCES data_source(id) ON DELETE CASCADE,
    scope_view_id  uuid NULL,            -- NULL = 전체 DB
    name text, enabled boolean DEFAULT true,
    trigger_mode text,                   -- 'any' | 'all'
    triggers jsonb,                      -- [{kind:'page_added'} | {kind:'property_edited', property_id, condition} | {kind:'recurring', rrule, tz}]
    actions  jsonb,                      -- button 의 steps 와 동일 스키마 재사용
    created_by uuid, created_at timestamptz
  );
  CREATE TABLE automation_run (
    id uuid PRIMARY KEY, automation_id uuid, page_id uuid,
    started_at timestamptz, finished_at timestamptz,
    status text,                         -- queued|running|success|failed|skipped
    trigger_source text,                 -- 'user'|'automation'|'button'|'schedule'|'import'
    depth int NOT NULL DEFAULT 0,        -- 루프 방지용 실행 깊이
    error jsonb
  );
  ```
  - **`trigger_source` + `depth` 를 변경 이벤트에 실어 전파**하는 것이 루프 방지의 핵심이다. 자동화가 만든 변경 이벤트에는 `origin='automation'` 을 찍고, 자동화 평가기는 그 이벤트를 무시한다 — 노션의 규칙을 그대로 재현하는 최소 구현이다.
  - 액션 스키마는 F-03-15 button 의 `steps` 와 **완전히 공유**하라. 실행기를 두 벌 만들면 반드시 갈라진다.
- **UI/인터랙션**: ⚡ 아이콘 배지(활성 자동화 수), 자동화 편집 패널(트리거 카드 + 액션 카드 드래그 정렬), 실행 이력 목록, 개별 자동화 on/off 토글.
- **의존 기능**: F-03-02, F-03-15(액션 실행기 공유), F-03-13(파생값 변경과의 상호작용 정의), F-03-22(권한), 알림 시스템.
- **구현 난이도**: **XL** — 이벤트 버스 + 디바운스 윈도우 + 잡 큐 + 재시도 + 루프 방지 + 실행 감사 로그. 액션마다 외부 시스템(메일/Slack/웹훅)이 붙는다. **button 보다 한 단계 위**다: button 은 사용자 클릭이 자연 디바운스 역할을 하지만 자동화는 스스로 발화한다.
- **우선순위**: **P2** — 없어도 데이터베이스는 완전히 동작한다. 다만 "속성 편집 → 다른 속성 자동 갱신" 최소 형태는 P1 가치가 있다.
- **클론 시 현실적 대안**: MVP는 **트리거 `속성 편집` + 액션 `속성 편집(자기 행)` 조합 하나만** 지원하고 동기 실행한다(잡 큐 불필요). 반복 트리거와 외부 연동(메일/Slack/웹훅)은 범위 밖. **루프 방지 `origin` 플래그만은 처음부터 넣어라** — 나중에 넣으면 이미 늦다.
- **참고 출처**: https://www.notion.com/help/database-automations , https://www.notion.com/help/database-buttons

---

### F-03-20 AI 자동 채우기 프로퍼티 (AI Autofill)

- **한 줄 정의**: 텍스트 프로퍼티의 값을 사람이 아니라 LLM 이 채우게 하며, 각 행의 본문과 다른 프로퍼티를 입력으로 삼는다.
- **사용자 시나리오**:
  1. 프로퍼티 헤더 hover → 프로퍼티 이름 클릭 → `AI 자동 채우기`.
  2. `Basic` 또는 `Custom Agent` 선택.
  3. 동작 지정: Basic 은 `요약(Summary)` / `번역(Translate)` / `핵심 정보(Key info)`, Custom 은 자유 프롬프트.
  4. **실행 시점** 선택: `수동` / `페이지 생성 시` / `페이지 편집 시`(Custom 은 추가로 `일정`).
  5. 셀에 생성된 텍스트가 채워지고, 수동 모드면 셀의 재생성 버튼으로 다시 돌린다.
- **동작 상세**:
  - **독립 프로퍼티 타입이 아니다.** 텍스트 프로퍼티에 붙는 **채우기 정책(fill policy)** 이다. 초판 전수표가 이것을 누락한 원인이기도 하다.
  - Basic Autofill 은 Business / Enterprise 플랜에 포함되며 **크레딧을 소모하지 않는다**. Custom Agent Autofill 은 **Notion 크레딧을 소모**한다.
  - Custom Agent 는 워크스페이스 검색, (허용 시) 웹 검색, 조건 분기, **여러 프로퍼티 동시 갱신**까지 수행한다 — 단순 텍스트 생성기가 아니라 액션 실행기다.
  - 값이 어떤 형태로 저장되는지는 헬프 문서에 명시되지 않는다 `[확인필요]`. 공개 API `property-object` 에도 AI autofill 관련 config 가 없다 `[확인필요: API 미노출]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | `페이지 편집 시` 모드에서 AI 가 채운 값이 다시 "편집"으로 간주됨 | **자기 트리거 루프.** AI 쓰기에 `origin='ai'` 를 찍어 재트리거를 막아야 한다 |
  | 본문이 비어 있는 행 | 생성 스킵. 환각 방지를 위해 **입력 없으면 실행 안 함**을 기본값으로 |
  | LLM 호출 실패 / 타임아웃 | 이전 값 보존 + 셀에 에러 배지. 빈 값으로 덮어쓰면 데이터 손실 |
  | 1만 행 일괄 채우기 | 레이트 리밋·비용 폭발. 배치 큐 + 예상 비용/건수 사전 고지 |
  | 사용자가 AI 가 채운 값을 손으로 수정 | 다음 자동 실행이 덮어쓰는가? 권고: **수동 편집 플래그(`manually_overridden`)를 세워 자동 갱신 대상에서 제외** |
  | 권한: 행을 볼 수 없는 사용자가 AI 채우기 실행 | 거부. LLM 프롬프트에 들어가는 컨텍스트도 **실행자 권한으로 필터**해야 한다 — 필터하지 않으면 권한 우회 유출 경로가 된다 |
  | 프롬프트 인젝션 | 페이지 본문은 신뢰할 수 없는 입력이다. 도구 호출 권한이 붙는 Custom Agent 에서 특히 위험 |
  | 결정성 없음 | 같은 입력에 같은 출력이 보장되지 않는다 → **정렬/필터 기준으로 쓰기 부적합**. formula 파생값과 성질이 다르다 |
  | 동시편집: A가 수동 재생성, B가 셀을 직접 편집 | 생성 완료 시점에 셀 버전을 비교해 **B의 편집이 더 최신이면 덮어쓰지 않는다** |
- **데이터 모델 함의**:
  ```sql
  -- 텍스트 프로퍼티에 붙는 정책. 별도 타입을 만들지 않는다.
  -- property.config 예:
  -- {"ai_fill": {"mode":"basic","action":"summary","run_on":["page_create","page_edit"]}}
  -- {"ai_fill": {"mode":"agent","prompt":"...","run_on":["manual","schedule"],"schedule":"0 9 * * 1"}}

  CREATE TABLE ai_fill_run (
    id uuid PRIMARY KEY, page_id uuid, property_id uuid,
    model text, prompt_hash text, input_tokens int, output_tokens int,
    status text, started_at timestamptz, finished_at timestamptz, error jsonb
  );
  ALTER TABLE page_property_value ADD COLUMN manually_overridden boolean NOT NULL DEFAULT false;
  ALTER TABLE page_property_value ADD COLUMN filled_by text NULL;   -- 'user' | 'ai' | 'automation' | 'template'
  ```
  - `filled_by` 는 UI 표기("AI가 채움" 배지), 루프 방지, 과금 회계 세 목적을 동시에 만족시킨다.
- **UI/인터랙션**: 셀 hover 시 재생성(↻) 아이콘, 생성 중 스트리밍/스켈레톤, 헤더에 AI 배지, 프로퍼티 설정에서 프롬프트 편집, 일괄 채우기 버튼과 진행률 표시.
- **의존 기능**: F-03-02, F-03-19(실행 시점 트리거 인프라 공유), LLM 게이트웨이, 크레딧/과금 모델, 권한 모델.
- **구현 난이도**: **M** (LLM 게이트웨이가 이미 있다면 프로퍼티 정책 + 실행 큐만 추가) ~ **L** (비용 제어·재시도·프롬프트 인젝션 방어·크레딧 회계까지 포함하면).
- **우선순위**: **P2** — 데이터베이스 코어의 정합성에는 기여하지 않는다. 다만 차별화 요소로는 투자 대비 효과가 큰 편.
- **클론 시 현실적 대안**: MVP는 `수동 실행 + 요약 1종` 만. 자동 실행 시점(`page_edit`)은 루프·비용 위험이 커서 v2 로 미룬다. 값은 일반 텍스트로 저장하고 `filled_by='ai'` 배지만 표시한다.
- **참고 출처**: https://www.notion.com/help/autofill , https://www.notion.com/help/notion-academy/lesson/ai-autofill-property

---

### F-03-21 데이터베이스 템플릿 (= 사실상의 프로퍼티 기본값 메커니즘)

- **한 줄 정의**: 새 행을 만들 때 미리 채워진 프로퍼티 값과 본문 블록 구조를 그대로 복제해 주는 행 원형(prototype).
- **사용자 시나리오**:
  1. 데이터베이스 우상단 `새로 만들기` 옆 드롭다운 화살표 → `+ 새 템플릿`.
  2. 템플릿 편집 화면에서 프로퍼티 값을 미리 입력하고 본문에 블록(체크리스트, 콜아웃, 하위 페이지 등)을 배치한다. 페이지 제목이 곧 템플릿 이름이 된다.
  3. 이후 `새로 만들기` 드롭다운에서 템플릿을 고르면 그 원형이 복제되어 새 행이 된다.
  4. 템플릿 `···` → `반복` → 매일/매주/매월/매년(또는 커스텀) + 시작일 + 시각 지정 → 주기마다 새 행이 자동 생성된다.
- **동작 상세**:
  - **노션에는 프로퍼티 단위 기본값 설정이 없다.** 헬프센터의 `database-properties` 문서에 default value 항목이 존재하지 않으며, 기본값을 표현하는 유일한 1차 수단이 이 템플릿이다. **초판이 "기본값"을 아예 다루지 않은 것은 누락이다.**
  - 템플릿은 **프로퍼티 값 + 본문 블록 트리 전체**를 담는다(원문: `Templates can contain any type of content, including images, embeds, and sub-pages`).
  - 개수 제한 없음(원문: `You can make as many as you want`).
  - **템플릿 중첩은 최대 3단계**이며, **일간 반복 템플릿은 중첩 템플릿을 포함할 수 없다**(주/월/년 반복만 중첩 가능).
  - 뷰별/전체 기본 템플릿 지정 가능 여부는 공식 헬프 문서에 **여전히 명시되어 있지 않다**(2026-09-06 재확인: `/help/database-templates` 전문에 "set as default" 문구 없음). 반면 복수의 2차 출처가 `Set as default` → `모든 뷰` 또는 `이 뷰만` 선택 UI 를 일관되게 보고한다 `[2차 출처: https://www.landmarklabs.co/notion-tutorials/database-default-values , https://wisechecker.com/notion-database-property-default-value/]`. **클론은 있다고 보고 구현하되(`is_default_for_ds` / `is_default_for_view` 2필드), 1차 확인은 미해결로 남긴다.**
  - **[2026 API 갱신] 템플릿이 API 표면에 올라왔다.** 2026-01-15 부터 `List data source templates` 엔드포인트가 추가되고, `Create page` / `Update page` 가 **`template` 파라미터**를 받는다. 같은 릴리스에 `Move page`(부모 변경)와 `position`(신규 페이지 배치 위치), `erase_content` 가 함께 들어왔다. → 템플릿을 "숨김 페이지"로 모델링하라는 이 문서의 권고와 정확히 부합한다(템플릿에 고유 id 가 있고 목록 조회가 가능하다는 뜻). (https://developers.notion.com/page/changelog)
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 템플릿이 참조하는 프로퍼티가 삭제됨 | 해당 값만 무시하고 나머지는 정상 적용 |
  | 템플릿이 참조하는 select 옵션이 삭제됨 | 빈 값으로 생성. 조용히 실패하면 사용자가 눈치채지 못한다 → 템플릿 편집 화면에 경고 배지 |
  | 반복 템플릿이 만든 행의 `created_by` | 시스템 생성 행의 생성자를 누구로 볼 것인가. 권고: **템플릿 소유자**로 고정하고 `origin='template_repeat'` 병기 `[확인필요: 노션 실동작]` |
  | 반복이 놓친 주기(서버 다운, 워크스페이스 비활성) | 밀린 주기를 몰아서 생성할지 스킵할지 정책 필요. 권고: **최근 1회만 생성** |
  | 템플릿 본문에 relation 이 들어 있음 | 복제본이 전부 같은 대상을 가리켜 fan-in 이 급증. 권고: relation 값은 복제 시 **선택적 초기화** |
  | 템플릿 자체를 수정 | 이미 생성된 행에는 **소급 적용되지 않는다**(복제 시점 스냅샷). 사용자가 가장 자주 오해하는 지점 → UI에 명시 |
  | 반복 템플릿 + 자동화 동시 발동 | `페이지 추가` 자동화가 함께 터진다. 의도인지 확인 필요 |
  | 템플릿 중첩 4단계 시도 | 거부 (문서상 3단계 상한) |
  | 동시편집: 두 사용자가 동시에 같은 템플릿으로 행 생성 | 각각 독립 복제. 충돌 없음. 단 unique_id 발급은 원자적이어야 한다(F-03-09) |
  | 권한: 템플릿 본문이 참조하는 하위 페이지에 접근 권한이 없는 사용자가 사용 | 복제 시 접근 불가 블록은 제외하고 경고 `[확인필요]` |
- **데이터 모델 함의**:
  ```sql
  CREATE TABLE db_template (
    id uuid PRIMARY KEY,
    data_source_id uuid REFERENCES data_source(id) ON DELETE CASCADE,
    prototype_page_id uuid REFERENCES page(id),   -- 템플릿 자체도 페이지다(숨김 상태)
    name text, icon jsonb, order_idx text,
    is_default_for_view uuid NULL,                -- NULL = 뷰 기본값 아님
    is_default_for_ds   boolean NOT NULL DEFAULT false,
    repeat_rule jsonb NULL,                       -- {freq:'weekly', interval:1, byday:['TU','TH'], at:'09:00', tz:'Asia/Seoul', start:'2026-01-01'}
    last_run_at timestamptz NULL,
    created_by uuid
  );
  ```
  - 핵심: **템플릿을 별도 자료구조로 만들지 말고 "숨김 플래그가 붙은 페이지"로 두어라.** 그러면 블록 트리 복제 로직을 페이지 복제와 100% 공유할 수 있다. 별도 구조로 만들면 블록 타입이 늘 때마다 두 곳을 고쳐야 한다.
  - `repeat_rule` 은 RFC 5545 RRULE 의 부분집합으로 두면 캘린더 반복 일정과 재사용된다.
  - `last_run_at` 으로 반복 실행을 멱등화한다. 크론 워커가 두 번 깨어나도 같은 주기를 두 번 만들지 않는다.
- **UI/인터랙션**: `새로 만들기` 분할 버튼(본체 클릭 = 기본 템플릿, 화살표 = 목록), 템플릿 목록 드래그 재정렬, 각 항목 `···`(편집/복제/삭제/반복/기본값으로 설정), 반복 설정 팝오버.
- **의존 기능**: F-03-01(행=페이지), 블록 복제(도메인 01), F-03-02(프로퍼티 값 사전 입력), F-03-09(unique_id 발급), 스케줄러(반복).
- **구현 난이도**: **M** — 페이지 복제를 재사용하면 템플릿 자체는 S 에 가깝다. **반복 스케줄러(타임존·놓친 주기·중복 실행 방지)** 가 나머지 비용의 대부분이다.
- **우선순위**: **P1** — MVP 없이도 동작하지만, "기본값"이라는 사용자 기대를 채우는 유일한 수단이라 체감 가치가 높다.
- **클론 시 현실적 대안**: 1단계는 **반복 없는 템플릿**만(= 페이지 복제 + 기본 템플릿 지정). 반복은 v2 에서 단일 cron 워커로. 중첩 템플릿은 범위 밖.
- **참고 출처**: https://www.notion.com/help/database-templates , https://www.notion.com/help/guides/automate-work-repeating-database-templates

---

### F-03-22 데이터베이스 잠금 & 스키마 권한 분리

- **한 줄 정의**: 데이터 입력 권한과 **스키마/뷰 변경 권한**을 분리해, 아무나 컬럼과 뷰를 바꾸지 못하게 한다.
- **사용자 시나리오**:
  1. 데이터베이스 우상단 `···` → `데이터베이스 잠금` 토글 ON.
  2. 잠금 상태에서도 다른 사용자는 **행을 추가하고 셀 값을 계속 입력할 수 있다.**
  3. 그러나 프로퍼티 추가/삭제/타입 변경, 뷰 추가/필터 변경은 차단된다.
  4. 잠금 해제는 같은 메뉴에서 다시 토글.
- **동작 상세**:
  - 헬프 원문: `When you turn this on, people can still enter data, but they can't change views or properties.` — 잠금은 **행 데이터가 아니라 스키마·뷰 레이어에만** 걸린다. 이 경계가 이 기능의 전부다.
  - 데이터베이스 설정 메뉴에는 잠금 외에 프로퍼티 편집, 자동화, 하위 항목, 종속 관계, 스프린트, 커넥션, 페이지 레이아웃 커스터마이즈가 함께 있다 — **이들 전부가 잠금의 보호 대상**으로 묶이는 것이 자연스럽다 `[추정: 헬프 문서는 views/properties 만 명시]`.
  - 자동화 생성에는 **해당 데이터베이스에 대한 전체 액세스 권한**이 필요하다(F-03-19).
  - button 실행 권한은 `전체 허용` / `편집 가능` / `콘텐츠 편집 가능` 3단계로 별도 관리된다(F-03-15). 즉 노션의 권한은 이미 **행/스키마/실행** 세 축으로 갈라져 있다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 잠금 중 API 로 스키마 변경 시도 | **UI 와 동일하게 거부되어야 한다.** UI 에서만 막고 API 를 열어두면 잠금이 무의미하다 `[확인필요: 노션 API 실동작]` |
  | 잠금 중 formula/rollup 자동 재계산 | 허용(시스템 쓰기이지 스키마 변경이 아니다) |
  | 잠금 중 자동화가 프로퍼티 **값** 을 편집 | 허용. 자동화 **정의** 변경은 차단 |
  | 잠금 해제 권한자가 사라짐(퇴사) | 워크스페이스 관리자 우회 경로 필요 |
  | 잠금 중 데이터베이스 복제 | 복제본이 잠금을 상속할지 결정 필요. 권고: **상속하지 않음** |
  | 동시에 두 명이 잠금 토글 | 스키마 변경과 동일하게 낙관적 잠금(version) 대상 |
  | 행 페이지별 권한이 서로 다름 | DB 잠금과 페이지 권한은 **직교**한다. 잠금은 스키마, 권한은 행 가시성 |
  | 대용량: 권한이 다른 사용자 1,000명이 동시에 뷰 조회 | 권한 판정을 행마다 하면 O(행×사용자). **요청당 capability 1회 계산 + 행 술어 1개**로 접어야 한다 |
- **데이터 모델 함의**:
  ```sql
  ALTER TABLE database
    ADD COLUMN locked    boolean NOT NULL DEFAULT false,
    ADD COLUMN locked_by uuid NULL,
    ADD COLUMN locked_at timestamptz NULL;

  -- 권한 판정은 "레이어"를 명시적으로 나눈다
  -- capability := (actor, database) -> {
  --   read_rows, write_rows, create_rows,
  --   edit_schema,      -- locked 이면 false 로 강제
  --   edit_views,       -- locked 이면 false 로 강제
  --   edit_automations, -- full access 필요
  --   run_buttons
  -- }
  ```
  - **권고: 권한 판정을 boolean 한 개(`can_edit`)로 두지 마라.** 노션의 실제 모델은 최소 4개 레이어(행 읽기 / 행 쓰기 / 스키마 / 자동화)이며, 잠금은 그중 두 레이어를 덮어쓰는 오버레이다. 단일 boolean 으로 시작하면 잠금·button 실행 권한·자동화 권한을 끼워 넣을 자리가 없다.
  - 권한 계산은 **페이지 트리 상속 + 데이터베이스 오버레이 + 잠금 오버레이**의 3단 합성이다. 행 목록 조회마다 N번 계산하면 안 되고, 요청 단위로 `capability` 를 1회 계산해 캐시한다.
  - 이 결정은 F-03-11(rollup 의 권한 필터링)과 F-03-13(파생값 캐시의 권한 클래스 분할)에 직접 파급된다.
- **UI/인터랙션**: 잠긴 DB 헤더에 자물쇠 배지, 스키마 관련 메뉴 항목을 **숨김이 아니라 비활성 + 사유 툴팁**으로 표시, 잠금 토글 시 토스트.
- **의존 기능**: 권한 모델(별도 도메인), F-03-02, F-03-17(권한 술어), F-03-19, 뷰 시스템(도메인 04).
- **구현 난이도**: **M~L** — 잠금 플래그 자체는 S 다. 그러나 **권한 판정 레이어를 쪼개는 리팩터링**이 동반되며, 뒤로 미룰수록 비싸진다. 권한은 이 도메인에서 formula 다음으로 과소평가되는 항목이다.
- **우선순위**: **P1** — 다중 사용자 워크스페이스를 전제하면 사실상 P0. 단일 사용자 MVP 면 P2.
- **클론 시 현실적 대안**: MVP 에서 잠금 UI 는 생략해도 좋지만, **`capability` 를 레이어 분리된 객체로 반환하는 함수 시그니처만은 처음부터 도입하라.** 내부 구현이 당분간 전부 `true` 를 반환해도 무방하다.
- **참고 출처**: https://www.notion.com/help/customize-your-database , https://www.notion.com/help/database-automations , https://www.notion.com/help/database-buttons

---

### F-03-23 verification 프로퍼티 & Owner 자동 동반 생성 (문서 신뢰도 상태 머신)

- **한 줄 정의**: 페이지(=행)에 "이 내용은 아직 유효하다"는 만료 시각이 있는 인증 상태를 부여하고, 만료되면 소유자에게 재검토 알림을 보낸다.
- **사용자 시나리오**:
  1. 데이터베이스에 프로퍼티 추가 → `확인(Verification)` 선택. **이때 `Owner`(사람) 프로퍼티가 자동으로 함께 생성된다.**
  2. 행을 열면 상단에 인증 배너/셀이 보이고, `확인` 버튼을 누른다.
  3. 만료 조건을 고른다: **특정 시각까지** 또는 **무기한**(원문: `until a specific time or indefinitely`).
  4. 인증된 페이지는 `@` 멘션과 검색 결과에서 **파란 체크 표시**를 얻는다.
  5. 만료되면 Owner 의 Notion 인박스와 이메일로 알림이 오고, 체크 표시와 검색 우선순위를 잃는다.
- **동작 상세**:
  - 헬프 원문: `you can also add verification as a property to an entire database to verify all of the database's pages` — **위키 전용이 아니다.** 1차 GAP 문서의 "위키에서만 노출되는 특수 프로퍼티로 보인다 `[확인필요]`" 는 오판이었다.
  - 프로퍼티 추가가 **다른 프로퍼티(Owner)를 자동 생성**하는 유일한 사례다. sub-item/dependency(F-03-18)가 프로퍼티 *쌍* 을 만드는 것과 형태가 비슷하지만, 이쪽은 **타입이 다른 프로퍼티를 끌어온다.**
  - 인증 권한: 해당 페이지에 `편집 가능` 또는 `전체 액세스` 필요. 위키에서는 페이지 생성자가 기본 Owner 가 되며 Owner 는 언제든 변경 가능하다.
  - 플랜: **Business / Enterprise 전용.**
  - 만료 효과: 파란 체크 상실 + **검색·AI 응답에서의 우선순위 상실** `[2차 출처: https://www.sparxno.com/blog/notion-wikis-verified-pages — 공식 헬프는 알림만 명시]`. 2026-08-31 변경으로 **검색 결과가 verification 상태를 컨텍스트로 노출**하게 되었다(1차: changelog).
  - API: `property-object` 타입 목록에 `verification` 은 **없다**. 그러나 2026-08-13 부터 **뷰 필터에서 verification 조건(`status`, `does_not_equal`)을 지원**한다 → API 표면에 부분 노출.
  - 7/30/90일 같은 프리셋 기간은 공식 헬프에서 확인되지 않는다 `[확인필요: 2차 출처만 보고]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 | 인증되지 않은 상태(`unverified`). null 과 `expired` 를 **구분**해야 한다 — 한 번도 인증 안 된 것과 인증이 만료된 것은 의미가 다르다 |
  | Owner 프로퍼티를 사용자가 삭제 | verification 이 알림 대상을 잃는다. 권고: **Owner 삭제를 차단하거나, 삭제 시 verification 도 함께 비활성화** |
  | Owner 가 워크스페이스를 떠남 | 만료 알림이 갈 곳이 없다 → 폴백(팀스페이스 관리자)을 정의. 정의하지 않으면 알림이 조용히 유실된다 |
  | 인증 후 페이지 본문이 수정됨 | **인증이 자동 해제되는가?** 공식 문서에 없다 `[확인필요]`. 클론 권고: `verified_at < page.edited_at` 이면 UI 에 "인증 이후 수정됨" 배지를 띄우되 상태는 유지 |
  | 만료 시각이 과거로 소급 설정됨 | 즉시 `expired` 로 전이 + 알림 1회. 소급 구간마다 알림을 반복 발송하면 안 된다 |
  | 동시편집: A가 인증, B가 같은 순간 인증 해제 | 단일 상태 필드 LWW. 단 **알림은 최종 상태 기준 1회만** 발화(F-03-05 의 status 자동화 규칙과 동일 원칙) |
  | 권한: 읽기 전용 사용자 | 인증 버튼 비노출. 배지는 보인다 |
  | 삭제된 참조: 인증된 페이지가 휴지통으로 | 만료 스케줄을 취소해야 한다. 복원 시 재예약 |
  | 대용량: 10만 행에 verification 부여 | 만료 스케줄이 10만 건. **행마다 타이머를 만들지 말고 `expires_at` 인덱스 + 주기 스캔 워커**로 처리 |
  | 순환 참조 | 해당 없음(파생값이 아니다) |
  | 대량 인증(일괄 확인) | 만료 시각이 동일해져 **알림 폭풍**이 발생한다 → 알림 배치/요약 필요 |
- **데이터 모델 함의**:
  ```sql
  -- 값은 셀이 아니라 상태 머신이다
  CREATE TABLE page_verification (
    page_id      uuid PRIMARY KEY REFERENCES page(id) ON DELETE CASCADE,
    property_id  uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
    state        text NOT NULL,        -- 'unverified' | 'verified' | 'expired'
    verified_by  uuid NULL REFERENCES app_user(id),
    verified_at  timestamptz NULL,
    expires_at   timestamptz NULL,     -- NULL = 무기한(indefinitely)
    notified_at  timestamptz NULL      -- 만료 알림 멱등성 보장
  );
  CREATE INDEX ON page_verification (expires_at) WHERE state = 'verified';
  -- 불변식 1: state='verified' AND expires_at < now() 인 행은 스캔 워커가 'expired' 로 전이시킨다
  -- 불변식 2: verification 프로퍼티 생성 시 같은 data_source 에 people 타입 'Owner' 프로퍼티를 트랜잭션으로 함께 생성
  ALTER TABLE property ADD COLUMN companion_property_id uuid NULL REFERENCES property(id);
  -- verification -> Owner 를 가리킨다. 삭제 정책을 여기에 건다.
  ```
  - `state` 를 셀 값 jsonb 안에 넣지 말고 **별도 테이블**로 빼라. 만료 스캔이 `page_property_value` 전체를 훑는 참사를 막는다.
  - `notified_at` 없이 만들면 워커가 재시작될 때마다 만료 알림이 중복 발송된다.
- **UI/인터랙션**: 페이지 상단 인증 배너(`확인` 버튼 / 만료 시각 표시), 멘션·검색 결과의 파란 체크 배지, 셀에는 상태 아이콘 + 만료 D-day, 프로퍼티 설정에서 기본 만료 기간 지정.
- **의존 기능**: F-03-02(스키마), F-03-07(people — Owner), 알림 시스템, 스케줄러(만료 스캔), 검색 랭킹(우선순위 반영 시), 권한 모델.
- **구현 난이도**: **M** — 상태 머신 자체는 S 지만 (a) 만료 스케줄러 멱등성, (b) Owner 동반 생성/삭제 정책, (c) 알림 폭풍 억제가 붙는다. 검색 랭킹 반영까지 하면 **L**.
- **우선순위**: **P2** — 데이터베이스 코어 정합성과 무관하다. 다만 **사내 위키/문서 관리형 클론이 목표라면 P1**(문서 신선도가 그 제품의 핵심 가치이므로).
- **클론 시 현실적 대안**: MVP 는 `verified / unverified` 2상태 + 수동 만료일만. 알림은 인앱 배지로만 시작하고 이메일은 v2. 검색 우선순위 반영은 범위 밖.
- **참고 출처**: https://www.notion.com/help/wikis-and-verified-pages , https://developers.notion.com/page/changelog , https://www.sparxno.com/blog/notion-wikis-verified-pages `[2차]`

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-03-01 | database / data source / page 3계층 | L | P0 | 블록 시스템 |
| F-03-02 | 프로퍼티 스키마 관리 | M~L | P0 | F-03-01, F-03-22 |
| F-03-03 | 기본 스칼라 타입 7종 | S~M | P0 | F-03-02 |
| F-03-04 | select / multi-select | M | P0 | F-03-02 |
| F-03-05 | status (옵션 + 그룹) | M | P1 | F-03-04 |
| F-03-06 | date (범위/시간/타임존) | M | P0 | F-03-02 |
| F-03-07 | person / files / place | S / M / **S~M** | P0 / P1 / P2 | 사용자·스토리지·지오코딩 |
| F-03-08 | 자동 메타 프로퍼티 4종 | S~M | P0 | F-03-01 |
| F-03-09 | unique ID | M | P1 | F-03-02 |
| F-03-10 | relation (단/양방향, 자기참조) | L | P0 | F-03-01, F-03-02 |
| F-03-11 | rollup | L | P1 | F-03-10 |
| F-03-12 | formula 엔진 | XL | P1 | F-03-10, 전 타입 |
| F-03-13 | 의존성 그래프 & 재계산 | XL | P1 | F-03-10~12 |
| F-03-14 | 타입 변환 & 마이그레이션 | L | P1 | F-03-02, F-03-13 |
| F-03-15 | button 프로퍼티 | L | P2 | F-03-12, 권한, 알림 |
| F-03-16 | 셀 편집 UX 공통 규약 | L | P0 | 전 타입, 뷰 |
| F-03-17 | 필터·정렬 연산자 규약 | L | **P0** | F-03-02, 전 타입, 권한 |
| F-03-18 | sub-item & dependency | L | P1 | F-03-10, F-03-06, F-03-17 |
| F-03-19 | 데이터베이스 자동화 | XL | P2 | F-03-15, F-03-13, F-03-22 |
| F-03-20 | AI 자동 채우기 | M~L | P2 | F-03-02, F-03-19, LLM |
| F-03-21 | 데이터베이스 템플릿(=기본값) | M | P1 | F-03-01, 블록 복제, F-03-09 |
| F-03-22 | DB 잠금 & 스키마 권한 분리 | M~L | P1 | 권한 모델, F-03-02 |
| F-03-23 | verification & Owner 동반 생성 | M(검색랭킹 포함 시 L) | P2 (위키형이면 P1) | F-03-02, F-03-07, 알림·스케줄러 |

> **GAP 검토(2026-09-06)에서 조정된 등급**
> | ID | 이전 | 이후 | 근거 |
> |---|---|---|---|
> | F-03-02 | M | **M~L** | 스키마 변경이 F-03-13 의존 그래프 재검증 + F-03-14 마이그레이션 잡을 동시에 트리거한다 |
> | F-03-08 | S | **S~M** | `last_edited_time` 이 쓰기 증폭·실시간 재정렬 브로드캐스트의 진원지 |
> | F-03-13 | XL | **XL(유지, 사유 보강)** | 권한이 곱해지면 파생값 캐시가 권한 클래스별 N벌로 쪼개진다 |
> | F-03-17 | (없음) | **L / P0** | 뷰의 전제 조건인데 초판에 누락 |
> | F-03-22 | (없음) | **M~L / P1** | 권한을 단일 boolean 으로 시작하면 되돌리기 비용이 가장 큰 항목 |
>
> **2차 GAP(2026-09-06 후반)에서 추가 조정**
> | ID | 이전 | 이후 | 근거 |
> |---|---|---|---|
> | F-03-07(place) | M | **S~M** | 노션의 place 는 필터·정렬이 전부 텍스트 기반 → 공간 인덱스/PostGIS 불필요 |
> | F-03-17 | L / P0 | **L / P0 (유지, 범위 확대)** | `me`·상대날짜 필터로 **필터 AST 에 평가 컨텍스트 노드**가 들어옴 → 결과 캐시 키가 `(view_id, actor_id, 평가일)` 로 쪼개진다. Views API(2026-03) 로 뷰가 1급 리소스가 되어 서버 모델링 필수 |
> | F-03-23 | (없음) | **M / P2** | 초판·1차 GAP 모두 누락. 프로퍼티가 다른 프로퍼티를 자동 생성하는 유일 사례이며 만료 스케줄러가 붙는다 |

### 의존 순서(구현 순서 제안)

```
F-03-01 ─┬─ F-03-02 ─┬─ F-03-03 ─┐
         │           ├─ F-03-04 ─┼─ F-03-16 (그리드 UX)
         │           ├─ F-03-06 ─┤
         │           ├─ F-03-07 ─┘
         │           ├─ F-03-05 (status)
         │           ├─ F-03-09 (unique ID)
         │           └─ F-03-10 (relation) ─┬─ F-03-11 (rollup) ─┐
         └─ F-03-08 (메타)                  └─ F-03-12 (formula) ┴─ F-03-13 (재계산)
                                                                  └─ F-03-14 (타입 변환)
                                                                  └─ F-03-15 (button) ─ F-03-19 (자동화) ─ F-03-20 (AI 채우기)

F-03-02 ─┬─ F-03-17 (필터/정렬)  ← 뷰(도메인 04)의 전제
F-03-10 ─┴─ F-03-18 (sub-item / dependency)
F-03-01 ─── F-03-21 (템플릿 = 기본값)
권한모델 ─── F-03-22 (DB 잠금) ─┬─→ F-03-11 (권한 필터링된 rollup)
                                └─→ F-03-13 (권한 클래스별 파생값 캐시)
F-03-02 ─┬─ F-03-23 (verification) ─── Owner(F-03-07 people) 자동 동반 생성
         └────────────────────────── 알림 시스템 + 만료 스캔 스케줄러
```

### 수정된 단계별 로드맵

| 단계 | 포함 | 제외(의도적) |
|---|---|---|
| **MVP** | F-03-01, 02, 03, 04, 06, 07(person), 08, 10(양방향만), 16(기본 편집), **17(축소 연산자)** | formula, rollup, 타입 변환, 자동화, AI |
| **v1** | 05(status), 09(unique ID), 11(rollup, on-read), 07(files), **21(반복 없는 템플릿)**, **22(capability 레이어)** | 반복 스케줄러, 파생값 캐시 |
| **v2** | 12(최소 formula), 13(stale 캐시 + 위상 정렬), 14(안전 변환 쌍), **18(sub-item)** | dependency 자동 날짜 이동 |
| **v3** | 15(button), **19(자동화)**, **20(AI 채우기)**, 18(dependency 날짜 전파), place, **23(verification)** | 검색 랭킹 반영, 이메일 알림 |

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인 관련 접근 | 차용 가능한 점 | 주의 |
|---|---|---|---|
| **AppFlowy** (Rust + Flutter) | `Field` 가 `field_type: FieldType` enum 을 가지고, 타입별 설정은 `TypeOption` trait 구현체로 분리. `typeOptions` 는 `Map<FieldType, TypeOption>` 이라 **한 필드가 여러 타입의 설정을 동시에 보관**한다 | **타입 변환 시 이전 타입의 TypeOption 이 남아 있어, 되돌리면 설정이 복원된다.** F-03-14 의 손실 문제를 구조적으로 해결한 좋은 패턴 — 차용 강력 권고 | Rust/Flutter 스택이라 코드 직접 이식은 불가, 설계만 차용 |
| **Teable** (TS + Postgres) | data source 마다 실제 Postgres 물리 테이블 생성. 필드 = 컬럼 | 정렬/필터/집계를 네이티브 SQL 로 처리 → 100만 행 이상에서 유리. link/rollup/formula 를 갖춘 오픈소스 참조 구현 | 스키마 변경이 온라인 DDL. 프로퍼티 500개, 잦은 타입 변경 시나리오에 취약 |
| **NocoDB** (TS) | relation/lookup/rollup/formula 를 **virtual column** 으로 정의하고 쿼리 시점에 SQL 로 해석. 40+ 필드 타입. formula 안에서 `{필드명}` 참조, nested formula(수식이 다른 수식 참조) 지원 — **[정정] 노션도 이를 지원한다(체인 깊이 15 제한). 초판은 이를 NocoDB 만의 확장으로 오해했다** | rollup 에 필터 조건을 붙일 수 있게 한 확장(노션에는 없음)이 유용. lookup 을 rollup 과 별도 타입으로 분리한 것도 참고 | 노션과 UX 모델이 다름(스프레드시트 지향) |
| **AFFiNE / BlockSuite** | database 블록이 존재하나 프로퍼티 타입 폭과 relation/rollup/formula 깊이는 노션 대비 얕다 `[확인필요: 최신 버전 기준 재확인]` | 블록 안에 표를 넣는 블록-DB 통합 모델 참고 | 이 도메인의 참조 대상으로는 약함 |
| **Outline / Docmost** | 위키형. 데이터베이스 프로퍼티 개념이 사실상 없음 | 이 도메인에서는 참고 가치 낮음 | — |

### 이 도메인에 대한 기술 스택 권고

- **저장소**: Postgres. 셀은 EAV(`page_property_value`) + 정렬/필터용 타입별 파생 컬럼(`num_value`, `text_value`, `date_value`) 병행. relation 은 반드시 엣지 테이블.
- **타입 시스템**: TypeScript 판별 유니온으로 `PropertyConfig` / `PropertyValue` 를 정의하고, 타입별 모듈이 `{ validate, parse, serialize, compare, format, convertFrom }` 6개 함수를 구현하는 **레지스트리 패턴**. AppFlowy 의 `TypeOption` trait 과 동형이다. 새 타입 추가가 파일 1개 추가로 끝난다.
- **formula**: 파서 제너레이터(`peggy`/`chevrotain`) 또는 Pratt parser 로 자체 구현. **절대 `eval` 금지.** AST 를 DB 에 캐시.
- **재계산**: MVP는 lazy(on-read). 확장 시 `stale` 플래그 + 잡 큐(BullMQ 등).

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| ~~1~~ | ~~formula 가 다른 formula 를 참조할 수 있는가~~ | **해결됨(2026-09-06)**: 가능하다. 참조 체인 깊이 **15** 제한(2024-08 이전 7), rollup 경유 및 DB 경계 초과에도 누적, 초과 시 무경고 실패 | https://thomasjfrank.com/formulas/property-reference-limits/ `[2차 출처]` |
| 2 | unique ID 프로퍼티를 삭제 후 재추가하면 번호가 1부터 다시 시작하는가 | 페이지에 시퀀스를 영속할지, 프로퍼티에 둘지 결정 | 테스트 DB 에서 실측 |
| 3 | 양방향 relation 의 한쪽 프로퍼티를 삭제하면 반대쪽은 어떻게 되는가 | 엣지 보존/삭제 정책 결정 | 실측 |
| 4 | 단방향 ↔ 양방향 전환 시 기존 엣지가 보존되는가 | 마이그레이션 설계 | 실측 |
| 5 | 각 타입 변환 쌍의 정확한 손실 규칙 | F-03-14 변환 매트릭스의 근거. 현재 상당수가 2차 출처/추정 | 24개 타입 × 주요 변환 쌍 실측 매트릭스 작성 |
| 6 | `last_edited_time` 이 갱신되는 정확한 조건 (하위 블록 편집, 파생값 재계산 포함 여부) | 무한 루프 방지 | 실측 |
| 7 | button 액션 시퀀스 중간 실패 시 롤백 여부 | 트랜잭션 경계 설계 | 실측 |
| 8 | status 셀을 완전히 빈 값으로 둘 수 있는가 | 불변식 결정 | 실측 |
| 9 | date 프로퍼티의 표시 포맷/타임존 config 스키마 (API 미노출) | config 설계 | 노션 내부 API(`/api/v3`) 응답 관찰 또는 UI 역추적 |
| 10 | place 프로퍼티의 저장 스키마와 지오코딩 제공자 | 외부 의존 비용 산정 | API 응답 확인 (현재 `place` config 는 `{}` 로만 문서화됨) |
| 11 | 동명 프로퍼티 허용 여부 | formula 의 `prop("이름")` 해석 모호성 | 실측 |
| ~~12~~ | ~~rollup 대상으로 formula 를 지정할 수 있는가~~ | **해결됨(2026-09-06)**: 가능하다. date 프로퍼티의 종료일을 rollup 하려면 `dateEnd()` formula 를 경유하는 것이 표준 우회법으로 통용된다 | https://thomasjfrank.com/formulas/reference-properties-in-formulas/ `[2차 출처]` |
| 13 | 참조 체인 깊이 15 초과 시 노션이 정말 아무 경고도 안 주는가 | 클론이 "경고를 준다"는 개선점을 내세울 수 있는지 판단 | **부분 해소(2026-09-06)**: 깊이 15 자체는 공식 헬프가 `Formula depth limit reached` 라는 **에러 항목으로 명시**한다(https://www.notion.com/help/common-formula-errors) → 적어도 UI 에 에러 표기 경로는 존재한다. "조용히 실패" 주장은 2차 출처에만 있으므로 **16단 체인 실측 필요** |
| 14 | 프로퍼티 표시 규칙이 여전히 "값 있을 때만 표시"를 지원하는가 | F-03-02 / F-03-16 의 표시 모델. 현행 헬프 문서(`/help/layouts`)에는 눈 아이콘 토글 + 배치 영역만 있고 조건부 표시가 없다 | 레이아웃 빌더 UI 실측 |
| 15 | 데이터베이스 잠금이 공개 API 의 스키마 변경도 막는가 | 잠금이 실질적 보호인지 UI 장식인지 결정 | 잠긴 DB 에 `PATCH /v1/data_sources/{id}` 시도 |
| 16 | 자동화의 `속성 편집` 트리거가 formula/rollup 파생값 변경에도 발화하는가 | 재계산 ↔ 자동화 무한 연쇄 가능성 | rollup 이 변하는 시나리오로 실측 |
| 17 | sub-item 중첩 깊이 상한과 부모 삭제 시 자식 처리 | 트리 렌더·삭제 정책 | 실측 |
| 18 | 반복 템플릿이 만든 행의 `created_by` 는 누구인가 | 감사 로그·알림 대상 결정 | 반복 템플릿 1회 발동 후 확인 |
| 19 | `this_week` 등 상대 날짜 필터의 주 시작 요일·타임존 기준 | 필터 결과가 사용자마다 달라지는지 | 로캘/타임존이 다른 두 계정으로 동일 뷰 비교 |
| 20 | button / verification 프로퍼티를 공개 API 로 읽을 수 있는가 | API 타입 집합 확정 | **부분 해소(2026-09-06)**: `property-object` 타입 목록에 둘 다 없음을 재확인. 단 verification 은 **뷰 필터에서는 지원**된다(2026-08-13). 남은 질문은 `retrieve data source` 응답에 두 프로퍼티가 어떤 형태(누락 / `unsupported`)로 나오는가 |
| 21 | status 의 "기본 옵션(default option)" 이 공식 기능인가 | 노션에서 유일한 프로퍼티 기본값이므로 데이터 모델(`default_option_id`)의 근거가 된다. 현재 2차 출처만 존재 | 상태 프로퍼티 설정 UI 에서 기본 지정/해제 후 신규 행 생성 실측 |
| 22 | 데이터베이스 템플릿의 `Set as default`(전체/이 뷰만) 가 실제 UI 에 있는가 | `is_default_for_ds` / `is_default_for_view` 2필드가 필요한지 결정 | 현행 UI 실측. 공식 헬프에는 문구 없음, 2차 출처 다수 보고 |
| 23 | verification 만료 프리셋(7/30/90일)이 실제로 존재하는가 | 만료 스케줄 UI 설계 | 공식 헬프는 `until a specific time or indefinitely` 만 명시 → UI 실측 |
| 24 | 인증된 페이지의 본문이 수정되면 verification 이 자동 해제되는가 | "인증 이후 수정됨" 배지가 필요한지 결정 | 인증 후 본문 편집 실측 |
| 25 | `place` 값 객체의 정확한 API JSON 스키마 | 지오코딩 결과 저장 필드 확정. `property-object` 는 place 를 타입으로만 열거하고 값 구조를 기술하지 않음 | place 값이 있는 페이지를 `retrieve page` 로 조회 |
| 26 | `database_type`(tasks/projects/skills)이 동작을 어떻게 바꾸는가 | 단순 라벨인지, 자동화·AI 분기의 근거인지 | 세 타입으로 DB 를 만들어 UI 차이 관찰 |
| 27 | 쿼리 페이지네이션 10,000 상한이 UI 뷰에도 적용되는가 | 대용량 DB 의 무한 스크롤 설계 | 1만 행 초과 DB 를 표 뷰에서 끝까지 스크롤 |

---

## 출처

### 1차 출처 (공식)

1. https://www.notion.com/help/database-properties — 프로퍼티 타입 전수, 500개 한도, 조건부 색상 지원 타입, 표시 규칙
2. https://www.notion.com/help/intro-to-databases — "데이터베이스 = 페이지 컬렉션" 정의, 인라인/전체 페이지, 다중 data source, 1,000행 이후 정렬 동작
3. https://developers.notion.com/reference/property-object — 각 프로퍼티 타입의 JSON 스키마, rollup 함수 전수, number format 전수, status options/groups, relation single/dual property, unique_id prefix
4. https://developers.notion.com/reference/update-property-schema-object — 스키마 변경 API: 이름 변경, `null` 로 삭제, title 불변 제약, 기존 select/status 옵션의 name·color 변경 불가
5. https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03 — database vs data source 객체 구조, 엔드포인트 변경, relation 의 data_source_id 참조
6. https://www.notion.com/help/relations-and-rollups — relation 생성 절차, 단/양방향 토글, 자기참조, 1페이지 제한, rollup 3단 설정, 집계 옵션 목록, rollup 중첩 불가
7. https://www.notion.com/help/formula-syntax — formula 데이터 타입, 연산자, dot notation, let/lets, 함수 카테고리별 목록
8. https://www.notion.com/help/guides/new-formulas-whats-changed — Formulas 2.0 변경점: 출력 타입 확장(page/date/person/list), map/filter 로 relation 직접 접근, 멀티라인·주석, 레거시 수식 자동 마이그레이션
9. https://www.notion.com/help/unique-id — 번호 1부터 시작, 삭제 페이지도 번호 소비, 번호 불변, 접두사 필요 시 URL 접근
10. https://www.notion.com/help/database-buttons — 버튼 액션 10종, 알림 20명 한도, 플랜별 제약, 권한 요구사항
11. https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks — status 기본 3그룹, 세부 상태 추가
12. https://www.notion.com/help/maps — place 프로퍼티와 map view 연동

### 2차 출처 (구현 참고 / 검증 대상)

13. https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/frontend/grid — AppFlowy `FieldType` + `TypeOption` trait, `typeOptions` 맵 구조
14. https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion — Teable 의 Postgres 물리 테이블 매핑
15. https://deepwiki.com/nocodb/nocodb/5.4-formula-system — NocoDB virtual column (LinkToAnotherRecord / Lookup / Rollup / Formula), nested formula
16. https://nocodb.com/docs/product-docs/fields/field-types/links-based/rollup — rollup 에 필터 조건 적용
17. https://restora.cc/blog/notion-property-type-changes-are-permanent — 타입 변환 손실, 버전 히스토리가 스키마를 스냅샷하지 않음 `[검증 필요: 2차 출처]`
18. https://thomasjfrank.com/notion-databases-can-now-have-multiple-data-sources/ — 다중 data source 도입 배경과 위키 미지원
19. https://notiontomaps.com/blog/notion-place-property-complete-guide — place 프로퍼티 저장 필드 추정 `[검증 필요: 2차 출처]`

### GAP 검토(2026-09-06)에서 추가 확인한 출처

**1차 출처**

20. https://developers.notion.com/reference/post-database-query-filter — 프로퍼티 타입별 필터 연산자 전수, compound `and`/`or` 중첩 2단계 상한, timestamp 필터
21. https://developers.notion.com/reference/request-limits — 페이지네이션 응답당 100건(블록 트리 모든 레벨), 커넥션당 평균 3 req/s, HTTP 429 `rate_limited`
22. https://www.notion.com/help/database-automations — 트리거 3종(페이지 추가/속성 편집/반복), 3초 판정 윈도우, **"Database automations can't be triggered by other automations"**, 알림 20명 한도, 유료 플랜 제약, 전체 액세스 권한 요구
23. https://www.notion.com/help/tasks-and-dependencies — sub-item/dependency 프로퍼티 쌍, 뷰별 필터 스코프(`Parents only` / `Parents and sub-items` / `Sub-items only`), 보드·캘린더·갤러리는 parents only, 날짜 이동 3정책, 이동 시 하위 항목 승격
24. https://www.notion.com/help/customize-your-database — **"When you turn this on, people can still enter data, but they can't change views or properties."**(DB 잠금), 하위 항목·종속 관계·스프린트·커넥션·페이지 레이아웃 설정 위치
25. https://www.notion.com/help/database-templates — 템플릿이 담는 것(프로퍼티 값 + 본문 블록), 개수 무제한, **중첩 최대 3단계**, 일간 반복 템플릿은 중첩 불가, 반복 주기/시작일/시각 설정
26. https://www.notion.com/help/autofill — AI Autofill(Basic vs Custom Agent), 동작 3종(Summary/Translate/Key info), 실행 시점(수동/생성 시/편집 시/일정), Business·Enterprise 포함 vs 크레딧 소모
27. https://www.notion.com/help/layouts — 페이지 레이아웃 빌더: 눈 아이콘 표시/숨김, 배치 영역(헤딩 최대 15개 / 본문 / 상세 패널), Simple·Tabbed 구조, `모든 페이지에 적용`
28. https://www.notion.com/help/notion-academy/lesson/ai-autofill-property — AI autofill 프로퍼티 실습 관점 설명
29. https://www.notion.com/releases/2022-12-15 — sub-task & dependency 도입 릴리스 노트

**2차 출처 (검증 대상이지만 이 주제에 대한 유일한 구체적 근거)**

30. https://thomasjfrank.com/formulas/property-reference-limits/ — **참조 체인 깊이 15**(2024-08 이전 7), rollup 경유·DB 경계 초과에도 누적, 초과 시 무경고 실패. 초판의 "formula 간 참조 불가" 서술을 뒤집은 근거
31. https://github.com/TomFrankly/notion-formula-docs/blob/public/reference/property-reference-limits.md — 위 문서의 구버전(한도 7). 두 버전 비교로 한도 상향 사실을 교차 확인
32. https://thomasjfrank.com/formulas/reference-properties-in-formulas/ — `prop()` 이 저장 시 property **id** 로 바인딩된다는 점, rollup 이 formula 를 대상으로 삼는 표준 우회법

### 2차 GAP 검토(2026-09-06 후반)에서 추가 확인한 출처

**1차 출처**

33. https://developers.notion.com/page/changelog — 2026년 변경 전수: API `2026-03-11`(breaking, `archived`→`in_trash`), **Views API 출시(2026-03-19, 8 엔드포인트 + 3 웹훅 + 10개 뷰 타입)**, status 프로퍼티 API 생성·수정(2026-03/06), 옵션 `group` 필드(2026-06-22), **formula 표현식 API 왕복 + 유효성 에러 반환(2026-08-12)**, `me` 필터·상대 날짜 값(2026-03-30), select/status 다중값 필터(2026-04-17), **페이지네이션 최대 깊이 10,000 + `request_status: incomplete`(2026-04-20)**, 템플릿 API(`List data source templates`, `template` 파라미터, `Move page`, `position`, `erase_content` — 2026-01-15), 뷰 필터에 verification·place 추가(2026-08-13), **typed database `database_type`(2026-09-02)**
34. https://www.notion.com/help/common-formula-errors — **`Formula depth limit reached` — `Notion formulas can only be 15 layers deep. Every time a formula references another formula or rollup, it adds a layer.`** + 공식 formula 에러 8분류(Permissions / Wrong return type / Depth limit / 변수 상호참조 / 필터 내 변수 / relation·people 리스트 / Undefined value / 구문 오류)
35. https://www.notion.com/help/wikis-and-verified-pages — **`you can also add verification as a property to an entire database`**, verification 추가 시 **Owner 프로퍼티 자동 동반 생성**, 인증 기간은 `until a specific time or indefinitely`, 만료 시 Owner 에게 인박스+이메일 알림, `Can edit`/`Full access` 필요, Business·Enterprise 전용, 멘션·검색에서 파란 체크
36. https://www.notion.com/help/maps — place 입력 3종(현재 위치/장소명/주소), **map view 최대 100 핀**, **`Filtering and sorting for place properties is text-based`**, 제3자 제공자 의존 및 지역별 품질 편차
37. https://developers.notion.com/reference/property-object — (재확인) API 타입 키 22종 전수, `button`·`verification` 부재, `place`·`unique_id`·`status` 존재, `All data sources require exactly one title property`
38. https://www.notion.com/help/database-properties — (재확인) 헬프 열거 타입 22종, `each database can have up to 500 properties`, 👁️ 표시/숨김, default value 항목 부재
39. https://www.notion.com/help/database-templates — (재확인) `Set as default` 문구 부재, 중첩 3단계, 일간 반복 템플릿의 중첩 불가
40. https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks — **`You can't change the three main categories.`**

**2차 출처**

41. https://athena.outer-reaches.com/site/blog/2024/06/notion-status-property-no-defaults-empty/ — status 의 기본 옵션 개념과 "기본 해제해야 셀을 비울 수 있다"
42. https://notiondemy.com/calculate-percentage-notion/ , https://wisechecker.com/notion-number-property-format-currency-percent-bar/ — **percent 포맷의 저장값은 0~1 소수**(0.5 → 50%, 50 → 5000%)
43. https://notiontomaps.com/blog/notion-place-property-complete-guide — place 저장 필드(name / formatted address / lat / lng / Google 또는 AWS Place ID)
44. https://notionmastery.com/pushing-notion-to-the-limits/ — 참조 체인 15 레이어 교차 확인(thomasjfrank 와 독립)
45. https://notionthings.com/2023/05/19/notion-native-unique-task-ids/ , https://www.landmarklabs.co/notion-tutorials/notion-unique-id — unique ID 접두사 영숫자 2~7자 교차 확인
46. https://www.landmarklabs.co/notion-tutorials/database-default-values , https://wisechecker.com/notion-database-property-default-value/ — 템플릿 `Set as default`(모든 뷰 / 이 뷰만) UI 보고
47. https://www.sparxno.com/blog/notion-wikis-verified-pages — verification 만료 시 검색·AI 우선순위 상실

### 이번 검토에서 검증 실패(=출처를 찾지 못해 태그를 강화한) 항목

| 초판 서술 | 조치 |
|---|---|
| "프로퍼티 표시 상태는 3단계(항상/값 있을 때만/항상 숨김)" | 현행 헬프 문서에서 확인 불가 → 레이아웃 빌더 모델로 **대체 서술** + `[확인필요]` |
| "formula 는 다른 formula 를 참조할 수 없다" | **틀림** → 체인 깊이 15 로 정정 |
| "rollup 금지 규칙이 순환을 원천 차단한다" | **틀림** → formula 경유 우회 가능, 사이클 검출 필수로 정정 |
| "노션이 그래프 깊이를 인위적으로 얕게 유지한다 `[추정]`" | **틀림** → 깊이 상한 15 정책으로 정정 |
| "rollup 대상으로 formula 는 지정 가능한 것으로 보인다 `[확인필요]`" | 2차 출처 확보 → `[2차 출처]` 로 격상 |
| relation 관련 삭제 동작 전반 | 공식 헬프에 문서화 자체가 없음을 명시하고 `[확인필요]` 유지 |
| `button` / `verification` 의 API 노출 | `property-object` 타입 목록에 없음을 확인 → `[확인필요]` 근거 보강 |

**2차 GAP(2026-09-06 후반) 결과**

| 서술 | 조치 |
|---|---|
| "verification 은 위키에서만 노출되는 특수 프로퍼티로 보인다 `[확인필요]`" | **틀림** → 어떤 DB 에도 추가 가능하며 Owner 프로퍼티를 동반 생성함이 1차 확인. **F-03-23 신설** |
| "헬프센터 `database-properties` 는 표준 타입을 24종으로 명시" | **수치 오기** → 실제 열거는 22종(title·verification 제외) |
| "참조 체인 깊이 15 는 2차 출처뿐" | **1차 출처 확보** → `/help/common-formula-errors` 로 격상, `[2차 출처]` 태그 해제 |
| "percent 포맷의 저장값이 0.12 인지 12 인지 `[확인필요]`" | **해소(2차 교차확인)** → 0~1 소수 저장. 표시만 ×100 |
| "status 그룹 이름 변경 가능 여부 `[확인필요]`" | **해소(1차)** → 3개 범주 자체를 변경할 수 없다 |
| "status 셀을 비울 수 있는가 `[확인필요]`" | **조건부 해소(2차)** → 기본 옵션 지정 여부에 달렸다. 새 미해결 #21 로 승계 |
| "노션에 프로퍼티 기본값이 없다" | **부분 정정** → 범용 기본값은 없으나 **status 만 예외**로 기본 옵션을 갖는다 `[2차]` |
| "place 는 외부 지오코딩 의존 `[추정]`" | **1차 확인** → 제3자 제공자 의존을 헬프가 명시. 추가로 **필터·정렬이 텍스트 기반**임이 확인되어 난이도 M→S~M 하향 |
| 기준 API 버전 `2025-09-03` | **낡음** → `2026-03-11` 로 갱신하고 2026년 데이터베이스 관련 변경 10건을 본문에 반영 |
| 구현 우선순위 요약표의 행 중복 | 1차 GAP 중단으로 표 후반부 6행 + 등급 조정 블록이 **통째로 중복 출력**되어 있었다 → 제거 |
