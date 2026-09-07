# 04. 데이터베이스 뷰 & 쿼리 — SYNTHESIS 다이제스트

> 원본: `docs/research/04-database-views.md` (1,560행 / 189KB, 조사일 2026-09-06, API `2025-09-03`)
> 기능 총 28개 (F-04-01 ~ F-04-28) — 아래 인벤토리 행 수 28개와 일치 검증 완료.
> 스키마 정본은 `00-canonical-data-model.md`. 여기서는 **이 도메인이 요구하는 것**만 기술한다.

---

## 0. 도메인 한 줄 요약

**데이터(data source)와 표현(view)이 분리**되고, view 는 `filter → sorts → group → page` 파이프라인과 타입별 `configuration` 을 독립 저장한다. 단 **board 드래그 / calendar 드래그 / timeline 리사이즈는 뷰가 데이터를 직접 변경**하므로 "뷰 = 읽기 전용 렌즈" 모델이 깨진다 — 이 지점이 클론의 핵심 난제다.

---

## 1. 기능 인벤토리 (전수 28개)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-04-01 | 뷰 컨테이너 & 뷰 타입 전환 | M | P0 | data source, property 스키마, 라우팅(`?v=`) |
| F-04-02 | Table view | L | P0 | F-04-01, F-04-12, F-04-15, F-04-10, F-04-16 |
| F-04-03 | Board view (Kanban) + 드래그로 프로퍼티 값 변경 | L | P0 | F-04-11, 셀 mutation, fractional index, 낙관적 업데이트 |
| F-04-04 | List view | S | P1 | F-04-01, F-04-12 |
| F-04-05 | Gallery view (카드 + 커버 소스) | M | P1 | files 프로퍼티, 페이지 커버, 썸네일/CDN |
| F-04-06 | Calendar view + date range 드래그 | L | P1 | date 프로퍼티, 타임존, 셀 mutation |
| F-04-07 | Timeline view + dependency arrows | XL | P2 | F-04-06, relation, sub-item, 서버 트랜잭션 |
| F-04-08 | Chart view | L | P2 | F-04-09, F-04-11, 서버 집계 엔드포인트 |
| F-04-09 | Filter (simple/advanced, AND·OR 중첩) | XL | P0 | property 타입 시스템, 쿼리 엔진 |
| F-04-10 | Sort (다중 키) | M | P0 | F-04-09 컴파일러, F-04-15 커서 |
| F-04-11 | Group by / Sub-group (빈 그룹 처리) | L | P0 (sub-group만 P2) | property 타입 시스템, F-04-03, F-04-10 |
| F-04-12 | 뷰별 표시 프로퍼티 / 폭 / 순서 / 고정 | M | P0 | property 스키마, F-04-02 |
| F-04-13 | Linked view (다른 data source 참조) | M~L | P1 | F-04-01, 권한, 블록 트리 |
| F-04-14 | 인라인 DB vs 풀페이지 DB | M | P0 (전환은 P2) | 블록 트리, 페이지 계층, 사이드바 |
| F-04-15 | 페이지네이션 / load limit / 가상 스크롤 | L | P0 | F-04-09, F-04-10, 실시간 동기화 |
| F-04-16 | 열/그룹 집계 (Calculations) | M~L | P1 | F-04-09, F-04-11, F-04-24 |
| F-04-17 | 개인 필터/정렬 vs "Save for everyone" | M | P2 | F-04-09, F-04-10, 인증, F-04-24 |
| F-04-18 | Form view (쓰기 전용 뷰) | L | P2 | property 타입, 공개 링크, 익명 쓰기 경로 |
| F-04-19 | Map view | M | P2 | place 프로퍼티, 외부 지오코더/타일, F-04-09 |
| F-04-20 | Dashboard view (위젯 컨테이너 뷰) | L | P2 | F-04-01, F-04-13, 각 뷰 타입, F-04-15, F-04-24 |
| F-04-21 | 페이지 열림 방식 (Open pages in) | M | P1 | 페이지 렌더러, 라우팅, F-04-01 |
| F-04-22 | Sub-item 표시 & 필터 범위 | L | P1 | 자기참조 relation, F-04-09/10/15, F-04-07 |
| F-04-23 | 다중 data source 데이터베이스 | M (기능) | **P2 기능 / P0 데이터 모델** | F-04-01, F-04-13, 권한, property 스키마 |
| F-04-24 | 뷰 결과 실시간 동기화 & 멤버십 재평가 | **XL** | P1 (협업 지원 시 P0) | F-04-09~11, F-04-15/16, WebSocket, 권한 |
| F-04-25 | 뷰·스키마 편집 권한 & DB 잠금 | L | P1 (잠금 토글만 P2) | ACL, F-04-01/09/13/24 |
| F-04-26 | 뷰 단위 내보내기 (Export current view) | M (PDF 포함 L) | P2 | F-04-12/15/25, 잡 큐, 오브젝트 스토리지 |
| F-04-27 | 데이터베이스 내 검색 (뷰 툴바 검색) | M | P1 | F-04-09 컴파일러, 텍스트 인덱스, F-04-24 |
| F-04-28 | 데이터베이스 템플릿 & 뷰별 기본 템플릿 | M (반복 포함 L) | P2 | 블록 트리 복제, F-04-01, F-04-25, 스케줄러 |

