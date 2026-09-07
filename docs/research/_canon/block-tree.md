# 정본: 블록 · 페이지 트리 (block-tree)

> **이 문서의 지위**: 이 클러스터가 소유한 엔티티(`block`과 그 부속)에 대해 **유일한 정답지**다. 01/02/03/04/05/06/11/12 문서의 해당 스키마 정의는 이 문서와 충돌하는 즉시 무효이며, 아래 「수정이 필요한 문서 목록」대로 정정되어야 한다.
> **판결 대상**: C-1, C-3, C-9, C-10, V-4, V-6, V-9
> **판결 일자**: 2026-09-06 · **검증 수단**: 1차 출처(notion.com/help, developers.notion.com, notion.com/blog) 재확인 + 내부 API 리버스 엔지니어링 구현체 대조

---

## 판결 요약

| 항목 | 채택 | 폐기 | 파급 |
|---|---|---|---|
| **C-1 / V-4** 삭제 상태 | `block.lifecycle ENUM('live','trashed','purged')` **3값** + `trashed_at`/`trashed_by`/`trash_root_id`/`purge_after`. 모든 블록에 적용, 휴지통 UI만 `type='page'` 필터 | ① `is_alive`/`alive` boolean (01/05/12) → 파생 뷰로 강등 ② 11의 4값 ENUM 중 `'retained'` ③ 02의 4-timestamp 암묵 상태머신(`purged_at`+`hard_delete_after`) | 01 스키마·F-01-17·F-01-19 / 02 스키마·I7·F-02-11 / 05 스키마·F-05-06·F-05-20 / 11 스키마·F-11-05·F-11-06 / 12 스키마·F-12-04 |
| **C-3 / V-6** 행의 정체성 | 데이터베이스 행 = **`block` 테이블의 행** (`type='page'`, `parent_type='data_source'`). 별도 행 엔티티 없음 | 04의 `row_page` 독립 테이블 (block 미참조) | 04 스키마 전면·F-04-13·F-04-21·F-04-23 / 03 F-03-01(용어만) / 06 F-06-05 / 07 F-07-06 / 02 F-02-14 |
| **C-9 / V-9** parent 종류 | `block.parent_type ENUM('workspace','teamspace','block','data_source')` — **teamspace는 block의 parent가 될 수 있다** | ① 01/05의 `parent_table ∈ {block, space, collection}`(space가 workspace/teamspace를 겸함) ② 02의 `{workspace,teamspace,page_id,block_id,database_id}`(page/block 이중 표현 + database 잘못된 입도) ③ 06의 `{workspace,teamspace,block,database}`(database 입도 오류) | 01 스키마·F-01-01 / 02 스키마·F-02-01·F-02-12 / 05 스키마 / 06 스키마·effective() 3번 항·F-06-04 / 03 F-03-01 |
| **C-10** 자식 순서 | 자식의 **`block.order_key TEXT`** fractional index 단일 방식. 컬럼명은 블록 트리 전역에서 `order_key`. `content uuid[]` 없음. 단 **wire op 어휘(`listAfter`/`listBefore`/`listRemove`)는 그대로 유지** | ① 05/12의 `block.content uuid[]` 저장 ② 컬럼명 `position`(02·04) / `order_idx`(03)를 블록 형제 순서에 쓰는 것 | 01 스키마(권고→확정) / 02 스키마·F-02-02·F-02-03·F-02-08 / 05 스키마·F-05-01·F-05-04·F-05-15 / 12 스키마·F-12-04 / 03·04는 블록 형제 순서 용도로만 정정 |

**"둘 다 맞다"는 판결은 없다.** 원본 Notion이 실제로 두 축을 모두 가진 항목(C-10의 content[] vs 순서키)에 대해서도 클론은 하나를 골랐고, 그 이유를 아래에 적었다.

---

## 정본 스키마

> 다른 클러스터 소유 엔티티(`workspace`, `teamspace`, `data_source`, `property`, `page_property_value`, `acl_entry`, `block_acl_meta`, `view`, `page_meta`, `page_version`)는 **여기서 정의하지 않는다.** 참조만 한다.

