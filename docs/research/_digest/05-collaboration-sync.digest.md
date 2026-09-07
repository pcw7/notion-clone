# [DIGEST] 05. 실시간 협업 & 동기화

> 원본 `05-collaboration-sync.md` (1,200줄/147KB, 3차 GAP 완료) 압축본. 스키마 정본은 `00-canonical-data-model.md` / `_canon/sync-version.md`를 따르며, 여기엔 **이 도메인이 요구하는 것**만 적었다.
> 원본 `grep -c "^### F-"` = **20** / 아래 인벤토리 = **20행** (일치 검증 완료).

## 0. 최상위 결정 2가지 — 마스터 문서가 가장 먼저 못박아야 할 것

| 결정 | A | B | 권고 |
|---|---|---|---|
| **D1 병합 코어** | **CRDT (Yjs + y-prosemirror)**, 페이지=`Y.Doc` 1개 | 블록 LWW + fractional index | **A**. B 택하면 F-13(히스토리)을 MVP 안전망으로 필수 동반 |
| **D2 전파 모델** | **push** (update 바이너리 relay) | **pull** (버전만 알리고 값은 재조회 — **Notion 실제** `[확인]`) | **A**. D1=CRDT면 D2는 자동 결정 |

- **두 모델을 한 채널에 섞으면 순서 보장이 무너진다.** D1/D2가 F-01/02/04/05/06/14/15/20 설계와 로드맵을 전부 좌우한다(특히 F-20은 CRDT면 미구현, LWW면 P0).
- 설계 원칙: `페이지 = 동기화 = 권한 = 채널 = CRDT 문서 단위`로 일치. (Notion은 구독이 **렌더된 레코드 단위**라 이 원칙을 안 지킨다 `[확인]` — 클론은 통일하는 편이 낫다.)

**Notion 실제 경로 `[확인]`(참고)**: 편집 → `RecordCache`(SQLite/IndexedDB LRU) 즉시 갱신 → `TransactionQueue`(디스크 영속) → `POST /saveTransactions` → 서버가 블록+**부모(권한판정용)** 로드, before 복제 후 op 적용, **그룹 단위 커밋 or 그룹 단위 거부(부분 적용 없음)** → `MessageStore`(장수명 WS)가 `{table,id,version}` **값 없는 알림만** push → 수신측이 캐시 버전 대조 후 `syncRecordValues`로 **pull**.
Operation = `{id,table,path[],command,args}`, command ∈ `set|update|listAfter|listBefore|listRemove|setPermissionItem` `[확인]`. 순서는 인덱스가 아니라 `listAfter`(상대 관계) → 동시 삽입이 서로를 덮지 않음.

---

