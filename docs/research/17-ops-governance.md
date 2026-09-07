# 17. 운영 · 거버넌스 (분석 · 데이터 레지던시 · 신뢰안전 · 설정 IA)

> 조사일: **2026-09-06** / 모드: DOMAIN (커버리지 비평 A-4·A-5·A-6·A-7 보충) / 대상: 노션 클론(C:/VibeCoding/notion) 기획 단계
> 태그 규칙: `[추정]` = 공개 근거 없이 추론, `[확인필요]` = 실제 관리자 화면에서 재확인 필요, `[클론 결정]` = 노션에 대응물이 없어 클론이 스스로 정해야 하는 항목
> 이 문서는 **새 스키마를 정의하지 않는다.** 기존 01~13 문서가 정의한 엔티티에 **이 도메인이 무엇을 요구하는지**만 적는다. 요구사항은 §2에 한 표로 모아두었다.

## 이 문서의 위치

커버리지 비평(`_critique/coverage-critique.md`)이 지적한 4개 누락 영역을 담당한다.

| 비평 항목 | 등급 | 이 문서의 담당 F-ID |
|---|---|---|
| A-4 워크스페이스 분석 관리자 표면 | 중간 | F-17-01 ~ F-17-04 |
| A-5 멀티 리전 · 데이터 레지던시 | 중간 | F-17-05 ~ F-17-07 |
| A-6 신뢰·안전 (Trust & Safety) | 중간 | F-17-08 ~ F-17-11 |
| A-7 설정 정보구조 레지스트리 | 경미 | F-17-12 ~ F-17-13 |

기존 문서와 겹치는 부분은 **재서술하지 않고 F-ID로 참조**한다.

| 주제 | 정본 F-ID (기존 문서) | 이 문서가 추가로 담당하는 것 |
|---|---|---|
| 페이지 단위 Updates & analytics | **F-11-04** | 워크스페이스 **집계** 표면과 그 접근 제어(F-17-01) |
| 조회 프라이버시 옵트아웃 | **F-11-18** | 계정/워크스페이스/조직 **3계층 옵트아웃의 우선순위 규칙**(F-17-03) |
| 감사 로그 · SIEM | **F-11-12** | 감사 이벤트의 **scope 축(account/workspace/teamspace/organization)** 요구(F-17-13) |
| AI 사용량 분석 · 크레딧 | **F-10-12 / F-10-25** | AI 탭이 워크스페이스 Analytics의 **한 탭**이라는 IA 사실만(F-17-01) |
| 웹 게시 · Sites · SEO | **F-06-08 / F-13-08 / F-13-09** | 게시된 콘텐츠의 **모더레이션·색인 제어**(F-17-09, F-17-11) |
| 공개 폼 제출 파이프라인 | **F-13-02 / F-06-17** | 제출 경로의 **남용 방어**(F-17-10) |
| 관리자 콘텐츠 검색 | **F-07-15** | 그것이 조직 설정 `Data & Compliance` 하위라는 IA 배치(F-17-12) |
| 요금제 엔타이틀먼트 | **F-13-18** | 설정 항목의 **plan gate 축**이 설정 레지스트리의 컬럼이어야 한다는 요구(F-17-12) |
| 서버 샤딩 (`space_id NOT NULL`) | **F-12-19** | 그 위에 얹히는 **region 축**(F-17-05) — 샤딩과 리전은 다른 차원이다 |

---

## 요약 (핵심 판단 7줄)

