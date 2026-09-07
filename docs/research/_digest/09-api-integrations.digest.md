# 09. 공개 API · 임베드 · 임포트/익스포트 — 다이제스트

> 원본: `C:/VibeCoding/notion/docs/research/09-api-integrations.md` (1,404행 / 174KB, 3차 GAP 점검 완료본)
> 조사 기준일 2026-09-06. 본 API 버전 `2026-03-11`, **Admin API는 별도 라인 `2026-06-01` + 별도 base URL `api.notion.com/admin/v1/`**.
> 기능 총 23개 (`grep -c "^### F-"` = 23, 아래 인벤토리 행 수 23 — **일치 검증 완료**).

---

## 0. 이 도메인의 한 줄 요약

"노션 데이터를 밖으로 꺼내고 밖의 것을 안으로 들이는" 경계면 전체. 2026년 기준 표면이 **5개**다: ① REST API ② MCP 도구 표면(에이전트) ③ Admin API(Enterprise, 별도 버전 라인) ④ 노코드 automation webhook ⑤ 노션 호스팅 코드 런타임(Workers/CLI). 클론은 **표면 단위로 취사선택**해야 하며 전부 따라가는 건 오답.

---

## 1. 기능 인벤토리 (전수 23)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-09-01 | 공개 REST API 리소스 표면(엔드포인트 계약) | L / XL | P1 | 블록·페이지 모델, F-09-02, F-09-04 |
| F-09-02 | 인증 & 권한(토큰 3종 × capability × 페이지 공유) | L / XL | P1 | 사용자·워크스페이스, 블록 조상경로 인덱스 |
| F-09-03 | Rich text JSON 스키마(텍스트 직렬화 계약) | M | **P0** | 블록 모델 |
| F-09-04 | 커서 페이지네이션 | S | **P0** | 안정 정렬 키(fractional index) |
| F-09-05 | Rate limit · 크기제한 · 에러 규약 · 버저닝 | M | P1 | F-09-02 |
| F-09-06 | Search 엔드포인트 | M / L | P1 | F-09-02, 검색 인덱스, F-09-04 |
| F-09-07 | Comments API | M / L | P2 (제품 댓글 자체는 P1) | 사용자, 알림, 블록 앵커, 권한 |
| F-09-08 | 파일 업로드 API & 서명 URL 만료 | M | **P0**(첨부) / P1(API) | 오브젝트 스토리지, 블록 모델 |
| F-09-09 | Webhook 구독(개발자용, verification token + HMAC) | L | P2 | 아웃박스, 잡 큐, F-09-02 |
| F-09-10 | Embed 블록(외부 iframe 삽입) | M | P1 | 블록, 슬래시커맨드, 언퍼 캐시, F-09-18 |
| F-09-11 | Bookmark · Link mention · Link Preview(언퍼링 3종) | M / XL | P1(전2) / P2(인증형) | 스크래핑 워커, F-09-03, OAuth |
| F-09-12 | 임포트: 파일 기반(MD/HTML/CSV/DOCX/TXT/ZIP) | L | P1 (**노션 export ZIP은 P0**) | F-09-08, 잡 큐, 페이지 생성 |
| F-09-13 | 임포트: 서드파티 앱(Evernote/Trello/Confluence/GDocs) | XL | P2 | OAuth 프레임워크, F-09-12 |
| F-09-14 | 익스포트: MD&CSV / HTML / PDF, 페이지·워크스페이스 | L / XL | **P0**(MD) / P1(HTML) / P2(PDF) | 직렬화기, 권한 필터, 잡 큐, 스토리지 |
| F-09-15 | 공식 SDK · 개발자 온보딩 표면 | M | P2 (OpenAPI 스펙은 P1) | F-09-01~05 |
| F-09-16 | Data source query(필터·정렬 DSL, 10,000행 상한) | L / XL | P1 (DB API 내는 순간 P0) | F-09-01, F-09-04, F-09-17, 3계층 모델 |
| F-09-17 | Page property value 스키마 & property item 엔드포인트 | L / XL | P1(직렬화) / P2(item 페이지네이션) | 프로퍼티 스키마, formula·rollup 엔진 |
| F-09-18 | oEmbed 언퍼 프로토콜 계약 | M / L | P1 | F-09-10, F-09-11, HTTP 페처, 캐시 |
| F-09-19 | Notion MCP 서버(LLM 에이전트 도구 표면) | M / L | P2 (**P2 중 최우선**) | F-09-02, F-09-22, F-09-06, F-09-16 |
| F-09-20 | Admin API(Enterprise 조직 관리) | L | P2 (감사로그 테이블만 v1) | 조직 모델, 감사 로그, F-09-14, F-09-02 |
| F-09-21 | 아웃바운드 automation webhook · iPaaS 커넥터 | M / L | P2 (체감은 F-09-09보다 큼) | 자동화 트리거 엔진, 잡 큐, 권한 |
| F-09-22 | Markdown API(Notion-flavored MD 읽기/쓰기) | M / L | **P1** | F-09-03, F-09-12/14의 파서·직렬화기 |
| F-09-23 | Notion Workers · Notion CLI(호스팅형 통합 런타임) | XL | P2 (사실상 v3) | 코드 샌드박스, 스케줄러, F-09-16 |

