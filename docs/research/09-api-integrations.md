# 09. 공개 API · 임베드 · 임포트/익스포트

> 도메인 조사 문서 (리버스 스펙). 대상: Notion 공개 REST API, 임베드/언퍼링, 임포트/익스포트.
> 태그 규약: `[추정]` = 공개 문서로 확인 불가하여 추론한 내용 / `[확인필요]` = 2차 출처에만 근거해 1차 검증이 필요한 내용.
> 조사 기준일: 2026-09-06. API 버전 헤더 기준값: `Notion-Version: 2026-03-11` (developers.notion.com/reference/intro 코드 예제 상단 표기로 재확인), 파괴적 변경 분기점: `2025-09-03`.
> 공식 JS SDK의 기본 `notionVersion`은 아직 `2025-09-03`이며 `2026-03-11`도 지원한다(SDK README 확인).
> 주의: 버전 라인이 **둘**이다. 본 API = `2026-03-11`, **Admin API = `2026-06-01`(base URL도 `https://api.notion.com/admin/v1/`로 다름)**. 클론은 처음부터 두 버전 라인을 분리해두는 편이 유리하다(F-09-20).

### 점검(GAP) 이력

#### 3차 점검 — 2026-09-06 (2차 점검이 세션 중단으로 미완료된 것을 마무리)

| 구분 | 내용 |
|---|---|
| **미완료 마무리** | 2차 점검은 "F-09-16~21을 추가했다"고 이력에만 적어 놓고 **본문 섹션을 실제로 쓰지 못한 채 중단**되어 있었다. F-09-01·F-09-04·F-09-15가 존재하지 않는 F-09-16/17/18/19를 참조하는 **깨진 상호참조 상태**였다. 이번에 6개를 전부 작성하고, 초판 이후 갱신되지 않은 요약표·의존 그래프·미해결표·출처 목록을 본문과 동기화했다. |
| **추가된 기능(6+2)** | F-09-16 Data source query(타입별 연산자 표·compound `maxItems:100`·10,000행 상한·`created_time` 윈도잉) / F-09-17 Page property value 22종 + property item 엔드포인트 / F-09-18 oEmbed 프로토콜 계약(4 응답 타입·디스커버리·401/404/501) / F-09-19 Notion MCP 서버(도구 전량·180 req/min) / F-09-20 Admin API(별도 base URL·별도 버전·스코프 8×4) / F-09-21 아웃바운드 automation webhook·iPaaS. **여기에 조사 중 새로 발견한 2개를 더 추가**: **F-09-22 Markdown API**(`GET/PATCH /v1/pages/:id/markdown` — 2026-03-11 신설, 이 도메인의 판을 바꾸는 표면) / **F-09-23 Notion Workers·CLI**(노션이 호스팅하는 통합 런타임). |
| **사실 정정** | ① **PAT는 정적 토큰이 아니다** — 만료를 7/30/90/180일 또는 1년 중에서 고르며 기본 1년, 워크스페이스 1개에 한정, 폐기 시 즉시 무효. 초판/2차의 `정적 [확인필요]` 표기는 틀렸다. ② **"공개 API로는 export 엔드포인트가 제공되지 않는다"는 틀렸다** — `GET /v1/pages/{id}/markdown`(공식 레퍼런스에 플랜 제한 명시 없음, read content capability만 요구)과 Admin API의 `POST /v1/spaces/{id}/exports`(Enterprise)가 존재한다. ③ **웹훅 이벤트 "전량 23종 확인"은 과잉 단정** — 문서 인덱스에 `file_upload.*` 4종과 `view.*` 3종의 개별 레퍼런스 페이지가 있으나 "Event types & delivery" 목록에는 없다(문서 불일치, `[확인필요]`로 남김). ④ **search가 "제목만 검색"이라는 서술은 현행 공식 문서에 명시가 없다** → `[확인필요]`로 낮추고, 대신 공식이 실제로 명시하는 "전수 반환 미보장 / 인덱싱 지연 / 직접 공유분만 보장"으로 교체. 인덱싱 지연은 `[추정]`에서 **확정**으로 승격. ⑤ **2026-03-11의 파괴적 변경 3건**(`archived`→`in_trash`, `after`→`position`, `transcription`→`meeting_notes`)을 F-09-01에 반영. ⑥ **버전 라인이 둘**이다(본 API `2026-03-11` / Admin API `2026-06-01`). |
| **난이도/우선순위 정정** | 요약표가 본문의 재평가(F-09-01 L→L/XL, F-09-02 L→L/XL, F-09-06 M→M/L)를 반영하지 못한 채 옛 값을 들고 있었다 → 동기화. 신규 항목 중 과소평가하기 쉬운 것을 특히 높게 잡았다: **F-09-16 L/XL**(필터 트리→SQL 컴파일 + formula/rollup 머티리얼라이즈), **F-09-17 L/XL**(계산 프로퍼티의 무효화·순환 검출), **F-09-18 M/L**(SSRF·샌드박스 포함 시), **F-09-23 XL**(멀티테넌트 코드 샌드박스는 그 자체로 별개 제품). **F-09-22는 P1** — export·import·에이전트 연동 세 기능의 공통 기반이라 투자 대비 효과가 가장 크다. |
| **의존 순서 재구성** | 초판의 `rich text → export → import`를 **`rich text → Markdown 계약(F-09-22) → (export / import / MCP)` 3갈래**로 교체. |

#### 2차 점검 — 2026-09-06

| 구분 | 내용 |
|---|---|
| **추가 예정으로 기록만 됨(본문 미작성 → 3차에서 작성)** | F-09-16 Data source query(필터/정렬 DSL·10,000행 상한) / F-09-17 Page property value 스키마·property item 엔드포인트 / F-09-18 oEmbed 언퍼 프로토콜 계약 / F-09-19 Notion MCP 서버 / F-09-20 Admin API(Enterprise) / F-09-21 아웃바운드 automation webhook·iPaaS 커넥터 — 초판이 **"블록 읽고 쓰기"에 치우쳐 데이터베이스 행 읽기·쓰기의 실제 계약(필터 DSL, 프로퍼티 값 24종)** 과 **2026년 AI/관리자 표면(MCP·Admin API)** 을 통째로 누락하고 있었다. |
| **사실 확정(태그 해제)** | ① children 중첩 깊이 상한 = **2단**(공식 명시, 기존 `[확인필요]`) ② 웹훅 이벤트 타입 **전량 확인**(23종) + 재시도 **최대 8회·지수 백오프·약 24시간** + **at-most-once** 전달 + 집계 지연 **1분 미만** ③ 임포트 크기/건수 제한 **공식 표 확인**(무료 5MB/유료 50MB, PDF 20MB, ZIP 5GB, HTML·MD·TXT **12시간당 약 120건**) ④ Evernote 약 5,000노트 / Trello 보드당 약 5,000카드·세션당 10보드 **공식 확인** ⑤ 공식 JS SDK 헬퍼 이름·시그니처 **확인** ⑥ Notion 호스팅 파일 URL 유효기간 = **1시간**, "캐시 금지" 공식 명시 ⑦ `file_upload.id`는 **여러 페이지/블록에 재사용 가능**(기존 `[확인필요]`) |
| **사실 정정** | ① **PAT(personal access token)** 이라는 제3의 토큰 타입 누락 → F-09-02에 추가. 토큰 타입별 **작성자 귀속(attribution)** 이 다르다(internal=bot / public=인가한 사용자 / PAT=발급자) ② 파일 크기 상한을 "무료 5MB급, 유료 훨씬 큼"으로 뭉갰던 것 → **무료 5 MiB / 유료 5 GiB, 20 MiB 초과는 multi-part 강제**로 정정. "multi-part는 유료 전용"은 공식 근거 없음 → 결과적으로 유료 전용이 되는 **파생 사실**로 재서술 ③ `PATCH /blocks/{id}/children`의 `after` 파라미터는 **deprecated**, `position`으로 대체 ④ Comments API가 **첨부(최대 3개)와 display_name(integration/user/custom)** 을 지원한다는 사실 누락 ⑤ Admin API 예약 export 주장은 무근거가 아니라 **공식 확인(Enterprise·beta·admin bot 토큰 필요)** → 출처 부착 ⑥ data source query에 **10,000행 페이지네이션 상한**이 존재(초판의 "커서로 계속 돌면 된다"는 서술이 틀림) |
| **난이도/우선순위 조정** | F-09-01 L → **L/XL**(프로퍼티 값 24종 + 필터 DSL 포함 시), F-09-02 L → **L/XL**(토큰 3종 + 귀속 + 상속 grant + 해지 전파), F-09-06 M → **M/L**(ACL pre-filter·증분 인덱싱 포함 시), F-09-09 L 유지하되 **at-most-once + out-of-order**로 수신측 부담이 커진다는 근거 추가 |

## 요약

이 도메인은 "노션 안의 데이터를 밖으로 꺼내고, 밖의 데이터를 노션 안으로 들이는" 경계면 전체를 담당한다.
공개 REST API는 `page` / `block` / `data_source` / `database` / `user` / `comment` / `file_upload` / `view` / `custom_emoji` 리소스를 커서 페이지네이션 · 버전 헤더 · capability 기반 권한으로 노출하고, 2026-03-11부터는 **페이지 본문을 Markdown 문자열 하나로 읽고 쓰는 경로**(F-09-22)가 추가되어 블록 트리 순회를 우회할 수 있다.
경계면은 이제 REST 하나가 아니라 **다섯 개의 표면**이다: ① REST API ② MCP 도구 표면(F-09-19, 에이전트용) ③ Admin API(F-09-20, 별도 base URL·별도 버전 라인) ④ 노코드 automation webhook(F-09-21) ⑤ 노션이 호스팅하는 코드 런타임 Workers/CLI(F-09-23). 클론이 어디까지 따라갈지는 **표면 단위로 결정**해야 하며, 전부 따라가는 것은 거의 언제나 오답이다.
권한 모델은 OAuth scope가 아니라 **"integration capability(무엇을 할 수 있는가) × 페이지 공유(어디에 할 수 있는가)"의 교집합**이며, 클론 설계 시 가장 먼저 확정해야 하는 부분이다.
임베드는 자체 프리뷰 엔진이 아니라 **외부 언퍼링 서비스(Iframely) 위임 + iframe 렌더링**이고, 인증이 필요한 콘텐츠는 별도의 Link Preview 통합(OAuth + unfurl callback)으로 분리되어 있다.
임포트/익스포트는 동기 요청이 아니라 **비동기 잡 큐 + ZIP 아티팩트 + 만료되는 다운로드 링크**로 설계되어 있으며, 워크스페이스 전체 익스포트는 최대 30시간까지 걸린다고 공식 문서가 명시한다.

---

## 핵심 개념 / 데이터 모델

### 개념 지도

```
Workspace
 └─ Integration(Connection)  ── capabilities[]   (무엇을 할 수 있나)
      └─ Installation/Grant  ── grant_roots[]    (어디에 할 수 있나)
           └─ AccessToken (internal: 정적 / public: OAuth access+refresh)

Content 트리
 Page ──1:N── Block(트리) ──0:N── Block(children)
 Database ──1:N── DataSource ──1:N── Page(row)     # 2025-09-03 이후 3계층
 Block(type=embed|bookmark|link_preview|image|file|pdf|video) ─→ 외부 리소스

경계면 (5개 표면)
 [1] REST API        : page/block/data_source/view/comment/file_upload + Markdown 경로
 [2] MCP 서버        : mcp.notion.com — OAuth, 도구 단위, 입출력은 Notion-flavored Markdown
 [3] Admin API       : api.notion.com/admin/v1 — 별도 버전(2026-06-01), 리소스:동작 스코프
 [4] Automation      : 데이터베이스 자동화/버튼 → 임의 URL로 POST (노코드, 유료 전용)
 [5] Workers/CLI     : 사용자 TypeScript 코드를 노션이 호스팅 (sync / tool / webhook)

 Webhook Subscription ─(HMAC-SHA256)→ 고객 endpoint     # at-most-once, 8회 재시도
 ImportJob  : 업로드 파일/외부 앱 → 파싱 → Page/Block 트리 생성
 ExportJob  : Page 서브트리 → 직렬화 → ZIP → 만료되는 서명 URL(7일)
 FileUpload : create → send(part) → complete → block/property에 attach
 MarkdownIO : Page ⇄ Notion-flavored Markdown  (export·import·MCP의 공통 기반)
```

### 의사 스키마 (클론 구현용 최소 셋)

```sql
-- 인증/권한
integration(
  id uuid pk, workspace_id uuid, type enum('internal','public'),
  name text, client_id text, client_secret_hash text,
  redirect_uris text[], created_by uuid, created_at timestamptz
)
integration_capability(
  integration_id uuid, capability enum(
    'read_content','update_content','insert_content',
    'read_comment','insert_comment',
    'user_none','user_no_email','user_with_email'),
  primary key(integration_id, capability)
)
access_grant(              -- = bot / installation
  bot_id uuid pk, integration_id uuid, workspace_id uuid,
  owner_type enum('user','workspace'), owner_user_id uuid,
  access_token_hash text, refresh_token_hash text,
  access_expires_at timestamptz, duplicated_template_id uuid null
)
grant_root(                -- 사용자가 page picker에서 고른 루트. 자손은 상속.
  bot_id uuid, root_block_id uuid, granted_at timestamptz,
  primary key(bot_id, root_block_id)
)

-- 외부 리소스 블록
embed_block(
  block_id uuid pk, url text, provider text null,
  embed_html text null, aspect_ratio numeric null,
  width_px int null, height_px int null,
  unfurl_status enum('pending','ok','unsupported','failed'),
  unfurl_fetched_at timestamptz, unfurl_ttl_sec int
)
link_unfurl_cache(         -- bookmark / link mention 공용
  url_hash char(64) pk, url text, title text, description text,
  favicon_url text, image_url text, provider_name text,
  html text null, fetched_at timestamptz, expires_at timestamptz,
  status enum('ok','blocked','404','timeout')
)
link_preview_provider(     -- 인증형 unfurl (도메인 소유자만 등록)
  id uuid pk, integration_id uuid, domain_patterns text[],
  unfurl_callback_url text, oauth_config jsonb, verified bool
)

-- 파일
file_upload(
  id uuid pk, workspace_id uuid,
  mode enum('single_part','multi_part','external_url'),
  status enum('pending','uploaded','expired','failed'),
  filename text, content_type text, content_length bigint,
  number_of_parts int null, parts_uploaded int default 0,
  storage_key text, created_at timestamptz, expires_at timestamptz  -- 약 1h
)

-- 잡
import_job(
  id uuid pk, workspace_id uuid, user_id uuid,
  source enum('markdown','html','csv','docx','txt','zip',
              'evernote','trello','confluence','gdocs','quip','workflowy'),
  target_parent_id uuid, status enum('queued','running','partial','done','failed'),
  total_items int, done_items int, error_report jsonb, created_at timestamptz
)
export_job(
  id uuid pk, workspace_id uuid, user_id uuid,
  root_block_id uuid null,           -- null = 워크스페이스 전체
  format enum('markdown_csv','html','pdf'),
  opts jsonb,   -- {include_subpages, create_folders, include_content, page_format, scale}
  status enum('queued','running','done','failed'),
  artifact_url text, artifact_bytes bigint, expires_at timestamptz  -- 7d
)

-- 신규 표면 관련 테이블은 각 기능 절에 상세 정의가 있다:
--   data_source / data_source_property / page_property_value / page_relation
--     / property_dependency / property_computed_cache        → F-09-16, F-09-17
--   oembed_provider / unfurl_fetch_log                        → F-09-18
--   mcp_client_connection / mcp_tool_call_log                 → F-09-19
--   org / org_bot_token / legal_hold / permission_group
--     / admin_audit_log / space_export_job                    → F-09-20
--   automation / automation_action / automation_run           → F-09-21
--   worker / worker_capability / worker_secret / worker_run
--     / sync_state / sync_record_map                          → F-09-23

-- 웹훅
webhook_subscription(
  id uuid pk, integration_id uuid, url text,
  verification_token_hash text,
  status enum('unverified','active','paused','disabled'),
  event_types text[], failure_count int, last_delivered_at timestamptz
)
webhook_delivery(
  id uuid pk, subscription_id uuid, event_id uuid, payload jsonb,
  attempt int, response_status int, delivered_at timestamptz
)
```

### 리소스 트리의 파괴적 변경 (반드시 클론 설계에 반영할 것)

2025-09-03 버전에서 `database`는 **컨테이너**가 되고, 실제 스키마(properties)와 행(page)은 **`data_source`**가 소유하게 바뀌었다. 하나의 database가 여러 data_source를 가질 수 있다.

| 구버전(2022-06-28) | 신버전(2025-09-03+) |
|---|---|
| `POST /v1/databases/{id}/query` | `POST /v1/data_sources/{data_source_id}/query` |
| `GET /v1/databases/{id}`가 스키마 포함 | `GET /v1/databases/{id}` → `data_sources[]` 목록 → `GET /v1/data_sources/{id}`로 스키마 |
| page의 `parent.database_id` | page의 `parent.data_source_id` |
| search filter `object:"database"` | search filter `object:"data_source"` |

> 시사점: **클론은 처음부터 `database → data_source → row` 3계층으로 설계하라.** 나중에 끼워넣으면 모든 통합이 깨진다. 실제로 이 변경 때 서드파티 자동화가 대거 중단되었고, 구버전 헤더를 쓰는 통합은 멀티소스 database를 **아예 조회하지 못한다**.

---

## 기능 명세

### F-09-01 공개 REST API 리소스 표면 (엔드포인트 계약)

- **한 줄 정의**: 외부 프로그램이 HTTPS+JSON으로 페이지·블록·데이터소스·사용자·댓글·파일을 CRUD 할 수 있게 하는 단일 진입점.
- **사용자 시나리오**:
  1. 개발자가 Developer portal에서 connection 생성 → 토큰 발급.
  2. `GET /v1/users/me`에 `Authorization: Bearer …` + `Notion-Version: 2026-03-11` 헤더를 붙여 연결 확인.
  3. `POST /v1/search`로 접근 가능한 page/data_source 탐색.
  4. `GET /v1/blocks/{id}/children`로 본문을 읽고, `PATCH /v1/blocks/{id}/children`로 블록 추가.
- **동작 상세**:
  - Base URL `https://api.notion.com`, HTTPS 강제. 모든 요청에 `Notion-Version` 헤더 필수.
  - 모든 리소스는 `"object"` 필드로 타입을 자기 서술(`page`/`block`/`database`/`data_source`/`user`/`comment`/`list`/`error`).
  - id는 UUIDv4, 요청 시 대시 유무 모두 허용. 프로퍼티명은 snake_case, 날짜는 ISO 8601. 값 해제는 빈 문자열이 아니라 `null`.
  - 주요 엔드포인트 군:

| 리소스 | 메서드/경로 | 비고 |
|---|---|---|
| Page | `POST /v1/pages`, `GET /v1/pages/{id}`, `PATCH /v1/pages/{id}`, `GET /v1/pages/{id}/properties/{prop_id}` | 삭제는 `archived:true`/`in_trash` PATCH |
| Block | `GET /v1/blocks/{id}`, `PATCH /v1/blocks/{id}`, `DELETE /v1/blocks/{id}`, `GET /v1/blocks/{id}/children`, `PATCH /v1/blocks/{id}/children` | children append 배열 최대 100, **중첩 최대 2단**. 삽입 위치는 `position`(구 `after`는 deprecated) |
| Database | `POST /v1/databases`, `GET /v1/databases/{id}`, `PATCH /v1/databases/{id}` | 2025-09-03 이후 컨테이너 |
| Data source | `POST /v1/data_sources`, `GET/PATCH /v1/data_sources/{id}`, `POST /v1/data_sources/{id}/query` | 스키마·행 소유. query는 F-09-16 |
| Page property | `GET /v1/pages/{page_id}/properties/{property_id}` | 25건 초과 참조의 페이지네이션 전용. F-09-17 |
| User | `GET /v1/users`, `GET /v1/users/{id}`, `GET /v1/users/me` | user capability에 따라 email 마스킹 |
| Search | `POST /v1/search` | 제목 검색만 |
| Comment | `GET/POST /v1/comments`, `PATCH/DELETE /v1/comments/{id}` | 열린 스레드만 조회 |
| File upload | `POST /v1/file_uploads`, `.../{id}/send`, `.../{id}/complete`, `GET /v1/file_uploads`, `GET /v1/file_uploads/{id}` | F-09-08 |
| **Markdown** | `GET /v1/pages/{id}/markdown`, `PATCH /v1/pages/{id}/markdown`, `POST /v1/pages`(body에 `markdown`) | 2026-03-11 신설. 본문을 문자열 하나로 읽고 쓴다. F-09-22 |
| **View** | `POST/GET/PATCH/DELETE /v1/views…`, `GET /v1/views`, view query 생성·조회·삭제 | 2026-03-11 신설. 데이터소스 뷰(table/board/calendar…)를 API로 다룬다 `[확인필요]`(상세 파라미터 미검증) |
| **Async task** | `GET /v1/…` 비동기 작업 상태 조회(`retrieve-async-task`) | 페이지 복제·대용량 생성 등이 잡으로 빠지면서 도입됨 |
| **Page move / trash** | `move-page`, `trash-page` 전용 엔드포인트 | 부모 이동과 휴지통 이동을 PATCH에서 분리 |
| Custom emoji | `GET /v1/custom_emojis` 계열 | 워크스페이스 커스텀 이모지 목록 |
| Meeting notes | `create-meeting-note`, `query-meeting-notes` | 2026 신규. 녹취·전사 연동 |

  - "삭제"는 대부분 하드 삭제가 아니라 `in_trash` 플래그 전이이며, block `DELETE`도 휴지통 이동이다.
  - **2026-03-11의 파괴적 변경 3건(공식 업그레이드 가이드)**: ① `archived` 필드가 **`in_trash`로 이름 변경**(page/database/block/data_source 전역). ② append children의 `after` 파라미터가 **`position` 객체**로 교체 — `{"position":{"type":"after_block","after_block":{"id":"…"}}}` 형태이며 `start`/`end`도 가능. ③ 블록 타입 `transcription` → **`meeting_notes`** 로 이름 변경. → **필드 이름 하나가 버전 사이에서 바뀌는 것만으로도 모든 클라이언트가 깨진다** — 클론은 `archived`처럼 나중에 개명할 이름을 처음부터 `in_trash`로 가져가라(후발 이점 중 가장 싼 것).
- **엣지 케이스**:
  - 빈 값: `rich_text: []`는 유효(빈 문단). `title` 프로퍼티를 비우면 페이지 제목이 "Untitled"로 표기.
  - 중첩: **한 요청 안에서 허용되는 children 중첩은 최대 2단**이라고 공식 레퍼런스가 명시한다. 3단 이상의 트리는 반드시 여러 번 나눠 append 해야 한다 → 임포터는 **BFS로 레벨을 2단씩 끊어 보내는 큐**를 갖춰야 하고, 부모 id를 응답에서 받아 다음 레벨의 타깃으로 넘긴다.
  - 삽입 위치: `after`(특정 형제 뒤)는 **deprecated**이고 `position`이 대체한다(리스트 맨 앞 삽입 등 더 넓은 표현 가능). 클론은 처음부터 `position` 형태 하나만 노출하라.
  - 동시편집: 공개 레퍼런스에 optimistic locking(ETag/If-Match)에 해당하는 헤더나 필드가 존재하지 않는다 → 두 통합이 같은 블록을 PATCH 하면 last-write-wins로 보아야 한다 `[추정]`(문서에 "없다"고 명시된 것이 아니라 "있다는 기술이 없다"는 근거). **클론은 여기서 차별화할 여지가 있다** — 블록에 `version int`를 두고 `If-Match: <version>` 불일치 시 409를 돌려주면 배치 스크립트의 덮어쓰기 사고가 사라진다.
  - 삭제된 참조: 휴지통에 있는 블록에 append 하면 400/404. relation이 가리키던 페이지가 삭제되면 relation 배열에서 조용히 빠진다 `[추정]`.
  - 권한 없음: 공유되지 않은 id는 존재 여부를 노출하지 않기 위해 404(`object_not_found`). 403은 capability 부족 또는 워크스페이스 블록 한도 초과.
  - 대용량: 요청당 100 블록 / 요소 1,000개 / payload 500KB 상한. 수천 블록 페이지는 children을 커서로 반복 조회해야 한다. 데이터소스 쿼리는 **한 쿼리당 10,000행까지만 페이지네이션**되므로(F-09-16) 그 이상은 필터 분할이 필요하다.
  - 순환 참조: 페이지 A를 A의 자손으로 이동시키는 요청은 트리를 끊는다 → 부모 변경(`PATCH /v1/pages` parent 이동, `notion-move-pages`)에는 **조상 경로 검사(새 부모가 자기 서브트리에 속하면 400)** 가 필수다. relation 프로퍼티의 상호 참조(A↔B)는 순환이 정상이므로 블록 트리 순환과 구분해 다뤄야 한다 `[추정]`.
