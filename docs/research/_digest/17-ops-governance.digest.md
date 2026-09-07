# 17. 운영 · 거버넌스 — 다이제스트 (SYNTHESIS 입력용)

> 원본: `docs/research/17-ops-governance.md` (1092줄 / 127KB) · 조사일 2026-09-06
> 커버 범위: A-4 워크스페이스 분석 / A-5 멀티 리전·데이터 레지던시 / A-6 신뢰·안전 / A-7 설정 IA
> 원본 F-ID 총 13개 — 아래 인벤토리 13행과 일치 확인 완료 (`grep -c "^### F-" = 13`)

---

## 1. 기능 인벤토리 (전수 13/13)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-17-01 | 워크스페이스 분석 대시보드 — 4탭(Members/Content/AI/Search)과 탭별 접근 제어 | L | P2 | F-17-02, F-17-03, F-11-04, F-06-02, F-13-18, F-10-25 |
| F-17-02 | 분석 수집·롤업 파이프라인 & 지표 정의(edit=1분 윈도우) | L | P2 / **계측 훅 P1** | F-11-18, F-17-03, F-17-05·06, 공용 스케줄러(미정의) |
| F-17-03 | 분석 옵트아웃 3계층(개인/워크스페이스/조직) AND 게이트 | M | **P1** | F-17-02, F-11-18, F-17-12, F-17-13 |
| F-17-04 | 검색 분석(Search 탭) & 검색 품질 피드백 루프 | M | P2 / **클릭 계측 P1** | F-07-01, F-07-02, F-17-01·02·03 |
| F-17-05 | 워크스페이스 리전 배정 & 리전 인지 라우팅 | XL | P2 / **`region_id`+리졸버 P0** | organization 엔티티, F-13-18, F-12-19(별개 축) |
| F-17-06 | 리전 경계 제약 레지스트리(검색·임베딩·웹훅·데이터레이크·파일) | L | P2 / **리졸버 규율 P0** | F-17-05, F-07-06, F-10-08, F-09-09, F-12-09, F-11-12, F-08-10 |
| F-17-07 | 조직 기본 리전 지정 & 기존 워크스페이스 리전 마이그레이션 | XL | P2 (드롭 권고) | F-17-05, F-17-06, F-12-16, F-12-04 |
| F-17-08 | 공개 페이지 남용 신고 (Report page) | **S** | **P1** | F-06-08/F-13-08(공개 SSR), F-17-09, 레이트리밋 인프라 |
| F-17-09 | 모더레이션 큐 · 테이크다운 · 자동 스캔 · DMCA | L | P1 / 큐 UI는 P2 | F-17-08, 게시 파이프라인, F-11-12, F-07-06, F-17-11, CDN 퍼지 |
| F-17-10 | 공개 쓰기 경로 남용 방어(토큰·타이밍·허니팟·레이트리밋·캡차·중복차단) | M | **P1** / 계층1~3 P0 | F-13-01, F-13-02, F-06-17, F-12-09, F-08-10 |
| F-17-11 | 크롤러·색인 제어(robots / noindex / AI 크롤러 2축) | S~M | **P1** / 기본 noindex P0 | F-06-08, F-13-08, F-13-09, F-17-09, F-13-18 |
| F-17-12 | 설정 정보구조 레지스트리 (device/account/workspace/organization) | M | **P0** | organization 엔티티, F-06-02, F-13-18, F-11-12, 12 `user_setting` 흡수 |
| F-17-13 | 조직 설정 잠금(Bulk apply) & 커스텀 관리자 역할 | L | P2 | F-17-12(`lockable`), F-06-02, F-06-19, F-11-12, F-13-18 |

---

## 2. 데이터 모델 요구 (정본은 `00-canonical-data-model.md`. 여기선 "요구"만)

### 2.1 기존 엔티티 확장 요구 — 소급 불가(★)는 1일차 결정

