# 01. 블록 에디터 코어 — SYNTHESIS 다이제스트

> 원본: `docs/research/01-block-editor.md` (1367줄, 22기능, DOMAIN→GAP 2회 완료)
> 기준 API 버전 **2026-03-11**. 스키마 정본은 `00-canonical-data-model.md` 참조 — 아래 "데이터 모델"은 **이 도메인이 요구하는 것**만 적었고 새 스키마를 창작하지 않았다.
> 태그: `[추정]` = 근거 없는 추론, `[확인필요]` = 실측 필요

---

## 1. 기능 인벤토리 (전수 22개 — 원본 `### F-` 카운트 22와 일치)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-01-01 | 블록 트리 데이터 모델 (렌더 트리/권한 트리 분리) | XL | P0 | — (도메인 루트) |
| F-01-02 | 블록 타입 레지스트리 (문서화 타입 35종) | XL (MVP 12종=L) | P0 | 01 |
| F-01-03 | rich text 인라인 서식 (볼드/링크/컬러/코드/수식/멘션) | L | P0(기본서식)/P1(color·mention·인라인수식)/P2(밑줄) | 01, 02 |
| F-01-04 | 슬래시(/) 커맨드 메뉴 | M | P0 | 02, 06 |
| F-01-05 | 마크다운 단축 입력 (블록/인라인) | M | P0 | 02, 06 |
| F-01-06 | 블록 타입 변환 (Turn into) | M | P0 | 01, 02, 09 |
| F-01-07 | 중첩 (들여쓰기/내어쓰기, Tab/Shift+Tab) | M | P0 | 01, 02 |
| F-01-08 | 드래그 앤 드롭 재정렬 + 블록 핸들 메뉴 | L | P0(상하이동)/P1(컬럼드롭·Move to) | 01, 09 |
| F-01-09 | 멀티 블록 선택 및 일괄 조작 | L | P0(연속)/P1(비연속·Cmd+A확장) | 01, 06, 08 |
| F-01-10 | 복사/붙여넣기 시 구조 보존 | L | P0(내부)/P1(HTML·MD)/P2(URL형태선택) | 01, 03, 09 |
| F-01-11 | Synced Block (동기화 블록) | XL | P1 | 01, 06, 10 |
| F-01-12 | 컬럼 레이아웃 (column_list/column) | L | P1 | 01, 02, 08 |
| F-01-13 | 접기/펼치기 컨테이너 (toggle, toggle heading, callout) | M | P0(toggle)/P1(toggle heading) | 01, 02, 07, 08, 22 |
| F-01-14 | 코드 블록 | M | P0 | 02, 04, 05, 10, 19 |
| F-01-15 | 미디어·파일·북마크·임베드 블록 | L~XL | P0(image)/P1(file·bookmark·video)/P2(embed·pdf·audio) | 02 + 스토리지 인프라 |
| F-01-16 | 자동 파생 블록 (목차/breadcrumb/divider) | S(divider)/M(목차·breadcrumb) | P0(divider)/P1(목차)/P2(breadcrumb) | 02, 페이지 계층(02 도메인) |
| F-01-17 | 편집 트랜잭션 · Undo/Redo · 동시편집 충돌 처리 | XL | P0(트랜잭션+로컬undo)/P1(실시간·텍스트병합) | 01 |
| F-01-18 | 심플 테이블 (table/table_row/셀 병합) | L (병합 포함 XL) | P1 / P2(병합) | 01, 02, 03, 09, 17 |
| F-01-19 | 캐럿 이동 · 블록 분할 · 블록 병합 | L (라이브러리 미사용 시 XL) | **P0** | 01, 02, 03, 13, 14, 17 |
| F-01-20 | 수식 (인라인 equation / 블록 equation) | M | P1 | 02, 03, 04, 05, 06, 19 |
| F-01-21 | 블록 레벨 색상 (block color / 하이라이트) | S~M | P1 (스키마 자리는 P0) | 02, 03, 04, 06, 09 |
| F-01-22 | 대용량 페이지 렌더링 · 클라이언트 캐시 · 부분 로드 | L~XL | P1 (API 계약·`page_id`는 P0) | 01, 03, 13, 17 |

**행 수 22 = `grep -c "^### F-"` 결과 22. 일치 확인.**

---

## 2. 이 도메인이 데이터 모델에 요구하는 것