- **데이터 모델 함의**: 위 content 트리 전체. API 계약을 지키려면 **모든** 리소스에 `object_type`, `in_trash`, `created_by`, `last_edited_by`, `created_time`, `last_edited_time` 공통 컬럼이 필요하다. 블록은 `parent_id` + `sort_key`(fractional index)로 순서를 유지한다.
- **UI/인터랙션**: 직접 UI 없음. Developer portal에서 connection 생성/토큰 재발급, 워크스페이스 Settings > Connections에서 설치된 연결 조회·해지, 페이지 ••• 메뉴 > Connections로 개별 공유.
- **의존 기능**: 블록/페이지 데이터 모델, 권한 모델(F-09-02), 인증, 페이지네이션(F-09-04).
- **구현 난이도**: **L**(페이지·블록 CRUD + 버전 협상만) / **XL**(프로퍼티 값 24종 직렬화 F-09-17 + 쿼리 필터 DSL F-09-16까지 포함) — 블록 타입 30여 종 × 프로퍼티 24종의 다형 직렬화가 실제 비용이며, 두 축을 합치면 2주를 넘긴다.
- **우선순위**: **P1** — MVP 제품 성립에는 불필요하나 자동화·백업·생태계의 전제.
- **클론 시 현실적 대안**: v1은 `pages`, `blocks`, `search`만 노출하고 database/data_source API는 v2로 미룬다. 다형 블록 직렬화는 JSON Schema 하나로 정의하고 zod/pydantic 코드 생성으로 뽑아 수작업을 줄인다.
- **참고 출처**: https://developers.notion.com/reference/intro (base URL·규약·`2026-03-11` 예제 헤더 재확인) , https://developers.notion.com/reference/patch-block-children , https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03 , https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11 (archived→in_trash, after→position, transcription→meeting_notes) , https://developers.notion.com/llms.txt (리소스 전체 인덱스)

---

### F-09-02 인증 & 권한 모델 (토큰 × capability × 페이지 공유)

- **한 줄 정의**: 통합이 "무엇을 할 수 있는지(capability)"와 "어디에 할 수 있는지(공유된 페이지 서브트리)"를 분리해 곱집합으로 권한을 결정한다.
- **사용자 시나리오** (public 통합 OAuth):
  1. 사용자가 서드파티 앱에서 "Connect to Notion" 클릭.
  2. `https://api.notion.com/v1/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&owner=user&state=…` 로 이동.
  3. 워크스페이스 선택 → **page picker**에서 공유할 페이지/데이터베이스를 체크 → Allow.
  4. `redirect_uri?code=…&state=…`로 복귀.
  5. 앱 서버가 `POST /v1/oauth/token`에 HTTP Basic(`client_id:client_secret`의 base64) + `{grant_type:"authorization_code", code, redirect_uri}` 전송.
  6. 응답: `access_token`, `refresh_token`, `bot_id`, `workspace_id`, `workspace_name`, `workspace_icon`, `owner`, `duplicated_template_id`.
  7. 만료 시 `{grant_type:"refresh_token", refresh_token}`으로 새 access+refresh 페어 발급.
- **동작 상세**:
  - **토큰 타입은 3종이며 "누가 편집한 것으로 기록되는가(attribution)"가 서로 다르다.** 이 차이는 감사 로그·`last_edited_by`·알림 수신자까지 전부 바꾸므로 클론에서 반드시 1급 개념으로 모델링해야 한다.

  | 토큰 타입 | 발급 주체 | 만료 | 접근 범위 확정 방식 | 편집 귀속(`last_edited_by`) |
  |---|---|---|---|---|
  | Internal connection token | 워크스페이스 소유자 | 정적(무기한) | Notion UI에서 페이지별 수동 공유 | 통합의 **bot 아이덴티티** |
  | **Personal access token (PAT)** | 개별 사용자(개발자 포털) | **만료 선택: 7 / 30 / 90 / 180일 / 1년(기본 1년)** — 만료 후 `unauthorized` | **발급자 본인의 권한을 그대로 상속(워크스페이스 1개 한정)** | **발급한 사용자 본인** |
  | Public OAuth token | 최종 사용자 인가 | access 만료 + refresh 회전 | OAuth page picker에서 선택 | **인가한 사용자** |

  - PAT는 스크립트·CLI·신뢰된 내부 도구용이며, 공유 설정 없이 그 사용자가 볼 수 있는 모든 것에 닿는다는 점에서 **가장 반경이 넓은 토큰**이다. 단 초판이 적은 "정적이라 만료가 없다"는 서술은 **틀렸다** — 공식 문서는 발급 시 만료를 7/30/90/180일 또는 1년 중에서 고르게 하고(미지정 시 1년), 토큰 값은 생성 직후 1회만 볼 수 있으며, 발급자나 관리자가 폐기하면 **즉시** 무효화된다고 명시한다. 또 PAT는 **워크스페이스 1개에 속하며**, 발급자가 그 워크스페이스 멤버십을 잃으면 접근도 함께 사라진다. → 클론이 추가로 넣을 것은 만료 자체가 아니라 **스코프 축소(읽기 전용 PAT)와 마지막 사용 시각·사용 IP 표시**다.
  - internal 통합: 워크스페이스 소유자가 생성하며 **정적** installation access token을 받는다. 접근 대상은 Notion UI에서 페이지별로 수동 공유한다.
  - capability 목록(OAuth scope가 아님):

  | 그룹 | 값 | 허용 범위 |
  |---|---|---|
  | content | Read content | 기존 콘텐츠 읽기 |
  | content | Update content | 기존 콘텐츠 수정 |
  | content | Insert content | 신규 콘텐츠 생성 |
  | comment | Read comments | 댓글 조회 |
  | comment | Insert comments | 댓글 생성 / 스레드 답글 |
  | user | No user information | 사용자 정보 전면 차단 |
  | user | User info without email | 이름·아바타만 |
  | user | User info with email | 이메일 포함 |

  - **상속 규칙**: 통합이 어떤 페이지에 접근 권한을 얻으면 그 페이지의 **모든 자손**에 자동으로 접근한다. 자손 단위 예외(deny)는 없다.
  - 통합 자신이 워크스페이스의 bot user로 표현되며 `GET /v1/users/me`가 bot 객체를 반환한다(PAT/공개 OAuth 토큰은 `owner`에 실제 사용자 객체가 실린다).
  - refresh 시 노션은 **access_token과 refresh_token을 함께 새로 내려줄 수 있다**(회전형). 동일 통합을 재인가해도 마찬가지이므로, 클라이언트는 응답의 두 토큰을 **항상 덮어써 저장**해야 한다. 옛 refresh_token을 붙들고 있으면 조용히 무효화된다.
  - `duplicated_template_id`: OAuth 시 템플릿 복제 옵션을 쓰면 복제된 페이지 id가 함께 내려온다(온보딩 용도).
- **엣지 케이스**:
  - 빈 값: page picker에서 아무것도 고르지 않고 Allow → 토큰은 발급되지만 모든 조회가 빈 결과/404. 앱은 "접근 가능한 페이지 없음" 상태를 명시적으로 처리해야 한다.
  - 중첩: 부모와 자식을 둘 다 공유하면 중복 grant → `grant_root`에 유니크 제약 + 조상 존재 시 하위 grant 정리 로직 필요.
  - 동시편집: 사용자가 UI에서 연결을 해지하는 순간 진행 중이던 배치 작업은 다음 요청부터 401/404.
  - 삭제된 참조: 공유 루트가 휴지통으로 가면 서브트리 접근이 실패한다. grant 레코드는 남는다 `[추정]`.
  - 권한 없음: capability는 있는데 공유가 없으면 404, 공유는 있는데 capability가 없으면 403. **두 실패 모드를 구분해 다른 메시지를 주는 것이 지원 비용을 크게 줄인다.**
  - 해지 전파: 연결 해지·PAT 폐기·사용자 비활성화(SCIM deprovision, 06 도메인)는 **이미 발급된 access_token을 즉시 무효화**해야 한다. JWT류 무상태 토큰을 쓰면 이 요구를 만족시킬 수 없다 → 불투명 토큰 + 서버측 조회(캐시 TTL ≤ 60초)를 권장 `[추정]`.
  - 순환/모순 grant: 상위 페이지 grant와 하위 페이지 개별 grant가 공존할 때 **deny가 없으므로 항상 합집합**이다. 클론이 나중에 deny를 도입하면 이 단순 규칙이 깨지므로, deny를 넣을 생각이라면 **v1부터 넣어야 한다**.
  - 대용량: 한 통합이 수천 페이지에 공유된 경우 상속 판정을 매 요청 조상 탐색으로 하면 느리다 → materialized path / closure table 필요.
- **데이터 모델 함의**: `integration`, `integration_capability`, `access_grant`, `grant_root`. 권한 판정은 `block.ancestor_path`(ltree 또는 materialized path)에 `grant_root` prefix 매칭으로 상수시간에 가깝게 처리한다. 토큰은 해시로만 저장하고 prefix 4~8자만 평문 보관해 UI 식별에 쓴다.
- **UI/인터랙션**: OAuth 동의 화면의 page picker(다중 선택 트리), Settings > Connections 목록과 Revoke, 페이지 ••• > Connections 서브메뉴.
- **의존 기능**: 사용자/워크스페이스 모델, 블록 트리의 조상 경로 인덱스.
- **구현 난이도**: **L**(internal 토큰 + 상속 grant만) / **XL**(토큰 3종 + 편집 귀속 + OAuth 회전 + page picker + 해지 즉시 전파 + capability 미들웨어 전부) — 권한 계층은 **모든 엔드포인트가 통과하는 경로**라 나중에 고치면 전 API에 손이 간다. 초판의 단일 "L" 평가는 과소평가였다.
- **우선순위**: **P1** (API를 낸다면 사실상 P0 선행조건).
- **클론 시 현실적 대안**: v1은 internal 통합만 — 워크스페이스 설정에서 발급하는 정적 PAT와 "워크스페이스 전체 읽기/쓰기" 단일 스코프. page picker와 OAuth는 v2. 단 **capability 테이블과 grant_root 테이블은 처음부터 만들어 둔다**(나중에 넣으면 전 API에 손대야 한다).
- **참고 출처**: https://developers.notion.com/docs/authorization , https://developers.notion.com/reference/authentication , https://developers.notion.com/reference/capabilities , https://developers.notion.com/guides/get-started/personal-access-tokens (PAT 만료 옵션·단일 워크스페이스·즉시 폐기 확인) , https://developers.notion.com/reference/introspect-token , https://developers.notion.com/reference/revoke-token

---

### F-09-03 Rich text JSON 스키마 (텍스트 직렬화 계약)

- **한 줄 정의**: 서식 있는 텍스트를 "런(run)의 배열"로 표현하는 표준 JSON 포맷. API의 모든 텍스트 필드가 이 형태다.
- **사용자 시나리오**: 개발자가 `PATCH /v1/blocks/{id}/children`로 문단을 추가하며 `paragraph.rich_text: [{type:"text", text:{content:"hello", link:{url:"https://x"}}, annotations:{bold:true, color:"red"}}]`를 보내면, UI에 빨간 굵은 링크 텍스트가 나타난다.
- **동작 상세**:
  - 공통 필드: `type`(`text`|`mention`|`equation`), 동명의 타입 객체, `annotations`, `plain_text`, `href`(옵션).
  - `annotations`: `bold`, `italic`, `strikethrough`, `underline`, `code`(boolean) + `color`(enum: `default`/`gray`/`brown`/`orange`/`yellow`/`green`/`blue`/`purple`/`pink`/`red` 및 각각의 `_background` 변형).
  - `text`: `{content, link:{url}|null}`. `equation`: `{expression}`(LaTeX).
  - `mention` 서브타입: `page`{id} / `database`{id} / `date`{start,end} / `user`{object,id} / `link_preview`{url} / `template_mention`(`template_mention_date`: `"today"`|`"now"` 또는 `template_mention_user`: `"me"`).
  - `plain_text`, `href`는 응답 전용 파생값이며 요청 시 보내도 무시된다 `[확인필요]`.
  - 인접한 동일 annotation 런은 서버가 병합해 돌려줄 수 있다 `[추정]` — 클라이언트는 런 경계 보존을 가정하면 안 된다.
- **엣지 케이스**:
  - 빈 값: `rich_text: []` 허용. `content: ""`인 런은 응답에서 사라질 수 있다 `[추정]`.
  - 길이: 한 런의 `content` 2,000자, 링크 URL 2,000자, `expression` 1,000자 상한. 2,000자 초과 문단은 여러 런으로 분할해 보내야 하며, 순진한 마크다운 임포터가 여기서 400을 맞는다.
  - 중첩: rich text는 중첩되지 않는 **플랫 런 배열**이다. "굵은 링크 안의 코드"는 annotation 조합으로만 표현된다 → 클론이 ProseMirror/Slate 같은 중첩 mark 모델을 쓰면 **직렬화 시 플래튼, 역직렬화 시 병합** 어댑터가 반드시 필요하다.
  - 동시편집: rich text 배열 전체가 통째로 교체되는 PATCH 세만틱이라 CRDT 실시간 편집과 충돌한다. API 쓰기를 CRDT 트랜잭션으로 번역하는 계층이 필요하다 `[추정]`.
  - 삭제된 참조: 삭제된 페이지를 가리키는 `mention.page`는 UI에서 접근불가/Untitled로 표시되고 API에는 id만 남는다 `[확인필요]`.
  - 권한 없음: 접근 불가 페이지 mention의 `plain_text`가 마스킹될 수 있다 `[확인필요]`.
- **데이터 모델 함의**:
  ```
  rich_text_run(block_id, seq, type, content, link_url, expression,
                mention_type, mention_target_id, mention_payload jsonb,
                a_bold, a_italic, a_strike, a_underline, a_code, a_color)
  ```
  실무적으로는 `blocks.content jsonb`에 배열로 저장하고 전문검색용 `plain_text` 파생 컬럼을 두는 편이 조인 비용이 낮다 `[추정]`. mention은 `block_reference(from_block_id, to_entity_id, kind)` 역인덱스를 따로 둬야 백링크·삭제 정합성을 잡을 수 있다.
- **UI/인터랙션**: Cmd/Ctrl+B/I/U, Cmd+Shift+S(취소선), Cmd+E(코드), Cmd+K(링크), `@`(mention), `/equation`·`$$`(수식). 선택 시 나타나는 플로팅 툴바에서 색상 지정.
- **의존 기능**: 블록 모델, 멘션 대상 해석(페이지/사용자/날짜), 수식 렌더러.
- **구현 난이도**: **M** — 스키마는 단순. 비용은 에디터 모델 ↔ 런 배열의 무손실 왕복(round-trip) 테스트에 든다.
- **우선순위**: **P0** — 서식 없는 문서 앱은 성립하지 않는다.
- **클론 시 현실적 대안**: 스키마를 노션과 **동일하게** 가져가는 것을 권장한다(마이그레이션 도구와 LLM 생태계가 이미 이 포맷을 안다). mention 서브타입은 `page`/`user`/`date` 3종으로 시작.
- **참고 출처**: https://developers.notion.com/reference/rich-text , https://developers.notion.com/reference/request-limits

---

### F-09-04 커서 페이지네이션

- **한 줄 정의**: 목록형 응답을 100개 단위 불투명 커서로 순회하는 규약.
- **사용자 시나리오**: `POST /v1/data_sources/{id}/query` 호출 → 응답의 `has_more:true`, `next_cursor:"abc"` 확인 → 같은 요청에 `start_cursor:"abc"`를 넣어 재호출 → `has_more:false`까지 반복.
- **동작 상세**:
  - 응답 봉투: `{object:"list", results:[…], has_more, next_cursor, type, "{type}":{}}`.
  - 요청 파라미터: `page_size`(기본 100, **최대 100**), `start_cursor`. GET은 쿼리스트링, POST는 body.
  - `next_cursor`는 불투명 토큰이며 마지막 페이지에서는 `null`.
  - 1,000행을 전부 읽으려면 최소 10요청 → 연결당 초당 3요청 제한과 곱해져 3초 이상 소요된다.
  - **커서 순회에는 절대 상한이 있다**: `POST /v1/data_sources/{id}/query`는 **한 쿼리당 최대 10,000행까지만** 페이지네이션되며, 넘어가면 `has_more`가 아니라 `request_status.type: "incomplete"` + `incomplete_reason: "query_result_limit_reached"`로 끊긴다. 즉 "커서가 끝날 때까지 돌면 전부 읽힌다"는 가정이 **틀렸다**. 10,000행 초과 데이터소스는 필터를 쪼개(예: 생성일 구간) 여러 쿼리로 나눠야 하고, 공식 JS SDK는 이를 위해 `iterateAllDataSourceRows` / `collectAllDataSourceRows` 헬퍼를 따로 제공한다.
- **엣지 케이스**:
  - 빈 값: 결과 0개여도 `results: []`, `has_more:false`로 200.
  - 커서 만료: **커서는 수 분 내 만료된다**고 알려져 있어, 배치 잡이 커서를 DB에 저장했다가 다음 실행에서 재개하는 패턴은 실패한다. 재개가 필요하면 `last_edited_time` 정렬 + 워터마크 방식으로 바꿔야 한다. `[확인필요]` (정확한 TTL 수치는 공식 문서에 숫자로 명시되어 있지 않음)
  - 동시편집: 순회 중 데이터가 바뀌면 항목 중복/누락이 가능하다(스냅샷 격리 아님) `[추정]`.
  - 삭제된 참조: 순회 중 삭제된 항목은 다음 페이지에서 사라져 총계가 어긋날 수 있다.
  - 권한 없음: 접근 불가 항목은 에러가 아니라 **결과에서 조용히 제외**된다.
  - 대용량: page_size 상한 100 때문에 대량 동기화는 반복 호출이 불가피. 여기에 10,000행 상한이 겹치므로 **초기 풀 싱크는 export 경로(F-09-14) 또는 구간 분할 쿼리**가 정답이다.
  - 순환 참조: 커서 자체는 순환하지 않지만, 트리를 children 커서로 재귀 순회할 때 synced block/링크된 데이터베이스가 조상을 다시 가리키면 무한 루프가 된다 → **방문 집합(visited set) + 최대 깊이 가드**가 필요하다 `[추정]`.
- **데이터 모델 함의**: 커서를 `(sort_key, id)` 튜플의 base64 인코딩 + HMAC 서명 + TTL로 구현한다. `OFFSET` 기반 구현은 대용량에서 성능이 무너지므로 금지. 인덱스는 `(parent_id, sort_key, id)`.
- **UI/인터랙션**: 없음(프로그래매틱). 다만 제품 UI의 무한 스크롤도 같은 커서 규약을 재사용하는 것이 이득이다.
- **의존 기능**: 안정적 정렬 키(생성 시각 또는 fractional index).
- **구현 난이도**: **S** — 서명·TTL 포함해도 1일 내. 단 "결과 상한에 도달했음"을 표현하는 `incomplete` 상태를 응답 봉투에 처음부터 넣어두면(나중에 추가하면 파괴적 변경) 추가 비용 없이 노션의 실패 사례를 피한다.
- **우선순위**: **P0** — API를 낸다면 첫날부터 필요하며, 나중에 바꾸면 파괴적 변경이 된다.
- **클론 시 현실적 대안**: 그대로 구현하되 `page_size` 상한은 100 대신 200~500으로 완화해도 무방하다 `[추정]`. 커서 TTL은 노션보다 길게(예: 24h) 잡아 배치 재개를 지원하면 실사용 편의가 크다.
- **참고 출처**: https://developers.notion.com/reference/intro , https://developers.notion.com/reference/query-a-data-source , https://github.com/makenotion/notion-sdk-js , https://www.pynotion.com/paginated-requests-in-notion/

---

### F-09-05 Rate limit · 크기 제한 · 에러 규약 · API 버저닝

- **한 줄 정의**: 남용 방지를 위한 요청 빈도/페이로드 상한과, 클라이언트가 재시도 가능 여부를 판별할 수 있는 표준 에러 포맷 및 날짜 기반 버전 협상.
- **사용자 시나리오**: 대량 임포트 스크립트가 초당 10요청을 보냄 → 429 + `Retry-After` 수신 → 지수 백오프 후 재개 → 한 요청에 200개 블록을 보내다 400 `validation_error` 수신 → 100개씩 청크로 분할.
- **동작 상세**:
  - **연결당** 평균 초당 3요청(짧은 버스트 허용). **워크스페이스당** 한도가 별도로 존재하며 플랜에 따라 스케일된다(수치 미공개).
  - 429/529 시 `Retry-After` 헤더를 준수해야 한다. 어느 한도에 걸렸는지는 `additional_data.rate_limit_reason`으로 구분한다.
  - 크기 제한(초과 시 400 `validation_error`):

  | 항목 | 상한 |
  |---|---|
  | rich text `content` | 2,000자 |
  | rich text `link.url` / 임의 URL | 2,000자 |
  | equation `expression` | 1,000자 |
  | 블록 배열(요청당) | 100개 |
  | 요청당 전체 블록 요소 | 1,000개 |
  | 전체 payload | 500KB |
  | children 중첩 깊이(요청당) | **2단** |
  | 업로드 파일명 | 900바이트(확장자 포함) |
  | email 프로퍼티 | 200자 |
  | phone 프로퍼티 | 200자 |
  | multi_select 옵션 수 | 100 |
  | relation 대상 페이지 수 | 100 |
  | people 필드 사용자 수 | 100 |

  - 상태 코드: 400 validation, 401 unauthorized, 403 restricted(capability 부족 / 워크스페이스 블록 한도 초과), 404 object_not_found, 409 conflict, 429 rate_limited, 500·502·503·504 서버(멱등 요청은 재시도 가능), 529 서비스 과부하.
  - 에러 본문: `{object:"error", status, code, message, request_id}`.
  - 버저닝: `Notion-Version` 날짜 문자열로 응답 형태를 협상한다. 구버전 클라이언트는 신규 개념(멀티소스 database)을 아예 볼 수 없게 되는 형태의 하위호환 절단이 실제로 발생했다.
- **엣지 케이스**:
  - 빈 값: `Notion-Version` 누락 또는 미지원 날짜 → 400.
  - 중첩: children 중첩 상한은 **2단**으로 확정되었다(`PATCH /v1/blocks/{id}/children` 레퍼런스 명시). 3단 이상은 요소 개수와 무관하게 무조건 분할 전송이며, 요소 1,000개 상한은 그 위에 별도로 걸린다.
  - 동시편집: 여러 워커가 같은 토큰을 공유하면 초당 3요청을 **합산 소모** → 분산 토큰 버킷(Redis 등)이 필요하다.
  - 삭제된 참조: 404와 403을 클라이언트가 혼동하지 않게 별도 처리.
  - 권한 없음: 워크스페이스 블록 한도 초과도 403으로 오므로 `code` 값 파싱이 필요하다.
  - 대용량: 500KB payload 상한 때문에 base64 인라인 이미지는 불가능 → 파일 업로드 API 경유(F-09-08).
  - 순환 참조: 레이트리밋 버킷 키를 워크스페이스로 잡으면 한 통합의 폭주가 같은 워크스페이스의 다른 통합을 굶긴다. 노션도 **연결 단위와 워크스페이스 단위 두 한도를 동시에** 두고 `rate_limit_reason`으로 구분한다 — 클론도 2계층으로 가되 어느 쪽에 걸렸는지 반드시 응답에 실어라.