**분포**: P0 8개 / P1 8개 / P2 12개 · S 1 / M 11 / M~L 2 / L 11 / XL 3(F-04-07, F-04-09, F-04-24)

---

## 2. 이 도메인이 요구하는 데이터 모델

### 2.1 필수 엔티티 (정본에 반드시 존재해야 하는 것)

| 엔티티 | 이 도메인이 요구하는 이유 | 결정적 필드 |
|---|---|---|
| `database` | 뷰 탭·잠금·dependency 시프트 정책의 소유자. 블록 트리 접합점 | `parent_block_id`, `is_inline`, `is_full_width`, `is_locked`, `dependency_shift_mode`(overlap_only/maintain_gap/never), `avoid_weekends` |
| `data_source` | **뷰가 바인딩하는 실제 단위**. 1 database = 1~N data source | `owner_database_id`, `name` |
| `database_data_source` (조인) | 한 data source 가 **여러 database 에 붙을 수 있음**(linked). 단일 FK 로 표현 불가 | `(database_id, data_source_id)`, `position`, `is_linked` |
| `property` | 뷰 설정이 참조하는 스키마. **FK 는 data_source 를 향해야** F-04-13/23 이 성립 | `data_source_id`, `type`(place/verification/button 포함 22종), `config jsonb`, `position` |
| `row_page` | 행 = 페이지. 본문 블록 트리를 가짐 | `data_source_id`, `properties jsonb`, `position`(fractional), `in_trash`, **`is_template`**, `version`(실시간 델타용) |
| `view` | 이 도메인의 중심 엔티티 | 아래 2.2 |
| `view_property` | 뷰별 표시 설정. **행 단위 테이블 필수**(JSON 배열이면 동시편집 LWW 로 한쪽 소실) | `(view_id, property_id)`, `visible`, `position`, `width`(NULL=기본), `wrap`, `date_format`, `time_format`, `status_show_as`, `card_property_width_mode`, `calculation` |
| `row_position` | 뷰별·그룹별 수동 순서. board 드래그가 요구 | `(view_id, group_key, row_id)`, `position` |
| `view_user_override` | 개인 필터/정렬 (F-04-17) | `(view_id, user_id)`, `filter`, `sorts` |
| `acl` | **object_type 으로 page/database/data_source/block 을 한 테이블에** 통합(3중 조인 방지) | `level ∈ full_access|edit|edit_content|comment|view` |
| `database_template` | F-04-28. 본체는 `is_template=true` 인 row_page | `data_source_id`, `template_page_id`, `is_database_default`, `repeat_rule`, `parent_template_id`(3단 상한) |