### 2.1 `block` (단일 테이블 — 모든 콘텐츠. page도 block의 한 type)
| 요구 필드 | 이유 (근거 기능) |
|---|---|
| `id` UUID v4, **클라이언트 생성** | 낙관적 업데이트/오프라인 (F-01-01, 17) |
| `type` | 렌더 방식 + `properties` 해석 결정. 공식 블로그 명시 5속성 중 하나 |
| `properties` JSONB | `title: RichText[]`, `checked`, `language`, `expression`, `cells`, `table_width`, `synced_from` 등 타입별 (F-01-02) |
| `format` JSONB | `block_color`, `code_wrap`, `width_ratio`, `merges`, `icon` 등 **표현 계층** (F-01-21, 12, 14, 18) |
| `parent_id` + `parent_table`('block'\|'space'\|'collection') | **권한 상속 전용 상향 포인터, 항상 1개** (공식 블로그) |
| `order_key` TEXT (fractional index) | 형제 정렬. 배열 `content[]` 대비 이동 시 1행만 갱신 (F-01-01, 07, 08) |
| `page_id` (비정규화) | **커서 기반 부분 로드에 사실상 강제**. 재귀 CTE로는 페이징 불가 (F-01-22) |
| `is_alive` (soft delete) | 휴지통/undo (F-01-01) `[추정]` |
| `version` BIGINT | 낙관적 동시성 제어 (F-01-17) |
| 인덱스 | `(parent_id, order_key) WHERE is_alive`, `(page_id, order_key)`, `((properties->>'synced_from')) WHERE type='synced_block'` |

**서버가 강제해야 할 불변식**: ① 살아있는 블록은 살아있는 부모를 갖는다(고아 금지) ② `parent_id` 체인 무사이클 ③ 같은 부모 내 `order_key` 유일 ④ 부모-자식 타입 제약(`column`은 `column_list` 아래만, `table_row`는 `table` 아래만) ⑤ `table_row.cells.length === table.table_width` ⑥ `table.format.merges` 영역 무겹침·범위 내.

### 2.2 부속 엔티티 (이 도메인이 요구)
| 엔티티 | 필요 이유 |
|---|---|
| `operation(tx_id, actor_id, block_id, op, path[], args, created_at)` | 조작 원자 단위. **undo 단위 = 트랜잭션**. 실시간 동기화·감사 로그 기반 (F-01-17) |
| `block_mention(source_block_id, source_page_id, target_type, target_id)` | backlink 역인덱스. rich text JSONB 스캔은 확장 불가. **저장 훅에서 전량 재작성**(부분 갱신은 동시편집에서 어긋남) (F-01-03) |
| `block.search_text` / tsvector | `plain_text` 파생. 접힌·미로드 subtree도 검색되려면 **서버 인덱스가 유일한 해법** (F-01-03 ↔ 13 ↔ 22) |
| `file(id, workspace_id, storage_key, mime, size, ref_count, ...)` | 파일 참조 카운트 기반 GC, 만료 서명 URL 재발급 (F-01-15) |
| `link_metadata(url_hash, title, description, image_url, fetched_at)` | 북마크 OG 캐시 `[추정]` (F-01-15) |
| `user_block_state(user_id, block_id, collapsed)` | 접힘 상태는 **문서 데이터가 아니라 뷰어별**이어야 함. MVP는 localStorage 대체 (F-01-13) |
| `equation_render_cache(expression_hash, katex_version, html)` | **분리 필수** — 렌더 결과를 블록에 저장하면 KaTeX 업그레이드 시 전면 마이그레이션 (F-01-20) |
| 클라이언트 캐시: `cached_block`, `cached_page(version, fully_loaded)`, `pending_tx` | `pending_tx`는 **캐시가 아니라 데이터** — LRU 축출 대상에서 제외 (F-01-22) |

