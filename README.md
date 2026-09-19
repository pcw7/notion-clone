# notion-clone

[![CI](https://github.com/pcw7/notion-clone/actions/workflows/ci.yml/badge.svg)](https://github.com/pcw7/notion-clone/actions/workflows/ci.yml)

노션과 같은 기능을 하는 웹 애플리케이션. **TypeScript + Next.js**로 만듭니다.

> 코드보다 기획이 먼저 끝났습니다. 기능 **278개**를 조사·명세하고, 문서 간 모순 **26건**을 판결해 스키마 정본을 확정한 뒤, **MVP 65개 / 6~8주**로 잘라낸 상태에서 시작했습니다.

---

## 지금 되는 것

`npm run dev` 로 띄우면 실제로 눌러볼 수 있습니다.

- **계정** — 이메일 OTP 로그인 · 워크스페이스 만들기 · 이메일 초대와 수락
- **에디터** — 블록 12종(문단 · 제목 3단 · 글머리표 · 번호 · 할 일 · 토글 · 인용 · 콜아웃 · 구분선 · 이미지), `/` 메뉴 · 마크다운 단축키 · 서식, Enter 분할 · Backspace 병합 · Tab 중첩
- **블록 다루기** — 여러 블록 선택 · 드래그 이동 · 키보드 이동 · 블록 메뉴 · 구조를 보존하는 복사/붙여넣기 · 이미지 올리기(드롭 · 붙여넣기)
- **실시간 협업** — 같은 페이지를 연 사람들의 편집이 서로에게 즉시 보이고, 같은 문단을 함께 쳐도 지워지지 않음(CRDT). 되돌리기는 내가 친 것만. 권한이 사라지면 서버가 먼저 끊고 화면이 이유를 말함
- **저장** — 저장 버튼이 없음. 끊겨도 친 글은 IndexedDB 에 남았다가 연결이 돌아오면 서버가 받고, **서버가 받았다고 답한 뒤에만** 지움. 서버가 받지 못한 편집은 내용을 보여 줌
- **페이지 트리** — 무한 중첩 · 사이드바 · breadcrumb · 이동 · 휴지통(복원 · 영구 삭제)
- **공유** — 페이지 단위 권한, 상속과 "따로 관리하기", 즐겨찾기 · 최근 방문
- **검색** — `Cmd+K`. 한국어가 조사를 넘어 찾히고(`검색` → `검색이`), **볼 수 없는 페이지는 결과에 없음**(권한이 쿼리 안에)
- **데이터베이스** — 풀페이지 표, 속성 6종(제목 · 글 · 숫자 · 선택 · 체크박스 · 날짜), 셀 편집 · 키보드 이동, 필터 · 정렬 · 속성 숨기기, "더 보기" 50행
- **내보내기** — 페이지 · 데이터베이스 · 워크스페이스 전체(소유자)를 Markdown & CSV ZIP 으로. 누르면 무엇이 몇 개 들어가는지 먼저 보여주고, 하위 페이지 · 이미지까지 담으며, **볼 수 없는 페이지는 빠지고 빠진 것과 옮기지 못한 것은 ZIP 안 `_export_report.json` 에 적힘**

---

## 진행 상황

**Phase 0 (MVP) 완료** — W1~W8 전부.

| 주차 | 내용 | 상태 |
|---|---|---|
| W1 | 스키마 · 인증 | ✅ |
| W2 | 계약 고정 — 권한 capability · `SessionContext` · RichText · 페이지네이션 | ✅ |
| W3–4 | 블록 모델 · 에디터 코어(ProseMirror) | ✅ |
| W5 | 페이지 트리 · 편집 확장 · 파일 · 오프라인 저장 큐 | ✅ |
| W6 | 권한 · 내비게이션 | ✅ |
| W7 | 검색(tsvector + pg_bigm) | ✅ |
| W8 | 데이터베이스 코어 · 표 뷰 | ✅ |

**Phase 1 진행 중** — 첫 항목 **Markdown & CSV 익스포트**(F-09-14)가 끝났습니다. 데이터를 꺼낼 수 없으면 신뢰할 수 없어서 가장 먼저 했습니다.

| 조각 | 내용 | 상태 |
|---|---|---|
| 1 | 페이지 본문 → Markdown | ✅ |
| 2a | ZIP 쓰기(의존성 없음) · CSV | ✅ |
| 2b | 파일 이름 · 조립 · ZIP 스트림 · `_export_report.json` | ✅ |
| 3a | 권한을 반영한 스냅샷 읽기 | ✅ |
| 3b | 내려받기 라우트 · 요약 · 페이지 · 표 · 워크스페이스 버튼 | ✅ |

그다음 **CRDT 동시편집**(F-05-01)을 했습니다. 두 사람이 같은 문단을 동시에 쳐도 글자가 사라지지 않게 하는 일이고, 되돌리기 비싼 순서로 조각을 나눴습니다.

| 조각 | 내용 | 상태 |
|---|---|---|
| 1 | Y.Doc 본문 계약 — 문서 ↔ Y.Doc · 동시 편집이 만든 구조 위반을 결정론적으로 고치는 정규화 | ✅ |
| 2 | 편집 로그 저장소(`doc_update`) — 페이지 안 seq · 압축 · 기존 페이지 옮기기 | ✅ |
| 3 | 에디터를 붙이기 전의 전제 — 변환이 일으키는 연쇄 삭제 막기 · 멘션과 수식의 서식 싣기 | ✅ |
| 4 | **본문의 정본을 행에서 Y.Doc 으로 넘기기** — 저장 · 하위 페이지 생성 · 휴지통 · 복원 · 이동이 전부 Y.Doc 을 거치고, 표의 행은 그 결과의 투영이 된다 | ✅ |
| 5 | **협업 서버**(Hocuspocus 자체 호스팅) — 편집마다 권한을 다시 보고, 로그에 쌓은 것만 퍼뜨리고, 권한이 줄면 서버가 먼저 끊는다. 행 투영은 1초 창에서 한 번 | ✅ |
| 6a–6c | 협업 편집기 상태 조립 · 하위 페이지 자리와 제목 맵 · 브라우저 쪽 연결(닫힌 이유별 처리 · 확인받지 못한 편집 보존) | ✅ |
| 6d | **화면 넘기기** — 본문 편집기가 협업 서버 위에서 돈다. 저장 큐를 걷어내고 IndexedDB 보존본으로 | ✅ |
| 6e | 본문 저장 API 걷어내기 — 본문을 쓰는 길은 협업 서버 하나다 | ✅ |

**CRDT 동시편집이 닫혔습니다.** 두 사람이 같은 페이지를 열면 서로의 편집이 실시간으로 보이고, 끊겨도 친 글을 잃지 않습니다.

지금은 **코멘트 · 멘션 · 알림 · 인박스**입니다. 넷이 한 묶음입니다 — 코멘트를 달고 `@`로 사람을 부르면 인박스로 도착하는 데까지가 한 기능이기 때문입니다.

| 조각 | 내용 | 상태 |
|---|---|---|
| 1 | 스레드 · 코멘트 · 반응의 서버 명령 — **코멘트의 자리는 Y.Doc 이 정합니다.** 방금 친 문단에도 달리고, 남이 그 문단을 지워도 스레드는 남습니다 | ✅ |
| 2 | 범위 앵커 — **글자 구간에 단 코멘트가 동시 편집을 견딥니다.** 앞에 글자를 쳐도 같은 곳을 가리키고, 그 글자를 다 지우면 스레드는 남되 "원본 없음"이 됩니다 | ✅ |
| 3 | 알림 · 인박스 — 활동 이벤트 하나에서 받을 사람을 고르고, **보낼 때 권한을 다시 봅니다** | ⬜ |
| 4 | 화면 — 코멘트 사이드바 · 인박스 | ⬜ |
| 5 | 멘션 — `@` 자동완성 · 역인덱스 · 멘션 알림 | ⬜ |

**숫자** — 마이그레이션 19개 · 테이블 42개 · 테스트 1,660개(DB 포함, CI 에서 skip 0) + 실제 브라우저 검증 216개 · PR 91개 머지.

---

## 이 저장소에서 특이한 것

**ORM을 쓰지 않습니다.** 정본 스키마가 부분 인덱스 · `GIN on uuid[]` · 생성 컬럼 · **DEFERRABLE 순환 FK**를 씁니다. 스키마를 소유하려는 ORM은 이것들을 표현하지 못하거나 매번 싸웁니다. 스키마는 SQL로 쓰고 애플리케이션은 읽기만 합니다. 마이그레이션 러너([`scripts/migrate.mjs`](scripts/migrate.mjs))도 외부 의존성 없이 직접 만들었고, **적용된 파일이 수정되면 체크섬으로 실행을 거부**합니다.

**에디터는 ProseMirror를 직접 씁니다.** Tiptap의 확장 레이어는 스키마를 소유하는데, 이 저장소의 스키마는 **블록 타입 레지스트리에서 생성**되어야 합니다. 두 생성기가 겹치면 "레지스트리에 넣었는데 에디터에는 없는" 상태가 가능해집니다. 그래서 `@tiptap/pm`(ProseMirror 묶음) 하나만 씁니다 — 문서 모델 · 트랜잭션 · 입력 규칙 · 키맵은 전부 ProseMirror 것이고, 에디터를 처음부터 만들지는 않았습니다.

**권한 레벨은 전순서가 아닙니다.** `create`는 `view`를 포함하지 않습니다 — 폼 제출처럼 "내용은 못 보면서 추가만" 하는 경우가 있기 때문입니다. 레벨을 정수로 매겨 `MAX`를 취하면 권한이 틀어지므로, [`levels.ts`](src/lib/permissions/levels.ts)는 **레벨 비교 함수를 의도적으로 제공하지 않습니다.** 판정의 진실은 capability 비트마스크이고, 물을 수 있는 건 `can(caps, 'edit_content')` 하나뿐입니다.

**`SessionContext`를 갖고 있다는 것 자체가 권한의 증명입니다.** 브랜디드 타입이라 리터럴로 만들 수 없고 `resolveSessionContext()`만 발급하는데, 그 함수가 발급 전에 워크스페이스 진입 게이트를 통과시킵니다. 그래서 `userId`만 받는 권한 함수를 만드는 실수를 저지를 수 없습니다.

**볼 수 없는 것은 목록 쿼리 밖으로 나오지 않습니다.** 사이드바 · 휴지통 · 검색 · 익스포트가 노드마다 권한을 판정하지 않고 `WHERE perm_scope_id = ANY(읽을 수 있는 스코프)`로 거릅니다. 25건을 뽑아서 거르는 경로가 없어서, 거르기를 빠뜨려 제목이 새는 일이 구조적으로 생기지 않습니다.

**본문의 정본은 Y.Doc 이고, 표의 행은 그 투영입니다.** 동시 편집이 들어오면 "행을 고치는 경로"와 "문서를 고치는 경로"가 둘로 갈라져 서로를 덮어씁니다. 그래서 본문을 바꾸는 **모든** 경로(저장 · 하위 페이지 생성 · 휴지통 · 복원 · 이동)가 Y.Doc 을 먼저 거치고, `block` 행은 그 결과를 투영해 만듭니다. 반쯤 넘기지 않으려고 다섯 경로를 한 번에 옮겼습니다. 투영은 1초 창에서 한 번만 돌아 글자 한 자마다 표를 다시 쓰지 않습니다.

**끊긴 채 친 글은 "서버가 받았다"는 답을 받은 뒤에 지웁니다.** 협업 라이브러리가 세는 "아직 확인되지 않은 편집 수"로 정하면 안 됩니다 — 다시 연결될 때 그 수가 초기화되고, 끊긴 동안 쌓여 있던 편집이 먼저 나가 그 확인이 먼저 도착하기 때문입니다. 수가 0이 된 순간에도 뒤의 편집은 서버에서 처리 중일 수 있습니다. 그래서 세지 않고 물어봅니다 — 확인 요청을 보내고 답이 오면, 서버는 한 연결의 메시지를 받은 차례대로 처리하므로 그 앞의 편집은 전부 로그에 들어가 있습니다.

**검증은 "생겼는가"가 아니라 "실제로 막는가"를 봅니다.** `CHECK`을 걸어놓고 동작을 확인하지 않으면 걸지 않은 것과 같습니다. [`verify-schema.mjs`](scripts/verify-schema.mjs)는 위반 INSERT를 실제로 던져보고 거부되는지 확인합니다.

**새 검사는 반사실로 검사합니다.** 방어 코드를 하나씩 빼고 돌려서 **그 검사가 실패하는지** 확인합니다. 빼도 통과하면 둘 중 하나입니다 — 주장이 틀렸으면 코드와 주석을 고치고, 주장이 맞으면 검사가 그것을 가려내지 못하는 것이니 검사를 고칩니다. 두 경우 모두 [인수인계 문서](docs/HANDOFF.md)에 남깁니다.

**헤드리스 테스트가 못 보는 것은 실제 브라우저로 봅니다.** ProseMirror는 DOM 없이 돌아 커맨드 · 입력 규칙이 `node --test`로 검증되지만, 브라우저에서만 드러나는 버그 넷이 그 테스트를 전부 통과한 채 들어가 있었습니다. [`e2e-editor.mjs`](scripts/e2e-editor.mjs)가 Chrome DevTools Protocol로 실제 입력을 넣어 216개 항목을 확인합니다 — **앱과 협업 서버를 함께 띄우고, 탭 두 개로 동시 편집까지** 봅니다.

**산출물은 우리가 짜지 않은 구현으로 읽어 봅니다.** 익스포트 Markdown은 micromark(CommonMark 기준 구현)로 렌더하고, ZIP · CSV는 python `zipfile` · `csv`와 bsdtar로 풉니다. 직접 짠 읽기 코드는 쓰기와 같은 오해를 공유할 수 있어서입니다 — 실제로 `**"인용"**입니다`의 굵게가 CommonMark에서 풀린다는 것, bsdtar(Windows)가 이모지가 든 파일 이름을 풀지 못한다는 것을 이렇게 찾았습니다.

**무료 라이브러리만 씁니다.** [`check-licenses.mjs`](scripts/check-licenses.mjs)가 CI에서 AGPL · SSPL · RSAL · BUSL · GPL · LGPL · 라이선스 미상을 거부합니다. 검사기 자체도 **외부 의존성 0개** — 라이선스 검사기를 넣자고 라이선스 불분명한 패키지를 하나 더 다는 건 자기모순이라서요.

---

## 구조

```
docs/                          기획 · 인수인계
  notion-feature-research.md     마스터 의사결정 문서
  HANDOFF.md                     진행 위치 · 다음 작업 · 내린 판결 · 세션 운영 요령
  research/
    00-canonical-data-model.md   스키마 정본 (테이블 73개)
    00-feature-ownership.md      F-ID 인벤토리 · MVP 목록
    01~17-*.md                   도메인 상세
    _canon/ _critique/           판결문 · 커버리지 비평

db/migrations/                 raw SQL 17개. ORM 없음
  0001–0005                      워크스페이스 · 계정 · 멤버십 · capability 매트릭스 · 초대
  0006–0008                      블록 트리 · 문서 동기화 자리 · order_key collation
  0009–0012                      파일 · ACL · 즐겨찾기/최근 방문 · 검색 색인
  0013–0015                      데이터베이스 3계층 · 행 캐시 · 뷰
  0016–0017                      협업 커밋 신호(NOTIFY 트리거) · 투영 지점(projected_seq)

src/app/                       화면 · API 라우트 (Next.js App Router)
  login/  invite/[token]/        로그인 · 초대 수락
  w/[workspaceId]/               사이드바 · 검색 오버레이
    [pageId]/                    페이지 편집기
    db/[databaseId]/             데이터베이스 표
  api/                           워크스페이스 스코프 API (본문 쓰기는 없다 — 협업 서버로 간다)

src/lib/
  auth/  workspace/              로그인 코드 · 세션 · SessionContext · 초대
  block/                         블록 트리 · 페이지 · 이동 · 휴지통 · 본문 프로젝터
  editor/                        ProseMirror 스키마 · 커맨드 · 입력 규칙 · 블록 선택 · 복붙
  contracts/                     RichText · 페이지네이션 계약
  permissions/                   capability · effective() · ACL
  nav/  search/                  최근 방문 · 즐겨찾기 · 검색 색인과 질의
  database/                      프로퍼티 · 셀 · 필터 컴파일러 · 뷰
  file/  sync/                   업로드 · 스토리지 드라이버 · 오프라인 저장 큐
  export/                        Markdown · CSV · ZIP · 조립 · 스냅샷 (Phase 1)
  collab/                        Y.Doc 본문 계약 · 정규화 · 편집 로그 · 협업 서버 · 브라우저 연결 (Phase 1)
  db/  testing/                  커넥션 풀 · 트랜잭션 · DB 픽스처 · 외부 도구

scripts/                       전부 의존성 없는 .mjs
  migrate.mjs                    마이그레이션 러너
  verify-db.mjs                  확장 · collation · 한국어 2-gram
  verify-schema.mjs              스키마 + 불변식이 실제로 거부하는지
  e2e-editor.mjs                 실제 브라우저 검증 (CDP)
  collab-server.mjs              협업 서버 프로세스 (Hocuspocus · 포트 3001)
  check-licenses.mjs             라이선스 정책 강제
  dc.mjs                         docker compose 래퍼 (Windows→WSL)
```

---

## 문서

| 문서 | 내용 |
|---|---|
| [**인수인계**](docs/HANDOFF.md) | 진행 위치 · 다음 작업 · 이미 내린 판결과 그 이유 · 알려진 부채 · 세션 운영 요령 |
| [**마스터 기능 명세서**](docs/notion-feature-research.md) | 전체 인벤토리 · 통합 데이터 모델 · 의존 그래프 · 로드맵 · 스택 · 리스크 TOP 7 · 만들지 않을 것 20개 |
| [**정본 데이터 모델**](docs/research/00-canonical-data-model.md) | 테이블 73개. 스키마의 유일한 정답지 |
| [**기능 소유권**](docs/research/00-feature-ownership.md) | F-ID 전수 인벤토리, 확정 난이도/우선순위, MVP 목록 |
| [도메인 상세 01~17](docs/research/) | 블록 에디터 · DB · 권한 · 협업 · 검색 · AI 등 |
| [판결문](docs/research/_canon/) · [커버리지 비평](docs/research/_critique/) | 스키마 모순을 어떻게 판결했는지의 근거 |
| [CLAUDE.md](CLAUDE.md) | 절대 제약 · 코딩 규칙 · 알려진 문제 |

---

## 로드맵

| Phase | 목표 | 기간 | 기능 | 상태 |
|---|---|---|---|---|
| **0** | MVP — 혼자 쓰는 노션 | 6~8주 | 65 | ✅ |
| **1** | 협업 — 둘이 쓰는 노션 | 6주 | 47 | 진행 중 |
| **2** | 제품화 — 팀이 쓰는 노션 | 12주 | 89 | |
| **3** | 확장 · 엔터프라이즈 | 12주+ | 49 | |

---

## 스택

```
Next.js 16 (App Router) + React 19 + TypeScript
  ├─ 에디터     ProseMirror (@tiptap/pm)       — MIT
  ├─ 스타일     Tailwind CSS v4                — MIT
  ├─ DB         PostgreSQL 16 + pg_bigm        — PostgreSQL License
  ├─ 캐시       Valkey (ioredis)               — BSD-3 / MIT
  ├─ 파일       로컬 디스크 드라이버           — S3 호환(Cloudflare R2) 드라이버는 예정
  ├─ 익스포트   node:zlib 로 직접 쓰는 ZIP     — 의존성 없음
  └─ 협업       Yjs · y-prosemirror · Hocuspocus 자체 호스팅 — MIT
```

런타임 의존성은 12개입니다. 기획 단계에서 권했던 것 중 **쓰지 않기로 한 것**도 있습니다 — 표는 필터 · 정렬 · 페이지네이션이 전부 서버 쪽이고 한 번에 50행만 그리므로 TanStack Table 대신 평범한 `<table>`을 쓰고, 블록 드래그는 ProseMirror 위에서 직접 구현했습니다.

**pg_bigm이 필수입니다.** PostgreSQL의 텍스트 검색 설정에는 한국어가 없어서, `'검색'`으로 `'검색이'`를 찾지 못합니다. 공식 이미지에 없어서 [소스로 빌드](docker/postgres/Dockerfile)합니다. DB collation도 ICU + `ko-KR`로 초기화하는데, **한 번 정하면 인덱스 재구축 없이는 못 바꿉니다.**

선택 근거와 **탈락 이유**는 [마스터 문서 §6](docs/notion-feature-research.md)에 있습니다.

---

## 개발

**사전 준비 (Windows)** — WSL2 Ubuntu 안에 Docker Engine을 설치합니다. Windows 쪽에는 docker를 설치하지 않습니다.

```powershell
wsl --install            # 관리자 PowerShell, 이후 재부팅
```

```bash
wsl -d Ubuntu -u root -- apt-get update
wsl -d Ubuntu -u root -- apt-get install -y docker.io docker-compose-v2
wsl -d Ubuntu -u root -- systemctl enable --now docker
wsl -d Ubuntu -u root -- usermod -aG docker $USER
```

Docker Desktop을 쓰지 않는 이유는 라이선스입니다 — 조건부 무료라서요. Rancher Desktop(Apache-2.0)도 시도했지만 이 환경에서 Windows↔WSL 브리지가 깨져 포기했습니다. 경위는 [CLAUDE.md](CLAUDE.md).

**실행**

```bash
npm install
cp .env.example .env        # AUTH_SECRET 을 생성해 채운다 (파일 안에 명령이 있다)

npm run db:up               # postgres(pg_bigm) + valkey, healthy 까지 대기
npm run db:migrate          # 마이그레이션
npm run dev                 # http://localhost:3000

npm run collab              # 협업 서버 (ws://localhost:3001) — 편집기 연결은 6d 진행 중이라 아직 없어도 됩니다
```

개발 환경은 메일을 보내지 않습니다(`MAIL_TRANSPORT="console"`). 로그인 코드는 **`npm run dev` 를 띄운 터미널에 찍힙니다.**

**검증**

```bash
npm run check               # typecheck + lint + license + test
npm test                    # 단위 테스트 (DB 가 없으면 DB 테스트는 skip)
npm run db:verify           # 확장 · ICU collation · 한국어 2-gram · Valkey
npm run db:verify:schema    # 스키마 + 불변식이 실제로 거부하는지
npm run db:migrate:status
npm run db:reset            # 볼륨 삭제 → 재생성 → 마이그레이션

npm run build && npm run e2e   # 실제 브라우저(Edge · Chrome 헤드리스)로 검증. db:up 먼저
```

`npm test` 만 돌리면 DB가 필요한 테스트가 조용히 빠집니다. CI의 DB 잡은 `REQUIRE_DB=1`로 돌려 **건너뛰지 못하게** 하고, 익스포트 검사에 필요한 python3 · bsdtar · unzip 도 설치합니다. 브라우저를 못 찾으면 `E2E_BROWSER=<chrome.exe 경로>` 를 줍니다.

> WSL2는 살아 있는 WSL 세션이 하나도 없으면 VM을 내립니다. 그러면 Postgres·Valkey도 같이 멈춰서 앱이 `ECONNREFUSED`를 맞습니다. `npm run db:up`이 **세션 유지 프로세스를 자동으로 띄우므로** 그럴 일이 없습니다 — `npm run db:down`이 정리하고, 끄려면 `WSL_KEEPALIVE=0`을 주면 됩니다. (`.wslconfig`의 `vmIdleTimeout=-1`은 WSL 2.7.13에서 동작하지 않는 것을 확인했습니다.)

---

## 원칙

**무료 라이브러리만 씁니다.** MIT · BSD · Apache-2.0 · ISC · PostgreSQL License만 허용하고, AGPL · SSPL · RSAL · 유료 SaaS 의존은 금지합니다. CI가 자동으로 검사합니다.

**LLM 토큰은 하드 캡입니다.** 한도를 넘으면 자동 결제 없이 차단합니다. 자동 충전도, 초과분 후불 청구도 하지 않습니다. 이 게이트는 AI 기능 첫 커밋과 **반드시 동시에** 들어갑니다.

**정본이 이긴다.** 스키마를 바꿔야 한다고 판단되면 코드가 아니라 [정본 문서](docs/research/00-canonical-data-model.md)를 먼저 고치고 판결 근거를 남깁니다.

자세한 건 [CLAUDE.md](CLAUDE.md).