| 대상 (정본 소유) | 요구 | 근거 | 소급 |
|---|---|---|---|
| `workspace` (02) | **★`region_id` NOT NULL** (모든 파생 저장소 라우팅의 유일 입력) | F-17-05 | 불가 — 파생 저장소 전량 재색인 |
| `workspace` | `organization_id NULL`, `analytics_enabled BOOL DEFAULT true`, `migration_state ∈ {stable, migrating_out, migrating_in}`, `previous_region_id`, `purge_previous_after` | F-17-03·07·12 | 가능 |
| `organization` (06 F-06-19가 언급만 함 → **정본 엔티티 승격 필요**) | `default_new_workspace_region`, `verified_email_domain[]`, `page_view_analytics_enabled` | F-17-07·12·13 | 조직 개념 없으면 F-17-12/13 불가 |
| `user` (14 신설 예정) | `analytics_opt_out BOOL` (**per-account**, per-device 아님), `support_access_granted_until`(기본 28일) | F-17-03, F-17-12 | 가능 |
| `page`/`block` | **★`moderation_state ∈ {none, reported, restricted, taken_down, reinstated}` — lifecycle과 직교**, `public_exposure` 파생 | F-17-09 | 가능(기본 `none`) |
| `site`/`site_seo` (13 F-13-09) | `robots_directive ∈ {inherit, index, noindex}` **+** `ai_crawler ∈ {inherit, allow, deny}` — **단일 enum을 2축 분리** | F-17-11 | 가능 |
| `audit_event` (11 F-11-12) | **★`scope ∈ {account, workspace, teamspace, organization}`** + `setting_key`/`value_before`/`value_after` | F-17-12·13 | scope는 불가 |
| `activity_event`/`page_view` (F-11-18) | `(workspace_id, occurred_at)` 파티션 + **`actor_id NULL 허용`**(옵트아웃 시 NULL 기록) | F-17-02·03 | 어려움(파티션 전환) |
| `form_submission` (13 F-13-02) | **★사이드카 분리** — `ip_hash/ua_hash/token/captcha_score/spam_score`를 DB 행 property에 넣지 말 것 | F-17-10 | 새어나간 뒤 회수 불가 |
| `block.created_by` (F-11-15) | **NULL 허용 또는 system principal** (익명 폼 제출 행) | F-17-10 | NOT NULL로 굳으면 공개 폼 붕괴 |
| `search_document`(F-07-06) / `embedding_index`(F-10-08) | `region_id` | F-17-06 | 불가 |
| `webhook_subscription`(F-09-09) | `allowed_egress_region`, `egress_acknowledged_at` | F-17-06 | 가능 |
| `user_setting` (12, scope=account/device) | scope enum **4값 확장** 후 `setting_value`로 **흡수** | F-17-12 | 흩어진 뒤엔 다중 리팩터 |
| `plan_entitlement` (F-13-18) | `feature_key` 추가: `workspace_analytics`, `data_residency`, `audit_log`, `ip_allowlist`, `custom_admin_role` | F-17-01·05·13 | 가능 |
| `acl` principal (C-7) | **`anonymous`를 principal 어휘에 추가하지 말 것** — 신고자·익명 제출자는 principal이 아니라 요청 컨텍스트 | F-17-08·10 | 설계 제약 |
| `automation` 트리거 (F-08-10) | `spam_score` 임계 미만 행에만 발화 | F-17-10 | 가능 |

### 2.2 신규 엔티티 (이 도메인 고유, 타 문서와 충돌 없음)