## 1. 기능 인벤토리 (전수 20)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-05-01 | 동시 편집 병합 (충돌 해결 코어) | XL | **P0** | 블록모델, 권한, F-02, F-04 |
| F-05-02 | 실시간 전송 계층 (구독채널·fan-out) | L (레코드단위 구독+F-20이면 합쳐 XL) | **P0** | 인증세션, 권한, 블록저장소 |
| F-05-03 | Presence (아바타·커서·편집위치) | M | P1 | F-02, 사용자프로필 |
| F-05-04 | 낙관적 업데이트 & 로컬 트랜잭션 큐(outbox) | M | **P0** | F-01, F-02 |
| F-05-05 | 오프라인 편집 (페이지 지정·로컬 저장소) | XL | P2 | F-01, F-04, F-06, 로컬DB |
| F-05-06 | 재접속 동기화 (델타 페치·머지) | L | P1 | F-05, F-04, F-02 |
| F-05-07 | 인라인 코멘트 (텍스트 범위 앵커) | L | P1 | rich text, 권한, F-08, F-10 |
| F-05-08 | 페이지 코멘트·스레드 resolve·반응 | M | **P0** | 권한(Can comment), F-02, F-10 |
| F-05-09 | @멘션 (사람·페이지·날짜/리마인더) | L | P1(사람·페이지)/P2(날짜) | 디렉터리, 검색, 권한, F-10, 스케줄러 |
| F-05-10 | 알림 팬아웃 & 인박스 | L | P1 | F-08, F-09, **F-03**, F-17, 권한, 큐, 메일 |
| F-05-11 | 편집 잠금 (페이지/DB) | **M** (원본 S→M↑) | P2 | 권한, block.format |
| F-05-12 | 제안된 편집 (Suggested edits) | XL | P2 | F-07, F-08, 권한, 에디터 마크 |
| F-05-13 | 페이지 히스토리 & 버전 복원 | **L** (원본 M→L↑) | P1 | F-01, 플랜/과금 |
| F-05-14 | 대용량 페이지 동기화 성능 (청크·부분구독) | L | P1 (**경계 결정은 P0**) | F-01, F-02, 가상화 |
| F-05-15 | 협업 Undo/Redo (origin 범위) | M (LWW 직접구현 시 L) | **P0** | F-01, F-04(origin), selection, F-11 |
| F-05-16 | DB 실시간 동기화 (뷰설정 개인·공유 2층) | L | P1 (**개인상태 테이블 자리는 P0**) | DB모델(02/03), F-02, F-11, 권한 |
| F-05-17 | 알림 구독 레벨(Notify me) & 인박스 필터 | S (presence 연동 시 M) | P2 (**스키마 자리는 P0**) | F-10, F-03, 권한, 사용자설정 |
| F-05-18 | 외부 이벤트 배달 (Webhook) | M | P2 (**event_outbox는 MVP 권장**) | F-01, 큐, 통합/인증, 권한 |
| F-05-19 | 연결 인증 & 권한 변경 실시간 전파 | L | **P0** | 권한도메인(06), F-02, F-04, F-03 |
| F-05-20 | 레코드 버전 무효화·캐시 동기(pull 모델) | M (재적용 포함 시 L) | P1 → **LWW면 P0 / CRDT면 미구현** | F-02, F-04, F-19, `version` 컬럼 |

**의존 그래프**
```
블록모델 ─┬ F-01 병합코어 ─┬ F-04 낙관적업데이트 ─┬ F-05 오프라인 → F-06 재동기
          │                │                      └ F-15 협업undo(origin 계약 공유)
          │                ├ F-13 히스토리        └ F-18 webhook(event_outbox)
          └ F-02 전송계층 ─┬ F-20 버전무효화/pull (LWW 전용)
                           ├ F-03 presence ──────┐(활성뷰어 억제)
                           ├ F-08 코멘트 ─┬ F-07 인라인앵커 → F-12 제안된편집
                           │              └ F-10 알림 ←┬ F-09 멘션  ├ F-17 구독레벨
                           ├ F-14 청크/성능           └ F-18 webhook(같은 outbox)
                           └ F-16 DB 실시간동기화
권한모델 ─┬ F-11 잠금(모든 mutation에 횡단 가드)
          └ F-19 연결인증·권한전파 → (F-02의 선결 조건)
```

---

## 2. 데이터 모델 요구사항

**2-1. 기존 엔티티에 요구하는 것**

| 대상 | 요구 | F-ID |
|---|---|---|
| 모든 레코드 테이블 | **단조증가 `version bigint`**(트랜잭션 커밋 시 증가). 버전 증가가 hot path → 페이지 전역 카운터 금지, 레코드 단위 갱신 | F-20, F-01 |
| `block` | `content uuid[]`(순서 자식), `parent_id`(권한 상속 상향 포인터), `alive`(soft delete) | F-01 |
| `block` 삭제축 | `deleted_at`(휴지통) / `purged_at` / `hard_deleted_at` **3개** — 영구삭제 후에도 30일 잔존 `[확인]` | F-13 |
| `block.format` | `block_locked`, `block_locked_by` `[추정: 위치]` / 서버 1급 상태인 점은 `[확인]`(`page.locked` webhook) | F-11 |
| `collection.format` | `collection_lock` — 범위는 **뷰·속성만, 데이터 행 제외** `[확인]` | F-11, F-16 |
| 페이지 `last_updated_time` | **서브트리 변경이 루트로 롤업**되어야 델타 판별 성립 | F-06 |
| rich text | 멘션은 인라인 토큰. 페이지 멘션은 **제목 복사 금지, `page_id`만 저장 후 렌더 시 조인**(제목 변경 자동 반영 `[확인]`) | F-09 |

