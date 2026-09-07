# 12. 플랫폼 · UX 디테일 · 성능

> 조사 기준일: 2026-09-06 / GAP 점검·보완: 2026-09-06 / 1차 출처: notion.com/help, notion.com/blog(엔지니어링), notion.com/releases, developers.notion.com
> 태그 규칙: `[추정]` = 공개 근거 없이 추론한 내용, `[확인필요]` = 출처 간 충돌하거나 검증 못 한 내용

## 요약

이 도메인은 "블록/DB 기능"이 아니라 **그 기능이 어느 플랫폼에서, 얼마나 빠르게, 어떤 입력 수단으로 동작하는가**를 규정한다.
노션은 웹/데스크톱(Electron)/모바일(iOS·Android)/브라우저 확장(Web Clipper) 4개 클라이언트를 운영하며, 이들 모두 **동일한 block record store를 로컬 SQLite에 캐싱**하고 서버와 동기화하는 구조를 공유한다.
성능 전략의 핵심은 서버 왕복 제거다: 데스크톱/모바일은 네이티브 SQLite, 웹은 WASM SQLite(OPFS)를 캐시로 써서 페이지 네비게이션을 20~50% 단축했다.
오프라인 모드(2025-08, 2.53)는 이 캐시 계층 위에 "어떤 페이지를 왜 로컬에 유지하는가"를 기록하는 별도 테이블을 얹어 구현됐다.
UX 디테일(단축키, 다크모드, 모바일 컬럼 붕괴, 호버 없음)은 대부분 **동일 데이터·다른 렌더링 정책**으로 처리된다.
서버 측 성능의 전제는 **workspace(space) id를 샤드 키로 하는 Postgres 수평 샤딩**(32대 → 96대 재샤딩)이고, 클라이언트 측 전제는 **`loadPageChunk` + `RecordCache`**라는 공식 문서화된 두 구조물이다(F-12-05/06/19).

> **GAP 점검 1차(2026-09-06)**: 파일 업로드 한도(출처 간 상충), 모바일 최소 OS 버전, `cmd/ctrl + N`의 플랫폼 범위, `loadPageChunk`/`RecordCache`의 출처 등급 등 근거가 약했던 주장을 1차 출처로 재검증해 수정했다.
>
> **GAP 점검 2차(2026-09-06, 중단분 재개)**: 1차 점검이 예고만 하고 본문을 쓰지 못한 **F-12-15~19를 실제로 작성**했다 —
> 플랫폼 지원 매트릭스(F-12-15) · 오류/복구 UX(F-12-16) · 배포·버전 스큐(F-12-17) · 성능 계측(F-12-18) · 서버 샤딩(F-12-19).
> 함께 해소한 것: **서명 URL 만료 시간(1시간, 공식 확인)**, **파일 한도가 4개 축으로 분리된다는 사실**(저장/렌더/임포트/요청본문 — "상충"이 아니었음),
> **모바일이 하이브리드 구조라는 점**, **VPAT는 없는 게 아니라 공개되지 않은 것**.
> 난이도 재검토: F-12-02 M→**M~L**(권한 사전계산 필요), F-12-08 L→**L~XL**(formula 의존 DAG), F-12-09 M→**L**, F-12-11 M→**M~L**.
> 신규 P0 판정: **F-12-16 오류/복구 UX** — "저장 실패를 사용자가 모르는 상태"는 데이터 손실과 동치이므로 MVP 필수.

## 핵심 개념 / 데이터 모델

이 도메인을 관통하는 엔티티는 "콘텐츠"가 아니라 **클라이언트 로컬 상태**다.

```
-- 서버 측 (다른 도메인 문서에서 정의되는 것들)
block(id, type, parent_id, parent_table, properties jsonb, content uuid[], format jsonb,
      created_time, last_edited_time, version, alive bool, space_id)

-- 클라이언트 로컬 캐시 (SQLite: 데스크톱/모바일 네이티브, 웹은 WASM+OPFS)
record_cache(
  table       text,        -- 'block' | 'collection' | 'collection_view' | 'space' | 'notion_user'
  id          uuid,
  version     bigint,      -- 서버 버전. 서버 version > 로컬이면 무효화
  value       blob,        -- 직렬화된 레코드 (JSON 또는 바이너리)
  fetched_at  bigint,
  PRIMARY KEY(table, id)
)

-- 오프라인 유지 대상 관리 (출처: notion.com/blog/how-we-made-notion-available-offline)
offline_page(
  page_id                uuid PRIMARY KEY,
  last_downloaded_ts     bigint,    -- 재접속 시 서버 version과 비교해 delta만 fetch
  download_state         text,      -- queued | downloading | ready | failed
  bytes                  bigint     -- [추정] 용량 관리용
)
offline_action(                     -- "왜 이 페이지가 오프라인에 남아있는가"의 이유 집합
  page_id  uuid,
  reason   text,   -- 'toggled' | 'auto_downloaded' | 'inherited' | 'favorited'
  PRIMARY KEY(page_id, reason)
)
-- 이유가 0개가 되면 해당 페이지를 로컬에서 제거. reason이 여러 개면 하나 해제해도 유지된다.
-- 문서 표현: "a forest of offline page trees"

-- 로컬 변경 큐 (오프라인 편집 → 재접속 시 전송)
pending_transaction(
  txn_id      uuid PRIMARY KEY,
  space_id    uuid,
  ops         blob,       -- operation 배열
  created_at  bigint,
  state       text        -- pending | sending | acked | conflicted
)

-- 사용자/디바이스 설정 (설정 범위가 계정 단위인지 디바이스 단위인지가 중요)
user_setting(
  user_id, key, value, scope   -- scope: 'account' | 'device'
)

-- 플랫폼/배포 정책 (F-12-15, F-12-17) — 비샤딩 글로벌 DB에 둔다
platform_support(platform, policy_kind, min_version, last_n, action, message_key)
feature_availability(feature_key, platform, state, min_app_version, reason_key)
feature_flag(key, enabled_for jsonb, min_client_version, rollout_pct)
release(version, channel, released_at, min_supported_client, bundle_hash)

-- 샤딩 라우팅 (F-12-19) — 이것도 글로벌 DB
shard_map(space_id, logical_shard, physical_db, migrated_at)
logical_shard_placement(logical_shard, physical_db, state)
-- 규칙: 샤딩 대상 테이블(block/collection/discussion/comment...)은 space_id NOT NULL 필수.
--       부모를 따라가야 space_id를 알 수 있으면 라우팅 전에 쿼리가 한 번 더 생긴다.
-- scope='account' 예: 언어, 시간대, 주 시작 요일, 다크모드(계정 내 모든 워크스페이스 공통)
-- scope='device' 예: 고대비 모드, 오프라인 다운로드 목록
```

**핵심 규칙 (플랫폼·성능 도메인을 관통하는 6가지)**

| 규칙 | 내용 | 근거 |
|---|---|---|
| 캐시 우선 렌더 | 로컬 SQLite에 레코드가 있으면 먼저 렌더하고 네트워크 응답으로 갱신. 느린 기기에서는 SQLite read와 API 요청을 **경쟁(race)**시켜 먼저 오는 쪽을 쓴다 | notion.com/blog WASM SQLite |
| 오프라인 대상은 디바이스 단위 | 폰에서 받은 오프라인 페이지는 노트북에 자동 반영되지 않음 | notion.com/help/use-pages-offline |
| 설정 범위 분리 | 다크모드는 계정 전역(모든 워크스페이스), 고대비는 디바이스별 | notion.com/help/account-settings |
| 블록 트리는 양방향 포인터 | `content[]`는 **하향 포인터**(자식 순서), `parent`는 **상향 포인터**. 상향 포인터는 **권한 상속 계산**을 위해 존재한다고 공식 문서가 명시 | notion.com/blog/data-model-behind-notion |
| 로드 단위는 페이지가 아니라 chunk | 클라이언트는 `loadPageChunk`로 시작점부터 content 트리를 내려가며 블록을 받아 **RecordCache**에 넣고, 그 뒤 레이아웃 → React 렌더 | notion.com/blog/data-model-behind-notion |
| 샤드 키는 workspace | "각 블록은 정확히 하나의 workspace에 속한다"는 성질 덕분에 space id 샤딩이 cross-shard join을 제거한다. **부모 체인이 같은 샤드 안에 있으므로 권한 계산도 단일 샤드에서 끝난다** | notion.com/blog/sharding-postgres-at-notion |
| 지원 범위는 절대 버전이 아니라 상대 윈도우 | 브라우저 지원을 "Chrome 최근 8개 Extended stable / 나머지 최근 2개 major"로 정의한다 — 시간이 지나면 하한이 자동으로 올라간다 | notion.com/help/system-requirements-for-notion |
| 최종 복구 수단은 로컬 전체 폐기 | `Reset & Erase All Local Data`가 존재할 수 있는 이유는 **서버가 source of truth**이기 때문. local-first로 가면 이 탈출구가 사라진다 | notion.com/help/reset-notion |

## 기능 명세

### F-12-01 키보드 단축키 체계 (전역 · 편집 · 블록 선택)

- **한 줄 정의**: 마우스 없이 블록 생성/변환/이동/서식/네비게이션을 수행할 수 있게 하는 키 바인딩 레이어.
- **사용자 시나리오**:
  1. 빈 블록에서 `cmd/ctrl + option/shift + 1` → 해당 블록이 H1로 전환된다(텍스트 보존).
  2. `esc` → 커서 편집 모드에서 **블록 선택 모드**로 전환, 현재 블록이 하이라이트된다.
  3. `shift + ↓` 반복 → 선택 범위를 아래 블록으로 확장.
  4. `cmd/ctrl + shift + ↓` → 선택 블록 전체를 한 칸 아래로 이동.
  5. `cmd/ctrl + D` → 선택 블록 복제. `backspace` → 삭제.
- **동작 상세**:
  - 단축키는 **모드 의존적**이다. 편집 모드(caret 있음)와 블록 선택 모드(caret 없음)에서 같은 키가 다르게 동작한다. 예: `cmd/ctrl + A`는 편집 모드에서 현재 블록 텍스트 전체 선택, 다시 누르면 블록 선택으로 확장.
  - Mac은 `cmd + option + <숫자>`, Windows/Linux는 `ctrl + shift + <숫자>`로 블록 타입 변환: 0=텍스트, 1/2/3=H1/H2/H3, 4=to-do, 5=불릿, 6=번호, 7=토글, 8=코드, 9=새 페이지.
  - 마크다운 입력 규칙(input rule)은 **줄 시작에서만** 트리거: `#`+space, `##`, `###`, `-`/`*`/`+`+space, `1.`+space, `[]`+space, `>`+space, `"`+space, `---`(divider). 인라인 규칙: `**bold**`, `*italic*`, 백틱 코드, `~~strike~~`.
  - 서식: `cmd/ctrl + B/I/U`, `cmd/ctrl + shift + S`(취소선), `cmd/ctrl + E`(인라인 코드), `cmd/ctrl + K`(링크), `cmd/ctrl + shift + H`(마지막 사용 색 재적용).
  - 구조: `tab`/`shift+tab`(들여쓰기/내어쓰기), `cmd/ctrl + option/alt + T`(모든 토글 열기/닫기), `cmd/ctrl + shift + U`(상위 페이지로), `cmd/ctrl + [`/`]`(뒤로/앞으로).
  - 표: `cmd/ctrl + R`(오른쪽으로 채우기), `cmd/ctrl + D`(아래로 채우기) — **동일 키가 블록 선택 상태에서는 복제이므로 컨텍스트 분기 필요**.
  - `option/alt + drag` = 블록 복제 드래그.
  - 데이터베이스 행 간 이동: Mac `ctrl + shift + K/J`, Windows `ctrl + K/J`(이전/다음).
- **엣지 케이스**:
  - IME(한글/일본어/중국어) 조합 중 `enter`/`esc`는 IME가 먼저 소비해야 한다. `compositionstart`~`compositionend` 사이에 단축키 핸들러를 무력화하지 않으면 조합 문자가 깨진다.
  - 브라우저 예약 키 충돌: `cmd/ctrl + N`(새 창), `cmd/ctrl + T`(새 탭), `cmd/ctrl + W`는 웹에서 가로챌 수 없다 → 노션도 이들을 **데스크톱 앱 전용** 단축키로 문서화한다.
  - 코드 블록 내부에서 `tab`은 들여쓰기 문자여야 하고 블록 nesting이 되면 안 된다.
  - 빈 블록에서 `backspace` → 블록 타입을 텍스트로 되돌리고, 이미 텍스트면 이전 블록과 병합.
  - 권한 없음(read-only)일 때 모든 변형 단축키는 no-op이어야 하며, 선택/복사/네비게이션 단축키는 살아있어야 한다.
  - 대용량 선택(수천 블록)에서 `cmd+shift+arrow` 이동은 O(n) 재정렬을 유발 → 배치 트랜잭션 1건으로 처리.
- **데이터 모델 함의**:
  ```
  keybinding(id, action_id, mac_combo, win_combo, context)
  -- context: global | editor | block_selection | table | code_block | modal
  command(action_id, label, handler, requires_permission, undoable)
  ```
  실제 DB 저장이 필요한 것은 사용자 커스터마이즈 가능한 항목뿐이다(노션은 데스크톱 Command Search 단축키만 커스터마이즈 허용). 나머지는 코드 상수 테이블로 충분.
- **UI/인터랙션**: 단축키 실행 결과는 즉시 낙관적 반영. 블록 hover 시 좌측 드래그 핸들 + `+` 버튼 노출. 우클릭 또는 `cmd/ctrl + /`로 블록 컨텍스트 메뉴.
- **의존 기능**: 블록 모델, 블록 선택 모드, undo 스택.
- **구현 난이도**: **L** — 키 조합 자체는 쉽지만 모드 × 컨텍스트 × OS × IME 4중 분기와 브라우저 예약키 우회가 실제 비용이다.
- **우선순위**: **P0** — 단축키 없는 블록 에디터는 마우스 전용 도구가 되어 핵심 UX가 붕괴한다. P0 최소 세트: markdown input rules, `enter`/`shift+enter`, `tab`/`shift+tab`, `backspace` 병합, `esc` 블록 선택, `cmd+B/I/U/K/E`, `cmd+D`, `cmd+Z`/`cmd+shift+Z`, `/` 메뉴.
- **클론 시 현실적 대안**: 키맵을 선언적 테이블 하나로 정의하고 ProseMirror `keymap` 플러그인 + `inputRules`에 위임. OS 분기는 `event.metaKey || event.ctrlKey` 정규화 한 곳에서 처리. 숫자 단축키(블록 타입 전환)와 표 fill 단축키는 v1로 미뤄도 무방.
- **참고 출처**: https://www.notion.com/help/keyboard-shortcuts

---

### F-12-02 Quick Find / 커맨드 팔레트 (cmd/ctrl + K, cmd/ctrl + P)

- **한 줄 정의**: 어디서든 키 하나로 페이지·명령을 검색해 이동하거나 실행하는 오버레이.
- **사용자 시나리오**: `cmd+P` → 오버레이 오픈 → 최근 방문 페이지 목록 먼저 표시 → 타이핑하면 제목/본문 매칭 결과로 교체 → `↑/↓` 이동, `enter` 이동, `esc` 닫기.
- **동작 상세**:
  - 입력이 비어 있을 때는 **검색이 아니라 최근 항목(Recents)**을 보여준다. 체감 속도의 핵심 요소.
  - `cmd/ctrl + K`는 **텍스트가 선택된 상태에서는 링크 추가**로 동작하고, 선택이 없을 때만 검색으로 동작한다(같은 키의 컨텍스트 분기).
  - 데스크톱 앱은 앱 밖에서도 호출되는 **Command Search**를 별도로 제공하며, 그 단축키는 사용자 지정 가능하다.
  - 결과 항목에는 페이지 아이콘과 상위 경로(breadcrumb)를 함께 표시한다.
- **엣지 케이스**:
  - **빈 값**: 입력이 비면 검색이 아니라 Recents. Recents도 비어 있으면(신규 계정) 템플릿/새 페이지 액션으로 폴백.
  - **권한 없음**: 권한 없는 페이지 제외. **제목 자체가 정보 누출**이므로 인덱스 조회 후 필터링이 아니라 쿼리 조건(space_id + ACL)에 함께 걸어야 한다. 후필터링하면 "총 N건 중 3건 표시" 같은 카운트만으로도 존재가 새어나간다.
  - **삭제된 참조**: 인덱스에는 있으나 휴지통으로 간 페이지 → `alive=false` 필터 필수. 영구 삭제된 페이지가 `recent_visit`에 남으면 클릭 시 404 → 조회 시 join으로 걸러내거나 삭제 이벤트로 tombstone 정리.
  - **동시편집**: 결과 목록을 보는 동안 다른 사용자가 제목을 바꾸거나 페이지를 옮기면 breadcrumb이 낡는다. 클릭 시점에 최신 레코드로 재해석해야 하며, 인덱스 갱신이 비동기인 이상 **수 초의 stale은 정상 동작으로 명시**해야 한다 `[추정]`.
  - **순환 참조**: breadcrumb을 만들려면 부모 체인을 거슬러 올라가는데 데이터 오류로 순환이 생기면 무한 루프가 된다 → 깊이 상한(예: 32) + 방문 집합 체크.
  - **대용량**: 수십만 페이지 워크스페이스에서 접두 검색은 인덱스 없이 초 단위가 된다. 입력 debounce(150~250ms) + 이전 요청 취소(AbortController) + 서버 limit 20건 `[추정]`.
  - 검색 인덱스 미구축/장애 → 제목 `ILIKE` 매칭으로 폴백. 오프라인에서는 로컬 캐시 레코드만 검색 대상 `[추정]`.
  - 결과 0건 → "새 페이지 만들기" 액션 제시. 한글 초성/자모 분리 매칭은 별도 정규화가 필요하며 영어 tokenizer로는 동작하지 않는다.
- **데이터 모델 함의**:
  ```
  recent_visit(user_id, page_id, visited_at, space_id)   -- 정렬 키, LRU
  search_index(page_id, space_id, title, plain_text, updated_at)
  -- 권한 필터는 인덱스 조회 후가 아니라 쿼리 조건에 함께 걸어야 한다(space_id + ACL)
  ```
