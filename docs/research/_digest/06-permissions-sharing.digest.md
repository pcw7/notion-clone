# 06. 권한 · 공유 · 퍼블리싱 — 종합용 다이제스트

> 원본: `docs/research/06-permissions-sharing.md` (1,281줄 / 20 features, 2026-09-06 GAP 검토 반영본)
> 스키마 정본은 `00-canonical-data-model.md`. 아래 「데이터 모델」은 **이 도메인이 정본에 요구하는 사항**만 기술한다.

---

## 0. 이 도메인의 지배 규칙 (마스터 문서가 반드시 반영해야 할 5가지)

| # | 규칙 | 근거 |
|---|---|---|
| R1 | **broadest wins** — 여러 출처의 권한 중 **최댓값** 적용. deny 개념이 없다(grant 합집합). | 공식: "Notion respects the broadest level of access given to a user." (help/sharing-and-permissions) |
| R2 | **admin 역할 ≠ 콘텐츠 접근** — workspace owner/membership admin은 페이지 ACL을 얻지 않는다. 관리자 열람은 ACL이 아닌 **별도 admin 도구**(Content Search) 경로. | 공식: "Admin roles don't change what someone can see or edit in pages or databases." (help/organization-level-controls) |
| R3 | **teamspace owner는 예외** — 그 teamspace 전 페이지에 기본 full access. workspace owner와 정반대. 이 비대칭이 최대 오해 지점. | help/intro-to-teamspaces |
| R4 | **정책(policy)이 유일한 deny 계층** — ACL보다 **먼저** 평가. 평가 순서 = `org 정책 → workspace 정책 → ACL → lock`. | help/organization-level-controls, help/workspace-settings |
| R5 | **레벨은 전순서가 아니다** — `Can create`는 "새 row 생성 가능하나 기존 row 열람 불가"라 `Can view`보다 크다고 할 수 없다. `level`을 단일 정수 서열로 두면 깨진다 → **`(subject_kind, level) → capability_bits` 2차원 매핑** 필수. | help/sharing-and-permissions |

**유효 권한 계산식(정본 요구)**
```
can(U, N, action) =
  policy_gate(org→ws, action)          -- deny 계층. 실패 시 즉시 DENY
  AND MAX over grants ≥ required(action)
      grants = { N의 acl_entry(U/group/teamspace/workspace_everyone/integration/agent),
                 상속(부모 재귀), teamspace 기본 부여, page_access_rule,
                 public_link, form 제출자 }
  AND NOT lock_blocks(N, action)       -- ACL과 무관한 별도 게이트
```

---