**2-2. 신규 엔티티**

| 엔티티 | 핵심 필드 / 결정적 제약 | F-ID |
|---|---|---|
| `transaction` | `id PK(=idempotency key)`, `client_id`(=**origin**, undo 스코프·에코 판별 공유), `ops jsonb` | 01,04,15 |
| `doc_crdt` / `doc_update` | `state **bytea**`, `state_vector` / `(doc_id,seq)`, `update bytea` + compaction. **문자열 저장 시 손상** `[확인]` | 01,14 |
| `discussion` | `parent_id/parent_table`, `anchor jsonb`, `resolved/resolved_by/resolved_at`, `comments uuid[]`. 인덱스 `(parent_id,resolved,created_time)` — **resolved는 조회 필터의 1급 축** | 07,08 |
| `comment` | `discussion_id`, `rich_text`, `created_by`, `alive` | 08 |
| `reaction` | `PK(target_type,target_id,emoji,user_id)` — 자연스러운 2P-Set, 재클릭=토글 | 08 |
| `mention_index`(파생) | `source_*, page_id, mentioned_*` — 저장 시 rich text 파싱 upsert | 09 |
| `reminder` | `target_user_id, page_id, block_id, fire_at, tz, sent_at` — 설정자 tz 기준 **절대시각** 저장 | 09 |
| `notification` | **`read_at`과 `archived_at`을 별도 컬럼으로** — 인박스 필터 4종(Unread/Read/Archived/All) 성립 조건 `[확인: 필터 역산]`. 인덱스 `(user_id,read_at,archived_at,created_at DESC)` | 10,17 |
| `page_subscription` | `PK(user_id,page_id)`, `level ∈ all_comments\|replies_and_mentions\|all_updates\|none`. **"암묵적 팔로워" 개념은 Notion에 없다** `[확인: 부재]` → 명시적 opt-in만 | 17 |
| `user_notification_pref` | 채널 5종 `inbox/desktop/email/mobile_push/slack` `[확인]` | 10,17 |
| `collection_view` | **`shared_query`**(=`Save for everyone`으로 저장된 filter/sort/group `[확인]`) | 16 |
| `collection_view_user_state` | `PK(view_id,user_id)`, `personal_query`. **실효 쿼리 = merge(shared, personal), personal 우선** | 16 |
| `event_outbox` | **알림 워커와 webhook 워커가 공유하는 단일 이벤트 소스**. 편집 트랜잭션과 같은 DB 트랜잭션에 append `[추정, 표준]` | 10,18 |
| `webhook_subscription` / `webhook_delivery` | `verification_token`이 **그대로 HMAC 키** `[확인]` / `attempt_number 1..8` `[확인]`, 인덱스 `(subscription_id,next_retry_at)` | 18 |
| `page_snapshot` | `record_map` — **diff 조각이 아니라 재구성 가능한 완전 문서**여야 함(과거 버전에서 블록만 복사 기능 존재 `[확인]`) | 13 |
| `suggestion` | `status(pending\|accepted\|rejected\|stale)`, `kind(insert\|delete\|format\|move)`, `anchor`, `discussion_id`. 에디터 문서 모델에 **"미확정 변경 레이어"가 1급**으로 필요 | 12 |
| `lock_override` | `(user_id,page_id,unlocked_at)` — 서버 저장/기기 로컬 여부 `[확인필요]` | 11 |

**2-3. 클라이언트 로컬(서버 스키마 아님, 필수 설계)**
- `RecordCache(record_id PK, table, version, value, last_access)` — LRU. **UI는 항상 여기를 읽는다**(네트워크는 최종 일관성만 책임) `[확인]`
- `outbox = TransactionQueue(tx_id PK, page_id, ops, attempts, status)` — **디스크 영속** `[확인]`. 종료 조건이 "성공" 하나가 아니라 **"확정 또는 거부" 둘**(거부 경로 없으면 좀비 항목). **evict 절대 금지** — RecordCache와 GC 정책 분리
- `offline_page(page_id, last_downloaded_timestamp)` + `offline_action(origin_page_id, from_page_id, impacted_page_id, type)` — **reference counting 테이블**, `type` 최소 4종(`manual_toggle|favorite|recent|database_row`). 불변식: 모든 `offline_page`는 최소 1개 `offline_action` 보유, count=0이면 오프라인 해제 `[확인]`