- **UI/인터랙션**: 모달 오버레이, 포커스 트랩, 배경 스크롤 잠금, hover와 키보드 커서 동기화, `esc` 2단계(입력 지우기 → 닫기).
- **의존 기능**: 검색 인덱스, 권한 모델, 최근 방문 기록.
- **구현 난이도**: **M~L** (기존 **M**에서 상향) — 오버레이 UI는 반나절이 맞다. 상향 근거는 **권한 필터링이 과소평가되기 쉬운 항목**이기 때문이다. 노션의 권한은 (a) 페이지 트리를 따라 **상속**되고 (b) 중간 노드에서 **오버라이드**될 수 있으며 (c) 개인·**그룹**·게스트·teamspace 멤버십이 겹친다. 이 조건에서 "이 사용자가 볼 수 있는 페이지 집합"은 검색 쿼리 안에서 **한 번의 SQL로 표현 가능해야** 하는데, 순진하게 짜면 후보 행마다 부모 체인을 거슬러 올라가는 재귀 쿼리가 되어 상위 N건 반환에도 전체 스캔이 걸린다. 실용적 해법은 **권한을 사전 계산해 materialize**하는 것(예: `page_acl_effective(page_id, principal_id)` 반정규화 테이블 + 권한 변경 시 서브트리 재계산 잡)이고, 이 재계산 잡이 M을 L로 밀어 올린다. 검색 인덱스 자체는 기성품(Meilisearch/tsvector)으로 M을 유지한다.
- **우선순위**: **P0** — 사이드바만으로는 페이지 수가 수십 개를 넘는 순간 네비게이션이 불가능해진다.
- **클론 시 현실적 대안**: MVP는 Postgres `tsvector` 또는 제목 `ILIKE` + `recent_visit` 테이블로 충분. 전문 검색은 v1에서 Meilisearch/Typesense로 교체. 한국어는 형태소 분석기 대신 n-gram 인덱스로 시작.
- **참고 출처**: https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/notion-for-desktop

---

### F-12-03 테마 시스템 (라이트 / 다크 / 시스템 + 고대비 모드)

- **한 줄 정의**: 계정 단위 색 테마와 디바이스 단위 고대비 모드를 적용하는 표현 레이어.
- **사용자 시나리오**: Settings → Preferences → Appearance → `Use system setting` / `Light` / `Dark` 선택. 어디서든 `cmd/ctrl + shift + L`로 즉시 토글. 별도 드롭다운 `High contrast`에서 `Use system setting` / `Standard` / `High contrast` 선택.
- **동작 상세**:
  - 다크모드 선택은 **계정에 로그인된 모든 워크스페이스에 동일 적용**된다(워크스페이스를 전환해도 유지).
  - 고대비 모드는 **베타이며 데스크톱·웹 전용**, **디바이스별로 저장**된다(한 기기에서 켜도 다른 기기에 전파되지 않음). 헬프 문서 원문으로 3개 모두 확인됨: "currently in beta", "available on Notion desktop and web only", "This setting is saved per device. Choosing it on one device won't update this setting on your other devices". 참고로 2026-07-30 릴리스 노트에는 beta/per-device 표기가 **없다** → 릴리스 노트보다 헬프 문서가 더 정확한 사례. 텍스트·아이콘·테두리 대비를 높이며 라이트/다크 선택과 **독립적으로** 동작한다 → 실질적으로 2×2 = 4가지 조합을 디자인해야 한다.
  - `Use system setting`은 OS의 `prefers-color-scheme`(및 대비 설정)을 구독하며, OS 설정 변경 시 리로드 없이 반영된다.
  - 사용자가 블록에 지정한 텍스트/배경 색은 테마별로 **다른 실제 색상값**으로 매핑된다. 즉 색은 이름(토큰)으로 저장되고 렌더 시 해석된다.
  - 발행된 Notion Sites에도 System/Light/Dark 테마 옵션이 별도로 존재한다.
- **엣지 케이스**:
  - 초기 렌더 플래시(FOUC): 앱 번들 로드 전에 테마를 알아야 하므로 테마 값은 쿠키/localStorage 등 **가장 빨리 읽히는 곳**에 중복 저장해 첫 페인트 전에 루트 요소에 세팅해야 한다 `[추정]`.
  - 이미지·임베드는 테마를 따르지 않는다 → 다크 모드에서 흰 배경 PNG가 튄다. 노션이 이를 자동 보정하는지는 `[확인필요]`.
  - 코드 블록 신택스 하이라이트는 별도 팔레트가 필요하다.
  - 고대비 + 사용자 지정 블록 색 조합에서 WCAG 대비 미달이 발생할 수 있어, 고대비 모드에서는 블록 색 팔레트를 별도 세트로 치환해야 한다 `[추정]`.
- **데이터 모델 함의**:
  ```
  user_setting(user_id, key=theme, value=system|light|dark, scope=account)
  device_setting(device_id, key=contrast, value=system|standard|high, scope=device)
  -- 색은 값이 아니라 토큰으로 저장
  block.format.block_color = blue_background | red | ...
  -- 렌더 시: theme x contrast x token -> CSS custom property
  ```
- **UI/인터랙션**: `cmd/ctrl + shift + L` 토글. 전환 트랜지션은 200ms 이내여야 깜빡임으로 인식되지 않는다 `[추정]`.
- **의존 기능**: 사용자 설정 저장, 디자인 토큰 시스템, 블록 색 속성.
- **구현 난이도**: **S**(라이트/다크만) / **M**(고대비 포함 4조합 + 색 토큰 매핑).
- **우선순위**: **P1** — 기능 동작에는 영향이 없으나 노션 사용자 기대치의 기본선. 고대비는 P2.
- **클론 시 현실적 대안**: CSS custom properties + `:root[data-theme=dark]` + `prefers-color-scheme` 미디어 쿼리 3중 정의. 색 토큰은 `--color-block-blue` 형태로 테마별 재정의. 고대비는 토큰 세트 파일 하나 추가로 처리.
- **참고 출처**: https://www.notion.com/help/account-settings , https://www.notion.com/releases/2026-07-30

---

### F-12-04 오프라인 모드 (페이지 다운로드 · 로컬 편집 · 재접속 동기화)

- **한 줄 정의**: 지정한 페이지를 디바이스에 저장해 네트워크 없이 열람·편집하고, 연결 복구 시 자동 동기화한다.
- **사용자 시나리오**:
  1. 온라인 상태에서 페이지 우상단 `•••` → `Available offline` 토글 ON → 진행 바 → 완료.
  2. 비행기 모드에서 해당 페이지 열기 → 편집 가능. 미지원 블록은 삽입 불가.
  3. 네트워크 복구 → 백그라운드에서 로컬 변경 전송 + 서버 변경 수신.
  4. Settings → Offline 탭에서 다운로드된 페이지 목록 확인/검색/제거, 자동 다운로드 끄기.
- **동작 상세**:
  - **플랫폼**: 데스크톱 앱(Mac/Windows) + 모바일 앱(iOS/Android). **웹 브라우저 미지원.**
  - **플랜**: 수동 다운로드는 Free 포함 전 플랜. **Recents/Favorites 자동 다운로드는 Plus/Business/Enterprise**.
  - **범위**: 오프라인 지정은 **디바이스 단위**. 폰에서 받은 것이 노트북에 반영되지 않는다.
  - **하위 페이지는 부모를 오프라인 지정해도 자동 다운로드되지 않는다.**
  - **데이터베이스는 첫 번째 뷰의 첫 50행만** 오프라인 동기화된다.
  - 유지 이유가 `offline_action`에 다중 기록된다: `toggled`(수동), `auto_downloaded`, `inherited`, `favorited`. 이유가 전부 사라지면 로컬에서 제거된다(공식 블로그 표현: offline page tree의 forest).
  - 동기화는 폴링이 아니라 **push 기반**: 서버가 페이지 단위 채널에 업데이트 배치를 emit하고, 클라이언트는 자신의 오프라인 페이지 채널들을 구독한다.
  - 재접속 시 페이지별 `lastDownloadedTimestamp`와 서버 버전을 비교해 **변경된 페이지만** 내려받는다.
  - 리치 텍스트 충돌 해결을 위해 페이지가 **CRDT 데이터 모델로 동적 마이그레이션**된다(세부 알고리즘 미공개) `[확인필요: 어떤 CRDT인지, Yjs 계열인지 자체 구현인지 비공개]`.
- **엣지 케이스**:
  - **텍스트 편집은 자동 병합되지만, 비텍스트 편집(데이터베이스 property 변경 등)은 여러 사용자가 동시에 오프라인 편집하면 하나만 저장된다** — 사실상 last-writer-wins.
  - 오프라인에서 사용 불가: 임베드, AI 블록, 폼, 버튼, 페이지 공유/권한 편집. 일부 미지원 블록은 슬래시 메뉴에는 보이지만 삽입되지 않는다.
  - **삭제된 참조**: 오프라인 중 서버에서 삭제된 페이지를 로컬에서 편집한 경우의 노션 정책은 `[확인필요]`(공개 문서 없음). 클론 권장안은 **"조용히 폐기하지 말고 복원 후 고지"** — 삭제는 되돌릴 수 있지만(휴지통) 사용자가 오프라인에서 쓴 글은 되돌릴 수 없으므로, 손실 비용이 비대칭이다. 구현: op 적용 시 대상 페이지가 `alive=false`면 페이지를 되살리고 "이 페이지는 다른 곳에서 삭제되었으나 오프라인 편집이 있어 복원했습니다" 배너를 붙인다.
  - **순환 참조**: `offline_action.reason='inherited'`로 트리를 전파할 때 페이지 트리에 순환(데이터 오류 또는 relation 기반 전파)이 있으면 다운로드 큐가 무한 확장된다 → 방문 집합 + 깊이 상한(예: 32) + 큐 크기 상한이 필요하다.
  - **대용량**: 수천 페이지 워크스페이스를 통째로 오프라인 지정 → 초기 다운로드가 수십 분·수 GB가 된다. 다운로드는 **우선순위 큐**(최근 방문 → 즐겨찾기 → 나머지)로 처리하고, 디스크 예산 상한과 셀룰러/Wi-Fi 구분이 필요하다. 노션이 **자동 다운로드를 Recents/Favorites로 한정**하고 **하위 페이지를 자동 포함하지 않는** 것이 이 문제에 대한 제품 차원의 답이다.
  - **빈 값**: 오프라인 지정한 페이지가 빈 페이지 → 다운로드는 즉시 완료되지만 `download_state`가 `ready`로 전이하는지 확인 필요(0바이트 전송을 실패로 오판하지 않을 것).
  - 오프라인 중 권한이 회수된 페이지는 재접속 시 로컬 사본을 즉시 제거해야 한다(보안) `[추정]`.
  - 다운로드 중 앱 종료 → `download_state`가 `downloading`에 고착되지 않도록 재시작 시 재큐잉.
  - 51번째 행 이후를 오프라인에서 조회 → 빈 상태 + "온라인에서 확인" 안내가 필요.
  - 디스크 용량 부족 시 다운로드 실패 처리 및 사용자 고지.
- **데이터 모델 함의**: 상단 `offline_page` / `offline_action` / `pending_transaction`이 기반이고, 아래가 오프라인을 실제로 성립시키는 추가 스키마다.
  ```
  -- [클라이언트] 오프라인 대상 트리 (공식 표현: "a forest of offline page trees")
  offline_page(page_id PK, root_page_id, depth int, last_downloaded_ts bigint,
               server_version bigint,       -- 재접속 시 델타 판정 기준. timestamp가 아니라 version으로 비교
               download_state text,         -- queued | downloading | ready | failed | stale
               failure_reason text NULL, bytes bigint, updated_at bigint)
  offline_action(page_id, reason, created_at, PRIMARY KEY(page_id, reason))
  -- reason ∈ toggled | auto_downloaded | inherited | favorited
  -- GC 규칙: SELECT page_id FROM offline_page WHERE page_id NOT IN (SELECT page_id FROM offline_action)
  --          → 로컬에서 제거. reason이 여럿이면 하나 해제해도 유지된다(참조 카운팅과 동형).

  -- [클라이언트] 부분 동기화 경계 (DB는 첫 뷰 첫 50행만)
  offline_collection_window(
    collection_id PK, view_id,      -- "첫 번째 뷰"만 대상
    row_limit int DEFAULT 50,
    synced_row_ids uuid[],          -- 이 밖의 행은 "존재하지만 없음" 상태로 렌더해야 한다
    query_hash text                 -- 필터/정렬이 바뀌면 창(window) 자체가 무효
  )

  -- [클라이언트] 변경 큐 (F-12-16의 확장 필드 포함)
  pending_transaction(txn_id PK, space_id, page_id, ops blob, created_at,
                      state, attempt_count, next_attempt_at, error_code, origin)

  -- [클라이언트] 충돌 병합 상태. 리치 텍스트는 CRDT로, 그 외는 LWW로 갈린다.
  crdt_doc(page_id PK, doc_state blob, state_vector blob, migrated_at)
  -- 노션은 "페이지를 CRDT 데이터 모델로 동적 마이그레이션"한다고만 밝힌다(알고리즘 미공개).
  -- 함의: CRDT 적용 범위가 페이지 단위이며, 모든 페이지가 항상 CRDT인 것은 아니다 `[추정]`.

  -- [서버] push 채널과 단조 증가 버전
  page_channel(page_id PK, latest_version bigint)          -- 페이지 단위 pub/sub 토픽
  subscription(device_id, page_id, subscribed_at, PRIMARY KEY(device_id, page_id))
  -- 디바이스가 자신의 오프라인 페이지 채널들을 구독한다. 오프라인 지정이 디바이스 단위인 이유가 여기 있다.
  device_offline_manifest(device_id, page_id, granted bool, revoked_at NULL)
  -- 권한 회수 시 revoked_at을 세팅 → 재접속한 디바이스가 로컬 사본을 즉시 폐기(보안)
  ```
  **되돌릴 수 없는 결정 3개**: ① 레코드에 **단조 증가 `version`**을 둘 것(timestamp 비교는 클라이언트 시계 편차로 깨진다), ② `offline_action`을 **이유 집합**으로 둘 것(단일 bool로 두면 "즐겨찾기 해제했더니 수동 다운로드까지 사라짐" 버그가 구조적으로 발생), ③ 변경을 **op 배열**로 저장할 것(스냅샷 저장 방식은 병합이 불가능하다).
- **UI/인터랙션**: `•••` 메뉴 토글 + 진행 바, Settings → Offline 대시보드(목록/검색/제거/자동 다운로드 스위치), 오프라인 상태 배너, 동기화 대기 인디케이터.
- **의존 기능**: 로컬 캐시(F-12-05), 트랜잭션/op 모델, 실시간 pub/sub, CRDT 또는 OT 병합, 권한 모델.
- **구현 난이도**: **XL** — 로컬 스토어 + 변경 큐 + 충돌 해결 + 이유 기반 GC + 부분 동기화(50행)가 각각 독립 서브시스템이다. 노션도 정식 출시까지 오래 걸렸다(2.53, 2025-08-19).
- **우선순위**: **P2** — MVP에서 오프라인 편집을 시도하면 데이터 모델 전체를 오프라인 우선으로 재설계해야 한다. 대신 "오프라인 읽기 전용 캐시"만 P1으로 잡는다.
- **클론 시 현실적 대안**:
  1. MVP: 온라인 전용 + 네트워크 끊김 시 **읽기 전용 캐시**(마지막으로 본 페이지) + 편집 차단 배너.
  2. v1: Yjs + `y-indexeddb` 조합으로 문서 단위 오프라인 편집. Yjs가 병합을 대신 처리하므로 자체 OT 구현을 피할 수 있다.
  3. 오프라인 대상 선정은 "명시 토글 + 최근 N개"만. `inherited` 트리 전파는 v2.
- **참고 출처**: https://www.notion.com/blog/how-we-made-notion-available-offline , https://www.notion.com/help/use-pages-offline , https://www.notion.com/releases/2025-08-19

---

### F-12-05 클라이언트 로컬 캐시 (SQLite / WASM SQLite + OPFS)

- **한 줄 정의**: 서버 왕복 없이 페이지를 렌더하기 위해 block record를 클라이언트 로컬 DB에 저장하는 캐시 계층.
- **사용자 시나리오**: 사이드바에서 이전에 방문한 페이지 클릭 → 스피너 없이 즉시 콘텐츠 표시 → 잠시 후 서버 최신본으로 조용히 갱신.
- **동작 상세**:
  - 데스크톱/모바일은 **네이티브 SQLite**, 웹은 **WASM SQLite + OPFS(Origin Private File System)**.
  - 웹 도입 전에는 IndexedDB를 썼으나 **스토리지 쿼터, 다수의 버그, Windows에서의 성능 문제**로 교체했다.
  - OPFS VFS 변종 비교:

    | 변종 | 문제 | 채택 |
    |---|---|---|
    | `sqlite3_vfs` OPFS | cross-origin isolation 헤더 필요(서드파티 스크립트 다수라 비현실적), 다중 탭 동시 쓰기 시 DB 손상 | X |
    | **OPFS SyncAccessHandle Pool VFS** | cross-origin isolation 불필요 → Safari/Firefox 포함 전 브라우저 가능. 단 다중 탭 동시 접근 불가 | **O** |

  - 다중 탭 문제 해결: **탭마다 dedicated Web Worker** + **SharedWorker가 활성 탭을 선출** → 모든 탭의 쿼리는 SharedWorker를 거쳐 활성 탭의 Worker 하나로 라우팅된다. 닫힌 탭은 **Web Locks**의 무한 대기 락 해제로 감지한다.
  - 느린 기기 대응: **SQLite 읽기와 API 요청을 race**시켜 먼저 도착한 결과로 렌더. 쓰기는 트랜잭션 배치로 묶는다.
  - WASM은 비동기 로드되어 **초기 로드 시간은 동일**하게 유지되고, 이득은 네비게이션에서 발생한다.
  - 측정 결과: 페이지 네비게이션 **전 브라우저 평균 20% 개선**, 지역별 호주 28% / 중국 31% / 인도 33%. 데스크톱 SQLite 전환 + 코드 스플리팅 조합은 초기 로드와 네비게이션 **각각 약 50% 개선**.
- **엣지 케이스**:
  - 다중 탭 동시 쓰기 → DB 손상. 반드시 단일 writer로 직렬화.
  - 활성 탭 크래시 → Web Lock 해제 감지 후 다른 탭이 승격되어야 한다.
  - 시크릿 모드/사이트 데이터 차단 → OPFS 접근 자체가 throw. **캐시 없이도 정상 동작하는 폴백 경로가 필수**.
  - 스키마 마이그레이션 실패 시 **캐시 전체 폐기(drop & rebuild)**가 가장 안전하다(원본은 서버에 있으므로 손실 없음).
  - 캐시 무효화는 서버 `version` 비교로. timestamp만 쓰면 클라이언트 시계 편차로 오작동한다.
  - 용량 증가 → LRU 제거 정책 필요. `[추정: 노션의 eviction 정책은 미공개]`
