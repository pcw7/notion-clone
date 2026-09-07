# 11. 버전 히스토리 · 알림 · 활동

> 조사일: 2026-09-06 / 모드: DOMAIN / 대상: Notion 클론 (C:/VibeCoding/notion)
> 태그 규칙: `[추정]` = 공개 근거 없이 추론한 내부 구현, `[확인필요]` = 사실이지만 재확인이 필요한 항목

## 요약

이 도메인은 "쓰기(write)를 되돌릴 수 있게 만들고, 남의 쓰기를 나에게 전달하는" 계층이다. 여섯 개의 서브시스템으로 나뉜다(1~4는 1차 조사, 5~6은 2·3차 GAP에서 추가).
1. **버전 히스토리** — 편집 중 10분 주기 + 마지막 편집 2분 후에 페이지 스냅샷을 기록하고, 임의 시점으로 복원한다. 보관 기간은 플랜별로 7일/30일/90일/무제한.
2. **휴지통 & 데이터 보존** — 삭제는 즉시 파기가 아니라 `trash` 상태 전이이며, 기본 30일 후 영구 삭제, Enterprise는 1일~10년으로 조정 가능.
3. **알림(Inbox)** — 멘션·코멘트 답글·person property 할당·페이지 초대·리마인더가 알림 레코드를 만들고, 인앱/데스크톱/모바일 푸시/이메일/Slack 채널로 팬아웃된다.
4. **활동 로그** — 페이지 단위 `Updates & analytics`(누가 언제 무엇을 보고 편집했는지)와 워크스페이스 단위 Enterprise `Audit log`(365일 보관, CSV 내보내기, SIEM 웹훅 스트리밍)로 이원화되어 있다.
5. **편집 리뷰 & 자동화 알림** — 제안 편집(Suggested edits)은 "아직 본문에 반영되지 않은 변경"을 별도 레이어로 들고 있다가 수락 시점에 커밋하고(F-11-16), 데이터베이스 automation은 property 변경·스케줄을 알림으로 바꾼다(F-11-17).
6. **경량 이력 & 데이터 수명** — 모든 블록이 `created_by`/`last_edited_by`를 자기 자신에 들고 있어 히스토리를 열지 않고도 책임자를 알 수 있고(F-11-15), 이 도메인이 만드는 이벤트·조회·알림 로그에는 별도의 보관 정책이 필요하다(F-11-18).

여섯 서브시스템 모두 **"블록 트리에 대한 변경 이벤트 스트림"** 이라는 하나의 원천을 공유한다. 클론 설계의 핵심 결정은 이 이벤트 스트림을 **한 번만 만들고 여러 방향으로 소비**하게 하는 것이다.

### GAP 점검 이력 (2026-09-06 2차) — 1차 문서에서 정정된 주장

| # | 정정 대상 | 1차 문서 서술 | 1차 출처 재검증 결과 |
|---|---|---|---|
| C1 | 일반 페이지 알림 레벨 (F-11-09) | `All updates` / `All comments` / `Replies and @mentions` 3종 | **일반 페이지는 `All comments` / `Replies and @mentions` 2종.** `All updates` · `Important updates`는 **데이터베이스 페이지 전용**이다 |
| C2 | 블록 삭제와 휴지통 (F-11-05 / F-11-14) | "블록 삭제는 휴지통을 거치지 않는다" | 헬프센터는 그렇게 안내하지만, 공개 API의 `DELETE /v1/blocks/{id}`는 블록을 `in_trash: true`로 만들고 "Trash로 옮겨져 거기서 접근·복원할 수 있다"고 명시한다. **데이터 모델에는 블록 soft delete가 존재하되 휴지통 UI는 page 블록만 노출**하는 구조 |
| C3 | 영구 삭제 후 30일 (F-11-06) | "영구 삭제 후에도 추가 30일 내부 보관(`retained` 상태)" | 제품 기능이 아니라 **운영 DB 백업 스냅샷 30일 + 지원팀 수동 복구**. 커스텀 보존 문서는 "영구 삭제되면 워크스페이스 소유자도 접근·복원 불가"라고 명시 |
| C4 | 권한 없는 사용자 멘션 (F-11-08) | "초대 프롬프트가 필요하다 `[확인필요]`" | 확인됨 — **알림이 생성되지 않는다.** 자동 초대 프롬프트에 대한 언급은 문서에 없다 |
| C5 | 웹훅 이벤트 수 (F-11-13) | "26종" | 문서에 나열된 항목 합계는 **23종**(page 8 + database 6 + data_source 6 + comment 3, deprecated 2종 포함) |
| C6 | DND / 조용한 시간 (F-11-11) | `[확인필요]` | 공식 알림 설정 문서에 **DND·조용한 시간·알림 스케줄 항목이 존재하지 않음**(부재 확인) |
| C7 | 인박스 알림 접기 (F-11-07) | `[확인필요]` "N개 업데이트로 접히는가" | 페이지 이름 옆 `^`로 **페이지 단위 수동 접기**가 공식 제공됨. 다만 서버가 자동 병합하는지는 별개이며 여전히 미확인 |
| C8 | 페이지 삭제 단축키 (F-11-05) | `[확인필요]` | 공식 단축키 문서에 **페이지 삭제 전용 단축키 없음.** 선택 블록은 `backspace`/`delete`, 또는 `/delete` |
| C9 | 버전 히스토리의 플랜 차이 (F-11-01) | "Enterprise는 전체 변경 이력, 그 외는 제한된 이력" | 헬프센터에서 근거를 찾지 못함. 확인되는 플랜 차이는 **보관 기간뿐**(7/30/90/무제한). 상세 행위 추적은 Enterprise **Audit log**의 역할 |
| C10 | Undo 난이도 (F-11-14), 히스토리 GC 난이도 (F-11-03) | 둘 다 **S** | 협업 환경의 local undo와 blob 2단 삭제·플랜 재계산을 포함하면 둘 다 **M**이 타당 (아래 각 항목에 근거 기재) |

### GAP 점검 이력 (2026-09-06 3차) — 2차의 미완결분 마무리 + 재정정

2차 회차는 위 정정 표(C1~C10)와 의사 스키마(`suggestion`, `automation_notification_source`, `activity_retention_policy` 등)까지 쓴 뒤 중단되어, **정정 내용이 개별 기능 본문에 반영되지 않았고 F-11-15~18의 명세도 비어 있었다.** 3차에서 처리한 것:

| # | 처리 | 내용 |
|---|---|---|
| D1 | **C1~C10을 기능 본문에 실제 반영** | 2차에서 표로만 적어둔 정정 10건이 F-11-01/03/05/06/07/08/09/11/13/14 본문에는 그대로 남아 있었다. 전부 본문에 적용하고 "1차 서술 정정" 주석을 달았다 |
| D2 | **F-11-15~18 명세 신규 작성** | 2차가 스키마만 만들고 기능 항목을 쓰지 못한 4건(블록 단위 편집 이력 / 제안 편집 / 자동화 알림 / 데이터 수명·프라이버시)을 전체 스키마로 작성 |
| D3 | **C3(영구삭제 후 30일)을 재정정** | 2차가 "제품 기능 아님"으로 정정했으나 **과잉 정정**이었다. 1차 출처 원문 재확인: "Once pages are permanently deleted from Trash, they are **retained for 30 days** before they become inaccessible to all users, even workspace owners." → `retained` 상태는 **실재하며**, 다만 셀프서비스 복원 경로가 없을 뿐이다. F-11-06에 두 문서 원문을 병기 |
| D4 | C5(웹훅 이벤트 수) 확정 | 원문을 다시 열어 항목별로 카운트: page 8 + database 6(그중 2종 deprecated) + data_source 6 + comment 3 = **23종, 실질 유효 21종**. 비집계 이벤트는 comment 3종 + `page.locked`/`page.unlocked` 5종뿐이라는 사실도 추가 |
| D5 | **미해결 #1 해소** (인라인 DB와 스냅샷) | 인라인 DB 포함 페이지 복원 시 "DB의 pages/properties를 함께 복원할지" **선택 가능**. 단 **DB 행 페이지의 본문 내용은 복원되지 않는다**(각 행에서 개별 복원해야 함). F-11-01/F-11-02에 반영 |
| D6 | **미해결 #2 해소** (히스토리 열람 권한) | 공식 문구 "To access version history for a page, you will need at least `Can edit` access." → **`Can view`/`Can comment`는 히스토리를 볼 수 없다.** 1차의 "읽기 권한자에게 보일지 `[확인필요]`"를 확정 |
| D7 | **미해결 #5 해소** (암묵 구독 트리거) | 공식 가이드 "You automatically follow pages that you **create or edit**." → 암묵 구독 트리거는 생성·편집 2종으로 확정. 코멘트/멘션은 여전히 `[추정]` |
| D8 | 난이도 재조정 확정 | C10의 제안대로 F-11-03 `S→M`, F-11-14 `S→M`을 본문·요약표에 반영하고 각각 상향 근거를 기재 |

> 3차 점검 방법: WebSearch 6회 + WebFetch 6회. 1차 출처(help/duplicate-delete-and-restore-content, help/custom-data-retention-settings, help/suggested-edits, help/database-automations, developers.notion.com/reference/delete-a-block, .../webhooks-events-delivery)를 **원문 재확인 목적으로 다시 열어** 2차의 정정 자체를 반증 시도했고, 그 결과 D3에서 2차 정정 1건을 되돌렸다.

> 2차 점검 방법: 이 세션은 WebSearch 예산(200회)이 소진되어 검색을 수행할 수 없었다. 대신 **1차 출처(공식 헬프센터 · 공개 API 레퍼런스)를 WebFetch로 12회 직접 열람**해 검증했다. 검색으로만 닿을 수 있는 2차 자료(엔지니어링 블로그, 커뮤니티 리버스 엔지니어링)는 이번 회차에서 보강하지 못했으며, 아래 "미해결" 표의 잔여 항목 상당수가 그 영역이다.

---

## 핵심 개념 / 데이터 모델

### 개념 계층

```
편집 행위(edit op)
  ├─▶ [CRDT/OT update log]  ─▶ 스냅샷 압축 ─▶ page_version   (F-11-01/02/03)
  ├─▶ [activity_event]      ─▶ 페이지 활동 피드              (F-11-04)
  ├─▶ [activity_event]      ─▶ notification 생성 규칙 엔진   (F-11-08)
  │                              └─▶ notification_delivery (채널 팬아웃, F-11-11)
  └─▶ [audit_event]         ─▶ 감사 로그 / SIEM             (F-11-12)
```

핵심: `activity_event`(제품 기능용, 사용자에게 보임)와 `audit_event`(컴플라이언스용, 관리자에게만 보임)를 **분리**한다. 보관 기간·접근 권한·삭제 정책·PII 취급이 전부 다르기 때문이다. Notion도 실제로 분리되어 있다(페이지 활동은 페이지 권한자에게, audit log는 Enterprise 워크스페이스 소유자에게만).

### 의사 스키마

```sql
-- ─────────────── 1. 버전 히스토리 ───────────────

-- 실시간 협업 업데이트 로그 (CRDT 바이너리 델타). 고빈도 append-only.
doc_update (
  id           bigserial PK,
  page_id      uuid  NOT NULL,       -- 스냅샷 단위 = 페이지(문서)
  seq          bigint NOT NULL,      -- page_id 내 단조 증가
  payload      bytea NOT NULL,       -- Yjs update / OT op batch
  actor_id     uuid,                 -- NULL이면 시스템/봇
  created_at   timestamptz NOT NULL,
  UNIQUE(page_id, seq)
)

-- 압축된 현재 상태. doc_update를 주기적으로 머지해 씀.
doc_snapshot (
  page_id      uuid PK,
  state        bytea NOT NULL,       -- 머지된 CRDT state
  state_vector bytea NOT NULL,
  updated_at   timestamptz NOT NULL,
  merged_seq   bigint NOT NULL       -- 여기까지의 doc_update가 반영됨
)

-- 사용자에게 노출되는 "버전". 10분/2분 규칙으로 생성.
page_version (
  id            uuid PK,
  page_id       uuid NOT NULL,
  state         bytea NOT NULL,      -- 그 시점의 전체 CRDT state (또는 blob 참조)
  state_vector  bytea NOT NULL,
  editor_ids    uuid[] NOT NULL,     -- 이 버전 구간의 기여자들 (UI가 여럿 표시)
  created_at    timestamptz NOT NULL,
  byte_size     int NOT NULL,
  reason        text NOT NULL,       -- 'interval' | 'idle' | 'pre_restore' | 'manual'
  restored_from uuid,                -- 복원으로 만들어진 버전이면 원본 version_id
  expires_at    timestamptz NOT NULL,-- 플랜 보관 기간으로 계산, GC 인덱스
  INDEX (page_id, created_at DESC),
  INDEX (expires_at)
)

-- ─────────────── 2. 휴지통 / 보존 ───────────────

-- block/page 테이블에 상태 컬럼으로 두는 편이 트리 일관성에 유리.
block (
  id            uuid PK,
  parent_id     uuid,
  type          text,
  ...,
  -- 블록 단위 편집 이력 (F-11-15). 공개 API의 block 오브젝트가 그대로 노출하는 필드.
  created_by       uuid        NOT NULL,   -- block.created_by
  created_at       timestamptz NOT NULL,   -- block.created_time
  last_edited_by   uuid        NOT NULL,   -- block.last_edited_by
  last_edited_at   timestamptz NOT NULL,   -- block.last_edited_time
  lifecycle     text NOT NULL DEFAULT 'live',
                -- 'live' | 'trashed' | 'retained' | 'purged'
  trashed_at    timestamptz,
  trashed_by    uuid,
  trash_root_id uuid,        -- 실제로 삭제 버튼이 눌린 조상 (하위 전파 표시용)
  purge_after   timestamptz  -- 보존 정책으로 계산
)

workspace_retention_policy (
  workspace_id         uuid PK,
  trash_days           int NOT NULL DEFAULT 30,   -- 1 ~ 3650
  retained_days        int NOT NULL DEFAULT 30,   -- 영구삭제 후 복구 가능 기간
  version_history_days int,                       -- NULL = 무제한(Enterprise)
  updated_by           uuid,
  updated_at           timestamptz
)

-- ─────────────── 3. 활동 / 알림 ───────────────

activity_event (
  id           uuid PK,
  workspace_id uuid NOT NULL,
  page_id      uuid NOT NULL,        -- 알림 라우팅의 기준 축
  block_id     uuid,                 -- 블록 단위 변경일 때
  actor_id     uuid NOT NULL,
  type         text NOT NULL,        -- 'block.updated' | 'block.inserted' | 'block.deleted'
                                     -- | 'property.updated' | 'comment.created'
                                     -- | 'comment.replied' | 'user.mentioned'
                                     -- | 'page.created' | 'page.moved' | 'page.trashed'
  payload      jsonb NOT NULL,       -- 변경 요약(diff 스니펫, 이전/이후 property 값 등)
  created_at   timestamptz NOT NULL,
  INDEX (page_id, created_at DESC)
)

subscription (                        -- 페이지 팔로우
  id           uuid PK,
  user_id      uuid NOT NULL,
  page_id      uuid NOT NULL,
  level        text NOT NULL,        -- 일반 페이지:  'all_comments' | 'replies_and_mentions' | 'none'
                                     -- DB 행(page in database):
                                     --   'all_updates' | 'important_updates'
                                     --   | 'replies_and_mentions' | 'none'
                                     -- ※ 페이지 종류별 허용 값이 다르다 → CHECK 제약으로 강제할 것
  source       text NOT NULL,        -- 'explicit'(Follow this page 토글)
                                     -- | 'auto_created' | 'auto_edited'   <- 공식 확인된 암묵 구독 2종
                                     -- | 'auto_commented' | 'auto_mentioned'  <- [추정], 클론 선택사항
  inherit      bool NOT NULL DEFAULT true,  -- 하위 페이지까지 적용
  created_at   timestamptz,
  UNIQUE(user_id, page_id)
)

notification (
  id             uuid PK,
  recipient_id   uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  page_id        uuid NOT NULL,
  event_ids      uuid[] NOT NULL,    -- 묶인 activity_event들(집계 알림)
  kind           text NOT NULL,      -- 'mention' | 'comment_reply' | 'comment'
                                     -- | 'page_update' | 'invite' | 'reminder'
                                     -- | 'person_property_assigned'
  group_key      text NOT NULL,      -- (recipient, page, kind) 등 집계 키
  read_at        timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL,
  INDEX (recipient_id, archived_at, read_at, created_at DESC),
  UNIQUE(group_key) WHERE read_at IS NULL   -- 미읽음 상태에서만 집계 병합
)

notification_delivery (
  id              uuid PK,
  notification_id uuid NOT NULL,
  channel         text NOT NULL,     -- 'in_app' | 'desktop_push' | 'mobile_push'
                                     -- | 'email' | 'slack'
  state           text NOT NULL,     -- 'pending' | 'suppressed' | 'sent' | 'failed'
  scheduled_at    timestamptz NOT NULL,  -- 디바운스 만료 시각
  sent_at         timestamptz,
  suppress_reason text,              -- 'user_active_on_page' | 'read_before_send'
                                     -- | 'channel_disabled' | 'quiet_hours'
  INDEX (state, scheduled_at)
)

reminder (
  id            uuid PK,
  block_id      uuid NOT NULL,       -- 인라인 @remind가 박힌 블록, 또는 date property 소유 행
  page_id       uuid NOT NULL,
  property_id   uuid,                -- DB date property 기반이면 채움
  target_at     timestamptz NOT NULL,-- UTC 저장
  timezone      text NOT NULL,       -- IANA tz, 표시/자연어 파싱 기준
  lead_minutes  int NOT NULL DEFAULT 0,  -- 0=정시, 5/10/30/60/1440 ...
  recipient_ids uuid[] NOT NULL,     -- 같은 줄에 멘션된 사람들, 없으면 생성자
  fired_at      timestamptz,
  created_by    uuid,
  INDEX (fired_at, target_at)        -- fired_at IS NULL 스캔용
)

-- 제안 편집(Suggested edits): 본문에 커밋되지 않은 대기 변경 (F-11-16)
suggestion (
  id           uuid PK,
  page_id      uuid NOT NULL,
  block_id     uuid NOT NULL,      -- text / to_do / heading / bulleted / numbered 만 대상
  author_id    uuid NOT NULL,
  op           text NOT NULL,      -- 'insert' | 'delete' (텍스트 범위 단위)
  anchor       jsonb NOT NULL,     -- CRDT relative position (절대 offset 금지)
  payload      jsonb,              -- insert일 때 제안된 텍스트/마크
  original     text,               -- 앵커 소실 시 보여줄 원문 스니펫
  state        text NOT NULL,      -- 'open' | 'accepted' | 'rejected' | 'stale'
  thread_id    uuid,               -- 첨부된 코멘트 스레드
  resolved_by  uuid, resolved_at timestamptz,
  created_at   timestamptz NOT NULL,
  INDEX (page_id, state)
)

-- Person property 할당 알림 스위치: 사용자가 아니라 property에 붙는다 (F-11-08)
person_property_setting (
  property_id      uuid PK,
  notify_on_assign bool NOT NULL DEFAULT true   -- edit 권한자만 변경 가능
)

-- 자동화가 만든 알림의 출처 추적 + 재진입 차단 (F-11-17)
automation_notification_source (
  notification_id uuid PK,
  automation_id   uuid NOT NULL,
  run_id          uuid NOT NULL,
  trigger_kind    text NOT NULL    -- 'page_added' | 'property_edited' | 'scheduled'
)

-- 활동/알림 데이터 수명 (F-11-18). Notion 공식에는 없는, 클론이 스스로 정해야 하는 정책.
activity_retention_policy (
  workspace_id      uuid PK,
  activity_days     int NOT NULL DEFAULT 90,
  page_view_days    int NOT NULL DEFAULT 90,    -- 원본. 일별 롤업은 무기한
  notification_days int NOT NULL DEFAULT 180    -- 읽음/보관된 것만. 미읽음은 만료 없음
)

user_privacy_setting (
  user_id           uuid PK,
  record_page_views bool NOT NULL DEFAULT true  -- Settings → Preferences → Privacy
)
page_view_optout (page_id uuid, user_id uuid, PRIMARY KEY(page_id, user_id))

-- ─────────────── 4. 감사 로그 ───────────────

audit_event (
  id            uuid PK,
  org_id        uuid NOT NULL,
  workspace_id  uuid,
  teamspace_id  uuid,
  actor_type    text NOT NULL,       -- 'user' | 'integration' | 'bot' | 'agent'
  actor_id      uuid,
  actor_email   text,                -- 탈퇴 후에도 검색 가능해야 하므로 비정규화 보관
  type          text NOT NULL,       -- 'page.viewed', 'page.permission_updated', ...
  target_type   text, target_id uuid,
  ip_address    inet,
  user_agent    text,
  audience      text,                -- 'private'|'internal'|'external'|'public_web'
  metadata      jsonb,               -- 페이지 "내용"은 절대 넣지 않음
  occurred_at   timestamptz NOT NULL,
  INDEX (org_id, occurred_at DESC)
)  -- 월 단위 파티셔닝 권장, 보관 365일

siem_webhook (
  workspace_id uuid PK,              -- 워크스페이스당 1개
  url text, secret text, enabled bool,
  last_success_at timestamptz, consecutive_failures int
)
```

