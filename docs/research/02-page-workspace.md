# 02. 페이지 / 워크스페이스 구조

> 조사일: 2026-09-06 / 모드: DOMAIN / 대상: 노션 클론 기획 (C:/VibeCoding/notion)
> 태그 규칙: `[추정]` = 공식 문서에 근거 없이 관찰·설계로 유추한 것, `[확인필요]` = 사실로 보이나 재검증 필요

## 요약

- 노션에서 **페이지는 독립 엔티티가 아니라 블록의 한 종류**다. 페이지 블록은 자식 블록의 순서 배열(content)을 가지며, 그 자식으로 다시 페이지 블록이 올 수 있어 깊이 제한 없는 트리를 이룬다.
- 트리의 루트는 **workspace**이고 그 아래 Teamspace / Private 컨테이너, 그 아래 top-level 페이지 → 서브페이지가 이어진다.
- **권한은 content(하향 포인터)가 아니라 parent(상향 포인터) 체인을 워크스페이스 루트까지 거슬러 올라가며 해석**된다. 이것이 "서브페이지는 부모 권한을 상속한다"의 구현 근거다.
- 사이드바는 이 트리의 뷰이며, Favorites와 펼침 상태만 **사용자별(per-user)**, Teamspace 하위 정렬 순서는 **전 멤버 공통**이다.
- 삭제는 물리 삭제가 아니라 **2단계 soft delete**다: 휴지통 30일 → "영구 삭제" 이후에도 30일 더 남는 retention 구간 → 그 다음에야 완전 소멸. 이동(move to)·복제(duplicate)·삭제·권한 변경은 모두 **서브트리 단위 연산**이다.
- 사이드바는 **2026-03-26 Notion 3.4에서 4개 탭(Home / Chats / Meetings / Inbox) 구조로 재편**되었고, 기존 Favorites·Teamspaces·Shared·Private는 Home 탭 내부 섹션이 되었다(섹션 on/off·순서 변경 가능). 이 문서는 3.4 이후 구조를 기준으로 한다.
- `Link to page` 블록은 대상 페이지를 **이동시키지 않고 사이드바에만 자식으로 보이게 하는 보조 엣지**다. 소유 엣지(`parent_id`)와 반드시 분리 저장해야 권한이 새지 않는다.

---

## 핵심 개념 / 데이터 모델

### 개념 계층

```
workspace
 └─ 컨테이너: teamspace | private-root(user별) | shared(파생 뷰, 실체 아님)
     └─ page (block, type='page')
         └─ block[] (paragraph, heading, child_page, link_to_page, ...)
             └─ page (block, type='page')   ← 무한 반복
```

`Shared` 섹션은 **저장되는 컨테이너가 아니라 "내가 접근권을 가졌지만 내 Private도 아니고 내가 속한 Teamspace도 아닌 페이지"를 모은 파생 뷰**로 보인다. `[추정]` — 공식 문서는 Shared를 "pages that you and select others in your workspace have access to"라고만 기술하고 별도 저장 컨테이너로 명시하지 않는다.

### 의사 스키마

```sql
-- 1) 모든 콘텐츠의 단일 테이블. 페이지도 여기 들어간다.
block (
  id              uuid  PK,                    -- Notion은 UUIDv4, Docmost는 UUIDv7
  type            text  NOT NULL,              -- 'page' | 'paragraph' | 'heading_1' | 'link_to_page' ...
  parent_id       uuid  REFERENCES block(id),  -- 상향 포인터. 권한 해석의 유일한 축
  parent_type     text  NOT NULL,              -- 'workspace'|'teamspace'|'page_id'|'block_id'|'database_id'
  workspace_id    uuid  NOT NULL,
  space_id        uuid  NULL,                  -- teamspace id. private이면 NULL
  owner_user_id   uuid  NULL,                  -- private 트리의 소유자
  position        text  NOT NULL,              -- fractional index ('a0','a0V','a1'). 형제 정렬
  properties      jsonb NOT NULL DEFAULT '{}', -- title 포함(rich text 배열)
  created_at timestamptz, created_by uuid,
  last_edited_at timestamptz, last_edited_by uuid,
  -- 삭제는 3상태 머신: active → trashed(휴지통) → purged(복구 가능 retention) → hard-deleted
  trashed_at  timestamptz NULL,                -- NOT NULL이면 휴지통. UI의 Delete
  trashed_by  uuid NULL,
  purged_at   timestamptz NULL,                -- 휴지통에서 "영구 삭제"된 시각(수동 또는 기간 경과)
  hard_delete_after timestamptz NULL,          -- purged_at + retention(기본 30d, Enterprise 1d~10y)
  deleted_root_id uuid NULL                    -- 서브트리 삭제의 시발점. 부분 복원 판단용
);
-- 아래 문서에서 쓰는 deleted_at 은 편의 표기다. 실제로는
--   CREATE VIEW live_block AS SELECT * FROM block WHERE trashed_at IS NULL AND purged_at IS NULL;
-- 를 두고 모든 일반 조회가 이 뷰만 보게 강제하는 편이 필터 누락을 원천 차단한다.
CREATE INDEX ON block(parent_id, position) WHERE trashed_at IS NULL AND purged_at IS NULL;
CREATE INDEX ON block(workspace_id, type)  WHERE trashed_at IS NULL AND purged_at IS NULL;

-- 2) 페이지 전용 확장 (블록 행 비대화 방지)  [추정: 노션 내부 분리 여부는 비공개]
page_meta (
  block_id uuid PK REFERENCES block(id) ON DELETE CASCADE,
  slug_id  text UNIQUE,               -- URL 짧은 식별자
  icon_type text, icon_value text,    -- 'emoji'|'external'|'file'|'custom_emoji'|'icon'
  cover_type text, cover_url text,
  cover_position numeric DEFAULT 0.5, -- 0~1 세로 크롭 오프셋
  font       text    DEFAULT 'default',  -- 'default'|'serif'|'mono'
  small_text boolean DEFAULT false,
  full_width boolean DEFAULT false,
  locked     boolean DEFAULT false, locked_by uuid, locked_at timestamptz,
  show_backlinks boolean DEFAULT true,
  show_comments  boolean DEFAULT true,
  is_public  boolean DEFAULT false, public_url text,
  -- wiki / 페이지 검증 (F-02-23)
  is_wiki    boolean DEFAULT false,             -- "Turn into wiki"로 변환된 페이지
  verified_at timestamptz NULL, verified_by uuid NULL,
  verification_expires_at timestamptz NULL      -- 30d / 90d / NULL(무기한)
);
page_owner (block_id uuid, user_id uuid, PRIMARY KEY(block_id, user_id));  -- wiki 하위 페이지의 owner

-- 3) 권한. 명시 항목이 없으면 parent_id를 타고 올라가 해석
permission (
  id uuid PK,
  block_id uuid REFERENCES block(id),
  subject_type text,   -- 'user'|'group'|'teamspace'|'workspace'|'public'
  subject_id   uuid NULL,
  level        text,   -- 'full_access'|'edit'|'edit_content'|'create'|'comment'|'view'|'none'
  UNIQUE(block_id, subject_type, subject_id)
);

-- 4) 사용자별 즐겨찾기
favorite (
  user_id uuid, workspace_id uuid, block_id uuid,
  position text NOT NULL, created_at timestamptz,
  PRIMARY KEY(user_id, block_id)
);

-- 5) 백링크 역인덱스 (mention / link_to_page 파싱 결과)
page_link (
  source_block_id uuid,   -- 링크를 품은 블록
  source_page_id  uuid,   -- 그 블록이 속한 페이지(표시용)
  target_page_id  uuid,
  link_kind       text,   -- 'mention'|'link_to_page_block'|'inline_url'
  PRIMARY KEY(source_block_id, target_page_id, link_kind)
);
CREATE INDEX ON page_link(target_page_id);

-- 6) teamspace
teamspace (
  id uuid PK, workspace_id uuid, name text, icon text, description text,
  access text,          -- 'open'|'closed'|'private'
  is_default boolean,   -- 워크스페이스 전원 자동 가입
  default_page_permission text
);
teamspace_member (teamspace_id uuid, user_id uuid, role text);  -- 'owner'|'member'

-- 7) 워크스페이스와 멤버십 (F-02-17)
workspace (
  id uuid PK, name text, icon text, domain text NULL,
  plan text,                              -- 'free'|'plus'|'business'|'enterprise'
  trash_retention_days   int DEFAULT 30,  -- 휴지통 체류 기간 (Enterprise만 1~3650 커스텀)
  purge_retention_days   int DEFAULT 30,  -- "영구 삭제" 후 복구 가능 기간
  version_history_days   int,             -- 7 / 30 / 무제한(NULL)
  public_sharing_enabled boolean DEFAULT true
);
workspace_member (
  workspace_id uuid, user_id uuid,
  role text,                              -- 'owner'|'membership_admin'|'member'|'guest'
  PRIMARY KEY(workspace_id, user_id)
);

-- 8) 페이지 버전 스냅샷 (F-02-19)
page_version (
  id uuid PK, page_id uuid, created_at timestamptz,
  editors uuid[],            -- 이 스냅샷 구간의 편집자 집합
  snapshot bytea,            -- 서브트리 블록 스냅샷(JSON) 또는 Y.js update 스트림
  kind text                  -- 'auto'|'restore'|'manual'
);
CREATE INDEX ON page_version(page_id, created_at DESC);

-- 9) 공유 링크 / 웹 게시 (F-02-18)
share_link (
  id uuid PK, block_id uuid, token text UNIQUE,
  audience text,             -- 'workspace'|'anyone_with_link'
  level    text,             -- 'view'|'comment'|'edit'
  allow_duplicate boolean DEFAULT true, search_indexed boolean DEFAULT false,
  expires_at timestamptz NULL, created_by uuid, revoked_at timestamptz NULL
);

-- 10) 사이드바 보조 엣지: link_to_page 블록이 만드는 "표시상의 자식" (F-02-13, I6)
--     소유 엣지(block.parent_id)와 절대 섞지 않는다. 권한은 언제나 target의 원 위치로 해석한다.
sidebar_alias (
  source_block_id   uuid PK,   -- link_to_page 블록 자신
  container_page_id uuid,      -- 이 블록이 놓인 페이지 (사이드바에서 부모처럼 보임)
  target_page_id    uuid
);
CREATE INDEX ON sidebar_alias(container_page_id);

-- 11) 비동기 잡 (복제·크로스 워크스페이스 이동·export·purge·권한 재계산 공용)
job (
  id uuid PK, kind text,       -- 'duplicate'|'move'|'export'|'import'|'purge'|'permission_recalc'
  payload jsonb, state text,   -- 'queued'|'running'|'done'|'failed'
  progress numeric, error text, created_by uuid, created_at timestamptz
);
```

### 핵심 불변식 (invariants)

| # | 불변식 | 근거 |
|---|--------|------|
| I1 | 모든 블록은 parent를 **정확히 하나** 가진다(루트 제외) | Notion 데이터 모델 블로그: "single parent block ID (upward pointer)" |
| I2 | 권한 확인은 parent 체인을 루트까지 올라가며 수행한다 | 같은 출처: "traverses ancestors up to the workspace root" |
| I3 | 형제 순서는 fractional index로 정하며 삽입/이동 시 형제 일괄 갱신이 없다 | Docmost 구현 (`generateJitteredKeyBetween`) |
| I4 | 페이지 삭제·이동·복제·권한 변경은 **서브트리 전체**에 적용된다 | Notion help: "When you move top-level pages, all their sub-pages go with them" |
| I5 | `parent_id` 변경 시 사이클 금지(자기 자신의 자손으로 이동 불가) | `[추정]` — UI에서 차단되나 문서에 명시 없음 |
| I6 | `link_to_page`는 소유 엣지가 아니라 **표시용 보조 엣지**다. 사이드바에는 자식으로 보이지만 대상 페이지의 실제 위치·권한은 바뀌지 않는다 | Notion help: "it will show up in your sidebar as a subpage of the page where it was linked" — 이동/권한 변경은 어디에도 언급되지 않음 |
| I7 | 삭제는 **2단계**다: 휴지통(기본 30일) → 영구 삭제 후 retention(기본 30일) → 완전 소멸 | Notion help: "pages will remain in Trash for 30 days before they are permanently deleted... Once pages are permanently deleted from Trash, they are retained for 30 days" |
| I8 | 페이지 중첩 깊이에 **제품이 명시한 상한이 없다** | Notion help: "nest pages inside each other for infinite levels of organization". 단 공개 API는 1회 요청당 2단계 중첩 제약 `[확인필요]` |
| I9 | 한 페이지가 **사이드바에 여러 번 나타날 수 있다**(원 위치 + link_to_page가 만든 alias N개). 그러나 소유 parent는 여전히 하나다(I1 불변) | I1 + I6의 논리적 귀결 `[추정]` |

---

## 기능 명세

### F-02-01 페이지 = 블록 (page-as-block)

- **한 줄 정의**: 페이지를 별도 엔티티가 아니라 `type='page'`인 블록으로 다뤄, 페이지가 본문 안에 인라인으로 존재하면서 다른 블록과 동일하게 이동/복사/삭제되게 한다.
- **사용자 시나리오**: 본문에서 `/page` 입력 → "Page" 선택 → 인라인 페이지 블록 생성 → 제목 입력 후 Enter → 클릭하면 전체 화면 페이지로 열림. 그 페이지 블록을 드래그해 문단 사이로 옮길 수 있고, 텍스트 블록처럼 backspace로 삭제된다.
- **동작 상세**:
  - 새 페이지 블록의 기본값: `properties.title = []`(UI 표기 "Untitled"), `icon = null`, `cover = null`, 자식 없음.
  - 텍스트 블록을 `Turn into → Page`로 변환하면 **원래 텍스트가 새 페이지의 title로 이동**하고 원 자리에는 페이지 블록이 남는다.
  - Notion API에서 자식 페이지는 `child_page` 블록 타입으로 노출된다. `child_page` 블록은 직접 생성할 수 없고 "해당 부모를 지정해 페이지를 생성"함으로써 만들어진다.
  - 자식을 가질 수 있는 블록 타입은 page 외에도 toggle, callout, column, quote, to_do, list item, synced_block, table 등 다수. 즉 트리는 페이지 전용이 아니라 블록 일반의 성질이다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 제목 빈 값 | 사이드바/목록에 "Untitled". slug는 id만 사용 |
  | 페이지 안 페이지 무한 중첩 | 허용. 자식 페이지 본문은 열기 전까지 로드하지 않음(lazy) |
  | 동시편집: A는 페이지 블록 삭제, B는 제목 수정 | 삭제 우선(tombstone), B의 편집은 휴지통 상태 페이지에 반영 `[추정]` |
  | 페이지 블록 복사/붙여넣기 | 붙여넣기는 새 id를 가진 사본 생성(참조 공유 아님) `[확인필요]` |
  | 권한 없는 자식 페이지 | 부모 본문에서 제목 숨김 + 접근 불가 플레이스홀더 렌더 `[추정]` |
  | 페이지 블록만 있고 본문 0개 | 정상. 빈 페이지도 유효 |
- **데이터 모델 함의**: 위 `block` 테이블 하나로 페이지·문단을 모두 표현하고, 페이지 전용 속성은 `page_meta`로 분리. `type='page'`인 행만 사이드바 트리에 등장한다. `properties.title`은 문자열이 아니라 rich text 배열이어야 멘션·서식이 제목에 들어갈 수 있다.
- **UI/인터랙션**: `/page` 슬래시 커맨드, 블록 좌측 ⠿ 드래그 핸들, 호버 시 열기 화살표, `cmd/ctrl+클릭` 또는 shift+클릭으로 peek(사이드 패널) 열기.
- **의존 기능**: 블록 에디터(도메인 01), 블록 타입 변환.
- **구현 난이도**: **L** — 에디터 블록 모델과 라우팅 가능한 문서 모델을 같은 테이블로 통합해야 하고, "본문 속 인라인 표시"와 "독립 문서 렌더" 두 경로가 동시에 필요하다.
- **우선순위**: **P0** — 이 도메인 전체가 여기서 파생된다.
- **클론 시 현실적 대안**: MVP에서는 `pages` 테이블과 `blocks` 테이블을 분리하고, `blocks.type='child_page'` 행이 `pages.id`를 FK로 참조하게 한다(Docmost 방식). 페이지를 문단 사이로 자유롭게 드래그하는 자유도는 떨어지지만, 라우팅·권한·트리 쿼리가 훨씬 단순해진다.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion , https://developers.notion.com/reference/block

---

### F-02-02 무한 중첩 페이지 트리 (nested page tree)