**2-4. 런타임(비영속)**
- `presence:{doc_id}` HASH `{conn_id:{user_id,name,avatar,color,focus_block_id,selection{anchor,head},mode,ts}}` — **DB 저장 금지**. TTL 30s `[확인]`, 하트비트 10s `[추정: 임계값 1/3, Yjs 문서에 주기 수치 없음]`. selection은 **CRDT 상대 위치**로 저장
- 구독 레지스트리 `sub:{record_id}→Set<conn>` 또는 `doc:{page_id}→Set<conn>` / 권한 캐시 `perm:{user}:{page}` + 무효화 채널 `perm-invalidate:{space_id}` payload `{scope: user|page|subtree}`
- undo 스택은 클라이언트 메모리 전용 — 대신 **모든 트랜잭션이 origin을 실어야 한다**는 서버 계약 발생

**2-5. 엔드포인트 계약**: `POST /saveTransactions`(그룹 커밋/거부) · `POST /syncRecordValues {[{table,id,version}]}→{recordMap:{...{value,version,role}}}`(`role` 동봉 여부 `[확인필요]`) · `POST /sync/check {page_ids[]}→{page_id:last_updated_time}` · `POST /pages/{id}/chunk {cursor,limit}→{record_map,cursor,has_more}`

**2-6. 규모 상한** (Notion 공개 API 실측 `[확인]` → 클론 기준선 채택 권고): 요청당 block **1,000** / **500KB**, rich text **2,000자**, 배열 **100**, relation **100**, people **100**, 연결당 평균 **초당 3요청**, webhook 재시도 **8회·최초로부터 ~24시간(at-most-once)**, 오프라인 DB 자동 다운로드 **첫 50행**. 버전 보존 **Free 7 / Plus 30 / Business 90 / Enterprise 무제한** `[확인, 교차검증]`, 휴지통 30일 → 영구삭제 후 추가 30일.

---

## 3. MVP 판단

**3-1. 없으면 제품이 성립 안 하는 것 (P0 6)**

| F-ID | 근거 |
|---|---|
| F-01 병합 코어 | 없으면 실시간 협업 도구가 아니다 |
| F-02 전송 | 전파가 없으면 병합할 대상 자체가 없다 |
| F-04 낙관적 업데이트 | 없으면 타이핑마다 왕복 지연이 그대로 노출 |
| F-08 코멘트 | 코멘트 없는 협업 도구는 성립 안 함(인라인 앵커 없이 페이지/블록 단위면 충분) |
| **F-15 협업 undo** | `Cmd+Z`가 남의 글을 지우면 출시 불가. 게다가 **"모든 트랜잭션에 origin을 싣는 코어 계약"**이라 F-01/04와 동시 결정 필요 |
| **F-19 권한 전파** | 채널 join·매 mutation 권한 검사가 없으면 **실시간 계층이 곧 권한 우회 경로**(REST에만 권한 걸고 WS를 비워두는 전형적 사고). 보안이라 제외 불가 |

+ 권고: **F-13(히스토리)을 안전망으로 MVP에 앞당김** — D1에서 LWW를 택하면 사실상 필수.

**3-2. 빼도 되는 것 + 대체안**