| 엔티티 | 목적 / 결정적 제약 | 소유 |
|---|---|---|
| `region(code, primary/backup_aws_region, api_host, search_endpoint, vector_endpoint, bucket, kafka_bootstrap, is_active)` | **엔드포인트가 코드가 아니라 데이터** | F-17-05 |
| `region_migration_job(workspace_id, from/to_region, phase, cutover_at, purge_at, error)` | 페이즈 머신 필요(boolean 불가) | F-17-07 |
| `analytics_rollup(workspace_id, day, dimension, subject_id, metric_key, value, hll_sketch)` | (workspace, day) 레인지 파티션. **고유수는 일별 값 SUM으로 계산 불가 → HLL 필수** | F-17-02 |
| `search_query_log` / `search_query_dim` | 쿼리 원본 + **k-익명 마스킹**(distinct_user < 2 → query_norm NULL) | F-17-04 |
| `abuse_report(target_type/target_id 폴리모픽, reason 4종, reporter_user_id **NULL 허용**, ip/ua_hash, content_snapshot_ref)` | 신고 1건. **신고 시점 스냅샷 없으면 조사 불가** | F-17-08 |
| `moderation_case` / `moderation_action`(append-only) / `content_scan` | N신고 → 1케이스, 조치 이력, 자동 스캔 결과 | F-17-09 |
| `staff_user` / `staff_capability` | **플랫폼 운영자 ≠ 고객 관리자. 테이블 분리 필수** | F-17-09 |
| `form_token` / `rate_limit_bucket`(Redis 권고) / `form_submission_meta` | 공개 쓰기 방어 | F-17-10 |
| `setting_definition(key, scope, value_type, default_value, required_role, required_plan, lockable, audit_event_name, group_key, order_idx, deprecated_alias[])` | **설정 화면·권한검사·감사이벤트·플랜게이트가 전부 여기서 파생** | F-17-12 |
| `setting_value(scope, scope_id, key, value, updated_by, updated_at)` | 값 저장 | F-17-12 |
| `setting_lock(organization_id, setting_key, value, locked_by, locked_at)` | **조직 1행. 워크스페이스별 복사 금지**(1000 WS × 복사 = 무효화 폭풍) | F-17-13 |
| `admin_role` / `admin_role_capability` / `admin_role_assignment` | 커스텀 관리자 역할 | F-17-13 |

### 2.3 이 도메인이 요구하지 **않는** 것 (스코프 아웃 선언)

새 삭제 상태값(C-1 무관 — moderation은 직교 축) / 새 ACL 레벨·principal 타입(C-7 무관 — 관리자 표면은 `admin_capability`로 분리) / 새 parent enum(C-9 무관) / 자체 pub-sub 채널(C-11 무관 — 분석·모더레이션은 전부 비실시간) / 행 저장 방식 EAV vs JSONB(C-2/V-2 어느 쪽이든 성립).

### 2.4 관측 스트림은 3개다 (핵심 개념)

| 스트림 | 소유 | 독자 | 보관 | 사전집계 | 옵트아웃 |
|---|---|---|---|---|---|
| `activity_event` | F-11-04 (기존) | 페이지 권한자 | 짧음 | 없음 | 불가 |
| `audit_event` | F-11-12 (기존) | 조직/WS owner | 365일 | 없음 | 불가 |
| **`analytics_rollup`** | **F-17-02 (신규 요구)** | owner + (Content 탭)멤버 | 365일 | **필수** | **가능** |

분리 이유: ① 조회 이벤트가 편집의 10~100배(원본 나열 불가) ② 옵트아웃이 감사 로그에 구멍을 내면 안 됨 ③ "page edit"이 op 1건이 아니라 1분 윈도우 1건이라 집계 정의가 다름.

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 하는 것 — "스키마 1일차 10항목"

**이 도메인에서 P0인 것은 대부분 기능이 아니라 축(axis)이다.** 기능으로서 P0인 것은 F-17-12 하나뿐.