- **데이터 모델 함의**:
  ```
  rate_limit_bucket(key /* bot_id 또는 workspace_id */, window_start, tokens, updated_at)
  api_request_log(id, bot_id, method, path, status, bytes_in, bytes_out,
                  latency_ms, request_id, at)
  ```
  `request_id`를 응답에 실어야 지원 티켓 추적이 가능하다.
- **UI/인터랙션**: 없음. 관리자용 API 사용량 대시보드는 P2.
- **의존 기능**: 인증(버킷 키를 bot_id로 잡으려면 토큰 해석이 선행).
- **구현 난이도**: **M** — 분산 토큰 버킷 + 미들웨어 + 에러 포맷 통일에 2~4일.
- **우선순위**: **P1** — 공개 API를 외부에 여는 순간 P0로 승격.
- **클론 시 현실적 대안**: v1은 nginx/Cloudflare 레벨의 IP+토큰 레이트리밋으로 시작하고 `Retry-After`와 표준 에러 본문만 정확히 지킨다. 크기 제한 수치를 노션과 동일하게 채택하면 기존 서드파티 클라이언트 호환성이 공짜로 따라온다.
- **참고 출처**: https://developers.notion.com/reference/request-limits , https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03

---

### F-09-06 Search 엔드포인트

- **한 줄 정의**: 통합에 공유된 범위 안에서 페이지/데이터소스를 **제목 기준**으로 찾는 조회 API.
- **사용자 시나리오**: 통합이 부팅 시 `POST /v1/search {filter:{property:"object", value:"data_source"}}`로 접근 가능한 데이터소스를 나열 → 사용자가 대상 DB를 선택 → 이후 `data_sources/{id}/query`로 행을 읽는다.
- **동작 상세**:
  - `POST /v1/search`. body: `query`(제목 부분일치), `sort`(`{timestamp:"last_edited_time", direction:"ascending"|"descending"}` 또는 relevance), `filter`(`object`: `"page"`|`"data_source"`, `in_trash`), `start_cursor`, `page_size`.
  - `query` 생략 시 접근 가능한 모든 page/data_source를 나열한다(디스커버리 용도).
  - **본문 블록 텍스트는 검색하지 않고 제목만 매칭한다** `[확인필요]` — 현행 `search-optimizations-and-limitations` 문서는 "제목만"이라고 **명시하지 않고** "요청을 최대한 구체적으로" 쓰라고만 말한다. 대신 공식이 명시하는 제약은 다음 세 가지다.
  - **검색은 전수 보장이 아니다**: *"Search is not guaranteed to return everything, and the index may change as your connection iterates through pages and databases."* — 즉 **순회 중 인덱스가 변하는 것을 정상 동작으로 선언**한다. 백업·동기화 용도로 search를 쓰면 안 된다는 뜻이다.
  - **통합에 직접 공유된 페이지/DB는 반드시 반환**된다(상속으로만 접근하는 자손은 그 보장 밖).
  - **인덱싱은 즉시가 아니다**(공식 명시, 초판의 `[추정]` 해제): 공유 직후 검색하면 해당 페이지가 안 나올 수 있으며, 문서는 UI에 **재시도 버튼을 두라**고 권고한다. 휴지통(`in_trash`) 결과도 eventually consistent다.
  - 중복된 linked database(뷰 참조)는 결과에서 제외된다.
  - 특정 데이터소스 내부 행 검색은 search가 아니라 `POST /v1/data_sources/{id}/query`의 filter로 해야 한다.
- **엣지 케이스**:
  - 빈 값: `query:""` → 전체 목록. 0건도 200.
  - 중첩: 부모와 자식이 모두 매칭되면 각각 별개 결과로 나온다. 트리 정보는 없으므로 클라이언트가 `parent` 필드로 재구성해야 한다.
  - 동시편집: 인덱싱 지연으로 방금 만든 페이지가 즉시 검색되지 않는다(**공식 명시**, 추정 아님). 통합이 "생성 → 즉시 search로 확인"하는 패턴을 쓰면 간헐적으로 실패하므로, 생성 응답의 id를 신뢰하도록 문서에 명시해야 한다.
  - 순환 참조: 결과에 부모·자식이 모두 섞여 나오므로 클라이언트가 트리를 재구성할 때 `parent` 체인을 따라가다 접근 불가 조상(404)에서 끊긴다 → **부분 트리(orphan) 렌더링**을 정상 상태로 설계해야 한다.
  - 삭제된 참조: `in_trash` 필터로만 휴지통 항목에 접근한다.
  - 권한 없음: 공유되지 않은 페이지는 결과에서 제외(에러 아님).
  - 대용량: 대형 워크스페이스에서 query 없이 전체 나열하면 수백 페이지 커서 순회가 발생한다. `last_edited_time` 정렬 + 워터마크 증분화가 사실상 필수.
- **데이터 모델 함의**:
  ```
  search_index(entity_id, entity_type, workspace_id,
               title_tsv tsvector, body_tsv tsvector,
               last_edited_time, in_trash, acl_root_path ltree)
  ```
  ACL 필터를 인덱스 조회 단계로 밀어 넣어야(pre-filter) 권한 누수와 성능 문제를 동시에 막는다.
- **UI/인터랙션**: 제품의 Quick Find(Cmd/Ctrl+P)와 인덱스를 공유하는 것이 합리적. 필터 칩(타입/작성자/기간), 최근 방문 우선 정렬.
- **의존 기능**: 권한 모델(F-09-02), 검색 인덱스 파이프라인, 페이지네이션(F-09-04).
- **구현 난이도**: **M**(단일 노드 Postgres `tsvector` + GIN, 2~3일) / **L**(ACL pre-filter를 인덱스 단계로 밀어 넣고, 편집 이벤트 기반 증분 재색인 파이프라인과 재색인 백필까지 포함) — 초판의 단일 "M"은 **권한 필터가 검색 성능·정확성 양쪽을 동시에 깨뜨린다**는 점을 반영하지 못했다. 권한이 페이지 트리 상속형이라 grant 변경 한 번이 수천 문서의 ACL을 바꾸므로, 문서에 ACL을 비정규화해 심으면 대량 재색인이 발생하고 심지 않으면 조회마다 조인이 붙는다. 이 트레이드오프 결정만으로 며칠이 든다.
- **우선순위**: **P1**.
- **클론 시 현실적 대안**: 제목만 검색하는 노션의 제약은 따라할 이유가 없다. Postgres full-text로 본문까지 색인하고 `filter.scope: "title"|"all"` 옵션을 추가로 제공하면 그 자체가 차별점이 된다.
- **참고 출처**: https://developers.notion.com/reference/post-search , https://developers.notion.com/reference/search-optimizations-and-limitations (전수 미보장·인덱싱 지연·직접 공유 보장 문구 확인)

---

### F-09-07 Comments API

- **한 줄 정의**: 페이지/블록에 달린 댓글 스레드를 프로그램으로 읽고 쓰는 API.
- **사용자 시나리오**: 봇이 `comment.created` 웹훅을 수신하거나 `GET /v1/comments?block_id=…`로 열린 댓글을 조회 → 스레드의 `discussion_id`를 꺼내 `POST /v1/comments {discussion_id, rich_text:[…]}`로 답글을 단다.
- **동작 상세**:
  - 엔드포인트: `GET /v1/comments`(list, `block_id` 쿼리, 페이지당 최대 100), `POST /v1/comments`, `PATCH /v1/comments/{id}`, `DELETE /v1/comments/{id}`.
  - 생성 시 앵커링은 셋 중 **정확히 하나**: `parent.page_id`(페이지 하단 스레드) / `parent.block_id`(특정 블록에 붙는 스레드) / `discussion_id`(기존 스레드 답글). 둘 이상 보내면 400.
  - **첨부**: 댓글에 최대 **3개**의 파일을 붙일 수 있으며, `status: "uploaded"` 상태의 `file_upload_id`를 참조한다(F-09-08과 같은 업로드 파이프라인 재사용).
  - **display_name**: 댓글 작성자 표시 이름을 `integration`(기본, 통합 아이덴티티) / `user`(인증된 사용자) / `custom`(임의 문자열) 중에서 고를 수 있다. 봇이 사람 이름을 사칭할 수 있다는 뜻이므로, 클론에서는 `custom`에 **"via <통합명>" 배지 강제**를 붙이는 편이 안전하다 `[추정]`.
  - 댓글 본문은 **인라인 서식(bold/italic/strikethrough/code/link)과 인라인 수식만** 지원한다. 블록 수준 마크다운(헤딩·리스트·코드블록)은 구조로 렌더되지 않는다.
  - `discussion_id`는 조회 응답에서 얻거나, UI에서 댓글 링크를 복사했을 때 URL의 `d=` 쿼리 파라미터로도 얻을 수 있다.
  - 필요한 capability: read comment / insert comment. 없으면 관련 요청 전부 에러.
  - **제약**: 블록 내부 **선택 텍스트 범위에 새 인라인 스레드를 시작하는 것은 API로 불가능**하다(공식 명시). 다만 UI에서 이미 만들어진 인라인 스레드에는 `discussion_id`로 답글을 달 수 있다. 해결(resolved)된 댓글은 조회되지 않는다. 남이 쓴 댓글은 수정/삭제 불가(자기 connection이 만든 것만 삭제 가능).
- **엣지 케이스**:
  - 빈 값: `rich_text: []`로 빈 댓글 생성 시도 → 400 `[추정]`.
  - 중첩: 노션 댓글은 2단(스레드 → 답글) 구조이며 답글의 답글은 없다.
  - 동시편집: 댓글이 달린 블록이 삭제되면 스레드 접근이 불가해진다 `[확인필요]`. 블록이 휴지통으로 갔다가 복원되는 왕복에서 스레드가 살아남는지도 미확인이므로, 클론은 **discussion을 블록이 아니라 페이지에 소유시키고 블록은 앵커로만 참조**해 삭제·복원과 무관하게 스레드를 보존하는 편이 안전하다.
  - 삭제된 참조: 댓글 삭제는 소프트 삭제로 보인다 `[추정]`. 첨부가 붙은 댓글을 삭제하면 `file_upload` 참조 카운트를 내려야 하며(F-09-08), 첨부만 남고 댓글이 사라지는 누수를 막으려면 삭제를 캐스케이드로 처리해야 한다.
  - 대용량(첨부): 첨부 3개 상한은 API 계약이므로 임포터가 더 많은 파일을 옮기려면 첨부를 별도 블록으로 승격해야 한다.
  - 권한 없음: read comment capability가 없으면 페이지를 읽을 수 있어도 댓글은 전부 숨겨진다.
  - 대용량: 스레드가 수백 개인 페이지는 커서 순회가 필요하다.
- **데이터 모델 함의**:
  ```
  discussion(id, workspace_id, parent_type enum('page','block'), parent_id,
             anchor jsonb /* 인라인 코멘트의 텍스트 범위 */,
             resolved bool, resolved_by, resolved_at, created_at)
  comment(id, discussion_id, author_id /* user 또는 bot */, rich_text jsonb,
          created_time, last_edited_time, deleted_at)
  ```
  **인라인 코멘트 앵커는 텍스트 오프셋이 아니라 안정적 마커(런 id 또는 CRDT relative position)여야** 편집 후에도 살아남는다.
- **UI/인터랙션**: 텍스트 선택 → 팝업 코멘트 아이콘(Cmd/Ctrl+Shift+M), 우측 사이드 패널의 스레드 목록, Resolve 버튼, `@`로 멘션 알림 발송.
- **의존 기능**: 사용자 모델, 알림, 블록 앵커링, 권한 모델.
- **구현 난이도**: **M**(API만) / **L**(편집에 안전한 인라인 앵커까지 포함 시).
- **우선순위**: **P2**(API 기준). 제품 기능으로서의 댓글 자체는 P1.
- **클론 시 현실적 대안**: v1은 **페이지 단위 댓글**만 지원해 앵커 문제를 통째로 회피한다. 인라인 앵커는 에디터가 CRDT/relative position을 갖춘 뒤 착수.
- **참고 출처**: https://developers.notion.com/docs/working-with-comments , https://developers.notion.com/reference/create-a-comment

---

### F-09-08 파일 업로드 API & 서명 URL 만료

- **한 줄 정의**: 바이너리 파일을 3단계(create → send → complete)로 업로드해 블록/프로퍼티/커버/아이콘에 첨부하는 API와, Notion 호스팅 파일 URL의 만료 규칙.
- **사용자 시나리오**:
  1. `POST /v1/file_uploads`로 업로드 세션 생성(`filename`, `content_type`, 20MB 초과면 `mode:"multi_part"` + `number_of_parts`).
  2. `POST /v1/file_uploads/{id}/send`에 `multipart/form-data`로 바이트 전송(폼 필드명은 반드시 `file`). 멀티파트면 파트별로 반복(파트 크기 5~20MB).
  3. 멀티파트인 경우 `POST /v1/file_uploads/{id}/complete`로 마감.
  4. `PATCH /v1/blocks/{id}/children`에 `{type:"image", image:{type:"file_upload", file_upload:{id}}}` 형태로 첨부.
- **동작 상세**:
  - **플랜별 단일 파일 상한(공식 확정)**: 무료 워크스페이스 **5 MiB**, 유료 워크스페이스 **5 GiB**. 그리고 **20 MiB를 넘는 파일은 반드시 multi-part 모드**로 보내야 한다. → "multi-part는 유료 전용"이라는 별도 규칙이 있는 것이 아니라, **무료 상한(5 MiB)이 multi-part 임계(20 MiB)보다 낮아서 결과적으로 유료 전용이 되는 것**이다(초판 서술 정정).
  - 업로드 모드는 3종: **Direct Upload**(≤20 MiB 단일 `multipart/form-data`), **Direct Upload multi-part**(파트 분할 후 `complete`), **Indirect Import**(공개 HTTPS URL을 노션이 대신 내려받음 — 실패 시 `status: "failed"`가 되는 유일한 모드).
  - 파일명은 확장자 포함 **900바이트**까지. content_type을 근거로 확장자가 자동 보정된다.
  - `expiry_time` 의미: **아직 어떤 블록/객체에도 붙지 않은 FileUpload가 만료되는 시각**이다. 한 번이라도 첨부되면 `expiry_time`이 `null`이 되어 영구 보존된다. 즉 만료는 "고아 업로드 GC"용 타이머다.
  - 파일 필드의 3가지 표현:
    - `{type:"external", external:{url}}` — 외부 URL 참조(노션이 호스팅하지 않음).
    - `{type:"file", file:{url, expiry_time}}` — 노션 호스팅. **서명 URL의 유효기간은 1시간**이며 공식 문서가 *"Don't cache or statically reference these URLs"* 라고 명시한다. 만료 후에는 파일 객체(블록/프로퍼티)를 **다시 조회해 새 URL을 받는다**. 정적 사이트 생성기·이미지 CDN에 이 URL을 굽는 것이 가장 흔한 사고다.
    - `{type:"external", external:{url}}`은 **만료되지 않는다** — 장기 참조가 필요하면 이쪽을 쓰라는 것이 공식 가이드다.
    - `{type:"file_upload", file_upload:{id}}` — 업로드 세션 참조(쓰기 전용 입력 형태).
  - `.html` 파일을 업로드해 embed 블록의 소스로 쓸 수도 있다(임의 HTML 호스팅).
- **엣지 케이스**:
  - 빈 값: 0바이트 파일 업로드 → 400 `[추정]`.
  - 중첩: 파트 순서가 어긋나거나 일부 파트 누락 상태로 complete 호출 → 400.
  - 동시편집/재사용: **하나의 `file_upload.id`는 여러 페이지·블록에 재사용할 수 있다**(공식 확인, 초판의 `[확인필요]` 해제). 따라서 스토리지 객체는 **참조 카운트 없이는 절대 삭제하면 안 된다**. 같은 파일을 N개 블록이 공유하는 것이 정상 상태다.
  - 삭제된 참조: 파일이 첨부된 블록을 삭제해도 스토리지 객체는 즉시 삭제되지 않는다 `[추정]` → GC 잡 필요.
  - 권한 없음: 서명 URL은 URL만 알면 접근 가능하므로(bearer 성격) 유출 시 만료까지 노출된다. 짧은 TTL + 워크스페이스 스코프 검증이 필요.
  - 대용량: 무료 5 MiB / 유료 5 GiB의 플랜 상한이 20 MiB multi-part 임계와 교차 적용된다. 5 GiB 파일을 5~20 MiB 파트로 쪼개면 파트가 수백~1,000개가 되므로, **파트 업로드 자체가 재시도·재개(resume) 가능한 잡**이어야 한다(중간 실패 시 전부 다시 올리면 사용자가 포기한다).
  - 순환 참조: 없음(파일은 리프). 다만 `.html` 파일을 업로드해 embed 소스로 쓰는 경로가 있으므로, **그 HTML이 같은 워크스페이스의 다른 페이지를 iframe으로 다시 여는 자기중첩**이 가능하다 → embed 렌더 시 자기 도메인 재귀 임베드 차단이 필요하다 `[추정]`.
- **데이터 모델 함의**: 위 `file_upload` 테이블 + `file_object(id, workspace_id, storage_key, bytes, content_type, checksum, ref_count)`. 참조 카운트를 두어 블록 삭제 시 GC 대상으로 넘긴다. 서명 URL은 저장하지 않고 **조회 시점에 생성**한다(저장하면 만료 관리가 불가능).
- **UI/인터랙션**: 파일 드래그앤드롭, `/image`·`/file` 슬래시 커맨드, 붙여넣기(클립보드 이미지), 업로드 진행률 표시, 실패 시 재시도.
- **의존 기능**: 오브젝트 스토리지(S3 호환), 블록 모델, 권한.
- **구현 난이도**: **M** — S3 presigned multipart upload를 프록시하면 2~4일. 노션처럼 서버 경유 `send` 방식을 쓰면 대역폭 비용이 커지므로 **presigned PUT 직접 업로드**를 권장.
- **우선순위**: **P0** — 이미지 첨부 없는 문서 도구는 성립하지 않는다(단, API 노출은 P1).
- **클론 시 현실적 대안**: 3단계 세션 API 대신 `POST /v1/uploads` 한 번으로 presigned URL을 내려주고 클라이언트가 S3에 직접 PUT → `POST /v1/uploads/{id}/complete`로 검증. 노션 호환이 필요하면 얇은 호환 어댑터만 추가.
- **참고 출처**: https://developers.notion.com/guides/data-apis/uploading-small-files , https://developers.notion.com/guides/data-apis/working-with-files-and-media , https://developers.notion.com/reference/file-upload , https://developers.notion.com/reference/file-object , https://www.notion.com/help/images-files-and-media

---

### F-09-09 Webhook 구독 (verification token + HMAC 서명)

- **한 줄 정의**: 워크스페이스에서 일어난 변경을 통합의 HTTPS 엔드포인트로 밀어 보내는 이벤트 구독 시스템.
- **사용자 시나리오**:
  1. 개발자가 Developer portal에서 웹훅 URL을 등록하고 구독할 이벤트 타입을 체크.
  2. 노션이 그 URL로 **1회성 POST**를 보내 `{"verification_token": "secret_…"}`를 전달.
  3. 개발자가 수신한 토큰을 포털의 입력란에 붙여넣고 Verify subscription 클릭 → 구독 활성화.
  4. 이후 이벤트가 발생하면 노션이 POST를 보내고, 수신 측은 `X-Notion-Signature` 헤더를 검증한 뒤 처리.
- **동작 상세**:
  - `verification_token`은 **엔드포인트 도달성 확인용이자 동시에 이후 모든 이벤트의 서명 비밀키**로 쓰인다(이중 역할).
  - 서명: `X-Notion-Signature: sha256=<hex>` — 요청 본문 전체에 대한 HMAC-SHA256, 키는 verification_token. 검증은 **constant-time 비교**로 해야 타이밍 공격을 막는다. 공식 SDK에 `verifyWebhookSignature()` 헬퍼가 있다.
  - **이벤트 페이로드 봉투(공식 확정)**:

  | 필드 | 타입 | 의미 |
  |---|---|---|
  | `id` | UUID | 이벤트 고유 id — **수신측 dedupe 키** |
  | `timestamp` | ISO 8601 | 이벤트 발생 시각 — **재정렬 키** |
  | `workspace_id` | UUID | 발생 워크스페이스 |
  | `subscription_id` | UUID | 구독 id |
  | `integration_id` | UUID | 연결 id |
  | `type` | string | 이벤트 종류 |
  | `authors` | array | 행위자(person / bot / agent) |
  | `accessible_by` | array | 접근 가능한 사용자·봇 (**public connection 한정**) |
  | `attempt_number` | number | 전달 시도 회차 **1~8** |
  | `entity` | object | 변경된 객체(page / block / database / data_source / comment) |
  | `data` | object | 이벤트별 부가 정보 |

  - **이벤트 타입 전량(공식, 초판의 `[확인필요]` 해제)**:

  | 계열 | 타입 |
  |---|---|
  | Page | `page.created`, `page.content_updated`, `page.properties_updated`, `page.moved`, `page.deleted`, `page.undeleted`, `page.locked`, `page.unlocked` |
  | Database | `database.created`, `database.moved`, `database.deleted`, `database.undeleted`, `database.content_updated`(deprecated), `database.schema_updated`(deprecated) |
  | Data source (2025-09-03 신설) | `data_source.created`, `data_source.content_updated`, `data_source.moved`, `data_source.deleted`, `data_source.undeleted`, `data_source.schema_updated` |
  | Comment | `comment.created`, `comment.updated`, `comment.deleted` |
| **File upload** `[확인필요]` | `file_upload.created`, `file_upload.completed`, `file_upload.expired`, `file_upload.upload_failed` |
| **View** `[확인필요]` | `view.created`, `view.updated`, `view.deleted` |

  > 주의: file_upload / view 계열은 **공식 문서 인덱스(`llms.txt`)에 개별 이벤트 레퍼런스 페이지가 존재**하지만, 상위 "Event types & delivery" 문서의 목록에는 **아직 반영되어 있지 않다**(2026-09-06 확인). 두 문서가 어긋나므로 실제 구독 가능 여부는 포털에서 확인해야 한다. → 초판이 "전량 확인(23종)"으로 단정한 것은 **과잉**이었고, 목록은 버전마다 늘어난다고 보는 편이 맞다.
  > `database.content_updated` / `database.schema_updated`가 deprecated이고 `data_source.*`가 그 자리를 차지한 것은 F-09-01의 3계층 재편과 **정확히 같은 이유**다. 클론이 3계층으로 가면 이벤트 이름도 처음부터 `data_source.*`로 내야 한다.
  - **전달 보증: at-most-once.** 즉 **이벤트는 유실될 수 있다.** 웹훅만으로 상태를 재구성하면 안 되고, 주기적 reconciliation(예: `last_edited_time` 워터마크 재조회)이 반드시 병행되어야 한다. 이것이 초판이 놓친 가장 중요한 사실이다.
  - **순서 보증 없음**: 이벤트가 발생 순서와 다르게 도착할 수 있으므로 수신측이 `timestamp`로 재정렬해야 한다.
  - **지연**: 대부분 1분 이내, **최대 5분 이내** 전달을 목표로 한다.
  - **재시도**: 최대 **8회**, **지수 백오프**, 마지막 재시도는 최초 이벤트로부터 **약 24시간 후**. 시도 회차는 페이로드의 `attempt_number`로 노출된다.
  - **집계(aggregation)**: page/database/data_source 계열 이벤트는 짧은 창 안의 변경을 하나로 묶는다. 집계로 인한 추가 지연은 **통상 1분 미만**. 짧은 시간에 상태가 되돌아오면 **"가장 의미 있는 결과 이벤트 1건만, 또는 아예 0건"** 이 전달된다. **댓글 이벤트는 집계되지 않는다.**
  - 댓글 이벤트 수신에는 comment read capability가 필요하다.
  - 페이로드는 "무엇이 바뀌었는지"의 요약만 담고 **본문 diff는 담지 않는다** → 수신 측이 API로 되읽어야 한다(thin payload 패턴).
