# 07. 검색 · 네비게이션 · 커맨드

> 조사 기준일: 2026-09-06 / 조사 대상: Notion 공식 헬프센터, developers.notion.com, Notion 엔지니어링 블로그, 오픈소스 클론(Outline, AFFiNE/BlockSuite, Docmost, AppFlowy)
> 태그 규칙: `[추정]` = 공개 근거 없이 추론한 내용, `[확인필요]` = 1차 출처로 검증하지 못한 내용

## 요약

이 도메인은 "블록 트리로 쌓인 콘텐츠를 다시 꺼내는" 경로 전체를 담당한다. 구성 요소는 (1) 전문(lexical) 검색 인덱스와 그 위의 검색 패널, (2) 최근 방문/히스토리 기반 내비게이션, (3) 텍스트 입력 중 발생하는 인라인 자동완성(`@`, `[[`, `+`, `/`), (4) 의미 기반 AI Q&A 검색, (5) 사이드바 트리와 `Home`·`Library` 브라우징 표면, (6) URL·breadcrumb·블록 앵커 라우팅, (7) 외부 클라이언트용 REST/MCP 검색 표면이다. Notion에서 검색은 별도 화면이 아니라 `cmd/ctrl + K`로 열리는 오버레이이며, 같은 오버레이가 "이동(navigate)"과 "찾기(search)"를 동시에 수행한다. 인덱싱 단위가 페이지가 아니라 **block**이고, 권한이 인덱스 시점에 문서로 비정규화(denormalize)되어 들어간다는 점이 이 도메인 전체의 설계를 지배한다. (출처: https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer)

---

## 핵심 개념 / 데이터 모델

### 개념 계층

| 개념 | 정의 | 비고 |
|---|---|---|
| `block` | 검색 인덱스의 최소 단위. Notion은 "every block users create, edit, or delete"를 색인 대상으로 삼는다 | 출처: Notion 엔지니어링 블로그 |
| `search_document` | 인덱스에 저장되는 1건. block 1개 → document 1개 대응 | 권한/언어/버전이 문서에 embed됨 |
| `space_id` (workspace/teamspace) | 인덱스·샤드 라우팅 키. "The routing key (spaceId)" | 검색은 항상 space 스코프 내에서 시작 |
| `principal` | 권한 주체(user, group, teamspace, public) | 인덱스 시점에 문서에 배열로 박힘 |
| `span` (chunk) | AI 검색용. 긴 페이지를 잘라 각각 embedding한 조각 | 출처: two-years-of-vector-search |
| `link_edge` | 페이지 간 참조. mention / link_to_page / child 3종 | backlink 계산의 원천 |

### 의사 스키마

```sql
-- ── 1. 원본(OLTP) ────────────────────────────────────────────────
block (
  id              uuid pk,
  space_id        uuid not null,          -- 라우팅/스코프 키
  parent_id       uuid,                   -- 블록 트리
  parent_table    enum('block','space','data_source'),
  page_id         uuid not null,          -- 소속 페이지(자기 자신일 수 있음)
  type            text not null,          -- 'page','paragraph','heading_1',...
  plain_text      text,                   -- rich_text[] 를 flatten 한 결과(인덱싱용 파생 컬럼)
  properties      jsonb,                  -- title 포함
  created_by      uuid, created_at    timestamptz,
  last_edited_by  uuid, last_edited_at timestamptz,
  in_trash        bool default false,
  version         bigint                  -- 낙관적 버전(외부 버전으로 ES에 전달)
)

-- ── 2. 검색 인덱스 문서 ──────────────────────────────────────────
search_document (
  doc_id          = block.id,
  routing         = space_id,             -- 샤드 결정
  page_id, parent_id, type,
  ancestor_ids    uuid[],                 -- breadcrumb + 'In' 필터용 (비정규화)
  title_text      text,                   -- 소속 페이지 제목 (가중치 상향용)
  body_text       text,                   -- 블록 본문
  lang            text,                   -- 언어 감지 → per-language analyzer 선택
  principals      uuid[],                 -- ★ 권한 비정규화. 쿼리시 terms 필터로 사용
  is_public       bool,
  created_by      uuid, created_at     timestamptz,
  last_edited_by  uuid, last_edited_at timestamptz,
  in_trash        bool,
  version         bigint                  -- version_type: external
)
-- 필요한 인덱스: (routing=space_id) 샤드 라우팅,
--                principals terms 필터,
--                body_text/title_text 역색인(언어별 analyzer),
--                last_edited_at / created_at range + sort

-- ── 3. AI(semantic) 인덱스 ──────────────────────────────────────
vector_span (
  span_id         uuid pk,
  page_id, space_id,
  chunk_index     int,
  text            text,
  embedding       vector(N),
  text_hash       bytea,                  -- 본문 해시 → 재임베딩 여부 판단
  meta_hash       bytea,                  -- 메타 해시 → 메타만 갱신할지 판단
  principals      uuid[], authors uuid[],
  last_edited_at  timestamptz
)
-- 출처: "two hashes per span: one on the span text, and the other on all of the metadata fields"

-- ── 4. 내비게이션 상태 ──────────────────────────────────────────
recent_visit (
  user_id uuid, block_id uuid, space_id uuid,
  last_visited_at timestamptz, visit_count int,
  pk (user_id, block_id)
)
-- 인덱스: (user_id, last_visited_at desc) — 검색 패널 빈 상태 렌더링용

nav_history (                              -- 클라이언트 세션 로컬로 두는 편이 현실적 [추정]
  session_id, seq int, block_id uuid, scroll_anchor text
)

favorite (                                 -- 사이드바 Favorites / Home / Library 공용 (F-07-16, F-07-19)
  user_id uuid, block_id uuid, space_id uuid,
  order_key text,                          -- fractional index. 정수 시퀀스 금지
  created_at timestamptz,
  pk (user_id, block_id)
)
-- 인덱스: (user_id, order_key)

sidebar_section_pref (                     -- Sort / Show(5~all) / Move section / 접힘 상태
  user_id uuid, surface text,              -- 'sidebar' | 'home' | 'library'
  section text,                            -- 'recents'|'favorites'|'shared'|'private'|'teamspaces'
  visible bool, show_count int,            -- null = all
  sort_key text, position int, collapsed bool,
  pk (user_id, surface, section)
)
-- 근거: 헬프센터가 섹션별 Sort / Show(display 5-all pages) / Move section을 명시.
--      즉 사이드바·Home은 하드코딩 렌더가 아니라 사용자 설정을 읽는 컴포넌트다.

-- ── 5. 링크 그래프 ──────────────────────────────────────────────
link_edge (
  id uuid pk,
  source_block_id uuid,                   -- 링크가 박힌 블록
  source_page_id  uuid,
  target_page_id  uuid,
  link_type enum('mention','link_to_page','child','block_anchor','external_url'),
  created_at timestamptz,
  unique (source_block_id, target_page_id, link_type)
)
-- 인덱스: (target_page_id) — backlink 조회의 핵심

-- ── 6. 계측 ────────────────────────────────────────────────────
search_query_log (
  id uuid pk, user_id, space_id,
  query text, filters jsonb,
  result_count int, duration_ms int,
  clicked_doc_id uuid, clicked_rank int,
  source enum('app','api','slack','mcp'),
  created_at timestamptz
)
-- Outline의 SearchQuery 모델이 동일한 형태(query/results/duration/score/source/userId/teamId)를 갖고,
-- prefix 관계인 연속 타이핑을 하나의 row로 접는다. 랭킹 튜닝 근거 데이터로 필수.
```

### 이 도메인의 불변식

1. **검색 결과는 절대 권한을 넘지 못한다.** 인덱스 문서에 `principals`가 없으면 쿼리 시점 권한 조인이 필요해지고, 그 순간 latency와 정확도가 동시에 무너진다. Notion은 인덱싱 시점 해소를 택했다.
2. **인덱스는 eventual consistent다.** 공식 API 문서가 "Results are not immediate; newly shared pages may not appear right away"라고 명시한다. UI는 이 지연을 전제로 설계해야 한다(공식 문서가 수동 새로고침 버튼을 권고할 정도).
3. **`@`/`[[`/`+`/`/` 자동완성은 검색과 같은 저장소를 쓰지만 다른 랭킹을 쓴다.** 자동완성은 제목 prefix + 최근 방문 가중이 지배적이다 `[추정]`.

---

## 기능 명세

### F-07-01 글로벌 검색 패널 (Quick Find / Search)