```sql
-- ══════════════════════════════════════════════════════════════
-- block-tree 클러스터 소유 엔티티
-- ══════════════════════════════════════════════════════════════

CREATE TYPE block_lifecycle AS ENUM ('live', 'trashed', 'purged');
CREATE TYPE block_parent_type AS ENUM ('workspace', 'teamspace', 'block', 'data_source');

-- 모든 콘텐츠의 단일 테이블.
-- 페이지도 블록이고(type='page'), 데이터베이스 행도 블록이다(type='page' + parent_type='data_source').
CREATE TABLE block (
  id            uuid PRIMARY KEY,            -- v4, 클라이언트 생성 (오프라인/낙관적 업데이트 대비)
  workspace_id  uuid NOT NULL,               -- REFERENCES workspace(id)  [다른 클러스터 소유]
  type          text NOT NULL,               -- 'page' | 'paragraph' | 'heading_1' | 'column' | ...

  -- ── 트리 (C-9, C-10) ─────────────────────────────────────
  parent_type   block_parent_type NOT NULL,
  parent_id     uuid NOT NULL,               -- 다형 참조. parent_type에 따라
                                             --   'block'       → block(id)
                                             --   'data_source' → data_source(id)   [DB 클러스터 소유]
                                             --   'teamspace'   → teamspace(id)      [권한 클러스터 소유]
                                             --   'workspace'   → workspace(id)      [권한 클러스터 소유]
                                             -- DB 레벨 FK 불가 → 애플리케이션/트리거로 강제
  order_key     text NOT NULL,               -- fractional index. 같은 parent_id 내 형제 정렬의 유일한 축
  ancestor_path uuid[] NOT NULL DEFAULT '{}',-- 루트(비block parent 직하)→parent 까지의 block id 순서 배열.
                                             -- 권한 재귀 / 조상 판정 / 부분복원 판정을 1쿼리로 만든다
                                             -- [클론의 설계 선택 — 1차 출처 근거 없음]
  owner_user_id uuid NULL,                   -- parent_type='workspace' 이고 Private 루트일 때만 NOT NULL

  -- ── 내용 ─────────────────────────────────────────────────
  properties    jsonb NOT NULL DEFAULT '{}', -- { title: RichText[], checked: bool, language: 'python', ... }
  format        jsonb NOT NULL DEFAULT '{}', -- { block_color, code_wrap, column_ratio, ... }

  -- ── 수명주기 (C-1) ───────────────────────────────────────
  lifecycle     block_lifecycle NOT NULL DEFAULT 'live',
  trashed_at    timestamptz NULL,            -- lifecycle='trashed' 로 전이한 시각
  trashed_by    uuid NULL,
  trash_root_id uuid NULL,                   -- 실제로 삭제 조작이 일어난 조상 블록 id (자기 자신일 수 있음).
                                             -- "함께 버려진 것만 함께 복원한다"의 유일한 판정 근거
  purge_after   timestamptz NULL,            -- trashed_at + workspace_retention_policy.trash_days.
                                             -- 이 시각이 지나면 GC 배치가 lifecycle='purged' 로 전이
  purged_at     timestamptz NULL,            -- lifecycle='purged' 로 전이한 시각 (물리 삭제 예약의 기준)

  -- ── 감사 / 동시성 ────────────────────────────────────────
  created_by    uuid NOT NULL, created_at     timestamptz NOT NULL,
  last_edited_by uuid NOT NULL, last_edited_at timestamptz NOT NULL,
  version       bigint NOT NULL DEFAULT 0,   -- 단조 증가. 낙관적 동시성 + 실시간 무효화 키

  -- 불변식
  CONSTRAINT ck_private_root CHECK (owner_user_id IS NULL OR parent_type = 'workspace'),
  CONSTRAINT ck_lifecycle_ts CHECK (
       (lifecycle = 'live'    AND trashed_at IS NULL AND purged_at IS NULL)
    OR (lifecycle = 'trashed' AND trashed_at IS NOT NULL AND purged_at IS NULL AND trash_root_id IS NOT NULL)
    OR (lifecycle = 'purged'  AND trashed_at IS NOT NULL AND purged_at IS NOT NULL)
  )
);

-- 형제 순서의 결정성. 충돌 시 재시도(지터) 또는 재균형.
CREATE UNIQUE INDEX ux_block_sibling_order ON block (parent_id, order_key);
-- 트리 읽기 (살아있는 자식만)
CREATE INDEX ix_block_children_live ON block (parent_id, order_key) WHERE lifecycle = 'live';
-- 휴지통 UI (page 타입만 노출)
CREATE INDEX ix_block_trash ON block (workspace_id, trashed_at DESC)
  WHERE lifecycle = 'trashed' AND type = 'page';
-- GC 배치
CREATE INDEX ix_block_purge_due ON block (purge_after) WHERE lifecycle = 'trashed';
CREATE INDEX ix_block_hard_delete_due ON block (purged_at) WHERE lifecycle = 'purged';
-- 조상 판정 / 권한 재귀
CREATE INDEX ix_block_ancestor ON block USING gin (ancestor_path);

-- 모든 일반 조회는 이 뷰만 본다. 개별 쿼리에서 lifecycle 조건을 빼먹는 것이 이 설계의 1순위 버그다.
CREATE VIEW live_block AS SELECT * FROM block WHERE lifecycle = 'live';

-- 편집 조작의 원자 단위 (동기화 클러스터와 공유. 여기서는 블록 트리에 작용하는 op 어휘만 규정)
-- Operation = { id, table, id, path[], command, args }
--   command ∈ set | update | listAfter | listBefore | listRemove | setPermissionItem
--   listAfter/listBefore/listRemove 는 **wire 어휘로만 존치**하며, 서버는 이를
--   대상 블록의 order_key 계산 / lifecycle 전이로 번역한다 (C-10 참조).
```

### 정본 상수

| 상수 | 값 | 근거 |
|---|---|---|
| `TRASH_DAYS_DEFAULT` | 30 | help/custom-data-retention-settings "By default, this is 30 days" |
| `TRASH_DAYS_RANGE` | 1 ~ 3650 (Enterprise만 변경 가능) | 동 문서 "Set a custom time period between one day and 10 years" |
| `PURGED_HARD_DELETE_DAYS` | 30 | help/duplicate-delete-and-restore-content "retained for 30 days before they become inaccessible to all users" — **단, 사용자·API에 노출되지 않는 물리 GC 지연** (C-1 참조) |
| `ORDER_KEY_MAX_LEN` | 32자 (초과 시 형제 전체 재균형 배치) | 클론의 설계 선택 |
| `MAX_TREE_DEPTH` | `[확인필요]` — 실측 필요 | 아래 「남은 불확실성」 |

### 파생/투영 규칙 (다른 문서가 쓰던 이름의 처리)

| 폐기된 이름 | 정본에서의 대체 | 유지 위치 |
|---|---|---|
| `block.is_alive` / `block.alive` | `lifecycle = 'live'` | 내부 저장에서 **삭제**. 필요하면 `live_block` 뷰 사용 |
| 공개 API `in_trash` | `lifecycle = 'trashed'` 의 직렬화 값 | **API 응답에는 유지** (Notion과 계약 동일). `archived`는 노출하지 않음 |
| `block.content uuid[]` | `SELECT id FROM block WHERE parent_id=? AND lifecycle='live' ORDER BY order_key, id` | 저장에서 **삭제**. 서버가 API/클라이언트 캐시로 내보낼 때만 배열로 직렬화 |
| `block.position` / `block.order_idx` (형제 순서 용도) | `block.order_key` | 저장에서 **삭제** |
| `block.space_id` (02) | `parent_type='teamspace'` 인 조상까지 `ancestor_path` 로 해석 | 비정규화 캐시가 필요하면 `teamspace_id` 라는 명시적 이름으로, 파생임을 문서화 |
| `block.deleted_at` (03·06 편의표기) | `trashed_at` | 저장에서 **삭제** |
| `row_page.*` (04) | `block` + DB 클러스터의 `page` 확장 테이블 | 04 스키마 전면 폐기 |