## 1. 기능 인벤토리 (전수 20/20 — 원본 `### F-` 카운트 20과 일치)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-06-01 | 액세스 레벨 체계 (full/edit/edit content/create/comment/view) | M | **P0** | 인증, block 트리, F-06-02 |
| F-06-02 | 워크스페이스 역할 (owner / membership admin / member / restricted member / guest / temporary) | M~L | **P0** (admin·restricted·org은 P2) | 인증 |
| F-06-03 | 그룹(Group) 기반 권한 부여 | M | P1 | F-06-02, (F-06-14 강결합) |
| F-06-04 | Teamspace와 가시성 (open/closed/private + is_default 플래그) | L | P1 | F-06-02, F-06-05, 사이드바 |
| F-06-05 | 페이지 권한 상속·오버라이드 (유효 권한 계산) | **XL** | **P0** | block 트리, F-06-01, F-06-04 |
| F-06-06 | 공유 패널: 초대 · 링크 복사 · 접근 요청 진입 | M | **P0** | F-06-01, F-06-02, 메일/알림 |
| F-06-07 | General access: 워크스페이스 전체 / 웹 링크 / 링크 만료 | M | **P0**(초대만·ws전체) / P1(웹링크) / P2(만료) | F-06-06, F-06-11 |
| F-06-08 | 웹 게시 (Publish to Web / Notion Sites, 커스텀 도메인·SEO) | **XL** | P1 | F-06-07, F-06-11, SSR/CDN |
| F-06-09 | 게스트 관리: 한도 · 승격 · 초대 요청 | M | P1 | F-06-02, F-06-06, F-06-11 |
| F-06-10 | DB 세분화 권한: Can edit content · Can create · Page-level access rule | L | P2 (row별 Share는 P1) | DB 도메인, F-06-05, F-06-01 |
| F-06-11 | 워크스페이스 보안 정책 (금지형 + 요청허용형 + org 3상태 오버라이드) | M | P2 (퍼블릭 차단은 P1) | F-06-02, F-06-07~09 |
| F-06-12 | 엔터프라이즈 아이덴티티: SAML SSO · SCIM · 도메인 검증 · 감사 로그 | L | P2 | F-06-02, 인증 도메인 |
| F-06-13 | API 연동(Connection) 권한과 capability 모델 | M~L | P2 | F-06-05, OAuth, API 도메인(09) |
| F-06-14 | 권한 캐시 · 사이드바/검색 필터링 · 무효화 전파 | **XL** | **P0**(post-filter 최소정합) / P1(캐시최적화) | F-06-05, 검색(07), 실시간(05) |
| F-06-15 | 접근·승격 요청 플로우 (Request access / edit / add) | M | P1 | F-06-01, F-06-05, F-06-11, 알림(11) |
| F-06-16 | 페이지 잠금 · 데이터베이스 잠금 (Lock page / Lock database) | S~M | **P1 (ROI 최상)** | F-06-01, 실시간, 블록편집(01) |
| F-06-17 | Forms: 공개 제출과 응답자 사후 접근 권한 | M~L | P2 | DB 도메인, F-06-07, F-06-10, F-06-11 |
| F-06-18 | Custom Agent 권한: 자체 권한을 가진 비인간 principal | L | P2 (단 principal 확장성 결정은 P0) | F-06-01, F-06-05, F-06-14, AI(10) |
| F-06-19 | 조직 계층 · Content Search · Audit Log audience | L | P2 (`exposure` 파생필드는 P1) | F-06-02, F-06-11, F-06-12 |
| F-06-20 | 페이지 이동과 권한 전이 (Private ↔ Teamspace ↔ 타 워크스페이스) | L | **P0** | F-06-05, F-06-04, F-06-07/08, F-06-14 |

**P0 = F-06-01, 02, 05, 06, 07(부분), 14(부분), 20** (7개)

---

## 2. 데이터 모델 — 이 도메인이 정본에 요구하는 것

### 2.1 필수 엔티티 (신규 요구)

| 엔티티 | 이 도메인이 요구하는 이유 | 핵심 필드 |
|---|---|---|
| `acl_entry` | **권한의 유일한 저장 지점.** 명시 부여만 저장, 상속은 저장 안 함 | `(node_id, node_kind{block,teamspace}, principal_type, principal_id, level)` + `UNIQUE(node_id, principal_type, principal_id)` + `node_id` 인덱스 필수(게스트 N행 문제) |
| `workspace_member` | role은 **좌석·과금·admin capability만** 결정. 콘텐츠 접근은 acl_entry 단독 | `role ENUM(owner, membership_admin, member, restricted_member, guest)`, `is_temporary`, `status`, `expires_at` |
| `group` / `group_member` | ACL principal. **중첩 금지 권장**(순환·비용) | workspace 스코프, 이름 unique 권장. 게스트 포함 불가 |
| `teamspace` / `teamspace_member` | 트리 루트 계층. 권한 계산에서 **block과 동일한 노드로 취급** | `visibility ENUM(open,closed,private)`, `is_default BOOL`(직교), `who_can_invite`, `archived_at` / member: `principal_type(user|group)`, `role(owner|member)` |
| `public_link` | 노드 로컬 공개 상태. **이동해도 살아남음(유출 위험)** | `(node_id PK, enabled, level, expires_at, token)` |
| `site` / `custom_domain` / `site_slug_reservation` | 웹 게시 | `root_node_id, host, slug, indexable, allow_duplicate_as_template, og_*, analytics_id` |
| `page_access_rule` | 값 기반 동적 row 권한 | `(database_id, source_property_id, source_kind{person_property,created_by}, level)` |
| `security_policy` / `org_security_policy` | 유일한 deny 계층 | ws: 금지형 4 + 요청허용형 6. org: `(org_id, policy_key, mode ENUM(workspace_managed, enabled_for_everyone, disabled_for_everyone))` |
| `node_lock` | ACL과 **별도 게이트** | `(node_id PK, kind{page,database}, locked, locked_by, locked_at)` |
| `access_request` | 6종 요청 kind 상태머신 | `kind, node_id, requester_id/email, requested_level, status ENUM(pending,approved,denied,superseded)` + **부분 유니크 인덱스**(pending 중복 방지) |
| `form` | 유일한 익명 쓰기 경로 | `(database_id, audience{no_access,workspace_link,public_link}, anonymous, submitter_access, slug)` |
| `agent` / `agent_source` / `agent_share` | 1급 비인간 principal | `agent_share.level ENUM(view_interact, edit, full_access)` |
| `organization` / `organization_member` | workspace 상위 스코프 | Enterprise. `organization_id`는 **nullable로 미리 심어둘 것** |
| `sso_config` / `scim_token` / `user_identity` / `verified_domain` / `audit_log` | 엔터프라이즈 아이덴티티 | audit_log는 append-only + 시간 파티셔닝 |

