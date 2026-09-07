# 02. 페이지 / 워크스페이스 구조 — 다이제스트

> 원본: `docs/research/02-page-workspace.md` (1156줄) / 조사일 2026-09-06 / 기능 **23개**
> 용도: SYNTHESIS 마스터 문서 입력. 스키마 정본은 `00-canonical-data-model.md`가 담당하며, 여기서는 **이 도메인이 요구하는 것**만 기술한다.

---

## 1. 기능 인벤토리 (전수 23개 / 원본 `### F-` 개수 23과 일치)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-02-01 | 페이지 = 블록 (page-as-block) | L | P0 | 블록 에디터(D01), 블록 타입 변환 |
| F-02-02 | 무한 중첩 페이지 트리 | L | P0 | F-02-01, F-02-03, F-02-12 |
| F-02-03 | 사이드바 네비게이션 (3.4 4탭 구조) | L | P0 | F-02-02, F-02-04, F-02-12 |
| F-02-04 | 즐겨찾기 (Favorites, per-user) | S | P0 | F-02-03 |
| F-02-05 | 페이지 아이콘 | M | P1 | F-02-01, 파일 스토리지 |
| F-02-06 | 페이지 커버 이미지 | M | P2 | F-02-01, 파일 스토리지 |
| F-02-07 | 레이아웃 설정 (font / small text / full width) | S | P2 | F-02-01 |
| F-02-08 | 페이지 이동 (Move to) | L | P0 | F-02-02, F-02-12, F-02-03 |
| F-02-09 | 페이지 복제 (Duplicate, 딥카피) | L | P1 | F-02-02, F-02-14 |
| F-02-10 | 페이지 잠금 (Lock page) | S | P2 | F-02-01, 권한 |
| F-02-11 | 휴지통과 복원 (2단계 soft delete) | M (첨부GC+teamspace 스코프 포함 시 L) | P0 | F-02-02, F-02-03 |
| F-02-12 | Teamspace / Private / Shared 영역 구분 | XL | P0 (범위 축소 필수) | 사용자·그룹, 인증 |
| F-02-13 | 서브페이지 / link_to_page / @멘션 | L | P0(서브페이지) / P1(멘션) | F-02-01, F-02-02, 검색, F-02-14 |
| F-02-14 | 백링크 (backlinks) | M | P1 | F-02-13, 권한 |
| F-02-15 | Breadcrumb (경로 표시) | S | P0 | F-02-02, F-02-05 |
| F-02-16 | 페이지 URL / slug / 딥링크 | M | P0 | F-02-01, F-02-12, 라우팅 |
| F-02-17 | 워크스페이스 컨테이너 / 스위처 | M (미착수 시 후행비용 XL) | P0 | 인증, F-02-12, F-02-03 |
| F-02-18 | 페이지 공유 / 게스트 / 웹 게시(Publish) | L | P1(멤버공유) / P2(게스트·게시) | F-02-12, F-02-16, F-02-17 |
| F-02-19 | 버전 히스토리 / 복원 | L | P1 | 협업편집(D01), 권한 |
| F-02-20 | 열기 모드 (full / side peek / center peek) | M | P2 (라우팅 구조는 P0) | F-02-16, F-02-01 |
| F-02-21 | 검색 / Recents | L | P0(제목) / P1(전문) | F-02-12, 평문추출 파이프라인 |
| F-02-22 | 내보내기 / 가져오기 (export / import) | M~L | P2 | F-02-02, 잡큐, 스토리지, F-02-12 |
| F-02-23 | Wiki 전환 / page owner / verification | M (뷰엔진 자작 시 L) | P2 | F-02-12, D03 뷰엔진, 알림 |

**집계**: 23행 = 원본 `### F-` 23개와 일치. P0(전부 또는 부분) = F-01, 02, 03, 04, 08, 11, 12, 13, 15, 16, 17, 21 (12개). L/XL = F-01, 02, 03, 08, 09, 12, 13, 18, 19, 21 (+F-11·F-22는 조건부 L).

---

## 2. 이 도메인이 데이터 모델에 요구하는 것

> 새 스키마를 창작하지 않는다. 아래는 **정본(`00-canonical-data-model.md`)이 반드시 수용해야 하는 요구사항** 목록.

