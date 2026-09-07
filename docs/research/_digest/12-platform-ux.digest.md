# 12. 플랫폼 · UX 디테일 · 성능 — 다이제스트

> 원본: `docs/research/12-platform-ux.md` (1155줄 / 134KB, 조사 2026-09-06, GAP 2회)
> 도메인 성격: **기능이 아니라 "기능이 어디서·얼마나 빠르게·어떤 입력으로 동작하는가"의 정책·인프라 레이어**
> 원본 `### F-` 개수 = **19** / 아래 인벤토리 행 수 = **19** (일치 검증 완료)

---

## 1. 기능 인벤토리 (전수 19개)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-12-01 | 키보드 단축키 체계 (전역·편집·블록선택) | L | **P0**(최소 세트) | 블록 모델, 블록 선택 모드, undo 스택 |
| F-12-02 | Quick Find / 커맨드 팔레트 (cmd+K/P) | M~L | **P0** | 검색 인덱스, 권한(사전계산 ACL), recent_visit |
| F-12-03 | 테마 시스템 (라이트/다크/시스템 + 고대비) | S(L/D) ~ M(고대비) | P1 (고대비 P2) | user_setting, 디자인 토큰, block.format color |
| F-12-04 | 오프라인 모드 (다운로드·로컬편집·재동기화) | XL | P2 (읽기전용 캐시는 P1) | F-12-05, op 모델, CRDT/OT, pub-sub, 권한 |
| F-12-05 | 클라이언트 로컬 캐시 (SQLite / WASM+OPFS) | XL | P2 (**레코드 스토어 설계는 P0**) | 정규화 레코드 모델, `version` 필드 |
| F-12-06 | 에디터 렌더링 성능 (대용량 페이지) | L | P1 (**블록 단위 구독은 P0 설계**) | 블록 트리, F-12-05, 실시간 op 스트림 |
| F-12-07 | 초기 로딩 성능 (번들·요청 워터폴) | M | P1 | 라우팅, 인증, 캐시 계층 |
| F-12-08 | 대용량 DB 성능 전략 (한도·로딩 규칙) | L(단순) ~ XL(formula 포함) | P1 | DB/뷰/속성 모델, formula 엔진(의존 DAG), 권한 |
| F-12-09 | 이미지·파일 업로드와 스토리지 | L | **P0**(기본 업로드) | 오브젝트 스토리지, 서명 URL, 블록 모델, 권한 |
| F-12-10 | 웹 클리퍼 (확장·모바일 공유 시트) | L | P2 (**HTML→block 변환기는 P1**) | 임포트 변환기, 확장 인증, DB property 자동생성 |
| F-12-11 | 데스크톱 앱 (Electron 계열) 고유 기능 | M~L | P2 | 웹 앱 전체, 로컬 캐시, 알림, 릴리스 파이프라인 |
| F-12-12 | 모바일 앱과 데스크톱의 동작 차이 | L (별도 네이티브면 XL) | P1 (**모바일 읽기는 P0**) | 렌더러 플랫폼 분기, 반응형, F-12-04 |
| F-12-13 | 접근성 (a11y) | M(초기반영) ~ XL(사후개선) | P1 (**구조 결정은 P0**) | 에디터 구조, 테마, 단축키 |
| F-12-14 | 지역화(i18n)·시간대·날짜 형식 | M(LTR) ~ L(RTL) | P2 (**UTC+all_day 날짜 저장은 P0**) | user_setting, date property, 캘린더, 알림 |
| F-12-15 | 플랫폼 지원 매트릭스 (OS·브라우저·기능 가용성) | S | P1 (**`isAvailable()` 게이팅은 P0**) | feature_flag(F-12-17), i18n(F-12-14) |
| F-12-16 | 오류·복구 UX (단절·저장실패·로컬 리셋) | L | **P0** | op 모델, F-12-05, 권한, 네트워크 감지 |
| F-12-17 | 배포·자동 업데이트·버전 스큐 | M~L | P1 (**`unknown_fields`·큐 `schema_version`은 P0**) | 세션, feature flag, F-12-16, 빌드 파이프라인 |
| F-12-18 | 성능 계측 (RUM·회귀 방지) | M | P1 (**측정 지점 심기는 P0**) | 세션/디바이스 식별, 로깅, CI, feature flag |
| F-12-19 | 서버 측 성능 기반 (Postgres 수평 샤딩·재샤딩) | XL | P2 (**`space_id NOT NULL` 규율은 P0**) | workspace 개념, PgBouncer, F-12-18 |