- **엣지 케이스**:
  - 빈 값: 이벤트 타입을 하나도 선택하지 않은 구독은 아무것도 받지 못한다.
  - 중첩: 자식 블록 변경이 부모 페이지의 `page.content_updated`로 올라오므로, 한 편집이 여러 구독에 중복 전달될 수 있다 → 수신 측 멱등 처리 필수(`event_id` 기준 dedupe).
  - 동시편집: 여러 사용자가 동시에 편집하면 집계 창 안에서 1건으로 합쳐진다 → "누가 무엇을 바꿨는지"는 웹훅만으로 알 수 없다.
  - 삭제된 참조: 이벤트 수신 후 API로 되읽을 때 대상이 이미 삭제되어 404일 수 있다 → 정상 흐름으로 처리.
  - 권한 없음: 통합에 공유되지 않은 페이지의 이벤트는 발송되지 않는다 `[추정]`. public connection의 경우 페이로드에 `accessible_by`가 실려 "이 이벤트를 누구에게 보여줘도 되는가"를 수신측이 판단할 수 있다 — **멀티테넌트 앱이 이벤트를 잘못된 사용자에게 노출하지 않으려면 이 필드를 반드시 써야 한다.**
  - 대용량/장애: 재시도는 8회·약 24시간에서 끝나고, 그 뒤 자동 비활성화가 일어나는지는 공식 문서에 **명시되어 있지 않다** `[확인필요]`. 구독 이벤트 타입 변경은 연결 페이지의 Webhooks 탭에서 **수동**으로만 가능하다. → 클론은 명시적으로 `status: paused` + 관리자 알림 + 수동 재개를 설계하라(같은 워크스페이스의 automation webhook은 실제로 "실패 시 일시정지 + 수동 재개"로 동작한다 — 08 도메인 F-08-13 참조).
  - 순환 참조: 웹훅을 받고 API로 되쓰면 그 쓰기가 다시 웹훅을 발생시켜 **무한 루프**가 된다. `authors`에 자기 `integration_id`가 들어 있으면 스킵하는 **자기 이벤트 필터**가 필수다(노션이 `authors`를 페이로드에 넣어준 이유이기도 하다) `[추정]`.
- **데이터 모델 함의**: `webhook_subscription`, `webhook_delivery`(위 스키마) + `outbox(event_id, workspace_id, entity_id, type, authors jsonb, payload, created_at, dispatched_at)`. **트랜잭셔널 아웃박스 패턴**이 사실상 필수 — 편집 트랜잭션과 같은 커밋에 이벤트를 기록하고 별도 워커가 발송한다. 집계는 `(subscription_id, entity_id, type)` 키의 debounce 윈도우(노션 실측 기준 **1분 미만**)로 구현하고, `webhook_delivery.attempt`는 1~8로 상한을 두어 페이로드의 `attempt_number`로 그대로 노출한다.
  수신측 계약도 함께 명세하라: **`event.id`로 dedupe, `timestamp`로 재정렬, 유실 대비 reconciliation** 세 가지를 문서에 못 박지 않으면 통합 개발자가 반드시 틀린다.
- **UI/인터랙션**: Developer portal의 웹훅 URL 입력 · 이벤트 체크박스 · verification token 붙여넣기 · Verify 버튼 · 최근 전송 로그와 재전송(replay) 버튼(P2).
- **의존 기능**: 인증/권한(F-09-02), 이벤트 소스(편집 파이프라인), 잡 큐.
- **구현 난이도**: **L** — 아웃박스 + 집계 debounce + 재시도 백오프(8회/24시간) + 서명/검증 + 전송 로그 UI까지 1~2주. 노션조차 **at-most-once**로 타협했다는 사실이 난이도의 증거다(정확히-한-번을 노리면 XL로 뛴다). 클론도 at-most-once + reconciliation 조합을 그대로 택하라.
- **우선순위**: **P2** — 폴링으로 대체 가능하지만, 폴링은 rate limit를 잡아먹는다.
- **클론 시 현실적 대안**: v1은 웹훅 대신 **`last_edited_time` 기반 증분 조회 엔드포인트**(`GET /v1/changes?since=…`)를 제공한다. 구현 비용이 1/5이고 멱등성·재시도 문제를 통째로 회피한다. 웹훅은 v2에서 아웃박스 위에 얹는다.
- **참고 출처**: https://developers.notion.com/reference/webhooks , https://developers.notion.com/reference/webhooks-events-delivery , https://hookdeck.com/webhooks/platforms/guide-to-notion-webhooks-features-and-best-practices

---

### F-09-10 Embed 블록 (외부 콘텐츠 iframe 삽입)

- **한 줄 정의**: 외부 서비스의 인터랙티브 콘텐츠를 페이지 안에서 그대로 조작할 수 있게 iframe으로 삽입하는 블록.
- **사용자 시나리오**:
  1. 빈 줄에서 `/embed` 입력(또는 `+` > Embed) → URL 입력창 표시.
  2. Figma/YouTube URL 붙여넣기 → "Embed link" 클릭.
  3. 블록이 렌더링되고, 호버 시 좌우/하단에 검은 리사이즈 바가 나타남 → 드래그로 크기 조절.
  4. 또는 URL을 페이지에 직접 붙여넣으면 **Dismiss / Create bookmark / Create embed / Mention page** 형태의 선택 메뉴가 뜬다.
  5. 서비스 전용 슬래시 커맨드도 있다: `/youtube`, `/figma`, `/maps`, `/tweet`, `/codepen`, `/loom`, `/miro`, `/drive` 등.
- **동작 상세**:
  - 블록 스키마: `{"type":"embed","embed":{"url":"…"}}` (또는 업로드한 `.html`을 소스로 하는 `file_upload` 변형).
  - 언퍼링은 **Iframely** 서비스에 위임되며, 헬프센터가 *"over 1,900 domains via the Iframely service"* 라고 직접 명시한다(재확인 완료). 그 외 도메인은 원본 URL을 그대로 iframe에 넣는 폴백 `[추정]`.
  - 임베드 URL → 렌더 HTML로 가는 표준 프로토콜은 oEmbed이며, 그 계약을 F-09-18로 분리해 명세했다.
  - Google Drive 등 일부 서비스는 전용 통합 경로가 있어 파일명 검색으로 선택 가능하다.
  - 크기: 대부분 리사이즈 가능. 종횡비를 유지하는 서비스(YouTube 등)와 자유 리사이즈 서비스가 다르다 `[추정]`.
- **엣지 케이스**:
  - 빈 값: URL 없이 만든 embed 블록은 "URL 입력" placeholder 상태로 남는다.
  - 중첩: 컬럼/토글 안에 넣으면 컨테이너 폭에 맞춰 축소된다. 리사이즈 상한이 컨테이너 폭.
  - 동시편집: URL 변경은 블록 프로퍼티 교체 → last-write-wins.
  - 삭제된 참조: 외부 리소스가 삭제되면 iframe이 404/에러 화면을 그린다. 노션은 이를 감지하지 못한다.
  - 권한 없음(중요): **`X-Frame-Options: DENY` 또는 `frame-ancestors` CSP를 설정한 사이트는 "Failed to Load"로 실패한다.** 또한 **외부 사이트 로그인이 필요한 임베드는 데스크톱 앱과 모바일 앱에서 동작하지 않는다**(웹뷰의 서드파티 쿠키 제약).
  - 대용량: 한 페이지에 임베드가 수십 개면 iframe마다 별도 문서 로드 → 렌더 성능 급락. **뷰포트 진입 시 lazy-load + 클릭 시 활성화(façade 패턴)** 가 필수.
- **데이터 모델 함의**: `embed_block` 테이블(위). `unfurl_status`를 두어 실패/미지원을 구분하고, `embed_html`은 TTL 캐시로 관리한다. iframe 렌더는 반드시 `sandbox` 속성 + `allow` 화이트리스트로 제한하고, 임베드 전용 서브도메인(별도 origin)에서 호스팅해 XSS 격리한다.
- **UI/인터랙션**: `/embed`와 서비스별 슬래시 커맨드, 붙여넣기 시 선택 메뉴, 호버 시 리사이즈 핸들, 블록 ••• 메뉴의 "Original URL 열기"/"Caption 추가"/"Turn into bookmark".
- **의존 기능**: 블록 모델, 슬래시 커맨드, 붙여넣기 인터셉트, 언퍼링 서비스(F-09-11과 캐시 공유).
- **구현 난이도**: **M** — iframe 렌더 자체는 쉽고, 비용은 프로바이더별 URL 정규화(YouTube watch→embed 변환 등)와 보안 샌드박싱, 실패 상태 UX.
- **우선순위**: **P1** — MVP엔 없어도 되지만 "문서에 뭐든 넣는다"는 제품 정체성의 핵심.
- **클론 시 현실적 대안**: Iframely(유료 SaaS) 대신 **자체 oEmbed 클라이언트 + 상위 20개 프로바이더 하드코딩**으로 시작한다. oEmbed 디스커버리(`<link rel="alternate" type="application/json+oembed">`) → 없으면 OpenGraph → 없으면 raw iframe 폴백 3단 전략. 프로바이더 목록은 oembed.com의 공개 providers.json(등록 프로바이더 378+)을 시드로 쓴다. 상세 계약은 **F-09-18**.
- **참고 출처**: https://www.notion.com/help/embed-and-connect-other-apps , https://developers.notion.com/reference/block , https://oembed.com/

---

### F-09-11 Bookmark · Link mention · Link Preview (언퍼링 3종)

- **한 줄 정의**: 같은 URL을 목적에 따라 카드형(bookmark) / 인라인형(link mention) / 인증형 실시간 프리뷰(link preview) 세 가지로 다르게 렌더링하는 체계.
- **사용자 시나리오**:
  - **Bookmark**: URL 붙여넣기 → "Create bookmark" 선택 → 제목·설명·파비콘·썸네일이 담긴 카드 블록 생성.
  - **Link mention**: URL 붙여넣기 → "Mention page"/"Create mention" 선택 → 문장 중간에 아이콘+제목의 인라인 칩으로 삽입.
  - **Link Preview**: 지원되는 파트너 서비스(예: 지라, 깃허브 등) URL을 붙여넣으면 노션이 "해당 서비스에 인증하시겠습니까?" 프롬프트 → OAuth 연결 후, 로그인해야만 보이는 데이터가 블록 안에서 실시간으로 갱신된다.
- **동작 상세**:
  - Bookmark 블록 스키마: `{"type":"bookmark","bookmark":{"url":"…","caption":[rich_text]}}`.
  - Link preview 블록 스키마: `{"type":"link_preview","link_preview":{"url":"…"}}` — **읽기 전용이며 API로 생성/추가할 수 없다.**
  - Link Preview 통합을 만들려면: (a) 노션의 Link Preview API 신청 폼으로 접근 승인, (b) **자기 도메인 소유 증명**, (c) OAuth 2.0 지원, (d) **Unfurl Callback URL** 구현 — 노션이 URL을 전달하면 `200 OK`와 함께 `uri` + unfurl attribute 배열을 반환해야 하고, 배열에는 최소 `title` 속성과 제작자를 나타내는 `dev` 속성이 포함되어야 한다.
  - 즉 노션의 언퍼링은 **공개 웹 = Iframely 스크래핑 / 인증 필요 = 도메인 소유자가 콜백 제공**으로 이원화되어 있다. 이 분리는 "노션 서버가 남의 인증 세션을 대신 갖지 않는다"는 보안 설계의 결과다 `[추정]`.
- **엣지 케이스**:
  - 빈 값: 메타데이터가 없는 URL은 제목 자리에 도메인만 표시되는 카드가 된다.
  - 중첩: 인라인 mention은 rich text 런이므로 텍스트 흐름 안에 들어가고, bookmark는 블록이므로 들어갈 수 없다 → 사용자가 둘을 혼동하기 쉬우니 붙여넣기 메뉴의 라벨이 중요하다.
  - 동시편집: 캐시된 메타데이터는 시간이 지나 원본이 바뀌어도 갱신되지 않는다(스냅샷). 갱신 트리거는 사용자 액션 `[확인필요]`.
  - 삭제된 참조: 원본이 404가 되어도 카드에는 옛 제목이 남는다.
  - 권한 없음: 인증형 Link Preview에서 사용자가 대상 서비스 접근 권한을 잃으면 블록은 "접근 불가"로 표시되어야 한다. 같은 페이지를 보는 다른 사용자는 **각자의 인증 상태에 따라 다른 내용을 본다** → 페이지 콘텐츠가 뷰어별로 달라지는 유일한 블록 유형이며, 캐싱 설계 시 반드시 뷰어별로 분리해야 한다.
  - 대용량: 대량 붙여넣기 시 스크래핑이 폭주 → 도메인별 rate limit + 큐잉 필요. SSRF 방어(내부 IP·localhost·메타데이터 엔드포인트 차단)는 필수.
- **데이터 모델 함의**: `link_unfurl_cache`(전역, 공개 URL용) + `link_preview_provider`(도메인 소유자 등록) + `user_link_preview_auth(user_id, provider_id, oauth_token_hash)`(뷰어별). **공개 언퍼 캐시는 전역 공유, 인증형은 절대 공유 금지**.
- **UI/인터랙션**: 붙여넣기 직후 나타나는 인라인 선택 메뉴(Dismiss / Bookmark / Embed / Mention), 블록 ••• > "Turn into" 로 3종 간 상호 변환, 인라인 칩 호버 시 프리뷰 팝오버.
- **의존 기능**: URL 스크래핑 워커, rich text mention(F-09-03), OAuth 클라이언트, 블록 변환 시스템.
- **구현 난이도**: **M**(bookmark/mention) / **XL**(인증형 Link Preview 플랫폼 — 파트너 등록·도메인 검증·콜백 규격·뷰어별 캐시·OAuth 브로커까지 필요).
- **우선순위**: bookmark/link mention **P1**, 인증형 Link Preview **P2**.
- **클론 시 현실적 대안**: 인증형 Link Preview 플랫폼은 만들지 않는다. 대신 **가장 수요가 큰 3~5개 서비스(GitHub, Jira, Figma)를 1급 통합으로 직접 구현**하고, 나머지는 공개 OpenGraph bookmark로 처리한다. 플랫폼화는 파트너가 생긴 뒤에.
- **참고 출처**: https://developers.notion.com/docs/build-a-link-preview-integration , https://www.notion.com/help/link-previews , https://www.notion.com/help/embed-and-connect-other-apps

---

### F-09-12 임포트: 파일 기반 (Markdown / HTML / CSV / DOCX / TXT / ZIP)

- **한 줄 정의**: 로컬 파일을 업로드하면 파싱해 페이지 트리 또는 데이터베이스로 변환하는 비동기 잡.
- **사용자 시나리오**:
  1. 좌측 사이드바 하단의 Import 클릭(또는 페이지 안에서 `/import`).
  2. 소스 선택(Markdown / CSV / HTML / Word / Text / ZIP 또는 서드파티 앱).
  3. 파일 다중 선택 또는 드래그앤드롭.
  4. 진행률 표시 → 완료 시 임포트된 페이지로 이동하는 링크와, 실패 항목 리포트 제공.
- **동작 상세**:
  - 지원 파일 형식: `.txt`, `.md`/`.markdown`, `.docx`, `.csv`, `.html`, `.pdf`, `.zip`.
  - 매핑 규칙:

  | 형식 | 매핑 |
  |---|---|
  | Markdown / TXT | 1 파일 = 1 페이지. 헤딩·리스트·코드블록 변환. **앵커 링크와 비표준 확장(각주 등)은 미지원** |
  | CSV | 1 파일 = 1 데이터베이스. **행 = 페이지, 열 = 프로퍼티**. rollup·formula는 생성되지 않아 임포트 후 수동 재구성 필요 |
  | HTML | 1 파일 = 1 페이지, 태그 → 블록 매핑 |
  | DOCX | 텍스트·헤딩·리스트·이미지·표는 이관. **주석·변경내역(tracked changes)·고급 레이아웃은 미이관** |
  | ZIP | 내부 디렉터리 구조를 페이지 계층으로 복원 |

  - **크기·건수 제한(공식 헬프 원문 재확인, 초판의 `[확인필요]` 해제 및 수치 정정)**:

  | 형식 | 무료 플랜 | 유료 플랜 |
  |---|---|---|
  | Google Docs / Word(.docx) / HTML / Text·Markdown / CSV | **5 MB** | **50 MB** |
  | PDF | **5 MB** | **20 MB** (초판의 "무료 10MB"는 오기) |
  | ZIP | 총 **5 GB**까지. 다만 **파일 10,000개 이상이면 실패하거나 부분 임포트**된다 | 동일 |

  | 처리량 제한 | 값 |
  |---|---|
  | HTML / Markdown / Text 임포트 | **12시간당 약 120건** |
  | Trello | 세션당 최대 **10보드**, 보드당 약 **5,000카드**까지 안정 |
  | Evernote | 약 **5,000노트**까지 안정, 그 이상은 실패 가능 |
  | Google Docs | 대량 배치 시 간헐적 "Import failed" 발생 |

  - **CSV 재임포트는 기존 행을 갱신하지 않고 행을 추가한다**(upsert 아님) — 중복 데이터의 흔한 원인.
- **엣지 케이스**:
  - 빈 값: 0바이트 파일/빈 CSV → 빈 데이터베이스 생성 또는 스킵.
  - 중첩: ZIP 안의 폴더 계층을 페이지 트리로 복원할 때, 같은 이름의 `foo.md`와 `foo/` 디렉터리가 공존하는 노션식 export 구조를 정확히 이해해야 한다(폴더가 그 md 페이지의 자식들). 이 규칙을 놓치면 계층이 평평해진다.
  - 동시편집: 임포트 중 대상 부모 페이지를 다른 사용자가 삭제 → 잡 실패 처리 필요.
  - 삭제된 참조: 마크다운 안의 상대 링크(`./sub/page.md`)를 임포트된 페이지 id로 재작성하는 **2-pass 링크 리라이팅**이 없으면 내부 링크가 전부 깨진다. (1-pass: 페이지 생성 및 경로→id 맵 구축, 2-pass: 본문 링크 치환)
  - 권한 없음: 임포트 대상 부모에 편집 권한이 없으면 시작 자체를 막아야 한다.
  - 대용량: 수천 파일 ZIP은 부분 실패가 정상이다 → **부분 성공(partial) 상태와 실패 항목 리포트**가 필수. 벌크 HTML/Markdown/Text 임포트에는 **12시간당 약 120건**이라는 별도 처리량 한도가 공식 문서에 명시되어 있고, ZIP은 **10,000파일**을 넘기면 실패·부분 임포트가 된다(초판의 `[확인필요]` 해제). ZIP 내 숨김 파일(`__MACOSX`, `.DS_Store`)이 실패 원인이 되는 사례가 보고된다.
  - 순환 참조: 마크다운 상대 링크가 서로를 가리키는 것은 정상이지만, **ZIP 안의 심볼릭 링크나 `../` 경로**는 zip-slip 취약점(압축 해제 시 임의 경로 쓰기)이 되므로 반드시 정규화 후 루트 밖 경로를 거부해야 한다. 2-pass 링크 리라이팅은 방문 집합으로 사이클을 안전하게 처리한다(맵 기반이라 재귀하지 않음).
  - 미이관 항목(형식별, 공식): **Word** = 주석·변경내역·텍스트박스/도형/SmartArt / **Google Docs** = 제안·타인 댓글·구분선·색상·헤더/푸터·코드블록 스타일 / **PDF** = 폰트·배경색·토글·코드블록·콜아웃 / **CSV** = 새 임포트에서 rollup·formula·relation / **HTML·Markdown** = 앵커 링크·비표준 확장·복잡한 스타일·스크립트·임베드.
- **데이터 모델 함의**: `import_job` + `import_item(job_id, source_path, target_page_id, status, error)`. 링크 리라이팅용 `path_to_page_map(job_id, source_path, page_id)`가 필수. 첨부 이미지는 `file_upload` 경로를 재사용한다.
- **UI/인터랙션**: 사이드바 Import 엔트리, 드래그앤드롭 존, 진행률 바, 완료 알림(인앱+이메일), 실패 리포트 다운로드.
- **의존 기능**: 블록/페이지 생성 API, 파일 업로드(F-09-08), 잡 큐, 권한.
- **구현 난이도**: **L** — 포맷 하나당은 M이지만 6개 포맷 + 링크 리라이팅 + 부분 실패 처리로 1~2주 이상.
- **우선순위**: **P1** — 마이그레이션이 곧 신규 사용자 유입 경로다. 그 중 **"노션 export ZIP 임포트"는 노션 클론에게 사실상 P0**(경쟁 제품에서 넘어오는 유일한 실용 경로).
- **클론 시 현실적 대안**: v1은 **Markdown/ZIP 두 개만** 지원하고, 노션 export ZIP 구조(md + 동명 폴더 + 이미지 폴더 + 파일명 뒤 32자 hex id)를 정조준한다. DOCX는 pandoc/mammoth, HTML은 turndown, CSV는 표준 파서로 위임한다. Docmost가 v0.21.0에서 ZIP/Notion/Confluence 임포트를 넣은 방식이 그대로 참고 가능하다.
- **참고 출처**: https://www.notion.com/help/import-data-into-notion (크기·건수 제한표, 형식별 미이관 항목 재확인) , https://docmost.com/docs/user-guide/import-export

---

### F-09-13 임포트: 서드파티 앱 (Evernote / Trello / Confluence / Google Docs 등)

- **한 줄 정의**: 외부 SaaS 계정을 OAuth로 연결하거나 해당 앱의 export 파일을 받아, 그 앱의 개념 모델을 노션의 page/database 모델로 사상하는 마이그레이션 경로.
- **사용자 시나리오**: Import > Evernote 선택 → Evernote 계정 인증 → 가져올 노트북 선택 → 임포트 실행 → 노트북별 데이터베이스가 생성되고 노트가 행으로 들어온다.
- **동작 상세**: 헬프센터가 **직접 앱 연동**으로 나열하는 소스는 Evernote, Trello, Quip, Dropbox Paper, Hackpad, Google Docs, WorkFlowy이며, Confluence·Asana·Monday.com은 별도 안내/파일 경로로 다뤄진다 `[확인필요]`(초판은 이 둘을 구분 없이 묶어 서술했다). 개념 매핑:

  | 소스 | 매핑 규칙 | 제약 |
  |---|---|---|
  | Evernote | 노트북 → 페이지(리스트/갤러리 뷰의 DB), 노트 → DB 아이템 | 약 **5,000노트**까지 안정(공식 확인), Teams 기능 미이관, 이미지가 정상 렌더되지 않을 수 있음 |
  | Trello | 보드 → 데이터베이스, 카드 → 아이템, 리스트 → **그룹(group by)** | 보드당 약 **5,000카드**, **세션당 10보드**(공식 확인), Power-Up·자동화·권한 미이관 |
  | Google Docs | 1 문서 → 1 페이지 | 제안(suggestion)·타인 댓글·구분선·색상·복잡한 레이아웃·헤더/푸터·코드블록 스타일 미이관 |
  | Confluence / Asana / Monday | 전용 문서 별도 존재 | 상세 미확인 `[확인필요]` |

- **엣지 케이스**:
  - 빈 값: 빈 노트북/보드 → 빈 데이터베이스가 생성된다.
  - 중첩: Trello 리스트를 "그룹"으로 사상하는 것처럼, **소스의 1차원 축을 노션의 뷰 설정으로 흡수**하는 것이 핵심 기법이다. 이걸 컬럼(select 프로퍼티)으로만 만들고 group by를 안 걸면 사용자가 "구조가 사라졌다"고 느낀다.
  - 동시편집: 임포트 중 소스 앱에서 데이터가 바뀌면 스냅샷 시점 불일치. 재실행은 중복을 만든다(upsert 없음).
  - 삭제된 참조: 소스의 첨부 파일이 만료 URL이면 다운로드 실패 → 항목별 부분 실패.
  - 권한 없음: OAuth 스코프가 부족하면 일부 컬렉션만 보인다. 사용자에게 "N개 중 M개만 접근 가능"을 명시해야 한다.
  - 대용량: 소스 API의 rate limit이 병목. 재개 가능한(resumable) 잡 설계가 필요하다.
