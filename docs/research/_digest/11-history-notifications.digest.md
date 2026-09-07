# 11. 버전 히스토리 · 알림 · 활동 — SYNTHESIS 다이제스트

> 원본: `C:/VibeCoding/notion/docs/research/11-history-notifications.md` (1268줄, 3차 GAP 완료본)
> 기능 수 검증: 원본 `### F-` 헤딩 **19개** = 아래 인벤토리 행 **19개** (일치)
> 스키마 정본은 `00-canonical-data-model.md`. 여기서는 "이 도메인이 무엇을 요구하는가"만 기술한다.

## 도메인 한 줄 정의

**"쓰기(write)를 되돌릴 수 있게 만들고, 남의 쓰기를 나에게 전달하는" 계층.** 6개 서브시스템(버전 히스토리 / 휴지통·보존 / 알림 / 활동로그 / 편집리뷰·자동화 / 경량이력·데이터수명)이 **하나의 이벤트 스트림(`activity_event`)** 을 공유한다. 설계 핵심은 **이 스트림을 한 번만 만들고 여러 방향으로 소비**하게 하는 것.

---

## 1. 기능 인벤토리 (전수 19개)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-11-01 | 페이지 버전 히스토리 (스냅샷 기록·조회) | L | P1 | 블록 트리, CRDT 협업 동기화, 권한 |
| F-11-02 | 버전 복원 (Restore) | M | P1 | F-11-01, 편집 권한, 페이지 lock |
| F-11-03 | 버전 보관 기간 정책 & 히스토리 GC | M *(1차 S→상향)* | P2 | F-11-01, 플랜 모델, WS 설정 |
| F-11-04 | 페이지 활동 피드 (Updates & analytics) | L | P2 | activity_event, 코멘트, 권한, 사용자 프로필 |
| F-11-05 | 휴지통 (삭제·조회·복원) | M | **P0** | 블록 트리+부모자식, 권한, 검색 |
| F-11-06 | 영구 삭제 & 커스텀 데이터 보존 정책 | M | P2 | F-11-05, 관리자 설정, 파일 스토리지 |
| F-11-07 | 인박스 (알림 목록·필터·읽음/보관) | M | **P0** | F-11-08, 권한, WebSocket |
| F-11-08 | 알림 생성 규칙 엔진 (멘션·답글·할당·초대) | L | **P0**(멘션·답글) / P1(나머지) | 코멘트, 멘션 인라인노드, 권한, Person property, F-11-09 |
| F-11-09 | 페이지 구독(Follow) & 페이지별 알림 레벨 | M | P1 | F-11-07/08, 페이지 트리(조상 조회) |
| F-11-10 | 리마인더 (`@remind` · Date property) | M | P2 | 멘션 노드, 날짜 파서, F-11-11, 사용자 tz |
| F-11-11 | 알림 채널 팬아웃 (인앱·데스크톱·모바일·이메일·Slack) | **XL** | P1(인앱·이메일) / P2(푸시·Slack) | F-11-07/08, APNs/FCM/SES, presence |
| F-11-11b | Slack 채널 연동 (페이지 → Slack 브로드캐스트) | M | P2 | F-11-04, F-11-09(상속), Slack OAuth |
| F-11-12 | 워크스페이스 감사 로그 & SIEM 스트리밍 | **XL** | P2 | 조직/WS/teamspace 모델, 전 도메인 이벤트 훅 |
| F-11-13 | 외부 통합용 이벤트 웹훅 (Public API Webhooks) | L | P2 | 공개 API, integration/OAuth, activity_event |
| F-11-14 | 실행 취소(Undo)와 히스토리의 경계 | M *(1차 S→상향)* | **P0** | 에디터 상태, F-11-01, F-11-05 |
| F-11-15 | 블록 단위 편집 이력 (`created_by`/`last_edited_by`) | S | **P1** *(스키마 1일차)* | 블록 트리, 사용자 모델, (노출 시) DB property |
| F-11-16 | 제안 편집 (Suggested edits) | L *(decoration 없으면 XL)* | P2 | 코멘트 스레드, `Can comment` 권한, CRDT+decoration, lock, F-11-07/08 |
| F-11-17 | 자동화 기반 알림 (Database automations) | L *(알림 액션만이면 M)* | P2 *(PM 용도면 P1)* | DB/property, F-11-07/08/11/11b, 스케줄러, 플랜 모델 |
| F-11-18 | 활동·알림 데이터 수명 & 조회 기록 프라이버시 | M | **P1** *(스키마 1일차)* | F-11-04, F-11-07, F-11-06 |