---

## 2. 데이터 모델 — 이 도메인이 정본 스키마에 요구하는 것

> 스키마 정본은 `00-canonical-data-model.md`. 여기서는 **요구사항만** 기술.

### 2.1 코어 엔티티에 걸리는 제약 (다른 도메인과 공유)

| 요구 | 이유 | 관련 F |
|---|---|---|
| 모든 리소스 공통 컬럼: `object_type`, **`in_trash`**(`archived` 아님), `created_by`, `last_edited_by`, `created_time`, `last_edited_time` | 2026-03-11에서 `archived`→`in_trash` 개명이 파괴적 변경이었음. 후발주자는 처음부터 올바른 이름 채택 | F-09-01 |
| **`database → data_source → page(row)` 3계층** | 2025-09-03 파괴적 변경. 나중에 끼워넣으면 모든 통합·이벤트명(`data_source.*`)이 깨짐 | F-09-01, F-09-16 |
| 블록 `parent_id` + `sort_key`(fractional index) + **`ancestor_path`(ltree/materialized path)** | 권한 상속 판정과 커서 정렬 양쪽에 필요 | F-09-02, F-09-04 |
| 블록에 `version int` (노션에 없음, 클론 차별점) | API 쓰기의 lost-update 방지(`If-Match` → 409) | F-09-01, F-09-22 |
| rich text = **플랫 런 배열**(중첩 mark 없음), `plain_text` 파생 컬럼 | ProseMirror/Slate 중첩 mark ↔ 플랫 런 어댑터가 필수 | F-09-03 |
| `block_reference(from_block_id, to_entity_id, kind)` 역인덱스 | mention 백링크·삭제 정합성 | F-09-03 |

### 2.2 이 도메인 고유 엔티티 (원본에 SQL 초안 존재)

