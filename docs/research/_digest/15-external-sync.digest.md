# 15. 외부 시스템 동기화 (Synced Databases) — 다이제스트

> 원본 `15-external-sync.md` (854줄 / F-15-01~15, 총 15개). 기준일 2026-09-06.
> **도메인 전체 판정: v2(post-MVP).** 단 `origin`/`writable`/`restorable` 스키마 축은 **MVP 시점에 확정해야 하는 되돌릴 수 없는 결정**.

## 0. 한 줄 요약
Jira/GitHub/GitLab/Asana 4종의 특정 범위를 노션 **data_source에 영속 바인딩**해 외부 항목 1개 = 노션 행 1개를 계속 유지. 기본 **단방향(외부→노션)**, Jira 5필드만 Enterprise 양방향. **수동 sync 버튼 없음**(webhook + 조회 시 하루 1회 resync). Business/Enterprise 게이팅. 09번 link preview(1회성 렌더)·임포트(1회성 복사)와 **지속성·삭제 전파·소유권 분할**에서 근본적으로 다름.

---

## 1. 기능 인벤토리 (전수 15개 — `grep -c "^### F-"`=15, 표 행 15 일치)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 | 핵심 동작 + 최악 엣지 |
|---|---|---|---|---|---|
| F-15-01 | Synced DB 컨테이너·바인딩·생성 플로우 | L | P0 | F-03-01, F-04-01, F-15-02/03/05, F-09-11 | 스키마 동기 생성 → 행 비동기 백필(페이지 이탈해도 계속, 수분~수시간). 생성 2경로: `Paste as database` / Settings→Import. **최악: 행 한도 초과 시 조용한 부분 백필** → 배지 필수 |
| F-15-02 | 커넥터 인증 (사용자 토큰 vs 관리자 토큰) | L | P0 | F-06-13, F-06-02, 14 | 레거시=개인 OAuth / Jira Sync=워크스페이스 관리자 API 토큰(scopeless 권장). GitHub org:워크스페이스=1:1. **최악: 토큰 권한 부족 → webhook 등록 실패인데 정상처럼 보이며 낡음** (`Sync failed`/`Sync stopped` 구분 필수) |
| F-15-03 | 외부 스키마 → property 매핑·제외 규칙 | L | P0 | F-03-02/04/05/14, F-15-01 | provider별 필드 카탈로그 + codec. **동명 로컬 프로퍼티는 동기화 제외(공식)**, 1000+ 값 필드 제외, 새 필드 반영 최대 12h, status는 **근사 매칭(공식)**, Jira 날짜 타임존 누락으로 하루 오차, select 옵션은 관측 기반. **최악: 대형 Jira 커스텀 필드가 프로퍼티 500개 한도 돌파** → 선택 UI 필수 |
| F-15-04 | external_id ↔ page_id 멱등 upsert | M | P0 | F-15-01/03, F-03-01/09 | 키 `(binding_id, external_id)` — **불변 id**(PROJ-123 같은 사람 키 아님). `payload_hash` 동일 시 조기 종료. **최악: 조기 종료 없으면 하루 1회 resync가 전 행 last_edited_time 갱신 → 히스토리·알림 오염** |
| F-15-05 | 증분 동기화 엔진 | **XL** | P0 | F-15-02/04, F-08-10(스케줄러·미명세), F-09-09 | 4트리거: backfill / webhook(실시간) / **view_triggered_resync(조회 시 + 하루 1회)** / schema_refresh(12h). 워터마크 `updated_since`+커서, 미지원 시 list-and-diff. **최악: 부분 실패 시 전체 롤백 → 대형 프로젝트 영원히 미완.** 05 F-05-01 all-or-nothing과 의도적으로 다른 경로 |
| F-15-06 | readonly × local 프로퍼티 공존 | M | P1(축은 P0) | F-03-16, F-15-03, F-06-16/F-03-22(축 분리), F-09-17 | `writable ∈ {readonly, write_back, local}`, `origin`과 **독립 축**. 강제 지점 4곳: 셀 UI / 공개 API / 자동화·버튼 / AI autofill. **최악: 1곳만 빠져도 로컬 값이 다음 sync에서 조용히 되돌아감** |
| F-15-07 | Identity mapping (외부 계정 ↔ 노션 user) | M | P1 | F-03-07, F-06-12(SCIM), F-07-06, 14 | 매칭: 기존 매핑 → 이메일 정확 일치(별칭 전체) → 이름 → 미해소(정상 상태). **계정 단위 캐시**. **최악: 매핑 1건 변경이 수만 행 소급 갱신** → 알림 억제(R13) + 배치 재색인(R12) 필수 |
| F-15-08 | 소스 삭제 전파 · 복원 불가 휴지통 | S | P0 | F-11-05/06, F-02-11, F-15-05, F-03-13 | 관측 2경로: 삭제 webhook / resync set-difference. **`sync_run.status='ok'`일 때만 set-difference 허용(유일 안전 불변식)**. **최악: tombstone 시 사용자가 쓴 본문 블록도 소실 + 복원 불가 = 실질 데이터 손실** |
| F-15-09 | 소스 구성 변경 대응·재임포트 | M | P1 | F-15-04/05/11 | 3종 사고: 키 rename / 사이트 URL 변경 / select 값 누락. 공식 해결은 전부 "재임포트". **최악: 키 rename 시 무증상 정지(공식 배지 없음)** → 클론은 stale 휴리스틱 필수 |
| F-15-10 | 양방향 write-back (Enterprise·5필드) | **XL** | P2 | F-15-06/07, F-06-01, F-13-18, F-05-04 | Status/Assignee/Priority/Attachments/Comments만. **사용자 본인 외부 계정 인증 AND 노션 편집권**(게스트·공개링크 불가). **최악: 외부 워크플로가 전이 거부 → 낙관 값 되돌림 필수**, 안 하면 노션만 거짓 상태 |
| F-15-11 | 동기화 상태 표면 (배지·오류·재인증) | S | P0 | F-15-05/02, F-11-08 | 배지 4종, 바인딩 단위 상태, 다중 프로젝트는 **프로젝트별 부분 실패** 표현. **최악: 같은 오류 반복 시 issue 재생성 → 알림 폭주** (`last_seen_at` 갱신으로) |
| F-15-12 | 외부 relation 재구성 | L | P1 | F-03-10/09/13, F-15-04/05 | 관계 3종(외부↔외부 동일/타 바인딩, 외부→노션 magic word·링크). 상대 바인딩 없으면 **영구 미해소(공식)**. 순서 문제 → 지연 큐. **최악: 외부에서 관계 삭제 시 사용자 수동 relation과 구분 불가하면 사용자 데이터 삭제**(R8) |
| F-15-13 | 요금제 게이팅·커넥션 거버넌스 | M | P2 | F-13-18, F-06-13, F-06-02 | Business/Enterprise, write-back은 Enterprise. Enterprise 설치 제한 3모드 + 승인 목록 + 설치자 목록 + 일괄 해제. **최악: 다운그레이드 시 바인딩 삭제 → F-15-08 복원 불가와 겹쳐 파괴적** → 동기화만 정지 + 데이터 동결 |
| F-15-14 | 동기화 충돌 처리 | M | P1 | F-15-06/10, F-05-01/04, F-12-04 | **외부가 source of truth.** 충돌 가능 지점은 `write_back` 5필드뿐(F-15-06 축의 진짜 가치). `queued→sent→confirmed\|rejected→reverted`. **최악: `sent` 상태 (page,field)를 resync가 덮어씀** → 일시 제외 또는 confirm 시 재적용 |
| F-15-15 | 해제 · detach · 데이터 잔존 | M | P1 | F-15-02/13/06, F-11-05 | 종료 3경로: 커넥션 해제(readonly 유지) / **detach(native 승격→편집 가능)** / DB 삭제. `external_row_link`는 삭제 말고 `detached_at` 보존. **최악: 커넥션 해제가 여러 바인딩에 팬아웃** → "synced DB N개가 멈춥니다" 사전 고지 |

