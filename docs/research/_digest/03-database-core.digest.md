# 03. 데이터베이스 코어 & 프로퍼티 — 다이제스트

> 원본: `docs/research/03-database-core.md` (176KB, 1611행, F-03-01~23 = **23개**)
> 기준 API 버전 `2026-03-11`. 3계층(database→data_source→page)은 `2025-09-03` 도입.
> 스키마 정본은 `00-canonical-data-model.md`. 아래 "데이터 모델" 절은 **이 도메인의 요구사항**만 기술한다.

## 0. 이 도메인의 한 줄 요약

노션 DB는 표가 아니라 **공통 스키마를 공유하는 페이지 컬렉션**이다. 클론 난이도의 대부분은 프로퍼티 타입 개수가 아니라 **relation↔rollup↔formula 의존 그래프 재계산**, **타입 변환 마이그레이션**, **권한이 파생값·필터 캐시에 곱해지는 문제**에 몰려 있다.

---

## 1. 기능 인벤토리 (전수 23개 / `### F-` 카운트 23과 일치)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-03-01 | database / data source / page 3계층 (DB=페이지 컬렉션) | L | P0 | 블록 시스템(01) |
| F-03-02 | 프로퍼티 스키마 관리(추가/이름변경/삭제/순서/설명/표시) | M~L | P0 | F-03-01, F-03-22 |
| F-03-03 | 기본 스칼라 7종 (title/text/number/checkbox/url/email/phone) | S~M | P0 | F-03-02 |
| F-03-04 | select / multi-select (옵션 레지스트리) | M | P0 | F-03-02 |
| F-03-05 | status (옵션 + 그룹 2계층) | M | P1 | F-03-04 |
| F-03-06 | date (단일/범위/시간/타임존/리마인더) | M | P0 | F-03-02 |
| F-03-07 | person / files & media / place | S / M / S~M | P0 / P1 / P2 | 사용자·스토리지·지오코딩 |
| F-03-08 | 자동 메타 4종 (created/last_edited × time/by) | S~M | P0 | F-03-01 |
| F-03-09 | unique ID (접두사 + 자동 증가) | M | P1 | F-03-02 |
| F-03-10 | relation (단방향/양방향/자기참조) | L | P0 | F-03-01, F-03-02 |
| F-03-11 | rollup (관계 경유 집계, 22함수) | L | P1 | F-03-10 |
| F-03-12 | formula 엔진 (Formulas 2.0) | XL | P1 | F-03-10, 전 타입 |
| F-03-13 | 파생 프로퍼티 의존성 그래프 & 재계산 | XL | P1 | F-03-10~12 |
| F-03-14 | 프로퍼티 타입 변환 & 데이터 마이그레이션 | L | P1 | F-03-02, F-03-13 |
| F-03-15 | button 프로퍼티 (행 단위 액션 트리거) | L | P2 | F-03-12, 권한, 알림 |
| F-03-16 | 셀 편집 UX 공통 규약(그리드 내비/대량 붙여넣기/레이아웃) | L | P0/P1/P2 | 전 타입, 뷰(04), 협업(05) |
| F-03-17 | 프로퍼티별 필터·정렬 연산자 규약 (쿼리 계약) | L | **P0** | F-03-02, 전 타입, 권한 |
| F-03-18 | sub-item & dependency (내장 self-relation) | L | P1 | F-03-10, F-03-06, F-03-17 |
| F-03-19 | 데이터베이스 자동화 (프로퍼티 변경 트리거) | XL | P2 | F-03-15, F-03-13, F-03-22 |
| F-03-20 | AI 자동 채우기 프로퍼티 (AI Autofill) | M~L | P2 | F-03-02, F-03-19, LLM |
| F-03-21 | 데이터베이스 템플릿 (= 사실상의 기본값 메커니즘) | M | P1 | F-03-01, 블록복제, F-03-09 |
| F-03-22 | DB 잠금 & 스키마 권한 분리 | M~L | P1 | 권한모델, F-03-02 |
| F-03-23 | verification & Owner 자동 동반 생성 (신뢰도 상태머신) | M (검색랭킹 포함 L) | P2 (위키형이면 P1) | F-03-02, F-03-07, 알림·스케줄러 |