| 클러스터 | 테이블 | 핵심 이유 |
|---|---|---|
| 인증/권한 | `integration`, `integration_capability`, `access_grant`(=bot), `grant_root` | capability(무엇을) × grant_root(어디에) **곱집합**. deny 없음 = 항상 합집합 |
| 제한/관측 | `rate_limit_bucket`(bot·workspace 2계층), `api_request_log`(`request_id` 필수) | 어느 한도에 걸렸는지 응답에 실어야 함 |
| 검색 | `search_index(title_tsv, body_tsv, acl_root_path ltree)` | ACL을 **인덱스 단계 pre-filter**로 밀어야 성능·누수 동시 해결 |
| 댓글 | `discussion(parent_type, parent_id, anchor jsonb, resolved…)`, `comment` | **discussion은 블록이 아니라 페이지가 소유**하고 블록은 앵커로만 참조(삭제/복원 생존) |
| 파일 | `file_upload`(mode/status/parts), `file_object(… ref_count)` | 하나의 `file_upload.id`가 **여러 블록에 재사용 가능** → ref_count 없이 삭제 금지 |
| 웹훅 | `webhook_subscription`, `webhook_delivery`, **`outbox`** | 트랜잭셔널 아웃박스 필수. at-most-once + 집계 debounce |
| 임베드/언퍼 | `embed_block`, `link_unfurl_cache`(전역), `link_preview_provider`, `user_link_preview_auth`(**뷰어별, 절대 공유 금지**), `oembed_provider`, `unfurl_fetch_log` | link_preview는 **페이지 콘텐츠가 뷰어별로 달라지는 유일한 블록** |
| 잡 | `import_job`+`import_item`+`path_to_page_map`+`id_map`, `export_job`+`export_item`, `space_export_job` | `path_to_page_map`=2-pass 링크 리라이팅, `id_map`=재실행 중복 방지(노션이 안 해서 CSV 재임포트가 중복 생성) |
| DB 쿼리 | `data_source`, `data_source_property`(property_id **불변 short id**), `page_property_value`(+타입별 사이드카 컬럼 num/text/date) | jsonb 단일 컬럼이면 필터 인덱스가 안 먹음 |
| 계산 프로퍼티 | `page_relation`(**배열을 행으로 정규화**), `property_dependency`, `property_computed_cache(dirty)` | relation을 jsonb 배열로 두면 25개 페이지네이션·백링크 둘 다 불가 |
| MCP | `mcp_client_connection`, `mcp_tool_call_log` | 감사 로그는 선택 아님(에이전트 행위 설명 불가 시 조직 도입 불가) |
| Admin | `org`, `org_bot_token`(**워크스페이스 토큰과 물리적으로 분리**), `legal_hold(_user)`, `permission_group(_member)`, `admin_audit_log` | 같은 미들웨어 공유 시 스코프 승격 버그 |
| 자동화 | `automation`, `automation_action`, `automation_run` | `automation_run`이 없으면 "왜 안 갔는지"를 못 보여줌 |
| Workers | `worker`, `worker_capability`, `worker_secret`, `worker_run`, `sync_state`, **`sync_record_map`** | `sync_record_map`(external_id→page_id+hash) 없으면 매 주기 중복 행 생성 |

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 하는 것 (P0)

| F | 근거 |
|---|---|
| F-09-03 Rich text 스키마 | 서식 없는 문서 앱은 성립 불가. 스키마를 **노션과 동일하게** 채택 권장(마이그레이션 도구·LLM 생태계가 이미 이 포맷을 앎) |
| F-09-04 커서 페이지네이션 | 나중에 바꾸면 파괴적 변경. `incomplete`/`request_status` 상태를 **v1 응답 봉투에 미리** 넣어라(노션은 나중에 넣느라 SDK 헬퍼로 우회 중) |
| F-09-08 파일 업로드(첨부 기능으로서) | 이미지 첨부 없는 문서 도구 없음. **API 노출은 P1** |
| F-09-14 Markdown export | 데이터 락인 없음 = 신뢰의 최소 조건. **자체 임포터의 테스트 픽스처**이기도 함 |
| F-09-12 중 **노션 export ZIP 임포트** | 노션 클론에게 경쟁 제품에서 넘어오는 유일한 실용 경로 |

### 3.2 빼도 되는 것과 대체안