난이도 분포 S 2 / M 6 / L 4 / XL 2.

---

## 2. 데이터 모델 (요구사항만. 정본은 `00-canonical-data-model.md`)

### 2-1. 신설 요구 엔티티 (9 + 2)
| 엔티티 | 목적 · 결정적 제약 |
|---|---|
| `external_connection` | 아웃바운드 자격증명. `UNIQUE(workspace_id, provider, external_tenant)`, `auth_mode ∈ {user_token, admin_api_token, oauth_app}`, 토큰 원문 금지→`credential_ref`. **F-06-13(인바운드 토큰)과 합치면 안 됨** |
| `external_binding` | 커넥션+범위 → **data_source 1:1**(`UNIQUE(data_source_id)`). **database가 아니라 data_source에 건다** — F-04-23 다중 DS DB에서 "Jira DS + 로컬 DS" 혼합 가능해야 함. `resource_scope jsonb`, `state ∈ {backfilling,live,failed,stopped,detached}` |
| `external_field_map` | `sync_policy ∈ {pull, pull_push, excluded}`, `value_codec`(**코드 아닌 데이터**), `excluded_reason ∈ {name_collision, unsupported_field, too_many_options, user_deselected}` |
| `external_row_link` | **이 도메인의 심장.** PK `(binding_id, external_id)` + **`UNIQUE(page_id)` 필수**. `source_version`, `payload_hash`, `tombstoned_at`, `detached_at`. `external_key`는 보관만, 매칭 미사용 |
| `sync_run` | `kind ∈ {backfill, webhook, view_triggered_resync, reconcile, schema_refresh}`, `cursor_before/after`, `status ∈ {ok, partial, failed}` |
| `sync_issue` | code 7종, severity 3종, `first_seen/last_seen/resolved_at`(중복 알림 방지) |
| `user_external_identity` | `UNIQUE(provider, external_tenant, external_account_id)`, `user_id` NULL 허용(미해소=정상) |
| `external_relation_pending` | 미해소 relation 지연 해소 큐. 상대 바인딩 없으면 영구 미해소 → TTL/상한 필요 |
| `external_write_back` | **`actor_external_account_id` 필수**(워크스페이스 봇 대리 전송 금지), `prev_value` 보관(되돌림용) |
| (+) `connection_policy`, `approved_connection` | F-15-13 거버넌스 |