---

## 2. 이 도메인이 요구하는 데이터 모델 (요구사항만, 스키마 창작 금지)

### 2.1 다른 도메인의 엔티티에 **요구하는 필드**

| 대상 엔티티 | 요구 필드 | 요구하는 기능 | 왜 필수인가 |
|---|---|---|---|
| `block` | `created_by`, `created_at`, `last_edited_by`, `last_edited_at` | F-11-15 | **나중에 넣으면 백필 불가.** 과거 편집자를 알 방법이 없다. FK에 `ON DELETE SET NULL` 금지(이력 증발) |
| `block` | `lifecycle`('live'/'trashed'/'retained'/'purged'), `trashed_at`, `trashed_by`, `trash_root_id`, `purge_after` | F-11-05/06 | 공개 API `DELETE /v1/blocks/{id}`가 `in_trash:true`를 만든다 → **soft delete는 전 블록에**, 휴지통 UI만 page 타입 필터. 나중에 넣으면 모든 조회 쿼리 수정 |
| 페이지 트리 | 조상 조회 구조 (closure table 또는 `ltree`) | F-11-05(삭제 전파), F-11-09(구독 상속) | 두 기능이 공유. 나중에 도입 시 두 기능 동시 재작성 |
| `file_object` | `refcount`에 `page_version`도 포함 | F-11-02/03/06 | 버전 blob 수명이 첨부 파일 수명의 **하한**. 아니면 복원 시 첨부가 깨진다 |
| 사용자 | timezone, presence(활성 페이지) | F-11-10, F-11-11 | 리마인더 해석 기준 / "보고 있으면 알림 안 보냄" |

### 2.2 이 도메인이 **새로 요구하는 엔티티** (역할만 기술)

