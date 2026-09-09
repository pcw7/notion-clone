# 인수인계

새 세션이 이어받을 때 읽는 문서. **[CLAUDE.md](../CLAUDE.md)를 먼저 읽고 여기로 온다** — 거기에 절대 제약·스택·명령어·코딩 규칙이 있고, 이 문서는 **"지금 어디까지 왔고 다음에 뭘 하는가"**만 다룬다.

최종 갱신: 2026-09-09 (PR #10 머지 시점)

---

## 1. 지금 어디까지 왔나

**Phase 0 (MVP, 6~8주) 중 W1–W3 완료. 다음은 W4.**

| 주차 | 내용 | 상태 | PR |
|---|---|---|---|
| W1 | 스키마 · 인증 | ✅ | #3 #6 #7 #8 |
| W2 | 계약 고정 (권한) | ✅ | #4 |
| W2 | 계약 고정 (API — RichText · 페이지네이션) | ✅ | #10 |
| W3 | 블록 모델 | ✅ | #9 #10 |
| **W4** | **에디터 코어** | **다음** | — |
| W5 | 페이지 트리 · 편집 확장 | | |
| W6 | 내비게이션 · 권한 | | |
| W7 | 검색 | | |
| W8 | DB 코어 · 뷰 | | |

**동작하는 것**: 이메일 OTP 로그인 → 워크스페이스 생성 → 이메일 초대 → 수락 → 워크스페이스 진입.
`npm run dev` 로 실제로 눌러볼 수 있다.

**숫자**: 마이그레이션 7개 / 테이블 24개 / 테스트 155개(CI skip 0) / PR 10개 머지.

---

## 2. 다음 작업 — W4 에디터 코어

> 마스터 문서: **"W3-W4가 프로젝트 전체의 기술 리스크 정점"**
> 난제 TOP 7의 4위: "캐럿·블록 분할/병합·IME — **프로젝트 최대 버그 밀도 구간**.
> DOM selection ↔ 모델 오프셋 매핑, span 분할/정규화, **자식 귀속 규칙(자식이 사라지는 것이 최빈 버그)**, 한글 IME"

F-ID: `F-01-19` `F-01-03` `F-01-06` `F-01-04` `F-01-05` `F-12-01`

**착수 전에 반드시 읽을 것**
- `docs/research/01-block-editor.md` — F-01-19(캐럿·분할·병합), F-01-04(슬래시 메뉴), F-01-05(마크다운 입력)
- `node_modules/next/dist/docs/` — Next.js 16은 API가 다르다(AGENTS.md 경고)

**권장 순서**
1. 페이지 생성·조회 (`block` type='page') + 라우팅 `/w/{workspaceId}/{pageId}`
2. Tiptap 골격 + 12종 블록 스키마 (`src/lib/block/types.ts` 레지스트리를 그대로 쓴다)
3. 분할·병합·Tab 중첩 · `/` 메뉴 · 마크다운 입력 규칙
4. 저장 — **Phase 0은 페이지 단위 LWW**. CRDT는 Phase 1이다 (§5.1이 명시적으로 자름)

**이미 준비된 것 (다시 만들지 말 것)**
- `src/lib/block/order-key.ts` — fractional index. `orderKeyBetween(before, after)`
- `src/lib/block/types.ts` — 12종 + `unsupported` 폴백 + `normalizeFormat`
- `src/lib/contracts/rich-text.ts` — RichText[] 검증 + ProseMirror 플래튼/병합 어댑터
- `db/migrations/0007_doc_sync.sql` — `doc_update`/`doc_snapshot`/`page_version` (코드는 Phase 1)

---

## 3. 이 프로젝트에서 내린 판결 (정본을 고친 것)

정본 문서와 코드가 다르면 **정본이 이긴다**(CLAUDE.md 절대 제약 3). 다만 정본 자체를 고친 적이 세 번 있고, 전부 문서에 `[정정]`으로 근거를 남겼다. 새 세션이 "왜 정본과 다르지?"라고 헷갈리지 않도록 여기 모아둔다.

| # | 무엇 | 왜 |
|---|---|---|
| 1 | **F-14-02 → 존재하지 않는 이메일에도 코드를 보낸다** (`14-auth-accounts.md` F-14-02 `[정정]`) | 원안("메일 안 보냄")대로면 **신규 가입이 영원히 불가능**하다. F-14-01 시나리오 2가 이긴다. 계정 열거는 응답·문구·시간을 동일하게 유지해 막는다 |
| 2 | **`workspace_invite.token` → `token_hash`** (`00-canonical-data-model.md` §3.2 `[정정]`) | 초대 토큰은 세션 토큰과 같은 bearer 자격증명인데 이 표만 평문이었다. 같은 문서의 `user_session.token_hash`와 어긋난다. 해시는 단방향이라 **데이터가 쌓이기 전에** 고쳐야 했다 |
| 3 | **`fractional-indexing` 역순 입력 가드** (코드에만, 정본 변경 없음) | `generateKeyBetween('a1','a0')`이 예외 없이 `'a0V'`를 반환한다. 두 경계 어느 쪽 사이도 아닌 값이라 정렬이 조용히 깨진다. 우리 계층에서 `RangeError` |

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

---

## 5. 테스트 철학 (이 저장소의 규칙)

- **"생겼다"가 아니라 "실제로 막는가"를 본다.** `CHECK`을 걸어놓고 동작을 확인하지 않으면 걸지 않은 것과 같다. `scripts/verify-schema.mjs`는 위반 INSERT를 실제로 던져본다.
- **부정 요구사항도 테스트한다.** 정본의 "이 컬럼은 존재하지 않는다"(B6·B8·B9·B10)를 `information_schema` 조회로 확인한다. 코드 리뷰로만 막기 어렵다.
- **실패 경로를 성공 경로보다 많이 쓴다.** 특히 인증·초대처럼 "링크를 가진 아무나 들어오는 것"이 위험한 곳.
- **DB 테스트는 `REQUIRE_DB=1`로 CI에서 강제한다.** 조용히 skip되면 그 테스트는 썩는다.
- 마이그레이션을 추가하면 `scripts/verify-schema.mjs`의 `EXPECTED_TABLES`도 갱신한다. 빠뜨리면 그 테이블은 누가 지워도 통과한다(실제로 `level_capability`가 그랬다).

---

## 6. 세션 운영 요령 (실제로 겪은 것)

**WSL2가 유휴 상태에서 VM을 내린다.** 그러면 Postgres·Valkey도 같이 멈춘다.
- 증상: `ECONNREFUSED 127.0.0.1:5432`
- 대응: `npm run db:up` 한 번. healthy까지 기다려준다
- `.wslconfig`의 `vmIdleTimeout=-1`은 **WSL 2.7.13에서 동작하지 않는 것을 확인**했다(양쪽 섹션 다 시도, 90초 유휴 후에도 내려감). 넣지 마라
- 명령 여러 개를 이어 쓸 때는 `npm run db:up >/dev/null 2>&1` 를 앞에 붙여두면 중간에 죽지 않는다

**`.env` 로드**: 스크립트는 자체적으로 `.env`를 읽지만, 셸에서 직접 `node --test`를 돌릴 땐 `set -a; source .env; set +a` 가 필요하다.

**dev 서버는 끝나면 반드시 끈다.** 백그라운드로 남으면 계속 메모리를 먹는다.
```bash
node -e 'const{execSync}=require("child_process");
  const out=execSync("powershell -NoProfile -Command \"Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess\"",{encoding:"utf8"});
  for(const pid of out.split(/\s+/).filter(Boolean)) try{process.kill(Number(pid))}catch(e){}'
```

**긴 문자열 치환에 `node -e '...'` + `String.replace`를 쓰면 조용히 실패한다.** 실제로 두 번 당했고, 그중 하나는 **가입이 전부 거부되는 버그**로 이어졌다(`consumed.user_id` 검사). 파일 수정은 Edit 도구를 쓰고, 치환했다면 `grep`으로 반영을 확인한다.

---

## 7. 알려진 부채 · 미완

| 항목 | 상태 | 어디 |
|---|---|---|
| 좌석 한도 강제 | 자리만 있고 막지 않음. `plan_entitlement` 마이그레이션 후 연결 | `src/lib/workspace/invite.ts` `checkSeatAvailable` `TODO(F-13-18)` |
| 실제 메일 발송 | 개발용 콘솔 출력만. 운영에서 `MAIL_TRANSPORT` 미지정이면 기동 실패하도록 해둠 | `src/lib/auth/mailer.ts`, `src/lib/workspace/invite-mailer.ts` |
| `x-forwarded-for` 신뢰 | 기본값 0(신뢰 안 함). 배포 시 `TRUSTED_PROXY_HOP_COUNT` 설정 필요 | `src/lib/auth/request-meta.ts` |
| 도메인 문서 소급 수정 | 01~17 문서에 폐기된 스키마가 남아 있음(마스터 문서 부록 A) | 정본 `00-*`이 항상 이긴다 |
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
- HANDOFF §2 다음 작업, §6 세션 운영 요령

Phase 0 W1~W3 이 끝났고 다음은 W4 에디터 코어다.
마스터 문서가 "프로젝트 전체의 기술 리스크 정점"이라고 표시한 구간이니,
docs/research/01-block-editor.md 의 F-01-19 를 반드시 먼저 읽고 시작해라.

작업은 브랜치 → 구현+테스트 → npm run check → PR → CI 확인 → 머지 순서로 한다.
```