**P0 = 01,02,03,04,06,07(person),08,10,16,17 (10개)**

---

## 2. 이 도메인이 데이터 모델에 요구하는 것

> 새 스키마를 창작하지 않는다. 아래는 **요구사항 목록**이다.

### 필수 엔티티
| 엔티티 | 요구 근거 | 핵심 필드 요구 |
|---|---|---|
| `database` | F-03-01 | 컨테이너. `is_inline`, `locked`(F-03-22), `database_type`(tasks/projects/skills, 2026-09-02 신설 → `kind text NULL` 자리만 비워둘 것), soft delete |
| `data_source` | F-03-01 | **스키마 소유자**. MVP에서 database:data_source=1:1이라도 **테이블은 반드시 분리**(나중 1:N 확장 마이그레이션 비용 제거). `unique_id_counter`, `sub_items_enabled`, `dependencies_enabled`, `dependency_shift_mode`, `schema_version` |
| `property` | F-03-02 | `id/name/description/type/config jsonb/order_idx(fractional)`. `description`은 API 1급 필드(추정 아님). soft delete 필요(복원·undo). `relation_role`(F-03-18), `companion_property_id`(F-03-23), `api_exposed` |
| `page` (= 행) | F-03-01 | **block 테이블을 참조/상속**. 별도 "row" 엔티티를 만들면 안 됨. `unique_seq`(F-03-09, 프로퍼티 삭제해도 영속), `parent_row_id`+`ancestor_path uuid[]`(F-03-18 트리) |
| `page_property_value` | F-03-03/16 | EAV 권고. 판별 유니온 jsonb + **정렬/필터용 타입별 파생 컬럼**(`num_value/text_value/date_start/bool_value`) 필수(F-03-17). `manually_overridden`, `filled_by('user'\|'ai'\|'automation'\|'template')`(F-03-20) |
| `relation_edge` | F-03-10 | **엣지 테이블 필수**(jsonb 배열이면 역참조 불가). 양방향은 **엣지 1행 + `config.inverse_property_id`**, 2행 복제 금지. `order_idx`로 칩 순서. `(property_id, to_page_id)` 역인덱스 |
| `select_option` | F-03-04/05 | `{id,name,color,group_id,order_idx}`. **셀은 옵션 id를 참조**(이름 아님). soft delete(undo 시 셀 참조 복구) |
| `status_group` | F-03-05 | **3개 고정**(사용자가 추가/삭제/이름변경 불가). `kind ENUM('todo','in_progress','complete')` 컬럼 필수 — 진행률/자동화가 그룹 이름에 의존하지 않게 |
| `property_dependency` | F-03-13 | **스키마 레벨 그래프만**. 페이지 레벨 그래프는 만들지 않는다(노드 = 행수×프로퍼티수 폭발) |
| `derived_value` | F-03-11/12/13 | `(page_id, property_id, value, computed_at, stale)`. **권한 클래스가 키에 들어갈 수 있음** |
| `view_property_config` | F-03-16 | 뷰 레벨: `visible/width/wrap/frozen/order_idx` |
| `page_layout_slot` | F-03-02/16 | 스키마 레벨 표시: `visible bool` + `area('heading'\|'body'\|'side_panel')` + `tab_id`. **3단계 enum이 아님**. 불변식: heading 최대 15 |
| `property_migration` | F-03-14 | `from_type/to_type/status/snapshot_ref/lossy_count`. 노션에 없는 개선점 |
| `db_template` | F-03-21 | **템플릿 = 숨김 플래그 붙은 페이지**(별도 자료구조 금지 — 블록 복제 로직 공유). `repeat_rule`(RRULE 부분집합), `last_run_at`(멱등), `is_default_for_ds/is_default_for_view` |
| `db_automation` + `automation_run` | F-03-19 | `triggers jsonb`, `actions jsonb`(**F-03-15 button `steps`와 스키마 완전 공유**), `trigger_source`, `depth` |
| `page_verification` | F-03-23 | **셀 jsonb가 아닌 별도 테이블**(만료 스캔이 EAV 전체를 훑는 참사 방지). `state/verified_by/verified_at/expires_at/notified_at`, `(expires_at) WHERE state='verified'` 인덱스 |
| `view.filter_ast` / `sort_keys` | F-03-17 | **AST jsonb로 저장**(SQL 문자열 저장 금지). 컴파일은 파라미터 바인딩 + 화이트리스트 연산자 매핑 |
| `file_asset`, `page_person`(조인), `button_run`, `ai_fill_run` | F-03-07/15/20 | 파일 참조카운트 GC, person 역조회, 실행 감사 |