**부가 엔티티(해당 기능 도입 시점에만 필요)**: `form_question(view_id, property_id, label, required, long_answer, max_selections)` — F-04-18 / `export_job(scope, format, status, snapshot_at, result_url, expires_at)` — F-04-26, 비동기 필수(최대 30시간) / `subscription(connection_id, view_id, user_id, filter_hash, last_seen_version)` — F-04-24 / `query_snapshot(query_id, view_id, row_ids[], created_at)` — 노션식 15분 TTL 커서 캐시(선택).

### 2.2 `view` 가 저장해야 하는 것 (뷰의 범위는 filter/sort/group 보다 넓다)

`database_id`, `data_source_id`(**dashboard 면 NULL**), `type`(table/board/list/calendar/timeline/gallery/chart/form/map/dashboard), `position`, `filter jsonb`(재귀 트리), `sorts jsonb`(배열 인덱스 = 우선순위), `quick_filters`, `group_by`/`sub_group_by`(GroupSpec), `configuration jsonb`(**discriminated union**), `load_limit`(10/25/50/100), `open_pages_in`(side_peek/center_peek/full_page), `dashboard_view_id`(self-FK) + `dashboard_layout`, `sub_item_display` + `sub_item_filter_scope`, `owner_user_id`(NULL=공유뷰), `default_template_page_id`.

### 2.3 이 도메인이 요구하는 구조적 결정 (정본에 반영 필요)

| # | 결정 | 어기면 생기는 일 |
|---|---|---|
| D1 | `property`·`row_page` 의 FK 는 **`data_source_id`** (database_id 아님) | F-04-13/20/23 이 XL 급 마이그레이션이 됨 |
| D2 | 순서는 전부 **fractional index `text`** (뷰 탭·열·행·그룹) | 정수 순서는 드래그마다 전체 UPDATE → 동시편집 충돌 |
| D3 | `view_property` 는 **테이블**, `configuration` 은 **키 단위 병합**(JSON 전체 LWW 금지) | "A 는 폭 조절, B 는 순서 변경"에서 한쪽 소실 |
| D4 | 프로퍼티 참조(`date_property_id`, `group_by`, `x_axis_property_id`, `map_by`, cover 소스)는 **configuration 최상위 평면 필드** | 프로퍼티 삭제 시 cascade 정리가 전수 JSON 스캔이 됨 |
| D5 | 정렬 SQL 은 항상 **마지막 tie-breaker `position, id`** | keyset 커서가 불안정 → 행 중복/누락 |
| D6 | 파생값(formula/rollup) 및 정렬·필터 대상 프로퍼티는 **생성 컬럼으로 머티리얼라이즈** | 25만 행에서 인덱스 불가 → 타임아웃 |
| D7 | 모든 뷰 쿼리의 고정 기본 조건: `is_template = false AND in_trash = false` | 템플릿이 일반 행으로 노출 |
| D8 | 권한 조건은 사용자 필터와 **반드시 AND 로 합성된 별도 절** | OR 그룹 안에 섞이면 권한 무력화 — 이 도메인 최악의 단일 버그 |
| D9 | 캐시 키 = `(data_source_id, filter_hash, user_permission_hash, schema_version[, search_term])` | 권한 해시 누락 = 사용자 간 캐시 오염 = 데이터 유출 |
| D10 | 날짜 값 스키마 `{start, end|null, time_zone|null, is_all_day}` + 범위 인덱스 | calendar/timeline 범위 쿼리 불가 |

### 2.4 쿼리 파이프라인 (코드 한 곳에 모아야 하는 WHERE 합성)

```
view.filter ∧ view_user_override.filter(F-04-17) ∧ search_term(F-04-27)
            ∧ permission(F-04-25) ∧ is_template=false ∧ in_trash=false
→ ORDER BY sorts[0..n], position, id
→ GROUP INTO buckets(group_by[, sub_group_by])   -- 2단계 쿼리: (1)키+카운트 (2)그룹별 상위N
→ keyset cursor / load_limit
```