### 2.3 값 모델 계약 (공개 API 유래 — 클론 검증 규칙의 출발점)
- `RichText = { type: 'text'|'mention'|'equation', annotations{bold,italic,strikethrough,underline,code,color}, plain_text(파생), href, text?/equation?/mention? }`
- `color` enum **19개**: `default` + 텍스트 9 + `*_background` 9 (`default_background` 없음, 1차출처 2곳 재확인). **하나의 필드가 글자색·배경색을 겸하므로 동시 지정 불가**. 인라인 색과 `format.block_color`가 **같은 enum 도메인 공유**. HEX 절대 저장 금지(다크모드).
- mention 타입 6종: `user` `page` `database` `date` `link_preview` `template_mention` (`custom_emoji`는 열거에 없음 `[확인필요]`).
- 상한: `text.content` 2000자 / URL 2000자 / `equation.expression` 1000자 / rich text 배열 100요소 / children 배열 100요소 / **요청당 중첩 2단계** / 1요청 1000블록·500KB / rate limit 평균 3req/s.
- **중첩 2단계 제한은 공개 API 제약**이다 → 클론은 **임의 깊이 subtree를 단일 트랜잭션으로 받는 내부 API**를 따로 두고, 공개 호환 레이어에서만 2단계를 흉내낸다.
- 삽입 위치 계약: `position = end(기본)|start|after_block`. **order_key는 서버가 계산**해야 동시 삽입 충돌 판정 가능.
- 정규화 규칙(저장 훅): 인접 동일 annotation span 병합 / 빈 span 제거 / `plain_text` 재계산 / mention·inline equation은 **원자 단위**(오프셋 스냅).

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 하는 것 (P0 최소 집합)
| 기능 | 근거 |
|---|---|
| F-01-01 트리 모델 | 나머지 21개 전부가 종속. 되돌리는 비용이 최대 |
| F-01-02(12종) | paragraph, h1~h3, bulleted/numbered/to_do, toggle, quote, callout, code, divider, image. `unsupported` 폴백은 **MVP부터** 넣어 라운드트립 손실 방지 |
| F-01-03 기본 서식 | bold/italic/strike/code/link. 이게 없으면 메모장 |
| F-01-19 분할·병합 | **Enter/Backspace가 없으면 에디터가 아니다.** GAP 2회차에서 P0로 승격 |
| F-01-04 /커맨드, F-01-05 마크다운 | 노션 편집 흐름의 주 진입점 — 없으면 "노션 클론"이라 부를 수 없음 |
| F-01-06 Turn into, F-01-07 중첩 | 블록 모델의 존재 이유를 사용자에게 노출하는 두 조작 |
| F-01-08(상하 이동), F-01-09(연속 선택), F-01-10(내부 복붙) | 문서 편집의 기본 조작 |
| F-01-13(toggle), F-01-14(code), F-01-15(image), F-01-16(divider) | 최소 콘텐츠 표현력 |
| F-01-17(트랜잭션 + 로컬 undo) | undo 없는 에디터는 사용 불가. 실시간은 P1이어도 **트랜잭션 경계는 P0** |

### 3.2 빼도 되는 것과 대체안
| 뺄 것 | 이유 | 대체안 |
|---|---|---|
| F-01-11 Synced block | MVP 없이 동작. 단 노션 차별성의 핵심 | v1은 **읽기 전용 transclusion**(사본은 렌더만, 편집은 원본 페이지에서). 양방향은 v2 |
| F-01-12 컬럼 | 드롭존 판정이 비쌈 | `/2 columns` `/3 columns` 명시 생성 + 프리셋 폭(50/50, 33/67). 자유 리사이즈 v2. 모바일은 무조건 세로 스택(노션 동일) |
| F-01-18 심플 테이블 | 없어도 문서는 성립 | MVP는 **병합 없는 고정 격자** + 단일 셀 선택. Tiptap `extension-table` 채택 이득이 가장 큰 기능(단 `cells` 직렬화 어댑터 필요) |
| F-01-20 수식 | 필수 아님. 다만 KaTeX는 **가성비 높은 P1** | v1은 **블록 수식만**. 인라인은 rich text에 `type:'equation'` 자리만 예약. mhchem 지연 로드 |
| F-01-21 블록 색상 | 편집 성립에 불필요 | 19색 → **6색+배경 6색**, CSS 변수로 다크모드. **단 `format.block_color` 자리와 enum은 P0에 스키마 확정** |
| F-01-22 부분 로드 최적화 | 실제로 느려지기 전엔 불필요 | **페이지당 블록 상한 2,000 + 전량 로드**. 단 ① API가 처음부터 커서 파라미터 수용 ② `page_id` 컬럼 존재 ③ `content-visibility: auto`를 가상 스크롤보다 먼저 |
| F-01-02의 23종 | 타입당 렌더러+UI+검증+turn-into+내보내기 5종 세트 | `unsupported` 폴백으로 **저장만 하고 회색 박스 렌더**. 원본 JSON 보존 |
| F-01-09 비연속 선택 | 별도 로직 | MVP는 anchor/head 인덱스 2개(연속 범위)만. Firefox 블록 간 부분선택은 **노션조차 4년간 미해결**이라 동일 제약 감수 가능 |
| F-01-16 breadcrumb | 권한 도메인과 결합 | P2로 이월 |