| F-ID | 대체안 |
|---|---|
| F-03 | 상단 아바타 스택 + 블록 단위 편집자 표시까지만. 문자 단위 원격 캐럿은 v2 |
| F-05 | v1은 `y-indexeddb`만("최근 연 페이지는 오프라인 읽기·쓰기"). `offline_action` 참조그래프는 v2 |
| F-06 | Yjs면 state vector 교환이 프로토콜 차원 자동 처리. REST면 `?updated_since=` 하나 |
| F-07 | MVP는 **앵커 = block_id 하나**. 범위 앵커는 ProseMirror+Yjs 확정 후 v1 |
| F-09 | 코멘트 안 사람 멘션만. 페이지 멘션 v1, 날짜/리마인더 v2 |
| F-10 | 인앱 인박스만, 집계 없이 1:1. 이메일 v1 |
| F-11 | `is_locked` bool + 서버 가드. `Unlock for me`는 클라이언트 세션 상태로만 |
| F-12 | "코멘트에 제안 문구 → 소유자 반영" 수동 흐름. 또는 ProseMirror track-changes |
| F-14 | 페이지당 블록 상한(예: 1,000) 두고 전체 로드. **단 경계 결정은 P0** |
| F-16 | 공유 뷰 설정만(전원 즉시 적용) + `collection_view_user_state`는 만들고 `personal_query`는 비움 |
| F-17 | "멘션·답글은 항상 알림" 고정 |
| F-18 | v1까지 `event_outbox`에만 쌓고 소비자는 인박스 워커 하나 → v2에 배달 워커 추가(**거의 공짜**) |
| F-20 | D1=Yjs면 아예 불필요(state vector가 대체). LWW면 P0로 승격 |

**3-3. 코드는 미루되 스키마 자리는 MVP에서 확보**: `event_outbox` / `collection_view_user_state.personal_query` / `notification.archived_at` / `page_subscription` / 모든 레코드의 `version` / `transaction.client_id`(origin). → 사후 추가 시 알림 마이그레이션·뷰 저장구조 전면 개편·클라이언트+서버+브로커 동시 수정 발생.

**3-4. 로드맵 (Yjs 전제)**

| 단계 | 포함 |
|---|---|
| MVP | F-01(Yjs), F-02(단일 인스턴스 WS), F-04, F-08(페이지 코멘트+resolve), F-13(스냅샷), F-15(UndoManager), F-19(join+mutation 검사) + 3-3 스키마 |
| v1 | F-03, F-06, F-07, F-09(사람/페이지), F-10(인앱), F-14(청크), F-16(공유뷰+개인필터), F-11 |
| v2 | F-05(명시적 오프라인), F-09(리마인더), F-12, F-17, F-18, F-19 정밀 서브트리 무효화 |

---

## 4. 기술 난제 & 권장 접근 (L/XL)