### 2.5 상한값 (제품 제약으로 반영)

250,000 rows · 500 properties · 페이지당 프로퍼티 2.5MB · 스키마 1.5MB · 양방향 relation 10,000 · 차트 200 groups × 50 subgroups · **map 동시 표시 100개** · **dashboard 행당 4 / 총 12 위젯** · 템플릿 중첩 3단 · 쿼리 캐시 15분 TTL · 뷰 개수 상한은 공개 문서 없음 `[확인필요]`(권고 소프트 50).

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립하지 않는 것 (P0 8개)

| F-ID | 근거 |
|---|---|
| F-04-01 뷰 컨테이너 | 뷰 개념 없이는 도메인 자체가 없다. 제약 3개(최소 1뷰 / position fractional / config 마이그레이션 함수)가 본질 |
| F-04-02 Table | DB 의 기본 뷰. 셀 편집 진입점 |
| F-04-03 Board | 사용 빈도 최상위 + "드롭 = 데이터 변경"이라는 이 도메인 고유 패턴의 대표 |
| F-04-09 Filter | 뷰가 "같은 데이터의 다른 렌즈"가 되는 유일한 수단. 없으면 뷰가 여러 개일 이유가 없다 |
| F-04-10 Sort | filter 와 같은 쿼리 컴파일러를 공유. 커서 안정성의 전제 |
| F-04-11 Group by | board 가 P0 이므로 자동으로 P0 (sub_group_by 만 떼면 P2) |
| F-04-12 표시 프로퍼티 | 표시 제어 없이는 뷰가 의미를 갖지 못함. 성능 임계도 행 수보다 **표시 프로퍼티 수**가 먼저 온다 |
| F-04-15 페이지네이션/가상화 | 수천 행에서 즉시 사용 불가가 됨 |
| F-04-14 인라인/풀페이지 | 둘 중 하나는 반드시 필요(전환 기능만 P2). MVP 는 풀페이지만 = 라우팅 단순 |

**추가 P0(데이터 모델 한정)**: F-04-23 의 `data_source` FK 방향. 기능은 안 만들어도 **FK 결정은 MVP 시점에 내려야 한다**.

### 3.2 빼도 되는 것과 대체안

| 뺄 것 | 이유 | 대체안 |
|---|---|---|
| F-04-07 Timeline | XL. 간트 렌더 + 그래프 전파 엔진 + 사이클 방지 3중 | 읽기 전용 막대만, 전파 정책 `never` 고정, 기성 간트 라이브러리 |
| F-04-08 Chart | 설정 조합 폭발 + 별도 집계 엔드포인트 | bar/donut/number 3종, count/sum/average 만, Recharts/ECharts |
| F-04-18 Form / F-04-19 Map | 뷰 도메인 의존 없음. 익명 쓰기 권한 / 외부 지오코더 과금이 별도 비용 | v2. 폼은 워크스페이스 멤버 전용 + 질문 타입 5종. 맵은 MapLibre+OSM, 좌표 비정규화 저장 |
| F-04-20 Dashboard | 다른 뷰가 완성돼야 의미 있는 합성 기능 | **일반 페이지에 linked view 블록 여러 개 배치**(노션도 도입 전까지 그 방식) |
| F-04-17 개인 필터 | 캐시 키·브로드캐스트 단위를 사용자별로 쪼갬 | MVP 는 모든 필터 변경을 즉시 전체 저장 |
| F-04-26 Export | 내부 의존 없음 | MVP: CSV·현재 뷰·동기 응답·1만 행 상한, 초과 시 명시적 거부 |
| F-04-28 템플릿 | 블록 트리 깊은 복사 + 링크 재작성이 실작업 | v1: 프로퍼티 프리필 + DB 전역 기본 1개. **단 `is_template` 플래그는 MVP 에 넣을 것** |
| F-04-22 Sub-item | 트리 × 필터 × 정렬 × 가상스크롤 4중 상호작용 | v1: table 한정 / 깊이 1단 / 필터 범위 `부모만` 고정 |
| F-04-13 Linked view | 권한 재판정 4경로가 실비용 | MVP 는 UI 만 제외, **`view.data_source_id` 참조 구조는 확보** |
| F-04-24 실시간 | XL. 다만 **뺐다고 생각하면 아키텍처를 갈아엎게 됨** | MVP: 폴링 5~10초 또는 SSE 로 "뷰 전체 재조회" 알림만(1~2일, 정확성 100%) |
| F-04-25 권한 | 단일 사용자 MVP 엔 불필요 | `edit`/`view` 2등급 + **`can_*` 능력 함수 5개는 미리 정의**. 권한 AND 합성 자리는 MVP 컴파일러에 뚫어둘 것 |