| F | 빼는 이유 | 대체안 |
|---|---|---|
| F-09-09 개발자 웹훅 | at-most-once+순서미보장+8회 재시도 = 수신측·발신측 양쪽 비용 | **`GET /v1/changes?since=…`(last_edited_time 워터마크 증분 조회)**. 비용 1/5, 멱등성 문제 회피. 웹훅은 v2에서 아웃박스 위에 |
| F-09-13 서드파티 앱 직접 연동 | 앱 1개당 L, API 변경 대응이 영구 비용 | **export 파일 임포트로 통일**(.enex, Trello JSON, Confluence zip). Outline이 택한 길 |
| F-09-11 인증형 Link Preview 플랫폼 | 파트너 등록·도메인 검증·콜백 규격·뷰어별 캐시·OAuth 브로커 필요 | 수요 상위 3~5개(GitHub/Jira/Figma)만 **1급 통합으로 직접 구현**, 나머지는 OpenGraph bookmark |
| F-09-23 Workers | 멀티테넌트 코드 샌드박스는 그 자체로 별개 제품 | ① 선언형 sync 커넥터(YAML 매핑+주기) 또는 ② Cloudflare Workers/Deno에 배포시키고 OAuth+웹훅+API만 제공. `sync_record_map` 패턴은 어느 쪽이든 필요 |
| F-09-20 Admin API | 엔터프라이즈 판매 전엔 불필요 | 관리자 **웹 UI**만. 단 `admin_audit_log`·`org_bot_token` 테이블과 `/admin/v1` base path·별도 버전 라인은 **v1부터 분리**(사후 도입 시 과거 이력 없어 컴플라이언스 실패) |
| F-09-07 인라인 코멘트 앵커 | 앵커가 편집에 살아남게 하려면 CRDT relative position 필요 | v1은 **페이지 단위 댓글**만 |
| F-09-16/17의 formula·rollup 필터 | 계산 엔진이 쿼리 이전에 수렴해야 함 | 계산값은 **읽기 전용 파생값으로만 응답에 실어** 클라이언트 필터링 유도. 연산자도 절반으로(`equals`/`contains`/비교4종/`is_empty` + `and` 1단) |
| F-09-15 손으로 쓴 SDK | 생성기로 대체 가능 | OpenAPI 3.1 스펙 하나 → `openapi-typescript`/`openapi-python-client` + Scalar/Redoc + OpenAPI→MCP 자동생성 |

### 3.3 순서 재구성 (원본의 핵심 결론)

```
F-09-03 rich text
   └→ F-09-22 Markdown 계약   ← 여기 먼저 투자하면 아래 셋 비용이 동시에 내려감
        ├→ F-09-14 export (직렬화기)
        ├→ F-09-12 import (파서, = export의 역함수)
        └→ F-09-19 MCP (LLM 입출력이 곧 markdown)
F-09-04 커서 ─┐
F-09-08 파일  ┤→ F-09-01 REST → F-09-05 제한/에러 → F-09-06 search
F-09-02 권한 ─┘        └→ F-09-17 프로퍼티 값 → F-09-16 query → F-09-15 SDK
F-09-18 oEmbed → F-09-10/11  (독립 트랙, 블록 모델만 의존)
F-09-09 웹훅(아웃박스 후) → F-09-21 automation → F-09-23 Workers
```
라운드트립 테스트(block → md → block)가 export/import/MCP 셋의 회귀 테스트를 **한 번에** 커버한다.

---

## 4. 기술 난제 & 권장 접근 (L/XL 항목)