### 2.1 필수 엔티티 (이 도메인 발신)

| 엔티티 | 요구 사유 (F-ID) | 핵심 요구 필드 |
|---|---|---|
| `block` (페이지도 여기 포함) | F-02-01 | `type`, `parent_id`(상향 단일), `parent_type`(workspace/teamspace/page/block/database), `workspace_id`, `space_id`, `owner_user_id`, `position`(fractional index), `properties.title`(**rich text 배열, 문자열 아님**) |
| `block` 삭제 3상태 | F-02-11 | `trashed_at`/`trashed_by`, `purged_at`, `hard_delete_after`, `deleted_root_id` — **단일 `deleted_at`으로는 2단계 retention을 표현 못 함** |
| `page_meta` (블록 행 비대화 방지, `[추정]` 노션 내부 분리 여부는 비공개) | F-02-05~07, 10, 16, 23 | `slug_id`, `icon_type/value`, `cover_type/url/position(0~1)`, `font`, `small_text`, `full_width`, `locked/locked_by/locked_at`, `show_backlinks`, `show_comments`, `is_public/public_url`, `is_wiki`, `verified_at/by`, `verification_expires_at` |
| `page_owner(block_id, user_id)` | F-02-23 | 복수 owner 허용, 기본값 = 생성자 |
| `permission` | F-02-12, F-02-18 | `(block_id, subject_type[user/group/teamspace/workspace/public], subject_id, level)` UNIQUE |
| `favorite(user_id, workspace_id, block_id, position)` | F-02-04 | PK(user_id, block_id), **완전 per-user** |
| `page_link` 역인덱스 | F-02-13, F-02-14 | `(source_block_id, source_page_id, target_page_id, link_kind)` + INDEX(target_page_id) |
| `sidebar_alias` | F-02-13 (I6) | `(source_block_id PK, container_page_id, target_page_id)` — **`block.parent_id`와 절대 혼합 금지** |
| `teamspace` / `teamspace_member` | F-02-12 | `access ∈ {open, closed, private}`, `is_default`, `default_page_permission`, role ∈ {owner, member} |
| `workspace` / `workspace_member` | F-02-17 | `plan`, `trash_retention_days`(기본 30, Ent 1~3650), `purge_retention_days`(기본 30), `version_history_days`, role ∈ {owner, membership_admin, member, guest} |
| `page_version` | F-02-19 | `(page_id, created_at, editors[], snapshot, kind[auto/restore/manual])` + INDEX(page_id, created_at DESC) |
| `share_link` | F-02-18 | `token UNIQUE`, `audience`, `level`, `allow_duplicate`, `search_indexed`, `expires_at`, `revoked_at` |
| `sidebar_state` / `sidebar_section` / `sidebar_pref` | F-02-03 | 펼침·섹션 on/off·순서·정렬·표시개수·폭·활성탭 = **전부 per-user**. 섹션은 하드코딩 목록이 아니라 `{key, enabled, order, sort_mode, item_limit}` **레지스트리** |
| `recent_visit(user_id, block_id, visited_at)` | F-02-21, F-02-03 | upsert, 사용자당 N개 트림 |
| `job` | F-02-08, 09, 11, 21, 22 | `kind ∈ {duplicate, move, export, import, purge, permission_recalc}`, `state`, `progress` |
| `file` | F-02-05, 06, 09, 22 | `storage_key` + 참조카운트 / GC. **GC는 hard delete(3단계) 이후에만** |
| `text_content` (검색용 평문) | F-02-21 | 블록 JSON에서 추출해 페이지 행에 유지. 인덱스 행에 **권한 스코프 비정규화 필수** |
| `trash_entry` | F-02-11 | `(block_id, original_parent_id, original_position, original_space_id)` — 부모 소멸 시 복원 대비 |

### 2.2 정본이 반드시 반영해야 할 불변식

