# 커버리지 비평 결과 (critic:coverage)

13개 도메인 문서(278 F-ID / 약 1.9MB)를 교차 검증한 결과다. **이 문서는 정본 결정(arbitration)의 입력이다.**

## 총평

이 13개 문서 묶음(278개 F-ID, 약 1.9MB)은 기능 커버리지 면에서 매우 충실하다 — 모든 기능에 '데이터 모델 함의'와 '엣지 케이스'가 빠짐없이 채워져 있고(빈 항목 0건), F-ID 상호 참조의 dangling은 278개 중 2건(10-ai-features.md의 F-10-16a/b)뿐이며, 1차 출처 인용과 [추정]/[확인필요] 태깅 규율도 상당히 잘 지켜졌다(05·06·03의 '정정 이력' 섹션은 특히 모범적이다). 따라서 이 묶음의 문제는 '무엇을 안 썼는가'보다 '13개 문서가 서로 다른 시스템을 설계하고 있다'는 데 있다.

기능 영역 누락은 3건이 실질적이다. ① 계정·인증 수명주기가 통째로 없다(가입·로그인·passkey·2FA·이메일 5개·세션·계정 삭제 — grep 0건). 06-12가 다루는 것은 Enterprise SSO/SCIM뿐이며, 나머지 12개 문서가 전부 '사용자'를 전제하면서 그 사용자의 생성·인증 모델이 정의된 적이 없다. 클론 관점에서 이것은 P0 공백이다. ② 외부 시스템 Synced Databases(GitHub/Jira/GitLab/Asana의 지속적 단방향 동기화)가 없다 — 09-11의 link preview와 09-13의 1회성 임포트로는 대체되지 않으며, 현재 행 스키마(03 page / 04 row_page)에 'external origin, read-only' 축이 없어 표현 자체가 불가능하다. ③ 데이터베이스 항목 페이지 레이아웃 빌더(pinned 15개 / 본문 모듈 / 상세 패널 / Simple·Tabbed)를 소유한 F-ID가 없고, 03 F-03-16의 `page_layout_slot.tab_id`가 정의되지 않은 테이블을 가리킨다. 그 외 워크스페이스 분석, 멀티 리전·데이터 레지던시, Trust & Safety(공개 게시·공개 폼의 남용 대응)는 중간 등급 누락이다.

그러나 클론 개발자를 실제로 멈춰 세우는 것은 16건의 문서 간 모순이다. 같은 엔티티가 문서마다 다른 스키마로 정의되어 있고 — 삭제 상태 5종, ACL 3종, 버전 스냅샷 3종, 검색 인덱스 3종, parent enum 4종, 자식 순서 컬럼명 4종 — 그중 일부는 명시적으로 상충한다. 03이 '이렇게 하면 안 된다'고 못박은 JSONB 단일 컬럼과 relation-in-jsonb를 04가 그대로 채택했고(03 F-03-01 vs 04 row_page), 04가 '[정정] 단일 FK로는 표현 불가'라고 고친 data_source 카디널리티를 03은 여전히 단일 FK로 두고 있으며, 06의 권한 알고리즘 중심 축인 상속 차단 플래그가 02의 스키마와 불변식 I2에는 존재하지 않는다. 05는 레코드 단위 pull 동기화를 확정하며 '두 모델을 섞으면 안 된다'고 경고했는데 12는 페이지 채널 push를 확정했다 — 1차 출처를 재확인한 결과 Notion에는 실제로 두 축이 모두 존재하므로, 이것은 어느 한쪽의 오류가 아니라 '클론이 아직 고르지 않은 결정'이 두 문서에 다르게 굳어버린 사례다. 여기에 같은 기능의 난이도·우선순위 불일치가 겹친다(DB 템플릿이 P0·P1·P2로 동시 분류, 잠금이 S·M·L / P1·P2로 분산, 제안 편집이 XL vs L). 이 상태로는 SYNTHESIS 단계에서 통합 데이터 모델도 단계별 로드맵도 기계적으로 도출할 수 없다.

근거 없는 단정 중 아키텍처를 흔드는 것은 두 건이다. 첫째, 06의 `inherits_from_parent` 상속 차단은 [추정] 태그가 달려 있음에도 유효권한 계산의 2번 항으로 채택되어 06의 절반과 07 F-07-07이 그 위에 서 있는데, 1차 출처 재확인 결과 헬프센터에는 'stop inheriting' 토글이 존재하지 않고 'broadest level of access'만 명시된다. 만약 차단 메커니즘이 없다면 '하위를 상위보다 좁게 만들 수 없다'가 시스템 불변식이 되며 권한 모델이 크게 달라진다. 둘째, 05가 [확인]으로 표기한 '트랜잭션은 그룹 단위로 커밋/거부된다'는 문장을 데이터 모델 블로그 재fetch에서 확정 확인하지 못했는데, 그 위에 '부분 적용은 설계상 존재하지 않는다'는 서버 쓰기 경로 불변식이 세워져 있다.

권고: 새 도메인 문서를 더 쓰기 전에 (a) 14번 도메인 '계정·인증·세션'과 15번 '외부 시스템 동기화'를 신규 작성하고, (b) 00번 '정본 데이터 모델' 문서를 만들어 block / page / property / view / acl / notification / version 7개 엔티티의 스키마를 단일 정의하고 각 도메인 문서가 그것을 참조만 하게 바꾸며, (c) 중복 소유 기능 12건(Custom Agents, Forms, Charts, Wiki, verification, AI Autofill, 잠금, webhook, DB 템플릿, MCP, Dashboard, 제안 편집)에 대해 정본 F-ID를 선언하고 나머지는 포인터로 축약해야 한다. 이 세 가지를 하기 전의 SYNTHESIS는 모순을 그대로 상속한 문서를 하나 더 만드는 결과가 된다.

## A. 누락 도메인

### A-1

[치명] 계정·인증 수명주기 도메인 자체가 없다 — 13개 문서 전체 grep 결과 '회원가입'/'signup'/'password'/'2FA'/'passkey'/'magic link' 0건. 06-permissions-sharing.md F-06-12가 Enterprise SAML SSO·SCIM만 다루고, 일반 사용자의 가입·로그인(이메일+코드 / 이메일+비밀번호 / passkey)·비밀번호 규칙(최소 8자, 고유문자 4자 이상)·계정당 이메일 최대 5개·2단계 인증 백업코드·세션과 디바이스 로그아웃·계정 삭제·다중 계정 전환이 어디에도 없다. 06의 principal, 05의 connection, 09의 API 토큰이 서로 다른 '사용자' 표현을 쓰고 있는 원인. 출처: https://www.notion.com/help/account-settings , https://www.notion.com/help/log-in-and-out , https://www.notion.com/help/passkeys , https://www.notion.com/help/two-step-verification

