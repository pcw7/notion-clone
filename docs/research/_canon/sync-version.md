# 정본 결정: 동기화 · 버전 · 알림 · 검색 인덱스

> **이 문서는 판결문이다.** 아래 클러스터에 속한 엔티티에 대해 05 / 07 / 09 / 11 / 12 의 정의가 충돌할 때, **이 문서가 이긴다.**
> 다른 클러스터가 소유한 엔티티(block, page, acl, principal, lifecycle/휴지통, workspace_retention_policy, vector_span)는 여기서 **정의하지 않고 참조만** 한다.
>
> - 담당 클러스터: 실시간 동기화 / 버전 스냅샷 / 구독·알림 / 검색 인덱스
> - 판결 대상: C-11, C-12, C-13, V-3, V-5, U-2, U-6, U-9
> - 관련 문서: `05-collaboration-sync.md`, `07-search-navigation.md`, `09-api-integrations.md`, `11-history-notifications.md`, `12-platform-ux.md`
> - 판결일: 2026-09-06 (1차 출처 재확인 포함)

---

## 판결 요약

| 항목 | 채택 | 폐기 | 파급 |
|---|---|---|---|
| **C-11 / V-3**<br>동기화 구독 단위 | **문서(페이지) 단위 채널 + CRDT update push 단일 축.**<br>런타임 `doc:{page_id} → Set<connection_id>`, 봉투 `{doc_id, seq, kind, payload, origin}` | 05 `sub:{record_id}` 레코드 구독 · 버전 thin invalidation · `syncRecordValues` pull 전량.<br>12 `page_channel(page_id, latest_version)` 테이블 · `subscription(device_id,page_id)`를 실시간 구독으로 쓰는 것 | 05 F-05-02·04·06·19·20, 동기화 경로 요약도<br>12 F-12-04·F-12-08<br>07 F-07-06(인덱싱 트리거)<br>09 F-09-17(웹훅 이벤트 소스) |
| **C-12**<br>버전 스냅샷 테이블 | **11의 3테이블 분리**: `doc_update` / `doc_snapshot` / `page_version(state_ref, state_vector, editor_ids, reason, restored_from, expires_at)` | 02 `page_version(snapshot bytea, editors, kind)`<br>05 `page_snapshot(record_map jsonb, authors)` — 테이블명까지 폐기 | 02 F-02-19<br>05 F-05-13 및 의사스키마<br>11 F-11-01·02·03·05(유지 + blob 분리) |
| **C-13**<br>구독·알림 스키마 | **11의 스키마**, 단 ① `subscription.level`은 페이지 종류별 enum을 CHECK로 강제(1차 출처 확인) ② `notification`의 `UNIQUE(group_key) WHERE read_at IS NULL` **제거**(저장은 개별, 병합은 조회 시점).<br>05의 `user_notification_pref`는 채널 목록만 채택 | 05 `page_subscription(level 평면 4값)` · `notification(user_id, type, payload, discussion_id)` · `notification_digest` | 05 F-05-10·F-05-17 및 의사스키마<br>11 F-11-07·08·09·11 |
| **V-5**<br>트랜잭션 all-or-nothing | **`[확인]` 유지** (1차 출처 원문 재확인 성공). 단 적용 범위를 **서버 명령 경로 한정 불변식**으로 축소 | "부분 적용은 설계상 존재하지 않는다"를 **시스템 전역** 불변식으로 쓰는 것 | 05 F-05-01·F-05-04<br>08 F-08-10(자동화)<br>09 쓰기 경로 전반 |
| **U-6**<br>검색 인덱스 3종 | **07 `search_document`가 정본** (block 단위 doc / routing=space_id / principals uuid[] / version=external). 1차 출처 일치 | 09 `search_index(..., acl_root_path ltree)`<br>12 `search_index(page_id, title, plain_text, updated_at)` | 09 F-09-06<br>12 F-12-02<br>07 F-07-06·07(정본 선언 문구 추가) |
| **U-2**<br>제안 편집의 CRDT 표현 | **Y.Doc 안의 ProseMirror mark 3종**(`suggestion_insert/delete/format`). 서버 `suggestion` 행은 **메타데이터 인덱스**일 뿐 본문의 source of truth가 아니다. 난이도 **L**로 통일 | 별도 Y.Doc 브랜치(Yjs에 fork/merge 프리미티브 없음)<br>CRDT 밖 서버측 오버레이 + 상대좌표 앵커(05·11 공통 전제) | 05 F-05-12(→ 포인터로 강등)<br>11 F-11-16(정본 소유, 데이터 모델 교체)<br>01 에디터 mark 스키마 |
| **U-9**<br>presence 스키마 | **cursor(텍스트 범위)와 block_selection(블록 배열)을 2필드 병존.** `mode`에 `'suggest'` 추가. DB 미저장(Yjs awareness) | 01 `{userId, selectedBlockIds[]}` 단독 페이로드<br>05 `focus_block_id` 단독 필드 · selection의 절대 offset 해석 | 01 F-01-09·F-01-13<br>05 F-05-03 |

---

## 정본 스키마

### 0. 다른 클러스터에서 참조만 하는 것 (여기서 정의하지 않는다)

| 엔티티 | 소유 클러스터 | 이 문서가 의존하는 필드 |
|---|---|---|
| `block` / `page` | block-tree 클러스터 (C-10, V-6, V-9) | `id`, `parent_id`, `space_id`, `page_id`, `type`, `plain_text`, `created_by/at`, `last_edited_by/at` |
| 삭제 상태(`lifecycle`, `trashed_at`, `purge_after`) | 삭제·보존 클러스터 (C-1, V-4) | 인덱싱 필터 `in_trash`, 알림 억제, 버전 GC 하한 |
| `acl` / `principal` / `group` | 권한 클러스터 (C-4, V-1, U-3) | `search_document.principals[]` 산출, 배달 시점 권한 재검사 |
| `workspace_retention_policy` | 삭제·보존 클러스터 | `version_history_days` → `page_version.expires_at` 계산 |
| `vector_span` (임베딩) | AI 클러스터 (10) | 없음. 어휘 검색 인덱스와 **별개 파이프라인**임을 명시만 한다 |
| `offline_page` / `offline_action` / `offline_collection_window` | 플랫폼 클러스터 (12 F-12-04) | `device_offline_manifest`만 이 문서가 규정(아래 1-c) |

### 1. 실시간 동기화 (C-11 / V-3 판결 결과)

```sql
-- ── 1-a. 문서 상태: append-only 로그 + 압축 스냅샷 ──────────────
-- 동기화 단위 = 권한 단위 = 채널 단위 = CRDT 문서 단위 = 페이지. 넷을 일치시킨다.
doc_update (
  page_id     uuid   NOT NULL,          -- = Y.Doc 1개
  seq         bigint NOT NULL,          -- page_id 내 단조 증가. 이것이 "페이지 버전"이다
  payload     bytea  NOT NULL,          -- Yjs update 바이너리. 반드시 bytea (문자열 저장 시 손상)
  actor_id    uuid,                     -- NULL = 시스템/봇
  origin      text,                     -- 'editor'|'api'|'automation'|'restore'|'import'
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (page_id, seq)
);

doc_snapshot (                          -- 현재 상태. compaction 잡이 주기적으로 갱신
  page_id      uuid PK,
  state        bytea  NOT NULL,         -- 머지된 CRDT state
  state_vector bytea  NOT NULL,         -- 클라이언트 delta 계산용
  merged_seq   bigint NOT NULL,         -- 여기까지의 doc_update가 반영됨
  updated_at   timestamptz NOT NULL
);
```