| 엔티티 | 역할 | 핵심 제약 |
|---|---|---|
| `doc_update` | CRDT 증분 바이너리, append-only, 고빈도 | `UNIQUE(page_id, seq)` |
| `doc_snapshot` | 머지된 현재 정본 | 타임스탬프 기반 원자적 UPSERT |
| `page_version` | 사용자 노출 버전 (10분/2분 규칙) | `reason`('interval'/'idle'/'pre_restore'/'manual'/'restore'), `editor_ids[]`, `expires_at`, `restored_from`. **목록 조회 시 state blob 제외 SELECT 가능해야 함** |
| `workspace_retention_policy` | 휴지통일수(1~3650), retained일수, 버전보관일수(NULL=무제한) | **NULL을 0으로 캐스팅하면 전량 즉시 파기** → 타입 레벨 Option 강제 |
| `activity_event` | 제품 기능용 이벤트 버스 (사용자에게 보임) | 월 파티셔닝. `audit_event`와 **반드시 분리**(보관·권한·PII·삭제정책 전부 다름) |
| `page_view` / `page_view_daily` | 조회 로그 원본 + 일별 롤업 | 편집 이벤트의 10~100배 볼륨 → **절대 activity_event와 같은 테이블 금지** |
| `subscription` | 페이지 팔로우 + 레벨 | `UNIQUE(user_id,page_id)`. **레벨 허용값이 페이지 종류별로 다름 → CHECK 제약**. 일반: `all_comments`/`replies_and_mentions`/`none`. DB행: `all_updates`/`important_updates`/`replies_and_mentions`/`none`. `source`: explicit/auto_created/auto_edited |
| `notification` | 수신자별 알림 1건 | `group_key` 집계, `event_ids[]`, `read_at`/`archived_at`. 파티셔닝 불가(미읽음 무기한) |
| `notification_delivery` | **알림 1 : 배송 N** 채널 팬아웃 | `state`(pending/suppressed/sent/failed), `scheduled_at`(디바운스 만료), `suppress_reason` |
| `user_notification_counter` | 배지 미읽음 카운터 | `COUNT(*)` 금지, 트랜잭션 내 증감 |
| `reminder` | 스케줄링용 정규화 행 (블록 인라인 노드의 복제) | `target_at` UTC + `timezone` 별도. `fired_at IS NULL` 조건부 UPDATE로 at-most-once |
| `suggestion` | 본문에 커밋되지 않은 대기 변경 | `anchor` = **CRDT relative position**(절대 offset 금지), `original` 스니펫, `state`(open/accepted/rejected/**stale**) |
| `person_property_setting` | `notify_on_assign` — 사용자가 아니라 **property에 붙는 스위치** | 개별 사용자가 끌 수 없음(공식) |
| `automation` / `automation_trigger` / `automation_action` / `automation_run` | 자동화 정의 + 실행 이력 | `created_by` = **실행 권한 기준(권한 상승 통로)**. `automation_run` 없으면 "왜 알림이 안 왔나"를 영원히 디버깅 불가 |
| `automation_notification_source` | 알림 → 자동화 역추적 + 재진입 차단 | `run_id` 컨텍스트 전파 |
| `pending_trigger` | 3초 창 구현용 버퍼 | `first_seen_at+3s`에 현재값 vs before_value 재비교 |
| `audit_event` | 컴플라이언스 로그 (관리자 전용) | append-only(DB 계정에서 UPDATE/DELETE 권한 제거), 월 파티션, 365일, **본문 절대 미포함/audience만**, 멱등키 `(actor,type,target,occurred_at)`. **애플리케이션 DB와 다른 스토리지 권장** |
| `siem_webhook` / `siem_delivery` | WS당 1개, 7회 재시도 | |
| `webhook_subscription` / `webhook_delivery` | 외부 통합 웹훅 | 전송 직전 `accessible_by` 재판정 |
| `slack_connection` / `page_slack_binding` | Slack OAuth + 페이지 바인딩 | `include_children` 상속 |
| `activity_retention_policy` / `user_privacy_setting` / `page_view_optout` | 데이터 수명·조회 옵트아웃 | Notion에 관리자 UI 없음 = **클론이 스스로 정해야 하는 정책** |
| `device_token`, `user_presence`, `user_notification_preference` | 채널 팬아웃 부속 | presence는 Redis 권장 |

### 2.3 도메인 전역 불변식 (위반 시 사고)

1. soft delete 조건(`lifecycle='live'`)은 **뷰 또는 ORM 글로벌 스코프로 강제** — 한 쿼리라도 빠지면 삭제 콘텐츠 유출.
2. 구독 기본값은 **가장 조용한 쪽**. NULL을 `all_updates`로 해석하면 워크스페이스 알림 폭탄.
3. 알림 발송은 **예약 시점이 아니라 발송 직전에 권한 재검증** — 이 창(최대 5분)이 도메인 최대 정보 유출 지점.
4. 자기 행위는 자기에게 알림 생성 금지(리마인더 제외) — 알림 루프 차단 장치.
5. 페이지 파기 시 `activity_event`/`page_view`/`notification`/`subscription` 연쇄 정리. **단 `audit_event`는 예외**(삭제 사실 자체가 기록 대상).

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 하는 것 (P0 4종)

| F-ID | 근거 |
|---|---|
| **F-11-05 휴지통** | "삭제하면 영영 사라짐"은 노트 앱에서 허용되지 않는다. 게다가 `block.lifecycle`은 **나중에 넣으면 모든 조회 쿼리를 다시 고쳐야** 한다 |
| **F-11-07 인박스** | 멘션했는데 상대가 모르면 협업이 성립하지 않는다. MVP 범위는 "멘션 + 코멘트 답글"만 |
| **F-11-08 알림 생성 규칙(멘션·답글 2종만)** | 위와 세트. 트리거 2종만 하드코딩 |
| **F-11-14 Undo** | 에디터의 기본 기대치. 프레임워크 내장 history 플러그인 + Yjs `UndoManager(trackedOrigins)` |

→ **MVP 최소 조합 = F-11-05 + F-11-07 + F-11-08(2트리거) + F-11-14.** 이 넷이 빠지면 "삭제하면 복구 불가, 멘션해도 안 알려짐" 상태.

### 3.2 "기능은 P2인데 스키마는 1일차"인 것 — 이 도메인 최대 함정

| 항목 | 나중에 넣으면 왜 불가능한가 | 1일차에 넣을 최소분 |
|---|---|---|
| F-11-15 `created_by`/`last_edited_by` | **과거 편집자 백필 불가.** 이력은 소급 생성 불가능한 유일한 데이터 | 컬럼 4개만. DB property 노출은 v2 |
| F-11-18 `activity_event`/`page_view` 파티셔닝 | 수억 행 무중단 파티션 전환은 사실상 불가 | 월 파티셔닝 + 보관정책 스키마. 옵트아웃 UI는 P2 |
| F-11-05 `block.lifecycle` | 모든 조회 쿼리 재수정, 하나만 빠져도 유출 | 컬럼 + 글로벌 스코프 |
| F-11-09 조상 조회 구조 | F-11-05·F-11-09 동시 재작성 | closure table 또는 ltree 확정 |

### 3.3 빼도 되는 것 + 대체안

| 뺄 것 | 이유 | 대체안 |
|---|---|---|
| F-11-01/02 전체 복원 | MVP에 없어도 제품은 동작 | **"과거 버전 열어서 블록 복사 → 붙여넣기"만** 지원(Notion 공식 안내 경로). 구현비 ≈ 0, 실사용 복구율은 높음 |
| F-11-03 플랜별 보관 정책 | 클론에 과금 티어 없음 | 워크스페이스 설정 **숫자 하나(days)** 또는 상수 30일 |
| F-11-04 Analytics(조회수) | 별도 집계 스토어(ClickHouse/Redis HLL) 필요 시점에 스코프 폭발 | **Updates 탭만** 구현(activity_event 시간순 나열 = 하루) |
| F-11-06 `retained` 중간 상태 | 3단 상태기계 비용 | `trashed → 물리 삭제` 2단 + 환경변수 상수 |
| F-11-07 필터 4종 / Archived | | `미읽음/전체` 2종. 실시간 배지는 폴링 30초 |
| F-11-09 상속 | 조상 체인 계산 비용 | 페이지별 flat 구독 + 레벨 3단계. `important_updates`는 P2 |
| F-11-10 자연어 파싱 | chrono 계열로 대체 가능하나 tz 함정 다수 | **날짜/시간 피커만.** 반복 리마인더는 Notion에도 없음 |
| F-11-11 모바일 푸시·Slack | 채널 5개 인프라 연동이 XL의 본체 | 인앱만 P0 + 이메일 "5분 지연 큐 + 읽음 시 취소" 1규칙. 지연 큐는 BullMQ/pg-boss delayed job |
| F-11-11b Slack 전용 연동 | OAuth 비용 | **generic outgoing webhook**(임의 URL JSON POST) 하나로 Slack/Discord/Teams 커버, Slack incoming webhook URL 직결 → OAuth 생략 |
| F-11-12 이벤트 100종 | 엔터프라이즈 판매 목표 아니면 불필요 | **보안 10종만**(로그인, 권한변경, 멤버 초대/제거, 공유설정 변경, 영구삭제, 내보내기) + 단일 테이블 + 단순 필터 |
| F-11-13 공개 웹훅 | 서드파티 생태계 없음 | **내부 이벤트 버스(Redis Stream / PG NOTIFY)** 하나. 알림생성·Slack전송·검색인덱싱이 전부 이걸 소비. 외부 노출은 나중에 어댑터 |
| F-11-16 제안 편집 | **인라인 코멘트가 목적의 80% 대체**하고 코멘트는 어차피 P0/P1 | ① 코멘트 본문에 대체 문구 → 소유자 수동 반영(비용 0) ② 필요하면 **"추가 제안"만** 지원(앵커 문제 절반) |
| F-11-17 노코드 빌더 | 트리거×액션 매트릭스 | **"`Status`가 특정 값 → `Assignee`에게 알림" 한 규칙 하드코딩**(실사용 대부분). `Send webhook` 액션 먼저 만들면 나머지를 외부 위임 |
| F-11-18 페이지별 옵트아웃 | | 전역 토글 1개 + 환경변수 3개. 파티셔닝이 부담이면 **최소한 `page_view`만이라도** 별도 테이블+별도 파기 경로 |

---

## 4. 기술 난제 & 권장 구현 접근 (L/XL 6건)

| F-ID | 난이도 | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|---|
| **F-11-01** 버전 히스토리 | L | 스냅샷 스케줄러(인터벌+디바운스) + 과거 state를 에디터에 read-only 렌더 + 스토리지 압축. 수천 블록 × 수백 버전 = 용량 폭증 | **AFFiNE 3단 구조 그대로 채택**: `updates`(증분) → `snapshots`(정본) → `doc_histories`(버전). ⚠️ `Y.snapshot()`+`gc:false` 조합은 **피할 것** — 디스크·성능·네트워크 비용이 큼. 대신 버전 시점마다 `Y.encodeStateAsUpdate(doc)` 전체를 blob 저장(복원이 단순 `applyUpdate`). 델타 체인 + N개마다 full snapshot. CRDT 안 쓰면 서브트리 JSON+gzip. **히스토리 쓰기를 메인 트랜잭션 안에서 하거나 outbox 패턴**(AFFiNE 0.25.7에 실제 레이스 버그 존재) | AFFiNE `PgWorkspaceDocStorageAdapter`/`HistoryModel`, Tiptap `enableAutoVersioning`, **Lexical `DIFF_VERSIONS_COMMAND`/`renderSnapshot`** (같은 에디터를 read-only로 재사용 → 구현량 대폭 감소), Outline+Hocuspocus |
| **F-11-04** 활동 피드 | L | 이벤트 수집 파이프라인 + 롤업 배치 + 프라이버시 옵트아웃. 조회 이벤트가 편집의 10~100배 | `activity_event`(편집)와 `page_view`/`page_view_daily`(조회) **테이블 분리 필수**. 하위 페이지 포함은 기본 off + 토글. 커서 페이지네이션 | — |
| **F-11-08** 알림 규칙 엔진 | L | 트리거 종류가 많고 각각 수신자 해석·중복 억제·권한 검증이 붙음. 도메인 2번째로 무거움 | 규칙 하드코딩 금지 → 선언적 `notification_rule(event_type, recipient_resolver, min_subscription_level, suppress_self)`. **멘션은 정규식 파싱 금지** — 에디터가 `mention` 인라인 노드를 만들 때 `mention(block_id, target_user_id)` 레코드를 함께 기록. 알림 문구는 서버가 아니라 클라이언트 i18n 템플릿(이벤트엔 구조화 데이터만). 수신자 1인당 초당 생성 상한 필수 | Docmost(멘션 알림 오픈소스 코어) |
| **F-11-11** 채널 팬아웃 | **XL** | 채널 5개 각각 인프라 연동 + 지연/억제 상태기계 + presence + 재시도. 대부분이 외부 서비스 연동 | 핵심 원칙: **"본 것으로 간주되면 발송 취소"** — 즉시 발송이 아니라 지연 큐 예약 후 만료 직전 읽음 재확인 → suppress. `notification 1 : delivery N` 구조로 사용자에겐 1건으로 인지. 발송 직전 권한 재검증. 큐 적체 시 드롭이 아니라 **다이제스트로 강등**. Notion 타이밍: 인앱 즉시 / 데스크톱 10초 / 모바일 5분 / 이메일 폴백 | BullMQ, pg-boss(delayed job) |
| **F-11-12** 감사 로그 | **XL** | 기능 자체보다 **"모든 도메인에 이벤트 발행 훅을 빠짐없이 심는 것"** 이 비용. 100종+ 이벤트 타입 정의·유지 | 애플리케이션 DB와 **다른 스토리지 분리**(보관·볼륨·쿼리패턴 전부 다름). 월 파티셔닝 + ClickHouse/객체스토리지 아카이빙. `page.viewed`가 압도적 다수. 감사로그 조회 이벤트는 **세션당 1건만**(노이즈 지배 방지) | — |
| **F-11-13** 이벤트 웹훅 | L | 발행/집계/재시도/서명은 표준이나 **권한 필터링과 이벤트 타입 커버리지**가 일. 순환(소비자가 API로 쓰기 → 또 웹훅)이 최빈 실사고 | 페이로드에 `integration_id`를 실어 자기 변경 필터링 가능하게. 클론은 한 걸음 더: **자기 integration이 만든 변경은 그 integration에 미전송을 기본값**. 순서 미보장 명시 + timestamp 재정렬 안내 + API 재조회 권장. at-most-once, 8회 백오프/24시간 | Redis Stream, PostgreSQL NOTIFY |
| **F-11-16** 제안 편집 | L (decoration 없으면 XL) | **"본문에 커밋되지 않은 변경을 문서와 함께 살아 움직이게 유지".** 앵커 유실, 제안 간 충돌, 벌크 수락 원자성 | ① 제안은 `block.content`에 쓰지 않고 `suggestion` 행만 쌓은 뒤 렌더링 시 **오버레이 데코레이션으로 합성**(ProseMirror `Decoration`, Lexical decorator). ② 앵커는 반드시 CRDT relative position(`createRelativePositionFromTypeIndex`), 소실 시 `stale` + 원문 스니펫 표시. ③ 수락 = "제안 → CRDT op 변환 → 적용 → state 전이"의 **원자 트랜잭션**. 벌크 수락은 단일 CRDT 트랜잭션 → 브로드캐스트 1회 | Yjs relative position API |
| **F-11-17** 자동화 알림 | L (알림 3액션만이면 M) | 3초 디바운스 창의 정확한 구현 + 재진입 차단 + 실행이력 UI + **생성자 권한 실행이라는 보안 경계** | **Notion의 3초 창을 그대로 채택** — 되돌리면 실행 안 됨(실수가 알림 스팸이 되지 않는다). `pending_trigger`에 모았다가 +3s에 현재값 vs before_value 재비교. **자동화는 자동화를 트리거하지 못한다**(공식 제약) → `run_id` 전파로 자동화 컨텍스트 이벤트를 트리거 매칭에서 제외. 규칙 없으면 depth 상한 3 + WS당 분당 실행 상한 필수 | — |

### 전역 아키텍처 권고 (구축 순서)

1. **`activity_event` 이벤트 버스를 가장 먼저 정의.** F-11-04/08/12/13이 전부 여기 매달림. 나중에 붙이면 전 도메인 재작업.
2. `block.lifecycle` soft delete를 스키마 초기에.
3. 페이지 조상 조회(closure table / ltree) 초기 확정.
4. 알림 발송은 처음부터 **지연 큐 + suppress** 모델. "즉시 발송" 후 디바운스 추가는 사실상 재작성.
5. **디바운스 메커니즘을 한 벌로 통일.** 값은 달라도 됨(자동화 3초 / 데스크톱 10초 / 모바일 5분 / 웹훅 1분 미만) — 그러나 "지연 큐 + 만료 시점 재비교" 구현은 한 벌. 세 벌 만들면 세 벌 다 미묘하게 틀린다.
6. **스케줄러는 하나만.** F-11-10(리마인더) · F-11-17(recurring) · F-11-03(히스토리 GC) · F-11-18(로그 파기)이 전부 "시각이 되면 실행".

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 방향 / 요구 |
|---|---|---|
| **01 블록 에디터** | `block` 테이블에 4개 이력 컬럼 + `lifecycle` 요구(F-11-15/05). 멘션 인라인 노드가 `mention(block_id, target_user_id)` 레코드를 함께 써야 F-11-08 성립. 리마인더 인라인 칩(date mention). 제안 편집의 decoration API | **이 도메인 → 에디터 스키마에 요구** |
| **05 협업 동기화** | `doc_update`/`doc_snapshot` 공유. F-11-01은 CRDT state 위에 세워짐. F-11-14 undo는 Yjs `UndoManager.trackedOrigins`(local undo). F-11-16 앵커는 CRDT relative position | **가장 강한 결합.** 05가 CRDT를 안 쓰면 01/14/16 설계가 전부 바뀜 |
| **02 페이지·워크스페이스** | 페이지 트리 조상 조회 구조(F-11-05 삭제 전파 / F-11-09 구독 상속 공유). 사이드바 Trash/Inbox 엔트리. 워크스페이스 설정 화면 | 트리 구조 정본이 02에 있어야 함 |
| **06 권한·공유** | 히스토리는 `Can edit` 이상, Analytics는 owner/editor, 제안 편집은 `Can comment` 이상. 알림 생성·발송·조회 **3지점 모두** 권한 검증. 휴지통 목록/구독 목록의 제목 유출 방지 | **`Can view`/`Can comment`/`Can edit`/`Full access` 4등급이 실재해야 F-11-16이 성립** |
| **03/04 데이터베이스** | Person property 할당 알림(끌 수 없음, F-11-08). Date property 리마인더(F-11-10). DB 행 페이지의 알림 레벨 3종(F-11-09). `Created by`/`Last edited by`/`Created time`/`Last edited time` property 4종(F-11-15) — **값은 block 컬럼에서 파생, 중복 저장 금지**. F-11-17 자동화 전체 | DB 도메인 선행 필요 |
| **08 템플릿·자동화** | F-11-17이 사실상 08과 중복 영역. 액션 8종(edit property / add page / edit pages / define variables)은 08 소관 | **경계 정리 필요 — 중복 정의 위험 지점** |
| **09 API·통합** | F-11-13 웹훅, Slack OAuth(F-11-11b), integration/bot user 모델(`last_edited_by`가 bot id가 됨) | |
| **07 검색** | 휴지통 페이지는 일반 검색 제외, 휴지통 전용 인덱스에만 | |
| **17 운영·거버넌스** | F-11-12 감사로그·SIEM, F-11-06 데이터 보존 정책, legal hold, GDPR 삭제 | **F-11-12/06이 17과 중복 가능성 — 소관 확정 필요** |
| **12 플랫폼 UX** | 데스크톱/모바일 푸시 인프라, 모바일 스와이프 액션, 오프라인 알림 동기화 | |
| **14 인증·계정** | 사용자 탈퇴 시 이력 처리(익명화 vs 유지), 계정 이벤트 감사 로그 | |

---

## 6. 최우선 미해결 질문 (5개)

| # | 질문 | 왜 마스터 문서 판단에 중요한가 | 확인 경로 |
|---|---|---|---|
| 1 | **인박스가 동종 알림을 서버에서 자동 병합하는가**(수동 `^` 접기와 별개) | `group_key`를 DB에 물리 저장할지 조회 시점 병합할지가 갈린다. 물리 저장하면 읽음 처리·권한 재검증이 복잡해짐. 원본 문서 권장은 "저장은 개별, 병합은 조회 시점" | 실측(공식 문서엔 수동 접기만) |
| 2 | **자동화(F-11-17)가 만든 알림의 actor가 자동화인가 생성자인가** | 생성자 권한으로 실행되면 **권한 상승 통로**가 된다. 06 권한 도메인과 직결되는 보안 경계 | 실측 |
| 3 | **수락된 제안(F-11-16)이 `last_edited_by`에 누구 명의로 기록되는가** | 제안자는 편집 권한이 없을 수 있다 → 제안자 명의면 권한 모델과 모순. 원본 `[추정]`은 "커밋 actor = 수락자" | 실측 |
| 4 | **보존 정책 변경이 이미 삭제된 콘텐츠에 소급 적용되는가** | 잘못 구현하면 **대량 데이터 즉시 파기 사고**. 원본 권장은 "신규 삭제분부터" | Enterprise 실측 / 지원 문의 |
| 5 | **자식 블록 편집이 부모 블록의 `last_edited_time`을 올리는가** | write amplification 설계에 직결(루트까지 N번 UPDATE). 원본 `[추정]`은 "페이지 루트만 갱신, 중간 블록 미전파" | 공개 API로 실측 가능 |

> 그 외 잔여 `[확인필요]` 11건 + `[추정]` 3건 + 미조사 2건(모바일 오프라인 알림 동기화·이메일 다이제스트 규칙 / Notion 엔지니어링 블로그 1차 자료)은 원본 "잔여 미해결" 표 참조. 위 5개는 **스키마·보안 경계를 바꾸는 것**만 추린 것.

---

## 부록: 마스터 문서가 놓치기 쉬운 사실 확정분 (3차 GAP 결과)

| 항목 | 확정 사실 (근거는 모두 공식 help / developers.notion.com) |
|---|---|
| 히스토리 접근 권한 | **`Can edit` 이상.** `Can view`/`Can comment`는 열 수 없다 |
| 플랜 차이 | **보관 기간뿐**(7/30/90/무제한). "Enterprise만 상세 이력"은 오류 — 행위 추적은 audit log 소관 |
| 블록 soft delete | `DELETE /v1/blocks/{id}` → `in_trash:true`, "moves to Trash where it can still be accessed and restored". 휴지통 **UI만** page 타입 노출 |
| 알림 레벨 | 일반 페이지 **2종**(`All comments`/`Replies and @mentions`). `All updates`·`Important updates`는 **DB 페이지 전용** |
| 암묵 구독 트리거 | **생성 + 편집 2종**("automatically follow pages that you create or edit"). 코멘트/멘션은 `[추정]` |
| 권한 없는 사용자 멘션 | **알림이 생성되지 않는다.** 자동 초대 프롬프트 언급 없음 |
| DND/조용한 시간 · 페이지 삭제 단축키 · 인박스 단축키 | **모두 존재하지 않음**(부재 확인). 삭제는 `backspace`/`delete` 또는 `/delete` |
| 웹훅 이벤트 수 | **23종**(page 8 + database 6 + data_source 6 + comment 3), deprecated 2종 제외 시 **실질 21종**. 비집계 5종 = comment 3 + `page.locked`/`page.unlocked` |
| 영구 삭제 후 30일 | `retained` 30일은 **실재**하되 셀프서비스 복원 경로 없음(지원팀 운영 절차만) |
| DB 복원 한계 | 행 존재 + property는 복원되나 **"contents of the database pages... won't be restored"** → 복원 단위 = 페이지 1개 |
| 타임스탬프 | `last_edited_time`은 **분 단위 내림**. 초 정밀 커서/낙관적 잠금 로직은 깨진다 |
| 자동화 3초 창 | 3초 안에 되돌리면 실행되지 않음 + **자동화는 자동화를 트리거하지 못함**(공식 무한루프 차단) |

**주요 출처(30개 중 핵심)**: notion.com/help/{updates-and-notifications, duplicate-delete-and-restore-content, custom-data-retention-settings, audit-log, notification-settings, reminders, page-analytics, slack, suggested-edits, database-automations, keyboard-shortcuts, sharing-and-permissions} · developers.notion.com/reference/{webhooks-events-delivery, delete-a-block, block} · developers.notion.com/changelog/{created-by-and-last-edited-by-properties…, last-edited-time-is-now-rounded…} · github.com/{toeverything/AFFiNE(issues/14112), yjs/yjs, docmost/docmost} · discuss.yjs.dev/t/garbage-collection-and-version-snapshotting/1839 · tiptap.dev/docs/collaboration/documents/snapshot