---

## 2. 데이터 모델 — 이 도메인이 **요구하는 것**
(스키마 정본은 `00-canonical-data-model.md`. 여기서는 요구사항만 기술)

### 2.1 다른 도메인 엔티티에 이 도메인이 강제하는 필드
| 대상 엔티티 | 요구 필드 | 이유 (F-ID) |
|---|---|---|
| `block` / `collection` / `discussion` / `comment` 등 전 도메인 테이블 | `space_id uuid NOT NULL` (비정규화 필수) | 샤딩의 **전제 조건**. 부모 체인을 따라야 space를 알면 라우팅 전 추가 쿼리가 생긴다 (F-12-19) |
| 모든 동기화 대상 레코드 | `version bigint` **단조 증가** | 캐시 무효화·오프라인 델타 판정. timestamp는 클라이언트 시계 편차로 깨짐 (F-12-04/05) |
| `block` | `content uuid[]` (자식 순서), `parent`(상향 포인터) | chunk 부분 로드 시 순서 복원 / 권한 상속 계산 (F-12-06) |
| `block.format` | `alt_text`, `alt_decorative`, `toggle_collapsed`, `checked`, `lang`, `column_ratio`, `block_color`(토큰) | a11y 시맨틱 복원, 모바일 컬럼 붕괴, 테마 토큰 해석 (F-12-03/12/13) |
| `block` | `unknown_fields jsonb` (파서 미인식 키 보존) | 구버전 클라이언트가 신버전 콘텐츠를 조용히 삭제하는 것 방지 (F-12-15/17) |
| `block.type` | 헤딩은 **`type`으로** 저장 (스타일 아님) | 스크린리더 문서 구조. 사후 복구 불가 (F-12-13) |
| date property | `{start timestamptz, end, time_zone, is_all_day bool}` | all_day는 timestamptz 변환하면 하루 밀림 (F-12-14) |
| 파일 | `file_asset(id, space_id, storage_key, mime, bytes, w, h, checksum, deleted_at)` — **URL 문자열 저장 금지** | 서명 URL 1시간 만료(공식). 저장은 storage_key, URL은 응답 직전 생성 (F-12-09) |
| op / transaction | `origin` ('local'|'remote') 태깅 | 서버 거부 시 **내 변경만** 롤백. 없으면 원격 변경까지 되돌려 데이터 손실 (F-12-16) |
| 큐 태스크 | `queue_task(id, type, schema_version int, payload, scheduled_at)` | 리마인더는 수년 뒤 발화. 버전 없으면 해석 불가 (F-12-17) |