### 2-2. 기존 엔티티 요구 변경 R1~R14 (원본의 실질 산출물)
| # | 대상 | 요구 | 없으면 |
|---|---|---|---|
| **R1** | `page`/`row_page` | `origin ∈ {native, external}` — boolean 아닌 **external→native 전이 가능 상태** | 삭제 전파·readonly 표현 불가, detach 불가 |
| **R2** | `property` | `origin` + `writable` **2축 독립** | "제목은 못 고치는데 우선순위는 고침" 표현 불가. **readonly는 페이지 플래그가 아니라 프로퍼티 축** — 이 도메인 최대 요구 |
| **R3** | `data_source` | DS 단위 origin + 바인딩 0..1 | database에 origin 달면 외부DS+로컬DS 혼합 불가 |
| **R4** | `block` | 외부 행의 **본문 블록은 native origin** | origin을 블록에 상속하면 외부 행에 메모 불가 = 핵심 가치 소멸 |
| **R5** | 삭제 상태 머신 | `trash_reason ∈ {user, source_deleted, source_out_of_scope}` + `restorable BOOLEAN` | "휴지통에 있으나 복원 불가"가 02·11 어느 enum에도 없음. 복원 시 재삭제 무한 루프 |
| **R6** | `user` | 이메일 별칭 다중(최대 5)이 매칭 후보 | people이 항상 미해소 텍스트 |
| **R7** | `property` | `UNIQUE(data_source_id, name)` — **이 도메인이 요구** | 공식 "동명이면 제외" 규칙의 전제. 없으면 매핑 비결정적 |
| **R8** | `relation_edge` | 지연 해소 큐 + **엣지 소유자(sync vs 사용자) 표시** | 크로스 프로젝트 링크 유실 또는 sync가 사용자 relation 삭제 |
| **R9** | `acl` | 외부 행도 통상 ACL. write-back actor = "노션 user + 그의 외부 계정" 복합 | 외부 감사 로그에 실제 행위자 미기록 |
| **R10** | 스케줄러 | resync·reconcile이 automation·반복템플릿·verification과 **동일 스케줄러 공유** (F-08-10 부재 = U-4) | 도메인마다 별도 크론 |
| **R11** | `plan_entitlement` | `synced_database.count` / `.rows` / `write_back.enabled` | 게이팅 강제 지점 산재 |
| **R12** | `search_document` | `origin` 필터 + sync → 재색인 트리거 | 대량 sync가 인덱스를 조용히 낡게 함 |
| **R13** | `notification` | 외부 origin 변경은 **기본 알림 미생성** | 하루 수천 건 알림 |
| **R14** | 버전 히스토리 | 리비전 `reason='external_sync'` 분리 + 공격적 GC | 히스토리 포화 |