### 3.3 MVP 스코프 권고 (뷰 도메인 한정)

table + board + list 3종 / 단일 레벨 AND 필터(text·number·checkbox·select·status·date) / 정렬 키 최대 3 / group 은 select·status·checkbox 3종 / keyset 커서 + `Load more` / 풀페이지 DB 만 / center peek 고정 / 검색은 title `ILIKE` 만.

---

## 4. 기술 난제 & 권장 구현 접근 (L/XL 전수)

| F-ID | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|
| **F-04-09 Filter (XL)** | 22 타입 × 다수 연산자 × 재귀 트리 × SQL 컴파일 + 인덱스. 상대 날짜는 심볼 저장 후 조회 시점 전개(캐시 키에 전개 경계 포함). rollup 은 `any/every/none` + 중첩 = **트리 안의 트리**. **F-04-24 때문에 SQL 컴파일러와 인메모리 평가기 두 벌이 필요** | 필터 노드에 **안정적 uuid** 부여(추후 노드 단위 병합 승격 가능) → `MAX_FILTER_DEPTH` 상수 하나로 API·UI 공통 검증, **읽기 경로엔 검증 미적용** → 평가기 인터페이스를 "입력: 행 + 설정, 출력: bool"로 추상화해 두 백엔드 공유 | AppFlowy `FilterController` |
| **F-04-24 실시간 (XL)** | 블록 트리와 달리 **멤버십 자체가 쿼리 결과**. 행 1건 변경 → 관련 모든 뷰의 enter/exit/update/move 재분류. 두 평가기 결과가 어긋나면 유령 행. 팬아웃·권한 회수·오프라인 재적용이 각각 별도 | 3단계 도입: (1) 폴링/SSE 전체 재조회 알림 (2) WebSocket + update 델타, 멤버십 변경은 전체 재조회 (3) enter/exit 분류 + 집계 델타. **CRDT(Yjs)는 행 본문 리치텍스트에만, 프로퍼티 셀·뷰 설정은 필드 단위 LWW**. 브로드캐스트 단위 = `(view × filter_hash)`. 파생값은 서버에서 수렴 후 1회만 알림 | 노션 엔지니어링 글(RecordCache→SaveTransactions→MessageStore→syncRecordValues), AppFlowy 델타 알림 |
| **F-04-07 Timeline (XL)** | 가로 가상화 간트 + 그래프 기반 날짜 전파 + 사이클 방지가 각각 독립 난제. 계층 전파와 dependency 전파를 동시에 켜면 **한 행이 두 경로로 이중 이동** | 전파는 **서버 트랜잭션 안에서 재계산**(클라이언트 계산값 신뢰 금지). 행별 최종 delta 1회만 적용. 전파 홉 상한 50, 초과분 비동기 잡. **커밋 시점 사이클 검사**(읽기 시점 검사는 두 요청 모두 통과) | 기성 간트 라이브러리 |
| **F-04-02 Table (L)** | 행·열 양방향 가상화 + 열 고정 + 인라인 셀 편집 + 키보드 내비 | TanStack Table + TanStack Virtual, 열 고정은 `position: sticky`. 행 가상화 먼저, 열 가상화 v2. **가상 스크롤 대상은 "펼쳐진 노드만 flatten 한 배열"** | NocoDB(최대 3필드 pin) |
| **F-04-03 Board (L)** | 드래그 자체보다 **드롭 = 셀 값 + 순서 2개 mutation** 의 원자성·낙관적 롤백. sub_group 이면 드롭 타겟이 2차원 = 셀 2개 동시 변경 | **서버 단일 API** `POST /views/{id}/move-row {row_id, target_group_key, before_row_id}`. 클라이언트 2회 호출 금지(부분 실패). dnd-kit. MVP 는 select/status 그룹만 | AppFlowy `moveGroupRow` → `GroupCustomize` 가 셀 업데이트를 계산 |
| **F-04-06 Calendar (L)** | 월/주 격자 + multi-day lane packing + 드래그/리사이즈. 타임존/DST | all-day 는 date-only 저장. 범위 쿼리 `start<=range_end AND COALESCE(end,start)>=range_start` + 생성 컬럼 인덱스. **뷰포트 기간만 쿼리**, 월 이동 시 ±1개월 프리페치. **원격 변경 시 뷰포트 자동 이동 금지** | 검증된 캘린더 라이브러리 |
| **F-04-08 Chart (L)** | 설정 조합 경우의 수 + 서버 집계 API. **개수·합계만으로 비공개 데이터 추론 가능한 대표 누수 경로** | 집계 **이전에** 권한 필터. 서버 `GROUP BY` 필수. 축 프로퍼티는 평면 필드. 축 스케일 재계산 디바운스 300ms | Recharts/ECharts |
| **F-04-11 Group (L)** | 타입별 버킷 생성기 9종 + multi_select 중복 등장(**카드 수 합 ≠ 행 수**) + 2단 그룹 + 그룹별 페이지네이션 | **2단계 쿼리 필수**: (1) 그룹 키+카운트 (2) 보이는 그룹만 상위 N. 그룹별 독립 커서. **relation·formula 그룹은 미지원 고정**(노션 문서 자체 모순이지만 FAQ 원문이 불가 + 파생값은 인덱스 불가) | AppFlowy `GroupController` |
| **F-04-15 페이지네이션 (L)** | keyset 커서 + 그룹별 커서 + 동적 높이 가상 스크롤 + 실시간 병합 | 커서 = `base64({sort_keys[], row_id})` → `WHERE (k1,k2,id) > (v1,v2,vid)`. **권한 조건은 커서와 같은 WHERE 안에**(사후 필터링하면 `has_more` 가 거짓말). 15분 스냅샷은 생략 가능 | — |
| **F-04-13 Linked view (M~L)** | 데이터 모델을 미리 잡았으면 M. 그러나 **행 목록·집계·그룹 카운트·실시간 브로드캐스트 4경로 전부에서 원본 ACL 재판정** 필요 | 예외 규칙 주의: `Can edit content` 는 원본에선 뷰 생성 불가, **linked DB 에선 가능** → 등급 비교가 아니라 **능력(capability) 단위 판정** | — |
| **F-04-16 집계 (M~L)** | 그룹별 집계를 행 페이지네이션과 **같은 응답에** 담아야 함 + 실시간 재계산 트리거 | 응답에 `aggregates` 동봉(1회 왕복). 집계 캐시 + 무효화 키. **0 과 빈 값 구분**(average 는 0 아닌 `—`). 델타 갱신 가능(count/sum) vs 불가(median/count unique) 분리 | AppFlowy `CalculationsController` |
| **F-04-18 Form (L)** | 익명 **쓰기 전용** 경로가 권한 모델의 예외. 익명 relation 질문은 대상 DB 행 목록 노출 위험 | 폼 뷰 토큰은 INSERT 만 허용(같은 토큰 SELECT 금지). relation 옵션 노출 범위 제한. `required` 는 뷰 설정이므로 **서버 재검증 필수** | — |
| **F-04-20 Dashboard (L)** | N위젯 = N쿼리 × N권한판정 × N구독. F-04-24 와 곱해짐 | `view` **재귀 구조**로 표현(`dashboard_view_id` self-FK + `data_source_id IS NULL`). 위젯별 지연 로드(IntersectionObserver). 레이아웃은 위젯 단위 position + 크기 필드로 쪼개 병합 가능하게 | — |
| **F-04-22 Sub-item (L)** | 트리 + 필터 + 정렬 + 가상스크롤 4중. "부모 탈락, 자식 통과" 정책 하나로 쿼리와 렌더가 모두 바뀜 | 자기참조 relation 쌍(parent_item/sub_items), 신규 테이블 불필요. 재귀 CTE + `depth`/`path`, `ORDER BY path`. 정렬은 **형제 내부만**. **쓰기 트랜잭션 안에서 조상 체인 사이클 검사**. 부모 탈락 시 부모를 비활성 회색 행으로 렌더 | — |
| **F-04-25 권한·잠금 (L)** | 권한이 4경로에 스며들고, `Can edit content`(데이터 O·구조 X) 중간 등급 + `Lock database` 직교 축이 동시 존재 | `can_view_rows` / `can_edit_rows` / `can_edit_view_config` / `can_edit_schema` / `can_move_data_source` 5개 능력 함수. `can_edit_view_config = level >= 'edit' AND NOT is_locked`. **잠금은 쓰기 트랜잭션 안에서 재확인**. 403/404 중 하나로 고정 | — |