**`page_channel(page_id, latest_version)` 테이블은 폐기한다.** 채널은 영속 엔티티가 아니라 런타임 개념이고, `latest_version`은 `MAX(doc_update.seq)`의 중복 저장이다. 버전을 두 곳에 두면 반드시 어긋난다.

```
-- ── 1-b. 런타임 구독 레지스트리 (영속 아님. Redis / 프로세스 메모리) ─────
doc:{page_id}        -> SET<connection_id>
conn:{connection_id} -> { user_id, space_id, device_id,
                          subscribed_docs SET<uuid>, last_seq_by_doc MAP }

-- 와이어 봉투 (단 하나. 두 종류를 한 채널에 섞지 않는다)
{ doc_id: uuid, seq: bigint, kind: "update" | "awareness", payload: bytes, origin: client_id }
```

- **구독 시점 권한검사 + 권한 회수 시 서버 강제 unsubscribe.** pull 모델을 버렸으므로 권한 경계가 "응답 조립 지점 하나"가 아니라 **채널 join과 update 수신 두 지점**이 된다.
- `seq` gap 감지 → 클라이언트가 `state_vector`를 보내고 서버가 delta만 회신(`Y.encodeStateAsUpdate(doc, clientSV)`). full refetch가 아니다.
- 멀티 인스턴스는 Redis pub/sub 어댑터 또는 Hocuspocus. MVP 단일 인스턴스는 인메모리 broadcast + 브로커 인터페이스 추상화.

```sql
-- ── 1-c. 오프라인 권한 회수 (12에서 유일하게 살아남는 영속 테이블) ────────
device_offline_manifest (
  device_id  uuid NOT NULL,
  page_id    uuid NOT NULL,
  granted    bool NOT NULL DEFAULT true,
  revoked_at timestamptz,               -- 세팅 시 재접속 디바이스가 로컬 사본 즉시 폐기
  PRIMARY KEY (device_id, page_id)
);
```

12의 `subscription(device_id, page_id, subscribed_at)`은 **이 테이블로 흡수**한다. 실시간 구독을 영속 테이블로 두면 연결 종료 시 정리가 불가능하고 멀티 인스턴스에서 stale row가 쌓인다.

### 2. presence (U-9 판결 결과)

```
-- DB에 저장하지 않는다. Yjs awareness (또는 Redis HASH presence:{page_id}, TTL 30s)
awareness.localState = {
  user:            { user_id, name, avatar_url, color },
  cursor:          { block_id, anchor: RelativePosition, head: RelativePosition } | null,
  block_selection: uuid[],                       -- 블록 단위 다중 선택. 없으면 []
  mode:            'view' | 'edit' | 'suggest',
  ts:              epoch_ms                      -- 하트비트
}
-- 불변식: cursor != null 과 block_selection.length > 0 은 동시에 성립하지 않는다 (클라이언트 강제)
-- offline 판정 30s [확인: Yjs 공식], 재브로드캐스트 10s [추정: 임계값의 1/3, 클론 자체 결정]
```

### 3. 버전 히스토리 (C-12 판결 결과)

```sql
page_version (
  id            uuid PK,
  page_id       uuid NOT NULL,
  state_ref     text   NOT NULL,        -- ★ blob 스토리지 키. 행에 bytea를 박지 않는다
  state_vector  bytea  NOT NULL,        -- 행에 둔다(작다). 버전 간 diff 계산용
  byte_size     int    NOT NULL,
  editor_ids    uuid[] NOT NULL,        -- 구간 내 doc_update.actor_id DISTINCT
  reason        text   NOT NULL,        -- 'interval'|'idle'|'pre_restore'|'manual'
  restored_from uuid,                   -- 복원으로 생성된 버전이면 원본 version_id
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL    -- workspace_retention_policy.version_history_days로 계산
);
CREATE INDEX ON page_version (page_id, created_at DESC);   -- 목록: state_ref 제외하고 SELECT
CREATE INDEX ON page_version (expires_at);                 -- GC 스캔
```

- **`state_ref` 분리가 결정 사항이다.** 버전 목록 화면이 페이지당 수백 행을 읽는데 행마다 수 MB bytea가 붙으면 TOAST 읽기로 목록 조회가 무너진다.
- **복원은 비파괴적이다.** ① 현재 상태로 `reason='pre_restore'` 버전 생성 → ② 대상 state를 `origin='restore'`인 `doc_update`로 append → ③ 새 버전에 `restored_from` 기록. 1차 출처가 "복원 후에도 지난 30일 중 어느 시점으로든 다시 돌아갈 수 있다"고 명시하므로 이 3단계가 필수다.
- `restored_from` 체인은 **표시 1단계까지만**("v7에서 복원됨"). 끝까지 따라가는 UI를 만들지 않는다.
- 첨부 파일 GC 하한: `file_object.refcount`에 `page_version` 참조를 포함해야 옛 버전 복원 시 첨부가 깨지지 않는다.
- `expires_at`은 **생성 시점 플랜으로 고정**한다(조회 시점 재계산 아님). 다운그레이드로 기존 버전이 갑자기 사라지면 안 되고, GC 인덱스가 스캔 가능하려면 값이 확정돼 있어야 한다. 업그레이드 시에는 배치 UPDATE로 연장.
- `[확인필요]` 자동 버전 생성 주기(문서군의 "10분 주기 + 2분 idle")는 1차 출처에서 확인되지 않았다 → **클론의 설계 선택**으로 명시(기본 10분 / 2분).

### 4. 활동 · 구독 · 알림 (C-13 판결 결과)