- **한 줄 정의**: `cmd/ctrl + K` 또는 `cmd/ctrl + P`로 워크스페이스 어디서든 오버레이를 열어, 페이지 이동과 전문 검색을 한 입력창에서 수행한다.
- **사용자 시나리오**:
  1. 사용자가 `cmd + K`를 누른다. **단축키 충돌 규칙(공식 확인)**: 헬프센터는 `cmd/ctrl + P` 또는 `cmd/ctrl + K`를 "opens search or jumps to recently viewed pages"로 기술하는 동시에, 같은 문서에서 "**With text selected, press `cmd/ctrl` + `K` to add a link**"라고 명시한다. 즉 분기 조건은 "커서가 블록 안에 있는가"가 아니라 **"텍스트가 선택되어 있는가"**다 — 선택 있음 → 링크 편집, 선택 없음 → 검색 오버레이. `cmd/ctrl + P`는 이 충돌이 없는 우회 경로다. (출처: https://www.notion.com/help/keyboard-shortcuts)
  2. 오버레이가 열리고 입력창은 비어 있으며, **최근 방문 페이지 목록**이 방문 시각과 함께 표시된다.
  3. 한 글자 입력할 때마다 debounce 후 서버 질의 → 결과 리스트가 교체된다(search-as-you-type).
  4. `↑`/`↓`로 결과 이동, `Enter`로 열기, `cmd + click`으로 새 Notion 탭에서 열기.
  5. `Esc`로 닫으면 원래 커서 위치로 포커스가 복귀한다.
- **동작 상세**:
  - 기본 정렬은 `Best Matches`. 사용자가 정렬을 바꾸면 세션 내 유지된다 `[추정]`.
  - 검색 대상: **페이지 제목, 페이지 본문 텍스트, 데이터베이스 엔트리 이름과 property 값**.
  - **따옴표 구문 검색 지원(공식 확인)**: "If you want to search for an exact word or string or words, put your search term in between quotes, like `"my projects"`." → 쿼리 파서가 최소한 phrase 연산자를 갖는다는 뜻이다.
  - **CJK 지원 공식 명시**: "You can use queries with CJK characters in search!" — 한국어 클론에서 이 문장이 곧 요구사항이다(F-07-02 analyzer 절 참조).
  - **결과에 인기도 라벨이 붙는다(공식 확인)**: "To help you find information more quickly, labels like `Most viewed` or `Popular this week` will appear next to certain results." → 조회수/최근 인기 집계가 **최소한 표시 레벨에서는 실재**한다. 이것이 랭킹 점수에도 반영되는지는 `[추정]`(F-07-02).
  - 검색 제외 대상(공식 명시): **댓글/디스커션**, **페이지·사람에 대한 @mention 텍스트**(예: `@Doug`), **select/multi-select property 태그**. 단 날짜 mention(`@Today`)은 검색된다.
  - 입력 0자 = "이동 모드"(최근 방문), 1자 이상 = "검색 모드". 같은 컴포넌트가 상태만 바꾼다.
  - 2022년 개편 시 Notion이 공개한 수치: 정확도 개선 + **40~50% 속도 향상**(공식 X 게시물).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 쿼리 | 검색 API 호출하지 않음. `recent_visit` 상위 N건만 렌더 |
  | 공백/특수문자만 입력 | 질의 전송하지 않고 이전 결과 유지 |
  | 결과 0건 | "검색 결과 없음" + 필터 해제 제안 + "AI로 전체 소스 검색" 유도 |
  | 방금 만든 페이지 | 인덱스 지연으로 미노출 가능 → 로컬 캐시(최근 방문/열린 탭)를 결과 상단에 머지하는 보정 필요 `[추정]` |
  | 권한 없는 페이지 | 결과에서 완전히 제외. 존재 사실도 노출 금지 |
  | 삭제(휴지통) 페이지 | 기본 제외. API에는 `filter.in_trash: true` 옵션이 있고 "Trash results are search-index-backed and eventually consistent"라고 명시 |
  | 동시편집 중인 페이지 | 인덱스는 최신 커밋 기준. 미저장 로컬 편집분은 검색되지 않음 |
  | 대용량 워크스페이스 | 결과 상한이 존재하고 **완전 열거는 보장되지 않는다**. 공식 문구: "Search is not guaranteed to return everything, and the index may change as your connection iterates through pages and databases". 구체 상한이 문서화된 곳은 MCP 툴 스펙이며 **`notion-search` / `notion-ai-search` 모두 "up to 50 results"**. REST `/v1/search`의 `page_size` 기본값은 **100**이고, 공식 권고는 "Lowering `page_size` from the default of 100 can accelerate results" |
  | ~~`request_status.incomplete_reason`~~ | ❌ **정정**: 이전 판이 기재했던 `request_status.incomplete_reason = "query_result_limit_reached"`는 Notion 공식 API 문서(post-search / search-optimizations-and-limitations / get-self)에서 **확인되지 않았다**. 근거 없는 필드명이므로 스펙에서 제거한다 |
  | 오프라인 | 로컬 캐시된 최근 방문만 노출, 서버 검색 비활성 `[추정]` |
- **데이터 모델 함의**: `search_document` + `recent_visit`. 검색 요청은 `(space_id, principals[], query, filters, sort, cursor)`를 받아 `(doc_id, page_id, title, snippet, breadcrumb[], last_edited_at, score)` 리스트를 반환. breadcrumb 렌더링을 위해 `block.parent_id` 상향 경로가 필요하므로, 조상 경로를 인덱스 문서에 미리 넣어두는 편이 낫다(`ancestor_ids[]`, `ancestor_titles[]`) `[추정]`. 응답은 cursor 기반 페이지네이션(공식 API도 `start_cursor`/`next_cursor`/`has_more`).
- **UI/인터랙션**: `cmd/ctrl + K`, `cmd/ctrl + P` 열기 / `Esc` 닫기 / `↑↓` 이동 / `Enter` 열기 / `cmd/ctrl + click` 새 탭 / 결과 항목에 breadcrumb·마지막 편집 시각 노출 / 필터 칩은 입력창 아래 가로 배치.
- **의존 기능**: F-07-02(랭킹), F-07-03(필터), F-07-04(최근 방문), F-07-06(인덱싱), F-07-07(권한).
- **구현 난이도**: **L (1~2주)** — 오버레이 UI 자체는 M이지만, search-as-you-type의 요청 취소·경쟁 조건 처리, 빈 상태/검색 상태 전환, breadcrumb 조립까지 포함하면 L.
- **우선순위**: **P0** — 사이드바 트리만으로는 페이지 100개를 넘기는 순간 제품이 사용 불가가 된다.
- **클론 시 현실적 대안**: Elasticsearch 없이 PostgreSQL `tsvector` + GIN 인덱스로 시작. 프론트는 `cmdk` 류 커맨드 팔레트 라이브러리 + 200~300ms debounce + `AbortController`로 이전 요청 취소.
- **참고 출처**: https://www.notion.com/help/search , https://www.notion.com/help/keyboard-shortcuts , https://developers.notion.com/reference/post-search , https://x.com/NotionHQ/status/1567183564554338304

---

### F-07-02 검색 쿼리 파싱 및 결과 랭킹

- **한 줄 정의**: 입력 문자열을 질의로 변환하고, 매칭된 문서를 사용자가 원할 확률 순으로 정렬한다.
- **사용자 시나리오**: "onboarding checklist" 입력 → 제목이 정확히 일치하는 페이지가 1위, 본문에 두 단어가 인접 등장하는 페이지가 그다음, 한 단어만 있는 페이지가 하위에 배치된다. 정렬 드롭다운에서 `Last Edited: Newest First`를 고르면 점수 무시하고 시각순으로 재정렬된다.
- **동작 상세**:
  - 정렬 옵션(공식 명시, verbatim): `Best Matches`(기본), `Last Edited: Newest First`, `Last Edited: Oldest First`, `Created: Newest First`, `Created: Oldest First`.
  - `Best Matches`의 내부 랭킹 공식은 **비공개**다. 관측 가능한 신호에서 추론하면 다음 조합 `[추정]`:
    | 신호 | 방향 | 근거 수준 |
    |---|---|---|
    | 제목 필드 매칭 | 본문보다 큰 가중치 | `Title only` 필터가 별도 존재 → 필드 분리 인덱싱은 확실 |
    | 텍스트 유사도(BM25 계열) | 기본 점수 | Elasticsearch 사용 사실로부터 `[추정]` |
    | 최근 편집 시각 | 최근일수록 가산(recency decay) | ✅ **확인됨(이전 판의 `[확인필요]` 해소).** 헬프센터가 기본 정렬을 "Best Matches (default, **with recently edited pages ranked higher**)"로 기술한다. 즉 recency는 별도 정렬 옵션일 뿐 아니라 **Best Matches 점수 자체에 섞여 있다.** 클론은 `score = relevance * f(recency)` 또는 `relevance + w·recency_decay` 형태를 처음부터 전제할 것 |
    | 문서 인기도(조회수/최근 조회 급증) | 가산 | **근거 상향**: 헬프센터가 결과 옆에 `Most viewed` / `Popular this week` 라벨이 붙는다고 명시한다. 즉 Notion은 **페이지 단위 조회수 집계를 이미 보유하고 검색 결과 렌더 경로에서 읽는다.** 이 값이 점수에도 더해지는지는 `[추정]`이지만, 최소한 "인기도 신호가 검색 파이프라인에 존재한다"는 사실은 확인됨 |
    | 본인 방문/편집 이력 | 개인화 가산 | `[추정]` — 공개 근거 없음. 다만 빈 쿼리 상태가 `recent_visit` 기반이라는 점에서 개인 이력 데이터 자체는 확실히 존재한다 |
    | 언어별 analyzer | 형태소/스테밍 정확도 | "per-language analyzers" 명시됨 |
  - Notion은 인덱싱 시 **언어 감지 후 언어별 analyzer**를 적용한다(reindexer 사례 연구에 명시). 한국어 클론이라면 이 지점이 결정적이다.
  - **공개 REST API는 UI 검색과 전혀 다른 물건이다 — 반드시 구분할 것.** 엔드포인트 이름부터 "Search by title"이고, 공식 설명은 "Returns all pages or data_sources, **excluding duplicated linked databases, that have titles that include the query param**"이다. 즉 `/v1/search`는 **제목만 매칭하며 본문을 검색하지 않는다**. UI 검색(본문·property 포함)과 API 검색(제목 전용)의 이 비대칭을 모르고 API 동작을 UI 스펙의 근거로 삼으면 스펙이 통째로 어긋난다.
  - API 랭킹은 훨씬 단순하다: `sort.property: "relevance"` 또는 `sort.timestamp: "last_edited_time"` 둘 중 하나이며 **상호배타**. sort 미지정 시 최근 편집순. `filter`는 `{property:"object", value:"page"|"data_source"}` 또는 `{in_trash: bool}` 형태만 받는다.
  - **MCP 표면에는 두 개의 서로 다른 검색 엔진이 노출된다**(F-07-18): `notion-search`(키워드, "short, specific keywords")와 `notion-ai-search`(시맨틱, "concise natural-language semantic query"). 공식 툴 스펙이 둘을 분리해 문서화한다는 사실이, F-07-01(lexical)과 F-07-13(semantic)이 **같은 인덱스를 공유하지 않는 별개 파이프라인**이라는 이 문서의 전제를 뒷받침한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 오타 | Notion 검색이 fuzzy에 약하다는 사용자 보고 다수 `[확인필요]`. 클론은 trigram fallback 권장 |
  | 한국어 형태소 | 기본 `simple` analyzer로는 "검색이" ≠ "검색" 문제 발생. 형태소/bigram 처리 필수 |
  | 따옴표 구문 검색 | ✅ **공식 지원 확인됨**(이전 판의 `[확인필요]` 해소): "put your search term in between quotes, like `"my projects"`". 따라서 쿼리 파서에 phrase 연산자가 **필수**다. Postgres `websearch_to_tsquery`가 따옴표 구문/OR/`-`(NOT)을 그대로 지원하므로 v0에서 공짜로 충족된다. 단 `to_tsquery`/`plainto_tsquery`를 쓰면 따옴표가 무시되므로 반드시 `websearch_to_tsquery`를 쓸 것 |
  | 불리언 `OR` / `-`(제외) | Notion UI 지원 여부는 여전히 `[확인필요]` — 헬프센터가 따옴표만 명시하고 불리언은 언급하지 않는다. 클론은 `websearch_to_tsquery` 덕분에 어차피 따라오므로 스펙에 넣어도 비용이 0 |
  | 매우 짧은 쿼리(1~2자) | CJK에서는 유효 쿼리다. 헬프센터가 "You can use queries with CJK characters in search!"로 CJK를 명시 지원하므로, **최소 길이 제한을 영문 기준(3자 등)으로 두면 한국어에서 검색이 통째로 죽는다.** 최소 길이는 스크립트 판별 후 CJK는 1자, 라틴은 2자로 분기할 것 |
  | 동일 페이지의 여러 블록 매칭 | 페이지 단위로 접어서 1건 표시 + 최고 점수 블록의 스니펫 노출(collapse/dedup 필수) |
  | Linked database 중복 | API 문서상 "Duplicated linked databases automatically removed from results" — 중복 제거 규칙 필요 |
  | 결과 상한 도달 | 완전 열거를 보장하지 않음. API는 "Search cannot exhaustively return all documents a bot can access; the index may shift during iteration"이라고 명시 |
- **데이터 모델 함의**:
  - 필드 분리 저장 필수: `title_text`(weight A) / `body_text`(weight B~C). Postgres라면 `setweight(to_tsvector(...,title),'A') || setweight(to_tsvector(...,body),'B')`.
  - 페이지 단위 접기를 위해 `search_document.page_id`로 group by 후 `max(score)`.
  - 랭킹 튜닝을 위해 `search_query_log.clicked_rank` 수집이 사실상 전제조건.
- **UI/인터랙션**: 정렬 드롭다운, 매칭 토큰 하이라이트(Postgres `ts_headline`으로 서버 생성 권장), 결과당 1~2줄 스니펫.
- **의존 기능**: F-07-06(인덱싱), F-07-01(패널).
- **구현 난이도**: **L** — 기본 BM25/ts_rank 정렬만이면 S지만, 한국어 analyzer + 페이지 단위 dedup + 스니펫 하이라이트까지 합치면 L.
- **우선순위**: **P0** (기본 정렬) / **P1** (개인화 랭킹).
- **클론 시 현실적 대안**: v0는 `ts_rank_cd(setweight 조합, websearch_to_tsquery(q))` + `last_edited_at` 타이브레이커. 개인화는 "최근 30일 내 본인이 방문한 페이지에 고정 보너스 점수" 정도로 단순화. 오타 대응은 `pg_trgm` similarity를 0건일 때만 fallback으로 실행.
- **참고 출처**: https://www.notion.com/help/search , https://developers.notion.com/reference/post-search , https://developers.notion.com/reference/search-optimizations-and-limitations , https://www.zenml.io/llmops-database/rebuilding-a-production-search-reindexing-pipeline-at-scale

---

### F-07-03 검색 필터 (작성자 · 기간 · 위치 · teamspace)

- **한 줄 정의**: 검색 결과를 메타데이터 조건으로 좁힌다.
- **사용자 시나리오**: `cmd+K` → "회고" 입력 → 결과가 많음 → `Created by`에서 본인 선택 → `Date`에서 "지난 30일" 선택 → 결과 12건으로 축소.
- **동작 상세**:
  - 공식 헬프센터가 명시한 필터 목록(verbatim): **`Title only`**, **`Created by`**, **`Teamspace`**(Plus/Business/Enterprise 플랜 한정), **`In`**, **`Date`**.
  - **헬프센터 목록은 UI의 전부가 아니다.** Notion MCP 공식 툴 스펙(`notion-search`)은 필터 축을 더 넓게 문서화한다: **location(page / data source / teamspace), creator, editor(최종 편집자), date, title, content status**. 헬프센터에 없는 **`editor`(최종 편집자)** 와 **`content status`** 축이 여기서 확인된다. 두 문서가 같은 백엔드 필터 집합을 다른 해상도로 서술한 것으로 보인다 `[추정]`.
  - **필터에도 플랜 게이팅이 걸린다(MCP 스펙 verbatim)**: "Full Notion MCP on Business or Enterprise is required to filter by editor, last-edited date, multiple teamspaces, title only, or content status, and to sort by date". 즉 `Teamspace` 하나만 게이팅된다는 이전 판의 서술은 **최소한 MCP 표면에서는 틀렸다** — 다중 teamspace, editor, 최종편집일, title only, content status, 날짜 정렬이 모두 상위 플랜 요건이다. UI에서도 동일한지는 `[확인필요]`.
  - Quick Filter 계열의 원터치 칩("created by me", "edited last week", "on the current page")은 **재검증에서도 확인되지 않았다** `[확인필요]`. 헬프센터 `help/search` 본문을 다시 읽어도 필터 목록은 `Title only` / `Created by` / `Teamspace` / `In` / `Date` 5종뿐이고 원터치 칩에 대한 기술이 없다. 근거는 검색 결과 스니펫 수준에 머문다 — **스펙에서는 "있을 수도 있는 UI 축약"으로만 취급하고, 필수 요구사항으로 올리지 말 것.**
  - `Title only`는 매칭 범위를 본문에서 제목으로 제한하는 **토글**이지 값 선택 필터가 아니다.
  - `In`은 특정 페이지/데이터베이스 하위로 스코프를 제한한다(조상 경로 필터).
  - `Teamspace` 필터는 플랜 게이팅이 걸린 유일한 필터다.
  - 데이터베이스 뷰의 filter/sort(F-05 도메인)와는 완전히 별개 시스템이다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 필터만 있고 쿼리 없음 | 유효한 질의로 취급(예: "지난주 내가 만든 모든 페이지"). match_all + filter |
  | 삭제된 사용자로 `Created by` 필터 | 표시명은 tombstone으로 유지, 필터는 계속 동작해야 함 |
  | 필터 조합 결과 0건 | 어떤 필터가 결과를 죽였는지 표시하고 개별 해제 유도 |
  | `In` 대상 페이지가 삭제됨 | 필터 칩을 무효 상태로 표시하고 자동 해제 |
  | teamspace 접근 권한 상실 | 해당 teamspace를 필터 후보에서 제거, 이미 선택돼 있으면 해제 |
  | 대용량 워크스페이스의 `Created by` 후보 목록 | 멤버 수천 명 → 후보 셀렉터 자체가 검색형이어야 함 |
  | 필터 상태와 브라우저 뒤로가기 | 필터를 URL 쿼리스트링에 직렬화해야 공유/복원이 성립 |
- **데이터 모델 함의**:
  - `search_document`에 필터 대상 필드가 **모두 인덱스에 존재**해야 한다: `created_by`, `created_at`, **`last_edited_by`(= `editor` 필터축)**, `last_edited_at`, `space_id`(teamspace), `ancestor_ids[]`(`In` 필터용), **`content_status`(= content status 필터축, DB property가 아니라 페이지 레벨 상태값)**. 필터 축을 나중에 추가하면 **인덱스 전량 재색인**이 필요하므로, 쓰지 않을 필드라도 v0 스키마에 컬럼만은 뚫어두는 편이 싸다.
  - 필터 축과 정렬 축이 플랜 게이팅 대상이라는 점의 함의: 게이팅은 **쿼리 빌더 단계에서** 걸어야 한다. UI에서 칩만 숨기고 API가 필드를 받아주면 그대로 우회된다.
  - `ancestor_ids[]`가 없으면 `In` 필터는 재귀 CTE로 후보 집합을 만든 뒤 IN 절로 넘겨야 하고, 하위 페이지가 수만 개면 즉시 무너진다. → **조상 경로 비정규화가 사실상 필수**.
  - 필터 상태는 URL 쿼리스트링에 직렬화.
- **UI/인터랙션**: 입력창 아래 필터 칩 행. 칩 클릭 → 팝오버. 선택 시 칩에 값 요약 표시. `Backspace`로 마지막 칩 제거 `[추정]`.
- **의존 기능**: F-07-01, F-07-06, 권한/teamspace 도메인.
- **구현 난이도**: **M (2~5일)** — 필터 UI 4~5종 + 쿼리 빌더. 단 `In` 필터의 조상 경로 비정규화를 인덱싱에 넣으면 L로 상승.
- **우선순위**: **P1** — MVP에서는 `Created by` + `Date` 2개만으로 충분. `Teamspace`/`In`은 워크스페이스가 커진 뒤 가치가 생긴다.
- **클론 시 현실적 대안**: v0는 `Title only` 토글 + `Created by`(본인/전체) + `Date`(전체/1주/1개월/1년) 3개만. `In` 필터는 "현재 페이지 하위에서 검색"이라는 단일 상황으로 축소하면 `ancestor_ids` 없이 materialized path(`page.path LIKE '/a/b/%'`)로 처리 가능.
- **참고 출처**: https://www.notion.com/help/search

---

### F-07-04 최근 방문 페이지 (Recent) 및 빈 상태 내비게이션

- **한 줄 정의**: 검색어를 입력하기 전, 최근에 본 페이지 목록을 방문 시각과 함께 제시해 "검색 없는 이동"을 가능하게 한다.
- **사용자 시나리오**: `cmd + P` → 아무것도 입력하지 않음 → 방금 전 보던 회의록, 어제 본 스펙 문서가 순서대로 보임 → `↓↓ Enter`로 이동. 헬프센터가 `cmd/ctrl + P`를 "open search **or jump to a recently viewed page**"로 기술할 만큼 이 경로가 1급 시나리오다.
- **동작 상세**:
  - 헬프센터: 검색 패널은 "pages from your workspace that you've visited lately and when"을 보여준다. 즉 **항목 + 방문 시각**이 함께 표시된다.
  - 기록 트리거: 페이지를 실제로 렌더링했을 때 기록. 스크롤만 스쳐간 preview/peek 포함 여부는 `[확인필요]`.
  - 동일 페이지 재방문 시 새 row가 아니라 `last_visited_at` 갱신(upsert).
  - 디바이스 간 동기화됨 `[추정]` — 서버 저장이어야 데스크톱/웹 간 일관성이 생긴다.
  - **`Recents`는 검색 오버레이 전용이 아니라 3개 표면에서 재사용되는 공용 데이터다(재조사에서 확인)**:
    | 표면 | 공식 문구 | 함의 |
    |---|---|---|
    | 검색 오버레이 빈 상태 | "pages from your workspace that you've visited lately and when" | 항목 + 방문 시각 |
    | 사이드바 `Home` 탭의 `Recents` 섹션 | Home은 "Upcoming events, Recents, Favorites, Agents, Teamspaces, Shared pages, Private pages" 섹션으로 구성된다 | 상시 노출 표면 |
    | `Library`의 `Recents` 탭 | "Recents — Quickly find pages you viewed recently" | 브라우징 표면(F-07-19) |
  - **표시 개수는 사용자 설정값이다(공식 확인)**: Home 섹션은 `•••` 메뉴의 `Show`로 노출 개수를 조절하고(사이드바 섹션 기준 "display 5-all pages"), `Sort`, `Move section`도 제공된다. → 클론에서 `limit`은 상수가 아니라 **사용자별 설정 필드**여야 한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 최근 방문한 페이지의 권한이 회수됨 | 목록에서 즉시 제거(권한 필터를 조회 시점에 재적용) |
  | 페이지가 휴지통으로 이동 | 기본 숨김. 완전 삭제 시 row 정리(주기적 GC 또는 조인 시 필터) |
  | 페이지 제목 변경 | 목록은 현재 제목을 보여줘야 함 → 제목을 복사 저장하지 말고 조인 |
  | 방문 이력 0건(신규 사용자) | 워크스페이스 루트 페이지/템플릿 추천으로 대체 |
  | 게스트 사용자 | 본인이 접근 가능한 페이지만 |
  | 봇/API 접근 | 방문 기록 남기지 않음 |
  | 같은 페이지를 1분에 20번 오감 | 쓰기 폭주 → 클라이언트 throttle(페이지당 N분 1회) |
- **데이터 모델 함의**:
  ```sql
  recent_visit (user_id, block_id, space_id, last_visited_at, visit_count, pk(user_id, block_id))
  index (user_id, last_visited_at desc)
  ```
  - 보관 상한: 사용자당 최근 200건만 유지하고 초과분 삭제 `[추정]`.
  - "언제 봤는지" 표시를 위해 상대 시각 포맷팅(방금/3시간 전/어제) 필요.
  - 사이드바 `Home`의 `Recents` 섹션, `Library`의 `Recents` 탭과 **같은 테이블을 공유**한다. 조회 API는 표면을 인자로 받아야 한다: `getRecents(user_id, space_id, limit, cursor)` — 오버레이는 limit 5~7, Home 섹션은 사용자 설정값, Library 탭은 페이지네이션.
  - 표시 개수 설정 저장소:
    ```sql
    sidebar_section_pref (
      user_id uuid, section text,        -- 'recents'|'favorites'|'shared'|'private'|...
      show_count int,                    -- 5 | 10 | ... | null(=all)
      sort_key text, position int,       -- 'Sort' / 'Move section'
      collapsed bool,
      pk (user_id, section)
    )
    ```
  - **읽기 경로가 3개이므로 권한 재필터도 3곳에서 일어난다.** 권한 필터를 조회 함수 안쪽(단일 지점)에 두지 않으면 F-07-07의 누출 지점이 하나 더 생긴다.
- **UI/인터랙션**: 아이콘 + 제목 + breadcrumb + 상대 시각. `↑↓ Enter`로 조작.
- **의존 기능**: 페이지 라우팅, 권한.
- **구현 난이도**: **S (1일 내)** — upsert 테이블 하나 + 정렬 조회. 이 도메인에서 비용 대비 효과가 가장 크다.
- **우선순위**: **P0** — 검색 인덱스가 완성되기 전에도 단독으로 내비게이션 가치를 제공한다. **인덱싱 파이프라인보다 먼저 만들 것.**
- **클론 시 현실적 대안**: 원본 그대로 구현 가능. 초기에는 `localStorage`로도 동작하지만 디바이스 간 일관성이 깨지므로 서버 테이블 권장.
- **참고 출처**: https://www.notion.com/help/search , https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/navigate-with-the-sidebar , https://www.notion.com/help/manage-your-library

---

### F-07-05 페이지 내 검색 (Find in page, `cmd/ctrl + F`)

- **한 줄 정의**: 현재 열려 있는 페이지 안에서만 문자열을 찾고 매칭 위치로 이동한다.
- **사용자 시나리오**: 긴 문서에서 `cmd + F` → 인풋 등장 → "API key" 입력 → 매칭 개수 표시(예: 3/12) → `Enter`/`↓`로 다음 매칭으로 스크롤 이동 + 하이라이트 → `Esc`로 종료.
- **동작 상세**:
  - 공식 명시: "Use `cmd/ctrl` + `F` to search inside a page".
  - 브라우저 기본 찾기를 **가로채서** 자체 구현해야 한다. 이유: (a) 접힌 toggle 블록 내부, (b) 가상 스크롤로 DOM에 없는 블록, (c) 데이터베이스 뷰의 미로드 행 — 브라우저 기본 찾기는 이들을 못 찾는다.
  - 매칭 시 접힌 toggle을 자동 펼치는지는 `[확인필요]`.
  - 워크스페이스 검색(F-07-01)과 달리 여기서는 인덱스가 아니라 **클라이언트 문서 모델**이 대상이므로, 방금 타이핑한 미저장 텍스트도 검색된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 접힌 toggle 안에 매칭 | 자동 펼침 후 스크롤. 검색 종료 시 원상복구 여부는 정책 결정 필요 |
  | 가상 스크롤로 미렌더 블록 | DOM이 아닌 **문서 모델(block tree)** 을 대상으로 검색해야 함 |
  | synced block / linked view | 원본 콘텐츠 기준으로 검색되어야 함 |
  | 검색 중 다른 사용자가 편집 | 매칭 인덱스가 흔들림 → 매칭을 전역 offset이 아니라 `(block_id, 텍스트 offset)`로 앵커링 |
  | 코드 블록 내부 | 포함(대소문자 구분 옵션 제공 여지) |
  | 매우 긴 페이지(수천 블록) | 메인 스레드 블로킹 → 청크 단위 순회 또는 Web Worker |
  | 매칭 0건 | 카운터를 0/0으로 표시하고 인풋 테두리 강조 |
- **데이터 모델 함의**: 서버 기능 아님. 클라이언트 문서 모델(`block[]`)을 순회하며 `{block_id, start, end}` 매칭 배열 생성. 하이라이트는 별도 decoration 레이어(ProseMirror/Lexical의 decoration)로 렌더 — DOM에 직접 `<mark>`을 넣으면 편집 모델이 오염되고 undo 스택이 깨진다.
- **UI/인터랙션**: `cmd/ctrl + F` 열기 / `Enter` 다음 / `shift + Enter` 이전 / `Esc` 닫기 / "n/N" 카운터 / 대소문자 구분 토글 `[확인필요]`.
- **의존 기능**: 에디터 문서 모델(F-01/F-02 도메인), decoration API.
- **구현 난이도**: **M** — 순회 자체는 쉽지만 decoration 기반 하이라이트와 접힌 블록 처리에서 시간이 든다.
- **우선순위**: **P1** — 없어도 브라우저 기본 찾기가 부분적으로 동작해 치명적이지 않다. 단 **가상 스크롤을 도입하는 순간 P0로 승격**된다.
- **클론 시 현실적 대안**: MVP에서는 가상 스크롤을 쓰지 않고 브라우저 기본 `cmd+F`에 위임. 접힌 toggle은 "검색 모드에서는 모두 펼침"으로 우회.
- **참고 출처**: https://www.notion.com/help/keyboard-shortcuts

---

### F-07-06 검색 인덱싱 파이프라인 (block → search document)

- **한 줄 정의**: 블록의 생성/수정/삭제/이동/권한 변경을 검색 인덱스에 반영해, 검색 가능한 상태를 유지한다.
- **사용자 시나리오**: 사용자가 페이지에 문장을 추가하고 몇 초 뒤 다른 사용자가 그 문장을 검색해 찾는다. 사용자 관점 조작은 없지만 이 기능이 없으면 이 도메인 전체가 존재하지 않는다.
- **동작 상세** (Notion 실제 구조):
  - 검색 엔진: **Elasticsearch**. 인덱스 문서 단위 = **block** ("Search at Notion has to keep up with every block users create, edit, or delete").
  - 두 개의 경로:
    - **온라인 경로**: 라이브 쓰기가 실시간 인덱싱 파이프라인을 통해 ES를 갱신. 애플리케이션 레벨 index 할당 + ES 샤드 ID 해싱으로 라우팅.
    - **오프라인 경로(전체 재색인)**: 데이터 레이크(모든 block의 미러, 실시간 대비 수 시간 지연, Apache Avro)를 읽어 → Spark prep 잡 → Scala 문서 생성 잡 → shard partitioner가 (index, shard) 쌍으로 분배 → snapshot writer가 ES 네이티브 스냅샷을 S3에 씀.
  - **권한은 인덱싱 시점에 해소되어 문서에 박힌다**: 문서 생성 로직이 "resolves per-document permissions"를 수행하고, 이를 각 레코드에 인코딩해 **검색 시 런타임 권한 체크를 없앤다**.
  - 언어 감지 결과를 문서에 넣어 **per-language analyzer**를 적용.
  - 라우팅 키는 **spaceId**. Spark 파티션 1개 = ES (index, shard) 1개로 대응시킨다.
  - 성능 수치: 직접 쓰기 방식은 약 **200K docs/sec**에서 정체 → 스냅샷 방식으로 전환. 재색인 **2주+ → 2일 미만**, 일관성 **~90% → 100%**, catchup **~2일 → 1시간 미만**, 수동 개입 0.
  - catchup 전략: 새 클러스터를 미리 띄우고 `tmp-*` 임시 인덱스에 프로덕션 쓰기를 흘려보낸 뒤, 스냅샷 복원이 끝나면 `_reindex`로 `tmp-*` → `snap-*` 병합. `version_type: external`, `conflicts: proceed`로 충돌 처리.
  - 검증: Spark 기반 aggregate validator(문서 수/타입 분포) + field-level validator(층화 표본 필드 비교) 2종을 자동 실행.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 블록 삭제 | tombstone 또는 즉시 delete. 인덱스에서 사라져야 함(유령 결과 금지) |
  | 페이지 이동(부모 변경) | 하위 **전체 서브트리**의 `ancestor_ids`/권한이 바뀜 → 대량 재색인 fan-out. 이 도메인 최대 난제 |
  | 권한 변경(공유 해제) | 텍스트는 그대로인데 `principals`만 갱신 → 본문 재색인 없이 메타만 partial update 하는 경로가 필요 |
  | 순서 뒤바뀐 이벤트 | 외부 버전 비교로 오래된 갱신 무시(`version_type: external`) |
  | 인덱싱 실패 | DLQ + 재시도. 실패가 조용히 누적되면 검색 품질이 서서히 썩고 원인 추적이 불가능해진다 |
  | 인덱스 스키마 변경 | 무중단 재색인(별칭 스위칭) 필요 |
  | 초대형 페이지 | 블록 수천 개 → 문서 수천 건. bulk API로 배치 |
  | 인덱스와 원본 불일치 | 정기 검증 잡(문서 수 + 필드 표본 비교)이 없으면 발견 자체가 불가 |
- **데이터 모델 함의**:
  - 변경 이벤트 소스: OLTP DB의 CDC(Debezium 등) → Kafka → consumer → 인덱스 upsert. Notion의 vector 파이프라인이 "Kafka consumers that process individual page edits"를 쓴다고 명시하므로 lexical 쪽도 유사 구조 `[추정]`.
  - 권한 fan-out을 줄이려면 `principals`를 블록마다 복사하는 대신 **"권한 스코프 id"**(가장 가까운 권한 경계 페이지의 id)만 저장하고, 쿼리 시 사용자의 접근 가능 스코프 집합과 terms 필터로 교차시키는 방법이 유효하다 `[추정]`. 이러면 공유 해제 시 갱신 대상이 스코프 매핑 1건으로 줄어든다.
  - `search_document.version`은 OLTP `block.version`과 동일 값을 사용해야 순서 문제가 해결된다.
- **UI/인터랙션**: 없음(백엔드). 단 인덱싱 지연을 UI가 흡수해야 한다 — 공식 API 문서가 "Refresh 버튼을 UI에 두라"고 권고할 정도로 지연은 상수다.
- **의존 기능**: 블록 저장 계층, 권한 모델.
- **구현 난이도**: **XL (2주+)** — 실시간 경로 + 전체 재색인 + 권한 fan-out + 순서 보장 + 실패 복구 + 검증. 이 도메인에서 가장 무겁고, 여기 들어가는 시간이 나머지 전부의 합보다 크다.
- **우선순위**: **P0** (최소한의 인덱싱) — 단, 아래 대안으로 규모를 극단적으로 줄일 수 있다.
- **클론 시 현실적 대안**:
  1. **v0**: 별도 인덱스를 만들지 않는다. Postgres 원본 테이블에 `search_vector tsvector GENERATED ALWAYS AS (...) STORED` 컬럼 + GIN 인덱스. 트랜잭션 안에서 자동 갱신되므로 파이프라인·지연·정합성 문제가 **전부 사라진다**. 수십만 페이지 규모까지 충분.
  2. **v1**: 권한은 인덱스에 박지 말고 쿼리 시 `WHERE permission_scope_id = ANY($scopes)`. Postgres라면 감당된다.
  3. **v2**: 규모가 넘치면 그때 OpenSearch/Typesense/Meilisearch로 이관하고, 이 시점에 비로소 CDC 파이프라인을 만든다.
  - 페이지 이동 시 서브트리 갱신은 **materialized path**(`path text`, 예 `/root/a/b/`)를 쓰면 `UPDATE ... WHERE path LIKE '/root/a/%'` 한 방으로 처리 가능. 이 하나로 XL의 절반이 사라진다.
- **참고 출처**: https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer , https://www.zenml.io/llmops-database/rebuilding-a-production-search-reindexing-pipeline-at-scale , https://developers.notion.com/reference/search-optimizations-and-limitations

---

### F-07-07 권한 인지 검색 (Permission-aware retrieval)

- **한 줄 정의**: 모든 검색 경로(전문/자동완성/백링크/AI/API)가 요청자의 접근 권한 범위 안의 결과만 반환한다.
- **사용자 시나리오**: 게스트가 `cmd+K`로 "연봉"을 검색 → 접근 권한이 없는 HR 페이지는 결과에도, 결과 건수에도, 제목 미리보기에도 나타나지 않는다.
- **동작 상세**:
  - Notion은 권한을 인덱싱 시점에 문서에 비정규화한다(F-07-06). 목표는 **런타임 권한 조회를 검색 경로에서 제거**하는 것.
  - AI 벡터 검색도 동일: 각 span의 메타데이터에 권한을 저장하고 쿼리 시 필터링한다("Vectors store metadata including permissions and authors ... filtered at query time").
  - 서드파티 커넥터도 동일 원칙: Google Drive는 "Notion AI can only surface a file to someone who already has access to it in Google Drive", Slack은 "You'll only see content from messages and channels you can already open in Slack".
  - 백링크에도 적용: "You only see backlinks for pages you can access". 접근 불가한 비공개 페이지의 백링크는 **`Private`으로 라벨링**된다 — 존재는 알려주되 내용은 감추는 절충.
  - 공개 API도 동일: 결과는 "connection's capabilities" 범위로 제한되며, 커넥션에 직접 공유된 페이지는 인덱싱 지연 없이 결과에 나타나는 것이 보장된다.
  - **관리자 예외**: Enterprise의 Admin content search만 이 규칙을 우회한다(F-07-15).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 검색 직후 권한 회수 | 인덱스 갱신 지연 동안 노출 위험 → 결과 **클릭 시 서버가 권한 재검증**(2차 방어선) 필수 |
  | 권한 상속 vs 명시적 override | 하위 페이지 권한 재정의를 인덱스가 반영해야 함 |
  | 그룹 멤버십 변경 | 사용자 → principal 집합 캐시를 즉시 무효화 |
  | public 공유 페이지 | 비로그인 경로에서는 `is_public=true` 문서만 |
  | 검색 결과 건수 노출 | 필터 적용 **후** 집계. 전체 건수를 먼저 보여주면 정보 누출 |
  | 스니펫 하이라이트 | 권한 없는 블록 텍스트가 스니펫에 섞이지 않도록 블록 단위 확인 |
  | 페이지네이션 | 권한 필터가 post-filter면 "10건 요청 → 3건 반환"이 되어 페이징이 깨진다 |
- **데이터 모델 함의**:
  - 방식 A(Notion식): `search_document.principals uuid[]` + `terms` 필터. 읽기 빠름 / 쓰기 fan-out 큼.
  - 방식 B(클론 권장): `page.permission_scope_id`(가장 가까운 권한 경계) + `user_accessible_scopes(user_id) → uuid[]` 캐시. `WHERE permission_scope_id = ANY($scopes)`. 쓰기 fan-out 없음 / 스코프 배열이 수천 개가 되면 느려짐.
  - 어느 쪽이든 **권한은 검색 쿼리의 필터 절이지 후처리가 아니어야 한다.**
- **UI/인터랙션**: 권한 없는 항목은 완전 비노출. 백링크만 예외적으로 `Private` 플레이스홀더.
- **의존 기능**: 권한/공유 도메인, F-07-06.
- **구현 난이도**: **L → XL 로 상향(재평가)** — 이전 판의 L은 과소평가였다. 근거 4가지:
  1. **경로 수가 곱셈으로 늘어난다.** 누출 지점이 자동완성 / 백링크 / AI span / 공개 API / MCP / 최근 방문 / breadcrumb / 검색 결과 건수 / 스니펫 / 커넥터 6개 이상으로, 각각이 독립 코드경로다. 하나라도 빠지면 기능 결함이 아니라 **보안 사고**다.
  2. **페이지네이션과 결합하면 난이도가 급상승한다.** 권한이 post-filter면 `LIMIT 25`가 실제 3건을 반환하고, 이를 고치려면 필터를 인덱스 쿼리 안으로 밀어넣어야 하는데 그 순간 인덱싱 파이프라인(F-07-06)까지 같이 설계해야 한다. 즉 **F-07-06과 분리 발주가 불가능**하다.
  3. **무효화(invalidation)가 분산 캐시 문제다.** 그룹 멤버십 1건 변경 → 영향 사용자 전원의 `accessible_scopes` 캐시 무효화 → 진행 중인 검색 세션까지. 이건 검색 기능이 아니라 캐시 일관성 문제이고, 일반적으로 검색 UI 전체보다 오래 걸린다.
  4. **커넥터 도입 시 권한이 외부 시스템으로 넘어간다.** Notion은 "up to one hour"의 잔존 노출 창을 공식 인정한다(F-07-13). 즉 원본조차 이 문제를 완전히 풀지 못했다.
  - 단, **클론이 커넥터를 만들지 않고 방식 B(permission_scope_id)를 택하면 L로 내려온다.** 아래 대안 참조.
- **우선순위**: **P0** — 보안 결함이며 사후 수습이 불가능한 종류의 버그다.
- **클론 시 현실적 대안**: 위 방식 B. 그리고 **모든 검색 함수가 `viewer_id`를 필수 인자로 받도록 타입 시그니처를 강제**해서, 권한 인자를 빼먹은 코드가 컴파일되지 않게 만든다.
- **참고 출처**: https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer , https://www.notion.com/blog/two-years-of-vector-search-at-notion , https://www.notion.com/help/create-links-and-backlinks , https://www.notion.com/help/notion-ai-connectors , https://developers.notion.com/reference/post-search

---

### F-07-08 인라인 링크 자동완성 (`@`, `[[`, `+` 트리거)

- **한 줄 정의**: 텍스트 입력 중 트리거 문자를 치면 인라인 팝업이 열려 페이지·사람·날짜를 검색해 참조로 삽입한다.
- **사용자 시나리오**:
  1. 문장 중간에 `@` 입력 → 커서 아래 팝업 등장, 최근 항목이 기본 노출.
  2. "온보"까지 입력 → 후보가 실시간 필터링(페이지/사람/날짜가 섹션으로 구분).
  3. `↓`로 선택 후 `Enter` → 트리거 문자와 입력한 검색어가 **모두 삭제되고** 그 자리에 mention 노드(아이콘+제목)가 삽입된다.
  4. 후보가 없으면 "새 하위 페이지 만들기"가 노출되고, 선택 시 그 제목으로 페이지가 즉시 생성되며 링크가 삽입된다.
- **동작 상세** (공식 명시):
  | 트리거 | 동작 | 결과물 |
  |---|---|---|
  | `@` | 사람, 페이지, 날짜, 리마인더 멘션 | 페이지 멘션은 **하이퍼링크에 가깝다**. 멘션된 페이지는 사이드바에 하위 페이지로 나타나지 **않는다** |
  | `[[` | 기존 페이지 링크 또는 새 하위 페이지/다른 위치 페이지 생성 | 메뉴에 `New {Name} sub-page` 옵션이 노출됨 |
  | `+` | 페이지 **생성** 옵션을 드롭다운 상단에 우선 배치 | 나머지는 `[[`와 동일 |
  | `/link` 또는 hover `+` → `Link to page` | **블록**으로 삽입 | "kind of like creating a sub-page" — 사이드바에 하위 페이지로 표시됨 |
  - 즉 `@`/`[[`/`+`는 **동일한 자동완성 엔진에 서로 다른 랭킹 프리셋을 건 것**이다. `@`는 사람 우선, `[[`는 기존 페이지 우선, `+`는 신규 생성 우선.
  - 검색 대상은 **페이지 제목**이며 본문은 아니다 `[추정]` — 자동완성은 즉응성이 요구되므로 제목 prefix/부분 일치가 지배적.
  - 중요한 비대칭: 워크스페이스 검색은 "@mentions of pages and people"을 **찾지 못한다**(헬프센터 명시). 즉 mention은 링크 그래프에는 기여하지만 전문 검색 텍스트에는 기여하지 않는다. 인덱싱 시 mention 노드를 표시 텍스트로 flatten하면 안 된다는 뜻이다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | `@` 뒤에 공백 | 팝업 닫힘. 이메일 주소 입력을 방해하면 안 됨 |
  | 코드 블록 안 `@` / `[[` | 트리거 비활성 |
  | 이미 `[` 하나가 있는 상태에서 `[` 추가 | 두 번째 `[` 입력 시점에 트리거 발화 |
  | 후보 0건 | "새 페이지 만들기"만 남김. 팝업을 닫아버리면 안 됨 |
  | 트리거 후 `Esc` | 팝업만 닫고 입력한 리터럴 텍스트(`@온보`)는 보존 |
  | 멘션한 페이지가 나중에 삭제됨 | 멘션 노드는 남되 "삭제된 페이지"로 렌더. 클릭 시 안내 |
  | 멘션한 페이지 제목 변경 | 멘션 노드가 **현재 제목**을 표시해야 함 → 제목을 복사 저장하지 말고 `page_id` 참조 후 조인 |
  | 권한 없는 페이지 | 자동완성 후보에서 제외 (대표적 권한 누출 지점) |
  | 동시편집 중 삽입 | mention은 원자적 inline node여야 CRDT/OT 병합이 깨지지 않음 |
  | 대용량 워크스페이스 | 후보 조회는 반드시 상한(예: 20건) + debounce(~150ms) |
  | 붙여넣기로 `[[` 유입 | 트리거 발화 금지(키 입력에만 반응) |
  | 한글 IME 조합 중 | 조합 중 문자열로 질의하면 후보가 요동침 → composition 이벤트 처리 필수 |
- **데이터 모델 함의**:
  - 인라인 노드 표현: `{type:'mention', mention_type:'page'|'user'|'date'|'reminder', target_id: uuid}`. **표시 텍스트를 저장하지 않는 것**이 핵심 — 저장하면 이름 변경 시 전부 stale이 된다.
  - 삽입과 동시에 `link_edge`에 `(source_block_id, source_page_id, target_page_id, link_type='mention')` upsert → F-07-09 백링크의 원천.
  - 자동완성 전용 경량 엔드포인트: `GET /autocomplete?q&types=page,user&limit=20` → 제목 인덱스만 조회. 전문 검색과 같은 엔드포인트를 쓰면 지연이 사용자에게 그대로 보인다.
  - 필요한 인덱스: `page(space_id, lower(title) text_pattern_ops)`(prefix) 또는 `pg_trgm` GIN(부분 일치).
- **UI/인터랙션**: 커서 좌표 기준 팝업 배치(뷰포트 하단에서는 위로 뒤집기), `↑↓` 이동, `Enter`/`Tab` 확정, `Esc` 취소, 섹션 헤더(Pages/People/Dates), 최근 항목 기본 노출.
- **의존 기능**: 에디터 inline node 모델, 페이지 제목 인덱스, F-07-07(권한), F-07-09(백링크 기록).
- **구현 난이도**: **L** — 트리거 감지·팝업 위치·IME 처리가 까다롭다. **한글 IME에서 `compositionstart`/`compositionend`를 처리하지 않으면 자동완성이 무너진다.** 이 항목이 한국어 클론에서 가장 흔히 망가지는 지점이다.
- **우선순위**: **P0** — `@` 페이지 멘션은 Notion의 정보 구조를 만드는 핵심 조작이다. `[[`/`+`는 P2(같은 엔진의 프리셋일 뿐).
- **클론 시 현실적 대안**: `@` 하나만 만들고 섹션으로 페이지/사람을 나눈다. `[[`와 `+`는 `@`와 동일 팝업을 다른 정렬로 여는 얇은 래퍼로 나중에 추가. 날짜/리마인더는 v2.
- **참고 출처**: https://www.notion.com/help/create-links-and-backlinks , https://www.notion.com/help/keyboard-shortcuts , https://www.notion.com/help/search

---

### F-07-09 백링크 (Backlinks) 및 링크 그래프

- **한 줄 정의**: 현재 페이지를 참조하는 모든 페이지 목록을 페이지 상단에 자동 노출한다.
- **사용자 시나리오**: 페이지를 열면 제목 아래에 `3 backlinks`가 접힌 상태로 보임 → 클릭하면 이 페이지를 멘션한 3개 페이지가 나열됨 → 클릭해 이동.
- **동작 상세**:
  - 공식: "Backlinks display automatically above the page title when present", "all the pages that link to the page you're currently on", 표시 형태는 `{#} backlinks`.
  - 데이터베이스 property로도 백링크가 노출될 수 있다.
  - 권한 규칙(F-07-07): 접근 가능한 페이지의 백링크만 보이며, 비공개 페이지의 백링크는 `Private`으로 라벨링된다.
  - **표시 트리거(공식 verbatim)**: "Backlinks automatically appear above the page title and **show on hover** whenever a page has them." 즉 상시 노출이 아니라 **hover 시 노출**이 기본이며, 조회는 "select `{#} backlinks` under its title, **or its properties if it's a database page**"로 시작한다.
  - ❗ **정정**: 이전 판이 적은 "페이지 `⋯` 메뉴의 백링크 표시/숨김 옵션"은 **헬프센터 본문에 존재하지 않는다**(재확인 결과 show/hide 토글·표시 모드 선택에 대한 기술이 전혀 없음). 존재한다고 단정하지 말 것. 클론에서는 오히려 **표시 정책을 직접 정해야 하는 미정의 영역**으로 취급하는 편이 안전하다 `[확인필요]`.
  - 블록 단위 앵커도 존재: hover → `⋮⋮` → `Copy link to block`으로 블록 단위 URL 생성.
  - 외부 URL은 `Paste as mention`으로 리치 링크 프리뷰가 된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 한 페이지에서 같은 대상을 5번 멘션 | 백링크 목록에는 1건으로 집계(source_page_id 기준 dedup) |
  | 멘션한 페이지가 삭제됨 | `link_edge` 정리 또는 조회 시 필터. 카운트가 실제 목록보다 크면 안 됨 |
  | 순환 참조(A↔B, A→B→C→A) | **mention 그래프에서는 정상**이므로 별도 처리 불필요. 단 `link_type='child'`(= `Link to page` 블록, 사이드바에 하위 페이지로 나타나는 종류)까지 같은 테이블에 담으면 **트리 불변식이 깨진다** — 이때 순환은 breadcrumb 무한 루프, `ancestor_ids` 무한 확장, `shift+U` 무한 상승을 동시에 일으킨다. 대응: (a) `child` edge 삽입 시 "target이 source의 조상인가"를 검사해 거부, (b) 조상 경로 계산에 **깊이 상한(예: 50)과 방문 집합**을 무조건 건다. 안전장치 없이 재귀 CTE를 돌리면 순환 1건이 DB를 잠근다 |
  | 자기 자신을 멘션 | edge 저장은 하되 백링크 목록에서는 `source_page_id = target_page_id` 제외 |
  | 대상 페이지에 백링크 수천 건 | 페이지네이션 필수. 카운트는 근사치 허용 `[추정]` |
  | 페이지 복제(duplicate) | 복제본의 mention도 링크로 잡혀 백링크가 2배가 됨 — 사양상 정상이나 사용자에게는 혼란 |
  | 권한 없는 소스 페이지 | `Private`으로 표시하되 제목은 감춤 |
  | 블록 앵커 링크 | 대상 페이지의 백링크로 집계되는지 `[확인필요]` |
  | 블록을 통째로 삭제 | 그 블록에서 나가던 edge 전부 제거 |
- **데이터 모델 함의**:
  ```sql
  link_edge (source_block_id, source_page_id, target_page_id, link_type, created_at)
  index (target_page_id, source_page_id)          -- 백링크 조회
  index (source_block_id)                          -- 블록 편집 시 edge 재계산
  ```
  - 갱신 시점: 블록 저장 시 해당 블록의 mention 노드를 파싱해 `source_block_id` 기준 edge를 **전량 delete 후 insert**하는 것이 가장 단순하고 정확하다.
  - 카운트는 조회 시 `COUNT(DISTINCT source_page_id)`. 대규모라면 `page.backlink_count` 비정규화 + 트리거.
- **UI/인터랙션**: 제목 아래 접힌 칩(`3 backlinks`) → 클릭 시 확장, 각 항목에 소스 페이지 아이콘/제목/breadcrumb.
- **의존 기능**: F-07-08(멘션 삽입 시 edge 기록), 권한.
- **구현 난이도**: **M** — edge 테이블 + 저장 훅 + UI. 정확한 dedup과 삭제 정리가 시간을 잡아먹는다.
- **우선순위**: **P1** — 없어도 제품은 동작하지만 위키형 사용에서 정보 발견 경로의 핵심이다.
- **클론 시 현실적 대안**: 원본 그대로 구현 가능. 초기에는 카운트 비정규화 없이 실시간 COUNT로 충분.
- **참고 출처**: https://www.notion.com/help/create-links-and-backlinks

---

### F-07-10 슬래시 커맨드 메뉴 (`/`)

- **한 줄 정의**: 빈 블록이나 텍스트 중간에 `/`를 입력해 블록 타입 삽입/변환 명령을 검색·실행한다.
- **사용자 시나리오**: 빈 줄에서 `/` → 명령 목록 팝업 → "todo" 입력 → `To-do list` 항목 선택 → `Enter` → 현재 블록이 체크박스 블록으로 **변환**되고 `/todo` 텍스트는 사라진다.
- **동작 상세**:
  - 공식: "hit the slash key and select or type the content type (e.g., /image)".
  - 계열별 명령: 삽입/변환(`/turnbullet` 같은 "slash turn"), 스타일(`/red` 같은 "slash color"), 콘텐츠(`/quote`, `/callout`, `/web`).
  - `cmd/ctrl + /`는 **선택된 블록(복수 가능)** 에 대해 타입 변경/색상/편집/복제/이동을 여는 별도 메뉴다. 즉 `/`는 "입력 중", `cmd+/`는 "선택 중" 경로다.
  - `/` 입력 후 `Tab`을 누르면 전체 명령 목록을 볼 수 있다 `[확인필요]`.
  - **핵심 변환 규칙**: 블록 타입을 바꿔도 텍스트 content는 보존되고 `type`만 교체된다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 문장 중간의 `/` (예: `and/or`) | 앞 문자가 공백이 아니면 트리거하지 않거나, 매칭 0건이면 즉시 닫음 |
  | 코드 블록 안 `/` | 비활성 |
  | 매칭 0건 | 팝업을 닫고 `/` 리터럴을 남김 |
  | `Esc` | 팝업만 닫고 `/query` 텍스트 보존 |
  | 변환 불가 조합(이미지 블록 → 제목) | 해당 명령을 목록에서 숨기거나 비활성 |
  | 자식 블록이 있는 블록의 타입 변환 | 자식 유지 규칙 정의 필요(toggle → paragraph 시 자식 처리) `[확인필요]` |
  | 다중 블록 선택 상태 | `cmd+/` 경로로 일괄 변환 |
  | 한글 IME | `/` 다음 한글 조합 중 필터링이 튀지 않도록 composition 처리 |
  | 변환 후 undo | 원래 타입과 content가 함께 복원되어야 함(한 트랜잭션) |
- **데이터 모델 함의**:
  - 명령 레지스트리: `{id, label, aliases[], keywords[], group, icon, when(block)->bool, run(editor, block)}`. 검색은 클라이언트 로컬(수십~수백 건이므로 서버 불필요).
  - 사용 빈도 기반 정렬을 위해 `user_command_usage(user_id, command_id, count, last_used_at)` (선택) `[추정]`.
  - 블록 변환은 `UPDATE block SET type=$1 WHERE id=$2` + content 스키마 변환 함수 `convert(from_type, to_type, content)`. 이 변환 매트릭스를 명시적으로 정의해두지 않으면 타입 조합이 늘어날 때마다 버그가 생긴다.
- **UI/인터랙션**: 커서 기준 팝업, 그룹 헤더(Basic blocks / Media / Database / Advanced), `↑↓` `Enter` `Esc`, 아이콘 + 설명 텍스트.
- **의존 기능**: 에디터 블록 모델, 블록 타입 정의(F-01/F-02 도메인).
- **구현 난이도**: **M** — 팝업 인프라는 F-07-08과 공유하므로, 명령 레지스트리와 변환 함수 테이블이 주 작업.
- **우선순위**: **P0** — Notion식 편집의 진입점. 이게 없으면 블록 타입을 바꿀 방법이 없다.
- **클론 시 현실적 대안**: `@` 자동완성과 **동일한 팝업 컴포넌트**를 트리거 문자만 바꿔 재사용. 명령은 MVP에서 10~15개(제목1~3, 불릿, 번호, 할일, 토글, 인용, 코드, 구분선, 이미지, 표)로 제한.
- **참고 출처**: https://www.notion.com/help/guides/using-slash-commands , https://www.notion.com/help/keyboard-shortcuts

---

### F-07-11 커맨드 팔레트 / 액션 실행 (Command Search)

- **한 줄 정의**: 검색 패널에서 페이지 이동뿐 아니라 "링크 복사", "새 페이지" 같은 **동작**을 검색해 실행한다.
- **사용자 시나리오**: 커맨드 서치 열기 → "copy" 입력 → `Copy link` 노출 → `Enter` → 현재 페이지 URL이 클립보드에 복사된다.
- **동작 상세** (재조사로 정정·보강):
  - ❗ **출처 정정**: 이전 판은 Command Search의 근거를 `help/keyboard-shortcuts`로 달았으나, 재확인 결과 **그 문서에는 "Command Search"라는 명칭 자체가 없다.** 실제 1차 출처는 `help/notion-for-desktop`과 `help/search`다.
  - **Command Search의 정체는 "액션 팔레트"가 아니라 OS 레벨 전역 런처다(공식 verbatim)**: "On desktop, you can use search and Notion AI **even when you're outside of the Notion app**. Trigger Command Search with a **customizable keyboard shortcut**, your **menu bar on Mac**, or your **task bar on Windows** ... without switching between windows or bringing the Notion desktop app to the foreground."
    → 즉 이 기능의 본질은 (a) **앱 밖에서 동작하는 전역 단축키**, (b) **메뉴바/트레이 상주**, (c) 그 안에서 검색 + **Notion AI 질의**까지 수행. 브라우저 안의 `cmd+K` 오버레이(F-07-01)와는 **실행 컨텍스트가 다른 별개 표면**이다.
  - **기본값**: 활성(on by default). 데스크톱 앱은 기본적으로 "set to open at login" 상태로 설치된다 — 전역 런처가 성립하려면 상주가 전제이기 때문.
  - **끄기/커스터마이즈 경로(공식)**: `Settings` → `Preferences` → `Use Command Search` 토글 off. 같은 화면에서 `Show Notion in Menu Bar` 토글과 **Command Search 단축키 변경**이 제공된다.
  - Command Search 안에서 `cmd + L` 또는 `cmd + shift + C`로 링크 복사가 가능하다고 명시(액션 실행 성격은 여기서 확인된다).
  - 즉 Notion에는 (a) 앱 내 콘텐츠 검색 오버레이와 (b) 앱 밖 전역 런처가 **분리**되어 있다. 다만 (b)의 내용물이 (a)와 같은 검색 UI인지, 별도 축약 UI인지는 `[확인필요]`.
  - `[추정]` 구현 형태: Electron `globalShortcut.register` + `Tray`/메뉴바 아이템 + 항상 살아 있는 별도 경량 BrowserWindow(포커스 잃으면 hide). 메인 워크스페이스 창과 **세션·인증 토큰을 공유**해야 하며, 창이 없을 때도 검색이 되어야 하므로 인증 상태가 메인 창 수명과 분리돼 있어야 한다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 컨텍스트에 맞지 않는 액션 | 목록에서 숨김(페이지가 열려 있지 않으면 "링크 복사" 비활성) |
  | 권한 없는 액션 | 숨김(읽기 전용 사용자에게 "삭제" 노출 금지) |
  | 실행 중 오류 | 토스트로 실패 알림, 팔레트는 닫힘 |
  | 액션과 페이지 제목이 동시 매칭 | 섹션 분리(Actions / Pages) + 액션 우선 `[추정]` |
  | 되돌릴 수 없는 액션(삭제) | 확인 단계 또는 undo 토스트 |
  | 웹 환경 | 데스크톱 전용 기능은 대체 경로 제공 |
  | 클립보드 권한 거부 | 실패를 조용히 넘기지 말고 안내 |
  | **전역 단축키가 다른 앱과 충돌** | OS 전역 등록은 선착순이라 **조용히 실패한다**. 등록 실패를 감지해 설정 화면에 경고 + 다른 조합 제안. Figma 포럼에 Notion 전역 단축키가 타 앱 단축키를 가로챈다는 사용자 보고가 있다 `[확인필요]`(2차) — 반대 방향 충돌도 발생한다는 뜻 |
  | **앱이 실행 중이 아님** | 전역 런처는 상주 프로세스 전제. 미실행 시 단축키는 무반응 → "로그인 시 자동 실행"이 사실상 필수 요건이 되는 이유 |
  | 로그아웃 상태에서 전역 호출 | 검색 UI 대신 로그인 프롬프트. **캐시된 최근 방문 목록을 로그아웃 상태로 노출하면 안 된다**(같은 PC 다른 사용자) |
  | 다중 워크스페이스 로그인 | 전역 런처에는 "현재 열린 페이지" 컨텍스트가 없다 → 대상 워크스페이스를 명시 선택하거나 마지막 활성 워크스페이스로 고정 |
  | 오프라인에서 전역 호출 | 로컬 캐시(최근 방문)만 반환, AI 질의는 비활성 `[추정]` |
  | 전역 창 포커스 상실 | 즉시 hide + 입력 상태 초기화. 남겨두면 다른 앱 위에 유령 창이 뜬다 |
- **데이터 모델 함의**:
  - `command_registry`: 슬래시 명령과 **같은 인터페이스**를 공유하되 scope가 다르다 — `{id, label, keywords[], scope:'block'|'page'|'app', shortcut?, when(ctx)->bool, run(ctx)}`.
  - 사용자별 단축키 커스터마이즈 지원 시 `user_keybinding(user_id, command_id, keys)`.
  - 검색은 클라이언트 로컬 fuzzy 매칭(fzf 스타일). 서버 왕복 없음.
  - 전역 런처(데스크톱)용 로컬 설정 — 서버가 아니라 **디바이스 로컬**에 저장해야 한다(같은 계정도 PC마다 단축키가 달라야 하므로):
    ```
    device_pref (device_id, use_command_search bool, command_search_shortcut text,
                 show_in_menu_bar bool, open_at_login bool, last_active_space_id uuid)
    ```
  - 전역 런처는 메인 창과 **인증 세션을 공유**하되 수명은 분리해야 한다 → 토큰을 렌더러 메모리가 아니라 OS 키체인/메인 프로세스에 보관.
- **UI/인터랙션**: 별도 단축키(커스터마이즈 가능), 메뉴바(Mac)/작업표시줄(Win) 아이콘, 섹션 구분, 각 항목에 해당 단축키 표시(학습 유도), 포커스 상실 시 자동 닫힘.
- **의존 기능**: F-07-01(오버레이 인프라), F-07-10(레지스트리 패턴), 데스크톱 셸(Electron 등), F-07-13(전역 런처에서 AI 질의를 지원하려면).
- **구현 난이도**: **앱 내 액션 팔레트 M / 전역 Command Search 포함 시 L (상향)** — 재평가 근거: 전역 단축키 등록·충돌 처리, 상주 프로세스와 트레이, 포커스 없는 상태의 별도 창 수명 관리, 메인 창과 분리된 인증 세션, 로그아웃/다중 워크스페이스 컨텍스트 부재까지 더해지면 "레지스트리 + 팝업"의 M을 넘어선다. **웹 전용 클론이라면 M 그대로.**
- **우선순위**: **P2** — 파워 유저 기능. MVP에서는 슬래시 명령과 컨텍스트 메뉴로 커버된다. 전역 런처는 데스크톱 앱이 생긴 뒤의 **P2 이하**.
- **클론 시 현실적 대안**: 별도 팔레트를 만들지 말고, F-07-01 검색 오버레이 결과 상단에 "Actions" 섹션을 얹는 방식으로 통합. 액션 5~8개(새 페이지, 링크 복사, 즐겨찾기, 테마 전환, 사이드바 토글)면 충분. 전역 런처는 데스크톱 셸 도입 이후로 미루고, 도입 시에도 **검색 결과 이동만** 지원하고 액션 실행은 앱 안으로 넘긴다.
- **참고 출처**: https://www.notion.com/help/notion-for-desktop , https://www.notion.com/help/search , https://www.notion.com/help/keyboard-shortcuts

---

### F-07-12 페이지 간 이동 · 히스토리 · 탭

- **한 줄 정의**: 키보드만으로 페이지 히스토리를 오가고, 계층을 거슬러 올라가고, 새 탭/창으로 페이지를 연다.
- **사용자 시나리오**: 페이지 A → 멘션 클릭 → 페이지 B → `cmd + [` → A로 복귀(스크롤 위치 포함) → `cmd + ]` → B로 재이동 → `cmd + shift + U` → B의 부모 페이지로 이동.
- **동작 상세** (모두 공식 명시):
  | 단축키 | 동작 |
  |---|---|
  | `cmd/ctrl + [` | 뒤로 |
  | `cmd/ctrl + ]` | 앞으로 |
  | `cmd/ctrl + shift + U` | 계층 한 단계 위(부모 페이지)로 이동 |
  | `cmd/ctrl + L` | 현재 페이지 URL 복사 |
  | `cmd/ctrl + click` (링크) | **새 Notion 탭**으로 열기 |
  | `cmd/ctrl + T` | **새 Notion 탭 생성**(빈 탭). 이전 판 누락분 |
  | `option + shift + click` | 새 **창**으로 열기 |
  | `cmd/ctrl + \` | **사이드바 열기/닫기**. 단 이 단축키는 키보드 단축키 문서가 아니라 **사이드바 헬프 문서**에만 기재돼 있다(키보드 단축키 페이지에서는 확인되지 않음) — F-07-16 참조 |
  | `ctrl + shift + K` (Mac) / `ctrl + K` (Win) | 데이터베이스 peek view에서 **이전** 레코드 |
  | `ctrl + shift + J` (Mac) / `ctrl + J` (Win) | 데이터베이스 peek view에서 **다음** 레코드 |
  - "부모로 이동"(`shift+U`)은 브라우저 히스토리와 **다른 축**이다. 히스토리는 시간순, `shift+U`는 트리 구조순. 두 스택을 별개로 관리해야 한다.
  - peek view의 이전/다음은 **현재 뷰의 정렬·필터가 적용된 결과 순서**를 따라야 한다 — 뷰 상태를 peek에 전달해야 성립.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 히스토리 스택 끝 | 무시(에러 아님) |
  | 뒤로 간 페이지가 그 사이 삭제됨 | "삭제된 페이지" 안내 후 한 단계 더 뒤로 |
  | 루트 페이지에서 `shift+U` | 워크스페이스 홈 또는 무시 |
  | 부모가 데이터베이스인 레코드 | 데이터베이스 뷰로 이동 |
  | 뒤로 갈 때 스크롤 위치 | 복원되어야 함 → 히스토리 항목에 scroll anchor 저장 |
  | 편집 중 뒤로 | 미저장 변경 flush 후 이동 |
  | peek 마지막 레코드에서 다음 | 무시 또는 첫 레코드로 순환 `[확인필요]` |
  | 브라우저 뒤로가기 버튼 | Notion 내부 히스토리와 반드시 일치해야 함 |
  | 권한 없어진 페이지로 뒤로 | 접근 불가 안내 후 스킵 |
- **데이터 모델 함의**:
  - 히스토리는 **클라이언트 세션 상태**로 충분(서버 저장 불필요). `history: [{block_id, scroll_top, view_state}]` + `cursor`.
  - `shift+U`는 서버 데이터 필요: `block.parent_id` 체인. breadcrumb와 같은 데이터를 쓰므로 `ancestor_ids[]` 비정규화가 여기서도 재사용된다.
  - peek 순회는 클라이언트가 보유한 "현재 뷰의 정렬된 row id 배열"에서 인덱스 ±1.
  - 탭(데스크톱): `open_tabs(session_id, index, block_id)` — 로컬 저장으로 충분.
- **UI/인터랙션**: 위 단축키 전부 + 상단 breadcrumb 클릭 이동 + 사이드바 트리.
- **의존 기능**: 라우팅, 블록 트리, 데이터베이스 뷰 상태(F-05 도메인).
- **구현 난이도**: **M** — 브라우저 History API와 자체 스택의 동기화, 스크롤 복원이 주 난점. peek 순회는 별도로 S.
- **우선순위**: **P0** (뒤로/앞으로, URL 복사) / **P1** (`shift+U`, 새 탭) / **P2** (데스크톱 탭·창).
- **클론 시 현실적 대안**: 브라우저 History API에 전면 위임(`pushState` + `popstate`)하고 자체 스택을 만들지 않는다. 스크롤 복원은 `history.state`에 저장. 데스크톱 탭은 v2 이후.
- **참고 출처**: https://www.notion.com/help/keyboard-shortcuts

---

### F-07-13 AI Q&A / Enterprise Search (의미 기반 검색)

- **한 줄 정의**: 자연어 질문을 받아 워크스페이스·연결된 앱·웹에서 관련 내용을 찾아 출처를 인용한 답변을 생성한다.
- **사용자 시나리오**: 검색 패널에서 `Search all sources with AI` 선택 → "지난 분기 이탈률 목표가 뭐였지?" 입력 → 수 초 후 문장 답변 + 근거 페이지 2건과 Slack 메시지 1건이 인용으로 표시 → 인용 클릭 시 원본으로 이동.
- **동작 상세**:
  - 기본 검색 범위(공식): **Notion 워크스페이스(데이터베이스·뷰·relation·property 포함)** + **AI 커넥터로 연결된 서드파티 앱** + **웹**. `All sources` 메뉴에서 소스를 제한하거나 웹 검색을 끌 수 있다.
  - 커넥터 카테고리(공식): Chat(Slack, Microsoft Teams) / Knowledge(Google Drive, Microsoft SharePoint·OneDrive) / Projects(Jira, GitHub, Linear) / Email·Calendar(Gmail, Outlook, Google Calendar) / Notion apps(Notion Mail, Notion Calendar).
  - 권한 원칙(verbatim): "Notion AI will honor existing permissions ... **Users will not be able to generate content or receive responses based on resources they do not have access to.**" Slack 커넥터는 "acts as you, so it can only access what you can already see".
  - **⚠️ 커넥터는 실시간 조회가 아니라 사전 인덱싱이다 — 이전 판에 없던 핵심 수치**:
    - 신규 콘텐츠 반영: "New content may take **up to 3 hours** to be indexed by Notion AI before it appears in search results. Larger data volumes may take additional time."
    - 연결 해제 시: "your content will become unsearchable (for some AI Connectors, this can take **up to one hour**). Additionally, your data will be **deleted within a day** of disconnecting."
    - 함의: (a) "방금 올린 Drive 파일이 왜 안 나오냐"는 **버그가 아니라 사양**이므로 UI가 이 지연을 문구로 흡수해야 한다. (b) 권한 회수/연결 해제 시 최대 1시간의 **노출 잔존 창(window)** 이 존재한다 → 클론은 이 구간을 클릭 시점 재검증으로 막아야 한다(F-07-07). (c) 삭제 SLA(1일)를 지키려면 커넥터별 span에 `connector_account_id` 외래키를 반드시 걸어 일괄 삭제 경로를 확보해야 한다.
  - **항상 출처를 인용**한다("always cite its sources so you can go back to the source"). 관련 정보를 못 찾으면 못 찾았다고 답한다 `[확인필요]`(2차 출처 근거).
  - 모델 선택 가능(GPT/Claude/Gemini). 단 "depending on the model you choose, Notion AI may look only at information from the web" — 모델에 따라 워크스페이스 접근이 제한될 수 있다.
  - `Add context`로 특정 페이지/사람을 지정하거나 질문 안에서 `@`로 직접 멘션할 수 있다.
  - 플랜 게이팅: **Business / Enterprise 전용**.
  - 내부 구조(공식 엔지니어링 블로그):
    - 페이지를 **span 단위로 청킹**해 각각 embedding, 벡터 DB에 authors/permissions 메타와 함께 적재.
    - **오프라인 배치**(Spark, 신규 워크스페이스 온보딩) + **온라인 실시간**(Kafka consumer, 페이지 편집 반영, **sub-minute latency**) 이중 경로.
    - **Page State Project**: span 텍스트 해시와 메타데이터 해시 2개를 두어, 한 글자 수정으로 전체 페이지를 재임베딩하던 낭비를 제거 → **데이터량 70% 감소**.
    - 벡터 DB 변천: 전용 pod 클러스터(2023-11) → serverless(2024-05, 비용 50%↓) → **Turbopuffer**(오브젝트 스토리지 기반, 2025-01, 검색 엔진 비용 60%↓). 쿼리 지연 **70~100ms → 50~70ms**.
    - 2025-07부터 임베딩 파이프라인을 Spark → **Ray(Anyscale)** 로 이관, 셀프호스팅 오픈소스 임베딩 모델 사용, 비용 80%+ 절감.
    - 2024-04 시점에 일일 온보딩 가능 워크스페이스가 **600배** 증가.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 근거를 못 찾음 | 추측하지 말고 "찾지 못함"을 반환. 이 도메인에서 가장 중요한 실패 모드 |
  | 권한 없는 span | 벡터 검색 **필터 단계**에서 제외. 후처리 제외는 top-k가 비어버림 |
  | 방금 편집한 내용 질문 | 온라인 파이프라인 지연(수십 초) 내에는 반영 안 됨 → UI에서 안내 |
  | 매우 긴 페이지 | 청킹으로 커버되지만 문맥이 청크 경계에서 끊김 → 인접 청크 overlap 필요 `[추정]` |
  | 상충하는 정보 | 여러 출처를 모두 인용하고 상충을 명시 |
  | 표/데이터베이스 property | 텍스트로 직렬화해 임베딩해야 검색 가능 |
  | 커넥터 토큰 만료 | 해당 소스를 조용히 제외하지 말고 "연결 만료" 표시. Notion은 Google Drive의 경우 "automatically find another workspace owner with the correct permissions to re-establish the connection"으로 소유자 이탈을 처리한다 — 즉 **커넥션은 개인이 아니라 워크스페이스에 귀속**되어야 한다 |
  | 연결 해제 직후 검색 | 최대 1시간 동안 여전히 검색될 수 있음(공식 명시). 클론은 `connector_account.status='revoked'`를 **쿼리 필터에 즉시 반영**해 이 창을 0으로 만들 것 — 인덱스 삭제를 기다리지 말 것 |
  | 커넥터 소스와 Notion 페이지가 상충 | 소스별 신선도(`last_synced_at`)를 인용 옆에 표기 |
  | 비용 폭주 | 질의당 토큰 상한 + 사용자별 rate limit |
  | 페이지 대량 삭제 | 해당 span 전부 벡터 스토어에서 제거(안 하면 삭제된 내용을 답변에 인용) |
- **데이터 모델 함의**: 위 `vector_span` 스키마. 추가로:
  ```sql
  ai_query_log (id, user_id, space_id, question, sources_used jsonb,
                model, input_tokens, output_tokens, latency_ms, feedback smallint, created_at)
  connector_account (id, space_id, user_id, provider, external_account_id,
                     access_token_enc, refresh_token_enc, scopes, status, last_synced_at)
  ```
  - 재임베딩 판정: `if new_text_hash != text_hash → 재임베딩; elif new_meta_hash != meta_hash → 메타만 UPDATE; else → skip`. 이 3분기 로직이 비용의 대부분을 결정한다.
- **UI/인터랙션**: 검색 패널 내 "AI로 검색" 전환, `All sources` 소스 선택 메뉴, `Add context`, 답변 스트리밍, 인용 각주 클릭 → 원본 이동, 좋아요/싫어요 피드백.
- **의존 기능**: F-07-06/07(인덱싱·권한), 커넥터 OAuth 인프라, LLM 게이트웨이.
- **구현 난이도**: **XL** — 임베딩 파이프라인 + 벡터 스토어 + 권한 필터 + RAG 프롬프트 + 인용 매핑 + 비용 제어. 커넥터까지 넣으면 이 도메인 전체보다 크다.
- **우선순위**: **P2** — 인상적이지만 MVP 가치는 F-07-01/02/08 대비 현저히 낮다. lexical 검색이 부실한 상태에서 AI 검색을 얹으면 두 개 다 부실해진다.
- **클론 시 현실적 대안**:
  1. **v1**: 커넥터·웹 없이 **워크스페이스 한정 RAG**만. `pgvector` + Postgres에 span 저장(별도 벡터 DB 불필요).
  2. **하이브리드 검색**: 벡터 단독보다 `tsvector` BM25 결과와 벡터 결과를 RRF(Reciprocal Rank Fusion)로 합치는 편이 소규모에서 품질이 안정적이다 `[추정]`.
  3. **재임베딩 비용 제어**: Notion의 이중 해시 전략(text_hash / meta_hash)을 **처음부터** 넣는다. 나중에 넣으면 청구서를 보고 넣게 된다.
  4. **인용 매핑**: LLM에 span_id를 함께 주고 각주 형태로 인용시킨 뒤, 반환된 span_id를 실제 페이지 링크로 치환. 존재하지 않는 span_id를 반환하면 그 각주는 버린다.
- **참고 출처**: https://www.notion.com/blog/two-years-of-vector-search-at-notion , https://www.notion.com/help/enterprise-search , https://www.notion.com/help/notion-ai-connectors , https://www.notion.com/help/search

---

### F-07-14 데이터베이스 내 검색

- **한 줄 정의**: 데이터베이스 뷰 안에서 🔍 아이콘으로 해당 데이터베이스의 레코드만 즉시 필터링한다.
- **사용자 시나리오**: 데이터베이스 뷰 상단 🔍 클릭 → "김" 입력 → 입력할 때마다 행이 즉시 줄어듦 → 지우면 원복.
- **동작 상세**:
  - 공식: "To search a database, select 🔍 at the top of the database and enter a query. As you type, the database will only show pages that match your query."
  - 대상: **데이터베이스 페이지 제목 + property 값**. 워크스페이스 검색이 못 찾는 **select/multi-select 태그를 여기서는 찾을 수 있다**(헬프센터가 "use database search instead"라고 명시).
  - 뷰의 기존 filter/sort와 **AND로 결합**된다 `[추정]`.
  - 뷰 설정으로 저장되지 않는 임시 상태다 `[추정]`.
  - 공개 API에서는 이 동작이 search 엔드포인트가 아니라 **Query a data source 엔드포인트**에 해당한다("To search a specific data_source ... use the Query a data_source endpoint instead").
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 페이지 본문에만 있는 단어 | 매칭 안 됨(제목·property만) |
  | 대소문자/부분 일치 | 부분 일치, 대소문자 무시 `[추정]` |
  | relation/rollup property | 참조된 값의 표시 텍스트로 매칭되는지 `[확인필요]` |
  | 대용량 데이터베이스(수만 행) | 클라이언트 필터링 불가 → 서버 쿼리 + debounce |
  | 그룹화된 보드 뷰 | 그룹 구조를 유지한 채 카드만 필터. 빈 그룹 표시 정책 필요 |
  | 검색어와 뷰 필터 충돌 | 둘 다 적용(교집합), 결과 0건이면 안내 |
  | 검색 중 다른 사용자가 행 추가 | 실시간 반영 시 필터를 다시 적용 |
- **데이터 모델 함의**:
  - 서버 쿼리: `SELECT ... FROM page WHERE data_source_id=$1 AND (title ILIKE $q OR searchable_text ILIKE $q)`. `properties::text` 전체 스캔은 위험하므로 `properties`에서 텍스트형 값만 추출한 `searchable_text` 파생 컬럼 + GIN trigram 인덱스 권장.
  - 워크스페이스 검색 인덱스와 **다른 인덱스**다. 워크스페이스 검색은 select 태그를 제외하지만 여기선 포함하기 때문. 이 차이를 무시하면 둘 중 하나가 사양과 어긋난다.
- **UI/인터랙션**: 뷰 툴바 🔍 토글, 입력창, 매칭 행 수 표시, `Esc`로 해제.
- **의존 기능**: 데이터베이스/뷰 도메인(F-05).
- **구현 난이도**: **S~M** — 단순 ILIKE로 시작하면 S, property 타입별 정규화(날짜/숫자/relation 표시값)까지 하면 M.
- **우선순위**: **P1** — 데이터베이스 기능이 있는 시점에는 거의 필수.
- **클론 시 현실적 대안**: 행 수 1000 미만이면 이미 로드된 데이터로 클라이언트 필터. 초과 시 서버 쿼리로 전환.
- **참고 출처**: https://www.notion.com/help/search , https://developers.notion.com/reference/post-search

---

### F-07-15 관리자 콘텐츠 검색 (Admin Content Search)

- **한 줄 정의**: 워크스페이스 소유자가 비공개 페이지를 포함한 전체 콘텐츠를 검색하고 공유 상태를 감사·회수한다.
- **사용자 시나리오**: 소유자가 관리자 설정 → 콘텐츠 검색 → 페이지 ID/제목/내용으로 검색 → 결과에서 "외부 공개" 상태인 페이지 발견 → 그 자리에서 게시 취소(unpublish) → 결과를 CSV로 내보냄.
- **동작 상세** (공식 명시):
  - **Enterprise 플랜 전용**, 워크스페이스 소유자만. 도메인 검증(domain verification)은 불필요.
  - 검색 대상: **page ID, 제목, 내용**.
  - 필터: 생성일, 생성자, audience 유형.
  - 결과 컬럼: 페이지 위치, 접근 상태, 생성자/생성일, 접근 보유자, 최종 편집자/편집 시각, **`Audience` 컬럼에 "the most permissive group"**.
  - 범위: private / internally shared / externally shared / publicly shared 전부. 복수 Enterprise 워크스페이스를 중앙에서 조회 가능.
  - 액션: unpublish, 접근 회수, **CSV 내보내기**.
  - 공식 경고문: "Using this feature may provide workspace owners with access to the personal data of workspace members and guests." — 법률 자문 권고까지 문서에 포함되어 있다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 소유자가 아닌 관리자 | 접근 거부 |
  | 관리자 검색 자체의 감사 로그 | 누가 무엇을 검색했는지 audit log에 남아야 함(Notion 동작 `[확인필요]`) |
  | 비공개 페이지 **본문** 노출 범위 | 목록/메타데이터까지인지 본문 전체인지 `[확인필요]` — 프라이버시 설계상 결정적 |
  | 대량 회수 실행 | 되돌리기 불가 → 확인 단계 필수 |
  | CSV 내보내기 크기 | 비동기 작업 + 다운로드 링크 |
  | 여러 워크스페이스 교차 조회 | 워크스페이스별 권한 재확인 |
- **데이터 모델 함의**:
  - 이 기능은 **권한 필터를 우회하는 유일한 검색 경로**다. 따라서 검색 함수의 권한 인자를 `viewer_id | ADMIN_OVERRIDE(space_id)`로 명시적 타입 분기해서, 우회 경로가 일반 검색에 새지 않게 해야 한다.
  - 별도 감사 테이블: `admin_search_audit(id, admin_user_id, space_id, query, filters, result_count, action_taken, created_at)`.
  - `Audience` 계산: 페이지의 유효 권한을 집계해 가장 넓은 것(public > external > internal > private)을 도출하는 파생 함수 필요.
- **UI/인터랙션**: 관리자 설정 내 별도 화면(검색 오버레이와 분리), 테이블 뷰, 행별 액션 메뉴, CSV 내보내기 버튼.
- **의존 기능**: F-07-06/07, 관리자/조직 도메인.
- **구현 난이도**: **L** — 검색 자체는 기존 인덱스 재사용이라 쉽지만, audience 산출과 액션(회수/unpublish)의 안전장치가 무겁다.
- **우선순위**: **P2** — 엔터프라이즈 판매 요건. 개인/소규모 클론에는 불필요.
- **클론 시 현실적 대안**: v2 이후. 초기에는 "공개 공유된 페이지 목록" 화면 하나만 제공해도 실무적 가치의 대부분을 커버한다.
- **참고 출처**: https://www.notion.com/help/admin-content-search

---

### F-07-16 사이드바 트리 내비게이션 · 즐겨찾기 (Sidebar / Favorites)

> ⚠️ **이전 판 최대 누락 기능.** 이 도메인의 이름이 "검색·**네비게이션**·커맨드"인데도 사이드바가 없었다. 실사용에서 페이지 이동의 대부분은 검색이 아니라 사이드바 트리에서 일어난다.

- **한 줄 정의**: 워크스페이스의 페이지 계층을 좌측 고정 패널에 섹션별 트리로 상시 노출하고, 클릭·드래그로 이동/재배치한다.
- **사용자 시나리오**:
  1. 사이드바에서 `Private` 섹션 헤딩을 클릭 → 섹션 전체가 접힌다.
  2. 페이지 좌측 `▸`를 클릭 → 하위 페이지가 펼쳐진다. 데이터베이스의 경우 펼치면 **뷰 목록**이 bullet 표시로 나온다.
  3. 페이지 A를 드래그해 페이지 B 위로 가져간다 → B가 **파란색으로 하이라이트**되면 drop → A가 B의 하위 페이지가 된다.
  4. 페이지 상단 `⭐` 클릭 → 즉시 `Favorites` 섹션에 나타난다. 해제는 별 다시 클릭 또는 사이드바 항목 hover → `Remove from Favorites`.
  5. `cmd/ctrl` + `\`로 사이드바 전체를 접었다 편다.
- **동작 상세** (공식 명시 / 재조사에서 상단 고정 항목 4종 추가 확인):
  사이드바는 성격이 다른 **두 층**으로 구성된다 — 상단의 "표면 진입점"과 하단의 "페이지 트리 섹션". 이전 판은 하단만 기술했다.

  | 층 | 항목 | 공식 정의 | 클론에서의 의미 |
  |---|---|---|---|
  | 상단(진입점) | `Home` | "pages and tasks that need your attention". 섹션 구성: Upcoming events / Recents / Favorites / Agents / Teamspaces / Shared pages / Private pages | 집계 대시보드. 트리가 아님 → 별도 쿼리 세트(F-07-19) |
  | 상단 | `Search` | 검색 모달을 연다 | F-07-01의 클릭 진입점(단축키와 동일 컴포넌트) |
  | 상단 | `Inbox` | "all your notifications in one place" — mentions, comments, updates, reminders | **이 도메인 아님**(알림 도메인). 사이드바 항목이라는 사실만 기록 |
  | 상단 | `Library` | 워크스페이스 콘텐츠를 탭별로 브라우징 | F-07-19 |
  | 트리 | `Favorites` | "where you can easily access all of the pages most important to you" | 사용자별 개인 목록 |
  | 트리 | `Teamspaces` | 팀 단위 공간. **Plus / Business / Enterprise 플랜** | 권한 경계와 1:1 |
  | 트리 | `Shared` | 특정 인원과 공유된 페이지. "Other members of your workspace who haven't been invited can't view these pages" | 섹션 = 권한 상태의 **파생 뷰**이지 저장된 분류가 아니다 |
  | 트리 | `Private` | "only visible to you" | 〃 |
  | 트리 | `Trash` | 삭제 페이지. "you won't be able to edit a page that's in the trash unless you restore it" | `in_trash` 필터 + 읽기 전용 모드 |
  - 섹션 헤딩 자체가 접기/펼치기 토글이다.
  - **섹션 단위 커스터마이즈(공식 확인, 이전 판 누락)**: `Private`/`Shared` 섹션은 `Sort`, `Show`(**5개 ~ 전체**), `Move section`을 제공한다. → 사이드바 섹션은 하드코딩된 렌더가 아니라 **사용자별 설정을 읽는 컴포넌트**다(F-07-04의 `sidebar_section_pref` 참조).
  - 사이드바 접기/펼치기는 `cmd/ctrl + \` 또는 `<<` / `>>` 버튼(공식 명시).
  - 데이터베이스를 펼치면 하위 페이지가 아니라 **뷰(view)** 가 나열된다 → 트리 노드가 동종(block)이 아니라 이종(block | view)이라는 뜻이며, 클론의 트리 컴포넌트는 이 이종성을 처음부터 전제해야 한다.
  - **드래그로 섹션을 넘으면 권한이 바뀐다(공식 경고문 verbatim)**: "If you drag a page from a shared section into `Private`, others will lose access." → 드래그는 순수 UI 조작이 아니라 **권한 변경 트랜잭션**이다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | shared → Private 드래그 | **권한 파괴 조작.** 확인 다이얼로그 필수. 되돌리기(undo) 경로가 없으면 사고가 된다 |
  | 자기 자신의 하위로 드래그(순환) | 거부. drop 대상 하이라이트 자체를 비활성. 조상 판정은 `ancestor_ids`/materialized path로 O(1) |
  | 하위 페이지 수천 개 | 펼침 시 전량 로드 금지 → 노드별 lazy load + 가상 스크롤. 접힌 노드는 카운트도 fetch하지 않음 |
  | 동시편집 — 타인이 같은 페이지를 다른 부모로 이동 | 마지막 쓰기 승리로는 트리가 깨진다. 이동은 `(page_id, expected_parent_id, expected_order_key)` 낙관적 검증 후 적용, 실패 시 트리 재동기화 |
  | 동시편집 — 순서(order) 충돌 | 정수 index 대신 **fractional indexing**(a와 b 사이에 항상 새 키를 만들 수 있는 문자열 키)을 쓰면 두 사용자가 같은 위치에 삽입해도 병합이 성립한다 |
  | 즐겨찾기한 페이지의 권한 상실 | `Favorites`에서 즉시 제거(조회 시 권한 재필터). **즐겨찾기는 권한을 부여하지 않는다** |
  | 즐겨찾기한 페이지가 휴지통행 | 숨김. 복원 시 다시 표시 |
  | 게스트 사용자 | 접근 가능한 페이지만 트리에 나타남 → **트리 조회 자체가 권한 필터링 쿼리**다(F-07-07의 또 하나의 누출 지점) |
  | 페이지 제목 미지정 | "Untitled" 표시. 정렬/검색에서 제외하지 말 것 |
  | 오프라인 | 마지막 트리 스냅샷을 로컬에서 렌더, 이동 조작은 비활성 `[추정]` |
- **데이터 모델 함의**:
  ```sql
  -- 트리는 block 테이블에 이미 존재(parent_id). 사이드바는 그 위의 조회 계층이다.
  block.sidebar_section  text     -- 'private'|'shared'|'teamspace'. 권한 상태에서 파생 [추정]
  block.order_key        text     -- fractional index. 정수 시퀀스 금지(동시 삽입 시 재정렬 폭발)
  block.path             text     -- materialized path. 순환 검사·서브트리 이동·In 필터에 재사용

  favorite (
    user_id uuid, block_id uuid, space_id uuid,
    order_key text,                 -- 즐겨찾기 내 수동 정렬
    created_at timestamptz,
    pk (user_id, block_id)
  )
  index (user_id, order_key)

  sidebar_ui_state (               -- 어떤 노드가 펼쳐져 있는지. 클라이언트 로컬로 충분 [추정]
    user_id, block_id, expanded bool
  )

  -- 섹션 설정(Sort / Show / Move section)은 F-07-04의 sidebar_section_pref 와 동일 테이블.
  -- 서버 저장이어야 디바이스 간 사이드바 구성이 일치한다 [추정].
  ```
  - **핵심 결정**: `order_key`를 정수로 두면 "3번과 4번 사이 삽입"이 뒤 전체 UPDATE를 유발하고, 동시편집에서 즉시 충돌한다. fractional indexing(문자열 키)이 사실상 유일한 실용해다.
  - 트리 조회는 `WHERE space_id=$1 AND parent_id=$2 AND permission_scope_id = ANY($scopes) ORDER BY order_key` — **한 레벨씩**. 전체 트리를 한 번에 내려보내면 대형 워크스페이스에서 첫 렌더가 죽는다.
  - `favorite`은 F-07-04 `recent_visit`과 **다른 테이블**이다(수동 vs 자동). 단 사이드바에서 인접 렌더되므로 조회는 하나로 묶는 편이 왕복이 줄어든다.
- **UI/인터랙션**: `cmd/ctrl` + `\` 토글 / 섹션 헤딩 클릭 접기 / `▸` 노드 펼침 / 드래그 앤 드롭(대상 파란 하이라이트) / 항목 hover 시 `⋯` 메뉴 + `+`(하위 페이지 생성) / 페이지 상단 `⭐` / hover → `Remove from Favorites`.
- **의존 기능**: 블록 트리(parent_id/order_key), 권한·teamspace 도메인, F-07-07(트리 조회의 권한 필터), F-07-12(라우팅).
- **구현 난이도**: **L (1~2주) / 실시간 트리 동기화까지 요구하면 XL (재평가)** — 트리 렌더 자체는 M이지만, (a) fractional indexing 도입, (b) 드래그 앤 드롭의 순환 방지·drop 존 판정, (c) 섹션 간 이동의 권한 변경 트랜잭션, (d) lazy load + 동시편집 재동기화까지 포함하면 L. **드래그 앤 드롭을 v0에서 빼면 M으로 떨어진다.**
  - **XL로 올라가는 조건(과소평가 주의)**: 트리 구조 변경(이동/삭제/권한 변경)이 **모든 접속 클라이언트에 실시간 반영**되어야 하는 순간, 이건 "UI 컴포넌트"가 아니라 **분산 트리 수렴 문제**가 된다. 두 사용자가 동시에 A를 서로 다른 부모로 옮기면 순진한 last-write-wins는 노드 소실 또는 순환을 만든다. 텍스트 CRDT는 이 문제를 풀어주지 않는다(트리 이동은 별도 알고리즘 영역이다). 실용적 방어선: 이동만은 **CRDT가 아니라 서버 권위 트랜잭션**(낙관적 검증 + 순환 검사 + 거부 시 클라이언트 롤백)으로 처리하고, 렌더 상태만 실시간 브로드캐스트한다. 이 결정을 v0에서 내려두지 않으면 나중에 트리 전체를 다시 설계하게 된다 `[추정]`.
- **우선순위**: **P0** — 검색보다 먼저 필요하다. 페이지가 10개일 때 검색은 무용하지만 사이드바는 즉시 유용하다. F-07-04(최근 방문)와 함께 이 도메인에서 **비용 대비 효과 1·2위**.
- **클론 시 현실적 대안**: v0는 (1) 드래그 없이 클릭 이동만, (2) 섹션은 `Private`/`Shared` 2개만(teamspace는 나중), (3) 정렬은 `order_key` 문자열로 처음부터 두되 UI 재정렬은 v1, (4) 즐겨찾기는 테이블 하나 — 이 조합이면 2~3일. `Trash`는 `in_trash` 플래그 필터 하나면 되므로 같이 넣는다.
- **참고 출처**: https://www.notion.com/help/navigate-with-the-sidebar , https://www.notion.com/help/guides/navigating-with-the-sidebar , https://www.notion.com/help/keyboard-shortcuts

---

### F-07-17 URL · breadcrumb · 블록 앵커 딥링크

> 이전 판에서 breadcrumb은 여러 기능의 부속으로만 언급되고 **독립 명세가 없었다.** 딥링크 진입(= URL로 특정 블록에 도착하는 경로)은 아예 다뤄지지 않았다.

- **한 줄 정의**: 모든 페이지·블록에 안정적인 URL을 부여하고, 그 URL로 진입했을 때 정확한 위치로 스크롤·하이라이트하며, 현재 위치를 상단 breadcrumb으로 표시한다.
- **사용자 시나리오**:
  1. 블록에 hover → 좌측 `⋮⋮` 클릭 → `Copy link to block` → 클립보드에 해당 블록 URL이 복사된다.
  2. 동료가 그 URL을 열면 페이지가 로드되고 **해당 블록 위치까지 스크롤**되며 일시적으로 하이라이트된다.
  3. 페이지 상단 breadcrumb(`워크스페이스 / 팀 / 프로젝트 / 회의록`)에서 상위 항목을 클릭해 거슬러 올라간다.
  4. `cmd/ctrl + L`로 현재 페이지 URL 복사.
- **동작 상세**:
  - 공식 문구는 "Hover over the block and click the `⋮⋮` that appears to the left. Select `Copy link to block`. This will copy the URL of that specific block to your clipboard."까지다.
  - ✅ **URL 포맷 확인됨(이전 판의 `[확인필요]` 해소)**. 공식 개발자 문서가 페이지 URL에서 id를 뽑는 절차를 직접 기술한다: "The URL ends in a page ID. It should be a **32 character long string**. Format this value by inserting hyphens (-) in the following pattern: **8-4-4-4-12**" (예: `1429989fe8ac4effbc8f57f56486db54` → `1429989f-e8ac-4eff-bc8f-57f56486db54`). 즉 URL은 `https://www.notion.so/{제목 slug}-{32자리 hex}` 형태이고, **해석 키는 항상 뒤쪽 32자리 hex(UUID의 하이픈 제거형)** 이다. 제목 slug는 표시용 장식이며 링크 해석에 관여하지 않는다 → 제목을 바꿔도 링크가 깨지지 않는다는 이 문서의 불변식이 1차 출처로 뒷받침된다. (출처: https://developers.notion.com/docs/working-with-page-content)
  - 블록 앵커는 **URL 프래그먼트** 형태다: `https://www.notion.so/{page-id}#{block-id}` — block id 역시 하이픈 없는 32자리 hex. 공식 헬프센터는 "Copy link to block"이라는 조작만 기술하고 포맷을 명시하지 않으므로, 포맷 근거는 **2차 출처**(notion-enhancer 이슈 #294, makenotion/notion-mcp-server 이슈 #211)다 `[확인필요]`. 다만 "페이지 id + `#` + 블록 id"라는 구조 자체는 여러 독립 출처가 일치한다.
  - 함의: id가 하이픈 없는 32자 hex로 URL에 실리므로, 클론의 라우터는 **하이픈 유무 양쪽을 모두 받아 정규화**해야 한다(`/{32hex}` ↔ `/{uuid}`). 이걸 빼먹으면 API가 뱉은 id를 URL에 그대로 붙였을 때 404가 난다.
  - breadcrumb은 `block.parent_id` 체인의 렌더이며, F-07-01 검색 결과·F-07-04 최근 방문·F-07-12 `shift+U`·F-07-03 `In` 필터가 **모두 같은 조상 경로 데이터를 재사용**한다 → `ancestor_ids[]` / materialized path 비정규화의 투자 회수 지점이 정확히 여기다.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 제목 변경 후 옛 URL 접근 | id로 해석되므로 정상 동작 + 새 slug로 canonical redirect |
  | 앵커 블록이 삭제됨 | 페이지는 열되 앵커 무시, "해당 블록을 찾을 수 없음" 토스트. **404를 던지면 안 됨** |
  | 앵커 블록이 접힌 toggle 안 | 조상 toggle을 모두 펼친 뒤 스크롤(F-07-05와 동일 문제, 코드 공유) |
  | 앵커 블록이 가상 스크롤 미렌더 영역 | DOM 검색으로는 못 찾는다 → 문서 모델에서 인덱스를 구해 **해당 인덱스로 가상 스크롤을 점프**시킨 뒤 렌더 완료를 기다려 스크롤 |
  | 권한 없는 페이지 URL 접근 | "접근 권한 없음" + 요청 버튼. **제목을 노출하면 안 됨** — URL slug에 제목이 들어 있으므로 **slug 자체가 누출 벡터**다. 권한 없는 사용자에게 slug를 재노출(리다이렉트·에러 화면 포함)하지 말 것 |
  | 휴지통 페이지 URL | "삭제됨" 안내 + 복원 버튼(권한 있을 때) |
  | 블록이 다른 페이지로 이동됨 | 블록 id는 불변이므로 **현재 소속 페이지를 조회해 리다이렉트** |
  | 동시편집 중 앵커 진입 | 스크롤 후에도 위쪽 블록의 높이 변화로 위치가 밀린다 → 스크롤 앵커링을 픽셀 offset이 아니라 **block_id 기준**으로 유지 |
  | 매우 깊은 계층 | breadcrumb 축약(`A / … / Y / Z`) + 생략부 클릭 시 전체 경로 팝오버 |
  | 순환된 부모 체인 | 깊이 상한 + 방문 집합으로 방어(F-07-09 순환 참조 항목 참조) |
- **데이터 모델 함의**:
  ```sql
  -- 라우팅에 필요한 최소 조회
  resolve_url(block_id) -> { page_id, ancestor_path[], is_accessible, in_trash }
  -- block.id 는 페이지/블록 공통 uuid → URL 하나로 둘 다 해석 가능해야 한다
  block.slug_cache text   -- 제목에서 파생. 표시용일 뿐 해석 키가 아님(해석 키는 항상 id)
  ```
  - **불변식**: URL 해석은 **id만으로 성립**해야 한다. slug를 해석에 쓰면 제목 변경이 곧 링크 파괴가 되고, 이는 위키형 제품에서 치명적이다.
  - `ancestor_ids[]`는 breadcrumb / `In` 필터 / `shift+U` / 검색 결과 경로 표시 / 사이드바 현재 위치 하이라이트에 **5회 재사용**된다. 이 도메인에서 단일 필드로 가장 수익률이 높은 비정규화.
- **UI/인터랙션**: 블록 hover → `⋮⋮` → `Copy link to block` / `cmd/ctrl + L` 페이지 URL 복사 / 상단 breadcrumb 클릭 / 앵커 진입 시 1~2초 배경 하이라이트 후 페이드.
- **의존 기능**: 라우팅(F-07-12), 블록 트리, 권한(F-07-07), 에디터 스크롤 제어(F-07-05와 코드 공유), F-07-09(블록 앵커 링크의 edge 기록).
- **구현 난이도**: **M (2~5일)** — URL 파싱·리다이렉트는 S지만, 가상 스크롤 환경에서의 앵커 도달과 접힌 블록 펼침이 시간을 먹는다. **가상 스크롤이 없으면 S.**
- **우선순위**: **P0**(페이지 URL·breadcrumb) / **P1**(블록 앵커 딥링크) — 페이지 URL이 없으면 공유 자체가 불가능하므로 P0. 블록 앵커는 협업 밀도가 올라간 뒤 필요해진다.
- **클론 시 현실적 대안**: v0는 `/{id}` 순수 id URL(slug 없음)로 시작하면 slug 누출·canonical redirect 문제가 통째로 사라진다. 블록 앵커는 `#{block_id}` + `scrollIntoView()`로 시작하고, 가상 스크롤을 도입하는 시점에 인덱스 점프 로직을 추가한다.
- **참고 출처**: https://www.notion.com/help/create-links-and-backlinks , https://www.notion.com/help/keyboard-shortcuts , https://developers.notion.com/docs/working-with-page-content , https://github.com/notion-enhancer/notion-enhancer/issues/294

---

### F-07-18 외부 표면 검색 API (REST `/v1/search` · MCP 툴)

> 이전 판은 공개 API를 여러 기능의 **근거**로만 인용하고 독립 기능으로 명세하지 않았다. 그 결과 "REST API는 제목만 검색한다"는 결정적 제약이 문서 어디에도 적히지 않았다.

- **한 줄 정의**: 사람이 아닌 클라이언트(통합, 봇, LLM 에이전트)가 워크스페이스 콘텐츠를 검색·탐색할 수 있는 프로그래밍 인터페이스를 제공한다.
- **사용자 시나리오**: 개발자가 integration 토큰을 발급 → 페이지를 커넥션에 공유 → `POST /v1/search {"query":"회고"}` 호출 → 공유된 범위 안에서 **제목이 매칭되는** 페이지/데이터소스 목록을 커서 페이지네이션으로 수신.
- **동작 상세**:
  - **표면이 네 종류이고, 매칭 범위가 서로 다르다.**
    | 표면 | 엔진 | 매칭 범위 | 결과 상한 | 필터 |
    |---|---|---|---|---|
    | REST `POST /v1/search` | lexical | **제목 전용** — "pages or data_sources ... that have **titles** that include the query param" | `page_size` 기본 **100** | `{property:"object", value:"page" 또는 "data_source"}`, `{in_trash: bool}` |
    | MCP `notion-search` | lexical | 콘텐츠 포함(UI 검색과 동급). "short, specific keywords" | **up to 50** | location(page / data source / teamspace), creator, editor, date, title, content status |
    | MCP `notion-ai-search` | **semantic** | Notion + 커넥터(Slack / Mail / Calendar / Google Drive / Jira) | **up to 50** | page and descendants / data source / teamspace 스코프 |
    | MCP `notion-fetch` | — | URL·ID로 콘텐츠 조회. 특수 id `"self"`는 워크스페이스 정체성 + **`current_tool_access`**(툴명 → 접근 상태 맵) 반환 | — | — |
  - **rate limit(MCP 스펙)**: `notion-search`는 **30 requests per minute**, `notion-ai-search`는 표준 per-user 한도 **180 requests/minute**. 키워드 검색 쪽이 6배 더 빡빡한 이유는 문서에 없다 `[확인필요]`.
  - `notion-ai-search` 쿼리 형식 제약: "concise natural-language semantic query"(약 50단어 미만), **호출당 1개**. 다중 질문을 한 번에 넣는 것을 명시적으로 금지한다.
  - **정합성 보장(공식)**: "any pages or databases that are **directly shared with a connection are guaranteed to be returned**" — 직접 공유분만 지연 없이 보장되고, 상속 공유분은 인덱싱 지연을 탄다.
  - **완전성 미보장(공식)**: "Search is not guaranteed to return everything, and the index may change as your connection iterates through pages and databases".
  - 성능 권고(공식): "Lowering `page_size` from the default of 100 can accelerate results", "Search works best when the request is as specific as possible".
  - 데이터베이스 내부 필터링에는 부적합 — "use the Query a data_source endpoint instead"(F-07-14와 대응).
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 방금 공유한 페이지 검색 | 인덱싱 지연으로 미반환. 공식 권고는 UI에 **Refresh 버튼**을 두는 것 |
  | 본문에만 키워드가 있는 페이지(REST) | **매칭되지 않음.** 제목 전용이라는 사실을 SDK 문서에 명시하지 않으면 통합 개발자가 전부 오해한다 |
  | 커서 반복 중 인덱스 변경 | 중복·누락 발생 가능. 클라이언트는 결과 id로 dedup해야 하며, **전량 동기화 용도로 search를 쓰면 안 된다** |
  | 결과 0건 vs 권한 없음 | 구분 불가(설계상 의도). 존재 여부 노출 금지 원칙(F-07-07)과 일치 |
  | rate limit 초과 | 429 + `Retry-After`. 클라이언트는 지수 백오프 |
  | 봇 토큰 권한 축소 | `notion-fetch self`의 `current_tool_access`로 **런타임에 툴 가용성을 판별**해야 함 — 하드코딩 금지 |
  | 대량 페이지 열거 목적 | search가 아니라 **데이터소스 query + 증분 `last_edited_time` 커서**를 쓸 것 |
  | 휴지통 검색 | `filter.in_trash=true`. 단 "Trash results are eventually consistent and index-backed" |
  | 동시편집 중 조회 | 인덱스는 최신 커밋 기준이므로 진행 중 편집은 미반영. API 소비자는 `last_edited_time`으로 신선도를 판단해야 한다 |
- **데이터 모델 함의**:
  ```sql
  connection (
    id uuid pk, space_id uuid, name text, type text,   -- 'internal' | 'public'
    capabilities jsonb,            -- read_content / update_content / insert_content / read_user
    token_hash bytea, created_at timestamptz
  )
  connection_grant (               -- "커넥션에 공유된" 범위. 권한 주체의 한 종류다
    connection_id uuid, block_id uuid, granted_by uuid, granted_at timestamptz,
    pk (connection_id, block_id)
  )
  ```
  - **핵심 설계**: 봇을 `principal`의 한 종류로 모델링하면 F-07-07의 권한 필터를 그대로 재사용할 수 있다. 봇 전용 권한 경로를 따로 만들면 **그 경로가 곧 누출 지점**이 된다.
  - REST 표면이 제목 전용이라면 **별도 인덱스가 필요 없다** — `page(space_id, lower(title))` 하나로 충분. 즉 클론에서 API 검색은 UI 검색보다 훨씬 싸게 만들 수 있다.
  - `search_query_log.source`(이미 스키마에 `'app'|'api'|'slack'|'mcp'`로 존재)로 표면별 사용량을 분리 계측할 것.
- **UI/인터랙션**: 없음(프로그래밍 인터페이스). 단 integration 설정 화면에서 "이 커넥션에 공유된 페이지 목록"을 보여줘야 개발자가 빈 결과를 디버깅할 수 있다.
- **의존 기능**: F-07-06(인덱스), F-07-07(권한 — 봇 principal), 인증/토큰 도메인.
- **구현 난이도**: **M** — REST 제목 검색만이면 S. MCP 툴 2종(키워드/시맨틱) + `current_tool_access` 게이팅 + rate limit까지 하면 M~L.
- **우선순위**: **P2** — 사용자용 검색(F-07-01)이 없는 상태에서 API를 먼저 만들 이유가 없다. 단 **에이전트/LLM 연동을 제품 가설로 삼는다면 P1로 올라간다** — 이 경우 `notion-fetch self`식 능력 광고(capability advertisement) 패턴을 처음부터 넣을 것.
- **클론 시 현실적 대안**: v1에서 REST `GET /search?q=&scope=` 하나만. MCP는 별도 서버를 만들지 말고 기존 REST를 감싸는 얇은 어댑터로 시작하고, 시맨틱 검색은 F-07-13이 생긴 뒤에 노출한다.
- **참고 출처**: https://developers.notion.com/reference/post-search , https://developers.notion.com/reference/search-optimizations-and-limitations , https://developers.notion.com/guides/mcp/mcp-supported-tools , https://developers.notion.com/docs/mcp

---

### F-07-19 `Home` · `Library` 브라우징 표면 (검색 없이 찾기)

> **이번 갭 조사에서 발견한 누락 기능.** 이전 판은 "찾기"를 검색(F-07-01)과 트리(F-07-16) 두 가지로만 봤다. 실제 Notion에는 **질의 없이 목록으로 훑는 제3의 표면**이 있고, 그것이 `Home`과 `Library`다. 최근 방문(F-07-04)·즐겨찾기(F-07-16)의 주 소비처가 여기다.

- **한 줄 정의**: 검색어를 치지 않고도 워크스페이스 콘텐츠를 "성격별 목록"(최근·즐겨찾기·공유·비공개·teamspace)으로 브라우징하고, 그 목록 위에서 이름 검색과 필터를 건다.
- **사용자 시나리오**:
  1. 사이드바 최상단 `Home` 클릭 → `Upcoming events` / `Recents` / `Favorites` / `Teamspaces` / `Shared pages` / `Private pages` 섹션이 카드·리스트로 한 화면에 나온다.
  2. 섹션 옆 `•••` → `Show`로 그 섹션이 보여줄 항목 수를 조절한다(5개 ~ 전체).
  3. 사이드바 `Library` 클릭 → `Teamspaces` / `Recents` / `Favorites` / `Shared` / `Private` 탭으로 이동.
  4. Library 안에서 이름으로 페이지를 찾거나(`Search for a page by name`), 필터로 좁히거나, **표시할 컬럼(상세 항목)을 커스터마이즈**한다.
- **동작 상세** (공식 명시):
  | 표면 | 공식 정의 | 구성 |
  |---|---|---|
  | `Home` | "pages and tasks that need your attention" | Upcoming events / Recents / Favorites / Agents / Teamspaces / Shared pages / Private pages / Notion apps |
  | `Library` | "Library helps you find and organize pages across your workspace, all from one place." | 탭: Teamspaces("Find content from your teamspaces") / Recents("Quickly find pages you viewed recently") / Favorites("Find all pages you've favorited") / Shared("Find pages shared with you") / Private("Find your personal pages") / AI Meeting Notes / Agents |
  - Library의 기능 3종(verbatim): "Search for a page by name. Use filters to narrow results. Customize which details show up when you browse, search, or filter pages."
  - **F-07-01 검색과의 결정적 차이**: Library의 검색은 **이름(제목) 기준**이고 스코프가 탭으로 미리 고정된다. 전문 검색(본문 포함)이 아니다. 즉 이 표면의 백엔드는 검색 인덱스가 아니라 **일반 목록 쿼리 + 정렬/필터**로 충분하다 `[추정]`.
  - **F-07-16 사이드바 트리와의 차이**: 트리는 `parent_id` 계층을 보여주고, Home/Library는 **계층을 무시한 평면 목록**을 성격별로 보여준다. 같은 페이지가 두 표면에 동시에 나타나는 것이 정상이다.
  - Home 섹션은 제거해도 접근 자체가 사라지지는 않는다(사이드바 섹션 커스터마이즈와 동일 원리) `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 기대 동작 |
  |---|---|
  | 빈 워크스페이스(모든 섹션 0건) | 섹션을 빈 채로 나열하지 말고 온보딩/템플릿 카드로 대체. 빈 섹션 7개는 "고장난 화면"으로 읽힌다 |
  | 권한 없는 페이지 | 모든 탭·섹션이 **각각** 권한 필터를 통과해야 한다. Home 한 화면에 7개 쿼리가 뜨므로 누출 지점도 7개(F-07-07) |
  | 휴지통 항목 | 전 섹션 기본 제외(`in_trash=false`) |
  | 대용량(즐겨찾기 500건, 공유 5만 건) | 섹션은 `Show` 상한으로 잘라 조회하고, 탭은 커서 페이지네이션. **Home 진입 시 7개 쿼리가 동시에 나가므로 단일 배치 엔드포인트로 묶을 것** |
  | 동시편집 — 다른 사용자가 페이지를 공유 해제 | 다음 조회에서 사라짐. 실시간 반영은 불필요 `[추정]` |
  | 삭제된 참조(즐겨찾기 대상 삭제) | 목록에서 숨김. `favorite` row는 남겨두고 조인에서 필터(복원 시 되살아남) |
  | 같은 페이지가 여러 탭에 중복 | 정상 동작(성격이 다른 목록이므로 dedup 금지) |
  | Library 필터 상태 | URL에 직렬화해야 뒤로가기/공유가 성립(F-07-03과 동일 원칙) |
  | 정렬 기준 없는 항목(제목 없음) | "Untitled"로 정렬 대상에 포함. 제외하면 사용자가 방금 만든 빈 페이지를 못 찾는다 |
- **데이터 모델 함의**:
  ```sql
  -- 새 테이블은 거의 필요 없다. 이 표면은 기존 데이터의 "다른 조회 각도"다.
  -- 필요한 것은 각 섹션 1개당 쿼리 1개 + 사용자별 표시 설정.

  home_section_pref (                 -- F-07-04 / F-07-16 의 sidebar_section_pref 와 통합 권장
    user_id uuid, surface text,       -- 'home' | 'library' | 'sidebar'
    section text,                     -- 'recents'|'favorites'|'shared'|'private'|'teamspaces'|'events'
    visible bool default true,
    show_count int,                   -- null = all
    sort_key text,                    -- 'last_visited' | 'last_edited' | 'title' | 'created'
    position int,
    pk (user_id, surface, section)
  )

  library_view_pref (                 -- "Customize which details show up" 대응
    user_id uuid, tab text,
    visible_columns text[],           -- ['title','last_edited_at','last_edited_by','teamspace','location']
    filters jsonb,
    pk (user_id, tab)
  )
  ```
  - 섹션별 쿼리 대응표(전부 기존 테이블 재사용):
    | 섹션 | 쿼리 |
    |---|---|
    | Recents | `recent_visit` ORDER BY `last_visited_at` DESC (F-07-04) |
    | Favorites | `favorite` JOIN `block` ORDER BY `order_key` (F-07-16) |
    | Shared / Private | `block` WHERE 파생 `sidebar_section` + 권한 필터 |
    | Teamspaces | `teamspace` 멤버십 + 각 teamspace 루트 |
    | Upcoming events | 캘린더/날짜 property 도메인(이 도메인 밖) |
  - **핵심**: 여기서 새 인덱스를 만들지 말 것. 필요한 인덱스는 이미 F-07-04(`user_id, last_visited_at`), F-07-16(`user_id, order_key`), 권한(`permission_scope_id`)에 존재한다. 추가로 필요한 것은 이름 검색용 `lower(title)` trigram 인덱스 하나뿐이며 그것도 F-07-08 자동완성과 공유된다.
- **UI/인터랙션**: 사이드바 최상단 `Home` / `Library` 항목 / 섹션 `•••` → `Sort`·`Show`·`Move section` / Library 탭 전환 / 탭 내 이름 검색 인풋 / 필터 칩 / 표시 컬럼 선택 메뉴.
- **의존 기능**: F-07-04(최근 방문), F-07-16(즐겨찾기·섹션 파생), F-07-07(표면마다 권한 필터), 권한/teamspace 도메인. 검색 인덱스(F-07-06)에는 **의존하지 않는다** — 이 표면을 먼저 만들 수 있다는 뜻이다.
- **구현 난이도**: **M (2~5일)** — 새 저장소가 없고 기존 쿼리 6~7개를 한 화면에 배치하는 작업. 시간을 먹는 곳은 (a) 7개 쿼리의 배치 엔드포인트화, (b) 섹션 설정 CRUD, (c) 빈 상태 디자인. **Library의 컬럼 커스터마이즈까지 하면 L.**
- **우선순위**: **P1** — F-07-16(사이드바)이 있으면 없어도 제품이 성립한다. 다만 **F-07-04를 이미 만들었다면 추가 비용이 거의 0**이므로 가성비가 매우 높다. Library의 탭/필터/컬럼까지는 P2.
- **클론 시 현실적 대안**: `Library`를 만들지 말고 **`Home` 한 화면만** 구현한다(Recents / Favorites / Shared / Private 4섹션, 각 5건 고정). 섹션 설정·컬럼 커스터마이즈·Agents·AI Meeting Notes는 전부 생략. 이 축약본은 1~2일이면 되고, 사용자가 체감하는 "찾기" 가치의 대부분을 가져간다.
- **참고 출처**: https://www.notion.com/help/navigate-with-the-sidebar , https://www.notion.com/help/manage-your-library , https://www.notion.com/help/search

---

## 구현 우선순위 요약표

| ID | 기능 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-07-01 | 글로벌 검색 패널 (Cmd+K/P) | L | **P0** | 02, 03, 04, 06, 07 |
| F-07-02 | 쿼리 파싱 및 랭킹 | L | **P0** / P1(개인화) | 06 |
| F-07-03 | 검색 필터(작성자/기간/위치/teamspace) | M | P1 | 01, 06 |
| F-07-04 | 최근 방문 페이지 | **S** | **P0** | 라우팅, 권한 |
| F-07-05 | 페이지 내 검색 (Cmd+F) | M | P1 | 에디터 모델 |
| F-07-06 | 검색 인덱싱 파이프라인 | **XL** | **P0** | 블록 저장, 권한 |
| F-07-07 | 권한 인지 검색 | **XL**(재평가, 방식 B 채택 시 L) | **P0** | 권한 도메인, 06 |
| F-07-08 | 인라인 링크 자동완성 (@ / [[ / +) | L | **P0** | 에디터 inline node, 07, 09 |
| F-07-09 | 백링크 / 링크 그래프 | M | P1 | 08 |
| F-07-10 | 슬래시 커맨드 (/) | M | **P0** | 블록 타입 정의 |
| F-07-11 | 커맨드 팔레트 / 전역 Command Search | M(웹) / **L**(데스크톱 전역) | P2 | 01, 10, 데스크톱 셸 |
| F-07-12 | 이동 단축키 · 히스토리 · 탭 | M | P0(뒤/앞) / P1 / P2 | 라우팅, 트리 |
| F-07-13 | AI Q&A / Enterprise Search | **XL** | P2 | 06, 07, 커넥터, LLM |
| F-07-14 | 데이터베이스 내 검색 | S~M | P1 | DB 도메인 |
| F-07-15 | 관리자 콘텐츠 검색 | L | P2 | 06, 07, 관리자 도메인 |
| F-07-16 | 사이드바 트리 · 즐겨찾기 | L (실시간 트리 동기화 시 **XL**) | **P0** | 블록 트리, 권한, 07, 12 |
| F-07-17 | URL · breadcrumb · 블록 앵커 딥링크 | M (가상 스크롤 없으면 S) | **P0**(페이지 URL·breadcrumb) / P1(블록 앵커) | 12, 07, 블록 트리 |
| F-07-18 | 외부 검색 API (REST · MCP) | M~L | P2 (에이전트 연동이 가설이면 P1) | 06, 07, 인증 |
| F-07-19 | `Home` · `Library` 브라우징 표면 | M (컬럼 커스터마이즈까지 L) | P1 | 04, 16, 07 |

**P0 목록(10개)**: F-07-01, F-07-02, F-07-04, F-07-06, F-07-07, F-07-08, F-07-10, F-07-12(부분), F-07-16, F-07-17(부분)

### 난이도 재평가 노트 (과소평가되기 쉬운 3개)

| 기능 | 이전 | 재평가 | 왜 |
|---|---|---|---|
| F-07-07 권한 인지 검색 | L | **XL** | 누출 지점이 6개 이상의 독립 코드경로로 갈라지고, 권한을 인덱스 쿼리 안으로 밀어넣지 않으면 페이지네이션이 깨진다 → F-07-06과 분리 발주 불가. 그룹 멤버십 변경의 캐시 무효화는 검색이 아니라 분산 캐시 문제다 |
| F-07-16 사이드바 트리 | L | **L / 실시간 동기화 요구 시 XL** | 트리 **이동**의 동시 편집 수렴은 텍스트 CRDT가 풀어주지 않는 별도 문제다. 순진한 last-write-wins는 노드 소실·순환을 만든다 |
| F-07-11 Command Search | M | **M(웹) / L(데스크톱)** | 실체가 액션 팔레트가 아니라 **OS 전역 런처**(전역 단축키·트레이 상주·메인 창과 분리된 인증 세션)임이 재조사에서 확인됨 |

> 반대로 **과대평가하기 쉬운 것은 F-07-06**이다. Notion의 XL은 ES 클러스터·재색인·CDC를 전제한 값이고, Postgres generated column 방식이면 실질 S다. "원본이 XL이니 우리도 XL"이 이 문서에서 가장 비싼 오독이 될 수 있다.

### 권장 구축 순서

```
0주차  F-07-16 v0 (사이드바 트리, 드래그 없음) + F-07-17 (id 기반 URL·breadcrumb)
       ※ 검색보다 먼저. 페이지 10개일 때 검색은 무용하고 트리는 즉시 유용하다.
1주차  F-07-04 (최근 방문)  →  F-07-01 껍데기(빈 상태만 동작)
       └ 여력이 있으면 F-07-19 Home 축약본(4섹션 × 5건) — 추가 비용 거의 0
2주차  F-07-06 v0 (generated tsvector 컬럼 + GIN)  →  F-07-02 기본 랭킹
       ※ F-07-07(권한 필터)을 반드시 같은 커밋에 포함할 것
3주차  F-07-10 (슬래시 커맨드) + F-07-08 (@ 자동완성) — 팝업 컴포넌트 공유
4주차  F-07-12 (히스토리/단축키) + F-07-09 (백링크) + F-07-17 블록 앵커
이후   F-07-03 필터 → F-07-05 페이지 내 검색 → F-07-14 DB 검색 → F-07-16 드래그 앤 드롭
v2     F-07-19 Library 전체 → F-07-11 팔레트 → F-07-18 API → F-07-13 AI → F-07-15 관리자
```

핵심 판단 2가지:
1. **F-07-06을 XL로 만들지 말 것.** Postgres generated column 방식으로 v0을 만들면 XL이 사실상 S로 떨어지고, 이 도메인 전체가 5주 안에 들어온다. 별도 검색 엔진과 CDC 파이프라인은 "필요해진 다음"에 도입한다.
2. **내비게이션을 검색보다 먼저 만들 것.** F-07-16 + F-07-04 + F-07-17은 합쳐도 1주 미만인데, 이 셋이 없으면 검색을 아무리 잘 만들어도 제품이 쓸 수 없다(검색 결과를 클릭해도 갈 곳의 구조가 없고, 링크를 공유할 수도 없다).

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 검색 방식 | 차용 가능한 지점 |
|---|---|---|
| **Outline** | Postgres 전문 검색 기반. `SearchQuery` 모델이 `id, source(Slack/App/API/OAuth/MCP), query(≤255자), results, duration(ms), score(-1/0/1), answer, userId, shareId, teamId` 필드를 갖는다. `record()`가 **"같은 스코프에서 최근 시간창 안에 있고 한 쿼리가 다른 쿼리의 prefix면 새 row 대신 기존 row를 갱신"** 하는 방식으로 search-as-you-type 노이즈를 접는다. | ① 검색 로깅 스키마를 거의 그대로 차용 가능. ② prefix 접기는 랭킹 학습 데이터 품질에 직결. ③ `score`(만족도)와 `answer`(AI 답변)를 한 테이블에 둔 설계 — lexical/AI 검색을 같은 계측으로 다룬다. |
| **Docmost** | Postgres 전문 검색만으로 전체 검색을 구현. 런타임 의존성이 PostgreSQL + Redis뿐. Space 단위 스코프(= Notion teamspace 대응). | Notion 클론의 **현실적 하한선**을 보여주는 증거: 별도 검색 엔진 없이도 위키형 제품이 성립한다. |
| **AFFiNE / BlockSuite** | **indexer를 별도 self-host 구성요소로 분리**(전용 운영 문서 존재: 설정/운영/백업/프로덕션 점검/트러블슈팅). BlockSuite는 문서 간 양방향 링크와 transclusion(Notion synced block 대응)을 지원. 슬래시 메뉴·툴바·드래그 핸들이 "widget"이라는 동일 추상으로 구현되어 있다. | ① 인덱서를 처음부터 별도 프로세스로 분리하는 구조. ② **widget 추상** — 슬래시 메뉴와 `@` 자동완성을 같은 인터페이스로 만드는 설계가 F-07-08/10의 코드 공유 근거가 된다. ③ `linked-doc` 위젯이 `@` 자동완성의 오픈소스 구현체. `[확인필요]` 세부는 소스 직접 확인 필요(공식 문서 페이지가 402/접근 제한). |
| **AppFlowy** | 로컬 우선(Rust 코어) 아키텍처. | 오프라인 검색 = 로컬 인덱스 필요라는 제약을 미리 보여준다. 클론이 오프라인을 목표하지 않는다면 이 복잡도는 피할 것. |
| **PostgreSQL 자체** | `tsvector`/`tsquery`, `websearch_to_tsquery`(따옴표 구문 / OR / `-` NOT 지원), `ts_rank`/`ts_rank_cd`, `setweight`로 필드 가중치(A~D), `ts_headline`로 스니펫 하이라이트, GIN 인덱스. | **이 도메인 v0 전체를 Postgres 하나로 커버 가능.** 특히 `ts_headline`이 서버측 스니펫 생성을, `setweight`가 F-07-02의 제목 가중치를 각각 공짜로 해결한다. |

### 실전 권고 스키마 (Postgres v0)

```sql
ALTER TABLE page ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(plain_text,'')), 'B')
  ) STORED;