### 2.2 이 도메인 고유 엔티티 (신규 요구)
| 엔티티 | 핵심 컬럼 | 목적 (F-ID) |
|---|---|---|
| `record_cache` (클라이언트) | `(table, id) PK, version, value blob, fetched_at` | 캐시 우선 렌더. **노션 공식명 `RecordCache` — 존재는 1차 출처 확인, 컬럼 구성은 [추정]** (F-12-05) |
| `offline_page` (클라이언트) | `page_id PK, root_page_id, depth, last_downloaded_ts, server_version, download_state, bytes` | 오프라인 대상 트리 (F-12-04) |
| `offline_action` (클라이언트) | `(page_id, reason) PK` — reason ∈ toggled/auto_downloaded/inherited/favorited | **이유 집합 = 참조 카운팅**. bool로 두면 "즐겨찾기 해제 → 수동 다운로드까지 사라짐" 버그 구조적 발생 (F-12-04) |
| `offline_collection_window` | `collection_id PK, view_id, row_limit=50, synced_row_ids[], query_hash` | DB는 첫 뷰 첫 50행만 동기화 (F-12-04) |
| `pending_transaction` (클라이언트) | `txn_id PK, space_id, page_id, ops blob, state, attempt_count, next_attempt_at, error_code, origin` | 변경 큐 + 백오프 + 롤백 (F-12-04/16) |
| `crdt_doc` | `page_id PK, doc_state blob, state_vector, migrated_at` | 리치텍스트만 CRDT, 그 외 LWW (F-12-04) |
| `sync_status` | `space_id, state, last_acked_at, pending_count` | 배너/인디케이터 단일 소스 (F-12-16) |
| `user_setting` / `device_setting` | `key, value, scope('account'|'device')` | 다크모드=계정 전역, 고대비/오프라인 목록=디바이스별 (F-12-03/11/14) |
| `a11y_preference` | `contrast, reduce_motion, font_scale, scope` | (F-12-13) |
| `recent_visit` / `search_index` | `(user_id,page_id,visited_at,space_id)` / `(page_id,space_id,title,plain_text)` | 빈 입력 시 Recents 우선 (F-12-02) |
| `page_acl_effective` | `(page_id, principal_id)` 반정규화 + 서브트리 재계산 잡 | 검색 권한 필터를 **쿼리 조건에** 넣기 위해 필수. 후필터링은 카운트로 정보 누출 (F-12-02) |
| `sidebar_state` | `user_id, space_id, expanded_page_ids[], scroll_top` | bootstrap 시 "펼쳐진 노드까지만" 반환 (F-12-07) |
| `platform_support` / `feature_availability` | `policy_kind('min_version'|'last_n_releases'), action('block'|'warn'|'allow')` / `(feature_key, platform, state)` | 지원 정책이 **상대 윈도우**라 하드코딩 불가 (F-12-15) |
| `release` / `feature_flag` / `client_session` | `min_supported_client, bundle_hash` / `min_client_version, rollout_pct` | 버전 스큐 자가 진단 (F-12-17) |
| `perf_event` / `perf_span` / `perf_budget` / `benchmark_run` | `metric_key, value_ms, completed, sample_rate, platform, region, cold_start, cache_hit` | **`sample_rate`+`completed` 동시 기록 필수** — 없으면 사후 재계산 불가 (F-12-18) |
| `shard_map` / `logical_shard_placement` / `audit_log` / `dark_read_diff` | 글로벌(비샤딩) DB 배치 | 재샤딩 라우팅·검증 (F-12-19) |
| `usage_limit` | `space_id, key, limit_value, window_sec` | 한도를 사후 오류가 아닌 **사전 경고**로 (F-12-16) |

### 2.3 API 계약 요구 (스키마 선결 조건)
- `GET /bootstrap` → `{user, spaces, sidebar_tree, initial_page_record_map, feature_flags, server_time}` — 1회 요청. 노션은 콘텐츠 렌더 전 **순차 API 9건**이 있었다(2019 분석) (F-12-07)
- `GET /loadPageChunk {pageId, cursor, limit}` → `{recordMap, cursor}` — 페이지가 아니라 **chunk 단위 로드**. 공식 1차 출처 확인 (F-12-06)
- `recordMap`은 `{id: {value, role}}` 정규화 형태 — **레코드마다 `role`(권한 등급) 동봉**. 안 하면 "로드 → 권한 조회 → 재렌더" 왕복 발생 (F-12-07) `[추정 — react-notion-x 파싱 형태 기준]`
- `error_response {code, message_key, retryable bool, retry_after_sec, offending_ids[]}` — `retryable=false`에 재시도하면 무한 루프. 선택 아님 (F-12-16)
- 응답 헤더 `X-Server-Release` / `X-Min-Client` (F-12-17)

### 2.4 공식 정량 한도 (구현 시 그대로 참조 가능)
| 축 | 값 | 출처 등급 |
|---|---|---|
| DB 행 / property / 페이지 property 총량 / relation 참조 | 250,000 / 500 / 2.5MB / 10,000 | 공식 헬프 |
| 파일 **저장** | Free 5 MiB, 유료 5 GiB, multi-part 임계 20 MiB, 파일명 900 bytes | developers.notion.com |
| 파일 **인라인 렌더** | 이미지 5MB / PDF 20MB | 공식 헬프 |
| **임포트** | Free 5MB / 유료 50MB | 오류 메시지 문서 |
| **요청 본문** | 500KB 초과 시 HTTP 413 (붙여넣기) | 오류 메시지 문서 |
| 대량 복제 | 50,000 blocks/hour | 오류 메시지 문서 |
| 서명 URL 만료 | **정확히 1시간**, `expiry_time` 동봉, 갱신=페이지 재fetch | developers.notion.com (공식 확인) |
| 최소 OS | macOS 12 / Win10 21H2 / iOS 17.0 / Android 8 | 공식 시스템 요구사항 |
| 브라우저 | Chrome 최근 8개 Extended stable, 기타 최근 2개 major, IE 미지원 | 동일 |
> **핵심 해석**: 파일 한도는 상충이 아니라 **4개 독립 축**(저장/렌더/임포트/전송본문). 5GiB는 "저장 가능", 5MB/20MB는 "블록으로 렌더 가능".

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 하는 것
| F-ID | 근거 |
|---|---|
| F-12-01 (최소 세트) | 단축키 없는 블록 에디터는 마우스 전용 도구. 최소 세트 = markdown input rules, enter/shift+enter, tab/shift+tab, backspace 병합, esc 블록선택, cmd+B/I/U/K/E, cmd+D, undo/redo, `/` 메뉴 |
| F-12-02 | 사이드바만으로는 페이지 수십 개를 넘는 순간 네비게이션 불가 |
| F-12-09 (기본 업로드) | 노트 앱에서 이미지 없음 = 기능 결손으로 인식 |
| F-12-16 | **"저장 실패를 사용자가 모르는 상태"는 데이터 손실과 동치.** 오류 배너 + 재시도 큐 + 거부 트랜잭션 롤백은 MVP 필수 (GAP 2차에서 신규 P0 판정) |

