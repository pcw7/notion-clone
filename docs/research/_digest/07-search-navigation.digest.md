# 07. 검색 · 네비게이션 · 커맨드 — 다이제스트

> 원본: `docs/research/07-search-navigation.md` (1180줄) / 기능 수 19개 (F-07-01 ~ F-07-19, 검증 완료: 표 행 19 = `### F-` 개수 19)
> 이 도메인의 지배 원칙 3가지: (1) 인덱싱 단위가 페이지가 아니라 **block**, (2) **권한은 인덱스 시점에 문서로 비정규화**되어 쿼리 필터 절에 들어간다(후처리 금지), (3) 인덱스는 **eventual consistent**이고 공식 API도 이를 명시한다.

---

## 1. 기능 인벤토리 (전 19건)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-07-01 | 글로벌 검색 패널 (`cmd+K`/`cmd+P` 오버레이) | L | **P0** | 02, 03, 04, 06, 07 |
| F-07-02 | 검색 쿼리 파싱 및 결과 랭킹 | L | **P0**(기본) / P1(개인화) | 01, 06 |
| F-07-03 | 검색 필터 (Title only·Created by·Teamspace·In·Date) | M (In 필터 포함 시 L) | P1 | 01, 06, 권한 |
| F-07-04 | 최근 방문 페이지(Recent) · 빈 상태 내비게이션 | **S** | **P0** | 라우팅, 권한 |
| F-07-05 | 페이지 내 검색 (`cmd+F`) | M | P1 (가상 스크롤 도입 시 P0) | 에디터 문서 모델 |
| F-07-06 | 검색 인덱싱 파이프라인 (block → search document) | **XL** (Postgres 방식이면 실질 S) | **P0** | 블록 저장, 권한 |
| F-07-07 | 권한 인지 검색 (permission-aware retrieval) | **XL** (방식 B 채택 시 L) | **P0** | 권한 도메인, 06 |
| F-07-08 | 인라인 링크 자동완성 (`@` / `[[` / `+`) | L | **P0**(`@`) / P2(`[[`,`+`) | 에디터 inline node, 07, 09 |
| F-07-09 | 백링크 · 링크 그래프 | M | P1 | 08, 권한 |
| F-07-10 | 슬래시 커맨드 메뉴 (`/`, `cmd+/`) | M | **P0** | 블록 타입 정의(F-01/02) |
| F-07-11 | 커맨드 팔레트 / 전역 Command Search | M(웹) / **L**(데스크톱 전역 런처) | P2 | 01, 10, 데스크톱 셸, 13 |
| F-07-12 | 페이지 간 이동 · 히스토리 · 탭 | M | P0(뒤/앞·URL복사) / P1(`shift+U`,새탭) / P2(데스크톱 탭) | 라우팅, 블록 트리, F-05 뷰 상태 |
| F-07-13 | AI Q&A / Enterprise Search (semantic) | **XL** | P2 | 06, 07, 커넥터 OAuth, LLM 게이트웨이 |
| F-07-14 | 데이터베이스 내 검색 (뷰 🔍) | S~M | P1 | DB/뷰 도메인(F-05) |
| F-07-15 | 관리자 콘텐츠 검색 (Admin Content Search) | L | P2 | 06, 07, 관리자/조직 도메인 |
| F-07-16 | 사이드바 트리 내비게이션 · 즐겨찾기 | L (실시간 트리 동기화 요구 시 **XL**) | **P0** | 블록 트리, 권한/teamspace, 07, 12 |
| F-07-17 | URL · breadcrumb · 블록 앵커 딥링크 | M (가상 스크롤 없으면 S) | **P0**(페이지 URL·breadcrumb) / P1(블록 앵커) | 12, 07, 블록 트리, 09 |
| F-07-18 | 외부 표면 검색 API (REST `/v1/search` · MCP 툴) | M~L | P2 (에이전트 연동이 가설이면 P1) | 06, 07, 인증/토큰 |
| F-07-19 | `Home` · `Library` 브라우징 표면 | M (Library 컬럼 커스터마이즈까지 L) | P1 | 04, 16, 07 — **06에 의존하지 않음** |