### A-2

[중대] 외부 시스템 Synced Databases (GitHub / Jira / GitLab / Asana) — 'synced database' 0건. 09-api-integrations.md F-09-11은 link preview/unfurl(1회성 렌더), F-09-13은 1회성 임포트만 다룬다. 지속적 단방향 동기화는 별개 서브시스템이다: 외부 origin 행(읽기 전용), external_id ↔ page_id 매핑, 사람 프로퍼티의 identity mapping, 소스에서 삭제 시 Notion 행도 휴지통 이동(복구 불가), 프로젝트 키 변경 시 재임포트 필요, Business/Enterprise 전용. 04의 row_page/03의 page 스키마에 'origin=external, read_only' 축이 없어 지금 스키마로는 표현 불가. 출처: https://www.notion.com/help/synced-databases , https://www.notion.com/help/jira , https://www.notion.com/help/github

### A-3

[중대] 데이터베이스 항목 페이지 레이아웃 빌더(help/layouts)를 소유한 F-ID가 없다 — 03-database-core.md F-03-02·F-03-16의 '[정정]' 각주와 한도표 1행으로만 존재한다. 사용자 시나리오·엣지케이스·난이도·우선순위가 없고, 특히 Tabbed 구조(Content 탭 + 관련 DB 뷰를 붙이는 추가 탭)는 완전 미명세다. F-03-16의 `page_layout_slot.tab_id`가 정의되지 않은 `layout_tab` 테이블을 가리키는 dangling FK 상태. 출처: https://www.notion.com/help/layouts

### A-4

[중간] 워크스페이스 분석(Workspace analytics) 관리자 표면 — 11-history-notifications.md F-11-04는 페이지 단위 Updates & analytics만, F-11-12는 Enterprise Audit log만 다룬다. Settings → Analytics의 Content / Search / AI / Member 탭, 365일 조회 창, 워크스페이스 owner만 Search·AI·Member 탭 접근 가능이라는 권한 축, User Engagement 지표가 없다. 검색 품질 개선(07)과 AI 크레딧 운영(10-12)의 관측성 기반이 비어 있다. 출처: https://www.notion.com/help/workspace-analytics

### A-5

[중간] 멀티 리전 · 데이터 레지던시 — '데이터 레지던시'/'residency' 0건. 12-platform-ux.md F-12-19는 단일 리전 내 Postgres 수평 샤딩만 다룬다. EU(Frankfurt)/일본/한국 리전, 조직 설정의 기본 리전 지정, 기존 워크스페이스의 리전 마이그레이션, 리전별 인제스션 파이프라인이 없다. 이는 07(검색 인덱스)·10(임베딩 인덱스)·09(웹훅 아웃바운드)가 리전 경계를 넘을 수 없다는 제약을 낳는 아키텍처 축이다. 출처: https://www.notion.com/help/data-residency , https://www.notion.com/blog/enabling-multi-region-data-systems-at-notion

### A-6

[중간] 신뢰·안전(Trust & Safety) — 'abuse'/'moderation'/'spam' 0건. 06-08(웹 게시)·13-08/09(Notion Sites)·13-01/02(공개 Forms)로 익명 사용자가 콘텐츠를 게시·제출하는 경로를 3개 만들어 놓고, 남용 신고 경로, 게시 페이지 모더레이션/테이크다운, 공개 폼의 캡차·레이트리밋·중복 제출 차단, 공개 페이지 크롤러 정책(robots/색인 제어는 13-09에 일부 있음)이 없다. 공개 표면을 가진 클론에서는 P1급 누락.

### A-7

[경미] 설정(Settings) 정보구조 레지스트리 — 12-platform-ux.md가 `user_setting(scope='account'|'device')`를 정의했으나, 계정 / 워크스페이스 / 조직 3계층에 어떤 설정 항목이 어느 계층에 속하는지의 목록이 없다. 06(security_policy)·13-18(entitlement)·11(알림 설정)·12(테마·언어)가 각자 설정을 정의하는데 통합 화면 명세가 없어 구현 시 설정이 흩어진다.

### A-8

[경미] 템플릿 마켓플레이스 수익화 — 08-templates-automation.md F-08-05에 '크리에이터 프로필은 별도 엔티티, 유료 판매 지원' 한 줄뿐. 결제·정산·환불·라이선스 모델 없음. 클론 우선순위상 낮으므로 누락 자체는 타당하나, F-08-05가 '의존 기능'에 '(판매 시) 결제'만 적어두고 넘어간 것은 명시적 스코프 아웃 선언으로 바꾸는 편이 낫다.

## B. 문서 간 모순 (정본 결정 필요)

### C-1

[삭제 상태 표현 5종] 01-block-editor.md `block.is_alive BOOLEAN` / 05-collaboration-sync.md `block.alive boolean` / 12-platform-ux.md `block.alive bool` vs 02-page-workspace.md `trashed_at + purged_at + hard_delete_after + deleted_root_id`(3상태 머신, 불변식 I7) vs 11-history-notifications.md `lifecycle text ENUM('live','trashed','retained','purged') + trash_root_id + purge_after`. 02의 I7과 11의 F-11-06(휴지통 30일 → 영구삭제 후 보존 30일 → 완전 소멸, Enterprise는 1일~10년 커스텀)은 boolean 한 컬럼으로 표현 불가능하다. 01을 정본으로 잡고 시작하면 휴지통·보존정책·GC·부분 복원이 전부 재작업된다.

### C-2

[행(row) 저장 방식] 03-database-core.md는 `page_property_value(page_id, property_id, value jsonb)` EAV를 'MVP 권고'로 명시하고 '페이지당 단일 properties jsonb'는 '프로토타입만'이라고 못박는다. 그런데 04-database-views.md의 `row_page.properties jsonb NOT NULL -- { "<property_id>": <typed value> }`가 정확히 그 '프로토타입만' 방식이다. 더 심각한 것은 relation이다 — 03은 `relation_edge` 별도 테이블을 '반드시'로 규정하며 이유를 'jsonb 배열이면 역방향 조회 불가'라고 적었는데, 04는 relation을 row_page.properties jsonb 안에 넣는다. 04 스키마로는 03 F-03-10(양방향 relation)·F-03-11(rollup 역참조)이 성립하지 않는다.