### 3.2 "기능은 빼도 되지만 **스키마/구조 결정은 P0**"인 것 — 이 도메인의 핵심 산출물
| 결정 | 잘못 잡았을 때 비용 |
|---|---|
| 단일 vs 블록별 `contenteditable` | a11y·복붙·가상화 전략 전부 변경 → 에디터 전면 재작성 |
| 상태 구독 단위(페이지 vs **블록**) | 대용량 페이지 입력 지연. 스토어 전면 교체 |
| 레코드 `version` 단조 증가 필드 | 캐시 무효화·오프라인 동기화 자체가 불가 |
| 날짜 UTC + `all_day` 플래그 | 전 사용자 날짜 데이터 마이그레이션 |
| 파일을 asset 엔티티로 분리 (URL 문자열 금지) | 페이지 복제·GC·권한 통제 불가 + 1시간 뒤 전 링크 사망 |
| CSS 논리 속성 사용 | RTL 지원 시 전 컴포넌트 수정 (지원 22개 언어에 Hebrew/Arabic 포함) |
| 전 테이블 `space_id NOT NULL` + 전 쿼리 `WHERE space_id=?` 강제 | 수평 샤딩 자체가 불가능. 모든 쿼리가 2단계화 |
| op `origin` 태깅 | 서버 거부 시 원격 변경까지 롤백 → 데이터 손실 |
| 파서의 `unknown_fields` 보존 | 구버전 클라이언트가 신버전 콘텐츠를 조용히 삭제 |
| 큐 payload `schema_version` | 수년 뒤 발화 태스크 해석 불가 |
| `sample_rate`+`completed` 동시 기록 | 성능 수치가 실사용 대표 못 함 (생존자 편향), 사후 재계산 불가 |
| 권한 사전계산(materialize) 자리 확보 | 검색/목록 쿼리가 재귀 권한 조회 → 전면 스캔 |
| 헤딩을 `type`으로 저장 | 스크린리더 문서 구조 생성 불가, 복구 불가 |

### 3.3 빼도 되는 것 + 대체안
| 뺄 것 | 대체안 |
|---|---|
| F-12-04 오프라인 편집 (XL) | 네트워크 끊김 시 **읽기 전용 캐시**(마지막으로 본 페이지) + 편집 차단 배너. v1에서 Yjs + y-indexeddb |
| F-12-05 WASM SQLite/OPFS (XL) | TanStack Query SWR + 메모리 정규화 스토어 → v1 IndexedDB(Dexie) → v2 OPFS |
| F-12-10 웹 클리퍼 확장 (L) | 인앱 "URL 붙여넣기 → 서버 Readability 본문 추출 → 페이지 생성" (Readability + turndown) |
| F-12-11 데스크톱 앱 (M~L) | 반응형 웹 + PWA. 전역 단축키/트레이 필요 시 **Electron 대신 Tauri** |
| F-12-12 네이티브 모바일 앱 | 반응형 웹 + PWA. 컬럼 붕괴는 CSS `flex-direction: column` 한 줄. **노션조차 에디터 본문은 WebView로 남겼다** |
| F-12-14 다국어 (M~L) | ko/en 2개만. RTL은 CSS 논리 속성만 미리 써두고 v2 |
| F-12-15 지원 매트릭스 테이블 | JSON 상수 파일 1개 + `isAvailable(featureKey)` 함수. 원격 갱신 필요 시 테이블로 승격 |
| F-12-19 샤딩 (XL) | 단일 Postgres. 단 `space_id NOT NULL` + 글로벌 스코프/RLS 강제로 옵션만 열어둠 |
| F-12-08 formula 정렬/필터 | formula 속성을 **정렬·필터 대상에서 UI 비활성화**. 커서 페이지네이션 50~100행 + 단순 속성 필터만 |
| F-12-03 고대비 모드 | 라이트/다크만. 고대비는 토큰 세트 파일 1개 추가로 v2 |