- **데이터 모델 함의**: 상단 `record_cache` 스키마 + `cache_meta(schema_version, last_vacuum_at)`.
  노션 공식 데이터 모델 글이 이 계층의 이름을 직접 밝힌다 — `loadPageChunk`로 받은 블록이 **메모리 또는 로컬 캐시(RecordCache)**로 들어가고, 그 뒤 레이아웃 → React 렌더. 즉 `record_cache`의 **존재 자체는 추론이 아니라 1차 출처로 확인된 사실**이며, 내부 컬럼 구성만 `[추정]`이다.
- **UI/인터랙션**: 사용자에게 직접 노출되지 않는 계층. 단 캐시 히트 시 스켈레톤 UI를 띄우지 않는 것이 핵심 체감 차이다.
- **의존 기능**: 정규화된 클라이언트 레코드 스토어, 레코드 버전 필드.
- **구현 난이도**: **XL** — WASM SQLite + OPFS + SharedWorker 라우팅은 그 자체로 하나의 서브프로젝트다.
- **우선순위**: **P2**(WASM SQLite 기준). 단 **"정규화된 클라이언트 레코드 스토어 + 버전 기반 무효화" 설계 자체는 P0** — 나중에 넣으려면 전면 재작성이 된다.
- **클론 시 현실적 대안**:
  - MVP: TanStack Query의 stale-while-revalidate + 메모리 정규화 스토어. 서버는 `loadPageChunk` 유사 단일 엔드포인트로 페이지 서브트리를 한 번에 반환.
  - v1: IndexedDB(idb/Dexie)에 record 캐시 영속화 + 캐시 크기 상한.
  - v2: `sqlite-wasm`/`wa-sqlite` + OPFS SyncAccessHandle Pool. 다중 탭은 처음부터 SharedWorker 단일 writer로 설계.
- **참고 출처**: https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite , https://www.notion.com/blog/faster-page-load-navigation , https://www.notion.com/blog/data-model-behind-notion

---
### F-12-06 에디터 렌더링 성능 (대용량 페이지)

- **한 줄 정의**: 수천 개 블록으로 이루어진 페이지에서 입력 지연과 스크롤 끊김이 발생하지 않도록 렌더링 비용을 제한하는 기법 묶음.
- **사용자 시나리오**: 3,000단어 + 이미지 + 토글이 섞인 페이지를 연다 → 상단부터 순차적으로 렌더 → 타이핑 시 입력한 블록만 갱신되고 나머지 블록은 리렌더되지 않는다 → 접힌 토글 내부는 펼치기 전까지 DOM에 존재하지 않는다.
- **동작 상세**:
  - 페이지는 단일 문서가 아니라 **수천 개의 레코드**다. 클라이언트는 이를 fetch → hydrate → render해야 하고, 트리 깊이가 임의로 깊을 수 있어 의존성 해소가 렌더 선행 조건이 된다.
  - 렌더러가 **React**이고 데이터가 **RecordCache**를 거친다는 것은 1차 출처로 확인된다("loads into memory or local caches (RecordCache)", "we lay out the page and render it using React").
  - 반면 **"블록 단위 subscriber 노드를 가진 커스텀 reactive store"**는 3자 기술 분석 글 근거이며 **노션 공식 문서에 없다** `[확인필요]`. 다만 "블록마다 독립 `contenteditable` + React 기본 렌더 = 조상 리렌더가 전체 하위 트리로 전파"라는 문제 자체는 구조적으로 성립하므로, **클론이 블록 단위 구독을 채택할 근거로는 충분하다**(노션이 실제 그렇게 했는지와 무관하게).
  - **접힌 토글 내부는 렌더하지 않는다** — 열릴 때 렌더한다. 이는 사용자가 직접 활용할 수 있는 성능 레버이기도 하다(긴 섹션을 토글로 감싸면 초기 블록 수가 줄어든다).
  - 초기 데이터는 페이지 전체가 아니라 **chunk 단위**로 로드된다. 노션 공식 문서 서술: `loadPageChunk`는 "시작점에서 content 트리를 따라 내려가며 블록을 반환"한다. 스크롤에 따라 추가 chunk를 요청한다. — **이 항목은 3자 분석이 아니라 1차 출처로 확인됨**(기존 문서는 근거를 3perf로만 달고 있었음).
  - 임베드/이미지는 지연 로드 대상이며, 대형 이미지와 무거운 임베드가 체감 성능의 주 원인으로 지목된다.
- **엣지 케이스**:
  - **가상 스크롤과 `contenteditable`의 충돌**: 화면 밖 블록을 DOM에서 제거하면 (a) 브라우저 네이티브 `cmd+F`가 동작하지 않고 (b) 전체 선택/복사가 깨지고 (c) 셀렉션 앵커가 소실된다. 노션이 실제 가상화를 쓰는지는 `[확인필요]`이며, 관찰되는 동작은 **점진적 chunk 렌더 + 토글 지연 렌더**에 가깝다 `[추정]`.
  - 매우 긴 단일 블록(수만 자 코드 블록)은 블록 단위 가상화로 해결되지 않는다 → 신택스 하이라이트를 뷰포트 범위로 제한해야 한다 `[추정]`.
  - 이미지 수백 개 페이지 → `IntersectionObserver` 기반 지연 로드 + `width/height` 지정으로 레이아웃 시프트 방지.
  - 동시 편집 중 원격 op가 초당 수십 건 들어올 때 리렌더 폭주 → op 배치 + requestAnimationFrame 병합.
  - undo 스택이 블록 수에 비례해 메모리를 잠식 → 스택 상한 필요.
- **데이터 모델 함의**:
  ```
  -- 서버: 페이지 서브트리를 chunk로 잘라 반환할 수 있어야 한다
  GET /loadPageChunk { pageId, cursor, limit, verticalColumns } -> { recordMap, cursor }
  block.content uuid[]        -- 자식 순서를 배열로 보관해야 부분 로드 시 순서 복원 가능
  block.format.toggle_collapsed bool   -- 접힘 상태(사용자별로 저장할지 문서별로 저장할지 결정 필요)
  -- 클라이언트: 블록 id -> 구독자 집합
  store.subscribe(blockId, cb)  -- 페이지 전체가 아니라 블록 단위 구독
  ```
- **UI/인터랙션**: 스켈레톤 대신 캐시 즉시 렌더, 스크롤 시 하단 chunk 로딩, 토글 펼침 시 100ms 이내 렌더 `[추정]`.
- **의존 기능**: 블록 트리 모델, 클라이언트 캐시(F-12-05), 실시간 op 스트림.
- **구현 난이도**: **L** — 블록 단위 구독 스토어와 chunk 로딩은 아키텍처 결정 사항이라 나중에 바꾸기 어렵다.
- **우선순위**: **P1** — MVP에서는 블록 200개 페이지가 대부분이라 문제가 드러나지 않지만, 구독 단위를 페이지로 잡아두면 나중에 전부 뜯어야 한다. **"블록 단위 상태 구독"만은 P0 설계 결정으로 취급**.
- **클론 시 현실적 대안**:
  - ProseMirror 사용 시: 문서 전체가 하나의 `contenteditable`이 되어 블록별 DOM 분리 문제는 사라지지만 대형 문서에서 트랜잭션 비용이 커진다. ProseMirror는 이미 DOM diff를 최소화하므로 **MVP에서는 가상화 없이 충분**.
  - 블록별 개별 에디터(Notion 방식) 채택 시: Zustand/Valtio 등으로 블록 id별 selector 구독 + `React.memo`.
  - 가상화가 필요해지면 `contenteditable` 손상이 없는 **읽기 전용 뷰에만** 적용하고, 편집 중에는 전체 렌더 유지.
- **참고 출처**: https://www.notion.com/blog/data-model-behind-notion (1차 — loadPageChunk · RecordCache · React) , https://3perf.com/blog/notion/ , https://www.techaheadcorp.com/blog/tech-stack-powering-notion-block-based-editor/ (3자 — subscriber store 서술) , https://www.notion.com/blog/faster-page-load-navigation

---

### F-12-07 초기 로딩 성능 (번들 · 요청 워터폴)

- **한 줄 정의**: 앱 첫 진입에서 첫 콘텐츠 페인트까지의 시간을 줄이기 위한 번들·요청 전략.
- **사용자 시나리오**: URL 진입 → 스피너 → 콘텐츠. 이 구간에서 JS 다운로드 → 파싱/실행 → API 요청 연쇄 → 렌더가 순차로 일어난다.
- **동작 상세** (2019년 외부 성능 분석 기준, **현재 수치와 다를 수 있음** `[확인필요]`):
  - 벤더/앱 번들 합계 1,100개 이상 모듈. 초기 렌더 시점 기준 미사용 코드 비율 vendor 39% / app 61%.
  - 저사양 기기 기준 JS 실행 총 4.9초, 첫 콘텐츠 페인트 데스크톱 6.2초 / 저사양 모바일 12.6초.
  - **콘텐츠 렌더 전에 순차 API 요청 9건**이 발생했고 그중 `loadPageChunk`가 블로킹 경로였다. 요청당 유선 70ms, 4G 300~500ms.
  - 서드파티 스크립트(Intercom, Segment, Amplitude)가 초기화 중 메인 스레드를 점유했고, 제거 시 모바일 렌더 시간 약 1초 단축.
  - 이후 노션 공식 개선: **코드 스플리팅으로 비핵심 코드 지연 로드** + 클라이언트/서버 캐싱 개선 + 데스크톱 IndexedDB→SQLite 전환 → **초기 로드·네비게이션 각각 약 50% 개선**.
- **엣지 케이스**:
  - 순차 요청 워터폴은 지연시간이 높은 지역에서 곱연산으로 악화된다(WASM SQLite 개선폭이 인도 33%, 중국 31%로 큰 이유).
  - 인증 리다이렉트가 워터폴 앞단에 끼면 모든 요청이 밀린다.
  - 로케일 데이터(예: moment locales 160KB+) 같은 "전부 번들되는 데이터"가 조용히 번들을 키운다.
  - 캐시 히트 시에도 WASM/워커 초기화가 동기라면 이득이 사라진다 → **비동기 로드 필수**.
- **데이터 모델 함의**: API 계약 문제로 보이지만, 아래 3가지는 **스키마 차원의 선결 조건**이다(나중에 붙이면 워터폴이 한 단씩 늘어난다).
  ```
  -- (1) 첫 화면에 필요한 것을 1회 요청으로 모으는 엔드포인트
  GET /bootstrap -> { user, spaces, sidebar_tree, initial_page_record_map, feature_flags, server_time }
  -- sidebar_tree는 전체 트리가 아니라 "펼쳐진 노드까지"만 내려야 한다. 접힘 상태를 서버가 알아야 하므로:
  sidebar_state(user_id, space_id, expanded_page_ids uuid[], scroll_top int)

  -- (2) 응답은 정규화된 recordMap이어야 중복 페치가 사라진다
  record_map = { block: {id: {value, role}}, collection: {...}, notion_user: {...} }
  -- role(권한 등급)을 레코드마다 동봉하지 않으면 "페이지 로드 → 권한 조회 → 재렌더" 왕복이 생긴다

  -- (3) HTML 인라인 하이드레이션을 하려면 직렬화 가능한 초기 상태와 캐시 키가 필요
  bootstrap_snapshot(user_id, etag, payload jsonb, generated_at)   -- CDN/edge 캐시 키
  feature_flag(key, enabled_for, min_client_version)               -- 번들 분기 결정(F-12-15/17)
  ```
  가장 중요한 결정은 **레코드에 `role`을 동봉할 것인가**다. 노션의 recordMap이 `{value, role}` 쌍으로 내려오는 이유가 이것이다 `[추정 — react-notion-x가 파싱하는 실제 응답 형태 기준]`.
- **UI/인터랙션**: 스피너 대신 스켈레톤, 캐시 히트 시 스켈레톤 생략.
- **의존 기능**: 라우팅, 인증, 캐시 계층.
- **구현 난이도**: **M** — 라우트 단위 code splitting + bootstrap 엔드포인트는 정형화된 작업.
- **우선순위**: **P1** — MVP 규모에서는 번들이 작아 문제되지 않으나 bootstrap 엔드포인트 설계는 초기에 잡는 게 싸다.
- **클론 시 현실적 대안**: Next.js/Vite 라우트 단위 코드 스플리팅 + 서버에서 초기 recordMap을 HTML에 인라인(하이드레이션 전 렌더 가능). 분석/모니터링 SDK는 `requestIdleCallback` 이후 로드.
- **참고 출처**: https://3perf.com/blog/notion/ , https://www.notion.com/blog/faster-page-load-navigation

---

### F-12-08 대용량 데이터베이스 성능 전략 (한도와 로딩 규칙)

- **한 줄 정의**: 행·속성 수가 커질 때 뷰 로딩 시간을 통제하기 위한 정량 한도와 쿼리 규칙.
- **사용자 시나리오**: 수만 행 DB의 테이블 뷰를 연다 → 첫 페이지 분량만 렌더 → 스크롤하면 추가 로드. 필터를 formula 속성에 걸면 눈에 띄게 느려진다.
- **동작 상세** (공식 헬프 문서 명시 수치):

  | 항목 | 한도 | 초과 시 |
  |---|---|---|
  | 데이터베이스당 행 | **250,000** | 경고 표시 후 추가 차단 |
  | 데이터베이스당 property | **500** | 기존 속성 제거 전까지 추가 불가 |
  | 페이지 하나의 전체 property 데이터 총량 | **2.5MB** | 초과 시 저장 제한 |
  | 데이터베이스 전체 property 총 크기 | **1.5MB** `[확인필요: 헬프 문서 문구가 페이지 기준인지 DB 기준인지 모호]` | — |
  | 양방향 relation 참조 | 상대 DB에서 **10,000회** | 초과 참조 불가 |

  - 로딩을 느리게 만드는 요인(공식): 행 수, **표시 중인 property 개수**, 다른 formula/rollup에 의존하는 formula 체인, **formula/rollup 속성에 건 필터·정렬**.
  - 공식 권장 최적화: 인라인 DB를 linked view로 대체, formula 체인 단순화, 필터는 select/multi-select/status/number/date 같은 단순 속성에 적용, 미사용 property 숨김, 오래된 행 제거 또는 `Created time` 필터로 제외.
- **엣지 케이스**:
  - rollup의 rollup, relation을 통한 formula → N+1 계산. 서버 사이드 사전 계산 없이는 선형 이상으로 악화된다.
  - 정렬 기준이 formula면 인덱스를 못 타므로 전체 스캔이 된다 → **formula 결과를 materialized column으로 캐싱**해야 인덱스 정렬이 가능하다 `[추정]`.
  - 그룹핑 뷰는 그룹 수만큼 쿼리가 갈라진다 → 그룹별 지연 로드 필요.
  - 오프라인에서는 첫 뷰 첫 50행만 존재(F-12-04).
  - 동시 편집 중 필터 조건에 맞지 않게 된 행 → 뷰에서 사라지는 애니메이션 처리와 "방금 편집한 행이 사라짐" 혼란 대응 필요.
- **데이터 모델 함의**:
  ```
  collection(id, schema jsonb)          -- property 정의(최대 500)
  collection_view(id, collection_id, type, query jsonb)  -- filter/sort/group/visible_properties
  -- 행은 block(type='page', parent=collection)
  page_property(page_id, property_id, value jsonb)  -- 또는 block.properties jsonb
  formula_cache(page_id, property_id, value, computed_at, deps_version)  -- 정렬/필터 인덱스용
  index: (collection_id, property_id, value) -- 단순 속성만
  ```
- **UI/인터랙션**: 무한 스크롤 + "N개 더 불러오기", 행 수 카운트, 한도 근접 경고 배너, 속성 숨김 토글.
- **의존 기능**: 데이터베이스/뷰/속성 모델, formula 엔진, 권한.
- **구현 난이도**: **L**(단순 속성만) / **XL**(formula·rollup 정렬·필터 포함) — 상향 근거를 명시한다. 페이지네이션 자체는 M이다. 문제는 **formula 엔진이 성능 기능이 아니라 의존성 그래프 문제**라는 점이다: ① formula가 다른 formula를 참조하고 rollup이 relation을 건너 계산되므로 **DAG를 만들고 위상 정렬**해야 하며, ② 어떤 행 하나의 값이 바뀌면 **어느 행들을 무효화할지**를 역방향 의존성으로 찾아야 하고(그러지 않으면 전체 재계산), ③ **순환 참조를 탐지해 거부**해야 하며(A의 formula가 B를, B가 A를 참조), ④ 정렬·필터를 인덱스로 태우려면 결과를 **materialize**해야 하는데 그 즉시 무효화 정확성이 정합성 문제로 승격된다. 노션이 공식 문서에서 "formula 체인을 단순화하라 / formula 속성에 필터·정렬을 걸지 말라"고 **사용자에게 권고**하는 것 자체가, 이 문제를 엔진 쪽에서 완전히 풀지 못했다는 증거다.
- **우선순위**: **P1** — MVP에서는 커서 페이지네이션(기본 50~100행) + 단순 속성 필터만 지원하면 충분하다.
- **클론 시 현실적 대안**: 뷰 쿼리를 SQL로 컴파일하고, formula 속성은 **정렬/필터 대상에서 제외**(UI에서 비활성화). 필요해지면 formula 결과를 generated column 또는 트리거 기반 캐시 테이블로 승격.
- **참고 출처**: https://www.notion.com/help/optimize-database-load-times-and-performance

---

### F-12-09 이미지 · 파일 업로드와 스토리지