- **데이터 모델 함의**: `import_job` 확장 — `source_account_id`(연결된 OAuth 계정), `cursor_state jsonb`(재개 지점), `id_map(job_id, source_kind, source_id, target_id)`. `id_map`은 재실행 시 중복 방지(upsert)의 근거가 되므로 처음부터 넣는다(노션이 이걸 안 해서 CSV 재임포트가 중복을 만든다).
- **UI/인터랙션**: 소스 선택 그리드, OAuth 팝업, 대상 선택 체크박스 트리, 진행률, 완료 요약(성공/실패/스킵 개수).
- **의존 기능**: OAuth 클라이언트 프레임워크, 잡 큐, 데이터베이스/뷰 모델(그룹화 지원), F-09-12의 공통 파이프라인.
- **구현 난이도**: **XL** — 소스 앱 1개당 L에 가깝고, 각 앱 API가 계속 바뀌어 유지보수 비용이 영구적이다.
- **우선순위**: **P2** — 단, 타깃 사용자가 특정 도구에서 넘어온다면 그 하나만 P1.
- **클론 시 현실적 대안**: 앱 직접 연동은 **하지 않는다**. 각 앱의 **export 파일을 받는 방식**으로 통일하면(Evernote `.enex`, Trello JSON, Confluence XML/HTML zip, 노션 export zip) OAuth·rate limit·API 변경 대응이 전부 사라진다. 실제로 Outline은 Confluence/Notion/Word/Markdown/JSON export 파일 임포트 방식을 택했다.
- **참고 출처**: https://www.notion.com/help/import-data-into-notion , https://docs.getoutline.com/s/guide/doc/import-D2ZvLqz411

---

### F-09-14 익스포트: Markdown&CSV / HTML / PDF, 페이지 및 워크스페이스 전체

- **한 줄 정의**: 페이지 서브트리 또는 워크스페이스 전체를 선택한 포맷으로 직렬화해 ZIP으로 내려받게 하는 비동기 잡.
- **사용자 시나리오**:
  - 페이지 단위: 페이지 우상단 ••• > Export → Export format 드롭다운(PDF / HTML / Markdown & CSV) → 옵션 선택(Include content, Include subpages, Create folders for subpages, Page format, Scale) → Export 클릭 → ZIP 다운로드.
  - 워크스페이스 전체: Settings > (관리자) Export all workspace content → 포맷 선택 → 처리 완료 후 **이메일로 다운로드 링크 수신**.
- **동작 상세**:
  - 포맷별 산출물:

  | 포맷 | 산출 구조 | 옵션 |
  |---|---|---|
  | Markdown & CSV | 페이지당 `.md` 1개, 풀페이지 데이터베이스당 `.csv` 1개, 자식 페이지는 부모 옆의 동명 폴더에, 첨부는 페이지별 폴더에 | Include subpages |
  | HTML | zip된 HTML + 서브페이지 폴더, **댓글 포함 가능**, 워크스페이스 export에는 `index.html` 사이트맵 포함 | Include subpages, 댓글 포함 |
  | PDF | 페이지 레이아웃 보존 | Include content(everything / no files), Page format(용지 크기), Scale(%), Include subpages |

  - **플랜 제약**: PDF의 "Include subpages"는 Business/Enterprise에서만 가능. HTML/Markdown&CSV export는 모든 플랜에서 가능.
  - 워크스페이스 export 처리 시간은 **최대 30시간**, 다운로드 링크는 **7일 후 만료**된다고 명시되어 있다.
  - 미이관 항목: 폼(form) 뷰 데이터베이스는 export 불가(테이블 뷰로 export해야 함), **요청자가 접근 권한이 없는 페이지(타인의 private 페이지 등)는 제외되며, 팀스페이스 설정에 따라 추가로 제외될 수 있다**(공식 명시), 커스텀 이모지는 PDF에 나타나지 않음, 풀페이지 데이터베이스는 직접 인쇄 불가.
  - **Admin API를 통한 워크스페이스 export 자동화가 실재한다(공식 확인)**: Enterprise 플랜 조직에 한해, **organization owner가 admin bot과 토큰을 먼저 구성**한 뒤 API로 워크스페이스 export를 시작하고 완료 상태를 조회할 수 있다. 현재 **beta**로 표기되어 있다. 상세는 F-09-20.
  - 내부적으로는 비공개 API의 잡 큐(`enqueueTask`에 `exportBlock` 이벤트를 넣고 `blockId`, `recursive`, `exportType`(markdown/html/pdf), `timeZone`을 지정 → 폴링으로 태스크 상태와 결과 ZIP URL 획득)로 동작하는 것으로 커뮤니티 도구들이 역공학해 사용해 왔다 `[확인필요]`(비공식 경로).
  - **정정(초판 오류)**: 초판은 "공개 API로는 export 엔드포인트가 제공되지 않는다"고 단정했으나, 2026년 기준 **공개 문서에 두 개의 합법 export 경로가 존재**한다.
    1. **페이지 단위**: `GET /v1/pages/{id}/markdown` (공식 레퍼런스에 플랜 제한 명시 없음. read content capability만 요구 `[확인필요]` — 일부 2차 출처는 public connection 전용이라 주장) — 본문을 Notion-flavored Markdown 문자열로 바로 받는다(F-09-22). ZIP도 잡 큐도 필요 없다. 단 **약 20,000 블록 상한과 `truncated` 플래그**가 있고, bookmark/embed/link_preview 등이 `<unknown>`으로 내려오므로 **완전한 백업은 아니다**.
    2. **워크스페이스 단위(Enterprise)**: Admin API의 **`POST /v1/spaces/{space_id}/exports`**(스코프 `workspace:export`) + 상태 조회 엔드포인트. `export_type`(html/markdown/pdf)과 **`on_behalf_of_user_email`이 필수**이고 응답은 `{export_job_id, status}`다. 상세는 F-09-20.
    → 즉 **백업 자동화는 더 이상 비공식 해킹이 아니고, 다만 전체 워크스페이스 export가 Enterprise에 게이팅되어 있다.** 클론은 이 게이팅을 풀어 전 플랜에 `POST /v1/exports` → 폴링 → 서명 URL 3단계를 제공하는 것만으로 명확한 차별점을 만든다.
- **엣지 케이스**:
  - 빈 값: 빈 페이지도 빈 `.md` 파일로 생성된다.
  - 중첩: `Include subpages`를 끄면 하위 트리가 통째로 빠진다 — "export가 정상인 줄 알았는데 대부분이 없는" 가장 흔한 사고. 기본값을 **켬**으로 두는 것이 안전하다.
  - 동시편집: export 진행 중 편집된 내용은 스냅샷 시점에 따라 포함 여부가 달라진다.
  - 삭제된 참조: 내부 링크는 상대 경로로 재작성되어야 하고, export 범위 밖 페이지로의 링크는 원본 URL(웹 링크)로 남겨야 한다. 이 분기를 안 하면 깨진 링크가 대량 발생한다.
  - 권한 없음: 요청자가 볼 수 없는 페이지는 서브트리에서 제외되며(공식 확인: 타인의 private 페이지, 팀스페이스 설정에 따른 제외), 노션은 **그 사실을 산출물에 표시하지 않는다** → 백업이라 믿었는데 구멍이 있는 상태가 된다. **클론은 export ZIP 안에 `_export_report.json`(제외된 페이지 수·사유)을 반드시 동봉하라.** 비용 대비 신뢰 효과가 가장 큰 개선점이다.
  - 순환 참조: 페이지 A가 B를, B가 A를 링크하는 상호 참조는 정상이며, 상대 경로 재작성은 "경로→파일명" 맵을 먼저 만든 뒤 치환하는 2-pass라 무한 루프가 없다. 다만 **synced block과 linked database view**는 같은 원본을 여러 위치에서 렌더하므로, 재귀 직렬화 시 방문 집합이 없으면 무한 전개된다 `[추정]`.
  - 대용량: 수 GB ZIP은 메모리에 올릴 수 없다 → **스트리밍 ZIP 생성 + 오브젝트 스토리지 직접 쓰기**가 필수. PDF 렌더링(헤드리스 브라우저)은 페이지당 수백 ms~수 초라 전체 워크스페이스에서는 별도 워커 풀과 타임아웃이 필요하다.
- **데이터 모델 함의**: `export_job` + `export_item(job_id, page_id, rel_path, bytes, status)`. 파일명 충돌 해결 규칙(동명 페이지 → 접미사에 id 일부 부착)을 명세로 고정해야 임포터가 역파싱할 수 있다. 다운로드는 만료 있는 서명 URL로만 제공.
- **UI/인터랙션**: ••• > Export 모달(포맷 드롭다운 + 토글 + 셀렉트), 진행 상태 토스트, 완료 시 이메일 + 인앱 알림, 만료 안내 문구.
- **의존 기능**: 블록→마크다운/HTML 직렬화기(F-09-03의 역방향), 권한 필터링, 잡 큐, 오브젝트 스토리지, PDF는 헤드리스 브라우저.
- **구현 난이도**: **L**(Markdown/HTML) / **XL**(PDF 포함 — 폰트·페이지 나눔·이모지·표 넘침까지 맞추려면 별도 프로젝트).
- **우선순위**: **P0**(Markdown export) — **데이터 락인 없음은 신뢰의 최소 조건이며, 자체 임포터의 테스트 픽스처이기도 하다.** HTML은 P1, PDF는 P2.
- **클론 시 현실적 대안**: v1은 Markdown&CSV ZIP만 구현하고, **노션의 export ZIP 레이아웃을 그대로 채택**한다(생태계 도구들이 이미 그 구조를 파싱한다). PDF는 v2에서 `print to PDF`(브라우저 인쇄 CSS) → 그 다음 헤드리스 Chromium 순으로 승격. 워크스페이스 전체 export는 페이지 단위 잡을 팬아웃해 재사용.
- **참고 출처**: https://www.notion.com/help/export-your-content (30시간·7일·플랜 제약 재확인) , https://www.notion.com/help/back-up-your-data , https://developers.notion.com/reference/admin/enqueue-space-export (워크스페이스 export 엔드포인트·파라미터 확인) , https://developers.notion.com/reference/retrieve-page-markdown , https://github.com/jamalex/notion-py

---

### F-09-15 공식 SDK · 개발자 온보딩 표면

- **한 줄 정의**: API를 쓰기 위한 언어별 클라이언트 라이브러리와, 최초 성공까지의 경로(포털·문서·플레이그라운드).
- **사용자 시나리오**: 개발자가 `npm i @notionhq/client` → `new Client({auth: token})` → `notion.pages.create({...})` 로 타입 안전한 호출. 웹훅 검증은 SDK의 `verifyWebhookSignature()` 사용.
- **동작 상세**:
  - 공식 JavaScript/TypeScript SDK(`@notionhq/client`)의 **실제 공개 표면(저장소 재확인, 초판의 `[확인필요]` 해제)**:

  | 분류 | 심볼 | 용도 |
  |---|---|---|
  | 페이지네이션 | `iteratePaginatedAPI(listFn, firstPageArgs)` | 페이지를 필요할 때마다 읽는 async iterator |
  | 페이지네이션 | `collectPaginatedAPI(listFn, firstPageArgs)` | 전체를 배열로 수집(대형 DB에서 OOM 위험) |
  | 데이터소스 | `iterateAllDataSourceRows(client, args)` | **10,000행 상한을 넘겨 전체 행을 읽기 위한 전용 헬퍼** |
  | 데이터소스 | `collectAllDataSourceRows(client, args)` | 위의 수집형 |
  | 웹훅 | `verifyWebhookSignature({body, signature, verificationToken})` | 서명 검증 |
  | 웹훅 | `signWebhookPayload({body, verificationToken})` | 테스트용 서명 생성 |
  | 에러 | `APIResponseError`(`.code`), `isNotionClientError(e)`, `APIErrorCode`, `ClientErrorCode` | 에러 분기 |
  | 클라이언트 옵션 | `auth`, `notionVersion`(기본 **`2025-09-03`**, `2026-03-11` 지원), `timeoutMs`, `logLevel`(기본 WARN), `logger` | 생성자 |

  - 요구 런타임: **Node.js ≥ 18**, TypeScript ≥ 5.9(선택).
  - **주목할 점**: SDK가 `iterateAllDataSourceRows`라는 별도 헬퍼를 두었다는 것은 **API 계약 자체에 결함(10,000행 상한)이 있어 클라이언트가 우회해야 한다**는 뜻이다. 클론은 이 상한을 서버에서 해결해 SDK가 단순해지도록 설계하라.
  - 커뮤니티 SDK: Python(`notion-sdk-py`, 공식 SDK의 미러 설계), Go, Ruby 등.
  - 개발자 포털에서 connection 생성/capability 설정/웹훅 등록/시크릿 회전/PAT 발급을 수행한다.
  - Notion MCP 서버가 별도로 존재해 LLM 에이전트가 API를 도구로 호출할 수 있다 → **F-09-19로 분리 명세**(초판의 `[확인필요]` 해제).
- **엣지 케이스**:
  - 빈 값: 토큰 없이 클라이언트를 만들면 첫 호출에서 401.
  - 중첩: SDK 타입이 블록 다형 유니온이라, 언어에 따라 좁히기(narrowing) 헬퍼가 없으면 사용성이 나쁘다.
  - 동시편집: SDK에 재시도 로직이 내장되어 있어도 429 백오프는 애플리케이션 레벨 조율이 필요하다.
  - 삭제된 참조: SDK가 404를 예외로 던지는지 결과로 반환하는지에 따라 호출 코드 구조가 달라진다.
  - 권한 없음: `APIResponseError`의 `code` 필드로 분기하게 만들어야 한다.
  - 대용량: 페이지네이션 헬퍼가 전체를 메모리에 모으면 대형 DB에서 OOM → 반드시 async iterator 형태 제공.
- **데이터 모델 함의**: 없음(클라이언트 측). 다만 **OpenAPI 스펙을 단일 소스로 두고 SDK와 문서를 생성**하는 파이프라인이 있으면 API 변경 시 드리프트가 사라진다.
- **UI/인터랙션**: 개발자 포털(연결 목록, 시크릿 표시/회전, capability 체크박스, 웹훅 등록), 문서 사이트의 "Try it" 콘솔.
- **의존 기능**: F-09-01~05 전부.
- **구현 난이도**: **M** — OpenAPI 스펙만 정확히 쓰면 SDK는 생성기로 대부분 해결(2~4일). 손으로 쓰면 L.
- **우선순위**: **P2** — API 자체보다 뒤. 단 OpenAPI 스펙 작성은 API 구현과 **동시에** P1으로 진행해야 한다.
- **클론 시 현실적 대안**: 직접 SDK를 쓰지 말고 **OpenAPI 3.1 스펙 → `openapi-typescript` / `openapi-python-client`로 생성**. 문서는 Scalar/Redoc으로 같은 스펙에서 렌더. MCP 서버는 OpenAPI에서 자동 생성하는 도구로 커버.
- **참고 출처**: https://github.com/makenotion/notion-sdk-js (헬퍼명·시그니처·기본 notionVersion 재확인) , https://developers.notion.com/reference/getting-started , https://ramnes.github.io/notion-sdk-py/reference/api_endpoints/

---

### F-09-16 Data source query (필터 · 정렬 DSL과 10,000행 상한)

- **한 줄 정의**: 데이터소스의 행(page)을 조건·정렬·페이지네이션으로 조회하는, 사실상 이 API의 유일한 "쿼리 언어".
- **사용자 시나리오**:
  1. `GET /v1/databases/{id}` → `data_sources[]`에서 대상 data_source_id 획득.
  2. `POST /v1/data_sources/{id}/query`에 `{"filter":{"and":[{"property":"Status","status":{"equals":"Done"}},{"property":"Due","date":{"past_week":{}}}]},"sorts":[{"property":"Due","direction":"ascending"}],"page_size":100}` 전송.
  3. 응답의 `has_more`/`next_cursor`로 순회.
  4. `request_status.type == "incomplete"`이면 10,000행 상한에 걸린 것 → `created_time` 윈도우를 잘라 재질의.