### 2-3. 정본 모순(C-*)에 던지는 표
- **C-1(삭제 상태) → 다단계 상태 머신 + `restorable` 축 추가 요구.** boolean `alive`로 표현 불가.
- **C-2(행 저장) → EAV(03) 지지.** ① 프로퍼티 단위 `writable` 게이트를 제약으로 강제하려면 셀이 1급 행 ② `relation_edge` 별도 테이블이 F-15-12 지연 해소·부분 삭제에 필수. jsonb는 둘 다 앱 검증으로 밀어냄.
- **C-4(property id 타입) → 짧은 문자열 id(04) 약하게 지지** (external_field_map 디버깅). uuid여도 성립 → 약한 근거.

---

## 3. MVP 판단

**도메인 전체는 MVP에서 뺀다.** 근거: 노션 자신도 2016 출시 → Synced DB 2022-06(2.17) → write-back 2026-01(3.2). 요금제도 Business+. 클론 초기 사용자에게 Jira/GitHub 연동 수요 없음.

**그러나 MVP에서 반드시 잡아야 할 스키마 축 3개 (되돌릴 수 없음)**

| 축 | 근거 | 안 잡으면 |
|---|---|---|
| `page.origin`(전이 상태) | R1 / F-15-04 | 수십만 행 뒤 마이그레이션 |
| **`property.origin` + `property.writable`(독립 2축, 3값 enum)** | **R2 / F-15-06** | **전 쓰기 경로(셀 UI·공개 API·자동화·AI) 재검토** |
| `trash_reason` + `restorable` | R5 / F-15-08 | 삭제 상태 머신 재설계 |

부수: `relation_edge` 별도 테이블(R8), `UNIQUE(data_source_id, name)`(R7), 공유 스케줄러(R10)도 MVP 설계 시 고려.

**뺄 수 없는 것**: F-15-04(멱등 upsert — 대체 불가한 최소 코어, 틀리면 행 중복·알림 폭주), F-15-11(상태 표면 — 비용 S, "조용히 실패하는 sync는 없는 것보다 나쁘다").

**뺄 것 + 대체안 (총합 L~XL 1스프린트급으로 축소)**

| 뺄 것 | 대체안 | 효과 |
|---|---|---|
| 소스 4종 | GitHub 또는 Jira 1종 | codec·카탈로그 1/4 |
| webhook 수신 | **조회 트리거 resync 단독** | F-15-05 **XL→M**, 데이터 모델 불변(나중에 webhook 얹기 가능) |
| 전수 필드 매핑 | 화이트리스트 12~15개 + `raw jsonb` 1개 | F-15-03 **L→M** |
| write-back(F-15-10) | `Jira Status`(readonly) + `Our Status`(local) 이원화 + 딥링크 | **XL→S**, 충돌(F-15-14) 90% 원천 소멸 |
| 삭제 전파(F-15-08) | `Deleted in source` 체크박스 + 기본 필터 숨김 | 데이터 손실 위험 0, "복원 불가" UX 소멸 — **원본보다 나은 선택** |
| identity 이름 매칭 | 이메일 정확 일치 + 수동 매핑 UI | F-15-07 **M→S** (이름 매칭은 오매칭 비용>이득) |
| 거버넌스 화면 | `workspace_setting.allowed_providers text[]` | M→S. 단 **다운그레이드 데이터 동결 규칙은 처음부터** |
| detach 링크 보존 | detach만 + "재연결 시 중복 가능" 경고 | M→S |
| OAuth 3종 | 관리자 PAT 1종만 (`auth_mode` 컬럼은 유지) | F-15-02 앱 심사 비용 회피 |

**착수 순서**: `R1→R2→R5 스키마 축` → `F-15-02→01(인증·바인딩)` → `03→04(매핑·upsert)` → `05(조회트리거만)→11(엔진·표면)` → `08→15(안전장치)` → `07→12→09(가치확장)` → `10→14(선택)`