- **한 줄 정의**: 파일을 블록 또는 DB 속성으로 업로드/링크하고, 미리보기와 다운로드를 제공한다.
- **사용자 시나리오**: 페이지에 파일을 드래그하거나 `/image`, `/file`, `/video`, `/audio`, `/pdf` 입력 → 업로드 진행률 → 렌더. 또는 URL을 붙여넣어 외부 링크로 임베드. DB의 `Files & media` 속성에도 동일하게 첨부한다.
- **동작 상세**:
  - 지원 포맷(공식 목록): HEIC, ICO, JPEG, JPG, PNG, TIF, TIFF, GIF, SVG, PDF, MD, WEBP, MP3, MP4, WAV, OGG.
  - 업로드 방식 4종: 드래그앤드롭 / `+` 또는 슬래시 명령 / URL 임베드 / DB `Files & media` 속성.
  - **파일 크기 한도 — 출처 간 상충을 해소했다(기존 `[확인필요]` 해결).** 헬프 문서 한 페이지 안에 "Free는 5MB 미만", "유료는 PDF 20MB · 이미지(PNG/JPG) 5MB 미만", "유료는 파일당 5GB"가 동시에 등장해 모순처럼 보인다. developers.notion.com 파일 문서가 이를 정리한다:

    | 구분 | 값 | 출처 |
    |---|---|---|
    | 업로드 한도 / **Free** 워크스페이스 | 파일당 **5 MiB** | developers.notion.com/docs/working-with-files-and-media |
    | 업로드 한도 / **유료** 워크스페이스 | 파일당 **5 GiB** | 동일 |
    | 단일 파트 업로드 상한 | **20 MiB** — 초과 시 multi-part 모드 필수 | 동일 |
    | 인라인 표시(미리보기) 한도 | 이미지 5MB / PDF 20MB 수준 | notion.com/help/images-files-and-media |
    | **임포트** 파일 한도 / Free | **5 MB** | notion.com/help/notion-error-messages (`Your file is over the limit`) |
    | **임포트** 파일 한도 / 유료 | **50 MB** | 동일 |
    | 파일명 최대 길이 | **900 bytes**(확장자 포함) | developers.notion.com/docs/working-with-files-and-media |
    | 붙여넣기 요청 본문 상한 | **500 KB** 초과 시 HTTP **413** | notion.com/help/notion-error-messages (`Request body too large`) |
    | 대량 복제 레이트 리밋 | **시간당 50,000 블록** | notion.com/help/notion-error-messages (`Rate limit reached`) |

    결론: 한도가 **4개 축으로 분리**되어 있다 — ① 저장(5MiB/5GiB), ② 인라인 렌더(5MB/20MB), ③ 임포트(5MB/50MB), ④ 전송 본문(500KB). 기존 문서가 "출처 간 상충"으로 본 것은 실제로는 **서로 다른 축의 값**이었다. **5GiB는 "저장 가능한" 한도, 5MB/20MB는 "블록으로 렌더해 보여줄 수 있는" 한도**다. 헬프 문서가 "이미지가 너무 커서 표시할 수 없다는 오류가 나면 파일 블록으로 올리라"고 안내하는 것이 이 해석을 뒷받침한다.
    Free의 5 MiB 상한이 multi-part 임계값 20 MiB보다 작으므로 **multi-part 업로드는 사실상 유료 전용**이다 `[추정 — 두 수치를 교차한 결론]`. API 계약 상세는 `09-api-integrations.md` F-09-08 참조.
  - 이미지 블록 조작: 모서리 드래그 리사이즈, 크롭, 마스크, 정렬(좌/중/우), 캡션, **alt text**, 하이퍼링크, 다운로드.
  - 파일 미리보기: PDF/문서는 인라인 표시, 새 탭 또는 전체화면으로 원본 열기. `space` 키로 이미지 전체화면.
  - 비디오/오디오는 자체 플레이어로 재생하되 브라우저/OS 코덱 미지원 시 재생되지 않는다.
  - URL 붙여넣기 시 웹 북마크는 메타데이터(og:title/description/image)를 자동 수집한다.
- **엣지 케이스**:
  - **업로드된 파일 URL은 서명 URL이며 정확히 1시간 후 만료된다 — 공식 문서로 확인됨(기존 `[추정]` 해소).** developers.notion.com 원문: "The `url` is a temporary signed link that **expires after 1 hour**." 파일 객체에 `expiry_time`(ISO 타임스탬프)이 동봉되며, 갱신 방법은 **페이지를 다시 fetch**하는 것뿐이다. 함의: ① **서명 URL을 DB에 저장하면 안 된다**(1시간 뒤 전부 죽는다) — 저장 대상은 `storage_key`이고 URL은 **응답 직전에 생성**해야 한다. ② 외부에 공유된 URL은 1시간 후 403/404가 된다(이것이 링크 유출 시의 안전장치이기도 하다). ③ 정적 사이트 생성기·캐시·이메일 알림에 URL을 박아 넣으면 반드시 깨진다.
  - 페이지 복제 시 파일을 복사할지 참조를 공유할지 결정 필요. 참조 공유면 원본 삭제가 사본을 깨뜨린다.
  - 워크스페이스 이전/내보내기 시 파일 재호스팅 필요.
  - SVG 업로드는 XSS 벡터다 → sanitize 또는 `<img>`로만 렌더하고 인라인 삽입 금지.
  - HEIC는 브라우저가 직접 렌더하지 못하므로 서버 변환이 필요하다.
  - 업로드 중 페이지 이탈 → 고아 파일 발생. GC 필요.
  - 한도 초과 이미지는 "이미지 블록"이 아니라 "파일 블록"으로 올리라고 안내한다(= 미리보기만 포기).
- **데이터 모델 함의**:
  ```
  file_asset(id, space_id, uploader_id, storage_key, mime, bytes, width, height,
             checksum, created_at, deleted_at)
  block(type='image'|'file'|'video'|'audio'|'pdf',
        properties.source = [[signed_url_or_asset_id]],
        format = { block_width, block_alignment, block_aspect_ratio, alt_text, caption })
  page_property(page_id, property_id, value = [file_asset_id, ...])  -- Files & media
  upload_session(id, asset_id, state, parts)   -- 멀티파트 업로드
  ```
- **UI/인터랙션**: 드래그 시 드롭 영역 하이라이트, 진행률 바, 이미지 hover 시 리사이즈 핸들, 캡션 입력란, 우클릭 컨텍스트 메뉴(교체/다운로드/캡션/alt/삭제).
- **의존 기능**: 오브젝트 스토리지, 서명 URL 발급, 블록 모델, 권한(파일 접근 통제).
- **구현 난이도**: **L** (기존 **M**에서 상향) — 근거: "파일 하나 올리기"만 보면 M이지만 이 기능이 실제로 요구하는 것은 ① 5GiB급 **멀티파트 업로드 + 중단 재개**, ② **서명 URL 발급/만료/재발급 경로**(저장 금지·조회 시점 생성), ③ **ref_count 기반 GC와 고아 파일 정리 잡**, ④ **HEIC/TIFF 서버 변환 + 썸네일 파이프라인**, ⑤ **SVG sanitize**, ⑥ 페이지 복제 시 복사 vs 참조 정책 — 6개의 독립 서브시스템이다. 단순 이미지 첨부만이면 M.
- **우선순위**: **P0**(이미지/파일 업로드) — 노트 앱에서 이미지 없는 것은 기능 결손으로 인식된다. 크롭/마스크/오디오 플레이어는 P2.
- **클론 시 현실적 대안**: S3 호환 스토리지(MinIO/R2) + presigned PUT 직업로드(서버 대역폭 절약). 미리보기는 `<img>`/`<video>` 네이티브 + PDF는 `<iframe>` 또는 pdf.js. 썸네일은 업로드 후 비동기 생성. Free 한도는 자체 정책으로 5MB 시작.
- **참고 출처**: https://www.notion.com/help/images-files-and-media , https://developers.notion.com/docs/working-with-files-and-media , https://developers.notion.com/docs/retrieving-files , https://www.notion.com/help/notion-error-messages

---

### F-12-10 웹 클리퍼 (브라우저 확장 · 모바일 공유 시트)

- **한 줄 정의**: 웹페이지 본문과 미디어를 파싱해 지정한 노션 페이지/데이터베이스에 새 페이지로 저장한다.
- **사용자 시나리오**: 브라우저 툴바의 확장 아이콘 클릭 → 팝업에서 워크스페이스 선택, 대상 페이지/DB 선택(또는 `+ New links database`로 새 DB 생성), 제목 편집 → `Save page` 또는 `enter`. 모바일은 공유 시트에서 Notion 선택 → 제목/대상 선택 → Save.
- **동작 상세**:
  - 지원 브라우저: Chrome, Safari(공식). 모바일은 공유 시트를 통해 클립. **주의: 웹 클리퍼 문서에 적힌 "iOS 13.0+ / Android 7.0+"는 현행 시스템 요구사항(iOS 17.0+ / Android 8+)과 충돌한다** — 클리퍼 문서가 갱신되지 않은 것으로 보인다 `[확인필요]`. 클론 설계에서는 낮은 쪽이 아니라 **앱 전체 최소 버전(F-12-15)을 따르는 것이 안전**하다.
  - 파싱은 사이트별로 결과가 다르다 — 공식 문서가 "모든 사이트를 같은 방식으로 파싱할 수 없어 노션에서의 서식이 달라진다"고 명시. 일부 대형 사이트는 최적화되어 있다.
  - 대상이 데이터베이스이면 **URL property가 자동으로 추가**된다(해당 속성이 없었더라도).
  - **클립 시점에 태그/속성 값은 지정할 수 없다** — 저장 후 DB에서 편집해야 한다.
  - 모바일에서는 사진 앨범의 이미지도 클립할 수 있으며, 로컬 파일은 URL property가 생성되지 않는다.
  - 브라우저가 아닌 앱(트위터 앱, iOS 메모 등)에서는 동작하지 않는다.
- **엣지 케이스**:
  - 로그인 필요/페이월 페이지 → 확장이 보는 DOM은 사용자 세션 기준이므로 클립되지만, 서버 사이드 페치 방식이면 실패한다 → **DOM 기반 추출이 맞다** `[추정]`.
  - SPA/무한 스크롤 페이지 → 현재 DOM만 캡처되어 일부 콘텐츠 누락.
  - 상대 경로 이미지/lazy-load 이미지(`data-src`) → 절대 URL 변환과 실제 로드 필요.
  - 동일 URL 재클립 → 중복 페이지 생성(dedupe 없음) `[확인필요]`.
  - 대상 워크스페이스에 쓰기 권한 없음 → 목록에서 제외되어야 한다.
  - 매우 큰 페이지 → 블록 수천 개 생성. 배치 트랜잭션 필요.
- **데이터 모델 함의**:
  ```
  clip_request(id, user_id, space_id, target_parent_id, source_url, title, html_snapshot)
  -- 변환 결과: HTML -> block[] (import 파이프라인과 동일 변환기 재사용)
  -- 대상이 collection이면 URL property를 없으면 생성 후 세팅
  ```
- **UI/인터랙션**: 확장 팝업(워크스페이스 셀렉터, 대상 셀렉터, 제목 입력, 저장 버튼), 저장 후 "노션에서 열기" 링크, 모바일 공유 시트 확장.
- **의존 기능**: HTML→block 변환기(임포트 기능과 공유), 인증 토큰을 확장에 전달하는 방식, 데이터베이스 property 자동 생성.
- **구현 난이도**: **L** — 확장 자체는 M이지만 HTML→block 변환 품질이 실제 난이도이고, 인증(확장에서의 세션 공유)과 브라우저별 매니페스트(MV3, Safari Web Extension) 대응이 붙는다.
- **우선순위**: **P2** — 없어도 제품이 성립한다. 단 HTML→block 변환기는 붙여넣기(paste) 처리와 공유되므로 그 부분은 P1.
- **클론 시 현실적 대안**: MVP는 확장 없이 **"URL 붙여넣기 → 서버가 Readability로 본문 추출 → 페이지 생성"** 형태의 인앱 기능으로 대체(Mozilla Readability + turndown). 확장은 v2에서 MV3 단일 코드베이스로.
- **참고 출처**: https://www.notion.com/help/web-clipper

---
### F-12-11 데스크톱 앱 (Electron 계열) 고유 기능

- **한 줄 정의**: 웹 앱과 동일한 코드베이스를 네이티브 셸로 감싸 탭·다중 창·전역 검색·OS 알림·자동 업데이트를 제공한다.
- **사용자 시나리오**: `cmd/ctrl + T`로 새 탭 → 탭 hover 시 미리보기 → `cmd/ctrl + shift + N`으로 새 창 → `option/alt + shift + click`으로 링크를 새 창에서 열기 → 앱 밖에서 전역 단축키로 Command Search 호출.
- **동작 상세**:
  - 헬프 문서가 **명시적으로 데스크톱 전용**이라 표기한 것은 `cmd/ctrl + shift + N`(새 창), `cmd/ctrl + T`(새 탭), `option/alt + shift + click`(새 창으로 열기) 3개다. `cmd/ctrl + click`(새 노션 탭으로 열기)도 여기 해당.
  - `cmd/ctrl + N`(새 페이지)은 헬프 문서의 **일반 단축키 목록**에 있으나 브라우저가 예약한 조합이라 **웹에서는 실질적으로 동작할 수 없다** `[추정 — 문서는 데스크톱 전용이라 표기하지 않음]`. 클론에서는 웹용 대체 조합(`cmd/ctrl + option + N` 등)을 별도로 둘 것.
  - **Command Search**: 앱이 포그라운드가 아니어도 사용자 지정 전역 단축키로 검색 창을 띄운다. Mac은 메뉴 바, Windows는 작업 표시줄에서도 호출 가능.
  - 시작 동작 설정: `Continue where you left off` 또는 `Your default page`. 로그인 시 자동 실행이 기본값(변경 가능).
  - 링크 처리: `Open links in desktop app`(OS 딥링크 등록), `Open Notion links in browser`, `Close redirecting browser tabs`.
  - 알림: 멘션, 작업 할당, 리마인더에 대한 OS 푸시 알림.
  - 자동 업데이트가 기본("We push updates on a regular basis"). 수동 확인 경로는 Mac `Notion` > `Check for Updates`, Windows `File` > `Check for Updates`. **신기능이 안 보이면 `cmd/ctrl + R`로 새로고침하라**는 것이 공식 안내인데, 이는 곧 **셸은 갱신됐지만 웹뷰 안의 JS 번들이 낡아 있는 상태가 실제로 존재한다**는 뜻이다(F-12-17에서 별도 취급).
  - Windows에는 IT 배포용 **MSIX 인스톨러**가 x64/Arm 두 종으로 제공되며, 설치 시 기존 프로필 데이터와 창 구성이 보존된다.
  - 최소 OS: **macOS 12 이상**, **Windows 10 version 21H2 이상**(또는 Windows Server 2016) — F-12-15.
  - 로컬 캐시로 네이티브 SQLite를 사용한다(F-12-05).
- **엣지 케이스**:
  - 딥링크 등록 충돌: 브라우저에서 노션 URL을 열면 앱으로 넘어가는데, 로그인 세션이 앱과 브라우저에서 다르면 잘못된 워크스페이스로 열린다 `[추정]`.
  - 다중 창 + 단일 SQLite writer 문제는 웹의 다중 탭 문제와 동일하다.
  - 여러 계정 로그인 시 창마다 다른 계정 표시 가능 여부 `[확인필요]`.
  - OS 알림 권한 거부 상태 처리, 방해 금지 모드 존중.
  - 자동 업데이트 실패 시 구버전 고착 → 서버 API 버전 호환 정책 필요.
  - 오프라인 상태에서 앱 시작 → 캐시로 부팅 가능해야 한다.
- **데이터 모델 함의**:
  ```
  device(id, user_id, platform, app_version, os, push_token, last_seen_at)
  device_setting(device_id, key, value)   -- 시작 동작, 전역 단축키, 링크 처리
  window_session(device_id, window_id, tabs jsonb, restored_at)  -- "이어서 보기" 복원용
  ```
- **UI/인터랙션**: 탭 바(드래그 재정렬, hover 미리보기), 창 관리, 메뉴 바/트레이 아이콘, 전역 단축키 설정 화면.
- **의존 기능**: 웹 앱 전체, 로컬 캐시, 알림 파이프라인.
- **구현 난이도**: **M~L** (기존 **M**에서 상향) — Electron 셸 자체는 정형화(탭/창/트레이/자동 업데이트는 `electron-updater` 등 기성품)라 M이지만, **코드 서명(Apple Developer ID + Windows 인증서) · 공증(notarization) · Arm/x64 이중 빌드 · MSIX 패키징 · 업데이트 서버 운영**까지 포함하면 L. 이 비용은 코드 난이도가 아니라 **릴리스 파이프라인 구축 비용**이라 첫 배포에 한꺼번에 몰린다.
- **우선순위**: **P2** — 웹 앱만으로 제품이 성립한다. 다만 오프라인을 진지하게 하려면 데스크톱 앱이 전제가 된다(노션도 웹은 오프라인 미지원).
- **클론 시 현실적 대안**: Electron 대신 **Tauri**(번들 크기·메모리 유리, Rust 백엔드에서 SQLite 직접 접근 용이). PWA(installable + Service Worker)로 시작해 전역 단축키·트레이가 필요해질 때 네이티브 셸로 이행.
- **참고 출처**: https://www.notion.com/help/notion-for-desktop , https://www.notion.com/help/account-settings , https://www.notion.com/help/keyboard-shortcuts

---

### F-12-12 모바일 앱과 데스크톱의 동작 차이

- **한 줄 정의**: 동일한 데이터를 좁은 화면·터치 입력·백그라운드 제약 환경에 맞춰 다른 렌더링·상호작용 규칙으로 표시한다.
- **사용자 시나리오**: 폰에서 페이지를 연다 → 데스크톱에서 만든 2단 컬럼이 **1단으로 펼쳐져** 위아래로 이어진다 → 블록 왼쪽에 `+`, 오른쪽에 `•••`이 **항상** 보인다(hover가 없으므로) → 키보드 위 툴바로 서식을 적용한다.
- **동작 상세** (공식 문서 명시 차이):

  | 항목 | 데스크톱/웹 | 모바일 |
  |---|---|---|
  | 컬럼 레이아웃 | 다단 유지 | **단일 컬럼으로 붕괴** |
  | 블록 액션 노출 | hover 시 `⠿`/`+` | **항상 표시되는 `•••`/`+`** |
  | 다중 블록 선택 | 가능 | **불가** |
  | 설정 범위 | 전체 | 알림(이메일/푸시) + 비밀번호만 |
  | 임포트 | 가능 | 불가(데스크톱/웹 필요) |
  | 계정 정보(사진/이메일/이름) 변경 | 가능 | 불가 |
  | 워크스페이스 삭제/탈퇴, 보안·결제 설정 | 가능 | 불가 |
  | 오프라인 | 데스크톱 앱만(웹 불가) | 지원 |
  | 고대비 모드 | 지원(베타) | 미지원 |

  - **최소 OS(공식 시스템 요구사항)**: **iOS 17.0 이상**, **Android 8 이상**. 지원 종료 기기 목록도 명시되어 있다(iPhone X / 8 / 8 Plus / 7 / 6 / 6s, iPad Air 2, iPad mini 4, iPad 5세대, iPad Pro 9.7"·12.9" 1세대).
  - 모바일 고유: 홈 화면 위젯, iOS의 Siri/Spotlight/액션 버튼을 통한 Notion AI 호출, 공유 시트를 통한 웹 클리핑(F-12-10), Android의 흔들어서 버그 리포트(Rage Shake).
  - **모바일은 "웹앱을 감싼 것"이 아니다 — 노션은 2020년부터 WebView 래퍼를 네이티브로 전환해 왔다**(공식 엔지니어링 글). 네이티브 **Home 탭**(2022)이 체감 시작 속도 **3배**, 네이티브 **Search 탭**(2023 초)이 로딩 시간 **80% 이상** 개선을 냈다. 즉 실제 구조는 **하이브리드**다: 껍데기 네비게이션(홈/검색/탭바)은 네이티브, **페이지 에디터 본문은 WebView**로 남아 있다 `[추정 — 공식 글은 "WebView wrapper에서 네이티브로 전환"만 서술하고 에디터 자체가 네이티브인지는 명시하지 않는다. 다만 Message Port JSON 직렬화를 최적화했다는 서술은 네이티브↔WebView 브리지가 여전히 존재함을 시사한다]`.
    → **클론 함의**: 모바일에서 에디터까지 네이티브로 재작성하는 것은 노션조차 하지 않았다(또는 하지 못했다). **네비게이션 껍데기만 네이티브, 에디터는 웹뷰**가 현실적인 분할선이다.
  - 위 표의 "고대비 모드 미지원"은 헬프 문서의 "desktop and web only" 문장에서 **도출한 결론**이며, 모바일 미지원을 직접 명시한 문장은 없다 `[추정]`.