- **동작 상세**:
  - 요청 body 파라미터: `filter`, `sorts[]`, `start_cursor`, `page_size`, `is_archived`(기본 `false`), `result_type`(`"page"`|`"data_source"`).
  - **필터 DSL은 "프로퍼티 타입 → 허용 연산자" 매핑표**다. 이 표가 곧 구현 명세다:

  | 프로퍼티 타입 | 연산자 |
  |---|---|
  | title / rich_text / url / email / phone_number | `equals`, `does_not_equal`, `contains`, `does_not_contain`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
  | number / unique_id | `equals`, `does_not_equal`, `greater_than`, `less_than`, `greater_than_or_equal_to`, `less_than_or_equal_to`, `is_empty`, `is_not_empty` |
  | checkbox | `equals`, `does_not_equal` |
  | select / status | `equals`, `does_not_equal`, `is_empty`, `is_not_empty` |
  | multi_select | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` |
  | date / created_time / last_edited_time | `equals`, `before`, `after`, `on_or_before`, `on_or_after`, `this_week`, `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year`, `is_empty`, `is_not_empty` |
  | people / created_by / last_edited_by | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` |
  | relation | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` |
  | formula | 출력 타입별 중첩 필터(`string`/`checkbox`/`number`/`date`) |
  | rollup | `any` / `none` / `every` + 하위 필터, 또는 number·date 조건 직접 적용 |

  - **compound filter**: `{"and":[...]}` / `{"or":[...]}`가 재귀 중첩 가능하며, 배열은 `maxItems: 100`.
  - **정렬**: `{"property":"…","direction":"ascending"|"descending"}` 또는 `{"timestamp":"created_time"|"last_edited_time","direction":…}`. 배열 순서가 정렬 우선순위.
  - **10,000행 상한(핵심)**: 한 쿼리는 최대 10,000행까지만 페이지네이션된다. 상한 도달 시 `has_more`가 `false`가 되면서 `request_status: {"type":"incomplete","incomplete_reason":"query_result_limit_reached"}`가 실린다. **즉 "커서가 끝나면 다 읽은 것"이라는 가정이 틀린다** — 정상 종료와 절단 종료를 `request_status`로 구분해야 한다.
  - **공식 권장 윈도잉 전략**: `created_time` **오름차순** 정렬로 시간 윈도우를 잘라 반복 질의한다. 공식 문서가 `last_edited_time`을 쓰지 말라고 명시하는 이유는 *"created_time never changes, so windows stay stable. last_edited_time shifts as rows are edited, which moves rows between windows and causes gaps or duplicates"* 이다. 윈도우 경계의 동일 timestamp 행은 **row id로 dedupe**한다.
  - JS SDK v5.23.0+ 의 `iterateAllDataSourceRows` / `collectAllDataSourceRows`가 이 윈도잉을 감싼다.
  - 응답 봉투: `{"object":"list","type":"page_or_data_source","page_or_data_source":{},"results":[…],"next_cursor","has_more","request_status"}`.
- **엣지 케이스**:
  - 빈 값: `filter` 생략 = 전체 행. 결과 0건도 200 + `results: []`.
  - 중첩: `and`/`or`는 재귀 중첩되지만 배열당 100개 상한 — UI 필터 빌더가 만들 수 있는 트리보다 API 상한이 먼저 걸릴 수 있으므로, 클론은 **필터 트리 직렬화 시 노드 수를 세어 사전 검증**하라.
  - 동시편집: 커서 순회 중 행이 추가/삭제/정렬키 변경되면 중복·누락이 발생한다(스냅샷 격리 아님). `created_time` 윈도잉이 그나마 안정적인 이유가 이것이다.
  - 삭제된 참조: `is_archived: true`로만 휴지통 행을 조회한다. relation 필터의 대상 페이지가 삭제되면 `contains` 조건이 조용히 실패(0건)한다 `[추정]`.
  - 권한 없음: 통합에 공유되지 않은 행은 필터 결과에서 **조용히 제외**된다. 따라서 "count"를 이 API로 신뢰할 수 없다.
  - 대용량: 10,000행 상한 + page_size 100 → 10,000행 읽는 데 최소 100요청, 연결당 3 rps에서 33초 이상. 100만 행 데이터소스의 풀 싱크는 이 경로가 아니라 export(F-09-14) 또는 웹훅 증분(F-09-09)이 정답이다.
  - 순환 참조: rollup이 relation을 타고 다른 데이터소스를 참조하고 그쪽 rollup이 되돌아오면 계산 사이클이 생긴다 → 스키마 저장 시 **rollup 의존 그래프에서 사이클 검출**이 필요하다 `[추정]`(노션 UI는 순환 rollup 생성을 막는 것으로 보이나 API 레퍼런스에 명시 없음).
- **데이터 모델 함의**:
  ```sql
  data_source(id uuid pk, database_id uuid, workspace_id uuid,
              name text, schema_version int, in_trash bool)
  data_source_property(                     -- = 컬럼 정의
    data_source_id uuid, property_id text,  -- URL-safe 단축 id, 이름 변경에도 불변
    name text, type text, config jsonb,     -- select options / relation target / rollup spec
    primary key(data_source_id, property_id))
  page_property_value(                      -- 행 × 컬럼 값 (F-09-17)
    page_id uuid, property_id text, type text, value jsonb,
    num_value numeric, text_value text, date_start timestamptz, date_end timestamptz,
    primary key(page_id, property_id))
  ```
  **필터 DSL → SQL 컴파일이 이 기능의 전부다.** 값이 jsonb 한 컬럼에 있으면 인덱스가 안 먹으므로, `number`/`date`/`text`는 위처럼 **타입별 사이드카 컬럼으로 승격**하고 `(data_source_id, property_id, num_value)` 등 부분 인덱스를 건다. formula/rollup은 값 컬럼에 **머티리얼라이즈**해 두지 않으면 필터가 전 행 스캔이 된다.
- **UI/인터랙션**: 없음(프로그래매틱). 다만 제품 UI의 뷰 필터·정렬 빌더가 **같은 DSL을 직렬화**하도록 설계하면 뷰 정의와 API 쿼리가 한 벌로 관리된다(노션도 view 객체가 같은 필터 구조를 쓴다 `[추정]`).
- **의존 기능**: F-09-01(리소스 표면), F-09-04(커서), F-09-17(프로퍼티 값 스키마), database→data_source 3계층 모델.
- **구현 난이도**: **L/XL** — 연산자 표 자체는 기계적이지만, (a) 필터 트리 → 파라미터화 SQL 컴파일러(SQL injection 안전), (b) formula/rollup 값의 머티리얼라이즈 및 무효화, (c) 10,000행류 절단 상태의 명시적 표현까지 하면 2주를 넘긴다. **formula/rollup 필터를 지원하는 순간 난이도가 한 단계 뛴다** — 계산 컬럼을 필터에 쓰려면 계산 엔진이 쿼리 이전에 수렴해 있어야 하기 때문이다.
- **우선순위**: **P1** — 데이터베이스 기능을 API로 노출하는 순간 P0. 반대로 문서 전용 MVP라면 미룰 수 있다.
- **클론 시 현실적 대안**: v1은 **연산자를 절반으로 줄인다**(`equals`/`contains`/비교 4종/`is_empty` + `and` 1단, `or` 미지원). 상한은 10,000행 대신 **`request_status` 필드를 처음부터 넣고 상한 수치를 설정값으로** 둔다(노션은 이 필드를 나중에 넣느라 SDK 헬퍼로 우회해야 했다). formula/rollup 필터는 v2로 미루되 응답에는 값을 실어 클라이언트 필터링이 가능하게 한다.
- **참고 출처**: https://developers.notion.com/reference/query-a-data-source , https://developers.notion.com/reference/filter-data-source-entries , https://developers.notion.com/reference/sort-data-source-entries , https://developers.notion.com/guides/data-apis/query-large-data-sources

---

### F-09-17 Page property value 스키마 & property item 엔드포인트

- **한 줄 정의**: 데이터베이스 행(page)의 각 컬럼 값이 API에서 어떤 JSON으로 직렬화되는지의 계약과, 25개를 넘는 참조를 읽기 위한 별도 페이지네이션 경로.
- **사용자 시나리오**: 통합이 `GET /v1/pages/{id}`로 행을 읽었더니 `relation` 프로퍼티에 `has_more: true`가 붙어 있다 → `GET /v1/pages/{page_id}/properties/{property_id}`를 커서로 순회해 전체 관계 목록을 확보한다.
- **동작 상세**:
  - 페이지 객체의 `properties`는 `{ "<프로퍼티 이름>": { "id": "<short id>", "type": "<타입>", "<타입>": <값> } }` 형태의 맵이다.
  - `id`는 **URL 인코딩된 짧은 문자열이며 프로퍼티 이름이 바뀌어도 불변**이다 → 통합은 반드시 이름이 아니라 `id`를 저장해야 한다(이름으로 저장하면 사용자가 컬럼명을 바꾸는 순간 전부 깨진다).
  - 값 타입별 형태(공식 레퍼런스 기준):

  | 타입 | JSON 값 | 쓰기 가능 | 비고 |
  |---|---|---|---|
  | `title` | `[rich_text]` | O | 인라인 참조 최대 25 |
  | `rich_text` | `[rich_text]` | O | 채워진 인라인 참조 최대 25 |
  | `number` | `1234` \| `null` | O | |
  | `checkbox` | `true`/`false` | O | |
  | `select` | `{id,name,color}` \| `null` | O | 없는 이름을 보내면 옵션 자동 생성 `[확인필요]` |
  | `multi_select` | `[{id,name,color}]` | O | 옵션 100개 상한(F-09-05) |
  | `status` | `{id,name,color}` | O | 옵션 그룹(To-do/In progress/Complete)에 속함 |
  | `date` | `{start,end,time_zone}` | O | ISO 8601 |
  | `people` | `[user]` | O | **25명 초과 시 property item 엔드포인트 필요** |
  | `files` | `[file_object]` | O | F-09-08의 3변형 |
  | `url` / `email` / `phone_number` | 문자열 \| `null` | O | email·phone 200자 |
  | `relation` | `[{id}]` + `has_more` | O | **25개 초과 시 `has_more: true`** |
  | `formula` | `{type, <type>: value}` | X(계산) | 인라인 참조 25 상한 |
  | `rollup` | `{type, function, <type>: value}` | X(계산) | 25개 초과 시 property item 필요 |
  | `unique_id` | `{number, prefix}` | X(자동 증가) | |
  | `created_time` / `last_edited_time` | ISO 8601 | X | |
  | `created_by` / `last_edited_by` | user 객체 | X | |
  | `verification` | `{state, verified_by, date}` | 부분 | |

  - **지원되지 않는 타입은 값이 `null`로 내려오고, 업데이트 요청에서는 아예 빼야 한다.**
  - `GET /v1/pages/{page_id}/properties/{property_id}`:
    - 단순 프로퍼티 → `{"object":"property_item", "type":…, …}` 단건.
    - **페이지네이션되는 프로퍼티는 `title`, `rich_text`, `relation`, `people` 4종** → `{"object":"list","type":"property_item","property_item":{…},"results":[…],"has_more","next_cursor"}`.
    - rollup은 집계값 + 대상 relation을 함께 돌려주며 커서로 순회한다. **`show_unique`, `unique`, `median` 집계는 이 엔드포인트에서 계산되지 않고** property item 리스트로만 반환된다(클라이언트가 직접 집계해야 함).
- **엣지 케이스**:
  - 빈 값: 값 해제는 빈 문자열이 아니라 `null`. `multi_select: []`는 "모두 제거"의 정상 표현.
  - 중첩: `rollup` → `relation` → 대상 페이지의 `formula` → 또 다른 `rollup`으로 이어지는 **계산 체인**이 존재한다. 한 행을 읽으려면 체인 전체가 수렴해 있어야 한다.
  - 동시편집: `PATCH /v1/pages/{id}`의 properties 갱신은 **프로퍼티 단위 교체**(맵 머지)라, 같은 프로퍼티를 두 통합이 동시에 쓰면 last-write-wins. 특히 `multi_select`/`relation`은 **배열 통째 교체**라 "하나만 추가" 의도가 다른 쪽 추가분을 지운다 — 클론은 `{"append":[…]}`/`{"remove":[…]}` 델타 연산을 추가 제공하면 이 사고를 막는다.
  - 삭제된 참조: relation이 가리키던 페이지가 휴지통으로 가면 배열에서 빠지거나 접근 불가 항목이 된다 `[확인필요]`. rollup 값은 그에 맞춰 재계산되어야 한다.
  - 권한 없음: 통합이 relation **대상** 데이터소스에 접근 권한이 없으면 id는 보이되 대상 페이지 조회는 404가 된다 → "id는 있는데 못 읽는" 상태를 UI/통합이 정상 처리해야 한다 `[추정]`.
  - 대용량: 25 참조 임계가 **읽기 경로를 둘로 쪼갠다**. 순진한 클라이언트는 `has_more`를 무시하고 25개만 동기화해 조용히 데이터를 잃는다 — 이 도메인에서 가장 흔한 침묵 버그다.
  - 순환 참조: A의 rollup이 B를, B의 rollup이 A를 참조하면 무한 재계산. 스키마 변경 시 **의존 그래프 위상정렬 + 사이클 거부**가 필요하다.
- **데이터 모델 함의**: F-09-16의 `page_property_value` + 아래 보조 테이블.
  ```sql
  page_relation(from_page_id uuid, property_id text, to_page_id uuid, seq int,
                primary key(from_page_id, property_id, to_page_id))   -- 배열을 행으로 정규화
  property_dependency(data_source_id uuid, property_id text,
                      depends_on_ds uuid, depends_on_prop text)       -- formula/rollup 위상정렬용
  property_computed_cache(page_id uuid, property_id text, value jsonb,
                          computed_at timestamptz, dirty bool)
  ```
  relation을 jsonb 배열로 두면 25개 임계 페이지네이션과 역방향 조회(백링크)를 둘 다 못 한다 → **반드시 행으로 정규화**. 계산 프로퍼티는 `dirty` 플래그 + 위상정렬 워커로 무효화 전파.
- **UI/인터랙션**: 없음(직렬화 계약). 대응하는 UI는 데이터베이스 테이블의 셀 편집기(타입별 위젯).
- **의존 기능**: 데이터베이스 프로퍼티 스키마, formula 엔진, rollup 계산기, 사용자·파일 모델, F-09-04.
- **구현 난이도**: **L/XL** — 값 20여 종의 직렬화만이면 L이지만, **formula/rollup의 계산·무효화·순환 검출을 포함하면 XL**이다(이 부분은 별도 도메인 문서의 formula 엔진과 같은 비용). 25 참조 페이지네이션 경로는 그 위의 추가 M.
- **우선순위**: **P1**(값 직렬화) / **P2**(property item 페이지네이션 — 25개 초과가 실제로 나오기 전까지는 미룰 수 있다. 단 `has_more` 필드는 **v1부터 응답에 넣어라**, 나중에 추가하면 클라이언트가 이미 25개만 읽는 코드를 굳혀 놓는다).
- **클론 시 현실적 대안**: v1 타입을 `title/rich_text/number/select/multi_select/date/checkbox/url/people/relation/created_time/last_edited_time` 12종으로 줄인다. formula/rollup은 **읽기 전용 파생값으로만 노출**하고 필터·정렬 대상에서는 제외하면 계산 엔진 없이도 API를 낼 수 있다.
- **참고 출처**: https://developers.notion.com/reference/page-property-values , https://developers.notion.com/reference/retrieve-a-page-property , https://developers.notion.com/reference/property-item-object , https://developers.notion.com/reference/property-object

---

### F-09-18 oEmbed 언퍼 프로토콜 계약 (임베드 엔진의 표준 인터페이스)

- **한 줄 정의**: 임의의 URL을 "이 화면에 넣을 수 있는 HTML/이미지"로 바꾸는 업계 표준 프로토콜. 노션 embed 블록(F-09-10)을 자체 구현할 때의 사실상 유일한 설계도.
- **사용자 시나리오**(구현자 관점):
  1. 사용자가 `https://www.youtube.com/watch?v=…`를 붙여넣는다.
  2. 언퍼 워커가 providers 레지스트리에서 URL 스킴 매칭 → 프로바이더의 oEmbed endpoint 확인.
  3. 매칭 실패 시 페이지를 가져와 `<link rel="alternate" type="application/json+oembed" href="…">`로 **디스커버리**.
  4. `GET {endpoint}?url=…&maxwidth=…&maxheight=…&format=json` 호출.
  5. 응답 `type`에 따라 렌더: `video`/`rich` → `html` 삽입, `photo` → `<img src=url>`, `link` → 메타데이터 카드(bookmark).
  6. `cache_age`만큼 캐시.
- **동작 상세**:
  - 요청 파라미터: `url`(필수), `maxwidth`, `maxheight`, `format`(`json`|`xml`).
  - 응답 타입 4종과 필수 필드:

  | `type` | 필수 필드 | 렌더 방식 | 노션에서의 대응 |
  |---|---|---|---|
  | `photo` | `type`, `version`, `url`, `width`, `height` | `<img>` | image 블록 |
  | `video` | `type`, `version`, `html`, `width`, `height` | iframe HTML 삽입 | embed 블록 |
  | `rich` | `type`, `version`, `html`, `width`, `height` | iframe/HTML 삽입 | embed 블록 |
  | `link` | `type`, `version` | 메타데이터만 → 카드 | bookmark 블록 |

  - 공통 선택 필드: `title`, `author_name`, `author_url`, `provider_name`, `provider_url`, `cache_age`, `thumbnail_url`, `thumbnail_width`, `thumbnail_height`.
  - MIME: JSON은 `application/json`, XML은 `text/xml`.
  - 에러 규약: **404** = 해당 URL에 대한 응답 없음, **501** = 요청한 format 미지원, **401** = 비공개 리소스.
  - 즉 **노션의 3분기(embed / bookmark / link preview)는 oEmbed의 `rich|video` / `link` / (표준 밖 인증형)에 그대로 대응한다.** F-09-11의 이원화는 oEmbed의 401 케이스를 자체 프로토콜로 메운 것으로 볼 수 있다 `[추정]`.
- **엣지 케이스**:
  - 빈 값: `link` 타입은 `html`도 `url`도 없이 올 수 있다 → 렌더러는 "메타데이터만 있는 카드"를 정상 경로로 처리해야 한다.
  - 중첩: 프로바이더가 돌려준 `html` 안에 또 다른 외부 스크립트가 들어 있는 경우가 흔하다 → **절대 메인 origin에 innerHTML 하지 말고 sandboxed iframe(srcdoc) 안에서만** 실행한다. 이것을 지키지 않으면 임베드 하나가 워크스페이스 전체 XSS가 된다.
  - 동시편집: 같은 URL을 여러 사용자가 동시에 붙여넣으면 언퍼 요청이 중복 발사된다 → `url_hash` 기준 **single-flight 락**.
  - 삭제된 참조: 프로바이더가 404를 주면 캐시에 `status:'404'`를 음성 캐시(negative cache, 짧은 TTL)로 남겨 재시도 폭주를 막는다.
  - 권한 없음: 401 응답(비공개 리소스)은 **실패가 아니라 "인증형 프리뷰로 승격 제안"** UX로 다루는 것이 옳다.
  - 대용량/보안: 언퍼 워커는 사용자가 준 임의 URL을 서버에서 가져오므로 **SSRF의 정면 표적**이다. 필수 방어 = ① DNS 재바인딩 대비 IP 재검증 ② 사설/링크로컬/메타데이터 대역(169.254.169.254 등) 차단 ③ 리다이렉트 hop 제한 ④ 응답 크기·타임아웃 상한 ⑤ 도메인별 rate limit ⑥ 전용 egress 네트워크 분리.
  - 순환 참조: 자기 서비스 URL을 자기 임베드로 넣으면 iframe 무한 중첩이 된다 → **자기 도메인 임베드는 깊이 1로 제한하거나 전용 렌더러로 분기**.
- **데이터 모델 함의**:
  ```sql
  oembed_provider(id serial pk, provider_name text, provider_url text,
                  endpoint_url text, schemes text[],  -- URL glob 패턴
                  supports_discovery bool, enabled bool)
  link_unfurl_cache(...)   -- 상단 스키마 재사용. + response_type enum('photo','video','rich','link'),
                           --   html text, width int, height int, cache_age_sec int
  unfurl_fetch_log(url_hash, attempted_at, status, latency_ms, bytes)
  ```
  providers 레지스트리는 oembed.com의 공개 `providers.json`을 시드로 넣고 **주기적으로 갱신하는 잡**을 둔다(프로바이더가 계속 늘어난다).
- **UI/인터랙션**: 붙여넣기 직후의 4택 메뉴(Dismiss / Bookmark / Embed / Mention), 언퍼 진행 중 스켈레톤, 실패 시 "링크로 유지" 폴백, 블록 ••• > Turn into로 상호 변환.
- **의존 기능**: F-09-10(embed 블록), F-09-11(bookmark/mention), HTTP 페처 워커, 캐시.
- **구현 난이도**: **M/L** — 프로토콜 클라이언트만이면 M(2~4일)이지만, **SSRF 방어 + 샌드박스 격리 + 프로바이더 레지스트리 운영**까지 포함하면 L. 보안 부분을 뺀 M 평가는 위험하다.
- **우선순위**: **P1** — F-09-10을 P1으로 두는 한 그 구현 수단인 이 항목도 P1이다.
- **클론 시 현실적 대안**: 상용 언퍼 서비스(Iframely·Embedly)를 v1에 붙이면 위 보안 부담과 프로바이더 운영을 통째로 아웃소싱할 수 있다(노션이 실제로 택한 길). 자체 구현으로 갈 경우 **oEmbed → OpenGraph → raw iframe 3단 폴백** + 상위 20개 프로바이더 하드코딩으로 시작한다.
- **참고 출처**: https://oembed.com/ , https://www.notion.com/help/embed-and-connect-other-apps

---

### F-09-19 Notion MCP 서버 (LLM 에이전트용 도구 표면)

- **한 줄 정의**: REST 엔드포인트 대신 "에이전트가 호출할 도구(tool)" 단위로 워크스페이스를 노출하는, Model Context Protocol 기반의 별도 API 표면.
- **사용자 시나리오**: 사용자가 MCP 클라이언트(Claude·Cursor 등)에 `https://mcp.notion.com/mcp`를 추가 → 브라우저 OAuth 동의 → 이후 에이전트가 `notion-search`로 문서를 찾고 `notion-fetch`로 읽고 `notion-update-page`로 고친다.
- **동작 상세**:
  - **호스팅형 원격 서버**(`mcp.notion.com/mcp`). 인증은 **OAuth 전용**이며, 서드파티 클라이언트를 위해 **Dynamic Client Registration(RFC 7591)** 을 지원한다 `[확인필요]`(2차 출처 기준). 브라우저 동의가 필요해 **헤드리스 에이전트에는 부적합**하다 `[확인필요]`.
  - 도구 표면은 REST의 얇은 래퍼가 **아니다.** 블록 단위 CRUD(`GET/PATCH /v1/blocks/…`)를 노출하지 않고, **페이지 단위 읽기/치환 + Notion-flavored Markdown**으로 추상화한다(F-09-22와 같은 계약). 토큰 효율과 LLM 오작동 방지를 동시에 노린 설계다 `[추정]`.
  - 도구 목록(공식 문서 기준, 읽기/쓰기 분리):

  | 구분 | 도구 |
  |---|---|
  | 검색·조회 | `notion-search`, `notion-ai-search`, `notion-search-skills`, `notion-fetch`, `notion-download-attachment`, `notion-query-data-sources`, `notion-query-meeting-notes`, `notion-get-comments`, `notion-get-teams`, `notion-get-users`, `notion-get-async-task` |
  | 콘텐츠 쓰기 | `notion-create-pages`, `notion-update-page`, `notion-move-pages`, `notion-duplicate-page`, `notion-create-database`, `notion-create-folder`, `notion-update-data-source`, `notion-create-view`, `notion-update-view`, `notion-create-comment`, `notion-convert-page-to-skill` |
  | 파일 | `notion-create-file-upload`(≤20 MiB), `notion-create-attachment`(텍스트 ≤200 KiB) |
  | 에이전트 세션 | `notion-list-agents`, `notion-search-agents`, `notion-spawn-session`, `notion-wait-session`, `notion-stop-session`, `notion-send-message-to-session`, `notion-query-sessions`, `notion-search-sessions`, `notion-get-session-status`, `notion-list-session-events`, `notion-read-session-event` |

  - `notion-fetch`는 특수 id `"self"`로 현재 워크스페이스/사용자 정체성을 조회한다.
  - `notion-ai-search`는 Slack·Mail·Calendar·Google Drive·Jira 등 **연결된 외부 소스까지 시맨틱 검색**한다(Notion AI 필요).
  - **레이트 리밋: 사용자당 180 req/min, 키워드 검색(`notion-search`)은 별도로 30 req/min.** REST의 "연결당 3 rps"와 **다른 축**이다.
  - 오픈소스/셀프호스팅 경로가 별도 문서로 존재한다(`guides/mcp/hosting-open-source-mcp`).
- **엣지 케이스**:
  - 빈 값: 검색 결과 0건은 에이전트에게 "없음"을 **명시적 문자열**로 돌려줘야 한다(빈 배열만 주면 LLM이 환각으로 메운다).
  - 중첩: 도구가 페이지 전체를 반환하므로 큰 페이지가 컨텍스트 윈도우를 넘긴다 → `notion-fetch`가 truncation을 표시해야 한다(F-09-22의 `truncated`/`unknown_block_ids`와 같은 문제).
  - 동시편집: `notion-update-page`의 replace 모드는 **페이지 전체 치환**이다. 에이전트가 읽고-고쳐-쓰는 사이 사람이 편집하면 통째로 날아간다 → search-and-replace 배치 연산이 제공되는 이유. 클론은 **전체 치환 도구를 아예 제공하지 말고 델타 연산만** 주는 편이 안전하다.
  - 삭제된 참조: 도구 호출 사이에 대상이 삭제되면 에러 문자열이 그대로 LLM 컨텍스트에 들어간다 → 에러 메시지가 **행동 가능한 지시**여야 한다("이 페이지는 삭제되었습니다. 다시 검색하세요").
  - 권한 없음: MCP 세션은 인가한 사용자의 권한을 그대로 쓴다 → **프롬프트 인젝션이 곧 권한 남용**이 된다. 페이지 본문에 심어진 지시문이 에이전트를 조종할 수 있으므로 노션도 별도 보안 가이드(`mcp-security-best-practices`)를 둔다. 클론은 ① 쓰기 도구에 사용자 확인 게이트 ② 도구별 스코프 분리 ③ 감사 로그를 필수로 두라.
  - 대용량: 180 req/min 상한 때문에 에이전트의 브루트포스 탐색이 막힌다 → 검색이 정확해야 한다.
  - 순환 참조: 에이전트가 만든 페이지를 다시 검색해 또 수정하는 루프. 세션당 도구 호출 상한과 변경 diff 로깅이 필요하다.
- **데이터 모델 함의**:
  ```sql
  mcp_client_connection(id uuid pk, workspace_id uuid, user_id uuid,
                        client_name text, client_id text,        -- DCR로 자동 등록될 수 있음
                        scopes text[], created_at, last_used_at,
                        enterprise_managed bool)
  mcp_tool_call_log(id, connection_id, user_id, tool_name, args_digest,
                    target_entity_id, result_status, tokens_out, at)
  ```
  `mcp_tool_call_log`는 선택이 아니라 **필수**다 — 에이전트가 한 일을 사후에 설명할 수 없으면 조직이 도입하지 못한다. Admin API에 `mcp-client-connection` 스코프와 연결 해지 엔드포인트가 있는 것(F-09-20)이 그 방증이다.
- **UI/인터랙션**: MCP 클라이언트 쪽 UI(도구 승인 프롬프트). 노션 쪽은 Settings의 연결 목록과 관리자 콘솔의 MCP 연결 승인·해지.
- **의존 기능**: OAuth(F-09-02), Markdown 계약(F-09-22), 검색(F-09-06), 데이터소스 쿼리(F-09-16).
- **구현 난이도**: **M/L** — MCP 서버 자체는 기존 API 위의 얇은 층이라 M. 그러나 **"LLM이 쓰기 좋은 입도"로 도구를 재설계**(페이지 단위 markdown, 검색 품질, 에러 문구)하는 것이 실제 비용이고, 감사·권한 게이트까지 넣으면 L.
- **우선순위**: **P2** — 단, 2026년 기준 **에이전트 연동은 API 채택의 주요 경로**가 되었으므로 "P2 중 최우선"으로 보는 것이 타당하다 `[추정]`.
- **클론 시 현실적 대안**: 손으로 MCP 서버를 쓰지 말고 **OpenAPI 스펙 → MCP 자동 생성**으로 시작한 뒤, 사용량 로그를 보고 상위 5~10개 도구만 손으로 다듬는다. 도구는 반드시 **markdown 입출력**으로 만들어라(블록 JSON을 LLM에 그대로 주면 토큰을 태우고 정확도도 낮다).
- **참고 출처**: https://developers.notion.com/guides/mcp/overview , https://developers.notion.com/guides/mcp/mcp-supported-tools , https://developers.notion.com/guides/mcp/mcp-security-best-practices , https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look

---

### F-09-20 Admin API (Enterprise 조직 관리 표면)

- **한 줄 정의**: 워크스페이스 콘텐츠가 아니라 **조직 자체**(사용자 세션·리걸홀드·권한 그룹·PAT·MCP 연결·워크스페이스 export·에이전트 크레딧)를 프로그램으로 다루는, 별도 base URL·별도 버전·별도 토큰의 API.
- **사용자 시나리오**: 보안팀이 퇴사자 계정을 즉시 차단해야 한다 → 조직 콘솔에서 발급한 admin bot 토큰으로 `revoke-user-session` 호출 → 이어서 그 사용자가 만든 PAT를 `list-personal-access-tokens` → `revoke-personal-access-token`으로 폐기 → 마지막으로 리걸홀드에 사용자 추가.
- **동작 상세**:
  - **Base URL이 다르다**: `https://api.notion.com/admin/v1/`. **버전 라인도 별개**로, 현재 `Notion-Version: 2026-06-01`(본 API의 `2026-03-11`과 다름).
  - **Enterprise 플랜 전용**. organization owner가 **조직 콘솔에서 admin bot 토큰을 생성·수정·폐기**한다.
  - 권한은 capability가 아니라 **`리소스:동작` 스코프**다.

  | 리소스 | 동작 |
  |---|---|
  | `legal-hold`, `managed-user-session`, `mcp-client-connection`, `permission-group`, `personal-access-token`, `user`, `workflows`, `workspace` | `read`(조회) / `write`(수정) / `write-high-impact`(자격증명·접근 회수 등 민감 변경) / `export`(내보내기) |

  - **스코프 능력은 독립적이다** — `permission-group:write`가 `permission-group:read`를 포함하지 않으므로 둘 다 명시적으로 부여해야 한다. `user`와 `permission-group` 스코프는 일부 Enterprise 조직에만 열린다.
  - 엔드포인트 군(공식 문서 인덱스 기준):

  | 군 | 대표 엔드포인트 |
  |---|---|
  | Legal hold | create / get / update / release, add·remove user, list users·pages·workspaces, **export** |
  | Users & sessions | `list-users`, **`revoke-user-session`** |
  | Permission group | list / retrieve / create / update / delete, 멤버 list·add·update·remove |
  | Agent 관리 | 에이전트 크레딧 사용량 조회, 크레딧 한도 변경, 권한 조회·변경, 상태 변경, 생성 정책 변경, 삭제 |
  | Credit limit policy | list / create / update / expire |
  | MCP & 보안 | MCP 클라이언트 연결 목록·해지·엔터프라이즈 관리 접근 설정, **PAT 목록·폐기** |
  | Workspace export | **`POST /v1/spaces/{space_id}/exports`** (스코프 `workspace:export`) + export 상태 조회 |

  - 워크스페이스 export 요청 파라미터: `export_type`(`html`\|`markdown`\|`pdf`, 필수), `on_behalf_of_user_email`(필수), 선택으로 `collection_view_export_type`, `flatten_export_filetree`, `include_comments`, `include_contents`, `locale`, `pdf_format`, `teamspace_ids`, `time_zone`. 응답은 `{export_job_id, status}`.
  - **`on_behalf_of_user_email`이 필수**라는 점이 설계의 핵심이다 — export는 반드시 **특정 사용자의 권한으로** 수행되며, admin 토큰이라도 "모든 것을 본다"가 아니다. F-09-14의 "권한 없는 페이지는 제외" 규칙이 여기서도 유지된다 `[추정]`.