---

## 기능 명세

### F-11-01 페이지 버전 히스토리 (스냅샷 기록 · 조회)

- **한 줄 정의**: 페이지를 편집하는 동안 자동으로 시점 스냅샷을 남겨, 과거 어느 시점의 페이지 내용이든 읽기 전용으로 열어볼 수 있게 한다.
- **사용자 시나리오**:
  1. 사용자가 페이지 본문을 편집한다 → 별도 조작 없음(자동 기록).
  2. 페이지 우상단 `···` → `Page history`(또는 `Updates & analytics`) 클릭.
  3. 우측 패널에 버전 목록이 최신순으로 뜬다. 각 항목은 `날짜 · 시각 · 편집자 아바타`.
  4. 항목 클릭 → 본문 영역이 그 시점 콘텐츠로 교체(읽기 전용, 편집 커서 비활성).
  5. 원하는 블록만 드래그 선택 후 복사 → 현재 버전에 붙여넣기(부분 복구).
- **동작 상세**:
  - 스냅샷 생성 규칙(공식): **활발히 편집하는 동안 10분마다 1개**, 그리고 **마지막 편집 후 2분 뒤에 1개** 추가 기록. 즉 "편집 세션 종료 시 마무리 스냅샷"이 보장된다.
  - 스냅샷 단위 = **페이지 1개(자식 페이지 제외)**. 하위 페이지는 자기 자신의 히스토리를 가진다.
  - **인라인 데이터베이스**: 인라인 DB를 포함한 페이지를 복원할 때 **"DB의 pages와 properties를 함께 복원할지"를 선택**할 수 있다 → 즉 부모 스냅샷은 DB 행 메타데이터를 함께 들고 있으나 **적용 여부가 옵트인**이다. 다만 **DB 각 행 페이지의 본문(내용)은 복원되지 않는다**; 그건 행 페이지 각각의 히스토리에서 따로 복원해야 한다. *(미해결 #1 해소)*
  - 편집이 없으면 스냅샷도 생기지 않는다(빈 버전 미생성).
  - 여러 사람이 같은 10분 구간을 편집하면 하나의 버전에 **여러 편집자**가 표기된다.
  - **플랜 차이는 "보관 기간"뿐이다** — Free 7일 / Plus 30일 / Business 90일 / Enterprise `Any number of days`. 헬프센터 어디에도 "Enterprise만 상세 변경 이력을 본다"는 서술은 없다. 행위 단위 추적(누가 무엇을 언제)은 히스토리가 아니라 **Enterprise Audit log(F-11-12)의 역할**이다. *(1차 문서의 반대 서술을 정정)*
  - **접근 권한: `Can edit` 이상.** 공식 문구 — "To access version history for a page, you will need at least `Can edit` access." `Can view` / `Can comment` 사용자는 히스토리를 열 수 없다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 페이지 | 버전 목록 비어 있음 → "아직 기록된 버전이 없습니다" 상태 표시 |
  | 중첩 페이지 | 부모 히스토리에는 자식 페이지 "링크 블록"만, 자식 본문은 자식 히스토리에 |
  | 동시 편집 | 스냅샷은 서버가 머지한 상태 기준으로 1개만 생성. 클라이언트별 중복 생성 금지(`UNIQUE(page_id, bucket_start)` 권장) |
  | 삭제된 참조 | 과거 버전이 지금 삭제된 자식 페이지/파일을 참조 → 링크는 보이되 클릭 시 "삭제됨" 처리. 파일 blob 보존 기간을 휴지통 정책과 동기화 필요 |
  | 권한 없음 | **`Can edit` 이상만 접근**(공식 명시). `Can view`/`Can comment`에게는 `···` 메뉴에서 `Page history` 항목 자체를 숨기고, 서버도 편집 권한으로 재검증(403). 읽기 권한조차 없으면 404 |
  | 대용량 | 수천 블록 × 수백 버전 = 스토리지 폭증. 전체 state 대신 **델타 체인 + N개마다 full snapshot** 전략 필요 |
  | 순환 참조 | 페이지 A의 버전이 B를 링크하고 B의 버전이 A를 링크 → 스냅샷은 **콘텐츠 복사본이 아니라 링크 참조만** 저장하므로 순환이 생기지 않는다. 반대로 "참조 대상까지 통째로 스냅샷"하는 설계를 택하면 즉시 무한 재귀가 된다 — 스냅샷 경계를 페이지 1개로 못박아야 하는 또 하나의 이유 |

- **데이터 모델 함의**: `page_version`, `doc_update`, `doc_snapshot`(위 스키마). 버전 목록 조회는 `state`를 제외한 메타데이터만 SELECT해야 함(별도 컬럼 또는 blob 스토리지 분리). `editor_ids`는 구간 내 `doc_update.actor_id` DISTINCT로 계산.
- **UI/인터랙션**: `···` 메뉴 진입. 목록은 우측 사이드 패널(약 300px). 항목 클릭으로 전체 본문 교체. 히스토리 열람 중에는 편집 툴바/슬래시 메뉴 비활성. ESC 또는 패널 닫기로 현재 버전 복귀.
- **의존 기능**: 블록 트리 저장소, 실시간 협업 동기화(CRDT state), 페이지 권한 모델.
- **구현 난이도**: **L (1~2주)** — 스냅샷 스케줄러(디바운스 + 인터벌), 과거 state를 에디터에 읽기 전용으로 렌더링하는 경로, 스토리지 압축까지 포함하면 단순 CRUD가 아니다.
- **우선순위**: **P1** — MVP에 없어도 제품은 동작하지만, "실수로 날렸다"에 대한 방어가 없으면 실사용 신뢰를 못 얻는다.
- **클론 시 현실적 대안**: CRDT를 쓰지 않는다면 **저장 시점마다 blocks 서브트리를 JSON 직렬화 후 gzip 저장**(간단, 정확). Yjs를 쓴다면 `Y.snapshot()`은 `gc:false`를 요구해 성능/용량 비용이 크므로, **snapshot 대신 그 시점 state의 full encode를 별도 blob으로 저장**하는 편이 실무적으로 안전하다.
- **참고 출처**: https://www.notion.com/help/duplicate-delete-and-restore-content (10분/2분 규칙, `Can edit` 요구, 플랜별 보관일, 인라인 DB 복원 선택지) , https://www.notion.com/pricing , https://discuss.yjs.dev/t/garbage-collection-and-version-snapshotting/1839

---

### F-11-02 버전 복원 (Restore)

- **한 줄 정의**: 과거 버전을 선택해 현재 페이지 내용을 그 상태로 되돌린다.
- **사용자 시나리오**:
  1. `Page history` 패널에서 버전 선택 → 본문이 그 시점으로 프리뷰됨.
  2. 패널 좌상단 `Restore` 클릭.
  3. 확인 모달 → 현재 페이지 내용이 해당 버전으로 교체되고, 히스토리 목록 최상단에 새 버전이 생긴다.
  4. 잘못 복원했더라도 다시 `Page history`를 열어 이전 시점으로 재복원 가능(복원 자체를 되돌릴 수 있다).
- **동작 상세**:
  - **복원은 파괴적 rollback이 아니라 forward write**다. 복원 직전 상태를 새 버전(`reason='pre_restore'`)으로 먼저 기록한 뒤 대상 버전 내용을 현재에 적용한다. 이 규칙 때문에 "복원 취소"가 성립한다. (공식 문서: 복원 후에도 보관 기간 내 어느 시점으로든 다시 돌아갈 수 있다고 명시)
  - 복원 후 페이지의 `last_edited_by`는 복원 수행자, `last_edited_time`은 복원 시각. `[추정]`
  - 복원 대상 범위 = 그 페이지의 본문 블록 트리. 자식 페이지 내부 내용은 복원되지 않는다.
  - **데이터베이스 복원의 명시적 한계(공식)**: DB를 복원하면 "all of its pages and their properties"는 복원되지만 **"any contents of the database pages, like text inside of the pages, won't be restored"**. 행 본문을 되살리려면 각 행 페이지의 히스토리를 개별 복원해야 한다. → 클론도 **복원 단위 = 페이지 1개**를 지키고, DB 복원은 "행 존재 + property 값"까지만으로 범위를 못박는 편이 정확하다.
  - 인라인 DB가 포함된 페이지 복원 시에는 "DB pages/properties를 함께 복원할지" 선택 UI를 제공한다.
  - `[확인필요]` 복원으로 되살아난 블록이 참조하던 자식 페이지가 휴지통에 있을 때의 동작(공식 문서에 서술 없음). 클론 권장: 링크는 복원하되 대상이 `trashed`면 "삭제됨" 렌더 + 복원 안내 액션.
  - 30일보다 오래된 버전 복원은 Business/Enterprise 플랜에서만 가능.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 복원 중 다른 사람이 편집 | 복원을 단일 트랜잭션(또는 원자적 CRDT 트랜잭션)으로 처리. 동시 편집분은 pre_restore 버전에 보존되므로 유실 아님 |
  | 복원 대상이 만료됨(GC) | 목록에서 사라짐. 이미 열어둔 세션에서 Restore 시 410 + "이 버전은 더 이상 사용할 수 없습니다" |
  | 권한 없음 | 읽기 권한자는 Restore 버튼 미노출. 서버에서도 편집 권한 재검증 |
  | 잠긴 페이지(locked) | 잠금 해제 전 복원 차단 |
  | 대용량 | 수천 블록 교체 시 클라이언트 브로드캐스트 폭주 → 서버에서 계산 후 단일 update로 브로드캐스트 |
  | 복원 대상이 현재와 동일 | no-op 처리, 새 버전 생성하지 않음 |
  | 빈 값 | 빈 페이지 상태의 버전으로 복원 = 전체 삭제. 확인 모달에 영향 범위를 수치로 명시("현재 내용 N개 블록이 제거됩니다") |
  | 중첩 | 자식 페이지는 복원 대상이 아니다(F-11-01의 스냅샷 경계와 동일). 복원 후에도 자식 페이지는 현재 상태 그대로 남는다 |
  | 삭제된 참조 | 복원 대상 버전이 참조하던 파일 blob이 이미 GC되었으면 첨부가 깨진다 → **버전 blob의 수명을 첨부 파일 수명의 하한으로** 삼아야 한다(`file_object.refcount`에 `page_version`도 포함) |
  | 순환 참조 | 복원이 새 버전을 만들고 그 버전을 다시 복원할 수 있어 `restored_from` 체인이 무한히 길어진다. 체인을 끝까지 따라가는 UI를 만들지 말 것 — **표시는 1단계("v7에서 복원됨")까지만** |

- **데이터 모델 함의**: `page_version.reason`에 `'pre_restore'`, `'restore'` 값 필요. `page_version.restored_from`으로 "v3에서 복원됨" UI 표기 가능. 복원은 `audit_event(type='page.restored_version')`도 남긴다.
- **UI/인터랙션**: 프리뷰 상태에서만 `Restore` 노출. 복원 완료 후 토스트 + `실행 취소` 액션(= 직전 pre_restore 버전으로 재복원).
- **의존 기능**: F-11-01, 페이지 편집 권한, 페이지 잠금(lock).
- **구현 난이도**: **M (2~5일)** — F-11-01이 있으면 "state를 현재에 덮어쓰는" 경로 하나. 동시편집 원자성 처리가 난이도를 올린다.
- **우선순위**: **P1** — F-11-01과 세트. 조회만 되고 복원이 안 되면 기능 가치의 절반 이하.
- **클론 시 현실적 대안**: 전체 복원 대신 **"과거 버전 열어서 블록 복사 → 붙여넣기"** 만 먼저 지원(Notion도 이 경로를 공식 안내한다). 구현 비용이 거의 0이면서 실사용 복구율은 높다.
- **참고 출처**: https://www.notion.com/help/duplicate-delete-and-restore-content

---

### F-11-03 버전 보관 기간 정책 & 히스토리 GC

- **한 줄 정의**: 플랜 등급에 따라 버전 히스토리를 며칠간 보관할지 결정하고, 만료된 버전을 자동 파기한다.
- **사용자 시나리오**: 무료 플랜 사용자가 8일 전 버전을 찾으려 히스토리를 열면 목록 하단에 업그레이드 안내가 뜨고, 7일 이전 항목은 표시되지 않는다.
- **동작 상세**:
  - 공식 플랜별 Page history 보관: **Free 7일 / Plus 30일 / Business 90일 / Enterprise 무제한**. (notion.com/pricing)
  - 30일 초과 버전 복원은 Business·Enterprise에서만.
  - 플랜 업그레이드 시 **이미 파기된 버전은 되살아나지 않는다** `[추정]`(물리 삭제이므로). 다운그레이드 시 초과분 즉시 파기 여부는 `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 플랜 다운그레이드 직후 | 즉시 파기 대신 유예 기간(예: 7일) 후 GC 권장. 즉시 파기는 사고 유발 |
  | 워크스페이스 전체가 휴지통행 | 버전도 함께 파기 대상. 단 복구 창(retained) 동안은 유지 |
  | 페이지가 다른 워크스페이스로 이동 | 새 워크스페이스 플랜 기준으로 `expires_at` 재계산 |
  | 대용량 GC | `expires_at` 인덱스 기반 배치 삭제 + blob 지연 삭제(orphan sweeper) |
  | 마지막 남은 1개 버전 | 최소 1개(가장 최근)는 보관 기간과 무관하게 유지하는 것이 안전 `[추정]` |
  | 빈 값 | `version_history_days`가 NULL = 무제한(Enterprise). **NULL을 0으로 잘못 읽으면 전량 즉시 파기**된다. nullable을 타입 레벨(Option/Maybe)로 강제해 암묵 캐스팅을 막을 것 |
  | 중첩 | 자식 페이지는 각자의 `expires_at`을 갖는다. 부모 페이지의 버전이 만료됐다고 자식 히스토리를 지우면 안 된다 |
  | 동시편집 | GC 배치 도중 그 페이지가 편집되어 새 버전이 생길 수 있다. **삭제 대상 id를 먼저 확정(SELECT)한 뒤 삭제**하면 신규 버전과 충돌하지 않는다 |
  | 삭제된 참조 | DB 행만 지워지고 blob이 스토리지에 남는 orphan이 반드시 생긴다 → **row 삭제와 blob 삭제를 분리**하고 orphan sweeper를 별도로 운영한다 |
  | 권한 없음 | 보관 기간 설정 변경은 워크스페이스 소유자만. 일반 멤버에게는 현재 값을 읽기 전용으로만 표시 |
  | 순환 참조 | 해당 없음(정책은 스칼라 값) |

- **데이터 모델 함의**: `page_version.expires_at` + `workspace_retention_policy.version_history_days`. 플랜 변경 시 일괄 UPDATE가 부담되면 **lazy 방식**(조회 시 `created_at + policy` 비교로 필터, GC만 백그라운드)으로 회피.
- **UI/인터랙션**: 히스토리 목록 하단에 "이전 버전 더 보기 — 플랜 업그레이드" CTA. 만료 항목은 목록에서 제거(잠금 표시 대신 미표시가 단순).
- **의존 기능**: F-11-01, 결제/플랜 모델, 워크스페이스 설정.
- **구현 난이도**: **M (2~5일)** — *(1차 S에서 상향)* 정책 테이블 + 조회 필터 자체는 S지만, ① 만료 버전의 blob을 오브젝트 스토리지에서 2단(row 삭제 → orphan sweeper)으로 지우는 GC, ② 플랜 변경 시 `expires_at` 재계산(또는 lazy 필터 경로) 및 그 경계 테스트, ③ 워크스페이스 이동 시 재계산까지 넣으면 하루로 끝나지 않는다. 잘못 만들면 **되돌릴 수 없는 데이터 파기**라 테스트 비용이 기능 비용보다 크다.
- **우선순위**: **P2** — 클론에 과금 티어가 없다면 단일 상수(예: 30일)로 충분.
- **클론 시 현실적 대안**: 플랜 개념 없이 **워크스페이스 설정 하나의 숫자(days)** 로 단순화. 스토리지 압박이 오면 "페이지당 최근 N개 + 최근 D일" 이중 상한.
- **참고 출처**: https://www.notion.com/pricing , https://www.notion.com/help/duplicate-delete-and-restore-content

---

### F-11-04 페이지 활동 피드 (Updates & analytics)

- **한 줄 정의**: 한 페이지에 대해 누가 언제 무엇을 편집/코멘트/조회했는지를 시간순 피드로 보여준다.
- **사용자 시나리오**:
  1. 페이지 우상단 `···` → `Updates & analytics`.
  2. `Updates` 탭: "홍길동이 3개 블록을 편집함 · 2시간 전", "김철수가 코멘트를 남김" 같은 항목이 최신순.
  3. `Analytics` 탭: 날짜별 조회 수/고유 조회 수 그래프, 하단에 최근 조회자 목록(사람 + 마지막 조회 시각).
  4. 같은 패널에서 이 페이지의 알림 구독 레벨을 바꾸거나 Slack 채널을 연결한다.
- **동작 상세**:
  - Analytics 열람은 **페이지 owner 또는 editor** 권한 필요.
  - 조회자 목록에 익명(비멤버/비게스트) 조회는 포함되지 않는다.
  - 사용자는 자신의 조회 기록 수집을 거부할 수 있다: 전역 `Settings → Preferences → Privacy`, 또는 Analytics 탭의 `Settings → Don't record`.
  - 편집 이력은 블록 단위로 집계되어 "N개 블록 편집" 형태로 묶인다 `[추정]`. 개별 블록 diff를 원문 그대로 노출하는지는 `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 페이지 / 신규 페이지 | "아직 활동 없음". 최소한 `page.created` 1건은 표시 |
  | 중첩 | 하위 페이지 활동을 부모 피드에 포함하면 위키 루트에서 폭주 → **기본 미포함 + "하위 포함" 토글** 권장 |
  | 동시편집 | 동일 actor의 연속 편집은 시간 윈도우(예: 5분)로 합쳐 1건 표시 |
  | 삭제된 참조 | actor 탈퇴 시 "삭제된 사용자"로 표기. 이벤트에 이름 비정규화 저장 |
  | 권한 없음 | 뷰어에게는 Analytics 탭 미노출. Updates 탭도 페이지 읽기 권한자만 |
  | 대용량 | 페이지당 수십만 이벤트 → 커서 페이지네이션, 보관 기간 후 파기 |
  | 순환 참조 | 피드는 이벤트 목록이지 콘텐츠 트리가 아니므로 재귀가 없다. 단 "하위 포함" 토글을 켤 때는 조상/자손 조회에 **방문 집합 + 깊이 상한**이 필요하다(트리가 손상돼 사이클이 생긴 경우의 방어) |

- **데이터 모델 함의**: `activity_event` + `page_view` 별도 테이블.
  ```sql
  page_view (page_id, user_id, viewed_at, is_anonymous)   -- 고유 조회는 (page_id,user_id,date) 유니크
  page_view_daily (page_id, day, total_views, unique_views) -- 롤업, 그래프용
  ```
  조회 이벤트는 편집 이벤트보다 10~100배 많으므로 **절대 같은 테이블에 넣지 않는다**.
- **UI/인터랙션**: 우측 패널, 탭 2개. 그래프 hover로 날짜별 수치 툴팁. 활동 항목 클릭 시 해당 블록으로 스크롤 `[확인필요]`.
- **의존 기능**: 블록 편집 이벤트 발행, 코멘트 시스템, 권한 모델, 사용자 프로필.
- **구현 난이도**: **L (1~2주)** — 이벤트 수집 파이프라인 + 롤업 배치 + 프라이버시 옵트아웃까지 합치면 단일 화면 이상의 작업.
- **우선순위**: **P2** — 협업 팀 대상이면 P1. 개인용 클론이면 후순위.
- **클론 시 현실적 대안**: Analytics(조회수)를 전부 드롭하고 **Updates 탭만** 구현. `activity_event`를 시간순 나열하면 하루면 끝난다. 조회 로깅은 별도 집계 스토어(ClickHouse/Redis HLL)가 필요해지는 순간 스코프가 폭발한다.
- **참고 출처**: https://www.notion.com/help/page-analytics , https://www.notion.com/help/updates-and-notifications

---

### F-11-05 휴지통 (Trash) — 삭제 · 조회 · 복원

- **한 줄 정의**: 페이지 삭제는 즉시 파기가 아니라 휴지통으로의 상태 전이이며, 보관 기간 내 원래 위치로 복원할 수 있다.
- **사용자 시나리오**:
  1. 사이드바에서 페이지 우클릭 → `Delete`, 또는 페이지 `···` → `Move to trash`.
  2. 페이지가 사이드바에서 사라지고 토스트 "휴지통으로 이동됨 · 실행 취소".
  3. 사이드바 하단 `Trash` 클릭 → 삭제된 페이지 목록. 검색창에 키워드 입력.
  4. 항목 hover → `Restore` 또는 `Delete permanently`.
  5. 복원 시 원래 부모 위치로 돌아간다.
- **동작 상세**:
  - 기본 보관 30일, 이후 영구 삭제.
  - 휴지통 검색 필터: **제목/키워드, 최종 편집자, 원래 상위 페이지 위치, 소속 teamspace**.
  - 휴지통의 페이지는 **열람은 되지만 편집 불가**. 내부 블록을 복사해 다른 페이지에 붙여넣는 부분 복구가 가능.
  - 삭제는 하위 트리 전체에 전파된다. 복원도 트리 단위. 휴지통 목록에는 **삭제 루트만** 노출되어야 한다(자식 수천 개가 목록에 쏟아지면 안 됨).
  - **블록 삭제와 휴지통 — 제품 UI와 데이터 모델이 어긋난다** *(1차 문서의 "블록은 휴지통을 거치지 않는다" 서술을 정정)*:
    | 층 | 관찰되는 사실 | 출처 |
    |---|---|---|
    | 헬프센터(제품 UI) | 블록 삭제 복구 수단으로 휴지통을 안내하지 않는다. 사용자에게 노출되는 Trash 목록에는 **page 블록만** 나온다 | help/duplicate-delete-and-restore-content |
    | 공개 API(데이터 모델) | `DELETE /v1/blocks/{id}`는 블록을 **`in_trash: true`로 만들며**, "this moves the block to the Trash where it can still be accessed and restored"라고 명시. 복원은 `PATCH /v1/blocks/{id}`(또는 page면 `PATCH /v1/pages/{id}`)로 `in_trash`를 되돌린다 | developers.notion.com/reference/delete-a-block |
    → 결론: **모든 블록에 soft delete가 존재하되, 휴지통 UI는 page 타입만 노출**한다. 클론도 `block.lifecycle`을 전 블록에 두고 UI 필터로만 page를 거르는 편이 API 일관성과 참조 무결성 양쪽에 유리하다.
  - 사용자 관점 블록 복구 수단은 여전히 `Ctrl/Cmd+Z`(F-11-14) 또는 버전 히스토리(F-11-01)다.
  - 데이터베이스 property 삭제는 별도 `Deleted properties` 영역에서 복원/영구삭제.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 부모가 이미 삭제된 상태에서 자식만 복원 | 복원 불가 처리 또는 "워크스페이스 루트로 복원" 선택지 제공 |
  | 원래 부모가 영구 삭제됨 | 루트(Private/Teamspace)로 복원 |
  | 동시편집 중 삭제 | 열려 있는 세션에 "이 페이지는 삭제되었습니다" 배너 + 편집 잠금 |
  | 다른 페이지가 링크/relation으로 참조 | 링크는 취소선 또는 "삭제됨" 상태로 렌더. relation 값은 유지하되 회색 처리. 영구 삭제 시 relation 정리 |
  | 권한 없음 | 삭제는 편집(또는 full access) 권한 필요. 휴지통 목록은 **자신이 접근 가능한 페이지만** 노출(권한 필터 누락 시 제목 유출) |
  | 대용량 | 10만 블록 서브트리 삭제 → 재귀 UPDATE는 비동기 잡으로. 루트만 즉시 `trashed`로 바꾸고 자식은 조상 조회(materialized path/closure table)로 판정하면 O(1) |
  | 검색 인덱스 | 휴지통 페이지는 일반 검색에서 제외, 휴지통 전용 인덱스에만 존재 |
  | 빈 값 | 휴지통이 비어 있을 때 "휴지통이 비어 있습니다" 빈 상태. **검색 결과 0건과 구분해** 표시할 것(같은 문구를 쓰면 사용자가 검색어를 의심하지 않는다) |
  | 중첩 | 삭제 루트만 목록에 노출하고 복원도 **루트 단위**로 한다. 트리 중간 노드만 개별 복원하는 경로는 제공하지 않는 편이 단순하고 안전하다 |
  | 순환 참조 | 페이지 트리에 사이클이 생기면 삭제 전파가 무한 루프에 빠진다. **부모 변경(이동) 시점에 사이클 검사**를 걸고, 그럼에도 전파 로직에는 방문 집합 + 깊이 상한을 둔다 |

- **데이터 모델 함의**: 위 `block.lifecycle` + `trash_root_id`. **soft delete는 모든 조회 쿼리에 `lifecycle='live'` 조건을 강제**하므로 뷰 또는 ORM 글로벌 스코프로 강제해야 사고를 막는다. 조상 판정 성능을 위해 `path ltree` 또는 `closure_table(ancestor_id, descendant_id, depth)` 중 하나가 사실상 필수.
- **UI/인터랙션**: 사이드바 최하단 고정 `Trash` 엔트리. 팝오버 목록 + 검색 인풋. 각 행 hover 시 복원/영구삭제 아이콘. 삭제 직후 토스트의 `실행 취소`는 5초 노출. **페이지 삭제 전용 단축키는 존재하지 않는다** — 공식 단축키 문서에 없다. 선택한 블록은 `backspace`/`delete`, 페이지는 `/delete` 슬래시 커맨드 또는 컨텍스트 메뉴. *(1차 `[확인필요]` 해소 — 부재 확인)*
- **의존 기능**: 블록 트리 + 부모-자식 관계, 권한 모델, 검색.
- **구현 난이도**: **M (2~5일)** — soft delete 자체는 쉽지만 트리 전파, 권한 필터, 검색 인덱스 배제, 복원 시 부모 유효성까지 하면 하루로 안 끝난다.
- **우선순위**: **P0** — "삭제하면 영영 사라짐"은 노트 앱에서 허용되지 않는다. MVP 필수.
- **클론 시 현실적 대안**: 검색 필터(편집자/위치/teamspace)를 생략하고 제목 검색만. 자식 전파는 closure table 없이 재귀 CTE(`WITH RECURSIVE`)로 시작해도 수천 노드까지는 문제없다.
- **참고 출처**: https://www.notion.com/help/duplicate-delete-and-restore-content

---

### F-11-06 영구 삭제 & 커스텀 데이터 보존 정책

- **한 줄 정의**: 휴지통 보관 기간이 끝나거나 사용자가 명시적으로 영구 삭제하면 콘텐츠를 접근 불가 상태로 만들고, 조직은 그 기간을 정책으로 통제한다.
- **사용자 시나리오**:
  - (사용자) 휴지통에서 `Delete permanently` → 확인 모달("이 작업은 되돌릴 수 없습니다") → 목록에서 제거.
  - (Enterprise 워크스페이스 소유자) `Settings → Security → Data retention` → 휴지통 보관일 수를 1일~10년 범위에서 설정 → 저장.
  - (Enterprise 소유자) `Content search`에서 특정 콘텐츠를 골라 즉시 영구 삭제를 트리거.
- **동작 상세**:
  - **영구 삭제 후 30일 — 공식 문서 2개가 서로 다르게 읽힌다. 양쪽 원문을 그대로 두고 판단한다** *(2차 GAP에서 "제품 기능이 아니라 DB 백업일 뿐"이라고 정정했으나, 1차 출처를 다시 열어보니 과잉 정정이었다. 아래가 최종)*:
    | 출처 | 원문 | 읽히는 의미 |
    |---|---|---|
    | help/duplicate-delete-and-restore-content | "Once pages are permanently deleted from Trash, they are **retained for 30 days** before they become inaccessible to all users, even workspace owners." | 영구 삭제 후에도 **데이터는 30일 더 존재**하고, 그 30일이 지나야 완전히 접근 불가가 된다 |
    | help/custom-data-retention-settings | "Once a page or AI chat is permanently deleted... **workspace owners will also be unable to access or restore it.**" | 그 30일 동안에도 **셀프서비스 복원 경로는 없다** |
    → 정합적 해석: `purged`(= 사용자·소유자 모두 접근 불가) 상태가 30일 존재하고, 그 구간의 복구는 **제품 기능이 아니라 Notion 지원팀의 운영 절차**(최근 30일 DB 스냅샷)로만 가능하다. 즉 `purged != physically deleted`는 **맞다**. 다만 그것을 "복원 가능한 상태"로 UI에 노출해서는 안 된다. `[추정]` 두 문서의 30일이 같은 30일인지(문서상 명시 없음).
  - Enterprise 커스텀 보존: 휴지통 보관 **최소 1일 ~ 최대 10년**, 기본 30일. 도메인 인증 불필요.
  - AI 채팅 기록은 휴지통을 거치지 않고 바로 보존 정책 대상이 된다.
  - 실수로 워크스페이스/계정을 삭제한 경우 Notion 지원팀이 **최근 30일 DB 스냅샷**으로 복구 가능(제품 기능이 아니라 운영 절차).
  - `[확인필요]` 보존 정책 변경이 이미 삭제된 콘텐츠에 소급 적용되는지 — 공식 문서에 명시 없음.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 보존 기간을 30일 → 1일로 단축 | 소급 적용 시 대량 즉시 파기 위험. **정책 변경은 신규 삭제분부터** 적용 + 관리자에게 경고 모달 권장 |
  | 첨부 파일 blob | 페이지 영구 삭제 시 오브젝트 스토리지도 정리. 다른 페이지가 같은 blob을 참조(복제)할 수 있으므로 refcount 필요 |
  | 법적 보존(legal hold) | 보존 정책보다 우선. hold 대상은 만료돼도 파기 금지 (Notion audit log에 legal hold 이벤트가 존재) |
  | 권한 없음 | 영구 삭제는 삭제자 본인 또는 워크스페이스 소유자로 제한 |
  | 대용량 | 파기 배치는 청크 단위 + 재시도 가능. 조용히 누락된 파기는 컴플라이언스 사고 |
  | GDPR 삭제 요청 | 계정 파기 시 `activity_event.actor_id`를 익명화하되 이벤트 자체는 유지 |
  | 빈 값 | 보존 기간 입력이 비거나 0이면 저장 거부. **0일 = 즉시 파기**를 허용하면 실수 한 번이 워크스페이스를 날린다(Notion도 최소 1일) |
  | 중첩 | 파기는 삭제 루트의 서브트리 전체. 자식 중 legal hold 대상이 **하나라도** 있으면 그 서브트리 전체를 보류하고 관리자에게 사유를 알린다 |
  | 동시편집 | 휴지통 페이지는 열람이 가능하므로 파기 시작 시 열려 있는 세션이 있을 수 있다 → 세션을 강제 종료하고 "이 페이지는 삭제되었습니다"로 전환 |
  | 삭제된 참조 | 파기 대상이 다른 페이지의 relation·링크 대상일 때 **파기 후 상대 쪽 값을 반드시 정리**한다. 남기면 조회할 때마다 404를 내는 유령 참조가 된다 |
  | 순환 참조 | 서로를 참조하는 두 페이지를 동시에 파기할 때 참조 정리가 서로를 기다리면 데드락. **참조 정리를 파기 전 단일 패스로 먼저 끝낸 뒤** 파기한다 |

- **데이터 모델 함의**: `workspace_retention_policy`, `block.lifecycle IN ('trashed','retained','purged')`, `purge_after`. 파기 작업 자체를 `purge_job(id, scope, requested_by, state, started_at, finished_at, error)`로 기록해야 감사 가능. 파일은 `file_object(id, storage_key, refcount)`.
- **UI/인터랙션**: 영구 삭제는 2단계 확인(모달 + 선택적 제목 타이핑). 관리자 설정은 숫자 인풋 + 단위 셀렉트(일/월/년).
- **의존 기능**: F-11-05, 워크스페이스 관리자 설정, 파일 스토리지, (선택) 플랜 모델.
- **구현 난이도**: **M (2~5일)** — 3단 lifecycle 상태 기계 + 파기 배치 + blob refcount. 정책 UI 자체는 간단.
- **우선순위**: **P2** — 클론 MVP는 "휴지통 + 30일 하드코딩 파기"면 충분. 조직 판매를 노릴 때 P1로 승격.
- **클론 시 현실적 대안**: `retained` 중간 상태를 없애고 `trashed → 물리 삭제` 2단계로 단순화. 커스텀 정책 대신 환경변수 상수.
- **참고 출처**: https://www.notion.com/help/custom-data-retention-settings , https://www.notion.com/help/duplicate-delete-and-restore-content , https://www.notion.com/pricing

---

### F-11-07 인박스 (Inbox) — 알림 목록 · 필터 · 읽음/보관

- **한 줄 정의**: 사용자에게 도착한 모든 알림을 한 곳에 시간순으로 모아 보여주고, 읽음/보관으로 처리하게 한다.
- **사용자 시나리오**:
  1. 사이드바 최상단 `Inbox` 옆에 미읽음 개수 빨간 배지가 표시됨.
  2. 클릭 → 알림 패널. 항목: `아바타 + "홍길동이 회의록에서 회원님을 멘션했습니다" + 발췌 + 상대 시각`.
  3. 상단 필터 드롭다운: `Unread and read` / `Unread only` / `Archived` / `All workspace updates`.
  4. 항목 클릭 → 해당 페이지의 해당 블록/코멘트 위치로 이동, 자동 읽음 처리.
  5. 항목 hover → 읽음/미읽음 토글, 보관(archive), 이 페이지 알림 레벨 변경.
  6. 모바일: 스와이프로 읽음/보관, 인박스에서 바로 이모지 리액션까지 가능.
- **동작 상세**:
  - 필터 4종은 공식 문서 기준. `All workspace updates`는 내가 구독하지 않은 것까지 포함하는 워크스페이스 전체 피드.
  - 배지 숫자 = 미읽음 알림 개수(보관된 것 제외).
  - **그룹핑은 "페이지 단위 수동 접기"로 확인됨** — 인박스에서 페이지 이름 옆 `^`를 눌러 그 페이지의 알림들을 접을 수 있다. 즉 인박스는 이미 **페이지를 그룹 헤더로 쓰는 2단 구조**다. *(1차 `[확인필요]` 부분 해소)*
  - `[확인필요]` 서버가 동종 이벤트를 자동 병합해 "N개의 업데이트" 1건으로 만드는지, 아니면 개별 알림을 렌더링 시점에만 접는지는 공식 문서에 없다. 클론 권장: **저장은 개별 이벤트, 병합은 `group_key` 기준 조회 시점**(집계 알림을 DB에 미리 만들면 읽음 처리·권한 재검증이 복잡해진다).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 알림 대상 페이지가 삭제됨 | 항목은 남되 클릭 시 "삭제된 페이지" 안내. 영구 삭제 시 알림도 파기 |
  | 알림 후 권한 회수 | **조회 시점에 권한 재검증**. 권한 없으면 목록에서 숨김(제목/발췌도 유출 금지) |
  | 코멘트가 삭제됨 | 알림에서 발췌 제거, "삭제된 코멘트" 처리 |
  | 여러 기기 동시 사용 | 읽음 상태는 서버가 권위. 실시간 채널로 배지 동기화 |
  | 대용량 | 미읽음 수천 개 → 배지는 `99+`. 커서 페이지네이션 + `모두 읽음 처리` 벌크 액션 |
  | 자기 자신의 행동 | 본인이 만든 이벤트는 본인에게 알림 생성 금지(리마인더 제외) |
  | 빈 값 | 알림 0건 → "새 알림이 없습니다". 배지는 숨긴다(`0` 표시 금지) |
  | 중첩 | 인박스는 페이지를 그룹 헤더로 쓰는 **2단 구조가 최대**다. 하위 페이지 알림을 부모 그룹 아래로 또 접어 3단으로 만들면 도달 클릭 수만 늘어난다 |
  | 순환 참조 | 해당 없음(알림은 평면 목록) |

- **데이터 모델 함의**: `notification`(위). 배지 카운트를 매번 `COUNT(*)`로 계산하지 말고 `user_notification_counter(user_id, unread_count)`를 두고 트랜잭션 내 증감. 필터 인덱스: `(recipient_id, archived_at NULLS FIRST, read_at, created_at DESC)`.
- **UI/인터랙션**: 사이드바 상단 고정. 빨간 원형 배지. 패널 폭 약 400px, 무한 스크롤. 페이지 이름 옆 `^`로 그 페이지 알림 접기/펼치기. **인박스 전용 단축키는 공식 단축키 문서에 없다**(부재 확인). 검색·이동은 `Ctrl/Cmd+K`, `Ctrl/Cmd+P`. *(1차 `[확인필요]` 해소)*
- **의존 기능**: F-11-08(알림 생성), 권한 모델, 실시간 푸시 채널(WebSocket).
- **구현 난이도**: **M (2~5일)** — 목록/필터/읽음 상태는 표준 CRUD지만 배지 실시간 동기화와 권한 재검증이 추가 작업.
- **우선순위**: **P0** — 협업 클론에서 멘션했는데 상대가 모르면 협업이 성립하지 않는다. 단 MVP 범위는 "멘션 + 코멘트 답글"만.
- **클론 시 현실적 대안**: 필터 4종 → `미읽음/전체` 2종. Archived 드롭. 실시간 배지는 폴링(30초)으로 시작.
- **참고 출처**: https://www.notion.com/help/updates-and-notifications

---

### F-11-08 알림 생성 규칙 엔진 (멘션 · 답글 · 할당 · 초대)

- **한 줄 정의**: 어떤 행위가 누구에게 알림을 만드는지 결정하는 서버 측 규칙 집합.
- **사용자 시나리오**: A가 페이지 본문이나 코멘트에 `@홍길동`을 입력하고 저장 → 홍길동의 Inbox에 알림이 생성되고 배지가 오른다.
- **동작 상세** — 공식 문서가 명시한 트리거:
  | 트리거 | 수신자 | 비고 |
  |---|---|---|
  | 누군가 나를 `@`-멘션 | 멘션된 사용자 | 페이지 본문·코멘트 모두 |
  | 내 코멘트에 답글 | 원 코멘트 작성자 | 스레드 참여자 전체로 확장할지는 정책 결정 |
  | 페이지 알림 설정이 `All comments` | 구독자 | F-11-09 레벨에 따름 |
  | 데이터베이스 Person property에 내가 추가됨 | 추가된 사용자 | **개별 사용자가 이 알림을 끌 수 없다**고 문서에 명시 |
  | 페이지에 초대됨 | 초대받은 사용자 | |
  | 리마인더 시각 도래 | 리마인더 대상자 | F-11-10 |
  | 구독 중인 페이지의 업데이트 | 구독자 | F-11-09 |
  - 멘션은 **권한 검증과 결합**된다: 페이지 접근 권한이 없는 사람을 멘션하면 **알림이 생성되지 않는다.** 자동 초대 프롬프트가 뜬다는 서술은 공식 문서에 없다. *(1차 `[확인필요]` 해소)* → 클론 권장: 멘션 확정 시점에 수신자 권한을 체크해 **"이 사람은 이 페이지에 접근할 수 없습니다 · 초대하기"** 인라인 경고를 작성자에게만 표시. 알림은 권한 부여 후 생성.
  - 자기 자신 멘션은 알림 미생성 `[추정]`.
  - 동일 수신자·페이지·종류의 이벤트는 짧은 윈도우 내 병합(group_key)해 폭주를 막는다 `[추정]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 멘션 후 즉시 취소(텍스트 삭제) | 이미 발송된 알림은 회수하지 않음. 클릭 시 "해당 멘션을 찾을 수 없음" |
  | 그룹/팀 멘션 | 그룹 멤버 전원 팬아웃. 대규모 그룹은 상한(예: 100명) + 확인 모달 |
  | 수신자에게 페이지 권한 없음 | **알림 생성 차단**(Notion 동작). 마스킹 후 전달은 하지 않는다 — 페이지 제목만으로도 정보가 새기 때문 |
  | 봇/통합이 만든 이벤트 | 기본 생성. actor_type 기준 필터 옵션 제공 |
  | 대량 편집(임포트, 500페이지 복제) | 구독자 알림 폭주 → **벌크 작업 플래그**로 알림 억제 |
  | 삭제된 사용자 멘션 | 알림 미생성, 멘션 칩은 "삭제된 사용자"로 렌더 |
  | 빈 값 | 본문이 빈 코멘트, 텍스트 없이 멘션만 있는 블록 → 발췌가 빈 문자열이 된다. 발췌가 비면 "회원님을 멘션했습니다"만 표시하고 빈 따옴표를 렌더하지 말 것 |
  | 중첩 | 코멘트 스레드의 답글에 멘션이 함께 있으면 **동일인에게 멘션 알림 + 답글 알림 2건**이 생긴다 → `group_key`를 `(recipient, thread)` 기준으로 잡아 1건으로 병합하고 `kind`는 더 강한 쪽(`mention`)을 취한다 |
  | 동시편집 | 두 사람이 같은 순간 같은 사람을 멘션하면 알림 2건이 **정상**이다(actor가 다르다). 병합하려면 "N명이 회원님을 멘션했습니다" 형태여야 하며 `event_ids[]`에 둘 다 담는다 |
  | 대용량 | 위 "대량 편집" 행에 더해, **수신자 1인당 초당 알림 생성 상한**을 둔다. 이 상한이 없으면 단일 사용자의 인박스가 마비되고 배지 카운터 트랜잭션이 핫스팟이 된다 |
  | 순환 참조 | 알림 클릭 → 페이지 이동 → 그 방문이 다시 이벤트를 만들어 알림을 낳는 루프. **자기 행위는 자기에게 알림을 만들지 않는다**는 규칙(위 표)이 차단 장치다. 봇·시스템 actor에도 동일하게 적용할 것 |

- **데이터 모델 함의**: `activity_event` → 규칙 엔진 → `notification`. 규칙을 코드에 하드코딩하지 말고 선언적 매핑으로: `notification_rule(event_type, recipient_resolver, min_subscription_level, suppress_self)`. 멘션은 블록 텍스트를 정규식 파싱하지 말고, 에디터가 `mention` 인라인 노드를 만들 때 `mention(block_id, target_user_id)` 레코드를 함께 써야 정확하다.
- **UI/인터랙션**: `@` 트리거 → 사용자/페이지/날짜 통합 서제스트. 확정 시 칩. 알림 문구는 서버가 아니라 클라이언트에서 i18n 템플릿으로 렌더(이벤트에는 구조화 데이터만 저장).
- **의존 기능**: 코멘트 시스템, 멘션 인라인 노드, 권한 모델, 데이터베이스 Person property, F-11-09.
- **구현 난이도**: **L (1~2주)** — 트리거 종류가 많고 각각 수신자 해석·중복 억제·권한 검증이 붙는다. 이 도메인에서 두 번째로 무거운 지점.
- **우선순위**: **P0**(멘션·답글) / **P1**(person property, 구독 기반 업데이트).
- **클론 시 현실적 대안**: MVP는 트리거 2종(멘션, 코멘트 답글)만 하드코딩. 규칙 테이블화는 트리거가 5개를 넘을 때 도입.
- **참고 출처**: https://www.notion.com/help/updates-and-notifications , https://www.notion.com/help/notification-settings , https://www.notion.com/help/comments-mentions-and-reminders

---

### F-11-09 페이지 구독 (Follow) & 페이지별 알림 레벨

- **한 줄 정의**: 특정 페이지의 변경을 어느 수준까지 알림받을지 사용자별로 설정한다.
- **사용자 시나리오**:
  1. Inbox 알림 항목에 hover → `···` → 이 페이지 알림 레벨 선택.
  2. 또는 페이지 우상단 `Updates` 패널에서 구독 레벨 변경.
  3. **일반 페이지 옵션은 2종**: `All comments` / `Replies and @mentions`. *(1차 문서가 여기에 `All updates`를 넣은 것은 오류 — 그건 DB 전용이다)*
  4. **데이터베이스 페이지(행) 옵션은 3종**: `All updates`(코멘트 + 모든 property 변경) / `Important updates`(코멘트 + status·assignee·due date 등 핵심 property 변경) / `Replies and @mentions`.
  5. 어느 쪽이든 알림을 끄려면 구독 해제(`none`)를 선택한다.
- **동작 상세**:
  - 위 옵션 목록은 공식 문서 기준.
  - **암묵 구독(확인됨)**: 공식 가이드는 **"You automatically follow pages that you create or edit"** 라고 명시한다 → 트리거는 **페이지 생성 + 페이지 편집** 두 가지. *(1차 `[추정]`/미해결 #5 해소)*
  - `[추정]` 코멘트 작성·멘션 피격도 암묵 구독을 만드는지는 위 문장에 포함되어 있지 않다. 다만 "내 코멘트에 달린 답글"은 구독과 무관한 **별도 트리거**(F-11-08)로 이미 알림이 가므로, 코멘트를 암묵 구독에 넣지 않아도 기능 공백은 생기지 않는다. 클론 권장: 암묵 구독 = `create` + `edit`만, 레벨은 `replies_and_mentions`(가장 조용한 값)로 시작.
  - 수동 팔로우는 `Updates` 패널의 **`Follow this page` 토글**이며, 켜면 `Updates` 옆에 체크 표시가 붙고 사이드바 업데이트 + 이메일로 알림이 온다.
  - 명시적 `none`(뮤트)은 암묵 구독을 덮어써야 한다 — 안 그러면 "뮤트했는데 편집하면 다시 켜지는" 버그가 된다.
  - 구독은 하위 페이지로 상속되어야 실용적이다(위키 루트 팔로우 = 하위 전체). Slack 연결 문서가 "그 페이지 또는 데이터베이스(및 하위 페이지)의 편집/코멘트마다 알림"이라고 명시해 상속이 실재함을 뒷받침한다.
  - 명시적 `none`(뮤트)은 상속을 덮어써야 한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 부모 `all_updates` + 자식 `none` | 자식의 명시 설정이 우선(가장 가까운 조상 규칙) |
  | 구독 중 페이지 이동 | 구독은 page_id에 붙으므로 유지. 상속 계산만 새 경로 기준 |
  | 구독 중 권한 상실 | 구독 레코드는 남기되 알림 생성 시 권한 체크로 차단 |
  | 페이지 삭제 | 구독 비활성. 복원 시 재활성 |
  | 대용량 | 워크스페이스 루트를 1000명이 `all_updates`로 구독 → 편집 1회에 알림 1000건. **팬아웃은 비동기 큐 + 배치 insert** 필수, 구독자 수 상한 경고 |
  | Person property 알림 | 개별 사용자가 끌 수 없다고 문서에 명시 → 이 경로는 구독 레벨을 우회한다 |
  | 빈 값 | 구독 레코드가 없는 페이지 = 구독 없음 → 알림 없음. **NULL을 `all_updates`로 해석하면 워크스페이스 전체가 알림 폭탄이 된다.** 기본값은 반드시 가장 조용한 쪽 |
  | 중첩 | 조상 체인에 설정이 여러 개면 **가장 가까운 조상 하나만** 적용한다. 합산(union)이나 최대값을 취하면 하위에서 조용하게 만들 수 없다 |
  | 동시편집 | 두 기기에서 동시에 레벨 변경 → `UNIQUE(user_id, page_id)` + UPSERT로 마지막 쓰기 승. 실시간 채널로 다른 기기에 반영 |
  | 삭제된 참조 | 구독 대상 페이지가 영구 삭제되면 구독 행도 함께 정리한다(F-11-18의 연쇄 파기 경로) |
  | 권한 없음 | 구독 설정은 페이지 읽기 권한자면 가능. 다만 **권한이 없는 페이지를 "구독 목록" 화면에 노출하지 말 것**(제목 유출) |
  | 순환 참조 | 페이지 트리에 사이클이 있으면 상속 계산이 무한 루프에 빠진다. 조상 체인 조회에 방문 집합 + 깊이 상한(예: 50)을 둔다 |

- **데이터 모델 함의**: `subscription`(위). 상속 판정에 조상 체인 조회가 필요하므로 F-11-05와 같은 closure table/ltree를 공유한다. 팬아웃 쿼리는 "이 페이지의 조상 집합에 대한 구독 중, 가장 가까운 조상의 레벨을 취하는" 윈도우 함수 쿼리 1회로 처리.
- **UI/인터랙션**: 페이지 우상단 종 아이콘 또는 `Updates` 패널 내 드롭다운. 상속으로 결정된 경우 "상위 페이지에서 상속됨" 부가 텍스트.
- **의존 기능**: F-11-07, F-11-08, 페이지 트리, 권한 모델.
- **구현 난이도**: **M (2~5일)** — 상속 해석과 팬아웃 쿼리가 핵심. 스키마 자체는 작다.
- **우선순위**: **P1** — 없으면 알림이 전부 아니면 전무가 되어 금방 뮤트당한다.
- **클론 시 현실적 대안**: 상속을 제거하고 **페이지별 flat 구독** + 3단계 레벨만. `Important updates`(property 종류별 구분)는 P2로 미룬다.
- **참고 출처**: https://www.notion.com/help/updates-and-notifications , https://www.notion.com/help/slack , https://www.notion.com/help/guides/tips-to-keep-your-teams-notion-pages-up-to-date (자동 팔로우 = 생성/편집, `Follow this page` 토글)

---

### F-11-10 리마인더 (@remind · Date property 알림)

- **한 줄 정의**: 특정 시각에 자신 또는 지정한 사람에게 알림이 가도록 페이지 안에 시간 앵커를 심는다.
- **사용자 시나리오**:
  - **인라인**: 본문에 `@remind tomorrow`, `@remind 7pm`, `@remind Wednesday at 1pm` 입력 → 자연어가 파싱되어 리마인더 칩으로 변환.
  - **타인 지정**: `@홍길동 @remind next Monday 9am 배포 확인` — 같은 줄에 멘션된 사람이 수신자가 된다.
  - **DB**: 행의 Date property 클릭 → 캘린더 팝오버 → `Remind` 옵션에서 리드타임 선택.
  - 칩 클릭 → 날짜/시각, 리드타임(예: 30분 전), 날짜 포맷, 타임존 편집.
- **동작 상세**:
  - `@remind` + 자연어 파싱은 공식 문법.
  - 데이터베이스 리마인더는 **Date property가 있어야** 설정 가능.
  - 발화 시 인앱 배지 + 데스크톱 푸시 + 모바일 푸시(5분 이내) + Notion이 닫혀 있으면 이메일.
  - 인라인 리마인더 칩은 `@Today`가 되거나 기한이 지나면 **빨간색**으로 바뀐다.
  - **반복 리마인더는 미지원**(공식 FAQ에서 로드맵이라고만 언급).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 과거 시각 설정 | 즉시 발화하지 않고 "이미 지남" 상태(빨간색)로만 표시하는 편이 안전 `[확인필요]` |
  | 리마인더 블록 삭제 | 예약 발화 취소. `reminder` 행 삭제 또는 tombstone |
  | 페이지가 휴지통행 | 발화 억제. 복원 시 이미 지난 것은 발화하지 않음 |
  | 수신자 권한 없음 | 알림 생성 차단 + 설정자에게 경고 |
  | 타임존 | `target_at`은 UTC 저장, `timezone`은 별도 컬럼. **자연어 "내일 9시"는 입력자 tz 기준으로 해석**, 다른 tz 수신자에게는 절대 시각으로 전달 |
  | DST 전환 | 저장 시점 UTC 고정 방식은 DST를 넘는 예약이 1시간 어긋날 수 있다 `[추정]`. 로컬 시각 기준 예약은 tz 규칙으로 재계산 필요 |
  | 대용량 | 동시각 리마인더 수만 건 → 1분 버킷 폴링(`WHERE fired_at IS NULL AND target_at <= now()`) + 배치 처리 |
  | 중복 발화 | 발화 전 `UPDATE ... WHERE fired_at IS NULL`로 조건부 선점해 at-most-once 보장 |
  | 빈 값 | 날짜만 있고 시각이 없는 리마인더 → **기본 시각(예: 09:00)을 반드시 정의**한다. 정하지 않으면 00:00에 발화해 새벽 알림이 된다 |
  | 중첩 | 한 블록에 리마인더가 2개 이상(멀티 날짜 멘션) → 각각 별도 `reminder` 행. 블록 삭제 시 전부 정리 |
  | 삭제된 참조 | 수신자 중 워크스페이스를 떠난 사람만 제외하고 나머지에게 발화. 수신자가 0명이 되면 발화하지 않고 **생성자에게 통지**한다 |
  | 순환 참조 | 해당 없음 |

- **데이터 모델 함의**: `reminder`(위). 인라인 칩은 블록 콘텐츠 안의 인라인 노드(Notion 공개 API의 date mention 구조 `{type:'mention', mention:{type:'date', date:{start,time_zone}}}`와 유사)이며, 스케줄링용 정규화 행을 **별도 테이블에 복제**해야 인덱스 스캔이 가능하다. 블록 저장 시 리마인더 행을 동기화하는 훅 필요.
- **UI/인터랙션**: `@` 서제스트에 `Remind` 항목. 칩 클릭 → 캘린더 팝오버(날짜, 시간 토글, 리드타임 셀렉트, 타임존, 종료일). 지난 리마인더는 빨간 텍스트.
- **의존 기능**: 인라인 멘션 노드, 날짜 파서, F-11-07/F-11-11, 사용자 타임존 설정.
- **구현 난이도**: **M (2~5일)** — 자연어 날짜 파싱(chrono 계열 라이브러리로 대체 가능) + 스케줄러 + 블록↔테이블 동기화. XL은 아니지만 타임존 함정이 많다.
- **우선순위**: **P2** — 태스크 관리 용도를 노리면 P1.
- **클론 시 현실적 대안**: 자연어 파싱 없이 **날짜/시간 피커만** 제공. 반복 리마인더는 Notion에도 없으므로 만들지 않는다. 스케줄러는 별도 워커 없이 앱 내 1분 cron으로 시작.
- **참고 출처**: https://www.notion.com/help/reminders , https://www.notion.com/help/comments-mentions-and-reminders

---

### F-11-11 알림 채널 팬아웃 (인앱 · 데스크톱 · 모바일 푸시 · 이메일 · Slack)

- **한 줄 정의**: 생성된 알림 하나를 사용자 설정과 현재 접속 상태에 따라 적절한 채널로만 전달한다(중복 방지 포함).
- **사용자 시나리오**: 회의 중이라 Notion을 닫아둔 사용자가 멘션당함 → 5분 내 확인하지 않으면 모바일 푸시 + 이메일이 도착. 데스크톱을 켜두고 있었다면 10초 후 데스크톱 알림만.
- **동작 상세** — 공식 문서가 명시한 타이밍 규칙:
  | 채널 | 발송 조건 |
  |---|---|
  | 인앱(Inbox 배지) | 즉시 |
  | 데스크톱 푸시 | 멘션 후 **10초** |
  | 모바일 푸시 | **5분 내에 해당 멘션을 보지 않았거나**, 기기에 Notion이 열려 있지 않을 때 |
  | 이메일 | Notion이 열려 있지 않을 때, 또는 모바일 알림이 꺼져 있고 5분 내 미확인일 때 |
  | Slack | 계정에 Slack 연결 시(F-11-11b와 별개인 개인 알림 경로) |
  - 핵심 설계 원칙: **"본 것으로 간주되면 발송 취소"**. 발송은 즉시가 아니라 지연 큐에 예약하고, 만료 직전에 읽음 여부를 재확인해 suppress한다.
  - 현재 그 페이지를 보고 있는 사용자에게는 알림이 뜨지 않는다.
  - 사용자 설정(`Settings → Notifications`): 모바일 푸시 on/off, 데스크톱 푸시 및 배지 아이콘 on/off, Slack 알림 on/off, 이메일 알림(워크스페이스 활동 / 페이지 업데이트 / 워크스페이스 다이제스트), **"항상 이메일 보내기"**(앱 접속 여부 무관).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 알림 예약 후 사용자가 읽음 | `suppress_reason='read_before_send'`로 취소 |
  | 이메일 반송/차단 | `state='failed'` + 백오프 재시도, 영구 실패 시 채널 비활성화 |
  | 푸시 토큰 만료 | 토큰 삭제, 다음 채널(이메일)로 폴백 |
  | 다중 기기 | 데스크톱 A 활성, 모바일 B 백그라운드 → 푸시는 비활성 기기에만 |
  | 대량 알림 | 사용자당 시간당 상한 + 다이제스트(묶음 이메일)로 전환 |
  | 조용한 시간/타임존 | **Notion에는 DND·조용한 시간·알림 스케줄 설정이 없다** — 공식 `notification-settings` 문서에 해당 항목이 존재하지 않는다(부재 확인, 1차 `[확인필요]` 해소). 채널 토글 on/off가 전부다. 클론에서는 `notification_delivery.suppress_reason='quiet_hours'` 경로를 미리 열어두되 v2로 미뤄도 무방 |
  | 채널 전부 꺼짐 | 인앱만 남음. 배지는 항상 동작 |
  | 빈 값 | 알림 본문·발췌를 만들 수 없으면(권한·삭제) **채널 발송 자체를 취소**한다. 내용 없는 푸시는 사용자 신뢰를 가장 빨리 잃는 방식이다 |
  | 중첩 | 같은 알림이 여러 채널로 나가되 **사용자에게는 1건으로 인지**되어야 한다. `notification` 1건 : `notification_delivery` N건 구조가 그 장치이며, 읽음은 알림 단위로 한 번만 기록한다 |
  | 동시편집 | 여러 기기에서 동시에 읽음 처리 → 서버 `read_at`이 권위. 이미 `sent`인 delivery는 회수하지 않는다(발송된 푸시는 되돌릴 수 없다) |
  | 삭제된 참조 | 예약과 실제 발송 사이(최대 5분)에 대상 페이지·코멘트가 삭제됨 → 발송 직전 재조회로 확인해 `suppressed(target_gone)` |
  | 권한 없음 | **발송 직전에도 수신자 권한을 재검증**한다. 예약 시점과 발송 시점 사이에 권한이 회수될 수 있으며, 이 창이 이 도메인에서 가장 흔한 정보 유출 지점이다 |
  | 대용량 | 위 "대량 알림" 행 참조. 지연 큐가 밀릴 때는 드롭이 아니라 **다이제스트로 강등**해 흡수한다 |
  | 순환 참조 | Slack → Notion → Slack처럼 채널 간 왕복이 생기지 않도록, **외부에서 유입된 이벤트에는 발신 채널 태그를 붙여 같은 채널로 되돌리지 않는다** |

- **데이터 모델 함의**: `notification_delivery`(위) — **알림 1건 : 배송 N건** 구조가 핵심. 추가로 `device_token(user_id, platform, token, last_seen_at)`, `user_presence(user_id, page_id, last_heartbeat_at)`(활성 페이지 판정, Redis 권장), `user_notification_preference(user_id, channel, enabled, always_email)`.
- **UI/인터랙션**: 설정 화면은 채널별 토글 리스트, 각 토글 아래 1줄 설명. Slack은 `Add new account` → OAuth 플로우.
- **의존 기능**: F-11-07, F-11-08, 푸시 인프라(APNs/FCM/Web Push), 이메일 발송(SES/Postmark), presence 트래킹.
- **구현 난이도**: **XL (2주+)** — 채널 5개 각각의 인프라 연동 + 지연/억제 상태 기계 + presence + 재시도. 이 도메인에서 가장 무거운 항목이며 대부분이 외부 서비스 연동 작업이다.
- **우선순위**: **P1**(인앱 + 이메일) / **P2**(모바일 푸시, Slack).
- **클론 시 현실적 대안**: 인앱만 P0로 하고, 이메일은 "5분 지연 큐 + 읽음 시 취소" 한 가지 규칙만 구현. 모바일 푸시/Slack은 v2로. 지연 큐는 BullMQ/pg-boss의 delayed job으로 짧게 붙는다.
- **참고 출처**: https://www.notion.com/help/updates-and-notifications , https://www.notion.com/help/notification-settings , https://www.notion.com/help/reminders

---

### F-11-11b Slack 채널 연동 (페이지 업데이트 → Slack 브로드캐스트)

- **한 줄 정의**: 특정 페이지/데이터베이스의 편집·코멘트를 지정한 Slack 채널로 자동 전송한다. (개인 알림이 아니라 **채널 브로드캐스트**라는 점에서 F-11-11과 별개)
- **사용자 시나리오**:
  1. 페이지 우상단 `Updates` 패널 → `Connect Slack channel` 토글 on.
  2. Slack OAuth 인증(미연결 시).
  3. 드롭다운에서 대상 채널 선택.
  4. 이후 해당 페이지/DB **및 하위 페이지**의 편집·코멘트마다 채널에 메시지가 게시된다.
  - 별도 경로: 데이터베이스 `Automations` → 트리거(`Page added` / `Property edited`) → 액션 `Send Slack notification`.
- **동작 상세**: 위 흐름 전부 공식 문서 기준(하위 페이지 포함이 명시되어 있다). 게시 주체는 Notion Slack 앱 봇.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 비공개 페이지 → 공개 채널 | **정보 유출 위험**. 연결 시 경고 필수. Notion audit log가 page audience를 기록하는 이유와 같은 맥락 |
  | 편집 폭주 | 채널 스팸. 시간 윈도우(예: 5분) 집계 후 1건으로 게시 |
  | Slack 토큰 만료/채널 삭제 | 연결 비활성 + 페이지 소유자에게 인앱 알림 |
  | 하위 페이지 상속 | 자식에 개별 연결이 있으면 중복 게시 방지 |
  | 권한 없음 | 연결 설정은 페이지 편집 권한 + Slack 채널 게시 권한 둘 다 필요 |
  | 빈 값 | 변경 요약이 비면(공백만 편집 등) 게시하지 않는다 |
  | 중첩 | 위 "하위 페이지 상속" 행과 같은 원칙 — 자식에 개별 연결이 있으면 **가장 가까운 연결 하나만** 적용 |
  | 동시편집 | 여러 사람이 동시에 편집 → 집계 창(5분) 안에서 1건으로 묶고 "3명이 N회 편집" 형태로 게시 |
  | 삭제된 참조 | 연결 대상 페이지가 휴지통행 → 게시 중단하되 연결은 유지(복원 대비). 영구 삭제 시 연결 삭제 |
  | 대용량 | 워크스페이스 루트에 연결 + 하위 수천 페이지 → 채널 폭주. **연결 가능한 서브트리 크기에 상한**을 두거나 이벤트 종류를 코멘트로 한정 |
  | 순환 참조 | Slack 메시지가 다시 Notion 페이지를 만드는 양방향 연동을 붙이면 무한 루프가 된다. **Notion→Slack 단방향만** 유지하거나, 양방향이라면 메시지에 출처 마커를 심어 재유입을 차단 |

- **데이터 모델 함의**:
  ```sql
  slack_connection(id, workspace_id, slack_team_id, bot_token_enc, installed_by, created_at)
  page_slack_binding(id, page_id, slack_connection_id, channel_id, include_children bool,
                     event_mask text[], created_by, created_at)
  ```
- **UI/인터랙션**: `Updates` 패널 내 토글 + 채널 셀렉트. 연결 상태에서는 채널명 칩 표시.
- **의존 기능**: F-11-04(Updates 패널), F-11-09(상속 개념), Slack OAuth.
- **구현 난이도**: **M (2~5일)** — Slack OAuth + chat.postMessage + 집계 로직. 표준적이다.
- **우선순위**: **P2**.
- **클론 시 현실적 대안**: Slack 전용 대신 **generic outgoing webhook**(임의 URL로 JSON POST) 하나만 만들면 Slack/Discord/Teams를 모두 커버한다. Slack incoming webhook URL을 그대로 붙일 수 있어 OAuth도 생략 가능.
- **참고 출처**: https://www.notion.com/help/slack , https://www.notion.com/help/guides/unleashing-productivity-with-notions-slack-integration

---

### F-11-12 워크스페이스 감사 로그 (Audit Log, Enterprise) & SIEM 스트리밍

- **한 줄 정의**: 워크스페이스/조직에서 발생한 보안·관리 관련 이벤트를 변경 불가 로그로 남기고, 관리자가 조회·필터·내보내기하거나 SIEM으로 실시간 스트리밍한다.
- **사용자 시나리오**:
  1. 조직 소유자가 `Settings → Audit log` 진입(Enterprise 플랜만).
  2. 필터: 워크스페이스/조직 범위, 날짜 범위(최대 365일 창), 사람/통합/에이전트, 이벤트 타입, teamspace.
  3. 특정 이벤트 행의 돋보기 아이콘 → 연관 이벤트(related events) 추적.
  4. `Export CSV` → 필터된 결과만, 내보내기 시각 기준 최대 2시간 전 데이터까지 포함.
  5. 별도로 SIEM 웹훅 URL을 등록해 실시간 스트림 수신.
- **동작 상세** (전부 공식 문서 기준):
  - **보관: 최대 365일.** 그 이상 필요하면 정기 CSV 내보내기 또는 SIEM 적재.
  - 이벤트 카테고리와 대략적 종수: Page(15종: 생성/편집/조회/삭제/복원/영구삭제/공유/권한/파일/코멘트/제안/잠금 등), Workspace(60종+: 멤버 초대·역할 변경·제거, 통합 관리, SAML/SSO, IP 제한, 내보내기 제어, MCP·외부 AI 도구 설정 등), Account(11종: 로그인/로그아웃, 비밀번호, MFA, 이메일 변경, 계정 삭제), Teamspace(18종), Data source(6종: CRUD, 권한 규칙 변경, 스키마 편집), Form(4종), Organization(20종+: 도메인 관리, legal hold, 관리자 역할, API 키/토큰), Workers(11종), Custom agent(다수).
  - 이벤트 필드: actor(user/integration/bot/external AI tool), timestamp, IP 주소(가용 시), workspace/teamspace, event type, **page audience**(private / shared internally / shared externally / published to web).
  - **이벤트 반영에 지연이 있을 수 있다**고 명시. 실시간성이 필요하면 SIEM 스트림을 쓰라고 안내.
  - SIEM 웹훅: **워크스페이스당 1개**, 재시도 최대 7회/약 24시간, **메타데이터만 전송(페이지 내용 미포함)**, 워크스페이스 이벤트만(조직 이벤트 제외).
  - Admin API 활동은 전부 organization 이벤트로 기록된다.
  - 탈퇴한 사용자도 필터에서 검색 가능해야 한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | actor 계정 삭제 | 이벤트는 유지, 표시용 이름/이메일은 이벤트에 비정규화 저장 |
  | 페이지 영구 삭제 | 감사 이벤트는 **삭제하지 않는다**(그 삭제 사실 자체가 기록 대상) |
  | 로그 위변조 | append-only. 앱 DB 계정에서 UPDATE/DELETE 권한 제거가 정석 |
  | 대용량 | `page.viewed`가 압도적 다수 → 월 파티셔닝 + 컬럼 스토어(ClickHouse) 또는 객체 스토리지 아카이빙 |
  | SIEM 엔드포인트 장애 | 최대 7회 재시도 후 드롭. **드롭 사실 자체를 관리자에게 알려야** 컴플라이언스 공백을 인지 |
  | 권한 없음 | Enterprise 조직/워크스페이스 소유자 외 접근 시 403 + 그 시도 자체를 감사 이벤트로 |
  | 프라이버시 | 페이지 본문/코멘트 원문을 절대 metadata에 넣지 않는다. audience 수준만 기록 |
  | 빈 값 | 필터 결과 0건 → "해당 조건의 이벤트가 없습니다". 빈 CSV도 생성해 **내보내기 실패와 구분**한다 |
  | 중첩 | 조직 > 워크스페이스 > teamspace 3단 범위. 상위 범위 조회는 하위를 포함하되, **teamspace 관리자에게 조직 이벤트를 보여주면 안 된다** |
  | 동시편집 | append-only이므로 편집 충돌이 없다. 대신 재시도로 인한 **중복 삽입**을 막기 위해 `(actor, type, target, occurred_at)` 기반 멱등 키를 둔다 |
  | 삭제된 참조 | 대상 페이지·사용자가 삭제돼도 이벤트는 유지된다(위 행). 표시용 이름·이메일을 이벤트에 **비정규화 저장**했기 때문에 조회가 계속 가능하다 |
  | 순환 참조 | 감사 로그 조회 자체가 감사 이벤트(`audit_log.viewed`)를 만들면 무한 증식은 아니어도 노이즈가 지배적이 된다. **조회 이벤트는 세션 단위 1건만** 기록 |

- **데이터 모델 함의**: `audit_event`, `siem_webhook`, `siem_delivery(event_id, attempt, status, next_retry_at)`. `audit_event`는 애플리케이션 테이블과 **다른 스토리지로 분리**하는 것이 장기적으로 옳다(보관 정책·볼륨·쿼리 패턴이 전부 다름).
- **UI/인터랙션**: 관리자 설정 내 테이블 뷰. 상단 필터 바, 행 확장으로 상세 JSON, 각 행 돋보기 → 연관 이벤트. CSV 내보내기 버튼(비동기 잡 + 완료 이메일).
- **의존 기능**: 조직/워크스페이스/teamspace 모델, 권한 모델, 관리자 설정, 모든 도메인의 이벤트 발행 훅.
- **구현 난이도**: **XL (2주+)** — 기능 자체보다 "모든 도메인에 이벤트 발행 훅을 빠짐없이 심는 것"이 비용이다. 100종 이상의 이벤트 타입을 정의·유지해야 한다.
- **우선순위**: **P2** — 엔터프라이즈 판매가 목표가 아니면 클론 MVP에 불필요.
- **클론 시 현실적 대안**: 이벤트 타입 100종 대신 **보안 관련 10종만**(로그인, 권한 변경, 멤버 초대/제거, 페이지 공유 설정 변경, 영구 삭제, 내보내기) 정의하고 `audit_event` 한 테이블 + 단순 필터 UI. SIEM 대신 F-11-11b의 generic webhook 재사용.
- **참고 출처**: https://www.notion.com/help/audit-log , https://developers.notion.com/compliance/overview , https://www.notion.com/pricing

---

### F-11-13 외부 통합용 이벤트 웹훅 (Public API Webhooks)

- **한 줄 정의**: 서드파티 통합이 워크스페이스의 변경 이벤트를 실시간으로 구독하게 한다. (감사 로그와 달리 **개발자용**, 통합의 권한 범위 내 이벤트만)
- **사용자 시나리오**: 개발자가 integration을 만들고 웹훅 URL을 등록 → Notion이 검증 토큰을 보냄 → 검증 완료 후 구독한 이벤트가 POST로 들어옴.
- **동작 상세** (developers.notion.com 기준):
  - **이벤트 타입 23종**, 4개 카테고리 *(1차 문서의 "26종"은 오류. 아래 나열 합계 = 8+6+6+3 = 23이며, 원문 표를 직접 세어 확인)*:
    - **Page(8)**: `page.created`, `page.content_updated`, `page.properties_updated`, `page.deleted`, `page.undeleted`, `page.moved`, `page.locked`, `page.unlocked`
    - **Database(6, 그중 2종 deprecated)**: `database.created`, `database.deleted`, `database.undeleted`, `database.moved` + 2025-09-03 버전에서 deprecated된 `database.content_updated`·`database.schema_updated` → **실질 유효 21종**
    - **Data source(6)**: `data_source.created/deleted/undeleted/moved/content_updated/schema_updated` (deprecated된 database 이벤트를 대체)
    - **Comment(3)**: `comment.created`, `comment.updated`, `comment.deleted` — 이 3종과 `page.locked`/`page.unlocked`만 **비집계(not aggregated)**, 나머지 18종은 전부 집계 대상이다
  - 공통 페이로드 필드: `id`, `timestamp`(ISO8601), `workspace_id`, `subscription_id`, `integration_id`, `type`, `authors[]`, `accessible_by[]`, `attempt_number`(1~8), `entity{id,type}`, `data{}`.
  - **집계**: `page.content_updated` 같은 고빈도 이벤트는 짧은 시간 창 내 변경을 하나로 묶어 전송. 집계 이벤트는 보통 1분 미만 지연.
  - **순서 보장 없음** — `timestamp`로 재정렬해야 하며, 페이로드가 최신 상태를 반영하지 않을 수 있어 API 재조회가 권장된다.
  - **at-most-once 지향**, 지수 백오프로 최대 8회 재시도, 마지막 재시도는 최초 트리거로부터 약 24시간 후.
  - 도달 목표: 5분 이내, 대부분 1분 이내.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 소비자 엔드포인트 다운 | 백오프 재시도 → 8회 후 드롭 + 구독 비활성화 알림 |
  | 이벤트 순서 역전 | 소비자가 timestamp로 정렬. 생산자는 보장하지 않음을 문서화 |
  | 통합 권한 밖 페이지 | 이벤트 미전송. `accessible_by`로 수신자 판정 |
  | 대량 임포트 | 집계 창을 늘려 폭주 억제 |
  | 재생(replay) 필요 | 웹훅만으로는 불가 → 폴링 API(`last_edited_time` 커서) 병행 안내 |
  | 서명 검증 | 공유 시크릿 기반 HMAC 헤더 필수 |
  | 빈 값 | `data{}`가 빈 이벤트라도 전송한다. 소비자는 어차피 API 재조회가 권장되므로 **이벤트의 존재 자체가 신호**다 |
  | 중첩 | 부모·자식 페이지가 함께 바뀌면 이벤트가 각각 발생한다. **부모 이벤트로 자식 변경을 대신 표현하지 않는다** — 소비자가 자식을 놓친다 |
  | 동시편집 | 여러 actor의 변경이 집계 창 안에서 합쳐지면 `authors[]`에 복수가 담긴다. 소비자는 단일 actor를 가정하면 안 된다 |
  | 삭제된 참조 | `page.deleted` 이후에는 그 id로 API 조회가 실패한다 → 페이로드만으로 최소 정보를 얻을 수 있도록 `entity{id,type}`를 항상 채워 보낸다 |
  | 권한 없음 | 위 "통합 권한 밖 페이지" 행에 더해, 권한이 **이벤트 발생 후 전송 전에** 회수될 수 있으므로 전송 직전 `accessible_by`를 재판정한다 |
  | 대용량 | 위 "대량 임포트" 행 참조. 소비자가 느려 큐가 적체되면 드롭이 아니라 **집계 창 확대**로 흡수하고, 구독당 초당 전송 상한을 둔다 |
  | 순환 참조 | **이 도메인에서 가장 흔한 실사고** — 웹훅 소비자가 다시 API로 쓰기를 하면 그 쓰기가 또 웹훅을 만든다. 생산자는 `integration_id`를 페이로드에 실어(실제로 실린다) 소비자가 자기 변경을 걸러낼 수 있게 한다. 클론은 한 걸음 더 나아가 **자기 integration이 만든 변경은 그 integration에게 전송하지 않는 것을 기본값**으로 삼기를 권한다 |

- **데이터 모델 함의**:
  ```sql
  webhook_subscription(id, integration_id, workspace_id, url, secret, event_types text[],
                       state, verified_at, created_at)
  webhook_delivery(id, subscription_id, event_id, attempt_number, status_code,
                   delivered_at, next_retry_at)
  ```
  `activity_event`를 소스로 쓰되, 통합 권한으로 필터링하는 계층이 필요하다.
- **UI/인터랙션**: 개발자 포털 화면(구독 생성, URL 검증, 이벤트 타입 체크박스, 최근 전송 로그). 제품 UI 아님.
- **의존 기능**: 공개 API, integration/OAuth 모델, `activity_event`.
- **구현 난이도**: **L (1~2주)** — 발행/집계/재시도/서명은 표준이지만 권한 필터링과 이벤트 타입 커버리지가 일이다.
- **우선순위**: **P2** — 클론에 서드파티 생태계가 없으면 불필요. 단 **자동화(F-11-11b, DB automations)의 백엔드로 재사용**할 수 있어 내부용으로 먼저 만들 가치는 있다.
- **클론 시 현실적 대안**: 공개 웹훅 대신 **내부 이벤트 버스(Redis Stream / PostgreSQL NOTIFY)** 하나만 두고, Slack 전송·알림 생성·검색 인덱싱이 모두 이 버스를 소비하게 한다. 외부 노출은 나중에 어댑터로.
- **참고 출처**: https://developers.notion.com/reference/webhooks-events-delivery

---

### F-11-14 실행 취소(Undo)와 히스토리의 경계

- **한 줄 정의**: 초 단위 되돌리기는 클라이언트 undo 스택이, 분/일 단위는 버전 히스토리가, 페이지 단위는 휴지통이 담당한다. 세 층의 경계를 명확히 한다.
- **사용자 시나리오**: 블록을 잘못 지움 → `Ctrl/Cmd+Z`로 즉시 복구. 1시간 전 문단을 되살리고 싶음 → Page history. 어제 지운 페이지를 되살리고 싶음 → Trash.
- **동작 상세**:
  - **블록 단위 휴지통은 "UI에 없을 뿐 데이터 모델에는 있다"** *(1차 서술 정정, F-11-05 참조)*. 헬프센터는 블록 복구 수단으로 휴지통을 안내하지 않지만, 공개 API의 `DELETE /v1/blocks/{id}`는 블록을 `in_trash: true`로 만들고 "moves the block to the Trash where it can still be accessed and restored"라고 명시한다.
  - 따라서 **사용자에게 노출되는 경계는 여전히 3층**(undo → 히스토리 → 페이지 휴지통)이지만, **서버는 블록도 soft delete로 다뤄야** API 복원 경로와 참조 무결성이 성립한다. 대량 블록 삭제 시 경고 토스트는 그대로 필요.
  - undo 스택은 클라이언트 로컬·세션 한정이며, 협업 환경에서는 **자기 자신의 변경만 되돌리는 local undo**여야 한다. Yjs의 `UndoManager`가 `trackedOrigins`로 이를 지원한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 새로고침 후 Undo | 스택 소실. 히스토리로 안내 |
  | 동시편집 중 Undo | 자기 origin의 변경만 되돌림. 타인 변경 보존 |
  | 페이지 삭제를 Undo | 휴지통에서 자동 복원(토스트의 실행 취소) |
  | 데이터베이스 대량 행 삭제 | undo로 복구 가능해야 함. 불가하면 삭제 전 확인 모달 필수 |
  | 권한 없음 | undo도 서버에서 편집 권한 재검증 |
  | 대용량 | undo 스택 크기 상한(예: 100 트랜잭션) |
  | 빈 값 | undo 스택이 비었을 때 `Ctrl/Cmd+Z`는 무동작. "되돌릴 변경이 없습니다" 토스트를 띄우지 말 것(에디터의 기본 기대와 다르다) |
  | 중첩 | 토글/컬럼 안의 블록을 undo로 되살릴 때 **조상이 이미 삭제되었으면 되살릴 자리가 없다** → 조상까지 함께 복원하거나, 불가하면 페이지 말미에 복원한 뒤 이동을 안내 |
  | 삭제된 참조 | undo 대상 블록이 참조하던 파일·페이지가 그 사이 파기됨 → 블록은 되살리되 참조는 "삭제됨"으로 렌더 |
  | 순환 참조 | undo↔redo 왕복이 무한히 가능한 것은 **정상**이다. 단 협업 undo는 역연산 op를 새로 발행하므로 왕복할 때마다 `doc_update`가 쌓인다 → 이를 히스토리 오염으로 보지 말고, F-11-01의 스냅샷 규칙(10분/2분)이 흡수하게 둔다 |

- **데이터 모델 함의**: 서버 스키마 없음(클라이언트 상태). 단 "삭제 직후 실행 취소" 토스트를 위해 `trash_root_id`와 최근 삭제 잡 ID를 클라이언트가 보유해야 한다.
- **UI/인터랙션**: `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`. 삭제 토스트의 `실행 취소` 버튼(5초).
- **의존 기능**: 에디터 상태 관리, F-11-01, F-11-05.
- **구현 난이도**: **M (2~5일)** — *(1차 S에서 상향)* 단일 사용자 undo만이면 라이브러리 한 줄(S)이 맞다. 그러나 이 기능의 정의는 **협업 환경의 3층 경계**이며, 여기에는 ① Yjs `UndoManager`의 `trackedOrigins` 설정과 "내 변경만 되돌아가는지" 검증, ② 페이지 삭제 undo(서버 상태 되돌리기 — 클라이언트 스택으로 불가, F-11-05의 복원 API 호출), ③ DB 대량 행 삭제 undo, ④ 서버 측 편집 권한 재검증이 포함된다. 특히 ②는 클라이언트 undo 스택과 서버 상태를 **한 단축키 아래에 합치는** 작업이라 경계 설계가 필요하다.
- **우선순위**: **P0** — 에디터의 기본 기대치.
- **클론 시 현실적 대안**: 에디터 프레임워크(ProseMirror/Tiptap/Lexical) 내장 history 플러그인을 그대로 사용. 협업 시 Yjs `UndoManager`에 `trackedOrigins` 설정.
- **참고 출처**: https://www.notion.com/help/duplicate-delete-and-restore-content , https://docs.yjs.dev/getting-started/a-collaborative-editor , https://github.com/yjs/yjs

---

### F-11-15 블록 단위 편집 이력 (created_by / last_edited_by)

- **한 줄 정의**: 모든 블록·페이지·데이터베이스가 "누가 만들었고 누가 마지막으로 고쳤는지"를 자기 자신에 들고 있어, 페이지 히스토리를 열지 않고도 개별 블록의 책임자를 알 수 있다.
- **사용자 시나리오**:
  1. (제품 UI) 데이터베이스에 `Created by` / `Last edited by` / `Created time` / `Last edited time` property를 추가 → 각 행이 자동으로 채워진다. 사용자가 직접 값을 편집할 수 없는 읽기 전용 property다.
  2. (제품 UI) 페이지의 "Last edited by 홍길동 · 2시간 전" 표시.
  3. (API) `GET /v1/blocks/{id}` 응답의 `created_by`, `created_time`, `last_edited_by`, `last_edited_time`을 읽어 외부 도구가 동기화 커서로 사용.
- **동작 상세**:
  - 공개 API의 **block / page / database 오브젝트 모두**가 `created_by`·`last_edited_by`(user object, `{object, id}`)와 `created_time`·`last_edited_time`을 갖는다.
  - **타임스탬프는 분 단위로 내림된다**(공식 changelog: "rounded down to the closest minute"). 초 단위 정밀도를 가정한 클라이언트 로직(정밀 커서 페이지네이션, 낙관적 잠금)은 이 때문에 깨진다.
  - 이것은 **이력이 아니라 최신 1건**이다. 블록별 전체 변경 이력을 노출하는 공개 API는 없다 → 블록 단위 "누가 언제 무엇을"이 필요하면 F-11-01(페이지 히스토리) 또는 F-11-12(audit log)로 가야 한다.
  - 봇/통합이 편집하면 `last_edited_by`가 그 integration의 bot user id가 된다.
  - `[확인필요]` 자식 블록 편집이 부모 블록의 `last_edited_time`을 올리는지. `[추정]` 페이지 루트는 올라간다(페이지 목록의 "최근 편집순" 정렬이 그렇게 동작하므로), 중간 블록까지 전파되지는 않을 것.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 (마이그레이션·임포트로 들어온 레거시 블록) | `created_by`를 NULL 허용하면 널 처리가 모든 조회로 번진다. **시스템 사용자(`user:system`) 한 명을 만들어 채우는 편**이 안전 |
  | 중첩 | 자식 편집 시 부모까지 갱신하면 루트까지 N번 UPDATE(write amplification). **페이지 루트만 갱신**하고 중간 블록은 자기 변경 시에만 갱신할 것 |
  | 동시 편집 | 마지막 쓰기 승. CRDT 머지로 두 사람 변경이 합쳐지면 `last_edited_by`에는 마지막 update의 actor 하나만 남는다 → "N명이 편집함" UI는 F-11-01의 `editor_ids`로 따로 계산해야 한다 |
  | 삭제된 참조 (편집자 계정 탈퇴) | user id는 유지, 렌더링만 "삭제된 사용자". **`app_user` FK에 `ON DELETE SET NULL`을 걸면 이력이 증발**하므로 걸지 말 것 |
  | 권한 없음 | `Created by`/`Last edited by` property는 **다른 멤버의 실명을 노출**한다. 게스트에게 이 property를 숨길지가 정책 결정 포인트. `[확인필요]` Notion의 게스트 노출 여부 |
  | 대용량 | 타이핑 1회마다 2컬럼 UPDATE는 부담. **분 단위 내림을 역이용해 같은 분 안의 반복 편집은 UPDATE를 스킵**한다(Notion이 분 단위로 자르는 이유가 이것일 가능성 `[추정]`) |
  | 순환 참조 | 해당 없음(스칼라 필드) |
- **데이터 모델 함의**: 별도 테이블 없이 `block` 테이블의 4개 컬럼으로 끝난다(위 의사 스키마).
  ```sql
  ALTER TABLE block
    ADD COLUMN created_by     uuid NOT NULL REFERENCES app_user(id),  -- ON DELETE 동작 지정 금지
    ADD COLUMN created_at     timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN last_edited_by uuid NOT NULL REFERENCES app_user(id),
    ADD COLUMN last_edited_at timestamptz NOT NULL DEFAULT now();
  CREATE INDEX ON block (last_edited_at DESC);   -- 외부 동기화/웹훅 커서용
  -- API 노출 시에만 절삭: date_trunc('minute', last_edited_at)
  ```
  DB property로 노출할 때 값을 **중복 저장하지 않는다** — `Created by` property는 스키마에만 존재하고 값은 이 컬럼에서 파생시킨다(복제하면 반드시 어긋난다).
- **UI/인터랙션**: DB property 추가 메뉴에서 `Created by` / `Last edited by` / `Created time` / `Last edited time` 선택. 셀은 읽기 전용(클릭해도 편집 커서 없음), 아바타 + 이름 칩. 페이지 상단 호버 시 "Last edited by X" 툴팁.
- **의존 기능**: 블록 트리, 사용자 모델, (property로 노출하려면) 데이터베이스 property 시스템.
- **구현 난이도**: **S (1일 내)** — 컬럼 4개 + 쓰기 경로에서 채우기. 단 **블록 저장 경로가 여러 군데로 흩어져 있으면 누락이 생기므로**, 저장이 단일 repository 함수로 모여 있어야 S다. 흩어져 있으면 M.
- **우선순위**: **P1** — 없어도 제품은 돌지만 F-11-04(활동 피드)·F-11-13(웹훅 커서)·DB property 4종이 전부 여기에 매달린다. 무엇보다 **나중에 넣으면 백필이 불가능**하다(과거 편집자를 알 방법이 없다). "스키마 초기에 넣어야 하는 P1"로 취급한다.
- **클론 시 현실적 대안**: 분 단위 내림은 흉내내지 말고 `timestamptz`를 그대로 노출한다(Notion의 내림은 캐시/부하 최적화의 흔적으로 보이며 클론에 이득이 없다). `Created by`/`Last edited by` **property 노출은 v2로 미루되 컬럼 4개는 1일차에 넣는다**.
- **참고 출처**: https://developers.notion.com/changelog/created-by-and-last-edited-by-properties-in-block-page-and-database-objects , https://developers.notion.com/changelog/last-edited-time-is-now-rounded-to-the-nearest-minute , https://developers.notion.com/reference/block

---

### F-11-16 제안 편집 (Suggested edits)

- **한 줄 정의**: 편집 권한이 없거나 즉시 반영하고 싶지 않은 변경을 **본문에 커밋하지 않은 대기 레이어**로 제안하고, 페이지 소유자가 항목별로 수락/거절한다.
- **사용자 시나리오**:
  1. 페이지 상단 `···` → `Suggest edits` → 헤더에 `Suggesting` 배지가 뜬다.
  2. 이 모드에서 타이핑하면 **추가 제안**, 지우면 **삭제 제안**이 된다. 본문은 아직 바뀌지 않는다.
  3. 제안이 페이지 사이드바에 카드로 쌓인다. 각 카드에 코멘트를 달거나 이모지 리액션을 붙일 수 있다.
  4. 제안이 생기면 **페이지 소유자의 Inbox에 알림**이 간다.
  5. 소유자가 카드에 hover → `✔️` 수락(본문 반영) / `❌` 거절(제안 소멸).
  6. `Suggesting` 옆 `X` 또는 메뉴의 `Stop`으로 모드 종료.
- **동작 상세** (공식 문서 기준):
  - **필요 권한: `Can comment` 이상.** 즉 이 기능의 존재 이유는 **편집 권한 없는 사람이 편집을 "요청"하는 통로**를 만드는 것이다.
  - **대상 블록 타입이 제한된다**: `text`, `to-do list`, `heading`, `bulleted list`, `numbered list` 5종. 이미지·코드·임베드·표 등은 제안 대상이 아니다.
  - **제안할 수 없는 위치**: 인라인 데이터베이스, 데이터베이스 property, peek view로 열린 페이지.
  - **잠긴(locked) 페이지에는 제안할 수 없다.**
  - 2024-07-29 릴리스(Notion 2.43)로 도입된 비교적 최근 기능이다.
  - `[확인필요]` 플랜 조건 — 헬프센터는 권한(`Can comment`)만 조건으로 서술하고 플랜을 명시하지 않는다.
  - `[확인필요]` 수락된 제안이 버전 히스토리에 누구 명의로 남는가. `[추정]` 커밋 actor는 **수락자**이고 제안자는 `suggestion.author_id`로만 남을 것 — 그렇지 않으면 편집 권한 없는 사람이 페이지의 `last_edited_by`가 되어 권한 모델과 모순된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 (내용 없는 제안) | 생성 자체를 막는다(빈 insert + 빈 delete = no-op) |
  | 중첩 | 제안이 걸린 블록이 토글/컬럼 안에 있으면 접힌 상태에서도 사이드바 카드로 접근 가능해야 한다. 카드 클릭 → 조상 토글 자동 펼침 + 스크롤 |
  | **동시 편집 (이 기능의 핵심 난점)** | 제안이 대기하는 동안 다른 사람이 같은 문단을 고치면 앵커가 흔들린다. **절대 offset으로 저장하면 100% 깨진다** → CRDT relative position(Yjs `createRelativePositionFromTypeIndex`)으로 앵커링하고, 앵커 소실 시 `state='stale'`로 전이시켜 원문 스니펫(`suggestion.original`)과 함께 "원문이 변경되어 적용할 수 없습니다"로 표시 |
  | 같은 범위에 제안 2개 | 먼저 수락된 쪽이 이기고 나머지는 `stale`. 수락은 **행 잠금 하에 순차 처리** |
  | 삭제된 참조 (제안 대상 블록이 삭제됨) | `stale`로 전이. 자동 삭제하지 말 것 — 제안자에게 "왜 사라졌는지"를 설명할 근거가 필요하다 |
  | 권한 없음 | `Can view`는 제안 모드 진입 불가. 수락/거절은 `Can edit` 이상. 제안자 본인은 자기 제안의 **철회**만 가능 |
  | 대용량 | 문서를 뒤엎는 100+개 제안 → 사이드바 가상 스크롤 + `Accept all`/`Reject all` 벌크 액션. 벌크 수락은 **단일 CRDT 트랜잭션**으로 묶어 브로드캐스트 1회 |
  | 페이지가 휴지통행 | 제안은 유지(복원 시 되살아나야 함), 알림만 억제 |
  | 순환 참조 | 해당 없음 |
- **데이터 모델 함의**: 위 의사 스키마의 `suggestion` 테이블. 설계 핵심 3가지:
  1. **제안은 본문 블록에 쓰지 않는다.** `block.content`는 그대로 두고 `suggestion` 행만 쌓은 뒤, 렌더링 시 에디터가 오버레이(밑줄/취소선 데코레이션)로 합성한다 — ProseMirror `Decoration`, Lexical의 decorator가 정확히 이 용도다.
  2. **앵커는 반드시 상대 좌표.** `anchor jsonb`에 CRDT relative position을 인코딩한다.
  3. **수락 = "제안 → CRDT op 변환 → 적용 → state 전이"의 원자 트랜잭션.** 부분 적용이 남으면 문서가 깨진다.
  ```sql
  CREATE INDEX ON suggestion (page_id, state) WHERE state = 'open';  -- 페이지 열 때 조회
  CREATE INDEX ON suggestion (author_id, created_at DESC);           -- "내가 낸 제안" 화면
  CREATE INDEX ON suggestion (thread_id);                            -- 카드의 코멘트 결합
  ```
- **UI/인터랙션**: `···` → `Suggest edits`. 활성 시 헤더에 `Suggesting` 배지 + `X`. 추가 제안은 밑줄+색상, 삭제 제안은 취소선. 우측 사이드바 제안 카드(작성자 아바타, 변경 미리보기, `✔️`/`❌`, 코멘트 입력, 이모지 리액션). 카드 hover 시 본문의 대응 범위 하이라이트.
- **의존 기능**: 코멘트 스레드, 권한 모델(`Can comment` 레벨이 실제로 존재해야 함), CRDT 기반 에디터 + decoration API, 페이지 잠금(lock), F-11-07(제안 도착 알림), F-11-08(알림 생성 규칙에 `suggestion.created` 추가).
- **구현 난이도**: **L (1~2주)** — 화면 규모는 작지만 **"본문에 커밋되지 않은 변경을 문서와 함께 살아 움직이게 유지"** 라는 요구가 어렵다. 앵커 유실 처리, 제안 간 충돌, 벌크 수락의 원자성이 전부 여기서 나온다. 에디터에 decoration 기능이 없다면 XL.
- **우선순위**: **P2** — 협업 클론에서도 후순위다. 같은 목적(편집 권한 없는 사람의 피드백)을 **인라인 코멘트가 80% 대체**하며, 코멘트는 어차피 P0/P1로 만들어야 한다.
- **클론 시 현실적 대안**: ① **인라인 코멘트 + 제안 텍스트** — 코멘트 본문에 대체 문구를 적고 소유자가 수동 반영. 구현 비용 0. ② 그래도 필요하면 **삭제 제안을 빼고 "추가 제안"만** 지원하면 앵커 문제가 절반으로 줄어든다. ③ 실제로 필요해지는 시점은 "외부 게스트가 문서에 기여하는" 유스케이스가 생길 때다.
- **참고 출처**: https://www.notion.com/help/suggested-edits , https://www.notion.com/releases/2024-07-29 , https://www.notion.com/help/sharing-and-permissions

---

### F-11-17 자동화 기반 알림 (Database automations)

- **한 줄 정의**: 데이터베이스에 "이 조건이 되면 이 사람에게 알려라"를 노코드 규칙으로 걸어, **사람의 행위가 아니라 데이터 상태 변화**가 알림을 만들게 한다.
- **사용자 시나리오**:
  1. 데이터베이스 우상단 `⚡`(Automations) → `New automation`.
  2. 트리거 선택: `Page added` / `Property edited`(대상 property 지정) / `Recurring`(주기 설정).
  3. 트리거가 여러 개면 `When any of these occur` / `When all of these occur` 중 선택.
  4. 액션 선택: `Send notification to` / `Send Slack notification` / `Send mail to` / `Send webhook` / `Edit property` / `Add page to` / `Edit pages in` / `Define variables`.
  5. 저장 → 이후 조건 충족 시 지정된 사람의 Inbox(또는 Slack/이메일)로 알림이 도착한다.
- **동작 상세** (전부 공식 문서 기준):
  - **트리거 3종**: `Page added`(새 행), `Property edited`(지정 property 변경), `Recurring`(설정 주기 반복 = 스케줄 트리거).
  - **알림 관련 액션 3종과 그 제약**:
    | 액션 | 수신자/대상 | 제약 |
    |---|---|---|
    | `Send notification to` | 워크스페이스 멤버 **최대 20명**, 또는 특정 People property에 연결된 사람들 | Notion 인앱 알림 |
    | `Send Slack notification` | 지정 Slack 채널 | **Plus/Business/Enterprise 전용**. 단 **Free 플랜은 "Slack 알림 automation만" 만들 수 있고 다른 종류는 불가**. **private DM은 대상 선택 불가**. **메시지에 formula를 쓸 수 없다** |
    | `Send mail to` | 이메일 주소 | Gmail 연동 필요. **도착까지 최대 2분** |
  - **3초 창(three second window)**: 자동화는 3초 윈도우로 동작한다. 이 3초 안에 사용자가 트리거를 취소하고 변경을 되돌리면 **property 변경이 없었던 것으로 간주되어 실행되지 않는다.** → 사실상 **디바운스 + 최종 상태 재비교** 방식임을 시사하며, 클론이 그대로 채택할 만한 설계다(실수 되돌리기가 알림 스팸을 만들지 않는다).
  - **자동화는 다른 자동화를 트리거하지 못한다** — "Database automations can't be triggered by other automations." 무한 루프 차단 장치다. 단 **사용자가 버튼을 눌러 페이지를 만드는 것은** 자동화를 트리거한다(사람 행위이므로).
  - `[확인필요]` 자동화가 만든 알림의 actor가 자동화 자체인지 자동화 생성자인지. `[추정]` 생성자 명의일 가능성이 높다 — 실행 권한의 기준이 필요하기 때문.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 | `Property edited`에서 **값이 비워진 것도 편집**이다. "값이 채워졌을 때만"을 원하면 별도 조건 필터가 필요 |
  | 중첩 (자동화가 만든 행이 또 다른 자동화의 조건에 해당) | **실행하지 않는다**(공식 제약). 클론도 `run_id` 컨텍스트를 전파해 **자동화 컨텍스트에서 발생한 이벤트는 트리거 매칭에서 제외**할 것 |
  | **순환 참조 (A→B→A 자동화 체인)** | 위 규칙으로 원천 차단된다. 규칙이 없다면 **run당 depth 상한(예: 3) + 워크스페이스당 분당 실행 상한**을 반드시 둔다 — 이게 없으면 사용자 한 명이 워커 풀을 마비시킬 수 있다 |
  | 동시 편집 | 2명이 3초 안에 같은 property를 바꾸면 **최종 상태에 대해 1회만** 실행. 중간 값에 대한 알림은 발생하지 않는다 |
  | 삭제된 참조 (대상 People property가 비거나 수신자가 탈퇴) | 수신자 0명 → 실패가 아니라 `skipped(no_recipients)`로 기록하고, 자동화 편집 화면에 경고 배지 |
  | 대상 페이지가 휴지통행 | 실행 억제. 자동화 정의 자체는 DB에 붙어 있으므로 유지 |
  | 권한 없음 | **자동화는 생성자 권한으로 실행되므로 권한 상승 통로가 된다.** 알림 수신자에게 해당 행 접근 권한이 없으면 제목·property 값을 알림 본문에 넣지 말 것. Slack 채널 전송은 F-11-11b와 동일한 유출 위험 |
  | 대용량 (임포트로 500행 일괄 추가) | `Page added`가 500회 발화 → 알림 폭주. **벌크 작업 플래그로 자동화 억제** 또는 상한 초과 시 "N건 생략됨" 요약 알림 1건으로 대체 |
  | 자동화 생성자가 워크스페이스를 떠남 | 실행 주체 소멸 → 자동화를 비활성화하고 DB 소유자에게 통지 |
- **데이터 모델 함의**: 위 의사 스키마의 `automation_notification_source`는 "알림 → 자동화" 역추적용이고, 자동화 본체는 별도 엔티티다.
  ```sql
  automation (
    id             uuid PK,
    data_source_id uuid NOT NULL,       -- 붙는 대상 DB
    name           text,
    enabled        bool NOT NULL DEFAULT true,
    match_mode     text NOT NULL,       -- 'any' | 'all'
    created_by     uuid NOT NULL,       -- ★ 실행 권한의 기준
    created_at     timestamptz NOT NULL
  )
  automation_trigger (
    id uuid PK, automation_id uuid NOT NULL,
    kind          text NOT NULL,        -- 'page_added' | 'property_edited' | 'recurring'
    property_id   uuid,                 -- property_edited일 때
    schedule_cron text, timezone text   -- recurring일 때
  )
  automation_action (
    id uuid PK, automation_id uuid NOT NULL, seq int NOT NULL,
    kind   text NOT NULL,               -- 'notify_people' | 'slack' | 'email' | 'webhook'
                                        -- | 'edit_property' | 'add_page' | 'edit_pages'
    config jsonb NOT NULL               -- 수신자 목록(≤20), 채널 id, 메시지 템플릿 등
  )
  automation_run (
    id uuid PK, automation_id uuid NOT NULL,
    trigger_event_id uuid,              -- activity_event 참조
    page_id     uuid,
    state       text NOT NULL,          -- 'pending'|'succeeded'|'skipped'|'failed'
    skip_reason text,                   -- 'reverted_in_window' | 'no_recipients'
                                        -- | 'triggered_by_automation' | 'rate_limited'
    started_at timestamptz, finished_at timestamptz, error text,
    INDEX (automation_id, started_at DESC)
  )
  -- 3초 창 구현: activity_event를 곧장 소비하지 말고
  --   pending_trigger(page_id, property_id, before_value, first_seen_at)에 모았다가
  --   first_seen_at + 3s 시점에 "현재 값 vs before_value"를 재비교해 실행 여부를 결정한다.
  ```
  `automation_run`을 남기지 않으면 **"왜 알림이 안 왔는가"를 영원히 디버깅할 수 없다** — 자동화 기능의 지원 비용 대부분이 여기서 발생한다.
- **UI/인터랙션**: DB 헤더의 `⚡` 아이콘 → 자동화 목록 팝오버 → `New automation` → 트리거/액션 빌더(드롭다운 체인). 수신자 선택은 사람 서제스트 + "People property에서 가져오기" 옵션. 각 자동화 행에 on/off 토글과 최근 실행 상태 점.
- **의존 기능**: 데이터베이스 + property 시스템(특히 People property), F-11-07/F-11-08(알림 생성), F-11-11(채널 팬아웃), F-11-11b(Slack 연결), `activity_event` 버스, 스케줄러(`Recurring` 트리거 — F-11-10 리마인더 스케줄러와 공유), 플랜 모델(Slack 액션 게이팅).
- **구현 난이도**: **L (1~2주)** — 트리거 3종 × 액션 8종의 매트릭스보다 ① 3초 디바운스 창의 정확한 구현(최종 상태 재비교), ② 재진입 차단(run 컨텍스트 전파), ③ 실행 이력·에러 노출 UI, ④ **생성자 권한으로 실행하는 보안 경계**가 비용이다. 액션을 알림 3종으로 한정하면 M.
- **우선순위**: **P2** — 데이터베이스 도메인이 먼저 성립해야 의미가 있다. 다만 **"사람의 행위가 아닌 상태 변화가 알림을 만드는" 유일한 경로**이므로, 프로젝트 관리 용도를 겨냥한다면 P1로 올린다.
- **클론 시 현실적 대안**: ① 노코드 빌더를 만들지 말고 **"`Status`가 특정 값이 되면 `Assignee`에게 알림"** 하나만 하드코딩 — 실사용의 대부분이 이 한 규칙이다. ② `Send webhook` 액션을 먼저 만들면(F-11-13의 내부 이벤트 버스 재사용) Slack·이메일·기타를 외부에서 처리할 수 있어 액션 종류를 늘릴 필요가 없다. ③ `Recurring` 트리거는 F-11-10의 `reminder` 스케줄러를 그대로 재사용한다 — **cron 인프라를 두 벌 만들지 말 것**.
- **참고 출처**: https://www.notion.com/help/database-automations , https://www.notion.com/help/slack , https://www.notion.com/help/guides/create-streamlined-project-management-workflow-using-database-automations

---

### F-11-18 활동·알림 데이터 수명 & 조회 기록 프라이버시

- **한 줄 정의**: 이 도메인이 만들어내는 이벤트·알림·조회 로그가 무한히 쌓이지 않도록 보관 기간을 정하고, 사용자가 자신의 조회 기록 수집을 거부할 수 있게 한다.
- **사용자 시나리오**:
  - (사용자) `Settings → Preferences → Privacy`에서 **내 페이지 조회 기록 수집을 끈다** → 이후 내가 연 페이지의 Analytics 조회자 목록에 내가 나타나지 않는다.
  - (사용자) 특정 페이지의 `Analytics` 탭 → `Settings` → `Don't record` 로 그 페이지에 한해서만 끈다.
  - (클론 관리자) 워크스페이스 설정에서 활동 로그 보관일 수를 정한다. **※ Notion에는 이 관리자 UI가 없다 — 클론이 스스로 정해야 하는 정책이다.**
- **동작 상세**:
  - **Notion이 공식으로 제공하는 것은 프라이버시 옵트아웃 2종(전역 / 페이지별)뿐**이다.
  - **Notion은 `activity_event`·`notification`의 보관 기간을 공개하지 않는다** `[확인필요]`. 공개된 보관 기간은 페이지 히스토리(플랜별 7/30/90/무제한), 휴지통(30일 · Enterprise 1일~10년), audit log(365일)뿐이다.
  - 따라서 이 항목은 **원본 재현이 아니라 클론이 반드시 스스로 내려야 하는 설계 결정**으로 다룬다. 근거: 조회 이벤트는 편집 이벤트보다 10~100배 많고(F-11-04), 알림은 사용자 수 × 구독 수만큼 팬아웃된다(F-11-09) → 정책 없이 3개월 운영하면 **가장 큰 테이블 3개가 전부 이 도메인에서 나온다.**
  - 권장 기본값(클론 판단): 활동 이벤트 90일 / 조회 원본 90일(일별 롤업은 무기한) / **읽음·보관 처리된 알림만 180일, 미읽음 알림은 만료 없음**.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값 (정책 미설정 워크스페이스) | 코드 상수 기본값으로 폴백. **NULL을 "무제한"으로 해석하지 말 것** — 정책 누락이 곧 무한 적재가 된다 |
  | 미읽음 알림이 보관 기간을 넘김 | **삭제하지 않는다.** 미읽음 알림 파기는 사용자에게 "알림이 사라졌다"는 데이터 손실로 보인다. 대신 사용자당 미읽음 상한(N건)을 두고 초과분만 오래된 순으로 정리 |
  | 중첩 (페이지 파기 → 하위 이벤트) | 페이지가 `purged`될 때 그 페이지의 `activity_event`·`page_view`·`notification`을 함께 파기. **단 `audit_event`는 예외 — 삭제 사실 자체가 기록 대상**(F-11-12) |
  | 동시 편집 | 해당 없음(GC는 배치 작업) |
  | 삭제된 참조 (계정 삭제 / GDPR 요청) | `activity_event.actor_id`는 익명화(`user:deleted`)하되 이벤트는 유지. `page_view` 행은 **삭제한다** — "누가 무엇을 봤는지"는 순수 개인정보이며 보존 근거가 약하다 |
  | 권한 없음 | 옵트아웃 설정은 본인만 변경 가능. **관리자가 타인의 옵트아웃을 강제 해제할 수 있게 만들면 안 된다** — 그 순간 제품이 감시 도구가 된다 |
  | 대용량 | 파기는 파티션 DROP이 압도적으로 빠르다. `activity_event`·`page_view`를 **월 단위 파티셔닝**하고 만료 파티션을 통째로 떨군다. 수억 행에서 `DELETE ... WHERE created_at < ?`는 실패한다 |
  | 옵트아웃 이전의 과거 기록 | `[확인필요]` Notion이 소급 삭제하는지 불명. 클론 권장: **옵트아웃 시점 이후만 수집 중단**하고, 과거 기록 삭제는 별도의 명시적 "내 조회 기록 삭제" 액션으로 분리한다(암묵적 대량 삭제는 위험) |
  | 순환 참조 | 해당 없음 |
- **데이터 모델 함의**: 위 의사 스키마의 `activity_retention_policy`, `user_privacy_setting`, `page_view_optout`.
  ```sql
  -- 수집 게이트: 아래 둘을 모두 통과할 때만 page_view를 기록한다
  --   1) user_privacy_setting.record_page_views = true
  --   2) NOT EXISTS (SELECT 1 FROM page_view_optout WHERE page_id=? AND user_id=?)

  CREATE TABLE activity_event (...) PARTITION BY RANGE (created_at);  -- 월 단위
  CREATE TABLE page_view      (...) PARTITION BY RANGE (viewed_at);   -- 월 단위
  -- notification은 파티셔닝하지 않는다: 미읽음이 무기한 남아 파티션을 떨굴 수 없다
  --   → DELETE FROM notification
  --      WHERE read_at IS NOT NULL AND read_at < now() - (policy.notification_days || ' days')::interval
  ```
- **UI/인터랙션**: `Settings → Preferences → Privacy` 토글 1개. 페이지 `Analytics` 탭 내부 `Settings` → `Don't record`. 관리자 보관 정책 화면(클론 추가분)은 숫자 인풋 3개 + "이 설정으로 삭제된 데이터는 복구되지 않습니다" 경고.
- **의존 기능**: F-11-04(활동/조회 수집), F-11-07(알림), 사용자 설정, 워크스페이스 관리자 설정, F-11-06(페이지 파기 시 연쇄 정리).
- **구현 난이도**: **M (2~5일)** — 정책 테이블·옵트아웃 게이트·배치 잡은 각각 작다. 그러나 **파티셔닝을 나중에 도입하는 것은 사실상 불가능**(수억 행 테이블의 무중단 파티션 전환)하므로 "스키마 초기에 결정해야 하는 M"이다.
- **우선순위**: **P1** — 기능 가치만 보면 P2지만 **늦게 넣을수록 비용이 폭증하는 종류**다. 실무적으로는 둘로 쪼개는 것이 정확하다: **파티셔닝 + 보관 정책 스키마 = P1**(1일차), **옵트아웃 토글 UI = P2**.
- **클론 시 현실적 대안**: 옵트아웃은 **전역 토글 1개만**(페이지별 옵트아웃 드롭). 보관 정책은 관리자 UI 없이 환경변수 3개(`ACTIVITY_DAYS`, `PAGEVIEW_DAYS`, `NOTIFICATION_DAYS`). 파티셔닝이 부담되면 최소한 **`page_view`만이라도** 별도 테이블 + 별도 파기 경로로 분리한다 — 볼륨의 대부분이 거기 있다.
- **참고 출처**: https://www.notion.com/help/page-analytics , https://www.notion.com/help/custom-data-retention-settings , https://www.notion.com/help/audit-log

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-11-01 | 페이지 버전 히스토리 (스냅샷 기록·조회) | L | P1 | 블록 트리, 협업 동기화 |
| F-11-02 | 버전 복원 (Restore) | M | P1 | F-11-01, 편집 권한 |
| F-11-03 | 보관 기간 정책 & 히스토리 GC | **M** *(S에서 상향)* | P2 | F-11-01, 플랜 모델 |
| F-11-04 | 페이지 활동 피드 (Updates & analytics) | L | P2 | activity_event, 코멘트, 권한 |
| F-11-05 | 휴지통 (삭제·조회·복원) | M | **P0** | 블록 트리, 권한, 검색 |
| F-11-06 | 영구 삭제 & 커스텀 보존 정책 | M | P2 | F-11-05, 관리자 설정, 파일 스토리지 |
| F-11-07 | 인박스 (알림 목록·필터·읽음) | M | **P0** | F-11-08, 권한, WebSocket |
| F-11-08 | 알림 생성 규칙 엔진 | L | **P0**(멘션·답글) / P1(나머지) | 코멘트, 멘션 노드, 권한, F-11-09 |
| F-11-09 | 페이지 구독 & 알림 레벨 | M | P1 | F-11-07/08, 페이지 트리 |
| F-11-10 | 리마인더 | M | P2 | 멘션 노드, 날짜 파서, F-11-11 |
| F-11-11 | 알림 채널 팬아웃 | XL | P1(인앱·이메일) / P2(푸시·Slack) | F-11-07/08, 푸시·메일 인프라 |
| F-11-11b | Slack 채널 연동 | M | P2 | F-11-04, F-11-09, Slack OAuth |
| F-11-12 | 감사 로그 & SIEM | XL | P2 | 조직 모델, 전 도메인 이벤트 훅 |
| F-11-13 | 외부 이벤트 웹훅 | L | P2 | 공개 API, integration 모델 |
| F-11-14 | Undo와 히스토리 경계 | **M** *(S에서 상향)* | **P0** | 에디터, F-11-01, F-11-05 |
| F-11-15 | 블록 단위 편집 이력 (`created_by`/`last_edited_by`) | S | **P1** *(스키마 1일차)* | 블록 트리, 사용자 모델 |
| F-11-16 | 제안 편집 (Suggested edits) | L | P2 | 코멘트, `Can comment` 권한, CRDT 에디터 |
| F-11-17 | 자동화 기반 알림 (Database automations) | L | P2 *(PM 용도면 P1)* | DB/property, F-11-07/08/11, 스케줄러 |
| F-11-18 | 활동·알림 데이터 수명 & 조회 프라이버시 | M | **P1** *(스키마 1일차)* | F-11-04, F-11-07, F-11-06 |

**MVP(P0) 최소 조합**: F-11-05(휴지통) + F-11-07(인박스) + F-11-08(멘션·답글 알림) + F-11-14(undo). 이 넷이 없으면 "삭제하면 복구 불가, 멘션해도 안 알려짐" 상태가 되어 협업 도구로 성립하지 않는다.

**기능은 나중이지만 스키마는 1일차인 항목** — 이 도메인의 함정은 "P2로 미뤄도 되는 기능"과 "P2로 미뤄도 되는 스키마"가 다르다는 것이다.

| 항목 | 왜 스키마를 먼저 넣어야 하는가 |
|---|---|
| F-11-15 `block.created_by` / `last_edited_by` | 나중에 컬럼을 추가해도 **과거 편집자를 백필할 방법이 없다.** 이력은 소급 생성이 불가능한 유일한 종류의 데이터다 |
| F-11-18 `activity_event`/`page_view` 파티셔닝 | 수억 행이 쌓인 뒤 무중단으로 파티션 전환하는 것은 사실상 불가능하다 |
| F-11-05 `block.lifecycle` soft delete | 나중에 넣으면 **모든 조회 쿼리**에 조건을 다시 넣어야 하고, 하나라도 빠뜨리면 삭제된 콘텐츠가 새어 나온다 |
| F-11-09 조상 조회 구조(closure table / ltree) | F-11-05(트리 삭제 전파)와 F-11-09(구독 상속)가 공유한다. 나중에 도입하면 두 기능을 동시에 재작성해야 한다 |

**구축 순서 권고**
1. `activity_event` 이벤트 버스를 **먼저** 정의한다. F-11-04/08/12/13이 전부 여기에 매달린다. 나중에 붙이면 전 도메인 재작업.
2. `block.lifecycle` soft delete를 스키마 설계 초기에 넣는다. 나중에 넣으면 모든 조회 쿼리를 고쳐야 한다.
3. 페이지 조상 조회(closure table 또는 ltree)를 초기에 확정한다. F-11-05(트리 삭제)·F-11-09(구독 상속)가 공유한다.
4. 알림 발송은 처음부터 **지연 큐 + suppress** 모델로 짠다. "즉시 발송" 구현 후 나중에 디바운스를 넣는 것은 사실상 재작성이다.
5. **디바운스 창을 도메인 전체에서 하나의 상수로 통일**한다. Notion은 자동화에 3초(F-11-17), 데스크톱 푸시에 10초, 모바일에 5분, 웹훅 집계에 1분 미만(F-11-13)을 쓴다 — 값이 다른 것은 괜찮지만 **구현 메커니즘(지연 큐 + 만료 시점 재비교)은 한 벌이어야** 한다. 세 벌을 따로 만들면 세 벌 다 미묘하게 다르게 틀린다.
6. 스케줄러는 **하나만** 만든다. F-11-10(리마인더)·F-11-17(recurring 자동화)·F-11-03(히스토리 GC)·F-11-18(로그 파기)이 전부 "시각이 되면 실행"이며, 인프라를 네 벌 만들 이유가 없다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인 관련 접근 | 차용 포인트 |
|---|---|---|
| **AFFiNE** (toeverything/AFFiNE) | `PgWorkspaceDocStorageAdapter`가 **3단 계층**: `updates`(Yjs 증분 바이너리, append-only) → `snapshots`(머지된 정본, timestamp 기반 원자적 raw SQL UPSERT) → `doc_histories`(주기적 버전 스냅샷, `HistoryModel`) | **이 3단 구조를 그대로 쓰는 것을 권장.** 실시간 동기화 로그와 버전 히스토리를 같은 테이블로 합치려는 유혹을 피할 수 있는 검증된 분리다. 단 0.25.7에서 "문서는 저장됐는데 히스토리 스냅샷이 안 써지는" 레이스(메인 트랜잭션이 `doc.snapshot.updated` 핸들러보다 먼저 커밋)가 보고됐으므로, **히스토리 기록은 메인 트랜잭션 안에서 하거나 outbox 패턴**으로 처리할 것 |
| **Docmost** (AGPL) | 페이지 히스토리를 다중 기여자 스냅샷으로 버전화, 임의 버전 복원. 코멘트·멘션 알림 포함. 히스토리/인라인 코멘트/공개 공유가 오픈소스 코어에 포함 | 스코프 참고용. "히스토리 + 인라인 코멘트 + 멘션 알림"이 오픈소스 위키의 최소 합의선임을 보여준다 |
| **Yjs / Tiptap** | `Y.snapshot`은 `DeleteSet + StateVector`만 담는 경량 구조지만 **`gc:false`를 요구**한다. GC를 끈 프로덕션 Y.Doc은 디스크·성능·네트워크 모두에서 대가가 크다는 보고가 다수. Tiptap 유료 Snapshot 확장은 `enableAutoVersioning`으로 자동 주기 버전 생성 | **결론: `Y.snapshot()` + `gc:false` 조합은 피하고, 버전 시점마다 `Y.encodeStateAsUpdate(doc)` 결과를 통째로 blob에 저장**하는 방식을 택하라. 용량은 더 쓰지만 GC를 켠 채 운영할 수 있고 복원이 단순 `applyUpdate`가 된다. Notion의 "10분/2분" 규칙은 Tiptap autoversioning과 같은 아이디어이므로 그대로 채택 가능 |
| **Lexical** | `DIFF_VERSIONS_COMMAND`로 두 Yjs 스냅샷을 비교해 에디터에 diff 렌더, `renderSnapshot`으로 과거 상태를 에디터 상태로 투영 | 버전 프리뷰를 별도 뷰어로 만들 필요 없이 **같은 에디터를 read-only 모드로 재사용**하는 패턴. 구현량을 크게 줄인다 |
| **Outline** | 문서 revision 테이블 + Hocuspocus(Yjs 백엔드)로 모든 변경을 Yjs update로 기록 | 스냅샷 주기와 revision 노출 정책의 실사례. `[확인필요]` 정확한 revision 생성 주기는 소스 확인 필요 |

**공통 교훈**
- 협업 동기화 로그(고빈도 append)와 사용자 노출 버전(저빈도, 조회 최적화)은 반드시 분리한다.
- 히스토리 쓰기는 메인 저장 트랜잭션과의 순서 문제가 실제 버그로 나타난다(AFFiNE 사례). outbox 또는 동일 트랜잭션으로 처리.
- CRDT 스냅샷 기능은 "무료처럼 보이지만 GC 비활성화 비용"이 붙는다. 전체 state blob 저장이 오히려 싸고 단순한 경우가 많다.

---

## 미해결 / 확인필요

### 3차에서 해소된 항목 (기록 보존용)

| 1차/2차 번호 | 항목 | 결론 | 반영 위치 |
|---|---|---|---|
| 1 | 인라인 DB가 부모 페이지 스냅샷에 포함되는가 | **부분 포함 + 복원 시 옵트인.** DB의 pages/properties는 함께 복원할지 선택 가능하나, **DB 행 페이지의 본문 내용은 복원되지 않는다** | F-11-01, F-11-02 |
| 2 | 뷰어(읽기 전용)도 히스토리를 볼 수 있는가 | **불가.** "you will need at least `Can edit` access" | F-11-01 |
| 5 | 어떤 행위가 암묵 구독을 만드는가 | **페이지 생성 + 편집 2종**("You automatically follow pages that you create or edit") | F-11-09 |
| 6 | 권한 없는 사용자를 멘션했을 때 | **알림이 생성되지 않는다.** 자동 초대 프롬프트는 문서에 없음 | F-11-08 |
| 7 | 인박스가 알림을 접어 보여주는가 | **페이지 단위 수동 접기(`^`)가 공식 제공.** 서버 자동 병합 여부는 여전히 미확인(아래 잔여 #3) | F-11-07 |
| 9 | DND / 조용한 시간 설정 | **존재하지 않는다**(공식 알림 설정 문서에 항목 부재) | F-11-11 |
| 10 | 페이지 삭제 단축키 | **전용 단축키 없음**(공식 단축키 문서에 부재). `backspace`/`delete` 또는 `/delete` | F-11-05 |
| C3 | 영구 삭제 후 30일 보관 | 2차의 "제품 기능 아님" 정정은 **과잉 정정**. `retained` 30일은 공식 문구로 실재하되 셀프서비스 복원 경로가 없을 뿐 | F-11-06 |
| C5 | 웹훅 이벤트 종수 | **23종**(page 8 + database 6 + data_source 6 + comment 3), deprecated 2종 제외 시 **실질 21종** | F-11-13 |

### 잔여 미해결

| # | 태그 | 항목 | 왜 중요한가 | 확인 경로 |
|---|---|---|---|---|
| 1 | `[확인필요]` | 복원으로 되살아난 블록이 참조하던 자식 페이지가 휴지통에 있을 때의 동작 | 참조 무결성. 잘못 처리하면 "복원했는데 링크가 전부 깨진" 상태가 된다 | 실제 워크스페이스에서 재현 테스트 외에 방법 없음(문서 부재 확인함) |
| 2 | `[확인필요]` | 보존 정책 변경이 **이미 삭제된** 콘텐츠에 소급 적용되는가 | 잘못 구현하면 대량 데이터 즉시 파기 사고 | Enterprise 계정 실측 또는 Notion 지원 문의 |
| 3 | `[확인필요]` | 인박스가 동종 알림을 **서버에서 자동 병합**해 "N개 업데이트" 1건으로 만드는가(수동 접기와 별개) | 집계 키(`group_key`)를 DB에 물리적으로 둘지, 조회 시점 병합으로 갈지가 갈린다 | 실측. 문서에는 수동 접기만 서술됨 |
| 4 | `[확인필요]` | 과거 시각으로 리마인더를 설정하면 즉시 발화하는가 | 스케줄러 동작 정의 | 실측 |
| 5 | `[확인필요]` | `activity_event` / `notification`의 Notion 측 보관 기간 | 클론은 스스로 정해야 하나, 원본 값을 알면 기준점이 된다 | 공개 문서에 없음(부재 확인) |
| 6 | `[확인필요]` | 자식 블록 편집이 부모 블록의 `last_edited_time`을 올리는가 | write amplification 설계에 직결(F-11-15) | 공개 API로 실측 가능 |
| 7 | `[확인필요]` | 제안 편집(F-11-16)의 플랜 조건 | 헬프센터는 권한(`Can comment`)만 명시하고 플랜을 말하지 않는다 | 각 플랜 계정 실측 |
| 8 | `[확인필요]` | 수락된 제안이 버전 히스토리·`last_edited_by`에 **누구 명의**로 기록되는가 | 권한 모델과 직결(제안자는 편집 권한이 없을 수 있다) | 실측 |
| 9 | `[확인필요]` | 자동화(F-11-17)가 만든 알림의 actor가 자동화인가 생성자인가 | 권한 계산의 기준. 생성자 권한으로 실행되면 권한 상승 통로가 된다 | 실측 |
| 10 | `[확인필요]` | `Created by` / `Last edited by` property가 **게스트에게도** 보이는가 | 멤버 실명 노출 정책 | 실측 |
| 11 | `[확인필요]` | 조회 기록 옵트아웃이 **과거 기록까지 소급 삭제**하는가 | GDPR 대응 및 사용자 기대치 | 실측 |
| 12 | `[추정]` | 스냅샷 중복 생성 방지를 서버 락으로 하는지 버킷 유니크 제약으로 하는지 | 클론 권장: `UNIQUE(page_id, floor(ts/10min))` |내부 구현, 공개 불가 |
| 13 | `[추정]` | DST 경계를 넘는 리마인더의 재계산 여부 | 실사용 버그로 드러나기 쉬움 | 실측 |
| 14 | `[추정]` | 분 단위 타임스탬프 내림이 "같은 분 안의 반복 편집 UPDATE 스킵" 최적화의 흔적인가 | 사실이면 클론도 같은 최적화를 쓸 수 있다 | 내부 구현, 추론 이상 불가 |
| 15 | 미조사 | 모바일 앱의 오프라인 알림 동기화, 이메일 다이제스트의 묶음 규칙·발송 주기 | v2 범위. 다이제스트는 알림 볼륨 억제의 핵심 수단이라 결국 필요해진다 | 공식 문서 부족, 실측 필요 |
| 16 | 미조사 | Notion 엔지니어링 블로그의 이 도메인 관련 1차 자료(예: 알림 파이프라인, 이벤트 버스 아키텍처) | 3차까지의 조사는 헬프센터·API 레퍼런스 중심. 아키텍처 레벨 2차 자료는 AFFiNE/Yjs 생태계로만 보강했다 | notion.com/blog 전수 조사 |

---

## 출처

> 3차(2026-09-06) 기준. `[재확인]` = 이번 회차에 WebFetch로 원문을 다시 열어 검증한 출처.

**Notion 공식 (1차)**

| # | URL | 이 문서에서 근거로 쓴 내용 |
|---|---|---|
| 1 | https://www.notion.com/help/updates-and-notifications | Inbox & notifications — 알림 트리거 목록, 인박스 필터 4종, 데스크톱 10초 / 모바일 5분 규칙, 페이지별 알림 레벨(일반 2종 / DB 3종), 페이지 단위 `^` 접기, 모바일 스와이프 액션 |
| 2 | https://www.notion.com/help/duplicate-delete-and-restore-content `[재확인]` | 10분/2분 스냅샷 규칙, **히스토리 접근에 `Can edit` 이상 필요**, 플랜별 보관일(7/30/90/무제한), 복원의 가역성, 휴지통 30일 + **영구삭제 후 retained 30일** 원문, 인라인 DB 복원 선택지, **DB 복원 시 행 본문은 복원되지 않음**, 휴지통 검색 필터 |
| 3 | https://www.notion.com/help/custom-data-retention-settings `[재확인]` | Enterprise 커스텀 보존(1일~10년, 기본 30일), 영구삭제 후 워크스페이스 소유자도 접근·복원 불가, AI 채팅은 휴지통을 거치지 않음 |
| 4 | https://www.notion.com/help/audit-log | Enterprise 전용, 365일 보관, 이벤트 카테고리별 종수, 필터, CSV 내보내기 2시간 지연, SIEM 웹훅 워크스페이스당 1개 / 재시도 7회 / 메타데이터만 전송 |
| 5 | https://www.notion.com/help/notification-settings | 채널 토글(모바일/데스크톱/Slack/이메일), "항상 이메일 보내기", person property 알림 개별 해제 불가, **DND·조용한 시간 항목 부재(C6 근거)** |
| 6 | https://www.notion.com/help/reminders | `@remind` 자연어, 타인 지정, DB Date property 필요, 리드타임·타임존, 기한 초과 시 빨간색, 반복 미지원 |
| 7 | https://www.notion.com/help/page-analytics | owner/editor 권한 필요, 총/고유 조회, 익명 제외, 전역 및 페이지별 `Don't record` 옵트아웃 |
| 8 | https://www.notion.com/help/slack | Updates 패널 → Connect Slack channel, **하위 페이지 포함**, DB Automations의 Send Slack notification |
| 9 | https://www.notion.com/pricing | 플랜별 Page history 보관일. Audit log·Custom data retention은 Enterprise 전용 |
| 10 | https://www.notion.com/help/suggested-edits `[재확인]` | **F-11-16 전체** — `Can comment` 이상 필요, 대상 블록 5종, 인라인 DB·property·peek view 제외, 잠긴 페이지 불가, 수락/거절 UI, 소유자 인박스 알림 |
| 11 | https://www.notion.com/help/database-automations `[재확인]` | **F-11-17 전체** — 트리거 3종, 액션 8종, 수신자 20명 상한, **3초 창**, **자동화가 자동화를 트리거하지 못함**, Slack 액션 플랜 게이팅, Gmail 연동 이메일 2분 지연 |
| 12 | https://www.notion.com/help/guides/tips-to-keep-your-teams-notion-pages-up-to-date | **암묵 구독 = 생성·편집**("You automatically follow pages that you create or edit"), `Follow this page` 토글 |
| 13 | https://www.notion.com/help/guides/create-streamlined-project-management-workflow-using-database-automations | 자동화 실사용 패턴(status 변경 → 담당자 알림) |
| 14 | https://www.notion.com/help/keyboard-shortcuts | **페이지 삭제 전용 단축키 부재, 인박스 전용 단축키 부재**(C8 및 F-11-07 근거) |
| 15 | https://www.notion.com/help/sharing-and-permissions | `Can view` / `Can comment` / `Can edit` / `Full access` 등급 — F-11-16의 권한 조건 근거 |
| 16 | https://www.notion.com/releases/2024-07-29 | Suggested edits 도입 릴리스(Notion 2.43) |

**Notion 개발자 문서 (1차)**

| # | URL | 근거로 쓴 내용 |
|---|---|---|
| 17 | https://developers.notion.com/reference/webhooks-events-delivery `[재확인]` | **이벤트 23종 전수 목록**, 집계/비집계 구분, 페이로드 필드, 순서 미보장, at-most-once + 8회 재시도 / 24시간, 5분 이내 도달 목표 |
| 18 | https://developers.notion.com/reference/delete-a-block `[재확인]` | **`DELETE /v1/blocks/{id}`가 `in_trash: true`로 만들며 "moves the block to the Trash where it can still be accessed and restored"** — C2의 결정적 근거. 복원은 `PATCH /v1/blocks/{id}`, update content capability 필요 |
| 19 | https://developers.notion.com/changelog/created-by-and-last-edited-by-properties-in-block-page-and-database-objects | block/page/database 오브젝트의 `created_by`·`last_edited_by`(F-11-15) |
| 20 | https://developers.notion.com/changelog/last-edited-time-is-now-rounded-to-the-nearest-minute | **타임스탬프 분 단위 내림**(F-11-15) |
| 21 | https://developers.notion.com/reference/block | block 오브젝트 공통 필드 |
| 22 | https://developers.notion.com/compliance/overview | Enterprise 감사 이벤트 로그 |

**오픈소스 / 기술 (2차)**

| # | URL | 근거로 쓴 내용 |
|---|---|---|
| 23 | https://deepwiki.com/toeverything/AFFiNE/3.2-workspace-management | AFFiNE 3단 스토리지(updates / snapshots / doc_histories), 타임스탬프 기반 원자적 스냅샷 UPSERT |
| 24 | https://github.com/toeverything/AFFiNE/issues/14112 | `doc.snapshot.updated` 핸들러와 메인 트랜잭션 간 레이스로 히스토리가 누락되는 실제 버그 |
| 25 | https://discuss.yjs.dev/t/garbage-collection-and-version-snapshotting/1839 | `gc:false`의 디스크·성능·네트워크 비용에 대한 프로덕션 사례 |
| 26 | https://deepwiki.com/yjs/yjs/6.3-snapshots | Yjs 스냅샷 = DeleteSet + StateVector 구조 |
| 27 | https://tiptap.dev/docs/collaboration/documents/snapshot | `enableAutoVersioning` 자동 주기 버전 생성 |
| 28 | https://deepwiki.com/facebook/lexical/7.1-collaborative-editing-with-yjs | `DIFF_VERSIONS_COMMAND` / `renderSnapshot` — 과거 상태를 같은 에디터에 투영 |
| 29 | https://github.com/docmost/docmost | Docmost: 페이지 히스토리·인라인 코멘트·멘션 알림이 오픈소스 코어에 포함 |
| 30 | https://github.com/yjs/yjs | `UndoManager`의 `trackedOrigins` 기반 로컬 undo(F-11-14), `createRelativePositionFromTypeIndex` 앵커링(F-11-16) |

**출처 사용 원칙 위반 없음 확인**: 이 문서의 모든 동작 서술은 위 1차 출처(헬프센터 / 공개 API 레퍼런스 / 릴리스 노트) 또는 오픈소스 코드·이슈에 근거한다. "노션 활용법" 류 2차 콘텐츠는 근거로 쓰지 않았다. 1차 출처로 확인되지 않은 서술에는 예외 없이 `[추정]` 또는 `[확인필요]` 태그가 붙어 있다.
