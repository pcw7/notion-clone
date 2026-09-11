# 인수인계

새 세션이 이어받을 때 읽는 문서. **[CLAUDE.md](../CLAUDE.md)를 먼저 읽고 여기로 온다** — 거기에 절대 제약·스택·명령어·코딩 규칙이 있고, 이 문서는 **"지금 어디까지 왔고 다음에 뭘 하는가"**만 다룬다.

최종 갱신: 2026-09-12 (PR #31 머지 시점 — **W5-b 진행 중: 선택·이동·접힘 완료**)

---

## 1. 지금 어디까지 왔나

**Phase 0 (MVP, 6~8주) 중 W1–W4 · W5-a 완료. W5-b 진행 중(선택 · 이동 · 접힘까지).**

| 주차 | 내용 | 상태 | PR |
|---|---|---|---|
| W1 | 스키마 · 인증 | ✅ | #3 #6 #7 #8 |
| W2 | 계약 고정 (권한) | ✅ | #4 |
| W2 | 계약 고정 (API — RichText · 페이지네이션) | ✅ | #10 |
| W3 | 블록 모델 | ✅ | #9 #10 |
| W4 | 에디터 코어 | ✅ | #12 #13 #14 #15 #16 #17 #18 #19 |
| W5-a | 페이지 트리 | ✅ | #21(이동) #22(휴지통) #23(본문 안 중첩) #24(`/page`) #25(사이드바) |
| **W5-b** | **편집 확장 · 파일** | **진행 중** | #27(선택) #29(키보드 이동) #30(핸들·드래그) #31(접힘 수정·e2e) |
| W6 | 내비게이션 · 권한 | | |
| W7 | 검색 | | |
| W8 | DB 코어 · 뷰 | | |

**동작하는 것**: 이메일 OTP 로그인 → 워크스페이스 생성 → 이메일 초대 → 수락 → 워크스페이스 진입 → 페이지 생성 → 본문 편집(12종 블록 · 분할/병합 · 중첩 · `/` 메뉴 · 마크다운 · 서식) → 자동 저장 → 하위 페이지 → 페이지 이동 → 휴지통 · 복원 · 영구 삭제 → 멀티 블록 선택(Esc · Shift+↑↓ · 일괄 삭제/변환/복제/서식) → **블록 이동(`Mod+Shift+↑↓` · `⋮⋮` 드래그) · `+` 버튼 · 토글 접기**.
`npm run dev` 로 실제로 눌러볼 수 있고, **`npm run e2e` 가 실제 브라우저로 32개 항목을 확인한다**(#31).

**숫자**: 마이그레이션 8개 / 테이블 24개 / 테스트 618개(CI skip 0) + 브라우저 검증 32개 / PR 31개 머지.

---

## 2. 다음 작업 — W5-b 편집 확장

로드맵(마스터 문서 §5.2)의 정확한 F-ID:

| 구간 | F-ID | 상태 |
|---|---|---|
| **W5-a** 페이지 트리 | `F-02-01` `F-02-02` `F-02-13` `F-02-08` `F-02-15` `F-02-16` `F-11-05` | 아래 참조 |
| **W5-b** 편집 확장 · 파일 | `F-01-08` `F-01-09` `F-01-10` `F-01-13` `F-01-15` `F-12-09` `F-09-08` `F-05-04` `F-12-16` | 아래 참조 |

W5-b 항목별 상태:

| F-ID | 무엇 | 상태 |
|---|---|---|
| `F-01-09` | 멀티 블록 선택 | ✅ #27 (#30 에서 접힌 토글 선택 풀림 수정) |
| `F-01-08` | 드래그·상하 이동 + 핸들 | ✅ P0 — #29(키보드) #30(드래그·`+`·클릭 선택). **핸들 메뉴는 아직**(아래 1번) |
| `F-01-13` | 토글 접기 | ✅ #31 — W4 부터 **브라우저에서는 자식이 안 숨겨지던** 버그를 고쳤다 |
| `F-01-10` | 복붙 구조 보존 | 미착수 (아래 2번) |
| `F-01-15` · `F-09-08` · `F-12-09` | 이미지 업로드 · 업로드 API · 스토리지 | 미착수. 정본이 "3층 분리"로 확정(G31) — `file` 엔티티는 F-12-09 단독 소유 |
| `F-05-04` | 낙관적 업데이트 · outbox | 미착수. 없으면 네트워크 단절 시 입력이 사라진다 |
| `F-12-16` | 오류 · 복구 UX | 미착수 |

> ⚠ 이전 판의 이 문단은 `F-02-04`(=즐겨찾기)를 "휴지통"으로 잘못 적어 뒀다.
> 휴지통은 **`F-11-05` / `F-02-11`**, 이동은 **`F-02-08`** 이다.

W5-a 중 **이미 된 것**: `F-02-01`(page-as-block) · `F-02-15`(breadcrumb) · `F-02-16`(`/{uuid}` 라우팅) ·
`F-02-02`(무한 중첩 — 생성/이동/본문 안 중첩은 되고 사이드바 트리만 없음) · `F-02-08`(이동) · `F-11-05`(휴지통 3상태) ·
`F-02-13`(서브페이지 — `/page`. @멘션·link_to_page 는 명세가 P1 로 자른다) · `F-02-03`(사이드바 트리).
**W5-a 는 끝났다.**
W4 에서 미리 들어간 것: `F-01-07`(Tab 중첩) · `F-01-13`(토글 접힘, 로컬 상태 — **단 브라우저에서는 #31 전까지 자식이 숨겨지지 않았다**).

**권장 순서**
1. **핸들 메뉴** (`F-01-08` 의 나머지) — **다음. 작다.** `⋮⋮` 를 누르면 블록 선택이 이미 된다(#30,
   `selectHandleTargetsCommand`). 메뉴 항목의 동작도 전부 있다 — Turn into(`turnSelectionIntoCommand`) ·
   Duplicate(`duplicateBlockSelectionCommand`) · Delete(`deleteBlockSelectionCommand`) · 색(`setTextColor` 는
   #30 에서 범위 전부를 칠하게 고쳤다). 남은 것은 **메뉴 UI 와 키보드 조작**(`role="menu"`, F-12-13)뿐이다.
   `Move to`(다른 페이지로 이송)는 정본이 P1 으로 잘랐다.
2. **복붙 구조 보존** (`F-01-10`) — 단일 contenteditable 이라 "블록 경계를 넘는 부분 선택"은 이미 공짜로 된다.
   내부 복사의 슬라이스도 `BlockSelection.content()` 가 이미 돌려준다(openStart/openEnd 0).
   붙여넣은 블록의 중복 id 는 `blockIdPlugin` 이 이미 새로 찍는다. 남은 것은 커스텀 MIME · `text/plain` ·
   붙여넣기 파서(입력 규칙과 **별개 규칙 집합** — F-01-02 GAP 2회차의 `>` 충돌)다.
3. **이미지 업로드** (`F-01-15` + `F-09-08` + `F-12-09`) — presigned PUT. 지금은 URL 만 받는다. 스토리지는 R2(CLAUDE.md 절대 제약 1).

**착수 전에 읽을 것**
- `docs/research/01-block-editor.md` F-01-08(핸들 메뉴 항목) / F-01-10
- `docs/research/12-platform-ux.md` F-12-13(메뉴는 `role="menu"` · 포커스 · Esc 복귀)

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
- **검사가 실제로 실패하는지 반대 경우를 돌려 본다.** 수정 전 코드(또는 수정의 일부를 뺀 코드)에서 새 검사가 **정확히 그 항목만** 실패해야 그 검사가 회귀를 잡는다. #30·#31 에서 이렇게 확인했다 — "훅을 빼면 3개 실패", "컨테이너에만 달면 화살표 검사만 실패".
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

**`npm run e2e` 요령**
- 순서: `npm run db:up` → `npm run build` → `npm run e2e`. 서버는 스크립트가 **포트 3100** 으로 직접 띄운다(개발 서버 3000 과 안 겹친다). 빌드가 없으면 알려주고 멈춘다
- 프로덕션 모드의 서버는 메일 발송기를 기본값으로 두지 않는다(`MAIL_TRANSPORT` 미설정 → 500, 의도된 안전장치). 스크립트가 `MAIL_TRANSPORT=console` 을 넣고 로그인 코드를 서버 표준출력에서 읽는다. **서버를 손으로 띄워 확인할 때도 이 변수가 필요하다**
- 창을 보면서 따라가려면 `E2E_HEADFUL=1`. 브라우저를 못 찾으면 `E2E_BROWSER=<경로>`
- 검사가 실패하면 **추측하지 말고** `evaluate()` 로 DOM 상태를 찍거나 페이지에 MutationObserver 를 심어 본다. 접힘 버그는 그렇게 찾았다 — "화살표는 ▸ 인데 컨테이너에 속성이 없다"가 결정적 단서였다

---

## 7. 알려진 부채 · 미완

| 항목 | 상태 | 어디 |
|---|---|---|
| **purge / hard-delete 배치 잡** | `purge_after` 가 지나도 자동으로 `purged` 가 되지 않는다. 수동 영구삭제만 있다. F-02-11 클론 대안이 "purge 배치는 초기엔 생략" 이라고 허용 | `src/lib/block/trash.ts` |
| **휴지통 권한 필터** | 워크스페이스 멤버 전원이 모든 휴지통 항목을 본다. F-11-05 는 "권한 필터 누락 시 제목 유출"이라고 못박는다 | `listTrash` 의 `TODO(W6)` |
| **사이드바 권한 필터** | 같은 문제. F-02-03: "접근 권한 없는 페이지 → **존재도 노출 금지**" | `listPageTree` 의 `TODO(W6)` |
| **사이드바 펼침 상태가 기기별** | `localStorage`. 정본에 `sidebar_state` 테이블이 **없어서** 만들지 않았다(F-02-03 도 "제품 결정 필요"로 남김). 서버 동기화하려면 정본을 먼저 고친다 | `sidebar-state.ts` |
| **사이드바 드래그 이동 · 섹션 · 가상 스크롤** | 없다. 이동은 페이지 화면의 "이동" 피커로 한다. 섹션(Favorites/Teamspace/Shared/Private)은 권한이 없어 **파생될 근거가 없다** | W6 |
| **B4 의 Private 루트** | 부모가 사라진 페이지를 복원하면 정본은 "복원 실행자의 Private 루트"로 보내라고 하지만, MVP 에 Private 루트가 없어 **워크스페이스 최상위**로 보낸다 | `trash.ts` `restorePage` |
| **페이지 단위 ACL** | 없다. **워크스페이스 멤버 전원이 모든 페이지를 본다** | `src/lib/block/page.ts` `getPage` 의 `TODO(W6 / F-06-*)` |
| **teamspace** | 테이블이 없다. 그래서 루트 페이지가 곧 `perm_scope_id` 루트다 | `page.ts` `lockParent` |
| `code` 블록 | **MVP 12종에 없다.** 그래서 F-01-14 가 요구하는 "코드 블록 안에서 입력 규칙·키 전면 비활성"도 아직 할 것이 없다. 추가할 때 `if (type === 'code')` 를 심지 말고 레지스트리 항목으로 끈다 | `src/lib/block/types.ts` |
| 이미지 업로드 | URL 만. 업로드·크롤러 보안은 F-01-15(Phase 1) | `node-views.ts` |
| 핸들 메뉴 | 없다(§2 의 1번). 핸들 클릭은 블록 선택까지만 한다 | `block-gutter.tsx` |
| 드래그 부가 기능 | spring-loaded 자동 펼침(접힌 토글 위에 머물면 펼치기) · 가장자리 자동 스크롤 · 터치 롱프레스 · 여백 드래그 마퀴 선택이 없다. 접힌 토글 **안에 놓으면** 펼치는 것은 있다 | `block-gutter.tsx` · `block-handle.ts` |
| 비연속 블록 선택(`Alt+Shift+클릭`) | 없음. 정본이 P1 로 자른 것 | `block-selection.ts` |
| 브라우저 검증의 빈자리 | `npm run e2e`(#31)가 핸들·드래그·선택·이동·접힘·`+`·자동 저장을 **실제 입력으로** 확인한다. **IME(한글 조합)·일반 타이핑·붙여넣기는 아직 검사가 없다** — CDP 의 `Input.imeSetComposition` 으로 조합을 흉내낼 수 있다. **CI 에는 아직 넣지 않았다** — 로컬에서 안정적으로 초록인지 먼저 쌓는다 | `scripts/e2e-editor.mjs` |
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

Phase 0 W1~W4 와 W5-a(페이지 트리)가 끝났고, W5-b 는 블록 선택(F-01-09) ·
이동(F-01-08 P0 — 키보드·드래그) · 토글 접기(F-01-13)까지 끝났다(PR #27~#31).
다음은 핸들 메뉴(F-01-08 의 나머지)다 — 작다. ⋮⋮ 클릭이 이미 블록 선택을
만들고, 메뉴 항목의 동작(변환·복제·삭제·색)도 전부 있다. 남은 것은 메뉴 UI 와
키보드 조작(role="menu")뿐이다. 그다음이 복붙 구조 보존(F-01-10).
착수 전에 docs/research/01-block-editor.md 의 F-01-08(핸들 메뉴 항목) ·
F-01-10, 12-platform-ux.md 의 F-12-13(메뉴 접근성) 을 읽어라.

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
- 비-ASCII 가 섞인 긴 문자열 치환은 스크립트 대신 Edit 도구로 한다
- `npm test` 만 돌리면 DB 테스트가 **조용히 빠진다**(카운트에도 안 잡힌다).
  `npm run db:up` 을 먼저 해야 618개가 다 돈다 — CI 의 db 잡과 같은 수여야 한다
- 문서 구조를 바꾸는 트랜잭션을 짤 때 `blockGroup: blockContainer+` 를 기억해라.
  자식을 전부 옮기거나 지우면 `tr.delete()` 가 그 자리에서 던진다(§6)
- 편집기 DOM(view.dom 안)에 속성·클래스를 직접 달지 마라. ProseMirror 가 다시
  그리며 지우고 선택까지 새로 만든다 — 데코레이션으로 그린다(§6). 헤드리스
  테스트로는 안 보인다. npm run e2e 로 본다
- 테스트에서 assert.equal(EditorState, null) 을 쓰지 마라. 실패하면 멈춘다.
  assert.ok(x === null, '…') 로 쓴다(§5)
- 새 검사를 쓰면 수정 전 코드에서 그 검사가 실제로 실패하는지 돌려 본다(§5)
```