**P0 10건**: 01, 02, 04, 06, 07, 08, 10, 12(부분), 16, 17(부분)

### 난이도 오독 주의 3건 (원본이 명시적으로 경고)
| 기능 | 함정 |
|---|---|
| F-07-06 | **과대평가 주의.** Notion의 XL은 ES 클러스터·CDC·재색인 전제값. Postgres `GENERATED tsvector` + GIN이면 실질 **S**. "원본이 XL이니 우리도 XL"이 가장 비싼 오독 |
| F-07-07 | **과소평가 주의.** 누출 지점이 6개 이상 독립 코드경로(자동완성/백링크/AI span/공개 API/MCP/최근방문/breadcrumb/결과 건수/스니펫/트리 조회). 권한을 인덱스 쿼리 안에 넣지 않으면 페이지네이션이 깨짐 → **F-07-06과 분리 발주 불가** |
| F-07-16 | 트리 **이동**의 동시편집 수렴은 텍스트 CRDT가 풀어주지 않는 별개 문제. last-write-wins는 노드 소실·순환 발생 |

---

## 2. 데이터 모델 요구사항 (정본은 `00-canonical-data-model.md`)

이 도메인이 **요구**하는 것만 나열. 새 스키마 창작 금지.

### 기존 엔티티에 요구하는 필드
| 엔티티 | 요구 필드 | 요구 이유 |
|---|---|---|
| `block` | `space_id`(라우팅/스코프 키), `parent_id`, `page_id`, `type`, `plain_text`(rich_text flatten 파생), `properties`, `created_by/at`, `last_edited_by/at`, `in_trash`, `version`(낙관적) | 인덱싱 단위·필터 축·순서 보장 |
| `block` | **`order_key text` (fractional index)** | 정수 시퀀스 금지 — 동시 삽입 시 재정렬 폭발 (F-07-16) |
| `block` | **`path text` (materialized path) 또는 `ancestor_ids uuid[]`** | 단일 필드 최고 수익률. **5회 재사용**: breadcrumb / `In` 필터 / `shift+U` / 검색 결과 경로 / 사이드바 현재 위치. 서브트리 이동 시 `UPDATE ... WHERE path LIKE '/a/%'` 한 방으로 F-07-06 XL의 절반 제거 |
| `page`/`block` | **`permission_scope_id`** (가장 가까운 권한 경계) | 클론 권장 권한 방식 B. `WHERE permission_scope_id = ANY($scopes)` |
| `block` | `sidebar_section` (`private`/`shared`/`teamspace`) — 권한 상태에서 **파생** `[추정]` | 섹션은 저장된 분류가 아니라 파생 뷰 |

### 이 도메인 고유 엔티티
| 엔티티 | 핵심 필드 | 필요 인덱스 | 소비처 |
|---|---|---|---|
| `search_document` | doc_id=block.id, routing=space_id, page_id, ancestor_ids[], title_text/body_text(필드 분리 필수), lang, **principals uuid[]**, is_public, created/edited by·at, in_trash, version | routing 샤딩, principals terms, 역색인(언어별 analyzer), 시각 range+sort | 01,02,03,06,07,15,18 |
| `vector_span` | span_id, page_id, chunk_index, text, embedding, **text_hash + meta_hash(2중)**, principals[], authors[], last_edited_at | page_id, 벡터 인덱스 | 13, 18(ai-search) |
| `recent_visit` | (user_id, block_id) pk, space_id, last_visited_at, visit_count | (user_id, last_visited_at desc) | 01(빈 상태), 04, 19(Home/Library) — **읽기 경로 3개** |
| `favorite` | (user_id, block_id) pk, space_id, **order_key**, created_at | (user_id, order_key) | 16, 19 |
| `sidebar_section_pref` | (user_id, **surface**, section) pk, visible, show_count(null=all), sort_key, position, collapsed | — | 04, 16, 19 **통합 1개 테이블 권장** |
| `library_view_pref` | (user_id, tab) pk, visible_columns[], filters jsonb | — | 19 |
| `link_edge` | source_block_id, source_page_id, target_page_id, `link_type`(mention/link_to_page/**child**/block_anchor/external_url), unique(source_block_id,target_page_id,link_type) | (target_page_id, source_page_id), (source_block_id) | 08, 09, 17 |
| `search_query_log` | user/space, query, filters, result_count, duration_ms, **clicked_doc_id, clicked_rank**, source(`app|api|slack|mcp`) | — | 02 랭킹 튜닝의 **사실상 전제조건** |
| `connection` / `connection_grant` | capabilities jsonb, token_hash / (connection_id, block_id) | — | 18. **봇을 principal의 한 종류로 모델링**해야 권한 필터 재사용 가능 |
| `connector_account` | space_id, provider, token_enc, status, last_synced_at | — | 13. span에 FK 필수(삭제 SLA 1일) |
| `admin_search_audit` | admin_user_id, space_id, query, filters, result_count, action_taken | — | 15 |
| `nav_history` / `open_tabs` / `sidebar_ui_state` / `device_pref` | — | — | **클라이언트/디바이스 로컬로 충분** `[추정]`. 특히 `device_pref`(전역 단축키·메뉴바·open_at_login)는 PC마다 달라야 하므로 서버 저장 금지 |