### 타입 집합 (확정 사실)
- **API 노출 22종**: checkbox, created_by, created_time, date, email, files, formula, last_edited_by, last_edited_time, multi_select, number, people, phone_number, place, relation, rich_text, rollup, select, status, title, unique_id, url
- **UI 열거 22종** (title 미열거, **button 포함**)
- **차집합**: `{button, verification}` = API 미노출 UI 전용 → `property.api_exposed boolean` 으로 구분
- `title`은 data_source당 **정확히 1개 필수**, 삭제·타입변경 불가, 다른 타입→title 변경 불가
- rollup 함수 **22개 전수 확정**(API enum이 정본, 헬프보다 많음)
- 옵션 색상 enum 10종: default, gray, brown, orange, yellow, green, blue, purple, pink, red

### 놓치면 안 되는 저장 규약
| 규약 | 내용 |
|---|---|
| percent 저장값 | **0~1 소수**. 0.5→"50%", 50→"5000%". formula/rollup/필터는 항상 원시 소수를 본다. 표시 계층에서만 ×100 `[2차 출처 교차확인]` |
| date | `has_time=false`를 timestamptz로 저장하면 타임존 이동 시 날짜가 밀린다 → 별도 `date` 컬럼 또는 UTC 자정+플래그 |
| 자동 메타 4종 | **저장하지 않고 `page` 테이블에서 투영**. `page_property_value`에 행을 만들면 스토리지 4배 + 정합성 문제 |
| number | 통화 계산 위해 `numeric` 파생 컬럼 별도 |
| checkbox | null 상태 없음(기본 false) → 필터에 `is_empty` 연산자도 없음 |
| status | 노션에서 **유일하게 default option을 갖는 프로퍼티**. `config.default_option_id`를 status에만 허용 `[2차 출처]` |

### 알려진 한도 (설계 상수)
프로퍼티 500/DB · **formula/rollup 참조 체인 깊이 15**(1차 확인) · compound 필터 중첩 2단 · API 응답 100건/페이지, 누적 페이지네이션 **10,000건 상한**(초과 시 `request_status: incomplete`) · 레이트 3req/s · 자동화 판정 윈도우 3초 · 자동화 알림/버튼 알림 20명 · 템플릿 중첩 3단 · 헤딩 고정 프로퍼티 15 · map view 핀 100 · status 그룹 3 고정 · unique ID prefix 영숫자 2~7자 `[2차]`

---

## 3. MVP 판단