### 2.2 기존 엔티티에 대한 요구사항 (정본 협의 필요)

| 대상 | 요구 | 사유 |
|---|---|---|
| `block` | `parent_type ENUM('workspace','teamspace','block','database')`, `is_private_root BOOL` | Private 섹션을 "사용자 private root를 부모로 갖는 노드"로 표현하면 별도 개념 불필요 |
| `block` | **`path` (materialized path) 또는 `block_ancestor` closure table 중 하나 필수** | 상속 재귀 O(depth) 제거. **권장: materialized path** — 10만 노드 서브트리 이동 시 closure 재구축(O(서브트리×깊이))보다 prefix 치환이 훨씬 싸다(F-06-20) |
| `block` | `exposure ENUM(private, shared_internally, shared_externally, shared_to_web)` 파생 비정규화 컬럼 | audit_log audience 4분류와 동일. "외부 공개 페이지 전부" 거버넌스 쿼리를 O(1)로. **P1로 앞당길 가치** |
| `block_acl_meta` | `inherits_from_parent BOOL` | **주의: 이것은 구현 선택지이지 노션의 확인된 구조가 아니다** `[추정]`. 문서로 확인되는 요구는 ①하위에서 재정의 가능 ②Private 이동 override는 **부모에만** 적용되고 하위 명시 부여는 생존, 두 가지뿐 |
| `user` | `type ENUM('person','bot','agent')` | 통합/에이전트 작성자 표기. 사람 이름으로 기록하면 감사가 무너짐 |
| 검색 문서 | `acl_principals[]` 비정규화 필드 | F-06-14. 질의 시 사용자 principal 집합과 교집합 필터 |
| 캐시(Redis) | **2축 세대 카운터** — 노드축 `perm_ver:{node_prefix}` + 주체축 `perm_gen:{principal_id}` | 키를 `perm:{user}:{gen}:{node}:{ver}`로 구성하면 무효화가 **키 삭제 없이 카운터 증가만**으로 끝남 |

### 2.3 capability 비트 매핑 (`(subject_kind, level) → bits`)

| level | view | comment | edit_content | create_child | edit_structure | share | manage_perm |
|---|---|---|---|---|---|---|---|
| Full access | O | O | O | O | O | O | O |
| Can edit | O | O | O | O | O | X | X |
| Can edit content (DB) | O | O | O | O | X | X | X |
| Can create (DB) | X | X | X | O | X | X | X |
| Can comment | O | O | X | X | X | X | X |
| Can view | O | X | X | X | X | X | X |

레벨 집합은 **대상별로 다르다**: page/DB 6종 / teamspace(owner,member) / form 응답자 5종 / agent 3종 / integration capability 8비트.

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 되는 것

| 항목 | 근거 |
|---|---|
| **F-06-05 상속** | 상속 없으면 하위 페이지마다 수동 공유 → 사용 불가능한 제품 |
| **F-06-01 레벨(최소 view/comment/edit)** | 없으면 "공유"라는 개념 자체가 성립 안 함 |
| **F-06-02 owner/member/guest** | 워크스페이스 경계·좌석의 기본 |
| **F-06-06 공유 패널** | 권한을 부여하는 유일한 UI 진입점 |
| **F-06-07(부분) Only invited / Everyone at workspace** | 팀 문서의 기본 상태 |
| **F-06-14(부분) 검색·사이드바 post-filter** | **정합성 문제**. 필터 누락 = 즉시 정보 유출. 캐시는 빼도 되지만 필터는 못 뺌 |
| **F-06-20 이동 시 권한 재계산** | 이동은 기본 기능이고, 잘못 옮기면 곧 유출 |