### C-3

[행의 정체성] 03-database-core.md F-03-01은 `page(id uuid PRIMARY KEY REFERENCES block(id))`로 행을 블록에 묶고 데이터 모델 함의에 '별도의 row 개념을 만들면 안 된다'고 명시한다. 04-database-views.md는 `row_page(id uuid PRIMARY KEY, ...)`를 block 참조 없이 독립 테이블로 선언한다 — 03이 금지한 바로 그것이다. 행이 블록인지 아닌지는 페이지 열기(F-04-21), 권한 상속(06 F-06-05의 parent 체인 재귀), 검색 인덱싱(07 F-07-06), 본문 블록 트리 소유가 모두 갈리는 지점이다.

### C-4

[property id 타입] 03-database-core.md `property.id uuid PRIMARY KEY` vs 04-database-views.md `property.id text, PRIMARY KEY (data_source_id, id)`. 공개 API는 짧은 문자열 property id를 쓰며(09-api-integrations.md F-09-17), F-09-16의 필터 DSL은 `property` 필드에 id 또는 name을 받는다. 03의 uuid PK는 API 계약과 어긋난다.

### C-5

[data_source ↔ database 카디널리티] 03-database-core.md `data_source.database_id uuid NOT NULL REFERENCES database(id)` 단일 FK vs 04-database-views.md의 명시적 '[정정] 한 data_source가 여러 database에 연결될 수 있으므로 단일 FK로는 표현되지 않는다 → `database_data_source` 조인 테이블 필수 (F-04-23)'. 04가 03을 정정했으나 03은 갱신되지 않아 두 스키마가 병존한다.

### C-6

[뷰별 컬럼 설정 테이블 중복] 04-database-views.md `view_property(view_id, property_id, visible, position, width, wrap, date_format, time_format, status_show_as, card_property_width_mode, calculation)` vs 03-database-core.md F-03-16 `view_property_config(view_id, property_id, visible, width, wrap, frozen, order_idx)`. 컬럼 고정(frozen)은 03에만, 날짜/시간 포맷·집계는 04에만 있다. 같은 테이블의 두 정의가 서로의 컬럼을 모른다.

### C-7

[ACL 테이블 3종 병존] 02-page-workspace.md `permission(block_id, subject_type∈{user,group,teamspace,workspace,public}, level∈{full_access,edit,edit_content,create,comment,view,none})` / 04-database-views.md `acl(object_type∈{database,data_source,page,block}, object_id, subject_type∈{user,group,workspace,public}, level 5종 — 'create'와 'none' 없음)` / 06-permissions-sharing.md `acl_entry(node_id, node_kind∈{block,teamspace}, principal_type∈{user,group,teamspace,workspace_everyone,public}, level 7종)`. principal 어휘, 레벨 집합, 대상 축(object_type vs node_kind)이 셋 다 다르다. 06이 가장 정교하지만 04의 object_type='data_source'(스키마 권한 축)를 담지 못하고, 02는 06의 workspace_everyone/restricted 개념을 모른다.

### C-8

[권한 상속 차단] 06-permissions-sharing.md는 `block_acl_meta(node_id, inherits_from_parent BOOL DEFAULT TRUE)`를 유효권한 계산의 2번 항으로 채택하고, '특정 사람만 하위 페이지에서 제외'는 상속을 끊고 ACL을 재구성하는 방식이어야 한다고 규정한다. 그런데 02-page-workspace.md의 permission 스키마와 불변식 I2('권한 확인은 parent 체인을 루트까지 올라가며 수행한다')에는 이 플래그가 존재하지 않는다. 02대로 구현하면 06 F-06-05의 핵심 시나리오가 구현 불가능하고, 06대로 구현하면 02의 I2가 거짓이 된다.

### C-9

[parent 종류 enum 4종] 01-block-editor.md `parent_table ∈ {block, space, collection}` / 05-collaboration-sync.md `parent_table ∈ {block, collection, space}` / 02-page-workspace.md `parent_type ∈ {workspace, teamspace, page_id, block_id, database_id}` / 06-permissions-sharing.md `parent_type ∈ {workspace, teamspace, block, database}`. 핵심 분기: teamspace가 block의 parent가 될 수 있는가 — 02·06은 예, 01·05는 아니오(space만). 이는 권한 재귀의 종료 조건과 트리 루트 판정을 직접 바꾼다.

### C-10

[자식 순서 표현] 01-block-editor.md는 두 방식을 비교한 뒤 '클론 권장 = 자식의 order_key fractional index'로 결론내고 `content: UUID[]` 배열을 비권장한다. 그런데 05-collaboration-sync.md는 `block.content uuid[]` + listAfter/listBefore/listRemove op를 채택하고(01이 비권장한 쪽), 12-platform-ux.md도 `content uuid[]`를 쓴다. 컬럼명도 4종이다 — 01 `order_key`, 02 `position`, 03 `order_idx`, 04 `position`. 05의 op 어휘(listAfter/listRemove)는 배열 모델을 전제하므로 01의 권고를 따르면 05의 트랜잭션 op 집합을 다시 설계해야 한다.

### C-11

[동기화 구독 단위] 05-collaboration-sync.md는 '서버는 값이나 op를 브로드캐스트하지 않는다. 버전 번호만 밀고 값은 클라이언트가 pull 한다'를 핵심으로 삼고 `sub:{record_id} -> SET<connection_id>` 레코드 단위 구독을 정의하며, '(A) pull 모델과 (B) push 모델을 섞으면 순서 보장이 무너진다'고 경고한다. 12-platform-ux.md F-12-04는 '동기화는 폴링이 아니라 push 기반: 서버가 페이지 단위 채널에 업데이트 배치를 emit'이라 서술하고 `page_channel(page_id, latest_version)` + `subscription(device_id, page_id)`를 정의한다. 1차 출처 재확인 결과 두 서술 모두 옳다 — 데이터 모델 블로그는 MessageStore가 record 구독자에게 version을 밀고 클라이언트가 syncRecordValues로 pull한다고 하고, 오프라인 블로그는 'Clients subscribe to these channels for each of their offline pages'라고 한다. 즉 Notion에는 두 축이 실재하지만, 05는 이를 [추정]으로 언급만 하고 12는 아예 인지하지 않은 채 서로 다른 pub/sub 스키마를 확정해 버렸다. 클론은 반드시 하나를 골라야 하는데 어느 문서도 결정하지 않는다.