| # | 항목 | 없으면 벌어지는 일 |
|---|---|---|
| 1 | `workspace.region_id NOT NULL` + `resolveEndpoint(ws, kind)` 리졸버 | 리전 도입 = 사실상 재작성. **값이 전부 `us` 하나여도 컬럼과 함수는 1일차에** |
| 2 | `page.moderation_state` (lifecycle과 직교) | 테이크다운=삭제가 되어 (a) 소유자 데이터를 운영자가 지움 (b) 복구가 휴지통과 얽힘 (c) 재게시를 막을 수 없음 |
| 3 | `audit_event.scope` 4값 | 과거 이벤트의 scope 판정 불가 |
| 4 | `setting_definition` 레지스트리 | **이미 06(security_policy)/11(알림)/12(테마·언어)/13(entitlement) 4곳에 흩어짐.** 5번째가 생기기 전에 통합하지 않으면 4곳 동시 리팩터 |
| 5 | 조회·편집·검색클릭 **계측 훅** | 이벤트는 소급 생성 불가(노션도 "가입일부터 수집, 백필 없음") |
| 6 | 옵트아웃 AND 게이트 함수(4항, 3항은 상수 true 가능) | 사후 삽입 시 이미 쌓인 데이터 처리가 법무 문제가 됨 |
| 7 | `form_submission_meta` 사이드카 | IP/UA가 뷰·차트·자동화·내보내기·응답사본으로 유출된 뒤 회수 불가 |
| 8 | `admin_capability` **통합 enum** | F-10-25 / F-17-01 / F-11-12 / F-07-15가 각자 정의 중 → 관리자 권한이 4개 시스템으로 분열 |
| 9 | 공개 페이지 기본값 `noindex` | 며칠만 index로 운영해도 비공개 의도 콘텐츠가 색인되고 되돌릴 수 없음 |
| 10 | `staff_user`(플랫폼 운영자) ≠ `admin_role`(고객 관리자) 테이블 분리 | 합치면 권한 사고 (WS owner가 자기 케이스를 보면 신고자 노출) |

**기능 P1 세트 — 공개 표면을 켰다면 동시에 만들어야 함**: F-17-08(S) + F-17-11(S~M) + F-17-10 계층1~3(≈0비용) + F-17-09의 테이크다운 **실행 경로**. 근거: 공개 게시(F-06-08)를 P1로 잡은 순간 법적·평판 부채가 생기고, 신고 창구가 없으면 유일한 창구가 이메일과 SNS가 된다. 실제로 2021년 노션은 대량 피싱 신고로 도메인이 차단돼 수 시간 장애를 겪었다(= 신고 경로 자체가 공격 벡터).

### 3.2 빼도 되는 것 + 대체안

| 항목 | 드롭/축소 근거 | 대체안 | 효과 |
|---|---|---|---|
| **F-17-05~07 전체 (도메인 B)** | **셀프호스팅 제품이면 리전 = 배포 위치.** SaaS 계획이 없으면 통째 드롭 — 이 도메인 최대의 스코프 절감 | `region` 테이블 1행 + `resolveEndpoint()` 헬퍼만 유지 | XL·L·XL → S |
| F-17-07 마이그레이션 | 노션도 셀프서브가 아님 | "생성 시 리전 선택, 이후 변경 불가" 선언. 필요 시 export/import(F-09-12/14) 안내 | XL → S |
| F-17-01 Members/AI/Search 탭 | Content 탭 하나로 가치 90%. AI 지표는 F-10-25 소유 | Members = 기존 멤버 목록에 "마지막 활동" 컬럼 1개 추가 | L → M |
| F-17-02 롤업·HLL·별도 분석 스토어 | 워크스페이스 1000명 규모까지 불필요 | `page_view`에 `ON CONFLICT DO UPDATE`로 (page, day, count) + `(page, day, user)` 유니크 행 COUNT DISTINCT | L → M |
| F-17-03 페이지별·조직 계층 | 계정 전역 토글로 90% | AND 게이트를 **처음부터 4항으로 작성**하고 3항을 상수 true (나중 확장이 공짜) | M → S |
| F-17-04 대시보드 | 로그만 쌓고 SQL 직접 조회로 목적 100% 달성 | `search_query_log` 적재 + 클릭 계측 훅만 | M → S |
| F-17-09 모더레이션 큐 UI | **조치 능력만 있으면 됨** | 관리자 CLI `takedown --page <id> --reason <code>` + 신고 시 이메일/Slack 알림. 이의제기는 이메일 | L → M |
| F-17-10 캡차·fingerprint 중복차단 | 오탐 비용 높고 프라이버시 문제 | 토큰+최소작성시간+허니팟+IP 레이트리밋만. Turnstile은 **리밋 초과 시에만** 호출. 중복차단은 이메일 필드 기준만 | M → S~M |
| F-17-11 sitemap·페이지별 색인 오버라이드 | 검색엔진이 링크를 따라감 | 사이트 단위 토글 1개 + 정적 robots.txt(알려진 AI 크롤러 UA 하드코딩 Disallow) | S~M → S |
| F-17-13 커스텀 역할 | 조직(멀티 워크스페이스) 개념 없으면 성립 안 함 | 고정 역할 3개(`org_owner`/`security_auditor`/`billing_admin`) 하드코딩. "조직 설정 = 항상 잠금"으로 단순화 | L → M |
| F-17-12 조직 계층 | | `device/account/workspace` 3-scope만. 레지스트리는 DB 테이블 대신 **타입 안전 TS 상수 + zod**로 시작(런타임 변경 필요해지면 테이블 승격) | M 유지 |