CREATE INDEX page_search_idx ON page USING GIN (search_vector);
CREATE INDEX page_title_trgm ON page USING GIN (lower(title) gin_trgm_ops);  -- 자동완성 + 오타 fallback

-- 검색 쿼리: 권한은 필터 절에 들어간다(후처리 금지)
SELECT p.id, p.title,
       ts_headline('simple', p.plain_text, q, 'MaxWords=30, MinWords=10') AS snippet,
       ts_rank_cd(p.search_vector, q) AS rank
FROM page p, websearch_to_tsquery('simple', $query) q
WHERE p.space_id = $space
  AND p.in_trash = false
  AND p.permission_scope_id = ANY($accessible_scopes)
  AND p.search_vector @@ q
ORDER BY rank DESC, p.last_edited_at DESC
LIMIT 25;
```

- `'simple'` 사전은 한국어 스테밍을 하지 않는다. 한글 대응 선택지: (a) `pg_bigm`으로 bigram 검색, (b) 형태소 분석 결과를 애플리케이션에서 만들어 `tsvector`에 주입, (c) Meilisearch/Typesense(CJK 기본 지원) 도입. **이 결정을 v0에서 미루면 나중에 인덱스 전체를 다시 만들어야 한다.**
- Notion이 인덱싱 시 언어를 감지해 per-language analyzer를 붙이는 것과 같은 문제를, 한국어 단일 언어 클론은 "처음부터 한국어 analyzer 고정"으로 훨씬 싸게 푼다.

---

## 미해결 / 확인필요

| # | 항목 | 상태 | 왜 중요한가 |
|---|---|---|---|
| 1 | `Best Matches` 랭킹의 실제 가중치 공식 | `[추정]`만 존재, 비공개 | 클론은 자체 공식을 세워야 하며, 클릭 로그 없이는 튜닝 불가 |
| 2 | Notion 검색의 오타 허용(fuzzy) 여부 | `[확인필요]` — **재조사에서도 1차 출처 없음.** 헬프센터 `help/search` 본문에 typo/fuzzy 언급이 전혀 없다. "Notion supports fuzzy search"라고 단정하는 것은 2차 출처(getguru 레퍼런스 글)뿐이며 검증 불가 | 사용자 불만 글은 많으나 공식 근거 없음. **클론은 "원본이 한다더라"를 근거로 삼지 말고, 0건일 때만 `pg_trgm` fallback을 켜는 자체 정책으로 갈 것** |
| 3 | 검색 UI의 **불리언 연산자**(`OR`, `-`) 지원 여부 | `[확인필요]` — 따옴표 구문 검색은 ✅ 공식 확인 완료(해소), 불리언만 미확인 | 지원 시 쿼리 파서 스펙이 달라짐. 단 `websearch_to_tsquery`가 둘 다 공짜로 주므로 클론 비용은 0 |
| 4 | Quick Filter 칩("created by me", "edited last week", "on the current page")의 정확한 목록 | `[확인필요]` — **2차 재검증에서도 미확인.** `help/search` 필터 목록은 여전히 `Title only`/`Created by`/`Teamspace`/`In`/`Date` 5종뿐 | 근거가 검색 스니펫 수준에 머문다. 필수 요구사항으로 올리지 말 것 |
| 5 | `cmd+F` 시 접힌 toggle 자동 펼침 여부 | `[확인필요]` | 페이지 내 검색 구현 정책을 결정 |
| 6 | Command Search의 정체 | ✅ **해소.** 액션 팔레트가 아니라 **데스크톱 전역 런처**(앱 밖에서 동작, 커스터마이즈 가능한 전역 단축키, 메뉴바/작업표시줄, 검색 + Notion AI, 기본 on, `Settings → Preferences`에서 off)임이 `help/notion-for-desktop`으로 확인됨. 남은 미확인: 전역 런처 **내부 UI가 앱 내 검색 오버레이와 동일 컴포넌트인지** `[확인필요]` | F-07-11의 난이도를 M → L로 올린 근거 |
| 7 | 블록 앵커 링크가 백링크로 집계되는지 | `[확인필요]` | `link_edge.link_type` 처리 분기 |
| 8 | 자식 블록이 있는 블록의 타입 변환 시 자식 처리 규칙 | `[확인필요]` | 슬래시 변환 함수 스펙 |
| 9 | Admin content search가 비공개 페이지 **본문**까지 노출하는지 | `[확인필요]` | 프라이버시 설계상 결정적 |
| 10 | `recent_visit`의 서버 동기화 여부 / 보관 상한 | `[추정]` | localStorage vs 서버 테이블 결정 |
| 11 | 페이지 이동 시 서브트리 권한 재색인의 실제 fan-out 처리 방식 | 미공개 | 클론에서는 materialized path로 우회 권장 |
| 12 | AI 청킹의 청크 크기 / overlap 값 | 미공개 | RAG 품질에 직접 영향, 자체 실험 필요 |
| 13 | peek view의 마지막 레코드에서 "다음" 동작(순환 여부) | `[확인필요]` | 사소하나 사양 확정 필요 |
| 14 | **한국어 형태소 분석기 선택(`pg_bigm` vs 외부 엔진)** | **미결정 — 이 프로젝트가 답해야 함** | v0 인덱스 설계를 되돌릴 수 없게 만드는 결정 |
| 15 | Outline `searchDocuments.ts`, BlockSuite `linked-doc` 위젯 실제 소스 | 부분 확인 | Outline `SearchQuery` 모델만 확인. 나머지는 404/402로 미확인 — 소스 클론 후 직접 확인 필요 |
| 16 | 페이지 URL / 블록 앵커 포맷 | **페이지 URL은 ✅ 해소**(공식 개발자 문서: URL 끝 32자 hex = page ID, 8-4-4-4-12). **블록 앵커 `#{block-id}`는 2차 출처만** `[확인필요]` | 라우터가 하이픈 유무를 모두 정규화해야 한다는 요구사항이 여기서 나온다 |
| 17 | `Best Matches`에 recency가 섞이는지 | ✅ **해소** — 헬프센터가 "Best Matches (default, with recently edited pages ranked higher)"로 명시 | 랭킹 공식을 `relevance + w·recency`로 잡아야 하는 근거 |
| 18 | Library의 검색이 제목 전용인지 본문도 포함하는지 | `[추정]`(제목 전용으로 판단) | 제목 전용이면 Library는 검색 인덱스에 의존하지 않고 먼저 만들 수 있다 → 구축 순서가 달라진다 |
| 19 | Home 섹션을 숨겼을 때 해당 콘텐츠 접근 경로 | `[확인필요]` | 섹션 = 저장된 분류가 아니라 파생 뷰라는 이 문서의 전제를 검증하는 항목 |
| 20 | `Recents` 표시 개수(`Show`) 설정의 저장 위치(서버 vs 디바이스) | `[확인필요]` | 디바이스 로컬이면 `sidebar_section_pref`가 불필요해진다 |
| 21 | 전역 Command Search가 등록 실패한 단축키를 사용자에게 알리는지 | `[확인필요]` | OS 전역 단축키는 조용히 실패하는 것이 기본이라 UX 정책이 필요 |