---

## 판결별 상세

### C-1 / V-4 — 삭제 상태 표현

**채택**: `lifecycle ENUM('live','trashed','purged')` **3값** + `trashed_at` / `trashed_by` / `trash_root_id` / `purge_after` / `purged_at`. **모든 블록**에 적용하고, 휴지통 UI만 `type='page'`로 필터한다.

**상태 전이표**

| From → To | 트리거 | 부수효과 |
|---|---|---|
| `live` → `trashed` | 사용자 Delete / API `in_trash:true` / 블록 병합·삭제 | 대상과 **모든 자손**에 전파. 자손의 `trash_root_id` = 대상 id. `purge_after` = now + `trash_days`. `parent_id`·`order_key`는 **절대 변경하지 않는다**(원위치 복원이 공짜가 된다) |
| `trashed` → `live` | 사용자 Restore / API `in_trash:false` | 대상 + **`trash_root_id`가 대상 id인 자손만** 복원. 대상보다 먼저 독립적으로 버려진 자손(다른 `trash_root_id`)은 `trashed` 유지 |
| `trashed` → `purged` | GC 배치(`purge_after` 경과) 또는 사용자 "영구 삭제" | 사용자·API·워크스페이스 owner 모두 접근 불가. blob refcount 감소 |
| `purged` → (행 물리 삭제) | GC 배치(`purged_at` + `PURGED_HARD_DELETE_DAYS` 경과) | 되돌릴 수 없음 |

**근거**