- **한 줄 정의**: 페이지가 페이지를 자식으로 가져 깊이 제한 없는 계층을 만들고, 사이드바·breadcrumb·권한이 모두 이 계층을 따른다.
- **사용자 시나리오**: 사이드바에서 페이지 A 호버 → `▸` 클릭해 자식 목록 펼침 → `+` 클릭 → A의 자식 페이지 생성 → 제목 입력. 페이지 B를 드래그해 A 항목 중앙에 놓으면 A의 자식이 되고, 항목 사이 경계에 놓으면 형제 순서만 바뀐다. 다시 드래그해 밖으로 빼면 상위로 승격된다.
- **동작 상세**:
  - 깊이 제한: 공식 문서는 상한을 명시하지 않고 "nest pages inside each other for infinite levels of organization"이라고 기술한다. 즉 **제품 차원의 상한은 없다**(2026-09 재확인). 다만 공개 API는 한 요청에서 2단계 중첩까지만 만들 수 있어 깊은 트리는 재귀 호출로 쌓아야 한다 `[확인필요]` — 이 API 제약은 커뮤니티 보고 기준이며 공식 레퍼런스에 수치로 명시되어 있지 않다.
  - 클론에서는 **깊이를 무제한으로 두되 재귀 쿼리에 하드 가드(예: 100)를 걸고**, 가드에 걸리면 에러 대신 "경로 축약"으로 degrade시키는 편이 안전하다(breadcrumb·권한 조회가 깊이 때문에 실패하면 페이지 자체가 안 열린다).
  - 드롭 존 3종: 항목 상단 절반 = 앞 형제 삽입, 하단 절반 = 뒤 형제 삽입, 중앙 = 자식 편입.
  - 자식으로 편입되면 부모의 권한을 상속하고 부모의 teamspace/private 소속을 따라간다.
  - 사이드바 섹션별로 정렬 방식(Manual / Last edited)과 표시 개수를 설정할 수 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 자기 자신 또는 자손 위로 드래그 | 드롭 존 비활성화, 서버에서도 거부(I5) |
  | 자식 1,000개 | 사이드바는 지연 로드 + 표시 개수 제한 + "Show more" |
  | 동시에 두 사용자가 같은 페이지를 다른 부모로 이동 | `parent_id`는 last-write-wins, position 재계산. 결과가 사이클이면 서버 거부 `[추정]` |
  | 깊이 100단계 | 재귀 CTE에 `depth < N` 가드 필수(무한 루프·스택 폭발 방어) |
  | 부모가 휴지통에 있음 | 자식도 조회에서 함께 제외 |
  | 형제 position 충돌(같은 값) | `(position, id)` 복합 정렬로 결정론 보장 |
- **데이터 모델 함의**: 인접 리스트 `block(parent_id, position)` + fractional index. 조상 조회는 재귀 CTE:
  ```sql
  WITH RECURSIVE anc AS (
    SELECT id, parent_id, title, 0 AS depth FROM block WHERE id = $1
    UNION ALL
    SELECT b.id, b.parent_id, b.title, anc.depth + 1
    FROM block b JOIN anc ON b.id = anc.parent_id
    WHERE anc.depth < 100
  ) SELECT * FROM anc ORDER BY depth DESC;
  ```
  서브트리 조회는 반대 방향 재귀. 선택적으로 `path ltree` 또는 `ancestor_ids uuid[]` materialized path를 병행하면 breadcrumb·권한 조회가 O(1)이 되지만, 이동 시 서브트리 전체 갱신 비용이 생긴다.
- **UI/인터랙션**: 사이드바 `▸`/`▾` 토글(펼침 상태는 사용자별 저장), `+` 자식 추가, 드래그 앤 드롭, 우클릭 컨텍스트 메뉴.
- **의존 기능**: F-02-01, F-02-03, F-02-12.
- **구현 난이도**: **L** — 트리 자체는 M이지만 드래그 드롭 + fractional index + 사이클 방지 + 권한 재해석이 함께 얽힌다.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: 인접 리스트 + `fractional-indexing` npm 패키지로 시작. materialized path는 breadcrumb/검색 성능 문제가 실제로 관측된 뒤 추가한다.
- **참고 출처**: https://www.notion.com/help/navigate-with-the-sidebar , https://deepwiki.com/docmost/docmost/4-page-management

---

### F-02-03 사이드바 네비게이션