### 불변식
1. 권한은 **쿼리 필터 절**이지 후처리가 아니다. 후처리면 `LIMIT 25`가 3건을 반환해 페이지네이션이 깨진다.
2. URL 해석은 **id만으로 성립**. slug는 표시용 장식(제목 변경이 링크를 깨면 안 됨). 라우터는 하이픈 유무(32hex ↔ UUID) 양쪽 정규화 필수.
3. 표시 텍스트를 복사 저장하지 말 것 — mention 노드(`target_id`만), recent/favorite 목록 제목, 전부 조인해서 현재 값을 읽는다.
4. `link_type='child'`를 `link_edge`에 함께 담으면 **트리 불변식이 깨진다** → 삽입 시 조상 검사로 순환 거부 + 조상 경로 계산에 깊이 상한(50) & 방문 집합 무조건 적용.

---

## 3. MVP 판단

### 없으면 제품이 성립 안 함 (근거)
- **F-07-16 사이드바 트리+즐겨찾기** — 페이지 10개일 때 검색은 무용, 트리는 즉시 유용. **검색보다 먼저**
- **F-07-17 페이지 URL·breadcrumb** — URL 없으면 공유 자체가 불가, 검색 결과를 클릭해도 갈 곳이 없음
- **F-07-04 최근 방문** — 난이도 S인데 검색 인덱스 없이 단독으로 내비게이션 가치 제공. 비용 대비 효과 1위
- **F-07-01/02 검색 패널+기본 랭킹** — 사이드바만으로는 페이지 100개를 넘기는 순간 사용 불가
- **F-07-06 인덱싱(최소)** — 없으면 01/02/03/07/15/18이 전부 존재하지 않음
- **F-07-07 권한 인지 검색** — 기능 결함이 아니라 **보안 사고**, 사후 수습 불가. F-07-06과 같은 커밋
- **F-07-08 `@` 자동완성** — 페이지 간 참조라는 Notion식 정보 구조를 만드는 핵심 조작
- **F-07-10 슬래시 커맨드** — 없으면 블록 타입을 바꿀 방법 자체가 없음
- **F-07-12 뒤/앞 + URL 복사** — 브라우저 History API 위임으로 저비용