> 시장 근거: Docmost는 코어 AGPL-3.0 + `/ee` 프로프라이어터리(SSO·**Audit log**·SCIM이 유료 EE), AppFlowy(AGPL, 클린)는 조직·리전 개념 자체가 없음, Outline은 BSL 1.1. → **거버넌스는 오픈소스 클론이 마지막에 만드는 영역**이자 동시에 수익화 경계 힌트. 이 도메인 전체를 P0으로 잡는 것은 시장 관행과 어긋난다.

---

## 4. 기술 난제 (L/XL) — 왜 어려운가 / 권장 접근 / 기성품

| F-ID | 난이도 | 진짜 어려운 지점 | 권장 접근 | 기성품 |
|---|---|---|---|---|
| F-17-01 | L | ① 기간 합계의 고유 카운트(일별 값 SUM은 **틀린 답**) ② **Content 탭 권한 필터를 집계 *이전에* 적용** — 사후 적용하면 볼 수 없는 페이지의 조회수가 합계로 유출 ③ 365일 파티션 운영 | HLL 스케치 컬럼. 권한 필터는 **F-07-07 `search_document.principals[]` 비정규화 재사용**(재사용 안 하면 롤업 조회마다 권한 재귀로 조회 불가) | `postgresql-hll`, ClickHouse `uniqState` |
| F-17-02 | L | ① 원본 스토어 분리 결정(인프라 선택이라 되돌리기 비쌈) ② idempotent 재처리 ③ 1분 dedup을 **원장이 아니라 롤업 단계**에 두기(원장에 두면 지표가 op 수에 비례해 부풀음) | 원본은 RDB 밖(F-12-19 샤딩 규율과 충돌 회피). 롤업은 **UPSERT 덮어쓰기**(증분 가산이면 재실행 시 2배). day 경계는 **UTC**. 조회 이벤트는 **서버 사이드 발행**(클라이언트 위조 방지) | ClickHouse / DuckDB+Parquet / Postgres RANGE 파티션(월 단위, 13개 유지) |
| F-17-05 | XL | 코드량이 아니라 **모든 저장소 접근 경로를 리전 리졸버로 통과**시키는 횡단 요구 + 리전별 인프라(K8s·Kafka·ES·벡터DB·버킷) 이중화 비용 | 노션 검증 방식: workspace ID = 라우팅·파티셔닝 키, 엣지 워커가 중앙 매핑 테이블(엣지 KV 복제)로 라우팅. **계정·세션은 글로벌**(워크스페이스 스위처가 리전을 넘으므로). `(region_id, shard_id)` 2단 — 샤딩(F-12-19)과 **다른 축**. 라우팅은 인증 이전이라 미상용 ID는 기본 리전으로(존재 여부 유출 방지) | Cloudflare Workers + KV (노션과 동일 선택) |
| F-17-06 | L | 함수 1개 + 표 1개지만 **기존 코드 전수 감사**가 실제 작업. 저장소 접근이 수십 곳으로 흩어진 뒤 도입하면 XL | `resource_kind ENUM` + `resolveEndpoint()` 단일 함수. 저장소 클라이언트 직접 생성을 **린트 룰/리뷰 체크리스트로 금지**. 표에 없는 리소스 = **리전 종속 간주(fail-safe)**. **크로스 리전 synced block 금지 권고**. 사용자가 두 리전 소속이면 Quick Find는 리전별 질의 후 클라이언트 병합(랭킹 정규화 필요) | `docs/architecture/region-constraints.md` + ESLint 커스텀 룰 (비용 ≈ 0) |
| F-17-07 | XL | ① 읽기 전용 창을 전 경로에 적용 ② 파생 저장소 **재구축**(복사 아님) 오케스트레이션 ③ 컷오버 원자성(전파 지연 중 요청은 구 리전으로) ④ 30일 롤백 창 운영 | 사전 복제 + 짧은 최종 CDC 따라잡기로 읽기전용 창을 분 단위로. `WORKSPACE_MIGRATING` 거부 코드를 F-12-16 오류 UX에 추가(F-05-04 낙관적 업데이트가 이미 롤백 처리 가능). 중앙 매핑은 `workspace.region_id`의 **읽기 최적화 복제본**이지 별도 진실이 아님 | Postgres 논리 복제 + Debezium. **또는 통째 드롭 권고** |
| F-17-09 | L | ① 운영자 권한 모델 분리 ② **CDN·검색엔진 캐시 퍼지**(발행취소보다 긴급도 훨씬 높음) ③ 외부 스캐너 통합 ④ **재게시 시 케이스 자동 재개** — 없으면 테이크다운은 우회 가능한 장식 ⑤ 서브트리 범위 조치 | 테이크다운 = `moderation_state='taken_down'`, lifecycle 불변 → 공개 URL 410/404 + CDN 퍼지 + noindex 강제 + **공개 색인에서만** 제거, **앱 안에서는 계속 편집 가능**. 자동 조치는 `restrict`(경고 인터스티셜)까지, `take_down`은 사람 확인 후. 스코프 enum `node/subtree/site/workspace`. 자체 스캐너 구현 시 XL | Google Safe Browsing API, URLhaus, ClamAV |
| F-17-13 | L | ① capability enum 통합 ② **권한 상승 방지**(자기 capability의 부분집합만 부여 가능, "역할 관리" capability는 조직 owner 전용·위임 불가) ③ 사후 효과(게시 차단이 라이브 사이트를 즉시 내림) | `effective()` 4항 함수: `setting_lock(org)` > `setting_value(ws)` > `setting_value(org, 잠기지 않은 기본값)` > `definition.default_value`. **조직 값 2종 구분 필수**(기본값=덮어쓰기 가능 / 잠금=불가). 잠금 시 기존 WS 저장값을 **덮어쓰지 말 것**(해제 시 복원). 잠금 해제 후 자동 재게시는 금지, 수동 재게시 요구 | — |