### 3.2 빼도 되는 것 / 대체안

| 뺄 것 | 대체안 |
|---|---|
| F-06-03 그룹 | teamspace(space) 멤버십으로 대체. v1에 도입 |
| F-06-04 teamspace 가시성 4종 | `space` 1종 + `open/closed` 2값. private teamspace는 v2 (Docmost Space / Outline Collection이 정확히 이 레이어) |
| F-06-08 웹 게시 | `/{ws}/p/{slug}` 공개 읽기전용 SSR + `noindex` 기본값. 커스텀 도메인은 Vercel/Cloudflare for SaaS에 위임 |
| F-06-09 게스트 | F-06-07 공개 링크(view/comment)로 외부 협업 근사 |
| F-06-10 DB 세분화 권한 | PostgreSQL **RLS**로 `assignee = current_user` 2종 정책만 구현 |
| F-06-11 정책 | `workspace.policy JSONB` 1컬럼 + 서버 미들웨어 1곳 평가 |
| F-06-12 SSO/SCIM | Keycloak / Auth0 / WorkOS 브로커에 위임, 내부엔 `user_identity` 매핑만 |
| F-06-13 API 권한 | PAT 1종 + 워크스페이스 전체 스코프. capability는 `read/write/comment` 3비트 |
| F-06-15 요청 플로우 | "권한 없음 + 소유자 표시" 화면. v1에서 `page_access` 1종 + 이메일 승인 토큰 |
| F-06-17 Forms | **공개 링크 + `can create` 레벨**로 근사(기존 row 못 봄, 새 row만 생성) |
| F-06-18 Agent | 에이전트를 만들지 않고 "질문자 권한으로만 검색·답변"(impersonation 없음) — 대부분의 클론에 이쪽이 정답 |
| F-06-19 조직 계층 | workspace 단위로 시작 + `organization_id` nullable 컬럼만 미리 심음 |
| F-06-14 캐시 | **캐시 없이 매 요청 DB 재판정.** 문서 1만 이하면 충분하고, 캐시가 없으면 무효화 누락도 없다(정합성 확보 수단) |
| F-06-20 cross-space 이동 | MVP는 **같은 space 내부 이동만** 허용 → 권한 델타 문제 전체가 소멸 |

### 3.3 절대 나중으로 미루면 안 되는 설계 결정 (마이그레이션 비용이 큼)

1. `acl_entry.principal_type`을 **확장 가능한 enum**으로 — 나중에 `integration`(F-06-13), `agent`(F-06-18)가 들어온다.
2. **admin 권한(설정·멤버)과 콘텐츠 권한(ACL)을 처음부터 별도 축으로** — 노션이 실제로 그렇게 되어 있고(R2), 나중에 분리하려면 전 엔드포인트를 다시 훑어야 한다.
3. `level`을 정수 서열이 아니라 **capability 비트로** (R5).
4. 권한 판정을 **단일 모듈로 중앙화**(Outline의 `policies` 레이어 방식) — 모든 엔드포인트가 그것만 호출.
5. `organization_id` nullable 컬럼 선반영.

---

## 4. 기술 난제 & 권장 구현 접근 (L / XL 항목)