### 빼도 되는 것 · 대체안
| 기능 | 빼는 이유 | 대체안 |
|---|---|---|
| F-07-13 AI Q&A | lexical 검색이 부실한 상태에서 얹으면 둘 다 부실해짐. 커넥터까지 넣으면 이 도메인 전체보다 큼 | v1에 워크스페이스 한정 RAG(`pgvector`)만. 커넥터·웹 검색 생략 |
| F-07-15 관리자 검색 | 엔터프라이즈 판매 요건. 개인/소규모에 불필요 | "공개 공유된 페이지 목록" 화면 1개로 실무 가치 대부분 커버 |
| F-07-18 외부 API | 사용자 검색이 없는데 API를 먼저 만들 이유 없음 | v1에 REST `GET /search?q=&scope=` 하나. MCP는 REST를 감싸는 얇은 어댑터 |
| F-07-11 전역 Command Search | 파워 유저 기능, 데스크톱 셸 전제 | 검색 오버레이 결과 상단에 "Actions" 섹션 5~8개(새 페이지·링크 복사·즐겨찾기·테마·사이드바 토글) |
| F-07-03 필터 | 워크스페이스가 커진 뒤 가치 발생 | `Title only` 토글 + `Created by`(본인/전체) + `Date`(전체/1주/1개월/1년) 3개만. `In`은 "현재 페이지 하위"로 축소 → materialized path `LIKE`로 처리 |
| F-07-05 `cmd+F` | 가상 스크롤을 안 쓰면 브라우저 기본 찾기가 부분 동작 | 브라우저 기본에 위임 + "검색 모드에서 toggle 전부 펼침" |
| F-07-19 Library | F-07-16이 있으면 성립 | **`Home` 한 화면만**(Recents/Favorites/Shared/Private 4섹션 × 5건 고정). F-07-04가 있으면 추가 비용 ≈ 0, 1~2일 |
| F-07-16 드래그 앤 드롭 | v0에서 빼면 L → M | 클릭 이동만. `order_key`는 문자열로 처음부터 두되 재정렬 UI는 v1 |
| F-07-08 `[[` / `+` | `@`와 동일 엔진의 랭킹 프리셋일 뿐 | `@` 팝업을 다른 정렬로 여는 얇은 래퍼로 나중에 추가. 날짜/리마인더는 v2 |

### 권장 구축 순서 (원본 결론)
```
0주  F-07-16 v0(트리, 드래그 없음) + F-07-17(id 기반 URL·breadcrumb)
1주  F-07-04 → F-07-01 껍데기(빈 상태만)  [+ 여력 시 F-07-19 Home 축약본]
2주  F-07-06 v0(generated tsvector+GIN) → F-07-02 기본 랭킹   ※ F-07-07을 같은 커밋에
3주  F-07-10 + F-07-08 (팝업 컴포넌트 공유)
4주  F-07-12 + F-07-09 + F-07-17 블록 앵커
이후 03 → 05 → 14 → 16 드래그앤드롭
v2   19 Library → 11 → 18 → 13 → 15
```

---

## 4. 기술 난제 & 권장 접근 (L/XL 항목)