**핵심 통찰**: F-04-09 와 F-04-24 는 "필터 평가기를 SQL·인메모리 두 벌로 요구한다"는 점에서 **사실상 한 덩어리**이며, F-04-25 는 그 컴파일러 **안으로** 들어간다. 셋은 같은 시기에 설계해야 한다.

**아키텍처 대안(정본 결정 필요)**: 프로퍼티를 `jsonb` 단일 컬럼에 둘 것인가, **Teable 처럼 실제 Postgres 컬럼으로 승격**할 것인가. 후자는 filter/sort/group 이 DB 엔진에서 실행되지만 스키마 마이그레이션 비용이 붙는다. (Teable 의 "100만 행 200ms" 는 벤더 주장 `[확인필요]`)

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 이 도메인이 요구하는 것 |
|---|---|---|
| 01 블록 에디터 | 인라인 DB = 블록(F-04-14), 행 본문 = 블록 트리, 템플릿 본문 복제(F-04-28) | `block(type='database', target_database_id)` 위임 렌더, **렌더 깊이 카운터**(순환 방지), 트리 깊은 복사 + 내부 링크 재작성 |
| 02 페이지·워크스페이스 | 행 = 페이지, 풀페이지 DB, peek 라우팅(F-04-21), `?v=` 딥링크 | 페이지 렌더러 재사용, peek 내부 네비 스택, 스크롤 앵커 복원 |
| **03 DB 코어** | property 타입 시스템 전체(select 옵션 순서, formula/rollup, relation, place, unique_id) | 타입별 **비교자·버킷 생성기·필터 연산자·집계 허용 매트릭스**를 코어가 제공. 파생값 머티리얼라이즈 책임 소재 결정 필요 |
| 05 협업·동기화 | F-04-24 전체 | WebSocket, 버전/LSN 시퀀스, 낙관적 업데이트·롤백. **CRDT 는 본문에만, 셀/뷰 설정은 LWW** 경계 합의 |
| 06 권한·공유 | F-04-25, F-04-13, F-04-18 익명, F-04-26 | 통합 `acl` + **능력 단위 판정 API** + 권한을 SQL WHERE 로 컴파일하는 훅. `edit_content` 등급 인정 |
| 07 검색·네비 | F-04-27 은 전역 검색과 **범위가 다름**(제목+프로퍼티, 본문 제외) | 텍스트 인덱스(tsvector/pg_trgm) 공유, 쓰기 시점 갱신 트리거 |
| 08 템플릿·자동화 | F-04-28 반복 스케줄러 | 멱등 키(`template_run`), 워크스페이스 타임존 분산 |
| 09 API·연동 | Views API(`/v1/views`, `/views/{id}/queries`), 커서 15분 TTL, `2025-09-03` database↔data_source 분리 | 뷰 CRUD·쿼리 계약. **뷰 쿼리에 추가 필터/정렬을 얹을 수 없음** |
| 11·12·16 | 뷰 설정 변경 이력·내보내기 완료 알림 / 모바일 side peek→full page 강제 폴백·폼 편집 불가 / peek 안의 행 페이지 렌더 | F-04-21 과 16 의 경계 정리 필요 |