| F | 왜 어려운가 | 권장 접근 | 참고 |
|---|---|---|---|
| **F-09-01 (L/XL)** | 블록 30여 종 × 프로퍼티 24종 다형 직렬화. 필드명 하나 개명이 전 클라이언트를 깸 | JSON Schema 단일 소스 → zod/pydantic 코드 생성. v1은 `pages`/`blocks`/`search`만, DB API는 v2. 처음부터 `in_trash`·`position` 채택 | 공식 upgrade guide 2025-09-03 / 2026-03-11 |
| **F-09-02 (L/XL)** | **모든 엔드포인트가 통과하는 경로**라 사후 수정 시 전 API에 손. 토큰 3종의 편집 귀속(bot/인가자/발급자)이 감사로그·알림 수신자까지 바꿈. 해지 즉시 전파 필요 → **JWT 무상태 토큰으로는 불가** | 불투명 토큰 + 서버측 조회(캐시 TTL ≤60s). 권한 판정은 `ancestor_path` prefix 매칭(closure table/ltree). v1은 internal 토큰+단일 스코프, **capability·grant_root 테이블은 처음부터**. deny를 쓸 거면 v1부터 | 공식 authorization/capabilities/PAT 문서 |
| **F-09-06 (M/L)** | 권한이 트리 상속형 → grant 1회 변경이 수천 문서 ACL을 바꿈. ACL을 문서에 비정규화하면 대량 재색인, 안 하면 조회마다 조인 | Postgres tsvector+GIN, `acl_root_path ltree`를 인덱스에 심고 편집 이벤트 기반 증분 재색인. 노션의 "제목만 검색" 제약은 따라할 이유 없음 → 본문 색인 + `scope: title\|all` 옵션이 차별점 | search-optimizations-and-limitations |
| **F-09-09 (L)** | 노션조차 **at-most-once**로 타협(exactly-once 노리면 XL). 순서 미보장 + 집계로 인해 "누가 뭘 바꿨는지" 복원 불가. 되쓰기 → 재발화 **무한 루프** | 트랜잭셔널 아웃박스 + `(subscription_id, entity_id, type)` debounce(<1분) + 8회 지수백오프. 수신측 계약 3종(`event.id` dedupe / `timestamp` 재정렬 / reconciliation)을 문서에 못 박기. `authors`에 자기 integration_id 있으면 스킵 | webhooks-events-delivery |
| **F-09-11 인증형(XL)** | 뷰어별로 다른 콘텐츠 + OAuth 브로커 + 도메인 소유 검증 + 파트너 승인 파이프라인 | 만들지 않는다. 상위 3~5개 서비스 직접 통합 | build-a-link-preview-integration |
| **F-09-12 (L)** | 포맷 6종 + **2-pass 링크 리라이팅**(경로→id 맵 후 치환) + 부분 실패 리포트. ZIP은 `foo.md`와 `foo/`가 공존하는 노션 구조를 이해해야 계층 보존. **zip-slip**(`../`·심볼릭 링크) 취약점 | v1은 Markdown/ZIP만, 노션 export ZIP 구조를 정조준. DOCX=pandoc/mammoth, HTML=turndown 위임 | **Docmost v0.21.0**(Notion/Confluence ZIP 임포트), Outline, 반면교사 AFFiNE #14283 |
| **F-09-13 (XL)** | 소스 앱 1개당 L + API가 계속 바뀌어 유지보수가 영구 비용. 소스의 1차원 축(Trello 리스트)을 노션 **뷰 group by**로 흡수하는 매핑 감각 | export 파일 임포트로 통일 | Outline import 전략 |
| **F-09-14 (L/XL)** | 수 GB ZIP은 메모리에 못 올림(스트리밍 ZIP + 스토리지 직접 쓰기). PDF는 헤드리스 브라우저 워커 풀·폰트·페이지나눔·표 넘침 = 별도 프로젝트. 권한 없는 페이지가 **조용히 제외**되어 "구멍 난 백업" 발생 | v1은 MD&CSV ZIP만, 노션 export ZIP 레이아웃 그대로 채택. **`_export_report.json`(제외 페이지 수·사유) 동봉이 비용 대비 신뢰 효과 최대**. `POST /v1/exports`→폴링→서명URL 3엔드포인트를 **전 플랜 개방**하면 즉시 차별점 | notion-py(비공식 enqueueTask 경로), Admin enqueue-space-export |
| **F-09-16 (L/XL)** | 필터 트리 → **파라미터화 SQL 컴파일러**(injection 안전). formula/rollup을 필터에 쓰려면 계산 엔진이 쿼리 전에 수렴해야 함. 10,000행 절단을 `has_more`가 아닌 별도 상태로 표현해야 | 타입별 사이드카 컬럼 + 부분 인덱스. 계산 프로퍼티는 머티리얼라이즈. **제품 UI의 뷰 필터 빌더가 같은 DSL을 직렬화**하게 설계 | query-a-data-source, query-large-data-sources(`created_time` 윈도잉 — `last_edited_time`은 윈도우 이동으로 gap/중복 발생) |
| **F-09-17 (L/XL)** | rollup→relation→formula→rollup **계산 체인**의 무효화 전파와 **순환 검출**(위상정렬). 25 참조 임계가 읽기 경로를 둘로 쪼개 **침묵 데이터 손실**을 유발 | `page_relation` 행 정규화 + `property_dependency` 위상정렬 + `dirty` 플래그 워커. `has_more`는 **v1부터** 응답에(나중에 추가하면 클라이언트가 25개만 읽는 코드를 굳힘). `multi_select`/`relation`에 `{append,remove}` 델타 연산 제공 | page-property-values, property-item-object |
| **F-09-18 (M/L)** | 프로토콜 자체는 M이지만 **SSRF 정면 표적** + 프로바이더가 준 `html` 실행 = 워크스페이스 전역 XSS 위험 | 필수 6종 방어(DNS 재바인딩 대비 IP 재검증 / 사설·링크로컬·169.254.169.254 차단 / 리다이렉트 hop 제한 / 크기·타임아웃 상한 / 도메인별 rate limit / 전용 egress). 렌더는 **별도 origin의 sandboxed iframe(srcdoc)** 에서만. `url_hash` single-flight 락 + negative cache | **oembed.com providers.json**(378+ 등록 프로바이더)을 시드. oEmbed→OpenGraph→raw iframe 3단 폴백 |
| **F-09-19 (M/L)** | 서버 자체는 얇은 층. 비용은 "LLM이 쓰기 좋은 입도" 재설계 + **프롬프트 인젝션 = 권한 남용**(세션이 인가 사용자 권한 그대로 사용) | OpenAPI→MCP 자동생성 후 상위 5~10 도구만 수동 튜닝. 입출력은 **반드시 markdown**. 쓰기 도구에 사용자 확인 게이트 + 도구별 스코프 + `mcp_tool_call_log`. **전체 치환 도구는 아예 제공하지 말고 델타 연산만** | mcp-supported-tools, mcp-security-best-practices |
| **F-09-20 (L)** | 엔드포인트 50+, 각각이 파괴적 동작(세션 회수·PAT 폐기) → 감사·멱등성·확인 단계 필요. 개별 로직은 단순해 XL은 아님 | admin 토큰을 **다른 테이블·다른 검증 경로**에. 스코프 능력 독립(`write`가 `read`를 포함하지 않음) → 에러에 필요 스코프명 실기. export는 잡 id+폴링만 가능(최대 30h) | admin/scopes, admin/versioning |
| **F-09-21 (M/L)** | 웹훅 발사는 S. **트리거 엔진(어떤 편집이 어떤 자동화를 깨우나)** 과 루프 차단이 본체. 100행 일괄 편집 = 100 POST 폭발 | F-09-09 아웃박스 재사용하면 크게 싸짐. 페이로드에 `triggered_by`+`automation_id` 넣고 자기 유발 변경은 재트리거 금지. **실행 로그 뷰어가 즉시 체감 차별점**(노션은 느낌표+수동재개뿐). 그 전에 Zapier/Make/n8n 커넥터부터 내는 게 비용 0 | help/webhook-actions, help/database-automations |
| **F-09-22 (M/L)** | export/import 직렬화기를 **공유**하면 M, 따로 만들면 L 이상 + 왕복 불일치 버그 영구화. `replace_content`는 read-modify-write 창 전체가 lost-update 구간 | 커스텀 태그 대신 **MDX 또는 표준 directive(`:::callout`)** 채택. 미지원 블록은 `<!-- notion-block:<id> type=embed -->` 주석으로 보존 → **왕복 손실 0**(노션보다 나은 지점). markdown 갱신에 `base_version` 필수화. 블록 타입별 `md_supported` 메타 + 왕복 픽스처 매트릭스 | working-with-markdown-content, enhanced-markdown |
| **F-09-23 (XL)** | 멀티테넌트 코드 샌드박스 + 리소스 격리 + 시크릿 + 빌드 파이프라인 + 로그·과금 = 별개 제품. 워커→API→웹훅→워커 **3중 루프** | 자체 구현하지 않는다(§3.2). sync 설계의 핵심 결정은 **필드 단위 소유권(source of truth)** — 없으면 사람이 편집한 값이 다음 주기에 사라짐. 외부 삭제 시 기본은 삭제가 아니라 **아카이브** | workers-template, workers/reference/limits |