| F-ID | 왜 어려운가 | 권장 접근 | 참고 OSS |
|---|---|---|---|
| **01 (XL)** | **트리 CRDT(이동/사이클)가 텍스트 CRDT보다 어렵다.** 라이브러리를 써도 블록 스키마 매핑·tombstone GC·서버 영속화가 남음 | Yjs+y-prosemirror, 페이지=1 Y.Doc. **트리 이동은 "삭제 후 삽입"으로 우회**. 서버가 사이클 검출 → 나중 op reject 또는 root 승격. state는 `bytea` | AFFiNE/BlockSuite(Y-Octo), Outline |
| **02 (L→XL)** | 단일 broadcast는 1~2일이나 **멀티 인스턴스 fan-out + seq gap 복구 + 백프레셔 + join 권한검사**면 1~2주. 구독을 레코드 단위로 내리면 연결당 구독 수 수백~수천 | **구독 단위=페이지로 고정**해야 L 유지. 인메모리로 시작하되 **브로커 인터페이스 추상화**. 메시지에 단조 `seq` → gap 시 full refetch. 채널별 50ms 배칭 | **Hocuspocus**, Socket.io+Redis, **Docmost**(API 3000/협업 3001 분리) |
| **05 (XL)** | 로컬 DB 스키마 + **참조 그래프 reconcile** + 병합 + evict 정책 | v1 `y-indexeddb`만 → v2에 reference counting 이식. **미전송 op 있는 페이지 evict 금지**. **`setPermissionItem` 계열은 outbox 대상 제외**(Notion도 오프라인 시 공유·권한 편집 불가 `[확인]`) | y-indexeddb |
| **06 (L)** | 델타 판별은 쉽지만 **루트 타임스탬프 롤업** + **비텍스트 충돌 리뷰 UI** + 클럭 스큐 | 비교는 **서버 시각만** 신뢰. 델타 임계 초과 시 full snapshot. 텍스트 자동 병합, 비텍스트는 "내 버전/서버 버전" 선택 `[확인: Notion 정책]` | AFFiNE state vector |
| **07 (L)** | CRUD는 M. **실제 비용은 앵커가 동시 편집을 견디게 만드는 것** | relative position + `anchor.quoted_text`(원문 스냅샷) **필수 저장**. 앵커 소멸 시 스레드는 생존시키고 "orphaned"로 페이지 코멘트 강등 | y-prosemirror |
| **09 (L)** | 자동완성(S~M) + **라이브 제목 참조 렌더링**(M) + **권한 인지 팬아웃**(M) + 스케줄러(M) | 권한 없는 페이지 멘션은 **제목 마스킹**(정보 누출). 권한 없는 사용자에겐 알림 생성 자체를 안 함 `[확인]` | — |
| **10 (L)** | 큐+집계+채널 라우팅+설정. **팬아웃 대상이 "구독자 집합"이 아니라 "이벤트별 대상자 규칙"으로 계산**되어 쿼리 구조가 달라짐 | **배달 3단 필터**: ① 이벤트별 대상자 → ② **배달 시점 권한 재검사**(생성 시점만으론 부족) → ③ **presence 조회로 활성 뷰어 제외** `[확인]`. 편집 트랜잭션과 분리된 비동기 큐 | — |
| **13 (L)** | 디바운스 커밋 + 스냅샷 범위 결정 + **플랜별 보존 GC** + 휴지통 2단계 보존 정합 + **복원의 실시간 세션 정합** + 작성자 그룹핑. diff 얹으면 XL 근접 | **복원을 일반 트랜잭션으로 재적용**(특별 경로 금지). MVP는 5분 디바운스 JSON 통째 저장·보존 30일 고정. CRDT면 `doc_update` 재생으로 임의 시점 복원 → 스냅샷은 성능 최적화 | Hocuspocus debounced `onStoreDocument` |
| **14 (L)** | 청크 API + 가상 스크롤 + 배칭. **`Y.Doc`이 커질수록 초기 로드가 전체 상태 전송**이 되는 Yjs 함정 | 페이지=1 Y.Doc, **하위 페이지=subdoc 지연 로드**, update 로그 compaction, 원격 update 적용 시 rAF 배칭, presence throttle, 뷰포트 가상화. **경계 설계는 초기 확정** | AFFiNE(workspace doc+subdoc, state vector diff) |
| **12 (XL)** | **문서 모델에 "미확정 변경" 레이어를 추가**하는 일. 동시 편집과 겹치면 앵커 재계산 필수. 구조 변경 제안은 텍스트보다 훨씬 어려움 | v2로 미룸. track-changes 플러그인 검토. stale 제안은 자동 거절 말고 "적용 불가" 표시 | ProseMirror track-changes |
| **16 (L)** | 행 델타만 보면 M. **공유/개인 2층 병합 + 스키마 변경 시 개인 필터 무효화 + 필터 재평가로 인한 행 입·퇴장**이면 1~2주 | 이벤트 3갈래 분리: `row.updated`/`schema.updated`(뷰 재평가 강제)/`view.shared_query.updated`. **개인 상태 변경은 브로드캐스트 금지**(같은 사용자 다른 세션만). 개인 필터가 참조하는 property 부재 시 **그 조건만 drop** + 배너(뷰 전체 리셋 금지) | — |
| **19 (L)** | 인증 자체는 S. **본체는 상속 권한의 실시간 무효화, 비용 O(서브트리 × 구독자)**. 게다가 모든 편집 트랜잭션이 조상 체인을 로드 `[확인]`. **실시간 계층에서 가장 과소평가되는 항목** | ① join 검사 ② **모든 mutation 서버측 재검사(생략 불가)** ③ 권한 변경 시 space 일괄 무효화 브로드캐스트 후 재검증. 무효화는 **lazy**. mutation 핸들러는 **`권한→잠금→버전` 3단** 통과. 404/403 구분 금지(존재가 샌다) | Hocuspocus `onAuthenticate` |
| **20 (M~L)** | "미확정 로컬 트랜잭션을 pull 결과 **위에** 재적용"을 빼먹으면 **글자 튐 버그**. 최대 함정: **부모만 구독·자식 미구독 시 화면이 조용히 낡는다** | CRDT면 미구현. LWW면 봉투를 `{table,id,version}`으로 고정 + pull 배칭 50~100ms. **낮은 버전 알림은 무시**(버전 단조성이 순서 문제를 없앰). pull 403이면 로컬 캐시 **삭제** + 구독 해제 | notionapi `api_syncRecordValues.go` |