- **엣지 케이스**:
  - 컬럼 붕괴 시 **순서 결정 규칙**이 필요하다: 좌→우 컬럼 순서대로 이어붙이는 것이 자연스럽다 `[추정]`. 3단 이상, 중첩 컬럼에서는 규칙이 모호해진다.
  - 컬럼 붕괴는 **표현만 바꾸고 데이터는 유지**해야 한다. 모바일에서 편집한 결과가 데스크톱 컬럼 구조를 깨면 안 된다.
  - 넓은 테이블/데이터베이스 → 가로 스크롤 컨테이너로 격리(페이지 자체가 가로 스크롤되면 안 됨).
  - 드래그 재정렬은 터치에서 long-press → drag로만 가능하며 스크롤 제스처와 충돌한다.
  - 소프트 키보드가 뷰포트를 절반 가리므로 caret 자동 스크롤 보정이 필요하다(`visualViewport` API).
  - 백그라운드 진입 시 OS가 프로세스를 종료할 수 있어 **미저장 편집을 즉시 로컬 영속화**해야 한다.
  - 다크모드/고대비는 OS 설정을 따라야 하며, 모바일에는 고대비 옵션이 없다.
- **데이터 모델 함의**: 별도 스키마 불필요. 다만 **레이아웃 정보를 렌더러가 해석 가능한 형태로 저장**해야 한다.
  ```
  block(type='column_list') -> children: block(type='column', format.column_ratio)
  -- 모바일 렌더러는 column_list를 만나면 children을 flatten 하여 세로 배치
  ```
- **UI/인터랙션**: 키보드 상단 툴바(서식·블록타입·들여쓰기·undo), 스와이프로 사이드바 열기, 블록 long-press 컨텍스트 메뉴, 하단 시트 형태의 메뉴.
- **의존 기능**: 블록 렌더러의 플랫폼 분기, 반응형 레이아웃, 오프라인(F-12-04).
- **구현 난이도**: **L** — 별도 앱을 만들면 XL이지만, 반응형 웹 + PWA로 접근하면 L. 터치 드래그와 소프트 키보드 대응이 주 비용.
- **우선순위**: **P1** — 모바일 **읽기**는 P0에 가깝고(공유 링크가 폰에서 열린다), 모바일 **편집**은 P1.
- **클론 시 현실적 대안**: 네이티브 앱 대신 **반응형 웹 + PWA**로 시작. 컬럼 붕괴는 CSS `@media (max-width: 640px) { .column-list { flex-direction: column } }` 한 줄로 해결된다. 터치 드래그는 `dnd-kit`의 pointer sensor + activation constraint(지연 250ms)로 스크롤 충돌 회피.
- **참고 출처**: https://www.notion.com/help/notion-for-mobile , https://www.notion.com/help/use-pages-offline , https://www.notion.com/help/account-settings , https://www.notion.com/blog/notion-on-android-is-now-more-than-twice-as-fast-to-launch , https://www.notion.com/help/system-requirements-for-notion

---

### F-12-13 접근성 (a11y)

- **한 줄 정의**: 키보드 전용 사용자와 스크린 리더 사용자가 블록 편집·네비게이션을 수행할 수 있게 하는 시맨틱·포커스·대비 규칙.
- **사용자 시나리오**: 스크린 리더 사용자가 사이드바에서 `tab`으로 페이지 목록을 순회 → `enter`로 페이지 진입 → 본문에서 블록 단위로 이동하며 "제목 수준 2, 텍스트" 형태로 읽힌다 → 블록 메뉴를 키보드로 열고 항목을 선택한다.
- **동작 상세** (노션의 현재 상태):
  - 공식적으로 확인되는 접근성 기능은 **고대비 모드(베타, 2026-07-30 출시, 데스크톱·웹, 디바이스별 저장)**와 **이미지 alt text 입력**이다.
  - **노션의 공개 VPAT/WCAG 적합성 선언은 검색으로 확인되지 않았다** `[확인필요]`. 서드파티 평가(Pratt 대학원 IXD 평가 등)는 alt text, 명도 대비, tab 순회에서 WCAG 실패 사례를 지적한다 — 1차 출처가 아니므로 참고 수준.
  - 즉 **접근성은 노션이 잘 푼 영역이 아니며, 클론이 모방할 대상이 아니라 개선 대상이다.**
- **엣지 케이스 / 블록 에디터 특유의 a11y 난점**:
  - **`contenteditable`은 스크린 리더에 취약하다.** 블록마다 별도 `contenteditable`을 두면 리더가 문서를 하나의 흐름으로 읽지 못한다. → 단일 `contenteditable` 루트(ProseMirror 방식)가 a11y에 유리하다.
  - 드래그 앤 드롭에는 **키보드 대체 경로가 반드시 있어야 한다**(WCAG 2.1 SC 2.1.1). `cmd/ctrl + shift + arrow` 블록 이동이 그 역할을 한다.
  - 슬래시 메뉴/멘션 팝업은 `role="listbox"` + `aria-activedescendant` + `aria-expanded`로 조합 위젯 패턴을 따라야 하며, 포커스를 입력에서 빼앗으면 안 된다.
  - 블록 선택 모드에는 시각적 하이라이트뿐 아니라 `aria-selected`와 라이브 리전 안내가 필요하다.
  - 실시간 협업 커서/원격 변경은 스크린 리더에 **알리지 않아야 한다**(`aria-live="off"`) — 알리면 읽기가 끊긴다.
  - 사용자 지정 블록 색은 대비를 보장하지 못한다 → 고대비 모드에서 팔레트 치환 필요.
  - 모달(Quick Find, Share)은 포커스 트랩 + `esc` 닫기 + 닫은 뒤 원래 요소로 포커스 복귀.
  - 토글/체크박스는 `<button aria-expanded>`, `<input type=checkbox>` 같은 네이티브 요소를 쓰는 편이 안전하다.
- **데이터 모델 함의**: "렌더 레이어 문제라 스키마 요구가 작다"는 진술은 **절반만 맞다**. 아래 4가지는 스키마에 없으면 사후에 넣을 수 없다.
  ```
  -- (1) 대체 텍스트와 캡션 분리 (캡션=모두에게 보이는 설명, alt=스크린리더 전용. 겸용 금지)
  block.format.alt_text        text NULL
  block.format.alt_decorative  bool DEFAULT false   -- "장식용이라 alt 불필요" 명시 선언
  block.properties.caption     rich_text

  -- (2) 접근성 사용자 설정 (contrast 하나로는 부족)
  a11y_preference(user_id, device_id,
    contrast       text,    -- system | standard | high   (device scope — F-12-03)
    reduce_motion  bool,    -- prefers-reduced-motion 오버라이드
    font_scale     numeric, -- 브라우저 확대와 별개인 앱 내 텍스트 배율
    scope          text)    -- 'account' | 'device'

  -- (3) 시맨틱을 복원 가능한 형태로 저장 (렌더러가 태그를 고를 근거)
  block.type = 'heading_1|2|3'   -> <h1|h2|h3>       -- 헤딩 "레벨"이 스타일이 아니라 데이터여야 한다
  block.format.toggle_collapsed  -> aria-expanded
  block.format.checked           -> <input type=checkbox> 상태
  -- 헤딩을 "굵고 큰 텍스트"로 저장하면 스크린리더가 문서 구조를 만들 수 없고, 복구도 불가능하다

  -- (4) 언어 태깅 (다국어 문서에서 발음 전환 — WCAG 3.1.2)
  block.format.lang text NULL   -> <div lang="ko">   [추정: 노션에 해당 기능 없음. 클론 권장 사항]
  ```
  **되돌릴 수 없는 결정 2개**: 헤딩을 `type`으로 저장할 것인가 서식으로 저장할 것인가, alt를 caption과 분리할 것인가.
- **UI/인터랙션**: 모든 인터랙티브 요소에 보이는 포커스 링, 논리적 tab 순서, "본문으로 건너뛰기" 링크, 최소 4.5:1 대비(본문), 44×44px 이상 터치 타깃.
- **의존 기능**: 에디터 렌더링 구조, 테마 시스템, 단축키 체계.
- **구현 난이도**: **M**(설계 초기부터 반영 시) / **XL**(출시 후 개선 시). 노션이 어려움을 겪는 이유가 후자다.
- **우선순위**: **P1** — 기능적으로는 P2로 보이지만, **아키텍처 결정(단일 vs 다중 contenteditable, 네이티브 요소 사용)은 나중에 되돌릴 수 없으므로 P0 단계에서 정해야 한다.**
- **클론 시 현실적 대안**: ProseMirror 기반 단일 contenteditable + Radix UI/React Aria 같은 접근성 검증된 헤드리스 컴포넌트로 메뉴·모달·드롭다운 구현. axe-core를 CI에 넣어 회귀 방지. 이미지 삽입 시 alt text 입력을 건너뛸 수 있게 하되 비어 있으면 경고 표시.
- **참고 출처**: https://www.notion.com/releases/2026-07-30 , https://www.notion.com/help/account-settings , https://ixd.prattsi.org/2024/12/assessing-the-accessibility-of-notion/ (3자 평가, 1차 출처 아님)

---

### F-12-14 지역화 (i18n) · 시간대 · 날짜 형식

- **한 줄 정의**: UI 문자열을 사용자 언어로, 날짜/시간을 사용자 시간대와 지역 규칙으로 표시한다.
- **사용자 시나리오**: Settings → Language & region → 언어 선택 → UI 전체가 즉시 번역되어 표시 → `Start week on Monday` 토글 → 캘린더 뷰의 주 시작 요일이 변경 → 시간대를 수동 지정하거나 `Automatically update time zone` 활성화.
- **동작 상세**:
  - 공식 지원 언어(22종): English (US), Indonesian, Danish, German, English (UK), Spanish (Spain), Spanish (Latin America), French, Italian, Dutch, Norwegian, Portuguese (Brazil), Finnish, Swedish, Vietnamese, Hebrew, Arabic, Thai, Korean, Japanese, Simplified Chinese, Traditional Chinese.
  - **Hebrew와 Arabic이 포함되어 있으므로 RTL(right-to-left) 레이아웃 지원이 필수다.**
  - 지역 설정 항목: 언어, `Start week on Monday` 토글, 시간대(수동 또는 자동 갱신).
  - 언어 설정은 계정 단위 `[추정: 워크스페이스 단위가 아니라 개인 설정 화면에 있음]`.
  - **사용자 콘텐츠는 번역되지 않는다** — UI 문자열만 대상. 날짜 property 표시 형식과 상대 시간("2 hours ago")은 로케일에 따라 달라진다.
- **엣지 케이스**:
  - **RTL**: 사이드바 위치, 드래그 핸들 위치, 들여쓰기 방향, 아이콘 미러링이 모두 뒤집혀야 한다. CSS 논리 속성(`margin-inline-start`)을 쓰지 않으면 전면 수정이 필요하다.
  - 날짜 property는 **UTC로 저장하고 표시 시점에 변환**해야 한다. "종일(all-day)" 날짜는 시간대 변환을 하면 안 된다(날짜가 하루 밀린다) — 별도 플래그 필요.
  - 리마인더/알림 발송 시각은 **생성자 시간대**인지 **수신자 시간대**인지 결정해야 한다 `[확인필요]`.
  - 주 시작 요일이 캘린더 뷰, 주 단위 그룹핑, 상대 날짜 계산에 전부 영향을 준다.
  - CJK 텍스트는 단어 경계가 없어 줄바꿈(`word-break`)과 검색 tokenizer가 라틴 문자와 다르게 동작한다.
  - 번역 문자열 길이 팽창(독일어는 영어 대비 약 30% 길어짐)으로 버튼·툴팁 레이아웃이 깨진다.
  - 로케일 데이터 번들 크기: 모든 로케일을 번들하면 수백 KB가 낭비된다(과거 노션의 moment locales 사례) → 동적 임포트.
  - 미번역 키는 영어로 폴백해야 하며 빈 문자열이 되면 안 된다.
- **데이터 모델 함의**:
  ```
  user_setting(user_id, locale, timezone, auto_timezone bool, start_week_on_monday bool)
  -- 날짜 저장
  date_value { start timestamptz, end timestamptz NULL, time_zone text NULL, is_all_day bool }
  -- is_all_day=true 이면 timestamptz가 아니라 date로 취급해야 한다
  translation(key, locale, value)   -- 또는 정적 JSON 번들
  ```
- **UI/인터랙션**: Settings → Language & region. 언어 변경 시 리로드 필요 여부는 구현에 따름 `[확인필요]`. RTL 시 `<html dir="rtl">` 토글.
- **의존 기능**: 사용자 설정, 날짜 property, 캘린더 뷰, 알림.
- **구현 난이도**: **M**(LTR 언어만) / **L**(RTL 포함). 문자열 추출 자체는 기계적이지만 RTL 레이아웃과 날짜 시간대 처리가 실제 비용.
- **우선순위**: **P2**(다국어 UI). 단 **시간대 정확한 날짜 저장(UTC + all-day 플래그)은 P0** — 나중에 고치면 기존 데이터가 전부 어긋난다.
- **클론 시 현실적 대안**: `react-i18next` 또는 `next-intl` + 로케일별 동적 임포트. 날짜는 `Temporal` 또는 `date-fns-tz`로 처리하고 라이브러리 로케일도 동적 임포트. MVP는 한국어/영어 2개만, RTL은 CSS 논리 속성만 미리 써두고 실제 RTL 언어는 v2.
- **참고 출처**: https://www.notion.com/help/account-settings

---

### F-12-15 플랫폼 지원 매트릭스 (OS · 브라우저 · 기능 가용성)

- **한 줄 정의**: 어떤 OS·브라우저 버전에서 제품이 동작한다고 보증하는지, 그리고 플랫폼별로 어떤 기능이 빠지는지를 정의하는 **정책 레이어**.
- **사용자 시나리오**:
  1. 미지원 OS 기기에서 앱을 실행 → 로그인 화면 대신 "이 기기는 더 이상 지원되지 않습니다 + 웹으로 계속하기" 안내.
  2. 미지원 브라우저(예: IE)로 접속 → 업그레이드 안내 페이지로 리다이렉트.
  3. 웹 브라우저에서 `•••` 메뉴를 열면 `Available offline` 항목이 **아예 보이지 않는다**(비활성이 아니라 미노출).
- **동작 상세** (공식 System requirements 문서 명시):

  | 플랫폼 | 최소 버전 | 비고 |
  |---|---|---|
  | macOS | **12 이상** | 데스크톱 앱 |
  | Windows | **10 version 21H2 이상**, Windows Server 2016 | x64 / Arm 이중 빌드, MSIX 인스톨러 |
  | iOS | **17.0 이상** | 지원 종료 기기 목록 명시(iPhone 6/6s/7/8/8 Plus/X, iPad Air·mini·Pro 2015~2017 모델군) |
  | Android | **8 이상** | |
  | Chrome | **최근 8개 major Extended stable 릴리스** | 브라우저는 버전 수가 아니라 **"최근 N개 릴리스"** 정책으로 정의된다 |
  | Firefox / Safari / Edge | **최근 2개 major 릴리스** | |
  | Internet Explorer | **미지원** | |

  - **핵심 구조**: 노션은 지원 범위를 "버전 번호"가 아니라 **"현재 시점 기준 최근 N개 릴리스"**라는 **상대적 윈도우**로 정의한다. 이 방식은 시간이 지나면 지원 하한이 자동으로 올라가므로, 클라이언트에서 하드코딩한 버전 비교로는 구현할 수 없고 **서버가 내려주는 정책 테이블**이 필요하다 `[추정 — 노션의 실제 구현 방식은 미공개]`.
  - **문서 간 충돌 발견**: 웹 클리퍼 문서의 "iOS 13.0+ / Android 7.0+"는 시스템 요구사항 문서의 iOS 17.0+ / Android 8+와 모순된다(F-12-10). **동일 제품 안에서도 문서마다 지원 하한이 다르게 적혀 있다** → 지원 정책은 문서가 아니라 **코드가 참조하는 단일 소스**에 있어야 한다는 반례.
  - 기능 가용성 매트릭스(다른 F 항목에서 확인된 것을 통합):

  | 기능 | 웹 | 데스크톱 앱 | iOS | Android |
  |---|---|---|---|---|
  | 오프라인 편집 (F-12-04) | ✗ | ○ | ○ | ○ |
  | 고대비 모드 (F-12-03) | ○(베타) | ○(베타) | ✗ | ✗ |
  | 전역 Command Search (F-12-11) | ✗ | ○ | ✗ | ✗ |
  | 탭 / 다중 창 (F-12-11) | 브라우저 탭으로 대체 | ○ | ✗ | ✗ |
  | 다중 블록 선택 (F-12-12) | ○ | ○ | ✗ | ✗ |
  | 임포트 (F-12-12) | ○ | ○ | ✗ | ✗ |
  | 결제·보안·워크스페이스 설정 | ○ | ○ | ✗ | ✗ |
  | 웹 클리퍼 (F-12-10) | 확장 | 확장 | 공유 시트 | 공유 시트 |
  | 홈 화면 위젯 | ✗ | ✗ | ○ | ○ |