1. **워크스페이스 분석은 "탭 4개"가 아니라 "권한 축 2개 × 데이터 파이프라인 1개"다.** Content 탭은 일반 멤버도 보지만 Members / AI / Search 탭은 **워크스페이스 owner 전용**이다. 이 비대칭은 UI 조건문이 아니라 `admin_capability` 수준의 권한 모델을 요구한다. (출처: https://www.notion.com/help/workspace-analytics)
2. **분석 지표는 정의가 곧 스키마다.** 노션은 "page edit = 한 사용자가 **1분 윈도우** 안에 페이지에 가한 모든 변경", "active member = 특정 기간에 페이지를 조회한 고유 멤버 수"로 정의한다. 이 1분 dedup 윈도우를 원장(`activity_event`)이 아니라 **롤업 단계**에 두지 않으면 지표가 편집 op 수에 비례해 부풀어 오른다.
3. **분석은 "가입 시점부터" 존재한다 — 소급 백필이 불가능하다.** 노션 명시: *"Your workspace analytics data is tracked starting on the day that you sign up for the Enterprise plan."* 클론도 동일하게, **계측 훅은 P1(스키마 1일차), 대시보드는 P2**로 분리해야 한다.
4. **데이터 레지던시는 "저장 위치 설정"이 아니라 워크스페이스 ID를 파티션 키로 삼는 아키텍처 전체다.** 노션은 *"the workspace ID as the primary routing and partitioning identifier"*로 두고 Cloudflare Worker가 리전으로 라우팅한다. 즉 **리전은 `workspace.region` 컬럼 하나가 아니라 모든 파생 저장소(검색 인덱스·벡터 DB·Kafka·데이터레이크)의 소속 축**이다. 이 축은 나중에 추가할 수 없다. (출처: https://www.notion.com/blog/enabling-multi-region-data-systems-at-notion)
5. **리전 경계를 넘는 것은 콘텐츠가 아니라 "파생물"이다.** 검색 인덱스·임베딩·데이터레이크·아웃바운드 웹훅이 리전 밖으로 나가면 레지던시가 무의미해진다. 클론이 리전을 지원할 생각이 조금이라도 있다면, **모든 파생 저장소 접근을 리전 리졸버 함수 1개를 통과시키는 규율**을 처음부터 세워야 한다. 이것이 이 도메인의 유일한 P0 아키텍처 항목이다.
6. **신뢰·안전은 "공개 표면을 만든 순간 생기는 부채"다.** 노션은 익명 읽기(Sites)·익명 쓰기(Forms) 두 경로를 열어두고 `···` → `Report page` 신고 버튼 + 자동 스캔 + CX 팀 큐로 대응한다. 신고 사유는 **Phishing or spam / Inappropriate content / DMCA takedown request / Other** 4종이다. (출처: https://www.notion.com/help/report-inappropriate-content)
7. **설정은 코드가 아니라 데이터여야 한다.** 노션은 계정 / 워크스페이스 / 조직 3계층을 가지며, 조직 설정에는 **`Bulk apply`로 워크스페이스 설정을 잠그는 오버라이드 메커니즘**이 있다(잠기면 워크스페이스 owner에게 "managed by their organization"으로만 보인다). 이것을 if-else로 구현하면 설정이 추가될 때마다 3곳을 고치게 된다 — `setting_definition` 레지스트리 테이블이 정답이다. (출처: https://www.notion.com/help/organization-level-controls)

---

## 기능 인벤토리

| ID | 기능 | 난이도 | 우선순위 |
|---|---|---|---|
| F-17-01 | 워크스페이스 분석 대시보드 — 4탭 구조와 탭별 접근 제어 | L | P2 |
| F-17-02 | 분석 수집·롤업 파이프라인 & 지표 정의(1분 편집 윈도우 등) | L | P2 *(계측 훅 심기는 **P1**)* |
| F-17-03 | 분석 옵트아웃 3계층(개인/워크스페이스/조직)과 우선순위 규칙 | M | **P1** |
| F-17-04 | 검색 분석(Search 탭) & 검색 품질 피드백 루프 | M | P2 |
| F-17-05 | 워크스페이스 리전 배정 & 리전 인지 라우팅 | XL | P2 *(`workspace.region_id` 축은 **P0**)* |
| F-17-06 | 리전 경계 제약 레지스트리(검색·임베딩·웹훅·데이터레이크·파일) | L | P2 *(리전 리졸버 규율은 **P0**)* |
| F-17-07 | 조직 기본 리전 지정 & 기존 워크스페이스 리전 마이그레이션 | XL | P2 |
| F-17-08 | 공개 페이지 남용 신고 (Report page) | **S** | **P1** |
| F-17-09 | 모더레이션 큐 · 테이크다운 · 자동 스캔 · DMCA | L | P1 |
| F-17-10 | 공개 쓰기 경로 남용 방어(캡차·레이트리밋·중복 제출) | M | **P1** |
| F-17-11 | 크롤러 · 색인 제어(robots / noindex / AI 크롤러) | S~M | **P1** |
| F-17-12 | 설정 정보구조 레지스트리 (account / workspace / organization 3계층) | M | **P0** |
| F-17-13 | 조직 설정 잠금(Bulk apply) & 커스텀 관리자 역할 | L | P2 |

---

## 1. 핵심 개념

### 1.1 이 도메인이 다루는 4개 축의 관계

```
                    ┌──────────────── organization (조직) ─────────────────┐
                    │  · 기본 리전 지정 (F-17-07)                            │
                    │  · 설정 Bulk apply 잠금 (F-17-13)                      │
                    │  · 조직 Analytics (워크스페이스 필터) (F-17-01)         │
                    │  · Data & Compliance: Content search / Audit log        │
                    └───────────────────┬────────────────────────────────────┘
                                        │ 1:N
                    ┌───────────────────▼────────────────────────────────────┐
                    │  workspace  ── region_id (F-17-05) ─────────┐           │
                    │  · Analytics 4탭 (F-17-01)                  │           │
                    │  · analytics_enabled 토글 (F-17-03)          │           │
                    └───────────────────┬─────────────────────────┼──────────┘
                                        │                         │
        ┌───────────────────────────────┴──────┐    ┌─────────────▼──────────────┐
        │ 공개 표면 (익명 접근)                  │    │ 파생 저장소 — 리전 종속      │
        │  · Sites / 공개 페이지  (F-06-08)      │    │  · search_index   (F-07-06) │
        │  · 공개 Form 제출       (F-13-02)      │    │  · embedding_index(F-10-08) │
        │       ↓                                │    │  · data lake / rollup       │
        │  Trust & Safety (F-17-08~11)           │    │  · webhook outbox (F-09-09) │
        │  · 신고 → 모더레이션 큐 → 테이크다운    │    │  · file storage   (F-12-09) │
        │  · 캡차 · 레이트리밋 · 중복 차단        │    │  ※ 전부 F-17-06의 제약 대상  │
        │  · robots / noindex                    │    └─────────────────────────────┘
        └────────────────────────────────────────┘
```

### 1.2 개념 1 — "관측(observability)"은 3개의 서로 다른 이벤트 스트림이다

11-history-notifications.md가 이미 `activity_event`(제품 기능용)와 `audit_event`(컴플라이언스용)를 분리했다. 이 도메인은 **세 번째 스트림**을 추가로 요구한다.

| 스트림 | 소유 F-ID | 독자 | 보관 | 집계 여부 | PII |
|---|---|---|---|---|---|
| `activity_event` | F-11-04 (기존) | 페이지 권한자 | 짧음 | 없음 (원본 나열) | 행위자 노출 |
| `audit_event` | F-11-12 (기존) | 조직/워크스페이스 owner | 김 (노션 365일) | 없음 (원본 나열) | 행위자 노출 |
| **`analytics_rollup`** | **F-17-02 (신규 요구)** | 워크스페이스 owner + (Content 탭은) 멤버 | 365일 | **필수 (사전 집계)** | **옵트아웃 가능** |

세 번째가 왜 별개인가:
- **조회 이벤트는 편집 이벤트보다 10~100배 많다**(F-11-18이 이미 지적). 원본 나열이 불가능하다.
- **옵트아웃 대상이다.** `audit_event`는 사용자가 끌 수 없지만 조회 분석은 끌 수 있다(F-17-03). 같은 테이블에 두면 옵트아웃이 감사 로그에 구멍을 낸다.
- **집계 정의가 원본과 다르다.** "page edit"은 op 1건이 아니라 1분 윈도우 1건이다.

> `[확인필요]` 노션이 이 세 스트림을 물리적으로 분리했는지는 공개되지 않았다. 다만 audit log에 `Content Analytics exported` / `User Analytics exported` / `Workspace analytics tracking toggled` / `User analytics tracking toggled` 이벤트가 **별도로** 존재한다는 사실은 분석이 감사 로그의 부분집합이 아니라 별도 시스템임을 시사한다. (출처: https://developers.notion.com/compliance/audit-log-events)

### 1.3 개념 2 — 리전은 "설정"이 아니라 "파티션 키"다

노션의 다중 리전 설계에서 확인된 사실:

| 사실 | 원문/근거 |
|---|---|
| 파티션 키는 workspace ID | *"the workspace ID as the primary routing and partitioning identifier"* |
| 라우팅은 엣지에서 | *"space-aware workers direct the traffic to a server in the appropriate region and network"* (Cloudflare Workers) |
| 워크스페이스→리전 매핑은 **중앙 1개** | *"a centralized mapping table that acts as the source of truth for each workspace's active region"* |
| 검색은 리전 전용 클러스터 | *"Search for EU workspaces is powered by a dedicated Elasticsearch cluster that builds its indices exclusively from EU data"* |
| 임베딩도 리전 전용 | 리전 Kafka → 리전 Spark → **리전 vector DB** |
| CDC 파이프라인도 리전별 | Debezium(K8s) → Kafka → Spark → **리전 data lake** |
| 오케스트레이션은 글로벌 | Airflow는 미국 데이터센터 — *"doesn't process any customer data directly"* |
| 내부 분석은 정제 후 반출 | *"a data sanitization pipeline that removes all customer data before anything leaves its region"* |
| 리전 추상화는 공유 라이브러리 | *"a shared library that defines enumerated region types and helper methods for mapping between resources"* |

**클론이 여기서 가져가야 할 유일한 교훈**: "리전 enum + 리소스 매핑 헬퍼"를 **공유 라이브러리 하나로** 만들고, 모든 파생 저장소 접근이 그 함수를 거치게 강제하라. 리전을 실제로 켜지 않더라도 이 규율만 지키면 나중에 켜는 비용이 XL에서 L로 내려간다. 반대로 코드 곳곳에 `ELASTIC_URL` 상수를 박아두면 리전 도입은 사실상 재작성이다.

### 1.4 개념 3 — 모더레이션 상태는 삭제 상태와 **직교한다**

비평 C-1이 지적한 대로 클론은 삭제 상태 머신(`live / trashed / retained / purged`)을 하나로 정해야 한다. **이 도메인은 그 축에 값을 추가하지 않는다.** 대신 **별도의 직교 축**을 요구한다.

```
lifecycle    :  live ─── trashed ─── retained ─── purged      (F-11-06 소유, 사용자 행위)
                 │
moderation   :  none ─── reported ─── restricted ─── taken_down ─── reinstated
                                                        (F-17-09, 운영자 행위)
```

두 축이 왜 섞이면 안 되는가:

| 시나리오 | lifecycle | moderation | 결과 |
|---|---|---|---|
| 사용자가 신고당한 페이지를 스스로 삭제 | `trashed` | `reported` | 신고는 살아 있어야 한다(재게시 방지) |
| 운영자가 테이크다운했으나 소유자는 원본 보유 | `live` | `taken_down` | **앱 안에서는 편집 가능, 공개 URL만 404** |
| 테이크다운 후 이의제기 인용 | `live` | `reinstated` | 공개 복구. lifecycle은 변한 적 없다 |
| 파기(GC) 대상인데 법적 보존 중 | `retained` | — | legal hold가 우선(F-11-06이 이미 소유) |

**테이크다운 = 삭제가 아니다.** 삭제로 구현하면 (a) 소유자의 데이터를 운영자가 지우는 것이 되고 (b) 복구가 휴지통 복원과 얽히며 (c) 재게시를 막을 수 없다. 이것은 이 문서가 기존 스키마에 요구하는 가장 중요한 한 가지다.

---

## 2. 기존 엔티티에 대한 요구사항 (schema_requirements)

> **이 절이 이 문서의 핵심이다.** 새 테이블 정의가 아니라, 이미 정본이 정해질 예정인 엔티티들이 이 도메인 때문에 **반드시 가져야 하는 필드·축**의 목록이다. 각 항목에 요구 근거 F-ID를 붙였다.

### 2.1 기존 엔티티 확장 요구

| 대상 엔티티 (정본 소유) | 요구 사항 | 근거 | 소급 가능? |
|---|---|---|---|
| `workspace` (02) | **`region_id` NOT NULL** — 리전 enum FK. 모든 파생 저장소 라우팅의 유일한 입력 | F-17-05 | **불가**. 파생 저장소가 이미 쌓인 뒤에는 재색인 전량 필요 |
| `workspace` (02) | `organization_id NULL` — 조직 미소속 워크스페이스 허용(무료/개인) | F-17-12, F-17-13 | 가능 |
| `workspace` (02) | `analytics_enabled BOOL DEFAULT true` — 워크스페이스 단위 분석 수집 스위치 | F-17-03 | 가능 |
| `workspace` (02) | `migration_state ∈ {stable, migrating_out, migrating_in}` — 리전 이전 중 쓰기 정책 분기 | F-17-07 | 가능 |
| `organization` (06 F-06-19가 언급만 함 — **정본 엔티티로 승격 필요**) | `default_new_workspace_region`, `verified_email_domain[]`, 잠금 설정 참조 | F-17-07, F-17-13 | 가능하나 조직 개념 자체가 없으면 F-17-12/13 전부 불가 |
| `user` (14 계정 도메인 — 비평 A-1이 신규 작성 권고) | **`analytics_opt_out BOOL DEFAULT false`** (per-account, per-device 아님) | F-17-03 | 가능 |
| `user` (14) | `support_access_granted_until TIMESTAMPTZ NULL` — 노션 기본 28일 만료 | F-17-12 | 가능 |
| `page`/`block` (01/02/03 — C-3 결정 대상) | **`moderation_state` 축** — lifecycle과 **직교**. `{none, reported, restricted, taken_down, reinstated}` | F-17-09 | 가능 (기본값 `none`) |
| `page`/`block` | `public_exposure` 파생 필드 — 06 F-06-19가 이미 요구. 모더레이션 큐의 대상 집합을 이 필드로 좁힌다 | F-17-09, F-17-11 | 가능하나 재계산 배치 필요 |
| `site` / 공개 페이지 (06 F-06-08 / 13 F-13-08·F-13-09의 `site`·`site_seo`) | `robots_directive ∈ {index, noindex}` + `ai_crawler ∈ {allow, deny}` **2개 축으로 분리** | F-17-11 | 가능 |
| `acl` / principal (C-7 결정 대상) | principal 어휘에 **`anonymous`를 추가하지 말 것** — 신고자·미인증 폼 제출자는 principal이 아니라 **요청 컨텍스트**다 | F-17-08, F-17-10 | — (설계 제약) |
| `audit_event` (11 F-11-12) | **`scope ∈ {account, workspace, teamspace, organization}` 컬럼 필수.** 노션 audit log가 이 축으로 분류되어 있다 | F-17-13 | **불가**. 나중에 넣으면 과거 이벤트의 scope 판정 불가 |
| `audit_event` (11) | 설정 변경 이벤트용 `setting_key` + `value_before` + `value_after` | F-17-12, F-17-13 | 가능 |
| `activity_event` / `page_view` (11 F-11-18) | 롤업 잡의 입력이 되려면 `(workspace_id, occurred_at)` 파티션 + `actor_id NULL 허용`(옵트아웃 시 NULL 기록) | F-17-02, F-17-03 | 어려움 (파티션 전환) |
| `form_submission` (13 F-13-02가 "DB 행 자체"로 규정) | 행 본문이 아니라 **사이드카 테이블**에 `ip_hash`, `ua_hash`, `submission_token`, `captcha_score` — DB 행에 넣으면 뷰·차트·자동화·내보내기에 전부 새어 나간다 | F-17-10 | 가능 |
| `block.created_by` (11 F-11-15) | **NULL 허용 또는 system principal** — 익명 폼 제출로 만들어진 행의 작성자가 없다 | F-17-10 | 가능하나 NOT NULL로 굳으면 공개 폼 경로가 깨짐 |
| `search_index` / `search_document` (07 F-07-06 정본) | `region_id` — 리전별 물리 인덱스 분리 시 라우팅 키 | F-17-06 | **불가** |
| `embedding_index` (10 F-10-08) | `region_id` — 동일 | F-17-06 | **불가** |
| `webhook_subscription` (09 F-09-09) | `allowed_egress_region` / `egress_acknowledged_at` — 아웃바운드가 리전 경계를 넘는지 판정 | F-17-06 | 가능 |
| `user_setting` (12 `scope='account'|'device'`) | scope enum을 **4값(`device / account / workspace / organization`)으로 확장**하고 F-17-12의 `setting_value`로 흡수 | F-17-12 | 가능하나 흩어진 뒤에는 다중 리팩터 |
| `plan_entitlement` (13 F-13-18) | `feature_key`에 `workspace_analytics`, `data_residency`, `audit_log`, `ip_allowlist`, `custom_admin_role` 추가 | F-17-01, F-17-05, F-17-13 | 가능 |
| `automation` 트리거 (08 F-08-10) | 트리거는 `spam_score` 임계 미만 행에만 발화 | F-17-10 | 가능 |

### 2.2 신규 엔티티 (이 도메인 고유 — 다른 문서와 충돌 없음)

| 엔티티 | 목적 | 소유 F-ID |
|---|---|---|
| `region` | 리전 enum + 리소스 엔드포인트 매핑 (**중앙 1개 테이블**) | F-17-05 |
| `region_migration_job` | 리전 이전 페이즈 머신 | F-17-07 |
| `analytics_rollup` | (workspace, day, dimension) 사전 집계 + HLL 스케치 | F-17-02 |
| `search_query_log` / `search_query_dim` | 검색 쿼리 원본 + k-익명 마스킹 차원 | F-17-04 |
| `abuse_report` | 신고 1건 (익명 가능) | F-17-08 |
| `moderation_case` | 신고 N건 → 케이스 1건 (동일 대상 병합) | F-17-09 |
| `moderation_action` | 케이스에 대한 운영자 행위 이력 (append-only) | F-17-09 |
| `content_scan` | 자동 스캔 결과 | F-17-09 |
| `staff_user` / `staff_capability` | **플랫폼 운영자** (고객 관리자와 분리) | F-17-09 |
| `form_token` / `rate_limit_bucket` / `form_submission_meta` | 공개 쓰기 방어 | F-17-10 |
| `setting_definition` | 설정 항목 레지스트리 (**코드 아님, 데이터**) | F-17-12 |
| `setting_value` | (scope, scope_id, key) → 값 | F-17-12 |
| `setting_lock` | 조직이 잠근 설정 키 (**조직 1행**, 워크스페이스 복사 금지) | F-17-13 |
| `admin_role` / `admin_role_capability` / `admin_role_assignment` | 커스텀 관리자 역할 | F-17-13 |

### 2.3 이 도메인이 **요구하지 않는** 것 (스코프 아웃 선언)

- 새로운 삭제 상태 값 (C-1 결정에 영향 없음 — moderation은 직교 축)
- 새로운 ACL 레벨이나 principal 타입 (C-7 결정에 영향 없음 — 관리자 표면 접근은 ACL이 아니라 `admin_capability`로 분리)
- 새로운 parent enum 값 (C-9 결정에 영향 없음)
- 자체 pub/sub 채널 (C-11 결정에 영향 없음 — 분석·모더레이션은 전부 비실시간)
- 행 저장 방식(EAV vs JSONB, C-2/V-2)에 대한 선호 — 이 도메인은 어느 쪽이든 성립한다

---

## 3. 기능 명세

## A. 워크스페이스 분석

### F-17-01 워크스페이스 분석 대시보드 — 4탭 구조와 탭별 접근 제어

- **한 줄 정의**: 워크스페이스 전체의 콘텐츠 조회·멤버 활동·AI 사용·검색 쿼리를 관리자가 하나의 화면에서 집계로 보고 CSV로 내보낸다.
- **사용자 시나리오**:
  1. 워크스페이스 owner가 `Settings` → `Analytics` 진입. (Enterprise 플랜 전용)
  2. 상단 탭 4개: `Members` / `Content` / `AI` / `Search`.
  3. `Members` 탭 — 최근 90일 활성 멤버 추이 그래프 + 멤버별 표(페이지 조회수 / 페이지 편집수 / 마지막 활동). 각 컬럼으로 정렬.
  4. `Content` 탭 — 페이지별 표(조회수 / 고유 조회자 / 마지막 편집일). 페이지명 검색, `생성일`·`생성자`·`teamspace` 필터.
  5. `AI` 탭 — 활성 AI 멤버 수 / AI 액션 수 / 인당 액션 수. `Agents` / `Connectors` / `Meeting Notes`로 필터. **AI 응답에 등장한 상위 100개 페이지** 표. 하루 1회 갱신.
  6. `Search` 탭 — 검색 쿼리·빈도·클릭률.
  7. `Members`·`Content`는 `Export to CSV` 버튼, `AI` 탭은 표 상단 다운로드 아이콘으로 내보낸다.
  8. 일반 멤버가 같은 경로로 들어가면 **`Content` 탭 하나만** 보인다.
- **동작 상세**:

  | 항목 | 동작 | 근거 |
  |---|---|---|
  | 플랜 게이트 | *"Workspace analytics is an Enterprise Plan feature"* | help/workspace-analytics |
  | 탭별 접근 | owner = 4탭 전부 / 멤버 = `Content`만 | 동 문서 |
  | 조회 창 | **365일** | 동 문서 |
  | 데이터 시작점 | *"tracked starting on the day that you sign up for the Enterprise plan"* — **소급 없음** | 동 문서 |
  | Members 그래프 | 최근 **90일** 활성 멤버 (표는 365일 창) | 동 문서 |
  | AI 탭 갱신 | *"once daily"* (실시간 아님) | 동 문서 |
  | Search 탭 필터 | **2명 이상**이, **2회 이상** 검색한 쿼리만 표시 | 동 문서 (F-17-04에서 상술) |
  | 조직 레벨 | 조직 콘솔에도 `Analytics` 탭이 있고 **워크스페이스별·기간별 필터**가 붙는다 | help/organization-level-controls |
  | 내보내기 감사 | `Content Analytics exported` / `User Analytics exported` audit 이벤트 발생 | developers.notion.com/compliance/audit-log-events |

- **지표 정의 (이것이 스키마다)**:

  | 지표 | 노션의 정의 | 클론 구현 함의 |
  |---|---|---|
  | Page edit | *"All changes that an individual user makes to a page within a 1 minute window"* | (user, page, floor(ts/60s))로 **dedup 후 카운트** |
  | Active members | *"Number of unique members who viewed a page in a particular period"* | 편집자가 아니라 **조회자** 기준. HLL/DISTINCT |
  | AI action | *"A user-initiated interaction with an AI feature"* | 시스템 트리거(자동화·에이전트 스케줄)는 **제외**해야 정의에 맞음 `[추정]` |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 (신규 워크스페이스) | 백필 불가이므로 "N일 전부터 수집 중" 배너를 띄운다. 0을 보여주면 버그로 오인된다 |
  | 멤버가 삭제됨 | 롤업 행은 남고 표시명은 "Deleted user"로 폴백. **user_id를 롤업에서 지우면 과거 합계가 변한다** |
  | 페이지가 휴지통/파기됨 | `Content` 탭에서 제외하되 합계 포함 여부를 정해야 함 → **파기 시 롤업도 파기**(F-11-18 연쇄 정리 규칙), 휴지통 단계는 유지 |
  | 권한 없음 | 멤버가 `Content` 탭에서 **자신이 볼 수 없는 페이지**의 조회수를 보면 안 된다. 롤업 조회에 권한 필터를 걸어야 하며, 이것이 이 기능을 M이 아닌 L로 만드는 주된 원인 |
  | 대용량 | 페이지 100만 개 × 365일 = 롤업 행 폭발. **(workspace_id, day) 파티션 + 상위 N만 물리화**가 필수 |
  | 동시편집 | 무관 (배치 집계) |
  | 삭제된 참조 | teamspace 필터의 대상 teamspace가 삭제되면 필터 값을 무효화하고 전체로 폴백 |
  | 옵트아웃 사용자 | 조회 카운트에는 포함되나 **조회자 목록에는 미등장**(F-17-03) → "고유 조회자 수 > 목록 행 수"가 정상이라는 것을 UI가 설명해야 함 `[추정]` |
  | 플랜 강등 | Enterprise → 하위 플랜 시 대시보드는 잠기지만 **롤업 데이터는 삭제하지 않는다**(재업그레이드 복원) |

- **데이터 모델 함의**:
  - `analytics_rollup(workspace_id, day DATE, dimension ENUM('member','content','ai','search'), subject_id UUID, metric_key TEXT, value BIGINT, hll_sketch BYTEA NULL, PRIMARY KEY(workspace_id, day, dimension, subject_id, metric_key))` — (workspace_id, day) 레인지 파티션.
  - **고유 카운트는 `value BIGINT`로 표현 불가**. 일별 스케치를 합쳐야 기간 합계의 고유 수가 나온다 — SUM으로 계산하면 틀린다. 이것이 `hll_sketch` 컬럼이 필요한 이유다.
  - 탭 접근 제어는 ACL이 아니라 `admin_capability(workspace_id, user_id, capability)`. 10-ai-features.md F-10-25가 이미 동일 구조(`view_ai_analytics` 등)를 요구했다. **이 도메인은 그 capability enum에 `view_member_analytics`, `view_search_analytics`, `view_content_analytics`, `export_analytics`를 추가할 것을 요구한다** — 통합 enum은 F-17-13이 소유.
  - `Content` 탭의 권한 필터는 07 F-07-07의 `search_document.principals[]` 비정규화를 재사용할 수 있다. 재사용하지 않으면 롤업 조회마다 권한 재귀가 돌아 조회가 불가능해진다.
- **UI/인터랙션**: 설정 모달 좌측 네비 `Analytics` → 상단 탭 4개. 표는 컬럼 헤더 클릭 정렬, 상단 우측 기간 선택기(최대 365일), `Export to CSV`. AI 탭만 표 우상단 다운로드 아이콘(비대칭 — 원본 그대로). 멤버 표 행 클릭 → 멤버 상세 `[확인필요]`.
- **의존 기능**: F-17-02(수집·롤업), F-17-03(옵트아웃), F-11-04(페이지 단위 원본 이벤트), F-06-02(역할), F-13-18(플랜 게이트), F-10-25(AI 탭의 실제 지표는 AI 도메인 소유).
- **구현 난이도**: **L** — 대시보드 UI 자체는 M이지만, ① 고유 카운트의 정확한 기간 합계(HLL), ② `Content` 탭의 권한 필터를 집계 **이전에** 적용, ③ 365일 파티션 운영이 각각 독립 작업이다. ②를 집계 이후에 적용하면 볼 수 없는 페이지의 조회수가 합계로 새어 나간다(13-adjacent-products.md가 차트 엔진에서 지적한 것과 같은 유출 패턴).
- **우선순위**: **P2** — 제품 가치가 아니라 조직 판매용 기능이다. **단 F-17-02의 계측 훅은 P1**: 나중에 대시보드를 만들 때 과거 데이터를 만들어낼 방법이 없다.
- **클론 시 현실적 대안**: 4탭 중 **`Content` 탭 하나만** 만든다(페이지별 조회수·고유 조회자·마지막 편집). `Members`는 "마지막 활동 시각" 컬럼 1개를 기존 멤버 목록 화면에 추가하는 것으로 대체. `AI`는 F-10-25가 이미 소유하므로 링크만. `Search`는 F-17-04를 P2로 미룬다. 이렇게 하면 L → **M**.
- **참고 출처**: https://www.notion.com/help/workspace-analytics , https://www.notion.com/help/organization-level-controls , https://developers.notion.com/compliance/audit-log-events

---

### F-17-02 분석 수집·롤업 파이프라인 & 지표 정의

- **한 줄 정의**: 사용자의 조회·편집·AI·검색 행위를 이벤트로 수집해 (워크스페이스, 일자, 대상) 단위로 사전 집계하고 365일간 보관한다.
- **사용자 시나리오**: (사용자에게 직접 보이지 않는 백엔드 기능) 관리자 관점에서는 — 어제 오후에 팀이 본 페이지가 오늘 아침 `Content` 탭에 반영되어 있다. AI 탭만 하루 1회 갱신이라 오늘 오전의 AI 사용은 내일 보인다.
- **동작 상세**:

  | 단계 | 동작 | 비고 |
  |---|---|---|
  | 1. 수집 | 클라이언트/서버가 `page_view`, `page_edit`, `ai_action`, `search_query` 이벤트 발행 | F-11-18이 정의한 `page_view` 재사용 |
  | 2. 옵트아웃 필터 | **수집 시점**에 3계층 옵트아웃 판정 (F-17-03) | 집계 시점이 아니다 |
  | 3. dedup | `page_edit`을 (user, page, 1분 버킷)로 1건 축약 | 노션 정의 그대로 |
  | 4. 롤업 | 일 단위 배치로 `analytics_rollup` 갱신 | AI는 1일 1회 확정 |
  | 5. 보관 | 365일 초과 파티션 드롭 | 파티션이므로 DELETE 아님 |
  | 6. 파생 삭제 | 페이지 파기 시 해당 subject 롤업 삭제 | F-11-18 연쇄 정리 규칙 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 이벤트 0건인 날은 롤업 행을 만들지 않는다(sparse). UI가 0으로 채움 |
  | 중첩 | 페이지 안의 인라인 DB 행을 열면 조회 이벤트 2건(부모 페이지 + 행 페이지) → **행 페이지 조회를 부모에 합산할지 결정 필요** `[클론 결정]`. 합산하면 부모 조회수가 부풀고, 안 하면 "DB 페이지는 조회수가 항상 낮다"는 착시 |
  | 동시편집 | 두 사용자가 같은 1분 안에 편집 → dedup 키에 user_id가 있으므로 2건. **한 사용자의 100개 op는 1건** |
  | 삭제된 참조 | 이미 롤업된 뒤 페이지 삭제 → 휴지통이면 유지, 파기면 삭제 |
  | 권한 없음 | 조회 이벤트는 권한이 있었으니 발생한 것. **사후 권한 박탈 시 과거 조회 기록은 남긴다**(감사 관점) |
  | 대용량 | 조회 이벤트 초당 수천 건 → 원본을 RDB에 직접 넣지 말고 **큐 → 배치 적재**. F-11-18이 "가장 큰 테이블 3개가 이 도메인에서 나온다"고 이미 경고 |
  | 시간대 | "day" 경계가 **워크스페이스 시간대**인가 UTC인가 `[클론 결정]`. UTC 권고 — 12 F-12-14의 "UTC 저장" 규율과 일관 |
  | 재처리 | 배치 실패 시 idempotent 재실행이 되려면 롤업이 **UPSERT(덮어쓰기)** 여야 한다. 증분 가산이면 중복 실행 시 값이 2배가 된다 |
  | 클라이언트 위조 | 조회 이벤트를 클라이언트가 보내면 조작 가능 → 서버 사이드 렌더/조회 API에서 발행하는 편이 안전 `[클론 결정]` |

- **데이터 모델 함의**:
  - `analytics_event_raw`는 **RDB 밖**(ClickHouse / S3+Parquet / Kafka)에 두는 것이 옳다. RDB에 두면 F-12-19의 샤딩 규율(`space_id NOT NULL`)과 보관 정책이 충돌한다.
  - `analytics_rollup`은 §2.2 정의(HLL 스케치 컬럼 포함).
  - 파티션: `PARTITION BY RANGE (day)`, 월 단위. 365일 = 13개 파티션 유지.
  - `analytics_rollup`에 `region_id`는 **불필요**하다 — workspace_id가 리전을 결정한다(F-17-05). 단 **롤업 저장소 자체가 리전 안에 있어야 한다**(F-17-06).
  - 이 파이프라인은 08 U-4가 지적한 **"어느 문서도 정의하지 않은 공용 스케줄러"** 를 요구한다. 자동화(F-08-10)·반복 템플릿(F-08-04)·리마인더(F-11-10)·verification 만료(F-03-23)와 **같은 스케줄러를 쓴다**.
- **UI/인터랙션**: 없음(백엔드). 관리자 화면에 "마지막 갱신 시각"만 노출.
- **의존 기능**: F-11-18(`page_view`·`activity_event` 원본과 수명 정책), F-17-03(옵트아웃), F-17-05/06(리전 소속), 공용 잡 스케줄러(미정의).
- **구현 난이도**: **L** — 수집 훅은 S, 배치 롤업은 M이지만 ① 고유 카운트 스케치 ② idempotent 재처리 ③ 파티션 운영 ④ 원본 스토어 분리 결정이 겹친다. 특히 ④는 인프라 선택(ClickHouse 도입 여부)이라 되돌리기 비싸다.
- **우선순위**: **P1 (계측 훅) / P2 (롤업·보관)** — 비대칭 우선순위다. `page_view` 이벤트를 발행하는 코드 한 줄은 첫 주에 넣어야 하고, 롤업 파이프라인은 나중에 붙여도 된다. **이벤트를 안 쌓으면 나중에 만들 수 없고, 롤업은 나중에도 만들 수 있다.**
- **클론 시 현실적 대안**: 별도 분석 스토어 없이 `page_view` 테이블에 `INSERT ... ON CONFLICT DO UPDATE`로 (page_id, day, count) 유지. 고유 조회자는 `(page_id, day, user_id)` 유니크 행 + COUNT DISTINCT — 워크스페이스 1000명 규모까지 충분하다. HLL은 그 이후에.
- **참고 출처**: https://www.notion.com/help/workspace-analytics , https://www.notion.com/help/page-analytics

---

### F-17-03 분석 옵트아웃 3계층과 우선순위 규칙

- **한 줄 정의**: 개인·워크스페이스·조직 세 계층이 각각 조회 기록 수집을 끌 수 있고, 하나라도 꺼져 있으면 기록되지 않는다.
- **사용자 시나리오**:
  1. (개인) `Settings` → `Preferences` → `Privacy` → `Show my view history`를 `Don't record`로 변경 → 이후 내가 연 페이지의 Analytics 조회자 목록에 내가 나타나지 않는다.
  2. (개인, 페이지 단위) 특정 페이지 `···` → `Updates & analytics` → `Analytics` 탭 → `Settings` → `My view history`를 `Don't record`.
  3. (워크스페이스 owner) `Settings` → `General` → `Save and display page view analytics` 토글 off → 워크스페이스 전체에서 조회 분석이 꺼진다.
  4. (조직 owner) 조직 콘솔에서 페이지 조회 분석 토글 off → 산하 모든 워크스페이스에 강제된다.
- **동작 상세**:

  | 계층 | 설정 이름 | 감사 이벤트 | 근거 |
  |---|---|---|---|
  | 계정 | `Show my view history` (Preferences → Privacy) | `User analytics tracking toggled` | help/page-analytics , audit-log-events |
  | 페이지별(계정) | Analytics 탭 → `Settings` → `Don't record` | `[확인필요]` | help/page-analytics |
  | 워크스페이스 | `Save and display page view analytics` (Settings → General) | `Workspace analytics tracking toggled` | help/workspace-settings , audit-log-events |
  | 조직 | `Page view analytics toggled for the organization` | 동명 이벤트 | audit-log-events |

- **우선순위 규칙 (AND 게이트)**:

  ```
  record_view(user, page) :=
        org_analytics_enabled(workspace.org_id)      -- 기본 true, 조직이 끄면 false
    AND workspace.analytics_enabled                   -- 워크스페이스 owner 토글
    AND NOT user.analytics_opt_out                    -- 계정 전역
    AND NOT user_page_opt_out(user, page)             -- 페이지별
  ```

  **어느 한 계층이라도 false면 기록하지 않는다.** OR도, "상위가 하위를 덮어쓴다"도 아니다 — 프라이버시 설정에서 상위 계층이 개인 옵트아웃을 무효화하면 그것은 프라이버시 기능이 아니게 된다. `[추정]` 노션이 조직 토글을 켰을 때 개인 옵트아웃이 무시되는지는 문서에 없다. **클론은 AND로 확정 선언한다.**

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 설정 미존재 = 켜짐(기본 true). 단 **조회 기록에 명시적 동의를 요구하는 관할이 있다** → 지역별 기본값 분기가 필요할 수 있음 `[클론 결정]` |
  | 옵트아웃 전 데이터 | **소급 삭제하지 않는다**(노션도 언급 없음). 단 "지금까지 기록된 내 조회 기록 삭제" 버튼은 GDPR 대응상 있는 편이 낫다 `[클론 결정]` |
  | 중첩 | 워크스페이스 토글 off 상태에서 개인 토글을 켜도 기록되지 않는다(AND) |
  | 동시편집 | 무관 |
  | 삭제된 참조 | 페이지별 옵트아웃 행은 페이지 파기 시 함께 삭제 |
  | 권한 없음 | 워크스페이스 토글은 owner만. 멤버가 API로 시도하면 403 + **실패 시도도 감사 이벤트** |
  | 대용량 | 옵트아웃 판정이 조회 1건마다 4개 테이블 조회가 되면 안 된다 → **세션 시작 시 1회 계산해 세션 컨텍스트에 캐시**, 설정 변경 시 세션 무효화 |
  | 워크스페이스 토글 off의 소급 효과 | 노션 문서에 없음 `[확인필요]`. 클론 권고: "이후 수집 중단, 기존 데이터 유지(단 UI에서 숨김)" — 삭제하면 되돌릴 수 없다 |
  | 옵트아웃 사용자의 편집 | **조회는 익명화되지만 편집은 아니다.** `block.last_edited_by`(F-11-15)는 프라이버시 설정과 무관하게 기록된다. UI가 이 차이를 설명하지 않으면 사용자가 오해한다 |

- **데이터 모델 함의**:
  - `user.analytics_opt_out BOOL` — **per-device가 아니라 per-account**다. 12-platform-ux.md의 `user_setting(scope='account'|'device')`에서 이 키는 반드시 `account` scope. (노션도 테마는 per-device, 프라이버시는 per-account로 구분한다.)
  - `user_page_analytics_optout(user_id, page_id)` — 희소 테이블. 옵트아웃한 (사용자, 페이지) 쌍만.
  - `workspace.analytics_enabled BOOL`, `organization.page_view_analytics_enabled BOOL`.
  - 네 값 모두 **F-17-12의 `setting_definition` 레지스트리에 등록**되어야 설정 화면이 자동 생성되고 감사 이벤트가 자동 발행된다.
  - 옵트아웃 시 이벤트를 **아예 안 만드는가, `actor_id=NULL`로 만드는가**: **후자 권고.** 총 조회수는 유지되고 조회자 신원만 사라진다 — 노션의 "고유 조회자 목록에서만 사라진다"는 서술과 일치 `[추정]`.
- **UI/인터랙션**: 개인은 토글 1개(Preferences → Privacy). 페이지별은 Analytics 탭 안 `Settings` 링크. 워크스페이스는 General 탭 토글 + "이 설정을 끄면 기존 분석 데이터는 더 이상 표시되지 않습니다" 경고. 조직에서 잠긴 경우 워크스페이스 토글은 비활성 + "managed by your organization" 라벨(F-17-13).
- **의존 기능**: F-17-02(수집 지점), F-11-18(조회 프라이버시 — **이 기능은 F-11-18의 확장이다**), F-17-12(설정 레지스트리), F-17-13(조직 잠금).
- **구현 난이도**: **M** — 토글 4개는 S지만 ① 판정 함수를 수집 **핫패스**에 넣어야 하고 ② 캐시 무효화가 필요하며 ③ 3계층 UI 상태(켜짐/꺼짐/조직에 의해 잠김)를 3곳에서 렌더해야 한다.
- **우선순위**: **P1** — 기능 가치는 낮지만 **F-17-02의 수집 코드에 처음부터 들어가야 한다.** 나중에 옵트아웃을 넣으면 이미 쌓인 데이터의 처리 방침을 정해야 하고, 그것은 법무 문제가 된다. "스키마 1일차" 항목.
- **클론 시 현실적 대안**: 계정 전역 토글 1개만 구현한다. 페이지별 옵트아웃과 조직 계층은 드롭. 그래도 AND 게이트 함수는 **처음부터 4항으로 작성**하고 나머지 3항을 상수 true로 두면 나중 확장이 공짜다.
- **참고 출처**: https://www.notion.com/help/page-analytics , https://www.notion.com/help/workspace-settings , https://developers.notion.com/compliance/audit-log-events

---

### F-17-04 검색 분석(Search 탭) & 검색 품질 피드백 루프

- **한 줄 정의**: 워크스페이스에서 실제로 입력된 검색 쿼리와 클릭률을 집계해, 사람들이 찾지 못하는 콘텐츠를 관리자가 발견하게 한다.
- **사용자 시나리오**:
  1. 워크스페이스 owner가 `Settings` → `Analytics` → `Search` 탭.
  2. 쿼리 목록(쿼리 문자열 / 검색 횟수 / 클릭률)이 빈도순으로 나온다.
  3. 클릭률 0%인 쿼리를 보고 "이 주제 문서가 없거나 제목이 틀렸다"고 판단 → 문서를 만들거나 제목을 바꾼다.
  4. **한 명만 검색했거나 한 번만 검색된 쿼리는 목록에 나오지 않는다** — *"searched by more than 1 user"* 및 *"more than once"*.
- **동작 상세**:

  | 항목 | 동작 | 근거 |
  |---|---|---|
  | 접근 | 워크스페이스 owner 전용 | help/workspace-analytics |
  | k-익명성 필터 | 사용자 2명 이상 **AND** 총 2회 이상 | 동 문서 |
  | 지표 | 쿼리, 빈도, 클릭률(CTR) | 동 문서 |
  | 감사 이벤트 | `Search performed`(워크스페이스), `Content search queried`(관리자 검색) | audit-log-events |
  | 조직 레벨 | 조직 Analytics에서도 *"Monitor search queries"* | help/organization-level-controls |

- **왜 k-익명성 필터가 핵심인가**: 검색 쿼리는 **가장 민감한 텔레메트리**다. 한 사람이 한 번 검색한 문자열("정리해고 명단", "퇴직금 계산")이 관리자 화면에 뜨면 그것은 분석이 아니라 감시다. 노션의 `>1 user AND >1 time` 규칙은 UI 노이즈 제거가 아니라 **프라이버시 임계값**으로 읽어야 한다. 클론은 이 규칙을 **집계 쿼리의 HAVING 절이 아니라 저장 계층**에 넣는 편이 안전하다(마스킹 배치).
- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 필터를 통과하는 쿼리가 0개면 "충분한 데이터가 없습니다" — 0건 표가 아니라 설명 |
  | 중첩 | 검색 후 필터를 좁히며 재검색하면 쿼리 3~4건 연속 발생 → **세션 내 접두어 쿼리 축약** 필요 `[클론 결정]`. 안 하면 "노"·"노션"·"노션 클론"이 3개 쿼리로 잡힌다 |
  | 동시편집 | 무관 |
  | 삭제된 참조 | CTR의 클릭 대상 페이지가 삭제되면 CTR 분모는 유지, 링크는 비활성 |
  | 권한 없음 | **가장 위험한 지점**: 쿼리 텍스트에 비공개 페이지 제목이 그대로 들어 있을 수 있다. owner가 볼 수 없는 teamspace의 페이지 제목을 검색한 쿼리가 노출되면 권한 우회다. 쿼리 자체에는 ACL이 없으므로 **k-익명성 + 짧은 보관 기간**이 유일한 방어 |
  | 대용량 | 쿼리 원본은 카디널리티가 매우 높다 → 원본 보관 30~90일, 롤업만 365일 `[클론 결정]` |
  | PII | 사용자가 검색창에 이메일·주민번호를 붙여넣는 일은 실제로 일어난다 → **저장 전 정규식 마스킹 권고** `[클론 결정]` |
  | 옵트아웃 | F-17-03의 옵트아웃이 검색 쿼리에도 적용되는가 `[클론 결정]` → **적용 권고**(같은 프라이버시 성격) |

- **데이터 모델 함의**:
  - `search_query_log(id, workspace_id, user_id, query_norm TEXT, issued_at, result_count, clicked_result_id NULL, clicked_rank NULL)` — `query_norm`은 소문자·공백 정규화 후.
  - 롤업: `analytics_rollup(dimension='search', subject_id = hash(query_norm))` + `search_query_dim(hash PK, query_norm, distinct_user_count)`. **`distinct_user_count < 2`이면 `query_norm`을 NULL로 마스킹**하는 배치가 저장 계층 방어다.
  - CTR = clicked / issued. 클릭 이벤트가 없으면 CTR 컬럼 자체가 불가능 → **07 F-07-01의 검색 결과 클릭에 계측 훅이 필요하다.** 이것이 이 기능의 진짜 의존성이다.
  - 보관 정책은 `activity_event`(F-11-18)와 **다르게** 잡아야 한다 — 쿼리는 더 민감하고 더 많다.
- **UI/인터랙션**: 표 1개(쿼리 / 검색수 / CTR), 기간 선택기. 쿼리 클릭 시 실제 검색 결과 미리보기 `[확인필요]`. CSV 내보내기 여부 `[확인필요]`(Members·Content·AI만 명시됨).
- **의존 기능**: F-07-01(검색 패널), F-07-02(랭킹 — 개선의 대상), F-17-02(롤업), F-17-01(탭 컨테이너), F-17-03(옵트아웃).
- **구현 난이도**: **M** — 로깅과 표는 단순. 난이도는 ① 클릭 계측 훅을 검색 UI에 심는 것(검색 결과 렌더러 수정) ② k-익명성 마스킹 배치 ③ 세션 내 접두어 축약에서 온다.
- **우선순위**: **P2** — 관리자 도구이고, 클론 초기에는 데이터 없이도 검색 개선 과제가 명확하다. **단 검색 클릭 계측 훅은 P1**: 랭킹 개선(F-07-02)의 유일한 정답 신호(relevance label)이며, 나중에 백필할 수 없다.
- **클론 시 현실적 대안**: 대시보드를 만들지 않고 `search_query_log`만 쌓은 뒤 SQL로 직접 조회한다. 관리자 UI 없이도 검색 품질 개선의 목적은 100% 달성된다. 대시보드는 고객이 요구할 때 만든다.
- **참고 출처**: https://www.notion.com/help/workspace-analytics , https://www.notion.com/help/organization-level-controls

---

## B. 멀티 리전 · 데이터 레지던시

### F-17-05 워크스페이스 리전 배정 & 리전 인지 라우팅

- **한 줄 정의**: 각 워크스페이스는 정확히 하나의 리전에 속하고, 그 워크스페이스에 대한 모든 요청과 저장은 해당 리전 안에서만 처리된다.
- **사용자 시나리오**:
  1. Enterprise 조직 owner가 조직 설정 → `Data & Compliance` → `Data Residency`에서 신규 워크스페이스 기본 리전을 `EU`로 지정.
  2. 이후 만들어지는 워크스페이스는 EU에 생성된다.
  3. 사용자가 서울에서 EU 워크스페이스에 접속 → 엣지 워커가 워크스페이스 ID를 보고 **EU 서버로 라우팅**한다. 사용자 위치와 무관하다.
  4. 그 워크스페이스의 검색·AI 답변은 EU 인덱스/벡터 DB만 사용한다.
- **동작 상세** (전부 blog/enabling-multi-region-data-systems-at-notion 및 help/data-residency 근거):

  | 항목 | 동작 |
  |---|---|
  | 리전 목록 | **US**: us-west-2(Oregon) → 백업 us-east-2(Ohio) / **EU**: eu-central-1(Frankfurt) → 백업 eu-west-1(Ireland) / **APAC**: ap-northeast-1(Tokyo), ap-northeast-2(Seoul) |
  | 일본·한국 | *"Please contact your account team"* — 셀프서브가 아님 |
  | 플랜 | Enterprise 전용, **무상**(*"available free of charge to customers on the Enterprise Plan"*) |
  | 파티션 키 | 워크스페이스 ID. *"all of the processing and storage for a given Notion workspace happens within the same network"* |
  | 라우팅 | Cloudflare Workers — *"space-aware workers direct the traffic to a server in the appropriate region"* |
  | 진실의 원천 | *"a centralized mapping table that acts as the source of truth for each workspace's active region"* |
  | 추상화 | *"a shared library that defines enumerated region types and helper methods for mapping between resources"* |
  | 리전 내 데이터 | 페이지 콘텐츠 / 업로드 파일 / **고객 데이터의 검색 인덱스** / 서드파티·봇 생성 메시지·파일 |
  | 리전 밖 데이터 | 계정 정보, 사용량 데이터, 서브프로세서가 처리하는 데이터 |
  | 미커버 | *"Notion Calendar and Notion Mail, ... and any Beta Services are not covered by data residency"* |
  | 성격 | *"only changes the data at rest storage location"* — **처리(processing)는 완전 격리가 아니다** |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | `workspace.region_id`가 NULL인 워크스페이스는 존재해서는 안 된다. **NOT NULL + 기본 리전 상수**로 강제 |
  | 중첩 | 조직 산하 워크스페이스가 서로 다른 리전에 있을 수 있다 → **조직 레벨 기능(Content search, Audit log, 조직 Analytics)은 리전을 넘나든다.** 노션은 "정제 파이프라인으로 고객 데이터를 제거 후 반출"로 푼다. 클론은 조직 조회를 **리전별 팬아웃 + 병합**으로 구현해야 한다 |
  | 동시편집 | 리전 내 문제이므로 05/12 도메인 그대로 |
  | 삭제된 참조 | 리전 A 페이지를 리전 B 페이지가 synced block으로 참조 → 노션도 *"synced blocks from other regions"*을 리전 밖 처리 사례로 명시. **클론은 크로스 리전 synced block 금지 권고** |
  | 권한 없음 | 리전 라우팅은 인증 **이전**에 일어난다(엣지). 즉 워크스페이스 ID → 리전 매핑은 **미인증 요청에도 노출되는 정보**다. 워크스페이스 존재 여부가 새어 나가지 않도록 알 수 없는 ID는 기본 리전으로 보낸다 |
  | 대용량 | 매핑 테이블은 엣지에서 초당 수만 회 조회 → **엣지 KV에 복제**. 갱신은 드물다(마이그레이션 시에만) |
  | 사용자가 여러 리전 워크스페이스 소속 | 워크스페이스 스위처가 리전을 넘는다 → 세션/쿠키가 리전별로 갈리면 스위칭마다 재인증이 필요해진다. **계정·세션은 글로벌**이어야 한다(노션도 계정 정보를 리전 밖으로 명시) |
  | 게스트 | 게스트가 EU·US 워크스페이스 양쪽에 소속 → 위와 동일. 계정 글로벌 원칙으로 해결 |
  | 오프라인 클라이언트 | 12 F-12-04의 오프라인 큐가 리전 엔드포인트를 캐시하면 마이그레이션 후 깨진다 → **엔드포인트를 캐시하지 말 것** |

- **데이터 모델 함의**:
  - **`workspace.region_id NOT NULL`** — 이 도메인이 기존 스키마에 요구하는 가장 중요한 컬럼. F-12-19의 `space_id NOT NULL` 규율과 **같은 성격**(나중에 못 넣음)이다.
  - `region(id, code, display_name, primary_aws_region, backup_aws_region, api_host, search_endpoint, vector_endpoint, object_store_bucket, kafka_bootstrap, is_active)` — **엔드포인트가 코드가 아니라 데이터**여야 한다. 노션의 "shared library + enumerated region types"의 클론 버전.
  - 파생 저장소 키: 검색 문서 id / 임베딩 id / 파일 경로에 워크스페이스 id가 이미 들어 있다면 리전 추가는 라우팅만의 문제다. **들어 있지 않으면 재색인이 필요하다** → 07 F-07-06, 10 F-10-08의 문서 키 설계를 지금 확인해야 한다.
  - `user`/`session`은 리전 컬럼을 갖지 **않는다**(글로벌).
  - 샤딩(F-12-19)과 혼동 금지: **샤딩은 리전 안에서의 수평 분할**이고 리전은 그 위 계층이다. `(region_id, shard_id)` 2단 라우팅.
- **UI/인터랙션**: 일반 사용자에게 리전은 보이지 않는다. 조직 설정에 리전 드롭다운 + 워크스페이스 목록에 리전 배지 `[확인필요]`.
- **의존 기능**: `organization` 엔티티(F-17-13), F-13-18(Enterprise 게이트), F-12-19(샤딩 — 다른 축).
- **구현 난이도**: **XL** — 코드량이 아니라 **모든 저장소 접근 경로를 리전 리졸버로 통과시켜야 한다**는 횡단 요구 때문이다. 인프라(리전별 K8s·Kafka·ES·벡터 DB·버킷) 이중화 비용도 실질적으로 이 항목에 포함된다.
- **우선순위**: **P2 (기능) / P0 (`workspace.region_id` 컬럼과 리졸버 규율)** — 비대칭이다. 리전을 **실제로 켜지 않더라도** 컬럼과 리졸버 함수는 1일차에 넣어라. 값이 전부 `'us'` 하나여도 된다. 이 규율 없이 6개월 개발하면 리전 도입은 재작성이 된다.
- **클론 시 현실적 대안**: 단일 리전으로 운영하되 ① `workspace.region_id` 컬럼 존재 ② `region` 테이블에 행 1개 ③ `resolveEndpoint(workspaceId, resourceKind)` 헬퍼를 통해서만 ES/S3/벡터 DB에 접근 — 이 셋만 지킨다. **셀프호스팅 제품이라면 리전은 배포 위치이므로 F-17-05~07 전체를 드롭해도 된다**(§5 참조).
- **참고 출처**: https://www.notion.com/help/data-residency , https://www.notion.com/blog/enabling-multi-region-data-systems-at-notion

---

### F-17-06 리전 경계 제약 레지스트리 (검색 · 임베딩 · 웹훅 · 데이터레이크 · 파일)

- **한 줄 정의**: 워크스페이스 데이터에서 파생된 모든 저장소와 아웃바운드 경로가 리전 경계를 넘지 않도록, 리소스 종류별 제약을 한 곳에 명시하고 코드가 그 표를 따르게 한다.
- **사용자 시나리오**: (개발자 관점) 새 기능이 워크스페이스 콘텐츠를 읽어 어딘가에 쓰려 할 때, 개발자는 이 표를 보고 "이 저장소는 리전 종속인가"를 판단한다. 표에 없는 저장소를 추가하려면 표에 행을 먼저 추가해야 한다(코드 리뷰 규칙).
- **동작 상세 — 제약 레지스트리**:

  | 리소스 | 소유 F-ID | 리전 종속? | 근거 / 클론 규칙 |
  |---|---|---|---|
  | 페이지·블록 콘텐츠 (Postgres) | 01/02/03 | **예** | help/data-residency: "Page content" |
  | 업로드 파일 (오브젝트 스토리지) | F-12-09, F-09-08 | **예** | "Uploaded files" |
  | 검색 인덱스 | F-07-06 | **예** | *"dedicated Elasticsearch cluster that builds its indices exclusively from EU data"* |
  | 임베딩 / 벡터 인덱스 | F-10-08 | **예** | 리전 Kafka → 리전 Spark → 리전 vector DB |
  | CDC / Kafka / 데이터레이크 | (미소유 — 신규) | **예** | Debezium → Kafka → Spark → 리전 data lake |
  | 분석 롤업 | F-17-02 | **예** | 고객 데이터 파생물 |
  | 감사 로그 | F-11-12 | **예** `[추정]` | 페이지 제목 등 고객 데이터를 포함하므로 |
  | 아웃바운드 웹훅(개발자용) | F-09-09 | **예 — 발신 주체가 리전 안이어야 함** | 페이로드에 고객 데이터가 실린다. 수신지는 고객이 정하므로 통제 불가 → **경계 초과는 고객의 선택**임을 UI에 명시 |
  | 자동화 `Send webhook` 액션 | F-08-10 | **예 (동일)** | 조직 설정에 `Allow access to webhooks in database automations and buttons` 토글이 실재 |
  | SIEM 스트리밍 | F-11-12 | **예 (동일)** | 노션은 "메타데이터만 전송"으로 완화 |
  | 세션 / 계정 정보 | 14(신규) | **아니오** | "Account information ... may be stored elsewhere" |
  | 사용량·과금 데이터 | F-13-18, F-10-12 | **아니오** | "usage data" |
  | 잡 오케스트레이터(스케줄러 메타) | 08 U-4(미정의) | **아니오** — 단 페이로드에 고객 데이터 금지 | Airflow가 US에 있는 것과 동일 원리 |
  | 내부 제품 분석 | — | **아니오 — 단 정제 후** | *"data sanitization pipeline that removes all customer data before anything leaves its region"* |
  | Calendar / Mail / Beta | F-13-04, F-13-07 | **미커버(명시적 제외)** | help/data-residency 원문 |
  | 서드파티 AI 모델 추론 | F-10-09 | **[확인필요]** | 노션은 "subprocessors"로만 서술. 모델 제공자의 리전은 별개 문제 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 표에 없는 리소스 = **리전 종속으로 간주**(fail-safe). "모르면 리전 안" |
  | 중첩 | 리전 A 워크스페이스의 페이지를 리전 B 워크스페이스로 **복제/이동**: 콘텐츠가 경계를 넘는다 → **금지하거나 명시적 경고 + 감사 이벤트** `[클론 결정]`. 노션에 `Disable duplicating pages to other workspaces` 설정이 실재하며 이것이 정확히 그 통제 수단이다 |
  | 동시편집 | 크로스 리전 동시편집은 발생하지 않는다(워크스페이스 단위 격리) |
  | 삭제된 참조 | 리전 이전 후 남은 구 리전 인덱스 문서는 마이그레이션 잡이 정리(F-17-07) |
  | 권한 없음 | 무관 |
  | 대용량 | 리전 추가 시 파생 저장소 **전량 재구축** 필요 → 재색인 처리량이 리전 도입의 실제 병목 |
  | 크로스 리전 synced block | 노션도 리전 밖 처리 사례로 인정. **클론은 금지 권고** |
  | 검색: 사용자가 두 리전 워크스페이스 소속 | 글로벌 Quick Find가 리전을 넘어야 한다 → **리전별 질의 후 클라이언트 병합.** 단일 인덱스로 합치면 레지던시가 깨진다. 이 경우 랭킹 정규화가 필요(점수 스케일이 클러스터마다 다름) |

- **데이터 모델 함의**:
  - 산출물은 테이블이 아니라 **코드 규율 + 리소스 레지스트리**다: `resource_kind ENUM` + `resolveEndpoint(workspace_id, resource_kind) -> endpoint` 단일 함수. 저장소 클라이언트를 직접 생성하는 코드를 린트로 금지한다.
  - `webhook_subscription.allowed_egress_region` / `egress_acknowledged_at` — 고객이 경계 초과를 인지했음을 기록.
  - 파생 저장소의 문서 키에 `workspace_id`가 **반드시** 포함되어야 리전 이전이 "해당 워크스페이스 문서만 이동"으로 축소된다.
- **UI/인터랙션**: 관리자에게 거의 보이지 않는다. 웹훅 URL 등록 시 "이 URL은 리전 밖입니다" 경고 + 확인 체크박스 `[클론 결정]`.
- **의존 기능**: F-17-05(리전 축), F-07-06(검색), F-10-08(임베딩), F-09-09(웹훅), F-12-09(파일), F-11-12(감사), F-08-10(자동화 웹훅).
- **구현 난이도**: **L** — 함수 하나와 표 하나지만 **기존 코드 전수 감사**가 실제 작업이다. 저장소 접근 지점이 수십 곳으로 흩어진 뒤에 도입하면 XL.
- **우선순위**: **P2 (실제 다중 리전 운영) / P0 (리졸버 규율)** — F-17-05와 같은 비대칭.
- **클론 시 현실적 대안**: 위 표를 그대로 `docs/architecture/region-constraints.md`로 옮기고, ESLint 커스텀 룰 또는 코드 리뷰 체크리스트 1줄("새 저장소 클라이언트를 직접 생성했는가?")로 강제한다. 비용은 0에 가깝고 효과는 대부분을 커버한다.
- **참고 출처**: https://www.notion.com/blog/enabling-multi-region-data-systems-at-notion , https://www.notion.com/help/data-residency , https://www.notion.com/help/organization-level-controls

---

### F-17-07 조직 기본 리전 지정 & 기존 워크스페이스 리전 마이그레이션

- **한 줄 정의**: 조직이 신규 워크스페이스의 기본 리전을 정하고, 이미 존재하는 워크스페이스를 다른 리전으로 이전한다.
- **사용자 시나리오**:
  1. (기본 리전) 조직 owner → 조직 설정 → `Data & Compliance` → `Data Residency` → 기본 리전 선택. 이후 생성되는 워크스페이스에 적용된다.
  2. (마이그레이션) 기존 워크스페이스를 옮기려면 **셀프서브가 아니다** — *"contacting their account team or Notion support"*. 노션이 백엔드에서 수행한다.
  3. 이전 완료 후 구 리전(US)의 고객 데이터 카테고리는 **30일 뒤 삭제**된다: *"the categories of Customer Data described above will be deleted in the US after 30 days."*
- **동작 상세**:

  | 단계 | 노션 | 클론 설계 |
  |---|---|---|
  | 0. 기본 리전 설정 | 조직 설정 값 1개 | `organization.default_new_workspace_region`. 감사 이벤트 `Default new workspace region updated`(실재) |
  | 1. 마이그레이션 요청 | 셀프서브 아님 | 클론도 **운영자 실행 잡**으로 두는 것이 옳다. 사용자 버튼으로 만들면 실패 복구가 지옥이 된다 |
  | 2. 쓰기 정책 | 미공개 `[확인필요]` | 권고: **읽기 전용 창(read-only window)**. `workspace.migration_state='migrating_out'`이면 쓰기 거부 |
  | 3. 데이터 이전 | — | Postgres 논리 복제 + 오브젝트 스토리지 복사. **파생물(검색·임베딩·롤업)은 복사가 아니라 대상 리전에서 재구축** |
  | 4. 컷오버 | 중앙 매핑 테이블 갱신 | 엣지 KV 전파. **전파 지연 중 요청은 구 리전으로 감** → 구 리전에 리다이렉트 스텁 필요 |
  | 5. 정리 | **30일 뒤** 구 리전 삭제 | 노션 명시. **롤백 창의 역할도 겸한다** `[추정]` |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 조직 기본 리전 미설정 = 시스템 기본 리전 |
  | 중첩 | 조직 산하 워크스페이스가 서로 다른 리전 → 정상. 조직 기능은 팬아웃(F-17-06) |
  | 동시편집 | **마이그레이션 중 사용자가 편집 중이면?** 읽기 전용 창이 필수인 이유. 05의 낙관적 업데이트는 서버 거부 시 롤백되므로(F-05-04) 클라이언트가 이미 처리 가능하다 — **거부 사유 코드에 `WORKSPACE_MIGRATING`을 추가**해야 12 F-12-16의 오류 UX가 올바른 메시지를 낸다 |
  | 삭제된 참조 | 이전 중 다른 워크스페이스가 이 워크스페이스 페이지를 링크 → URL 기반이므로 컷오버 후 자동 해결 |
  | 권한 없음 | 조직 owner만. 워크스페이스 owner는 요청조차 불가 `[추정]` |
  | 대용량 | 워크스페이스가 클수록 읽기 전용 창이 길어진다 → **사전 복제 + 짧은 최종 동기화(CDC 따라잡기)** 로 창을 분 단위로 줄이는 것이 정석 |
  | 실패 | 컷오버 전 실패 = 대상 리전 데이터 폐기 후 재시도(무해). **컷오버 후 실패 = 30일 롤백 창 안에서 매핑을 되돌린다** |
  | 오프라인 클라이언트 | 오프라인 큐가 구 리전 엔드포인트를 물고 있다 → 엔드포인트를 캐시하지 말거나 302 리다이렉트 |
  | 웹훅 | 컷오버 후 아웃바운드 발신 리전이 바뀐다 → 고객의 IP 허용목록이 깨질 수 있다 → **리전별 고정 egress IP 공지 필요** `[클론 결정]` |

- **데이터 모델 함의**:
  - `organization.default_new_workspace_region TEXT REFERENCES region(code)`.
  - `workspace.migration_state ENUM('stable','migrating_out','migrating_in') DEFAULT 'stable'` + `workspace.region_id` + `previous_region_id NULL` + `purge_previous_after TIMESTAMPTZ NULL`(30일).
  - `region_migration_job(id, workspace_id, from_region, to_region, phase, started_at, cutover_at, purge_at, error)` — **페이즈 머신 필요**. boolean으로는 표현 불가.
  - 중앙 매핑 테이블은 `workspace.region_id`의 **읽기 최적화 복제본**이지 별도 진실이 아니다. 두 개의 진실을 만들면 컷오버가 깨진다.
- **UI/인터랙션**: 조직 설정에 리전 드롭다운 1개. 마이그레이션은 UI 없음(운영자 도구). 이전 중 워크스페이스 상단에 "데이터 리전을 이전 중입니다" 배너.
- **의존 기능**: F-17-05(리전 축), F-17-06(파생 저장소 목록 — 무엇을 재구축할지의 정의), F-12-16(오류 UX), F-12-04(오프라인 큐).
- **구현 난이도**: **XL** — 데이터 이전 자체보다 ① 읽기 전용 창의 전 경로 적용 ② 파생 저장소 재구축 오케스트레이션 ③ 컷오버 원자성 ④ 30일 롤백 창 운영이 각각 독립 난제다.
- **우선순위**: **P2** — 리전이 2개 이상일 때만 의미가 있다. **단 `migration_state` 컬럼과 `WORKSPACE_MIGRATING` 오류 코드는 F-17-05를 넣을 때 함께 넣어두면 공짜다.**
- **클론 시 현실적 대안**: 마이그레이션을 **명시적으로 지원하지 않는다고 선언**한다. "워크스페이스 생성 시 리전 선택, 이후 변경 불가"로 두면 F-17-07 전체가 F-17-05의 드롭다운 1개로 축소된다(XL → S). 이전이 필요하면 내보내기/가져오기(F-09-12/F-09-14)로 안내한다 — 노션도 셀프서브가 아니다.
- **참고 출처**: https://www.notion.com/help/data-residency , https://www.notion.com/help/organization-level-controls , https://developers.notion.com/compliance/audit-log-events

---

## C. 신뢰 · 안전 (Trust & Safety)

### F-17-08 공개 페이지 남용 신고 (Report page)

- **한 줄 정의**: 로그인하지 않은 방문자를 포함한 누구나, 공개된 페이지를 사유와 함께 신고할 수 있다.
- **사용자 시나리오**:
  1. 공개된 페이지(notion.site 등)를 웹에서 보던 방문자가 페이지 상단 `···` 클릭.
  2. 드롭다운에서 `Report page` 선택.
  3. 팝업에서 사유 선택: **`Phishing or spam` / `Inappropriate content` / `DMCA takedown request` / `Other`**.
  4. 텍스트 필드에 맥락 입력.
  5. `Report` 클릭 → *"Any page you report will be added to our customer experience team's queue for review."*
  6. 대안 경로: 별도 신고 폼 페이지도 제공된다.
- **동작 상세**:

  | 항목 | 동작 | 근거 |
  |---|---|---|
  | 진입점 | 공개 페이지 `···` 메뉴 | help/report-inappropriate-content |
  | 인증 | **불필요** — 익명 방문자가 신고 주체 | 동 문서 |
  | 사유 | 4종(위 목록) | 동 문서 |
  | 처리 | CX 팀 큐 적재 → 약관 위반 여부 조사 | 동 문서 |
  | DMCA | 별도 DMCA 정책 페이지의 공식 통지 절차로 안내 | 동 문서 |
  | 신고자 피드백 | **없음**(결과 통지 서술 없음) | 동 문서 |
  | 이의제기 | **문서에 없음** | 동 문서 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 사유 미선택 시 제출 불가. 텍스트는 선택 `[추정]` |
  | 중첩 | 하위 페이지가 신고됨 → **케이스는 신고된 페이지에 붙되, 조치는 서브트리 단위 선택 가능**해야 한다(사이트 루트 테이크다운 vs 페이지 1개) |
  | 동시편집 | 신고 접수 후 소유자가 내용을 수정 → 케이스에 **신고 시점 스냅샷**을 첨부하지 않으면 검토가 불가능하다. 이것이 이 기능의 숨은 요구사항이다 |
  | 삭제된 참조 | 신고된 페이지가 이미 비공개/삭제됨 → 케이스 `moot` 자동 종결. **신고 기록은 남긴다**(재범 판정용) |
  | 권한 없음 | 신고에는 권한 개념이 없다. 단 **비공개 페이지는 신고 버튼 자체가 없다**(볼 수 없으므로) |
  | 대용량 / 남용 | **신고 자체가 공격 벡터다.** 2021년 노션은 대량 피싱 신고로 도메인이 차단되어 수 시간 장애를 겪었다. 클론은 ① 신고 레이트리밋(IP·페이지별) ② 동일 대상 신고 병합 ③ **자동 테이크다운 금지(사람 검토 필수)** 가 필요하다 |
  | 허위 신고 | 신고자 fingerprint별 정확도를 추적해 가중치 부여 `[클론 결정]` |
  | 자기 페이지 신고 | 소유자가 자기 페이지를 신고 → 정상 접수. 자동 종결하지 말 것(계정 탈취 시나리오) |

- **데이터 모델 함의**:
  - `abuse_report(id, target_type ENUM('page','site','form','comment','file'), target_id, reason ENUM('phishing_spam','inappropriate','dmca','other'), detail TEXT, reporter_user_id NULL, reporter_ip_hash, reporter_ua_hash, content_snapshot_ref, created_at, case_id NULL)`.
  - **`reporter_user_id`는 NULL 허용**이 핵심이다. 신고자는 principal이 아니다 → §2.1에서 "ACL 어휘를 오염시키지 말 것"이라고 적은 이유.
  - `target_id`는 **폴리모픽**이다. 06의 `acl_entry(node_id, node_kind)` 패턴을 재사용하면 어휘가 일관된다.
  - **스냅샷 요구**: `content_snapshot_ref` — 신고 시점의 렌더 결과(HTML 또는 블록 트리 JSON)를 오브젝트 스토리지에 저장. 없으면 조사 불가. 기존 내보내기 직렬화기(F-09-14) 재사용 가능.
  - 신고는 `abuse_report`, 조사 단위는 `moderation_case`로 **분리**(N:1). 같은 페이지에 100건이 들어와도 케이스는 1개다.
- **UI/인터랙션**: 공개 페이지 렌더러(SSR 경로)의 `···` 메뉴 항목 1개 → 모달(라디오 4개 + textarea + 제출). 제출 후 "신고가 접수되었습니다" 토스트. **앱 내부 렌더러에는 이 메뉴가 없다** — 13-adjacent-products.md가 지적한 "앱 렌더러와 분리된 공개 SSR 렌더러"에 붙는 기능이다.
- **의존 기능**: F-06-08 / F-13-08(공개 페이지 SSR 경로 — 없으면 이 기능이 붙을 곳이 없다), F-17-09(케이스 처리), 레이트리밋 인프라(F-17-10과 공유).
- **구현 난이도**: **S** — 폼 1개 + 테이블 1개 + 레이트리밋. 스냅샷 저장이 유일한 추가 작업이며 그것도 기존 직렬화기 재사용.
- **우선순위**: **P1** — 난이도 대비 가치가 이 도메인에서 가장 높다. 공개 게시 기능을 켠 순간 법적·평판 리스크가 발생하고, 신고 창구가 없으면 유일한 창구가 이메일과 SNS가 된다. **공개 게시(F-06-08)를 P1로 잡았다면 이것도 P1이어야 한다.**
- **클론 시 현실적 대안**: 모더레이션 큐(F-17-09) 없이 **신고 → 운영자 이메일/Slack 알림 + `abuse_report` 행 적재**만 구현한다. 처리는 사람이 DB를 보고 수동으로. 초기 규모에서는 충분하고, 큐 UI는 신고가 하루 10건을 넘을 때 만든다.
- **참고 출처**: https://www.notion.com/help/report-inappropriate-content , https://www.notion.com/blog/our-content-and-use-policy , https://techcrunch.com/2021/02/15/notions-hours-long-outage-was-caused-by-phishing-complaints/

---

### F-17-09 모더레이션 큐 · 테이크다운 · 자동 스캔 · DMCA

- **한 줄 정의**: 신고와 자동 탐지 결과를 케이스로 묶어 운영자가 검토하고, 공개 노출만 차단(테이크다운)하거나 복구하며, 모든 조치를 감사 가능하게 남긴다.
- **사용자 시나리오** (운영자 관점):
  1. 운영자 콘솔 `Moderation` → 케이스 목록(신고 수 / 사유 / 자동 스캔 점수 / 대상 / 최초 신고 시각순).
  2. 케이스 열기 → 신고 시점 스냅샷 + 현재 콘텐츠 + 신고 원문 N건 + 소유 워크스페이스 정보.
  3. 조치 선택: `Dismiss`(무해) / `Restrict`(경고 인터스티셜 후 노출) / `Take down`(공개 URL 404) / `Escalate`(워크스페이스 게시 차단 검토).
  4. 조치 시 사유 코드와 메모를 남긴다 → `moderation_action` append-only 기록 + 감사 이벤트.
  5. 테이크다운 시 소유자에게 알림(사유 + 이의제기 안내) `[클론 결정 — 노션은 미명세]`.
  6. 소유자가 이의제기 → 케이스 재개 → `Reinstate` 시 공개 복구.
- **동작 상세**:

  | 항목 | 노션의 동작 | 근거 |
  |---|---|---|
  | 탐지 | *"Combination of automated and manual solutions to scan for, identify, and remove publicly shared pages"* | blog/our-content-and-use-policy |
  | 자동 스캔 | *"Higher recall automated malware detection"*, AI·크라우드소싱 업체와 제휴 | 동 문서 |
  | 금지 콘텐츠 | *"graphic and harmful content, child exploitation, harassment, hateful speech, and pages that enable phishing or malware"* | 동 문서 |
  | 조치 | 콘텐츠 제거가 주 수단. 계정 정지·경고 단계는 **미명시** | 동 문서 |
  | 이의제기 | **문서에 없음** | 동 문서 |
  | 투명성 보고서 | **없음** | 동 문서 |
  | DMCA | 별도 정식 통지 절차 | help/report-inappropriate-content |

- **테이크다운의 정확한 의미** (§1.4 재확인): 테이크다운은 **`moderation_state = 'taken_down'`**이며 `lifecycle`은 건드리지 않는다. 결과:
  - 공개 URL → 404(또는 정책 안내 페이지)
  - **CDN 캐시 무효화 필수** — 13 F-13-08이 지적한 "발행 취소 시 CDN·검색엔진 캐시가 남는다" 문제와 동일하되 긴급도가 훨씬 높다
  - 검색엔진에는 `noindex` + 제거 요청(F-17-11)
  - **워크스페이스 안에서는 계속 편집 가능** — 소유자의 데이터를 운영자가 지운 것이 아니다
  - `search_index`(F-07-06)의 **공개 색인에서만** 제거, 내부 검색은 유지

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 신고 0건 + 자동 점수만으로 케이스 생성 가능해야 한다(자동 탐지 경로) |
  | 중첩 | 사이트 루트를 테이크다운하면 하위 전체가 내려간다 → **범위를 `node` / `subtree` / `site`로 명시 선택**. 서브트리 조치는 06 F-06-05의 조상 재귀와 같은 경로를 쓴다 |
  | 동시편집 | 테이크다운 직후 소유자가 내용을 바꾸고 재게시 → **재게시가 케이스를 자동 재개**해야 한다. 그렇지 않으면 테이크다운은 우회 가능한 장식이다 |
  | 삭제된 참조 | 대상이 파기되면 케이스 `moot` 종결. `moderation_action` 이력은 **파기 대상에서 제외**(F-11-12의 audit_event와 같은 예외) |
  | 권한 없음 | 모더레이션 콘솔은 워크스페이스 관리자가 아니라 **플랫폼 운영자** 전용이다. `admin_capability`가 아니라 **별도 staff role**이 필요하다 — 워크스페이스 owner가 자기 워크스페이스 케이스를 보면 신고자가 노출된다 |
  | 대용량 | 자동 스캔이 초당 수십 페이지 → 게시 시점 스캔 + 주기 재스캔. **재스캔이 없으면 "게시 후 내용 교체" 공격에 무력** |
  | 오탐 | 자동 스캔만으로 테이크다운하면 정상 페이지가 내려간다 → **자동 조치는 `restrict`(경고 인터스티셜)까지, `take_down`은 사람 확인 후**가 안전한 기본값 `[클론 결정]` |
  | 법적 보존 | 일부 카테고리(아동 착취 등)는 삭제가 아니라 **보존 + 신고 의무**가 있는 관할이 있다 → `legal_hold`(F-11-06)와 연동 필요 `[확인필요]` |
  | 반복 위반 | 같은 워크스페이스에 케이스 N건 누적 → 워크스페이스 단위 게시 차단(F-06-11의 `Disable publishing sites and forms`를 운영자가 강제) |

- **데이터 모델 함의**:
  - `moderation_case(id, target_type, target_id, workspace_id, state ENUM('open','investigating','actioned','dismissed','moot'), severity, report_count, auto_score NUMERIC NULL, first_reported_at, assigned_staff_id NULL)`.
  - `moderation_action(id, case_id, actor_staff_id, action ENUM('dismiss','restrict','take_down','reinstate','escalate','disable_publishing'), scope ENUM('node','subtree','site','workspace'), reason_code, note, created_at)` — **append-only**. 현재 상태는 최신 행에서 파생하되, 성능을 위해 `page.moderation_state`에 비정규화.
  - **`page.moderation_state` 축**(§2.1)이 이 기능이 기존 스키마에 요구하는 핵심이다.
  - `content_scan(id, target_id, scanned_at, scanner, score, verdict, evidence jsonb)` — 게시 이벤트를 트리거로. **게시 파이프라인(F-06-08)에 훅이 필요**하다.
  - `staff_user` / `staff_capability` — 워크스페이스 사용자 모델과 **분리된 테이블**. 같은 `user` 테이블에 `is_staff` 플래그를 넣으면 권한 사고의 원인이 된다.
- **UI/인터랙션**: 별도 내부 콘솔(제품 앱과 분리된 라우트/도메인 권고). 케이스 목록 표 + 상세 패널(스냅샷, 신고 원문, 조치 버튼 4개, 사유 코드 선택). 조치 시 확인 다이얼로그 + 되돌릴 수 없음 경고.
- **의존 기능**: F-17-08(신고 유입), F-06-08 / F-13-08(공개 게시 파이프라인 — 스캔 훅과 테이크다운 지점), F-11-12(감사 이벤트), F-07-06(공개 색인 제거), F-17-11(noindex 강제), CDN 퍼지 API.
- **구현 난이도**: **L** — 큐 UI는 M이지만 ① 운영자 권한 모델 분리 ② CDN·검색엔진 캐시 퍼지 ③ 자동 스캔 통합(외부 API) ④ 재게시 자동 재개 ⑤ 서브트리 범위 조치가 겹친다. 자동 스캔을 외부 서비스에 위임하면 L 유지, 자체 구현하면 XL.
- **우선순위**: **P1** — F-17-08과 세트다. 다만 **큐 UI는 P2**로 미룰 수 있다(대안 참고). 반드시 P1인 부분은 **테이크다운을 실행할 수 있는 경로**와 `moderation_state` 축이다 — 법적 요청이 들어왔을 때 "지금은 내릴 방법이 없습니다"는 성립하지 않는 답이다.
- **클론 시 현실적 대안**: ① 운영자 콘솔 대신 **관리자 CLI 1개**(`takedown --page <id> --reason <code>`)로 시작. ② 자동 스캔은 게시 시점에 Google Safe Browsing / URLhaus 등 무료 평판 API 조회 1회. ③ 이의제기는 이메일. L → **M**이면서 법적 대응 능력은 확보된다.
- **참고 출처**: https://www.notion.com/blog/our-content-and-use-policy , https://www.notion.com/help/report-inappropriate-content , https://www.notion.com/help/public-pages-and-web-publishing

---

### F-17-10 공개 쓰기 경로 남용 방어 (캡차 · 레이트리밋 · 중복 제출)

- **한 줄 정의**: 인증 없이 데이터를 생성할 수 있는 유일한 경로인 공개 폼 제출을, 봇·스팸·중복 제출로부터 보호한다.
- **⚠️ 이 기능의 특수성**: **노션 공식 문서에는 대응물이 없다.** `help/forms`를 확인한 결과 레이트리밋·캡차·중복 제출 방지·응답 수 상한에 대한 서술이 **전혀 없다**(공유 3상태·익명 토글·응답자 사후 권한만 명시). 즉 이것은 "노션 재현"이 아니라 **클론이 반드시 스스로 만들어야 하는 방어**다. 근거 없이 노션이 한다고 쓰지 않는다.
- **사용자 시나리오** (제출자 관점):
  1. 공개 폼 링크를 연다. 폼 로드 시 서버가 1회용 `submission_token`을 발급한다.
  2. 작성 후 `Submit` → 토큰·타임스탬프·(필요 시) 캡차 토큰이 함께 전송된다.
  3. 정상이면 확인 화면.
  4. 같은 브라우저로 다시 제출하면 폼 설정에 따라 "이미 제출하셨습니다"로 차단되거나 정상 접수된다.
  5. 봇이 초당 수십 건을 던지면 캡차 챌린지로 승격되고, 그래도 초과하면 429.
- **동작 상세 — 방어 계층** (전부 `[클론 결정]`):

  | 계층 | 방어 | 오탐 비용 | 권고 |
  |---|---|---|---|
  | 1 | **폼 토큰**: 폼 렌더 시 발급, 제출 시 소모. 1회용 + TTL(예: 2시간) | 낮음 | **필수**. 폼 HTML을 거치지 않은 직접 POST를 대부분 차단 |
  | 2 | **최소 작성 시간**: 렌더~제출 < N초면 봇으로 간주 | 낮음 | **필수**. 임계값 3초 권고 |
  | 3 | **허니팟 필드**: 숨겨진 입력이 채워지면 조용히 폐기 | 매우 낮음 | **필수**. 사용자에게 안 보이므로 비용 0 |
  | 4 | **IP·폼별 레이트리밋**: 슬라이딩 윈도우(예: 10/분, 100/일) | 중간(NAT 공유) | **필수**. 초과 시 429보다 캡차 승격이 UX상 낫다 |
  | 5 | **캡차**: 레이트리밋 초과 또는 위험 점수 초과 시에만 노출 | 높음 | **조건부**. 항상 노출하면 전환율이 떨어진다 |
  | 6 | **중복 제출 차단**: 폼 옵션. 키 = 인증 사용자 id / 응답 내 이메일 필드 / 브라우저 fingerprint 중 선택 | 높음(fingerprint) | **옵션**. 기본 off |
  | 7 | **응답 수 상한 / 마감 시각**: 초과 시 폼 자동 닫힘 | 없음 | **옵션**. 노션은 `No access`로 수동 마감만 제공 |
  | 8 | **첨부 파일 스캔**: 폼이 파일 업로드를 받으면 악성코드 스캔 | 낮음 | **필수(파일 허용 시)**. F-17-09의 스캐너 재사용 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 필수 질문 미입력은 방어가 아니라 검증(F-13-01 소유). 혼동하지 말 것 |
  | 중첩 | 폼이 relation 프로퍼티를 노출하면 **제출자가 비공개 DB의 행 목록을 볼 수 있다** → 공개 폼에서 relation·people 질문은 금지하거나 검색을 비활성화해야 한다(13이 "people 프로퍼티는 공개 폼에서 사실상 무의미"라고 이미 지적) |
  | 동시편집 | 동일 토큰 동시 2회 제출 → 토큰 소모를 **원자적 `UPDATE ... WHERE used=false`** 로 |
  | 삭제된 참조 | 폼 뷰가 삭제된 뒤 도착한 제출 → 410 Gone. **행을 만들지 말 것** |
  | 권한 없음 | 제출자는 principal이 아니다. 생성된 행의 `created_by`는 시스템 또는 NULL — **11 F-11-15의 `created_by`가 NOT NULL이면 이 경로가 깨진다**(§2.1 요구) |
  | 대용량 | 스팸 폭주 시 DB 행 수만 개 생성 → 뷰·차트·자동화가 전부 반응한다. **자동화 트리거는 `spam_score` 임계 미만 행에만 발화**해야 한다(F-08-10에 대한 이 도메인의 요구) |
  | 오탐 | 정상 사용자가 캡차를 못 풀면 응답 손실 → 캡차 실패 시 **입력 내용을 로컬에 보존**하고 재시도 |
  | 개인정보 | `ip_hash`는 원본 IP가 아니라 **솔트 해시**로. 원본 IP를 DB 행에 넣으면 GDPR 문제이자, 13이 지적한 대로 뷰·내보내기로 새어 나간다 |
  | 재제출 허용 폼 | 응답 수정 기능(응답자 `Can edit`)과 중복 차단이 충돌 → 중복 차단은 **신규 행 생성**에만 적용, 기존 행 수정은 별개 |

- **데이터 모델 함의**:
  - **사이드카 테이블 필수**: `form_submission_meta(row_page_id PK, form_view_id, ip_hash, ua_hash, submission_token, captcha_score, spam_score, dwell_ms, created_at)`. 13 F-13-02가 "응답 = DB 행 그 자체"로 규정했으므로 **이 메타데이터를 행의 property에 넣으면 안 된다** — 뷰·차트·자동화·내보내기·응답 사본에 전부 새어 나간다. 이 도메인이 기존 스키마에 요구하는 핵심 제약이다.
  - `form_token(token PK, form_view_id, issued_at, expires_at, used BOOL)`.
  - `rate_limit_bucket(key, window_start, count)` — Redis 권고(RDB면 쓰기 경합).
  - `form_view.settings`에 `require_captcha`, `dedupe_key ENUM('none','user','email_field','fingerprint')`, `max_responses`, `closes_at` 추가.
  - `block.created_by NULL 허용` 또는 `system` principal — §2.1.
- **UI/인터랙션**: 정상 경로에는 아무것도 보이지 않는다(허니팟·토큰·타이밍은 비가시). 승격 시에만 캡차 위젯. 폼 편집기에는 `Responses` 설정 그룹(중복 방지 / 응답 상한 / 마감 시각 / 캡차 항상 요구).
- **의존 기능**: F-13-01 / F-13-02(폼과 제출 파이프라인 — **이 기능은 그 파이프라인의 미들웨어다**), F-06-17(응답자 권한), F-12-09(첨부 스캔), F-08-10(자동화 발화 억제), 레이트리밋 인프라(F-17-08과 공유).
- **구현 난이도**: **M** — 계층 1~4는 각각 반나절이고 캡차는 서드파티 위젯 통합. 난이도는 개별 항목이 아니라 **8개 계층을 폼 제출 경로 한 곳에 순서대로 꿰는 미들웨어 설계**와 사이드카 분리에 있다.
- **우선순위**: **P1** — 공개 폼(F-13-01, P1)을 만든다면 동시에 만들어야 한다. **계층 1~3(토큰·타이밍·허니팟)은 사실상 P0**: 비용이 거의 0이고, 없으면 폼 공개 첫 주에 스팸이 들어온다. 반대로 캡차·중복 차단은 P2로 미뤄도 된다.
- **클론 시 현실적 대안**: 계층 1·2·3 + IP 레이트리밋(계층 4)만 구현하고, 캡차는 Cloudflare Turnstile 무료 티어를 **레이트리밋 초과 시에만** 호출. 중복 차단은 "이메일 필드 기준"만 지원(fingerprint 드롭 — 오탐이 크고 프라이버시 문제). M → **S~M**.
- **참고 출처**: https://www.notion.com/help/forms (대응 기능 **부재**를 확인한 근거) , https://www.notion.com/blog/our-content-and-use-policy

---

### F-17-11 크롤러 · 색인 제어 (robots / noindex / AI 크롤러)

- **한 줄 정의**: 공개된 페이지가 검색엔진과 AI 크롤러에 어떻게 노출될지를 게시자가 선택하고, 플랫폼이 그것을 robots.txt와 메타 태그로 집행한다.
- **사용자 시나리오**:
  1. 게시자가 페이지 `Share` → `Publish` → `Search engine indexing` → **`Discoverable on the web`** 토글을 켠다.
  2. 유료 플랜이면 SEO 제목·설명을 편집한다(*"edit your link title and description for search engine optimization"*).
  3. 저장 후 *"Notion Sites can take up to four weeks to be indexed and appear in search results."*
  4. 토글을 끄면 `noindex`로 전환되지만 이미 색인된 결과는 즉시 사라지지 않는다.
- **동작 상세**:

  | 항목 | 동작 | 근거 |
  |---|---|---|
  | 토글 이름 | `Search engine indexing` → `Discoverable on the web` | help/public-pages-and-web-publishing |
  | 기본값 | `[확인필요]` — 06 F-06-08은 "전 플랜 사용 가능"만 기록. **클론은 기본 off 권고** | — |
  | SEO 메타 편집 | 유료 플랜 전용 | 동 문서 |
  | 색인 지연 | 최대 4주 | 동 문서 |
  | 플랫폼 robots.txt | notion.so는 `Allow: /` 기본 + 특정 경로 Disallow(초대 링크·템플릿 검색·실험·embed 경로) + **특정 봇 전면 차단**(BLEXBot, AhrefsBot, **Amazonbot**, SemrushBot, dotbot) + sitemap 10개 | https://www.notion.so/robots.txt |
  | 워크스페이스/조직 차단 | `Disable publishing sites and forms` — 켜면 *"Any Sites already live on the web will be taken down once you turn this setting on."* | help/public-pages-and-web-publishing |

- **주목할 점 — 노션의 봇 차단 목록**: `Amazonbot`이 차단 목록에 있다. 이는 SEO 크롤러 차단이 아니라 **AI 학습 크롤러에 대한 정책**이다. 클론도 검색엔진 색인(`index`/`noindex`)과 AI 크롤러 허용(`allow`/`deny`)을 **두 개의 독립 축**으로 설계해야 한다 — 게시자는 "구글에는 나오되 LLM 학습에는 쓰이지 않기"를 원할 수 있다. 하나의 토글로 묶으면 나중에 분리할 수 없다.

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 설정 없음 = `noindex`(fail-safe). 06 F-06-08이 이미 "클론 기본값 noindex"를 권고했다 — 이 문서는 그 결정을 지지한다 |
  | 중첩 | 사이트 루트는 index, 하위 특정 페이지는 noindex → **페이지별 오버라이드 필요**. `robots_directive`를 site가 아니라 **page에 두고 사이트 값을 상속**(`inherit`) |
  | 동시편집 | 무관 |
  | 삭제된 참조 | 발행 취소·테이크다운 후에도 검색엔진 캐시가 남는다(13 F-13-08 지적) → **410 Gone 반환 + 제거 요청 API 호출**이 404보다 빠르게 처리된다 |
  | 권한 없음 | 비공개 페이지에는 애초에 크롤러가 접근할 수 없다. 단 **URL 추측 가능성**에 유의 — 공개 링크는 UUID여야 한다 |
  | 대용량 | 사이트당 페이지 수천 개 → **sitemap.xml 동적 생성 + 50,000 URL/파일 상한 준수 + sitemap index** |
  | 조직 차단과의 충돌 | 조직이 게시를 차단하면 개별 토글은 무의미 → **이미 라이브인 사이트가 즉시 내려간다**(노션 명시). F-17-13의 잠금이 **사후 효과까지 갖는 사례** |
  | 크롤러 부하 | 공개 SSR 렌더러에 크롤러가 몰리면 앱 전체가 느려진다 → 13이 지적한 "앱 렌더러와 분리된 공개 SSR 렌더러 + CDN 캐시"가 여기서도 근거를 얻는다 |
  | robots.txt는 강제력이 없다 | 악성 크롤러는 무시한다 → 진짜 방어는 인증이지 robots가 아니다. **UI가 "비공개로 만드는 기능이 아니다"를 설명해야 한다** |

- **데이터 모델 함의**:
  - `page.robots_directive ENUM('inherit','index','noindex') DEFAULT 'inherit'` + `site.robots_directive ENUM('index','noindex') DEFAULT 'noindex'`.
  - **`page.ai_crawler ENUM('inherit','allow','deny')` + `site.ai_crawler DEFAULT 'deny'`** — 색인과 분리된 두 번째 축.
  - 13 F-13-09의 `site_seo(site_id, title, description, og_image_url, robots enum('index','noindex'))`에서 **`robots` 단일 enum을 위 2축으로 분리할 것을 요구한다**(§2.1).
  - `robots.txt`와 `sitemap.xml`은 **테이블이 아니라 렌더 시점 생성물**. 캐시 TTL 필요.
  - 봇 차단 목록(`blocked_user_agent`)은 **코드가 아니라 데이터** — 13이 임베드 provider 레지스트리에서 내린 것과 같은 결론.
- **UI/인터랙션**: Share 패널 안 `Search engine indexing` 섹션 → 토글 + (유료 시) 제목·설명 입력 2개. 클론 추가분으로 `AI crawlers` 토글 1개. 저장 시 "검색엔진 반영에 최대 수 주가 걸립니다" 안내.
- **의존 기능**: F-06-08 / F-13-08 / F-13-09(공개 게시와 SEO — **정본은 그쪽**), F-17-09(테이크다운 시 강제 noindex), F-13-18(유료 SEO 편집 게이트), 공개 SSR 렌더러.
- **구현 난이도**: **S~M** — 메타 태그 렌더와 robots.txt 생성은 S. sitemap 동적 생성과 페이지별 상속 해석이 M으로 올린다.
- **우선순위**: **P1** — 공개 게시를 만들었다면 필수다. **기본값 `noindex`를 처음부터 박는 것은 P0**: 기본이 index인 상태로 며칠 운영하면 사용자의 비공개 의도 콘텐츠가 색인되고, 그것은 되돌릴 수 없다.
- **클론 시 현실적 대안**: 사이트 단위 토글 1개(`index`/`noindex`) + 정적 robots.txt(알려진 AI 크롤러 UA를 하드코딩 Disallow) + 페이지별 오버라이드 없음. sitemap은 미구현(검색엔진이 링크를 따라간다). S~M → **S**.
- **참고 출처**: https://www.notion.com/help/public-pages-and-web-publishing , https://www.notion.so/robots.txt

---

## D. 설정 정보구조

### F-17-12 설정 정보구조 레지스트리 (account / workspace / organization 3계층)

- **한 줄 정의**: 모든 설정 항목이 어느 계층에 속하고 누가 바꿀 수 있으며 어떤 플랜을 요구하는지를 코드가 아닌 데이터로 선언하고, 설정 화면·권한 검사·감사 이벤트를 그 선언에서 생성한다.
- **사용자 시나리오**:
  1. 사용자가 `Settings` 진입 → 좌측 네비가 **3개 그룹**으로 나뉜다: 내 계정 / 이 워크스페이스 / 조직(해당 시).
  2. 각 항목은 현재 계층의 값과 상태(편집 가능 / 플랜 부족 / 조직에 의해 잠김)를 보여준다.
  3. 값을 바꾸면 감사 이벤트가 자동으로 남는다.
- **동작 상세 — 노션의 실제 3계층 배치 (레지스트리 원본)**:

  #### (1) 계정 계층 (per-account, 워크스페이스 무관)

  | 그룹 | 항목 | 비고 |
  |---|---|---|
  | My account | Preferred name, Profile photo | |
  | My account | **Email addresses — 계정당 최대 5개** | *"You can have up to 5 email addresses on one Notion account"* |
  | My account | Password (최소 8자, 고유문자 4자 이상) | 14 도메인(계정) 소유 |
  | My account | Two-step verification, Passkeys | audit: `MFA TOTP/SMS/backup code toggled` |
  | My account | Log out of all devices | audit: `Logout` |
  | My account | Delete my account | audit: `User deleted` |
  | My account | Support access (**기본 28일 후 자동 만료**) | audit: `Granted/Revoked support access` |
  | My notifications | 알림 채널·유형 | **11 도메인 소유** |
  | My connections | 개인 연결 앱 | 09 도메인 소유 |
  | Preferences → Privacy | **`Show my view history`** | **per-account** (F-17-03) |
  | Preferences → Privacy | 프로필 발견 가능성(내 이메일을 아는 사람에게 노출) | per-account |
  | Preferences | Appearance (Light / Dark / Use system setting) | **per-device** |
  | Preferences | High contrast mode (beta) | **per-device** — *"This setting is saved per device"* |
  | Language & time | Language, Start week on Monday, Time zone(수동/자동) | per-account `[확인필요]` |

  #### (2) 워크스페이스 계층 (workspace owner)

  | 탭 | 항목 |
  |---|---|
  | General | 워크스페이스 이름·아이콘, **Allowed email domains**, Export all workspace content, Export members as CSV, **Save and display page view analytics**, Delete entire workspace |
  | Emoji | Add emoji, **Limit custom emoji creation to workspace owners** (13 F-13-16 관련) |
  | Security | Allow page access requests from non-members / Allow members to request adding other members / Allow any user to request to be added as a member / Allow page guests to request to be added as members |
  | Security (Enterprise) | **Disable publishing sites and forms** / Disable duplicating pages to other workspaces / **Disable export** / 게스트·restricted member 제어 / **휴지통·영구삭제 지연 정책**(audit: `Delete from Trash delay updated`, `Permanently delete delay updated`) |
  | Identity | Verify a domain (Business/Enterprise), SAML SSO |
  | Notion AI → Usage | 허용 모델 목록, 기본 크레딧 한도, 개인별 상향 한도 (**F-10-12 소유**) |
  | Access & billing → Notion credits | 크레딧 대시보드 (**F-10-12 / F-13-18 소유**) |
  | Analytics | 4탭 (F-17-01) |

  #### (3) 조직 계층 (organization owner, Enterprise)

  | 탭 | 항목 |
  |---|---|
  | General | 조직 이름·아바타, **Verified email domains**, 워크스페이스 목록, teamspace, **SAML SSO**, **SCIM**, Require SAML SSO authorization, Delete organization |
  | People | 워크스페이스별 멤버 추가, 멤버·게스트·그룹·계정 관리, 게스트 승격, **Allow users to grant Notion support access**, 계정 정지/재활성, **Reset all users' passwords**, 전원 로그아웃, **Session duration** |
  | Security | **누가 Sites·폼·공개 링크를 게시할 수 있는가 / 누가 내보내기 할 수 있는가 / 누가 다른 워크스페이스로 복제할 수 있는가 / 멤버 추가 요청 / 게스트 추가 요청 / 통합 추가 / DB 자동화·버튼의 webhook 접근** |
  | Security | **IP allowlist + enforcement mode**(`Maintain session` 기본 = 다음 로그인에 적용 / `Require re-authentication` = IP 이탈 즉시 세션 종료) |
  | Admin bots & tokens | 관리자 봇 토큰, 코드로 워크스페이스 내보내기, **Legal hold 생성·해제**, 프로그래매틱 로그아웃 |
  | Data & Compliance | **조직 전체 콘텐츠 검색**(F-07-15), **Audit log**(F-11-12), **Data Residency**(F-17-05/07) |
  | Analytics | 활성 멤버·게스트·teamspace, 콘텐츠 참여도, 검색 쿼리, **워크스페이스·기간 필터** |
  | Notion credits | 워크스페이스별 크레딧 배분·한도, on-demand spend |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 설정 미저장 = `setting_definition.default_value`. **NULL을 "꺼짐"으로 해석하면 안 된다** — 기본값이 true인 설정이 많다 |
  | 중첩 | 같은 개념이 3계층에 모두 존재(예: 게시 차단) → **하위가 상위보다 더 허용적일 수 없다**는 규칙(F-17-13) |
  | 동시편집 | 두 관리자가 같은 설정을 동시 변경 → LWW + 감사 이벤트 2건. 설정은 CRDT 대상이 아니다 |
  | 삭제된 참조 | 조직이 삭제되면 산하 워크스페이스의 잠긴 설정이 해제되어야 한다(잠금 행 cascade) |
  | 권한 없음 | 멤버가 owner 설정을 API로 호출 → 403 + **실패 시도도 감사 이벤트** |
  | 대용량 | 설정 조회가 요청마다 발생 → 워크스페이스 설정 전체를 **1개 JSON으로 캐시**, 변경 시 무효화 |
  | 플랜 다운그레이드 | Enterprise → Plus 강등 시 Enterprise 전용 설정 값이 남는다 → **값은 보존하되 비활성**(재업그레이드 시 복원). 강제로 기본값으로 되돌리면 되돌릴 수 없다 |
  | per-device 설정 | 테마·고대비는 디바이스별. 12의 `user_setting(scope='account'|'device')`가 이미 이 구분을 갖는다 — **레지스트리의 `scope` enum이 그것을 4값으로 확장**한다: `device / account / workspace / organization` |
  | 설정 키 변경 | `setting_definition.deprecated_alias[]`로 마이그레이션 |

- **데이터 모델 함의**:
  - **`setting_definition(key PK, scope ENUM('device','account','workspace','organization'), value_type, default_value jsonb, required_role, required_plan, lockable BOOL, audit_event_name, group_key, order_idx, deprecated BOOL, deprecated_alias TEXT[])`** — 이 도메인이 요구하는 가장 구조적인 신규 엔티티. 설정 화면·권한·감사·플랜 게이트가 전부 여기서 파생된다.
  - `setting_value(scope, scope_id, key, value jsonb, updated_by, updated_at, PRIMARY KEY(scope, scope_id, key))`.
  - **12-platform-ux.md의 `user_setting`은 이 테이블의 부분집합이 되어야 한다** — 별도로 두면 설정이 두 시스템으로 갈라진다(§2.1 요구).
  - `required_plan`은 13 F-13-18의 `plan_entitlement.feature_key`를 참조한다 — 게이팅 로직을 두 곳에 쓰지 않기 위함.
  - `audit_event_name`이 정의에 있으면 **설정 변경 시 감사 이벤트가 자동 발행**된다. 노션 audit log에 설정 토글 이벤트가 100종 넘게 존재하는 규모는 이런 자동 생성 없이는 유지 불가능하다 `[추정]`.
- **UI/인터랙션**: 설정 모달 좌측 네비가 3그룹(`Account` / `<Workspace name>` / `Organization`). 각 항목 행은 [라벨 / 설명 / 컨트롤 / 상태 배지]. 상태 배지 3종: 없음 / `Upgrade to Enterprise` / `Managed by your organization`(잠김, 컨트롤 비활성).
- **의존 기능**: `organization` 엔티티(06 F-06-19에서 승격), F-06-02(역할), F-13-18(플랜 엔타이틀먼트), F-11-12(감사), 12 `user_setting`(흡수 대상).
- **구현 난이도**: **M** — 레지스트리 테이블 + 제네릭 렌더러 + 권한/플랜 체크 미들웨어. 항목 수가 많아도 코드가 아니라 데이터가 늘어난다. **레지스트리 없이 화면마다 하드코딩하면 항목 수에 비례해 M → L → XL로 커진다.**
- **우선순위**: **P0** — 기능 자체는 화려하지 않지만 **구조 결정**이다. 비평 A-7이 지적한 대로 06(security_policy)·13-18(entitlement)·11(알림 설정)·12(테마·언어)가 각자 설정을 정의하고 있어 **이미 4곳으로 흩어져 있다.** 지금 통합하지 않으면 5번째, 6번째가 생긴다. 나중에 하면 4개 시스템을 동시에 리팩터링해야 한다.
- **클론 시 현실적 대안**: 조직 계층을 드롭하고 `device / account / workspace` 3-scope만 지원한다. `setting_definition`은 DB 테이블 대신 **타입 안전한 TS 상수 객체 1개**로 시작해도 좋다(런타임 변경이 필요 없다면). 중요한 것은 테이블이냐 상수냐가 아니라 **선언이 한 곳에 모여 있고 화면이 거기서 생성된다**는 것이다.
- **참고 출처**: https://www.notion.com/help/workspace-settings , https://www.notion.com/help/account-settings , https://www.notion.com/help/organization-level-controls , https://www.notion.com/help/data-access-consent , https://developers.notion.com/compliance/audit-log-events

---

### F-17-13 조직 설정 잠금(Bulk apply) & 커스텀 관리자 역할

- **한 줄 정의**: 조직이 특정 설정을 산하 전 워크스페이스에 일괄 적용하고 잠가서 워크스페이스 owner가 되돌리지 못하게 하며, 관리 권한을 역할 단위로 위임한다.
- **사용자 시나리오**:
  1. 조직 owner가 조직 설정 `Security` 탭에서 `Disable publishing sites and forms`를 켠다.
  2. `Bulk apply` 선택 → 산하 모든 워크스페이스에 적용된다.
  3. 이후 워크스페이스 owner가 자기 설정에서 그 항목을 보면 **비활성 + "managed by their organization"** 표시만 보인다.
  4. (역할 위임) 조직 owner가 `Custom admin role`을 만들어 "감사 로그 열람 + 콘텐츠 검색"만 가진 역할을 정의하고 보안팀 3명에게 부여한다.
- **동작 상세**:

  | 항목 | 동작 | 근거 |
  |---|---|---|
  | 일괄 적용 | *"Bulk apply"* 로 전 워크스페이스에 강제 | help/organization-level-controls |
  | 잠금 효과 | *"workspace owners won't be able to adjust those settings in their workspace settings"* | 동 문서 |
  | 잠김 표시 | *"managed by their organization"* | 동 문서 |
  | 사후 효과 | 게시 차단은 **이미 라이브인 사이트를 내린다** | help/public-pages-and-web-publishing |
  | 커스텀 역할 | audit 이벤트 `Custom admin role created / deleted / updated` 실재 | audit-log-events |
  | 조직 owner | `Organization owner added / removed`, `Admin role assigned / revoked` | 동 |
  | 조직 토큰 | `Organization token created / updated` — 프로그래매틱 관리 | 동 |
  | 보안 센터 | `Security Center category weights updated`, `Security Center custom checks updated` 이벤트 실재 — **보안 태세 점수 기능 존재를 시사** `[확인필요]`(헬프센터에서 해당 기능 문서를 찾지 못함) | 동 |

- **잠금의 상태 머신 (구현의 핵심)**:

  ```
  effective(setting_key, workspace) :=
    if setting_lock(org_id, key) exists:
         → { value: lock.value, editable: false, reason: 'managed_by_organization' }
    elif setting_value(workspace, key) exists:
         → { value: ws.value, editable: has_role(owner) }
    elif setting_value(organization, key) exists:     -- 잠그지 않은 조직 기본값
         → { value: org.value, editable: has_role(owner) }   -- 워크스페이스가 덮어쓸 수 있음
    else:
         → { value: definition.default_value, editable: has_role(owner) }
  ```

  **핵심 구분**: 조직 값에는 두 종류가 있다 — **기본값(덮어쓰기 가능)**과 **잠금(덮어쓰기 불가)**. 하나로 합치면 "조직이 권장하되 워크스페이스가 조정 가능" 시나리오를 표현할 수 없다. 노션의 `Bulk apply`는 잠금 쪽이다 `[추정 — 문서는 잠금 결과만 서술]`.

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | 잠금 행 없음 = 잠기지 않음 |
  | 중첩 | 워크스페이스에 이미 반대 값이 저장된 상태에서 잠금 → **기존 값을 덮어쓰지 말고 잠금이 우선하게** 한다. 해제 시 원래 값이 복원되어야 하기 때문 |
  | 동시편집 | 조직 잠금과 워크스페이스 변경이 동시 → 잠금이 이긴다. 워크스페이스 변경은 409 + 사유 반환 |
  | 삭제된 참조 | 워크스페이스가 조직에서 이탈(`Workspace removed from organization`) → **잠금 즉시 해제**, 워크스페이스 저장값 또는 기본값으로 폴백 |
  | 권한 없음 | 커스텀 역할은 **자기 capability의 부분집합만** 부여 가능. 자기보다 강한 역할을 만들 수 있으면 권한 상승 취약점 |
  | 대용량 | 워크스페이스 1,000개에 bulk apply → 잠금은 **조직 1행**이면 충분하다. 워크스페이스마다 행을 복사하면 1,000행 쓰기 + 무효화 폭풍 |
  | 사후 효과의 되돌림 | 게시 차단 → 사이트 다운. **잠금 해제 시 자동 재게시되는가?** `[클론 결정]` — 자동 재게시는 위험(의도치 않은 공개). **수동 재게시 요구** 권고 |
  | 순환 | 커스텀 역할이 "역할 관리" capability를 포함하면 자기 역할을 강화할 수 있다 → **역할 관리 capability는 조직 owner 전용, 위임 불가** |
  | 감사 | 잠금 설정/해제는 반드시 감사 이벤트, `scope='organization'` |

- **데이터 모델 함의**:
  - `setting_lock(organization_id, setting_key, value jsonb, locked_by, locked_at, PRIMARY KEY(organization_id, setting_key))` — **워크스페이스별 복사 없음**.
  - `admin_role(id, organization_id, name, is_builtin)` + `admin_role_capability(role_id, capability)` + `admin_role_assignment(role_id, user_id, scope ENUM('organization','workspace'), scope_id NULL)`.
  - **capability enum이 이 도메인의 통합 지점**: F-10-25가 `view_ai_analytics / view_agent_audit / manage_credit_limits`를 요구했고, F-17-01이 `view_member_analytics / view_search_analytics / view_content_analytics / export_analytics`를, F-11-12가 `view_audit_log`를, F-07-15가 `search_all_content`를 요구한다. **하나의 enum으로 통합하지 않으면 관리자 권한이 4개 시스템으로 갈라진다.**
  - **staff(플랫폼 운영자, F-17-09)와 admin_role(고객 조직 관리자)은 완전히 별개**다. 같은 테이블에 넣지 말 것.
- **UI/인터랙션**: 조직 Security 탭 각 항목에 토글 + `Bulk apply` 버튼(적용 시 "N개 워크스페이스에 적용되며 워크스페이스 관리자는 변경할 수 없습니다" 확인 다이얼로그). 워크스페이스 쪽은 비활성 컨트롤 + 자물쇠 아이콘 + 툴팁. 역할 편집기는 capability 체크박스 목록.
- **의존 기능**: F-17-12(레지스트리 — **잠금은 `lockable` 플래그가 있어야 성립**), F-06-02(역할), F-06-19(조직 계층 — 06이 언급만 한 것을 이 기능이 실체화), F-11-12(감사), F-13-18(Enterprise 게이트).
- **구현 난이도**: **L** — 잠금 자체는 M(우선순위 함수 + UI 3상태)이지만 커스텀 역할이 붙으면서 ① capability enum 통합 ② 권한 상승 방지 ③ 사후 효과(게시 차단이 라이브 사이트를 내림) 처리가 더해진다.
- **우선순위**: **P2** — 조직(멀티 워크스페이스) 개념이 없으면 성립하지 않는다. **단 `effective()` 함수를 F-17-12에서 4항으로 미리 작성해두면**(조직 항 2개를 상수로) 나중 도입이 거의 공짜다.
- **클론 시 현실적 대안**: 커스텀 역할을 드롭하고 **고정 역할 3개**(`org_owner` / `security_auditor` / `billing_admin`)만 하드코딩. 잠금은 지원하되 `Bulk apply` UI 없이 "조직 설정 = 항상 잠금"으로 단순화. L → **M**.
- **참고 출처**: https://www.notion.com/help/organization-level-controls , https://www.notion.com/help/ip-address-restrictions , https://developers.notion.com/compliance/audit-log-events , https://www.notion.com/help/audit-log

---

## 4. 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 주요 의존 | "지금 안 하면 못 하는 것" |
|---|---|---|---|---|---|
| F-17-12 | 설정 레지스트리 3계층 | M | **P0** | 역할, 플랜 | 설정이 5개 시스템으로 흩어진 뒤 통합은 4곳 동시 리팩터 |
| F-17-05 | 워크스페이스 리전 배정·라우팅 | XL | P2 / **컬럼·리졸버는 P0** | 조직, 플랜 | `workspace.region_id`는 파생 저장소가 쌓인 뒤 추가 불가 |
| F-17-06 | 리전 경계 제약 레지스트리 | L | P2 / **규율은 P0** | F-17-05, 07, 09, 10, 12 | 저장소 접근이 수십 곳에 흩어지면 XL |
| F-17-03 | 분석 옵트아웃 3계층 | M | **P1** | F-17-02, F-11-18 | 수집 코드에 처음부터 없으면 기존 데이터 처리가 법무 문제 |
| F-17-08 | 공개 페이지 남용 신고 | **S** | **P1** | 공개 SSR 렌더러 | 난이도 대비 가치 최상. 없으면 창구가 SNS |
| F-17-10 | 공개 쓰기 남용 방어 | M | **P1** / 계층1~3은 P0 | F-13-01/02 | 폼 공개 첫 주에 스팸. 사이드카 분리는 나중에 못 함 |
| F-17-11 | 크롤러·색인 제어 | S~M | **P1** / 기본 noindex는 P0 | F-06-08, F-13-09 | 기본 index로 운영하면 색인은 되돌릴 수 없다 |
| F-17-09 | 모더레이션·테이크다운 | L | P1 / 큐 UI는 P2 | F-17-08, 게시 파이프라인 | `moderation_state` 축이 없으면 테이크다운=삭제가 되어버림 |
| F-17-02 | 분석 수집·롤업 | L | P2 / **계측 훅은 P1** | F-11-18, 공용 스케줄러 | 이벤트는 소급 생성 불가 |
| F-17-01 | 분석 대시보드 4탭 | L | P2 | F-17-02/03, F-06-02 | — |
| F-17-04 | 검색 분석 | M | P2 / **클릭 계측은 P1** | F-07-01/02 | 랭킹 개선의 유일한 정답 신호, 백필 불가 |
| F-17-13 | 조직 잠금·커스텀 관리자 역할 | L | P2 | F-17-12, 조직 | capability enum 통합은 지금 해두면 공짜 |
| F-17-07 | 리전 마이그레이션 | XL | P2 | F-17-05/06 | 스코프 아웃 선언 권고 |

### 4.1 "스키마 1일차" 항목 — 이 도메인이 요구하는 되돌릴 수 없는 결정 10가지

| # | 항목 | 근거 |
|---|---|---|
| 1 | `workspace.region_id NOT NULL` + `resolveEndpoint()` 리졸버 | 리전은 파티션 키다. 파생 저장소가 쌓인 뒤 추가 = 전량 재색인 |
| 2 | `page.moderation_state` (lifecycle과 **직교**) | 테이크다운을 삭제로 구현하면 되돌릴 수 없다 |
| 3 | `audit_event.scope ∈ {account, workspace, teamspace, organization}` | 과거 이벤트의 scope는 판정 불가 |
| 4 | `setting_definition` 레지스트리 (12의 `user_setting` 흡수) | 이미 4곳으로 흩어짐. 5번째가 생기기 전에 |
| 5 | 조회·편집·검색클릭 **계측 훅** | 이벤트는 소급 생성 불가 |
| 6 | 옵트아웃 AND 게이트 함수 (4항, 나머지 상수 true 가능) | 사후 삽입 시 기존 데이터 처리가 법무 문제 |
| 7 | `form_submission_meta` 사이드카 (행 property에 넣지 않기) | 뷰·차트·자동화·내보내기로 새어 나간 뒤에는 회수 불가 |
| 8 | `admin_capability` 통합 enum | F-10-25 / F-17-01 / F-11-12 / F-07-15가 각자 정의 중 |
| 9 | 공개 페이지 기본값 `noindex` | 색인된 것은 즉시 되돌릴 수 없다 |
| 10 | `staff_user`(플랫폼 운영자) ≠ `admin_role`(고객 관리자) 테이블 분리 | 합치면 권한 사고 |

### 4.2 MVP에서 통째로 드롭해도 되는 것

| 항목 | 드롭 근거 |
|---|---|
| F-17-07 리전 마이그레이션 | 노션도 셀프서브가 아니다. "리전 변경 불가" 선언으로 XL → S |
| F-17-05~07 전체 | **셀프호스팅 제품이면 리전 = 배포 위치**. SaaS 계획이 없으면 도메인 B 전체 드롭 가능 |
| F-17-01의 Members / AI / Search 탭 | Content 탭 하나로 90% 가치. AI는 F-10-25 소유 |
| F-17-13 커스텀 관리자 역할 | 고정 역할 3개로 대체 |
| F-17-09 모더레이션 큐 UI | CLI 스크립트 1개로 대체. **조치 능력만 있으면 된다** |
| F-17-11 sitemap / 페이지별 색인 오버라이드 | 사이트 단위 토글 1개로 충분 |
| F-17-04 검색 분석 대시보드 | 로그만 쌓고 SQL로 조회 |

---

## 5. 오픈소스 클론 구현 참고

이 도메인은 오픈소스 노션 대안들이 **가장 명확하게 유료화 경계로 삼는 영역**이다. 이 사실 자체가 우선순위 판단의 근거가 된다.

| 프로젝트 | 라이선스 구조 | 이 도메인 관련 관찰 |
|---|---|---|
| **Docmost** | 코어 AGPL-3.0 + `/ee` 폴더 **프로프라이어터리** | SSO(OIDC)·**Audit log**·SCIM이 유료 EE 기능. 감사/거버넌스는 커뮤니티 에디션에 없다 |
| **AppFlowy** | AGPL-3.0 (클린) | 워크스페이스·협업 중심. 조직 계층·리전 개념 없음 |
| **Outline** | BSL 1.1 | 팀 위키. 감사·분석 표면 제한적 |
| **AFFiNE** | 오픈코어 | 프로프라이어터리 컴포넌트 존재 |

**여기서 얻는 판단**:
1. **거버넌스는 오픈소스 클론이 마지막에 만드는 영역이다.** 이 도메인 전체를 P0으로 잡는 것은 시장 관행과 어긋난다. 이 문서가 P0으로 지정한 것은 **기능이 아니라 스키마 축 3개**(region / moderation_state / setting registry)뿐이며, 그것이 옳은 균형이다.
2. **감사·SSO·SCIM이 유료 경계라는 것은 클론의 수익화 지점 힌트이기도 하다.** 13 F-13-18의 엔타이틀먼트 축에 `audit_log`, `data_residency`, `custom_admin_role`, `workspace_analytics`를 넣어두면 자연스럽다.
3. **셀프호스팅 클론에서 데이터 레지던시는 자동으로 해결된다** — 고객이 자기 인프라에 배포하면 리전은 배포 위치다. 즉 **SaaS로 팔 계획이 없다면 F-17-05~07은 전부 드롭 가능**하다. 이것이 이 도메인에서 가장 큰 스코프 절감 결정이다.

**구현 시 재사용 가능한 기성품**:

| 요구 | 기성품 | 비고 |
|---|---|---|
| 캡차 (F-17-10) | Cloudflare Turnstile / hCaptcha | 무료 티어로 충분. 조건부 노출 |
| 레이트리밋 (F-17-08/10) | Redis 슬라이딩 윈도우, 또는 엣지(Cloudflare Rate Limiting) | 엣지가 앱 부하를 아예 막아준다 |
| URL/파일 평판 스캔 (F-17-09) | Google Safe Browsing API, URLhaus, ClamAV | 자체 구현하면 XL |
| 리전 라우팅 (F-17-05) | Cloudflare Workers (노션과 동일 선택) | 워크스페이스 ID → 리전 KV 조회 |
| 분석 스토어 (F-17-02) | ClickHouse / DuckDB+Parquet / Postgres 파티션 | 초기에는 Postgres 파티션으로 충분 |
| 감사 로그 저장 (F-11-12) | append-only 테이블 + S3 아카이브 | 애플리케이션 DB와 분리 |
| 설정 레지스트리 (F-17-12) | 타입 안전한 TS 상수 + zod 스키마 | 런타임 변경이 필요해지면 테이블로 승격 |

---

## 6. 미해결 / 확인 필요

| # | 항목 | 상태 | 영향 |
|---|---|---|---|
| Q1 | 분석 옵트아웃 3계층이 실제로 AND인가 (조직이 켜면 개인 옵트아웃이 무시되는가) | `[추정]` — 문서에 우선순위 규칙 없음 | F-17-03의 판정 함수. **클론은 AND로 확정 선언함** |
| Q2 | 워크스페이스 analytics 토글을 끄면 기존 데이터가 삭제되는가, 숨겨지는가 | `[확인필요]` | F-17-03. 삭제는 되돌릴 수 없으므로 클론은 "숨김" 권고 |
| Q3 | 리전 마이그레이션 중 워크스페이스가 읽기 전용이 되는가 | `[확인필요]` — 노션 미공개 | F-17-07. 클론은 읽기 전용 창을 설계로 채택 |
| Q4 | 서드파티 AI 모델 추론이 리전 안에서 일어나는가 | `[확인필요]` — "subprocessors"로만 서술 | F-17-06. AI 기능의 레지던시 주장 범위 |
| Q5 | 노션이 테이크다운을 삭제로 구현하는가, 노출 차단으로 구현하는가 | `[추정]` — 공개 문서는 "remove"만 | §1.4. **클론은 직교 축으로 확정** |
| Q6 | 테이크다운 후 이의제기 절차가 존재하는가 | 문서에 **없음** (확인된 부재) | F-17-09. 클론은 자체 설계 필요 |
| Q7 | 공개 폼에 캡차·레이트리밋·중복 방지가 존재하는가 | 문서에 **없음** (help/forms 전수 확인) | F-17-10 전체가 클론 자체 설계임을 의미 |
| Q8 | 공개 페이지의 `Discoverable on the web` 기본값 | `[확인필요]` | F-17-11. **클론은 기본 noindex로 확정** |
| Q9 | 노션 "Security Center"(태세 점수·커스텀 체크)의 실체 | `[확인필요]` — audit 이벤트로만 존재 확인, 헬프 문서 없음 | F-17-13. 클론은 스코프 아웃 |
| Q10 | 페이지별 분석 옵트아웃(`My view history` per page)의 감사 이벤트 | `[확인필요]` | F-17-03 |
| Q11 | 분석 대시보드에서 옵트아웃 사용자가 "고유 조회자 수"에 포함되는가 | `[추정]` — 포함되되 목록에 미등장으로 가정 | F-17-01 UI 설명 문구 |
| Q12 | DB 행 페이지의 조회를 부모 페이지 조회에 합산하는가 | `[클론 결정]` — 노션 문서 없음 | F-17-02. 지표의 의미가 갈린다 |
| Q13 | `Search` 탭 CSV 내보내기 가능 여부 | `[확인필요]` — Members/Content/AI만 명시 | F-17-04 |
| Q14 | 조직 잠금 해제 시 "게시 차단으로 내려간 사이트"가 자동 재게시되는가 | `[클론 결정]` — 클론은 수동 재게시 권고 | F-17-13 |
| Q15 | 공개 사이트 도메인(notion.site)의 독립 robots.txt 내용 | 확인 실패 (302 리다이렉트) | F-17-11. 플랫폼 robots는 notion.so 것만 확인됨 |
| Q16 | 공개 API에 리전별 엔드포인트(예: eu.api.notion.com)가 존재하는가 | `[확인필요]` — `developers.notion.com/docs/data-residency` 404 | F-17-06. 통합/웹훅의 리전 계약 |

### 6.1 다른 문서에 남기는 요구 (정본 결정 시 반영 필요)

| 대상 문서 | 요구 | 근거 F-ID |
|---|---|---|
| **00 정본 데이터 모델(신설 예정)** | `workspace.region_id`, `page.moderation_state`, `audit_event.scope`를 정본 스키마에 포함 | F-17-05, 09, 13 |
| 11-history-notifications.md | `audit_event`에 `scope` + `setting_key` + `value_before/after` 추가 | F-17-12, 13 |
| 11-history-notifications.md | F-11-18의 조회 프라이버시를 **3계층 AND 게이트**로 확장 | F-17-03 |
| 11-history-notifications.md | F-11-15 `created_by`를 **NULL 허용 또는 system principal**로 (익명 폼 제출 행) | F-17-10 |
| 12-platform-ux.md | `user_setting(scope='account'\|'device')`를 F-17-12의 `setting_value`에 흡수. scope enum 4값화 | F-17-12 |
| 13-adjacent-products.md | F-13-02(폼 제출)에 **사이드카 메타 테이블** 요구 추가. 응답 행 property에 IP/UA를 넣지 말 것 | F-17-10 |
| 13-adjacent-products.md | F-13-09의 `site_seo.robots` 단일 enum을 `robots_directive` + `ai_crawler` **2축으로 분리** | F-17-11 |
| 10-ai-features.md | F-10-25의 `admin_capability` enum을 F-17-13의 통합 enum으로 합류 | F-17-13 |
| 07-search-navigation.md | F-07-06 `search_document`에 `region_id`. F-07-01 검색 결과 **클릭 계측 훅** | F-17-06, F-17-04 |
| 09-api-integrations.md | F-09-09 `webhook_subscription`에 `allowed_egress_region` | F-17-06 |
| 06-permissions-sharing.md | F-06-19가 "언급"한 `organization`을 **정본 엔티티로 승격** | F-17-12, 13 |
| 08-templates-automation.md | F-08-10 자동화 트리거가 `spam_score` 임계 미만 행에만 발화. 또한 U-4의 **공용 스케줄러**를 F-17-02도 요구 | F-17-10, F-17-02 |
| 14 계정·인증(신설 예정) | `user.analytics_opt_out`(per-account), `support_access_granted_until`(기본 28일) | F-17-03, F-17-12 |

---

## 7. 참고 출처

> WebFetch로 본문을 직접 확인한 것은 ✔, 검색 결과 요약만 확인한 것은 △.

| # | URL | 확인 | 이 문서에서 근거로 쓴 내용 |
|---|---|---|---|
| 1 | https://www.notion.com/help/workspace-analytics | ✔ | 4탭(Members/Content/AI/Search), owner만 3탭 접근·멤버는 Content만, Enterprise 전용, **365일** 창, 가입일부터 수집(백필 없음), Members 90일 그래프, AI 탭 1일 1회 갱신·AI 응답 등장 상위 100페이지, Search 탭 `>1 user AND >1 time` 필터, CSV 내보내기, **page edit = 1분 윈도우**, active member 정의 |
| 2 | https://www.notion.com/help/data-residency | ✔ | 리전 3종(US us-west-2→us-east-2 / EU eu-central-1→eu-west-1 / APAC ap-northeast-1·2), 일본·한국은 account team 문의, Enterprise 무상, 조직 설정 `Data & Compliance → Data Residency`에서 기본 리전, 마이그레이션은 문의 기반·**구 리전 30일 후 삭제**, 리전 내 4종(페이지 콘텐츠·업로드 파일·검색 인덱스·서드파티 메시지), 리전 밖(계정 정보·사용량·서브프로세서), **Calendar·Mail·Beta 미커버**, "data at rest만" |
| 3 | https://www.notion.com/blog/enabling-multi-region-data-systems-at-notion | ✔ | workspace ID = 라우팅·파티셔닝 키, Cloudflare space-aware workers, 중앙 워크스페이스→리전 매핑 테이블, EU 전용 Elasticsearch, 리전 Kafka/Spark/vector DB, Debezium CDC → 리전 data lake, Airflow는 US(고객 데이터 미처리), 리전 enum 공유 라이브러리, 데이터 정제 후 반출, 일본·한국 확장 계획 |
| 4 | https://www.notion.com/help/report-inappropriate-content | ✔ | 공개 페이지 `···` → `Report page`, 사유 4종(Phishing or spam / Inappropriate content / DMCA takedown request / Other), 맥락 입력 후 제출, CX 팀 큐 적재, DMCA는 별도 정식 절차, **이의제기 절차 서술 없음** |
| 5 | https://www.notion.com/blog/our-content-and-use-policy | ✔ | 금지 콘텐츠 목록, "자동+수동 조합으로 공개 페이지 스캔·식별·제거", high recall 자동 멀웨어 탐지, AI·크라우드소싱 업체 제휴, CX 팀 human review, **투명성 보고서 없음**, **이의제기 언급 없음** |
| 6 | https://www.notion.com/help/organization-level-controls | ✔ | 조직 탭 전수(General / People / Security / Admin bots & tokens / Data & Compliance / Analytics / Notion credits)와 각 항목, **`Bulk apply`로 전 워크스페이스 강제**, 잠기면 워크스페이스 owner는 "managed by their organization"만 확인, 조직 owner vs 워크스페이스 owner |
| 7 | https://www.notion.com/help/workspace-settings | ✔ | 워크스페이스 탭(General/Emoji/Security/Identity)과 항목, **`Save and display page view analytics`**, `Disable publishing sites and forms`, `Disable export`, 휴지통 보존 정책, 커스텀 이모지 생성 제한 |
| 8 | https://www.notion.com/help/account-settings | ✔ | 계정당 **이메일 최대 5개**, 비밀번호 8자·고유문자 4자, passkey·2FA, 전 디바이스 로그아웃, 계정 삭제, **`Show my view history`는 per-account / Appearance·고대비는 per-device**, 프로필 발견 가능성 |
| 9 | https://www.notion.com/help/page-analytics | ✔ | `···` → `Updates & analytics` → `Analytics` 탭, 총/고유 조회, `Settings → Preferences → Privacy → Show my view history → Don't record`, 페이지별 `My view history → Don't record` |
| 10 | https://developers.notion.com/compliance/audit-log-events | ✔ | 이벤트 taxonomy 7개 섹션(Page 37 / Data source 9 / Workspace 140+ / Account 16+ / Teamspace 32 / Form 5 / Organization 95+). 이 도메인 근거: `Content Analytics exported`, `User Analytics exported`, `Workspace analytics tracking toggled`, `User analytics tracking toggled`, `Page view analytics toggled for the organization`, `Default new workspace region updated`, `Public page sharing toggled`, `Public home page set/cleared`, `Teamspace public page sharing toggled`, `Disable publishing sites and forms toggled for the organization`, `Granted/Revoked support access`, `Custom admin role created/deleted/updated`, `IP restrictions toggled`·`IP allowlist created/updated/deleted`·`IP restriction enforcement mode changed`, `Security Center category weights/custom checks updated`, `Legal hold *`, `Organization token created/updated`, `Search performed`, `Content search queried`, `Delete from Trash delay updated` |
| 11 | https://www.notion.com/help/public-pages-and-web-publishing | ✔ | `Search engine indexing` → **`Discoverable on the web`** 토글, 유료 플랜만 SEO 제목·설명 편집, **색인까지 최대 4주**, `Duplicate as template`·`Embed this page` 토글, Enterprise `Settings → Security → Disable publishing sites, forms, and public links` + **"이미 라이브인 사이트는 즉시 내려감"** |
| 12 | https://www.notion.so/robots.txt | ✔ | `Allow: /` 기본 + 초대·템플릿검색·실험·embed 경로 Disallow, **BLEXBot / AhrefsBot / Amazonbot / SemrushBot / dotbot 전면 차단**, sitemap 10개 |
| 13 | https://www.notion.com/help/forms | ✔ | 공유 3상태(워크스페이스 전용 / 웹 공개 / No access=마감), 익명 응답 토글, 제출 알림, 응답자 사후 권한 5단계. **캡차·레이트리밋·중복 제출 방지·응답 상한 서술이 전혀 없음** (F-17-10이 클론 자체 설계임을 확정하는 근거) |
| 14 | https://www.notion.com/help/data-access-consent | ✔ | 지원 접근은 사용자가 문의 후 명시적으로 부여, 계정 접근(대행)과 워크스페이스 접근(비대행) 분리, **기본 28일 후 자동 만료**, 언제든 철회, **부여·변경·종료가 audit log에 기록**, 조직 설정 `Allow users to grant support access to accounts` |
| 15 | https://www.notion.com/help/track-usage-in-the-notion-credits-dashboard | ✔ | 크레딧 대시보드 차원(Custom Agents / Autofill / Workers 탭, 에이전트별·멤버별 행), 청구 주기 기준 기간 + reset date, 에이전트별·멤버별 한도, **80% / 100% 알림**, Business·Enterprise 관리자 + 에이전트 생성자 제한 조회 |
| 16 | https://www.notion.com/help/manage-ai-models-and-member-credit-spend | ✔ | `Settings → Notion AI → Usage`에서 프리미엄 모델 on/off·기본 크레딧 한도·개인 상향, Business/Enterprise, Enterprise는 Admin API로 워크스페이스 횡단 관리 |
| 17 | https://www.notion.com/help/audit-log | △ | Enterprise 전용, 보관 창, CSV 내보내기, SIEM 웹훅 스트리밍 (상세는 F-11-12가 이미 소유) |
| 18 | https://www.notion.com/help/ip-address-restrictions | △ | 조직 owner가 IP 허용목록 설정, enforcement 2종: **`Maintain session`(기본, 다음 로그인에 적용) / `Require re-authentication`(IP 이탈 즉시 세션 종료)** |
| 19 | https://techcrunch.com/2021/02/15/notions-hours-long-outage-was-caused-by-phishing-complaints/ | △ | 대량 피싱 신고가 도메인 차단 → 수 시간 장애. **신고 경로 자체가 공격 벡터**라는 F-17-08 엣지 케이스의 근거 |
| 20 | https://appflowy.com/compare/appflowy-vs-docmost , https://www.opentechhub.io/docmost/ | △ | Docmost는 코어 AGPL-3.0 + `/ee` 프로프라이어터리(SSO·**Audit log**·SCIM 유료), AppFlowy는 AGPL-3.0 클린, Outline은 BSL 1.1 → **거버넌스가 오픈소스 클론의 유료 경계**라는 §5 판단의 근거 |

### 조사 수행 기록

- **WebSearch 7회**: ① 공개 페이지 남용 신고·테이크다운 ② 폼 캡차·중복 제출·레이트리밋 ③ 조직 설정 vs 워크스페이스 설정(Data & Compliance) ④ Notion Sites 색인·robots·sitemap ⑤ AI 크레딧 관리자 설정·워크스페이스 한도 ⑥ 감사 로그 이벤트 목록·보관·내보내기 ⑦ Security Center / IP allowlist / 오픈소스 클론 거버넌스
- **WebFetch 16회**: help/workspace-analytics, help/data-residency, blog/enabling-multi-region-data-systems-at-notion, help/report-inappropriate-content, blog/our-content-and-use-policy, help/organization-level-controls, help/workspace-settings, help/account-settings, help/page-analytics, developers.notion.com/compliance/audit-log-events(2회 — 2회차는 전체 taxonomy), help/public-pages-and-web-publishing, notion.so/robots.txt, help/forms, help/data-access-consent, help/track-usage-in-the-notion-credits-dashboard, help/manage-ai-models-and-member-credit-spend
- **확인 실패(그 자체가 정보)**: `notion.com/help/notion-sites-seo` 404 → help/public-pages-and-web-publishing으로 대체 / `developers.notion.com/docs/data-residency` 404 → **공개 API 문서에 리전별 엔드포인트 서술이 없음**을 시사 `[확인필요]` (Q16) / `notion.site/robots.txt` → www.notion.so로 302, 공개 사이트 도메인의 독립 robots.txt 확인 실패 (Q15)