### 3.3 **P0에 넣지 않지만 P0 시점에 반드시 결정해야 하는 것** (사후 변경 비용 = 재작성)
| 결정 | 관련 | 미루면 |
|---|---|---|
| 동기화 스택 (Yjs vs 자체 OT vs LWW) | F-01-17 | 저장 포맷·undo가 묶여 있어 교체 = 재작성 |
| 자식 순서 표현 (`content[]` vs `order_key`) | F-01-01 | 동시 삽입 충돌 처리 + 부분 로드 커서가 여기서 파생 |
| `page_id` 비정규화 컬럼 | F-01-01, 22 | 커서 기반 부분 로드 불가 |
| `format.block_color` 자리 + 색상 enum | F-01-21 | 전 블록 마이그레이션 |
| 표 셀의 동시편집 단위 (행 JSONB vs 셀 단위) | F-01-18, 17 | 행 단위면 표에서 상대 입력이 통째로 유실 |
| 커스텀 클립보드 MIME + subtree 직렬화 포맷 | F-01-10 | 포맷 변경 시 이전 버전 클립보드 파손 |
| 내보내기/가져오기 문법 = **Notion-flavored enhanced markdown 채택 여부** | F-01-02, 10, 18, 21 | 사양을 새로 발명하게 되고 노션 상호이전이 사라짐 |

### 3.4 권장 빌드 순서
01 → 02 → 03 → **19** → 07/13 → 06 → 04/05 → 09 → 08 → 10 → 14/15 → 21 → 17(실시간) → 12/18 → 20 → 16 → 22 → 11

---

## 4. 기술 난제 (L/XL) & 권장 구현 접근