**권고 스택**: Yjs(페이지=1 Y.Doc) / **push 단일 모델**(Notion식 pull 미채택) / ProseMirror+y-prosemirror(블록트리+인라인 마크를 한 모델로) / **Hocuspocus 별도 프로세스** / Postgres `bytea`+메타는 정규 테이블 / Presence=Yjs awareness / **코멘트·멘션·알림은 CRDT 밖 관계형**(append-only + 권한 필터·집계 쿼리 필요) / Undo=`Y.UndoManager({trackedOrigins:Set([localOrigin]), captureTimeout:500})` `[확인]`, 타입 변환·붙여넣기 직전 `stopCapturing()`, selection을 stack item meta에 저장.

---

## 5. 다른 도메인과의 접점

| 도메인 | 요구 / 충돌 지점 |
|---|---|
| **01 블록 에디터** | 블록 트리 = CRDT 문서 모델. 인라인 마크(코멘트 앵커·멘션 토큰)가 에디터 문서 모델의 1급 시민이어야 함. 붙여넣기 전체가 **단일 트랜잭션·단일 origin** |
| **02 페이지·워크스페이스** | `페이지 = 동기화/권한/채널/CRDT 문서` 경계 일치, 하위 페이지 = subdoc |
| **03/04 DB** | `collection`(스키마+행)과 `collection_view`(표현) 분리 필수(Notion도 2025-09-03에 `data_source`로 분해). **`collection_view_user_state`를 뷰 설계 초기에 넣어야** 함 — 사후 추가 시 뷰 저장구조와 모든 쿼리 경로 개편. 잠금 가드가 "뷰/스키마 mutation"과 "행 mutation"을 구분해야 함 |
| **06 권한·공유** | 판정은 06 소유, 이 도메인은 **전파 계층**. 요구: (a) 상속 권한 서브트리 무효화 API (b) `(user,page)→role` 캐시 가능한 인터페이스 (c) 배달 시점 권한 재검사 훅. **잠금은 권한과 별개 레이어**(권한 통과해도 잠금에서 막혀야 함) |
| **07 검색** | 오프라인 시 로컬 인덱스만 검색·미다운로드 항목 회색 처리. 멘션 자동완성은 페이지 검색 재사용 |
| **09 API·통합** | webhook 이벤트 타입 21종이 **도메인 05의 이벤트 사전(vocabulary)**. 내부 채널 메시지 타입을 그 이름 그대로 쓰면 매핑 계층 불필요 |
| **11 히스토리·알림** | **강한 중복 영역.** `notification`/`page_snapshot` 스키마 소유권을 반드시 조정(05는 팬아웃·전파 관점, 11은 조회·UI 관점으로 보임 `[확인필요: 교차 확인]`) |
| **12 플랫폼 UX** | presence 아바타 스택, 동기화 상태 인디케이터, 오프라인 배지, 데스크톱/모바일 로컬 저장소(SQLite vs IndexedDB) |
| **14 인증·계정** | 장수명 WS 중 access token 만료 → 재인증/조용한 재연결. **이때 미전송 outbox는 절대 버리지 않는다** |
| **17 운영·거버넌스** | 플랜별 보존 GC 잡, 영구삭제 후 30일 잔존분의 **관리자 전용 복구 경로**(일반 UI 노출 금지), webhook 배달 로그 |

---

## 6. 최우선 미해결 질문 (5)