### C-12

[버전 스냅샷 테이블 3종] 02-page-workspace.md `page_version(id, page_id, created_at, editors uuid[], snapshot bytea, kind∈{auto,restore,manual})` / 05-collaboration-sync.md `page_snapshot(id, page_id, created_at, authors uuid[], record_map jsonb, expires_at)` / 11-history-notifications.md `page_version(id, page_id, state bytea, state_vector bytea, editor_ids uuid[], byte_size, reason∈{interval,idle,pre_restore,manual}, restored_from, expires_at)`. 테이블명 2종, 저장 형식 3종(bytea 스냅샷 / jsonb record_map / CRDT state+state_vector), 편집자 컬럼명 3종(editors / authors / editor_ids), 생성 사유 enum 2종. 11만이 복원 계보(restored_from)와 GC 인덱스를 갖는다.

### C-13

[구독·알림 테이블] 05-collaboration-sync.md `page_subscription(user_id, page_id, level, PK(user_id,page_id))`, level ∈ {all_comments, replies_and_mentions, all_updates, none} 평면 4값 vs 11-history-notifications.md `subscription(id, user_id, page_id, level, source∈{explicit,auto_created,auto_edited,...}, inherit bool, UNIQUE(user_id,page_id))`, level이 페이지 종류별로 다름(일반 페이지 3값 / DB 행 4값, CHECK 제약으로 강제). 알림도 05 `notification(user_id, type, payload, discussion_id, actor_id)` vs 11 `notification(recipient_id, kind, event_ids uuid[], group_key, UNIQUE(group_key) WHERE read_at IS NULL)` — 집계(coalescing) 설계가 11에만 있고 컬럼명이 전부 다르다.

### C-14

[워크스페이스 역할 enum] 02-page-workspace.md `workspace_member.role ∈ {owner, membership_admin, member, guest}` vs 06-permissions-sharing.md `role ∈ {owner, membership_admin, member, restricted_member, guest}` + `is_temporary BOOL`(Marketplace 컨설턴트, 좌석 미소비, 최대 1년) + `status ∈ {active, invited, suspended}` + `expires_at`. 02는 restricted_member와 temporary member를 모른다. 13-18의 좌석 과금은 06의 '좌석 미소비' 규칙에 의존하므로 02 스키마로 구현하면 과금이 틀어진다.

### C-15

[필터 중첩 상한] 03-database-core.md 한도표는 'API 필터 compound 중첩 2단계까지'로 단정한다. 04-database-views.md는 같은 사실에 대해 1차 출처 두 개의 불일치(API 레퍼런스 'two levels deep' vs 헬프센터 advanced filter 'three layers deep')를 명시하고 클론 상수를 MAX_FILTER_DEPTH = 3으로 권고한다. 03만 읽은 구현자와 04만 읽은 구현자가 다른 검증 상수를 박게 된다.

### C-16

[같은 기능의 난이도·우선순위 불일치 — 로드맵 직결] 데이터베이스 템플릿: F-08-02(P0/M) vs F-03-21(P1/M) vs F-04-28(P2/M) — 같은 기능이 MVP 필수이자 '있으면 좋음'으로 동시에 분류된다. 페이지·DB 잠금: F-06-16(S/P1) vs F-02-10(S/P2) vs F-05-11(M/P2) vs F-04-25(L/P1) — 난이도 S/M/L, 우선순위 P1/P2가 모두 갈린다. 제안 편집: F-05-12(XL) vs F-11-16(L) — 두 단계 차이. Chart view: F-04-08(P2) vs F-13-10(P1). Form view: F-04-18(P2) vs F-13-01(P1). Wiki 전환: F-02-23(P2) vs F-13-12(P1). AI Autofill: F-03-20(M/P2) vs F-08-15(L/P2) vs F-10-05(L/P1). MCP 서버: F-09-19(M) vs F-10-18(L). Custom Agents는 F-08-16 / F-10-13 / F-13-15 / F-06-18 4곳에 중복 정의. 어느 문서에도 '이 기능의 정본은 X'라는 소유권 선언이 없어, 13개 문서를 기계적으로 합치면 로드맵이 성립하지 않는다.

## C. 최우선 검증 항목

### V-1

1. 권한 상속 차단 메커니즘이 실재하는가 (06-permissions-sharing.md F-06-05의 `inherits_from_parent` vs 02-page-workspace.md 불변식 I2). 1차 출처에는 'stop inheriting' 토글이 없고 'broadest level of access'만 명시된다. 실측 방법: 테스트 워크스페이스에서 부모 페이지에 사용자 A를 Can edit로 초대 → 자식 페이지 공유 패널에서 A를 제거 시도 → A의 실제 접근 결과 관찰. 추가로 teamspace 멤버·그룹·workspace everyone 경로로 들어온 접근에 대해 동일 실험. 답에 따라 acl 테이블 구조, effective() 재귀 함수, 사이드바/검색 필터(07 F-07-07의 principals[] 비정규화), 권한 캐시 무효화(06 F-06-14), 페이지 이동 시 권한 전이(06 F-06-20)가 전부 달라진다. 만약 차단 메커니즘이 없다면 '하위를 상위보다 좁게 만들 수 없다'는 것이 시스템 불변식이 되며, 이는 클론 권한 모델을 크게 단순화한다.

### V-2

2. 데이터베이스 행 저장 방식을 EAV(03-database-core.md `page_property_value`)와 JSONB(04-database-views.md `row_page.properties`) 중 하나로 확정. 03은 EAV를 MVP 권고로, JSONB를 '프로토타입만'으로 규정하고, relation은 반드시 `relation_edge` 별도 테이블이어야 역방향 조회가 된다고 못박는다. 04는 정확히 그 반대를 스키마로 확정했다. 이 결정에 프로퍼티별 인덱싱·정렬/필터 성능·셀 단위 동시편집 충돌 해소(F-03-16)·rollup 역참조(F-03-11)·프로퍼티 500개 한도·타입 변환 마이그레이션(F-03-14)이 전부 걸린다. 되돌릴 수 없는 결정 1순위이며 외부 검증이 아니라 두 문서 중 하나를 폐기하는 내부 결정으로 끝내야 한다.

