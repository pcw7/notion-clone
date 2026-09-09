# 인수인계

새 세션이 이어받을 때 읽는 문서. **[CLAUDE.md](../CLAUDE.md)를 먼저 읽고 여기로 온다** — 거기에 절대 제약·스택·명령어·코딩 규칙이 있고, 이 문서는 **"지금 어디까지 왔고 다음에 뭘 하는가"**만 다룬다.

최종 갱신: 2026-09-09 (PR #19 머지 시점 — W4 완료)

---

## 1. 지금 어디까지 왔나

**Phase 0 (MVP, 6~8주) 중 W1–W4 완료. 다음은 W5.**

| 주차 | 내용 | 상태 | PR |
|---|---|---|---|
| W1 | 스키마 · 인증 | ✅ | #3 #6 #7 #8 |
| W2 | 계약 고정 (권한) | ✅ | #4 |
| W2 | 계약 고정 (API — RichText · 페이지네이션) | ✅ | #10 |
| W3 | 블록 모델 | ✅ | #9 #10 |
| W4 | **에디터 코어** | ✅ | #12 #13 #14 #15 #16 #17 #18 #19 |
| **W5** | **페이지 트리 · 편집 확장** | **다음** | — |
| W6 | 내비게이션 · 권한 | | |
| W7 | 검색 | | |
| W8 | DB 코어 · 뷰 | | |

**동작하는 것**: 이메일 OTP 로그인 → 워크스페이스 생성 → 이메일 초대 → 수락 → 워크스페이스 진입 → **페이지 생성 → 본문 편집(12종 블록 · 분할/병합 · 중첩 · `/` 메뉴 · 마크다운 · 서식) → 자동 저장 → 하위 페이지**.
`npm run dev` 로 실제로 눌러볼 수 있다.

**숫자**: 마이그레이션 8개 / 테이블 24개 / 테스트 424개(CI skip 0) / PR 19개 머지.

---

## 2. 다음 작업 — W5 페이지 트리 · 편집 확장

로드맵(마스터 문서 §5.2)의 W5 F-ID: `F-02-01` `F-02-04` `F-01-07` `F-01-13` `F-01-09` `F-01-08` `F-01-10`

W4 에서 이미 들어간 것: `F-01-07`(Tab 중첩) · `F-01-13`(토글 접힘, 로컬 상태). 남은 것이 W5 의 실체다.

**권장 순서**
1. **페이지 이동 · 휴지통 · 복원** (`F-02-04`) — 정본 §3.4 의 상태 전이 표가 이미 규칙을 다 정해 뒀다.
   서브트리 이동은 `ancestor_path @> ARRAY[:id]` 단일 UPDATE + `perm_scope_id` 재계산(판결 X-7 · §3.11 트리거 5개).
   **이걸 먼저 해야** `savePageBody` 의 `page_ref_nested` 제약(아래 §7)을 풀 수 있다.
2. **사이드바 페이지 트리** — 부분 로드(`F-01-22` API 계약)를 염두에 두고 만든다.
3. **멀티 블록 선택**(`F-01-09`) → **드래그·상하 이동**(`F-01-08`) → **복붙 구조 보존**(`F-01-10`).
   순서가 이렇다: 선택 모드가 없으면 이동도 복붙도 대상이 없다. `Escape` 로 진입하는 블록 선택 모드는
   `keymap.ts` 의 `selectBlockCommand()` 로 자리만 잡아 뒀다.

**착수 전에 읽을 것**
- `docs/research/02-page-workspace.md` F-02-04(휴지통·복원), `00-canonical-data-model.md` §3.4 상태 전이 표
- `docs/research/01-block-editor.md` F-01-09 / F-01-10 (특히 "블록 경계를 넘는 부분 선택"이 이미 성립한다는 점 — 단일 contenteditable 이라 공짜로 얻었다)

**이미 준비된 것 (다시 만들지 말 것)**
- `src/lib/editor/block-rules.ts` — 분할·병합 **결정** 함수. ProseMirror 를 모른다
- `src/lib/editor/tree.ts` — `flattenVisible()`. 화면 순서 평탄화 + O(1) 이웃
- `src/lib/editor/rich-text-ops.ts` — 오프셋·분할·이어붙이기 (상한 초과 시 거부)
- `src/lib/editor/document.ts` — `EditorDoc` 계약 · 검증 · 행↔문서 변환 · 투영
- `src/lib/block/save-page-body.ts` — **프로젝터**. Phase 1 에서 상류만 Y.Doc 으로 바뀐다
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

---

## 4. 작업 리듬 (지금까지 지켜온 것)

```
1. 정본 문서를 먼저 읽는다        ← 기억으로 쓰지 않는다
2. git checkout -b <타입>/<이름>
3. 구현 + 테스트
4. npm run check  (typecheck · lint · license · test)
5. npm run db:verify:schema
6. 커밋 → 푸시 → gh pr create
7. CI 두 잡 통과 확인 (db 잡의 skip 이 0인지도 본다)
8. gh pr merge --squash --delete-branch
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
- **입력 규칙은 한 글자씩 타이핑해 확인한다.** `handleTextInput` 을 직접 부른다 — 텍스트를 한 번에 넣으면 규칙이 아예 돌지 않아 "패턴은 맞는데 트리거되지 않는" 경우를 놓친다.
- **DB 테스트는 `REQUIRE_DB=1`로 CI에서 강제한다.** 조용히 skip되면 그 테스트는 썩는다.
- 마이그레이션을 추가하면 `scripts/verify-schema.mjs`의 `EXPECTED_TABLES`도 갱신한다.

---

## 6. 세션 운영 요령 (실제로 겪은 것)

**WSL2가 유휴 상태에서 VM을 내린다.** 그러면 Postgres·Valkey도 같이 멈춘다.
- 증상: `ECONNREFUSED 127.0.0.1:5432` (message 는 **비어 있고** `code` 에만 정보가 있다)
- 대응: `npm run db:up` 한 번. healthy까지 기다려준다
- **이 세션에서 4번 겪었다.** 명령을 여러 개 이어 쓸 때는 `npm run db:up >/dev/null 2>&1;` 를 **매번** 앞에 붙인다. 테스트 도중에도 내려간다 — `npm run check` 가 한 번은 skip 83개로 끝났다
- `.wslconfig`의 `vmIdleTimeout=-1`은 **WSL 2.7.13에서 동작하지 않는 것을 확인**했다. 넣지 마라

**`.env` 로드**: 스크립트는 자체적으로 `.env`를 읽지만, 셸에서 직접 `node --test`를 돌릴 땐 `set -a; source .env; set +a` 가 필요하다.

**dev 서버는 끝나면 반드시 끈다.**
```bash
node -e 'const{execSync}=require("child_process");
  const out=execSync("powershell -NoProfile -Command \"Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess\"",{encoding:"utf8"});
  for(const pid of out.split(/\s+/).filter(Boolean)) try{process.kill(Number(pid))}catch(e){}'
```

**긴 문자열 치환에 스크립트 + `replace`를 쓰면 조용히 실패한다.** 이 세션에서도 한 번 당했다(한글·`·` 같은 비-ASCII가 섞인 앵커에서 heredoc 인코딩이 어긋났다). **파일 수정은 Edit 도구를 쓴다.** 스크립트로 치환했다면 `assert` 를 넣고 `grep`으로 반영을 확인한다.

**node 의 strip-only TypeScript 모드 제약**: **파라미터 프로퍼티**(`constructor(readonly x: T)`)를 지원하지 않는다. `node --test` 가 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 로 죽는다. 명시적 필드로 쓴다.

---

## 7. 알려진 부채 · 미완

| 항목 | 상태 | 어디 |
|---|---|---|
| **하위 페이지를 본문 블록 안에 중첩** | `page_ref_nested` 로 **거부한다.** 허용하려면 그 서브트리 전체의 `ancestor_path` 일괄 UPDATE(X-7)가 필요하고 그건 W5 의 일 | `src/lib/block/save-page-body.ts` |
| **페이지 이동 · 삭제 · 휴지통 · 복원** | 미구현. `lifecycle` 전이 코드가 없다(테스트만 수동으로 UPDATE 한다) | W5 |
| **페이지 단위 ACL** | 없다. **워크스페이스 멤버 전원이 모든 페이지를 본다** | `src/lib/block/page.ts` `getPage` 의 `TODO(W6 / F-06-*)` |
| **teamspace** | 테이블이 없다. 그래서 루트 페이지가 곧 `perm_scope_id` 루트다 | `page.ts` `lockParent` |
| `code` 블록 | **MVP 12종에 없다.** 그래서 F-01-14 가 요구하는 "코드 블록 안에서 입력 규칙·키 전면 비활성"도 아직 할 것이 없다. 추가할 때 `if (type === 'code')` 를 심지 말고 레지스트리 항목으로 끈다 | `src/lib/block/types.ts` |
| 이미지 업로드 | URL 만. 업로드·크롤러 보안은 F-01-15(Phase 1) | `node-views.ts` |
| Cmd+D 복제 · 블록 선택 모드 이동 단축키 | 미구현(F-01-09/F-01-08 과 함께) | `keymap.ts` |
| 브라우저에서의 타이핑 검증 | **이 세션에서는 하지 않았다.** HTTP end-to-end(페이지 생성 → 본문 저장 → 왕복 → 409 충돌 → 화면 렌더)까지는 dev 서버로 확인했고, 캐럿·IME·`/` 메뉴는 **헤드리스 테스트로만** 검증됐다. 브라우저 자동화 도구를 아직 넣지 않았다 | — |
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
- 문서 계층 — docs/research/00-canonical-data-model.md 가 스키마 정본이다
- HANDOFF §2 다음 작업, §3 이미 내린 판결, §6 세션 운영 요령

Phase 0 W1~W4 가 끝났고 다음은 W5 페이지 트리 · 편집 확장이다.
W5 의 첫 항목은 페이지 이동·휴지통·복원(F-02-04)이다 — 정본 §3.4 의 상태 전이
표에 규칙이 이미 다 있고, 이걸 해야 savePageBody 의 page_ref_nested 제약이 풀린다.

작업은 브랜치 → 구현+테스트 → npm run check → PR → CI 확인 → 머지 순서로 한다.
```