1. boolean으로는 표현이 불가능하다. 1차 출처가 요구하는 것은 최소 2단계다 — 휴지통 기본 30일, Enterprise는 "one day and 10 years" 커스텀, 그 기간 동안 "Only Enterprise workspace owners can view and restore deleted pages during this retention period" (https://www.notion.com/help/custom-data-retention-settings). boolean 한 컬럼은 "언제 버려졌나 / 언제 소멸하나 / 누가 복원할 수 있나"를 담지 못한다.
2. **11의 4번째 값 `'retained'`는 애플리케이션 상태가 아니다.** 근거였던 문장은 "Once pages are permanently deleted from Trash, they are retained for 30 days before they become inaccessible to all users, even workspace owners" (https://www.notion.com/help/duplicate-delete-and-restore-content) 인데, 같은 1차 출처군의 다른 두 문서가 이 30일의 정체를 밝힌다 — 보존 설정 문서는 영구 삭제 후 "workspace owners will also be unable to access or restore it"이라 명시하고, 백업 문서는 "We keep backups of our database, which allows us to restore a snapshot of any page in the past 30 days if you need it"라며 **지원팀에 문의해야 하는 DB 백업/PITR 창**으로 서술한다 (https://www.notion.com/help/back-up-your-data). 즉 `retained`는 **어떤 사용자에게도, 어떤 API에도 보이지 않는 물리 GC 지연**이다. 보이지 않는 것은 도메인 상태가 아니다 → ENUM 값이 아니라 `purged_at + 30d` 라는 GC 스케줄로 표현한다. ENUM 값으로 두면 모든 조회 쿼리가 `lifecycle IN (...)` 목록을 관리해야 하고, "retained 페이지를 owner가 볼 수 있나"라는 답이 정해진 질문이 코드 리뷰마다 재발한다.
3. **02의 4-timestamp 방식(`trashed_at`+`purged_at`+`hard_delete_after`+`deleted_root_id`)은 상태를 3개 컬럼의 NULL 조합에 암묵적으로 인코딩한다.** 표현력은 동등하지만 불법 조합(`purged_at` NOT NULL인데 `trashed_at` NULL 등)이 스키마상 가능하고, 부분 인덱스 조건이 `trashed_at IS NULL AND purged_at IS NULL` 처럼 길어져 누락 위험이 커진다. 명시적 ENUM + CHECK 제약이 같은 값을 더 싸게 강제한다. 02의 `deleted_root_id`는 개념이 옳으므로 이름만 `trash_root_id`(11)로 통일해 살린다.
4. **`is_alive`/`alive`가 원본에 실재한다는 것은 반론이 되지 않는다.** 내부 API 리버스 엔지니어링 구현체는 `Alive bool // if false, the page is deleted` 를 노출하고(https://pkg.go.dev/github.com/kjk/notionapi), 공개 API는 `in_trash`를 노출한다(https://developers.notion.com/reference/block). 그러나 이것들은 **경계면의 투영**이지 저장 모델이 아니다 — 노션 자신도 30일 카운트다운·Enterprise 커스텀 보존을 boolean만으로 구현하고 있지 않다. 클론은 저장에 3값을 두고, 공개 API 응답에서 `in_trash := lifecycle='trashed'` 로 투영한다. (참고: `archived`는 2026-03-11 API 버전부터 파라미터로 아예 제거되었다 — "Starting with `2026-03-11`, only `in_trash` is accepted", https://developers.notion.com/reference/trash-page. 클론은 처음부터 `in_trash`만 낸다.)
5. **`trash_root_id`는 장식이 아니라 복원 시맨틱의 유일한 근거다.** 1차 출처: "Restoring a page from the Trash will also restore any child pages that were moved into the Trash along with it" — *along with it*(함께 버려진 것)만 함께 복원된다. 즉 복원 범위는 "자손 전체"가 아니라 "이번 삭제로 함께 잠긴 자손"이며, 이를 구분할 수 있는 것은 삭제 시발점 id뿐이다.
6. **전파 vs 루트만 마킹**: 삭제 시 자손 전체에 `lifecycle`을 전파한다(쓰기 O(서브트리)). 루트에만 찍고 조회 시 조상 체인을 확인하는 대안은 **모든 읽기**에 조상 검사를 붙이는 것이며, 트리 조회는 삭제보다 수 자릿수 잦다. 02가 이미 "전파 + root 컬럼 병기가 실용적"이라 `[추정]`으로 적은 방향을 확정한다.
7. **모든 블록에 lifecycle을 둔다** (11의 결론 채택): 블록 단위 삭제(백스페이스 병합 등)도 되돌릴 수 있어야 하고, `parent_id` FK 무결성이 유지되어야 한다. 휴지통 **UI**만 `type='page'`로 거른다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 01 `is_alive BOOLEAN` / 05 `alive boolean` / 12 `alive bool` | 30일 카운트다운·Enterprise 1일~10년 커스텀·"누가 복원 가능한가"를 표현 불가. 원본 내부 필드이지만 저장 모델이 아니라 경계면 투영 |
| 11 `lifecycle` 4값 중 `'retained'` | 그 상태의 데이터는 사용자·API·owner 누구에게도 보이지 않는다 → 도메인 상태가 아니라 GC 지연. 1차 출처 3건 대조로 확정 |
| 02 `purged_at` + `hard_delete_after` + `deleted_root_id` 조합 | 표현력 동등하나 불법 상태 조합 허용, 인덱스 조건 비대. `purged_at`은 GC 기준으로 살리고 `hard_delete_after`는 `purged_at + 상수`로 계산해 제거, `deleted_root_id`는 `trash_root_id`로 개명 |
| 02 `trash_entry(block_id, original_parent_id, original_position, original_space_id)` | 삭제 시 `parent_id`/`order_key`를 변경하지 않으므로 원위치 정보를 별도 보관할 이유가 없다. 조상이 `purged`인 경우의 복원만 예외이며, 그 경우는 아래 규칙으로 처리 |

**파생 결정 (이 판결이 없으면 정해지지 않는 것들)**

- **조상이 `purged`인 노드의 복원**: 복원 대상의 `ancestor_path`를 훑어 `lifecycle='purged'`인 조상이 하나라도 있으면, 복원 대상을 **복원 실행자의 Private 루트**(`parent_type='workspace'`, `owner_user_id=실행자`)로 재부모화하고 배너로 고지한다. 조용히 실패시키지 않는다.
- **오프라인 삭제 충돌 (12 F-12-04 재작성)**: 큐잉된 op의 대상 블록이 `lifecycle='trashed'` → **되살린다**(`live`로 전이 + 배너). `lifecycle='purged'` → op를 적용하지 않고, 로컬에 남은 콘텐츠를 **실행자의 Private 루트에 새 페이지로 복구**한 뒤 고지한다. 12의 원안(`alive=false`면 되살린다)은 boolean 전제라 `purged`를 구분하지 못해 **소멸된 페이지를 부활시키는 규정 위반**이 된다.
- **동기화 pull 응답의 tombstone (05 F-05-20)**: `alive:false` 대신 `{lifecycle:'trashed'|'purged'}`를 실어야 한다. 클라이언트는 `trashed`면 "휴지통으로 이동됨" 렌더 후 구독 해제, `purged`면 캐시에서 제거 + 구독 해제로 처리를 달리한다.

**파급 범위**

| 문서 | 고칠 것 |
|---|---|
| 01-block-editor.md | `block` DDL의 `is_alive` 제거 → `lifecycle` 외 5컬럼. 인덱스 `WHERE is_alive` → `WHERE lifecycle='live'`. F-01-17(undo), F-01-19(병합 시 `is_alive=false` → `lifecycle='trashed'`, `trash_root_id`=자기 자신) |
| 02-page-workspace.md | `block` DDL 삭제 컬럼 4개 → 정본 5컬럼. 불변식 I7 재작성. `live_block` 뷰 정의는 정본 유지. F-02-11 전면(상태 전이표·복원 범위 규칙·조상 purged 처리), `trash_entry` 테이블 삭제 |
| 05-collaboration-sync.md | `block.alive` 제거. F-05-06 재접속 델타의 tombstone 표현, F-05-20 pull 응답 스키마 |
| 11-history-notifications.md | `lifecycle` 4값 → 3값, `'retained'` 삭제. `purge_after` 유지 + `purged_at` 추가. F-11-05(모든 블록 lifecycle + page 필터 UI는 정본 채택), F-11-06(보존 정책 → `retained_days`는 **사용자 노출 상태가 아니라 GC 상수**로 재서술) |
| 12-platform-ux.md | 서버측 block 스키마 주석의 `alive bool` 정정. **F-12-04 오프라인 삭제 충돌 규칙 재작성**(위 파생 결정) |
| 03 / 06 | 편의표기 `deleted_at` → `trashed_at`. `database.deleted_at`은 DB 클러스터 소관이나 블록 트리와 같은 lifecycle 어휘를 쓰도록 권고 |

---

### C-3 / V-6 — 데이터베이스 행의 정체성

**채택**: **행은 `block` 테이블의 행이다.** `type='page'`, `parent_type='data_source'`, `parent_id=data_source.id`. 행 고유 컬럼(`data_source_id` 중복 없음 — `parent_id`가 그 역할, `unique_seq`, `is_template` 등)은 **DB 클러스터가 소유하는 1:1 확장 테이블** `page(id uuid PK REFERENCES block(id), ...)`에 둔다. 셀 값의 저장 방식(EAV vs JSONB)은 **C-2/V-2, database 클러스터 소관**이며, 이 판결은 그 선택과 무관하게 **셀 값 테이블의 FK 대상이 `block(id)`라는 점만** 고정한다.

**근거**

1. 공개 API가 이미 이 모델이다. parent object 문서는 "Pages can be parented by other pages, data sources, blocks, agents, or by the whole workspace"라고 명시한다(https://developers.notion.com/reference/parent-object) — 행은 별도 종류가 아니라 **부모가 data source인 page**다.
2. 페이지 id를 그대로 block id로 쓸 수 있다 — `GET /v1/blocks/{block_id}/children`에 페이지(=행) id를 넣으면 그 본문 블록이 나온다. 행이 본문 블록 트리를 갖는다는 사실에 04도 동의하므로, 행을 block 밖에 두면 **같은 트리를 두 테이블에서 소유**하게 된다.
3. 내부 모델도 동일하다 — 리버스 엔지니어링 구현체의 `Block.ParentTable`은 `space`/`block`/`collection`을 취하며, 행은 `parent_table='collection'`인 **block 레코드**다(https://pkg.go.dev/github.com/kjk/notionapi).
4. **클론 관점의 결정타는 코드 경로 수다.** 행을 block에서 분리하면 다음이 전부 2벌이 된다 — 휴지통/복원(C-1의 상태 전이·`trash_root_id` 전파), 권한 재귀 종료 조건(06 F-06-05), 검색 인덱싱 단위(07 F-07-06), 백링크 대상 해석(02 F-02-14), 페이지 열기(04 F-04-21), 버전 히스토리 대상. 04의 `row_page`에는 이미 `in_trash boolean`이라는 **세 번째 삭제 모델**이 들어있는데, 이것이 분리의 비용을 그대로 보여준다.
5. 03 F-03-01이 "별도의 row 개념을 만들면 안 된다"고 못박은 것은 옳고, 04가 그것을 인지하지 못한 채 스키마를 확정한 것이다. 04를 03에 맞춘다.

**폐기**: 04-database-views.md의 `CREATE TABLE row_page (id uuid PRIMARY KEY, data_source_id ..., properties jsonb, position, in_trash boolean, ...)`. **이유**: block 미참조 → 본문 블록 트리 소유자 불명, 삭제·권한·검색·백링크가 전부 이중 구현, `position`/`in_trash`가 블록 트리의 `order_key`/`lifecycle`과 충돌.

**경계 선언**
- `row_page.properties jsonb` vs 03 `page_property_value` EAV의 승부는 **C-2/V-2 · database 클러스터 소관**이다. block-tree는 관여하지 않는다.
- `row_page.position`은 두 가지가 뒤섞여 있었다. **① data source 내 행의 기본/수동 순서 = `block.order_key`**(정본, block-tree 소유). **② 뷰별·그룹별 수동 정렬 오버라이드 = `row_position(view_id, group_key, row_id, position)`**(04가 이미 별도 테이블로 도출한 것, view 클러스터 소유). 두 축은 별개이며 서로를 대체하지 않는다.
- `row_page.is_template`, `unique_seq`, `data_source_id` 재확인용 컬럼은 DB 클러스터의 `page` 확장 테이블로 이관한다.

**파급 범위**

| 문서 | 고칠 것 |
|---|---|
| 04-database-views.md | `row_page` 테이블 삭제 → `block`(+`page` 확장) 참조로 대체. `row_page.*` 를 참조하는 전 구간: L155 `template_page_id`, L181 `row_id`, L384 그룹 내 순서, L536 dependency, L994 `created_by` NULL, L1164, L1200 `version`, L1329 `search_tsv`, L1372~1380 템플릿. F-04-13 / F-04-21 / F-04-23 |
| 03-database-core.md | `CREATE TABLE page (id uuid PK REFERENCES block(id), data_source_id ...)` 에서 `data_source_id`는 `block.parent_id`와 중복 → 확장 테이블에서 제거하거나 **파생 캐시임을 명시**. `order_idx`(행 순서) → `block.order_key`로 이관. `deleted_at` 제거(=`block.lifecycle`). F-03-01 서술을 정본 용어로 |
| 06-permissions-sharing.md | F-06-05 권한 재귀가 행 페이지에서도 동일 경로를 타도록 서술. `parent_type='data_source'`일 때 다음 홉은 data source의 부모 database 블록 |
| 07-search-navigation.md | F-07-06 인덱싱 단위 = `block` (행 별도 파이프라인 없음) |
| 02-page-workspace.md | F-02-14 백링크 대상이 행 페이지를 자연히 포함함을 명시 |

---

### C-9 / V-9 — parent 종류: teamspace는 block의 parent가 될 수 있는가

**채택**: **된다.** `parent_type ENUM('workspace','teamspace','block','data_source')` 4값.

| 값 | `parent_id`가 가리키는 것 | 언제 |
|---|---|---|
| `block` | `block(id)` | 일반 중첩. 페이지 안의 블록, 페이지 안의 서브페이지 — **page와 block을 구분하지 않는다** |
| `data_source` | `data_source(id)` | 데이터베이스 행 (C-3) |
| `teamspace` | `teamspace(id)` | teamspace 최상위 페이지 |
| `workspace` | `workspace(id)` | Private 루트 페이지(`owner_user_id NOT NULL`) 및 워크스페이스 직속 페이지 |

**재귀 종료 조건**: 권한/조상 탐색은 `parent_type ∈ {'teamspace','workspace'}`에서 종료한다. `data_source`는 종료가 아니라 **경유**다(data source → 부모 database 블록 → 계속 상향).

**근거**

1. **1차 출처는 "teamspace parent 없음"이지만, 그 문서 자신이 그것을 표현상의 한계로 인정한다.** parent object 레퍼런스에는 database / data source / page / workspace / block / agent 6종만 있고 teamspace가 없으며, "Team-level pages are also currently represented as having a workspace parent in the API"라고 적는다(https://developers.notion.com/reference/parent-object). *currently represented as* — 이것은 저장 모델의 주장이 아니라 API 투영의 서술이다. 커뮤니티에서도 teamspace 조회 엔드포인트가 없고 최상위 페이지의 parent가 workspace로만 보인다는 것이 반복 보고된다.
2. **클론에서 결정적인 것은 권한 재귀의 종료 조건이다.** 06의 effective()는 3번 항으로 "N이 teamspace 하위이고 U가 그 teamspace 멤버이면 teamspace 설정이 부여한 레벨"을 계산한다. teamspace가 트리 노드가 아니면 이 항은 **트리 밖의 비정규화 컬럼(`space_id`)을 읽어야** 하고, 페이지를 teamspace 간 이동시킬 때 서브트리 전체의 `space_id`를 다시 써야 하며(트리 이동과 별개의 두 번째 전파 경로), 하나라도 놓치면 권한이 조용히 틀어진다. teamspace를 parent로 두면 **트리 이동 = 권한 이동**이 자동으로 성립하고 전파 경로가 하나가 된다.
3. **01/05의 `space`는 workspace와 teamspace를 한 이름으로 겸한다** — 리버스 엔지니어링 구현체의 상수 집합에는 `TableSpace`만 있고 teamspace 전용 테이블이 없다(teamspace는 2021년에 뒤늦게 추가된 개념이다). 즉 01/05의 3값은 **teamspace 이전 시대의 모델**이며, 그대로 쓰면 "space가 workspace인가 teamspace인가"를 코드마다 다시 판단하게 된다.
4. **02의 `page_id`/`block_id` 이중 값은 잘못이다.** 02 자신의 F-02-01이 "페이지 = 블록"이라고 선언하므로, parent 축에서 둘을 구분하면 같은 사실을 두 곳에서 관리하게 된다. 하나로 합친다(`'block'`).
5. **02/06의 `database_id`도 잘못된 입도다.** 2025-09-03 API 업그레이드 이후 스키마와 행 집합의 소유자는 database가 아니라 **data source**이며(https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), 행의 부모는 data source다. 01/05의 `collection`은 개념적으로 옳으나 이름이 구세대이므로 `data_source`로 개명한다.

**공개 API 투영 규칙 (Notion 계약 유지)**

| 내부 `parent_type` | API `parent` |
|---|---|
| `block` (부모가 type='page') | `{"type":"page_id","page_id":...}` |
| `block` (부모가 일반 블록) | `{"type":"block_id","block_id":...}` |
| `data_source` | `{"type":"data_source_id","data_source_id":...}` |
| `teamspace` | `{"type":"workspace","workspace":true}` ← Notion과 동일한 투영 |
| `workspace` | `{"type":"workspace","workspace":true}` |

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 01/05 `parent_table ∈ {block, space, collection}` | `space`가 workspace/teamspace를 겸해 권한 재귀 종료 조건이 불명확. teamspace 도입 이전 모델 |
| 02 `parent_type ∈ {workspace, teamspace, page_id, block_id, database_id}` | page/block 이중 표현이 02 자신의 "페이지=블록" 선언과 모순. `database_id`는 잘못된 입도 |
| 06 `parent_type ∈ {workspace, teamspace, block, database}` | 방향은 옳으나 `database` → `data_source` 입도 오류 |
| 02 `block.space_id` 컬럼(권한 해석용) | 트리 밖 두 번째 전파 경로. `ancestor_path` 상의 teamspace 노드로 대체. 성능상 비정규화가 필요하면 파생 캐시로만 |

**파급 범위**: 01 스키마·F-01-01 / 02 스키마·F-02-01·F-02-12(Private/Teamspace/Shared 구분을 `parent_type`+`owner_user_id`로 재서술) / 05 스키마 / 06 스키마·effective() 3번 항·F-06-04(teamspace 삭제 시 하위 처리 = 해당 teamspace를 parent로 갖는 블록의 서브트리 lifecycle 전이) / 03 F-03-01

---

### C-10 — 자식 순서 표현

**채택**: **자식의 `order_key TEXT` fractional index 단일 방식.** 부모의 `content uuid[]`는 저장하지 않는다. 컬럼명은 블록 트리 전역에서 **`order_key`**. 단 **05의 op 어휘 `listAfter`/`listBefore`/`listRemove`는 wire 프로토콜로 그대로 유지**하고, 서버가 이를 order_key 계산으로 번역한다.

**op 번역표 (05의 트랜잭션 op 집합을 다시 설계할 필요가 없는 이유)**

| wire op | 인자 | 서버 동작 |
|---|---|---|
| `listAfter` | `{parent_id, id, after: X}` | `order_key(id) = between(order_key(X), next_sibling_order_key(X))`. `after` 생략 시 맨 앞 |
| `listBefore` | `{parent_id, id, before: X}` | `order_key(id) = between(prev_sibling_order_key(X), order_key(X))`. `before` 생략 시 맨 뒤 |
| `listRemove` | `{parent_id, id}` | `lifecycle='trashed'` 전이 (C-1). order_key는 건드리지 않는다 |
| `set` on `content` 경로 | — | **금지**. 클라이언트가 자식 순서를 통째로 덮어쓰는 것을 서버가 거부한다 |

**근거**

1. **원본은 `content uuid[]`가 맞다** — 데이터 모델 블로그가 "The content attribute of a block is what stores the array of block IDs (or pointers) referencing those nested blocks"라고 명시하고(https://www.notion.com/blog/data-model-behind-notion), 리버스 엔지니어링 구현체도 `ContentIDs []string`을 갖는다. **그럼에도 클론은 다른 쪽을 고른다.**
2. **이유는 충돌 지점의 위치다.** 배열 모델에서 자식 하나를 삽입·이동하면 **부모 행**이 갱신된다. 자식이 500개인 페이지에서 두 사람이 서로 다른 위치에 동시에 블록을 넣으면 두 트랜잭션이 같은 부모 행을 두고 직렬화된다 — 즉 **부모가 페이지 전체 편집의 락 지점**이 된다. fractional index는 이동한 자식 한 행만 쓰므로 동시 삽입이 서로를 막지 않는다. 노션이 배열을 쓰면서도 이 문제를 견디는 것은 `listAfter`라는 상대 위치 op와 서버측 병합 덕분인데, 그 상대 위치 시맨틱은 **fractional index에서도 그대로 성립한다**(위 번역표). 즉 클론은 노션이 얻은 이점은 유지하고 비용만 버린다.
3. **`content[]`를 버려도 손실되는 정보가 없다.** 자식 목록은 `parent_id` 인덱스로 O(자식 수)에 재구성되고, 순서는 `order_key`가 준다. 반대로 배열을 유지하면 **동일 정보가 두 곳(부모 배열 + 자식 parent_id)에 존재**해 정합성 검사가 상시 필요하다(고아 id, 중복 id, 배열에 없는 자식).
4. **fractional indexing은 검증된 기법이다** — Figma의 순서 편집 설계와 Liveblocks의 정리 글이 동일 결론을 제시한다(https://www.figma.com/blog/realtime-editing-of-ordered-sequences/ , https://liveblocks.io/blog/how-crdts-and-sync-engines-keep-realtime-lists-ordered-with-fractional-indexing).
5. **컬럼명은 `order_key`로 통일한다.** `position`(02·04)은 04에서 뷰 탭 순서·그룹 내 행 순서에도 쓰여 의미가 과부하되고, `order_idx`(03)는 프로퍼티 순서에 이미 쓰이고 있다. 블록 형제 순서만을 가리키는 고유한 이름이 필요하다.

**필수 부가 규칙**

- `UNIQUE (parent_id, order_key)`. 동시 삽입이 같은 키를 만들면 **자리 양보 없이 재시도**(키에 짧은 지터 문자 추가)한다. 조용한 순서 뒤집힘보다 재시도가 낫다.
- 결정적 정렬: `ORDER BY order_key, id` — 만에 하나 중복이 새어들어도 렌더 순서가 클라이언트마다 갈리지 않는다.
- `ORDER_KEY_MAX_LEN=32` 초과 시 해당 부모의 형제 전체를 재균형(백그라운드 잡). 재균형은 순서를 바꾸지 않으므로 사용자에게 보이지 않지만 **모든 형제의 version이 오르므로** 동기화 폭풍을 피하려 유휴 시간에 돌린다.
- 클라이언트 캐시·공개 API로 내보낼 때만 `children: [id...]` 배열로 직렬화한다(노션과 동일한 응답 형태 유지, 저장 형태와 무관).

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 05 `block.content uuid[]` (+ 12의 동일 컬럼) | 부모 행이 동시 편집의 직렬화 지점이 됨. 정보 이중화로 정합성 검사 상시 필요 |
| 05의 `listAfter/listBefore/listRemove`가 **배열 저장을 전제**한다는 가정 | 전제가 아니다. op는 상대 위치 시맨틱이며 order_key로 번역 가능 → **op 어휘는 폐기하지 않고 존치** |
| 블록 형제 순서에 `position`(02·04) / `order_idx`(03)를 쓰는 것 | 이름 과부하. 단 **뷰별 행 순서(`row_position.position`)와 프로퍼티 순서(`property.order_idx`)는 다른 클러스터 소유이므로 그대로 둔다** |

**파급 범위**: 01 스키마(비교표의 "권장"을 "확정"으로) / 02 스키마·F-02-02·F-02-03(사이드바 순서)·F-02-08(이동 시 order_key 재계산 + `ancestor_path` 서브트리 갱신) / 05 스키마·F-05-01(병합 코어에서 배열 병합 로직 제거)·F-05-04(낙관적 업데이트의 롤백 단위가 부모 배열이 아니라 자식 행)·F-05-15(협업 undo의 역연산: `listAfter`의 역은 이전 order_key 복원) / 12 스키마·F-12-04 / 03·04는 블록 형제 순서 용도로 쓰인 컬럼만 정정

---

## 수정이 필요한 문서 목록

| 문서 | 항목 | 내용 |
|---|---|---|
| **01-block-editor.md** | 의사 스키마 (L~78-90) | `is_alive` → `lifecycle` 5컬럼 세트. `parent_table` → `parent_type` 4값. `order_key` 유지 + `UNIQUE(parent_id,order_key)`·`ancestor_path` 추가. 인덱스 `WHERE is_alive` → `WHERE lifecycle='live'` |
| | 자식 순서 비교표 (L~92-96) | "클론 권장" → **"정본 확정"**. `content[]` 행은 "원본의 방식이나 클론은 폐기" 로 재서술 + op 번역표 삽입 |
| | F-01-01 | 트리 루트 판정 = `parent_type ∈ {teamspace, workspace}` |
| | F-01-17, F-01-19 | undo/병합의 `is_alive=false` → `lifecycle='trashed'` + `trash_root_id` |
| **02-page-workspace.md** | 의사 스키마 (L~44-59) | 삭제 4컬럼 → 정본 5컬럼. `parent_type` 5값 → 4값. `position` → `order_key`. `space_id` 제거(파생 캐시로 강등) |
| | 불변식 I7 | 3상태 머신 재작성 (정본 상태 전이표) |
| | F-02-01 / F-02-12 | 페이지=블록 선언을 parent_type 4값으로 재서술. Private/Teamspace/Shared를 `parent_type`+`owner_user_id`로 정의 |
| | F-02-11 | 전면 재작성. 복원 범위(`trash_root_id` 일치분만), 조상 purged 시 재부모화, `trash_entry` 테이블 삭제 |
| | F-02-02 / F-02-03 / F-02-08 | 순서·이동 시 `order_key` + `ancestor_path` 서브트리 갱신 |
| | L1156 스키마 확장 요약 | 3상태 머신 서술 정정 |
| **03-database-core.md** | `CREATE TABLE page` (L~81-89) | `data_source_id` 중복 제거 또는 파생 명시. `order_idx` → `block.order_key`로 이관. `deleted_at` 삭제 |
| | F-03-01 | 정본 용어(`parent_type='data_source'`)로 재서술 |
| **04-database-views.md** | `CREATE TABLE row_page` (L101-114) | **테이블 삭제.** `block` + `page` 확장 참조로 대체 |
| | L155/181/384/536/994/1164/1200/1329/1372-1380 | `row_page.*` 참조 전량 치환. `row_page.position`은 뷰별 순서(`row_position`)와 트리 순서(`block.order_key`)로 분리 |
| | F-04-13 / F-04-21 / F-04-23 | 행 열기·linked view·다중 data source가 block 경로를 타도록 |
| **05-collaboration-sync.md** | `block` 스키마 (L57-72) | `content uuid[]` 삭제, `alive` → `lifecycle`, `parent_table` → `parent_type` 4값, `order_key` 추가 |
| | L81 op 주석 / F-05-01 / F-05-04 / F-05-15 | op 어휘는 유지, **서버측 적용 의미를 order_key 번역으로** 재서술 |
| | F-05-06 / F-05-20 (L1016 표) | tombstone 표현 `alive:false` → `lifecycle` |
| **06-permissions-sharing.md** | `block(...)` (L72-73) | `parent_type` 4값(`database`→`data_source`), `deleted_at` → `lifecycle` |
| | effective() 3번 항 (L153-156) | teamspace가 트리 노드임을 전제로 재서술 |
| | F-06-04 / F-06-05 | teamspace 삭제 시 하위 전이, 행 페이지 재귀 |
| **07-search-navigation.md** | F-07-06 | 인덱싱 단위 = `block` 단일 (행 별도 파이프라인 없음) |
| **11-history-notifications.md** | `block` 스키마 (L119-129) | `lifecycle` 4값 → 3값(`retained` 삭제), `purged_at` 추가 |
| | F-11-05 / F-11-06 | 보존 정책의 `retained_days`를 **GC 상수**로 재서술(사용자 노출 상태 아님). 정본 상태 전이표 채택 |
| | L480 | `path ltree`/`closure_table` 선택지 → **`ancestor_path uuid[]` 확정**으로 정정 |
| **12-platform-ux.md** | L31 서버측 block 주석 | `content uuid[]`·`alive bool` 제거 |
| | L229 / F-12-04 | **오프라인 삭제 충돌 규칙 재작성** — `trashed`면 부활, `purged`면 Private 루트에 새 페이지로 복구 |

---

## 남은 불확실성

| # | 확정 못 한 것 | 왜 지금 확정 못 하나 | 어떻게 실측하나 |
|---|---|---|---|
| 1 | **최대 트리 깊이** (`MAX_TREE_DEPTH`) | 공개 문서에 페이지 중첩 깊이 상한이 명시되지 않는다. API의 "2 levels deep" 제약은 *한 요청에 실을 수 있는 children 중첩*이지 트리 깊이가 아니다 | 테스트 워크스페이스에서 스크립트로 서브페이지를 1단씩 계속 생성 → 실패 지점 기록. `ancestor_path uuid[]`의 배열 길이 상한과 UI breadcrumb 동작도 함께 관찰. **확정 전까지 클론 상수 100으로 두고 초과 시 명시적 에러** |
| 2 | **`purged` 상태에서 Enterprise owner가 실제로 무엇을 볼 수 있는가** | 1차 출처 2건이 상충한다. 보존 설정 문서는 영구 삭제 후 "workspace owners will also be unable to access or restore it", 삭제/복원 문서는 "retained for 30 days before they become inaccessible to all users, even workspace owners" — 후자는 30일간은 접근 가능하다고 읽힐 여지가 있다. 백업 문서가 이를 지원팀 경유 DB 스냅샷으로 서술하므로 **UI 노출은 없다**고 판단했으나 100%는 아니다 | Enterprise 워크스페이스에서 페이지 영구 삭제 → owner 계정의 설정 > 데이터 보존 화면에 해당 페이지가 남는지 확인. 남는다면 `purged`도 조회 가능한 상태가 되어 인덱스 정책이 바뀐다. **결론이 바뀌어도 ENUM 3값은 유지**되고 조회 권한 조건만 추가된다 |
| 3 | **행을 데이터베이스 밖으로 이동시켰을 때의 정확한 동작** | 03 F-03-01이 "프로퍼티 값이 사라짐 `[확인필요]`"로 남겨둔 항목. 정본 모델에서는 `parent_type: data_source → block` 전이이며, 셀 값 행을 삭제할지 보존할지가 미정 | 테스트: 행을 일반 페이지 하위로 Move to → 되돌렸을 때 프로퍼티 값이 복구되는지 관찰. **소관은 database 클러스터**이나 `parent_type` 전이 규칙은 block-tree 소유이므로 결과를 이 문서에 반영해야 한다 |
| 4 | **teamspace 최상위 페이지의 실제 저장상 parent** | API가 workspace로 투영한다는 사실만 확인됐고, 저장 모델이 teamspace를 parent로 두는지 `space_id` 컬럼으로 두는지는 비공개. **판결은 1차 출처가 아니라 클론 설계 근거(권한 전파 경로 단일화)에 기반한다** | 실측 불가(내부 스키마 비공개). 대신 클론에서의 검증: 페이지를 teamspace A→B로 이동시키는 통합 테스트에서 서브트리 전원의 유효 권한이 단 한 번의 트리 이동으로 바뀌는지 확인 |
| 5 | **`ancestor_path uuid[]` vs closure table의 실제 임계점** | 이동 시 서브트리 전량 UPDATE라는 비용이 서브트리 크기 몇에서 문제가 되는지 미측정 | 10/100/1000/10000 노드 서브트리 이동 벤치마크. 임계 초과 시 대안은 **경로를 자식이 lazy 갱신**하는 방식이며, 그 경우에도 `parent_type`/`order_key` 판결은 영향받지 않는다 |