---

## 6. 최우선 미해결 질문 (5개)

| # | 질문 | 왜 최우선인가 | 원본 항목 |
|---|---|---|---|
| 1 | **개인 필터와 공유 필터의 결합 규칙** — replace 인가 AND 인가 (노션 실동작 미확인) | 잘못 고르면 "필터를 걸었는데 결과가 더 줄어드는" 버그. 쿼리 경로 전체에 스며듦. 원본 권고 = **replace** | 9, 22 |
| 2 | **노션 실시간이 CRDT 병합인가, 트랜잭션 검증 + 레코드 재조회인가** (엔지니어링 글은 후자를 서술하나 전자를 배제한다고 명시하진 않음) | F-04-24(XL) 아키텍처 선택의 근거. 나중에 바꾸면 갈아엎어야 함 | 21 |
| 3 | **필터 중첩 깊이 2 vs 3** (API 레퍼런스 "two levels" vs 헬프센터 "three layers") | 서버 검증 상수. 원본 권고 = `MAX_FILTER_DEPTH=3` + 읽기 경로 미검증 | 1 |
| 4 | **정렬 시 null 위치**와 **새 프로퍼티의 기존 뷰 기본 표시/숨김** — 2차 조사에서도 1차 출처 확보 실패 | 둘 다 나중에 바꾸면 **기존 모든 뷰의 표시 결과가 통째로 달라짐**. 원본 권고 = NULLS LAST / 숨김 | 4·8 → 31·32 |
| 5 | **multi_select 그룹에서 카드 드래그 semantics** (원래 값 치환 vs 추가) | 데이터 손실 위험이 있는 동작인데 문서 미기재 | 3 |