### V-3

3. 실시간 동기화 모델을 레코드 단위 버전-push+pull(05-collaboration-sync.md F-05-02/F-05-20)과 페이지 채널 update-push(12-platform-ux.md F-12-04) 중 하나로 확정. 1차 출처 확인 결과 Notion은 둘 다 갖고 있다 — 데이터 모델 블로그는 'MessageStore finds client connections subscribed to those changing records, and passes on the new version... it sends a syncRecordValues API request', 오프라인 블로그는 'Clients subscribe to these channels for each of their offline pages'. 따라서 '노션을 따라간다'는 답이 성립하지 않는다. 05 스스로 '두 모델을 섞으면 순서 보장이 무너진다'고 경고했으므로, 클론이 명시적으로 하나를 고르고 나머지 문서(05의 `sub:{record_id}` 또는 12의 `page_channel`+`subscription(device_id,page_id)`)를 그에 맞춰 정정해야 한다. 전송 계층·오프라인(12 F-12-04)·presence(05 F-05-03)·협업 undo(05 F-05-15)·권한 재검사 지점(05 F-05-19)이 모두 종속된다.

### V-4

4. 삭제 상태 머신을 boolean(01/05/12)과 다단계(02 I7 / 11 F-11-06) 중 하나로 확정. 02·11이 1차 출처로 확인한 '휴지통 30일 → 영구삭제 후 보존 30일 → 소멸, Enterprise 1일~10년 커스텀'은 boolean으로 표현 불가하므로 사실상 다단계가 정답이다. 그러나 01·05·12가 `is_alive`/`alive`를 스키마에 박아둔 상태이고, 12 F-12-04의 오프라인 삭제 충돌 처리('op 적용 시 대상 페이지가 alive=false면 되살린다')가 boolean 전제로 쓰여 있다. 컬럼 하나 이름이 아니라 휴지통·복원·GC·오프라인 충돌·감사 로그가 전부 이 컬럼을 읽는다.

### V-5

5. 편집 트랜잭션의 all-or-nothing 커밋 근거 재확인 (05-collaboration-sync.md F-05-01). 서버 쓰기 경로의 원자성 계약이며 '부분 적용은 설계상 존재하지 않는다'는 강한 불변식의 유일한 근거인데, 1차 출처 재fetch에서 해당 문장을 확정 확인하지 못했다. 확인되면 [확인] 유지, 실패하면 [추정]으로 강등하고 '클론의 설계 선택'으로 재서술해야 한다. 이 불변식이 무너지면 op 루프 중간 실패 처리·낙관적 업데이트 롤백(F-05-04)·outbox 재시도 설계가 바뀐다.

### V-6

6. 데이터베이스 행이 block 테이블의 행인가 별도 엔티티인가 (03-database-core.md F-03-01 `page REFERENCES block(id)` vs 04-database-views.md `row_page` 독립 테이블). 행이 본문 블록 트리를 갖는다는 사실은 양쪽이 동의하므로, block과의 관계가 정해져야 페이지 열기(F-04-21)·권한 상속 재귀 종료 조건·검색 인덱싱 단위(07 F-07-06)·백링크(02 F-02-14)가 하나의 코드 경로로 통합된다. 03이 '별도의 row 개념을 만들면 안 된다'고 명시했으므로 04 스키마를 03에 맞추는 방향이 자연스럽다.

### V-7

7. property id 타입(uuid vs 짧은 문자열)과 동명 프로퍼티 허용 여부 (03 `uuid PK` + `UNIQUE(data_source_id,name)` vs 04 `text` + 복합 PK, 제약 없음). 09-api-integrations.md F-09-16의 필터 DSL이 property를 id 또는 name으로 참조하므로 동명 허용 여부가 쿼리 계약의 결정성을 좌우한다. 실측: 같은 이름 프로퍼티 2개 생성 시도 + API 필터에서 name 참조 시 동작 관찰.

### V-8

8. 계정·인증 도메인 신규 조사 (누락 도메인 1번). 검증이 아니라 부재의 보완이지만 우선순위가 높은 이유는 06의 principal, 05의 connection/actor, 09의 API 토큰, 12의 `user_setting(scope='account'|'device')`, 13-18의 좌석 카운터가 전부 '사용자'를 전제하는데 그 사용자의 생성·인증·세션 모델이 정의된 적이 없기 때문이다. 조사 대상: 로그인 방식 3종(이메일+코드 / 이메일+비밀번호 / passkey), 비밀번호 정책(최소 8자·고유문자 4자 이상), 계정당 이메일 최대 5개와 별칭의 로그인·공유·멘션 사용, 2단계 인증 백업코드 6개(1회용), 디바이스 로그아웃, 계정 삭제, SSO 강제 시 게스트 예외(06 F-06-12). 출처: https://www.notion.com/help/account-settings , https://www.notion.com/help/log-in-and-out , https://www.notion.com/help/passkeys , https://www.notion.com/help/two-step-verification

### V-9

9. teamspace가 block의 parent가 될 수 있는가 (parent enum 4종의 핵심 분기). 02·06은 허용, 01·05는 space만 허용. 권한 재귀의 종료 조건, 트리 루트 판정, teamspace 삭제 시 하위 페이지 처리(06 F-06-04), 사이드바 섹션 렌더가 갈린다. 문서 간 결정으로 끝낼 수 있으나 결정 전까지 06의 effective() 3번 항(teamspace 기본 권한)이 어느 경로로 계산되는지 불명확하다.

### V-10

10. 필터 중첩 상한 2 vs 3 (03 한도표 vs 04 MAX_FILTER_DEPTH=3). 04가 1차 출처 두 개의 불일치를 이미 명시했으므로 남은 일은 클론 상수를 하나로 못박고 03의 한도표를 그에 맞춰 정정하는 것. 04의 권고('읽기 경로에는 깊이 검증을 걸지 않는다')까지 함께 이관해야 한다.

## D. 부실 명세

### U-1 [high] 03-database-core.md