---

## 5. 다른 도메인과의 접점 (SYNTHESIS가 반드시 반영할 크로스 요구)

| 대상 문서 | 이 도메인이 요구하는 것 | 근거 F-ID |
|---|---|---|
| **00 정본 데이터 모델** | `workspace.region_id`, `page.moderation_state`, `audit_event.scope`를 정본 스키마에 포함 | 05·09·13 |
| 06 permissions | F-06-19가 "언급"만 한 **`organization`을 정본 엔티티로 승격**(없으면 F-17-12/13 성립 불가). 관리자 표면 접근은 ACL이 아니라 `admin_capability`로 분리. F-06-05 조상 재귀를 서브트리 테이크다운이 재사용 | 12·13·09 |
| 07 search | `search_document.region_id` / **검색 결과 클릭 계측 훅**(랭킹 개선 F-07-02의 유일한 relevance 신호, 백필 불가) / `principals[]` 비정규화를 분석 권한 필터에 재사용 / F-07-15 관리자 콘텐츠 검색은 조직 `Data & Compliance` 하위 | 06·04·01·12 |
| 08 automation | 자동화 트리거는 `spam_score` 임계 미만 행에만 발화. **U-4가 지적한 "어느 문서도 정의하지 않은 공용 스케줄러"를 F-17-02도 요구**(자동화·반복템플릿·리마인더·verification 만료와 공유) | 10·02 |
| 09 API | `webhook_subscription.allowed_egress_region` + 고객의 경계 초과 인지 기록. 내보내기 직렬화기(F-09-14)를 신고 스냅샷에 재사용 | 06·08 |
| 10 AI | F-10-25 `admin_capability` enum을 **통합 enum으로 합류**. AI 탭은 Analytics의 한 탭이라는 IA 사실만 이 문서 담당(지표 정본은 10). 서드파티 모델 추론의 리전 소속은 미해결 | 13·01·06 |
| 11 history | `audit_event`에 scope + setting_key + value_before/after / F-11-18 조회 프라이버시를 **3계층 AND 게이트로 확장** / F-11-15 `created_by` **NULL 허용**(익명 폼 행) / `moderation_action`은 파기 대상 예외(audit_event와 동일) / legal_hold(F-11-06)와 모더레이션 보존 의무 연동 | 03·10·12·09 |
| 12 platform | `user_setting(account/device)`를 `setting_value`에 **흡수**, scope enum 4값화 / `WORKSPACE_MIGRATING` 오류 코드(F-12-16) / 오프라인 큐가 **리전 엔드포인트를 캐시하지 말 것**(F-12-04) / 샤딩(F-12-19)과 리전은 다른 차원 | 12·07·05 |
| 13 adjacent | F-13-02 폼 제출에 **사이드카 메타 테이블** 요구(행 property에 IP/UA 금지) / F-13-09 `site_seo.robots` 단일 enum → **2축 분리** / F-13-18 엔타이틀먼트에 5개 feature_key 추가 / **앱 렌더러와 분리된 공개 SSR 렌더러**가 F-17-08·11이 붙는 곳(크롤러 부하 격리 근거이기도) | 10·11·01·08 |
| 14 계정·인증(신설 예정) | `user.analytics_opt_out`(per-account), `support_access_granted_until`(기본 28일 자동 만료) | 03·12 |