| F-ID | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|
| **F-01-01** XL | 트리 CRUD + 순서키 + soft delete + 렌더/권한 이중 관계 + 트랜잭션 로그를 **한 번에** 확정해야 함 | MVP는 `parent_id + order_key` 단일 방식, 권한 트리는 `parent_id` 재사용. **렌더/권한 분리는 synced block 도입 시점에만 실제 구현**. fractional index 채택 | Figma fractional indexing 블로그, Liveblocks |
| **F-01-02** XL | 35종 × (렌더러+편집UI+검증스키마+turn-into매핑+내보내기규칙) | MVP 12종 + `unsupported` 폴백 + **플러그인 레지스트리**(항목 등록만으로 타입 추가) | **BlockSuite `defineBlockSchema`** — `role`(root/hub/content) + `children` glob 제약이 column_list/column, table/table_row 제약을 그대로 표현. `metadata.version`으로 마이그레이션 경로 |
| **F-01-03** L | span 분할/병합 + selection↔모델 오프셋 매핑 + **한글 IME 조합 중 selection 보존** + backlink 역인덱스·권한 필터 | ProseMirror/Tiptap **mark 시스템** → 저장 시 노션형 `RichText[]` 직렬화(span 병합 자동) | Tiptap, BlockNote |
| **F-01-08 / 09 / 12** L | 드롭존 히트테스트(특히 컬럼 생성 판정)·중첩 트리 좌표 / top-level normalization(부모+자식 동시선택 시 최상위만)·비연속 선택·텍스트↔블록 2모드 / 컨테이너 자동 생성·해체(자식 0~1개)·반응형 붕괴 | dnd-kit 또는 드래그핸들 내장 BlockNote. MVP는 연속 범위 선택(anchor/head 2개)·`/columns` 명시 생성·프리셋 폭. 컨테이너 자동정리는 트랜잭션 후처리 훅 | BlockNote, dnd-kit |
| **F-01-10** L | HTML→블록 파서(외부 사이트마다 마크업 제각각) | 직접 파서 금지 → **turndown(HTML→MD) + remark(MD→AST) 2단계**. `text/plain`은 **enhanced markdown 문법**으로 맞춰 노션 상호 붙여넣기 무손실화. 커스텀 MIME으로 내부 라운드트립 우선 완성(모든 블록에 **새 UUID 재발급**, ID 리매핑 테이블로 `synced_from`/자식참조 치환) | turndown, remark |
| **F-01-11** XL | 참조 렌더 + **원본 기준 권한 평가**(렌더/권한 트리 분리가 성립 조건) + 순환 방지(조상체인 검사) + 역인덱스("N other pages") + 다중 위치 실시간 반영. 공식: **사본 >10인 원본 삭제 시 전부 삭제·undo 불가** | v1 읽기 전용 transclusion. 삭제 전 경고 모달 필수 | — |
| **F-01-15** L~XL | **독립 서브시스템 5개**: ①청크/재개 업로드 ②오브젝트 스토리지 + 만료 서명 URL 재발급(캐시·CDN·내보내기 각각) ③OG 크롤러 ④임베드 보안 ⑤파일 ref_count·GC. **②③④는 보안 사고 시 되돌릴 수 없음** | S3 호환 + presigned PUT. **OG 크롤러는 SSRF 교과서적 진입점** → 별도 마이크로서비스 + 아웃바운드 프록시 + 내부망 IP(169.254.169.254, 10/8, localhost) 차단 + 리다이렉트 체인·DNS rebinding 방어. 임베드는 **화이트리스트**(YouTube/Figma/CodeSandbox) + `sandbox`. 파일은 **별도 도메인 서빙(XSS 격리)** + `Content-Disposition: attachment` | — |
| **F-01-17** XL | **프로젝트 전체 최난도이자 최대 과소평가 항목.** 흔한 착각 3: ①"WebSocket diff 브로드캐스트면 충분" → 오프셋 해석 차이로 문자 유실 ②"LWW로 충분" → 타이핑 중 상대 입력 통째 덮어씀 ③"나중에 CRDT로 교체" → 저장포맷·undo가 묶여 **교체 = 재작성**. **노션의 실제 병합 알고리즘은 1차 출처로 확인 불가**(반증 조사 완료: 블로그·기술색인·헬프 모두 없음) → "노션은 CRDT를 쓴다"는 **인용 금지** | **Yjs 채택.** `Y.Map`(props) + `Y.Text`(텍스트) + `Y.Array`/fractional index(순서). 블록 단위 분리 덕에 "블록 간 = 자동 병합 / 블록 내 = CRDT" **2층 구조**가 자연스럽다. 저장은 **Yjs 바이너리 + 관계형 파생 뷰 이중** — F-01-01 스키마 확정 **전에** 결정 | BlockSuite/AFFiNE(y-octo), Tiptap+Yjs, BlockNote |
| **F-01-18** L(병합시 XL) | ①열 개수 변경이 전 행을 건드리는 원자 연산(`table_width`는 **생성 시에만 설정 가능**) ②셀 사각범위 선택 = **세 번째 선택 모드** ③병합/해제 ↔ 행·열 삭제 상호작용 ④외부 표 붙여넣기 ⑤무손실/호환 2트랙 내보내기(GFM은 병합 표현 불가) | 병합은 셀별 rowspan이 아니라 **`table.format.merges`에 사각영역 목록** → 불변식 검증이 쉬움 `[추정]`. 셀 텍스트 동시편집 단위는 **셀 단위**로 | `@tiptap/extension-table` |
| **F-01-19** L(라이브러리 미사용 시 XL) | ①DOM selection ↔ 모델 오프셋 양방향 매핑 ②rich text span 분할/정규화 ③**자식 귀속 규칙(자식이 사라지는 것이 최빈 버그)** ④타입별 예외(code/table/리스트 탈출) ⑤IME(`isComposing` 필수, OS별 keydown 순서 상이) ⑥CRDT 위치 유실. **버그 밀도 최고** | **직접 구현하지 않는다.** ProseMirror `splitBlock`/`joinBackward` + selection 매핑을 그대로 쓰고 노션식 예외만 커맨드 오버라이드. 분할 규칙 권장: 새 블록 type은 원본 계승하되 heading/quote/callout은 paragraph, 자식은 원본에 남김, `checked=false`·색상 상속. 병합 규칙: **앞 블록 타입이 이김**, 뒤 블록 자식은 앞 블록 자식 끝으로 이관, 앞이 divider/image면 병합 대신 **앞 블록 선택 상태 전환**. **분할·병합은 트랜잭션 1개 = undo 1회** | ProseMirror, Tiptap, BlockNote |
| **F-01-22** L~XL | 기능이 아니라 **아키텍처 제약** — 사후 도입 비용이 큼. ④"부분 로드 상태에서의 검색·undo·인쇄 정합성"이 **다른 5개 기능의 동작 정의를 바꾼다**. 노션조차 전담 성능팀 + 브라우저 DB 손상 사고 경험 | 노션 1차 출처 확인 사실: **`loadPageChunk`**(시작점에서 트리 하강, 커서 반복 호출) + **"dependent records" 동봉**(멘션 대상 제목·유저·파일 메타) → 클론 응답도 `{blocks, dependencies:{pages,users,files}, next_cursor, page_version}`. 안 그러면 **블록당 N+1 왕복**. 클라이언트: 메모리+IndexedDB로 시작, WASM SQLite+OPFS는 실제로 느려진 뒤. **멀티탭은 SharedWorker 단일 쓰기탭 + Web Locks 페일오버**(없이 쓰면 노션도 DB 손상). 가상 스크롤보다 **`content-visibility: auto` + `contain-intrinsic-size`** 우선(캐럿·선택·Ctrl+F를 깨지 않음) `[추정]`. 검색은 **서버 인덱스**로(접힌/미로드 subtree 때문) | Notion 엔지니어링 블로그 2건 |