---

## 4. 기술 난제 & 권장 구현 접근 (L / XL 항목)

| F-ID | 난이도 | 왜 어려운가 | 권장 접근 | 참고 OSS |
|---|---|---|---|---|
| F-12-01 | L | 모드(편집/블록선택) × 컨텍스트(table/code/modal) × OS × **IME** 4중 분기. 브라우저 예약키(cmd+N/T/W) 우회 불가. `cmd+D`가 표에서는 fill-down, 블록선택에서는 복제 | 키맵을 **선언적 테이블 1개**로 정의 → ProseMirror `keymap` + `inputRules`에 위임. OS 분기는 `metaKey||ctrlKey` 정규화 1곳. IME는 `compositionstart~end` 사이 핸들러 무력화 | Tiptap, BlockNote |
| F-12-02 | M~L | 검색 UI는 반나절. 실비용은 **권한**: 상속 + 중간 오버라이드 + 개인/그룹/게스트/teamspace 중첩을 **단일 SQL로** 표현해야 함. 순진하게 짜면 행마다 재귀 부모 조회 → 전체 스캔 | `page_acl_effective(page_id, principal_id)` 반정규화 + 권한 변경 시 서브트리 재계산 잡. 검색 인덱스 자체는 tsvector(MVP) → Meilisearch(v1). 한국어는 형태소 대신 n-gram | Outline(권한 필터링) |
| F-12-04 | XL | 로컬 스토어 + 변경 큐 + 충돌 해결 + 이유 기반 GC + 부분 동기화(50행)가 **각각 독립 서브시스템**. 노션도 2.53(2025-08)까지 걸림. 텍스트만 CRDT 병합, 비텍스트는 LWW | **Yjs + y-indexeddb**로 문서 단위 오프라인. 자체 OT 구현 회피. `offline_action` 이유 집합 = 참조 카운팅. `inherited` 트리 전파는 v2 (방문 집합 + 깊이 상한 32 필수) | **BlockSuite/AFFiNE** (Yjs 위에 블록 모델 직접), AppFlowy(local-first) |
| F-12-05 | XL | OPFS VFS 선택(cross-origin isolation 회피 위해 **SyncAccessHandle Pool VFS**) + 다중 탭 단일 writer(SharedWorker 활성탭 선출 + Web Locks로 크래시 감지) + WASM 비동기 로드. IndexedDB는 쿼터·버그·Windows 성능으로 탈락 | 3단계: 메모리 정규화 스토어 → IndexedDB → OPFS. **다중 탭은 처음부터 SharedWorker 단일 writer로 설계**. 시크릿 모드에서 OPFS throw → 캐시 없는 폴백 경로 필수. 스키마 마이그레이션 실패 시 **drop & rebuild**가 정답(서버가 원본) | sqlite-wasm, wa-sqlite |
| F-12-06 | L | 아키텍처 결정이라 사후 변경 불가. 가상 스크롤 × `contenteditable` 충돌(네이티브 cmd+F, 전체선택, 셀렉션 앵커 소실). 원격 op 폭주 시 리렌더 폭주 | ProseMirror 단일 contenteditable이면 MVP는 **가상화 불필요**. 블록별 에디터 채택 시 blockId selector 구독 + React.memo. 가상화는 **읽기 전용 뷰에만**. op 배치 + rAF 병합 | Tiptap 성능 가이드("에디터를 별도 컴포넌트로 격리") |
| F-12-08 | L~XL | formula 엔진은 성능 문제가 아니라 **의존성 그래프 문제**: ① formula→formula, rollup→relation의 **DAG 위상 정렬**, ② 역방향 의존성으로 무효화 대상 탐색, ③ 순환 참조 탐지·거부, ④ 정렬/필터 인덱스화하려면 materialize → 즉시 정합성 문제로 승격. **노션이 "formula에 필터·정렬 걸지 말라"고 사용자에게 권고하는 것 자체가 미해결의 증거** | 뷰 쿼리를 SQL로 컴파일. formula 속성은 정렬/필터 대상에서 제외(UI 비활성). 필요 시 generated column 또는 트리거 캐시 테이블(`formula_cache(page_id, property_id, value, deps_version)`)로 승격 | — |
| F-12-09 | L | 6개 독립 서브시스템: 5GiB 멀티파트+중단재개 / 서명 URL 발급·만료·재발급 / ref_count GC / HEIC·TIFF 서버 변환+썸네일 / SVG sanitize(XSS) / 복제 시 복사 vs 참조 정책 | S3 호환(MinIO/R2) + **presigned PUT 직업로드**. 미리보기 `<img>`/`<video>` 네이티브, PDF는 pdf.js. 썸네일 비동기. **URL은 절대 DB에 저장 금지** | — |
| F-12-10 | L | 확장 자체는 M. 실난이도는 **HTML→block 변환 품질**(사이트마다 다름 — 노션도 공식 인정) + 확장 세션 공유 + MV3/Safari Web Extension 이중 매니페스트 | 변환기를 붙여넣기(paste) 처리와 **공유**. Mozilla Readability + turndown. 확장은 v2 MV3 단일 코드베이스 | — |
| F-12-11 | M~L | 코드 난이도가 아니라 **릴리스 파이프라인 비용**: Apple Developer ID 서명 + notarization + Windows 인증서 + Arm/x64 이중 빌드 + MSIX + 업데이트 서버. 첫 배포에 한꺼번에 몰림 | **Tauri**(번들·메모리 유리, Rust에서 SQLite 직접). PWA로 시작 → 전역 단축키·트레이 필요 시 이행 | electron-updater |
| F-12-12 | L | 터치 드래그 × 스크롤 제스처 충돌, 소프트 키보드 caret 보정(`visualViewport`), 백그라운드 프로세스 종료 → 즉시 로컬 영속화. 컬럼 붕괴는 **표현만 바꾸고 데이터 유지**해야 함 | 반응형 웹 + PWA. 컬럼 붕괴 CSS 1줄. 터치 드래그는 `dnd-kit` pointer sensor + activation constraint(250ms 지연) | dnd-kit |
| F-12-13 | M(초기) / XL(사후) | 노션 자신이 못 푼 영역(공개 VPAT 없음) → **모방 대상이 아니라 개선 대상**. 블록별 contenteditable은 스크린리더가 문서를 하나의 흐름으로 못 읽음. DnD는 키보드 대체 경로 WCAG 2.1.1 필수. 실시간 원격 커서는 `aria-live="off"`여야 함 | ProseMirror 단일 contenteditable + **Radix UI / React Aria** 헤드리스 컴포넌트 + axe-core CI. 슬래시 메뉴는 `role=listbox` + `aria-activedescendant` | Radix UI, React Aria |
| F-12-14 | M~L | RTL(Hebrew/Arabic 공식 지원)이면 사이드바·드래그핸들·들여쓰기·아이콘 전부 미러링. all_day 날짜는 시간대 변환 금지. 독일어 30% 길이 팽창. 로케일 번들 수백 KB | `next-intl`/`react-i18next` + 로케일 **동적 임포트**. 날짜 `Temporal`/`date-fns-tz`. CSS 논리 속성(`margin-inline-start`)만 미리 강제 | — |
| F-12-16 | L | 배너 UI는 S. 실비용은 **op 모델 자체를 건드림**: 거부 트랜잭션 롤백 + origin 태깅 + 지수 백오프(1→2→4s, 상한 60s + jitter) + 500KB 청킹 + 사유별 분기. 사후 도입 시 op 파이프라인 재작성. **권한 오류가 저장 오류로 나타남**(`Unsaved transactions`의 원인이 권한) | 재시도/백오프는 TanStack Query `retry`에 위임, 오프라인 큐만 자체. **Yjs 채택 시 `transaction.origin`이 기본 제공 → L→M 하락**. 오류 코드는 처음부터 enum + i18n 키 분리. `navigator.onLine`은 LAN만 보므로 heartbeat 병행 | Yjs |
| F-12-17 | M~L | 스큐 3축(셸 vs 웹뷰 번들 / 구클라→신서버 / 구enqueue→신worker). 노션은 **API 1,300개 + 큐 태스크 296종**에 CI 스키마 호환성 검사(TS assignability: `OldRequest`가 `NewRequest`에 assignable). 오래 열린 탭의 lazy chunk 404 | MVP: 빌드 해시 응답 헤더 → 새로고침 배너 / **CDN 청크 최소 7일 유지** / zod 스키마 공유 + `.passthrough()`. CI 검사는 zod 스냅샷 diff로 대체. chunk 로드 실패 리로드는 `sessionStorage`로 1회 제한 | zod |
| F-12-19 | XL | 라우팅만 M. 전체 절차(이중쓰기 → 백필 → dark read 검증 → 전환 → 롤백 계획)가 XL. 노션은 **두 번** 함(32대→480 논리샤드 2021, 32→96대 2023). 재샤딩 트리거는 디스크 용량이 아니라 **CPU 90%·IOPS·PgBouncer 커넥션** | 논리 샤드 수를 **고약수(480/240)**로 고정하고 물리 DB 매핑 테이블로 간접화(해시 직접은 특정 workspace 이동 불가). 이중쓰기는 **순서 보장 audit log**로(앱에서 두 번 쓰면 순서 깨짐). logical replication + **인덱스 후생성**(3일→12시간). 검증은 **dark read** — 노션 절차 중 이식 가치 최고 | Citus |