---

## 6. 최우선 미해결 질문 (5)

| # | 질문 | 상태 | 클론의 확정 입장 / 영향 |
|---|---|---|---|
| Q1 | 분석 옵트아웃 3계층이 실제로 AND인가 (조직 토글이 개인 옵트아웃을 무효화하는가) | `[추정]` — 노션 문서에 우선순위 규칙 없음 | **AND로 확정 선언.** 상위 계층이 개인 옵트아웃을 덮으면 그것은 프라이버시 기능이 아니다. F-17-03 판정 함수의 정의 자체 |
| Q2 | 노션이 테이크다운을 삭제로 구현하는가, 노출 차단으로 구현하는가 (+ 이의제기 절차 존재 여부) | `[추정]` / 이의제기는 문서에 **없음**(확인된 부재) | **moderation을 lifecycle과 직교 축으로 확정.** 이 판단이 이 도메인 최대 스키마 요구(`page.moderation_state`)의 근거 전부 |
| Q3 | WS analytics 토글 off 시 기존 데이터가 삭제되는가 숨겨지는가 / 리전 마이그레이션 중 워크스페이스가 읽기 전용이 되는가 | `[확인필요]` ×2 (둘 다 노션 미공개) | 둘 다 되돌릴 수 없는 방향이므로 보수적 채택: "수집 중단 + 기존 데이터 유지·숨김", "읽기 전용 창 설계 채택" |
| Q4 | 서드파티 AI 모델 추론이 리전 안에서 일어나는가 / 공개 API에 리전별 엔드포인트가 있는가 (`developers.notion.com/docs/data-residency` 404) | `[확인필요]` | AI·통합·웹훅의 레지던시 주장 범위가 갈림. F-17-06 제약 표의 마지막 미결 행 |
| Q5 | DB 행 페이지의 조회를 부모 페이지 조회에 합산하는가 | `[클론 결정]` — 노션 문서 없음 | 지표의 의미가 갈림. 합산하면 부모 조회수가 부풀고, 안 하면 "DB 페이지는 조회수가 항상 낮다"는 착시. F-17-02 |