| F-ID | 난이도 | 왜 어려운가 | 권장 접근 | 참고 OSS |
|---|---|---|---|---|
| **F-06-05** 상속·유효권한 | **XL** | 재귀 계산 + 캐시 무효화 + 트리 이동 재계산 + 실시간 반영이 결합. 깊이 50+ 트리에서 O(depth) 조회 | ① MVP: space 단위 권한만 → 상속 계산 자체를 만들지 않음 ② v1: materialized path/closure + 판정 함수 단일 모듈 ③ v2: Zanzibar 계열로 외부화, 앱은 tuple 동기화만 | **Permify** 모델링 글(상속을 재귀 SQL이 아닌 **관계 규칙**으로 선언, `entity:id#relation@user:id`), SpiceDB, OpenFGA, **Outline** `policies` |
| **F-06-14** 캐시·필터·무효화 | **XL** | 알고리즘이 아니라 **무효화 트리거가 7종**(ACL·그룹·teamspace·이동·person property·정책·잠금)이고 각각 다른 축으로 퍼짐. 하나만 빠뜨려도 유출이며, 유출은 테스트가 아니라 사고로 발견됨 | ① 원칙: **축소는 즉시 동기 무효화, 확대는 TTL 지연 허용** ② 2축 세대 카운터(노드 prefix / principal) ③ 검색은 `acl_principals[]` 비정규화 + **반환 직전 post-filter 재검증** ④ 캐시 스탬피드는 single-flight 락 | Permify, Zanzibar 논문 |
| **F-06-08** 웹 게시 | **XL** | SSR + CDN 캐시 + **무효화**(실패 = 정보 유출), 커스텀 도메인 DNS 검증 + TLS 자동발급, SEO 메타, 복제 파이프라인이 전부 별개 서브시스템 | 커스텀 도메인·TLS는 **Vercel / Cloudflare for SaaS에 아웃소싱**. 공개 경로는 **커밋된 스냅샷만** 읽음(미저장 CRDT 유출 방지). 하위 권한 제한 시 렌더캐시·CDN·검색엔진 3중 무효화 | Vercel Domains API, Cloudflare for SaaS |
| **F-06-04** Teamspace | **L** | visibility × (사이드바/검색/멘션/공유 자동완성/브라우저) 노출 규칙 전부 분기 + archive/복원 경로. `is_default` 켜는 순간 멤버 5,000명 fan-out | teamspace를 **트리의 한 노드**로 취급하고 owner를 `acl_entry(node_kind='teamspace', level='full_access')`로 표현 → 별도 분기 없이 상속에 흡수. `is_default` 전환은 **큐 비동기 fan-out** | Docmost Space, Outline Collection |
| **F-06-20** 이동·권한 전이 | **L** | ①권한 델타 프리뷰 계산 ②서브트리 캐시 무효화 ③공개 링크·사이트 URL 재계산 ④동시성 직렬화 | `acl_entry`는 **건드리지 않는다**(명시 부여는 노드에 붙음). parent_id + path prefix 치환을 한 트랜잭션. **부모 노드 advisory lock**으로 서브트리 직렬화. `perm_ver:{old_prefix}` / `{new_prefix}` 둘 다 증가 | — |
| **F-06-10** DB 세분화 권한 | **L** | 권한이 **데이터 값에 의존해 동적으로 변함**. 10만 row에서 행별 재계산 불가 → 목록·롤업·집계 쿼리 전부에 필터 필요 | 규칙 엔진 대신 **PostgreSQL RLS**. 규칙 종류를 person/created_by 2종 고정 → 정책 SQL도 2종 | PostgreSQL RLS |
| **F-06-12** SSO/SCIM | **L** | SAML 서명 검증·리플레이 방지, SCIM 2.0 엔드포인트가 각각 별도 작업 | **IdP 브로커 위임**(Keycloak/Auth0/WorkOS). 브레이크글래스 계정 필수 | WorkOS, Keycloak |
| **F-06-18** Custom Agent | **L** | confused deputy를 제품화한 것. 소유자 권한 축소 시 **에이전트가 유령 권한**을 가짐 | `acl_entry.principal_type='agent'`로 1급 principal화 → F-06-14 필터·캐시 재사용. **`effective(agent,node)`와 `agent_share(caller)` 두 판정을 절대 섞지 않는 것**이 안전성 전부. 에이전트 ACL을 소유자 권한의 부분집합으로 재계산하는 배치 `[추정]` | — |
| **F-06-19** 조직 계층 | **L** | 조각은 작으나 **workspace를 전제한 모든 쿼리에 스코프를 하나 더** 얹음. 나중에 넣으면 마이그레이션 비용 큼 | `organization_id` nullable 선반영. Content Search는 **제목·ID 인덱스만**(본문 인덱스는 유출 위험). 관리자 열람은 **반드시 audit log 기록** | — |
| **F-06-02** 역할 | **M~L** | 게스트/restricted member의 "기본 접근 0" 특성이 사이드바·검색·멘션·자동완성 전 영역에 예외를 만듦 + 좌석 과금 연동 | role과 ACL을 별도 축으로. `seat_count = count(role != guest AND NOT is_temporary)` | Docmost 3역할 |
| **F-06-11** 정책 | **M**(상향) | **게이트 누락 하나 = 정책 우회.** 수십 개 엔드포인트 커버리지 | `policy_gate(action) → policy_key` 매핑표를 단일 소스로 → 새 기능 추가 시 누락을 컴파일 타임에 포착. 정책 켤 때 **행 삭제 금지, 런타임 게이트로 무효화**(되돌릴 수 있게) | — |
| **F-06-17** Forms | **M~L** | **인증 없는 쓰기 엔드포인트** — 이 도메인 유일의 익명 쓰기. 남용 방어가 본체 | rate limit + captcha 필수. 제출 시 `acl_entry(new_row, 제출자, submitter_access)` 자동 생성. 익명이면 principal 없으므로 스킵 | — |