**권장 스택 결론 (원본)**: MVP = Next.js + Tiptap/BlockNote(단일 contenteditable) + PostgreSQL + S3호환 + TanStack Query + 반응형 웹 / v1 = Yjs + Meilisearch + `page_acl_effective` / v2 = PWA·Tauri + 고대비 + RTL + 클리퍼 + 읽기 복제본
**핵심 조언**: 에디터를 처음부터 만들지 말 것 — BlockNote 또는 Tiptap + 커스텀 블록으로 F-12-01/06 대부분 확보. `react-notion-x`는 노션 실제 블록 JSON 스키마 대조용 레퍼런스.

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 이 도메인이 요구하는 것 |
|---|---|---|
| **블록/에디터** | F-12-01/06/13 | `type`으로서의 헤딩, `content[]` 순서 배열, 블록 단위 구독, `unknown_fields` 보존, 단일 vs 블록별 contenteditable 결정 |
| **데이터베이스/뷰/formula** | F-12-08 | 250K행·500속성 한도, 뷰 쿼리의 SQL 컴파일, formula 의존 DAG + `formula_cache` materialize, 커서 페이지네이션 |
| **권한/공유** | F-12-02/16/19 | `page_acl_effective` 사전계산 테이블 + 서브트리 재계산 잡. 검색 권한은 **쿼리 조건**에(후필터링 = 정보 누출). 권한 오류가 저장 실패로 표면화 |
| **실시간 협업/동기화** | F-12-04/06/16 | op 모델에 `origin` 태깅, 페이지 단위 pub/sub 채널(`page_channel`, `subscription`), CRDT 적용 범위(텍스트만), 거부 롤백 경로 |
| **API/인테그레이션** | F-12-09/17 | 파일 업로드 계약(멀티파트 20MiB 임계, 서명 URL 1h), `error_response.retryable`, `X-Server-Release` 헤더. 원본이 `09-api-integrations.md` F-09-08 참조 지시 |
| **임포트/익스포트** | F-12-09/10 | HTML→block 변환기를 클리퍼·붙여넣기·임포트가 **공유**. 임포트 한도 5MB/50MB. 워크스페이스 이전 시 파일 재호스팅 |
| **알림/리마인더** | F-12-11/14/17 | 발송 시각 기준 시간대(생성자 vs 수신자) `[확인필요]`, push_token 정리(지원종료 기기), 큐 `schema_version` |
| **워크스페이스/조직** | F-12-19 | `space_id NOT NULL` 전면 강제, 워크스페이스 경계 넘는 쿼리 금지 규율, 글로벌 DB(notion_user, space_membership) 분리 |
| **캘린더/날짜 property** | F-12-14 | `{start, end, time_zone, is_all_day}` 저장 형식, 주 시작 요일 설정 |