- **엣지 케이스**:
  - **빈 값**: 클라이언트가 User-Agent를 보내지 않거나 위장한 경우 → 차단이 아니라 **경고 후 통과**(false negative가 false positive보다 낫다).
  - **경계**: 지원 하한 "직전" 버전에서 앱이 크래시하면 사용자는 이유를 모른다 → 부팅 최초 단계(번들 파싱 전, 인라인 스크립트)에서 버전 체크를 수행해야 한다. 번들이 최신 문법(예: optional chaining)을 쓰면 구형 브라우저는 **파싱 단계에서 죽어 안내조차 못 띄운다** → 안내 스크립트는 ES5로 별도 번들.
  - **권한 없음**: 미지원 플랫폼 안내는 인증 이전 단계이므로 권한과 무관해야 한다.
  - **삭제된 참조**: 지원 종료된 기기가 아직 `device` 레코드를 갖고 push 토큰이 살아있는 경우 → 알림 발송 대상에서 제외하고 토큰 정리.
  - **동시편집**: 구버전 클라이언트가 신규 블록 타입을 모르는 경우 → **unsupported block을 삭제하지 말고 원형 보존(passthrough)해야 한다.** 구버전이 렌더 못 하는 블록을 "빈 블록"으로 저장해 되돌려 보내면 최신 클라이언트에서 콘텐츠가 소실된다. 이것이 이 기능의 **가장 위험한 엣지 케이스**다.
  - **대용량**: 지원 매트릭스 자체는 소규모 테이블이라 성능 이슈 없음.
  - **순환 참조**: 없음.
- **데이터 모델 함의**:
  ```
  platform_support(
    platform        text,      -- 'macos' | 'windows' | 'ios' | 'android' | 'chrome' | 'safari' | 'firefox' | 'edge'
    policy_kind     text,      -- 'min_version' | 'last_n_releases' | 'unsupported'
    min_version     text NULL, -- policy_kind='min_version'
    last_n          int  NULL, -- policy_kind='last_n_releases'
    action          text,      -- 'block' | 'warn' | 'allow'
    message_key     text,      -- i18n 키 (F-12-14)
    updated_at      timestamptz,
    PRIMARY KEY(platform)
  )
  feature_availability(
    feature_key text, platform text, state text,   -- 'available' | 'hidden' | 'disabled_with_reason'
    min_app_version text NULL, reason_key text NULL,
    PRIMARY KEY(feature_key, platform)
  )
  device(id, user_id, platform, os_version, app_version, push_token, last_seen_at, deprecated_at NULL)
  ```
  **설계 규칙**: 기능 게이팅은 UI 코드의 `if (isMobile)` 분기가 아니라 이 테이블 하나를 조회하는 `isAvailable(featureKey)` 함수로 통일해야 한다. 그렇지 않으면 플랫폼 조건이 코드 전체에 흩어져 새 플랫폼 추가 시 전수 검색이 필요해진다.
- **UI/인터랙션**: 미지원 배너(닫기 불가), 업그레이드 링크, 기능 미지원 시 **비활성 버튼이 아니라 미노출**(노션이 웹에서 오프라인 토글을 숨기는 방식). 단 "왜 없는지"를 설명해야 하는 기능(예: 임포트)은 노출 + 툴팁이 낫다.
- **의존 기능**: 사용자 설정, feature flag(F-12-17), i18n(F-12-14).
- **구현 난이도**: **S** — 테이블 + 조회 함수 + 부팅 시점 체크가 전부. 단 **ES5 폴백 안내 번들**을 별도로 빌드하는 것이 빌드 파이프라인 작업으로 반나절 추가.
- **우선순위**: **P1** — MVP에서는 "모던 브라우저만 지원" 한 줄로 대체 가능. 단 **`isAvailable(featureKey)` 게이팅 함수를 처음부터 두는 것은 P0**(나중에 넣으면 흩어진 분기를 전수 회수해야 한다).
- **클론 시 현실적 대안**: `browserslist` + `@babel/preset-env` 타겟을 지원 정책의 단일 소스로 삼고, 런타임 체크는 `caniuse` 대신 **기능 감지(feature detection)** 3~4개(예: `OPFS`, `structuredClone`, `Intl.Segmenter`)로 축약. 플랫폼 매트릭스는 JSON 상수 파일 1개로 시작하고, 원격 갱신이 필요해지면 그때 테이블로 승격.
- **참고 출처**: https://www.notion.com/help/system-requirements-for-notion , https://www.notion.com/help/notion-for-web , https://www.notion.com/help/web-clipper

---

### F-12-16 오류 · 복구 UX (네트워크 단절 · 저장 실패 · 로컬 데이터 리셋)

- **한 줄 정의**: 저장·로드·업로드가 실패했을 때 사용자에게 상태를 알리고, 데이터를 잃지 않고 복구할 경로를 제공한다.
- **사용자 시나리오**:
  1. 편집 중 네트워크가 끊긴다 → 상단에 `Offline` 배너 → 계속 타이핑은 되지만 변경은 로컬 큐에 쌓인다.
  2. 서버가 트랜잭션을 거부한다 → `There was an issue persisting your edits` 표시 → 새로고침 안내.
  3. 화면이 계속 깨진다 → 데스크톱 앱 `Help` 메뉴 → `Troubleshooting` → `Reset & Erase All Local Data` → 로그아웃되며 로컬 캐시 전체 폐기 → 재로그인 후 서버에서 재수신.
- **동작 상세** (공식 오류 메시지 문서에서 확인된 실제 문자열과 원인):

  | 오류 문자열(공식) | 원인 | 복구 경로 |
  |---|---|---|
  | `Offline` / `Connect to the internet` | 연결 상실, 방화벽/프록시/VPN 차단 | 연결 확인, `*.notion.com` allowlist, DNS 변경 |
  | `There was an issue persisting your edits` / `Cannot save changes` | 트랜잭션 저장 실패 | 재시도, 로그아웃/재로그인, 앱 리셋 |
  | `Storage operation did not complete` | 로컬 스토리지 계층 실패(F-12-05) | 캐시 클리어, 앱 리셋 |
  | `Unsaved transactions` | **권한 부족**(페이지 이동 시 대상 위치 권한 없음) 또는 integration/bot 접근 권한 없음 | 권한 부여 |
  | `Go online to view this image` | 이미지 CDN 요청이 VPN/광고차단/iCloud Private Relay에 막힘 | 차단 요소 해제, 도메인 allowlist |
  | `Your file is over the limit` | **Free 플랜 임포트 5MB 초과**(유료 50MB) | 파일 축소 또는 업그레이드 |
  | `Rate limit reached` | **대량 복제 시 시간당 50,000 블록 한도 초과** | 1시간 대기 또는 분할 실행 |
  | `Request body too large` | **500KB 초과 텍스트 붙여넣기 → HTTP 413** | 분할 붙여넣기 |
  | `Notion is damaged` | 앱 바이너리 손상 | 재설치 |
  | `Something's not right` / `Something went wrong` | 포괄 오류 | 캐시 클리어, 시크릿 모드 확인, 앱 리셋 |

  - **설계상 가장 중요한 관찰 3가지**:
    1. **권한 오류가 저장 오류로 나타난다** — `Unsaved transactions`의 원인이 권한이다. 즉 클라이언트는 낙관적으로 편집을 허용하고 서버가 거부하는 구조이므로, **거부된 트랜잭션을 되돌리는 롤백 경로가 반드시 필요**하다.
    2. **정량 한도가 오류 메시지로만 노출된다** — 50,000 blocks/hour, 500KB paste, 5MB/50MB import는 헬프 문서 본문이 아니라 오류 안내에 적혀 있다. 클론도 **한도는 사후 오류가 아니라 사전 경고**로 노출하는 편이 낫다.
    3. **최종 복구 수단이 "로컬 전체 폐기"다** — 서버가 원본(source of truth)이기 때문에 가능한 전략이다. **로컬 우선(local-first) 설계를 택하면 이 탈출구가 사라진다** — 이것이 F-12-04를 P2로 미루는 또 하나의 근거다.
- **엣지 케이스**:
  - **빈 값**: 오류 메시지 없이 실패(무응답 타임아웃) → 클라이언트가 자체 타임아웃(예: 15초)을 걸고 "응답 없음" 상태를 만들어야 한다. 아무것도 표시하지 않는 것이 최악이다.
  - **중첩**: 재시도 중 또 실패 → 지수 백오프(1s→2s→4s→…, 상한 60s) + jitter. 무한 재시도 대신 **N회 후 수동 재시도 버튼**으로 전환.
  - **동시편집**: 내 트랜잭션이 거부되는 동안 다른 사용자의 변경은 계속 들어온다 → 롤백 시 **내 변경만 되돌리고 원격 변경은 유지**해야 한다. op 단위 origin 태깅이 없으면 불가능.
  - **삭제된 참조**: 오프라인 큐에 있던 op의 대상 블록이 서버에서 이미 삭제됨 → op를 **조용히 폐기(drop)**하되 사용자에게 "N개 변경이 적용되지 않았습니다 + 내용 보기"로 고지해야 한다. 조용히 버리면 데이터 손실 신고가 된다.
  - **권한 없음**: `Unsaved transactions`. 롤백 + 명시적 사유 표시("이 페이지에 대한 편집 권한이 없습니다") 필요. 포괄 오류로 뭉뚱그리면 사용자가 재시도를 반복한다.
  - **대용량**: 큐에 수천 개 op가 쌓인 상태로 재접속 → 한 번에 보내면 413. **배치 크기 상한(예: 100 op 또는 500KB)으로 청킹**하고 순서를 보장해야 한다. 노션의 500KB 413 한도가 이 청킹 크기의 현실적 기준선이다.
  - **순환 참조**: 실패 → 리트라이 → 캐시 무효화 → 재로드 → 다시 실패의 루프. 재로드 트리거에 회로 차단기(circuit breaker) 필요.
- **데이터 모델 함의**:
  ```
  -- 클라이언트 (F-12-04의 pending_transaction 확장)
  pending_transaction(
    txn_id uuid PK, space_id uuid, ops blob, created_at bigint,
    state text,            -- pending | sending | acked | rejected | dropped
    attempt_count int,     -- 백오프 계산
    next_attempt_at bigint,
    error_code text NULL,  -- 'permission_denied' | 'not_found' | 'too_large' | 'rate_limited' | 'conflict'
    origin text            -- 'local' | 'remote'  ← 롤백 시 내 변경만 되돌리기 위한 필수 필드
  )
  sync_status(space_id, state, last_acked_at, pending_count)  -- 배너/인디케이터 표시용 단일 소스

  -- 서버: 거부 사유를 코드로 내려야 UI가 분기 가능
  error_response { code, message_key, retryable bool, retry_after_sec int NULL, offending_ids uuid[] }
  -- retryable=false 인데 재시도하면 무한 루프가 된다. retryable 플래그는 선택이 아니라 필수.

  -- 한도 정책 (사전 경고용)
  usage_limit(space_id, key, limit_value, window_sec)
  -- key: 'blocks_duplicated_per_hour'(50000), 'paste_bytes'(512000), 'import_file_bytes'(5MB|50MB)
  ```
- **UI/인터랙션**: 상단 persistent 배너(오프라인/동기화 중/실패), 우하단 토스트(일시적 오류), 저장 실패 시 **편집 차단이 아니라 경고 유지**(입력을 막으면 사용자가 내용을 잃는다), `Help → Troubleshooting → Reset & Erase All Local Data` 경로, 리셋 전 "로그아웃됩니다" 확인 다이얼로그.
- **의존 기능**: 트랜잭션/op 모델, 로컬 캐시(F-12-05), 권한 모델, 네트워크 상태 감지(`navigator.onLine` + 실제 heartbeat — `navigator.onLine`은 LAN 연결만 보므로 단독으로는 신뢰 불가).
- **구현 난이도**: **L** — 배너 UI는 S지만, **거부 트랜잭션 롤백 + origin 태깅 + 백오프 + 청킹 + 사유별 분기**가 op 모델 자체를 건드리는 작업이다. 사후에 붙이면 op 파이프라인 재작성이 된다.
- **우선순위**: **P0** — "저장 실패를 사용자가 모르는 상태"는 데이터 손실과 동치다. 오류 배너 + 재시도 큐 + 롤백은 MVP 필수. 리셋 경로와 한도 사전 경고는 P1.
- **클론 시 현실적 대안**: 재시도/백오프는 TanStack Query의 `retry`/`retryDelay`에 위임하고, 오프라인 큐만 자체 구현. Yjs를 채택하면 origin 태깅(`transaction.origin`)과 롤백이 라이브러리 기본 제공이라 이 항목 난이도가 L→M으로 내려간다. 오류 코드는 처음부터 enum으로 정의하고 사람이 읽는 문자열은 i18n 키로 분리.
- **참고 출처**: https://www.notion.com/help/notion-error-messages , https://www.notion.com/help/reset-notion , https://www.notion.com/help/cant-access-notion

---

### F-12-17 배포 · 자동 업데이트 · 버전 스큐

- **한 줄 정의**: 서버·웹 번들·네이티브 셸이 서로 다른 버전으로 공존하는 시간대에도 요청이 깨지지 않게 하는 호환성 규칙과 갱신 경로.
- **사용자 시나리오**:
  1. 데스크톱 앱이 백그라운드에서 자동 업데이트된다 → 재시작 후에도 신기능이 안 보인다 → **공식 안내대로 `cmd/ctrl + R`로 새로고침**하면 나타난다.
  2. 브라우저 탭을 3일간 열어둔 채 편집한다 → 그 사이 서버가 배포되었다 → 요청이 400으로 실패하거나, 새 번들 청크를 못 찾아 chunk load error가 난다.
  3. 1년 전에 예약한 리마인더가 오늘 발화한다 → 그 사이 큐 태스크 스키마가 바뀌었다.
- **동작 상세**:
  - **스큐가 발생하는 3개 축** (노션 공식 엔지니어링 글이 이 중 2개를 명시적으로 다룬다):

    | 축 | 형태 | 노션의 대응 |
    |---|---|---|
    | 셸 vs 웹뷰 번들 | 데스크톱 앱은 갱신됐지만 안의 JS가 낡음 | 공식 안내가 `cmd/ctrl + R` 새로고침 — **즉 이 상태가 실재함을 제품이 인정하고 있다** |
    | 구 클라이언트 → 신 서버 | 옛 payload를 보내 400 | **CI에서 스키마 호환성 검사**로 사전 차단 |
    | 구 enqueue → 신 worker | Redis 큐 태스크가 오래 대기 후 처리 | 동일 CI 검사. 공식 서술: 큐 태스크는 "**수년 전에 enqueue될 수 있다**"(예약 이벤트·리마인더) |

  - **노션의 CI 스키마 호환성 검사**(1차 출처, 2026-04):
    - 적용 범위: **API 엔드포인트 약 1,300개, 큐 태스크 타입 약 296개**.
    - 판정 규칙(TypeScript 할당 가능성으로 환원): **"스키마 변경이 backward compatible하다 ⟺ 신규 코드가 구 데이터를 처리할 수 있다"** = `OldRequestType`이 `NewRequestType`에 **assignable**해야 한다.
    - CI 잡은 **base 브랜치에서 옛 타입을, PR 브랜치에서 새 타입을 추출**해 할당 가능성 검사를 돌린다.
    - **breaking으로 판정되는 변경**(request 스키마 기준): 필수 필드 추가 / 타입 축소(`string | number` → `string`) / union 멤버 제거 / 타입 비호환 변경(`number` → `string`).
    - **안전한 변경**: 선택 필드 추가 / 필드 제거(TS 구조적 타이핑상 여분 속성 허용) / 타입 확대(`string` → `string | number`) / 필수 → 선택.
    - **탈출구**: 의도된 breaking change임을 CI에 알리는 **GitHub 라벨**.
    - **주의 — 방향이 비대칭이다**: 위 규칙은 **request 스키마**에 대한 것이다. response 스키마는 반대 방향(구 클라이언트가 신 응답을 읽어야 하므로 `New`가 `Old`에 assignable)이어야 하며, 노션 글은 request 축을 중심으로 서술한다 `[추정 — response 축에 대한 명시적 규칙은 글에서 확인되지 않음]`.
  - **데스크톱 자동 업데이트**: 기본 활성("We push updates on a regular basis"). 수동 확인은 Mac `Notion` > `Check for Updates`, Windows `File` > `Check for Updates`. Windows는 IT 배포용 **MSIX**(x64/Arm) 제공, 설치 시 기존 프로필·창 구성 보존(F-12-11).
  - **코드베이스 구조**: 웹 앱·데스크톱 앱·모바일 앱이 **단일 monorepo**에 있고 전체가 TypeScript다 → 위 CI 검사가 클라이언트/서버 타입을 같은 컴파일러로 비교할 수 있는 전제 조건.
- **엣지 케이스**:
  - **빈 값**: 클라이언트가 버전 헤더를 안 보냄 → 서버는 "가장 오래된 지원 버전"으로 가정하고 보수적으로 응답해야 한다.
  - **중첩**: 배포 중 일부 서버만 신버전(rolling) → 같은 사용자의 연속 요청이 신/구 서버에 번갈아 도달한다. 스티키 라우팅이 없으면 **양방향 호환**(신 서버가 구 payload를, 구 서버가 신 payload를 모두 처리)이 필요하다.
  - **동시편집**: 구 클라이언트가 **모르는 블록 타입**을 받은 경우 → **원형 보존(passthrough) 후 재전송**해야 한다. 파싱 실패 시 필드를 떨어뜨리면 상대방의 콘텐츠를 지운다(F-12-15와 동일한 위험).
  - **삭제된 참조**: 배포로 제거된 API 엔드포인트를 구 클라이언트가 호출 → 404가 아니라 **410 + "업데이트 필요" 코드**를 내려 강제 새로고침 UX로 유도.
  - **권한 없음**: 무관.
  - **대용량**: 정적 자산 청크가 배포마다 해시로 바뀌므로, 오래 열린 탭이 lazy chunk를 요청하면 404 → **이전 N개 배포의 청크를 CDN에 유지**(immutable 캐시 + 삭제 유예 기간)해야 한다. 유예 없이 지우면 열려 있던 모든 탭이 깨진다.
  - **순환 참조**: chunk load 실패 → 자동 리로드 → 또 실패의 루프. 리로드 시도 횟수를 `sessionStorage`에 기록해 1회로 제한.
- **데이터 모델 함의**:
  ```
  release(version text PK, channel text, released_at timestamptz,
          min_supported_client text,     -- 이 서버가 받아줄 최소 클라이언트 버전
          bundle_hash text)
  client_session(session_id, user_id, device_id, client_version, bundle_hash, started_at)
  -- 서버는 응답 헤더로 현재 배포 버전을 내려 클라이언트가 스큐를 자가 진단하게 한다:
  --   X-Server-Release / X-Min-Client  → 불일치 시 "새로고침" 배너(F-12-16)

  feature_flag(key, enabled_for jsonb, min_client_version text, rollout_pct int)
  -- min_client_version이 없으면 신규 기능이 구 클라이언트에 노출되어 깨진다

  -- 큐 태스크: 수년간 남을 수 있으므로 payload에 스키마 버전을 반드시 동봉
  queue_task(id, type, schema_version int, payload jsonb, scheduled_at, attempts)
  -- worker는 schema_version별 마이그레이션 함수를 체인으로 적용한 뒤 처리

  -- 블록 forward-compat: 모르는 타입/필드를 버리지 않기 위한 보존 슬롯
  block.unknown_fields jsonb   -- 파서가 인식 못 한 키를 담아 그대로 재직렬화
  ```
  **되돌릴 수 없는 결정**: ① 큐 payload에 `schema_version`을 넣을 것인가(안 넣으면 오래된 태스크를 영원히 해석 불가), ② 파서가 미지의 필드를 보존할 것인가(안 하면 구버전 클라이언트가 신버전 데이터를 손상시킨다).