### 오픈소스 절단선 참고

| 프로젝트 | 권한 단위 | 페이지 단위 권한 | 차용점 |
|---|---|---|---|
| **Docmost** | Space (Admin/Editor/Viewer 3역할) | **미지원(이슈 #531)** | Space 3역할로 시작해 페이지 상속을 회피한 절단선이 MVP와 정확히 일치 |
| **Outline** | Collection (read/write/manage) | 문서 membership 후행 도입 | broadest-wins 동일 규칙. 판정을 `policies` 레이어로 **중앙화**한 구조 |
| **AppFlowy** | Workspace/Space | 페이지 공유 존재 | 로컬 우선에서도 권한은 **서버 측 게이트**로 분리 |
| **Permify** | ReBAC tuple | 규칙으로 상속 표현 | `permission write = writer or workspace.write` — 재귀 SQL 대신 선언적 규칙 |

**3단계 로드맵**: MVP=Docmost 절단선(space 3레벨, 상속 계산 없음) → v1=materialized path + 상속 + 판정 단일 모듈 → v2=Zanzibar 외부화.

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 이 도메인이 요구하는 것 |
|---|---|---|
| **01 block-editor** | block 트리가 곧 권한 트리 | `parent_id`, `path`/closure, `is_private_root`. **`synced block`/`link to page`는 참조일 뿐 부모가 아니므로 권한을 전달하지 않는다** `[추정]` — 반드시 명시할 규칙. 페이지 deep copy는 "템플릿 복제"에 재사용 |
| **02 page-workspace** | 사이드바 트리, Private 섹션, 페이지 이동 | 사이드바는 접근 가능 노드만 렌더. Private = "사용자 private root를 부모로" 표현. **이동 다이얼로그에 권한 델타 프리뷰**(F-06-20) |
| **03/04 database** | `Can edit content` vs `Can create`, page-level rule, row별 Share | `edit_structure` / `edit_content` **action 분류가 DB 도메인에도 필요**(F-06-16 Lock database의 전제). 롤업·집계 쿼리에도 동일 ACL 필터 적용(누출 방지) |
| **05 collaboration-sync** | 실시간 권한 변경 전파 | `permission_revoked` / `lock_changed` WebSocket 이벤트. 권한 강등 시 세션 read-only 전환 + 미커밋 op 처리 정책. 공개 링크 edit 세션은 **링크 세션 단위 CRDT actor id** 발급 |
| **07 search-navigation** | 검색·멘션 결과 필터링 | 인덱스에 `acl_principals[]`. 반환 직전 post-filter 재검증. 접근 불가 페이지 제목은 백링크·멘션에서 **마스킹** |
| **09 api-integrations** | integration이 ACL principal | `principal_type='integration'`, capability 8비트. **capability 부족=403 `restricted_resource`, 미공유=404 `object_not_found`**(존재 자체를 숨기는 좋은 패턴) |
| **10 ai-features** | Custom Agent = 1급 principal | `principal_type='agent'`. 검색 인덱스에 에이전트를 별도 principal로 |
| **11 history-notifications** | Inbox 요청 카드, audit log | `notification(type='access_requested'|'access_granted')`. audit_log에 **audience 4분류**(private/shared_internally/shared_externally/shared_to_web) |
| **14 auth-accounts** | user, SSO, 세션 | `user_identity(provider, external_id UNIQUE)`. 게스트도 자기 Notion 계정 필요. deprovision 시 세션 즉시 무효화 |
| **17 ops-governance** | 정책·감사·Content Search | 정책 평가 3단(org→ws→ACL). 관리자 열람은 **ACL과 다른 코드 경로**여야 감사가 의미를 가짐 |

---

## 6. 최우선 미해결 질문 (Top 5)

| # | 질문 | 왜 최우선인가 | 확인 방법 |
|---|---|---|---|
| 1 | **상속 차단(restrict access)의 정확한 UI/의미론** — 플래그인가, ACL 스냅샷인가? | 오버라이드 구현 방식 전체가 여기서 결정된다. 헬프센터에 명시적 '상속 끊기' 토글이 **문서화되어 있지 않음을 확인**했고, 확인된 것은 "하위에서 재정의 가능" + "Private 이동 override는 부모에만 적용" 두 가지뿐 | 실제 Notion 하위 페이지 Share 패널 조작 관찰 |
| 2 | **공개 페이지를 Private으로 이동 시 `public_link`가 유지되는가** | **정보 유출 직결.** 데이터 모델상 유지가 자연스러우나(노드 로컬) 원문 미확인. 유지된다면 이동 다이얼로그에 공개 상태 경고가 P0 | 2계정 실험 |
| 3 | **정책 변경 시 기존 공개 링크·게스트 접근의 즉시 무효화 여부** | 보안 사고 대응 설계가 갈린다. 클론 권장은 "행 삭제 없이 런타임 게이트 무효화"이나 노션 실동작 확인 필요 | Enterprise 실험 |
| 4 | **접근 불가 row가 롤업/카운트/집계에 포함되는가** | 포함되면 정보 누출. DB 도메인의 모든 집계 쿼리에 ACL 필터를 강제할지가 결정됨 | Business 플랜 실험 |
| 5 | **Custom Agent 소유자의 권한 축소 시 에이전트 시야가 함께 축소되는가** | 유령 권한(orphan capability) 방지 설계. 축소되지 않는다면 부분집합 재계산 배치가 필수 | Business+ 실험 |

**차순위(참고)**: 게스트 한도 수치(무료 10명만 확인) / 중첩 그룹 지원 여부 / 멤버 제거 시 그의 private 페이지 처리(admin이 콘텐츠 권한을 안 가지므로 **실제로 고아 발생**) / `Lock page`가 이동·삭제까지 막는지 / teamspace member 기본 접근 레벨 UI / 권한 변경 실시간 전파 지연.

---

## 7. 원본에서 확정된 사실 스니펫 (마스터가 재조사하지 않아도 되는 것)

- 게스트: 그룹에 포함 **불가**. SSO/SCIM 관리 대상 **아님**. 무료 플랜 10명. 한도 초과 시 허용 도메인 이메일이면 **멤버로만** 추가.
- teamspace visibility = **Open/Closed/Private 3값**, `Make default teamspace`는 **직교 BOOL**. teamspace는 삭제 불가, **archive만**.
- notion.site 도메인: 무료 1개 / 유료 최대 5개. 커스텀 도메인 최대 25개(도메인당 애드온 $10/월). 게시 사이트 수는 무제한. 슬러그 최대 60자, **하위에 상속 안 됨**, 홈페이지는 슬러그 불가. 인덱싱 반영 최대 4주.
- 웹 게시 시 **하위 페이지가 기본 함께 게시**된다. unpublish와 링크 비공개는 **별개 조작**.
- 공개 페이지도 **comment/edit 레벨 부여 가능**(단 댓글·편집에는 Notion 로그인 필요, 열람만 익명). 링크 만료는 **유료 기능**(2022-10-12 릴리스).
- Lock: **보안 경계 아님** — edit 이상이면 누구나 해제. **소유자에게도 적용**(주체별 예외 없는 노드 플래그). `Lock database`는 **구조만** 잠그고 행·값 편집은 허용. 상속 안 됨 `[추정]`.
- 접근 요청은 `No access` 화면에서 전송 → **페이지 creator/editor의 Inbox**에서 승인/무시. **ignore가 정식 결말**(만료 없는 pending 누적 전제). 정책 토글 6종.
- Form: 공개(웹) form은 **익명 강제** → `created_by` 없음 → `Access to submission` 부여 불가. 그래서 워크스페이스 한정 + 실명일 때만 노출.

**1차 출처(38개 중 핵심 10)**: help/sharing-and-permissions · help/whos-who-in-a-workspace · help/intro-to-teamspaces · help/organization-level-controls · help/workspace-settings · help/public-pages-and-web-publishing · help/notion-sites-availability-and-pricing · help/forms · help/custom-agents-sharing-and-permissions · developers.notion.com/reference/errors