```sql
activity_event (
  id           uuid PK,
  workspace_id uuid NOT NULL,
  page_id      uuid NOT NULL,           -- 알림 라우팅의 기준 축
  block_id     uuid,
  actor_id     uuid NOT NULL,
  type         text NOT NULL,           -- 'block.updated'|'block.inserted'|'block.deleted'
                                        -- |'property.updated'|'comment.created'|'comment.replied'
                                        -- |'user.mentioned'|'suggestion.created'|'suggestion.accepted'
                                        -- |'page.created'|'page.moved'|'page.trashed'
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX ON activity_event (page_id, created_at DESC);

subscription (                          -- 페이지 팔로우. 테이블명은 subscription (page_subscription 폐기)
  id         uuid PK,
  user_id    uuid NOT NULL,
  page_id    uuid NOT NULL,
  page_kind  text NOT NULL,             -- 'page' | 'db_item'  ← level CHECK의 판별자
  level      text NOT NULL,
  source     text NOT NULL,             -- 'explicit' | 'auto_created' | 'auto_edited'
  inherit    bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, page_id),
  CHECK (
    (page_kind = 'page'    AND level IN ('all_comments','replies_and_mentions','none')) OR
    (page_kind = 'db_item' AND level IN ('all_updates','important_updates','replies_and_mentions','none'))
  )
);

notification (
  id           uuid PK,
  recipient_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id      uuid NOT NULL,
  event_ids    uuid[] NOT NULL,         -- 묶인 activity_event들
  kind         text NOT NULL,           -- 'mention'|'comment'|'comment_reply'|'page_update'
                                        -- |'invite'|'reminder'|'person_property_assigned'|'suggestion'
  group_key    text NOT NULL,           -- (recipient, page, thread|kind). 조회 시점 병합 키
  read_at      timestamptz,
  archived_at  timestamptz,             -- read_at과 반드시 별도 컬럼 (인박스 필터 4종)
  created_at   timestamptz NOT NULL
);
CREATE INDEX ON notification (recipient_id, archived_at, read_at, created_at DESC);
CREATE INDEX ON notification (recipient_id, group_key, created_at DESC);
-- ★ UNIQUE(group_key) WHERE read_at IS NULL 제약은 폐기했다. 판결 C-13 참조.

notification_delivery (
  id              uuid PK,
  notification_id uuid NOT NULL,
  channel         text NOT NULL,        -- 'in_app'|'desktop_push'|'mobile_push'|'email'|'slack'
  state           text NOT NULL,        -- 'pending'|'suppressed'|'sent'|'failed'
  scheduled_at    timestamptz NOT NULL, -- 디바운스 만료 시각
  sent_at         timestamptz,
  suppress_reason text                  -- 'user_active'|'read_before_send'|'channel_disabled'
);
CREATE INDEX ON notification_delivery (state, scheduled_at);

user_notification_pref (
  user_id           uuid PK,
  desktop_push      bool NOT NULL DEFAULT true,
  mobile_push       bool NOT NULL DEFAULT true,
  email             bool NOT NULL DEFAULT true,
  slack             bool NOT NULL DEFAULT false,
  always_send_email bool NOT NULL DEFAULT false   -- 앱 활성 중에도 메일 발송 [확인]
);
-- 'inbox' 컬럼은 두지 않는다. 인박스는 채널이 아니라 알림의 기본 저장소이며 끌 수 없다.

reminder (
  id            uuid PK,
  block_id      uuid NOT NULL,
  page_id       uuid NOT NULL,
  property_id   uuid,                   -- DB date property 기반이면 채움
  target_at     timestamptz NOT NULL,   -- UTC
  timezone      text NOT NULL,          -- IANA
  lead_minutes  int  NOT NULL DEFAULT 0,
  recipient_ids uuid[] NOT NULL,
  fired_at      timestamptz,
  created_by    uuid
);
CREATE INDEX ON reminder (target_at) WHERE fired_at IS NULL;
```

**배달 파이프라인 (3단 필터, 순서 고정)**
`activity_event` → ① 대상자 산출(`subscription.level` + 직접 트리거) → ② **배달 시점 권한 재검사** → ③ presence 조회로 활성 뷰어 억제 → `notification_delivery` 스케줄.
②를 팬아웃 시점이 아니라 배달 시점에 두는 이유: 이벤트 발생과 배달 사이에 권한이 회수될 수 있고, 알림 본문(멘션 스니펫)이 곧 콘텐츠 유출 경로다.

### 5. 검색 인덱스 (U-6 판결 결과)

```sql
-- 정본. 09·12는 이 정의를 재선언하지 말고 참조만 한다.
search_document (
  doc_id          uuid PK,              -- = block.id  (색인 단위는 block이다)
  routing         uuid NOT NULL,        -- = space_id. 샤드 라우팅 키
  page_id         uuid NOT NULL,
  parent_id       uuid,
  type            text NOT NULL,
  ancestor_ids    uuid[] NOT NULL,      -- breadcrumb + 'In' 필터 (비정규화)
  ancestor_titles text[],
  title_text      text,                 -- 소속 페이지 제목 (가중치 상향)
  body_text       text,
  lang            text,                 -- 언어별 analyzer 선택
  principals      uuid[] NOT NULL,      -- ★ 권한 비정규화. terms 필터로 pre-filter
  is_public       bool NOT NULL DEFAULT false,
  created_by      uuid, created_at     timestamptz,
  last_edited_by  uuid, last_edited_at timestamptz,
  content_status  text,                 -- 페이지 레벨 상태값 (DB property 아님)
  in_trash        bool NOT NULL DEFAULT false,
  version         bigint NOT NULL       -- external version. 값 = 소속 페이지의 doc_update.seq
);
```

- **`version`의 값이 C-11 판결에 종속된다.** 레코드 pull 모델을 폐기했으므로 `block.version`이 아니라 **해당 블록이 속한 페이지의 `doc_update.seq`**를 external version으로 쓴다. 인덱싱 트리거도 "레코드 버전 변경 알림"이 아니라 `doc_update` append outbox다.
- **필터 축은 v0에 컬럼만이라도 전부 뚫어둔다.** 나중에 축을 추가하면 전량 재색인이다.
- **v0 물리 구현은 Postgres**: `search_document` 실테이블 + `tsvector` generated column + GIN, `principals` GIN. 별도 검색 엔진(ES/Meilisearch)과 CDC는 "필요해진 다음"에 도입하며 스키마는 그대로 이식된다.
- 임베딩(`vector_span`)은 **별개 파이프라인**이며 AI 클러스터 소유다. 같은 테이블에 섞지 않는다.

### 6. 제안 편집 (U-2 판결 결과)

```
-- ── 6-a. 본문 표현: Y.Doc 안의 mark (source of truth) ──────────────
ProseMirror schema marks (addSuggestionMarks 상당):
  suggestion_insert { sid: uuid, author_id: uuid }
  suggestion_delete { sid: uuid, author_id: uuid }
  suggestion_format { sid: uuid, author_id: uuid, before: jsonb }

-- 삽입 제안: 텍스트를 실제로 문서에 넣되 suggestion_insert 마크를 붙인다
-- 삭제 제안: 텍스트를 지우지 않고 suggestion_delete 마크만 붙인다
-- 렌더: 제안 미표시 모드에서 insert 범위를 숨기고 delete 범위를 보인다 (Decoration/뷰 레이어)
--       → "본문은 아직 바뀌지 않았다"는 사용자 관점이 성립한다
```

```sql
-- ── 6-b. 서버 메타데이터 인덱스 (본문의 진실이 아니다) ─────────────
suggestion (
  id          uuid PK,                  -- = mark의 sid
  page_id     uuid NOT NULL,
  author_id   uuid NOT NULL,
  kind        text NOT NULL,            -- 'insert' | 'delete' | 'format'
  preview     text,                     -- 사이드바 카드용 스니펫 (렌더 캐시)
  anchor_hint jsonb,                    -- RelativePosition. 카드→본문 점프 보조 좌표일 뿐
  state       text NOT NULL,            -- 'open' | 'accepted' | 'rejected' | 'stale'
  thread_id   uuid,                     -- 첨부 코멘트 스레드
  resolved_by uuid, resolved_at timestamptz,
  created_at  timestamptz NOT NULL
);
CREATE INDEX ON suggestion (page_id) WHERE state = 'open';
CREATE INDEX ON suggestion (author_id, created_at DESC);
CREATE INDEX ON suggestion (thread_id);
```

- **stale 판정은 앵커 소실이 아니라 "sid를 가진 마크가 문서에서 사라졌는가"로 한다.** 제안이 문서 안에 있으므로 CRDT가 위치를 대신 유지한다.
- **수락/거절/벌크는 `Y.transact` 1회.** 수락 = insert 마크 제거 + delete 범위 실삭제. 거절 = 그 반대.
- 대상 블록 타입은 텍스트 계열 5종(text / to-do / heading / bulleted / numbered)으로 제한. **구조 변경 제안(블록 삭제·이동)은 스코프 아웃** — 1차 출처가 대상을 이 5종으로 한정하므로 원본 대비 기능 손실이 아니다.
- 커밋 actor는 **수락자**다. 제안자는 `suggestion.author_id`로만 남는다(그렇지 않으면 편집 권한 없는 사람이 `last_edited_by`가 되어 권한 모델과 모순된다).