F-03-16 — 페이지 레이아웃 빌더의 `page_layout_slot.tab_id uuid NULL, -- Tabbed 구조일 때`가 어디에도 정의되지 않은 `layout_tab` 테이블을 참조한다. Tabbed 레이아웃은 'Content 탭 + 관련 데이터베이스 뷰를 붙인 추가 탭'이므로 tab 엔티티는 (id, data_source_id, name, kind∈{content,linked_view}, view_id, order_idx)를 가져야 하고, 탭이 참조하는 뷰가 삭제될 때·relation이 끊길 때의 처리가 필요하다. 또 '모든 페이지에 적용'이 데이터소스 전역 일괄 갱신이라는 점(뷰별·페이지별 적용 불가)이 스키마 불변식으로 명시돼 있지 않다. 레이아웃 빌더 전체가 독립 F-ID 없이 정정 각주로만 존재하는 것도 함께 해결해야 한다.

### U-2 [high] 05-collaboration-sync.md

F-05-12 제안 편집(Suggested edits)의 데이터 모델 함의가 160자로, `suggestion` 테이블 나열 + '제안 마크가 1급 시민이어야 한다'는 선언뿐이다. F-05-01이 클론 권장안으로 Yjs + y-prosemirror(페이지 1개 = Y.Doc 1개)를 못박았는데, 그 위에서 pending 제안을 어떻게 표현할지 — 별도 Y.Doc 브랜치인지, ProseMirror mark 어트리뷰트인지, CRDT 밖의 서버측 오버레이인지 — 가 비어 있다. 이 선택에 따라 '제안 수락 = 원본 문서에 op 적용'의 원자성·충돌 처리·undo 범위가 전부 달라진다. 11-history-notifications.md F-11-16(동일 기능, 난이도 L)도 이 질문을 다루지 않는다.

### U-3 [high] 06-permissions-sharing.md

F-06-03 그룹 기반 권한 부여의 데이터 모델 함의가 111자(`group`, `group_member`, principal_type='group', IN 절 1회 조회)뿐이다. 정작 비싼 경로 — 그룹 멤버 1명 추가/제거 시 (a) 유효권한 캐시 무효화 범위(F-06-14), (b) 07-search-navigation.md F-07-07이 채택한 `search_document.principals uuid[]` 비정규화 인덱스의 재색인 팬아웃, (c) 사이드바 트리 재계산, (d) SCIM 프로비저닝(F-06-12)이 그룹을 밀어넣을 때의 external_id 매핑과 대량 변경 배치 — 가 어디에도 명세되지 않았다. 그룹은 클론에서 '권한 변경 1건 → 수만 문서 재색인'을 유발하는 유일한 지점이다.

### U-4 [medium] 08-templates-automation.md

F-08-10 자동화 실행 런타임의 데이터 모델이 `automation_run(origin, depth, status, error, actor_id, idempotency_key)` 한 줄이다. 03-database-core.md 한도표가 명시한 '자동화 트리거 판정 윈도우 약 3초'를 구현할 디바운스 상태 테이블, 워크스페이스별 동시 실행 상한, 실패 재시도 백오프 스케줄, 그리고 F-08-04 반복 템플릿과 공유해야 할 타이머/스케줄러 엔티티(cron 표현, 타임존, 다음 실행 시각, 지연 실행 보정)가 없다. 자동화·반복템플릿·리마인더(11-10)·verification 만료(03-23)가 모두 같은 스케줄러를 필요로 하는데 어느 문서도 그것을 정의하지 않는다.

### U-5 [medium] 13-adjacent-products.md

F-13-18 요금제 엔타이틀먼트 엔진이 게이팅 4축과 `plan_entitlement` 설계는 훌륭하나, 좌석(seat) 수명주기가 `subscription.seats int` 한 컬럼으로 압축돼 있다. 초대 시점 vs 수락 시점 중 언제 좌석을 소비하는지, 게스트는 비소비(06-02)·temporary member도 비소비(06-02, 최대 1년)라는 규칙이 카운터에 어떻게 반영되는지, 프로레이션·트라이얼·결제 실패 grace 상태 전이, 좌석 초과 시 신규 초대 차단 지점이 없다. 06-02의 role enum과 13-18의 과금 카운터가 연결되지 않은 채 남아 있다.

### U-6 [medium] 07-search-navigation.md

F-07-06 인덱싱 파이프라인이 `search_document`를 정의하는데, 09-api-integrations.md(L432)와 12-platform-ux.md(L164)가 각각 다른 `search_index` 스키마를 별도로 선언한다. 세 스키마의 키(doc 단위가 block인지 page인지), 권한 표현(principals[] vs 없음), 버전 필드 유무가 서로 다르다. 어느 것이 정본인지, 나머지 둘이 파생 뷰인지 명시가 없다. F-07-06이 '필터 축을 나중에 추가하면 전량 재색인'이라고 경고한 만큼 스키마 단일화는 초기 결정 사항이다.

### U-7 [medium] 04-database-views.md

F-04-15 페이지네이션/가상 스크롤과 12-platform-ux.md F-12-08 대용량 DB 로딩 전략이 각각 커서/로드 규칙을 정의하는데, 09-api-integrations.md F-09-04가 정의한 '(sort_key, id) 튜플 + HMAC 서명 + TTL' 커서 계약과 정합하는지 명시가 없다. 뷰의 정렬 키가 사용자 정의 다중 키(F-04-10)이고 group by가 얹히면 커서 튜플 구성이 달라지는데, 그룹별 상위 N 로딩의 커서 표현이 어느 문서에도 없다.

### U-8 [low] 02-page-workspace.md

F-02-04 즐겨찾기의 데이터 모델 함의가 83자(전체 278개 기능 중 최단)로 `favorite JOIN block + 권한 필터`뿐이다. 사이드바 Favorites의 섹션/그룹 구분, 워크스페이스별 분리(favorite 테이블에 workspace_id는 있으나 스위칭 시 동작 미기재), 즐겨찾기한 페이지의 권한을 잃었을 때의 표시 정책, teamspace/데이터베이스 뷰도 즐겨찾기 가능한지가 없다. 12-platform-ux.md F-12-04가 `offline_action.reason='favorited'`로 즐겨찾기를 오프라인 다운로드 트리거로 쓰므로 이 테이블은 생각보다 결합도가 높다.

### U-9 [low] 01-block-editor.md