### 권장 스택 조합 (원본 결론)
1. 렌더/입력 레이어: **ProseMirror 계열(BlockNote 또는 Tiptap 직접)** — 슬래시메뉴·inputRules·드래그핸들·selection을 직접 만들지 않는다.
2. 동기화/충돌: **Yjs**.
3. 스키마 정의: **BlockSuite식 선언적 레지스트리**(flavour/role/children/version) 자체 구현.
4. 영속화: Yjs update 바이너리 + 관계형 파생 `block` 테이블 **이중 저장**(검색·권한·공개 API는 관계형 뷰에서).

> **최대 아키텍처 리스크 `[추정]`**: ProseMirror는 "블록 배열"이 아니라 **하나의 문서 트리**를 다룬다. "페이지 = 1개 ProseMirror 문서" 전제는 **F-01-11(synced block)과 블록 단위 권한/코멘트에서 깨진다.** 이 간극(참조 노드로 별도 문서를 렌더할지 등)의 해소 방안이 전체 설계에서 가장 큰 미결 리스크.

---

## 5. 다른 도메인과의 접점

| 접점 | 내용 |
|---|---|
| **00 정본 데이터 모델** | `block` 단일 테이블·`operation` 로그·`order_key`·`page_id` 비정규화·`is_alive`·`version`은 이 도메인이 요구하는 정본 요소. **여기서 창작하지 말고 00에서 확정** |
| **02 페이지/워크스페이스** | `child_page`/`child_database`도 블록의 한 type. `parent_table='space'`. breadcrumb(F-01-16)는 조상 경로 조회 필요. `Turn into Page`(F-01-06)는 블록→페이지 승격 + 위치 선택 |
| **03/04 데이터베이스** | 심플 테이블 ↔ 데이터베이스 **경계 정의가 필수**(F-01-18). 심플 테이블이 못 하는 것: 행을 페이지로 열기, property, relation, formula/rollup, 다중 뷰, 통합. `Turn into database` 변환 규칙은 `[확인필요]` |
| **05 협업/동기화** | F-01-17이 사실상 05의 선행 결정. presence 채널: `{userId, selectedBlockIds[]}`(F-01-09), `{userId, blockId, offset}`(F-01-19 — offset은 **문자 인덱스가 아니라 CRDT relative position**) |
| **06 권한/공유** | 권한 트리 = `parent_id` 체인. 필수 규칙: ①권한 없는 subtree는 **존재 사실도 숨김**(F-01-01) ②mention 대상 무권한 시 **제목 유출 금지**(F-01-03) ③backlink 목록 권한 필터(노션은 `Private`으로 라벨) ④synced block은 **원본 기준 권한 평가**(F-01-11) ⑤breadcrumb 조상 권한 필터 ⑥부분 로드 커서는 **서버가 발급**(권한 제외로 커서가 어긋나지 않게) |
| **07 검색/네비게이션** | `block.search_text`/tsvector 파생(F-01-03), 목차 앵커 `#{blockId}`(F-01-16), **접힌/미로드 블록 검색은 서버 인덱스가 유일 해법 + 히트 시 조상 체인 온디맨드 로드 후 펼침**(F-01-13 ↔ 22) |
| **09 API/연동** | 공개 API 호환 레이어: 요청당 중첩 2단계 제한, `has_children` + 별도 children 조회(내부 `content[]` 은닉), 타입별 `{type}.color` 투영, rate limit 3req/s. `unsupported` 폴백은 **구버전 클라이언트 라운드트립 보존**에도 쓰임 |
| **11 히스토리/알림** | `operation` 로그가 버전 히스토리의 기반. undo 스택은 **actor별 필터링**(남의 변경을 내가 undo 금지) |
| **12 플랫폼/UX** | 다크모드는 색상 **토큰 저장**을 강제(F-01-21). 컬럼은 폰 미지원(공식). 모바일 드래그는 롱프레스. Firefox 블록 간 부분선택 제약 |
| **15 외부 동기화 / 내보내기** | **Notion-flavored enhanced markdown**이 내보내기/가져오기 문법의 1차 출처. 무손실 트랙(XML/JSON, 색·병합·컬럼 포함) + 호환 트랙(GFM, 색·병합 손실) **2트랙** |
| **17 운영/거버넌스** | 파일 ref_count GC, 고아 `column` 정리 배치, `user_block_state` GC, 서명 URL 만료 정책(권한 회수 반영 지연) |