---

## 판결별 상세

### C-11 / V-3 — 동기화 구독 단위: **페이지 채널 + CRDT push 단일 축**

**채택.** 실시간 전파는 `doc:{page_id}` 채널 하나로 통일한다. 서버는 Yjs update 바이너리를 그대로 relay하고 클라이언트는 `Y.applyUpdate`로 적용한다. 재동기는 `state_vector` 교환으로 delta만 받는다. 영속 pub/sub 테이블은 없다.

**근거.**

1. **05가 이미 CRDT를 클론 권장안으로 못박았다** (F-05-01: Yjs + y-prosemirror, 페이지 1개 = Y.Doc 1개). CRDT를 택하면 update가 작고 자기기술적이므로 "알림 → 되당김" 왕복은 순손해다. 05 자신의 권고표도 같은 결론을 적어놓고 스키마에만 두 축을 남겼다.
2. **1차 출처 재확인 결과 두 축은 실재하되 각각의 전제가 다르다.** 데이터 모델 블로그: "Every client has a long-lived WebSocket connection to MessageStore" / "it sends a `syncRecordValues` API request to the sever with the list of outdated client records" — 이는 **레코드마다 `version` 컬럼이 있고 클라이언트가 레코드 캐시를 LWW로 갱신하는** 모델의 최적화다. 반면 오프라인 블로그: "Whenever a batch of updates is applied to a page, the server emits a message on a channel for that page. Clients subscribe to these channels for each of their offline pages." 이고 같은 글이 "Pages that are marked as available offline are dynamically migrated to our **new CRDT data model** for conflict-resolution"이라고 한다. → **노션에서도 CRDT 축과 페이지 채널 축이 짝을 이룬다.** 클론이 CRDT를 택한 이상 페이지 채널이 정합적인 선택이다.
3. **비용.** 레코드 축은 화면에 렌더된 블록마다 구독이 걸려 연결당 구독 수가 수백~수천이 된다. 05 스스로 F-05-02에서 "레코드 단위로 가면 F-05-20과 합쳐 실질 난이도 XL"이라 적었다. 페이지 축은 연결당 1~3이다.
4. **권한 경계가 단순해진다.** pull 모델의 권한 경계는 `syncRecordValues` 응답 조립 지점 하나였다. push 모델에서는 채널 join과 권한 회수 시 강제 unsubscribe 두 지점이며 둘 다 명시적 코드 경로다.

**폐기.**

- 05 `sub:{record_id} → SET<connection_id>`, `conn:{id}.subscribed_records`, thin invalidation 봉투 `{type:"record_updated", table, id, version}`, `POST /syncRecordValues` 배치 조회. → **F-05-20은 "Notion 원본 참고자료(클론은 구현하지 않음)"로 강등**한다. 삭제하지 않는 이유는 왜 안 골랐는지가 기록으로 남아야 하기 때문이다.
- 12 `page_channel(page_id, latest_version)` 테이블 — 버전은 `MAX(doc_update.seq)`이고 두 곳에 두면 반드시 어긋난다.
- 12 `subscription(device_id, page_id, subscribed_at)`을 실시간 구독 레지스트리로 쓰는 것 — 실시간 구독은 연결 수명과 같아야 하므로 영속 테이블이면 안 된다. `device_offline_manifest`로 역할 축소.
- **"둘 다 만들고 상황에 따라 쓴다"** — 명시적으로 폐기한다. 05의 경고가 맞다: 한 채널에 "적용할 값"과 "재조회 신호"가 섞이면 수신측이 매번 분기하게 되고 순서 보장이 깨진다.

**block-tree 클러스터(C-10)와의 접점 — 종속 관계 명시.**
05의 op 어휘(`set`/`update`/`listAfter`/`listRemove`)는 `block.content uuid[]` 배열 모델을 전제하므로 C-10 결정에 종속된다. 다만 **이 판결로 그 종속이 대부분 해소된다**: 전송 계층이 CRDT update 바이너리가 되는 순간 op 어휘가 **와이어 프로토콜에서 사라지기** 때문이다. 즉 C-10이 `order_key` fractional index를 채택하더라도 05의 트랜잭션 op 집합은 *재설계*가 아니라 *삭제* 대상이다.
단 op 어휘가 완전히 사라지지는 않는다 — 공개 REST API 쓰기(09), 자동화(08), 템플릿 인스턴스화는 여전히 서버측 명령을 필요로 한다. 그 명령의 실행 형태는 아래 V-5 판결에서 확정한다.

**파급.** 05 F-05-02(전송 계층 전면 재작성) · F-05-04(롤백 모델 교체) · F-05-06(재동기를 state_vector delta로) · F-05-19(권한 재검사 지점 2곳) · F-05-20(강등) · 동기화 경로 요약도. 12 F-12-04 · F-12-08. 07 F-07-06(인덱싱 트리거). 09 F-09-17(웹훅 이벤트 소스).

---

### C-12 — 버전 스냅샷 테이블: **11의 3테이블 분리**

**채택.** `doc_update`(append-only) / `doc_snapshot`(현재 상태 1행) / `page_version`(사용자 노출 버전) 3분리. 컬럼은 11을 따르되 `state bytea` → `state_ref text`(blob 스토리지 키) + `state_vector bytea`(행에 유지)로 쪼갠다. 테이블명은 `page_version`, 편집자 컬럼명은 `editor_ids`.

**근거.**

1. **CRDT를 채택했으므로 스냅샷 형식은 state + state_vector여야 한다.** state_vector가 없으면 "이 버전 이후 delta만 보내기"와 "두 버전 간 diff"가 불가능해지고 복원이 통째 교체밖에 안 된다. 02의 `snapshot bytea`(형식 미지정)와 05의 `record_map jsonb`에는 이 능력이 없다.
2. **`record_map jsonb`는 레코드 pull 모델의 부산물**이다. C-11에서 그 모델을 폐기했으므로 함께 폐기된다.
3. **복원이 비파괴적이어야 한다는 것이 1차 출처로 확인된다** — 헬프센터는 복원 후에도 지난 30일 중 어느 시점으로든 다시 되돌아갈 수 있다고 명시한다. 이를 만족하려면 복원 직전 상태를 남기는 `reason='pre_restore'`와 계보 `restored_from`이 필요하다. 02의 `kind ∈ {auto, restore, manual}`은 계보를 표현하지 못한다.
4. **보존 기간이 플랜별로 다르다**(기본 30일, Business/Enterprise는 30일 초과 복원 / 무제한). 따라서 `expires_at` + `INDEX(expires_at)` GC 축이 필수이며 11에만 있다.
5. **어휘 충돌 회피**: `authors`(05)는 comment/suggestion의 작성자와 충돌한다. `editors`(02)는 배열임이 드러나지 않는다. → `editor_ids uuid[]`.

**폐기.** 02 `page_version(snapshot bytea, editors uuid[], kind)` — 형식 미지정 + 계보 없음 + GC 축 없음. 05 `page_snapshot(record_map jsonb, authors uuid[], expires_at)` — 테이블명·저장형식 폐기. `expires_at`이라는 아이디어만 살려 11 스키마로 흡수한다.

**파급.** 02 F-02-19 · 스키마 확장 표. 05 F-05-13 · 의사스키마의 `page_snapshot` 블록. 11 F-11-01/02/03/05(`state`→`state_ref` 분리, `expires_at` 고정 정책 추가).