| # | 불변식 | 근거 |
|---|---|---|
| I1 | 블록은 parent를 **정확히 하나** 가진다(루트 제외) | Notion data-model 블로그 "single parent block ID (upward pointer)" |
| I2 | 권한은 content(하향)가 아니라 **parent 체인을 워크스페이스 루트까지 상향 순회**해 해석 | 동 출처 "traverses ancestors up to the workspace root" |
| I3 | 형제 순서 = fractional index. 삽입/이동 시 형제 일괄 갱신 없음. SQL 정렬은 **`collate('C')` 필수**(누락 시 실제로 정렬이 깨짐) | Docmost `generateJitteredKeyBetween` |
| I4 | 삭제·이동·복제·권한변경은 **서브트리 단위** 연산 | Notion help "all their sub-pages go with them" |
| I5 | `parent_id` 변경 시 **자기 자손으로 이동 금지**(사이클 방지) | `[추정]` UI에서 차단되나 문서 명시 없음 |
| I6 | `link_to_page` = 표시용 보조 엣지. 사이드바에 자식으로 보이지만 **대상의 실제 위치·권한은 불변** | Notion help 문구 확인 → `sidebar_alias` 모델 채택 |
| I7 | 삭제는 **2단계**: 휴지통 30d → purged 후 retention 30d → 완전 소멸 | Notion help 원문 확인 |
| I8 | 중첩 깊이에 **제품 상한 없음**("infinite levels of organization"). 재귀 쿼리 가드는 성능 목적(예: depth 100) | notion.com/help/manage-teamspaces |
| I9 | 한 페이지가 사이드바에 **여러 번** 나타날 수 있다(원위치 1 + alias N). 소유 parent는 여전히 1개 | I1 + I6의 귀결 `[추정]` |
| I10 | 권한 충돌 시 **가장 넓은 접근이 승리**("the broadest level of access given to a user") | notion.com/help/sharing-and-permissions |

### 2.3 정본 설계 경고 — "나중에 붙이면 전면 재작업" 4+1가지

1. **`workspace_id` 스코프** — `block`·`file`·`page_link`·`favorite`·검색인덱스 전부에 비정규화. 스코프 불일치는 403이 아니라 **404**로 응답(리소스 존재 자체 비노출).
2. **소유 엣지(`parent_id`) vs alias/참조 엣지(`sidebar_alias`, `page_link`) 분리** — 섞는 순간 **링크 삽입만으로 권한이 샌다**. 이 도메인 최대 위험.
3. **삭제 상태 머신 + `live_block` 뷰 강제** — 개별 쿼리에서 trashed 필터 누락이 이 기능의 1순위 버그. Postgres RLS 또는 ORM 글로벌 스코프로 강제.
4. **검색 인덱스의 권한 스코프 컬럼** — 애플리케이션 후처리 필터는 페이지네이션 개수를 깨뜨린다. 나중에 붙이면 인덱스 전면 재구축.
5. (+) **삭제 시 `parent_id`/`position`을 건드리지 않는다** → 원위치 복원이 공짜가 된다.

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립하지 않는 것

| F-ID | 근거 |
|---|---|
| F-02-17 (스코프만) | 워크스페이스 1개만 지원해도 `workspace_id` 컬럼·쿼리 규약은 1일차 필수. 후행 비용이 XL로 튄다 |
| F-02-01 | 도메인 전체가 여기서 파생 |
| F-02-02 | 트리가 없으면 "노션"이 아니다 |
| F-02-03 | 트리에 접근할 유일한 UI |
| F-02-08 | 트리를 만들면 재구성 수단이 반드시 필요 |
| F-02-11 | 삭제가 복구 불가능하면 사용자가 제품을 신뢰하지 않는다 |
| F-02-13 (서브페이지만) | 서브페이지 없이는 트리 자체가 성립 안 함 |
| F-02-15 | 무한 중첩에서 breadcrumb 없이는 사용자가 길을 잃는다 |
| F-02-16 | 링크 없이는 백링크·공유·멘션이 전부 불성립 |
| F-02-21 (제목검색 + Recents) | 트리가 깊어지면 탐색이 불가능해진다 |
| F-02-12 (축소판) | 권한은 모든 읽기/쓰기 경로를 관통. 나중에 얹으면 전면 재작업 |
| F-02-04 | 비용 S인데 네비게이션 체감이 커서 P0 |

### 3.2 빼도 되는 것 / 대체안