| 기능 | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|
| **F-07-06 인덱싱 (XL)** | 실시간 경로 + 전체 재색인 + **권한 fan-out**(페이지 이동 = 서브트리 전량 재색인) + 순서 보장 + 실패 복구 + 검증. Notion 실제: ES, block 단위 문서, 데이터레이크→Spark→shard partitioner→S3 스냅샷 | **v0**: 별도 인덱스 없이 `search_vector tsvector GENERATED ALWAYS AS (...) STORED` + GIN → 트랜잭션 내 자동 갱신, 파이프라인/지연/정합성 문제 전부 소멸(수십만 페이지까지 충분). **v1**: 권한은 쿼리 시 `= ANY($scopes)`. **v2**: 넘치면 OpenSearch/Typesense/Meilisearch + CDC. 서브트리 이동은 **materialized path**로 1 UPDATE | Docmost(PG 전문검색만으로 성립, 의존성 PG+Redis뿐 = **현실적 하한선 증거**), AFFiNE(indexer 별도 프로세스 분리) |
| **F-07-07 권한 (XL→L)** | 누출 지점 6개+ 독립 경로 / post-filter면 페이지네이션 붕괴 / 그룹 멤버십 1건 변경 = 분산 캐시 무효화 / 커넥터는 Notion조차 "최대 1시간" 잔존 노출 창을 공식 인정 | **방식 B**: `permission_scope_id` + `accessible_scopes` 캐시(쓰기 fan-out 0). **모든 검색 함수가 `viewer_id`를 필수 인자로 받게 타입 시그니처 강제** → 누락 시 컴파일 실패. 관리자 우회는 `viewer_id \| ADMIN_OVERRIDE(space_id)` 분기. 클릭 시점 서버 재검증(2차 방어선) | — |
| **F-07-01 검색 패널 (L)** | search-as-you-type 요청 취소·경쟁 조건, 빈 상태↔검색 상태 전환, breadcrumb 조립 | `cmdk` 류 팔레트 + 200~300ms debounce + `AbortController`. breadcrumb는 `ancestor_ids` 비정규화로 조립 비용 제거 | Outline `SearchQuery`(prefix 접기) |
| **F-07-02 랭킹 (L)** | 한국어 analyzer + 페이지 단위 dedup + 스니펫. Best Matches 공식 비공개. **확인됨**: recency가 점수에 섞임, 인기도 라벨(`Most viewed`/`Popular this week`) 존재 | `ts_rank_cd(setweight(title,'A')‖setweight(body,'B'), websearch_to_tsquery(q))` + `last_edited_at` 타이브레이커, `ts_headline` 스니펫, `group by page_id, max(score)`. 오타는 0건일 때만 `pg_trgm` fallback. **CJK 최소 쿼리 길이 1자**(라틴 2자) — 3자 제한 두면 한국어 검색이 통째로 죽음. `websearch_to_tsquery`가 따옴표/OR/`-`를 공짜 제공(`to_tsquery`·`plainto_tsquery`는 따옴표 무시) | PostgreSQL textsearch |
| **F-07-08 자동완성 (L)** | 트리거 감지 · 커서 기준 팝업 위치 · **한글 IME `compositionstart/end`**(한국어 클론에서 가장 흔히 망가지는 지점) · 붙여넣기 시 트리거 금지 | 전용 경량 엔드포인트 `GET /autocomplete?q&types&limit=20`(제목 인덱스만). `pg_trgm` GIN 또는 `text_pattern_ops`. 삽입 시 `link_edge` upsert. **F-07-10과 팝업 컴포넌트 공유** | BlockSuite **widget 추상**(슬래시 메뉴/`@`/드래그핸들이 동일 인터페이스), `linked-doc` 위젯 |
| **F-07-16 사이드바 (L/XL)** | fractional indexing / 드래그 순환 방지 / **섹션 간 드래그 = 권한 변경 트랜잭션**(shared→Private 시 타인 접근 상실, 공식 경고문) / lazy load / 트리 노드가 **이종**(block \| database view) / 동시 이동 수렴 | 트리 조회는 **한 레벨씩**(`parent_id` + scope 필터 + `ORDER BY order_key`). **이동만은 CRDT가 아니라 서버 권위 트랜잭션**(`expected_parent_id`+`expected_order_key` 낙관 검증 + 순환 검사 + 거부 시 롤백), 렌더 상태만 브로드캐스트. v0에 안 정하면 트리 전체 재설계 | — |
| **F-07-13 AI (XL)** | 임베딩 파이프라인 + 벡터 스토어 + 권한 필터 + RAG + 인용 매핑 + 비용 제어. Notion: span 청킹, 오프라인 Spark + 온라인 Kafka(sub-minute), **이중 해시로 데이터량 70%↓**, Turbopuffer 이관 비용 60%↓, 커넥터 인덱싱 최대 3h 지연 | v1은 워크스페이스 한정 `pgvector`. **하이브리드(BM25+벡터, RRF)** 가 소규모에서 더 안정 `[추정]`. **이중 해시 3분기 로직을 처음부터**(나중에 넣으면 청구서 보고 넣게 됨). 인용은 LLM에 span_id를 주고 링크로 치환, 없는 id는 폐기 | — |
| **F-07-11 전역 런처 (L, 데스크톱)** | 전역 단축키는 OS 선착순이라 **조용히 실패**. 상주 프로세스·트레이·포커스 없는 창 수명·메인 창과 분리된 인증 세션·워크스페이스 컨텍스트 부재 | Electron `globalShortcut`+`Tray`+경량 창(blur 시 hide). 토큰은 렌더러가 아닌 **OS 키체인/메인 프로세스**. 등록 실패 감지 → 설정 경고. **웹 전용이면 M** | — |
| **F-07-15 관리자 검색 (L)** | 검색은 인덱스 재사용이라 쉬우나 `Audience`(가장 관대한 권한) 산출과 회수/unpublish 안전장치가 무거움 | 감사 테이블 + 비가역 액션 확인 단계 + CSV 비동기 잡 | — |