---

## 6. 최우선 미해결 질문 (5개)

| # | 질문 | 왜 중요한가 | 현 상태 |
|---|---|---|---|
| 1 | 노션 CRDT의 종류(자체 vs Yjs 계열)와 적용 단위(블록 vs 문서)? | 오프라인·협업 아키텍처 전체가 여기서 갈린다. Yjs 채택 시 F-12-04가 XL→L, F-12-16이 L→M | `[확인필요]` — 블로그에 "CRDT 데이터 모델로 동적 마이그레이션"만 언급 |
| 2 | 오프라인 중 서버에서 삭제된 페이지를 로컬 편집한 경우의 병합 정책? | **손실 비용이 비대칭**(삭제는 휴지통에서 복원 가능, 오프라인 작성분은 복구 불가). 원본 권장안 = "조용히 폐기 말고 복원 후 고지" | `[확인필요]` — 공개 문서 없음 |
| 3 | 노션이 실제로 뷰포트 가상화를 쓰는가, chunk 로딩 + 토글 지연 렌더만인가? | 가상화 채택 여부가 `contenteditable` 셀렉션·cmd+F·복붙 전략을 결정. 되돌리기 어려운 아키텍처 선택 | `[확인필요]` / 현 서술은 `[추정]` |
| 4 | 블록 단위 subscriber store 서술의 1차 출처? | F-12-06의 P0 설계 결정("구독 단위 = 블록")의 근거가 3자 분석 글(techaheadcorp)뿐. 다만 구조적 필요성 자체는 독립 성립 | `[확인필요]` — 노션 공식 문서 미확인 |
| 5 | DB property 총량 한도가 "페이지 2.5MB"인지 "DB 1.5MB"인지 문구 해석 / response 스키마 호환성 방향 규칙? | 전자는 저장 제한 구현값, 후자는 배포 스큐 CI 규칙의 나머지 절반(노션 글은 request 축만 명시) | 둘 다 `[확인필요]` |