- **엣지 케이스**:
  - 빈 값: `teamspace_ids`를 비우면 전체 워크스페이스 export. 대상이 비어 있어도 잡은 생성되고 빈 ZIP이 나온다 `[추정]`.
  - 중첩: 리걸홀드 대상 사용자가 여러 워크스페이스에 걸쳐 있으면 홀드가 워크스페이스별로 전개된다 `[확인필요]`.
  - 동시편집: export 잡 진행 중 사용자가 삭제되면 `on_behalf_of_user_email` 해석이 실패한다 → 잡 시작 시점에 사용자 id로 **동결(freeze)** 해야 한다.
  - 삭제된 참조: 폐기된 PAT을 다시 폐기 → 멱등하게 200을 주는 편이 운영에 낫다.
  - 권한 없음: 스코프가 독립적이라 **read 없이 write만 준 토큰**이 흔한 실수다. 에러 메시지에 "필요한 스코프 이름"을 그대로 실어라.
  - 대용량: 워크스페이스 export는 최대 30시간(F-09-14) — **동기 응답이 불가능하므로 잡 id + 폴링이 유일한 계약**이다. 클론은 완료 시 웹훅 통지도 함께 제공하라.
  - 순환 참조: 권한 그룹이 다른 권한 그룹을 멤버로 포함하는 중첩 그룹을 허용하면 사이클이 가능하다 → 멤버 추가 시 **도달 가능성 검사** 필요 `[추정]`.
- **데이터 모델 함의**:
  ```sql
  org(id uuid pk, name text, plan enum('enterprise'), ...)
  org_bot_token(id uuid pk, org_id uuid, name text, token_hash text,
                scopes text[], created_by uuid, created_at, revoked_at)
  legal_hold(id uuid pk, org_id uuid, name text, status enum('active','released'),
             created_at, released_at)
  legal_hold_user(hold_id uuid, user_id uuid, added_at)
  permission_group(id uuid pk, org_id uuid, name text)
  permission_group_member(group_id uuid, member_type enum('user','group'), member_id uuid, role text)
  admin_audit_log(id, org_id, actor_bot_id, actor_user_id, action, target_type,
                  target_id, scope_used text, request_id, at)
  space_export_job(id uuid pk, org_id, workspace_id, on_behalf_of_user_id,
                   export_type, opts jsonb, status, artifact_url, expires_at)
  ```
  **admin 토큰은 워크스페이스 토큰과 물리적으로 다른 테이블·다른 검증 경로**에 두어야 한다(같은 미들웨어를 공유하면 스코프 승격 버그가 난다).
- **UI/인터랙션**: 조직 콘솔의 admin bot 토큰 생성 화면(스코프 체크박스), 토큰 목록·회전·폐기, export 잡 상태 목록, 리걸홀드 관리 화면.
- **의존 기능**: 조직/워크스페이스 계층 모델, 사용자·세션 모델, 감사 로그, F-09-14(export 잡), F-09-02(토큰).
- **구현 난이도**: **L** — 엔드포인트 수 자체가 많고(50+), 각각이 파괴적 동작(세션 회수·PAT 폐기)이라 감사 로그·멱등성·확인 단계까지 필요하다. 다만 개별 로직은 단순해 XL까지는 아니다.
- **우선순위**: **P2** — 엔터프라이즈 판매를 시작하기 전에는 불필요. **단 `admin_audit_log`와 `org_bot_token` 테이블만은 v1에 만들어 둬라**(사후 도입 시 과거 이력이 없어 컴플라이언스 심사를 통과하지 못한다).
- **클론 시 현실적 대안**: v1은 API 없이 **관리자 웹 UI**로만 제공한다(세션 회수·사용자 비활성화·워크스페이스 export). API화는 실제 엔터프라이즈 고객이 요구할 때. 다만 별도 base path(`/admin/v1`)와 별도 버전 라인은 **처음부터 분리**해 두면 나중에 본 API의 버전 정책에 묶이지 않는다.
- **참고 출처**: https://developers.notion.com/reference/admin/intro , https://developers.notion.com/reference/admin/scopes , https://developers.notion.com/reference/admin/versioning , https://developers.notion.com/reference/admin/enqueue-space-export , https://www.notion.com/help/create-integrations-with-the-notion-api

---

### F-09-21 아웃바운드 automation webhook · iPaaS 커넥터 (노코드 경계면)

- **한 줄 정의**: 개발자용 workspace webhook(F-09-09)과 별개로, **일반 사용자가 데이터베이스 자동화·버튼에서 직접 외부 URL로 POST를 쏘는** 노코드 아웃바운드 경로와, 그 위에 얹히는 Zapier/Make/n8n 계열 커넥터.
- **사용자 시나리오**:
  1. 데이터베이스 우상단 ⚡ > New automation → 트리거 선택(예: "Status가 Done이 될 때").
  2. Add action > **Send webhook** 선택.
  3. URL 입력(예: `https://hooks.zapier.com/…`), 필요 시 **Add custom header**로 인증 헤더 추가.
  4. 페이로드에 포함할 **데이터베이스 프로퍼티**를 체크.
  5. 저장 → 이후 조건이 만족될 때마다 HTTP POST 발사.
- **동작 상세**:
  - **유료 플랜 전용.** 버튼 / 데이터베이스 버튼 / 데이터베이스 자동화 세 곳에서 설정할 수 있다.
  - **POST만 지원**한다(GET/PUT/PATCH 불가).
  - **인증을 요구하지 않는다** — 수신 URL의 비밀성이 유일한 보호막이다. 그래서 커스텀 헤더 기능이 실질적 인증 수단이 된다.
  - **페이로드는 데이터베이스 페이지 프로퍼티만 담을 수 있고, 페이지 본문(블록)은 보낼 수 없다.** 데이터베이스 버튼의 프로퍼티는 선택 대상에서 제외된다.
  - **자동화 1개당 webhook action 최대 5개.**
  - 실패 시: 자동화 설정 옆에 느낌표가 뜨고 **자동으로 일시정지되며, 사용자가 수동으로 재개**해야 한다. (F-09-09의 개발자 웹훅과 대비되는 명시적 실패 정책이다.)
  - 페이로드 미리보기 기능이 없어 webhook.site 같은 외부 도구로 확인해야 한다.
  - **iPaaS 층**: Zapier/Make/n8n의 노션 커넥터는 전통적으로 **폴링 트리거**(데이터베이스에 새 행/변경 행이 있는지 주기 조회)로 동작해 왔고, 폴링 주기가 요금제에 종속된다. 워크스페이스 웹훅(F-09-09)의 등장으로 즉시 트리거가 가능해졌지만, 커넥터 전환은 벤더마다 속도가 다르다 `[확인필요]`(2차 출처 기준).
- **엣지 케이스**:
  - 빈 값: 프로퍼티를 하나도 선택하지 않으면 사실상 "트리거 신호만" 가는 빈 페이로드가 된다 → 수신 측이 page id조차 못 받는 상황을 막으려면 **id는 항상 포함**하도록 강제해야 한다.
  - 중첩: relation/rollup 프로퍼티는 중첩 객체로 직렬화되어 노코드 수신측(스프레드시트 등)에서 다루기 어렵다 → 클론은 **플랫 스칼라 뷰**를 함께 제공하는 편이 실용적이다 `[추정]`.
  - 동시편집: 대량 편집(예: 100행 일괄 상태 변경)이 100번의 POST를 유발한다 → **자동화 단위 debounce/배치 상한**이 없으면 사용자가 자기 발로 자기 서버를 DoS 한다. 노션의 자동 일시정지 정책이 이 사고의 안전판이다 `[추정]`.
  - 삭제된 참조: 트리거 발동 직후 행이 삭제되면 수신측이 되읽을 때 404 → 페이로드에 **값 스냅샷**을 담아 보내는 설계가 유리하다(개발자 웹훅의 thin payload와 반대 선택).
  - 권한 없음: 자동화 작성자의 권한으로 실행되므로, **작성자가 볼 수 있는 데이터가 임의 외부 URL로 나간다**. 조직 관점에서는 데이터 유출 경로다 → 클론은 ① 허용 도메인 화이트리스트 ② 관리자 감사 로그 ③ 자동화 소유자 표시를 반드시 붙여라.
  - 대용량: 수신 endpoint가 느리면 자동화 큐가 밀린다. 타임아웃과 동시 실행 상한이 필요하다 `[확인필요]`(노션의 수치 미공개).
  - 순환 참조: 외부 시스템이 웹훅을 받아 노션 API로 같은 데이터베이스를 다시 쓰면 자동화가 재발동해 **무한 루프**가 된다. 개발자 웹훅은 `authors`로 자기 이벤트를 거를 수 있지만 **automation webhook에는 그 필드가 없다** → 클론은 자동화 실행 페이로드에 `triggered_by`와 `automation_id`를 반드시 넣고, 같은 automation이 만든 변경은 트리거하지 않는 **루프 차단기**를 넣어라.
- **데이터 모델 함의**:
  ```sql
  automation(id uuid pk, workspace_id, data_source_id uuid null, button_block_id uuid null,
             name text, trigger jsonb,          -- {type, property_id, condition}
             owner_user_id uuid, enabled bool,
             status enum('active','paused_on_failure'), failure_count int)
  automation_action(automation_id uuid, seq int, type enum('send_webhook','edit_property',
                    'add_page','send_notification','ai_action'), config jsonb,
                    primary key(automation_id, seq))
  webhook_action_config = { url, headers jsonb, property_ids text[] }   -- action.config
  automation_run(id, automation_id, trigger_entity_id, started_at, finished_at,
                 status, http_status int, response_snippet text, attempt int)
  ```
  `automation_run`은 사용자 지원의 핵심이다 — "왜 안 갔는지"를 보여주지 못하면 노코드 자동화는 신뢰를 잃는다. 노션이 "느낌표 + 수동 재개"만 제공하는 것은 부족한 지점이고, **클론이 실행 로그 뷰어를 제공하면 즉시 체감 차별점**이 된다.
- **UI/인터랙션**: 데이터베이스의 ⚡ 자동화 메뉴, 트리거 조건 빌더, 액션 리스트(드래그 정렬), Send webhook 폼(URL·커스텀 헤더 키/값·프로퍼티 체크박스), 실패 표시 느낌표와 재개 버튼.
- **의존 기능**: 데이터베이스/프로퍼티 모델, 자동화 트리거 엔진(변경 감지), 잡 큐, 권한 모델.
- **구현 난이도**: **M/L** — 웹훅 발사 자체는 S지만, **트리거 엔진(어떤 편집이 어떤 자동화를 깨우는가)** 과 루프 차단·재시도·실행 로그까지 포함하면 L. 트리거 엔진은 F-09-09의 아웃박스를 재사용할 수 있다면 크게 싸진다.
- **우선순위**: **P2** — 단, **개발자 웹훅(F-09-09)보다 사용자 체감이 크다.** 노코드 사용자가 훨씬 많으므로, 둘 중 하나만 만든다면 이쪽이 먼저라고 볼 여지가 있다 `[추정]`.
- **클론 시 현실적 대안**: 자체 트리거 엔진을 만들기 전에 **F-09-09의 웹훅 + 공개 API만 제공하고 Zapier/Make/n8n 커넥터를 먼저 낸다**(구현 비용이 0에 가깝고 생태계가 대신 UI를 만들어 준다). 자체 automation은 그 사용 패턴을 보고 상위 3개 시나리오만 내장한다.
- **참고 출처**: https://www.notion.com/help/webhook-actions , https://www.notion.com/help/database-automations , https://developers.notion.com/reference/webhooks

---

### F-09-22 Markdown API (Notion-flavored Markdown 읽기/쓰기)

- **한 줄 정의**: 페이지 본문을 블록 JSON이 아니라 **Markdown 문자열 하나**로 읽고 쓰는 엔드포인트. 2026-03-11 버전에서 공개 API에 들어온, 이 도메인의 판을 바꾸는 표면이다.
- **사용자 시나리오**: 마이그레이션 스크립트가 `GET /v1/pages/{id}/markdown`으로 본문을 통째로 받아 파일로 저장 → 외부에서 수정 → `PATCH /v1/pages/{id}/markdown`으로 되쓴다. 블록 트리 순회·2단 중첩 분할·100개 청크 전송이 **전부 사라진다**.
- **동작 상세**:
  - 엔드포인트 3종: `POST /v1/pages`(생성 시 body에 `markdown` 파라미터), **`GET /v1/pages/:page_id/markdown`**, **`PATCH /v1/pages/:page_id/markdown`**.
  - 갱신 모드 2종: `update_content`(**search-and-replace 연산 배열**로 부분 편집) / `replace_content`(**본문 전체 치환**).
  - Notion-flavored Markdown은 CommonMark에 XML-유사 태그를 얹어 노션 고유 블록을 표현한다: `<callout>`, `<details>`(토글), `<table>`, `<columns>`/`<column>`, `<page url="…">`, `<database url="…">`, `<audio>`/`<video>`/`<pdf>`, `$$ … $$`(수식).
  - **무손실이 아니다**: bookmark, embed, link preview, breadcrumb, template 등 미지원 블록은 `<unknown url="…" alt="block_type"/>`로 내려온다. 즉 **markdown 왕복은 이 블록들을 파괴한다.**
  - 응답 객체: `{"object":"page_markdown", "id", "markdown", "truncated", "unknown_block_ids"}`.
  - **크기 상한: 약 20,000 블록.** 초과 시 `"truncated": true`와 `unknown_block_ids`(**최대 100개**) 배열이 실린다.
  - **`<unknown>`이 생기는 사유는 셋이다**: ① 미지원 블록 타입 ② truncation ③ **권한 부족**. 즉 같은 표기가 "이 앱이 모르는 블록"과 "당신이 볼 수 없는 블록"을 구분하지 않는다 → 클론은 `reason` 속성(`unsupported`/`truncated`/`forbidden`)을 붙여 구분하라. 백업 도구가 조용히 빈 곳을 만드는 것을 막는 가장 값싼 조치다.
  - 권한/토큰: Bearer 토큰(PAT 또는 connection token)에 **read content capability**가 필요하고, 없으면 403, 대상이 없거나 접근 불가면 404. **공식 레퍼런스에는 "public connection 전용"이나 플랜 제한이 명시되어 있지 않다** — 일부 2차 출처가 "GET은 public integration에만 열려 있다"고 주장하나 1차 출처로 재확인되지 않았다 `[확인필요]`.
- **엣지 케이스**:
  - 빈 값: 빈 페이지는 빈 문자열. `replace_content`에 빈 문자열을 주면 본문 전체 삭제 → **되돌릴 수 없는 파괴적 연산**이므로 확인 게이트가 필요하다.
  - 중첩: 컬럼 안의 토글 안의 표 같은 깊은 중첩은 XML 태그 중첩으로 표현되지만, 파서가 태그 균형을 잃으면 문서가 통째로 깨진다 → **엄격 파서 + 실패 시 전체 거부(원자적 적용)** 가 필수. 블록 API의 부분 실패보다 위험이 크다.
  - 동시편집: `replace_content`는 read-modify-write 창 전체가 lost-update 구간이다. **버전 토큰(`If-Match`)이 없으면 협업 환경에서 쓰면 안 되는 API**다 `[추정]` — 클론이라면 markdown 갱신에 반드시 `base_version`을 요구하라.
  - 삭제된 참조: `<page url="…">`가 가리키던 페이지가 삭제되면 markdown 왕복 시 링크가 죽는다. 왕복 전후로 **참조 무결성 검사**가 필요하다.
  - 권한 없음: 본문에 접근 불가 페이지 mention이 있으면 markdown에서 어떻게 표기되는지 미확인 `[확인필요]`.
  - 대용량: 20,000 블록 상한 + `truncated` 플래그를 무시하면 **조용히 잘린 백업**이 만들어진다. F-09-17의 25 참조 문제와 같은 계열의 침묵 데이터 손실이다.
  - 순환 참조: `<page url>` 임베드를 재귀 전개하지 않는 설계(링크로만 표현)라 순환은 문제되지 않는다.
- **데이터 모델 함의**: 새 테이블은 필요 없다. 대신 **블록 트리 ↔ markdown AST 양방향 변환기**가 1급 컴포넌트가 되어야 한다.
  ```
  serializer(block_tree) -> markdown      # export(F-09-14)와 공유
  parser(markdown) -> block_tree          # import(F-09-12)와 공유
  round_trip_fixture(block_type) -> bool  # 블록 타입별 왕복 테스트 매트릭스
  ```
  블록 타입별로 `md_supported: bool` 메타데이터를 두고, 미지원 타입은 **원본 block_id를 보존하는 플레이스홀더**로 직렬화해야 왕복 시 복원이 가능하다(노션의 `<unknown>`은 id를 보존하므로 부분 복원이 가능하다는 점이 설계 힌트다).
- **UI/인터랙션**: 없음(API). 대응 UI는 "Copy as Markdown" / "Paste Markdown" 및 마크다운 붙여넣기 자동 변환.
- **의존 기능**: F-09-03(rich text), 블록 모델, F-09-14의 직렬화기, F-09-12의 파서.
- **구현 난이도**: **M/L** — 직렬화기·파서를 export/import와 **공유**하면 추가 비용은 M(엔드포인트 3개 + truncation 처리). 처음부터 따로 만들면 L 이상이며 왕복 불일치 버그가 영구적으로 남는다.
- **우선순위**: **P1** — 이유: ① LLM/에이전트 연동의 기본 입출력 형식이고(F-09-19의 도구들이 전부 이 계약을 쓴다) ② 블록 API의 2단 중첩·100개 청크 제약을 통째로 우회해 임포터 구현 비용을 크게 낮춘다. **클론에서는 블록 JSON API보다 이쪽을 먼저 내는 선택도 합리적이다.**
- **클론 시 현실적 대안**: 커스텀 태그를 만들지 말고 **MDX 또는 표준 directive 문법(`:::callout`)** 을 채택해 기존 마크다운 생태계 도구를 그대로 쓴다. 미지원 블록은 `<!-- notion-block:<id> type=embed -->` 주석으로 보존해 왕복 손실을 0으로 만드는 것이 노션보다 나은 지점이다.
- **참고 출처**: https://developers.notion.com/guides/data-apis/working-with-markdown-content , https://developers.notion.com/guides/data-apis/enhanced-markdown , https://developers.notion.com/reference/retrieve-page-markdown , https://developers.notion.com/reference/update-page-markdown

---

### F-09-23 Notion Workers · Notion CLI (호스팅형 통합 런타임)

- **한 줄 정의**: 통합 코드를 개발자 서버가 아니라 **노션이 호스팅·실행**해 주는 서버리스 런타임과, 그것을 배포하는 공식 CLI. "API를 부르는 앱"에서 "플랫폼 위에서 도는 확장"으로 통합 모델이 이동한 것.
- **사용자 시나리오**: 개발자가 `ntn workers deploy`로 TypeScript 코드를 올린다 → 30분마다 Salesforce를 조회해 노션 데이터베이스를 갱신하는 sync가 돌기 시작한다 → 같은 워커가 GitHub push 웹훅도 수신하고, Custom Agent가 호출할 수 있는 tool도 노출한다.
- **동작 상세**:
  - 정의: *"small Node/TypeScript programs that extend Notion"*. **샌드박스된 Node.js 환경**에서 실행되며 노션이 호스팅한다("No servers to manage").
  - 배포: Notion CLI(`ntn`, `npm i -g ntn`)의 `ntn workers deploy` — 번들 → 업로드 → capability 기동. CLI는 macOS/Linux/Windows 네이티브 지원.
  - **가용성(2026-09 기준)**: Workers는 **public beta**이며 **Business·Enterprise 플랜 전용**이다. **Notion CLI 자체는 전 플랜**에서 쓸 수 있다. 2026-08-11부터 Workers 실행은 **Notion credits 과금** 대상이 된다 `[확인필요]`(플랜·과금 시점은 2차 출처 및 릴리스 노트 기준이며 요금 정책은 변동 가능). → 즉 이 표면은 **엔터프라이즈 상향 판매 장치**로 설계된 것이며, 클론이 같은 게이팅을 따라할 이유는 없다.
  - capability 3종:

  | 종류 | 하는 일 | 트리거 |
  |---|---|---|
  | **Sync** | 외부 API(Salesforce·Stripe·GitHub 등) 데이터를 노션 데이터베이스로 끌어와 지속 동기화 | 스케줄, **기본 30분 주기** |
  | **Tool** | Custom Agent가 호출하는 함수(티켓 생성, 외부 조회 등) | 에이전트 온디맨드 |
  | **Webhook** | 외부 서비스의 HTTP 이벤트 수신 후 비동기 핸들러 실행 | 인바운드 HTTP |

  - 부가 기능: **OAuth**(서드파티 인가 대행), **Secrets**(런타임 주입되는 환경변수).
  - 한도(공식):

  | 항목 | 값 |
  |---|---|
  | tool 실행 + 큐된 webhook 실행 | 시간당 600, 분당 60 버스트 |
  | sync 실행 | 시간당 600, 분당 60 버스트 |
  | 빌드 | 하루 100, 5분당 10 버스트 |
  | webhook 인그레스(워크스페이스 승인) | 시간당 600, 분당 60 버스트 |
  | webhook 인그레스(워커당) | 분당 600 |
  | webhook 인그레스(워크스페이스 전체) | 분당 1,200 |
  | sync의 DB 쓰기 | 시간당 1,000,000 오퍼레이션, 분당 25,000 버스트 |

  - 실행 타임아웃·메모리·번들 크기·로그 보존 기간은 공식 한도 문서에 명시가 없다 `[확인필요]`.
  - 별도 표면인 **Notion CLI**(`developers.notion.com/cli`)는 인증, 임의 API 요청, data source 조작, 파일 업로드, 워커 배포 명령을 제공한다.
- **엣지 케이스**:
  - 빈 값: sync 대상 외부 API가 0건을 반환할 때 **기존 노션 행을 지울지 유지할지**가 계약으로 정해져 있어야 한다. "빈 응답 = 전체 삭제"는 가장 파괴적인 기본값이다.
  - 중첩: 워커가 노션 API를 호출하면 그 쓰기가 다시 워크스페이스 웹훅과 automation을 깨운다 → **3중 루프**(워커 → API → 웹훅 → 워커)가 가능하다. 실행 원점(origin) 태깅이 필수.
  - 동시편집: sync가 덮어쓰는 필드를 사람이 노션에서 편집하면 다음 sync 주기에 사라진다 → **필드 단위 소유권(source of truth) 선언**이 없으면 사용자가 데이터를 잃는다. sync 설계에서 가장 중요한 결정.
  - 삭제된 참조: 외부에서 레코드가 삭제되면 노션 행을 지울지 아카이브할지 — 기본은 **아카이브**여야 안전하다 `[추정]`.
  - 권한 없음: 워커는 워크스페이스 권한으로 돌기 때문에, **워커 코드가 곧 권한 경계**다. 공유(`sharing-workers`) 시 코드 감사 없이 설치되면 공급망 위험이 된다 → 클론은 워커에 명시적 스코프 선언 + 설치 시 동의 화면을 요구하라.
  - 대용량: sync의 DB 쓰기 한도(분당 25,000)를 넘는 초기 백필은 **청크 + 재개 가능 잡**으로 나눠야 한다.
  - 순환 참조: 워커 A의 sync 결과가 워커 B의 webhook을 트리거하고 B가 다시 A의 소스를 건드리는 구성이 가능하다 → 워크스페이스 단위 **실행 그래프 시각화와 루프 감지**가 운영 도구로 필요하다 `[추정]`.