### 없으면 제품이 성립 안 되는 것 (P0)
| F-ID | 근거 |
|---|---|
| F-03-01 | 행=페이지 설계는 **전체 아키텍처를 규정**하고 되돌리기 비용이 가장 크다. 나중에 바꿀 수 없다 |
| F-03-02 | 스키마 CRUD 없이는 DB가 아니다 |
| F-03-03/04/06 | 스칼라 + select + date = 실제 사용 가능한 최소 타입 집합 |
| F-03-07(person) | 담당자 없는 협업 DB는 성립 안 함. person만 P0, files는 P1, place는 P2 |
| F-03-08 | 투영이라 비용 낮고, 정렬/필터 기본 축 |
| F-03-10 | **relation 없으면 노션형 DB라 부를 수 없다.** 엣지 테이블 설계는 사후 변경 불가 |
| F-03-16(기본 편집) | 그리드 키보드 내비 없으면 입력 불가 |
| F-03-17(축소 연산자) | **필터/정렬 없는 DB는 표가 아니라 목록**. 도메인 04(뷰) 전체의 전제 조건 |

### 빼도 되는 것 + 대체안
| 뺄 것 | 이유 → 대체안 |
|---|---|
| F-03-05 status | select로 표현 가능 → `select`에 `group_id`를 미리 두고 "그룹이 강제되는 select"로 승격. **보드뷰/진행률 계획이 있으면 P0으로 올려라** |
| F-03-12 formula | XL이라 MVP 예산 전부 소모 → rollup 11함수로 대체, v2에 최소 언어 |
| F-03-11 rollup | 관계만으로도 가치 있음 → v1에 **on-read 계산**(1,000행까지 충분) |
| F-03-13 재계산 그래프 | rollup/formula 넣는 순간 필수화 → **완전 lazy(저장 안 함, 조회 시 계산)**. 캐시·큐는 성능 문제 실측 후 |
| F-03-14 타입 변환 | 우회 가능 → "타입 변경 불가, 새 프로퍼티 만드세요". v1은 안전 변환 쌍 6~8개만 |
| F-03-09 unique ID | 이슈트래커형이면 P0 → 번호 발급만 v1, 전역 단축 URL 라우팅은 P2 |
| F-03-15/19/20 | 외부 시스템(메일/Slack/웹훅/LLM) 의존 → v3. 단 **`origin`/`trigger_source` 플래그는 처음부터** 이벤트에 실어라 |
| F-03-18 dependency | 프로젝트관리형이면 P0 → sub-item만 먼저(자기참조 relation + `parent_row_id`), dependency는 "화살표 표시만, 날짜 안 옮김" |
| F-03-21 템플릿 | 반복 스케줄러가 비용 대부분 → 1단계는 반복 없는 템플릿(페이지 복제 + 기본 템플릿 지정) |
| F-03-22 DB 잠금 UI | 단일 사용자면 P2 → **UI는 생략해도 `capability`를 레이어 분리 객체로 반환하는 함수 시그니처는 처음부터**(내부가 전부 `true`여도 무방) |
| F-03-23 verification | 코어 정합성 무관 → verified/unverified 2상태 + 수동 만료일. 검색 랭킹 반영은 범위 밖 |

### 로드맵 (원본 권고)
| 단계 | 포함 |
|---|---|
| MVP | 01, 02, 03, 04, 06, 07(person), 08, 10(**양방향만**), 16(기본편집), 17(축소 연산자) |
| v1 | 05, 09, 11(on-read rollup), 07(files), 21(반복 없는 템플릿), 22(capability 레이어) |
| v2 | 12(최소 formula), 13(stale 캐시+위상정렬), 14(안전 변환쌍), 18(sub-item) |
| v3 | 15, 19, 20, 18(dependency 날짜 전파), place, 23 |

> **역발상 권고**: MVP는 **양방향 relation만** 지원하고 단방향을 v1로 미루는 편이 단순하다. 엣지 1행 모델에서 단방향은 "역방향 프로퍼티가 없는 상태"일 뿐이다.

---

## 4. 기술 난제 (L/XL) & 권장 접근

