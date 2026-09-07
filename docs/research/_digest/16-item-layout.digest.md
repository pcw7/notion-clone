# [DIGEST] 16. 데이터베이스 항목 페이지 레이아웃 빌더

> 원본: `docs/research/16-item-layout.md` (773행, 85KB) / 조사일 2026-09-06 / API `2025-09-03`
> 기능 수: **12개 (F-16-01 ~ F-16-12)** — 아래 인벤토리 12행과 일치 검증 완료
> 이 도메인의 정체: **기능으로는 대부분 P2, 데이터 모델로는 P0.** 레이아웃 빌더 UI를 안 만들어도 되지만, 여기서 요구하는 4개 축(`view.owner_kind`, 필터 AST `current_page`, `property_type.can_place_in_panel`, page 설정 `scope`)은 지금 결정하지 않으면 나중에 전면 수정을 부른다.

## 0. 핵심 불변식 (마스터 문서가 반드시 반영해야 할 3줄)

1. **레이아웃 스코프 = data_source 1개당 1벌.** 행별도 뷰별도 아니다. 1차 출처 원문: `A page layout will apply to all pages in the database. Layouts can't be applied only to specific pages or specific views.` (https://www.notion.com/help/layouts)
2. **스코프 3층이 서로 다른 곳에 저장된다.** L1 레이아웃(data_source 단위) / L2 뷰 설정(`Open pages in` = view 단위, F-04-21) / L3 뷰어 로컬(패널 펼침·선택 탭·peek 폭). 한 테이블에 합치면 즉시 어긋난다.
3. **Content 탭 안에 소유권이 2개 섞인다.** 모듈 배치 = 레이아웃(전 행 공통), 본문 블록 = 행 소유(행마다 다름). 클론에서 가장 흔한 설계 실수 지점.

---

## 1. 기능 인벤토리 (전수 12/12)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-16-01 | 레이아웃 편집 모드 진입 & 적용 스코프 (`Customize layout` → `Apply to all pages`) | M | P1 | F-04-01, F-03-02, F-04-25, F-16-12 |
| F-16-02 | Heading 모듈 & pinned 프로퍼티 (최대 15개, 가로 스크롤러) | S~M | P1 | F-16-01, F-03-02, F-03-16, F-16-03 |
| F-16-03 | Property group & 섹션(`Add section`) — 잔여 프로퍼티 컨테이너 | M | **P0** (섹션만 P2) | F-16-01, F-16-02, F-16-04, F-03-02 |
| F-16-04 | 개별 프로퍼티 모듈 승격 & 모듈 배치 이동 (Move up/down/to panel/to page) | M | P2 (sub-item DB면 P1) | F-16-03, F-16-05, F-03-02 |
| F-16-05 | 상세 패널(Details panel) — 접이식 우측 보조 영역 | S~M | P2 | F-16-04, F-16-01, F-03-14 |
| F-16-06 | 구조 전환 Simple ↔ Tabbed | S | P2 | F-16-07, F-16-08 |
| F-16-07 | Content 탭 — 본문 블록 트리와 모듈의 소유자 (소유권 분리) | S | **P0** | F-16-06, 도메인 01, F-02-01 |
| F-16-08 | 관련 DB 탭 — 지속되는 linked view + `current_page` 자동 필터 | **L** | P2 (단 `view.owner_kind` 축은 **P0 결정**) | F-16-06, F-03-10, F-03-17, F-04-01/09/13/15/25 |
| F-16-09 | Backlinks 표시 모드 3택 (Always / Hover / Off) | S | P2 | F-02-14, F-16-02 |
| F-16-10 | Page settings 4종 (inline comment mode / discussions / property icons / full width) | S | P2 (`full_width`만 P1) | F-16-01, F-02-07, F-02-08, 도메인 11 |
| F-16-11 | peek 컨테이너 × 레이아웃 반응형 폴백 | M | P1 | F-04-21, F-02-20, F-16-05, F-16-06 |
| F-16-12 | 영속화·동시편집(낙관적 잠금)·감사·마이그레이션 | M | P1 (감사/히스토리 P2) | F-16-01~11, F-04-25, 도메인 05/11 |

**하드 제약(1차/교차 확인)**: pinned ≤ **15개** / Heading 모듈 **이동·제거 불가** / Property group **레이아웃당 1개, 제거 불가(이동만)** / Content 탭 **정확히 1개, 제거 불가** / relation 등 일부 타입 **패널 배치 불가** / 빌더는 **데스크톱·웹 전용**(모바일은 열람만) / 권한 **`at least Can edit` on the database**(= 스키마 변경과 같은 권한 클래스, `Can edit content`로는 불가).

---

## 2. 데이터 모델 — 이 도메인이 요구하는 것

> 스키마 정본은 `00-canonical-data-model.md`. 여기서는 **요구사항만** 기술한다.
> 단 원본 16번 문서는 **`layout_tab` 테이블의 정본 정의를 소유**한다고 선언한다 — 03 F-03-16의 `page_layout_slot.tab_id` dangling FK(비평 U-1)를 해소하는 지점.

### 2.1 신규 엔티티 3개 (03의 `page_layout_slot`을 **대체**)

| 엔티티 | 카디널리티 | 핵심 필드 | 존재 이유 |
|---|---|---|---|
| `page_layout` | data_source **1:1** (PK = data_source_id) | `structure(simple\|tabbed)`, `backlinks_mode(always\|hover\|off)`, `inline_comment_mode(default\|minimal)`, `show_discussions`, `show_property_icons`, `full_width`, `updated_by`, **`version bigint`** | L1 스코프 고정. `version`은 낙관적 잠금용 |
| `layout_tab` | page_layout 1:N | `kind(content\|linked_view)`, `name`, `icon`, `view_id`(linked_view일 때만 NOT NULL), `relation_property_id`, `order_idx`(fractional) | **U-1 dangling FK 해소** |
| `layout_module` | layout_tab 1:N (자기참조 1단계) | `kind(heading\|property_group\|property\|backlinks\|section)`, `area(heading\|main\|panel)`, `parent_module_id`, `property_id`, `label`, `visible`, `order_idx` | 프로퍼티 없는 모듈 + 섹션 계층 표현 |

**`page_layout_slot`이 표현 못 한 4가지**: ① 프로퍼티 없는 모듈(Heading/Property group/Backlinks)인데 PK가 `property_id` 요구 ② 섹션(1단계 그룹핑) ③ "승격하면 그룹에서 빠짐"(부모 참조 필요) ④ `tab_id`의 참조 대상 부재.

### 2.2 불변식 (스키마 제약으로 옮겨야 함)

| ID | 내용 | 강제 위치 |
|---|---|---|
| T1 | data_source당 `kind='content'` 탭 정확히 1개 | 부분 UNIQUE 인덱스 |
| T2 | `structure='simple'`이어도 탭 레코드는 **보존** (전환을 무손실 토글로) | 렌더러 규칙 |
| M1 | `kind='heading'`은 탭당 1개, `area='heading'` 고정, 삭제 불가 | 부분 UNIQUE + 앱 |
| M2 | `kind='property_group'`은 탭당 정확히 1개, 삭제 불가 | 부분 UNIQUE 인덱스 |
| M3 | `area='heading' AND kind='property'` ≤ **15** | **앱 검증**(개수 제약은 인덱스로 표현 불가) — 커밋 트랜잭션 내 `count(*)` |
| M4 | `area='panel'`인 property의 타입은 `can_place_in_panel=true` | 앱 + 타입 메타 |
| M5 | 같은 property_id가 한 탭에 2개 모듈로 나타나지 않음 | 부분 UNIQUE 인덱스 |

### 2.3 설계 결정 2개 (마스터가 반드시 승계할 것)

- **`pinned` 컬럼을 두지 않는다.** "pin됨" ≡ `area='heading'`. 두 곳에 진실을 두면 반드시 어긋난다. UI 핀 아이콘 = `area`를 `heading ↔ main`으로 토글.
- **Property group은 잔여 계산(sparse 저장)이다.** 내용 = `모든 property − (pin ∪ 승격)`. 모듈 행은 **기본 동작에서의 이탈만** 기록. 승격 목록을 그룹 안에 복사하면 **새 프로퍼티가 어디에도 안 보이는 버그**가 반복된다. Teable의 "비파괴적 뷰 오버레이"와 같은 원리.

### 2.4 기존 엔티티에 요구하는 축 (R1~R14 압축) — **여기가 이 도메인의 실제 가치**

| # | 대상 | 요구 | 없으면 |
|---|---|---|---|
| **R2** | `view` | **`owner_kind ∈ {database_view, layout_tab, dashboard_widget}`** | 탭 뷰가 DB 뷰 목록에 노출됨. 삭제 캐스케이드 갈림. **나중에 넣으면 모든 뷰 조회 쿼리 수정** |
| **R3** | `view.filter` AST | 평가 컨텍스트에 **`current_page` 노드** (F-03-17의 `me`/상대날짜와 **같은 메커니즘 재사용**). 캐시 키 `(view_id, actor_id, 평가일)` → **`+ current_page_id`** | 탭 뷰가 모든 행에서 같은 결과 = 기능 자체 불성립 |
| **R4** | `property_type` 메타 | `can_pin bool` / `can_place_in_panel bool` | 배치 불가 조합을 서버가 못 막아 렌더러 런타임 붕괴 |
| **R5** | `page`(row) | **레이아웃 컬럼을 가지면 안 됨(negative)**. 동시에 page 설정 필드에 `scope ∈ {page, data_source_layout}` 축 필요 | 행별 full_width vs 레이아웃 값 충돌 미정의 |
| R1 | `data_source` | 레이아웃 소유자는 database가 아니라 **data_source** `[확인필요]` | 다중 data source DB(F-04-23)에서 레이아웃 개수 미결 |
| R6 | `property` | 삭제 시 모듈 캐스케이드 + 타입 변환(F-03-14) 시 배치 능력 재검증 | 유령 모듈 잔존 |
| R7/R8 | ACL / Lock | 레이아웃 편집 = `Can edit`(스키마 클래스). `Lock database` 범위에 포함 `[추정]` | 데이터 편집자가 전원 화면 변경 |
| R9 | 감사 | `object_kind='data_source_layout'` 필요. **페이지 버전 히스토리 아님** | 전 구성원 영향 변경의 추적 불가 |
| R10 | 동시편집 | **CRDT 아님.** `version` 낙관적 잠금 + **전체 교체**, 드래프트는 클라이언트 `[추정]` | 모듈 순서가 섞임 |
| R11 | 복제 | 레이아웃 + 탭 + **탭 소유 뷰** 함께 복제. 외부 data_source는 복제 대상이면 리매핑, 아니면 원본 유지 | 템플릿 배포 시 남의 워크스페이스 참조 |
| R12 | 검색 | 레이아웃은 인덱싱 대상 아님(negative). **`visible=false` 프로퍼티도 검색에서 제외 금지** — 표시 규칙이지 접근 제어가 아니다 | 숨긴 값이 데이터 유실로 보임 |
| R13 | 실시간 | `data_source_layout:{id}` 구독 채널. **version만 push, 클라이언트 재조회**(05 pull 모델과 정합) | 새로고침 전까지 옛 레이아웃 |
| R14 | 반응형 | 모바일 빌더 비활성 + 패널/탭 폴백 규칙 | 좁은 화면에서 패널이 본문을 덮음 |

### 2.5 API 형태
`GET/PUT /data_sources/{id}/layout` **전체 교체 1개**(If-Match: version). 모듈 단위 PATCH를 만들면 순서 병합 문제 발생. 저장은 정규화 테이블이지만 **API 페이로드는 중첩 JSON 1건**. 공개 Notion API에는 레이아웃 엔드포인트가 **없음** `[확인필요]` → 클론이 노출하면 순증 기능.

---

## 3. MVP 판단

### 없으면 제품이 성립 안 함 (P0)

| 항목 | 근거 |
|---|---|
| **F-16-03 Property group (섹션 제외)** | 이 컨테이너가 곧 "행 페이지의 프로퍼티 목록"이다. 없으면 행을 열었을 때 보여줄 것이 없다. 잔여 계산 규칙을 대충 하면 "새 프로퍼티가 안 보이는" 버그가 반복 |
| **F-16-07 Content 탭 = 소유권 분리** | Tabbed를 안 만들어도 "모듈 배치(전역) vs 본문 블록(행별)" 경계는 필수. 코드에서 흐리면 레이아웃 삭제가 본문을 지우거나, 본문 편집이 레이아웃 version을 올려 모든 행이 충돌 |
| **`view.owner_kind` 축 (F-16-08의 스키마 부분만)** | 기능은 P2지만 축은 P0. 나중에 추가하면 모든 뷰 조회 쿼리 전면 수정 |

> 보강 근거: **AppFlowy**는 Row detail이 프로퍼티 목록 + 본문 고정 구성이고 커스터마이즈 레이어가 아예 없다 → **레이아웃 빌더 없이도 DB 클론이 성립한다는 실증**.

### 빼도 되는 것 + 대체안

| 뺄 것 | 이유 | 대체안 |
|---|---|---|
| F-16-01 드래그앤드롭 빌더 | 폼 빌더 UI 비용 대비 MVP 가치 낮음 | **순서 변경 + pin 토글 + 패널로 보내기** 3동작만 리스트 UI(dnd-kit 리스트 1개). 자유 배치 캔버스는 v2 |
| F-16-02 수동 pin | — | **프로퍼티 순서 상위 5개 자동 pin** 규칙형. 상한을 15 → **8**로 낮추면 가로 스크롤러를 통째로 생략 가능(NocoDB는 pin 3개 상한) |
| F-16-03 섹션 | 정리 편의 기능 | 단일 목록 + `property.order_idx` 재사용 + 숨김 토글. **레이아웃 전용 순서를 따로 두지 않는다** |
| F-16-05 상세 패널 | 프로퍼티 20개 미만이면 체감 없음 | **Property group을 접이식으로** 만들면 80% 대체. 만들더라도 `position:sticky` 컬럼 + 미디어쿼리 |
| **F-16-08 관련 DB 탭 (L)** | 유일한 L, 참고 오픈소스 없음 | **relation 프로퍼티를 본문에서 인라인 목록으로 펼치는 모듈**(F-16-04)로 대체 → **L → S**. 필터·정렬 없이 목록만으로 실사용 대부분 커버 |
| F-16-06 구조 전환 | 설정 항목 증가 | **항상 Simple** 로 시작. 탭 도입 시 자동으로 Tabbed 켜짐 |
| F-16-09 backlinks 3택 | `hover`는 모바일에서 무의미 | **on/off 2택** |
| F-16-10 page settings | — | **`full_width`만** 구현. 나머지 3개는 코멘트 기능 완성 후 |
| **F-16-11 반응형 폴백** | — | **MVP는 full page만 지원**(F-02-20 권고와 동일) → 이 기능 통째로 소멸. side peek 도입 시 폴백 4행만 |
| F-16-12 히스토리/감사/실시간 전파 | 변경 빈도 낮음 | `version` 낙관적 잠금만. 전파는 **다음 페이지 오픈 시 반영**으로 충분 |

---

## 4. 기술 난제 & 권장 구현 접근

### F-16-08 관련 DB 탭 (유일한 **L**)

**왜 어려운가 — 다섯 갈래가 모두 기존 시스템을 건드린다**
1. `view.owner_kind` 축 추가 = 기존 스키마 변경
2. 필터 AST에 `current_page` 컨텍스트 바인딩
3. 캐시 키 차원 확장 → **엔트리 수가 행 수만큼 곱해짐**
4. 레이아웃은 편집자 권한으로 정의되지만 **렌더는 뷰어 권한으로 실행** — 이 분리를 놓치면 권한 우회
5. lazy 탭 쿼리 + peek 빠른 전환 시 요청 취소

**권장 접근**
- 필터 노드를 새로 만들지 말고 **F-03-17의 `me`/상대날짜 컨텍스트 메커니즘 재사용**(새로 만들면 필터 평가기가 두 벌).
  `{ "property": "<relation_prop_id>", "relation": { "contains": { "$context": "current_page" } } }`
- **탭 뷰 결과는 캐시하지 않거나 짧은 TTL** (행 수 × 캐시 엔트리 폭발 회피)
- **비활성 탭은 쿼리하지 않는다(lazy)** + peek 넘김 시 **디바운스 200ms + 이전 요청 취소** (없으면 20행 훑을 때 쿼리 20개)
- **relation 기반 탭만 허용** 권고 — 무관한 DB를 붙이면 자동 필터 근거가 사라져 본문 linked view와 구별 불가
- `owner_kind='layout_tab'` 뷰는 **일반 뷰 삭제 경로에 노출되면 안 됨**. 탭 삭제가 뷰를 지우는 유일한 경로
- 순환(A탭→B, B탭→A)은 **행 페이지가 중첩 렌더되지 않으므로 무한 루프 없음**. peek 스택 깊이 제한만 필요

**참고 오픈소스**: **없음.** Notion Tabbed layout에 해당하는 기능을 가진 OSS는 확인되지 않음 — 이것이 L 평가의 부수적 근거.

### 참고 오픈소스 (도메인 전체)

| 프로젝트 | 차용 포인트 |
|---|---|
| **NocoDB** (Expanded record) | 레코드 상세를 뷰 설정의 일부로 두는 단순 모델. **pin 상한 3개** → 낮은 상한이 구현·성능 모두 유리하다는 근거 |
| **NocoDB** (Interfaces/layouts, Page Designer) | 레이아웃 레이어를 데이터 레이어와 **별도 테이블로 분리**. 자유 배치 디자이너를 **코어가 아닌 확장**으로 뺀 결정 |
| **Teable** | 뷰 = 비파괴적 오버레이, **sparse 저장(기본 이탈만 기록)** — F-16-03 잔여 계산의 직접 근거 |
| **AppFlowy** | 레이아웃 빌더 없이 DB 클론 성립 실증 |
| **AFFiNE / BlockSuite** | 본문 블록 트리 vs 모듈 영역 소유권 분리 참고 후보 `[확인필요]` |

### M 등급 중 실제 함정

- **F-16-01**: "드래프트 → 1회 커밋(`Apply to all pages`)"이 **노션 전반의 자동저장 원칙에 대한 명시적 예외**. 이 화면에만 다른 저장 모델을 만들어야 한다.
- **F-16-07**: 본문 CRDT와 모듈 낙관적 잠금이 **한 화면에 공존**. 본문 편집이 레이아웃 `version`을 올리면 모든 행 편집이 레이아웃 충돌을 유발.
- **F-16-11**: CSS **container query**로 처리. 리사이즈마다 JS 리렌더하면 편집 중 포커스가 튄다. 폴백 임계값(≥1100 / 700~1100 / 480~700 / <480px)은 **원본에 수치가 없는 클론 자체 규약**.
- **F-16-12**: 로직은 단순(전체 교체 + 낙관적 잠금), 비용은 **캐스케이드·복제·타입변환 정합성 5갈래**를 빠짐없이 거는 데 있다.
- **F-16-10 물질화 규칙**: 일반 페이지 → DB 행 이동 시 개별 `full_width` 무시(보존만), DB 행 → 일반 페이지 이동 시 레이아웃 값을 **페이지 설정으로 물질화**. 안 하면 화면이 갑자기 바뀐다.
- **공통 렌더 규칙**: 빈 값 프로퍼티는 **자리 유지 + placeholder**(자동 숨김 없음). 눈(👁️) 숨김은 **표시 규칙이지 접근 제어가 아니다** — 숨김을 보안 수단으로 홍보 금지.

---

## 5. 다른 도메인과의 접점

| 상대 | 접점 |
|---|---|
| **03-database-core** | (16→03 정정) `page_layout_slot` 폐기 / 한도 15 → 불변식 M3 승격 / 03 미해결 14 ≡ 16 미해결 5 병합 / "relation은 패널 불가" 단문 → R4 스키마화 / F-03-16 레이아웃 서술은 F-16-xx 포인터로 축약. 셀 편집기는 pinned·모듈 값 편집에 **그대로 재사용**(F-03-16의 L·P0 등급엔 개입 안 함). F-03-17 컨텍스트에 `current_page` 추가. F-03-14 타입 변환은 배치 능력 재검증 트리거 |
| **04-database-views** | `view.owner_kind`(R2), 탭 = view 재사용, F-04-21 `Open pages in`은 **L2로 분리 유지**(레이아웃에 넣지 말 것), F-04-13 linked view와의 차이, F-04-15 페이지네이션, F-04-25 뷰어 권한 재판정, F-04-23 다중 data_source |
| **02-page-workspace** | F-02-07 `full_width`에 `scope` 축(R5), F-02-14 백링크 본체, F-02-20 peek 라우팅·스택 깊이, F-02-08 이동 시 물질화, F-02-16 `?tab=` 딥링크 `[추정]` |
| **01 (블록 에디터)** | Content 탭 본문 = `block(parent_id = row_page_id)`. **`layout_tab` 캐스케이드는 `layout_module`까지만 도달** |
| **05 / 11 / 06 / 12** | 05: `data_source_layout:{id}` 채널, version-only push. 11: `object_kind='data_source_layout'` 감사(페이지 히스토리 아님), discussions off여도 알림은 계속 → 진입 시 강제 표시 예외. 06: 레이아웃 편집 = 스키마 권한 클래스, `Lock database` 포함 `[추정]`. 12: 패널 펼침·선택 탭·peek 폭 = `user_setting(scope='device')` |
| **08 / F-03-21 (템플릿·복제)** | 템플릿은 본문+기본값만 채우고 레이아웃 미개입. DB 복제 시 레이아웃+탭+탭소유뷰 동반 복제, 워크스페이스 간 복제 시 외부 참조는 `구성 오류` + 임포트 리포트 |

---

## 6. 최우선 미해결 질문 (원본 19개 → 상위 5개)

| # | 질문 | 왜 최우선인가 |
|---|---|---|
| 1 | **레이아웃 소유자가 database인가 data_source인가** (헬프센터는 "database", 2025-09-03 모델의 행 집합 단위는 data_source) | PK가 바뀐다. 다중 data source DB에서 레이아웃 개수가 결정됨. **스키마 정본 문서가 먼저 확정해야 함** |
| 2 | **자동 필터의 정확한 형태·라벨**(`Page containing this view` — 2차 출처만) + relation 없는 임의 DB도 탭으로 붙일 수 있는가 | 필터 AST `current_page` 컨텍스트 노드의 **계약**. 붙일 수 있으면 `relation_property_id NOT NULL` 제약을 풀어야 하고 자동 필터의 근거가 사라짐 |
| 3 | **패널 배치 불가 타입의 전수 목록** (문서는 `Some properties, like Relation`만) | R4 `can_place_in_panel` 플래그 값을 채울 수 없음. **실측 필요** |
| 4 | **pinned 상한이 15인가 4인가** (1차 help/layouts=15, 2차 notion.vip=4) | 15를 정본 채택했으나 4가 "동시 표시 개수"일 가능성. 가로 스크롤러 구현 여부가 갈림. **UI 실측** |
| 5 | **조건부 표시(값 있을 때만 표시) 존재 여부** — **03 미해결 14와 동일 항목(중복 추적 금지, 병합 대상)** | 존재하면 `layout_module`에 `visible_when` 축이 하나 더 생긴다 = 스키마 변경 |

> 잔여 확인필요(낮은 우선순위): 탭 개수 상한(소프트 리밋 필요) / 탭 이름·아이콘·순서 변경 / Tabbed→Simple 전환 시 탭 삭제 vs 보존(클론은 **보존** 선언) / 드래프트 서버 저장 / 레이아웃 공개 API 노출 / linked database에서 원본 레이아웃 승계 / 패널 펼침 상태 서버 저장 / `Apply` 이후 undo / Dashboard·Feed·Form 뷰를 탭에 넣을 수 있는가(가능하면 F-04-18/20과 조합 폭발, form 탭은 새 권한 축) / Enterprise 감사 기록 / `Minimal` 코멘트 시각 차이 / `searchable sections` 의미 / 출시 시점.

---

## 출처 (원본 14개 → 핵심 10개)

**1차**: (1) https://www.notion.com/help/layouts — 정본. 진입 경로, pin 15, Heading/Property group/Details panel/Page settings, `Add section`, `Add to panel`, Backlinks 3택, Simple vs Tabbed, 적용 스코프 원문, `at least Can edit access`, 모바일 제약 · (2) https://www.notion.com/help/views-filters-and-sorts — `Open pages in`이 **뷰 단위** · (3) https://developers.notion.com/reference/database — 2025-09-03 `data_sources[]`, **layout 필드 미노출** 근거 · (4) https://www.notion.com/help/relations-and-rollups · (5) https://www.notion.com/releases/2025-07-10 · https://www.notion.com/releases/2022-07-20

**2차**: (6) https://notionmastery.com/tabbed-layout-adds-application-style-ui-to-notion/ — `+`가 relation 목록 제시, `Page containing this view` Quick Filter, Content 탭 1개 · (7) https://www.notion.vip/insights/notion-tabbed-page-layouts — 영역 3구분, DB당 레이아웃 1개. **pinned를 4로 서술 → 1차(15)와 불일치(미해결 4)** · (8) https://www.simple.ink/guides/a-complete-guide-to-using-notions-new-layouts-feature — 패널 기본 숨김 · (9) https://www.eazypath.com/blog/notion-layouts-guide — 모듈 `•••` 4항목, `Apply to all pages`

**OSS 대조군**: (10) https://nocodb.com/docs/interfaces/layouts · https://nocodb.com/docs/product-docs/extensions/page-designer · https://help.teable.ai/en/changelog