F-01-09 멀티 블록 선택이 협업 선택 공유를 `presence` 채널에 `{userId, selectedBlockIds[]}`로 브로드캐스트한다고 적었는데, 05-collaboration-sync.md의 presence 스키마는 `{focus_block_id, selection:{anchor, head}, mode}`로 필드가 다르다. 블록 다중 선택(블록 id 배열)과 텍스트 범위 선택(anchor/head)은 서로 다른 상태인데 어느 문서도 둘을 하나의 awareness 페이로드로 통합하지 않았다. F-01-05 마크다운 단축입력의 '저장 없음'도 F-01-17 undo 트랜잭션 경계에 의존한다고만 적혀 있고 '변환 취소'가 별도 op인지 undo 1스텝인지 미정.

### U-10 [low] 10-ai-features.md

F-10-16a / F-10-16b라는 존재하지 않는 F-ID를 참조한다(전체 278개 F-ID 대조 결과 유일한 dangling 참조 2건). 실제 정의된 것은 F-10-16 하나뿐이다.

## E. 미검증 주장

- 06-permissions-sharing.md F-06-05 — `block_acl_meta.inherits_from_parent` 상속 차단 플래그. [추정] 태그는 달려 있으나 유효권한 계산 알고리즘의 2번 항으로 채택되어 F-06-05·F-06-10·F-06-14·F-06-20과 07-search-navigation.md F-07-07이 전부 이 위에 서 있다. 1차 출처 재확인(https://www.notion.com/help/sharing-and-permissions) 결과: 상속 차단 토글은 문서에 존재하지 않으며, 명시된 것은 '서브페이지는 부모 권한을 물려받고, 서브페이지에서 개별 권한을 수정할 수 있다'와 'Notion respects the broadest level of access given to a user'뿐이다. 부모·teamspace·그룹·워크스페이스 경로로 들어온 접근을 하위에서 제거하는 방법은 문서에 없다.
- 05-collaboration-sync.md F-05-01 — '트랜잭션은 그룹 단위로 커밋되거나 그룹 단위로 거부된다'를 [확인]으로 표기하고 그 위에 '부분 적용은 설계상 존재하지 않는다 / 클론 서버도 op 루프 중간 실패 시 전체 롤백이어야 한다'는 서버 쓰기 경로 불변식을 세웠다. 데이터 모델 블로그를 재fetch한 결과 확인되는 문장은 'we use both before and after data to validate the changes for permissions and data coherency. If everything checks out, all created or changed records are committed to the database'이며, 'committed (or rejected) as a group'이라는 표현은 본문에서 확정 확인되지 않았다. [확인]을 [추정]으로 강등하거나 정확한 원문을 다시 특정해야 한다.
- 02-page-workspace.md 개념 계층 — 'Shared 섹션은 저장되는 컨테이너가 아니라 파생 뷰다' [추정]. 사이드바 3섹션(Teamspace/Private/Shared)의 조회 전략, 권한 필터 위치, 인덱싱 방식이 여기에 달려 있다. 파생 뷰라면 사이드바 렌더마다 '내가 접근 가능하지만 내 Private도 내 teamspace도 아닌' 집합을 계산해야 하는데, 이는 06 F-06-14의 권한 캐시 없이는 비용이 폭발한다. 두 문서가 이 결합을 다루지 않는다.
- 02-page-workspace.md 불변식 I5 vs 05-collaboration-sync.md F-05-01 — 트리 사이클 처리. 02는 'parent_id 변경 시 사이클 금지(UI에서 차단되나 문서에 명시 없음)' [추정], 05는 '서버가 사이클 검출 후 나중 op reject 또는 root로 승격'을 엣지 케이스로 제시한다. 두 문서가 서로 다른 복구 정책(사전 차단 vs 사후 검출·승격)을 제시하며 어느 쪽도 출처가 없다. 동시 이동(A: X→Y 밑, B: Y→X 밑)은 실제로 발생 가능한 시나리오이므로 정책이 하나로 정해져야 한다.
- 01-block-editor.md 핵심 개념 — rich text `text.content` 2000자, rich text 배열 100 요소, 블록 배열 100 요소, 요청당 자식 중첩 2단계 등의 한도를 '클론 검증 규칙의 출발점'으로 제시하면서, 정작 '이는 공개 API의 제한이며 앱 내부 편집기와 동일한지 확인되지 않았다(앱에서는 2000자 이상 입력이 가능해 보인다 — 실측 필요)'고 [확인필요]를 달았다. 블록 텍스트 상한을 스키마·검증기에 박은 뒤 되돌리는 것은 마이그레이션을 요구한다.
- 03-database-core.md `property` 테이블의 `UNIQUE (data_source_id, name)` — '[확인필요] 노션이 동명 프로퍼티를 실제로 막는지'. 04-database-views.md의 property 정의에는 이 제약이 없다. 09-api-integrations.md F-09-16의 필터 DSL이 `property` 필드에 id 또는 name을 받으므로, 동명 허용 여부는 쿼리 계약(name 참조가 결정적인지)을 바꾼다.
- 04-database-views.md GroupSpec — `hide_empty_groups` / `group_order` / `hidden_groups` / `text_mode` / `number_bucket` 필드명이 공개 문서에서 확인되지 않았다고 스스로 [확인필요]를 달았다. 이는 뷰 설정 JSON 계약 전체가 자체 규약이라는 뜻이며, F-04-11(그룹)·F-04-24(실시간 멤버십 재평가)·F-09-16(공개 API 쿼리)이 모두 이 계약을 공유한다. 클론 자체 규약으로 확정 선언하는 편이 낫다.
- 12-platform-ux.md F-12-04 / 05-collaboration-sync.md F-05-01 — 비텍스트 충돌 처리. 12의 '텍스트는 자동 병합, 비텍스트(DB property 등)는 하나만 저장 = 사실상 LWW'는 1차 출처로 확인된다(https://www.notion.com/help/use-pages-offline: 'While Notion attempts to automatically resolve conflicts for text-based edits, note that there are still risks associated with conflicts related to non-text edits'). 반면 05 F-05-01 엣지 표의 '이미지 등 비텍스트는 quick review 필요 [확인]'이라는 표현은 해당 원문에서 확인되지 않았다 — [확인] 태그를 근거 있는 표현으로 교체해야 한다.
- 05-collaboration-sync.md — presence 하트비트 10초. '[추정: 재브로드캐스트 주기는 Yjs 공식 문서에 수치가 없음 → 임계값(30s)의 1/3로 자체 결정)'. 동시 접속자 수에 비례해 서버 부하가 결정되는 값이라 운영 비용에 직결되지만 근거는 자체 판단이다. 클론 자체 파라미터로 명시 선언하고 부하 테스트 대상으로 넘기는 편이 낫다.
- 03-database-core.md 프로퍼티 전수표 — 'button과 verification은 UI 전용 타입, API property-object에 미노출'을 2026-09-06 대조로 확정했으나, 같은 문서 안에서 참조 API 버전이 `2026-03-11`과 `2025-09-03`로 혼재한다. 프로퍼티 타입 집합은 `property_type` enum과 F-03-14(타입 변환 매트릭스)의 정의역이므로 버전 기준을 하나로 고정해야 한다.
- 02-page-workspace.md 불변식 I9 — '한 페이지가 사이드바에 여러 번 나타날 수 있다(원 위치 + link_to_page alias N개), 그러나 소유 parent는 하나' [추정, I1+I6의 논리적 귀결]. `sidebar_alias` 테이블 전체가 이 추론 위에 있다. 사이드바 트리 조회가 소유 엣지와 표시 엣지를 UNION해야 하는지가 여기서 갈리며, 07-search-navigation.md F-07-16(사이드바 트리)이 이 이중 엣지를 반영하지 않는다.

---

## 부록: 13-adjacent-products 조사에서 나온 핵심 발견

- Notion Mail은 2026-09-22 서비스 종료 확정(공식 help 페이지 + TechCrunch/The Register 교차 확인). 노션의 설명은 '에이전트가 유능해지면서 Mail 사용자 절반 이상이 인박스를 열지 않고 메일을 처리하게 됐다'는 것. 클론에서 메일 클라이언트를 만드는 것은 원본이 직접 철회한 방향이므로 P2(비권장)로 판정했다.

- Forms는 독립 제품이 아니라 '데이터베이스의 쓰기 전용 뷰'다. 질문 1개 = DB 프로퍼티 1개로 바인딩되고 응답은 DB 행 그 자체다. 응답을 별도 테이블에 저장하면 뷰·필터·자동화·차트가 전부 이중 구현된다. 조건부 로직은 Business/Enterprise 전용.

- 무인증 쓰기 경로(공개 폼)와 무인증 읽기 경로(Sites)가 기존 권한 모델에 새 요구를 만든다: ① anonymous form-writer principal 타입 추가 ② 앱 렌더러와 분리된 공개 SSR 렌더러 + CDN 캐시. 둘 다 나중에 소급하기 매우 비싼 결정이다.

- 커스텀 이모지는 노션이 구현을 공개한 드문 사례다. rich text annotation `["‣", [["ce", CUSTOM_EMOJI_ID, WORKSPACE_ID]]]`로 @멘션과 동일 구조로 저장되고, 워크스페이스당 500개 한도, 피커는 가상화, 앱 시작 시 전량 프리페치(에지 캐시로 전환 예정). id 참조라 역인덱스가 없어 soft delete가 사실상 강제된다.

- 차트 엔진의 실제 계약: 5종(세로/가로 막대, 선, 도넛, 숫자), 그룹 최대 200개·서브그룹 50개, rollup·button·unique ID·files·리스트 반환 formula는 축으로 사용 불가. 집계는 반드시 서버 GROUP BY여야 하고, 권한 필터를 집계 이전에 적용하지 않으면 볼 수 없는 행이 합계로 유출된다.

- Dashboard view는 Business/Enterprise 전용, 위젯 최대 12개(행당 4개), global filter는 property_id가 아니라 (이름, 타입) 쌍으로 여러 DB에 매칭돼야 크로스 소스가 성립한다. 클론에서는 'column layout + linked view'로 80% 대체 가능하다.

- 커스텀 도메인은 노션이 유일하게 별도 SKU로 떼어낸 기능이다($10/월, 연 결제 $8/월, 최대 25개). DNS는 CNAME → `external.notion.site.` + TXT 검증, apex 불가(서브도메인 필수), Cloudflare Proxy는 반드시 꺼야 함. 클론은 Cloudflare for SaaS 등에 위임하면 L→M.

- Notion Calendar는 별도 앱이지만 데이터는 노션 DB다. date 프로퍼티 필수, 최대 20개 DB 연결, formula/created time 기반 date는 읽기 전용. 클론은 독립 앱 대신 '멀티 DB 캘린더 뷰 + 읽기 전용 ICS 오버레이'로 90%를 XL→M 비용에 재현할 수 있다.

- 에이전트 계보: 2025-09-18 노션 3.0(개인 Agent, 20분+ 다단계) → 2026-02-24 노션 3.3 Custom Agents(스케줄/이벤트 트리거, 팀 공유, 자체 권한 principal, 2026-05-04부터 크레딧 과금). 모든 에이전트 쓰기가 agent_action으로 기록되고 하나의 undo 단위로 되돌려지지 않으면 조직 배포가 불가능하다.

- 요금제 게이팅은 성격이 다른 4개 축(기능 온오프 / 개수 한도 / 기간 한도 / 사용량 크레딧)이며 강제 지점이 각각 UI+API / 생성 트랜잭션 / 조회·GC 잡 / 실행 런타임으로 전부 다르다. 단일 hasFeature() 헬퍼로 통합하려는 설계는 실패한다. 엔타이틀먼트는 코드가 아니라 데이터(plan_entitlement 테이블)여야 한다.

- 임베드는 노션 자체 위젯 시스템이 아니라 Iframely에 위임한 1,900+ 도메인 언퍼링이다. 클론도 provider 레지스트리를 코드가 아닌 데이터로 두거나 상용 언퍼링 API에 아웃소싱하면 유지보수가 사라진다.

- Wiki는 새 엔티티가 아니라 'page 플래그 + 자동 생성 data source'의 합성이다(Home / All pages / Pages I own 3뷰 + Owner/Tags/Verification 프로퍼티). Verification은 Business/Enterprise 전용이고, owner 최소 1명이 전제이며, 만료 시 검색·AI 답변 우선순위를 잃는다 — 즉 검색 랭킹 파이프라인에 is_verified 부스트를 실어야 단순 배지를 넘어선다.
