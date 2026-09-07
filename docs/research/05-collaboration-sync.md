# 05. 실시간 협업 & 동기화

> 조사일: 2026-09-06 / 모드: DOMAIN / 대상: Notion 클론 (C:/VibeCoding/notion)
> 태그 규칙: `[확인]` = 1차 출처로 확인됨, `[확인: 부재]` = 1차 출처에 해당 서술이 **없음을 확인**, `[추정]` = 공개 정보로부터의 추론, `[확인필요]` = 근거 부족
>
> **2차 점검 (GAP 모드, 2026-09-06)**: 1차 출처 12건을 WebFetch로 재확인. 인용문 1건 정정, `[확인필요]` 4건 해소(버전 보존기간 / 알림 구독 규칙 / awareness 타이밍 / 잠긴 페이지 코멘트), 난이도 2건 상향(F-05-11 S→M, F-05-13 M→L), 기능 5건 추가(F-05-15 협업 undo, F-05-16 DB 실시간 동기화, F-05-17 구독 레벨, F-05-18 webhook 배달, F-05-19 연결 인증·권한 전파). 총 14개 → **19개 기능**.
> 조사 방법 제약: 이 세션의 WebSearch 예산이 소진되어 검색 대신 **1차 출처 URL 직접 fetch**로 검증했다(공식 헬프센터 5건, 공식 API 레퍼런스 3건, 공식 엔지니어링 블로그 1건, Yjs 공식 문서 2건).
>
> **3차 점검 (GAP 모드, 2026-09-06 후속)**: WebSearch 6회 + WebFetch 3회 추가 수행(검색: CRDT 알고리즘 / 보존기간 / websocket 프로토콜 / resolve 재오픈 / `saveTransactions`·`RecordCache` / 오프라인 하위 페이지. fetch: 데이터 모델 블로그 · 코멘트 헬프 · 오프라인 헬프). 성과는 세 가지다.
> 1. **1차 출처 신규 확보** — 공식 엔지니어링 블로그 [Exploring Notion's Data Model](https://www.notion.com/blog/data-model-behind-notion)와 신설 헬프 페이지 [Use pages offline](https://www.notion.com/help/use-pages-offline). 이전 판이 리버스 엔지니어링 자료에 의존하던 구간이 공식 근거로 교체됐다.
> 2. **전송 계층 모델 정정(가장 큰 수정)** — Notion의 실시간 push는 이전 판이 가정한 "op 브로드캐스트 → 수신측 rebase"가 **아니다**. 공식 서술은 `MessageStore`(장수명 WebSocket 서비스)가 **레코드 버전 변경 알림**만 보내고, 클라이언트가 자기 캐시 버전과 비교해 어긋난 레코드만 `syncRecordValues`로 **되당겨오는(pull)** 구조다 `[확인]`. F-05-02 / F-05-04 / 동기화 경로 요약도 / 의사 스키마를 이에 맞춰 고쳤고, 이 프로토콜 자체를 **F-05-20**으로 분리 신설했다(총 19개 → **20개 기능**).
> 3. **엔드포인트명 정정** — `/api/v3/submitTransaction`(리버스 엔지니어링 자료 기준, 구버전)이 아니라 공식 블로그 기준 **`/saveTransactions`** `[확인]`. 두 이름을 병기한다.
>
> 추가로 `[확인필요]` 4건을 해소했다: 오프라인 하위 페이지 전파(미해결 #11) / 버전 보존기간 교차검증(#8) / resolve 재오픈 경로(#6) / 잠긴 페이지 코멘트(#7, 2차 출처).
> **반증 시도 결과**: "Notion = CRDT"와 "Notion = Operational Transformation Layer"를 각각 단정하는 2차 블로그가 동시에 존재하며 **서로 모순한다**. 어느 쪽도 1차 근거를 제시하지 못하므로 이 문서는 둘 다 채택하지 않고, 1차 출처가 실제로 말하는 것(① 헬프센터의 "최근 변경 우선" ② 오프라인 블로그의 "오프라인 지정 페이지에 한한 CRDT 마이그레이션" ③ 데이터 모델 블로그의 "레코드 단위 버전 동기")만 사실로 유지한다.

## 요약

이 도메인은 "여러 사용자가 같은 블록 트리를 동시에 고쳐도 각 클라이언트가 같은 결과를 보게 만드는" 계층이다.
Notion은 편집을 **블록 단위 operation 트랜잭션**(공식 명칭 `/saveTransactions`, 구 리버스 엔지니어링 자료의 `/api/v3/submitTransaction`과 같은 계열. command = `set` / `update` / `listAfter` / `listRemove`)으로 서버에 보내고, 서버는 커밋 후 **레코드 버전이 바뀌었다는 알림만** 구독 클라이언트에 밀며, 클라이언트가 `syncRecordValues`로 실제 값을 되당겨온다 `[확인]`.
동시 편집 시 기본 병합 규칙은 **잠금 없는 last-write-wins**이며(헬프센터 원문: "The most recent change will be reflected on the page") `[확인]`, 2025년 오프라인 모드 출시와 함께 오프라인 지정된 페이지에 한해 **새 CRDT 데이터 모델로 동적 마이그레이션**된다 `[확인]`.
그 위에 presence(블록 옆 아바타), 코멘트/스레드/해결, @멘션·리마인더, 제안된 편집, 페이지·데이터베이스 잠금, 버전 히스토리, 협업 undo, 데이터베이스 뷰의 개인/공유 상태, 알림 구독 레벨, 외부 webhook 배달, 연결 인증·권한 실시간 전파, 레코드 버전 무효화·캐시 동기가 얹힌다(총 **20개 기능**).
클론 관점의 핵심 결정은 **둘이며 서로 묶여 있다**:
1. **텍스트 CRDT(Yjs 계열)를 쓸 것인가, 블록 LWW + 필드별 타임스탬프로 갈 것인가.**
2. 실시간 전파를 **push(변경 자체를 보낸다)** 로 할 것인가 **pull(버전만 알리고 값은 되당긴다)** 로 할 것인가. Notion 자신은 2번에서 **pull**을 택했다 `[확인]`(F-05-20). CRDT를 택하면 1번이 2번을 결정한다(= push).

---

## 핵심 개념 / 데이터 모델

### 개념 계층

| 계층 | 역할 | 영속성 | 전송 |
|---|---|---|---|
| Document state | 블록 트리 + rich text 본문 | 영구 (DB) | 트랜잭션 / CRDT update |
| Record cache | 클라이언트가 접근한 레코드 사본 (`RecordCache`, SQLite/IndexedDB 위의 LRU) `[확인]` | 준영구 (evict 가능) | 버전 알림 → `syncRecordValues` pull |
| Pending tx | 서버가 아직 확정하지 않은 내 트랜잭션 (`TransactionQueue`) `[확인]` | 영구 (IndexedDB/SQLite) | `/saveTransactions` |
| Awareness / Presence | 누가 어디를 보고 있나, 커서·선택영역 | 휘발성 (메모리) | 별도 ephemeral 채널 |
| Discussion | 코멘트 스레드 + 앵커 | 영구 | 일반 CRUD + push |
| Notification | 멘션·리마인더·답글 팬아웃 | 영구 | inbox + email/push |
| Snapshot | 페이지 버전 히스토리 | 영구(플랜별 보존: Free 7 / Plus 30 / Business 90 / Enterprise 무제한 `[확인]`) | 요청 시 조회 |
| View state | DB 뷰의 filter/sort — **공유 baseline + 사용자별 오버레이 2층** `[확인]` | 영구 | 공유분만 브로드캐스트 |
| Undo stack | 내 origin의 변경 이력 | 휘발성 (클라이언트 메모리) | 전송 안 함 |
| External event | 외부 시스템으로 나가는 변경 통지 | 영구 (outbox) | HTTPS webhook, 최대 8회 재시도 `[확인]` |

### 의사 스키마

```sql
-- ── 문서 상태 ──────────────────────────────────────────────
block (
  id            uuid PK,
  type          text,                 -- paragraph | heading_1 | to_do | page ...
  parent_id     uuid,                 -- 트리 (상향 포인터). 공식 블로그: "The parent block is
                                      --   only used for permissions" → content[](하향)와 쌍을 이루며
                                      --   권한 상속 경로는 이 상향 포인터다 [확인]
  parent_table  text,                 -- 'block' | 'collection' | 'space'
  space_id      uuid,
  content       uuid[],               -- 자식 블록 id의 "순서 있는" 배열
  properties    jsonb,                -- rich text: [["텍스트", [["b"],["a","url"]]], ...]
  format        jsonb,
  version       bigint,               -- 단조 증가. 낙관적 동시성 검사용이자 **실시간 무효화의 키**다.
                                      --   서버는 값이 아니라 (record_id, version)만 push하고,
                                      --   클라이언트가 캐시 버전과 다르면 syncRecordValues로 pull [확인]
  last_edited_time timestamptz,
  last_edited_by   uuid,
  created_time  timestamptz,
  created_by    uuid,
  alive         boolean               -- soft delete (휴지통)
)

-- 편집 로그 (LWW 경로)
transaction (
  id          uuid PK,
  space_id    uuid,
  actor_id    uuid,
  client_id   text,                   -- 낙관적 업데이트 에코 판별용
  created_at  timestamptz,
  ops         jsonb                   -- Operation[]
)
-- Operation = { id, table, path[], command, args }
--   command ∈ set | update | listAfter | listBefore | listRemove | setPermissionItem

-- CRDT 경로 (Yjs 계열 채택 시)
doc_crdt (
  doc_id       uuid PK,               -- = page block id
  state        bytea,                 -- Y.encodeStateAsUpdate 결과 (병합 스냅샷)
  state_vector bytea,
  clock        bigint,
  updated_at   timestamptz
)
doc_update (                          -- append-only 증분 로그 (주기적 compaction)
  doc_id     uuid,
  seq        bigserial,
  update     bytea,
  actor_id   uuid,
  created_at timestamptz,
  PRIMARY KEY (doc_id, seq)
)

-- ── 레코드 구독 레지스트리 (F-05-20, 영속 아님) ─────────────
-- Notion은 "렌더한 레코드마다" 구독한다 [확인] → 구독 단위가 페이지가 아니라 record다.
sub:{record_id}   -> SET<connection_id>          -- 역방향: 누구에게 알릴까
conn:{connection_id} -> {
  user_id, space_id,
  subscribed_records SET<uuid>,   -- 화면에서 사라지면 unsubscribe
  last_seq bigint
}
-- 알림 봉투(값을 싣지 않는 thin invalidation):
--   { "type":"record_updated", "table":"block", "id":"<uuid>", "version": 1234 }

-- ── Presence (DB에 넣지 않는다. Redis/메모리) ───────────────
presence:{doc_id} -> HASH {
  "{connection_id}": {
    user_id, client_id, name, avatar_url, color,
    focus_block_id, selection: {anchor, head}, mode: "view"|"edit",
    ts   -- 하트비트
  }
}   -- TTL 30s [확인: Yjs가 30초 미수신 시 remote client를 offline으로 표시]
    -- 하트비트 10s [추정: 재브로드캐스트 주기는 Yjs 공식 문서에 수치가 없음 → 임계값의 1/3로 자체 결정]

-- ── 코멘트 ────────────────────────────────────────────────
discussion (
  id            uuid PK,
  parent_id     uuid,        -- page block id 또는 block id
  parent_table  text,        -- 'block'
  anchor        jsonb,       -- 인라인일 때 텍스트 범위 앵커 (F-05-07)
  resolved      boolean DEFAULT false,
  resolved_by   uuid, resolved_at timestamptz,
  comments      uuid[],      -- 순서 있는 comment id
  space_id      uuid,
  created_time  timestamptz
)
comment (
  id            uuid PK,
  discussion_id uuid FK,
  created_by    uuid,
  rich_text     jsonb,       -- 멘션 토큰 포함
  created_time  timestamptz,
  last_edited_time timestamptz,
  alive         boolean
)
reaction (
  target_type text,  -- 'comment' | 'text_range' | 'block'
  target_id   uuid,
  emoji       text,
  user_id     uuid,
  PRIMARY KEY (target_type, target_id, emoji, user_id)   -- 자연스러운 2P-Set
)

-- ── 멘션 / 알림 ───────────────────────────────────────────
-- 멘션은 별도 테이블이 아니라 rich text 인라인 토큰으로 저장 [추정]
--   ["‣", [["u","<user_id>"]]]        사람
--   ["‣", [["p","<page_id>"]]]        페이지
--   ["‣", [["d",{type:"date",...}]]]  날짜/리마인더
mention_index (                    -- 역방향 조회용 파생 테이블
  source_type text, source_id uuid, page_id uuid,
  mentioned_type text, mentioned_id uuid, created_at timestamptz
)
notification (
  id uuid PK, user_id uuid, type text,  -- mention | comment_reply | reminder | suggestion | page_invite
  space_id uuid, page_id uuid, discussion_id uuid, actor_id uuid,
  payload jsonb,
  read_at     timestamptz,           -- 읽음
  archived_at timestamptz,           -- 보관. 인박스 필터가 Unread/Read/Archived/All 4종이라
  created_at  timestamptz            --   읽음과 보관은 반드시 별도 컬럼 [확인]
)
-- 페이지 구독은 "암묵적 팔로워"가 아니라 사용자가 켜는 3단계 레벨이다 [확인] → page_subscription (F-05-17)
reminder (
  id uuid PK, target_user_id uuid, page_id uuid, block_id uuid,
  fire_at timestamptz, tz text, sent_at timestamptz
)

-- ── 오프라인 (Notion 실제 테이블명 그대로) ──────────────────
offline_page   ( page_id, last_downloaded_timestamp, ... )
offline_action ( origin_page_id, from_page_id, impacted_page_id, type )
-- 불변식: offline_page의 모든 row는 최소 1개의 offline_action row를 가져야 한다 [확인]

outbox (                           -- 클라이언트 로컬 (IndexedDB/SQLite)
  tx_id uuid PK, page_id uuid, ops jsonb, attempts int, created_at timestamptz
)

-- ── DB 뷰 상태 (F-05-16) ──────────────────────────────────
collection_view (
  id uuid PK, collection_id uuid, type text,   -- table | board | calendar ...
  shared_query jsonb,                          -- `Save for everyone`로 저장된 filter/sort/group [확인]
  format jsonb
)
collection_view_user_state (    -- 개인 오버레이. 이게 없으면 "나만 보이는 필터"가 불가능하다
  view_id uuid, user_id uuid,
  personal_query jsonb,
  updated_at timestamptz,
  PRIMARY KEY (view_id, user_id)
)
-- 실효 쿼리 = merge(shared_query, personal_query)  ← personal이 우선

-- ── 구독 / 외부 이벤트 (F-05-17, F-05-18) ──────────────────
page_subscription (
  user_id uuid, page_id uuid,
  level text,   -- 'all_comments' | 'replies_and_mentions' | 'all_updates' | 'none' [확인: UI 3단계]
  updated_at timestamptz,
  PRIMARY KEY (user_id, page_id)
)
user_notification_pref ( user_id uuid PK, inbox bool, desktop bool, email bool, mobile_push bool, slack bool )
webhook_subscription (
  id uuid PK, workspace_id uuid, integration_id uuid,
  url text, verification_token text,      -- 핸드셰이크 토큰이 그대로 HMAC 키가 된다 [확인]
  event_types text[], status text, created_at timestamptz
)
event_outbox (   -- 편집 트랜잭션과 같은 DB 트랜잭션에서 append (transactional outbox) [추정, 표준 설계]
  id uuid PK, workspace_id uuid, type text,       -- page.content_updated | comment.created ...
  entity_type text, entity_id uuid, authors uuid[], payload jsonb, created_at timestamptz
)
webhook_delivery (
  id uuid PK, subscription_id uuid, event_id uuid,
  attempt_number int,                     -- 1..8 [확인]
  status_code int, delivered_at timestamptz, next_retry_at timestamptz
)

-- ── 잠금 / 버전 ───────────────────────────────────────────
-- 잠금은 block.format 안의 플래그로 표현 [추정]
--   format.block_locked = true, format.block_locked_by = uuid
--   collection view: format.collection_lock = true
page_snapshot (
  id uuid PK, page_id uuid, created_at timestamptz,
  authors uuid[], record_map jsonb,   -- 해당 시점 블록 서브트리
  expires_at timestamptz              -- 플랜별 보존기간
)
suggestion (
  id uuid PK, page_id uuid, block_id uuid, author_id uuid,
  status text,   -- pending | accepted | rejected | stale
  kind text,     -- insert | delete | format | move
  anchor jsonb, payload jsonb, discussion_id uuid,
  created_at timestamptz, resolved_at timestamptz, resolved_by uuid
)
```

### 동기화 경로 요약도

**(A) Notion 실제 경로 — `[확인]`, 공식 데이터 모델 블로그 기준**

```
[클라이언트 A]
  편집 → RecordCache 즉시 갱신(낙관적 렌더) → 트랜잭션을 TransactionQueue에 append
        │   (IndexedDB/SQLite에 영속. 서버가 확정하거나 거부할 때까지 남는다)
        ↓ JSON 직렬화 후 POST /saveTransactions
[서버] 관련 블록 + 부모 로드 → 권한 판정 → 'before' 사본 복제 → op 적용해 'after' 생성
       → 트랜잭션 단위로 커밋 또는 **그룹 통째로 거부**
        ↓ MessageStore(장수명 WebSocket)로 "이 record의 version이 바뀌었다"만 통지
[클라이언트 B] 렌더 중인 record를 MessageStore에 구독해 둔 상태
       → 통지받은 version이 자기 RecordCache의 version과 다르면
       → POST syncRecordValues(outdated record id 목록) 로 **값을 되당겨** 캐시 갱신 → 재렌더
```

핵심: **서버는 값이나 op를 브로드캐스트하지 않는다. 버전 번호만 밀고 값은 클라이언트가 pull 한다** `[확인]`. 이 한 가지가 팬아웃 페이로드 크기·권한 재검사 지점·메시지 유실 복구 전략을 전부 바꾼다(F-05-20).

**(B) 이 클론의 권고 경로 — CRDT 채택 시**

```
[클라이언트] 편집 → Y.Doc 로컬 적용(즉시) → update 바이너리를 provider가 전송
        ↓ WebSocket
[서버] onAuthenticate 권한검사 → doc_update append → debounce로 doc_crdt.state 갱신
        ↓ 같은 doc 구독자에게 update 바이너리 그대로 relay
[다른 클라이언트] Y.applyUpdate → 수렴. 자기 origin 에코는 UndoManager가 구분(F-05-15)
```

(A)는 **pull 모델**(작은 알림 + 값 재조회), (B)는 **push 모델**(변경 자체를 전달). 둘을 섞으면 안 된다 — 섞으면 "값을 밀었는데 pull도 한다"는 이중 경로가 되어 순서 보장이 무너진다 `[추정, 설계 판단]`.

**설계 원칙 하나**: `페이지 = 동기화 단위 = 권한 단위 = 채널 단위 = CRDT 문서 단위`를 일치시킨다. 이 경계가 어긋나면 F-05-02·F-05-05·F-05-14가 전부 꼬인다.
단, Notion 자신은 이 원칙을 따르지 않는다 — **구독은 페이지가 아니라 렌더된 레코드 단위**이고 `[확인]`, 페이지 채널은 오프라인 동기화 맥락에서만 언급된다 `[확인]`. 즉 Notion에는 **두 개의 구독 축**(레코드 구독 / 페이지 채널)이 공존한다 `[추정: 두 공식 문서를 이어붙인 추론]`. 클론은 굳이 두 축을 다 만들지 말고 하나로 통일하는 편이 낫다.

---

## 기능 명세

### F-05-01 동시 편집 병합 (충돌 해결 코어)

- **한 줄 정의**: 두 명 이상이 같은 페이지·같은 블록을 동시에 고쳐도 모든 클라이언트가 같은 최종 상태에 수렴하게 한다.
- **사용자 시나리오**:
  1. A와 B가 같은 페이지를 연다. 둘 다 3번째 문단에 커서를 둔다.
  2. A가 문단 앞에 "Hello "를 입력, 동시에 B가 문단 끝에 " World"를 입력한다.
  3. 두 화면 모두 "Hello 원문 World"가 되어야 한다(문자 단위 병합).
  4. A가 그 블록을 `to_do`로 바꾸고 동시에 B가 `heading_2`로 바꾸면 한쪽 값만 남는다(타입은 병합 불가).
- **동작 상세**:
  - Notion의 기본(레거시) 규칙: 블록은 잠기지 않고 **가장 최근 변경이 이긴다** — 헬프센터 원문은 "The most recent change will be reflected on the page" `[확인]`.
    - **정정(2026-09-06)**: 이전 판이 인용한 "content isn't locked during concurrent edits — the most recent change takes precedence"는 재확인 결과 원문에서 찾지 못했다(요약된 재진술로 보임) → 위 문장으로 교체했다.
    - 같은 문서에 "There's no limit on the number of people who can view and edit the same page or database at the same time." `[확인]` → 동시 편집자 수에 제품 차원의 상한이 없다. 서버 설계에서 페이지 채널 팬아웃이 인원수에 선형으로 늘어난다고 가정해야 한다.
  - 편집은 개별 필드가 아니라 **operation 트랜잭션**으로 전송된다. `Operation = {id, table, path[], command, args}`, command는 `set`(경로 값 교체), `update`(부분 병합), `listAfter`(배열에서 특정 원소 뒤로 삽입), `listRemove`(배열에서 제거) `[확인]`.
  - **엔드포인트명 정정(2026-09-06)**: 공식 블로그 원문은 "The transaction data is serialized to JSON and posted to the `/saveTransactions` API endpoint." `[확인]`. 이전 판이 쓴 `/api/v3/submitTransaction`은 오래된 리버스 엔지니어링 자료의 이름이다 — op 구조 근거로는 여전히 유효하지만 **엔드포인트명은 `/saveTransactions`를 정본으로 삼는다**.
  - **트랜잭션은 그룹 단위로 커밋되거나 그룹 단위로 거부된다** `[확인]`: "operations are batched into transactions that are committed (or rejected) by the server as a group." → **부분 적용은 설계상 존재하지 않는다.** 클론의 서버도 op 루프 중간 실패 시 전체 롤백이어야 한다.
  - 서버측 적용 절차도 공식 서술이 있다 `[확인]`: "We load all the blocks and parents involved in the transaction" → "We duplicate the 'before' data" → "we apply the operations in the transaction to the new copy to create the 'after' data". 여기서 **부모까지 함께 로드하는 이유는 권한 판정**이다 — "The parent block is only used for permissions" / "Blocks inherit permissions based on the blocks in which they're located" `[확인]`. 즉 **모든 편집 트랜잭션이 조상 체인 조회를 동반**하며, 이것이 F-05-19(권한 전파)의 비용 근원이다.
  - `content[]`(자식 순서)를 통째로 `set` 하지 않고 `listAfter`/`listRemove`로 다루므로, **순서 변경이 인덱스가 아니라 "어떤 id 뒤"라는 상대 관계**로 표현된다 → 동시 삽입이 서로를 덮어쓰지 않는다 `[확인: command 상수 / 추정: 설계 의도]`.
  - 오프라인 가능 페이지는 **새 CRDT 데이터 모델로 동적 마이그레이션**된다 — "pages that are marked as available offline are dynamically migrated to our new CRDT data model for conflict-resolution" `[확인]`. 즉 2025년 시점 Notion은 **레거시 LWW 경로와 CRDT 경로가 공존**한다 `[추정]`.
  - "Notion은 CRDT를 쓴다"는 널리 퍼진 주장의 1차 근거는 위 오프라인 블로그의 문장 하나뿐이다. **어떤 알고리즘인지(YATA/RGA/Fugue 등)는 공개되지 않았다** `[확인필요]`. 2차 블로그들이 "Notion = CRDT"라고 단정하는 것은 근거로 삼지 않았다.
  - **반증 시도(2026-09-06)**: 같은 블로그를 재fetch해 "CRDT 이전에는 무엇을 썼는가"를 찾았으나 **본문에 이전 충돌 해결 방식에 대한 서술이 전혀 없다** `[확인: 부재]`. 즉 "레거시 LWW 경로와 CRDT 경로가 공존한다"는 문장은 (a) 헬프센터의 LWW 서술과 (b) 블로그의 "오프라인 지정 페이지에 한해 마이그레이션" 서술을 이어붙인 **추론**이며, 온라인 전용 페이지의 현재 실제 경로는 확인 불가 `[확인필요]`. 클론 설계는 이 불확실성에 의존하지 말고 **하나의 경로(CRDT)로 통일**하는 편이 안전하다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 블록에 동시 입력 | 두 텍스트 모두 보존, 순서는 결정적(사이트 id 타이브레이크) |
  | A가 블록 삭제 + B가 같은 블록 편집 | 삭제가 이김(tombstone). B의 입력은 소실 → undo 힌트 제공 권장 |
  | A가 부모 삭제 + B가 그 밑에 자식 추가 | 자식이 고아가 되면 안 됨. tombstone 아래에 유지하고 UI에서 숨김 |
  | 순환 이동 (A: X→Y 밑, B: Y→X 밑) | 트리 사이클 발생. 서버가 사이클 검출 후 나중 op reject 또는 root로 승격 |
  | 같은 블록 type 동시 변경 | LWW (병합 불가한 스칼라) |
  | 오프라인 5분 편집 후 복귀 | 텍스트는 자동 병합, 이미지 등 비텍스트는 "quick review" 필요 `[확인]` |
  | 1,000블록 동시 붙여넣기 | 트랜잭션 분할 + 서버측 op 개수 상한. Notion 공개 API의 상한이 **요청당 block 1,000개 / payload 500KB** `[확인]`이므로 내부 트랜잭션 상한도 같은 자릿수로 잡는다 |
  | 권한 없는 사용자의 op | 서버에서 트랜잭션 전체 reject (부분 적용 금지). 검사 지점은 채널 join이 아니라 **매 트랜잭션**이어야 한다 → F-05-19 |
| 순환 참조: 페이지 A가 B를 멘션하고 B가 A를 멘션 | 렌더 시 프리뷰 전개 깊이 상한(1단계)으로 무한 재귀 차단. 저장은 허용 |
| 삭제된 블록을 참조하는 op가 뒤늦게 도착 | tombstone에 적용 후 무시(적용 실패로 트랜잭션 전체를 깨지 않는다) |
- **데이터 모델 함의**: `block.content uuid[]` + `block.version` + `transaction.ops`. CRDT 채택 시 `doc_crdt.state bytea` + `doc_update` append-only 로그. **CRDT 바이너리는 반드시 bytea로 저장** — 문자열로 저장하면 손상된다(Hocuspocus 문서가 "Data must be stored as binary"로 명시) `[확인]`.
- **UI/인터랙션**: 병합 자체에는 UI가 없다. 부수 요구: (a) 원격 편집이 내 커서를 밀어낼 때 커서 위치 보정, (b) 비텍스트 충돌 시 "충돌본 저장됨" 배너, (c) 미동기화 블록에 sync pending 인디케이터, (d) Cmd+Z는 **자기 origin의 변경만** 되돌린다.
- **의존 기능**: 블록 데이터 모델, 인증/권한, F-05-02(전송), F-05-04(낙관적 업데이트).
- **구현 난이도**: **XL** — 트리 CRDT(이동/사이클)는 텍스트 CRDT보다 어렵고, 라이브러리를 써도 블록 스키마 매핑·tombstone GC·서버 영속화 설계가 남는다.
- **우선순위**: **P0** — 이게 없으면 실시간 협업 도구가 아니다.
- **클론 시 현실적 대안**:
  1. (권장) **Yjs + y-prosemirror**, 페이지 1개 = `Y.Doc` 1개. 블록 트리는 ProseMirror 노드 또는 `Y.Array<Y.Map>`. 트리 이동은 "삭제 후 삽입"으로 우회.
  2. (MVP 최소) 블록 단위 LWW: 텍스트는 `last_edited_time` 비교로 통째 교체, 순서는 fractional index(LexoRank류). 같은 블록 동시 타이핑 시 글자 유실 → 동시 타이핑 빈도가 낮은 초기에만 허용하고, 반드시 F-05-13(히스토리)을 안전망으로 함께 넣는다.
- **참고 출처**: https://www.notion.com/help/collaborate-within-a-workspace , https://www.notion.com/blog/how-we-made-notion-available-offline , https://www.notion.com/blog/data-model-behind-notion , https://github.com/kjk/notionapi/blob/master/submit_transaction.go , https://tiptap.dev/docs/hocuspocus/guides/persistence

---

### F-05-02 실시간 전송 계층 (구독 채널 & fan-out)

- **한 줄 정의**: 서버가 페이지 변경을 구독 중인 모든 클라이언트에게 즉시 밀어준다.
- **사용자 시나리오**: 페이지를 연다 → 클라이언트가 해당 page 채널 구독 → 다른 사람이 글자를 치면 100~300ms 내 화면 반영 → 페이지를 닫으면 구독 해제.
- **동작 상세**:
  - **전송 서비스에 이름이 있다 — `MessageStore`** `[확인]`. 공식 블로그 원문: "Every client has a long-lived WebSocket connection to MessageStore, Notion's real-time updates service." → 실시간 계층은 API 서버와 **별도 서비스**다(Docmost가 협업 서버를 3001 포트로 분리한 것과 같은 구조).
  - **구독 단위는 페이지가 아니라 레코드다** `[확인]`: "When the Notion client renders a block (or page, or any other kind of record), the client subscribes to changes of that record from MessageStore using this WebSocket connection." → 화면에 렌더된 레코드마다 구독이 걸린다. **정정(2026-09-06)**: 이전 판의 "채널 단위 = 페이지"는 오프라인 블로그의 "the server emits a message on a channel for that page. Clients subscribe to these channels for each of their offline pages." `[확인]` 에서 온 것인데, 그 문장은 **오프라인 지정 페이지 문맥**에 한정된다. 두 공식 서술을 합치면 Notion에는 축이 둘이다 — ① 렌더 레코드 구독(온라인 실시간) ② 오프라인 페이지 채널(백그라운드 동기) `[추정: 두 문서 결합]`.
  - **밀어주는 것은 값이 아니라 버전이다** `[확인]`: "When your friend's client receives version update notifications from MessageStore, it verifies that version of the block in its local cache…it sends a `syncRecordValues` API request to the server with the list of outdated client records." → 팬아웃 페이로드가 **레코드 id + version뿐**이고 실제 값은 클라이언트가 되당긴다. 상세는 F-05-20.
    - 설계 귀결 3가지: (a) 팬아웃 대역폭이 문서 크기와 무관해진다, (b) **권한 검사가 push 시점이 아니라 pull 시점에 걸린다** — `syncRecordValues` 응답 필터링이 실질적 권한 경계다, (c) 알림 유실이 치명적이지 않다(다음 알림 때 버전 gap이 드러나 함께 복구된다).
  - 내부 API는 `/api/v3/*` POST + 별도 websocket 조합이며 `/api/v3/ping`이 존재한다 `[확인]`. 웹소켓 프레임 포맷·구독 메시지 스키마·하트비트 주기는 여전히 비공개 `[확인필요]`.
  - 초기 로드는 `loadPageChunk`(블록 서브트리 청크) + `getRecordValues`(id 배치 조회), 이후 버전 알림 + `syncRecordValues`로 증분 갱신 `[확인]`.
  - 오픈소스 레퍼런스: AFFiNE 동기화 게이트웨이는 **Socket.io + Redis pub/sub 어댑터**, state vector 기반 동기화 + awareness 프로토콜 `[확인]`. Docmost는 API 서버(3000)와 **Hocuspocus 협업 서버(3001)를 별도 프로세스로 분리** `[확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 네트워크 끊김 | 지수 백오프 재연결(1s→2s→4s→최대 30s) + 재연결 시 델타 재동기(F-05-06) |
  | 서버 인스턴스 다중화 | 로컬 메모리 broadcast로는 불가 → Redis pub/sub 등 외부 브로커 필수 |
  | 권한 없는 페이지 구독 시도 | 채널 join 시점에 권한검사로 거부. 권한 회수 시 **서버가 강제 unsubscribe** |
  | 한 사용자가 탭 20개 | 연결 수 상한 + 탭 간 SharedWorker/BroadcastChannel로 연결 공유 검토 |
  | 메시지 유실 | 채널 메시지에 단조 증가 `seq` 부여 → 클라이언트가 gap 감지 시 full refetch |
  | 프록시가 websocket 차단 | SSE 또는 long-poll 폴백 |
  | 한 페이지에 초당 수백 op | 채널별 배칭 윈도우(예: 50ms)로 묶어 전송, 백프레셔 시 drop 대신 coalesce |
  | 빈 값 / 아무도 구독하지 않는 레코드 변경 | 팬아웃 no-op. 구독자 0이면 알림 자체를 만들지 않는다(outbox에는 남긴다 — F-05-18) |
  | 중첩: 자식 블록만 바뀌었는데 부모 페이지를 보는 사람 | 레코드 구독 모델에서는 **자식 레코드를 구독하지 않으면 알림이 안 온다** → 렌더된 모든 자식을 개별 구독하거나, 부모에 rollup 버전을 두어야 한다 `[추정, 설계 판단]` |
  | 삭제된 레코드에 대한 구독 | 삭제 알림 후 서버가 구독 해제. 클라이언트는 tombstone 렌더 후 구독 목록에서 제거 |
  | 순환 참조: A 페이지가 B를 임베드하고 B가 A를 임베드 | 구독 그래프에는 사이클이 없다(구독은 레코드→연결의 단방향). 렌더 전개 깊이만 제한하면 됨 |
- **데이터 모델 함의**: 영속 스키마 없음. 런타임 레지스트리 **두 축**:
  - 레코드 축(Notion 실제 모델) — `sub:{record_id} -> Set<connection_id>`, `conn:{id} -> {user_id, space_id, subscribed_records Set, last_seq}`
  - 문서 축(CRDT 채택 시) — `doc:{page_id} -> Set<connection_id>`
  메시지 봉투는 모델에 따라 다르다: pull 모델이면 `{type:"record_updated", table, id, version}`(값 없음), push 모델이면 `{doc_id, seq, type:"update"|"awareness", payload(bytea), origin}`. **두 봉투를 한 채널에 섞지 말 것** — 수신측이 "이건 적용할 값인가 재조회 신호인가"를 매번 분기하게 되고 순서 보장이 깨진다.
- **UI/인터랙션**: 연결 상태 인디케이터(정상 시 비표시, "오프라인"/"동기화 중"만 노출). 재연결 성공 시 토스트 없음.
- **의존 기능**: 인증 세션, 권한 모델, 블록 저장소.
- **구현 난이도**: **L** — 단일 서버 broadcast는 1~2일이지만 권한검사·멀티 인스턴스 fan-out·seq gap 복구·백프레셔까지 넣으면 1~2주. **재검토 note(3차 점검)**: 구독 단위를 Notion처럼 **레코드 단위**로 가면 연결당 구독 수가 수백~수천이 되어 레지스트리 규모가 한 자릿수 커지고, 여기에 F-05-20(pull 왕복)이 붙으면 **둘을 합친 실질 난이도는 XL**이다. L로 유지하는 것은 "구독 단위 = 페이지(문서)"를 전제할 때뿐이다.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: 자체 구현 대신 **Hocuspocus**(Yjs 전용 WS 서버, `onAuthenticate`/`onLoadDocument`/`onStoreDocument` 훅 제공 `[확인]`) 또는 Socket.io + Redis 어댑터. MVP 단일 인스턴스에서는 인메모리 broadcast로 시작하되 브로커 인터페이스를 추상화해 둔다.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://www.notion.com/blog/how-we-made-notion-available-offline , https://blog.kowalczyk.info/article/88aee8f43620471aa9dbcad28368174c/how-i-reverse-engineered-notion-api.html , https://deepwiki.com/toeverything/AFFiNE/3.5-real-time-synchronization , https://tiptap.dev/docs/hocuspocus/server/hooks

---

### F-05-03 Presence (아바타 · 커서 · 편집 위치)

- **한 줄 정의**: 지금 이 페이지를 누가 보고 있고 어느 블록을 만지고 있는지 실시간으로 표시한다.
- **사용자 시나리오**:
  1. B가 페이지를 열면 A 화면 상단에 B의 아바타가 나타난다.
  2. B가 5번째 블록을 편집하면 **그 블록 옆에 B의 아바타**가 붙는다 `[확인]`.
  3. A가 B의 아바타를 클릭하면 **B가 있는 위치로 스크롤 점프**한다 `[확인]`.
  4. B가 탭을 닫으면 수 초 내 아바타가 사라진다.
- **동작 상세**:
  - Notion 헬프 원문: "Teammates' avatars appear next to blocks they're editing, and you can click their avatar to jump to their current location on the page." `[확인]`
  - "There's no limit on the number of people who can view and edit the same page or database at the same time." `[확인]` → 인원 상한이 없으므로 **아바타 스택은 N명 초과 시 "+N"으로 접어야 한다** `[추정]`.
  - presence는 **문서 CRDT와 분리된 ephemeral 채널**로 보낸다. Yjs awareness는 "tiny state-based Awareness CRDT that propagates JSON objects"이며 연결 종료 시 자동 삭제된다 `[확인]`. 별도로 두는 이유는 "it doesn't need to be persisted across sessions" `[확인]`.
  - **타이밍 재확인(2026-09-06)**: Yjs 공식 문서 원문 "If a client doesn't receive updates from a remote peer for 30 seconds, it marks the remote client as offline." `[확인]` → **오프라인 판정 임계값은 30초**. 반면 "each client must broadcast its own awareness state in a regular interval"이라고만 하고 **재브로드캐스트 주기의 수치는 공식 문서에 없다** `[확인: 부재]`. 이전 판의 "15초"는 근거 없는 수치였다 → 임계값의 1/3인 **10초를 자체 기준으로 채택** `[추정]`(2회 연속 유실까지 견딤).
  - 사용자 색상은 user_id 해시로 결정론적 배정 `[추정]`.
  - Notion이 **문자 단위 원격 캐럿**을 렌더하는지는 공식 문구에 없다(블록 옆 아바타까지만 명시) `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 같은 사용자가 탭 3개 | 아바타는 user_id 기준 1개로 dedupe, 위치는 최근 활동 탭 기준 |
  | 브라우저 강제 종료 | 하트비트 TTL 만료로 자동 정리(30초 이내) |
  | 게스트/공개 링크 뷰어 | 이름 대신 "익명 사용자 N", 아바타 없음. 프라이버시 정책 필요 |
  | 원격 사용자가 보던 블록이 삭제됨 | focus_block_id를 null 처리, 상단 아바타만 유지 |
  | 100명 동시 접속 | presence 브로드캐스트가 O(N²)로 폭발 → 50~100ms 배칭 + 상위 K명만 상세 전송 |
  | 권한 회수된 사용자 | 서버가 즉시 presence 제거 + 채널 강제 이탈 |
  | 유휴 상태 | 30초 무입력 시 아바타를 흐리게(편집자 아닌 관람자 표시) |
| presence가 알림에 미치는 영향 | Notion은 **활성 뷰어에게 알림을 만들지 않는다** `[확인]` → presence는 UI 장식이 아니라 **알림 파이프라인의 입력**이다(F-05-17) |
| 삭제된 페이지를 보고 있는 사용자 | 채널 종료 이벤트 + 클라이언트 강제 이탈. presence 엔트리 즉시 삭제 |
- **데이터 모델 함의**: **DB에 저장하지 않는다.** Redis Hash `presence:{page_id}` + TTL, 또는 Yjs `awareness.setLocalStateField('user'|'cursor', ...)`. 필드: `user_id, name, avatar_url, color, focus_block_id, selection{anchor,head}, mode, ts`. selection은 **CRDT 상대 위치**(`Y.createRelativePosition`)로 저장해야 원격 편집 후에도 좌표가 깨지지 않는다 `[추정, 강권]`.
- **UI/인터랙션**: 상단 아바타 스택(호버 시 이름 툴팁, 클릭 시 위치 점프), 블록 좌측 거터의 소형 아바타, 원격 선택영역 하이라이트(사용자 색 20% 알파), 유휴 시 디밍.
- **의존 기능**: F-05-02(전송), 사용자 프로필.
- **구현 난이도**: **M** — Yjs awareness 사용 시 2~3일, 직접 구현 시 하트비트·TTL·throttle 때문에 5일.
- **우선순위**: **P1** — 없어도 편집은 되지만 "누가 지금 여기 있다"는 신호가 없어 동시 편집 사고가 늘어난다.
- **클론 시 현실적 대안**: MVP는 **상단 아바타 스택 + 블록 단위 편집자 표시**까지만. 문자 단위 원격 캐럿은 v2(상대 위치 매핑 비용 큼).
- **참고 출처**: https://www.notion.com/help/collaborate-within-a-workspace , https://docs.yjs.dev/getting-started/adding-awareness , https://docs.yjs.dev/api/about-awareness

---

### F-05-04 낙관적 업데이트 & 로컬 트랜잭션 큐(outbox)

- **한 줄 정의**: 서버 응답을 기다리지 않고 화면을 먼저 바꾸고, 실패하면 되돌린다.
- **사용자 시나리오**: 글자를 친다 → 0ms에 화면 반영 → op가 outbox에 쌓이고 배치 전송 → ack 시 조용히 큐에서 제거 → 서버가 거부하면 해당 트랜잭션만 롤백하고 배너 표시.
- **동작 상세**:
  - 편집은 `/saveTransactions`(구 `submitTransaction`)으로 **여러 op를 하나의 트랜잭션에 묶어** 전송된다 `[확인]`. 타이핑마다 왕복하면 안 되므로 디바운스 후 배칭(예: 300~500ms 또는 op 50개) `[추정]`.
  - **outbox는 추정이 아니라 Notion의 실제 컴포넌트다 — 이름은 `TransactionQueue`** `[확인]`(이전 판은 `[추정: 표준 패턴]`으로 달았으나 공식 근거 확보로 격상). 원문: "the transaction is saved into TransactionQueue, the part of the client responsible for sending all transactions to Notion's servers" / "TransactionQueue stores transactions safely in **IndexedDB or SQLite** (depending on platform) **until they're persisted by the server or rejected**." → ① 큐는 **메모리가 아니라 디스크**에 있고 ② 종료 조건이 "성공" 하나가 아니라 **"확정 또는 거부" 둘**이다. 거부 처리 경로를 안 만들면 큐가 영원히 안 비는 좀비 항목이 생긴다.
  - 큐가 비어 있을 때는 대기 없이 즉시 전송된다 `[확인]`: "Usually, TransactionQueue sits empty, so the transaction…is sent to Notion's server right away." → **평상시 지연 0, 밀릴 때만 큐로 동작**하는 설계.
  - 낙관적 렌더의 소스는 로컬 캐시다 `[확인]`: "When you change records on a native app, the local copies in `RecordCache` are also updated." `RecordCache`는 "an LRU cache on top of SQLite or IndexedDB" → **UI는 항상 로컬 캐시를 읽고, 네트워크 계층은 최종 일관성만 책임진다**는 역할 분리.
  - 클라이언트는 각 트랜잭션에 `client_id`를 실어 보내고, 돌아온 자기 자신의 에코는 무시한다 `[추정: 표준 패턴]`. 단 **pull 모델(F-05-20)에서는 에코 판별이 덜 중요하다** — 되당겨온 값이 곧 정답이므로 자기 변경분을 다시 받아도 결과가 같다.
  - 클라이언트 예측과 서버 결과가 다르면 **서버 상태가 진실**이며 로컬을 rebase 한다.
  - Hocuspocus는 저장 훅 실패 시 "document stays in memory and is retried to avoid data loss", 종료 시 `Server.destroy()`가 pending 저장을 flush 한다 `[확인]`. 클라이언트 outbox도 같은 원칙 — **성공 전에는 절대 버리지 않는다**.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 전송 중 브라우저 종료 | outbox를 IndexedDB에 영속화 → 다음 실행 시 재전송 |
  | 서버 403 권한 거부 | 트랜잭션 전체 롤백 + "편집 권한이 없습니다" + 읽기전용 전환 |
  | version 충돌 | 최신 스냅샷 재수신 후 남은 op를 rebase 재적용 |
  | 같은 블록에 op 200개 누적 | 전송 전 coalesce(같은 path의 연속 `set`은 마지막 것만) |
| 서버 레이트리밋 도달 | Notion 공개 API 기준 연결당 **평균 초당 3요청**(버스트 일부 허용) `[확인]` → 429를 실패가 아닌 **백오프 신호**로 다루고 배칭 윈도우를 늘린다. 내부 WS 경로도 연결당 처리량 상한이 필요 |
  | 재전송 중복 도착 | `tx_id` UNIQUE로 서버측 멱등 처리 |
  | 무한 실패 루프 | 5회 초과 시 "충돌 항목"으로 격리하고 사용자에게 노출(조용한 유실 금지) |
  | undo와의 충돌 | undo 스택은 자기 origin 변경만 대상. 원격 변경 되돌림 금지 |
- **데이터 모델 함의**: 클라이언트 `outbox(tx_id PK, page_id, ops, attempts, created_at, status)` — Notion의 `TransactionQueue`에 해당하며 **반드시 디스크(IndexedDB/SQLite)에 둔다** `[확인]`. `status`는 `pending | rejected` 2상태가 최소치다(거부 항목을 사용자에게 노출하기 전까지 보관). 옆에 `RecordCache(record_id PK, table, version, value jsonb, last_access)`를 LRU로 두어 낙관적 렌더의 읽기 소스로 삼는다 `[확인: Notion 동일 구조]`. 서버 `transaction.id` UNIQUE로 idempotency key 역할.
  - 엣지: `RecordCache`는 evict되지만 **`TransactionQueue`는 절대 evict 대상이 아니다**. 둘을 같은 저장소에 두되 GC 정책을 분리해야 한다(F-05-05의 "미전송 op 있는 페이지 evict 금지"와 같은 원칙).
- **UI/인터랙션**: 기본 무표시. 미전송 op가 3초 이상이면 "동기화 중…", 실패 시 "변경 사항을 저장하지 못했습니다 / 재시도".
- **의존 기능**: F-05-01, F-05-02.
- **구현 난이도**: **M** — 큐/배칭/멱등 3~5일. undo 스택 상호작용이 함정.
- **우선순위**: **P0** — 없으면 타이핑마다 왕복 지연이 그대로 노출된다.
- **클론 시 현실적 대안**: Yjs를 쓰면 outbox가 사실상 **Yjs update 버퍼 + y-indexeddb**로 대체되어 직접 만들 필요가 거의 없다. REST 기반이면 TanStack Query optimistic mutation + 자체 IndexedDB 큐.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://github.com/kjk/notionapi/blob/master/submit_transaction.go , https://tiptap.dev/docs/hocuspocus/guides/persistence

---

### F-05-05 오프라인 편집 (페이지 오프라인 지정 & 로컬 저장소)

- **한 줄 정의**: 네트워크 없이도 지정된 페이지를 열람·수정·생성할 수 있게 한다.
- **사용자 시나리오**:
  1. 페이지 `•••` 메뉴 → `Available offline` 선택 `[확인]`.
  2. 해당 페이지가 그 기기 로컬로 다운로드된다(기기별로 따로 지정해야 함) `[확인]`.
  3. 비행기 모드에서 열어 편집한다. embed / form / button 등 라이브 연결이 필요한 블록은 비활성 `[확인]`.
  4. 검색 시 오프라인 페이지가 먼저 나오고, 사용 불가 페이지는 회색 처리 `[확인]`.
- **동작 상세**:
  - Notion은 **SQLite를 best-effort 캐시에서 영속 저장소로 승격**시켰다: "Tracks which pages are available offline / Stores all the data required to render each offline page" `[확인]`.
  - 두 테이블 `[확인]`:
    - `offline_page` — 오프라인 대상 페이지/DB
    - `offline_action(origin_page_id, from_page_id, impacted_page_id, type)` — **왜** 오프라인인지(수동 토글, 즐겨찾기 등)를 이유별로 여러 행 기록
    - 불변식: "every row in `offline_page` must have at least one row in `offline_action`"
  - **핵심 설계 포인트**: 오프라인 여부를 boolean 하나가 아니라 **이유의 집합(reference counting)** 으로 모델링했다. 즐겨찾기를 해제해도 수동 토글이 남아 있으면 오프라인 유지되고, 이유가 전부 사라지면 정리된다(stale 방지).
  - 페이지 갱신 시 "a minimal set of edits to the forest so that it matches the new hierarchy" — 계층 변화에 대해 `offline_action` 행을 최소 삽입/삭제로 reconcile `[확인]`.
  - 자동 다운로드: Business/Enterprise 플랜에서 최근·즐겨찾기 페이지 자동 다운로드, 설정에서 해제 가능 `[확인]`.
  - 데이터베이스는 **첫 50행만 자동 다운로드**, 나머지는 개별 지정 `[확인]`.
  - 오프라인 지정 페이지는 CRDT 데이터 모델로 마이그레이션된다 `[확인]`.
  - **하위 페이지 전파 규칙 확정(2026-09-06, 이전 판 `[확인필요]` 해소)** `[확인]`: 신설 헬프 페이지 원문 "Subpages of any downloaded pages **won't automatically download** for offline use. Make sure to download any important subpages individually!" → **오프라인 지정은 트리를 타고 내려가지 않는다.** 유일한 예외는 자식 자신이 별도 이유(즐겨찾기 / 최근 방문 자동 다운로드 / 다운로드된 DB의 첫 50행)를 갖는 경우다.
    - 이 사실이 `offline_action`의 존재 이유를 확정해 준다. `from_page_id`는 **"부모가 지정됐으니 자식도 오프라인"이라는 상속 전파가 아니라, 자식이 오프라인이 된 여러 이유 중 하나를 가리키는 출처 태그**다. 즉 자동 전파를 구현하면 Notion과 다른 동작이 된다 `[확인 기반 재해석]`.
  - 자동 다운로드는 **유료 플랜 전용**이다 `[확인]`: Free는 수동 지정만, Plus/Business/Enterprise는 "recently visited and favorited pages"를 자동 다운로드. (이전 판이 Business/Enterprise로 좁게 적은 것을 Plus 포함으로 정정)
  - **오프라인에서 막히는 것은 블록 타입만이 아니다** `[확인]`: embed / AI 블록 / form / button 외에 **페이지 공유와 권한 편집 자체가 불가**하다. 권한 mutation은 서버 권위가 필요하므로 오프라인 큐에 넣지 않는다는 뜻 → 클론도 `setPermissionItem` 계열 op는 **outbox 대상에서 제외**해야 한다 `[추정, 설계 귀결]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 오프라인 중 새 페이지 생성 | 클라이언트가 UUID를 직접 생성(서버 왕복 없이) → 온라인 시 그대로 등록 |
  | 오프라인 중 삭제된 페이지를 편집 | 재접속 시 대상 없음 → 편집 폐기 또는 "복원하시겠습니까" 제안 |
  | 오프라인 중 권한 회수 | 재접속 시 서버가 op 거부 → 로컬 사본을 읽기전용 아카이브로 격리 |
  | 저장공간 부족 | LRU evict, 단 **미전송 op가 있는 페이지는 evict 금지** |
  | 오프라인 대상 페이지가 이동됨 | 참조 그래프에서 impacted_page_id 재계산 |
  | 오프라인 중 검색 | 로컬 인덱스만 검색, 나머지는 회색 처리 `[확인]` |
  | 다른 기기에서 같은 페이지 오프라인 편집 | 양쪽 op를 순서대로 적용, 텍스트 병합 / 스칼라 LWW |
  | 오프라인 중 하위 페이지로 이동 시도 | 자식은 자동 다운로드되지 않으므로 `[확인]` **미다운로드 자식은 회색 처리**하고 열지 않는다. "일부만 있는 페이지는 아예 보여주지 않는다"는 Notion 원칙과 일치 |
  | 오프라인 중 공유·권한 변경 시도 | 기능 자체를 비활성 `[확인]`. 권한 op는 outbox에 넣지 않는다(재접속 시 서버 권위와 충돌하면 복구 불가) |
  | 순환 참조: A가 B를, B가 A를 자식/링크로 참조 | `offline_action`은 (origin, from, impacted) 3튜플이라 같은 페이지에 여러 이유가 중복 기록될 뿐 사이클이 무한 확장되지 않는다. reconcile 시 방문 집합 필요 `[추정]` |
  | 빈 값: 이유가 0개가 된 offline_page | 불변식 위반 → 해당 row를 삭제(= 오프라인 해제)하고 로컬 데이터 GC `[확인: 불변식]` |
- **데이터 모델 함의**: 클라이언트 SQLite/IndexedDB에 `block` 미러(= `RecordCache`) + `offline_page` + `offline_action` + `outbox`(= `TransactionQueue`). 서버 스키마 변경은 없고, **"이 사용자가 오프라인으로 들고 있는 페이지 집합"은 클라이언트 소유 상태**라는 점이 핵심이다.
  - `offline_action`은 사실상 **reference counting 테이블**이다. `INSERT`는 이유 추가, `DELETE`는 이유 제거, `COUNT(*)=0`이면 `offline_page` 삭제. 이유 종류(`type`)는 최소 4종이 필요하다: `manual_toggle | favorite | recent | database_row`.
  - 인덱스: `offline_action(impacted_page_id)`(계층 reconcile 시 역조회), `offline_page(last_downloaded_timestamp)`(F-05-06 델타 판별).
- **UI/인터랙션**: `•••` → `Available offline` 토글, 다운로드 진행 인디케이터, 오프라인 배지, 비활성 블록 회색 처리, 설정의 "자동 다운로드" 스위치.
- **의존 기능**: F-05-01(병합), F-05-04(outbox), F-05-06(재동기), 로컬 저장소 계층.
- **구현 난이도**: **XL** — 로컬 DB 스키마 + 참조 그래프 reconcile + 병합 + evict 정책. Notion도 이 하나로 엔지니어링 블로그 한 편을 썼다.
- **우선순위**: **P2** — MVP에서 제외. 단 F-05-01에서 CRDT를 고르면 오프라인의 상당 부분이 "IndexedDB provider 추가"로 거의 공짜가 된다.
- **클론 시 현실적 대안**: v1은 **y-indexeddb 하나만 붙여 "최근에 연 페이지는 오프라인에서 읽고 쓸 수 있다"** 수준. 명시적 오프라인 지정 UI, 참조 그래프(offline_action), DB 행 다운로드는 v2.
- **참고 출처**: https://www.notion.com/blog/how-we-made-notion-available-offline , https://www.notion.com/help/use-pages-offline , https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know

---

### F-05-06 재접속 동기화 (델타 페치 & 머지)

- **한 줄 정의**: 연결이 끊겼다 돌아왔을 때 전체가 아니라 바뀐 것만 받아 로컬과 합친다.
- **사용자 시나리오**: 비행기 착륙 → 앱이 온라인 감지 → 미전송 op 업로드 → 그 사이 서버에서 바뀐 페이지만 다운로드 → 화면 갱신. 사용자 조작은 없다.
- **동작 상세**:
  - Notion 방식 `[확인]`: 클라이언트가 오프라인 페이지마다 `lastDownloadedTimestamp`를 보관하고, 재접속 시 서버의 `lastUpdatedTime`과 비교해 **서버 버전이 더 새로운 페이지만 fetch** 한다. "Reconnecting does not drag your whole workspace back down."
  - 평상시에는 **push 기반**으로 기존 page version snapshot 시스템에 업데이트를 밀어넣는다 `[확인]`.
  - 병합 정책: "text merges happen automatically, with non-text changes (like images) sometimes needing a quick review" `[확인]` → **비텍스트 충돌은 자동 해결하지 않고 사용자에게 넘긴다**는 명시적 정책.
  - Yjs 계열이면 같은 목적을 **state vector 교환**으로 달성한다(클라이언트가 state vector 전송 → 서버가 diff update만 회신) `[확인: AFFiNE 게이트웨이가 state vector 기반 동기화]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 오프라인이 30일 지속 | 대부분 재다운로드. 보존기간 초과 시 델타 대신 full snapshot |
  | 서버 클럭 스큐 | 비교는 **서버 시각만** 신뢰. 클라이언트 시각으로 비교하면 유실 발생 |
  | 업로드 중 재차 끊김 | 트랜잭션 단위 멱등 재전송, 부분 적용 금지 |
  | 두 기기가 각각 오프라인 편집 | 도착 순서대로 적용, 텍스트 병합 / 스칼라 LWW |
  | 오프라인 중 페이지 이동·삭제 | 계층 reconcile로 offline_action 최소 편집 `[확인]` |
  | 델타가 수천 op | 임계치 초과 시 델타 포기하고 snapshot 재다운로드 |
  | 서브트리만 변경됨 | 루트 페이지 `last_updated_time`도 함께 갱신되어야 감지된다 |
- **데이터 모델 함의**: `offline_page.last_downloaded_timestamp`(클라이언트), 서버의 `page.last_updated_time`(**서브트리 변경도 루트로 롤업 필요**), CRDT면 `doc_crdt.state_vector`. 서버에 대량 조회 엔드포인트가 필요하다: `POST /sync/check {page_ids[]} -> {page_id: last_updated_time}`.
- **UI/인터랙션**: 전역 동기화 상태 표시, 비텍스트 충돌 시 "충돌: 이 이미지의 다른 버전이 있습니다 — 내 버전 유지 / 서버 버전 유지".
- **의존 기능**: F-05-05, F-05-04, F-05-02.
- **구현 난이도**: **L** — 델타 판별은 쉽지만 타임스탬프 롤업과 충돌 리뷰 UI가 붙으면 1~2주.
- **우선순위**: **P1** — 오프라인을 안 만들더라도 "탭이 백그라운드였다가 돌아왔을 때" 경로로 반드시 필요.
- **클론 시 현실적 대안**: Yjs 사용 시 재연결 state vector 교환이 프로토콜 차원에서 자동 처리된다. REST 기반이면 `?updated_since=` 쿼리 하나로 시작.
- **참고 출처**: https://www.notion.com/blog/how-we-made-notion-available-offline , https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know , https://deepwiki.com/toeverything/AFFiNE/3.5-real-time-synchronization

---

### F-05-07 인라인 코멘트 (텍스트 범위 앵커 스레드)

- **한 줄 정의**: 문서 안의 특정 텍스트 구간에 스레드를 붙인다.
- **사용자 시나리오**:
  1. 텍스트를 드래그 선택 → 팝업 메뉴 `Comment` `[확인]`, 또는 `cmd/ctrl + shift + M` `[확인]`, 또는 블록 좌측 `⋮⋮` → `Comment`, 또는 블록 호버 시 `💬` `[확인]`.
  2. 입력창이 열리고 코멘트를 작성하면 해당 텍스트에 하이라이트가 남는다.
  3. 기존 스레드의 `💬`를 눌러 답글 `[확인]`.
- **동작 상세**:
  - 스레드는 `discussion`, 그 안에 여러 `comment`. 공개 API에서 `discussion_id`가 스레드를 유일 식별한다 `[확인]`. UI에서는 "Copy link to discussion" 링크의 `d` 쿼리 파라미터로 얻을 수 있다 `[확인]`.
  - **공개 API는 텍스트 범위에 앵커된 새 discussion을 만들 수 없다**: "The public API does not support creating a new discussion anchored to a selected range of text inside a block." `[확인]` → 앵커 생성은 내부 클라이언트 전용 경로.
  - 표시 밀도: `•••` → `Customize page` → `Inline comments` → `Default`(모두 표시) / `Minimal`(아이콘만) `[확인]`.
  - 앵커 저장 포맷은 비공개 `[확인필요]`. 실무 표준은 두 가지 — (a) rich text 인라인 마크로 저장(텍스트 조각에 `discussion_id` 마킹) `[추정]`, (b) CRDT 상대 위치 쌍(anchor/head).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 앵커 텍스트가 전부 삭제됨 | 스레드는 생존. "원본 없음(orphaned)" 표시 후 페이지 코멘트로 강등 |
  | 앵커 중간만 삭제 | 남은 범위로 축소. 길이 0이면 위 규칙 |
  | 앵커 블록이 다른 페이지로 이동 | 스레드도 따라 이동(discussion.parent = block_id) |
  | 두 스레드가 겹치는 범위 | 하이라이트 중첩 렌더, 클릭 시 스레드 선택 목록 |
  | `Can comment` 권한만 있는 사용자 | 코멘트 생성 가능 `[확인]`, 본문 편집 불가 |
  | 오프라인 중 코멘트 작성 | outbox 큐잉, discussion_id는 클라이언트 UUID 선발급 |
  | 스레드 500개인 페이지 | 뷰포트 기반 lazy load + 사이드바 가상 스크롤 |
- **데이터 모델 함의**: `discussion` / `comment`. 앵커는 `discussion.anchor jsonb`:
  ```json
  { "block_id": "...", "kind": "text_range",
    "start": {"path":[0,3],"offset":12},
    "end":   {"path":[0,3],"offset":30},
    "quoted_text": "인용된 원문 스냅샷" }
  ```
  `quoted_text`는 앵커 유실 시 표시용 fallback으로 **반드시 저장한다** `[추정, 강권]`. 인덱스: `discussion(parent_id, resolved)`, `comment(discussion_id, created_time)`.
- **UI/인터랙션**: 텍스트 선택 팝업 `Comment`, `cmd/ctrl+shift+M`, 블록 호버 `💬`, 하이라이트 배경, 우측 사이드 패널, `Default`/`Minimal` 표시 모드.
- **의존 기능**: rich text 모델, 권한(`Can comment`), F-05-02(push), F-05-08(스레드), F-05-10(알림).
- **구현 난이도**: **L** — 스레드 CRUD는 M이지만 **앵커가 동시 편집을 견디게 만드는 부분이 실제 비용**. ProseMirror/Yjs relative position을 쓰면 줄어든다.
- **우선순위**: **P1** — 협업 경쟁력의 핵심. 단 MVP는 F-05-08(블록/페이지 코멘트)로도 성립.
- **클론 시 현실적 대안**: MVP는 **텍스트 범위 대신 블록 단위 코멘트**(앵커 = block_id 하나). 범위 앵커는 에디터가 ProseMirror+Yjs로 확정된 뒤 v1에서 추가.
- **참고 출처**: https://www.notion.com/help/comments-mentions-and-reminders , https://developers.notion.com/docs/working-with-comments , https://developers.notion.com/reference/create-a-comment

---

### F-05-08 페이지 코멘트 · 스레드 해결(resolve) · 반응

- **한 줄 정의**: 페이지 전체에 대한 논의 스레드를 만들고, 처리된 스레드를 접어 정리한다.
- **사용자 시나리오**:
  1. 페이지 상단 호버 → `Add comment` `[확인]` → 페이지 최상단 discussion 생성.
  2. 팀원이 답글. 코멘트 호버 → `🙂` → 이모지 반응 `[확인]`.
  3. 처리 완료 시 스레드 호버 → `✔️` 해결 `[확인]` → 본문에서 사라진다.
  4. 다시 보려면 페이지 상단 `💬` → `Resolved` 필터 → `↪️`로 재오픈 `[확인]`.
  5. 자기 코멘트 수정/삭제: 호버 → `•••` → `Edit comment` / `Delete comment` `[확인]`.
- **동작 상세**:
  - 페이지 코멘트는 `parent.page_id`, 인라인은 `parent.block_id`로 구분(공개 API 기준) `[확인]`. `parent.page_id` / `parent.block_id` / `discussion_id` 중 **정확히 하나만** 지정 가능 `[확인]`.
  - 코멘트 본문은 `rich_text` 배열 또는 `markdown` 문자열 중 **정확히 하나** `[확인]`.
  - **해결된 코멘트는 공개 API로 조회할 수 없다** — Retrieve comments는 open 스레드만 반환 `[확인]`. 즉 `resolved`가 조회 필터의 1급 축이다.
  - 통합에는 read comments / insert comments capability가 각각 필요하며, 사용자는 `Can comment` 이상 권한이 필요하다 `[확인]`.
  - 반응은 코멘트뿐 아니라 **본문 텍스트 하이라이트에도** 붙는다("Highlight text → `🙂`") `[확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 코멘트 제출 | 거부(공백만인 rich_text) |
  | 스레드 첫 코멘트 삭제 | 스레드 유지 + "삭제된 코멘트" 표기. 코멘트 0개 시 스레드 자동 삭제 여부는 정책 결정 `[확인필요]` |
  | 두 명이 동시에 resolve | 멱등 처리. resolved_by는 먼저 커밋된 쪽 |
  | resolve 후 새 답글 | **재확인(2026-09-06)**: 헬프센터가 명시하는 재오픈 경로는 **수동 하나뿐**이다 — "To open a previously resolved comment, select 💬 at the top of the page. Filter by Resolved comments, then select ↪️ to re-open." `[확인]`. **답글이 자동 재오픈시킨다는 서술은 없다** `[확인: 부재]` → 자동 재오픈은 Notion 동작이 아니라 우리 선택이다. 이 문서의 권고는 **"답글 시 자동 재오픈"**(해결된 스레드에 달린 답글이 아무에게도 안 보이는 것이 더 나쁜 실패)이며, 이는 의도된 **원본과의 차이**로 기록한다 |
  | resolve 권한 | 헬프센터는 resolve의 권한 요건을 **명시하지 않는다** `[확인: 부재]`. 2차 출처(Notion VIP)는 "any user with Can edit permission can archive it" / "Users with Can edit or higher access can restore any comment or thread by clicking Re-open"이라고 서술 `[2차 확인]` → 자체 정책: **resolve/reopen은 `Can edit` 이상, 코멘트 작성은 `Can comment` 이상**(작성 권한과 정리 권한을 분리) |
  | 같은 이모지 재클릭 | 토글(제거). PK가 (target, emoji, user)라 자연 처리 |
  | 페이지 삭제 후 복원 | 스레드도 함께 soft delete / 복원 |
  | 페이지 권한 없는 사용자 | 코멘트 자체가 보이지 않음(페이지 권한이 상위) |
  | 코멘트 1,000개 | 커서 페이지네이션 + 오래된 스레드 접기 |
- **데이터 모델 함의**: `discussion(resolved, resolved_by, resolved_at)` + `comment` + `reaction`. 필수 인덱스 `discussion(parent_id, resolved, created_time)`. 실시간 이벤트 타입: `comment.created` / `comment.updated` / `comment.deleted` / `discussion.resolved` / `reaction.toggled`. **코멘트는 CRDT에 넣지 않는다** — append-only이고 권한/쿼리가 필요하므로 관계형 테이블이 맞다 `[추정, 설계 판단]`.
- **UI/인터랙션**: 페이지 상단 호버 `Add comment`, 우측 코멘트 사이드바, `Open`/`Resolved` 필터, 스레드 호버 `✔️`/`↪️`, 코멘트 호버 `•••`, `🙂` 반응 피커.
- **의존 기능**: 권한(`Can comment`), F-05-02, F-05-10.
- **구현 난이도**: **M** — 스레드 CRUD + resolve 토글 + 반응 3~5일.
- **우선순위**: **P0** — 코멘트 없는 협업 도구는 성립하지 않는다(인라인 앵커 없이 페이지/블록 단위만으로 MVP 가능).
- **클론 시 현실적 대안**: 반응은 v1로 미루고 MVP는 "페이지 코멘트 + 답글 + resolve" 3개.
- **참고 출처**: https://www.notion.com/help/comments-mentions-and-reminders , https://developers.notion.com/docs/working-with-comments , https://developers.notion.com/reference/create-a-comment

---

### F-05-09 @멘션 (사람 · 페이지 · 날짜/리마인더)

- **한 줄 정의**: 본문·코멘트 안에서 `@`로 사람·페이지·날짜를 인라인 토큰으로 삽입한다.
- **사용자 시나리오**:
  1. `@` 입력 → 자동완성 팝업, 입력에 따라 **실시간 검색** `[확인]`.
  2. `@김` → 사람 선택 → 아바타+이름 칩 삽입 + 그 사람에게 알림 `[확인]`.
  3. `@분기 목표` → 페이지 선택 → 인라인 하이퍼링크 삽입 `[확인]`.
  4. `@today` / `@tomorrow` / `@1/12` → 날짜 칩 `[확인]`.
  5. `@카밀 @remind next Thursday 4pm ...` → 해당 시각에 그 사람에게 리마인더 `[확인]`.
- **동작 상세**:
  - **페이지 멘션은 라이브 참조다**: "If you change the title of a page, the new title will automatically reflect that change wherever the page is @-mentioned." `[확인]` → 제목 문자열을 복사 저장하면 안 되고 **page_id만 저장하고 렌더 시 조인**해야 한다. 데이터 모델을 결정하는 강한 제약.
  - 알림은 **권한에 종속**: "If you @-mention someone on a page that they don't have access to, they will not be notified." `[확인]` → 멘션 파이프라인에 권한 체크가 필수.
  - 채널 선택: 앱이 열려 있으면 인박스 배지만, 닫혀 있으면 이메일 `[확인]`.
  - 사람뿐 아니라 그룹 멘션도 지원 `[확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 멘션된 페이지가 삭제됨 | "삭제된 페이지"로 렌더(링크 비활성). 토큰 자체는 유실 금지 |
  | 멘션된 페이지에 내가 접근 불가 | 제목 노출은 정보 누출 → "권한 없는 페이지"로 마스킹 |
  | 멘션된 사용자가 워크스페이스에서 제거됨 | 칩 유지, 비활성 사용자로 표시 |
  | 한 문단에 같은 사람 5번 멘션 | 알림 1건으로 dedupe(page+actor+target 윈도우 집계) |
  | 100명 그룹 멘션 | 팬아웃 배치 + 레이트리밋, **접근 권한 있는 사람에게만** |
  | 자동완성 중 오프라인 | 로컬 캐시된 최근 사람/페이지만 후보로 |
  | 과거 시각 리마인더 | 즉시 발송 또는 생성 거부 — 정책 결정 `[확인필요]` |
  | 타임존이 다른 사용자 | 리마인더는 설정자의 tz 기준 절대시각으로 저장 |
- **데이터 모델 함의**: 멘션은 **rich text 인라인 토큰**으로 저장(Notion 내부 포맷 기준 `[추정]`):
  ```
  ["‣", [["u", "<user_id>"]]]                                     사람
  ["‣", [["p", "<page_id>"]]]                                     페이지
  ["‣", [["d", {"type":"date","start_date":"2026-09-10",...}]]]   날짜
  ```
  "누가 어디서 멘션됐나"를 빠르게 찾으려면 파생 인덱스가 필요하다: `mention_index(source_type, source_id, page_id, mentioned_type, mentioned_id, created_at)` — 저장 시 rich text를 파싱해 upsert. 리마인더는 `reminder` 테이블 + 스케줄러(cron/큐).
- **UI/인터랙션**: `@` 트리거 자동완성(사람/페이지/날짜 섹션 구분), ↑↓ + Enter 선택, Esc 취소, Backspace로 칩 통째 삭제, 페이지 멘션 호버 시 프리뷰 팝오버.
- **의존 기능**: 사용자/그룹 디렉터리, 페이지 검색, 권한, F-05-10(알림), 스케줄러.
- **구현 난이도**: **L** — 자동완성 UI(S~M) + 라이브 제목 참조 렌더링(M) + 권한 인지 팬아웃(M) + 리마인더 스케줄러(M). 합 1~2주.
- **우선순위**: **P1**(사람/페이지) / **P2**(날짜·리마인더) — 사람 멘션은 코멘트와 짝을 이뤄야 실전 협업이 성립한다.
- **클론 시 현실적 대안**: MVP는 **코멘트 안에서의 사람 멘션만**(본문 멘션 제외). 페이지 멘션은 v1, 날짜/리마인더 스케줄러는 v2.
- **참고 출처**: https://www.notion.com/help/comments-mentions-and-reminders , https://www.notion.com/help/guides/reminders-and-mentions , https://www.notion.com/help/updates-and-notifications

---

### F-05-10 알림 팬아웃 & 인박스

- **한 줄 정의**: 멘션·답글·제안·리마인더를 구독자에게 배달하고 읽음 상태를 관리한다.
- **사용자 시나리오**: 누군가 내 페이지에 코멘트를 단다 → 사이드바 `Inbox` 옆에 **빨간 배지 + 개수** `[확인]` → 클릭 시 알림 목록 → 항목 클릭 시 해당 스레드로 이동 → 읽음 처리.
- **동작 상세**:
  - 채널 선택 규칙: 앱이 열려 있으면 인박스 배지만, 닫혀 있으면 이메일 `[확인]`.
  - 권한 필터: 접근 권한 없는 페이지의 멘션은 알림을 만들지 않는다 `[확인]`.
  - 제안된 편집도 인박스 알림을 생성한다 `[확인]`.
  - **정정(2026-09-06)**: 이전 판의 "소유자 + 스레드 참여자 + 명시적 팔로워가 자동 구독된다"는 추정은 근거가 없었다. 헬프센터가 열거하는 인박스 알림 트리거는 (a) @멘션, (b) 내 코멘트에 대한 답글, (c) 해당 페이지에 대해 내가 `Notify me`를 켠 경우, (d) Person 속성에 내가 추가됨, (e) 나에게 설정된 리마인더, (f) 페이지에 초대됨 뿐이며 **"암묵적 팔로워" 개념 자체가 문서에 없다** `[확인: 부재]`.
  - 즉 팬아웃 대상은 `구독자 집합`이 아니라 **`이벤트별 대상자 규칙`**으로 계산된다. 멘션은 멘션 대상, 답글은 스레드 상위 코멘트 작성자, 그 외는 명시적 `Notify me` 구독자. 이 차이는 팬아웃 쿼리 구조를 바꾼다.
  - 억제 규칙 `[확인]`: "If you're actively viewing a page that the notification trigger was created on...you won't see any notifications." → **배달 직전에 presence를 조회해 활성 뷰어를 제외**해야 한다(F-05-03 의존이 새로 생긴다).
  - 인박스 필터는 `Unread and read` / `Unread only` / `Archived` / `All workspace updates` 4종이고, 항목별 읽음/안읽음 토글이 있다 `[확인]`.
  - 채널은 인박스 배지 / 데스크톱 알림 / 이메일 / 모바일 push / **Slack** 5종 `[확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 1분 내 같은 스레드에 답글 10개 | "3명이 답글 3개"로 집계(digest) |
  | 자기 자신 멘션 | 알림 생성 안 함 |
  | 알림 생성 후 권한 회수 | **조회 시점에 재검사**하여 숨김(생성 시점 검사만으로 부족) |
  | 페이지 삭제 후 알림 클릭 | "삭제된 페이지" 안내. 크래시 금지 |
  | 알림 100만 건 누적 | 보존기간 정책 + 커서 페이지네이션 |
  | 이메일 전송 실패 | 재시도 큐. 인박스 항목은 이미 생성됨 → 중복 발송 방지 플래그 |
  | 대량 멘션으로 팬아웃 폭증 | **동기 트랜잭션이 아니라 비동기 큐**로 처리해 편집 지연 방지 |
- **데이터 모델 함의**: `notification(..., read_at, **archived_at**)` — 인박스 필터가 Unread/Read/**Archived**/All 4종이므로 읽음과 보관은 **별도 컬럼**이어야 한다 `[확인: 필터 목록으로부터 역산]`. `page_subscription(user_id, page_id, level)`(F-05-17), `user_notification_pref(user_id, inbox, desktop, email, mobile_push, slack)`, 집계용 `notification_digest(user_id, group_key, count, last_at)`. 팬아웃은 작업 큐 기반이고, **배달 파이프라인은 3단 필터**를 통과해야 한다: ① 이벤트별 대상자 계산 → ② 배달 시점 권한 재검사 → ③ presence 조회로 활성 뷰어 제외 `[확인]`. 인덱스: `notification(user_id, read_at, archived_at, created_at DESC)`.
- **UI/인터랙션**: 사이드바 Inbox + 빨간 배지, 알림 목록 패널 + 필터 드롭다운 4종(`Unread and read` / `Unread only` / `Archived` / `All workspace updates`) `[확인]`, 항목별 읽음/안읽음, "모두 읽음", 알림 설정 화면(인박스/데스크톱/이메일/모바일 push/Slack) `[확인]`.
- **의존 기능**: F-05-08, F-05-09, **F-05-03(활성 뷰어 억제)**, **F-05-17(구독 레벨)**, 권한, 작업 큐, 메일 발송.
- **구현 난이도**: **L** — 팬아웃 큐 + 집계 + 채널 라우팅 + 설정 화면.
- **우선순위**: **P1** — 코멘트/멘션이 있는데 알림이 없으면 답글을 아무도 못 본다.
- **클론 시 현실적 대안**: MVP는 **인앱 인박스만**(이메일/푸시 없음), 집계 없이 1:1 알림. 이메일은 v1.
- **참고 출처**: https://www.notion.com/help/updates-and-notifications , https://www.notion.com/help/notification-settings , https://www.notion.com/help/comments-mentions-and-reminders

---

### F-05-11 편집 잠금 (페이지 잠금 / 데이터베이스 잠금)

- **한 줄 정의**: 실수 편집을 막기 위해 페이지를 읽기전용으로, 또는 DB 구조를 고정한다.
- **사용자 시나리오**:
  1. `•••` → `Lock page` 토글 → 상단 브레드크럼에 `Locked` 표시 `[확인]`.
  2. 편집하려면 `Locked` 클릭 → `Unlock for me`(나만 해제, 남들은 잠긴 채 유지) 또는 `Unlock for everyone` `[확인]`.
  3. DB 잠금 시 데이터(행/값)는 수정 가능하지만 **뷰와 속성은 수정 불가** `[확인]`.
- **동작 상세**:
  - 페이지 잠금은 **모두에게 즉시 읽기전용** `[확인]`.
  - **보안 장치가 아니다**: 편집 권한자는 누구나 잠금을 해제할 수 있으므로 잠금은 권한이 아니라 **의도 확인 장치**다 `[확인: 헬프센터가 Unlock for everyone을 일반 편집자 동작으로 서술]`. 권한 시스템과 **별개 레이어**로 구현한다(권한 체크를 통과해도 잠금 체크에서 막힐 수 있어야 한다).
  - **잠금은 서버 1급 상태다** `[확인]`: 공개 webhook 이벤트 목록에 `page.locked` / `page.unlocked`가 존재한다 → 토글이 서버에 기록되고 워크스페이스 이벤트로 방출된다. 이전 판이 저장 위치를 `block.format` 플래그로 추정한 것은 여전히 `[추정]`이지만, **"서버 상태이며 변경이 이벤트로 관측된다"는 사실은 `[확인]`으로 격상**한다. 따라서 잠금 변경은 페이지 채널로도 브로드캐스트해 **다른 사람의 열린 탭이 즉시 읽기전용으로 바뀌어야** 한다.
  - `Unlock for me`는 **잠금 상태를 사용자별로 오버라이드**한다 → 서버 잠금 플래그 + 사용자별(또는 기기별) 해제 상태 두 축이 필요 `[확인: UI 문구 / 추정: 저장 위치]`. 서버 저장인지 기기 로컬인지 `[확인필요]`.
  - `Can edit content` 권한자는 DB 속성/뷰/필터/정렬 변경 및 잠금 토글 자체가 불가 `[확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | A가 편집 중 B가 잠금 | A의 진행 중 op는 커밋, 이후 입력부터 차단 + 배너 |
  | 잠긴 페이지에 오프라인 편집 후 재접속 | 서버가 op 거부 → 충돌 사본 제시 |
  | 잠긴 페이지에 코멘트 | **허용** — 이전 판은 자체 정책으로 정했으나, 재조사 결과 2차 출처들이 일관되게 "Lock Page는 본문 편집만 막고 코멘트는 계속 가능"이라고 서술한다 `[2차 확인: Thomas Frank 등]`. 헬프센터 본문에는 여전히 명시가 없다 `[확인: 부재]` → **정책 유지 + 신뢰도 상향**. 같은 출처가 덧붙이는 세부("`Can comment` 사용자는 페이지 상단/텍스트 선택 코멘트는 가능하지만 **블록 코멘트는 불가**")는 잠금이 아니라 권한 레벨의 제약이며 `[2차 확인 / 1차 미확인]`, 클론에서는 굳이 재현하지 않는다 |
  | 잠긴 페이지의 하위 페이지 | 잠금 비상속 `[추정]` |
  | 잠긴 DB에 행 추가 | 허용(데이터는 편집 가능) `[확인]` |
  | 잠금 상태에서 API 직접 호출 | **서버가 거부**해야 한다. 클라이언트 전용 체크는 무의미 |
| A가 보고 있는 동안 B가 잠금 | 잠금 변경이 페이지 채널로 전파되어 A의 편집 UI가 즉시 비활성화 `[확인: page.locked 이벤트 존재]` |
| 잠긴 페이지의 제안된 편집(F-05-12) 수락 | 수락은 본문 mutation이므로 잠금 가드에 걸린다 → 거부 + 안내 |
- **데이터 모델 함의**: `block.format.block_locked boolean`, `block.format.block_locked_by uuid` `[추정: 저장 위치]` / `[확인: 서버 상태라는 점]`. DB는 `collection.format.collection_lock`(잠금 범위 = 뷰·속성, 데이터 제외 `[확인]`). 사용자별 해제는 `lock_override(user_id, page_id, unlocked_at)` 또는 클라이언트 로컬 `[확인필요]`. **모든 서버 mutation 핸들러에서 잠금 체크를 권한 체크와 별도로 수행**하고, 상태 변경 시 `page.locked`/`page.unlocked`를 페이지 채널 + `event_outbox`(F-05-18)에 동시 발행한다.
- **UI/인터랙션**: `•••` 토글, 브레드크럼 `Locked` 배지(클릭 시 해제 메뉴), 잠금 시 블록 호버 핸들·슬래시 메뉴 비활성, DB 잠금 시 속성 편집 버튼 비활성.
- **의존 기능**: 권한 모델, 블록 format 저장.
- **구현 난이도**: **M** (이전 판 S에서 **상향**) — 근거: 플래그 자체는 반나절이지만 잠금은 **표면적이 넓은 횡단 관심사**다. 본문 op / 블록 이동·삭제 / DB 스키마 / 뷰 설정 / 제안 수락 / 오프라인 재전송까지 **모든 mutation 경로에 가드를 심어야** 하고, 한 군데만 빠져도 "잠갔는데 편집됨" 버그가 난다. 여기에 사용자별 `Unlock for me` 오버라이드 + 잠금 변경의 실시간 브로드캐스트가 붙어 2~3일.
- **우선순위**: **P2** — 사고 방지용. MVP 없이도 서비스 성립.
- **클론 시 현실적 대안**: 단순 `is_locked` boolean + 서버 가드만. `Unlock for me`는 **클라이언트 세션 상태**로만 구현(서버 미저장).
- **참고 출처**: https://www.notion.com/help/collaborate-within-a-workspace , https://developers.notion.com/reference/webhooks-events-delivery (`page.locked`/`page.unlocked`) , https://thomasjfrank.com/notion-sharing-permissions-the-ultimate-guide/ (2차: 잠금과 코멘트의 관계)

---

### F-05-12 제안된 편집 (Suggested edits)

- **한 줄 정의**: 본문을 직접 바꾸지 않고 변경 제안으로 표시하고, 리뷰어가 개별 수락/거절한다.
- **사용자 시나리오**:
  1. `•••` → `Suggest edits` → 상단에 `Suggesting` 표시 `[확인]`.
  2. 타이핑하면 "추가 제안", 삭제하면 "삭제 제안"으로 마킹 `[확인]`.
  3. 페이지 소유자에게 인박스 알림 `[확인]`.
  4. 리뷰어가 제안 호버 → `✔️` 수락(본문 반영) / `❌` 거절(제안 소멸) `[확인]`.
  5. 제안에 이모지 반응하거나 클릭해 코멘트로 답글 `[확인]`.
- **동작 상세**:
  - 권한 요건: `Can comment` 이상이면 제안 가능 `[확인]` → **편집 권한 없이 문서를 바꿀 수 있는 유일한 경로**.
  - 2024-07-29 Notion 2.43에서 도입 `[확인]`.
  - 제안은 실질적으로 **"pending 상태의 op + 코멘트 스레드"의 결합**이며, 수락 시 op가 본문에 커밋된다 `[추정]`.
  - 동시 편집과의 상호작용: 제안 구간을 다른 사람이 직접 편집하면 앵커가 흔들린다 → F-05-07과 동일한 앵커 문제를 공유한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 제안 대상 텍스트가 그 사이 삭제됨 | "적용 불가(stale)"로 표시. 자동 거절하지 않음 |
  | 겹치는 두 제안 | 하나 수락 시 나머지를 재계산 또는 stale 처리 |
  | 제안자가 워크스페이스에서 제거됨 | 제안 유지, 작성자는 비활성 사용자 표시 |
  | 수락 시도 중 페이지가 잠김 | 수락 거부 + 안내 |
  | 제안 500개 | 일괄 수락/거절 액션 필요 |
  | 제안 모드에서 블록 삭제/이동 | 구조 변경도 제안으로 표현해야 함 — 텍스트 제안보다 훨씬 어려움 |
  | 제안 모드 중 오프라인 | pending 제안도 outbox로 큐잉 |
- **데이터 모델 함의**: 위 `suggestion` 테이블(status / kind / anchor / payload / discussion_id). 렌더러는 "확정 텍스트 + pending suggestion 오버레이"를 합성해야 하므로 **에디터 문서 모델에 제안 마크가 1급 시민으로 들어가야 한다**.
- **UI/인터랙션**: `•••` → `Suggest edits`, 상단 `Suggesting` 모드 배지, 삽입은 밑줄+색, 삭제는 취소선, 호버 시 `✔️`/`❌`, 사이드바 제안 목록, 반응·답글.
- **의존 기능**: F-05-07(앵커), F-05-08(스레드), 권한(`Can comment`), 에디터 마크 시스템.
- **구현 난이도**: **XL** — 문서 모델에 "미확정 변경" 레이어를 추가하는 일이고, 동시 편집과 겹치면 앵커 재계산이 필수다.
- **우선순위**: **P2** — MVP 범위 밖.
- **클론 시 현실적 대안**: v2로 미룬다. 그 전에는 **"코멘트에 제안 문구를 적고 소유자가 반영"** 이라는 수동 흐름, 또는 ProseMirror track-changes 계열 플러그인 채택 검토.
- **참고 출처**: https://www.notion.com/help/suggested-edits , https://www.notion.com/releases/2024-07-29

---

### F-05-13 페이지 히스토리 & 버전 복원

- **한 줄 정의**: 과거 시점의 페이지 상태를 조회하고 되돌린다.
- **사용자 시나리오**: `•••` → `Page history` → 시간순 스냅샷 목록(작성자 표시) → 항목 선택 시 그 시점 미리보기 → `Restore` → 현재 버전이 그 상태로 교체되고, 이 복원 자체도 새 버전이 된다.
- **동작 상세**:
  - 서버는 **page version snapshot 시스템**을 운영하며, 오프라인 push 업데이트가 그 위에 얹혔다("push-based updates into our existing page version snapshot system") `[확인]`.
  - 보존기간은 플랜 종속이며 **헬프센터 원문으로 확정** `[확인]`: "7 days if you're on a Free Plan" / "30 days if you're on a Plus Plan" / "90 days if you're on a Business Plan" / "Any number of days if you're on an Enterprise Plan". (이전 판의 `[확인필요]` 해소)
    - **교차검증(2026-09-06)**: 독립 2차 출처들도 7/30/90/무제한으로 일치 `[2차 확인]`. 미해결 목록 #8("검색 결과 간 표현 불일치")은 이로써 종결 — 불일치는 실제 정책 차이가 아니라 "휴지통 30일"과 "버전 히스토리 30일(Plus)"을 혼동한 서술 때문이었다.
  - **삭제는 히스토리와 다른 축의 2단계 GC다** `[확인]`: 휴지통에서 기본 30일 보관 → 영구 삭제 후에도 **추가 30일간 데이터가 남고**("retained for 30 days before they become inaccessible to all users, even workspace owners") 그 뒤 접근 불가. 즉 `deleted_at`(휴지통) / `purged_at`(영구삭제) / `hard_deleted_at`(완전 소거) **3개 타임스탬프**가 필요하다.
  - 복원 방식은 두 가지 `[확인]`: (a) 과거 버전에서 **블록만 복사해 현재 페이지에 붙여넣기**, (b) 해당 버전을 열고 `Restore`. (a)가 존재한다는 것은 **과거 스냅샷이 읽기 전용 렌더 가능한 완전한 문서**여야 한다는 뜻이다(diff 조각이 아니라).
  - 복원은 비파괴적: "Even if you or someone on your team restores a past version, you can always go back to the page as it was during any point in the past 30 days." `[확인]`
  - 삭제 복구(휴지통·데이터 보존 설정)는 별개 축 `[확인]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 복원 중 다른 사람이 편집 중 | 복원을 일반 트랜잭션으로 처리 → 이후 편집이 그 위에 얹힘 |
  | 복원 대상에 그 사이 삭제된 하위 페이지 포함 | 하위 페이지 복원 여부 정책 필요(기본: 해당 페이지 본문만) |
  | 보존기간 경과 | 스냅샷 GC. 만료 예고 없음. 플랜 다운그레이드 시 즉시 잘릴지 유예할지 정책 필요 |
| 휴지통 비운 뒤 복구 요청 | 영구 삭제 후에도 30일간은 데이터가 존재한다 `[확인]` → **관리자 전용 복구 경로**를 별도 설계(일반 UI에는 노출 금지) |
| 과거 버전에서 블록만 복사 | 스냅샷이 부분 렌더·부분 복사 가능해야 함 `[확인]` → 스냅샷 포맷을 diff가 아닌 **재구성 가능한 형태**로 |
  | 스냅샷이 수백 MB | 전체 record_map 대신 **증분 + 주기적 full snapshot** |
  | 오프라인 편집이 뒤늦게 도착 | 타임스탬프가 아니라 도착 순서로 새 버전 생성 |
  | 초당 수십 op | 스냅샷을 op마다 만들지 않고 **활동 종료 후 N분 디바운스**로 커밋 |
- **데이터 모델 함의**: `page_snapshot(id, page_id, created_at, authors[], record_map, expires_at)` + 삭제 축의 `block(deleted_at, purged_at, hard_deleted_at)` `[확인: 2단계 보존]`. `expires_at`은 생성 시점 플랜으로 고정할지 조회 시점 플랜으로 재계산할지 결정해야 한다(다운그레이드 처리) `[추정, 정책 결정]`. 스냅샷 커밋 전략은 Hocuspocus의 debounced `onStoreDocument`와 같은 발상 `[확인]`. CRDT를 쓰면 `doc_update` 로그를 특정 seq까지 재생해 임의 시점 복원이 가능하므로 스냅샷은 성능 최적화 수단이 된다.
- **UI/인터랙션**: `•••` → `Page history`, 우측 버전 타임라인, 미리보기(가능하면 diff 하이라이트), `Restore` + 확인 모달.
- **의존 기능**: F-05-01(트랜잭션 로그), 플랜/과금(보존기간).
- **구현 난이도**: **L** (이전 판 M에서 **상향**) — 근거: 저장/조회/복원 3종만 보면 M이 맞지만 실사용 가능한 히스토리는 ① 활동 종료 디바운스 스냅샷 커밋 ② 스냅샷 범위(서브트리/하위 페이지 포함 여부) 결정 ③ **플랜별 보존기간 GC 잡** ④ 휴지통·영구삭제 2단계 보존과의 정합 ⑤ 복원을 일반 트랜잭션으로 재적용해 실시간 세션과 충돌하지 않게 하기 ⑥ 작성자 그룹핑까지 필요하다. 여기에 diff 뷰를 얹으면 XL에 근접.
- **우선순위**: **P1** — 특히 LWW로 시작한다면 데이터 유실 위험이 커지므로 **MVP 안전망으로 앞당길 가치가 있다**.
- **클론 시 현실적 대안**: MVP는 **버전 목록 + 전체 복원**만(diff 없음). 5분 디바운스로 JSON 통째 저장, 보존 30일 고정.
- **참고 출처**: https://www.notion.com/blog/how-we-made-notion-available-offline , https://www.notion.com/help/duplicate-delete-and-restore-content , https://www.notion.com/help/custom-data-retention-settings

---

### F-05-14 대용량 페이지 동기화 성능 (청크 로딩 · 부분 구독)

- **한 줄 정의**: 블록이 수천 개인 페이지에서도 초기 로드와 실시간 갱신이 무너지지 않게 한다.
- **사용자 시나리오**: 3,000블록짜리 회의록을 연다 → 상단 화면분이 먼저 렌더 → 스크롤하면 다음 청크 로드 → 그 사이 다른 사람의 편집도 계속 반영.
- **동작 상세**:
  - Notion 내부 API는 `/api/v3/loadPageChunk`로 **블록 서브트리를 청크 단위**로 가져오고, `/api/v3/getRecordValues`로 id 목록을 배치 조회한다 `[확인]`. 청크 크기·커서 파라미터의 정확한 의미는 비공개 `[확인필요]`.
  - 오프라인 DB 다운로드는 **첫 50행만 자동**이라는 명시적 상한이 있다 `[확인]` → 대용량 컬렉션에 하드 리밋을 두는 설계 사례.
  - 공개 API 상한도 같은 철학이다 `[확인]`: 연결당 **평균 초당 3요청**, 요청당 **block 1,000개 / 500KB**, rich text 2,000자, 배열 100요소, relation 100개, people 100명. **Notion은 무제한을 약속하지 않고 축마다 상한을 박는다** — 클론도 같은 방식으로 각 축에 숫자를 정해두는 편이 사후 리팩터링보다 싸다.
  - Yjs 계열의 함정: **`Y.Doc` 하나가 커질수록 초기 로드가 전체 상태 전송**이 된다. AFFiNE은 워크스페이스 문서와 페이지별 subdoc을 분리하고 state vector로 diff만 주고받는다 `[확인]`.
  - 성능 지렛대 `[추정, 표준 기법]`: (a) 페이지 = 1 Y.Doc, 하위 페이지 = subdoc, (b) update 로그 compaction, (c) 원격 update 적용 시 렌더 배칭(rAF), (d) presence throttle, (e) 뷰포트 가상화.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 10,000블록 페이지 | 가상 스크롤 필수. 전체 DOM 렌더 금지 |
  | 아직 못 받은 영역에 원격 편집 도착 | update는 문서 상태에 적용, 렌더는 스크롤 도달 시 |
  | update 로그 수십만 건 | 주기적 compaction으로 state 갱신 후 로그 절단 |
  | 5,000블록 붙여넣기 | 클라이언트 청크 분할 전송 + 서버 트랜잭션 op 상한. Notion 공개 API의 실측 상한(요청당 **block 1,000개 / 500KB**, rich text `content` **2,000자**, 배열 **100요소**) `[확인]`을 청크 크기 기준선으로 채택 |
  | 대형 페이지에 50명 동시 접속 | presence/update 배칭 없으면 서버 CPU 폭발 → 채널별 배칭 윈도우 |
  | 모바일 저사양 기기 | CRDT 문서 메모리 상한 초과 → subdoc 지연 로드로 회피 |
  | 첫 화면 렌더 전 편집 시도 | 로드 완료까지 입력 버퍼링 또는 읽기전용 표시 |
- **데이터 모델 함의**: **페이지 단위 `doc_id` 경계 = 동기화 단위 = 권한 단위 = 채널 단위**로 일치시키는 것이 이 도메인 전체를 관통하는 결정이다. `doc_update` 로그 + compaction 잡. 청크 API: `POST /pages/{id}/chunk {cursor, limit}` → `{record_map, cursor, has_more}`.
- **UI/인터랙션**: 스켈레톤 로딩, 무한 스크롤, 하단 "더 불러오는 중", 대형 페이지에서도 상단 인터랙션은 즉시 가능.
- **의존 기능**: F-05-01, F-05-02, 에디터 렌더러(가상화).
- **구현 난이도**: **L** — 청크 API + 가상 스크롤 + 배칭. 나중에 하면 리팩터링 비용이 크므로 **경계 설계는 초기에 확정**해야 한다.
- **우선순위**: **P1** (단, "페이지 = 동기화/권한/채널 단위" 경계 결정은 **P0**).
- **클론 시 현실적 대안**: MVP는 **페이지당 블록 상한(예: 1,000)** 을 두고 전체 로드. 청크·가상화는 v1.
- **참고 출처**: https://blog.kowalczyk.info/article/88aee8f43620471aa9dbcad28368174c/how-i-reverse-engineered-notion-api.html , https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know , https://deepwiki.com/toeverything/AFFiNE/3.3-data-models-and-storage

---

### F-05-15 협업 Undo/Redo (origin 범위 실행취소)

- **한 줄 정의**: `Cmd/Ctrl+Z`가 "문서의 마지막 변경"이 아니라 **"내가 한 마지막 변경"**만 되돌리게 한다.
- **사용자 시나리오**:
  1. A가 문단 3을 통째로 지운다. 거의 동시에 B가 문단 7에 타이핑한다.
  2. A가 `Cmd+Z`를 누른다 → **문단 3만 복구되고 B의 타이핑은 그대로 남는다**.
  3. A가 `Cmd+Shift+Z`로 재실행하면 문단 3이 다시 사라진다.
  4. A가 되돌린 대상이 화면 밖이면 그 위치로 스크롤되고 잠깐 하이라이트된다.
- **동작 상세**:
  - Yjs `Y.UndoManager`는 트랜잭션의 `origin`으로 되돌릴 대상을 고른다. 기본 동작은 "all local changes that don't specify a transaction origin will be tracked"이고, `trackedOrigins` Set을 주면 **그 origin의 변경만** undo 대상이 된다 `[확인]` → 사용자별 undo 스택이 이렇게 만들어진다.
  - 연속 입력을 하나의 undo 단위로 묶는 임계값 `captureTimeout`의 기본값은 **500ms** `[확인]`. 0으로 두면 키 입력 하나가 undo 하나가 된다.
  - `stopCapturing()`으로 병합 경계를 강제한다 `[확인]` — 블록 타입 변환·붙여넣기 직전에 호출해야 "타이핑과 타입 변환이 한 번에 되돌아가는" 사고를 막는다.
  - 커서 복원: `stack-item-added`에서 selection을 stack item의 meta에 저장하고 `stack-item-popped`에서 되돌린다 `[확인]`. 이 처리를 빼면 undo 후 커서가 엉뚱한 곳에 남는다.
  - **Notion 제품이 원격 변경을 되돌리지 않는다는 공식 서술은 찾지 못했다** `[확인필요]`. 다만 헬프센터가 동시 편집을 "잠금 없음 + 최근 변경 우선"으로 정의하는 이상 `[확인]`, undo를 "역방향 op 트랜잭션"으로 순진하게 구현하면 **남의 최신 편집을 덮어쓰는 경로**가 된다 → origin 스코프는 선택이 아니라 필수 `[추정, 설계 판단]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 내가 지운 블록을 그 사이 남이 편집 | undo는 **tombstone 되살리기**여야 하고 "원문 재삽입"이면 안 된다. 재삽입하면 남의 편집이 사라진다 |
  | 내가 편집한 블록을 남이 삭제 | undo 대상이 없음 → no-op으로 소비하고 스택에서 제거(에러/크래시 금지) |
  | 오프라인 중 undo | 로컬 스택만 조작. 역방향 변경도 일반 편집처럼 outbox에 쌓인다(F-05-04) |
  | undo 직후 원격 op 도착 | undo 결과 위에 정상 적용. undo는 특별한 상태가 아니라 일반 트랜잭션 |
  | 탭 새로고침 / 세션 재시작 | 스택은 휘발. 그 이전으로 돌아가려면 F-05-13(히스토리)뿐 — 사용자에게 이 경계를 UI로 알릴 것 |
  | 1,000블록 붙여넣기 되돌리기 | 하나의 stack item이어야 한다 → 붙여넣기 전체를 **단일 트랜잭션/단일 origin**으로 커밋 |
  | 제안 모드(F-05-12) 중 undo | 제안 레이어만 되돌리고 확정 본문은 불변 |
  | 권한 강등 후 undo | 서버가 역방향 op를 거부 → 스택 폐기 + 읽기전용 배너(F-05-19) |
  | 잠긴 페이지에서 undo | 잠금 가드에 걸려 거부. 스택은 유지하되 안내 |
- **데이터 모델 함의**: **서버 영속 스키마 없음 — 클라이언트 메모리 전용.** 대신 서버 계약에 제약이 생긴다: **모든 트랜잭션이 `origin`(= `transaction.client_id` 또는 세션 id)을 반드시 실어야 한다**(F-05-04와 같은 필드를 공유). CRDT 경로는 `new Y.UndoManager(scope, {trackedOrigins: new Set([localOrigin]), captureTimeout: 500})`. LWW 경로를 택했다면 클라이언트에 `undo_entry {seq, inverse_ops[], origin, base_versions{block_id: version}}`를 쌓고, 적용 직전 `base_versions`와 현재 `block.version`을 대조해 **stale이면 그 항목을 skip**해야 한다(이 검사가 없으면 undo가 곧 데이터 유실이다).
- **UI/인터랙션**: `Cmd/Ctrl+Z`, `Cmd+Shift+Z`(Windows는 `Ctrl+Y` 병행), 되돌림 대상이 뷰포트 밖이면 스크롤 + 플래시 하이라이트 `[추정, UX 권장]`, 되돌릴 항목이 없으면 무동작(브라우저 기본 undo로 새지 않게 `preventDefault`).
- **의존 기능**: F-05-01(병합 코어), F-05-04(트랜잭션 origin), 에디터 selection 모델, F-05-11(잠금 가드).
- **구현 난이도**: **M** — Yjs면 `UndoManager` 설정 + selection 메타 복원으로 2~3일. **LWW 경로를 직접 구현하면 L** (역연산 생성 + stale 검사 + 이동/삭제의 역연산 정의).
- **우선순위**: **P0** — `Cmd+Z`가 남의 글을 지우는 제품은 출시할 수 없다. 그리고 이건 나중에 얹는 기능이 아니라 **트랜잭션에 origin을 싣는 코어 계약**이라 F-05-01/04와 같은 시점에 결정해야 한다.
- **클론 시 현실적 대안**: Yjs `UndoManager`를 그대로 채택하고 `trackedOrigins`에 로컬 origin만 넣는다. 페이지 전환 시 스택 초기화(문서 경계 = undo 경계). 다중 사용자 "redo 경쟁"은 지원하지 않는다.
- **참고 출처**: https://docs.yjs.dev/api/undo-manager , https://www.notion.com/help/collaborate-within-a-workspace

---

### F-05-16 데이터베이스 실시간 동기화 (행·스키마 공유 / 뷰 설정은 개인·공유 2층)

- **한 줄 정의**: 같은 데이터베이스를 여러 명이 볼 때 행·스키마 변경은 즉시 전원에게 반영되지만, filter/sort는 **명시적으로 공유하기 전까지 나에게만** 적용된다.
- **사용자 시나리오**:
  1. A와 B가 같은 테이블 뷰를 연다.
  2. A가 3행의 `Status`를 `In progress`로 바꾸면 B 화면에서도 즉시 바뀐다.
  3. B가 `Filter` → `Status is Done`을 건다. 이때 `Save for everyone`을 **선택하지 않으면 B에게만** 적용된다 `[확인]`.
  4. B가 `Save for everyone`을 선택하면 A의 뷰도 즉시 필터링된다 `[확인]`.
  5. A가 속성 하나를 삭제하면 B의 그 열이 사라진다(스키마는 항상 공유).
- **동작 상세**:
  - 헬프센터 원문 `[확인]`: "You can choose to `Save for everyone` if you want the filter to be applied for everyone in the database view. If you want the filter to apply only for you, don't select this option." 정렬도 동일. → **뷰 설정은 `공유 baseline + 사용자별 오버레이` 2층 구조여야 한다.** 이 문장 하나가 이 기능의 데이터 모델을 결정한다.
  - "Each database view has its own settings. Settings applied to one database view won't be applied across all other database views automatically." `[확인]` → 뷰는 독립 엔티티이며 설정을 형제 뷰에 전파하지 않는다.
  - 행의 property 변경과 페이지 본문 변경은 **다른 이벤트 축**이다: 공개 webhook이 `page.properties_updated`와 `page.content_updated`를 분리해 방출한다 `[확인]` → 실시간 채널 메시지 타입도 분리하는 편이 구독자 필터링에 유리하다 `[추정]`.
  - 2025-09-03 API 버전에서 database가 `data_source`로 분해되어 `database.content_updated`·`database.schema_updated`가 **deprecated**되고 `data_source.content_updated`·`data_source.schema_updated`가 도입됐다 `[확인]` → Notion 자신이 **컨테이너(database)와 스키마+행 집합(data source)을 분리**하는 방향으로 갔다. 클론도 `collection`(스키마+행)과 `collection_view`(표현)를 처음부터 분리해두는 편이 안전하다 `[추정]`.
  - 잠긴 DB는 **뷰·속성 편집만** 막고 데이터 편집은 허용한다 `[확인]`(F-05-11) → 잠금 가드가 "뷰/스키마 mutation"과 "행 mutation"을 구분할 수 있어야 한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 두 명이 같은 셀을 동시 수정 | 스칼라 속성은 LWW. rich text 속성만 문자 단위 병합(F-05-01) |
  | A가 속성 삭제 + B가 그 속성에 값 입력 | 삭제 우선. B의 값은 tombstone에 남겨 속성 복원 시 되살아나게 한다(즉시 물리 삭제 금지) |
  | A가 select 옵션 삭제 + B가 그 옵션 선택 | 옵션 id 참조가 깨진다 → 값을 null이 아니라 "삭제된 옵션"으로 렌더해 유실을 드러낸다 |
  | B의 개인 필터가 A의 스키마 변경으로 무효화 | 필터가 참조하는 `property_id` 부재 → **그 조건만 drop** 하고 배너 표시. 뷰 전체를 리셋하지 않는다 |
  | relation 대상 행이 삭제됨 | 참조 제거 + 반대편 relation·rollup 재계산 트리거 |
  | 순환 relation / rollup (A→B→A) | rollup 계산에 방문 집합 + 깊이 상한. 사이클 감지 시 계산 중단하고 셀에 오류 표시 |
  | 10,000행 뷰에서 1행 변경 | 전체 재조회 금지 → **행 단위 델타 전송** 후 클라이언트가 필터/정렬을 재평가. 변경 행이 필터를 벗어나면 목록에서 제거 |
  | 정렬 키가 바뀌어 행이 점프 | 다른 사용자 화면에서 행 위치가 튄다 → 애니메이션 + **현재 편집 중인 행은 재정렬 보류** `[추정, UX]` |
  | 페이지 단위 권한으로 일부 행이 안 보임 | 뷰 결과에서 제외. 집계(count/sum)에 포함할지 여부는 정보 누출 문제 → **제외가 기본** `[추정, 보안 판단]` |
  | 같은 사용자가 두 기기에서 개인 필터 변경 | 개인 상태를 서버 저장하면 기기 간 동기화 필요, 로컬 저장하면 기기마다 다름 `[확인필요]` |
- **데이터 모델 함의**: 위 의사 스키마의 `collection_view.shared_query` + `collection_view_user_state.personal_query`. **실효 쿼리 = `merge(shared_query, personal_query)`** 이며 개인 조건이 우선한다. 실시간 이벤트는 세 갈래로 나뉜다 — ① `row.updated`(행 델타, 구독자 전원) ② `schema.updated`(전원 + 뷰 재평가 강제) ③ `view.shared_query.updated`(전원). **개인 상태 변경은 브로드캐스트하지 않는다**(같은 사용자의 다른 세션에만 전달). 인덱스: `collection_view_user_state(view_id, user_id)` PK로 충분.
- **UI/인터랙션**: 필터/정렬 팝오버의 `Save for everyone` 체크박스 `[확인]`, 개인 필터가 걸린 뷰 헤더에 개인 상태 배지, 초기화 버튼(정확한 라벨 `[확인필요]`), 원격 행 변경 시 셀 하이라이트 페이드, 원격 스키마 변경 시 열 추가/제거 애니메이션.
- **의존 기능**: 데이터베이스·속성 모델(도메인 02/03), F-05-02(전송), F-05-11(잠금 범위 구분), 권한.
- **구현 난이도**: **L** — 행 델타 전파만 보면 M이지만, **공유/개인 2층 병합 + 스키마 변경 시 개인 필터 무효화 + 필터 재평가로 인한 행 입·퇴장 처리**까지 넣으면 1~2주. rollup/relation 재계산이 얽히면 더 늘어난다.
- **우선순위**: **P1** — 단, `collection_view_user_state` **테이블 자리를 잡는 것 자체는 P0**. 공유 전용으로 만들었다가 나중에 개인 필터를 넣으려면 뷰 저장 구조와 모든 쿼리 경로를 갈아엎게 된다.
- **클론 시 현실적 대안**: MVP는 **공유 뷰 설정만**(모든 변경이 전원에게 즉시 적용) + `collection_view_user_state` 테이블만 미리 생성해 두고 `personal_query`는 항상 비움. v1에서 `Save for everyone` 체크박스와 개인 오버레이 UI를 켠다. 대용량 뷰의 서버측 필터 재평가는 v2.
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts , https://developers.notion.com/reference/webhooks-events-delivery , https://www.notion.com/help/collaborate-within-a-workspace

---

### F-05-17 페이지 알림 구독 레벨 (Notify me) & 인박스 필터

- **한 줄 정의**: 페이지마다 어떤 활동을 알림으로 받을지 사용자가 직접 고르고, 받은 알림을 읽음·보관 상태로 정리한다.
- **사용자 시나리오**:
  1. 페이지 `•••` → `Notify me` → `All comments` / `Replies and @mentions` / `All updates` 중 선택 `[확인]`.
  2. 이후 그 페이지의 해당 활동이 인박스로 들어온다.
  3. 인박스에서 `Unread and read` / `Unread only` / `Archived` / `All workspace updates`로 필터링 `[확인]`.
  4. 항목을 읽음/안읽음으로 토글하거나 보관한다 `[확인]`.
- **동작 상세**:
  - 구독과 무관하게 **항상 발생하는 트리거** `[확인]`: @멘션, 내 코멘트에 대한 답글, Person 속성에 내가 추가됨, 나에게 설정된 리마인더, 페이지 초대.
  - `Notify me`는 그 위에 얹는 **명시적 opt-in**이다. 헬프센터에 "페이지를 만들면/코멘트를 달면 자동으로 팔로워가 된다" 류의 서술은 **없다** `[확인: 부재]` → 이전 판(F-05-10)의 자동 구독 추정을 폐기했다.
  - **활성 뷰어 억제** `[확인]`: "If you're actively viewing a page that the notification trigger was created on...you won't see any notifications." → 알림 생성/배달 파이프라인이 presence(F-05-03)를 조회해야 한다. 이건 UX 디테일이 아니라 **모듈 간 의존성**이다.
  - 채널 5종 `[확인]`: 인박스 배지 / 데스크톱 알림(앱 열려 있을 때) / 이메일(앱이 닫혀 있을 때) / 모바일 push / Slack.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | `All updates` 구독 + 대량 편집 | 편집 이벤트를 N분 윈도우로 집계해 1건으로("3명이 12회 편집"). 원본 op 수만큼 알림을 만들면 인박스가 죽는다 |
  | 페이지를 보고 있는 중에 멘션당함 | 알림 억제 `[확인]`. 단 탭이 백그라운드/최소화면 억제하지 않아야 함 `[추정]` — presence에 `mode: view/edit`뿐 아니라 **포커스 여부**가 필요해진다 |
  | 하위 페이지 활동 | 상위 구독이 상속되는지 `[확인필요]` → 기본 정책: **비상속**(상속하면 워크스페이스 루트 구독 하나로 전체 알림이 폭주) |
  | 구독 후 권한 회수 | 구독 행은 남기되 **배달 시점 권한 재검사**로 skip. 구독 행 삭제는 권한 복구 시 사용자가 다시 설정해야 해서 나쁨 |
  | 페이지 삭제 → 복원 | 구독 행 soft delete → 복원 시 부활 |
  | 여러 기기 | 읽음/보관 상태는 **서버 단일 소스**(기기별 상태 금지) |
  | 전역 알림 off + 페이지 구독 on | 사용자 전역 설정이 채널을 이긴다(인박스 항목은 생성, 이메일/push만 억제) |
  | 자기 자신의 활동 | 알림 생성 안 함(actor == target이면 skip) |
- **데이터 모델 함의**: `page_subscription(user_id, page_id, level)` — level enum `all_comments | replies_and_mentions | all_updates | none` `[확인: UI 3단계 + 해제]`. 기존 `subscription(source)` 설계는 폐기. `notification.archived_at`을 `read_at`과 **별도 컬럼**으로 둬야 인박스 필터 4종이 성립한다 `[확인: 필터 목록으로부터 역산]`. `user_notification_pref(user_id, inbox, desktop, email, mobile_push, slack)`. 팬아웃 쿼리는 `이벤트 타입 → 대상자 규칙 → page_subscription.level 필터 → 권한 재검사 → presence 억제` 순의 파이프라인.
- **UI/인터랙션**: 페이지 `•••` → `Notify me` 라디오 3종, 인박스 상단 필터 드롭다운 4종, 항목 hover 시 읽음/보관 액션, "모두 읽음", 설정 화면의 채널 토글 5종.
- **의존 기능**: F-05-10(팬아웃 엔진), F-05-03(presence 억제), 권한, 사용자 설정.
- **구현 난이도**: **S** — 구독 레벨 테이블 + 팬아웃 필터 조건 + 인박스 필터 쿼리는 하루~이틀. **단 "활성 뷰어 억제"를 presence와 연결하는 순간 M** (알림 워커가 실시간 계층을 조회해야 하므로 모듈 경계를 넘는다).
- **우선순위**: **P2** — MVP는 "멘션·답글은 항상 알림" 고정으로 성립. 다만 `page_subscription` 테이블과 `archived_at` 컬럼 자리는 F-05-10 설계 시 함께 잡아둔다(나중에 넣으면 알림 마이그레이션이 필요).
- **클론 시 현실적 대안**: MVP는 레벨 없이 멘션+답글만, 읽음 여부만. v1에서 `Notify me` 3단계 + 보관. Slack 연동은 범위 밖.
- **참고 출처**: https://www.notion.com/help/notification-settings , https://www.notion.com/help/updates-and-notifications

---

### F-05-18 외부 시스템으로의 이벤트 배달 (Webhook)

- **한 줄 정의**: 워크스페이스에서 일어난 변경을 외부 서비스의 HTTPS 엔드포인트로 밀어준다.
- **사용자 시나리오**:
  1. 통합 설정에서 공개 SSL 엔드포인트 URL과 구독할 이벤트 타입을 등록한다 `[확인]`.
  2. Notion이 그 URL로 **1회성 `verification_token`을 POST**한다 `[확인]`.
  3. 사용자가 그 토큰 값을 Notion UI에 붙여넣고 `Verify`를 누르면 구독이 활성화된다 `[확인]`.
  4. 이후 변경이 생길 때마다 서명된 이벤트가 POST로 도착한다.
- **동작 상세**:
  - 이벤트 타입 전체 목록 `[확인]`: `page.created` / `page.content_updated` / `page.properties_updated` / `page.moved` / `page.deleted` / `page.undeleted` / `page.locked` / `page.unlocked` / `database.created` / `database.moved` / `database.deleted` / `database.undeleted` / `data_source.created` / `data_source.content_updated` / `data_source.moved` / `data_source.deleted` / `data_source.undeleted` / `data_source.schema_updated` / `comment.created` / `comment.updated` / `comment.deleted`. `database.content_updated`·`database.schema_updated`는 **2025-09-03 기준 deprecated** `[확인]`.
    - 이 목록 자체가 **도메인 05의 이벤트 사전(vocabulary)** 이다. 내부 실시간 채널 메시지 타입을 이 이름 그대로 쓰면 나중에 webhook을 붙일 때 매핑 계층이 필요 없다 `[추정, 설계 권고]`.
  - 서명 검증 `[확인]`: 모든 요청에 `X-Notion-Signature` 헤더가 붙고 값은 `sha256=<hex-digest>` 형식의 **HMAC-SHA256(raw body, verification_token)** 이다. 즉 **핸드셰이크 토큰이 그대로 서명 키로 재사용**된다. 검증은 **수신한 바이트 그대로** 해야 한다 — "re-serialized JSON produces different bytes and fails verification" `[확인]`. 비교는 timing-safe로.
  - 재시도 `[확인]`: 지수 백오프로 **최대 8회**, 마지막 시도는 최초 이벤트로부터 약 **24시간** 뒤. 문서가 목표를 **at-most-once delivery**로 명시한다 → **유실 가능성이 설계상 인정된다**. 수신 측은 webhook만 믿지 말고 주기적 reconcile(폴링 재동기)을 병행해야 한다 `[추정, 운영 판단]`.
  - 공통 payload 필드 `[확인]`: `id`, `timestamp`(ISO 8601), `workspace_id`, `subscription_id`, `integration_id`, `type`, `authors[]`(person/bot/agent), `accessible_by[]`(public connection에 한함), `attempt_number`(1–8), `entity{id, type}`, `data{}`.
  - payload는 **엔티티 식별자 중심의 thin 이벤트**다(변경 내용 전문을 싣지 않는다) → 수신 측은 이벤트를 트리거로 삼아 API를 재조회하는 모델 `[추정: 필드 구성으로부터의 추론]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 엔드포인트 다운 | 8회 재시도 후 폐기 `[확인]`. 반복 실패 시 구독을 자동 비활성화하는지는 `[확인필요]` → 자체 구현은 "연속 실패 N회 시 비활성 + 소유자 통지" |
  | 같은 이벤트가 2회 도착 | `id`로 멱등 처리(`attempt_number`만 다른 재시도) |
  | 순서가 뒤바뀜 | 순서 보장 없음 `[추정]` → `timestamp` 기준 재정렬 + 엔티티별 최신 상태 재조회로 수렴 |
  | 대량 편집으로 이벤트 폭주 | 발행 측에서 엔티티 단위 coalesce(같은 page의 연속 `content_updated`는 윈도우당 1건) |
  | 권한 없는 리소스 | `accessible_by`로 수신 범위를 제한 `[확인]`. 자체 구현 시 **구독 생성자의 권한으로 이벤트를 필터링**하지 않으면 권한 우회 통로가 된다 |
  | 삭제 이벤트 후 재조회 | 404가 정상 → 이벤트 payload만으로 처리 가능해야 함(삭제 이벤트에는 최소 식별자 + 부모 정보 포함) |
  | 서명 검증 실패 | 401 반환 + 로깅. 프록시가 body를 재직렬화하지 않는지 먼저 의심 |
  | 편집 트랜잭션은 커밋됐는데 이벤트 발행 실패 | **transactional outbox**로 원자성 확보(같은 DB 트랜잭션에 append, 배달은 별도 워커) `[추정, 표준 설계]` |
- **데이터 모델 함의**: 위 의사 스키마의 `webhook_subscription` / `event_outbox` / `webhook_delivery`. 핵심은 `event_outbox`가 **F-05-10 알림 팬아웃과 같은 소스를 공유**한다는 점이다 — "변경이 일어났다"는 사실을 한 곳에 append하고, 인박스 워커와 webhook 워커가 각각 소비한다. 이 구조로 안 만들면 알림과 webhook에서 각각 다른 이벤트 감지 로직을 유지하게 된다. 인덱스: `webhook_delivery(subscription_id, next_retry_at)`, `event_outbox(created_at)` + 소비 커서.
- **UI/인터랙션**: 통합 설정의 endpoint 등록 폼, 이벤트 타입 체크박스 목록, `Verify` 버튼 + 토큰 붙여넣기 입력, 최근 배달 로그(상태 코드·시도 횟수·재전송 버튼).
- **의존 기능**: F-05-01(변경 감지 지점), 작업 큐, 통합/인증 모델, 권한.
- **구현 난이도**: **M** — outbox + 배달 워커 + HMAC 서명 + 재시도 스케줄은 3~5일. **실제 비용은 이벤트 타입을 전 도메인 mutation 경로에 심는 작업**(블록/DB/코멘트/잠금 각각)이며 이건 코드 전반에 퍼진다.
- **우선순위**: **P2** — 외부 통합 수요가 생기는 시점(팀 도입 이후). 단 `event_outbox`는 F-05-10과 공유하므로 **MVP에서 outbox 형태로 만들어두면 나중이 거의 공짜**가 된다.
- **클론 시 현실적 대안**: v1까지는 내부 이벤트를 `event_outbox`에만 쌓고 소비자는 인박스 워커 하나. v2에서 같은 테이블 위에 webhook 배달 워커를 추가한다. 서명은 처음부터 HMAC-SHA256 + raw body 규약을 그대로 채택(직접 설계하지 말 것).
- **참고 출처**: https://developers.notion.com/reference/webhooks-events-delivery , https://developers.notion.com/reference/webhooks

---

### F-05-19 연결 인증 & 권한 변경의 실시간 전파

- **한 줄 정의**: 실시간 연결마다 신원과 페이지 권한을 검증하고, 권한이 바뀌면 **이미 열려 있는 세션**에 즉시 반영한다.
- **사용자 시나리오**:
  1. B가 페이지를 열어 편집 중이다.
  2. 관리자가 B의 접근 권한을 `Can edit` → `Can comment`로 낮춘다.
  3. 수 초 내 B의 화면이 읽기전용으로 전환되고 편집 컨트롤이 비활성화된다. 진행 중이던 미전송 편집은 롤백되며 배너로 알린다.
  4. 권한을 완전히 회수하면 B의 탭이 페이지를 닫고 "접근 권한이 없습니다"를 표시하며, A 화면의 아바타 목록에서도 B가 사라진다.
- **동작 상세**:
  - 접합점: Hocuspocus는 연결 수립 시 `onAuthenticate` 훅에서 토큰 검증과 문서 접근 판정을 수행한다 `[확인]`. 자체 구현이든 라이브러리든 **채널 join 시점 권한 검사**는 필수 지점이다.
  - **join 시 1회 검사만으로는 부족하다**: 세션은 장수명이고 권한은 그 사이 바뀐다. 따라서 ① 매 mutation 시 서버 재검사, ② 권한 변경 시 **캐시 무효화 브로드캐스트**의 두 축이 필요하다 `[추정, 설계 판단]`.
  - 잠금 상태가 서버에서 이벤트로 방출된다는 사실(`page.locked`/`page.unlocked` webhook `[확인]`)은 **"편집 가능 여부"가 클라이언트 판단이 아니라 서버가 밀어주는 상태**라는 방증이다. 권한도 같은 취급을 받아야 한다 `[추정]`.
  - **상속 권한의 비용**: 페이지 권한이 부모에서 상속되는 모델에서는 부모 한 곳의 변경이 **서브트리 전체 × 그 서브트리를 구독 중인 모든 연결**에 영향을 준다. 무효화 비용이 O(서브트리 × 구독자)라 가장 과소평가되기 쉬운 지점이다 `[추정]`.
  - 토큰 만료: WebSocket은 수 시간 유지될 수 있어 access token이 연결 도중 만료된다. 재인증 메시지 또는 조용한 재연결이 필요하며, 이때 **미전송 outbox는 절대 버리지 않는다** `[추정, 표준]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 편집 중 권한 강등 | 진행 중 트랜잭션은 서버가 거부 → 로컬 롤백 + 읽기전용 배너. **조용한 유실 금지**(거부된 내용을 클립보드/충돌 사본으로 남길 것) |
  | 권한 회수 시 presence | 서버가 즉시 해당 connection을 채널에서 제거하고 다른 사용자의 아바타 목록에서도 삭제(F-05-03) |
  | 오프라인 사본 보유자의 권한 회수 | 재접속 시 서버가 op 거부 → 로컬 사본을 **읽기전용으로 격리**. 즉시 삭제할지는 정책(기업 환경이면 삭제) `[확인필요]` |
  | 부모 페이지 권한 변경 | 서브트리 전체 무효화. 페이지 단위 캐시라면 서브트리 순회가 필요하고, 순회가 비싸면 space 단위 무효화로 퇴화시킨다 |
  | 게스트/공개 링크 비활성화 | 열려 있던 익명 세션 즉시 종료 + 채널 강제 이탈 |
  | 권한 재평가 폭주(대량 멤버 변경) | `(user, page)` 캐시 + **무효화는 lazy**(무효 표시만, 재계산은 다음 접근 시) |
  | 토큰 만료 | 만료 전 갱신 시도 → 실패 시 재연결 유도. outbox 보존, 편집은 잠시 큐잉 |
  | 권한 없는 채널 join 시도 | 조인 거부 + 존재 여부도 노출하지 않음(404와 403을 구분하면 페이지 존재가 새어나간다) |
  | 워크스페이스에서 제거된 사용자의 활성 연결 | 전 채널 강제 종료 + 토큰 무효화 |
- **데이터 모델 함의**: 런타임 `connection {id, user_id, token_exp, subscribed_pages[], last_seq}`, 권한 캐시 `perm:{user_id}:{page_id} -> level`(짧은 TTL + 명시적 무효화). 무효화 채널 `perm-invalidate:{space_id}`, payload `{scope: "user"|"page"|"subtree", user_ids[], root_page_id}`. **영속 스키마는 권한/공유 도메인 소유**이고 이 기능은 그 위의 전파 계층이다. 서버 mutation 핸들러는 항상 `권한 검사 → 잠금 검사 → 버전 검사` 3단을 통과시킨다.
- **UI/인터랙션**: 읽기전용 전환 배너("편집 권한이 변경되었습니다"), 접근 상실 시 모달 + 워크스페이스 홈 이동, 편집 컨트롤 즉시 비활성화(슬래시 메뉴·드래그 핸들·툴바), 재연결 중 표시.
- **의존 기능**: 권한/공유 도메인(도메인 06), F-05-02(전송 계층), F-05-04(outbox 롤백), F-05-03(presence 제거).
- **구현 난이도**: **L** — 연결 인증 자체는 S지만 본체는 **상속 권한의 실시간 무효화**다. 권한 계산 모델이 확정되지 않은 상태에서 착수하면 두 번 만들게 된다. 실시간 계층에서 가장 과소평가되는 항목.
- **우선순위**: **P0** — 채널 join과 매 mutation에 권한 검사가 없으면 **실시간 계층이 곧 권한 우회 경로**가 된다(REST에만 권한을 걸고 WS를 비워두는 것이 전형적 사고). 보안 이슈라 MVP에서 뺄 수 없다.
- **클론 시 현실적 대안**: MVP는 정밀도를 포기하고 단순하게 — (a) 채널 join 시 1회 권한 검사, (b) **모든 mutation에서 서버측 재검사**(이건 절대 생략 불가), (c) 권한 변경 시 해당 space의 모든 연결에 **일괄 무효화 브로드캐스트** 후 각 클라이언트가 재검증. 정밀한 서브트리 무효화와 토큰 무중단 갱신은 v2.
- **참고 출처**: https://tiptap.dev/docs/hocuspocus/server/hooks , https://developers.notion.com/reference/webhooks-events-delivery , https://www.notion.com/help/collaborate-within-a-workspace

---

### F-05-20 레코드 버전 무효화 & 로컬 캐시 동기 (RecordCache ↔ syncRecordValues)

- **한 줄 정의**: 서버가 "무엇이 바뀌었다"는 사실만 알려주고, 클라이언트가 자기 캐시와 대조해 어긋난 레코드만 되당겨와 화면을 갱신한다.
- **사용자 시나리오**:
  1. A가 페이지를 연다. 렌더된 블록·페이지·컬렉션 각각이 `MessageStore` 구독 목록에 올라간다 `[확인]`.
  2. B가 3번 블록을 고쳐 서버가 트랜잭션을 커밋한다.
  3. A의 소켓으로 `{table:"block", id:"…", version:1234}` 같은 **값 없는 알림**이 도착한다 `[확인]`.
  4. A의 클라이언트가 `RecordCache`의 해당 레코드 버전(1233)과 비교 → 다르므로 outdated 목록에 넣는다.
  5. 짧은 배칭 후 `syncRecordValues([{table, id, version}])`를 호출해 값을 받고, 캐시를 갱신하고, 그 레코드를 구독 중인 컴포넌트만 재렌더한다 `[확인]`.
  6. 스크롤로 블록이 화면에서 사라지면 구독을 해제한다 `[추정: "렌더할 때 구독한다"의 자연스러운 대칭]`.
- **동작 상세**:
  - 공식 서술 3문장이 이 기능의 전부다 `[확인]`: ① "Every client has a long-lived WebSocket connection to MessageStore" ② "When the Notion client renders a block (or page, or any other kind of record), the client subscribes to changes of that record" ③ "it verifies that version of the block in its local cache…it sends a `syncRecordValues` API request to the server with the list of outdated client records."
  - **왜 값을 안 밀고 버전만 미는가** `[추정: 설계 의도 추론]`
    | 이유 | 효과 |
    |---|---|
    | 팬아웃 페이로드가 상수 크기 | 5,000블록 페이지든 1블록이든 알림 크기가 같다. 브로커 대역폭이 문서 크기와 분리된다 |
    | 권한 필터를 한 곳에 모을 수 있다 | 실시간 계층이 값을 모르니 유출할 수도 없다. **권한 검사는 `syncRecordValues` 응답 조립 지점 하나** |
    | 알림 유실이 자기치유된다 | 다음 알림 때 버전 gap이 드러나 함께 복구. push 모델처럼 op 하나 잃으면 상태가 영구히 어긋나지 않는다 |
    | 캐시 무효화 모델과 동형 | `RecordCache`가 LRU라 evict되어도 로직이 같다(없으면 pull) |
  - 대가도 분명하다 `[추정]`: **왕복이 1회 늘어난다**(알림 → 조회). 그래서 문자 단위 실시간 타이핑에는 불리하고, 실제로 Notion의 동시 타이핑 반영이 Google Docs보다 덜 매끄럽다는 사용자 인상과 정합적이다 `[확인필요: 체감 지연 수치는 미측정]`.
  - 배칭이 필수다: 한 트랜잭션이 20개 레코드를 건드리면 알림 20건이 온다 → **알림을 N ms 모아 `syncRecordValues` 1회로 합친다** `[추정, 표준 기법]`.
  - CRDT 경로를 택하면 이 기능은 **state vector 교환으로 대체**된다(diff만 주고받으므로 값 pull이 불필요) `[확인: AFFiNE]`. 즉 F-05-20은 **"LWW/레코드 모델을 택했을 때만 필요한 기능"**이며, 이 클론의 권고(Yjs)에서는 구현하지 않는다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 빈 값: 캐시에 없는 레코드의 알림 | 구독 중인데 캐시에 없으면(evict됨) 그냥 pull. no-op 아님 |
  | 알림은 왔는데 pull이 403 | 권한이 그 사이 회수된 것 → 로컬 캐시에서 해당 레코드 **삭제**하고 구독 해제(F-05-19). 낡은 값을 계속 보여주면 권한 회수가 무력화된다 |
  | 삭제된 레코드 | pull 응답이 `alive:false` 또는 빈 값 → tombstone 렌더 후 구독 해제 |
  | 중첩: 부모만 구독하고 자식은 미구독 | 자식 변경 알림이 오지 않아 **화면이 조용히 낡는다**. 렌더한 자식을 전부 구독하거나 부모 버전을 자식 변경 시 함께 올려야 한다 `[추정, 함정]` |
  | 동시편집: pull 응답이 도착하기 전에 내가 그 블록을 고침 | 로컬 미확정 트랜잭션(`TransactionQueue`)을 서버 값 **위에 재적용**해야 한다. 그냥 덮어쓰면 타이핑이 되돌아가는 "글자 튐" 버그 |
  | 알림 순서 역전 | 버전이 단조 증가하므로 **더 낮은 버전 알림은 무시**. 버전 비교만으로 순서 문제가 사라지는 것이 이 모델의 장점 |
  | 대용량: 1,000개 레코드가 동시에 무효화 | pull 요청을 청크로 쪼갠다(공개 API 상한 참고: 요청당 block 1,000 / 500KB `[확인]`). 임계 초과 시 개별 pull 포기하고 `loadPageChunk` 재로드로 전환 |
  | 순환 참조: 레코드 A pull이 B를 참조하고 B가 A를 참조 | pull은 요청한 id 목록만 반환하는 평면 배치 조회라 재귀가 없다. 참조 전개는 렌더 계층 책임 |
  | 소켓 끊김 중 발생한 변경 | 재연결 시 **구독 목록 전체를 버전과 함께 재등록**하고 서버가 어긋난 것만 회신 → F-05-06과 같은 경로 |
  | 탭 백그라운드 | 구독 유지하되 pull을 지연(포그라운드 복귀 시 일괄). 배터리·요청 수 절감 |
- **데이터 모델 함의**:
  - 서버: 별도 테이블 없음. 단 **모든 레코드 테이블(`block`, `collection`, `collection_view`, `discussion`, …)에 단조 증가 `version` 컬럼이 있어야** 하고, 트랜잭션 커밋 시 함께 증가시켜야 한다. 이것이 이 기능의 유일한 스키마 요구다.
  - 배치 조회 엔드포인트: `POST /syncRecordValues { requests: [{table, id, version}] } -> { recordMap: { block: { "<id>": {value, version, role} } } }` — 응답에 **`role`(요청자의 권한 레벨)을 함께 실어** 클라이언트가 편집 가능 여부를 판단하게 한다 `[추정: Notion recordMap 응답이 role을 포함하는 것으로 알려짐 / 1차 미확인]`.
  - 클라이언트: `RecordCache(record_id PK, table, version, value jsonb, last_access)` + LRU evict + 구독 레지스트리 `Set<record_id>`.
  - 인덱스: 서버는 `(table, id)` PK 조회만 하므로 추가 인덱스 불필요. 대신 **버전 증가가 hot path**라 행 잠금 경합을 피할 설계(레코드 단위 갱신, 페이지 전역 카운터 금지)가 필요하다 `[추정]`.
- **UI/인터랙션**: 직접적인 UI 없음. 관측 가능한 증상만 있다 — 원격 변경이 반영될 때의 **미세 지연**, 재렌더 범위(구독한 레코드 컴포넌트만 갱신), 스크롤 시 구독 등록/해제. 디버그용으로 "구독 중 레코드 수 / 대기 중 pull 수"를 개발자 패널에 노출하면 성능 회귀를 조기에 잡는다.
- **의존 기능**: F-05-02(소켓 전송), F-05-04(`TransactionQueue` 재적용), F-05-19(pull 시점 권한 필터), 레코드 저장소의 `version` 컬럼.
- **구현 난이도**: **M** — 알림 배칭 + 버전 비교 + 배치 조회 + 재렌더 스코핑으로 3~5일. **단 "미확정 로컬 트랜잭션을 pull 결과 위에 재적용"을 빼먹으면 글자 튐 버그가 나고, 이걸 제대로 만들면 L에 가까워진다.**
- **우선순위**: **P1** — LWW/레코드 모델을 택했다면 P0(전송 계층의 실질). **CRDT(Yjs)를 택하면 불필요**하므로 F-05-01의 선택에 종속된다. 이 클론의 권고안(Yjs)에서는 **미구현**.
- **클론 시 현실적 대안**:
  1. (권고) Yjs 채택 → 이 기능 자체를 만들지 않는다. state vector 교환이 같은 역할을 한다.
  2. (LWW 경로) 알림 봉투를 `{table, id, version}`으로 고정하고 pull 배칭 윈도우 50~100ms. 초기엔 "알림 오면 페이지 전체 재조회"로 단순화해도 되지만, `version` 컬럼과 알림 봉투 포맷만은 처음부터 정확히 잡아둘 것(나중에 바꾸면 클라이언트·서버·브로커를 동시에 고쳐야 한다).
  3. 하이브리드 금지 — 값 push와 버전 push를 한 채널에 섞지 말 것(요약도 참조).
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://github.com/kjk/notionapi/blob/master/api_syncRecordValues.go , https://deepwiki.com/toeverything/AFFiNE/3.5-real-time-synchronization

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-05-01 | 동시 편집 병합 (CRDT/LWW 코어) | XL | P0 | 블록 모델, 권한 |
| F-05-02 | 실시간 전송 계층 (구독/fan-out) | L | P0 | 인증, 권한 |
| F-05-03 | Presence (아바타·커서) | M | P1 | F-05-02 |
| F-05-04 | 낙관적 업데이트 & outbox | M | P0 | F-05-01, F-05-02 |
| F-05-05 | 오프라인 편집 (로컬 저장소) | XL | P2 | F-05-01, F-05-04 |
| F-05-06 | 재접속 델타 동기화 | L | P1 | F-05-05, F-05-02 |
| F-05-07 | 인라인 코멘트 (범위 앵커) | L | P1 | rich text, F-05-08 |
| F-05-08 | 페이지 코멘트·스레드·해결·반응 | M | P0 | 권한, F-05-02 |
| F-05-09 | @멘션 (사람/페이지/날짜) | L | P1 / P2(날짜) | 디렉터리, F-05-10 |
| F-05-10 | 알림 팬아웃 & 인박스 | L | P1 | F-05-08, F-05-09 |
| F-05-11 | 편집 잠금 (페이지/DB) | **M** (S↑) | P2 | 권한 |
| F-05-12 | 제안된 편집 | XL | P2 | F-05-07, F-05-08 |
| F-05-13 | 페이지 히스토리 & 복원 | **L** (M↑) | P1 | F-05-01 |
| F-05-14 | 대용량 페이지 동기화 성능 | L | P1 (경계 결정은 P0) | F-05-01, F-05-02 |
| F-05-15 | 협업 Undo/Redo (origin 스코프) | M (LWW면 L) | **P0** | F-05-01, F-05-04 |
| F-05-16 | DB 실시간 동기화 (개인/공유 뷰 2층) | L | P1 (스키마 자리는 P0) | DB 모델, F-05-02 |
| F-05-17 | 구독 레벨(Notify me) & 인박스 필터 | S (presence 연동 시 M) | P2 | F-05-10, F-05-03 |
| F-05-18 | 외부 이벤트 배달 (Webhook) | M | P2 (outbox는 MVP 권장) | F-05-01, 큐 |
| F-05-19 | 연결 인증 & 권한 실시간 전파 | L | **P0** | 권한 도메인, F-05-02 |
| F-05-20 | 레코드 버전 무효화 & 캐시 동기(pull 모델) | M (재적용 포함 시 L) | P1 / **LWW 택하면 P0, CRDT 택하면 미구현** | F-05-02, F-05-04 |

**P0 (MVP 필수)**: F-05-01, F-05-02, F-05-04, F-05-08, **F-05-15**, **F-05-19** — "동시에 편집되고, 즉시 반영되고, 코멘트를 달 수 있고, **`Cmd+Z`가 남의 글을 지우지 않으며**, **실시간 채널이 권한 우회 경로가 되지 않는다**"까지가 최소 성립 조건.

> GAP 점검에서 P0로 **끌어올린 두 개**: F-05-15(협업 undo)와 F-05-19(연결 인증·권한 전파). 둘 다 "나중에 얹는 기능"으로 오해되기 쉽지만, 전자는 **모든 트랜잭션에 origin을 싣는 코어 계약**이고 후자는 **보안 경계**라 사후 추가 시 코어를 다시 손대야 한다.
>
> **난이도 재검토 요약(3차 점검)** — 이 도메인에서 과소평가되기 쉬운 순서대로:
> | 항목 | 표면 난이도 | 실제 | 과소평가되는 이유 |
> |---|---|---|---|
> | F-05-19 권한 실시간 전파 | S(토큰 검사) | **L** | 진짜 비용은 **상속 권한의 무효화 전파**(O(서브트리 × 구독자)). 게다가 모든 편집 트랜잭션이 조상 체인을 로드한다는 것이 공식 서술로 확인됨 `[확인]` |
> | F-05-02 + F-05-20 (전송+동기 프로토콜) | L | **합쳐서 XL** | 구독 단위를 레코드로 내리면 레지스트리·팬아웃·pull 배칭·미확정 트랜잭션 재적용이 전부 붙는다 |
> | F-05-01 병합 코어 | XL | **XL 유지** | 트리 이동/사이클은 텍스트 CRDT보다 어렵다. 라이브러리를 써도 스키마 매핑·GC·영속화가 남는다 |
> | F-05-13 히스토리 | M | **L** (2차 점검에서 상향) | 보존기간 GC + 휴지통 2단계 보존 + 복원의 실시간 세션 정합 |
> | F-05-11 잠금 | S | **M** (2차 점검에서 상향) | 모든 mutation 경로에 가드를 심는 횡단 관심사 |
> | F-05-15 협업 undo | S("Ctrl+Z 붙이면 되지") | **M~L** | 역연산 정의 + stale 검사. 안 하면 undo가 곧 남의 데이터 유실 |

### 의존 순서 (구축 경로)

```
블록 모델 ─┬→ F-05-01 병합 코어 ─┬→ F-05-04 낙관적 업데이트 ─┬→ F-05-05 오프라인 ─→ F-05-06 재동기
           │                     │                          └→ F-05-15 협업 undo (origin 계약 공유)
           │                     ├→ F-05-13 히스토리
           │                     └→ F-05-18 webhook (event_outbox)
           └→ F-05-02 전송 계층 ─┬→ F-05-20 버전 무효화/pull (LWW 경로 전용, CRDT면 생략)
                                 ├→ F-05-03 presence ────────────┐
                                 ├→ F-05-08 코멘트 ─┬→ F-05-07 인라인 앵커 ─→ F-05-12 제안된 편집
                                 │                  └→ F-05-10 알림 ←┬── F-05-09 멘션
                                 │                                   ├── F-05-17 구독 레벨 ←┘ (활성 뷰어 억제)
                                 │                                   └── F-05-18 webhook (같은 outbox 소비)
                                 ├→ F-05-14 청크/성능
                                 └→ F-05-16 DB 실시간 동기화
권한 모델 ─┬→ F-05-11 잠금 (모든 mutation 경로에 가드)
           └→ F-05-19 연결 인증 & 권한 실시간 전파 ─→ (F-05-02의 선결 조건)
```

### 단계별 권고

| 단계 | 포함 | 목표 |
|---|---|---|
| MVP | F-05-01(Yjs 기본), F-05-02(단일 인스턴스 WS), F-05-04, F-05-08(페이지 코멘트+resolve), F-05-13(스냅샷 안전망), **F-05-15**(UndoManager), **F-05-19**(join+mutation 권한검사) + `event_outbox`·`collection_view_user_state`·`notification.archived_at` **테이블 자리만 확보** | 두 명이 같은 페이지를 안전하게 동시 편집하고 코멘트를 단다 |
| v1 | F-05-03, F-05-06, F-05-07, F-05-09(사람/페이지), F-05-10(인앱), F-05-14(청크), **F-05-16**(공유 뷰 + 개인 필터), F-05-11(잠금) | 팀이 실사용 가능한 협업 |
| v2 | F-05-05(명시적 오프라인), F-05-09(날짜/리마인더), F-05-12(제안된 편집), **F-05-17**(Notify me 3단계+보관), **F-05-18**(webhook 배달), F-05-19 정밀 서브트리 무효화 | Notion 동등 수준 |

> **F-05-20의 위치**: 이 로드맵은 F-05-01에서 **Yjs를 택한 전제**이므로 F-05-20(버전 무효화 pull 모델)은 어느 단계에도 없다 — state vector 교환이 대신한다. 반대로 MVP를 LWW로 가겠다고 결정하면 F-05-20이 **MVP의 P0로 올라오고** 대신 CRDT 관련 항목이 빠진다. 두 경로는 배타적이며, 로드맵을 확정하기 전에 F-05-01의 선택부터 못 박아야 한다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 협업 스택 | 차용 가능한 지점 |
|---|---|---|
| **AFFiNE / BlockSuite** | Y-Octo(Rust, Yjs 프로토콜 호환) CRDT, Socket.io + Redis pub/sub 게이트웨이, state vector 동기화, awareness `[확인]` | 블록 기반 에디터를 Yjs 위에 올리는 정석. BlockSuite는 "Yjs shared type을 직접 관찰·변경하는 에디터 바인딩"으로 설명되며 `[확인]`, 노션형 블록 모델 ↔ CRDT 매핑의 레퍼런스 |
| **Docmost** | API 서버(3000) + **Hocuspocus 협업 서버(3001) 분리**, Tiptap + Yjs, 바이너리 영속화 `[확인]` | 협업 서버를 별도 프로세스로 분리하는 최소 아키텍처. 우리 클론에 그대로 적용 가능 |
| **Hocuspocus (Tiptap)** | `onAuthenticate` / `onLoadDocument` / `onStoreDocument` 훅, **debounce 저장**, 저장 실패 시 메모리 유지 후 재시도, `Server.destroy()`가 pending flush `[확인]` | 서버를 직접 안 짜도 되는 가장 빠른 길. `onAuthenticate`에서 우리 권한 모델 호출 |
| **Yjs 생태계** | `y-websocket`(릴레이 서버), `y-webrtc`(P2P), `y-indexeddb`(브라우저 오프라인 영속), awareness 프로토콜 `[확인]` | F-05-05의 상당 부분을 `y-indexeddb`로 확보. presence는 awareness로 대체 |
| **Outline** | Yjs + ProseMirror 기반 멀티플레이어 | 문서 단위 협업 + 코멘트 스레드 UX 참고 |

### 권고 조합 (이 클론 기준)

| 레이어 | 권고 | 근거 |
|---|---|---|
| 문서 CRDT | **Yjs** (`Y.Doc` 1개 = 페이지 1개) | 생태계 성숙. 오프라인/presence/재동기가 한 프로토콜로 해결 |
| 실시간 전파 모델 | **push**(update 바이너리 relay) 하나로 통일. Notion식 **pull**(버전 알림 + `syncRecordValues`)은 채택하지 않음 | Notion의 pull 모델은 레코드 캐시 + LWW 전제에서 최적이다 `[확인]`. CRDT를 택하면 update 자체가 작고 순서가 자기기술적이라 pull이 왕복만 늘린다. **단 두 모델을 섞지 말 것**(F-05-20) |
| 에디터 바인딩 | ProseMirror + `y-prosemirror` (BlockSuite 구조 참고) | 블록 트리 + 인라인 마크(코멘트 앵커, 멘션)를 한 모델로 표현 |
| 협업 서버 | **Hocuspocus** 또는 동등한 Yjs WS 서버, 별도 프로세스 | 인증 훅 + debounce 영속화 기본 제공 (Docmost 선례) |
| 영속화 | Postgres `bytea`(Yjs state/update) + 메타데이터는 정규 테이블 | "Data must be stored as binary" `[확인]` |
| Presence | Yjs awareness | ephemeral, 연결 종료 시 자동 정리 `[확인]` |
| 코멘트/멘션/알림 | **CRDT 밖의 관계형 테이블 + REST/WS 이벤트** | append-only이고 권한 필터·집계 쿼리가 필요. CRDT에 넣으면 권한/조회가 어려워진다 `[추정, 설계 판단]` |
| 오프라인 | v1 `y-indexeddb` → v2에서 Notion의 `offline_page`/`offline_action` 참조 그래프 이식 | 단계적 투자 |

---

## 미해결 / 확인필요

### 아직 열려 있는 것

| # | 항목 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| 1 | Notion CRDT의 구체 알고리즘(YATA/RGA/Fugue 등) | 클론 설계의 직접 참조 불가. 현재 1차 근거는 오프라인 블로그의 한 문장뿐 | Notion 엔지니어링 후속 포스트, 컨퍼런스 발표 |
| 2 | 온라인 전용 페이지의 실제 충돌 해결 경로 | "레거시 LWW + 신규 CRDT 공존" `[추정]`의 검증. **3차 점검에서 반증 시도했으나 2차 출처들이 CRDT / OT로 갈려 서로 모순** → 1차 근거 없음이 재확인됨 | 릴리스 노트, 추가 엔지니어링 블로그 |
| 3 | 문자 단위 원격 커서 캐럿 렌더 여부 | F-05-03 구현 범위 결정. 참고로 F-05-20의 pull 모델(알림→재조회 왕복)은 **문자 단위 캐럿 동기와 상성이 나쁘다** → presence만 별도 ephemeral 채널을 쓴다는 가설과 정합 `[추정]` | 실제 제품에서 2인 동시 편집 확인 |
| 4 | 인라인 코멘트 앵커의 저장 포맷 | F-05-07 데이터 모델 확정 | 내부 API 응답 관찰(리버스 엔지니어링 자료) |
| 5 | `Unlock for me`가 서버 저장인지 기기 로컬인지 | F-05-11 스키마 결정 | 다른 기기에서 재로그인해 확인 |
| 10 | 웹소켓 프레임/구독 메시지 스키마 상세 | F-05-02·F-05-20 설계 참고용(필수 아님). 서비스 이름(`MessageStore`)과 의미론(버전 알림 + `syncRecordValues` pull)까지는 확인됐고 **와이어 포맷만 미상** | 공개 자료 없음 → 자체 설계로 대체 |
| 12 | `loadPageChunk`의 커서/청크 크기 시맨틱 | F-05-14 청크 API 설계 참고 | 리버스 엔지니어링 자료 추가 조사 |
| 13 | 스레드의 마지막 코멘트 삭제 시 스레드 처리 정책 | F-05-08 정합성 | 제품 확인 + 자체 정책 결정 |
| 14 | `syncRecordValues` 응답이 권한 `role`을 함께 싣는지 | F-05-20 응답 스키마 확정(클라이언트가 편집 가능 여부를 어디서 아는가) | 리버스 엔지니어링 클라이언트 코드(`notionapi`, `react-notion-x`) 응답 구조 정독 |
| 15 | 레코드 구독을 **언제 해제**하는가(스크롤 아웃 즉시 / 페이지 이탈 시) | F-05-20 구독 수 상한과 메모리 설계 | 공개 자료 없음 → 자체 정책 |
| 16 | 자식 블록만 바뀔 때 부모 페이지 레코드의 `version`도 오르는지 | F-05-20의 최대 함정(안 오르면 부모만 구독한 클라이언트가 조용히 낡는다), F-05-06 델타 판별과도 직결 | 내부 API 응답 관찰 |

### 이번 점검에서 종결된 항목

| 이전 # | 항목 | 결론 |
|---|---|---|
| 6 | resolve된 스레드에 답글 시 자동 재오픈 여부 | 헬프센터가 제시하는 재오픈 경로는 **수동(💬 → Resolved 필터 → ↪️)뿐이며 자동 재오픈 서술은 없다** `[확인: 부재]`. 클론은 "답글 시 자동 재오픈"을 **의도된 차이**로 채택 (F-05-08) |
| 7 | 잠긴 페이지에서 코멘트 가능 여부 | 복수의 2차 출처가 "Lock Page는 본문 편집만 차단, 코멘트는 계속 가능"으로 일치 `[2차 확인]`. 헬프센터 명시는 여전히 없음 → **허용 정책 유지, 신뢰도 상향** (F-05-11) |
| 8 | 버전 히스토리 플랜별 보존기간 | 헬프센터 원문 + 독립 2차 출처 교차검증으로 **7 / 30 / 90 / 무제한 확정** `[확인]`. 이전의 "30일" 서술은 휴지통 보존과의 혼동이었다 (F-05-13) |
| 9 | 알림 자동 구독 규칙 | 헬프센터에 "암묵적 팔로워" 개념 자체가 없음 `[확인: 부재]`. 팬아웃은 **이벤트별 대상자 규칙 + 명시적 `Notify me`** (F-05-10 / F-05-17) |
| 11 | 오프라인 하위 페이지 전파 규칙 | 신설 헬프 페이지 원문으로 확정 — "Subpages of any downloaded pages **won't automatically download**" `[확인]`. `offline_action.from_page_id`는 상속 전파가 아니라 **이유 태그**로 재해석 (F-05-05) |
| — | 실시간 push가 op 브로드캐스트인지 | **아니다.** `MessageStore`가 **버전 알림만** 보내고 클라이언트가 `syncRecordValues`로 pull `[확인]` → 신설 F-05-20으로 분리 |
| — | 클라이언트 outbox의 실재 여부 | Notion의 실제 컴포넌트 `TransactionQueue`로 확인. IndexedDB/SQLite에 영속, "확정 또는 거부"까지 보관 `[확인]` (F-05-04) |

---

## 출처

| # | URL | 성격 | 이 문서에서의 용도 |
|---|---|---|---|
| 1 | https://www.notion.com/blog/how-we-made-notion-available-offline | 공식 엔지니어링 블로그 | SQLite 영속 저장소 승격, `offline_page`/`offline_action` 스키마와 불변식, `lastDownloadedTimestamp` 델타 동기, 페이지 채널 push, page version snapshot, CRDT 마이그레이션 |
| 2 | https://www.notion.com/help/collaborate-within-a-workspace | 공식 헬프센터 | 블록 옆 아바타 presence, 아바타 클릭 점프, 동시 접속 인원 무제한, "최근 변경 우선"(LWW), 페이지/DB 잠금, Unlock for me / for everyone, 잠금은 보안장치 아님 |
| 3 | https://www.notion.com/help/comments-mentions-and-reminders | 공식 헬프센터 | 인라인/페이지 코멘트 생성 경로, `cmd/ctrl+shift+M`, resolve·재오픈, 수정·삭제, Default/Minimal 표시, @사람/@페이지/@날짜, 페이지 제목 자동 반영, 반응 |
| 4 | https://developers.notion.com/docs/working-with-comments | 공식 API 문서 | `discussion_id` 의미와 획득 방법, `parent.page_id` vs `parent.block_id`, resolved 조회 불가, capability 요건, 텍스트 앵커 discussion 생성 불가 |
| 5 | https://developers.notion.com/reference/create-a-comment | 공식 API 레퍼런스 | 코멘트 생성 바디(`rich_text` 또는 `markdown` 택1), 파라미터 배타 조건 |
| 6 | https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know | 공식 헬프 가이드 | 오프라인 지정 방법, 자동 다운로드(Business/Enterprise), DB 첫 50행, 텍스트 자동 병합 / 비텍스트 리뷰, 오프라인 검색 동작, embed·form·button 비활성 |
| 7 | https://www.notion.com/help/suggested-edits | 공식 헬프센터 | Suggesting 모드, ✔️/❌ 수락·거절, `Can comment` 권한, 인박스 알림, 반응·답글 |
| 8 | https://www.notion.com/releases/2024-07-29 | 공식 릴리스 노트 | 제안된 편집 도입 시점(2.43) |
| 9 | https://www.notion.com/help/updates-and-notifications | 공식 헬프센터 | 인박스 빨간 배지, 앱 열림 여부에 따른 인박스 vs 이메일 |
| 10 | https://www.notion.com/help/notification-settings | 공식 헬프센터 | 알림 채널 설정 |
| 11 | https://www.notion.com/help/duplicate-delete-and-restore-content | 공식 헬프센터 | 삭제/복원, 버전 복원 비파괴성 |
| 12 | https://www.notion.com/help/custom-data-retention-settings | 공식 헬프센터 | 플랜별 데이터 보존 정책 |
| 13 | https://github.com/kjk/notionapi/blob/master/submit_transaction.go | 오픈소스 (내부 API 리버스 엔지니어링) | `Operation{ID,Table,Path,Command,Args}`, `set`/`update`/`listAfter`/`listRemove`, `/api/v3/submitTransaction` |
| 14 | https://blog.kowalczyk.info/article/88aee8f43620471aa9dbcad28368174c/how-i-reverse-engineered-notion-api.html | 기술 분석 글 | `loadPageChunk`, `getRecordValues`, `/api/v3/ping`, 모든 것이 블록인 트리 구조 |
| 15 | https://docs.yjs.dev/getting-started/adding-awareness | Yjs 공식 문서 | awareness = ephemeral state-based CRDT, 연결 종료 시 자동 삭제, `setLocalStateField`, cursor/user 필드, 비영속 이유 |
| 16 | https://docs.yjs.dev/api/about-awareness | Yjs 공식 문서 | awareness 프로토콜 상세 |
| 17 | https://deepwiki.com/toeverything/AFFiNE/3.5-real-time-synchronization | 오픈소스 아키텍처 문서 | Y-Octo, Socket.io + Redis pub/sub, state vector 동기화, awareness |
| 18 | https://deepwiki.com/toeverything/AFFiNE/3.3-data-models-and-storage | 오픈소스 아키텍처 문서 | AFFiNE 데이터 모델 / subdoc 구조 |
| 19 | https://tiptap.dev/docs/hocuspocus/guides/persistence | Hocuspocus 공식 문서 | debounce 저장, 저장 실패 시 메모리 유지 후 재시도, `Server.destroy()` flush, 바이너리 저장 필수 |
| 20 | https://tiptap.dev/docs/hocuspocus/server/hooks | Hocuspocus 공식 문서 | `onAuthenticate` / `onLoadDocument` / `onStoreDocument` 훅 |
| 21 | https://deepwiki.com/docmost/docmost | 오픈소스 아키텍처 문서 | API 서버(3000) / Hocuspocus 협업 서버(3001) 분리 구조, Tiptap + Yjs |
| **22** | https://www.notion.com/blog/data-model-behind-notion | **공식 엔지니어링 블로그 (3차 점검에서 신규 확보)** | 블록 레코드 속성(id/properties/type/content/parent), "parent는 권한에만 쓰인다", 권한 상속 방향, 트랜잭션의 그룹 커밋·그룹 거부, `/saveTransactions`, 서버측 before/after 적용 절차, `TransactionQueue`(IndexedDB/SQLite 영속), `RecordCache`(LRU), `MessageStore`(장수명 WebSocket), **레코드 단위 구독 + 버전 알림 + `syncRecordValues` pull** |
| **23** | https://www.notion.com/help/use-pages-offline | **공식 헬프센터 (신설 페이지)** | `Available offline` 토글 경로, **하위 페이지 자동 다운로드 없음**, DB 첫 50행, 플랜별 자동 다운로드(Free 수동 / 유료 자동), 오프라인 비활성 항목(embed·AI·form·button + **공유·권한 편집**), 비텍스트 충돌 리스크 |
| **24** | https://github.com/kjk/notionapi/blob/master/api_syncRecordValues.go | 오픈소스 (내부 API 리버스 엔지니어링) | `syncRecordValues` 요청/응답 형태의 실물 참고 (F-05-20 응답 스키마 설계) |
| **25** | https://thomasjfrank.com/notion-sharing-permissions-the-ultimate-guide/ | **2차 출처(신뢰 가능한 실무 가이드, 1차 아님)** | 잠긴 페이지에서의 코멘트 가능 여부, `Can comment` 권한의 코멘트 범위 제약 — **1차 미확인이므로 `[2차 확인]` 태그로만 사용** |
| **26** | https://www.notion.vip/insights/collaborating-in-notion-comments-mentions-reminders | **2차 출처** | resolve/re-open의 권한 요건(`Can edit` 이상) — 헬프센터에 없는 서술이라 `[2차 확인]` |

> **2차 출처 취급 원칙**: 22~24는 1차(공식/코드), 25~26은 2차다. 2차만으로 뒷받침되는 문장에는 본문에서 `[2차 확인]`을 명시했고, **데이터 모델을 결정하는 근거로는 쓰지 않았다**.
> **반증 시도에서 기각한 자료**: `techaheadcorp.com`(Notion을 "Operational Transformation Layer"로 서술), `howworks.ai`(같은 사실을 CRDT/전송 파이프라인으로 서술) 등은 서로 모순하고 1차 근거를 제시하지 않아 **인용하지 않았다**. 다만 `howworks.ai`가 언급한 `TransactionQueue`/`RecordCache`/`saveTransactions`는 **공식 블로그(22)에서 직접 재확인된 뒤에만** 채택했다.