### Postgres v0 권장 쿼리 (원본 그대로 채택 가능)
```sql
ALTER TABLE page ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
  setweight(to_tsvector('simple', coalesce(plain_text,'')), 'B')) STORED;
CREATE INDEX page_search_idx ON page USING GIN (search_vector);
CREATE INDEX page_title_trgm ON page USING GIN (lower(title) gin_trgm_ops); -- 자동완성 + 오타 fallback
-- 조회: WHERE space_id=$ AND in_trash=false AND permission_scope_id = ANY($scopes) AND search_vector @@ q
--       ORDER BY ts_rank_cd(...) DESC, last_edited_at DESC
```
`'simple'` 사전은 한국어 스테밍 불가 → **(a) `pg_bigm`, (b) 앱에서 형태소 결과 주입, (c) Meilisearch/Typesense** 중 택1. **v0에서 미루면 인덱스 전체를 다시 만들게 됨.**

---

## 5. 다른 도메인과의 접점

| 접점 도메인 | 주고받는 것 / 충돌·주의 |
|---|---|
| **블록/에디터 (F-01·F-02)** | `plain_text` flatten 파생 컬럼, inline mention 노드, decoration 레이어, 블록 타입 변환 매트릭스. ⚠ **mention을 표시 텍스트로 flatten 금지**(워크스페이스 검색이 `@mention`을 못 찾는 것이 사양). 하이라이트를 DOM `<mark>`으로 넣으면 편집 모델 오염 + undo 파손 |
| **데이터베이스/뷰 (F-05)** | F-07-14 DB 내 검색, peek 이전/다음(뷰 정렬·필터 순서 전달), 사이드바에서 DB 펼치면 **뷰 목록**. ⚠ **인덱스가 2개**: 워크스페이스 검색은 select 태그 **제외**, DB 내 검색은 **포함** → 합치면 둘 중 하나가 사양 위반. DB 뷰 filter/sort ≠ 검색 필터(F-07-03) |
| **권한/공유/teamspace** | `permission_scope_id`, `accessible_scopes` 캐시, 사이드바 섹션 파생, 플랜 게이팅. ⚠ 게이팅은 **쿼리 빌더 단계**에서(칩만 숨기면 API로 우회됨). 트리 조회 자체가 권한 필터 쿼리 |
| **동시편집/CRDT** | 트리 이동, mention 원자 inline node, 검색 앵커. ⚠ **트리 이동은 텍스트 CRDT 영역 밖** → 서버 권위 트랜잭션. 앵커는 전역 offset 아닌 `(block_id, offset)` |
| **인증/통합·봇** | F-07-18 `connection`/`connection_grant`. ⚠ **봇을 principal의 한 종류로** 모델링(봇 전용 권한 경로 = 누출 지점) |
| **AI/LLM 게이트웨이** | F-07-13 RAG, 커넥터 OAuth. 커넥터 인덱싱 지연(3h)·삭제 SLA(1일)·권한 회수 잔존(1h)을 UI 문구 + 쿼리 필터로 흡수 |
| **관리자/조직** | F-07-15 audience 산출·감사 로그. 권한 우회 경로가 일반 검색에 새지 않게 타입 분기 |
| 알림/Inbox · 캘린더 · 데스크톱 셸 · 휴지통 | 사이드바 `Inbox` 슬롯(도메인 밖) / Home `Upcoming events`(도메인 밖) / `device_pref`는 디바이스 로컬 / 전 표면 기본 `in_trash=false` |

---

## 6. 최우선 미해결 질문 (5개)

