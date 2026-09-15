# 인수인계

새 세션이 이어받을 때 읽는 문서. **[CLAUDE.md](../CLAUDE.md)를 먼저 읽고 여기로 온다** — 거기에 절대 제약·스택·명령어·코딩 규칙이 있고, 이 문서는 **"지금 어디까지 왔고 다음에 뭘 하는가"**만 다룬다.

최종 갱신: 2026-09-15 (PR #77 시점 — Phase 0 MVP · Phase 1 의 첫 항목 익스포트(F-09-14) v1 이 닫혔다. **Phase 1 CRDT 동시편집(F-05-01) 진행 중 — 1조각(Y.Doc 본문 계약 · 정규화) · 2조각(`doc_update` 로그 저장소) · 3a조각(y-prosemirror 연쇄 삭제 막기 · 수선의 작성자 한 곳) · 3b조각(멘션 · 수식 서식) · 4a조각(본문 세션 · 프로젝터 추출) · 4b조각(넘기기 — 본문의 정본이 행에서 Y.Doc 으로 넘어갔다) · 5a조각(협업 서버 골격 · 참여자 update 를 쌓은 뒤에만 퍼뜨린다) · **5b조각(정본 프로젝터 — 참여자가 지운 하위 페이지를 휴지통으로)** 끝. 5a 에서 발견한 휴지통 · 이동의 페이지 권한 구멍(#75)과 목록 · breadcrumb 의 제목 누출(#76)도 막았다. 다음은 5c조각(즉시 전파 · 권한 회수 시 끊기) — 부모 본문 참조의 제목 누출(§7 맨 위)은 6조각 전에 설계부터**, §2 CRDT 조각 표)

---

## 1. 지금 어디까지 왔나

**Phase 0 (MVP) W1–W8 완료 — Phase 0 MVP 가 닫혔다.** 마지막 조각은 W8-b 의 표 화면이었다(#55 · #56 · #57).

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
| **W6-a** | **내비게이션** | **✅ (핵심)** | #43(최근 방문 · 즐겨찾기) |
| **W7** | **검색** | **✅** | #45(색인) #49(질의) #47(오버레이) |
| **W8-a** | **DB 코어** | **✅** | #48(스키마) #50(프로퍼티·값 계약) #51(행·셀) |
| **W8-b** | **DB 뷰** | **✅** | #52(연산자 카탈로그·컴파일러) #53(뷰 CRUD·라우트) #55(쓰기 라우트) #56(표 화면) #57(필터·정렬·표시 속성) |

**동작하는 것**: 이메일 OTP 로그인 → 워크스페이스 생성 → 이메일 초대 → 수락 → 워크스페이스 진입 → 페이지 생성 → 본문 편집(12종 블록 · 분할/병합 · 중첩 · `/` 메뉴 · 마크다운 · 서식) → 자동 저장 → 하위 페이지 → 페이지 이동 → 휴지통 · 복원 · 영구 삭제 → 멀티 블록 선택 → 블록 이동 · `+` 버튼 · 토글 접기 → 블록 메뉴 · 복사/붙여넣기(중첩 보존) · 이미지(올리기 · 주소 · 드롭 · 붙여넣기) · 끊겨도 사라지지 않는 저장(IndexedDB 큐) · 페이지 공유(상속 · 따로 관리하기) · 즐겨찾기 · 최근 방문 → **`Cmd+K` 검색(한국어가 조사를 넘는다 · 권한 필터가 쿼리 안에)** → **풀페이지 데이터베이스**(사이드바에서 만들기 · 속성 6종 추가 · 행 추가 · 셀 편집 · 키보드 이동 · select 옵션 만들기 · "더 보기" · 필터 · 정렬 · 속성 숨기기 · 머리 메뉴) → **내보내기**(페이지 · 표 · 워크스페이스 전체 — Markdown & CSV ZIP · 누르면 개수부터 · 볼 수 없는 페이지는 빠지고 `_export_report.json` 이 센다).

`npm run dev` 로 실제로 눌러볼 수 있고, **`npm run e2e` 가 실제 브라우저로 208개 항목을 확인한다.** 이 PC 에서는 **Chrome 으로** 돌린다 — Edge 153 헤드리스는 진짜 `Ctrl+C` 에서 종료된다(§6). 기존 클립보드 검사 2개는 이 환경에서 실패한다(§7).

**숫자**: 마이그레이션 15개 / 테이블 39개 / 테스트 1595개(CI skip 0 · 이 PC 는 외부 도구 검사가 셸에 따라 1~2개 skip — PowerShell 은 unzip, Git Bash 는 bsdtar 를 못 찾는다) + 브라우저 검증 208개(이 PC 에서 206 통과 — 클립보드 2개) / PR 76개 머지(#77 포함).

---

## 2. 다음 작업 — Phase 1

**Phase 0 이 닫혔고, Phase 1 의 최우선이던 익스포트(F-09-14) v1 도 닫혔다(#65).** 지금은
**CRDT 동시편집**(마스터 문서 §5.2 의 2번 — 그 표는 "착수 순서는 고정"이라고 적었다)을 조각으로 진행 중이다
(아래 CRDT 조각 표). 공개 링크(F-06-06) · 인라인 DB 는 §5.2 표에 없다 — CRDT 다음은 3번(코멘트 · 멘션 · 알림 ·
인박스)이다. 익스포트에 남은 것(잡 · 감사 로그 · 정책 게이트 · HTML · PDF)은 §7.

**익스포트(F-09-14) 진행** — 계층 경계로 자른다
| 조각 | 무엇 | 상태 |
|---|---|---|
| 1 | 본문 → Markdown 직렬화기(순수) — `src/lib/export/markdown.ts`. 무엇을 옮기지 못했는지 `losses` 로 센다 | ✅ #59 |
| 2a | ZIP 쓰기(의존성 없이 `node:zlib`) · CSV(풀페이지 DB) — `zip.ts` · `csv.ts`. 우리가 짜지 않은 구현(python `zipfile` · `csv`, bsdtar)으로 읽어 본다 | ✅ #60 |
| 2b | 파일 이름(`names.ts`) · 조립(`plan.ts` 스냅샷 → 항목 · 보고서 · 크기 추정) · ZIP 스트림(`archive.ts`). 풀어서 모든 상대 링크가 열리는지 python · bsdtar 로 끝까지 본다 | ✅ #61 |
| 3a | 스냅샷 읽기(`snapshot.ts` — 권한을 SQL 에서 거르고 한 스냅샷으로) · `withReadTransaction` 을 REPEATABLE READ 로(재현 먼저) | ✅ #62 |
| 3b | 내려받기 · 요약 라우트(`?root=` 페이지 · 표 / 없으면 워크스페이스) · 페이지 · 표 · 워크스페이스 홈 버튼 · e2e | ✅ #65 |

**3 이 만들 것 — `ExportSnapshot` 계약** (`src/lib/export/plan.ts` 머리 타입)
- `rootIds` · `nodes`(page · database) · `files` · `excluded`. 조립은 DB 를 모르고, **없는 노드 · 두 번 나오는 노드는 던진다**
- 페이지의 `childIds` 는 **가장 가까운 페이지 조상**이 그 페이지인 페이지 · DB(`page-tree.ts` 와 같은 규칙), 본문 순서대로.
  권한으로 못 보는 자식은 넣지 않는다 → 본문의 참조는 조립이 빼고 `omitted_pages` 로 센다
- DB 는 살아 있는 프로퍼티 전부 · 살아 있는 행 전부(`rowIds`, **뷰 필터 없음**). 행 노드의 `cells` 는 `properties_cache`
- `files` 는 본문이 가리키는 `file` 행 중 이 워크스페이스 것. 바이트는 라우트가 `readAttachment` 로 흘려보낼 때 읽는다
- 흘려보내기 **전에** `estimateExport(plan).fits` 로 거부한다 — `zip.ts` · `archive.ts` 가 던지는 것은 마지막 방어다

✅ 계획대로 했다(#65): 정본에 `export_job` 표가 **없고** 잡 워커도 없어(마스터 문서: "스케줄러는 하나만")
v1 은 **동기 스트리밍 다운로드**다. 상한을 넘으면 흘려보내기 **전에** 거부한다(자르지 않는다 — 구멍 난 백업).
`withReadTransaction` 은 #62 부터 REPEATABLE READ 라 스냅샷이 서브트리 전체를 한 시점으로 읽는다(§3.3-72).

**3b 가 만든 것** — `src/lib/export/download.ts`(준비 · 스트림) · `http.ts`(범위 · 상태 · 헤더 · 요약 · 웹 스트림) ·
`GET /api/workspaces/{ws}/export[/summary]?root=` · `src/app/w/[workspaceId]/export-button.tsx`
- 버튼은 **요약 → 링크** 두 단계다. 요약이 내려받기와 같은 `prepareExport` 를 돌려 개수 · 크기 상한 · 거부 이유를
  먼저 보여주고, 내려받기는 평범한 링크라 브라우저가 디스크로 받는다(§3.3-77)
- **워크스페이스 전체는 소유자만**(§3.2-13). 그래서 **표 화면에도 버튼이 있다** — 풀페이지 표는 워크스페이스
  직속이라 멤버가 페이지 내보내기로는 닿지 않는다
- 거부 매핑: `not_found` 404 · `forbidden` 403 · `too_large` **422**(§3.3-78). `?root=`(빈 값)은 워크스페이스가 아니다(§3.3-79)

2a 에서 실측 · 결정하고 2b 가 코드로 반영한 것:
- **이모지(BMP 밖 글자)가 든 파일 이름은 bsdtar(이 PC 의 `tar.exe`, libarchive 3.8.8)가 풀지 못한다** — 이름을 하나씩
  떼어 실측했다: 한글 · `é` · `·` · `#%` 는 풀리고 `😀` 만 막힌다. 같은 ZIP 을 .NET `Expand-Archive` 와 python 은 푼다.
  노션 제목에는 이모지가 흔하다 → **2b 가 파일 이름에서만 뺐다**(`names.ts`, §3.3-66). 문서 첫 줄 `# 제목` 에는 남는다
- CSV 에는 **뷰 필터를 걸지 않는다** — F-04-26 의 "뷰 설정이 곧 파일 스키마"는 뷰 단위 내보내기(P2)의 규칙이고,
  백업에 걸면 행이 조용히 빠진다(`csv.ts` 머리말)
- ZIP 예산은 `bytesWritten` · 항목 수로 **미리** 센다. `zip.ts` 는 넘치면 던지는 마지막 방어다(잘라 쓰지 않는다)

**CRDT 동시편집(F-05-01 · F-05-02 · F-05-04 · F-05-15 · F-05-19 · F-01-17) 진행** — 되돌리기 비싼 순서로 자른다
| 조각 | 무엇 | 상태 |
|---|---|---|
| 1 | **Y.Doc 본문 계약** — 문서 ↔ Y.Doc(`collab/ydoc.ts`) · 동시 편집이 만든 구조 위반을 결정론적으로 고치는 정규화(`collab/normalize.ts`) · 두 참여자 수렴 검사(DB 없음). 의존성 yjs · y-prosemirror · y-protocols(전부 MIT) | ✅ #66 |
| 2 | **`doc_update` 로그 저장소** — `collab/doc-store.ts`. 읽기(스냅샷 + 뒤 update · 처음이면 행에서 옮김) · append(권한 → 스냅샷 잠금 → 적용해 보고 바뀐 부분만 seq + 1) · 압축(스냅샷만). 아직 부르는 경로가 없다 | ✅ #67 |
| 3a | **y-prosemirror 연쇄 삭제 막기**(§3.2-14) — 변환에 넘기는 스키마 파사드(`collab/collab-schema.ts`) · 루트 `doc: blockGroup+` · 구조 위반을 Y.Doc 에 고쳐 쓰는 곳은 로그 저장소 append 하나(`collab/repair.ts` · `doc-store.ts`) | ✅ #69 |
| 3b | **멘션 · 수식에 건 서식**을 Y.Doc 에 싣기(§3.2-15) — 서식을 노드 attr `marks` 에 비춘다(`editor/atom-marks.ts`: 만들 때 · appendTransaction · 읽을 때 되살리기) | ✅ #70 |
| 4a | **넘기기 전의 원시 연산** — 호출자 트랜잭션 안의 본문 세션(`openBodyDoc`: 잠금 · 처음이면 옮김 · `change` · `applyUpdate` · `commit`) · ProseMirror 변경을 Y.Doc 에 쓰는 한 벌(`collab/body-edit.ts`) · 프로젝터 추출(`projectBodyRows`, 동작 그대로). 아직 어떤 경로도 부르지 않는다 | ✅ #71 |
| 4b | **넘기기** — PUT body · 하위 페이지 생성 · 휴지통 · 복원 · 이동이 **한 PR 에서 함께** 본문 Y.Doc 을 거치고(서버 명령 경로 ② · V-5), 프로젝터가 그 결과를 투영한다. **본문 행은 이제 Y.Doc 의 투영이다**(`block/body-write.ts` · `block/page-refs.ts`) | ✅ #73 |
| 5a | **협업 서버 골격 · 참여자 update 경로** — Hocuspocus 자체 호스팅(`collab/collab-server.ts` · `npm run collab` 3001). 세션 쿠키 · Origin · 페이지 권한으로 받고(볼 수만 있으면 읽기 전용), update 는 **메모리 문서에 적용하기 전에** 세션을 다시 해석해 로그 + 행 투영을 한 트랜잭션에서 한다(`appendDocUpdate` 가 `block/body-write.ts` 로 옮겨 투영까지). 거부면 그 문서 연결을 닫는다. 메모리 문서는 로그의 꼬리로 맞춰 퍼뜨린다(수선 · 명령이 쓴 것 포함) | ✅ #74 |
| 5b | **정본 프로젝터** — 참여자가 본문에서 지운 살아 있는 하위 페이지를 거부하지 않고 **휴지통으로 보낸다**(§3.4 X-1 의사코드 · `projectBodyRows` 의 `missingPageRefs: 'trash'`). 휴지통 명령과 같은 쓰기 · 같은 권한(`block/trash-rows.ts`) — 버릴 권한이 없으면 거부(`page_ref_forbidden`). 본문 저장(PUT) · 명령은 계속 거부한다(문서를 통째로 받아 "지웠다"와 "몰랐다"를 가를 수 없다). 깊이 초과는 아직 거부 | ✅ #77 |
| 5c | **즉시 전파 · 권한 회수 시 끊기(F-05-19)** — 다른 프로세스(서버 명령 · 권한 변경)가 쓴 것을 연결된 참여자에게 곧바로 알린다(LISTEN/NOTIFY 후보). 권한이 줄면 그 연결을 닫거나 읽기 전용으로 바꾼다 | ⬜ |
| 5d | **투영 디바운스 · `projected_seq`** — 정본 프로젝터 SLO(p95 < 2s · 쓰기 증폭). 지금은 update 마다 페이지 행을 잠그고 본문 전체를 읽어 투영한다 | ⬜ |
| 6 | 에디터 바인딩 — `ySyncPlugin` · origin 범위 undo(F-05-15) · 오프라인 보존(y-indexeddb) · 두 탭 e2e | ⬜ |

순서의 근거(아직 판결 아님):
- **4 전에는 어떤 경로도 Y.Doc 을 쓰지 않는다** — 1~3 은 머지해도 동작이 바뀌지 않는다
- 4 가 정본을 행에서 Y.Doc 으로 넘기는 조각이다. 그 뒤로 **행을 직접 고치는 경로**(`createPage` 의 참조 삽입 ·
  휴지통 · 복원 · 이동)가 하나라도 남으면 프로젝터가 그 행을 지운다(정본의 프로젝터: 문서에 없는 본문 행은
  hard delete). 그래서 4 는 그 경로 전부와 **함께** 온다
- 3 을 5 · 6 보다 앞에 둔다 — 동시에 쓰는 참여자가 생기는 순간 연쇄 삭제가 **원본 Y.Doc 에서** 일어난다

1조각에서 확인한 것:
- **y-prosemirror 의 Y.Doc → ProseMirror 변환은 내용을 검사하고, 실패하면 그 Y 요소를 지운다**(`Schema.node` =
  `createChecked`). 처음에는 반대로 가정했다가 동시 편집 검사가 "블록 0개"로 실패했고, 진단 스크립트로 Y XML 을
  찍어 연쇄 삭제를 봤다(§3.3-82). 읽기는 직접 짜서 피했고 에디터 바인딩에는 같은 위험이 남는다(§7)
- y-prosemirror 에는 **옮기기가 없다** — 순서 변경은 요소를 제자리에서 고쳐 쓴다(attr 은 LWW). 동시 순서 변경은
  blockId 중복(정규화가 해결) · 글자 겹침(남는다)을 만든다
- 요소 노드의 **마크는 Y.Doc 에 실리지 않는다** — 멘션 · 수식의 서식(§7)

2조각에서 확인한 것:
- **지우기만 하는 update 는 state vector 를 바꾸지 않는다** — "바뀌었는가"를 state vector 로 판정하면 삭제가 조용히
  사라진다. Y.Doc 의 `update` 이벤트로 판정하고, 쌓는 것도 그 이벤트가 준 "실제로 바뀐 부분"이다(§3.3-85)
- 앞선 update 가 없는 update 는 Yjs 가 pending 으로 들고 있는다 — 쌓지 않고 거부한다(§3.3-86)
- 동시 첫 읽기 검사가 처음에는 경쟁을 만들지 못해 `ON CONFLICT` 를 빼도 통과했다 — 표 잠금으로 강제했다(§3.3-88)

3a조각에서 확인한 것 (진단 스크립트로 먼저 재고, 검사로 옮겼다):
- **실제 `ySyncPlugin` 을 헤드리스로 붙여 보니** 편집 스키마로 만든 상태는 원격 타입 충돌을 받는 순간 그 블록을 Y.Doc 에서
  지운다. `collabSchema` 로는 받고 다른 블록을 고쳐도 남는다(`collab-schema.test.ts` ②)
- **두 참여자가 같은 위반을 각자 정규화해 되써넣으면 옮긴 블록이 복제된다**(그룹 둘 합치기 → 블록 넷). 한 곳만 고치면
  복제 없이 수렴하고 프로젝션도 그대로다. 후보 ⓐ 의 "appendTransaction 정규화"를 기각한 근거(§3.2-14)
- **루트 그룹 둘은 파사드로 못 막는다** — 바인딩은 루트를 `tr.replace` 로 채우고 Fitter 가 둘째 그룹을 버린 뒤 다음 로컬
  편집이 Y.Doc 에서 지운다. `doc: blockGroup+` 로만 풀었다
- **모르는 노드는 바인딩에서 받아도 · 이웃을 고쳐도 남는다**(매핑 동일성으로 건너뛴다). 매핑 없이 비교하는 서버 수선은
  지우므로 모르는 것이 있으면 수선을 멈춘다(§3.3-91)
- 반사실이 통과한 것 하나: 수선의 사본 검증 단계 — 주석을 사실대로 고쳤다(§3.3-90)

6조각(에디터 바인딩)이 지켜야 할 것 — 3a 가 정한 것:
- 에디터 상태는 `EditorState.create({ schema: collabSchema, plugins: [ySyncPlugin(…)] })` — **`doc` 을 넘기지 않는다**
  (넘기면 `state.schema` 가 `blockSchema` 가 되어 바인딩이 파사드를 거치지 않는다)
- 에디터는 구조 위반을 **고쳐 쓰지 않는다**(정규화 appendTransaction 금지). 5조각의 협업 서버는 `appendDocUpdate` 결과의
  `repair` 를 받은 update 와 함께 퍼뜨린다
- 수선이 도착하기 전까지 에디터 문서는 스키마를 어길 수 있다(한 블록에 내용 줄 둘 · 루트 그룹 둘). 명령 · 플러그인이 그
  모양에서 던지거나 엉뚱하게 동작하지 않는지 본다 — `pm-blocks.ts` 는 첫 루트 그룹만 평탄화한다(§7)

4a조각이 정한 것 — 4b(넘기기)가 지켜야 할 것:
- 서버 명령은 **부모 본문 세션을 먼저 열고**(`openBodyDoc(tx, ctx, pageId)`) 그다음 행을 쓰고, `change` 로 참조 노드를 넣거나 빼고,
  `commit({ actorId, origin: 'api' })` 한다. 처음 여는 세션은 그 순간의 행으로 옮기므로, 하위 페이지 행을 먼저 쓰면 옮기기가 그
  참조를 이미 담는다(`doc-store.db.test.ts` ⑦ 이 고정). ⚠ 4a 에서는 "그러면 둘이 된다"고 적었는데 **4b 의 반사실이 뒤집었다** —
  넣기가 이미 있는 참조를 넣지 않아 둘이 되지 않는다(§3.3-97)
- 세션은 **권한을 보지 않는다.** 하위 페이지를 만드는 사람은 부모 본문의 `edit_content` 가 아니라 `create_child` 로 부모 문서에
  참조를 넣는다 — 명령이 자기 권한을 검사한다. 참여자 경로(`appendDocUpdate`)만 권한 검사 + 세션이다
- 프로젝터는 `projectBodyRows(tx, ctx, page, doc)` — 페이지 행을 `FOR UPDATE` 로 잡은 트랜잭션에서 세션의 `read().doc` 을 넘긴다.
  지금 프로젝터는 문서에 없는 살아 있는 하위 페이지를 **거부**한다(`page_ref_missing`). 정본 의사코드는 "휴지통으로 전이"다 —
  4b 에서는 모든 쓰기가 명령이라 거부로 충분하고, 참여자가 참조 노드를 지울 수 있게 되는 6조각에서 정본대로 바꾼다
- ⚠ **잠금 순서.** 프로젝터 쪽은 페이지 행 `FOR UPDATE` 를, 세션은 `doc_snapshot` 행 `FOR UPDATE` 를 잡는다. 두 경로가 반대 순서로
  잡으면 교착이다 — 4b 에서 한 방향(페이지 행 → 스냅샷)으로 정하고, 5조각의 참여자 경로가 투영까지 할 때도 같은 순서를 쓴다

4b조각에서 한 것 · 확인한 것 (§3.2-16):
- **넘긴 경로 다섯**: 본문 저장(PUT) · 하위 페이지 생성 · 휴지통 · 복원 · 이동. 전부 `body-write.ts` 의 순서(본문 페이지 행 잠금 →
  `openPageBody` → 행 쓰기 → `change` → `finish` = 투영 먼저, 받아들여지면 쌓기)를 따른다. 로그 origin 은 본문 저장이 `'editor'`,
  나머지 명령이 `'api'`
- **참조가 사는 본문은 "가장 가까운 페이지 조상"의 Y.Doc 이다**(`ownerPageOf`) — 토글 안의 하위 페이지는 그 토글을 가진 페이지의 문서에 있다
- **복원 자리**: B2 가 보존한 `order_key` 보다 앞선 살아 있는 형제 중 가장 뒤의 것 바로 뒤 · 없으면 그 그룹의 맨 앞. 형제의 키는 본문
  위치의 투영이라 본문 순서와 같다. 토글 안에 있던 페이지도 그 토글 안 원래 자리로 돌아온다
- **빈 본문은 대체 · 마지막 참조를 빼면 빈 문단으로**(`page-refs.ts`) — 빈 페이지 본문은 빈 문단 하나라 그 뒤에 붙이면 빈 줄 행이 생긴다
- **발견해서 고친 것 둘**: ① 모르는 타입의 블록을 API 로 저장하면 원래 타입 이름이 사라졌다 — `docToPm` 이 옮기며 담을 곳이 없다.
  옮기기 전에 프로젝터와 같은 함수로 감싼다(`wrapUnknownTypes`, 기존 왕복 검사가 잡았다) ② 거부된 저장의 부분 커밋(#72, §3.3-96)
- 행으로 우회하던 검사를 실제 경로로 바꿨다: 본문 블록을 SQL 로 넣던 것 → 본문 저장, 형제를 SQL 로 버리던 것 → `trashPage`.
  doc-store 검사는 저장 뒤 로그를 지워 **4b 이전 페이지**를 흉내 낸다 — 옮기기 경로는 운영 데이터에 여전히 필요하다
- 대상이 어느 페이지 본문에도 속하지 않는 이동(워크스페이스 직속 데이터베이스)은 `target_not_found` 로 거부한다 — 이전에는 받아서
  데이터베이스 블록 밑에 페이지 행이 생겼다

5a조각에서 한 것 · 확인한 것 (§3.2-17):
- **Hocuspocus 4.7.0 을 소스로 읽고 진단 스크립트로 쟀다** — ① 한 연결의 메시지는 차례로 처리되고 `beforeSync` 는 update 를 메모리
  문서에 적용하기 **전에** 불려 끝나기를 기다린다 ② 그 훅에서 던지면 그 update 는 적용되지 않고 **그 문서 연결만** 닫힌다 — provider 는
  `close` 의 `reason` 만 받고(코드는 1000 으로 바뀐다) 다시 붙지 않는다 ③ 이미 가진 update 를 다시 적용하면 update 이벤트가 나지 않는다
  (삽입 · 삭제 모두) ④ Node 24 의 WebSocket(undici)은 두 번째 인자로 헤더를 받는다 — 검사가 실제 세션 쿠키로 붙는다
- **쌓은 것만 퍼뜨린다** — update 는 `beforeSync` 에서 세션을 다시 해석하고 `appendDocUpdate` 로 로그 + 행 투영을 한 트랜잭션에서 끝낸 뒤에야
  메모리 문서에 들어간다. 거부(세션 · 권한 · 투영 · 깨짐 · pending · 크기)면 던져 그 문서 연결을 닫는다
- **메모리 문서는 로그의 꼬리로 맞춘다** — 쌓은 뒤 알던 seq 뒤의 로그를 적용하는 것이 곧 퍼뜨리기다. 같은 seq 의 수선과 다른 프로세스(서버
  명령)가 쌓은 것이 같은 길로 간다 — 수선을 따로 퍼뜨리는 길을 두지 않았다
- **`appendDocUpdate` 를 `block/body-write.ts` 로 옮기고 투영까지 하게 했다** — 4b 뒤에도 투영 없이 쌓는 참여자 경로가 남아 있었다(부르는 곳이
  검사뿐이라 드러나지 않았다). 페이지 행 잠금 → 권한 → 세션에 적용 → 바뀐 것이 있으면 투영 → 쌓기. 살아 있는 하위 페이지의 참조가 빠진
  update 는 아직 **거부**한다(5b)
- **신원은 업그레이드 요청의 세션 쿠키, 그리고 `Origin`** — 쿠키가 httpOnly 라 브라우저 코드가 토큰으로 보낼 수 없다. 볼 수만 있으면 읽기 전용
  연결이다. 거부 이유가 provider 와의 계약이다: `unauthenticated` · `not_found`(볼 수 없는 페이지 · 없는 페이지 · 남의 워크스페이스를 가르지
  않는다) · `sso_required` · `forbidden_origin` · 그리고 쓰기 거부 이유(`forbidden` · `page_ref_missing` …)
- 문서 이름은 `{workspaceId}:{pageId}`. 서버 프로세스는 `npm run collab`(`COLLAB_PORT` 기본 3001 · 받는 Origin 은 `NEXT_PUBLIC_APP_URL`)
- ⚠ **발견했지만 고치지 않은 것 — 휴지통 · 복원 · 영구 삭제 · 이동 명령이 페이지 권한을 보지 않는다**(§7 맨 위). 라우트도 워크스페이스
  멤버인지만 본다. 5b 가 "참여자가 지운 하위 페이지를 버릴 권한"을 정하려면 명령 쪽 규칙이 먼저 있어야 한다

6조각(에디터 바인딩)이 지켜야 할 것 — 5a 가 정한 것:
- provider 는 거부된 문서에 다시 붙지 않는다. `close` 의 `reason` 을 받으면 **로컬 Y.Doc 을 버리고 다시 연다** — 거부된 update 가 로컬에 남은
  채 다시 붙으면 SyncStep2 로 같은 update 를 또 보내 또 닫힌다. 버리는 편집은 조용히 잃지 않게 알린다(F-05-19 "조용한 유실 금지")
- `authenticationFailed` 의 `not_found` 는 볼 수 없는 페이지와 없는 페이지를 가르지 않는다 — 화면도 가르지 않는다

5b조각에서 한 것 · 확인한 것 (§3.2-19):
- **빠진 하위 페이지는 문서가 어디서 왔는가로 가른다** — 프로젝터(`projectBodyRows`)가 `missingPageRefs` 를 받는다. 참여자 update
  (`appendDocUpdate`)는 `trash`(정본대로 휴지통 전이), 본문 저장(PUT) · 명령은 `refuse`(그대로 `page_ref_missing`). 기준은 "지웠다"와
  "몰랐다"를 가를 수 있는가다 — Yjs update 의 삭제는 보낸 쪽이 본 항목(client · clock)만 가리키고, PUT 은 문서를 통째로 받아 낡은 탭이
  모르는 하위 페이지도 빠진 채로 온다
- **휴지통 명령과 같은 쓰기 · 같은 권한** — 행 쓰기(`trashSubtreeRows`)와 권한 판정(`pageChangeAccess`, §3.2-18)을 `block/trash-rows.ts`
  로 떼어 명령과 프로젝터가 함께 쓴다. 하나라도 버릴 수 없으면 update 전체를 거부한다(`page_ref_forbidden`) — 일부만 버리면 참조가 빠진
  Y.Doc 과 살아 있는 행이 어긋난다. 이미 버린 것은 투영의 savepoint 가 되돌린다
- 버린 페이지의 `order_key` 는 그대로 남아(B2) 되살리면 본문의 원래 자리로 돌아온다 — 4b 의 복원 규칙 그대로다
- 깊이 초과(`page_ref_too_deep`)는 참여자 경로에서도 아직 거부다 — 5d(디바운스) 전에 풀어야 한다(§3.3-98)

**W8 이 남긴 빈자리 — Phase 1 과 부딪히면 먼저 본다** (자세한 건 §7)
1. **select 정렬** — 컴파일러가 select 를 옵션 **id** 로 정렬한다. 화면은 select 를 정렬 대상에서 **뺐다**.
   F-04-10 이 요구하는 옵션 정의 순서(`select_option.order_idx` 조인)를 `compileSorts` 에 넣으면 연다
2. **행 페이지 열기** — 표에서 행을 페이지로 여는 링크가 없다. 페이지 화면이 DB 행을 모르는 곳이 셋이다
   (`renamePage` 가 행을 거부 · 이동 피커 · breadcrumb)
3. **DB 행이 전역 검색에 안 걸린다** — 색인 행은 생기지만 텍스트를 써 주는 경로가 없다
4. **셀 쓰기에는 저장 큐가 없다** — 끊기면 칸이 되돌아가고 "저장되지 않았다"고 말한다(본문의 F-05-04 와 다르다)
5. **e2e 환경** — 이 PC 의 Edge 153 헤드리스는 진짜 `Ctrl+C` 에서 종료되고, Chrome 은 그 붙여넣기가 붙지 않는다.
   `E2E_BROWSER` 로 Chrome 을 쓰고 클립보드 검사 2개는 실패로 남는다. 검색 오버레이의 누출 검사 하나가
   간헐적으로 떨어진다 — 진단을 넣었으니 다음 실패 때 달라진 글자가 로그에 남는다

---

## 2-0. W8 기록 — 데이터베이스 (서버 → 표 화면)

| F-ID | 무엇 | 상태 |
|---|---|---|
| `F-03-01` | DB 컨테이너(3계층) | ✅ #48 #50 |
| `F-03-02` | 프로퍼티 스키마 관리 | ✅ #50 · 화면 #55(라우트) #56(속성 추가) #57(이름·삭제·숨기기) |
| `F-03-03` `F-03-04` `F-03-06` | 프로퍼티 6종(title·rich_text·number·select·checkbox·date) | ✅ #50 — **어느 6종인지는 정본이 안 적어서 우리가 정했다**(§3.2) · select 옵션 만들기 #55 |
| `F-03-16` | 셀 편집 | ✅ #51(서버) #55(라우트) #56(그리드 · 키보드 · 셀 6종) |
| `F-03-17` | 연산자 카탈로그 | ✅ #52 — **데이터로 두되 SQL 은 넣지 않았다**(§3.1) · 필터 패널이 읽는다 #57 |
| `F-04-01` `F-04-12` | Table 뷰 · 표시 프로퍼티 | ✅ #53(서버) #56(화면) #57(숨기기) |
| `F-04-09` `F-04-10` `F-04-15` | 필터 · 다중 정렬 · keyset 커서 | ✅ #52(서버) #56("더 보기") #57(패널) |
| `F-04-14` | 풀페이지 DB | ✅ #56 — `/w/[workspaceId]/db/[databaseId]` · 사이드바 |

**만든 것** — 착수 때 적어 둔 지시를 그대로 남긴다. 전부 했고, 실제로 어떻게 했는지와 계획과 달라진 곳은
§3.3-42 이하와 PR #55 · #56 · #57 본문에 있다.

1. **풀페이지 DB 라우트** — `/w/[workspaceId]/db/[databaseId]`.
   `createDatabase` 는 워크스페이스 직속으로만 만든다(인라인 DB 는 §7 — 프로젝터가 지운다).
   사이드바에 데이터베이스를 목록에 넣는 것도 여기다 — `listPageTree` 는 `type='page'` 만 본다.
2. **표 그리드** — 컬럼 머리 + 행. 데이터는 **한 왕복**이면 된다:
   `GET /api/workspaces/{ws}/views/{viewId}/rows` 가 `columns` 와 `rows` 를 함께 준다.
3. **타입별 셀 렌더러·에디터 6종.** 값 계약은 `property-types.ts` 가 이미 갖고 있다 —
   `validateCellValue` 로 보내기 전에 검사하고, 쓰기는 `PATCH` 한 번이다.
   ⚠ `checkbox` 의 빈 값은 `null` 이 아니라 `false` 다. `select` 셀은 **옵션 id** 를 담는다.
4. **그리드 키보드 내비게이션** — `Tab`/`Shift+Tab` 좌우, `Enter` 아래, `Esc` 취소(F-03-16).
   ⚠ 본문 에디터가 같은 키를 쓴다. 표는 에디터 **밖**이므로 포커스 격리가 보호해 주지만,
   그 사실을 **검사로 남긴다**(검색 오버레이에서 같은 걸 반사실로 확인했다, §3.3-41).
5. **필터·정렬 패널** — 연산자 드롭다운은 **`filter_operator` 카탈로그에서 읽는다**(코드에
   박지 않는다. 그게 그 표의 존재 이유다). 저장은 `PATCH /views/{viewId}`.
6. **"더 보기" 50행** — `nextCursor` 를 그대로 다시 보낸다. 무한 스크롤을 만들지 않는다
   (F-03-17: 누적 10,000건 상한이 있고 "전부 훑는" 로직은 반드시 깨진다).
7. **e2e 검사 추가** — `scripts/e2e-editor.mjs`. 화면에 기대는 것을 만들었으므로 필수다.

**의존성을 늘리지 않기로 했다**
F-03-16 은 TanStack Table + `@tanstack/react-virtual` 을 권하지만, 우리는 **필터·정렬·페이지네이션이
전부 서버 쪽**이고 한 번에 50행만 그린다. TanStack 의 핵심 가치(클라이언트 테이블 상태 · 가상화)를
쓰지 않으므로 평범한 `<table>` + 직접 만든 키보드 내비게이션이 코드가 더 적다.
가상화가 필요해지는 규모가 오면 그때 `@tanstack/react-virtual`(MIT)을 넣는다.

**착수 전에 읽을 것**
- `docs/research/03-database-core.md` F-03-16(셀 편집 UX 공통 규약 · 단축키 전수)
- `docs/research/04-database-views.md` F-04-01 · F-04-12 · F-04-14
- `src/lib/database/view.ts` 머리말 — 뷰가 공유 상태라는 것과 `edit_structure` 를 묻는 이유
- `src/lib/database/property-types.ts` — 값 계약 · 사이드카 · `select` 이 옵션 id 인 이유

**계획과 달라진 것**
- 4번의 "표는 에디터 밖이므로 포커스 격리가 보호해 준다"는 표 **안의** 편집기에는 성립하지 않았다.
  select 편집기의 입력칸이 표 안에 있어 같은 키 이벤트가 버블링으로 반드시 표에 닿는다 — `defaultPrevented` 가드로 막았다(§3.3-44)
- "서버는 끝났다"는 사실과 달랐다. 셀 쓰기 · 행 추가 · 컬럼 추가의 **라우트**, select 옵션을 **만드는 함수**,
  컬럼에 싣는 옵션 목록이 없어서 #55 에서 채웠다

---

## 2-1. 지난 구간 기록 (W5~W7)

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

W7 항목별 상태:

| F-ID | 무엇 | 상태 |
|---|---|---|
| `F-07-06` | 검색 색인 | ✅ #45 — `search_document` 실테이블. **텍스트는 앱이, 권한 축은 트리거가** 쓴다 |
| `F-07-01` · `F-07-07` | 전문 검색 · 권한 인지 | ✅ #49(질의) #47(오버레이). 권한은 `WHERE perm_scope_id = ANY(...)` 로 **쿼리 안에** |
| `F-07-02` | 랭킹 | **제목 우선 → 최근 수정순**만. 정렬 옵션 5종·`ts_rank_cd` 는 §7 |

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

**검색 (W7)**
- `src/lib/search/index-page.ts` — 색인 **텍스트** 쓰기자(`title_text`·`body_text`·`lang`).
  나머지 컬럼은 마이그레이션 0012 의 트리거가 `block` 에서 따라간다 — 여기에 `perm_scope_id` 가
  나오면 그건 버그다
- `src/lib/search/search.ts` — 질의. 권한은 `WHERE` 안에 있고 25건을 뽑아 거르는 경로가 없다
- `src/lib/search/script.ts` — CJK/라틴 판별. **최소 쿼리 길이와 검색 축을 동시에 결정한다**
- `src/lib/search/highlight.ts` — 강조 구간(순수). 이어 붙이면 원문과 정확히 같다
- `src/app/w/[workspaceId]/search-overlay.tsx` — `Cmd+K`/`Cmd+P` 오버레이.
  에디터를 지키는 것은 `stopPropagation()` 이 아니라 **포커스 격리**다(§3.3-41)

**데이터베이스 (W8)** — ⚠ `src/lib/db/`(커넥션 풀·트랜잭션)와 **다른 디렉터리**다
- `src/lib/database/database.ts` — 3계층 생성. 스키마로 표현 못 하는 "적어도 1개"(DS1·P1)와
  **기본 뷰**를 한 트랜잭션에서 만든다
- `src/lib/database/property-types.ts` — **값 계약의 정본.** 판별 유니온 검증 + `deriveSidecars()`.
  셀을 쓰는 모든 경로가 이 파생 함수를 쓴다(두 벌이면 "정렬은 맞는데 필터는 틀린" 구간이 생긴다)
- `src/lib/database/property.ts` — 프로퍼티 CRUD. soft delete · `schema_version` 낙관적 잠금 ·
  `newPropertyId()`(nanoid 없이 base62 21자, 모듈로 편향 제거)
- `src/lib/database/row.ts` — 행·셀 쓰기. **제목은 EAV → `block.properties.title` 한쪽 방향 투영**
- `src/lib/database/filter.ts` — **필터·정렬 컴파일러.** 사용자 입력이 SQL 문법에 닿지 않는다.
  부정 연산자는 `NOT EXISTS`(셀 없는 행이 걸려야 한다) · 커서는 `IS NOT DISTINCT FROM`
- `src/lib/database/query.ts` — `queryRows`. 권한 게이트가 필터보다 **앞**이다
- `src/lib/database/view.ts` — 뷰 CRUD. 컬럼 설정은 **단일 행 UPDATE**(V1) ·
  `addPropertyToViews` 가 새 컬럼을 모든 뷰에 넣는다
- API 라우트: `databases` · `views/[viewId]` · `/rows` · `/columns/[propertyId]` ·
  #55 부터 `databases/[databaseId]`(이름) · `views/[viewId]/rows` POST(행 추가) · `rows/[rowId]`(셀 쓰기 · 휴지통) ·
  `data-sources/[dataSourceId]/properties[/[propertyId][/options]]`(컬럼 · select 옵션)
- `src/lib/database/http.ts` — **거부 코드 → HTTP 상태 매핑은 여기 한 곳.** 셀 목록 모양 검사 · 행 응답 모양
- `src/lib/database/operator-catalog.ts` — 필터 패널이 연산자를 읽는 함수. `filter.db.test.ts` 도 **이 함수로** 비교한다
- `src/lib/database/limits.ts` — 페이지네이션 상수. 화면이 서버와 같은 10,000 을 본다(`query.ts` 는 클라이언트가 import 할 수 없다)
- `src/lib/database/grid-nav.ts` — 그리드 키 규칙(DOM 모름). 선택/편집 상태 전이 · 표 끝 Tab 은 표 밖으로
- `src/lib/database/cell-format.ts` — 셀 값 ↔ 글자 · 입력 초안. 읽기는 관대하게, 쓰기는 `validateCellValue` 로
- `src/lib/database/filter-draft.ts` — 필터 트리 ↔ 패널의 평평한 규칙. OR·중첩은 편집 불가 · 덜 찬 규칙과 지워진 속성은 저장 전에 뺀다
- `src/app/w/[workspaceId]/db/[databaseId]/` — 표 화면. `database-table.tsx`(그리드 · 낙관적 셀 쓰기) ·
  `view-toolbar.tsx`(필터 · 정렬 · 속성 패널) · `column-menu.tsx` · `select-editor.tsx` · `table-api.ts`(**실패 문구는 여기 한 곳**)

**동시 편집 (Phase 1 — CRDT)**
- `src/lib/collab/ydoc.ts` — **본문 Y.Doc 계약.** `body` 프래그먼트 · 문서 → Y.Doc(처음 한 번) · Y.Doc → 문서
  (검사하지 않고 읽어 정규화). **y-prosemirror 의 변환(`initProseMirrorDoc`)으로 읽지 마라** — 구조 위반을 만나면
  Y 요소를 지운다(§3.3-82)
- `src/lib/collab/normalize.ts` — 동시 편집이 만든 구조 위반을 고치는 순수 함수 · 결정론 id(`derivedBlockId`,
  페이지 id 가 씨앗). 에디터 바인딩도 **같은 함수**를 써야 참여자마다 같은 문서가 된다
- `src/lib/collab/doc-store.ts` — **편집 로그 저장소.** `loadDocState`(스냅샷 + 뒤 update, 처음이면 행에서 옮김) ·
  **`openBodyDoc`**(4a — 호출자 트랜잭션 안의 본문 세션: 스냅샷 잠금 · 처음이면 옮김 · `read` · `change` · `applyUpdate` · `commit`
  으로 바뀐 부분 + 수선을 seq + 1 → 압축. **권한을 보지 않는다**) · `appendDocUpdate`(권한 검사 + 세션). 아직 부르는 경로가 없다
- `src/lib/collab/body-edit.ts` — **`writeEditorChange`.** ProseMirror 변경을 Y.Doc 본문에 쓰는 한 벌(`collabSchema` 읽기 → 트랜잭션 →
  서식 거울 → `updateYFragment`). 서버 명령과 테스트의 `edit` 이 같이 쓴다
- `src/lib/block/save-page-body.ts` 의 **`projectBodyRows`** — 프로젝터(범위 읽기 → 투영 → 쓰기 → 버전 → 색인). 4a 에서 `savePageBody` 에서
  떼어 냈다(동작 그대로). 4b 가 세션의 `read().doc` 을 넘긴다. **거부하면 savepoint 로 되돌린다**(#72)
- `src/lib/block/body-write.ts` — **서버 명령의 본문 쓰기 한 단위**(`openPageBody` · `finish` · `finishOrThrow` · `ownerPageOf`). 본문 행을 바꾸는
  새 경로는 반드시 이것을 거친다 — 행을 직접 고치면 Y.Doc 과 어긋나고 다음 투영이 그 행을 지우거나 거부한다
- `src/lib/block/page-refs.ts` — 본문의 하위 페이지 참조 노드 변경(`appendPageRef` · `insertPageRefAfter` · `removePageRef`). 빈 본문은 대체,
  마지막 참조를 빼면 빈 문단, 이미 있는 참조는 넣지 않는다
- `src/lib/testing/body-invariant.ts` — `assertBodyMatchesYDoc` — 명령 뒤 "행 = 그 페이지 Y.Doc 의 투영"을 확인한다(스냅샷이 있어야 통과)
- `src/lib/testing/collab-peers.ts` — 에디터 없이 참여자를 흉내 낸다(`peer` · `edit` · `findBlock` · `exchange` · `changesSince`).
  `edit` 은 `ySyncPlugin` 이 쓰는 `updateYFragment` 를 부른다. client id 를 고정하면 결과가 결정론이다. 문서는 `collabSchema` 로 읽어
  위반이 있어도 지우지 않는다(위반 자리를 건드리는 편집은 ProseMirror 가 거부한다). **`bind`** 는 실제 `ySyncPlugin` 을 헤드리스로 붙인다
- `src/lib/testing/collab-scenarios.ts` — 동시 편집이 만드는 구조 위반 장면 6개(타입 충돌 · 빈 그룹 · 그룹 둘 · 자식 올리기 · id 겹침 · 루트 그룹 둘)
- `src/lib/collab/collab-schema.ts` — **`collabSchema`.** y-prosemirror 변환에 넘기는 스키마 파사드(`node` · `mark` · `text` 만 던지지 않는다).
  바인딩 · 서버 쓰기 경로는 반드시 이것을 넘긴다(§3.2-14)
- `src/lib/collab/repair.ts` — **`repairBodyYDoc`.** 구조 위반을 Y.Doc 에 고쳐 쓴다 — 프로젝션을 바꾸지 않고 고칠 곳만. 모르는 것이 있으면
  멈춘다. **부르는 곳은 `appendDocUpdate` 하나**다(수선의 작성자가 둘이면 블록이 복제된다)
- `src/lib/collab/ydoc.ts` 의 `readBodyPm` — 고치지 않고 Y.Doc 을 그대로 비춘 ProseMirror 문서(스키마에 맞는다고 가정하지 마라)
- `src/lib/editor/atom-marks.ts` — **멘션 · 수식 서식의 attr 거울**(`createInlineAtom` · `syncAtomMarks` · `atomMarksPlugin` · `marksFromAttr`).
  에디터에 붙어 있다. 서버가 ProseMirror 트랜잭션으로 Y.Doc 에 쓸 때도 `updateYFragment` 앞에서 `syncAtomMarks` 를 거친다(§3.2-15)
- `src/lib/block/save-page-body.ts` 의 `readLiveBody(tx, …)` — 트랜잭션 안에서 행으로 본문 읽기. 편집기(`loadPageBody`)와
  Y.Doc 옮기기가 같은 규칙으로 읽는다

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

| 2d | **§3.9 의 GIN 인덱스 식 `[정정]`** (#45) | 정본의 `USING gin (to_tsvector(lang, …))` 는 **생성 자체가 거부된다.** ① `to_tsvector(text, text)` 가 존재하지 않는다 ② `lang::regconfig` 로 캐스팅해도 IMMUTABLE 이 아니라 막힌다. 즉 "문서마다 다른 analyzer" 를 인덱스 식으로 쓸 수 없다 — per-language analyzer 는 Elasticsearch 의 기능이고 v0 의 Postgres 로 이식되지 않는다. 고정 regconfig + GENERATED 컬럼으로 바꿨다 |
| 2e | **§3.5 `property` 이름 UNIQUE → 부분 UNIQUE `[정정]`** (#48) | 전체 UNIQUE 는 이 표의 `deleted_at`(soft delete)과 충돌한다 — "상태" 를 지운 뒤 같은 이름으로 다시 만들 수 없다. 반사실로 실제 거부를 확인했다. V-7 의 근거가 *"properties 가 name 키 객체"* 인데 그 객체엔 지워진 프로퍼티가 없으므로, 판결을 어기는 게 아니라 **범위를 맞추는 것**이다 |
| 2f | **§3.5 `property_type` · `option_color` ENUM 정의 `[추가]`** (#48) | 정본이 두 타입을 **쓰면서 정의하지 않았다.** 03 문서의 전수표(24종)와 10색 목록에서 가져왔다. **24종을 한 번에** 넣은 이유: `ALTER TYPE … ADD VALUE` 로 추가한 값은 같은 트랜잭션에서 쓸 수 없어 나중에 넣으면 마이그레이션이 둘로 갈라진다 |
| 2g | **§3.5 Phase 0 의 색인 범위 `[범위]`** (#48) | `search_document` 의 행은 `type='page'` 블록뿐이다. 스키마는 안 좁혔고 `CHECK (type='page' AND page_id=doc_id)` 로 **승격**했으므로, 블록 단위 색인으로 확장할 때 그 CHECK 을 떼는 마이그레이션이 변경의 일부가 된다 |

### 3.2 정본이 "정하라"고 남긴 것을 정한 것

| # | 무엇 | 결정 | 근거 |
|---|---|---|---|
| 3 | **오프셋 단위** (F-01-20 이 "하나로 고정할 것"이라고 남김) | **원자(mention·equation)는 길이 1** | 이 규칙에서는 "캐럿이 멘션 한가운데"가 **구조적으로 불가능**해진다. `plain_text` 길이로 세면 모든 호출 지점이 스냅을 기억해야 하고, 한 곳만 빠뜨리면 멘션이 반으로 쪼개진다. ProseMirror inline atom 도 `nodeSize 1` 이라 **변환이 아예 없어진다** |
| 4 | **분할 시 새 블록의 위치** (F-01-19 "형제로 넣을지 첫 자식으로 넣을지 분기") | 자식이 있고 **펼쳐져** 있으면 첫 자식, 그 외 형제 | 기준은 하나 — *새 블록은 화면에서 원본 바로 다음 줄에 온다.* 그리고 **자식을 절대 옮기지 않는다**(§7-4 최빈 버그) |
| 5 | **접힌 대상으로 자식이 이관되는 병합** | 병합하면서 **앞 블록을 펼친다** | 접힌 컨테이너로 들어간 자식은 사용자에게 삭제로 보인다. 거부보다 손실이 없다 |
| 6 | **슬래시 메뉴 필터·종료** (정본 미해결 16번) | 필터는 **prefix**, 종료는 ⓐ공백 ⓑ매칭 0건 ⓒ캐럿 이탈 | fuzzy 는 "왜 이게 나오지"를 예측할 수 없다. 항목 12개에는 prefix 로 충분하다 |
| 7 | **MVP 프로퍼티 6종** (마스터 문서가 "프로퍼티 5종"이라고만 적고 이름을 안 남겼다) | **title · rich_text · number · select · checkbox · date** | 기준은 **사이드카 컬럼을 전부 덮는 것**이다. 사이드카는 정렬·필터가 실제로 읽는 컬럼이라, 빠진 축이 있으면 그 타입을 넣을 때 인덱스와 필터 컴파일러를 다시 설계해야 한다. `multi_select` 는 `select_option` 레지스트리를 공유하므로 나중에 추가하는 것이 스키마 변경이 아니다 |
| 8 | **`select` 셀의 사이드카는 옵션 id** (정본이 "셀은 옵션 id 를 참조" 까지만 적었다) | `text_value` = **옵션 id** | F-03-04: *"옵션 이름 변경 시 그 옵션을 쓰는 모든 셀 표시가 함께 바뀐다(id 참조이므로 자동)."* 이름을 넣으면 그 자동이 깨지고 rename 마다 모든 셀의 사이드카를 다시 써야 한다. 대가로 select 을 이름순 정렬할 수 없지만 그건 `select_option.order_idx` 조인이고 **정렬의 정본도 그쪽**이다 |
| 9 | **뷰 타입은 `table` 하나** (정본의 `type` 은 10종) | `MVP_VIEW_TYPES = ['table']` | 마스터 문서가 "DB 제품은 Table 하나로 성립한다"로 잘랐다. Board/Calendar 는 `group_by`·`configuration` 을 쓰므로 그 컬럼들이 먼저 살아난다 |
| 10 | **상대 날짜 연산자를 넣지 않았다** (F-03-17 의 전수표에는 있다) | `past_week`·`this_week`·`today` 류 제외 | **평가 시점 의존 노드**라 결과 캐시 키가 `(view_id, actor_id, 평가일)` 로 쪼개진다(불변식 VW1). 캐시를 만들기 전에 넣으면 "어제 본 것과 다른 결과"를 설명할 수 없다 |
| 11 | **표 UI 에 TanStack 을 쓰지 않는다** (F-03-16 이 권했다) | 평범한 `<table>` + 직접 만든 키보드 내비게이션 | 필터·정렬·페이지네이션이 **전부 서버 쪽**이고 한 번에 50행만 그린다. TanStack 의 핵심 가치(클라이언트 테이블 상태·가상화)를 쓰지 않으므로 코드가 더 늘어난다. 가상화가 필요해지면 그때 `@tanstack/react-virtual`(MIT)을 넣는다 |
| 12 | **익스포트 Markdown 의 문법** (01 문서는 노션 enhanced markdown 을 *"그대로 채택"* 하라 하고, 이 기능을 소유한 09 문서는 F-09-22 대안에서 *"커스텀 태그를 만들지 말라"* 고 한다) | **CommonMark + GFM + HTML 블록 셋**(`<details>` 토글 · `<aside>` 콜아웃 · `<u>` 밑줄). 색은 버리고 센다 (#59) | 소유 문서(09)를 따른다. 익스포트 파일을 여는 것은 우리 앱이 아니라 다른 도구다 — 거기서 `{color="red"}` 는 글자로, 탭 들여쓰기는 **코드 블록**으로 보인다. 노션 자신의 Markdown 익스포트가 쓰는 모양과 같다(F-09-14: *"노션의 export ZIP 레이아웃을 그대로 채택"*). 표현 못 한 것은 `losses` 로 세어 보고서에 싣는다 — F-09-14 가 가장 크게 경고한 실패가 *"백업이라 믿었는데 구멍이 있는 상태"* 다 |
| 13 | **워크스페이스 전체 익스포트를 누가 할 수 있나** (3b 가 "정할 것"으로 남겼다. F-09-14 · F-02-22 는 노션 설정 화면의 "(관리자) Export all workspace content" 만 적었다) | **워크스페이스 소유자(`owner`)만.** 멤버 관리자(`membership_admin`)도 아니다. 페이지 · 표 범위는 볼 수 있는 모든 멤버 (#65) | ① **무엇을 볼 수 있는가는 역할이 아니라 스냅샷이 거른다**(§3.3-73) — 소유자가 내보내도 남의 비공개 페이지는 없다(F-09-20: admin 이라도 "모든 것을 본다"가 아니다). 역할이 정하는 것은 "한 번에 묶기"뿐이라 **멤버가 잃는 데이터가 없다** — 단 그러려면 표 화면에도 버튼이 있어야 해서 넣었다(풀페이지 표는 워크스페이스 직속이라 페이지 내보내기로 닿지 않는다) ② 잡 큐 · 속도 제한이 없는 동안 가장 무거운 동기 요청이다(블록 20만 · ZIP 4GiB) ③ 멤버 관리자는 멤버를 관리하는 역할이지 콘텐츠를 관리하지 않는다 ④ **좁은 쪽을 골랐다**(§3.3-49 와 같은 이유) — 넓히는 것은 `canExportWorkspace` 한 줄이고, 넓게 열었다 좁히면 쓰던 사람의 기능을 뺏는다. 판정은 스냅샷을 읽기 **전**이다 — 반사실: 게이트를 빼면 그 검사가, 스냅샷 뒤로 옮기면 블록 상한 0 에서 `too_large` 가 먼저 나와 같은 검사가 실패한다 |
| 14 | **y-prosemirror 변환의 연쇄 삭제를 어떻게 막는가** (§7 이 후보 ⓐ 카디널리티 풀기 + appendTransaction 정규화 · ⓑ 변환 감싸기로 남겼다) | **ⓑ 를 포크 없이 — 변환에 넘기는 스키마만 관대한 파사드(`collabSchema`).** 편집 스키마는 루트(`doc: blockGroup+`) 하나만 풀었다. **구조 위반을 Y.Doc 에 고쳐 쓰는 곳은 로그 저장소의 append 하나**다 — 에디터 · 협업 서버는 쓰지 않는다 (#69) | ① y-prosemirror 는 변환에서 **우리가 넘긴 스키마 객체**의 `node` · `mark` · `text` 를 부르고, 바인딩은 `state.schema` 를 넘긴다 — exports 밖의 `createNodeFromYElement` 를 감쌀 필요가 없다. 파사드가 만든 노드는 `blockSchema` 의 노드이고 편집 규칙은 그대로다. 대가는 내부 구현 의존(1.3.7 고정 — 올리면 실제 바인딩 검사가 먼저 깨진다, §7) ② ⓐ 의 카디널리티 풀기는 편집 명령 전부의 전제를 바꾼다 — Fitter · `createAndFill` · split · join 이 내용 규칙에서 나온다. ⓐ 의 "`normalizeBody` 를 appendTransaction 으로"는 **모든 참여자가 수선을 쓴다**는 뜻인데, 진단에서 두 참여자가 같은 그룹 둘을 각자 합치자 **옮긴 블록이 복제됐다** — y-prosemirror 에 옮기기가 없어 합치기 · 올리기가 "지우고 새로 넣기"라서다(`repair.test.ts` ② 가 고정) ③ 작성자를 append 에 둔 이유: 스냅샷 행 `FOR UPDATE` 로 이미 페이지마다 한 줄로 서고, 잠근 뒤 읽은 상태(앞선 수선 포함)에서 계산하므로 수선끼리 겹치지 않는다 — 협업 서버가 여러 대여도 · API 경로가 써도 같다. 수선은 **같은 seq** 에 쌓고 보낸 쪽에 돌려준다(정본 origin 6값에 "시스템 수선"이 없고, 수선은 그 update 를 적용한 결과의 일부다) ④ 루트만 푼 이유: 바인딩은 루트를 `schema.node` 가 아니라 `tr.replace(0, size, …)` 로 채우고, `doc: blockGroup` 이면 Fitter 가 둘째 루트 그룹을 버린 뒤 다음 로컬 편집이 Y.Doc 에서 지운다(진단 · 검사). 편집기 · collab · export 테스트 618개가 루트를 푼 채로 통과했고 전체 선택 삭제는 여전히 그룹 하나다. `pmToDoc` 은 루트 그룹을 전부 읽게 했다. 반사실: 파사드가 내용을 검사하면 10개 · 마크를 던지면 1개 · 루트를 되돌리면 2개 · 저장소가 고치지 않으면 2개 · 수선이 모르는 것을 지나치면 2개 · 고칠 곳 대신 통째로 갈아쓰면 1개 · `pmToDoc` 이 첫 그룹만 읽으면 1개가 — 각각 그 항목만 실패 |
| 15 | **멘션 · 수식에 건 서식을 Y.Doc 에 어떻게 싣는가** (y-prosemirror 가 요소 노드의 마크를 싣지 않는다 — §7) | **노드 attr `marks` 에 거울로 싣는다.** 진실은 ProseMirror 마크이고 세 자리에서 맞춘다 — 만들 때(`createInlineAtom`) · 편집 뒤(`atomMarksPlugin` appendTransaction) · 읽을 때(`collabSchema` · `readBodyYDoc` 이 attr 에서 되살림). 거울 트랜잭션은 되돌리기 기록을 **끄지 않는다.** 플러그인은 에디터에 지금 붙였다 (#70) | ① y-prosemirror 는 요소 노드를 attr 만으로 옮기고 되읽을 때도 마크를 넘기지 않으며, `updateYFragment` 는 ProseMirror attr 에 없는 Y attr 을 지운다 — Y 에 따로 써 둘 자리가 없어 **ProseMirror attr 이어야 한다** ② 마크를 없애고 attr 로 옮기는 대안은 `toggleMark` · 저장 어댑터가 멘션을 글자와 다르게 다뤄야 한다 — 편집 명령은 마크를 기준으로 짜여 있고 `addMark` 는 인라인 원자에도 마크를 건다(`node.isInline` 만 본다 — 소스로 확인). 거울이면 편집은 그대로다 ③ 형식은 `Mark.toJSON()` 배열이고 서식이 없으면 null — null attr 은 y-prosemirror 가 Y 에 쓰지 않아 서식 없는 원자의 Y.Doc 은 이전과 같다 ④ 기록을 끄지 않는 이유: y-prosemirror 는 한 상태 갱신에서 **마지막으로 적용된 트랜잭션**의 `addToHistory` 로 그 갱신 전체를 Y 에 쓸 때의 기록 여부를 정하고, undo 플러그인은 그 값이 false 인 Y 트랜잭션을 잡지 않는다(`captureTransaction`). 끄면 서식을 건 편집 전체가 협업 undo(F-05-15)에서 빠진다 — 실제 바인딩 + `yUndoPlugin` 검사로 확인했다. ⚠ `blockIdPlugin` 은 `addToHistory: false` 를 준다 — 6조각에서 분할 · 붙여넣기가 협업 undo 에서 빠지는지 본다(§7) ⑤ 에디터에 지금 붙인 이유: Phase 0 저장은 attr 을 보지 않아 동작이 같고, 6조각이 붙이기를 기억할 필요가 없다. 반사실: attr 을 안 채우면 3개 · 플러그인이 안 맞추면 4개 · 파사드가 안 되살리면 1개 · 읽기가 안 되살리면 3개 · 되살릴 때 `null` 을 넘기면 1개 · 기록을 끄면 협업 undo 검사 1개가 — 각각 그 주장의 검사만 실패(기록 끄기는 ProseMirror history 검사로는 가려지지 않는다 — 붙인 트랜잭션을 같은 항목으로 묶어서) |
| 16 | **본문 정본을 행에서 Y.Doc 으로 넘길 때 명령들이 무엇을 바꾸는가** (정본 X-1 · X-3 · V-5 는 방향만 정했다 — "참조 노드만 제거" · "재삽입" · "서버가 Y.Doc 로드 → 적용 → update 1개") | **다섯 경로가 한 PR 에서** 본문 Y.Doc 을 거친다: 본문 저장(받은 문서로 Y.Doc 을 맞춘다 · origin `editor`) · 하위 페이지 생성(부모 본문 끝에 참조) · 휴지통(참조 빼기) · 복원(보존된 `order_key` 로 찾은 **앞 형제 뒤**) · 이동(옛 본문에서 빼고 새 본문 끝에). 참조가 사는 문서는 **가장 가까운 페이지 조상**의 것이다. **투영 먼저, 쌓기 나중.** 어느 페이지 본문에도 속하지 않는 이동 대상은 거부한다 (#73) | ① **반쯤 넘기지 않았다** — 행만 고치는 경로가 남으면 행과 Y.Doc 이 어긋나 다음 투영이 행을 지우거나 거부한다. 반사실: 이동이 옛 본문에서 빼지 않으면 새 검사 셋에 기존 이동 검사 둘까지 5개가 실패했다(옛 본문의 투영이 새 자리로 간 행을 다시 넣으려다 PK 로 던진다) ② **복원 자리**: 정본은 "재삽입"만 적었다. B2 가 `order_key` 를 보존하고 형제의 키는 본문 위치의 투영이므로 "그 키보다 앞선 살아 있는 형제 중 가장 뒤의 것 바로 뒤"가 원래 자리다 — 휴지통에 있는 동안 형제가 바뀌어도 가장 가까운 자리로 온다. 토글 안에 있던 페이지도 그 토글 안으로 온다. 맨 뒤에 넣는 반사실에서 자리 검사 2개가 실패 ③ **투영 먼저**: 투영이 거부하면(자식 페이지 누락 · 깊이 초과) 로그에 아무것도 쌓지 않는다 — 거부해도 쌓는 반사실에서 1개 실패 ④ **본문 저장의 origin 은 `editor`**: 경로는 REST 지만 에디터가 보낸 사용자 편집이다. 나머지 명령은 `api`(경로 ②) ⑤ **데이터베이스 대상 거부**: 참조를 둘 문서가 없고, 이전에 받던 동작은 데이터베이스 블록 밑에 페이지 행을 만들어 C-3(행은 data_source 밑)과 어긋났다 — 좁히는 쪽이다. 거부를 빼는 반사실에서 1개 실패 ⑥ 투영은 지금 명령과 같은 트랜잭션에서 **동기로** 돈다 — 정본의 디바운스 워커 · `projected_seq` 는 참여자 update 가 들어오는 5조각의 몫이다(§7). 반사실: 본문 저장이 Y.Doc 을 거치지 않으면 8개 · 휴지통이 참조를 빼지 않으면 3개 · 모르는 타입을 감싸지 않으면 1개가 더 실패했다 |
| 17 | **협업 서버가 참여자 update 를 언제 쌓고 무엇을 퍼뜨리는가** (정본 V-5 는 "경로 ① 은 `doc_update` 1행 append", §3.7 은 "구독 시점 권한검사 + 권한 회수 시 강제 unsubscribe" 까지만 적었고, 05 문서의 권고 경로는 Hocuspocus 의 debounce 저장이다) | **메모리 문서에 적용하기 전에 쌓는다.** `beforeSync` 에서 세션을 다시 해석하고 `appendDocUpdate` 로 로그 + 행 투영을 한 트랜잭션에서 끝낸 뒤에야 Hocuspocus 가 적용하게 둔다. 거부면 던져 **그 문서 연결을 닫는다.** 메모리 문서는 쌓은 뒤 **로그의 꼬리**를 적용해 맞추고 그것이 곧 퍼뜨리기다. 신원은 업그레이드 요청의 **세션 쿠키**, 쿠키를 싣는 연결이므로 `Origin` 을 본다. `appendDocUpdate` 는 `block/body-write.ts` 로 옮겨 투영까지 한다 (#74) | ① Hocuspocus 는 적용하는 순간 퍼뜨린다(`Document.handleUpdate`). debounce 저장이면 권한이 없는 update · 투영이 받지 않는 update 가 **이미 모두에게 퍼진 뒤에** 거부하게 되고, 로그(정본)와 메모리 문서가 갈라진다. `beforeSync` 가 적용 전에 불리고 끝나기를 기다린다는 것은 소스로 읽고 진단으로 확인했다 ② 꼬리 적용 하나로 수선(같은 seq) · 명령이 쓴 것(다른 프로세스)을 함께 가져온다 — 수선을 따로 퍼뜨리는 길이 없어 수선을 쓰는 곳이 여전히 append 하나다(§3.2-14). 받은 update 를 Hocuspocus 가 뒤이어 다시 적용해도 이미 가진 것이라 이벤트가 없다(진단) ③ 세션을 update 마다 다시 해석한다 — F-05-19 "매 mutation 서버 재검사". 연결 때 한 번이면 로그아웃 · 멤버 제거를 모른다 ④ 쿠키는 httpOnly 라 브라우저 코드가 토큰으로 보낼 수 없다. provider 의 토큰 자리를 쓰려면 앱이 토큰을 JS 에 내줘야 한다 ⑤ 연결을 닫는 것 말고는 거부를 알릴 길이 없다 — 참여자 로컬에는 이미 들어가 있고 CRDT 에 되돌리기가 없다. 로컬을 버리는 것은 6조각 ⑥ 4b 뒤에도 투영 없이 쌓는 참여자 경로가 남아 있었다(부르는 곳이 검사뿐). 투영과 한 단위로 옮겨 "행 = Y.Doc 투영"을 참여자 경로에서도 지킨다. 대가는 update 마다 페이지 행 잠금 + 본문 전체 투영(§7 · 5d). 반사실: 세션을 다시 해석하지 않으면 1개 · 읽기 전용을 풀면 1개 · 꼬리를 적용하지 않으면 2개 · 거부를 던지지 않으면 2개 · Origin 을 안 보면 1개 · 투영하지 않으면 6개 · append 가 `edit_content` 를 안 보면 2개가 — 각각 그 주장의 검사만 실패 |
| 18 | **휴지통 · 복원 · 영구 삭제 · 이동에 어떤 페이지 권한이 필요한가** (정본 §3.3 capability 에 삭제 · 이동이 따로 없다. 06 F-06-20 은 이동에 "원본 권한 + 대상 부모의 create 권한 둘 다"까지만 적었다) | **대상 페이지의 `edit_content`** — 볼 수 없으면 `not_found`(404), 볼 수만 있으면 `forbidden`(403). **옮길 곳은 `create_child`** — 없으면 볼 수 있어도 `target_not_found`(404). 대상 행을 잠근 뒤, 삭제 루트 · 블록 타입을 알려주기 전에 본다. 이동 대상 목록은 같은 규칙으로 스코프를 거르고(`scopesWith`), 경로 라벨은 볼 수 있는 조상 페이지 제목만 서버가 준다 (#75) | ① 본문 저장 · DB 행 삭제(`trashRow`)가 이미 `edit_content` 를 본다. page 대상 레벨은 `edit_content` 와 `edit_structure` 를 늘 함께 줘서 페이지에서는 결과가 같고 갈리는 곳은 DB 행뿐인데, 거기서 삭제(`trashRow`)와 복원(`restorePage`)이 같아야 한다 ② 옮길 곳은 하위 페이지 생성(`createPage`)과 같은 capability · 같은 매핑 — 볼 수만 있는 곳을 403 으로 가르면 두 경로가 다르게 답한다. 최상위로는 막지 않는다(최상위 생성도 막지 않는다) ③ 볼 수 없으면 무엇도 알려주지 않는다(§3.3-31) — `not_a_trash_root` 는 묶음의 루트 id 를, 타입 거부는 블록 타입을 담는다 ④ 목록의 "후보의 조상은 전부 후보 안에 있다"는 **볼 수 없는 조상까지 후보에 넣어서 성립했던 보장**이다 — 권한으로 거르면 깨지므로 라벨을 서버가 만들고 조상 id 를 싣지 않는다 ⑤ 06 F-06-16 은 잠긴 페이지의 이동 · 삭제를 "[확인필요] · 클론 권장: 트리 연산은 허용"으로 남겼다 — 잠금이 생기면 capability 판정과 별도 게이트로 붙인다. 검사를 먼저 써서 5개가 전부 실패하는 것을 봤다. 반사실: 버리기 권한 1 · 볼 수 없어도 forbidden 2 · 되살리기가 루트를 먼저 알림 1 · 영구 삭제 1 · 옮길 페이지 1 · 옮길 곳 1 · 목록 1 · 경로 라벨 1 — 각각 그 주장의 검사만 실패 |
| 19 | **본문에서 빠진 살아 있는 하위 페이지를 거부하는가, 휴지통으로 보내는가** (정본 프로젝터 의사코드는 "휴지통 전이"만 적었고, Phase 0 은 낡은 탭을 막으려고 거부했다 — §3.3-12 · §7) | **문서가 어디서 왔는가로 가른다.** 참여자 update(`appendDocUpdate`)는 **휴지통으로 보낸다** — 휴지통 명령과 같은 쓰기 · 같은 권한(`block/trash-rows.ts` · §3.2-18), 하나라도 버릴 수 없으면 update 전체를 거부(`page_ref_forbidden`). 본문 저장(PUT) · 명령은 **계속 거부한다**(`page_ref_missing`). 깊이 초과는 아직 거부 (#77) | ① 기준은 "지웠다"와 "몰랐다"를 가를 수 있는가다. Yjs update 의 삭제는 보낸 쪽이 본 항목(client · clock)만 가리키므로 참여자는 자기가 모르는 하위 페이지를 지울 수 없다 — 빠졌다면 지운 것이다. PUT 은 문서를 통째로 받으므로 낡은 탭이 그 사이 생긴 하위 페이지를 모른 채 보내면 둘이 같아 보인다 — 거기서 휴지통으로 보내면 남이 방금 만든 페이지가 조용히 버려진다 ② 참여자 경로에서 거부를 남기면 안 되는 이유: 그 update 는 참여자 로컬에 이미 들어가 있고 CRDT 에 되돌리기가 없다 — 거부하면 연결을 닫는 것밖에 없고(5a) 5d(디바운스)가 불가능해진다(§3.3-98) ③ 같은 쓰기 · 같은 권한을 한 모듈로 뗀 이유: 두 벌이면 "명령으로 버린 페이지"와 "본문에서 지워 버려진 페이지"가 다르게 복원된다. 권한이 갈리면 휴지통 API 로는 못 버리는 페이지를 참조 노드를 지워 버릴 수 있다 ④ 일부만 버리지 않는 이유: 참조가 빠진 Y.Doc 을 받으면서 행 하나를 살려 두면 다음 투영이 또 빠진 참조를 만난다 — savepoint 가 이미 버린 것까지 되돌린다 ⑤ 깊이 초과를 남긴 이유: 참여자가 하위 페이지를 깊은 곳으로 옮기는 편집은 드물고, 푸는 방법(되돌리는 수선 update · 행 자리 유지)이 투영의 쓰기 방식을 바꾼다 — 5d 에서 투영을 떼어 낼 때 함께 정한다. 반사실: 참여자 경로도 거부하면 3개 · 버릴 권한을 안 보면 2개 · 기본을 휴지통으로 하면 본문 저장의 거부 검사 2개 · 자손을 안 버리면 7개(휴지통 명령과 같은 쓰기라 명령 검사까지) · 부모 version 을 안 올리면 1개가 — 각각 그 주장의 검사만 실패. "하나라도 못 버리면 전체 거부"는 검사가 참조를 하나씩만 지워 반사실을 돌리지 않았다 |

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
| 28 | **검색 축이 둘이다 — 라틴은 tsvector, CJK 는 pg_bigm** (#45) | PostgreSQL 16 의 text search config 28개에 **한국어·CJK 가 없다.** 실측: `to_tsvector('simple','검색이 빠르다') @@ websearch_to_tsquery('simple','검색')` → **false**. `'검색'` 으로 `'검색이'` 를 못 찾는 검색은 한국어에서 쓸 수 없다. `LIKE likequery('검색')` 은 찾는다. 분기는 **쿼리 쪽** 스크립트로 한다(섞인 쿼리는 CJK 로 — bigm 은 라틴도 부분 문자열로 찾으므로 손실이 없다) |
| 29 | **tsvector 는 본문 앞 10만 자만 본다** (#45) | tsvector 한도가 1MB 인데 본문 한도가 1MB 다(F-12-16). GENERATED 컬럼이면 그 예외가 **저장을 통째로 거부한다.** 전부 고유한 한글 토큰으로 실측: 10만 자 42.9% / 20만 자 85.8% / 26만 자 **112.5%(던진다)**. `body_text` 자체는 자르지 않는다 — bigm 축에는 한도가 없어 한국어 검색은 본문 전체를 본다 |
| 30 | **색인의 쓰기자를 나눴다 — 텍스트는 앱, 권한 축은 트리거** (#45) | 권한 축(`perm_scope_id`)을 앱이 복사하게 두면 갱신 누락이 "검색 결과가 낡는다"가 아니라 **권한 누출**이다. 트리거가 쥐면 앱이 잊을 수 있는 것은 텍스트 신선도뿐이다. **실패 방향을 고를 수 있을 때 고른다** |
| 31 | **검색 랭킹은 제목 우선 → 최근 수정순. `ts_rank_cd` 를 쓰지 않는다** (#49) | 라틴 축에서는 거의 공짜지만 CJK 축에 대응물이 없어서, 쓰는 순간 **같은 제품의 한국어 검색과 영어 검색이 다른 규칙으로 정렬된다.** 주 언어가 한국어이므로 일관성을 골랐다. 마스터 문서 W7 도 "랭킹은 최근 수정순"으로 범위를 정했다 |
| 32 | **강조는 `ts_headline` 이 아니라 화면에서 한다** (#47) | ① CJK 축은 tsvector 를 쓰지 않으므로 서버 강조는 **영어 결과만 강조한다** ② regconfig 가 `simple` 이라 스테밍이 없어 화면의 부분 문자열 찾기가 서버 강조와 **같은 결과**다 ③ 사용자 본문에서 나온 마크업을 HTML 로 해석하는 경로를 만들지 않는다 |
| 33 | **DB 행의 제목은 EAV 가 정본이고 `block.properties.title` 은 투영** (#51) | 블록 제목을 읽는 코드가 이미 여럿이다(breadcrumb · 최근 방문 · 검색 색인 · 페이지 화면). 그래서 셀을 쓸 때 한쪽 방향으로 투영한다. 반대 방향이 없으므로 **`renamePage` 가 DB 행을 거부한다** — 없으면 "표에는 옛 제목, 페이지 머리에는 새 제목"을 만들 수 있다 |
| 34 | **`properties_cache` 는 증분이 아니라 EAV 재생성** (#51) | `jsonb_set` 이 싸지만 불변식 R2 가 "복구는 항상 EAV 로부터의 재생성"이라 했다. **재생성이 유일한 경로면 늘 돌고 있어 썩지 않는다** — 증분과 복구를 둘 다 두면 복구 경로는 장애 때만 돌고 그때 처음 버그가 드러난다 |
| 35 | **연산자 카탈로그는 데이터로 두되 SQL 을 담지 않는다** (#52) | F-03-17 이 `(type, operator) → sql_template` 테이블을 권하면서 같은 절에서 "절대 문자열 연결로 SQL 을 만들지 말라"고도 경고한다. SQL 을 DB 에 두면 **컴파일러 동작이 DB 행에 달리고** 그 표에 쓰기가 닿는 날 곧 주입이다. 표에는 `(타입, 연산자)` + UI 메타데이터만, SQL 은 TS 화이트리스트. 일치는 `filter.db.test.ts` 가 강제한다 — `level_capability` ↔ `levels.ts` 와 **같은 패턴** |
| 36 | **연산자는 타입에 달리고 축은 컬럼만 정한다** (#52) | 처음에 사이드카 **축**에 달았더니 `select` 이 `starts_with`·`contains` 를 물려받았다(title·rich_text 와 같은 text 축이라서). select 의 `text_value` 는 **옵션 id** 라 접두사 비교가 무의미하다. 테스트가 잡았다 |
| 37 | **EAV 의 부정 연산자는 `NOT EXISTS` 다** (#52) | 셀이 **없는** 행은 `does_not_equal 5` 에 걸려야 한다(빈 칸은 5가 아니다). `EXISTS(… <> 5)` 로 쓰면 그 행이 빠지고 사용자는 "분명히 5가 아닌데 안 나오는" 행을 본다. `is_empty` 도 같다 |
| 38 | **keyset 커서는 `IS NOT DISTINCT FROM` 으로 비교한다** (#52) | `=` 면 `NULL = NULL` 이 NULL 이라 같은 값(둘 다 빈 칸)인 행이 조건에서 빠지고, **빈 칸 행들이 두 번째 페이지에서 통째로 사라진다.** 커서 파라미터에 **캐스트도 붙인다** — `IS NOT NULL` 에서 처음 쓰이면 `could not determine data type of parameter` 로 죽는다(실측) |
| 39 | **뷰 설정은 공유 상태라 `edit_structure` 다** (#53) | F-03-17: "뷰 설정은 공유 상태다. 내 화면의 행 집합이 갑자기 변한다." 정본 §3.3 의 database 매트릭스에서 `edit_content` 레벨은 `edit_structure` 를 주지 않으므로 "값은 고치지만 **모두가 보는 표의 모양**은 못 고치는 사람"이 데이터로 표현된다 |
| 40 | **불변식 V1 을 라우트 모양으로 지켰다** (#53) | "순서 변경은 반드시 단일 행 UPDATE. 배열이면 'A는 폭, B는 순서'가 전체 LWW 로 충돌한다." 그래서 컬럼 라우트가 `/columns/[propertyId]` 로 **컬럼 하나**를 주소로 갖는다. 여러 컬럼을 한 번에 받는 엔드포인트를 두면 그 순간 배열 LWW 다 |
| 41 | **오버레이를 지키는 것은 포커스 격리다 — `stopPropagation()` 이 아니다** (#47) | 슬래시 메뉴의 교훈(§6)을 그대로 적용해 주석을 썼다가 **반사실에서 틀린 것을 확인했다**: 그 줄을 빼도 e2e 135개가 전부 통과한다. 오버레이가 에디터 DOM **밖**이고 포커스가 입력창으로 가므로 이벤트 경로에 `view.dom` 이 아예 없다. 슬래시 메뉴는 포커스가 에디터에 남아 있어서 달랐다. 코드는 남기고(window 리스너가 여럿이다) **주석을 사실대로 고쳤다** |
| 42 | **DB 행은 사이드바 트리에서 뺀다** (#55 · #56) | 행도 `type='page'` 블록이라(C-3) 타입만 보고 모으면 섞이고, 컨테이너가 트리에 없던 동안엔 **행이 전부 최상위 노드**였다. 컨테이너(`type='database'`)를 넣은 지금도 뺀다 — 표 하나가 사이드바를 행 수만큼 늘린다. 재현 테스트를 먼저 실패시키고 고쳤다 |
| 43 | **지운 행은 페이지 휴지통에서 복원된다** (#55 — §7 의 "행 복원 없음"을 정정) | `trashRow` 가 `trash_root_id = id` 로 지우고 `listTrash` 는 `type='page'` 삭제 루트를 보여준다. `restorePage` 는 `parent_type='block'` 일 때만 재배치하므로 행은 `lifecycle` 만 돌아온다. 노션도 지운 DB 페이지를 휴지통에 보여주므로 막지 않고 테스트로 고정했다 |
| 44 | **표 안의 편집기가 쓴 키는 `defaultPrevented` 로 표를 건너뛴다 — 포커스 격리가 막아 주지 않는다** (#56) | §3.3-41 과 반대 경우다. select 편집기의 입력칸이 표 **안**이라 같은 키 이벤트가 버블링으로 반드시 표에 닿는다. **첫 e2e 검사는 이 가드를 가려내지 못했다** — 옵션 **만들기**(비동기)를 봤는데, 표가 선택을 아래 칸으로 옮겨도 요청이 끝난 뒤 되돌아와 결과가 같았다. 실제 증상은 **기존 옵션을 고르면 편집기가 다시 열리는 것**이었다(고르는 순간 칸이 선택 상태가 되고, 같은 Enter 가 "선택 칸의 Enter = 편집 시작"이 된다). 그 경로로 검사를 바꾸자 그 항목만 실패했고, 틀린 증상을 적은 주석도 고쳤다 |
| 45 | **표 끝의 Tab — 선택 중에는 표 밖으로, 편집 중에는 제자리** (#56) | 선택 중에 막으면 키보드 사용자가 갇힌다(WCAG 2.1.2). 편집 중에 표를 떠나면 저장이 거부됐을 때 오류를 보여줄 자리가 사라진다 |
| 46 | **`modeRef` — 렌더를 기다리지 않는 모드 사본** (#56) | 다른 칸을 누르면 그 칸의 `mousedown` 이 먼저, 편집칸의 `blur` 가 뒤다. `blur` 가 렌더 전 상태를 보면 같은 칸을 **두 번 저장**한다 |
| 47 | **셀 쓰기는 낙관적 — 실패하면 그 칸만 되돌리고, 늦게 온 응답은 행 `version` 으로 거른다** (#56) | 행 전체를 되돌리면 같은 행에서 성공한 다른 칸까지 지운다. 응답 순서가 바뀌면 두 번째 변경이 빠진 행으로 덮인다 |
| 48 | **표를 가로 스크롤 상자로 감싸지 않는다** (#56) | 한 축이 `auto` 인 상자는 다른 축의 `visible` 도 `auto` 로 계산된다(CSS 규칙). 칸 안의 팝오버가 **세로로 잘렸다**(속성 추가 폼 아래끝 331px / 상자 244px). 키보드 · `scrollIntoView` 로만 조작한 e2e 는 못 봤다 — 좌표로 재는 검사를 먼저 실패시키고 고쳤다. `th` 에 `truncate`(overflow: hidden)를 걸지 않는 것도 같은 이유다(#57) |
| 49 | **select 옵션 추가는 `edit_structure` — 좁은 쪽을 골랐다** (#55) | 옵션은 셀이 아니라 스키마다. `edit_content` 만 가진 사람이 옵션을 만들 수 있는지 노션 동작을 1차 출처로 확인하지 못했다. 넓히는 것은 규칙 한 줄이지만 넓게 열었다 좁히면 이미 만든 옵션을 되돌릴 수 없다. 같은 이름(대소문자 무시)이면 거부하지 않고 **기존 옵션으로 수렴**한다(F-03-04 동시편집 엣지) — `ON CONFLICT DO NOTHING`, 반사실로 확인 |
| 50 | **행 추가는 뷰의 주소, 컬럼은 data_source 의 주소** (#55) | 필터가 걸린 뷰에서 추가한 행에 조건을 미리 채우는 동작(노션)은 "어느 뷰에서 만들었는가"를 알아야 한다. 컬럼을 **소유**하는 것은 data_source 다(C-5) |
| 51 | **필터 패널은 평평한 AND 만 편집한다 — OR · 중첩 필터는 편집 불가, 지우기만** (#57) | 펴서 다시 저장하면 OR 이 AND 로 뜻이 바뀐다. 값이 덜 찬 규칙은 저장 트리에서 빼고(서버가 거부해 나머지 저장까지 막는다), 지워진 속성의 규칙 · 정렬 키도 저장 전에 뺀다(읽기는 무시하지만 쓰기는 거부한다) |
| 52 | **패널이 열린 동안은 초안이 진실 — 저장 뒤 서버 렌더가 덮지 않는다** (#57) | 덮으면 아직 값을 넣지 않은 규칙이 사라진다. **첫 e2e 검사는 규칙이 하나뿐이라 가려내지 못했다**(다시 그려져도 똑같이 1개로 보인다). 값이 빈 규칙을 먼저 두고 둘째 규칙을 저장하게 바꾸자, 패널을 저장마다 다시 마운트한 반사실에서 그 항목만 실패했다 |
| 53 | **select 는 정렬 대상에서 뺐다** (#57) | 컴파일러가 select 를 사이드카(`text_value` = 옵션 id)로 정렬해 화면에서 규칙 없는 순서로 보인다. 옵션 정의 순서 조인이 들어올 때 연다(§2 · §7) |
| 54 | **제목 컬럼은 보기에서 숨길 수 없다** (#57) | F-04-12 · F-04-02. 서버가 `title_required` 로 거부한다 — 화면의 토글 잠금과 별개로 |
| 55 | **권한 플래그는 표시 전용** (#56) | `getDatabase` 의 `access` 로 버튼을 **그리지 않는다**(F-04-01: 비활성보다 미노출). 판정은 쓰기 경로가 `can()` 으로 다시 한다 — `displayLevel()` 과 같은 규칙 |
| 56 | **익스포트의 강조는 구분자가 성립하지 않는 자리에서만 HTML 로 떨어진다** (#59) | `**"인용"**입니다` 는 CommonMark 에서 굵게가 **풀리고 별표가 보인다**(닫는 `**` 앞이 문장부호, 뒤가 글자 — micromark 실측). 조사가 붙는 한국어에서 흔한 모양이다. 늘 `<strong>` 이면 파일을 사람이 읽을 수 없고, 늘 `**` 면 서식이 샌다. 판정은 micromark 와 **같은 글자 분류**(`\s` · `\p{P}\p{S}`)로 한다 — 다르면 "우리는 닫힌다고 봤는데 렌더러는 안 닫힌다"가 생긴다. 반사실: 폴백을 빼면 ★ 검사와 조합 검사(3,087가지)만 실패 |
| 57 | **문단 밑 자식은 같은 층으로 편다** (#59) | 마크다운에는 문단을 들여 쓰는 문법이 없다. 네 칸 들여 쓰면 **코드 블록**이 된다(노션 enhanced markdown 의 탭 들여쓰기가 다른 렌더러에서 그렇게 보인다). 코드로 보이는 백업보다 층을 잃은 백업이 낫다. `losses.flattened` 로 센다 |
| 58 | **익스포트 파일에는 `http`·`https`·`mailto`·`tel`(과 스킴 없는 상대 주소) 링크만 건다** (#59) | 파일을 여는 렌더러의 소독에 기대지 않는다. 스킴은 **제어 문자와 공백을 걷어낸 모양**으로 판정한다 — 브라우저는 `java\tscript:` 의 탭을 지우고 해석한다. 글자는 남기고 `losses.unsafeLink` 로 센다. 반사실: 걷어내기를 빼면 그 검사만 실패 |
| 59 | **목록 안 토글 뒤에 빈 줄을 두지 않는다 — 반사실이 주장을 뒤집었다** (#59) | "`</details>` 는 빈 줄까지 이어지는 HTML 블록이라 바로 뒤 `- 항목` 을 삼킨다"고 적고 빈 줄을 넣었는데, **그 분기를 빼도 검사가 전부 통과했다.** 앞 항목의 HTML 블록은 들여 쓴 항목 **안**에 있고, 들여쓰기가 모자란 다음 줄이 그 항목을 닫는다 — 게으른 이어짐은 문단에만 있다. 분기를 지우고 검사 이름을 실제로 지키는 것으로 고쳤다: 자식을 들여 쓰지 않는 반사실에서 그 검사가 실패한다 |
| 60 | **직렬화기 검사는 기준 파서(micromark · MIT · devDependency)로 렌더해 본다** (#59) | 기대 문자열을 손으로 적는 검사는 "우리 생각에 맞는" 글자를 확인할 뿐이다. 이스케이프와 강조 구분자는 바로 그 생각이 렌더러와 어긋나는 곳이다(§3.3-56 의 `**"인용"**입니다` 가 그랬다). CommonMark 명세 테스트를 전부 통과하는 구현으로 **읽힌 결과**를 본다. 런타임 의존성은 늘지 않고, 임포터(F-09-12)가 올 때 같은 파서를 쓸 수 있다 |
| 61 | **ZIP 은 의존성 없이 쓰고, 항목 하나씩 압축을 끝낸 뒤 헤더를 쓴다 — ZIP64 는 없고 넘으면 던진다** (#60) | 헤더 세 종류와 CRC 하나이고 압축 · CRC-32 는 `node:zlib` 에 있다. 크기를 뒤에 적는 데이터 서술자 대신 항목 하나를 압축한 뒤 헤더를 써서 메모리는 가장 큰 항목만큼만 쓴다. 항목 65,534개 · 4GiB 를 넘으면 **잘라 쓰지 않고 멈춘다** — 잘린 ZIP 은 구멍 난 백업이다. 거부된 항목은 상태를 바꾸지 않아 쓴 데까지는 올바른 ZIP 이다 |
| 62 | **ZIP 경로는 풀 때 밖으로 나가는 것(zip slip)뿐 아니라 서로를 덮는 것도 거부한다** (#60) | `../` · 절대 경로 · 역슬래시 · 콜론(드라이브 문자 · NTFS 대체 스트림). 그리고 대소문자 · NFC/NFD 만 다른 두 경로, 같은 이름의 파일과 폴더 — NTFS · APFS 에서 풀면 하나가 다른 하나를 덮거나 풀기가 실패한다. 이름 소독은 2b 의 일이고 이 검사는 마지막 방어다. 반사실: 각 검사를 빼면 해당 항목만 실패 |
| 63 | **ZIP · CSV 는 우리가 짜지 않은 구현으로 읽어 본다 — CI 에서는 python 이 필수다** (#60) | §3.3-60 과 같은 이유. python `zipfile`(CRC · 이름 · UTF-8 플래그 · 내용) · `csv`(따옴표 규칙), bsdtar(풀기), unzip(`-t`). `src/lib/testing/external-tools.ts` 가 찾는다. **CI 가 세 도구를 설치하고(`libarchive-tools` · `unzip`), CI 에서 하나라도 없으면 건너뛰지 않고 실패**한다(`REQUIRE_DB` 와 같은 이유). 처음에는 ubuntu 에 없는 bsdtar 를 "CI 에서 선택"으로 뒀다가 **db 잡이 skip 1 로 끝나 머지 규칙(skip 0)에 걸렸다** — 규칙을 느슨하게 하지 않고 CI 에 도구를 설치했다. 반사실: UTF-8 플래그를 끄면 python · bsdtar 검사가 실패 |
| 64 | **CSV 수식 주입은 사용자가 쓴 글자에만 막는다** (#60) | `=` `+` `-` `@` 탭 · CR 로 시작하면 Excel 이 수식으로 실행한다 — 다른 멤버가 쓴 칸이 내보낸 사람의 PC 에서 실행되는 경로다. 제목 · 글 · select 이름 · 열 이름에 `'` 를 붙이고 센다(OWASP). 숫자(`-5`)와 날짜에는 붙이지 않는다 — 붙이면 숫자 열이 글자 열이 된다. 데이터를 바꾸는 일이라 보고서에 개수를 싣는다 |
| 65 | **CSV 칸의 앞뒤 공백은 따옴표로 감싸지 않는다 — 반사실이 규칙을 지웠다** (#60) | "앞뒤 공백을 지우는 도구가 있으니 감싼다"고 적었는데 그 규칙을 빼도 검사가 전부 통과했다. python csv 는 감싸지 않은 공백을 그대로 읽고 RFC 4180 도 공백을 필드의 일부로 본다. 공백을 지우는 도구를 실제로 확인하지 못했으므로 규칙을 지우고 주석을 사실대로 고쳤다 |
| 66 | **파일 이름에서 이모지(BMP 밖 글자)를 뺀다 — 문서 첫 줄 제목에는 남긴다** (#61) | bsdtar(libarchive 3.8.8 · Windows)는 BMP 밖 글자가 든 이름을 풀지 못한다(2a 에서 이름을 하나씩 떼어 실측 — 한글 · `é` · `·` 는 푼다). 노션 제목에는 이모지가 흔해서 그대로 두면 받은 ZIP 의 일부가 풀리지 않는다. 이모지를 잇던 ZWJ · 변형 선택자도 뺀다(홀로 남으면 보이지 않는 글자다). 파일 이름은 찾아가는 길이고 제목은 `# 제목` 에 그대로 있으므로 잃는 것이 없다. 반사실: 빼지 않으면 bsdtar 로 끝까지 푸는 검사가 실패 |
| 67 | **이름이 겹치면 겹친 항목 전부에 id 를 붙인다 — 먼저 온 쪽이 이름을 갖지 않는다** (#61) | F-09-14: *"파일명 충돌 해결 규칙을 명세로 고정해야 임포터가 역파싱할 수 있다."* 먼저 온 쪽만 원래 이름을 가지면 형제 순서 · **누가 권한으로 빠졌는가**에 따라 같은 페이지의 파일 이름이 익스포트마다 달라진다. id 8자리, 그래도 겹치면 32자리. 페이지 · DB 는 `.md`/`.csv` 와 **폴더 자리까지** 차지한다 — 하위 페이지가 생기는 순간 이름이 바뀌면 안 된다. 겹침 판정은 `zip.ts` 의 `collisionKey` 하나를 쓴다. 반사실: 먼저 온 쪽이 이름을 갖게 하면 겹침 검사 9개가 실패 |
| 68 | **조립(`plan.ts`)은 DB 를 모르고, 스냅샷이 틀리면 던진다** (#61) | 3조각이 한 스냅샷으로 읽어 `ExportSnapshot` 을 넘긴다(§2 계약). 없는 노드를 가리키거나 같은 노드가 두 번 나오면 **던진다** — 건너뛰면 구멍 난 백업을 조용히 만든다. 권한으로 못 보는 자식은 스냅샷에 없고, 본문의 그 참조는 조립이 빼서 `omitted_pages` 로 센다 |
| 69 | **못 읽은 첨부는 멈추지 않고 센다 — 그래서 보고서가 ZIP 의 마지막 항목이다** (#61) | 저장소에 바이트가 없는 파일(업로드가 끊긴 흔적) 하나 때문에 익스포트 전체가 실패하면 나머지를 꺼낼 수 없다. 그 항목만 빼고 `missing_attachments` 에 센다. 흘려보내며 알게 된 것까지 담으려면 보고서가 마지막이어야 한다. ZIP 한계는 반대로 **멈춘다**(잘라 쓰지 않는다) — 흘려보내기 전에 `estimateExport` 로 거른다. 반사실: 못 읽은 첨부에서 멈추면 끝에서 끝까지 검사가, 보고서가 흘려보낸 것을 모르면 보고서 검사가 실패 |
| 70 | **링크 검사는 렌더러처럼 `#` · `?` 앞에서 자른다 · 크기 추정 검사는 항목 3,000개로 한다** (#61) | 처음 쓴 링크 검사는 `href` 전체를 디코드해 파일을 찾았다 — 파일 이름의 `#` 을 인코딩하지 않아도 통과하는데, 렌더러는 그 뒤를 조각으로 잘라 링크가 깨진다. 다시 읽다가 발견해 반사실 전에 고쳤고, `#` 인코딩을 빼는 반사실에서 이제 실패한다. 크기 추정도 항목이 적으면 보고서 몫(64KB)이 헤더를 가려 "헤더를 세지 않는" 추정이 통과한다 — 헤더가 그 몫을 넘도록 3,000개로 늘렸고, 헤더를 빼는 반사실에서 그 검사만 실패한다 |
| 71 | **외부 이미지는 내려받지 않고 주소로 남긴다** (#61) | 서버가 사용자가 적은 주소를 가져오는 순간 SSRF 진입점이다(§7 "이미지 외의 파일 · 북마크 · 임베드"의 OG 크롤러와 같은 이유). 원본이 사라지면 백업에도 없다(§7) |
| 72 | **읽기 트랜잭션은 REPEATABLE READ 다 — 재현하고 고쳤다** (#62) | `withReadTransaction` 의 머리말은 "스냅샷 일관성"을 약속했는데 `BEGIN READ ONLY` 는 READ COMMITTED 라 문장마다 새 스냅샷이었다. `tx.db.test.ts` 가 먼저 재현했다 — 두 COUNT 사이에 다른 커넥션이 커밋하자 두 번째 문장이 그 행을 봤다(`[0, 1]`). 읽기 전용 트랜잭션은 REPEATABLE READ 에서 직렬화 실패가 나지 않으므로 재시도가 필요 없다. 전체 1462개 검사가 그대로 통과했다 |
| 73 | **익스포트 스냅샷은 권한을 SQL 에서 거른다 — 볼 수 없는 제목 · 본문은 DB 밖으로 나오지 않는다** (#62) | 읽은 뒤 조립에서 거르면 볼 수 없는 내용이 한 번은 메모리에 올라오고, 거르기를 빠뜨리는 순간 ZIP 에 들어간다. `perm_scope_id = ANY(readableScopes)` — 사이드바 · 검색과 같은 규칙(§3.3-32). 검사는 스냅샷 전체를 글자로 만들어 비밀 제목 · 본문이 **어디에도 없는지** 본다. 반사실: 필터를 빼면 그 검사와 워크스페이스 검사가 실패 |
| 74 | **볼 수 없는 하위 페이지는 자리만 남겨 세고, 워크스페이스 전체의 "볼 수 없는 페이지 수"는 세지 않는다** (#62) | 편집기의 본문 읽기(`readScope`)는 권한을 거르지 않아 볼 수 없는 하위 페이지의 참조가 **이미 보인다.** 그 자리(id · 부모 · 순서 — 제목 없이)만 읽어 본문에 두면 조립이 `omitted_pages` 로 세고, 새로 알려주는 것이 없다. 반대로 워크스페이스 전체에서 볼 수 없는 페이지를 세면 남의 비공개 페이지 수를 알려주는 일이라 `excluded` 는 비워 둔다. 반사실: 자리를 안 남기면 ★ 검사가 실패 |
| 75 | **스냅샷 트리의 부모는 가장 가까운 "읽은" 조상이다** (#62) | 볼 수 없는 페이지 B 밑에 따로 공유받은 C 는 B 를 건너뛰어 그 위 페이지의 자식이 된다 — 사이드바(`page-tree.ts`)가 C 를 보여주는 자리와 같다. 버리면 볼 수 있는 페이지가 백업에서 빠진다. C 는 위 페이지의 본문에 참조가 없으므로 링크 없이 그 폴더에 들어간다. 반사실: 버리면 ★ 검사가 실패 |
| 76 | **자식 순서 검사는 키 순서와 본문 순서가 갈리게 짰다 — 첫 검사는 반사실을 가려내지 못했다** (#62) | 자식 순서는 본문에 보이는 순서(토글 안까지)다. 처음 검사는 둘째를 토글 안에 넣었는데, 저장이 키를 **형제 이름공간마다** 문서 위치로 다시 매겨서 토글 안 둘째(`a0`)가 루트의 첫째(`a2`)보다 앞이 됐다 — 키 순서와 본문 순서가 우연히 같아 "본문 순서로 줄 세우기"를 빼도 통과했다. 첫째를 뒤쪽 토글 안(`a0`) · 둘째를 앞(`a1`)에 두어 두 순서를 갈랐고, 그 반사실에서 이제 실패한다 |
| 77 | **내려받기는 요약 → 링크 두 단계다 — `fetch` + Blob 이 아니다** (#65) | Blob 으로 저장하면 ZIP 전체가 브라우저 메모리에 오른다(워크스페이스는 GiB 단위가 될 수 있다). 링크면 브라우저가 받는 대로 디스크에 쓴다. 그런데 링크만 두면 거부(너무 큼 · 권한)가 **다운로드 목록의 "실패"로만** 보이고 이유를 말할 자리가 없다. 그래서 요약 라우트가 내려받기와 **같은 준비**(`prepareExport`)를 돌려 개수 · 크기 상한 · 거부를 먼저 보여준다. 대가로 준비를 두 번 한다(§7) — 무엇이 몇 개 들어가는지 보고 누르게 하는 값이다 |
| 78 | **`too_large` 는 422 다 — 413 이 아니다** (#65) | 413 은 **요청 본문**이 클 때의 코드다(RFC 9110 §15.5.14). 요청은 맞는데 동기 다운로드 한 번으로 만들 수 없는 크기라는 뜻이라 422 로 뒀다. 화면 문구는 "하위 페이지를 나눠서 내보내 주세요" |
| 79 | **`?root=`(빈 값)은 워크스페이스 전체가 아니다** (#65) | 범위는 `root` 파라미터의 **유무**로 정한다. 빈 값을 "없음"으로 읽으면 화면이 id 를 빠뜨린 요청 하나가 페이지 대신 워크스페이스 전체를 내보낸다. 빈 id 는 페이지 범위로 두어 `not_found` 가 된다. 반사실: `!root` 로 바꾸면 그 검사만 실패 |
| 80 | **응답 스트림은 당겨 쓰고, 던지면 오류로 끝낸다** (#65) | `start` 에서 앞질러 채우면 받는 쪽이 느려도 첨부를 계속 읽어 메모리에 쌓는다(반사실: 한 조각 읽는 동안 제너레이터가 끝까지 나아가 그 검사만 실패). 던짐을 닫힘으로 바꾸면 끝 레코드 없는 ZIP 이 **정상 종료된 응답**이 된다(반사실: 그 검사만 실패). Next 가 오류 난 본문에서 소켓을 끊는다는 것(`pipe-readable.js` 의 `pipeTo` abort → `res.destroy`)은 **소스로 확인했고 실험하지는 않았다** — 브라우저가 그것을 "실패"로 표시하는지도 보지 않았다 |
| 81 | **Y.Doc 본문 모양은 ProseMirror 스키마 그대로다 — `body` 프래그먼트 하나** (#66) | 판결 X-1 이 "본문 순서의 정본은 `Y.XmlFragment`"라고 정했고, y-prosemirror 가 옮기는 모양을 그대로 저장한다. 별도의 Y 모델(`Y.Map` 블록 + `Y.Array` 순서)을 두면 에디터 바인딩을 직접 짜야 한다(마스터 문서 §6.2 가 직접 구현을 막았다). 대가로 **노드 · 마크 · attr · 프래그먼트 이름을 바꾸는 것이 마이그레이션**이 된다. 빈 페이지도 빈 문단 하나를 담는다 — 빈 프래그먼트를 받은 참여자가 각자 루트 그룹을 넣으면 루트 그룹이 둘이 된다 |
| 82 | **Y.Doc 읽기는 y-prosemirror 의 변환을 쓰지 않는다 — 진단이 가정을 뒤집었다** (#66) | y-prosemirror 는 Y 요소를 `Schema.node`(= `createChecked`)로 만들고 던지면 **그 Y 요소를 지운다.** 처음 코드는 "검사하지 않는 `create` 를 쓰니 위반이 그대로 넘어온다"는 가정 위에 짰고 **주석에도 그렇게 적었다.** 동시 편집 검사 3개가 "블록 0개"로 실패했고, 추측하지 않고 진단 스크립트로 Y XML 을 찍자 합친 Y.Doc 은 예상대로였고 변환이 컨테이너 → 루트 그룹을 연쇄로 지우고 있었다. 읽기를 `NodeType.create` 로 직접 짜고 틀린 주석을 고쳤다. 모르는 마크는 글자를 남긴다(y-prosemirror 는 글자까지 지운다). 반사실: 읽기를 y-prosemirror 변환으로 되돌리면 원본 불변 검사 · 구조 위반 수렴 검사 3개 · 위험 고정 검사가 실패 |
| 83 | **정규화 — 타입 충돌은 Y 순서의 첫째, 자식은 올리지 버리지 않는다** (#66) | Yjs 는 트리 제약을 모르므로 따로 맞는 편집 둘이 합쳐 스키마를 어긴다(`normalize.ts` 머리말의 표 6가지). 타입은 병합할 수 없다(F-05-01 시나리오 4). 어느 쪽이 남는지는 Yjs 의 동시 삽입 순서(client id)가 정한다 — "늦게 한 쪽이 이긴다"고 적지 않았다, 사실이 아니라서다. 자식을 못 갖는 타입 · 깊이 상한의 자식은 뒤 형제로 올린다. 반사실: 규칙마다 해당 검사가 실패(마지막을 남기면 1 · 빈 그룹 1 · 그룹 합치기 2 · 올리기 3 · 깊이 1). 빈 그룹을 남기는 반사실은 `ydoc.test.ts` 쪽이 못 본다 — 문서(EditorDoc)에서는 빈 그룹이 보이지 않고, `normalize.test.ts` 의 `doc.check()` 가 잡는다 |
| 84 | **정규화가 매기는 id 는 결정론이고 페이지 id 를 씨앗으로 한다** (#66) | 무작위면 프로젝터가 읽을 때마다 새 `block` 행이 생긴다. 빈 id 는 위치로 만드는데 위치는 페이지마다 겹친다 — 씨앗이 없으면 두 페이지의 같은 자리 블록이 같은 PK 를 받는다. 에디터도 같은 함수를 **동기로** 불러야 해서 Web Crypto(비동기) 대신 cyrb53 셋을 이었다(암호학적일 필요가 없다). 중복 id 는 문서 순서의 첫째가 갖는다. 반사실: 빈 id 를 무작위로 · 중복 id 를 그대로 두면 각각의 검사가 실패 |
| 85 | **로그에 쌓는 것은 받은 바이트가 아니라 적용해서 바뀐 부분이고, "바뀌었는가"는 state vector 가 아니라 `update` 이벤트로 판정한다** (#67) | 참여자는 서버가 이미 가진 구조까지 담은 update 를 보낼 수 있다(재전송 · 전체 상태). 그대로 쌓으면 로그가 같은 구조로 불어난다. 판정을 state vector 비교로 하면 **지우기만 하는 update 가 조용히 버려진다** — Yjs 는 삭제에 새 clock 을 쓰지 않아 state vector 가 그대로다(검사가 그 전제를 먼저 단언한다). `update` 이벤트는 삭제만 있어도 나오고 이미 받은 것에는 나오지 않는다. 반사실: state vector 로 판정하면 삭제 검사만 · 받은 바이트를 쌓으면 그 검사만 실패. **처음에는 "바뀐 부분을 쌓는다"를 가려내는 검사가 없었다** — 반사실 전에 다시 읽다가 발견해 검사를 먼저 넣었다 |
| 86 | **앞선 update 가 없는 update 는 거부한다 — pending 으로 쌓지 않는다** (#67) | Yjs 는 빠진 조각을 기다리며 pending 으로 들고 있는다. 그 update 를 로그에 쌓으면 빠진 조각이 올 때까지 본문에 보이지 않는 내용이 정본에 산다. 거부하고 보낸 쪽이 state vector 로 다시 맞추게 한다(S2 재동기). 반사실: pending 검사를 빼면 그 검사만 실패 |
| 87 | **Phase 0 페이지는 처음 읽을 때 같은 트랜잭션에서 옮기고, 이력은 스냅샷 PK 가 하나로 정한다** (#67) | 일괄 이관 잡이 없고 SQL 로는 Yjs 바이너리를 만들 수 없어 앱이 처음 읽을 때 옮긴다. `origin='import'` — 정본 CHECK 6값 중 "다른 형식에서 처음 만든다"에 가장 가깝다. actor 는 없다(시스템). 행을 따로 읽으면 그 사이의 저장이 빠진다(`readLiveBody(tx, …)`). 각자 만든 Y.Doc 은 client id 가 달라 내용이 같아도 **다른 CRDT 이력**이고 섞이면 본문이 두 번 들어간다 — `ON CONFLICT DO NOTHING` 으로 진 쪽이 이긴 쪽 것을 읽는다. 볼 수만 있는 사람이 처음 읽어도 옮긴다(내용은 그대로, 형식만 바뀐다) |
| 88 | **동시 첫 읽기 검사는 표 잠금으로 경쟁을 강제한다 — 첫 검사는 반사실을 가려내지 못했다** (#67) | 처음에는 읽기 5개를 그냥 동시에 불렀는데 `ON CONFLICT` 를 빼도 통과했다 — 먼저 커밋한 쪽의 스냅샷을 나머지가 읽어 경쟁 자체가 일어나지 않았다. 주장(없으면 진 쪽이 PK 오류를 받는다)은 맞으므로 검사를 고쳤다(§5): 다른 커넥션이 `doc_snapshot` 에 `SHARE ROW EXCLUSIVE` 잠금을 걸고, `pg_locks` 로 5개가 모두 INSERT 앞에서 기다리는 것을 확인한 뒤 푼다. 기다리는 동안 무엇이 실패해도 잠금은 `finally` 에서 푼다. 이제 그 반사실에서 그 검사만 실패한다 |
| 89 | **seq 는 스냅샷 행을 `FOR UPDATE` 로 잡고 1씩 — 재시도 없음 · 압축은 스냅샷만** (#67) | 한 페이지의 append · 압축이 한 줄로 선다. 잠금 없이 `마지막 seq + 1` 을 계산하면 동시 append 가 같은 seq 를 받아 PK 로 던진다. 빈틈이 없어야 "합치지 않은 수 = 최신 seq − merged_seq" 가 성립한다. 압축은 들고 있는 Y.Doc 으로 스냅샷만 새로 쓰고 로그를 지우지 않는다(S1). 반사실: 잠금을 빼면 동시 append 검사만 · 압축이 로그를 지우거나 merged_seq 를 하나 더 올려 쓰면 압축 검사만 실패 |
| 90 | **수선은 사본에서 먼저 고쳐 보고 확인한다 — 그 확인에 걸리는 입력은 찾지 못했다** (#69) | "읽기가 그대로이고 고칠 것이 남지 않았을 때만 원본에 적용한다"고 적었는데 **확인을 빼는 반사실에서 검사가 전부 통과했다.** 수선은 Y.Doc 을 자기의 정규화된 읽기에 맞추는 것이라 구성상 프로젝션이 같다(① 이 장면마다 본다). 코드는 남기고(비교가 어긋나는 날 본문을 바꾸는 대신 위반을 남긴다) "막는다"가 아니라 "도달하는 입력을 찾지 못한 방어"로 주석을 고쳤다 |
| 91 | **모르는 노드 · 마크가 있으면 수선하지 않는다** (#69) | 수선은 매핑 없이 구조로 비교하므로 읽기에서 빠진 모르는 요소를 Y.Doc 에서 지운다. 바인딩은 매핑 동일성으로 그 요소를 건너뛰어 남긴다(진단으로 먼저 봤다 — 추측으로 단언을 쓰지 않았다). 위반을 남기는 쪽이 새 버전 클라이언트의 블록을 지우는 쪽보다 낫다. 반사실: 가드를 빼면 그 검사 2개만 실패 |
| 92 | **동시 편집 검사는 실제 `ySyncPlugin` 을 헤드리스로 붙인다** (#69) | `initProseMirrorDoc` 만 보면 바인딩의 다른 경로를 놓친다 — 루트는 `tr.replace` 의 Fitter 를 거쳐서 루트 그룹 둘이 그 경로에서만 지워졌다. `testing/collab-peers.ts` 의 `bind` 가 바인딩이 view 에서 쓰는 것(`state` · `dispatch` · `hasFocus`)만 흉내 낸다. EditorView 처럼 초기화 도중의 dispatch 에서는 아직 없는 플러그인 뷰를 부르지 않는다 — 처음 흉내는 거기서 죽었다. #70 부터 플러그인 뷰를 **전부** 붙인다(`yUndoPlugin` 을 함께 붙이려고) |
| 93 | **attr 이 없는 마크 JSON 을 되살릴 때 `null` 이 아니라 `{}` 를 넘긴다 — 검사가 잡았다** (#70) | ProseMirror 의 `computeAttrs` 는 `value && value[name]` 으로 읽어 attrs 가 null 이면 "값이 없다" 검사를 건너뛴다 — `{ type: 'link' }` 에서 **`href: null` 인 링크**가 만들어져 `href="null"` 로 그려진다. "주소 없는 링크는 서식만 뺀다"는 검사가 처음 돌 때 실패해서 알았다. `{}` 면 던진다. 반사실: `null` 로 되돌리면 그 검사만 실패. 같은 검사의 두 번째 실패는 코드가 아니라 비교였다 — ProseMirror 의 attr 객체는 프로토타입이 없어(`Object.create(null)`) 리터럴과 strict `deepEqual` 이 어긋난다. JSON 으로 비교한다. Y 글자 서식을 읽는 `ydoc.ts` · `collabSchema.mark` 는 attrs 를 `?? null` 로 넘긴다 — Y 에서 null 값이 오는지는 확인하지 않았다 |
| 94 | **e2e 가 서버 본문을 API 로 바꾸기 전에 "서버에 닿았다 → 큐가 비었다" 순서로 기다린다 — 큐만 보는 대기는 경쟁이 남았다** (#69 · #70) | 저장 큐의 `resume` 은 못 보낸 문서를 "서버보다 새것"으로 화면에 되살린다. 그래서 편집이 큐에 남은 채 스크립트가 서버 본문을 덧붙이고 이동하면 덧붙인 블록이 화면에 없다 — main 에서도 이미지 절이 매번 이렇게 멈춰 그 뒤 절이 돌지 않았다. #69 는 IndexedDB 큐가 비기를 기다렸는데 3a 빌드에서 통과하고 3b 빌드에서 **같은 자리가 다시 실패했다**(큐가 비었다는 검사는 통과). 큐는 디바운스 뒤에 디스크에 쓰므로(`page-sync.ts` queue) 쓰기 전이면 비어 보이고, 이동할 때 pagehide 가 그 항목을 쓴다. 보내기 전에는 디스크에 먼저 쓰므로(`attempt`) **서버에 닿은 것을 먼저 보고** 그 뒤 큐가 비었다면 확정이다. 고친 뒤 206 / 208. 두 번째 실패를 3b 회귀로 오해하지 않으려고 원인을 코드에서 먼저 찾았다 |
| 95 | **4조각은 원시 연산(4a)과 넘기기(4b)로 자른다 — 넘기기는 경로 전부와 한 번에** (#71) | 정본을 넘기는 순간 행을 직접 고치는 경로가 하나라도 남으면 Y.Doc 과 행이 어긋난다(§2 순서의 근거). 그래서 넘기기는 쪼갤 수 없고, 쪼갤 수 있는 것은 **아무 경로도 부르지 않는 앞부분**뿐이다 — 호출자 트랜잭션 안의 본문 세션(`openBodyDoc`) · ProseMirror 변경을 Y.Doc 에 쓰는 한 벌(`body-edit.ts`) · 동작 그대로의 프로젝터 추출(`projectBodyRows`). 세션을 **권한 밖**에 둔 이유: 하위 페이지 생성은 부모 본문의 `edit_content` 가 아니라 `create_child` 로 부모 문서에 참조를 넣는다. 테스트의 `edit` 도 같은 한 벌을 쓰게 해 서버와 테스트가 갈라지지 않는다. 반사실: 받은 actor · origin 을 무시하면 2개 · 한 번만 쌓기 가드를 빼면 1개 · 적용 실패 세션의 쌓기 가드를 빼면 1개 · 서식 거울을 빼면 1개 · 편집 스키마로 읽으면 3개가 실패했다. **변경이 없을 때 돌아가는 줄은 빼도 실패가 0개** — `updateYFragment` 가 같은 문서에서 아무것도 쓰지 않아서다. 코드는 두고 "빠른 길일 뿐"으로 주석을 고쳤다 |
| 96 | **본문 저장이 거부될 때 투영이 쓰다 만 것이 커밋되고 있었다 — 재현하고 고쳤다** (#72) | `withTransaction` 은 콜백이 **반환하면 커밋**한다. 그런데 프로젝터는 깊이 초과(`page_ref_too_deep`)를 지우기 · 넣기 · 임시 키를 쓴 **뒤에** 알고 거부를 반환했다 — 옮기려던 자식 페이지의 `order_key` 가 임시 키 `'~' || id` 로 남았다(형제 맨 뒤로 보이다가 다음 성공한 저장에서 제자리로 온다). 기존 검사는 자식의 `ancestor_path` 만 봤고 `relocateSubtree` 가 경로를 쓰기 전에 던지므로 늘 통과했다. 4b 가 거부 경로에서 Y.Doc 쓰기까지 되돌려야 해서 트랜잭션 의미를 읽다가 발견했다. 검사를 "그 페이지 아래 행 전체가 거부 전후로 같다"로 넓혀 **먼저 실패시키고**, 투영을 savepoint 안에서 돌려 거부면 던져 되돌리게 했다 — 호출자가 되돌리기를 잊을 수 없는 자리다. 반사실: savepoint 를 빼면 그 검사만 실패 |
| 97 | **"세션을 먼저 열고 행을 쓴다"는 참조가 둘이 되는 것을 막지 않았다 — 막는 것은 넣기의 멱등성이다** (#73) | 4a 에서 "하위 페이지 행을 먼저 쓰고 부모 본문을 처음 열면 옮기기가 참조를 이미 담아, 명령이 넣으면 둘이 된다"고 적고 순서를 규칙으로 정했다. 4b 에서 하위 페이지 생성의 순서를 뒤집는 반사실을 돌리자 **검사가 전부 통과했다** — `page-refs.ts` 의 넣기가 이미 있는 참조를 넣지 않고, 옮기기가 담는 자리(행 순서의 끝)와 명령이 넣는 자리가 같아서다. 순서 규칙은 두되("명령이 자기가 바꾼 것을 자기가 쓴다") "둘이 된다"는 주석을 `body-write.ts` · `doc-store.ts` · `page.ts` 와 §2 에서 사실대로 고쳤다. 옮기기가 참조를 담는다는 사실은 `doc-store.db.test.ts` ⑦ 이, 넣기의 멱등성은 `page-refs.test.ts` ① 이 고정한다 |
| 98 | **5조각은 참여자 경로를 지금의 거부 규칙 그대로 먼저 닫고(5a), 정본 프로젝터(5b) → 즉시 전파 · 권한 회수(5c) → 투영 디바운스(5d) 순서로 자른다** (#74) | ① 5a 에 투영까지 넣었다 — 투영 없이 쌓는 참여자 경로를 한 조각이라도 머지하면 "행 = Y.Doc 투영"(4b)이 깨진다 ② 휴지통 전이(5b)는 "참여자가 하위 페이지를 버릴 권한"을 정해야 하는데 **휴지통 명령 자체에 페이지 권한 규칙이 없다**(§7 맨 위) — 규칙 없이 참여자 쪽만 만들 수 없다 ③ **디바운스(5d)는 5b 뒤라야 한다** — 투영을 쌓기 뒤로 미루면 투영의 거부로 쌓기를 막을 수 없다. 거부(`page_ref_missing` · `page_ref_too_deep`)가 참여자 경로에서 사라진 뒤에야 투영을 떼어 낼 수 있다 ④ 즉시 전파(5c)는 프로세스 사이 통로라 경계가 다르다 — 5a 의 꼬리 적용이 받는 쪽을 이미 만들었다 |
| 99 | **"퍼지지 않았다"는 기다려서 보지 않고, 뒤에 보낸 것이 도착한 뒤에 본다** (#74) | 기다린 시간 안에 안 왔다는 것은 증명이 아니다. 서버는 받은 순서대로 적용하고 퍼뜨리므로, 막아야 할 update 가 퍼졌다면 뒤에 보낸 편집보다 먼저 닿는다(`collab-server.db.test.ts` ④ · ⑦). 읽기 전용 검사(②)는 거부된 연결이 닫히지 않으므로 **같은 연결로 뒤따라 보낸 awareness** 가 닿기를 기다린다 — 한 연결의 메시지는 차례로 처리되고, 한 번의 flush 에서 문서 update 가 awareness 보다 먼저 나간다(`Document.flush` 소스). ⚠ 반사실(읽기 전용을 풀기 · 거부를 던지지 않기)은 그보다 앞선 단언(scope · 닫힘)에서 실패해 **이 장치 자체를 가려내지는 않았다** |
| 100 | **하위 페이지 목록은 부모를 볼 수 없으면 비우고, breadcrumb 은 볼 수 있는 조상만 싣는다 — "워크스페이스 경계가 보안 축"이라는 주석이 누출의 전제였다** (#76) | ① W6-b(#41)가 사이드바 · 휴지통 · 최근 방문에 `readableScopes` 를 넣을 때 `listChildPages` · `listAncestors` 는 빠졌다. `page.ts` 머리말이 "워크스페이스 경계가 이 파일의 보안 축이다", `getPage` 주석이 "권한은 W6 에서"라고 적고 있었다 — 코드는 `getPage` 만 고쳤고 주석과 두 목록이 W4 의 전제로 남았다. 주석을 사실대로 고쳤다 ② 볼 수 없는 부모의 목록을 `[]` 로 둔 이유: 따로 공유받은 하위 페이지를 담으면 "그 id 는 있는 페이지이고 이 페이지의 부모다"를 알려준다. 없는 부모도 `[]` 라 가르지 않는다 ③ breadcrumb 에서 빠진 조상은 건너뛴다 — 사이드바가 같은 페이지를 가장 가까운 볼 수 있는 조상 밑에 둔다(§3.3-75 와 같은 규칙). 검사를 먼저 써서 3개가 전부 실패하는 것을 봤다 |

---

## 4. 작업 리듬 (지금까지 지켜온 것)

```
1. 정본 문서를 먼저 읽는다        ← 기억으로 쓰지 않는다
2. git checkout -b <타입>/<이름>
3. 구현 + 테스트
4. npm run check  (typecheck · lint · license · test)
5. npm run db:verify:schema
6. 화면에 기대는 것이면: npm run build && npm run e2e   ← #31 부터
7. 커밋 → 푸시 → gh pr create     ← 작업이 끝나면 7~9 머지까지 반드시 완료한다
8. CI 두 잡 통과 확인 (db 잡의 skip 이 0인지도 본다)
9. gh pr merge --squash --delete-branch    ← 허락을 따로 묻지 않는다(사용자가 정했다)
10. 새 브랜치를 판다              ← 머지 후 main 에 서 있다
```

**작업이 끝나면 커밋 · 푸시 · PR · CI 확인 · 머지까지 완료한다.** 사용자가 정한 규칙이다(2026-09-13).
머지 허락을 따로 묻지 않는다 — CI 두 잡이 초록이고 db 잡의 skip 이 0 이면 squash 머지하고, `main` 으로 돌아가
최신을 받아 둔다. 로컬에만 남은 커밋이나 머지되지 않은 PR 은 다음 세션이 이어받기 어렵다 — "끝났다"고 말하기
전에 PR 이 머지됐고 `git status` 가 깨끗한지 확인한다.

⚠ 자동 모드의 권한 분류기가 `gh pr merge` 를 "리뷰 없는 머지"로 막은 적이 있다(W8-b · #59). 막히면 **우회하지 말고
사용자에게 알린다** — 머지는 이미 허락된 작업이니 권한 설정에 규칙을 추가해 달라고 부탁하면 된다.
- #59 에서 막힌 것은 `gh pr merge …; git switch main; git pull` 처럼 **다른 명령과 이어 붙인** 실행이었다. 그 뒤
  `gh pr merge <n> --squash --delete-branch` 를 **단독으로** 실행한 머지(#59 ~ #63)는 통과했다. 원인은 확인하지 못했으므로
  "단독이면 된다"고 믿지 말고, 단독으로 실행하되 막히면 위와 같이 한다. `gh` 가 머지 뒤 `main` 을 빨리 감기로 받아 준다
- 에이전트가 권한 규칙 파일(`.claude/settings.local.json`)을 직접 쓰려 하면 "자기 권한 수정"으로 막힌다. 다른 도구로
  같은 파일을 쓰는 것은 우회다 — 하지 않는다. 규칙은 사용자가 `/permissions` 로 넣는다

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
- **반사실이 통과했는데 주장은 맞다면, 검사가 그 주장을 가려내지 못하는 것이다 — 그때는 검사를 고친다.** W8-b 에서 처음 쓴 e2e 검사 둘이 그랬다: 옵션 "만들기"(비동기) 경로는 가드를 빼도 결과가 같았고(§3.3-44), 규칙 하나짜리 초안 검사는 패널을 다시 그려도 똑같이 보였다(§3.3-52). 둘 다 **반사실에서 통과**해서 알았다.
- **버그를 고치기 전에 재현하는 테스트를 먼저 쓴다.** #40 은 정본을 읽다 발견한 "멈춘 요청이 세션의 저장을 통째로 멈춘다"를 **실패하는 테스트 두 개**로 먼저 재현한 뒤 고쳤다.
- **`assert.equal(EditorState, null)` 로 쓰지 않는다.** 실패하면 node 가 메시지를 만들려고 EditorState(스키마까지 딸린 객체 그래프)를 통째로 inspect 하다 **멈춘다**(40초 넘게). `assert.ok(x === null, '…')` 로 쓴다. 기존 테스트에 이 패턴이 남아 있다(§7).
- **입력 규칙은 한 글자씩 타이핑해 확인한다.** `handleTextInput` 을 직접 부른다 — 텍스트를 한 번에 넣으면 규칙이 아예 돌지 않아 "패턴은 맞는데 트리거되지 않는" 경우를 놓친다.
- **DB 테스트는 `REQUIRE_DB=1`로 CI에서 강제한다.** 조용히 skip되면 그 테스트는 썩는다.
- 마이그레이션을 추가하면 `scripts/verify-schema.mjs`의 `EXPECTED_TABLES`도 갱신한다.

---

## 6. 세션 운영 요령 (실제로 겪은 것)

**⚠ `npm run e2e` 는 이 PC 에서 Chrome 으로 돌린다.** W8-b 에서 한 시간 넘게 잃었다.
- Edge 153 헤드리스는 복사 · 붙여넣기 절의 **진짜 `Ctrl+C`(시스템 클립보드 쓰기)에서 프로세스가 종료**된다(크래시 덤프 없음). 그때 스크립트가 끊긴 CDP 요청을 기다리며 **10분 넘게 조용히 매달렸다** — 이제는 소켓이 닫히면 "브라우저와의 연결이 끊겼다"를 찍고 끝난다
- Chrome 은 끝까지 돌지만 그 붙여넣기가 붙지 않아 **클립보드 검사 2개가 실패**한다. 브라우저 없이 PowerShell 로 OS 클립보드에 쓰고 읽는 것은 정상이다
- `E2E_BROWSER="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run e2e > <로그> 2>&1` 을 **백그라운드**로 돌리고 로그를 본다. 한 번에 약 5분이다. `| Select-Object -Last N` 으로 받으면 끝날 때까지 **아무 출력도 안 보인다**
- 남은 서버 · 스크립트 프로세스를 정리할 때 **명령줄 문자열을 그대로 패턴으로 쓰지 마라** — 정리 명령 자신의 명령줄에도 그 문자열이 들어 있어 **자기 자신과 부모 셸을 죽인다**(종료 코드 255). 포트 3100 소유자를 찾거나 문자열을 쪼개 만든다(`"scripts/e2e-edi" + "tor"`)

**⚠ PowerShell 5.1 은 네이티브 명령에 넘기는 인자 안의 큰따옴표를 쪼갠다.** W8-b 에서 여러 번 당했다.
- `git commit -m @'...'@` 본문에 `"` 가 있으면 인자가 흩어져 `pathspec did not match` 로 커밋이 **실패**한다 → **`git commit -F <파일>`**
- `gh ... --jq '"상태: " + .state'` 도 같은 이유로 `accepts at most 1 arg` 가 난다 → `--json` 만 받아 읽는다
- PR 본문은 `--body-file` 로 넘긴다

**GitHub · Docker Hub 가 502 를 줄 때**: `gh pr create` 가 GraphQL · REST 모두 502 로 실패한 적이 있다(githubstatus 로 확인하고 잠시 뒤 성공). CI 의 db 잡이 20초 남짓 만에 실패하면 코드가 아니라 **Docker Hub 이미지 받기 502** 일 수 있다 — `gh run view --job <id> --log-failed` 로 먼저 본다.

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

**⚠ 스택 PR 을 쌓지 마라 — `--delete-branch` 가 위의 PR 을 죽인다.** W7 에서 당했다.

머지 권한이 막혀 있던 동안 PR 네 개를 체인으로 쌓았다(`#45 ← #46 ← #47 ← #48`). `gh pr merge #45 --squash --delete-branch` 가 base 브랜치를 지우자 **#46 이 자동으로 닫혔고**, base 브랜치가 없어서 **reopen 도 안 됐다**(`Cannot change the base branch of a closed pull request`). 같은 브랜치로 새 PR(#49)을 다시 만들어야 했다.

그리고 squash 머지가 `main` 히스토리를 재작성하므로 위에 쌓인 브랜치는 **충돌한다.** 해결은 머지가 아니라 리베이스다:

```bash
git rebase --onto origin/main <이미-머지된-커밋> <내-브랜치>   # 앞 커밋만 떼어낸다
git push --force-with-lease
```

**한 PR 을 머지하고 다음을 시작하는 것이 원칙이다.** 부득이 쌓을 때는 머지 **전에** 위 PR 들의 base 를 `main` 으로 돌려 둔다(`gh pr edit <n> --base main`).

**⚠ 새 API 라우트의 `RouteContext` 타입은 빌드가 생성한다.** W8-b 에서 당했다.

`npm run typecheck` 를 빌드 전에 돌리면 이렇게 실패한다:

```
Type '"/api/workspaces/[workspaceId]/databases"' does not satisfy
  the constraint 'AppRouteHandlerRoutes'.
Property 'workspaceId' does not exist on type 'unknown'.
```

코드 문제가 아니라 **순서 문제**다. `.next/types/routes.d.ts` 가 아직 그 라우트를 모른다. `npm run build` 를 한 번 돌리면 생성되고 그다음 typecheck 는 깨끗하다. 빌드 출력의 라우트 목록에 그 경로가 있으면 등록된 것이다.

**⚠ SQL 템플릿 리터럴 안의 주석에 백틱을 쓰지 마라.** W8 에서 **세 번** 당했다.

우리 SQL 은 전부 `` `...` `` 템플릿 리터럴이고, 그 안의 `-- 주석` 에 식별자를 백틱으로 감싸면 **그 자리에서 문자열이 끝난다.** 증상은 SQL 오류가 아니라 엉뚱한 줄의 타입스크립트 구문 오류다:

```
src/lib/block/page.ts(476,43): error TS1005: ',' expected.
```

주석 안에서는 백틱 없이 `block.properties.title` 처럼 그냥 쓴다. 같은 이유로 `${...}` 도 조심한다 — 주석에 적어도 보간이 돈다.

**`npx prettier` 를 그냥 돌리지 마라.** 저장소에 prettier 설정이 없어서 기본값(쌍따옴표 · 세미콜론)으로 파일 전체를 다시 포맷한다 — 이 저장소 스타일은 작은따옴표 · 세미콜론 없음이다. 한 번 당했고 `git checkout` 으로 되돌렸다.

**긴 문자열 치환에 스크립트 + `replace`를 쓰면 조용히 실패한다.** 이 세션에서도 한 번 당했다(한글·`·` 같은 비-ASCII가 섞인 앵커에서 heredoc 인코딩이 어긋났다). **파일 수정은 Edit 도구를 쓴다.** 스크립트로 치환했다면 `assert` 를 넣고 `grep`으로 반영을 확인한다.

**⚠ Write · Edit 도구 인자에 역슬래시-u 네 자리 16진수 이스케이프를 적으면 실제 문자로 풀려 저장된다.** #60 에서
CSV 의 BOM 상수가 이스케이프 글자가 아니라 **보이지 않는 U+FEFF 문자 하나**로 들어갔다. 동작이 같아 테스트는
통과했고, 반사실 스크립트가 그 앵커를 못 찾아서야 드러났다. 같은 파일의 `\r\n` 과 중괄호 형태(`\u{10000}`)는
글자 그대로 남았다. 소스에 이스케이프를 남겨야 하면 쓴 뒤 Grep 으로 실제 문자(`\x{FEFF}` 패턴)가 없는지 보고,
있으면 `String.fromCharCode(0xfeff)` 로 찾는 스크립트로 되돌린다 — 치환 개수를 단언한다.

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
| **⚠ 부모 본문의 하위 페이지 참조가 볼 수 없는 페이지의 제목을 싣는다** | **#76 을 만들며 발견, 설계가 먼저다.** `loadPageBody`(`rowsToDoc`)는 본문의 하위 페이지 참조에 그 페이지 행의 제목을 권한과 무관하게 싣고, Y.Doc 의 참조 노드에도 만들 때의 제목(`title` attr)이 들어 있다 — 부모를 볼 수 있으면 비공개 하위 페이지의 제목이 편집기 · 협업 참여자에게 보인다. **읽을 때만 가리면 안 된다**: 가린 문서를 본문 저장(PUT)으로 되보내면 `updateYFragment` 가 Y.Doc 의 참조 제목을 빈 값으로 덮고, 협업 참여자는 Y.Doc 을 그대로 본다. 참조 노드에서 제목을 빼고 화면이 권한을 거쳐 읽는 쪽(노션처럼 "접근 권한 없음" 자리 표시)이 후보다 — 에디터 바인딩(6조각) 전에 정한다. 익스포트는 이미 뺀다(§3.3-74) | `src/lib/editor/document.ts` `rowsToDoc` · `block/page-refs.ts` · `save-page-body.ts` `readScope` |
| ~~하위 페이지 목록 · breadcrumb 이 볼 수 없는 페이지의 제목을 내준다~~ | **해결(#76).** #75 를 만들며 발견했다. `listChildPages`(워크스페이스 홈 · 페이지 화면 · `GET /pages?parent=`) · `listAncestors`(breadcrumb)가 사이드바와 같은 규칙(`perm_scope_id = ANY(readableScopes)`)으로 거른다. 볼 수 없는 부모의 하위 목록은 비어 있다 — 따로 공유받은 하위 페이지가 있어도 | `src/lib/block/page.ts` |
| ~~휴지통 · 복원 · 영구 삭제 · 이동 명령이 페이지 권한을 보지 않는다~~ | **해결(#75 · §3.2-18).** 5a 에서 발견했다. 대상 페이지의 `edit_content`(볼 수 없으면 `not_found`, 볼 수만 있으면 `forbidden` 403), 옮길 곳은 `create_child`. 이동 대상 목록도 옮길 수 있는 곳만 담고, 경로 라벨에는 볼 수 있는 조상 제목만 싣는다(전에는 워크스페이스의 모든 페이지 제목을 화면에 넘겼다) | `src/lib/block/trash.ts` · `move-page.ts` |
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
| ~~표 화면 (UI)~~ | **해결(#55 · #56 · #57).** 쓰기 라우트 · 풀페이지 DB 화면 · 필터 · 정렬 · 표시 속성 | `src/app/w/[workspaceId]/db/[databaseId]/` |
| **뷰 탭 순서 변경 · 개인 뷰** | `view.order_idx` 로 정렬해 읽지만 탭을 드래그해 옮기는 함수가 없다. `owner_user_id`(개인 뷰) 컬럼도 비어 있다 — 공유 뷰만 만든다 | `src/lib/database/view.ts` |
| **뷰 타입은 table 하나** | `MVP_VIEW_TYPES = ['table']`. 정본의 `type` 은 10종이고 마스터 문서가 "DB 제품은 Table 하나로 성립한다"로 잘랐다. Board/Calendar 는 `group_by`·`configuration` 을 쓰므로 그 컬럼들이 먼저 살아난다 | 같은 곳 |
| **상대 날짜 연산자** | `past_week`·`this_week`·`today` 류가 카탈로그에 없다. **평가 시점 의존 노드**라 결과 캐시 키가 `(view_id, actor_id, 평가일)` 로 쪼개진다(불변식 VW1) — 캐시를 만들기 전에 넣으면 "어제 본 것과 다른 결과"를 설명할 수 없다. F-03-17 의 대안대로 `today ± N일` 로 단순화해 넣는다 | `db/migrations/0015_view.sql` 시딩 |
| **`me` 필터** | people 계열이 MVP 에 없어서 자리도 없다. 들어오면 필터 AST 에 **평가 컨텍스트 의존 노드**가 생기고, 그 순간 뷰 결과가 사용자마다 달라진다 | 같은 곳 |
| **행 단위 권한(`page_access_rule`)** | 없다. 그래서 `queryRows` 의 권한 게이트가 **data_source 단위**다 — 한 표의 행은 전부 같은 권한이다. 판결 X-8 이 "스코프 필터에 걸리지 않는 알려진 구멍"으로 남긴 것이고, 들어오면 권한을 행마다 평가해야 한다 | `src/lib/database/query.ts` 머리말 |
| **누적 페이지네이션 깊이 추적** | `queryRows` 가 `complete: true` 를 늘 돌려준다. F-03-17 은 누적 10,000건 상한과 `request_status: incomplete` 를 요구하는데, 한 페이지만 보고는 누적을 알 수 없어 호출자가 세야 한다 | 같은 곳 |
| **`row_position` (뷰별 수동 순서)** | 표가 없다. 행 드래그 재정렬이 그것인데 W8-b 의 F-ID 가 아니다. 정본 §3.6 에 정의가 있고, 트리 순서(`block.order_key`)와 **별개 축**이라는 경계 선언이 붙어 있다 | 정본 §3.6 |
| ~~행 복원 · 행 휴지통 목록~~ | **사실과 달랐다(#55).** 지운 행은 이미 페이지 휴지통에 나오고 `restorePage` 로 복원된다 — 테스트로 고정했다(§3.3-43). 휴지통 패널에서 행과 페이지가 구분되지 않는 것은 남는다 | `src/lib/database/row.db.test.ts` |
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
| 브라우저 검증의 빈자리 | `npm run e2e`(#31)가 208개 항목을 **실제 입력으로** 확인한다 — 핸들·드래그·선택·이동·접힘·`+`·자동 저장·복붙·이미지(업로드·드롭·붙여넣기)·오프라인 저장 큐·공유 패널·즐겨찾기·**검색 오버레이**(W7). **표(DB) · 필터 · 정렬 · 머리 메뉴도 있다(#56 · #57)** — 팝오버가 잘리지 않는지는 좌표로 본다. **익스포트는 브라우저가 실제로 ZIP 을 받고(`Browser.setDownloadBehavior`) python 으로 읽는다(#65)** — python 이 없으면 그 검사들이 실패한다. e2e 검사의 반사실은 돌리지 않았다(라이브러리 검사 8개만 돌렸다). **IME(한글 조합)·일반 타이핑은 아직 검사가 없다** — CDP 의 `Input.imeSetComposition` 으로 조합을 흉내낼 수 있다. 드롭·붙여넣기는 합성 `DragEvent`/`ClipboardEvent` 라 **OS 수준 드래그는 재현하지 않는다**(파일 선택은 `DOM.setFileInputFiles` 로 진짜다). 네트워크 실패는 `Network.setBlockedURLs` 로 **저장 라우트만** 막는다(전체를 끊으면 페이지 자체가 안 열려 새로고침 시나리오를 볼 수 없다). **CI 에는 아직 넣지 않았다** — 로컬에서 안정적으로 초록인지 먼저 쌓는다. 한 번 도는 데 1분 남짓이다 | `scripts/e2e-editor.mjs` |
| 테스트의 `assert.equal(run(...), null)` 패턴 | 기존 에디터 테스트 곳곳에 있다. **실패하는 날 CI 가 실패 대신 잡 타임아웃까지 매달린다**(§5). 지금은 전부 통과해서 드러나지 않는다. 새 테스트는 `assert.ok(x === null)` 로 쓴다 | `src/lib/editor/*.test.ts` |
| **select 정렬** | 컴파일러(`compileSorts`)가 select 를 `text_value`(**옵션 id**)로 정렬한다. 화면은 select 를 정렬 대상에서 뺐다(§3.3-53). F-04-10 의 옵션 정의 순서는 `select_option.order_idx` 조인이고, 커서 캐스트도 그 타입에 맞춰야 한다 | `src/lib/database/filter.ts` · `view-toolbar.tsx` `isSortable` |
| **행 페이지 열기** | 표에서 행을 여는 링크가 없다. `/w/{ws}/{rowId}` 는 열리지만 제목 저장을 `renamePage` 가 거부하고(행 제목은 셀이 정본) 이동 피커 · breadcrumb 이 행을 모른다. 반쯤 열리는 링크를 두지 않았다 | `src/app/w/[workspaceId]/[pageId]/` |
| **셀 쓰기 저장 큐** | 본문과 달리 IndexedDB 큐가 없다. 끊기면 칸이 되돌아가고 "저장되지 않았다"고 말한다 | `table-api.ts` · `database-table.tsx` |
| **필터 OR · 그룹 · 상대 날짜 · 개인 필터** | 패널은 평평한 AND 만 편집한다(§3.3-51). API 로 저장된 OR 필터는 지우기만 된다 | `filter-draft.ts` · `view-toolbar.tsx` |
| **옵션 이름 · 색 변경 · 삭제 / 속성 복원 화면 / 컬럼 폭 · 순서 드래그 · 고정 · 줄바꿈** | 없다. 옵션 soft delete 는 `select_option` 에 `deleted_at` 이 없어 정본부터 본다. 속성 복원은 서버(`restoreProperty`)만 있다 | `column-menu.tsx` · `property.ts` |
| **필터가 걸린 뷰에서 행 추가** | 조건을 미리 채우지 않는다 — 추가한 행이 새로고침 뒤 사라져 보일 수 있다. 행 추가 라우트를 뷰의 주소로 둔 것이 이것을 붙일 자리다 | `views/[viewId]/rows` POST |
| **e2e 환경 · 흔들림** | 이 PC 의 헤드리스 브라우저에서 클립보드 검사 2개가 실패한다(§6). **#69 에서 이미지 절이 매번 같은 자리에서 실패해 그 뒤 절이 하나도 돌지 않고 있던 것을 발견했다 — main 빌드로도 같았다.** 앞 절 `+` 의 `/` 블록이 저장 큐에 남은 채 스크립트가 서버 본문을 PUT 으로 덧붙이고 이동하면, 새 페이지의 `resume` 이 큐의 문서(이미지 없음)를 "서버보다 새것"으로 화면에 되살린다(`page-sync.ts`). 덧붙이기 전에 **서버에 닿았는가 → 큐가 비었는가** 순서로 기다리게 해 끝까지 돈다(206 / 208, #70). 큐만 보던 첫 수정(#69)은 한 번 통과하고 다음 실행에서 같은 자리가 다시 실패했다(§3.3-94). 서버 본문을 API 로 바꾸는 검사를 더할 때는 같은 순서로 기다린 뒤에 바꾼다 — 앱 쪽 동작은 설계대로다(끊겨도 친 글을 잃지 않는다). 검색 오버레이의 "입력이 본문에 새지 않았다"가 7번 중 2번 실패했다 — 원인 모름, 실패하면 달라진 글자를 남기게 했다. "앞 절 이미지가 비동기로 '불러올 수 없습니다'를 그린다"는 **확인하지 않은** 후보다 | `scripts/e2e-editor.mjs` |
| **클립보드 평문의 이미지 주소** | `plainTextForBlocks` 가 `properties.url` 을 읽는데 이미지는 #36 부터 `properties.source` 에 산다 — 이미지 블록을 복사하면 평문이 `![]()` 다. 익스포트 직렬화기(#59)는 `readImageSource` 를 쓴다. 평문 쪽을 직렬화기로 바꾸지는 않는다 — 평문은 이스케이프하지 않는 계약이다(`markdown.ts` 머리말) | `src/lib/editor/block-clipboard.ts` |
| ~~`withReadTransaction` 은 스냅샷을 보장하지 않는다~~ | **해결(#62).** `BEGIN READ ONLY` 는 READ COMMITTED 라 문장마다 새 스냅샷이었다. `tx.db.test.ts` 가 **먼저 재현했고**(두 문장 사이에 다른 커넥션이 커밋한 행이 두 번째 문장에 보였다) `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` 로 바꾼 뒤 통과한다. 익스포트 스냅샷이 이 위에서 읽는다(§3.3-72) | `src/lib/db/tx.ts` |
| **익스포트: 본문 글자에 건 링크는 상대 경로로 바꾸지 않는다** | F-09-14 *"내부 링크는 상대 경로로 재작성"* 중 **하위 페이지 참조 블록만** 했다(#61). 글자에 건 링크 마크가 앱 주소(`/w/{ws}/{id}` · 블록 링크)면 풀린 ZIP 에서 열리지 않는다. 절대 주소로 붙여 넣은 링크는 앱이 살아 있는 동안 웹 링크로 열린다. 붙이려면 Markdown 직렬화기의 `partsOf` 에 링크 주소 변환 훅을 흘려야 한다 | `src/lib/export/markdown.ts` · `plan.ts` |
| **익스포트: 같은 이미지를 여러 페이지가 가리키면 폴더마다 복사한다** | 페이지 폴더가 스스로 완결되게 했다(#61). 이미지 5MiB × 참조 수만큼 ZIP 이 커진다 — `estimateExport` 가 그만큼 센다 | `src/lib/export/plan.ts` `attachmentsOf` |
| **익스포트: 외부 이미지는 주소로만 남는다** | 내려받으면 SSRF 진입점이다(§3.3-71). 원본 사이트에서 이미지가 사라지면 백업에도 없다 | `src/lib/export/plan.ts` |
| **익스포트: 잡 · 만료 링크 · 완료 알림 · 속도 제한이 없다** | v1 은 동기 스트리밍이다(§2). F-09-14 의 워크스페이스 익스포트는 "최대 30시간 · 이메일 링크 7일"이다. 소유자가 반복해서 누르면 그만큼 스냅샷을 읽는다. `export_job` 표는 정본에 없으므로 잡으로 옮길 때 정본을 먼저 고친다. 상한은 블록 20만(`MAX_EXPORT_BLOCKS`) · ZIP 4GiB(ZIP64 없음) | `src/lib/export/download.ts` · `snapshot.ts` |
| **익스포트: 요약과 내려받기가 준비를 두 번 한다** | 스냅샷 읽기 · 조립을 요약에서 한 번, 링크에서 한 번(§3.3-77). 그 사이에 내용이 늘어 상한을 넘으면 요약은 통과했는데 내려받기는 422 다 — 브라우저 다운로드 목록에 "실패"로만 보인다 | `src/app/w/[workspaceId]/export-button.tsx` |
| **익스포트: `security_policy.allow_export` 게이트가 없다** | 정본 §3.3 의 0단계 deny 정책(노션 Enterprise 의 "Disable export")인데 표가 아직 없다. 들어오면 `prepareExport` 의 역할 게이트 **앞**에 둔다 | `src/lib/export/download.ts` |
| **익스포트: 감사 로그가 없다** | 마스터 문서가 "보안 10종"에 내보내기를 넣었지만 감사 표가 없다(마이그레이션 15개 중에 없다). 누가 워크스페이스 전체를 받았는지 남지 않는다 | 같은 곳 |
| **익스포트: HTML · PDF · "하위 페이지 포함" 끄기** | Markdown & CSV 만 있다(F-09-14: HTML P1 · PDF P2). 하위 페이지는 **항상 포함**이다 — F-09-14 가 끄는 쪽을 "가장 흔한 사고"로 적었다 | `export-button.tsx` |
| ~~y-prosemirror 변환의 연쇄 삭제~~ | **해결(#69 · §3.2-14).** 바인딩 · 서버 쓰기 경로는 변환에 `collabSchema`(내용을 검사하지 않는 파사드)를 넘기고, 구조 위반은 로그 저장소의 append 한 곳이 고친다. 아래는 원래 적었던 위험이다 — `ySyncPlugin` · `initProseMirrorDoc` 은 Y 요소를 `createChecked` 로 만들다 실패하면 **원본 Y.Doc 에서** 지우고 그 삭제가 모든 참여자에게 퍼진다. 동시 편집이 흔하게 만드는 구조 위반(타입 동시 변경 · 그룹 둘 · 빈 그룹) 하나가 컨테이너 → 루트 그룹을 지운다 = **본문 전체 삭제.** 서버 명령 경로 ② 가 `initProseMirrorDoc` + `updateYFragment` 로 쓰면 서버에서도 같다. 후보(아직 판결 아님): ⓐ 스키마 카디널리티를 풀어(`doc: blockGroup*` · `blockGroup: blockContainer*` · `blockContainer: blockContent* blockGroup*`) 변환이 던지지 않게 하고 `normalizeBody` 를 appendTransaction 으로 돌린다 — 명령들이 `+` 에 기대는 곳부터 찾아야 한다(§6 "`+` 는 0개가 되면 던진다") ⓑ 변환을 감싸 지우지 않게 한다 — 그 함수는 패키지 `exports` 밖이다. `ydoc.test.ts` ④ 는 이제 편집 스키마로는 지우고 `collabSchema` 로는 지우지 않음을 함께 고정한다 | `src/lib/collab/collab-schema.ts` · `repair.ts` |
| ~~멘션 · 수식에 건 서식이 Y.Doc 에 실리지 않는다~~ | **해결(#70 · §3.2-15).** 서식을 노드 attr `marks` 에 비춰 싣고 읽을 때 되살린다. 원래 적었던 것 — y-prosemirror 가 요소 노드를 옮길 때 attr 만 싣는다(`createTypeFromElementNode`). 글자의 서식은 남는다. 에디터 바인딩이 오는 순간 굵게 건 멘션이 저장되며 풀린다 | `src/lib/editor/atom-marks.ts` |
| **동시 순서 변경의 글자 겹침** | y-prosemirror 에 옮기기가 없어 순서 변경이 요소 고쳐 쓰기다. 둘이 동시에 순서를 바꾸면 blockId 가 겹치거나(정규화가 새 id 를 준다) 글자가 두 번 들어간다(되돌리지 않는다). 얼마나 자주 겹치는지는 재지 않았다 | `src/lib/collab/normalize.ts` |
| **모르는 노드 이름 — 스키마 버전 게이트** | 새 버전 클라이언트가 넣은 블록은 읽기 결과(= 프로젝션)에서 빠진다(원본 Y.Doc 에는 남는다). 옛 클라이언트의 바인딩은 `collabSchema` 로 그 요소를 받고 이웃 블록을 고쳐도 **남긴다**(#69 에서 확인 — 매핑 동일성으로 건너뛴다. 그 블록 자체를 옮기는 경우는 확인하지 않았다). 반대로 서버 수선은 매핑 없이 비교해 지우므로 모르는 것이 있으면 **고치지 않는다** — 그 페이지의 구조 위반이 남는다(§3.3-91). 협업 서버가 연결할 때 클라이언트의 스키마 버전을 확인해야 한다 | 같은 곳 · `src/lib/collab/repair.ts` |
| **수선과 동시에 옮긴 블록에 친 글자** | 옮기는 수선(그룹 합치기 · 자식 올리기)은 옮긴 블록을 새 요소로 만든다. 수선과 **동시에** 그 블록에 친 글자는 지워진 옛 요소에 들어가 사라진다 — 동시 순서 변경과 같은 한계. 위반이 생긴 append 가 곧바로 고치므로 창은 짧다 — 재지 않았다 | `src/lib/collab/repair.ts` |
| **수선 전까지 에디터 문서가 스키마를 어긴다** | 바인딩은 Y.Doc 을 그대로 비추므로 수선이 도착하기 전까지 한 블록에 내용 줄 둘 · 루트 그룹 둘 같은 문서를 들고 있다. 그 자리를 건드리는 스텝은 ProseMirror 가 거부한다(던진다). 편집 명령 · 플러그인은 이 모양을 전제하지 않았다 — `pm-blocks.ts` 는 첫 루트 그룹만 평탄화하고, 블록 선택 · 핸들 · 접힘은 보지 않았다. 6조각에서 본다 | `src/lib/collab/collab-schema.ts` · `src/lib/editor/pm-blocks.ts` |
| **파사드는 y-prosemirror 내부 구현에 기댄다** | 변환이 스키마의 `node` · `mark` · `text` 를 부른다는 것(1.3.7 · package-lock 고정). 올릴 때 `collab-schema.test.ts` ② 의 실제 바인딩 검사가 먼저 깨진다 | `src/lib/collab/collab-schema.ts` |
| ~~문서에서 빠진 살아 있는 하위 페이지 — 정본은 휴지통 전이, 지금은 거부~~ | **참여자 경로는 해결(#77 · §3.2-19).** 참여자 update 가 참조를 지우면 휴지통 명령과 같은 쓰기 · 권한으로 그 페이지를 버린다(버릴 권한이 없으면 `page_ref_forbidden`). 본문 저장(PUT) · 명령은 **의도적으로** 계속 거부한다 — 문서를 통째로 받아 "지웠다"와 "몰랐다"를 가를 수 없다 | `src/lib/block/save-page-body.ts` · `trash-rows.ts` |
| **참여자 경로의 깊이 초과는 아직 거부한다** | 참여자가 하위 페이지를 깊은 곳으로 옮겨 그 서브트리가 `MAX_TREE_DEPTH` 를 넘으면 투영이 `page_ref_too_deep` 로 거부하고 협업 서버가 연결을 닫는다. 참여자 로컬에는 옮긴 것이 남는다. 거부가 남으면 5d(투영 디바운스)를 할 수 없다(§3.3-98) — 되돌리는 수선 update 를 쓸지 · 행 자리를 유지할지 5d 전에 정한다 | `src/lib/block/save-page-body.ts` `relocateSubtree` 호출 |
| **투영이 쓰기와 같은 트랜잭션에서 동기로 돈다** | 정본은 "디바운스 실행 · 페이지당 단일 워커"(p95 < 2s)이고 `projected_seq` 를 둔다. 지금은 명령마다, 그리고 5a 부터 **참여자 update 마다** 페이지 행을 잠그고 본문 전체를 투영하며 `projected_seq` 를 쓰지 않는다 — 에디터가 붙으면 글자마다 이 비용이다(정본 리스크 22 "프로젝터 쓰기 증폭"). **5d** 의 몫. 잡 워커가 없다(마스터 문서: "스케줄러는 하나만") | `src/lib/block/body-write.ts` |
| **명령이 쓴 것은 다음 참여자 update 때까지 연결된 참여자에게 가지 않는다** | 협업 서버의 메모리 문서는 참여자 update 를 쌓은 뒤에만 로그 꼬리를 적용한다(5a). 다른 프로세스(Next 의 하위 페이지 생성 · 휴지통 · 이동 · 본문 저장)가 쌓은 것은 누군가 편집할 때 함께 온다 — 아무도 편집하지 않으면 다시 붙을 때까지 안 보인다. **5c** 에서 즉시 알린다(LISTEN/NOTIFY 후보) | `src/lib/collab/collab-server.ts` |
| **권한이 줄어도 서버가 먼저 끊지 않는다 · 읽기 전용 연결은 권한이 늘어도 그대로** | 5a 는 쓰기마다 세션 · 권한을 다시 본다 — 권한이 내려간 사람은 **다음 쓰기에서** 닫힌다. 그 전까지는 계속 받는다(볼 권한을 잃은 사람도 이후 편집을 받는다). 볼 수만 있던 연결은 권한이 올라가도 다시 붙기 전까지 읽기 전용이다. F-05-19 의 "권한 회수 시 서버 강제 unsubscribe"는 **5c** | 같은 곳 |
| **협업 서버는 한 대다** | 연결 · 메모리 문서가 프로세스 안에 있다. 두 대로 늘리면 서로의 연결에 퍼뜨리지 못한다(정본: Redis pub/sub 등 외부 브로커 필수). 로그가 정본이라 데이터는 잃지 않지만 다른 서버의 참여자는 다음 편집 때까지 못 본다 | 같은 곳 |
| **협업 서버는 Hocuspocus 내부 동작에 기댄다** | `beforeSync` 가 update 를 **적용하기 전에** 불려 끝나기를 기다린다는 것, 거기서 던지면 그 문서 연결만 닫힌다는 것(4.7.0 소스 · 진단). 올릴 때 `collab-server.db.test.ts` ④ · ⑦ 이 먼저 깨진다 | 같은 곳 · `package-lock.json` |
| **거부된 참여자의 로컬 문서** | 서버가 거부한 update 는 참여자 로컬에 남고 provider 는 그 문서에 다시 붙지 않는다. 로컬 문서를 버리고 다시 열어 알리는 것은 에디터 바인딩(6조각)의 일이다(§2 "6조각이 지켜야 할 것 — 5a") | `@hocuspocus/provider` |
| **하위 페이지 제목을 바꿔도 부모 본문의 참조 노드 title 은 그대로** | 참조 노드의 `title` attr 은 표시용이고 투영은 무시한다. 편집기는 행(`rowsToDoc`)에서 읽어 지금은 문제가 없다. 에디터가 Y.Doc 을 직접 비추는 6조각에서 낡은 제목이 보인다 | `src/lib/block/page-refs.ts` · `page.ts` `renamePage` |
| **잠금 순서 규칙에 병행 검사가 없다** | 명령은 본문 페이지 행 → 대상 · 옮길 행 → 스냅샷 순서로 잡고, 이동은 두 본문 페이지를 id 순으로 잡는다. 휴지통 · 이동 · 저장을 동시에 부르는 교착 검사는 쓰지 않았다 | `trash.ts` · `move-page.ts` |
| **Phase 0 편집기의 PUT 본문 저장은 Y.Doc 을 통째로 받은 문서로 맞춘다** | 참여자가 없는 지금은 괜찮다. 5조각의 협업 서버와 Phase 0 편집기가 같은 페이지를 동시에 쓰면, 낡은 문서를 PUT 한 쪽이 다른 쪽의 CRDT 편집을 되돌린다(`expectedVersion` 이 막는 것은 행 버전뿐이다). 6조각에서 편집기가 바인딩으로 바뀔 때까지 두 경로를 한 페이지에 섞지 않는다 | `src/lib/block/save-page-body.ts` |
| **수선마다 새 client id** | 수선은 사본(무작위 client id)에서 만든 update 라 수선 한 번마다 state vector 에 client 가 하나 는다. 드물어서 두었다. 고정 id 는 수선이 잠금 밖에서 한 번이라도 돌면 같은 id · clock 의 구조가 둘 생겨 문서가 깨지므로 쓰지 않았다 | `src/lib/collab/repair.ts` |
| **append 마다 본문 전체를 읽어 적용한다** | 검증(깨짐 · pending · 바뀐 부분)을 위해 스냅샷 + 합치지 않은 update(최대 `COMPACT_EVERY` = 100개)로 Y.Doc 을 만든다. 협업 서버가 초당 여러 번 저장하면 비용이 된다 — 협업 서버(5조각)는 메모리에 Y.Doc 을 들고 있으므로 그때 경로를 나눌 수 있다. 재지 않았다 | `src/lib/collab/doc-store.ts` |
| **Y.Doc 경로의 문서 전체 크기 상한이 없다** | update 한 개는 `MAX_BODY_BYTES`(1 MiB)로 막지만 쌓인 본문(스냅샷)의 크기는 보지 않는다. Phase 0 저장 경로의 본문 한도(F-12-16)에 해당하는 것이 아직 없다 | 같은 곳 |
| **압축이 잡이 아니라 append 안에서 돈다** | 정본은 "compaction 잡이 갱신"이라 적었지만 잡 워커가 없다. 합치지 않은 update 가 `COMPACT_EVERY` 에 닿는 append 가 스냅샷을 쓴다 — 그 append 만 느리다 | 같은 곳 |
| **`doc_update` · `doc_snapshot` 을 지우는 경로가 없다** | 정본은 purge 때 page_id 로 일괄 삭제한다(§3.4 전이표). purge 잡 자체가 없다(위의 purge 항목). 로그는 페이지가 휴지통에 가도 남는다 — 복원하면 그대로 이어진다 | 같은 곳 · `src/lib/block/trash.ts` |
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

사용자에게 하는 설명 · 도구 사이의 진행 보고 · PR 본문은 **전부 한글로** 쓴다
(커밋 prefix · 식별자 · F-ID · 라이브러리 이름은 영어 그대로).

Phase 0(MVP)이 닫혔다 — W1~W8 전부. Phase 1 의 첫 항목 익스포트(F-09-14) v1 도 닫혔다.

지금 동작하는 것: 로그인 → 워크스페이스 → 페이지 → 본문 편집(12종 블록) →
자동 저장 → 휴지통 → 블록 선택·이동·메뉴·복붙·이미지 → 오프라인 저장 큐 →
페이지 공유 → 즐겨찾기·최근 방문 → Cmd+K 검색
→ 풀페이지 데이터베이스(표 · 속성 6종 · 셀 편집 · 필터 · 정렬 · 속성 숨기기)
→ 내보내기(페이지 · 표 · 워크스페이스 전체 — Markdown & CSV ZIP · _export_report.json).

익스포트(src/lib/export/)는 v1 이 닫혔다 — 워크스페이스 전체는 소유자만이다(§3.2-13, 다시
판단하지 마라). 남은 것(잡 · 감사 로그 · security_policy 게이트 · HTML · PDF)은 §7.

지금은 CRDT 동시편집(마스터 문서 §5.2 의 2번 — 착수 순서는 고정이다)을 조각으로 나눠 진행 중이다(5조각은 5a~5d).
HANDOFF §2 의 CRDT 조각 표 · 순서 근거 · "N조각에서 확인한 것"을 먼저 읽어라.

끝난 것 — **본문의 정본이 행에서 Y.Doc 으로 넘어갔다**(4b). 본문 행은 Y.Doc 의 투영이고, 편집기는 아직 Phase 0 그대로(PUT 본문 저장)다:
  - 1조각(#66) src/lib/collab/ydoc.ts · normalize.ts — Y.Doc 본문 계약 · 동시 편집이 만든 구조 위반 정규화
  - 2조각(#67) src/lib/collab/doc-store.ts — doc_update 로그(append · 페이지 안 seq · 압축 · Phase 0 페이지 옮기기)
  - 3a조각(#69) src/lib/collab/collab-schema.ts · repair.ts — y-prosemirror 연쇄 삭제 막기(§3.2-14, 다시 판단하지 마라):
    변환에 넘기는 스키마 파사드 collabSchema · 루트 doc: blockGroup+ · 구조 위반 수선은 appendDocUpdate 한 곳
  - 3b조각(#70) src/lib/editor/atom-marks.ts — 멘션 · 수식 서식을 노드 attr marks 에 비춘다(§3.2-15, 다시 판단하지 마라)
  - 4a조각(#71) src/lib/collab/doc-store.ts(openBodyDoc) · body-edit.ts · block/save-page-body.ts(projectBodyRows) — 원시 연산
  - 4b조각(#73) src/lib/block/body-write.ts · page-refs.ts — 본문 저장 · 하위 페이지 생성 · 휴지통 · 복원 · 이동이 본문 Y.Doc 을
    거친다(§3.2-16, 다시 판단하지 마라). 명령 뒤 "행 = Y.Doc 의 투영"은 testing/body-invariant.ts 로 확인한다
  - 5a조각(#74) src/lib/collab/collab-server.ts · scripts/collab-server.mjs(npm run collab · 3001) — Hocuspocus 4.7.0 자체 호스팅.
    세션 쿠키 · Origin · 페이지 권한으로 받고, 참여자 update 는 메모리 문서에 적용하기 **전에**(beforeSync) 세션을 다시 해석해
    appendDocUpdate(block/body-write.ts 로 옮겨 투영까지)로 쌓고, 거부면 그 문서 연결을 닫는다. 메모리 문서는 로그 꼬리로 맞춰
    퍼뜨린다(§3.2-17, 다시 판단하지 마라). 에디터는 아직 붙지 않는다(6조각)
  - 5b조각(#77) src/lib/block/trash-rows.ts · save-page-body.ts(missingPageRefs) — 참여자가 본문에서 지운 살아 있는 하위 페이지를
    휴지통 명령과 같은 쓰기 · 권한으로 버린다(버릴 권한이 없으면 page_ref_forbidden). 본문 저장(PUT) · 명령은 계속 거부한다
    (§3.2-19, 다시 판단하지 마라). 그 전에 휴지통 · 이동의 페이지 권한(#75)과 목록 · breadcrumb 의 제목 누출(#76)을 막았다

다음 작업은 **5c조각 — 즉시 전파 · 권한 회수 시 끊기(F-05-19)**다.
  ① 5c: 다른 프로세스(Next 의 서버 명령 · 권한 변경)가 쓴 것을 연결된 참여자에게 곧바로 알린다. 지금은 명령이 쓴 것이 다음
     참여자 update 때까지 가지 않고, 권한이 줄어도 다음 쓰기에서야 닫힌다(§7). 후보: 쓰는 트랜잭션의 NOTIFY → 협업 서버가
     LISTEN 해 로그 꼬리를 적용(5a 의 catchUp 이 받는 쪽이다) · 권한 변경이면 그 페이지(와 서브트리)의 연결을 다시 판정해 닫거나
     읽기 전용으로. NOTIFY 가 커밋 뒤에만 전달되는지 · 페이로드 상한 · 연결이 끊겼을 때 무엇을 놓치는지는 진단으로 먼저 잰다
  ② 알아 둘 것 — 부모 본문의 하위 페이지 참조가 볼 수 없는 페이지의 제목을 싣는다(§7 맨 위). 참조 노드에서 제목을 빼는 설계가
     먼저다. 에디터 바인딩(6조각) 전에 정하고 5c 와 한 PR 에 섞지 마라
  ③ 그 뒤 5d(투영 디바운스 · projected_seq) — 그 전에 참여자 경로의 page_ref_too_deep 거부를 풀어야 한다(§7 · §3.3-98)
  ④ 착수 전에 읽을 것: 정본 §3.7 런타임 구독 레지스트리 · 05 F-05-19 · src/lib/collab/collab-server.ts 머리말 ·
     src/lib/permissions/acl.ts(권한이 바뀌는 곳 전부) · HANDOFF §2 의 5a · 5b 항목 · §3.2-17 · §3.2-19

지켜야 할 것:
  - 페이지를 바꾸는 명령은 **대상 페이지의 권한을 본다** — 워크스페이스 멤버인지만 보고 통과시키지 마라(#75 에서 휴지통 · 이동이
    그랬다). 볼 수 없으면 not_found, 볼 수만 있으면 forbidden, 대상 행을 잠근 뒤 무엇을 알려주기 전에(§3.2-18). 제목을 담는
    목록은 perm_scope_id = ANY(readableScopes · scopesWith) 로 거른다(§3.3-32). 권한 검사는 먼저 실패하는 검사로 재현한다
  - 본문 행(parent_type='block')을 직접 고치는 경로를 새로 만들지 마라. 본문을 바꾸는 명령은 block/body-write.ts 의
    openPageBody → (행 쓰기) → change → finish 를 거친다 — 행만 고치면 Y.Doc 과 어긋나고 다음 투영이 그 행을 지우거나
    거부한다. 검사에서 SQL 로 본문 행을 넣지 마라(같은 이유)
  - Y.Doc 은 readBodyYDoc 으로만 읽는다. y-prosemirror 변환(initProseMirrorDoc · ySyncPlugin)에는 반드시 collabSchema 를
    넘긴다 — blockSchema 를 넘기면 구조 위반을 만난 Y 요소를 지운다. 바인딩 상태는
    EditorState.create({ schema: collabSchema, plugins }) 로 만들고 doc 을 넘기지 않는다(넘기면 state.schema 가 blockSchema 다)
  - 구조 위반을 Y.Doc 에 고쳐 쓰는 곳은 appendDocUpdate 하나다. 에디터 · 협업 서버에 정규화 appendTransaction 을 두지 마라 —
    둘이 각자 고치면 옮긴 블록이 복제된다(repair.test.ts ②). 협업 서버도 수선을 따로 퍼뜨리지 않는다 — 쌓은 뒤 로그 꼬리를
    메모리 문서에 적용하는 것이 퍼뜨리기다(collab-server.ts)
  - 협업 서버에서 참여자 update 를 Hocuspocus 가 적용한 **뒤에** 쌓지 마라(onChange · onStoreDocument). 적용이 곧 퍼뜨리기라
    거부할 수 없게 된다. beforeSync 에서 appendDocUpdate 로 쌓고 거부면 던진다. 세션 · 권한은 update 마다 다시 본다(§3.2-17)
  - 참여자 경로도 투영 없이 쌓지 마라 — appendDocUpdate(block/body-write.ts)가 페이지 행 잠금 · 투영까지 한다. 협업 서버 검사는
    실제 WebSocket + @hocuspocus/provider 로 쓰고, "퍼지지 않았다"는 뒤에 보낸 것이 도착한 뒤에 본다(§3.3-99)
  - 로그는 appendDocUpdate 로만 쓴다. "바뀌었는가"를 state vector 로 판정하지 마라 —
    지우기만 하는 update 는 state vector 를 바꾸지 않는다(§3.3-85)
  - 동시 편집 검사는 src/lib/testing/collab-peers.ts(peer · edit · exchange · changesSince · bind)로
    에디터 없이 흉내 낸다. client id 를 고정하면 결정론이다. bind 는 실제 ySyncPlugin 을 헤드리스로 붙인다 —
    initProseMirrorDoc 만 보면 바인딩의 다른 경로(루트는 tr.replace 의 Fitter)를 놓친다(§3.3-92).
    구조 위반 장면 6개는 testing/collab-scenarios.ts

W8 이 남긴 빈자리(HANDOFF §2 · §7) — Phase 1 과 부딪히면 먼저 본다:
  - select 정렬(옵션 id 로 정렬된다 → 화면에서 뺐다) · 행 페이지 열기 ·
    DB 행 전역 검색 · 셀 쓰기 저장 큐

작업 순서:
  브랜치 → 구현+테스트 → npm run check → npm run db:verify:schema
  → (화면에 기대는 것이면) npm run build && npm run e2e
  → 커밋 → 푸시 → PR → CI 두 잡 통과 확인(db 잡의 skip 이 0인지도 본다)
  → squash 머지 → main 으로 돌아가 최신을 받는다

**작업이 끝나면 커밋 · 푸시 · PR · CI 확인 · 머지까지 반드시 완료한다.**
머지 허락을 따로 묻지 않는다(사용자가 정했다). "끝났다"고 말하기 전에
PR 이 머지됐고 git status 가 깨끗한지 확인한다.

PR 본문에는 "왜 이렇게 했는가"를 쓴다 — 정본과 다르게 한 것, 실패했다가
고친 것, 의도적으로 안 만든 것.

시간을 아끼려면 (전부 이전 세션에서 실제로 당한 것, 자세한 건 HANDOFF §6):
- 시작할 때 `npm run db:up` 을 한 번 돌린다. `npm test` 만 돌리면 DB 테스트가
  **조용히 빠진다**(카운트에도 안 잡힌다). 1595개가 다 돌아야 CI 의 db 잡과 같다.
  이 PC 에서는 외부 도구 검사가 셸에 따라 1~2개 skip 된다 — PowerShell 은 unzip(Git 의 unzip 은 Git Bash PATH 에만
  있다), Git Bash 는 bsdtar(Git 의 tar 는 GNU tar 다)를 못 찾는다. 정상이다(CI 는 설치하고 skip 0 이어야 한다)
- CI 결과는 **HEAD 커밋의 실행**을 찾아서 본다(`gh run list --json databaseId,headSha`
  → `gh run watch`). 막 푸시한 직후에는 새 실행이 아직 없을 수 있다. 로그의 합계는
  ASCII 패턴(` # tests N` · ` # skipped N`)으로 찾는다 — PowerShell 파이프가 `ℹ` 를 못 잡는다
- HTTP 로 API 를 확인할 때는 `npm run build && npm run start` 를 쓴다.
  next dev 는 새 라우트를 등록하지 않는 일이 있고, 그때 404 응답의
  content-type 이 text/html 이다(= 우리 404 가 아니라 Next 의 404)
- **새 API 라우트의 `RouteContext` 타입은 빌드가 생성한다.** 빌드 전에 typecheck 를
  돌리면 `does not satisfy the constraint 'AppRouteHandlerRoutes'` 로 실패한다 —
  순서 문제이고 코드 문제가 아니다. `npm run build` 한 번 뒤에 다시 본다
- **SQL 템플릿 리터럴 안의 주석에 백틱을 쓰지 마라.** W8 에서 세 번 당했다.
  문자열이 그 자리에서 끊기고, 증상은 SQL 오류가 아니라 엉뚱한 줄의
  `TS1005: ',' expected` 다
- 비-ASCII 가 섞인 긴 문자열 치환은 스크립트 대신 Edit 도구로 한다.
  백슬래시가 있으면 특히 그렇다 — `\n` 이 진짜 줄바꿈으로 바뀌어 앵커가 안 맞는다
- `npx prettier` 를 그냥 돌리지 마라. 설정이 없어 저장소 스타일
  (작은따옴표·세미콜론 없음)을 통째로 뭉갠다
- 머지 후 `git switch main` 하면 브랜치가 지워져 main 에 서 있다.
  다음 작업 전에 반드시 새 브랜치를 판다 — 두 번 main 에 커밋했다
- 스택 PR 을 쌓지 마라. `gh pr merge --delete-branch` 가 base 브랜치를 지우면
  그 위에 쌓인 PR 이 **자동으로 닫히고 되살릴 수 없다**(W7 에서 #46 을 잃었다).
  한 PR 을 머지하고 다음을 시작한다
- 편집기 DOM(view.dom 안)에 속성·클래스를 직접 달지 마라. ProseMirror 가 다시
  그리며 지우고 선택까지 새로 만든다 — 데코레이션으로 그린다(§6). 헤드리스
  테스트로는 안 보인다. npm run e2e 로 본다
- 테스트에서 assert.equal(EditorState, null) 을 쓰지 마라. 실패하면 멈춘다.
  assert.ok(x === null, '…') 로 쓴다(§5)
- **새 검사를 쓰면 반사실을 돌려라**(§5). 수정 전 코드(또는 수정의 일부를 뺀
  코드)에서 그 검사가 **정확히 그 항목만** 실패해야 회귀를 잡는 것이다.
  반사실이 통과하면 검사가 아니라 **주석을 고친다** — W7 에서 실제로 그랬다
  (§3.3-41: "stopPropagation 이 에디터를 지킨다"가 틀렸다)
- 반사실이 통과했는데 주장은 맞다면, 검사가 그 주장을 가려내지 못하는 것이다 —
  그때는 검사를 고친다. W8-b 에서 두 번 그랬다(§3.3-44 · §3.3-52)
- **e2e 는 이 PC 에서 Chrome 으로 돌린다**(E2E_BROWSER). Edge 153 헤드리스는
  진짜 Ctrl+C 에서 종료된다. 클립보드 검사 2개는 실패로 남는다(§6).
  익스포트 절은 받은 ZIP 을 python 으로 읽는다 — python 이 없으면 그 검사들이 실패한다
- PowerShell 5.1 에서 커밋 메시지 · PR 본문에 큰따옴표가 있으면 인자가 쪼개진다.
  git commit -F <파일> · gh pr create --body-file 을 쓴다
- 반사실은 **변형본을 src/lib/cf-<n>/ 에 복사해 병렬로** 돌리면 빠르다(상대 import
  깊이가 같아야 한다). 앵커를 전부 먼저 확인하고, 끝나면 폴더를 지운다.
  ⚠ `npm test` · `npm run check` 와 겹쳐 돌리지 마라 — cf 폴더가 테스트 목록에 섞인다
- Write · Edit 도구 인자에 역슬래시-u 네 자리 16진수 이스케이프를 적으면 **실제 문자로
  풀려** 저장된다(보이지 않는 BOM 이 소스에 박혔다, §6). 코드에서는 String.fromCharCode 로 만든다
- 산출물(Markdown · ZIP · CSV)은 우리가 짜지 않은 구현으로 읽어 본다(§3.3-60 · 63) —
  micromark 는 devDependency, python3 · bsdtar · unzip 은 CI 가 설치하고 CI 에서는 필수다
- gh pr merge 는 **다른 명령과 이어 붙이지 말고 단독으로** 실행한다. #59 에서 이어 붙인
  머지가 권한 분류기에 막혔고 그 뒤 단독 머지(#59~#63)는 통과했다 — 원인은 확인하지 못했다.
  막히면 우회하지 말고 사용자에게 알린다. 권한 규칙 파일(.claude/settings*.json)은
  에이전트가 쓰면 "자기 권한 수정"으로 막힌다 — 사용자가 /permissions 로 넣는다
- **라이브러리 동작을 기억으로 가정하지 마라.** CRDT 1조각에서 "y-prosemirror 변환은 검사하지 않는
  create 를 쓴다"고 가정하고 주석까지 썼다가 틀렸다(createChecked + 지우기, §3.3-82). 검사가 이상하게
  실패하면 추측하지 말고 저장소 안에 임시 진단 스크립트(`*.test.ts` 가 아닌 이름, 예: src/lib/collab/_debug.ts)
  를 만들어 실제 상태(Y XML 등)를 찍어 본다 — 끝나면 지운다
- **동시성 검사는 경쟁을 강제한다.** 그냥 Promise.all 로 부르면 먼저 커밋한 쪽을 나머지가 읽어 경쟁이
  일어나지 않는다 — 2조각에서 반사실이 통과해서 알았다. 표 잠금 + pg_locks 로 대기 확인 뒤 풀기(§3.3-88)
- DB 를 쓰는 반사실 변형은 **3개씩만** 동시에 돌린다 — 변형마다 커넥션 풀을 열어 Postgres 접속 한도(100)를 넘는다
- PowerShell 5.1: 네이티브 명령에 `2>&1` 을 붙이면 `$?` 가 거짓이 된다. `git push … 2>&1 | …; if ($?) { gh pr create … }`
  로 이어 붙였다가 PR 이 조용히 안 만들어졌다 — stderr 는 묶지 않는다(도구가 이미 받는다)
- PowerShell 5.1: `gh … --json … | ConvertFrom-Json | Where-Object {…}` 는 배열이 **한 덩어리로** 흘러 걸러지지
  않는다. `| ForEach-Object { $_ } | Where-Object {…}` 로 풀어서 거른다
- **판결 전에 후보를 진단 스크립트로 잰다.** 3a 에서 "여럿이 정규화해 되써넣으면 복제된다" · "루트 그룹 둘은 파사드로 못
  막는다" · "모르는 노드는 바인딩에서 남는다"를 전부 먼저 쟀고, 그 결과가 판결과 단언을 정했다. 기억으로 쓴 단언은 없다
- 실제 파일을 잠깐 바꾸는 반사실(스키마처럼 모두가 import 하는 파일)은 cf 폴더로 못 돌린다 — 백업을 scratchpad 에
  두고 바꾼 뒤 그 검사만 돌리고 되돌린 다음 `cmp` 로 복원을 확인한다. cf 폴더 반사실과 동시에 돌리지 않는다
- 제자리 반사실은 **스크립트 하나로** 돌린다(scratchpad 의 node 스크립트) — 변형마다 앵커가 정확히 한 번 나오는지 단언하고,
  해당 검사만 돌리고, 원래 바이트로 되돌린 뒤 같은지 확인한다(5a · #75 · #76 · 5b 에서 이렇게 했다). 백그라운드로 도는
  동안 그 파일을 import 하는 검사 · check · build 를 겹쳐 돌리지 마라 — 변형본을 읽는다. 끝나면 git status 로 확인한다
- **tsconfig 는 `*.test.ts` 를 타입 검사에서 뺀다.** `npm run typecheck` 가 통과해도 검사 파일의 import 오류 · 중복 선언은
  실행해야 드러난다 — 5a 에서 옮긴 함수의 옛 import 가 남아 "이미 선언됨"으로 파일째 죽었다. 검사 파일을 고치면 그 파일을 직접 돌린다
- 협업 서버 검사 로그에 `closing connection … because of exception` 과 스택이 찍히는 것은 **정상이다** — 거부를 던지면
  Hocuspocus 가 그렇게 남긴다. 실패 여부는 합계로 본다
- `npm run collab` 을 눈으로 확인할 때는 `node scripts/collab-server.mjs` 를 직접 띄워 `http://localhost:3001` 이
  "Welcome to Hocuspocus!" 를 주는지 보고 그 프로세스를 끈다(npm 을 거치지 않으면 끌 프로세스가 하나다)
- check · verify · build · e2e 를 한 줄로 이어 백그라운드로 돌리면 **e2e 의 종료 코드 1 은 클립보드 검사 2개 때문**이다 —
  로그 끝의 `206 / 208` 과 실패한 두 항목의 이름을 보고 판단한다
```

---

## 9. 이 문서를 갱신하는 규칙

- **§1 의 숫자**(마이그레이션 · 테이블 · 테스트 · e2e · PR)는 구간이 끝날 때마다 맞춘다.
  틀린 숫자는 "테스트가 몇 개 빠졌는지" 판단을 망친다.
- **§3 에는 "왜"만 쓴다.** 무엇을 했는지는 커밋과 PR 본문에 있다. 여기 있어야 하는 것은
  *다음 세션이 같은 것을 다시 판단하지 않게 하는 근거*다.
- **§7(부채)에서 해결된 항목은 지우지 말고 `~~취소선~~` + "해결(#NN)" 로 남긴다.**
  "왜 없는가"를 찾던 사람이 "있다"를 발견하는 경로가 된다.
- **반사실이 통과해서 주석을 고친 일**은 반드시 §3 에 남긴다. 그것이 이 저장소에서
  가장 비싼 교훈이었다 — 증명하지 못한 것을 증명한 것처럼 적은 흔적이기 때문이다.