| F-ID | 무엇을 뺀다 | 대체안 |
|---|---|---|
| F-02-12 | teamspace 3종 접근유형, 게스트, 그룹, 공개링크, 권한 7단계 | **Private(개인 트리) + 단일 Workspace 공용 트리 2개**, 권한 3단계(`full_access/edit/view`). Outline의 Collection 모델 차용 = 권한 경계를 페이지가 아닌 **컨테이너 레벨**에. **도메인 최대 일정 절감 포인트** |
| F-02-01 | page-block 완전 통합 | `pages` + `blocks` 분리, `blocks.type='child_page'`가 `pages.id`를 FK 참조(Docmost 방식). 문단 사이 자유 드래그는 포기하되 라우팅·권한·트리 쿼리가 극적으로 단순 |
| F-02-11 | 2단계 retention, purge 배치 | 휴지통 1단계 + 무기한 보존, cron은 나중에. 단 **컬럼은 3상태로 미리** 만들 것 |
| F-02-03 | 가상 스크롤, 실시간 WebSocket | 전체 트리 일괄 로드(≤500 페이지 가정) + `dnd-kit` 드래그 + mutation 후 캐시 invalidate |
| F-02-08 | 크로스 워크스페이스 이동 | Export → Import로 대체. 같은 워크스페이스 내 이동만 |
| F-02-09 | 딥카피 + 첨부 매핑 + 링크 재매핑 | 단일 페이지 얕은 복제(자식 페이지 제외, 본문 블록만). 딥카피는 템플릿 도입 시점 |
| F-02-16 | 제목 slug, public_url | `/p/{uuid}` 단순 라우트 |
| F-02-21 | 전문 인덱스, CJK 토크나이저 | 제목 대상 trigram/ILIKE. `text_content` 컬럼만 처음부터 채워둠 |
| F-02-05 | 이미지 업로드, 내장 아이콘 세트 | 이모지 전용(`emoji-mart`, 값은 유니코드 문자열 1개) |
| F-02-06 | 전체 | 그라디언트/단색 프리셋 8~12종만(`cover_type='gradient'`), reposition 없음 |
| F-02-19 | delta 압축, 플랜별 기간 | 편집 세션 종료 시 전체 스냅샷 + 페이지당 최근 50개 보존 |
| F-02-20 | 전체 (v1에 side peek만) | full page만. **단 오버레이 라우팅 구조는 P0 시점에 열어둘 것**(나중에 갈아엎게 됨) |
| F-02-10 | "Unlock for me" | 잠금/해제 토글만. 서버 가드(403 `PAGE_LOCKED`)는 반드시 포함 |
| F-02-22 | PDF, import, zip | 단일 페이지 Markdown 클라이언트 생성 |
| F-02-23 | wiki 전환 자체 | 페이지 속성으로 `owner` + `최종 검토일`만 제공하고 사이드바/검색에 배지 노출. 만료 알림은 v2 |
| F-02-18 | 게스트, 웹 게시 | "워크스페이스 멤버에게 페이지 단위 view/edit 부여"만 |
| F-02-14 | 비공개 백링크 라벨 | 접근 가능한 것만 조회 |
| F-02-07 | (뺄 필요 없음) | 비용 S라 조기 투입 가능. 단 `COALESCE(page_view_pref, page_meta, ws_default)` 병합 규칙을 먼저 정의해 Q-A 결론을 흡수 |

### 3.3 단계 제안

- **MVP**: F-17(스코프) + F-01(분리형) + F-02 + F-03 + F-04 + F-11(1단계) + F-13(서브페이지만) + F-15 + F-16(단순 라우트) + F-21(제목검색+Recents) + F-12(2컨테이너/3레벨). F-08은 드래그 이동만.
- **v1**: F-05 아이콘, F-09 딥카피, F-13 @멘션, F-14 백링크, F-18 멤버 간 공유, F-19 스냅샷 히스토리, F-21 본문 전문검색, F-22 Markdown 내보내기.
- **v2**: F-06 커버, F-10 잠금, F-12 teamspace 3종·게스트, F-18 웹 게시, F-20 peek, F-22 PDF/import, F-23 wiki.

---

## 4. 기술 난제 & 권장 구현 접근 (L / XL)