---

### C-13 — 구독·알림 스키마: **11 채택 + 2개 수정**

**채택.** 11의 `activity_event` / `subscription` / `notification` / `notification_delivery`를 정본으로 삼고, 05에서 `user_notification_pref`의 **채널 목록만** 흡수한다.

**수정 ① `subscription.level`은 페이지 종류별 enum을 CHECK로 강제한다.** 1차 출처가 정확히 그렇게 나뉜다:

| 페이지 종류 | 1차 출처가 명시하는 선택지 |
|---|---|
| 일반 페이지 | `All comments` / `Replies and @mentions` |
| 데이터베이스 항목 | `All updates`(코멘트 + property 변경) / `Important updates`(코멘트 + status·assignee·due date) / `Replies and @mentions` |

→ 05의 평면 4값 `{all_comments, replies_and_mentions, all_updates, none}`은 `important_updates`가 아예 없고 일반 페이지에 `all_updates`를 허용해 1차 출처와 어긋난다. **폐기.** CHECK 제약이 참조할 판별자가 행 안에 있어야 하므로 `page_kind` 컬럼(`page` | `db_item`)을 둔다.

**수정 ② `notification`의 `UNIQUE(group_key) WHERE read_at IS NULL` 제약을 제거한다.**
11 자신이 F-11-07에서 "저장은 개별 이벤트, 병합은 `group_key` 기준 **조회 시점**"을 권장해놓고 스키마에는 쓰기 시점 병합 제약을 넣었다 — 내부 모순이다. 1차 출처는 인박스가 "organized by page and by comment thread"이고 페이지 이름 기준으로 접을 수 있다고만 말한다. 이는 **표시 계층의 접기**이지 저장 병합의 증거가 아니다.
조회 시점 병합을 택하는 이유 3가지:

1. 읽음 처리 단위가 개별 이벤트여야 "스레드의 일부만 읽음"이 표현된다.
2. 배달 시점 권한 재검사가 이벤트별로 필요하다 — 병합된 1행에 권한이 갈리는 이벤트가 섞이면 필터링이 불가능하다.
3. `UNIQUE` upsert는 인기 페이지의 동시 팬아웃에서 단일 행 락 경합 지점이 된다.

→ `group_key`는 **컬럼과 인덱스로 유지**하되 제약은 없앤다.

**채택 유지 근거(변경 없는 부분).**

- `read_at` / `archived_at` **별도 컬럼**: 1차 출처의 인박스 필터가 정확히 4종이다 — "Unread and read", "Unread only", "Archived", "All workspace updates". 한 컬럼으로는 표현 불가.
- `source ∈ {explicit, auto_created, auto_edited}`: 1차 출처가 "You automatically follow pages that you create or edit"로 암묵 구독 트리거 2종을 명시한다. 코멘트·멘션에 의한 암묵 구독은 문서에 없으므로 **넣지 않는다**(답글 알림은 구독과 무관한 별도 트리거라 기능 공백이 없다).
- 명시적 `none`은 암묵 구독을 **덮어쓴다** — 그렇지 않으면 "뮤트했는데 편집하면 다시 켜지는" 버그가 구조적으로 생긴다.
- `notification_delivery.suppress_reason='user_active'`: 1차 출처가 "If you have Notion open on a mobile device or computer, you won't receive push or email notifications for reminders"라고 명시하므로 억제 규칙이 실재한다.

**폐기.**

- 05 `page_subscription(user_id, page_id, level, PK(user_id,page_id))` — 테이블명·enum 모두 폐기.
- 05 `notification(user_id, type, payload jsonb, discussion_id, actor_id)` — `payload`에 이벤트를 **복제**하는 설계가 문제다. `activity_event`를 `event_ids[]`로 참조해야 알림 삭제와 이벤트 보존(감사·활동 피드)이 분리되고, 이벤트 1건이 수신자 N명에게 복제되지 않는다.
- 05 `user_notification_pref.inbox` 컬럼 — 인박스는 채널이 아니라 알림의 기본 저장소이며 끌 수 없다.
- 05 `notification_digest(user_id, group_key, count, last_at)` — 조회 시점 병합을 택했으므로 불필요.

**파급.** 05 F-05-10 · F-05-17 · 의사스키마의 알림/구독 블록. 11 F-11-07(제약 제거) · F-11-08 · F-11-09(`page_kind` 추가) · F-11-11.

---

### V-5 — 트랜잭션 all-or-nothing: **`[확인]` 유지, 단 적용 범위 축소**

**채택.** 1차 출처 원문 재확인에 **성공**했다: "operations are batched into transactions that are **committed (or rejected) by the server as a group**." (notion.com/blog/data-model-behind-notion, 2026-09-06 재fetch). → `[확인]` 태그를 유지한다. `[추정]`으로 강등할 필요 없다.

**단, 클론에서 이 불변식이 사는 위치를 재정의한다.** C-11에서 실시간 편집 경로를 CRDT push로 바꿨으므로 노션의 트랜잭션 계약이 그 경로에 그대로 적용되지 않는다. 클론의 쓰기 경로는 둘로 갈라진다:

| 경로 | 원자성 단위 | 불변식 |
|---|---|---|
| **① 실시간 편집** (에디터 → Yjs update) | `doc_update` 1행 append | update 바이너리는 쪼개지지 않는다. 원자성은 단일 행 INSERT가 보장한다. 트랜잭션 개념 자체가 없다 |
| **② 서버 명령 경로** (REST API 쓰기 / 자동화 / 템플릿 인스턴스화 / 제안 벌크 수락 / 버전 복원) | 명령 1건 | 서버가 Y.Doc을 로드 → **`Y.transact` 안에서 전부 적용** → 결과 update 1개를 append. 중간 실패 시 전체 롤백. **부분 적용 없음** |

→ "부분 적용은 설계상 존재하지 않는다"를 **시스템 전역 불변식으로 쓰는 것은 폐기**하고 **② 경로 한정 불변식**으로 재서술한다. 이렇게 하면 05가 그 위에 세운 것들이 정리된다: op 루프 중간 실패 처리는 ②에만, 낙관적 업데이트 롤백(F-05-04)은 ①에서 **사라지고**(Yjs 로컬 상태가 이미 진실이며 서버가 거부할 여지는 권한검사뿐), outbox 재시도는 ①에서 `y-indexeddb` + provider 재연결이 대체한다.

**폐기.** 05 F-05-04의 "서버 거부 시 TransactionQueue에서 되돌린다" 흐름(레코드 모델 전제). 05 의사스키마의 클라이언트 `outbox(tx_id, page_id, ops jsonb, attempts)` — ① 경로에서는 Yjs provider가 대체하고 ② 경로는 서버측 큐다.

**파급.** 05 F-05-01(불변식 범위 문구) · F-05-04(전면 재작성). 08 F-08-10(자동화가 ② 경로임을 명시). 09 쓰기 엔드포인트 전반(요청 1건 = `Y.transact` 1회).

---

### U-6 — 검색 인덱스 3종: **07 `search_document`가 정본**

**채택.** 07의 `search_document`를 단일 정본으로 선언한다. 09와 12는 각자의 `search_index`를 **삭제하고 07을 참조만** 한다.

**근거 — 1차 출처가 07 쪽과 일치한다.** 노션 검색 재인덱서 엔지니어링 블로그 확인 결과:

| 축 | 1차 출처 문구 | 어느 문서와 일치하나 |
|---|---|---|
| 색인 단위 | "turns a Notion block into a searchable document" / "every block users create, edit, or delete" | **07** (`doc_id = block.id`). 12의 `page_id` 키는 틀리다 |
| 라우팅 | "The routing key (`spaceId`)" | **07** (`routing = space_id`) |
| 버전 | "the external-version semantics (`version_type: external`, sourced from a pipeline `docVersion`)" | **07** (`version bigint`) |
| 권한 | "per-document permission resolution" as part of document generation | **07** (`principals uuid[]`) |

**폐기.**

- **09 `search_index(entity_id, entity_type, workspace_id, title_tsv, body_tsv, last_edited_time, in_trash, acl_root_path ltree)`** — `acl_root_path ltree`가 결정적 결함이다. ltree는 **페이지 트리 경로**이지 principal 집합이 아니므로 **그룹 멤버십·게스트·teamspace 경로로 들어온 권한을 표현할 수 없다**. 07의 `principals uuid[]` + terms 필터는 셋을 한 축으로 처리한다. (`title_tsv`/`body_tsv` 분리라는 아이디어만 v0 Postgres 구현에 흡수한다.)
- **12 `search_index(page_id, space_id, title, plain_text, updated_at)`** — 권한 축이 아예 없다. 12 자신이 F-12-02 엣지케이스에서 "권한 필터는 인덱스 조회 후가 아니라 쿼리 조건에 함께 걸어야 한다"고 적어놓고 스키마가 그것을 배신한다.

**추가 결정 — 정본 스키마와 물리 구현을 분리 선언한다.** 07 F-07-06 자신이 "Notion의 XL은 ES 클러스터 전제이고 Postgres generated column 방식이면 실질 S"라고 경고했다. 따라서 **스키마는 정본을 그대로 쓰되 v0 물리 구현은 Postgres 실테이블 + tsvector generated column + GIN**으로 하고 ES/Meilisearch + CDC는 v2로 미룬다. 09가 노린 "본문까지 색인"이라는 차별점도 이 구현에서 그대로 성립한다.

**C-11과의 연동.** `search_document.version`의 값은 `block.version`이 아니라 **`doc_update.seq`**다. 인덱싱 트리거도 "레코드 버전 변경 알림"이 아니라 `doc_update` append outbox다.

**파급.** 09 F-09-06(스키마 블록 삭제 → 07 참조, ltree 문단 삭제). 12 F-12-02(스키마 블록 삭제 → 07 참조). 07 F-07-06/07(정본 선언 문구 + `version = doc_update.seq` + `vector_span`은 AI 클러스터 소유 명시).

---

### U-2 — 제안 편집을 Yjs 위에서 어떻게 표현하는가: **Y.Doc 안의 mark**

**채택.** 제안을 **문서 안**에 넣는다. ProseMirror 스키마에 `suggestion_insert` / `suggestion_delete` / `suggestion_format` 3종 mark를 추가하고, y-prosemirror가 이를 `Y.XmlText`의 formatting attribute로 매핑해 CRDT에 그대로 실어보낸다(Yjs 공식: "Formatting attributes are transformed to XML-tags"). 서버 `suggestion` 행은 사이드바 목록·알림·권한 판정을 위한 **메타데이터 인덱스**로 격하한다.

**근거.**

1. **앵커 문제가 원천적으로 사라진다.** 제안이 문서의 일부이므로 CRDT가 위치를 대신 유지한다. 05·11이 공통으로 "이 기능의 핵심 난점 = 앵커"라고 적은 문제가, 표현 위치를 바꾸는 것만으로 해소된다.
2. **실시간 전파가 공짜다.** C-11 판결로 채널이 문서 채널 하나뿐인데, 제안이 문서 밖에 있으면 제안 전용 pub/sub 축을 하나 더 만들어야 한다 — C-11 판결과 정면 충돌한다. 문서 안에 있으면 update 하나에 같이 실린다.
3. **수락의 원자성이 자연스럽다.** 수락 = 마크 제거(insert) 또는 텍스트 삭제(delete)를 `Y.transact` 1회로. 벌크 수락도 트랜잭션 1회 = 브로드캐스트 1회. 11 F-11-16이 "설계 핵심 3: 수락은 원자 트랜잭션"이라 요구한 것이 그대로 만족된다.
4. **생태계 표준이 마크 기반이다.** `@handlewithcare/prosemirror-suggest-changes`가 `addSuggestionMarks`로 스키마에 마크를 심고 `applySuggestion`/`revertSuggestion`/`...InRange` 커맨드를 제공한다. `prosemirror-suggestion-mode`도 같은 계열(`acceptSuggestionsInRange`, `rejectAllSuggestions`). Yjs 14 / y-prosemirror / BlockNote도 changesets·attributions 기반 track changes 방향으로 가고 있다.

**폐기 A — 별도 Y.Doc 브랜치.** Yjs에는 머지 가능한 fork/branch 프리미티브가 없다. 브랜치를 흉내내면 수락 시 두 문서의 diff를 다시 op로 환원해야 하고, 그 사이 원본이 바뀌었으면 3-way merge가 필요하다. "수락은 원자 트랜잭션"이라는 요구와 정면 충돌한다.

**폐기 B — CRDT 밖 서버측 오버레이 (05·11의 공통 전제).** 11 F-11-16의 "제안은 본문 블록에 쓰지 않는다 + `anchor jsonb`에 relative position" 방식. 두 가지 이유로 버린다:

- (i) **stale이 정상 동작이 되어버린다.** relative position이 살아 있어도, 제안 대기 중 같은 문단을 누가 고치면 의미상 무효가 되는 경우를 구분할 방법이 없다. 오버레이 방식은 "왜 사라졌는지" 설명 UI(`suggestion.original` 스니펫)를 반드시 요구하는데, 이는 설계의 약점을 UI로 메우는 것이다.
- (ii) **제안이 실시간으로 전파되지 않는다.** 다른 사람 화면에 내 제안이 즉시 보이려면 별도 채널이 필요하다 → 채택 근거 2번과 충돌.
- 다만 `anchor_hint jsonb`(relative position)는 **사이드바 카드 → 본문 범위 점프**의 보조 좌표로만 남긴다. stale 판정의 근거는 아니다.

**부수 판결 — 난이도·우선순위 통일 (C-16의 이 항목 해소).** F-05-12 **XL** vs F-11-16 **L** → **L**로 확정. 근거: 마크 기반이면 문서 모델 재설계가 없고 검증된 라이브러리가 존재한다. "에디터에 decoration API가 없으면 XL"이라는 11의 단서는 유지한다(클론은 ProseMirror/BlockNote 계열을 쓰므로 해당 없음). 우선순위는 양쪽 합의대로 **P2**. **정본 F-ID는 F-11-16**이며 F-05-12는 포인터로 축약한다.
스코프: 대상 블록 텍스트 계열 5종. **구조 변경 제안(블록 삭제·이동)은 스코프 아웃** — 1차 출처가 대상 블록을 5종으로 한정하므로 원본 대비 기능 손실이 아니다.

**파급.** 05 F-05-12(→ 포인터). 11 F-11-16(데이터 모델 함의 전면 교체, 난이도 근거 갱신). 01 에디터 mark 스키마(3종 추가) · 렌더러의 제안 표시/숨김 모드.

---

### U-9 — presence 스키마: **cursor와 block_selection 2필드 병존**