### 4.1 반드시 기억할 "숫자" (구현 시 상한 설계 근거)

| 항목 | 값 |
|---|---|
| rich text `content` / URL / equation | 2,000자 / 2,000자 / 1,000자 |
| 요청당 블록 배열 / 전체 요소 / payload | 100개 / 1,000개 / 500KB |
| **children 중첩 깊이(요청당)** | **2단** (3단 이상은 BFS 레벨 분할 큐 필수) |
| data source query 페이지네이션 상한 | **10,000행** → `request_status.incomplete_reason: query_result_limit_reached` |
| 프로퍼티 참조 임계(title/rich_text/relation/people) | **25개** 초과 시 `has_more` + property item 엔드포인트 |
| relation/multi_select/people 값 개수 | 각 100 |
| rate limit | 연결당 평균 3 rps / 워크스페이스당 별도(미공개). MCP는 **180 req/min**(검색 30/min) |
| 파일 단일 상한 | 무료 5 MiB / 유료 5 GiB, **20 MiB 초과는 multi-part 강제** |
| Notion 호스팅 파일 서명 URL | **1시간**, 공식 "캐시 금지". 미첨부 file_upload만 `expiry_time` 가짐(첨부되면 null=영구) |
| 웹훅 | at-most-once, 순서 미보장, 최대 8회 재시도/약 24h, 집계 지연 <1분, 5분 내 전달 목표 |
| 임포트 | 무료 5MB/유료 50MB(PDF 5/20MB), ZIP 5GB·10,000파일 초과 시 실패, HTML·MD·TXT **12시간당 ~120건** |
| 임포트 앱별 | Evernote ~5,000노트, Trello 보드당 ~5,000카드·세션당 10보드 |
| 익스포트 | 워크스페이스 전체 **최대 30시간**, 다운로드 링크 **7일** 만료 |
| Markdown API | **~20,000 블록** 상한 → `truncated:true` + `unknown_block_ids`(최대 100) |
| automation webhook | 유료 전용, **POST만**, 인증 없음(커스텀 헤더가 대체), 자동화당 5개, 실패 시 자동 일시정지+수동 재개 |
| Workers | tool/sync 600/h·60/min 버스트, 빌드 100/day, sync DB 쓰기 1,000,000/h |