> 원본의 미해결 표 17개 중 **해소된 것 2건**: #2 파일 업로드 한도(4개 축 분리로 해소), #6 서명 URL 만료(1시간, 공식 확인). #7 VPAT는 "없다"가 아니라 **"공개되지 않았다"**(trust.notion.com은 승인 게이트).

---

## 출처 (원본 34개 중 판단에 직결되는 것)
- 공식 헬프: [keyboard-shortcuts](https://www.notion.com/help/keyboard-shortcuts) · [account-settings](https://www.notion.com/help/account-settings) · [use-pages-offline](https://www.notion.com/help/use-pages-offline) · [optimize-database-load-times](https://www.notion.com/help/optimize-database-load-times-and-performance) · [system-requirements](https://www.notion.com/help/system-requirements-for-notion) · [notion-error-messages](https://www.notion.com/help/notion-error-messages) · [images-files-and-media](https://www.notion.com/help/images-files-and-media) · [notion-for-mobile](https://www.notion.com/help/notion-for-mobile) · [reset-notion](https://www.notion.com/help/reset-notion)
- 공식 엔지니어링 블로그: [data-model-behind-notion](https://www.notion.com/blog/data-model-behind-notion) (loadPageChunk·RecordCache·React — 1차) · [how-we-made-notion-available-offline](https://www.notion.com/blog/how-we-made-notion-available-offline) · [wasm-sqlite](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite) · [faster-page-load-navigation](https://www.notion.com/blog/faster-page-load-navigation) · [sharding-postgres-at-notion](https://www.notion.com/blog/sharding-postgres-at-notion) · [the-great-re-shard](https://www.notion.com/blog/the-great-re-shard) · [how-notion-catches-breaking-schema-changes](https://www.notion.com/blog/how-notion-catches-breaking-schema-changes) · [notion-on-android-2x-faster](https://www.notion.com/blog/notion-on-android-is-now-more-than-twice-as-fast-to-launch)
- 공식 API: [working-with-files-and-media](https://developers.notion.com/docs/working-with-files-and-media) · [retrieving-files](https://developers.notion.com/docs/retrieving-files)
- 2차(주의): [3perf.com/blog/notion](https://3perf.com/blog/notion/) (2019 수치, 현재 유효성 `[확인필요]`) · [techaheadcorp](https://www.techaheadcorp.com/blog/tech-stack-powering-notion-block-based-editor/) (subscriber store — 1차 아님) · [Pratt a11y 평가](https://ixd.prattsi.org/2024/12/assessing-the-accessibility-of-notion/)
- OSS: [BlockSuite](https://github.com/toeverything/blocksuite) · [react-notion-x](https://github.com/NotionX/react-notion-x) · [Tiptap 성능 가이드](https://tiptap.dev/docs/guides/performance)