- **한 줄 정의**: 워크스페이스의 페이지 트리와 주요 진입점(검색/홈/받은편지함/휴지통/설정)을 좌측 고정 패널에 노출한다.
- **사용자 시나리오**: `cmd/ctrl + \` 로 사이드바 토글 → 섹션 헤더(Favorites / Teamspaces / Shared / Private) 클릭으로 접기·펴기 → 페이지 호버 시 `+`(자식 추가)와 `•••`(액션 메뉴) 노출 → `•••`에서 Delete / Duplicate / Copy link / Rename / Move to / Add to Favorites 선택 → 사이드바 우측 경계를 드래그해 폭 조절 → `<<` 로 전체 접기.
- **동작 상세** (2026-03-26 Notion 3.4 재편 이후 기준):
  - 사이드바 최상위가 **4개 탭**으로 나뉜다: **Home / Chats(AI 에이전트 대화) / Meetings / Inbox(구 Updates)**. 릴리스 노트: "The sidebar was getting far too crowded. So we organized it into four new tabs, with easy access to your pages, agent chats, meetings, and notifications." 검색은 별도 진입점(`cmd/ctrl+K` 또는 `cmd/ctrl+P`), 워크스페이스 스위처는 좌상단 워크스페이스 이름.
  - **페이지 트리는 Home 탭이 담는다.** 3.4 이전 Home은 전체 화면 대시보드였으나 사이드바 안 섹션 묶음으로 들어왔다. Home 탭 섹션: Upcoming events → Recents → Favorites → Agents → Teamspaces → Shared → Private.
  - Home 탭 하단 고정: My Tasks, Library, Marketplace, Help, **Trash**.
  - **섹션 자체를 켜고 끌 수 있고, 드래그로 섹션 순서를 바꿀 수 있다.** 섹션별 정렬(Manual / Last edited)과 표시 개수(5개 ~ 전체)도 사용자가 정한다. Favorites 섹션은 첫 즐겨찾기를 추가해야 나타난다.
  - Teamspaces 섹션은 Plus/Business/Enterprise 플랜에서만 노출된다.
  - **펼침/접힘·섹션 on/off·섹션 순서는 전부 개인(per-user) 상태**로 다른 멤버 뷰에 영향이 없다. 반면 **Teamspace 하위 페이지 배열 순서(position)는 전 멤버 공통**이다.
  - `[확인필요]` — 3.4 사이드바는 릴리스 시점에 opt-in("opt-in to try it out")으로 배포되어 구/신 사이드바가 병존한 기간이 있다. 클론은 신 구조만 따라도 무방하다.
  - **설계 시사점**: "섹션"은 하드코딩 목록이 아니라 **사용자별 구성 가능한 레지스트리**로 만들어야 한다(3.4가 정확히 이 방향으로 갔다). 섹션마다 `{key, enabled, order, sort_mode, item_limit}`를 갖는 per-user 레코드로 두면 이후 섹션 추가가 스키마 변경 없이 된다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 페이지 수천 개 | 섹션 지연 로드 + 가상 스크롤. 자식은 펼칠 때 fetch |
  | 다른 사용자가 트리 구조 변경 | WebSocket 브로드캐스트로 실시간 반영(Docmost도 동일 방식) |
  | 접근 권한 없는 페이지 | 사이드바에 렌더하지 않음(존재도 노출 금지) |
  | 오프라인 | 마지막 캐시 트리 표시, 변경은 큐잉 `[추정]` |
  | 제목 없는 페이지 | "Untitled" 표기 |
  | 사이드바 폭 최소/최대 | 최소/최대값으로 클램프, 값은 로컬 저장 |
  | 섹션을 off 한 상태에서 즐겨찾기 추가 | 섹션을 자동으로 다시 켜거나 토스트로 안내(사용자가 결과를 못 보는 상황 방지) `[추정]` |
  | 탭 전환(Home ↔ Inbox) 후 복귀 | 트리 펼침 상태·스크롤 위치 유지. 클라이언트 상태로 보관하되 새로고침 후에도 유지하려면 서버 저장 필요 |
  | 다른 기기에서 펼침 상태 변경 | per-user 상태를 서버에 두면 기기 간 동기화됨. 로컬 저장이면 기기별로 갈린다 — **어느 쪽인지 제품 결정 필요** `[확인필요]` |
- **데이터 모델 함의**:
  ```sql
  sidebar_state   (user_id, workspace_id, block_id, expanded boolean, PRIMARY KEY(user_id, block_id));
  sidebar_section (user_id, workspace_id, section_key text,   -- 'recents'|'favorites'|'teamspaces'|'shared'|'private'|...
                   enabled boolean DEFAULT true, position text, sort_mode text, item_limit int,
                   PRIMARY KEY(user_id, workspace_id, section_key));
  sidebar_pref    (user_id, workspace_id, width_px int, active_tab text);
  recent_visit    (user_id, block_id, visited_at timestamptz, PRIMARY KEY(user_id, block_id));  -- Recents 섹션(F-02-21)
  ```
  트리 API는 한 레벨씩: `GET /pages/tree?parent_id=<id>&limit=50`. 루트 요청 시 `parent_type IN ('workspace','teamspace')` + 권한 필터. 아이콘·제목·`has_children` 만 반환하고 본문은 절대 싣지 않는다(사이드바가 페이지 본문을 끌고 오면 즉시 성능이 무너진다).
- **UI/인터랙션**: `cmd/ctrl+\`(사이드바), `cmd/ctrl+K`(검색), 호버 `+`/`•••`, 드래그 이동, 경계 드래그 리사이즈.
- **의존 기능**: F-02-02, F-02-04, F-02-12.
- **구현 난이도**: **L** — 실시간 동기화되는 드래그 가능 가상 트리는 UI 난이도가 높다. Docmost는 react-arborist를 쓰다 v0.90.0에서 자체 트리 구현으로 교체할 만큼 까다로운 영역이다.
- **우선순위**: **P0**
- **클론 시 현실적 대안**: MVP는 가상화 없이 전체 트리 일괄 로드(페이지 500개 이하 가정) + `dnd-kit` 드래그. 실시간 동기화는 폴링 또는 mutation 후 invalidate로 시작.
- **참고 출처**: https://www.notion.com/help/navigate-with-the-sidebar , https://www.notion.com/releases/2026-03-26 , https://github.com/docmost/docmost/releases/tag/v0.90.0

---

### F-02-04 즐겨찾기 (Favorites)

- **한 줄 정의**: 사용자가 페이지를 개인적으로 고정해 사이드바 최상단 Favorites 섹션에서 바로 열 수 있게 한다.
- **사용자 시나리오**: 페이지 우상단 `☆` 클릭 → 사이드바 Favorites에 즉시 추가 → 다시 클릭하면 해제. 또는 사이드바 항목 호버 → `•••` → "Remove from Favorites".
- **동작 상세**:
  - **완전히 per-user**다. 같은 워크스페이스의 다른 멤버 사이드바에는 영향이 없다.
  - 즐겨찾기해도 **원래 위치에서 사라지지 않는다**. 페이지가 속한 Teamspace/Private 섹션에 그대로 남고 Favorites에 추가로 나타난다(참조 뷰).
  - 어느 teamspace에 있든 상관없이 Favorites 섹션에 모인다.
  - Favorites 항목도 자식 트리를 펼칠 수 있다. `[확인필요]`
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 즐겨찾기한 페이지가 휴지통으로 이동 | Favorites에서 숨김. 복원 시 재등장 `[추정]` |
  | 페이지 영구 삭제 | favorite 행 CASCADE 삭제 |
  | 해당 페이지 접근 권한 상실 | Favorites에서 제거 또는 비활성 표시 `[추정]` |
  | 같은 페이지 중복 즐겨찾기 | PK(user_id, block_id)로 멱등 처리 |
  | 즐겨찾기 500개 | 표시 개수 제한 + "Show more" |
  | 워크스페이스 전환 | `workspace_id` 필터로 해당 워크스페이스 것만 노출 |
- **데이터 모델 함의**: 위 `favorite` 테이블. 사이드바 조회 시 `favorite JOIN block` + 권한 필터 + `deleted_at IS NULL`.
- **UI/인터랙션**: 페이지 헤더 `☆` 토글, 사이드바 `•••` 메뉴, Favorites 내부 드래그 정렬.
- **의존 기능**: F-02-03.
- **구현 난이도**: **S** — 조인 테이블 + 토글 버튼이면 하루 내.
- **우선순위**: **P0** — 비용 대비 네비게이션 체감이 크다.
- **클론 시 현실적 대안**: 원본 그대로 구현 가능. 정렬만 `created_at DESC`로 시작해도 무방.
- **참고 출처**: https://www.notion.com/help/navigate-with-the-sidebar , https://www.notion.com/help/guides/how-to-use-and-customize-the-sidebar-with-teamspaces

---

### F-02-05 페이지 아이콘

- **한 줄 정의**: 페이지마다 이모지 또는 이미지 아이콘을 지정해 사이드바·breadcrumb·멘션·링크 프리뷰에서 시각적으로 식별되게 한다.
- **사용자 시나리오**: 페이지 상단 호버 → "Add icon" 클릭 → (a) 랜덤 버튼으로 이모지 순환, (b) Emoji 탭에서 검색·선택, (c) Icon 탭에서 라인 아이콘 선택 후 색상 지정, (d) Upload 탭에서 이미지 업로드 또는 URL 입력 → 아이콘 클릭 시 같은 피커 재오픈, "Remove"로 제거.
- **동작 상세**:
  - Notion API 기준 icon은 `emoji`, `external`(URL), `file`(업로드), `custom_emoji`, `icon`(내장 아이콘) 중 하나의 shape를 가진다.
  - 지정된 아이콘은 페이지 제목 위, 사이드바 항목 앞, breadcrumb, `@`멘션 인라인, 링크 프리뷰, 검색 결과에 모두 동일하게 표시된다.
  - 아이콘 미지정 시 기본 문서 아이콘(회색 페이지 글리프)이 대체 표시된다.
  - 업로드 이미지는 정사각 크롭·리사이즈된다. `[확인필요]` — 정확한 크롭 규칙.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 아이콘 없음 | 기본 문서 글리프 폴백. `icon = null` 저장 |
  | 외부 URL 이미지가 404 | 깨진 이미지 대신 기본 글리프 폴백 `[추정]` |
  | 대용량 이미지 업로드 | 서버에서 리사이즈해 썸네일 생성. 원본은 별도 보관 |
  | 이모지 미지원 폰트/OS | 시스템 폰트 폴백. 트윙클리(Twemoji) 등 웹폰트 사용 권장 |
  | 페이지 복제 | 아이콘도 함께 복제(파일은 참조 공유 또는 재업로드) `[확인필요]` |
  | 권한 없는 사용자에게 노출 | 페이지 자체가 안 보이므로 아이콘도 노출되지 않음 |
- **데이터 모델 함의**: `page_meta.icon_type` + `icon_value`. 업로드 파일은 `file(id, block_id, storage_key, mime, size, uploaded_by)` 테이블로 분리해 스토리지 정리(GC)를 가능하게 한다. 아이콘은 사이드바에서 대량 렌더되므로 트리 조회 쿼리에 함께 실려야 한다(N+1 금지).
- **UI/인터랙션**: 페이지 상단 호버 시 "Add icon" 버튼, 아이콘 클릭 → 피커 팝오버, 랜덤 버튼, 드래그 앤 드롭 이미지 업로드.
- **의존 기능**: F-02-01, 파일 업로드/스토리지.
- **구현 난이도**: **M** — 이모지 피커·아이콘 세트·업로드 파이프라인 3가지가 필요. 이모지만이면 S.
- **우선순위**: **P1** — MVP 기능은 아니나 트리 식별성에 기여가 커서 사실상 초기 구현 권장.
- **클론 시 현실적 대안**: 1단계는 이모지 전용(`emoji-mart` 라이브러리, 값은 유니코드 문자열 1개). 이미지 업로드와 내장 아이콘 세트는 v1로 미룸.
- **참고 출처**: https://www.notion.com/help/guides/page-icons-and-covers , https://developers.notion.com/reference/page

---

### F-02-06 페이지 커버 이미지

- **한 줄 정의**: 페이지 최상단에 배너 이미지를 붙이고 세로 위치를 조정할 수 있게 한다.
- **사용자 시나리오**: 페이지 상단 호버 → "Add cover" 클릭 → 랜덤 커버 자동 적용 → 커버 위 호버 → "Change cover" 클릭 → 갤러리/Upload/Link/Unsplash 탭 중 선택 → "Reposition" 클릭 후 상하 드래그로 크롭 위치 조정 → "Save position" → "Remove"로 제거.
- **동작 상세**:
  - 커버 소스: 기본 제공 갤러리(그라디언트/컬러), 업로드, 외부 URL, Unsplash 검색 `[확인필요]` (Unsplash 통합 현행 여부).
  - Reposition은 이미지의 세로 오프셋만 조정한다(가로는 항상 100% fill). 값은 0~1 비율로 저장. `[추정]` — 정확한 저장 형식은 비공개.
  - Full width 설정(F-02-07)과 무관하게 커버는 항상 콘텐츠 폭보다 넓은 전체 폭 배너로 렌더된다. `[확인필요]`
  - API의 cover는 File object이며 `type`은 `external` 또는 `file_upload`다(2026-09 레퍼런스 기준. 과거의 `file` 표기와 다름).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 커버 없음 | 헤더 영역 미표시, 제목이 상단에 붙음 |
  | 세로로 긴 이미지 | 고정 높이(약 30vh)로 크롭. reposition으로 보정 |
  | 이미지 로딩 실패 | 회색/그라디언트 플레이스홀더 `[추정]` |
  | 대용량(10MB+) 업로드 | 서버 리사이즈 + 용량 제한 안내 |
  | 모바일 뷰 | 커버 높이 축소, reposition UI 비노출 `[추정]` |
  | 페이지 복제 | 커버·position 함께 복제 |
- **데이터 모델 함의**: `page_meta.cover_type/cover_url/cover_position`. 업로드 파일은 F-02-05와 같은 `file` 테이블 재사용. 사이드바 트리 조회에는 커버가 불필요하므로 **커버는 페이지 상세 조회에서만 로드**한다.
- **UI/인터랙션**: 상단 호버 "Add cover", 커버 호버 시 "Change cover"/"Reposition" 버튼, 드래그로 세로 조정.
- **의존 기능**: F-02-01, 파일 업로드/스토리지.
- **구현 난이도**: **M** — 업로드 + 크롭 리포지션 UI + 반응형 렌더.
- **우선순위**: **P2** — 기능적 가치보다 시각적 가치가 커서 MVP 이후.
- **클론 시 현실적 대안**: 1단계는 미리 준비한 그라디언트/단색 커버 세트 8~12종만 제공(업로드 없음, `cover_type='gradient'`). reposition은 v2.
- **참고 출처**: https://www.notion.com/help/guides/page-icons-and-covers , https://developers.notion.com/reference/page

---

### F-02-07 페이지 레이아웃 설정 (font / small text / full width)

- **한 줄 정의**: 페이지 단위로 서체, 본문 텍스트 크기, 콘텐츠 영역 폭을 전환한다.
- **사용자 시나리오**: 페이지 우상단 `•••` 클릭 → 상단 폰트 3종(Default / Serif / Mono) 중 하나 클릭 → 아래 "Small text" 토글 → "Full width" 토글 → 메뉴 닫으면 즉시 반영.
- **동작 상세**:
  - 공식 문서: "Choose from three different typography styles for every page" — Default(산세리프), Serif, Mono.
  - Small text: 페이지 전체 텍스트 크기를 한 단계 축소.
  - Full width: 좌우 마진을 줄여 콘텐츠 영역을 넓힘. 기본은 고정 폭(약 900px 안팎) `[확인필요]` — 정확한 px 값.
  - 같은 `•••` 메뉴의 "Customize page"에서 **Show backlinks** 및 **Page discussions(댓글) 표시 여부**를 페이지별로 켜고 끌 수 있다(데이터베이스 페이지는 "Customize layout" 경로).
  - **워크스페이스/계정 전체 기본값은 설정할 수 없다.** 공식 FAQ가 "Can I make Full width my default? / Is there a way to set a default style for all pages?"에 "Not yet, but a lot of users have asked for this!"라고 답한다. 즉 값은 **페이지 단위로만** 존재한다.
  - 이 값이 페이지 속성(모든 열람자 공통)인지 열람자별 설정인지는 **공식 문서 어디에도 명시가 없다** `[확인필요]`. 2026-09 재조사에서 헬프 문서를 다시 읽었으나 어느 쪽도 단정하지 않았고, 위 "전 페이지 기본값 없음" FAQ는 이 질문의 답이 아니다. **이전 판이 "페이지 속성이라 모두에게 동일"이라고 단정한 것은 근거가 없어 철회한다.**
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 자식 페이지 | 부모 설정을 상속하지 않고 각 페이지가 독립적으로 기본값을 가짐 `[추정]` |
  | 읽기 전용 권한 사용자 | 설정 변경 불가(메뉴 항목 비활성) |
  | 잠긴 페이지(F-02-10) | 레이아웃 설정도 변경 불가 `[확인필요]` |
  | 모바일 | Full width가 사실상 무의미(항상 화면 폭) — 토글 숨김 또는 무시 |
  | 서체 웹폰트 로딩 실패 | 시스템 폴백 스택 적용 |
  | Full width + 넓은 표/이미지 | 콘텐츠는 컨테이너 내부에서 가로 스크롤 |
- **데이터 모델 함의**: 기본은 `page_meta.font`, `small_text`, `full_width`, `show_backlinks`, `show_comments`(페이지 공통 값). 페이지 상세 응답에 실어 CSS 변수(`--page-font`, `--page-max-width`, `--text-scale`)로 매핑한다.
  - 위 `[확인필요]`가 어느 쪽으로 판명되든 흡수할 수 있게, **읽기 시 병합 규칙을 먼저 정의**해 두는 것이 안전하다: `effective = COALESCE(page_view_pref(user, page), page_meta(page), workspace_default)`. per-user 오버라이드용 `page_view_pref(user_id, page_id, font, small_text, full_width)`는 테이블만 만들어 두고 UI를 나중에 붙이면 스키마 변경 없이 전환된다.
  - `show_backlinks` / `show_comments`는 성격상 명백히 **페이지 공통**이다(개인이 끄면 다른 사람의 백링크 계산에 영향이 없어야 하므로 per-user로 둬도 무해하지만, 노션 UI는 페이지 메뉴에 둔다).
- **UI/인터랙션**: `•••` 메뉴 상단 폰트 3버튼, 토글 스위치 2개, "Customize page" 서브메뉴.
- **의존 기능**: F-02-01.
- **구현 난이도**: **S** — 불리언 2개 + enum 1개와 CSS 변수 스위칭. per-user 오버라이드까지 넣어도 병합 함수 하나가 늘 뿐이라 S를 유지한다.
- **우선순위**: **P2** — 없어도 제품이 성립. 단 구현 비용이 매우 낮아 조기 투입 가능.
- **클론 시 현실적 대안**: 원본 그대로 구현. 폰트는 웹폰트 2종(serif/mono)만 추가하면 충분.
- **참고 출처**: https://www.notion.com/help/customize-and-style-your-content

---

### F-02-08 페이지 이동 (Move to)

- **한 줄 정의**: 페이지를 서브트리째 다른 부모 페이지, 다른 teamspace, Private, 또는 다른 워크스페이스로 옮긴다.
- **사용자 시나리오**: 사이드바에서 페이지 호버 → `•••` → "Move to" → 검색 가능한 대상 선택 팝업 열림 → 목적지 페이지/teamspace/Private 입력 후 선택 → 이동 완료 후 사이드바에서 위치 변경 확인. 팝업 하단 드롭다운으로 다른 워크스페이스를 고를 수 있다. 사이드바 드래그 앤 드롭도 같은 연산이다.
- **동작 상세**:
  - **자식 전체가 함께 이동한다**: "When you move top-level pages, all their sub-pages go with them."
  - 다른 워크스페이스로 이동하면 대상 워크스페이스의 **Private 섹션**에 도착하며, 이후 원하는 곳으로 재이동한다.
  - 이동 시 새 부모의 권한을 상속한다. 단 **하위 페이지에 개별 설정된 권한은 유지**된다: "Moving a shared page to Private removes access for others (excluding subpage permissions, which remain unchanged)."
  - 이동 후에도 페이지 id는 유지되므로 기존 링크·백링크·URL은 깨지지 않는다. `[추정]` — id 기반 URL이므로 논리적으로 유지되나 문서 명시 없음.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 자기 자신/자손으로 이동 | 차단(I5). 대상 선택 목록에서 자손 제외 |
  | 공유 페이지를 Private로 이동 | 타인의 접근 권한 소멸. 단 서브페이지 개별 권한은 유지 |
  | 다른 워크스페이스로 이동 | 멤버·게스트 참조가 대상 워크스페이스에 없으면 멘션이 깨질 수 있음 `[확인필요]` |
  | 이동 대상에 쓰기 권한 없음 | Move to 목록에 나타나지 않음 |
  | 서브트리 10,000 페이지 | 트랜잭션 시간 초과 위험 → 백그라운드 잡 + 진행 표시 필요 |
  | 이동 중 다른 사용자가 그 페이지 편집 | 편집은 그대로 유효(내용 변경과 위치 변경은 독립) |
  | 잠긴 페이지 | 이동은 가능 `[확인필요]` |
- **데이터 모델 함의**: `UPDATE block SET parent_id=?, parent_type=?, space_id=?, owner_user_id=?, position=? WHERE id=?` + **서브트리 전체의 `space_id`/`workspace_id` 전파**가 필요하다(권한 스코프 컬럼을 비정규화했다면). 워크스페이스 간 이동은 별도 마이그레이션 잡: 첨부파일 재배치, 멘션 대상 재매핑까지 포함.
  ```sql
  -- 서브트리 space 전파
  WITH RECURSIVE sub AS (
    SELECT id FROM block WHERE id = $moved
    UNION ALL SELECT b.id FROM block b JOIN sub ON b.parent_id = sub.id
  ) UPDATE block SET space_id = $new_space WHERE id IN (SELECT id FROM sub);
  ```
- **UI/인터랙션**: `•••` → Move to, 검색형 목적지 피커, 워크스페이스 드롭다운, 사이드바 드래그 앤 드롭. `[확인필요]` — 전용 단축키 존재 여부.
- **의존 기능**: F-02-02, F-02-12(권한 컨테이너), F-02-03.
- **구현 난이도**: **L** — 단일 UPDATE로 끝나지 않고 서브트리 스코프 전파 + 권한 재해석 + 크로스 워크스페이스 마이그레이션이 붙는다.
- **우선순위**: **P0** — 트리를 만들면 재구성 수단이 반드시 필요하다.
- **클론 시 현실적 대안**: MVP는 **같은 워크스페이스 내 이동만** 지원(부모 변경 + 서브트리 space 전파). 크로스 워크스페이스 이동은 "Export → Import"로 대체.
- **참고 출처**: https://www.notion.com/help/navigate-with-the-sidebar , https://www.notion.com/help/sharing-and-permissions , https://www.notion.com/help/transfer-content-to-another-account

---

### F-02-09 페이지 복제 (Duplicate)

- **한 줄 정의**: 페이지와 그 하위 트리 전체를 새 id를 가진 사본으로 만들어 원본 옆(또는 지정 위치)에 배치한다.
- **사용자 시나리오**: 사이드바에서 페이지 호버 → `•••` → "Duplicate" → "Untitled (1)" 형태의 사본이 **원본 바로 아래 형제로** 생성됨. 또는 페이지 우상단 `•••` → Duplicate. 다른 워크스페이스로 복제하려면 "Duplicate to" 사용. `[확인필요]` — "Duplicate to" 메뉴 현행 존재 여부.
- **동작 상세**:
  - **딥 카피**: 자식 페이지·블록 전체가 새 id로 복제된다(Docmost: "Deep-copying a page and its entire subtree, including attachment mapping").
  - 새 사본의 position은 원본 바로 뒤에 오도록 fractional index로 계산한다(동일 space일 때). 다른 space로 복제하면 목록 끝에 배치.
  - 복제본에는 원본의 icon/cover/font/full_width가 함께 복사되고, **권한은 복제 대상 위치의 부모 권한을 새로 상속**한다. `[추정]`
  - **공식 헬프에 페이지 복제 동작이 문서화되어 있지 않다** (2026-09 재확인). 이전 판이 근거로 달았던 `duplicate-delete-and-restore-content`는 현재 "Delete & restore content"로, 본문에 duplicate 설명이 없다 — **잘못된 인용이었으므로 정정한다.** 복제 동작에 대한 아래 서술은 2차 출처와 관찰 기반이다.
  - 내부 링크 재매핑: 2차 출처들은 일관되게 "복제 범위 **밖**을 가리키던 멘션은 계속 원본을 가리킨다"고 기술한다. 복제 범위 **안**의 상호 링크가 사본으로 재매핑되는지는 어떤 출처도 확언하지 않는다 `[확인필요]`. **우세 가설: 노션은 재매핑하지 않는다**(사본 A'의 링크가 여전히 원본 B를 가리킨다).
  - 클론 설계 결론: 원본 동작을 그대로 따르지 말고 **"서브트리 내부 링크 → 사본 내부로 재매핑, 외부 링크 → 원본 유지"를 고정 규칙으로** 삼는 편이 템플릿 용도에서 예측 가능하다(의도적으로 원본보다 나은 동작을 택하는 지점).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 서브트리 수천 페이지 | 동기 처리 불가 → 백그라운드 잡 + "복제 중" 표시 |
  | 첨부파일 포함 | 스토리지 객체를 새로 복사하거나 참조 카운트 증가 방식 중 선택 |
  | 서브트리 내부 상호 링크 | 사본 내부로 재매핑(권장). 외부 링크는 원본 대상 유지 |
  | 순환 링크 | 링크 재매핑 시 방문 집합으로 무한루프 방지 |
  | 권한 없는 자식 페이지 포함 | 해당 자식은 복제에서 제외 `[추정]` |
  | 동시 복제 2회 | 각각 별도 사본 생성. 제목 접미사 `(1)`, `(2)` 충돌 처리 |
- **데이터 모델 함의**: 재귀 복사 프로시저 — 서브트리를 순회하며 `old_id → new_id` 매핑 테이블을 만들고, 2패스로 (1) 블록 삽입 (2) 내부 참조(`page_link`, 멘션 rich text의 page id) 치환. 첨부는 `file` 테이블에 새 행 + storage_key 복사 또는 참조 공유.
- **UI/인터랙션**: `•••` → Duplicate, "Duplicate to"(대상 선택). `[확인필요]` — `cmd/ctrl+D` 단축키가 페이지 복제에도 적용되는지(블록 복제에는 적용됨).
- **의존 기능**: F-02-02, F-02-14(링크 재매핑).
- **구현 난이도**: **L** — 딥 카피 + id 재매핑 + 첨부 처리 + 비동기 잡. 단순 1레벨 복사면 M.
- **우선순위**: **P1** — 템플릿 실사용의 근간이지만 MVP 없이도 제품은 돈다.
- **클론 시 현실적 대안**: MVP는 **단일 페이지 얕은 복제**(자식 페이지 제외, 본문 블록만)로 시작. 딥 카피는 템플릿 기능 도입 시점에 함께 구현.
- **참고 출처**: https://www.notion.com/help/transfer-content-to-another-account (워크스페이스 간 복제/이동) , https://www.notion.com/help/duplicate-public-pages (공개 페이지 복제) , https://deepwiki.com/docmost/docmost/4-page-management (딥카피 + attachment mapping 구현). `[확인필요]` — 워크스페이스 내부 Duplicate 자체는 공식 헬프에 문서가 없다.

---

### F-02-10 페이지 잠금 (Lock page)

- **한 줄 정의**: 편집 권한이 있는 사용자에게도 실수 편집을 막기 위해 페이지를 읽기 전용으로 전환한다(권한이 아니라 안전장치).
- **사용자 시나리오**: 페이지 우상단 `•••` → "Lock page" 토글 켜기 → 상단 breadcrumb 옆에 "Locked" 배지 표시 → 본문 클릭 시 커서는 보이지만 입력·블록 이동·속성 변경 불가 → 잠금 해제는 "Unlock for me"(내 세션만) 또는 `•••`에서 토글 끄기(모두에게 해제).
- **동작 상세**:
  - 잠금 시: 타이핑 불가, 블록 이동 불가, 속성 변경 불가. 커서 표시는 유지된다.
  - **권한 대체가 아니다**: full access 또는 can edit 권한을 가진 **누구나** 잠금을 해제할 수 있다.
  - **Unlock for me**: 내 편집 세션 동안만 해제. 페이지를 떠나거나 새로고침하면 잠금이 자동 복원된다. 이때 breadcrumb 옆에 "Re-lock" 버튼이 나타난다.
  - **Unlock for everyone**: `•••`의 토글을 꺼서 잠금 자체를 해제. 다시 잠그려면 토글을 켠다.
  - 데이터베이스에는 별도의 "Lock database"가 있어, 잠기면 **데이터(행)는 편집 가능하지만 뷰와 속성 스키마는 편집 불가**하다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 자식 페이지 | 부모 잠금이 자식으로 전파되지 않음 `[확인필요]` |
  | 잠긴 페이지에 댓글 | 댓글은 허용되어야 자연스러움 `[추정]` |
  | 잠긴 상태에서 이동/삭제 | 사이드바 이동·삭제는 별개 경로로 허용 `[확인필요]` |
  | 동시편집 중 잠금 | 다른 사용자 세션에도 즉시 전파, 진행 중 입력은 커밋 후 차단 `[추정]` |
  | "Unlock for me" 후 브라우저 크래시 | 서버 상태는 여전히 locked이므로 재접속 시 잠김 |
  | view 권한자 | 애초에 편집 불가. 잠금 토글 비노출 |
- **데이터 모델 함의**: `page_meta.locked boolean` + `locked_by`, `locked_at`. **"Unlock for me"는 서버에 저장하지 않고 클라이언트 세션 상태**로 두는 것이 자연스럽다(새로고침 시 자동 복원 동작과 일치). 서버는 mutation 요청 시 `locked = true`면 거부(403 `PAGE_LOCKED`)해 클라이언트 우회를 막아야 한다.
- **UI/인터랙션**: `•••` → Lock page 토글, breadcrumb 옆 "Locked" 배지 및 "Re-lock" 버튼, 편집 시도 시 토스트 안내.
- **의존 기능**: F-02-01, 권한 모델.
- **구현 난이도**: **S** — 불리언 + 서버 가드 + 클라이언트 읽기 전용 모드.
- **우선순위**: **P2** — 협업 규모가 커지기 전엔 체감이 낮다.
- **클론 시 현실적 대안**: 원본대로 구현하되 "Unlock for me"는 생략하고 "잠금/해제" 토글만 제공. 서버 가드는 반드시 넣는다.
- **참고 출처**: https://www.notion.com/help/collaborate-within-a-workspace , https://www.notion.com/help/sharing-and-permissions

---

### F-02-11 휴지통과 복원 (soft delete / trash / restore)

- **한 줄 정의**: 페이지 삭제를 즉시 소멸이 아니라 **휴지통(기본 30일) → 영구 삭제 후 retention(기본 30일) → 완전 소멸**의 2단계 보존으로 처리하고, 원래 위치로 되돌릴 수 있게 한다.
- **사용자 시나리오**: 사이드바에서 페이지 호버 → `•••` → "Delete" (또는 페이지를 사이드바 하단 Trash로 드래그, 또는 페이지 블록 선택 후 Backspace/Delete) → 페이지가 사이드바에서 사라짐 → 사이드바 하단 "Trash" 클릭 → 검색으로 페이지 찾기 → 항목 옆 굽은 화살표(복원) 아이콘 클릭 → **마지막에 있던 위치로 복귀**. 또는 휴지통에서 개별 영구 삭제.
- **동작 상세**:
  - **보존은 2단계다.** 공식 문서 원문: "By default, pages will remain in Trash for 30 days before they are permanently deleted from Trash. Once pages are permanently deleted from Trash, they are retained for 30 days before they become inaccessible to all users, even workspace owners."
    | 단계 | 상태 | 기간(기본) | 누가 복구 가능 |
    |---|---|---|---|
    | ① | 휴지통(trashed) | 30일 | 접근 권한자가 UI에서 복원 |
    | ② | 영구 삭제됨(purged) — UI에서 안 보임 | 30일 | 워크스페이스 소유자/지원 경로 |
    | ③ | 완전 소멸(hard delete) | — | 아무도 불가 |
    **이전 판의 "30일 후 자동 영구 삭제로 끝"은 ②단계를 누락한 오류였으므로 정정한다.**
  - Enterprise 워크스페이스 소유자는 휴지통 체류 기간을 **1일 ~ 10년** 사이로 커스텀할 수 있다.
  - 부모를 휴지통에 넣으면 **자식 전체가 함께 조회에서 사라진다**(문서상 archive 동작 기준: "If you archive a parent page, all pages below are archived automatically").
  - 복원 시 "your page will return to where it was last in your workspace" — 즉 **원래 parent와 position이 보존**되어야 한다.
  - Notion API는 `archived`(deprecated) 대신 `in_trash` 불리언을 노출하며, 전용 "Trash a page" 엔드포인트가 있다.
  - 버전 히스토리(F-02-19)는 **별개 기능**이다 — 휴지통이 "페이지 존재의 복구"라면 버전 히스토리는 "내용의 복구"다. 플랜별 보존은 Free 7일 / Plus·Business 30일 / Enterprise 무제한 `[확인필요]`. **이전 판의 "Business 90일"은 2026-09 재조사에서 확인되지 않아 정정한다**(2차 출처 다수가 Plus·Business 모두 30일로 기술).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 부모가 이미 영구 삭제된 자식 복원 | 부모가 없으므로 top-level 또는 원 소유 컨테이너 루트로 복원 필요 |
  | 부모 복원 시 자식 | 함께 복원(서브트리 단위) |
  | 자식만 개별 복원 | 부모가 휴지통이면 부모까지 함께 복원하거나 루트로 승격 `[확인필요]` |
  | 휴지통 안에서 백링크 | 삭제된 페이지를 가리키던 링크는 "삭제됨" 상태로 렌더 `[추정]` |
  | 복원 위치의 position 충돌 | fractional index로 재계산해 삽입 |
  | 30일 경과 | 배치 잡이 물리 삭제 + 첨부 스토리지 GC |
  | 휴지통 스코프 | 삭제된 **위치 기준으로 분리**된다 — teamspace에서 지운 페이지는 그 teamspace의 휴지통에, private에서 지운 페이지는 개인 휴지통에 나타난다. `[확인필요]` — 2차 출처(Restora/Sparxno) 일치, 공식 헬프에는 명시 없음 |
  | "영구 삭제" 직후 복구 요청 | ②단계(기본 30일) 안이면 워크스페이스 소유자/지원 경로로 복구 가능. 그래서 purge 시각과 hard-delete 시각을 **분리 저장**해야 한다 |
  | 첨부파일 GC 타이밍 | ②단계에서는 스토리지 객체를 지우면 안 된다. GC는 ③단계 이후에만 수행 |
  | 삭제 직후 동시편집 세션 | 다른 사용자가 그 페이지를 열어둔 상태라면 서버가 mutation을 `410 GONE`으로 거부하고 클라이언트를 읽기 전용 + "휴지통으로 이동됨" 배너로 전환 `[추정]` |
  | 영구 삭제 후 복구 요청 | 공식적으로는 지원 문의를 통한 백업 스냅샷 복원(30일 이내) |
- **데이터 모델 함의**: `block.trashed_at/trashed_by/purged_at/hard_delete_after/deleted_root_id` (위 스키마) + 워크스페이스 레벨의 `trash_retention_days`, `purge_retention_days`. **모든 조회 쿼리에서 trashed/purged 필터가 강제**되어야 하므로 `live_block` 뷰 + Postgres RLS 또는 ORM 글로벌 스코프로 처리한다(개별 쿼리에서 조건을 빼먹는 사고가 이 기능의 1순위 버그다). 복원을 위해 `parent_id`/`position`은 삭제 시 **변경하지 않는다**(원위치 복원이 공짜가 된다). 부모가 이미 소멸한 경우를 위해 `trash_entry(block_id, original_parent_id, original_position, original_space_id)`를 별도로 남긴다.
  - 서브트리 삭제 시 모든 자손에 `deleted_at`을 찍을지, 루트에만 찍고 조회 시 조상 체인을 확인할지 선택해야 한다. **루트에만 찍고 조회 시 필터**하면 쓰기가 O(1)이지만 읽기가 비싸고, **전파**하면 반대다. 서브트리가 크지 않다면 전파 + `deleted_root_id` 컬럼 병기가 실용적이다. `[추정]`
- **UI/인터랙션**: 사이드바 `•••` → Delete, Trash로 드래그, Backspace/Delete 키, 사이드바 하단 Trash 패널(검색 + 복원 화살표 + 영구 삭제 아이콘).
- **의존 기능**: F-02-02, F-02-03.
- **구현 난이도**: **M** — soft delete 자체는 쉽지만 서브트리 전파, 원위치 복원, 조회 필터 누락 방지, 2단계 retention 상태 머신, purge 배치까지 합치면 2~5일. **첨부 스토리지 GC와 teamspace별 휴지통 스코프까지 넣으면 L에 가깝다.**
- **우선순위**: **P0** — 삭제가 복구 불가능하면 사용자가 제품을 신뢰하지 않는다.
- **클론 시 현실적 대안**: 원본대로 구현. purge 배치는 초기엔 생략하고(무기한 보존) 나중에 cron 추가해도 무방.
- **참고 출처**: https://www.notion.com/help/duplicate-delete-and-restore-content , https://developers.notion.com/reference/trash-page , https://www.notion.com/help/custom-data-retention-settings

---

### F-02-12 Teamspace / Private / Shared 영역 구분

- **한 줄 정의**: 워크스페이스 루트를 세 종류의 논리 컨테이너로 나눠, 페이지의 기본 가시성과 권한 상속 출발점을 결정한다.
- **사용자 시나리오**: 사이드바 Teamspaces 섹션의 `+`로 teamspace 생성 → 이름/아이콘/설명 입력 → 접근 유형(Open / Closed / Private) 선택 → 멤버 초대 → 해당 teamspace 아래 페이지 생성 시 teamspace 멤버 전원이 기본 접근권 획득. Private 섹션에서 만든 페이지는 나만 볼 수 있고, 그 페이지를 특정 인원에게 공유하면 Shared 섹션으로 이동한 것처럼 보인다.
- **동작 상세**:
  - **Teamspace 접근 유형 3종**:
    | 유형 | 발견 가능성 | 참여 |
    |---|---|---|
    | Open | 워크스페이스 전원이 볼 수 있음 | 누구나 스스로 참여 가능 |
    | Closed | 존재는 보이나 내용은 안 보임 | owner/member의 초대로만 참여 |
    | Private | 멤버가 아니면 존재 자체가 안 보임 | 초대만 (Business/Enterprise 전용) |
  - **역할 2종**: Teamspace owner는 teamspace 내 모든 페이지에 기본 full access + 설정 관리 권한. Teamspace member는 owner가 정한 범위의 페이지 접근권만 가지며 설정에 접근 불가.
  - **Default teamspace**: 워크스페이스 전원이 자동 가입. 공식 가이드는 대규모 조직이라도 기본 teamspace를 3개 이하로 유지할 것을 권고.
  - **Private**: 모든 사용자에게 기본 제공되며 여기 넣은 것은 본인만 본다.
  - **권한 해석 규칙**: 사용자에게 **가장 넓은 접근 수준**이 적용된다("the broadest level of access given to a user"). 즉 teamspace 멤버십, 개별 공유, 그룹 공유 중 가장 강한 것이 이긴다.
  - Teamspace owner는 누가 멤버를 초대할 수 있는지, 누가 사이드바(teamspace 페이지 구조)를 편집할 수 있는지 설정할 수 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | Shared 페이지를 Private로 이동 | 타인 접근권 소멸. 단 서브페이지에 개별 설정된 권한은 유지 |
  | Teamspace 삭제 | 하위 페이지 처리 정책 필요(휴지통 이동 또는 다른 teamspace로 이관) `[확인필요]` |
  | Teamspace 멤버 탈퇴 | 명시적 개별 공유가 없으면 하위 페이지 접근권 상실 |
  | 사용자 계정 비활성화(deprovision) | 해당 사용자 Private 콘텐츠를 다른 사용자로 이관하는 전용 절차 존재 |
  | 부모는 view, 자식은 edit로 개별 설정 | 자식의 개별 설정이 우선(더 넓은 접근 승리) |
  | 자식에서 권한을 좁히기 | 자식에 명시 permission 행을 만들고 상속을 끊는다 |
  | Open teamspace에 누가 참여 | 즉시 전 하위 페이지 접근권 획득 |
- **데이터 모델 함의**: `teamspace`, `teamspace_member`, `permission` 테이블(위 스키마 참조). 권한 해석 함수:
  ```
  effective_level(user, block):
    node = block
    while node != null:
      if exists explicit permission for (user | user's groups | 'public') on node:
        candidates += those levels
      if node.parent_type == 'teamspace':
        candidates += teamspace_member(user, node.space_id) 기반 기본 레벨
      if node.parent_type == 'workspace' and node.owner_user_id == user: candidates += full_access
      node = node.parent
    return max(candidates)   # 가장 넓은 접근이 승리
  ```
  성능상 매 요청마다 조상 순회는 비싸므로 **접근 가능한 root id 집합을 캐시**하거나 `ancestor_ids` materialized path로 단축한다.
- **UI/인터랙션**: 사이드바 섹션 헤더, Teamspaces `+` 생성, teamspace 설정 모달(접근 유형/멤버/기본 권한/사이드바 편집 권한), 페이지 Share 팝오버(권한 레벨 드롭다운, 게스트 초대, Publish 탭).
- **의존 기능**: F-02-02, 사용자/그룹 모델, 인증.
- **구현 난이도**: **XL** — 권한은 모든 읽기/쓰기 경로를 관통하고, 상속·명시 오버라이드·teamspace 멤버십·게스트·공개 링크의 조합이 곱셈으로 늘어난다. 잘못 만들면 전면 재작업이 된다.
- **우선순위**: **P0** — 단, MVP 범위를 극단적으로 좁혀야 한다.
- **클론 시 현실적 대안**: **MVP는 Private(개인 트리) + 단일 Workspace 공용 트리 2개만.** teamspace, 접근 유형 3종, 게스트, 공개 링크는 전부 v1/v2로 미룬다. 권한 레벨도 `full_access | edit | view` 3단계로 축소. 이 축소가 이 도메인에서 가장 큰 일정 절감 포인트다.
- **참고 출처**: https://www.notion.com/help/intro-to-teamspaces , https://www.notion.com/help/sharing-and-permissions , https://www.notion.com/help/intro-to-workspaces , https://www.notion.com/help/transfer-content-deprovisioned-user

---

### F-02-13 서브페이지 생성과 인라인 페이지 링크 (subpage vs link to page)

- **한 줄 정의**: 페이지 안에서 새 자식 페이지를 만들거나(구조적 소유), 기존 페이지를 가리키는 인라인 참조를 넣는(비소유 참조) 두 경로를 구분해 제공한다.
- **사용자 시나리오**:
  - *서브페이지*: 사이드바에서 부모 페이지 호버 → `+` 클릭 → 자식 페이지 생성. 또는 본문에서 `/page` → 인라인 페이지 블록 생성.
  - *페이지 링크(mention)*: 본문에서 `@` 입력 → 페이지 이름 타이핑 → 목록에서 선택 → 인라인 하이퍼링크 형태로 삽입. 대안 트리거: `[[` 또는 `+`.
  - *Link to page 블록*: `/link` 슬래시 커맨드 또는 블록 `+` 메뉴에서 "Link to page" 선택 → 전용 블록으로 삽입.
  - *URL 붙여넣기*: 노션 페이지 URL을 붙여넣으면 "Paste as mention / link / embed" 선택 메뉴가 뜬다.
- **동작 상세**:
  - **서브페이지**: 부모의 content에 실제로 소속되며 **부모 권한을 상속**한다("that subpage will take on the permissions of its parent page"). 사이드바 트리에 자식으로 나타난다.
  - **@멘션**: 하이퍼링크에 가깝다. 대상 페이지의 위치를 바꾸지 않으며 사이드바 계층에 영향이 없다. 백링크만 생성된다.
  - **Link to page 블록**: 공식 헬프가 "When you reference a Notion page this way, it will show up in your sidebar as a subpage of the page where it was linked"라고 명시한다. 즉 **사이드바에 자식으로 보이지만 대상 페이지가 옮겨지는 것은 아니다** — 원 위치를 유지한 채 표시상의 자식 관계만 추가된다(2차 출처도 "even though it physically lives elsewhere"로 일치). **이전 판의 `[확인필요]`(Q2)는 이로써 해소되며, 보조 엣지 모델(`sidebar_alias`)을 채택한다.** 다만 노션 내부가 별도 엣지 레코드인지 `link_to_page` 블록을 사이드바 쿼리가 해석하는 것인지는 비공개 `[추정]`.
  - 그 결과 **한 페이지가 사이드바 여러 위치에 동시에 나타날 수 있다**(원 위치 1 + 링크된 위치 N). 권한은 언제나 대상 페이지의 **원 위치 parent 체인**으로 해석해야 하며, 링크를 꽂았다고 접근권이 생겨서는 안 된다 `[추정]` — 그렇지 않으면 링크 삽입만으로 권한이 새어나간다(이 도메인에서 가장 위험한 오구현).
  - Notion API는 `link_to_page` 블록의 업데이트를 지원하지 않는다고 명시.
  - **블록 단위 링크**: 블록 호버 → 메뉴 → "Copy link to block"으로 앵커 링크를 얻는다.
  - 세 방식 모두 **접근 권한이 없는 사용자에게는 대상 제목이 노출되지 않아야** 한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 링크 대상이 휴지통으로 이동 | 링크가 "삭제됨" 상태로 렌더, 클릭 시 안내 `[추정]` |
  | 링크 대상 영구 삭제 | 링크가 깨진 참조로 남음 → `page_link` 행 정리 필요 |
  | 대상 제목 변경 | 멘션 렌더는 **id 기반**이므로 자동으로 새 제목 표시(텍스트를 하드코딩하면 안 됨) |
  | 접근 권한 없는 페이지 멘션 | "비공개 페이지" 플레이스홀더로 렌더, 제목 비노출 |
  | 순환 참조(A→B→A) | 허용. 멘션은 트리가 아니라 그래프 |
  | 같은 페이지를 한 문단에서 5번 멘션 | 백링크는 소스 페이지 기준으로 1건으로 묶어 표시 `[추정]` |
  | 자기 자신 멘션 | 허용하되 백링크 목록에서 자기 자신 제외 `[추정]` |
  | A 안에 B의 link_to_page, B 안에 A의 link_to_page | 사이드바가 A▸B▸A▸… 로 무한 전개될 수 있다. **경로상 방문 집합으로 alias 재전개를 차단**하고, alias 노드는 한 번만 펼치게 한다(소유 트리는 I5로 사이클이 없지만 alias 그래프는 사이클이 가능하다) |
  | link_to_page 대상이 휴지통/영구 삭제 | alias 노드를 사이드바에서 제거. `sidebar_alias` 행은 대상 hard delete 시 정리(FK CASCADE) |
  | alias 대상에 접근 권한 없음 | 사이드바에 아예 렌더하지 않는다(제목·존재 모두 비노출). 본문의 블록은 "접근 권한 없음" 플레이스홀더 |
  | 같은 페이지를 한 페이지에 두 번 link_to_page | 사이드바에 두 번 나타난다(블록 단위 alias이므로). 중복 제거는 제품 결정 `[확인필요]` |
- **데이터 모델 함의**:
  - 관계가 **세 종류**이며 절대 한 테이블로 섞지 않는다 — 섞는 순간 권한 상속이 무너진다(노션이 content 대신 parent로 권한을 푸는 이유와 동일).
    | 관계 | 저장 | 권한 | 사이드바 | 백링크 |
    |---|---|---|---|---|
    | 서브페이지(소유) | `block.parent_id` | 부모에서 상속 | 자식으로 표시 | 아님(breadcrumb 영역) |
    | link_to_page(표시상 자식) | `sidebar_alias` | **상속 없음**(원 위치 기준) | 자식으로 표시 | `[확인필요]` — 백링크로도 집계되는지 |
    | @멘션(참조) | rich text 내 mention 노드 → `page_link` | 상속 없음 | 표시 안 함 | 집계됨 |
  - 사이드바 트리 쿼리는 `block(parent_id)` UNION `sidebar_alias(container_page_id)` 두 소스를 합쳐야 하며, alias 쪽에는 위 엣지 케이스의 사이클 가드가 필요하다.
  - 멘션은 rich text 안에 `{type:'mention', mention:{type:'page', page:{id}}}` 형태로 저장하고, 저장 시점에 파싱해 `page_link`를 upsert한다(트리거 또는 애플리케이션 훅).
  - 블록 앵커 링크는 `/{page_slug}#{block_id}` 형식.
- **UI/인터랙션**: `@`, `[[`, `+` 인라인 트리거, `/page`, `/link` 슬래시 커맨드, URL 붙여넣기 시 3지선다 메뉴, 링크 호버 프리뷰 팝오버, "Copy link to block".
- **의존 기능**: F-02-01, F-02-02, 검색(멘션 자동완성), F-02-14.
- **구현 난이도**: **L** — 멘션 자동완성 + rich text 내 인라인 노드 모델 + 링크 파싱/역인덱스 + 권한 인지 렌더가 모두 필요.
- **우선순위**: **P0**(서브페이지) / **P1**(@멘션 링크) — 서브페이지 없이는 트리가 성립하지 않는다.
- **클론 시 현실적 대안**: MVP는 서브페이지(`+` 버튼, `/page`)만. `@`멘션은 v1에서 추가하되 `[[`와 URL 붙여넣기 3지선다는 생략하고 단일 동작(항상 mention)으로 단순화.
- **참고 출처**: https://www.notion.com/help/create-a-subpage , https://www.notion.com/help/create-links-and-backlinks , https://developers.notion.com/reference/block

---

### F-02-14 백링크 (backlinks)

- **한 줄 정의**: 현재 페이지를 @멘션·링크한 다른 페이지들을 자동으로 수집해 페이지 상단에 역참조 목록으로 보여준다.
- **사용자 시나리오**: 페이지 A 본문에서 `@페이지B` 입력 → 페이지 B를 열면 제목 위에 "1 backlink" 표기 → 클릭하면 펼쳐져 페이지 A가 링크 목록으로 표시 → 항목 클릭 시 페이지 A로 이동. `•••` → "Customize page" → "Show backlinks" 토글로 이 영역을 끌 수 있다.
- **동작 상세**:
  - 백링크는 **@멘션 시 자동 생성**된다. 사용자가 수동으로 만들지 않는다.
  - 표시 위치: 페이지 제목 **위**. 백링크가 있을 때만 나타나고 호버 시 노출된다("Backlinks automatically appear above the page title and show on hover whenever a page has them").
  - **권한 필터링**: 열람자가 접근 가능한 페이지의 백링크만 보이며, 비공개 백링크는 그렇게 라벨링된다("Only pages you have permission to access appear, with private backlinks labeled accordingly").
  - 데이터베이스 페이지의 경우 backlinks 모듈은 "Customize layout"의 Heading 모듈 설정에서 표시 여부를 제어한다.
  - 표시 옵션은 페이지별 설정이다(Show backlinks on/off). `[확인필요]` — 과거 존재하던 "Show in popover" 옵션의 현행 여부.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 백링크 0건 | 영역 자체 미표시(빈 상태 UI 없음) |
  | 소스 페이지가 휴지통으로 | 백링크 목록에서 제외 |
  | 소스 페이지 접근 권한 없음 | 건수에는 포함하되 제목은 가리고 "비공개" 라벨 `[확인필요]` — 건수 노출 여부는 정보 유출이 될 수 있어 정책 결정 필요 |
  | 백링크 1,000건 | 페이지네이션 또는 상위 N건 + "Show all" |
  | 같은 소스에서 여러 번 멘션 | 소스 페이지 기준 1행으로 집계 `[추정]` |
  | 멘션 삭제(텍스트 지움) | 해당 `page_link` 행 즉시 제거 → 백링크 사라짐 |
  | 서브페이지 관계 | 부모-자식은 백링크가 아니다(breadcrumb 영역) |
- **데이터 모델 함의**: 위 `page_link` 역인덱스 + `INDEX ON page_link(target_page_id)`. 블록 저장 파이프라인에서 **rich text의 mention 노드를 diff해 upsert/delete**한다. 블록 삭제 시 관련 행 CASCADE. 조회:
  ```sql
  SELECT DISTINCT p.id, p.title, p.icon
  FROM page_link l JOIN block p ON p.id = l.source_page_id
  WHERE l.target_page_id = $1 AND p.deleted_at IS NULL
    AND has_access($user, p.id);
  ```
- **UI/인터랙션**: 제목 위 "{N} backlinks" 접힌 행, 클릭 시 펼침, 호버 노출, `•••` → Customize page → Show backlinks 토글.
- **의존 기능**: F-02-13(@멘션), 권한 모델.
- **구현 난이도**: **M** — 역인덱스 유지(저장 훅에서 diff)와 권한 필터가 핵심. 자료구조 자체는 단순.
- **우선순위**: **P1** — 위키형 사용의 차별점이지만 MVP 필수는 아니다.
- **클론 시 현실적 대안**: 원본대로 구현 가능. 초기엔 권한 필터 대신 "접근 가능한 것만 조회"로 단순화하고 비공개 라벨 표시는 생략.
- **참고 출처**: https://www.notion.com/help/create-links-and-backlinks , https://www.notion.com/help/customize-and-style-your-content

---

### F-02-15 Breadcrumb (경로 표시)

- **한 줄 정의**: 현재 페이지의 조상 경로를 상단에 표시해 계층 내 위치를 알리고 상위로 즉시 이동하게 한다.
- **사용자 시나리오**: 페이지를 열면 상단 좌측에 `Teamspace / 부모 / 조부모 / 현재 페이지` 형태 경로 표시 → 임의 항목 클릭 시 그 페이지로 즉시 이동 → 경로가 길면 `...` 로 축약되고, `...` 클릭 시 중간 페이지 전체 목록이 드롭다운으로 펼쳐진다. 본문에 `/breadcrumb` 블록을 삽입하면 같은 경로가 콘텐츠로도 렌더된다.
- **동작 상세**:
  - 공식 문서: "Breadcrumbs show you how the page you're currently looking at fits into other pages, and you can click on any page in this breadcrumb to immediately jump to it. Sometimes the breadcrumb will be abridged with a `...` — click to view all the pages in between."
  - 별도의 **breadcrumb 블록**이 존재하며 "displays an automatically generated breadcrumb menu showing where the page you add it to lives in your workspace".
  - 경로 세그먼트는 아이콘 + 제목으로 렌더된다.
  - 잠긴 페이지는 breadcrumb 옆에 "Locked" 배지가 붙는다(F-02-10).
  - 페이지가 이동하면 breadcrumb도 자동으로 갱신된다(parent 체인 기반이므로 별도 저장 불필요).
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | Top-level 페이지 | 컨테이너(Teamspace 이름 또는 "Private") 1단계만 표시 |
  | 깊이 20단계 | 앞부분 축약 `첫 항목 / ... / 부모 / 현재` |
  | 조상 중 접근 권한 없는 페이지 | 제목을 가리고 비클릭 세그먼트로 표시 `[추정]` — 조상 제목 노출은 정보 유출 |
  | 제목 없는 조상 | "Untitled" |
  | 조상이 휴지통에 있음 | 해당 페이지도 휴지통 상태이므로 일반 조회 경로로는 도달 불가 |
  | 긴 제목 | 세그먼트 단위 말줄임 + 호버 시 전체 제목 툴팁 |
  | 모바일 | 마지막 1~2 세그먼트만 표시 `[추정]` |
- **데이터 모델 함의**: 별도 저장이 필요 없다. F-02-02의 조상 재귀 CTE 결과를 그대로 사용한다. 다만 **모든 페이지 로드마다 재귀 쿼리가 도는 것은 비싸므로**, `block.ancestor_ids uuid[]`(materialized path)를 두거나 조상 경로를 짧은 TTL로 캐시한다. 페이지 이동 시 서브트리의 `ancestor_ids`를 일괄 갱신해야 하는 비용과 트레이드오프.
- **UI/인터랙션**: 상단 고정 경로 바, 세그먼트 클릭 이동, `...` 클릭 드롭다운, `/breadcrumb` 슬래시 커맨드. `[확인필요]` — 상위 페이지로 가는 전용 단축키 존재 여부.
- **의존 기능**: F-02-02, F-02-05(아이콘 표시).
- **구현 난이도**: **S** — 조상 쿼리 + 렌더. 축약·권한 마스킹까지 포함해도 1일 내.
- **우선순위**: **P0** — 무한 중첩 트리에서 breadcrumb 없이는 사용자가 길을 잃는다.
- **클론 시 현실적 대안**: 원본대로. MVP는 축약 없이 전체 경로 표시 + CSS 말줄임으로 충분. breadcrumb 블록은 v2.
- **참고 출처**: https://www.notion.com/help/intro-to-workspaces , https://www.notion.com/help/navigate-with-the-sidebar

---

### F-02-16 페이지 URL / slug / 딥링크

- **한 줄 정의**: 각 페이지에 안정적인 고유 URL을 부여해 링크 공유·북마크·백링크·블록 앵커가 페이지 이동/이름 변경에도 깨지지 않게 한다.
- **사용자 시나리오**: 페이지 우상단 `•••` → "Copy link" → 클립보드에 URL 복사 → 다른 페이지에 붙여넣기 → "Paste as mention / link / embed" 선택. 블록 단위로는 블록 호버 메뉴 → "Copy link to block". 공개 게시된 페이지는 Share → Publish 탭에서 별도 공개 URL을 얻는다.
- **동작 상세**:
  - Notion API의 page object는 `url`(워크스페이스 내부 링크)과 `public_url`(웹 게시 URL, 미게시 시 null)을 별도 필드로 제공한다.
  - 내부 URL은 **제목 slug + 32자리 id** 형태이며, 제목이 바뀌어도 id로 해석되므로 링크가 유지된다. `[추정]` — 문서에 명시되지 않았으나 URL 구조상 관찰됨.
  - 페이지를 다른 부모/teamspace로 옮겨도 id가 유지되므로 URL이 유지된다. `[추정]`
  - 블록 앵커는 URL 프래그먼트(`#블록id`)로 표현되어 해당 블록으로 스크롤·하이라이트한다.
  - 공개 링크는 만료 시간을 설정할 수 있고, Enterprise owner는 Security 설정에서 공개 링크 자체를 비활성화할 수 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | slug 부분이 실제 제목과 불일치 | id로 해석하고 정규 URL로 리다이렉트 |
  | 접근 권한 없는 URL 방문 | 404가 아니라 "접근 권한 요청" 화면(존재 여부 노출 최소화 정책이면 404) — 정책 결정 필요 |
  | 삭제된 페이지 URL 방문 | "휴지통에 있음" 안내 + 복원 링크(권한 있을 때) |
  | 앵커 블록이 삭제됨 | 페이지 상단으로 폴백 |
  | 로그인 안 한 상태 | 공개 게시된 페이지면 렌더, 아니면 로그인 유도 |
  | 링크 만료 설정된 공개 링크 | 만료 후 접근 차단 |
  | 워크스페이스 간 이동 | id 유지 시 URL 유지, 다만 워크스페이스 도메인 세그먼트는 변경될 수 있음 `[확인필요]` |
- **데이터 모델 함의**: `page_meta.slug_id`(짧은 고유 식별자) + `block.id`. 라우트는 `/{workspace_slug}/{title-slug}-{short_id}` 형태를 권장. 제목 slug는 **저장하지 않고 렌더 시 생성**하면 이름 변경 시 자동 정합. `public_url`은 게시 시점에 발급하고 `is_public` 해제 시 무효화.
- **UI/인터랙션**: `•••` → Copy link, 블록 호버 메뉴 → Copy link to block, Share 팝오버 Publish 탭, `cmd/ctrl+L`. `[확인필요]` — 링크 복사 단축키.
- **의존 기능**: F-02-01, F-02-12(권한), 라우팅.
- **구현 난이도**: **M** — 라우팅·리다이렉트·앵커 스크롤·권한 분기 처리.
- **우선순위**: **P0** — 링크 없이는 백링크·공유·멘션이 성립하지 않는다.
- **클론 시 현실적 대안**: MVP는 `/p/{uuid}` 단순 라우트만. 제목 slug와 공개 URL은 v1.
- **참고 출처**: https://developers.notion.com/reference/page , https://www.notion.com/help/create-links-and-backlinks , https://www.notion.com/help/sharing-and-permissions

---

### F-02-17 워크스페이스 컨테이너와 스위처

- **한 줄 정의**: 모든 페이지 트리의 최상위 격리 단위를 workspace로 두고, 한 계정이 여러 workspace에 소속해 전환할 수 있게 한다.
- **사용자 시나리오**: 사이드바 좌상단 워크스페이스 이름 클릭 → 스위처 드롭다운에 소속 워크스페이스 목록 + "Create a new workspace" / "Join another workspace" / "Log out" → 다른 워크스페이스 선택 시 사이드바 트리 전체가 교체됨 → Settings에서 워크스페이스 이름·아이콘·도메인·멤버·플랜 관리.
- **동작 상세**:
  - 공식 정의: "Everything you do in Notion takes place in a workspace." 한 계정이 여러 워크스페이스에 소속될 수 있으나 **워크스페이스끼리는 완전히 분리**된다: "completely separate, so you won't be able to link any content between them."
  - 유료 플랜은 **워크스페이스 단위**로 적용된다("Paid plans only apply to one workspace, and don't cover the whole account") → 플랜 의존 기능(teamspace 노출, 버전 히스토리 기간, 데이터 보존 기간)의 판정 기준이 계정이 아니라 워크스페이스임을 의미한다.
  - 멤버 역할: workspace owner / membership admin / member / guest. 게스트는 초대된 페이지만 접근한다.
  - 워크스페이스 삭제·이관·SCIM/SAML 등은 워크스페이스 설정에 속한다. `[확인필요]` — 세부 절차는 이번 조사 범위 밖.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 워크스페이스 A의 페이지를 B의 페이지에서 멘션 | **불가**. 공식적으로 콘텐츠 링크가 워크스페이스를 넘지 못한다 → 멘션 자동완성·검색 쿼리에 `workspace_id` 필터 필수 |
  | 워크스페이스 간 페이지 이동 | F-02-08의 마이그레이션 잡. 도착지는 대상 워크스페이스의 Private 섹션 |
  | 마지막 owner가 워크스페이스를 떠남 | owner 0명 상태 금지 — 최소 1명 보장 가드 `[확인필요]` |
  | 사용자가 20개 워크스페이스에 소속 | 스위처 목록 페이지네이션/검색. 트리 캐시는 워크스페이스별로 분리 |
  | 워크스페이스 삭제 | 하위 서브트리 + 첨부 스토리지 정리 배치. 즉시 하드 삭제가 아니라 유예 기간 필요 `[추정]` |
  | 초대 수락 전 상태 | pending 멤버십 행. 사이드바 접근은 수락 후 |
- **데이터 모델 함의**: 위 `workspace`, `workspace_member` 테이블. **`workspace_id`는 `block`·`file`·`page_link`·`favorite`·검색 인덱스 등 거의 모든 테이블에 비정규화해 넣는다** — 나중에 추가하면 전 테이블 마이그레이션 + 전 쿼리 수정이 된다. 모든 API 요청은 `workspace_id` 스코프를 세션 컨텍스트로 받고, 이 값과 리소스의 `workspace_id`가 불일치하면 403이 아니라 **404**로 응답한다(리소스 존재 자체를 노출하지 않기 위해). 플랜 의존 기능은 `workspace.plan`으로 게이팅한다.
- **UI/인터랙션**: 좌상단 워크스페이스 스위처 드롭다운, Settings 진입, 워크스페이스 생성/참여 플로우, 멤버 초대 모달.
- **의존 기능**: 인증/계정 모델, F-02-12(권한), F-02-03(사이드바).
- **구현 난이도**: **M** — 로직 자체는 단순하지만 **모든 쿼리를 관통하는 스코프**라 초기에 넣지 않으면 나중 비용이 XL로 튄다. 1일차에 넣으면 2~3일.
- **우선순위**: **P0** — 워크스페이스를 1개만 지원하더라도 `workspace_id` 컬럼과 스코프 규약은 반드시 처음부터 넣는다.
- **클론 시 현실적 대안**: MVP는 **계정당 워크스페이스 1개 자동 생성**, 스위처 UI 없음. 스키마와 쿼리 스코프만 다중 워크스페이스를 전제로 만들어 둔다. 크로스 워크스페이스 이동/복제는 v2.
- **참고 출처**: https://www.notion.com/help/intro-to-workspaces , https://www.notion.com/help/add-members-admins-guests-and-groups , https://www.notion.com/help/workspace-settings

---

### F-02-18 페이지 공유 · 게스트 초대 · 웹 게시(Publish)

- **한 줄 정의**: 개별 페이지 단위로 사람·그룹·외부 게스트에게 접근 권한을 부여하거나, 링크를 가진 누구나 또는 공개 웹에 게시한다.
- **사용자 시나리오**: 페이지 우상단 `Share` 클릭 → 팝오버에 현재 접근자 목록 → 이메일/이름 입력 후 권한 레벨(Full access / Can edit / Can comment / Can view) 선택 → `Invite` → 워크스페이스 멤버가 아니면 **게스트**로 추가됨 → `General access` 드롭다운에서 "Anyone on the web with link" 선택 시 링크 공유 활성화(편집/댓글/보기 수준 지정) → `Publish` 탭에서 웹사이트로 게시.
- **동작 상세**:
  - 공유 경로는 셋이다: ① 워크스페이스 멤버·그룹에게 페이지 권한 부여, ② 외부인을 **게스트**로 초대(초대된 페이지만 접근), ③ 링크 공유 / 웹 게시(Notion Sites).
  - 권한 레벨 정의: Full access는 "people with full access to a page can edit any of the content it contains and share the page with anyone they want."
  - 페이지를 공유하면 서브페이지가 권한을 상속하고, 공유된 페이지는 상대의 **Shared 섹션**에 나타난다(= Shared가 파생 뷰라는 F-02-12의 가설과 정합).
  - 공개 링크는 만료를 설정할 수 있고, Enterprise는 워크스페이스 차원에서 공개 공유 자체를 비활성화할 수 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 부모는 view, 자식에 edit 개별 부여 | "가장 넓은 접근" 규칙에 따라 자식은 edit (F-02-12) |
  | 게스트가 breadcrumb의 조상 클릭 | 접근 불가 — 조상 세그먼트는 제목을 가리고 비클릭 처리 |
  | 공유 해제 직후 상대가 그 페이지를 열어 둔 상태 | 진행 중 세션을 서버가 끊고 403 전환. **WebSocket 구독도 즉시 해제**해야 한다(권한 변경 브로드캐스트 필요) |
  | 게시된 페이지의 하위 페이지 | 게시 범위에 서브트리가 포함되는지 명시 필요 `[확인필요]` |
  | 공개 페이지가 비공개 페이지를 멘션 | 비로그인 뷰어에게 제목이 새면 안 된다 → 렌더 단계에서 권한 필터 재적용 |
  | 링크 만료 후 접근 | 만료 안내 화면(410) |
  | 게스트 수 상한 | 플랜별 게스트 한도 존재 `[확인필요]` |
  | 공유 페이지를 Private로 이동 | 타인 접근권 소멸(서브페이지 개별 권한은 유지) |
- **데이터 모델 함의**: `permission`(F-02-12) + 위 `share_link` 테이블. 게스트는 `workspace_member.role='guest'`로 두되 **사이드바 루트가 워크스페이스가 아니라 "명시 권한을 받은 페이지 집합"**이 되므로, 트리 API가 `permission`에서 루트 집합을 뽑는 별도 경로를 가져야 한다. 공개 렌더는 인증 없는 별도 경로(`GET /public/{token|slug}`)로 분리하고, **이 경로가 내부 조회 함수를 재사용하지 않게** 한다(권한 우회 사고의 단골 원인).
- **UI/인터랙션**: `Share` 팝오버(사람 검색, 레벨 드롭다운, General access, Copy link), Publish 탭(도메인·검색엔진 노출·복제 허용 토글), 게스트 배지.
- **의존 기능**: F-02-12(권한 모델), F-02-16(URL), F-02-17(멤버십).
- **구현 난이도**: **L** — 권한 모델 위에 게스트(부분 트리 사용자)와 **비로그인 공개 렌더 경로**가 얹힌다. 공개 경로는 캐싱·SEO·권한 누출까지 별도 설계가 필요하다.
- **우선순위**: **P1**(멤버 간 페이지 공유) / **P2**(게스트, 웹 게시).
- **클론 시 현실적 대안**: MVP는 "워크스페이스 멤버에게 페이지 단위 view/edit 부여"만. 게스트는 v1, 웹 게시는 v2(토큰 URL 정적 렌더로 시작하고 커스텀 도메인은 제외).
- **참고 출처**: https://www.notion.com/help/sharing-and-permissions , https://www.notion.com/help/share-your-work , https://www.notion.com/help/public-pages-and-web-publishing , https://www.notion.com/help/add-members-admins-guests-and-groups

---

### F-02-19 페이지 버전 히스토리와 복원

- **한 줄 정의**: 페이지 편집 이력을 스냅샷으로 자동 기록하고, 과거 시점의 내용으로 되돌릴 수 있게 한다(휴지통이 "존재의 복구"라면 이것은 "내용의 복구").
- **사용자 시나리오**: 페이지 우상단 `•••` → "Version history" → 우측 패널에 시간순 스냅샷 목록(편집자 포함) → 항목 선택 시 본문이 그 시점 상태로 미리보기 → `Restore` 클릭 → 현재 버전이 그 상태로 교체 → 되돌린 것도 다시 되돌릴 수 있다.
- **동작 상세**:
  - 스냅샷 주기: **활발히 편집 중이면 10분마다**, 편집이 멈추면 **2분 후**에 한 번 기록된다.
  - 접근 권한: **Can edit 이상**이어야 버전 히스토리를 열 수 있다.
  - 보존 기간(플랜별): Free 7일 / Plus·Business 30일 / Enterprise 무제한. `[확인필요]` — 플랜 명칭과 기간은 변동이 잦아 구현 시점 재확인 필요(2026-09 기준 2차 출처 다수가 이 값으로 일치).
  - 복원은 파괴적이지 않다: "you can always go back to the page as it was during any point in the past 30 days" → **복원 자체도 새 버전으로 기록**된다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 복원 중 다른 사용자가 편집 중 | 복원을 "현재 문서에 대한 하나의 큰 편집"으로 처리해 CRDT/OT 파이프라인을 통과시킨다. 문서 상태를 우회해 DB를 직접 덮어쓰면 열려 있는 세션과 **영구 분기**한다 — 이 기능의 최대 함정 |
  | 서브페이지 | 스냅샷 범위가 해당 페이지 본문인지 서브트리 전체인지 정의 필요. 페이지마다 독립 히스토리가 자연스럽다 `[추정]` |
  | 스냅샷 용량 폭증 | 전체 스냅샷 대신 **베이스 + delta**, 오래된 것은 압축/솎아내기 |
  | 보존 기간 경과 / 플랜 다운그레이드 | 배치 삭제, 다운그레이드 시 즉시 접근 차단 |
  | 첨부·이미지가 이후 삭제됨 | 과거 버전 렌더 시 깨진 참조 → 스토리지 GC는 `MAX(버전 보존기간, 휴지통 2단계 retention)` 이후에만 수행 |
  | view 권한자 | 메뉴 비노출 + 서버에서도 권한 확인 |
  | 복원 직후 되돌리기 | 복원 직전 상태가 스냅샷으로 남아 있어야 한다 |
- **데이터 모델 함의**: 위 `page_version` 테이블. 저장 전략 2택 — (a) 블록 서브트리 JSON 스냅샷(단순, 용량 큼), (b) **Y.js update 로그 append + 주기적 스냅샷 압축**(협업 편집을 CRDT로 구현했다면 사실상 부산물). Docmost처럼 페이지 행에 `ydoc` 바이너리를 두는 구조라면 (b)가 자연스럽다. 스냅샷 트리거는 "10분 주기 + 2분 idle" 규칙을 그대로 차용할 만하다(서버 타이머 또는 편집 세션 종료 훅).
- **UI/인터랙션**: `•••` → Version history, 우측 타임라인 패널, 스냅샷 미리보기, Restore 버튼, 편집자 아바타.
- **의존 기능**: F-02-01, 협업 편집 파이프라인(도메인 01), 권한 모델.
- **구현 난이도**: **L** — 저장 전략·용량 관리·동시편집 중 복원이 얽힌다. "저장할 때마다 전체 JSON 스냅샷" 수준이면 M이지만 용량이 곧 문제가 된다.
- **우선순위**: **P1** — 실수 복구 신뢰가 협업 도입의 전제지만, 휴지통(F-02-11)이 있으면 MVP는 버틴다.
- **클론 시 현실적 대안**: MVP는 **편집 세션 종료 시 전체 스냅샷 + 페이지당 최근 50개만 보존**. delta 압축과 플랜별 기간은 v2.
- **참고 출처**: https://www.notion.com/help/duplicate-delete-and-restore-content , https://www.notion.com/help/guides/tips-to-keep-your-teams-notion-pages-up-to-date , https://www.notion.com/help/back-up-your-data

---

### F-02-20 페이지 열기 모드 (full page / side peek / center peek)

- **한 줄 정의**: 페이지를 전체 화면 외에 우측 패널(side peek)이나 중앙 모달(center peek)로 열어, 원래 보던 화면의 맥락을 유지한 채 내용을 확인·편집하게 한다.
- **사용자 시나리오**: 데이터베이스 행이나 링크된 페이지 클릭 → 기본 설정에 따라 side peek(우측 패널)로 열림 → 좌측 원래 화면은 계속 조작 가능 → peek 상단 확장 아이콘으로 full page 전환 → `Esc` 또는 바깥 클릭으로 닫으면 원래 화면 유지. 데이터베이스는 `•••` → Layout → "Open pages in"에서 side peek / center peek / full page 기본값을 지정한다.
- **동작 상세**:
  - 세 모드: **Side peek**(우측 패널, 뒤 화면 조작 가능), **Center peek**(중앙 모달), **Full page**.
  - 기본값은 **데이터베이스 뷰 단위 설정**이며 Table/Board/List/Timeline은 side peek이 기본이다.
  - **전역(계정/워크스페이스) 기본값 설정은 제공되지 않는다** `[확인필요]` — 2차 출처 다수가 "no global default"로 일치하나 공식 명시는 찾지 못했다.
  - peek 상태에서도 URL이 바뀌므로 새로고침하면 full page로 열린다 `[추정]` — URL 구조상 관찰되나 문서 명시 없음.
  - 데이터베이스 peek에서 다음/이전 행으로 이동하는 단축키가 있다 `[확인필요]`.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | peek 안에서 또 다른 페이지 열기 | 패널을 스택으로 쌓지 말고 교체 + 뒤로가기 제공(무한 중첩 방지) |
  | 좁은 화면/모바일 | side peek 비활성 → 항상 full page |
  | peek을 연 채 뒤 화면에서 그 페이지를 삭제 | peek을 닫고 "삭제됨" 토스트 |
  | peek 상태의 URL을 공유 | 받는 쪽은 full page로 열린다(peek은 표시 모드이지 리소스가 아니다) |
  | peek 안에서 편집 중 닫기 | 자동 저장. "미저장" 개념을 두지 않는다 |
  | 브라우저 뒤로가기 | peek 열기를 히스토리 엔트리로 취급할지 결정 필요 — 취급하면 뒤로가기가 peek을 닫고, 아니면 이전 페이지로 이동한다 |
  | 권한 없는 페이지를 peek으로 열기 | 패널 안에서 접근 거부 상태를 렌더(전체 화면 전환 없이) |
- **데이터 모델 함의**: 영속 데이터는 사실상 없다 — **뷰 설정 1개**(`db_view.open_pages_as text`)와 클라이언트 라우팅 상태뿐이다. 다만 라우팅 설계에는 영향이 크다: 배경 라우트를 유지한 채 오버레이 라우트를 여는 구조(Next.js parallel/intercepting routes, 또는 라우터 상태에 `peekId` 쿼리 파라미터를 두는 방식)를 **처음부터** 잡아야 나중에 갈아엎지 않는다.
- **UI/인터랙션**: 클릭(기본 모드), 보조 열기(`cmd/ctrl+클릭`·shift+클릭), peek 헤더 확장/닫기 버튼, `Esc`, 패널 폭 드래그.
- **의존 기능**: F-02-16(URL/라우팅), F-02-01.
- **구현 난이도**: **M** — 도메인 로직은 없지만 **오버레이 라우팅 + 포커스/스크롤 복원 + 반응형 분기**가 손이 많이 간다.
- **우선순위**: **P2** — 없어도 제품은 성립. 단 라우팅 구조만은 P0 시점에 열어 둘 것.
- **클론 시 현실적 대안**: MVP는 full page만. v1에서 side peek 하나만 추가하고 center peek은 생략(두 모드의 사용자 가치 차이가 작다).
- **참고 출처**: https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/releases/2022-07-20 , https://www.notion.com/help/keyboard-shortcuts

---

### F-02-21 검색과 최근 방문(Recents)

- **한 줄 정의**: 워크스페이스 전체에서 페이지를 제목·본문으로 찾고, 최근 방문한 페이지로 즉시 되돌아가게 한다.
- **사용자 시나리오**: `cmd/ctrl+K`(또는 `cmd/ctrl+P`) → 검색 창이 열리며 **아무것도 입력하지 않은 상태에서 최근 방문 페이지 목록**이 뜬다 → 키워드 입력 → 결과 목록 → 정렬(Best matches / Last edited / Created)과 필터(Title only, Created by, Teamspace, Date range) 적용 → Enter로 이동.
- **동작 상세**:
  - 기본 정렬은 **Best Matches**이며 최근 편집된 페이지가 상위에 온다. 그 외 Last Edited(신/구), Created(신/구) 정렬.
  - 필터: 제목만 검색, 작성자, teamspace, 날짜 범위(Today / Last 7 days / Last 30 days / 커스텀).
  - 검색 창의 초기 상태가 곧 **Recents** 진입점이며, 사이드바 Home 탭에도 Recents 섹션이 있다(F-02-03).
  - 검색 결과는 **접근 권한이 있는 페이지로 한정**된다 `[추정]` — 권한 모델상 당연하나 헬프 문서에서 명시 문장을 찾지 못했다.
  - 관리자·조직용 별도 기능으로 Admin content search, Enterprise Search(외부 앱 통합 검색)가 있다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 권한 없는 페이지가 결과에 노출 | **치명적 유출**. 인덱스 행에 권한 스코프를 함께 저장해 질의 단계에서 필터한다. 애플리케이션 후처리로만 걸러내면 페이지네이션 개수가 깨진다 |
  | 권한이 방금 변경됨 | 서브트리 재인덱싱 잡 필요. 지연 동안은 조회 시점 권한 재확인으로 이중 방어 |
  | 휴지통 페이지 | 일반 검색에서 제외. 휴지통 전용 검색은 별도 경로 |
  | 한국어/CJK 검색 | Postgres 기본 `to_tsvector('simple')`은 CJK를 쪼개지 못한다 → `pg_bigm`/`pgroonga` 또는 외부 검색엔진 필요. **한국어 클론에서는 이 결정이 검색 품질을 좌우한다** |
  | 대용량 본문 | 블록 JSON이 아니라 평문 추출 컬럼(`text_content`)에 인덱스 |
  | 방금 만든 페이지 | 인덱싱 지연 허용치 정의(동기 인덱싱이면 쓰기 지연, 비동기면 검색 지연) |
  | Recents에 삭제된 페이지 | 조회 시 필터 + 주기적 정리 |
  | 여러 기기의 Recents | per-user 서버 저장이면 동기화, 로컬 저장이면 기기별로 갈린다 — 제품 결정 필요 |
- **데이터 모델 함의**: `block.text_content`(블록 JSON에서 추출한 평문, Docmost 방식) + FTS 인덱스. 권한 필터를 인덱스 레벨에서 하려면 **인덱스 행에 `space_id`와 명시 권한 대상 집합을 비정규화**해야 하고, 권한/이동 변경 시 서브트리 재인덱싱 잡(`job(kind='permission_recalc')`)이 필요하다. `recent_visit(user_id, block_id, visited_at)`은 upsert로 유지하며 사용자당 N개로 잘라낸다.
- **UI/인터랙션**: `cmd/ctrl+K`, `cmd/ctrl+P`, 검색 모달(정렬·필터 바), 최근 항목 리스트, 결과 스니펫 하이라이트.
- **의존 기능**: F-02-12(권한), F-02-01, 블록 → 평문 추출 파이프라인.
- **구현 난이도**: **L** — "검색창 하나"로 보이지만 **권한 인지 인덱스 + 재인덱싱 잡 + CJK 토크나이징**이 붙는다. 이 도메인에서 가장 과소평가되기 쉬운 항목이다.
- **우선순위**: **P0**(제목 기준 빠른 이동) / **P1**(본문 전문 검색 + 필터) — 트리가 깊어지면 검색 없이 탐색이 불가능해진다.
- **클론 시 현실적 대안**: MVP는 **제목 대상 trigram/ILIKE 검색 + Recents**만. `text_content` 컬럼은 처음부터 채워 두고 전문 인덱스만 나중에 붙인다. 한국어가 필요하면 pg_bigm을 우선 검토.
- **참고 출처**: https://www.notion.com/help/search , https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/admin-content-search , https://www.notion.com/help/enterprise-search

---

### F-02-22 페이지 내보내기 / 가져오기 (export / import)

- **한 줄 정의**: 페이지 또는 워크스페이스 전체를 Markdown/HTML/PDF/CSV로 내보내고, 외부 문서를 페이지 트리로 가져온다.
- **사용자 시나리오**: 페이지 `•••` → "Export" → 형식(PDF / HTML / Markdown & CSV) 선택 → **"Include subpages" 토글** → Export → zip 다운로드(또는 다운로드 링크 이메일). 워크스페이스 전체는 Settings → General → "Export all workspace content". 가져오기는 사이드바의 Import 진입점에서 파일 선택.
- **동작 상세**:
  - 형식: 비-데이터베이스 페이지는 Markdown, 풀 페이지 데이터베이스는 CSV(+각 서브페이지는 Markdown 파일), 그 외 HTML/PDF.
  - **Include subpages**는 서브트리를 함께 내보낸다. PDF의 서브페이지 포함은 Business/Enterprise 플랜 기능.
  - HTML/Markdown 내보내기에는 **`index.html` 사이트맵**이 포함되고 내부 링크가 내보낸 파일 간 상대 경로로 연결된다 → **export는 F-02-09(복제)와 동일한 "id 재매핑" 문제를 갖는다**. 순회·재매핑 코드를 공유하는 것이 맞다.
  - 가져오기: PDF/HTML/Text·Markdown/Word 등을 지원하며 다중 파일 선택 가능(HTML은 한 번에 하나), 이미지·자산은 같은 폴더에 있어야 한다.
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | 서브트리 수천 페이지 | 동기 처리 불가 → 백그라운드 잡 + 완료 알림/이메일(노션도 이메일 링크 방식) |
  | 내부 링크 | 내보낸 범위 안이면 상대 경로로 재매핑, 밖이면 원본 URL 유지 |
  | 권한 없는 자식 페이지 포함 | 내보내기에서 제외하고 사이트맵에도 흔적을 남기지 않는다 |
  | 첨부 파일 | zip에 동봉하고 본문 경로를 로컬 상대 경로로 치환. 용량 상한 초과 시 분할 |
  | 동일 제목 충돌 | 파일명을 `제목-{shortid}`로 유일화(제목 중복은 매우 흔하다) |
  | 가져오기 중 미지원 마크업 | 문단으로 degrade하고 실패 항목 리포트 제공 |
  | 다운로드 링크 유출 | 서명 URL + 짧은 만료 필수(zip에는 권한 필터를 다시 적용할 수 없다) |
  | 내보내기 도중 원본 편집 | 잡 시작 시점의 스냅샷 기준으로 진행(중간 상태 혼재 방지) `[추정]` |
- **데이터 모델 함의**: `job(kind='export'|'import')` + 산출물 저장(`export_artifact(job_id, storage_key, expires_at)`). 내보내기는 **읽기 전용 서브트리 순회 + 직렬화**라 복제(F-02-09)와 순회기를 공유한다. 가져오기는 파서 → 블록 트리 생성 → `position` 부여 경로이며, 외부 포맷 → 블록 타입 매핑 테이블이 필요하다.
- **UI/인터랙션**: `•••` → Export 모달(형식/서브페이지 포함/이미지 해상도), Settings → Export all workspace content, Import 진입점, 진행률 표시.
- **의존 기능**: F-02-02(서브트리 순회), F-02-12(권한 필터), 파일 스토리지, 잡 큐.
- **구현 난이도**: **M**(단일 페이지 Markdown) ~ **L**(서브트리 zip + 링크 재매핑 + PDF 렌더). PDF는 헤드리스 브라우저 렌더가 필요해 인프라 비용이 따로 든다.
- **우선순위**: **P2** — 단 "내 데이터를 꺼낼 수 있다"는 신뢰 요소이므로 v1에 Markdown 내보내기만이라도 넣기를 권장한다.
- **클론 시 현실적 대안**: MVP는 **단일 페이지 Markdown 내보내기**(클라이언트에서 즉시 생성). 서브트리 zip은 v1, PDF와 가져오기는 v2.
- **참고 출처**: https://www.notion.com/help/export-your-content , https://www.notion.com/help/import-data-into-notion , https://www.notion.com/help/back-up-your-data

---

### F-02-23 Wiki 전환 · 페이지 owner · 검증(verification)

- **한 줄 정의**: 일반 페이지를 wiki로 전환해 하위 페이지에 **소유자(owner)와 "검증됨" 상태**를 부여하고, 검증 만료로 문서 최신성을 관리한다.
- **사용자 시나리오**: 페이지 `•••` → "Turn into wiki" → 하위 페이지가 owner·검증 상태·최종 편집일을 가진 목록으로 전환 → 페이지 상단에서 `Owner` 지정 → `Verify` 클릭 → 30일 / 90일 / 무기한 중 선택 → 만료되면 owner에게 Notion Inbox·이메일 알림이 가고 재검증을 요구받는다.
- **동작 상세**:
  - **페이지만 wiki로 전환할 수 있다**: "Only pages can be turned into wikis; you can't turn a database into a wiki."
  - **owner 기본값은 페이지 생성자**이며 언제든 변경·복수 지정할 수 있다.
  - 검증 기간은 30일 / 90일 / 무기한 중 선택. 만료 시 owner에게 Inbox + 이메일 알림.
  - wiki는 보통 teamspace 안에 두어 팀 지식 베이스로 쓰며, wiki 홈에서 owner·teamspace 기준 필터·검색이 가능하다.
  - `[확인필요]` — 전환이 되돌릴 수 있는지, 전환 시 기존 서브페이지의 parent/type이 바뀌는지(하위가 database row가 되는지)는 공식 문서에서 확인하지 못했다. **도메인 03(데이터베이스)과 직접 맞물리므로 별도 검증이 필요하다.**
- **엣지 케이스**:

  | 상황 | 기대 동작 |
  |---|---|
  | owner가 워크스페이스를 떠남 | 알림 수신자 소멸 → owner 없음 상태를 허용하되 관리자에게 승계를 요청 `[추정]` |
  | 검증 후 페이지가 편집됨 | 검증을 자동 해제할지 유지할지 정책 결정 필요. "최신성 보증"의 의미상 자동 해제가 맞다 `[추정]` |
  | 검증 만료 알림 중복 | 만료 시 1회만 알림, 재검증 시 타이머 리셋 |
  | wiki 안에 다시 wiki | 중첩 허용 여부 `[확인필요]` |
  | 접근 권한 없는 사용자를 owner로 지정 | 지정만으로 접근권이 생기지 않게 한다 — 후보를 접근 권한자로 제한 `[추정]` |
  | wiki 전환 취소 | 하위가 database row로 바뀌었다면 되돌릴 때 트리 구조 복원이 필요 `[확인필요]` |
  | 대규모 wiki(하위 5,000 페이지) | wiki 홈은 페이지네이션·필터가 있는 데이터베이스 뷰여야 한다(단순 목록은 무너진다) |
- **데이터 모델 함의**: `page_meta.is_wiki`, `verified_at`, `verified_by`, `verification_expires_at` + `page_owner(block_id, user_id)`(위 스키마). 만료 알림은 `verification_expires_at`에 인덱스를 걸고 스케줄러가 스캔한다. wiki 홈 뷰 자체는 "부모가 이 페이지인 자식 페이지 목록 + owner/검증/최종편집일 컬럼"이므로 **데이터베이스 뷰 엔진(도메인 03)을 재사용**하는 것이 옳다.
- **UI/인터랙션**: `•••` → Turn into wiki, 페이지 상단 Owner 셀렉터, `Verify` 버튼과 기간 선택 팝오버, 검증 배지, 만료 알림(Inbox/이메일), wiki 홈 필터.
- **의존 기능**: F-02-02, F-02-12(teamspace), 데이터베이스 뷰(도메인 03), 알림/Inbox.
- **구현 난이도**: **M** — 필드 추가 + 만료 스캐너 + 알림. 단 wiki 홈 뷰를 데이터베이스 엔진 없이 직접 만들면 L로 늘어난다.
- **우선순위**: **P2** — 조직 규모가 커진 뒤에야 가치가 생긴다. 다만 `owner`·`verified` 필드는 스키마에 미리 넣어도 비용이 0에 가깝다.
- **클론 시 현실적 대안**: wiki 전환 자체를 만들지 말고 **페이지 속성으로 owner와 "최종 검토일"만** 제공하고 사이드바/검색에 배지로 노출. 만료 알림은 v2.
- **참고 출처**: https://www.notion.com/help/wikis-and-verified-pages , https://www.notion.com/help/guides/verify-knowledge-your-teammates-can-trust-with-page-verification , https://www.notion.com/help/intro-to-teamspaces

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-02-01 | 페이지 = 블록 (page-as-block) | L | P0 | 블록 에디터(도메인 01) |
| F-02-02 | 무한 중첩 페이지 트리 | L | P0 | F-02-01, F-02-03, F-02-12 |
| F-02-03 | 사이드바 네비게이션 | L | P0 | F-02-02, F-02-04, F-02-12 |
| F-02-04 | 즐겨찾기 (Favorites) | S | P0 | F-02-03 |
| F-02-05 | 페이지 아이콘 | M | P1 | F-02-01, 파일 스토리지 |
| F-02-06 | 페이지 커버 이미지 | M | P2 | F-02-01, 파일 스토리지 |
| F-02-07 | 레이아웃 설정(font/small text/full width) | S | P2 | F-02-01 |
| F-02-08 | 페이지 이동 (Move to) | L | P0 | F-02-02, F-02-12 |
| F-02-09 | 페이지 복제 (Duplicate) | L | P1 | F-02-02, F-02-14 |
| F-02-10 | 페이지 잠금 (Lock page) | S | P2 | F-02-01, 권한 |
| F-02-11 | 휴지통과 복원 | M | P0 | F-02-02, F-02-03 |
| F-02-12 | Teamspace / Private / Shared 권한 영역 | XL | P0(축소 범위) | 사용자·그룹, 인증 |
| F-02-13 | 서브페이지 / 인라인 페이지 링크 | L | P0(서브페이지) / P1(멘션) | F-02-01, F-02-02, 검색 |
| F-02-14 | 백링크 | M | P1 | F-02-13, 권한 |
| F-02-15 | Breadcrumb | S | P0 | F-02-02, F-02-05 |
| F-02-16 | 페이지 URL / slug / 딥링크 | M | P0 | F-02-01, F-02-12 |
| F-02-17 | 워크스페이스 컨테이너 / 스위처 | M | P0 | 인증, F-02-12 |
| F-02-18 | 페이지 공유 / 게스트 / 웹 게시 | L | P1(공유) / P2(게스트·게시) | F-02-12, F-02-16, F-02-17 |
| F-02-19 | 버전 히스토리 / 복원 | L | P1 | 협업 편집(도메인 01), 권한 |
| F-02-20 | 열기 모드 (full/side/center peek) | M | P2 | F-02-16 |
| F-02-21 | 검색 / Recents | L | P0(제목) / P1(전문) | F-02-12, 텍스트 추출 |
| F-02-22 | 내보내기 / 가져오기 | M~L | P2 | F-02-02, 잡 큐, 스토리지 |
| F-02-23 | Wiki / owner / verification | M | P2 | F-02-12, 도메인 03 |

### 의존 관계 (구현 순서 제안)

```
0) F-02-17 workspace 스코프 ──(모든 테이블·쿼리의 전제)
      │
1) F-02-01 page-as-block  ─┬─> F-02-02 트리 ─┬─> F-02-03 사이드바 ─┬─> F-02-04 즐겨찾기
                           │                 │                     └─> F-02-21 Recents
                           │                 ├─> F-02-15 breadcrumb
                           │                 ├─> F-02-08 move to
                           │                 ├─> F-02-11 휴지통(2단계 retention)
                           │                 ├─> F-02-09 복제 ──> F-02-22 export/import (순회기 공유)
                           │                 └─> F-02-23 wiki/owner/verification
                           ├─> F-02-16 URL/라우팅 ──> F-02-20 peek 모드
                           ├─> F-02-13 서브페이지 / link_to_page(alias) / @멘션 ──> F-02-14 백링크
                           ├─> F-02-19 버전 히스토리 (협업 편집 파이프라인 위에 얹힘)
                           └─> F-02-05/06/07/10 (페이지 속성류, 병렬 가능)
   F-02-12 권한 + F-02-18 공유는 위 전부를 가로지른다. F-02-02와 동시에 최소 형태로 설계하고,
   F-02-21 검색 인덱스는 권한 스코프를 인덱스에 함께 넣는다는 전제를 처음부터 깔아야 한다
   (나중에 붙이면 인덱스 전면 재구축).
```

**MVP 커트라인 제안**: F-02-17(워크스페이스 1개 + 스코프 규약) + F-02-01(단순화 버전) + F-02-02 + F-02-03 + F-02-04 + F-02-11(휴지통 1단계로 축소) + F-02-13(서브페이지만) + F-02-15 + F-02-16(단순 라우트) + F-02-21(제목 검색 + Recents) + F-02-12(Private/Workspace 2단 + 3레벨 권한). F-02-08은 드래그 이동만 우선.

**v1**: F-02-05 아이콘, F-02-09 딥카피, F-02-13 @멘션, F-02-14 백링크, F-02-18 멤버 간 공유, F-02-19 스냅샷 히스토리, F-02-21 본문 전문 검색, F-02-22 Markdown 내보내기.
**v2**: F-02-06 커버, F-02-10 잠금, F-02-12 teamspace 3종 접근 유형·게스트, F-02-18 웹 게시, F-02-20 peek, F-02-22 PDF/가져오기, F-02-23 wiki.

**"나중에 붙이면 전면 재작업"이라 MVP에 미리 심어야 하는 것 4가지**: ① `workspace_id` 스코프(F-02-17), ② 소유 엣지와 alias/참조 엣지의 분리(F-02-13/I6), ③ 삭제 상태 머신과 `live_block` 뷰 강제(F-02-11), ④ 검색 인덱스의 권한 스코프 컬럼(F-02-21).

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인의 접근 | 차용 포인트 |
|---|---|---|
| **Docmost** | `pages` 테이블에 `id(UUIDv7)`, `slugId`, `title`, `icon`, `position(fractional index)`, `parentPageId`, `spaceId`, `workspaceId`, `ydoc(Y.js CRDT binary)`, `textContent(검색용 평문)`, `deletedAt/deletedById` 컬럼. 트리는 인접 리스트, `parentPageId = null`이 루트. 클라이언트는 `treeDataAtom`에 트리 상태를 두고 자식은 lazy load, 변경은 WebSocket으로 실시간 반영. | **가장 실용적인 참고 대상.** `position` fractional index + 인접 리스트 조합, `textContent` 별도 컬럼으로 전문 검색 분리, `ydoc` 바이너리를 페이지 행에 직접 저장하는 구조를 그대로 차용할 만하다. |
| **Docmost (정렬)** | `fractional-indexing-jittered`의 `generateJitteredKeyBetween()`으로 위치 생성, SQL 정렬은 `collate('C')`로 lexicographic 보장. 페이지 복제 시에도 fractional index로 원본 바로 뒤에 배치. | jitter를 넣으면 동시 삽입 시 두 클라이언트가 같은 키를 만들 확률이 줄어든다. **`collate('C')` 누락은 실제로 정렬이 깨지는 함정**이므로 반드시 반영. |
| **Docmost (트리 UI)** | 초기에 `react-arborist` 사용 → v0.90.0(PR #2199)에서 자체 트리 구현으로 교체. `#308`처럼 사이드바 트리 동기화 불일치 이슈가 실제로 발생했다. | 사이드바 트리는 라이브러리로 시작하되 **동기화 버그를 예상하고 상태 소스를 단일화**할 것. 서버 응답을 진실로 삼고 낙관적 업데이트는 롤백 경로를 준비. |
| **Docmost (연산)** | Move = 같은 space 내/space 간 이동. Duplicate = 서브트리 딥카피 + 첨부 매핑. Delete = soft delete(휴지통) + 영구 삭제 2단계. | 세 연산 모두 노션과 의미가 일치한다. **첨부 매핑(attachment mapping)을 복제 스펙에 반드시 포함**해야 한다는 점이 실무적 교훈. |
| **Outline** | Collection(권한 경계) + Document(`parentDocumentId`로 중첩). Collection이 "읽기/쓰기 권한을 사용자·그룹에 부여하는 레벨". 문서 복제 시 `parentDocumentId`를 주면 그 부모 아래로 들어가고 부모의 collection에 속한다. | **Collection ≒ Teamspace**. 권한 경계를 페이지마다가 아니라 컨테이너 레벨에 두면 권한 모델이 극적으로 단순해진다. MVP 권한 축소 전략의 근거. |
| **AppFlowy** | workspace → space → page 계층. 페이지 중첩 지원, 데이터베이스 row도 열면 전체 페이지가 되는 노션식 모델. | "database row = page" 개념까지 노션과 동일하게 가져간 사례. 도메인 03(데이터베이스)과의 접점 설계 시 참고. |
| **AFFiNE / BlockSuite** | 블록 기반 문서 모델 + CRDT(Y.js) 기반 협업. `[확인필요]` — 페이지 트리를 블록 트리와 어떻게 분리/통합하는지 이번 조사에서 1차 출처로 확인하지 못함. | 페이지-블록 통합 모델(F-02-01 원본 방식)을 끝까지 밀어붙인 사례로 추가 조사 가치 있음. |

### 채택 권고 (종합)

1. **트리 저장**: 인접 리스트(`parent_id`) + fractional index(`position`) + `collate('C')`. materialized path는 나중에.
2. **권한 경계**: 페이지마다가 아니라 **컨테이너(space/teamspace) 레벨을 1차 경계**로 두고(Outline 방식), 페이지 단위 오버라이드는 `permission` 테이블의 예외 행으로만 처리.
3. **삭제**: 반드시 soft delete. `parent_id`/`position`을 삭제 시 건드리지 않아야 원위치 복원이 공짜로 된다.
4. **검색/전문 인덱스**: 블록 JSON에서 평문을 추출한 `text_content` 컬럼을 페이지 행에 유지(Docmost 방식).
5. **실시간**: 사이드바 트리 변경은 WebSocket 브로드캐스트. MVP는 mutation 후 캐시 invalidate로 대체 가능.

---

## 미해결 / 확인필요

> 2026-09-06 GAP 재조사에서 Q1·Q2는 해소, Q3·Q5는 부분 해소(2차 출처 수렴), Q6은 재조사에도 확인 불가로 남았다. 아래 표에 상태를 갱신했다.


| # | 항목 | 왜 중요한가 | 확인 방법 |
|---|---|---|---|
| Q1 | ~~페이지 중첩 깊이 상한~~ **[해소]** 공식 헬프가 "infinite levels of organization"으로 상한 없음을 명시. 남은 미확인은 공개 API의 요청당 2단계 중첩 제약(커뮤니티 보고) | 재귀 쿼리 가드 값 결정 | 제품 상한은 없음 → 가드는 성능 목적(예: depth 100)으로만 둔다 |
| Q2 | ~~"Link to page"가 `parent_id`를 바꾸는가~~ **[해소]** 공식 헬프: 링크한 페이지가 "사이드바에 그 페이지의 서브페이지로 표시"될 뿐 대상은 원 위치에 그대로 있다 → **사이드바 별칭(보조 엣지)** 으로 결론. 남은 미확인: 노션 내부가 별도 엣지 레코드인지 블록 해석인지 | 소유 vs 참조 구분의 핵심 | `sidebar_alias` 모델 채택(F-02-13) |
| Q3 | 페이지 복제 시 서브트리 내부 상호 링크가 사본 내부로 재매핑되는가 **[부분 해소]** 공식 헬프에 복제 문서 자체가 없음. 2차 출처는 "복제 범위 밖 멘션은 원본을 계속 가리킨다"로 일치, 범위 안은 불명 → 우세 가설 "재매핑하지 않는다" | 템플릿 기능의 실용성이 여기서 갈림 | A→B 링크가 있는 트리를 복제 후 사본 A'의 링크가 B인지 B'인지 확인. 클론은 재매핑을 기본으로 채택하기로 결정 |
| Q4 | 부모가 영구 삭제된 자식 페이지의 복원 위치 | 복원 UX와 데이터 정합성 | 노션에서 부모 영구 삭제 후 자식 복원 시도 |
| Q5 | 휴지통의 스코프 **[부분 해소]** 2차 출처 다수가 "teamspace에서 지운 것은 그 teamspace 휴지통, private은 개인 휴지통"으로 일치. 공식 헬프에는 명시 없음 | 휴지통 UI와 권한 필터 설계 | 두 계정·두 teamspace로 삭제 후 각 Trash 패널 비교 |
| Q6 | font/small text/full width가 페이지 속성인가 열람자별 설정인가 **[여전히 미해소]** 2026-09 헬프 재확인에서도 어느 쪽도 명시하지 않음. 확인된 것은 "전 페이지 기본값 설정 기능은 없다"뿐 | 스키마 배치가 달라짐 | 두 계정으로 같은 페이지를 동시에 열고 한쪽에서 Full width를 켜 상대 화면 관찰. 그때까지는 `COALESCE(user_pref, page_meta)` 병합 규칙으로 양쪽을 흡수 |
| Q7 | 접근 권한 없는 백링크의 "건수"가 노출되는가 | 정보 유출 정책. 건수만으로도 존재가 드러남 | 권한 없는 계정으로 백링크 영역 관찰 |
| Q8 | 잠긴 페이지가 이동/삭제/레이아웃 변경까지 막는가 | 서버 가드 범위 결정 | 잠금 후 사이드바에서 Move/Delete 시도 |
| Q9 | 페이지 이동 시 URL(id) 불변 여부, 워크스페이스 간 이동 시 URL 처리 | 링크 안정성 보장 범위 | 이동 전후 URL 비교 |
| Q10 | AFFiNE/BlockSuite의 페이지-블록 트리 통합 방식 | F-02-01 원본 모델을 끝까지 밀 때의 실증 사례 | BlockSuite 저장소 스키마 코드 직접 확인 |
| Q11 | Teamspace 삭제 시 하위 페이지 처리 정책 | 데이터 유실 방지 | 노션 Teamspace 설정에서 삭제 플로우 확인 |
| Q12 | "Shared" 섹션이 실제 저장 컨테이너인지 파생 뷰인지 | 스키마에 컬럼이 필요한지 결정 | 페이지를 공유했다 해제했을 때 위치 변화 관찰. (보강: 헬프가 "pages that you've shared with select individuals ... will appear under your sidebar's Shared section"이라 기술 → 파생 뷰 가설이 더 유력해졌으나 확정은 아님) |
| Q13 | Notion 3.4 신 사이드바가 전면 롤아웃되었는가, 구 사이드바와 병존하는가 | 클론이 어느 구조를 정본으로 삼을지 | 릴리스 노트가 "opt-in to try it out"이라 표현 — 2026-09 시점 롤아웃 상태 재확인 필요 |
| Q14 | 버전 히스토리 스냅샷의 범위가 페이지 본문인가 서브트리 전체인가 | 스냅샷 용량·복원 단위가 달라짐 | 자식 페이지를 수정한 뒤 부모의 Version history에 그 변경이 잡히는지 확인 |
| Q15 | 검색 결과가 권한으로 필터된다는 명시 문장이 공식 문서에 있는가 | 당연해 보이지만 근거 없이 단정하지 않기 위해 | 헬프 search 문서·보안 백서 확인 |
| Q16 | "Turn into wiki"가 하위 페이지를 database row로 바꾸는가, 되돌릴 수 있는가 | F-02-23과 도메인 03의 접점 설계 | 서브페이지가 있는 페이지를 wiki로 전환 후 자식의 URL·parent 변화 관찰 |
| Q17 | 게시(Publish)된 페이지의 하위 페이지가 함께 공개되는가 | 공개 렌더의 권한 경계 | 서브페이지가 있는 페이지를 게시 후 로그아웃 상태로 자식 URL 접근 |
| Q18 | link_to_page가 백링크로도 집계되는가(@멘션만인가) | `page_link` 파싱 대상 결정 | Link to page 블록만 삽입한 뒤 대상 페이지의 backlink 수 확인 |

---

## 출처

### 1차 출처 — Notion 공식

1. https://www.notion.com/blog/data-model-behind-notion — 블록 단일 모델, id/type/properties/content/parent 스키마, parent 기반 권한 해석, content 배열의 순서 의미
2. https://www.notion.com/help/navigate-with-the-sidebar — 사이드바 섹션 구성, 드래그 중첩, `+`/`•••` 메뉴, `cmd/ctrl+\`, `cmd/ctrl+K`, 정렬/표시 개수 설정, Move to, breadcrumb 축약
3. https://www.notion.com/help/intro-to-workspaces — 워크스페이스 vs 계정, Teamspace/Shared/Private/Favorites 섹션, breadcrumb 정의, 워크스페이스 스위처
4. https://www.notion.com/help/intro-to-teamspaces — Open/Closed/Private 3종, owner/member 역할, default teamspace, Enterprise 보안 옵션
5. https://www.notion.com/help/sharing-and-permissions — 권한 레벨 7종, 서브페이지 권한 상속, "broadest level of access" 규칙, Private 이동 시 서브페이지 권한 유지, Publish
6. https://www.notion.com/help/duplicate-delete-and-restore-content — 삭제 경로 3종, 30일 보존, 복원 시 원위치 복귀, 버전 히스토리 플랜별 기간
7. https://www.notion.com/help/create-links-and-backlinks — `@`/`[[`/`+`/`/link` 링크 생성 4종, Copy link to block, 백링크 자동 생성·제목 위 표시·권한 필터, mention vs Link to page 차이
8. https://www.notion.com/help/customize-and-style-your-content — 폰트 3종, Small text, Full width, Customize page(Show backlinks / Page discussions)
9. https://www.notion.com/help/guides/page-icons-and-covers — 아이콘 소스(Emoji/Icon/Upload), 랜덤 아이콘, 커버 추가/변경/갤러리/업로드/Link
10. https://www.notion.com/help/create-a-subpage — 사이드바 `+`로 서브페이지 생성, 서브페이지의 부모 권한 상속
11. https://www.notion.com/help/collaborate-within-a-workspace — 페이지 잠금 동작, Locked 배지, unlock for me / for everyone, Lock database
12. https://www.notion.com/help/custom-data-retention-settings — 휴지통 보존 기간 커스터마이즈(Enterprise)
13. https://www.notion.com/help/transfer-content-to-another-account — 워크스페이스 간 이동, 이동 시 Private 섹션 도착, 서브페이지 동반 이동
14. https://www.notion.com/help/transfer-content-deprovisioned-user — 계정 비활성화 시 Private 콘텐츠 이관
15. https://www.notion.com/help/guides/how-to-use-and-customize-the-sidebar-with-teamspaces — Favorites의 per-user 성질, Teamspace 정렬의 전 멤버 공통 성질

### 1차 출처 — Notion 공식 API

16. https://developers.notion.com/reference/page — page object 스키마(id, created_time/by, last_edited_time/by, archived, in_trash, icon, cover, properties, parent, url, public_url), parent 타입 4종
17. https://developers.notion.com/reference/block — block object 구조, 자식 가능 블록 타입 목록, `child_page`/`child_database`/`link_to_page`/`synced_block` 제약
18. https://developers.notion.com/reference/trash-page — 휴지통 전용 엔드포인트

### 2차 출처 — 오픈소스 구현

19. https://deepwiki.com/docmost/docmost/4-page-management — Docmost pages 테이블 스키마, fractional index, 트리 구성/lazy load/WebSocket, move/duplicate/soft delete
20. https://github.com/docmost/docmost/releases/tag/v0.90.0 — react-arborist → 자체 트리 구현 교체(PR #2199)
21. https://github.com/docmost/docmost/issues/308 — 사이드바 page-tree 동기화 불일치 사례
22. https://www.getoutline.com/developers , https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV — Outline collection(권한 경계) + document `parentDocumentId` 중첩 구조
23. https://appflowy.com/compare/appflowy-vs-docmost — AppFlowy의 workspace/space/page 계층과 중첩 페이지, database row = page 모델

### 1차 출처 — 2026-09-06 GAP 재조사에서 추가 확인

24. https://www.notion.com/releases/2026-03-26 — Notion 3.4 사이드바 4탭 재편("organized it into four new tabs, with easy access to your pages, agent chats, meetings, and notifications"), 섹션 on/off 커스터마이즈, opt-in 롤아웃
25. https://www.notion.com/help/search — Quick Find(`cmd/ctrl+K` / `cmd/ctrl+P`), Best matches 기본 정렬, Title only / Created by / Teamspace / Date range 필터, 검색 창 초기 상태의 최근 방문 목록
26. https://www.notion.com/help/share-your-work — Share 팝오버 흐름, 게스트 초대, General access("Anyone on the web with link")와 편집/댓글/보기 수준
27. https://www.notion.com/help/public-pages-and-web-publishing — Publish 탭, 웹 게시(Notion Sites)
28. https://www.notion.com/help/add-members-admins-guests-and-groups — 멤버/관리자/게스트/그룹 구분
29. https://www.notion.com/help/workspace-settings — 워크스페이스 설정, 전체 콘텐츠 export 진입점
30. https://www.notion.com/help/export-your-content — 형식(HTML/Markdown/CSV/PDF), "Include subpages"(PDF 서브페이지는 Business·Enterprise), `index.html` 사이트맵과 로컬 상대 링크
31. https://www.notion.com/help/import-data-into-notion — PDF/HTML/Text·Markdown/Word 가져오기, 다중 파일 제약
32. https://www.notion.com/help/wikis-and-verified-pages — "Only pages can be turned into wikis", 기본 owner = 생성자, 검증 30일/90일/무기한, 만료 시 Inbox·이메일 알림
33. https://www.notion.com/help/guides/verify-knowledge-your-teammates-can-trust-with-page-verification — 검증 만료·재검증 운영
34. https://www.notion.com/help/guides/tips-to-keep-your-teams-notion-pages-up-to-date — 버전 히스토리 스냅샷 주기(활발한 편집 중 10분, 마지막 편집 2분 후), Can edit 이상 접근
35. https://www.notion.com/help/back-up-your-data — 백업 스냅샷과 30일 복구 창
36. https://www.notion.com/help/manage-teamspaces — "nest pages inside each other for infinite levels of organization"(중첩 깊이 상한 없음), teamspace 참여 개수 무제한
37. https://www.notion.com/help/views-filters-and-sorts , https://www.notion.com/releases/2022-07-20 — 데이터베이스 뷰의 "Open pages in"(side peek / center peek / full page), Table·Board·List·Timeline의 side peek 기본값
38. https://www.notion.com/help/duplicate-public-pages , https://www.notion.com/help/transfer-content-to-another-account — 공개 페이지 복제, 워크스페이스 간 이동·복제

### 정정된 인용

- `https://www.notion.com/help/duplicate-delete-and-restore-content` 는 현재 **"Delete & restore content"** 로, **페이지 복제(Duplicate) 설명이 없다.** F-02-09의 근거로 인용했던 것을 철회하고 2차 출처 기반임을 명시했다.
- 같은 문서에서 휴지통 보존이 **2단계**임을 확인해 F-02-11을 정정했다: "By default, pages will remain in Trash for 30 days before they are permanently deleted from Trash. Once pages are permanently deleted from Trash, they are retained for 30 days before they become inaccessible to all users, even workspace owners."
- Notion API page object의 cover File object `type`은 `external` 또는 **`file_upload`** 다(과거 `file` 표기 정정). 출처: https://developers.notion.com/reference/page

---

## 변경 이력

### 2026-09-06 GAP 재조사 (2차 패스)

| 구분 | 내용 |
|---|---|
| **오류 정정** | ① 휴지통 보존을 "30일 후 소멸"에서 **2단계(휴지통 30일 → 영구 삭제 후 retention 30일 → 소멸, Enterprise 1일~10년)** 로 수정 ② F-02-09의 공식 출처가 복제를 다루지 않음을 확인하고 인용 철회 ③ 커버 File object 타입 `file` → `file_upload` |
| **근거 없는 단정 철회** | F-02-07의 "font/full width는 페이지 속성이라 모든 열람자에게 동일" — 공식 문서에 근거가 없어 철회하고 `[확인필요]` + 양쪽을 흡수하는 병합 규칙(`COALESCE(user_pref, page_meta)`)으로 대체 |
| **미확인 항목 해소** | Q1(중첩 깊이 상한 없음), Q2(`link_to_page` = 사이드바 별칭, 대상 이동 없음 → `sidebar_alias` 모델 채택) |
| **최신성 반영** | 사이드바를 **2026-03-26 Notion 3.4의 4탭 구조**(Home / Chats / Meetings / Inbox, Home 안에 Recents·Favorites·Teamspaces·Shared·Private, 섹션 on/off·순서 변경)로 갱신 |
| **기능 추가** | F-02-17 워크스페이스/스위처, F-02-18 공유·게스트·웹 게시, F-02-19 버전 히스토리, F-02-20 열기 모드(peek), F-02-21 검색·Recents, F-02-22 export/import, F-02-23 wiki·owner·verification (16 → **23개**) |
| **엣지 케이스 보강** | alias 그래프 사이클(A↔B의 link_to_page), 권한 변경 시 WebSocket 구독 해제, 삭제된 페이지를 열어 둔 세션(410), 복원과 동시편집의 충돌, 검색 인덱스의 권한 지연, export zip의 권한 재적용 불가 |
| **난이도 재평가** | F-02-11 M(단, 첨부 GC·teamspace 스코프 포함 시 L), F-02-21 검색을 **L**로 신설(권한 인지 인덱스 + CJK 토크나이징 때문에 과소평가되기 쉬움), F-02-19 버전 히스토리 **L**(동시편집 중 복원이 난점), F-02-17 M이지만 **미착수 시 후행 비용이 XL** |
| **스키마 확장** | `workspace`, `workspace_member`, `page_version`, `share_link`, `sidebar_alias`, `page_owner`, `job` 테이블 추가. `block`의 삭제 컬럼을 3상태 머신(`trashed_at`/`purged_at`/`hard_delete_after`/`deleted_root_id`)으로 재설계, `live_block` 뷰 강제 규약 도입 |