---

## 5. 다른 도메인과의 접점

| 접점 | 내용 | 상대 도메인 |
|---|---|---|
| **블록/에디터 모델** | rich text 플랫 런 배열 ↔ 에디터 중첩 mark 어댑터. 블록 30여 종의 md 지원 여부 메타. `position` 삽입, fractional index | 블록·에디터 도메인 |
| **실시간 협업(CRDT)** | **최대 미해결 지점.** API의 "배열 통째 교체" PATCH 세만틱이 CRDT와 충돌. API 쓰기를 CRDT 트랜잭션으로 번역하는 계층 필요 `[추정]` | 협업/동시편집 도메인 |
| **데이터베이스·프로퍼티** | F-09-16/17이 요구하는 필터 DSL·프로퍼티 24종·formula/rollup 계산 엔진·순환 검출은 사실상 DB 도메인의 명세와 동일. **뷰 필터 빌더가 API 필터 DSL을 그대로 직렬화**해야 한 벌로 관리됨 | 데이터베이스/뷰 도메인 |
| **권한/공유** | capability × grant_root 곱집합, 상속만 있고 deny 없음, 404(미공유) vs 403(capability 부족) 구분. SCIM deprovision 시 토큰 즉시 무효화 요구 | 06 사용자/권한 도메인(원문에서 참조) |
| **자동화** | F-09-21은 08 도메인 F-08-13(automation 실패 시 일시정지)과 동일 대상. 트리거 엔진을 웹훅 아웃박스와 공유 | 08 자동화 도메인 |
| **검색** | F-09-06의 `search_index`는 제품 UI의 Quick Find(Cmd/Ctrl+P)와 인덱스를 공유해야 함 | 검색 도메인 |
| **댓글** | F-09-07의 discussion/anchor 모델은 제품 댓글 기능의 데이터 모델 그 자체 | 댓글/협업 도메인 |
| **파일/미디어** | F-09-08의 `file_object.ref_count`, 서명 URL 생성 시점 정책은 이미지 블록·커버·아이콘 전부에 적용 | 블록/미디어 도메인 |
| **AI/에이전트** | F-09-19 MCP + F-09-22 markdown 계약이 Notion AI 도메인의 입출력 형식 | AI 도메인 |
| **엔터프라이즈/감사** | F-09-20의 `admin_audit_log`, legal hold, permission group | 관리/거버넌스 도메인 |