---

## 6. 최우선 미해결 질문 (5개)

| # | 질문 | 왜 최우선인가 | 확인 방법 |
|---|---|---|---|
| 1 | **노션의 실제 동시편집 충돌 해결 방식(CRDT/OT/LWW)** — 반증 조사 결과 공개 1차 출처 **없음**. 3자 서술만 존재 | 되돌리기 비용이 재작성급. 저장 포맷·undo·F-01-01 스키마가 전부 여기 묶임. 근거 없으므로 **클론이 직접 선택**해야 함(권장: Yjs) | 공식 컨퍼런스/발표 자료 추가 조사. 없으면 Yjs로 확정하고 근거를 자체 결정으로 명시 |
| 2 | **Enter 분할 / Backspace 병합의 세부 규칙**(자식 귀속, 타입 승계, 리스트 탈출) — 공식 문서에 **전혀 없음** | F-01-19는 P0이면서 버그 밀도 최고. 규칙 미정이면 구현자가 매번 다르게 만든다 | 앱 실측: 자식 있는 블록 중간에서 Enter, 이종 타입 병합, 빈 리스트에서 Enter |
| 3 | **심플 테이블 셀 병합의 공개 API 표현** — `table_row.cells`는 평평한 배열이라 rowspan/colspan 자리가 없음(2026-05-26 UI 기능이 스키마 미반영 또는 문서 누락) | F-01-18 스키마를 노션에 맞출지 자체 설계할지 결정 불가. 나중에 바꾸면 표 전량 마이그레이션 | 병합된 표를 공개 API로 조회해 응답 관찰 |
| 4 | **UI/API 불일치 2건** — ① `heading_4`가 API·enhanced markdown에는 있으나 편집기 UI에는 H1~H3만 ② 헬프센터는 파일·북마크에 Color가 있다 하나 API 스키마엔 `color` 필드 없음 | F-01-02·F-01-21의 스키마 결정. 현재 권장안(데이터는 H1~4 수용/UI는 3단계, `format.block_color`는 전 타입 공통)이 옳은지 검증 필요 | 앱에서 파일/북마크 Color 메뉴 확인 + API 재조회 |
| 5 | **부분 로드 청크의 단위와 커서 형태** — `loadPageChunk` 존재는 확인됐으나 단위(고정 블록 수/뷰포트/subtree)와 커서 형태는 미공개 | F-01-22 API 계약 파라미터 확정. 계약은 P0 시점에 고정해야 함 | 네트워크 탭 관찰. 공개 자료로는 확인 불가 → 자체 결정(`cursor=order_key & limit=N`)으로 진행 |