| # | 질문 | 왜 지금 답해야 하는가 |
|---|---|---|
| 1 | **한국어 형태소 분석 전략: `pg_bigm` vs 앱단 형태소 주입 vs Meilisearch/Typesense** | **이 프로젝트가 답해야 할 미결정.** v0 인덱스 설계를 되돌릴 수 없게 만드는 결정이며, 미루면 인덱스 전체를 재구축해야 함 |
| 2 | **권한 모델을 방식 A(principals 비정규화) vs 방식 B(permission_scope_id)** 중 무엇으로 고정할 것인가 | F-07-07의 난이도가 XL↔L로 갈리고, F-07-06과 같은 커밋에 들어가야 하므로 첫 스프린트 전에 확정 필요 |
| 3 | **트리 이동의 동시편집 수렴 정책**(서버 권위 트랜잭션 vs CRDT 시도) | v0에서 안 정하면 나중에 트리 전체를 재설계. 순진한 LWW는 노드 소실·순환 발생 |
| 4 | `Best Matches` 랭킹 가중치 공식 (비공개) — 자체 공식 확정 + `search_query_log.clicked_rank` 수집을 v0에 넣을 것인가 | 클릭 로그 없이는 랭킹 튜닝이 원천 불가. 나중에 붙이면 학습 데이터가 없다 |
| 5 | 가상 스크롤을 v0에 도입할 것인가 | 도입 시 F-07-05가 P1→**P0**, F-07-17 앵커 도달이 S→M으로 동시 상승(브라우저 기본 `cmd+F` 위임 불가) |

### 그 외 미해결 (요약)
- `[확인필요]` 유지(재검증 실패): Notion 검색의 **fuzzy 지원 여부**(2차 출처만 주장, 1차 근거 없음 → "원본이 한다더라"를 근거로 쓰지 말 것), **Quick Filter 칩 목록**(헬프센터 필터는 `Title only`/`Created by`/`Teamspace`/`In`/`Date` 5종뿐), 불리언 `OR`/`-` 지원, `cmd+F` 접힌 toggle 자동 펼침, 블록 앵커의 백링크 집계 여부, 자식 있는 블록의 타입 변환 규칙, Admin 검색의 본문 노출 범위, peek 마지막 레코드 순환, `Recents` `Show` 설정의 저장 위치(서버 vs 디바이스), 전역 단축키 등록 실패 통지 여부.
- ✅ 해소된 것: Best Matches에 **recency 포함**(공식 문구), 따옴표 **구문 검색 공식 지원**, **CJK 공식 지원**, Command Search = **OS 전역 런처**(액션 팔레트 아님), 페이지 URL = 끝 32자 hex(8-4-4-4-12), REST `/v1/search`는 **제목 전용**(UI 검색과 다름), MCP `notion-search`(키워드, 30 req/min, 50건) vs `notion-ai-search`(시맨틱, 180 req/min, 50건) 분리.
- ❌ 원본이 명시적으로 **정정/제거**한 것(재도입 금지): `request_status.incomplete_reason` 필드(공식 문서 미확인), 페이지 `⋯` 메뉴의 백링크 표시/숨김 토글(헬프센터에 없음), "Teamspace 필터만 플랜 게이팅"(실제로는 editor/최종편집일/다중 teamspace/title only/content status/날짜 정렬까지 Business+ 요건).

---

## 주요 출처 (원본 26개 중 핵심 / 전체 목록은 원본 문서 말미)
1차: `notion.com/help/` + `search` `keyboard-shortcuts` `create-links-and-backlinks` `navigate-with-the-sidebar` `manage-your-library` `notion-for-desktop` `admin-content-search` `enterprise-search` `notion-ai-connectors` / `notion.com/blog/` + `rebuilding-notions-lexical-search-reindexer` `two-years-of-vector-search-at-notion` / `developers.notion.com/` + `reference/post-search` `reference/search-optimizations-and-limitations` `guides/mcp/mcp-supported-tools` `docs/working-with-page-content`
2차: Outline `server/models/SearchQuery.ts` · BlockSuite `guide/block-widgets` · AFFiNE self-host indexer 문서 · PostgreSQL `textsearch-controls`