| F-ID | 난이도 | 왜 어려운가 | 권장 접근 | 참고 OSS |
|---|---|---|---|---|
| F-03-12 formula | **XL** | 렉서/파서/타입체커/인터프리터 + 함수 100개+ + 에디터 UX. **도메인 최대 단일 작업** | 3단계 점진: (1)미지원 →(2)산술·비교·논리·if·empty·문자열10·날짜5 최소언어 →(3)List + map/filter/current. Pratt parser 또는 peggy/chevrotain. **`eval`/Function 생성 절대 금지(RCE)**. AST를 DB 캐시, `prop()`은 **property id로 바인딩**(이름 변경 내성). 결과 타입 **정적 추론**(동적이면 정렬 로직 붕괴) | NocoDB formula system(nested formula 지원) |
| F-03-13 의존 그래프 | **XL** | 초판 오류 정정: 그래프는 얕지 않다 — **최대 15단 DAG**. rollup-of-rollup만 UI에서 막힐 뿐 formula 한 단 끼우면 우회. 여기에 **권한이 곱해져 파생값 캐시가 권한 클래스별 N벌**로 쪼개짐 | 노드=(page_id, property_id). 무효화 트리거 3종(같은 페이지 / relation 경유 역인덱스 / 엣지 변경). `ref_depth = max(depends_on.ref_depth)+1` 저장 캐시로 O(직접의존수) 깊이 검사. **깊이 상한 15가 유한하므로 위상 정렬을 스키마 레벨에 캐시**. 팬아웃 폭발은 즉시계산 금지 → `stale` 마킹 + lazy. `now()/today()`는 `is_volatile` 로 캐시 제외 | NocoDB virtual column |
| F-03-19 자동화 | **XL** | 이벤트 버스 + 3초 디바운스 + 잡큐 + 재시도 + 루프방지 + 감사로그. button보다 위(클릭이라는 자연 디바운스가 없음) | **핵심은 `origin`/`trigger_source`+`depth`를 변경 이벤트에 실어 전파**. 자동화가 만든 이벤트에 `origin='automation'` → 평가기가 무시(노션의 "자동화→자동화 불가" 규칙 최소 재현). 액션 실행기는 **F-03-15 button과 1벌만** 만든다. MVP는 트리거 `속성편집`+액션 `속성편집(자기행)` 동기 실행 | — |
| F-03-01 3계층 | **L** | 되돌리기 비용. 페이지≡행 통합 여부가 전체를 규정 | page가 block을 참조/상속. database:data_source=1:1이라도 테이블은 분리 | AppFlowy, Teable |
| F-03-10 relation | **L** | 양방향 동기화 + 참조 무결성 + soft delete 복원 + 권한 필터링 | **엣지 1행 + inverse_property_id**(2행 복제는 동시성에서 반드시 불일치). 삭제된 페이지는 `deleted_at` 필터, 영구삭제 시 물리 삭제 | Teable link field |
| F-03-11 rollup | **L** | 집계는 쉽다. **무효화 전파 + 권한 필터링**이 캐시 설계를 근본적으로 바꿈(권한 없는 행 제외 시 사용자마다 결과가 달라짐) | on-read 시작 → `derived_value` + 무효화 큐. `show_original`/`min`/`max`는 **원본 역산 정보누출 경로** → 마스킹 + "N개 접근 불가" 표기 | NocoDB rollup(필터 조건 붙는 확장이 유용) |
| F-03-14 타입 변환 | **L** | 24×24 매트릭스 + 대량 배치 + 롤백 없음(노션은 확인 다이얼로그조차 없음) | **파괴적 UPDATE 금지 — 새 property 생성→채움→스왑**. `X → text → Y` 허브 패턴 + 손실 없는 쌍만 특수 처리. 스냅샷 N일 보관하면 노션 대비 명확한 개선점 | **AppFlowy `TypeOption` 맵**: 한 필드가 여러 타입의 설정을 동시 보관 → 되돌리면 설정 복원. **차용 강력 권고** |
| F-03-15 button | **L** | 액션 10종이 각각 다른 서브시스템(알림/메일/웹훅/Slack) | MVP는 `속성편집(self)` + `확인표시` 2종. 실행 깊이 제한으로 무한루프 차단 | — |
| F-03-16 셀 UX | **L** | 그리드 키보드 내비 + 붙여넣기 파싱이 개별 타입 구현보다 손이 많다 | 그리드 직접 제작 금지 → **TanStack Table + @tanstack/react-virtual** 위에 타입별 셀 렌더러/에디터. 키보드 내비만 직접 | — |
| F-03-17 필터·정렬 | **L / P0** | (a)타입×연산자 매트릭스 (b)EAV 피벗 성능 (c)파생 프로퍼티 필터 (d)권한 술어 결합. **`me`/`today` 등 평가 컨텍스트 노드** 때문에 결과 캐시 키가 `(view_id, actor_id, 평가일)`로 분열 | 연산자 카탈로그를 **코드가 아닌 데이터**로: `(property_type, operator) → sql_template` 테이블. `filter_ast`는 사용자 입력 → 문자열 SQL 연결 절대 금지. 정렬 안정성 위해 마지막 키에 `order_idx`/`page.id` 상시 부착. **권한 술어를 필터보다 먼저** 적용(건수 노출도 금지) | Teable(네이티브 SQL 정렬/필터) |
| F-03-18 sub-item/dep | **L** | 계층 순환 방지 + 필터/정렬 상호작용 + 날짜 전파(사실상 **작은 제약 해결기**) | `ancestor_path uuid[]` + GIN 인덱스(재귀 CTE만으로는 뷰 렌더마다 재귀). 불변식 `id = ANY(new.ancestor_path)`면 거부. 정렬은 **형제 그룹 내부에서만**. 필터 통과한 자식의 **조상 경로 강제 포함**(고스트 행). `relation_edge`가 정본, `parent_row_id`는 트리거 파생 | — |
| F-03-22 권한 분리 | **M~L** | 플래그는 S지만 **권한 판정 레이어 쪼개기 리팩터링**이 동반. 미룰수록 비싸짐 | `can_edit` boolean 하나로 두지 마라. 최소 4레이어: `read_rows/write_rows/create_rows/edit_schema/edit_views/edit_automations/run_buttons`. 잠금은 그중 2레이어를 덮는 **오버레이**. 판정은 요청당 1회 계산 후 캐시(행마다 하면 O(행×사용자)) | — |
| F-03-20 AI autofill | M~L | 프롬프트 인젝션(본문은 신뢰 불가 입력), 비용 폭발, 자기 트리거 루프, 비결정성 | `origin='ai'`로 재트리거 차단, `manually_overridden` 플래그로 사용자 편집 보호, 생성 완료 시 셀 버전 비교 후 stale write 방지. **비결정적이므로 정렬/필터 기준으로 부적합** | — |