---

## 출처

**1차 출처 (공식)**

1. Notion Help Center — Search for pages & content: https://www.notion.com/help/search
2. Notion Help Center — Notion keyboard shortcuts: https://www.notion.com/help/keyboard-shortcuts
3. Notion Help Center — Links & backlinks: https://www.notion.com/help/create-links-and-backlinks
4. Notion Help Center — Enterprise Search: https://www.notion.com/help/enterprise-search
5. Notion Help Center — Admin content search: https://www.notion.com/help/admin-content-search
6. Notion Help Center — Notion AI Connectors overview: https://www.notion.com/help/notion-ai-connectors
7. Notion Help Center — Using slash commands: https://www.notion.com/help/guides/using-slash-commands
8. Notion Engineering Blog — Rebuilding Notion's lexical search reindexer: https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer
9. Notion Engineering Blog — Two years of vector search at Notion: 10x scale, 1/10th cost: https://www.notion.com/blog/two-years-of-vector-search-at-notion
10. Notion API Reference — Search by title: https://developers.notion.com/reference/post-search
11. Notion API Reference — Search optimizations and limitations: https://developers.notion.com/reference/search-optimizations-and-limitations
12. Notion 공식 X 계정 — Quick Find → Search 개편 발표(40-50% 속도 향상): https://x.com/NotionHQ/status/1567183564554338304
13. Notion Help Center — Navigate Notion with the sidebar(사이드바 섹션 전체 목록, 드래그 경고문, `cmd/ctrl + \`, Sort/Show/Move section): https://www.notion.com/help/navigate-with-the-sidebar
14. Notion Help Center — Manage your Library(Library 탭 정의, 이름 검색·필터·컬럼 커스터마이즈): https://www.notion.com/help/manage-your-library
15. Notion Help Center — Notion for desktop(Command Search 전역 런처 사양, Preferences 토글): https://www.notion.com/help/notion-for-desktop
16. Notion API Docs — Working with page content(페이지 URL 끝 32자 hex = page ID, 8-4-4-4-12 포맷): https://developers.notion.com/docs/working-with-page-content
17. Notion Help Center — Sidebar navigation 카테고리: https://www.notion.com/help/category/sidebar-navigation

**2차 출처 (기술 분석 / 오픈소스)**

18. ZenML LLMOps Database — Rebuilding a Production Search Reindexing Pipeline at Scale: https://www.zenml.io/llmops-database/rebuilding-a-production-search-reindexing-pipeline-at-scale
19. Outline — `server/models/SearchQuery.ts`: https://github.com/outline/outline/blob/main/server/models/SearchQuery.ts
20. AFFiNE Docs — Self-host Indexer: https://docs.affine.pro/self-host-affine/administer/indexer (본문 접근 제한, 목차/범위 수준만 확인)
21. BlockSuite Docs — Block Widgets: https://blocksuite.affine.pro/guide/block-widgets.html
22. PostgreSQL Documentation — Controlling Text Search (`websearch_to_tsquery`, `ts_rank`, `ts_headline`): https://www.postgresql.org/docs/current/textsearch-controls.html
23. AFFiNE GitHub 저장소: https://github.com/toeverything/affine
24. notion-enhancer — "Global linking blocks" 이슈(블록 앵커 URL이 `https://www.notion.so/<page-id>#<block-id>` 형태라는 근거): https://github.com/notion-enhancer/notion-enhancer/issues/294
25. makenotion/notion-mcp-server — "Expose block IDs in fetch output to enable deep links to specific blocks" 이슈(블록 딥링크 포맷 논의): https://github.com/makenotion/notion-mcp-server/issues/211
26. Guru — Notion Pages Search 레퍼런스(**"Notion supports fuzzy search"라고 주장하는 유일한 출처. 1차 출처로 교차검증되지 않으므로 근거로 채택하지 않음** — 반증 시도의 기록으로만 남긴다): https://www.getguru.com/reference/notion-pages-search

> **반증 시도 기록**: 이번 갭 보완에서 (1) 오타 허용(fuzzy), (2) Quick Filter 칩 목록, (3) Command Search의 정체, (4) 페이지/블록 URL 포맷, (5) `Best Matches`의 recency 반영 여부를 각각 다시 검색·정독했다. 결과는 (3)(4)(5) 확인·정정, (1)(2)는 **재검증 실패로 `[확인필요]` 유지**다. (1)은 2차 출처가 "지원한다"고 단정하지만 공식 문서에 근거가 없어 채택하지 않았다.