> 그 밖의 `[확인필요]` 20건(중첩 최대 깊이, Shift+Tab 형제 승계, 자식 있는 블록 삭제 정책, synced block 원본 삭제(사본≤10), column 중첩 허용, 토글 접힘 상태 소유자, URL 붙여넣기 선택지, 코드블록 Tab/탈출, 목차 수집 범위, `link_to_page` 조회 표현, 인라인 수식의 `plain_text` 반영, 페이지당 실질 블록 한계, 표 최대 행열, `is_toggleable` 헤딩 자식 ↔ enhanced markdown "헤딩은 자식 불가" 모순 등)는 원본 §미해결 표 25항목 참조. 모두 **앱 실측으로 해소 가능**하며 스키마를 뒤집지는 않는다.

---

## 부록: 재조사 없이 인용 가능한 1차 출처 사실 (본문 미기재분만)

- 블록 5속성 `id/type/properties/content/parent`. **`content`(렌더)와 `parent`(권한)를 분리한 이유** = 다중 참조 시 권한 상속이 모호해져서. **들여쓰기는 스타일이 아니라 "직전 형제의 content로 이동"이라는 구조 연산**. **UI 조작 1회 = 트랜잭션 1개 = operation N개**, `/saveTransactions`, **undo 단위 = 트랜잭션**("Enter=op 3개"는 근거 없음 — 인용 금지). `loadPageChunk`는 시작점에서 트리를 하강하며 **dependent records를 동봉** — notion.com/blog/data-model-behind-notion
- 성능 실측: IndexedDB→SQLite 전환, WASM SQLite + **OPFS SyncAccessHandle Pool VFS**(cross-origin isolation 헤더 불필요가 선택 이유), SharedWorker 단일 쓰기탭 + Web Locks 페일오버, **초기 로드·페이지 이동 50% 단축 / 탐색 20%(호주28·중국31·인도33%)**, 느린 기기에선 SQLite 읽기와 API 호출을 race — /blog/faster-page-load-navigation, /blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite
- 블록 타입 문서화 **35종**(색인 34 + 본문의 `code`). `list_format`/`list_start_index`는 **연속 run의 첫 항목에만** 실림 = "목록" 엔티티가 없고 **형제 run이 곧 목록**(중간 블록 타입 변경 시 run 자동 분할 — 별도 처리 불필요) — developers.notion.com/reference/block
- synced block: 사본 편집엔 **원본 편집 권한 필요**, 원본 무권한자는 내용 볼 수 없음, **사본 >10인 원본 삭제 시 전부 삭제·undo 불가** — /help/synced-blocks
- 수식: 엔진은 **KaTeX**(LaTeX 전체 아님), **mhchem `\ce`/`\pu` 지원**(별도 로드 필요). 보안 고정값: `trust:false`, `throwOnError:false`, `maxExpand`/`maxSize` 유지 — /help/math-equations
- 색상: 19개 + `Cmd/Ctrl+Shift+H`(마지막 색 재적용) + **callout 파생 규칙**(글자색을 기본 아닌 색으로 바꾸면 배경 흰색+연회색 테두리). color 지원 타입 12종 열거(code/divider/미디어/table/synced_block/equation **제외**) — /help/customize-and-style-your-content, developers.notion.com/changelog/block-colors-are-now-supported-in-the-api
- **`>`의 의미가 두 곳에서 다르다**: 입력 규칙의 `> `+스페이스 = **toggle**(quote는 `"`+스페이스, 체크박스는 `[]`+스페이스). 그러나 enhanced markdown의 `> ` = **quote** → **입력규칙 파서와 붙여넣기 파서를 별개 규칙 집합으로 분리해야** 노션과 같아진다 — /help/keyboard-shortcuts + /guides/data-apis/enhanced-markdown
- 블록 간 부분 텍스트 선택은 **Firefox 제외 전 플랫폼** 지원(2022-01-19 릴리스, 4년째 미해결) → `contenteditable`을 블록마다 두는 구현과 정면 충돌 — /releases/2022-01-19
- 심플 테이블: `table_width`는 **생성 시에만** 설정 가능, 셀은 rich text 전용, 헤더는 boolean 플래그 2개, 병합은 2026-05-26 릴리스(anchor 셀만 내용 유지). **심플 테이블이 못 하는 것**: 행을 페이지로 열기·property·relation·formula/rollup·다중 뷰·integration — /help/guides/simple-tables-vs-databases
- 상한: DB당 250,000행, DB 페이지 property 합계 2.5MB, 무료 플랜 다중 소유자 워크스페이스 1,000블록(**삭제해도 카운트 감소 안 함**, 3일 유예) — /help/optimize-database-load-times-and-performance, /help/understanding-block-usage
