# 06. 권한 · 공유 · 퍼블리싱

> 조사 기준일: 2026-09-06 / 1차 출처: notion.com/help, developers.notion.com / 클론 참고: Outline, Docmost, AppFlowy, Permify 모델링 글
> 태그 규칙: `[추정]` = 공개 문서로 확인 불가, 동작에서 역산한 추론 / `[확인필요]` = 실제 제품에서 검증 필요
> **개정 이력 (2026-09-06 GAP 검토)**: 기능 14 → **20개**. 주요 정정 5건(워크스페이스 admin의 콘텐츠 접근, teamspace visibility 모델, notion.site 도메인 개수, 공개 페이지의 댓글/편집 가능 여부, 보안 설정 실제 항목명), `[확인필요]` 해소 5건(커스텀 도메인 25개, API 403/404 구분, 접근 요청 플로우, 게스트의 그룹 포함 불가, 링크 만료 플랜). 상세는 문서 말미 「정정 이력」 참조.

## 요약

- Notion의 모든 접근 제어는 **하나의 트리(workspace → teamspace → page → subpage)** 위에서 계산된다. 권한은 노드에 붙고, 자식은 기본적으로 부모의 권한을 상속한다.
- 권한 부여 주체(principal)는 6종이다: 개별 user, group, teamspace 멤버십, workspace 전체(everyone), 익명 웹 방문자(public link), integration(연결). Custom Agent는 **자기 자신의 권한을 가진 별도 principal**로 추가된다(F-06-18).
- 유효 권한은 **여러 출처에서 온 권한 중 가장 넓은 것(broadest wins)** 으로 결정된다. 이것이 Notion 권한 모델의 핵심 규칙이며, 문서에 명시되어 있다: "Notion respects the broadest level of access given to a user." (https://www.notion.com/help/sharing-and-permissions)
- **중요 정정**: 워크스페이스 admin 역할은 콘텐츠 접근 권한이 아니다. 공식 문서는 "Admin roles don't change what someone can see or edit in pages or databases"라고 명시한다. 관리자가 남의 페이지를 보는 경로는 ACL이 아니라 **별도의 관리자 도구(Enterprise Content Search / 데이터 접근 정책)** 다. (https://www.notion.com/help/organization-level-controls , https://www.notion.com/help/data-accessible-by-your-workspace-owner)
- 공유는 3층 구조다: ① 내부 초대(멤버/게스트/그룹), ② 링크 공유(워크스페이스 전체 / 웹 링크 + 만료), ③ 웹 게시(Notion Sites — 커스텀 도메인, SEO 인덱싱, 템플릿 복제 허용).
- 엔터프라이즈 계층은 권한 자체가 아니라 **권한을 제한하는 정책 계층**(퍼블리싱 금지, 게스트 금지, 내보내기 금지, SAML SSO, SCIM, 감사 로그)으로 얹힌다.
- workspace 위에 **organization(조직)** 계층이 하나 더 있다(Enterprise). 조직 owner는 여러 workspace를 가로질러 멤버·보안 설정·감사 로그·Content Search를 통제한다. 보안 설정은 조직 단위로 `Workspace managed / Enabled for everyone / Disabled for everyone` 3상태로 내려꽂힌다. (https://www.notion.com/help/organization-level-controls)
- 권한 외에 **콘텐츠 동결 장치**로 `Lock page` / `Lock database`가 별도 존재한다. ACL이 아니라 노드에 붙는 플래그이며 edit 이상 권한자면 누구나 해제할 수 있어 보안 경계가 아니다(F-06-16).

---

## 핵심 개념 / 데이터 모델

### 엔티티 개요

| 엔티티 | 역할 | 비고 |
|---|---|---|
| `user` | 인증 주체 | 게스트도 자신의 Notion 계정 필요 (help/sharing-and-permissions) |
| `organization` | (Enterprise) 여러 workspace를 묶는 최상위 관리 경계 | org owner, 조직 단위 보안 정책·감사·Content Search |
| `workspace` | 과금·정책·도메인의 단위 | organization에 소속될 수 있음 |
| `workspace_member` | user ↔ workspace 역할 연결 | role: owner / membership_admin / member / **restricted_member** / guest (+ temporary member 플래그) |
| `group` | user 묶음. 권한 부여 대상 | workspace 스코프 |
| `teamspace` | workspace 하위 컨테이너. 사이드바 최상위 섹션 | visibility: default/open/closed/private |
| `teamspace_member` | user·group ↔ teamspace | role: owner / member |
| `block` | 페이지 = block. 트리의 노드 | `parent_id`로 트리 구성 (도메인 01 참조) |
| `acl_entry` | 특정 노드에 대한 특정 principal의 권한 | 권한의 유일한 저장 지점 |
| `public_link` | 노드의 웹 공개 상태 | 만료, 권한 레벨, 게시 설정 |
| `site` | 게시된 사이트(도메인/슬러그/SEO) | public_link의 상위 개념 |
| `page_access_rule` | DB row 권한을 property 값으로 유도 | Business+ |
| `security_policy` | workspace 단위 금지 정책 | 퍼블리시/게스트/익스포트/복제 |
| `node_lock` | 노드의 편집 동결 플래그 | page lock / database lock (F-06-16) |
| `access_request` | 접근·승격 요청 | page access / edit access / member 승격 / guest 초대 (F-06-15) |
| `form` | DB에 붙는 공개 제출 엔드포인트 | 익명 응답, 응답자 사후 접근 레벨 (F-06-17) |
| `agent` | 자체 권한을 가진 AI 주체 | 공유 시 "에이전트가 보는 것 전부"가 함께 넘어감 (F-06-18) |

### 의사 스키마

```sql
-- 주체
user(id, email, name, avatar_url, created_at)
organization(id, name, verified_domains[], created_at)            -- Enterprise 전용 계층
organization_member(org_id, user_id, role ENUM('org_owner','member'))
workspace(id, org_id NULL, name, icon, plan, allowed_email_domains[], created_at)
workspace_member(workspace_id, user_id,
                 role ENUM('owner','membership_admin','member','restricted_member','guest'),
                 is_temporary BOOL DEFAULT FALSE,   -- Marketplace 컨설턴트, 좌석 미소비
                 status ENUM('active','invited','suspended'), joined_at, expires_at NULL)
  PRIMARY KEY (workspace_id, user_id)
group(id, workspace_id, name, icon)
group_member(group_id, user_id)

-- 컨테이너
-- 정정: visibility는 3값이고 'default'는 별개의 BOOL 플래그다 (공식 문서 기준)
teamspace(id, workspace_id, name, icon,
          visibility ENUM('open','closed','private'),
          is_default BOOL DEFAULT FALSE,            -- 전 멤버 자동 가입 (기존/신규 모두)
          who_can_invite ENUM('owners','all_members') DEFAULT 'all_members', -- closed/private 전용
          default_member_access ENUM('full_access','edit','comment','view'), -- [추정] UI상 명시 값 미확인
          archived_at NULL)
teamspace_member(teamspace_id, principal_type ENUM('user','group'), principal_id,
                 role ENUM('owner','member'))

-- 트리 노드 (도메인 01의 block과 동일 테이블)
block(id, workspace_id, parent_type ENUM('workspace','teamspace','block','database'),
      parent_id, type, is_private_root BOOL, deleted_at NULL)

-- 권한의 유일한 저장 지점 (명시적 부여만 저장. 상속은 저장하지 않음)
acl_entry(
  id,
  node_id,                       -- block.id (또는 teamspace.id)
  node_kind ENUM('block','teamspace'),
  principal_type ENUM('user','group','teamspace','workspace_everyone','public'),
  principal_id NULL,             -- workspace_everyone/public일 때 NULL
  level ENUM('none','view','comment','edit_content','create','edit','full_access'),
  granted_by, granted_at,
  UNIQUE (node_id, principal_type, principal_id)
)

-- 상속 차단 플래그: 이 노드에서 부모 상속을 끊는다
block_acl_meta(node_id PK, inherits_from_parent BOOL DEFAULT TRUE, updated_at)

-- 퍼블릭 공유
public_link(node_id PK, enabled BOOL, level ENUM('view','comment','edit'),
            expires_at NULL, token, created_by, created_at)
site(id, workspace_id, root_node_id, domain_type ENUM('notion_site','custom'),
     host, slug, indexable BOOL, allow_duplicate_as_template BOOL,
     theme ENUM('light','dark','auto'), show_breadcrumb BOOL, favicon_url,
     og_title, og_description, og_image_url, analytics_id NULL)

-- DB row 권한 규칙
page_access_rule(id, database_id, source_property_id,
                 source_kind ENUM('person_property','created_by'),
                 level ENUM('view','comment','edit','full_access'))

-- 잠금 / 요청 / 폼 / 에이전트
node_lock(node_id PK, kind ENUM('page','database'), locked BOOL, locked_by, locked_at)
access_request(id, workspace_id, kind ENUM('page_access','edit_access','join_workspace',
                                           'add_member','add_guest'),
               node_id NULL, requester_id NULL, requester_email NULL, requested_level NULL,
               message, status ENUM('pending','approved','denied','ignored'),
               decided_by, decided_at, created_at)
form(id, database_id, node_id, audience ENUM('no_access','workspace_link','public_link'),
     anonymous BOOL, submitter_access ENUM('none','view','comment','edit','full_access'),
     published_host NULL, slug NULL)
agent(id, workspace_id, owner_user_id, name, instructions,
      acts_as ENUM('own_identity'),                 -- 실행자 권한이 아니라 에이전트 자체 권한
      created_at)
agent_share(agent_id, principal_type, principal_id,
            level ENUM('view_interact','edit','full_access'))

-- 정책 / 엔터프라이즈
security_policy(workspace_id PK,
                allow_publish_sites_and_forms,      -- "Disable publishing sites, forms and public links"
                allow_duplicate_to_other_workspace, -- "Disable duplicating pages to other workspaces"
                allow_export,
                allow_member_invite_guests,
                allow_member_request_add_guests,
                allow_member_request_add_members,
                allow_nonmember_page_access_request,
                allow_guest_request_membership,
                who_can_add_restricted_members ENUM('owners','all_members'),
                require_sso)
-- 조직 단위 오버라이드: 각 정책은 3상태로 하위 workspace에 전파된다
org_security_policy(org_id, policy_key,
                    mode ENUM('workspace_managed','enabled_for_everyone','disabled_for_everyone'))
sso_config(workspace_id PK, idp_metadata_url, entity_id, x509_cert,
           jit_provisioning BOOL, enforced BOOL)
scim_token(workspace_id, token_hash, created_at, last_used_at)
audit_log(id, workspace_id, actor_user_id, action, target_type, target_id, ip, at)
```

### 유효 권한 계산 규칙 (본 도메인의 중심 알고리즘)

```
-- 0단계: 정책 게이트 (유일한 deny 계층. ACL보다 먼저 평가된다)
if not policy_allows(workspace(N), action) -> DENY

-- 1단계: grant 합집합의 최댓값
effective(user U, node N) =
  MAX_LEVEL over all of:
    1. acl_entry on N  : principal ∈ {U, U의 group들, U가 속한 teamspace,
                                      workspace_everyone, U가 쓰는 integration}
    2. inherited       : block_acl_meta(N).inherits_from_parent == TRUE 이면
                         effective(U, parent(N)) 를 후보에 포함 (재귀)
    3. teamspace 기본  : N이 teamspace 하위이고 U가 그 teamspace 멤버이면
                         teamspace 설정이 부여한 레벨.
                         teamspace **owner**는 기본적으로 그 teamspace 전 페이지에 full access
                         ("Owners will have full access to all pages within the teamspace by default")
    4. page_access_rule: N이 DB row이고 U가 규칙의 property 값에 포함되면 rule.level
    5. public_link     : U가 익명이거나 미초대 사용자여도 public_link.enabled이면 그 level
    6. form 응답자     : U가 그 row의 제출자이면 form.submitter_access
  → 값이 하나도 없으면 'none'

-- 2단계: 잠금 게이트 (F-06-16)
if node_lock(N).locked and action ∈ {edit_content|edit_structure} -> BLOCK(해제 전까지)

-- 별도 경로(ACL 아님): 관리자 거버넌스
--   Enterprise org owner는 Content Search로 페이지를 조회할 수 있으나
--   이는 admin 도구이지 effective()의 항이 아니다.
```

> **정정 이력**: 이전 버전은 1번 항에 "workspace owner → 전 노드 full_access"를 두었다. 공식 문서는
> "Admin roles don't change what someone can see or edit in pages or databases"라고 명시하므로 **삭제했다**.
> Enterprise에서 워크스페이스 owner가 private 페이지를 포함한 데이터에 "접근할 수 있다"는 것은 사실이나
> ("the workspace owner could have access to the data you store in that Notion workspace, including any
> private pages"), 그 경로는 admin 도구·데이터 접근 정책이지 페이지 ACL이 아니다. 클론에서도 이 둘을
> **다른 코드 경로**로 분리해야 감사 로그가 의미를 갖는다.
> (https://www.notion.com/help/organization-level-controls , https://www.notion.com/help/data-accessible-by-your-workspace-owner)

- **broadest wins**: "누군가 두 개의 서로 다른 액세스 레벨을 가지면 더 높은 액세스가 적용된다"가 공식 문서에 명시됨. 즉 deny 우선이 아니라 **grant 합집합 + 최댓값**이다. (https://www.notion.com/help/sharing-and-permissions, https://www.notion.com/help/guides/assign-custom-database-permissions)
- 따라서 "특정 사람만 하위 페이지에서 제외"는 ACL에 deny를 넣는 방식이 아니라 **상속을 끊고(`inherits_from_parent = FALSE`) 새 ACL을 다시 구성**하는 방식이어야 한다. `[추정]` — Notion UI에 상속 차단에 해당하는 조작이 존재하는 것은 웹 게시 문서의 "하위 페이지 권한을 제한해 공개 뷰에서 숨길 수 있다" 서술로 뒷받침되나, 내부 표현이 플래그인지 별도 ACL 스냅샷인지는 비공개다.
- 레벨은 **완전한 전순서가 아니다**. `can create`는 "새 페이지 생성은 가능하지만 기존 페이지는 개별 부여 전까지 볼 수 없음"이라 `can view`보다 크다고 단정할 수 없다. 구현 시 `level`을 단일 정수 서열로 두면 이 케이스가 깨진다 → **capability 비트마스크 + 표시용 레벨명** 조합을 권장.

### 권장 내부 표현: capability 비트

| capability | view | comment | edit_content | create_child | edit_structure | share | manage_perm |
|---|---|---|---|---|---|---|---|
| Full access | O | O | O | O | O | O | O |
| Can edit | O | O | O | O | O | X | X |
| Can edit content (DB) | O | O | O | O | X | X | X |
| Can create (DB) | X* | X | X* | O | X | X | X |
| Can comment | O | O | X | X | X | X | X |
| Can view | O | X | X | X | X | X | X |
| No access | X | X | X | X | X | X | X |

\* `can create`는 자기가 만든 row에 대해서만 view/edit가 성립하도록 `created_by → can edit` 규칙과 함께 쓰는 것이 문서 권고. 공식 정의: "People with this level of access can create new pages within the database, but can't view or edit existing pages they haven't been individually granted access to." (https://www.notion.com/help/sharing-and-permissions)

**레벨의 다형성 주의**: 같은 이름의 레벨이 대상에 따라 다른 capability 집합을 갖는다. 클론에서는 `(subject_kind, level) → capability_bits` 2차원 매핑으로 두어야 한다.

| 대상 | 레벨 집합 | 출처 |
|---|---|---|
| page / database | full access, can edit, can edit content*, can create*, can comment, can view (*DB 전용) | help/sharing-and-permissions |
| teamspace 멤버십 | owner / member | help/intro-to-teamspaces |
| form 응답자 사후 접근 | no access / can view / can comment / can edit / full access | help/forms |
| custom agent | can view and interact / can edit / full access | help/custom-agents-sharing-and-permissions |
| integration capability | read/update/insert content, read/insert comments, user info 3단계 | developers.notion.com/reference/capabilities |

---

## 기능 명세

### F-06-01 액세스 레벨(권한 레벨) 체계

- **한 줄 정의**: 하나의 페이지/데이터베이스에 대해 특정 주체가 무엇을 할 수 있는지를 6단계(+없음)로 규정한다.
- **사용자 시나리오**:
  1. 페이지 우측 상단 `Share` 클릭 → 공유 패널 열림
  2. 사람/그룹 행 오른쪽의 레벨 드롭다운 클릭
  3. `Full access / Can edit / Can edit content / Can create / Can comment / Can view / Remove` 중 선택
  4. 선택 즉시 저장(별도 저장 버튼 없음) `[추정]`, 대상 사용자의 열린 세션에도 반영
- **동작 상세**:

  | 레벨 | 콘텐츠 편집 | DB 구조(속성/뷰/필터) 편집 | 댓글 | 공유·권한 변경 | 적용 대상 |
  |---|---|---|---|---|---|
  | Full access | O | O | O | O | 모든 노드 |
  | Can edit | O | O | O | X | 모든 노드 |
  | Can edit content | O (row 생성/편집, property 값 편집) | X | O | X | 데이터베이스 전용 |
  | Can create | 신규 row 생성만 | X | X | X | 데이터베이스 전용, Business/Enterprise |
  | Can comment | X | X | O | X | 모든 노드 |
  | Can view | X | X | X | X | 모든 노드 |

  - 기본값: 새 페이지는 부모의 권한을 상속. private 섹션에서 만든 페이지는 생성자 full access 단독.
  - `Can create` 보유자는 기존 row를 볼 수 없다(개별 부여 전까지). 문서상 `Created by → Can edit` 규칙과 페어링 권장.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 같은 사용자가 group=view, 개인=edit | edit (broadest wins) |
  | Full access 보유자가 자기 자신을 제거 | 마지막 full access 주체 제거는 차단해야 함. **정정**: "owner가 항상 남는다"는 이전 서술은 틀렸다 — admin 역할은 콘텐츠 접근을 주지 않으므로(`Admin roles don't change what someone can see or edit`) 고아 페이지가 실제로 발생할 수 있다. 클론에서는 ① 마지막 full access 제거 차단, ② 관리자용 소유권 강제 이관 도구, 둘 중 하나를 반드시 구현해야 한다 |
  | 권한 없는 사용자가 URL 직접 접근 | 접근 요청 화면 (F-06-06 참조) |
  | comment 권한자가 편집 API 호출 | 서버에서 403, 클라이언트는 read-only 렌더 |
  | 편집 중 권한이 view로 강등 | 진행 중 세션은 실시간으로 read-only 전환, 미전송 로컬 변경은 폐기 `[추정]` |
  | 삭제(휴지통)된 페이지 | 권한 유지, 복원 시 그대로 적용 `[추정]` |
  | 빈 ACL(아무도 부여 안 됨) | **아무도 접근 불가**(생성자마저 제거된 경우). 관리자 복구 경로는 ACL이 아니라 별도 admin 도구(Content Search / 소유권 이관)로 뚫어야 한다 |
  | 잠긴 페이지(F-06-16)에서 edit 권한자 | 권한은 있으나 잠금 게이트에서 차단 → 권한 검사와 잠금 검사를 분리 |
  | 동일 노드에 user=edit, public_link=view | broadest wins로 로그인 사용자는 edit. 익명 방문자는 view. 즉 **주체 종류별로 계산 결과가 갈린다** |
  | 대용량: 1개 노드에 5,000개 ACL 항목 | Share 패널을 페이지네이션하고, 판정은 principal 집합 IN 절로 O(1) 조회 |
- **데이터 모델 함의**: `acl_entry(node_id, principal_type, principal_id, level)` + `level → capability_bits` 매핑 테이블. `level`을 단일 정수 서열로만 두면 `can create` 케이스가 깨지므로 매핑 함수를 단일 소스로 유지.
- **UI/인터랙션**: `Share` 버튼(전용 단축키 `[확인필요]`), 레벨 드롭다운, 행 hover 시 제거 아이콘, 상속된 권한은 비활성 표시 `[추정]`. 현재 자기 권한 레벨은 Share 탭에 표시되며 그 드롭다운에서 `Request edit access`를 누를 수 있다(문서 확인, F-06-15).
- **의존 기능**: 인증(user), block 트리, workspace_member.
- **구현 난이도**: **M** — 레벨 정의는 단순하나 capability 가드를 모든 읽기/쓰기 엔드포인트에 삽입해야 해 작업이 넓게 퍼진다.
- **우선순위**: **P0** — 3레벨(view/comment/edit)만이라도 없으면 공유가 성립하지 않는다.
- **클론 시 현실적 대안**: MVP는 `full_access / edit / comment / view` 4단계만. DB 전용 2단계(`edit_content`, `create`)는 v2. Docmost도 space 단위 3단계(admin/editor/viewer)로 출발했다.
- **참고 출처**: https://www.notion.com/help/sharing-and-permissions (6레벨 정의 원문) , https://www.notion.com/help/guides/sharing-and-permissions , https://www.notion.com/help/organization-level-controls (admin 역할 ≠ 콘텐츠 접근)

---

### F-06-02 워크스페이스 역할 (owner / membership admin / member / guest)

- **한 줄 정의**: 사용자가 워크스페이스 전체에 대해 갖는 신분을 4종으로 나누어 설정 접근·과금 좌석·기본 콘텐츠 범위를 결정한다.
- **사용자 시나리오**:
  1. Owner가 `Settings → People → Add members`
  2. 이메일 입력 또는 초대 링크 복사 → 역할 선택(Member/Owner)
  3. 초대 대상이 링크 수락 → `workspace_member.status`가 invited → active
  4. 기존 게스트를 Members 목록에서 멤버로 승격 가능
- **동작 상세**:

  | 역할 | 워크스페이스 설정 | 멤버 추가/제거 | 콘텐츠 기본 접근 | teamspace 생성 | 유료 좌석 | 플랜 |
  |---|---|---|---|---|---|---|
  | Organization owner | O (조직 전체 workspace) | O (조직 전역, 중복 제거된 단일 목록) | **없음**(admin 역할은 콘텐츠 접근을 주지 않음) | O | 소비 | Enterprise(다중 워크스페이스) |
  | Workspace owner | O (워크스페이스 삭제 포함) | O | **없음**(별도 admin 도구로만) | O | 소비 | 전 플랜 |
  | Membership admin | X | O (workspace·group 멤버십만) | 없음 | `[확인필요]` | 소비 | Enterprise |
  | Member | X | X | 소속 teamspace + 공유받은 페이지 | O | 소비 | 전 플랜 |
  | **Restricted member** | X | X | **명시 부여된 teamspace/페이지만**. 같은 teamspace/페이지에 있는 사람에게만 공유 가능, 미공유 멤버 @멘션 불가, Connect·Agents 사용 불가 | **X** | 소비(멤버와 동일 과금) | `[확인필요]` (플랜 미명시) |
  | Guest | X | X | 개별 공유된 페이지와 그 하위만. 그룹에 넣을 수 없음 | X | 미소비(별도 게스트 한도) | 전 플랜 |
  | Temporary member | X | X | 멤버와 동일 | O `[추정]` | **미소비** | Marketplace 컨설턴트 전용, 최대 1년 |

  - **가장 중요한 정정**: "owner니까 다 볼 수 있다"는 모델은 틀렸다. `Admin roles don't change what someone can see or edit in pages or databases.` 클론에서는 admin 권한(설정·멤버)과 콘텐츠 권한(ACL)을 **별도 축**으로 설계해야 한다.
  - `restricted_member`는 "기본 접근이 0인 멤버"다. 즉 role은 좌석·과금·기능 게이트를 결정하고, 콘텐츠 접근은 전적으로 ACL이 결정한다 — role을 콘텐츠 권한의 원천으로 쓰지 말라는 신호.

  - Guest는 워크스페이스가 아니라 **페이지에 속한다**. 사이드바에 공유받은 페이지만 표시된다.
  - Marketplace 컨설턴트용 **temporary member**: 최대 1년 기한, 유료 좌석 미소비 → `workspace_member.expires_at` 필드 필요.
  - 도메인 자동 가입: `allowed_email_domains`에 해당하는 이메일로 가입 시 온보딩에서 해당 워크스페이스 참여 옵션이 노출된다.
  - 초대 방식 3종: 이메일 초대 / 비밀 초대 링크 / 허용 도메인 자동 가입.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 마지막 owner 제거·탈퇴 | 차단 (워크스페이스 고아화 방지) `[추정]` — 공식 문서는 "Every workspace has at least one owner"라고만 서술 |
  | restricted member가 teamspace 생성 시도 | 차단(문서 명시: "They can't create teamspaces") |
  | restricted member가 미공유 멤버를 @멘션 | 자동완성에서 제외 + 서버 검증 (문서 명시) |
  | 멤버 → restricted member 강등 | 기존 명시 ACL은 유지되나 teamspace 자동 접근이 끊김 → 강등 전 영향 페이지 수 프리뷰 필요 `[추정]` |
  | 조직에서 같은 사람이 여러 workspace에 존재 | 조직 People 탭은 "deduped in one view" → `organization_member`를 user 기준 유니크로 두고 workspace_member를 N개 연결 |
  | 게스트 한도 초과 상태에서 외부인 공유 | 허용 도메인 이메일이면 게스트 대신 **member로만** 추가 가능 (문서 명시) |
  | 멤버 제거 | 그가 만든 팀 페이지는 잔존. private 페이지 이관/삭제 정책 필요 `[확인필요]` |
  | 게스트 → 멤버 승격 | 기존 게스트 ACL 유지 + 워크스페이스 범위 접근 추가 |
  | temporary member 만료 | 자동 비활성화, 콘텐츠 보존 |
  | 초대 링크 유출 | 링크 재생성(rotate) 기능 필요 |
- **데이터 모델 함의**: `workspace_member(workspace_id, user_id, role ENUM(owner|membership_admin|member|restricted_member|guest), is_temporary, status, expires_at)`, `workspace.allowed_email_domains[]`, `workspace_invite(token, workspace_id, role, email NULL, expires_at, max_uses, revoked_at)`, `organization / organization_member(role='org_owner')`. **role은 admin capability와 좌석만 결정하고 콘텐츠 접근은 acl_entry가 단독으로 결정**하도록 두 축을 분리한다. 좌석 계산: `seat_count = count(role IN (owner,membership_admin,member,restricted_member) AND NOT is_temporary)`.
- **UI/인터랙션**: Settings → People. 역할 드롭다운, 검색, 다중 선택 후 일괄 제거, 초대 링크 복사/재생성.
- **의존 기능**: 인증/계정. 좌석 과금은 분리 가능(P2).
- **구현 난이도**: **M~L** — 역할 자체는 단순하나 게스트/restricted member의 "워크스페이스 미소속·기본 접근 0" 특성이 사이드바·검색·멘션·자동완성·공유 자동완성 전 영역에 예외를 만든다. 여기에 좌석 과금 연동(temporary는 미소비)이 붙으면 L에 가깝다.
- **우선순위**: **P0** (owner/member/guest) / restricted member·membership admin·organization은 **P2**.
- **클론 시 현실적 대안**: MVP는 `owner / member / guest` 3종. membership admin은 Enterprise 판매 분리를 위한 역할이라 클론에서 가치가 낮다. Docmost도 Owner/Admin/Member 3종이다.
- **참고 출처**: https://www.notion.com/help/add-members-admins-guests-and-groups , https://www.notion.com/help/whos-who-in-a-workspace (restricted member / temporary member / organization owner 정의 원문) , https://www.notion.com/help/organization-level-controls

---

### F-06-03 그룹(Group) 기반 권한 부여

- **한 줄 정의**: 사용자를 묶은 group을 ACL의 principal로 사용해 개인별 부여 없이 접근을 일괄 제어한다.
- **사용자 시나리오**:
  1. Owner가 `Settings → People → Groups → New group`, 이름 입력
  2. 멤버 검색해 추가
  3. 페이지 `Share`에서 그룹명 입력 → 레벨 선택
  4. 이후 그룹에 사람을 추가하면 그 사람이 즉시 모든 그룹 부여 페이지에 접근
- **동작 상세**:
  - group은 workspace 스코프이며 teamspace 멤버로도, 페이지 ACL principal로도 쓰인다.
  - 한 사람이 여러 그룹에 속하면 `broadest wins`로 병합된다.
  - SCIM 연동 시 IdP 그룹 → Notion 그룹 동기화(F-06-12).
  - 그룹 생성·편집 권한: **workspace owner와 membership admin만**("Workspace owners and membership admins can create and edit groups"). Enterprise는 이를 더 조일 수 있다.
  - **게스트는 그룹에 들어갈 수 없다** — `[확인필요]` 해소: "Only workspace members can be assigned to groups. Groups can't contain workspace guests." (https://www.notion.com/help/create-and-manage-groups)
  - `[확인필요]` 중첩 그룹(그룹 안의 그룹)은 공식 그룹 문서에 언급이 없다 — 미지원으로 보이나 명시적 부정 문장은 찾지 못했다. 클론에서는 **중첩 금지 권장** — 권한 계산 순환과 비용 폭증을 막는다. 굳이 지원한다면 그룹 그래프에 사이클 검사 + 전개 결과를 `group_closure(group_id, member_user_id)`로 머티리얼라이즈해야 한다.
  - 그룹에 부여한 권한은 하위로 상속된다(공식): These permissions apply to all sub-pages beneath that page.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 그룹 삭제 | 해당 group principal의 ACL 전부 캐스케이드 삭제, 개인 직접 부여는 유지 |
  | 그룹에서 사람 제거 | 그 그룹으로만 접근하던 페이지 즉시 차단, 열린 세션 강제 갱신 `[추정]` |
  | 빈 그룹에 권한 부여 | 허용. 이후 멤버 추가 시 소급 적용 |
  | 게스트를 그룹에 포함 | **불가**(문서 명시). UI 자동완성에서 게스트를 제외하고 서버에서도 거부 |
  | 그룹 멤버가 restricted member | 허용(문서 명시: restricted member는 "be added to permission groups" 가능) → 그룹이 restricted member의 유일한 대량 부여 수단 |
  | 순환 그룹(중첩 지원 시 A⊂B⊂A) | 중첩 미지원으로 원천 차단. 지원한다면 삽입 시 DFS 사이클 검사 |
  | 그룹 삭제 중 동시에 그 그룹으로 편집 중인 세션 | 권한 무효화 이벤트 브로드캐스트 → read-only 전환(F-06-14) |
  | 수천 명 규모 그룹 | 사용자 기준 역인덱스(`user → group_ids`)를 세션 로드시 1회 캐싱 |
  | 동명 그룹 생성 | 워크스페이스 내 이름 unique 제약 권장 |
- **데이터 모델 함의**: `group`, `group_member`, `acl_entry.principal_type='group'`. 권한 계산 진입 시 `user_group_ids` 배열을 준비해 IN 절로 1회 조회.
- **UI/인터랙션**: Settings → Groups 관리 화면. Share 자동완성에서 그룹은 아이콘으로 구분, 호버 시 멤버 수 표시 `[추정]`.
- **의존 기능**: F-06-02.
- **구현 난이도**: **M** — 스키마·조회는 단순하나(중첩 금지 전제), 그룹 멤버십 변경 1건이 **그 그룹이 부여된 모든 서브트리의 권한 캐시를 무효화**하므로 F-06-14와 강하게 결합한다. 중첩을 허용하는 순간 L로 올라간다.
- **우선순위**: **P1** — 5명 규모 MVP엔 불필요, 조직 규모에서는 필수.
- **클론 시 현실적 대안**: MVP는 생략하고 teamspace 멤버십으로 대체. Outline은 group을 collection 권한 주체로 쓰며 "그룹과 개인 양쪽에 속하면 더 강한 권한 우선"이라는 동일 규칙을 명시한다.
- **참고 출처**: https://www.notion.com/help/create-and-manage-groups (게스트 제외·생성 권한 원문) , https://www.notion.com/help/add-members-admins-guests-and-groups , https://docs.getoutline.com/s/guide/doc/users-groups-cwCxXP8R3V

---

### F-06-04 Teamspace와 teamspace 가시성 (default / open / closed / private)

- **한 줄 정의**: 워크스페이스 하위 콘텐츠 컨테이너로, 소속 멤버 집합과 "누가 이 공간의 존재를 알고 참여할 수 있는가"를 4가지 모드로 규정한다.
- **사용자 시나리오**:
  1. 사이드바 `Teamspaces → +` (워크스페이스 설정에 따라 owner만 가능하도록 제한될 수 있음)
  2. 이름/아이콘 입력 → 권한 모드 선택(Default/Open/Closed/Private)
  3. 멤버·그룹 추가, 각자 owner 또는 member 지정
  4. 페이지를 teamspace로 드래그하면 즉시 teamspace 권한이 적용됨
- **동작 상세**:

  **정정**: visibility는 **3값(Open / Closed / Private)** 이고, `Default`는 visibility가 아니라 **직교하는 BOOL 플래그**(`Make default teamspace`)다. 초판이 4값 ENUM으로 모델링한 것은 오류였다.

  | visibility | 존재 노출 | 자유 참여 | 콘텐츠 열람 | 플랜 | 공식 문구 |
  |---|---|---|---|---|---|
  | Open | 보임(teamspace 브라우저에 노출) | O | O | 전 플랜 | "Anyone can join and view the content inside this teamspace." |
  | Closed | 보임 | X (owner 또는 member의 초대 필요) | X | 전 플랜 | "Everyone can see that this teamspace exists, but can't join unless they're invited by an owner or member." |
  | Private | **안 보임** | X | X | Business / Enterprise | "Only members or owners of this teamspace can invite other people, and it won't be visible to people who are not added." |

  | 직교 플래그 | 의미 |
  |---|---|
  | `is_default` | 켜면 **기존 멤버 전원이 즉시 추가되고, 이후 가입자도 자동 추가**된다. 공식 권고: 기본 teamspace는 1개, 대규모라도 3개 이하 |
  | `who_can_invite` (closed/private 전용) | "all members" 또는 "owners only" — 초대 주체를 좁힌다 |

  - Teamspace 역할: **owner** — "will have full access to all pages within the teamspace by default. They will also have access to teamspace settings." / **member** — "will receive access to pages within the teamspace as determined by teamspace owners. They will not have access to teamspace settings."
  - 즉 **teamspace owner는 그 teamspace 서브트리에 대해 실질적 full access를 갖는 ACL 원천**이다. 반면 workspace owner는 그렇지 않다(F-06-02 정정 참조). 이 비대칭이 Notion 권한 모델에서 가장 오해받는 지점이다.
  - `default_member_access`(teamspace member의 기본 레벨)를 UI에서 어떤 값으로 고르는지는 공식 문서에서 확인하지 못했다 `[확인필요]` — owner가 페이지별로 정한다는 서술만 있다.
  - Teamspace는 **삭제되지 않고 archive만 된다**. archive 시 모든 멤버의 사이드바에서 제거된다. 복원은 "workspace owner이면서 teamspace owner"인 사람만 `Settings → Teamspaces`에서 가능.
  - 기존 페이지를 teamspace로 변환하려면: 해당 페이지에 full access + 데이터베이스가 아닐 것 + owner 권한.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | Closed teamspace 페이지 링크를 비멤버가 열람 | 접근 불가 + 요청 플로우 |
  | Private teamspace 마지막 owner 탈퇴 | 워크스페이스 owner의 복구 경로 필요 `[확인필요]`. **admin 역할이 콘텐츠 접근을 주지 않으므로 이 케이스는 실제로 고아 teamspace를 만든다** — 클론은 "마지막 owner 이탈 차단" 또는 "workspace owner의 강제 owner 지정" 중 하나를 필수 구현 |
  | restricted member를 teamspace에 추가 | 가능(설정 `Who can add restricted members`로 주체 제한). 추가 전에는 이 사람에게 teamspace 자체가 존재하지 않는 것과 같음 |
  | `is_default` 를 켠 순간 멤버 5,000명 | 기존 전원 즉시 추가 → **동기 처리 금지**, 배치 삽입 + 권한 캐시 prefix 무효화(F-06-14) |
  | open teamspace를 나중에 closed/private로 변경 | 이미 자유 참여로 들어온 멤버 유지 여부 정책 필요 `[확인필요]`. 클론 권장: 기존 멤버 유지 + 신규 참여만 차단 |
  | 순환: teamspace 페이지를 다른 teamspace 하위로 이동 | teamspace는 트리의 루트 계층이므로 teamspace끼리 중첩 불가로 두면 순환이 원천 차단된다 `[추정]` |
  | Open teamspace에 게스트 초대 | 게스트는 teamspace 멤버가 될 수 없고 개별 페이지 ACL로만 |
  | 페이지를 teamspace A → B 이동 | 이전 teamspace 기반 접근 소멸, 개별 ACL은 유지 `[추정]`, 이동 전 경고 필요 |
  | archive된 teamspace의 페이지 | 검색·멘션 결과에서 제외 `[추정]` |
  | 플랜 다운그레이드로 private 불가 | 기존 private teamspace 처리 정책 필요 `[확인필요]` |
  | Default teamspace 삭제 시도 | 마지막 default는 archive 불가로 막아야 함 `[추정]` |
- **데이터 모델 함의**: `teamspace(visibility ENUM('open','closed','private'), is_default BOOL, who_can_invite, archived_at)`, `teamspace_member(principal_type ENUM('user','group'), principal_id, role ENUM('owner','member'))`. `block.parent_type='teamspace'`로 루트 페이지 연결. **권한 계산에서 teamspace를 트리의 한 노드로 취급하면 상속 로직이 block과 통일된다.** teamspace owner는 `acl_entry(node_kind='teamspace', principal=owner, level='full_access')`로 표현하면 별도 분기 없이 상속 계산에 자연히 흡수된다. `is_default=true` 전환은 이벤트로 큐에 넣어 비동기 fan-out.
- **UI/인터랙션**: 사이드바 섹션 헤더 + 접기, teamspace 브라우저(참여 가능 목록), 페이지 드래그로 소속 변경, `Settings → Teamspaces` 관리표.
- **의존 기능**: F-06-02, F-06-05, 사이드바 트리.
- **구현 난이도**: **L** — visibility 4종 × (사이드바 / 검색 / 멘션 / 공유 자동완성 / 브라우저) 노출 규칙이 전부 분기하고 archive·복원 경로가 추가된다.
- **우선순위**: **P1** — 개인 MVP는 workspace + private 2단계로 충분하나 팀 제품이 되려면 필수.
- **클론 시 현실적 대안**: `space` 하나로 단순화하고 visibility는 `open / closed` 2종만. Docmost의 Space, Outline의 Collection이 정확히 이 레이어에 대응한다. private teamspace는 v2.
- **참고 출처**: https://www.notion.com/help/intro-to-teamspaces (Open/Closed/Private 원문·owner 기본 full access·default teamspace) , https://www.notion.com/help/manage-teamspaces , https://www.notion.com/help/guides/grant-access-teamspaces , https://www.notion.com/help/browse-join-and-create-teamspaces

---

### F-06-05 페이지 권한 상속과 오버라이드 (유효 권한 계산)

- **한 줄 정의**: 하위 페이지는 상위 노드의 권한을 물려받고, 특정 노드에서 명시 부여를 추가하거나 상속을 끊어 예외를 만든다.
- **사용자 시나리오**:
  1. 팀 페이지 A(팀 전체 edit) 안에 하위 페이지 B 생성 → B는 자동으로 동일 권한
  2. B의 `Share`를 열면 상속된 주체가 회색으로 표시되고 상위에서 상속되었음이 안내됨 `[추정]`
  3. B에만 외부 게스트 1명 추가 → B와 B의 하위 트리에만 접근
  4. B를 소수만 보게 하려면 상속을 끊고 접근자를 재구성
- **동작 상세**:
  - 상속 원천: 가장 가까운 **명시 권한을 가진 조상**. Teamspace 최상위 페이지는 teamspace 설정에서 상속한다.
  - 결합 규칙: **여러 출처의 권한 중 최댓값 적용**(공식 문서 명시). deny 개념이 없다.
  - 공식 문구는 상속을 이렇게만 서술한다: "When you create a subpage inside of a page, that subpage will take on the permissions of its parent page. To change this, go into a subpage and update the permissions there."
  - **중요**: 헬프센터에는 `inherits_from_parent`에 해당하는 **명시적 '상속 끊기' 토글이 문서화되어 있지 않다** `[추정 — 초판보다 강한 유보]`. 확인 가능한 것은 두 가지뿐이다. ① 하위 페이지에서 권한을 바꿀 수 있다. ② 페이지를 사이드바 `Private` 섹션으로 옮기면 그 페이지의 타인 접근이 제거되며, "This override will only apply to the parent page — the permissions granted for any subpages will remain the same"(공식). 즉 **override는 노드 로컬이고 하위의 명시 부여는 살아남는다**. 따라서 내부 표현은 "상속 플래그"보다 **"노드에 override ACL 세트를 붙이고, 그 노드에서 상위 상속을 대체한다"** 모델이 관찰 사실과 더 잘 맞는다 `[추정]`.
  - 클론 설계 결론: `block_acl_meta.inherits_from_parent BOOL`은 **구현 선택지**이지 노션의 확인된 내부 구조가 아니다. 문서에서 확인된 요구사항은 "하위에서 권한 재정의 가능 + 하위의 명시 부여는 부모 override에 영향받지 않음" 두 가지다.
  - 계산은 루트까지 재귀 → 깊은 트리에서 O(depth) 조회 발생, 캐시 필요(F-06-14).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 중간 노드에서 상속 차단 후 조상 권한 변경 | 차단 지점 아래는 영향 없음 |
  | 페이지 이동(다른 부모로 드래그) | 상속 원천이 바뀌어 접근자 집합이 즉시 변함 → 이동 시 경고 다이얼로그 |
  | 순환 참조(부모를 자기 자식으로 이동) | 트리 이동 단계에서 차단 |
  | 조상이 휴지통에 있음 | 하위 접근 계산 시 삭제된 조상도 권한 원천으로 유지 `[추정]`. 복원 시 권한이 되살아나야 하므로 ACL을 조상 삭제와 함께 지우면 안 된다 |
  | 삭제된 principal(탈퇴 user / 삭제된 group)이 조상 ACL에 남음 | 판정에서 무시하되 행은 보존(감사 추적). 표시 단계에서만 필터 |
  | 부모 A와 부모 B 양쪽에서 상속(멀티 부모) | Notion 트리는 단일 부모이므로 발생하지 않음. 단 `synced block`/`link to page`는 참조일 뿐 부모가 아니므로 **권한을 전달하지 않는다** `[추정]` — 클론에서 반드시 명시할 규칙 |
  | 동시편집: A가 하위 권한을 바꾸는 동안 B가 그 페이지를 다른 부모로 이동 | 두 연산이 같은 서브트리를 건드리므로 **서브트리 단위 직렬화(부모 노드 advisory lock)** 필요. 아니면 이동 후 판정이 이전 부모 기준으로 남는 창이 생긴다 |
  | 순환: closure table 갱신 중 실패 | 이동은 트랜잭션 내에서 (사이클 검사 → closure 삭제 → closure 삽입) 원자 처리 |
  | 동시편집 중 조상 권한 변경 | 실시간 채널로 권한 무효화 이벤트 브로드캐스트 필요 |
  | 깊이 50+ 트리 | materialized path 또는 closure table 필수 |
  | 하위에만 권한 보유 시 breadcrumb | 상위 제목 노출/은닉 정책 결정 필요 `[확인필요]` |
  | 백링크·멘션에 접근 불가 페이지 | 제목 대신 "권한 없는 페이지"로 마스킹 |
- **데이터 모델 함의**:
  - `block.path` (materialized path, 예: `/root/aaa/bbb/`) 또는 closure table `block_ancestor(descendant_id, ancestor_id, depth)`.
  - `block_acl_meta.inherits_from_parent BOOL`.
  - 대표 쿼리(closure table 기준):

    ```sql
    SELECT MAX(r.rank)
    FROM acl_entry a
    JOIN block_ancestor anc ON anc.ancestor_id = a.node_id
    JOIN level_rank r ON r.level = a.level
    WHERE anc.descendant_id = :node_id
      AND anc.depth <= :depth_of_nearest_inheritance_break
      AND (
        (a.principal_type='user'  AND a.principal_id = :user_id) OR
        (a.principal_type='group' AND a.principal_id = ANY(:group_ids)) OR
        (a.principal_type='teamspace' AND a.principal_id = ANY(:teamspace_ids)) OR
        (a.principal_type='workspace_everyone')
      );
    ```
- **UI/인터랙션**: Share 패널의 상속 표시, "이 페이지에만 적용" 토글, 상위 페이지로 가는 링크.
- **의존 기능**: block 트리, F-06-01, F-06-04.
- **구현 난이도**: **XL** — 재귀 계산 + 캐시 무효화 + 트리 이동 시 재계산 + 실시간 반영이 결합된 이 도메인의 최난도 항목.
- **우선순위**: **P0** — 상속이 없으면 하위 페이지마다 수동 공유가 필요해 제품이 성립하지 않는다.
- **클론 시 현실적 대안**: ① MVP는 **space 단위 권한만**(Outline / 초기 Docmost 방식)으로 페이지 상속 계산을 아예 없앤다. ② v1에서 **상속 차단 플래그 + closure table**. ③ 규모가 커지면 Zanzibar 계열(SpiceDB / OpenFGA / Permify)로 권한 판정을 외부화하고 tuple만 관리한다.
- **참고 출처**: https://www.notion.com/help/sharing-and-permissions (상속·Private 이동 override 원문) , https://permify.co/post/modeling-notion-access-management/ , https://www.notion.com/help/notion-academy/lesson/scale-your-team-permissions

---

### F-06-06 페이지 공유 패널: 초대 · 링크 복사 · 접근 요청

- **한 줄 정의**: 페이지 단위로 사람/그룹을 초대하고 현재 접근자를 조회·변경하는 단일 진입점.
- **사용자 시나리오**:
  1. 페이지 우상단 `Share` 클릭
  2. 입력창에 이름/이메일 입력 → 워크스페이스 멤버는 프로필 사진과 함께 자동완성, 외부 이메일은 게스트로 추가됨
  3. 레벨 선택 후 초대
  4. `Copy link`로 URL 복사해 Slack 등에 전달 — **링크 자체는 권한을 부여하지 않는다**(수신자가 권한 없으면 접근 불가)
- **동작 상세**:
  - 패널 구성: 초대 입력창 / 접근자 목록(사람·그룹·teamspace) / `General access` 섹션(F-06-07) / `Publish` 탭(F-06-08) / `Copy link`.
  - 외부 이메일 초대 시: 게스트 레코드 생성 → 초대 메일 발송 → 상대는 Notion 계정 생성/로그인 후 접근.
  - 워크스페이스 정책으로 게스트가 꺼져 있으면 외부 이메일 입력이 차단되거나 Enterprise의 "게스트 초대 요청" 플로우로 전환된다.
  - 접근 요청: `[확인필요]` 해소됨 — 공식 문구 "If you open a page that you don't have access to, you can select `No access` on the page to send a request." 요청은 **페이지의 creator/editor**에게 가고 승인/거부할 수 있다. 상세는 F-06-15로 분리.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 이미 접근 권한이 있는 사람 재초대 | 기존 항목의 레벨만 갱신(중복 행 생성 금지) |
  | 잘못된 이메일 형식 | 인라인 검증, 초대 미발송 |
  | 허용 도메인 제한에 걸리는 이메일 | 초대 차단 + 사유 메시지 |
  | 게스트 한도 초과 | 게스트 추가 불가, 허용 도메인이면 멤버로만 |
  | 초대 메일 미수신 | 재발송 버튼, 초대 토큰 만료(예: 7일) |
  | 100명 일괄 붙여넣기 | 큐 처리 + 부분 실패 리포트 `[추정]` |
  | 게스트를 그룹으로 초대하려 함 | 그룹에 게스트가 들어갈 수 없으므로(F-06-03) 개별 부여로만 |
  | 두 사용자가 동시에 같은 사람의 레벨을 다르게 변경 | `UNIQUE(node_id, principal)` + UPSERT last-write-wins. 결과를 실시간 채널로 양쪽 Share 패널에 반영 |
  | 초대 대상이 이미 다른 워크스페이스의 멤버 | 동일 user 계정에 workspace_member 행이 추가될 뿐 — user는 워크스페이스 간 공유 엔티티 |
  | 정책상 게스트 초대가 꺼져 있음 | Share 입력이 차단되고, `Allow members to request adding guests`가 켜져 있으면 요청 플로우로 전환(F-06-11, F-06-15) |
  | 삭제된 계정이 ACL에 잔존 | 표시에서 제외 + 정리 배치 |
  | 자기 자신 초대 | 무시 |
- **데이터 모델 함의**: `acl_entry` 쓰기 + `page_invite(id, node_id, email, level, token, expires_at, accepted_at)`(미가입자 보류용) + `access_request(id, node_id, requester_id, message, status, decided_by, decided_at)`. 알림 도메인 연동(`notification(type='page_invited'|'access_requested')`).
- **UI/인터랙션**: Share 버튼, 자동완성 콤보박스, 행별 레벨 드롭다운, `Copy link` 토스트, 접근 요청 화면.
- **의존 기능**: F-06-01, F-06-02, 메일/알림 발송.
- **구현 난이도**: **M** — UI는 표준적이나 초대 토큰·미가입자 처리·메일 파이프라인이 붙는다.
- **우선순위**: **P0**.
- **클론 시 현실적 대안**: MVP는 워크스페이스 내부 사용자 초대만, 외부 이메일 초대(게스트)는 v1. 접근 요청은 "권한 없음" 화면 + 소유자 표시로 대체.
- **참고 출처**: https://www.notion.com/help/share-your-work , https://www.notion.com/help/sharing-and-permissions

---

### F-06-07 일반 액세스(General access): 워크스페이스 전체 공유 · 웹 링크 · 링크 만료

- **한 줄 정의**: 개별 초대와 별개로 "이 페이지를 기본적으로 누가 열 수 있는가"를 3가지 범위로 설정한다.
- **사용자 시나리오**:
  1. `Share` → `General access` 드롭다운
  2. `Only people invited` / `Everyone at {workspace}` / `Anyone on the web with link` 중 선택
  3. 각 항목 오른쪽에서 레벨 선택(edit / comment / view)
  4. 웹 링크의 경우 만료 시각 설정 가능
- **동작 상세**:

  | 범위 | 대상 principal | 로그인 필요 | 부가 옵션 |
  |---|---|---|---|
  | Only people invited | 없음(명시 ACL만) | O | 기본값 |
  | Everyone at workspace | `workspace_everyone` | O | 검색 결과에서 숨김 옵션 |
  | Anyone on the web with link | `public` | 열람은 불필요 / **댓글·편집에는 Notion 로그인 필요** | 만료 일시 설정 |

  - `[확인필요]` "Everyone at workspace"의 **검색에서 숨김** 옵션은 이번 조사에서 1차 출처로 확인하지 못했다. 초판은 이를 단정했으나 근거가 없어 태그를 붙인다. 다만 기능 자체는 클론에 유용하므로 `acl_entry.hidden_from_search` 필드는 남긴다.
  - 웹 링크는 URL 자체가 자격 증명이므로 링크를 아는 누구나 접근한다. 만료 시각이 지나면 접근이 끊긴다.
  - **레벨**(공식): "allow edit, comment, or view-only access". **로그인 요구**(공식): "page visitors will need to be logged into Notion if they want to comment on or edit your page." → 열람만 익명 허용.
  - **만료는 유료 플랜 기능**이다. 2022-10-12 릴리스 노트에 "Public pages that automatically expire"로 도입되었고, 헬프 문서는 `Anyone on the web with link` 드롭다운 안의 `Link expires`에서 시각을 고르는 방식이라고 서술한다.
  - 웹 링크와 웹 게시(F-06-08)는 별개 개념 — 공식 문서도 링크 공유 안내에서 Notion Sites를 별도 문서로 분기시킨다. 전자는 원본 URL 접근 허용, 후자는 notion.site/커스텀 도메인 사이트 발행.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 웹 링크 edit 권한 + 익명 방문자 | 로그인 유도 (댓글/편집에 계정 필요) |
  | 만료된 링크 접근 | 만료 안내 화면, 재발급은 소유자만 |
  | 워크스페이스 정책이 퍼블릭 공유 금지 | 옵션 자체가 비활성화(F-06-11) |
  | 상위 페이지가 웹 공개, 하위는 비공개 원함 | 하위에서 상속을 끊어 공개 대상에서 제외 |
  | 링크 공유 후 페이지 이동 | 링크 유효성 유지(노드 id 기준) `[추정]`. 단 이동으로 **상속 원천이 바뀌어도 public_link는 노드 로컬이라 그대로 살아남는다** → 비공개 영역으로 옮긴 페이지가 계속 공개되는 사고가 가능. 이동 시 공개 상태 경고 필수 |
  | 만료 시각이 지난 직후의 캐시된 CDN 응답 | 만료를 CDN TTL보다 우선하도록 짧은 TTL + 만료 시각 기준 서명 토큰 |
  | 익명 방문자가 comment 레벨 링크로 접근 | 열람은 되지만 댓글 시도 시 로그인 요구(공식). 로그인 후 그 사용자는 **게스트가 아닌 익명-인증 주체**로 취급 — 워크스페이스 멤버 목록에 넣지 말 것 |
  | 동시편집: edit 레벨 공개 링크로 다수 익명 사용자가 편집 | 실시간 세션의 presence·CRDT actor id를 링크 세션 단위로 발급해야 충돌 해소가 가능 |
  | 정책으로 공개 링크 금지 전환 | 기존 `public_link.enabled` 를 **런타임 정책 게이트로 무효화**(행 삭제 아님) → 정책 해제 시 원복 가능 |
  | 공개 페이지에 비공개 하위 링크가 인라인 언급 | 방문자에게 마스킹 필요 |
  | 대량 트래픽 유입 | 익명 요청 경로는 인증 경로와 분리해 캐시 |
- **데이터 모델 함의**: `public_link(node_id, enabled, level, expires_at, token)` + `acl_entry(principal_type='workspace_everyone', level, hidden_from_search BOOL)`. 익명 접근 경로는 ACL 조회 전에 `public_link`를 먼저 확인해 read-through 캐시로 처리.
- **UI/인터랙션**: General access 드롭다운, 만료 날짜 피커, 링크 복사 버튼, 공개 상태를 나타내는 페이지 헤더 배지 `[추정]`.
- **의존 기능**: F-06-06, F-06-11.
- **구현 난이도**: **M** — 익명 렌더 경로(SSR/캐시)와 인증 경로의 이원화가 실제 비용.
- **우선순위**: **P0**(초대된 사람만 / 워크스페이스 전체) + **P1**(웹 링크) + **P2**(만료 — 노션도 유료 기능이며 MVP 가치 낮음).
- **클론 시 현실적 대안**: 웹 링크는 서명된 토큰 URL(`/p/{nanoid}`)로 구현하고 만료는 토큰 payload의 exp로 처리. 만료 링크 재발급은 새 토큰 생성.
- **참고 출처**: https://www.notion.com/help/share-your-work (레벨·로그인 요구·Link expires 원문) , https://www.notion.com/releases/2022-10-12 (만료 링크 도입) , https://www.notion.com/help/sharing-and-permissions

---

### F-06-08 웹 게시 (Publish to Web / Notion Sites)

- **한 줄 정의**: 페이지 트리를 공개 웹사이트로 발행하고 도메인·SEO·테마·복제 허용을 설정한다.
- **사용자 시나리오**:
  1. `Share` → `Publish` 탭 → `Publish` 클릭
  2. 도메인 선택(무료 `*.notion.site` 1개 클레임 또는 커스텀 도메인)
  3. 슬러그 편집(영문/숫자/하이픈, 최대 60자. 홈 페이지는 커스텀 슬러그 불가)
  4. 사이트 설정에서 검색엔진 인덱싱, 템플릿 복제 허용, 테마, breadcrumb, favicon, 소셜 미리보기, Google Analytics 설정
  5. 이후 원본 페이지 편집이 사이트에 자동 반영됨
- **동작 상세**:

  | 설정 | 값 | 플랜 | 근거 |
  |---|---|---|---|
  | notion.site 도메인 | **무료 1개 / 유료 최대 5개** 클레임. 발행 사이트 수는 무제한("Publish an unlimited number of Notion Sites") | 무료 1 / 유료 5 | help/notion-sites-availability-and-pricing (원문 확인, 초판의 "전 플랜 1개"는 오류) |
  | 커스텀 도메인 | **최대 25개**. 도메인 1개당 애드온 1개를 각각 구매($10/월, 연간 결제 시 $8/월). 노션이 도메인을 판매하지는 않음 | 유료 + 애드온 | 동 문서 (초판 `[확인필요]` 해소) |
  | 슬러그 커스터마이즈 | 영문·숫자·하이픈만, 최대 60자. **홈페이지는 슬러그 불가**. **하위 페이지에 자동 상속되지 않아 페이지마다 따로 설정해야 함** | 유료 | help/public-pages-and-web-publishing |
  | Homepage 지정 | 도메인의 루트에 특정 페이지 매핑 | 유료 | 동 문서 |
  | Discoverable on the web (인덱싱) | on/off | **전 플랜** | 동 문서 |
  | 사이트 커스터마이즈(테마/breadcrumb/favicon/OG/SEO 메타) | 편집 가능 | 유료 | 동 문서 |
  | Duplicate as template | 방문자가 자기 워크스페이스로 복제 허용 | `[확인필요]` 플랜 미명시 | 동 문서 |
  | Google Analytics | 측정 ID 연결 | 유료 | 동 문서 |

  - **하위 페이지는 기본적으로 함께 게시된다**: "Publishing a Notion page to the web means all of its subpages will be published too." 특정 하위를 공개에서 빼려면 그 하위의 권한을 제한한다.
  - **정정**: 초판은 "방문자는 댓글·편집 불가"라고 단정했으나 근거가 없다. 공식 가이드는 웹 공개 시 "set whether people can comment, view or edit the page"라고 서술하며, 댓글·편집에는 Notion 로그인이 필요하다. 즉 **공개 페이지도 comment/edit 레벨을 줄 수 있다**(F-06-07과 같은 축). 다만 Notion Sites의 사이트형 렌더에서 댓글 UI가 노출되는지는 별도 확인이 필요하다 `[확인필요]`.
  - 인덱싱은 반영까지 최대 4주 소요: "Notion Sites can take up to four weeks to be indexed and appear in search results."
  - 게시 해제(unpublish) 시 웹에서 제거되지만, **General access의 링크 공유가 켜져 있으면 직접 링크로는 여전히 열릴 수 있다** — unpublish와 링크 비공개는 별개 조작이다.
  - **영구 삭제된 페이지의 슬러그는 재사용 불가** `[확인필요 — 이번 조사에서 원문 재확인 실패]`.
  - Enterprise workspace owner는 `Settings → Security`의 **`Disable publishing sites, forms and public links`** 로 사이트·폼·공개 링크 게시를 전면 차단할 수 있다(정확한 설정명, F-06-11).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 슬러그 중복 | 워크스페이스/도메인 범위 unique 검증, 충돌 시 거부 |
  | 게시된 페이지 영구 삭제 | 사이트 404, 슬러그 영구 예약(재사용 금지) |
  | 커스텀 도메인 DNS 미설정 | 검증 대기 상태, 인증서 발급 실패 처리 |
  | 인덱싱 off인데 이미 색인됨 | `noindex` 메타 + robots로 제거 요청 필요, 즉시 반영 안 됨 |
  | 복제 허용 상태에서 대량 복제 | rate limit 필요 `[추정]` |
  | 공개 트리 안에 비공개 하위 | 링크·백링크·검색 결과 모두에서 제외 |
  | 대용량 DB 게시 | 페이지네이션·캐시 없이는 응답 지연 |
  | 게시 후 페이지 이동 | 사이트 루트 변경 시 URL 재계산 `[확인필요]`. 슬러그가 하위로 상속되지 않으므로 하위 URL은 부모 이동과 무관하게 유지될 가능성이 높다 `[추정]` |
  | 게시 트리 안에서 하위 페이지 권한을 나중에 제한 | 공개 렌더 캐시·CDN·검색엔진 캐시 3중 무효화 필요. 무효화 실패가 곧 정보 유출 |
  | 동시편집 중인 페이지가 공개 상태 | 저장되지 않은 CRDT 상태를 공개 렌더에 흘리면 안 됨 → 공개 경로는 **커밋된 스냅샷만** 읽는다 |
  | 커스텀 도메인 26개째 추가 시도 | 상한 25 초과로 거부(플랜 한도 검증) |
  | 도메인 소유권을 잃은 뒤에도 사이트가 살아 있음 | DNS 재검증 주기 필요(예: 24시간) — 만료 시 사이트 비활성 `[추정]` |
- **데이터 모델 함의**: `site(id, workspace_id, root_node_id, domain_type, host, slug, indexable, allow_duplicate_as_template, theme, show_breadcrumb, favicon_url, og_*, analytics_id)` + `site_slug_reservation(host, slug, released BOOL=false)` (재사용 금지용) + `custom_domain(id, workspace_id, host, dns_verified_at, cert_status)`.
- **UI/인터랙션**: Share 패널의 Publish 탭, 도메인 셀렉터, 슬러그 인라인 편집, 토글 목록, `View site` 버튼, `Unpublish`.
- **의존 기능**: F-06-07, F-06-11(정책 차단), 렌더링/SSR 인프라.
- **구현 난이도**: **XL** — 공개 렌더 파이프라인(SSR + CDN 캐시 + 무효화), 커스텀 도메인 DNS 검증과 TLS 자동 발급, SEO 메타, 복제 파이프라인이 모두 별개 서브시스템.
- **우선순위**: **P1** — 노션 클론의 차별 포인트지만 MVP는 아님.
- **클론 시 현실적 대안**: ① 1단계는 `/{workspace}/p/{slug}` 형태의 공개 읽기 전용 SSR 페이지 + `noindex` 기본값. ② 커스텀 도메인은 Vercel/Cloudflare for SaaS 같은 도메인 위임 서비스로 아웃소싱. ③ "템플릿 복제"는 페이지 트리 deep copy 함수 재사용(도메인 01의 복제 로직).
- **참고 출처**: https://www.notion.com/help/public-pages-and-web-publishing (슬러그·인덱싱·하위 게시 원문) , https://www.notion.com/help/notion-sites-availability-and-pricing (도메인 개수·가격 원문) , https://www.notion.com/help/connect-a-custom-domain-with-notion-sites , https://www.notion.com/help/guides/publish-notion-pages-to-the-web

---

### F-06-09 게스트 관리: 한도 · 승격 · 게스트 초대 요청

- **한 줄 정의**: 워크스페이스 외부인을 페이지 단위로만 접근시키는 경량 주체를 관리한다.
- **사용자 시나리오**:
  1. 페이지 Share에서 외부 이메일 입력 → 게스트로 추가
  2. Owner가 `Settings → People → Guests`에서 게스트별 접근 페이지 목록 확인
  3. 필요 시 게스트를 멤버로 승격하거나 제거
  4. (Enterprise) 멤버가 게스트 초대를 신청하면 owner가 페이지별·게스트별로 승인
- **동작 상세**:
  - 게스트는 **공유받은 페이지와 그 하위**만 접근한다. 워크스페이스 검색·멤버 목록·teamspace에 접근하지 못한다 `[추정]`.
  - 게스트는 유료 좌석을 소비하지 않지만 플랜별 게스트 한도가 있다. **무료 플랜 10명**은 확인됨. Plus/Business/Enterprise의 정확한 수치는 pricing 페이지 기준으로 계속 바뀌므로 `[확인필요]` 유지. 클론은 **한도를 하드코딩하지 말고 `plan.guest_limit` 설정값**으로 둔다.
  - 게스트는 **그룹에 넣을 수 없다**("Groups can't contain workspace guests") → 게스트 권한은 항상 개별 부여다. 게스트 100명에게 같은 페이지를 주려면 ACL 100행이 생긴다. 클론은 이를 감안해 `acl_entry`에 node_id 인덱스를 반드시 둔다.
  - 게스트는 **SAML SSO / SCIM 관리 대상이 아니다**(F-06-12) → deprovisioning 자동화가 안 되는 구멍이며, 감사 관점에서 게스트 정기 리뷰 UI가 필요하다.
  - **한도 초과 시 동작**: 새로 공유하는 사용자가 워크스페이스 허용 도메인에 속하면 게스트가 아니라 **멤버로만** 추가된다(문서 명시).
  - 게스트도 자체 Notion 계정이 필요하다.
  - 워크스페이스 정책으로 게스트 초대를 전면 차단할 수 있고, 차단 상태에서도 owner가 "게스트 초대 요청" 기능을 켜 예외를 허용할 수 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 게스트가 접근하던 마지막 페이지의 권한 제거 | 접근 페이지 0개 게스트는 자동 정리 대상 `[추정]` |
  | 게스트 이메일이 허용 도메인에 포함됨 | 게스트 대신 멤버 가입 유도 |
  | 게스트 → 멤버 승격 | 기존 페이지 ACL 유지 + 워크스페이스 접근 추가, 좌석 소비 시작 |
  | 게스트가 하위 페이지를 새로 생성 | 생성물의 소유·상속 정책 결정 필요 `[확인필요]` |
  | 게스트에게 멘션 자동완성 노출 | 접근 가능한 페이지 범위로 제한해야 함 |
  | 한도 초과 + 허용 도메인 아님 | 초대 실패 + 명확한 사유 메시지 |
  | 정책상 멤버의 게스트 초대가 꺼져 있음 | `Allow members to request adding guests`가 켜져 있으면 요청으로 전환(F-06-15), 아니면 완전 차단 |
  | 게스트가 워크스페이스 멤버 승격을 요청 | `Allow page guests to request to be added as members`(Plus+) 설정으로 허용/차단 |
  | 게스트 1명이 5,000페이지에 접근 | `guest_page_index` 비정규화 테이블 없이는 Settings의 게스트 목록 조회가 풀스캔이 된다 |
  | 게스트 계정 삭제와 동시에 그 게스트가 편집 중 | 세션 즉시 무효화 + 진행 중 CRDT op 폐기. ACL 행은 감사 목적 tombstone 보존 |
  | 순환: 게스트가 자기가 접근한 페이지의 하위를 만들고 거기에 다른 게스트 초대 | 게스트에게 share capability를 주지 않으면(full access 미부여) 원천 차단 — 클론 기본값 권장 |
- **데이터 모델 함의**: `workspace_member.role='guest'` 그대로 사용하되 게스트의 접근 페이지 목록은 `acl_entry`에서 역조회. 성능을 위해 `guest_page_index(workspace_id, user_id, node_id)` 비정규화 테이블 권장. `guest_invite_request(id, node_id, requester_id, guest_email, level, status)`.
- **UI/인터랙션**: Settings → People → Guests 탭(게스트별 접근 페이지 수 표시), 게스트 행에서 "멤버로 전환", 페이지 Share에서 게스트 배지.
- **의존 기능**: F-06-02, F-06-06, F-06-11.
- **구현 난이도**: **M** — 데이터 모델은 멤버와 공유하나 "게스트에게는 보이지 않아야 하는 것"(검색, 멤버 목록, 멘션, 사이드바) 예외 처리가 광범위하다.
- **우선순위**: **P1**.
- **클론 시 현실적 대안**: MVP는 게스트 대신 F-06-07의 공개 링크(view/comment)로 외부 협업을 대체. 게스트 정식 지원은 v1.
- **참고 출처**: https://www.notion.com/help/add-members-admins-guests-and-groups , https://www.notion.com/help/whos-who-in-a-workspace , https://www.notion.com/help/create-and-manage-groups (게스트 그룹 제외) , https://www.notion.com/help/sharing-and-permissions

---

### F-06-10 데이터베이스 세분화 권한: Can edit content · Can create · Page-level access rule

- **한 줄 정의**: 데이터베이스 구조와 개별 row(페이지)의 접근을 분리해, 속성 값에 따라 row 단위 권한을 자동 부여한다.
- **사용자 시나리오**:
  1. 풀 페이지 데이터베이스에서 `Share` 클릭
  2. `Page-level access` 섹션에서 규칙 추가
  3. 소스로 person 속성(예: Assignee) 또는 `Created by` 선택
  4. 부여할 레벨(view / comment / edit / full access) 선택
  5. 이후 row의 해당 속성에 사람이 채워지면 그 사람이 자동으로 그 row에 접근
- **동작 상세**:
  - `Can edit content`: DB 안에서 row 생성·편집과 속성 값 편집은 가능하나 **속성 정의·뷰·정렬·필터 등 구조는 변경 불가**.
  - `Can create`: 새 row 생성만 가능. 기존 row는 개별 부여 전까지 보이지 않음. Business/Enterprise 전용.
  - Page-level access rule: person 속성 / created by 기반. **여러 규칙에 매칭되면 가장 높은 레벨 적용**(문서 명시) — 전역 broadest-wins 규칙과 동일.
  - 문서 권고 조합: DB 전체는 `Can create`(또는 No access) + `Created by → Can edit` 규칙 → "자기가 만든 것만 보고 편집" 패턴.
  - 각 row는 자체 Share 메뉴를 가지며 DB 전체 접근 없이도 개별 row 접근 부여가 가능하다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | person 속성 값 변경 | 이전 담당자의 접근이 즉시 소멸, 신규 담당자 접근 발생 → 권한 캐시 무효화 트리거 |
  | person 속성이 비어 있음 | 규칙 미적용, 상속 권한만 남음 |
  | 규칙 소스 속성 삭제 | 규칙 무효화 또는 삭제 차단 필요 |
  | 규칙이 부여한 접근으로 사용자가 담당자를 자기 자신으로 변경 | 권한 상승 경로 — `edit`가 person 속성 편집을 허용하는지 정책 결정 필요 `[확인필요]` |
  | row가 다른 DB로 이동 | 규칙 소속이 바뀌어 접근 재계산 |
  | 접근 불가 row가 뷰 카운트/집계에 포함 | 롤업·카운트 노출 여부 정책 필요(정보 누출 위험) `[확인필요]` |
  | 10만 row DB | 규칙 평가를 쿼리 필터로 밀어넣어야 함(행별 재계산 불가) |
- **데이터 모델 함의**: `page_access_rule(database_id, source_property_id, source_kind, level)`. 조회 시 row 필터를 SQL로 변환: `WHERE props->>'assignee' @> :user_id OR created_by = :user_id OR <acl 조인>`. 롤업/집계 쿼리에도 같은 필터를 적용해야 누출이 없다.
- **UI/인터랙션**: DB Share 패널의 `Page-level access` 섹션, 규칙 행(속성 셀렉터 + 레벨 셀렉터), row 페이지 자체의 Share.
- **의존 기능**: 데이터베이스 도메인(속성/뷰), F-06-05, F-06-01.
- **구현 난이도**: **L** — 권한이 데이터 값에 의존해 동적으로 변하므로 캐시 무효화와 목록 쿼리 필터링이 까다롭다.
- **우선순위**: **P2** — 강력하지만 MVP 밖. 단, "row별 Share"는 페이지 = row라는 모델 덕에 F-06-05만 있으면 자동 성립하므로 **P1**로 볼 수 있다.
- **클론 시 현실적 대안**: 규칙 엔진 대신 **PostgreSQL Row Level Security(RLS) 정책**으로 `assignee = current_user` 형태를 구현. 규칙 종류를 person/created_by 2종으로 고정하면 정책 SQL도 2종으로 끝난다.
- **참고 출처**: https://www.notion.com/help/sharing-and-permissions , https://www.notion.com/help/guides/assign-custom-database-permissions

---

### F-06-11 워크스페이스 보안 정책 (퍼블리싱 · 게스트 · 내보내기 · 도메인 제한)

- **한 줄 정의**: 워크스페이스 전체에 걸쳐 특정 공유·반출 행위를 원천 차단하는 상위 정책 계층.
- **사용자 시나리오**:
  1. Owner가 `Settings → Security`
  2. `Disable public page sharing`, `Disable guests`, `Disable export`, `Disable move to other workspace` 토글
  3. `Settings → General`에서 `Allowed email domains` 관리
  4. 이후 모든 페이지의 Share 패널에서 해당 옵션이 비활성 상태로 렌더링됨
- **동작 상세**:

  **정정**: 초판의 설정 이름 상당수가 실제 UI와 다르다. 아래는 `Settings → Security` / `Settings → General` 문서에서 확인한 실제 항목이다.

  | 실제 설정명 | 차단/허용 대상 | 플랜 |
  |---|---|---|
  | `Allowed email domains` (General) | 해당 도메인 이메일 사용자가 워크스페이스에 자동 참여 가능 | **전 플랜** |
  | `Allow page access requests from non-members` | 비멤버가 페이지 접근 요청을 보낼 수 있는지 (F-06-15) | 전 플랜(Enterprise 제외 서술) `[확인필요]` |
  | `Allow members to request adding other members` | 멤버가 멤버 추가를 신청 | Plus+ |
  | `Allow any user to request to be added as a member of the workspace` | 임의 사용자의 워크스페이스 가입 신청 | Plus+ |
  | `Allow page guests to request to be added as members` | 게스트의 멤버 승격 신청 | Plus+ |
  | `Allow members to invite guests to pages` | 멤버의 게스트 초대 허용/차단 | Enterprise |
  | `Allow members to request adding guests` | 차단 상태에서의 예외 요청 경로 | Enterprise |
  | `Who can add restricted members` (to teamspaces and pages) | restricted member 추가 주체 제한 | Enterprise |
  | `Disable publishing sites and forms` / `Disable publishing sites, forms and public links` | Notion Sites·Forms·공개 링크 발행 차단 | Enterprise |
  | `Disable duplicating pages to other workspaces` | 다른 워크스페이스로 페이지 이동/복제 차단 | Enterprise |
  | `Disable export` | "Don't let members export pages" | Enterprise |
  | `Verify a domain` / `Enable SAML SSO` (Identity) | 도메인 검증 / SSO | Business+ |

  - 정책은 **ACL보다 상위에서 평가된다**: 개별 페이지에서 full access를 가져도 정책이 금지하면 그 행위를 할 수 없다. 즉 유일하게 deny가 존재하는 계층.
  - **정책은 두 방향으로 작동한다**: 금지형(`Disable ...`)과 **요청 허용형**(`Allow ... to request ...`). 후자는 단순 boolean이 아니라 **F-06-15 요청 플로우의 스위치**다. 초판은 이 절반을 통째로 빠뜨렸다.
  - **조직 계층 오버라이드**(Enterprise): 조직 owner는 각 정책을 `Workspace managed / Enabled for everyone / Disabled for everyone` 3상태로 설정해 하위 workspace 전체에 일괄 적용할 수 있다. 즉 정책 평가는 `org 설정 → workspace 설정 → ACL` 3단이다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 이미 공개된 페이지가 있는 상태에서 퍼블리싱 금지 | 기존 공개 링크의 즉시 무효화 여부 정책 필요 `[확인필요]`(즉시 무효화가 안전) |
  | 게스트 존재 상태에서 게스트 금지 | 기존 게스트 접근 유지/차단 결정 필요 `[확인필요]` |
  | 내보내기 금지 + API 접근 | API도 함께 막지 않으면 정책이 우회된다 |
  | 허용 도메인에 공용 메일(gmail.com) 등록 | 경고 필요 — 사실상 누구나 가입 |
  | 정책 변경 감사 | audit_log에 반드시 기록 |
  | 조직이 `Disabled for everyone`인데 workspace가 켜려 함 | 조직 설정이 승리. UI는 잠금 + 사유("조직 정책") 표시 |
  | 정책 평가 캐시 | 정책은 workspace당 1행이라 요청마다 조회해도 되지만, 조직 오버라이드까지 join하면 핫패스가 된다 → 워크스페이스 단위 캐시 + 변경 시 전역 무효화 |
  | 대용량: 정책 켜는 순간 공개 링크 10만 개 | 행을 지우지 말고 **런타임 게이트로 무효화**. 되돌릴 수 있어야 한다 |
- **데이터 모델 함의**: `security_policy(workspace_id, ...)` + `org_security_policy(org_id, policy_key, mode ENUM('workspace_managed','enabled_for_everyone','disabled_for_everyone'))`. 서버 권한 검사 함수는 `capability_check(user, node, action)` 안에서 **org 정책 → workspace 정책 → ACL → lock** 순으로 평가한다. 정책 키를 문자열 enum으로 두고 `policy_gate(action) -> policy_key` 매핑표를 단일 소스로 유지하면 새 기능 추가 시 게이트 누락을 컴파일 타임에 잡을 수 있다.
- **UI/인터랙션**: Settings → Security 토글 목록, 각 토글에 영향 범위 설명, 비활성화된 Share 옵션에 툴팁으로 사유 표시.
- **의존 기능**: F-06-02(owner), F-06-07, F-06-08, F-06-09, 내보내기 도메인.
- **구현 난이도**: **M** (초판 `S~M`에서 상향) — 스키마는 단순하지만 ① 금지형·요청형 두 종류를 모두 다뤄야 하고 ② 조직 3상태 오버라이드가 붙으며 ③ **게이트 누락 하나가 곧 정책 우회**라 커버리지 테스트가 필수다. "각 행위 지점에 빠짐없이"가 실제로는 수십 개 엔드포인트를 뜻한다.
- **우선순위**: **P2** — 조직 판매 시점에 필요. 단 `allow_publish_sites_and_forms`(공개 차단)는 클론에서도 조기 도입 가치가 있어 **P1**.
- **클론 시 현실적 대안**: 단일 JSON 컬럼 `workspace.policy JSONB`로 시작하고 서버 미들웨어 한 곳에서 평가.
- **참고 출처**: https://www.notion.com/help/workspace-settings (실제 설정명 원문) , https://www.notion.com/help/organization-level-controls (조직 3상태 오버라이드) , https://www.notion.com/help/public-pages-and-web-publishing , https://www.notion.com/help/add-members-admins-guests-and-groups

---

### F-06-12 엔터프라이즈 아이덴티티: SAML SSO · SCIM · 도메인 검증 · 감사 로그

- **한 줄 정의**: 외부 IdP를 신원 원천으로 삼아 로그인과 계정 수명주기를 위임하고, 접근 이력을 기록한다.
- **사용자 시나리오**:
  1. Owner가 도메인 소유권 검증(DNS TXT 레코드)
  2. `Settings → Identity & provisioning`에서 IdP 메타데이터(Entity ID, SSO URL, X.509 인증서) 입력
  3. 테스트 로그인 후 SSO 강제(enforce) 활성화
  4. SCIM 토큰 발급 → IdP에 등록 → 사용자/그룹 자동 프로비저닝
  5. Audit Log API로 접근·공유·권한 변경 이력 수집
- **동작 상세**:

  | 기능 | 내용 | 플랜 |
  |---|---|---|
  | SAML SSO | 워크스페이스 단위 SSO | Business 이상 |
  | JIT provisioning | SSO 첫 로그인 시 계정 자동 생성. `Automatic account creation` 설정 필요 | Enterprise |
  | SCIM | 사용자·그룹 자동 생성/갱신/비활성화 | Enterprise |
  | Audit Log API | 이력 조회 | Enterprise |
  | 도메인 검증 | 도메인 소유 워크스페이스 통합 관리 | Enterprise |

  - **게스트는 SAML SSO / SCIM으로 관리되지 않는다**(문서 명시). 게스트는 별도 경로로 남는다.
  - SCIM을 쓰는 경우 JIT provisioning 동시 사용은 권장되지 않는다(중복 계정 생성). 일부 IdP는 SCIM을 SSO보다 먼저 구성할 것을 권고.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | IdP 장애 | 브레이크글래스 계정(SSO 우회 owner) 필요 |
  | SCIM에서 사용자 deprovision | 좌석 회수 + 세션 즉시 무효화 + 콘텐츠는 보존 |
  | IdP 그룹명 변경 | externalId 기준 매칭으로 그룹 재생성 방지 |
  | 인증서 만료 | 만료 전 알림, 롤오버 지원 |
  | SSO 강제 상태에서 게스트 로그인 | 게스트는 SSO 대상 아님 → 별도 인증 경로 유지 |
  | 같은 사용자가 여러 워크스페이스 소속 | 워크스페이스별 SSO 설정 충돌 처리 필요 `[확인필요]` |
- **데이터 모델 함의**: `sso_config(workspace_id, entity_id, sso_url, x509_cert, jit_provisioning, enforced)`, `scim_token(workspace_id, token_hash, ...)`, `user_identity(user_id, provider, external_id UNIQUE)`, `verified_domain(workspace_id, domain, verified_at, txt_token)`, `audit_log(...)` (append-only, 파티셔닝 권장).
- **UI/인터랙션**: Settings → Identity & provisioning. 메타데이터 XML 업로드, 테스트 연결 버튼, SCIM 토큰 1회 노출, 감사 로그 필터·CSV 내보내기.
- **의존 기능**: F-06-02, 인증 도메인.
- **구현 난이도**: **L** — SAML(서명 검증, 리플레이 방지)과 SCIM 2.0 엔드포인트 구현 각각이 별도 작업. 라이브러리 활용 시 축소 가능.
- **우선순위**: **P2** — B2B 판매 전에는 불필요.
- **클론 시 현실적 대안**: 자체 구현 대신 Keycloak / Auth0 / WorkOS 등 IdP 브로커를 붙여 SAML·SCIM을 위임하고, 내부에는 `user_identity` 매핑만 유지. Audit log는 애플리케이션 이벤트 버스에 훅을 걸어 append-only 테이블에 적재.
- **참고 출처**: https://www.notion.com/help/saml-sso-configuration , https://www.notion.com/help/set-up-identity-provider-for-scim , https://www.notion.com/help/enterprise-admins

---

### F-06-13 API 연동(Connection) 권한과 capability 모델

- **한 줄 정의**: 외부 통합이 워크스페이스 콘텐츠에 접근하는 범위를, 페이지 공유(무엇에)와 capability(무엇을)의 곱으로 제한한다.
- **사용자 시나리오**:
  1. 개발자가 Developer portal에서 integration 생성, capability 선택
  2. Internal: 소유자가 Content access 탭에서 페이지를 추가하거나, 워크스페이스 멤버가 페이지의 `Add connections` 메뉴로 공유
  3. Public: OAuth 플로우의 page picker에서 사용자가 접근 허용 페이지를 선택
  4. 통합은 부여된 페이지와 **그 하위 트리**를 읽고 쓴다
- **동작 상세**:

  | capability | 허용 |
  |---|---|
  | Read content | 기존 콘텐츠 조회 |
  | Update content | 기존 객체 수정 |
  | Insert content | 신규 생성(전체 객체 읽기 권한은 부여하지 않음) |
  | Read comments | 페이지/블록 댓글 조회 |
  | Insert comments | 댓글 작성 및 기존 discussion에 추가 |
  | No user information | user 객체에 식별 정보 없음 |
  | User information without email | 이름·프로필 이미지만 |
  | User information with email | 이메일 포함 |

  - 접근 범위: "연결이 페이지/DB에 접근 권한을 받으면 그 리소스와 **자식들**을 읽고 쓸 수 있다"(공식 문서). → 트리 상속이 API에도 동일 적용.
  - capability는 사람의 공유 권한 **위에서 추가로 좁히는** 필터다. 두 조건을 모두 만족해야 호출이 성공한다.
  - **`[확인필요]` 해소** — 공식 에러 레퍼런스 기준:

    | 코드 | HTTP | 의미 |
    |---|---|---|
    | `unauthorized` | 401 | "The bearer token is not valid." |
    | `restricted_resource` | **403** | "Given the bearer token used, the client doesn't have permission to perform this operation." → **capability 부족** |
    | `object_not_found` | **404** | "the resource does not exist. This error can also indicate that the resource has not been shared with owner of the bearer token." → **미공유** |

    즉 **capability 부족은 403, 미공유는 404**로 갈린다. 404가 "없음"과 "미공유"를 합쳐 존재 자체를 숨기는 설계는 클론이 그대로 따라야 할 좋은 패턴이다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 공유되지 않은 페이지 조회 | `object_not_found` 404 — 존재 자체를 숨긴다(노션 실동작) |
  | capability는 있으나 사람 쪽 권한이 없는 리소스 | 두 조건의 **곱**이므로 거부. 어느 쪽이 원인인지 노출하지 않는 편이 안전 |
  | 통합이 부여받은 페이지가 다른 부모로 이동 | 부여는 노드 id 기준이므로 유지되지만, **이동으로 서브트리가 커지면 통합의 접근 범위가 조용히 확대된다** → 이동 시 연결 목록 경고 필요 `[추정]` |
  | 페이지 공유 해제 | 토큰은 유효하나 해당 리소스만 접근 불가 |
  | 통합이 만든 콘텐츠의 작성자 표기 | bot user로 표기 → `user.type='bot'` 필요 |
  | 토큰 유출 | 토큰 회전(rotate)·폐기 경로 필요 |
  | rate limit 초과 | 429 + Retry-After |
  | OAuth 재인증 시 페이지 선택 변경 | 이전 부여 범위 교체/병합 정책 필요 `[확인필요]` |
- **데이터 모델 함의**: `integration(id, workspace_id, type ENUM('internal','public'), name, capabilities BITMASK, owner_user_id)`, `integration_token(integration_id, token_hash, scope)`, `acl_entry.principal_type='integration'`(연결도 principal로 취급하면 권한 계산이 재사용된다), `user(type='bot', integration_id)`.
- **UI/인터랙션**: 페이지 `···` 메뉴의 `Connections → Add connections`, 워크스페이스 설정의 Connections 목록·강제 승인.
- **의존 기능**: F-06-05(트리 상속), 인증/OAuth.
- **구현 난이도**: **M~L** — 권한 모델 재사용이 가능하면 M, OAuth 공개 통합·페이지 피커까지면 L.
- **우선순위**: **P2**.
- **클론 시 현실적 대안**: MVP는 personal access token 1종 + 워크스페이스 전체 스코프로 시작하고, 페이지 단위 부여는 v2. capability는 `read/write/comment` 3비트로 축약.
- **참고 출처**: https://developers.notion.com/reference/capabilities , https://developers.notion.com/reference/errors (403/404 구분 원문) , https://www.notion.com/help/create-integrations-with-the-notion-api

---

### F-06-14 권한 캐시 · 사이드바/검색 필터링 · 무효화 전파

- **한 줄 정의**: 유효 권한 계산 결과를 캐시하고, 사이드바 트리·검색·멘션 결과를 사용자별 접근 가능 집합으로 필터링하며, 권한 변경을 즉시 전파한다.
- **사용자 시나리오**:
  1. 사용자가 로그인 → 사이드바에 자신이 접근 가능한 teamspace/페이지만 렌더
  2. 검색 시 접근 불가 페이지는 결과에 없음
  3. 다른 사용자가 페이지 권한을 회수 → 열려 있던 탭이 곧바로 접근 불가 화면으로 전환
- **동작 상세** `[추정]` (내부 구현 비공개, 동작 관찰과 일반적 설계에서 역산):
  - 권한 판정 결과를 `(user_id, node_id) → level`로 캐시하고 TTL + 이벤트 기반 무효화를 병행.
  - 무효화 트리거: ACL 변경, 그룹 멤버십 변경, teamspace 멤버십 변경, 페이지 이동, person 속성 값 변경(F-06-10), 정책 변경.
  - 트리 이동/ACL 변경은 **서브트리 전체**를 무효화해야 한다 → materialized path prefix 기준 일괄 무효화가 유리.
  - 검색 인덱스에는 문서마다 `acl_principals[]`(허용 principal id 목록)를 비정규화해 저장하고, 질의 시 사용자의 principal 집합과 교집합 필터를 건다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 상위 페이지 ACL 변경으로 1만 개 하위 영향 | 비동기 배치 무효화 + 낙관적 즉시 무효화(prefix) |
  | 캐시와 DB 불일치 | 쓰기 경로는 항상 DB 재판정, 읽기 경로만 캐시 |
  | 실시간 세션 중 권한 회수 | WebSocket으로 `permission_revoked` 이벤트 → 클라이언트 즉시 차단 |
  | 검색 인덱스 지연 | 인덱스 갱신 전까지 결과 노출 위험 → 결과 반환 직전 재검증(post-filter) |
  | 접근 불가 페이지 제목이 백링크/멘션에 노출 | 서버 렌더 단계에서 마스킹 |
  | 사이드바 대용량 트리 | 지연 로딩 + 노드별 권한 사전 판정 |
  | 그룹 멤버십 1건 변경으로 수만 노드 영향 | 그룹을 노드가 아닌 **principal 차원**으로 무효화 → `perm_gen:{user_id}` 세대 카운터를 올려 그 사용자 캐시 전체를 한 번에 버린다(노드별 순회 불필요) |
  | teamspace `is_default` 전환으로 전 멤버 추가 | 사용자 차원 세대 카운터를 멤버 전원에 대해 증가 + 비동기 배치 |
  | 캐시 미스 폭주(캐시 스탬피드) | 노드별 single-flight 락 또는 확률적 조기 만료 |
  | 권한 상승 방향의 지연 vs 축소 방향의 지연 | **축소는 즉시, 확대는 지연 허용**이 원칙. 축소 이벤트는 동기 무효화, 확대는 TTL에 맡겨도 안전 |
  | Custom Agent가 principal일 때(F-06-18) | 에이전트도 동일한 세대 카운터 체계로 캐시. 사람과 에이전트 판정을 같은 캐시 네임스페이스에 섞지 말 것 |
- **데이터 모델 함의**: `block.path` 또는 `block_ancestor` closure table(필수), 검색 문서의 `acl_principals[]` 필드, Redis 키 `perm:{user}:{node}` 및 **두 축의 세대 카운터** — 노드 축 `perm_ver:{node_prefix}`(트리 이동·ACL 변경용)와 주체 축 `perm_gen:{principal_id}`(그룹/teamspace 멤버십 변경용). 캐시 키를 `perm:{user}:{gen}:{node}:{ver}`로 구성하면 무효화가 **키 삭제 없이 카운터 증가만으로** 끝난다.
- **UI/인터랙션**: 접근 불가 전환 시 안내 화면, 사이드바에서 항목이 사라지는 애니메이션 `[추정]`.
- **의존 기능**: F-06-05, 검색 도메인, 실시간 동기화 도메인.
- **구현 난이도**: **XL** — 정합성(권한 누출 0)과 성능을 동시에 만족해야 하며, 검색/실시간/트리 이동 전 영역과 얽힌다. **난이도 근거를 명확히**: 이 항목이 XL인 이유는 알고리즘이 어려워서가 아니라 **무효화 트리거가 7종(ACL·그룹·teamspace·이동·person property·정책·잠금)이고 각각 다른 축으로 퍼지기 때문**이다. 하나라도 빠뜨리면 권한 누출이며, 누출은 테스트로 잡히지 않고 사고로 발견된다.
- **우선순위**: **P0**(post-filter 방식의 최소 정합성) / **P1**(캐시·인덱스 비정규화 최적화). MVP에서 캐시를 넣지 않는 것은 **성능 타협이 아니라 정합성 확보 수단**이다 — 캐시가 없으면 무효화 누락도 없다.
- **클론 시 현실적 대안**: 초기에는 캐시 없이 매 요청 DB 재판정 + 검색 결과 post-filter(가져와서 걸러내기). 문서 수 1만 이하에서는 충분하다. 그 이상이면 검색 인덱스에 `acl_principals[]` 비정규화 도입.
- **참고 출처**: https://permify.co/post/modeling-notion-access-management/ , https://www.notion.com/help/sharing-and-permissions

---

### F-06-15 접근 요청 · 승격 요청 플로우 (Request access / Request edit access / Request to add)

- **한 줄 정의**: 권한이 없거나 부족한 사용자가 스스로 요청을 보내고, 승인 권한자가 Inbox에서 승인·거부하는 비동기 권한 부여 경로.
- **사용자 시나리오**:
  1. 권한 없는 사용자가 페이지 URL을 연다 → `No access` 화면
  2. 화면의 `No access` 요소를 선택해 요청 전송 (공식: "If you open a page that you don't have access to, you can select `No access` on the page to send a request.")
  3. 요청은 **페이지의 creator/editor**에게 알림으로 전달되고, 그들의 **Inbox**에서 승인/거부한다
  4. view/comment 권한자가 편집이 필요하면 `Share` 탭의 현재 권한 드롭다운에서 `Request edit access` 선택 → 페이지 creator가 승인 또는 무시
  5. 승인되면 요청자에게 알림. 공식 안내: 즉시 반영되지 않으면 새로고침
- **동작 상세**:

  | 요청 종류 | 요청 주체 | 승인 주체 | 게이트 설정 |
  |---|---|---|---|
  | 페이지 접근 요청 | 권한 없는 사용자(비멤버 포함) | 페이지 creator / editor | `Allow page access requests from non-members` |
  | 편집 권한 요청 | view/comment 보유자 | 페이지 creator | (별도 설정 미확인 `[확인필요]`) |
  | 워크스페이스 가입 요청 | 임의 사용자 | workspace owner | `Allow any user to request to be added as a member` (Plus+) |
  | 멤버 추가 요청 | 멤버 | workspace owner / membership admin | `Allow members to request adding other members` (Plus+) |
  | 게스트 초대 요청 | 멤버 | workspace owner | `Allow members to request adding guests` (Enterprise) |
  | 게스트의 멤버 승격 요청 | 게스트 | workspace owner | `Allow page guests to request to be added as members` (Plus+) |

  - 게스트 요청 시: "once a guest submits a request to access a page, a notification will be sent to the inbox of the page's creator" — 승인 시 **레벨까지 조정해서** 승인할 수 있다.
  - 요청 상태는 `pending / approved / denied(ignored)` 3상태이며, **무시(ignore)가 정식 결말**이다(공식: "accept or ignore it") → 만료 없는 pending이 쌓이는 것을 전제로 설계해야 한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 같은 사람이 같은 페이지에 반복 요청 | `UNIQUE(node_id, requester_id, kind) WHERE status='pending'`으로 중복 억제 + 쿨다운 |
  | 요청 대기 중에 다른 경로로 권한이 생김 | 요청 자동 close(approved 아님, `superseded`) |
  | 페이지 creator가 워크스페이스를 떠남 | 승인 주체 소실 → **fallback 승인자**(가장 가까운 조상의 full access 보유자) 필요. creator 단일 지정은 취약 |
  | 페이지가 요청 대기 중에 삭제/이동 | 삭제 시 요청 자동 취소, 이동 시 승인 주체 재계산 |
  | 비멤버 요청이 정책으로 꺼져 있음 | 요청 UI 자체 미노출 + "권한 없음"만 표시 (존재 여부 노출 최소화) |
  | 요청 폭주(스팸) | 요청자·페이지별 rate limit. 공개 링크로 URL이 퍼진 페이지가 주요 표적 |
  | 요청 승인이 워크스페이스 게스트 한도를 넘김 | 승인 시점에 한도 재검증 — 요청 시점 검증만으로는 부족 |
  | 동시에 두 승인자가 서로 다른 레벨로 승인 | ACL UPSERT + broadest wins로 자연 수렴하되, 감사 로그에 둘 다 기록 |
- **데이터 모델 함의**: `access_request(id, workspace_id, kind, node_id NULL, requester_id NULL, requester_email NULL, requested_level NULL, message, status ENUM('pending','approved','denied','superseded'), decided_by, decided_at, created_at)` + 부분 유니크 인덱스(pending 중복 방지) + `notification(type='access_requested'|'access_granted', recipient_id, request_id)`. 승인자 후보 계산: `full_access를 가진 principal ∪ creator`를 가장 가까운 조상까지 탐색.
- **UI/인터랙션**: `No access` 화면의 요청 버튼, Share 탭 권한 드롭다운의 `Request edit access`, **Inbox의 요청 카드**(승인 시 레벨 선택 드롭다운 포함), 승인/거부 후 요청자에게 알림.
- **의존 기능**: F-06-01, F-06-05(승인자 탐색), F-06-11(요청 허용 정책), 알림/Inbox 도메인.
- **구현 난이도**: **M** — 상태 머신 자체는 단순하나 ① 승인자 후보 계산이 권한 트리 탐색이고 ② Inbox·알림 도메인과 결합하며 ③ 6종 요청 kind가 각각 다른 정책 게이트를 탄다.
- **우선순위**: **P1** — MVP는 "권한 없음 + 소유자 이메일 표시"로 대체 가능하지만, 공유 링크가 도는 실제 환경에서는 곧바로 필요해진다.
- **클론 시 현실적 대안**: 요청 kind를 `page_access` 1종으로 시작하고 승인 UI를 Inbox 대신 이메일 링크(승인 토큰)로 처리. 승인자는 "가장 가까운 full access 보유자 전원"으로 두면 creator 이탈 문제가 사라진다.
- **참고 출처**: https://www.notion.com/help/sharing-and-permissions (요청 원문) , https://www.notion.com/help/add-members-admins-guests-and-groups (게스트 요청 Inbox) , https://www.notion.com/help/workspace-settings (요청 허용 설정)

---

### F-06-16 페이지 잠금 · 데이터베이스 잠금 (Lock page / Lock database)

- **한 줄 정의**: ACL과 무관하게 노드의 편집을 동결하는 플래그로, 권한이 아니라 **실수 방지 장치**다.
- **사용자 시나리오**:
  1. 페이지 우상단 `•••` 클릭
  2. `Lock page` 토글 on → 즉시 모든 사람(자기 자신 포함)에게 read-only가 된다
  3. 데이터베이스에서는 `Lock database` → **구조(뷰·property)만 잠기고 데이터(행·값) 편집은 계속 허용**된다
  4. 해제는 같은 메뉴에서. 잠깐 자기만 풀었다면 상단 breadcrumb의 `Re-lock`으로 즉시 재잠금
- **동작 상세**:

  | 잠금 종류 | 잠기는 것 | 잠기지 않는 것 |
  |---|---|---|
  | Lock page | 페이지 콘텐츠 블록 전체 편집 | 열람, 댓글 `[확인필요]` |
  | Lock database | 뷰, property 정의, 정렬·필터 등 **구조** | 행 생성/삭제, property **값** 편집 |

  - **잠금은 보안 경계가 아니다**: "Anyone with full or edit access to your page can turn page lock off using the same menu." 즉 edit 이상이면 누구나 해제할 수 있다. `Can comment`/`Can view`는 잠금·해제 권한이 없다.
  - 잠금은 소유자에게도 적용된다("including you") → **주체별 예외가 없는 노드 단위 플래그**임이 확정된다.
  - 이 기능이 존재하는 이유: 템플릿·대시보드처럼 "여러 사람이 편집 권한을 가져야 하지만 레이아웃은 건드리면 안 되는" 페이지에서 권한을 낮추지 않고 구조만 보호하기 위함.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 잠긴 상태에서 편집 API 직접 호출 | 서버가 거부해야 함. 클라이언트 전용 가드로 두면 API 우회 가능 → **서버 게이트 필수** |
  | 동시편집: A가 편집 중 B가 잠금 | A의 세션에 잠금 이벤트 브로드캐스트 → 즉시 read-only 전환, 미커밋 로컬 op 처리 정책 필요(폐기 vs 마지막 커밋 허용) `[추정]` |
  | 잠긴 페이지의 하위 페이지 | 잠금은 **상속되지 않는다** `[추정]` — 하위는 별도 잠금 필요. 상속시키면 트리 전체가 얼어붙어 실사용이 어렵다 |
  | 잠긴 DB에 automation이 행을 추가 | 데이터 편집은 허용이므로 성공. **구조 변경 automation은 실패해야 함** |
  | 잠긴 페이지를 이동/삭제 | 잠금이 이동·삭제까지 막는지 정책 결정 필요 `[확인필요]`. 클론 권장: 콘텐츠 편집만 막고 트리 연산은 허용 |
  | 잠금 상태로 웹 게시 | 무관 — 공개 방문자는 어차피 편집 불가 |
  | 잠금 해제 후 곧바로 재잠금(Re-lock) | breadcrumb에 임시 해제 상태 표시가 필요(공식 UI에 존재) |
- **데이터 모델 함의**: `node_lock(node_id PK, kind ENUM('page','database'), locked BOOL, locked_by, locked_at)`. 권한 판정과 **별도 게이트**로 둔다: `can(user, node, action) = policy_gate AND acl_effective >= required AND NOT lock_blocks(node, action)`. `lock_blocks`는 action 종류로 분기(`edit_structure`는 database lock에서 차단, `edit_content`는 page lock에서만 차단). 잠금 변경은 실시간 채널로 브로드캐스트해야 하므로 노드 버전에 포함시킨다.
- **UI/인터랙션**: `•••` 메뉴의 토글, 잠긴 페이지 상단 배지 + `Re-lock` 링크, read-only 렌더(커서·핸들 제거), 잠금 해제 시 누가 잠갔는지 표시 `[추정]`.
- **의존 기능**: F-06-01(edit 이상 판정), 실시간 동기화 도메인, 블록 편집 도메인.
- **구현 난이도**: **S~M** — 플래그 자체는 하루지만, "모든 편집 경로(블록 편집·property 편집·뷰 편집·automation·API)에 게이트를 심는" 작업이 넓게 퍼진다. F-06-11과 같은 성격의 비용.
- **우선순위**: **P1** — 공유 문서에서 사고 방지 가치가 크고 구현 비용이 낮다. 권한 체계보다 먼저 넣어도 무방할 만큼 ROI가 높다.
- **클론 시 현실적 대안**: 그대로 구현 가능. 단 `Lock database`의 "구조/데이터 분리"는 action 분류(`edit_structure` vs `edit_content`)가 이미 있어야 성립하므로, F-06-01의 capability 비트 설계를 먼저 확정한 뒤 붙인다.
- **참고 출처**: https://www.notion.com/help/collaborate-within-a-workspace (lock page / lock database 동작) , https://www.notion.com/help/sharing-and-permissions

---

### F-06-17 Forms: 공개 제출과 응답자 사후 접근 권한

- **한 줄 정의**: 데이터베이스에 붙는 공개 제출 엔드포인트로, **쓰기 전용 접근**이라는 Notion 권한 모델에서 유일한 형태를 만든다.
- **사용자 시나리오**:
  1. 데이터베이스에서 form 뷰 생성 → 질문(= property) 구성
  2. `Share`에서 대상 선택: `No access` / `Anyone at {workspace} with link` / `Anyone on the web with link`
  3. 익명 응답(anonymous) on/off 선택
  4. 워크스페이스 한정 + 실명 응답이면 `Access to submission` 레벨 선택
  5. 링크 배포 → 응답자가 제출 → 응답이 DB의 새 row로 생성
- **동작 상세**:

  | 대상 | 로그인 필요 | 익명 강제 | 비고 |
  |---|---|---|---|
  | No access | — | — | 신규 제출 차단 |
  | Anyone at workspace with link | O | 선택 | 워크스페이스 멤버 + **DB 접근 권한이 있는 게스트**가 제출 가능 |
  | Anyone on the web with link | X | **강제 익명** | Notion 계정 없이 제출 가능 |

  | `Access to submission` | 제출자가 자기 응답에 대해 |
  |---|---|
  | No access | 제출 후 볼 수 없음 |
  | Can view | 열람만 |
  | Can comment | 댓글 |
  | Can edit | 응답 수정 |
  | Full access | 수정 + 그 응답 페이지의 권한 변경 |

  - **핵심**: 응답자는 DB 전체에 대한 권한 없이 **자기가 만든 row 1개에만** 권한을 갖는다. 이는 F-06-10의 `Created by → Can edit` 규칙과 같은 메커니즘이며, form은 그것을 자동 적용한 특수 케이스다 `[추정]`.
  - 공개 form은 익명이 강제되므로 `created_by`가 없다 → **사후 접근 부여 자체가 불가능**하다. 그래서 `Access to submission`은 워크스페이스 한정 + 실명일 때만 노출된다.
  - 응답 열람에는 DB에 대해 최소 `Can view`, 응답 편집에는 최소 `Can edit content`가 필요하다(공식).
  - Enterprise: `Disable publishing sites, forms and public links`로 공개 form 발행을 차단할 수 있으며, 이 설정은 Notion Sites 게시도 함께 막는다(공식).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 공개 form에 스팸 대량 제출 | rate limit + captcha 필수. **인증 없는 쓰기 엔드포인트**라 이 도메인에서 유일하게 익명 쓰기가 열리는 지점 |
  | form 질문이 참조하는 property 삭제 | 질문 무효화 또는 삭제 차단 필요 |
  | 제출 도중 DB 스키마 변경(동시편집) | 제출 payload를 서버에서 현재 스키마로 재검증, 사라진 property는 드롭하고 로그 |
  | 익명 form인데 `Access to submission` 설정 시도 | UI에서 비노출(공식 동작). 서버에서도 거부 |
  | 응답 row가 DB의 page-level rule과 충돌 | broadest wins → 응답자 권한과 rule 권한 중 높은 쪽 |
  | 응답자가 `Full access`를 받고 다른 사람을 초대 | 권한 확산 경로. 클론 기본값은 `Can view` 이하 권장 |
  | 게스트가 form 제출 | DB 접근 권한이 있는 게스트만 워크스페이스 한정 form에 제출 가능(공식) |
  | 10만 건 응답 | row 생성이 곧 페이지 생성이므로 블록 트리가 폭증 → 응답 전용 경량 row 경로 검토 `[추정]` |
- **데이터 모델 함의**: `form(id, database_id, node_id, audience ENUM('no_access','workspace_link','public_link'), anonymous BOOL, submitter_access ENUM('none','view','comment','edit','full_access'), slug, published_host)` + 제출 시 `acl_entry(node_id=새 row, principal=제출자, level=submitter_access)`를 **자동 생성**. 익명 제출은 principal이 없으므로 ACL 생성을 건너뛴다. 제출 엔드포인트는 인증 미들웨어 바깥에 두되 `form.audience`로 게이트한다.
- **UI/인터랙션**: form 뷰 빌더, Share 패널의 대상·익명·`Access to submission` 셀렉터, 공개 form 제출 화면(브랜딩), 제출 완료 후 "내 응답 보기" 링크.
- **의존 기능**: 데이터베이스 도메인(form 뷰), F-06-07(공개 링크), F-06-10(row 단위 권한), F-06-11(Enterprise 차단).
- **구현 난이도**: **M~L** — form 빌더 자체는 DB 도메인 몫이고, 권한 관점의 작업은 ① 익명 쓰기 엔드포인트의 남용 방어 ② 제출 시 ACL 자동 생성 ③ 익명/실명 분기다. 남용 방어를 제대로 하면 L에 가깝다.
- **우선순위**: **P2** — MVP 밖. 단 "외부인에게서 데이터를 받는" 유즈케이스가 목표라면 게스트보다 form이 싸게 먹힌다.
- **클론 시 현실적 대안**: 별도 form 뷰 없이 **공개 링크 + `can create` 레벨**로 근사할 수 있다(기존 row는 못 보고 새 row만 만듦). 정식 form 뷰는 v2.
- **참고 출처**: https://www.notion.com/help/forms (대상·익명·Access to submission 원문) , https://www.notion.com/help/workspace-settings

---

### F-06-18 Custom Agent 권한: 자체 권한을 가진 비인간 principal

- **한 줄 정의**: AI 에이전트가 **호출자의 권한이 아니라 자기 자신의 권한으로** 콘텐츠를 읽고 답하며, 에이전트를 공유하면 그 시야 전체가 함께 공유된다.
- **사용자 시나리오**:
  1. 사용자가 Custom Agent를 만들고 접근할 데이터 소스(페이지·DB)를 지정
  2. 에이전트를 팀에 공유 — 레벨은 `Can view and interact` / `Can edit` / `Full access`
  3. 팀원이 에이전트에게 질문 → **에이전트 자신의 접근 범위**로 답한다
  4. 결과적으로 팀원은 자기 권한으로는 볼 수 없는 정보를 에이전트를 통해 볼 수 있다
- **동작 상세**:

  | 레벨 | 가능 |
  |---|---|
  | Can view and interact | 에이전트에게 질문·작업 실행, 결과 열람 |
  | Can edit | 위 + 에이전트 지시문(instructions) 수정, 리소스 관리 |
  | Full access | 위 + 에이전트 공유, 삭제 |

  - 공식 문구 3개가 이 기능의 전부를 규정한다:
    - "Custom Agents act as specialized team members with their *own* permissions."
    - "A Custom Agent responds using *the agent's own access*, not the permissions of the person who triggered it."
    - "When you share a Custom Agent, you're giving your team access to everything the agent can see."
  - 그리고 노션 스스로 위험을 명시한다: "if the agent can see more rows than the end user, the agent may expose information the end user can't access directly."
  - **설계적 의미**: 지금까지의 모든 규칙(broadest wins, 트리 상속, 정책 게이트)은 "principal = 사람 또는 통합"을 전제했다. 에이전트는 **권한을 위임받아 대신 실행하는 주체(deputy)** 이며, 이는 confused deputy 문제를 제품 차원에서 공식화한 것이다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 에이전트 소유자의 권한이 나중에 축소됨 | 에이전트 시야도 함께 줄어야 하는가? **에이전트가 독립 principal이면 줄지 않는다** → 소유자 이탈 시 에이전트가 유령 권한을 갖는다. 클론은 **에이전트 ACL을 소유자 권한의 부분집합으로 강제 재계산**하는 배치가 필요 `[추정]` |
  | 공유받은 사람이 에이전트를 통해 비공개 데이터 열람 | 노션이 문서로 경고하는 실제 동작. 클론은 최소한 **공유 시 "이 에이전트가 접근하는 소스 N개" 프리뷰**를 강제해야 한다 |
  | `Full access` 보유자가 에이전트를 워크스페이스 전체에 공유 | 권한 확산이 한 번의 클릭으로 일어남 → 공유 확대에 확인 다이얼로그 + 감사 로그 |
  | 에이전트가 접근하던 페이지가 삭제됨 | 참조 무효화. 답변에서 stale 인용이 나오지 않도록 인덱스 동기 삭제 |
  | 에이전트가 쓰기 작업까지 수행 | 쓰기의 작성자 표기를 에이전트로(`user.type='agent'`) — 사람 이름으로 기록하면 감사가 무너진다 |
  | 정책으로 AI가 꺼진 워크스페이스 | 에이전트 실행 자체를 정책 게이트에서 차단 |
  | restricted member | 공식 문서상 Agents를 사용할 수 없다(F-06-02) |
  | 대용량: 에이전트가 10만 페이지를 시야에 둠 | 검색 인덱스에 에이전트를 별도 principal로 넣어 필터(F-06-14와 동일 메커니즘) |
- **데이터 모델 함의**: `agent(id, workspace_id, owner_user_id, name, instructions, created_at)` + `agent_source(agent_id, node_id)`(에이전트의 시야) + `agent_share(agent_id, principal_type, principal_id, level ENUM('view_interact','edit','full_access'))`. **핵심**: `acl_entry.principal_type`에 `'agent'`를 추가해 에이전트를 1급 principal로 만들면 F-06-14의 검색 필터·캐시가 그대로 재사용된다. 실행 시 권한 판정은 `effective(agent, node)`로 하고, 호출자에 대해서는 `agent_share` 레벨만 검사한다 — **두 판정을 절대 섞지 않는 것**이 이 기능의 안전성 전부다.
- **UI/인터랙션**: 에이전트 편집기(지시문·소스 선택), 공유 패널(레벨 드롭다운), 공유 시 시야 프리뷰, 답변에 인용 출처 표시.
- **의존 기능**: F-06-01, F-06-05, F-06-14(인덱스 필터), AI 도메인.
- **구현 난이도**: **L** — 권한 모델 자체는 "principal 하나 추가"로 끝나지만, 시야 관리 UI·인용 출처·소유자 권한 축소 시 재계산·감사 기록이 붙는다. AI 기능 본체는 별도 도메인.
- **우선순위**: **P2** — 클론 MVP와 무관. 단 **AI 기능을 붙일 계획이 있다면 F-06-01 단계에서 `principal_type`에 확장 여지를 남겨두는 것이 P0급 결정**이다.
- **클론 시 현실적 대안**: 에이전트를 만들지 않고 "질문자의 권한으로만 검색·답변"(impersonation 없음)하게 하면 이 위험 전체가 사라진다. 대부분의 클론에는 이쪽이 정답이다.
- **참고 출처**: https://www.notion.com/help/custom-agents-sharing-and-permissions (원문 인용 전부) , https://www.notion.com/help/whos-who-in-a-workspace

---

### F-06-19 조직(Organization) 계층과 관리자 콘텐츠 거버넌스 (Content Search · Audit Log audience)

- **한 줄 정의**: 여러 workspace를 묶는 상위 관리 경계에서, ACL을 우회하지 않는 **별도 경로**로 콘텐츠를 조회·감사하고 보안 설정을 일괄 적용한다.
- **사용자 시나리오**:
  1. 조직 owner가 `Settings → Data & Compliance → Content search`
  2. 페이지 제목 또는 페이지 ID로 검색, 또는 workspace / 생성일 / 생성자 필터로 좁힘
  3. 페이지 접근 문제를 해결하거나 거버넌스 목적으로 소재를 확인
  4. `Audit log`에서 이벤트를 workspace / 날짜 / 사용자로 필터링해 조회
  5. 보안 설정을 조직 단위로 `Enabled for everyone` / `Disabled for everyone`으로 일괄 적용
- **동작 상세**:
  - **admin 역할은 콘텐츠 접근 권한이 아니다**("Admin roles don't change what someone can see or edit in pages or databases"). Content Search는 그래서 **ACL과 분리된 관리자 도구**로 존재한다. 목적은 공식적으로 "governance of the workspace and resolve page access issues".
  - Enterprise 워크스페이스에서는 "the workspace owner could have access to the data you store in that Notion workspace, including any private pages in that workspace"가 사용자에게 고지된다 — 즉 **접근 가능성은 계약·정책 수준에서 공지되고, 기술적 경로는 admin 도구**다.
  - **Audit log의 audience 분류**(공식)가 데이터 모델상 가장 유용한 부분이다. 페이지 관련 이벤트마다 다음 4값 중 하나가 붙는다:

    | audience | 의미 |
    |---|---|
    | Private | 다른 사용자와 공유되지 않음 |
    | Shared internally | 워크스페이스 멤버와만 공유 |
    | Shared externally | 게스트 또는 integration bot과 공유 |
    | Shared to web | 웹에 게시됨 |

    → 이 4값은 **노드의 ACL 상태를 요약한 파생 필드**다. 클론에서도 `block.exposure` 같은 비정규화 컬럼으로 유지하면 "외부 공개된 페이지 전부 보기" 같은 거버넌스 쿼리가 O(1)이 된다.
  - 조직 People 탭은 여러 workspace의 멤버·게스트를 **중복 제거해 하나의 목록**으로 보여주고, 접근 관리·계정 정지·세션 지속시간 제어를 제공한다.
  - 조직 owner는 admin bot용 API 토큰을 만들어 관리 작업을 자동화할 수 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 관리자가 Content Search로 private 페이지를 열람 | **반드시 audit log에 기록**되어야 한다. 기록 없는 관리자 열람은 이 기능의 존재 이유를 무너뜨린다 |
  | audit log 자체의 조작 | append-only + 별도 보존소. 조직 owner도 삭제 불가여야 함 `[추정]` |
  | exposure 파생값과 실제 ACL의 불일치 | ACL 변경 트랜잭션 안에서 함께 갱신하거나, 이벤트 기반 재계산 + 정합성 배치 |
  | 페이지가 게스트와 공유되었다가 해제됨 | exposure를 `shared_externally → shared_internally`로 재계산. 과거 이벤트의 audience는 **그 시점 값으로 동결** |
  | 대용량: 워크스페이스 50개, 페이지 1,000만 | Content Search는 제목·ID 기준으로 제한(전문 검색 아님)하는 것이 노션의 선택 — 클론도 동일하게 좁히는 편이 현실적 |
  | 조직 정책과 workspace 정책 충돌 | 조직 설정이 승리(F-06-11) |
  | 조직에서 workspace 분리/이관 | 멤버십·정책·감사 이력의 소속 재계산 필요 `[확인필요]` |
- **데이터 모델 함의**: `organization`, `organization_member(role='org_owner')`, `org_security_policy(org_id, policy_key, mode)`, `audit_log(id, workspace_id, actor_user_id, action, target_type, target_id, audience ENUM('private','shared_internally','shared_externally','shared_to_web'), ip, at)` (append-only, 시간 파티셔닝), `block.exposure`(파생 비정규화). Content Search는 **제목·id 인덱스만** 두고 본문 인덱스는 두지 않는다(권한 없는 전문 검색은 유출 위험이 크다).
- **UI/인터랙션**: 조직 설정의 General / People / Data & Compliance 탭, Content Search 결과표(workspace·생성자·생성일 컬럼), audit log 필터 + CSV 내보내기, 보안 설정의 3상태 라디오.
- **의존 기능**: F-06-02(조직 역할), F-06-11(정책), F-06-12(SSO/감사), 검색 도메인.
- **구현 난이도**: **L** — 각 조각(검색·로그·정책 전파)은 크지 않으나 **조직이라는 계층 하나가 workspace를 전제한 모든 쿼리에 스코프를 하나 더 얹는다**. 나중에 넣으면 마이그레이션 비용이 크다.
- **우선순위**: **P2** — 단, `block.exposure` 파생 필드와 `audit_log.audience`는 **P1**로 앞당길 가치가 있다. "무엇이 외부에 열려 있는가"를 O(1)로 답할 수 없는 제품은 보안 사고에 대응할 수 없다.
- **클론 시 현실적 대안**: 조직 계층 없이 workspace 단위로 시작하고, `organization_id`를 nullable 컬럼으로만 미리 심어둔다. Content Search는 "admin 전용 제목 검색 + 열람 시 감사 기록" 만으로도 실용적이다.
- **참고 출처**: https://www.notion.com/help/organization-level-controls , https://www.notion.com/help/audit-log (audience 4분류) , https://www.notion.com/help/data-accessible-by-your-workspace-owner , https://www.notion.com/help/enterprise-admins

---

### F-06-20 페이지 이동과 권한 전이 (Private ↔ Teamspace ↔ 타 워크스페이스)

- **한 줄 정의**: 페이지를 트리의 다른 위치로 옮길 때 상속 원천이 바뀌면서 접근자 집합이 통째로 달라지는, 이 도메인에서 가장 사고가 잦은 조작.
- **사용자 시나리오**:
  1. 사이드바에서 페이지를 드래그하거나 `•••  → Move to`로 대상 선택
  2. 대상이 다른 teamspace / Private 섹션 / 다른 워크스페이스일 수 있다
  3. 이동 즉시 새 부모의 권한이 상속되고, 이전 부모 기반 접근은 소멸한다
  4. Private 섹션으로 옮기면 **그 페이지에 대한 타인의 접근이 제거**된다
- **동작 상세**:

  | 이동 종류 | 권한에 일어나는 일 |
  |---|---|
  | 같은 teamspace 내 이동 | 상속 원천 변경. 명시 ACL은 유지 |
  | teamspace A → B | A 기반 접근 소멸, B 기반 접근 발생. 명시 ACL은 유지 `[추정]` |
  | teamspace → Private | 공식: "moving a shared page to the `Private` section of your sidebar will remove everyone else's access on that page." **단 "This override will only apply to the parent page — the permissions granted for any subpages will remain the same."** |
  | Private → teamspace | teamspace 권한이 새로 상속됨 |
  | 다른 워크스페이스로 | 별개 조작. Enterprise의 `Disable duplicating pages to other workspaces`로 차단 가능 |

  - **가장 위험한 동작**: Private로 옮겨도 **하위 페이지의 명시 부여는 살아남는다**. 즉 "비공개로 돌렸다"고 믿은 사용자가 실제로는 하위 트리를 계속 노출하고 있을 수 있다. 클론은 이동 다이얼로그에서 **"하위 N개 페이지는 여전히 M명이 접근 가능"** 을 반드시 보여줘야 한다.
  - 두 번째 위험: `public_link`는 노드 로컬이라 이동해도 살아남는다(F-06-07) → 공개 페이지를 private으로 옮겨도 웹에서는 계속 열린다 `[추정 — 원문 미확인이나 데이터 모델상 불가피]`.
  - 다른 워크스페이스로의 이동은 **user/group/teamspace principal이 전부 무의미해지므로 ACL 재구성이 필수**다. 노션이 이를 "duplicating"이라 부르는 것도 사실상 복제 + 재부여이기 때문으로 보인다 `[추정]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 순환: 부모를 자기 자손 아래로 이동 | 이동 전 조상 체인 검사로 차단. closure table이면 `descendant_id = new_parent AND ancestor_id = moving_node` 존재 여부로 O(1) |
  | 이동자가 대상 위치에 대한 권한이 없음 | 이동 거부. **원본 권한 + 대상 부모의 create 권한 둘 다** 필요 |
  | 이동으로 이동자 자신이 접근을 잃음 | 경고 후 진행 허용 또는 차단. 클론 권장: 경고 + 명시 ACL 자동 부여 |
  | 동시편집: A가 이동, B가 같은 서브트리에서 권한 변경 | 서브트리 단위 직렬화(부모 노드 advisory lock)로 순서 강제 |
  | 이동 중 실패 | closure table 갱신과 parent_id 변경을 한 트랜잭션으로 |
  | 10만 노드 서브트리 이동 | closure table 갱신이 O(서브트리 × 조상 깊이) → materialized path의 prefix 치환이 훨씬 싸다. 권한 캐시는 prefix 버전 증가로 일괄 무효화(F-06-14) |
  | 이동한 페이지가 공개 게시 중 | 사이트 URL·슬러그·CDN 캐시 재계산(F-06-08) |
  | 삭제된(휴지통) 페이지를 이동 | 차단하고 먼저 복원하게 유도 `[추정]` |
- **데이터 모델 함의**: `block.parent_id` 변경 + `block_ancestor` closure 재구축(또는 `block.path` prefix UPDATE) + `acl_entry`는 **건드리지 않는다**(명시 부여는 이동과 무관하게 노드에 붙어 있음). Private 이동은 "부모를 사용자 private root로 변경"으로 표현하면 별도 개념이 필요 없다: `block(is_private_root)` + `parent_id = 사용자의 private root`. 이동 트랜잭션 종료 시 `perm_ver:{old_prefix}`와 `perm_ver:{new_prefix}` 둘 다 증가시킨다.
- **UI/인터랙션**: 사이드바 드래그, `•••  → Move to` 검색 팔레트, **이동 전 영향 프리뷰**(접근 얻는 사람 / 잃는 사람 / 여전히 접근 가능한 하위), 공개 상태 경고 배지.
- **의존 기능**: F-06-05(상속), F-06-04(teamspace), F-06-07/08(공개 상태), F-06-14(캐시 무효화), 블록 트리 도메인.
- **구현 난이도**: **L** — 트리 이동 자체는 M이지만 ① 권한 델타 프리뷰 계산 ② 서브트리 캐시 무효화 ③ 공개 링크·사이트 재계산 ④ 동시성 직렬화가 붙어 L이 된다. 초판이 이 기능을 F-06-05의 엣지 케이스 한 줄로만 다룬 것은 과소평가였다.
- **우선순위**: **P0** — 이동 자체가 제품 기본 기능이고, 이동이 권한을 잘못 옮기면 곧 정보 유출이다. 프리뷰 UI는 P1.
- **클론 시 현실적 대안**: MVP에서 이동 범위를 **같은 space 내부로만** 제한하면 권한 델타가 발생하지 않아 문제 전체가 사라진다. cross-space 이동은 v1에서 "복제 후 원본 삭제 + ACL 재구성"으로 구현하면 부분 실패 시 복구가 쉽다.
- **참고 출처**: https://www.notion.com/help/sharing-and-permissions (Private 이동 override 원문) , https://www.notion.com/help/workspace-settings (타 워크스페이스 이동 차단 설정)

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-06-01 | 액세스 레벨 체계 | M | P0 | 인증, block 트리 |
| F-06-02 | 워크스페이스 역할(owner/admin/member/guest) | M | P0 (membership admin은 P2) | 인증 |
| F-06-03 | 그룹 기반 권한 부여 | S~M | P1 | F-06-02 |
| F-06-04 | Teamspace 및 가시성 4종 | L | P1 | F-06-02, F-06-05 |
| F-06-05 | 권한 상속·오버라이드(유효 권한 계산) | **XL** | P0 | block 트리, F-06-01 |
| F-06-06 | 공유 패널(초대·링크·접근 요청) | M | P0 | F-06-01, F-06-02, 메일 |
| F-06-07 | General access(워크스페이스 전체·웹 링크·만료) | M | P0 / 웹 링크 P1 | F-06-06, F-06-11 |
| F-06-08 | 웹 게시(Notion Sites·커스텀 도메인·SEO) | **XL** | P1 | F-06-07, SSR/CDN |
| F-06-09 | 게스트 관리(한도·승격·초대 요청) | M | P1 | F-06-02, F-06-06 |
| F-06-10 | DB 세분화 권한(edit content/create/page-level rule) | L | P2 (row별 Share는 P1) | DB 도메인, F-06-05 |
| F-06-11 | 워크스페이스 보안 정책 | S~M | P2 (퍼블릭 차단은 P1) | F-06-02 |
| F-06-12 | SAML SSO / SCIM / 감사 로그 | L | P2 | 인증 |
| F-06-13 | API 연동 권한과 capability | M~L | P2 | F-06-05, OAuth |
| F-06-14 | 권한 캐시·필터링·무효화 전파 | **XL** | P0(최소 정합성) / P1(최적화) | F-06-05, 검색, 실시간 |
| F-06-15 | 접근·승격 요청 플로우 | M | P1 | F-06-01, F-06-05, F-06-11, 알림 |
| F-06-16 | 페이지/DB 잠금 | S~M | **P1** (ROI 최상) | F-06-01, 실시간 |
| F-06-17 | Forms 공개 제출·응답자 접근 | M~L | P2 | DB 도메인, F-06-07, F-06-10 |
| F-06-18 | Custom Agent 권한(자체 principal) | L | P2 (단 principal 확장성은 P0 결정) | F-06-01, F-06-14, AI |
| F-06-19 | 조직 계층·Content Search·audit audience | L | P2 (`exposure` 파생 필드는 P1) | F-06-02, F-06-11, F-06-12 |
| F-06-20 | 페이지 이동과 권한 전이 | L | **P0** | F-06-05, F-06-14, 블록 트리 |

**초판 대비 등급 조정 내역**

| ID | 변경 | 근거 |
|---|---|---|
| F-06-02 | M → **M~L** | restricted member·organization·좌석 과금(temporary 미소비) 추가로 예외 처리 범위가 넓어짐 |
| F-06-03 | S~M → **M** | 그룹 멤버십 1건 변경이 다수 서브트리 캐시를 무효화 — F-06-14와 강결합 |
| F-06-07 | 만료 P1 → **P2** | 노션에서도 유료 기능. MVP 가치 낮음 |
| F-06-11 | S~M → **M** | 금지형 외에 요청 허용형 정책 6종 + 조직 3상태 오버라이드가 추가로 확인됨 |
| F-06-20 | (신규) **L / P0** | 초판은 F-06-05의 엣지 케이스 한 줄로만 다뤘으나, 권한 델타 프리뷰·서브트리 무효화·공개 상태 재계산이 독립 작업량 |

### MVP 최소 절단선

P0만 남기면: **workspace(owner/member) + 단일 space + 페이지 트리 + 4레벨 ACL + 부모 상속 + 초대/공유 패널 + 검색 post-filter + 이동 시 권한 재계산(F-06-20)**. 여기서 게스트, 그룹, teamspace 가시성, 웹 게시, 요청 플로우, 폼, 에이전트, 조직 계층은 전부 제거해도 제품이 성립한다.

단, **제거하면 안 되는 두 가지 설계 결정**이 있다(나중에 넣으면 마이그레이션 비용이 크다):
1. `acl_entry.principal_type`을 **확장 가능한 enum**으로 둘 것 — 나중에 integration(F-06-13), agent(F-06-18)가 들어온다.
2. 관리자 권한(설정·멤버)과 콘텐츠 권한(ACL)을 **처음부터 별도 축**으로 둘 것 — 노션이 실제로 그렇게 되어 있고("Admin roles don't change what someone can see or edit"), 나중에 분리하려면 전 엔드포인트를 다시 훑어야 한다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 권한 단위 | 역할 체계 | 페이지 단위 권한 | 퍼블릭 공유 | 클론에 차용할 점 |
|---|---|---|---|---|---|
| **Outline** | Collection(컬렉션) | workspace: admin/member/viewer, collection: read/write/manage | 문서 단위 membership을 후행 도입(요청 기반 부여). 초기에는 컬렉션 단위만 | 문서 링크 공개 공유 | "그룹과 개인 양쪽 소속 시 더 강한 권한 우선" = Notion과 동일한 broadest-wins. 권한 판정을 `policies` 레이어로 중앙화한 구조가 참고 가치가 높다 |
| **Docmost** | Space | workspace: Owner/Admin/Member, space: Admin/Editor(can edit)/Viewer(can view) | **페이지 단위 권한 미지원 → 이슈로 추적 중** | 페이지 공개 링크 | Space 3역할로 시작해 페이지 상속을 회피한 절단선이 MVP 설계와 정확히 일치. 그룹은 워크스페이스 스코프 |
| **AppFlowy** | Workspace / Space | 워크스페이스·스페이스 접근 제어 + 외부 협업자용 페이지 공유 | 페이지 단위 공유 존재 | 페이지 공개 공유 | 로컬 우선 아키텍처에서 권한을 서버 측 게이트로 두는 분리 방식 |
| **Permify(모델링 참고)** | ReBAC tuple | workspace(owner/admin/member/guest/bot), page(writer/reader), block, database | `permission write = writer or workspace.write` 형태로 상속을 규칙으로 표현 | - | **상속을 재귀 SQL이 아니라 관계 규칙으로 선언**하는 접근. tuple `entity:id#relation@user:id`로 저장. 트리가 깊어질 때 SpiceDB/OpenFGA/Permify로 외부화하는 경로가 현실적 |

**차용 권고**
1. **1단계(MVP)**: Docmost 절단선을 따라 space 단위 권한 3레벨. 페이지 상속 계산 자체를 만들지 않는다.
2. **2단계(v1)**: closure table + `inherits_from_parent` 플래그로 페이지 상속 도입. 판정 함수는 Outline의 `policies`처럼 **단일 모듈**로 중앙화해 모든 엔드포인트가 그것만 호출하게 한다.
3. **3단계(v2)**: 문서 수·조직 규모가 커지면 Zanzibar 계열 엔진으로 판정을 외부화. 이때 앱은 tuple 동기화만 책임진다.

---

## 미해결 / 확인필요

### 해소된 항목 (이번 GAP 검토)

| # | 항목 | 결론 | 근거 |
|---|---|---|---|
| 3 | 커스텀 도메인 개수·가격 | **최대 25개**, 도메인당 애드온 $10/월(연간 $8/월) | help/notion-sites-availability-and-pricing |
| 4 | 접근 요청 플로우 | `No access` 화면에서 요청 → creator/editor의 **Inbox**에서 승인/무시. `Request edit access`는 Share 탭 드롭다운. 정책 토글 6종 존재 | help/sharing-and-permissions, help/workspace-settings → **F-06-15로 신설** |
| 7 | Membership admin의 콘텐츠 접근 범위 | **없음.** "Admin roles don't change what someone can see or edit in pages or databases" | help/organization-level-controls → **F-06-02·유효권한 알고리즘 정정** |
| 10 | API capability 부족 시 응답 코드 | capability 부족 = **403 `restricted_resource`**, 미공유 = **404 `object_not_found`** | developers.notion.com/reference/errors |
| — | 게스트를 그룹에 넣을 수 있는가 | **불가.** "Groups can't contain workspace guests" | help/create-and-manage-groups |
| — | 링크 만료의 플랜 | 유료 플랜. 2022-10-12 릴리스로 도입 | notion.com/releases/2022-10-12 |
| — | teamspace visibility 값 | **Open / Closed / Private 3종** + `Make default teamspace` 별개 플래그 | help/intro-to-teamspaces |

### 남은 미해결

| # | 항목 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| 1 | 상속 차단(restrict access)의 정확한 UI/의미론 | 오버라이드 구현 방식(플래그 vs ACL 스냅샷)이 결정됨. **헬프센터에 명시적 '상속 끊기' 토글이 문서화되어 있지 않음을 이번에 확인** | 실제 Notion에서 하위 페이지 Share 패널 조작 관찰 |
| 2 | Plus/Business/Enterprise 게스트 한도 수치 | 한도 초과 분기 로직·과금 설계. 무료 10명만 확인됨 | notion.com/pricing 최신 확인 |
| 5 | 중첩 그룹 지원 여부 | 권한 계산 복잡도 직결. 공식 그룹 문서에 언급 자체가 없음 | Settings → Groups 실물 확인 |
| 6 | 멤버 제거 시 그의 private 페이지 처리 | 데이터 오너십 이관 설계. **admin이 콘텐츠 권한을 갖지 않으므로 실제로 고아가 될 수 있음** | 헬프 문서 또는 실험 |
| 8 | 정책 변경 시 기존 공개 링크의 즉시 무효화 여부 | 보안 사고 대응 설계 | 실험 필요 |
| 9 | 접근 불가 row가 롤업/카운트 집계에 포함되는지 | 정보 누출 여부 | Business 플랜 실험 |
| 11 | 웹 게시 후 페이지 이동 시 URL/슬러그 처리 | 사이트 링크 안정성. 슬러그가 하위로 상속되지 않는다는 점만 확인됨 | 실험 필요 |
| 12 | 권한 변경의 실시간 전파 지연 | 클라이언트 강제 차단 UX 설계 | 두 브라우저 동시 실험 |
| 13 | Notion Sites 렌더에서 방문자 댓글 UI 노출 여부 | 공개 페이지 comment 레벨의 실제 의미 | 게시 후 로그인 상태로 방문 실험 |
| 14 | 공개 페이지를 Private으로 이동 시 public_link 유지 여부 | **정보 유출 직결**. 데이터 모델상 유지가 자연스러우나 원문 미확인 | 실험 필요 |
| 15 | `Lock page`가 이동·삭제까지 막는지 | 잠금 게이트의 action 범위 정의 | 실험 필요 |
| 16 | teamspace member의 기본 접근 레벨을 UI에서 지정하는 방식 | `default_member_access` 필드 존재 여부 | Teamspace 설정 실물 확인 |
| 17 | Custom Agent 소유자의 권한 축소 시 에이전트 시야 축소 여부 | 유령 권한 방지 설계 | Business+ 실험 |
| 18 | 게스트가 하위 페이지를 새로 생성할 때의 소유·상속 | 게스트 콘텐츠 오너십 | 실험 필요 |

---

## 정정 이력 (2026-09-06 GAP 검토)

| # | 초판 서술 | 정정 | 근거 |
|---|---|---|---|
| 1 | 유효권한 계산 1번 항: "workspace owner → 전 노드 full_access" | **삭제.** admin 역할은 콘텐츠 접근을 부여하지 않는다. 관리자 열람은 Content Search 등 **별도 admin 경로** | help/organization-level-controls |
| 2 | "빈 ACL이면 워크스페이스 owner만 접근" | **아무도 접근 불가**가 정확. 관리자 복구는 별도 도구 | 상동 |
| 3 | teamspace `visibility ENUM('default','open','closed','private')` | visibility는 **3값**, `default`는 직교 BOOL 플래그 | help/intro-to-teamspaces |
| 4 | "notion.site 도메인 워크스페이스당 1개 클레임(전 플랜)" | **무료 1개 / 유료 최대 5개** | help/notion-sites-availability-and-pricing |
| 5 | "게시된 페이지 방문자는 댓글·편집 불가" | 공개 시 **comment/edit 레벨을 줄 수 있다**(로그인 필요). 사이트 렌더에서의 댓글 UI만 `[확인필요]` | help/guides/understanding-notions-sharing-settings, help/share-your-work |
| 6 | 보안 정책 항목명(`Disable public page sharing`, `Disable guests`, `Disable move to other workspace`) | 실제 항목명은 `Disable publishing sites, forms and public links`, `Allow members to invite guests to pages`, `Disable duplicating pages to other workspaces` 등. **요청 허용형 정책 6종이 통째로 누락되어 있었음** | help/workspace-settings |
| 7 | 워크스페이스 역할 4종(owner/membership admin/member/guest) | **restricted member, temporary member, organization owner** 누락 | help/whos-who-in-a-workspace |
| 8 | "게스트를 그룹에 포함 `[확인필요]`" | **불가**로 확정 | help/create-and-manage-groups |
| 9 | "Everyone at workspace에는 검색에서 숨김 옵션이 있다"(단정) | 1차 출처 확인 실패 → `[확인필요]` 태그 부여 | — |
| 10 | `inherits_from_parent` 플래그를 노션의 구조인 것처럼 서술 | **구현 선택지**임을 명시. 문서로 확인되는 것은 "하위에서 재정의 가능" + "Private 이동 override는 부모에만 적용" 두 가지뿐 | help/sharing-and-permissions |
| 11 | 페이지 이동을 F-06-05의 엣지 케이스 한 줄로 처리 | **F-06-20으로 독립**(L / P0) | — |
| 12 | 잠금(lock) 기능 전체 누락 | **F-06-16 신설** | help/collaborate-within-a-workspace |
| 13 | Forms / Custom Agents / 조직 계층 누락 | **F-06-17 / F-06-18 / F-06-19 신설** | help/forms, help/custom-agents-sharing-and-permissions, help/organization-level-controls |

---

## 출처

1. Sharing & permissions settings in Notion — https://www.notion.com/help/sharing-and-permissions
2. Sharing & permissions (가이드) — https://www.notion.com/help/guides/sharing-and-permissions
3. Share your Notion pages — https://www.notion.com/help/share-your-work
4. Intro to teamspaces in Notion — https://www.notion.com/help/intro-to-teamspaces
5. Manage teamspaces in Notion — https://www.notion.com/help/manage-teamspaces
6. Grant the right level of access with teamspaces and groups — https://www.notion.com/help/guides/grant-access-teamspaces
7. Manage members, admins & guests in Notion — https://www.notion.com/help/add-members-admins-guests-and-groups
8. Who's who in a Notion workspace — https://www.notion.com/help/whos-who-in-a-workspace
9. Publish a website with Notion Sites — https://www.notion.com/help/public-pages-and-web-publishing
10. Publish Notion pages to the web (가이드) — https://www.notion.com/help/guides/publish-notion-pages-to-the-web
11. Assign custom database permissions — https://www.notion.com/help/guides/assign-custom-database-permissions
12. Workspace settings in Notion — https://www.notion.com/help/workspace-settings
13. SAML SSO configuration in Notion — https://www.notion.com/help/saml-sso-configuration
14. Set up your IdP for SCIM in Notion — https://www.notion.com/help/set-up-identity-provider-for-scim
15. Manage your Notion Enterprise workspace — https://www.notion.com/help/enterprise-admins
16. Notion API — Capabilities 레퍼런스 — https://developers.notion.com/reference/capabilities
17. Create integrations with the Notion API — https://www.notion.com/help/create-integrations-with-the-notion-api
18. Notion Academy — Scale your team permissions — https://www.notion.com/help/notion-academy/lesson/scale-your-team-permissions
19. Permify — Implementing Notion Authorization Model — https://permify.co/post/modeling-notion-access-management/
20. Outline — Users & groups — https://docs.getoutline.com/s/guide/doc/users-groups-cwCxXP8R3V
21. Outline — Collections — https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV
22. Docmost — Groups 문서 — https://docmost.com/docs/user-guide/groups
23. Docmost — Spaces 문서 — https://docmost.github.io/docs/user-guide/spaces/
24. Docmost — Add Page-Level Permissions system in Space (issue #531) — https://github.com/docmost/docmost/issues/531

**2026-09-06 GAP 검토에서 추가로 본문 확인한 출처**

25. Notion Sites availability & pricing (도메인 개수·커스텀 도메인 25개·가격) — https://www.notion.com/help/notion-sites-availability-and-pricing
26. Connect a custom domain to Notion Sites — https://www.notion.com/help/connect-a-custom-domain-with-notion-sites
27. Create & manage groups in Notion (게스트 그룹 제외·생성 권한) — https://www.notion.com/help/create-and-manage-groups
28. Organization-level controls in Notion (조직 계층·Content Search·정책 3상태·"Admin roles don't change what someone can see or edit") — https://www.notion.com/help/organization-level-controls
29. Data accessible by your workspace owner — https://www.notion.com/help/data-accessible-by-your-workspace-owner
30. Workspace audit log in Notion (audience 4분류) — https://www.notion.com/help/audit-log
31. Build forms in Notion (공개 제출·익명·Access to submission) — https://www.notion.com/help/forms
32. Custom Agents sharing & permissions (에이전트 자체 권한) — https://www.notion.com/help/custom-agents-sharing-and-permissions
33. Collaborate in a Notion workspace (Lock page / Lock database) — https://www.notion.com/help/collaborate-within-a-workspace
34. Notion API — Errors 레퍼런스 (403 restricted_resource / 404 object_not_found) — https://developers.notion.com/reference/errors
35. Understanding Notion's sharing settings (공개 시 comment/view/edit 선택) — https://www.notion.com/help/guides/understanding-notions-sharing-settings
36. Notion 릴리스 노트 2022-10-12 — Public pages that automatically expire — https://www.notion.com/releases/2022-10-12
37. Create, join & leave teamspaces — https://www.notion.com/help/browse-join-and-create-teamspaces
38. Can't access your own Notion page (접근 불가 화면) — https://www.notion.com/help/cant-access-my-own-page