> 그 외 미해결 27건(전체 32건)은 원본 `## 미해결 / 확인필요` 표 참조. 대표적으로: timeline 순환 dependency 처리, Views API 에 `load limit`·`open pages in` 필드 부재(UI 전용인지 미노출인지), dashboard `rows` read-only 저장 구조, form 질문 구성이 API 에 전혀 노출 안 됨, sub-item 깊이 상한, 다중 data source 의 UI 표현, 인라인→풀페이지 전환 시 권한 승격 규칙, 뷰 개수 상한.

---

## 7. 1차 출처 (원본 출처표 30건 요약)

- **notion.com/help** — views-filters-and-sorts, boards, tables, calendars, timelines, tasks-and-dependencies, charts, forms, maps, dashboards, data-sources-and-linked-databases, guides/full-page-vs-inline-databases, optimize-database-load-times-and-performance, customize-your-database, guides/assign-custom-database-permissions, export-your-content, database-templates, search, intro-to-databases, guides/using-linked-databases
- **developers.notion.com** — guides/data-apis/working-with-views(뷰 객체 전체 스키마), reference/filter-data-source-entries(연산자 전수), page/changelog
- **기타** — notion.com/blog/data-model-behind-notion(실시간 동기화 흐름), notion.com/releases/2025-11-17, deepwiki AppFlowy 7.2, docs.nocodb.com, Teable

> 전체 URL·근거 매핑은 원본 문서 `## 출처` 표(30행) 참조.