- **UI/인터랙션**: "새 버전이 있습니다 — 새로고침" 배너(닫기 가능하되 강제 조건에서는 불가), 데스크톱 `Check for Updates` 메뉴, 업데이트 후 릴리스 노트 링크, chunk 로드 실패 시 자동 1회 리로드.
- **의존 기능**: 인증/세션, feature flag, 오류 UX(F-12-16), 빌드 파이프라인.
- **구현 난이도**: **M~L** — 배너와 버전 헤더는 S지만, **CI 스키마 호환성 검사(약 1,300 엔드포인트 규모)와 큐 태스크 버저닝**을 갖추면 L. 노션이 전담 CI 잡을 만들어야 했다는 사실 자체가 이 문제가 규모에 비례해 커진다는 증거다.
- **우선순위**: **P1** — 사용자 1명·배포 1회일 때는 존재하지 않는 문제지만, **`block.unknown_fields` 보존과 큐 `schema_version`은 P0 스키마 결정**이다(사후 도입 불가). CI 검사는 팀 규모가 커진 뒤 P2.
- **클론 시 현실적 대안**: MVP는 ① 응답 헤더에 빌드 해시를 실어 클라이언트가 다르면 새로고침 배너, ② Vite/Next의 청크를 CDN에서 최소 7일 유지, ③ zod 스키마를 클라이언트/서버 공유하고 `.passthrough()`로 미지 필드 보존. CI 호환성 검사는 zod 스키마 스냅샷을 커밋해 diff로 대체(노션의 TS assignability 방식은 규모가 커진 뒤에 도입).
- **참고 출처**: https://www.notion.com/blog/how-notion-catches-breaking-schema-changes , https://www.notion.com/blog/migrating-notion-marketing-to-next-js , https://www.notion.com/help/notion-for-desktop

---

### F-12-18 성능 계측 (RUM · 회귀 방지)

- **한 줄 정의**: 실사용 환경에서 체감 성능을 지표로 정의·수집하고, 배포마다 회귀를 자동 차단한다.
- **사용자 시나리오**: (사용자에게 보이지 않는 기능) 개발자가 대시보드에서 "홈 화면 최초 렌더 P95"를 주 단위 시계열로 확인 → 특정 배포에서 상승 → PR 단위 벤치마크 결과와 대조해 원인 커밋을 찾는다.
- **동작 상세** (노션 Android 사례가 1차 출처):
  - **지표 이름을 제품 동작으로 정의한다**: `initial_home_render` = **앱 실행부터 Home 탭이 표시되기까지의 시간**. "로딩 시간"이 아니라 **사용자가 무언가를 볼 수 있게 되는 순간**을 기준으로 잡는다.
  - **P95를 본다** — 평균이 아니라. 공식 표현: P95가 "**대다수 사람의 경험**"을 대표한다고 본다.
  - **하위 구간(sub-span)으로 분해**한다: Application `onCreate`, Main Activity `onCreate`, JSON 직렬화/역직렬화 등. 총합만 재면 원인을 못 찾는다.
  - **수집 경로 다층화**: 프로덕션 세션 샘플링(메타데이터 태깅) + 프로파일러(Android Studio CPU Profiling, Perfetto) + 플레임그래프 + **PR마다 자동 실행되는 Macrobenchmark 테스트** + 자체 `TraceMetrics`. 결과는 **주간 시계열 리포트**로 관측 플랫폼에 발행.
  - **실제로 잡힌 원인들**(계측이 없으면 절대 못 찾을 종류):

    | 원인 | 개선 |
    |---|---|
    | 실험(experiment) 설정을 매 실행마다 재조회 | 키-값 캐시 계층 도입 |
    | 분석 이벤트/로그가 시작 경로를 점유 | 경량 버퍼링 계층 |
    | 사용자 세션 정보를 매번 재조회 | 캐싱 — **단독으로 약 30% 개선** |
    | SQLite 스키마 버전 확인을 **JSON 파일 전체 파싱**으로 수행 | 정수 비교로 교체 — **Android 13에서 215ms 제거** |
    | Message Port JSON 직렬화가 메인 스레드 점유 | 백그라운드 스레드로 이동 |
    | (플랫폼 기법) Baseline Profiles | **P95 약 12% 개선**, 릴리스마다 자동 재생성 |

  - **누적 결과**: 2023년 말 기준 P95 Initial Home Render **약 45% 단축**, 최종적으로 **2023년 초 대비 시작 속도 2배**. 아키텍처 축에서는 2020년부터 WebView 래퍼 → 네이티브 전환을 진행했고, 네이티브 Home 탭(2022)은 **체감 시작 속도 3배**, 네이티브 Search 탭(2023 초)은 **로딩 시간 80% 이상** 개선.
  - **웹 쪽 지표**: F-12-05/07의 개선 수치(네비게이션 브라우저 평균 20%, 호주 28% / 중국 31% / 인도 33%, 데스크톱 초기 로드·네비게이션 각 약 50%)가 **지역별로 쪼개져 보고된다** → 계측이 지역 차원을 갖고 있다는 뜻이다.
- **엣지 케이스**:
  - **빈 값**: 계측 이벤트가 유실되면 지표가 **좋아 보인다**(느린 세션이 타임아웃으로 사라짐). 생존자 편향을 막으려면 **시작 이벤트와 완료 이벤트를 짝으로 세고 미완료율을 함께 본다**.
  - **중첩**: sub-span이 겹치거나 비동기로 흩어지면 합이 총합과 안 맞는다 → span 트리(부모-자식) 구조로 기록해야 한다.
  - **동시편집**: 원격 op 폭주 구간의 입력 지연은 세션 평균에 묻힌다 → **입력 지연(INP)은 별도 지표**로 분리.
  - **삭제된 참조**: 제거된 지표 이름을 대시보드가 계속 참조 → 지표도 스키마이므로 버저닝 대상(F-12-17).
  - **권한 없음**: 계측 payload에 페이지 제목·본문이 섞이면 **정보 유출**이다. 식별자만 보내고 콘텐츠는 절대 보내지 않는다. 워크스페이스 id도 고객 식별이 되므로 해시 처리 검토.
  - **대용량**: 이벤트 전송 자체가 성능을 깎는 자기모순 → **버퍼링 + 샘플링**(노션이 실제로 한 조치). 샘플링률을 지표와 함께 저장하지 않으면 절대값 복원이 불가능하다.
  - **순환 참조**: 성능 저하 → 로그 급증 → 더 느려짐. 로그 레이트 리밋 필요.
- **데이터 모델 함의**:
  ```
  perf_event(
    id, session_id, user_id_hash, space_id_hash,
    metric_key   text,      -- 'initial_home_render' | 'page_navigation' | 'editor_input_latency'
    value_ms     numeric,
    started_at   timestamptz, completed bool,   -- 미완료율 산출용(생존자 편향 방지)
    sample_rate  numeric,                        -- 절대값 복원에 필수
    platform, app_version, os_version, region, network_class,   -- 지역/네트워크 차원
    cold_start bool, cache_hit bool
  )
  perf_span(event_id, span_key, parent_span_key NULL, start_offset_ms, duration_ms)
  -- 부모-자식 span 트리. 합이 안 맞는 것을 감지할 수 있어야 한다.
  perf_budget(metric_key, platform, percentile int, threshold_ms int, enforce bool)
  -- CI가 이 테이블(또는 커밋된 설정 파일)을 읽어 PR을 실패시킨다
  benchmark_run(commit_sha, metric_key, p50, p95, run_at)   -- PR 단위 벤치마크 결과 시계열
  ```
  **핵심 결정**: `sample_rate`와 `completed`를 이벤트에 **같이 저장**할 것. 둘 중 하나라도 없으면 수집된 숫자가 실제 사용자 경험을 대표하지 못하며, 이는 사후 재계산이 불가능하다.
- **UI/인터랙션**: 사용자에게 노출되지 않는다. 유일한 접점은 **디버그 오버레이**(내부용)와 성능 문제 신고 경로(Android의 흔들어서 리포트 — F-12-12).
- **의존 기능**: 세션/디바이스 식별, 로깅 파이프라인, CI, feature flag(회귀 시 롤백 스위치).
- **구현 난이도**: **M** — `PerformanceObserver`/`web-vitals`로 웹 RUM을 붙이는 것은 하루 작업. **PR 단위 자동 벤치마크와 예산 강제(budget enforcement)**를 CI에 넣는 것이 나머지 비용이고, 이쪽이 실제로 회귀를 막는 부분이다.
- **우선순위**: **P1** — MVP에서 대시보드까지는 과하지만, **지표 이름과 측정 지점을 코드에 심는 것은 P0**. 성능 문제는 "느려졌다"는 체감으로 신고되고, 계측이 없으면 어느 배포부터인지 영원히 모른다.
- **클론 시 현실적 대안**: 웹은 `web-vitals`(LCP/INP/CLS) + 커스텀 마크(`performance.mark`/`measure`)로 `initial_home_render` 상당 지표를 정의하고 Sentry/PostHog/OpenTelemetry 중 하나로 전송. CI 회귀 방지는 Lighthouse CI(초기 로드) + Playwright 트레이스(네비게이션) 2개면 충분. 샘플링은 처음부터 10~20%로 두고 `sample_rate`를 이벤트에 기록.
- **참고 출처**: https://www.notion.com/blog/notion-on-android-is-now-more-than-twice-as-fast-to-launch , https://www.notion.com/blog/faster-page-load-navigation , https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite

---

### F-12-19 서버 측 성능 기반 (Postgres 수평 샤딩 · 재샤딩)

- **한 줄 정의**: 블록 데이터를 workspace 단위로 수평 분할해 단일 DB 한계를 넘기고, 용량이 다시 차면 무중단으로 샤드를 늘린다.
- **사용자 시나리오**: (사용자에게 보이지 않음) 워크스페이스가 커져도 페이지 로드 시간이 선형으로 나빠지지 않는다. 재샤딩 당일에도 서비스가 중단되지 않는다.
- **동작 상세** (노션 공식 엔지니어링 글 2편, 1차 출처):
  - **샤드 키 = workspace(space) id.** 근거는 데이터 모델의 성질이다 — **"각 블록은 정확히 하나의 workspace에 속한다"**. 이 성질 덕분에 대부분의 쿼리가 단일 샤드 안에서 끝나고 cross-shard join이 사라진다.
  - **샤딩 대상**: `block` 테이블에서 외래 키로 도달 가능한 모든 테이블 — `block`, `collection`, `space`, `discussion`, `comment` 등.
  - **1차 샤딩(2021)**: 단일 Postgres 모놀리스 → **물리 DB 32대 × 논리 샤드 15개 = 480 논리 샤드**. 논리 샤드는 `schema001.block`, `schema002.block` 형태의 **별도 스키마**로 구현.
    - **480을 고른 이유**: 약수가 매우 많아(2,3,4,5,6,8,10,12,15,16,20,24,30,32,40,48,60,80,96,120,160,240) 물리 DB 수를 **2배로 늘리지 않고도** 재분배할 수 있다. → **논리 샤드 수를 물리 DB 수와 분리하고, 논리 샤드 수를 고약수(highly composite)로 잡는 것이 핵심 설계 결정이다.**
    - 마이그레이션: **audit log 기반 이중 쓰기(double-write)** + 캐치업 스크립트(logical replication은 처리량 한계로 탈락) → 백필(m5.24xlarge, CPU 96개, **약 3일**) → 검증(비교 스크립트 + **dark read**: 양쪽에서 읽어 대조) → **5분 예정 점검**으로 전환.
  - **2차 재샤딩 "The Great Re-shard"(2023)**: **32대 → 96대**(3배), 물리 DB당 논리 스키마 **15개 → 5개**.
    - **재샤딩 트리거(정량)**: 피크 시 일부 샤드 **CPU 90% 초과**, 다수 샤드가 **프로비저닝된 디스크 대역폭(IOPS) 한계 근접**, **PgBouncer 커넥션 한계** 도달. → 용량 지표는 디스크 **용량**이 아니라 **CPU·IOPS·커넥션 수**였다.
    - 이번엔 **Postgres logical replication**으로 이력 복사 + 변경 지속 적용. **인덱스를 복사 중에 만들지 않고 이후에 재생성**해 동기화 시간을 **3일 → 12시간**으로 단축.
    - dark read로 **거의 100% 일치** 확인 후 PgBouncer에서 트래픽을 점진 전환. **관측된 다운타임 0**.
    - 결과: 피크 시 **CPU·IOPS 사용률 약 20%**로 하락. 비용 통제를 위해 신규 샤드는 **더 작은 인스턴스·디스크**로 프로비저닝(디스크가 병목이 아니었으므로).
- **엣지 케이스**:
  - **빈 값**: 샤드 키(space_id)가 없는 레코드(예: 개인 계정 생성 직후, 크로스 워크스페이스 엔티티인 `notion_user`) → **비샤딩 글로벌 DB**를 따로 둬야 한다. "모든 것을 샤딩한다"는 불가능하다.
  - **중첩**: 워크스페이스 간 페이지 이동(다른 space로 옮기기) → **샤드 간 이동**이 되어 단순 UPDATE로 끝나지 않는다. 복사 + 검증 + 원본 삭제의 3단계 잡이 필요하다 `[추정 — 노션의 처리 방식은 공개되지 않음]`.
  - **동시편집**: 이중 쓰기 기간에 두 DB 사이 순서가 어긋날 수 있다 → 노션이 **audit log(순서가 보장된 로그)**를 쓴 이유. 애플리케이션에서 두 번 쓰기만 하면 순서 보장이 깨진다.
  - **삭제된 참조**: 전환 중 한쪽에만 삭제가 반영 → dark read 비교가 이를 잡아낸다. **검증 없는 전환은 무성한 데이터 불일치를 남긴다.**
  - **권한 없음**: 권한 판정은 부모 체인을 거슬러 올라가는데(F-12-13/블록 모델의 상향 포인터), **부모 체인이 같은 workspace 안에 있다는 보장** 덕분에 단일 샤드에서 해결된다. 만약 샤드 키를 user id로 잡았다면 권한 계산이 cross-shard가 되어 무너진다 — **샤드 키 선택이 권한 계산 비용을 직접 결정한다.**
  - **대용량**: 거대 워크스페이스 하나가 샤드를 독점하는 **hot shard** 문제. workspace 단위 샤딩은 워크스페이스 크기 분포가 편향되면 균형이 깨진다 `[추정 — 노션의 hot shard 대응은 공개되지 않음. 논리 샤드를 물리 DB에 재배치할 수 있는 480 구조가 완화 수단으로 보인다]`.
  - **순환 참조**: 블록 부모 체인의 순환은 권한 계산을 무한 루프로 만든다 → 깊이 상한 + 방문 집합(F-12-02와 동일 방어).
- **데이터 모델 함의**:
  ```
  -- 샤딩 라우팅 (애플리케이션 계층)
  shard_map(space_id uuid PK, logical_shard int, physical_db text, migrated_at timestamptz)
  -- 또는 결정론적 해시: logical_shard = hash(space_id) % 480
  --   해시 방식이 조회 1회를 아끼지만, 특정 workspace만 옮기는 것이 불가능해진다.
  --   노션처럼 논리 샤드를 물리 DB에 매핑하는 간접 계층을 두면 재배치가 가능하다.
  logical_shard_placement(logical_shard int PK, physical_db text, state text)
  -- state: 'active' | 'migrating' | 'read_only'

  -- 모든 샤딩 대상 테이블은 space_id를 반드시 보유해야 한다 (비정규화 감수)
  block(id, ..., space_id uuid NOT NULL)
  collection(id, ..., space_id uuid NOT NULL)
  discussion(id, ..., space_id uuid NOT NULL)
  comment(id, ..., space_id uuid NOT NULL)
  -- 부모를 따라가야 space_id를 알 수 있는 구조면 라우팅 전에 쿼리가 한 번 더 필요해진다.
  -- => space_id 비정규화는 성능 최적화가 아니라 샤딩의 전제 조건이다.

  -- 비샤딩 글로벌 DB
  notion_user(id, email, ...)         -- 여러 workspace에 걸침
  space_membership(user_id, space_id, role)
  shard_map / feature_flag / platform_support

  -- 마이그레이션 도구
  audit_log(seq bigserial, table_name, row_id, op, payload, written_at)  -- 순서 보장 이중 쓰기
  dark_read_diff(run_id, table_name, row_id, mismatch_kind, observed_at) -- 검증 결과
  ```
- **UI/인터랙션**: 없음(사용자 비노출). 유일한 접점은 재샤딩 시 **예정 점검 공지**(1차 샤딩의 5분 점검)와 상태 페이지.
- **의존 기능**: workspace 개념 자체, 모든 테이블의 `space_id` 보유, 커넥션 풀러(PgBouncer), 관측(F-12-18).
- **구현 난이도**: **XL** — 라우팅 계층만 보면 M이지만, **무중단 이중 쓰기 → 백필 → dark read 검증 → 전환**의 전체 절차와 되돌리기(rollback) 계획까지 포함하면 XL이다. 노션이 이 작업을 **두 번** 했고 두 번째도 별도 블로그 글이 될 만한 규모였다는 것이 근거다.
- **우선순위**: **P2** — MVP에서 샤딩은 명백한 조기 최적화다. **그러나 `space_id`를 모든 테이블에 두는 것과 워크스페이스 경계를 넘는 쿼리를 금지하는 규율은 P0**다. 이 두 가지가 없으면 나중에 샤딩이 불가능해지고, 있으면 언제든 도입할 수 있다.
- **클론 시 현실적 대안**:
  1. MVP: 단일 Postgres. 단 **모든 도메인 테이블에 `space_id NOT NULL` + 모든 쿼리에 `WHERE space_id = ?` 강제**(ORM 레벨 글로벌 스코프 또는 RLS). 이것만으로 미래 샤딩 옵션이 열린 채로 남는다.
  2. v1: 읽기 복제본 + PgBouncer + 무거운 집계는 별도 replica로 분리.
  3. v2: 논리 샤드 수를 **고약수(예: 480 또는 240)**로 고정하고 물리 DB 매핑 테이블을 도입. 직접 구현 대신 Citus 같은 기성 분산 Postgres 검토.
  4. 검증은 반드시 **dark read**로. 이것이 노션 절차에서 가장 이식 가치가 높은 부분이다.