- **데이터 모델 함의**:
  ```sql
  worker(id uuid pk, workspace_id uuid, name text, owner_user_id uuid,
         runtime text, bundle_hash text, version int, status enum('active','paused','error'),
         deployed_at timestamptz)
  worker_capability(worker_id uuid, kind enum('sync','tool','webhook'), name text,
                    config jsonb,        -- sync: {schedule_cron, target_data_source_id, mapping}
                    primary key(worker_id, kind, name))
  worker_secret(worker_id uuid, key text, value_encrypted bytea, primary key(worker_id, key))
  worker_run(id, worker_id, capability_name, trigger_source, started_at, duration_ms,
             status, error text, log_ref text)
  sync_state(worker_id uuid, capability_name text, cursor jsonb, last_success_at timestamptz)
  sync_record_map(worker_id uuid, external_id text, page_id uuid, last_hash text,
                  primary key(worker_id, external_id))   -- upsert 근거
  ```
  **`sync_record_map`이 핵심이다** — 이것이 없으면 sync가 매 주기 중복 행을 만든다(F-09-12의 CSV 재임포트 중복 문제와 정확히 같은 실패). 외부 id → 노션 page id 매핑 + 콘텐츠 해시로 **변경분만 쓰기**를 구현한다.
- **UI/인터랙션**: CLI(`ntn`)가 주 인터페이스. 워크스페이스 쪽에는 워커 목록·실행 로그·시크릿 관리·일시정지 화면이 필요하다.
- **의존 기능**: F-09-02(인증/스코프), F-09-09(이벤트), F-09-16(데이터소스 쓰기), 잡 스케줄러, 코드 샌드박스(격리 실행 환경).
- **구현 난이도**: **XL** — 사용자 코드를 안전하게 호스팅하는 것(멀티테넌트 샌드박스, 리소스 격리, 시크릿 관리, 빌드 파이프라인, 로그·과금)은 **그 자체로 하나의 제품**이다. 클론이 이걸 자체 구현하는 것은 거의 언제나 잘못된 선택이다.
- **우선순위**: **P2**(사실상 v3) — 다만 **sync 개념(외부 소스 → 데이터베이스 지속 동기화)** 만 떼어내면 P1급 수요가 있다.
- **클론 시 현실적 대안**: 코드 호스팅을 만들지 말고 ① **선언형 sync 커넥터**(YAML로 "이 API의 이 필드를 이 프로퍼티에 매핑, 30분마다")만 내장하거나 ② Cloudflare Workers/Deno Deploy 같은 기존 서버리스에 배포하도록 두고 노션 쪽은 **OAuth + 웹훅 + API**만 제공한다. `sync_record_map` 패턴은 어느 쪽을 택하든 그대로 필요하다.
- **참고 출처**: https://developers.notion.com/workers/get-started/overview , https://developers.notion.com/workers/guides/syncs , https://developers.notion.com/workers/reference/limits , https://developers.notion.com/cli/get-started/overview , https://www.notion.com/help/use-notion-from-your-terminal-with-notion-cli (CLI beta) , https://www.notion.com/releases/2026-05-13 (Developer Platform 릴리스) , https://github.com/makenotion/workers-template

---

## 구현 우선순위 요약표

> 난이도는 **본문의 재평가 결과와 동기화**한 값이다(초판 요약표는 본문이 L/XL로 올라간 뒤에도 옛 값을 그대로 두고 있어 정정했다).

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-09-01 | 공개 REST API 리소스 표면 | **L / XL** | P1 | 블록/페이지 모델, F-09-02, F-09-04 |
| F-09-02 | 인증 & 권한(토큰 3종 × capability × 공유) | **L / XL** | P1 | 사용자/워크스페이스, 조상 경로 인덱스 |
| F-09-03 | Rich text JSON 스키마 | M | **P0** | 블록 모델 |
| F-09-04 | 커서 페이지네이션 | S | **P0** | 안정 정렬 키 |
| F-09-05 | Rate limit·크기제한·에러·버저닝 | M | P1 | F-09-02 |
| F-09-06 | Search 엔드포인트 | **M / L** | P1 | F-09-02, 검색 인덱스, F-09-04 |
| F-09-07 | Comments API | M / L | P2 | 사용자, 알림, 블록 앵커 |
| F-09-08 | 파일 업로드 & 서명 URL | M | **P0**(첨부) / P1(API) | 오브젝트 스토리지 |
| F-09-09 | Webhook 구독(개발자용) | L | P2 | 아웃박스, 잡 큐, F-09-02 |
| F-09-10 | Embed 블록 | M | P1 | 블록, 슬래시 커맨드, 언퍼 캐시, F-09-18 |
| F-09-11 | Bookmark·Link mention·Link Preview | M / XL | P1 / P2 | 스크래핑 워커, F-09-03, OAuth |
| F-09-12 | 임포트(파일 기반) | L | P1 (노션 ZIP은 **P0**) | F-09-08, 잡 큐, 페이지 생성 |
| F-09-13 | 임포트(서드파티 앱) | XL | P2 | OAuth 프레임워크, F-09-12 |
| F-09-14 | 익스포트(MD/HTML/PDF) | L / XL | **P0**(MD) / P1(HTML) / P2(PDF) | 직렬화기, 권한, 잡 큐 |
| F-09-15 | 공식 SDK·개발자 포털 | M | P2 (OpenAPI 스펙은 P1) | F-09-01~05 |
| **F-09-16** | **Data source query(필터/정렬 DSL·10,000행 상한)** | **L / XL** | P1 | F-09-01, F-09-04, F-09-17 |
| **F-09-17** | **Page property value 스키마·property item** | **L / XL** | P1 / P2 | 프로퍼티 스키마, formula·rollup 엔진 |
| **F-09-18** | **oEmbed 언퍼 프로토콜 계약** | **M / L** | P1 | F-09-10, HTTP 페처, 캐시 |
| **F-09-19** | **Notion MCP 서버(에이전트 도구 표면)** | **M / L** | P2(중 최우선) | F-09-02, F-09-22, F-09-06, F-09-16 |
| **F-09-20** | **Admin API(Enterprise 조직 관리)** | **L** | P2 | 조직 모델, 감사 로그, F-09-14 |
| **F-09-21** | **아웃바운드 automation webhook · iPaaS** | **M / L** | P2 | 자동화 트리거 엔진, 잡 큐 |
| **F-09-22** | **Markdown API(Notion-flavored MD 읽기/쓰기)** | **M / L** | **P1** | F-09-03, F-09-12/14의 직렬화기 |
| **F-09-23** | **Notion Workers · CLI(호스팅형 통합 런타임)** | **XL** | P2(사실상 v3) | 코드 샌드박스, 스케줄러, F-09-16 |

### 이 도메인의 의존 순서 (구현 착수 순)

```
F-09-03 rich text 스키마
   └→ F-09-22 Markdown 계약 (직렬화기/파서를 export·import와 공유)
        ├→ F-09-14 Markdown export
        ├→ F-09-12 Markdown/ZIP import   (= export의 역함수)
        └→ F-09-19 MCP 도구 표면          (LLM 입출력이 곧 markdown)
F-09-04 커서 규약  ─┐
F-09-08 파일 업로드 ┤→ F-09-01 REST 표면 → F-09-05 제한/에러 → F-09-06 search
F-09-02 권한 모델  ─┘        └→ F-09-17 프로퍼티 값 → F-09-16 data source query
                                                          └→ F-09-15 SDK / OpenAPI
F-09-18 oEmbed 계약 → F-09-10/11 임베드·언퍼링   (독립 트랙, 블록 모델만 의존)
F-09-09 개발자 웹훅 (아웃박스가 준비된 뒤)
   └→ F-09-21 automation webhook (같은 아웃박스·트리거 엔진 재사용)
        └→ F-09-23 Workers (스케줄러 + 샌드박스가 더 필요)
F-09-20 Admin API (엔터프라이즈 판매 시점. 단 감사 로그 테이블은 v1부터)
```

> **핵심 재구성**: 초판의 착수 순서는 `rich text → export → import`였지만, **2026년의 정답은 `rich text → Markdown 계약 → (export / import / MCP)` 세 갈래**다. Markdown 계약 하나가 export·import·에이전트 연동 셋의 공통 기반이 되므로, 여기에 먼저 투자하면 세 기능의 비용이 동시에 내려간다. 라운드트립 테스트(블록 → md → 블록)가 세 기능의 회귀 테스트를 한 번에 커버한다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인에서의 접근 | 차용 가능한 점 |
|---|---|---|
| **Outline** | Confluence·Notion export 파일, Word(.docx), Markdown, 자체 JSON을 **파일 임포트**로 받는다. HTML/MD/TXT 드래그앤드롭 지원. 첨부는 S3 호환 스토리지 필수. 공개 API 제공. | **OAuth 앱 연동 대신 export 파일 임포트로 통일**한 판단. 유지보수 비용이 압도적으로 낮다. 스토리지를 S3 인터페이스로 추상화한 것도 그대로 채용 가치 있음. |
| **Docmost** | v0.21.0에서 ZIP / Notion / Confluence 임포트 추가. Notion export ZIP(Markdown 또는 HTML)을 업로드하면 **페이지 계층을 보존**하며 임포트. | 노션 클론이 가장 먼저 만들어야 할 임포터의 레퍼런스. ZIP 안의 "md + 동명 폴더" 구조를 트리로 복원하는 로직이 핵심. |
| **AFFiNE** | Markdown 임포트 중심. **데이터베이스 중심 워크스페이스는 구조가 손실**된다고 보고됨. ZIP+서브페이지 임포트 버그 이슈가 공개되어 있음(#14283). | 반면교사: **DB/프로퍼티 매핑을 뒤로 미루면 임포트 품질이 무너진다.** ZIP 서브페이지 처리를 초기부터 테스트 픽스처로 고정할 것. |
| **AppFlowy** | 로컬 우선(local-first) 아키텍처. 임포트/익스포트 범위가 상대적으로 좁음. | 로컬 우선 설계에서는 export가 "백업"이 아니라 상시 동기화되는 파일이 될 수 있다는 대안적 관점. |
| **notion-py / notion2md 등 커뮤니티 도구** | 공개 API에 export가 없던 시절 비공식 `enqueueTask(exportBlock)` + 태스크 폴링으로 ZIP을 받아왔다. 현재는 `GET /v1/pages/{id}/markdown`(전 플랜)과 Admin API의 space export(Enterprise)가 그 자리를 일부 대체한다. | **export를 플랜 게이팅 없이 전 플랜에 공개 API로 내면 그 자체가 차별점**이 된다. `POST /v1/exports` → `GET /v1/exports/{id}` 폴링 → 서명 URL, 3개 엔드포인트면 충분하다. |
| **oEmbed 생태계 (oembed.com providers.json)** | Iframely 같은 상용 언퍼 서비스의 대안. | 프로바이더 목록을 공개 JSON에서 시드 → 자체 oEmbed 클라이언트. 상용 의존 없이 상위 수백 도메인 커버 가능. F-09-18의 4개 응답 타입이 곧 렌더러 분기 명세. |
| **MCP 서버 자동생성 도구(OpenAPI→MCP)** | 노션은 REST와 별개로 도구 표면을 손으로 설계했다(페이지 단위 markdown, 18~40개 도구). | 클론은 OpenAPI에서 자동 생성으로 시작하고 **사용량 상위 도구만 손으로 다듬는다**. 도구 입출력은 반드시 markdown(F-09-22) — 블록 JSON을 LLM에 주면 토큰을 태우고 정확도도 떨어진다. |

---

## 미해결 / 확인필요

> 3차 점검에서 **해소된 항목은 제거**하고(중첩 2단, 웹훅 재시도 정책, 파일 업로드 만료, 임포트 크기 제한, Evernote/Trello 한도, SDK 헬퍼명, PAT 만료), 남은 것과 새로 생긴 것만 유지한다.

| # | 항목 | 왜 중요한가 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 1 | 페이지네이션 **커서 TTL의 정확한 값** | 배치 재개 설계의 전제. 공식 문서에 숫자가 없다 | 커서 발급 후 시간 간격을 늘려가며 재사용 테스트 | 미해결 |
| 2 | 워크스페이스당 rate limit의 **플랜별 실제 수치** | 대량 동기화 파트너 설계 | 미공개. 파트너 문의 외 경로 없음 | 미해결(공개 불가로 보임) |
| 3 | API 쓰기와 **실시간 협업(CRDT) 간 충돌 해소 방식** | 클론에서 API와 에디터가 같은 문서를 건드릴 때의 핵심 설계 | 엔지니어링 블로그/발표 탐색. 현재 근거 없음 | 미해결 |
| 4 | 접근 불가 페이지 mention의 **plain_text 마스킹 여부** | 권한 누수 판단 | 공유되지 않은 페이지를 멘션 후 API 응답 확인 | 미해결 |
| 5 | `link_preview` 블록이 **뷰어별로 다른 내용을 렌더하는지** 확정 | 캐시 격리 설계 | 두 계정으로 같은 페이지 비교 | 미해결 |
| 6 | **`file_upload.*` / `view.*` 웹훅 이벤트가 실제 구독 가능한지** | F-09-09 아웃박스 이벤트 카탈로그에 직결 | 문서 인덱스에는 개별 레퍼런스 페이지가 있으나 "Event types & delivery" 목록에는 없음 → 개발자 포털 구독 UI에서 확인 | **신규**(3차 점검에서 발견한 문서 불일치) |
| 7 | **View 엔드포인트(`/v1/views…`)의 파라미터·필터 DSL** | 뷰를 API로 만든다면 F-09-16의 필터 DSL과 같은 구조인지 확인 필요 | `reference/create-view` / `create-view-query` 정독 | **신규**(미조사) |
| 8 | Notion MCP의 **Dynamic Client Registration 지원과 헤드리스 사용 가능 여부** | 서버 간 에이전트 연동 설계 | 현재 근거가 2차 출처(벤더 블로그)뿐 | **신규** |
| 9 | Notion Workers의 **실행 타임아웃·메모리·번들 크기·로그 보존** | 샌드박스 런타임 사양 비교 | 공식 limits 문서에 rate 한도만 있고 실행 사양 없음 | **신규** |
| 10 | Admin API의 **space export 상태 조회 엔드포인트 경로**와 아티팩트 만료 | 백업 자동화 구현 | `reference/admin/get-space-export-status` 정독 | **신규**(경로만 확인, 본문 미검증) |
| 11 | Admin API base URL 표기 불일치(`api.notion.com/admin` vs `api.notion.com/admin/v1/`, 예제의 `/v1/spaces/…` 경로) | 클라이언트 URL 조립 | 두 문서를 교차 확인하거나 실제 호출 | **신규** |
| 12 | markdown API의 `<unknown>` 표기가 **미지원/truncated/권한부족 세 사유를 구분하지 않음** | 백업 도구가 "권한 때문에 빠진 것"을 "원래 없는 것"으로 오인 | 레퍼런스에서 세 사유 확인됨. 구분 속성이 있는지는 미확인 | **부분 해소** |
| 13 | markdown `GET` 엔드포인트가 **public connection 전용인지** | 내부 통합으로 백업 스크립트를 짤 수 있는지 결정 | 1차 레퍼런스에는 제한 명시 없음 / 2차 출처는 제한 있다고 주장 → 실제 internal token으로 호출 시도 | **신규(모순)** |
| 14 | Notion Workers의 **플랜 게이팅·credits 과금 정책** | 이 표면을 따라할지 판단 | Business·Enterprise public beta, 2026-08-11부터 credits 과금(2차 출처) → 릴리스 노트 원문 확인 | **신규** |

---

## 출처

**1차(공식) — REST API 코어**
1. https://developers.notion.com/reference/intro — 베이스 URL, `Notion-Version: 2026-03-11`, JSON 규약(UUID·snake_case·ISO 8601·null 해제), 페이지네이션 필드
2. https://developers.notion.com/reference/request-limits — rate limit, 크기 제한 전체 표, 에러 코드
3. https://developers.notion.com/reference/rich-text — rich text JSON 스키마, annotations, mention 서브타입
4. https://developers.notion.com/reference/block — 블록 공통 필드, embed/bookmark/file/link_preview/synced_block 스키마
5. https://developers.notion.com/reference/post-search — search 파라미터
6. https://developers.notion.com/reference/search-optimizations-and-limitations — "전수 보장 아님", 인덱싱 지연, 직접 공유분 보장
7. https://developers.notion.com/reference/capabilities — content/comment/user capability와 상속 규칙
8. https://developers.notion.com/docs/authorization , https://developers.notion.com/reference/authentication — internal/public 인증, OAuth 파라미터·토큰 응답
9. https://developers.notion.com/guides/get-started/personal-access-tokens — **PAT 만료 7/30/90/180일·1년, 워크스페이스 1개 한정, 즉시 폐기**
10. https://developers.notion.com/reference/introspect-token , https://developers.notion.com/reference/revoke-token — 토큰 introspection·해지
11. https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03 — database → data_source 3계층 파괴적 변경
12. https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11 — **`archived`→`in_trash`, `after`→`position`, `transcription`→`meeting_notes`**
13. https://developers.notion.com/llms.txt — 리소스 전체 인덱스(View·Markdown·Async task·CLI·Workers·Admin 존재 확인)

**1차(공식) — 데이터베이스 / 프로퍼티**
14. https://developers.notion.com/reference/query-a-data-source — 필터/정렬/`is_archived`/`result_type`, **10,000행 상한과 `request_status.incomplete_reason`**
15. https://developers.notion.com/reference/filter-data-source-entries , https://developers.notion.com/reference/sort-data-source-entries — 타입별 연산자, compound `maxItems:100`
16. https://developers.notion.com/guides/data-apis/query-large-data-sources — **`created_time` 윈도잉 권장 근거**, SDK 헬퍼(v5.23.0+)
17. https://developers.notion.com/reference/page-property-values — 프로퍼티 값 타입별 JSON, 25 참조 임계, 읽기 전용 타입
18. https://developers.notion.com/reference/retrieve-a-page-property , https://developers.notion.com/reference/property-item-object — property item 단건/리스트, 페이지네이션 4종, `show_unique`/`unique`/`median` 미계산

**1차(공식) — 파일 / 댓글 / 웹훅**
19. https://developers.notion.com/guides/data-apis/uploading-small-files , .../working-with-files-and-media , https://developers.notion.com/reference/file-upload , https://developers.notion.com/reference/file-object — 3단계 업로드, 20 MiB 경계, 1시간 서명 URL
20. https://developers.notion.com/docs/working-with-comments , https://developers.notion.com/reference/create-a-comment — 댓글 앵커링, 첨부 3개, display_name
21. https://developers.notion.com/reference/webhooks — verification token, `X-Notion-Signature`(HMAC-SHA256)
22. https://developers.notion.com/reference/webhooks-events-delivery — **at-most-once, 8회 재시도/약 24시간, 순서 미보장, 집계 1분 미만, 5분 내 전달 목표**

**1차(공식) — Markdown / MCP / Admin / Workers (3차 점검 신규)**
23. https://developers.notion.com/guides/data-apis/working-with-markdown-content — `GET/PATCH /v1/pages/:id/markdown`, `update_content` vs `replace_content`, **약 20,000 블록 상한·`truncated`·`<unknown>`**
24. https://developers.notion.com/guides/data-apis/enhanced-markdown , https://developers.notion.com/reference/retrieve-page-markdown , https://developers.notion.com/reference/update-page-markdown
25. https://developers.notion.com/guides/mcp/overview , https://developers.notion.com/guides/mcp/mcp-supported-tools — **도구 전량 목록, 180 req/min·검색 30 req/min**
26. https://developers.notion.com/guides/mcp/mcp-security-best-practices , https://developers.notion.com/guides/mcp/hosting-open-source-mcp
27. https://developers.notion.com/reference/admin/intro — Admin API Enterprise 전용, 조직 콘솔에서 토큰 관리
28. https://developers.notion.com/reference/admin/scopes — **리소스 8종 × 동작 4종 스코프, read/write 독립**
29. https://developers.notion.com/reference/admin/versioning — **base `https://api.notion.com/admin/v1/`, `Notion-Version: 2026-06-01`**
30. https://developers.notion.com/reference/admin/enqueue-space-export — **`POST /v1/spaces/{space_id}/exports`, `export_type`·`on_behalf_of_user_email` 필수, `{export_job_id,status}`**
31. https://developers.notion.com/workers/get-started/overview , .../guides/syncs — Workers 정의(샌드박스 Node/TS), sync 기본 30분
32. https://developers.notion.com/workers/reference/limits — **tool/sync 600/h·60/min, 빌드 100/day, webhook 인그레스 600~1,200/min, sync DB 쓰기 1,000,000/h**
33. https://developers.notion.com/cli/get-started/overview — Notion CLI(`ntn`) 명령 표면
33-1. https://developers.notion.com/reference/retrieve-page-markdown — `page_markdown` 응답 필드, `unknown_block_ids` 최대 100, 403/404 조건, `<unknown>`의 세 가지 사유
33-2. https://www.notion.com/help/use-notion-from-your-terminal-with-notion-cli , https://www.notion.com/releases/2026-05-13 — CLI/Workers의 beta 상태와 플랜 게이팅

**1차(공식) — 헬프센터**
34. https://www.notion.com/help/embed-and-connect-other-apps — embed/bookmark/mention/link preview 구분, **Iframely 1,900+ 도메인**, 실패 조건
35. https://www.notion.com/help/import-data-into-notion — 임포트 소스·형식·매핑·크기 제한표
36. https://www.notion.com/help/export-your-content — 포맷별 옵션, 플랜 제약, 30시간/7일 만료
37. https://www.notion.com/help/back-up-your-data — 워크스페이스 전체 export 흐름
38. https://www.notion.com/help/webhook-actions — **automation webhook: 유료 전용, POST만, 인증 없음, 커스텀 헤더, 프로퍼티만·본문 불가, 자동화당 5개, 실패 시 자동 일시정지+수동 재개**
39. https://www.notion.com/help/database-automations — 트리거/액션 모델
40. https://www.notion.com/help/create-integrations-with-the-notion-api — Admin API가 Enterprise 조직 전용이라는 헬프센터 측 서술

**표준 / 2차(참고·교차검증용)**
41. https://oembed.com/ — **oEmbed 요청 파라미터, 응답 4타입과 필수 필드, 디스커버리 link 태그, 404/501/401 에러 규약, providers.json**
42. https://github.com/makenotion/notion-sdk-js — SDK 헬퍼명·시그니처·기본 `notionVersion`
43. https://ramnes.github.io/notion-sdk-py/reference/api_endpoints/ — 엔드포인트 대 SDK 메서드 매핑
44. https://www.pynotion.com/paginated-requests-in-notion/ — 페이지네이션 실사용 패턴
45. https://hookdeck.com/webhooks/platforms/guide-to-notion-webhooks-features-and-best-practices — 웹훅 운영 관점
46. https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look — 호스팅 MCP 설계 배경(벤더 블로그)
47. https://docmost.com/docs/user-guide/import-export — Notion ZIP 임포트 구현 사례
48. https://docs.getoutline.com/s/guide/doc/import-D2ZvLqz411 — export 파일 기반 임포트 전략
49. https://github.com/toeverything/AFFiNE/issues/14283 — Notion ZIP 서브페이지 임포트 실패 사례
50. https://github.com/jamalex/notion-py — 비공식 `enqueueTask(exportBlock)` export 경로