> 부수 미결: 공개 폼에 캡차·레이트리밋·중복방지가 **존재하지 않음**(help/forms 전수 확인) → **F-17-10 전체가 클론 자체 설계**임이 확정 / `Discoverable on the web` 기본값 미확인 → **noindex로 확정** / 노션 "Security Center"(태세 점수·커스텀 체크)는 audit 이벤트로만 존재 확인되고 헬프 문서 없음 → 스코프 아웃 / `notion.site/robots.txt` 확인 실패(302 리다이렉트).

---


## 7. 인용 가능한 노션 사실 (재조사 불필요)

- **Analytics**: Enterprise 전용 / owner=4탭·일반멤버=Content탭만 / 조회창 **365일**, Members 그래프 90일, AI탭 1일1회 갱신 / "가입일부터 수집, **백필 없음**" / Search탭 k-익명 = **2명 이상 AND 2회 이상**.
- **지표 정의**: page edit = "1분 윈도우 안에 한 사용자가 가한 모든 변경" / active member = "기간 내 페이지를 **조회한** 고유 멤버 수"(편집자 아님).
- **리전**: US us-west-2→us-east-2 / EU eu-central-1→eu-west-1 / APAC ap-northeast-1·2(일·한은 account team 문의). Enterprise 무상. "**data at rest 위치만** 변경". 리전 내 = 페이지콘텐츠·업로드파일·검색인덱스·서드파티 메시지 / 밖 = 계정정보·사용량·서브프로세서. **Calendar·Mail·Beta 미커버**. 마이그레이션은 셀프서브 아님, 구 리전 **30일 후 삭제**.
- **신고·모더레이션**: 공개 페이지 `···` → `Report page`, 사유 4종(Phishing or spam / Inappropriate content / DMCA takedown request / Other) → CX 팀 큐. **결과 통지·이의제기 절차·투명성 보고서 전부 문서에 없음**(확인된 부재). "자동+수동 조합으로 공개 페이지 스캔·식별·제거", high recall 자동 멀웨어 탐지.
- **게시·색인**: `Search engine indexing` → `Discoverable on the web` 토글. SEO 제목·설명 편집은 유료 전용. 색인까지 **최대 4주**. `Disable publishing sites and forms` 켜면 **이미 라이브인 사이트가 즉시 내려감**. notion.so/robots.txt = `Allow: /` + 초대·템플릿검색·embed 경로 Disallow + **BLEXBot / AhrefsBot / Amazonbot / SemrushBot / dotbot 전면 차단**(Amazonbot 차단 = AI 학습 크롤러 정책 → 색인/AI 2축 분리의 직접 근거) + sitemap 10개.
- **조직·계정**: `Bulk apply` → 워크스페이스 owner에게 "managed by their organization"만 표시. IP allowlist enforcement 2종(`Maintain session` 기본 = 다음 로그인 적용 / `Require re-authentication` = IP 이탈 즉시 세션 종료). 계정 이메일 최대 5개, 비밀번호 8자·고유문자 4자, support access 기본 **28일** 자동 만료. `Show my view history` = per-account / Appearance·고대비 = per-device.
- **Audit 이벤트 규모**: Page 37 / Data source 9 / Workspace 140+ / Account 16+ / Teamspace 32 / Form 5 / Organization 95+ → `setting_definition.audit_event_name` 기반 자동 발행 없이는 유지 불가 `[추정]`.

**출처 (원본에서 WebFetch로 본문 직접 확인 16건)**: notion.com/help/{workspace-analytics, data-residency, report-inappropriate-content, organization-level-controls, workspace-settings, account-settings, page-analytics, public-pages-and-web-publishing, forms(**부재 확인 근거**), data-access-consent, track-usage-in-the-notion-credits-dashboard, manage-ai-models-and-member-credit-spend} · notion.com/blog/{enabling-multi-region-data-systems-at-notion, our-content-and-use-policy} · developers.notion.com/compliance/audit-log-events · notion.so/robots.txt / 보조(△): help/audit-log, help/ip-address-restrictions, techcrunch 2021 피싱신고 장애, Docmost·AppFlowy·Outline 라이선스 비교