---

## 4. 기술 난제 & 권장 접근 (L/XL 6건)

| F-ID | 난도 | 왜 어려운가 | 권장 접근 | 오픈소스 참고 |
|---|---|---|---|---|
| 15-05 엔진 | XL | 4트리거 × 워터마크 × 멱등성 × 백오프 × 부분실패 재개 × 동시성 상한. **도메인 비용의 절반** | v1 조회 트리거 단독(XL→M). `updated_since`+커서, 미지원 시 list-and-diff. **부분 실패는 커서 저장 후 재개**(전체 롤백 금지). 워크스페이스별 동시 sync 상한 + 큐 | Nango/Airbyte(커서·재개·백오프), truto webhook 신뢰성(webhook=즉시성 + 주기잡=정합성), Watermark(data sync) |
| 15-10 write-back | XL | 외부 API 쓰기의 부분실패·롤백·감사 + **사용자별 자격증명**. 노션 status가 외부 워크플로 그래프를 모름 | **만들지 않는 것이 정답**(이원화+딥링크). 만든다면 `prev_value` 보관 + 낙관 롤백 + idempotency key | Unito/Getint (iPaaS 위임이 합리적) |
| 15-01 컨테이너 | L | "스키마 동기 / 행 비동기" 2단계 생성 + 진행 표면이 새 경로. 클라이언트 세션에 묶이면 안 됨 | 커넥터 자체 구현 대신 게이트웨이 위임, 클론은 `external_binding` + upsert만 소유 | Nango |
| 15-02 인증 | L | OAuth 3종+토큰 1종 수명주기, 시크릿 저장, 만료·재인증. **개인 토큰 통합은 조직에서 반드시 무너진다** | 관리자 PAT 1종부터. 재인증 시 바인딩·매핑·행링크 **보존 필수** | 노션의 Jira→Jira Sync 2세대 전환 자체가 교훈 |
| 15-03 매핑 | L | provider별 카탈로그 + codec 레지스트리 + 제외 규칙 4종 | **codec을 데이터로**(코드면 소스 추가마다 배포). select 옵션은 **관측 기반 증분 생성**. 화이트리스트 + raw jsonb | Iframely(레지스트리를 데이터로 둔 선례 — 단 언퍼링은 무상태, sync는 유상태) |
| 15-12 relation | L | 백필 순서 의존(A→B인데 B 미백필) + 엣지 소유권 + 대량 재스캔 | 지연 큐(TTL/상한). 외부↔외부 포기, **외부→노션 1방향만** | — |

**주의**: iPaaS를 참고하되 적재 대상이 일반 테이블이 아니라 **블록 트리를 가진 페이지**라는 점이 근본적으로 다름. 외부 지속 동기화를 구현한 오픈소스 노션 클론은 미확인(AppFlowy/Focalboard 참고가치 낮음) [확인필요] — 이 도메인은 클론 생태계 미개척.

---

## 5. 다른 도메인과의 접점

| 도메인 | 접점 |
|---|---|
| **00 정본 모델** | R1~R14 전체 + C-1/C-2/C-4 근거 제공 (**최우선 결정 요구**) |
| 01/05 block | R4(본문 블록은 native). F-15-05 부분 적용이 **F-05-01 all-or-nothing 규약과 다른 경로**임을 정본에 명시 필요 |
| 03 property | R2(writable), R7(이름 유일성), R8(relation_edge), F-03-04 옵션 관측 upsert, F-03-09 unique_id(magic word 앵커), F-03-14 타입 변환 |
| 04 view/DS | R3 — 바인딩은 DS 단위, F-04-23 다중 DS와 양립 |
| 06 permission | F-06-13(인바운드 토큰과 **별 테이블**), F-06-12(SCIM external_id 재사용), F-06-16/F-03-22(**잠금과 다른 축** — 같은 플래그면 사용자가 잠금 풀고 외부 필드 편집), F-06-14 권한 캐시 팬아웃 |
| 07 search | R12 — origin 필터 + 재색인 트리거 |
| 08 automation | **R10 스케줄러 공유(F-08-10 부재 = U-4)**. 자동화의 readonly 변경은 거부, 자동화 write-back은 금지 권고 [추정] |
| 09 API | F-09-11(붙여넣기 메뉴 공유), F-09-17(API 쓰기에 writable 게이트), F-09-09(webhook 서명 검증 재사용) |
| 10 AI | F-10-05/F-10-13 — AI autofill·에이전트도 writable 강제 지점 |
| 11 trash/notif | R5(복원 불가 상태), F-11-06(30일 GC), R13(알림 억제), F-11-08(오류 알림은 owner만) |
| 12 offline | readonly 셀은 오프라인 큐 진입 금지. F-12-04 LWW와 정합(단 last writer가 항상 외부) |
| 13 billing | R11 3축. F-13-18의 "단일 hasFeature()로 통합 안 됨" 결론 그대로 적용 |
| 14 account | R6(이메일 별칭), 계정 삭제 시 레거시 사용자 토큰 커넥션 전량 무효 |