### 저장소 선택 (원본 권고)
| 방식 | 권고 |
|---|---|
| EAV `page_property_value` + 타입별 파생 컬럼 | **MVP 권고** — 스키마 변경 DDL 불필요, 셀 단위 충돌 해소 자연스러움 |
| 페이지당 단일 `properties jsonb` | 프로토타입만 (프로퍼티별 인덱싱·셀 단위 충돌해소 불가) |
| 데이터소스별 물리 테이블 (Teable) | v2 이후 (100만행 이상, 대신 온라인 DDL 운영 복잡) |

**타입 시스템 권고**: TS 판별 유니온 `PropertyConfig`/`PropertyValue` + 타입별 모듈이 `{validate, parse, serialize, compare, format, convertFrom}` 6함수를 구현하는 **레지스트리 패턴**(AppFlowy `TypeOption` trait과 동형). 새 타입 = 파일 1개 추가.

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 및 주의 |
|---|---|
| **01 블록** | **행 = 페이지 = 블록 트리 루트**(별도 row 엔티티 금지). 템플릿은 블록 복제 로직 100% 공유. **rich_text 셀은 블록 본문과 동일한 CRDT/OT 경로**(LWW면 타이핑이 통째로 사라짐) |
| **02 페이지** | 인라인↔전체페이지 DB 변환(`is_inline`), 사이드바, 휴지통 연동. 부모 삭제 시 인라인 DB 연쇄 |
| **04 뷰** | **F-03-17이 뷰의 전제 조건.** `view_property_config`/`filter_ast`/`sort_keys` 소유 도메인 정본 결정 필요. Views API 정식 출시(2026-03-19) → **뷰를 프론트 로컬 상태로 두면 안 됨**, 설정 변경도 실시간 브로드캐스트 |
| **05 협업** | 셀 LWW vs rich_text CRDT 분기. **집합형(person/relation/files)은 LWW로 덮으면 한쪽 소실 → add/remove 오퍼레이션 병합.** 스키마 변경은 서버 직렬화 + `schema_version` 낙관적 잠금 |
| **06 권한** | **권한이 F-03-11(집계 대상)·F-03-13(캐시 분할)·F-03-17(필터 술어)에 전부 곱해진다** — 도메인 최대 과소평가 지점. boolean 하나로 시작하면 되돌리기 비용 최대 |
| **07 검색** | verification이 검색 랭킹·AI 응답 우선순위에 반영(2026-08-31). unique ID 전역 URL 라우팅. MVP 범위 밖 |
| **08 템플릿/자동화** | **F-03-21·F-03-19가 양쪽에 걸침 → 소유권 정리 필요.** button steps와 automation actions는 **스키마·실행기 1벌**(두 벌이면 반드시 갈라짐) |
| **09 API** | 필터 연산자 전수, 페이지네이션 10,000 상한, `me`/상대날짜, 템플릿 API, formula 왕복. **UI 능력 ≠ API 능력**(select 옵션 name/color는 API로 변경 불가) |
| **10 AI** | F-03-20의 LLM 게이트웨이·크레딧 회계 의존. 프롬프트 컨텍스트를 **실행자 권한으로 필터** 안 하면 권한 우회 유출 |
| **11 히스토리/알림** | 버전 히스토리가 **스키마를 스냅샷하지 않음** → F-03-14 롤백 불가의 근본 원인. 알림 폭풍(일괄 인증·대량 import) 억제 필요 |
| **16 아이템 레이아웃** | `page_layout_slot`(heading 15/body/side_panel, Simple·Tabbed)이 F-03-02/16과 **직접 중복** → 정본 도메인 지정. relation은 side_panel 배치 불가 |