**채택.** awareness 페이로드를 정본 스키마 §2로 확정한다. 텍스트 범위 선택(`cursor.anchor/head`)과 블록 다중 선택(`block_selection uuid[]`)을 **하나로 합치지 않고 둘 다 둔다.**

**근거.** 둘은 동시에 존재할 수 없지만 **서로 다른 렌더러가 그린다** — 전자는 캐럿 + 텍스트 범위 하이라이트, 후자는 블록 배경 하이라이트. 하나의 필드로 union하면 수신측이 매번 타입 스니핑을 해야 하고, 01과 05가 서로 다른 필드명을 쓰게 된 원인이 정확히 그 union 시도다. 두 필드를 두고 "동시에 비어있지 않으면 안 된다"를 **클라이언트 불변식**으로 강제하는 편이 싸다.
`mode`에 `'suggest'`를 추가한다 — U-2 판결로 제안이 문서 편집 모드의 한 상태가 되었으므로, 다른 사람에게 "이 사람은 제안 중"이 보여야 마크가 갑자기 나타나는 이유가 설명된다.
좌표는 **반드시 CRDT relative position**(`createRelativePositionFromTypeIndex`). 절대 offset은 원격 편집 후 100% 어긋난다.

**폐기.** 01 F-01-09의 `{userId, selectedBlockIds[]}` — 사용자 신원·색·모드가 없어 렌더가 불가능하다. 05의 `focus_block_id` 독립 필드 — `cursor.block_id`로 흡수(캐럿 없이 focus만 있는 상태는 무의미). 01 F-01-13의 `{userId, blockId, offset}`에서 offset을 문자 인덱스로 해석하는 것.

**저장.** **DB에 저장하지 않는다.** Yjs awareness(연결 종료 시 자동 삭제) 또는 Redis HASH `presence:{page_id}` + TTL 30초. 오프라인 판정 30초는 Yjs 공식 `[확인]`, 재브로드캐스트 10초는 임계값의 1/3로 잡은 **클론의 자체 결정** `[추정]`(공식 문서에 수치 없음).

**파급.** 01 F-01-09 · F-01-13. 05 F-05-03(필드 목록 교체).

---

## 수정이 필요한 문서 목록

| 문서 | 대상 | 무엇을 |
|---|---|---|
| `05-collaboration-sync.md` | 의사스키마 전체 | `sub:{record_id}` / `conn:{}.subscribed_records` / `page_snapshot` / `page_subscription` / `notification` / 클라이언트 `outbox` 블록 삭제 → 이 문서 §1·§3·§4 참조로 교체 |
| | F-05-01 | all-or-nothing 불변식을 "서버 명령 경로 한정"으로 재서술. 1차 출처 재확인 성공을 각주로 |
| | F-05-02 | 전송 계층 전면 재작성 — 레코드 축 삭제, 문서 채널 단일 축. 난이도 L 유지 근거를 "구독 단위 = 페이지"로 확정 |
| | F-05-03 | presence 필드 목록을 §2로 교체 |
| | F-05-04 | 낙관적 업데이트 롤백 → Yjs 로컬 상태 + provider 재연결로 재서술. `outbox` 삭제 |
| | F-05-06 | 재동기를 full refetch → `state_vector` delta 교환으로 |
| | F-05-10 / F-05-17 | 알림·구독 스키마를 §4로 교체. level enum을 `page_kind` 분기로 |
| | F-05-12 | F-11-16 포인터로 축약. 난이도 XL → L |
| | F-05-13 | `page_snapshot` → `page_version`(§3) |
| | F-05-19 | 권한 재검사 지점을 "매 트랜잭션 + pull 응답"에서 "채널 join + update 수신 + 회수 시 강제 unsubscribe"로 |
| | F-05-20 | **"Notion 원본 참고자료 — 클론은 구현하지 않음"으로 강등.** 폐기 사유를 이 문서 C-11로 링크 |
| | 동기화 경로 요약도 | (A) Notion 실제 경로는 참고로 남기고 (B)를 유일한 클론 경로로 명시 |
| `07-search-navigation.md` | F-07-06 | **정본 선언 문구 추가**("09·12의 search_index는 폐기, 이 스키마가 정본"). `version = doc_update.seq` 명시. 인덱싱 트리거를 `doc_update` outbox로. v0 물리구현 = Postgres임을 난이도와 함께 명시 |
| | F-07-07 | `principals[]` 재색인 팬아웃이 권한 클러스터(U-3)에 종속됨을 명시 |
| | 의사스키마 | `vector_span`은 AI 클러스터 소유임을 주석으로 |
| `09-api-integrations.md` | F-09-06 | `search_index(... acl_root_path ltree)` 스키마 블록 **삭제** → 07 참조. ltree 권한 문단 삭제(그룹 표현 불가) |
| | 쓰기 엔드포인트 전반 | "요청 1건 = 서버측 `Y.transact` 1회" 명시(V-5 ② 경로) |
| | F-09-17 | 웹훅 이벤트 소스를 `activity_event` / `doc_update` outbox로 통일 |
| `11-history-notifications.md` | 의사스키마 `page_version` | `state bytea` → `state_ref text` + `state_vector bytea` 분리. `expires_at` 고정 정책 명시 |
| | 의사스키마 `subscription` | `page_kind` 컬럼 추가, CHECK를 §4 형태로 |
| | 의사스키마 `notification` | `UNIQUE(group_key) WHERE read_at IS NULL` **제거**, `(recipient_id, group_key, created_at DESC)` 인덱스 추가 |
| | 의사스키마 `suggestion` | §6-b로 교체(`op`→`kind`, `anchor`→`anchor_hint`, `payload`/`original` 삭제) |
| | F-11-07 | 조회 시점 병합으로 확정(`[확인필요]` 해소 — 1차 출처는 표시 계층 접기만 서술). 스키마와의 모순 제거 |
| | F-11-16 | **정본 F-ID 선언.** 데이터 모델 함의를 §6(mark 기반)으로 전면 교체. "제안은 본문 블록에 쓰지 않는다" 문장 폐기 |
| | (신설) | `user_notification_pref` 테이블 추가(05에서 흡수) |
| `12-platform-ux.md` | F-12-02 | `search_index(...)` 스키마 블록 **삭제** → 07 참조 |
| | F-12-04 | `page_channel` / `subscription(device_id,page_id)` **삭제**, `device_offline_manifest`만 유지. "push 기반 페이지 채널" 서술은 유지(정본과 일치) |
| | F-12-04 "되돌릴 수 없는 결정 3개" | ①의 "레코드에 단조 증가 version"을 "페이지에 단조 증가 `doc_update.seq`"로. ③ "변경을 op 배열로 저장"을 "Yjs update 바이너리로 저장"으로 |
| | F-12-08 | 커서 계약 정합화는 이 클러스터 소관 아님 → U-7로 이관 명시 |
| `01-block-editor.md` | F-01-09 / F-01-13 | presence 페이로드를 §2로 교체 |
| | 에디터 mark 스키마 | `suggestion_insert/delete/format` 3종 추가, 제안 표시/숨김 렌더 모드 |
| `02-page-workspace.md` | F-02-19 · 스키마 확장 표 | `page_version` 정의 삭제 → 이 문서 §3 참조 |
| `08-templates-automation.md` | F-08-10 | 자동화 실행이 V-5 ② 경로(서버 `Y.transact`)임을 명시 |

---

## 남은 불확실성