| F-ID | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|
| **F-02-12 XL** | 권한이 모든 읽기/쓰기 경로를 관통. 상속 × 명시 오버라이드 × teamspace 멤버십 × 게스트 × 공개링크가 곱셈으로 증가. 오구현 시 전면 재작업 | 컨테이너 레벨을 1차 권한 경계로, 페이지 단위는 `permission` 예외행으로만. `effective_level`은 조상 순회 후 `max(candidates)`(I10). 성능은 **접근 가능한 root id 집합 캐시** 또는 `ancestor_ids` materialized path | **Outline** — Collection ≒ Teamspace, collection이 사용자·그룹에 권한을 부여하는 레벨 |
| **F-02-01 L** | 에디터 블록 모델과 라우팅 가능한 문서 모델을 같은 테이블로 통합해야 함. "본문 속 인라인 렌더"와 "독립 문서 렌더" 2경로 동시 필요 | MVP는 pages/blocks 분리 → 통합은 나중에 고려 | **Docmost**(분리형), **AFFiNE/BlockSuite**(통합형, 방식 `[확인필요]`) |
| **F-02-02 L** | 트리 자체는 M. 드래그드롭 + fractional index + 사이클 방지(I5) + 권한 재해석이 함께 얽힘 | 인접 리스트 + `fractional-indexing` npm. 조상은 재귀 CTE에 `depth < 100` 가드(가드 히트 시 에러 아닌 "경로 축약"으로 degrade — 권한/breadcrumb 실패로 페이지가 안 열리는 사고 방지). materialized path는 성능 문제 관측 후 | **Docmost** page tree |
| **F-02-03 L** | 실시간 동기화되는 드래그 가능 가상 트리는 UI 난이도 최상 | 서버 응답을 단일 진실로, 낙관적 업데이트는 롤백 경로 준비. 트리 API는 한 레벨씩(`GET /pages/tree?parent_id=&limit=50`), `icon/title/has_children`만 반환하고 **본문은 절대 싣지 않는다** | **Docmost** — react-arborist → v0.90.0(PR #2199) 자체 트리로 교체. issue #308 동기화 불일치 사례 |
| **F-02-08 L** | 단일 UPDATE로 안 끝남. 서브트리 `space_id` 전파 + 권한 재해석 + 크로스 워크스페이스 마이그레이션(첨부 재배치·멘션 재매핑) | 재귀 CTE로 서브트리 space 일괄 UPDATE. 대용량(수천~만 페이지)은 `job(kind='move')` 비동기 + 진행률 | Docmost move(space 내/space 간) |
| **F-02-09 L** | 딥카피 + old→new id 재매핑 + 첨부 처리 + 비동기 잡. 순환 링크 방어 필요 | **2패스**: (1) 서브트리 순회하며 블록 삽입 + `old_id→new_id` 맵 구축 (2) 내부 참조(`page_link`, mention rich text) 치환. **고정 규칙: 서브트리 내부 링크→사본으로 재매핑, 외부 링크→원본 유지**(원본 노션보다 나은 동작을 의도적으로 선택) | Docmost "deep-copying a page and its entire subtree, including attachment mapping" |
| **F-02-13 L** | 멘션 자동완성 + rich text 인라인 노드 모델 + 링크 파싱/역인덱스 + 권한 인지 렌더. **alias 그래프는 사이클 가능**(A↔B의 link_to_page → 사이드바 무한 전개) | 관계 3종(소유 / alias / 참조)을 절대 한 테이블에 섞지 않는다. 사이드바 쿼리 = `block(parent_id)` UNION `sidebar_alias(container_page_id)` + **경로상 방문 집합으로 alias 재전개 차단**(alias 노드는 한 번만 펼침) | — |
| **F-02-18 L** | 권한 모델 위에 게스트(부분 트리 사용자) + **비로그인 공개 렌더 경로**가 얹힘. 캐싱·SEO·권한 누출 별도 설계 | 게스트는 사이드바 루트가 "명시 권한을 받은 페이지 집합" → 트리 API에 별도 경로 필요. 공개 렌더는 `GET /public/{token|slug}`로 분리하고 **내부 조회 함수를 재사용하지 않는다**(권한 우회 사고 단골 원인) | — |
| **F-02-19 L** | 저장 전략·용량·**동시편집 중 복원**이 얽힘. 문서 상태를 우회해 DB를 직접 덮어쓰면 열린 세션과 **영구 분기**(최대 함정) | 복원을 "현재 문서에 대한 하나의 큰 편집"으로 취급해 CRDT/OT 파이프라인을 통과시킬 것. 저장은 (a) 서브트리 JSON 스냅샷(단순/용량 큼) vs (b) **Y.js update 로그 append + 주기 압축**(CRDT 채택 시 사실상 부산물). 트리거는 "편집 중 10분 주기 + idle 2분" | **Docmost** — 페이지 행에 `ydoc` 바이너리 직접 저장 |
| **F-02-21 L** | "검색창 하나"로 보이지만 권한 인지 인덱스 + 권한변경 시 재인덱싱 잡 + **CJK 토크나이징**. 이 도메인에서 가장 과소평가되는 항목 | 인덱스 행에 `space_id`·명시 권한 대상 집합을 비정규화해 **질의 단계에서** 필터(후처리 필터는 페이지네이션이 깨짐). 권한/이동 시 `job(kind='permission_recalc')`로 서브트리 재인덱싱 + 조회 시점 권한 재확인 이중 방어. **한국어는 `pg_bigm`/`pgroonga`** (기본 `to_tsvector('simple')`은 CJK를 못 쪼갬 — 한국어 클론에서는 이 결정이 검색 품질을 좌우) | **Docmost** `textContent` 컬럼 분리 |
| F-02-11 (M→L) | 서브트리 전파 + 원위치 복원 + 조회 필터 누락 방지 + 2단계 retention 상태머신 + purge 배치. 첨부 GC·teamspace별 휴지통 스코프 포함 시 L | `live_block` 뷰 + RLS 강제. 서브트리 삭제는 **전파 + `deleted_root_id` 병기** 권장(쓰기 O(n)/읽기 O(1)) `[추정]`. **첨부 GC는 `MAX(버전 보존기간, purge retention)` 이후에만** — ②단계에서 스토리지를 지우면 과거 버전이 깨진다 | Docmost soft delete 2단계 |
| F-02-22 (M~L) | 서브트리 zip + 링크 재매핑(F-09과 동일 문제) + PDF 헤드리스 브라우저 렌더 인프라 | **F-09과 서브트리 순회기·id 재매핑 코드를 공유**. 산출물은 서명 URL + 짧은 만료(zip에는 권한 필터를 재적용할 수 없다). 파일명은 `제목-{shortid}`로 유일화(제목 중복은 매우 흔함) | — |

### 채택 권고 (원본 종합)

1. **트리 저장** = 인접 리스트(`parent_id`) + fractional index(`position`) + `collate('C')`. materialized path는 나중에.
2. **권한 경계** = 컨테이너(space/teamspace) 레벨 1차(Outline 방식), 페이지 단위는 `permission` 예외행으로만.
3. **삭제** = 반드시 soft delete, `parent_id`/`position` 불변.
4. **검색** = 블록 JSON에서 추출한 `text_content` 평문 컬럼을 페이지 행에 유지(Docmost 방식).
5. **실시간** = 사이드바 트리 변경은 WebSocket 브로드캐스트. MVP는 mutation 후 invalidate로 대체 가능.

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 주의 |
|---|---|---|
| **01 블록 에디터** | F-02-01(page = block), F-02-13(rich text mention 노드 모델), F-02-19(CRDT 파이프라인 위에 히스토리) | 페이지-블록 통합 여부는 D01/D02 **공통 결정**. `properties.title`이 rich text 배열이어야 제목에 멘션·서식이 들어간다 |
| **03 데이터베이스** | F-02-23 wiki 홈 = 데이터베이스 뷰 재사용, database row = page 모델(AppFlowy도 동일) | wiki 전환이 하위를 db row로 바꾸는지 `[확인필요]`(Q-C) — D03와 함께 검증해야 함 |
| **04 데이터베이스 뷰** | F-02-20 peek 기본값은 **db_view 단위 설정**(`open_pages_as`). Table/Board/List/Timeline은 side peek 기본 | 이 도메인의 영속 데이터는 뷰 설정 1개뿐, 나머지는 라우팅 상태 |
| **05 협업/동기화** | F-02-03 트리 변경 WebSocket, F-02-19 동시편집 중 복원, F-02-18 권한 변경 시 **구독 즉시 해제**, 삭제된 페이지를 연 세션은 `410 GONE` | 권한 변경 브로드캐스트가 없으면 공유 해제 후에도 편집이 계속된다 |
| **06 권한/공유** | F-02-12, F-02-18 전체가 사실상 중복 — **정본 소유권을 D06으로 넘기고 여기서는 트리 상속 규칙(I2, I10)만 유지** | 중복 스펙 충돌 위험 최상. 마스터 문서에서 반드시 정리 |
| **07 검색/네비게이션** | F-02-21 전체, F-02-03 Recents 섹션, F-02-15 breadcrumb | 검색 인덱스 권한 스코프 결정 주체를 D07로 통일 |
| **08 템플릿/자동화** | F-02-09 딥카피가 템플릿의 기반. 링크 재매핑 규칙(Q-B)이 템플릿 실용성을 좌우 | |
| **09 API** | `child_page` 직접 생성 불가, `link_to_page` 업데이트 미지원, `in_trash`(구 `archived` deprecated), 요청당 2단계 중첩 제약 `[확인필요]` | |
| **11 히스토리/알림** | F-02-19 버전 히스토리, F-02-23 검증 만료 Inbox·이메일 알림 | |
| **12 플랫폼/UX** | F-02-03 사이드바 3.4 4탭, F-02-20 오버레이 라우팅(Next.js parallel/intercepting routes 또는 `peekId` 쿼리), 모바일 분기 | |
| **14 인증/계정** | F-02-17 workspace_member 역할 4종, 계정 deprovision 시 Private 콘텐츠 이관 절차 | |
| **17 운영/거버넌스** | F-02-11 retention 커스터마이즈(Ent 1일~10년), F-02-19 플랜별 기간, F-02-18 공개공유 워크스페이스 차원 비활성화 | 플랜 게이팅 기준이 **계정이 아니라 워크스페이스** |

---

## 6. 최우선 미해결 질문 (5개)

| # | 질문 | 왜 최우선인가 | 확인 방법 / 잠정 결정 |
|---|---|---|---|
| **Q-A** (원 Q6) | `font`/`small_text`/`full_width`가 페이지 공통 속성인가 열람자별 설정인가 — 2026-09 헬프 재확인에도 **어느 쪽도 명시 없음**(확인된 건 "전 페이지 기본값 설정 기능은 없다"뿐) | 스키마 배치가 달라짐 | 두 계정으로 같은 페이지를 동시에 열고 한쪽에서 Full width 토글 후 상대 화면 관찰. **잠정: `COALESCE(page_view_pref, page_meta, ws_default)` 병합 규칙으로 양쪽 흡수** — 테이블만 만들고 UI는 나중에 |
| **Q-B** (원 Q3) | 복제 시 서브트리 **내부** 상호 링크가 사본으로 재매핑되는가 — 공식 헬프에 복제 문서 자체가 없고, 2차 출처는 "범위 밖 멘션은 원본 유지"만 일치 | 템플릿 기능의 실용성이 여기서 갈림 | A→B 링크가 있는 트리를 복제해 A'의 링크가 B인지 B'인지 확인. **잠정 결정: 클론은 재매핑을 기본 채택**(우세 가설상 노션은 재매핑하지 않으나, 의도적으로 더 나은 동작 선택) |
| **Q-C** (원 Q16) | "Turn into wiki"가 하위 페이지를 database row로 바꾸는가, 되돌릴 수 있는가 | F-02-23 ↔ D03 접점 설계. 되돌릴 때 트리 구조 복원이 필요한지 결정 | 서브페이지가 있는 페이지를 wiki 전환 후 자식의 URL·parent 변화 관찰 |
| **Q-D** (원 Q7+Q17+Q15) | 정보 유출 정책 3종: ① 권한 없는 백링크의 **건수**가 노출되는가 ② 게시(Publish)된 페이지의 하위가 함께 공개되는가 ③ 검색 권한 필터의 공식 근거 문장이 존재하는가 | 셋 다 "건수/존재만으로 정보가 새는" 경계. 정책 미결정 시 구현마다 달라짐 | 권한 없는 계정으로 백링크 영역 관찰 / 서브페이지 있는 페이지 게시 후 로그아웃 상태로 자식 URL 접근 / 헬프 search 문서·보안 백서 확인 |
| **Q-E** (원 Q4+Q5+Q11) | 삭제 정합성 3종: ① 부모가 영구 삭제된 자식의 복원 위치 ② 휴지통 스코프가 teamspace별로 분리되는가(2차 출처만 일치, 공식 명시 없음) ③ Teamspace 삭제 시 하위 페이지 처리 정책 | F-02-11의 복원 UX와 데이터 유실 방지에 직결 | 부모 영구삭제 후 자식 복원 시도 / 두 계정·두 teamspace로 삭제 후 각 Trash 패널 비교 / Teamspace 삭제 플로우 확인 |

> **잔여 질문(우선순위 낮음)**: Q8 잠긴 페이지가 이동·삭제·레이아웃 변경까지 막는가 / Q9 이동 시 URL(id) 불변, 워크스페이스 간 이동 시 URL 처리 / Q10 AFFiNE·BlockSuite의 페이지-블록 트리 통합 방식 / Q12 Shared가 저장 컨테이너인지 파생 뷰인지(**파생 뷰 가설 우세**) / Q13 Notion 3.4 사이드바 전면 롤아웃 여부(릴리스 노트가 "opt-in to try it out") / Q14 버전 스냅샷 범위가 페이지 본문인가 서브트리인가 / Q18 link_to_page가 백링크로도 집계되는가.

---

## 7. 마스터가 되풀이하면 안 되는 정정 사항

- **휴지통**: "30일 후 소멸"이 아니라 **2단계**(휴지통 30d → purged 후 30d → 소멸, Ent 1일~10년 커스텀).
- **F-02-09 출처**: `help/duplicate-delete-and-restore-content`는 현재 "Delete & restore content"이며 **복제 설명이 없다**. 복제 서술은 전부 2차 출처·관찰 기반.
- **커버 타입**: API File object `type` = `external` 또는 **`file_upload`** (과거 `file` 표기 폐기).
- **버전 히스토리**: Free 7d / Plus·Business **30d** / Ent 무제한. "Business 90일"은 미확인 `[확인필요]`.
- **F-02-07**: "페이지 속성이라 모든 열람자에게 동일"은 근거 없음 → **철회**, Q-A로 이관.
- **사이드바 기준**: **2026-03-26 Notion 3.4의 4탭 구조**(Home / Chats / Meetings / Inbox)가 정본. Favorites·Teamspaces·Shared·Private는 Home 탭 내부 섹션.

---

## 8. 핵심 출처 (원본 38개 중 판단 근거가 되는 것)

- https://www.notion.com/blog/data-model-behind-notion — I1, I2의 유일한 1차 근거
- https://www.notion.com/help/sharing-and-permissions — 권한 레벨, 서브페이지 상속, "broadest level of access"(I10)
- https://www.notion.com/help/duplicate-delete-and-restore-content — 2단계 retention 원문(I7)
- https://www.notion.com/help/create-links-and-backlinks — mention vs link_to_page 차이(I6), 백링크 자동 생성·권한 필터
- https://www.notion.com/help/manage-teamspaces — "infinite levels of organization"(I8)
- https://www.notion.com/help/intro-to-teamspaces — Open/Closed/Private 3종, owner/member 역할
- https://www.notion.com/releases/2026-03-26 — Notion 3.4 사이드바 4탭 재편
- https://developers.notion.com/reference/page , /reference/block , /reference/trash-page — API 스키마 정본
- https://deepwiki.com/docmost/docmost/4-page-management — 실무 참고 1순위(fractional index, textContent, ydoc, 딥카피+attachment mapping)
- https://github.com/docmost/docmost/releases/tag/v0.90.0 , /issues/308 — 트리 UI 난이도 실증
- https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV — 컨테이너 레벨 권한 경계(MVP 축소 근거)
