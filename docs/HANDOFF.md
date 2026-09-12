# 인수인계

새 세션이 이어받을 때 읽는 문서. **[CLAUDE.md](../CLAUDE.md)를 먼저 읽고 여기로 온다** — 거기에 절대 제약·스택·명령어·코딩 규칙이 있고, 이 문서는 **"지금 어디까지 왔고 다음에 뭘 하는가"**만 다룬다.

최종 갱신: 2026-09-12 (PR #43 머지 시점 — **W5-b 완료 · W6 권한·내비게이션 진행 중. 다음은 검색(W7)**)

---

## 1. 지금 어디까지 왔나

**Phase 0 (MVP, 6~8주) 중 W1–W5 완료. W6 은 권한(W6-b)이 끝나고 내비게이션(W6-a)이 절반이다. 다음은 검색(W7).**

| 주차 | 내용 | 상태 | PR |
|---|---|---|---|
| W1 | 스키마 · 인증 | ✅ | #3 #6 #7 #8 |
| W2 | 계약 고정 (권한) | ✅ | #4 |
| W2 | 계약 고정 (API — RichText · 페이지네이션) | ✅ | #10 |
| W3 | 블록 모델 | ✅ | #9 #10 |
| W4 | 에디터 코어 | ✅ | #12 #13 #14 #15 #16 #17 #18 #19 |
| W5-a | 페이지 트리 | ✅ | #21(이동) #22(휴지통) #23(본문 안 중첩) #24(`/page`) #25(사이드바) |
| W5-b | 편집 확장 · 파일 | ✅ | #27(선택) #29(이동) #30(드래그) #31(접힘·e2e) #33(메뉴) #34(복붙) #35(파일 서버) #36(이미지 블록) #37(드롭·붙여넣기) #39(저장 큐) #40(오류·복구) |
| **W6-b** | **권한** | **✅ (핵심)** | #41(`acl_entry` · `effective()` · 목록 필터) #42(공유 패널) |
| **W6-a** | **내비게이션** | **진행 중** | #43(최근 방문 · 즐겨찾기) |
| **W7** | **검색** | **✅** | #45(색인) · 질의 · 오버레이 |
| W8 | DB 코어 · 뷰 | | |

**동작하는 것**: 이메일 OTP 로그인 → 워크스페이스 생성 → 이메일 초대 → 수락 → 워크스페이스 진입 → 페이지 생성 → 본문 편집(12종 블록 · 분할/병합 · 중첩 · `/` 메뉴 · 마크다운 · 서식) → 자동 저장 → 하위 페이지 → 페이지 이동 → 휴지통 · 복원 · 영구 삭제 → 멀티 블록 선택(Esc · Shift+↑↓ · 일괄 삭제/변환/복제/서식) → 블록 이동(`Mod+Shift+↑↓` · `⋮⋮` 드래그) · `+` 버튼 · 토글 접기 → **블록 메뉴(변환·색·복제·링크·삭제) · 복사/붙여넣기(중첩 보존) · 이미지(올리기 · 주소 입력 · 끌어다 놓기 · 붙여넣기) · 끊겨도 사라지지 않는 저장(IndexedDB 큐) · 페이지 공유(상속 · 따로 관리하기) · 즐겨찾기 · 최근 방문**.
`npm run dev` 로 실제로 눌러볼 수 있고, **`npm run e2e` 가 실제 브라우저로 117개 항목을 확인한다**.

**숫자**: 마이그레이션 11개 / 테이블 29개 / 테스트 835개(CI skip 0) + 브라우저 검증 117개 / PR 43개 머지.

---

## 2. 다음 작업 — W7 검색

로드맵(마스터 문서 §5.2)의 정확한 F-ID:

| 구간 | F-ID | 상태 |
|---|---|---|
| **W5-a** 페이지 트리 | `F-02-01` `F-02-02` `F-02-13` `F-02-08` `F-02-15` `F-02-16` `F-11-05` | ✅ |
| **W5-b** 편집 확장 · 파일 | `F-01-08` `F-01-09` `F-01-10` `F-01-13` `F-01-15` `F-12-09` `F-09-08` `F-05-04` `F-12-16` | ✅ (아래 참조) |
| **W6-b** 권한 | `F-06-01` `F-06-02` `F-06-05` `F-06-06` `F-06-07` `F-06-14` `F-06-20` `F-14-10` | 핵심 ✅ / 공개 링크·외부 초대 미착수 |
| **W6-a** 내비게이션 | `F-07-16` `F-07-04` `F-07-12` `F-07-17` | 절반 (아래 참조) |
| **W7** 검색 | `F-07-01` `F-07-06` `F-07-07` | ✅ |

W5-b 항목별 상태:

| F-ID | 무엇 | 상태 |
|---|---|---|
| `F-01-09` | 멀티 블록 선택 | ✅ #27 (#30 에서 접힌 토글 선택 풀림 수정) |
| `F-01-08` | 드래그·상하 이동 + 핸들 + 메뉴 | ✅ #29(키보드) #30(드래그·`+`) #33(메뉴). `Move to` 는 정본이 P1 로 잘랐다 |
| `F-01-13` | 토글 접기 | ✅ #31 — W4 부터 **브라우저에서는 자식이 안 숨겨지던** 버그를 고쳤다 |
| `F-01-10` | 복붙 구조 보존 | ✅ P0 #34(내부 라운드트립 · 평문). **HTML·마크다운 파싱(P1), URL 붙여넣기(P2)는 안 했다** |
| `F-01-15` · `F-09-08` · `F-12-09` | 이미지 업로드 · 업로드 API · 스토리지 | ✅ P0 #35(`file` 표·로컬 드라이버·API) #36(블록·참조 카운트) #37(드롭·붙여넣기). **R2 드라이버 · GC · 캡션 편집 · 크기 조절은 안 했다**(§7) |
| `F-05-04` | 낙관적 업데이트 · outbox | ✅ #39 — 큐는 **IndexedDB** 에 있고, 끝나는 길은 "서버가 받았다" 아니면 "거부됐다" 둘뿐이다 |
| `F-12-16` | 오류 · 복구 UX | ✅ #40 — 15초 타임아웃 · 오프라인 배너 · `retryable` · 본문 1MB 한도 · **저장 못한 내용 보기** |

W6 항목별 상태:

| F-ID | 무엇 | 상태 |
|---|---|---|
| `F-06-01` · `F-06-07` | 페이지 ACL · 유효 권한 | ✅ #41 (`acl_entry` · `block_acl_meta` · `effective()` · 목록 필터) |
| `F-06-05` | 공유 패널(상속 표시 · 오버라이드) | ✅ #42 |
| `F-06-06` | 공개 링크 | 미착수. `public` 주체가 `principalsOf` 에 아직 없다 |
| `F-06-02` | 역할 5값 | MVP 는 owner/member 2종(마스터 문서가 축소). guest 는 `workspace_everyone` 에서 빠진다 |
| `F-06-14` | 권한 캐시 | **안 만든다**(마스터 문서: "캐시가 없으면 무효화 누락도 없다") |
| `F-07-04` · `F-07-16` | 최근 방문 · 즐겨찾기 | ✅ #43 — **정본에 표가 없어서 정본을 먼저 고쳤다**(§3.9 `[추가]`) |
| `F-07-12` | 뒤로/앞으로 | 브라우저 히스토리가 한다. 단축키만 없다 |
| `F-07-17` | URL · breadcrumb · 블록 앵커 | breadcrumb ✅ · 블록 링크 ✅(#33). **32자리 hex(하이픈 없는) URL 정규화는 안 했다**(§7) |

> ⚠ 이전 판의 이 문단은 `F-02-04`(=즐겨찾기)를 "휴지통"으로 잘못 적어 뒀다.
> 휴지통은 **`F-11-05` / `F-02-11`**, 이동은 **`F-02-08`** 이다.

**권장 순서**
1. **검색** (`F-07-01` 전문 검색 · `F-07-06` · `F-07-07`) — **다음.**
   정본이 물리 구현까지 정해 뒀다: `search_document` 실테이블 + `tsvector GENERATED` + GIN +
   **pg_bigm**(한국어 2-gram — `npm run db:verify` 가 이미 확장 설치를 확인한다).
   권한은 **쿼리 필터 안에** 들어간다: `WHERE perm_scope_id = ANY(:scopes)`.
   그 `scopes` 를 만드는 함수가 이미 있다 — `permissions/effective.ts` 의 `readableScopes`.
   ⚠ 정본 §3.9 의 경고: 권한을 **post-filter 로 하면 페이지네이션이 깨진다**(25개를 뽑아 거르면
   빈 페이지가 나온다). 색인은 저장 시점 동기(마스터 문서 W7), 랭킹은 최근 수정순.
2. **`cmd+P` 빠른 이동** — 검색 오버레이의 빈 상태가 곧 "최근 방문"이다(F-07-04).
   `listRecent` 가 이미 그 데이터를 준다. 검색과 같은 컴포넌트다.
3. 그 뒤가 W8(DB 코어 · 뷰)이다.

**착수 전에 읽을 것**
- `docs/research/07-search-navigation.md` F-07-01(검색 인덱싱·랭킹) · F-07-06 · F-07-07
- `docs/research/00-canonical-data-model.md` §3.9 — `search_document` 스키마와 **검색 쿼리 형태**
- 한국어 검색은 `scripts/verify-db.mjs` 가 이미 pg_bigm 2-gram 동작을 확인하고 있다.
  DB collation 이 ICU + ko-KR 이라는 것과 함께 본다

**드래그·이동을 건드릴 때 미리 알아둘 것**
- 키보드 이동과 드래그는 **규칙이 다르다**(§3.3-13·14). 키보드는 안으로 들어가지 않고, 드래그는 들어간다.
  드래그는 목적지를 id 로 들고 가서 지운 뒤 다시 찾는다 — 떨어진 선택이 소스들 사이에 목적지를 둘 수 있어서다.
- 두 경로가 공유하는 것은 `blockDeletionRanges()` 다. **자식을 전부 옮기면 남는 `blockGroup` 이 비어
  스키마(`blockContainer+`)를 어긴다** — 그 함수가 "그룹째 처리 / 루트 그룹은 예외"를 이미 갖고 있다.
- 사이드바 드래그(`F-02-03`)는 같은 조작처럼 보이지만 **권한 변경 트랜잭션**이다
  (F-07-16: "드래그로 섹션을 넘으면 권한이 바뀐다"). W6 이후다.

**이미 준비된 것 (다시 만들지 말 것)**
- `src/lib/editor/block-rules.ts` — 분할·병합 **결정** 함수. ProseMirror 를 모른다
- `src/lib/editor/tree.ts` — `flattenVisible()`. 화면 순서 평탄화 + O(1) 이웃
- `src/lib/editor/rich-text-ops.ts` — 오프셋·분할·이어붙이기 (상한 초과 시 거부)
- `src/lib/editor/document.ts` — `EditorDoc` 계약 · 검증 · 행↔문서 변환 · 투영
- `src/lib/block/save-page-body.ts` — **프로젝터**. Phase 1 에서 상류만 Y.Doc 으로 바뀐다.
  자식 페이지의 부모가 문서에서 바뀌면 `relocateSubtree` 를 불러 서브트리를 재배치한다
- `src/lib/block/move-page.ts` — 이동 + **`relocateSubtree()`**(서브트리 경로·스코프 재작성). 복원도 이걸 쓴다
- `src/lib/block/trash.ts` — 3상태 전이. 복원·영구삭제는 **삭제 루트 단위**로만
- `src/lib/block/page-tree.ts` — 사이드바 트리. 부모는 `parent_id` 가 아니라 **가장 가까운 페이지 조상**이다
- `src/app/w/[workspaceId]/layout.tsx` · `sidebar.tsx` · `sidebar-state.ts` — 사이드바(펼침은 로컬 스토어)
- `src/lib/editor/block-selection.ts` — **블록 선택 모드.** `BlockSelection`(ProseMirror `Selection` 서브클래스) ·
  `rootsBetween()`(최상위 정규화) · `blockDeletionRanges()`(빈 그룹 방지) · 확장/삭제/변환/복제 커맨드
- `src/lib/editor/block-selection-plugin.ts` — 선택 하이라이트 · `keepBlockSelection`(`createSelectionBetween` —
  외부 DOM 변경이 블록 선택을 푸는 것을 막는다, §6)
- `src/lib/editor/block-move.ts` — 키보드 이동 계획(`planBlockMove`) · 적용
- `src/lib/editor/block-handle.ts` — 드롭 판정(`resolveDrop`, 이진 탐색) · 드롭 계획/적용 · `+` 버튼 · 핸들 대상.
  화면은 `src/app/w/[workspaceId]/[pageId]/block-gutter.tsx` 이고 **좌표만 읽는다**
- `src/lib/editor/collapse-plugin.ts` — 접힘을 **데코레이션으로** 그린다(§6 — DOM 직접 수정 금지)
- `src/lib/editor/block-menu.ts` — 블록 메뉴의 항목 모델 · 키보드 이동 · 블록 색 · 블록 링크(보내는 쪽·받는 쪽)
- `src/lib/editor/block-clipboard.ts` — 복사/붙여넣기. 커스텀 MIME · 평문 · 붙는 자리 규칙
- `src/lib/file/limits.ts` · `storage.ts` · `file.ts` — 업로드 한도 · 스토리지 드라이버(경계 방어) · 업로드/조회.
  **R2 드라이버가 들어올 자리는 `FileStorage` 세 함수**다
- `src/lib/file/upload-client.ts` — 브라우저 업로드(XHR — `fetch` 는 진행률을 주지 않는다)
- `src/lib/block/image.ts` — 이미지 블록의 properties 계약 · 외부 URL 스킴 검사 · **파일 참조 집계**
  (`countFileReferences`/`fileReferenceDelta` — 프로젝터가 `ref_count` 에 쓴다)
- `src/lib/editor/image-view.ts` · `image-drop.ts` — 노드 뷰(빈 상태·진행률·폴백) · 드롭/붙여넣기 플러그인
- `src/lib/sync/outbox.ts` · `outbox-store.ts` · `page-sync.ts` — **저장 큐**(F-05-04 / F-12-16).
  규칙 · IndexedDB · 순서. 시계와 타이머를 주입받아 **브라우저 없이** 재시도·타임아웃을 시험한다
- `src/lib/permissions/levels.ts` — `CapSet` · `can()` · `maxByCap()`. **레벨을 정수로 비교하지 않는다**(A2)
- `src/lib/permissions/effective.ts` — **유효 권한**. `resolveCaps`(순수) · `effectiveCaps` ·
  **`readableScopes`**(목록 질의가 쓰는 `perm_scope_id` 필터 — 검색도 이걸 쓴다)
- `src/lib/permissions/acl.ts` — 부여 · 회수 · **상속 차단**(`stopInheriting` — 복사 뒤에 끊는다, P1) ·
  `perm_scope_id` 재계산
- `src/lib/nav/recent.ts` — 최근 방문 · 즐겨찾기. **권한은 조회 시점에 다시 건다**
- `src/lib/editor/pm-blocks.ts` 의 `canNestUnder()` — "이 블록 밑에 자식을 둘 수 있는가". Tab·드롭이 공유한다
- `scripts/e2e-editor.mjs` — **실제 브라우저 검증**(`npm run e2e`). 브라우저에 기대는 것을 만들면 여기에 검사를 더한다
- `src/lib/editor/schema.ts` · `pm-adapter.ts` · `commands.ts` · `keymap.ts` · `input-rules.ts` · `slash-menu.ts`
- `src/lib/auth/route-session.ts` · `page-session.ts` — 라우트 진입 게이트(거부 코드 매핑 한 곳)
- `src/lib/testing/db-fixtures.ts` — `SessionContext` 를 캐스팅 없이 발급하는 테스트 픽스처

---

## 3. 이 프로젝트에서 내린 판결

정본 문서와 코드가 다르면 **정본이 이긴다**(CLAUDE.md 절대 제약 3). 그럼에도 판단이 필요했던 지점들을 여기 모아둔다 — 새 세션이 "왜 정본과 다르지?"라고 헷갈리지 않도록.

### 3.1 정본을 고친 것

| # | 무엇 | 왜 |
|---|---|---|
| 1 | **F-14-02 → 존재하지 않는 이메일에도 코드를 보낸다** (`14-auth-accounts.md` F-14-02 `[정정]`) | 원안("메일 안 보냄")대로면 **신규 가입이 영원히 불가능**하다. F-14-01 시나리오 2가 이긴다. 계정 열거는 응답·문구·시간을 동일하게 유지해 막는다 |
| 2 | **`workspace_invite.token` → `token_hash`** (`00-canonical-data-model.md` §3.2 `[정정]`) | 초대 토큰은 세션 토큰과 같은 bearer 자격증명인데 이 표만 평문이었다. 해시는 단방향이라 **데이터가 쌓이기 전에** 고쳐야 했다 |
| 2b | **`recent_visit` · `favorite` 표 신설** (`00-canonical-data-model.md` §3.9 `[추가]` + §2 목록, #43) | 07 문서가 `recent_visit` 스키마를 "데이터 모델 함의"로 제시하는데 정본에 자리가 없었다. 즐겨찾기는 "사용자별 개인 목록"이라고만 적혀 스키마가 없었다. 구현 전에 정본을 먼저 고쳤다 |
| 2c | **`acl_entry` 의 UNIQUE 를 `NULLS NOT DISTINCT` 로 강화** (정본 문서는 안 고쳤다 — 제약을 **좁히는** 쪽이라 의미가 달라지지 않는다, #41) | 정본의 `UNIQUE (node_kind, node_id, principal_type, principal_id)` 는 PostgreSQL 에서 **NULL 을 서로 다르게 본다.** `principal_id` 가 NULL 인 주체가 바로 `workspace_everyone`·`public` — 가장 흔하고 가장 중복되기 쉬운 둘이다. 그대로 두면 `ON CONFLICT … DO UPDATE` 로 짠 레벨 변경이 조용히 **행 추가**가 된다. **verify-schema 프로브가 잡았다** |

### 3.2 정본이 "정하라"고 남긴 것을 정한 것

| # | 무엇 | 결정 | 근거 |
|---|---|---|---|
| 3 | **오프셋 단위** (F-01-20 이 "하나로 고정할 것"이라고 남김) | **원자(mention·equation)는 길이 1** | 이 규칙에서는 "캐럿이 멘션 한가운데"가 **구조적으로 불가능**해진다. `plain_text` 길이로 세면 모든 호출 지점이 스냅을 기억해야 하고, 한 곳만 빠뜨리면 멘션이 반으로 쪼개진다. ProseMirror inline atom 도 `nodeSize 1` 이라 **변환이 아예 없어진다** |
| 4 | **분할 시 새 블록의 위치** (F-01-19 "형제로 넣을지 첫 자식으로 넣을지 분기") | 자식이 있고 **펼쳐져** 있으면 첫 자식, 그 외 형제 | 기준은 하나 — *새 블록은 화면에서 원본 바로 다음 줄에 온다.* 그리고 **자식을 절대 옮기지 않는다**(§7-4 최빈 버그) |
| 5 | **접힌 대상으로 자식이 이관되는 병합** | 병합하면서 **앞 블록을 펼친다** | 접힌 컨테이너로 들어간 자식은 사용자에게 삭제로 보인다. 거부보다 손실이 없다 |
| 6 | **슬래시 메뉴 필터·종료** (정본 미해결 16번) | 필터는 **prefix**, 종료는 ⓐ공백 ⓑ매칭 0건 ⓒ캐럿 이탈 | fuzzy 는 "왜 이게 나오지"를 예측할 수 없다. 항목 12개에는 prefix 로 충분하다 |

§9-Q7("Enter 분할/Backspace 병합 규칙 — W4 이전 필수")은 마스터 문서에 `[해결 · W4]` 로 기록했다.

### 3.3 코드에만 있는 판단

| # | 무엇 | 왜 |
|---|---|---|
| 7 | **`fractional-indexing` 역순 입력 가드** | `generateKeyBetween('a1','a0')` 이 예외 없이 `'a0V'` 를 반환한다. 두 경계 어느 쪽 사이도 아닌 값이라 정렬이 조용히 깨진다. 우리 계층에서 `RangeError` |
| 8 | **`block.order_key` 에 `COLLATE "C"`** (마이그레이션 0008) | DB 는 ICU + `ko-KR` 인데 fractional index 는 **이진 순서**를 가정한다. **실측 임계값 형제 37개** — `aa` 가 생기는 순간 ICU 가 `aZ` 를 최대로 봐서 `max()` 뒤에 만든 키가 이미 존재하는 키가 된다(UNIQUE 위반). 36개까지는 증상이 전혀 없다 |
| 9 | **Tiptap 확장 레이어를 쓰지 않고 ProseMirror 를 직접 쓴다** | Tiptap 은 **스키마를 소유**하는데, 우리 스키마는 §5.1 의 요구대로 **블록 타입 레지스트리에서 생성**되어야 한다. 두 생성기가 겹치면 "레지스트리에 넣었는데 에디터에는 없는" 상태가 가능해진다. 의존성은 `@tiptap/pm`(호환 `prosemirror-*` 묶음) 하나만 남겼다. **"에디터를 처음부터 만들지 말 것"은 지켰다** — 문서 모델·뷰·스텝·위치 매핑·히스토리·입력 규칙·키맵이 전부 ProseMirror 것이다. ⚠ CLAUDE.md §스택의 "Tiptap(ProseMirror)" 표기와 어긋난다 |
| 10 | **`blockContainer.blockId` 의 스키마 default 는 빈 문자열 센티널** | ProseMirror 는 필수 위치의 노드가 인자 없이 생성 가능해야 한다고 요구해 default 를 없앨 수 없고, `default` 는 고정값이라 uuid 팩토리를 넣을 수 없다(모든 블록이 같은 id 가 된다). id 는 스탬프 플러그인 + `pmToDoc()` 두 곳에서 찍는다 |
| 11 | **블록 선택은 플러그인 상태가 아니라 `Selection` 서브클래스다** (`BlockSelection`) | 플러그인에 두면 `state.selection` 과 진실이 둘이 된다 — 캐럿이 남아 타이핑이 새 나가고, 문서가 바뀔 때마다 선택 집합을 손으로 매핑해야 한다. F-01-09 가 요구한 "협업자가 선택된 블록을 지우면 자동 제외"가 정확히 그 매핑이다. 상속하면 공짜로 온다. `prosemirror-tables` 의 `CellSelection` 과 같은 선택(`visible = false` · 범위 배열 · `replace()` 재정의). 부수 효과로 **`Mod+B` 가 코드 없이 동작한다** — `toggleMark` 가 `selection.ranges` 를 돈다 |
| 12 | **하위 페이지가 든 선택은 삭제·복제를 거부한다** | 문서에서 자식 페이지가 빠지면 프로젝터가 `page_ref_missing` 으로 **저장 자체를 거부**한다(`save-page-body.ts`). 노션은 이때 그 페이지를 휴지통으로 보내지만 그건 서버 호출이라 에디터 커맨드가 할 수 없다. 부분 삭제(페이지만 남기기)보다 전체 거부 + 이유 표시를 골랐다 — 조용한 부분 실행이 더 나쁘다 |
| 13 | **키보드 이동(`Mod+Shift+↑↓`)은 안으로 들어가지 않는다. 경계에서만 한 단 나간다** (#29) | 정본은 "단순 상하 이동"이라고만 했다. 안으로 넣는 것은 Tab 의 일이고, 한 키에 순서·깊이를 섞으면 둘 다 예측할 수 없다. 대신 경계에서는 나간다 — 못 나가면 리스트 안 블록을 키보드로 뺄 수 없는데 드래그로는 되는 이동이라 WCAG 2.1 SC 2.1.1 대체 경로가 더 약해진다. **알고 받아들인 비대칭**: 왕복은 형제 사이에서만 제자리다(경계를 넘으면 화면 순서는 그대로이고 깊이만 바뀌어, 한 키로 두 축을 대칭 왕복시킬 수 없다). 테스트로 못박았다. 공짜 성질: 접힘을 몰라도 되고 `canHaveChildren` 을 볼 필요가 없다 |
| 14 | **드래그는 안으로 들어갈 수 있고, 목적지를 id 로 들고 가서 지운 뒤 다시 찾는다** (#30) | 드래그는 가이드가 목적지를 **먼저 보여주므로** 키보드의 금지 이유가 없다. 떨어진 선택(깊이가 섞인 블록)을 모으면 목적지가 소스들 **사이**에 올 수 있어 "뒤쪽 연산 먼저"가 성립하지 않는다 — 위치 대신 (블록 id, 앞/뒤/첫 자식)을 들고 간다. 줄의 아래 절반은 **보이는 자식이 있으면** 첫 자식 자리다(그러지 않으면 가이드가 자식들 아래 멀리 그려진다) |
| 15 | **ProseMirror 가 소유한 DOM 은 ProseMirror 만 고친다** (#30 · #31) | 편집기 DOM 에 속성을 직접 달면 PM 이 "바깥에서 바뀌었다"로 감지해 그 노드를 모델 기준으로 **다시 그리며 지우고**(접힘이 이렇게 동작하지 않았다), 그 범위의 DOM selection 으로 **선택을 새로 만든다**(블록 선택이 이렇게 풀렸다). 보이는 상태는 **데코레이션**으로 그리고, 에디터 밖 UI(핸들·드래그 흐림)는 **에디터 바깥 프레임**에 단다 |
| 16 | **`canNestUnder()` — 하위 페이지 참조 밑에는 자식을 둘 수 없다** (#30) | 레지스트리의 `page.canHaveChildren` 은 true 다(페이지 트리). 본문의 참조 노드 밑은 **그 페이지의 문서**라 `validateDoc` 이 저장을 거부한다. Tab 이 레지스트리만 보고 허용하던 버그를 이 판정으로 고쳤고 드롭이 같은 판정을 쓴다 |
| 18 | **블록 선택의 기준 anchor·head 는 선택 범위의 양끝이다** (#34) | 우리 경계(`$anchorBlock`/`$headBlock`)를 그대로 넘기면 블록 하나를 고를 때 둘이 같아 **DOM 선택이 접힌다.** 그러면 브라우저의 복사 명령이 "복사할 것이 없다"고 보고 `copy` 이벤트를 아예 일으키지 않아, **블록 하나를 골라 Ctrl+C 하면 아무 일도 일어나지 않았다.** `CellSelection` 도 같은 이유로 셀 내용의 양끝을 준다. 실제 브라우저 검증에서 잡았다 |
| 19 | **붙여넣기는 자식을 옮기지 않는다** (#34) | 캐럿이 **자식 있는 블록** 안일 때 `replaceSelection` 에 맡기면 PM 이 컨테이너를 쪼개며 자식을 뒤 블록으로 옮긴다(§7-4 최빈 버그). 그래서 그때는 텍스트를 쪼개지 않고 **화면상 다음 줄**에 넣는다 — 분할(판결 ④)·`+` 버튼과 같은 자리 규칙이다. 자식이 없으면 슬라이스 양끝을 열어 PM 에 맡긴다(정본의 "첫 블록은 인라인 병합"이 곧 열린 양끝이다) |
| 20 | **하위 페이지는 클립보드에 싣지 않는다** (#34) | 사본을 붙이면 존재하지 않는 페이지를 가리키는 `type='page'` 행이 되고, `lifecycle` 이 없어 `ck_lifecycle_page` 에 걸려 **저장이 통째로 실패**한다. 페이지 복제는 서버 작업(서브트리 깊은 복사)이라 편집기 클립보드가 할 수 있는 일이 아니다. 복사한 순간 알린다 — 삭제(#27)·복제(#30) 거부와 같은 이유 |
| 21 | **클립보드 JSON 은 `version` 을 싣고, 모르는 버전은 조용히 평문으로 떨어진다** (#34) | 정본 리스크: *"포맷을 바꾸면 이전 버전 클립보드가 깨진다."* 거부하면 사용자는 붙여넣기가 안 되는 이유를 알 수 없다. 그리고 클립보드는 **신뢰할 수 없는 입구**라 저장할 때와 **같은 함수**(`validateDoc`)로 검증한다 — 여기서만 무르면 붙인 한참 뒤 "저장 안 됨"이 뜬다 |
| 28 | **저장 큐의 디바운스는 전송에만 건다. 큐 적재에는 걸지 않는다** (#39) | 예전에는 편집 1초 뒤에 저장을 시작했고, 그 1초 안에 탭을 닫으면 친 글이 사라졌다. 큐에 넣는 것은 네트워크가 아니라 로컬 디스크 쓰기이므로 오래 미룰 이유가 없다. 키 입력마다 쓰지는 않고(문서 한 벌 직렬화) 짧은 디바운스 + `pagehide`·`visibilitychange` 에서 즉시 flush. `beforeunload` 는 모바일에서 안 불린다 |
| 29 | **ack 를 못 받은 저장을 "충돌"이라고 말하지 않는다** (#39) | 응답이 오는 길에 끊기면 저장 성공 여부를 모른다. 재전송하면 서버는 이미 올라간 버전 때문에 409 를 주고, 그대로 믿으면 **아무도 편집하지 않았는데** "다른 곳에서 먼저 저장했습니다"가 뜬다. 409 를 받으면 서버 문서를 한 번 읽어 우리가 보낸 것과 비교한다. 그 비교가 성립하는 근거(저장 왕복 무손실)는 `sync/outbox.db.test.ts` 가 **실제 DB 로** 확인한다. 정본의 `tx_id` 멱등은 op 단위가 되는 Phase 1 에 필요해진다 |
| 30 | **멈춘 요청에 자체 타임아웃(15초)을 건다** (#40) | `fetch` 는 죽은 프록시·절반만 끊긴 와이파이에서 끝나지 않는다. 전송 중 플래그가 안 풀려 **그 세션의 저장이 통째로 멈췄다**(큐에는 쌓이는데 아무것도 안 나간다). 기다리기를 끊는 것은 엔진, 소켓을 끊는 것은 `AbortSignal`. 표시도 **때가 되면** 알려야 한다 — 사건이 있을 때만 갱신하면 멈춰 있는 동안 화면이 조용하다(정본 F-12-16 이 "최악"이라고 부른 상태) |
| 31 | **볼 수 없는 페이지는 없는 페이지와 같다** (#41) | `getPage`·`loadPageBody` 는 `null`, `savePageBody` 는 `not_found`. 403 과 404 를 구분해 주면 id 를 찍어 존재를 알아낼 수 있다(F-02-03 "존재도 노출 금지"). **볼 수는 있는데 고칠 수 없는** 경우에만 403 이다 |
| 32 | **목록은 노드마다 판정하지 않고 `perm_scope_id` 로 거른다** (#41) | 사이드바·휴지통·최근 방문이 전부 `readableScopes` 를 쓴다. 성립하는 근거는 `perm_scope_id` 의 정의 자체다 — 같은 스코프의 노드는 **정의상 권한이 같다.** 노드마다 판정하면 페이지 수만큼 질의가 생기고, 정본이 검색에 대해 정한 모양(`WHERE perm_scope_id = ANY(scopes)`)과도 어긋난다 |
| 33 | **마지막 관리자는 지울 수 없다** (#41 — 정본에 없는 규칙) | 지우면 그 페이지의 권한을 아무도 못 고치는 상태가 되고 되돌릴 방법이 DB 직접 수정밖에 없다. 그래서 "나만 보기"는 **두 조작**이다 — 먼저 나에게 `full_access` 를 주고, 그다음 모두를 뗀다. 공유 패널도 그 순서로 움직인다 |
| 34 | **상속 되돌리기(P3)는 복사해 둔 행을 지우지 않는다** (#41 — 정본과 다름) | 정본은 "inherits:=TRUE + **부모 유래 행 삭제**"라고 적지만 `acl_entry` 에 provenance 컬럼이 없다(정본 스키마에도 없다). 남기는 쪽은 "절단 시점 권한을 계속 갖는다"이고, **잃는 쪽이 아니라 남는 쪽**으로 기운다. 지우려면 정본을 고쳐야 한다(§7) |
| 35 | **내비게이션 상태는 권한의 저장 지점이 아니다 — 조회 시점에 다시 거른다** (#43) | 최근 방문·즐겨찾기 행은 권한이 바뀌어도 손대지 않는다. 지우는 설계였다면 권한이 바뀔 때마다 **모든 사용자의 목록**을 훑어야 하고, 한 번 놓치면 볼 수 없는 페이지의 제목이 사이드바에 남는다. 제목도 복사하지 않고 조인한다(제목이 바뀌면 목록도 바뀌어야 한다) |
| 22 | **파일은 `storage_key` 만 저장한다. 주소는 파생값이다** (#35 · #36) | 정본 불변식 FS2 가 "서명 URL 을 저장하지 않는다"이고, 그 결과 `file` 표에 URL 컬럼이 **없다.** 블록도 `properties.source = {type:'file', file_id}` 만 갖는다. 주소는 `imageDisplayUrl()` 이 그때 만든다 — `properties.url` 에 주소를 넣었다면 스토리지를 R2 로 옮기는 날 **저장된 모든 이미지가 한꺼번에 깨지고** 고칠 방법이 마이그레이션밖에 없다 |
| 23 | **업로드는 요청 하나다. create → send → complete 세션을 만들지 않았다** (#35) | F-09-08 이 적은 노션 API 는 3단계지만 그 상태를 담을 표가 정본 §3.10 에 **없고**(`file` 하나뿐), 3단계가 필요한 이유는 multi-part 인데 그건 20 MiB 초과의 이야기다. 우리 상한은 5 MiB. 상한을 올리는 날 세션 표가 함께 온다 |
| 24 | **`ref_count` 는 프로젝터가 같은 트랜잭션에서 diff 로 센다** (#36) | 블록을 넣고 카운트를 나중에 올리면 그 사이 GC 가 도는 순간 방금 붙인 이미지의 바이트가 사라진다. **집합이 아니라 횟수**다 — 같은 파일을 둘이 가리키다 하나를 지우면 1 이어야 한다. 내릴 때 `GREATEST(…,0)` 로 바닥을 둔다: 장부가 어긋났을 때 저장을 실패시키면 사용자는 쓴 글을 잃고 얻는 것은 GC 힌트의 정확도뿐이라, **덜 지우는 쪽**(FS1 의 방향)으로 기울게 뒀다 |
| 25 | **원자 블록(이미지)을 넣을 때는 `replaceSelection` 에 맡기지 않는다** (#37) | 이미지는 슬라이스 양끝을 **열 수 없어** 닫힌 슬라이스가 되고, 그러면 PM 이 캐럿 자리에서 문단을 쪼개 앞쪽 조각이 **빈 문단으로 남는다**(`· \| [이미지] \| A`). 테스트가 먼저 잡았다. 자리 규칙 자체는 판결 ④ 그대로이고(다음 시각적 줄 · 자식 안 옮김), 빈 줄 위에 놓으면 그 줄을 대체한다. 텍스트 붙여넣기(판결 19)는 양끝을 열 수 있으므로 그 경로를 그대로 둔다 |
| 26 | **드롭·붙여넣기는 파일을 블록보다 먼저 큐에 넣는다** (#37) | 빈 이미지 블록을 만들고 업로드는 노드 뷰가 한다(진행률 UI 가 거기 있다). 그런데 노드 뷰는 **dispatch 하는 그 순간 동기적으로** 만들어지므로, 순서가 뒤집히면 노드 뷰가 큐를 볼 때 비어 있고 놓은 이미지가 영영 올라가지 않는다. 반사실로 확인했다. 큐는 `WeakMap<EditorView,…>` — 모듈 전역이면 페이지를 오갈 때 이전 에디터의 큐가 남는다 |
| 27 | **외부 이미지 URL 의 스킴 검사는 서버에서도 한다** (#36) | `<img src>` 는 `javascript:` 를 실행하지 않지만 **`a[href]`("원본 열기")는 실행한다.** 그래서 `validateDoc` 이 `source` 를 검사한다 — 화면에서만 막으면 API 로 직접 저장하는 경로가 열려 있다. 클라이언트 검사도 필요하다: 없으면 잘못된 `source` 가 문서에 써지고 **그 페이지의 자동 저장이 전부 `invalid_document` 로 실패**한다(반사실에서 관찰) |
| 17 | **프로젝터의 임시 키 대상은 "키가 바뀌는 행"이 아니라 "(부모, 키) 자리가 바뀌는 행"** (#30) | 키는 위치로 결정론적으로 매겨지므로(a0, a1, …) 루트 첫 블록을 다른 블록의 첫 자식으로 옮기면 **키 문자열이 그대로**다. 키만 비교하면 그 행이 옛 자리에 남아 형제의 UPDATE 와 UNIQUE 충돌한다. Tab/Shift+Tab 은 우연히 늘 키도 바뀌어 이 구멍을 안 밟았다 |

---

## 4. 작업 리듬 (지금까지 지켜온 것)

```
1. 정본 문서를 먼저 읽는다        ← 기억으로 쓰지 않는다
2. git checkout -b <타입>/<이름>
3. 구현 + 테스트
4. npm run check  (typecheck · lint · license · test)
5. npm run db:verify:schema
6. 화면에 기대는 것이면: npm run build && npm run e2e   ← #31 부터
7. 커밋 → 푸시 → gh pr create
8. CI 두 잡 통과 확인 (db 잡의 skip 이 0인지도 본다)
9. gh pr merge --squash --delete-branch
10. 새 브랜치를 판다              ← 머지 후 main 에 서 있다
```

**PR 본문에 "왜 이렇게 했는가"를 쓴다.** 특히 정본과 다르게 한 것, 실패했다가 고친 것, 의도적으로 안 만든 것.

한 PR 이 커지면 자른다. W4 는 8개로 나눴고, 각 PR 이 "이 계층까지는 테스트된다"는 경계와 일치했다.

---

## 5. 테스트 철학 (이 저장소의 규칙)

- **"생겼다"가 아니라 "실제로 막는가"를 본다.** `CHECK`을 걸어놓고 동작을 확인하지 않으면 걸지 않은 것과 같다. `scripts/verify-schema.mjs`는 위반 INSERT를 실제로 던져본다.
- **부정 요구사항도 테스트한다.** 정본의 "이 컬럼은 존재하지 않는다"(B6·B8·B9·B10)를 `information_schema` 조회로 확인한다.
- **실패 경로를 성공 경로보다 많이 쓴다.**
- **테스트의 규모 자체가 테스트의 일부일 수 있다.** `order-key.db.test.ts` 는 형제를 **70개** 만든다. 36개짜리였다면 collation 버그(§3.3-8)를 못 잡는다.
- **ProseMirror 는 DOM 없이 돈다.** `prosemirror-model`/`state`/`transform` 은 순수 자료구조라 에디터의 스키마·커맨드·입력 규칙·슬래시 메뉴가 전부 `node --test` 로 검증된다. 브라우저가 필요한 것은 `EditorView` 뿐이고, 거기에는 **조립과 저장만** 둔다(`body-editor.tsx`).
- **그러나 헤드리스 테스트는 브라우저가 하는 일을 못 본다.** DOM 도 MutationObserver 도 없다. `npm run e2e`(#31)가 생기기 전까지 **브라우저에서만 드러나는 버그 넷이 헤드리스 테스트를 전부 통과한 채** 들어가 있었다(토글 접기 · 블록 선택 풀림 · 프로젝터 UNIQUE · Tab 저장 거부). 화면에 기대는 것을 만들면 `scripts/e2e-editor.mjs` 에 검사를 더한다.
- **검사가 실제로 실패하는지 반대 경우를 돌려 본다.** 수정 전 코드(또는 수정의 일부를 뺀 코드)에서 새 검사가 **정확히 그 항목만** 실패해야 그 검사가 회귀를 잡는다. #30·#31 에서 이렇게 확인했다 — "훅을 빼면 3개 실패", "컨테이너에만 달면 화살표 검사만 실패". #39 에서는 저장소를 메모리로 바꾸자 "새로고침해도 친 글이 돌아온다"가 빨개졌다.
- **반사실이 통과하면 그 주석을 고친다.** #36 에서 `ignoreMutation` 을 빼고 돌렸더니 **71개가 전부 통과했다** — `contentDOM` 이 없는 노드 뷰는 `prosemirror-view` 기본값이 이미 막고 있었다. 코드는 남기되(캡션 편집이 붙으면 기본값이 뒤집힌다) "이게 없으면 사라진다"는 주석을 사실대로 고쳤다. **증명하지 못한 것을 증명한 것처럼 적지 않는다.**
- **버그를 고치기 전에 재현하는 테스트를 먼저 쓴다.** #40 은 정본을 읽다 발견한 "멈춘 요청이 세션의 저장을 통째로 멈춘다"를 **실패하는 테스트 두 개**로 먼저 재현한 뒤 고쳤다.
- **`assert.equal(EditorState, null)` 로 쓰지 않는다.** 실패하면 node 가 메시지를 만들려고 EditorState(스키마까지 딸린 객체 그래프)를 통째로 inspect 하다 **멈춘다**(40초 넘게). `assert.ok(x === null, '…')` 로 쓴다. 기존 테스트에 이 패턴이 남아 있다(§7).
- **입력 규칙은 한 글자씩 타이핑해 확인한다.** `handleTextInput` 을 직접 부른다 — 텍스트를 한 번에 넣으면 규칙이 아예 돌지 않아 "패턴은 맞는데 트리거되지 않는" 경우를 놓친다.
- **DB 테스트는 `REQUIRE_DB=1`로 CI에서 강제한다.** 조용히 skip되면 그 테스트는 썩는다.
- 마이그레이션을 추가하면 `scripts/verify-schema.mjs`의 `EXPECTED_TABLES`도 갱신한다.

---

## 6. 세션 운영 요령 (실제로 겪은 것)

**WSL2 VM 내려감 — 해결됨(PR #20).** `npm run db:up` 이 세션 유지 프로세스를 자동으로 띄운다.
- 원인: WSL2는 **살아 있는 WSL 세션이 하나도 없으면** VM을 내린다. `docker compose up` 은 끝나면 세션도 닫힌다
- 증상: `ECONNREFUSED 127.0.0.1:5432` (message 는 **비어 있고** `code` 에만 정보가 있다)
- **W4 세션에서만 5번 겪었다.** 매 명령 앞에 `npm run db:up` 을 붙이며 일했다. 지금은 필요 없다
- ⚠ **진단 함정**: `docker compose ps` 로 상태를 묻는 **그 명령이 VM을 되살린다.** 확인하면 늘 `Up 1 second` 가 보이고 앱을 열면 죽어 있다. 컨테이너가 아니라 **VM이 통째로** 내려가 있던 것이다
- `.wslconfig`의 `vmIdleTimeout=-1`은 **WSL 2.7.13에서 동작하지 않는 것을 확인**했다. 넣지 마라
- 그래도 죽으면: `npm run db:up` (없어진 keepalive를 다시 띄운다). 끄려면 `WSL_KEEPALIVE=0`

**`.env` 로드**: 스크립트는 자체적으로 `.env`를 읽지만, 셸에서 직접 `node --test`를 돌릴 땐 `set -a; source .env; set +a` 가 필요하다.

**dev 서버는 끝나면 반드시 끈다.**
```bash
node -e 'const{execSync}=require("child_process");
  const out=execSync("powershell -NoProfile -Command \"Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess\"",{encoding:"utf8"});
  for(const pid of out.split(/\s+/).filter(Boolean)) try{process.kill(Number(pid))}catch(e){}'
```

**⚠ SQL 템플릿 리터럴 안의 주석에 백틱을 쓰지 마라.** W8 에서 **세 번** 당했다.

우리 SQL 은 전부 `` `...` `` 템플릿 리터럴이고, 그 안의 `-- 주석` 에 식별자를 백틱으로 감싸면 **그 자리에서 문자열이 끝난다.** 증상은 SQL 오류가 아니라 엉뚱한 줄의 타입스크립트 구문 오류다:

```
src/lib/block/page.ts(476,43): error TS1005: ',' expected.
```

주석 안에서는 백틱 없이 `block.properties.title` 처럼 그냥 쓴다. 같은 이유로 `${...}` 도 조심한다 — 주석에 적어도 보간이 돈다.

**`npx prettier` 를 그냥 돌리지 마라.** 저장소에 prettier 설정이 없어서 기본값(쌍따옴표 · 세미콜론)으로 파일 전체를 다시 포맷한다 — 이 저장소 스타일은 작은따옴표 · 세미콜론 없음이다. 한 번 당했고 `git checkout` 으로 되돌렸다.

**긴 문자열 치환에 스크립트 + `replace`를 쓰면 조용히 실패한다.** 이 세션에서도 한 번 당했다(한글·`·` 같은 비-ASCII가 섞인 앵커에서 heredoc 인코딩이 어긋났다). **파일 수정은 Edit 도구를 쓴다.** 스크립트로 치환했다면 `assert` 를 넣고 `grep`으로 반영을 확인한다.

**⚠ `next dev` 로 API 라우트를 검증하지 마라. 프로덕션 빌드로 해라.** 세 세션 연속으로 여기서 시간을 날렸다.

- 증상: 새로 만든(혹은 멀쩡하던) `/api/.../[pageId]/*` 라우트가 계속 **404**
- 구분법: 응답의 **`content-type` 이 `text/html`** 이면 우리 404 가 아니라 **Next 의 404**(라우트 미매칭)다. 상태 코드만 보면 코드를 계속 뒤지게 된다
- **원인**: `.next/dev/types/routes.d.ts` 가 **쓰다 만 상태로 잘려 있었다**(`ayoutProps<` 처럼 앞이 잘린 토큰). dev 서버를 급히 죽이면 매니페스트 생성이 중간에 끊기고, 그 상태로 다음 dev 가 뜨면 그 세그먼트가 통째로 등록되지 않는다. `npm run build` 를 돌리면 이 깨진 파일 때문에 **typecheck 가 실패**해서 금방 드러난다
- **확인 방법**: `npm run build` 의 라우트 목록에 그 경로가 있으면 코드는 멀쩡하다

**그래서 HTTP end-to-end 는 이렇게 돌린다** (CI 와 같은 경로이기도 하다):
```bash
rm -rf .next && npm run build && npm run start   # 그다음 e2e 스크립트
```
dev 재시작·`.next/dev` 삭제로 풀린 적도 있지만 재현이 안 된다. 빌드는 항상 맞았다.

**node 의 strip-only TypeScript 모드 제약**: **파라미터 프로퍼티**(`constructor(readonly x: T)`)를 지원하지 않는다. `node --test` 가 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 로 죽는다. 명시적 필드로 쓴다.

**`window` capture 리스너의 `preventDefault()` 는 ProseMirror 를 막지 못한다.** 슬래시 메뉴가 이 때문에 조용히 새고 있었다(#27 에서 고침).
- ProseMirror 의 `handleKeyDown` 은 `view.dom` 의 리스너이고, `preventDefault()` 는 **브라우저 기본 동작**만 막는다. 이벤트는 그대로 타깃까지 내려간다
- 증상: `/` 메뉴에서 Enter 로 항목을 고르면 변환은 되는데 **그 직후 블록이 한 번 더 쪼개졌다**. 메뉴 쪽만 보면 원인이 안 보인다
- 막으려면 `stopPropagation()` 이다. capture 단계라 그 자리에서 전파가 끊긴다

**ProseMirror 스키마의 `+` 는 "0개가 되면 던진다"는 뜻이다.** `blockGroup: blockContainer+` 라 그룹의 자식을 전부 지우는 트랜잭션은 `tr.delete()` **그 자리에서** 던진다(저장할 때 걸리는 게 아니다).
- 해법은 **그룹 노드째** 지우는 것. 단 루트 그룹은 `doc` 의 필수 자식이라 지울 수 없어 빈 문단을 **먼저 넣고** 지운다 — 다 지운 뒤에 넣으려 하면 중간 상태가 이미 위반이다
- 여러 범위를 지울 때는 **뒤에서 앞으로.** 그러면 매핑이 필요 없다
- 테스트에서 `doc.check()` 를 부른다. 유효하지 않은 문서를 만들어 놓고도 그 경로를 안 지나가면 모른다

**⚠ 편집기 DOM(`view.dom` 안)에 속성·클래스를 직접 달지 마라.** 두 번 당했다(#30 · #31).
- ProseMirror 는 편집기 DOM 의 속성 변경을 MutationObserver 로 보고 "바깥에서 바뀌었다"로 처리한다(`DOMObserver.registerMutation` 의 attributes 분기)
- 결과 ①: 그 노드를 **모델 기준으로 다시 그린다**(`flush` → `markDirty` → `updateState`). 요소가 통째로 새로 생기고 달았던 속성은 사라진다. **토글 접기가 W4 부터 이렇게 동작하지 않았다**
- 결과 ②: 그 범위에 DOM selection 이 있으면 `selectionBetween` 으로 **선택을 새로 만든다**. 블록 선택이 이렇게 풀렸다
- `setAttribute` 는 **값이 같아도** mutation 을 일으킨다. "바뀔 때만 단다"로는 피할 수 없다
- 해법: 상태는 **데코레이션**으로 그리고(`collapse-plugin.ts`), 에디터 밖 UI 는 **에디터 바깥 요소**에 단다(`block-gutter.tsx` 의 프레임). 커스텀 선택은 `createSelectionBetween` 으로 지킨다
- 헤드리스 테스트로는 **절대** 안 보인다. `npm run e2e` 로 확인한다

**클립보드를 검증할 때**: `document.execCommand('copy')` 로는 **블록 선택을 복사할 수 없다.** 블록 선택은 캐럿이 없어 DOM 선택이 접혀 있고, 브라우저의 복사 명령은 선택이 비면 `copy` 이벤트 자체를 일으키지 않는다. 진짜 `Ctrl+C`(CDP `Input.dispatchKeyEvent`)로 해야 한다 — 그 차이 때문에 "직전에 복사해 둔 것이 그대로 붙는" 결과를 한참 들여다봤다. 무엇을 싣는지만 볼 때는 `new ClipboardEvent('copy', { clipboardData: new DataTransfer() })` 를 에디터에 직접 dispatch 하면 된다.

**`npm run e2e` 요령**
- 순서: `npm run db:up` → `npm run build` → `npm run e2e`. 서버는 스크립트가 **포트 3100** 으로 직접 띄운다(개발 서버 3000 과 안 겹친다). 빌드가 없으면 알려주고 멈춘다
- 프로덕션 모드의 서버는 메일 발송기를 기본값으로 두지 않는다(`MAIL_TRANSPORT` 미설정 → 500, 의도된 안전장치). 스크립트가 `MAIL_TRANSPORT=console` 을 넣고 로그인 코드를 서버 표준출력에서 읽는다. **서버를 손으로 띄워 확인할 때도 이 변수가 필요하다**
- 창을 보면서 따라가려면 `E2E_HEADFUL=1`. 브라우저를 못 찾으면 `E2E_BROWSER=<경로>`
- 검사가 실패하면 **추측하지 말고** `evaluate()` 로 DOM 상태를 찍거나 페이지에 MutationObserver 를 심어 본다. 접힘 버그는 그렇게 찾았다 — "화살표는 ▸ 인데 컨테이너에 속성이 없다"가 결정적 단서였다

---

## 7. 알려진 부채 · 미완

| 항목 | 상태 | 어디 |
|---|---|---|
| **검색 정렬 옵션 5종** | 없다. 랭킹은 **제목 우선 → 최근 수정순** 하나뿐이다(마스터 문서 W7 이 "랭킹은 최근 수정순"으로 범위를 정했다). F-07-02 가 공식 문구로 적은 `Best Matches` · `Last Edited: Newest/Oldest` · `Created: Newest/Oldest` 는 P1. 정렬 키가 합성 텍스트(`'1'/'0' + 시각`)이므로 축을 바꾸면 **커서가 호환되지 않는다** — 옵션을 추가할 때 커서에 정렬 종류를 실어야 한다 | `src/lib/search/search.ts` `buildSql` |
| **`ts_rank_cd` 관련도 랭킹** | 안 쓴다. 라틴 축에서는 거의 공짜지만 CJK 축에 대응물이 없어서, 쓰면 **한국어 검색과 영어 검색이 다른 규칙으로 정렬된다.** 주 언어가 한국어이므로 일관성을 골랐다. BM25 계열은 F-07-02 의 P0-랭킹이고 마스터 문서가 W7 밖으로 미뤘다 | 같은 곳 |
| **검색 필터 (F-07-03)** | 작성자·기간·위치 필터가 없다. 색인에 `created_by`·`created_at`·`ancestor_ids` 가 이미 있어 `WHERE` 절만 늘리면 된다 | 같은 곳 |
| **오타 fallback · 인기도 라벨** | `pg_trgm` similarity 를 0건일 때만 돌리는 fallback(F-07-02 권고)이 없다. 확장은 이미 설치돼 있다. `Most viewed` 류 라벨은 `recent_visit.visit_count` 가 있으니 집계만 하면 되지만 안 했다 | 같은 곳 |
| **`filter.in_trash: true`** | 휴지통 검색 옵션이 없다(`in_trash = false` 고정). 휴지통 목록은 별도 화면이 이미 한다 | 같은 곳 |
| **데이터베이스 노드의 DB 전용 레벨** | `effective()` 가 ACL 대상 종류를 `'page'` 로 고정한다. `view`·`comment`·`edit`·`full_access` 는 정본 §3.3 의 두 매트릭스에 같은 내용으로 있어 정상 동작하지만, **`edit_content`·`create` 레벨을 데이터베이스 노드에 직접 부여하면 조용히 무시된다**(page 에 정의되지 않은 레벨이라 `isDefinedLevel` 이 걸러낸다). 즉 "행은 추가하지만 컬럼은 못 고치는 사람"(정본이 `create` 로 표현한 것)을 아직 만들 수 없다. 고치려면 `node_kind` 를 `acl_entry` 에서 읽어 `resolveCaps` 까지 흘려야 한다 | `src/lib/permissions/effective.ts` `resolveCaps` |
| **인라인 데이터베이스** | 없다. `createDatabase` 는 **워크스페이스 직속 풀페이지 DB** 만 만든다. 페이지 본문 안에 만들면 프로젝터가 "문서에 없는 자식 블록"으로 보고 **그 페이지를 한 번 저장할 때 지운다**(`toDelete` 가 `type !== 'page'` 만 본다). 인라인은 블록 타입 레지스트리에 `database` 를 넣고 노드 뷰를 붙이는 작업과 **함께** 와야 한다 — 반쯤 만들면 데이터가 사라지는 경로가 열린다 | `src/lib/database/database.ts` 머리말 · `save-page-body.ts` |
| ~~셀 쓰기 API · 행 추가~~ | **해결.** `row.ts`(createRow · updateCells · clearCell · listRows · trashRow) + 마이그레이션 0014 의 R2 트리거 | `src/lib/database/row.ts` |
| **`page.search_tsv` 는 한국어로 검색되지 않는다** | 마이그레이션 0012 머리말의 실측과 같은 이유다(PostgreSQL 에 한국어 config 가 없어 `'검색'` 이 `'검색이'` 를 못 찾는다). `search_document` 는 pg_bigm 축을 함께 갖지만 정본 §3.5 는 `search_tsv` 하나만 정의했다. **아직 어떤 검색 경로도 이 컬럼을 읽지 않는다** — DB 안 검색(F-03-19 · F-07-14)이 올 때 bigm 축을 같이 만든다 | `db/migrations/0014_page_cache.sql` |
| **DB 행이 전역 검색에 안 걸린다** | DB 행은 `type='page'` 블록이라 `search_document` 행이 **생기기는 한다**(0012 의 트리거가 `WHEN NEW.type='page'`). 그런데 `title_text`·`body_text` 를 써 주는 경로가 없어 **색인에 있지만 찾을 수 없다.** 제목은 `row.ts` 의 `projectTitle` 이 `block.properties.title` 에 넣으므로 거기서 이어 주면 된다. F-07-01 이 "데이터베이스 엔트리 이름과 property 값"을 검색 대상으로 명시한다 | `src/lib/database/row.ts` · `src/lib/search/index-page.ts` |
| **행 복원 · 행 휴지통 목록** | `trashRow` 는 있지만 복원·영구삭제가 없다. 페이지 휴지통(`trash.ts`)은 삭제 루트·자손 계산을 하는데 행에는 자손이 없어서 빌려 쓰지 않았다 | `src/lib/database/row.ts` |
| **검색 전체 재색인 경로** | 없다. 마이그레이션 0012 의 백필은 **메타만** 넣고 `title_text` 를 NULL 로 남겼다(제목의 RichText[] 계약을 SQL 에 복제하지 않기 위해서다). 그래서 0012 이전에 만든 페이지는 **저장·이름변경이 한 번 일어날 때 검색 가능해진다.** 지금 데이터가 개발용뿐이라 재색인 잡을 만들지 않았다 — **운영 데이터가 생기기 전에 필요하다.** `indexPageText` 를 전체 페이지에 돌리는 스크립트면 된다 | `db/migrations/0012_search_document.sql` 꼬리 · `src/lib/search/index-page.ts` |
| **`ancestor_titles` 를 채우지 않는다** | 정본 §3.9 에 컬럼은 있고 값은 NULL 이다. breadcrumb 은 `ancestor_ids` 로 `block` 을 조인해 만든다 — 복사해 두면 조상 제목이 바뀔 때마다 서브트리 전체가 낡는다(F-07-04 가 `recent_visit` 에 대해 경고한 함정과 같다). 조인이 비싸지는 규모가 오면 채운다 | `0012_search_document.sql` |
| **tsvector 축은 본문 앞 10만 자만 본다** | tsvector 1MB 한도 때문이다(실측: 26만 자에서 넘는다). **pg_bigm 축은 전체를 보므로 한국어 검색은 안 잘린다** — 잘리는 것은 라틴 쿼리가 긴 영문 본문의 10만 자 뒤쪽을 못 찾는 경우뿐이다 | `0012_search_document.sql` 머리말 |
| **purge / hard-delete 배치 잡** | `purge_after` 가 지나도 자동으로 `purged` 가 되지 않는다. 수동 영구삭제만 있다. F-02-11 클론 대안이 "purge 배치는 초기엔 생략" 이라고 허용 | `src/lib/block/trash.ts` |
| ~~휴지통 권한 필터~~ | **해결(#41).** `readableScopes` 로 거른다 | `listTrash` |
| ~~사이드바 권한 필터~~ | **해결(#41).** 같은 함수 | `listPageTree` |
| **사이드바 펼침 상태가 기기별** | `localStorage`. 정본에 `sidebar_state` 테이블이 **없어서** 만들지 않았다(F-02-03 도 "제품 결정 필요"로 남김). 서버 동기화하려면 정본을 먼저 고친다 | `sidebar-state.ts` |
| **사이드바 드래그 이동 · 가상 스크롤 · 지연 로드** | 없다. 이동은 페이지 화면의 "이동" 피커로 한다. 트리는 한 번에 다 읽는다 — 정본은 "레벨별 지연 로드"를 요구한다(F-07-16) | `sidebar.tsx` · `listPageTree` |
| **사이드바 섹션 Shared/Private** | 즐겨찾기·최근은 생겼다(#43). `Shared`/`Private` 는 **권한 상태의 파생 뷰**라 `acl_entry` 로 계산할 수 있게 됐지만 아직 안 만들었다 | `sidebar.tsx` |
| **즐겨찾기 표시 개수 설정 · 드래그 재정렬 · 200건 GC** | 정본은 표시 개수를 "사용자 설정값"이라고 했다(`sidebar_section_pref`). `order_key` 자리는 만들어 뒀다 | `nav/recent.ts` |
| **B4 의 Private 루트** | 부모가 사라진 페이지를 복원하면 정본은 "복원 실행자의 Private 루트"로 보내라고 하지만, MVP 에 Private 루트가 없어 **워크스페이스 최상위**로 보낸다 | `trash.ts` `restorePage` |
| ~~페이지 단위 ACL~~ | **해결(#41 · #42).** `acl_entry` + `effective()` + 공유 패널. 루트 페이지는 `workspace_everyone → full_access` 를 갖고 태어난다 | `src/lib/permissions/` |
| **공개 링크 (F-06-06)** | `public` 주체가 `principalsOf` 에 없다. 표(`public_link`)도 아직 없다 — 정본 §3.3 에 정의는 있다 | `permissions/effective.ts` |
| **외부인 이메일 초대 (F-06-07 나머지)** | 공유 패널에서 고를 수 있는 사람은 **이미 워크스페이스 멤버**뿐이다. guest 좌석 정책(F-13-18)과 함께 와야 한다 | `share-panel.tsx` |
| **이동 시 권한 경고** | F-06-05: *"페이지 이동 → 상속 원천이 바뀌어 접근자 집합이 즉시 변함 → 경고 다이얼로그."* 이동은 되지만 경고가 없다 | `move-page-control.tsx` |
| **ACL provenance 컬럼** | 상속 되돌리기(P3)가 "부모 유래 행 삭제"를 못 한다(§3.3-34). 하려면 `acl_entry` 에 출처 컬럼이 필요하고 그건 정본 수정이다 | `permissions/acl.ts` `resumeInheriting` |
| **32자리 hex URL 정규화 (F-07-17)** | 정본: *"id 가 하이픈 없는 32자 hex 로 URL 에 실리므로 라우터는 양쪽을 모두 받아 정규화해야 한다. 빼먹으면 API 가 뱉은 id 를 URL 에 붙였을 때 404."* 지금은 하이픈 있는 uuid 만 받는다 | `asBlockId` · 라우트 |
| **teamspace** | 테이블이 없다. 그래서 루트 페이지가 곧 `perm_scope_id` 루트다 | `page.ts` `lockParent` |
| `code` 블록 | **MVP 12종에 없다.** 그래서 F-01-14 가 요구하는 "코드 블록 안에서 입력 규칙·키 전면 비활성"도 아직 할 것이 없다. 추가할 때 `if (type === 'code')` 를 심지 말고 레지스트리 항목으로 끈다 | `src/lib/block/types.ts` |
| **`ref_count = 0` 파일 GC** | 아무도 가리키지 않는 객체를 쓸어가는 잡이 없다. 부분 인덱스 `ix_file_unreferenced` 는 그 잡을 위해 미리 만들어 뒀다. **불변식 FS1(`ref_count > 0` 은 지우지 않는다)을 지키는 것이 GC 의 일**이고, 카운트는 이제 맞는다(#36) | `db/migrations/0009_file.sql` · `src/lib/file/` |
| **R2(S3 호환) 드라이버** | 로컬 디스크 드라이버 하나뿐이다. 서버가 둘 이상이면 서로 다른 디스크를 본다. 들어올 자리는 `FileStorage` 세 함수이고, 그때 `/content` 라우트가 **그 자리에서 만든 서명 URL 로 302** 하면 된다(저장하지 않는다 — FS2). MinIO 는 금지 | `src/lib/file/storage.ts` 머리말 |
| **업로드 재시도 · 취소** | 올리는 중에 끊기면 그 블록은 빈 채로 남고 재시도 버튼이 없다(다시 고르면 된다). `F-05-04`(outbox)와 같은 문제다 | `src/lib/file/upload-client.ts` · `image-view.ts` |
| **이미지 캡션 편집 · 크기 조절 · 정렬** | 저장 모양(`caption` RichText[])과 읽기·쓰기·검증은 있고 `img.alt` 로도 쓰이지만 **편집 UI 가 없다.** 원자 노드 안에 편집 영역을 두면 캐럿·선택이 두 개가 되므로 설계를 급히 정하지 않았다. `format.block_width` 는 F-01-15 의 P1 | `src/lib/block/image.ts` · `image-view.ts` |
| **파일 드롭 가이드선** | 블록 드래그(#30)에는 파란 가이드가 있지만 파일 드롭에는 없다(`dropCursor` 기본 표시에 기댄다). 붙이려면 `dropCandidates` 의 좌표 규칙을 공유해야 한다 | `image-drop.ts` · `block-handle.ts` |
| **이미지 외의 파일 · 북마크 · 임베드** | 받지 않고 이유를 말한다. F-01-15 의 P1(file·bookmark·video) / P2(embed·pdf·audio). **OG 크롤러는 SSRF 의 교과서적 진입점**이라 붙일 때 아웃바운드 차단이 먼저다 | `image-drop.ts` `partitionImageFiles` |
| 파일 표의 `ON DELETE` 정책 | `file.uploaded_by` 를 포함해 저장소의 **모든** FK 가 `ON DELETE` 절 없이(=`NO ACTION`) 있다. 계정 삭제 경로가 생기면 표 전체에 한 번에 정한다. ⚠ PR #35 본문이 처음에 "SET NULL 로 끊었다"고 잘못 적었다가 정정됐다 | `db/migrations/*.sql` |
| 핸들 메뉴 | 없다(§2 의 1번). 핸들 클릭은 블록 선택까지만 한다 | `block-gutter.tsx` |
| 드래그 부가 기능 | spring-loaded 자동 펼침(접힌 토글 위에 머물면 펼치기) · 가장자리 자동 스크롤 · 터치 롱프레스 · 여백 드래그 마퀴 선택이 없다. 접힌 토글 **안에 놓으면** 펼치는 것은 있다 | `block-gutter.tsx` · `block-handle.ts` |
| 비연속 블록 선택(`Alt+Shift+클릭`) | 없음. 정본이 P1 로 자른 것 | `block-selection.ts` |
| 복붙의 P1·P2 | **외부 HTML·마크다운을 블록으로 파싱하지 않는다**(P1). 우리가 내보낸 HTML 은 스키마의 파싱 규칙으로 되읽지만, 남의 사이트에서 복사한 HTML 은 ProseMirror 기본 파서가 처리하는 만큼만 된다. URL 붙여넣기 형태 선택(P2)·`Mod+Shift+V` 전용 경로·Notion-flavored enhanced markdown 도 없다 | `block-clipboard.ts` |
| ~~이미지·파일의 참조 카운트~~ | **해결(#36).** 프로젝터가 문서 전체의 파일 참조를 세므로 복사·붙여넣기도 자동으로 `ref_count` 를 올린다. 남은 것은 그 카운트를 쓰는 GC(위) | `src/lib/block/image.ts` · `save-page-body.ts` |
| 브라우저 검증의 빈자리 | `npm run e2e`(#31)가 117개 항목을 **실제 입력으로** 확인한다 — 핸들·드래그·선택·이동·접힘·`+`·자동 저장·복붙·이미지(업로드·드롭·붙여넣기)·오프라인 저장 큐·공유 패널·즐겨찾기. **IME(한글 조합)·일반 타이핑은 아직 검사가 없다** — CDP 의 `Input.imeSetComposition` 으로 조합을 흉내낼 수 있다. 드롭·붙여넣기는 합성 `DragEvent`/`ClipboardEvent` 라 **OS 수준 드래그는 재현하지 않는다**(파일 선택은 `DOM.setFileInputFiles` 로 진짜다). 네트워크 실패는 `Network.setBlockedURLs` 로 **저장 라우트만** 막는다(전체를 끊으면 페이지 자체가 안 열려 새로고침 시나리오를 볼 수 없다). **CI 에는 아직 넣지 않았다** — 로컬에서 안정적으로 초록인지 먼저 쌓는다. 한 번 도는 데 1분 남짓이다 | `scripts/e2e-editor.mjs` |
| 테스트의 `assert.equal(run(...), null)` 패턴 | 기존 에디터 테스트 곳곳에 있다. **실패하는 날 CI 가 실패 대신 잡 타임아웃까지 매달린다**(§5). 지금은 전부 통과해서 드러나지 않는다. 새 테스트는 `assert.ok(x === null)` 로 쓴다 | `src/lib/editor/*.test.ts` |
| 좌석 한도 강제 | 자리만 있고 막지 않음 | `src/lib/workspace/invite.ts` `checkSeatAvailable` `TODO(F-13-18)` |
| 실제 메일 발송 | 개발용 콘솔 출력만 | `src/lib/auth/mailer.ts`, `invite-mailer.ts` |
| `x-forwarded-for` 신뢰 | 기본값 0. 배포 시 `TRUSTED_PROXY_HOP_COUNT` 필요 | `src/lib/auth/request-meta.ts` |
| 도메인 문서 소급 수정 | 01~17 문서에 폐기된 스키마가 남아 있음 | 정본 `00-*`이 항상 이긴다 |
| `LICENSE` 파일 | 없음. 저장소가 Public인데 기본 저작권 상태 | 저장소 루트 |
| 초대 ②③④ 경로 | 미구현. 명세가 MVP에서 직접 자름 | `src/lib/workspace/invite.ts` 머리말 |

---

## 8. 새 세션 시작 프롬프트

아래를 그대로 붙여넣으면 된다.

```
C:\VibeCoding\notion 에서 노션 클론을 이어서 만든다.

CLAUDE.md 와 docs/HANDOFF.md 를 먼저 읽어라. 특히:
- 절대 제약 3개 (무료 라이브러리만 / LLM 토큰 하드 캡 / 정본 우선)
- 문서 계층 — docs/research/00-canonical-data-model.md 가 스키마 정본이다.
  01~17 도메인 문서에는 판결로 폐기된 스키마가 남아 있으니 충돌하면 정본이 이긴다
- HANDOFF §2 다음 작업 · §3 이미 내린 판결(같은 것을 다시 판단하지 마라) · §7 알려진 부채

Phase 0 의 W1~W5 가 끝났고 W6 도 대부분 끝났다 —
편집 확장·이미지(PR #27~#37) · 저장 큐와 오류 UX(#39 #40) ·
페이지 권한과 공유 패널(#41 #42) · 최근 방문·즐겨찾기(#43).

다음은 W7 검색이다(F-07-01 · F-07-06 · F-07-07). 정본이 물리 구현까지
정해 뒀다 — search_document 실테이블 + tsvector GENERATED + GIN + pg_bigm
(한국어 2-gram, npm run db:verify 가 이미 설치를 확인한다). 권한은
post-filter 가 아니라 **쿼리 필터 안에** 들어간다:
WHERE perm_scope_id = ANY(:scopes). 그 scopes 를 만드는 함수는 이미 있다 —
src/lib/permissions/effective.ts 의 readableScopes.
착수 전에 docs/research/07-search-navigation.md 의 F-07-01 과
00-canonical-data-model.md §3.9(검색 쿼리 형태)를 읽어라.

작업 순서:
  브랜치 → 구현+테스트 → npm run check → npm run db:verify:schema
  → (화면에 기대는 것이면) npm run build && npm run e2e
  → PR → CI 두 잡 통과 확인(db 잡의 skip 이 0인지도 본다) → squash 머지

PR 본문에는 "왜 이렇게 했는가"를 쓴다 — 정본과 다르게 한 것, 실패했다가
고친 것, 의도적으로 안 만든 것.

시간을 아끼려면 (전부 이전 세션에서 실제로 당한 것, 자세한 건 HANDOFF §6):
- HTTP 로 API 를 확인할 때는 `npm run build && npm run start` 를 쓴다.
  next dev 는 새 라우트를 등록하지 않는 일이 있고, 그때 404 응답의
  content-type 이 text/html 이다(= 우리 404 가 아니라 Next 의 404)
- 머지 후 `git checkout main` 하면 브랜치가 지워져 main 에 서 있다.
  다음 작업 전에 반드시 새 브랜치를 판다 — 두 번 main 에 커밋했다
- `npx prettier` 를 그냥 돌리지 마라. 설정이 없어 저장소 스타일
  (작은따옴표·세미콜론 없음)을 통째로 뭉갠다
- 비-ASCII 가 섞인 긴 문자열 치환은 스크립트 대신 Edit 도구로 한다.
  **백슬래시가 있으면 특히 그렇다** — 스크립트로 넘기는 동안 `\n` 이 진짜 줄바꿈으로
  바뀌어 앵커가 안 맞는다(W6-a 에서 verify-schema.mjs 를 고치다 또 걸렸다)
- `npm test` 만 돌리면 DB 테스트가 **조용히 빠진다**(카운트에도 안 잡힌다).
  `npm run db:up` 을 먼저 해야 835개가 다 돈다 — CI 의 db 잡과 같은 수여야 한다
- 문서 구조를 바꾸는 트랜잭션을 짤 때 `blockGroup: blockContainer+` 를 기억해라.
  자식을 전부 옮기거나 지우면 `tr.delete()` 가 그 자리에서 던진다(§6)
- 편집기 DOM(view.dom 안)에 속성·클래스를 직접 달지 마라. ProseMirror 가 다시
  그리며 지우고 선택까지 새로 만든다 — 데코레이션으로 그린다(§6). 헤드리스
  테스트로는 안 보인다. npm run e2e 로 본다
- 테스트에서 assert.equal(EditorState, null) 을 쓰지 마라. 실패하면 멈춘다.
  assert.ok(x === null, '…') 로 쓴다(§5)
- 새 검사를 쓰면 수정 전 코드에서 그 검사가 실제로 실패하는지 돌려 본다(§5)
```