---

## 6. 최우선 미해결 질문 (원본 27개 중 판단에 영향이 큰 5개)

| # | 질문 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| 1 | 각 타입 변환 쌍의 정확한 손실 규칙 (원본 #5) | F-03-14 변환 매트릭스 전체의 근거인데 **현재 상당수가 추정/2차 출처**. MVP에서 "안전한 쌍 6~8개"를 고르려면 이 실측이 선행돼야 함 | 22타입 주요 변환 쌍 실측 매트릭스 작성 |
| 2 | `last_edited_time` 이 갱신되는 정확한 조건 (하위 블록 편집 / 파생값 재계산 포함 여부) (원본 #6) | **무한 루프 방지의 핵심**. rollup ↔ last_edited 상호 트리거가 생기면 시스템이 자기증폭. 쓰기 증폭·실시간 재정렬 브로드캐스트 규모도 여기서 결정 | 실측 후 갱신 경로 화이트리스트 확정 |
| 3 | 자동화의 `속성 편집` 트리거가 formula/rollup 파생값 변경에도 발화하는가 (원본 #16) | 인정하면 **F-03-13 재계산 → F-03-19 자동화 → 재계산** 연쇄가 생긴다. 현재 문서 권고는 "파생 프로퍼티는 트리거 제외"이나 노션 실동작 미확인 | rollup 값이 변하는 시나리오로 실측 |
| 4 | 양방향 relation 한쪽 삭제 / 단방향↔양방향 전환 시 엣지 보존 여부 (원본 #3, #4) | **공식 헬프에 relation 삭제 동작이 아예 문서화되어 있지 않다.** 엣지 1행 모델의 삭제·마이그레이션 정책 전체가 여기 달려 있다 | 실측 |
| 5 | DB 잠금이 공개 API의 스키마 변경도 막는가 (원본 #15) + 쿼리 페이지네이션 10,000 상한이 UI 뷰에도 적용되는가 (원본 #27) | 전자는 잠금이 **실질 보호인지 UI 장식인지** 결정(F-03-22 capability 설계). 후자는 대용량 DB 무한 스크롤 UX 가능 여부 결정 | 잠긴 DB에 `PATCH /v1/data_sources/{id}` 시도 / 1만 행 초과 DB 표뷰 스크롤 |

> 그 외 미해결(요약): unique ID 재추가 시 번호 리셋 여부, 동명 프로퍼티 허용 여부, status 기본 옵션의 공식성(1차 미확인), 템플릿 `Set as default` 존재 여부(1차 미확인), date/place config의 API 미노출 스키마, button·verification의 retrieve 응답 형태, `this_week` 상대필터의 주 시작요일·타임존 기준, sub-item 중첩 깊이 상한·부모 삭제 정책, 참조 깊이 16단 실측, `database_type`의 실제 동작 차이.

---

## 7. 원본에서 뒤집힌 전제 (마스터 문서에 반드시 반영)

| 잘못된 통념 | 정정 |
|---|---|
| "formula는 다른 formula를 참조할 수 없다" | **틀림.** 참조 체인 **깊이 15**까지 허용(2024-08 이전 7). 1차 출처 확인 |
| "rollup 중첩 금지가 순환을 원천 차단한다" | **틀림.** rollup→formula→rollup 우회 가능 → **저장 시 DFS 사이클 검출을 직접 구현해야 함** |
| "파생값 그래프는 얕다" | **틀림.** 최대 15단 DAG. 위상 정렬·사이클 검출 생략하면 반드시 무너짐 |
| "프로퍼티 표시는 3단계 enum(항상/값있을때만/항상숨김)" | 현행 헬프 미확인. **레이아웃 빌더 모델**(visible bool + area enum)로 대체. 조건부 표시는 현행 노션에 없음 |
| "verification은 위키 전용" | **틀림.** 임의 DB에 추가 가능하며 **`Owner` 프로퍼티를 자동 동반 생성**(프로퍼티가 다른 프로퍼티를 만드는 유일 사례) |
| "노션에 프로퍼티 기본값이 없다" | 부분 정정: 범용 기본값은 없고 **템플릿이 유일 수단**. 단 **status만 예외로 default option 보유** `[2차]` |
| "헬프가 24종 타입 명시" | 오기. 실제 22종 |
| "체인 깊이 초과 시 무경고" | 부분 정정: 공식 헬프에 `Formula depth limit reached` 에러 항목이 **존재**. "조용히 실패"는 2차 출처만 → **클론은 저장 시 명시적 거부**가 명백한 개선점 |

## 8. 핵심 출처 (원본 47개 중 상위)

1차: `notion.com/help/{database-properties, intro-to-databases, relations-and-rollups, formula-syntax, common-formula-errors, database-automations, database-templates, database-buttons, tasks-and-dependencies, customize-your-database, layouts, autofill, wikis-and-verified-pages, unique-id, maps}` · `developers.notion.com/{reference/property-object, reference/update-property-schema-object, reference/post-database-query-filter, reference/request-limits, guides/get-started/upgrade-guide-2025-09-03, page/changelog}`
2차/OSS: AppFlowy `TypeOption`, Teable(Postgres 물리테이블), NocoDB virtual column, thomasjfrank.com(참조 체인 15)