| # | 질문 | 왜 중요한가 / 해소법 |
|---|---|---|
| Q1 | **D1/D2 확정 (CRDT+push vs LWW+pull)** | 20개 중 8개 기능 설계와 로드맵 전체가 종속. 제품 결정 사항(조사로 해소 불가). 원본 권고는 CRDT+push |
| Q2 | 자식 블록만 바뀔 때 **부모 레코드의 `version`도 오르는가** | pull 모델 최대 함정 — 안 오르면 부모만 구독한 클라이언트가 **조용히 낡는다**. F-06 델타 판별과도 직결. 미해소 시 "롤업 필수"로 자체 확정 |
| Q3 | 인라인 코멘트 **앵커 저장 포맷** (rich text 마크 vs CRDT 상대위치) | F-07 데이터 모델과 에디터 모델이 갈림. 미해소 시 relative position + `quoted_text` fallback으로 자체 결정 |
| Q4 | `notification`/`page_snapshot`의 **소유 도메인이 05인가 11인가** | 두 도메인 문서가 같은 테이블을 각각 정의 중일 가능성 → 마스터 통합 시 충돌. `11-history-notifications.md` 교차 확인 후 정본 병합 |
| Q5 | 개인 뷰 상태(`personal_query`)를 **서버 저장 vs 기기 로컬** | 서버면 기기 간 동기화 필요, 로컬이면 기기마다 다름. Notion 동작 `[확인필요]`. 권고: 서버 저장 + 개인 채널로만 전달 |

> 잔여 미해결: Notion CRDT 구체 알고리즘 `[확인필요]`, 온라인 전용 페이지의 실제 충돌 해결 경로(2차 출처가 CRDT/OT로 갈려 **모순 → 어느 쪽도 미채택**), 문자 단위 원격 캐럿 여부, `Unlock for me` 저장 위치, WS 와이어 포맷, `loadPageChunk` 커서 시맨틱, 스레드 마지막 코멘트 삭제 정책, `syncRecordValues`의 `role` 동봉, 레코드 구독 해제 시점.

---

## 부록 A. 원본과 의도적으로 다르게 가는 지점 (마스터 문서에 기록 필요)

| 항목 | Notion | 이 클론 | 이유 |
|---|---|---|---|
| resolve된 스레드에 답글 | 자동 재오픈 서술 **없음**(수동만) `[확인: 부재]` | **답글 시 자동 재오픈** | 해결된 스레드의 답글이 아무에게도 안 보이는 것이 더 나쁜 실패 |
| 전파 모델 | pull `[확인]` | **push** | CRDT 채택 시 pull은 왕복만 늘림 |
| 구독 단위 | 렌더된 **레코드** `[확인]` | **페이지(문서)** | 레지스트리 규모·복잡도 한 자릿수 감소 |
| resolve 권한 | 헬프센터 명시 없음 `[확인: 부재]` / 2차는 `Can edit` 이상 | resolve·reopen = `Can edit` 이상, 작성 = `Can comment` 이상 | 작성 권한과 정리 권한 분리 |
| 오프라인 하위 페이지 | **자동 전파 안 함** `[확인]`(`from_page_id`는 상속이 아니라 **이유 태그**) | 동일 채택 | 자동 전파 구현 시 Notion과 다른 동작 |

## 부록 B. 1차 출처 (원본 26건 중 핵심 10 / 상세 매핑은 원본 「출처」표 참조)
notion.com/blog/data-model-behind-notion · notion.com/blog/how-we-made-notion-available-offline · notion.com/help/collaborate-within-a-workspace · notion.com/help/use-pages-offline · notion.com/help/comments-mentions-and-reminders · developers.notion.com/docs/working-with-comments · developers.notion.com/reference/webhooks-events-delivery · notion.com/help/updates-and-notifications · docs.yjs.dev/api/undo-manager · tiptap.dev/docs/hocuspocus/server/hooks
(2차 출처 2건 thomasjfrank.com / notion.vip은 잠금-코멘트 관계와 resolve 권한에만 `[2차 확인]` 태그로 사용, **데이터 모델 근거로는 미사용**)