| # | 확정하지 못한 것 | 왜 지금 못 정하나 | 어떻게 실측하나 |
|---|---|---|---|
| 1 | **자동 버전 생성 임계값**(`reason='interval'|'idle'`의 10분/2분) | 문서군이 인용한 수치의 1차 출처를 찾지 못했다. 헬프센터는 보존 기간만 말한다 | 테스트 계정에서 한 페이지를 편집하며 간격을 30초/3분/15분으로 바꿔가며 version history 항목 생성 시각을 기록(최소 3세션). 확인 전까지는 **클론의 설계 선택**으로 표기 |
| 2 | **인박스 병합이 서버측인가 렌더측인가** | 1차 출처는 "organized by page and by comment thread" / 페이지 이름 기준 접기만 서술한다. 저장 병합의 증거가 없다 | 두 계정으로 같은 페이지에 5초 간격 코멘트 5건 → 수신자 인박스에서 (a) 개별 5건인지 1건인지 (b) 하나만 읽음 처리하면 나머지가 어떻게 되는지 관찰. **결과와 무관하게 클론은 조회 시점 병합을 유지한다**(위 근거 3가지가 제품 관측과 독립이므로) |
| 3 | **제안이 다른 사용자에게 실시간으로 보이는가** — U-2 채택의 전제 | 헬프센터에 서술이 없다. 마크 기반이면 자동으로 보이고 오버레이라면 안 보일 수도 있다 | 2계정 동시 접속. A가 `Suggesting` 모드로 타이핑 → B 화면에 밑줄 제안이 즉시 나타나는지, B가 같은 문단을 편집할 때 A의 제안이 어떻게 움직이는지 관찰. **보이지 않는다면 노션은 오버레이 방식**이지만 클론은 마크 방식을 유지한다(폐기 근거가 노션 모방이 아니라 원자성·채널 단일화이므로) |
| 4 | **문서 채널 팬아웃의 실제 한계** | 1차 출처가 "동시 편집자 수에 제품 차원의 상한이 없다"고 명시하므로 상한은 우리 인프라가 정한다 | 부하 테스트: 1개 Y.Doc에 50/200/500 커넥션, 초당 op 10건 주입 → relay 지연 p95, 서버 CPU, Redis pub/sub 대역폭 측정. 임계 도달 시 채널별 배칭 윈도우(50ms) + coalesce 튜닝 |
| 5 | **`search_document.principals[]` 재색인 팬아웃 규모** | 그룹 멤버십 1건 변경이 몇 개 문서를 건드리는지는 **권한 모델(V-1: 상속 차단 존재 여부)**이 정해져야 계산된다 | 권한 클러스터의 V-1 판결 후 "그룹이 커버하는 페이지 수 × 페이지당 블록 수" 상한을 계산. 실측은 시드 워크스페이스(10만 블록)에서 그룹 멤버 1명 제거 → 재색인 큐 길이·완료 시간 측정 |
| 6 | **`suggestion_*` mark의 Yjs 왕복 안정성** | ProseMirror mark → `Y.XmlText` formatting attribute 매핑은 확인됐으나, **같은 범위에 두 사람이 서로 다른 `sid`로 마크를 걸 때** 어떻게 병합되는지는 확인하지 못했다 | 통합 테스트: 두 Y.Doc 인스턴스에서 동일 텍스트 범위에 서로 다른 `sid`의 `suggestion_insert`를 동시 적용 → 병합 후 마크가 중첩되는지 하나가 이기는지 확인. 중첩된다면 렌더러가 다중 sid를 그릴 수 있어야 한다 |
| 7 | **`state_ref` blob GC와 첨부 파일 refcount 연동** | 버전 blob 수명이 첨부 파일 수명의 하한이라는 규칙은 세웠으나, refcount 갱신 시점(버전 생성 시 / GC 시)이 파일 도메인 소관과 겹친다 | 파일·업로드 도메인 문서와 합의 필요. 이 클러스터 단독으로 확정하지 않는다 |

---

## 검증에 사용한 1차 출처 (2026-09-06 재확인)

| # | URL | 이 판결에서 무엇을 확정했나 |
|---|---|---|
| 1 | https://www.notion.com/blog/data-model-behind-notion | **V-5 확정**: "operations are batched into transactions that are committed (or rejected) by the server as a group." / **C-11 레코드 축 확인**: MessageStore 장수명 WebSocket, `syncRecordValues` pull, RecordCache LRU, TransactionQueue |
| 2 | https://www.notion.com/blog/how-we-made-notion-available-offline | **C-11 페이지 채널 축 확인**: "Whenever a batch of updates is applied to a page, the server emits a message on a channel for that page. Clients subscribe to these channels for each of their offline pages." / "Pages that are marked as available offline are dynamically migrated to our new CRDT data model for conflict-resolution." → **CRDT 축과 페이지 채널 축이 짝을 이룬다**는 판결 근거 |
| 3 | https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer | **U-6 확정**: 색인 단위 = block("turns a Notion block into a searchable document", "every block users create, edit, or delete"), 라우팅 키 `spaceId`, `version_type: external` + `docVersion`, "per-document permission resolution" |
| 4 | https://www.notion.com/help/updates-and-notifications | **C-13 확정**: 인박스 필터 4종("Unread and read", "Unread only", "Archived", "All workspace updates") → `read_at`/`archived_at` 분리. 일반 페이지 레벨 2종 vs DB 항목 레벨 3종(`All updates` / `Important updates` / `Replies and @mentions`) → `page_kind` CHECK 분기. 병합은 "organized by page and by comment thread" 표시 계층 |
| 5 | https://www.notion.com/help/notification-settings | **C-13 채널 목록 확정**: mobile push / desktop push / Slack / email 4종 + `always_send_email` 토글. 억제 규칙 실재("If you have Notion open… you won't receive push or email notifications") |
| 6 | https://www.notion.com/help/duplicate-delete-and-restore-content · https://www.notion.com/help/custom-data-retention-settings | **C-12 확정**: 버전 히스토리 기본 30일, Business/Enterprise 30일 초과 복원 / 무제한. 복원 후에도 지난 30일 어느 시점으로든 재복원 가능 → `pre_restore` + `restored_from` 필수 |
| 7 | https://docs.yjs.dev/api/shared-types/y.xmltext | **U-2 근거**: "Formatting attributes are transformed to XML-tags" → ProseMirror mark가 CRDT에 그대로 실린다 |
| 8 | https://docs.yjs.dev/api/relative-positions | **U-9 / U-2 근거**: `createRelativePositionFromTypeIndex`, "Features such as comments should either be implemented as document state or using relative positions" → 문서 상태(mark)가 공식이 인정하는 정식 선택지 |
| 9 | https://github.com/handlewithcarecollective/prosemirror-suggest-changes · https://github.com/davefowler/prosemirror-suggestion-mode | **U-2 생태계 근거**: `addSuggestionMarks`로 스키마에 마크 주입, `applySuggestion`/`revertSuggestion(sInRange)` 커맨드 제공 → 마크 기반이 ProseMirror 진영의 표준 해법 |
| 10 | https://docs.yjs.dev/api/about-awareness | **U-9 근거**: awareness는 지속되지 않는 별도 CRDT, 30초 미수신 시 offline 판정 |
| 11 | https://www.notion.com/help/guides/tips-to-keep-your-teams-notion-pages-up-to-date | **C-13 근거**: "You automatically follow pages that you create or edit" → 암묵 구독 트리거 2종(`auto_created`, `auto_edited`) |