---

## 6. 최우선 미해결 질문 (5)

| # | 질문 | 왜 중요 | 확인 방법 |
|---|---|---|---|
| 1 | **API 쓰기와 실시간 협업(CRDT)의 충돌 해소 방식** — 노션 공개 근거 전무 | 클론에서 API와 에디터가 같은 문서를 건드릴 때의 핵심 설계. 이걸 안 정하면 F-09-01/17/22 전부가 last-write-wins로 데이터를 잃음 | 엔지니어링 블로그·컨퍼런스 발표 추가 탐색. 없으면 **클론 자체 결정**(블록 `version` + `If-Match` 409 권장) |
| 2 | **페이지네이션 커서 TTL의 정확한 값** (공식 문서에 숫자 없음, "수 분"이라고만 알려짐) | 배치 재개 설계의 전제. 짧으면 워터마크 방식으로 전환해야 함 | 커서 발급 후 시간 간격을 늘려가며 재사용 테스트. 클론은 24h로 잡아 차별화 |
| 3 | **`file_upload.*` / `view.*` 웹훅 이벤트가 실제 구독 가능한지** (문서 인덱스에는 개별 레퍼런스 존재, "Event types & delivery" 목록에는 없음 — 공식 문서 내부 불일치) | 아웃박스 이벤트 카탈로그 확정에 직결 | 개발자 포털 구독 UI에서 실물 확인 |
| 4 | **View 엔드포인트(`/v1/views…`)의 파라미터·필터 DSL** — 2026-03-11 신설, 본 문서 미조사 | 뷰를 API로 만든다면 F-09-16의 필터 DSL과 같은 구조인지가 뷰 모델 설계를 좌우 | `reference/create-view`, `create-view-query` 정독 |
| 5 | **markdown `GET` 엔드포인트가 public connection 전용인지** (1차 레퍼런스엔 제한 명시 없음 / 2차 출처는 제한 있다고 주장 — **모순**) | internal 토큰으로 백업 스크립트를 짤 수 있는지가 F-09-22의 P1 근거를 좌우 | internal token으로 실제 호출 시도 |

> 그 외 잔여 `[확인필요]`: 접근 불가 페이지 mention의 plain_text 마스킹 여부 / link_preview의 뷰어별 렌더 확정 / Admin API base URL 표기 불일치(`/admin` vs `/admin/v1/`) / Workers 실행 타임아웃·메모리·번들 크기 / Workers 플랜 게이팅·credits 과금 정책 / MCP의 DCR 지원·헤드리스 사용 가능 여부.

---

## 7. 원본 대비 손실 없이 남긴 판단 근거 3줄

1. **버전 라인이 둘**(본 API `2026-03-11` / Admin `2026-06-01` + 다른 base URL)이고, 3계층(`database→data_source→row`)과 `in_trash`·`position` 명명은 **v1부터 채택**해야 파괴적 변경을 공짜로 회피한다.
2. **Markdown 계약(F-09-22)이 이 도메인의 지렛대**다 — export·import·MCP 셋의 공통 기반이라 투자 대비 효과가 가장 크고, 블록 API의 2단 중첩·100개 청크 제약을 통째로 우회한다. 클론에서 **블록 JSON API보다 먼저 내는 선택도 합리적**이다.
3. 이 도메인의 반복되는 실패 패턴은 **침묵 데이터 손실** 3종(25 참조 `has_more` 무시 / 10,000행 절단 / markdown 20,000블록 truncation / 권한 없는 페이지의 조용한 export 제외)이다. 클론은 `request_status`·`has_more`·`_export_report.json`·`<unknown reason=…>`을 **v1부터** 넣어 전부 명시적 실패로 바꿔라.