- **참고 출처**: https://www.notion.com/blog/sharding-postgres-at-notion , https://www.notion.com/blog/the-great-re-shard , https://www.notion.com/blog/data-model-behind-notion

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-12-01 | 키보드 단축키 체계 | L | **P0**(최소 세트) | 블록 모델, undo 스택 |
| F-12-02 | Quick Find / 커맨드 팔레트 | M~L | **P0** | 검색 인덱스, 권한(사전계산 ACL), 최근 방문 |
| F-12-03 | 테마 시스템(라이트/다크/고대비) | S~M | P1 (고대비 P2) | 사용자 설정, 디자인 토큰 |
| F-12-04 | 오프라인 모드 | XL | P2 (읽기 전용 캐시는 P1) | F-12-05, op 모델, CRDT, pub/sub |
| F-12-05 | 클라이언트 로컬 캐시(SQLite/OPFS) | XL | P2 (레코드 스토어 설계는 **P0**) | 정규화 레코드 모델, version 필드 |
| F-12-06 | 에디터 렌더링 성능 | L | P1 (블록 단위 구독은 **P0** 설계) | 블록 트리, F-12-05 |
| F-12-07 | 초기 로딩 성능(번들·워터폴) | M | P1 | 라우팅, 인증, 캐시 |
| F-12-08 | 대용량 DB 성능 전략 | L~XL | P1 | DB/뷰/속성 모델, formula 엔진(의존 DAG) |
| F-12-09 | 이미지·파일 업로드/스토리지 | L | **P0**(기본 업로드) | 오브젝트 스토리지, 서명 URL(1h 만료), 권한 |
| F-12-10 | 웹 클리퍼 | L | P2 (HTML→block 변환기는 P1) | 임포트 변환기, 확장 인증 |
| F-12-11 | 데스크톱 앱 | M~L | P2 | 웹 앱 전체, 로컬 캐시, 알림, 릴리스 파이프라인 |
| F-12-12 | 모바일 동작 차이 | L | P1 (모바일 읽기는 P0) | 렌더러 플랫폼 분기, 반응형 |
| F-12-13 | 접근성(a11y) | M~XL | P1 (구조 결정은 **P0**) | 에디터 구조, 테마, 단축키 |
| F-12-14 | 지역화(i18n)·시간대 | M~L | P2 (UTC 날짜 저장은 **P0**) | 사용자 설정, 날짜 property |
| F-12-15 | 플랫폼 지원 매트릭스 | S | P1 (`isAvailable()` 게이팅은 **P0**) | feature flag, i18n |
| F-12-16 | 오류·복구 UX | L | **P0** | op 모델, 로컬 캐시, 권한, 네트워크 감지 |
| F-12-17 | 배포·자동 업데이트·버전 스큐 | M~L | P1 (`unknown_fields` 보존·큐 `schema_version`은 **P0**) | 세션, feature flag, F-12-16, 빌드 |
| F-12-18 | 성능 계측(RUM·회귀 방지) | M | P1 (측정 지점 심기는 **P0**) | 세션/디바이스 식별, 로깅, CI |
| F-12-19 | 서버 샤딩(Postgres 수평 분할) | XL | P2 (`space_id NOT NULL` 규율은 **P0**) | workspace 개념, 커넥션 풀러, F-12-18 |

**"나중에 못 고치는 것" 목록 (MVP에서 반드시 결정)**

| 결정 | 잘못 잡았을 때 비용 |
|---|---|
| 단일 vs 블록별 `contenteditable` | 접근성·복사붙여넣기·가상화 전략이 전부 바뀜. 에디터 전면 재작성 |
| 클라이언트 상태 구독 단위(페이지 vs 블록) | 대용량 페이지에서 입력 지연. 스토어 전면 교체 |
| 레코드에 단조 증가 `version` 필드 유무 | 캐시 무효화·오프라인 동기화 불가 |
| 날짜를 UTC + all_day 플래그로 저장 | 전 사용자 날짜 데이터 마이그레이션 |
| 파일을 asset 엔티티로 분리 vs URL 문자열 | 페이지 복제·GC·권한 통제 불가 |
| CSS 논리 속성 사용 여부 | RTL 지원 시 전 컴포넌트 수정 |
| 모든 도메인 테이블에 `space_id NOT NULL` 부여 | 수평 샤딩 자체가 불가능해짐. 라우팅 전 추가 조회가 필요해져 모든 쿼리가 2단계가 됨 (F-12-19) |
| op에 `origin`(local/remote) 태깅 | 서버가 트랜잭션을 거부했을 때 **내 변경만 롤백**하는 것이 불가능. 원격 변경까지 되돌려 데이터 손실 (F-12-16) |
| 파서가 미지의 필드/블록 타입을 보존(`unknown_fields`) | 구버전 클라이언트가 신버전 콘텐츠를 저장하며 조용히 삭제 (F-12-17) |
| 큐 태스크 payload에 `schema_version` 동봉 | 수년 뒤 발화하는 리마인더/예약 태스크를 해석 불가 (F-12-17) |
| 계측 이벤트에 `sample_rate`·`completed` 동시 기록 | 수집된 성능 수치가 실사용을 대표하지 못함. 사후 재계산 불가 (F-12-18) |
| 권한을 사전 계산(materialize)할 자리 확보 | 검색·목록 쿼리가 재귀 권한 조회로 전면 스캔이 됨 (F-12-02) |

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 이 도메인에서 참고할 점 | 차용 가능성 |
|---|---|---|
| **BlockSuite / AFFiNE** | 블록 모델을 **Yjs(CRDT) 위에 직접** 올려 실시간 협업·타임트래블·오프라인을 데이터 계층에서 한 번에 해결. Y.Doc이 git 리포지토리처럼 모든 연산을 기록하되 병합 충돌이 없다. 상태 갱신은 표준 바이너리로 증분 인코딩되어 어떤 전송 프로토콜에도 실을 수 있다. 복잡한 시각 문서(edgeless 모드)는 Turbo Renderer로 별도 최적화 | **높음** — 노션의 비공개 CRDT를 자체 구현하는 대신 Yjs를 채택하면 F-12-04(오프라인)의 난이도가 XL→L로 내려간다 |
| **AppFlowy** | Flutter + Rust, **로컬 우선(local-first)** 설계로 네트워크 없이 동작하는 것이 기본값. 배포는 AppFlowy-Cloud/GoTrue/PostgreSQL/Redis/MinIO 5개 서비스 | 중간 — 로컬 우선을 처음부터 전제하는 설계 참고. 다만 Flutter/Rust 스택은 웹 클론에 직접 이식 불가 |
| **Docmost** | PostgreSQL + Redis 2개 의존성만으로 실시간 협업 위키를 구성. 에디터는 Tiptap(ProseMirror) 계열, Mermaid/Draw.io/Excalidraw 임베드 | **높음** — MVP 인프라 최소 구성의 현실적 기준선 |
| **Outline** | 개인 노트가 아닌 **팀 위키** 지향, 처음부터 접근 제어와 속도에 집중. 자체 호스팅이 1급 시나리오 | 중간 — 검색/권한 필터링 설계 참고 |
| **Tiptap / BlockNote / Novel** | Notion 스타일 에디터의 기성 구현. Tiptap 공식 성능 가이드의 핵심 조언은 "**에디터를 별도 컴포넌트로 격리해 리렌더를 막아라**" — F-12-06의 실무 버전. BlockNote는 ProseMirror/Tiptap 위에 블록 개념을 얹은 형태 | **매우 높음** — 에디터를 처음부터 만들지 말 것. BlockNote 또는 Tiptap + 커스텀 블록으로 F-12-01/06의 대부분을 확보 |
| **react-notion-x** | 노션 recordMap을 그대로 받아 React로 렌더하는 구현체. **노션의 실제 블록 JSON 스키마와 렌더 규칙을 읽을 수 있는 사실상의 레퍼런스** | 높음 — 데이터 모델 설계 시 필드명·구조 대조용 |
| **sqlite-wasm / wa-sqlite** | F-12-05의 OPFS 기반 브라우저 SQLite를 직접 제공 | 낮음(v2 이후) — 노션이 겪은 다중 탭 문제를 그대로 겪게 된다 |

**권장 조합 (이 도메인 관점의 결론)**

```
MVP  : Next.js + Tiptap/BlockNote(단일 contenteditable) + PostgreSQL + S3호환 스토리지
       + TanStack Query 캐시 + 반응형 웹(모바일 읽기/편집) + 라이트/다크 테마
       + [F-12-16] 오프라인 배너·재시도 큐·거부 트랜잭션 롤백
       + [스키마 선결] 모든 테이블 space_id NOT NULL / op origin 태깅 / zod .passthrough()
         / 큐 payload schema_version / 서명 URL은 저장 금지·조회 시 생성
       + [F-12-18] web-vitals + 커스텀 mark로 initial_render 지표 심기(대시보드는 나중)
v1   : Yjs 도입(실시간 협업 + IndexedDB 로컬 영속) + 전문 검색(Meilisearch)
       + 커서 페이지네이션 DB 뷰 + i18n(ko/en)
       + [F-12-02] page_acl_effective 사전 계산 테이블 + 서브트리 재계산 잡
       + [F-12-17] 빌드 해시 헤더 → 새로고침 배너, CDN 청크 7일 유지
       + [F-12-15] platform_support JSON + isAvailable(featureKey) 게이팅
v2   : PWA/Tauri 셸(오프라인·전역 검색·알림) + 고대비 모드 + RTL + 웹 클리퍼 확장
       + [F-12-18] Lighthouse CI / Playwright 트레이스로 성능 예산 강제
       + [F-12-19] 읽기 복제본 → 필요 시 논리 샤드(고약수) 도입, 전환은 dark read 검증 필수
```

---

## 미해결 / 확인필요

| # | 항목 | 상태 |
|---|---|---|
| 1 | 노션이 사용하는 CRDT의 종류(자체 구현 vs Yjs 계열), 블록 단위인지 문서 단위인지 | `[확인필요]` — 블로그에 "CRDT 데이터 모델로 동적 마이그레이션"만 언급 |
| 2 | 유료 플랜 파일 업로드 한도의 정확한 값 | **해소(2026-09-06)** — 축이 4개로 분리됨: 저장 5MiB/5GiB, 인라인 렌더 5MB/20MB, 임포트 5MB/50MB, 요청 본문 500KB. 상충이 아니라 서로 다른 한도였음 (F-12-09) |
| 3 | 데이터베이스 property 총량 한도가 "페이지 2.5MB / DB 1.5MB"인지 문구 해석 | `[확인필요]` |
| 4 | 노션이 실제로 뷰포트 가상화를 사용하는지, 아니면 chunk 로딩 + 토글 지연 렌더만인지 | `[확인필요]` / 현재 서술은 `[추정]` |
| 5 | 로컬 SQLite 캐시의 eviction 정책(LRU? 용량 상한?) | `[확인필요]` — 미공개 |
| 6 | 업로드 파일 서명 URL의 만료 시간과 갱신 방식 | **해소(2026-09-06)** — developers.notion.com 명시: "expires after 1 hour", 파일 객체에 `expiry_time` 동봉, 갱신은 페이지 재fetch (F-12-09) |
| 7 | 노션 공식 VPAT / WCAG 적합성 선언 존재 여부 | `[확인필요 — 재확인함]` 2026-09-06 재검색에서도 **공개된 VPAT/ACR을 찾지 못했다.** trust.notion.com은 **요청 승인 기반 게이트**라 공개 문서로 확인 불가. 즉 "없다"가 아니라 "공개되지 않았다"가 정확한 서술 |
| 8 | 오프라인 중 서버에서 삭제된 페이지를 로컬 편집한 경우의 병합 정책 | `[확인필요]` |
| 9 | 모바일 컬럼 붕괴 시 다단·중첩 컬럼의 순서 결정 규칙 | `[추정]` — 좌→우 순서로 가정 |
| 10 | 리마인더 발송 시각의 기준 시간대(생성자 vs 수신자) | `[확인필요]` |
| 11 | 3perf 성능 분석 수치(2019년 기준)의 현재 유효성 | `[확인필요]` — 이후 코드 스플리팅·SQLite 도입으로 크게 달라졌을 것 |
| 12 | 블록 단위 subscriber store 서술의 1차 출처 | `[확인필요]` — 3자 기술 분석 글 근거, 노션 공식 문서 미확인 |
| 13 | 모바일 앱에서 **에디터 본문**이 네이티브인지 WebView인지 | `[추정]` — 공식 글은 Home/Search 탭의 네이티브 전환만 서술. Message Port JSON 직렬화 최적화 언급이 브리지 존재를 시사 (F-12-12) |
| 14 | response 스키마의 호환성 방향 규칙(구 클라이언트가 신 응답을 읽는 축) | `[추정]` — 노션 CI 글은 request 축만 명시 (F-12-17) |
| 15 | 워크스페이스 간 페이지 이동 시 샤드 간 데이터 이관 절차 | `[추정]` — 미공개. 복사→검증→삭제 3단계로 가정 (F-12-19) |
| 16 | hot shard(거대 워크스페이스 1개가 샤드 독점) 대응 방식 | `[추정]` — 미공개. 480 논리 샤드의 재배치 가능성이 완화 수단으로 보임 (F-12-19) |
| 17 | 지원 브라우저 "최근 N개 릴리스" 정책의 실제 구현(서버 정책 테이블 vs 클라이언트 하드코딩) | `[추정]` — 미공개 (F-12-15) |

---

## 출처

**1차 출처 (Notion 공식)**

1. https://www.notion.com/help/keyboard-shortcuts — 단축키 전수
2. https://www.notion.com/help/account-settings — 테마/고대비/언어 22종/시간대/데스크톱 설정
3. https://www.notion.com/help/use-pages-offline — 오프라인 동작·제약(50행, 하위페이지, 플랜)
4. https://www.notion.com/blog/how-we-made-notion-available-offline — `offline_page`/`offline_action` 테이블, push 채널, `lastDownloadedTimestamp`, CRDT 마이그레이션
5. https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite — OPFS VFS 선택, SharedWorker/Web Locks 구조, 20~33% 개선 수치
6. https://www.notion.com/blog/faster-page-load-navigation — IndexedDB→SQLite 전환 사유, 코드 스플리팅, 50% 개선
7. https://www.notion.com/help/optimize-database-load-times-and-performance — 250,000행 / 500 property / 2.5MB / 10,000 relation 한도
8. https://www.notion.com/help/images-files-and-media — 지원 포맷, 업로드 방식, 이미지 블록 조작
9. https://www.notion.com/help/web-clipper — 클리퍼 동작·제약
10. https://www.notion.com/help/notion-for-desktop — 데스크톱 고유 기능
11. https://www.notion.com/help/notion-for-mobile — 모바일 차이(컬럼 붕괴, hover 없음, 다중선택 불가)
12. https://www.notion.com/releases/2025-08-19 — 2.53 오프라인 모드 출시
13. https://www.notion.com/releases/2026-07-30 — 고대비 모드 베타
14. https://www.notion.com/help/system-requirements-for-notion — 지원 OS 최소 버전(macOS 12 / Windows 10 21H2 / iOS 17.0 / Android 8), 브라우저 지원 정책(Chrome 최근 8개, 기타 최근 2개), 지원 종료 기기 목록 (F-12-15)
15. https://www.notion.com/help/notion-error-messages — 실제 오류 문자열과 원인, 50,000 blocks/hour · 500KB paste(413) · 임포트 5MB/50MB 한도 (F-12-16, F-12-09)
16. https://www.notion.com/help/reset-notion — `Help > Troubleshooting > Reset & Erase All Local Data`, 리셋 시 로그아웃 (F-12-16)
17. https://www.notion.com/help/cant-access-notion — 네트워크 차단 진단 절차, `*.notion.com` allowlist (F-12-16)
18. https://www.notion.com/blog/how-notion-catches-breaking-schema-changes — 버전 스큐 CI 검사, ~1,300 엔드포인트 / ~296 큐 태스크 타입, TS assignability 규칙, GitHub 라벨 탈출구 (F-12-17)
19. https://www.notion.com/blog/migrating-notion-marketing-to-next-js — 웹·데스크톱·모바일 단일 monorepo + 전면 TypeScript (F-12-17)
20. https://www.notion.com/blog/notion-on-android-is-now-more-than-twice-as-fast-to-launch — `initial_home_render` P95 지표, sub-span 분해, PR 단위 Macrobenchmark, 세션 캐싱 30% / SQLite 스키마 체크 215ms / Baseline Profiles 12%, 네이티브 Home 3배·Search 80% (F-12-18, F-12-12)
21. https://www.notion.com/blog/sharding-postgres-at-notion — workspace 샤드 키, 32 물리 × 15 논리 = 480 샤드, audit log 이중 쓰기, 3일 백필, dark read, 5분 점검 (F-12-19)
22. https://www.notion.com/blog/the-great-re-shard — 32 → 96 물리 DB, 논리 15 → 5, 트리거(CPU 90%·IOPS·PgBouncer 커넥션), logical replication, 인덱스 후생성으로 3일→12시간, 무중단, 사후 CPU/IOPS 약 20% (F-12-19)
23. https://developers.notion.com/docs/working-with-files-and-media — 5 MiB(Free) / 5 GiB(유료), 20 MiB multi-part 임계값, 파일명 900 bytes (F-12-09)
24. https://developers.notion.com/docs/retrieving-files — 서명 URL "expires after 1 hour", `expiry_time` 필드 (F-12-09)
25. https://www.notion.com/help/notion-for-web — 웹 클라이언트 지원 범위 (F-12-15)

**2차 출처 (기술 분석 / 오픈소스)**

26. https://3perf.com/blog/notion/ — 웹앱 성능 케이스 스터디(번들, 워터폴, `loadPageChunk`)
27. https://github.com/toeverything/blocksuite — BlockSuite/AFFiNE 아키텍처
28. https://blocksuite.io/blog/document-centric — Yjs 기반 CRDT-native 에디터 설계
29. https://tiptap.dev/docs/guides/performance — 에디터 리렌더 격리
30. https://github.com/NotionX/react-notion-x — 노션 recordMap 렌더 레퍼런스
31. https://docmost.com/blog/open-source-notion-alternatives/ — Docmost/AppFlowy/Outline 아키텍처 비교
32. https://www.techaheadcorp.com/blog/tech-stack-powering-notion-block-based-editor/ — 블록 단위 subscriber store 서술(1차 출처 아님)
33. https://ixd.prattsi.org/2024/12/assessing-the-accessibility-of-notion/ — 노션 접근성 3자 평가
34. https://trust.notion.com/ — 노션 Trust Center. 요청 승인 기반 게이트이며 **공개 VPAT/ACR은 확인되지 않음**(미해결 #7)