---

## 6. 최우선 미해결 질문 (Q1~Q12 중 판단에 실제 영향 5개)

| # | 질문 | 왜 중요 | 권고 |
|---|---|---|---|
| 1 | synced DB 개수·행 한도 정확치 (Q1) | 백필 중단 지점·게이팅 UX가 걸림. 3자 블로그("Free 1개/100행")가 공식 "Business·Enterprise 전용"과 **상충**, 공식 출처 미발견 | **[확인필요]** 클론 자체 상수로 선언 |
| 2 | 사용자가 외부 origin 행을 노션에서 삭제하면 다음 sync가 되살리는가 (Q3) | 되살리면 "지워지지 않는 행", 안 되살리면 tombstone 정합성 붕괴. 정책 없이 F-15-04 구현 불가 | **[확인필요]** "되살림 + 안내" 권고 |
| 3 | 외부 origin 행을 다른 DB로 이동 가능한가 (Q4) | 금지 vs native 승격 택일이 **R1 전이 상태 설계를 결정** | **[확인필요]** 정책 결정 필요 |
| 4 | 재임포트 시 로컬 프로퍼티 보존 여부 (Q9) | 미보존이면 기능 자체가 무의미. "삭제 후 재생성"이 아니라 **upsert 경로 재사용**을 강제 | **[추정]** 확실시되나 명문 확인 실패 |
| 5 | sync 변경이 실시간 채널(F-05-02/F-12-04)을 타는가 (Q7) | 공식이 "새로고침하라"고 안내 → 타지 않는 경로 추정. **sync writer가 realtime broadcast를 거치는가**라는 아키텍처 분기 | **[추정]** 클론은 타게 하는 편이 낫다 |

기타: Q2(GitLab·Asana 필드 전수표 + Asana가 지속 sync인지 1회성인지 3자 자료와 상충), Q5(수동 매핑 UI 존재), Q6(크로스 프로젝트 relation 소급 해소), Q8(같은 Jira 사이트 ↔ 복수 워크스페이스), Q10~Q12(커스텀 필드 폴백 / 외부 필드 삭제 시 처리 / GitHub write-back 확대).

---

## 7. 1차 출처 (전부 notion.com 공식 — 원본 13개 중 핵심)
`help/synced-databases`(4앱·Business+ 게이팅·단방향·동명 제외·복원 불가·Paste as database) / `help/jira`(2세대 커넥션·scopeless 토큰·미지원 7필드·Enterprise 5필드 write-back·resync 하루 1회·12h 지연·1000+값 제외·첨부 5개 1MB·수동 sync 불가·배지 정의) / `help/github`(필드 전수·labels 미지원·org 1:1·magic words·identity 조건) / `help/common-jira-sync-issues`(키 rename·URL 변경·크로스 프로젝트 조건·날짜 하루 오차·status 근사 매칭) / `help/guides/synced-databases-bridge-different-tools`(읽기 전용 근거·자동 relation) / `help/enterprise-connection-settings`(설치 제한 3모드·승인 목록·일괄 해제) / `releases/2026-01-20`(3.2 write-back) · `releases/2022-06-29`(2.17 최초 출시) · `blog/synced-databases`(2022-03 예고) / `help/duplicate-delete-and-restore-content`(30일 GC) · `help/use-pages-offline`(LWW)
(2차) truto.one 웹훅 신뢰성 패턴 · Wikipedia Watermark(data synchronization)
